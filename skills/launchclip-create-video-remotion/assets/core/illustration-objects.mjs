// Editorial objects for the illustration module (kit/core/illustration.mjs):
// subjects drawn in detail, flat-editorial (magazine illustration, not app
// icons, not a 3D render): an ink outline in the style's line weight, a
// thickness edge, and a hard offset shadow on the plate. Each object also
// carries the parts its changes act on, so a change happens on the object
// itself: a deck's boards split along the grain and take a dent, a calendar's
// own days are crossed off, a clock's hand sweeps a wedge across its face.
//
//   objectGeometry(name, box, opts) → the object's parts in rect px (pure, so
//     the view and the timeline agree): deck {boards}, calendar {cells},
//     clock {cx, cy, r}
//   objectNodes(name, geo, look, pid, {worn}) → view nodes; ids are `${pid}-…`
//
// Colours come from the style (look.colors) and a wood hue nudged toward the
// brand primary; everything is static SVG plus id'd parts the timeline moves.

import {hashString, seededRandom} from './ambient.mjs';
import {mixColor, r2} from './catalog-h-base.mjs';
import {abs, el} from './catalog-h-view.mjs';
import {svgRoot} from './catalog-b-view.mjs';

export const EDITORIAL_OBJECTS = Object.freeze(['deck', 'calendar', 'clock']);
// Width over height of each object's box.
export const OBJECT_ASPECT = Object.freeze({deck: 1.18, calendar: 0.84, clock: 1});
const lerp = (a, b, t) => a + (b - a) * t;
const pts = list => list.map(([x, y]) => `${r2(x)} ${r2(y)}`).join(' L');

/** The palette an object is drawn in: ink outline, paper, wood, the brand's primary and accent. */
export function objectLook(colors, u) {
  const ink = mixColor('#000000', colors.bg, 0.55);
  return {u, ink, line: r2(5 * u), paper: mixColor(colors.paper, '#ffffff', 0.85), primary: colors.primary, accent: colors.accent,
    wood: mixColor('#b07a4a', colors.primary, 0.85), shadow: 'rgba(0, 0, 0, 0.32)', shadowAt: {x: r2(16 * u), y: r2(22 * u)}};
}

// ---------------------------------------------------------------------------
// Deck: a patch of boards seen at a slight angle, front ends showing end grain.

function deckGeometry(box) {
  const {x, y, width: W, height: H} = box;
  const N = 6, back = y + H * 0.06, front = y + H * 0.8, thick = H * 0.08;
  const bl = x + W * 0.16, br = x + W * 0.84, fl = x + W * 0.01, fr = x + W * 0.99;
  const gb = W * 0.008, gf = W * 0.013;
  const bw = (br - bl - gb * (N - 1)) / N, fw = (fr - fl - gf * (N - 1)) / N;
  const boards = Array.from({length: N}, (_, i) => {
    const b0 = bl + i * (bw + gb), f0 = fl + i * (fw + gf);
    return {b0, b1: b0 + bw, f0, f1: f0 + fw, back, front, thick};
  });
  return {boards, outline: [[bl, back], [br, back], [fr, front], [fr, front + thick], [fl, front + thick], [fl, front]]};
}

// A point on board b at fraction f across it and t from back (0) to front (1).
const onBoard = (b, f, t) => [lerp(lerp(b.b0, b.b1, f), lerp(b.f0, b.f1, f), t), lerp(b.back, b.front, t)];

/** Splits along the grain on a few boards (draw-on paths), seeded. */
export function deckSplits(geo, seed) {
  const rand = seededRandom(hashString(`splits|${seed}`));
  return [1, 3, 4, 0].map(i => {
    const b = geo.boards[i], f = 0.3 + rand() * 0.4, t0 = 0.35 + rand() * 0.3, len = 0.22 + rand() * 0.2;
    const line = [];
    for (let k = 0; k <= 6; k++) line.push(onBoard(b, f + Math.sin(k * 1.7 + i) * 0.04, Math.min(0.99, t0 + len * k / 6)));
    return `M${pts(line)}`;
  });
}

/** The dent a foot presses: a heel-and-sole print on the board nearest the middle. */
export function deckDent(geo) {
  const b = geo.boards[2], c = onBoard(b, 0.55, 0.62), w = (b.f1 - b.f0) * 0.5;
  return {cx: c[0], cy: c[1], w, h: w * 1.9};
}

function deckNodes(geo, look, pid, rand, {worn}) {
  const {u, ink, line} = look;
  const nodes = [];
  const shadow = geo.outline.map(([x, y]) => [x + look.shadowAt.x * 1.6, y + look.shadowAt.y * 1.6]);
  nodes.push(el('path', null, null, [], {d: `M${pts(shadow)} Z`, fill: look.shadow}));
  // The joists' dark under the gaps.
  nodes.push(el('path', null, null, [], {d: `M${pts(geo.outline)} Z`, fill: mixColor('#000000', look.wood, 0.62)}));
  geo.boards.forEach((b, i) => {
    // mixColor(a, b, k) is k of a over b: each board is the wood a few percent lighter or darker.
    const tone = mixColor(rand() < 0.5 ? '#ffffff' : '#000000', look.wood, 0.03 + rand() * 0.09);
    const top = [[b.b0, b.back], [b.b1, b.back], [b.f1, b.front], [b.f0, b.front]];
    nodes.push(el('path', null, null, [], {d: `M${pts(top)} Z`, fill: tone, stroke: ink, strokeWidth: r2(line * 0.6), strokeLinejoin: 'round'}));
    // Grain: long wavy lines running back to front, and one cathedral arch.
    for (let g = 0; g < 4; g++) {
      const f = 0.14 + g * 0.24 + (rand() - 0.5) * 0.06, ph = rand() * 6, amp = 0.025 + rand() * 0.02;
      const run = Array.from({length: 11}, (_, k) => onBoard(b, f + Math.sin(k * 0.8 + ph) * amp, k / 10));
      nodes.push(el('path', null, null, [], {d: `M${pts(run)}`, stroke: mixColor('#000000', tone, 0.45), strokeWidth: r2(2.2 * u), strokeOpacity: 0.55, fill: 'none', strokeLinecap: 'round'}));
    }
    const ct = 0.25 + rand() * 0.4;
    for (let k = 0; k < 3; k++) {
      const s = 0.12 + k * 0.08, a = onBoard(b, 0.5 - s, ct + 0.08 + k * 0.05), m = onBoard(b, 0.5, ct - 0.02 + k * 0.03), z = onBoard(b, 0.5 + s, ct + 0.08 + k * 0.05);
      nodes.push(el('path', null, null, [], {d: `M${r2(a[0])} ${r2(a[1])} Q${r2(m[0])} ${r2(m[1] - (b.front - b.back) * 0.08)} ${r2(z[0])} ${r2(z[1])}`, stroke: mixColor('#000000', tone, 0.5), strokeWidth: r2(2 * u), strokeOpacity: 0.5, fill: 'none'}));
    }
    if (i % 2 === 0) {
      const k = onBoard(b, 0.3 + rand() * 0.4, 0.15 + rand() * 0.25), rx = (b.f1 - b.f0) * 0.09;
      nodes.push(el('ellipse', null, null, [], {cx: r2(k[0]), cy: r2(k[1]), rx: r2(rx), ry: r2(rx * 0.7), fill: mixColor('#000000', tone, 0.4), stroke: mixColor('#000000', tone, 0.55), strokeWidth: r2(1.6 * u)}));
    }
    // End grain: the board's front face, darker, with growth rings.
    const end = [[b.f0, b.front], [b.f1, b.front], [b.f1, b.front + b.thick], [b.f0, b.front + b.thick]];
    const face = mixColor('#000000', tone, 0.28);
    nodes.push(el('path', null, null, [], {d: `M${pts(end)} Z`, fill: face, stroke: ink, strokeWidth: r2(line * 0.6), strokeLinejoin: 'round'}));
    const mid = (b.f0 + b.f1) / 2, w = b.f1 - b.f0;
    for (let k = 1; k <= 3; k++) {
      const s = w * (0.12 + k * 0.11), lift = b.thick * (0.15 + k * 0.18);
      nodes.push(el('path', null, null, [], {d: `M${r2(mid - s)} ${r2(b.front + b.thick)} Q${r2(mid)} ${r2(b.front + b.thick - lift * 2)} ${r2(mid + s)} ${r2(b.front + b.thick)}`, stroke: mixColor('#000000', face, 0.4), strokeWidth: r2(1.8 * u), fill: 'none'}));
    }
    // Nail pairs where the boards cross a joist.
    for (const t of [0.22, 0.7]) for (const f of [0.28, 0.72]) {
      const n = onBoard(b, f, t);
      nodes.push(el('circle', null, null, [], {cx: r2(n[0]), cy: r2(n[1]), r: r2(lerp(3, 4.5, t) * u), fill: mixColor('#000000', tone, 0.35)}));
    }
  });
  return nodes;
}

// ---------------------------------------------------------------------------
// Calendar: a wall calendar with a binding, a header band, a stack of pages and a day grid.

function calendarGeometry(box, {days = 28} = {}) {
  const {x, y, width: W, height: H} = box;
  const rows = Math.max(4, Math.ceil(days / 7));
  const body = {x: x + W * 0.02, y: y + H * 0.06, width: W * 0.92, height: H * 0.86};
  const head = {x: body.x, y: body.y, width: body.width, height: body.height * 0.22};
  const pad = body.width * 0.06, gy = head.y + head.height + body.height * 0.08, gh = body.y + body.height - pad - gy;
  const gap = body.width * 0.018, cw = (body.width - pad * 2 - gap * 6) / 7, ch = (gh - gap * (rows - 1)) / rows;
  const cells = Array.from({length: rows * 7}, (_, i) => ({x: body.x + pad + (i % 7) * (cw + gap), y: gy + Math.floor(i / 7) * (ch + gap), width: cw, height: ch}));
  return {body, head, cells, rows, weekdays: {y: head.y + head.height + body.height * 0.03, x: body.x + pad, cw, gap}};
}

/** The cross that strikes off one day (a single path, two strokes). */
export const dayCross = cell => {
  const i = Math.min(cell.width, cell.height) * 0.2;
  return `M${r2(cell.x + i)} ${r2(cell.y + i)} L${r2(cell.x + cell.width - i)} ${r2(cell.y + cell.height - i)} M${r2(cell.x + cell.width - i)} ${r2(cell.y + i)} L${r2(cell.x + i)} ${r2(cell.y + cell.height - i)}`;
};

function calendarNodes(geo, look, pid, rand, {worn, days = 0}) {
  const {u, ink, line} = look;
  const {body, head} = geo;
  const R = r2(body.width * 0.04);
  const rect = (b, fill, extra = {}) => el('rect', null, null, [], {x: r2(b.x), y: r2(b.y), width: r2(b.width), height: r2(b.height), rx: R, fill, ...extra});
  const nodes = [rect({...body, x: body.x + look.shadowAt.x, y: body.y + look.shadowAt.y}, look.shadow)];
  // The page stack under the sheet: two edges, offset down and right.
  for (const k of [2, 1]) nodes.push(rect({...body, x: body.x + k * 5 * u, y: body.y + k * 7 * u}, mixColor('#000000', look.paper, 0.08 + k * 0.06), {stroke: ink, strokeWidth: r2(line * 0.6)}));
  nodes.push(rect(body, look.paper, {stroke: ink, strokeWidth: line}));
  nodes.push(el('path', null, null, [], {d: `M${r2(head.x)} ${r2(head.y + head.height)} V${r2(head.y + R)} Q${r2(head.x)} ${r2(head.y)} ${r2(head.x + R)} ${r2(head.y)} H${r2(head.x + head.width - R)} Q${r2(head.x + head.width)} ${r2(head.y)} ${r2(head.x + head.width)} ${r2(head.y + R)} V${r2(head.y + head.height)} Z`,
    fill: look.primary, stroke: ink, strokeWidth: line, strokeLinejoin: 'round'}));
  // The binding: holes in the band and wire loops over the top edge.
  for (let k = 0; k < 6; k++) {
    const cx = head.x + head.width * (0.16 + k * 0.136), hy = head.y + head.height * 0.42;
    nodes.push(el('circle', null, null, [], {cx: r2(cx), cy: r2(hy), r: r2(7 * u), fill: mixColor('#000000', look.primary, 0.6)}));
    nodes.push(el('path', null, null, [], {d: `M${r2(cx)} ${r2(hy)} V${r2(head.y - 16 * u)} a${r2(9 * u)} ${r2(9 * u)} 0 0 1 ${r2(18 * u)} 0 V${r2(hy - 4 * u)}`, stroke: ink, strokeWidth: r2(line * 0.9), fill: 'none', strokeLinecap: 'round'}));
  }
  // Weekday marks: short bars, the weekend's in the accent.
  const wd = geo.weekdays;
  for (let k = 0; k < 7; k++) nodes.push(el('rect', null, null, [], {x: r2(wd.x + k * (wd.cw + wd.gap) + wd.cw * 0.2), y: r2(wd.y), width: r2(wd.cw * 0.6), height: r2(6 * u), rx: r2(3 * u), fill: k >= 5 ? look.accent : mixColor(ink, look.paper, 0.45)}));
  geo.cells.forEach((cell, i) => {
    nodes.push(el('rect', null, null, [], {x: r2(cell.x), y: r2(cell.y), width: r2(cell.width), height: r2(cell.height), rx: r2(cell.width * 0.12), fill: mixColor(ink, look.paper, 0.08)}));
    if (i < days) {
      nodes.push(el('rect', `${pid}-day-${i}`, {opacity: 0}, [], {x: r2(cell.x), y: r2(cell.y), width: r2(cell.width), height: r2(cell.height), rx: r2(cell.width * 0.12), fill: look.accent}));
      nodes.push(el('path', `${pid}-cross-${i}`, {strokeDasharray: 1, strokeDashoffset: 1}, [], {d: dayCross(cell), stroke: ink, strokeWidth: r2(line * 0.9), strokeLinecap: 'round', fill: 'none', pathLength: 1}));
    }
  });
  return nodes;
}

// ---------------------------------------------------------------------------
// Clock: a wall clock with a rim that has depth, ticks, hands and a cap.

function clockGeometry(box) {
  const r = Math.min(box.width, box.height) * 0.46;
  return {cx: box.x + box.width / 2, cy: box.y + box.height / 2, r, face: r * 0.84};
}

/** The wedge an elapsed fraction sweeps from twelve o'clock: a stroked circle, drawn on. */
export const clockSweep = geo => {
  const q = geo.face * 0.45;
  return {d: `M${r2(geo.cx)} ${r2(geo.cy - q)} A${r2(q)} ${r2(q)} 0 1 1 ${r2(geo.cx)} ${r2(geo.cy + q)} A${r2(q)} ${r2(q)} 0 1 1 ${r2(geo.cx)} ${r2(geo.cy - q)}`, width: r2(q * 2)};
};

function clockNodes(geo, look, pid, rand, {worn, sweep = false}) {
  const {u, ink, line} = look;
  const {cx, cy, r, face} = geo;
  const circle = (dx, dy, rr, fill, extra = {}) => el('circle', null, null, [], {cx: r2(cx + dx), cy: r2(cy + dy), r: r2(rr), fill, ...extra});
  const rim = mixColor('#000000', look.primary, 0.42);
  const nodes = [circle(look.shadowAt.x * 1.3, look.shadowAt.y * 1.3, r, look.shadow),
    // The rim's depth: its edge seen below and right.
    circle(7 * u, 10 * u, r, mixColor('#000000', rim, 0.6), {stroke: ink, strokeWidth: line}),
    circle(0, 0, r, rim, {stroke: ink, strokeWidth: line}),
    circle(0, 0, r * 0.93, mixColor('#ffffff', rim, 0.22)),
    circle(0, 0, face, look.paper, {stroke: ink, strokeWidth: r2(line * 0.8)})];
  if (sweep) {
    const s = clockSweep(geo);
    nodes.push(el('path', `${pid}-sweep`, {strokeDasharray: 1, strokeDashoffset: 1}, [], {d: s.d, stroke: look.accent, strokeOpacity: 0.35, strokeWidth: s.width, fill: 'none', pathLength: 1}));
  }
  for (let k = 0; k < 60; k++) {
    const a = k * Math.PI / 30, hour = k % 5 === 0, r0 = face * (hour ? 0.8 : 0.9), r1 = face * 0.96;
    nodes.push(el('path', null, null, [], {d: `M${r2(cx + r0 * Math.sin(a))} ${r2(cy - r0 * Math.cos(a))} L${r2(cx + r1 * Math.sin(a))} ${r2(cy - r1 * Math.cos(a))}`, stroke: ink, strokeWidth: r2(hour ? line * 1.2 : line * 0.4), strokeLinecap: 'round'}));
  }
  // Hands are their own layers, square on the centre, so the timeline turns them.
  const hand = (hid, len, w, angle) => el('div', `${pid}-${hid}`, abs(r2(cx - face), r2(cy - face), r2(face * 2), r2(face * 2), {transformOrigin: '50% 50%', transform: `rotate(${angle}deg)`}), [svgRoot(r2(face * 2), r2(face * 2), [
    el('path', null, null, [], {d: `M${r2(face)} ${r2(face + face * 0.12)} L${r2(face)} ${r2(face - len)}`, stroke: ink, strokeWidth: r2(w), strokeLinecap: 'round'})])]);
  return {nodes, hands: [hand('hour', face * 0.5, line * 2, 300), hand('minute', face * 0.78, line * 1.3, 0)],
    cap: [circle(0, 0, 13 * u, look.accent, {stroke: ink, strokeWidth: r2(line * 0.8)})]};
}

// ---------------------------------------------------------------------------

/** An editorial object's parts in rect px for `box`. opts: {days} for a calendar. */
export function objectGeometry(name, box, opts = {}) {
  if (name === 'deck') return deckGeometry(box);
  if (name === 'calendar') return calendarGeometry(box, opts);
  return clockGeometry(box);
}

/**
 * The object's view nodes, laid in a rect-sized layer: {nodes, over} where
 * `over` sits above everything the change adds (a clock's hands and cap).
 * opts: {worn, days (calendar cells to strike), sweep (clock wedge)}.
 */
export function objectNodes(name, geo, look, pid, rect, seed, opts = {}) {
  const rand = seededRandom(hashString(`${name}|${seed}`));
  const layer = nodes => svgRoot(r2(rect.width), r2(rect.height), nodes);
  if (name === 'deck') return {nodes: [layer(deckNodes(geo, look, pid, rand, opts))], over: []};
  if (name === 'calendar') return {nodes: [layer(calendarNodes(geo, look, pid, rand, opts))], over: []};
  const clock = clockNodes(geo, look, pid, rand, opts);
  return {nodes: [layer(clock.nodes)], over: [...clock.hands, layer(clock.cap)]};
}
