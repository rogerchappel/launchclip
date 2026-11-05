// Catalogue D media layouts: library footage inside the motion design, so a
// photo or clip is not always a full-frame cut (clip, photo-scene) or a small
// tilted card (polaroid). Registered in kit/core/catalog-d.mjs. Contract:
// docs/KIT_CONTRACTS.md ("Media layouts").
//
//   split-screen        footage fills the top or bottom half (left or right
//                       on a wide frame); the other half carries the line's
//                       title, a stat or a list, across a line or a soft blend
//   landscape-card      a 16:9 clip letterboxed in a rounded window mid-frame,
//                       a title above, a caption or chip below
//   picture-in-picture  a rounded clip card in a corner of a panel that
//                       carries a title, a stat or a list
//   media-compare       two options side by side or stacked, each its own
//                       footage and label, the second on its word
//   media-stat          a figure that counts up beside or over footage
//   media-list          2–5 list rows, each with a small thumbnail, one by one
//   media-grid          2–4 tiles of footage (a grid or a mosaic) revealed one
//                       by one with the narration
//
// All seven share one model shape and one view (mediaLayoutView): `base` (a
// fill and a panel, in the scene layer), `windows` (one <video> or a framed
// <img> each) and `overlay` (dividers, chips and the text, drawn above the
// footage). A video window is root media: HyperFrames hoists every <video>
// to the composition root (story-compiler.mjs hoistMedia), so the overlay is
// hoisted one z-index above it, as clip's callouts are; with no video all
// three stay in the scene layer. Remotion draws the same trees
// (kit/remotion/catalog/MediaLayout.tsx).
//
// Rules every layout keeps:
// - Footage from the first visible frame: a window is its media (no empty
//   frame or develop layer), and the first one is revealed at the scene's
//   start; text arrives after it.
// - Text stays in the module safe area (createFootageBase's `safe`: the safe
//   zone above the caption band, inside the brand frame's logo-safe area).
//   Full-bleed footage (a split half, a stat's backdrop) may run under the
//   captions and the logo; floating windows stay inside the safe area.
// - Entrances follow the motion grammar (ENTRANCES): a rise for editorial, a
//   pop for snappy and playful, a settle for cinematic, a plain fade for
//   documentary; exits fade. An opening or carried scene rests its opacity
//   (modules.mjs), so its moves play over a visible frame.
// - Stills get a slow push inside their window (the frame never holds dead
//   still); videos play. layout.live is true and ambient drift is off (a
//   hoisted video does not follow the drift wrapper).
// - layout: the main rect (role media), each text block and each further
//   window as layout.parts; a part over footage names it in `over`, so
//   layout-check allows that overlap and still checks the rest.

import {contrastRatio, fitText, mixColor, r2, rt, textWidth} from './catalog-b-base.mjs';
import {abs, el, set, tw} from './catalog-b-view.mjs';
import {createFootageBase} from './catalog-c.mjs';
import {grammarEase, grammarStagger} from './grammar.mjs';

export const MEDIA_LAYOUT_TIMING = Object.freeze({minDuration: 1.5, lead: 0.15, stagger: 0.28, textFade: 0.3, textRise: 28, exit: 0.3, minHold: 1.2, push: 0.05, count: 0.9});
const T = MEDIA_LAYOUT_TIMING;

/** Entrance per motion grammar: rise (px at 1080), start scale and rotation, fade and move seconds. */
export const MEDIA_LAYOUT_ENTRANCES = Object.freeze({
  editorial: Object.freeze({rise: 48, scale: 0.96, rotation: 0, fade: 0.3, move: 0.6}),
  snappy: Object.freeze({rise: 24, scale: 0.9, rotation: 0, fade: 0.18, move: 0.42}),
  smooth: Object.freeze({rise: 36, scale: 0.97, rotation: 0, fade: 0.45, move: 0.85}),
  playful: Object.freeze({rise: 40, scale: 0.84, rotation: -3, fade: 0.22, move: 0.6}),
  documentary: Object.freeze({rise: 0, scale: 1, rotation: 0, fade: 0.5, move: 0.5}),
  cinematic: Object.freeze({rise: 0, scale: 1.06, rotation: 0, fade: 0.5, move: 1.1})
});

const IMAGE = /\.(svg|png|jpe?g|webp)$/i, VIDEO = /\.(mp4|webm|mov|m4v)$/i;
const SPLIT_VARIANTS = ['top', 'bottom', 'left', 'right'];
const PIP_VARIANTS = ['top-right', 'top-left', 'bottom-right', 'bottom-left'];
const COMPARE_VARIANTS = ['stacked', 'side'];
const STAT_VARIANTS = ['beside', 'behind'];
const GRID_VARIANTS = ['grid', 'mosaic'];
const ASPECTS = {'16:9': 16 / 9, '4:3': 4 / 3, '1:1': 1, '4:5': 4 / 5, '21:9': 21 / 9};

/** The frame's shape: portrait (9:16), wide (16:9) or square (1:1 and near it). */
export function frameShape(canvas) {
  const ratio = canvas.width / canvas.height;
  return ratio < 0.9 ? 'portrait' : ratio > 1.2 ? 'wide' : 'square';
}

/** params media: "assets/…" or {src, kind?, sourceStart? (video), focus?: {x, y}} → {kind, src, sourceStart, objectPosition}. */
export function layoutMedia(check, value, path) {
  const media = typeof value === 'string' ? {src: value} : check.obj(value, path, ['src', 'kind', 'sourceStart', 'focus'], ['src']);
  const src = media.src;
  if (typeof src !== 'string' || !src.startsWith('assets/') || src.split(/[\\/]/).includes('..') || !/^[a-zA-Z0-9_./ -]+$/.test(src) || !(IMAGE.test(src) || VIDEO.test(src))) {
    check.fail(typeof value === 'string' ? path : `${path}.src`, `must be a project-local assets/ video (.mp4, .webm, .mov, .m4v) or still (.jpg, .png, .webp, .svg); got ${JSON.stringify(src)}`);
  }
  const kind = media.kind ?? (VIDEO.test(src) ? 'video' : 'image');
  check.oneOf(kind, `${path}.kind`, ['image', 'video']);
  if ((kind === 'video') !== VIDEO.test(src)) check.fail(`${path}.kind`, `is ${kind} but ${src} is ${VIDEO.test(src) ? 'a video' : 'a still'}`);
  if (kind === 'image' && media.sourceStart !== undefined) check.fail(`${path}.sourceStart`, 'is for videos only');
  const sourceStart = kind === 'video' ? (media.sourceStart === undefined ? 0 : check.num(media.sourceStart, `${path}.sourceStart`, 0, 86400)) : null;
  let focus = {x: 0.5, y: 0.5};
  if (media.focus !== undefined) {
    check.obj(media.focus, `${path}.focus`, ['x', 'y'], ['x', 'y']);
    focus = {x: check.num(media.focus.x, `${path}.focus.x`, 0, 1), y: check.num(media.focus.y, `${path}.focus.y`, 0, 1)};
  }
  return {kind, src, sourceStart, objectPosition: `${r2(focus.x * 100)}% ${r2(focus.y * 100)}%`};
}

// ---------------------------------------------------------------------------
// Shared resolve helpers

function layoutBase(moduleId, params, ctx, allowed, required = []) {
  const b = createFootageBase(moduleId, params, ctx, {allowed, required, minDuration: T.minDuration});
  const grammarId = ctx.grammar?.id ?? ctx.grammar?.base ?? 'editorial';
  b.entrance = MEDIA_LAYOUT_ENTRANCES[grammarId] ?? MEDIA_LAYOUT_ENTRANCES.editorial;
  b.shape = frameShape(b.canvas);
  b.enterEase = grammarEase(ctx.grammar, 'power3.out', {props: ['y', 'scale']});
  b.fadeEase = grammarEase(ctx.grammar, 'power2.out', {props: ['opacity']});
  b.stagger = grammarStagger(ctx.grammar, T.stagger, {min: 0.15, max: 0.6});
  b.windows = [];
  b.texts = [];
  b.decor = [];
  b.parts = [];
  b.lastReveal = b.start;
  return b;
}

// Text over the scene: the brand's paper on its background, checked once.
function paperOnBg(b) {
  b.requireContrast('text', b.theme.paper, b.colors.bg, 'brand.colors.paper on brand.colors.bg');
  return b.theme.paper;
}

// A chip: primary fill with the ink colour on it, or paper on a dark pill when primary is too close to ink.
function chipColors(b) {
  if (contrastRatio(b.colors.ink, b.colors.primary) >= 3) return {fill: b.colors.primary, ink: b.colors.ink};
  return {fill: `${b.colors.bg}e0`, ink: b.theme.paper};
}

/**
 * A window: media in a rect, revealed at `at` (absolute) from an offset in
 * the grammar's entrance. from: {x, y} px offset (default a rise), scale.
 */
function addWindow(b, {key, media, rect, radius, at = b.start, from = null, shadow = true, ring = null}) {
  const e = b.entrance;
  const offset = from ?? {x: 0, y: b.u(e.rise)};
  b.windows.push({key, media, rect: roundRect(rect), radius: r2(radius ?? 0), at: rt(at), from: {x: r2(offset.x), y: r2(offset.y), scale: from?.scale ?? e.scale, rotation: from?.rotation ?? e.rotation},
    shadow: shadow ? `0 ${b.u(18)}px ${b.u(48)}px #00000066` : null, ring});
  if (at > b.lastReveal) b.lastReveal = at;
  return b.windows.at(-1);
}

const roundRect = rect => ({x: r2(rect.x), y: r2(rect.y), width: r2(rect.width), height: r2(rect.height)});

/**
 * Stacked text in `area`: entries [{key, text, family, preferred, maxLines?,
 * color?, gap?, kind?: 'item' (a bullet row) | 'value', at?}]. Sizes shrink
 * together until the stack fits the area (never below the key-text floor);
 * otherwise the plan fails with the room it needs. anchor top|center|bottom.
 * → entries with box, size, lines; their at defaults to a stagger after `lead`.
 */
function stackText(b, area, entries, {align = 'left', anchor = 'center', lead = b.start + T.lead, path = 'params'} = {}) {
  const min = b.min.key;
  let laid = null;
  for (const scale of [1, 0.9, 0.8, 0.7, 0.6]) {
    let total = 0;
    const out = [];
    let ok = true;
    for (const [i, entry] of entries.entries()) {
      const indent = entry.kind === 'item' ? b.u(44) : 0;
      const width = area.width - indent;
      const preferred = Math.max(min, entry.preferred * scale);
      let fit;
      try {
        fit = fitText({fail: () => { throw new Error('fit'); }}, entry.path ?? path, entry.text, {family: entry.family, width, preferred, min, maxLines: entry.maxLines ?? 1});
      } catch {
        ok = false;
        break;
      }
      const lineHeight = entry.family === 'display' ? 1.08 : 1.22;
      const height = r2(fit.size * lineHeight * fit.lines);
      const gap = i === 0 ? 0 : b.u(entry.gap ?? 18);
      total += gap + height;
      out.push({...entry, size: fit.size, lines: fit.lines, lineHeight, height, gap, indent});
    }
    if (ok && total <= area.height + 1e-6) { laid = {out, total}; break; }
    if (scale === 0.6 && ok) b.check.fail(path, `needs ${Math.round(total)} px of text height but the layout leaves ${Math.round(area.height)} px; shorten the title or drop a line or an item`);
  }
  if (!laid) {
    const long = entries.find(entry => !textFits(b, entry, area.width - (entry.kind === 'item' ? b.u(44) : 0)));
    b.check.fail(long?.path ?? path, `is too long for its ${Math.round(area.width)} px column at ${Math.ceil(min)} px (${long ? JSON.stringify(long.text) : 'the text'}); shorten it`);
  }
  let y = anchor === 'top' ? area.y : anchor === 'bottom' ? area.y + area.height - laid.total : area.y + (area.height - laid.total) / 2;
  let at = lead;
  return laid.out.map(entry => {
    y += entry.gap;
    const box = {x: r2(area.x + entry.indent), y: r2(y), width: r2(area.width - entry.indent), height: entry.height};
    y += entry.height;
    const when = entry.at ?? at;
    at = Math.max(at, when) + b.stagger;
    return {...entry, box, align, at: rt(when)};
  });
}

function textFits(b, entry, width) {
  try {
    fitText({fail: () => { throw new Error('fit'); }}, 'x', entry.text, {family: entry.family, width, preferred: b.min.key, min: b.min.key, maxLines: entry.maxLines ?? 1});
    return true;
  } catch {
    return false;
  }
}

/** Pushes laid text entries onto the model, with their layout parts. over: ids of footage they sit on. */
function addTexts(b, laid, {over = [], partId = 'text', color = paperOnBg(b), shadow = false} = {}) {
  for (const entry of laid) {
    b.texts.push({key: entry.key, text: entry.text, box: entry.box, size: entry.size, family: entry.family, lineHeight: entry.lineHeight, lines: entry.lines, align: entry.align,
      color: entry.color ?? color, at: entry.at, bullet: entry.kind === 'item' ? {size: b.u(18), color: b.colors.primary} : null, count: entry.count ?? null, shadow});
    if (entry.at > b.lastReveal) b.lastReveal = entry.at;
  }
  if (!laid.length) return;
  const rect = unionRect(laid.map(entry => entry.box));
  const first = Math.min(...laid.map(entry => entry.at));
  b.parts.push({id: partId, role: 'text', rect, minTextPx: Math.min(...laid.map(entry => entry.size)), start: first, motion: {enterEnd: rt(first + T.textFade), exitStart: rt(b.end - T.exit)}, ...(over.length ? {over} : {})});
}

/** A pill of text (a label or chip) at `x, y` (its top-left), width from the text. */
function pill(b, {key, text, x, y, size, at, maxWidth, align = 'left', path}) {
  const padX = b.u(22), padY = b.u(10);
  const fit = fitText(b.check, path, text, {family: 'body', width: maxWidth - 2 * padX, preferred: size, min: b.min.key, maxLines: 1});
  const width = r2(Math.min(maxWidth, textWidth(text, fit.size, 'body') + 2 * padX));
  const height = r2(fit.size * 1.2 + 2 * padY);
  const colors = chipColors(b);
  b.requireContrast(`${key}`, colors.ink, colors.fill.slice(0, 7), `${path} (the chip's text on its fill)`);
  const left = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
  const entry = {key, text, box: {x: r2(left), y: r2(y), width, height}, size: fit.size, family: 'body', lineHeight: 1.2, lines: 1, align: 'center', color: colors.ink, at: rt(at), pill: {fill: colors.fill, padX, padY, radius: r2(height / 2)}};
  b.texts.push(entry);
  if (at > b.lastReveal) b.lastReveal = at;
  return entry;
}

const unionRect = rects => {
  const x = Math.min(...rects.map(r => r.x)), y = Math.min(...rects.map(r => r.y));
  return {x: r2(x), y: r2(y), width: r2(Math.max(...rects.map(r => r.x + r.width)) - x), height: r2(Math.max(...rects.map(r => r.y + r.height)) - y)};
};

const inset = (rect, by) => ({x: rect.x + by, y: rect.y + by, width: rect.width - 2 * by, height: rect.height - 2 * by});

/** Text content shared by the panel layouts: kicker, title, body, stat or items. → stack entries. */
function contentEntries(b, p, {titleSize, path = 'params', requireSome = true, itemTimes = true}) {
  const entries = [];
  const portrait = b.shape === 'portrait';
  if (p.kicker !== undefined) entries.push({key: 'kicker', text: b.check.str(p.kicker, `${path}.kicker`, 32).toUpperCase(), family: 'body', preferred: b.u(44), color: b.colors.primary, path: `${path}.kicker`});
  if (p.title !== undefined) entries.push({key: 'title', text: b.check.str(p.title, `${path}.title`, 60), family: 'display', preferred: b.u(titleSize ?? (portrait ? 92 : 72)), maxLines: 2, gap: 14, path: `${path}.title`});
  const kinds = ['body', 'stat', 'items'].filter(key => p[key] !== undefined);
  if (kinds.length > 1) b.check.fail(path, `takes one of body, stat or items; got ${kinds.join(' and ')}`);
  if (p.body !== undefined) entries.push({key: 'body', text: b.check.str(p.body, `${path}.body`, 90), family: 'body', preferred: b.u(portrait ? 52 : 46), maxLines: 2, gap: 20, path: `${path}.body`});
  if (p.stat !== undefined) {
    const stat = b.check.obj(p.stat, `${path}.stat`, ['value', 'label'], ['value']);
    const value = b.check.str(String(stat.value), `${path}.stat.value`, 12);
    entries.push({key: 'stat', text: value, family: 'display', preferred: b.u(portrait ? 168 : 140), gap: 22, kind: 'value', count: countUp(value), path: `${path}.stat.value`});
    if (stat.label !== undefined) entries.push({key: 'stat-label', text: b.check.str(stat.label, `${path}.stat.label`, 40), family: 'body', preferred: b.u(46), maxLines: 2, gap: 8, path: `${path}.stat.label`});
  }
  if (p.items !== undefined) {
    const items = b.check.arr(p.items, `${path}.items`, 2, 4);
    const spread = Math.max(b.stagger, Math.min(0.9, (b.duration * 0.6) / items.length));
    items.forEach((raw, i) => {
      const item = typeof raw === 'string' ? {text: raw} : b.check.obj(raw, `${path}.items[${i}]`, ['text', 'at'], ['text']);
      const fallback = T.lead + 0.35 + i * spread;
      const at = itemTimes ? b.timeOf(`item-${i}`, item.at, `${path}.items[${i}].at`, fallback, {min: 0, max: b.duration - T.minHold}) : undefined;
      entries.push({key: `item-${i}`, text: b.check.str(item.text, `${path}.items[${i}].text`, 32), family: 'body', preferred: b.u(portrait ? 58 : 50), gap: 22, kind: 'item', at, path: `${path}.items[${i}].text`});
      if (at !== undefined) b.events.push({id: `${b.id}-item-${i}`, name: `item-${i}`, time: at, endTime: rt(at + T.textFade), role: 'beat'});
    });
  }
  if (requireSome && !entries.some(entry => entry.key !== 'kicker')) b.check.fail(path, 'needs a title, body, stat or items (the half that carries the line)');
  return entries;
}

/** A count-up for a figure like "1,200 kg", "87%" or "$4.5M": {prefix, value, decimals, grouped, suffix} or null. */
export function countUp(text) {
  const match = /^([^\d]*?)(\d[\d,]*(?:\.\d+)?)(.*)$/.exec(String(text));
  if (!match) return null;
  const digits = match[2];
  const value = Number(digits.replace(/,/g, ''));
  if (!Number.isFinite(value) || value <= 0) return null;
  return {prefix: match[1], value, decimals: digits.includes('.') ? digits.split('.')[1].length : 0, grouped: digits.includes(','), suffix: match[3]};
}

const formatCount = (count, value) => {
  const fixed = value.toFixed(count.decimals);
  const [whole, fraction] = fixed.split('.');
  const grouped = count.grouped ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : whole;
  return `${count.prefix}${grouped}${fraction ? `.${fraction}` : ''}${count.suffix}`;
};

/** Finishes a layout: the model, its layout parts (windows past the first, text) and the movement flags. */
function finishLayout(b, extra = {}) {
  if (!b.windows.length) b.check.fail('params', 'needs footage');
  const exitFor = Math.min(T.exit, b.duration / 4);
  const hold = rt(b.end - exitFor) - b.lastReveal;
  if (hold < T.textFade - 1e-6) b.check.fail('params', `reveals its last part ${r2(b.end - b.lastReveal)} s before the scene ends; leave at least ${r2(T.textFade + exitFor)} s (move the last at earlier or lengthen the scene)`);
  const [main, ...rest] = b.windows;
  const mainId = 'win-0';
  // A further window inside the main block (a list's later thumbnails) is part of it.
  for (const win of rest) b.parts.push({id: `win-${b.windows.indexOf(win)}`, role: 'media', rect: win.rect, start: win.at, motion: {enterEnd: rt(win.at + b.entrance.fade), exitStart: rt(b.end - exitFor)}, ...(extra.mainRect ? {over: ['self']} : {})});
  for (const part of b.parts) if (part.over) part.over = part.over.map(id => (id === mainId ? 'self' : id));
  const minTextPx = b.texts.length ? Math.min(...b.texts.map(entry => entry.size)) : null;
  const content = {windows: b.windows, texts: b.texts, decor: b.decor, base: extra.base ?? null, entrance: {fade: b.entrance.fade, move: b.entrance.move}, textFade: T.textFade, textRise: b.u(T.textRise),
    enterEase: b.enterEase, fadeEase: b.fadeEase, push: T.push, count: T.count, ...(extra.content ?? {})};
  const model = b.finish(content, {rect: extra.mainRect ?? main.rect, role: 'media', minTextPx,
    motion: {enterEnd: rt(b.start + b.entrance.fade), exitStart: rt(b.end - exitFor), enterFrom: {opacity: 0}, exitTo: {opacity: 0}, enterEase: 'power2.out', exitEase: 'power2.in'}});
  if (extra.allowOcclusion) model.layout.allowOcclusion = extra.allowOcclusion;
  model.layout.parts = b.parts;
  // The footage moves on its own (a playing video, a still's slow push); a hoisted video does not follow hold drift.
  model.layout.drift = false;
  model.layout.live = true;
  return model;
}

// ---------------------------------------------------------------------------
// split-screen

function resolveSplit(params, ctx) {
  const b = layoutBase('split-screen', params, ctx, ['media', 'variant', 'share', 'divider', 'kicker', 'title', 'body', 'stat', 'items', 'align'], ['media']);
  const {check, canvas, safe, u, colors} = b;
  const p = b.params;
  const media = layoutMedia(check, p.media, 'params.media');
  let side = p.variant === undefined ? (b.shape === 'wide' ? 'left' : 'top') : check.oneOf(p.variant, 'params.variant', SPLIT_VARIANTS);
  // A plan written for 9:16 renders sensibly at 16:9: top → left, bottom → right.
  if (b.shape === 'wide' && (side === 'top' || side === 'bottom')) side = side === 'top' ? 'left' : 'right';
  const divider = p.divider === undefined ? 'line' : check.oneOf(p.divider, 'params.divider', ['line', 'blend']);
  const align = p.align === undefined ? 'left' : check.oneOf(p.align, 'params.align', ['left', 'center']);
  // The footage's share of the frame. A portrait top half stops above the
  // text room the caption band leaves (the band sits low in the frame).
  const share = p.share === undefined ? (side === 'top' ? (b.shape === 'portrait' ? 0.4 : 0.45) : 0.5) : check.num(p.share, 'params.share', 0.3, 0.65);
  const vertical = side === 'top' || side === 'bottom';
  const gap = u(40);
  let mediaRect, area;
  if (vertical) {
    const h = canvas.height * share;
    mediaRect = side === 'top' ? {x: 0, y: 0, width: canvas.width, height: h} : {x: 0, y: canvas.height - h, width: canvas.width, height: h};
    const top = side === 'top' ? Math.max(safe.y, h + gap) : safe.y;
    const bottom = side === 'top' ? safe.y + safe.height : Math.min(safe.y + safe.height, canvas.height - h - gap);
    area = {x: safe.x, y: top, width: safe.width, height: bottom - top};
  } else {
    const w = canvas.width * share;
    mediaRect = side === 'left' ? {x: 0, y: 0, width: w, height: canvas.height} : {x: canvas.width - w, y: 0, width: w, height: canvas.height};
    const left = side === 'left' ? Math.max(safe.x, w + gap) : safe.x;
    const right = side === 'left' ? safe.x + safe.width : Math.min(safe.x + safe.width, canvas.width - w - gap);
    area = {x: left, y: safe.y, width: right - left, height: safe.height};
  }
  if (area.height < u(160) || area.width < u(280)) check.fail('params.share', `leaves ${Math.round(area.width)}×${Math.round(area.height)} px for the text; lower the share`);
  // The footage slides in from its own edge.
  const e = b.entrance;
  const push = u(Math.max(e.rise, 40));
  const from = {x: side === 'left' ? -push : side === 'right' ? push : 0, y: side === 'top' ? -push : side === 'bottom' ? push : 0, scale: Math.max(1, e.scale), rotation: 0};
  addWindow(b, {key: 'media', media, rect: mediaRect, radius: 0, from, shadow: false});
  const laid = stackText(b, area, contentEntries(b, p, {}), {align, anchor: side === 'top' ? 'top' : 'center'});
  addTexts(b, laid);
  // The seam: an accent line that wipes across, or a soft blend of the footage into the panel.
  const seam = side === 'top' ? mediaRect.height : side === 'bottom' ? mediaRect.y : side === 'left' ? mediaRect.width : mediaRect.x;
  if (divider === 'line') {
    const thick = u(6);
    const rect = vertical ? {x: 0, y: seam - thick / 2, width: canvas.width, height: thick} : {x: seam - thick / 2, y: 0, width: thick, height: canvas.height};
    b.decor.push({key: 'divider', rect: roundRect(rect), style: {background: colors.primary}, at: rt(b.start + T.lead), wipe: vertical ? 'x' : 'y'});
  } else {
    const depth = (vertical ? mediaRect.height : mediaRect.width) * 0.28;
    const toward = {top: '180deg', bottom: '0deg', left: '90deg', right: '270deg'}[side];
    const rect = side === 'top' ? {x: 0, y: seam - depth, width: canvas.width, height: depth + 1} : side === 'bottom' ? {x: 0, y: seam - 1, width: canvas.width, height: depth}
      : side === 'left' ? {x: seam - depth, y: 0, width: depth + 1, height: canvas.height} : {x: seam - 1, y: 0, width: depth, height: canvas.height};
    b.decor.push({key: 'blend', rect: roundRect(rect), style: {background: `linear-gradient(${toward}, ${colors.bg}00 0%, ${colors.bg} 100%)`}, at: b.start});
  }
  return finishLayout(b, {base: {fill: colors.bg}, content: {side, divider, share}});
}

// ---------------------------------------------------------------------------
// landscape-card

function resolveLandscape(params, ctx) {
  const b = layoutBase('landscape-card', params, ctx, ['media', 'kicker', 'title', 'caption', 'chip', 'aspect'], ['media']);
  const {check, safe, u} = b;
  const p = b.params;
  const media = layoutMedia(check, p.media, 'params.media');
  const aspect = p.aspect === undefined ? '16:9' : check.oneOf(p.aspect, 'params.aspect', Object.keys(ASPECTS));
  const above = contentEntries(b, {kicker: p.kicker, title: p.title}, {requireSome: false, titleSize: b.shape === 'portrait' ? 72 : 60});
  const caption = p.caption === undefined ? null : check.str(p.caption, 'params.caption', 60);
  const chip = p.chip === undefined ? null : check.str(p.chip, 'params.chip', 24);
  // Measure the text, then give the window the room left (wide frames keep a margin either side).
  const gap = u(32);
  const textAbove = above.length ? stackText(b, {x: safe.x, y: 0, width: safe.width, height: safe.height}, above, {align: 'center', anchor: 'top'}) : [];
  const aboveH = textAbove.length ? unionRect(textAbove.map(entry => entry.box)).height : 0;
  const below = caption ? stackText(b, {x: safe.x, y: 0, width: safe.width, height: safe.height}, [{key: 'caption', text: caption, family: 'body', preferred: u(46), maxLines: 2, path: 'params.caption'}], {align: 'center', anchor: 'top'}) : [];
  const belowH = (below.length ? below[0].height : 0) + (chip ? u(44) * 1.2 + u(20) + (below.length ? u(16) : 0) : 0);
  const room = safe.height - aboveH - belowH - (aboveH ? gap : 0) - (belowH ? gap : 0);
  const maxWidth = safe.width * (b.shape === 'wide' ? 0.78 : 1);
  const width = Math.min(maxWidth, room * ASPECTS[aspect]);
  const height = width / ASPECTS[aspect];
  if (height < u(220)) check.fail('params', `leaves a ${Math.round(width)}×${Math.round(height)} px window; shorten the title or caption`);
  const total = aboveH + (aboveH ? gap : 0) + height + (belowH ? gap : 0) + belowH;
  let y = safe.y + (safe.height - total) / 2;
  const shift = (entries, top) => entries.map(entry => ({...entry, box: {...entry.box, y: r2(entry.box.y + top)}}));
  const laidAbove = shift(textAbove, y);
  y += aboveH + (aboveH ? gap : 0);
  const rect = {x: safe.x + (safe.width - width) / 2, y, width, height};
  addWindow(b, {key: 'media', media, rect, radius: u(28), from: {x: 0, y: u(b.entrance.rise), scale: b.entrance.scale, rotation: 0}});
  y += height + gap;
  // Text arrives just after the window lands.
  const textAt = rt(b.start + T.lead + 0.1);
  addTexts(b, laidAbove.map((entry, i) => ({...entry, at: rt(textAt + i * b.stagger)})), {partId: 'title'});
  const laidBelow = shift(below, y).map(entry => ({...entry, at: rt(textAt + b.stagger)}));
  addTexts(b, laidBelow, {partId: 'caption', over: ['self']});
  if (chip) {
    const chipY = laidBelow.length ? laidBelow[0].box.y + laidBelow[0].box.height + u(16) : y;
    const entry = pill(b, {key: 'chip', text: chip, x: safe.x + safe.width / 2, y: chipY, size: u(44), at: rt(textAt + 2 * b.stagger), maxWidth: safe.width, align: 'center', path: 'params.chip'});
    b.parts.push({id: 'chip', role: 'text', rect: entry.box, minTextPx: entry.size, start: entry.at, motion: {enterEnd: rt(entry.at + T.textFade), exitStart: rt(b.end - T.exit)}, over: ['self']});
  }
  // The card is the window and what hangs under it (its caption and chip): one block in the layout.
  const card = unionRect([rect, ...b.texts.filter(t => t.key === 'caption' || t.key === 'chip').map(t => t.box)]);
  return finishLayout(b, {mainRect: card, content: {aspect}});
}

// ---------------------------------------------------------------------------
// picture-in-picture

function resolvePip(params, ctx) {
  const b = layoutBase('picture-in-picture', params, ctx, ['media', 'variant', 'aspect', 'kicker', 'title', 'body', 'stat', 'items', 'align'], ['media']);
  const {check, safe, u, theme, colors} = b;
  const p = b.params;
  const media = layoutMedia(check, p.media, 'params.media');
  const corner = p.variant === undefined ? 'top-right' : check.oneOf(p.variant, 'params.variant', PIP_VARIANTS);
  const aspect = p.aspect === undefined ? (b.shape === 'portrait' ? '1:1' : '16:9') : check.oneOf(p.aspect, 'params.aspect', Object.keys(ASPECTS));
  const align = p.align === undefined ? 'left' : check.oneOf(p.align, 'params.align', ['left', 'center']);
  const [vy, vx] = corner.split('-');
  // The panel fills the safe area; the card sits in its corner, the content in the rest of it.
  const panel = {x: safe.x, y: safe.y, width: safe.width, height: safe.height};
  const pad = u(36), gap = u(32);
  let card, area;
  if (b.shape === 'wide') {
    const h = Math.min(panel.height * 0.62, (panel.width * 0.42) / ASPECTS[aspect]);
    const w = h * ASPECTS[aspect];
    card = {x: vx === 'right' ? panel.x + panel.width - pad - w : panel.x + pad, y: vy === 'top' ? panel.y + pad : panel.y + panel.height - pad - h, width: w, height: h};
    area = vx === 'right' ? {x: panel.x + pad, y: panel.y + pad, width: card.x - gap - panel.x - pad, height: panel.height - 2 * pad}
      : {x: card.x + w + gap, y: panel.y + pad, width: panel.x + panel.width - pad - (card.x + w + gap), height: panel.height - 2 * pad};
  } else {
    const w = Math.min((panel.width - 2 * pad) * (b.shape === 'portrait' ? 0.62 : 0.5), (panel.height * 0.5) * ASPECTS[aspect]);
    const h = w / ASPECTS[aspect];
    card = {x: vx === 'right' ? panel.x + panel.width - pad - w : panel.x + pad, y: vy === 'top' ? panel.y + pad : panel.y + panel.height - pad - h, width: w, height: h};
    area = vy === 'top' ? {x: panel.x + pad, y: card.y + h + gap, width: panel.width - 2 * pad, height: panel.y + panel.height - pad - (card.y + h + gap)}
      : {x: panel.x + pad, y: panel.y + pad, width: panel.width - 2 * pad, height: card.y - gap - panel.y - pad};
  }
  const e = b.entrance;
  const fly = u(60);
  addWindow(b, {key: 'media', media, rect: card, radius: u(24), from: {x: vx === 'right' ? fly : -fly, y: vy === 'top' ? -fly / 2 : fly / 2, scale: e.scale, rotation: e.rotation ? (vx === 'right' ? 3 : -3) : 0},
    ring: {color: colors.paper, width: u(6)}});
  const laid = stackText(b, area, contentEntries(b, p, {}), {align, anchor: b.shape === 'wide' ? 'center' : vy === 'top' ? 'top' : 'bottom', lead: rt(b.start + T.lead + 0.1)});
  addTexts(b, laid);
  b.decor.push({key: 'panel', rect: roundRect(panel), style: {background: theme.panel, borderRadius: u(36), boxShadow: `inset 0 0 0 ${u(2)}px ${theme.border}`}, at: b.start, base: true});
  return finishLayout(b, {content: {corner, aspect}});
}

// ---------------------------------------------------------------------------
// media-compare

function resolveCompare(params, ctx) {
  const b = layoutBase('media-compare', params, ctx, ['left', 'right', 'variant', 'title', 'vs', 'pick', 'at'], ['left', 'right']);
  const {check, safe, u, colors} = b;
  const p = b.params;
  const option = (key) => {
    const raw = check.obj(p[key], `params.${key}`, ['media', 'label'], ['media', 'label']);
    return {media: layoutMedia(check, raw.media, `params.${key}.media`), label: check.str(raw.label, `params.${key}.label`, 24)};
  };
  const left = option('left'), right = option('right');
  const variant = p.variant === undefined ? (b.shape === 'portrait' ? 'stacked' : 'side') : check.oneOf(p.variant, 'params.variant', COMPARE_VARIANTS);
  const vs = p.vs === undefined ? true : check.bool(p.vs, 'params.vs');
  const pick = p.pick === undefined ? null : check.oneOf(p.pick, 'params.pick', ['left', 'right']);
  const secondAt = b.timeOf('right', p.at, 'params.at', Math.min(b.duration * 0.35, 1.6), {min: 0, max: b.duration - T.minHold});
  const titleEntries = p.title === undefined ? [] : contentEntries(b, {title: p.title}, {requireSome: false, titleSize: b.shape === 'portrait' ? 70 : 60});
  const title = titleEntries.length ? stackText(b, safe, titleEntries, {align: 'center', anchor: 'top'}) : [];
  const titleH = title.length ? unionRect(title.map(entry => entry.box)).height + u(32) : 0;
  const area = {x: safe.x, y: safe.y + titleH, width: safe.width, height: safe.height - titleH};
  const gap = u(28);
  let rects;
  if (variant === 'stacked') {
    const h = Math.min((area.height - gap) / 2, area.width / (4 / 3));
    const top = area.y + (area.height - (2 * h + gap)) / 2;
    rects = [{x: area.x, y: top, width: area.width, height: h}, {x: area.x, y: top + h + gap, width: area.width, height: h}];
  } else {
    const w = (area.width - gap) / 2;
    const h = Math.min(area.height, w / (b.shape === 'wide' ? 4 / 5 : 3 / 4));
    const top = area.y + (area.height - h) / 2;
    rects = [{x: area.x, y: top, width: w, height: h}, {x: area.x + w + gap, y: top, width: w, height: h}];
  }
  const fly = u(70);
  const enters = variant === 'stacked' ? [{x: -fly, y: 0}, {x: fly, y: 0}] : [{x: 0, y: fly}, {x: 0, y: fly}];
  const options = [left, right];
  const pickAt = rt(secondAt + 0.9);
  options.forEach((option, i) => {
    const win = addWindow(b, {key: `option-${i}`, media: option.media, rect: rects[i], radius: u(24), at: i === 0 ? b.start : secondAt, from: {...enters[i], scale: b.entrance.scale, rotation: 0},
      ring: pick === (i === 0 ? 'left' : 'right') ? {color: colors.primary, width: u(8), at: pickAt} : null});
    const labelAt = rt(win.at + T.lead);
    const label = pill(b, {key: `label-${i}`, text: option.label, x: rects[i].x + u(20), y: rects[i].y + u(20), size: u(46), at: labelAt, maxWidth: rects[i].width - u(40), path: `params.${i === 0 ? 'left' : 'right'}.label`});
    b.parts.push({id: `label-${i}`, role: 'text', rect: label.box, minTextPx: label.size, start: labelAt, motion: {enterEnd: rt(labelAt + T.textFade), exitStart: rt(b.end - T.exit)}, over: [`win-${i}`]});
  });
  if (title.length) addTexts(b, title.map(entry => ({...entry, at: rt(b.start + T.lead)})), {partId: 'title'});
  if (vs) {
    const seam = variant === 'stacked' ? {x: area.x + area.width / 2, y: rects[0].y + rects[0].height + gap / 2} : {x: rects[0].x + rects[0].width + gap / 2, y: rects[0].y + rects[0].height / 2};
    const size = u(44);
    const d = r2(size * 2.1);
    const colors2 = chipColors(b);
    b.texts.push({key: 'vs', text: 'VS', box: {x: r2(seam.x - d / 2), y: r2(seam.y - d / 2), width: d, height: d}, size, family: 'display', lineHeight: d / size, lines: 1, align: 'center', color: colors2.ink, at: rt(secondAt + 0.15),
      pill: {fill: colors2.fill, padX: 0, padY: 0, radius: r2(d / 2)}, pop: true});
    b.parts.push({id: 'vs', role: 'decor', rect: {x: r2(seam.x - d / 2), y: r2(seam.y - d / 2), width: d, height: d}, start: rt(secondAt + 0.15)});
  }
  if (pick) b.events.push({id: `${b.id}-pick`, name: 'pick', time: pickAt, endTime: rt(pickAt + 0.4), role: 'emphasis'});
  b.events.push({id: `${b.id}-right`, name: 'right', time: secondAt, endTime: rt(secondAt + b.entrance.move), role: 'beat'});
  return finishLayout(b, {content: {variant, vs, pick}});
}

// ---------------------------------------------------------------------------
// media-stat

function resolveStat(params, ctx) {
  const b = layoutBase('media-stat', params, ctx, ['media', 'variant', 'kicker', 'value', 'label', 'source'], ['media', 'value']);
  const {check, canvas, safe, u, colors} = b;
  const p = b.params;
  const media = layoutMedia(check, p.media, 'params.media');
  const variant = p.variant === undefined ? 'beside' : check.oneOf(p.variant, 'params.variant', STAT_VARIANTS);
  const entries = contentEntries(b, {kicker: p.kicker, stat: {value: p.value, ...(p.label === undefined ? {} : {label: p.label})}}, {requireSome: true});
  if (p.source !== undefined) entries.push({key: 'source', text: check.str(p.source, 'params.source', 60), family: 'body', preferred: u(44), maxLines: 1, gap: 18, color: mixColor(colors.paper, colors.bg, 0.7), path: 'params.source'});
  if (variant === 'behind') {
    // The footage fills the frame under a dim scrim; the figure sits centred over it.
    addWindow(b, {key: 'media', media, rect: {x: 0, y: 0, width: canvas.width, height: canvas.height}, radius: 0, from: {x: 0, y: 0, scale: 1.04, rotation: 0}, shadow: false});
    b.decor.push({key: 'scrim', rect: {x: 0, y: 0, width: canvas.width, height: canvas.height}, style: {background: `${colors.bg}9e`}, at: b.start});
    const laid = stackText(b, safe, entries, {align: 'center', anchor: 'center', lead: rt(b.start + T.lead + 0.1)});
    addTexts(b, laid, {over: ['win-0'], shadow: true});
    return finishLayout(b, {allowOcclusion: ['*'], content: {variant}});
  }
  const gap = u(40);
  let rect, area;
  if (b.shape === 'wide') {
    rect = {x: safe.x, y: safe.y, width: safe.width * 0.5, height: safe.height};
    area = {x: safe.x + safe.width * 0.5 + gap, y: safe.y, width: safe.width * 0.5 - gap, height: safe.height};
  } else {
    const h = safe.height * (b.shape === 'portrait' ? 0.5 : 0.48);
    rect = {x: safe.x, y: safe.y, width: safe.width, height: h};
    area = {x: safe.x, y: safe.y + h + gap, width: safe.width, height: safe.height - h - gap};
  }
  addWindow(b, {key: 'media', media, rect, radius: u(28)});
  const laid = stackText(b, area, entries, {align: b.shape === 'wide' ? 'left' : 'center', anchor: b.shape === 'wide' ? 'center' : 'top', lead: rt(b.start + T.lead + 0.1)});
  addTexts(b, laid);
  return finishLayout(b, {content: {variant}});
}

// ---------------------------------------------------------------------------
// media-list

function resolveList(params, ctx) {
  const b = layoutBase('media-list', params, ctx, ['title', 'items'], ['items']);
  const {check, safe, u, colors, theme} = b;
  const p = b.params;
  const items = check.arr(p.items, 'params.items', 2, 5);
  const titleEntries = p.title === undefined ? [] : contentEntries(b, {title: p.title}, {requireSome: false, titleSize: b.shape === 'portrait' ? 70 : 60});
  const title = titleEntries.length ? stackText(b, safe, titleEntries, {align: 'left', anchor: 'top'}) : [];
  const titleH = title.length ? unionRect(title.map(entry => entry.box)).height + u(36) : 0;
  const area = {x: safe.x, y: safe.y + titleH, width: safe.width * (b.shape === 'wide' ? 0.72 : 1), height: safe.height - titleH};
  if (b.shape === 'wide') area.x = safe.x + (safe.width - area.width) / 2;
  const gap = u(24);
  const row = Math.min(u(b.shape === 'portrait' ? 210 : 160), (area.height - gap * (items.length - 1)) / items.length);
  if (row < u(96)) check.fail('params.items', `leaves ${Math.round(row)} px a row; drop an item or the title`);
  // Rows spread down the area (up to a 64 px gap), so the list reaches the lower third.
  const rowGap = items.length > 1 ? Math.min(u(64), (area.height - row * items.length) / (items.length - 1)) : 0;
  const top = area.y + (area.height - (row * items.length + rowGap * (items.length - 1))) / 2;
  const spread = Math.max(b.stagger, Math.min(1, (b.duration * 0.6) / items.length));
  const thumbs = [];
  const rows = items.map((raw, i) => {
    const path = `params.items[${i}]`;
    const item = typeof raw === 'string' ? {text: raw} : check.obj(raw, path, ['text', 'media', 'at'], ['text']);
    const at = b.timeOf(`item-${i}`, item.at, `${path}.at`, i * spread, {min: 0, max: b.duration - T.minHold});
    const y = top + i * (row + rowGap);
    const thumb = {x: area.x, y, width: row, height: row};
    if (item.media !== undefined) thumbs.push(addWindow(b, {key: `thumb-${i}`, media: layoutMedia(check, item.media, `${path}.media`), rect: thumb, radius: u(20), at, from: {x: -u(40), y: 0, scale: b.entrance.scale, rotation: 0}}));
    else {
      // No thumbnail: the row's number on a chip in its place.
      const colors2 = chipColors(b);
      b.texts.push({key: `number-${i}`, text: String(i + 1), box: roundRect(thumb), size: r2(row * 0.42), family: 'display', lineHeight: r2(row / (row * 0.42)), lines: 1, align: 'center', color: colors2.ink, at: rt(at), pill: {fill: colors2.fill, padX: 0, padY: 0, radius: u(20)}, pop: true});
    }
    const textArea = {x: area.x + row + u(32), y, width: area.width - row - u(32), height: row};
    const [laid] = stackText(b, textArea, [{key: `item-${i}`, text: check.str(item.text, `${path}.text`, 40), family: 'body', preferred: u(52), maxLines: 2, path: `${path}.text`, at: rt(at + 0.08)}], {anchor: 'center'});
    return {laid, at, thumb};
  });
  if (!thumbs.length) check.fail('params.items', 'needs a thumbnail (media) on at least one row; use a list card for text alone');
  if (title.length) addTexts(b, title.map(entry => ({...entry, at: rt(b.start + T.lead)})), {partId: 'title'});
  rows.forEach(({laid}, i) => addTexts(b, [laid], {partId: `row-${i}`, over: ['self']}));
  // The first window must open the scene: the row order is the narration's, so the first thumbnail leads.
  b.windows.sort((a, c) => a.at - c.at);
  if (b.windows[0].at > b.start + 1e-6) check.fail('params.items', 'the first row with a thumbnail must show at the scene start (at 0), so footage shows from the first frame');
  b.decor.push({key: 'rule', rect: roundRect({x: area.x + row / 2 - u(2), y: top + row / 2, width: u(4), height: (row + rowGap) * (items.length - 1)}), style: {background: theme.border}, at: b.start, base: true});
  for (const [i] of items.entries()) b.events.push({id: `${b.id}-item-${i}`, name: `item-${i}`, time: rows[i].at, endTime: rt(rows[i].at + b.entrance.move), role: 'beat'});
  // The list is one block: its thumbnails and rows together.
  const block = unionRect([...rows.map(row => row.thumb), ...rows.map(row => row.laid.box)]);
  return finishLayout(b, {mainRect: block, content: {rows: items.length, accent: colors.primary}});
}

// ---------------------------------------------------------------------------
// media-grid

function gridRects(n, area, shape, variant, gap) {
  const rects = [];
  if (variant === 'mosaic' && n >= 3) {
    // One large tile, the rest in a row under it (beside it on a wide frame).
    const rest = n - 1;
    if (shape === 'wide') {
      const bigW = (area.width - gap) * 0.6, smallW = area.width - gap - bigW;
      const smallH = (area.height - gap * (rest - 1)) / rest;
      rects.push({x: area.x, y: area.y, width: bigW, height: area.height});
      for (let i = 0; i < rest; i++) rects.push({x: area.x + bigW + gap, y: area.y + i * (smallH + gap), width: smallW, height: smallH});
    } else {
      const bigH = (area.height - gap) * 0.58, smallH = area.height - gap - bigH;
      const smallW = (area.width - gap * (rest - 1)) / rest;
      rects.push({x: area.x, y: area.y, width: area.width, height: bigH});
      for (let i = 0; i < rest; i++) rects.push({x: area.x + i * (smallW + gap), y: area.y + bigH + gap, width: smallW, height: smallH});
    }
    return rects;
  }
  const cols = shape === 'portrait' ? (n === 4 ? 2 : 1) : n === 4 ? 2 : n;
  const rows = Math.ceil(n / cols);
  const w = (area.width - gap * (cols - 1)) / cols, h = (area.height - gap * (rows - 1)) / rows;
  for (let i = 0; i < n; i++) rects.push({x: area.x + (i % cols) * (w + gap), y: area.y + Math.floor(i / cols) * (h + gap), width: w, height: h});
  return rects;
}

function resolveGrid(params, ctx) {
  const b = layoutBase('media-grid', params, ctx, ['title', 'items', 'variant'], ['items']);
  const {check, safe, u} = b;
  const p = b.params;
  const items = check.arr(p.items, 'params.items', 2, 4);
  const variant = p.variant === undefined ? (items.length === 3 && b.shape !== 'wide' ? 'mosaic' : 'grid') : check.oneOf(p.variant, 'params.variant', GRID_VARIANTS);
  const titleEntries = p.title === undefined ? [] : contentEntries(b, {title: p.title}, {requireSome: false, titleSize: b.shape === 'portrait' ? 70 : 60});
  const title = titleEntries.length ? stackText(b, safe, titleEntries, {align: 'center', anchor: 'top'}) : [];
  const titleH = title.length ? unionRect(title.map(entry => entry.box)).height + u(32) : 0;
  const area = {x: safe.x, y: safe.y + titleH, width: safe.width, height: safe.height - titleH};
  const rects = gridRects(items.length, area, b.shape, variant, u(20));
  if (rects.some(rect => rect.width < u(200) || rect.height < u(160))) check.fail('params.items', 'leaves tiles too small to read; drop an item or the title');
  const spread = Math.max(b.stagger, Math.min(1.1, (b.duration * 0.6) / items.length));
  items.forEach((raw, i) => {
    const path = `params.items[${i}]`;
    const item = check.obj(raw, path, ['media', 'label', 'at'], ['media']);
    const at = i === 0 ? (item.at === undefined || item.at === 0 ? b.start : check.fail(`${path}.at`, 'the first tile opens the scene (footage from the first frame): leave its at at 0'))
      : b.timeOf(`item-${i}`, item.at, `${path}.at`, i * spread, {min: 0, max: b.duration - T.minHold});
    addWindow(b, {key: `tile-${i}`, media: layoutMedia(check, item.media, `${path}.media`), rect: rects[i], radius: u(22), at, from: {x: 0, y: u(b.entrance.rise), scale: b.entrance.scale, rotation: b.entrance.rotation ? (i % 2 ? 2 : -2) : 0}});
    if (item.label !== undefined) {
      const labelAt = rt(at + T.lead);
      const label = pill(b, {key: `label-${i}`, text: check.str(item.label, `${path}.label`, 28), x: rects[i].x + u(18), y: rects[i].y + rects[i].height - u(18) - (u(44) * 1.2 + u(20)), size: u(44), at: labelAt, maxWidth: rects[i].width - u(36), path: `${path}.label`});
      b.parts.push({id: `label-${i}`, role: 'text', rect: label.box, minTextPx: label.size, start: labelAt, motion: {enterEnd: rt(labelAt + T.textFade), exitStart: rt(b.end - T.exit)}, over: [`win-${i}`]});
    }
    b.events.push({id: `${b.id}-item-${i}`, name: `item-${i}`, time: rt(at), endTime: rt(at + b.entrance.move), role: 'beat'});
  });
  if (title.length) addTexts(b, title.map(entry => ({...entry, at: rt(b.start + T.lead)})), {partId: 'title'});
  return finishLayout(b, {content: {variant}});
}

// ---------------------------------------------------------------------------
// View and timeline (shared)

/** Element trees: {base, windows: [node], overlay}. A video window is the <video> itself; a still is a framed <img>. */
export function mediaLayoutView(model) {
  const {id, canvas, fonts} = model;
  const c = model.content;
  const full = abs(0, 0, canvas.width, canvas.height, {opacity: 0, pointerEvents: 'none'});
  const baseKids = [];
  if (c.base?.fill) baseKids.push(el('div', `${id}-fill`, abs(0, 0, canvas.width, canvas.height, {background: c.base.fill})));
  for (const d of c.decor.filter(item => item.base)) baseKids.push(el('div', `${id}-${d.key}`, abs(d.rect.x, d.rect.y, d.rect.width, d.rect.height, {...d.style})));
  const base = el('div', `${id}-base`, full, baseKids);
  const windows = c.windows.map((win, i) => {
    const {rect, media} = win;
    const ring = win.ring && !win.ring.at ? `, 0 0 0 ${win.ring.width}px ${win.ring.color}` : '';
    const frame = {borderRadius: win.radius, background: '#000000', opacity: 0, transformOrigin: '50% 50%', ...(win.shadow || ring ? {boxShadow: `${win.shadow ?? `0 0 0 0 #0000`}${ring}`} : {})};
    if (media.kind === 'video') return el('video', `${id}-win-${i}`, abs(rect.x, rect.y, rect.width, rect.height, {...frame, objectFit: 'cover', objectPosition: media.objectPosition}), [], {src: media.src, muted: '', playsinline: ''});
    const img = el('img', `${id}-img-${i}`, abs(0, 0, rect.width, rect.height, {objectFit: 'cover', objectPosition: media.objectPosition, transformOrigin: '50% 50%'}), [], {src: media.src, alt: ''});
    return el('div', `${id}-win-${i}`, abs(rect.x, rect.y, rect.width, rect.height, {...frame, overflow: 'hidden'}), [img]);
  });
  const kids = [];
  for (const d of c.decor.filter(item => !item.base)) kids.push(el('div', `${id}-${d.key}`, abs(d.rect.x, d.rect.y, d.rect.width, d.rect.height, {...d.style, opacity: 0, transformOrigin: d.wipe === 'x' ? '0% 50%' : d.wipe === 'y' ? '50% 0%' : '50% 50%'})));
  c.windows.forEach((win, i) => {
    if (win.ring?.at) kids.push(el('div', `${id}-ring-${i}`, abs(win.rect.x, win.rect.y, win.rect.width, win.rect.height, {boxSizing: 'border-box', borderRadius: win.radius, border: `${win.ring.width}px solid ${win.ring.color}`, opacity: 0})));
  });
  for (const t of c.texts) {
    const style = {margin: 0, boxSizing: 'border-box', fontFamily: fonts[t.family] ?? fonts.body, fontSize: t.size, lineHeight: String(r2(t.lineHeight)), color: t.color, textAlign: t.align, opacity: 0, transformOrigin: '50% 50%',
      whiteSpace: t.lines > 1 ? 'normal' : 'nowrap', ...(t.shadow ? {textShadow: `0 ${4 * model.unit}px ${24 * model.unit}px #00000099`} : {})};
    if (t.pill) Object.assign(style, {background: t.pill.fill, borderRadius: t.pill.radius, padding: `${t.pill.padY}px ${t.pill.padX}px`});
    const children = [t.count ? formatCount(t.count, 0) : t.text];
    const node = el('div', `${id}-${t.key}`, abs(t.box.x, t.box.y, t.box.width, t.box.height, style), children);
    if (t.bullet) {
      const dot = el('div', `${id}-${t.key}-dot`, abs(t.box.x - t.bullet.size - model.unit * 22, t.box.y + t.size * t.lineHeight / 2 - t.bullet.size / 2, t.bullet.size, t.bullet.size, {borderRadius: t.bullet.size / 2, background: t.bullet.color, opacity: 0}));
      kids.push(dot);
    }
    kids.push(node);
  }
  const overlay = el('div', `${id}-overlay`, full, kids);
  return {base, windows, overlay};
}

/** Renderer-neutral ops: root fades, each window's entrance and exit, a still's slow push, the decor, the text, the count-ups. */
export function mediaLayoutTimeline(model) {
  const {id, start, end} = model;
  const c = model.content, m = model.motion;
  const ops = [];
  const from = Number.isFinite(m.enterFrom?.opacity) ? m.enterFrom.opacity : 0;
  const to = Number.isFinite(m.exitTo?.opacity) ? m.exitTo.opacity : 0;
  const exitFor = m.exitDuration;
  const exit = (target) => {
    if (to < 1 && exitFor > 0) tw(ops, target, m.exitStart, exitFor, m.exitEase, {opacity: 1}, {opacity: to});
    set(ops, target, end, {opacity: 0});
  };
  for (const target of [`${id}-base`, `${id}-overlay`]) {
    set(ops, target, start, {opacity: from});
    if (from < 1 && m.enterDuration > 0) tw(ops, target, start, m.enterDuration, m.enterEase, {opacity: from}, {opacity: 1});
    exit(target);
  }
  c.windows.forEach((win, i) => {
    const target = `${id}-win-${i}`;
    const opening = win.at <= start + 1e-6;
    const o = opening ? from : 0;
    const moved = {x: win.from.x, y: win.from.y, scaleX: win.from.scale, scaleY: win.from.scale, rotation: win.from.rotation};
    set(ops, target, start, {opacity: o, ...moved});
    if (o < 1) tw(ops, target, win.at, c.entrance.fade, c.fadeEase, {opacity: o}, {opacity: 1});
    tw(ops, target, win.at, c.entrance.move, c.enterEase, moved, {x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0});
    exit(target);
    if (win.media.kind === 'image') {
      set(ops, `${id}-img-${i}`, start, {scaleX: 1, scaleY: 1});
      tw(ops, `${id}-img-${i}`, start, end - start, 'none', {scaleX: 1, scaleY: 1}, {scaleX: 1 + c.push, scaleY: 1 + c.push});
    }
    if (win.ring?.at) {
      set(ops, `${id}-ring-${i}`, start, {opacity: 0, scaleX: 1.04, scaleY: 1.04});
      tw(ops, `${id}-ring-${i}`, win.ring.at, 0.35, c.fadeEase, {opacity: 0, scaleX: 1.04, scaleY: 1.04}, {opacity: 1, scaleX: 1, scaleY: 1});
    }
  });
  for (const d of c.decor) {
    if (d.base) continue;
    const target = `${id}-${d.key}`;
    if (d.wipe) {
      const axis = d.wipe === 'x' ? 'scaleX' : 'scaleY';
      set(ops, target, start, {opacity: 1, [axis]: 0});
      tw(ops, target, d.at, 0.55, c.enterEase, {[axis]: 0}, {[axis]: 1});
    } else {
      set(ops, target, start, {opacity: d.at <= start + 1e-6 ? 1 : 0});
      if (d.at > start + 1e-6) tw(ops, target, d.at, c.textFade, c.fadeEase, {opacity: 0}, {opacity: 1});
    }
  }
  for (const t of c.texts) {
    const target = `${id}-${t.key}`;
    const lift = t.pop ? {y: 0, scaleX: 0.6, scaleY: 0.6} : {y: c.textRise, scaleX: 1, scaleY: 1};
    set(ops, target, start, {opacity: 0, x: 0, ...lift});
    tw(ops, target, t.at, c.textFade, c.fadeEase, {opacity: 0}, {opacity: 1});
    tw(ops, target, t.at, c.textFade * (t.pop ? 1.4 : 1.8), t.pop ? 'back.out(1.7)' : c.enterEase, lift, {y: 0, scaleX: 1, scaleY: 1});
    if (t.bullet) {
      set(ops, `${target}-dot`, start, {opacity: 0, scaleX: 0, scaleY: 0});
      tw(ops, `${target}-dot`, t.at, c.textFade, 'back.out(1.7)', {opacity: 0, scaleX: 0, scaleY: 0}, {opacity: 1, scaleX: 1, scaleY: 1});
    }
    if (t.count) {
      // The figure counts up from 0, one set a frame (seek-safe), landing on the exact text.
      const fps = model.fps;
      const steps = Math.max(2, Math.round(c.count * fps));
      for (let k = 0; k <= steps; k++) {
        const p = k / steps;
        const eased = 1 - (1 - p) ** 3;
        ops.push({type: 'set', target, time: rt(t.at + p * c.count), props: {text: k === steps ? t.text : formatCount(t.count, t.count.value * eased)}});
      }
    }
  }
  return ops;
}

const definition = (id, describe, params, events, resolve, rules = []) => ({id, describe, params, events,
  timing: {minDuration: T.minDuration, leadIn: 0, leadOut: T.exit + T.textFade, gaps: [], rules: ['the first window shows at the scene start (footage from the first visible frame)', `the last reveal at least ${r2(T.exit + T.textFade)} s before the scene ends`, ...rules]},
  resolve});

const MEDIA = '"assets/…" video (.mp4|.webm|.mov|.m4v) or still (.jpg|.png|.webp|.svg), or {src, kind?, sourceStart? (video), focus?: {x, y} 0–1, the point kept in the crop}';
const CONTENT = {
  kicker: 'string ≤ 32, a small label over the title (optional)',
  title: 'string ≤ 60, up to two lines (the line, in a few words)',
  body: 'string ≤ 90, one or two lines under the title (optional; one of body, stat, items)',
  stat: '{value: string ≤ 12 (a figure like "1,200 kg" counts up), label?: string ≤ 40} (optional; one of body, stat, items)',
  items: '[string ≤ 32 | {text, at?}] 2–4, revealed one by one on their words (optional; one of body, stat, items)'
};

export const splitScreen = definition('split-screen',
  'Footage fills the top or bottom half of the frame (left or right on a wide frame) and the other half carries the line: a title, a stat or a short list, across an accent line or a soft blend. Keeps captions.',
  {media: MEDIA, variant: 'top|bottom|left|right: where the footage sits (default top; on a 16:9 frame top → left, bottom → right)', share: '0.3–0.65, the footage\'s share of the frame (default 0.4 top on 9:16, else 0.5)',
    divider: 'line|blend (default line): an accent line that wipes across the seam, or the footage fading into the panel', ...CONTENT, align: 'left|center (default left)'},
  ['item-<i>'], resolveSplit);
export const landscapeCard = definition('landscape-card',
  'A landscape clip letterboxed in a rounded window mid-frame (16:9 by default), a title above and a caption or chip below: landscape library footage without a heavy crop. Keeps captions.',
  {media: MEDIA, aspect: '16:9|4:3|1:1|4:5|21:9, the window (default 16:9)', kicker: CONTENT.kicker, title: 'string ≤ 60 above the window (optional)', caption: 'string ≤ 60 under the window (optional)', chip: 'string ≤ 24, a pill under the window (optional)'},
  [], resolveLandscape);
export const pictureInPicture = definition('picture-in-picture',
  'A rounded clip card in a corner of a panel that carries the line: a title, a stat or a short list beside or under it. Keeps captions.',
  {media: MEDIA, variant: 'top-right|top-left|bottom-right|bottom-left (default top-right)', aspect: '16:9|4:3|1:1|4:5|21:9, the card (default 1:1 on 9:16, else 16:9)', ...CONTENT, align: 'left|center (default left)'},
  ['item-<i>'], resolvePip);
export const mediaCompare = definition('media-compare',
  'Two options, each in its own footage with a label (hardwood vs composite): stacked on a 9:16 frame, side by side on a wide one; the second lands on its word, a VS chip between, and the pick (optional) gets an accent ring. Keeps captions.',
  {left: `{media: ${MEDIA}, label: string ≤ 24}`, right: '{media, label} as left', variant: 'stacked|side (default stacked on 9:16, else side)', title: 'string ≤ 60 over the pair (optional)', vs: 'boolean (default true): the VS chip', pick: 'left|right, the option to ring (optional)', at: 'seconds from scene start when the second option lands (optional; else the "right" hit, else 35% in)'},
  ['right', 'pick'], resolveCompare);
export const mediaStat = definition('media-stat',
  'A figure that counts up with its label, beside a footage window or over full-frame footage under a dim scrim. Keeps captions.',
  {media: MEDIA, variant: 'beside|behind (default beside)', value: 'string ≤ 12, the figure ("1,200 kg", "87%", "$4.5M" count up)', label: 'string ≤ 40 (optional)', kicker: CONTENT.kicker, source: 'string ≤ 60, where the figure comes from (optional)'},
  [], resolveStat);
export const mediaList = definition('media-list',
  'A list of 2–5 rows, each with a small footage thumbnail (or its number) and a line of text, revealed one by one on their words. Keeps captions.',
  {title: 'string ≤ 60 (optional)', items: `[{text ≤ 40, media?: ${MEDIA}, at?}] 2–5, at least one with media; the first shows at the scene start`},
  ['item-<i>'], resolveList);
export const mediaGrid = definition('media-grid',
  'Two to four tiles of footage, each with an optional label, revealed one by one with the narration ("three options"): a grid, or a mosaic with one large tile. Keeps captions.',
  {title: 'string ≤ 60 (optional)', items: `[{media: ${MEDIA}, label?: string ≤ 28, at?}] 2–4; the first shows at the scene start`, variant: 'grid|mosaic (default mosaic for three on 9:16 and 1:1, else grid)'},
  ['item-<i>'], resolveGrid);

/** The seven media layouts, in catalogue order. */
export const MEDIA_LAYOUTS = Object.freeze([splitScreen, landscapeCard, pictureInPicture, mediaCompare, mediaStat, mediaList, mediaGrid]);
/** Variants per media layout (the insert-variety pass rotates through them). */
export const MEDIA_LAYOUT_VARIANTS = Object.freeze({'split-screen': SPLIT_VARIANTS, 'picture-in-picture': PIP_VARIANTS, 'media-compare': COMPARE_VARIANTS, 'media-stat': STAT_VARIANTS, 'media-grid': GRID_VARIANTS});
