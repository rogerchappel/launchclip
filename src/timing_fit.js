// Tooling fits timing (docs/LONG_FORM_MAKE_RFC.md, phase 1): a storyboard that
// fails only because a scene's explicit event time sits just outside the
// window its module allows ("params.at must fall between 0.5 s and 1.37 s
// after the scene start; got 0.28 s") is moved to the nearest edge of that
// window by tooling, instead of spending a model repair on a number. The
// modules stay strict; this only rewrites the storyboard the planner returned.
//
// fitSceneTimings is the same repair at finish, once the real narration has
// settled each scene's window: an explicit time the planner set for a longer
// scene ("params.lines[6].at must fall between 0.41 s and 4.28 s ...; got
// 4.97 s") moves into the window the module now allows. It reads the window
// from the module's own error (error.timing), not from the message.

import { resolveModule, sceneRenderEnd } from "@launchclip/core/modules.mjs";

const TIMING_ERROR = /scenes\[(\d+)\][^]*?\b(params(?:\.[A-Za-z_]\w*|\[\d+\])+) must fall between (-?[\d.]+) s and (-?[\d.]+) s after the scene start; got (-?[\d.]+) s/;

/** The fixable timing errors in a list of check errors: [{scene, path, min, max, got}]. */
export function timingErrors(errors) {
  const out = [];
  for (const error of errors ?? []) {
    const match = TIMING_ERROR.exec(String(error));
    if (!match) continue;
    const [, scene, path, min, max, got] = match;
    // An empty window (the scene is too short for the module) has no edge to move to.
    if (Number(min) > Number(max)) continue;
    out.push({ scene: Number(scene), path, min: Number(min), max: Number(max), got: Number(got) });
  }
  return out;
}

/**
 * Callouts with no window at all: the scene is shorter than a callout needs
 * to be read ("params.callouts[0].at must fall between 0 s and -0.33 s").
 * [{scene, index}], each callout once.
 */
export function unfittableCallouts(errors) {
  const out = [];
  for (const error of errors ?? []) {
    const match = TIMING_ERROR.exec(String(error));
    if (!match) continue;
    const [, scene, path, min, max] = match;
    const callout = /^params\.callouts\[(\d+)\]\.at$/.exec(path);
    if (!callout || !(Number(min) > Number(max))) continue;
    if (!out.some((item) => item.scene === Number(scene) && item.index === Number(callout[1]))) out.push({ scene: Number(scene), index: Number(callout[1]) });
  }
  return out;
}

/**
 * A copy of the storyboard with each fixable timing moved into its window,
 * and what moved: {storyboard, moved: ["scene-id params.at 0.28 → 0.5 s"]}.
 * Only explicit numeric params move; a default time is the module's own.
 */
export function fitTimings(storyboard, errors) {
  const found = timingErrors(errors);
  const unfittable = unfittableCallouts(errors);
  if (!found.length && !unfittable.length) return { storyboard, moved: [] };
  const copy = structuredClone(storyboard);
  const moved = [];
  // A callout the scene is too short to show is dropped: the shot plays as
  // plain footage under the line, which beats a plan that can never pass.
  for (const { scene, index } of [...unfittable].sort((a, b) => b.scene - a.scene || b.index - a.index)) {
    const params = copy?.scenes?.[scene]?.params;
    if (!Array.isArray(params?.callouts) || index >= params.callouts.length) continue;
    const [gone] = params.callouts.splice(index, 1);
    if (!params.callouts.length) delete params.callouts;
    const text = typeof gone === "string" ? gone : gone?.text;
    moved.push(`${copy.scenes[scene].id ?? `scenes[${scene}]`} params.callouts[${index}] dropped${text ? ` ("${text}")` : ""}: the scene is too short to read it`);
  }
  for (const { scene, path, min, max } of found) {
    const target = copy?.scenes?.[scene];
    if (!target) continue;
    const keys = path.replace(/\[(\d+)\]/g, ".$1").split(".");
    let holder = target;
    for (const key of keys.slice(0, -1)) holder = holder?.[key];
    const last = keys.at(-1);
    const value = holder?.[last];
    if (typeof value !== "number") continue;
    // A hair inside the edge, so rounding never lands it back outside.
    const inside = max - min < 0.02 ? (min + max) / 2 : Math.min(max - 0.01, Math.max(min + 0.01, value));
    const next = Math.round(inside * 100) / 100;
    if (next === value) continue;
    holder[last] = next;
    moved.push(`${target.id ?? `scenes[${scene}]`} ${path} ${value} → ${next} s`);
  }
  return { storyboard: moved.length ? copy : storyboard, moved };
}

// Each scene's times are fixed one at a time (the module stops at its first
// bad time), so a scene gets at most this many.
const SCENE_TIMING_PASSES = 32;

/**
 * A copy of the storyboard with each explicit event time a resolved scene's
 * module rejects moved into the window the module allows, and what moved:
 * {storyboard, moved: ["hardwood-detail params.lines[6].at 4.97 → 4.27 s"]}.
 * resolved: resolveStory(storyboard, ...) with the final timings. A default
 * time (the module's own) or an empty window (the scene is too short) is
 * left for the checks to report. resolve(scene, resolved) throws a module's
 * error; by default the module is resolved both ways the checks do: to the
 * scene's end (layout check) and to its render end (story validate).
 */
export function fitSceneTimings(storyboard, resolved, { resolve = resolveBothEnds } = {}) {
  if (!Array.isArray(storyboard?.scenes) || !Array.isArray(resolved?.scenes)) return { storyboard, moved: [] };
  const copy = structuredClone(storyboard);
  const live = structuredClone(resolved);
  const byId = new Map(copy.scenes.map((scene) => [scene?.id, scene]));
  const moved = [];
  for (const scene of live.scenes) {
    const target = byId.get(scene?.id);
    if (!target?.module) continue;
    for (let pass = 0; pass < SCENE_TIMING_PASSES; pass += 1) {
      let timing = null;
      try { resolve(scene, live); break; } catch (error) { timing = error?.timing ?? null; }
      if (!timing?.explicit || !(Number(timing.min) <= Number(timing.max)) || typeof timing.path !== "string") break;
      const mine = slot(target, timing.path);
      const theirs = slot(scene, timing.path);
      if (!mine || typeof mine.value !== "number") break;
      const min = Number(timing.min), max = Number(timing.max);
      const inside = max - min < 0.02 ? (min + max) / 2 : Math.min(max - 0.01, Math.max(min + 0.01, mine.value));
      const next = Math.round(inside * 100) / 100;
      if (next === mine.value) break;
      moved.push(`${target.id} ${timing.path} ${mine.value} → ${next} s`);
      mine.set(next);
      theirs?.set(next);
    }
  }
  return { storyboard: moved.length ? copy : storyboard, moved };
}

function resolveBothEnds(scene, resolved) {
  resolveModule(scene, resolved);
  resolveModule(scene, resolved, { end: sceneRenderEnd(resolved, scene) });
}

// The holder of a dotted path ("params.lines[6].at") in a scene: {value, set}.
function slot(scene, path) {
  const keys = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  let holder = scene;
  for (const key of keys.slice(0, -1)) holder = holder?.[key];
  if (!holder || typeof holder !== "object") return null;
  const last = keys.at(-1);
  return { value: holder[last], set: (value) => { holder[last] = value; } };
}
