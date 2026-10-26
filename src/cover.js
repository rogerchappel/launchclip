// The designed cover: story.cover (kit/core/story.mjs coverStory) rendered on
// its own, in the story's format, brand and style, to video/cover.png. This is
// the thumbnail finish reports and publish.json points at, instead of a frame
// grabbed from the video. Both renderers draw it from the same one-scene story:
// Remotion as a still of that story, HyperFrames as a snapshot of its compiled
// project. The receipt (.launchclip/cover/cover.json) keeps an unchanged cover
// from rendering again.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { COVER_STILL, coverFrame, coverStory, resolveStory } from "../kit/core/story.mjs";

export const COVER_PATH = "video/cover.png";
export const COVER_DIR = ".launchclip/cover";

/**
 * story: the (styled) storyboard with a cover; renderer: "remotion" |
 * "hyperframes"; adapter: that renderer's adapter (src/renderers); compile:
 * the HyperFrames compiler (finish's compileHyperFrames adapter); fingerprint:
 * extra cache input (the kit's hash).
 * → {file, frame, seconds, renderer, cached}
 */
export async function renderCover({ project, story, renderer, adapter, compile, fingerprint = null, force = false }) {
  const resolved = resolveStory(coverStory(story));
  const out = path.join(project, COVER_PATH);
  const receiptFile = path.join(project, COVER_DIR, "cover.json");
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
