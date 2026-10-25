// Catalogue H flow and table charts: funnel-chart, waterfall, sankey,
// heatmap, leaderboard and comparison-table. Each animates its build from
// params data; registered in kit/core/catalog-h.mjs.

import {decimalsOf, timingRules} from './catalog-b-base.mjs';
import {svgRoot, transformString} from './catalog-b-view.mjs';
import {VARIANT_PARAM, FORMAT_PARAM, contrastRatio, createHBase, dataRows, fitText, inkOn, mixColor, numberFormat, r2, rt, stagger, textWidth, titleBlock, toneColor} from './catalog-h-base.mjs';
import {abs, chromeNodes, chromeOps, countOps, countSamples, drawOps, el, fadeOps, label, popOps, riseOps, set, strokePath, tw} from './catalog-h-view.mjs';
import {iconNode, isIcon} from './icons.mjs';

const at = 'seconds from scene start (optional; else a matching hit, else a default)';
const rect = '{x, y, width, height} canvas px inside the safe zone (optional)';
const COMMON = {title: 'string ≤ 60 (optional)', source: 'string ≤ 80, where the numbers come from (optional)', at: `build start: ${at}`, variant: VARIANT_PARAM, rect};
const tone = 'primary | accent | paper | #rrggbb';
const TIMING = timingRules({rules: ['the build runs about 1.2–1.8 s from at; highlight.at comes after the build']});
const maxDecimals = values => Math.max(0, ...values.map(decimalsOf));

function buildTimes(b, p, span, {highlight = false} = {}) {
  const buildAt = b.timeOf('build', p.at, 'params.at', 0.5);
  const buildEnd = rt(Math.min(buildAt + span, b.start + b.lastEvent));
  b.events.push({id: `${b.id}-build`, name: 'build', time: buildAt, endTime: buildEnd, role: 'emphasis', cue: 'riser-short'});
  let highlightAt = null;
  if (highlight) {
    highlightAt = b.timeOf('highlight', p.highlightAt, 'params.highlightAt', Math.min(b.lastEvent, buildEnd - b.start + 0.35), {min: buildEnd - b.start - 1e-6});
    b.events.push({id: `${b.id}-highlight`, name: 'highlight', time: highlightAt, endTime: rt(highlightAt + 0.4), role: 'emphasis', cue: 'hit-soft'});
  }
  return {buildAt, buildEnd, highlightAt};
}

// ---------------------------------------------------------------------------
// funnel-chart

const FUNNEL_VARIANTS = Object.freeze(['tapered', 'bars', 'steps']);

function funnelResolve(params, ctx) {
  const b = createHBase('funnel-chart', params, ctx, {allowed: ['stages', 'title', 'source', 'format', 'at', 'rates', 'tone'], required: ['stages'], variants: FUNNEL_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  const stages = dataRows(b, p.stages, 'params.stages', {min: 2, max: 6, labelMax: 24});
  const fmt = numberFormat(check, p.format, 'params.format', {decimals: maxDecimals(stages.map(s => s.value))});
  const rates = p.rates === undefined ? true : check.bool(p.rates, 'params.rates');
  const base = toneColor(b, p.tone, 'params.tone');
  const top = stages[0].value;
  if (!(top > 0)) check.fail('params.stages[0].value', 'must be above 0');
  const tb = titleBlock(b, {title: p.title, source: p.source});
  const W = rect.width, H = rect.height - tb.top - tb.bottom;
  const n = stages.length;
  const rateH = rates ? u(54) : u(14);
  const rowH = r2(Math.min(u(170), (H - rateH * (n - 1)) / n));
  if (rowH < u(84)) check.fail('params.stages', 'has too many stages for the height; use fewer or enlarge rect');
  const labelSize = Math.min(...stages.map((s, i) => fitText(check, `params.stages[${i}].label`, s.label, {family: 'body', width: W * 0.5, preferred: u(40), min: b.min.meta}).size));
  const valueSize = r2(Math.max(b.min.meta, Math.min(u(56), rowH * 0.42)));
  const rateSize = r2(Math.max(b.min.meta, u(28)));
  const totalH = rowH * n + rateH * (n - 1);
  const y0 = r2(tb.top + (H - totalH) / 2);
  const shades = stages.map((s, i) => s.color ?? mixColor(base, b.colors.bg, 1 - i * 0.55 / Math.max(1, n - 1)));
  const {buildAt, buildEnd} = buildTimes(b, p, 0.4 * n + 0.6);
  const starts = stagger(buildAt, n, 0.4 * (n - 1), 0.4);
  const minW = Math.min(W, Math.max(W * 0.34, ...stages.map(s => textWidth(s.label, labelSize, 'body') + u(56))));
  const rows = stages.map((s, i) => {
    const frac = s.value / top;
    const width = r2(b.variant === 'steps' ? W * (1 - 0.55 * i / Math.max(1, n - 1)) : Math.max(minW, W * frac));
    const next = i < n - 1 ? r2(Math.max(minW, W * stages[i + 1].value / top)) : r2(width * 0.82);
    const y = r2(y0 + i * (rowH + rateH));
    const ink = inkOn(b.colors, shades[i]);
    return {label: s.label, value: fmt.format(s.value), color: shades[i], ink, x: r2((W - width) / 2), y, width, height: rowH, next, time: starts[i],
      samples: countSamples(b.model, starts[i], 0.7, 'power3.out', 0, s.value, fmt.format), initial: fmt.format(0),
      rate: rates && i > 0 ? {text: `${Math.round(s.value / stages[i - 1].value * 100)}%`, y: r2(y - rateH + (rateH - rateSize * 1.4) / 2)} : null};
  });
  const content = {variant: b.variant, title: tb.title, source: tb.source, rows, labelSize, valueSize, rateSize, buildAt, buildEnd, W, muted: b.theme.muted, align: 'center'};
  return b.finish(content, {minTextPx: tb.title ? tb.title.size : b.min.key});
}

function funnelView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const kids = chromeNodes(model);
  c.rows.forEach((row, i) => {
    const inset = c.variant === 'tapered' ? r2(Math.max(0, (row.width - row.next) / 2 / row.width * 100)) : 0;
    const shape = c.variant === 'tapered' ? {clipPath: `polygon(0% 0%, 100% 0%, ${r2(100 - inset)}% 100%, ${inset}% 100%)`} : {borderRadius: r2(18 * u)};
    kids.push(el('div', `${id}-stage-${i}`, {...abs(row.x, row.y, row.width, row.height), background: row.color, ...shape, transformOrigin: '50% 50%', transform: transformString({scaleX: 0})}));
    kids.push(el('div', `${id}-text-${i}`, {...abs(0, row.y, c.W, row.height), opacity: 0}, [
      label(null, 0, r2(row.height / 2 - c.labelSize * 1.2 - 2 * u), c.W, row.label, {size: c.labelSize, family: fonts.body, color: row.ink, align: 'center', weight: 650}),
      label(`${id}-value-${i}`, 0, r2(row.height / 2), c.W, row.initial, {size: c.valueSize, family: fonts.display, color: row.ink, align: 'center', lineHeight: 1.05})
    ]));
    if (row.rate) kids.push(el('div', `${id}-rate-${i}`, {...abs(0, row.rate.y, c.W, r2(c.rateSize * 1.4)), opacity: 0}, [
      label(null, 0, 0, c.W, `↓ ${row.rate.text}`, {size: c.rateSize, family: fonts.meta, color: c.muted, align: 'center', lineHeight: 1.4, spacing: '0.06em'})
    ]));
  });
  return kids;
}

function funnelTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  chromeOps(model, ops);
  c.rows.forEach((row, i) => {
    set(ops, `${id}-stage-${i}`, start, {x: 0, y: 0, scaleX: 0, scaleY: 1});
    tw(ops, `${id}-stage-${i}`, row.time, 0.6, 'power3.out', {scaleX: 0}, {scaleX: 1});
    riseOps(ops, `${id}-text-${i}`, start, rt(row.time + 0.15), r2(10 * u), {duration: 0.4});
    countOps(ops, `${id}-value-${i}`, start, row.initial, row.samples);
    if (row.rate) popOps(ops, `${id}-rate-${i}`, start, rt(row.time - 0.12), {from: 0.7});
  });
}

export const funnelChart = {
  id: 'funnel-chart',
  describe: 'A conversion funnel: stages widen in top to bottom with counting values and the step-to-step rate between them; tapered, bars or steps.',
  params: {stages: `[{label ≤ 24, value ≥ 0, color? (${tone})}] 2–6, widest first`, rates: 'boolean: show each step\'s conversion (default true)', format: FORMAT_PARAM, tone: `base colour (${tone})`, ...COMMON},
  events: ['build'], timing: TIMING, variants: FUNNEL_VARIANTS,
  resolve: funnelResolve, view: funnelView, timeline: funnelTimeline
};

// ---------------------------------------------------------------------------
// waterfall

const WATERFALL_VARIANTS = Object.freeze(['bridge', 'floating']);

function waterfallResolve(params, ctx) {
  const b = createHBase('waterfall', params, ctx, {allowed: ['opening', 'steps', 'total', 'title', 'source', 'format', 'at'], required: ['opening', 'steps'], variants: WATERFALL_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  check.obj(p.opening, 'params.opening', ['label', 'value'], ['label', 'value']);
  const first = {label: check.str(p.opening.label, 'params.opening.label', 16), value: check.num(p.opening.value, 'params.opening.value', -1e12, 1e12)};
  check.arr(p.steps, 'params.steps', 1, 8);
  const steps = p.steps.map((s, i) => {
    check.obj(s, `params.steps[${i}]`, ['label', 'delta'], ['label', 'delta']);
    return {label: check.str(s.label, `params.steps[${i}].label`, 16), delta: check.num(s.delta, `params.steps[${i}].delta`, -1e12, 1e12)};
  });
  const totalLabel = p.total === undefined ? 'Total' : check.str(p.total, 'params.total', 16);
  const fmt = numberFormat(check, p.format, 'params.format', {decimals: maxDecimals([first.value, ...steps.map(s => s.delta)])});
  const signed = v => `${v >= 0 ? '+' : ''}${fmt.format(v)}`;
  // Running levels.
  let level = first.value;
  const cols = [{label: first.label, from: 0, to: first.value, text: fmt.format(first.value), kind: 'total'}];
  for (const s of steps) { cols.push({label: s.label, from: level, to: level + s.delta, text: signed(s.delta), kind: s.delta >= 0 ? 'up' : 'down'}); level += s.delta; }
  cols.push({label: totalLabel, from: 0, to: level, text: fmt.format(level), kind: 'total'});
  const lo = Math.min(0, ...cols.map(c => Math.min(c.from, c.to))), hi = Math.max(...cols.map(c => Math.max(c.from, c.to)));
  if (!(hi > lo)) check.fail('params', 'needs values that span a range');
  const tb = titleBlock(b, {title: p.title, source: p.source});
  const W = rect.width, n = cols.length;
  const colors = {total: b.colors.paper, up: b.colors.primary, down: b.colors.accent};
  const pathOf = i => (i === 0 ? 'params.opening.label' : i === n - 1 ? 'params.total' : `params.steps[${i - 1}].label`);
  const {buildAt, buildEnd} = buildTimes(b, p, 0.28 * n + 0.6);
  const starts = stagger(buildAt, n, 0.28 * (n - 1), 0.28);
  // Columns when every label fits its slot; otherwise rows (bars run sideways).
  let layout = 'vertical', labelSize, valueSize;
  const slot = W / n;
  try {
    labelSize = Math.min(...cols.map((c, i) => fitText(check, pathOf(i), c.label, {family: 'body', width: slot - u(8), preferred: u(32), min: b.min.meta, maxLines: 2}).size));
    valueSize = Math.min(...cols.map(c => fitText(check, 'params.steps', c.text, {family: 'display', width: slot - u(4), preferred: u(44), min: b.min.meta}).size));
  } catch { layout = 'horizontal'; }
  let bars, baseline;
  if (layout === 'vertical') {
    const top = r2(tb.top + valueSize * 1.25 + u(8)), bottom = r2(rect.height - tb.bottom - labelSize * 2.4 - u(18));
    if (bottom - top < u(240)) check.fail('params', 'leaves too little height for the columns; drop the title or enlarge rect');
    const Y = v => r2(top + (bottom - top) * (1 - (v - lo) / (hi - lo)));
    const barW = r2(Math.min(slot * 0.66, u(150)));
    baseline = {y: Y(0)};
    bars = cols.map((c, i) => {
      const y1 = Y(Math.max(c.from, c.to)), y2 = Y(Math.min(c.from, c.to));
      const grows = c.to >= c.from ? 'up' : 'down';
      return {label: c.label, text: c.text, kind: c.kind, color: colors[c.kind], x: r2(slot * i + (slot - barW) / 2), y: y1, width: barW, height: r2(Math.max(u(4), y2 - y1)), origin: grows === 'up' ? '50% 100%' : '50% 0%', time: starts[i],
        labelBox: {x: r2(slot * i + u(4)), y: r2(bottom + u(14)), width: r2(slot - u(8)), align: 'center'}, value: {x: r2(slot * i), y: r2(grows === 'up' || c.kind === 'total' ? y1 - valueSize * 1.2 - u(4) : y2 + u(6)), width: r2(slot), align: 'center'},
        connector: i < n - 1 ? {x: r2(slot * i + (slot + barW) / 2), y: Y(c.to), width: r2(slot - barW), height: r2(2 * u(1))} : null};
    });
  } else {
    const H = rect.height - tb.top - tb.bottom;
    const rowH = r2(Math.min(u(130), H / n));
    labelSize = Math.min(...cols.map((c, i) => fitText(check, pathOf(i), c.label, {family: 'body', width: W * 0.3, preferred: Math.min(u(36), rowH * 0.36), min: b.min.meta}).size));
    valueSize = r2(Math.max(b.min.meta, Math.min(u(40), rowH * 0.34)));
    const labelW = r2(W * 0.32), valueW = r2(Math.max(...cols.map(c => textWidth(c.text, valueSize, 'display'))) + u(16));
    const x0 = r2(labelW + u(16)), x1 = r2(W - valueW);
    if (x1 - x0 < u(200)) check.fail('params', 'leaves too little width for the bars; shorten the values or enlarge rect');
    const X = v => r2(x0 + (x1 - x0) * (v - lo) / (hi - lo));
    const thick = r2(rowH * 0.56), y0 = r2(tb.top + (H - rowH * n) / 2);
    baseline = {x: X(0), y0, height: r2(rowH * n)};
    bars = cols.map((c, i) => {
      const xa = X(Math.min(c.from, c.to)), xb = X(Math.max(c.from, c.to));
      const right = c.to >= c.from;
      const y = r2(y0 + i * rowH + (rowH - thick) / 2);
      return {label: c.label, text: c.text, kind: c.kind, color: colors[c.kind], x: xa, y, width: r2(Math.max(u(4), xb - xa)), height: thick, origin: right ? '0% 50%' : '100% 50%', horizontal: true, time: starts[i],
        labelBox: {x: 0, y: r2(y + thick / 2 - labelSize * 0.6), width: labelW, align: 'right'}, value: {x: r2(xb + u(10)), y: r2(y + thick / 2 - valueSize * 0.6), width: valueW, align: 'left'},
        connector: i < n - 1 ? {x: r2(X(c.to) - u(1)), y: r2(y + thick), width: r2(u(2)), height: r2(rowH - thick), vertical: true} : null};
    });
  }
  const content = {variant: b.variant, layout, title: tb.title, source: tb.source, bars, labelSize, valueSize, baseline, W, buildAt, buildEnd, muted: b.theme.muted, ink: b.theme.foreground, border: b.theme.border};
  return b.finish(content, {minTextPx: tb.title ? tb.title.size : b.min.key});
}

function waterfallView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const kids = chromeNodes(model);
  kids.push(el('div', `${id}-base`, c.layout === 'vertical' ? abs(0, r2(c.baseline.y - u), c.W, r2(2 * u), {background: c.border}) : abs(r2(c.baseline.x - u), c.baseline.y0, r2(2 * u), c.baseline.height, {background: c.border})));
  c.bars.forEach((bar, i) => {
    const C = bar.connector;
    if (C && c.variant === 'bridge') kids.push(el('div', `${id}-link-${i}`, abs(C.x, C.vertical ? C.y : r2(C.y - u), C.width, C.vertical ? C.height : r2(2 * u), {
      background: `repeating-linear-gradient(${C.vertical ? '180deg' : '90deg'}, ${c.muted} 0px, ${c.muted} ${r2(6 * u)}px, transparent ${r2(6 * u)}px, transparent ${r2(11 * u)}px)`,
      transformOrigin: C.vertical ? '50% 0%' : '0% 50%', transform: transformString(C.vertical ? {scaleY: 0} : {scaleX: 0})})));
    kids.push(el('div', `${id}-bar-${i}`, {...abs(bar.x, bar.y, bar.width, bar.height), borderRadius: r2(c.variant === 'floating' ? 14 * u : 6 * u), background: bar.color,
      ...(c.variant === 'floating' && bar.kind !== 'total' ? {boxShadow: `0 ${r2(14 * u)}px ${r2(30 * u)}px #00000080`} : {}), transformOrigin: bar.origin, transform: transformString(bar.horizontal ? {scaleX: 0} : {scaleY: 0})}));
    kids.push(label(`${id}-value-${i}`, bar.value.x, bar.value.y, bar.value.width, bar.text, {size: c.valueSize, family: fonts.display, color: bar.kind === 'total' ? c.ink : bar.color, align: bar.value.align, extra: {opacity: 0}}));
    kids.push(label(`${id}-label-${i}`, bar.labelBox.x, bar.labelBox.y, bar.labelBox.width, bar.label, {size: c.labelSize, family: fonts.body, color: c.muted, align: bar.labelBox.align, weight: 600, wrap: !bar.horizontal, extra: {opacity: 0}}));
  });
  return kids;
}

function waterfallTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  chromeOps(model, ops);
  c.bars.forEach((bar, i) => {
    const from = bar.horizontal ? {scaleX: 0, scaleY: 1} : {scaleX: 1, scaleY: 0};
    set(ops, `${id}-bar-${i}`, start, {x: 0, y: 0, ...from});
    tw(ops, `${id}-bar-${i}`, bar.time, 0.45, 'power3.out', from, {scaleX: 1, scaleY: 1});
    popOps(ops, `${id}-value-${i}`, start, rt(bar.time + 0.3), {from: 0.7});
    riseOps(ops, `${id}-label-${i}`, start, rt(bar.time), r2(10 * u), {duration: 0.35});
    if (bar.connector && c.variant === 'bridge') {
      const from = bar.connector.vertical ? {scaleX: 1, scaleY: 0} : {scaleX: 0, scaleY: 1};
      set(ops, `${id}-link-${i}`, start, {x: 0, y: 0, ...from});
      tw(ops, `${id}-link-${i}`, rt(bar.time + 0.35), 0.25, 'power2.out', from, {scaleX: 1, scaleY: 1});
    }
  });
}

export const waterfall = {
  id: 'waterfall',
  describe: 'A waterfall (bridge) chart: a starting total, each gain or loss stepping from the last level, and the resulting total; gains in primary, losses in accent.',
  params: {opening: '{label ≤ 16, value}, the starting total', steps: '[{label ≤ 16, delta (+ or −)}] 1–8', total: 'end column label ≤ 16 (default "Total")', format: FORMAT_PARAM, ...COMMON},
  events: ['build'], timing: TIMING, variants: WATERFALL_VARIANTS,
  resolve: waterfallResolve, view: waterfallView, timeline: waterfallTimeline
};

// ---------------------------------------------------------------------------
// sankey

const SANKEY_VARIANTS = Object.freeze(['ribbons', 'lines']);

function sankeyResolve(params, ctx) {
  const b = createHBase('sankey', params, ctx, {allowed: ['flows', 'title', 'source', 'format', 'at'], required: ['flows'], variants: SANKEY_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  check.arr(p.flows, 'params.flows', 2, 14);
  const flows = p.flows.map((f, i) => {
    check.obj(f, `params.flows[${i}]`, ['from', 'to', 'value'], ['from', 'to', 'value']);
    const from = check.str(f.from, `params.flows[${i}].from`, 18), to = check.str(f.to, `params.flows[${i}].to`, 18);
    if (from === to) check.fail(`params.flows[${i}]`, 'must link two different nodes');
    return {from, to, value: check.num(f.value, `params.flows[${i}].value`, 1e-9, 1e12)};
  });
  const fmt = numberFormat(check, p.format, 'params.format', {decimals: maxDecimals(flows.map(f => f.value))});
  // Layers: a node's column is the longest path into it.
  const names = [...new Set(flows.flatMap(f => [f.from, f.to]))];
  const layer = Object.fromEntries(names.map(name => [name, 0]));
  for (let pass = 0; pass <= names.length; pass++) {
    let changed = false;
    for (const f of flows) if (layer[f.to] < layer[f.from] + 1) { layer[f.to] = layer[f.from] + 1; changed = true; }
    if (!changed) break;
    if (pass === names.length) check.fail('params.flows', 'must not loop back on themselves');
  }
  const layers = Math.max(...Object.values(layer)) + 1;
  if (layers > 4) check.fail('params.flows', 'may run through at most 4 columns of nodes');
  const inflow = name => flows.filter(f => f.to === name).reduce((s, f) => s + f.value, 0);
  const outflow = name => flows.filter(f => f.from === name).reduce((s, f) => s + f.value, 0);
  const size = name => Math.max(inflow(name), outflow(name));
  const tb = titleBlock(b, {title: p.title, source: p.source});
  const W = rect.width, H = rect.height - tb.top - tb.bottom;
  const labelSize = r2(Math.max(b.min.meta, u(30)));
  const columns = Array.from({length: layers}, (_, k) => names.filter(name => layer[name] === k));
  const nodeW = r2(u(26));
  const gap = r2(u(38));
  // Labels sit beside the nodes: left of the first column's nodes would
  // leave the rect, so the first column labels right, the others left.
  const widest = Math.max(...names.map(name => Math.max(textWidth(name, labelSize, 'body'), textWidth(fmt.format(size(name)), labelSize, 'display'))));
  const usableH = H - labelSize * 0.6;
  const scale = Math.min(...columns.map(col => (usableH - gap * (col.length - 1)) / col.reduce((s, name) => s + size(name), 0)));
  if (!(scale > 0)) check.fail('params.flows', 'has too many nodes in one column for the height');
  const span = W - nodeW - widest - u(22);
  const xOf = k => r2(layers === 1 ? 0 : span * k / (layers - 1));
  if (layers > 1 && span / (layers - 1) < widest + u(80)) check.fail('params.flows', 'node names are too long for the width; shorten them or use fewer columns');
  const nodes = {};
  const palette = b.series(names.length);
  columns.forEach((col, k) => {
    const total = col.reduce((s, name) => s + size(name), 0) * scale + gap * (col.length - 1);
    let y = tb.top + (H - total) / 2;
    col.forEach(name => {
      const h = r2(Math.max(u(6), size(name) * scale));
      nodes[name] = {name, k, x: xOf(k), y: r2(y), height: h, color: palette[names.indexOf(name)], outY: r2(y), inY: r2(y), value: fmt.format(size(name))};
      y += h + gap;
    });
  });
  const {buildAt, buildEnd} = buildTimes(b, p, 0.5 + layers * 0.45);
  // Links leave their source in target order and enter in source order.
  const ordered = [...flows].sort((a, c) => nodes[a.from].y - nodes[c.from].y || nodes[a.to].y - nodes[c.to].y);
  const links = ordered.map((f, i) => {
    const s = nodes[f.from], t = nodes[f.to];
    const w = r2(f.value * scale);
    const y1 = r2(s.outY + w / 2), y2 = r2(t.inY + w / 2);
    s.outY = r2(s.outY + w); t.inY = r2(t.inY + w);
    const x1 = r2(s.x + nodeW), x2 = t.x, mx = r2((x1 + x2) / 2);
    return {d: `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`, width: b.variant === 'lines' ? r2(Math.max(u(4), Math.min(w, u(10)))) : w, color: s.color, time: rt(buildAt + 0.35 + s.k * 0.45 + i * 0.02)};
  });
  const nodeList = names.map(name => {
    const node = nodes[name];
    const right = true;
    const lw = r2(widest + u(8));
    return {...node, time: rt(buildAt + node.k * 0.45), label: {x: r2(right ? node.x + nodeW + u(14) : node.x - u(14) - lw), y: r2(node.y + node.height / 2 - labelSize * 1.25), width: lw, align: right ? 'left' : 'right'}};
  });
  // First-column labels sit on the ribbons, so they get a backing.
  const content = {variant: b.variant, title: tb.title, source: tb.source, nodes: nodeList, links, nodeW, labelSize, buildAt, buildEnd, ink: b.theme.foreground, muted: b.theme.muted, bg: b.colors.bg};
  return b.finish(content, {minTextPx: tb.title ? tb.title.size : b.min.key});
}

function sankeyView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const W = model.rect.width, H = model.rect.height;
  const kids = chromeNodes(model);
  kids.push(svgRoot(W, H, c.links.map((link, i) => strokePath(`${id}-link-${i}`, link.d, link.color, link.width, {opacity: c.variant === 'lines' ? 0.85 : 0.42, cap: 'butt'}))));
  c.nodes.forEach((node, i) => {
    kids.push(el('div', `${id}-node-${i}`, {...abs(node.x, node.y, c.nodeW, node.height), borderRadius: r2(6 * u), background: node.color, transformOrigin: '50% 50%', transform: transformString({scaleY: 0})}));
    kids.push(el('div', `${id}-name-${i}`, {...abs(node.label.x, node.label.y, node.label.width, r2(c.labelSize * 2.5)), opacity: 0}, [
      label(null, 0, 0, node.label.width, node.name, {size: c.labelSize, family: fonts.body, color: c.ink, align: node.label.align, weight: 650, extra: {textShadow: `0 0 ${r2(10 * u)}px ${c.bg}, 0 0 ${r2(4 * u)}px ${c.bg}`}}),
      label(null, 0, r2(c.labelSize * 1.25), node.label.width, node.value, {size: c.labelSize, family: fonts.display, color: c.muted, align: node.label.align, extra: {textShadow: `0 0 ${r2(10 * u)}px ${c.bg}`}})
    ]));
  });
  return kids;
}

function sankeyTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  chromeOps(model, ops);
  c.nodes.forEach((node, i) => {
    set(ops, `${id}-node-${i}`, start, {x: 0, y: 0, scaleX: 1, scaleY: 0});
    tw(ops, `${id}-node-${i}`, node.time, 0.45, 'power3.out', {scaleY: 0}, {scaleY: 1});
    riseOps(ops, `${id}-name-${i}`, start, rt(node.time + 0.15), r2(8 * u), {duration: 0.4});
  });
  c.links.forEach((link, i) => drawOps(ops, `${id}-link-${i}`, start, link.time, 0.7, 'power2.inOut'));
}

export const sankey = {
  id: 'sankey',
  describe: 'A Sankey flow diagram: nodes in up to four columns, with ribbons as wide as each flow drawing from source to target column by column.',
  params: {flows: '[{from ≤ 18, to ≤ 18, value > 0}] 2–14; node columns follow the links', format: FORMAT_PARAM, ...COMMON},
  events: ['build'], timing: TIMING, variants: SANKEY_VARIANTS,
  resolve: sankeyResolve, view: sankeyView, timeline: sankeyTimeline
};

// ---------------------------------------------------------------------------
// heatmap

const HEAT_VARIANTS = Object.freeze(['squares', 'circles', 'rounded']);

function heatResolve(params, ctx) {
  const b = createHBase('heatmap', params, ctx, {allowed: ['rows', 'columns', 'values', 'title', 'source', 'format', 'at', 'tone', 'showValues', 'low', 'high'], required: ['rows', 'columns', 'values'], variants: HEAT_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  check.arr(p.rows, 'params.rows', 1, 10);
  check.arr(p.columns, 'params.columns', 2, 14);
  const rows = p.rows.map((r, i) => check.str(String(r), `params.rows[${i}]`, 14));
  const cols = p.columns.map((c, i) => check.str(String(c), `params.columns[${i}]`, 8));
  check.arr(p.values, 'params.values', rows.length, rows.length);
  const values = p.values.map((row, i) => { check.arr(row, `params.values[${i}]`, cols.length, cols.length); return row.map((v, j) => check.num(v, `params.values[${i}][${j}]`, -1e12, 1e12)); });
  const flat = values.flat(), lo = Math.min(...flat), hi = Math.max(...flat);
  const fmt = numberFormat(check, p.format, 'params.format', {decimals: maxDecimals(flat)});
  const color = toneColor(b, p.tone, 'params.tone');
  const tb = titleBlock(b, {title: p.title, source: p.source});
  const labelSize = r2(Math.max(b.min.meta, u(28)));
  const rowLabelW = r2(Math.max(...rows.map(r => textWidth(r, labelSize, 'body'))) + u(18));
  const legendH = r2(labelSize * 1.4 + u(20));
  const W = rect.width - rowLabelW, H = rect.height - tb.top - tb.bottom - labelSize * 1.4 - u(12) - legendH;
  const cell = r2(Math.min(W / cols.length, H / rows.length, u(150)));
  if (cell < u(40)) check.fail('params', 'has too many cells for the space; use fewer rows or columns, or enlarge rect');
  const gridW = cell * cols.length, gridH = cell * rows.length;
  const ox = r2(rowLabelW + (W - gridW) / 2), oy = r2(tb.top + labelSize * 1.4 + u(12) + (H - gridH) / 2);
  const showValues = p.showValues === undefined ? cell >= u(84) : check.bool(p.showValues, 'params.showValues');
  const valueSize = r2(Math.max(b.min.meta, Math.min(u(34), cell * 0.3)));
  const empty = mixColor(b.colors.paper, b.colors.bg, 0.08);
  const {buildAt, buildEnd} = buildTimes(b, p, 1.5);
  const diag = rows.length + cols.length - 2 || 1;
  const cells = [];
  values.forEach((row, i) => row.forEach((v, j) => {
    const f = hi === lo ? 1 : (v - lo) / (hi - lo);
    const fill = mixColor(color, empty, 0.08 + 0.92 * f);
    cells.push({i, j, x: r2(ox + j * cell), y: r2(oy + i * cell), fill, text: fmt.format(v), ink: contrastRatio(b.colors.ink, fill) > contrastRatio(b.colors.paper, fill) ? b.colors.ink : b.colors.paper, time: rt(buildAt + 0.9 * (i + j) / diag)});
  }));
  const lowText = p.low === undefined ? fmt.format(lo) : check.str(p.low, 'params.low', 16);
  const highText = p.high === undefined ? fmt.format(hi) : check.str(p.high, 'params.high', 16);
  const content = {variant: b.variant, title: tb.title, source: tb.source, cells, cell, gap: r2(Math.max(2, cell * 0.08)), showValues, valueSize, labelSize,
    rowLabels: rows.map((r, i) => ({text: r, y: r2(oy + i * cell + cell / 2 - labelSize * 0.6)})), colLabels: cols.map((c, j) => ({text: c, x: r2(ox + j * cell)})), colY: r2(oy - labelSize * 1.4 - u(6)), rowLabelW,
    legend: {x: ox, y: r2(oy + gridH + u(20)), width: r2(Math.min(gridW, u(520))), low: lowText, high: highText, from: empty, to: color}, buildAt, buildEnd, muted: b.theme.muted};
  return b.finish(content, {minTextPx: tb.title ? tb.title.size : b.min.key});
}

function heatView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const kids = chromeNodes(model);
  const inner = r2(c.cell - c.gap);
  const radius = c.variant === 'circles' ? '50%' : c.variant === 'rounded' ? r2(inner * 0.24) : r2(3 * u);
  c.cells.forEach((cell, k) => kids.push(el('div', `${id}-cell-${k}`, abs(r2(cell.x + c.gap / 2), r2(cell.y + c.gap / 2), inner, inner, {borderRadius: radius, background: cell.fill, opacity: 0}),
    c.showValues ? [label(null, 0, r2(inner / 2 - c.valueSize * 0.6), inner, cell.text, {size: c.valueSize, family: fonts.display, color: cell.ink, align: 'center'})] : [])));
  c.rowLabels.forEach((r, i) => kids.push(label(`${id}-row-${i}`, 0, r.y, r2(c.rowLabelW - 12 * u), r.text, {size: c.labelSize, family: fonts.body, color: c.muted, align: 'right', weight: 600, extra: {opacity: 0}})));
  c.colLabels.forEach((col, j) => kids.push(label(`${id}-col-${j}`, col.x, c.colY, c.cell, col.text, {size: c.labelSize, family: fonts.meta, color: c.muted, align: 'center', extra: {opacity: 0}})));
  const L = c.legend;
  kids.push(el('div', `${id}-legend`, {...abs(L.x, L.y, L.width, r2(c.labelSize * 1.4)), opacity: 0}, [
    label(null, 0, 0, undefined, L.low, {size: c.labelSize, family: fonts.meta, color: c.muted, lineHeight: 1.4}),
    el('div', null, abs(r2(textWidth(L.low, c.labelSize, 'meta') + 14 * u), r2(c.labelSize * 0.45), r2(Math.max(40 * u, L.width - textWidth(L.low, c.labelSize, 'meta') - textWidth(L.high, c.labelSize, 'meta') - 28 * u)), r2(c.labelSize * 0.5), {borderRadius: 99, background: `linear-gradient(90deg, ${L.from}, ${L.to})`})),
    label(null, 0, 0, L.width, L.high, {size: c.labelSize, family: fonts.meta, color: c.muted, align: 'right', lineHeight: 1.4})
  ]));
  return kids;
}

function heatTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  chromeOps(model, ops);
  c.rowLabels.forEach((_, i) => riseOps(ops, `${id}-row-${i}`, start, rt(c.buildAt - 0.15 + i * 0.04), 0, {dx: r2(-10 * u), duration: 0.35}));
  c.colLabels.forEach((_, j) => riseOps(ops, `${id}-col-${j}`, start, rt(c.buildAt - 0.15 + j * 0.03), r2(8 * u), {duration: 0.35}));
  c.cells.forEach((cell, k) => popOps(ops, `${id}-cell-${k}`, start, cell.time, {from: 0.3, duration: 0.4, ease: 'back.out(1.8)', fade: 0.15}));
  riseOps(ops, `${id}-legend`, start, rt(c.buildEnd - 0.2), r2(8 * u));
}

export const heatmap = {
  id: 'heatmap',
  describe: 'A heatmap grid: labelled rows and columns whose cells pop in a diagonal wave, shaded from the panel to the brand tone by value, with a low–high legend.',
  params: {rows: '[string ≤ 14] 1–10', columns: '[string ≤ 8] 2–14', values: '[[number per column] per row]', showValues: 'boolean (default when cells are large enough)', low: 'legend low label (default the minimum)', high: 'legend high label (default the maximum)', format: FORMAT_PARAM, tone: `shade (${tone})`, ...COMMON},
  events: ['build'], timing: TIMING, variants: HEAT_VARIANTS,
  resolve: heatResolve, view: heatView, timeline: heatTimeline
};

// ---------------------------------------------------------------------------
// leaderboard

const LEADER_VARIANTS = Object.freeze(['bars', 'rows', 'cards']);

function leaderResolve(params, ctx) {
  const b = createHBase('leaderboard', params, ctx, {allowed: ['entries', 'title', 'source', 'format', 'at', 'highlight', 'highlightAt', 'sort'], required: ['entries'], variants: LEADER_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  let entries = dataRows(b, p.entries, 'params.entries', {min: 3, max: 8, labelMax: 24, extra: ['icon', 'detail']}).map((e, i) => {
    if (e.icon !== undefined && !isIcon(e.icon)) check.fail(`params.entries[${i}].icon`, 'must be an icon name from kit/core/icons.mjs');
    return {...e, detail: e.detail === undefined ? null : check.str(e.detail, `params.entries[${i}].detail`, 30), index: i};
  });
  const sort = p.sort === undefined ? true : check.bool(p.sort, 'params.sort');
  if (sort) entries = [...entries].sort((a, c) => c.value - a.value);
  const fmt = numberFormat(check, p.format, 'params.format', {decimals: maxDecimals(entries.map(e => e.value))});
  const highlight = p.highlight === undefined ? 0 : check.int(p.highlight, 'params.highlight', 0, entries.length - 1);
  const tb = titleBlock(b, {title: p.title, source: p.source});
  const W = rect.width, H = rect.height - tb.top - tb.bottom;
  const n = entries.length;
  const gap = r2(u(b.variant === 'cards' ? 16 : 8));
  const rowH = r2(Math.min(u(140), (H - gap * (n - 1)) / n));
  if (rowH < u(70)) check.fail('params.entries', 'has too many entries for the height');
  const nameSize = Math.min(...entries.map(e => fitText(check, `params.entries[${e.index}].label`, e.label, {family: 'body', width: W * 0.5, preferred: Math.min(u(44), rowH * 0.4), min: b.min.meta}).size));
  const valueSize = r2(Math.max(b.min.meta, Math.min(u(56), rowH * 0.46)));
  const detailSize = r2(Math.max(b.min.meta, u(26)));
  const max = Math.max(...entries.map(e => e.value)) || 1;
  const y0 = r2(tb.top + (H - (rowH * n + gap * (n - 1))) / 2);
  const {buildAt, buildEnd, highlightAt} = buildTimes(b, p, 0.15 * n + 1.0, {highlight: p.highlight !== undefined});
  // The board fills from the bottom up, so first place lands last.
  const rows = entries.map((e, i) => {
    const time = rt(buildAt + (n - 1 - i) * 0.15);
    const medal = i < 3 ? [b.colors.primary, mixColor(b.colors.paper, b.colors.bg, 0.75), mixColor(b.colors.accent, b.colors.bg, 0.8)][i] : null;
    return {rank: i + 1, label: e.label, detail: e.detail, icon: e.icon ?? null, value: e.value, text: fmt.format(e.value), y: r2(y0 + i * (rowH + gap)), frac: e.value / max, time,
      samples: countSamples(b.model, rt(time + 0.1), 0.8, 'power3.out', 0, e.value, fmt.format), initial: fmt.format(0), medal, color: e.color ?? (i === highlight ? b.colors.primary : mixColor(b.colors.paper, b.colors.bg, 0.3))};
  });
  const content = {variant: b.variant, portrait: b.portrait, title: tb.title, source: tb.source, rows, rowH, W, nameSize, valueSize, detailSize, highlight, highlightAt, buildAt, buildEnd,
    panel: b.theme.panel, border: b.theme.border, ink: b.theme.foreground, muted: b.theme.muted, bg: b.colors.bg, primary: b.colors.primary, onPrimary: inkOn(b.colors, b.colors.primary)};
  return b.finish(content, {minTextPx: tb.title ? tb.title.size : b.min.key});
}

function leaderView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const kids = chromeNodes(model);
  const R = c.rowH;
  c.rows.forEach((row, i) => {
    const lit = i === c.highlight;
    const badge = r2(R * 0.62);
    const inner = [];
    const bg = c.variant === 'cards' ? {borderRadius: r2(22 * u), background: lit ? c.primary : c.panel, border: `${r2(2 * u)}px solid ${lit ? c.primary : c.border}`}
      : c.variant === 'rows' ? {borderBottom: `${r2(2 * u)}px solid ${c.border}`} : {};
    const ink = c.variant === 'cards' && lit ? c.onPrimary : c.ink;
    const sub = c.variant === 'cards' && lit ? c.onPrimary : c.muted;
    let x = r2(c.variant === 'rows' ? 0 : 20 * u);
    inner.push(el('div', null, abs(x, r2((R - badge) / 2), badge, badge, {boxSizing: 'border-box', borderRadius: '50%', background: row.medal && !(c.variant === 'cards' && lit) ? row.medal : 'transparent',
      border: row.medal ? 'none' : `${r2(2 * u)}px solid ${c.border}`}), [label(null, 0, r2(badge / 2 - badge * 0.3), badge, String(row.rank), {size: r2(badge * 0.5), family: fonts.display, color: row.medal ? (c.variant === 'cards' && lit ? c.onPrimary : c.bg) : c.muted, align: 'center'})]));
    x = r2(x + badge + 22 * u);
    if (row.icon) { inner.push({...iconNodeAt(row.icon, x, r2((R - R * 0.4) / 2), r2(R * 0.4), sub)}); x = r2(x + R * 0.4 + 16 * u); }
    const nameY = row.detail ? r2(R / 2 - c.nameSize * 1.1) : r2(R / 2 - c.nameSize * 0.6);
    inner.push(label(null, x, nameY, r2(c.W * 0.55), row.label, {size: c.nameSize, family: fonts.body, color: ink, weight: 650}));
    if (row.detail) inner.push(label(null, x, r2(R / 2 + 2 * u), r2(c.W * 0.55), row.detail, {size: c.detailSize, family: fonts.meta, color: sub}));
    if (c.variant === 'bars') {
      // Beside the name when there is room, else a thin bar along the row's foot.
      const beside = !c.portrait;
      const barX = beside ? r2(c.W * 0.5) : x, barW = beside ? r2((c.W * 0.5 - 20 * u) * 0.62) : r2(c.W * 0.62 - x);
      inner.push(el('div', `${id}-bar-${i}`, abs(barX, beside ? r2(R / 2 - R * 0.13) : r2(R - R * 0.16), r2(Math.max(8 * u, barW * row.frac)), r2(R * (beside ? 0.26 : 0.09)), {borderRadius: 99, background: row.color, transformOrigin: '0% 50%', transform: transformString({scaleX: 0})})));
    }
    inner.push(label(`${id}-value-${i}`, 0, r2(R / 2 - c.valueSize * 0.6), r2(c.W - (c.variant === 'rows' ? 0 : 24 * u)), row.initial, {size: c.valueSize, family: fonts.display, color: lit && c.variant !== 'cards' ? c.primary : ink, align: 'right'}));
    kids.push(el('div', `${id}-row-${i}`, {...abs(0, row.y, c.W, R), boxSizing: 'border-box', ...bg, opacity: 0}, inner));
  });
  return kids;
}

const iconNodeAt = (name, x, y, size, color) => iconNode(name, {x, y, size, color});

function leaderTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  chromeOps(model, ops);
  c.rows.forEach((row, i) => {
    riseOps(ops, `${id}-row-${i}`, start, row.time, 0, {dx: r2(60 * u), duration: 0.5});
    countOps(ops, `${id}-value-${i}`, start, row.initial, row.samples);
    if (c.variant === 'bars') {
      set(ops, `${id}-bar-${i}`, start, {x: 0, y: 0, scaleX: 0, scaleY: 1});
      tw(ops, `${id}-bar-${i}`, rt(row.time + 0.1), 0.8, 'power3.out', {scaleX: 0}, {scaleX: 1});
    }
  });
  if (c.highlightAt !== null) {
    c.rows.forEach((_, i) => { if (i !== c.highlight) fadeOps(ops, `${id}-row-${i}`, c.highlightAt, 1, 0.45); });
    tw(ops, `${id}-row-${c.highlight}`, c.highlightAt, 0.45, 'back.out(2)', {scaleX: 1, scaleY: 1}, {scaleX: 1.03, scaleY: 1.03});
  }
}

export const leaderboard = {
  id: 'leaderboard',
  describe: 'A ranked leaderboard: rows slide in from last place to first with rank badges, counting values and (bars) a bar each; one row can be called out.',
  params: {entries: `[{label ≤ 24, value ≥ 0, detail? ≤ 30, icon? (icon name), color? (${tone})}] 3–8`, sort: 'boolean: rank by value (default true)', highlight: 'rank index to call out after the build (optional; first place is lit)', highlightAt: at, format: FORMAT_PARAM, ...COMMON},
  events: ['build', 'highlight'], timing: TIMING, variants: LEADER_VARIANTS,
  resolve: leaderResolve, view: leaderView, timeline: leaderTimeline
};

// ---------------------------------------------------------------------------
// comparison-table

const TABLE_VARIANTS = Object.freeze(['grid', 'striped', 'cards']);

function tableResolve(params, ctx) {
  const b = createHBase('comparison-table', params, ctx, {allowed: ['columns', 'rows', 'title', 'source', 'at', 'highlight', 'highlightAt'], required: ['columns', 'rows'], variants: TABLE_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  check.arr(p.columns, 'params.columns', 2, 4);
  const columns = p.columns.map((c, i) => check.str(c, `params.columns[${i}]`, 16));
  check.arr(p.rows, 'params.rows', 2, 8);
  const rows = p.rows.map((r, i) => {
    check.obj(r, `params.rows[${i}]`, ['label', 'values'], ['label', 'values']);
    check.arr(r.values, `params.rows[${i}].values`, columns.length, columns.length);
    return {label: check.str(r.label, `params.rows[${i}].label`, 28), lines: 1, values: r.values.map((v, j) => (typeof v === 'boolean' ? v : v === null ? null : check.str(String(v), `params.rows[${i}].values[${j}]`, 10)))};
  });
  const highlight = p.highlight === undefined ? null : check.int(p.highlight, 'params.highlight', 0, columns.length - 1);
  const tb = titleBlock(b, {title: p.title, source: p.source});
  const W = rect.width, H = rect.height - tb.top - tb.bottom;
  const n = rows.length, m = columns.length;
  const headH = r2(u(96));
  const rowH = r2(Math.min(u(120), (H - headH) / n));
  if (rowH < u(64)) check.fail('params.rows', 'has too many rows for the height');
  const labelW = r2(W * (b.portrait ? 0.32 : 0.38));
  const colW = r2((W - labelW) / m);
  const labelSize = Math.min(...rows.map((r, i) => fitText(check, `params.rows[${i}].label`, r.label, {family: 'body', width: labelW - u(24), preferred: Math.min(u(40), rowH * 0.36), min: b.min.meta, maxLines: 2}).size));
  const headSize = Math.min(...columns.map((c, i) => fitText(check, `params.columns[${i}]`, c, {family: 'body', width: colW - u(16), preferred: u(38), min: b.min.meta, maxLines: 2}).size));
  const cellSize = r2(Math.max(b.min.meta, Math.min(u(40), rowH * 0.36)));
  for (const [i, r] of rows.entries()) r.lines = fitText(check, `params.rows[${i}].label`, r.label, {family: 'body', width: labelW - u(24), preferred: labelSize, min: labelSize, maxLines: 2}).lines;
  for (const [i, r] of rows.entries()) r.values.forEach((v, j) => { if (typeof v === 'string') fitText(check, `params.rows[${i}].values[${j}]`, v, {family: 'display', width: colW - u(12), preferred: cellSize, min: b.min.meta}); });
  const totalH = headH + rowH * n;
  const y0 = r2(tb.top + (H - totalH) / 2);
  const {buildAt, buildEnd, highlightAt} = buildTimes(b, p, 0.5 + n * 0.16 + 0.4, {highlight: highlight !== null});
  const content = {variant: b.variant, title: tb.title, source: tb.source, columns, rows: rows.map((r, i) => ({...r, y: r2(y0 + headH + i * rowH), time: rt(buildAt + 0.3 + i * 0.16)})),
    y0, headH, rowH, labelW, colW, W, labelSize, headSize, cellSize, highlight, highlightAt, buildAt, buildEnd,
    yes: b.colors.primary, no: mixColor(b.colors.paper, b.colors.bg, 0.45), panel: b.theme.panel, border: b.theme.border, ink: b.theme.foreground, muted: b.theme.muted, primary: b.colors.primary};
  return b.finish(content, {minTextPx: tb.title ? tb.title.size : b.min.key});
}

function tableView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const kids = chromeNodes(model);
  const tableH = c.headH + c.rowH * c.rows.length;
  if (c.variant === 'cards') c.columns.forEach((_, j) => kids.push(el('div', `${id}-colcard-${j}`, abs(r2(c.labelW + j * c.colW + 6 * u), c.y0, r2(c.colW - 12 * u), tableH, {boxSizing: 'border-box', borderRadius: r2(22 * u), background: c.panel, border: `${r2(2 * u)}px solid ${c.border}`, opacity: 0}))));
  if (c.highlight !== null) kids.push(el('div', `${id}-focus`, abs(r2(c.labelW + c.highlight * c.colW + 2 * u), r2(c.y0 - 6 * u), r2(c.colW - 4 * u), r2(tableH + 12 * u), {boxSizing: 'border-box', borderRadius: r2(22 * u), border: `${r2(4 * u)}px solid ${c.primary}`, boxShadow: `0 0 ${r2(30 * u)}px ${c.primary}55`, opacity: 0})));
  c.columns.forEach((col, j) => kids.push(label(`${id}-head-${j}`, r2(c.labelW + j * c.colW + 8 * u), r2(c.y0 + c.headH / 2 - c.headSize * 0.6), r2(c.colW - 16 * u), col, {size: c.headSize, family: fonts.body, color: j === c.highlight ? c.primary : c.ink, align: 'center', weight: 700, extra: {opacity: 0}})));
  c.rows.forEach((row, i) => {
    const inner = [];
    if (c.variant === 'striped' && i % 2 === 0) inner.push(el('div', null, abs(0, 0, c.W, c.rowH, {borderRadius: r2(12 * u), background: c.panel})));
    if (c.variant === 'grid') inner.push(el('div', null, abs(0, 0, c.W, r2(2 * u), {background: c.border})));
    inner.push(label(null, r2(c.variant === 'striped' ? 20 * u : 4 * u), r2(c.rowH / 2 - c.labelSize * 0.6 * row.lines), r2(c.labelW - 24 * u), row.label, {size: c.labelSize, family: fonts.body, color: c.ink, weight: 600, wrap: row.lines > 1}));
    row.values.forEach((v, j) => {
      const cx = r2(c.labelW + j * c.colW + c.colW / 2);
      const node = typeof v === 'string' ? label(`${id}-cell-${i}-${j}`, r2(cx - c.colW / 2 + 6 * u), r2(c.rowH / 2 - c.cellSize * 0.6), r2(c.colW - 12 * u), v, {size: c.cellSize, family: fonts.display, color: c.ink, align: 'center', extra: {opacity: 0}})
        : v === null ? label(`${id}-cell-${i}-${j}`, r2(cx - c.colW / 2), r2(c.rowH / 2 - c.cellSize * 0.6), c.colW, '—', {size: c.cellSize, family: fonts.display, color: c.no, align: 'center', extra: {opacity: 0}})
          : iconNode(v ? 'check-circle' : 'x', {id: `${id}-cell-${i}-${j}`, x: r2(cx - c.rowH * 0.24), y: r2(c.rowH / 2 - c.rowH * 0.24), size: r2(c.rowH * 0.48), color: v ? c.yes : c.no, stroke: v ? 2.4 : 2, style: {opacity: 0}});
      inner.push(node);
    });
    kids.push(el('div', `${id}-row-${i}`, {...abs(0, row.y, c.W, c.rowH), opacity: 0}, inner));
  });
  return kids;
}

function tableTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  chromeOps(model, ops);
  if (c.variant === 'cards') c.columns.forEach((_, j) => riseOps(ops, `${id}-colcard-${j}`, start, rt(c.buildAt + j * 0.08), r2(24 * u), {duration: 0.5}));
  c.columns.forEach((_, j) => popOps(ops, `${id}-head-${j}`, start, rt(c.buildAt + 0.1 + j * 0.08), {from: 0.7}));
  c.rows.forEach((row, i) => {
    riseOps(ops, `${id}-row-${i}`, start, row.time, r2(14 * u), {duration: 0.4});
    row.values.forEach((_, j) => popOps(ops, `${id}-cell-${i}-${j}`, start, rt(row.time + 0.12 + j * 0.07), {from: 0.3, duration: 0.4, ease: 'back.out(2.2)'}));
  });
  if (c.highlight !== null) popOps(ops, `${id}-focus`, start, c.highlightAt, {from: 1.06, duration: 0.45, ease: 'power3.out'});
}

export const comparisonTable = {
  id: 'comparison-table',
  describe: 'A feature comparison table: headers pop, rows land one by one with ticks, crosses and short values, and one column can be outlined as the pick.',
  params: {columns: '[string ≤ 16] 2–4, the things compared', rows: '[{label ≤ 28, values: [true | false | null | string ≤ 10 per column]}] 2–8', highlight: 'column index to outline after the build (optional)', highlightAt: at, ...COMMON},
  events: ['build', 'highlight'], timing: TIMING, variants: TABLE_VARIANTS,
  resolve: tableResolve, view: tableView, timeline: tableTimeline
};

export const FLOWS = [funnelChart, waterfall, sankey, heatmap, leaderboard, comparisonTable];
