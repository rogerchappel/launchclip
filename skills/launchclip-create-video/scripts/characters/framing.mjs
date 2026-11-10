// Shot framing for character scenes: how close the camera stands, with no
// camera move. A cast-scene or a character-cameo frames its characters
//
//   wide    the whole figure on its floor (the set's own layout)
//   medium  knees up: the figures fill the frame's height, faces readable on
//           a phone; the default for 9:16 sets where people are the subject
//   close   chest up: faces carry the shot
//
// A framed shot is the wide layout seen through a longer lens: the set's
// furniture scales about the cast by the same factor, the characters are
// re-spaced to stay inside the safe zone, the head tops stay inside it and
// every face stays above the caption band, so the shot never needs a zoom.
// A cue's `shot` cuts in on that character (a punch-in) and back.
//
// Imports only kit/core files.

import {profileGeometry} from '../layout-check.mjs';

export const SHOTS = Object.freeze(['wide', 'medium', 'close']);
const RANK = Object.freeze({wide: 0, medium: 1, close: 2});
// Scale over the wide layout, before the safe-zone, caption-band and width limits.
export const SHOT_ZOOM = Object.freeze({wide: 1, medium: 2, close: 3.1});
// Sets where the people are the subject: a 9:16 frame opens on them at medium.
export const PORTRAIT_MEDIUM_SETS = Object.freeze(['standing', 'phone', 'kitchen-counter', 'sofa', 'park-bench']);
// Sets with no furniture to stand at: a wide shot there may move a character across (fitShot).
export const WIDE_SHIFT_SETS = Object.freeze(['standing']);
// A face is at most this share of its slot's width (two heads never touch).
const HEAD_SHARE = Object.freeze({medium: 0.6, close: 0.78});
const r2 = value => Math.round(value * 100) / 100;

/** The shot a cast-scene takes when it names none. */
export function defaultShot(setName, canvas) {
  return canvas.height > canvas.width && PORTRAIT_MEDIUM_SETS.includes(setName) ? 'medium' : 'wide';
}

/** Is shot `a` closer than shot `b`? */
export const closer = (a, b) => RANK[a] > RANK[b];

/**
 * A character's framing marks in rig units above its floor (feet at 0): the
 * head top (its drawn height, less the seat drop when seated), the chin, the
 * knees (medium's cut) and mid-chest (close's cut), and the head's width.
 * geometry: styles.mjs styleGeometry; height: styleHeight.
 */
export function framingMarks(geometry, height, {seated = false} = {}) {
  const g = geometry;
  const drop = seated ? g.sitDrop : 0;
  const hip = -g.hipY;
  const headW = (g.headR ? 2 * g.headR : 2 * g.head.rx) * 1.2;
  return {
    top: height - drop,
    chin: hip + g.torso + g.neck * 0.6 - 4 - drop,
    knee: seated ? (hip - drop) * 0.7 : g.shin + g.foot,
    chest: hip + g.torso * 0.45 - drop,
    hip: hip - drop,
    headW
  };
}

/** The frame's safe zone and caption band (layout-check.mjs profileGeometry). */
export function frameGuides(canvas) {
  const {safeZone, captionBand} = profileGeometry(canvas);
  return {safe: safeZone, band: captionBand};
}

/**
 * Frame a cast for a shot.
 *   shot     medium | close (wide returns the layout unchanged)
 *   canvas   {width, height}
 *   actors   [{x, scale, marks}] in their wide placement (scale: px per rig unit)
 *   floor    the wide layout's floor (canvas px)
 *   box      where the cast stands across and how high its heads may go
 *            (default: the safe zone)
 *   fit      a factor under 1 to shrink the shot (the fit loop's retries)
 *   shift    px to move each character across (the fit loop keeps a gesture inside the safe zone)
 * → {shot, scale, floor, xs, zoom (scale over wide), top (head-top y), set:
 *    {x, y, scale} (the transform, origin 0 0, that carries the wide set's
 *    furniture into the shot)}
 */
export function frameCast(shot, {canvas, actors, floor, box = null, fit = 1, shift = null}) {
  const W = canvas.width, H = canvas.height;
  const s0 = actors[0].scale;
  // Wide: the set's own layout; `shift` moves a character across (fitShot's wideShift, a set with no furniture).
  if (shot === 'wide') return {shot, scale: s0, floor, xs: actors.map((a, i) => r2(a.x + (shift?.[i] ?? 0))), zoom: 1, top: floor - Math.max(...actors.map(a => a.marks.top)) * s0, set: {x: 0, y: 0, scale: 1}};
  const {safe, band} = frameGuides(canvas);
  const area = box ?? safe;
  const n = actors.length;
  const T = Math.max(...actors.map(a => a.marks.top));
  const lowChin = Math.min(...actors.map(a => a.marks.chin));
  const headW = Math.max(...actors.map(a => a.marks.headW));
  let s = s0 * SHOT_ZOOM[shot];
  // Two heads never crowd: each face fits its share of the width.
  s = Math.min(s, (HEAD_SHARE[shot] * area.width) / n / headW) * fit;
  const minTop = Math.max(safe.y, area.y) + H * 0.035;
  const maxChin = band.y - H * 0.015;
  // Medium: the knees on the frame's bottom edge; close: the head a little
  // below the top of the safe zone, the chest running out of frame.
  let f1 = shot === 'medium' ? H + Math.max(...actors.map(a => a.marks.knee)) * s : minTop + H * 0.09 + T * s;
  if (f1 - T * s < minTop) f1 = minTop + T * s;
  // Every face above the caption band.
  if (f1 - lowChin * s > maxChin) f1 = maxChin + lowChin * s;
  if (f1 - T * s < minTop) {
    s = (maxChin - minTop) / (T - lowChin);
    f1 = minTop + T * s;
  }
  const zoom = s / s0;
  // Across: spread about the frame's centre by the zoom, held inside the box.
  const cx = actors.reduce((sum, a) => sum + a.x, 0) / n;
  const mid = area.x + area.width / 2;
  const far = Math.max(1e-6, ...actors.map(a => Math.abs(a.x - cx)));
  const spread = n === 1 ? 0 : Math.max(0, Math.min(zoom, (area.width / 2 - (headW / 2) * s) / far));
  const xs = actors.map((a, i) => r2(mid + (a.x - cx) * spread + (shift?.[i] ?? 0)));
  // The set's furniture: scaled by the zoom about the cast's centre and floor.
  const set = {x: r2(mid - cx * zoom), y: r2(f1 - floor * zoom), scale: Math.round(zoom * 10000) / 10000};
  return {shot, scale: Math.round(s * 10000) / 10000, floor: r2(f1), xs, zoom: set.scale, top: r2(f1 - T * s), set};
}

/**
 * A punch-in on one character (a cue's `shot`): the transform, origin 0 0,
 * over the whole framed scene that cuts to that character at `shot`, its head
 * centred across and placed as frameCast places a single character. Not
 * closer than the scene's shot: the identity (back to the scene's framing).
 *   actor  {x, floor, scale, wideScale, marks} as framed (wideScale: its scale in the wide layout)
 *   lean   the torso's lean in that state (rig.mjs joints, degrees clockwise)
 * → {x, y, scale}
 */
export function punchIn(shot, sceneShot, {canvas, actor, lean = 0}) {
  if (!closer(shot, sceneShot)) return {x: 0, y: 0, scale: 1};
  const single = frameCast(shot, {canvas, actors: [{x: actor.x, scale: actor.wideScale ?? actor.scale / SHOT_ZOOM[sceneShot], marks: actor.marks}], floor: actor.floor});
  const k = Math.max(1, single.scale / actor.scale);
  // Head top of the framed actor → head top of the single framing. A lean
  // (the torso's rotation about the hips, degrees clockwise) carries the head across.
  const above = actor.marks.top - actor.marks.hip;
  const rad = (lean * Math.PI) / 180;
  const headX = actor.x + Math.sin(rad) * above * actor.scale, headY = actor.floor - (actor.marks.hip + Math.cos(rad) * above) * actor.scale;
  return {x: r2(single.xs[0] - k * headX), y: r2(single.top - k * headY), scale: Math.round(k * 10000) / 10000};
}

/**
 * Fit a framed shot to the safe zone: `place(fit, shift)` frames and directs
 * the cast and returns {frame, actors} with each actor's reach (canvas px).
 * A character whose gesture reaches past a side moves in by that much; a
 * reach above the safe zone, or past both sides, shrinks the shot. → the
 * last placement.
 *
 * A wide shot keeps the set's own layout. With wideShift (a set with no
 * furniture to stand at, like `standing`) a character whose reach passes one
 * side of the safe zone moves in by that much, and nothing shrinks: in 9:16
 * the safe zone ends well inside the right edge (the platform's buttons), so
 * the set's right-hand place, level with its left, reaches past it. A shift
 * that does not bring every reach inside (a walk to the frame's edge) is not
 * kept: the placement is the set's own, and the cast gate says what is out.
 */
export function fitShot(shot, place, {canvas, count, wideShift = false}) {
  let fit = 1, shift = new Array(count).fill(0);
  let placed = place(fit, shift);
  if (shot === 'wide' && !wideShift) return placed;
  const {safe} = frameGuides(canvas);
  const right = safe.x + safe.width;
  // Kept a few px inside the edges, so the gate's rounding never meets them.
  const inset = 3;
  if (shot === 'wide') {
    const own = placed;
    const sides = () => placed.actors.map(a => ({under: safe.x + inset - a.reach.left, over: a.reach.right - (right - inset)}));
    for (let tries = 0; tries < 6; tries++) {
      const off = sides();
      if (off.every(o => o.under <= 0 && o.over <= 0)) return placed;
      if (off.some(o => o.under > 0 && o.over > 0)) return own;
      shift = shift.map((dx, i) => dx + (off[i].under > 0 ? off[i].under + 1 : 0) - (off[i].over > 0 ? off[i].over + 1 : 0));
      placed = place(fit, shift);
    }
    return sides().every(o => o.under <= 0 && o.over <= 0) ? placed : own;
  }
  for (let tries = 0; tries < 12; tries++) {
    const off = placed.actors.map(a => ({under: safe.x + inset - a.reach.left, over: a.reach.right - (right - inset), top: safe.y + inset - a.reach.top}));
    if (off.every(o => o.under <= 0 && o.over <= 0 && o.top <= 0)) break;
    if (off.some(o => o.top > 0 || (o.under > 0 && o.over > 0)) || tries >= 6) fit *= 0.93;
    else shift = shift.map((dx, i) => dx + (off[i].under > 0 ? off[i].under + 1 : 0) - (off[i].over > 0 ? off[i].over + 1 : 0));
    placed = place(fit, shift);
  }
  return placed;
}

/** Planner lines on shot framing, acting poses and pointing (kit/core/planning-prompt.mjs, the skills). */
export function framingPromptLines() {
  return [
    `Shot framing (cast-scene params.shot, character-cameo params.shot): ${SHOTS.join(' | ')}. wide shows whole figures on the set's floor; medium is knees up and close is chest up, with faces big enough to read on a phone. A 9:16 cast-scene in ${PORTRAIT_MEDIUM_SETS.join(', ')} defaults to medium (wide when someone walks); others default to wide. The kit keeps every framing inside the safe zone and every face above the caption band, so frame closer with shot, not with zooms. A cameo with shot medium or close puts the head at the top of its rect and runs the body off the frame's bottom edge, so it needs no floor.`,
    'Vary the framing like an animated short: open wide to set the place, play the exchange at medium, and cut close on the reaction. A cue {at, shot: "close"} on one character cuts in on them (a hard cut, no camera move) and {at, shot: "medium"} (the scene\'s own shot) cuts back.',
    'Acting poses for arguments and reactions: arms-crossed (unconvinced), hands-on-hips (indignant), facepalm (exasperated), lean-in (making the point), point-self ("me?", "I do"), shrug, think, slump, cheer. Change pose on the words that carry the feeling.',
    'Positions (cast-scene cast[].position): a character alone in a scene stands in the centre, so leave position out (left and right are for two or three characters, and fail for one); two take left and right, three take left, centre and right. A character keeps the side the story cast gives it from shot to shot.',
    'Cut on the speaker: while a character speaks, a scene with that character in it is on screen for every word of their line, the first one included. Start the speaker\'s shot on the first word they say (a scene start may be a word anchor, "word:Not") and end the shot before it on that same word; a two-word reply ("Not quite.") whose shot starts one word late fails. Scenes on one track never overlap: each ends where the next starts.',
    'Cue times count from the scene\'s start and the last one lands 0.45 s before the scene ends (a pose change needs that long). A {character: id} target names a character in the same scene; to look at someone who is not in the shot, target the side they stand on (left | right).',
    'point-at aims the arm at its target: at another character it points at their chest and stops short of them (two people pointing at each other never cross arms); toward the frame edge it bends to stay inside the safe zone.'
  ];
}
