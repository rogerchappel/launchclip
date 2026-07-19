import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { assessCinematicReadiness } from "./production_readiness.js";
import { resolveProductionProfile } from "./production_profiles.js";
import { analyzeProductionAudio, evaluateAudioQuality } from "./render_audio_analysis.js";
import { writeMotionReport } from "./render_motion_analysis.js";
import { runHyperframes } from "./toolchain.js";

const execFileAsync = promisify(execFile);

export async function checkCinematicProject(projectPath, options = {}, adapters = {}) {
  const project = path.resolve(projectPath);
  const html = await readFile(path.join(project, "index.html"), "utf8");
  const duration = positiveNumber(options.duration ?? htmlAttribute(html, "data-duration"), "composition duration");
  const width = positiveNumber(options.width ?? htmlAttribute(html, "data-width"), "composition width");
  const height = positiveNumber(options.height ?? htmlAttribute(html, "data-height"), "composition height");
  const video = projectFile(project, options.video ?? "renders/draft.mp4");
  await access(video);
  const qaDir = projectFile(project, options.qaDir ?? "qa/cinematic");
  await mkdir(qaDir, { recursive: true });

  const verification = adapters.verifyProject
    ? await adapters.verifyProject(project, qaDir, options)
    : await verifyProject(project, qaDir, options, adapters);
  await writeJson(path.join(qaDir, "verification.json"), verification);

  const orientation = height > width ? "portrait" : width > height ? "landscape" : "square";
  const profile = resolveProductionProfile("cinematic", { aspect: { orientation }, durationSeconds: duration });
  const motionPath = path.join(qaDir, "motion.json");
  const motion = await (adapters.writeMotionReport ?? writeMotionReport)(video, motionPath, {
    expected: {
      duration_seconds: duration,
      width,
      height,
      duration_tolerance_seconds: .15,
      maximum_hold_ratio: .8,
      minimum_bursts_per_minute: 20,
      minimum_change_energy_p50: .35,
      minimum_change_energy_p50_by_family: { "developing-card": .15 },
      minimum_flow_velocity_p90: 2,
      maximum_first_motion_seconds: .35,
      hook_window_seconds: profile.craft.hook_window_seconds,
      minimum_hook_events: profile.craft.minimum_hook_material_changes
    }
  }, adapters.motion);

  const audioManifest = await optionalProjectFile(project, options.audioManifest ?? "AUDIO-MANIFEST.json");
  const audio = await (adapters.analyzeProductionAudio ?? analyzeProductionAudio)(video, audioManifest, {
    musicVolume: Number(options.musicVolume ?? .15)
  }, adapters.audio);
  if (options.expectAudio && !audioManifest) {
    audio.expected_audio = true;
    audio.quality = evaluateAudioQuality(audio);
    audio.quality.ok = false;
    audio.quality.findings.unshift({
      category: "audio-manifest",
      severity: "major",
      message: "Audio is expected, but AUDIO-MANIFEST.json is missing; voice, music, and SFX provenance cannot be verified."
    });
  }
  const audioPath = path.join(qaDir, "audio.json");
  await writeJson(audioPath, audio);

  const [concepts, story, narration, critique] = await Promise.all([
    readOptionalJson(projectFile(project, options.concepts ?? "CONCEPTS.json")),
    readOptionalJson(projectFile(project, options.story ?? "STORY.json")),
    readOptionalJson(projectFile(project, options.narration ?? "NARRATION.json")),
    readOptionalJson(projectFile(project, options.critique ?? "qa/critic.json"))
  ]);
  const readinessPath = projectFile(project, options.output ?? "CINEMATIC-READINESS.json");
  const readiness = {
    ...assessCinematicReadiness({
      concepts,
      story,
      narration,
      plan: { format: { duration_seconds: duration, width, height } },
      verification,
      motion,
      audio,
      critique,
      assembly: { fallback_count: 0, fallbacks: [], provenance: "subscription-agent-authored" }
    }),
    profile: { id: profile.id, lane: profile.lane },
    project,
    video,
    receipt: readinessPath
  };
  await writeJson(readinessPath, readiness);
  return {
    stage: "cinematic-check",
    status: readiness.ok ? "ready" : "needs-repair",
    project,
    video,
    qa: qaDir,
    motion: motionPath,
    audio: audioPath,
    readiness: readinessPath,
    gates: readiness.gates,
    blockers: readiness.blockers,
    repair_findings: readiness.repair_findings
  };
}

async function verifyProject(project, qaDir, options, adapters) {
  const run = adapters.run ?? runCommand;
  const checks = {};
  for (const [name, args] of [
    ["lint", ["lint", "--json", project]],
    ["check", ["check", "--json", "--strict", "--snapshots", "--at-transitions", project]]
  ]) {
    try {
      const result = await runHyperframes(run, args, { cwd: project });
      const stdout = parseOutput(result.stdout);
      checks[name] = { ok: structuredOk(stdout), exit_code: Number(result.exitCode ?? result.exit_code ?? 0), stdout, stderr: String(result.stderr ?? "") };
    } catch (error) {
      checks[name] = { ok: false, exit_code: Number(error.code ?? error.exitCode ?? 1), stdout: parseOutput(error.stdout), stderr: String(error.stderr ?? error.message ?? "") };
    }
    await writeJson(path.join(qaDir, `${name}.json`), checks[name]);
  }
  const failed = Object.entries(checks).filter(([, value]) => !value.ok).map(([name]) => name);
  return {
    schema_version: "launchclip.subscription-verification.v1",
    status: failed.length ? "failed" : "passed",
    created_at: new Date().toISOString(),
    checks: Object.fromEntries(Object.entries(checks).map(([name, value]) => [name, { ok: value.ok, exit_code: value.exit_code }])),
    failed
  };
}

function structuredOk(value) {
  if (!value || typeof value !== "object") return false;
  let failed = value.ok === false || Number(value.errorCount ?? value.error_count ?? 0) > 0;
  const visit = (entry) => {
    if (failed || entry == null || typeof entry !== "object") return;
    if (entry.ok === false || Number(entry.errorCount ?? entry.error_count ?? 0) > 0) failed = true;
    if (new Set(["error", "blocking", "fatal"]).has(String(entry.severity ?? "").toLowerCase())) failed = true;
    for (const child of Object.values(entry)) visit(child);
  };
  visit(value);
  return !failed;
}

function htmlAttribute(html, name) {
  return String(html).match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1];
}

function projectFile(project, value) {
  return path.isAbsolute(String(value)) ? path.resolve(String(value)) : path.resolve(project, String(value));
}

async function optionalProjectFile(project, value) {
  const file = projectFile(project, value);
  try { await access(file); return file; } catch { return null; }
}

async function readOptionalJson(file) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function parseOutput(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text.slice(0, 40_000); }
}

function positiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`Missing or invalid ${label}`);
  return number;
}

async function runCommand(command, args, options) {
  return execFileAsync(command, args, { ...options, maxBuffer: 1024 * 1024 * 128 });
}
