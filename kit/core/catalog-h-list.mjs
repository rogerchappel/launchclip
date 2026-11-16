// Catalogue H item-list: a list (steps, features, a checklist) drawn as one
// free element per item, never rows inside one card. Each item is its own node
// in the view tree with its own entrance and settle, and an optional tick that
// draws on by itself, so a shot state can reveal one tick per state
// (states: reveal ["tick-2"]). Layouts are the variants: stack (free type down
// the frame), fan (the stack fans out from a pile on an arc), scatter (tilted
// type spread over the frame) and orbit (items fly out from a subject).
// Registered in kit/core/catalog-h.mjs.

import {timingRules} from './catalog-b-base.mjs';
import {grammarStagger} from './grammar.mjs';
import {VARIANT_PARAM, createHBase, fitText, r2, rt, toneColor} from './catalog-h-base.mjs';
import {chromeNodes, chromeOps, drawOps, el, label, set, strokePath, tw} from './catalog-h-view.mjs';

const at = 'seconds from scene start (optional; else a matching hit, else a default)';
const rect = '{x, y, width, height} canvas px inside the safe zone (optional)';
export const LIST_VARIANTS = Object.freeze(['stack', 'fan', 'scatter', 'orbit']);
// The tick: one stroke in a 24-unit box, drawn on like a pen mark.
const TICK = 'M4 12.5 L9.5 18 L20 6';
const ENTER = 0.55, TICK_DRAW = 0.35;

function listResolve(params, ctx) {
  const b = createHBase('item-list', params, ctx, {allowed: ['items', 'title', 'subject', 'ticks', 'numbered', 'tone', 'at', 'stagger'], required: ['items'], variants: LIST_VARIANTS});
  const {check, u, rect, start, portrait} = b;
  const p = b.params;
  const layout = b.variant;
  check.arr(p.items, 'params.items', 2, 6);
  const ticks = p.ticks === undefined ? false : check.bool(p.ticks, 'params.ticks');
  const numbered = p.numbered === undefined ? !ticks : check.bool(p.numbered, 'params.numbered');
  const color = toneColor(b, p.tone, 'params.tone');
  const W = rect.width, H = rect.height;
  const title = p.title === undefined ? null : check.str(p.title, 'params.title', 48);
  const titleFit = title ? fitText(check, 'params.title', title, {family: 'body', width: W, preferred: u(56), min: b.min.key, maxLines: 2}) : null;
  const top = titleFit ? r2(titleFit.size * 1.15 * titleFit.lines + u(48)) : 0;
  const subject = p.subject === undefined ? null : check.str(p.subject, 'params.subject', 24);
  if (layout === 'orbit' && !subject) check.fail('params.subject', 'orbit needs a subject the items circle (≤ 24 chars)');
  if (layout !== 'orbit' && subject) check.fail('params.subject', 'is only for the orbit variant');
  const n = p.items.length;
  const stagger = p.stagger === undefined ? grammarStagger(ctx.grammar, Math.min(0.35, 1.6 / n), {min: 0.08, max: 0.6}) : check.num(p.stagger, 'params.stagger', 0.08, 0.6);
  const first = b.timeOf('item-0', p.at, 'params.at', 0.5) - start;
  const raw = p.items.map((item, i) => typeof item === 'string' ? {label: item} : check.obj(item, `params.items[${i}]`, ['label', 'detail', 'at', 'tickAt'], ['label']));
  const H0 = H - top;
  const marker = r2(u(portrait ? 64 : 56));
  const showMarker = numbered || ticks;
  const centred = layout === 'scatter' || layout === 'orbit';
  // Cell size each layout gives an item's text.
  const cols = layout === 'scatter' ? (portrait ? 2 : Math.min(3, n)) : 1;
  const rows = layout === 'scatter' ? Math.ceil(n / cols) : n;
  const orbitW = r2(W * (portrait ? 0.46 : 0.3));
  const textW = layout === 'orbit' ? orbitW : layout === 'scatter' ? r2(W / cols - u(56)) : r2(W - (showMarker ? marker + u(32) : 0) - (layout === 'fan' ? u(80) : 0));
  const preferred = u(layout === 'stack' || layout === 'fan' ? (portrait ? 72 : 64) : 56);
  const detailSize = r2(Math.max(b.min.meta, u(34)));
  const items = raw.map((entry, i) => {
    const path = `params.items[${i}]`;
    const text = check.str(entry.label, `${path}.label`, 40);
    const detail = entry.detail === undefined ? null : check.str(entry.detail, `${path}.detail`, 60);
    const fit = fitText(check, `${path}.label`, text, {family: 'body', width: textW, preferred, min: b.min.key, maxLines: 2});
    const detailLines = detail ? fitText(check, `${path}.detail`, detail, {family: 'body', width: textW, preferred: detailSize, min: detailSize, maxLines: 2}).lines : 0;
    const markerH = showMarker && centred ? marker + u(14) : 0;
    const height = r2(markerH + fit.lines * fit.size * 1.12 + (detailLines ? u(10) + detailLines * detailSize * 1.3 : 0));
    const time = entry.at === undefined ? b.timeOf(`item-${i}`, undefined, `${path}.at`, Math.min(b.lastEvent, first + i * stagger)) : b.timeOf(`item-${i}`, entry.at, `${path}.at`, 0);
    const tickTime = ticks ? b.timeOf(`tick-${i}`, entry.tickAt, `${path}.tickAt`, Math.min(b.lastEvent, rt(time - start + ENTER * 0.7))) : null;
    if (tickTime !== null && tickTime < time) check.fail(`${path}.tickAt`, 'must come after the item enters');
    return {index: i, label: text, detail, size: fit.size, lines: fit.lines, detailLines, height, width: textW, time, tickTime, number: String(i + 1).padStart(2, '0')};
  });
  // Every item shares the smallest fitted size, so the list reads as one set.
  const size = Math.min(...items.map(item => item.size));
  for (const item of items) {
    if (item.size !== size) item.lines = fitText(check, `params.items[${item.index}].label`, item.label, {family: 'body', width: textW, preferred: size, min: size, maxLines: 2}).lines;
    item.size = size;
    item.height = r2((showMarker && centred ? marker + u(14) : 0) + item.lines * size * 1.12 + (item.detailLines ? u(10) + item.detailLines * detailSize * 1.3 : 0));
  }
  const place = {stack: placeStack, fan: placeStack, scatter: placeScatter, orbit: placeOrbit}[layout];
  const subjectFit = subject ? fitText(check, 'params.subject', subject, {family: 'display', width: W * (portrait ? 0.5 : 0.34), preferred: u(120), min: b.min.key, maxLines: 2}) : null;
  place({items, W, top, H0, u, cols, rows, marker, showMarker, subjectFit, check});
  if (layout === 'fan') fanOut(items, top, H0, u);
  for (const item of items) {
    if (item.y < top - 1 || item.y + item.height > H + 1 || item.x < -1 || item.x + item.width > W + 1) check.fail(`params.items[${item.index}]`, 'does not fit the rect; shorten the labels, use fewer items or another variant');
    b.events.push({id: `${b.id}-item-${item.index}`, name: `item-${item.index}`, time: item.time, endTime: rt(item.time + ENTER), role: 'emphasis', cue: 'pop'});
    if (item.tickTime !== null) b.events.push({id: `${b.id}-tick-${item.index}`, name: `tick-${item.index}`, time: item.tickTime, endTime: rt(item.tickTime + TICK_DRAW), role: 'emphasis', cue: 'tick'});
  }
  const content = {variant: layout, title: titleFit ? {text: title, size: titleFit.size, lines: titleFit.lines} : null, source: null, align: centred ? 'center' : 'left',
    items, size, detailSize, marker, showMarker, numbered, ticks, centred, color, ink: b.theme.foreground, muted: b.theme.muted,
    subject: subjectFit ? {text: subject, size: subjectFit.size, lines: subjectFit.lines, x: r2(W / 2), y: r2(top + H0 / 2), time: rt(Math.max(b.motion.enterEnd - 0.2, items[0].time - 0.35))} : null,
    buildEnd: rt(Math.max(...items.map(item => (item.tickTime ?? item.time) + ENTER)))};
  return b.finish(content, {minTextPx: Math.min(size, titleFit ? titleFit.size : Infinity, subjectFit ? subjectFit.size : Infinity)});
}

// Free type down the frame, the group centred in the space under the title.
function placeStack({items, W, top, H0, u, marker, showMarker, check}) {
  const total = items.reduce((sum, item) => sum + item.height, 0);
  const gap = Math.min(u(72), (H0 - total) / Math.max(1, items.length - 1));
  if (gap < u(20)) check.fail('params.items', 'too many or too long for the rect; use fewer items or a taller rect');
  let y = top + (H0 - total - gap * (items.length - 1)) / 2;
  for (const item of items) {
    Object.assign(item, {x: r2(showMarker ? marker + u(32) : 0), y: r2(y), rotation: 0, markerAt: {x: r2(-(marker + u(32))), y: r2((item.size * 1.12 - marker) / 2)}});
    y += item.height + gap;
  }
}

// The stack bent onto an arc: each item turns about a pivot far to the left, so
// the list fans like a hand of cards with no cards. Entrances start from the pile.
function fanOut(items, top, H0, u) {
  const mid = top + H0 / 2, spread = 4;
  for (const item of items) {
    const k = items.length > 1 ? item.index / (items.length - 1) * 2 - 1 : 0;
    item.rotation = r2(k * spread);
    item.x = r2(item.x + u(80) * (1 - k * k));
    item.pile = {x: r2(-item.x * 0.2), y: r2(mid - (item.y + item.height / 2)), rotation: r2(-item.rotation * 2)};
  }
}

// A loose grid with a little tilt and offset per item (fixed per index, so both renderers agree).
function placeScatter({items, W, top, H0, cols, rows}) {
  const cellW = W / cols, cellH = H0 / rows;
  const jitter = i => [((i * 37) % 11) / 10 - 0.5, ((i * 53) % 7) / 6 - 0.5];
  const n = items.length;
  for (const item of items) {
    const i = item.index, row = Math.floor(i / cols), col = i % cols;
    const inRow = row === rows - 1 ? n - row * cols : cols;
    const [jx, jy] = jitter(i);
    const cx = (W - inRow * cellW) / 2 + (col + 0.5) * cellW + jx * Math.max(0, cellW - item.width) * 0.8;
    const cy = top + (row + 0.5) * cellH + jy * Math.max(0, cellH - item.height) * 0.5;
    Object.assign(item, {x: r2(cx - item.width / 2), y: r2(cy - item.height / 2), rotation: (i % 2 ? 1 : -1) * (2 + (i % 3)), markerAt: null});
  }
}

// Items on an ellipse round the subject, the first at the top, clockwise.
function placeOrbit({items, W, top, H0, subjectFit, check, u}) {
  const cx = W / 2, cy = top + H0 / 2, n = items.length;
  const tallest = Math.max(...items.map(item => item.height));
  const rx = (W - items[0].width) / 2, ry = (H0 - tallest) / 2;
  const subjectH = subjectFit.lines * subjectFit.size * 1.05;
  if (ry < subjectH / 2 + tallest / 2 + u(10)) check.fail('params.items', 'the rect is too short to orbit the subject; use a taller rect or the stack variant');
  for (const item of items) {
    const a = -Math.PI / 2 + item.index * 2 * Math.PI / n;
    const x = cx + rx * Math.cos(a), y = cy + ry * Math.sin(a);
    Object.assign(item, {x: r2(x - item.width / 2), y: r2(y - item.height / 2), rotation: 0, markerAt: null, from: {x: r2(cx - x), y: r2(cy - y)}});
  }
}

function listView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const kids = chromeNodes(model);
  if (c.subject) {
    const s = c.subject, w = model.rect.width * 0.6, h = s.lines * s.size * 1.05;
    kids.push(label(`${id}-subject`, r2(s.x - w / 2), r2(s.y - h / 2), r2(w), s.text, {size: s.size, family: fonts.display, color: c.color, align: 'center', lineHeight: 1.05, wrap: true, extra: {opacity: 0}}));
  }
  for (const item of c.items) {
    const align = c.centred ? 'center' : 'left';
    const inner = [];
    let textTop = 0;
    if (c.showMarker) {
      const m = c.marker;
      const mx = c.centred ? r2((item.width - m) / 2) : item.markerAt.x, my = c.centred ? 0 : item.markerAt.y;
      if (c.numbered) inner.push(label(`${id}-num-${item.index}`, mx, r2(my + m * 0.18), m, item.number, {size: r2(m * 0.5), family: fonts.meta, color: c.color, align: 'center', weight: 600, spacing: '0.04em'}));
      if (c.ticks) inner.push(el('svg', null, {position: 'absolute', left: mx, top: my, width: m, height: m, overflow: 'visible'},
        [strokePath(`${id}-tick-${item.index}`, TICK, c.color, 3)], {viewBox: '0 0 24 24'}));
      if (c.centred) textTop = r2(m + 14 * u);
    }
    inner.push(label(null, 0, textTop, item.width, item.label, {size: c.size, family: fonts.body, color: c.ink, align, weight: 700, lineHeight: 1.12, wrap: true}));
    if (item.detail) inner.push(label(null, 0, r2(textTop + item.lines * c.size * 1.12 + 10 * u), item.width, item.detail, {size: c.detailSize, family: fonts.body, color: c.muted, align, weight: 450, lineHeight: 1.3, wrap: true}));
    kids.push(el('div', `${id}-item-${item.index}`, {position: 'absolute', left: item.x, top: item.y, width: item.width, height: item.height, opacity: 0,
      transformOrigin: c.centred ? '50% 50%' : '0% 50%', ...(item.rotation ? {transform: `rotate(${item.rotation}deg)`} : {})}, inner));
  }
  return kids;
}

function listTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  chromeOps(model, ops);
  if (c.subject) {
    set(ops, `${id}-subject`, start, {opacity: 0, x: 0, y: 0, scaleX: 0.85, scaleY: 0.85});
    tw(ops, `${id}-subject`, c.subject.time, 0.5, 'power3.out', {opacity: 0, scaleX: 0.85, scaleY: 0.85}, {opacity: 1, scaleX: 1, scaleY: 1});
  }
  for (const item of c.items) {
    const target = `${id}-item-${item.index}`;
    const rest = {x: 0, y: 0, rotation: item.rotation, scaleX: 1, scaleY: 1};
    // Where each layout's entrance starts: a slide, the pile, a tilted drop, the subject.
    const from = c.variant === 'stack' ? {x: r2(-48 * u), y: 0, rotation: 0, scaleX: 1, scaleY: 1}
      : c.variant === 'fan' ? {x: item.pile.x, y: item.pile.y, rotation: item.pile.rotation, scaleX: 0.92, scaleY: 0.92}
      : c.variant === 'scatter' ? {x: 0, y: r2(-36 * u), rotation: r2(item.rotation * 3), scaleX: 0.7, scaleY: 0.7}
      : {x: item.from.x, y: item.from.y, rotation: 0, scaleX: 0.4, scaleY: 0.4};
    set(ops, target, start, {opacity: 0, ...from});
    tw(ops, target, item.time, 0.2, 'power1.out', {opacity: 0}, {opacity: 1});
    tw(ops, target, item.time, ENTER, c.variant === 'scatter' ? 'back.out(1.6)' : 'power3.out', from, rest);
    if (item.tickTime !== null) {
      drawOps(ops, `${id}-tick-${item.index}`, start, item.tickTime, TICK_DRAW, 'power2.out');
      if (c.numbered) tw(ops, `${id}-num-${item.index}`, item.tickTime, 0.15, 'power1.out', {opacity: 1}, {opacity: 0});
    }
  }
}

export const itemList = {
  id: 'item-list',
  describe: 'A list (steps, features, a checklist) as separate free-type items, each with its own entrance: stacked down the frame, fanned out from a pile, scattered with a tilt, or orbiting a subject. Ticks draw on one item at a time. Use this, not a boxed checklist card, for any list.',
  params: {items: '[string | {label ≤ 40, detail? ≤ 60, at?, tickAt?}] 2–6', title: 'string ≤ 48 (optional)', subject: 'string ≤ 24, the centre the items circle (orbit only, required there)',
    ticks: 'boolean: each item gets a tick that draws on at tickAt (default: just after it enters)', numbered: 'boolean (default true without ticks)', tone: 'primary | accent | paper | #rrggbb (numbers and ticks)',
    stagger: 'seconds between entrances (default min(0.35, 1.6 / count))', at: `first item: ${at}`, variant: VARIANT_PARAM, rect},
  events: ['item-<i>', 'tick-<i>'], timing: timingRules({rules: ['items enter in order from at, stagger apart; a tick lands after its item enters']}), variants: LIST_VARIANTS,
  states: {params: ['items'], items: ['item', 'tick']},
  resolve: listResolve, view: listView, timeline: listTimeline
};

export const LIST_MODULES = [itemList];
