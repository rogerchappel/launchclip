import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { semanticHash } from "./job_store.js";
import { DEFAULT_NARRATED_MUSIC_VOLUME, isValidShotId, PRODUCTION_PATHS } from "./production_contracts.js";
import { writeAudioReport } from "./render_audio_analysis.js";
import { writeMotionReport } from "./render_motion_analysis.js";
import { critiqueProduction } from "./production_critic.js";
import { semanticVisualReport, validateSemanticVisualPlan } from "./semantic_visuals.js";
import { runHyperframes } from "./toolchain.js";

const execFileAsync = promisify(execFile);
const VERIFICATION_SCHEMA = "launchclip.production-verification.v6";
const VERIFICATION_SUITE = "production-verify.v6";
const HYPERFRAMES_RUNTIME_DIRECTORIES = new Set([".thumbnails", ".waveform-cache"]);

export class ProductionVerificationError extends Error {
  constructor(verification) {
    super(`HyperFrames verification failed: ${verification.failed.join(", ")}. Review ${verification.qa}.`);
    this.name = "ProductionVerificationError";
    this.code = verification.infrastructure_failed?.length
      ? "LAUNCHCLIP_PRODUCTION_INFRASTRUCTURE_FAILED"
      : "LAUNCHCLIP_PRODUCTION_VERIFICATION_FAILED";
    this.verification = verification;
  }
}

export async function verifyProduction(workspacePath, options = {}, adapters = {}) {
  const workspace = path.resolve(workspacePath);
  const project = path.join(workspace, PRODUCTION_PATHS.hyperframes);
  const qaDir = path.join(workspace, PRODUCTION_PATHS.qa);
  const snapshots = path.join(qaDir, "snapshots");
  const plan = JSON.parse(await readFile(path.join(workspace, PRODUCTION_PATHS.plan), "utf8"));
  const run = adapters.run ?? runCommand;
  await Promise.all([mkdir(qaDir, { recursive: true }), mkdir(snapshots, { recursive: true })]);
  const toolchain = await resolveVerifierFingerprint(project, adapters);
  const inputs = await buildVerificationInputs(workspace, project, options, toolchain);
  const receiptPath = path.join(qaDir, "verification.json");
  const cached = !options.forceVerification && toolchain
    ? await readReusableVerification(workspace, receiptPath, inputs)
    : null;
  if (cached) return verificationResult({ workspace, project, qaDir, snapshots, receipt: cached, cached: true });
  await Promise.all([
    rm(path.join(qaDir, "shot-inspect"), { recursive: true, force: true }),
    rm(snapshots, { recursive: true, force: true })
  ]);
  await mkdir(snapshots, { recursive: true });
  await writeAtomic(receiptPath, `${JSON.stringify({
    schema_version: VERIFICATION_SCHEMA,
    status: "running",
    created_at: new Date().toISOString(),
    input_hash: inputs.input_hash,
    inputs: inputs.value,
    checks: {},
    failed: [],
    snapshots,
    artifacts: [],
    snapshot_artifacts: { directory: path.relative(workspace, snapshots).split(path.sep).join("/"), files: [] }
  }, null, 2)}\n`);

  const checks = {};
  checks.semantic = await verifySemanticArtifacts(project, plan);
  await writeFile(path.join(qaDir, "semantic.json"), `${JSON.stringify(checks.semantic, null, 2)}\n`);
  if (!checks.semantic.ok) {
    const summary = {
      schema_version: VERIFICATION_SCHEMA,
      status: "failed",
      created_at: new Date().toISOString(),
      input_hash: inputs.input_hash,
      inputs: inputs.value,
      project,
      plan: { duration_seconds: plan.format?.duration_seconds, width: plan.format?.width, height: plan.format?.height },
      checks: { semantic: { ok: false, exit_code: 1, strict_warning_count: 0 } },
      failed: ["semantic"],
      infrastructure_failed: [],
      snapshots,
      cacheable: false,
      artifacts: [await describeReceiptFile(workspace, path.join(qaDir, "semantic.json"))],
      snapshot_artifacts: { directory: path.relative(workspace, snapshots).split(path.sep).join("/"), files: [] }
    };
    await writeAtomic(receiptPath, `${JSON.stringify(summary, null, 2)}\n`);
    throw new ProductionVerificationError(verificationResult({ workspace, project, qaDir, snapshots, receipt: summary, cached: false }));
  }
  for (const [name, args] of [
    ["lint", ["lint", "--json", project]],
    // Keep the historical receipt key (`inspect`) stable for repair routing while
    // using the current all-in-one HyperFrames browser contract underneath.
    ["inspect", ["check", "--json", "--timeout", String(options.timeoutMs ?? 8000), "--samples", String(options.inspectSamples ?? 15), "--at-transitions", project]]
  ]) {
    checks[name] = enforceStructuredCheck(await captureHyperframes(run, args, { cwd: project }));
    if (name === "lint" && options.strictAll !== false) {
      const findings = checks[name].stdout?.findings ?? [];
      const warningCount = Number(checks[name].stdout?.warningCount ?? findings.filter((entry) => entry.severity === "warning").length);
      if (warningCount > 0) {
        checks[name].ok = false;
        checks[name].strict_warning_count = warningCount;
      }
    }
    await writeFile(path.join(qaDir, `${name}.json`), `${JSON.stringify(checks[name], null, 2)}\n`);
  }
  Object.assign(checks, await verifyShotCompositions(project, qaDir, plan, {
    run,
    inspectSamples: options.inspectSamples,
    concurrency: options.shotInspectConcurrency
  }));
  checks.snapshot = await captureHyperframes(run, ["snapshot", "--frames", String(options.snapshotFrames ?? 12), "--output", snapshots, project], { cwd: project });
  await writeFile(path.join(qaDir, "snapshot.json"), `${JSON.stringify(checks.snapshot, null, 2)}\n`);
  const failed = Object.entries(checks).filter(([, result]) => !result.ok).map(([name]) => name);
  const infrastructureFailed = Object.entries(checks)
    .filter(([, result]) => !result.ok && result.failure_kind === "infrastructure")
    .map(([name]) => name);
  const postInputs = await buildVerificationInputs(workspace, project, options, toolchain);
  if (postInputs.input_hash !== inputs.input_hash) failed.push("inputs_changed_during_verification");
  const artifacts = await collectVerificationArtifacts(workspace, qaDir, plan);
  const snapshotArtifacts = await collectSnapshotArtifacts(workspace, snapshots);
  const summary = {
    schema_version: VERIFICATION_SCHEMA,
    status: failed.length ? "failed" : "passed",
    created_at: new Date().toISOString(),
    input_hash: inputs.input_hash,
    inputs: inputs.value,
    project,
    plan: { duration_seconds: plan.format.duration_seconds, width: plan.format.width, height: plan.format.height },
    checks: Object.fromEntries(Object.entries(checks).map(([name, result]) => [name, {
      ok: result.ok,
      exit_code: result.exit_code,
      strict_warning_count: result.strict_warning_count ?? 0,
      ...(result.failure_kind ? { failure_kind: result.failure_kind } : {}),
      ...(result.error ? { error: result.error } : {})
    }])),
    failed,
    infrastructure_failed: infrastructureFailed,
    snapshots,
    cacheable: Boolean(toolchain && snapshotArtifacts.files.length),
    artifacts,
    snapshot_artifacts: snapshotArtifacts
  };
  await writeAtomic(receiptPath, `${JSON.stringify(summary, null, 2)}\n`);
  if (failed.length) {
    throw new ProductionVerificationError(verificationResult({ workspace, project, qaDir, snapshots, receipt: summary, cached: false }));
  }
  return verificationResult({ workspace, project, qaDir, snapshots, receipt: summary, cached: false });
}

export async function verifyShotCompositions(projectPath, qaDirPath, plan, options = {}) {
  const project = path.resolve(projectPath);
  const qaDir = path.resolve(qaDirPath);
  const run = options.run ?? runCommand;
  const shots = plan.shots ?? [];
  const results = await mapConcurrent(shots, Number(options.concurrency ?? 2), async (shot) => {
    if (!isValidShotId(shot.id)) throw new Error(`Cannot inspect unsafe shot id: ${shot.id}`);
    const duration = Number(shot.end_seconds) - Number(shot.start_seconds);
    if (!(duration > 0)) throw new Error(`Cannot inspect shot with invalid duration: ${shot.id}`);
    const directory = path.join(qaDir, "shot-inspect", shot.id);
    const compositions = path.join(directory, "compositions");
    const assets = path.join(directory, "assets");
    await Promise.all([mkdir(compositions, { recursive: true }), mkdir(assets, { recursive: true })]);
    const sourceHtml = path.join(project, "compositions", `${shot.id}.html`);
    const sourceMotion = path.join(project, "compositions", `${shot.id}.motion.json`);
    const html = await readFile(sourceHtml, "utf8");
    const motion = await readFile(sourceMotion, "utf8");
    await Promise.all([
      writeFile(path.join(compositions, "shot.html"), html),
      writeFile(path.join(directory, "index.motion.json"), motion),
      writeFile(path.join(directory, "index.html"), renderShotInspectionRoot(shot, plan.format, duration))
    ]);
    const assetFiles = [...new Set([...html.matchAll(/\bassets\/([a-zA-Z0-9._-]+)/g)].map((match) => match[1]))];
    await Promise.all(assetFiles.map((file) => copyFile(path.join(project, "assets", file), path.join(assets, file))));
    const check = enforceStructuredCheck(await captureHyperframes(run, [
      "check", "--json", "--samples", String(options.inspectSamples ?? 15), "--at-transitions", directory
    ], { cwd: directory }));
    await writeFile(path.join(directory, "inspect.json"), `${JSON.stringify(check, null, 2)}\n`);
    return [`inspect:${shot.id}`, check];
  });
  return Object.fromEntries(results);
}

export async function verifySemanticArtifacts(projectPath, plan) {
  const project = path.resolve(projectPath);
  const errors = validateSemanticVisualPlan(plan);
  const renderedEvents = [];
  const frameHtml = [];
  for (const shot of plan.shots ?? []) {
    if (!shot.visual) continue;
    const htmlPath = path.join(project, "compositions", `${shot.id}.html`);
    const motionPath = path.join(project, "compositions", `${shot.id}.motion.json`);
    let motion, html;
    try { html = await readFile(htmlPath, "utf8"); frameHtml.push({ shot_id: shot.id, html }); }
    catch (error) {
      errors.push(`shot ${shot.id} is missing its assembled HTML composition: ${error.code ?? error.message}`);
    }
    try { motion = JSON.parse(await readFile(motionPath, "utf8")); }
    catch (error) {
      errors.push(`shot ${shot.id} is missing its assembled motion event sidecar: ${error.code ?? error.message}`);
      continue;
    }
    const actual = new Map((motion.events ?? []).map((event) => [event.event_id, event]));
    for (const event of shot.visual.events ?? []) {
      const rendered = actual.get(event.id);
      if (!rendered) errors.push(`shot ${shot.id} did not render planned visual event ${event.id}`);
      else if (!rendered.visible_change) errors.push(`shot ${shot.id} rendered event ${event.id} without a visible change`);
      else renderedEvents.push(event.id);
    }
    for (const cue of shot.sfx ?? []) if (!actual.has(cue.event_id)) errors.push(`shot ${shot.id} SFX ${cue.cue} is orphaned from rendered event ${cue.event_id}`);
  }
  errors.push(...plannedTypographyErrors(plan, frameHtml));
  return {
    ok: errors.length === 0,
    exit_code: errors.length ? 1 : 0,
    strict_warning_count: 0,
    stdout: { ...semanticVisualReport(plan), rendered_events: renderedEvents, errors },
    stderr: ""
  };
}

export function plannedTypographyErrors(plan, frames) {
  const roles = Object.entries(plan?.design?.style_dna?.typography ?? {})
    .map(([role, family]) => [role, plannedTypographyFamily(family)])
    .filter(([, family]) => family);
  if (!roles.length) return [];
  const css = frames.map((entry) => styleDeclarations(entry.html)).join("\n");
  return roles.flatMap(([role, family]) => {
    const escaped = family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const declaration = new RegExp(`(?:font(?:-family)?|--[a-z0-9_-]+)\\s*:[^;}]*["']?${escaped}(?:["']|\\s|,|;|}|$)`, "i");
    return declaration.test(css) ? [] : [`planned typography role ${role} requires family ${JSON.stringify(family)}, but no assembled frame declares it`];
  });
}

function plannedTypographyFamily(value) {
  const planned = String(value ?? "").trim();
  const described = planned.match(/^(.+?)\s+(?:[1-9]00(?:[\/\u2013-][1-9]00)?|thin|extra[- ]?light|light|regular|medium|semi[- ]?bold|bold|extra[- ]?bold|black)(?=\s|,|$)/i);
  return String(described?.[1] ?? planned).replace(/^["']|["']$/g, "").trim();
}

function styleDeclarations(html) {
  const source = String(html ?? "");
  return [
    ...[...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]),
    ...[...source.matchAll(/\bstyle\s*=\s*["']([^"']*)["']/gi)].map((match) => match[1]),
    ...[...source.matchAll(/\bdata-font-family\s*=\s*["']([^"']+)["']/gi)].map((match) => `font-family:${match[1]};`)
  ].join("\n");
}

function renderShotInspectionRoot(shot, format, duration) {
  return `<!doctype html>
<html lang="${escapeHtml(format.language ?? "en")}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=${Number(format.width)}, height=${Number(format.height)}">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <style>*{box-sizing:border-box}html,body{margin:0;width:${Number(format.width)}px;height:${Number(format.height)}px;overflow:hidden;background:#000}#shot-verification-root,.shot-mount{position:absolute;inset:0;width:100%;height:100%}</style>
</head>
<body>
  <div id="shot-verification-root" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="${Number(format.width)}" data-height="${Number(format.height)}">
    <div id="verify-${shot.id}" class="clip shot-mount" data-composition-id="${shot.id}" data-composition-src="compositions/shot.html" data-start="0" data-duration="${duration}" data-track-index="1" data-width="${Number(format.width)}" data-height="${Number(format.height)}"></div>
    <script>window.__timelines=window.__timelines||{};window.__timelines.main=gsap.timeline({paused:true});</script>
  </div>
</body>
</html>
`;
}

export async function renderProduction(workspacePath, options = {}, adapters = {}) {
  if (!options.approve) throw new Error("Final production render requires explicit --approve after reviewing the assembled project and snapshots");
  const workspace = path.resolve(workspacePath);
  const assembly = await readOptionalJson(path.join(workspace, PRODUCTION_PATHS.hyperframes, "assembly.json"));
  if (assembly?.full_fallback) {
    const error = new Error(`Final production render is blocked because all ${assembly.fallback_count ?? assembly.fallbacks?.length ?? 0} shots use deterministic fallbacks. Review the labelled draft and repair at least one model-authored frame first.`);
    error.code = "LAUNCHCLIP_FULL_FALLBACK_RENDER_BLOCKED";
    error.assembly = assembly;
    throw error;
  }
  return renderAnalyzedProduction(workspacePath, options, adapters, {
    stage: "production-render", outputName: "final.mp4", quality: options.quality ?? "high",
    logName: "render.json", successStatus: "awaiting-human-review", enforceQuality: true
  });
}

export async function renderDraftProduction(workspacePath, options = {}, adapters = {}) {
  return renderAnalyzedProduction(workspacePath, options, adapters, {
    stage: "production-draft", outputName: "draft.mp4", quality: options.draftQuality ?? "draft",
    logName: "draft-render.json", successStatus: "ready", enforceQuality: false
  });
}

async function renderAnalyzedProduction(workspacePath, options, adapters, profile) {
  const workspace = path.resolve(workspacePath);
  const verification = await verifyProduction(workspace, options, adapters);
  await assertVerificationFresh(workspace, verification, options);
  const project = verification.project;
  const qaDir = verification.qa;
  const renderDir = path.join(workspace, "production", "renders");
  const requestedOutput = profile.stage === "production-draft" ? options.draftOutput : options.output;
  const output = path.resolve(requestedOutput ?? path.join(renderDir, profile.outputName));
  await mkdir(path.dirname(output), { recursive: true });
  const run = adapters.run ?? runCommand;
  const render = await captureHyperframes(run, [
    "render", "--output", output,
    "--quality", String(profile.quality),
    "--workers", String(options.workers ?? "auto"),
    "--strict-all", "--skill", "product-launch-video", project
  ], { cwd: project });
  await writeFile(path.join(qaDir, profile.logName), `${JSON.stringify(render, null, 2)}\n`);
  if (!render.ok) throw new Error(`HyperFrames render failed. Review ${path.join(qaDir, profile.logName)}.`);

  const plan = JSON.parse(await readFile(path.join(workspace, PRODUCTION_PATHS.plan), "utf8"));
  const sourceMedia = await readOptionalJson(path.join(workspace, "production", "source-media", "analysis.json"));
  const references = [...new Set([...values(options.references), ...(sourceMedia?.staged_references ?? []).map((entry) => entry.local_path)].filter(Boolean).map((entry) => path.resolve(entry)))];
  const analysisOptions = motionOptions(plan, { ...options, references });
  const motionPath = path.join(qaDir, "motion.json");
  const motion = adapters.writeMotionReport
    ? await adapters.writeMotionReport(output, motionPath, analysisOptions)
    : await writeMotionReport(output, motionPath, analysisOptions, adapters.motion);
  if (profile.enforceQuality && !motion.quality.ok) throw new Error(`Rendered video failed motion quality gates. Review ${motionPath}.`);
  const audioPath = path.join(qaDir, "audio.json");
  const audioManifestPath = path.join(workspace, "production", "media", "manifest.json");
  const audioManifest = await readOptionalJson(audioManifestPath);
  const audio = audioManifest
    ? adapters.writeAudioReport
      ? await adapters.writeAudioReport(output, audioManifestPath, audioPath, { musicVolume: Number(options.musicVolume ?? DEFAULT_NARRATED_MUSIC_VOLUME) })
      : await writeAudioReport(output, audioManifestPath, audioPath, { musicVolume: Number(options.musicVolume ?? DEFAULT_NARRATED_MUSIC_VOLUME) }, adapters.audio)
    : { schema_version: "launchclip.render-audio.v1", status: "not-requested", quality: { ok: true, findings: [] } };
  if (!audioManifest) await writeFile(audioPath, `${JSON.stringify(audio, null, 2)}\n`);
  if (profile.enforceQuality && !audio.quality.ok) throw new Error(`Rendered video failed audio quality gates. Review ${audioPath}.`);
  const critique = adapters.critiqueProduction
    ? await adapters.critiqueProduction(workspace, criticOptions(options))
    : await critiqueProduction(workspace, criticOptions(options), adapters.critic);
  const assembly = await readOptionalJson(path.join(project, "assembly.json"));
  return {
    stage: profile.stage,
    status: critique.verdict === "ship" && motion.quality.ok && audio.quality.ok ? profile.successStatus : "needs-repair",
    workspace,
    video: output,
    verification,
    motion: motionPath,
    audio: audioPath,
    family: motion.family,
    fallbacks: assembly ? { count: assembly.fallback_count ?? 0, full: Boolean(assembly.full_fallback), shots: assembly.fallbacks ?? [] } : null,
    critique
  };
}

export async function assertVerificationFresh(workspacePath, verification, options = {}) {
  const workspace = path.resolve(workspacePath);
  if (!verification?.inputs || !verification?.input_hash) throw staleVerificationError("Verification receipt is not content-addressed");
  const current = await buildVerificationInputs(workspace, path.join(workspace, PRODUCTION_PATHS.hyperframes), options, verification.inputs.toolchain);
  if (current.input_hash !== verification.input_hash) throw staleVerificationError("Plan or assembled project changed after verification");
  return current.input_hash;
}

function verificationResult({ workspace, project, qaDir, snapshots, receipt, cached }) {
  return {
    stage: "production-verify",
    status: receipt.status === "passed" ? "ready" : "failed",
    workspace,
    project,
    qa: qaDir,
    snapshots,
    checks: receipt.checks,
    failed: receipt.failed,
    infrastructure_failed: receipt.infrastructure_failed ?? [],
    input_hash: receipt.input_hash,
    inputs: receipt.inputs,
    cached
  };
}

async function buildVerificationInputs(workspace, project, options, toolchain) {
  const value = {
    suite_version: VERIFICATION_SUITE,
    plan_sha256: await sha256File(path.join(workspace, PRODUCTION_PATHS.plan)),
    project_tree_sha256: await sha256Tree(project),
    options: {
      strict_all: options.strictAll !== false,
      validate_timeout_ms: Number(options.timeoutMs ?? 8000),
      inspect_samples: Number(options.inspectSamples ?? 15),
      snapshot_frames: Number(options.snapshotFrames ?? 12),
      at_transitions: true
    },
    toolchain
  };
  return { value, input_hash: semanticHash(value) };
}

async function resolveVerifierFingerprint(project, adapters) {
  if (adapters.verifierFingerprint) {
    const value = typeof adapters.verifierFingerprint === "function"
      ? await adapters.verifierFingerprint(project)
      : adapters.verifierFingerprint;
    return value || null;
  }
  if (adapters.run) return null;
  try {
    const info = parseOutput((await runHyperframes(runCommand, ["info", "--json", project], { cwd: project })).stdout);
    const browserResult = await runHyperframes(runCommand, ["browser", "path"], { cwd: project });
    const browserPath = String(browserResult.stdout ?? "").trim().split(/\r?\n/).filter(Boolean).at(-1);
    if (!info?._meta?.version || !browserPath) return null;
    const browserVersion = String((await runCommand(browserPath, ["--version"], { cwd: project })).stdout ?? "").trim();
    if (!browserVersion) return null;
    return {
      hyperframes_cli: String(info._meta.version),
      browser: browserVersion,
      node: process.version,
      platform: process.platform,
      arch: process.arch
    };
  } catch {
    return null;
  }
}

function captureHyperframes(run, args, options) {
  return capture(() => runHyperframes(run, args, options), "hyperframes", args, options);
}

async function readReusableVerification(workspace, receiptPath, inputs) {
  const receipt = await readOptionalJson(receiptPath);
  if (!receipt || receipt.schema_version !== VERIFICATION_SCHEMA || receipt.status !== "passed" || receipt.cacheable !== true) return null;
  if (receipt.input_hash !== inputs.input_hash || semanticHash(receipt.inputs) !== inputs.input_hash) return null;
  if (!Array.isArray(receipt.failed) || receipt.failed.length || !receipt.checks || Object.values(receipt.checks).some((check) => check?.ok !== true)) return null;
  if (!Array.isArray(receipt.artifacts) || receipt.artifacts.length < 4) return null;
  if (!(await allReceiptFilesMatch(workspace, receipt.artifacts))) return null;
  const snapshotReceipt = receipt.snapshot_artifacts;
  if (!snapshotReceipt || !Array.isArray(snapshotReceipt.files) || !snapshotReceipt.files.length) return null;
  const snapshotDirectory = safeReceiptPath(workspace, snapshotReceipt.directory);
  if (!snapshotDirectory) return null;
  let entries;
  try { entries = await readdir(snapshotDirectory, { withFileTypes: true }); } catch { return null; }
  const current = entries.filter((entry) => entry.isFile() && /\.(?:png|jpe?g|webp)$/i.test(entry.name)).map((entry) => entry.name).sort();
  const expected = snapshotReceipt.files.map((entry) => path.basename(entry.path)).sort();
  if (current.length !== expected.length || current.some((name, index) => name !== expected[index])) return null;
  if (!(await allReceiptFilesMatch(workspace, snapshotReceipt.files))) return null;
  return receipt;
}

async function collectVerificationArtifacts(workspace, qaDir, plan) {
  const files = ["semantic.json", "lint.json", "inspect.json", "snapshot.json"].map((name) => path.join(qaDir, name));
  for (const shot of plan.shots ?? []) files.push(path.join(qaDir, "shot-inspect", shot.id, "inspect.json"));
  return Promise.all(files.map((filePath) => describeReceiptFile(workspace, filePath)));
}

async function collectSnapshotArtifacts(workspace, directory) {
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.(?:png|jpe?g|webp)$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  return {
    directory: path.relative(workspace, directory).split(path.sep).join("/"),
    files: await Promise.all(entries.map((name) => describeReceiptFile(workspace, path.join(directory, name))))
  };
}

async function describeReceiptFile(workspace, filePath) {
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error(`Verification artifact must be a file: ${filePath}`);
  return {
    path: path.relative(workspace, filePath).split(path.sep).join("/"),
    sha256: await sha256File(filePath),
    size_bytes: info.size
  };
}

async function allReceiptFilesMatch(workspace, files) {
  for (const expected of files) {
    const filePath = safeReceiptPath(workspace, expected?.path);
    if (!filePath) return false;
    try {
      const [info, linkInfo, workspaceReal, fileReal] = await Promise.all([stat(filePath), lstat(filePath), realpath(workspace), realpath(filePath)]);
      if (!info.isFile() || linkInfo.isSymbolicLink() || !isWithin(workspaceReal, fileReal)) return false;
      if (info.size !== Number(expected.size_bytes) || await sha256File(filePath) !== expected.sha256) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function safeReceiptPath(workspace, relativePath) {
  if (!relativePath || path.isAbsolute(relativePath)) return null;
  const root = path.resolve(workspace);
  const resolved = path.resolve(root, relativePath);
  return isWithin(root, resolved) ? resolved : null;
}

function isWithin(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function sha256Tree(directory) {
  const root = path.resolve(directory);
  const files = [];
  const visit = async (current) => {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isDirectory() && HYPERFRAMES_RUNTIME_DIRECTORIES.has(entry.name)) continue;
      const filePath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Verification input tree cannot contain symlinks: ${filePath}`);
      if (entry.isDirectory()) await visit(filePath);
      else if (entry.isFile()) {
        const info = await stat(filePath);
        files.push({ path: path.relative(root, filePath).split(path.sep).join("/"), size_bytes: info.size, sha256: await sha256File(filePath) });
      } else throw new Error(`Unsupported verification input entry: ${filePath}`);
    }
  };
  await visit(root);
  return semanticHash(files);
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function writeAtomic(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { mode: 0o600 });
  await rename(temporary, filePath);
}

function staleVerificationError(message) {
  return Object.assign(new Error(message), { name: "StaleProductionVerificationError", code: "LAUNCHCLIP_STALE_PRODUCTION_VERIFICATION" });
}

async function readOptionalJson(filePath) {
  try { return JSON.parse(await readFile(filePath, "utf8")); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

function motionOptions(plan, options) {
  return {
    references: values(options.references).map((entry) => path.resolve(entry)),
    expected: {
      duration_seconds: plan.format.duration_seconds,
      width: plan.format.width,
      height: plan.format.height,
      duration_tolerance_seconds: Number(options.durationToleranceSeconds ?? .15),
      maximum_hold_ratio: Number(options.maximumHoldRatio ?? .94),
      minimum_bursts_per_minute: Number(options.minimumBurstsPerMinute ?? 8),
      minimum_change_energy_p50: Number(options.minimumChangeEnergyP50 ?? .35),
      minimum_change_energy_p50_by_family: { "developing-card": Number(options.minimumDevelopingCardEnergyP50 ?? .15) },
      minimum_flow_velocity_p90: Number(options.minimumFlowVelocityP90 ?? 2),
      maximum_first_motion_seconds: Number(options.maximumFirstMotionSeconds ?? .65),
      hook_window_seconds: Number(options.hookWindowSeconds ?? 4),
      minimum_hook_events: Number(options.minimumHookEvents ?? 2)
    }
  };
}

function criticOptions(options) {
  return {
    route: options.criticRoute,
    model: options.criticModel ?? "gpt-5.6",
    reasoning: options.criticReasoning ?? "xhigh",
    pro: Boolean(options.criticPro),
    background: options.background !== false,
    maxSnapshots: Number(options.maxCriticSnapshots ?? 12)
  };
}

async function capture(run, command, args, options) {
  try {
    const result = await run(command, args, options);
    return { ok: true, exit_code: Number(result.exitCode ?? result.exit_code ?? 0), stdout: parseOutput(result.stdout), stderr: String(result.stderr ?? "") };
  } catch (error) {
    const stdout = parseOutput(error.stdout);
    const stderr = String(error.stderr ?? error.message ?? "").slice(0, 20_000);
    const failureKind = classifyCommandFailure(stdout, stderr);
    return {
      ok: false,
      exit_code: Number(error.code ?? error.exitCode ?? 1),
      stdout,
      stderr,
      failure_kind: failureKind,
      error: compactCommandError(stdout, stderr)
    };
  }
}

function enforceStructuredCheck(check) {
  if (!check.ok || !check.stdout || typeof check.stdout !== "object") return check;
  const findings = [
    ...(Array.isArray(check.stdout.issues) ? check.stdout.issues : []),
    ...(Array.isArray(check.stdout.findings) ? check.stdout.findings : []),
    ...(Array.isArray(check.stdout.errors) ? check.stdout.errors.map((error) => typeof error === "object" ? error : { severity: "error", message: String(error) }) : [])
  ];
  const blocking = findings.filter((entry) => new Set(["error", "blocking", "fatal"]).has(String(entry?.severity ?? "").toLowerCase()));
  const declaredErrorCount = Number(check.stdout.errorCount ?? check.stdout.error_count ?? 0);
  if (check.stdout.ok !== false && blocking.length === 0 && !(declaredErrorCount > 0)) return check;
  return {
    ...check,
    ok: false,
    failure_kind: "content",
    error: compactCommandError(check.stdout, blocking[0]?.message ?? blocking[0]?.code ?? "structured verification reported an error")
  };
}

export function classifyCommandFailure(stdout, stderr) {
  const text = `${typeof stdout === "string" ? stdout : JSON.stringify(stdout ?? "")}\n${stderr ?? ""}`.toLowerCase();
  return [
    /spec version .+ is not supported/,
    /upgrade (?:the )?hyperframes cli/,
    /unknown (?:option|command)/,
    /command not found|executable not found|spawn .+ enoent|\benoent\b/,
    /browser executable .+ not found|failed to launch (?:the )?browser|could not find (?:a )?(?:chrome|chromium)/,
    /npm err!|could not determine executable to run/
  ].some((pattern) => pattern.test(text)) ? "infrastructure" : "content";
}

function compactCommandError(stdout, stderr) {
  const value = String(stderr || (typeof stdout === "string" ? stdout : JSON.stringify(stdout ?? ""))).trim();
  return value.slice(0, 1000);
}

function parseOutput(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text.slice(0, 40_000); }
}

function values(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

async function mapConcurrent(values, concurrency, worker) {
  const output = new Array(values.length);
  let cursor = 0;
  let firstError = null;
  const count = Math.max(1, Math.min(values.length || 1, Math.floor(concurrency) || 1));
  await Promise.all(Array.from({ length: count }, async () => {
    while (cursor < values.length && !firstError) {
      const index = cursor;
      cursor += 1;
      try {
        output[index] = await worker(values[index], index);
      } catch (error) {
        firstError ??= error;
      }
    }
  }));
  if (firstError) throw firstError;
  return output;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

async function runCommand(command, args, options) {
  return execFileAsync(command, args, { ...options, maxBuffer: 1024 * 1024 * 128 });
}
