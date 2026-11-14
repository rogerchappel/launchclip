// Take moves: a talking-head recording should not sit still.
//
// A planner asked for one or two punch-ins leaves the take locked for most
// of a short, which reads as unedited. After the plan passes, every stretch
// where the presenter is on screen with no camera move for longer than
// TAKE_MOVES.hold gets punch-ins (the punch-in module: a camera on the base,
// not an overlay), each starting on a phrase's first word, alternating two
// scales, with plain take between them, so the picture changes every few
// seconds without a cut.
//
//   addTakeMoves(storyboard, {words, beats, duration, pace}) → {storyboard, added: [ids]}
//
// Left alone: inserts and insert sections (the presenter is not on screen),
// close-up sections and the planner's own camera moves, plus a margin around
// each; a stretch too short to hold a move.

import { CAMERA_ONLY_MODULES } from "@launchclip/core/cadence.mjs";
import { resolveStory } from "@launchclip/core/story.mjs";
import { presenterHead } from "./presenter_box.js";

export const TAKE_MOVES = Object.freeze({
  // The longest the take may sit with no camera move (seconds).
  hold: 3.5,
  // Plain take before a move, and how long a move holds (seconds).
  plain: 2.2,
  move: 2.6,
  // The shortest move worth making, and its spring back at the end.
  min: 1.4,
  release: 0.4,
  // Kept clear of a cut, an insert or another camera move.
  margin: 0.4,
  // A move starts on a word at most this far from where the rhythm puts it.
  snap: 0.6,
  scales: Object.freeze([1.12, 1.18])
});
// pace (make --pace): calm leaves longer holds, fast shorter ones.
const PACE = Object.freeze({ calm: 1.5, standard: 1, fast: 0.8 });

const EPS = 1e-6;
const round3 = (value) => Math.round(value * 1000) / 1000;

/** Word starts a move may begin on: a phrase's first word (after punctuation or a pause) first, any word otherwise. */
function wordStarts(words) {
  const starts = [];
  for (const [index, word] of words.entries()) {
    const start = Number(word?.start);
    if (!Number.isFinite(start)) continue;
    const previous = words[index - 1];
    const phrase = !previous || /[.!?,;:]$/.test(String(previous.text ?? "").trim()) || start - Number(previous.end) > 0.25 || Number(previous.end) - Number(previous.start) > 0.9;
    starts.push({ at: start, phrase });
  }
  return starts;
}

function snapped(at, starts, from, to) {
  const near = starts.filter((entry) => Math.abs(entry.at - at) <= TAKE_MOVES.snap && entry.at >= from - EPS && entry.at <= to + EPS);
  const pick = (list) => list.reduce((best, entry) => (!best || Math.abs(entry.at - at) < Math.abs(best.at - at) ? entry : best), null);
  return (pick(near.filter((entry) => entry.phrase)) ?? pick(near))?.at ?? at;
}

/**
 * The storyboard with punch-ins added where the take would sit still.
 * options: {words, beats, duration, pace: calm | standard | fast}.
 * → {storyboard, added: [scene ids]}; the storyboard is returned as it was when nothing is added.
 */
export function addTakeMoves(storyboard, { words = [], beats = null, duration = null, pace = "standard" } = {}) {
  if (!storyboard || storyboard.lane !== "footage-led" || !storyboard.base) return { storyboard, added: [] };
  let resolved;
  try { resolved = resolveStory(structuredClone(storyboard), { words, beats }); } catch { return { storyboard, added: [] }; }
  const total = Number(duration ?? resolved.resolved?.duration ?? resolved.format?.duration);
  if (!(total > 0)) return { storyboard, added: [] };
  const factor = PACE[pace] ?? 1;
  const hold = TAKE_MOVES.hold * factor, plain = TAKE_MOVES.plain * factor, move = TAKE_MOVES.move * factor;
  // Where a move has no place: the presenter is off screen, or the camera is already moving or held close.
  const busy = [
    ...resolved.scenes.filter((scene) => scene.insert === true || CAMERA_ONLY_MODULES.includes(scene.module)).map((scene) => [Number(scene.start), Number(scene.end)]),
    ...(resolved.sections ?? []).filter((section) => section.layout === "insert" || (section.layout === "full" && Number(section.zoom) > 1)).map((section) => [Number(section.start), Number(section.end)])
  ].filter(([start, end]) => Number.isFinite(start) && end > start).map(([start, end]) => [start - TAKE_MOVES.margin, end + TAKE_MOVES.margin]).sort((a, b) => a[0] - b[0]);
  const free = [];
  let clock = 0;
  for (const [start, end] of busy) { if (start > clock + EPS) free.push([clock, start]); clock = Math.max(clock, end); }
  if (total > clock + EPS) free.push([clock, total]);

  const starts = wordStarts(words);
  const copy = structuredClone(storyboard);
  const track = Math.max(0, ...copy.scenes.map((scene) => Number(scene.track ?? 0)).filter(Number.isFinite)) + 1;
  const canvas = { width: Number(resolved.format.width), height: Number(resolved.format.height) };
  const taken = new Set(copy.scenes.map((scene) => scene.id));
  const added = [];
  let turn = 0;
  for (const [from, to] of free) {
    if (to - from <= hold + EPS) continue;
    let at = from + plain;
    while (to - at >= TAKE_MOVES.min + TAKE_MOVES.margin - EPS) {
      const start = round3(Math.max(from, snapped(at, starts, from, to - TAKE_MOVES.min)));
      const end = round3(Math.min(to - TAKE_MOVES.margin, start + move));
      if (end - start < TAKE_MOVES.min - EPS) break;
      let id = `take-move-${added.length + 1}`;
      while (taken.has(id)) id = `${id}x`;
      taken.add(id);
      // Toward the presenter's head where it is measured, so a move never crops the face.
      const head = presenterHead(resolved, start, end);
      const focus = head ? { x: round3((head.x + head.width / 2) / canvas.width), y: round3((head.y + head.height / 2) / canvas.height) } : null;
      copy.scenes.push({ id, module: "punch-in", start, end, energy: 1, track, params: { scale: TAKE_MOVES.scales[turn % TAKE_MOVES.scales.length], at: 0, release: TAKE_MOVES.release, ...(focus ? { focus } : {}) } });
      added.push(id);
      turn += 1;
      at = end + plain;
    }
  }
  return added.length ? { storyboard: copy, added } : { storyboard, added: [] };
}
