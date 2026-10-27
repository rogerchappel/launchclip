// Catalogue I calendars: date-carousel (a row of day cards that rewinds or
// fast-forwards from one date to another under a ◀◀ REWIND sign, then
// lights the focus day and pins its event chip) and month-grid (a month of
// day cells whose chips fill in sequence over a run of days, "Codex · 28
// days", with marks on given days and legend chips). Dates are ISO
// "YYYY-MM-DD", worked out in UTC so both renderers agree. Registered
// through kit/core/catalog-i-explain.mjs.

import {timingRules} from './catalog-b-base.mjs';
import {hex2, svgRoot} from './catalog-b-view.mjs';
import {VARIANT_PARAM, createHBase, fitText, textWidth, titleBlock} from './catalog-h-base.mjs';
import {abs, chromeNodes, chromeOps, el, label, popOps, riseOps, set, tw} from './catalog-h-view.mjs';
import {DATA_TONE, dataTone} from './catalog-h-data.mjs';
import {iconNode, isIcon} from './icons.mjs';
import {AT, RECT, dayParts, glassStyle, parseDate, r2, rt} from './catalog-i-base.mjs';

const MAX_SPAN = 120;

function chipSpec(b, raw, path, {max = 24} = {}) {
  const {check} = b;
  check.obj(raw, path, ['label', 'sub', 'icon', 'tone'], ['label']);
  if (raw.icon !== undefined && !isIcon(raw.icon)) check.fail(`${path}.icon`, `is not an icon name (got ${JSON.stringify(raw.icon)})`);
  return {label: check.str(raw.label, `${path}.label`, max), sub: raw.sub === undefined ? null : check.str(raw.sub, `${path}.sub`, max), icon: raw.icon ?? null, color: dataTone(b, raw.tone, `${path}.tone`, 'accent')};
}

// ---------------------------------------------------------------------------
// date-carousel

const CAROUSEL_VARIANTS = Object.freeze(['glass', 'flat']);

function carouselResolve(params, ctx) {
  const b = createHBase('date-carousel', params, ctx, {allowed: ['start', 'focus', 'event', 'startEvent', 'caption', 'title', 'source', 'at', 'moveAt', 'focusAt'], required: ['start', 'focus'], variants: CAROUSEL_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  const startDay = parseDate(check, p.start, 'params.start'), focusDay = parseDate(check, p.focus, 'params.focus');
  if (startDay === focusDay) check.fail('params.focus', 'must differ from params.start (the carousel moves between them)');
  if (Math.abs(focusDay - startDay) > MAX_SPAN) check.fail('params.focus', `must be within ${MAX_SPAN} days of params.start`);
  const rewind = focusDay < startDay;
  const event = p.event === undefined ? null : chipSpec(b, p.event, 'params.event');
  const startEvent = p.startEvent === undefined ? null : chipSpec(b, p.startEvent, 'params.startEvent');
  const caption = p.caption === undefined ? null : check.str(p.caption, 'params.caption', 40);
  const tb = titleBlock(b, {title: p.title, source: p.source});
  const W = rect.width, H = rect.height - tb.top - tb.bottom;

  const signSize = r2(Math.max(b.min.key, u(46)));
  const captionFit = caption ? fitText(check, 'params.caption', caption, {family: 'body', width: W, preferred: u(50), min: b.min.key}) : null;
  const cardW = r2(u(b.portrait ? 250 : 240)), gap = u(28);
  const pitch = r2(cardW + gap);
  const numberSize = r2(u(b.portrait ? 120 : 116)), monthSize = r2(Math.max(b.min.meta, u(28))), daySize = r2(Math.max(b.min.meta, u(32)));
  const chipSize = r2(Math.max(b.min.meta, u(28)));
  const chips = [event, startEvent].filter(Boolean);
  chips.forEach(chip => [chip.label, chip.sub].filter(Boolean).forEach(text => {
    if (textWidth(text, chipSize, 'body') > cardW - u(24)) check.fail(`params.${chip === event ? 'event' : 'startEvent'}`, `text "${text}" is too wide for a day card at ${chipSize} px; shorten it`);
  }));
  const chipH = chips.length ? r2(chipSize * 1.25 * (chips.some(c => c.sub) ? 2 : 1) + (chips.some(c => c.icon) ? chipSize * 1.3 : 0) + u(16)) : 0;
  const cardH = r2(u(24) + monthSize * 1.3 + numberSize * 1.05 + daySize * 1.3 + (chipH ? chipH + u(14) : 0) + u(28));
  const signH = r2(signSize * 1.3 + u(40));
  const blockH = signH + cardH + u(30) + (captionFit ? u(40) + captionFit.size * 1.3 : 0);
  if (blockH > H) check.fail('params', 'does not fit the rect; drop the title or caption, or enlarge rect');
  const y0 = r2(tb.top + (H - blockH) / 2);
  const cardY = r2(y0 + signH);
  const lo = Math.min(startDay, focusDay) - 3, hi = Math.max(startDay, focusDay) + 3;
  const centerX = r2((W - cardW) / 2);
  const days = [];
  for (let d = lo; d <= hi; d++) days.push({day: d, x: r2((d - lo) * pitch), ...dayParts(d)});
  const stripX = day => r2(centerX - (day - lo) * pitch);

  // Timing: the cards land on the start date, the sign appears and the strip
  // runs to the focus date (slow, fast, slow), then the focus lights up.
  const buildAt = b.timeOf('build', p.at, 'params.at', 0.5);
  b.events.push({id: `${b.id}-build`, name: 'build', time: buildAt, endTime: rt(buildAt + 0.6), role: 'emphasis', cue: 'whoosh-soft'});
  const span = Math.abs(focusDay - startDay);
  const travel = rt(Math.min(2.4, 0.7 + 0.05 * span));
  const moveAt = b.timeOf('move', p.moveAt, 'params.moveAt', Math.min(buildAt - b.start + 0.9, b.lastEvent - travel - 0.4), {min: buildAt - b.start + 0.2});
  b.events.push({id: `${b.id}-move`, name: 'move', time: moveAt, endTime: rt(moveAt + travel), role: 'emphasis', cue: rewind ? 'rewind' : 'whoosh'});
  const focusAt = b.timeOf('focus', p.focusAt, 'params.focusAt', Math.min(b.lastEvent, moveAt - b.start + travel + 0.05), {min: moveAt - b.start + travel - 0.05});
  b.events.push({id: `${b.id}-focus`, name: 'focus', time: focusAt, endTime: rt(focusAt + 0.5), role: 'emphasis', cue: 'hit-soft'});
  const content = {variant: b.variant, title: tb.title, source: tb.source, align: 'center', rewind, days, startDay, focusDay, lo, cardW, cardH, cardY, pitch, gap, centerX,
    fromX: stripX(startDay), toX: stripX(focusDay), numberSize, monthSize, daySize, chipSize, chipH, event, startEvent,
    sign: {text: rewind ? 'REWIND' : 'FAST FORWARD', size: signSize, y: y0}, caption: captionFit ? {text: caption, size: captionFit.size, y: r2(cardY + cardH + u(40))} : null,
    buildAt, moveAt, travel, focusAt, buildEnd: rt(focusAt + 0.5), ink: b.theme.foreground, muted: b.theme.muted, accent: b.colors.accent, primary: b.colors.primary, border: b.theme.border};
  return b.finish(content, {minTextPx: Math.min(signSize, captionFit?.size ?? Infinity, tb.title ? tb.title.size : Infinity)});
}

function chipNodes(model, chip, width, size) {
  const {fonts} = model;
  const kids = [];
  let y = 0;
  if (chip.icon) { kids.push(iconNode(chip.icon, {x: r2((width - size * 1.2) / 2), y: 0, size: r2(size * 1.2), color: chip.color})); y += size * 1.3; }
  kids.push(label(null, 0, r2(y), width, chip.label, {size, family: fonts.body, color: model.theme.foreground, align: 'center', weight: 700}));
  if (chip.sub) kids.push(label(null, 0, r2(y + size * 1.25), width, chip.sub, {size, family: fonts.body, color: chip.color, align: 'center', weight: 600}));
  return kids;
}

function carouselView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const W = model.rect.width;
  const kids = chromeNodes(model);
  const glass = c.variant === 'glass';
  const card = d => {
    const inner = [
      label(null, 0, r2(24 * u), c.cardW, `${d.monthName.toUpperCase()} ${d.year}`, {size: c.monthSize, family: fonts.meta, color: c.muted, align: 'center', spacing: '0.08em'}),
      label(null, 0, r2(24 * u + c.monthSize * 1.3), c.cardW, String(d.date), {size: c.numberSize, family: fonts.display, color: c.ink, align: 'center', lineHeight: 1.05}),
      label(null, 0, r2(24 * u + c.monthSize * 1.3 + c.numberSize * 1.05), c.cardW, d.weekdayName, {size: c.daySize, family: fonts.body, color: c.muted, align: 'center', weight: 600})
    ];
    const style = glass ? glassStyle(model, c.accent, {radius: 22, glow: 0.08, fill: 0.7}) : {boxSizing: 'border-box', borderRadius: r2(18 * u), background: model.theme.panel};
    return el('div', null, {...abs(d.x, 0, c.cardW, c.cardH), ...style}, inner);
  };
  // The strip moves under a viewport that fades its edges.
  const strip = el('div', `${id}-strip`, abs(0, 0, r2(c.days.length * c.pitch), c.cardH, {transform: `translate(${c.fromX}px, 0px)`}), c.days.map(card));
  kids.push(el('div', `${id}-view`, {...abs(0, c.cardY, W, c.cardH), overflow: 'hidden', maskImage: 'linear-gradient(90deg, transparent 0%, #000 22%, #000 78%, transparent 100%)', opacity: 0}, [strip]));
  // The lens: a bright rim on the centre card, off while the strip runs.
  const lens = {boxSizing: 'border-box', borderRadius: r2(22 * u), border: `${r2(3 * u)}px solid ${c.accent}`, boxShadow: `0 0 ${r2(36 * u)}px ${hex2(c.accent, 0.55)}, inset 0 0 ${r2(24 * u)}px ${hex2(c.accent, 0.18)}`};
  kids.push(el('div', `${id}-lens`, {...abs(r2(c.centerX - 8 * u), r2(c.cardY - 8 * u), r2(c.cardW + 16 * u), r2(c.cardH + 16 * u)), ...lens, opacity: 0}));
  const chipY = r2(c.cardY + c.cardH - c.chipH - 22 * u);
  if (c.startEvent) kids.push(el('div', `${id}-schip`, abs(r2(c.centerX + 12 * u), chipY, r2(c.cardW - 24 * u), c.chipH, {opacity: 0}), chipNodes(model, c.startEvent, r2(c.cardW - 24 * u), c.chipSize)));
  if (c.event) kids.push(el('div', `${id}-chip`, abs(r2(c.centerX + 12 * u), chipY, r2(c.cardW - 24 * u), c.chipH, {opacity: 0}), chipNodes(model, c.event, r2(c.cardW - 24 * u), c.chipSize)));
  // The sign: two triangles and the word.
  const tri = r2(c.sign.size * 0.7), signW = r2(tri * 2 + 18 * u + textWidth(c.sign.text, c.sign.size, 'body', 0.12));
  const tris = c.rewind ? `M${tri} 0 L0 ${r2(tri / 2)} L${tri} ${tri} Z M${r2(tri * 2)} 0 L${tri} ${r2(tri / 2)} L${r2(tri * 2)} ${tri} Z`
    : `M0 0 L${tri} ${r2(tri / 2)} L0 ${tri} Z M${tri} 0 L${r2(tri * 2)} ${r2(tri / 2)} L${tri} ${tri} Z`;
  kids.push(el('div', `${id}-sign`, abs(r2((W - signW) / 2), c.sign.y, signW, r2(c.sign.size * 1.3), {opacity: 0}), [
    el('div', null, abs(0, r2((c.sign.size * 1.3 - tri) / 2), r2(tri * 2), tri), [svgRoot(r2(tri * 2), tri, [el('path', null, null, [], {d: tris, fill: c.accent})])]),
    label(null, r2(tri * 2 + 18 * u), 0, undefined, c.sign.text, {size: c.sign.size, family: fonts.body, color: c.ink, weight: 800, spacing: '0.12em', lineHeight: 1.3})
  ]));
  if (c.caption) kids.push(label(`${id}-caption`, 0, c.caption.y, W, c.caption.text, {size: c.caption.size, family: fonts.body, color: c.muted, align: 'center', weight: 600, extra: {opacity: 0}}));
  return kids;
}

function carouselTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  chromeOps(model, ops);
  riseOps(ops, `${id}-view`, start, c.buildAt, r2(30 * u), {duration: 0.6});
  set(ops, `${id}-strip`, start, {x: c.fromX, y: 0});
  tw(ops, `${id}-strip`, c.moveAt, c.travel, 'power3.inOut', {x: c.fromX}, {x: c.toX});
  set(ops, `${id}-lens`, start, {opacity: 0, x: 0, y: 0, scaleX: 1, scaleY: 1});
  tw(ops, `${id}-lens`, rt(c.buildAt + 0.3), 0.35, 'power2.out', {opacity: 0}, {opacity: 0.6});
  tw(ops, `${id}-lens`, rt(c.moveAt - 0.05), 0.2, 'power1.in', {opacity: 0.6}, {opacity: 0});
  tw(ops, `${id}-lens`, c.focusAt, 0.25, 'power2.out', {opacity: 0}, {opacity: 1});
  tw(ops, `${id}-lens`, c.focusAt, 0.45, 'back.out(2.2)', {scaleX: 0.94, scaleY: 0.94}, {scaleX: 1, scaleY: 1});
  if (c.startEvent) {
    riseOps(ops, `${id}-schip`, start, rt(c.buildAt + 0.4), r2(12 * u));
    tw(ops, `${id}-schip`, rt(c.moveAt - 0.1), 0.2, 'power1.in', {opacity: 1}, {opacity: 0});
  }
  if (c.event) popOps(ops, `${id}-chip`, start, rt(c.focusAt + 0.15), {from: 0.7, duration: 0.45});
  popOps(ops, `${id}-sign`, start, rt(c.moveAt - 0.2), {from: 0.8, duration: 0.35});
  tw(ops, `${id}-sign`, rt(c.moveAt + c.travel + 0.1), 0.3, 'power1.in', {opacity: 1}, {opacity: 0});
  if (c.caption) riseOps(ops, `${id}-caption`, start, rt(c.focusAt + 0.35), r2(16 * u));
}

export const dateCarousel = {
  id: 'date-carousel',
  describe: 'A row of day cards (month, date, weekday) that lands on one date, then rewinds or fast-forwards under a ◀◀ REWIND sign to another, slowing as it arrives; the focus day lights up with a glowing rim and its event chip ("GPT-6.1 released", "Day 1"), and an optional caption ("where it started") rises under it.',
  params: {start: '"YYYY-MM-DD", the day shown first', focus: `"YYYY-MM-DD", the day it lands on (within ${MAX_SPAN} days; earlier rewinds, later fast-forwards)`,
    event: `{label ≤ 24, sub? ≤ 24, icon?, tone? (${DATA_TONE})} the chip pinned on the focus day (optional)`, startEvent: '{label, sub?, icon?, tone?} a chip on the start day that clears as the strip moves (optional)',
    caption: 'string ≤ 40 under the cards after the focus (optional)', moveAt: `the move: ${AT}`, focusAt: `the focus: ${AT}`,
    title: 'string ≤ 60 (optional)', source: 'string ≤ 80 (optional)', at: `build start: ${AT}`, variant: VARIANT_PARAM, rect: RECT},
  events: ['build', 'move', 'focus'], timing: timingRules({rules: ['the move starts about 0.9 s after at and runs 0.7–2.4 s (longer for more days)', 'the focus lands as the move ends']}), variants: CAROUSEL_VARIANTS,
  resolve: carouselResolve, view: carouselView, timeline: carouselTimeline
};

// ---------------------------------------------------------------------------
// month-grid

const GRID_VARIANTS = Object.freeze(['glass', 'flat']);
const WEEK_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function gridResolve(params, ctx) {
  const b = createHBase('month-grid', params, ctx, {allowed: ['from', 'days', 'weekStart', 'tone', 'marks', 'legend', 'title', 'source', 'at', 'fillAt', 'legendAt'], required: ['from', 'days'], variants: GRID_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  const from = parseDate(check, p.from, 'params.from');
  const count = check.int(p.days, 'params.days', 1, 42);
  const weekStart = p.weekStart === undefined ? 1 : ['sun', 'mon'].indexOf(check.oneOf(p.weekStart, 'params.weekStart', ['mon', 'sun']));
  const fill = dataTone(b, p.tone, 'params.tone', 'accent');
  const tb = titleBlock(b, {title: p.title, source: p.source});
  const W = rect.width;
  const first = from - ((dayParts(from).weekday - weekStart + 7) % 7);
  const last = from + count - 1;
  const weeks = Math.ceil((last - first + 1) / 7);
  const legend = p.legend === undefined ? [] : (check.arr(p.legend, 'params.legend', 1, 3), p.legend.map((item, i) => chipSpec(b, item, `params.legend[${i}]`, {max: 28})));
  legend.forEach((item, i) => { if (item.sub) check.fail(`params.legend[${i}].sub`, 'is not supported on a legend chip'); });
  const headSize = r2(Math.max(b.min.meta, u(26)));
  const legendSize = r2(Math.max(b.min.meta, u(30)));
  const legendH = legend.length ? r2(legendSize * 1.3 + u(30)) : 0;
  const headH = r2(headSize * 1.3 + u(12));
  const gap = u(b.portrait ? 8 : 12);
  const cellW = r2((W - gap * 6) / 7);
  const avail = rect.height - tb.top - tb.bottom - headH - legendH;
  const cellH = r2(Math.min(cellW * (b.portrait ? 1.35 : 0.82), (avail - gap * (weeks - 1)) / weeks));
  if (cellH < u(84)) check.fail('params.days', `${weeks} weeks leave ${Math.round(cellH)} px rows; show fewer days, drop the title or legend, or enlarge rect`);
  const numSize = r2(Math.max(b.min.meta, Math.min(u(44), cellH * 0.36)));
  const metaSize = r2(Math.max(b.min.meta * 0.85, u(22)));
  const stackDay = b.portrait;
  const marks = p.marks === undefined ? [] : (check.arr(p.marks, 'params.marks', 1, 8), p.marks.map((m, i) => {
    check.obj(m, `params.marks[${i}]`, ['day', 'label', 'icon', 'tone'], ['day', 'label']);
    if (m.icon !== undefined && !isIcon(m.icon)) check.fail(`params.marks[${i}].icon`, `is not an icon name (got ${JSON.stringify(m.icon)})`);
    const text = check.str(m.label, `params.marks[${i}].label`, 16);
    const markSize = r2(Math.max(b.min.meta * 0.85, u(22)));
    // A label too wide for the cell leaves the icon alone (narrow portrait cells).
    const fits = textWidth(text, markSize, 'body') + (m.icon ? markSize * 1.3 : 0) <= cellW - u(14);
    if (!fits && !m.icon) check.fail(`params.marks[${i}].label`, `"${text}" is too wide for a ${Math.round(cellW)} px day cell; shorten it or give an icon`);
    return {day: check.int(m.day, `params.marks[${i}].day`, 1, count), text: fits ? text : null, icon: m.icon ?? null, color: dataTone(b, m.tone, `params.marks[${i}].tone`, 'primary'), size: markSize};
  }));
  const gridH = headH + weeks * cellH + (weeks - 1) * gap;
  const y0 = r2(tb.top + (rect.height - tb.top - tb.bottom - gridH - legendH) / 2);

  // Timing: the grid lands, then the run's days fill one after another.
  const buildAt = b.timeOf('build', p.at, 'params.at', 0.5);
  const buildEnd = rt(buildAt + 0.7);
  b.events.push({id: `${b.id}-build`, name: 'build', time: buildAt, endTime: buildEnd, role: 'emphasis', cue: 'whoosh-soft'});
  const fillAt = b.timeOf('fill', p.fillAt, 'params.fillAt', Math.min(buildEnd - b.start + 0.2, b.lastEvent - 1), {min: buildAt - b.start + 0.2});
  const room = b.lastEvent - (fillAt - b.start) - (legend.length ? 0.5 : 0.1);
  const step = rt(count > 1 ? Math.max(0.01, Math.min(0.09, Math.min(2.2, room) / (count - 1))) : 0);
  const fillEnd = rt(fillAt + step * (count - 1) + 0.3);
  b.events.push({id: `${b.id}-fill`, name: 'fill', time: fillAt, endTime: fillEnd, role: 'emphasis', cue: 'tally'});
  let legendAt = null;
  if (legend.length) {
    legendAt = b.timeOf('legend', p.legendAt, 'params.legendAt', Math.min(b.lastEvent, fillEnd - b.start), {min: fillAt - b.start});
    b.events.push({id: `${b.id}-legend`, name: 'legend', time: legendAt, endTime: rt(legendAt + 0.4), role: 'emphasis', cue: 'pop'});
  }
  const cells = [];
  for (let d = first; d < first + weeks * 7; d++) {
    const k = d - first, parts = dayParts(d);
    const n = d - from + 1, inRun = d >= from && d <= last;
    cells.push({x: r2((k % 7) * (cellW + gap)), y: r2(y0 + headH + Math.floor(k / 7) * (cellH + gap)), date: parts.date, month: d === first || parts.date === 1 ? parts.monthName : null,
      run: inRun ? n : null, time: inRun ? rt(fillAt + (n - 1) * step) : null, mark: inRun ? marks.find(m => m.day === n) ?? null : null});
  }
  const heads = Array.from({length: 7}, (_, i) => ({text: WEEK_NAMES[(weekStart + i) % 7], x: r2(i * (cellW + gap))}));
  const content = {variant: b.variant, title: tb.title, source: tb.source, cells, heads, headY: y0, headSize, cellW, cellH, numSize, metaSize, stackDay, fill, buildAt, buildEnd: fillEnd, fillAt, step, legendAt,
    legend: legend.map((item, i) => ({...item, w: r2(textWidth(item.label, legendSize, 'body') + (item.icon ? legendSize * 1.3 : 0) + u(40)), i})), legendSize, legendY: r2(y0 + gridH + u(28)),
    ink: b.theme.foreground, muted: b.theme.muted, accent: b.colors.accent, border: b.theme.border};
  return b.finish(content, {minTextPx: tb.title ? tb.title.size : b.min.key});
}

function gridView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const kids = chromeNodes(model);
  const glass = c.variant === 'glass';
  c.heads.forEach((h, i) => kids.push(label(`${id}-head-${i}`, h.x, c.headY, c.cellW, h.text, {size: c.headSize, family: fonts.meta, color: c.muted, align: 'center', spacing: '0.08em', extra: {opacity: 0}})));
  const pad = r2(10 * u);
  c.cells.forEach((cell, i) => {
    const style = glass ? glassStyle(model, c.accent, {radius: 14, glow: 0.05, fill: 0.7}) : {boxSizing: 'border-box', borderRadius: r2(12 * u), background: model.theme.panel};
    const num = cell.month ? `${cell.date} ${cell.month}` : String(cell.date);
    const inner = [label(null, pad, pad, r2(c.cellW - 2 * pad), num, {size: c.numSize, family: fonts.display, color: cell.run ? c.ink : c.muted, lineHeight: 1.1})];
    if (cell.run) {
      const dayText = `DAY ${cell.run}`;
      inner.push(c.stackDay ? label(null, pad, r2(pad + c.numSize * 1.1), r2(c.cellW - 2 * pad), dayText, {size: c.metaSize, family: fonts.meta, color: c.muted})
        : label(null, pad, r2(pad + (c.numSize - c.metaSize) * 0.55), r2(c.cellW - 2 * pad), dayText, {size: c.metaSize, family: fonts.meta, color: c.muted, align: 'right'}));
    }
    kids.push(el('div', `${id}-cell-${i}`, {...abs(cell.x, cell.y, c.cellW, c.cellH), ...style, opacity: 0}, inner));
    if (cell.run) {
      kids.push(el('div', `${id}-fill-${i}`, {...abs(cell.x, cell.y, c.cellW, c.cellH), boxSizing: 'border-box', borderRadius: r2(14 * u), background: hex2(c.fill, 0.2), border: `${r2(2 * u)}px solid ${hex2(c.fill, 0.85)}`,
        boxShadow: `0 0 ${r2(18 * u)}px ${hex2(c.fill, 0.35)}`, opacity: 0}));
    }
    if (cell.mark) {
      const m = cell.mark, h = r2(m.size * 1.35 + 8 * u), w = r2(c.cellW - 14 * u);
      const markKids = [];
      let tx = 0;
      if (m.icon) { markKids.push(iconNode(m.icon, {x: m.text ? r2(8 * u) : r2((w - m.size) / 2), y: r2((h - m.size) / 2), size: m.size, color: m.color})); tx = r2(m.size + 10 * u); }
      if (m.text) markKids.push(label(null, tx, r2((h - m.size * 1.2) / 2), r2(w - tx), m.text, {size: m.size, family: fonts.body, color: m.color, align: m.icon ? 'left' : 'center', weight: 700}));
      kids.push(el('div', `${id}-mark-${i}`, {...abs(r2(cell.x + 7 * u), r2(cell.y + c.cellH - h - 7 * u), w, h), boxSizing: 'border-box', borderRadius: r2(8 * u), background: hex2(m.color, 0.16), opacity: 0}, markKids));
    }
  });
  let lx = 0;
  c.legend.forEach((item, i) => {
    const kid = [];
    let tx = r2(16 * u);
    if (item.icon) { kid.push(iconNode(item.icon, {x: tx, y: r2(12 * u), size: c.legendSize, color: item.color})); tx = r2(tx + c.legendSize * 1.3); }
    kid.push(label(null, tx, r2(12 * u), undefined, item.label, {size: c.legendSize, family: fonts.body, color: c.ink, weight: 600}));
    kids.push(el('div', `${id}-legend-${i}`, {...abs(r2(lx), c.legendY, item.w, r2(c.legendSize * 1.2 + 24 * u)), boxSizing: 'border-box', borderRadius: 999, border: `${r2(2 * u)}px solid ${hex2(item.color, 0.6)}`, opacity: 0}, kid));
    lx += item.w + 16 * u;
  });
  return kids;
}

function gridTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  chromeOps(model, ops);
  c.heads.forEach((_, i) => riseOps(ops, `${id}-head-${i}`, start, rt(c.buildAt + i * 0.03), r2(8 * u), {duration: 0.35}));
  c.cells.forEach((cell, i) => {
    const row = Math.floor(i / 7), col = i % 7;
    set(ops, `${id}-cell-${i}`, start, {opacity: 0, x: 0, y: r2(16 * u), scaleX: 1, scaleY: 1});
    tw(ops, `${id}-cell-${i}`, rt(c.buildAt + (row + col) * 0.03), 0.4, 'power3.out', {opacity: 0, y: r2(16 * u)}, {opacity: cell.run ? 1 : 0.45, y: 0});
    if (cell.run) popOps(ops, `${id}-fill-${i}`, start, cell.time, {from: 0.85, duration: 0.3, ease: 'back.out(2)', fade: 0.12});
    if (cell.mark) popOps(ops, `${id}-mark-${i}`, start, rt(cell.time + 0.1), {from: 0.6, duration: 0.35});
  });
  c.legend.forEach((_, i) => riseOps(ops, `${id}-legend-${i}`, start, rt(c.legendAt + i * 0.1), r2(12 * u)));
}

export const monthGrid = {
  id: 'month-grid',
  describe: 'A month calendar of glass day cells (weekday header, date, "DAY n") whose cells fill one after another across a run of days ("Codex · 28 days"), with marks pinned on given days ("−50% faster", "both") and legend chips under the grid.',
  params: {from: '"YYYY-MM-DD", the run\'s first day', days: 'integer 1–42, the run\'s length (the grid shows the whole weeks around it)', weekStart: '"mon" (default) | "sun"', tone: `the fill (${DATA_TONE}; default accent)`,
    marks: `[{day (1–days), label ≤ 16, icon? (shown alone where the label is too wide for the cell), tone?}] up to 8, landing as the fill reaches them`, legend: `[{label ≤ 28, icon?, tone?}] 1–3 chips under the grid (optional; event legend)`,
    fillAt: `the fill: ${AT}`, legendAt: `the legend: ${AT}`, title: 'string ≤ 60 ("Codex · 28 days")', source: 'string ≤ 80 (optional)', at: `build start: ${AT}`, variant: VARIANT_PARAM, rect: RECT},
  events: ['build', 'fill', 'legend'], timing: timingRules({rules: ['the grid lands in 0.7 s from at; the fill runs up to 90 ms a day (2.2 s at most)', 'the legend follows the fill']}), variants: GRID_VARIANTS,
  resolve: gridResolve, view: gridView, timeline: gridTimeline
};

export const CALENDARS = [dateCarousel, monthGrid];
