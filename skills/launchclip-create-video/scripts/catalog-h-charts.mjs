// Catalogue H charts: bar-chart, stacked-bar, pie-chart, area-chart,
// scatter-plot, radar-chart, sparkline and progress-ring. Each animates its
// build from params data; registered in kit/core/catalog-h.mjs.

import {decimalsOf, timingRules} from './catalog-b-base.mjs';
import {svgRoot, transformString} from './catalog-b-view.mjs';
import {VARIANT_PARAM, FORMAT_PARAM, clip, createHBase, dataRows, fitText, inkOn, mixColor, numberFormat, r2, rt, stagger, textWidth, titleBlock, toneColor} from './catalog-h-base.mjs';
import {abs, arcPath, chromeNodes, chromeOps, countOps, countSamples, drawOps, el, fadeOps, gridNodes, gridOps, label, popOps, riseOps, set, strokePath, tw} from './catalog-h-view.mjs';

const at = 'seconds from scene start (optional; else a matching hit, else a default)';
const rect = '{x, y, width, height} canvas px inside the safe zone (optional)';
const COMMON = {title: 'string ≤ 60 (optional)', source: 'string ≤ 80, where the numbers come from (optional)', at: `build start: ${at}`, variant: VARIANT_PARAM, rect};
const tone = 'primary | accent | paper | #rrggbb';
const TIMING = timingRules({rules: ['the build runs about 1.2–1.6 s from at; highlight.at comes after the build']});

/** Build start (event "build") and an optional highlight event after the build. */
function buildTimes(b, p, buildSpan, {highlight = false} = {}) {
  const buildAt = b.timeOf('build', p.at, 'params.at', 0.5);
  const buildEnd = rt(Math.min(buildAt + buildSpan, b.start + b.lastEvent));
  b.events.push({id: `${b.id}-build`, name: 'build', time: buildAt, endTime: buildEnd, role: 'emphasis', cue: 'tally'});
  let highlightAt = null;
  if (highlight) {
    highlightAt = b.timeOf('highlight', p.highlightAt, 'params.highlightAt', Math.min(b.lastEvent, buildEnd - b.start + 0.35), {min: buildEnd - b.start - 1e-6});
    b.events.push({id: `${b.id}-highlight`, name: 'highlight', time: highlightAt, endTime: rt(highlightAt + 0.4), role: 'emphasis', cue: 'hit-soft'});
  }
  return {buildAt, buildEnd, highlightAt};
}

const highlightIndex = (b, value, count) => (value === undefined ? null : b.check.int(value, 'params.highlight', 0, count - 1));
const maxDecimals = values => Math.max(0, ...values.map(decimalsOf));

// ---------------------------------------------------------------------------
// bar-chart

const BAR_VARIANTS = Object.freeze(['columns', 'bars', 'lollipop', 'blocks']);

function barResolve(params, ctx) {
  const b = createHBase('bar-chart', params, ctx, {allowed: ['data', 'title', 'source', 'format', 'at', 'highlight', 'highlightAt', 'max', 'tone'], required: ['data'], variants: BAR_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  const rows = dataRows(b, p.data, 'params.data', {min: 2, max: 10});
  const fmt = numberFormat(check, p.format, 'params.format', {decimals: maxDecimals(rows.map(r => r.value))});
  const base = toneColor(b, p.tone, 'params.tone');
  const peak = Math.max(...rows.map(r => r.value));
  const max = p.max === undefined ? peak : check.num(p.max, 'params.max', peak, 1e12);
  if (!(max > 0)) check.fail('params.data', 'needs at least one value above 0');
  const highlight = highlightIndex(b, p.highlight, rows.length);
  const tb = titleBlock(b, {title: p.title, source: p.source});
  const W = rect.width, plotTop = tb.top, plotBottom = rect.height - tb.bottom;
  const n = rows.length;
  const texts = rows.map(r => fmt.format(r.value));
  const wantVertical = b.variant === 'columns' || b.variant === 'blocks';
  // Columns: labels fit their slot (two lines at most), or the chart turns sideways.
  let layout = 'horizontal', labelSize = 0, valueSize = 0;
  if (wantVertical) {
    const slot = W / n;
    try {
      labelSize = Math.min(...rows.map((r, i) => fitText(check, `params.data[${i}].label`, r.label, {family: 'body', width: slot - u(12), preferred: u(38), min: b.min.meta, maxLines: 2}).size));
      valueSize = Math.min(...texts.map((t, i) => fitText(check, `params.data[${i}].value`, t, {family: 'display', width: slot - u(8), preferred: u(62), min: b.min.meta}).size));
      layout = 'vertical';
    } catch { layout = 'horizontal'; }
  }
  const colors = rows.map(r => r.color ?? base);
  const bars = [];
  if (layout === 'vertical') {
    const slot = W / n, labelBlock = r2(labelSize * 1.2 * 2 + u(18));
    const top = r2(plotTop + valueSize * 1.25 + u(10)), bottom = r2(plotBottom - labelBlock);
    if (bottom - top < u(260)) check.fail('params', 'leaves too little height for the bars; drop the title or enlarge rect');
    const barW = r2(Math.min(slot * (b.variant === 'blocks' ? 0.7 : 0.62), u(150)));
    rows.forEach((r, i) => {
      const h = r2(Math.max(u(6), (bottom - top) * r.value / max));
      const x = r2(slot * i + (slot - barW) / 2);
      bars.push({x, y: r2(bottom - h), width: barW, height: h, color: colors[i], label: {text: r.label, x: r2(slot * i + u(6)), y: r2(bottom + u(16)), width: r2(slot - u(12)), size: labelSize},
        value: {x: r2(slot * i), y: r2(bottom - h - valueSize * 1.2 - u(4)), width: r2(slot), size: valueSize, text: texts[i], travel: h}});
    });
    bars.plot = {x: 0, y: top, width: W, height: r2(bottom - top)};
  } else {
    const valueW = Math.max(...texts.map(t => textWidth(t, u(44), 'display')));
    const labelLeft = !b.portrait;
    const rowH = r2(Math.min(u(150), (plotBottom - plotTop) / n));
    labelSize = Math.min(...rows.map((r, i) => fitText(check, `params.data[${i}].label`, r.label, {family: 'body', width: labelLeft ? W * 0.28 : W - valueW - u(20), preferred: u(labelLeft ? 38 : 32), min: b.min.meta}).size));
    valueSize = r2(Math.max(b.min.meta, Math.min(u(48), rowH * 0.42)));
    if (!labelLeft && rowH < labelSize * 1.25 + u(30)) check.fail('params.data', 'has too many rows for the height; use fewer bars or enlarge rect');
    const thick = r2(Math.max(u(14), Math.min(u(64), labelLeft ? rowH * 0.56 : rowH - labelSize * 1.25 - u(18))));
    const x0 = labelLeft ? r2(W * 0.3) : 0, maxLen = r2(W - x0 - textWidth(texts.reduce((a, t) => (t.length > a.length ? t : a), ''), valueSize, 'display') - u(20));
    const totalH = rowH * n, y0 = r2(plotTop + Math.max(0, (plotBottom - plotTop - totalH) / 2));
    rows.forEach((r, i) => {
      const len = r2(Math.max(u(8), maxLen * r.value / max));
      const rowY = y0 + rowH * i;
      const barY = r2(labelLeft ? rowY + (rowH - thick) / 2 : rowY + labelSize * 1.25 + u(8));
      bars.push({x: x0, y: barY, width: len, height: thick, color: colors[i],
        label: labelLeft ? {text: r.label, x: 0, y: r2(barY + thick / 2 - labelSize * 0.6), width: r2(W * 0.28), size: labelSize, align: 'right'} : {text: r.label, x: 0, y: r2(rowY), width: W, size: labelSize},
        value: {x: r2(x0 + len + u(14)), y: r2(barY + thick / 2 - valueSize * 0.6), width: r2(W - x0 - len - u(14)), size: valueSize, text: texts[i], travel: len}});
    });
  }
  const {buildAt, buildEnd, highlightAt} = buildTimes(b, p, 1.5, {highlight: highlight !== null});
  const starts = stagger(buildAt, n, 0.7, 0.09);
  bars.forEach((bar, i) => {
    bar.time = starts[i];
    bar.duration = 0.75;
    bar.samples = countSamples(b.model, bar.time, bar.duration, 'power3.out', 0, rows[i].value, fmt.format);
    bar.initial = fmt.format(0);
  });
  const content = {variant: b.variant, layout, title: tb.title, source: tb.source, bars, plot: bars.plot ?? null, highlight, highlightAt, buildAt, buildEnd,
    grid: layout === 'vertical' ? [0.25, 0.5, 0.75, 1] : [], gridColor: b.theme.border, labelColor: b.theme.muted, ink: b.theme.foreground};
  return b.finish(content, {minTextPx: tb.title ? tb.title.size : b.min.key});
}

function barView(model) {
  const {id, theme, fonts, unit: u} = model;
  const c = model.content;
  const kids = chromeNodes(model);
  const vertical = c.layout === 'vertical';
  if (c.plot) kids.push(...gridNodes(id, c.plot, c.grid, c.gridColor, u));
  c.bars.forEach((bar, i) => {
    const lollipop = c.variant === 'lollipop';
    const blocks = c.variant === 'blocks';
    const radius = lollipop ? 99 : vertical ? `${r2(Math.min(bar.width / 2, 14 * u))}px ${r2(Math.min(bar.width / 2, 14 * u))}px 0 0` : `0 ${r2(Math.min(bar.height / 2, 14 * u))}px ${r2(Math.min(bar.height / 2, 14 * u))}px 0`;
    const step = r2(26 * u), gap = r2(6 * u);
    const fill = blocks ? `repeating-linear-gradient(${vertical ? '0deg' : '90deg'}, ${bar.color} 0px, ${bar.color} ${step}px, transparent ${step}px, transparent ${step + gap}px)` : bar.color;
    const geometry = lollipop ? abs(bar.x, r2(bar.y + bar.height / 2 - 3 * u), bar.width, r2(6 * u)) : abs(bar.x, bar.y, bar.width, bar.height);
    const initial = blocks ? {clipPath: vertical ? 'inset(100% 0% 0% 0%)' : 'inset(0% 100% 0% 0%)'} : {transform: transformString(vertical ? {scaleY: 0} : {scaleX: 0}), transformOrigin: vertical ? '50% 100%' : '0% 50%'};
    kids.push(el('div', `${id}-bar-${i}`, {...geometry, background: fill, borderRadius: blocks ? 0 : radius, ...initial}));
    if (lollipop) {
      const d = r2(Math.max(bar.height, 26 * u));
      kids.push(el('div', `${id}-dot-${i}`, abs(r2(bar.x + bar.width - d / 2), r2(bar.y + bar.height / 2 - d / 2), d, d, {borderRadius: '50%', background: bar.color, boxShadow: `0 0 0 ${r2(6 * u)}px ${bar.color}33`, opacity: 0})));
    }
    const L = bar.label;
    kids.push(label(`${id}-label-${i}`, L.x, L.y, L.width, L.text, {size: L.size, family: fonts.body, color: c.labelColor, align: L.align ?? (vertical ? 'center' : 'left'), weight: 600, wrap: vertical}));
    const V = bar.value;
    kids.push(label(`${id}-value-${i}`, V.x, V.y, V.width, bar.initial, {size: V.size, family: fonts.display, color: c.ink, align: vertical ? 'center' : 'left', lineHeight: 1.2, extra: {opacity: 0}}));
  });
  return kids;
}

function barTimeline(model, ops) {
  const {id, start} = model;
  const c = model.content;
  const vertical = c.layout === 'vertical';
  chromeOps(model, ops);
  if (c.plot) gridOps(ops, id, c.grid.length, start, rt(c.buildAt - 0.2));
  c.bars.forEach((bar, i) => {
    const target = `${id}-bar-${i}`;
    if (c.variant === 'blocks') {
      const from = vertical ? clip(100, 0, 0, 0) : clip(0, 100, 0, 0);
      set(ops, target, start, from);
      tw(ops, target, bar.time, bar.duration, 'power3.out', from, clip(0, 0, 0, 0));
    } else {
      const from = vertical ? {scaleX: 1, scaleY: 0} : {scaleX: 0, scaleY: 1};
      set(ops, target, start, {x: 0, y: 0, ...from});
      tw(ops, target, bar.time, bar.duration, 'power3.out', from, {scaleX: 1, scaleY: 1});
    }
    if (c.variant === 'lollipop') {
      set(ops, `${id}-dot-${i}`, start, {opacity: 0, x: -bar.width, y: 0, scaleX: 0.6, scaleY: 0.6});
      tw(ops, `${id}-dot-${i}`, bar.time, 0.15, 'power1.out', {opacity: 0}, {opacity: 1});
      tw(ops, `${id}-dot-${i}`, bar.time, bar.duration, 'power3.out', {x: -bar.width, scaleX: 0.6, scaleY: 0.6}, {x: 0, scaleX: 1, scaleY: 1});
    }
    riseOps(ops, `${id}-label-${i}`, start, rt(bar.time - 0.05), r2(10 * model.unit), {duration: 0.4});
    const value = `${id}-value-${i}`;
    const travel = vertical ? {x: 0, y: bar.value.travel} : {x: -bar.value.travel, y: 0};
    set(ops, value, start, {opacity: 0, ...travel});
    tw(ops, value, bar.time, 0.2, 'power1.out', {opacity: 0}, {opacity: 1});
    tw(ops, value, bar.time, bar.duration, 'power3.out', travel, {x: 0, y: 0});
    countOps(ops, value, start, bar.initial, bar.samples);
  });
  if (c.highlight !== null) {
    c.bars.forEach((_, i) => {
      if (i === c.highlight) return;
      fadeOps(ops, `${id}-bar-${i}`, c.highlightAt, 1, 0.32);
      fadeOps(ops, `${id}-value-${i}`, c.highlightAt, 1, 0.4);
      if (c.variant === 'lollipop') fadeOps(ops, `${id}-dot-${i}`, c.highlightAt, 1, 0.32);
    });
    tw(ops, `${id}-value-${c.highlight}`, c.highlightAt, 0.45, 'back.out(2)', {scaleX: 1, scaleY: 1}, {scaleX: 1.14, scaleY: 1.14});
  }
}

export const barChart = {
  id: 'bar-chart',
  describe: 'Bars or columns grow to their values with counting labels; one bar can be highlighted after the build. Columns turn sideways when their labels do not fit.',
  params: {data: `[{label ≤ 24, value ≥ 0, color? (${tone})}] 2–10`, format: FORMAT_PARAM, max: 'axis maximum (optional; default the largest value)', tone: `bar colour (${tone}; default primary)`,
    highlight: 'index of the bar to keep lit while the others dim (optional)', highlightAt: at, ...COMMON},
  events: ['build', 'highlight'], timing: TIMING, variants: BAR_VARIANTS,
  resolve: barResolve, view: barView, timeline: barTimeline
};

// ---------------------------------------------------------------------------
// stacked-bar

const STACK_VARIANTS = Object.freeze(['columns', 'bars']);

function stackResolve(params, ctx) {
  const b = createHBase('stacked-bar', params, ctx, {allowed: ['categories', 'series', 'title', 'source', 'format', 'at', 'totals'], required: ['categories', 'series'], variants: STACK_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  check.arr(p.categories, 'params.categories', 2, 7);
  const categories = p.categories.map((c, i) => check.str(c, `params.categories[${i}]`, 20));
  check.arr(p.series, 'params.series', 2, 5);
  const palette = b.series(p.series.length);
  const series = p.series.map((s, i) => {
    check.obj(s, `params.series[${i}]`, ['label', 'values', 'color'], ['label', 'values']);
    check.arr(s.values, `params.series[${i}].values`, categories.length, categories.length);
    return {label: check.str(s.label, `params.series[${i}].label`, 20), values: s.values.map((v, j) => check.num(v, `params.series[${i}].values[${j}]`, 0, 1e12)), color: s.color === undefined ? palette[i] : toneColor(b, s.color, `params.series[${i}].color`)};
  });
  const totals = categories.map((_, j) => series.reduce((sum, s) => sum + s.values[j], 0));
  const max = Math.max(...totals);
  if (!(max > 0)) check.fail('params.series', 'needs at least one value above 0');
  const fmt = numberFormat(check, p.format, 'params.format', {decimals: maxDecimals(series.flatMap(s => s.values))});
  const showTotals = p.totals === undefined ? true : check.bool(p.totals, 'params.totals');
  const tb = titleBlock(b, {title: p.title, source: p.source});
  const W = rect.width;
  // Legend: one row of swatches under the title (two rows when it is long).
  const legendSize = r2(Math.max(b.min.meta, u(30)));
  const legendItems = [];
  let lx = 0, ly = tb.top;
  for (const [i, s] of series.entries()) {
    const w = r2(legendSize * 0.9 + u(12) + textWidth(s.label, legendSize, 'body') + u(32));
    if (lx + w > W && lx > 0) { lx = 0; ly = r2(ly + legendSize * 1.5); }
    legendItems.push({x: r2(lx), y: r2(ly), size: legendSize, label: s.label, color: s.color, index: i});
    lx += w;
  }
  const plotTop = r2(ly + legendSize * 1.5 + u(24)), plotBottom = rect.height - tb.bottom;
  let layout = b.variant === 'columns' ? 'vertical' : 'horizontal';
  const n = categories.length;
  let labelSize, totalSize;
  if (layout === 'vertical') {
    try {
      labelSize = Math.min(...categories.map((c, i) => fitText(check, `params.categories[${i}]`, c, {family: 'body', width: W / n - u(12), preferred: u(32), min: b.min.meta, maxLines: 2}).size));
    } catch { layout = 'horizontal'; }
  }
  const segments = [];
  const totalTexts = totals.map(t => fmt.format(t));
  const cols = [];
  if (layout === 'vertical') {
    const slot = W / n;
    totalSize = Math.min(...totalTexts.map(t => fitText(check, 'params.series', t, {family: 'display', width: slot - u(8), preferred: u(44), min: b.min.meta}).size));
    const top = r2(plotTop + (showTotals ? totalSize * 1.25 + u(8) : 0)), bottom = r2(plotBottom - labelSize * 2.4 - u(18));
    if (bottom - top < u(240)) check.fail('params', 'leaves too little height for the columns; drop the title or enlarge rect');
    const barW = r2(Math.min(slot * 0.6, u(160)));
    categories.forEach((cat, j) => {
      let y = bottom;
      const x = r2(slot * j + (slot - barW) / 2);
      series.forEach((s, i) => {
        const h = r2((bottom - top) * s.values[j] / max);
        y -= h;
        segments.push({x, y: r2(y), width: barW, height: h, color: s.color, series: i, category: j});
      });
      cols.push({label: {x: r2(slot * j + u(6)), y: r2(bottom + u(14)), width: r2(slot - u(12)), size: labelSize, text: cat}, total: {x: r2(slot * j), y: r2(y - totalSize * 1.2 - u(4)), width: r2(slot), size: totalSize, text: totalTexts[j]}});
    });
  } else {
    const labelLeft = !b.portrait;
    const rowH = r2(Math.min(u(140), (plotBottom - plotTop) / n));
    labelSize = Math.min(...categories.map((c, i) => fitText(check, `params.categories[${i}]`, c, {family: 'body', width: labelLeft ? W * 0.24 : W, preferred: u(32), min: b.min.meta}).size));
    totalSize = r2(Math.max(b.min.meta, u(38)));
    const totalW = Math.max(...totalTexts.map(t => textWidth(t, totalSize, 'display'))) + u(16);
    const x0 = labelLeft ? r2(W * 0.26) : 0, maxLen = r2(W - x0 - (showTotals ? totalW : 0));
    const thick = r2(Math.min(u(60), labelLeft ? rowH * 0.58 : rowH - labelSize * 1.25 - u(16)));
    if (thick < u(16)) check.fail('params.categories', 'has too many rows for the height; use fewer categories or enlarge rect');
    categories.forEach((cat, j) => {
      const rowY = plotTop + rowH * j;
      const barY = r2(labelLeft ? rowY + (rowH - thick) / 2 : rowY + labelSize * 1.25 + u(6));
      let x = x0;
      series.forEach((s, i) => {
        const w = r2(maxLen * s.values[j] / max);
        segments.push({x: r2(x), y: barY, width: w, height: thick, color: s.color, series: i, category: j});
        x += w;
      });
      cols.push({label: labelLeft ? {x: 0, y: r2(barY + thick / 2 - labelSize * 0.6), width: r2(W * 0.24), size: labelSize, text: cat, align: 'right'} : {x: 0, y: r2(rowY), width: W, size: labelSize, text: cat},
        total: {x: r2(x + u(12)), y: r2(barY + thick / 2 - totalSize * 0.6), width: r2(totalW), size: totalSize, text: totalTexts[j]}});
    });
  }
  const {buildAt, buildEnd} = buildTimes(b, p, 1.6);
  // Each category builds bottom-up (or left to right), series by series.
  const perSeg = 0.32;
  segments.forEach(seg => { seg.time = rt(buildAt + seg.category * 0.12 + seg.series * perSeg * 0.8); seg.duration = perSeg; });
  cols.forEach((col, j) => { col.time = rt(buildAt + j * 0.12 + (series.length - 1) * perSeg * 0.8 + perSeg); });
  const content = {variant: b.variant, layout, title: tb.title, source: tb.source, legend: legendItems, segments, cols, showTotals, buildAt, buildEnd: rt(Math.max(buildEnd, ...cols.map(c => c.time + 0.3))),
    labelColor: b.theme.muted, ink: b.theme.foreground, gap: u(3)};
  return b.finish(content, {minTextPx: tb.title ? tb.title.size : b.min.key});
}

function stackView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const kids = chromeNodes(model);
  const vertical = c.layout === 'vertical';
  c.legend.forEach((item, i) => kids.push(el('div', `${id}-legend-${i}`, abs(item.x, item.y, undefined, r2(item.size * 1.3), {opacity: 0}), [
    el('div', null, abs(0, r2(item.size * 0.25), r2(item.size * 0.8), r2(item.size * 0.8), {borderRadius: r2(4 * u), background: item.color})),
    label(null, r2(item.size * 0.8 + 12 * u), 0, undefined, item.label, {size: item.size, family: fonts.body, color: c.labelColor, weight: 600, lineHeight: 1.3})
  ])));
  c.segments.forEach((seg, i) => kids.push(el('div', `${id}-seg-${i}`, {...abs(seg.x, seg.y, seg.width, seg.height), boxSizing: 'border-box', background: seg.color,
    ...(vertical ? {borderTop: `${c.gap}px solid ${model.theme.bg}`} : {borderRight: `${c.gap}px solid ${model.theme.bg}`}),
    transformOrigin: vertical ? '50% 100%' : '0% 50%', transform: transformString(vertical ? {scaleY: 0} : {scaleX: 0})})));
  c.cols.forEach((col, j) => {
    const L = col.label;
    kids.push(label(`${id}-cat-${j}`, L.x, L.y, L.width, L.text, {size: L.size, family: fonts.body, color: c.labelColor, weight: 600, align: L.align ?? (vertical ? 'center' : 'left'), wrap: vertical}));
    if (c.showTotals) kids.push(label(`${id}-total-${j}`, col.total.x, col.total.y, col.total.width, col.total.text, {size: col.total.size, family: fonts.display, color: c.ink, align: vertical ? 'center' : 'left', extra: {opacity: 0}}));
  });
  return kids;
}

function stackTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  const vertical = c.layout === 'vertical';
  chromeOps(model, ops);
  c.legend.forEach((_, i) => riseOps(ops, `${id}-legend-${i}`, start, rt(c.buildAt - 0.25 + i * 0.06), r2(10 * u)));
  c.segments.forEach((seg, i) => {
    const from = vertical ? {scaleX: 1, scaleY: 0} : {scaleX: 0, scaleY: 1};
    set(ops, `${id}-seg-${i}`, start, {x: 0, y: 0, ...from});
    tw(ops, `${id}-seg-${i}`, seg.time, seg.duration, 'power2.out', from, {scaleX: 1, scaleY: 1});
  });
  c.cols.forEach((col, j) => {
    riseOps(ops, `${id}-cat-${j}`, start, rt(c.buildAt + j * 0.12 - 0.05), r2(10 * u));
    if (c.showTotals) popOps(ops, `${id}-total-${j}`, start, col.time, {from: 0.7});
  });
}

export const stackedBar = {
  id: 'stacked-bar',
  describe: 'Stacked columns or bars: each category builds series by series with a legend and totals; data from params.',
  params: {categories: '[string ≤ 20] 2–7', series: `[{label ≤ 20, values: [number ≥ 0 per category], color? (${tone})}] 2–5`, format: FORMAT_PARAM, totals: 'boolean (default true)', ...COMMON},
  events: ['build'], timing: TIMING, variants: STACK_VARIANTS,
  resolve: stackResolve, view: stackView, timeline: stackTimeline
};

// ---------------------------------------------------------------------------
// pie-chart (donut, pie, half donut)

const PIE_VARIANTS = Object.freeze(['donut', 'pie', 'half']);
// Inverse of power2.out: the progress at which a sweep reaches fraction p.
const sweepTime = p => 1 - Math.sqrt(Math.max(0, 1 - p));

function pieResolve(params, ctx) {
  const b = createHBase('pie-chart', params, ctx, {allowed: ['data', 'title', 'source', 'format', 'at', 'highlight', 'highlightAt', 'center', 'percent'], required: ['data'], variants: PIE_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  const rows = dataRows(b, p.data, 'params.data', {min: 2, max: 6, labelMax: 22});
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (!(total > 0)) check.fail('params.data', 'needs a total above 0');
  const fmt = numberFormat(check, p.format, 'params.format', {decimals: maxDecimals(rows.map(r => r.value))});
  const percent = p.percent === undefined ? true : check.bool(p.percent, 'params.percent');
  const highlight = highlightIndex(b, p.highlight, rows.length);
  const palette = b.series(rows.length);
  const tb = titleBlock(b, {title: p.title, source: p.source});
  const W = rect.width, H = rect.height - tb.top - tb.bottom;
  const half = b.variant === 'half';
  // Legend beside the chart in landscape, below it in portrait.
  const legendSize = r2(Math.max(b.min.meta, u(34)));
  const valueText = r => (percent ? `${Math.round(r.value / total * 100)}%` : fmt.format(r.value));
  const legendW = Math.max(...rows.map(r => textWidth(r.label, legendSize, 'body') + textWidth(valueText(r), legendSize, 'display') + legendSize + u(48)));
  const side = !b.portrait;
  const legendH = rows.length * legendSize * 1.55;
  let size = side ? Math.min(H, W - legendW - u(60)) : Math.min(W, H - legendH - u(40));
  if (half) size = side ? Math.min(W - legendW - u(60), H * 2 - u(20)) : Math.min(W, (H - legendH - u(40)) * 2);
  size = r2(Math.min(size, u(820)));
  if (size < u(320)) check.fail('params', 'leaves too little room for the chart; drop the title, use fewer slices or enlarge rect');
  const chartH = half ? r2(size / 2 + u(64)) : size;
  const blockW = side ? size + u(60) + legendW : W, blockH = side ? Math.max(chartH, legendH) : chartH + u(40) + legendH;
  const ox = r2(side ? (W - blockW) / 2 : (W - size) / 2), oy = r2(tb.top + Math.max(0, (H - blockH) / 2));
  const cx = r2(ox + size / 2), cy = r2(oy + (half ? size / 2 : size / 2));
  const pie = b.variant === 'pie';
  const thickness = r2(pie ? size / 2 : size * (half ? 0.17 : 0.16));
  const radius = r2(size / 2 - thickness / 2);
  const span = half ? 180 : 360, a0 = half ? 180 : -90;
  const gapDeg = pie ? 0.6 : 1.4;
  const {buildAt, buildEnd, highlightAt} = buildTimes(b, p, 1.3, {highlight: highlight !== null});
  const D = 1.1;
  let cum = 0;
  const slices = rows.map((r, i) => {
    const f0 = cum / total, f1 = (cum + r.value) / total;
    cum += r.value;
    const s0 = a0 + f0 * span + gapDeg / 2, s1 = a0 + f1 * span - gapDeg / 2;
    const t0 = rt(buildAt + D * sweepTime(f0)), t1 = rt(buildAt + D * sweepTime(f1));
    const mid = (s0 + s1) / 2 * Math.PI / 180;
    return {d: arcPath(cx, cy, radius, s0, Math.max(s0 + 0.2, s1)), color: r.color ?? palette[i], time: t0, duration: rt(Math.max(0.02, t1 - t0)), label: r.label, value: valueText(r), mid: {x: r2(cx + Math.cos(mid) * radius), y: r2(cy + Math.sin(mid) * radius)}};
  });
  const legend = rows.map((r, i) => side
    ? {x: r2(ox + size + u(60)), y: r2(oy + (chartH - legendH) / 2 + i * legendSize * 1.55), width: r2(legendW), size: legendSize}
    : {x: r2((W - legendW) / 2), y: r2(oy + chartH + u(40) + i * legendSize * 1.55), width: r2(legendW), size: legendSize});
  legend.forEach((item, i) => { item.time = rt(slices[i].time + slices[i].duration * 0.5); });
  let center = null;
  if (!pie) {
    const raw = p.center === undefined ? {} : p.center === false ? null : check.obj(p.center, 'params.center', ['value', 'label']);
    if (raw) {
      const value = raw.value === undefined ? fmt.format(total) : check.str(String(raw.value), 'params.center.value', 10);
      const lab = raw.label === undefined ? 'Total' : check.str(raw.label, 'params.center.label', 18);
      const inner = (radius - thickness / 2) * 2 * (half ? 0.9 : 0.78);
      const valueSize = fitText(check, 'params.center.value', value, {family: 'display', width: inner, preferred: u(half ? 96 : 110), min: b.min.key}).size;
      const labelSize = fitText(check, 'params.center.label', lab, {family: 'meta', width: inner, preferred: u(28), min: b.min.meta}).size;
      center = {value, label: lab.toUpperCase(), valueSize, labelSize, x: r2(cx - inner / 2), width: r2(inner),
        y: half ? r2(cy - valueSize * 1.05 - u(4)) : r2(cy - (valueSize * 1.05 + labelSize * 1.4) / 2), time: rt(buildAt + 0.5), animate: raw.value === undefined,
        samples: raw.value === undefined ? countSamples(b.model, rt(buildAt + 0.1), D, 'power2.out', 0, total, fmt.format) : null, initial: raw.value === undefined ? fmt.format(0) : value};
    }
  }
  const content = {variant: b.variant, title: tb.title, source: tb.source, slices, legend, center, thickness, highlight, highlightAt, buildAt, buildEnd, size, ox, oy, chartH, ink: b.theme.foreground, muted: b.theme.muted, track: b.theme.panel, cx, cy, radius, a0, span};
  return b.finish(content, {minTextPx: Math.min(tb.title ? tb.title.size : Infinity, center ? center.valueSize : Infinity, b.min.key)});
}

function pieView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const kids = chromeNodes(model);
  const W = model.rect.width, H = model.rect.height;
  const svg = [];
  if (c.variant !== 'pie') svg.push(el('path', null, null, [], {d: arcPath(c.cx, c.cy, c.radius, c.a0, c.a0 + c.span), stroke: c.track, strokeWidth: c.thickness, fill: 'none', strokeLinecap: 'butt'}));
  c.slices.forEach((s, i) => svg.push(strokePath(`${id}-slice-${i}`, s.d, s.color, c.thickness, {cap: 'butt'})));
  kids.push(svgRoot(W, H, svg));
  if (c.center) {
    const C = c.center;
    kids.push(label(`${id}-center`, C.x, C.y, C.width, C.initial, {size: C.valueSize, family: fonts.display, color: c.ink, align: 'center', lineHeight: 1.05}));
    kids.push(label(`${id}-center-label`, C.x, r2(C.y + C.valueSize * 1.05 + 4 * u), C.width, C.label, {size: C.labelSize, family: fonts.meta, color: c.muted, align: 'center', spacing: '0.14em', extra: {opacity: 0}}));
  }
  c.legend.forEach((item, i) => {
    const s = c.slices[i];
    kids.push(el('div', `${id}-legend-${i}`, abs(item.x, item.y, item.width, r2(item.size * 1.3), {opacity: 0}), [
      el('div', null, abs(0, r2(item.size * 0.2), r2(item.size * 0.85), r2(item.size * 0.85), {borderRadius: '50%', background: s.color})),
      label(null, r2(item.size + 18 * u), 0, undefined, s.label, {size: item.size, family: fonts.body, color: c.ink, weight: 600, lineHeight: 1.3}),
      label(null, 0, 0, item.width, s.value, {size: item.size, family: fonts.display, color: c.muted, align: 'right', lineHeight: 1.3})
    ]));
  });
  return kids;
}

function pieTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  chromeOps(model, ops);
  c.slices.forEach((s, i) => drawOps(ops, `${id}-slice-${i}`, start, s.time, s.duration, 'none'));
  c.legend.forEach((item, i) => riseOps(ops, `${id}-legend-${i}`, start, item.time, 0, {dx: r2(-16 * u), duration: 0.4}));
  if (c.center) {
    const C = c.center;
    if (C.samples) countOps(ops, `${id}-center`, start, C.initial, C.samples);
    popOps(ops, `${id}-center`, start, rt(c.buildAt + 0.05), {from: 0.85, duration: 0.6, ease: 'power3.out'});
    riseOps(ops, `${id}-center-label`, start, C.time, r2(8 * u));
  }
  if (c.highlight !== null) {
    c.slices.forEach((_, i) => {
      if (i === c.highlight) return;
      fadeOps(ops, `${id}-slice-${i}`, c.highlightAt, 1, 0.3);
      fadeOps(ops, `${id}-legend-${i}`, c.highlightAt, 1, 0.45);
    });
  }
}

export const pieChart = {
  id: 'pie-chart',
  describe: 'Donut, pie or half-donut: slices sweep on in one continuous turn, the legend lands slice by slice, and the centre counts up the total; one slice can be highlighted.',
  params: {data: `[{label ≤ 22, value ≥ 0, color? (${tone})}] 2–6`, percent: 'boolean: the legend shows shares (default true) or values', format: FORMAT_PARAM,
    center: '{value? (default the counting total), label? ("Total")} or false; donut and half only', highlight: 'slice index (optional)', highlightAt: at, ...COMMON},
  events: ['build', 'highlight'], timing: TIMING, variants: PIE_VARIANTS,
  resolve: pieResolve, view: pieView, timeline: pieTimeline
};

// ---------------------------------------------------------------------------
// area-chart

const AREA_VARIANTS = Object.freeze(['gradient', 'line', 'steps']);

function areaResolve(params, ctx) {
  const b = createHBase('area-chart', params, ctx, {allowed: ['labels', 'series', 'title', 'source', 'format', 'at', 'min', 'max'], required: ['labels', 'series'], variants: AREA_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  check.arr(p.labels, 'params.labels', 3, 16);
  const labels = p.labels.map((l, i) => check.str(String(l), `params.labels[${i}]`, 12));
  check.arr(p.series, 'params.series', 1, 3);
  const palette = b.series(p.series.length);
  const series = p.series.map((s, i) => {
    check.obj(s, `params.series[${i}]`, ['label', 'values', 'color'], ['values']);
    check.arr(s.values, `params.series[${i}].values`, labels.length, labels.length);
    return {label: s.label === undefined ? null : check.str(s.label, `params.series[${i}].label`, 20), values: s.values.map((v, j) => check.num(v, `params.series[${i}].values[${j}]`, -1e12, 1e12)), color: s.color === undefined ? palette[i] : toneColor(b, s.color, `params.series[${i}].color`)};
  });
  const all = series.flatMap(s => s.values);
  const fmt = numberFormat(check, p.format, 'params.format', {decimals: maxDecimals(all)});
  const lo = p.min === undefined ? Math.min(0, ...all) : check.num(p.min, 'params.min', -1e12, Math.min(...all));
  const hi = p.max === undefined ? Math.max(...all) * 1.08 : check.num(p.max, 'params.max', Math.max(...all), 1e12);
  if (!(hi > lo)) check.fail('params.series', 'needs values that are not all equal to the minimum');
  const tb = titleBlock(b, {title: p.title, source: p.source});
  const W = rect.width;
  const legend = series.some(s => s.label) ? series.map((s, i) => ({label: s.label ?? `Series ${i + 1}`, color: s.color})) : [];
  const legendSize = r2(Math.max(b.min.meta, u(30)));
  const labelSize = r2(Math.max(b.min.meta, u(28)));
  const endSize = r2(Math.max(b.min.meta, u(44)));
  const endW = Math.max(...series.map(s => textWidth(fmt.format(s.values[s.values.length - 1]), endSize, 'display'))) + u(24);
  const top = r2(tb.top + (legend.length ? legendSize * 1.6 + u(10) : 0) + u(10)), bottom = r2(rect.height - tb.bottom - labelSize * 1.3 - u(18));
  const plot = {x: 0, y: top, width: r2(W - endW), height: r2(bottom - top)};
  if (plot.height < u(240)) check.fail('params', 'leaves too little height for the chart; drop the title or enlarge rect');
  const n = labels.length;
  const X = j => r2(plot.x + plot.width * j / (n - 1)), Y = v => r2(plot.y + plot.height * (1 - (v - lo) / (hi - lo)));
  const steps = b.variant === 'steps';
  const linePath = values => {
    if (steps) return values.map((v, j) => (j === 0 ? `M${X(0)} ${Y(v)}` : `H${X(j)} V${Y(v)}`)).join(' ') + ` H${r2(plot.x + plot.width)}`;
    // Monotone-ish smoothing: cubic segments with horizontal handles.
    return values.map((v, j) => {
      if (j === 0) return `M${X(0)} ${Y(v)}`;
      const mx = r2((X(j - 1) + X(j)) / 2);
      return `C${mx} ${Y(values[j - 1])} ${mx} ${Y(v)} ${X(j)} ${Y(v)}`;
    }).join(' ');
  };
  const baseY = Y(Math.max(lo, 0));
  const lines = series.map((s, i) => {
    const d = linePath(s.values);
    const last = s.values[s.values.length - 1];
    return {d, area: `${d} V${baseY} H${X(0)} Z`, color: s.color, end: {x: steps ? r2(plot.x + plot.width) : X(n - 1), y: Y(last), text: fmt.format(last)}, index: i};
  });
  // X labels: every label when they fit, else every k-th (first and last kept).
  const slotW = plot.width / (n - 1);
  const widest = Math.max(...labels.map(l => textWidth(l, labelSize, 'body')));
  const every = Math.max(1, Math.ceil((widest + u(16)) / slotW));
  const xLabels = labels.map((l, j) => ({text: l, x: X(j), show: j % every === 0 || j === n - 1})).filter(l => l.show).filter((l, i, arr) => i === arr.length - 1 || arr[arr.length - 1].x - l.x >= widest + u(16) || i === 0);
  const {buildAt, buildEnd} = buildTimes(b, p, 1.6);
  const reveal = 1.3;
  const content = {variant: b.variant, title: tb.title, source: tb.source, plot, lines, xLabels, labelSize, labelY: r2(bottom + u(14)), legend, legendSize, legendY: r2(tb.top), endSize, buildAt, buildEnd, reveal,
    grid: [0, 0.25, 0.5, 0.75, 1], gridColor: b.theme.border, muted: b.theme.muted, ink: b.theme.foreground, stroke: u(6)};
  return b.finish(content, {minTextPx: tb.title ? tb.title.size : b.min.key});
}

function areaView(model) {
  const {id, fonts, unit: u, theme} = model;
  const c = model.content;
  const kids = chromeNodes(model);
  const W = model.rect.width, H = model.rect.height;
  kids.push(...gridNodes(id, c.plot, c.grid, c.gridColor, u));
  c.legend.forEach((item, i) => kids.push(el('div', `${id}-legend-${i}`, abs(r2(i * W / Math.max(3, c.legend.length)), c.legendY, r2(W / Math.max(3, c.legend.length)), r2(c.legendSize * 1.3), {opacity: 0}), [
    el('div', null, abs(0, r2(c.legendSize * 0.55), r2(c.legendSize * 1.1), r2(5 * u), {borderRadius: 99, background: item.color})),
    label(null, r2(c.legendSize * 1.1 + 14 * u), 0, undefined, item.label, {size: c.legendSize, family: fonts.body, color: c.muted, weight: 600, lineHeight: 1.3})
  ])));
  const defs = [], paths = [];
  c.lines.forEach((line, i) => {
    if (c.variant !== 'line') {
      defs.push(el('linearGradient', `${id}-grad-${i}`, null, [el('stop', null, null, [], {offset: '0%', stopColor: line.color, stopOpacity: c.variant === 'gradient' ? 0.55 : 0.32}), el('stop', null, null, [], {offset: '100%', stopColor: line.color, stopOpacity: c.variant === 'gradient' ? 0.02 : 0.32})], {x1: 0, y1: 0, x2: 0, y2: 1}));
      paths.push(el('path', null, null, [], {d: line.area, fill: `url(#${id}-grad-${i})`}));
    }
    paths.push(el('path', null, null, [], {d: line.d, stroke: line.color, strokeWidth: c.stroke, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none'}));
  });
  // The plot reveals left to right through a clip on its wrapper.
  kids.push(el('div', `${id}-plot`, {...abs(0, 0, W, H), clipPath: 'inset(0% 100% 0% 0%)'}, [svgRoot(W, H, [el('defs', null, null, defs), ...paths])]));
  c.lines.forEach((line, i) => {
    const d = r2(22 * u);
    kids.push(el('div', `${id}-end-${i}`, abs(r2(line.end.x - d / 2), r2(line.end.y - d / 2), d, d, {borderRadius: '50%', background: line.color, boxShadow: `0 0 0 ${r2(7 * u)}px ${line.color}40`, opacity: 0})));
    kids.push(label(`${id}-end-label-${i}`, r2(line.end.x + 18 * u), r2(line.end.y - c.endSize * 0.6), r2(W - line.end.x - 18 * u), line.end.text, {size: c.endSize, family: fonts.display, color: line.color, extra: {opacity: 0}}));
  });
  c.xLabels.forEach((l, j) => kids.push(label(`${id}-x-${j}`, r2(l.x - 120 * u), c.labelY, r2(240 * u), l.text, {size: c.labelSize, family: fonts.body, color: theme.muted, align: 'center', weight: 600, extra: {opacity: 0}})));
  return kids;
}

function areaTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  chromeOps(model, ops);
  gridOps(ops, id, c.grid.length, start, rt(c.buildAt - 0.25));
  c.legend.forEach((_, i) => riseOps(ops, `${id}-legend-${i}`, start, rt(c.buildAt - 0.2 + i * 0.08), r2(10 * u)));
  set(ops, `${id}-plot`, start, clip(0, 100, 0, 0));
  tw(ops, `${id}-plot`, c.buildAt, c.reveal, 'power2.inOut', clip(0, 100, 0, 0), clip(0, 0, 0, 0));
  c.xLabels.forEach((l, j) => riseOps(ops, `${id}-x-${j}`, start, rt(c.buildAt + c.reveal * Math.min(1, l.x / c.plot.width) * 0.8), r2(8 * u), {duration: 0.35}));
  c.lines.forEach((_, i) => {
    popOps(ops, `${id}-end-${i}`, start, rt(c.buildAt + c.reveal - 0.05), {from: 0.2});
    riseOps(ops, `${id}-end-label-${i}`, start, rt(c.buildAt + c.reveal + 0.05), 0, {dx: r2(-14 * u)});
  });
}

export const areaChart = {
  id: 'area-chart',
  describe: 'One to three series over labelled points: the area and line reveal left to right and the end value lands; gradient, line-only or stepped.',
  params: {labels: '[string ≤ 12] 3–16, the x points', series: `[{values: [number per label], label? ≤ 20, color? (${tone})}] 1–3`, format: FORMAT_PARAM, min: 'axis minimum (optional)', max: 'axis maximum (optional)', ...COMMON},
  events: ['build'], timing: TIMING, variants: AREA_VARIANTS,
  resolve: areaResolve, view: areaView, timeline: areaTimeline
};

// ---------------------------------------------------------------------------
// scatter-plot

const SCATTER_VARIANTS = Object.freeze(['dots', 'bubbles', 'rings']);

function scatterResolve(params, ctx) {
  const b = createHBase('scatter-plot', params, ctx, {allowed: ['points', 'xLabel', 'yLabel', 'title', 'source', 'at', 'highlight', 'highlightAt', 'trend', 'x', 'y', 'tone'], required: ['points'], variants: SCATTER_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  check.arr(p.points, 'params.points', 3, 60);
  const base = toneColor(b, p.tone, 'params.tone');
  const points = p.points.map((pt, i) => {
    check.obj(pt, `params.points[${i}]`, ['x', 'y', 'size', 'label', 'color'], ['x', 'y']);
    return {x: check.num(pt.x, `params.points[${i}].x`, -1e12, 1e12), y: check.num(pt.y, `params.points[${i}].y`, -1e12, 1e12), size: pt.size === undefined ? 1 : check.num(pt.size, `params.points[${i}].size`, 0, 1e12),
      label: pt.label === undefined ? null : check.str(pt.label, `params.points[${i}].label`, 22), color: pt.color === undefined ? base : toneColor(b, pt.color, `params.points[${i}].color`)};
  });
  const range = (key, raw) => {
    const vals = points.map(pt => pt[key]);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo || Math.abs(hi) || 1) * 0.08;
    lo -= pad; hi += pad;
    if (raw !== undefined) {
      check.obj(raw, `params.${key}`, ['min', 'max'], ['min', 'max']);
      lo = check.num(raw.min, `params.${key}.min`, -1e12, Math.min(...vals));
      hi = check.num(raw.max, `params.${key}.max`, Math.max(...vals), 1e12);
      if (!(hi > lo)) check.fail(`params.${key}`, 'max must be greater than min');
    }
    return [lo, hi];
  };
  const [x0, x1] = range('x', p.x), [y0, y1] = range('y', p.y);
  const highlight = highlightIndex(b, p.highlight, points.length);
  const trend = p.trend === undefined ? false : check.bool(p.trend, 'params.trend');
  const xLabel = p.xLabel === undefined ? null : check.str(p.xLabel, 'params.xLabel', 32);
  const yLabel = p.yLabel === undefined ? null : check.str(p.yLabel, 'params.yLabel', 32);
  const tb = titleBlock(b, {title: p.title, source: p.source});
  const axisSize = r2(Math.max(b.min.meta, u(28)));
  const W = rect.width;
  const plot = {x: r2(u(8)), y: r2(tb.top + (yLabel ? axisSize * 1.4 + u(8) : u(8))), width: r2(W - u(16)), height: 0};
  plot.height = r2(rect.height - tb.bottom - plot.y - (xLabel ? axisSize * 1.4 + u(16) : u(16)));
  if (plot.height < u(260)) check.fail('params', 'leaves too little height for the plot; drop the title or enlarge rect');
  const maxSize = Math.max(...points.map(pt => pt.size)) || 1;
  const dotBase = u(Math.max(18, Math.min(30, 300 / Math.sqrt(points.length))));
  const bubbles = b.variant === 'bubbles';
  const {buildAt, buildEnd, highlightAt} = buildTimes(b, p, 1.5, {highlight: highlight !== null});
  const order = points.map((pt, i) => i).sort((a, c) => points[a].x - points[c].x);
  const span = Math.min(0.9, 0.03 * points.length + 0.3);
  const marks = points.map((pt, i) => {
    const d = r2(bubbles ? dotBase * (0.8 + 2.6 * Math.sqrt(pt.size / maxSize)) : dotBase);
    return {x: r2(plot.x + plot.width * (pt.x - x0) / (x1 - x0)), y: r2(plot.y + plot.height * (1 - (pt.y - y0) / (y1 - y0))), d, color: pt.color, label: pt.label,
      time: rt(buildAt + 0.35 + span * order.indexOf(i) / Math.max(1, points.length - 1))};
  });
  let trendLine = null;
  if (trend) {
    const n = points.length, mx = points.reduce((s, pt) => s + pt.x, 0) / n, my = points.reduce((s, pt) => s + pt.y, 0) / n;
    const sxx = points.reduce((s, pt) => s + (pt.x - mx) ** 2, 0), sxy = points.reduce((s, pt) => s + (pt.x - mx) * (pt.y - my), 0);
    const slope = sxx ? sxy / sxx : 0;
    const yAt = x => my + slope * (x - mx);
    const P = x => [r2(plot.x + plot.width * (x - x0) / (x1 - x0)), r2(plot.y + plot.height * (1 - (yAt(x) - y0) / (y1 - y0)))];
    const [ax, ay] = P(x0), [bx, by] = P(x1);
    trendLine = {d: `M${ax} ${Math.min(Math.max(ay, plot.y), plot.y + plot.height)} L${bx} ${Math.min(Math.max(by, plot.y), plot.y + plot.height)}`, time: rt(buildAt + 0.35 + span + 0.1)};
  }
  const callout = highlight === null ? null : (() => {
    const m = marks[highlight];
    const text = m.label ?? `(${points[highlight].x}, ${points[highlight].y})`;
    const size = r2(Math.max(b.min.meta, u(34)));
    const w = r2(textWidth(text, size, 'body') + u(36));
    const right = m.x + w + m.d < W;
    return {text, size, width: w, x: r2(right ? m.x + m.d / 2 + u(14) : m.x - m.d / 2 - u(14) - w), y: r2(Math.max(plot.y, m.y - size * 0.75 - u(9))), height: r2(size * 1.25 + u(18))};
  })();
  const content = {variant: b.variant, title: tb.title, source: tb.source, plot, marks, trendLine, highlight, highlightAt, callout, xLabel, yLabel, axisSize, buildAt, buildEnd,
    axis: b.theme.muted, gridColor: b.theme.border, ink: b.theme.foreground, panel: b.theme.bg};
  return b.finish(content, {minTextPx: tb.title ? tb.title.size : b.min.key});
}

function scatterView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const P = c.plot;
  const kids = chromeNodes(model);
  kids.push(...gridNodes(id, P, [0.25, 0.5, 0.75], c.gridColor, u));
  kids.push(el('div', `${id}-xaxis`, abs(P.x, r2(P.y + P.height - 1.5 * u), P.width, r2(3 * u), {background: c.axis, transformOrigin: '0% 50%', transform: transformString({scaleX: 0})})));
  kids.push(el('div', `${id}-yaxis`, abs(r2(P.x - 1.5 * u), P.y, r2(3 * u), P.height, {background: c.axis, transformOrigin: '50% 100%', transform: transformString({scaleY: 0})})));
  if (c.xLabel) kids.push(label(`${id}-xlabel`, P.x, r2(P.y + P.height + 14 * u), P.width, c.xLabel, {size: c.axisSize, family: fonts.meta, color: c.axis, align: 'right', spacing: '0.06em', extra: {opacity: 0}}));
  if (c.yLabel) kids.push(label(`${id}-ylabel`, P.x, r2(P.y - c.axisSize * 1.4 - 4 * u), P.width, c.yLabel, {size: c.axisSize, family: fonts.meta, color: c.axis, spacing: '0.06em', extra: {opacity: 0}}));
  if (c.trendLine) kids.push(svgRoot(model.rect.width, model.rect.height, [strokePath(`${id}-trend`, c.trendLine.d, c.ink, r2(4 * u), {opacity: 0.7})]));
  c.marks.forEach((m, i) => {
    const rings = c.variant === 'rings';
    kids.push(el('div', `${id}-dot-${i}`, abs(r2(m.x - m.d / 2), r2(m.y - m.d / 2), m.d, m.d, {boxSizing: 'border-box', borderRadius: '50%',
      background: rings ? 'transparent' : c.variant === 'bubbles' ? `${m.color}b3` : m.color, border: rings ? `${r2(5 * u)}px solid ${m.color}` : c.variant === 'bubbles' ? `${r2(3 * u)}px solid ${m.color}` : 'none', opacity: 0})));
  });
  if (c.callout) {
    const C = c.callout;
    kids.push(el('div', `${id}-callout`, abs(C.x, C.y, C.width, C.height, {boxSizing: 'border-box', borderRadius: r2(14 * u), background: c.ink, opacity: 0}), [
      label(null, 0, r2(9 * u), C.width, C.text, {size: C.size, family: fonts.body, color: c.panel, align: 'center', weight: 650, lineHeight: 1.25})
    ]));
  }
  return kids;
}

function scatterTimeline(model, ops) {
  const {id, start} = model;
  const c = model.content;
  chromeOps(model, ops);
  gridOps(ops, id, 3, start, rt(c.buildAt + 0.1));
  set(ops, `${id}-xaxis`, start, {x: 0, y: 0, scaleX: 0, scaleY: 1});
  tw(ops, `${id}-xaxis`, c.buildAt, 0.5, 'power3.out', {scaleX: 0}, {scaleX: 1});
  set(ops, `${id}-yaxis`, start, {x: 0, y: 0, scaleX: 1, scaleY: 0});
  tw(ops, `${id}-yaxis`, c.buildAt, 0.5, 'power3.out', {scaleY: 0}, {scaleY: 1});
  if (c.xLabel) riseOps(ops, `${id}-xlabel`, start, rt(c.buildAt + 0.3), 0);
  if (c.yLabel) riseOps(ops, `${id}-ylabel`, start, rt(c.buildAt + 0.3), 0);
  c.marks.forEach((m, i) => popOps(ops, `${id}-dot-${i}`, start, m.time, {from: 0, duration: 0.4, ease: 'back.out(2.2)', fade: 0.1}));
  if (c.trendLine) drawOps(ops, `${id}-trend`, start, c.trendLine.time, 0.6, 'power2.inOut');
  if (c.highlight !== null) {
    c.marks.forEach((_, i) => { if (i !== c.highlight) fadeOps(ops, `${id}-dot-${i}`, c.highlightAt, 1, 0.3); });
    tw(ops, `${id}-dot-${c.highlight}`, c.highlightAt, 0.45, 'back.out(2)', {scaleX: 1, scaleY: 1}, {scaleX: 1.5, scaleY: 1.5});
    popOps(ops, `${id}-callout`, start, rt(c.highlightAt + 0.1), {from: 0.7});
  }
}

export const scatterPlot = {
  id: 'scatter-plot',
  describe: 'Points (or sized bubbles) pop onto two axes in x order, with an optional fitted trend line and one labelled highlight.',
  params: {points: `[{x, y, size? (bubbles), label? ≤ 22, color? (${tone})}] 3–60`, xLabel: 'string ≤ 32', yLabel: 'string ≤ 32', x: '{min, max} (optional)', y: '{min, max} (optional)',
    trend: 'boolean: draw the least-squares line (default false)', tone: `dot colour (${tone})`, highlight: 'point index to call out (optional)', highlightAt: at, ...COMMON},
  events: ['build', 'highlight'], timing: TIMING, variants: SCATTER_VARIANTS,
  resolve: scatterResolve, view: scatterView, timeline: scatterTimeline
};

// ---------------------------------------------------------------------------
// radar-chart

const RADAR_VARIANTS = Object.freeze(['polygon', 'circles', 'dots']);

function radarResolve(params, ctx) {
  const b = createHBase('radar-chart', params, ctx, {allowed: ['axes', 'series', 'max', 'title', 'source', 'at'], required: ['axes', 'series'], variants: RADAR_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  check.arr(p.axes, 'params.axes', 3, 8);
  const axes = p.axes.map((a, i) => check.str(a, `params.axes[${i}]`, 16));
  check.arr(p.series, 'params.series', 1, 3);
  const palette = b.series(p.series.length);
  const series = p.series.map((s, i) => {
    check.obj(s, `params.series[${i}]`, ['label', 'values', 'color'], ['values']);
    check.arr(s.values, `params.series[${i}].values`, axes.length, axes.length);
    return {label: s.label === undefined ? null : check.str(s.label, `params.series[${i}].label`, 20), values: s.values.map((v, j) => check.num(v, `params.series[${i}].values[${j}]`, 0, 1e12)), color: s.color === undefined ? palette[i] : toneColor(b, s.color, `params.series[${i}].color`)};
  });
  const peak = Math.max(...series.flatMap(s => s.values));
  const max = p.max === undefined ? peak : check.num(p.max, 'params.max', peak, 1e12);
  if (!(max > 0)) check.fail('params.series', 'needs a value above 0');
  const tb = titleBlock(b, {title: p.title, source: p.source});
  const labelSize = r2(Math.max(b.min.meta, u(32)));
  const widest = Math.max(...axes.map(a => textWidth(a, labelSize, 'body')));
  const legendSize = r2(Math.max(b.min.meta, u(30)));
  const legend = series.some(s => s.label) ? series.map((s, i) => ({label: s.label ?? `Series ${i + 1}`, color: s.color})) : [];
  const legendH = legend.length ? legendSize * 1.6 : 0;
  const W = rect.width, H = rect.height - tb.top - tb.bottom - legendH;
  const radius = r2(Math.min(W / 2 - widest - u(30), H / 2 - labelSize * 1.6 - u(10), u(400)));
  if (radius < u(150)) check.fail('params.axes', 'labels are too long for the space; shorten them or enlarge rect');
  const cx = r2(W / 2), cy = r2(tb.top + legendH + H / 2);
  const n = axes.length;
  const angle = j => (-90 + 360 * j / n) * Math.PI / 180;
  const pt = (j, f) => [r2(cx + Math.cos(angle(j)) * radius * f), r2(cy + Math.sin(angle(j)) * radius * f)];
  const rings = [0.25, 0.5, 0.75, 1];
  const grid = b.variant === 'circles' ? rings.map(f => arcPath(cx, cy, radius * f, 0, 360)) : rings.map(f => `M${axes.map((_, j) => pt(j, f).join(' ')).join(' L')} Z`);
  const spokes = axes.map((_, j) => `M${cx} ${cy} L${pt(j, 1).join(' ')}`);
  const labels = axes.map((a, j) => {
    const [x, y] = pt(j, 1);
    const cos = Math.cos(angle(j)), sin = Math.sin(angle(j));
    const align = Math.abs(cos) < 0.2 ? 'center' : cos > 0 ? 'left' : 'right';
    const w = r2(widest + u(8));
    return {text: a, align, width: w, x: r2(align === 'center' ? x - w / 2 : align === 'left' ? x + u(18) : x - u(18) - w), y: r2(y + sin * u(18) + (sin > 0.2 ? 0 : sin < -0.2 ? -labelSize * 1.2 : -labelSize * 0.6))};
  });
  const {buildAt, buildEnd} = buildTimes(b, p, 1.4);
  const shapes = series.map((s, i) => {
    const pts = s.values.map((v, j) => pt(j, v / max));
    return {d: `M${pts.map(q => q.join(' ')).join(' L')} Z`, points: pts.map(([x, y]) => ({x, y})), color: s.color, time: rt(buildAt + 0.3 + i * 0.25)};
  });
  const content = {variant: b.variant, title: tb.title, source: tb.source, cx, cy, radius, grid, spokes, labels, labelSize, shapes, legend, legendSize, legendY: tb.top, buildAt, buildEnd,
    gridColor: b.theme.border, muted: b.theme.muted};
  return b.finish(content, {minTextPx: tb.title ? tb.title.size : b.min.key});
}

function radarView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const W = model.rect.width, H = model.rect.height;
  const kids = chromeNodes(model);
  kids.push(el('div', `${id}-grid`, {...abs(0, 0, W, H), opacity: 0}, [svgRoot(W, H, [...c.grid.map(d => el('path', null, null, [], {d, stroke: c.gridColor, strokeWidth: r2(2 * u), fill: 'none'})),
    ...c.spokes.map(d => el('path', null, null, [], {d, stroke: c.gridColor, strokeWidth: r2(2 * u)}))])]));
  c.legend.forEach((item, i) => kids.push(el('div', `${id}-legend-${i}`, abs(r2(W / 2 - c.legend.length * 140 * u + i * 280 * u), c.legendY, r2(280 * u), r2(c.legendSize * 1.3), {opacity: 0}), [
    el('div', null, abs(0, r2(c.legendSize * 0.25), r2(c.legendSize * 0.8), r2(c.legendSize * 0.8), {borderRadius: r2(4 * u), background: item.color})),
    label(null, r2(c.legendSize * 0.8 + 12 * u), 0, undefined, item.label, {size: c.legendSize, family: fonts.body, color: c.muted, weight: 600, lineHeight: 1.3})
  ])));
  c.shapes.forEach((s, i) => {
    kids.push(el('div', `${id}-shape-${i}`, {...abs(0, 0, W, H), transformOrigin: `${c.cx}px ${c.cy}px`, transform: transformString({scaleX: 0, scaleY: 0}), opacity: 0}, [svgRoot(W, H, [
      el('path', null, null, [], {d: s.d, fill: s.color, fillOpacity: c.variant === 'dots' ? 0.16 : 0.28, stroke: s.color, strokeWidth: r2(5 * u), strokeLinejoin: 'round'})
    ])]));
    if (c.variant === 'dots') s.points.forEach((q, j) => kids.push(el('div', `${id}-pt-${i}-${j}`, abs(r2(q.x - 11 * u), r2(q.y - 11 * u), r2(22 * u), r2(22 * u), {borderRadius: '50%', background: s.color, opacity: 0}))));
  });
  c.labels.forEach((l, j) => kids.push(label(`${id}-axis-${j}`, l.x, l.y, l.width, l.text, {size: c.labelSize, family: fonts.body, color: model.theme.foreground, align: l.align, weight: 600, extra: {opacity: 0}})));
  return kids;
}

function radarTimeline(model, ops) {
  const {id, start} = model;
  const c = model.content;
  chromeOps(model, ops);
  set(ops, `${id}-grid`, start, {opacity: 0, x: 0, y: 0, scaleX: 0.85, scaleY: 0.85});
  tw(ops, `${id}-grid`, c.buildAt, 0.5, 'power3.out', {opacity: 0, scaleX: 0.85, scaleY: 0.85}, {opacity: 1, scaleX: 1, scaleY: 1});
  c.legend.forEach((_, i) => riseOps(ops, `${id}-legend-${i}`, start, rt(c.buildAt + i * 0.08), 0));
  c.labels.forEach((_, j) => riseOps(ops, `${id}-axis-${j}`, start, rt(c.buildAt + 0.1 + j * 0.05), 0, {duration: 0.35}));
  c.shapes.forEach((s, i) => {
    popOps(ops, `${id}-shape-${i}`, start, s.time, {from: 0, duration: 0.7, ease: 'back.out(1.3)', fade: 0.2});
    if (c.variant === 'dots') s.points.forEach((_, j) => popOps(ops, `${id}-pt-${i}-${j}`, start, rt(s.time + 0.45 + j * 0.04), {from: 0}));
  });
}

export const radarChart = {
  id: 'radar-chart',
  describe: 'Radar (spider) chart: the grid lands, then each series\' shape grows out from the centre; 3–8 labelled axes.',
  params: {axes: '[string ≤ 16] 3–8', series: `[{values: [number ≥ 0 per axis], label? ≤ 20, color? (${tone})}] 1–3`, max: 'axis maximum (optional; default the largest value)', ...COMMON},
  events: ['build'], timing: TIMING, variants: RADAR_VARIANTS,
  resolve: radarResolve, view: radarView, timeline: radarTimeline
};

// ---------------------------------------------------------------------------
// sparkline: a compact KPI with its trend

const SPARK_VARIANTS = Object.freeze(['line', 'area', 'bars']);

function sparkResolve(params, ctx) {
  const b = createHBase('sparkline', params, ctx, {allowed: ['values', 'label', 'value', 'delta', 'format', 'at', 'tone', 'source'], required: ['values', 'label'], variants: SPARK_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  check.arr(p.values, 'params.values', 4, 60);
  const values = p.values.map((v, i) => check.num(v, `params.values[${i}]`, -1e12, 1e12));
  const fmt = numberFormat(check, p.format, 'params.format', {decimals: maxDecimals(values)});
  const color = toneColor(b, p.tone, 'params.tone');
  const labelText = check.str(p.label, 'params.label', 36);
  const last = values[values.length - 1], first = values[0];
  const valueText = p.value === undefined ? fmt.format(last) : check.str(String(p.value), 'params.value', 14);
  let delta = p.delta === undefined ? (first ? `${last >= first ? '+' : '−'}${Math.abs(Math.round((last - first) / Math.abs(first) * 100))}%` : null) : p.delta === false ? null : check.str(String(p.delta), 'params.delta', 10);
  const up = delta ? !/^[−-]/.test(delta) : true;
  const source = p.source === undefined ? null : check.str(p.source, 'params.source', 80);
  const W = rect.width;
  const card = {width: r2(Math.min(W, u(b.portrait ? 900 : 1100)))};
  const pad = r2(u(48));
  const inner = card.width - pad * 2;
  const labelFit = fitText(check, 'params.label', labelText, {family: 'body', width: inner, preferred: u(46), min: b.min.key, maxLines: 2});
  const valueSize = fitText(check, 'params.value', valueText, {family: 'display', width: inner * 0.62, preferred: u(150), min: b.min.key}).size;
  const deltaSize = r2(Math.max(b.min.meta, u(38)));
  const sparkH = r2(u(b.portrait ? 260 : 220));
  const sourceSize = source ? fitText(check, 'params.source', source, {family: 'meta', width: inner, preferred: u(26), min: b.min.meta}).size : 0;
  card.height = r2(pad + labelFit.size * 1.2 * labelFit.lines + u(16) + valueSize * 1.02 + u(32) + sparkH + (source ? u(24) + sourceSize * 1.3 : 0) + pad);
  if (card.height > rect.height) check.fail('params', 'card does not fit the rect; shorten the label or enlarge rect');
  card.x = r2((W - card.width) / 2); card.y = r2((rect.height - card.height) / 2);
  const lo = Math.min(...values), hi = Math.max(...values);
  const sp = {x: pad, y: r2(pad + labelFit.size * 1.2 * labelFit.lines + u(16) + valueSize * 1.02 + u(32)), width: inner, height: sparkH};
  const n = values.length;
  const X = j => r2(sp.x + sp.width * j / (n - 1)), Y = v => r2(sp.y + sp.height * (1 - (hi === lo ? 0.5 : (v - lo) / (hi - lo))) * 0.86 + sp.height * 0.07);
  const d = values.map((v, j) => `${j ? 'L' : 'M'}${X(j)} ${Y(v)}`).join(' ');
  const bars = b.variant === 'bars' ? values.map((v, j) => {
    const w = r2(sp.width / n * 0.64), h = r2(Math.max(u(6), sp.height * (hi === lo ? 0.5 : (v - Math.min(0, lo)) / (hi - Math.min(0, lo)))));
    return {x: r2(sp.x + sp.width * j / n + (sp.width / n - w) / 2), y: r2(sp.y + sp.height - h), width: w, height: h};
  }) : null;
  const {buildAt, buildEnd} = buildTimes(b, p, 1.4);
  const numeric = p.value === undefined;
  const content = {variant: b.variant, card, pad, label: {text: labelText, size: labelFit.size, lines: labelFit.lines}, value: {text: valueText, size: valueSize, y: r2(pad + labelFit.size * 1.2 * labelFit.lines + u(16))},
    delta: delta ? {text: delta, size: deltaSize, up} : null, sp, d, area: `${d} V${r2(sp.y + sp.height)} H${sp.x} Z`, bars, end: {x: X(n - 1), y: Y(last)}, color, source: source ? {text: source, size: sourceSize, y: r2(sp.y + sp.height + u(24))} : null,
    buildAt, buildEnd, samples: numeric ? countSamples(b.model, buildAt, 1.2, 'power3.out', first, last, fmt.format) : null, initial: numeric ? fmt.format(first) : valueText,
    panel: b.theme.panel, border: b.theme.border, ink: b.theme.foreground, muted: b.theme.muted, upColor: b.colors.primary, downColor: b.colors.accent, onUp: inkOn(b.colors, b.colors.primary), onDown: inkOn(b.colors, b.colors.accent)};
  return b.finish(content, {minTextPx: Math.min(labelFit.size, valueSize)});
}

function sparkView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const C = c.card;
  const inner = [];
  inner.push(label(null, c.pad, c.pad, r2(C.width - c.pad * 2), c.label.text, {size: c.label.size, family: fonts.body, color: c.muted, weight: 600, wrap: c.label.lines > 1}));
  inner.push(label(`${id}-value`, c.pad, c.value.y, r2(C.width - c.pad * 2), c.initial, {size: c.value.size, family: fonts.display, color: c.ink, lineHeight: 1.02}));
  if (c.delta) {
    const D = c.delta;
    const w = r2(textWidth(D.text, D.size, 'display') + 40 * u);
    inner.push(el('div', `${id}-delta`, abs(r2(C.width - c.pad - w), r2(c.value.y + c.value.size * 0.5 - D.size * 0.75), w, r2(D.size * 1.5), {borderRadius: 99, background: D.up ? c.upColor : c.downColor, opacity: 0}), [
      label(null, 0, r2(D.size * 0.17), w, D.text, {size: D.size, family: fonts.display, color: D.up ? c.onUp : c.onDown, align: 'center'})
    ]));
  }
  const S = c.sp;
  if (c.bars) c.bars.forEach((bar, j) => inner.push(el('div', `${id}-bar-${j}`, abs(bar.x, bar.y, bar.width, bar.height, {borderRadius: r2(4 * u), background: j === c.bars.length - 1 ? c.color : `${c.color}80`, transformOrigin: '50% 100%', transform: transformString({scaleY: 0})}))));
  else {
    const paths = [];
    if (c.variant === 'area') paths.push(el('defs', null, null, [el('linearGradient', `${id}-grad`, null, [el('stop', null, null, [], {offset: '0%', stopColor: c.color, stopOpacity: 0.45}), el('stop', null, null, [], {offset: '100%', stopColor: c.color, stopOpacity: 0})], {x1: 0, y1: 0, x2: 0, y2: 1})]),
      el('path', null, null, [], {d: c.area, fill: `url(#${id}-grad)`}));
    paths.push(el('path', null, null, [], {d: c.d, stroke: c.color, strokeWidth: r2(6 * u), strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none'}));
    inner.push(el('div', `${id}-spark`, {...abs(0, 0, C.width, C.height), clipPath: 'inset(0% 100% 0% 0%)'}, [svgRoot(C.width, C.height, paths)]));
    const d = r2(22 * u);
    inner.push(el('div', `${id}-end`, abs(r2(c.end.x - d / 2), r2(c.end.y - d / 2), d, d, {borderRadius: '50%', background: c.color, boxShadow: `0 0 0 ${r2(8 * u)}px ${c.color}40`, opacity: 0})));
  }
  if (c.source) inner.push(label(`${id}-source`, c.pad, c.source.y, r2(C.width - c.pad * 2), c.source.text, {size: c.source.size, family: fonts.meta, color: c.muted, spacing: '0.06em', extra: {opacity: 0}}));
  return [el('div', `${id}-card`, abs(C.x, C.y, C.width, C.height, {boxSizing: 'border-box', borderRadius: r2(36 * u), background: c.panel, border: `${r2(2 * u)}px solid ${c.border}`}), inner)];
}

function sparkTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  if (c.samples) countOps(ops, `${id}-value`, start, c.initial, c.samples);
  if (c.bars) c.bars.forEach((_, j) => {
    set(ops, `${id}-bar-${j}`, start, {x: 0, y: 0, scaleX: 1, scaleY: 0});
    tw(ops, `${id}-bar-${j}`, rt(c.buildAt + 1.0 * j / c.bars.length), 0.4, 'power3.out', {scaleY: 0}, {scaleY: 1});
  });
  else {
    set(ops, `${id}-spark`, start, clip(0, 100, 0, 0));
    tw(ops, `${id}-spark`, c.buildAt, 1.2, 'power2.inOut', clip(0, 100, 0, 0), clip(0, 0, 0, 0));
    popOps(ops, `${id}-end`, start, rt(c.buildAt + 1.15), {from: 0});
  }
  if (c.delta) popOps(ops, `${id}-delta`, start, rt(c.buildAt + 1.2), {from: 0.6});
  if (c.source) riseOps(ops, `${id}-source`, start, rt(c.buildAt + 1.3), r2(8 * u));
}

export const sparkline = {
  id: 'sparkline',
  describe: 'A KPI card: label, a value that counts along its trend, a delta chip and the sparkline drawing on (line, area or bars).',
  params: {values: '[number] 4–60, oldest first', label: 'string ≤ 36, required', value: 'headline text (optional; default the last value, counted)', delta: 'string ≤ 10 such as "+12%" (default from first to last) or false',
    format: FORMAT_PARAM, tone: `line colour (${tone})`, source: 'string ≤ 80 (optional)', at: `build start: ${at}`, variant: VARIANT_PARAM, rect},
  events: ['build'], timing: TIMING, variants: SPARK_VARIANTS,
  resolve: sparkResolve, view: sparkView, timeline: sparkTimeline
};

// ---------------------------------------------------------------------------
// progress-ring

const RING_VARIANTS = Object.freeze(['ring', 'thick', 'segmented', 'half']);
const SEGMENTS = 40;

function ringResolve(params, ctx) {
  const b = createHBase('progress-ring', params, ctx, {allowed: ['value', 'max', 'label', 'format', 'at', 'tone', 'sub'], required: ['value', 'label'], variants: RING_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  const max = p.max === undefined ? 100 : check.num(p.max, 'params.max', 1e-9, 1e12);
  const value = check.num(p.value, 'params.value', 0, max);
  const fmt = numberFormat(check, p.format ?? (p.max === undefined ? {style: 'percent'} : undefined), 'params.format', {decimals: decimalsOf(value)});
  const color = toneColor(b, p.tone, 'params.tone');
  const labelText = check.str(p.label, 'params.label', 40);
  const sub = p.sub === undefined ? null : check.str(p.sub, 'params.sub', 60);
  const half = b.variant === 'half';
  const W = rect.width, H = rect.height;
  const labelFit = fitText(check, 'params.label', labelText, {family: 'body', width: W, preferred: u(52), min: b.min.key, maxLines: 2});
  const subFit = sub ? fitText(check, 'params.sub', sub, {family: 'meta', width: W, preferred: u(28), min: b.min.meta, maxLines: 1}) : null;
  const textH = labelFit.size * 1.2 * labelFit.lines + u(36) + (subFit ? subFit.size * 1.3 + u(12) : 0);
  let size = Math.min(W, (H - textH) * (half ? 2 : 1) - u(10), u(760));
  size = r2(size);
  if (size < u(320)) check.fail('params', 'leaves too little room for the ring; shorten the label or enlarge rect');
  const chartH = half ? r2(size / 2 + u(20)) : size;
  const oy = r2((H - chartH - textH) / 2), cx = r2(W / 2), cy = r2(oy + size / 2);
  const thickness = r2(size * (b.variant === 'thick' ? 0.17 : b.variant === 'segmented' ? 0.12 : half ? 0.13 : 0.075));
  const radius = r2(size / 2 - thickness / 2);
  const a0 = half ? 180 : -90, span = half ? 180 : 360;
  const frac = value / max;
  const valueSize = fitText(check, 'params.value', fmt.format(value), {family: 'display', width: (radius - thickness / 2) * (half ? 1.6 : 1.5), preferred: u(170), min: b.min.key}).size;
  const {buildAt, buildEnd} = buildTimes(b, p, 1.5);
  const fill = {at: buildAt, duration: 1.3, ease: 'power3.out'};
  const segments = b.variant === 'segmented' ? Array.from({length: SEGMENTS}, (_, i) => {
    const s0 = a0 + span * i / SEGMENTS + 1.6, s1 = a0 + span * (i + 1) / SEGMENTS - 1.6;
    const on = (i + 0.5) / SEGMENTS <= frac + 1e-9;
    // The segment lights when the eased fill passes its middle.
    const f = (i + 0.5) / SEGMENTS / Math.max(frac, 1e-9);
    return {d: arcPath(cx, cy, radius, s0, s1), on, time: on ? rt(fill.at + fill.duration * (1 - Math.pow(1 - Math.min(1, f), 1 / 4))) : null};
  }) : null;
  const content = {variant: b.variant, cx, cy, radius, thickness, a0, span, frac, color, glow: `${color}55`, segments, track: b.theme.panel, fill,
    value: {initial: fmt.format(0), size: valueSize, y: r2(half ? cy - valueSize * 1.02 : cy - valueSize * 0.55), samples: countSamples(b.model, fill.at, fill.duration, fill.ease, 0, value, fmt.format)},
    label: {text: labelText, size: labelFit.size, lines: labelFit.lines, y: r2(oy + chartH + u(36))}, sub: subFit ? {text: sub, size: subFit.size, y: r2(oy + chartH + u(36) + labelFit.size * 1.2 * labelFit.lines + u(12))} : null,
    buildAt, buildEnd, ink: b.theme.foreground, muted: b.theme.muted};
  return b.finish(content, {minTextPx: Math.min(labelFit.size, valueSize)});
}

function ringView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const W = model.rect.width, H = model.rect.height;
  const kids = [];
  if (c.segments) {
    // Track segments underneath; lit copies fade in as the fill passes them.
    const under = c.segments.map(s => el('path', null, null, [], {d: s.d, stroke: c.track, strokeWidth: c.thickness, fill: 'none'}));
    const lit = c.segments.map((s, i) => (s.on ? el('path', `${id}-seg-${i}`, {opacity: 0}, [], {d: s.d, stroke: c.color, strokeWidth: c.thickness, fill: 'none'}) : null)).filter(Boolean);
    kids.push(svgRoot(W, H, [...under, ...lit]));
  } else {
    const ring = arcPath(c.cx, c.cy, c.radius, c.a0, c.a0 + c.span);
    kids.push(svgRoot(W, H, [el('path', null, null, [], {d: ring, stroke: c.track, strokeWidth: c.thickness, fill: 'none', strokeLinecap: 'round'}), strokePath(`${id}-arc`, ring, c.color, c.thickness)]));
  }
  const vw = r2(c.radius * 2);
  kids.push(label(`${id}-value`, r2(c.cx - vw / 2), c.value.y, vw, c.value.initial, {size: c.value.size, family: fonts.display, color: c.ink, align: 'center', lineHeight: 1.1}));
  kids.push(label(`${id}-label`, 0, c.label.y, W, c.label.text, {size: c.label.size, family: fonts.body, color: c.ink, align: 'center', weight: 650, wrap: c.label.lines > 1, extra: {opacity: 0}}));
  if (c.sub) kids.push(label(`${id}-sub`, 0, c.sub.y, W, c.sub.text, {size: c.sub.size, family: fonts.meta, color: c.muted, align: 'center', spacing: '0.06em', extra: {opacity: 0}}));
  return kids;
}

function ringTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  if (c.segments) c.segments.forEach((s, i) => {
    if (!s.on) return;
    set(ops, `${id}-seg-${i}`, start, {opacity: 0});
    tw(ops, `${id}-seg-${i}`, s.time, 0.12, 'power1.out', {opacity: 0}, {opacity: 1});
  });
  else drawOps(ops, `${id}-arc`, start, c.fill.at, c.fill.duration, c.fill.ease, r2(1 - c.frac));
  countOps(ops, `${id}-value`, start, c.value.initial, c.value.samples);
  riseOps(ops, `${id}-label`, start, rt(c.buildAt + 0.15), r2(14 * u));
  if (c.sub) riseOps(ops, `${id}-sub`, start, rt(c.buildAt + 0.3), r2(10 * u));
  const pulse = rt(c.fill.at + c.fill.duration);
  tw(ops, `${id}-value`, pulse, 0.4, 'back.out(2.5)', {scaleX: 0.92, scaleY: 0.92}, {scaleX: 1, scaleY: 1});
}

export const progressRing = {
  id: 'progress-ring',
  describe: 'A ring (or half dial) fills to a value while the centre counts up, with a label below; plain, thick, segmented or half.',
  params: {value: 'number, required (0..max)', max: 'number (default 100: the value is a percent)', label: 'string ≤ 40, required', sub: 'string ≤ 60 (optional)', format: FORMAT_PARAM, tone: `ring colour (${tone})`, at: `fill start: ${at}`, variant: VARIANT_PARAM, rect},
  events: ['build'], timing: TIMING, variants: RING_VARIANTS,
  resolve: ringResolve, view: ringView, timeline: ringTimeline
};

export const CHARTS = [barChart, stackedBar, pieChart, areaChart, scatterPlot, radarChart, sparkline, progressRing];
