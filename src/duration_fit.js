// Tooling fits scene lengths: a storyboard that fails because a scene resolves
// shorter than its module allows ("duration must be between 2 and 3600, got
// 1.29") is fixed here instead of spending a model repair on it. The planner
// anchors scenes to narration words it cannot time, so a quick list ("hardwood,
// treated pine, composite") gives shots of about a second, and a repair call
// rarely finds the word that makes the scene long enough.
//
// In order, a short scene: grows into the gap after it (up to the video's end),
// takes time from the next scene on its track while that one keeps its own
// minimum, then does the same backwards. With no room it is merged into the
// neighbour it touches (same module first), which stretches over its time, or,
// with no neighbour, dropped: one shot fewer beats a plan that fails. The
// modules stay strict; this only rewrites the storyboard the planner returned.
//
// The same pass fixes pace errors (paceErrors): a short video's shot under
// SHORT_FORM_HOLD grows the same way, but is never merged or dropped for it.

import { moduleTiming } from "@launchclip/core/modules.mjs";
import { resolveStory } from "@launchclip/core/story.mjs";

// Two wordings: the shared bounds check ("duration must be between 2 and 3600,
// got 1.29") and the title modules' own ("hook-title needs a scene of at least 1.5 s").
const DURATION_ERROR = /^params: scenes\[(\d+)\][^]*?\bduration must be between ([\d.]+) and ([\d.]+), got ([\d.]+)/;
const MINIMUM_ERROR = /^params: scenes\[(\d+)\][^]*?\bneeds a scene of at least ([\d.]+) s/;
// The pace check's wording (paceErrors below): a short video's shot that
// passes so fast it reads as a flicker.
const PACE_ERROR = /^pace: scenes\[(\d+)\][^]*?\bholds ([\d.]+) s; [^]*?\bat least ([\d.]+) s/;
const TOUCH = 0.05;

// A video this long or shorter is short-form: every main shot holds at least
// SHORT_FORM_HOLD, so a quick list becomes one shot whose items build in
// rather than a flicker of 1.5 s cards. The opening hook may be quicker.
export const SHORT_FORM_SECONDS = 90;
export const SHORT_FORM_HOLD = 2.5;

/**
 * Main-track shots of a resolved short video (no recorded base) that pass
 * faster than `hold` seconds, the first one (the hook) aside: one
 * "pace:" error each. Longer videos and footage-led stories get none.
 */
export function paceErrors(resolved, { hold = SHORT_FORM_HOLD, maxDuration = SHORT_FORM_SECONDS } = {}) {
  const total = Number(resolved?.resolved?.duration ?? resolved?.format?.duration);
  if (!(hold > 0) || !Number.isFinite(total) || total > maxDuration || resolved?.base) return [];
  const main = (resolved.scenes ?? [])
    .map((scene, index) => ({ scene, index, start: Number(scene.start), end: Number(scene.end) }))
    .filter(({ scene, start, end }) => (scene.track ?? 0) === 0 && Number.isFinite(start) && Number.isFinite(end))
    .sort((a, b) => a.start - b.start);
  return main.slice(1)
    .filter(({ start, end }) => end - start < hold - 0.005)
    .map(({ scene, index, start, end }) => `pace: scenes[${index}]${scene.id ? ` (${scene.id})` : ""} holds ${round(end - start)} s; in a short video every shot after the hook holds at least ${hold} s: fold a quick list into one shot whose items build in, or give the line more time`);
}

/** The scene-length errors in a list of check errors: [{scene, min, max, got}] (max and got null when the error leaves them out). */
export function durationErrors(errors) {
  const out = [];
  for (const error of errors ?? []) {
    const match = DURATION_ERROR.exec(String(error));
    if (match) {
      const [, scene, min, max, got] = match;
      if (Number(got) < Number(min)) out.push({ scene: Number(scene), min: Number(min), max: Number(max), got: Number(got) });
      continue;
    }
    const titled = MINIMUM_ERROR.exec(String(error));
    if (titled) { out.push({ scene: Number(titled[1]), min: Number(titled[2]), max: null, got: null }); continue; }
    const paced = PACE_ERROR.exec(String(error));
    if (paced) out.push({ scene: Number(paced[1]), min: Number(paced[3]), max: null, got: Number(paced[2]), pace: true });
  }
  return out;
}

/**
 * A copy of the storyboard with each too-short scene lengthened, merged or
 * dropped, the direction map with merged and dropped ids rewritten, and what
 * changed: {storyboard, direction, changed: ["hardwood-board 1.29 → 2.01 s"]}.
 */
export function fitDurations(storyboard, errors, { words = [], beats = null, direction = null } = {}) {
  const found = durationErrors(errors);
  if (!found.length) return { storyboard, direction, changed: [] };
  let resolved;
  try { resolved = resolveStory(structuredClone(storyboard), { words, beats }); } catch { return { storyboard, direction, changed: [] }; }
  const copy = structuredClone(storyboard);
  const total = Number(resolved?.resolved?.duration ?? resolved?.format?.duration);
  const end = Number.isFinite(total) && total > 0 ? total : Infinity;
  // Live times by scene index; tooling writes plain seconds back for every scene it moves.
  const times = (resolved.scenes ?? []).map((scene) => ({ start: Number(scene.start), end: Number(scene.end) }));
  const removed = new Set();
  const renamed = new Map();
  const changed = [];
  const touched = new Set();

  const track = (index) => (Number.isInteger(copy.scenes[index]?.track) ? copy.scenes[index].track : 0);
  // A neighbour lends time only down to its own floor: its module's minimum,
  // and the pace hold when a pace error is being fixed (so fixing one shot
  // never makes the next one flicker).
  const paceHold = Math.max(0, ...found.filter((entry) => entry.pace).map((entry) => entry.min));
  const minimum = (index) => Math.max(Number(moduleTiming(copy.scenes[index]?.module)?.minDuration) || 0, track(index) === 0 ? paceHold : 0);
  const length = (index) => times[index].end - times[index].start;
  const siblings = (index) => times
    .map((time, i) => ({ i, ...time }))
    .filter(({ i, start, end: stop }) => i !== index && !removed.has(i) && track(i) === track(index) && Number.isFinite(start) && Number.isFinite(stop));
  const nextOf = (index) => siblings(index).filter((s) => s.start >= times[index].end - 1e-6).sort((a, b) => a.start - b.start)[0] ?? null;
  const prevOf = (index) => siblings(index).filter((s) => s.end <= times[index].start + 1e-6).sort((a, b) => b.end - a.end)[0] ?? null;

  // Module errors first (a scene the module cannot render), then pace.
  const ordered = [...found.filter((entry) => !entry.pace), ...found.filter((entry) => entry.pace && !found.some((other) => !other.pace && other.scene === entry.scene))];
  for (const { scene: index, min, pace } of ordered) {
    const scene = copy.scenes?.[index];
    if (!scene || removed.has(index) || !times[index] || !Number.isFinite(length(index))) continue;
    const before = length(index);
    // A hair over the minimum, so rounding never lands it back under.
    let need = round(min + 0.01 - before);
    if (need <= 0) continue;
    const plan = [];
    const next = nextOf(index);
    const gapAfter = Math.max(0, (next ? next.start : end) - times[index].end);
    const afterGap = Math.min(need, gapAfter);
    if (afterGap > 0) { plan.push(() => { times[index].end += afterGap; }); need = round(need - afterGap); }
    if (need > 0 && next && next.start - (times[index].end + afterGap) < TOUCH) {
      const slack = Math.max(0, length(next.i) - minimum(next.i) - 0.01);
      const take = Math.min(need, slack);
      if (take > 0) { plan.push(() => { times[index].end += take; times[next.i].start += take; touched.add(next.i); }); need = round(need - take); }
    }
    const prev = prevOf(index);
    let beforeGap = 0;
    if (need > 0) {
      const gapBefore = Math.max(0, times[index].start - (prev ? prev.end : 0));
      beforeGap = Math.min(need, gapBefore);
      if (beforeGap > 0) { const take = beforeGap; plan.push(() => { times[index].start -= take; }); need = round(need - take); }
    }
    if (need > 0 && prev && times[index].start - beforeGap - prev.end < TOUCH) {
      const slack = Math.max(0, length(prev.i) - minimum(prev.i) - 0.01);
      const take = Math.min(need, slack);
      if (take > 0) { plan.push(() => { times[index].start -= take; times[prev.i].end -= take; touched.add(prev.i); }); need = round(need - take); }
    }
    if (need <= 1e-6) {
      for (const step of plan) step();
      touched.add(index);
      changed.push(`${scene.id ?? `scenes[${index}]`} lengthened ${round(before)} → ${round(length(index))} s`);
      continue;
    }
    // A pace fix only lengthens: a shot the module can render is never
    // merged away or dropped for pace (its line would lose its visual).
    if (pace) continue;
    // No room: the touching neighbour (same module first) stretches over it, else it goes.
    const adjacent = [next, prev].filter((s) => s && (Math.abs(s.start - times[index].end) < TOUCH || Math.abs(times[index].start - s.end) < TOUCH));
    const host = adjacent.find((s) => copy.scenes[s.i]?.module === scene.module) ?? adjacent[0] ?? null;
    removed.add(index);
    if (host) {
      times[host.i].start = Math.min(times[host.i].start, times[index].start);
      times[host.i].end = Math.max(times[host.i].end, times[index].end);
      touched.add(host.i);
      const hostId = copy.scenes[host.i]?.id;
      if (scene.id && hostId) renamed.set(scene.id, hostId);
      changed.push(`${scene.id ?? `scenes[${index}]`} (${round(before)} s) merged into ${hostId ?? `scenes[${host.i}]`}`);
    } else {
      if (scene.id) renamed.set(scene.id, null);
      changed.push(`${scene.id ?? `scenes[${index}]`} (${round(before)} s, no room) dropped`);
    }
  }
  if (!changed.length) return { storyboard, direction, changed: [] };
  for (const i of touched) {
    if (removed.has(i)) continue;
    copy.scenes[i].start = round(times[i].start);
    copy.scenes[i].end = round(Math.min(end, times[i].end));
  }
  copy.scenes = copy.scenes.filter((_, i) => !removed.has(i));
  return { storyboard: copy, direction: direction && renamed.size ? renameScenes(direction, renamed) : direction, changed };
}

// Every `scenes: [id…]` list in the direction map, with merged ids pointed at
// their host and dropped ids removed.
function renameScenes(map, renamed) {
  const walk = (value) => {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== "object") return value;
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === "scenes" && Array.isArray(entry) && entry.every((id) => typeof id === "string")) {
        out[key] = [...new Set(entry.map((id) => (renamed.has(id) ? renamed.get(id) : id)).filter(Boolean))];
      } else out[key] = walk(entry);
    }
    return out;
  };
  return walk(map);
}

function round(value) {
  return Math.round(value * 100) / 100;
}
