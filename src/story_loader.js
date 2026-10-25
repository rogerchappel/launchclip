import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { applyProjectStyle } from "./story_style.js";
import { readStorySubject, readStoryTrack } from "./subject/project.js";

// kit/core/story.mjs is the canonical storyboard.json implementation (see
// docs/KIT_CONTRACTS.md). It is loaded lazily so the HyperFrames path keeps
// working without it, and so tests can inject a stub through `storyModule`.
export const DEFAULT_STORY_MODULE = fileURLToPath(new URL("../kit/core/story.mjs", import.meta.url));
const REQUIRED_EXPORTS = ["resolveStory", "deriveBoundaries", "storyFormat"];

// source: undefined (kit/core/story.mjs), a file path or URL, or an already
// imported module object.
export async function loadStoryModule(source) {
  if (source && typeof source === "object" && !(source instanceof URL)) return assertStoryModule(source, "injected story module");
  const file = source instanceof URL ? fileURLToPath(source) : path.resolve(String(source ?? DEFAULT_STORY_MODULE));
  if (!existsSync(file)) {
    throw new Error(`storyboard.json support requires ${path.relative(process.cwd(), file) || file}, which was not found. `
      + "It is the kit/core/story.mjs module from docs/KIT_CONTRACTS.md (resolveStory, deriveBoundaries, storyFormat).");
  }
  return assertStoryModule(await import(pathToFileURL(file).href), file);
}

function assertStoryModule(module, label) {
  const missing = REQUIRED_EXPORTS.filter((name) => typeof module?.[name] !== "function");
  if (missing.length) throw new Error(`${label} is missing story exports: ${missing.join(", ")}`);
  return module;
}

// Exact-case lookup: on case-insensitive file systems a creative STORY.json
// must not be mistaken for the storyboard storyboard.json.
export function hasExactFile(directory, name) {
  try { return readdirSync(path.resolve(directory)).includes(name); }
  catch (error) { if (error.code === "ENOENT" || error.code === "ENOTDIR") return false; throw error; }
}

export function projectHasStory(projectDir) {
  return hasExactFile(projectDir, "storyboard.json");
}

// Reads <project>/storyboard.json and resolves its anchors against NARRATION.json
// words and BEATS.json when present. Returns null when the project has no story.
export async function readProjectStory(projectDir, { storyModule } = {}) {
  const project = path.resolve(projectDir);
  const storyFile = path.join(project, "storyboard.json");
  if (!projectHasStory(project)) return null;
  const module = await loadStoryModule(storyModule);
  // A "style" pack is merged first (src/story_style.js), so every reader sees the same story.
  const styled = await applyProjectStyle(JSON.parse(await readFile(storyFile, "utf8")), { projectDir: project });
  const story = styled.story;
  if (typeof module.validateStory === "function") {
    const validation = module.validateStory(story);
    if (validation && validation.ok === false) throw new Error(`storyboard.json is invalid: ${(validation.errors ?? []).join("; ")}`);
  }
  const [narration, beats] = await Promise.all([
    readOptionalJson(narrationFile(project, story)),
    readOptionalJson(path.join(project, "BEATS.json"))
  ]);
  const words = Array.isArray(narration) ? narration : Array.isArray(narration?.words) ? narration.words : [];
  const edl = await readStoryEdl(project, story);
  // base.subject "auto": the mattes filed in assets/subject/mattes.json.
  const subject = await readStorySubject(project, story);
  // The whole-video head track, assets/subject/track.json.
  const track = await readStoryTrack(project, story);
  const resolved = module.resolveStory(story, { words, beats: beats ?? null, edl, subject, track });
  return { file: storyFile, story, resolved, words, format: module.storyFormat(resolved), module, style: styled.style };
}

// Footage-led: the edit-recording plan named by base.edl (project-relative),
// which resolveStory turns into base.trim. Null when the story names none.
export async function readStoryEdl(project, story) {
  const declared = story?.base && typeof story.base === "object" && typeof story.base.edl === "string" ? story.base.edl : null;
  if (!declared) return null;
  const file = path.resolve(project, declared);
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") throw new Error(`base.edl ${declared} was not found in ${project}; run launchclip edit-recording or point base.edl at its edit-plan.json`);
    throw new Error(`base.edl ${declared} is not valid JSON: ${error.message}`);
  }
}

// The story's own audio.words (project-relative) when set, else NARRATION.json,
// matching `launchclip story` so every command resolves anchors the same way.
export function narrationFile(project, story) {
  const declared = typeof story?.audio?.words === "string" ? path.resolve(project, story.audio.words) : null;
  return declared && existsSync(declared) ? declared : path.join(project, "NARRATION.json");
}

async function readOptionalJson(file) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
