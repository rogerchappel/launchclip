// Catalogue H paper and labels: polaroid, sticker, torn-paper, tape-note,
// badge and ribbon. Handmade shapes (torn edges, tape ends, starbursts) are
// static clip-path polygons from a seed of the module's text, so both
// renderers cut the same edge every frame. Registered in kit/core/catalog-h.mjs.

import {CATALOG_B_STYLE, timingRules} from './catalog-b-base.mjs';
import {VARIANT_PARAM, clip, createHBase, fitText, inkOn, mixColor, r2, rt, textWidth, toneColor} from './catalog-h-base.mjs';
import {abs, el, label, popOps, riseOps, set, tw} from './catalog-h-view.mjs';
import {iconNode, isIcon} from './icons.mjs';

const at = 'seconds from scene start (optional; else a matching hit, else a default)';
const rect = '{x, y, width, height} canvas px inside the safe zone (optional)';
const tone = 'primary | accent | paper | #rrggbb';
const TIMING = timingRules({rules: ['the element lands at at']});
const SERIF = CATALOG_B_STYLE.serif;

/** Deterministic 0..1 sequence from a string (mulberry32 on an FNV hash). */
export function seeded(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A clip-path polygon with torn (jagged) edges on the named sides, depth in percent. */
export function tornPolygon(rand, {top = false, right = false, bottom = false, left = false, depth = 2.4, teeth = 28}) {
  const pts = [];
  const jag = () => r2(rand() * depth);
  const run = (n, fn) => { for (let i = 0; i <= n; i++) pts.push(fn(i / n)); };
  run(top ? teeth : 1, f => [r2(f * 100), top ? jag() : 0]);
  run(right ? Math.round(teeth * 0.6) : 1, f => [right ? r2(100 - jag()) : 100, r2(f * 100)]);
  run(bottom ? teeth : 1, f => [r2(100 - f * 100), bottom ? r2(100 - jag()) : 100]);
  run(left ? Math.round(teeth * 0.6) : 1, f => [left ? jag() : 0, r2(100 - f * 100)]);
  return `polygon(${pts.map(([x, y]) => `${x}% ${y}%`).join(', ')})`;
}

const starburst = (points, inner = 0.82) => `polygon(${Array.from({length: points * 2}, (_, i) => {
  const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2, r = i % 2 ? inner : 1;
  return `${r2(50 + 50 * r * Math.cos(a))}% ${r2(50 + 50 * r * Math.sin(a))}%`;
}).join(', ')})`;

function showTime(b, p, name = 'show', fallback = 0.5, cue = 'pop') {
  const time = b.timeOf(name, p.at, 'params.at', fallback);
  b.events.push({id: `${b.id}-${name}`, name, time, endTime: rt(time + 0.5), role: 'emphasis', cue});
  return time;
}

const angle = (b, raw, path, fallback) => (raw === undefined ? fallback : b.check.num(raw, path, -20, 20));

// ---------------------------------------------------------------------------
// polaroid

const POLAROID_VARIANTS = Object.freeze(['single', 'stack', 'pinned']);

function polaroidResolve(params, ctx) {
  const b = createHBase('polaroid', params, ctx, {allowed: ['image', 'caption', 'icon', 'at', 'tilt'], required: [], variants: POLAROID_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  const image = p.image === undefined ? null : check.asset(p.image, 'params.image');
  const icon = p.icon === undefined ? 'image' : p.icon;
  if (!isIcon(icon)) check.fail('params.icon', 'must be an icon name from kit/core/icons.mjs');
  const captionText = p.caption === undefined ? null : check.str(p.caption, 'params.caption', 40);
  const tilt = angle(b, p.tilt, 'params.tilt', -4);
  const W = rect.width, H = rect.height;
  const frameW = r2(Math.min(W * 0.82, (H * 0.86) / 1.2, u(760)));
  const border = r2(frameW * 0.06), photo = r2(frameW - border * 2), bottom = r2(frameW * 0.24);
  const frameH = r2(border + photo + bottom);
  const cap = captionText ? fitText(check, 'params.caption', captionText, {family: 'serif', width: photo, preferred: Math.min(u(64), bottom * 0.62), min: b.min.key, maxLines: 1}) : null;
  const t = showTime(b, p, 'show', 0.5, 'whoosh');
  const content = {variant: b.variant, image, icon, caption: cap ? {text: captionText, size: cap.size} : null, tilt, frame: {x: r2((W - frameW) / 2), y: r2((H - frameH) / 2), width: frameW, height: frameH, border, photo, bottom},
    t, paper: mixColor('#ffffff', b.colors.paper, 0.5), ink: '#1b1b1f', photoBg: `linear-gradient(160deg, ${b.colors.primary}, ${mixColor(b.colors.accent, b.colors.bg, 0.7)})`, iconColor: inkOn(b.colors, b.colors.primary), pin: b.colors.accent, tape: `${b.colors.paper}b3`};
  return b.finish(content, {minTextPx: cap ? cap.size : b.min.key});
}

function polaroidView(model) {
  const {id, unit: u} = model;
  const c = model.content;
  const F = c.frame;
  const card = (nodeId, rot, children, extra = {}) => el('div', nodeId, {...abs(F.x, F.y, F.width, F.height), boxSizing: 'border-box', background: c.paper, borderRadius: r2(6 * u), boxShadow: `0 ${r2(24 * u)}px ${r2(50 * u)}px #000000a6`, transform: `rotate(${rot}deg)`, transformOrigin: '50% 50%', ...extra}, children);
  const photo = c.image ? el('img', null, abs(F.border, F.border, F.photo, F.photo, {objectFit: 'cover', display: 'block'}), [], {src: c.image, alt: ''})
    : el('div', null, abs(F.border, F.border, F.photo, F.photo, {background: c.photoBg}), [iconNode(c.icon, {x: r2(F.photo * 0.3), y: r2(F.photo * 0.3), size: r2(F.photo * 0.4), color: c.iconColor, stroke: 1.5})]);
  const kids = [];
  if (c.variant === 'stack') {
    kids.push(card(`${id}-back-1`, c.tilt + 9, [], {opacity: 0, background: mixColor('#ffffff', '#000000', 0.82)}));
    kids.push(card(`${id}-back-0`, c.tilt - 7, [], {opacity: 0, background: mixColor('#ffffff', '#000000', 0.9)}));
  }
  const inner = [photo, el('div', `${id}-develop`, abs(F.border, F.border, F.photo, F.photo, {background: '#0d0e12'}))];
  if (c.caption) inner.push(label(null, F.border, r2(F.border + F.photo + (F.bottom - c.caption.size * 1.2) / 2), F.photo, c.caption.text, {size: c.caption.size, family: SERIF, color: c.ink, align: 'center', extra: {fontStyle: 'italic'}}));
  kids.push(el('div', `${id}-photo`, {...abs(0, 0, model.rect.width, model.rect.height), opacity: 0}, [card(null, c.tilt, inner)]));
  if (c.variant === 'pinned') {
    const d = r2(F.width * 0.08);
    kids.push(el('div', `${id}-pin`, abs(r2(F.x + F.width / 2 - d / 2), r2(F.y - d * 0.3), d, d, {borderRadius: '50%', background: `radial-gradient(circle at 35% 30%, #ffffff 0%, ${c.pin} 35%, ${mixColor(c.pin, '#000000', 0.6)} 100%)`, boxShadow: `${r2(6 * u)}px ${r2(10 * u)}px ${r2(12 * u)}px #00000080`, opacity: 0})));
  }
  return kids;
}

function polaroidTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  if (c.variant === 'stack') [0, 1].forEach(i => riseOps(ops, `${id}-back-${i}`, start, rt(c.t - 0.12 + i * 0.06), r2(-60 * u), {duration: 0.5}));
  set(ops, `${id}-photo`, start, {opacity: 0, x: 0, y: r2(-260 * u), rotation: -14, scaleX: 1.08, scaleY: 1.08});
  tw(ops, `${id}-photo`, c.t, 0.18, 'power1.out', {opacity: 0}, {opacity: 1});
  tw(ops, `${id}-photo`, c.t, 0.75, 'back.out(1.3)', {y: r2(-260 * u), rotation: -14, scaleX: 1.08, scaleY: 1.08}, {y: 0, rotation: 0, scaleX: 1, scaleY: 1});
  // The photo develops: the dark layer fades away.
  set(ops, `${id}-develop`, start, {opacity: 1});
  tw(ops, `${id}-develop`, rt(c.t + 0.45), 0.9, 'power2.out', {opacity: 1}, {opacity: 0});
  if (c.variant === 'pinned') popOps(ops, `${id}-pin`, start, rt(c.t + 0.6), {from: 1.8, duration: 0.35, ease: 'power3.out'});
}

export const polaroid = {
  id: 'polaroid',
  describe: 'An instant photo drops in, tilts to rest and develops from dark, with a handwritten-style caption; single, a stack of three, or pinned.',
  params: {image: 'assets/… photo (optional; else a brand gradient with an icon)', icon: 'icon for the placeholder photo (default "image")', caption: 'string ≤ 40 (optional)', tilt: 'degrees −20–20 (default −4)', at: `drops: ${at}`, variant: VARIANT_PARAM, rect},
  events: ['show'], timing: TIMING, variants: POLAROID_VARIANTS,
  resolve: polaroidResolve, view: polaroidView, timeline: polaroidTimeline
};

// ---------------------------------------------------------------------------
// sticker

const STICKER_VARIANTS = Object.freeze(['die-cut', 'round', 'burst']);

function stickerResolve(params, ctx) {
  const b = createHBase('sticker', params, ctx, {allowed: ['text', 'icon', 'tone', 'at', 'tilt', 'size'], required: [], variants: STICKER_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  const text = p.text === undefined ? null : check.str(p.text, 'params.text', 24);
  const icon = p.icon === undefined ? null : p.icon;
  if (icon !== null && !isIcon(icon)) check.fail('params.icon', 'must be an icon name from kit/core/icons.mjs');
  if (!text && !icon) check.fail('params', 'needs text or an icon');
  const fill = toneColor(b, p.tone, 'params.tone');
  const ink = inkOn(b.colors, fill);
  const tilt = angle(b, p.tilt, 'params.tilt', -8);
  const scale = p.size === undefined ? 1 : check.num(p.size, 'params.size', 0.5, 1.5);
  const round = b.variant !== 'die-cut';
  const W = rect.width, H = rect.height;
  let box;
  let size = 0;
  const words = text ? text.toUpperCase() : null;
  if (round) {
    const d = r2(Math.min(W, H, u(560)) * scale);
    box = {width: d, height: d};
    if (words) size = fitText(check, 'params.text', words, {family: 'display', width: d * (b.variant === 'burst' ? 0.6 : 0.7), preferred: d * (icon ? 0.16 : 0.22), min: b.min.key, maxLines: 2}).size;
  } else {
    size = words ? fitText(check, 'params.text', words, {family: 'display', width: W * 0.8, preferred: u(120) * scale, min: b.min.key, maxLines: 1}).size : 0;
    const iconSize = icon ? r2(Math.max(size, u(90) * scale)) : 0;
    box = {width: r2((words ? textWidth(words, size, 'display') : 0) + iconSize + (words && icon ? u(24) : 0) + u(110) * scale), height: r2(Math.max(size * 1.2, iconSize) + u(80) * scale)};
    box.iconSize = iconSize;
  }
  box.x = r2((W - box.width) / 2); box.y = r2((H - box.height) / 2);
  const t = showTime(b, p, 'slap', 0.5, 'impact');
  const lines = words && round ? fitText(check, 'params.text', words, {family: 'display', width: box.width * (b.variant === 'burst' ? 0.6 : 0.7), preferred: size, min: size, maxLines: 2}).lines : 1;
  const content = {variant: b.variant, text: words, icon, fill, ink, tilt, box, size, lines, t, edge: '#ffffff', shape: b.variant === 'burst' ? starburst(14, 0.84) : null};
  return b.finish(content, {minTextPx: size || b.min.key});
}

function stickerView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const B = c.box;
  const edge = r2(Math.max(10 * u, B.height * 0.06));
  const inner = [];
  if (c.variant === 'die-cut') {
    let x = 0;
    if (c.icon) { inner.push(iconNode(c.icon, {x: r2(edge + 40 * u), y: r2((B.height - B.iconSize) / 2), size: B.iconSize, color: c.ink, stroke: 2.4})); x = r2(edge + 40 * u + B.iconSize + 24 * u); }
    if (c.text) inner.push(label(null, c.icon ? x : 0, r2((B.height - c.size * 1.2) / 2), c.icon ? r2(B.width - x) : B.width, c.text, {size: c.size, family: fonts.display, color: c.ink, align: c.icon ? 'left' : 'center'}));
  } else {
    const iconSize = c.icon ? r2(B.width * (c.text ? 0.22 : 0.42)) : 0;
    const textH = c.text ? c.size * 1.08 * c.lines : 0;
    const top = r2((B.height - iconSize - textH - (c.icon && c.text ? 14 * u : 0)) / 2);
    if (c.icon) inner.push(iconNode(c.icon, {x: r2((B.width - iconSize) / 2), y: top, size: iconSize, color: c.ink, stroke: 2.4}));
    if (c.text) inner.push(label(null, r2(B.width * 0.15), r2(top + iconSize + (c.icon ? 14 * u : 0)), r2(B.width * 0.7), c.text, {size: c.size, family: fonts.display, color: c.ink, align: 'center', lineHeight: 1.08, wrap: c.lines > 1}));
  }
  const shape = c.variant === 'die-cut' ? {borderRadius: r2(B.height * 0.32)} : c.variant === 'round' ? {borderRadius: '50%'} : {clipPath: c.shape};
  // The white die-cut edge is a larger shape behind the sticker; the shadow sits under both.
  const back = c.variant === 'burst'
    ? el('div', null, {...abs(r2(-edge), r2(-edge), r2(B.width + edge * 2), r2(B.height + edge * 2)), background: c.edge, clipPath: c.shape})
    : el('div', null, {...abs(r2(-edge), r2(-edge), r2(B.width + edge * 2), r2(B.height + edge * 2)), background: c.edge, borderRadius: c.variant === 'round' ? '50%' : r2(B.height * 0.32 + edge), boxShadow: `0 ${r2(16 * u)}px ${r2(34 * u)}px #00000099`});
  return [el('div', `${id}-sticker`, {...abs(B.x, B.y, B.width, B.height), opacity: 0, transformOrigin: '50% 50%', transform: `rotate(${c.tilt}deg)`}, [
    back, el('div', null, {...abs(0, 0, B.width, B.height), background: c.fill, ...shape}, inner),
    // The shine sweeps across inside the sticker's own shape.
    el('div', null, {...abs(0, 0, B.width, B.height), ...shape, overflow: 'hidden'}, [
      el('div', `${id}-shine`, {...abs(0, 0, B.width, B.height), background: 'linear-gradient(115deg, #ffffff00 30%, #ffffff66 45%, #ffffff00 60%)', opacity: 0})])
  ])];
}

function stickerTimeline(model, ops) {
  const {id, start} = model;
  const c = model.content;
  set(ops, `${id}-sticker`, start, {opacity: 0, x: 0, y: 0, rotation: c.tilt + 18, scaleX: 1.7, scaleY: 1.7});
  tw(ops, `${id}-sticker`, c.t, 0.08, 'power1.out', {opacity: 0}, {opacity: 1});
  tw(ops, `${id}-sticker`, c.t, 0.45, 'back.out(2.2)', {rotation: c.tilt + 18, scaleX: 1.7, scaleY: 1.7}, {rotation: c.tilt, scaleX: 1, scaleY: 1});
  set(ops, `${id}-shine`, start, {opacity: 0, x: -c.box.width, y: 0});
  set(ops, `${id}-shine`, rt(c.t + 0.4), {opacity: 1});
  tw(ops, `${id}-shine`, rt(c.t + 0.4), 0.6, 'power2.inOut', {x: -c.box.width}, {x: c.box.width});
}

export const sticker = {
  id: 'sticker',
  describe: 'A die-cut sticker slaps on with a white edge and a shine sweep: a label with an optional icon, a round sticker, or a starburst.',
  params: {text: 'string ≤ 24 (uppercased; or icon)', icon: 'icon name (optional)', tone: `fill (${tone}; default primary)`, tilt: 'degrees −20–20 (default −8)', size: 'scale 0.5–1.5', at: `slap: ${at}`, variant: VARIANT_PARAM, rect},
  events: ['slap'], timing: TIMING, variants: STICKER_VARIANTS,
  resolve: stickerResolve, view: stickerView, timeline: stickerTimeline
};

// ---------------------------------------------------------------------------
// torn-paper

const TORN_VARIANTS = Object.freeze(['note', 'strip', 'scrap']);

function tornResolve(params, ctx) {
  const b = createHBase('torn-paper', params, ctx, {allowed: ['text', 'kicker', 'at', 'tilt'], required: ['text'], variants: TORN_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  const text = check.str(p.text, 'params.text', 140);
  const kicker = p.kicker === undefined ? null : check.str(p.kicker, 'params.kicker', 28).toUpperCase();
  const W = rect.width, H = rect.height;
  const strip = b.variant === 'strip';
  const boxW = r2(strip ? W : Math.min(W * 0.92, u(900)));
  const pad = r2(u(strip ? 48 : 64));
  const fit = fitText(check, 'params.text', text, {family: strip ? 'display' : 'serif', width: boxW - pad * 2, preferred: u(strip ? 110 : 74), min: b.min.key, maxLines: strip ? 2 : 6});
  const kickerSize = r2(Math.max(b.min.meta, u(28)));
  const textH = fit.size * (strip ? 1.05 : 1.25) * fit.lines;
  const boxH = r2(pad * 2 + textH + (kicker ? kickerSize * 1.4 + u(18) : 0));
  if (boxH > H) check.fail('params.text', 'is too long for the rect');
  const rand = seeded(text);
  const edges = strip ? {left: true, right: true, top: true, bottom: true, depth: 1.6} : b.variant === 'note' ? {bottom: true, depth: 3.5} : {top: true, right: true, bottom: true, left: true, depth: 3};
  const tilt = angle(b, p.tilt, 'params.tilt', strip ? -2 : b.variant === 'scrap' ? 3 : -1.5);
  const t = showTime(b, p, 'show', 0.5, 'whoosh-soft');
  const content = {variant: b.variant, text, kicker, kickerSize, size: fit.size, lines: fit.lines, pad, tilt, t, box: {x: r2((W - boxW) / 2), y: r2((H - boxH) / 2), width: boxW, height: boxH},
    polygon: tornPolygon(rand, {...edges, teeth: strip ? 40 : 30}), paper: strip ? b.colors.primary : mixColor('#ffffff', b.colors.paper, 0.35), ink: strip ? inkOn(b.colors, b.colors.primary) : '#1c1b19', accent: b.colors.primary};
  return b.finish(content, {minTextPx: fit.size});
}

function tornView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const B = c.box;
  const strip = c.variant === 'strip';
  const inner = [];
  let y = c.pad;
  if (c.kicker) { inner.push(label(null, c.pad, y, r2(B.width - c.pad * 2), c.kicker, {size: c.kickerSize, family: fonts.meta, color: strip ? c.ink : c.accent === c.paper ? c.ink : mixColor(c.ink, c.paper, 0.6), spacing: '0.14em'})); y += c.kickerSize * 1.4 + 18 * u; }
  inner.push(label(`${id}-text`, c.pad, r2(y), r2(B.width - c.pad * 2), c.text, {size: c.size, family: strip ? fonts.display : SERIF, color: c.ink, lineHeight: strip ? 1.05 : 1.25, wrap: true, align: strip ? 'center' : 'left'}));
  if (!strip) for (let k = 1; k <= c.lines; k++) inner.push(el('div', null, abs(c.pad, r2(y + c.size * 1.25 * k - 4 * u), r2(B.width - c.pad * 2), r2(2 * u), {background: '#00000014'})));
  // Paper texture: two faint diagonal grains; the shadow follows the torn shape via drop-shadow.
  return [el('div', `${id}-paper`, {...abs(B.x, B.y, B.width, B.height), transform: `rotate(${c.tilt}deg)`, transformOrigin: '50% 0%', filter: `drop-shadow(0 ${r2(18 * u)}px ${r2(22 * u)}px #00000099)`, opacity: 0}, [
    el('div', `${id}-sheet`, {...abs(0, 0, B.width, B.height), background: `linear-gradient(170deg, ${c.paper} 0%, ${mixColor('#000000', c.paper, 0.08)} 100%)`, clipPath: c.polygon}, inner)
  ])];
}

function tornTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  set(ops, `${id}-paper`, start, {opacity: 0, x: 0, y: r2(30 * u), rotation: c.tilt - 4});
  tw(ops, `${id}-paper`, c.t, 0.2, 'power1.out', {opacity: 0}, {opacity: 1});
  tw(ops, `${id}-paper`, c.t, 0.7, 'power3.out', {y: r2(30 * u), rotation: c.tilt - 4}, {y: 0, rotation: c.tilt});
  // The text is written in after the sheet lands (a wipe left to right).
  set(ops, `${id}-text`, start, clip(0, 100, 0, 0));
  tw(ops, `${id}-text`, rt(c.t + 0.3), Math.min(1.1, 0.25 + c.text.length * 0.012), 'power1.inOut', clip(0, 100, 0, 0), clip(0, 0, 0, 0));
}

export const tornPaper = {
  id: 'torn-paper',
  describe: 'A scrap of torn paper lands with a shadow that follows its ragged edge, and its words wipe on: a lined note, a torn headline strip in the brand colour, or a scrap torn on every side.',
  params: {text: 'string ≤ 140, required', kicker: 'string ≤ 28 above the text (optional)', tilt: 'degrees −20–20', at: `lands: ${at}`, variant: VARIANT_PARAM, rect},
  events: ['show'], timing: TIMING, variants: TORN_VARIANTS,
  resolve: tornResolve, view: tornView, timeline: tornTimeline
};

// ---------------------------------------------------------------------------
// tape-note

const TAPE_VARIANTS = Object.freeze(['corners', 'top', 'sides']);

function tapeResolve(params, ctx) {
  const b = createHBase('tape-note', params, ctx, {allowed: ['title', 'text', 'icon', 'at', 'tilt', 'tone'], required: ['title'], variants: TAPE_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  const title = check.str(p.title, 'params.title', 48);
  const text = p.text === undefined ? null : check.str(p.text, 'params.text', 120);
  const icon = p.icon === undefined ? null : p.icon;
  if (icon !== null && !isIcon(icon)) check.fail('params.icon', 'must be an icon name from kit/core/icons.mjs');
  const tapeColor = toneColor(b, p.tone, 'params.tone', 'accent');
  const W = rect.width, H = rect.height;
  const cardW = r2(Math.min(W * 0.86, u(860)));
  const pad = r2(u(60));
  const iconSize = icon ? r2(u(96)) : 0;
  const titleFit = fitText(check, 'params.title', title, {family: 'body', width: cardW - pad * 2, preferred: u(68), min: b.min.key, maxLines: 3});
  const textFit = text ? fitText(check, 'params.text', text, {family: 'body', width: cardW - pad * 2, preferred: u(44), min: b.min.key, maxLines: 5}) : null;
  const cardH = r2(pad * 2 + (icon ? iconSize + u(24) : 0) + titleFit.size * 1.15 * titleFit.lines + (textFit ? u(20) + textFit.size * 1.3 * textFit.lines : 0));
  if (cardH > H - u(60)) check.fail('params', 'the note is too tall for the rect; shorten the text');
  const tilt = angle(b, p.tilt, 'params.tilt', 2);
  const card = {x: r2((W - cardW) / 2), y: r2((H - cardH) / 2), width: cardW, height: cardH};
  const tw2 = r2(u(200)), th = r2(u(58));
  const pieces = b.variant === 'corners' ? [{x: r2(card.x - tw2 * 0.35), y: r2(card.y - th * 0.2), rot: -38}, {x: r2(card.x + cardW - tw2 * 0.65), y: r2(card.y + cardH - th * 0.8), rot: -38}]
    : b.variant === 'top' ? [{x: r2(card.x + cardW / 2 - tw2 / 2), y: r2(card.y - th * 0.55), rot: -3}]
      : [{x: r2(card.x - tw2 * 0.55), y: r2(card.y + cardH * 0.3), rot: 84}, {x: r2(card.x + cardW - tw2 * 0.45), y: r2(card.y + cardH * 0.45), rot: 96}];
  const rand = seeded(title);
  const t = showTime(b, p, 'show', 0.5, 'whoosh-soft');
  const content = {variant: b.variant, title: {text: title, size: titleFit.size, lines: titleFit.lines}, body: textFit ? {text, size: textFit.size, lines: textFit.lines} : null, icon, iconSize, pad, card, tilt, t,
    tape: {width: tw2, height: th, color: `${tapeColor}b8`, pieces: pieces.map(piece => ({...piece, polygon: tornPolygon(rand, {left: true, right: true, depth: 6, teeth: 8})}))},
    paper: mixColor('#ffffff', b.colors.paper, 0.4), ink: '#16161a', muted: '#4a4a52', iconColor: b.colors.primary === '#ffffff' ? b.colors.accent : mixColor(b.colors.primary, '#000000', 0.85)};
  return b.finish(content, {minTextPx: Math.min(titleFit.size, textFit ? textFit.size : Infinity)});
}

function tapeView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const C = c.card;
  const inner = [];
  let y = c.pad;
  if (c.icon) { inner.push(iconNode(c.icon, {x: c.pad, y, size: c.iconSize, color: c.iconColor, stroke: 2.2})); y += c.iconSize + 24 * u; }
  inner.push(label(null, c.pad, r2(y), r2(C.width - c.pad * 2), c.title.text, {size: c.title.size, family: fonts.body, color: c.ink, weight: 700, lineHeight: 1.15, wrap: true}));
  y += c.title.size * 1.15 * c.title.lines;
  if (c.body) inner.push(label(null, c.pad, r2(y + 20 * u), r2(C.width - c.pad * 2), c.body.text, {size: c.body.size, family: fonts.body, color: c.muted, lineHeight: 1.3, wrap: true}));
  const kids = [el('div', `${id}-card`, {...abs(C.x, C.y, C.width, C.height), boxSizing: 'border-box', background: c.paper, borderRadius: r2(4 * u), boxShadow: `0 ${r2(22 * u)}px ${r2(46 * u)}px #000000a6`, transform: `rotate(${c.tilt}deg)`, transformOrigin: '50% 50%', opacity: 0}, inner)];
  c.tape.pieces.forEach((piece, i) => kids.push(el('div', `${id}-tape-${i}`, {...abs(piece.x, piece.y, c.tape.width, c.tape.height), background: c.tape.color, clipPath: piece.polygon,
    transform: `rotate(${piece.rot}deg)`, transformOrigin: '50% 50%', opacity: 0}, [el('div', null, abs(0, 0, c.tape.width, c.tape.height, {background: 'repeating-linear-gradient(90deg, #ffffff1f 0px, #ffffff1f 3px, transparent 3px, transparent 9px)'}))])));
  return kids;
}

function tapeTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  set(ops, `${id}-card`, start, {opacity: 0, x: 0, y: r2(-80 * u), rotation: c.tilt - 6, scaleX: 1.04, scaleY: 1.04});
  tw(ops, `${id}-card`, c.t, 0.18, 'power1.out', {opacity: 0}, {opacity: 1});
  tw(ops, `${id}-card`, c.t, 0.6, 'power3.out', {y: r2(-80 * u), rotation: c.tilt - 6, scaleX: 1.04, scaleY: 1.04}, {y: 0, rotation: c.tilt, scaleX: 1, scaleY: 1});
  c.tape.pieces.forEach((piece, i) => {
    const t = rt(c.t + 0.5 + i * 0.14);
    set(ops, `${id}-tape-${i}`, start, {opacity: 0, x: 0, y: 0, rotation: piece.rot, scaleX: 1.35, scaleY: 1.35});
    tw(ops, `${id}-tape-${i}`, t, 0.1, 'power1.out', {opacity: 0}, {opacity: 1});
    tw(ops, `${id}-tape-${i}`, t, 0.3, 'power3.out', {scaleX: 1.35, scaleY: 1.35}, {scaleX: 1, scaleY: 1});
  });
}

export const tapeNote = {
  id: 'tape-note',
  describe: 'A paper note drops onto the frame and strips of translucent tape press it down (two corners, the top, or both sides); a title, optional body and icon.',
  params: {title: 'string ≤ 48, required', text: 'string ≤ 120 (optional)', icon: 'icon name (optional)', tone: `tape colour (${tone}; default accent)`, tilt: 'degrees −20–20 (default 2)', at: `lands: ${at}`, variant: VARIANT_PARAM, rect},
  events: ['show'], timing: TIMING, variants: TAPE_VARIANTS,
  resolve: tapeResolve, view: tapeView, timeline: tapeTimeline
};

// ---------------------------------------------------------------------------
// badge

const BADGE_VARIANTS = Object.freeze(['starburst', 'circle', 'shield']);

function badgeResolve(params, ctx) {
  const b = createHBase('badge', params, ctx, {allowed: ['text', 'sub', 'icon', 'tone', 'at', 'tilt'], required: ['text'], variants: BADGE_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  const text = check.str(p.text, 'params.text', 14).toUpperCase();
  const sub = p.sub === undefined ? null : check.str(p.sub, 'params.sub', 20).toUpperCase();
  const icon = p.icon === undefined ? null : p.icon;
  if (icon !== null && !isIcon(icon)) check.fail('params.icon', 'must be an icon name from kit/core/icons.mjs');
  const fill = toneColor(b, p.tone, 'params.tone');
  const ink = inkOn(b.colors, fill);
  const d = r2(Math.min(rect.width, rect.height, u(620)));
  const shield = b.variant === 'shield';
  const box = {width: d, height: r2(shield ? d * 1.12 : d)};
  box.x = r2((rect.width - box.width) / 2); box.y = r2((rect.height - box.height) / 2);
  const inner = d * (b.variant === 'starburst' ? 0.58 : 0.66);
  const size = fitText(check, 'params.text', text, {family: 'display', width: inner, preferred: d * 0.2, min: b.min.key, maxLines: 1}).size;
  const subSize = sub ? fitText(check, 'params.sub', sub, {family: 'meta', width: inner, preferred: Math.max(b.min.meta, d * 0.06), min: b.min.meta}).size : 0;
  const tilt = angle(b, p.tilt, 'params.tilt', -10);
  const t = showTime(b, p, 'stamp', 0.5, 'impact');
  const content = {variant: b.variant, text, sub, icon, fill, ink, box, size, subSize, tilt, t, iconSize: icon ? r2(d * 0.16) : 0,
    shape: b.variant === 'starburst' ? starburst(20, 0.88) : shield ? 'polygon(50% 0%, 100% 12%, 100% 52%, 90% 74%, 50% 100%, 10% 74%, 0% 52%, 0% 12%)' : null};
  return b.finish(content, {minTextPx: size});
}

function badgeView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const B = c.box;
  const shape = c.variant === 'circle' ? {borderRadius: '50%'} : {clipPath: c.shape};
  const ring = r2(B.width * (c.variant === 'starburst' ? 0.66 : 0.8));
  const textH = c.size * 1.05 + (c.sub ? c.subSize * 1.4 + 6 * u : 0) + (c.icon ? c.iconSize + 10 * u : 0);
  let y = r2((B.height * (c.variant === 'shield' ? 0.94 : 1) - textH) / 2);
  const inner = [el('div', null, {...abs(r2((B.width - ring) / 2), r2((B.height * (c.variant === 'shield' ? 0.92 : 1) - ring) / 2), ring, ring), boxSizing: 'border-box', borderRadius: '50%', border: `${r2(4 * u)}px dashed ${c.ink}55`})];
  if (c.icon) { inner.push(iconNode(c.icon, {x: r2((B.width - c.iconSize) / 2), y, size: c.iconSize, color: c.ink, stroke: 2.4})); y += c.iconSize + 10 * u; }
  inner.push(label(null, 0, r2(y), B.width, c.text, {size: c.size, family: fonts.display, color: c.ink, align: 'center', lineHeight: 1.05}));
  if (c.sub) inner.push(label(null, 0, r2(y + c.size * 1.05 + 6 * u), B.width, c.sub, {size: c.subSize, family: fonts.meta, color: c.ink, align: 'center', spacing: '0.14em', lineHeight: 1.4}));
  return [el('div', `${id}-badge`, {...abs(B.x, B.y, B.width, B.height), opacity: 0, transformOrigin: '50% 50%', transform: `rotate(${c.tilt}deg)`, filter: `drop-shadow(0 ${r2(16 * u)}px ${r2(20 * u)}px #00000099)`}, [
    el('div', null, {...abs(0, 0, B.width, B.height), background: `radial-gradient(circle at 35% 28%, ${mixColor('#ffffff', c.fill, 0.28)} 0%, ${c.fill} 55%)`, ...shape}, inner)
  ])];
}

function badgeTimeline(model, ops) {
  const {id, start} = model;
  const c = model.content;
  set(ops, `${id}-badge`, start, {opacity: 0, x: 0, y: 0, rotation: c.tilt - 140, scaleX: 0, scaleY: 0});
  tw(ops, `${id}-badge`, c.t, 0.12, 'power1.out', {opacity: 0}, {opacity: 1});
  tw(ops, `${id}-badge`, c.t, 0.7, 'back.out(1.8)', {rotation: c.tilt - 140, scaleX: 0, scaleY: 0}, {rotation: c.tilt, scaleX: 1, scaleY: 1});
}

export const badge = {
  id: 'badge',
  describe: 'A badge spins in and stamps down: a starburst, a seal with a dashed ring, or a shield, with a word (NEW, FREE, V2) and an optional sub-line and icon.',
  params: {text: 'string ≤ 14, required (uppercased)', sub: 'string ≤ 20 (optional)', icon: 'icon name (optional)', tone: `fill (${tone}; default primary)`, tilt: 'degrees −20–20 (default −10)', at: `stamp: ${at}`, variant: VARIANT_PARAM, rect},
  events: ['stamp'], timing: TIMING, variants: BADGE_VARIANTS,
  resolve: badgeResolve, view: badgeView, timeline: badgeTimeline
};

// ---------------------------------------------------------------------------
// ribbon

const RIBBON_VARIANTS = Object.freeze(['banner', 'flag', 'tag']);

function ribbonResolve(params, ctx) {
  const b = createHBase('ribbon', params, ctx, {allowed: ['text', 'tone', 'at', 'tilt'], required: ['text'], variants: RIBBON_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  const text = check.str(p.text, 'params.text', 32).toUpperCase();
  const fill = toneColor(b, p.tone, 'params.tone');
  const ink = inkOn(b.colors, fill);
  const W = rect.width;
  const tail = b.variant === 'banner' ? r2(u(90)) : 0;
  const size = fitText(check, 'params.text', text, {family: 'display', width: W - tail * 2 - u(140), preferred: u(96), min: b.min.key, maxLines: 1}).size;
  const height = r2(size * 1.55);
  const width = r2(Math.min(W - tail * 2, textWidth(text, size, 'display') + u(b.variant === 'tag' ? 190 : 150)));
  const box = {x: r2((W - width) / 2), y: r2((rect.height - height) / 2), width, height};
  const tilt = angle(b, p.tilt, 'params.tilt', b.variant === 'banner' ? -3 : 0);
  const t = showTime(b, p, 'unfurl', 0.5, 'whoosh');
  const content = {variant: b.variant, text, fill, ink, dark: mixColor('#000000', fill, 0.62), size, box, tail, tilt, t};
  return b.finish(content, {minTextPx: size});
}

function ribbonView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const B = c.box;
  const kids = [];
  if (c.variant === 'banner') {
    // Tails behind each end, folded under (a darker triangle where they meet).
    const ty = r2(B.y + B.height * 0.32);
    kids.push(el('div', `${id}-tail-0`, {...abs(r2(B.x - c.tail), ty, r2(c.tail * 1.3), B.height), background: c.dark, clipPath: 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 30% 50%)', opacity: 0}));
    kids.push(el('div', `${id}-tail-1`, {...abs(r2(B.x + B.width - c.tail * 0.3), ty, r2(c.tail * 1.3), B.height), background: c.dark, clipPath: 'polygon(0% 0%, 100% 0%, 70% 50%, 100% 100%, 0% 100%)', opacity: 0}));
  }
  const shape = c.variant === 'flag' ? {clipPath: 'polygon(0% 0%, 100% 0%, 94% 50%, 100% 100%, 0% 100%)'} : c.variant === 'tag' ? {clipPath: `polygon(${r2(B.height * 0.5 / B.width * 100)}% 0%, 100% 0%, 100% 100%, ${r2(B.height * 0.5 / B.width * 100)}% 100%, 0% 50%)`, borderRadius: r2(10 * u)} : {};
  const inner = [label(null, c.variant === 'tag' ? r2(B.height * 0.3) : 0, r2((B.height - c.size * 1.2) / 2), c.variant === 'tag' ? r2(B.width - B.height * 0.3) : r2(B.width * (c.variant === 'flag' ? 0.97 : 1)), c.text, {size: c.size, family: fonts.display, color: c.ink, align: 'center', spacing: '0.04em'})];
  if (c.variant === 'tag') inner.push(el('div', null, abs(r2(B.height * 0.32), r2(B.height / 2 - 9 * u), r2(18 * u), r2(18 * u), {borderRadius: '50%', background: model.theme.bg})));
  inner.push(el('div', null, abs(0, 0, B.width, r2(B.height * 0.12), {background: '#ffffff26'})));
  kids.push(el('div', `${id}-band`, {...abs(B.x, B.y, B.width, B.height), background: c.fill, ...shape, boxShadow: `0 ${r2(12 * u)}px ${r2(26 * u)}px #00000080`}, [
    el('div', `${id}-face`, {...abs(0, 0, B.width, B.height), clipPath: 'inset(0% 50% 0% 50%)'}, [el('div', null, {...abs(0, 0, B.width, B.height), background: c.fill}), ...inner])]));
  return [el('div', `${id}-ribbon`, {...abs(0, 0, model.rect.width, model.rect.height), transform: `rotate(${c.tilt}deg)`, transformOrigin: '50% 50%'}, kids)];
}

function ribbonTimeline(model, ops) {
  const {id, start} = model;
  const c = model.content;
  // The band unfurls from its centre; the tails fold out behind it.
  set(ops, `${id}-band`, start, {opacity: 0, x: 0, y: 0, scaleX: 0.2, scaleY: 1});
  tw(ops, `${id}-band`, c.t, 0.12, 'power1.out', {opacity: 0}, {opacity: 1});
  tw(ops, `${id}-band`, c.t, 0.55, 'power3.out', {scaleX: 0.2}, {scaleX: 1});
  set(ops, `${id}-face`, start, clip(0, 50, 0, 50));
  tw(ops, `${id}-face`, c.t, 0.55, 'power3.out', clip(0, 50, 0, 50), clip(0, 0, 0, 0));
  if (c.variant === 'banner') [0, 1].forEach(i => {
    const dx = i ? -c.tail : c.tail;
    set(ops, `${id}-tail-${i}`, start, {opacity: 0, x: dx, y: 0});
    tw(ops, `${id}-tail-${i}`, rt(c.t + 0.4), 0.35, 'power3.out', {opacity: 0, x: dx}, {opacity: 1, x: 0});
  });
}

export const ribbon = {
  id: 'ribbon',
  describe: 'A ribbon unfurls from its centre with a word or short line: a banner with folded tails, a flag with a notched end, or a price-tag shape.',
  params: {text: 'string ≤ 32, required (uppercased)', tone: `fill (${tone}; default primary)`, tilt: 'degrees −20–20', at: `unfurls: ${at}`, variant: VARIANT_PARAM, rect},
  events: ['unfurl'], timing: TIMING, variants: RIBBON_VARIANTS,
  resolve: ribbonResolve, view: ribbonView, timeline: ribbonTimeline
};

export const PAPER = [polaroid, sticker, tornPaper, tapeNote, badge, ribbon];
