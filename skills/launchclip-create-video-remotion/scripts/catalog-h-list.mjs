// Catalogue H item-list: a list (steps, features, a checklist) drawn as one
// free element per item, never rows inside one card. Each item is its own node
// in the view tree with its own entrance and settle, and an optional tick that
// draws on by itself, so a shot state can reveal one tick per state
// (states: reveal ["tick-2"]). Once in, each item breathes on its own -idle
// wrapper, out of step with the others (docs/FLUID_MOTION_RFC.md §4). Layouts are the variants: pills (each item its
// own rounded chip, cascading down the frame), stack (free type down
// the frame), fan (the stack fans out from a pile on an arc), scatter (tilted
// type spread over the frame) and orbit (items fly out from a subject).
// Registered in kit/core/catalog-h.mjs.

import {timingRules} from './catalog-b-base.mjs';
import {grammarStagger} from './grammar.mjs';
import {VARIANT_PARAM, createHBase, fitText, inkOn, mixColor, r2, rt, textWidth, toneColor} from './catalog-h-base.mjs';
import {chromeNodes, chromeOps, drawOps, el, label, set, strokePath, tw} from './catalog-h-view.mjs';
import {idleAmplitude, idleOps} from './fluid-motion.mjs';

const at = 'seconds from scene start (optional; else a matching hit, else a default)';
const rect = '{x, y, width, height} canvas px inside the safe zone (optional)';
export const LIST_VARIANTS = Object.freeze(['pills', 'stack', 'fan', 'scatter', 'orbit']);
// The tick: one stroke in a 24-unit box, drawn on like a pen mark.
const TICK = 'M4 12.5 L9.5 18 L20 6';
const ENTER = 0.55, TICK_DRAW = 0.35;
// Items are wide lines of type: half the idle tilt keeps their far ends steady.
const LIST_TILT = 0.5;

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
  // Only orbit draws the subject; the other layouts ignore it, so a style can switch variants freely.
  const subjectIn = p.subject === undefined ? null : check.str(p.subject, 'params.subject', 24);
  const subject = layout === 'orbit' ? subjectIn : null;
  if (layout === 'orbit' && !subject) check.fail('params.subject', 'orbit needs a subject the items circle (≤ 24 chars)');
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
  const orbitW = r2(W * (portrait ? 0.44 : 0.28));
  // A pill: padding, the disc and a gap before its label.
  const pill = {padX: u(34), padY: u(24), gap: u(24), disc: marker};
  const textW = layout === 'pills' ? r2(W * 0.9 - pill.padX * 2 - pill.disc - pill.gap) : layout === 'orbit' ? orbitW : layout === 'scatter' ? r2(W / cols - u(56)) : r2(W - (showMarker ? marker + u(32) : 0) - (layout === 'fan' ? u(80) : 0));
  const preferred = u(layout === 'stack' || layout === 'fan' ? (portrait ? 72 : 64) : layout === 'pills' ? (portrait ? 56 : 52) : 56);
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
    // A pill hugs its label: as wide as the text it sets (capped), as tall as the text or the disc.
    if (layout === 'pills') {
      const text = Math.min(textW, Math.max(...[item.label, item.detail ?? ''].map((line, k) => textWidth(line, k ? detailSize : size, 'body') / (k ? Math.max(1, item.detailLines) : item.lines))));
      item.textW = r2(text);
      item.width = r2(pill.padX * 2 + pill.disc + pill.gap + text);
      item.height = r2(Math.max(item.height, pill.disc) + pill.padY * 2);
    }
  }
  const place = {pills: placePills, stack: placeStack, fan: placeStack, scatter: placeScatter, orbit: placeOrbit}[layout];
  const subjectFit = subject ? fitText(check, 'params.subject', subject, {family: 'display', width: W * 0.6, preferred: u(120), min: b.min.key, maxLines: 1}) : null;
  place({items, W, top, H0, u, cols, rows, marker, showMarker, subjectFit, subject, check});
  if (layout === 'fan') fanOut(items, top, H0, u);
  for (const item of items) {
    if (item.y < top - 1 || item.y + item.height > H + 1 || item.x < -1 || item.x + item.width > W + 1) check.fail(`params.items[${item.index}]`, 'does not fit the rect; shorten the labels, use fewer items or another variant');
    b.events.push({id: `${b.id}-item-${item.index}`, name: `item-${item.index}`, time: item.time, endTime: rt(item.time + ENTER), role: 'emphasis', cue: 'pop'});
    if (item.tickTime !== null) b.events.push({id: `${b.id}-tick-${item.index}`, name: `tick-${item.index}`, time: item.tickTime, endTime: rt(item.tickTime + TICK_DRAW), role: 'emphasis', cue: 'tick'});
  }
  const content = {variant: layout, pill: layout === 'pills' ? {...pill, fill: mixColor(color, b.colors.bg, 0.14), border: mixColor(color, b.colors.bg, 0.45), discInk: inkOn(b.colors, color)} : null, title: titleFit ? {text: title, size: titleFit.size, lines: titleFit.lines} : null, source: null, align: centred ? 'center' : 'left',
    items, size, detailSize, marker, showMarker, numbered, ticks, centred, color, ink: b.theme.foreground, muted: b.theme.muted,
    subject: subjectFit ? {text: subject, size: subjectFit.size, lines: subjectFit.lines, x: r2(W / 2), y: r2(top + H0 / 2), time: rt(Math.max(b.motion.enterEnd - 0.2, items[0].time - 0.35))} : null,
    buildEnd: rt(Math.max(...items.map(item => (item.tickTime ?? item.time) + ENTER))), idle: (a => ({bob: a.bob, tilt: r2(a.tilt * LIST_TILT)}))(idleAmplitude(ctx?.grammar ?? null, b.unit))};
  return b.finish(content, {minTextPx: Math.min(size, titleFit ? titleFit.size : Infinity, subjectFit ? subjectFit.size : Infinity)});
}

// Free type down the frame, the group centred in the space under the title.
function placeStack({items, W, top, H0, u, marker, showMarker, check}) {
  const total = items.reduce((sum, item) => sum + item.height, 0);
  const gap = Math.min(u(72), (H0 - total) / Math.max(1, items.length - 1));
  if (gap < u(20)) check.fail('params.items', 'too many or too long for the rect; use fewer items or a taller rect');
  let y = top + (H0 - total - gap * (items.length - 1)) / 2;
  for (const item of items) {
    Object.assign(item, {x: r2(showMarker ? marker + u(32) : 0), y: r2(y), rotation: 0});
    y += item.height + gap;
  }
}

// Chips down the frame, each a step further right, so the list reads as a sequence.
function placePills({items, W, top, H0, u, check}) {
  const total = items.reduce((sum, item) => sum + item.height, 0);
  const gap = Math.min(u(36), (H0 - total) / Math.max(1, items.length - 1));
  if (gap < u(16)) check.fail('params.items', 'too many or too long for the rect; use fewer items or a taller rect');
  let y = top + (H0 - total - gap * (items.length - 1)) / 2;
  const step = Math.min(u(56), (W - Math.max(...items.map(item => item.width))) / Math.max(1, items.length - 1));
  for (const item of items) {
    Object.assign(item, {x: r2(Math.max(0, item.index * step)), y: r2(y), rotation: 0});
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
    Object.assign(item, {x: r2(cx - item.width / 2), y: r2(cy - item.height / 2), rotation: (i % 2 ? 1 : -1) * (2 + (i % 3))});
  }
}

// Items round the subject, clockwise.
function placeOrbit({items, W, top, H0, subjectFit, subject, check, u}) {
  const cx = W / 2, cy = top + H0 / 2, n = items.length;
  const tallest = Math.max(...items.map(item => item.height));
  const rx = (W - items[0].width) / 2, ry = (H0 - tallest) / 2;
  const sw = Math.min(textWidth(subject, subjectFit.size, 'display') / subjectFit.lines, W * 0.6) / 2 + u(16), sh = subjectFit.lines * subjectFit.size * 1.05 / 2 + u(16);
  // Two phases: the first item at the top, or half a step round; keep the first where nothing covers the subject.
  const tryPhase = offset => items.map(item => {
    const a = -Math.PI / 2 + offset + item.index * 2 * Math.PI / n;
    // A squircle, not an ellipse: corner items sit further out, so wider labels fit between them.
    const sq = v => Math.sign(v) * Math.sqrt(Math.abs(v));
    const x = cx + rx * sq(Math.cos(a)), y = cy + ry * sq(Math.sin(a));
    const box = {x: r2(x - item.width / 2), y: r2(y - item.height / 2), rotation: 0, from: {x: r2(cx - x), y: r2(cy - y)}};
    // A centred label covers only its own text width inside the box.
    const half = Math.min(item.width, textWidth(item.label, item.size, 'body') / item.lines) / 2;
    return {...box, cx: x, half, height: item.height, clear: x - half > cx + sw || x + half < cx - sw || box.y > cy + sh || box.y + item.height < cy - sh};
  }).map((box, i, all) => ({...box, clear: box.clear && all.every((other, j) => j === i
    || Math.abs(box.cx - other.cx) > box.half + other.half + u(24) || box.y + box.height + u(16) < other.y || other.y + other.height + u(16) < box.y)}));
  const placed = [0, Math.PI / n].map(tryPhase).find(boxes => boxes.every(box => box.clear));
  if (!placed) check.fail('params.items', 'would cover the subject; use a taller rect, shorter labels, a shorter subject or the stack variant');
  items.forEach((item, i) => { const {x, y, rotation, from} = placed[i]; Object.assign(item, {x, y, rotation, from}); });
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
    if (c.pill) { kids.push(pillNode(model, item)); continue; }
    const align = c.centred ? 'center' : 'left';
    const m = c.marker;
    const block = [];
    // The marker: above the label when centred, else beside its first line.
    const markerBox = c.centred ? {position: 'relative', margin: '0 auto', marginBottom: 14 * u, width: m, height: m} : {position: 'absolute', left: -(m + 32 * u), top: r2((c.size * 1.12 - m) / 2), width: m, height: m};
    if (c.showMarker) block.push(el('div', null, markerBox, [
      ...(c.numbered ? [label(`${id}-num-${item.index}`, 0, r2(m * 0.18), m, item.number, {size: r2(m * 0.5), family: fonts.meta, color: c.color, align: 'center', weight: 600, spacing: '0.04em'})] : []),
      ...(c.ticks ? [el('svg', null, {position: 'absolute', left: 0, top: 0, width: m, height: m, overflow: 'visible'}, [strokePath(`${id}-tick-${item.index}`, TICK, c.color, 3)], {viewBox: '0 0 24 24'})] : [])
    ]));
    block.push(el('div', null, {margin: 0, fontFamily: fonts.body, fontWeight: 700, fontSize: c.size, lineHeight: '1.12', color: c.ink, textAlign: align}, [item.label]));
    if (item.detail) block.push(el('div', null, {margin: 0, marginTop: 10 * u, fontFamily: fonts.body, fontWeight: 450, fontSize: c.detailSize, lineHeight: '1.3', color: c.muted, textAlign: align}, [item.detail]));
    // The block centres in the item's measured box: a label that sets on fewer lines than measured keeps even gaps.
    const origin = c.centred ? '50% 50%' : '0% 50%';
    const inner = [el('div', null, {position: 'absolute', left: 0, top: r2(item.height / 2), width: item.width, transform: 'translateY(-50%)'}, block)];
    kids.push(el('div', `${id}-item-${item.index}`, {position: 'absolute', left: item.x, top: item.y, width: item.width, height: item.height, opacity: 0,
      transformOrigin: origin, ...(item.rotation ? {transform: `rotate(${item.rotation}deg)`} : {})}, [
      el('div', `${id}-item-${item.index}-idle`, {position: 'absolute', left: 0, top: 0, width: item.width, height: item.height, transformOrigin: origin}, inner)]));
  }
  return kids;
}

// One chip: a tinted rounded body, a disc (the number, or an empty ring that fills
// with the tick) and the label. The tick is the filled disc with its check inside,
// so revealing tick-<i> moves both.
function pillNode(model, item) {
  const {id, fonts, theme, unit: u} = model;
  const c = model.content, P = c.pill, d = P.disc;
  const discTop = r2((item.height - d) / 2), discBox = {position: 'absolute', left: P.padX, top: discTop, width: d, height: d, borderRadius: '50%'};
  const disc = c.ticks
    ? [el('div', null, {...discBox, boxSizing: 'border-box', border: `${r2(3 * u)}px solid ${P.border}`}),
      el('div', `${id}-tick-${item.index}`, {...discBox, background: c.color, opacity: 0, transform: 'scale(0.4)'}, [
        el('svg', null, {position: 'absolute', left: r2(d * 0.2), top: r2(d * 0.2), width: r2(d * 0.6), height: r2(d * 0.6), overflow: 'visible'}, [strokePath(`${id}-check-${item.index}`, TICK, P.discInk, 3.4)], {viewBox: '0 0 24 24'})])]
    : c.numbered ? [el('div', null, {...discBox, background: c.color}, [label(`${id}-num-${item.index}`, 0, r2(d * 0.25), d, item.number, {size: r2(d * 0.42), family: fonts.meta, color: P.discInk, align: 'center', weight: 700})])] : [];
  const textX = c.ticks || c.numbered ? P.padX + d + P.gap : P.padX;
  const block = [el('div', null, {margin: 0, fontFamily: fonts.body, fontWeight: 650, fontSize: c.size, lineHeight: '1.12', color: theme.foreground}, [item.label])];
  if (item.detail) block.push(el('div', null, {margin: 0, marginTop: 6 * u, fontFamily: fonts.body, fontWeight: 450, fontSize: c.detailSize, lineHeight: '1.3', color: c.muted}, [item.detail]));
  return el('div', `${id}-item-${item.index}`, {position: 'absolute', left: item.x, top: item.y, width: item.width, height: item.height, opacity: 0, transformOrigin: '0% 50%'}, [
    el('div', `${id}-item-${item.index}-idle`, {position: 'absolute', left: 0, top: 0, width: item.width, height: item.height, boxSizing: 'border-box',
      borderRadius: r2(Math.min(item.height / 2, 60 * u)), background: P.fill, border: `${r2(2 * u)}px solid ${P.border}`, boxShadow: `0 ${r2(14 * u)}px ${r2(36 * u)}px #00000066`, transformOrigin: '0% 50%'}, [
      ...disc,
      el('div', null, {position: 'absolute', left: r2(textX), top: r2(item.height / 2), width: r2(item.width - textX - P.padX + 8 * u), transform: 'translateY(-50%)'}, block)
    ])
  ]);
}

function listTimeline(model, ops) {
  const {id, start, unit: u, motion} = model;
  const c = model.content;
  const settle = rt(motion.exitStart - 0.05);
  chromeOps(model, ops);
  if (c.subject) {
    set(ops, `${id}-subject`, start, {opacity: 0, x: 0, y: 0, scaleX: 0.85, scaleY: 0.85});
    tw(ops, `${id}-subject`, c.subject.time, 0.5, 'power3.out', {opacity: 0, scaleX: 0.85, scaleY: 0.85}, {opacity: 1, scaleX: 1, scaleY: 1});
  }
  for (const item of c.items) {
    const target = `${id}-item-${item.index}`;
    const rest = {x: 0, y: 0, rotation: item.rotation, scaleX: 1, scaleY: 1};
    // Where each layout's entrance starts: a slide, the pile, a tilted drop, the subject.
    const from = c.variant === 'pills' ? {x: r2(-60 * u), y: 0, rotation: 0, scaleX: 0.86, scaleY: 0.86}
      : c.variant === 'stack' ? {x: r2(-48 * u), y: 0, rotation: 0, scaleX: 1, scaleY: 1}
      : c.variant === 'fan' ? {x: item.pile.x, y: item.pile.y, rotation: item.pile.rotation, scaleX: 0.92, scaleY: 0.92}
      : c.variant === 'scatter' ? {x: 0, y: r2(-36 * u), rotation: r2(item.rotation * 3), scaleX: 0.7, scaleY: 0.7}
      : {x: item.from.x, y: item.from.y, rotation: 0, scaleX: 0.4, scaleY: 0.4};
    set(ops, target, start, {opacity: 0, ...from});
    tw(ops, target, item.time, 0.2, 'power1.out', {opacity: 0}, {opacity: 1});
    tw(ops, target, item.time, ENTER, c.variant === 'scatter' || c.variant === 'pills' ? 'power3.out' : 'power3.out', from, rest);
    idleOps(ops, `${target}-idle`, start, rt(item.time + ENTER + 0.15), settle, c.idle);
    if (item.tickTime !== null && c.pill) {
      // The disc fills and pops, then its check draws on.
      set(ops, `${id}-tick-${item.index}`, start, {opacity: 0, x: 0, y: 0, scaleX: 0.4, scaleY: 0.4});
      tw(ops, `${id}-tick-${item.index}`, item.tickTime, 0.12, 'power1.out', {opacity: 0}, {opacity: 1});
      tw(ops, `${id}-tick-${item.index}`, item.tickTime, 0.4, 'power3.out', {scaleX: 0.4, scaleY: 0.4}, {scaleX: 1, scaleY: 1});
      drawOps(ops, `${id}-check-${item.index}`, start, rt(item.tickTime + 0.1), TICK_DRAW, 'power2.out');
    } else if (item.tickTime !== null) {
      drawOps(ops, `${id}-tick-${item.index}`, start, item.tickTime, TICK_DRAW, 'power2.out');
      if (c.numbered) tw(ops, `${id}-num-${item.index}`, item.tickTime, 0.15, 'power1.out', {opacity: 1}, {opacity: 0});
    }
  }
}

export const itemList = {
  id: 'item-list',
  describe: 'A list (steps, features, a checklist) as separate items, each with its own entrance: its own pill chip cascading down the frame (default), free type stacked down the frame, fanned out from a pile, scattered with a tilt, or orbiting a subject. Ticks draw on one item at a time. Use this, not a boxed checklist card, for any list.',
  params: {items: '[string | {label ≤ 40, detail? ≤ 60, at?, tickAt?}] 2–6', title: 'string ≤ 48 (optional)', subject: 'string ≤ 24, the centre the items circle (required for orbit, ignored by the others)',
    ticks: 'boolean: each item gets a tick that draws on at tickAt (default: just after it enters)', numbered: 'boolean (default true without ticks)', tone: 'primary | accent | paper | #rrggbb (numbers and ticks)',
    stagger: 'seconds between entrances (default min(0.35, 1.6 / count))', at: `first item: ${at}`, variant: VARIANT_PARAM, rect},
  events: ['item-<i>', 'tick-<i>'], timing: timingRules({rules: ['items enter in order from at, stagger apart; a tick lands after its item enters']}), variants: LIST_VARIANTS,
  states: {params: ['items'], items: ['item', 'tick']},
  resolve: listResolve, view: listView, timeline: listTimeline
};

export const LIST_MODULES = [itemList];
