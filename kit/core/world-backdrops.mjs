// World backdrops: the plates (kit/core/plates.mjs) a world camera
// (kit/core/camera-world.mjs) travels over, changing with its moves. Shared
// by the HyperFrames compiler (GSAP on the backdrop elements) and the Remotion
// StoryComposition (the same ops evaluated per frame).
//
// Model
// - Every track-0 scene has a plate (scenePlateSpec: scenes[i].backdrop /
//   .plate, chapters[j].plate, story.plate with its cycle) or none. Runs of
//   shots on the same plate are one segment; a new segment starts where the
//   plate changes, and the loop ending's clone continues the loop scene's.
// - A segment's backdrop travels with the camera's background depth layer
//   (camera-world.mjs backgroundKeys: 0.3× the plates with parallax, 1×
//   without), anchored so it frames the screen where the segment begins. Its
//   plate is drawn over every part of itself the camera shows across the
//   segment (platePlan's frame), so its edges never come on screen.
// - Into a new segment the backdrop changes with the camera move:
//     pan / whip-pan / orbit   the new backdrop slides in over the old one
//                              from the side the camera travels toward, a soft
//                              feathered edge first, with the move's ease;
//     push / pull, or a move   it crossfades over the move (and follows the
//     with no sideways travel  depth layer's travel while it does);
//     a cut (no camera move)   it changes on the cut.
//   The outgoing backdrop keeps following the depth layer under it and is
//   hidden when the move ends.
// - Each backdrop is opaque (bg under its layers), so the depth layer's glows
//   or field show only where a segment has no plate ("none"). One fixed
//   vignette sits over the whole stack instead of one per plate, so edges do
//   not double up mid-slide; it is lighter than a plate's own (0.4 vs 0.55),
//   since a travelling world reads brighter at its edges.
//
// Ops are renderer-neutral, as in camera-world.mjs: target `backdrop-<n>`,
// props {x, y, opacity} ({x, y} on the moving canvas, opacity on the
// segment). Plain ESM; imports only ./plates.mjs.
// Contract: docs/KIT_CONTRACTS.md, "World backdrops".

import { platePlan, plateVignette, scenePlateSpec } from './plates.mjs';

// The feathered leading edge of a sliding backdrop, as a share of the long
// side; it also covers a back ease's overshoot past the end of the slide.
export const BACKDROP_FEATHER = 0.15;
export const WORLD_VIGNETTE = 0.4;
const EPS = 1e-6;

const round = (value, digits = 4) => { const f = 10 ** digits; return Math.round(value * f) / f + 0; };
const keyOf = (spec) => (spec ? JSON.stringify(spec) : 'none');

/**
 * The backdrop timeline of a world-mode story, or null (cuts mode, or no shot
 * has a plate). plan: cameraPlan(story, {windows}); windows: sceneWindows(story).
 * → {feather, vignette: layer, segments: [{index, target, spec, kind, start,
 *    from, to, entry: {type: "first" | "slide" | "fade" | "cut", start,
 *    duration, ease, side?}, canvas: {x, y, width, height}, mask, layers,
 *    plan}], ops}
 * from / to: when the segment is on screen. canvas: the opaque, masked box
 * the layers sit in (screen px at the segment's rest); layers: the plate's
 * own layers (the fixed vignette left out) with boxes relative to the canvas.
 */
export function worldBackdrops(story, plan, windows) {
  if (plan?.mode !== 'world' || !plan.background || !windows) return null;
  const W = plan.width, H = plan.height;
  const plates = windows.scenes.filter((entry) => entry.plate).sort((a, b) => a.start - b.start || a.index - b.index);
  const shots = plates.map((entry) => ({ id: entry.id, start: entry.start, spec: scenePlateSpec(story, entry.scene) }));
  if (windows.loop) {
    const scene = plates.find((entry) => entry.id === windows.loop.sceneId)?.scene;
    shots.push({ id: `${windows.loop.sceneId}-loop`, start: windows.loop.start, spec: scene ? scenePlateSpec(story, scene) : null });
  }
  if (!shots.some((shot) => shot.spec)) return null;

  const moves = plan.moves, keys = plan.background.keys;
  const home = plan.background.home;
  // The depth layer at rest at time t: after every move that has ended.
  const restAt = (t) => {
    let state = home;
    keys.forEach((key) => { if (key.start + key.duration <= t + EPS) state = key.to; });
    return state;
  };
  const segments = [];
  for (const shot of shots) {
    if (segments.length && segments.at(-1).key === keyOf(shot.spec)) continue;
    segments.push({ key: keyOf(shot.spec), spec: shot.spec, shotId: shot.id, start: shot.start });
  }
  // Entry: the camera move into the segment's first shot, else a cut.
  for (const [n, segment] of segments.entries()) {
    const at = moves.findIndex((move) => move.sceneId === segment.shotId);
    segment.moveIndex = at >= 0 ? at : null;
    const move = at >= 0 ? moves[at] : null;
    if (n === 0) segment.entry = { type: 'first', start: 0, duration: 0 };
    else if (!move) segment.entry = { type: 'cut', start: round(segment.start, 6), duration: 0 };
    else {
      const key = keys[at];
      const dx = key.to.x - key.from.x, dy = key.to.y - key.from.y;
      const sideways = Math.hypot(dx, dy) >= 1 && move.type !== 'push' && move.type !== 'pull';
      // The layer travels by (dx, dy); the new backdrop arrives travelling the
      // same way, from the opposite side of the screen.
      const side = !sideways ? null : Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'right' : 'left') : (dy < 0 ? 'bottom' : 'top');
      segment.entry = { type: sideways ? 'slide' : 'fade', start: move.start, duration: move.duration, ease: move.ease, ...(side ? { side } : {}) };
    }
    segment.anchor = move ? keys[at].to : restAt(segment.start);
  }
  for (const [n, segment] of segments.entries()) {
    const next = segments[n + 1];
    segment.from = n === 0 ? 0 : segment.entry.start;
    segment.to = next ? next.entry.start + next.entry.duration : plan.duration;
    // Every move after the entry that starts while the segment shows,
    // including the next segment's entry move (it slides away under it).
    const settled = segment.entry.start + segment.entry.duration;
    segment.follows = keys.map((key, i) => ({ key, i })).filter(({ key, i }) => i !== segment.moveIndex && key.start >= settled - EPS && key.start < segment.to - EPS);
  }

  const feather = Math.round(BACKDROP_FEATHER * Math.max(W, H));
  const out = [];
  const ops = [];
  for (const [n, segment] of segments.entries()) {
    const target = `backdrop-${n}`;
    const offset = (state) => ({ x: round(state.x - segment.anchor.x), y: round(state.y - segment.anchor.y) });
    const offsets = [{ x: 0, y: 0 }];
    for (const { key } of segment.follows) offsets.push(offset(key.from), offset(key.to));
    if (segment.entry.type === 'fade') offsets.push(offset(keys[segment.moveIndex].from));
    // The canvas region the screen shows: the screen moved by −offset.
    const x0 = Math.floor(Math.min(...offsets.map((o) => -o.x))), y0 = Math.floor(Math.min(...offsets.map((o) => -o.y)));
    const x1 = Math.ceil(Math.max(...offsets.map((o) => -o.x)) + W), y1 = Math.ceil(Math.max(...offsets.map((o) => -o.y)) + H);
    const frame = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    const canvas = { x: x0 - feather, y: y0 - feather, width: frame.width + 2 * feather, height: frame.height + 2 * feather };
    const drawn = segment.spec ? platePlan(story, segment.spec, { frame: x0 === 0 && y0 === 0 && frame.width === W && frame.height === H ? null : frame }) : null;
    const side = segment.entry.side ?? null;
    // Transparent at the canvas edge that leads the slide (the one facing
    // away from `side`), opaque from the frame's edge in.
    const mask = side ? `linear-gradient(to ${side}, #00000000 0px, #000000 ${feather}px)` : null;
    out.push({
      index: n, target, spec: segment.spec, kind: segment.spec?.kind ?? 'none', shot: segment.shotId,
      start: round(segment.start, 6), from: round(segment.from, 6), to: round(segment.to, 6), entry: segment.entry,
      canvas, mask: drawn ? mask : null, plan: drawn,
      layers: drawn ? drawn.layers.filter((layer) => !layer.fixed).map((layer) => ({ ...layer, box: { ...layer.box, x: round(layer.box.x - canvas.x, 2), y: round(layer.box.y - canvas.y, 2) } })) : []
    });

    // Ops. Hidden until its entry, shown from it, hidden when the next is in.
    ops.push({ type: 'set', target, time: 0, props: { x: 0, y: 0, opacity: n === 0 ? 1 : 0 } });
    const entry = segment.entry;
    if (entry.type === 'cut') ops.push({ type: 'set', target, time: entry.start, props: { x: 0, y: 0, opacity: 1 } });
    else if (entry.type === 'fade') {
      ops.push({ type: 'tween', target, start: entry.start, duration: entry.duration, ease: entry.ease, from: { ...offset(keys[segment.moveIndex].from), opacity: 0 }, to: { x: 0, y: 0, opacity: 1 } });
    } else if (entry.type === 'slide') {
      // Start with the feathered edge just off the screen on its side.
      const start = { right: { x: W - canvas.x, y: 0 }, left: { x: -(canvas.x + canvas.width), y: 0 }, bottom: { x: 0, y: H - canvas.y }, top: { x: 0, y: -(canvas.y + canvas.height) } }[side];
      ops.push({ type: 'set', target, time: entry.start, props: { opacity: 1 } });
      ops.push({ type: 'tween', target, start: entry.start, duration: entry.duration, ease: entry.ease, from: { x: round(start.x), y: round(start.y) }, to: { x: 0, y: 0 } });
    }
    for (const { key } of segment.follows) ops.push({ type: 'tween', target, start: key.start, duration: key.duration, ease: key.ease, from: offset(key.from), to: offset(key.to) });
    if (segments[n + 1]) ops.push({ type: 'set', target, time: round(segment.to, 6), props: { opacity: 0 } });
  }
  return { feather, vignette: plateVignette(story, WORLD_VIGNETTE), segments: out, ops };
}

