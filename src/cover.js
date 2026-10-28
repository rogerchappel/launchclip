// The designed cover: story.cover (kit/core/story.mjs coverStory) rendered on
// its own, in the story's format, brand and style, to video/cover.png. This is
// the thumbnail finish reports and publish.json points at, instead of a frame
// grabbed from the video. Both renderers draw it from the same one-scene story:
// Remotion as a still of that story, HyperFrames as a snapshot of its compiled
// project. The receipt (.launchclip/cover/cover.json) keeps an unchanged cover
// from rendering again.
//
// A short video (90 s or less) whose cover.frame is a time is different: its
// cover is that frame of the finished video (the key shot, already reading
// as the cover), grabbed from the render, so the thumbnail is a real frame
// and the video still opens on its image.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { COVER_STILL, coverFrame, coverStory, resolveStory } from "@launchclip/core/story.mjs";
import { SHORT_VIDEO_SECONDS } from "@launchclip/core/script-formats.mjs";

const execFileAsync = promisify(execFile);

/** Whether a story's cover is a frame of its own video: a short video with a cover.frame time. */
export function coverFromVideo(story) {
  const duration = Number(story?.format?.duration);
  return Boolean(story?.cover) && typeof coverFrame(story) === "number" && duration > 0 && duration <= SHORT_VIDEO_SECONDS;
}

export const COVER_PATH = "video/cover.png";
export const COVER_DIR = ".launchclip/cover";

/**
 * story: the (styled) storyboard with a cover; renderer: "remotion" |
 * "hyperframes"; adapter: that renderer's adapter (src/renderers); compile:
 * the HyperFrames compiler (finish's compileHyperFrames adapter); fingerprint:
 * extra cache input (the kit's hash).
 * → {file, frame, seconds, renderer, cached}
 */
export async function renderCover({ project, story, renderer, adapter, compile, fingerprint = null, force = false, video = null, grab = grabFrame }) {
  const out = path.join(project, COVER_PATH);
  const receiptFile = path.join(project, COVER_DIR, "cover.json");
  if (coverFromVideo(story) && video && existsSync(video)) {
    const at = Math.max(0, Math.min(coverFrame(story), Number(story.format.duration) - 0.05));
    const stat = statSync(video);
    const hash = createHash("sha256").update(JSON.stringify({ video: path.resolve(video), size: stat.size, mtime: stat.mtimeMs, at })).digest("hex");
    const result = { file: COVER_PATH, frame: at, seconds: at, renderer, source: "video" };
    const receipt = await readJson(receiptFile);
    if (!force && receipt?.hash === hash && existsSync(out)) return { ...result, cached: true };
    await mkdir(path.dirname(out), { recursive: true });
    await grab(video, at, out);
    await mkdir(path.dirname(receiptFile), { recursive: true });
    await writeFile(receiptFile, `${JSON.stringify({ hash, ...result }, null, 2)}\n`);
    return { ...result, cached: false };
  }
  const resolved = resolveStory(coverStory(story));
  const hash = createHash("sha256").update(JSON.stringify({ resolved, renderer, fingerprint })).digest("hex");
  const result = { file: COVER_PATH, frame: coverFrame(story), seconds: COVER_STILL.at, renderer };
  const receipt = await readJson(receiptFile);
  if (!force && receipt?.hash === hash && existsSync(out)) return { ...result, cached: true };
  await mkdir(path.dirname(out), { recursive: true });
  if (renderer === "hyperframes") {
    const dir = path.join(project, COVER_DIR, "hyperframes");
    await compile(resolved, { projectDir: dir, sourceDir: project });
    await adapter.still(dir, COVER_STILL.at, out);
  } else {
    // Its own props file: the project's .launchclip/story.resolved.json stays the video's.
    await adapter.still(project, COVER_STILL.at, out, { story: resolved, propsFile: path.join(project, COVER_DIR, "story.resolved.json") });
  }
  await mkdir(path.dirname(receiptFile), { recursive: true });
  await writeFile(receiptFile, `${JSON.stringify({ hash, ...result }, null, 2)}\n`);
  return { ...result, cached: false };
}

async function readJson(file) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; }
}

/** One frame of a video at `at` seconds, as a PNG. */
async function grabFrame(video, at, out) {
  await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(at), "-i", video, "-frames:v", "1", out]);
}
