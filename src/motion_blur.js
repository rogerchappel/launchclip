import { readFile, rename, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { MOTION_BLUR_GUARD_FILE, resolveMotionBlur, windowOffsets } from "@launchclip/core/motion-blur.mjs";

// Real motion blur for a whole render (story.motion.blur): the renderer
// renders `rate` sub-frames per output frame, then each output frame is the
// mean of the `samples` sub-frames centred on it, so anything moving fast
// smears along its path and anything still stays sharp. The blend spans
// samples / rate frames (the shutter); over one frame, neighbouring frames
// share sub-frames. The plan: kit/core/motion-blur.mjs. docs/KIT_CONTRACTS.md,
// "Motion blur".

export const MOTION_BLUR_DEFAULT_SAMPLES = 3;
export const MOTION_BLUR_SAMPLES = Object.freeze([2, 3, 4, 5, 6]);
export { MOTION_BLUR_GUARD_FILE };

/** Sub-frames blended per output frame for a story (motion.blur true | {samples, shutter}), or 0 (off). */
export function motionBlurSamples(story) {
  return resolveMotionBlur(story)?.samples ?? 0;
}

/** The renderer's motionBlur option for a story at fps, or null: {samples, rate, shutter, fps}. */
export function motionBlurOptions(story, fps = story?.format?.fps ?? 30) {
  const plan = resolveMotionBlur(story);
  return plan ? { samples: plan.samples, rate: plan.rate, shutter: plan.shutter, fps } : null;
}

// One blend: tmix averages each sub-frame with the samples - 1 before it, and
// select keeps the mix whose window is centred on an output frame's time.
function blendChain(samples, rate, fps) {
  const last = windowOffsets(samples)[1];
  const weights = Array(samples).fill(1).join(" ");
  return `tmix=frames=${samples}:weights='${weights}',select='eq(mod(n\\,${rate})\\,${last})',setpts=N/(${fps}*TB)`;
}

// Runs of guarded frames, [first, last] each.
function frameRuns(frames) {
  const runs = [];
  for (const n of [...new Set(frames)].sort((a, b) => a - b)) {
    const run = runs.at(-1);
    if (run && n === run[1] + 1) run[1] = n;
    else runs.push([n, n]);
  }
  return runs;
}

// eq(n,a)+between(n,b,c)… for a few runs. ffmpeg parses a long sum of
// terms recursively and runs out of memory on a reel's worth of word
// changes, so each overlay takes at most GUARD_RUNS runs.
const GUARD_RUNS = 24;
function frameExpr(runs) {
  return runs.map(([a, b]) => (a === b ? `eq(n\\,${a})` : `between(n\\,${a}\\,${b})`)).join("+");
}

/**
 * The ffmpeg filter that blends a render at fps × rate down to fps (rate
 * defaults to samples: the original one-frame blend). guard {frames, rect}:
 * on those frames the rect (the caption band) comes from the one-frame blend
 * (rate samples), so a heavy shutter never shows two words; the result is
 * then a -filter_complex graph from [0:v] to [v].
 */
export function motionBlurFilter(samples, fps, { rate = samples, guard = null } = {}) {
  const main = blendChain(samples, rate, fps);
  if (!guard?.frames?.length || samples <= rate) return main;
  const { x, y, width, height } = guard.rect;
  // The band fades in over `feather` px at its top and bottom edges, so the
  // swap of blends never shows as a seam.
  const feather = Math.max(1, Math.round(guard.feather ?? height * 0.2));
  const alpha = `a='255*clip(min(Y\\,${height - 1}-Y)/${feather}\\,0\\,1)'`;
  const runs = frameRuns(guard.frames);
  const chunks = Array.from({ length: Math.ceil(runs.length / GUARD_RUNS) }, (_, k) => runs.slice(k * GUARD_RUNS, (k + 1) * GUARD_RUNS));
  const band = `[lc_b]${blendChain(rate, rate, fps)},crop=${width}:${height}:${x}:${y},format=yuva420p,geq=lum='p(X\\,Y)':cb='p(X\\,Y)':cr='p(X\\,Y)':${alpha}${chunks.length > 1 ? `,split=${chunks.length}` : ""}${chunks.map((_, k) => `[lc_g${k}]`).join("")}`;
  const overlays = chunks.map((chunk, k) => `[${k ? `lc_o${k - 1}` : "lc_h"}][lc_g${k}]overlay=${x}:${y}:enable='${frameExpr(chunk)}'[${k === chunks.length - 1 ? "v" : `lc_o${k}`}]`);
  return [`[0:v]split=2[lc_a][lc_b];[lc_a]${main}[lc_h]`, band, ...overlays].join(";");
}

/** ffmpeg arguments that blend `input` (rendered at fps × rate) into `output` at fps; audio is copied. */
export function motionBlurArgs(input, output, { samples, fps, rate = samples, guard = null }) {
  const filter = motionBlurFilter(samples, fps, { rate, guard });
  const graph = filter.startsWith("[0:v]") ? ["-filter_complex", filter, "-map", "[v]", "-map", "0:a?"] : ["-vf", filter];
  return ["-v", "error", "-y", "-i", input, ...graph, "-r", String(fps), "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", output];
}

/** The compiler's guard for a project ({frames, rect}), or null when it wrote none. */
export async function readMotionBlurGuard(projectDir) {
  try {
    const data = JSON.parse(await readFile(path.join(projectDir, MOTION_BLUR_GUARD_FILE), "utf8"));
    return data?.guard?.frames?.length && data.guard.rect ? data.guard : null;
  } catch {
    return null;
  }
}

/** Blend `input` into `output` in place of a render at fps; `input` is removed. */
export async function blendSubframes(input, output, { samples, fps, rate = samples, guard = null, ffmpeg = "ffmpeg", run = spawnFfmpeg } = {}) {
  const tmp = `${output}.blur.mp4`;
  await run(ffmpeg, motionBlurArgs(input, tmp, { samples, fps, rate, guard }));
  await rename(tmp, output);
  if (input !== output) await rm(input, { force: true });
  return output;
}

function spawnFfmpeg(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg motion blur failed (${code}): ${err.slice(-400)}`))));
  });
}
