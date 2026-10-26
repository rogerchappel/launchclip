// Worlds (docs/SEEDED_STYLES_RFC.md §3.5, phase 5): layered environments
// drawn in code, for a `world` scene behind characters, cards or captions.
//
//   renderWorld({id, kind, time, colors, canvas, style?, detail?, props?})
//     → {layers: {back, mid, front, fx}, defs, anchors, quiet, light, …}
//
// - kind: one of WORLD_KINDS (inside, street and outside groups).
// - time: day | dusk | night. Night brings lit windows, street lamps,
//   neon, stars and moonlight; dusk a warm low sun.
// - colors: the brand palette {bg, primary, accent, ink, paper}; a world
//   recolours from it and keeps the time's mood (palette.mjs).
// - style / detail: the cast's drawing style picks the detail level
//   (detail.mjs); detail overrides it.
// - props: prop placements (props.mjs), drawn at the same detail.
//
// Layers are back (sky or wall), mid (the room or street), front
// (foreground furniture) and fx (light effects, never parallaxed); each is
// a canvas-sized SVG drawn `overscan` px past the left and right edges, so
// a camera move inside the scene never shows an edge.
//
// Pure and deterministic: the same inputs give the same nodes.

import {detailForStyle, detailSpec, DETAIL_LEVELS, STYLE_DETAIL} from './detail.mjs';
import {WORLD_TIMES, worldPalette, timeLight, timeGrade} from './palette.mjs';
import {makePen} from './pen.mjs';
import {vignette, grade} from './common.mjs';
import {INSIDE} from './inside.mjs';
import {STREET} from './street.mjs';
import {OUTSIDE} from './outside.mjs';
import {PROPS, PROP_IDS, placeProps, propEntry} from './props.mjs';
import {propMotion} from '../physics.mjs';

export {WORLD_TIMES, DETAIL_LEVELS, STYLE_DETAIL, PROPS, PROP_IDS, worldPalette};
export {TOPIC_FIT, suggestWorld} from './fit.mjs';

/** World definitions keyed by kind, in group order (inside, street, outside). */
export const WORLDS = Object.freeze({...INSIDE, ...STREET, ...OUTSIDE});
export const WORLD_KINDS = Object.freeze(Object.keys(WORLDS));
export const WORLD_GROUPS = Object.freeze({inside: Object.keys(INSIDE), street: Object.keys(STREET), outside: Object.keys(OUTSIDE)});

/** Overscan past each side, as a share of the canvas width. */
export const OVERSCAN = 0.08;

/** Light a world throws on characters at a time: {dir: {x, y}, color, intensity}. */
export function worldLight(kind, time = 'day') {
  const def = WORLDS[kind];
  if (!def) throw new Error(`unknown world kind ${JSON.stringify(kind)} (kinds: ${WORLD_KINDS.join(', ')})`);
  if (!WORLD_TIMES.includes(time)) throw new Error(`unknown world time ${JSON.stringify(time)} (${WORLD_TIMES.join(', ')})`);
  return timeLight(time, {inside: def.group === 'inside', ...(def.light?.[time] ?? {})});
}

/**
 * The grade a world at a time puts on what stands in it, as hex → hex
 * (palette.mjs timeGrade): its materials at strength 1, characters less.
 */
export function worldGrade(kind, time = 'day', strength = 1) {
  const def = WORLDS[kind];
  if (!def) throw new Error(`unknown world kind ${JSON.stringify(kind)} (kinds: ${WORLD_KINDS.join(', ')})`);
  return timeGrade(time, def.group === 'inside' ? 'inside' : 'outside', strength);
}

/** The world kit every drawing function receives. */
function worldKit({id, kind, time, colors, canvas, detail, seed}) {
  const def = WORLDS[kind];
  const W = canvas.width, H = canvas.height;
  const u = Math.min(W, H) / 1080;
  const portrait = H > W;
  const pal = worldPalette(colors, time, def.group === 'inside' ? 'inside' : 'outside');
  const p = makePen({id, detail, pal, u, seed: seed ?? `${kind}|${time}|${W}x${H}`});
  // Pixels per metre at the ground line (a person is about 1.7 m).
  const ppm = (portrait ? 330 : 290) * u;
  return {id, kind, time, W, H, u, portrait, pal, p, d: detail, ov: Math.round(W * OVERSCAN), ppm, def};
}

/**
 * Draw a world. → {kind, group, time, detail, layers: {back, mid, front,
 * fx}: node arrays, defs: {layer: gradient nodes}, anchors, quiet, light,
 * overscan, props: placed props}.
 */
export function renderWorld({id = 'world', kind, time = 'day', colors = {}, canvas = {width: 1920, height: 1080}, style = null, detail = null, props = [], seed = null} = {}) {
  const def = WORLDS[kind];
  if (!def) throw new Error(`unknown world kind ${JSON.stringify(kind)} (kinds: ${WORLD_KINDS.join(', ')})`);
  if (!WORLD_TIMES.includes(time)) throw new Error(`unknown world time ${JSON.stringify(time)} (${WORLD_TIMES.join(', ')})`);
  const spec = detailSpec(detail ?? detailForStyle(style), style);
  const k = worldKit({id, kind, time, colors, canvas, detail: spec, seed});
  const {p} = k;
  const geo = def.geo(k);
  const layers = {};
  p.at('back'); layers.back = def.back(k, geo).flat(Infinity).filter(Boolean);
  p.at('mid'); layers.mid = def.mid(k, geo).flat(Infinity).filter(Boolean);
  p.at('front'); layers.front = (def.front ? def.front(k, geo) : []).flat(Infinity).filter(Boolean);
  // Props sit on the world's anchors, drawn into the layer they belong to.
  const placed = placeProps(k, geo.anchors, props);
  for (const item of placed) {
    p.at(item.layer);
    layers[item.layer].push(...item.nodes);
  }
  p.at('fx');
  layers.fx = [...(def.fx ? def.fx(k, geo) : []), ...(spec.grade ? grade(k) : []), ...vignette(k, spec.vignette)].flat(Infinity).filter(Boolean);
  const defs = Object.fromEntries(['back', 'mid', 'front', 'fx'].map(name => [name, p.defsOf(name)]));
  return {
    kind, group: def.group, label: def.label, time, detail: spec, canvas: {width: k.W, height: k.H}, overscan: k.ov,
    layers, defs, anchors: geo.anchors, quiet: geo.quiet, light: worldLight(kind, time), palette: k.pal,
    props: placed.map(({id: pid, anchor, x, y, scale, layer, rect}) => ({id: pid, anchor, x, y, scale, layer, rect, motion: propMotion(pid)}))
  };
}

/**
 * Where things stand in a world, without drawing it: its anchors ({ground:
 * {y, x0, x1, ppm}, floor?, wall?, surface?}) on a canvas.
 */
export function worldAnchors(kind, {canvas = {width: 1920, height: 1080}, time = 'day', colors = {}} = {}) {
  const def = WORLDS[kind];
  if (!def) throw new Error(`unknown world kind ${JSON.stringify(kind)} (kinds: ${WORLD_KINDS.join(', ')})`);
  const k = worldKit({id: 'anchors', kind, time, colors, canvas, detail: detailSpec(detailForStyle(null), null)});
  return def.geo(k).anchors;
}

export const FOCUS_POINTS = Object.freeze(['far', 'window', 'horizon', 'street', 'skyline']);

/**
 * Where a character can look in a world (canvas px): the window of an inside
 * world, the horizon (or the far side of a street), the street across from
 * the kerb, and the skyline above the horizon; `far` is the window when
 * there is one, else the horizon. A point's x is null when the world gives
 * none (a horizon spans the frame): the looker picks its side.
 * props: placed props {id, x, y} (params.props), for a {prop} gaze target.
 * → {far, window, horizon, street, skyline: {x, y, far: boolean} | null, props}
 */
export function worldFocus(kind, {canvas = {width: 1920, height: 1080}, time = 'day', props = []} = {}) {
  const def = WORLDS[kind];
  if (!def) throw new Error(`unknown world kind ${JSON.stringify(kind)} (kinds: ${WORLD_KINDS.join(', ')})`);
  const k = worldKit({id: 'focus', kind, time, colors: {}, canvas, detail: detailSpec(detailForStyle(null), null)});
  const g = def.geo(k);
  const H = k.H;
  const win = g.win ? {x: Math.round(g.win.x + g.win.w / 2), y: Math.round(g.win.y + g.win.h / 2), far: true} : null;
  const horizonY = g.horizonY ?? g.vanishY ?? g.waterY ?? g.baseY ?? (win ? win.y : Math.round((g.floorY ?? H * 0.7) * 0.45));
  const horizon = {x: win?.x ?? null, y: Math.round(horizonY), far: true};
  const street = g.baseY !== undefined ? {x: null, y: Math.round(g.baseY), far: true} : win ?? horizon;
  const skyline = {x: horizon.x, y: Math.round(Math.max(0, horizonY - H * 0.12)), far: true};
  let placed = [];
  try { placed = placeProps(k, g.anchors, props).map(item => ({id: item.id, x: Math.round(item.x), y: Math.round(item.y)})); } catch { placed = []; }
  return {far: win ?? horizon, window: win, horizon, street, skyline, props: placed};
}

/**
 * One prop on its own, fitted into box {x, y, width, height} (canvas px):
 * for prop sheets and previews. → {nodes, defs}.
 */
export function drawProp({id, time = 'day', colors = {}, style = null, detail = null, box, canvas = {width: 1920, height: 1080}, key = 'prop'} = {}) {
  propEntry(id);
  const spec = detailSpec(detail ?? detailForStyle(style), style);
  const k = worldKit({id: key, kind: 'park', time, colors, canvas, detail: spec, seed: `${id}|${time}`});
  k.p.at('mid');
  const def = PROPS[id];
  const s = Math.min(box.height * 0.8 / def.h, box.width * 0.8 / def.w);
  const anchor = def.on[0] === 'wall' ? 'wall' : def.on[0];
  const y = anchor === 'wall' ? box.y + box.height / 2 : box.y + box.height * 0.9;
  const nodes = def.draw(k, box.x + box.width / 2, y, s, anchor).flat(Infinity).filter(Boolean);
  return {nodes, defs: k.p.defsOf('mid')};
}

/**
 * Errors in a video-wide world ({kind, time?, props?, detail?}: story.world,
 * or a style pack's world). → string[].
 */
export function storyWorldErrors(world, path = 'world') {
  const errors = [];
  if (!world || typeof world !== 'object' || Array.isArray(world)) return [`${path} must be {kind, time?, props?, detail?}`];
  for (const key of Object.keys(world)) if (!['kind', 'time', 'props', 'detail'].includes(key)) errors.push(`${path}.${key} is not a world field (kind, time, props, detail)`);
  if (world.kind !== undefined && !WORLD_KINDS.includes(world.kind)) errors.push(`${path}.kind must be one of ${WORLD_KINDS.join(', ')}`);
  if (world.time !== undefined && !WORLD_TIMES.includes(world.time)) errors.push(`${path}.time must be one of ${WORLD_TIMES.join(', ')}`);
  if (world.detail !== undefined && !DETAIL_LEVELS.includes(world.detail)) errors.push(`${path}.detail must be one of ${DETAIL_LEVELS.join(', ')}`);
  if (world.props !== undefined) {
    if (!Array.isArray(world.props) || world.props.length > 12) errors.push(`${path}.props must be a list of up to 12 props`);
    else world.props.forEach((entry, i) => { try { propEntry(entry, `${path}.props[${i}]`); } catch (error) { errors.push(error.message); } });
  }
  return errors;
}

/** A short line per world for planners: "office (inside): …". */
export function worldCatalogue() {
  return WORLD_KINDS.map(kind => ({kind, group: WORLDS[kind].group, label: WORLDS[kind].label, describe: WORLDS[kind].describe}));
}
