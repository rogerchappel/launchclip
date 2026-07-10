import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { isValidShotId, PRODUCTION_PATHS } from "./production_contracts.js";
import { writeAudioReport } from "./render_audio_analysis.js";
import { writeMotionReport } from "./render_motion_analysis.js";
import { critiqueProduction } from "./production_critic.js";

const execFileAsync = promisify(execFile);

export class ProductionVerificationError extends Error {
  constructor(verification) {
    super(`HyperFrames verification failed: ${verification.failed.join(", ")}. Review ${verification.qa}.`);
    this.name = "ProductionVerificationError";
    this.code = "LAUNCHCLIP_PRODUCTION_VERIFICATION_FAILED";
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

  const checks = {};
  for (const [name, args] of [
    ["lint", ["hyperframes", "lint", "--json", project]],
    ["validate", ["hyperframes", "validate", "--json", "--timeout", String(options.timeoutMs ?? 8000), project]],
    ["inspect", ["hyperframes", "inspect", "--json", "--samples", String(options.inspectSamples ?? 15), "--at-transitions", project]]
  ]) {
    checks[name] = await capture(run, "npx", args, { cwd: project });
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
  checks.snapshot = await capture(run, "npx", ["hyperframes", "snapshot", "--frames", String(options.snapshotFrames ?? 12), "--output", snapshots, project], { cwd: project });
  await writeFile(path.join(qaDir, "snapshot.json"), `${JSON.stringify(checks.snapshot, null, 2)}\n`);
  const failed = Object.entries(checks).filter(([, result]) => !result.ok).map(([name]) => name);
  const summary = {
    schema_version: "launchclip.production-verification.v1",
    project,
    plan: { duration_seconds: plan.format.duration_seconds, width: plan.format.width, height: plan.format.height },
    checks: Object.fromEntries(Object.entries(checks).map(([name, result]) => [name, { ok: result.ok, exit_code: result.exit_code, strict_warning_count: result.strict_warning_count ?? 0 }])),
    failed,
    snapshots
  };
  await writeFile(path.join(qaDir, "verification.json"), `${JSON.stringify(summary, null, 2)}\n`);
  if (failed.length) {
    throw new ProductionVerificationError({
      stage: "production-verify",
      status: "failed",
      workspace,
      project,
      qa: qaDir,
      snapshots,
      checks: summary.checks,
      failed
    });
  }
  return { stage: "production-verify", status: "ready", workspace, project, qa: qaDir, snapshots, checks: summary.checks };
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
    const check = await capture(run, "npx", [
      "hyperframes", "inspect", "--json", "--samples", String(options.inspectSamples ?? 15), "--at-transitions", directory
    ], { cwd: directory });
    await writeFile(path.join(directory, "inspect.json"), `${JSON.stringify(check, null, 2)}\n`);
    return [`inspect:${shot.id}`, check];
  });
  return Object.fromEntries(results);
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
  const project = verification.project;
  const qaDir = verification.qa;
  const renderDir = path.join(workspace, "production", "renders");
  const requestedOutput = profile.stage === "production-draft" ? options.draftOutput : options.output;
  const output = path.resolve(requestedOutput ?? path.join(renderDir, profile.outputName));
  await mkdir(path.dirname(output), { recursive: true });
  const run = adapters.run ?? runCommand;
  const render = await capture(run, "npx", [
    "hyperframes", "render", "--output", output,
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
      ? await adapters.writeAudioReport(output, audioManifestPath, audioPath, { musicVolume: Number(options.musicVolume ?? .16) })
      : await writeAudioReport(output, audioManifestPath, audioPath, { musicVolume: Number(options.musicVolume ?? .16) }, adapters.audio)
    : { schema_version: "launchclip.render-audio.v1", status: "not-requested", quality: { ok: true, findings: [] } };
  if (!audioManifest) await writeFile(audioPath, `${JSON.stringify(audio, null, 2)}\n`);
  if (profile.enforceQuality && !audio.quality.ok) throw new Error(`Rendered video failed audio quality gates. Review ${audioPath}.`);
  const critique = adapters.critiqueProduction
    ? await adapters.critiqueProduction(workspace, criticOptions(options))
    : await critiqueProduction(workspace, criticOptions(options), adapters.critic);
  return {
    stage: profile.stage,
    status: critique.verdict === "ship" && motion.quality.ok && audio.quality.ok ? profile.successStatus : "needs-repair",
    workspace,
    video: output,
    verification,
    motion: motionPath,
    audio: audioPath,
    family: motion.family,
    critique
  };
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
      maximum_hold_ratio: Number(options.maximumHoldRatio ?? .985),
      minimum_bursts_per_minute: Number(options.minimumBurstsPerMinute ?? 4)
    }
  };
}

function criticOptions(options) {
  return {
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
    return {
      ok: false,
      exit_code: Number(error.code ?? error.exitCode ?? 1),
      stdout: parseOutput(error.stdout),
      stderr: String(error.stderr ?? error.message ?? "").slice(0, 20_000)
    };
  }
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
  const count = Math.max(1, Math.min(values.length || 1, Math.floor(concurrency) || 1));
  await Promise.all(Array.from({ length: count }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(values[index], index);
    }
  }));
  return output;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

async function runCommand(command, args, options) {
  return execFileAsync(command, args, { ...options, maxBuffer: 1024 * 1024 * 128 });
}
