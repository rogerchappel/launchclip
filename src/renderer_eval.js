// Renderer eval (docs/DUAL_RENDERER_PLAN.md, Phase 7; RFC §8): renders every
// golden storyboard with HyperFrames and with Remotion, runs the same media
// gates cinematic-check uses on each MP4, and measures how closely the two
// renderers match, so "the renderers match and both are good" is measured on
// every change instead of asserted.
//
//   npm run eval:renderers [-- --stories a,b] [--quality draft]
//     [--out qa/renderer-eval] [--thresholds eval/renderer-thresholds.json]
//     [--worst 4]
//
// Per story: stage a copy of the project, validate it, run layout-check, then
// per renderer compile, render (timed), probe, motion analysis and audio
// analysis. Across renderers: frame parity (ffmpeg SSIM on frames extracted at
// the temporal-evidence schedule of the derived boundaries, plus a per-frame
// SSIM scan of the whole video), duration, loudness and audio-stream
// comparison. Writes <out>/report.json and <out>/report.md, with a contact
// sheet of the worst-matching frames per story.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { buildTemporalEvidenceSchedule } from "./cinematic_evidence.js";
import { cinematicMotionExpectations } from "./cinematic_check.js";
import { checkLayoutProject } from "./layout_check.js";
import { analyzeProductionAudio } from "./render_audio_analysis.js";
import { writeMotionReport } from "./render_motion_analysis.js";
import { getRenderer, RENDERER_NAMES } from "./renderers/index.js";
import { compileStoryCommand, runStoryCommand } from "./story_cli.js";
import { readProjectStory } from "./story_loader.js";

const execFileAsync = promisify(execFile);
const ROOT = fileURLToPath(new URL("..", import.meta.url));

export const RENDERER_EVAL_VERSION = "launchclip.renderer-eval.v1";
export const DEFAULT_THRESHOLDS_FILE = path.join(ROOT, "eval", "renderer-thresholds.json");
export const DEFAULT_OUT = path.join("qa", "renderer-eval");
export const RENDERERS = RENDERER_NAMES;

// Golden storyboards (RFC §8: they double as renderer regression tests). A
// `dir` is a project with storyboard.json; a `story` is a loose story file
// staged as storyboard.json next to its `narration`.
export const GOLDEN_STORIES = Object.freeze([
  { id: "cooling", story: "examples/story/cooling.story.json", narration: "examples/story/cooling.NARRATION.json" },
  { id: "minimal", dir: "examples/story/minimal" },
  { id: "promo-16x9", dir: "examples/story/promo-16x9" },
  { id: "explainer-9x16", dir: "examples/story/explainer-9x16" },
  { id: "data-story-9x16", dir: "examples/story/data-story-9x16" },
  { id: "world-camera-9x16", dir: "examples/story/world-camera-9x16" }
].map(Object.freeze));

export const DEFAULT_THRESHOLDS = Object.freeze({
  parity: { min_ssim: 0.97, min_ssim_all_frames: null },
  duration: { max_delta_frames: 1 },
  loudness: { max_lufs_delta: 0.5, max_true_peak_delta_db: 1 },
  audio: { require_matching_streams: true, max_offset_ms: null, max_residual_db: null },
  gates: { validate: true, layout: true, compile: true, motion: true, audio: true },
  stories: {}
});

// ---------------------------------------------------------------------------
// Pure helpers: schedule, statistics, thresholds, report shaping

/**
 * Frames to compare: the temporal-evidence schedule (hook, boundary phases,
 * final hold) of the story's derived boundaries, quantised to frame indices.
 * Samples that land on the same frame merge their evidence ids and roles.
 */
export function paritySchedule(format, boundaries = []) {
  const duration = Number(format?.duration);
  const fps = Number(format?.fps);
  if (!(fps > 0)) throw new Error("paritySchedule needs a positive fps");
  const schedule = buildTemporalEvidenceSchedule(duration, boundaries);
  const lastFrame = Math.max(0, Math.round(duration * fps) - 1);
  const byFrame = new Map();
  for (const entry of schedule.entries) {
    const frame = Math.min(lastFrame, Math.max(0, Math.round(entry.at_seconds * fps)));
    const sample = byFrame.get(frame) ?? { frame, at_seconds: round(frame / fps, 4), evidence_ids: [], roles: [], boundary_ids: [] };
    sample.evidence_ids.push(entry.evidence_id);
    if (!sample.roles.includes(entry.role)) sample.roles.push(entry.role);
    if (entry.boundary_id && !sample.boundary_ids.includes(entry.boundary_id)) sample.boundary_ids.push(entry.boundary_id);
    byFrame.set(frame, sample);
  }
  return [...byFrame.values()].sort((a, b) => a.frame - b.frame);
}

export function distribution(values) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const q = (p) => {
    const position = (sorted.length - 1) * p;
    const lower = Math.floor(position), upper = Math.ceil(position);
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
  };
  return { count: sorted.length, min: round(sorted[0], 6), p05: round(q(0.05), 6), median: round(q(0.5), 6), mean: round(sorted.reduce((a, b) => a + b, 0) / sorted.length, 6), max: round(sorted.at(-1), 6) };
}

/** Parity summary of scheduled samples [{frame, at_seconds, ssim, ...}] and an optional full scan [{frame, ssim}]. */
export function summarizeParity(samples, scan = [], { worst = 4, fps = 30 } = {}) {
  const measured = samples.filter((sample) => Number.isFinite(sample.ssim));
  const ranked = [...measured].sort((a, b) => a.ssim - b.ssim || a.frame - b.frame);
  const scanRanked = [...scan].filter((entry) => Number.isFinite(entry.ssim)).sort((a, b) => a.ssim - b.ssim || a.frame - b.frame);
  return {
    sample_count: samples.length,
    min_ssim: measured.length ? ranked[0].ssim : null,
    median_ssim: distribution(measured.map((sample) => sample.ssim))?.median ?? null,
    worst: ranked.slice(0, worst).map(({ frame, at_seconds, ssim, roles, evidence_ids }) => ({ frame, at_seconds, ssim, roles, evidence_ids })),
    all_frames: scanRanked.length ? {
      ...distribution(scanRanked.map((entry) => entry.ssim)),
      worst: scanRanked.slice(0, worst).map((entry) => ({ frame: entry.frame, at_seconds: round(entry.frame / fps, 4), ssim: entry.ssim }))
    } : null
  };
}

/** Thresholds for one story: defaults ← file ← file.stories[id]. */
export function thresholdsFor(thresholds, storyId) {
  const base = mergeDeep(DEFAULT_THRESHOLDS, thresholds ?? {});
  const override = base.stories?.[storyId] ?? {};
  const merged = mergeDeep(base, override);
  delete merged.stories;
  return merged;
}

/**
 * Applies thresholds to one story result. Returns {ok, failures, checks}
 * where each check is {id, ok, renderer?, value?, limit?, message}.
 */
export function evaluateStory(result, thresholds) {
  const t = thresholdsFor(thresholds, result.id);
  const checks = [];
  const add = (id, ok, message, extra = {}) => checks.push({ id, ok: Boolean(ok), message, ...extra });
  // A gate is true (must pass), "report" (measured and shown, never fails the run) or false (skipped).
  const gate = (name, id, ok, message, extra = {}) => { const mode = t.gates[name]; if (mode) add(id, ok, message, mode === "report" ? { ...extra, advisory: true } : extra); };

  if (result.error) add("story", false, `story eval failed: ${result.error}`);
  if (result.validation) gate("validate", "validate", result.validation.status === "passed" && !(result.validation.warnings ?? []).length, result.validation.status === "passed" ? `${(result.validation.warnings ?? []).length} validation warning(s)` : `validation failed: ${(result.validation.errors ?? []).join("; ")}`);
  if (result.layout) gate("layout", "layout", result.layout.errors === 0, `${result.layout.errors} layout error(s)`, { value: result.layout.errors });

  for (const name of RENDERERS) {
    const r = result.renderers?.[name];
    if (!r) continue;
    if (r.error) { add("render", false, `${name}: ${r.error}`, { renderer: name }); continue; }
    gate("compile", "compile", !(r.compile?.placeholders ?? []).length, (r.compile?.placeholders ?? []).length ? `${name} draws placeholders: ${r.compile.placeholders.join("; ")}` : `${name} compiled without placeholders`, { renderer: name });
    if (r.motion) gate("motion", "motion", r.motion.ok, r.motion.ok ? `${name} motion gate passed` : `${name} motion gate: ${r.motion.findings.map((f) => f.message).join(" ")}`, { renderer: name });
    if (r.audio) gate("audio", "audio", r.audio.ok, r.audio.ok ? `${name} audio gate passed` : `${name} audio gate: ${r.audio.findings.map((f) => f.message).join(" ")}`, { renderer: name });
    if (r.probe && result.format) {
      const expected = Math.round(Number(result.format.duration) * Number(result.format.fps));
      const delta = Math.abs(Number(r.probe.frames) - expected);
      add("duration", delta <= t.duration.max_delta_frames, `${name} has ${r.probe.frames} frames; the story has ${expected}`, { renderer: name, value: delta, limit: t.duration.max_delta_frames });
    }
  }

  const c = result.comparison;
  if (c) {
    if (c.frames) add("duration", c.frames.delta <= t.duration.max_delta_frames, `frame counts differ by ${c.frames.delta} (hyperframes ${c.frames.hyperframes}, remotion ${c.frames.remotion})`, { value: c.frames.delta, limit: t.duration.max_delta_frames });
    if (c.parity) {
      const low = (c.parity.samples ?? []).filter((sample) => Number.isFinite(sample.ssim) && sample.ssim < t.parity.min_ssim);
      add("parity", c.parity.min_ssim != null && !low.length, low.length
        ? `${low.length} of ${c.parity.sample_count} samples below SSIM ${t.parity.min_ssim}: ${low.slice(0, 5).map((sample) => `${sample.at_seconds}s=${sample.ssim.toFixed(4)}`).join(", ")}`
        : `min SSIM ${c.parity.min_ssim?.toFixed?.(4) ?? "n/a"} over ${c.parity.sample_count} samples`, { value: c.parity.min_ssim, limit: t.parity.min_ssim });
      if (t.parity.min_ssim_all_frames != null && c.parity.all_frames) add("parity-all-frames", c.parity.all_frames.min >= t.parity.min_ssim_all_frames, `min SSIM over every frame ${c.parity.all_frames.min.toFixed(4)} at ${c.parity.all_frames.worst[0]?.at_seconds}s`, { value: c.parity.all_frames.min, limit: t.parity.min_ssim_all_frames });
    }
    if (c.loudness) {
      if (c.loudness.lufs_delta != null) add("loudness", c.loudness.lufs_delta <= t.loudness.max_lufs_delta, `integrated loudness differs by ${c.loudness.lufs_delta} LU`, { value: c.loudness.lufs_delta, limit: t.loudness.max_lufs_delta });
      if (c.loudness.true_peak_delta_db != null && t.loudness.max_true_peak_delta_db != null) add("true-peak", c.loudness.true_peak_delta_db <= t.loudness.max_true_peak_delta_db, `true peak differs by ${c.loudness.true_peak_delta_db} dB`, { value: c.loudness.true_peak_delta_db, limit: t.loudness.max_true_peak_delta_db });
    }
    if (c.audio) {
      if (t.audio.require_matching_streams) add("audio-stream", c.audio.streams_match, c.audio.streams_match ? "audio streams match" : `audio streams differ: ${c.audio.stream_differences.join("; ")}`);
      if (t.audio.max_offset_ms != null && c.audio.offset_ms != null) add("audio-offset", Math.abs(c.audio.offset_ms) <= t.audio.max_offset_ms, `audio is offset by ${c.audio.offset_ms} ms between renderers`, { value: c.audio.offset_ms, limit: t.audio.max_offset_ms });
      if (t.audio.max_residual_db != null && c.audio.residual_db != null) add("audio-residual", c.audio.residual_db <= t.audio.max_residual_db, `aligned audio residual ${c.audio.residual_db} dB relative to the signal`, { value: c.audio.residual_db, limit: t.audio.max_residual_db });
    }
  }
  const failures = checks.filter((check) => !check.ok && !check.advisory);
  const advisories = checks.filter((check) => !check.ok && check.advisory);
  return { ok: failures.length === 0, failures, advisories, checks };
}

export function speedRatio(result) {
  const hf = result.renderers?.hyperframes?.render_ms;
  const rm = result.renderers?.remotion?.render_ms;
  return hf > 0 && rm > 0 ? round(hf / rm, 2) : null;
}

export function buildReport(stories, { thresholds, quality, startedAt, finishedAt, out, thresholdsFile } = {}) {
  const evaluated = stories.map((story) => ({ ...story, speed_ratio: speedRatio(story), evaluation: evaluateStory(story, thresholds) }));
  const failed = evaluated.filter((story) => !story.evaluation.ok);
  return {
    schema_version: RENDERER_EVAL_VERSION,
    status: failed.length ? "failed" : "passed",
    quality,
    started_at: startedAt ?? null,
    finished_at: finishedAt ?? null,
    out: out ?? null,
    thresholds_file: thresholdsFile ?? null,
    thresholds: mergeDeep(DEFAULT_THRESHOLDS, thresholds ?? {}),
    summary: evaluated.map(summaryRow),
    failed_stories: failed.map((story) => story.id),
    stories: evaluated
  };
}

function summaryRow(story) {
  const parity = story.comparison?.parity;
  const gates = (name) => story.evaluation.checks.filter((check) => check.renderer === name);
  return {
    id: story.id,
    status: story.evaluation.ok ? "passed" : "failed",
    hyperframes_render_s: seconds(story.renderers?.hyperframes?.render_ms),
    remotion_render_s: seconds(story.renderers?.remotion?.render_ms),
    speed_ratio: story.speed_ratio,
    min_ssim: parity?.min_ssim ?? null,
    median_ssim: parity?.median_ssim ?? null,
    worst_at_seconds: (parity?.worst ?? []).map((entry) => entry.at_seconds),
    hyperframes_gates: gateSummary(gates("hyperframes")),
    remotion_gates: gateSummary(gates("remotion")),
    failures: story.evaluation.failures.map((failure) => failure.message),
    advisories: story.evaluation.advisories.map((entry) => entry.message)
  };
}

// "pass", "fail", or "pass (motion: report)" when only report-mode gates miss.
function gateSummary(checks) {
  if (checks.some((check) => !check.ok && !check.advisory)) return "fail";
  const missed = [...new Set(checks.filter((check) => !check.ok).map((check) => check.id))];
  return missed.length ? `pass (${missed.join(", ")}: report)` : "pass";
}

export function rendererEvalExitCode(report) {
  return report?.status === "passed" ? 0 : 1;
}

export function formatSummary(report) {
  const lines = [`renderer eval ${report.status}: ${report.summary.length} stor${report.summary.length === 1 ? "y" : "ies"}, ${report.failed_stories.length} failed`];
  for (const row of report.summary) {
    lines.push(`  ${row.status === "passed" ? "ok  " : "FAIL"} ${row.id.padEnd(18)} min SSIM ${fmt(row.min_ssim, 4)}  median ${fmt(row.median_ssim, 4)}  render hf ${fmt(row.hyperframes_render_s, 1)}s / remotion ${fmt(row.remotion_render_s, 1)}s (×${fmt(row.speed_ratio, 2)})`);
    for (const failure of row.failures) lines.push(`         - ${failure}`);
    for (const note of row.advisories) lines.push(`         · report only: ${note}`);
  }
  if (report.out) lines.push(`report: ${path.join(report.out, "report.md")}`);
  return `${lines.join("\n")}\n`;
}

export function renderMarkdown(report) {
  const out = [];
  out.push("# Renderer eval", "");
  out.push(`Status: **${report.status}** · quality \`${report.quality ?? "draft"}\` · ${report.summary.length} stories · thresholds: min SSIM ${report.thresholds.parity.min_ssim} per sample, duration within ${report.thresholds.duration.max_delta_frames} frame, LUFS within ${report.thresholds.loudness.max_lufs_delta} LU`);
  if (report.started_at) out.push("", `Run ${report.started_at} → ${report.finished_at ?? "?"}`);
  out.push("", "## Summary", "");
  out.push("| Story | HyperFrames render | Remotion render | HF / Remotion | Min SSIM | Median SSIM | Worst at | HF gates | Remotion gates | Result |");
  out.push("| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- |");
  for (const row of report.summary) {
    out.push(`| ${row.id} | ${fmt(row.hyperframes_render_s, 1)} s | ${fmt(row.remotion_render_s, 1)} s | ${fmt(row.speed_ratio, 2)}× | ${fmt(row.min_ssim, 4)} | ${fmt(row.median_ssim, 4)} | ${row.worst_at_seconds.slice(0, 3).map((t) => `${t}s`).join(", ") || "n/a"} | ${row.hyperframes_gates} | ${row.remotion_gates} | ${row.status === "passed" ? "pass" : "**fail**"} |`);
  }
  for (const story of report.stories) {
    out.push("", `## ${story.id}`, "");
    if (story.title) out.push(`${story.title}${story.format ? ` · ${story.format.width}×${story.format.height} · ${story.format.duration} s @ ${story.format.fps} fps` : ""}`, "");
    if (story.error) out.push(`**Eval error:** ${story.error}`, "");
    out.push("| | HyperFrames | Remotion |", "| --- | ---: | ---: |");
    const cell = (name, pick) => { const r = story.renderers?.[name]; if (!r) return "n/a"; if (r.error) return "error"; const value = pick(r); return value == null ? "n/a" : String(value); };
    const row = (label, pick) => out.push(`| ${label} | ${cell("hyperframes", pick)} | ${cell("remotion", pick)} |`);
    row("Compile", (r) => r.compile_ms != null ? `${fmt(r.compile_ms / 1000, 1)} s` : null);
    row("Render", (r) => r.render_ms != null ? `${fmt(r.render_ms / 1000, 1)} s` : null);
    row("Frames", (r) => r.probe?.frames);
    row("Video duration", (r) => r.probe?.video_duration != null ? `${r.probe.video_duration} s` : null);
    row("Integrated loudness", (r) => r.audio?.integrated_lufs != null ? `${r.audio.integrated_lufs} LUFS` : null);
    row("True peak", (r) => r.audio?.true_peak_dbfs != null ? `${r.audio.true_peak_dbfs} dBFS` : null);
    row("Placeholders", (r) => (r.compile?.placeholders ?? []).length);
    row("Motion gate", (r) => r.motion ? (r.motion.ok ? "pass" : `fail (${r.motion.findings.length})`) : null);
    row("Audio gate", (r) => r.audio ? (r.audio.ok ? "pass" : `fail (${r.audio.findings.length})`) : null);
    row("Motion bursts/min", (r) => r.motion?.bursts_per_minute);
    out.push("");
    out.push(`Speed ratio (HyperFrames / Remotion render time): ${fmt(story.speed_ratio, 2)}×. Validation: ${story.validation?.status ?? "n/a"}${story.validation?.warnings?.length ? ` (${story.validation.warnings.length} warnings)` : ""}. Layout-check: ${story.layout ? `${story.layout.status}, ${story.layout.errors} errors` : "n/a"}.`);
    const parity = story.comparison?.parity;
    if (parity) {
      out.push("", `Parity over ${parity.sample_count} scheduled frames: min SSIM ${fmt(parity.min_ssim, 4)}, median ${fmt(parity.median_ssim, 4)}.${parity.all_frames ? ` Every frame: min ${fmt(parity.all_frames.min, 4)} (at ${parity.all_frames.worst[0]?.at_seconds}s), p05 ${fmt(parity.all_frames.p05, 4)}, median ${fmt(parity.all_frames.median, 4)}.` : ""}`);
      if (parity.worst.length) {
        out.push("", "| Worst samples | Frame | SSIM | Roles |", "| --- | ---: | ---: | --- |");
        for (const entry of parity.worst) out.push(`| ${entry.at_seconds} s | ${entry.frame} | ${fmt(entry.ssim, 4)} | ${entry.roles.join(", ")} |`);
      }
      if (parity.contact_sheet) out.push("", `Worst frames, HyperFrames | Remotion | difference ×4, worst first:`, "", `![${story.id} worst frames](${parity.contact_sheet})`);
    }
    const audio = story.comparison?.audio;
    if (audio) out.push("", `Audio: ${audio.present ? `streams ${audio.streams_match ? "match" : `differ (${audio.stream_differences.join("; ")})`}, decoded PCM ${audio.pcm_identical ? "identical" : "differs"}${audio.offset_ms ? `, Remotion offset ${audio.offset_ms} ms from HyperFrames` : ""}${audio.residual_db != null ? `, aligned residual ${audio.residual_db} dB` : ""}` : "no audio in either render"}${story.comparison?.loudness?.lufs_delta != null ? `, loudness delta ${story.comparison.loudness.lufs_delta} LU` : ""}.`);
    if (story.warnings?.length) out.push("", ...story.warnings.map((warning) => `- note: ${warning}`));
    const failures = story.evaluation?.failures ?? [];
    out.push("", failures.length ? `**Failures (${failures.length}):**` : "All thresholds met.");
    for (const failure of failures) out.push(`- ${failure.id}${failure.renderer ? ` (${failure.renderer})` : ""}: ${failure.message}`);
    const advisories = story.evaluation?.advisories ?? [];
    if (advisories.length) out.push("", `Report-only gates that did not pass (${advisories.length}):`, ...advisories.map((entry) => `- ${entry.id}${entry.renderer ? ` (${entry.renderer})` : ""}: ${entry.message}`));
  }
  return `${out.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Media helpers (ffmpeg / ffprobe); each is injectable through adapters.

async function run(command, args, options = {}) {
  return execFileAsync(command, args, { maxBuffer: 1024 * 1024 * 256, ...options });
}

export async function probeVideo(file, { exec = run } = {}) {
  const { stdout } = await exec("ffprobe", ["-v", "error", "-count_frames", "-show_entries", "stream=index,codec_type,codec_name,width,height,r_frame_rate,nb_read_frames,duration,sample_rate,channels:format=duration", "-of", "json", file]);
  const data = JSON.parse(stdout);
  const video = (data.streams ?? []).find((entry) => entry.codec_type === "video");
  const audio = (data.streams ?? []).find((entry) => entry.codec_type === "audio") ?? null;
  if (!video) throw new Error(`no video stream in ${file}`);
  const [num, den] = String(video.r_frame_rate ?? "0/1").split("/").map(Number);
  return {
    width: Number(video.width),
    height: Number(video.height),
    fps: den ? round(num / den, 3) : null,
    frames: Number(video.nb_read_frames),
    video_duration: round(Number(video.duration), 4),
    format_duration: round(Number(data.format?.duration), 4),
    audio: audio ? { codec: audio.codec_name, sample_rate: Number(audio.sample_rate), channels: Number(audio.channels), duration: round(Number(audio.duration), 4) } : null
  };
}

/** Extracts the given frame indices to <dir>/<prefix>-<frame>.png. */
export async function extractFrames(video, frames, dir, prefix, { exec = run } = {}) {
  await mkdir(dir, { recursive: true });
  const unique = [...new Set(frames)].sort((a, b) => a - b);
  const tmp = path.join(dir, `.${prefix}-extract`);
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  const select = unique.map((frame) => `eq(n\\,${frame})`).join("+");
  await exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", video, "-vf", `select=${select}`, "-fps_mode", "passthrough", path.join(tmp, "%05d.png")]);
  const written = (await readdir(tmp)).filter((name) => name.endsWith(".png")).sort();
  if (written.length !== unique.length) throw new Error(`extracted ${written.length} of ${unique.length} frames from ${video}`);
  const files = new Map();
  for (const [index, frame] of unique.entries()) {
    const target = path.join(dir, `${prefix}-${String(frame).padStart(5, "0")}.png`);
    await cp(path.join(tmp, written[index]), target);
    files.set(frame, target);
  }
  await rm(tmp, { recursive: true, force: true });
  return files;
}

export async function ssimPair(a, b, { exec = run } = {}) {
  const { stderr } = await exec("ffmpeg", ["-hide_banner", "-nostats", "-i", a, "-i", b, "-lavfi", "[0:v]format=yuv420p[a];[1:v]format=yuv420p[b];[a][b]ssim", "-f", "null", "-"]);
  const value = Number(/SSIM .*All:([0-9.]+)/.exec(stderr)?.[1]);
  if (!Number.isFinite(value)) throw new Error(`could not read SSIM for ${a} vs ${b}`);
  return value;
}

export function parseSsimStats(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const match = /\bn:(\d+)\b.*\bAll:([0-9.]+)/.exec(line);
    if (match) out.push({ frame: Number(match[1]) - 1, ssim: Number(match[2]) });
  }
  return out;
}

/** Per-frame SSIM over both videos in one pass (ffmpeg ssim stats_file). */
export async function ssimScan(a, b, statsFile, { exec = run } = {}) {
  await mkdir(path.dirname(statsFile), { recursive: true });
  // stats_file takes a filtergraph-escaped path; keep it free of ':' and quotes.
  await exec("ffmpeg", ["-hide_banner", "-nostats", "-loglevel", "error", "-i", a, "-i", b, "-lavfi", `[0:v][1:v]ssim=stats_file=${path.basename(statsFile)}`, "-f", "null", "-"], { cwd: path.dirname(statsFile) });
  return parseSsimStats(await readFile(statsFile, "utf8"));
}

/** One PNG: a row per pair, [HyperFrames | Remotion | difference ×4], each tile `height` px tall. */
export async function contactSheet(pairs, file, { height = 360, exec = run } = {}) {
  if (!pairs.length) return null;
  await mkdir(path.dirname(file), { recursive: true });
  const inputs = [];
  const filters = [];
  pairs.forEach(([a, b], index) => {
    inputs.push("-i", a, "-i", b);
    const ia = index * 2, ib = ia + 1;
    filters.push(`[${ia}:v]format=gbrp,split[a${index}][ad${index}]`, `[${ib}:v]format=gbrp,split[b${index}][bd${index}]`);
    filters.push(`[ad${index}][bd${index}]blend=all_mode=difference,lutrgb=r=val*4:g=val*4:b=val*4[d${index}]`);
    for (const tag of ["a", "b", "d"]) filters.push(`[${tag}${index}]scale=-2:${height},format=rgb24[${tag}s${index}]`);
    filters.push(`[as${index}][bs${index}][ds${index}]hstack=inputs=3[row${index}]`);
  });
  filters.push(pairs.length > 1 ? `${pairs.map((_, index) => `[row${index}]`).join("")}vstack=inputs=${pairs.length}[sheet]` : "[row0]null[sheet]");
  await exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...inputs, "-filter_complex", filters.join(";"), "-map", "[sheet]", "-frames:v", "1", file]);
  return file;
}

/** Decoded-audio comparison: PCM hash equality and residual (a − b) RMS relative to a's RMS. */
export async function compareAudio(a, b, probeA, probeB, { exec = run } = {}) {
  const present = Boolean(probeA?.audio || probeB?.audio);
  if (!present) return { present: false, streams_match: true, stream_differences: [], pcm_identical: true, residual_db: null };
  const differences = [];
  if (!probeA?.audio || !probeB?.audio) differences.push(`audio stream only in ${probeA?.audio ? "hyperframes" : "remotion"}`);
  else for (const key of ["codec", "sample_rate", "channels"]) if (probeA.audio[key] !== probeB.audio[key]) differences.push(`${key} ${probeA.audio[key]} vs ${probeB.audio[key]}`);
  if (differences.length) return { present, streams_match: false, stream_differences: differences, pcm_identical: false, residual_db: null };
  const pcm = async (file) => (await exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", file, "-map", "0:a:0", "-ac", "1", "-ar", "48000", "-f", "s16le", "-"], { encoding: "buffer" })).stdout;
  const [left, right] = await Promise.all([pcm(a), pcm(b)]);
  const hash = (buffer) => createHash("sha256").update(buffer).digest("hex");
  const identical = hash(left) === hash(right);
  if (identical) return { present, streams_match: true, stream_differences: [], pcm_identical: true, offset_ms: 0, residual_db: null };
  const x = toFloat(left), y = toFloat(right);
  const lag = audioOffset(x, y, 48000);
  return {
    present, streams_match: true, stream_differences: [], pcm_identical: false,
    // remotion relative to hyperframes: positive = remotion's audio starts later.
    offset_samples: lag, offset_ms: round(lag / 48, 2),
    residual_db: residualDb(x, y, lag),
    residual_unaligned_db: lag === 0 ? undefined : residualDb(x, y, 0),
    samples: { hyperframes: x.length, remotion: y.length }
  };
}

function toFloat(buffer) {
  const out = new Float32Array(buffer.length >> 1);
  for (let i = 0; i < out.length; i += 1) out[i] = buffer.readInt16LE(i * 2) / 32768;
  return out;
}

/**
 * Lag (in samples, b relative to a) that best aligns two mono signals, within
 * ±maxMs: a coarse cross-correlation on every 8th sample, refined at full rate.
 */
export function audioOffset(a, b, rate = 48000, { maxMs = 100 } = {}) {
  const span = Math.round(rate * maxMs / 1000);
  const n = Math.min(a.length, b.length);
  const correlate = (lag, step) => {
    let sum = 0, na = 0, nb = 0;
    for (let i = span; i < n - span; i += step) { const x = a[i], y = b[i + lag]; sum += x * y; na += x * x; nb += y * y; }
    return na && nb ? sum / Math.sqrt(na * nb) : 0;
  };
  if (n <= 2 * span + 16) return 0;
  let best = 0, score = -Infinity;
  for (let lag = -span; lag <= span; lag += 8) { const value = correlate(lag, 8); if (value > score) { score = value; best = lag; } }
  let refined = best; score = -Infinity;
  for (let lag = Math.max(-span, best - 8); lag <= Math.min(span, best + 8); lag += 1) { const value = correlate(lag, 2); if (value > score) { score = value; refined = lag; } }
  return refined;
}

/** RMS of (a − b shifted by lag) relative to RMS of a, in dB, over the overlap. */
export function residualDb(a, b, lag = 0) {
  let signal = 0, residual = 0;
  const start = Math.max(0, -lag), end = Math.min(a.length, b.length - lag);
  for (let i = start; i < end; i += 1) {
    const x = a[i], y = b[i + lag];
    signal += x * x;
    residual += (x - y) * (x - y);
  }
  if (end <= start || signal === 0) return residual === 0 ? null : 0;
  if (residual === 0) return -Infinity;
  return round(10 * Math.log10(residual / signal), 2);
}

// ---------------------------------------------------------------------------
// Staging

/** Copies a golden story into `project` (a fresh directory) and returns {project, warnings}. */
export async function stageStory(definition, project, { root = ROOT } = {}) {
  await rm(project, { recursive: true, force: true });
  await mkdir(project, { recursive: true });
  const warnings = [];
  let storyFile;
  if (definition.dir) {
    const source = path.resolve(root, definition.dir);
    const skip = new Set(["hyperframes", ".launchclip", "renders", "qa"]);
    await cp(source, project, { recursive: true, filter: (from) => !skip.has(path.relative(source, from).split(path.sep)[0]) });
    storyFile = path.join(project, "storyboard.json");
  } else {
    const source = path.resolve(root, definition.story);
    const story = JSON.parse(await readFile(source, "utf8"));
    const wordsName = typeof story.audio?.words === "string" ? story.audio.words : "NARRATION.json";
    if (definition.narration) await cp(path.resolve(root, definition.narration), path.join(project, wordsName));
    storyFile = path.join(project, "storyboard.json");
    await writeFile(storyFile, `${JSON.stringify(story, null, 2)}\n`);
  }
  // Declared audio that is not shipped (cooling's narration.wav) is dropped
  // from the staged copy, so both renderers render the same silent track.
  const story = JSON.parse(await readFile(storyFile, "utf8"));
  let changed = false;
  for (const key of ["mix", "voice"]) {
    const value = story.audio?.[key];
    if (typeof value === "string" && !existsSync(path.join(project, value))) {
      delete story.audio[key];
      changed = true;
      warnings.push(`audio.${key} ${value} is not shipped with the story; rendered without it`);
    }
  }
  if (changed && story.lane === "voiceover-motion" && !story.audio?.voice) {
    story.lane = "motion";
    warnings.push("lane voiceover-motion staged as motion because its voice file is missing");
  }
  if (changed) await writeFile(storyFile, `${JSON.stringify(story, null, 2)}\n`);
  return { project, storyFile, warnings };
}

// ---------------------------------------------------------------------------
// Orchestration

function defaultAdapters(adapters = {}) {
  return {
    now: adapters.now ?? (() => Date.now()),
    stage: adapters.stage ?? stageStory,
    validate: adapters.validate ?? ((storyFile) => runStoryCommand("validate", storyFile, {})),
    layout: adapters.layout ?? ((project) => checkLayoutProject(project)),
    loadStory: adapters.loadStory ?? (async (project) => {
      const loaded = await readProjectStory(project);
      return { title: loaded.story.title ?? null, format: loaded.format, boundaries: loaded.module.deriveBoundaries(loaded.resolved) };
    }),
    compile: adapters.compile ?? ((name, project) => compileStoryCommand(project, { renderer: name, ...(name === "hyperframes" ? { out: path.join(project, "hyperframes") } : {}) })),
    render: adapters.render ?? ((name, project, outFile, options) => getRenderer(name).render(name === "hyperframes" ? path.join(project, "hyperframes") : project, outFile, options)),
    probe: adapters.probe ?? ((file) => probeVideo(file)),
    motion: adapters.motion ?? ((file, outFile, format) => writeMotionReport(file, outFile, { expected: cinematicMotionExpectations(format).expected })),
    audio: adapters.audio ?? ((file) => analyzeProductionAudio(file, null)),
    extractFrames: adapters.extractFrames ?? extractFrames,
    ssimPair: adapters.ssimPair ?? ssimPair,
    ssimScan: adapters.ssimScan ?? ssimScan,
    contactSheet: adapters.contactSheet ?? contactSheet,
    compareAudio: adapters.compareAudio ?? compareAudio,
    onProgress: adapters.onProgress ?? (() => {})
  };
}

export async function evaluateGoldenStory(definition, options = {}, adapterOverrides = {}) {
  const a = defaultAdapters(adapterOverrides);
  const outDir = path.resolve(options.out ?? DEFAULT_OUT, definition.id);
  const quality = options.quality ?? "draft";
  const worst = Number(options.worst ?? 4);
  const result = { id: definition.id, source: definition.dir ?? definition.story, warnings: [], renderers: {} };
  try {
    await mkdir(outDir, { recursive: true });
    const staged = await a.stage(definition, path.join(outDir, "project"));
    result.warnings.push(...(staged.warnings ?? []));
    const validation = await a.validate(staged.storyFile);
    result.validation = { status: validation.status, errors: validation.errors ?? [], warnings: validation.warnings ?? [] };
    const layout = await a.layout(staged.project);
    result.layout = { status: layout.status, errors: layout.errors, findings: (layout.findings ?? []).filter((finding) => finding.severity === "error") };
    const story = await a.loadStory(staged.project);
    result.title = story.title;
    result.format = story.format;
    result.boundaries = story.boundaries;
    const schedule = paritySchedule(story.format, story.boundaries);

    for (const name of RENDERERS) {
      const entry = {};
      result.renderers[name] = entry;
      try {
        a.onProgress({ story: definition.id, renderer: name, step: "compile" });
        let start = a.now();
        const compiled = await a.compile(name, staged.project);
        entry.compile_ms = a.now() - start;
        const warnings = compiled?.warnings ?? [];
        entry.compile = { warnings, placeholders: warnings.filter((warning) => /rendering a placeholder|would draw a placeholder/.test(warning)) };
        a.onProgress({ story: definition.id, renderer: name, step: "render" });
        const video = path.join(outDir, `${name}.mp4`);
        start = a.now();
        await a.render(name, staged.project, video, { quality });
        entry.render_ms = a.now() - start;
        entry.video = path.relative(outDir, video);
        entry.probe = await a.probe(video);
        a.onProgress({ story: definition.id, renderer: name, step: "analyze" });
        const motion = await a.motion(video, path.join(outDir, name, "motion.json"), story.format);
        entry.motion = { ok: motion.quality?.ok === true, findings: motion.quality?.findings ?? [], bursts_per_minute: motion.motion_bursts_per_minute ?? null, hold_ratio: motion.motion?.hold_ratio ?? null, family: motion.family ?? null };
        const audio = await a.audio(video);
        await writeJsonFile(path.join(outDir, name, "audio.json"), audio);
        entry.audio = { ok: audio.quality?.ok === true, findings: audio.quality?.findings ?? [], integrated_lufs: finiteOrNull(audio.output?.integrated_lufs), true_peak_dbfs: finiteOrNull(audio.output?.true_peak_dbfs), silence_ratio: audio.output?.silence_ratio ?? null };
      } catch (error) {
        entry.error = String(error?.message ?? error).split("\n").slice(0, 6).join("\n");
      }
    }

    const hf = result.renderers.hyperframes, rm = result.renderers.remotion;
    if (hf?.probe && rm?.probe) {
      a.onProgress({ story: definition.id, step: "compare" });
      const hfVideo = path.join(outDir, hf.video), rmVideo = path.join(outDir, rm.video);
      const comparison = {};
      comparison.frames = { hyperframes: hf.probe.frames, remotion: rm.probe.frames, delta: Math.abs(hf.probe.frames - rm.probe.frames) };
      const frames = schedule.map((sample) => sample.frame).filter((frame) => frame < Math.min(hf.probe.frames, rm.probe.frames));
      const framesDir = path.join(outDir, "frames");
      const hfFrames = await a.extractFrames(hfVideo, frames, framesDir, "hyperframes");
      const rmFrames = await a.extractFrames(rmVideo, frames, framesDir, "remotion");
      const samples = [];
      for (const sample of schedule) {
        if (!hfFrames.has(sample.frame) || !rmFrames.has(sample.frame)) { samples.push({ ...sample, ssim: null }); continue; }
        samples.push({ ...sample, ssim: round(await a.ssimPair(hfFrames.get(sample.frame), rmFrames.get(sample.frame)), 6), hyperframes: path.relative(outDir, hfFrames.get(sample.frame)), remotion: path.relative(outDir, rmFrames.get(sample.frame)) });
      }
      const scan = await a.ssimScan(hfVideo, rmVideo, path.join(outDir, "ssim-all-frames.log"));
      const parity = { ...summarizeParity(samples, scan, { worst, fps: story.format.fps }), samples };
      const worstPairs = parity.worst.map((entry) => samples.find((sample) => sample.frame === entry.frame)).filter((sample) => sample?.hyperframes);
      const sheet = await a.contactSheet(worstPairs.map((sample) => [path.join(outDir, sample.hyperframes), path.join(outDir, sample.remotion)]), path.join(outDir, "worst-frames.png"));
      if (sheet) parity.contact_sheet = path.relative(options.reportDir ?? path.dirname(outDir), sheet);
      comparison.parity = parity;
      const lufs = [hf.audio?.integrated_lufs, rm.audio?.integrated_lufs];
      const peaks = [hf.audio?.true_peak_dbfs, rm.audio?.true_peak_dbfs];
      comparison.loudness = {
        hyperframes_lufs: lufs[0], remotion_lufs: lufs[1], lufs_delta: lufs.every(Number.isFinite) ? round(Math.abs(lufs[0] - lufs[1]), 2) : null,
        hyperframes_true_peak: peaks[0], remotion_true_peak: peaks[1], true_peak_delta_db: peaks.every(Number.isFinite) ? round(Math.abs(peaks[0] - peaks[1]), 2) : null
      };
      comparison.audio = await a.compareAudio(hfVideo, rmVideo, hf.probe, rm.probe);
      result.comparison = comparison;
    }
  } catch (error) {
    result.error = String(error?.message ?? error).split("\n").slice(0, 6).join("\n");
  }
  return result;
}

export async function loadThresholds(file = DEFAULT_THRESHOLDS_FILE) {
  if (!file || !existsSync(file)) return structuredClone(DEFAULT_THRESHOLDS);
  const data = JSON.parse(await readFile(file, "utf8"));
  const { schema_version: _schema, description: _description, ...rest } = data;
  return rest;
}

export function selectStories(ids, stories = GOLDEN_STORIES) {
  if (!ids?.length) return [...stories];
  const known = new Map(stories.map((story) => [story.id, story]));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length) throw new Error(`Unknown stor${unknown.length === 1 ? "y" : "ies"} ${unknown.join(", ")}; use ${[...known.keys()].join(", ")}`);
  return ids.map((id) => known.get(id));
}

export async function runRendererEval(options = {}, adapters = {}) {
  const out = path.resolve(options.out ?? DEFAULT_OUT);
  const thresholdsFile = options.thresholdsFile === null ? null : path.resolve(options.thresholdsFile ?? DEFAULT_THRESHOLDS_FILE);
  const thresholds = options.thresholds ?? await loadThresholds(thresholdsFile);
  const stories = selectStories(options.stories, options.goldenStories ?? GOLDEN_STORIES);
  const startedAt = new Date().toISOString();
  await mkdir(out, { recursive: true });
  const results = [];
  for (const definition of stories) results.push(await evaluateGoldenStory(definition, { ...options, out, reportDir: out }, adapters));
  const report = buildReport(results, { thresholds, quality: options.quality ?? "draft", startedAt, finishedAt: new Date().toISOString(), out, thresholdsFile });
  await writeJsonFile(path.join(out, "report.json"), report);
  await writeFile(path.join(out, "report.md"), renderMarkdown(report));
  return report;
}

export function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const [flag, inline] = argv[index].startsWith("--") ? argv[index].split(/=(.*)/s) : [argv[index]];
    const value = () => {
      const next = inline ?? argv[++index];
      if (next == null || next.startsWith("--")) throw new Error(`Missing value for ${flag}`);
      return next;
    };
    if (flag === "--stories" || flag === "--story") options.stories = [...(options.stories ?? []), ...value().split(",").map((id) => id.trim()).filter(Boolean)];
    else if (flag === "--quality") options.quality = value();
    else if (flag === "--out") options.out = value();
    else if (flag === "--thresholds") options.thresholdsFile = value();
    else if (flag === "--worst") options.worst = Number(value());
    else throw new Error(`Unknown renderer-eval option: ${flag}. Use --stories a,b --quality draft --out dir --thresholds file --worst n`);
  }
  return options;
}

// ---------------------------------------------------------------------------

function mergeDeep(base, override) {
  if (!isPlain(base) || !isPlain(override)) return structuredClone(override === undefined ? base : override);
  const out = structuredClone(base);
  for (const [key, value] of Object.entries(override)) out[key] = isPlain(value) && isPlain(out[key]) ? mergeDeep(out[key], value) : structuredClone(value);
  return out;
}
function isPlain(value) { return value != null && typeof value === "object" && !Array.isArray(value); }
function round(value, places = 3) { const factor = 10 ** places; return Math.round(Number(value) * factor) / factor; }
function seconds(ms) { return Number.isFinite(ms) ? round(ms / 1000, 1) : null; }
function finiteOrNull(value) { return Number.isFinite(value) ? value : null; }
function fmt(value, places) { return Number.isFinite(value) ? Number(value).toFixed(places) : "n/a"; }
async function writeJsonFile(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, (key, entry) => (entry === Infinity ? "inf" : entry === -Infinity ? "-inf" : entry), 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let options;
  try { options = parseArguments(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exit(2); }
  runRendererEval(options, {
    onProgress: (event) => process.stderr.write(`[renderer-eval] ${event.story}${event.renderer ? ` ${event.renderer}` : ""}: ${event.step}\n`)
  })
    .then((report) => {
      process.stdout.write(formatSummary(report));
      process.exitCode = rendererEvalExitCode(report);
    })
    .catch((error) => { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 2; });
}
