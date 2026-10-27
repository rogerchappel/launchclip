// Catalogue I unit grids at scale: thousands of cells on a canvas painted by
// the particle engine's cells layer (kit/core/particles.mjs), with labels,
// live counters and annotations in the DOM on catalogue H's op list.
// unit-grid (kit/core/catalog-h-data.mjs) stays the isotype for 1–200 people
// or icons; these take over past that, where one cell stands for an amount.
//
//   grid-race  two grids filling side by side under live counters ("Same
//              $10 of output: 1,000,000 vs 960,000 tokens"), "1 cell = X".
//   cell-grid  1–3 grids at one cell size, so their heights compare (cost
//              per task, money stacked on a starting stake), with stacked
//              colour segments, cells that tick to checkmarks, a lit subset
//              and a ratio note ("≈9× cheaper").

import {VARIANT_PARAM, FORMAT_PARAM, createHBase, fitText, numberFormat, r2, rt, textWidth, titleBlock} from './catalog-h-base.mjs';
import {timingRules} from './catalog-b-base.mjs';
import {abs, chromeNodes, chromeOps, countOps, countSamples, el, label, popOps, riseOps} from './catalog-h-view.mjs';
import {dataTone} from './catalog-h-data.mjs';
import {paintCanvas, plan} from './catalog-i-particles.mjs';
import {rgbOf} from './particles.mjs';

const at = 'seconds from scene start (optional; else a matching hit, else a default)';
const rect = '{x, y, width, height} canvas px inside the safe zone (optional)';
/** The most cells one grid draws. */
export const MAX_CELLS = 10000;

/** Cell pitch (px) and columns for `count` cells in w × h: the largest square pitch that fits. */
export function fitCells(count, w, h, columns = null) {
  let best = {cols: 1, pitch: 0};
  const lo = columns ?? 1, hi = columns ?? Math.min(count, Math.ceil(Math.sqrt(count * w / Math.max(1, h))) * 3 + 2);
  for (let cols = lo; cols <= hi; cols++) {
    const pitch = Math.min(w / cols, h / Math.ceil(count / cols));
    if (pitch > best.pitch + 1e-9) best = {cols, pitch};
  }
  return {cols: best.cols, rows: Math.ceil(count / best.cols), pitch: Math.floor(best.pitch * 100) / 100};
}

/** A grid layer entry in a cells layer. */
function gridLayer({x, y, cols, rows, pitch, count, color, order, at: appear, t0, t1, ...rest}) {
  const gap = r2(Math.max(1, pitch * 0.16));
  return {x: r2(x), y: r2(y), cols, rows, cell: r2(pitch - gap), gap, radius: r2(Math.max(0.5, pitch * 0.18)), count, slots: count, order, rgb: rgbOf(color), empty: 0, at: appear, t0, t1, ...rest};
}

/** The legend: a cell swatch and "1 cell = …" in the meta face. */
function legendNode(id, x, y, w, c, fonts, align = 'right') {
  const s = r2(c.legendSize * 0.62), tw = r2(textWidth(c.legend, c.legendSize, 'meta'));
  const left = align === 'right' ? r2(w - tw - s - c.legendSize * 0.5) : align === 'center' ? r2((w - tw - s - c.legendSize * 0.5) / 2) : 0;
  return el('div', `${id}-legend`, abs(x, y, w, r2(c.legendSize * 1.3), {opacity: 0}), [
    el('div', null, abs(left, r2((c.legendSize * 1.3 - s) / 2), s, s, {borderRadius: r2(s * 0.2), background: c.legendColor})),
    label(null, r2(left + s + c.legendSize * 0.5), 0, r2(tw + 4), c.legend, {size: c.legendSize, family: fonts.meta, color: c.muted})
  ]);
}

function ratioNodes(id, c, fonts) {
  const r = c.ratio;
  // The body face at 800: display faces often lack ≈ and ×.
  return [label(`${id}-ratio`, r.x, r.y, r.width, r.text, {size: r.size, family: fonts.body, color: r.color, align: r.align, weight: 800, lineHeight: 1.05, extra: {opacity: 0, letterSpacing: '-0.02em'}}),
    ...(r.sub ? [label(`${id}-ratio-sub`, r.x, r2(r.y + r.size * 1.05), r.width, r.sub, {size: r.subSize, family: fonts.body, color: c.ink, align: r.align, weight: 650, wrap: r.subLines > 1, extra: {opacity: 0}})] : [])];
}

function ratioOps(ops, id, start, c, u) {
  if (!c.ratio) return;
  popOps(ops, `${id}-ratio`, start, c.ratio.time, {from: 0.6, duration: 0.5, ease: 'back.out(2)'});
  if (c.ratio.sub) riseOps(ops, `${id}-ratio-sub`, start, rt(c.ratio.time + 0.15), r2(14 * u));
}

/** Validated {text ≤ 8, sub? ≤ 40, tone?} ratio note → fitted sizes. */
function ratioOf(b, raw, width) {
  const {check, u} = b;
  check.obj(raw, 'params.ratio', ['text', 'sub', 'tone', 'at'], ['text']);
  const text = check.str(raw.text, 'params.ratio.text', 8), sub = raw.sub === undefined ? null : check.str(raw.sub, 'params.ratio.sub', 40);
  const size = fitText(check, 'params.ratio.text', text, {family: 'body', width, preferred: u(b.portrait ? 110 : 100), min: b.min.key}).size;
  const subFit = sub ? fitText(check, 'params.ratio.sub', sub, {family: 'body', width, preferred: Math.max(b.min.key, u(44)), min: b.min.key, maxLines: 2}) : null;
  return {text, sub, size, subSize: subFit?.size ?? 0, subLines: subFit?.lines ?? 0, color: dataTone(b, raw.tone, 'params.ratio.tone', 'accent'), at: raw.at,
    height: r2(size * 1.05 + (subFit ? subFit.size * 1.2 * subFit.lines + u(6) : 0))};
}

// ---------------------------------------------------------------------------
// grid-race

const RACE_VARIANTS = Object.freeze(['columns', 'stacked']);

function raceResolve(params, ctx) {
  const b = createHBase('grid-race', params, ctx, {allowed: ['title', 'source', 'legend', 'unit', 'racers', 'format', 'suffix', 'spendLabel', 'pace', 'ratio', 'at', 'raceDuration'], required: ['unit', 'racers'], variants: RACE_VARIANTS,
    // A dense comparison: in portrait it takes the caption band's height too.
    hidesCaptions: Number(ctx?.format?.height) > Number(ctx?.format?.width)});
  const {check, u, rect} = b;
  const p = b.params;
  const unit = check.num(p.unit, 'params.unit', 1e-9, 1e12);
  const base = numberFormat(check, p.format, 'params.format');
  // A word after the counters (" tokens"), longer than a format suffix may be.
  const suffix = p.suffix === undefined ? '' : ` ${check.str(p.suffix, 'params.suffix', 16)}`;
  const fmt = {format: v => `${base.format(v)}${suffix}`};
  const legend = p.legend === undefined ? `1 cell = ${fmt.format(unit)}` : check.str(p.legend, 'params.legend', 40);
  const spendLabel = p.spendLabel === undefined ? 'spent' : check.str(p.spendLabel, 'params.spendLabel', 16);
  const pace = p.pace === undefined ? 'together' : check.oneOf(p.pace, 'params.pace', ['together', 'same-rate']);
  check.arr(p.racers, 'params.racers', 2, 2);
  const racers = p.racers.map((r, i) => {
    const path = `params.racers[${i}]`;
    check.obj(r, path, ['label', 'sub', 'total', 'spend', 'tone'], ['label', 'total']);
    const total = check.num(r.total, `${path}.total`, unit, unit * MAX_CELLS);
    let spend = null;
    if (r.spend !== undefined) {
      check.obj(r.spend, `${path}.spend`, ['total', 'format'], ['total']);
      spend = {total: check.num(r.spend.total, `${path}.spend.total`, 0, 1e12), fmt: numberFormat(check, r.spend.format ?? {style: 'currency', decimals: 2}, `${path}.spend.format`)};
    }
    return {label: check.str(r.label, `${path}.label`, 28), sub: r.sub === undefined ? null : check.str(r.sub, `${path}.sub`, 40), total, cells: Math.ceil(total / unit - 1e-9), spend,
      color: dataTone(b, r.tone, `${path}.tone`, i ? 'accent' : 'primary')};
  });
  const W = rect.width, stacked = b.variant === 'stacked';
  // stacked: one row per racer; in landscape the text sits in a column left of
  // the grid and the ratio note at the top right, beside the title.
  const side = stacked && !b.portrait;
  const tb = titleBlock(b, {title: p.title, source: p.source, width: side && p.ratio !== undefined ? r2(W * 0.55) : W});
  const gap = u(stacked ? 0 : b.portrait ? 48 : 96);
  const colW = stacked ? W : (W - gap) / 2;
  const infoW = side ? r2(W * 0.34) : colW, gridW = side ? r2(W - infoW - u(48)) : colW;
  const labelSize = Math.min(...racers.map((r, i) => fitText(check, `params.racers[${i}].label`, r.label, {family: 'body', width: infoW, preferred: u(46), min: b.min.key}).size));
  const subSize = r2(Math.max(b.min.meta, u(28)));
  const counterSize = Math.min(...racers.map((r, i) => fitText(check, `params.racers[${i}].total`, fmt.format(r.total), {family: 'display', width: infoW, preferred: u(b.portrait ? 76 : 64), min: b.min.key}).size));
  const spendSize = r2(Math.max(b.min.key, u(36)));
  const hasSub = racers.some(r => r.sub), hasSpend = racers.some(r => r.spend);
  const headH = r2(labelSize * 1.2 + (hasSub ? subSize * 1.3 : 0) + u(18));
  const footH = r2(u(18) + counterSize * 1.1 + (hasSpend ? spendSize * 1.25 : 0));
  const legendSize = r2(Math.max(b.min.meta, u(28)));
  const ratio = p.ratio === undefined ? null : ratioOf(b, p.ratio, side ? r2(W * 0.42) : W);
  const ratioH = ratio && !side ? ratio.height + u(24) : 0;
  const top = side && ratio ? Math.max(tb.top, r2(ratio.height + u(16))) : tb.top;
  const legendH = r2(legendSize * 1.3 + u(20));
  const blockH = rect.height - top - tb.bottom - legendH - ratioH;
  const infoH = r2(headH + footH - u(4));
  const areaH = side ? (blockH - u(40)) / 2 : stacked ? (blockH - 2 * (headH + footH) - u(40)) / 2 : blockH - headH - footH;
  if (areaH < u(90)) check.fail('params', 'leaves too little height for the grids; drop the title or the ratio, or enlarge rect');
  const max = Math.max(...racers.map(r => r.cells));
  const shape = fitCells(max, gridW, areaH);
  const pitch = Math.min(shape.pitch, u(64));
  if (pitch < 3) check.fail('params.unit', `makes ${max} cells, under 3 px each here; use a larger unit`);
  const gridH = r2(Math.ceil(max / shape.cols) * pitch);
  const rowH = side ? Math.max(infoH, gridH) : headH + gridH + footH;
  const y0 = r2(top + (blockH - (stacked ? 2 * rowH + u(40) : rowH)) / 2);

  const buildAt = b.timeOf('build', p.at, 'params.at', 0.5);
  const latest = b.start + b.lastEvent - (ratio ? 0.6 : 0.1);
  const t0 = rt(buildAt + 0.6);
  const raceDuration = p.raceDuration === undefined ? Math.max(1, Math.min(4, latest - t0)) : check.num(p.raceDuration, 'params.raceDuration', 0.6, 30);
  const t1 = rt(t0 + raceDuration);
  if (t1 > latest + 1e-6) check.fail('params.raceDuration', `ends the race ${r2(t1 - latest)} s too late for this scene; shorten it or lengthen the scene`);
  b.events.push({id: `${b.id}-build`, name: 'build', time: buildAt, endTime: t0, role: 'emphasis', cue: 'pop'});
  b.events.push({id: `${b.id}-race`, name: 'race', time: t0, endTime: t1, role: 'emphasis', cue: 'tally'});
  const maxTotal = Math.max(...racers.map(r => r.total));
  const cells = [];
  racers.forEach((r, i) => {
    const x = stacked ? 0 : i * (colW + gap), y = stacked ? y0 + i * (rowH + u(40)) : y0;
    const end = pace === 'same-rate' ? rt(t0 + raceDuration * r.total / maxTotal) : t1;
    const textY = side ? y + (rowH - infoH) / 2 : y, gridY = side ? y + (rowH - gridH) / 2 : y + headH;
    Object.assign(r, {x: r2(x), y: r2(textY), gridX: r2(side ? infoW + u(48) : x), gridY: r2(gridY), counterY: r2(side ? textY + headH : y + headH + gridH + u(18)), end,
      samples: countSamples(b.model, t0, end - t0, 'none', 0, r.total, v => fmt.format(Math.min(r.total, Math.round(v)))),
      spendSamples: r.spend ? countSamples(b.model, t0, end - t0, 'none', 0, r.spend.total, v => `${spendLabel} ${r.spend.fmt.format(Math.min(r.spend.total, v))}`) : null,
      zero: fmt.format(0), spendZero: r.spend ? `${spendLabel} ${r.spend.fmt.format(0)}` : null});
    // Faint empty slots up to the larger grid, so a shortfall shows.
    cells.push({...gridLayer({x: r.gridX, y: r.gridY, cols: shape.cols, rows: Math.ceil(max / shape.cols), pitch, count: r.cells, color: r.color, order: 'reading', at: rt(buildAt + 0.2), t0, t1: end}), slots: max, empty: 0.09});
    delete r.spend;
  });
  b.events.push({id: `${b.id}-finish`, name: 'finish', time: t1, endTime: rt(t1 + 0.4), role: 'emphasis', cue: 'hit'});
  if (ratio) {
    ratio.time = b.timeOf('ratio', ratio.at, 'params.ratio.at', Math.min(t1 - b.start + 0.35, b.lastEvent), {min: Math.min(t1 - b.start, b.lastEvent)});
    b.events.push({id: `${b.id}-ratio`, name: 'ratio', time: ratio.time, endTime: rt(ratio.time + 0.5), role: 'emphasis', cue: 'pop'});
    Object.assign(ratio, side ? {x: r2(W * 0.58), y: 0, width: r2(W * 0.42), align: 'right'} : {x: 0, y: r2(y0 + (stacked ? 2 * rowH + u(40) : rowH) + u(24)), width: W, align: 'center'});
    delete ratio.at;
  }
  const content = {variant: b.variant, title: tb.title, source: tb.source, align: 'left', racers, labelSize, subSize, counterSize, spendSize, colW: r2(infoW), legend, legendSize, legendColor: racers[0].color,
    legendY: r2(rect.height - tb.bottom - legendH + u(12)), ratio, buildAt, t0, t1, buildEnd: t1, ink: b.theme.foreground, muted: b.theme.muted,
    paint: {[`${b.id}-paint`]: plan(b, [{kind: 'cells', grids: cells}])}};
  return b.finish(content, {minTextPx: Math.min(labelSize, counterSize, spendSize, ratio?.size ?? Infinity, ratio?.subSize || Infinity, tb.title?.size ?? Infinity)});
}

function raceView(model) {
  const {id, fonts} = model;
  const c = model.content;
  const kids = [...chromeNodes(model), paintCanvas(model)];
  c.racers.forEach((r, i) => {
    kids.push(label(`${id}-l-${i}`, r.x, r.y, c.colW, r.label, {size: c.labelSize, family: fonts.body, color: c.ink, weight: 700, extra: {opacity: 0}}));
    if (r.sub) kids.push(label(`${id}-s-${i}`, r.x, r2(r.y + c.labelSize * 1.2), c.colW, r.sub, {size: c.subSize, family: fonts.meta, color: c.muted, extra: {opacity: 0}}));
    kids.push(label(`${id}-n-${i}`, r.x, r.counterY, c.colW, r.zero, {size: c.counterSize, family: fonts.display, color: r.color, lineHeight: 1.1, extra: {opacity: 0, fontVariantNumeric: 'tabular-nums'}}));
    if (r.spendSamples) kids.push(label(`${id}-p-${i}`, r.x, r2(r.counterY + c.counterSize * 1.1), c.colW, r.spendZero, {size: c.spendSize, family: fonts.body, color: c.muted, weight: 600, extra: {opacity: 0, fontVariantNumeric: 'tabular-nums'}}));
  });
  kids.push(legendNode(id, 0, c.legendY, model.rect.width, c, fonts, 'center'));
  if (c.ratio) kids.push(...ratioNodes(id, c, fonts));
  return kids;
}

function raceTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  chromeOps(model, ops);
  c.racers.forEach((r, i) => {
    riseOps(ops, `${id}-l-${i}`, start, rt(c.buildAt + i * 0.12), r2(16 * u));
    if (r.sub) riseOps(ops, `${id}-s-${i}`, start, rt(c.buildAt + 0.08 + i * 0.12), r2(12 * u));
    riseOps(ops, `${id}-n-${i}`, start, rt(c.buildAt + 0.25 + i * 0.12), r2(16 * u));
    countOps(ops, `${id}-n-${i}`, start, r.zero, r.samples);
    if (r.spendSamples) { riseOps(ops, `${id}-p-${i}`, start, rt(c.buildAt + 0.32 + i * 0.12), r2(12 * u)); countOps(ops, `${id}-p-${i}`, start, r.spendZero, r.spendSamples); }
  });
  riseOps(ops, `${id}-legend`, start, rt(c.buildAt + 0.4), r2(10 * u));
  ratioOps(ops, id, start, c, u);
}

export const gridRace = {
  id: 'grid-race',
  describe: `Two unit grids racing side by side ("Same $10 of output": 1,000,000 vs 960,000 tokens), each cell one unit ("1 cell = 10,000 tokens"), up to ${MAX_CELLS} cells a side, under live counters (and an optional spend counter) that count with the fill, then an optional ratio ("2× the tokens").`,
  params: {unit: 'number, what one cell stands for (10000)', racers: '[{label ≤ 28, sub? ≤ 40, total (a multiple of unit up to 10,000 cells), spend? {total, format?}, tone?}] exactly 2',
    legend: 'string ≤ 40 (default "1 cell = <unit>")', format: `the counters: ${FORMAT_PARAM}`, suffix: 'string ≤ 16 after each counter ("tokens") (optional)', spendLabel: 'string ≤ 16 before each spend counter (default "spent")',
    pace: '"together" (default: both finish together) or "same-rate" (one cell per unit of time; the bigger total takes longer)', ratio: '{text ≤ 8 ("2×"), sub? ≤ 40, tone?, at?} after the finish (optional)',
    title: 'string ≤ 60 (optional)', source: 'string ≤ 80 (optional)', raceDuration: 'seconds (default: to just before the exit, 1–4 s)', at: `labels in: ${at}`, variant: VARIANT_PARAM, rect},
  events: ['build', 'race', 'finish', 'ratio'], timing: timingRules({rules: ['labels and counters rise from at; the race starts 0.6 s later', 'the counters and the cells move together, linearly']}), variants: RACE_VARIANTS,
  resolve: raceResolve, view: raceView, timeline: raceTimeline
};

// ---------------------------------------------------------------------------
// cell-grid

const CELL_VARIANTS = Object.freeze(['bars', 'blocks']);

function cellResolve(params, ctx) {
  const b = createHBase('cell-grid', params, ctx, {allowed: ['title', 'source', 'legend', 'grids', 'order', 'ratio', 'at'], required: ['legend', 'grids'], variants: CELL_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  const legend = check.str(p.legend, 'params.legend', 40);
  const order = p.order === undefined ? 'bottom-up' : check.oneOf(p.order, 'params.order', ['bottom-up', 'reading']);
  check.arr(p.grids, 'params.grids', 1, 3);
  const grids = p.grids.map((g, i) => {
    const path = `params.grids[${i}]`;
    check.obj(g, path, ['label', 'sub', 'count', 'value', 'tone', 'columns', 'segments', 'ticks', 'highlight'], ['label', 'count']);
    const count = check.int(g.count, `${path}.count`, 1, MAX_CELLS);
    const color = dataTone(b, g.tone, `${path}.tone`, ['accent', 'primary', 'paper'][i]);
    let segments = null;
    if (g.segments !== undefined) {
      check.arr(g.segments, `${path}.segments`, 1, 4);
      let from = 0;
      segments = g.segments.map((s, j) => {
        check.obj(s, `${path}.segments[${j}]`, ['count', 'tone', 'label'], ['count', 'tone']);
        const n = check.int(s.count, `${path}.segments[${j}].count`, 1, count - from);
        const seg = {from, to: from + n, color: dataTone(b, s.tone, `${path}.segments[${j}].tone`), label: s.label === undefined ? null : check.str(s.label, `${path}.segments[${j}].label`, 28)};
        from += n;
        return seg;
      });
    }
    let ticks = null, highlight = null;
    if (g.ticks !== undefined) {
      check.obj(g.ticks, `${path}.ticks`, ['count', 'tone', 'at'], ['count']);
      ticks = {count: check.int(g.ticks.count, `${path}.ticks.count`, 1, count), color: dataTone(b, g.ticks.tone, `${path}.ticks.tone`, 'good'), at: g.ticks.at};
    }
    if (g.highlight !== undefined) {
      check.obj(g.highlight, `${path}.highlight`, ['count', 'tone', 'at'], ['count']);
      highlight = {count: check.int(g.highlight.count, `${path}.highlight.count`, 1, count), color: dataTone(b, g.highlight.tone, `${path}.highlight.tone`, 'primary'), at: g.highlight.at};
    }
    return {label: check.str(g.label, `${path}.label`, 28), sub: g.sub === undefined ? null : check.str(g.sub, `${path}.sub`, 36), value: g.value === undefined ? null : check.str(g.value, `${path}.value`, 16),
      count, color, segments, ticks, highlight, columns: g.columns === undefined ? null : check.int(g.columns, `${path}.columns`, 1, 200)};
  });
  const W = rect.width, n = grids.length;
  const legendSize = r2(Math.max(b.min.meta, u(30)));
  const legendW = r2(textWidth(legend, legendSize, 'meta') + legendSize * 1.4);
  const tb = titleBlock(b, {title: p.title, source: p.source, width: W - legendW - u(24)});
  const top = Math.max(tb.top, r2(legendSize * 1.3 + u(24)));
  const gap = u(b.portrait ? 40 : 72);
  const colW = (W - gap * (n - 1)) / n;
  const labelSize = Math.min(...grids.map((g, i) => fitText(check, `params.grids[${i}].label`, g.label, {family: 'body', width: colW, preferred: u(44), min: b.min.key}).size));
  const subSize = r2(Math.max(b.min.meta, u(28)));
  const valueSize = grids.some(g => g.value) ? Math.min(...grids.filter(g => g.value).map(g => fitText(check, 'params.grids[].value', g.value, {family: 'display', width: colW, preferred: u(b.portrait ? 76 : 68), min: b.min.key}).size)) : 0;
  const footH = r2(u(20) + labelSize * 1.2 + (grids.some(g => g.sub) ? subSize * 1.3 : 0));
  const valueH = valueSize ? r2(valueSize * 1.1 + u(12)) : 0;
  const ratio = p.ratio === undefined ? null : ratioOf(b, p.ratio, colW);
  const areaTop = top + (ratio ? ratio.height + u(20) : 0) + valueH;
  const areaH = rect.height - tb.bottom - footH - areaTop;
  if (areaH < u(140)) check.fail('params', 'leaves too little height for the grids; drop the title or the ratio, or enlarge rect');

  // One pitch for every grid, so heights compare; columns fill each column's width unless set.
  let lo = 2, hi = u(80);
  const fits = pitch => grids.every(g => { const cols = g.columns ?? Math.max(1, Math.floor(colW / pitch)); return cols * pitch <= colW + 1e-6 && Math.ceil(g.count / cols) * pitch <= areaH + 1e-6; });
  if (!fits(lo)) check.fail('params.grids', `need cells under 2 px here; use fewer cells (a bigger unit) or fewer columns`);
  for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
  const pitch = Math.floor(lo * 100) / 100;
  const bottom = r2(rect.height - tb.bottom - footH);
  const buildAt = b.timeOf('build', p.at, 'params.at', 0.5);
  const fillEach = Math.max(0.6, Math.min(1.4, (b.start + b.lastEvent - buildAt - 0.6) / n));
  const layers = [];
  let lastFill = buildAt;
  grids.forEach((g, i) => {
    const cols = g.columns ?? Math.max(1, Math.floor(colW / pitch)), rows = Math.ceil(g.count / cols);
    const w = r2(Math.min(cols, g.count) * pitch), h = r2(rows * pitch);
    const x = r2(i * (colW + gap) + (b.variant === 'blocks' ? (colW - w) / 2 : 0)), y = r2(bottom - h);
    const t0 = rt(buildAt + 0.3 + i * fillEach * 0.6), t1 = rt(t0 + fillEach);
    lastFill = Math.max(lastFill, t1);
    Object.assign(g, {x, y, w, h, cols, colX: r2(i * (colW + gap)), t0, t1});
    const entry = gridLayer({x, y, cols, rows, pitch, count: g.count, color: g.color, order, at: buildAt, t0, t1});
    if (g.segments) {
      entry.segs = g.segments.map(s => ({from: s.from, to: s.to, rgb: rgbOf(s.color)}));
      g.segments.forEach(s => { s.y = order === 'bottom-up' ? r2(bottom - Math.ceil(s.to / cols) * pitch) : r2(y + Math.ceil(s.to / cols) * pitch); });
    }
    layers.push(entry);
    b.events.push({id: `${b.id}-fill-${i}`, name: `fill-${i}`, time: t0, endTime: t1, role: 'emphasis', cue: 'tally'});
  });
  b.events.push({id: `${b.id}-build`, name: 'build', time: buildAt, endTime: lastFill, role: 'emphasis', cue: 'pop'});
  const settled = lastFill - b.start;
  grids.forEach((g, i) => {
    const entry = layers[i];
    if (g.ticks) {
      g.ticks.time = b.timeOf('ticks', g.ticks.at, `params.grids[${i}].ticks.at`, Math.min(settled + 0.3 + i * 0.2, b.lastEvent), {min: Math.min(settled, b.lastEvent)});
      entry.tick = {count: g.ticks.count, t0: g.ticks.time, t1: rt(g.ticks.time + Math.min(1.2, 0.02 * g.ticks.count + 0.3)), rgb: rgbOf(g.ticks.color), ink: rgbOf(b.colors.bg)};
      b.events.push({id: `${b.id}-ticks-${i}`, name: 'ticks', time: g.ticks.time, endTime: entry.tick.t1, role: 'emphasis', cue: 'tally'});
    }
    if (g.highlight) {
      g.highlight.time = b.timeOf('highlight', g.highlight.at, `params.grids[${i}].highlight.at`, Math.min(settled + 0.4, b.lastEvent), {min: Math.min(settled, b.lastEvent)});
      entry.hl = {from: 0, to: g.highlight.count, rgb: rgbOf(g.highlight.color), t: g.highlight.time, step: Math.min(0.01, 0.5 / g.highlight.count), dim: 0.3};
      b.events.push({id: `${b.id}-highlight-${i}`, name: 'highlight', time: g.highlight.time, endTime: rt(g.highlight.time + 0.6), role: 'emphasis', cue: 'hit-soft'});
    }
    delete g.ticks?.at; delete g.highlight?.at;
  });
  if (ratio) {
    // Over the shortest grid, where its column has room.
    const host = grids.reduce((best, g) => (g.h < best.h ? g : best), grids[0]);
    ratio.time = b.timeOf('ratio', ratio.at, 'params.ratio.at', Math.min(settled + 0.5, b.lastEvent), {min: Math.min(settled, b.lastEvent)});
    b.events.push({id: `${b.id}-ratio`, name: 'ratio', time: ratio.time, endTime: rt(ratio.time + 0.5), role: 'emphasis', cue: 'pop'});
    Object.assign(ratio, {x: host.colX, y: r2(top), width: r2(colW), align: 'left'});
    delete ratio.at;
  }
  const content = {variant: b.variant, title: tb.title, source: tb.source, align: 'left', grids, labelSize, subSize, valueSize, colW: r2(colW), bottom, legend, legendSize, legendW, legendColor: grids[0].color,
    ratio, buildAt, buildEnd: lastFill, ink: b.theme.foreground, muted: b.theme.muted, border: b.theme.border, paint: {[`${b.id}-paint`]: plan(b, [{kind: 'cells', grids: layers}])}};
  return b.finish(content, {minTextPx: Math.min(labelSize, valueSize || Infinity, ratio?.size ?? Infinity, ratio?.subSize || Infinity, tb.title?.size ?? Infinity)});
}

function cellView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content, W = model.rect.width;
  const kids = [...chromeNodes(model)];
  c.grids.forEach((g, i) => {
    for (const [j, s] of (g.segments ?? []).entries()) {
      if (!s.label || j === g.segments.length - 1) continue;
      kids.push(el('div', `${id}-sr-${i}-${j}`, abs(r2(g.x - 8 * u), r2(s.y - u), r2(Math.max(g.w + 16 * u, W - g.x - 8 * u)), r2(2 * u), {opacity: 0, borderTop: `${r2(2 * u)}px dashed ${c.muted}`, transformOrigin: '0% 50%'})));
      kids.push(label(`${id}-sl-${i}-${j}`, r2(g.x + g.w + 20 * u), r2(s.y - c.subSize * 1.5), r2(Math.max(0, W - g.x - g.w - 20 * u)), s.label, {size: c.subSize, family: fonts.meta, color: c.ink, extra: {opacity: 0}}));
    }
  });
  kids.push(paintCanvas(model));
  c.grids.forEach((g, i) => {
    if (g.value) kids.push(label(`${id}-v-${i}`, g.x, r2(g.y - c.valueSize * 1.1 - 12 * u), r2(Math.max(g.w, c.colW)), g.value, {size: c.valueSize, family: fonts.display, color: (g.highlight ?? g).color, lineHeight: 1.1, extra: {opacity: 0}}));
    kids.push(label(`${id}-l-${i}`, g.colX, r2(c.bottom + 20 * u), c.colW, g.label, {size: c.labelSize, family: fonts.body, color: c.ink, weight: 700, align: c.variant === 'blocks' ? 'center' : 'left', extra: {opacity: 0}}));
    if (g.sub) kids.push(label(`${id}-s-${i}`, g.colX, r2(c.bottom + 20 * u + c.labelSize * 1.2), c.colW, g.sub, {size: c.subSize, family: fonts.meta, color: c.muted, align: c.variant === 'blocks' ? 'center' : 'left', extra: {opacity: 0}}));
  });
  kids.push(legendNode(id, 0, 0, W, c, fonts, 'right'));
  if (c.ratio) kids.push(...ratioNodes(id, c, fonts));
  return kids;
}

function cellTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  chromeOps(model, ops);
  riseOps(ops, `${id}-legend`, start, c.buildAt, r2(10 * u));
  c.grids.forEach((g, i) => {
    riseOps(ops, `${id}-l-${i}`, start, rt(c.buildAt + i * 0.1), r2(14 * u));
    if (g.sub) riseOps(ops, `${id}-s-${i}`, start, rt(c.buildAt + 0.08 + i * 0.1), r2(10 * u));
    if (g.value) riseOps(ops, `${id}-v-${i}`, start, rt(g.t1 - 0.1), r2(18 * u));
    for (const [j, s] of (g.segments ?? []).entries()) {
      if (!s.label || j === g.segments.length - 1) continue;
      const at = rt(g.t0 + (g.t1 - g.t0) * s.to / g.count);
      riseOps(ops, `${id}-sr-${i}-${j}`, start, at, 0, {duration: 0.4});
      riseOps(ops, `${id}-sl-${i}-${j}`, start, rt(at + 0.1), r2(10 * u));
    }
  });
  ratioOps(ops, id, start, c, u);
}

export const cellGrid = {
  id: 'cell-grid',
  describe: `1–3 unit grids at one cell size (up to ${MAX_CELLS} cells each), so their heights compare like bars ("1 cell = $0.01": $1.01 vs $7.15 a task), with stacked colour segments (a $200,000 stake under the growth), cells that tick to checkmarks (tasks passed), a lit subset, and a ratio note ("≈9× cheaper").`,
  params: {legend: 'string ≤ 40, what one cell is ("1 cell = $0.01")', grids: `[{label ≤ 28, sub? ≤ 36, count (1–${MAX_CELLS}), value? ≤ 16 shown over the grid ("$7.15"), tone?, columns?, segments? [{count, tone, label? ≤ 28}] 1–4 from the first cell, ticks? {count, tone?, at?}, highlight? {count, tone?, at?}}] 1–3`,
    order: '"bottom-up" (default; cells stack like a bar) or "reading" (top row first, for task grids)', ratio: '{text ≤ 8 ("≈9×"), sub? ≤ 40 ("cheaper per completed task"), tone?, at?} over the shortest grid (optional)',
    title: 'string ≤ 60 (optional)', source: 'string ≤ 80 (optional)', at: `build start: ${at}`, variant: VARIANT_PARAM, rect},
  events: ['build', 'fill-0', 'fill-1', 'fill-2', 'ticks', 'highlight', 'ratio'], timing: timingRules({rules: ['grids fill one after another (0.6–1.4 s each, overlapping) from at', 'ticks, highlight and the ratio follow the last fill']}), variants: CELL_VARIANTS,
  resolve: cellResolve, view: cellView, timeline: cellTimeline
};

export const GRID_MODULES = [gridRace, cellGrid];
