// The motion curve of a video for calm-cut scoring (docs/PLAN_AND_PACE_RFC.md
// §4.4): grey frames at 12 fps, 160 px wide, streamed into
// kit/core/calm-cut.mjs so an hour of footage never sits in memory.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { CALM_CUT, energyAccumulator, energyAt } from "@launchclip/core/calm-cut.mjs";
import { streamRawFrames } from "./render_look_analysis.js";

const execFileAsync = promisify(execFile);

/** → {fps, values} on the video's clock. mask: overlay boxes in 0–1 of the frame. */
export async function readMotionCurve(videoPath, { mask = [], stream = streamRawFrames } = {}) {
  const probe = JSON.parse((await execFileAsync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", videoPath])).stdout);
  const { width, height } = probe.streams?.[0] ?? {};
  if (!(width > 0 && height > 0)) throw new Error(`no video stream in ${videoPath}`);
  const w = CALM_CUT.shortSide;
  const h = Math.max(2, Math.round((height / width) * w / 2) * 2);
  const energy = energyAccumulator(w, h, { fps: CALM_CUT.fps, mask });
  await stream("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", videoPath, "-vf", `fps=${CALM_CUT.fps},scale=${w}:${h}:flags=area,format=gray`, "-an", "-f", "rawvideo", "pipe:1"], w * h, (frame) => energy.push(frame));
  return energy.result();
}

const VIDEO = /\.(mp4|webm|mov|m4v)$/i;

/**
 * A story-time motion curve from the footage the story plays: each base
 * scene whose params.media is a video, read from its sourceStart. Elsewhere
 * the curve is unknown (null). → {fps, values} or null when no scene plays footage.
 */
export async function storyMotionCurve(resolved, project, { read = readMotionCurve } = {}) {
  const fps = CALM_CUT.fps;
  const duration = Number(resolved.resolved?.duration ?? 0);
  const values = new Array(Math.ceil(duration * fps) + 1).fill(null);
  const curves = new Map();
  let known = false;
  for (const scene of resolved.scenes ?? []) {
    if (Number(scene.track ?? 0) !== 0) continue;
    const media = scene.params?.media;
    const src = typeof media === "string" ? media : media?.src;
    if (typeof src !== "string" || !VIDEO.test(src)) continue;
    if (!curves.has(src)) curves.set(src, await read(path.resolve(project, src)).catch(() => null));
    const curve = curves.get(src);
    if (!curve) continue;
    const from = Number(media.sourceStart ?? 0) - Number(scene.start);
    for (let i = Math.ceil(Number(scene.start) * fps); i <= Math.floor(Number(scene.end) * fps) && i < values.length; i += 1) {
      const e = energyAt(curve, from + i / fps);
      if (e != null) { values[i] = e; known = true; }
    }
  }
  return known ? { fps, values } : null;
}
