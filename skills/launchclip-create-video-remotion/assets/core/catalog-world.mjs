// The world module (docs/SEEDED_STYLES_RFC.md §3.5, phase 5): a layered
// environment drawn in code (kit/core/worlds/) as a scene's plate, behind
// characters, cards or captions on higher tracks. Contract:
// docs/KIT_CONTRACTS.md ("World module").
//
//   world  {kind?, time?, props?, camera?, detail?, scrim?}
//
// - kind, time and props default to story.world (a style's video-wide
//   world, filled in by applyStyle); a scene's own params win.
// - The brand palette recolours the world; the cast's drawing style
//   (story.cast.style) sets its detail unless params.detail does.
// - camera moves inside the world: still | drift | pan-left | pan-right |
//   push | pull, with an amount. The back, mid and front layers move at the
//   world camera's depths (kit/core/camera-world.mjs PARALLAX: the back at
//   the background's 0.3, the front at the plate's 1, the mid between), so
//   a pan reads as depth. The fx layer (glows, rays) and the scrim stay put.
// - scrim darkens the world's quiet area (or a named side) with the brand
//   background, so text on a higher track reads at 4.5:1 or better.
//
// Same conventions as the character modules: one {front} element tree, one
// renderer-neutral op list, absolute times.

import {createBase, r2, rt} from './catalog-b-base.mjs';
import {abs, el, set, tw} from './catalog-b-view.mjs';
import {PARALLAX} from './camera-world.mjs';
import {WORLD_KINDS, WORLD_TIMES, DETAIL_LEVELS, PROP_IDS, renderWorld} from './worlds/index.mjs';
import {propEntry} from './worlds/props.mjs';
import {worldLayerNodes, WORLD_LAYERS} from './worlds/view.mjs';
import {SCRIM_SIDES, scrimFor} from './worlds/readable.mjs';
import {SET_INFO} from './characters/sets.mjs';

export const WORLD_CAMERA_MOVES = Object.freeze(['still', 'drift', 'pan-left', 'pan-right', 'push', 'pull']);
// Layer depths, from the world camera's parallax: back = background, front = plate.
export const WORLD_DEPTH = Object.freeze({back: PARALLAX.background, mid: Math.round((PARALLAX.background + PARALLAX.plate) / 2 * 100) / 100, front: PARALLAX.plate});
const PUSH_SCALE = 0.07;
const DRIFT = {pan: 0.3, push: 0.25};

export const WORLD_TIMING = Object.freeze({world: {minDuration: 2, leadIn: 0, leadOut: 0}});
const timing = {...WORLD_TIMING.world, gaps: [], rules: [
  'a world fills the frame for the whole scene; its camera move runs from the scene start to its end',
  'put characters, cards and captions on higher tracks over it'
]};

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** The world settings for a scene: params over story.world. */
function settings(b, ctx) {
  const {check} = b;
  const p = b.params;
  const base = isObject(ctx.world) ? ctx.world : {};
  const kind = p.kind ?? base.kind;
  if (kind === undefined) check.fail('params.kind', `is required (or set story.world.kind); kinds: ${WORLD_KINDS.join(', ')}`);
  check.oneOf(kind, p.kind === undefined ? 'story.world.kind' : 'params.kind', WORLD_KINDS);
  const time = p.time ?? base.time ?? 'day';
  check.oneOf(time, p.time === undefined ? 'story.world.time' : 'params.time', WORLD_TIMES);
  const rawProps = p.props ?? base.props ?? [];
  const where = p.props === undefined ? 'story.world.props' : 'params.props';
  check.arr(rawProps, where, 0, 12);
  const props = rawProps.map((entry, i) => {
    try { return propEntry(entry, `${where}[${i}]`); } catch (error) { check.fail(`${where}[${i}]`, error.message.replace(/^\S+ /, '')); }
    return null;
  });
  const detail = p.detail === undefined ? (base.detail ?? null) : check.oneOf(p.detail, 'params.detail', DETAIL_LEVELS);
  return {kind, time, props, detail};
}

/**
 * The world a scene on a higher track plays over: the track-0 `world` scene
 * that overlaps its window the longest, with that scene's settings (params
 * over story.world). → {scene, kind, time, props, detail} | null. Character
 * scenes read it to take the world's light and stand in it.
 */
export function worldBeneath(story, scene) {
  if (!scene || (scene.track ?? 0) === 0 || !Array.isArray(story?.scenes)) return null;
  const start = Number(scene.start), end = Number(scene.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const base = isObject(story.world) ? story.world : {};
  let best = null, bestOverlap = 0;
  for (const other of story.scenes) {
    if (other?.module !== 'world' || (other.track ?? 0) !== 0) continue;
    const overlap = Math.min(end, Number(other.end)) - Math.max(start, Number(other.start));
    if (overlap > bestOverlap + 1e-6) { best = other; bestOverlap = overlap; }
  }
  if (!best) return null;
  const p = isObject(best.params) ? best.params : {};
  const kind = p.kind ?? base.kind;
  const time = p.time ?? base.time ?? 'day';
  if (!WORLD_KINDS.includes(kind) || !WORLD_TIMES.includes(time)) return null;
  return {scene: best.id ?? null, kind, time, props: p.props ?? base.props ?? [], detail: p.detail ?? base.detail ?? null};
}

/**
 * Does a cast stand in this world scene: a cast-scene on a higher track over
 * it whose set stands in the world (backdrop "world", the default over a
 * world)? Then the cast and its furniture are the foreground, and the world
 * leaves out its own front layer (a parked car or a desk would sit under
 * their feet).
 */
export function castStandsIn(story, scene) {
  if (!scene || scene.module !== 'world' || (scene.track ?? 0) !== 0 || !Array.isArray(story?.scenes)) return false;
  return story.scenes.some(other => other?.module === 'cast-scene' && (other.track ?? 0) > 0
    && other.params?.backdrop !== 'room' && SET_INFO[other.params?.set]?.world && other.params?.world === undefined
    && worldBeneath(story, other)?.scene === scene.id);
}

function cameraOf(b) {
  const {check} = b;
  const raw = b.params.camera;
  if (raw === undefined) return {move: 'drift', amount: 0.5};
  const value = typeof raw === 'string' ? {move: raw} : raw;
  check.obj(value, 'params.camera', ['move', 'amount'], ['move']);
  const move = check.oneOf(value.move, 'params.camera.move', WORLD_CAMERA_MOVES);
  const amount = value.amount === undefined ? 0.5 : check.num(value.amount, 'params.camera.amount', 0, 1);
  return {move, amount};
}

/**
 * Per-layer start and end states for the camera move: {layer: {from, to}}
 * with x (px) and scale. A pan travels up to the overscan on the front
 * layer, so no edge ever shows.
 */
export function worldCameraStates(camera, {overscan}) {
  const reach = overscan * 0.9;
  const pan = camera.move === 'pan-left' ? -1 : camera.move === 'pan-right' ? 1 : camera.move === 'drift' ? DRIFT.pan : 0;
  const push = camera.move === 'push' ? 1 : camera.move === 'pull' ? -1 : camera.move === 'drift' ? DRIFT.push : 0;
  const out = {};
  for (const layer of ['back', 'mid', 'front']) {
    const depth = WORLD_DEPTH[layer];
    // Panning right moves the view right: the world slides left.
    const dx = reach * camera.amount * pan * depth;
    const near = r2(1 + PUSH_SCALE * camera.amount * Math.abs(push) * depth);
    out[layer] = {
      from: {x: r2(dx / 2), scale: push < 0 ? near : 1},
      to: {x: r2(-dx / 2), scale: push > 0 ? near : 1}
    };
  }
  return out;
}

function resolveWorld(params, ctx) {
  const b = createBase('world', params, ctx, {allowed: ['kind', 'time', 'props', 'camera', 'detail', 'scrim', 'foreground'], required: [], hidesCaptions: false});
  const {check, canvas, colors} = b;
  const {kind, time, props, detail} = settings(b, ctx);
  const foreground = b.params.foreground === undefined ? !ctx.castAbove : check.bool(b.params.foreground, 'params.foreground');
  const camera = cameraOf(b);
  const scrimSide = b.params.scrim === undefined ? 'none' : (b.params.scrim === true ? 'auto' : b.params.scrim === false ? 'none' : check.oneOf(b.params.scrim, 'params.scrim', SCRIM_SIDES));
  const style = ctx.cast?.style ?? ctx.cast?.drawing_style ?? null;
  const world = renderWorld({id: b.id, kind, time, colors, canvas, style, detail, props, seed: `${kind}|${time}|${canvas.width}x${canvas.height}`});
  const scrim = scrimFor(world, {text: colors.paper, bg: colors.bg, side: scrimSide === 'none' ? 'auto' : scrimSide});
  const content = {
    kind, time, group: world.group, label: world.label, detail: world.detail.level, style: world.detail.style, foreground,
    camera, states: worldCameraStates(camera, {overscan: world.overscan}),
    light: world.light, anchors: world.anchors, quiet: world.quiet,
    // The scrim a caller can lay over the quiet area; drawn when params.scrim asks.
    scrim: {...scrim, on: scrimSide !== 'none'},
    props: world.props, overscan: world.overscan
  };
  b.model.layer = 'front';
  const model = b.finish(content, {minTextPx: b.min.key});
  model.motion = {...model.motion, enterFrom: {opacity: 0, x: 0, y: 0, scale: 1}, exitTo: {opacity: 0, x: 0, y: 0, scale: 1}};
  model.layout = {...model.layout, rect: {x: 0, y: 0, width: canvas.width, height: canvas.height}, role: 'decor', minTextPx: null};
  model.minTextPx = null;
  // The drawing itself is rebuilt by the view from these inputs (pure), so
  // the model stays small and JSON-safe.
  model.content.render = {kind, time, style, detail: world.detail.level, props: props.map(prop => ({...prop})), seed: `${kind}|${time}|${canvas.width}x${canvas.height}`, foreground};
  return model;
}

/** The rendered world for a model (pure: the same model gives the same nodes). */
export function worldOfModel(model) {
  const r = model.content.render;
  const world = renderWorld({id: model.id, kind: r.kind, time: r.time, colors: model.theme ? {bg: model.theme.bg, primary: model.theme.primary, accent: model.theme.accent, ink: model.theme.ink, paper: model.theme.paper} : {}, canvas: model.canvas,
    style: r.style, detail: r.detail, props: r.props, seed: r.seed});
  return r.foreground === false ? withoutForeground(world) : world;
}

/** A world with an empty front layer (the layer stays, so the camera ops still find it). */
export function withoutForeground(world) {
  return {...world, layers: {...world.layers, front: []}, defs: {...world.defs, front: []}};
}

/** {front, media, overlay} element trees for a world model. */
export function worldView(model) {
  const {id, canvas} = model;
  const W = canvas.width, H = canvas.height;
  const world = worldOfModel(model);
  const kids = worldLayerNodes(world, id);
  if (model.content.scrim.on) kids.push(el('div', `${id}-scrim`, abs(0, 0, W, H, {background: model.content.scrim.css, pointerEvents: 'none'})));
  return {front: el('div', id, abs(0, 0, W, H, {opacity: 0, overflow: 'hidden', background: world.palette.skyLow}), kids), media: null, overlay: null};
}

/** Renderer-neutral ops: the plate's fade and the layers' camera move. */
export function worldTimeline(model) {
  const ops = [];
  const m = model.motion;
  const settled = model.start <= 1 / model.fps + 1e-6;
  if (settled) set(ops, model.id, model.start, {opacity: 1});
  else {
    set(ops, model.id, model.start, {opacity: 0});
    tw(ops, model.id, m.enterStart, m.enterDuration, 'power1.out', {opacity: 0}, {opacity: 1});
  }
  tw(ops, model.id, m.exitStart, m.exitDuration, 'power1.in', {opacity: 1}, {opacity: 0});
  set(ops, model.id, model.end, {opacity: 0});
  const {states, camera} = model.content;
  for (const layer of ['back', 'mid', 'front']) {
    const target = `${model.id}-${layer}`;
    const {from, to} = states[layer];
    const a = {x: from.x, scaleX: from.scale, scaleY: from.scale}, z = {x: to.x, scaleX: to.scale, scaleY: to.scale};
    set(ops, target, model.start, a);
    if (camera.move !== 'still') tw(ops, target, model.start, rt(model.duration), 'sine.inOut', a, z);
  }
  return ops;
}

export const MODULES = {
  world: {
    describe: 'A layered environment drawn in code (inside rooms, streets and outdoor places) at day, dusk or night, recoloured from the brand, with props; the plate behind characters, cards or captions on higher tracks. A slow camera move gives parallax depth.',
    params: {
      kind: `${WORLD_KINDS.join(' | ')} (default: story.world.kind)`,
      time: `${WORLD_TIMES.join(' | ')} (default: story.world.time, else day)`,
      props: `[id | {id, at?: left|centre|right|0..1, on?: surface|counter|ground|floor|wall|sky, scale?, layer?: back|mid|front, flip?}] ≤ 12; ids: ${PROP_IDS.join(', ')}`,
      camera: `${WORLD_CAMERA_MOVES.join(' | ')} or {move, amount 0..1} (default drift)`,
      detail: `${DETAIL_LEVELS.join(' | ')} (default: from story.cast.style)`,
      scrim: `${SCRIM_SIDES.join(' | ')} | true (darken the quiet area for text on top; default none)`,
      foreground: 'boolean: draw the front layer (foreground furniture, parked cars); default true, false when a cast-scene stands in this world'
    },
    events: [],
    timing,
    resolve: resolveWorld
  }
};

export {WORLD_LAYERS};
