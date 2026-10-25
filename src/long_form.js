// Long form on a story project (docs/VIDEO_QUALITY_RFC.md §10.2):
//
//   launchclip story long-form <project | storyboard.json> [--narration NARRATION.json] [--dry-run]
//
// Runs the structure pass (kit/core/long-form.mjs structureLongForm) on the
// storyboard and its direction map: chapters from the map's sections, an
// opening promise, a section card at each chapter start and the progress line
// with chapter ticks. It rewrites storyboard.json and DIRECTION.json (unless
// --dry-run) and is safe to run again: what it added last time is replaced.
// The headless planner runs the same pass; the skills run this command.
import { existsSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { directionJson } from "../kit/core/direction.mjs";
import { structureLongForm, youtubeChapterProblems, youtubeChapters } from "../kit/core/long-form.mjs";
import { resolveStory, storyChapters, validateStory } from "../kit/core/story.mjs";
import { directionFileFor } from "./story_cli.js";
import { profileForStory } from "./profile_store.js";
import { resolveStyleV2 } from "./style_store.js";
import { storyStyleRequest } from "../kit/core/style.mjs";

/** The storyboard file a project path or storyboard path names. */
export async function storyFileOf(target) {
  const file = path.resolve(String(target ?? "."));
  return (await stat(file)).isDirectory() ? path.join(file, "storyboard.json") : file;
}

/** The narration words for a story: --narration, else audio.words beside it. → [] when none */
export async function storyWords(story, storyDir, flag = null) {
  const file = flag ? path.resolve(String(flag)) : typeof story?.audio?.words === "string" ? path.resolve(storyDir, story.audio.words) : null;
  if (!file || !existsSync(file)) return { file: null, words: [] };
  const data = JSON.parse(await readFile(file, "utf8"));
  return { file, words: Array.isArray(data) ? data : Array.isArray(data?.words) ? data.words : [] };
}

export async function runLongFormCommand(target, flags = {}) {
  const storyFile = await storyFileOf(target);
  const storyDir = path.dirname(storyFile);
  const story = JSON.parse(await readFile(storyFile, "utf8"));
  const { file: wordsFile, words } = await storyWords(story, storyDir, flags.narration);
  const mapFile = directionFileFor(storyFile);
  const map = existsSync(mapFile) ? JSON.parse(await readFile(mapFile, "utf8")) : null;
  if (!map && !Array.isArray(story.chapters)) throw new Error(`story long-form makes chapters from the direction map's sections; write ${path.relative(process.cwd(), mapFile) || mapFile} first (references/direction-map.md), or give the story "chapters"`);
  // The story's style carries the recurring segment formats (and may carry a profile).
  const request = storyStyleRequest(story);
  const pack = request ? (await resolveStyleV2(request.name, { projectDir: storyDir })).pack : null;
  let profile = null;
  try { profile = profileForStory(story, { direction: map, style: pack, projectDir: storyDir }).profile; } catch { profile = null; }
  const result = structureLongForm(story, { words, map, profile, segments: pack?.segments });
  const check = validateStory(result.story);
  if (!check.ok) throw new Error(`the structured story is invalid:\n- ${check.errors.join("\n- ")}`);
  const duration = Number(result.story.format?.duration);
  const chapters = storyChapters(resolveStory(result.story, { words }));
  const dryRun = Boolean(flags["dry-run"]);
  if (!dryRun) {
    await writeFile(storyFile, `${JSON.stringify(result.story, null, 2)}\n`);
    if (result.map) await writeFile(mapFile, directionJson(result.map));
  }
  return {
    stage: "story",
    action: "long-form",
    status: dryRun ? "planned" : "written",
    story: storyFile,
    direction: result.map ? mapFile : null,
    narration: wordsFile,
    chapters: chapters.map(({ id, title, start, end }) => ({ id, title, start, end })),
    youtube: youtubeChapters(chapters).trimEnd().split("\n"),
    youtube_problems: youtubeChapterProblems(chapters, duration),
    added: result.added,
    changed: result.changed,
    resets: result.resets,
    segments: result.segments,
    warnings: [...result.warnings, ...check.warnings]
  };
}
