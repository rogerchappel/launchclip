// Catalogue D module `photo-scene`: one full-bleed photo or video clip from
// assets/ with a slow Ken Burns move, an optional scrim and 1–3 short kinetic
// text lines. Registered in kit/core/catalog-d.mjs. Contract:
// docs/KIT_CONTRACTS.md ("Photo scene").
//
// Same shape as product-demo: resolve(params, ctx) → a JSON-only model,
// photoSceneView(model) → {media, overlay} (the image or <video>, then the
// scrim and text above it), photoSceneTimeline(model) → renderer-neutral ops.
// A video is root media: HyperFrames lifts it to the composition root, so the
// overlay is hoisted one z-index above it, as product-demo's is. An image
// stays in the scene layer with its overlay.
//
// The move is linear over the whole scene (constant speed, so the frame never
// settles still) and always keeps the canvas covered: a push or pull scales
// about the focus point between 1 and 1 + zoom, and a pan travels at scale
// 1 + zoom no further than the overscan allows. The photo and scrim also bleed
// 64 px (at 1080) past every canvas edge, so a world camera's drift never
// shows their edge. The module moves on its own,
// so ambient hold drift leaves it alone (layout.drift false). Text sits above
// the caption band, so captions stay on.

import {fitText, r2, rt} from './catalog-b-base.mjs';
import {abs, el, set, tw} from './catalog-b-view.mjs';
import {createFootageBase} from './catalog-c.mjs';
import {grammarDuration, grammarEase, grammarStagger} from './grammar.mjs';

export const PHOTO_SCENE_TIMING = Object.freeze({minDuration: 2, fade: 0.4, lineLead: 0.35, lineStagger: 0.45, lineLand: 0.7, leadOut: 0.5});
const T = PHOTO_SCENE_TIMING;
const MOVES = ['push-in', 'pull-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down'];
const SCRIMS = ['none', 'bottom', 'left', 'full'];
const ALIGNS = ['left', 'center'];
const IMAGE = /\.(svg|png|jpe?g|webp)$/i, VIDEO = /\.(mp4|webm|mov)$/i;

function localMedia(check, value, path) {
  const media = typeof value === 'string' ? {src: value} : check.obj(value, path, ['src', 'kind', 'sourceStart'], ['src']);
  const src = media.src;
  if (typeof src !== 'string' || !src.startsWith('assets/') || src.split(/[\\/]/).includes('..') || !/^[a-zA-Z0-9_./ -]+$/.test(src) || !(IMAGE.test(src) || VIDEO.test(src))) {
    check.fail(typeof value === 'string' ? path : `${path}.src`, `must be a project-local assets/ image (.jpg, .png, .webp, .svg) or video (.mp4, .webm, .mov); got ${JSON.stringify(src)}`);
  }
  const kind = media.kind ?? (VIDEO.test(src) ? 'video' : 'image');
  check.oneOf(kind, `${path}.kind`, ['image', 'video']);
  if ((kind === 'video') !== VIDEO.test(src)) check.fail(`${path}.kind`, `is ${kind} but ${src} is ${VIDEO.test(src) ? 'a video' : 'an image'}`);
  if (kind === 'image' && media.sourceStart !== undefined) check.fail(`${path}.sourceStart`, 'is for videos only');
  return {kind, src, sourceStart: kind === 'video' ? (media.sourceStart === undefined ? 0 : check.num(media.sourceStart, `${path}.sourceStart`, 0, 3600)) : null};
}

/** The photo's transform {scale, x, y} at progress p (0–1) of the move, about the focus point. */
export function kenBurnsAt(move, p, {zoom, focus, canvas}) {
  const big = 1 + zoom;
  // Overscan per side at scale `big` (about the focus): what a pan may travel.
  const room = {x: Math.min(focus.x, 1 - focus.x) * canvas.width * zoom, y: Math.min(focus.y, 1 - focus.y) * canvas.height * zoom};
  if (move === 'push-in') return {scale: 1 + zoom * p, x: 0, y: 0};
  if (move === 'pull-out') return {scale: big - zoom * p, x: 0, y: 0};
  const axis = move === 'pan-left' || move === 'pan-right' ? 'x' : 'y';
  // pan-left: the view travels left, so the picture slides right.
  const sign = move === 'pan-left' || move === 'pan-up' ? 1 : -1;
  const travel = room[axis] * 0.9;
  const offset = sign * travel * (2 * p - 1);
  return {scale: big, x: axis === 'x' ? offset : 0, y: axis === 'y' ? offset : 0};
}

function resolvePhotoScene(params, ctx) {
  const b = createFootageBase('photo-scene', params, ctx, {allowed: ['media', 'move', 'zoom', 'focus', 'scrim', 'lines', 'align', 'title'], required: ['media'], minDuration: T.minDuration});
  const {check, canvas, safe, fps, start, end, duration, u, colors, theme} = b;
  const p = b.params;
  const media = localMedia(check, p.media, 'params.media');
  const move = p.move === undefined ? 'push-in' : check.oneOf(p.move, 'params.move', MOVES);
  const zoom = p.zoom === undefined ? 0.08 : check.num(p.zoom, 'params.zoom', 0.02, 0.25);
  let focus = {x: 0.5, y: 0.5};
  if (p.focus !== undefined) {
    check.obj(p.focus, 'params.focus', ['x', 'y'], ['x', 'y']);
    focus = {x: check.num(p.focus.x, 'params.focus.x', 0.15, 0.85), y: check.num(p.focus.y, 'params.focus.y', 0.15, 0.85)};
  }
  const title = p.title === undefined ? null : check.str(p.title, 'params.title', 60);
  const align = p.align === undefined ? 'left' : check.oneOf(p.align, 'params.align', ALIGNS);
  const linesIn = p.lines === undefined ? [] : check.arr(p.lines, 'params.lines', 1, 3);
  const scrim = p.scrim === undefined ? (linesIn.length ? (align === 'center' ? 'full' : 'bottom') : 'none') : check.oneOf(p.scrim, 'params.scrim', SCRIMS);
  if (linesIn.length && scrim === 'none') check.fail('params.scrim', 'must be bottom, left or full when the scene has text lines, so they read over any photo');

  // Text lines: a block in the lower safe zone (above the caption band),
  // left-aligned or centred. Earlier lines are set larger.
  const stagger = grammarStagger(ctx.grammar, T.lineStagger, {min: 0.2, max: 1});
  const width = align === 'center' ? safe.width * 0.9 : safe.width * 0.62;
  const gap = u(14);
  let previousAt = -Infinity;
  const lines = linesIn.map((raw, i) => {
    const path = `params.lines[${i}]`;
    const line = typeof raw === 'string' ? {text: raw} : check.obj(raw, path, ['text', 'at', 'emphasis'], ['text']);
    const text = check.str(line.text, `${path}.text`, 40);
    const at = b.timeOf(`line-${i}`, line.at, `${path}.at`, T.lineLead + i * stagger, {min: 0, max: duration - T.leadOut - 0.3});
    if (at < previousAt) check.fail(`${path}.at`, 'must not be earlier than the previous line');
    previousAt = at;
    const emphasis = line.emphasis === undefined ? false : check.bool(line.emphasis, `${path}.emphasis`);
    const preferred = u(i === 0 ? 96 : 72);
    const fit = fitText(check, `${path}.text`, text, {family: 'display', width, preferred, min: b.min.key, maxLines: 1});
    return {index: i, text, at, emphasis, size: fit.size};
  });
  const blockH = lines.reduce((sum, line) => sum + line.size * 1.12, 0) + gap * Math.max(0, lines.length - 1);
  const bottom = safe.y + safe.height;
  const top = align === 'center' ? safe.y + (safe.height - blockH) / 2 : bottom - blockH;
  let y = top;
  const x = align === 'center' ? safe.x + (safe.width - width) / 2 : safe.x;
  for (const line of lines) {
    line.box = {x: r2(x), y: r2(y), width: r2(width), height: r2(line.size * 1.12)};
    line.color = line.emphasis ? b.resolveColor('primary', `${'params.lines'}[${line.index}].emphasis colour`, 'primary', colors.bg, 'brand.colors.bg') : theme.paper;
    y += line.size * 1.12 + gap;
    b.events.push({id: `${b.id}-line-${line.index}`, name: `line-${line.index}`, time: line.at, endTime: rt(line.at + T.lineLand), role: 'beat'});
  }
  if (lines.length) b.requireContrast('lines/scrim', theme.paper, colors.bg, 'brand.colors.paper on the scrim (brand.colors.bg)');

  // The move, sampled once per frame (a pure function of time; a set per frame, as product-demo's camera).
  const samples = [];
  const first = Math.ceil(start * fps - 1e-6), last = Math.floor(end * fps + 1e-6);
  for (let frame = first; frame <= last; frame++) {
    const t = frame / fps;
    const state = kenBurnsAt(move, Math.min(1, Math.max(0, (t - start) / duration)), {zoom, focus, canvas});
    samples.push({t: rt(t), scale: Math.round(state.scale * 1e5) / 1e5, x: r2(state.x) || 0, y: r2(state.y) || 0});
  }
  const fadeIn = grammarDuration(ctx.grammar, 'enter', T.fade, {min: 0.2, max: 0.8}), fadeOut = grammarDuration(ctx.grammar, 'exit', T.fade, {min: 0.2, max: 0.8});
  b.events.push({id: `${b.id}-enter`, name: 'enter', time: rt(start + fadeIn), role: 'enter'});

  const block = lines.length ? {x: r2(x), y: r2(top), width: r2(width), height: r2(blockH)} : {x: 0, y: 0, width: canvas.width, height: canvas.height};
  // The photo and scrim bleed past the canvas, so a world camera's drift and
  // breathing never show their edge: at least 64 px (at 1080), more for a
  // grammar whose camera drifts or breathes further. layout.bleed tells the
  // compilers to let a world plate show it (plates clip to the canvas).
  const cam = ctx.grammar?.camera ?? {};
  const bleed = r2(Math.max(u(64), (Number(cam.drift) || 0) * b.unit * 1.5 + (Number(cam.breathe) || 0) * 2 * Math.max(canvas.width, canvas.height) / 2 + u(16)));
  const content = {media, move, zoom, focus, scrim, align, title, lines, samples, bleed,
    origin: {x: r2(focus.x * canvas.width), y: r2(focus.y * canvas.height)},
    scrimColor: colors.bg, rise: u(36), lineLand: T.lineLand,
    lineEase: grammarEase(ctx.grammar, 'power3.out', {props: ['y']}), fadeEase: grammarEase(ctx.grammar, 'power2.out', {props: ['opacity']})};
  const model = b.finish(content, {rect: block, role: lines.length ? 'text' : 'decor', minTextPx: lines.length ? Math.min(...lines.map(line => line.size)) : null,
    motion: {enterEnd: rt(start + fadeIn), exitStart: rt(end - fadeOut), enterFrom: {opacity: 0}, exitTo: {opacity: 0}, enterEase: 'power2.out', exitEase: 'power2.in'}});
  // Its own Ken Burns move is the rest motion: hold drift would expose the photo's edges.
  model.layout.drift = false;
  model.layout.bleed = content.bleed;
  return model;
}

// ---------------------------------------------------------------------------
// View and timeline

const SCRIM_GRADIENT = {
  bottom: (c) => `linear-gradient(0deg, ${c}e6 0%, ${c}99 32%, ${c}00 68%)`,
  left: (c) => `linear-gradient(90deg, ${c}e6 0%, ${c}99 38%, ${c}00 72%)`,
  full: (c) => `${c}8c`
};

/** Element trees: {media, overlay}. media is the photo or <video>; overlay holds the scrim and the text lines. */
export function photoSceneView(model) {
  const {id, canvas, fonts} = model;
  const c = model.content;
  const B = c.bleed;
  const style = abs(-B, -B, canvas.width + 2 * B, canvas.height + 2 * B, {objectFit: 'cover', opacity: 0, transformOrigin: `${r2(c.origin.x + B)}px ${r2(c.origin.y + B)}px`, background: '#000000'});
  const media = c.media.kind === 'video'
    ? el('video', `${id}-media`, style, [], {src: c.media.src, muted: '', playsinline: ''})
    : el('img', `${id}-media`, style, [], {src: c.media.src, alt: c.title ?? ''});
  const kids = [];
  if (c.scrim !== 'none') kids.push(el('div', `${id}-scrim`, abs(-B, -B, canvas.width + 2 * B, canvas.height + 2 * B, {background: SCRIM_GRADIENT[c.scrim](c.scrimColor)})));
  for (const line of c.lines) {
    kids.push(el('div', `${id}-line-${line.index}`, abs(line.box.x, line.box.y, line.box.width, line.box.height, {margin: 0, whiteSpace: 'nowrap', textAlign: c.align,
      fontFamily: fonts.display, fontSize: line.size, lineHeight: '1.12', color: line.color, textShadow: `0 ${4 * model.unit}px ${24 * model.unit}px #00000080`, opacity: 0}), [line.text]));
  }
  const overlay = el('div', `${id}-overlay`, abs(0, 0, canvas.width, canvas.height, {opacity: 0, pointerEvents: 'none'}), kids);
  return {media, overlay};
}

/** Renderer-neutral ops: fades on both roots, the per-frame move on the photo, the text lines rising in. */
export function photoSceneTimeline(model) {
  const {id, start, end} = model;
  const c = model.content, m = model.motion;
  const ops = [];
  for (const target of [`${id}-media`, `${id}-overlay`]) {
    set(ops, target, start, {opacity: 0});
    tw(ops, target, start, m.enterDuration, m.enterEase, {opacity: 0}, {opacity: 1});
    tw(ops, target, m.exitStart, m.exitDuration, m.exitEase, {opacity: 1}, {opacity: 0});
    set(ops, target, end, {opacity: 0});
  }
  for (const sample of c.samples) ops.push({type: 'set', target: `${id}-media`, time: Math.max(0, Math.round((sample.t - 0.0005) * 1e6) / 1e6), props: {x: sample.x, y: sample.y, scaleX: sample.scale, scaleY: sample.scale}});
  for (const line of c.lines) {
    const target = `${id}-line-${line.index}`;
    set(ops, target, start, {opacity: 0, x: 0, y: c.rise, scaleX: 1, scaleY: 1});
    tw(ops, target, line.at, c.lineLand * 0.7, c.fadeEase, {opacity: 0}, {opacity: 1});
    tw(ops, target, line.at, c.lineLand, c.lineEase, {y: c.rise}, {y: 0});
  }
  return ops;
}

export const photoScene = {
  id: 'photo-scene',
  describe: 'One full-bleed photo or video from assets/ with a slow Ken Burns move (push, pull or pan), an optional scrim and 1–3 short kinetic text lines above the caption band. Keeps captions.',
  params: {
    media: '"assets/…" image (.jpg|.png|.webp|.svg) or video (.mp4|.webm|.mov), or {src, kind?, sourceStart? (video)}',
    move: 'push-in|pull-out|pan-left|pan-right|pan-up|pan-down (default push-in); linear over the whole scene',
    zoom: '0.02–0.25, how far the move scales (default 0.08: 1 → 1.08)',
    focus: '{x, y} 0.15–0.85 fractions of the frame the push centres on (default {x: 0.5, y: 0.5})',
    scrim: 'none|bottom|left|full (default bottom with lines, full when centred, none without lines)',
    lines: '[{text ≤ 40, at?, emphasis?: true colours it primary}] 1–3 (or strings), rising in stagger apart; at most one line each',
    align: 'left|center (default left)',
    title: 'string ≤ 60, the photo\'s alt text (optional)'
  },
  events: ['enter', 'line-<i>'],
  timing: {minDuration: T.minDuration, leadIn: 0, leadOut: T.leadOut + 0.3, gaps: [],
    rules: [`lines[].at in order (default ${T.lineLead} s, then ${T.lineStagger} s apart, scaled by the grammar); the last at least ${T.leadOut + 0.3} s before the scene ends`]},
  resolve: resolvePhotoScene
};
