// Catalogue H data-explainer modules: unit-grid (an isotype of 1–200 units
// that count in, then split into 2–3 labelled groups or light up K of them)
// and number-line (a ruler whose 1–3 ranges light up one at a time on cue,
// with an optional marker). Made for the "the study says" explainer: one
// element added or transformed per beat on a near-empty stage. The citation
// that stays under them across scenes is the brand frame's source note
// (story.frame.sources, kit/core/brand-frame.mjs), not a module. Registered
// in kit/core/catalog-h.mjs.

import {decimalsOf, niceStep, timingRules} from './catalog-b-base.mjs';
import {hex2} from './catalog-b-view.mjs';
import {VARIANT_PARAM, FORMAT_PARAM, contrastRatio, createHBase, fitText, numberFormat, r2, rt, textWidth, titleBlock, toneColor} from './catalog-h-base.mjs';
import {abs, chromeNodes, chromeOps, countOps, countSamples, el, label, popOps, riseOps, set, tw} from './catalog-h-view.mjs';
import {iconNode, isIcon} from './icons.mjs';

const at = 'seconds from scene start (optional; else a matching hit, else a default)';
const rect = '{x, y, width, height} canvas px inside the safe zone (optional)';
export const DATA_TONE = 'good | bad | neutral | primary | accent | paper | #rrggbb';
const TONES = ['good', 'bad', 'neutral', 'primary', 'accent', 'paper'];
// "bad" is a red, the first of these with 3:1 on the background (bright on
// dark brands, deep on light ones).
const BAD_REDS = ['#ff5a4e', '#e5484d', '#c9302c', '#a8221c'];
const HEX6 = /^#[0-9a-fA-F]{6}$/;

/**
 * A data tone → hex: good is the brand primary, bad a red that keeps 3:1 on
 * bg, neutral the muted text colour; brand roles and hex as toneColor.
 */
export function dataTone(b, value, path, fallback = 'primary') {
  const raw = value ?? fallback;
  if (typeof raw === 'string' && HEX6.test(raw)) return toneColor(b, raw, path);
  b.check.oneOf(raw, path, TONES);
  if (raw === 'good') return toneColor(b, 'primary', path);
  if (raw === 'neutral') return b.theme.muted;
  if (raw === 'bad') {
    const red = BAD_REDS.find(color => contrastRatio(color, b.colors.bg) >= 3);
    return red ?? b.check.fail(path, `"bad" has no red with 3:1 on ${b.colors.bg}; give a #rrggbb tone`);
  }
  return toneColor(b, raw, path);
}

/** Default event time `fallback` (scene-relative) clamped into the module's window, then timeOf. */
function cueTime(b, name, value, path, fallback, min) {
  const latest = b.lastEvent;
  return b.timeOf(name, value, path, Math.max(min, Math.min(fallback, latest)), {min: Math.max(0, min - 1e-6)});
}

// ---------------------------------------------------------------------------
// unit-grid

const UNIT_VARIANTS = Object.freeze(['solid', 'stroke', 'dots']);
export const MAX_UNITS = 200;
// The isotype person in a 24-unit box: a head and rounded shoulders.
const PERSON = 'M7.8 6.2a4.2 4.2 0 1 0 8.4 0a4.2 4.2 0 1 0 -8.4 0Z M4.6 22.4v-4.1a5.8 5.8 0 0 1 5.8-5.8h3.2a5.8 5.8 0 0 1 5.8 5.8v4.1Z';

/** Columns, rows and square cell size (≤ max) that fit n units in W × H; on a tie, more columns. */
function fitGrid(n, W, H, max, columns = null) {
  let best = null;
  for (let cols = columns ?? 1; cols <= (columns ?? n); cols++) {
    const rows = Math.ceil(n / cols);
    const cell = Math.min(W / cols, H / rows, max);
    if (!best || cell >= best.cell - 1e-9) best = {cols, rows, cell};
  }
  return {...best, cell: Math.floor(best.cell * 100) / 100};
}

function unitResolve(params, ctx) {
  const b = createHBase('unit-grid', params, ctx, {allowed: ['count', 'icon', 'title', 'source', 'tone', 'columns', 'groups', 'splitAt', 'highlight', 'highlightAt', 'at'], required: ['count'], variants: UNIT_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  if (Number.isInteger(p.count) && p.count > MAX_UNITS) check.fail('params.count', `is ${p.count}; unit-grid draws up to ${MAX_UNITS} units. For more, use cell-grid or grid-race, where one cell stands for an amount (up to 10,000 cells)`);
  const n = check.int(p.count, 'params.count', 1, MAX_UNITS);
  const icon = p.icon ?? 'person';
  if (icon !== 'person' && !isIcon(icon)) check.fail('params.icon', `must be "person" or an icon name from kit/core/icons.mjs (got ${JSON.stringify(icon)})`);
  const base = dataTone(b, p.tone, 'params.tone', 'paper');
  if (p.groups !== undefined && p.highlight !== undefined) check.fail('params.highlight', 'cannot be combined with params.groups; split into groups in one scene and light units up in another');
  let groups = null;
  if (p.groups !== undefined) {
    check.arr(p.groups, 'params.groups', 2, 3);
    const tones = ['primary', 'accent', 'paper'];
    groups = p.groups.map((g, i) => {
      check.obj(g, `params.groups[${i}]`, ['count', 'label', 'tone'], ['count', 'label']);
      return {count: check.int(g.count, `params.groups[${i}].count`, 1, n), label: check.str(g.label, `params.groups[${i}].label`, 24), color: dataTone(b, g.tone, `params.groups[${i}].tone`, tones[i])};
    });
    const sum = groups.reduce((total, g) => total + g.count, 0);
    if (sum !== n) check.fail('params.groups', `counts must add up to params.count (${n}); they add up to ${sum}`);
  }
  let highlight = null;
  if (p.highlight !== undefined) {
    if (n < 2) check.fail('params.highlight', 'needs params.count of at least 2');
    check.obj(p.highlight, 'params.highlight', ['count', 'label', 'tone'], ['count']);
    const h = p.highlight;
    highlight = {count: check.int(h.count, 'params.highlight.count', 1, n - 1), label: h.label === undefined ? null : check.str(h.label, 'params.highlight.label', 40), color: dataTone(b, h.tone, 'params.highlight.tone', 'primary')};
  }
  if (p.splitAt !== undefined && !groups) check.fail('params.splitAt', 'needs params.groups');
  if (p.highlightAt !== undefined && !highlight) check.fail('params.highlightAt', 'needs params.highlight');

  const tb = titleBlock(b, {title: p.title, source: p.source});
  const W = rect.width, top = tb.top, H = rect.height - tb.top - tb.bottom;
  const columns = p.columns === undefined ? null : check.int(p.columns, 'params.columns', 1, Math.min(25, n));
  const maxCell = u(170);
  const hlFit = highlight?.label ? fitText(check, 'params.highlight.label', highlight.label, {family: 'display', width: W, preferred: u(96), min: b.min.key}) : null;
  const hlH = hlFit ? r2(hlFit.size * 1.2 + u(28)) : 0;
  const grid = fitGrid(n, W, H - hlH, maxCell, columns);
  if (grid.cell < u(30)) check.fail('params.count', `${n} units leave ${grid.cell} px cells in this rect; use fewer units, fewer columns or drop the title`);
  const cell = grid.cell;
  const gridW = r2(grid.cols * cell), gridH = r2(grid.rows * cell);
  const x0 = r2((W - gridW) / 2), y0 = r2(top + (H - gridH - hlH) / 2);
  const units = Array.from({length: n}, (_, i) => ({x: r2(x0 + (i % grid.cols) * cell), y: r2(y0 + Math.floor(i / grid.cols) * cell)}));

  // Build: every unit pops in reading order, within about 1.1 s.
  const step = n > 1 ? Math.min(0.06, 1.1 / (n - 1)) : 0;
  const buildAt = b.timeOf('build', p.at, 'params.at', 0.5);
  const buildEnd = rt(buildAt + step * (n - 1) + 0.4);
  b.events.push({id: `${b.id}-build`, name: 'build', time: buildAt, endTime: buildEnd, role: 'emphasis', cue: 'pop'});
  units.forEach((unit, i) => { unit.time = rt(buildAt + i * step); });
  const settled = buildEnd - b.start;
  let minTextPx = tb.title ? tb.title.size : b.min.key;

  let splitAt = null, groupBlocks = null;
  if (groups) {
    const G = groups.length, gap = u(b.portrait ? 40 : 80);
    const colW = (W - gap * (G - 1)) / G;
    const numSize = Math.min(...groups.map((g, i) => fitText(check, `params.groups[${i}].count`, String(g.count), {family: 'display', width: colW, preferred: u(150), min: b.min.key}).size));
    const fits = groups.map((g, i) => fitText(check, `params.groups[${i}].label`, g.label, {family: 'body', width: colW - u(8), preferred: u(46), min: b.min.key, maxLines: 2}));
    const labelSize = Math.min(...fits.map(f => f.size));
    const labelLines = Math.max(...fits.map(f => f.lines));
    const labelBlock = r2(numSize * 1.05 + u(6) + labelSize * 1.2 * labelLines + u(30));
    const areaH = H - labelBlock;
    if (areaH < u(120)) check.fail('params.groups', 'leave too little height for the units; shorten the labels, drop the title or enlarge rect');
    const s2 = Math.min(...groups.map(g => fitGrid(g.count, colW, areaH, maxCell).cell));
    const shapes = groups.map(g => fitGrid(g.count, colW, areaH, s2));
    const blockH = labelBlock + Math.max(...shapes.map(shape => shape.rows)) * s2;
    const gTop = r2(top + (H - blockH) / 2);
    splitAt = cueTime(b, 'split', p.splitAt, 'params.splitAt', settled + 0.45, settled);
    b.events.push({id: `${b.id}-split`, name: 'split', time: splitAt, endTime: rt(splitAt + 1.1), role: 'emphasis', cue: 'whoosh'});
    const moveStep = n > 1 ? Math.min(0.012, 0.35 / (n - 1)) : 0;
    let offset = 0;
    groupBlocks = groups.map((g, gi) => {
      const colX = gi * (colW + gap);
      const shape = shapes[gi];
      const gx = colX + (colW - Math.min(g.count, shape.cols) * s2) / 2;
      for (let k = 0; k < g.count; k++) {
        const unit = units[offset + k];
        const tx = gx + (k % shape.cols) * s2, ty = gTop + labelBlock + Math.floor(k / shape.cols) * s2;
        unit.move = {at: rt(splitAt + (offset + k) * moveStep), dx: r2(tx - unit.x), dy: r2(ty - unit.y), scale: r2(s2 / cell * 1e4) / 1e4};
        if (g.color !== base) unit.recolor = {color: g.color, at: rt(unit.move.at + 0.12)};
      }
      offset += g.count;
      const numAt = rt(splitAt + 0.3 + gi * 0.12);
      return {...g, x: r2(colX), width: r2(colW), numY: gTop, labelY: r2(gTop + numSize * 1.05 + u(6)), numSize, labelSize, labelLines, numAt,
        samples: countSamples(b.model, numAt, 0.7, 'power2.out', 0, g.count, v => String(Math.round(v)))};
    });
    minTextPx = Math.min(minTextPx, numSize, labelSize);
  }

  let highlightAt = null;
  if (highlight) {
    highlightAt = cueTime(b, 'highlight', p.highlightAt, 'params.highlightAt', settled + 0.4, settled);
    b.events.push({id: `${b.id}-highlight`, name: 'highlight', time: highlightAt, endTime: rt(highlightAt + 0.6), role: 'emphasis', cue: 'hit-soft'});
    const lit = Math.min(0.05, 0.4 / highlight.count);
    units.forEach((unit, i) => {
      if (i < highlight.count) { unit.recolor = {color: highlight.color, at: rt(highlightAt + i * lit)}; unit.pulse = unit.recolor.at; }
      else unit.dim = highlightAt;
    });
    if (hlFit) {
      highlight.size = hlFit.size;
      highlight.y = r2(y0 + gridH + u(28));
      minTextPx = Math.min(minTextPx, hlFit.size);
    }
  }

  const content = {variant: b.variant, icon, title: tb.title, source: tb.source, align: 'center', cell, iconSize: r2(cell * (b.variant === 'dots' ? 0.62 : 0.82)), base, units,
    groups: groupBlocks, splitAt, highlight, highlightAt, buildAt, buildEnd, ink: b.theme.foreground};
  return b.finish(content, {minTextPx});
}

/** One unit's shape (a person, an icon or a dot) in `color`, centred in its cell. */
function unitShape(c, color, id = null, extra = {}) {
  const size = c.iconSize, pad = r2((c.cell - size) / 2);
  if (c.variant === 'dots') return el('div', id, abs(pad, pad, size, size, {borderRadius: '50%', background: color, ...extra}));
  if (c.icon === 'person') {
    const solid = c.variant === 'solid';
    return el('svg', id, {position: 'absolute', left: pad, top: pad, width: size, height: size, overflow: 'visible', ...extra},
      [el('path', null, null, [], {d: PERSON, fill: solid ? color : 'none', stroke: solid ? 'none' : color, strokeWidth: 1.7, strokeLinejoin: 'round'})], {width: size, height: size, viewBox: '0 0 24 24', fill: 'none'});
  }
  return iconNode(c.icon, {id, x: pad, y: pad, size, color, mode: c.variant === 'solid' ? 'duotone' : 'stroke', tintOpacity: 1, style: extra});
}

function unitView(model) {
  const {id, fonts} = model;
  const c = model.content;
  const kids = chromeNodes(model);
  c.units.forEach((unit, i) => {
    const inner = [unitShape(c, c.base)];
    if (unit.recolor) inner.push(unitShape(c, unit.recolor.color, `${id}-uc-${i}`, {opacity: 0}));
    kids.push(el('div', `${id}-u-${i}`, abs(unit.x, unit.y, c.cell, c.cell, {transformOrigin: '0% 0%'}),
      [el('div', `${id}-ui-${i}`, abs(0, 0, c.cell, c.cell, {opacity: 0, transformOrigin: '50% 50%'}), inner)]));
  });
  for (const [g, group] of (c.groups ?? []).entries()) {
    kids.push(label(`${id}-gn-${g}`, group.x, group.numY, group.width, '0', {size: group.numSize, family: fonts.display, color: group.color, align: 'center', lineHeight: 1.05, extra: {opacity: 0}}));
    kids.push(label(`${id}-gl-${g}`, group.x, group.labelY, group.width, group.label, {size: group.labelSize, family: fonts.body, color: c.ink, align: 'center', weight: 650, wrap: group.labelLines > 1, extra: {opacity: 0}}));
  }
  if (c.highlight?.label) kids.push(label(`${id}-hl`, 0, c.highlight.y, model.rect.width, c.highlight.label, {size: c.highlight.size, family: fonts.display, color: c.highlight.color, align: 'center', extra: {opacity: 0}}));
  return kids;
}

function unitTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  chromeOps(model, ops);
  const still = {x: 0, y: 0, scaleX: 1, scaleY: 1};
  c.units.forEach((unit, i) => {
    const inner = `${id}-ui-${i}`;
    popOps(ops, inner, start, unit.time, {from: 0.3, duration: 0.4, ease: 'back.out(2.2)'});
    if (unit.move) {
      set(ops, `${id}-u-${i}`, start, still);
      tw(ops, `${id}-u-${i}`, unit.move.at, 0.75, 'power3.inOut', still, {x: unit.move.dx, y: unit.move.dy, scaleX: unit.move.scale, scaleY: unit.move.scale});
    }
    if (unit.recolor) {
      set(ops, `${id}-uc-${i}`, start, {opacity: 0});
      tw(ops, `${id}-uc-${i}`, unit.recolor.at, 0.35, 'power1.out', {opacity: 0}, {opacity: 1});
    }
    if (unit.pulse !== undefined) {
      tw(ops, inner, unit.pulse, 0.16, 'power2.out', {scaleX: 1, scaleY: 1}, {scaleX: 1.18, scaleY: 1.18});
      tw(ops, inner, rt(unit.pulse + 0.16), 0.3, 'power2.inOut', {scaleX: 1.18, scaleY: 1.18}, {scaleX: 1, scaleY: 1});
    }
    if (unit.dim !== undefined) tw(ops, inner, unit.dim, 0.4, 'power2.out', {opacity: 1}, {opacity: 0.28});
  });
  for (const [g, group] of (c.groups ?? []).entries()) {
    riseOps(ops, `${id}-gn-${g}`, start, group.numAt, r2(24 * u));
    countOps(ops, `${id}-gn-${g}`, start, '0', group.samples);
    riseOps(ops, `${id}-gl-${g}`, start, rt(group.numAt + 0.15), r2(16 * u));
  }
  if (c.highlight?.label) riseOps(ops, `${id}-hl`, start, rt(c.highlightAt + 0.2), r2(20 * u));
}

export const unitGrid = {
  id: 'unit-grid',
  describe: `An isotype: 1–${MAX_UNITS} units (a person by default, or any icon) that count in as a grid, then split into 2–3 labelled groups that slide apart and recolour ("49 lifters → 24 heavy, 25 light"), or light up a few and dim the rest ("1 in 10").`,
  params: {count: `integer 1–${MAX_UNITS}, the number of units`, icon: '"person" (default) or an icon name from the icon set', groups: `[{count, label ≤ 24, tone? (${DATA_TONE})}] 2–3, counts adding up to count (optional; not with highlight)`,
    splitAt: `the split: ${at}`, highlight: `{count (1 to count − 1), label? ≤ 40, tone?} the first count units light up (optional)`, highlightAt: `the highlight: ${at}`,
    tone: `the units before the split: ${DATA_TONE} (default paper)`, columns: 'integer 1–25 (default: the largest units that fit)', title: 'string ≤ 60 (optional)', source: 'string ≤ 80, where the numbers come from (optional; a story-wide source note is frame.sources)',
    at: `build start: ${at}`, variant: VARIANT_PARAM, rect},
  events: ['build', 'split', 'highlight'], timing: timingRules({rules: ['units pop in reading order within about 1.1 s from at', 'split or highlight comes after the build (default 0.45 s after it)']}), variants: UNIT_VARIANTS,
  resolve: unitResolve, view: unitView, timeline: unitTimeline
};

// ---------------------------------------------------------------------------
// number-line

const LINE_VARIANTS = Object.freeze(['ruler', 'track']);
const EVERY = [1, 2, 4, 5, 10, 20, 25, 50, 100];

function lineResolve(params, ctx) {
  const b = createHBase('number-line', params, ctx, {allowed: ['from', 'to', 'step', 'labelEvery', 'ranges', 'marker', 'title', 'source', 'unit', 'format', 'at'], required: ['from', 'to', 'ranges'], variants: LINE_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  const lo = check.num(p.from, 'params.from', -1e9, 1e9), hi = check.num(p.to, 'params.to', -1e9, 1e9);
  if (!(hi > lo)) check.fail('params.to', `must be greater than params.from (${lo})`);
  const span = hi - lo;
  const step = p.step === undefined ? niceStep(span, 25) : check.num(p.step, 'params.step', span / 100, span / 2);
  const count = Math.floor(span / step + 1e-6);
  const fmt = numberFormat(check, p.format, 'params.format', {decimals: Math.max(decimalsOf(lo), decimalsOf(step))});
  const values = Array.from({length: count + 1}, (_, k) => Number((lo + k * step).toFixed(6)));
  const W = rect.width;

  check.arr(p.ranges, 'params.ranges', 1, 3);
  const tones = ['primary', 'accent', 'paper'];
  const ranges = p.ranges.map((r, i) => {
    const path = `params.ranges[${i}]`;
    check.obj(r, path, ['from', 'to', 'label', 'tone', 'at'], ['from', 'to', 'label']);
    const from = check.num(r.from, `${path}.from`, lo, hi), to = check.num(r.to, `${path}.to`, lo, hi);
    if (!(to > from)) check.fail(`${path}.to`, `must be greater than ${path}.from (${from})`);
    return {from, to, text: check.str(r.label, `${path}.label`, 28), color: dataTone(b, r.tone, `${path}.tone`, tones[i]), at: r.at};
  });
  ranges.forEach((a, i) => ranges.slice(i + 1).forEach((c, j) => {
    if (a.from < c.to && c.from < a.to) check.fail(`params.ranges[${i + j + 1}]`, `overlaps params.ranges[${i}] (${a.from}–${a.to})`);
  }));
  let marker = null;
  if (p.marker !== undefined) {
    check.obj(p.marker, 'params.marker', ['value', 'label', 'tone', 'at'], ['value']);
    marker = {value: check.num(p.marker.value, 'params.marker.value', lo, hi), text: p.marker.label === undefined ? null : check.str(p.marker.label, 'params.marker.label', 24), color: dataTone(b, p.marker.tone, 'params.marker.tone', 'paper'), at: p.marker.at};
  }
  const unit = p.unit === undefined ? null : check.str(p.unit, 'params.unit', 12);
  const tb = titleBlock(b, {title: p.title, source: p.source});

  // Tick labels: one size; every labelEvery-th tick, plus each range's ends.
  const tickSize = r2(Math.max(b.min.meta, u(44)));
  const texts = values.map(v => fmt.format(v));
  const labelW = Math.max(...texts.map(t => textWidth(t, tickSize, 'display')));
  const pad = r2(labelW / 2 + u(8));
  const spacing = (W - 2 * pad) / span * step;
  const xOf = v => r2(pad + (v - lo) / span * (W - 2 * pad));
  const every = p.labelEvery === undefined ? (EVERY.find(k => k * spacing >= labelW + u(14)) ?? count) : check.int(p.labelEvery, 'params.labelEvery', 1, count);
  const near = v => values.findIndex(x => Math.abs(x - v) < step * 1e-3);
  const wanted = [...new Set([...ranges.flatMap(r => [near(r.from), near(r.to)]).filter(k => k >= 0), ...values.map((_, k) => k).filter(k => k % every === 0)])];
  const labelled = [];
  for (const k of wanted) if (!labelled.some(j => Math.abs(xOf(values[j]) - xOf(values[k])) < labelW + u(8))) labelled.push(k);
  labelled.sort((a, c) => a - c);

  // Range labels in up to three rows above the line, so neighbours never collide.
  const rangeSize = Math.min(...ranges.map((r, i) => fitText(check, `params.ranges[${i}].label`, r.text, {family: 'display', width: W, preferred: u(b.portrait ? 84 : 72), min: b.min.key}).size));
  const rows = [];
  ranges.map((r, i) => ({r, i})).sort((a, c) => a.r.from - c.r.from).forEach(({r}) => {
    const w = textWidth(r.text, rangeSize, 'display') + u(8);
    const left = r2(Math.min(Math.max(0, (xOf(r.from) + xOf(r.to)) / 2 - w / 2), W - w));
    let row = rows.findIndex(list => list.every(o => left >= o.right + u(24) || left + w <= o.left - u(24)));
    if (row < 0) { rows.push([]); row = rows.length - 1; }
    rows[row].push({left, right: left + w});
    Object.assign(r, {labelX: left, labelW: r2(w), row});
  });
  const rowH = r2(rangeSize * 1.2 + u(10));
  const track = b.variant === 'track';
  const major = u(track ? 34 : 56), minor = u(track ? 34 : 30);
  const markerH = marker ? u(34) : 0;
  const markerSize = marker?.text ? r2(Math.max(b.min.key, u(46))) : 0;
  const unitSize = unit ? r2(Math.max(b.min.meta, u(30))) : 0;
  const blockH = rows.length * rowH + u(22) + markerH + major + u(16) + tickSize * 1.2 + (markerSize ? u(24) + markerSize * 1.2 : 0) + (unitSize ? u(14) + unitSize * 1.3 : 0);
  const avail = rect.height - tb.top - tb.bottom;
  if (blockH > avail) check.fail('params', 'does not fit the rect; drop the title, shorten the range labels or enlarge rect');
  const y0 = r2(tb.top + (avail - blockH) / 2);
  ranges.forEach(r => { r.labelY = r2(y0 + r.row * rowH); });
  const lineY = r2(y0 + rows.length * rowH + u(22) + markerH + major);
  const tickY = r2(lineY + u(16));
  const zoneTop = r2(lineY - major - u(14)), zoneBottom = r2(tickY + tickSize * 1.2 + u(10));
  const half = Math.min(spacing / 2, labelW / 2 + u(10));

  // Timing: the ruler draws, then each range (and the marker) on its own cue.
  const buildAt = b.timeOf('build', p.at, 'params.at', 0.5);
  const tickStep = Math.min(0.03, 0.5 / Math.max(1, count));
  const buildEnd = rt(buildAt + 0.15 + tickStep * count + 0.35);
  b.events.push({id: `${b.id}-build`, name: 'build', time: buildAt, endTime: buildEnd, role: 'emphasis', cue: 'whoosh-soft'});
  const settled = buildEnd - b.start;
  const cues = ranges.length + (marker ? 1 : 0);
  const first = settled + 0.35, last = Math.max(first, b.lastEvent - 0.25);
  const gap = cues > 1 ? Math.min(1, (last - first) / (cues - 1)) : 0;
  ranges.forEach((r, i) => {
    r.time = cueTime(b, `range-${i}`, r.at, `params.ranges[${i}].at`, first + i * gap, settled);
    b.events.push({id: `${b.id}-range-${i}`, name: `range-${i}`, time: r.time, endTime: rt(r.time + 0.6), role: 'emphasis', cue: 'hit-soft'});
    r.x0 = xOf(r.from); r.x1 = xOf(r.to);
    r.zone = {x: r2(r.x0 - half), width: r2(r.x1 - r.x0 + 2 * half)};
    r.ticks = labelled.filter(k => values[k] >= r.from - 1e-9 && values[k] <= r.to + 1e-9);
    delete r.at;
  });
  if (marker) {
    marker.time = cueTime(b, 'marker', marker.at, 'params.marker.at', first + ranges.length * gap, settled);
    b.events.push({id: `${b.id}-marker`, name: 'marker', time: marker.time, endTime: rt(marker.time + 0.5), role: 'emphasis', cue: 'pop'});
    marker.x = xOf(marker.value);
    marker.top = r2(lineY - major - markerH);
    marker.labelY = r2(tickY + tickSize * 1.2 + u(24));
    marker.size = markerSize;
    delete marker.at;
  }
  const ticks = values.map((v, k) => ({x: xOf(v), major: k % every === 0 || labelled.includes(k), time: rt(buildAt + 0.15 + k * tickStep)}));
  const content = {variant: b.variant, title: tb.title, source: tb.source, align: 'center', lineY, tickY, tickSize, labelW: r2(labelW), pad, major, minor, zoneTop, zoneBottom,
    ticks, tickLabels: labelled.map(k => ({k, x: xOf(values[k]), text: texts[k]})), ranges, rangeSize, marker,
    unit: unit ? {text: unit, size: unitSize, y: r2(marker?.text ? marker.labelY + markerSize * 1.2 + u(14) : tickY + tickSize * 1.2 + u(14))} : null,
    buildAt, buildEnd, ink: b.theme.foreground, muted: b.theme.muted, border: b.theme.border};
  return b.finish(content, {minTextPx: Math.min(rangeSize, markerSize || Infinity, tb.title ? tb.title.size : Infinity)});
}

function lineView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const W = model.rect.width;
  const kids = chromeNodes(model);
  const track = c.variant === 'track';
  c.ranges.forEach((r, i) => kids.push(el('div', `${id}-zone-${i}`, abs(r.zone.x, c.zoneTop, r.zone.width, r2(c.zoneBottom - c.zoneTop), {background: hex2(r.color, 0.16), borderRadius: r2(16 * u), clipPath: 'inset(0% 100% 0% 0%)'}))));
  const lineH = r2((track ? 22 : 6) * u);
  kids.push(el('div', `${id}-line`, abs(c.pad, r2(c.lineY - lineH / 2), r2(W - 2 * c.pad), lineH, {background: track ? c.border : c.ink, borderRadius: lineH, transform: 'scale(0, 1)', transformOrigin: '0% 50%'})));
  c.ticks.forEach((tick, k) => {
    if (track) {
      const d = r2((tick.major ? 12 : 8) * u);
      kids.push(el('div', `${id}-tick-${k}`, abs(r2(tick.x - d / 2), r2(c.lineY - d / 2), d, d, {borderRadius: '50%', background: tick.major ? c.ink : c.muted, opacity: 0})));
    } else {
      const h = tick.major ? c.major : c.minor, w = r2((tick.major ? 4 : 3) * u);
      kids.push(el('div', `${id}-tick-${k}`, abs(r2(tick.x - w / 2), r2(c.lineY - h), w, h, {background: tick.major ? c.ink : c.muted, opacity: 0, transformOrigin: '50% 100%'})));
    }
  });
  const bandH = r2((track ? 30 : 14) * u);
  c.ranges.forEach((r, i) => kids.push(el('div', `${id}-band-${i}`, abs(r.x0, r2(c.lineY - bandH / 2), r2(r.x1 - r.x0), bandH, {background: r.color, borderRadius: bandH, transform: 'scale(0, 1)', transformOrigin: '0% 50%'}))));
  const box = r2(c.labelW + 20 * u);
  const tickLabel = (target, t, color) => label(target, r2(t.x - box / 2), c.tickY, box, t.text, {size: c.tickSize, family: fonts.display, color, align: 'center', extra: {opacity: 0}});
  for (const t of c.tickLabels) kids.push(tickLabel(`${id}-tl-${t.k}`, t, c.muted));
  c.ranges.forEach((r, i) => {
    for (const k of r.ticks) kids.push(tickLabel(`${id}-tl-${k}-r${i}`, c.tickLabels.find(t => t.k === k), r.color));
    kids.push(label(`${id}-rl-${i}`, r.labelX, r.labelY, r.labelW, r.text, {size: c.rangeSize, family: fonts.display, color: r.color, align: 'center', extra: {opacity: 0}}));
  });
  if (c.marker) {
    const m = c.marker, w = r2(6 * u), head = r2(28 * u), bottom = r2(c.lineY + 12 * u);
    kids.push(el('div', `${id}-marker`, abs(r2(m.x - head / 2), m.top, head, r2(bottom - m.top), {opacity: 0}), [
      el('div', null, abs(r2((head - w) / 2), r2(head / 2), w, r2(bottom - m.top - head / 2), {background: m.color, borderRadius: w})),
      el('div', null, abs(0, 0, head, head, {borderRadius: '50%', background: m.color, boxShadow: `0 0 0 ${r2(6 * u)}px ${hex2(m.color, 0.25)}`}))
    ]));
    if (m.text) {
      const w2 = r2(Math.min(W, textWidth(m.text, m.size, 'body') + 24 * u));
      kids.push(label(`${id}-ml`, r2(Math.min(Math.max(0, m.x - w2 / 2), W - w2)), m.labelY, w2, m.text, {size: m.size, family: fonts.body, color: m.color, align: 'center', weight: 700, extra: {opacity: 0}}));
    }
  }
  if (c.unit) kids.push(label(`${id}-unit`, 0, c.unit.y, r2(W - c.pad + c.labelW / 2), c.unit.text, {size: c.unit.size, family: fonts.meta, color: c.muted, align: 'right', spacing: '0.08em', extra: {opacity: 0}}));
  return kids;
}

function lineTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  chromeOps(model, ops);
  set(ops, `${id}-line`, start, {x: 0, y: 0, scaleX: 0, scaleY: 1});
  tw(ops, `${id}-line`, c.buildAt, 0.6, 'power3.out', {scaleX: 0}, {scaleX: 1});
  c.ticks.forEach((tick, k) => popOps(ops, `${id}-tick-${k}`, start, tick.time, {from: 0.2, duration: 0.35, ease: 'back.out(2)'}));
  for (const t of c.tickLabels) riseOps(ops, `${id}-tl-${t.k}`, start, rt(c.ticks[t.k].time + 0.05), r2(10 * u), {duration: 0.35});
  if (c.unit) riseOps(ops, `${id}-unit`, start, rt(c.buildEnd - 0.2), r2(10 * u));
  c.ranges.forEach((r, i) => {
    set(ops, `${id}-zone-${i}`, start, {opacity: 0, clipT: 0, clipR: 100, clipB: 0, clipL: 0});
    tw(ops, `${id}-zone-${i}`, r.time, 0.45, 'power2.out', {opacity: 0, clipT: 0, clipR: 100, clipB: 0, clipL: 0}, {opacity: 1, clipT: 0, clipR: 0, clipB: 0, clipL: 0});
    set(ops, `${id}-band-${i}`, start, {x: 0, y: 0, scaleX: 0, scaleY: 1});
    tw(ops, `${id}-band-${i}`, r.time, 0.45, 'power3.out', {scaleX: 0}, {scaleX: 1});
    for (const k of r.ticks) {
      set(ops, `${id}-tl-${k}-r${i}`, start, {opacity: 0});
      tw(ops, `${id}-tl-${k}-r${i}`, rt(r.time + 0.15), 0.3, 'power1.out', {opacity: 0}, {opacity: 1});
    }
    riseOps(ops, `${id}-rl-${i}`, start, rt(r.time + 0.12), r2(22 * u));
  });
  if (c.marker) {
    riseOps(ops, `${id}-marker`, start, c.marker.time, r2(-60 * u), {duration: 0.5, ease: 'back.out(1.8)'});
    if (c.marker.text) riseOps(ops, `${id}-ml`, start, rt(c.marker.time + 0.15), r2(14 * u));
  }
}

export const numberLine = {
  id: 'number-line',
  describe: 'A ruler over a range (1–25 reps, 0–100%) with 1–3 highlighted ranges, each with its label and tone ("8–12 = SIZE" in gold, "15+ = JUST CARDIO" in red), that light up one at a time on their cues, and an optional marker that drops onto a value.',
  params: {from: 'number, the start of the line', to: 'number > from, the end', step: 'tick spacing (optional; default a round step for about 25 ticks, at most 100)', labelEvery: 'integer: label every n-th tick (optional; default the closest that fits; range ends are always labelled)',
    ranges: `[{from, to, label ≤ 28, tone? (${DATA_TONE}), at?}] 1–3, inside the line, not overlapping; each lights up on its own cue (event range-<i>)`,
    marker: `{value, label? ≤ 24, tone?, at?} a pin that drops onto one value (optional; event marker)`, unit: 'string ≤ 12 under the line\'s end ("reps") (optional)', format: FORMAT_PARAM,
    title: 'string ≤ 60 (optional)', source: 'string ≤ 80 (optional; a story-wide source note is frame.sources)', at: `build start: ${at}`, variant: VARIANT_PARAM, rect},
  events: ['build', 'range-0', 'range-1', 'range-2', 'marker'], timing: timingRules({rules: ['the ruler draws in about 1 s from at', 'ranges (then the marker) follow the build, up to 1 s apart by default']}), variants: LINE_VARIANTS,
  resolve: lineResolve, view: lineView, timeline: lineTimeline
};

export const DATA_MODULES = [unitGrid, numberLine];
