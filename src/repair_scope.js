// What a repair pass may change. A repair is asked to fix the scenes its
// findings name and keep the rest, and a model that rewrites the whole
// storyboard anyway trades one finding for another (a cue moved in a scene
// nobody complained about, a position changed in a shot that passed). So the
// scenes the findings do not reach keep the params they had: only the scenes
// named in a finding, on a line a finding names, or on screen at a time a
// finding gives are the repair's to redo. Timing stays the repair's
// everywhere (fixing one scene's length moves its neighbours).
//
// When any finding cannot be placed (a cadence band, a weak hook, too many
// cards: the plan as a whole), or a gate's list of findings was cut short,
// the whole storyboard is open and nothing is kept.

import { resolveStory } from "@launchclip/core/story.mjs";

// How far (s) around a finding's words or times a scene still counts as part of it.
const REACH = 0.5;
// Gates whose findings are cut to a number in the checks (src/storyboard_planner.js checkStoryboard): at that number there may be more.
const CUT_SHORT = Object.freeze({ "cast: ": 8, "acting: ": 6, "lip-sync: ": 6 });

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * errors: the previous attempt's findings; storyboard: the storyboard they
 * were found in (after tooling); direction: the map then; words: narration.
 * → {open: Set of scene ids the repair may redo} or {open: null} (everything).
 */
export function repairScope(errors, { storyboard = null, direction = null, words = [], beats = null } = {}) {
  const list = (Array.isArray(errors) ? errors : []).map(String);
  const scenes = (Array.isArray(storyboard?.scenes) ? storyboard.scenes : []).filter((scene) => isObject(scene) && typeof scene.id === "string");
  if (!list.length || !scenes.length) return { open: null };
  for (const [prefix, most] of Object.entries(CUT_SHORT)) if (list.filter((entry) => entry.startsWith(prefix)).length >= most) return { open: null };
  let timed = [];
  try {
    timed = resolveStory(structuredClone(storyboard), { words, beats }).scenes.map((scene) => ({ id: scene.id, start: Number(scene.start), end: Number(scene.end) })).filter((scene) => Number.isFinite(scene.start) && Number.isFinite(scene.end));
  } catch { timed = []; }
  const during = (start, end) => timed.filter((scene) => scene.start < end + REACH && scene.end > start - REACH).map((scene) => scene.id);
  const named = scenes.map((scene) => ({ id: scene.id, pattern: new RegExp(`(^|[^\\w-])${escape(scene.id)}($|[^\\w-])`) }));
  const sections = Array.isArray(direction?.sections) ? direction.sections : [];
  const lineScenes = (line) => {
    if (!isObject(line)) return [];
    const ids = Array.isArray(line.scenes) ? line.scenes.filter((id) => typeof id === "string") : [];
    const [first, last] = Array.isArray(line.words) ? line.words : [];
    const start = Number(words[first]?.start), end = Number(words[last]?.end ?? words[last]?.start);
    return [...ids, ...(Number.isFinite(start) && Number.isFinite(end) ? during(start, end) : [])];
  };
  const open = new Set();
  for (const error of list) {
    const found = named.filter(({ pattern }) => pattern.test(error)).map(({ id }) => id);
    // A direction finding names its line (sections[1] (s2).lines[1]) or its section.
    for (const match of error.matchAll(/sections\[(\d+)\](?: \([^)]*\))?(?:\.lines\[(\d+)\])?/g)) {
      const section = sections[Number(match[1])];
      const lines = !isObject(section) || !Array.isArray(section.lines) ? [] : match[2] === undefined ? section.lines : [section.lines[Number(match[2])]];
      for (const line of lines) found.push(...lineScenes(line));
    }
    // A time or a range of times ("at 18.45–20.3 s", "@3.2s").
    for (const match of error.matchAll(/(\d+(?:\.\d+)?)\s*–\s*(\d+(?:\.\d+)?)\s*s\b/g)) found.push(...during(Number(match[1]), Number(match[2])));
    for (const match of error.matchAll(/@(\d+(?:\.\d+)?)s\b/g)) found.push(...during(Number(match[1]), Number(match[1])));
    if (!found.length) return { open: null };
    for (const id of found) open.add(id);
  }
  return { open };
}

/**
 * previous: the storyboard the repair was shown; repaired: what it returned.
 * A scene of the same id and module outside the scope gets its previous
 * params back. → {storyboard (a copy when anything was kept), kept: [scene ids]}
 */
export function keepUnnamed(previous, repaired, scope) {
  if (!scope?.open || !Array.isArray(previous?.scenes) || !Array.isArray(repaired?.scenes)) return { storyboard: repaired, kept: [] };
  const before = new Map(previous.scenes.filter((scene) => isObject(scene) && typeof scene.id === "string").map((scene) => [scene.id, scene]));
  const kept = [];
  const scenes = repaired.scenes.map((scene) => {
    const was = isObject(scene) ? before.get(scene.id) : null;
    if (!was || scope.open.has(scene.id) || was.module !== scene.module || !isObject(was.params) || JSON.stringify(was.params) === JSON.stringify(scene.params)) return scene;
    kept.push(scene.id);
    return { ...scene, params: structuredClone(was.params) };
  });
  return kept.length ? { storyboard: { ...repaired, scenes }, kept } : { storyboard: repaired, kept: [] };
}
