import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { applyFrameCsp, toHyperFramesMotionSpec } from "./hyperframes_assembler.js";
import { ensureTimelineRegistration } from "./hyperframes_timeline.js";
import { ensureTextContainment } from "./hyperframes_text.js";
import { injectProductionFontFaces } from "./production_fonts.js";
import { PRODUCTION_PATHS } from "./production_contracts.js";
import { runHyperframes } from "./toolchain.js";
import { analyzePng } from "./visual_snapshot.js";

const execFileAsync = promisify(execFile);

export async function verifyFrameCandidate(workspacePath, bundle, options = {}, adapters = {}) {
  const workspace = path.resolve(workspacePath);
  const shot = options.shot;
  const format = options.format;
  if (!shot?.id || shot.id !== bundle?.shot_id) throw new Error("Candidate verification requires the matching shot");
  const duration = Number(shot.end_seconds) - Number(shot.start_seconds);
  if (!(duration > 0) || !(Number(format?.width) > 0) || !(Number(format?.height) > 0)) throw new Error("Candidate verification requires a valid shot duration and canvas");
  const attempt = safeSegment(options.attempt ?? "latest");
  const root = path.join(workspace, PRODUCTION_PATHS.qa, "candidate-verify", shot.id, attempt);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  const baseline = options.baseline ? await captureBundle(workspace, options.baseline, {
    ...options, shot, format, duration, root: path.join(root, "baseline"), compareContentFailures: true
  }, adapters) : null;
  const candidate = await captureBundle(workspace, bundle, {
    ...options, shot, format, duration, root: path.join(root, "candidate"), compareContentFailures: Boolean(baseline)
  }, adapters);
  const comparison = compareEvidence(candidate, baseline, options);
  const report = {
    schema_version: "launchclip.frame-candidate-verification.v3",
    shot_id: shot.id,
    attempt,
    status: comparison.ok ? "passed" : "failed",
    comparison,
    baseline,
    candidate
  };
  await writeFile(path.join(root, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return {
    ok: comparison.ok,
    failure_kind: comparison.failure_kind,
    error: comparison.error,
    report: path.join(root, "report.json"),
    snapshots: candidate.snapshots,
    frames: candidate.visual.frames
  };
}

async function captureBundle(workspace, bundle, options, adapters) {
  const root = options.root;
  const project = path.join(root, "project");
  const compositions = path.join(project, "compositions");
  const assets = path.join(project, "assets");
  const snapshots = path.join(root, "snapshots");
  await Promise.all([mkdir(compositions, { recursive: true }), mkdir(assets, { recursive: true }), mkdir(snapshots, { recursive: true })]);
  const fontCss = await assembledFontCss(workspace, bundle.shot_id);
  const html = applyFrameCsp(ensureTextContainment(ensureTimelineRegistration(injectProductionFontFaces(bundle.html, fontCss), bundle.shot_id), bundle.shot_id));
  const motion = toHyperFramesMotionSpec(bundle, options.duration);
  await Promise.all([
    writeFile(path.join(compositions, "shot.html"), `${html.trim()}\n`),
    writeFile(path.join(project, "index.motion.json"), `${JSON.stringify(motion, null, 2)}\n`),
    writeFile(path.join(project, "index.html"), inspectionRoot(options.shot, options.format, options.duration)),
    copyCandidateAssets(workspace, project, html)
  ]);

  const run = adapters.run ?? runCommand;
  const check = await capture(run, [
    "check", "--json", "--samples", String(options.samples ?? 9), "--at-transitions",
    "--frame-check", "severity=error;seek=.2,.5,.8;tol=2", project
  ], project);
  const shouldSnapshot = check.ok || (options.compareContentFailures && check.failure_kind === "content");
  const snapshot = shouldSnapshot ? await capture(run, [
    "snapshot", "--at", sampleTimes(options.duration).join(","), "--no-end", "--output", snapshots, "--describe", "false", project
  ], project) : { ok: false, exit_code: null, stdout: null, stderr: "Skipped because candidate check failed", failure_kind: check.failure_kind };
  let frames = [];
  let analysisError = null;
  if (snapshot.ok) {
    try {
      const files = (await readdir(snapshots, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && /^frame-.*\.png$/i.test(entry.name))
        .map((entry) => entry.name)
        .sort();
      frames = await Promise.all(files.map(async (name) => ({
        file: path.relative(workspace, path.join(snapshots, name)).split(path.sep).join("/"),
        ...analyzePng(await readFile(path.join(snapshots, name)), options.visualThresholds)
      })));
      if (!frames.length) analysisError = "HyperFrames snapshot produced no PNG frames";
    } catch (error) {
      analysisError = error.message;
    }
  }
  const allBlank = frames.length > 0 && frames.every((frame) => frame.blank);
  return {
    check,
    snapshot,
    snapshots,
    visual: { ok: frames.length > 0 && !allBlank && !analysisError, all_blank: allBlank, error: analysisError, frames, detail_score: detailScore(frames) }
  };
}

function compareEvidence(candidate, baseline, options) {
  const infrastructure = [baseline, candidate].filter(Boolean).find((entry) => entry.check.failure_kind === "infrastructure" || entry.snapshot.failure_kind === "infrastructure" || entry.visual.error);
  if (infrastructure) return { ok: false, failure_kind: "infrastructure", error: infrastructure.check.error ?? infrastructure.snapshot.error ?? infrastructure.visual.error };
  if (!baseline && !candidate.check.ok) return { ok: false, failure_kind: candidate.check.failure_kind ?? "content", error: candidate.check.error ?? "Candidate browser check failed" };
  if (!candidate.snapshot.ok) return { ok: false, failure_kind: candidate.snapshot.failure_kind ?? "content", error: candidate.snapshot.error ?? "Candidate snapshots failed" };
  if (!candidate.visual.ok) return { ok: false, failure_kind: "content", error: candidate.visual.all_blank ? "All sampled candidate frames are visually blank" : candidate.visual.error ?? "Candidate snapshots contain no measurable visual detail" };

  const minimumRetention = Number(options.minimumDetailRetention ?? .2);
  const retention = baseline?.visual.ok && baseline.visual.detail_score > 0 ? candidate.visual.detail_score / baseline.visual.detail_score : null;
  if (retention != null && retention < minimumRetention) {
    return { ok: false, failure_kind: "content", error: `Candidate retained only ${(retention * 100).toFixed(1)}% of baseline visual detail`, detail_retention: rounded(retention) };
  }
  if (candidate.check.ok) return { ok: true, failure_kind: null, error: null, detail_retention: retention == null ? null : rounded(retention), new_findings: [], worsened_findings: [] };
  if (!baseline || baseline.check.ok || baseline.check.failure_kind !== "content") {
    return { ok: false, failure_kind: candidate.check.failure_kind ?? "content", error: candidate.check.error ?? "Candidate browser check failed" };
  }
  const baselineIssues = issueWeights(baseline.check.stdout);
  const candidateIssues = issueWeights(candidate.check.stdout);
  if (!baselineIssues.size || !candidateIssues.size) return { ok: false, failure_kind: "content", error: candidate.check.error ?? "Candidate browser check could not be compared with its baseline" };
  const newFindings = [...candidateIssues.keys()].filter((key) => !baselineIssues.has(key));
  const worsenedFindings = [...candidateIssues].filter(([key, weight]) => baselineIssues.has(key) && weight > baselineIssues.get(key)).map(([key]) => key);
  if (newFindings.length || worsenedFindings.length) {
    return { ok: false, failure_kind: "content", error: "Candidate introduced or worsened browser findings", detail_retention: retention == null ? null : rounded(retention), new_findings: newFindings, worsened_findings: worsenedFindings };
  }
  const improvedFindings = [...baselineIssues].filter(([key, weight]) => !candidateIssues.has(key) || candidateIssues.get(key) < weight).map(([key]) => key);
  if (!improvedFindings.length) {
    const remainingFindings = issueSummaries(candidate.check.stdout, [...candidateIssues.keys()]);
    const detail = remainingFindings.length ? ` Remaining: ${remainingFindings.join("; ")}` : "";
    return { ok: false, failure_kind: "content", error: `Candidate did not resolve or reduce any browser finding.${detail}`.slice(0, 1_500), detail_retention: retention == null ? null : rounded(retention), new_findings: [], worsened_findings: [], improved_findings: [], remaining_findings: remainingFindings };
  }
  return { ok: true, failure_kind: null, error: null, detail_retention: retention == null ? null : rounded(retention), new_findings: [], worsened_findings: [], improved_findings: improvedFindings };
}

async function assembledFontCss(workspace, shotId) {
  try {
    const html = await readFile(path.join(workspace, PRODUCTION_PATHS.hyperframes, "compositions", `${shotId}.html`), "utf8");
    return [...html.matchAll(/@font-face\s*\{[\s\S]*?\}/gi)].map((match) => match[0]).join("\n\n");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

async function copyCandidateAssets(workspace, project, html) {
  const names = [...new Set([...String(html ?? "").matchAll(/\bassets\/([a-zA-Z0-9._-]+)/g)].map((match) => match[1]))];
  const source = path.join(workspace, PRODUCTION_PATHS.hyperframes, "assets");
  await Promise.all(names.map((name) => copyFile(path.join(source, name), path.join(project, "assets", name))));
}

async function capture(run, args, cwd) {
  try {
    const result = await runHyperframes(run, args, { cwd });
    const stdout = parseOutput(result.stdout);
    const blocking = structuredBlocking(stdout);
    if (!blocking) return { ok: true, exit_code: Number(result.exitCode ?? result.exit_code ?? 0), stdout, stderr: String(result.stderr ?? "") };
    return { ok: false, exit_code: Number(result.exitCode ?? result.exit_code ?? 1), stdout, stderr: String(result.stderr ?? ""), failure_kind: "content", error: blocking };
  } catch (error) {
    const stdout = parseOutput(error.stdout);
    const stderr = String(error.stderr ?? error.message ?? "").slice(0, 20_000);
    const failureKind = commandFailureKind(stdout, stderr);
    return { ok: false, exit_code: Number(error.code ?? error.exitCode ?? 1), stdout, stderr, failure_kind: failureKind, error: structuredBlocking(stdout) ?? compactError(stdout, stderr) };
  }
}

function structuredBlocking(stdout) {
  if (!stdout || typeof stdout !== "object") return null;
  const findings = blockingFindings(stdout);
  const blocking = findings.find((entry) => typeof entry === "string" || ["error", "blocking", "fatal"].includes(String(entry?.severity ?? "").toLowerCase()));
  if (stdout.ok !== false && !(Number(stdout.errorCount ?? stdout.error_count ?? 0) > 0) && !blocking) return null;
  return String(typeof blocking === "string" ? blocking : blocking?.message ?? blocking?.code ?? "Candidate check reported an error").slice(0, 1_000);
}

function blockingFindings(stdout) {
  if (!stdout || typeof stdout !== "object") return [];
  const sections = [stdout.lint, stdout.runtime, stdout.layout, stdout.motion, stdout.contrast];
  return [
    ...(Array.isArray(stdout.issues) ? stdout.issues : []),
    ...(Array.isArray(stdout.findings) ? stdout.findings : []),
    ...(Array.isArray(stdout.errors) ? stdout.errors : []),
    ...sections.flatMap((section) => [
      ...(Array.isArray(section?.issues) ? section.issues : []),
      ...(Array.isArray(section?.findings) ? section.findings : []),
      ...(Array.isArray(section?.errors) ? section.errors : [])
    ])
  ].filter((entry) => typeof entry === "string" || ["error", "blocking", "fatal"].includes(String(entry?.severity ?? "").toLowerCase()));
}

function issueWeights(stdout) {
  const weights = new Map();
  for (const finding of blockingFindings(stdout)) {
    const key = issueKey(finding);
    const unresolved = String(typeof finding === "string" ? finding : finding.message ?? "").match(/(\d+) unresolved layout issue/i);
    const weight = unresolved ? Number(unresolved[1]) : 1;
    weights.set(key, (weights.get(key) ?? 0) + weight);
  }
  return weights;
}

function issueSummaries(stdout, keys, limit = 3) {
  const remaining = new Set(keys);
  const summaries = [];
  for (const finding of blockingFindings(stdout)) {
    const key = issueKey(finding);
    if (!remaining.has(key)) continue;
    remaining.delete(key);
    if (typeof finding === "string") summaries.push(finding.slice(0, 300));
    else {
      const selector = finding.selector ? ` on ${finding.selector}` : "";
      const time = Number.isFinite(Number(finding.time)) ? ` at ${Number(finding.time)}s` : "";
      const message = finding.message ? `: ${finding.message}` : "";
      const fix = finding.fixHint ? ` Fix: ${finding.fixHint}` : "";
      summaries.push(`${finding.code ?? "error"}${selector}${time}${message}${fix}`.slice(0, 500));
    }
    if (summaries.length >= limit) break;
  }
  return summaries;
}

function issueKey(finding) {
  return typeof finding === "string"
    ? `error|global|${finding.slice(0, 120)}`
    : `${finding.code ?? "error"}|${finding.selector ?? "global"}`;
}

function detailScore(frames) {
  if (!frames.length) return 0;
  return rounded(frames.reduce((total, frame) => total
    + Number(frame.foreground_ratio ?? 0)
    + Number(frame.edge_ratio ?? 0) * 2
    + Math.min(1, Number(frame.luma_standard_deviation ?? 0) / 64), 0) / frames.length);
}

function rounded(value) {
  return Number(Number(value).toFixed(6));
}

function commandFailureKind(stdout, stderr) {
  const text = `${typeof stdout === "string" ? stdout : JSON.stringify(stdout ?? "")}\n${stderr}`.toLowerCase();
  return [/spec version .+ is not supported/, /upgrade (?:the )?hyperframes cli/, /unknown (?:option|command)/, /command not found|spawn .+ enoent|\benoent\b/, /browser executable .+ not found|failed to launch (?:the )?browser/, /npm err!/]
    .some((pattern) => pattern.test(text)) ? "infrastructure" : "content";
}

function compactError(stdout, stderr) {
  return String(stderr || (typeof stdout === "string" ? stdout : JSON.stringify(stdout ?? ""))).trim().slice(0, 1_000);
}

function parseOutput(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text.slice(0, 40_000); }
}

function sampleTimes(duration) {
  return [.2, .5, .8].map((fraction) => Number((duration * fraction).toFixed(3)));
}

function safeSegment(value) {
  const safe = String(value).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  if (!safe) throw new Error("Candidate verification attempt must have a safe label");
  return safe;
}

function inspectionRoot(shot, format, duration) {
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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function runCommand(command, args, options) {
  return execFileAsync(command, args, { ...options, maxBuffer: 1024 * 1024 * 128 });
}
