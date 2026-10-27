// Catalogue H scatter-plot: points or series on two axes, built in beats the
// way an explainer re-plots an official chart. The axes draw with their
// ticks (linear or log), each series line draws on in order with its points
// popping as the line passes, one series can take the focus (a glow, the
// rest dim), and annotations land one at a time on their own cues: dashed
// guides from a point to both axes with value pills, a "?" placeholder
// point, a labelled callout. Two panels side by side (stacked in portrait)
// compare an official chart with an independent re-run on the same axes.
//
// Annotations are discrete reveals: each has an id and its own event
// (reveal-<id>), so a multi-state shot can switch them on by id. Registered
// in kit/core/catalog-h.mjs (it was part of catalog-h-charts.mjs).

import {decimalsOf, niceStep, timingRules} from './catalog-b-base.mjs';
import {hex2, svgRoot, transformString} from './catalog-b-view.mjs';
import {VARIANT_PARAM, FORMAT_PARAM, clip, createHBase, fitText, numberFormat, r2, rt, textWidth, titleBlock, toneColor} from './catalog-h-base.mjs';
import {abs, chromeNodes, chromeOps, drawOps, el, fadeOps, label, popOps, riseOps, set, strokePath, tw} from './catalog-h-view.mjs';

const at = 'seconds from scene start (optional; else a matching hit, else a default)';
const rect = '{x, y, width, height} canvas px inside the safe zone (optional)';
const tone = 'primary | accent | paper | #rrggbb';
const SCATTER_VARIANTS = Object.freeze(['dots', 'bubbles', 'rings']);
const ANNOTATION_TYPES = ['guide', 'callout', 'placeholder'];
const LINE_DRAW = 0.9;

// ---------------------------------------------------------------------------
// Axes

/** Validated axis {lo, hi, log} from params.x / params.y and the data values. */
function axisRange(check, raw, key, values) {
  const a = raw === undefined ? {} : check.obj(raw, `params.${key}`, ['min', 'max', 'scale']);
  const log = (a.scale ?? 'linear') === 'log';
  if (a.scale !== undefined) check.oneOf(a.scale, `params.${key}.scale`, ['linear', 'log']);
  if (log) values.forEach((v, i) => { if (!(v > 0)) check.fail(`params.${key}.scale`, `"log" needs positive values; value ${i} is ${v}`); });
  const T = log ? Math.log10 : v => v;
  let lo = Math.min(...values.map(T)), hi = Math.max(...values.map(T));
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.08;
  lo -= pad; hi += pad;
  if (a.min !== undefined) { if (log && !(a.min > 0)) check.fail(`params.${key}.min`, 'must be above 0 on a log axis'); lo = T(check.num(a.min, `params.${key}.min`, -1e12, Math.min(...values))); }
  if (a.max !== undefined) hi = T(check.num(a.max, `params.${key}.max`, Math.max(...values), 1e12));
  if (!(hi > lo)) check.fail(`params.${key}`, 'max must be greater than min');
  return {lo, hi, log};
}

/** Tick values inside an axis: round steps (linear) or 1-2-5 decades (log). */
function axisTicks(axis) {
  if (!axis.log) {
    const step = niceStep(axis.hi - axis.lo, 4);
    const out = [];
    for (let v = Math.ceil(axis.lo / step - 1e-9) * step; v <= axis.hi + step * 1e-9; v += step) out.push(Math.round(v * 1e9) / 1e9 || 0);
    return {values: out, step};
  }
  const decades = axis.hi - axis.lo;
  const mult = decades < 1.2 ? [1, 2, 5] : decades < 2.5 ? [1, 3] : [1];
  const out = [];
  for (let e = Math.floor(axis.lo) - 1; e <= Math.ceil(axis.hi); e++) for (const m of mult) {
    const v = m * 10 ** e;
    if (Math.log10(v) >= axis.lo - 1e-9 && Math.log10(v) <= axis.hi + 1e-9) out.push(Number(v.toPrecision(6)));
  }
  return {values: out, step: null};
}

// ---------------------------------------------------------------------------
// Resolve

const SCATTER_ALLOWED = ['points', 'series', 'panels', 'focus', 'focusAt', 'annotations', 'xLabel', 'yLabel', 'format', 'xFormat', 'title', 'source', 'at', 'highlight', 'highlightAt', 'trend', 'x', 'y', 'tone'];

function seriesList(b, raw, path, base) {
  const {check} = b;
  check.arr(raw, path, 1, 5);
  const palette = b.series(raw.length);
  return raw.map((s, i) => {
    check.obj(s, `${path}[${i}]`, ['label', 'points', 'color', 'line', 'at'], ['points']);
    check.arr(s.points, `${path}[${i}].points`, 1, 24);
    const color = s.color === undefined ? palette[i] ?? base : toneColor(b, s.color, `${path}[${i}].color`);
    return {label: s.label === undefined ? null : check.str(s.label, `${path}[${i}].label`, 22), color, line: s.line === undefined ? s.points.length > 1 : check.bool(s.line, `${path}[${i}].line`), at: s.at,
      points: s.points.map((pt, j) => {
        check.obj(pt, `${path}[${i}].points[${j}]`, ['x', 'y', 'label', 'size'], ['x', 'y']);
        return {x: check.num(pt.x, `${path}[${i}].points[${j}].x`, -1e12, 1e12), y: check.num(pt.y, `${path}[${i}].points[${j}].y`, -1e12, 1e12), size: pt.size === undefined ? 1 : check.num(pt.size, `${path}[${i}].points[${j}].size`, 0, 1e12),
          label: pt.label === undefined ? null : check.str(pt.label, `${path}[${i}].points[${j}].label`, 22), color};
      })};
  });
}

function annotationList(b, raw, panels) {
  const {check} = b;
  if (raw === undefined) return [];
  check.arr(raw, 'params.annotations', 1, 6);
  const ids = new Set();
  return raw.map((a, i) => {
    const path = `params.annotations[${i}]`;
    check.obj(a, path, ['id', 'type', 'panel', 'at', 'series', 'index', 'x', 'y', 'text', 'label'], ['type']);
    const type = check.oneOf(a.type, `${path}.type`, ANNOTATION_TYPES);
    const id = a.id === undefined ? `a${i}` : check.str(a.id, `${path}.id`, 24);
    if (!/^[a-z][a-z0-9-]{0,23}$/.test(id)) check.fail(`${path}.id`, 'must be lowercase letters, digits or hyphens, starting with a letter');
    if (ids.has(id)) check.fail(`${path}.id`, `repeats "${id}"`);
    ids.add(id);
    const panel = a.panel === undefined ? 0 : check.int(a.panel, `${path}.panel`, 0, panels.length - 1);
    let point;
    if (a.series !== undefined || a.index !== undefined) {
      if (type === 'placeholder') check.fail(`${path}.series`, 'a placeholder sits at {x, y}, not on a series point');
      const list = panels[panel].series;
      const s = check.int(a.series ?? 0, `${path}.series`, 0, list.length - 1);
      const k = check.int(a.index ?? 0, `${path}.index`, 0, list[s].points.length - 1);
      point = {x: list[s].points[k].x, y: list[s].points[k].y, series: s, index: k, color: list[s].color};
    } else {
      if (a.x === undefined || a.y === undefined) check.fail(path, 'needs series and index, or x and y');
      point = {x: check.num(a.x, `${path}.x`, -1e12, 1e12), y: check.num(a.y, `${path}.y`, -1e12, 1e12), series: null, index: null, color: null};
    }
    const text = a.text === undefined ? (type === 'placeholder' ? '?' : null) : check.str(a.text, `${path}.text`, type === 'placeholder' ? 3 : 40);
    if (type === 'callout' && !text) check.fail(`${path}.text`, 'is required for a callout');
    return {id, type, panel, at: a.at, point, text, label: a.label === undefined ? null : check.str(a.label, `${path}.label`, 24)};
  });
}

/** Cue times: explicit `at` or hit, else defaults squeezed to fit the scene. */
function scheduleCues(b, cues, first) {
  const latest = b.lastEvent - 0.6;
  const total = cues.reduce((sum, cue) => sum + cue.gap, 0);
  const span = Math.max(0, latest - first);
  const k = total > span && total > 0 ? span / total : 1;
  let cursor = first;
  for (const cue of cues) {
    cue.time = b.timeOf(cue.name, cue.at, cue.path, Math.min(cursor, latest), {min: Math.min(first, latest) - 1e-6});
    cursor = cue.time - b.start + cue.gap * k;
  }
}

function scatterResolve(params, ctx) {
  const b = createHBase('scatter-plot', params, ctx, {allowed: SCATTER_ALLOWED, variants: SCATTER_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  const base = toneColor(b, p.tone, 'params.tone');
  const given = ['points', 'series', 'panels'].filter(key => p[key] !== undefined);
  if (given.length !== 1) check.fail('params', `needs exactly one of points, series or panels (got ${given.length ? given.join(', ') : 'none'})`);

  // Panels: one, or two compared side by side, each with its own series.
  let panels;
  if (p.points !== undefined) {
    check.arr(p.points, 'params.points', 3, 60);
    const points = p.points.map((pt, i) => {
      check.obj(pt, `params.points[${i}]`, ['x', 'y', 'size', 'label', 'color'], ['x', 'y']);
      return {x: check.num(pt.x, `params.points[${i}].x`, -1e12, 1e12), y: check.num(pt.y, `params.points[${i}].y`, -1e12, 1e12), size: pt.size === undefined ? 1 : check.num(pt.size, `params.points[${i}].size`, 0, 1e12),
        label: pt.label === undefined ? null : check.str(pt.label, `params.points[${i}].label`, 22), color: pt.color === undefined ? base : toneColor(b, pt.color, `params.points[${i}].color`)};
    });
    panels = [{title: null, series: [{label: null, color: base, line: false, points, at: undefined, cloud: true}]}];
  } else if (p.series !== undefined) {
    panels = [{title: null, series: seriesList(b, p.series, 'params.series', base)}];
  } else {
    check.arr(p.panels, 'params.panels', 2, 2);
    panels = p.panels.map((panel, i) => {
      check.obj(panel, `params.panels[${i}]`, ['title', 'series'], ['title', 'series']);
      return {title: check.str(panel.title, `params.panels[${i}].title`, 32), series: seriesList(b, panel.series, `params.panels[${i}].series`, base)};
    });
  }
  if (p.trend !== undefined && p.points === undefined) check.fail('params.trend', 'needs params.points');
  if (p.highlight !== undefined && p.points === undefined) check.fail('params.highlight', 'needs params.points (with series, use an annotation)');
  const annotations = annotationList(b, p.annotations, panels);
  const allPoints = panels.flatMap(panel => panel.series.flatMap(s => s.points));
  const xs = [...allPoints.map(pt => pt.x), ...annotations.filter(a => a.point.series === null).map(a => a.point.x)];
  const ys = [...allPoints.map(pt => pt.y), ...annotations.filter(a => a.point.series === null).map(a => a.point.y)];
  const X = axisRange(check, p.x, 'x', xs), Y = axisRange(check, p.y, 'y', ys);
  const yFmt = numberFormat(check, p.format, 'params.format', {decimals: Math.max(0, ...ys.map(decimalsOf))});
  const xFmt = numberFormat(check, p.xFormat, 'params.xFormat', {decimals: Math.max(0, ...xs.map(decimalsOf))});
  const xTicks = axisTicks(X), yTicks = axisTicks(Y);
  // Tick labels: the value format at the step's decimals (log axes: compact).
  const tickFmt = (raw, path, t) => {
    if (t.step !== null) return numberFormat(check, raw, path, {decimals: Math.max(0, ...t.values.map(decimalsOf))}).format;
    const {decimals, ...rest} = raw ?? {compact: true};
    return v => numberFormat(check, rest, path, {decimals: decimalsOf(v)}).format(v);
  };
  const xText = tickFmt(p.xFormat, 'params.xFormat', xTicks), yText = tickFmt(p.format, 'params.format', yTicks);

  let focus = null;
  if (p.focus !== undefined) {
    const count = Math.max(...panels.map(panel => panel.series.length));
    if (count < 2) check.fail('params.focus', 'needs at least two series');
    focus = check.int(p.focus, 'params.focus', 0, count - 1);
  } else if (p.focusAt !== undefined) check.fail('params.focusAt', 'needs params.focus');
  const highlight = p.highlight === undefined ? null : check.int(p.highlight, 'params.highlight', 0, allPoints.length - 1);
  if (p.highlightAt !== undefined && highlight === null) check.fail('params.highlightAt', 'needs params.highlight');
  const trend = p.trend === undefined ? false : check.bool(p.trend, 'params.trend');
  const xLabel = p.xLabel === undefined ? null : check.str(p.xLabel, 'params.xLabel', 32);
  const yLabel = p.yLabel === undefined ? null : check.str(p.yLabel, 'params.yLabel', 32);
  const tb = titleBlock(b, {title: p.title, source: p.source});

  // Layout: panels side by side (landscape) or stacked (portrait).
  const W = rect.width, H = rect.height - tb.top - tb.bottom;
  const two = panels.length === 2, side = two && !b.portrait;
  const gap = u(two ? 36 : 0);
  const boxes = panels.map((_, i) => side ? {x: r2(i * (W + gap) / 2), y: r2(tb.top), width: r2((W - gap) / 2), height: r2(H)}
    : {x: 0, y: r2(tb.top + i * (H + gap) / panels.length), width: r2(W), height: r2((H - gap * (panels.length - 1)) / panels.length)});
  const tickSize = r2(Math.max(b.min.meta, u(26)));
  const axisSize = r2(Math.max(b.min.meta, u(28)));
  const legendSize = r2(Math.max(b.min.meta, u(28)));
  const panelTitleSize = two ? Math.min(...panels.map((panel, i) => fitText(check, `params.panels[${i}].title`, panel.title, {family: 'body', width: boxes[i].width - u(56), preferred: u(44), min: b.min.key}).size)) : 0;
  const yTickW = Math.max(...yTicks.values.map(v => textWidth(yText(v), tickSize, 'meta'))) + u(16);
  const hasLegend = panels.some(panel => panel.series.some(s => s.label));
  // Stacked panels (portrait) share one legend above them and split the axis labels.
  const stacked = two && !side;
  const pad = two ? u(stacked ? 20 : 28) : 0;
  const maxSize = Math.max(...allPoints.map(pt => pt.size)) || 1;
  const sized = allPoints.some(pt => pt.size !== allPoints[0].size);
  const dotBase = u(Math.max(16, Math.min(28, 300 / Math.sqrt(allPoints.length))));
  const bubbles = b.variant === 'bubbles';

  const sharedLegendY = r2(tb.top);
  if (stacked && hasLegend) {
    const shift = legendSize * 1.4 + u(10);
    boxes.forEach((box, i) => { box.y = r2(box.y + (i === 0 ? shift : shift / 2)); box.height = r2(box.height - shift / 2); });
  }
  const layouts = panels.map((panel, pi) => {
    const box = boxes[pi];
    const showY = Boolean(yLabel) && (!stacked || pi === 0), showX = Boolean(xLabel) && (!stacked || pi === panels.length - 1);
    let top = box.y + pad;
    const titleY = r2(top);
    if (two) top += panelTitleSize * 1.25 + u(12);
    const legendY = r2(stacked ? sharedLegendY : top);
    if (hasLegend && !stacked) top += legendSize * 1.4 + u(10);
    const yLabelY = r2(top);
    top += showY ? axisSize * 1.4 + u(6) : u(10);
    const bottom = box.y + box.height - pad - (showX ? axisSize * 1.3 + u(8) : 0) - tickSize * 1.3 - u(12);
    const plot = {x: r2(box.x + pad + yTickW), y: r2(top), width: r2(box.width - 2 * pad - yTickW - u(10)), height: r2(bottom - top)};
    if (plot.height < u(stacked ? 150 : 240)) check.fail('params', 'leaves too little height for the plot; drop the title, the axis labels or a panel, or enlarge rect');
    const px = v => r2(plot.x + plot.width * ((X.log ? Math.log10(v) : v) - X.lo) / (X.hi - X.lo));
    const py = v => r2(plot.y + plot.height * (1 - ((Y.log ? Math.log10(v) : v) - Y.lo) / (Y.hi - Y.lo)));
    return {box, plot, px, py, titleY, legendY, yLabelY, showX, showY, xLabelY: r2(bottom + tickSize * 1.3 + u(14)), tickY: r2(bottom + u(10))};
  });

  // Cues: build, each line series, the second panel, focus, highlight, annotations.
  const buildAt = b.timeOf('build', p.at, 'params.at', 0.5);
  const buildEnd = rt(buildAt + 0.6);
  b.events.push({id: `${b.id}-build`, name: 'build', time: buildAt, endTime: buildEnd, role: 'emphasis', cue: 'tally'});
  const cues = [];
  let seriesIndex = 0;
  panels.forEach((panel, pi) => {
    if (pi > 0) cues.push({name: 'panel-1', path: 'params.panels[1] (event panel-1)', gap: 0.6, kind: 'panel', panel: pi});
    panel.series.forEach((s, si) => {
      s.global = seriesIndex++;
      if (s.cloud) return;
      cues.push({name: `series-${s.global}`, at: s.at, path: `params.${p.panels ? `panels[${pi}].series` : 'series'}[${si}].at`, gap: s.line ? 0.75 : 0.45, kind: 'series', panel: pi, series: si});
    });
  });
  if (focus !== null) cues.push({name: 'focus', at: p.focusAt, path: 'params.focusAt', gap: 0.7, kind: 'focus'});
  if (highlight !== null) cues.push({name: 'highlight', at: p.highlightAt, path: 'params.highlightAt', gap: 0.6, kind: 'highlight'});
  annotations.forEach((a, i) => cues.push({name: `reveal-${a.id}`, at: a.at, path: `params.annotations[${i}].at`, gap: 0.8, kind: 'annotation', annotation: a}));
  const cloud = panels[0].series[0].cloud;
  const cloudSpan = cloud ? Math.min(0.9, 0.03 * allPoints.length + 0.3) : 0;
  scheduleCues(b, cues, buildAt - b.start + (cloud ? 0.35 + cloudSpan + 0.25 : 0.45));
  const cueOf = (kind, match = () => true) => cues.find(cue => cue.kind === kind && match(cue));
  const panelAt = pi => (pi === 0 ? buildAt : cueOf('panel', cue => cue.panel === pi).time);
  for (const cue of cues) {
    const span = cue.kind === 'series' ? LINE_DRAW : cue.kind === 'panel' ? 0.6 : 0.5;
    b.events.push({id: `${b.id}-${cue.name}`, name: cue.name, time: cue.time, endTime: rt(cue.time + span), role: 'emphasis', cue: cue.kind === 'series' ? 'whoosh-soft' : cue.kind === 'panel' ? 'whoosh' : 'hit-soft'});
  }

  // Marks and lines.
  const marks = [], lines = [];
  panels.forEach((panel, pi) => {
    const L = layouts[pi];
    panel.series.forEach((s, si) => {
      const cue = cueOf('series', c => c.panel === pi && c.series === si);
      const t0 = s.cloud ? rt(buildAt + 0.35) : cue.time;
      const pts = s.points.map(pt => ({x: L.px(pt.x), y: L.py(pt.y)}));
      const lengths = pts.map((pt, k) => (k === 0 ? 0 : Math.hypot(pt.x - pts[k - 1].x, pt.y - pts[k - 1].y)));
      const total = lengths.reduce((sum, len) => sum + len, 0) || 1;
      let run = 0;
      const order = s.points.map((_, k) => k).sort((a, c) => s.points[a].x - s.points[c].x);
      s.points.forEach((pt, k) => {
        run += lengths[k];
        const d = r2(bubbles && sized ? dotBase * (0.8 + 2.6 * Math.sqrt(pt.size / maxSize)) : bubbles ? dotBase * 1.3 : s.line ? dotBase * 0.8 : dotBase);
        const time = s.cloud ? rt(t0 + cloudSpan * order.indexOf(k) / Math.max(1, s.points.length - 1)) : s.line ? rt(t0 + LINE_DRAW * run / total - 0.05) : rt(t0 + 0.06 * k);
        marks.push({x: pts[k].x, y: pts[k].y, d, color: pt.color, label: pt.label, time: Math.max(t0, time), series: s.global, panel: pi, value: pt});
      });
      if (s.line) lines.push({d: pts.map((pt, k) => `${k ? 'L' : 'M'}${pt.x} ${pt.y}`).join(' '), color: s.color, time: t0, series: s.global, index: si, panel: pi});
    });
  });

  let trendLine = null;
  if (trend) {
    const pts = panels[0].series[0].points, n = pts.length, L = layouts[0];
    const mx = pts.reduce((s, pt) => s + pt.x, 0) / n, my = pts.reduce((s, pt) => s + pt.y, 0) / n;
    const sxx = pts.reduce((s, pt) => s + (pt.x - mx) ** 2, 0), sxy = pts.reduce((s, pt) => s + (pt.x - mx) * (pt.y - my), 0);
    const slope = sxx ? sxy / sxx : 0;
    const xa = X.log ? 10 ** X.lo : X.lo, xb = X.log ? 10 ** X.hi : X.hi;
    const yAt = x => my + slope * (x - mx);
    const clampY = v => Math.min(Math.max(Y.log && !(v > 0) ? L.plot.y + L.plot.height : L.py(v), L.plot.y), L.plot.y + L.plot.height);
    trendLine = {d: `M${L.px(xa)} ${r2(clampY(yAt(xa)))} L${L.px(xb)} ${r2(clampY(yAt(xb)))}`, time: rt(buildAt + 0.35 + cloudSpan + 0.1)};
  }

  // The legacy point highlight: one labelled callout pill.
  let callout = null;
  const highlightAt = highlight === null ? null : cueOf('highlight').time;
  if (highlight !== null) {
    const m = marks[highlight];
    const text = m.label ?? `(${allPoints[highlight].x}, ${allPoints[highlight].y})`;
    const size = r2(Math.max(b.min.meta, u(34)));
    const w = r2(textWidth(text, size, 'body') + u(36));
    const right = m.x + w + m.d < W;
    callout = {text, size, width: w, x: r2(right ? m.x + m.d / 2 + u(14) : m.x - m.d / 2 - u(14) - w), y: r2(Math.max(layouts[0].plot.y, m.y - size * 0.75 - u(9))), height: r2(size * 1.25 + u(18))};
  }

  // Annotations, each with its geometry and reveal time.
  const noteSize = r2(Math.max(b.min.meta, u(30)));
  const pillSize = r2(Math.max(b.min.meta, u(26)));
  const notes = annotations.map(a => {
    const L = layouts[a.panel], P = L.plot;
    const time = cueOf('annotation', cue => cue.annotation === a).time;
    const x = L.px(a.point.x), y = L.py(a.point.y);
    if (x < P.x - 1 || x > P.x + P.width + 1 || y < P.y - 1 || y > P.y + P.height + 1) check.fail(`params.annotations (${a.id})`, 'falls outside the axes; widen params.x or params.y');
    const color = a.point.color ?? b.colors.accent;
    const out = {id: a.id, type: a.type, panel: a.panel, time, x, y, color, text: a.text};
    const textBox = (text, size, family) => ({w: r2(textWidth(text, size, family) + u(36)), h: r2(size * 1.25 + u(18))});
    if (a.type === 'guide') {
      const xv = xFmt.format(a.point.x), yv = yFmt.format(a.point.y);
      const xb = textBox(xv, pillSize, 'meta'), yb = textBox(yv, pillSize, 'meta');
      out.v = {x: r2(x - u(1.5)), y, width: r2(3 * u(1)), height: r2(P.y + P.height - y)};
      out.h = {x: P.x, y: r2(y - u(1.5)), width: r2(x - P.x), height: r2(3 * u(1))};
      out.xPill = {text: xv, x: r2(Math.min(Math.max(x - xb.w / 2, L.box.x), L.box.x + L.box.width - xb.w)), y: r2(P.y + P.height + u(6)), ...xb};
      out.yPill = {text: yv, x: r2(Math.max(L.box.x, P.x - yb.w - u(6))), y: r2(y - yb.h / 2), ...yb};
      if (a.text) {
        const tbx = textBox(a.text, noteSize, 'body');
        out.tag = {text: a.text, x: r2(x + tbx.w + u(20) <= P.x + P.width ? x + u(20) : x - u(20) - tbx.w), y: r2(Math.max(P.y, y - tbx.h - u(14))), ...tbx};
      }
    } else if (a.type === 'placeholder') {
      out.d = r2(dotBase * 2.4);
      out.size = r2(out.d * 0.62);
      if (a.label) {
        const lb = textBox(a.label, noteSize, 'body');
        out.tag = {text: a.label, x: r2(Math.min(Math.max(x - lb.w / 2, P.x), P.x + P.width - lb.w)), y: r2(y + out.d / 2 + u(12) + lb.h > P.y + P.height ? y - out.d / 2 - u(12) - lb.h : y + out.d / 2 + u(12)), ...lb};
      }
    } else {
      const cb = textBox(a.text, noteSize, 'body');
      // The spot inside the plot that covers the fewest points of this panel
      // (above or below, right or left, near then far; the first on a tie).
      const pad = u(14);
      const spots = [];
      for (const dy of [-u(70) - cb.h, u(50), -u(160) - cb.h, u(140), -u(250) - cb.h, -u(340) - cb.h]) for (const dx of [u(60), -u(60) - cb.w, u(240), -u(240) - cb.w]) spots.push([x + dx, y + dy]);
      const fits = ([sx, sy]) => sx >= L.box.x && sx + cb.w <= L.box.x + L.box.width && sy >= P.y && sy + cb.h <= P.y + P.height;
      const covered = ([sx, sy]) => marks.filter(m => m.panel === a.panel && m.x > sx - m.d / 2 - pad && m.x < sx + cb.w + m.d / 2 + pad && m.y > sy - m.d / 2 - pad && m.y < sy + cb.h + m.d / 2 + pad).length;
      const inside = spots.filter(fits);
      const [cx, cy] = inside.length ? inside.reduce((best, sp) => (covered(sp) < covered(best) ? sp : best)) : spots[0];
      out.card = {text: a.text, x: r2(cx), y: r2(cy), ...cb};
      const right = cx > x;
      const ex = right ? out.card.x : out.card.x + cb.w, ey = r2(out.card.y + cb.h / 2);
      out.leader = `M${x} ${y} L${r2((x + ex) / 2)} ${ey} L${ex} ${ey}`;
    }
    return out;
  });

  const lastCue = cues.length ? Math.max(...cues.map(cue => cue.time)) : buildEnd;
  const content = {variant: b.variant, title: tb.title, source: tb.source, two, panels: panels.map((panel, pi) => ({title: panel.title, at: panelAt(pi), legend: stacked && pi > 0 ? [] : panel.series.filter(s => s.label).map(s => ({label: s.label, color: s.color, series: s.global})), ...layouts[pi], px: undefined, py: undefined})),
    xTicks: xTicks.values.map(v => ({text: xText(v), value: v})), yTicks: yTicks.values.map(v => ({text: yText(v), value: v})), X, Y, marks, lines, trendLine, highlight, highlightAt, callout,
    focus, focusAt: focus === null ? null : cueOf('focus').time, notes, xLabel, yLabel, axisSize, tickSize, legendSize, panelTitleSize, noteSize, pillSize, buildAt, buildEnd: rt(Math.max(buildEnd, lastCue + 0.6)),
    stroke: u(5), axis: b.theme.muted, gridColor: b.theme.border, ink: b.theme.foreground, panel: b.theme.bg, card: b.theme.panel, rim: hex2(b.colors.accent, 0.45), accent: b.colors.accent};
  // Each panel's tick positions, kept on the panel so the view needs no scale functions.
  content.panels.forEach((panel, pi) => {
    const L = layouts[pi];
    panel.xTickX = xTicks.values.map(v => L.px(v));
    panel.yTickY = yTicks.values.map(v => L.py(v));
    delete panel.px; delete panel.py;
  });
  return b.finish(content, {minTextPx: Math.min(tb.title ? tb.title.size : b.min.key, two ? panelTitleSize : Infinity)});
}

// ---------------------------------------------------------------------------
// View

const dashed = (color, vertical, u) => ({backgroundImage: `repeating-linear-gradient(${vertical ? '180deg' : '90deg'}, ${color} 0 ${r2(10 * u)}px, transparent ${r2(10 * u)}px ${r2(18 * u)}px)`});

function pill(id, box, text, {size, family, color, background, border, weight = 650}) {
  return el('div', id, {...abs(box.x, box.y, box.w, box.h), boxSizing: 'border-box', borderRadius: 99, background, border, opacity: 0}, [
    label(null, 0, r2((box.h - size * 1.25) / 2), box.w, text, {size, family, color, align: 'center', weight, lineHeight: 1.25})
  ]);
}

function scatterView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const kids = chromeNodes(model);
  const W = model.rect.width, H = model.rect.height;
  c.panels.forEach((panel, pi) => {
    const P = panel.plot, B = panel.box, pre = `${id}-p${pi}`;
    if (c.two) {
      kids.push(el('div', `${pre}-card`, {...abs(B.x, B.y, B.width, B.height), boxSizing: 'border-box', borderRadius: r2(26 * u), background: hex2(c.card, 0.78), border: `${r2(2 * u)}px solid ${c.rim}`,
        boxShadow: `0 0 ${r2(28 * u)}px ${hex2(c.accent, 0.16)}`, opacity: 0}));
      kids.push(label(`${pre}-title`, r2(B.x + 28 * u), panel.titleY, r2(B.width - 56 * u), panel.title, {size: c.panelTitleSize, family: fonts.body, color: c.ink, weight: 700, extra: {opacity: 0}}));
    }
    panel.yTickY.forEach((y, k) => kids.push(el('div', `${pre}-grid-${k}`, abs(P.x, r2(y - u), P.width, r2(2 * u), {background: c.gridColor, opacity: 0, transformOrigin: '0% 50%'}))));
    kids.push(el('div', `${pre}-xaxis`, abs(P.x, r2(P.y + P.height - 1.5 * u), P.width, r2(3 * u), {background: c.axis, transformOrigin: '0% 50%', transform: transformString({scaleX: 0})})));
    kids.push(el('div', `${pre}-yaxis`, abs(r2(P.x - 1.5 * u), P.y, r2(3 * u), P.height, {background: c.axis, transformOrigin: '50% 100%', transform: transformString({scaleY: 0})})));
    const tw2 = r2(140 * u);
    c.xTicks.forEach((t, k) => kids.push(label(`${pre}-xt-${k}`, r2(panel.xTickX[k] - tw2 / 2), panel.tickY, tw2, t.text, {size: c.tickSize, family: fonts.meta, color: c.axis, align: 'center', extra: {opacity: 0}})));
    c.yTicks.forEach((t, k) => kids.push(label(`${pre}-yt-${k}`, B.x, r2(panel.yTickY[k] - c.tickSize * 0.62), r2(P.x - B.x - 12 * u), t.text, {size: c.tickSize, family: fonts.meta, color: c.axis, align: 'right', extra: {opacity: 0}})));
    if (c.xLabel && panel.showX) kids.push(label(`${pre}-xlabel`, P.x, panel.xLabelY, P.width, c.xLabel, {size: c.axisSize, family: fonts.meta, color: c.axis, align: 'right', spacing: '0.06em', extra: {opacity: 0}}));
    if (c.yLabel && panel.showY) kids.push(label(`${pre}-ylabel`, P.x, panel.yLabelY, P.width, c.yLabel, {size: c.axisSize, family: fonts.meta, color: c.axis, spacing: '0.06em', extra: {opacity: 0}}));
    let lx = P.x;
    panel.legend.forEach((item, k) => {
      const w = r2(c.legendSize * 1.6 + textWidth(item.label, c.legendSize, 'body') + 34 * u);
      kids.push(el('div', `${pre}-legend-${k}`, abs(r2(lx), panel.legendY, w, r2(c.legendSize * 1.3), {opacity: 0}), [
        el('div', null, abs(0, r2(c.legendSize * 0.32), r2(c.legendSize * 0.7), r2(c.legendSize * 0.7), {borderRadius: '50%', background: item.color})),
        label(null, r2(c.legendSize * 0.7 + 12 * u), 0, undefined, item.label, {size: c.legendSize, family: fonts.body, color: c.ink, weight: 600, lineHeight: 1.3})
      ]));
      lx += w;
    });
  });
  // Lines: one svg per series, so a series can dim and glow as one.
  for (const line of c.lines) {
    const sid = `${id}-s-${line.series}`;
    const glow = c.focus === line.index ? [el('path', `${sid}-glow`, {opacity: 0, filter: `blur(${r2(7 * u)}px)`}, [], {d: line.d, stroke: line.color, strokeWidth: r2(c.stroke * 3.2), strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none'})] : [];
    kids.push(el('div', `${sid}-wrap`, abs(0, 0, W, H), [svgRoot(W, H, [...glow, strokePath(`${sid}-line`, line.d, line.color, c.stroke)])]));
  }
  if (c.trendLine) kids.push(svgRoot(W, H, [strokePath(`${id}-trend`, c.trendLine.d, c.ink, r2(4 * u), {opacity: 0.7})]));
  c.marks.forEach((m, i) => {
    const rings = c.variant === 'rings';
    kids.push(el('div', `${id}-dot-${i}`, abs(r2(m.x - m.d / 2), r2(m.y - m.d / 2), m.d, m.d, {boxSizing: 'border-box', borderRadius: '50%',
      background: rings ? c.panel : c.variant === 'bubbles' ? `${m.color}b3` : m.color, border: rings ? `${r2(5 * u)}px solid ${m.color}` : c.variant === 'bubbles' ? `${r2(3 * u)}px solid ${m.color}` : 'none', opacity: 0})));
  });
  if (c.callout) {
    const C = c.callout;
    kids.push(el('div', `${id}-callout`, abs(C.x, C.y, C.width, C.height, {boxSizing: 'border-box', borderRadius: r2(14 * u), background: c.ink, opacity: 0}), [
      label(null, 0, r2(9 * u), C.width, C.text, {size: C.size, family: fonts.body, color: c.panel, align: 'center', weight: 650, lineHeight: 1.25})
    ]));
  }
  for (const n of c.notes) {
    const nid = `${id}-n-${n.id}`;
    const pillStyle = {size: c.pillSize, family: fonts.meta, color: c.panel, background: n.color, border: 'none', weight: 700};
    const tagStyle = {size: c.noteSize, family: fonts.body, color: c.ink, background: hex2(c.card, 0.92), border: `${r2(2 * u)}px solid ${hex2(n.color, 0.7)}`};
    if (n.type === 'guide') {
      kids.push(el('div', `${nid}-v`, {...abs(n.v.x, n.v.y, n.v.width, n.v.height), ...dashed(n.color, true, u), clipPath: 'inset(0% 0% 100% 0%)'}));
      kids.push(el('div', `${nid}-h`, {...abs(n.h.x, n.h.y, n.h.width, n.h.height), ...dashed(n.color, false, u), clipPath: 'inset(0% 0% 0% 100%)'}));
      kids.push(pill(`${nid}-xp`, n.xPill, n.xPill.text, pillStyle));
      kids.push(pill(`${nid}-yp`, n.yPill, n.yPill.text, pillStyle));
      const d = r2(34 * u);
      kids.push(el('div', `${nid}-ring`, abs(r2(n.x - d / 2), r2(n.y - d / 2), d, d, {boxSizing: 'border-box', borderRadius: '50%', border: `${r2(3 * u)}px solid ${n.color}`, boxShadow: `0 0 ${r2(16 * u)}px ${n.color}`, opacity: 0})));
      if (n.tag) kids.push(pill(`${nid}-tag`, n.tag, n.tag.text, tagStyle));
    } else if (n.type === 'placeholder') {
      kids.push(el('div', `${nid}-dot`, abs(r2(n.x - n.d / 2), r2(n.y - n.d / 2), n.d, n.d, {boxSizing: 'border-box', borderRadius: '50%', border: `${r2(4 * u)}px dashed ${n.color}`, background: hex2(n.color, 0.14), opacity: 0}), [
        label(null, 0, r2((n.d - n.size * 1.1) / 2), n.d, n.text, {size: n.size, family: fonts.display, color: n.color, align: 'center', lineHeight: 1.1})
      ]));
      if (n.tag) kids.push(pill(`${nid}-tag`, n.tag, n.tag.text, tagStyle));
    } else {
      kids.push(svgRoot(W, H, [strokePath(`${nid}-leader`, n.leader, n.color, r2(3 * u))]));
      const d = r2(20 * u);
      kids.push(el('div', `${nid}-ring`, abs(r2(n.x - d / 2), r2(n.y - d / 2), d, d, {borderRadius: '50%', background: n.color, boxShadow: `0 0 0 ${r2(7 * u)}px ${hex2(n.color, 0.3)}`, opacity: 0})));
      kids.push(el('div', `${nid}-card`, {...abs(n.card.x, n.card.y, n.card.w, n.card.h), boxSizing: 'border-box', borderRadius: r2(16 * u), background: hex2(c.card, 0.94), border: `${r2(2 * u)}px solid ${n.color}`, boxShadow: `0 0 ${r2(22 * u)}px ${hex2(n.color, 0.35)}`, opacity: 0}, [
        label(null, 0, r2((n.card.h - c.noteSize * 1.25) / 2), n.card.w, n.card.text, {size: c.noteSize, family: fonts.body, color: c.ink, align: 'center', weight: 650, lineHeight: 1.25})
      ]));
    }
  }
  return kids;
}

// ---------------------------------------------------------------------------
// Timeline

function scatterTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  chromeOps(model, ops);
  c.panels.forEach((panel, pi) => {
    const pre = `${id}-p${pi}`, t = panel.at;
    if (c.two) {
      popOps(ops, `${pre}-card`, start, rt(t - 0.15), {from: 0.96, duration: 0.5, ease: 'power3.out', fade: 0.3});
      riseOps(ops, `${pre}-title`, start, t, r2(14 * u));
    }
    panel.yTickY.forEach((_, k) => {
      set(ops, `${pre}-grid-${k}`, start, {opacity: 0, x: 0, y: 0, scaleX: 0, scaleY: 1});
      tw(ops, `${pre}-grid-${k}`, rt(t + 0.1 + k * 0.05), 0.5, 'power2.out', {opacity: 0, scaleX: 0}, {opacity: 1, scaleX: 1});
    });
    set(ops, `${pre}-xaxis`, start, {x: 0, y: 0, scaleX: 0, scaleY: 1});
    tw(ops, `${pre}-xaxis`, t, 0.5, 'power3.out', {scaleX: 0}, {scaleX: 1});
    set(ops, `${pre}-yaxis`, start, {x: 0, y: 0, scaleX: 1, scaleY: 0});
    tw(ops, `${pre}-yaxis`, t, 0.5, 'power3.out', {scaleY: 0}, {scaleY: 1});
    c.xTicks.forEach((_, k) => riseOps(ops, `${pre}-xt-${k}`, start, rt(t + 0.2 + k * 0.04), r2(8 * u), {duration: 0.35}));
    c.yTicks.forEach((_, k) => riseOps(ops, `${pre}-yt-${k}`, start, rt(t + 0.2 + k * 0.04), 0, {duration: 0.35, dx: r2(8 * u)}));
    if (c.xLabel && panel.showX) riseOps(ops, `${pre}-xlabel`, start, rt(t + 0.3), 0);
    if (c.yLabel && panel.showY) riseOps(ops, `${pre}-ylabel`, start, rt(t + 0.3), 0);
    panel.legend.forEach((item, k) => {
      const line = c.lines.find(l => l.series === item.series);
      riseOps(ops, `${pre}-legend-${k}`, start, rt((line ? line.time : t + 0.3) - 0.1), r2(10 * u));
    });
  });
  for (const line of c.lines) drawOps(ops, `${id}-s-${line.series}-line`, start, line.time, LINE_DRAW, 'power2.inOut');
  c.marks.forEach((m, i) => popOps(ops, `${id}-dot-${i}`, start, m.time, {from: 0, duration: 0.4, ease: 'back.out(2.2)', fade: 0.1}));
  if (c.trendLine) drawOps(ops, `${id}-trend`, start, c.trendLine.time, 0.6, 'power2.inOut');
  if (c.highlight !== null) {
    c.marks.forEach((_, i) => { if (i !== c.highlight) fadeOps(ops, `${id}-dot-${i}`, c.highlightAt, 1, 0.3); });
    tw(ops, `${id}-dot-${c.highlight}`, c.highlightAt, 0.45, 'back.out(2)', {scaleX: 1, scaleY: 1}, {scaleX: 1.5, scaleY: 1.5});
    popOps(ops, `${id}-callout`, start, rt(c.highlightAt + 0.1), {from: 0.7});
  }
  if (c.focus !== null) {
    const focused = new Set(c.lines.filter(l => l.index === c.focus).map(l => l.series));
    const seriesOf = new Map(c.lines.map(l => [l.series, l]));
    for (const line of c.lines) {
      const sid = `${id}-s-${line.series}`;
      if (focused.has(line.series)) {
        set(ops, `${sid}-glow`, start, {opacity: 0});
        tw(ops, `${sid}-glow`, c.focusAt, 0.5, 'power2.out', {opacity: 0}, {opacity: 0.75});
      } else fadeOps(ops, `${sid}-wrap`, c.focusAt, 1, 0.3, 0.45);
    }
    c.marks.forEach((m, i) => {
      if (!seriesOf.has(m.series)) return;
      if (focused.has(m.series)) tw(ops, `${id}-dot-${i}`, rt(c.focusAt + 0.05), 0.4, 'back.out(2)', {scaleX: 1, scaleY: 1}, {scaleX: 1.3, scaleY: 1.3});
      else fadeOps(ops, `${id}-dot-${i}`, c.focusAt, 1, 0.3, 0.45);
    });
  }
  for (const n of c.notes) {
    const nid = `${id}-n-${n.id}`, t = n.time;
    if (n.type === 'guide') {
      popOps(ops, `${nid}-ring`, start, t, {from: 0.3, duration: 0.4});
      set(ops, `${nid}-v`, start, {opacity: 1, ...clip(0, 0, 100, 0)});
      tw(ops, `${nid}-v`, rt(t + 0.1), 0.5, 'power2.inOut', clip(0, 0, 100, 0), clip(0, 0, 0, 0));
      set(ops, `${nid}-h`, start, {opacity: 1, ...clip(0, 0, 0, 100)});
      tw(ops, `${nid}-h`, rt(t + 0.1), 0.5, 'power2.inOut', clip(0, 0, 0, 100), clip(0, 0, 0, 0));
      popOps(ops, `${nid}-xp`, start, rt(t + 0.55), {from: 0.6});
      popOps(ops, `${nid}-yp`, start, rt(t + 0.55), {from: 0.6});
      if (n.tag) riseOps(ops, `${nid}-tag`, start, rt(t + 0.3), r2(12 * u));
    } else if (n.type === 'placeholder') {
      popOps(ops, `${nid}-dot`, start, t, {from: 0.2, duration: 0.55, ease: 'back.out(2.4)'});
      if (n.tag) riseOps(ops, `${nid}-tag`, start, rt(t + 0.2), r2(12 * u));
    } else {
      popOps(ops, `${nid}-ring`, start, t, {from: 0.2, duration: 0.4});
      drawOps(ops, `${nid}-leader`, start, rt(t + 0.05), 0.4, 'power2.out');
      popOps(ops, `${nid}-card`, start, rt(t + 0.3), {from: 0.7});
    }
  }
}

export const scatterPlot = {
  id: 'scatter-plot',
  describe: 'Points or 1–5 series on two axes (linear or log, with ticks), built in beats: series lines draw on in order, one series takes the focus with a glow while the rest dim, and annotations land one at a time (dashed guides from a point to both axes with value pills, a "?" placeholder point, labelled callouts). Two panels compare an official chart with an independent re-run.',
  params: {points: `[{x, y, size? (bubbles), label? ≤ 22, color? (${tone})}] 3–60 (one of points, series or panels)`,
    series: `[{points: [{x, y, label?, size?}] 1–24, label? ≤ 22, color? (${tone}), line? (default true with 2+ points), at?}] 1–5; each draws on its own cue (event series-<i>)`,
    panels: '[{title ≤ 32, series}] exactly 2, side by side (stacked in portrait) on shared axes ("Official chart" | "Independent re-run"); their series count on in one sequence (series-<i>), the second panel lands on event panel-1',
    focus: 'series index to glow while the others dim (optional; in both panels; event focus)', focusAt: `the focus: ${at}`,
    annotations: `[{type: "guide" | "callout" | "placeholder", id? (a reveal id; default a<i>), panel?, series? + index? (a series point) | x + y, text? (callout text ≤ 40, guide tag, placeholder glyph ≤ 3, default "?"), label? ≤ 24 (placeholder caption), at?}] 1–6; each lands on its own cue (event reveal-<id>)`,
    x: '{min?, max?, scale?: "linear" | "log"} (optional)', y: '{min?, max?, scale?: "linear" | "log"} (optional)', format: `y values: ${FORMAT_PARAM}`, xFormat: 'x values: as format',
    xLabel: 'string ≤ 32', yLabel: 'string ≤ 32', trend: 'boolean: draw the least-squares line through points (default false)', tone: `dot colour (${tone})`,
    highlight: 'points index to call out (optional; with points)', highlightAt: at, title: 'string ≤ 60 (optional)', source: 'string ≤ 80, where the numbers come from (optional)', at: `build start: ${at}`, variant: VARIANT_PARAM, rect},
  events: ['build', 'panel-1', 'series-<i>', 'focus', 'highlight', 'reveal-<id>'],
  timing: timingRules({rules: ['the axes draw in 0.6 s from at; each series line draws in 0.9 s on its cue', 'default cues follow the build 0.45–0.8 s apart and squeeze to fit the scene']}), variants: SCATTER_VARIANTS,
  resolve: scatterResolve, view: scatterView, timeline: scatterTimeline
};

export const SCATTER = [scatterPlot];
