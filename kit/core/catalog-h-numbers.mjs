// Catalogue H counters: odometer, flip-clock, ticker-tape, slot-roll,
// countdown and percent-fill. Every number is formatted by numberFormat
// (currency, percent, unit, compact) and every per-frame change is a
// precomputed tl.set or a tween, so seeking is safe. Registered in
// kit/core/catalog-h.mjs.

import {decimalsOf, timingRules} from './catalog-b-base.mjs';
import {svgRoot, transformString} from './catalog-b-view.mjs';
import {VARIANT_PARAM, FORMAT_PARAM, createHBase, fitText, inkOn, mixColor, numberFormat, r2, rt, textWidth, toneColor} from './catalog-h-base.mjs';
import {abs, arcPath, countOps, countSamples, drawOps, el, label, popOps, riseOps, set, strokePath, tw} from './catalog-h-view.mjs';

const at = 'seconds from scene start (optional; else a matching hit, else a default)';
const rect = '{x, y, width, height} canvas px inside the safe zone (optional)';
const tone = 'primary | accent | paper | #rrggbb';
const TIMING = timingRules({rules: ['the count or roll runs from at and lands before the exit']});
const DIGIT = /[0-9]/;

/** Optional label (and sub line) under a centred figure → layout pieces. */
function captionBlock(b, p, width) {
  const {check, u} = b;
  const text = p.label === undefined ? null : check.str(p.label, 'params.label', 60);
  const sub = p.sub === undefined ? null : check.str(p.sub, 'params.sub', 70);
  const labelFit = text ? fitText(check, 'params.label', text, {family: 'body', width, preferred: u(50), min: b.min.key, maxLines: 2}) : null;
  const subFit = sub ? fitText(check, 'params.sub', sub, {family: 'meta', width, preferred: u(28), min: b.min.meta}) : null;
  const height = (labelFit ? labelFit.size * 1.2 * labelFit.lines + u(28) : 0) + (subFit ? subFit.size * 1.3 + u(14) : 0);
  return {label: labelFit ? {text, size: labelFit.size, lines: labelFit.lines} : null, sub: subFit ? {text: sub, size: subFit.size} : null, height: r2(height)};
}

function captionNodes(model, y) {
  const {id, fonts, theme, unit: u} = model;
  const c = model.content;
  const W = model.rect.width;
  const out = [];
  let top = y;
  if (c.caption.label) {
    top += 28 * u;
    out.push(label(`${id}-label`, 0, r2(top), W, c.caption.label.text, {size: c.caption.label.size, family: fonts.body, color: theme.foreground, align: 'center', weight: 650, wrap: c.caption.label.lines > 1, extra: {opacity: 0}}));
    top += c.caption.label.size * 1.2 * c.caption.label.lines;
  }
  if (c.caption.sub) out.push(label(`${id}-sub`, 0, r2(top + 14 * u), W, c.caption.sub.text, {size: c.caption.sub.size, family: fonts.meta, color: theme.muted, align: 'center', spacing: '0.06em', extra: {opacity: 0}}));
  return out;
}

function captionOps(model, ops, time) {
  const {id, start, unit: u} = model;
  const c = model.content;
  if (c.caption.label) riseOps(ops, `${id}-label`, start, time, r2(16 * u));
  if (c.caption.sub) riseOps(ops, `${id}-sub`, start, rt(time + 0.15), r2(10 * u));
}

function startEvent(b, p, name, fallback = 0.5, cue = 'tally', span = 1) {
  const time = b.timeOf(name, p.at, 'params.at', fallback);
  b.events.push({id: `${b.id}-${name}`, name, time, endTime: rt(time + span), role: 'emphasis', cue});
  return time;
}

// ---------------------------------------------------------------------------
// odometer

const ODOMETER_VARIANTS = Object.freeze(['plain', 'tiles', 'mechanical']);

function odometerResolve(params, ctx) {
  const b = createHBase('odometer', params, ctx, {allowed: ['value', 'from', 'format', 'label', 'sub', 'at', 'span', 'tone'], required: ['value'], variants: ODOMETER_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  const value = check.num(p.value, 'params.value', 0, 1e15);
  const from = p.from === undefined ? 0 : check.num(p.from, 'params.from', 0, value);
  const fmt = numberFormat(check, p.format, 'params.format', {decimals: decimalsOf(value)});
  const color = toneColor(b, p.tone, 'params.tone', 'paper');
  const text = fmt.format(value);
  if (text.length > 16) check.fail('params.value', `formats to ${text.length} characters; at most 16 fit (try format.compact)`);
  // The start shows the same characters, its digits from `from`, zero-padded.
  const fromDigits = fmt.format(from).replace(/[^0-9]/g, '');
  const finalDigits = text.replace(/[^0-9]/g, '');
  const pad = fromDigits.padStart(finalDigits.length, '0').slice(-finalDigits.length);
  const W = rect.width;
  const caption = captionBlock(b, p, W);
  const boxed = b.variant !== 'plain';
  const chars = [...text];
  const advance = ch => (DIGIT.test(ch) ? 0.62 : ch === ',' || ch === '.' ? 0.3 : 0.56);
  const widthFor = size => chars.reduce((s, ch) => s + size * advance(ch) * (boxed && DIGIT.test(ch) ? 1.22 : 1) + (boxed ? size * 0.06 : 0), 0);
  let size = u(260);
  while (size > b.min.key && (widthFor(size) > W || size * 1.3 > rect.height - caption.height)) size -= 2;
  if (size < b.min.key) check.fail('params.value', 'does not fit the rect');
  size = r2(size);
  const h = r2(size * 1.18);
  const total = widthFor(size);
  const y = r2((rect.height - h - caption.height) / 2);
  const duration = p.span === undefined ? 1.6 : check.num(p.span, 'params.span', 0.4, 4);
  const t0 = startEvent(b, p, 'count', 0.5, 'tally', duration);
  let x = (W - total) / 2, k = 0;
  const digitCount = finalDigits.length;
  const cells = chars.map(ch => {
    const w = size * advance(ch) * (boxed && DIGIT.test(ch) ? 1.22 : 1);
    const cell = {char: ch, x: r2(x + (boxed ? size * 0.03 : 0)), width: r2(w), digit: DIGIT.test(ch)};
    x += w + (boxed ? size * 0.06 : 0);
    if (cell.digit) {
      const place = digitCount - 1 - k; // 0 = the last digit
      const s = Number(pad[k]), e = Number(finalDigits[k]);
      const turns = s === e && from === value ? 0 : Math.max(0, Math.min(3, 2 - place)) + (place === 0 && from !== value ? 1 : 0);
      const end = s + ((e - s + 10) % 10) + 10 * turns;
      cell.strip = Array.from({length: end + 1}, (_, i) => String(i % 10));
      cell.startY = r2(-s * h); cell.endY = r2(-end * h);
      cell.duration = rt(Math.min(duration, duration * 0.7 + 0.08 * (digitCount - 1 - place)));
      cell.time = t0;
      k++;
    }
    return cell;
  });
  const content = {variant: b.variant, cells, size, h, y, color, caption, t0, duration, tile: b.theme.panel, border: b.theme.border, bg: b.colors.bg};
  b.model.events.push({id: `${b.id}-landed`, name: 'landed', time: rt(t0 + duration), role: 'emphasis', cue: 'impact'});
  return b.finish(content, {minTextPx: Math.min(size, caption.label ? caption.label.size : Infinity)});
}

function odometerView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const kids = [];
  c.cells.forEach((cell, i) => {
    if (!cell.digit) {
      kids.push(label(`${id}-char-${i}`, cell.x, c.y, cell.width, cell.char, {size: c.size, family: fonts.display, color: c.color, align: 'center', lineHeight: c.h / c.size}));
      return;
    }
    const tile = c.variant === 'tiles' ? {borderRadius: r2(c.size * 0.12), background: c.tile, border: `${r2(2 * u)}px solid ${c.border}`}
      : c.variant === 'mechanical' ? {borderRadius: r2(c.size * 0.06), background: `linear-gradient(180deg, #000000 0%, ${mixColor('#ffffff', c.bg, 0.1)} 50%, #000000 100%)`, boxShadow: `inset 0 0 ${r2(c.size * 0.12)}px #000000`} : {};
    const strip = el('div', `${id}-strip-${i}`, {...abs(0, 0, cell.width, r2(c.h * cell.strip.length)), transform: transformString({y: cell.startY})},
      cell.strip.map((d, j) => label(null, 0, r2(j * c.h), cell.width, d, {size: c.size, family: fonts.display, color: c.color, align: 'center', lineHeight: c.h / c.size})));
    const shade = c.variant === 'mechanical' ? [el('div', null, abs(0, 0, cell.width, c.h, {background: 'linear-gradient(180deg, #000000b3 0%, #00000000 30%, #00000000 70%, #000000b3 100%)'})),
      el('div', null, abs(0, r2(c.h / 2 - u), cell.width, r2(2 * u), {background: '#00000080'}))] : [];
    kids.push(el('div', `${id}-digit-${i}`, {...abs(cell.x, c.y, cell.width, c.h), boxSizing: 'border-box', overflow: 'hidden', ...tile}, [strip, ...shade]));
  });
  kids.push(...captionNodes(model, c.y + c.h));
  return kids;
}

function odometerTimeline(model, ops) {
  const {id, start} = model;
  const c = model.content;
  c.cells.forEach((cell, i) => {
    if (!cell.digit) return;
    set(ops, `${id}-strip-${i}`, start, {x: 0, y: cell.startY});
    tw(ops, `${id}-strip-${i}`, cell.time, cell.duration, 'power3.inOut', {y: cell.startY}, {y: cell.endY});
  });
  captionOps(model, ops, rt(c.t0 + 0.1));
}

export const odometer = {
  id: 'odometer',
  describe: 'A rolling odometer: every digit spins on its own reel and the figure lands, lower places turning faster; plain, tiles or mechanical counter.',
  params: {value: 'number ≥ 0, required', from: 'start value (default 0; digits zero-pad)', format: FORMAT_PARAM, label: 'string ≤ 60 (optional)', sub: 'string ≤ 70, e.g. a source (optional)',
    span: 'seconds 0.4–4 (default 1.6)', tone: `digit colour (${tone}; default paper)`, at: `roll start: ${at}`, variant: VARIANT_PARAM, rect},
  events: ['count', 'landed'], timing: TIMING, variants: ODOMETER_VARIANTS,
  resolve: odometerResolve, view: odometerView, timeline: odometerTimeline
};

// ---------------------------------------------------------------------------
// flip-clock: split-flap cards

const FLIP_VARIANTS = Object.freeze(['classic', 'brand', 'light']);
const FLIP_HALF = 0.16;

function flipResolve(params, ctx) {
  const b = createHBase('flip-clock', params, ctx, {allowed: ['values', 'label', 'sub', 'at', 'interval'], required: ['values'], variants: FLIP_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  check.arr(p.values, 'params.values', 2, 10);
  const values = p.values.map((v, i) => check.str(String(v), `params.values[${i}]`, 10).toUpperCase());
  const len = Math.max(...values.map(v => v.length));
  const frames = values.map(v => v.padStart(len, ' '));
  const W = rect.width;
  const caption = captionBlock(b, p, W);
  const sep = ch => /[:.,\s/-]/.test(ch);
  const chars = [...frames[0]];
  const units = chars.reduce((s, _, i) => s + (frames.every(f => sep(f[i])) ? 0.42 : 1), 0);
  const gap = u(14);
  let cardW = Math.min(u(220), (W - gap * (len - 1)) / units);
  const cardH0 = cardW * 1.42;
  if (cardH0 > rect.height - caption.height - u(20)) cardW = (rect.height - caption.height - u(20)) / 1.42;
  cardW = r2(cardW);
  const cardH = r2(cardW * 1.42), size = r2(cardH * 0.7);
  if (size < b.min.key) check.fail('params.values', 'are too long for the rect');
  const total = chars.reduce((s, _, i) => s + (frames.every(f => sep(f[i])) ? cardW * 0.42 : cardW), 0) + gap * (len - 1);
  let x = (W - total) / 2;
  const y = r2((rect.height - cardH - caption.height) / 2);
  const t0 = startEvent(b, p, 'flip', 0.6, 'tick', 0.4);
  const span = b.start + b.lastEvent - 0.4 - t0;
  const interval = p.interval === undefined ? Math.min(0.9, span / (values.length - 1)) : check.num(p.interval, 'params.interval', 0.35, 10);
  if (t0 + interval * (values.length - 2) > b.start + b.lastEvent + 1e-6) check.fail('params.interval', 'runs past the scene; shorten it or use fewer values');
  const cells = chars.map((_, i) => {
    const narrow = frames.every(f => sep(f[i]));
    const cell = {x: r2(x), width: narrow ? r2(cardW * 0.42) : cardW, narrow, initial: frames[0][i], steps: []};
    x += cell.width + gap;
    for (let s = 1; s < frames.length; s++) if (frames[s][i] !== frames[s - 1][i]) cell.steps.push({from: frames[s - 1][i], to: frames[s][i], time: rt(t0 + interval * (s - 1) + (narrow ? 0 : i * 0.03))});
    return cell;
  });
  for (let s = 1; s < frames.length; s++) b.events.push({id: `${b.id}-flip-${s}`, name: `flip-${s}`, time: rt(t0 + interval * (s - 1)), role: 'emphasis', cue: 'tick'});
  const palette = b.variant === 'brand' ? {card: b.colors.primary, ink: inkOn(b.colors, b.colors.primary)} : b.variant === 'light' ? {card: b.colors.paper, ink: b.colors.ink === b.colors.paper ? b.colors.bg : inkOn(b.colors, b.colors.paper)}
    : {card: mixColor('#ffffff', b.colors.bg, 0.1), ink: b.colors.paper};
  const content = {variant: b.variant, cells, cardH, size, y, caption, t0, ...palette, sepColor: b.theme.foreground};
  return b.finish(content, {minTextPx: Math.min(size, caption.label ? caption.label.size : Infinity)});
}

function flipView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const H = c.cardH, half = r2(H / 2), radius = r2(H * 0.07);
  // One half card: the glyph clipped to the top or bottom half.
  const halfCard = (nodeId, x, w, ch, part, style = {}) => el('div', nodeId, {...abs(x, part === 'top' ? c.y : r2(c.y + half), w, half), overflow: 'hidden', background: c.card,
    borderRadius: part === 'top' ? `${radius}px ${radius}px 0 0` : `0 0 ${radius}px ${radius}px`, transformOrigin: part === 'top' ? '50% 100%' : '50% 0%', ...style}, [
    label(null, 0, part === 'top' ? 0 : -half, w, ch, {size: c.size, family: fonts.display, color: c.ink, align: 'center', lineHeight: H / c.size}),
    el('div', null, abs(0, 0, w, half, {background: part === 'top' ? 'linear-gradient(180deg, #ffffff14 0%, #00000000 60%, #00000033 100%)' : 'linear-gradient(180deg, #00000040 0%, #00000000 40%)'}))
  ]);
  const kids = [];
  c.cells.forEach((cell, i) => {
    if (cell.narrow) {
      kids.push(label(null, cell.x, c.y, cell.width, cell.initial.trim(), {size: c.size, family: fonts.display, color: c.sepColor, align: 'center', lineHeight: H / c.size}));
      return;
    }
    kids.push(halfCard(null, cell.x, cell.width, cell.initial, 'top'), halfCard(null, cell.x, cell.width, cell.initial, 'bottom'));
    cell.steps.forEach((step, s) => {
      kids.push(halfCard(`${id}-next-${i}-${s}`, cell.x, cell.width, step.to, 'top', {opacity: 0}));
      kids.push(halfCard(`${id}-flap-${i}-${s}`, cell.x, cell.width, step.from, 'top', {opacity: 0}));
      kids.push(halfCard(`${id}-fall-${i}-${s}`, cell.x, cell.width, step.to, 'bottom', {opacity: 0, transform: transformString({scaleY: 0})}));
    });
    kids.push(el('div', null, abs(cell.x, r2(c.y + half - u), cell.width, r2(2 * u), {background: '#00000099'})));
  });
  kids.push(...captionNodes(model, c.y + H));
  return kids;
}

function flipTimeline(model, ops) {
  const {id, start} = model;
  const c = model.content;
  c.cells.forEach((cell, i) => cell.steps.forEach((step, s) => {
    const t = step.time;
    set(ops, `${id}-next-${i}-${s}`, start, {opacity: 0});
    set(ops, `${id}-next-${i}-${s}`, t, {opacity: 1});
    set(ops, `${id}-flap-${i}-${s}`, start, {opacity: 0, x: 0, y: 0, scaleX: 1, scaleY: 1});
    set(ops, `${id}-flap-${i}-${s}`, t, {opacity: 1});
    tw(ops, `${id}-flap-${i}-${s}`, t, FLIP_HALF, 'power2.in', {scaleY: 1}, {scaleY: 0});
    set(ops, `${id}-fall-${i}-${s}`, start, {opacity: 0, x: 0, y: 0, scaleX: 1, scaleY: 0});
    set(ops, `${id}-fall-${i}-${s}`, rt(t + FLIP_HALF), {opacity: 1});
    tw(ops, `${id}-fall-${i}-${s}`, rt(t + FLIP_HALF), FLIP_HALF, 'bounce.out', {scaleY: 0}, {scaleY: 1});
  }));
  captionOps(model, ops, rt(c.t0 - 0.2));
}

export const flipClock = {
  id: 'flip-clock',
  describe: 'Split-flap cards flip through 2–10 values (a date, a time, a score, a year), each changed card falling on its hinge; classic, brand or light cards.',
  params: {values: '[string ≤ 10] 2–10, e.g. ["2025", "2026"] or ["11:58", "11:59", "12:00"]; shorter values right-align', interval: 'seconds between flips (default fits the scene, ≤ 0.9)',
    label: 'string ≤ 60 (optional)', sub: 'string ≤ 70 (optional)', at: `first flip: ${at}`, variant: VARIANT_PARAM, rect},
  events: ['flip', 'flip-<n>'], timing: TIMING, variants: FLIP_VARIANTS,
  resolve: flipResolve, view: flipView, timeline: flipTimeline
};

// ---------------------------------------------------------------------------
// ticker-tape

const TICKER_VARIANTS = Object.freeze(['band', 'minimal', 'led']);

function tickerResolve(params, ctx) {
  const b = createHBase('ticker-tape', params, ctx, {allowed: ['items', 'tag', 'title', 'speed', 'format', 'at'], required: ['items'], variants: TICKER_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  check.arr(p.items, 'params.items', 3, 14);
  const fmt = numberFormat(check, p.format, 'params.format', {decimals: 0});
  const items = p.items.map((item, i) => {
    if (typeof item === 'string') return {label: check.str(item, `params.items[${i}]`, 24), value: null, change: null};
    check.obj(item, `params.items[${i}]`, ['label', 'value', 'change'], ['label']);
    return {label: check.str(item.label, `params.items[${i}].label`, 16), value: item.value === undefined ? null : typeof item.value === 'number' ? fmt.format(item.value) : check.str(String(item.value), `params.items[${i}].value`, 12),
      change: item.change === undefined ? null : check.num(item.change, `params.items[${i}].change`, -1e6, 1e6)};
  });
  const tag = p.tag === undefined ? null : p.tag === false ? null : check.str(p.tag, 'params.tag', 10).toUpperCase();
  const title = p.title === undefined ? null : check.str(p.title, 'params.title', 60);
  const W = rect.width;
  const led = b.variant === 'led';
  const size = r2(Math.max(b.min.key, u(led ? 52 : 50)));
  const bandH = r2(size * 2.1);
  const fam = led ? 'meta' : 'body';
  const sepW = r2(size * 1.4);
  let x = 0;
  const cells = items.map(item => {
    const change = item.change === null ? null : `${item.change >= 0 ? '▲' : '▼'} ${Math.abs(item.change).toFixed(1)}%`;
    const parts = [{text: item.label, width: textWidth(item.label, size, fam) + size * 0.4, kind: 'label'}];
    if (item.value) parts.push({text: item.value, width: textWidth(item.value, size, 'display') + size * 0.4, kind: 'value'});
    if (change) parts.push({text: change, width: textWidth(change, size * 0.8, 'display') + size * 0.3, kind: item.change >= 0 ? 'up' : 'down'});
    const cell = {x: r2(x), parts: parts.map(part => ({...part, width: r2(part.width)}))};
    x += parts.reduce((s, part) => s + part.width, 0) + sepW;
    return cell;
  });
  const stripW = r2(x);
  const copies = Math.ceil(W / stripW) + 1;
  const titleFit = title ? fitText(check, 'params.title', title, {family: 'body', width: W, preferred: u(64), min: b.min.key, maxLines: 2}) : null;
  const titleH = titleFit ? titleFit.size * 1.15 * titleFit.lines + u(40) : 0;
  const tagW = tag ? r2(textWidth(tag, size * 0.8, 'meta', 0.14) + size * 1.2) : 0;
  const bandY = r2((rect.height - bandH - titleH) / 2 + titleH);
  const speed = p.speed === undefined ? u(170) : check.num(p.speed, 'params.speed', 20, 2000) * b.unit;
  const t0 = startEvent(b, p, 'roll', 0.5, 'whoosh', 0.5);
  const cycle = rt(stripW / speed);
  const repeats = Math.ceil((b.end - t0) / cycle) + 1;
  const up = b.colors.primary, down = b.colors.accent;
  const band = b.variant === 'band' ? {bg: b.colors.primary, ink: inkOn(b.colors, b.colors.primary)} : b.variant === 'led' ? {bg: '#05060a', ink: mixColor(b.colors.primary, '#ffffff', 0.85)} : {bg: 'transparent', ink: b.theme.foreground};
  const content = {variant: b.variant, cells, copies, stripW, size, bandH, bandY, sepW, tag: tag ? {text: tag, width: tagW} : null, title: titleFit ? {text: title, size: titleFit.size, lines: titleFit.lines} : null,
    t0, cycle, repeats, speed, band, up: b.variant === 'band' ? band.ink : up, down: b.variant === 'band' ? band.ink : down, muted: b.theme.muted, border: b.theme.border, fam};
  return b.finish(content, {minTextPx: Math.min(size, titleFit ? titleFit.size : Infinity)});
}

function tickerView(model) {
  const {id, fonts, unit: u, theme} = model;
  const c = model.content;
  const W = model.rect.width;
  const kids = [];
  if (c.title) kids.push(label(`${id}-title`, 0, r2(c.bandY - c.title.size * 1.15 * c.title.lines - 40 * u), W, c.title.text, {size: c.title.size, family: fonts.body, color: theme.foreground, align: 'center', weight: 650, lineHeight: 1.15, wrap: c.title.lines > 1}));
  const family = c.fam === 'meta' ? fonts.meta : fonts.body;
  const cells = [];
  for (let k = 0; k < c.copies; k++) c.cells.forEach(cell => {
    let x = cell.x + k * c.stripW;
    for (const part of cell.parts) {
      const color = part.kind === 'up' ? c.up : part.kind === 'down' ? c.down : part.kind === 'value' ? c.band.ink : c.variant === 'minimal' ? theme.muted : c.band.ink;
      const size = part.kind === 'up' || part.kind === 'down' ? r2(c.size * 0.8) : c.size;
      cells.push(label(null, r2(x), r2((c.bandH - size * 1.2) / 2), r2(part.width), part.text, {size, family: part.kind === 'label' ? family : fonts.display, color, weight: part.kind === 'label' ? 650 : undefined,
        ...(c.variant === 'led' ? {extra: {textShadow: `0 0 ${r2(10 * u)}px ${color}`}} : {})}));
      x += part.width;
    }
    cells.push(el('div', null, abs(r2(x + c.sepW / 2 - 5 * u), r2(c.bandH / 2 - 5 * u), r2(10 * u), r2(10 * u), {borderRadius: '50%', background: c.variant === 'band' ? `${c.band.ink}66` : c.border})));
  });
  const inset = c.tag ? r2(c.tag.width) : 0;
  const bandStyle = c.variant === 'minimal' ? {borderTop: `${r2(2 * u)}px solid ${c.border}`, borderBottom: `${r2(2 * u)}px solid ${c.border}`} : {background: c.band.bg, borderRadius: r2(14 * u)};
  kids.push(el('div', `${id}-band`, {...abs(0, c.bandY, W, c.bandH), boxSizing: 'border-box', overflow: 'hidden', ...bandStyle}, [
    el('div', null, abs(inset, 0, r2(W - inset), c.bandH, {overflow: 'hidden'}), [el('div', `${id}-strip`, abs(0, 0, r2(c.stripW * c.copies), c.bandH), cells)]),
    ...(c.tag ? [el('div', null, abs(0, 0, c.tag.width, c.bandH, {background: c.variant === 'band' ? c.band.ink : model.theme.primary}), [
      label(null, 0, r2((c.bandH - c.size * 0.8 * 1.2) / 2), c.tag.width, c.tag.text, {size: r2(c.size * 0.8), family: fonts.meta, color: c.variant === 'band' ? c.band.bg : inkOn({ink: model.theme.ink, paper: model.theme.paper, bg: model.theme.bg}, model.theme.primary), align: 'center', spacing: '0.14em'})])] : [])
  ]));
  return kids;
}

function tickerTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  if (c.title) riseOps(ops, `${id}-title`, start, rt(model.motion.enterStart + 0.1), r2(16 * u));
  set(ops, `${id}-band`, start, {opacity: 0, x: 0, y: 0, scaleX: 0.92, scaleY: 1});
  tw(ops, `${id}-band`, rt(c.t0 - 0.25), 0.45, 'power3.out', {opacity: 0, scaleX: 0.92}, {opacity: 1, scaleX: 1});
  set(ops, `${id}-strip`, start, {x: 0});
  ops.push({type: 'loop', target: `${id}-strip`, start: c.t0, cycle: c.cycle, repeats: c.repeats, from: {x: 0}, to: {x: r2(-c.stripW)}});
}

export const tickerTape = {
  id: 'ticker-tape',
  describe: 'A scrolling ticker band of items, with optional values and ▲/▼ changes, looping seamlessly; brand band, minimal rules or an LED board, with an optional tag and title.',
  params: {items: '[string ≤ 24 | {label ≤ 16, value? (number or string ≤ 12), change? (percent)}] 3–14', tag: 'string ≤ 10 such as "LIVE" (optional)', title: 'string ≤ 60 above the band (optional)',
    speed: 'px per second at 1080 (default 170)', format: FORMAT_PARAM, at: `scroll start: ${at}`, variant: VARIANT_PARAM, rect},
  events: ['roll'], timing: TIMING, variants: TICKER_VARIANTS,
  resolve: tickerResolve, view: tickerView, timeline: tickerTimeline
};

// ---------------------------------------------------------------------------
// slot-roll: a reel of words that spins and lands

const SLOT_VARIANTS = Object.freeze(['window', 'inline', 'stack']);

function slotResolve(params, ctx) {
  const b = createHBase('slot-roll', params, ctx, {allowed: ['items', 'final', 'prefix', 'suffix', 'at', 'spins', 'span', 'tone'], required: ['items'], variants: SLOT_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  check.arr(p.items, 'params.items', 2, 10);
  const items = p.items.map((w, i) => check.str(String(w), `params.items[${i}]`, 18));
  let final = items.length - 1;
  if (p.final !== undefined) {
    if (typeof p.final === 'number') final = check.int(p.final, 'params.final', 0, items.length - 1);
    else { final = items.indexOf(p.final); if (final < 0) check.fail('params.final', 'must be one of params.items or an index'); }
  }
  const prefix = p.prefix === undefined ? null : check.str(p.prefix, 'params.prefix', 36);
  const suffix = p.suffix === undefined ? null : check.str(p.suffix, 'params.suffix', 36);
  const spins = p.spins === undefined ? 2 : check.int(p.spins, 'params.spins', 1, 5);
  const duration = p.span === undefined ? 1.5 : check.num(p.span, 'params.span', 0.5, 4);
  const color = toneColor(b, p.tone, 'params.tone');
  const W = rect.width;
  const inline = b.variant === 'inline';
  const widest = Math.max(...items.map(w => textWidth(w, 1, 'display')));
  let size = u(200);
  const affix = s => (s ? textWidth(s, size * 0.5, 'body') : 0);
  // Inline sets the prefix and suffix on one line with the reel; else they stack.
  if (inline) while (size > b.min.key && widest * size + affix(prefix) + affix(suffix) + u(60) > W) size -= 2;
  else while (size > b.min.key && widest * size + u(80) > W) size -= 2;
  if (size < b.min.key) check.fail('params.items', 'are too long for the rect');
  size = r2(size);
  const affixSize = r2(Math.max(b.min.key, size * (inline ? 0.5 : 0.36)));
  if (!inline) for (const [name, s] of [['prefix', prefix], ['suffix', suffix]]) if (s) fitText(check, `params.${name}`, s, {family: 'body', width: W, preferred: affixSize, min: b.min.key, maxLines: 1});
  const h = r2(size * 1.25);
  const rows = b.variant === 'stack' ? 3 : 1;
  const reelW = r2(widest * size + (b.variant === 'window' ? u(80) : u(20)));
  const reelH = r2(h * rows);
  const n = items.length;
  // Strip: the items repeated `spins` times, then up to the final item.
  const sequence = [];
  for (let s = 0; s < spins; s++) sequence.push(...items);
  for (let i = 0; i <= final; i++) sequence.push(items[i]);
  if (rows === 3) { sequence.unshift(items[n - 1]); sequence.push(items[(final + 1) % n]); }
  const offset = rows === 3 ? 1 : 0;
  const endY = r2(-(sequence.length - 1 - offset - (rows === 3 ? 1 : 0)) * h);
  const t0 = startEvent(b, p, 'spin', 0.5, 'whoosh', duration);
  b.events.push({id: `${b.id}-land`, name: 'land', time: rt(t0 + duration), role: 'emphasis', cue: 'impact'});
  const affixH = inline ? 0 : (prefix ? affixSize * 1.3 + u(24) : 0) + (suffix ? affixSize * 1.3 + u(24) : 0);
  const y = r2((rect.height - reelH - affixH) / 2 + (!inline && prefix ? affixSize * 1.3 + u(24) : 0));
  const content = {variant: b.variant, sequence, size, h, rows, reelW, reelH, y, endY, startY: 0, t0, duration, prefix, suffix, affixSize, color, finalText: items[final],
    panel: b.theme.panel, border: b.theme.border, ink: b.theme.foreground, bg: b.colors.bg};
  return b.finish(content, {minTextPx: Math.min(size, affixSize)});
}

function slotView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const W = model.rect.width;
  const strip = el('div', `${id}-strip`, {position: 'absolute', left: 0, top: 0, width: c.reelW, height: r2(c.h * c.sequence.length)},
    c.sequence.map((w, j) => label(null, 0, r2(j * c.h), c.reelW, w, {size: c.size, family: fonts.display, color: c.color, align: 'center', lineHeight: c.h / c.size})));
  const frame = c.variant === 'window' ? {borderRadius: r2(28 * u), background: c.panel, border: `${r2(3 * u)}px solid ${c.border}`, boxShadow: `inset 0 ${r2(18 * u)}px ${r2(24 * u)}px ${c.bg}, inset 0 ${r2(-18 * u)}px ${r2(24 * u)}px ${c.bg}`}
    : c.variant === 'stack' ? {WebkitMaskImage: 'linear-gradient(180deg, transparent 0%, #000 34%, #000 66%, transparent 100%)', maskImage: 'linear-gradient(180deg, transparent 0%, #000 34%, #000 66%, transparent 100%)'} : {};
  const reel = el('div', `${id}-reel`, {position: 'relative', flex: '0 0 auto', width: c.reelW, height: c.reelH, boxSizing: 'border-box', overflow: 'hidden', ...frame}, [strip]);
  const affix = (nodeId, text) => el('div', nodeId, {position: 'relative', flex: '0 0 auto', margin: 0, whiteSpace: 'nowrap', fontFamily: fonts.body, fontWeight: 650, fontSize: c.affixSize, lineHeight: '1.3', color: c.ink}, [text]);
  if (c.variant === 'inline') {
    return [el('div', `${id}-line`, {...abs(0, c.y, W, c.reelH), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: r2(18 * u)},
      [c.prefix ? affix(`${id}-prefix`, c.prefix) : null, reel, c.suffix ? affix(`${id}-suffix`, c.suffix) : null].filter(Boolean))];
  }
  const kids = [];
  if (c.prefix) kids.push(label(`${id}-prefix`, 0, r2(c.y - c.affixSize * 1.3 - 24 * u), W, c.prefix, {size: c.affixSize, family: fonts.body, color: c.ink, align: 'center', weight: 650, lineHeight: 1.3}));
  kids.push(el('div', null, {...abs(0, c.y, W, c.reelH), display: 'flex', justifyContent: 'center'}, [reel]));
  if (c.variant === 'stack') kids.push(el('div', null, abs(r2((W - c.reelW) / 2), r2(c.y + c.h), c.reelW, c.h, {boxSizing: 'border-box', borderTop: `${r2(3 * u)}px solid ${c.color}`, borderBottom: `${r2(3 * u)}px solid ${c.color}`})));
  if (c.suffix) kids.push(label(`${id}-suffix`, 0, r2(c.y + c.reelH + 24 * u), W, c.suffix, {size: c.affixSize, family: fonts.body, color: c.ink, align: 'center', weight: 650, lineHeight: 1.3}));
  return kids;
}

function slotTimeline(model, ops) {
  const {id, start} = model;
  const c = model.content;
  set(ops, `${id}-strip`, start, {x: 0, y: 0, blur: 0});
  tw(ops, `${id}-strip`, c.t0, c.duration, 'back.out(1.1)', {y: 0}, {y: c.endY});
  tw(ops, `${id}-strip`, c.t0, rt(c.duration * 0.85), 'power2.in', {blur: 7 * model.unit}, {blur: 0});
  tw(ops, `${id}-reel`, rt(c.t0 + c.duration - 0.05), 0.35, 'back.out(3)', {scaleX: 0.94, scaleY: 0.94}, {scaleX: 1, scaleY: 1});
}

export const slotRoll = {
  id: 'slot-roll',
  describe: 'A slot-machine reel of words spins (motion-blurred) and lands on the final one; a boxed window, inline in a sentence ("Built for ___"), or a stack showing its neighbours.',
  params: {items: '[string ≤ 18] 2–10, the words on the reel', final: 'the word it lands on (an item or index; default the last)', prefix: 'string ≤ 36 before the reel (optional)', suffix: 'string ≤ 36 after it (optional)',
    spins: 'full turns before landing 1–5 (default 2)', span: 'seconds 0.5–4 (default 1.5)', tone: `reel text colour (${tone})`, at: `spin start: ${at}`, variant: VARIANT_PARAM, rect},
  events: ['spin', 'land'], timing: TIMING, variants: SLOT_VARIANTS,
  resolve: slotResolve, view: slotView, timeline: slotTimeline
};

// ---------------------------------------------------------------------------
// countdown

const COUNTDOWN_VARIANTS = Object.freeze(['digits', 'ring', 'clock']);

function countdownResolve(params, ctx) {
  const b = createHBase('countdown', params, ctx, {allowed: ['from', 'to', 'step', 'end', 'label', 'sub', 'at', 'tone'], required: ['from'], variants: COUNTDOWN_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  const from = check.int(p.from, 'params.from', 1, 3600);
  const to = p.to === undefined ? 0 : check.int(p.to, 'params.to', 0, from - 1);
  const end = p.end === undefined ? null : check.str(p.end, 'params.end', 14);
  const color = toneColor(b, p.tone, 'params.tone');
  const t0 = startEvent(b, p, 'start', 0.5, 'tick', 0.3);
  const ticks = from - to;
  const room = b.start + b.lastEvent - t0 - (end ? 0.45 : 0.1);
  const step = p.step === undefined ? Math.min(1, room / ticks) : check.num(p.step, 'params.step', 0.1, 60);
  if (step * ticks > room + 1e-6) check.fail('params.step', `× ${ticks} ticks runs past the scene (${r2(room)} s of room); lengthen the scene or shorten the step`);
  const clock = b.variant === 'clock';
  const fmt = v => (clock ? `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}` : String(v));
  const W = rect.width;
  const caption = captionBlock(b, p, W);
  const ring = b.variant === 'ring';
  const longest = Math.max(fmt(from).length, end ? end.length * 0.9 : 0);
  let size = Math.min(u(ring ? 260 : 340), (W - u(40)) / (longest * 0.6), (rect.height - caption.height - u(80)) / (clock ? 1.6 : 1.25));
  if (ring) size = Math.min(size, (Math.min(W, rect.height - caption.height) * 0.62) / Math.max(1.2, longest * 0.6));
  size = r2(size);
  if (size < b.min.key) check.fail('params', 'the count does not fit the rect');
  const ringSize = ring ? r2(Math.min(W, rect.height - caption.height - u(20), u(760))) : 0;
  const figureH = ring ? ringSize : clock ? r2(size * 1.2 + u(60)) : r2(size * 1.2);
  // The label reads first ("Launch in"), so it sits above the count.
  const y = r2((rect.height - figureH - caption.height) / 2 + caption.height);
  const steps = Array.from({length: ticks + 1}, (_, i) => ({value: from - i, text: fmt(from - i), time: rt(t0 + i * step)}));
  const zero = steps[steps.length - 1].time;
  b.events.push({id: `${b.id}-zero`, name: 'zero', time: zero, role: 'emphasis', cue: end ? 'impact' : 'success'});
  const content = {variant: b.variant, steps, step, size, y, figureH, ringSize, color, caption, end: end ? {text: end, time: rt(zero + 0.25), size: r2(Math.max(b.min.key, Math.min(size, (W - u(40)) / (end.length * 0.6))))} : null,
    t0, zero, track: b.theme.panel, ink: b.theme.foreground, muted: b.theme.muted};
  return b.finish(content, {minTextPx: Math.min(size, caption.label ? caption.label.size : Infinity)});
}

function countdownView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const W = model.rect.width;
  const kids = [];
  const numY = c.variant === 'ring' ? r2(c.y + c.ringSize / 2 - c.size * 0.6) : c.y;
  if (c.variant === 'ring') {
    const cx = W / 2, cy = r2(c.y + c.ringSize / 2), r = r2(c.ringSize / 2 - c.ringSize * 0.04);
    const ring = arcPath(cx, cy, r, -90, 270);
    kids.push(svgRoot(W, model.rect.height, [el('path', null, null, [], {d: ring, stroke: c.track, strokeWidth: r2(c.ringSize * 0.06), fill: 'none'}),
      strokePath(`${id}-ring`, ring, c.color, r2(c.ringSize * 0.06), {dash: true})]));
  }
  if (c.variant === 'clock') {
    const barW = r2(Math.min(W, 700 * u));
    kids.push(el('div', null, abs(r2((W - barW) / 2), r2(c.y + c.size * 1.2 + 40 * u), barW, r2(14 * u), {borderRadius: 99, background: c.track}), [
      el('div', `${id}-bar`, abs(0, 0, barW, r2(14 * u), {borderRadius: 99, background: c.color, transformOrigin: '0% 50%'}))]));
  }
  kids.push(label(`${id}-num`, 0, numY, W, c.steps[0].text, {size: c.size, family: fonts.display, color: c.variant === 'digits' ? c.color : c.ink, align: 'center', lineHeight: 1.2}));
  if (c.end) kids.push(label(`${id}-end`, 0, r2(numY + (c.size - c.end.size) * 0.6), W, c.end.text, {size: c.end.size, family: fonts.display, color: c.color, align: 'center', lineHeight: 1.2, extra: {opacity: 0}}));
  kids.push(...captionNodes(model, r2(c.y - c.caption.height - 28 * u)));
  return kids;
}

function countdownTimeline(model, ops) {
  const {id, start} = model;
  const c = model.content;
  set(ops, `${id}-num`, start, {text: c.steps[0].text, opacity: 1, x: 0, y: 0, scaleX: 1, scaleY: 1});
  c.steps.forEach((s, i) => {
    if (i) set(ops, `${id}-num`, s.time, {text: s.text});
    if (c.variant !== 'clock') tw(ops, `${id}-num`, s.time, Math.min(0.4, c.step * 0.8), 'power3.out', {scaleX: 1.22, scaleY: 1.22}, {scaleX: 1, scaleY: 1});
  });
  const total = rt(c.zero - c.t0);
  if (c.variant === 'ring') drawOps(ops, `${id}-ring`, start, c.t0, total, 'none', 1, 0);
  if (c.variant === 'clock') {
    set(ops, `${id}-bar`, start, {x: 0, y: 0, scaleX: 1, scaleY: 1});
    tw(ops, `${id}-bar`, c.t0, total, 'none', {scaleX: 1}, {scaleX: 0});
  }
  if (c.end) {
    tw(ops, `${id}-num`, c.end.time, 0.2, 'power2.in', {opacity: 1}, {opacity: 0});
    popOps(ops, `${id}-end`, start, rt(c.end.time + 0.1), {from: 0.5, ease: 'back.out(2.2)'});
  }
  captionOps(model, ops, rt(c.t0 - 0.2));
}

export const countdown = {
  id: 'countdown',
  describe: 'A countdown from N to zero (or to `to`), each number punching in on its tick, then an optional end word; big digits, a depleting ring, or an mm:ss clock with a draining bar.',
  params: {from: 'integer 1–3600, required', to: 'integer (default 0)', step: 'seconds per tick (default 1, shortened to fit the scene)', end: 'string ≤ 14 shown after zero, e.g. "Live" (optional)',
    label: 'string ≤ 60 (optional)', sub: 'string ≤ 70 (optional)', tone: `colour (${tone})`, at: `first tick: ${at}`, variant: VARIANT_PARAM, rect},
  events: ['start', 'zero'], timing: TIMING, variants: COUNTDOWN_VARIANTS,
  resolve: countdownResolve, view: countdownView, timeline: countdownTimeline
};

// ---------------------------------------------------------------------------
// percent-fill

const FILL_VARIANTS = Object.freeze(['liquid', 'battery', 'bar']);

function fillResolve(params, ctx) {
  const b = createHBase('percent-fill', params, ctx, {allowed: ['value', 'max', 'label', 'sub', 'format', 'at', 'tone', 'duration'], required: ['value'], variants: FILL_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  const max = p.max === undefined ? 100 : check.num(p.max, 'params.max', 1e-9, 1e12);
  const value = check.num(p.value, 'params.value', 0, max);
  const fmt = numberFormat(check, p.format ?? (p.max === undefined ? {style: 'percent'} : undefined), 'params.format', {decimals: decimalsOf(value)});
  const color = toneColor(b, p.tone, 'params.tone');
  const duration = p.span === undefined ? 1.6 : check.num(p.span, 'params.span', 0.4, 4);
  const W = rect.width;
  const caption = captionBlock(b, p, W);
  const frac = value / max;
  const t0 = startEvent(b, p, 'fill', 0.5, 'tally', duration);
  const room = rect.height - caption.height;
  let shape;
  if (b.variant === 'liquid') { const d = r2(Math.min(W, room - u(10), u(720))); shape = {width: d, height: d}; }
  else if (b.variant === 'battery') { const w = r2(Math.min(W - u(40), u(820))); shape = {width: w, height: r2(Math.min(room - u(10), w * 0.44))}; }
  else { const w = r2(Math.min(W, u(900))); shape = {width: w, height: r2(u(64))}; }
  const valueSize = b.variant === 'bar' ? r2(Math.min(u(200), room - shape.height - u(40))) : r2(Math.min(shape.height * 0.34, shape.width * 0.26));
  if (valueSize < b.min.key) check.fail('params', 'the fill does not fit the rect');
  const figureH = b.variant === 'bar' ? r2(valueSize * 1.15 + u(30) + shape.height) : shape.height;
  const y = r2((room - figureH) / 2 + 0);
  shape.x = r2((W - shape.width) / 2);
  shape.y = b.variant === 'bar' ? r2(y + valueSize * 1.15 + u(30)) : y;
  const waveW = r2(shape.width / 2);
  const content = {variant: b.variant, shape, frac, color, light: mixColor('#ffffff', color, 0.35), caption, t0, duration, valueSize, valueY: b.variant === 'bar' ? y : r2(shape.y + shape.height / 2 - valueSize * 0.6), figureY: y, figureH,
    waveW, samples: countSamples(b.model, t0, duration, 'power2.inOut', 0, value, fmt.format), initial: fmt.format(0), track: b.theme.panel, border: b.theme.border, ink: b.theme.foreground, bg: b.colors.bg,
    onColor: inkOn(b.colors, color)};
  return b.finish(content, {minTextPx: Math.min(valueSize, caption.label ? caption.label.size : Infinity)});
}

function fillView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const W = model.rect.width;
  const S = c.shape;
  const kids = [];
  if (c.variant === 'bar') {
    kids.push(el('div', null, abs(S.x, S.y, S.width, S.height, {borderRadius: 99, background: c.track, overflow: 'hidden'}), [
      el('div', `${id}-fill`, abs(0, 0, r2(S.width * c.frac), S.height, {borderRadius: 99, background: `linear-gradient(90deg, ${c.color}, ${c.light})`, transformOrigin: '0% 50%', transform: transformString({scaleX: 0})}))]));
    kids.push(label(`${id}-value`, 0, c.valueY, W, c.initial, {size: c.valueSize, family: fonts.display, color: c.ink, align: 'center', lineHeight: 1.15}));
  } else {
    const liquid = c.variant === 'liquid';
    const border = r2(liquid ? 8 * u : 10 * u);
    const innerW = r2(S.width - border * 2), innerH = r2(S.height - border * 2);
    // The liquid body rises from below; a wave rides its top edge, sliding.
    const waveH = r2(liquid ? 36 * u : 0);
    const wave = [];
    if (liquid) {
      const n = Math.ceil(innerW / c.waveW) + 2;
      let d = `M0 ${waveH}`;
      for (let i = 0; i < n; i++) d += ` Q${r2(c.waveW * (i + 0.25))} 0 ${r2(c.waveW * (i + 0.5))} ${r2(waveH / 2)} T${r2(c.waveW * (i + 1))} ${r2(waveH / 2)}`;
      d += ` V${r2(waveH + innerH)} H0 Z`;
      wave.push(el('div', `${id}-wave`, abs(0, 0, r2(c.waveW * n), r2(waveH + innerH)), [svgRoot(r2(c.waveW * n), r2(waveH + innerH), [el('path', null, null, [], {d, fill: c.color})])]));
    }
    const body = el('div', `${id}-fill`, {...abs(0, r2(liquid ? -waveH / 2 : 0), innerW, r2(innerH + waveH)), transform: transformString(liquid ? {y: innerH + waveH / 2} : {}), ...(liquid ? {} : {transformOrigin: '0% 50%', transform: transformString({scaleX: 0})})},
      liquid ? wave : [el('div', null, abs(0, 0, r2(innerW * c.frac), innerH, {borderRadius: r2(14 * u), background: `linear-gradient(180deg, ${c.light}, ${c.color})`}))]);
    kids.push(el('div', null, abs(S.x, S.y, S.width, S.height, {boxSizing: 'border-box', borderRadius: liquid ? '50%' : r2(34 * u), border: `${border}px solid ${c.border}`, background: c.track, overflow: 'hidden'}), [
      el('div', null, abs(0, 0, innerW, innerH, {overflow: 'hidden', borderRadius: liquid ? '50%' : r2(24 * u)}), [body])]));
    if (!liquid) kids.push(el('div', null, abs(r2(S.x + S.width), r2(S.y + S.height * 0.3), r2(24 * u), r2(S.height * 0.4), {borderRadius: `0 ${r2(12 * u)}px ${r2(12 * u)}px 0`, background: c.border})));
    // Over a mostly full shape the figure sits on the fill, so it takes the fill's ink.
    const onFill = c.frac >= (liquid ? 0.55 : 0.62);
    kids.push(label(`${id}-value`, S.x, c.valueY, S.width, c.initial, {size: c.valueSize, family: fonts.display, color: onFill ? c.onColor : c.ink, align: 'center', lineHeight: 1.2, extra: onFill ? {} : {textShadow: `0 ${r2(4 * u)}px ${r2(20 * u)}px ${c.bg}`}}));
  }
  kids.push(...captionNodes(model, c.figureY + c.figureH));
  return kids;
}

function fillTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  const S = c.shape;
  if (c.variant === 'liquid') {
    const border = r2(8 * u), innerH = r2(S.height - border * 2), waveH = r2(36 * u);
    const from = r2(innerH + waveH / 2), to = r2(innerH * (1 - c.frac));
    set(ops, `${id}-fill`, start, {x: 0, y: from});
    tw(ops, `${id}-fill`, c.t0, c.duration, 'power2.inOut', {y: from}, {y: to});
    set(ops, `${id}-wave`, start, {x: 0});
    ops.push({type: 'loop', target: `${id}-wave`, start, cycle: 1.4, repeats: Math.ceil(model.duration / 1.4) + 1, from: {x: 0}, to: {x: r2(-c.waveW)}});
  } else {
    set(ops, `${id}-fill`, start, {x: 0, y: 0, scaleX: 0, scaleY: 1});
    tw(ops, `${id}-fill`, c.t0, c.duration, 'power2.inOut', {scaleX: 0}, {scaleX: 1});
  }
  countOps(ops, `${id}-value`, start, c.initial, c.samples);
  captionOps(model, ops, rt(c.t0 + 0.1));
}

export const percentFill = {
  id: 'percent-fill',
  describe: 'A shape fills to a share while the figure counts: a round flask of rising liquid with a sliding wave, a battery, or a thick bar.',
  params: {value: 'number, required (0..max)', max: 'number (default 100: the value is a percent)', format: FORMAT_PARAM, label: 'string ≤ 60 (optional)', sub: 'string ≤ 70 (optional)',
    span: 'seconds 0.4–4 (default 1.6)', tone: `fill colour (${tone})`, at: `fill start: ${at}`, variant: VARIANT_PARAM, rect},
  events: ['fill'], timing: TIMING, variants: FILL_VARIANTS,
  resolve: fillResolve, view: fillView, timeline: fillTimeline
};

export const NUMBERS = [odometer, flipClock, tickerTape, slotRoll, countdown, percentFill];
