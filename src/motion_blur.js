import { rename, rm } from "node:fs/promises";
import { spawn } from "node:child_process";

// Real motion blur for a whole render (story.motion.blur): the renderer
// renders `samples` frames per output frame, then each output frame is the
// mean of the sub-frames centred on it, so anything moving fast smears
// along its path and anything still stays sharp. Three samples span 2/3 of
// a frame (a 240° shutter). docs/KIT_CONTRACTS.md, "Motion blur".

export const MOTION_BLUR_DEFAULT_SAMPLES = 3;
export const MOTION_BLUR_SAMPLES = Object.freeze([2, 3, 4]);

/** Sub-frames per output frame for a story (motion.blur true | {samples}), or 0 (off). */
export function motionBlurSamples(story) {
  const blur = story?.motion?.blur;
  if (blur === true) return MOTION_BLUR_DEFAULT_SAMPLES;
  if (blur && typeof blur === "object" && MOTION_BLUR_SAMPLES.includes(blur.samples ?? MOTION_BLUR_DEFAULT_SAMPLES)) return blur.samples ?? MOTION_BLUR_DEFAULT_SAMPLES;
  return 0;
}

/**
 * The ffmpeg filter that blends a render at fps × samples down to fps:
 * tmix averages each frame with the samples - 1 before it, and select keeps
 * the mix whose window is centred on an output frame's time.
 */
export function motionBlurFilter(samples, fps) {
  const centre = Math.floor(samples / 2);
  const weights = Array(samples).fill(1).join(" ");
  return `tmix=frames=${samples}:weights='${weights}',select='eq(mod(n\\,${samples})\\,${centre})',setpts=N/(${fps}*TB)`;
}

/** ffmpeg arguments that blend `input` (rendered at fps × samples) into `output` at fps; audio is copied. */
export function motionBlurArgs(input, output, { samples, fps }) {
  return ["-v", "error", "-y", "-i", input, "-vf", motionBlurFilter(samples, fps), "-r", String(fps), "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", output];
}

/** Blend `input` into `output` in place of a render at fps; `input` is removed. */
export async function blendSubframes(input, output, { samples, fps, ffmpeg = "ffmpeg", run = spawnFfmpeg } = {}) {
  const tmp = `${output}.blur.mp4`;
  await run(ffmpeg, motionBlurArgs(input, tmp, { samples, fps }));
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
