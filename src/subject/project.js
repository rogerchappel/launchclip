// Mattes filed in a storyboard project, so base.subject "auto" finds them.
//
// `launchclip subject matte <video> --range a-b --project <dir>` copies the
// cached matte and its subject.json to <dir>/assets/subject/<in>-<out>.{webm,json}
// and records it in assets/subject/mattes.json:
//   {schema: "launchclip.subject-mattes.v1",
//    mattes: [{base: "assets/recording.mp4", src, in, out, info, plate?, contours?}]}
// Every reader of a story (readProjectStory, story commands, layout-check,
// finish) passes the entries for its base to resolveStory as `subject`.
//
// `launchclip subject track <video> --project <dir>` files the whole-video
// head track as assets/subject/track.json (launchclip.subject-track.v1 with
// `base` set); readStoryTrack gives resolveStory its frames as `track`.

import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { subjectMode } from "../../kit/core/story.mjs";
import { validateSubjectTrack } from "../../kit/core/subject.mjs";
import { rangeDirName } from "./stage.js";

export const MATTES_SCHEMA = "launchclip.subject-mattes.v1";
export const MATTES_MANIFEST = "assets/subject/mattes.json";
export const TRACK_FILE = "assets/subject/track.json";
const OUTLINE_STEP = 3;

/**
 * The mattes resolveStory needs for this story's base: for "auto", the ones
 * filed in the project; for explicit mattes, those. Each carries `summary`
 * (framing, head, body, headroom, source size) read from its info file, so
 * modules can place themselves around the presenter. Null for "off" or none.
 */
export async function readStorySubject(project, story) {
  const base = story?.base;
  if (base === undefined || base === null) return null;
  const mode = subjectMode(base);
  if (mode === "off") return null;
  const src = typeof base === "string" ? base : base.src ?? base.source;
  const entries = mode === "mattes"
    ? base.subject.mattes.map((matte) => ({ ...matte }))
    : (await readManifest(project)).mattes.filter((entry) => entry.base === src).map(({ src: file, in: from, out, info, plate, contours }) => ({ src: file, in: from, out, ...(info ? { info } : {}), ...(plate ? { plate } : {}), ...(contours ? { contours } : {}) }));
  for (const entry of entries) {
    if (entry.info && !entry.summary) {
      try {
        const info = JSON.parse(await readFile(path.join(path.resolve(project), entry.info), "utf8"));
        entry.summary = { source: { width: info.source.width, height: info.source.height }, framing: info.framing, head: info.head, body: info.body, headroom: info.headroom };
      } catch { /* a missing info file only costs the summary; layout-check reports it */ }
    }
    // The outline every third frame (doodle-outline boils on threes).
    if (entry.contours && !entry.outline) {
      try {
        const file = JSON.parse(await readFile(path.join(path.resolve(project), entry.contours), "utf8"));
        entry.outline = { frames: file.frames.filter((_, index) => index % OUTLINE_STEP === 0) };
      } catch { /* no outline: doodle-outline draws only its doodles */ }
    }
  }
  return entries.length ? entries : null;
}

/**
 * The head track resolveStory needs for this story's base (its `track`
 * option): {source: {width, height}, fps, frames: [{t, head, body}]}, read
 * from assets/subject/track.json when it was filed for this base. Null for
 * base.subject "off", another base, or no track.
 */
export async function readStoryTrack(project, story) {
  const base = story?.base;
  if (base === undefined || base === null || subjectMode(base) === "off") return null;
  const src = typeof base === "string" ? base : base.src ?? base.source;
  let track;
  try { track = JSON.parse(await readFile(path.join(path.resolve(project), TRACK_FILE), "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`${TRACK_FILE} is not valid JSON: ${error.message}`);
  }
  const { ok, errors } = validateSubjectTrack(track);
  if (!ok) throw new Error(`${TRACK_FILE} is invalid: ${errors.slice(0, 3).join("; ")}`);
  if (track.base !== src) return null;
  return { source: { width: track.source.width, height: track.source.height }, fps: track.fps, frames: track.frames.map(({ t, head, body }) => ({ t, head, body })) };
}

/** File a track result (runSubjectTrack) in the project for `video`. → {base, src} */
export async function fileProjectTrack(project, video, track) {
  const root = path.resolve(project);
  const base = projectAsset(root, video);
  await mkdir(path.join(root, "assets/subject"), { recursive: true });
  await writeFile(path.join(root, TRACK_FILE), `${JSON.stringify({ ...track, base })}\n`);
  return { base, src: TRACK_FILE };
}

function projectAsset(root, video) {
  const base = path.relative(root, path.resolve(video)).split(path.sep).join("/");
  if (base.startsWith("..") || !base.startsWith("assets/")) throw new Error(`--project needs the video inside ${root}/assets (the story's base.src); got ${video}`);
  return base;
}

/**
 * File a matte result (runSubjectMatte) in the project for `video`, which
 * must be a file under the project's assets/. Replaces any filed matte for
 * the same base that overlaps its range. → the manifest entry.
 */
export async function fileProjectMatte(project, video, result) {
  const root = path.resolve(project);
  const base = projectAsset(root, video);
  const name = rangeDirName(result.info.range);
  const src = `assets/subject/${name}.webm`;
  const info = `assets/subject/${name}.json`;
  await mkdir(path.join(root, "assets/subject"), { recursive: true });
  await copyFile(result.matte, path.join(root, src));
  const plate = result.plate && result.info.plate ? `assets/subject/${name}.plate.jpg` : null;
  if (plate) await copyFile(result.plate, path.join(root, plate));
  const contours = result.contours && result.info.contours ? `assets/subject/${name}.contours.json` : null;
  if (contours) await copyFile(result.contours, path.join(root, contours));
  await writeFile(path.join(root, info), `${JSON.stringify({ ...result.info, matte: `${name}.webm`, ...(plate ? { plate: `${name}.plate.jpg` } : {}), ...(contours ? { contours: `${name}.contours.json` } : {}) })}\n`);
  const entry = { base, src, in: result.info.range.in, out: result.info.range.out, info, ...(plate ? { plate } : {}), ...(contours ? { contours } : {}) };
  const manifest = await readManifest(root);
  const kept = manifest.mattes.filter((other) => other.base !== base || other.out <= entry.in || other.in >= entry.out);
  const mattes = [...kept, entry].sort((a, b) => a.base.localeCompare(b.base) || a.in - b.in);
  await writeFile(path.join(root, MATTES_MANIFEST), `${JSON.stringify({ schema: MATTES_SCHEMA, mattes }, null, 2)}\n`);
  return entry;
}

async function readManifest(project) {
  let value;
  try { value = JSON.parse(await readFile(path.join(path.resolve(project), MATTES_MANIFEST), "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return { schema: MATTES_SCHEMA, mattes: [] };
    throw new Error(`${MATTES_MANIFEST} is not valid JSON: ${error.message}`);
  }
  if (value?.schema !== MATTES_SCHEMA || !Array.isArray(value.mattes)) throw new Error(`${MATTES_MANIFEST} must be {schema: "${MATTES_SCHEMA}", mattes: [...]}`);
  return value;
}
