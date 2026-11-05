// Catalogue D module `clip`: one full-frame shot of supplied footage (an
// assets/ video or still) cut to the narration, so a narrated story can be
// carried by real footage with graphics dressed on top or cut between.
// Registered in kit/core/catalog-d.mjs. Contract: docs/KIT_CONTRACTS.md
// ("Clip").
//
// Same shape as photo-scene: resolve(params, ctx) → a JSON-only model,
// clipView(model) → {media, overlay} (the <video> or image, then the callout
// pills above it), clipTimeline(model) → renderer-neutral ops. A video is
// root media: HyperFrames lifts it to the composition root, so the overlay is
// hoisted one z-index above it. A still stays in the scene layer with its
// overlay.
//
// What it does, and how it differs from photo-scene (a mood shot with a
// scrim and kinetic lines):
// - Crop to the target aspect: the source is drawn object-fit: cover about
//   `focus` (object-position), so a 16:9 clip in a 9:16 story keeps the part
//   that matters.
// - Source window: a video plays from media.sourceStart; media.sourceEnd, when
//   given, bounds it, and the scene must fit inside the window.
// - Motion: a gentle Ken Burns move on stills (push-in by default, 6%); a
//   video holds its frame (the footage moves) unless a move is asked for, or
//   the grammar is cinematic (a 3% push). The entrance follows the motion
//   grammar: `cut` (the default; the story's scene.in transition does the
//   dressing), `fade`, or `settle` (a scale settle with no dip to the
//   background; the default under snappy and playful).
// - Callouts: 0–3 short pills in one slot (bottom or top of the safe zone,
//   above the caption band), one after another, so a clip-led story can carry
//   its key words without cutting away.
//
// The move and the settle are sampled once per frame (a set per frame, as
// photo-scene's move), so the scale and the pan compose exactly in both
// renderers. The module moves on its own (layout.drift false, layout.live
// true while the footage plays or the still moves), and its footage fills
// the frame (role "media", which other scenes may sit over).

import {fitText, r2, rt, textWidth} from './catalog-b-base.mjs';
import {abs, el, set, tw} from './catalog-b-view.mjs';
import {createFootageBase} from './catalog-c.mjs';
import {kenBurnsAt} from './catalog-d-photo-scene.mjs';
import {grammarDuration, grammarEase} from './grammar.mjs';
import {getEase} from './motion.mjs';

// The callout pills' preferred type size (canvas units, before fitting to
// the width). A phone shows a 9:16 frame about 6 cm wide: at 64 the pills
// read as small print beside the captions, so portrait pills start larger.
// A portrait pill that would set under twoLineBelow on one line wraps to two.
export const CALLOUT_PX = Object.freeze({portrait: 76, landscape: 58, twoLineBelow: 68});
export const CLIP_TIMING = Object.freeze({minDuration: 1, fade: 0.35, settle: 0.6, settleScale: 0.06, calloutLead: 0.3, calloutFade: 0.3, calloutGap: 0.15, leadOut: 0.35, minHold: 1.2, perWord: 0.22});
const T = CLIP_TIMING;
export const CLIP_MOVES = Object.freeze(['none', 'push-in', 'pull-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down']);
export const CLIP_ENTERS = Object.freeze(['cut', 'fade', 'settle']);
const EXITS = ['cut', 'fade'];
const POSITIONS = ['bottom', 'top'];
const IMAGE = /\.(svg|png|jpe?g|webp)$/i, VIDEO = /\.(mp4|webm|mov|m4v)$/i;
// Grammars whose entrances settle rather than cut.
const SETTLE_GRAMMARS = ['snappy', 'playful'];

function clipMedia(check, value, path, duration) {
  const media = typeof value === 'string' ? {src: value} : check.obj(value, path, ['src', 'kind', 'sourceStart', 'sourceEnd'], ['src']);
  const src = media.src;
  if (typeof src !== 'string' || !src.startsWith('assets/') || src.split(/[\\/]/).includes('..') || !/^[a-zA-Z0-9_./ -]+$/.test(src) || !(IMAGE.test(src) || VIDEO.test(src))) {
    check.fail(typeof value === 'string' ? path : `${path}.src`, `must be a project-local assets/ video (.mp4, .webm, .mov, .m4v) or still (.jpg, .png, .webp, .svg); got ${JSON.stringify(src)}`);
  }
  const kind = media.kind ?? (VIDEO.test(src) ? 'video' : 'image');
  check.oneOf(kind, `${path}.kind`, ['image', 'video']);
  if ((kind === 'video') !== VIDEO.test(src)) check.fail(`${path}.kind`, `is ${kind} but ${src} is ${VIDEO.test(src) ? 'a video' : 'a still'}`);
  if (kind === 'image') {
    for (const key of ['sourceStart', 'sourceEnd']) if (media[key] !== undefined) check.fail(`${path}.${key}`, 'is for videos only');
    return {kind, src, sourceStart: null, sourceEnd: null};
  }
  const sourceStart = media.sourceStart === undefined ? 0 : check.num(media.sourceStart, `${path}.sourceStart`, 0, 3600);
  let sourceEnd = null;
  if (media.sourceEnd !== undefined) {
    sourceEnd = check.num(media.sourceEnd, `${path}.sourceEnd`, 0, 3600);
    if (sourceEnd <= sourceStart) check.fail(`${path}.sourceEnd`, `must be after sourceStart (${sourceStart} s); got ${sourceEnd} s`);
    // The scene plays the window from sourceStart; it may not run past sourceEnd.
    if (sourceEnd - sourceStart + 1e-6 < duration) check.fail(`${path}.sourceEnd`, `leaves a ${r2(sourceEnd - sourceStart)} s source window (${sourceStart}–${sourceEnd} s) for a ${r2(duration)} s scene; shorten the scene or widen the window`);
  }
  return {kind, src, sourceStart, sourceEnd};
}

function resolveClip(params, ctx) {
  const b = createFootageBase('clip', params, ctx, {allowed: ['media', 'focus', 'move', 'zoom', 'enter', 'exit', 'callouts', 'position', 'title'], required: ['media'], minDuration: T.minDuration});
  const {check, canvas, safe, fps, start, end, duration, u, colors, theme} = b;
  const p = b.params;
  const media = clipMedia(check, p.media, 'params.media', duration);
  const grammarId = ctx.grammar?.id ?? ctx.grammar?.base ?? 'editorial';
  const defaultMove = media.kind === 'image' ? 'push-in' : grammarId === 'cinematic' ? 'push-in' : 'none';
  const move = p.move === undefined ? defaultMove : check.oneOf(p.move, 'params.move', CLIP_MOVES);
  const zoom = move === 'none' ? 0 : p.zoom === undefined ? (media.kind === 'image' ? 0.06 : 0.03) : check.num(p.zoom, 'params.zoom', 0.02, 0.15);
  if (move === 'none' && p.zoom !== undefined) check.fail('params.zoom', 'needs a move (push-in, pull-out or a pan)');
  // focus: the point of the source that stays in frame when it is cropped to the canvas aspect.
  let focus = {x: 0.5, y: 0.5};
  if (p.focus !== undefined) {
    check.obj(p.focus, 'params.focus', ['x', 'y'], ['x', 'y']);
    focus = {x: check.num(p.focus.x, 'params.focus.x', 0, 1), y: check.num(p.focus.y, 'params.focus.y', 0, 1)};
  }
  // The move scales about the focus, kept off the very edge so a pan still has room to travel.
  const pivot = {x: Math.min(0.85, Math.max(0.15, focus.x)), y: Math.min(0.85, Math.max(0.15, focus.y))};
  const enter = p.enter === undefined ? (SETTLE_GRAMMARS.includes(grammarId) ? 'settle' : 'cut') : check.oneOf(p.enter, 'params.enter', CLIP_ENTERS);
  const exit = p.exit === undefined ? 'cut' : check.oneOf(p.exit, 'params.exit', EXITS);
  const title = p.title === undefined ? null : check.str(p.title, 'params.title', 60);
  const position = p.position === undefined ? 'bottom' : check.oneOf(p.position, 'params.position', POSITIONS);

  const fadeIn = grammarDuration(ctx.grammar, 'enter', T.fade, {min: 0.2, max: 0.8});
  const settleFor = Math.min(duration / 2, grammarDuration(ctx.grammar, 'enter', T.settle, {min: 0.3, max: 1.2}));
  const fadeOut = grammarDuration(ctx.grammar, 'exit', T.fade, {min: 0.2, max: 0.8});
  const enterFor = enter === 'fade' ? Math.min(fadeIn, duration / 3) : enter === 'settle' ? settleFor : 0;
  const exitFor = exit === 'fade' ? Math.min(fadeOut, duration / 3) : 0;

  // Callouts: pills in one slot, one after another, each held for its reading time.
  const calloutsIn = p.callouts === undefined ? [] : check.arr(p.callouts, 'params.callouts', 1, 3);
  const portrait = canvas.height > canvas.width;
  const padX = u(26), padY = u(14);
  const maxWidth = safe.width * (portrait ? 1 : 0.7);
  const lastEnd = duration - T.leadOut;
  const parsed = calloutsIn.map((raw, i) => {
    const path = `params.callouts[${i}]`;
    const callout = typeof raw === 'string' ? {text: raw} : check.obj(raw, path, ['text', 'at', 'until', 'emphasis'], ['text']);
    return {index: i, path, text: check.str(callout.text, `${path}.text`, 36), raw: callout};
  });
  const slot = parsed.length ? (lastEnd - T.calloutLead) / parsed.length : 0;
  let previousUntil = -Infinity;
  const callouts = parsed.map(({index: i, path, text, raw}) => {
    const at = b.timeOf(`callout-${i}`, raw.at, `${path}.at`, T.calloutLead + i * slot, {min: 0, max: lastEnd - T.minHold});
    if (at < previousUntil + T.calloutGap - 1e-6) check.fail(`${path}.at`, `must come at least ${T.calloutGap} s after the previous callout leaves (callouts share one slot)`);
    const nextDefault = i + 1 < parsed.length ? T.calloutLead + (i + 1) * slot - T.calloutGap : lastEnd;
    const until = raw.until === undefined ? rt(start + Math.max(at - start + T.minHold, nextDefault)) : rt(start + check.num(raw.until, `${path}.until`, 0, duration));
    const words = text.split(/\s+/).filter(Boolean).length;
    const hold = Math.max(T.minHold, words * T.perWord);
    if (until - at + 1e-6 < hold) check.fail(raw.until === undefined ? `${path}.at` : `${path}.until`, `leaves "${text}" on screen ${r2(until - at)} s; it needs ${r2(hold)} s to read (${T.perWord} s a word, at least ${T.minHold} s)`);
    if (until > start + lastEnd + 1e-6) check.fail(`${path}.until`, `must be at least ${T.leadOut} s before the scene ends`);
    previousUntil = until;
    const emphasis = raw.emphasis === undefined ? false : check.bool(raw.emphasis, `${path}.emphasis`);
    const fitWidth = maxWidth - 2 * padX;
    const preferred = u(portrait ? CALLOUT_PX.portrait : CALLOUT_PX.landscape);
    let fit = fitText(check, `${path}.text`, text, {family: 'display', width: fitWidth, preferred, min: b.min.key, maxLines: 1});
    // A long pill in a portrait frame takes two lines rather than shrinking
    // to small print (CALLOUT_PX.twoLineBelow).
    if (portrait && fit.size < u(CALLOUT_PX.twoLineBelow) && /\s/.test(text)) fit = fitText(check, `${path}.text`, text, {family: 'display', width: fitWidth, preferred, min: fit.size, maxLines: 2});
    const color = emphasis ? b.resolveColor('primary', `${path}.emphasis colour`, 'primary', colors.bg, 'brand.colors.bg') : theme.paper;
    const lineWidth = fit.lines > 1 ? fitWidth : textWidth(text, fit.size, 'display');
    return {index: i, text, at, until, emphasis, size: fit.size, lines: fit.lines, color, width: r2(Math.min(maxWidth, lineWidth + 2 * padX))};
  });
  let block = null;
  if (callouts.length) {
    b.requireContrast('callouts', theme.paper, colors.bg, 'brand.colors.paper on the callout pill (brand.colors.bg)');
    const height = r2(Math.max(...callouts.map(c => c.size * 1.16 * c.lines)) + 2 * padY);
    const y = position === 'top' ? safe.y : r2(safe.y + safe.height - height);
    for (const c of callouts) {
      c.box = {x: r2(safe.x), y, width: c.width, height};
      b.events.push({id: `${b.id}-callout-${c.index}`, name: `callout-${c.index}`, time: c.at, endTime: c.until, role: 'beat'});
    }
    block = {x: r2(safe.x), y, width: r2(Math.max(...callouts.map(c => c.width))), height};
  }

  // The move and the settle, sampled once per frame (a pure function of time).
  const settleEase = grammarEase(ctx.grammar, 'power3.out', {props: ['scale']});
  const easeSettle = getEase(settleEase);
  const samples = [];
  if (move !== 'none' || enter === 'settle') {
    const first = Math.ceil(start * fps - 1e-6), last = Math.floor(end * fps + 1e-6);
    for (let frame = first; frame <= last; frame++) {
      const t = frame / fps;
      const kb = move === 'none' ? {scale: 1, x: 0, y: 0} : kenBurnsAt(move, Math.min(1, Math.max(0, (t - start) / duration)), {zoom, focus: pivot, canvas});
      const settle = enter === 'settle' && t < start + settleFor ? 1 + T.settleScale * (1 - easeSettle(Math.max(0, (t - start) / settleFor))) : 1;
      samples.push({t: rt(t), scale: Math.round(kb.scale * settle * 1e5) / 1e5, x: r2(kb.x) || 0, y: r2(kb.y) || 0});
    }
  }
  b.events.push({id: `${b.id}-enter`, name: 'enter', time: rt(start + enterFor), role: 'enter'});

  const content = {media, focus, pivot, objectPosition: `${r2(focus.x * 100)}% ${r2(focus.y * 100)}%`, move, zoom, enter, exit, title, position, callouts, samples, bleed: u(64),
    origin: {x: r2(pivot.x * canvas.width), y: r2(pivot.y * canvas.height)}, pill: {padX, padY, radius: u(14), background: `${colors.bg}e0`},
    rise: u(18), calloutFade: T.calloutFade, fadeEase: grammarEase(ctx.grammar, 'power2.out', {props: ['opacity']}), riseEase: grammarEase(ctx.grammar, 'power3.out', {props: ['y']})};
  const model = b.finish(content, {rect: {x: 0, y: 0, width: canvas.width, height: canvas.height}, role: 'media', minTextPx: callouts.length ? Math.min(...callouts.map(c => c.size)) : null,
    motion: {enterEnd: rt(start + enterFor), exitStart: rt(end - exitFor), enterFrom: enter === 'fade' ? {opacity: 0} : {opacity: 1}, exitTo: exit === 'fade' ? {opacity: 0} : {opacity: 1}, enterEase: 'power2.out', exitEase: 'power2.in'}});
  // The footage fills the frame: other scenes may sit over it, and it moves on its own.
  model.layout.allowOcclusion = ['*'];
  model.layout.drift = false;
  model.layout.live = media.kind === 'video' || move !== 'none';
  if (block) {
    const settled = [Math.min(...callouts.map(c => c.at)) + T.calloutFade, Math.max(...callouts.map(c => c.until))];
    model.layout.parts = [{id: 'callouts', role: 'text', rect: block, minTextPx: model.minTextPx, start: Math.min(...callouts.map(c => c.at)), end: settled[1] + T.calloutFade, motion: {enterEnd: rt(settled[0]), exitStart: rt(settled[1])}}];
  }
  return model;
}

// ---------------------------------------------------------------------------
// View and timeline

/** Element trees: {media, overlay}. media is the <video> or still; overlay holds the callout pills. */
export function clipView(model) {
  const {id, canvas, fonts} = model;
  const c = model.content;
  const B = c.bleed;
  const style = abs(-B, -B, canvas.width + 2 * B, canvas.height + 2 * B, {objectFit: 'cover', objectPosition: c.objectPosition, opacity: 0,
    transformOrigin: `${r2(c.origin.x + B)}px ${r2(c.origin.y + B)}px`, background: '#000000'});
  const media = c.media.kind === 'video'
    ? el('video', `${id}-media`, style, [], {src: c.media.src, muted: '', playsinline: ''})
    : el('img', `${id}-media`, style, [], {src: c.media.src, alt: c.title ?? ''});
  const kids = c.callouts.map(callout => el('div', `${id}-callout-${callout.index}`, abs(callout.box.x, callout.box.y, callout.box.width, callout.box.height, {
    boxSizing: 'border-box', padding: `${c.pill.padY}px ${c.pill.padX}px`, borderRadius: c.pill.radius, background: c.pill.background, opacity: 0,
    margin: 0, whiteSpace: callout.lines > 1 ? 'normal' : 'nowrap', fontFamily: fonts.display, fontSize: callout.size, lineHeight: '1.16', color: callout.color,
    // The pill hugs the text the brand's face actually sets (narrower faces
    // left a long empty tail); the planned width stays its limit.
    width: 'fit-content', maxWidth: callout.box.width}), [callout.text]));
  const overlay = el('div', `${id}-overlay`, abs(0, 0, canvas.width, canvas.height, {opacity: 0, pointerEvents: 'none'}), kids);
  return {media, overlay};
}

/** Renderer-neutral ops: the entrance and exit on both roots, the per-frame move on the footage, the callouts in and out. */
export function clipTimeline(model) {
  const {id, start, end} = model;
  const c = model.content, m = model.motion;
  const ops = [];
  // Opening and carried scenes rest their opacity (kit/core/modules.mjs), so read it from the motion.
  const from = Number.isFinite(m.enterFrom?.opacity) ? m.enterFrom.opacity : 1;
  const to = Number.isFinite(m.exitTo?.opacity) ? m.exitTo.opacity : 1;
  for (const target of [`${id}-media`, `${id}-overlay`]) {
    set(ops, target, start, {opacity: from});
    if (from < 1 && m.enterDuration > 0) tw(ops, target, start, m.enterDuration, m.enterEase, {opacity: from}, {opacity: 1});
    if (to < 1 && m.exitDuration > 0) tw(ops, target, m.exitStart, m.exitDuration, m.exitEase, {opacity: 1}, {opacity: to});
    set(ops, target, end, {opacity: 0});
  }
  if (c.samples.length) {
    for (const sample of c.samples) ops.push({type: 'set', target: `${id}-media`, time: Math.max(0, Math.round((sample.t - 0.0005) * 1e6) / 1e6), props: {x: sample.x, y: sample.y, scaleX: sample.scale, scaleY: sample.scale}});
  } else set(ops, `${id}-media`, start, {x: 0, y: 0, scaleX: 1, scaleY: 1});
  for (const callout of c.callouts) {
    const target = `${id}-callout-${callout.index}`;
    set(ops, target, start, {opacity: 0, x: 0, y: c.rise, scaleX: 1, scaleY: 1});
    tw(ops, target, callout.at, c.calloutFade, c.fadeEase, {opacity: 0}, {opacity: 1});
    tw(ops, target, callout.at, c.calloutFade * 1.6, c.riseEase, {y: c.rise}, {y: 0});
    tw(ops, target, callout.until, c.calloutFade, 'power2.in', {opacity: 1}, {opacity: 0});
  }
  return ops;
}

export const clip = {
  id: 'clip',
  describe: 'One full-frame shot of supplied footage (an assets/ video or still) cut to the narration: cropped to the frame about a focus point, played from a source window, a gentle Ken Burns move on stills, an entrance in the motion grammar, and 0–3 short callout pills above the caption band. The footage-led look for narrated videos; keeps captions.',
  params: {
    media: '"assets/…" video (.mp4|.webm|.mov|.m4v) or still (.jpg|.png|.webp|.svg), or {src, kind?, sourceStart? (video, s into the file, default 0), sourceEnd? (video; the scene must fit inside sourceStart–sourceEnd)}',
    focus: '{x, y} 0–1 fractions of the source kept in frame when it is cropped to the canvas aspect (default {x: 0.5, y: 0.5}); the move centres on it',
    move: 'none|push-in|pull-out|pan-left|pan-right|pan-up|pan-down (default push-in on a still, none on a video, push-in under the cinematic grammar); linear over the whole scene',
    zoom: '0.02–0.15, how far the move scales (default 0.06 on a still, 0.03 on a video)',
    enter: 'cut|fade|settle (default cut, settle under snappy and playful): cut lets the scene\'s in transition do the dressing; settle eases a 6% scale in without dipping to the background',
    exit: 'cut|fade (default cut)',
    callouts: '[{text ≤ 36, at?, until?, emphasis?: true colours it primary}] 1–3: pills in one slot, one after another, each on screen for its reading time (0.22 s a word, at least 1.2 s)',
    position: 'bottom|top (default bottom): the callout slot, inside the safe zone and above the caption band',
    title: 'string ≤ 60, what the shot shows (alt text, optional)'
  },
  events: ['enter', 'callout-<i>'],
  timing: {minDuration: T.minDuration, leadIn: 0, leadOut: T.leadOut + T.minHold, gaps: [],
    rules: [`callouts[].at in order, each at least ${T.calloutGap} s after the previous one leaves; every callout ends at least ${T.leadOut} s before the scene ends and stays ${T.perWord} s a word (at least ${T.minHold} s)`, 'a video scene fits its source window: media.sourceEnd − media.sourceStart ≥ the scene length']},
  resolve: resolveClip
};
