import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
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
  const project = path.join(root, "project");
  const compositions = path.join(project, "compositions");
  const assets = path.join(project, "assets");
  const snapshots = path.join(root, "snapshots");
  await rm(root, { recursive: true, force: true });
  await Promise.all([mkdir(compositions, { recursive: true }), mkdir(assets, { recursive: true }), mkdir(snapshots, { recursive: true })]);
  await Promise.all([
    writeFile(path.join(compositions, "shot.html"), `${String(bundle.html).trim()}\n`),
    writeFile(path.join(project, "index.motion.json"), `${JSON.stringify(bundle.motion, null, 2)}\n`),
    writeFile(path.join(project, "index.html"), inspectionRoot(shot, format, duration)),
    copyCandidateAssets(workspace, project, bundle.html)
  ]);

  const run = adapters.run ?? runCommand;
  const check = await capture(run, [
    "check", "--json", "--samples", String(options.samples ?? 9), "--at-transitions",
    "--frame-check", "severity=error;seek=.2,.5,.8;tol=2", project
  ], project);
  const snapshot = check.ok ? await capture(run, [
    "snapshot", "--at", sampleTimes(duration).join(","), "--no-end", "--output", snapshots, "--describe", "false", project
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
  const report = {
    schema_version: "launchclip.frame-candidate-verification.v1",
    shot_id: shot.id,
    attempt,
    status: check.ok && snapshot.ok && !analysisError && !allBlank ? "passed" : "failed",
    check,
    snapshot,
    visual: { ok: frames.length > 0 && !allBlank, all_blank: allBlank, error: analysisError, frames }
  };
  await writeFile(path.join(root, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return {
    ok: report.status === "passed",
    failure_kind: check.failure_kind ?? snapshot.failure_kind ?? (analysisError ? "infrastructure" : allBlank ? "content" : null),
    error: check.error ?? snapshot.error ?? analysisError ?? (allBlank ? "All sampled candidate frames are visually blank" : null),
    report: path.join(root, "report.json"),
    snapshots,
    frames
  };
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
  const sections = [stdout.lint, stdout.runtime, stdout.layout, stdout.motion, stdout.contrast];
  const findings = [
    ...(Array.isArray(stdout.issues) ? stdout.issues : []),
    ...(Array.isArray(stdout.findings) ? stdout.findings : []),
    ...(Array.isArray(stdout.errors) ? stdout.errors : []),
    ...sections.flatMap((section) => [
      ...(Array.isArray(section?.issues) ? section.issues : []),
      ...(Array.isArray(section?.findings) ? section.findings : []),
      ...(Array.isArray(section?.errors) ? section.errors : [])
    ])
  ];
  const blocking = findings.find((entry) => typeof entry === "string" || ["error", "blocking", "fatal"].includes(String(entry?.severity ?? "").toLowerCase()));
  if (stdout.ok !== false && !(Number(stdout.errorCount ?? stdout.error_count ?? 0) > 0) && !blocking) return null;
  return String(typeof blocking === "string" ? blocking : blocking?.message ?? blocking?.code ?? "Candidate check reported an error").slice(0, 1_000);
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
