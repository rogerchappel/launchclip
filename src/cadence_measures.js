// Cadence measures for renders and references (docs/VIDEO_QUALITY_RFC.md §5.2).
//
//   renderMeasures(resolved, motion, {sections, face})  → measures of our own
//     render: exact coverage, face time and undressed runs from the resolved
//     storyboard (kit/core/cadence.mjs), motion measures from the motion report.
//   measureReference(video, options, adapters)          → estimated measures of
//     a reference video: pacing and motion from src/render_motion_analysis.js,
//     coverage from persistent designed regions in sampled frames, face time
//     from the presenter probe when its model is available.
//   aggregateMeasures(list)                             → {measure: {p10, p50, p90}}
//   measureProfile(folder, options, adapters)           → a measured
//     launchclip.cadence-profile.v1 (src/profile_cli.js `profile measure`).
//
// Only numbers leave this file: a reference's frames are read into memory to
// measure them and are never written (RFC §5.4).
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { distribution, storyboardMeasures } from "@launchclip/core/cadence.mjs";
import { CADENCE_PROFILE_SCHEMA, PROFILE_MEASURES, REFERENCE_RIGHTS, percentiles, validateProfile } from "@launchclip/core/profiles.mjs";
import { analyzeRenderMotion, hookEventSeconds } from "./render_motion_analysis.js";

const execFileAsync = promisify(execFile);
export const REFERENCE_VIDEO = /\.(mp4|mov|m4v|webm|mkv)$/i;
// Hook window for hook_events, as the cinematic profiles use.
const HOOK_WINDOW_SECONDS = 4;

/** Motion measures from a render-motion report (src/render_motion_analysis.js). */
export function motionMeasures(motion) {
  if (!motion) return {};
  const bursts = (motion.motion?.bursts ?? []).map((entry) => Number(entry.start_seconds)).filter(Number.isFinite).sort((a, b) => a - b);
  return {
    flow_velocity_p90: numberOrNull(motion.optical_flow?.velocity_pixels_per_second?.p90),
    hold_ratio: numberOrNull(motion.motion?.hold_ratio),
    motion_bursts_per_min: numberOrNull(motion.motion_bursts_per_minute),
    change_energy_p50: numberOrNull(motion.motion?.change_energy?.p50),
    first_motion_seconds: bursts.length ? round(bursts[0]) : null,
    hook_events: hookEventSeconds(motion, HOOK_WINDOW_SECONDS).length
  };
}

/** Measures of one of our renders: the storyboard's exact numbers plus the motion report's. */
export function renderMeasures(resolved, motion = null, options = {}) {
  const exact = storyboardMeasures(resolved, options);
  return { ...exact, ...motionMeasures(motion), source: "storyboard" };
}

// ---------------------------------------------------------------------------
// References

/**
 * Estimated measures of one reference video. options: {fps (frame sample
 * rate for coverage, default 1), width (default 96)}. adapters: {motion(file),
 * frames(file, {fps, width}) → {frames, fps, duration}, face(file) → share or
 * null}. Returns {file, sha256, duration_seconds, width, height, measures,
 * notes}; measures that cannot be estimated are left out.
 */
export async function measureReference(file, options = {}, adapters = {}) {
  const resolved = path.resolve(file);
  if (!existsSync(resolved)) throw new Error(`Reference not found: ${file}`);
  const notes = [];
  const motion = await (adapters.motion ?? ((video) => analyzeRenderMotion(video)))(resolved);
  const duration = Number(motion.duration_seconds);
  const cuts = (motion.cuts ?? []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const shots = [];
  const edges = [0, ...cuts, duration];
  for (let i = 1; i < edges.length; i += 1) if (edges[i] > edges[i - 1]) shots.push(edges[i] - edges[i - 1]);
  const bursts = (motion.motion?.bursts ?? []).map((entry) => Number(entry.start_seconds)).filter(Number.isFinite);
  const changes = mergeTimes([...cuts, ...bursts], 0.25);
  const measures = {
    shot_seconds: distribution(shots).p50,
    visual_changes_per_min: duration > 0 ? round((changes.length / duration) * 60, 2) : null,
    ...motionMeasures(motion)
  };
  const sampled = await (adapters.frames ?? sampleFrameStrip)(resolved, { fps: options.fps ?? 1, width: options.width ?? 96 });
  const graphic = sampled.frames.map((frame) => isDesignedFrame(frame));
  if (graphic.length) {
    const step = 1 / sampled.fps;
    const runs = runsOf(graphic, step);
    measures.coverage = round(graphic.filter(Boolean).length / graphic.length, 4);
    measures.longest_undressed_seconds = round(runs.filter((run) => !run.on).reduce((max, run) => Math.max(max, run.length), 0));
    const first = graphic.indexOf(true);
    measures.first_visual_seconds = first < 0 ? null : round(first * step);
    const holds = runs.filter((run) => run.on).map((run) => run.length);
    if (holds.length) measures.text_hold_seconds = distribution(holds).p50;
    notes.push("coverage, undressed runs and holds are estimated from designed regions in sampled frames");
  }
  if (adapters.face !== null) {
    try {
      const share = await (adapters.face ?? probeFaceTime)(resolved);
      if (Number.isFinite(share)) measures.face_time = round(share, 4);
    } catch (error) {
      notes.push(`face time not measured (${String(error?.message ?? error).split("\n")[0]})`);
    }
  }
  for (const [key, value] of Object.entries(measures)) if (value === null || value === undefined) delete measures[key];
  return { file: resolved, name: path.basename(resolved), sha256: await sha256(resolved), duration_seconds: round(duration), width: Number(motion.width) || null, height: Number(motion.height) || null, measures, notes };
}

/**
 * p10/p50/p90 across references for every measure at least one reference
 * has. A reference contributes one value per measure.
 */
export function aggregateMeasures(references) {
  const values = {};
  for (const reference of references) for (const [name, value] of Object.entries(reference.measures ?? {})) {
    if (!PROFILE_MEASURES[name] || !Number.isFinite(value)) continue;
    (values[name] ??= []).push(value);
  }
  const out = {};
  for (const name of Object.keys(PROFILE_MEASURES)) {
    if (!values[name]?.length) continue;
    const band = percentiles(values[name]);
    // A share stays a share once rounded.
    if (PROFILE_MEASURES[name].unit === "share") for (const key of Object.keys(band)) band[key] = Math.min(1, band[key]);
    out[name] = band;
  }
  return out;
}

/**
 * Measure a folder of references into a profile. options: {id, rights (own |
 * licensed | public-statistics: required, it is the right we have to analyse
 * every reference in the folder), base (a profile whose id, format, match and
 * duration range the measured one keeps), title, format, now}. adapters as
 * measureReference.
 * → {profile, references: [{name, duration_seconds, measures, notes}], warnings}
 */
export async function measureProfile(folder, options = {}, adapters = {}) {
  const dir = path.resolve(folder);
  if (!(await stat(dir).catch(() => null))?.isDirectory()) throw new Error(`profile measure needs a folder of reference videos; ${folder} is not a folder`);
  if (!REFERENCE_RIGHTS.includes(options.rights)) throw new Error(`profile measure needs --rights ${REFERENCE_RIGHTS.join(" | ")}: only videos we have the right to analyse are measured, and only their statistics are kept`);
  const files = (await readdir(dir)).filter((name) => REFERENCE_VIDEO.test(name)).sort();
  if (!files.length) throw new Error(`${folder} has no reference videos (.mp4, .mov, .m4v, .webm, .mkv)`);
  const base = options.base ?? null;
  const id = options.id ?? base?.id;
  if (!id) throw new Error("profile measure needs --id <profile-id> (or --replace <shipped-profile>)");
  const warnings = [];
  const references = [];
  for (const name of files) {
    const reference = await measureReference(path.join(dir, name), options, adapters);
    references.push(reference);
    warnings.push(...reference.notes.filter((note) => note.startsWith("face time")).map((note) => `${name}: ${note}`));
  }
  const measured = aggregateMeasures(references);
  // Measures the references could not estimate keep the base profile's band.
  const measures = { ...(base?.measures ?? {}), ...measured };
  const kept = Object.keys(base?.measures ?? {}).filter((name) => !(name in measured));
  if (kept.length) warnings.push(`kept the base profile's band for ${kept.join(", ")} (not measurable from pixels)`);
  const durations = references.map((reference) => reference.duration_seconds).filter(Number.isFinite);
  const measuredAt = (options.now ?? (() => new Date().toISOString()))();
  const profile = {
    schema: CADENCE_PROFILE_SCHEMA,
    id,
    title: options.title ?? base?.title ?? id,
    ...(base?.description ? { description: base.description } : {}),
    format: options.format ?? base?.format ?? "footage-led",
    ...(base?.match ? { match: base.match } : {}),
    duration_seconds: base?.duration_seconds ?? [Math.floor(Math.min(...durations)), Math.ceil(Math.max(...durations)) + 1],
    references: references.length,
    provenance: {
      kind: "measured",
      tool: "launchclip profile measure",
      measured_at: measuredAt,
      note: `Measured from ${references.length} reference video${references.length === 1 ? "" : "s"} (${options.rights}). Only statistics are stored; coverage is estimated from pixels.`,
      sources: references.map((reference, index) => ({ id: `ref-${String(index + 1).padStart(2, "0")}`, title: reference.name, rights: options.rights, sha256: reference.sha256, duration_seconds: reference.duration_seconds, ...(reference.width ? { width: reference.width, height: reference.height } : {}), measured_at: measuredAt }))
    },
    measures
  };
  const check = validateProfile(profile);
  if (!check.ok) throw new Error(`the measured profile is invalid:\n- ${check.errors.join("\n- ")}`);
  return { profile, references: references.map(({ name, duration_seconds, measures: values, notes }) => ({ name, duration_seconds, measures: values, notes })), warnings: [...warnings, ...check.warnings] };
}

// ---------------------------------------------------------------------------
// Frame heuristics (approximate; RFC §14 question 2)

/**
 * Whether a sampled rgb24 frame shows a designed graphic: enough cells that
 * are perfectly flat fills (real footage carries sensor noise and gradients)
 * or crisp two-tone text, outside the bottom caption band.
 */
export function isDesignedFrame(frame, { cell = 8, share = 0.12 } = {}) {
  const { width, height, data } = frame;
  const captionTop = Math.floor(height * 0.7), captionBottom = Math.ceil(height * 0.94);
  let cells = 0, designed = 0;
  for (let y0 = 0; y0 + cell <= height; y0 += cell) {
    if (y0 + cell > captionTop && y0 < captionBottom) continue;
    for (let x0 = 0; x0 + cell <= width; x0 += cell) {
      cells += 1;
      let sum = 0, sumSq = 0, n = 0, dark = 0, light = 0;
      for (let y = y0; y < y0 + cell; y += 1) for (let x = x0; x < x0 + cell; x += 1) {
        const i = (y * width + x) * 3;
        const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        sum += luma; sumSq += luma * luma; n += 1;
        if (luma < 60) dark += 1; else if (luma > 195) light += 1;
      }
      const mean = sum / n;
      const sd = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
      const flat = sd < 1.5;
      const text = sd > 50 && dark + light > n * 0.85;
      if (flat || text) designed += 1;
    }
  }
  return cells > 0 && designed / cells >= share;
}

/** Frames at `fps` as {width, height, data} rgb24, from one ffmpeg call. */
export async function sampleFrameStrip(file, { fps = 1, width = 96 } = {}) {
  const probe = JSON.parse((await execFileAsync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file], { maxBuffer: 1024 * 1024 })).stdout);
  const stream = probe.streams?.[0];
  if (!stream?.width) throw new Error(`${file} has no video stream`);
  const height = Math.max(2, Math.round((width * stream.height) / stream.width / 2) * 2);
  const { stdout } = await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", file, "-vf", `fps=${fps},scale=${width}:${height}:flags=area,format=rgb24`, "-f", "rawvideo", "pipe:1"], { maxBuffer: 1024 * 1024 * 512, encoding: "buffer" });
  const size = width * height * 3;
  const frames = [];
  for (let offset = 0; offset + size <= stdout.length; offset += size) frames.push({ width, height, data: stdout.subarray(offset, offset + size) });
  return { frames, fps, duration: Number(probe.format?.duration ?? frames.length / fps) };
}

// Face time from the presenter probe: the share of probe samples with a head.
async function probeFaceTime(file) {
  const { runSubjectProbe } = await import("./subject/stage.js");
  const { probe } = await runSubjectProbe(file, { download: false });
  return faceShareFromProbe(probe);
}

/** The share of probe samples ({head}) with a head found. */
export function faceShareFromProbe(probe) {
  const samples = Array.isArray(probe?.samples) ? probe.samples : [];
  if (!samples.length) return null;
  return samples.filter((sample) => sample?.head).length / samples.length;
}

/**
 * Face-visible intervals on the source timeline from probe samples ({t,
 * head}): each sample stands for the time until the next one.
 */
export function faceIntervalsFromProbe(probe) {
  const samples = (Array.isArray(probe?.samples) ? probe.samples : []).filter((sample) => Number.isFinite(Number(sample?.t))).sort((a, b) => a.t - b.t);
  const duration = Number(probe?.source?.duration);
  const out = [];
  samples.forEach((sample, index) => {
    if (!sample.head) return;
    const end = index + 1 < samples.length ? samples[index + 1].t : Number.isFinite(duration) ? duration : sample.t + 1;
    out.push({ start: sample.t, end });
  });
  return out;
}

function runsOf(flags, step) {
  const runs = [];
  for (const flag of flags) {
    if (runs.length && runs.at(-1).on === flag) runs.at(-1).length += step;
    else runs.push({ on: flag, length: step });
  }
  return runs;
}

function mergeTimes(times, gap) {
  const sorted = times.filter(Number.isFinite).sort((a, b) => a - b);
  const out = [];
  for (const t of sorted) if (!out.length || t - out.at(-1) > gap) out.push(t);
  return out;
}

async function sha256(file) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => createReadStream(file).on("data", (chunk) => hash.update(chunk)).on("end", resolve).on("error", reject));
  return hash.digest("hex");
}

function numberOrNull(value) {
  const number = Number(value);
  return value === null || value === undefined || !Number.isFinite(number) ? null : round(number, 4);
}

function round(value, places = 3) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
