// World camera: scenes laid out in one 2D world and a camera that travels
// between them, shared by the HyperFrames compiler (as seek-safe GSAP calls on
// one world container) and the Remotion StoryComposition (evaluated per frame
// from the same op list), so both renderers move the same layers by the same
// amounts with the same eases. Plain ESM; imports only sibling kit/core files.
// Canonical copy: kit/core/camera-world.mjs. Contract: docs/KIT_CONTRACTS.md,
// "World camera".
//
//   story.camera = {mode: "cuts" | "world", layout?: "row" | "column" | "grid"
//                   | "path" | "auto", spacing?, parallax?, blur?}
//
// Model
// - Every track-0 scene (plate) gets a world placement {x, y, scale,
//   rotation}: its top-left corner, scale and rotation (deg) in world px. The
//   first plate sits at the origin. A camera transition places the incoming
//   plate relative to the outgoing one: pan / whip-pan / orbit beside it in
//   the transition's direction (orbit also turns it), push inside a named
//   object of the outgoing scene (a dolly in), pull around it (a dolly out).
//   Any other transition stacks the incoming plate on the outgoing one.
// - The camera state is {x, y, zoom, rotation}: the world point at the
//   canvas centre, the zoom and the roll. At rest on a plate it frames the
//   plate exactly (zoom = 1 / scale, rotation = −plate rotation). A camera
//   transition moves it from rest to rest over the transition, with the
//   grammar's camera ease (whip-pans: the grammar's whip ease).
// - Three nested containers draw it: pan (translate), zoom (scale and roll
//   about the canvas centre) and, in world mode, drift: a slow wave on x, y
//   and scale whose periods divide the story duration, so the camera is never
//   fully still and the loop seam matches. Camera eases are all .inOut with
//   zero velocity at both ends, and the drift is smooth, so the camera path
//   is continuous in position and velocity at every boundary.
// - Background (world mode): one depth layer behind the transparent plates,
//   continuous across the whole world (ambient motion's field tiled with no
//   edges, else brand glows on a lattice). With parallax (camera.parallax,
//   default true) it moves at 0.3× the camera, plates at 1× and overlays
//   (track ≥ 1) at 1.15× relative to the camera position where they settle;
//   with parallax false the same layer moves at 1× with the plates and
//   overlays do not slide.
// - Motion blur: a directional Gaussian blur (SVG feGaussianBlur with
//   separate x/y deviations) shaped by the screen velocity of the camera,
//   sampled once per frame and exactly 0 at rest (RFC §5). It is on for
//   whip-pans by default; camera.blur true turns it on for every move, false
//   turns it off.
//
// The camera exists only when it has something to do: world mode, or a cuts
// story that uses a camera transition. Otherwise cameraPlan() returns null
// and the compilers emit exactly what they did before.

import { getEase, motionBlurPx } from './motion.mjs';
import { isCameraTransition } from './transitions.mjs';
import { resolveGrammar } from './grammar.mjs';
import { FIELD_PARALLAX, fieldTiles } from './ambient.mjs';

export const CAMERA_MODES = Object.freeze(['cuts', 'world']);
export const CAMERA_LAYOUTS = Object.freeze(['row', 'column', 'grid', 'path', 'auto']);
// background: ambient motion's FIELD_PARALLAX, so its field and the brand
// glows share the depth layer's 0.3× (the layer translates and rolls only;
// it never scales, see backgroundKeys). flat: the depth layer's speed when
// camera.parallax is false (it travels with the plates).
export const PARALLAX = Object.freeze({ background: FIELD_PARALLAX, plate: 1, overlay: 1.15, flat: 1 });
export const CAMERA_DEFAULTS = Object.freeze({ layout: 'auto', spacing: 0.12 });
// A dolly (push/pull) scales the next plate by this much, clamped.
export const DOLLY = Object.freeze({ min: 1.6, max: 3.2, pull: 2.2 });
export const ORBIT_DEGREES = 9;
// Same lead as catalogue B/C sampled sets: a set at t − LEAD lands on frame t
// whichever way the timeline is sought.
export const SAMPLE_LEAD = 0.0005;
export const BLUR_MAX = 18;
const EPS = 1e-9;

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const round = (value, digits = 4) => { const f = 10 ** digits; return Math.round(value * f) / f; };
const rad = (deg) => (deg * Math.PI) / 180;

/** story.camera with defaults → {mode, layout, spacing, parallax, blur} (blur null = whip-pans only). */
export function resolveCamera(story) {
  const own = isObject(story?.camera) ? story.camera : {};
  // Footage-led stories keep cuts and punch-ins, even when a style pack
  // carries a world camera (validateStory warns).
  const mode = own.mode === 'world' && story?.lane !== 'footage-led' ? 'world' : 'cuts';
  return {
    mode,
    layout: CAMERA_LAYOUTS.includes(own.layout) ? own.layout : CAMERA_DEFAULTS.layout,
    spacing: typeof own.spacing === 'number' ? own.spacing : CAMERA_DEFAULTS.spacing,
    parallax: mode === 'world' && own.parallax !== false,
    blur: typeof own.blur === 'boolean' ? own.blur : null
  };
}

/** Whether a story needs the camera (world mode, or any camera transition). */
export function cameraActive(story) {
  const camera = resolveCamera(story);
  if (camera.mode === 'world') return true;
  const transitions = [...(Array.isArray(story?.scenes) ? story.scenes.filter((scene) => (scene?.track ?? 0) === 0).map((scene) => scene?.in) : []), story?.ending?.in];
  return transitions.some((transition) => isObject(transition) && isCameraTransition(transition, camera.mode));
}

// ---------------------------------------------------------------------------
// Placement geometry

/** Placement → its centre in world px. */
export function placementCentre(placement, { width, height }) {
  const r = rad(placement.rotation), s = placement.scale;
  const cx = (width / 2) * s, cy = (height / 2) * s;
  return { x: placement.x + cx * Math.cos(r) - cy * Math.sin(r), y: placement.y + cx * Math.sin(r) + cy * Math.cos(r) };
}

/** A plate-local point (canvas px) → world px. */
export function worldPoint(placement, point) {
  const r = rad(placement.rotation), s = placement.scale;
  return { x: placement.x + s * (point.x * Math.cos(r) - point.y * Math.sin(r)), y: placement.y + s * (point.x * Math.sin(r) + point.y * Math.cos(r)) };
}

function placeAt(centre, scale, rotation, { width, height }) {
  const r = rad(rotation), cx = (width / 2) * scale, cy = (height / 2) * scale;
  return { x: round(centre.x - (cx * Math.cos(r) - cy * Math.sin(r)), 4), y: round(centre.y - (cx * Math.sin(r) + cy * Math.cos(r)), 4), scale: round(scale, 6), rotation: round(rotation, 4) };
}

/** The camera at rest on a placement → {x, y, zoom, rotation}. */
export function restState(placement, size) {
  const centre = placementCentre(placement, size);
  return { x: round(centre.x, 4), y: round(centre.y, 4), zoom: round(1 / placement.scale, 6), rotation: round(-placement.rotation, 4) + 0 };
}

const ORIGIN = Object.freeze({ x: 0, y: 0, scale: 1, rotation: 0 });

/** Default direction for the i-th camera move (0-based) of a layout with `count` plates. */
export function layoutDirection(layout, index, count) {
  if (layout === 'column') return 'down';
  if (layout === 'path') return index % 2 === 0 ? 'right' : 'down';
  if (layout === 'grid') {
    const columns = Math.max(2, Math.ceil(Math.sqrt(Math.max(1, count))));
    const step = index + 1; // move into plate `step`
    if (step % columns === 0) return 'down';
    return Math.floor(step / columns) % 2 === 0 ? 'right' : 'left';
  }
  return 'right'; // row, auto
}

function besidePlacement(from, direction, { spacing, rotate = 0 }, size) {
  const { width, height } = size;
  const step = { right: [1 + spacing, 0], left: [-(1 + spacing), 0], down: [0, 1 + spacing], up: [0, -(1 + spacing)] }[direction] ?? [1 + spacing, 0];
  const centre = placementCentre(from, size);
  const r = rad(from.rotation), s = from.scale;
  const ox = step[0] * width * s, oy = step[1] * height * s;
  return placeAt({ x: centre.x + ox * Math.cos(r) - oy * Math.sin(r), y: centre.y + ox * Math.sin(r) + oy * Math.cos(r) }, s, from.rotation + rotate, size);
}

function dollyFactor(rect, { width, height }) {
  if (!rect || !(rect.width > 0 && rect.height > 0)) return DOLLY.min;
  return Math.min(DOLLY.max, Math.max(DOLLY.min, Math.min(width / rect.width, height / rect.height)));
}

/**
 * Rect (canvas px, plate-local) of a named object on a resolved model:
 * model.objects[name].rect, else the model's content rect (layout.rect).
 */
export function objectRectFromModel(model, name) {
  const named = name ? model?.objects?.[name]?.rect : null;
  const rect = named ?? model?.layout?.rect ?? model?.rect ?? null;
  return rect && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(Number(rect[key]))) ? { x: Number(rect.x), y: Number(rect.y), width: Number(rect.width), height: Number(rect.height) } : null;
}

/**
 * A lookup (sceneId, objectName) → plate-local rect, resolving each scene's
 * model once with `resolve` (modules.mjs resolveModule; passed in to keep
 * this file free of the module registry). Errors resolve to null.
 */
export function sceneObjectLookup(story, resolve) {
  const cache = new Map();
  const scenes = Array.isArray(story?.scenes) ? story.scenes : [];
  return (sceneId, name) => {
    if (!cache.has(sceneId)) {
      const scene = scenes.find((entry) => entry?.id === sceneId);
      let model = null;
      try { model = scene ? resolve(scene, story) : null; } catch { model = null; }
      cache.set(sceneId, model);
    }
    return objectRectFromModel(cache.get(sceneId), name);
  };
}

/**
 * World placements for every plate of a resolved story.
 * windows: transitions.mjs sceneWindows(story). objects: (sceneId, name) →
 * plate-local rect | null (sceneObjectLookup), used by push and pull.
 * → {placements: Map sceneId → placement, loop: placement | null, order: [sceneId]}
 */
export function worldLayout(story, windows, { objects = () => null } = {}) {
  const size = { width: Number(story?.format?.width), height: Number(story?.format?.height) };
  const camera = resolveCamera(story);
  const plates = windows.scenes.filter((entry) => entry.plate).sort((a, b) => a.start - b.start || a.index - b.index);
  const placements = new Map();
  let previous = null, moves = 0;
  for (const entry of plates) {
    let placement = { ...ORIGIN };
    if (previous) {
      const from = placements.get(previous.id);
      const transition = entry.scene.in;
      placement = { ...from };
      if (isObject(transition) && isCameraTransition(transition, camera.mode)) {
        const direction = transition.direction ?? layoutDirection(camera.layout, moves, plates.length);
        const type = transition.type;
        if (type === 'pan' || type === 'whip-pan') placement = besidePlacement(from, direction, { spacing: camera.spacing }, size);
        else if (type === 'orbit') placement = besidePlacement(from, direction, { spacing: camera.spacing, rotate: direction === 'left' || direction === 'up' ? -ORBIT_DEGREES : ORBIT_DEGREES }, size);
        else if (type === 'push' || type === 'pull') {
          const [sceneId, name] = typeof transition.from_object === 'string' ? transition.from_object.split('.') : [previous.id, null];
          const host = placements.get(sceneId) ?? from;
          const rect = objects(placements.has(sceneId) ? sceneId : previous.id, name ?? null);
          const focus = rect ? worldPoint(host, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }) : placementCentre(host, size);
          const factor = type === 'push' ? dollyFactor(rect, size) : DOLLY.pull;
          placement = placeAt(focus, type === 'push' ? host.scale / factor : host.scale * factor, host.rotation, size);
        }
        moves += 1;
      }
    }
    placements.set(entry.id, placement);
    previous = entry;
  }
  // Loop ending: a camera ending travels home to the loop scene's placement;
  // any other ending shows the clone where the camera already rests.
  let loop = null;
  if (windows.loop) {
    const last = plates.reduce((best, entry) => (!best || entry.end >= best.end ? entry : best), null);
    loop = windows.loop.transitionIn?.camera ? { ...(placements.get(windows.loop.sceneId) ?? ORIGIN) } : { ...(last ? placements.get(last.id) : ORIGIN) };
  }
  return { placements, loop, order: plates.map((entry) => entry.id) };
}

// ---------------------------------------------------------------------------
// Drift: one smooth wave per axis, value(t) = centre + amp·cos(2πt / period)
// (an extremum at t = 0, so the half-period sine.inOut segments that GSAP
// plays reproduce it exactly), with periods that divide the duration.

/** Wave axis value at t. */
export function waveValue(axis, t) {
  return axis.centre + axis.amp * Math.cos((2 * Math.PI * t) / axis.period);
}

function wave(amp, target, duration) {
  const cycles = Math.max(1, Math.round(duration / target));
  return { centre: round(-amp, 6), amp: round(amp, 6), period: round(duration / cycles, 6) };
}

/** Sine.inOut segments reproducing a wave over [0, duration] → [{at, duration, from, to, ease}]. */
export function waveSegments(axis, duration) {
  const half = axis.period / 2, out = [];
  for (let k = 0; k * half < duration - EPS; k += 1) {
    const sign = k % 2 === 0 ? 1 : -1;
    out.push({ at: round(k * half, 6), duration: round(half, 6), from: round(axis.centre + axis.amp * sign, 6), to: round(axis.centre - axis.amp * sign, 6), ease: 'sine.inOut' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The plan

/**
 * The camera plan for a resolved story, or null when the story has no camera.
 * windows: sceneWindows(story); objects: (sceneId, name) → rect (push/pull).
 * → {mode, width, height, fps, duration, grammar, camera, placements, loop,
 *    moves: [{sceneId, type, start, duration, ease, blur, from, to}],
 *    drift: {x, y, scale} | null, parallax: {background, overlay} | null,
 *    depth: background layer speed (world mode: 0.3 with parallax, 1 without;
 *    cuts: null, the plates are opaque), background: backgroundKeys | null,
 *    ops: [renderer-neutral ops, see cameraOps]}
 */
export function cameraPlan(story, { windows, objects } = {}) {
  if (!cameraActive(story)) return null;
  if (!windows) throw new Error('cameraPlan needs the story windows (transitions.mjs sceneWindows)');
  const width = Number(story.format.width), height = Number(story.format.height);
  const size = { width, height };
  const fps = Number(story?.resolved?.fps ?? story.format.fps ?? 30);
  const duration = Number(story?.resolved?.duration ?? story.format.duration);
  const camera = resolveCamera(story);
  const grammar = resolveGrammar(story);
  const layout = worldLayout(story, windows, { objects });
  const plates = windows.scenes.filter((entry) => entry.plate).sort((a, b) => a.start - b.start || a.index - b.index);
  const moves = [];
  const blurFor = (type) => (camera.blur === null ? type === 'whip-pan' : camera.blur);
  const moveFor = (sceneId, transition, start, from, to) => {
    const type = transition.type;
    const ease = type === 'whip-pan' ? grammar.camera.whip : grammar.ease.camera;
    moves.push({ sceneId, type, start: round(start, 6), duration: round(transition.dur, 6), ease, blur: blurFor(type), from, to });
  };
  for (let i = 1; i < plates.length; i += 1) {
    const entry = plates[i];
    if (!entry.transitionIn?.camera) continue;
    const from = restState(layout.placements.get(plates[i - 1].id), size);
    const to = restState(layout.placements.get(entry.id), size);
    moveFor(entry.id, entry.transitionIn, entry.start, from, to);
  }
  if (windows.loop?.transitionIn?.camera && layout.loop) {
    const last = plates.at(-1);
    const from = restState(layout.placements.get(last.id), size);
    moveFor(`${windows.loop.sceneId}-loop`, windows.loop.transitionIn, windows.loop.start, from, restState(layout.loop, size));
  }
  // Moves never overlap (same-track scenes cannot), but clamp anyway so the
  // chain of absolute from/to tweens always matches the frame-pure state.
  moves.sort((a, b) => a.start - b.start);
  for (let i = 0; i < moves.length - 1; i += 1) moves[i].duration = round(Math.max(1 / fps, Math.min(moves[i].duration, moves[i + 1].start - moves[i].start)), 6);
  const unit = Math.min(width, height) / 1080;
  const style = grammar.camera;
  const drift = camera.mode === 'world' && style.drift > 0 && duration > 0 ? {
    x: wave(style.drift * unit, style.driftPeriod, duration),
    y: wave(-style.drift * 0.7 * unit, style.driftPeriod * 0.73, duration),
    scale: { ...wave(style.breathe, style.driftPeriod * 1.37, duration), centre: round(1 - style.breathe, 6) }
  } : null;
  const plan = {
    mode: camera.mode, width, height, fps, duration, grammar: grammar.id, camera,
    placements: Object.fromEntries(layout.placements), loop: layout.loop, order: layout.order,
    home: restState(layout.placements.get(plates[0]?.id) ?? ORIGIN, size),
    moves, drift,
    parallax: camera.parallax ? { background: PARALLAX.background, overlay: PARALLAX.overlay } : null,
    // World plates are transparent, so world mode always has a background
    // layer: parallax false only makes it travel with the plates.
    depth: camera.mode === 'world' ? (camera.parallax ? PARALLAX.background : PARALLAX.flat) : null
  };
  plan.background = plan.depth ? backgroundKeys(plan) : null;
  plan.blurSamples = blurSamples(plan);
  plan.ops = cameraOps(plan);
  return plan;
}

/**
 * Background depth-layer states per move, in screen px: each move shifts the
 * layer by plan.depth (0.3 with parallax, 1 without) × the plates' screen travel (world travel ×
 * the zoom it lands at) and turns it by the same fraction of the roll. The
 * layer is never scaled: a magnified gradient rasterises differently in the
 * two renderers, and a dolly already reads through the plates.
 * → {home: {x, y, scale, rotation}, keys: [{start, duration, ease, from, to}]}
 */
export function backgroundKeys(plan) {
  const k = plan.depth ?? 0;
  let at = { x: 0, y: 0, scale: 1, rotation: 0 };
  const keys = [];
  for (const move of plan.moves) {
    const zoom = move.to.zoom;
    const to = { x: round(at.x + k * (move.from.x - move.to.x) * zoom, 4), y: round(at.y + k * (move.from.y - move.to.y) * zoom, 4), scale: 1, rotation: round(k * move.to.rotation, 4) };
    keys.push({ start: move.start, duration: move.duration, ease: move.ease, from: at, to });
    at = to;
  }
  return { home: { x: 0, y: 0, scale: 1, rotation: 0 }, keys };
}

function backgroundAt(plan, t) {
  if (!plan.background) return { x: 0, y: 0, scale: 1, rotation: 0 };
  let state = plan.background.home;
  for (const key of plan.background.keys) {
    if (t < key.start - EPS) break;
    const p = key.duration > 0 ? Math.min(1, Math.max(0, (t - key.start) / key.duration)) : 1;
    const e = p >= 1 ? 1 : getEase(key.ease)(p);
    state = { x: lerp(key.from.x, key.to.x, e), y: lerp(key.from.y, key.to.y, e), scale: 1, rotation: lerp(key.from.rotation, key.to.rotation, e) };
  }
  return state;
}

/** Camera state (moves only, no drift) at absolute t: the latest started move wins, as on a GSAP timeline. */
export function cameraStateAt(plan, t) {
  let state = plan.home;
  for (const move of plan.moves) {
    if (t < move.start - EPS) break;
    const p = move.duration > 0 ? Math.min(1, Math.max(0, (t - move.start) / move.duration)) : 1;
    const k = p >= 1 ? 1 : getEase(move.ease)(p);
    state = { x: lerp(move.from.x, move.to.x, k), y: lerp(move.from.y, move.to.y, k), zoom: lerp(move.from.zoom, move.to.zoom, k), rotation: lerp(move.from.rotation, move.to.rotation, k) };
  }
  return state;
}

const lerp = (a, b, k) => a + (b - a) * k;

/** Drift offset at t → {x, y, scale} (identity without drift). */
export function driftAt(plan, t) {
  if (!plan.drift) return { x: 0, y: 0, scale: 1 };
  return { x: waveValue(plan.drift.x, t), y: waveValue(plan.drift.y, t), scale: waveValue(plan.drift.scale, t) };
}

/** Container values at t: pan {x, y}, zoom {scale, rotation}, drift {x, y, scale}, background {x, y, scale, rotation}. */
export function containerState(plan, t) {
  const c = cameraStateAt(plan, t);
  const W2 = plan.width / 2, H2 = plan.height / 2;
  const pan = { x: W2 - c.x, y: H2 - c.y };
  const zoom = { scale: c.zoom, rotation: c.rotation };
  return { pan, zoom, drift: driftAt(plan, t), background: backgroundAt(plan, t) };
}

/**
 * Screen position of a world point at t (moves and drift): the composition
 * of drift(zoom(pan(w))), each about the canvas centre.
 */
export function screenPoint(plan, point, t) {
  const { pan, zoom, drift } = containerState(plan, t);
  const W2 = plan.width / 2, H2 = plan.height / 2;
  const px = point.x + pan.x - W2, py = point.y + pan.y - H2;
  const r = rad(zoom.rotation);
  const zx = zoom.scale * (px * Math.cos(r) - py * Math.sin(r)), zy = zoom.scale * (px * Math.sin(r) + py * Math.cos(r));
  return { x: W2 + drift.x + drift.scale * zx, y: H2 + drift.y + drift.scale * zy };
}

/**
 * Directional blur deviations for the frame at t (px, x and y) from the
 * screen velocity over the previous frame: the canvas centre's travel gives
 * the direction, the corners' radial spread adds the zoom component.
 * motionBlurPx resolves sub-threshold speeds to exactly 0.
 */
export function velocityBlur(plan, t) {
  const dt = 1 / plan.fps;
  const W = plan.width, H = plan.height;
  const inverse = (q, time) => worldAt(plan, q, time);
  const probes = [{ x: W / 2, y: H / 2 }, { x: 0, y: 0 }, { x: W, y: 0 }, { x: 0, y: H }, { x: W, y: H }];
  const travel = probes.map((q) => { const now = screenPoint(plan, inverse(q, t - dt), t); return { x: now.x - q.x, y: now.y - q.y }; });
  const centre = travel[0];
  const radial = Math.max(...travel.slice(1).map((d) => Math.hypot(d.x - centre.x, d.y - centre.y)));
  const zoomBlur = motionBlurPx(radial, { max: BLUR_MAX }) / 2;
  return { x: round(Math.min(BLUR_MAX, Math.hypot(motionBlurPx(centre.x, { max: BLUR_MAX }), zoomBlur)), 3), y: round(Math.min(BLUR_MAX, Math.hypot(motionBlurPx(centre.y, { max: BLUR_MAX }), zoomBlur)), 3) };
}

/** World point under screen point q at t (inverse of screenPoint). */
export function worldAt(plan, q, t) {
  const { pan, zoom, drift } = containerState(plan, t);
  const W2 = plan.width / 2, H2 = plan.height / 2;
  const zx = (q.x - W2 - drift.x) / drift.scale, zy = (q.y - H2 - drift.y) / drift.scale;
  const r = rad(-zoom.rotation);
  const px = (zx * Math.cos(r) - zy * Math.sin(r)) / zoom.scale, py = (zx * Math.sin(r) + zy * Math.cos(r)) / zoom.scale;
  return { x: px + W2 - pan.x, y: py + H2 - pan.y };
}

/** Per-frame blur samples over every blurred move (plus one zero after each) → [{t, x, y}]. */
export function blurSamples(plan) {
  const samples = [];
  for (const move of plan.moves) {
    if (!move.blur) continue;
    const first = Math.ceil(move.start * plan.fps - 1e-6) + 1, last = Math.floor((move.start + move.duration) * plan.fps + 1e-6) + 1;
    for (let f = first; f <= last; f += 1) {
      const t = f / plan.fps;
      samples.push({ t: round(t, 6), ...(f === last ? { x: 0, y: 0 } : velocityBlur(plan, t)) });
    }
  }
  return samples;
}

/** Blur deviations at t: the last sample at or before t (+ lead), else 0. */
export function blurAt(plan, t) {
  let value = { x: 0, y: 0 };
  for (const sample of plan.blurSamples ?? []) {
    if (sample.t - SAMPLE_LEAD > t + EPS) break;
    value = { x: sample.x, y: sample.y };
  }
  return value;
}

// ---------------------------------------------------------------------------
// Renderer-neutral ops (the HyperFrames compiler turns them into GSAP; the
// frame-pure functions above give the same values, and a test seeks GSAP
// against them).
//
//   {type: "set", target, time, props}
//   {type: "tween", target, start, duration, ease, from, to}
//
// Targets: "pan" {x, y}, "zoom" {scale, rotation}, "drift" {x, y, scale},
// "background" {x, y, scale, rotation}, "blur" {x, y} (deviations; the
// compiler toggles the filter on while either is above 0).

export function cameraOps(plan) {
  const ops = [];
  const W2 = plan.width / 2, H2 = plan.height / 2;
  const panOf = (s) => ({ x: round(W2 - s.x, 4), y: round(H2 - s.y, 4) });
  const zoomOf = (s) => ({ scale: round(s.zoom, 6), rotation: round(s.rotation, 4) });
  ops.push({ type: 'set', target: 'pan', time: 0, props: panOf(plan.home) });
  ops.push({ type: 'set', target: 'zoom', time: 0, props: zoomOf(plan.home) });
  for (const move of plan.moves) {
    const timing = { start: move.start, duration: move.duration, ease: move.ease };
    ops.push({ type: 'tween', target: 'pan', ...timing, from: panOf(move.from), to: panOf(move.to) });
    ops.push({ type: 'tween', target: 'zoom', ...timing, from: zoomOf(move.from), to: zoomOf(move.to) });
  }
  if (plan.background) {
    ops.push({ type: 'set', target: 'background', time: 0, props: { ...plan.background.home } });
    for (const key of plan.background.keys) ops.push({ type: 'tween', target: 'background', start: key.start, duration: key.duration, ease: key.ease, from: { ...key.from }, to: { ...key.to } });
  }
  if (plan.drift) {
    ops.push({ type: 'set', target: 'drift', time: 0, props: { x: round(waveValue(plan.drift.x, 0), 6), y: round(waveValue(plan.drift.y, 0), 6), scale: round(waveValue(plan.drift.scale, 0), 6) } });
    for (const axis of ['x', 'y', 'scale']) {
      for (const segment of waveSegments(plan.drift[axis], plan.duration)) ops.push({ type: 'tween', target: 'drift', start: segment.at, duration: segment.duration, ease: segment.ease, from: { [axis]: segment.from }, to: { [axis]: segment.to } });
    }
  }
  if (plan.blurSamples?.length) {
    ops.push({ type: 'set', target: 'blur', time: 0, props: { x: 0, y: 0 } });
    for (const sample of plan.blurSamples) ops.push({ type: 'set', target: 'blur', time: round(Math.max(0, sample.t - SAMPLE_LEAD), 6), props: { x: sample.x, y: sample.y } });
  }
  return ops;
}

/**
 * Overlay parallax for a track ≥ 1 scene window ({start, end}): ops on the
 * target `overlay` moving its wrapper by (overlay − 1) × the camera's pan
 * travel since the overlay's anchor (the camera state where it settles), so
 * overlays slide 1.15× as far as the plates. → ops ([] without parallax or
 * without a move inside the window).
 */
export function overlayOps(plan, window, target = 'overlay') {
  if (!plan?.parallax) return [];
  const k = plan.parallax.overlay - 1;
  const inside = plan.moves.filter((move) => move.start < window.end - EPS && move.start + move.duration > window.start + EPS);
  if (!inside.length) return [];
  const anchorTime = Math.min(window.end, window.start + Math.min(1, (window.end - window.start) / 2));
  const anchor = cameraStateAt(plan, anchorTime);
  const offset = (s) => ({ x: round(-k * (s.x - anchor.x) * s.zoom, 4), y: round(-k * (s.y - anchor.y) * s.zoom, 4) });
  const ops = [{ type: 'set', target, time: round(window.start, 6), props: offset(cameraStateAt(plan, window.start)) }];
  for (const move of inside) {
    // The zoom factor scales world travel into screen travel; it is frozen
    // per move (the move's end zoom) so the tween stays a plain fromTo.
    const zoom = move.to.zoom;
    const at = (s) => ({ x: round(-k * (s.x - anchor.x) * zoom, 4), y: round(-k * (s.y - anchor.y) * zoom, 4) });
    ops.push({ type: 'tween', target, start: move.start, duration: move.duration, ease: move.ease, from: at(move.from), to: at(move.to) });
  }
  return ops;
}

/** Frame-pure value of `target` from ops at t (GSAP timeline semantics: in start order, later wins). */
export function opsStateAt(ops, target, t) {
  const props = {};
  const list = ops.filter((op) => op.target === target).map((op, index) => ({ op, index, at: op.type === 'set' ? op.time : op.start }))
    .sort((a, b) => a.at - b.at || a.index - b.index);
  for (const { op, at } of list) {
    if (at > t + EPS) break;
    if (op.type === 'set') Object.assign(props, op.props);
    else {
      const p = op.duration > 0 ? Math.min(1, Math.max(0, (t - op.start) / op.duration)) : 1;
      const k = p >= 1 ? 1 : getEase(op.ease)(p);
      for (const key of Object.keys(op.to)) props[key] = op.from[key] + (op.to[key] - op.from[key]) * k;
    }
  }
  return props;
}

// ---------------------------------------------------------------------------
// CSS (both renderers)

/** Placement → CSS transform for a plate (transform-origin 0 0). */
export function placementTransform(placement) {
  const parts = [`translate(${round(placement.x, 3)}px, ${round(placement.y, 3)}px)`];
  if (placement.rotation) parts.push(`rotate(${round(placement.rotation, 4)}deg)`);
  if (placement.scale !== 1) parts.push(`scale(${round(placement.scale, 6)})`);
  return parts.join(' ');
}

/** Container props → CSS transform, in GSAP CSSPlugin order: translate, rotate, scale. */
export function containerTransform(props) {
  const x = props.x ?? 0, y = props.y ?? 0, r = props.rotation ?? 0, s = props.scale ?? 1;
  return `translate(${round(x, 3)}px, ${round(y, 3)}px) rotate(${round(r, 4)}deg) scale(${round(s, 6)})`;
}

/**
 * The rect of the depth layer's own frame (origin = the canvas origin at
 * home) that the camera can show over the story: the canvas at every rest
 * translation of the layer, plus a margin for ease overshoot (back.inOut)
 * and roll. → {x0, y0, x1, y1}. Ambient's fieldTiles() fills it so the field
 * has no edge anywhere the camera goes.
 */
export function backgroundExtent(plan) {
  const keys = [plan.background?.home ?? { x: 0, y: 0 }, ...(plan.background?.keys ?? []).map((key) => key.to)];
  const xs = keys.map((key) => -key.x), ys = keys.map((key) => -key.y);
  const margin = Math.max(plan.width, plan.height) * 0.5;
  return { x0: round(Math.min(...xs) - margin, 3), y0: round(Math.min(...ys) - margin, 3), x1: round(Math.max(...xs) + plan.width + margin, 3), y1: round(Math.max(...ys) + plan.height + margin, 3) };
}

/**
 * Ambient motion's field (ambientField) laid across the depth layer as one
 * continuous backdrop: fieldTiles over backgroundExtent. Both renderers draw
 * exactly these copies. → [{blob, dx, dy}] ([] without a depth layer or field).
 */
export function backgroundFieldTiles(plan, field) {
  if (!plan?.background || !field?.blobs?.length) return [];
  return fieldTiles(field, backgroundExtent(plan), { width: plan.width, height: plan.height });
}

/**
 * The background depth layer when ambient motion's field is absent: soft
 * brand-colour glows (primary, accent) over brand.colors.bg on a fixed
 * lattice in the layer's own frame (cell (i, j) always holds the same glow,
 * with a small deterministic offset), covering everywhere the layer travels,
 * so parallax reads at 0.3×. Glow positions never depend on the camera path:
 * a segment that frames the same part of the layer draws the same glows.
 * Each glow is its own small element (one radial gradient with a many-stop
 * falloff, like the ambient field's blobs) rather than one huge
 * multi-gradient layer, which the two renderers dither differently.
 * → {bg, glows: [{left, top, size, background}]} (px in the layer's frame,
 * whose origin is the canvas origin at home).
 */
export function backgroundLayer(plan, brand) {
  const colors = isObject(brand?.colors) ? brand.colors : {};
  const hex = (value, fallback) => (/^#[0-9a-fA-F]{6}$/.test(value ?? '') ? value : fallback);
  const bg = hex(colors.bg, '#000000');
  const palette = [hex(colors.primary, '#ffffff'), hex(colors.accent, hex(colors.primary, '#ffffff'))];
  const W = plan.width, H = plan.height;
  const rgb = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
  const falloff = [[0, 1], [15, 0.94], [30, 0.78], [45, 0.56], [60, 0.34], [75, 0.16], [88, 0.05], [100, 0]];
  const gradient = (color, alpha) => {
    const [r, g, b] = rgb(color);
    return `radial-gradient(closest-side, ${falloff.map(([stop, f]) => `rgba(${r}, ${g}, ${b}, ${round(alpha * f, 4)}) ${stop}%`).join(', ')})`;
  };
  // Where the layer travels: its translation at rest and after every move
  // (moves are monotone between rests up to a small overshoot, covered by the
  // one-cell margin).
  const keys = [plan.background?.home ?? { x: 0, y: 0 }, ...(plan.background?.keys ?? []).map((key) => key.to)];
  const xs = keys.map((key) => -key.x), ys = keys.map((key) => -key.y);
  // Glow size and column pitch follow the short side (portrait: the width,
  // as before), so a landscape lattice is not ~2500 px gradients stacked
  // three deep, which dithered apart in the two renderers (16:9 SSIM 0.966).
  const S = Math.min(W, H);
  const cellW = S * 0.8, cellH = H * 0.55;
  const i0 = Math.floor((Math.min(...xs) - W) / cellW), i1 = Math.ceil((Math.max(...xs) + 2 * W) / cellW);
  const j0 = Math.floor((Math.min(...ys) - H) / cellH), j1 = Math.ceil((Math.max(...ys) + 2 * H) / cellH);
  const jitter = (i, j, salt) => { const v = Math.sin(i * 127.1 + j * 311.7 + salt * 74.7) * 43758.5453; return v - Math.floor(v); };
  const glows = [];
  for (let j = j0; j <= j1; j += 1) {
    for (let i = i0; i <= i1; i += 1) {
      const accent = (i + j) % 2 !== 0;
      const size = Math.round(S * (accent ? 1.05 : 1.3));
      const cx = (i + 0.5 + (jitter(i, j, 1) - 0.5) * 0.5) * cellW, cy = (j + 0.5 + (jitter(i, j, 2) - 0.5) * 0.5) * cellH;
      glows.push({ left: Math.round(cx - size / 2), top: Math.round(cy - size / 2), size, background: gradient(palette[accent ? 1 : 0], accent ? 0.13 : 0.18) });
    }
  }
  return { bg, glows };
}
