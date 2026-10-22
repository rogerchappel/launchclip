// Catalogue B module `function-chart`: params → model (resolve), model → static
// element tree (view) and renderer-neutral animation ops (timeline).
// Registered in kit/core/catalog-b.mjs; conventions are documented there.

import {CATALOG_B_STYLE, alphaHex, createBase, decimalsOf, fitText, formatNumber, frameSamples, mixColor, niceStep, overlaps, parseExpression, progress, r2, rt, textWidth, ticks, withUnit} from './catalog-b-base.mjs';
import {abs, el, hex2, sampleTime, set, svgRoot, text, transformString, tw} from './catalog-b-view.mjs';

const color = 'primary | accent | paper | #rrggbb (contrast ≥ 3:1 on bg)';
const at = 'seconds from scene start (optional; else a matching hit, else a default)';
const rect = '{x, y, width, height} canvas px inside the safe zone (optional)';

// ---------------------------------------------------------------------------
// Model

function axisSpec(check, value, path) {
  if (Array.isArray(value)) {
    if (value.length < 2 || value.length > 3) check.fail(path, 'must be [min, max] or [min, max, unit]');
    value = {min: value[0], max: value[1], unit: value[2]};
  } else check.obj(value, path, ['min', 'max', 'unit', 'label'], ['min', 'max']);
  const min = check.num(value.min, `${path}.min`, -1e9, 1e9), max = check.num(value.max, `${path}.max`, -1e9, 1e9);
  if (!(max > min)) check.fail(path, 'max must be greater than min');
  const unit = value.unit === undefined ? '' : check.str(value.unit, `${path}.unit`, 12);
  const label = value.label === undefined ? '' : check.str(value.label, `${path}.label`, 28);
  return {min, max, unit, label};
}

function resolve(params, ctx) {
  const b = createBase('function-chart', params, ctx, {allowed: ['fn', 'x', 'y', 'title', 'label', 'baseline', 'gap_bars', 'probe', 'tail_zoom', 'draw', 'decimals', 'color'], required: ['fn', 'x', 'y']});
  const {check, u, rect, theme, fonts, id, start, fps} = b;
  const p = b.params;
  let expression;
  try { expression = parseExpression(p.fn); } catch (error) { check.fail('params.fn', `is not a valid expression: ${error.message}`); }
  const X = axisSpec(check, p.x, 'params.x'), Y = axisSpec(check, p.y, 'params.y');
  const title = p.title === undefined ? null : check.str(p.title, 'params.title', 60);
  const label = p.label === undefined ? null : check.str(p.label, 'params.label', 36);
  const decimals = p.decimals === undefined ? null : check.int(p.decimals, 'params.decimals', 0, 3);
  const lineColor = b.resolveColor(p.color, 'params.color', 'primary');
  const f = value => {
    try { return expression.evaluate(value); } catch (error) { return check.fail('params.fn', `${error.message} (x range ${X.min}–${X.max})`); }
  };
  const fmt = value => formatNumber(value, decimals ?? (Math.abs(value) >= 100 ? 0 : null));
  // Live readouts keep a steady width: one decimal unless the range is wide.
  const fmtLive = value => formatNumber(value, decimals ?? (Y.max - Y.min > 200 ? 0 : 1));

  let baseline = null;
  if (p.baseline !== undefined) {
    const raw = typeof p.baseline === 'number' ? {value: p.baseline} : check.obj(p.baseline, 'params.baseline', ['value', 'label'], ['value']);
    const value = check.num(raw.value, 'params.baseline.value', Y.min, Y.max);
    baseline = {value, label: raw.label === undefined ? null : check.str(raw.label, 'params.baseline.label', 16), color: b.resolveColor(undefined, 'params.baseline.color', 'accent')};
  }

  // Header: title (left) and the probe readout (right).
  const probeOn = p.probe === undefined ? true : (typeof p.probe === 'boolean' ? p.probe : (check.obj(p.probe, 'params.probe', ['label']), true));
  const probeLabel = typeof p.probe === 'object' && p.probe.label !== undefined ? check.str(p.probe.label, 'params.probe.label', 14) : (X.unit ? `${X.label || 't'} =` : '');
  const W = rect.width, H = rect.height;
  const readoutSize = u(92), readoutMeta = u(28);
  const readoutWidth = probeOn ? textWidth(withUnit(fmt(Math.max(Math.abs(Y.min), Math.abs(Y.max)) + 0.05) + '.0', Y.unit), readoutSize, 'display') : 0;
  let titleFit = null;
  if (title) titleFit = fitText(check, 'params.title', title, {family: 'body', width: W - readoutWidth - u(32), preferred: u(52), min: b.min.key, maxLines: 2});
  const headerHeight = Math.max(titleFit ? titleFit.lines * titleFit.size * 1.12 : 0, probeOn ? readoutSize + u(8) + readoutMeta * 1.2 : 0);
  const metaSize = u(28);
  const yLabelRow = metaSize * 1.6;
  const header = {height: r2(headerHeight), title: title && {text: title, size: titleFit.size, lines: titleFit.lines, width: r2(W - readoutWidth - u(32))},
    readout: probeOn ? {size: readoutSize, metaSize: readoutMeta, right: 0, top: 0} : null};

  // Plot area
  const yTicks = ticks(Y.min, Y.max, 5), xTicks = ticks(X.min, X.max, 6);
  const yTickText = yTicks.map(v => formatNumber(v));
  const yTickWidth = Math.max(...yTickText.map(text => textWidth(text, metaSize, 'meta'))) + u(18);
  const plot = {x: r2(yTickWidth), y: r2(headerHeight + u(24) + yLabelRow), width: 0, height: 0};
  plot.width = r2(W - plot.x - u(12));
  plot.height = r2(H - plot.y - (metaSize * 1.5 + u(16)) - (metaSize * 1.5 + u(10)));
  if (plot.height < u(300)) check.fail('params', `leaves only ${Math.round(plot.height)} px for the plot; shorten the title or enlarge rect`);
  const px = x => plot.x + (x - X.min) / (X.max - X.min) * plot.width;
  const py = y => plot.y + (1 - (y - Y.min) / (Y.max - Y.min)) * plot.height;

  // Curve samples (also checks the y range)
  const N = 160, points = [];
  const tolerance = (Y.max - Y.min) * 0.02;
  for (let i = 0; i <= N; i++) {
    const x = X.min + (X.max - X.min) * i / N, y = f(x);
    if (y < Y.min - tolerance || y > Y.max + tolerance) check.fail('params.fn', `leaves the y range [${Y.min}, ${Y.max}] at x=${r2(x)} (value ${r2(y)}); widen params.y`);
    points.push({x, y, px: r2(px(x)), py: r2(py(Math.min(Y.max, Math.max(Y.min, y))))});
  }
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i].px - points[i - 1].px, points[i].py - points[i - 1].py));
  const totalLength = lengths[lengths.length - 1];
  const path = points.map((pt, i) => `${i ? 'L' : 'M'}${pt.px} ${pt.py}`).join(' ');
  const floorValue = baseline ? baseline.value : Y.min;
  const area = `${path} L${points[N].px} ${r2(py(floorValue))} L${points[0].px} ${r2(py(floorValue))} Z`;
  const atLength = length => {
    let i = 1;
    while (i < lengths.length - 1 && lengths[i] < length) i++;
    const seg = lengths[i] - lengths[i - 1] || 1, k = Math.min(1, Math.max(0, (length - lengths[i - 1]) / seg));
    const a = points[i - 1], c = points[i];
    const x = a.x + (c.x - a.x) * k;
    return {x, y: f(x), px: r2(a.px + (c.px - a.px) * k), py: r2(a.py + (c.py - a.py) * k)};
  };

  // Draw timing
  const drawIn = p.draw === undefined ? {} : check.obj(p.draw, 'params.draw', ['at', 'duration', 'ease']);
  const drawDuration = drawIn.duration === undefined ? Math.min(3.2, Math.max(1.2, b.duration * 0.32)) : check.num(drawIn.duration, 'params.draw.duration', 0.4, 8);
  const drawEase = drawIn.ease === undefined ? 'power2.inOut' : check.oneOf(drawIn.ease, 'params.draw.ease', ['none', 'power1.inOut', 'power2.inOut', 'power3.inOut', 'power2.out', 'power3.out', 'sine.inOut']);
  const drawStart = b.timeOf('draw', drawIn.at, 'params.draw.at', 0.6, {max: b.lastEvent - drawDuration + 0.3});
  const drawEnd = rt(drawStart + drawDuration);
  b.events.push({id: `${id}-draw`, name: 'draw', time: drawStart, endTime: drawEnd, role: 'draw'});
  const tipAt = t => atLength(progress(t, drawStart, drawDuration, drawEase) * totalLength);
  // Time when the tip passes x (inverse of the eased draw, by bisection).
  const timeAtX = xTarget => {
    let lo = drawStart, hi = drawEnd;
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (tipAt(mid).x < xTarget) lo = mid; else hi = mid; }
    return hi;
  };

  // Axes, grid, labels
  const axes = {
    yTicks: yTicks.map((v, i) => ({value: v, text: yTickText[i], y: r2(py(v))})),
    xTicks: xTicks.map(v => ({value: v, text: formatNumber(v), x: r2(px(v))})),
    metaSize, yLabel: [Y.label, Y.unit].filter(Boolean).join(' '), xLabel: [X.label, X.unit && (X.label ? `(${X.unit})` : X.unit)].filter(Boolean).join(' '),
    yLabelPos: {x: 0, y: r2(plot.y - yLabelRow)}, xTickY: r2(plot.y + plot.height + u(12)), xLabelY: r2(plot.y + plot.height + metaSize * 1.5 + u(22))
  };
  const footer = label ? {text: label.toUpperCase(), size: r2(u(24)), x: 0, y: axes.xLabelY} : null;
  const occupied = [];
  if (axes.yLabel) occupied.push({x: 0, y: axes.yLabelPos.y, width: textWidth(axes.yLabel, metaSize, 'meta'), height: metaSize * 1.4});
  if (footer) occupied.push({x: 0, y: footer.y, width: textWidth(footer.text, footer.size, 'meta', 0.14), height: footer.size * 1.4});
  if (axes.xLabel) {
    const w = textWidth(axes.xLabel, metaSize, 'meta');
    const box = {x: W - w, y: axes.xLabelY, width: w, height: metaSize * 1.4};
    if (occupied.some(o => overlaps(o, box, u(16)))) check.fail('params.label', 'collides with the x axis label; shorten one of them');
  }

  // Baseline
  let baselineModel = null;
  if (baseline) {
    const y = r2(py(baseline.value));
    const text = withUnit(`${baseline.label ? `${baseline.label} ` : ''}${fmt(baseline.value)}`, Y.unit);
    const size = b.min.key, w = textWidth(text, size, 'body');
    const endAbove = points[N].py < y; // curve ends above the baseline line (smaller y)
    const below = endAbove ? y + u(10) + size * 1.2 <= plot.y + plot.height : y - u(10) - size * 1.2 < plot.y;
    const labelBox = {x: r2(plot.x + plot.width - w), y: r2(below ? y + u(10) : y - u(10) - size * 1.2), width: r2(w), height: r2(size * 1.2)};
    for (const pt of points) if (pt.px >= labelBox.x && pt.px <= labelBox.x + labelBox.width && pt.py >= labelBox.y && pt.py <= labelBox.y + labelBox.height) check.fail('params.baseline', 'label collides with the curve; adjust params.y or the baseline');
    baselineModel = {value: baseline.value, y, color: baseline.color, text, size, label: labelBox, time: rt(drawStart - 0.15 < b.motion.enterEnd ? b.motion.enterEnd : drawStart - 0.15)};
    occupied.push(labelBox);
  }

  // Gap bars
  const barsIn = p.gap_bars === undefined ? [] : check.arr(p.gap_bars, 'params.gap_bars', 1, 5);
  const gapBars = barsIn.map((entry, i) => {
    const path = `params.gap_bars[${i}]`;
    const raw = typeof entry === 'number' ? {x: entry} : check.obj(entry, path, ['x', 'at', 'label'], ['x']);
    const x = check.num(raw.x, `${path}.x`, X.min, X.max);
    const top = f(x), floor = floorValue, gap = top - floor;
    const passing = timeAtX(x) + 0.12;
    const time = b.timeOf(`gap-bar-${i}`, raw.at, `${path}.at`, Math.max(passing, drawStart + 0.1) - start);
    const yTop = r2(py(top)), yBottom = r2(py(floor));
    const text = raw.label === undefined ? withUnit(fmt(Math.abs(gap)), Y.unit) : check.str(raw.label, `${path}.label`, 12);
    const size = r2(u(54));
    const w = textWidth(text, size, 'display') + u(8);
    // Label sits beside the top end, on the side the curve moves away from.
    const slope = f(Math.min(X.max, x + (X.max - X.min) / 200)) - f(Math.max(X.min, x - (X.max - X.min) / 200));
    const descending = (slope < 0) === (gap >= 0);
    const xBar = r2(px(x));
    let lx = descending ? xBar + u(14) : xBar - u(14) - w;
    lx = Math.min(Math.max(lx, plot.x + u(4)), plot.x + plot.width - w);
    const ly = gap >= 0 ? yTop - u(10) - size * 1.05 : yTop + u(10);
    const labelBox = {x: r2(lx), y: r2(Math.max(plot.y - yLabelRow, ly)), width: r2(w), height: r2(size * 1.05)};
    return {index: i, name: `gap-bar-${i}`, x, value: gap, text, time, endTime: rt(time + 0.45), xBar, yTop: Math.min(yTop, yBottom), yBottom: Math.max(yTop, yBottom), size, label: labelBox, width: r2(u(8))};
  });
  gapBars.forEach((bar, i) => {
    for (const other of [...occupied, ...gapBars.slice(0, i).map(g => g.label)]) if (overlaps(bar.label, other, u(6))) check.fail(`params.gap_bars[${i}]`, `label "${bar.text}" collides with another label; space the bars further apart`);
    for (const pt of points) if (pt.px > bar.label.x && pt.px < bar.label.x + bar.label.width && pt.py > bar.label.y && pt.py < bar.label.y + bar.label.height) check.fail(`params.gap_bars[${i}]`, `label "${bar.text}" sits on the curve; move the bar`);
    b.events.push({id: `${id}-${bar.name}`, name: bar.name, time: bar.time, endTime: bar.endTime, role: 'emphasis', cue: 'tick'});
    occupied.push(bar.label);
  });

  // Probe (tip of the line while it draws) and readout samples
  let probe = null;
  if (probeOn) {
    const samples = frameSamples(drawStart, drawEnd, fps, t => {
      const tip = tipAt(t);
      return {x: tip.px, y: tip.py, text: withUnit(fmtLive(tip.y), Y.unit), meta: probeLabel ? `${probeLabel} ${formatNumber(tip.x, X.max - X.min >= 20 ? 0 : 1)}${X.unit ? ` ${X.unit}` : ''}` : ''};
    });
    probe = {size: r2(u(30)), ring: r2(u(5)), samples, initial: samples[0], final: samples[samples.length - 1], color: lineColor, guideBottom: r2(plot.y + plot.height)};
    b.events.push({id: `${id}-probe-settle`, name: 'probe-settle', time: drawEnd, role: 'settle'});
  }

  // Tail zoom inset
  let tail = null;
  if (p.tail_zoom !== undefined) {
    const raw = typeof p.tail_zoom === 'number' ? {from: p.tail_zoom} : check.obj(p.tail_zoom, 'params.tail_zoom', ['from', 'at', 'corner'], ['from']);
    const from = check.num(raw.from, 'params.tail_zoom.from', X.min, X.max - (X.max - X.min) * 0.1);
    const segment = points.filter(pt => pt.x >= from - 1e-9);
    const values = segment.map(pt => pt.y);
    let lo = Math.min(...values, baseline ? baseline.value : Infinity), hi = Math.max(...values);
    const padV = Math.max((hi - lo) * 0.18, (Y.max - Y.min) * 0.005);
    lo -= padV; hi += padV;
    const lens = {x: r2(px(from) - u(6)), y: r2(Math.max(plot.y, py(hi))), width: 0, height: 0};
    lens.width = r2(plot.x + plot.width - lens.x);
    lens.height = r2(Math.max(u(30), Math.min(plot.y + plot.height, py(lo)) - lens.y));
    const iw = r2(plot.width * 0.52), ih = r2(plot.height * 0.4), m = u(14);
    const corners = {
      'top-right': {x: plot.x + plot.width - iw - m, y: plot.y + m}, 'top-left': {x: plot.x + m, y: plot.y + m},
      'bottom-right': {x: plot.x + plot.width - iw - m, y: plot.y + plot.height - ih - m}, 'bottom-left': {x: plot.x + m, y: plot.y + plot.height - ih - m}
    };
    const score = name => {
      const box = {...corners[name], width: iw, height: ih};
      if (overlaps(box, lens, u(10))) return Infinity;
      let s = 0;
      for (const pt of points) if (pt.px >= box.x && pt.px <= box.x + box.width && pt.py >= box.y && pt.py <= box.y + box.height) s++;
      for (const o of occupied) if (overlaps(box, o, u(4))) s += 1000;
      return s;
    };
    const corner = raw.corner === undefined
      ? Object.keys(corners).reduce((best, name) => (score(name) < score(best) ? name : best), 'top-right')
      : check.oneOf(raw.corner, 'params.tail_zoom.corner', Object.keys(corners));
    if (!Number.isFinite(score(corner))) check.fail('params.tail_zoom', `inset at ${corner} would cover the zoomed region; choose another corner or a later from`);
    if (score(corner) >= 1000) check.fail('params.tail_zoom', `inset at ${corner} would cover a label; choose another corner`);
    const inset = {x: r2(corners[corner].x), y: r2(corners[corner].y), width: iw, height: ih};
    const pad = u(18), head = u(70);
    const inner = {x: pad, y: head, width: iw - pad * 2, height: ih - head - pad};
    const ix = x => inner.x + (x - from) / (X.max - from) * inner.width;
    const iy = y => inner.y + (1 - (y - lo) / (hi - lo)) * inner.height;
    const insetPoints = [];
    for (let i = 0; i <= 80; i++) { const x = from + (X.max - from) * i / 80; insetPoints.push(`${i ? 'L' : 'M'}${r2(ix(x))} ${r2(iy(f(x)))}`); }
    const magnification = Math.max(1, Math.round((Y.max - Y.min) / (hi - lo)));
    const zoomEarliest = Math.max(drawEnd + 0.3, ...gapBars.map(bar => bar.endTime + 0.35)) - start;
    const zoomDuration = 0.65;
    const time = b.timeOf('tail-zoom', raw.at, 'params.tail_zoom.at', zoomEarliest, {min: drawEnd - start, max: b.lastEvent - zoomDuration - 0.4});
    const lensCorners = corner.endsWith('right') ? [[lens.x, lens.y], [lens.x, lens.y + lens.height]] : [[lens.x + lens.width, lens.y], [lens.x + lens.width, lens.y + lens.height]];
    const insetCorners = corner.endsWith('right') ? [[inset.x, inset.y], [inset.x, inset.y + inset.height]] : [[inset.x + inset.width, inset.y], [inset.x + inset.width, inset.y + inset.height]];
    tail = {from, corner, lens, inset, inner: {x: r2(inner.x), y: r2(inner.y), width: r2(inner.width), height: r2(inner.height)}, path: insetPoints.join(' '),
      baselineY: baseline ? r2(iy(baseline.value)) : null, label: `×${magnification} ZOOM`, labelSize: r2(u(24)), endText: withUnit(fmtLive(f(X.max)), Y.unit), endSize: b.min.key,
      endPoint: {x: r2(ix(X.max)), y: r2(iy(f(X.max)))},
      connectors: lensCorners.map((pt, i) => `M${r2(pt[0])} ${r2(pt[1])} L${r2(insetCorners[i][0])} ${r2(insetCorners[i][1])}`),
      zoomFrom: {x: r2(lens.x - inset.x), y: r2(lens.y - inset.y), scaleX: rt(lens.width / iw), scaleY: rt(lens.height / ih)},
      time, lensTime: time, zoomTime: rt(time + 0.15), zoomDuration, drawTime: rt(time + 0.15 + zoomDuration - 0.1), drawDuration: 0.7, endTime: rt(time + 0.15 + zoomDuration)};
    b.events.push({id: `${id}-tail-zoom`, name: 'tail-zoom', time, endTime: tail.endTime, role: 'emphasis', cue: 'whoosh'});
  }

  const content = {
    expression: expression.source, x: X, y: Y, title: header.title, header, label: footer, decimals,
    plot, axes, color: lineColor, glow: alphaHex(lineColor, 0.22), areaTop: alphaHex(lineColor, 0.3), areaBottom: alphaHex(lineColor, 0),
    path, area, length: r2(totalLength), strokeWidth: r2(u(8)), glowWidth: r2(u(24)),
    draw: {time: drawStart, duration: rt(drawDuration), ease: drawEase, endTime: drawEnd, areaTime: rt(drawEnd - 0.1), areaDuration: 0.6},
    baseline: baselineModel, gapBars, probe, tail
  };
  return b.finish(content, {minTextPx: Math.min(b.min.key, titleFit ? titleFit.size : Infinity, gapBars.length ? gapBars[0].size : Infinity)});
}

// ---------------------------------------------------------------------------
// View

function view(model) {
  const {id, theme, fonts, unit: u} = model;
  const c = model.content;
  const P = c.plot, A = c.axes;
  const kids = [];
  const meta = {fontFamily: fonts.meta, fontSize: A.metaSize, lineHeight: '1.2', color: theme.muted};
  if (c.title) kids.push(el('div', `${id}-title`, abs(0, 0, c.title.width, undefined, {margin: 0, fontFamily: fonts.body, fontWeight: 650, fontSize: c.title.size, lineHeight: '1.12', color: theme.foreground, letterSpacing: '-0.01em'}), [c.title.text]));
  if (c.probe) {
    const R = c.header.readout;
    kids.push(text(`${id}-readout`, abs(0, 0, model.rect.width, undefined, {textAlign: 'right', fontFamily: fonts.display, fontSize: R.size, lineHeight: '1', color: c.color, letterSpacing: '0.01em'}), c.probe.initial.text));
    kids.push(text(`${id}-readout-meta`, abs(0, R.size + 8 * u, model.rect.width, undefined, {...meta, fontSize: R.metaSize, textAlign: 'right'}), c.probe.initial.meta));
  }
  if (A.yLabel) kids.push(text(null, abs(A.yLabelPos.x, A.yLabelPos.y, undefined, undefined, meta), A.yLabel));
  // SVG layer: grid, axes, area, baseline, curve, lens and connectors.
  const svg = [];
  svg.push(el('defs', null, null, [el('linearGradient', `${id}-area-fill`, null, [
    el('stop', null, null, [], {offset: '0', stopColor: c.areaTop}), el('stop', null, null, [], {offset: '1', stopColor: c.areaBottom})
  ], {x1: '0', y1: '0', x2: '0', y2: '1'})]));
  for (const tick of A.yTicks) svg.push(el('line', null, null, [], {x1: P.x, y1: tick.y, x2: P.x + P.width, y2: tick.y, stroke: theme.border, strokeWidth: 1.5 * u}));
  svg.push(el('path', null, null, [], {d: `M${P.x} ${P.y} L${P.x} ${P.y + P.height} L${P.x + P.width} ${P.y + P.height}`, stroke: theme.muted, strokeWidth: 3 * u, strokeLinecap: 'round', strokeLinejoin: 'round'}));
  for (const tick of A.xTicks) svg.push(el('line', null, null, [], {x1: tick.x, y1: P.y + P.height, x2: tick.x, y2: P.y + P.height + 10 * u, stroke: theme.muted, strokeWidth: 3 * u}));
  svg.push(el('path', `${id}-area`, {opacity: 0}, [], {d: c.area, fill: `url(#${id}-area-fill)`}));
  if (c.baseline) svg.push(el('line', `${id}-baseline`, {opacity: 0}, [], {x1: P.x, y1: c.baseline.y, x2: P.x + P.width, y2: c.baseline.y, stroke: c.baseline.color, strokeWidth: 3 * u, strokeDasharray: `${14 * u} ${10 * u}`}));
  const dash = {strokeDasharray: 1, strokeDashoffset: 1};
  svg.push(el('path', `${id}-glow`, {...dash}, [], {d: c.path, stroke: c.glow, strokeWidth: c.glowWidth, strokeLinecap: 'round', strokeLinejoin: 'round', pathLength: 1}));
  svg.push(el('path', `${id}-line`, {...dash}, [], {d: c.path, stroke: c.color, strokeWidth: c.strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round', pathLength: 1}));
  if (c.tail) {
    const T = c.tail;
    svg.push(el('rect', `${id}-lens`, {opacity: 0}, [], {x: T.lens.x, y: T.lens.y, width: T.lens.width, height: T.lens.height, rx: 8 * u, stroke: theme.foreground, strokeWidth: 2.5 * u, strokeDasharray: `${8 * u} ${6 * u}`}));
    T.connectors.forEach((d, i) => svg.push(el('path', `${id}-connector-${i}`, {opacity: 0}, [], {d, stroke: theme.muted, strokeWidth: 2 * u})));
  }
  kids.push(svgRoot(model.rect.width, model.rect.height, svg));
  // Tick labels
  const tickW = 140 * u;
  for (const tick of A.yTicks) kids.push(text(null, abs(0, tick.y - A.metaSize * 0.6, P.x - 14 * u, undefined, {...meta, textAlign: 'right'}), tick.text));
  for (const tick of A.xTicks) {
    const left = Math.min(Math.max(tick.x - tickW / 2, 0), model.rect.width - tickW);
    kids.push(text(null, abs(left, A.xTickY, tickW, undefined, {...meta, textAlign: tick.x - tickW / 2 < 0 ? 'left' : tick.x + tickW / 2 > model.rect.width ? 'right' : 'center'}), tick.text));
  }
  if (A.xLabel) kids.push(text(null, abs(0, A.xLabelY, model.rect.width, undefined, {...meta, textAlign: 'right'}), A.xLabel));
  if (c.label) kids.push(text(null, abs(c.label.x, c.label.y - 4 * u, undefined, undefined, {...meta, fontSize: c.label.size, letterSpacing: '0.14em', padding: `${4 * u}px ${12 * u}px`, border: `${2 * u}px solid ${theme.border}`, borderRadius: 999}), c.label.text));
  if (c.baseline) {
    const B = c.baseline;
    kids.push(text(`${id}-baseline-label`, abs(B.label.x, B.label.y, B.label.width, undefined, {textAlign: 'right', fontFamily: fonts.body, fontWeight: 650, fontSize: B.size, lineHeight: '1.2', color: B.color, opacity: 0}), B.text));
  }
  for (const bar of c.gapBars) {
    const h = bar.yBottom - bar.yTop;
    kids.push(el('div', `${id}-bar-${bar.index}`, abs(bar.xBar - bar.width / 2, bar.yTop, bar.width, h, {background: theme.foreground, borderRadius: bar.width / 2, transformOrigin: bar.value >= 0 ? '50% 100%' : '50% 0%', transform: transformString({scaleY: 0}), boxShadow: `0 0 ${14 * u}px ${hex2(theme.foreground, 0.35)}`})));
    kids.push(el('div', `${id}-bar-cap-${bar.index}`, abs(bar.xBar - 11 * u, (bar.value >= 0 ? bar.yTop : bar.yBottom) - 11 * u, 22 * u, 22 * u, {borderRadius: '50%', background: theme.bg, border: `${5 * u}px solid ${theme.foreground}`, boxSizing: 'border-box', opacity: 0})));
    kids.push(text(`${id}-bar-label-${bar.index}`, abs(bar.label.x, bar.label.y, undefined, undefined, {fontFamily: fonts.display, fontSize: bar.size, lineHeight: '1.05', color: theme.foreground, opacity: 0, transform: transformString({y: 14 * u})}), bar.text));
  }
  if (c.probe) {
    const pr = c.probe, first = pr.initial;
    kids.push(el('div', `${id}-guide`, abs(0, P.y, 2 * u, P.height, {background: hex2(theme.foreground, 0.4), transformOrigin: '0% 100%', opacity: 0, transform: transformString({x: first.x - u, scaleY: (P.y + P.height - first.y) / P.height})})));
    kids.push(el('div', `${id}-probe`, abs(-pr.size / 2, -pr.size / 2, pr.size, pr.size, {borderRadius: '50%', background: pr.color, boxSizing: 'border-box', border: `${pr.ring}px solid ${theme.bg}`,
      boxShadow: `0 0 0 ${8 * u}px ${hex2(pr.color, 0.25)}, 0 0 ${30 * u}px ${hex2(pr.color, 0.7)}`, opacity: 0, transform: transformString({x: first.x, y: first.y})})));
  }
  if (c.tail) {
    const T = c.tail, I = T.inset;
    const inner = [];
    const isvg = [];
    if (T.baselineY !== null) isvg.push(el('line', null, null, [], {x1: T.inner.x, y1: T.baselineY, x2: T.inner.x + T.inner.width, y2: T.baselineY, stroke: c.baseline.color, strokeWidth: 3 * u, strokeDasharray: `${12 * u} ${9 * u}`}));
    isvg.push(el('path', `${id}-inset-line`, {strokeDasharray: 1, strokeDashoffset: 1}, [], {d: T.path, stroke: c.color, strokeWidth: c.strokeWidth * 0.85, strokeLinecap: 'round', strokeLinejoin: 'round', pathLength: 1}));
    inner.push(text(null, abs(18 * u, 22 * u, undefined, undefined, {fontFamily: fonts.meta, fontSize: T.labelSize, lineHeight: '1.2', letterSpacing: '0.14em', color: c.color}), T.label));
    isvg.push(el('circle', `${id}-inset-dot`, {opacity: 0}, [], {cx: T.endPoint.x, cy: T.endPoint.y, r: 9 * u, fill: c.color, stroke: theme.panel, strokeWidth: 3 * u}));
    inner.unshift(svgRoot(I.width, I.height, isvg));
    inner.push(text(`${id}-inset-end`, abs(0, 10 * u, I.width - 18 * u, undefined, {textAlign: 'right', fontFamily: fonts.body, fontWeight: 650, fontSize: T.endSize, lineHeight: '1.2', color: theme.foreground, opacity: 0}), T.endText));
    kids.push(el('div', `${id}-inset`, abs(I.x, I.y, I.width, I.height, {boxSizing: 'border-box', overflow: 'hidden', background: theme.panel, border: `${2 * u}px solid ${hex2(c.color, 0.6)}`, borderRadius: 18 * u,
      boxShadow: `0 ${18 * u}px ${48 * u}px #00000080`, transformOrigin: '0% 0%', opacity: 0, transform: transformString(T.zoomFrom)}), inner));
  }
  return kids;
}

// ---------------------------------------------------------------------------
// Timeline

function timeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  const P = c.plot;
  for (const part of ['line', 'glow']) {
    set(ops, `${id}-${part}`, start, {strokeDashoffset: 1});
    tw(ops, `${id}-${part}`, c.draw.time, c.draw.duration, c.draw.ease, {strokeDashoffset: 1}, {strokeDashoffset: 0});
  }
  set(ops, `${id}-area`, start, {opacity: 0});
  tw(ops, `${id}-area`, c.draw.areaTime, c.draw.areaDuration, 'power2.out', {opacity: 0}, {opacity: 1});
  if (c.baseline) for (const part of ['baseline', 'baseline-label']) {
    set(ops, `${id}-${part}`, start, {opacity: 0});
    tw(ops, `${id}-${part}`, c.baseline.time, 0.4, 'power2.out', {opacity: 0}, {opacity: 1});
  }
  for (const bar of c.gapBars) {
    set(ops, `${id}-bar-${bar.index}`, start, {x: 0, y: 0, scaleX: 1, scaleY: 0});
    tw(ops, `${id}-bar-${bar.index}`, bar.time, 0.45, 'power3.out', {scaleY: 0}, {scaleY: 1});
    set(ops, `${id}-bar-cap-${bar.index}`, start, {opacity: 0});
    tw(ops, `${id}-bar-cap-${bar.index}`, bar.time + 0.3, 0.2, 'power2.out', {opacity: 0}, {opacity: 1});
    set(ops, `${id}-bar-label-${bar.index}`, start, {opacity: 0, x: 0, y: 14 * u, scaleX: 1, scaleY: 1});
    tw(ops, `${id}-bar-label-${bar.index}`, bar.time + 0.12, 0.35, 'power3.out', {opacity: 0, y: 14 * u}, {opacity: 1, y: 0});
  }
  if (c.probe) {
    const pr = c.probe, first = pr.initial;
    const guideScale = s => Math.round((P.y + P.height - s.y) / P.height * 1e5) / 1e5;
    set(ops, `${id}-probe`, start, {opacity: 0, x: first.x, y: first.y, scaleX: 1, scaleY: 1});
    set(ops, `${id}-guide`, start, {opacity: 0, x: first.x - u, y: 0, scaleX: 1, scaleY: guideScale(first)});
    set(ops, `${id}-readout`, start, {text: first.text});
    set(ops, `${id}-readout-meta`, start, {text: first.meta});
    tw(ops, `${id}-probe`, c.draw.time, 0.2, 'power2.out', {opacity: 0}, {opacity: 1});
    tw(ops, `${id}-guide`, c.draw.time, 0.2, 'power2.out', {opacity: 0}, {opacity: 1});
    for (const s of pr.samples) {
      const time = sampleTime(s.t);
      set(ops, `${id}-probe`, time, {x: s.x, y: s.y});
      set(ops, `${id}-guide`, time, {x: s.x - u, scaleY: guideScale(s)});
      set(ops, `${id}-readout`, time, {text: s.text});
      set(ops, `${id}-readout-meta`, time, {text: s.meta});
    }
  }
  if (c.tail) {
    const T = c.tail, z = T.zoomFrom;
    set(ops, `${id}-lens`, start, {opacity: 0});
    tw(ops, `${id}-lens`, T.lensTime, 0.3, 'power2.out', {opacity: 0}, {opacity: 1});
    set(ops, `${id}-inset`, start, {opacity: 0, x: z.x, y: z.y, scaleX: z.scaleX, scaleY: z.scaleY});
    tw(ops, `${id}-inset`, T.zoomTime, 0.2, 'power1.out', {opacity: 0}, {opacity: 1});
    tw(ops, `${id}-inset`, T.zoomTime, T.zoomDuration, 'power3.inOut', {x: z.x, y: z.y, scaleX: z.scaleX, scaleY: z.scaleY}, {x: 0, y: 0, scaleX: 1, scaleY: 1});
    T.connectors.forEach((_, i) => {
      set(ops, `${id}-connector-${i}`, start, {opacity: 0});
      tw(ops, `${id}-connector-${i}`, T.zoomTime + T.zoomDuration - 0.15, 0.3, 'power2.out', {opacity: 0}, {opacity: 1});
    });
    set(ops, `${id}-inset-line`, start, {strokeDashoffset: 1});
    tw(ops, `${id}-inset-line`, T.drawTime, T.drawDuration, 'power2.inOut', {strokeDashoffset: 1}, {strokeDashoffset: 0});
    for (const part of ['inset-end', 'inset-dot']) {
      set(ops, `${id}-${part}`, start, {opacity: 0});
      tw(ops, `${id}-${part}`, T.drawTime + T.drawDuration - 0.1, 0.3, 'power2.out', {opacity: 0}, {opacity: 1});
    }
  }
}

export const functionChart = {
  id: 'function-chart',
    describe: 'Plots a formula over time as a line that draws on, with a probe readout riding the tip, optional baseline, gap bars and a tail-zoom inset.',
    params: {fn: 'string expression in t (or x): + - * / ^ ( ), numbers, pi, e, exp log sqrt sin cos abs — e.g. "20 + 70 * 2^(-t/10)"',
      x: '[min, max, unit?] or {min, max, unit?, label?}', y: '[min, max, unit?] or {min, max, unit?, label?}', title: 'string ≤ 60 (optional)',
      label: 'disclaimer, e.g. "illustrative values" (optional)', baseline: 'number or {value, label?} — asymptote line, gap bars measure from it',
      gap_bars: '[x, …] or [{x, at?, label?}] up to 5; events gap-bar-0…', probe: 'true (default) | false | {label}', tail_zoom: '{from: x, at?, corner?} — magnified inset of the tail; event tail-zoom',
      draw: '{at?, duration?, ease?}; event draw', decimals: 'integer 0–3', color, rect},
    events: ['draw', 'gap-bar-<i>', 'probe-settle', 'tail-zoom'],
  resolve,
  view,
  timeline
};
