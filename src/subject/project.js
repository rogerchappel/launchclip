// Mattes filed in a storyboard project, so base.subject "auto" finds them.
//
// `launchclip subject matte <video> --range a-b --project <dir>` copies the
// cached matte and its subject.json to <dir>/assets/subject/<in>-<out>.{webm,json}
// and records it in assets/subject/mattes.json:
//   {schema: "launchclip.subject-mattes.v1",
//    mattes: [{base: "assets/recording.mp4", src, in, out, info}]}
// Every reader of a story (readProjectStory, story commands, layout-check,
// finish) passes the entries for its base to resolveStory as `subject`.

import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { subjectMode } from "../../kit/core/story.mjs";
import { rangeDirName } from "./stage.js";

export const MATTES_SCHEMA = "launchclip.subject-mattes.v1";
export const MATTES_MANIFEST = "assets/subject/mattes.json";

/** The project's mattes for this story's base when base.subject is "auto", else null. */
export async function readStorySubject(project, story) {
  const base = story?.base;
  if (base === undefined || base === null || subjectMode(base) !== "auto") return null;
  const src = typeof base === "string" ? base : base.src ?? base.source;
  const manifest = await readManifest(project);
  const entries = manifest.mattes.filter((entry) => entry.base === src).map(({ src: file, in: from, out, info }) => ({ src: file, in: from, out, ...(info ? { info } : {}) }));
  return entries.length ? entries : null;
}

/**
 * File a matte result (runSubjectMatte) in the project for `video`, which
 * must be a file under the project's assets/. Replaces any filed matte for
 * the same base that overlaps its range. → the manifest entry.
 */
export async function fileProjectMatte(project, video, result) {
  const root = path.resolve(project);
  const base = path.relative(root, path.resolve(video)).split(path.sep).join("/");
  if (base.startsWith("..") || !base.startsWith("assets/")) throw new Error(`--project needs the video inside ${root}/assets (the story's base.src); got ${video}`);
  const name = rangeDirName(result.info.range);
  const src = `assets/subject/${name}.webm`;
  const info = `assets/subject/${name}.json`;
  await mkdir(path.join(root, "assets/subject"), { recursive: true });
  await copyFile(result.matte, path.join(root, src));
  await writeFile(path.join(root, info), `${JSON.stringify({ ...result.info, matte: `${name}.webm` })}\n`);
  const entry = { base, src, in: result.info.range.in, out: result.info.range.out, info };
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
