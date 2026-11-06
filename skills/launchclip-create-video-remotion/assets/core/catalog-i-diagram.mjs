// Catalogue I diagrams: line-diagram, a labelled line sketch on a drafting
// plate (a deck squared with string lines, a beam on a post, a floor plan,
// a wiring run). The drawing is scaled to fill the plate, keeping its
// proportions; strokes are phone-weight and in the brand colours; labels sit
// in backed pills placed clear of every stroke (with a leader line when
// they have to sit off), and each label is timed to stay up for a read
// before the scene ends. Geometry and timing come from diagram-layout.mjs,
// shared with feynman-diagram. Registered through catalog-i-explain.mjs.

import {contrastRatio, timingRules} from './catalog-b-base.mjs';
import {hex2, svgRoot} from './catalog-b-view.mjs';
import {VARIANT_PARAM, createHBase, fitText, mixColor, textWidth, toneColor} from './catalog-h-base.mjs';
import {abs, drawOps, el, label, popOps, riseOps, set, strokePath, tw} from './catalog-h-view.mjs';
import {AT, RECT, dashedPath, drawMaskOps, r2, rt} from './catalog-i-base.mjs';
import {bandCandidates, boundsOf, fitDrawing, labelHold, latestStart, lineCurve, nearestOnRect, placeLabel, pointCandidates, ringCandidates, sampleCurve, scheduleDraw, strokeCandidates} from './diagram-layout.mjs';

const VARIANTS = Object.freeze(['blueprint', 'plain']);
const STYLES = ['solid', 'dashed'];
const WEIGHTS = ['normal', 'heavy'];
const COORD = 100;
// Draw timing (seconds): a stroke draws in DRAW, the next starts GAP later;
// both compress (draw down to MIN_DRAW) before a label is dropped.
const DRAW = 0.6, MIN_DRAW = 0.3, GAP = 0.5, LAG = 0.8;
const POINT_NAME = /^[a-z][a-z0-9]{0,11}$/;

function pickColor(b, value, path, fallback, plate) {
  if (value !== undefined) return toneColor(b, value, path);
  // The brand colour when it reads on the plate (3:1 for graphics), else paper.
  return contrastRatio(fallback, plate) >= 3 ? fallback : b.colors.paper;
}

function resolveLineDiagram(params, ctx) {
  const b = createHBase('line-diagram', params, ctx, {allowed: ['points', 'lines', 'marks', 'title', 'note', 'tone', 'accent', 'at'], required: ['points', 'lines'], variants: VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  const W = rect.width, H = rect.height;

  // Points and strokes.
  check.obj(p.points, 'params.points', Object.keys(p.points ?? {}));
  const names = Object.keys(p.points);
  if (names.length < 2 || names.length > 16) check.fail('params.points', 'must name 2–16 points');
  const points = {};
  for (const name of names) {
    if (!POINT_NAME.test(name)) check.fail(`params.points.${name}`, 'must be named with lowercase letters and digits (≤ 12)');
    check.arr(p.points[name], `params.points.${name}`, 2, 2);
    points[name] = [check.num(p.points[name][0], `params.points.${name}[0]`, 0, COORD), check.num(p.points[name][1], `params.points.${name}[1]`, 0, COORD)];
  }
  check.arr(p.lines, 'params.lines', 1, 16);
  const lines = p.lines.map((line, i) => {
    const path = `params.lines[${i}]`;
    check.obj(line, path, ['from', 'to', 'style', 'weight', 'accent', 'bend', 'label', 'at'], ['from', 'to']);
    for (const end of ['from', 'to']) if (!points[line[end]]) check.fail(`${path}.${end}`, `must name a point (${names.join(', ')})`);
    if (line.from === line.to) check.fail(path, 'must join two different points');
    return {index: i, from: line.from, to: line.to, style: line.style === undefined ? 'solid' : check.oneOf(line.style, `${path}.style`, STYLES),
      weight: line.weight === undefined ? 'normal' : check.oneOf(line.weight, `${path}.weight`, WEIGHTS), accent: line.accent === undefined ? null : check.bool(line.accent, `${path}.accent`),
      bend: line.bend === undefined ? 0 : check.num(line.bend, `${path}.bend`, -1, 1), text: line.label === undefined ? null : check.str(line.label, `${path}.label`, 24), at: line.at};
  });
  const marks = (p.marks === undefined ? [] : check.arr(p.marks, 'params.marks', 0, 8)).map((mark, i) => {
    const path = `params.marks[${i}]`;
    check.obj(mark, path, ['point', 'label'], ['point', 'label']);
    if (!points[mark.point]) check.fail(`${path}.point`, `must name a point (${names.join(', ')})`);
    return {index: i, point: mark.point, text: check.str(mark.label, `${path}.label`, 24)};
  });

  // Plate, colours and chrome.
  const pad = u(40);
  let plate = mixColor(b.colors.primary, b.colors.bg, 0.09);
  if (contrastRatio(b.colors.paper, plate) < 4.5) plate = mixColor(b.colors.paper, b.colors.bg, 0.05);
  const lineColor = pickColor(b, p.tone, 'params.tone', b.colors.primary, plate);
  const accentColor = pickColor(b, p.accent, 'params.accent', b.colors.accent, plate);
  const title = p.title === undefined ? null : check.str(p.title, 'params.title', 60);
  const note = p.note === undefined ? null : check.str(p.note, 'params.note', 80);
  const titleFit = title ? fitText(check, 'params.title', title, {family: 'body', width: W - 2 * pad, preferred: u(64), min: b.min.key, maxLines: 2}) : null;
  const noteFit = note ? fitText(check, 'params.note', note, {family: 'meta', width: W - 2 * pad, preferred: u(30), min: b.min.meta, maxLines: 2}) : null;
  const titleH = titleFit ? r2(titleFit.size * 1.15 * titleFit.lines) : 0;
  const noteH = noteFit ? r2(noteFit.size * 1.3 * noteFit.lines) : 0;
  const inner = {x: pad, y: r2(pad + (titleFit ? titleH + u(28) : 0)), width: r2(W - 2 * pad), height: 0};
  inner.height = r2(H - pad - (noteFit ? noteH + u(24) : 0) - inner.y);

  // Labels: one size for all, the largest that fits the plate (never below key text).
  const texts = [...lines.filter(line => line.text).map(line => line.text), ...marks.map(mark => mark.text)];
  const labelPadX = u(22), labelPadY = u(12);
  const labelSize = Math.min(u(46), ...texts.map((text, i) => fitText(check, `params (label "${text}")`, text, {family: 'body', width: inner.width - 2 * labelPadX - u(24), preferred: u(46), min: b.min.key, maxLines: 1}).size));
  const pillH = r2(labelSize * 1.2 + 2 * labelPadY);
  const pillW = text => r2(textWidth(text, labelSize, 'body') * 1.06 + 2 * labelPadX);

  // Fit the drawing (every stroke's samples) into the plate, leaving room for labels round it.
  const curvesIn = lines.map(line => lineCurve(points[line.from], points[line.to], line.bend));
  const box = boundsOf(curvesIn.flatMap(curve => sampleCurve(curve, 16)));
  const clearance = u(12);
  // Room for labels round the drawing: a band on every side, or, when the
  // drawing is bound by one axis, only on the sides with room to spare (the
  // labels then hang off leaders there), whichever draws it larger.
  const tight = u(24), bandH = r2(pillH + 2 * clearance + u(18)), bandW = r2(Math.max(0, ...texts.map(pillW)) + 2 * clearance + u(18));
  const areaFor = (mx, my) => ({x: inner.x + mx, y: inner.y + my, width: Math.max(u(100), inner.width - 2 * mx), height: Math.max(u(100), inner.height - 2 * my)});
  let area = areaFor(texts.length ? bandH : tight, texts.length ? bandH : tight);
  let fit = fitDrawing(box, area);
  if (texts.length) {
    for (const [mx, my] of [[bandW, tight], [tight, bandH]]) {
      const option = areaFor(mx, my), trial = fitDrawing(box, option);
      // The roomy axis must still leave a label band beside the drawing.
      const spareX = inner.width - box.width * trial.s, spareY = inner.height - box.height * trial.s;
      const fits = mx === tight ? spareY >= 2 * bandH : spareX >= 2 * bandW;
      if (fits && trial.s > fit.s * 1.02) { area = option; fit = trial; }
    }
  }
  const P = name => fit.map(points[name]);
  const stroke = {normal: u(9), heavy: u(18)};

  const touches = {};
  lines.forEach(line => [line.from, line.to].forEach(name => { (touches[name] ??= []).push(line.index); }));
  const markPoints = new Set(marks.map(mark => mark.point));
  const items = lines.map((line, i) => {
    const A = P(line.from), B = P(line.to);
    const curve = lineCurve(A, B, line.bend);
    const width = stroke[line.weight];
    const color = (line.accent ?? line.style === 'dashed') ? accentColor : lineColor;
    const d = line.bend ? `M${r2(A[0])} ${r2(A[1])} Q${r2(curve.C[0])} ${r2(curve.C[1])} ${r2(B[0])} ${r2(B[1])}` : `M${r2(A[0])} ${r2(A[1])} L${r2(B[0])} ${r2(B[1])}`;
    return {...line, color, width: r2(width), d, curve, polyline: (line.bend ? sampleCurve(curve, 24) : [A, B]).map(([x, y]) => [r2(x), r2(y)]), ends: [A, B].map(([x, y]) => [r2(x), r2(y)])};
  });
  const dotR = u(13), ring = u(5);
  const vertices = Object.entries(touches).filter(([name, list]) => list.length >= 2 || markPoints.has(name)).map(([name, list]) => {
    const [x, y] = P(name);
    return {name, x: r2(x), y: r2(y), r: dotR, color: items[list[0]].color, lines: list};
  });

  // Label placement: line labels in order, then marks; each clear of every stroke, dot and label.
  const strokes = items.map(item => ({points: item.polyline, half: item.width / 2}));
  const discs = vertices.map(v => ({x: v.x, y: v.y, r: dotR + ring}));
  const placed = [];
  const offsets = [u(14), u(30), u(54), u(84), u(124), u(170)];
  const centre = [fit.ox + (box.x + box.width / 2) * fit.s, fit.oy + (box.y + box.height / 2) * fit.s];
  const leaderAt = pillH * 0.45;
  const far = [u(150), u(220), u(320), u(440)];
  const drawn = {x: fit.ox + box.x * fit.s, y: fit.oy + box.y * fit.s, width: box.width * fit.s, height: box.height * fit.s};
  const bandGap = u(18) + clearance;
  for (const item of items) {
    if (!item.text) continue;
    const w = pillW(item.text);
    const [mx, my] = item.curve.at(0.5), [tx, ty] = item.curve.tangent(0.5);
    const side = ((mx - centre[0]) * -ty + (my - centre[1]) * tx) >= 0 ? 1 : -1;
    const spot = placeLabel({w, h: pillH, candidates: [...strokeCandidates(item.curve, w, pillH, {side, offsets: offsets.map(o => o + item.width / 2)}), ...bandCandidates([0.5, 0.3, 0.7, 0.12, 0.88].map(s => item.curve.at(s)), drawn, w, pillH, {gap: bandGap + item.width / 2}), ...ringCandidates([mx, my], w, pillH, {radii: far})],
      strokes, discs, boxes: placed, bounds: inner, clearance, own: item.index, leaderAt: leaderAt + item.width / 2});
    placed.push(spot);
    item.label = {box: {x: spot.x, y: spot.y, width: spot.width, height: spot.height}, clear: spot.clear, leader: spot.leader ? leaderPath(spot.anchor, spot, item.width / 2 + u(6)) : null};
  }
  for (const mark of marks) {
    const w = pillW(mark.text);
    const spot = placeLabel({w, h: pillH, candidates: [...pointCandidates(P(mark.point), w, pillH, {offsets: offsets.map(o => o + dotR + ring)}), ...bandCandidates([P(mark.point)], drawn, w, pillH, {gap: bandGap}), ...ringCandidates(P(mark.point), w, pillH, {radii: far})],
      strokes, discs, boxes: placed, bounds: inner, clearance, leaderAt: leaderAt + dotR + ring});
    placed.push(spot);
    mark.box = {x: spot.x, y: spot.y, width: spot.width, height: spot.height};
    mark.clear = spot.clear;
    mark.leader = spot.leader ? leaderPath(spot.anchor, spot, dotR + ring) : null;
    mark.color = vertices.find(v => v.name === mark.point)?.color ?? lineColor;
  }

  // Timing. A mark reads from the first stroke that reaches its point (or the build).
  const enterRel = Math.min(b.motion.enterDuration, 0.5);
  const buildAt = b.timeOf('build', p.at, 'params.at', rt(enterRel + 0.05), {min: 0, max: Math.max(0, b.lastEvent - MIN_DRAW)});
  const first = rt(buildAt - b.start);
  const readEnd = rt(b.motion.exitStart - b.start);
  marks.forEach(mark => { mark.line = touches[mark.point]?.[0] ?? null; });
  const holds = items.map(item => Math.max(item.text ? labelHold(item.text) : 0, ...marks.filter(mark => mark.line === item.index).map(mark => labelHold(mark.text))));
  const plan = scheduleDraw(holds.map(hold => ({hold})), {first, lastEvent: b.lastEvent, readEnd, gap: GAP, draw: DRAW, minDraw: MIN_DRAW, lag: LAG});
  const dropped = [];
  for (const i of plan.dropped) {
    if (items[i].text) { dropped.push(items[i].text); items[i].label = null; }
    for (const mark of marks) if (mark.line === i && !mark.dropped) { mark.dropped = true; dropped.push(mark.text); }
    holds[i] = 0;
  }
  const hits = Array.isArray(ctx.hits) ? ctx.hits : [];
  items.forEach((item, i) => {
    const latest = Math.max(first, latestStart({hold: holds[i], draw: plan.draw, lag: LAG, lastEvent: b.lastEvent, readEnd}));
    let rel;
    if (item.at !== undefined) rel = b.timeOf(`line-${i}`, item.at, `params.lines[${i}].at`, null, {min: first, max: latest}) - b.start;
    else {
      const hit = hits.find(entry => entry && entry.event === `line-${i}` && typeof entry.at === 'number');
      rel = hit ? Math.min(latest, Math.max(first, hit.at - b.start)) : plan.starts[i];
    }
    item.time = rt(b.start + rel);
    item.duration = plan.draw;
    if (item.label) { item.label.time = rt(item.time + plan.draw * LAG); item.label.hold = holds[i]; }
    b.events.push({id: `${b.id}-line-${i}`, name: `line-${i}`, time: item.time, endTime: rt(item.time + plan.draw), role: 'emphasis', cue: 'tick'});
  });
  b.events.push({id: `${b.id}-build`, name: 'build', time: buildAt, endTime: rt(buildAt + 0.4), role: 'emphasis', cue: 'whoosh-soft'});
  vertices.forEach(v => { v.time = rt(Math.min(...v.lines.map(i => items[i].time + items[i].duration))); });
  const live = marks.filter(mark => !mark.dropped);
  live.forEach(mark => {
    const line = mark.line === null ? null : items[mark.line];
    mark.time = line ? rt(line.time + line.duration * LAG) : buildAt;
    mark.hold = labelHold(mark.text);
  });

  const content = {variant: b.variant, plate: {fill: plate, border: hex2(lineColor, 0.32), radius: u(32), grid: b.variant === 'blueprint' ? gridPath(fit, inner, u) : null, gridColor: hex2(lineColor, 0.1)},
    title: titleFit ? {text: title, size: titleFit.size, lines: titleFit.lines, x: pad, y: pad} : null,
    note: noteFit ? {text: note, size: noteFit.size, lines: noteFit.lines, x: pad, y: r2(H - pad - noteH)} : null,
    inner, area: {x: r2(area.x), y: r2(area.y), width: r2(area.width), height: r2(area.height)},
    drawing: {x: r2(fit.ox + box.x * fit.s), y: r2(fit.oy + box.y * fit.s), width: r2(box.width * fit.s), height: r2(box.height * fit.s)},
    lines: items.map(({curve, ...item}) => item), marks: live, vertices, labelSize, pillH, labelPad: {x: labelPadX, y: labelPadY}, dropped,
    lineColor, accentColor, ink: b.theme.foreground, muted: b.theme.muted, labelFill: b.colors.bg, buildAt, buildEnd: rt(Math.max(...items.map(item => item.time + item.duration)))};
  return b.finish(content, {minTextPx: Math.min(labelSize, titleFit ? titleFit.size : Infinity)});
}

/** A leader from just off the stroke at `anchor` to the nearest edge of the label box. */
function leaderPath(anchor, box, offset) {
  const end = nearestOnRect(anchor, box);
  const dx = end[0] - anchor[0], dy = end[1] - anchor[1], len = Math.hypot(dx, dy) || 1;
  const start = [anchor[0] + dx / len * offset, anchor[1] + dy / len * offset];
  return `M${r2(start[0])} ${r2(start[1])} L${r2(end[0])} ${r2(end[1])}`;
}

/** Drafting grid lines in the plate's content area, on the drawing's own unit grid (40–110 px apart). */
function gridPath(fit, inner, u) {
  let step = fit.s;
  while (step < u(40)) step *= 2;
  while (step > u(110)) step /= 2;
  const x0 = fit.ox + Math.ceil((inner.x - fit.ox) / step) * step, y0 = fit.oy + Math.ceil((inner.y - fit.oy) / step) * step;
  const parts = [];
  for (let x = x0; x <= inner.x + inner.width + 1e-6; x += step) parts.push(`M${r2(x)} ${r2(inner.y)} L${r2(x)} ${r2(inner.y + inner.height)}`);
  for (let y = y0; y <= inner.y + inner.height + 1e-6; y += step) parts.push(`M${r2(inner.x)} ${r2(y)} L${r2(inner.x + inner.width)} ${r2(y)}`);
  return parts.join(' ');
}

function pill(id, box, text, color, c, fonts, u) {
  return el('div', id, {...abs(box.x, box.y, box.width, box.height), boxSizing: 'border-box', borderRadius: 999, background: c.labelFill, border: `${r2(3 * u)}px solid ${color}`,
    boxShadow: `0 ${r2(4 * u)}px ${r2(14 * u)}px ${hex2('#000000', 0.28)}`, opacity: 0}, [
    label(null, 0, r2((box.height - 3 * u * 2 - c.labelSize * 1.2) / 2), r2(box.width - 6 * u), text, {size: c.labelSize, family: fonts.body, color: c.ink, align: 'center', weight: 700, lineHeight: 1.2})
  ]);
}

function lineDiagramView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const W = model.rect.width, H = model.rect.height;
  const kids = [el('div', `${id}-plate`, {...abs(0, 0, W, H), boxSizing: 'border-box', borderRadius: c.plate.radius, background: c.plate.fill, border: `${r2(2 * u)}px solid ${c.plate.border}`}, [])];
  if (c.plate.grid) kids.push(el('div', `${id}-grid`, abs(0, 0, W, H), [svgRoot(W, H, [el('path', null, null, [], {d: c.plate.grid, stroke: c.plate.gridColor, strokeWidth: r2(1.5 * u), fill: 'none'})])]));
  if (c.title) kids.push(label(`${id}-title`, c.title.x, c.title.y, r2(W - 2 * c.title.x), c.title.text, {size: c.title.size, family: fonts.body, color: c.ink, weight: 700, lineHeight: 1.15, wrap: c.title.lines > 1}));
  if (c.note) kids.push(label(`${id}-note`, c.note.x, c.note.y, r2(W - 2 * c.note.x), c.note.text, {size: c.note.size, family: fonts.meta, color: c.muted, lineHeight: 1.3, spacing: '0.02em', wrap: c.note.lines > 1}));
  c.lines.forEach((line, i) => {
    if (line.style === 'dashed') kids.push(el('div', null, abs(0, 0, W, H), [dashedPath(`${id}-line-${i}`, W, H, line.d, line.color, line.width, {dash: r2(line.width * 2.8), gap: r2(line.width * 1.9)})]));
    else kids.push(el('div', null, abs(0, 0, W, H), [svgRoot(W, H, [strokePath(`${id}-line-${i}`, line.d, line.color, line.width)])]));
  });
  c.vertices.forEach(v => {
    const d = r2(v.r * 2);
    kids.push(el('div', `${id}-v-${v.name}`, abs(r2(v.x - v.r), r2(v.y - v.r), d, d, {borderRadius: '50%', background: v.color, boxShadow: `0 0 0 ${r2(5 * u)}px ${c.plate.fill}`, opacity: 0})));
  });
  const leaders = [...c.lines.filter(line => line.label?.leader).map(line => ({key: `l${line.index}`, d: line.label.leader, color: line.color})), ...c.marks.filter(mark => mark.leader).map(mark => ({key: `m${mark.index}`, d: mark.leader, color: mark.color}))];
  for (const leader of leaders) kids.push(el('div', null, abs(0, 0, W, H), [svgRoot(W, H, [strokePath(`${id}-leader-${leader.key}`, leader.d, leader.color, r2(4 * u))])]));
  c.lines.forEach((line, i) => { if (line.label) kids.push(pill(`${id}-label-${i}`, line.label.box, line.text, line.color, c, fonts, u)); });
  c.marks.forEach(mark => kids.push(pill(`${id}-mark-${mark.index}`, mark.box, mark.text, mark.color, c, fonts, u)));
  return kids;
}

function lineDiagramTimeline(model, ops) {
  const {id, start, motion, unit: u} = model;
  const c = model.content;
  if (c.title) riseOps(ops, `${id}-title`, start, rt(motion.enterStart + 0.08), r2(16 * u));
  // The note lands with the drawing, so it is read with it rather than after it.
  if (c.note) {
    set(ops, `${id}-note`, start, {opacity: 0});
    tw(ops, `${id}-note`, c.buildAt, 0.4, 'power1.out', {opacity: 0}, {opacity: 1});
  }
  c.lines.forEach((line, i) => {
    if (line.style === 'dashed') drawMaskOps(ops, `${id}-line-${i}`, start, line.time, line.duration, 'power1.inOut');
    else drawOps(ops, `${id}-line-${i}`, start, line.time, line.duration, 'power1.inOut');
    if (line.label) {
      if (line.label.leader) drawOps(ops, `${id}-leader-l${i}`, start, rt(line.label.time - 0.15), 0.25, 'power2.out');
      popOps(ops, `${id}-label-${i}`, start, line.label.time, {from: 0.85, duration: 0.3, ease: 'back.out(2)'});
    }
  });
  c.vertices.forEach(v => popOps(ops, `${id}-v-${v.name}`, start, v.time, {from: 0.2, duration: 0.3, ease: 'back.out(2.6)'}));
  c.marks.forEach(mark => {
    if (mark.leader) drawOps(ops, `${id}-leader-m${mark.index}`, start, rt(Math.max(start, mark.time - 0.15)), 0.25, 'power2.out');
    popOps(ops, `${id}-mark-${mark.index}`, start, mark.time, {from: 0.85, duration: 0.3, ease: 'back.out(2)'});
  });
}

export const lineDiagram = {
  id: 'line-diagram',
  describe: 'A labelled line sketch on a drafting plate that draws itself stroke by stroke: how something is laid out, built or fits together (a deck squared with string lines and diagonals, a beam on a post on a footing, a floor plan, a wiring run). The drawing is scaled to fill the plate; solid strokes in the brand colour, dashed ones (string lines, planned or hidden parts) in the accent; labels sit in pills clear of the lines and stay up long enough to read; the note shows with the drawing.',
  params: {points: '{name: [x, y]} 2–16, any units 0–100, y down; draw in the frame\'s shape (taller than wide for 9:16), the sketch is scaled to fill the plate',
    lines: `[{from, to (point names), style? (${STYLES.join(' | ')}; default solid), weight? (${WEIGHTS.join(' | ')}: heavy for posts, beams, walls), accent? (true: the accent colour), bend? −1–1, label? ≤ 24, at?}] 1–16, drawn in order (events line-<i>)`,
    marks: '[{point, label ≤ 24}] 0–8: a label on a point ("footing", "new post"), shown when the first line reaches it',
    title: 'string ≤ 60 (optional)', note: 'string ≤ 80, a footnote shown with the drawing ("Illustrative layout, not to scale") (optional)',
    tone: 'line colour: primary (default) | accent | paper | #rrggbb', accent: 'dashed and accent lines: accent (default) | primary | paper | #rrggbb', at: `build start: ${AT}`, variant: VARIANT_PARAM, rect: RECT},
  events: ['build', 'line-<i>'],
  timing: timingRules({rules: ['strokes draw in 0.6 s, 0.5 s apart from at; both compress so every label stays up 1 s plus 0.3 s a word before the exit, and a label the scene still has no time for is dropped (keep labels few and short, or lengthen the scene)', 'an explicit line at must leave its label that read']}),
  variants: VARIANTS,
  resolve: resolveLineDiagram, view: lineDiagramView, timeline: lineDiagramTimeline
};

export const DIAGRAMS = [lineDiagram];
