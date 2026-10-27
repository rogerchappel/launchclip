// Zooms inside a shot: the camera dives into one bar, row, number or box of a
// track-0 shot as the narration names it, holds, and eases back out. Shared by
// the HyperFrames compiler and the Remotion StoryComposition. Plain ESM;
// imports only grammar.mjs. Contract: docs/KIT_CONTRACTS.md, "Zooms inside a
// shot".
//
//   scene.zooms = [{at, box | target | object, scale?, until?}]
//     at, until   seconds or narration anchors ("word:57.6%"), like hits
//     box         {x, y, width, height} in plate px (every module)
//     target      a shot-state target: an item index or element id, or an
//                 array of them (the STATE_MODULES of shot-states.mjs)
//     object      a named model.objects rect (the ones push's from_object uses)
//     scale       1.15–3; by default the box fills ZOOM.fill of the frame
//
// Model
// - A zoom is a camera state on the plate {x, y, s}: the plate point at the
//   canvas centre and the magnification. At rest it is the plate's centre at
//   s = 1. The centre is the box's centre, clamped so the zoomed view never
//   leaves the plate.
// - Each zoom eases in at `at` over the grammar's camera duration (clamped to
//   ZOOM.move) with the grammar's camera ease, holds, and eases back out at
//   `until`. Without `until` it hands straight over to the next zoom (the
//   camera travels box to box, as evidence-clip's focus does) or, on the last
//   zoom, eases out so it is back at rest when the shot ends.
// - World mode (camera-world.mjs): every key becomes a camera move inside the
//   shot's window, so the camera containers, parallax, blur and the world
//   backdrops all follow it. Cuts mode: the same keys drive two wrappers
//   around the scene's layer, a scale about the canvas centre over a
//   translate, which is exactly the world camera's zoom-over-pan math.
// - Captions sit outside the camera and the wrappers, so a zoom never moves
//   or dips them.

import { resolveGrammar } from './grammar.mjs';

export const ZOOM = Object.freeze({
  min: 1.15, max: 3,
  // The default scale makes the box fill this share of the frame's width or
  // height, whichever is reached first.
  fill: 0.7,
  // Seconds a zoom move takes (the grammar's camera duration, clamped) and
  // the least a zoom holds between landing and leaving.
  move: Object.freeze({ min: 0.5, max: 0.8 }),
  hold: 1.2,
  // The zoomed box must land inside the frame inset by this share of each side.
  safe: 0.05,
  // At most this many zooms in one shot.
  count: 8
});

const EPS = 1e-6;
const round = (value, digits = 4) => { const f = 10 ** digits; return Math.round(value * f) / f + 0; };
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isRect = (rect) => isObject(rect) && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(Number(rect[key]))) && rect.width > 0 && rect.height > 0;

/** The zoom move's duration and ease for a story: the grammar's camera duration clamped to ZOOM.move, and its camera ease. */
export function zoomTiming(story) {
  const grammar = resolveGrammar(story);
  const duration = Number(grammar.duration?.camera);
  return { duration: round(clamp(Number.isFinite(duration) ? duration : ZOOM.move.max, ZOOM.move.min, ZOOM.move.max), 6), ease: grammar.ease.camera };
}

/**
 * A box (plate px) and an optional scale → the zoom's framing:
 * {scale, centre: {x, y} (plate px at the canvas centre), screen: the box's
 * rect on screen once zoomed}.
 */
export function zoomFrame(rect, scale, { width, height }) {
  const fill = Math.min((ZOOM.fill * width) / rect.width, (ZOOM.fill * height) / rect.height);
  const s = Number.isFinite(Number(scale)) ? Number(scale) : round(clamp(fill, ZOOM.min, ZOOM.max), 4);
  const hw = width / (2 * s), hh = height / (2 * s);
  const centre = { x: round(clamp(rect.x + rect.width / 2, hw, width - hw)), y: round(clamp(rect.y + rect.height / 2, hh, height - hh)) };
  const screen = { x: round(width / 2 + s * (rect.x - centre.x), 2), y: round(height / 2 + s * (rect.y - centre.y), 2), width: round(rect.width * s, 2), height: round(rect.height * s, 2) };
  return { scale: s, centre, screen };
}

/** Why a zoom's box misses the safe area once zoomed, or null. */
export function zoomFitError(frame, { width, height }) {
  const mx = width * ZOOM.safe, my = height * ZOOM.safe, r = frame.screen, tol = 0.5;
  if (r.x >= mx - tol && r.y >= my - tol && r.x + r.width <= width - mx + tol && r.y + r.height <= height - my + tol) return null;
  return `the zoomed box (${round(r.x, 1)}, ${round(r.y, 1)}, ${round(r.width, 1)}×${round(r.height, 1)} px at ${frame.scale}×) leaves the safe area (the frame inset ${ZOOM.safe * 100}%); lower the scale or zoom on a smaller box`;
}

const REST = (width, height) => ({ x: width / 2, y: height / 2, s: 1 });

/**
 * One shot's zooms, resolved. entry: a sceneWindows entry (id, scene with
 * numeric zoom times); rects: per zoom index, {rect} | {error} | null (the
 * scene's model.zoomRects, modules.mjs; a box needs none).
 * → {zooms: [{index, at, until, rect, scale, centre, screen}],
 *    keys: [{start, duration, ease, from: {x, y, s}, to: {x, y, s}}],
 *    warnings: [message]}
 * A zoom whose rect cannot be found, or that leaves the safe area, is
 * dropped with a warning.
 */
export function shotZooms(story, entry, rects = null) {
  const width = Number(story.format.width), height = Number(story.format.height);
  const size = { width, height };
  const list = Array.isArray(entry?.scene?.zooms) ? entry.scene.zooms : [];
  const out = { zooms: [], keys: [], warnings: [] };
  if (!list.length) return out;
  const { duration, ease } = zoomTiming(story);
  for (const [index, zoom] of list.entries()) {
    const found = isRect(zoom?.box) ? { rect: zoom.box } : rects?.[index] ?? { error: 'its rect was not resolved' };
    if (!isRect(found.rect)) { out.warnings.push(`${entry.id}: zooms[${index}] skipped: ${found.error ?? 'no rect'}`); continue; }
    const rect = { x: Number(found.rect.x), y: Number(found.rect.y), width: Number(found.rect.width), height: Number(found.rect.height) };
    const frame = zoomFrame(rect, zoom.scale, size);
    const misfit = zoomFitError(frame, size);
    if (misfit) { out.warnings.push(`${entry.id}: zooms[${index}] skipped: ${misfit}`); continue; }
    out.zooms.push({ index, at: Number(zoom.at), until: Number.isFinite(Number(zoom.until)) && zoom.until !== null ? Number(zoom.until) : null, rect, ...frame });
  }
  const rest = REST(width, height);
  let state = rest;
  const end = Number(entry.scene.end);
  for (const [k, zoom] of out.zooms.entries()) {
    const next = out.zooms[k + 1];
    const to = { x: zoom.centre.x, y: zoom.centre.y, s: zoom.scale };
    out.keys.push({ start: round(zoom.at, 6), duration, ease, from: state, to });
    state = to;
    if (zoom.until === null && next) continue;
    out.keys.push({ start: round(zoom.until ?? end - duration, 6), duration, ease, from: state, to: rest });
    state = rest;
  }
  // Validation keeps keys apart; clamp anyway so the chain of absolute
  // fromTo tweens always matches the frame-pure state.
  out.keys.sort((a, b) => a.start - b.start);
  for (let i = 0; i < out.keys.length; i += 1) {
    const limit = (out.keys[i + 1]?.start ?? end) - out.keys[i].start;
    out.keys[i].duration = round(Math.max(1 / 30, Math.min(out.keys[i].duration, limit)), 6);
  }
  return out;
}

/** The plate-local zoom state at absolute t from a shot's keys (rest before the first). ease: (name) → (p) → value. */
export function zoomStateAt(keys, t, getEase, { width, height }) {
  let state = REST(width, height);
  for (const key of keys) {
    if (t < key.start - EPS) break;
    const p = key.duration > 0 ? clamp((t - key.start) / key.duration, 0, 1) : 1;
    const k = p >= 1 ? 1 : getEase(key.ease)(p);
    state = { x: key.from.x + (key.to.x - key.from.x) * k, y: key.from.y + (key.to.y - key.from.y) * k, s: key.from.s + (key.to.s - key.from.s) * k };
  }
  return state;
}

/**
 * Cuts mode: a shot's keys → renderer-neutral ops (camera-world.mjs shape)
 * on two wrappers around the scene's layer: `zoom` {scale, rotation} about
 * the canvas centre over `pan` {x, y}. Screen = centre + s·(p − zoom centre),
 * the world camera's math. → ops ([] without keys).
 */
export function zoomOps(keys, { width, height }) {
  if (!keys?.length) return [];
  const pan = (state) => ({ x: round(width / 2 - state.x), y: round(height / 2 - state.y) });
  const zoom = (state) => ({ scale: round(state.s, 6), rotation: 0 });
  const ops = [
    { type: 'set', target: 'pan', time: 0, props: { x: 0, y: 0 } },
    { type: 'set', target: 'zoom', time: 0, props: { scale: 1, rotation: 0 } }
  ];
  for (const key of keys) {
    const timing = { start: key.start, duration: key.duration, ease: key.ease };
    ops.push({ type: 'tween', target: 'pan', ...timing, from: pan(key.from), to: pan(key.to) });
    ops.push({ type: 'tween', target: 'zoom', ...timing, from: zoom(key.from), to: zoom(key.to) });
  }
  return ops;
}
