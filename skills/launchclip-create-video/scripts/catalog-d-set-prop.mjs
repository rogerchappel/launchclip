// Catalogue D module `set-prop`: one story object placed in the world a cast
// stands in (a fridge with the tally on its door, a sign, a parcel): a drawn
// prop from the world kit (kit/core/worlds/props.mjs) or a project image or
// video from assets/, standing on the world's floor, against its back wall,
// on its counter, or hung on the wall, at a share of the frame's width and a
// real size in metres. Registered in kit/core/catalog-d.mjs. Contract:
// docs/KIT_CONTRACTS.md ("Set prop").
//
// Depth is the track: a set-prop on a lower track than the cast-scene stands
// behind the characters, one on a higher track in front of them. It moves
// with the world camera as the cast's set does (the plate's front layer, frame
// for frame), and in world mode it rides its plate when it shares the
// plate's window (kit/core/camera-world.mjs RIDER_MODULES).
//
// Entrance: cut | fade | pop (a scale from 0.6 about its base, with a little
// overshoot) | from-left | from-right (slides in along its line from outside
// the frame) | drop (falls in from above and settles). By default a prop that
// arrives with the plate beneath (or on the video's first frame) is simply
// there; one that arrives mid-shot pops in. Exit: cut | fade | pop; by
// default it leaves with the plate, else fades.
//
// Same shape as the other catalogue D modules: resolve(params, ctx) → a
// JSON-only model, setPropView(model) → {front, media, overlay}, and
// setPropTimeline(model) → renderer-neutral ops: one set per frame on the prop
// (and its contact shadow) carrying the camera follow and the entrance and
// exit composed, about the canvas centre, so a hoisted <video> moves exactly
// as a drawn prop does.

import {r2, rt} from './catalog-b-base.mjs';
import {abs, el, sampleTime, set} from './catalog-b-view.mjs';
import {createFootageBase} from './catalog-c.mjs';
import {worldCameraStates} from './catalog-world.mjs';
import {OVERSCAN, PROPS, PROP_IDS, WORLD_KINDS, WORLD_TIMES, drawPropAt, worldAnchors} from './worlds/index.mjs';
import {getEase} from './motion.mjs';

export const SET_PROP_TIMING = Object.freeze({minDuration: 0.5, fade: 0.35, pop: 0.45, slide: 0.6, drop: 0.6, exit: 0.3, popScale: 0.6});
const T = SET_PROP_TIMING;
export const SET_PROP_PLACES = Object.freeze(['floor', 'back', 'counter', 'wall']);
export const SET_PROP_ENTERS = Object.freeze(['cut', 'fade', 'pop', 'from-left', 'from-right', 'drop']);
export const SET_PROP_EXITS = Object.freeze(['cut', 'fade', 'pop']);
const AT = {left: 0.2, centre: 0.5, center: 0.5, right: 0.8};
const IMAGE = /\.(svg|png|jpe?g|webp)$/i, VIDEO = /\.(mp4|webm|mov|m4v)$/i;
// Where a drawn prop stands by default, from its own preference list.
const PLACE_OF = {floor: 'floor', ground: 'floor', surface: 'counter', counter: 'counter', wall: 'wall', sky: 'wall'};
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function propMedia(check, value, path) {
  const media = typeof value === 'string' ? {src: value} : check.obj(value, path, ['src', 'kind', 'sourceStart'], ['src']);
  const src = media.src;
  if (typeof src !== 'string' || !src.startsWith('assets/') || src.split(/[\\/]/).includes('..') || !/^[a-zA-Z0-9_./ -]+$/.test(src) || !(IMAGE.test(src) || VIDEO.test(src))) {
    check.fail(typeof value === 'string' ? path : `${path}.src`, `must be a project-local assets/ image (.png, .webp, .svg, .jpg; a cut-out with a transparent background reads best) or video (.mp4, .webm, .mov, .m4v); got ${JSON.stringify(src)}`);
  }
  const kind = media.kind ?? (VIDEO.test(src) ? 'video' : 'image');
  check.oneOf(kind, `${path}.kind`, ['image', 'video']);
  if ((kind === 'video') !== VIDEO.test(src)) check.fail(`${path}.kind`, `is ${kind} but ${src} is ${VIDEO.test(src) ? 'a video' : 'an image'}`);
  if (kind === 'image' && media.sourceStart !== undefined) check.fail(`${path}.sourceStart`, 'is for videos only');
  return {kind, src, sourceStart: kind === 'video' ? (media.sourceStart === undefined ? 0 : check.num(media.sourceStart, `${path}.sourceStart`, 0, 3600)) : null};
}

/** The world the prop stands in: the plate beneath, else story.world. → {kind, time, detail, plate, bleed} | null */
function standingWorld(ctx) {
  const w = ctx.beneath;
  if (w && WORLD_KINDS.includes(w.kind)) return {kind: w.kind, time: w.time ?? 'day', detail: w.detail ?? null, plate: w, bleed: ctx.bleed ? {x: ctx.bleed.x ?? 0, y: ctx.bleed.y ?? 0} : {x: 0, y: 0}};
  const s = ctx.world;
  if (isObject(s) && WORLD_KINDS.includes(s.kind)) return {kind: s.kind, time: WORLD_TIMES.includes(s.time) ? s.time : 'day', detail: s.detail ?? null, plate: null, bleed: {x: 0, y: 0}};
  return null;
}

/**
 * The plate's front-layer camera, as a cast set follows it
 * (catalog-characters.mjs plateFollow). → {start, end, move, from, to} | null
 */
function plateCamera(world, canvas) {
  const w = world?.plate;
  if (!w?.camera) return null;
  const {from, to} = worldCameraStates(w.camera, {overscan: Math.round((canvas.width + 2 * world.bleed.x) * OVERSCAN)}).front;
  return {plate: w.scene, start: w.start, end: Number.isFinite(w.renderEnd) ? w.renderEnd : w.end, move: w.camera.move, from, to};
}

/** The follow state {x, scale} at time t (the world module's sine.inOut move). */
function followAt(follow, t) {
  if (!follow) return {x: 0, scale: 1};
  if (follow.move === 'still' || !(follow.end > follow.start)) return {x: follow.from.x, scale: follow.from.scale};
  const p = getEase('sine.inOut')(Math.min(1, Math.max(0, (t - follow.start) / (follow.end - follow.start))));
  return {x: follow.from.x + (follow.to.x - follow.from.x) * p, scale: follow.from.scale + (follow.to.scale - follow.from.scale) * p};
}

/**
 * How the prop arrives and leaves: params win; else with the plate beneath
 * (a cut, or a fade over its transition when it does not ride the plate),
 * else on the first frame a cut, else a pop in and a fade out.
 */
function passage(b, ctx, check, p) {
  const w = ctx.beneath;
  const near = (a, c) => Number.isFinite(Number(a)) && Math.abs(Number(a) - c) < 1e-3;
  const withPlate = transition => (ctx.rides || !transition || transition.type === 'cut' || !(Number(transition.dur) > 0) ? {type: 'cut'} : {type: 'fade', dur: Math.min(0.8, Number(transition.dur))});
  const fps = b.fps;
  let enter;
  if (p.enter !== undefined) enter = {type: check.oneOf(p.enter, 'params.enter', SET_PROP_ENTERS)};
  else if (b.start <= 1 / fps + 1e-6) enter = {type: 'cut'};
  else if (w && near(w.start, b.start)) enter = withPlate(w.in);
  else if (ctx.passage?.in) enter = {type: 'cut'};
  else enter = {type: 'pop'};
  let exit;
  if (p.exit !== undefined) exit = {type: check.oneOf(p.exit, 'params.exit', SET_PROP_EXITS)};
  else if (w && (near(w.end, b.end) || near(w.renderEnd, b.end))) exit = w.nextIn ? withPlate(w.nextIn) : {type: 'cut'};
  else exit = {type: 'fade'};
  const enterFor = {cut: 0, fade: T.fade, pop: T.pop, 'from-left': T.slide, 'from-right': T.slide, drop: T.drop}[enter.type];
  enter.dur = enter.type === 'fade' && enter.dur ? enter.dur : enterFor;
  exit.dur = exit.type === 'cut' ? 0 : exit.type === 'fade' && exit.dur ? exit.dur : T.exit;
  const room = b.duration / 2;
  enter.dur = rt(Math.min(enter.dur, room));
  exit.dur = rt(Math.min(exit.dur, room));
  return {enter, exit};
}

function resolveSetProp(params, ctx) {
  const b = createFootageBase('set-prop', params, ctx, {allowed: ['prop', 'media', 'on', 'at', 'height', 'width', 'y', 'flip', 'enter', 'exit', 'title'], minDuration: T.minDuration});
  const {check, canvas, fps, start, end, duration, colors} = b;
  const p = b.params;
  if ((p.prop === undefined) === (p.media === undefined)) check.fail('params', 'needs exactly one of prop (a drawn prop id, as world props) or media (an assets/ image or video)');
  const prop = p.prop === undefined ? null : check.oneOf(p.prop, 'params.prop', PROP_IDS);
  const media = p.media === undefined ? null : propMedia(check, p.media, 'params.media');
  const def = prop ? PROPS[prop] : null;
  const preferred = def ? (PLACE_OF[def.on[0]] ?? 'floor') : 'floor';
  const on = p.on === undefined ? preferred : check.oneOf(p.on, 'params.on', SET_PROP_PLACES);
  const at = p.at === undefined ? 0.5 : typeof p.at === 'string' ? AT[check.oneOf(p.at, 'params.at', ['left', 'centre', 'center', 'right'])] : check.num(p.at, 'params.at', 0, 1);
  const height = p.height === undefined ? (def ? def.h : 1.7) : check.num(p.height, 'params.height', 0.05, 6);
  if (prop && p.width !== undefined) check.fail('params.width', 'is for media (a drawn prop keeps its own proportions; set height)');
  const width = def ? def.w * height / def.h : p.width === undefined ? height : check.num(p.width, 'params.width', 0.05, 8);
  const flip = p.flip === undefined ? false : check.bool(p.flip, 'params.flip');
  const title = p.title === undefined ? null : check.str(p.title, 'params.title', 60);

  // The line it stands on (or the centre it hangs at), in frame px, from the
  // world's anchors; params.y (a share of the frame height) overrides it.
  const world = standingWorld(ctx);
  if (!world && p.y === undefined) check.fail('params.y', 'is required when there is no world to stand in (a track-0 world scene beneath, or story.world); or add the world');
  let base, ppm;
  if (world) {
    const drawn = {width: canvas.width + 2 * world.bleed.x, height: canvas.height + 2 * world.bleed.y};
    const anchors = worldAnchors(world.kind, {canvas: drawn, time: world.time});
    const anchor = on === 'floor' ? anchors.ground : on === 'back' ? (anchors.floor ?? anchors.ground) : on === 'counter' ? (anchors.counter ?? anchors.surface) : (anchors.wall ?? null);
    if (!anchor) check.fail('params.on', `"${on}" is not in the ${world.kind} world (it has ${Object.keys(anchors).map(name => ({ground: 'floor', floor: 'back', surface: 'counter'}[name] ?? name)).join(', ')}); set params.y instead`);
    base = anchor.y - world.bleed.y;
    ppm = anchor.ppm;
  } else ppm = (canvas.height > canvas.width ? 330 : 290) * b.unit;
  if (p.y !== undefined) base = check.num(p.y, 'params.y', 0, 1) * canvas.height;
  const s = ppm * height / (def ? def.h : height);
  const w = r2(width * ppm), h = r2(height * ppm);
  const cx = r2(at * canvas.width);
  const rect = {x: r2(cx - w / 2), y: r2(on === 'wall' ? base - h / 2 : base - h), width: w, height: h};
  // The point the prop pops and settles about: its base, or its centre on a wall.
  const pivot = {x: cx, y: r2(base)};

  const follow = plateCamera(world, canvas);
  const {enter, exit} = passage(b, ctx, check, p);
  const exitStart = rt(end - exit.dur);
  // Slides start just outside the frame on their side; a drop from above it.
  const slide = enter.type === 'from-left' ? -(rect.x + rect.width + b.u(40)) : enter.type === 'from-right' ? canvas.width - rect.x + b.u(40) : 0;
  const drop = enter.type === 'drop' ? -(rect.y + rect.height + b.u(40)) : 0;

  // One sample per frame: the follow (x, scale about the canvas centre), the
  // entrance (scale e about the pivot, offset d) and the opacity.
  const ease = {pop: getEase('back.out(1.7)'), slide: getEase('power3.out'), drop: getEase('bounce.out'), fade: getEase('power2.out'), out: getEase('power2.in')};
  const centre = {x: canvas.width / 2, y: canvas.height / 2};
  const samples = [];
  const first = Math.ceil(start * fps - 1e-6), last = Math.floor(end * fps + 1e-6);
  for (let n = first; n <= last; n++) {
    const t = n / fps;
    const f = followAt(follow, t);
    let e = 1, dx = 0, dy = 0, opacity = 1;
    const pin = enter.dur > 0 ? Math.min(1, Math.max(0, (t - start) / enter.dur)) : 1;
    if (enter.type === 'fade') opacity = ease.fade(pin);
    else if (enter.type === 'pop') { e = T.popScale + (1 - T.popScale) * ease.pop(pin); opacity = Math.min(1, pin / 0.25); }
    else if (enter.type === 'from-left' || enter.type === 'from-right') dx = slide * (1 - ease.slide(pin));
    else if (enter.type === 'drop') dy = drop * (1 - ease.drop(pin));
    if (exit.type !== 'cut' && t > exitStart + 1e-9) {
      const pout = exit.dur > 0 ? Math.min(1, (t - exitStart) / exit.dur) : 1;
      opacity *= 1 - ease.out(pout);
      if (exit.type === 'pop') e *= 1 - (1 - T.popScale) * ease.out(pout);
    }
    const scale = f.scale * e;
    const flipped = flip && media;
    const X = (pivot.x - centre.x) * f.scale + (flipped ? e * f.scale * (2 * cx - pivot.x - centre.x) : -e * f.scale * (pivot.x - centre.x)) + dx * f.scale + f.x;
    const Y = (pivot.y - centre.y) * f.scale * (1 - e) + dy * f.scale;
    samples.push({t: rt(t), x: r2(X) || 0, y: r2(Y) || 0, scaleX: Math.round((flipped ? -scale : scale) * 1e5) / 1e5, scaleY: Math.round(scale * 1e5) / 1e5, opacity: Math.round(Math.max(0, Math.min(1, opacity)) * 1e4) / 1e4});
  }

  if (enter.type !== 'cut') b.events.push({id: `${b.id}-enter`, name: 'enter', time: rt(start), endTime: rt(start + enter.dur), role: 'enter', ...(enter.type === 'pop' || enter.type === 'drop' ? {cue: 'pop'} : enter.type.startsWith('from-') ? {cue: 'whoosh-soft'} : {})});
  // The look of a drawn prop: the world's time and palette, at the cast's detail.
  const look = prop ? {kind: world?.kind ?? 'park', time: world?.time ?? 'day', style: ctx.cast?.style ?? ctx.cast?.drawing_style ?? null, detail: world?.detail ?? null,
    colors: {bg: colors.bg, primary: colors.primary, accent: colors.accent, ink: colors.ink, paper: colors.paper}} : null;
  const content = {prop, media, on, at, height, width, flip, title, ppm: r2(ppm), scale: r2(s), base: r2(base), rect, pivot, centre, enter, exit,
    follow, shadow: on !== 'wall' && Boolean(media) && media.kind === 'image', look, samples};
  const visible = {x: r2(Math.max(0, rect.x)), y: r2(Math.max(0, rect.y)), width: 0, height: 0};
  visible.width = r2(Math.max(1, Math.min(canvas.width, rect.x + rect.width) - visible.x));
  visible.height = r2(Math.max(1, Math.min(canvas.height, rect.y + rect.height) - visible.y));
  const model = b.finish(content, {rect: visible, role: 'media', minTextPx: null,
    motion: {enterEnd: rt(start + enter.dur), exitStart, enterFrom: {opacity: enter.type === 'cut' ? 1 : 0}, exitTo: {opacity: exit.type === 'cut' ? 1 : 0}, enterEase: 'power2.out', exitEase: 'power2.in'}});
  // A prop is part of the set: the characters may stand in front of it or behind it,
  // it never takes the ambient hold drift (it moves with the world camera only),
  // and a playing video counts as motion.
  model.layout.allowOcclusion = ['*'];
  model.layout.drift = false;
  model.layout.live = Boolean(media && media.kind === 'video');
  return model;
}

// ---------------------------------------------------------------------------
// View and timeline

/** {front, media, overlay}: front holds a drawn prop or an image (with its contact shadow); a video is `media` alone. */
export function setPropView(model) {
  const {id, canvas} = model;
  const c = model.content, R = c.rect;
  const origin = (box) => `${r2(c.centre.x - box.x)}px ${r2(c.centre.y - box.y)}px`;
  const kids = [];
  let media = null;
  if (c.shadow) {
    const sw = R.width * 0.9, sh = Math.max(6, R.width * 0.12);
    const box = {x: r2(c.rect.x + (R.width - sw) / 2), y: r2(c.base - sh / 2), width: r2(sw), height: r2(sh)};
    kids.push(el('div', `${id}-shadow`, abs(box.x, box.y, box.width, box.height, {borderRadius: '50%', background: 'radial-gradient(closest-side, #00000059, #00000026 60%, #00000000)', opacity: 0, transformOrigin: origin(box)})));
  }
  const fit = {objectFit: 'contain', objectPosition: c.on === 'wall' ? '50% 50%' : '50% 100%'};
  if (c.prop) {
    const L = c.look;
    const drawn = drawPropAt({id: c.prop, kind: L.kind, time: L.time, colors: L.colors, style: L.style, detail: L.detail, x: c.rect.x + R.width / 2, y: c.on === 'wall' ? c.rect.y + R.height / 2 : c.base, s: c.scale,
      anchor: c.on === 'wall' ? 'wall' : c.on === 'counter' ? 'surface' : 'floor', flip: c.flip, canvas, key: `${id}-p`});
    const defs = drawn.defs.length ? [el('defs', null, null, drawn.defs)] : [];
    const svg = el('svg', null, {position: 'absolute', left: 0, top: 0, overflow: 'visible'}, [...defs, ...drawn.nodes], {width: R.width, height: R.height, viewBox: `${R.x} ${R.y} ${R.width} ${R.height}`, fill: 'none'});
    kids.push(el('div', `${id}-prop`, abs(R.x, R.y, R.width, R.height, {opacity: 0, overflow: 'visible', transformOrigin: origin(R)}), [svg], {'data-layout-allow-overflow': 'true'}));
  } else if (c.media.kind === 'image') {
    kids.push(el('img', `${id}-prop`, abs(R.x, R.y, R.width, R.height, {...fit, opacity: 0, transformOrigin: origin(R)}), [], {src: c.media.src, alt: c.title ?? ''}));
  } else {
    media = el('video', `${id}-prop`, abs(R.x, R.y, R.width, R.height, {...fit, opacity: 0, transformOrigin: origin(R)}), [], {src: c.media.src, muted: '', playsinline: ''});
  }
  const front = kids.length ? el('div', id, abs(0, 0, canvas.width, canvas.height, {pointerEvents: 'none'}), kids) : null;
  return {front, media, overlay: null};
}

/** Renderer-neutral ops: one set per frame on the prop (and its shadow), skipping repeats. */
export function setPropTimeline(model) {
  const {id, end} = model;
  const c = model.content;
  const targets = [`${id}-prop`, ...(c.shadow ? [`${id}-shadow`] : [])];
  const ops = [];
  let previous = null;
  for (const sample of c.samples) {
    const props = {x: sample.x, y: sample.y, scaleX: sample.scaleX, scaleY: sample.scaleY, opacity: sample.opacity};
    const key = JSON.stringify(props);
    if (key === previous) continue;
    previous = key;
    for (const target of targets) ops.push({type: 'set', target, time: Math.max(0, sampleTime(sample.t)), props});
  }
  for (const target of targets) set(ops, target, end, {opacity: 0});
  return ops;
}

export const setProp = {
  id: 'set-prop',
  describe: 'One story object placed in the world a cast stands in: a drawn prop (fridge, bookshelf, washing machine…) or a project image or video from assets/, on the floor, against the back wall, on the counter or on the wall, sized in metres to match the cast. Its track sets its depth (below the cast-scene: behind the characters; above: in front). Moves with the world camera; pops, slides or drops in. Keeps captions.',
  params: {
    prop: 'a drawn prop id from the world kit (the world module\'s props list), such as fridge, washing-machine, bookshelf, microwave, toaster, plant, boxes or whiteboard',
    media: '"assets/…" image (.png|.webp|.svg|.jpg; a transparent cut-out reads best) or video (.mp4|.webm|.mov|.m4v), or {src, kind?, sourceStart? (video)}; exactly one of prop or media',
    on: `${SET_PROP_PLACES.join(' | ')} (default: floor, or the drawn prop's own place): floor = the line the cast stands on; back = against the back wall; counter = the world's counter or worktop; wall = hung on the wall, centred on its line`,
    at: 'left | centre | right | 0–1, the share of the frame width its centre stands at (default centre; left 0.2, right 0.8)',
    height: 'metres, 0.05–6 (default: a drawn prop\'s own height, media 1.7), scaled by the world\'s px per metre so it matches the cast',
    width: 'metres, 0.05–8, media only (default: the height): the box the media fits in, standing on its base',
    y: '0–1 share of the frame height: the line it stands on (its centre on a wall); overrides the world; required without a world',
    flip: 'boolean: mirror it',
    enter: `${SET_PROP_ENTERS.join(' | ')} (default: with the plate beneath when it starts with it, cut on the first frame, else pop)`,
    exit: `${SET_PROP_EXITS.join(' | ')} (default: with the plate beneath when it ends with it, else fade)`,
    title: 'string ≤ 60, what it is (alt text, optional)'
  },
  events: ['enter'],
  timing: {minDuration: T.minDuration, leadIn: 0, leadOut: 0, gaps: [],
    rules: ['put it on a lower track than the cast-scene to stand behind the characters, a higher track to stand in front of them', 'give it the plate\'s window to have it there all shot (in world mode it then rides the plate); start it later to pop it in on a beat']},
  resolve: resolveSetProp
};
