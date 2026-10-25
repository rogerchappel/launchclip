// The icon set (docs/VIDEO_QUALITY_RFC.md §8): one in-repo family of line
// icons, drawn for LaunchClip as original geometry. Every icon is SVG path
// data in a 24-unit box, stroked (never filled) at ICON_STROKE units with
// round caps and joins, and keeps a 2-unit margin so mixed icons sit
// together as one set. Corners of boxes use a 1.5–2 unit radius.
//
// Names are stable kebab-case ids the planner can pick (`icon: "shield"`);
// never rename one, only add. Icons carry no colour: modules tint them from
// the brand (iconNode's `color`), and both renderers draw them through the
// shared view tree as one <path> inside an <svg>.
//
// Contract: docs/KIT_CONTRACTS.md ("Icon set"). Contact sheet:
// `node scripts/icon-sheet.mjs out.png`.

import {el} from './catalog-b-view.mjs';

export const ICON_BOX = 24;
export const ICON_STROKE = 2;

// ---------------------------------------------------------------------------
// Path helpers (box units). Angles are degrees, clockwise on screen from +x.

const n = value => String(Math.round(value * 100) / 100);
const P = ([x, y]) => `${n(x)} ${n(y)}`;
const pt = (cx, cy, r, deg) => [cx + r * Math.cos(deg * Math.PI / 180), cy + r * Math.sin(deg * Math.PI / 180)];

/** Open polyline. */
const pl = points => `M${points.map(P).join(' L')}`;
/** Closed polygon. */
const pg = points => `${pl(points)} Z`;
const ln = (x1, y1, x2, y2) => `M${n(x1)} ${n(y1)} L${n(x2)} ${n(y2)}`;
/** A round dot: a zero-length stroke with a round cap. */
const dot = (x, y) => `M${n(x)} ${n(y)} h.01`;
const circle = (cx, cy, r) => `M${n(cx - r)} ${n(cy)} a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0 a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0`;
/** Rounded rectangle. */
const rr = (x, y, w, h, r) => `M${n(x + r)} ${n(y)} H${n(x + w - r)} a${n(r)} ${n(r)} 0 0 1 ${n(r)} ${n(r)} V${n(y + h - r)} a${n(r)} ${n(r)} 0 0 1 ${n(-r)} ${n(r)} H${n(x + r)} a${n(r)} ${n(r)} 0 0 1 ${n(-r)} ${n(-r)} V${n(y + r)} a${n(r)} ${n(r)} 0 0 1 ${n(r)} ${n(-r)} Z`;
/** Circular arc, clockwise from a0 to a1 (a1 > a0, may pass 360). */
const arc = (cx, cy, r, a0, a1) => `M${P(pt(cx, cy, r, a0))} A${n(r)} ${n(r)} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${P(pt(cx, cy, r, a1))}`;
/** An arrowhead with its tip at (x, y), pointing along `deg`. */
const head = (x, y, deg, len = 4, spread = 42) => `M${P(pt(x, y, len, deg + 180 - spread))} L${n(x)} ${n(y)} L${P(pt(x, y, len, deg + 180 + spread))}`;
/** Ellipse turned by `rot` degrees about its centre. */
const ellipse = (cx, cy, rx, ry, rot = 0) => {
  const a = pt(cx, cy, rx, rot), b = pt(cx, cy, rx, rot + 180);
  return `M${P(a)} A${n(rx)} ${n(ry)} ${n(rot)} 1 1 ${P(b)} A${n(rx)} ${n(ry)} ${n(rot)} 1 1 ${P(a)}`;
};
/** Regular star (points ≥ 4). */
const star = (cx, cy, outer, inner, points = 5, turn = -90) => pg(Array.from({length: points * 2}, (_, i) => pt(cx, cy, i % 2 ? inner : outer, turn + i * 180 / points)));
const join = (...parts) => parts.join(' ');

// Shared bodies reused by several icons.
const SHIELD = 'M12 3 L19 6 V11 C19 15.5 16 19 12 21 C8 19 5 15.5 5 11 V6 Z';
const CLOUD = 'M7.5 18.5 H17 A4 4 0 0 0 17.6 10.55 A6 6 0 0 0 6.1 10.9 A3.8 3.8 0 0 0 7.5 18.5 Z';
const FILE = 'M14 3 H7 a1.5 1.5 0 0 0 -1.5 1.5 V19.5 a1.5 1.5 0 0 0 1.5 1.5 H17 a1.5 1.5 0 0 0 1.5 -1.5 V7.5 Z M14 3 V7.5 H18.5';
const CALENDAR = join(rr(3.5, 5, 17, 16, 2), ln(3.5, 10, 20.5, 10), ln(8, 3, 8, 7), ln(16, 3, 16, 7));
const USER_HEAD = (cx) => join(circle(cx, 8, 4), `M${n(cx - 7.5)} 20.5 C${n(cx - 7)} 16.5 ${n(cx - 4)} 14.5 ${n(cx)} 14.5 C${n(cx + 4)} 14.5 ${n(cx + 7)} 16.5 ${n(cx + 7.5)} 20.5`);
const EYE = 'M2.5 12 C4.5 7.5 8 5.5 12 5.5 C16 5.5 19.5 7.5 21.5 12 C19.5 16.5 16 18.5 12 18.5 C8 18.5 4.5 16.5 2.5 12 Z';
const CHART_AXES = pl([[3, 3], [3, 21], [21, 21]]);

const gear = () => {
  const teeth = 8, outer = 9.3, inner = 7, half = 360 / teeth / 4.4;
  const points = [];
  for (let i = 0; i < teeth; i++) {
    const a = i * 360 / teeth - 90;
    points.push(pt(12, 12, inner, a - half * 1.9), pt(12, 12, outer, a - half), pt(12, 12, outer, a + half), pt(12, 12, inner, a + half * 1.9));
  }
  return join(pg(points), circle(12, 12, 3));
};
const sun = () => join(circle(12, 12, 4), ...Array.from({length: 8}, (_, i) => {
  const a = i * 45 - 90;
  return `M${P(pt(12, 12, 7, a))} L${P(pt(12, 12, 9.5, a))}`;
}));

// ---------------------------------------------------------------------------
// The set, grouped. Order is the contact sheet's order; names never change.

const DRAWN = {
  // Marks and arrows
  check: pl([[5, 12.5], [10, 17.5], [19, 7]]),
  x: join(ln(6, 6, 18, 18), ln(18, 6, 6, 18)),
  plus: join(ln(12, 5, 12, 19), ln(5, 12, 19, 12)),
  minus: ln(5, 12, 19, 12),
  'check-circle': join(circle(12, 12, 9), pl([[8, 12.5], [11, 15.5], [16, 9.5]])),
  'x-circle': join(circle(12, 12, 9), ln(9, 9, 15, 15), ln(15, 9, 9, 15)),
  'plus-circle': join(circle(12, 12, 9), ln(12, 8, 12, 16), ln(8, 12, 16, 12)),
  'arrow-right': join(ln(4, 12, 20, 12), pl([[14, 6], [20, 12], [14, 18]])),
  'arrow-left': join(ln(20, 12, 4, 12), pl([[10, 6], [4, 12], [10, 18]])),
  'arrow-up': join(ln(12, 20, 12, 4), pl([[6, 10], [12, 4], [18, 10]])),
  'arrow-down': join(ln(12, 4, 12, 20), pl([[6, 14], [12, 20], [18, 14]])),
  'arrow-up-right': join(ln(6, 18, 18, 6), pl([[9, 6], [18, 6], [18, 15]])),
  'chevron-right': pl([[9, 5], [16, 12], [9, 19]]),
  'chevron-down': pl([[5, 9], [12, 16], [19, 9]]),
  refresh: join(arc(12, 12, 8, 40, 320), head(...pt(12, 12, 8, 320), 50, 4.5)),
  undo: join(pl([[9, 14], [4, 9], [9, 4]]), 'M4 9 H14.5 a5.5 5.5 0 0 1 0 11 H11'),
  redo: join(pl([[15, 14], [20, 9], [15, 4]]), 'M20 9 H9.5 a5.5 5.5 0 0 0 0 11 H13'),
  'trending-up': join(pl([[3, 17], [9, 11], [13, 15], [21, 7]]), pl([[15, 7], [21, 7], [21, 13]])),
  'trending-down': join(pl([[3, 7], [9, 13], [13, 9], [21, 17]]), pl([[15, 17], [21, 17], [21, 11]])),
  navigation: pg([[3.5, 11], [20.5, 3.5], [13, 20.5], [11, 13]]),
  cursor: pg([[5, 3.5], [19, 11], [12.5, 12.8], [9.5, 19.5]]),
  maximize: join(pl([[14, 3.5], [20.5, 3.5], [20.5, 10]]), pl([[10, 20.5], [3.5, 20.5], [3.5, 14]]), ln(20.5, 3.5, 14, 10), ln(3.5, 20.5, 10, 14)),
  download: join(ln(12, 3.5, 12, 15), pl([[7.5, 10.5], [12, 15], [16.5, 10.5]]), 'M4 15 V18.5 a2 2 0 0 0 2 2 H18 a2 2 0 0 0 2 -2 V15'),
  upload: join(ln(12, 15, 12, 3.5), pl([[7.5, 8], [12, 3.5], [16.5, 8]]), 'M4 15 V18.5 a2 2 0 0 0 2 2 H18 a2 2 0 0 0 2 -2 V15'),

  // Security and engineering
  shield: SHIELD,
  'shield-check': join(SHIELD, pl([[9, 12], [11.2, 14.2], [15, 10]])),
  lock: join(rr(5, 11, 14, 10, 2), 'M8 11 V7.5 a4 4 0 0 1 8 0 V11', ln(12, 15, 12, 17)),
  unlock: join(rr(5, 11, 14, 10, 2), 'M8 11 V7.5 a4 4 0 0 1 7.75 -1.4', ln(12, 15, 12, 17)),
  key: join(circle(7.5, 15.5, 4), ln(10.4, 12.6, 20, 3), ln(16.5, 6.5, 19, 9), ln(14, 9, 16, 11)),
  rocket: join('M12 2.5 C15.5 5 17 8.5 17 12.5 V16 H7 V12.5 C7 8.5 8.5 5 12 2.5 Z', circle(12, 9.5, 2), 'M7 12.5 L4.5 15.5 V19 L7 17.2', 'M17 12.5 L19.5 15.5 V19 L17 17.2', ln(10, 19, 10, 21.5), ln(14, 19, 14, 21.5)),
  code: join(pl([[8, 7], [3, 12], [8, 17]]), pl([[16, 7], [21, 12], [16, 17]]), ln(13.5, 5, 10.5, 19)),
  terminal: join(rr(3, 4, 18, 16, 2), pl([[7, 9], [10, 12], [7, 15]]), ln(12, 15, 17, 15)),
  bolt: pg([[13, 2.5], [5, 13.5], [11.5, 13.5], [10.5, 21.5], [19, 10.5], [12.5, 10.5]]),
  cpu: join(rr(6, 6, 12, 12, 2), rr(9.5, 9.5, 5, 5, 1), ln(9.5, 3, 9.5, 6), ln(14.5, 3, 14.5, 6), ln(9.5, 18, 9.5, 21), ln(14.5, 18, 14.5, 21), ln(3, 9.5, 6, 9.5), ln(3, 14.5, 6, 14.5), ln(18, 9.5, 21, 9.5), ln(18, 14.5, 21, 14.5)),
  database: join(ellipse(12, 6, 7, 3), 'M5 6 V18 a7 3 0 0 0 14 0 V6', 'M5 12 a7 3 0 0 0 14 0'),
  server: join(rr(3, 3.5, 18, 7.5, 2), rr(3, 13, 18, 7.5, 2), dot(7, 7.25), dot(7, 16.75), ln(11, 7.25, 17, 7.25), ln(11, 16.75, 17, 16.75)),
  cloud: CLOUD,
  'cloud-upload': join(CLOUD, ln(12, 17, 12, 11.5), pl([[9.5, 14], [12, 11.5], [14.5, 14]])),
  wifi: join(arc(12, 18.5, 3.5, 225, 315), arc(12, 18.5, 7.5, 225, 315), arc(12, 18.5, 11.5, 228, 312), dot(12, 18.5)),
  link: join('M10 14 a4 4 0 0 0 5.66 0 l3 -3 a4 4 0 0 0 -5.66 -5.66 l-1 1', 'M14 10 a4 4 0 0 0 -5.66 0 l-3 3 a4 4 0 0 0 5.66 5.66 l1 -1'),
  globe: join(circle(12, 12, 9), ln(3, 12, 21, 12), 'M12 3 C14.8 5.8 15.8 9 15.8 12 C15.8 15 14.8 18.2 12 21 C9.2 18.2 8.2 15 8.2 12 C8.2 9 9.2 5.8 12 3 Z'),
  bug: join('M8 10 a4 4 0 0 1 8 0 V15 a4 4 0 0 1 -8 0 Z', ln(12, 10, 12, 19), ln(10, 6.5, 8.5, 4), ln(14, 6.5, 15.5, 4), ln(4, 9, 8, 11), ln(20, 9, 16, 11), ln(3.5, 14, 8, 14), ln(20.5, 14, 16, 14), ln(4, 19, 8, 17), ln(20, 19, 16, 17)),
  'git-branch': join(circle(6, 5.5, 2.3), circle(6, 18.5, 2.3), circle(18, 7.5, 2.3), ln(6, 7.8, 6, 16.2), 'M18 9.8 C18 14 12 13 7.7 16.8'),
  'git-merge': join(circle(6, 5.5, 2.3), circle(6, 18.5, 2.3), circle(18, 15, 2.3), ln(6, 7.8, 6, 16.2), 'M7.3 7.4 C9 11.5 12 15 15.7 15'),
  workflow: join(rr(3, 3.5, 6.5, 6.5, 1.5), rr(14.5, 14, 6.5, 6.5, 1.5), 'M9.5 6.75 H14.75 a3 3 0 0 1 3 3 V14'),
  layers: join(pg([[12, 3], [21, 8], [12, 13], [3, 8]]), pl([[3, 12], [12, 17], [21, 12]]), pl([[3, 16], [12, 21], [21, 16]])),
  box: join(pg([[12, 2.5], [20.5, 7], [20.5, 17], [12, 21.5], [3.5, 17], [3.5, 7]]), pl([[3.5, 7], [12, 11.5], [20.5, 7]]), ln(12, 11.5, 12, 21.5), ln(7.75, 4.75, 16.25, 9.25)),
  plug: join(ln(9, 2.5, 9, 7), ln(15, 2.5, 15, 7), 'M6 7 H18 V11 a6 6 0 0 1 -12 0 Z', ln(12, 17, 12, 21.5)),
  gear: gear(),
  sliders: join(ln(4, 6, 13, 6), circle(15, 6, 2), ln(17, 6, 20, 6), ln(4, 12, 6, 12), circle(8, 12, 2), ln(10, 12, 20, 12), ln(4, 18, 11, 18), circle(13, 18, 2), ln(15, 18, 20, 18)),
  wrench: 'M14.5 3.5 a5 5 0 0 0 -4.6 6.9 L3.6 16.7 a2.3 2.3 0 0 0 3.25 3.25 L13.1 13.6 a5 5 0 0 0 6.9 -4.6 L17 12 L13.9 11.1 L12.9 8 Z',
  robot: join(rr(4.5, 8, 15, 11.5, 3), ln(12, 5, 12, 8), circle(12, 4, 1), dot(9, 13), dot(15, 13), ln(10, 16.5, 14, 16.5), ln(2.5, 12, 2.5, 15.5), ln(21.5, 12, 21.5, 15.5)),
  atom: join(ellipse(12, 12, 9.5, 3.6, 0), ellipse(12, 12, 9.5, 3.6, 60), ellipse(12, 12, 9.5, 3.6, 120), dot(12, 12)),
  flask: join('M9.5 3 V9 L4.5 18.5 a1.7 1.7 0 0 0 1.5 2.5 H18 a1.7 1.7 0 0 0 1.5 -2.5 L14.5 9 V3', ln(8, 3, 16, 3), ln(6.8, 14, 17.2, 14)),
  infinity: 'M12 12 C9.5 8.5 7.8 7.5 6 7.5 a4.5 4.5 0 0 0 0 9 C7.8 16.5 9.5 15.5 12 12 C14.5 8.5 16.2 7.5 18 7.5 a4.5 4.5 0 0 1 0 9 C16.2 16.5 14.5 15.5 12 12 Z',
  activity: pl([[2.5, 12], [6.5, 12], [9.5, 5], [14.5, 19], [17.5, 12], [21.5, 12]]),
  gauge: join(arc(12, 14.5, 8.5, 160, 380), ln(12, 14.5, 15.8, 9.8), dot(12, 14.5)),
  signal: join(ln(5, 19, 5, 16), ln(9.5, 19, 9.5, 12.5), ln(14, 19, 14, 9), ln(18.5, 19, 18.5, 5)),
  toggle: join(rr(2.5, 7, 19, 10, 5), circle(16.5, 12, 2.6)),
  power: join(arc(12, 13, 8, 305, 595), ln(12, 2.5, 12, 11)),
  battery: join(rr(2.5, 7, 16.5, 10, 2), ln(21.5, 10.5, 21.5, 13.5), ln(6, 10.5, 6, 13.5), ln(9.5, 10.5, 9.5, 13.5), ln(13, 10.5, 13, 13.5)),
  magnet: join('M5 3.5 H9 V12 a3 3 0 0 0 6 0 V3.5 H19 V12 a7 7 0 0 1 -14 0 Z', ln(5, 7.5, 9, 7.5), ln(15, 7.5, 19, 7.5)),
  thermometer: join('M10 14.5 V5 a2 2 0 0 1 4 0 V14.5 a4 4 0 1 1 -4 0 Z', ln(12, 9, 12, 16.5)),

  // Business and data
  'chart-up': join(CHART_AXES, pl([[7, 16], [11, 11.5], [14, 14], [20, 7]]), pl([[16, 7], [20, 7], [20, 11]])),
  'chart-down': join(CHART_AXES, pl([[7, 8], [11, 12.5], [14, 10], [20, 17]]), pl([[16, 17], [20, 17], [20, 13]])),
  'chart-bar': join(CHART_AXES, ln(8, 17, 8, 13), ln(13, 17, 13, 7.5), ln(18, 17, 18, 10.5)),
  'chart-pie': join(circle(12, 12, 9), ln(12, 12, 12, 3), ln(12, 12, 19.8, 16.5)),
  target: join(circle(12, 12, 9), circle(12, 12, 5.5), dot(12, 12)),
  trophy: join('M7 4 H17 V10 a5 5 0 0 1 -10 0 Z', 'M7 6 H4.5 V8 a3 3 0 0 0 3 3', 'M17 6 H19.5 V8 a3 3 0 0 1 -3 3', ln(12, 15, 12, 18.5), ln(8, 20.5, 16, 20.5), ln(9.5, 18.5, 14.5, 18.5)),
  medal: join(circle(12, 9, 5.5), pl([[8.5, 13.5], [7, 21], [12, 19], [17, 21], [15.5, 13.5]])),
  crown: join(pg([[3.5, 7.5], [8, 12], [12, 5], [16, 12], [20.5, 7.5], [19, 17.5], [5, 17.5]]), ln(5, 20.5, 19, 20.5)),
  diamond: join(pg([[6.5, 4], [17.5, 4], [21, 9], [12, 20.5], [3, 9]]), ln(3, 9, 21, 9), pl([[9.5, 4], [8.5, 9], [12, 20.5], [15.5, 9], [14.5, 4]])),
  dollar: join(ln(12, 2.5, 12, 21.5), 'M16.5 7 C16 5.5 14.5 5 12 5 C9 5 7.5 6.3 7.5 8.3 C7.5 10.5 9.5 11.2 12 11.8 C14.8 12.4 16.5 13.3 16.5 15.6 C16.5 17.8 14.8 19 12 19 C9.2 19 7.8 18.2 7.2 16.5'),
  percent: join(ln(19, 5, 5, 19), circle(7, 7, 2.5), circle(17, 17, 2.5)),
  'credit-card': join(rr(2.5, 5, 19, 14, 2), ln(2.5, 9.5, 21.5, 9.5), ln(6, 15, 10, 15)),
  wallet: join(rr(3, 6, 18, 14, 2.5), 'M3 8.5 V7 a3 3 0 0 1 3 -3 H16.5', 'M21 11 H16.5 a2 2 0 0 0 0 4 H21'),
  bank: join(pg([[3, 9], [12, 3.5], [21, 9]]), ln(6, 12, 6, 17.5), ln(10, 12, 10, 17.5), ln(14, 12, 14, 17.5), ln(18, 12, 18, 17.5), ln(3, 20.5, 21, 20.5)),
  briefcase: join(rr(3, 7, 18, 13, 2), 'M9 7 V5 a1.5 1.5 0 0 1 1.5 -1.5 h3 a1.5 1.5 0 0 1 1.5 1.5 V7', ln(3, 12.5, 21, 12.5)),
  building: join('M5 21 V4.5 a1.5 1.5 0 0 1 1.5 -1.5 h11 a1.5 1.5 0 0 1 1.5 1.5 V21', ln(3, 21, 21, 21), dot(9, 7), dot(15, 7), dot(9, 11), dot(15, 11), dot(9, 15), dot(15, 15), 'M10.5 21 v-3 h3 v3'),
  store: join('M4 9 L5.5 4 H18.5 L20 9', 'M4 9 a2.67 2.67 0 0 0 5.33 0 a2.67 2.67 0 0 0 5.33 0 a2.67 2.67 0 0 0 5.33 0', 'M5.5 11.5 V20 H18.5 V11.5', 'M10 20 v-4.5 h4 V20'),
  tag: join(pg([[3.5, 3.5], [11, 3.5], [20.5, 13], [13, 20.5], [3.5, 11]]), circle(7.75, 7.75, 1.25)),
  receipt: join(pl([[6, 21.5], [6, 2.5], [18, 2.5], [18, 21.5], [16, 20], [14, 21.5], [12, 20], [10, 21.5], [8, 20], [6, 21.5]]), ln(9, 7, 15, 7), ln(9, 11, 15, 11), ln(9, 15, 13, 15)),
  cart: join(pl([[2.5, 3.5], [5, 3.5], [7.5, 15], [18, 15], [20.5, 7], [6, 7]]), circle(9, 19, 1.5), circle(17, 19, 1.5)),
  'shopping-bag': join('M5.5 8 H18.5 L19.5 20 a1.5 1.5 0 0 1 -1.5 1.5 H6 a1.5 1.5 0 0 1 -1.5 -1.5 Z', 'M9 10 V6.5 a3 3 0 0 1 6 0 V10'),
  gift: join(rr(3.5, 8, 17, 4, 1), 'M5 12 V20 a1 1 0 0 0 1 1 H18 a1 1 0 0 0 1 -1 V12', ln(12, 8, 12, 21), 'M12 8 C10 8 7.5 7 7.5 5.2 C7.5 3.9 8.5 3 9.6 3 C11.3 3 12 5.5 12 8 C12 5.5 12.7 3 14.4 3 C15.5 3 16.5 3.9 16.5 5.2 C16.5 7 14 8 12 8'),
  hashtag: join(ln(9.5, 3.5, 7.5, 20.5), ln(16.5, 3.5, 14.5, 20.5), ln(4, 9, 20.5, 9), ln(3.5, 15, 20, 15)),

  // People and feelings
  user: USER_HEAD(12),
  users: join(circle(9, 8, 3.5), 'M2.5 20 C3 16.5 5.5 14.5 9 14.5 C12.5 14.5 15 16.5 15.5 20', 'M15 4.8 a3.5 3.5 0 0 1 0 6.4', 'M18 14.8 C20 15.6 21.3 17.5 21.5 20'),
  'user-plus': join(circle(10, 8, 4), 'M2.5 20.5 C3 16.5 6 14.5 10 14.5 C12.5 14.5 14.6 15.3 16 16.8', ln(19, 8, 19, 14), ln(16, 11, 22, 11)),
  'user-check': join(circle(10, 8, 4), 'M2.5 20.5 C3 16.5 6 14.5 10 14.5 C12.5 14.5 14.6 15.3 16 16.8', pl([[15.5, 11], [17.5, 13], [21.5, 9]])),
  heart: 'M12 20 C12 20 3.5 15 3.5 9.2 C3.5 6.3 5.7 4 8.4 4 C10 4 11.3 4.9 12 6.2 C12.7 4.9 14 4 15.6 4 C18.3 4 20.5 6.3 20.5 9.2 C20.5 15 12 20 12 20 Z',
  smile: join(circle(12, 12, 9), 'M8.5 14.5 C9.3 15.8 10.6 16.5 12 16.5 C13.4 16.5 14.7 15.8 15.5 14.5', dot(9, 9.5), dot(15, 9.5)),
  'thumbs-up': join('M7.5 10.5 L11 3.5 a2 2 0 0 1 2.5 1.8 V9 H18.5 a2 2 0 0 1 2 2.3 L19.3 18.8 a2 2 0 0 1 -2 1.7 H7.5', rr(3, 10.5, 4.5, 10, 1)),
  'graduation-cap': join(pg([[12, 4], [21.5, 9], [12, 14], [2.5, 9]]), 'M6 11 V16 C8 18 16 18 18 16 V11', ln(21.5, 9, 21.5, 14)),

  // Communication
  mail: join(rr(3, 5, 18, 14, 2), pl([[3.5, 6.5], [12, 13], [20.5, 6.5]])),
  message: 'M5.5 4 H18.5 a1.5 1.5 0 0 1 1.5 1.5 V15 a1.5 1.5 0 0 1 -1.5 1.5 H9 L4 20.5 V5.5 a1.5 1.5 0 0 1 1.5 -1.5 Z',
  messages: join('M4.5 8 H14.5 a1.5 1.5 0 0 1 1.5 1.5 V16 a1.5 1.5 0 0 1 -1.5 1.5 H8 L3 21 V9.5 a1.5 1.5 0 0 1 1.5 -1.5 Z', 'M8 8 V4.5 a1.5 1.5 0 0 1 1.5 -1.5 H19.5 a1.5 1.5 0 0 1 1.5 1.5 V16 L18.5 13.5 H16'),
  quote: join('M4 11.5 H9 V17 H4 Z', 'M4 11.5 C4 8.5 5.5 6.5 8.5 6', 'M14 11.5 H19 V17 H14 Z', 'M14 11.5 C14 8.5 15.5 6.5 18.5 6'),
  phone: 'M5 3.5 H8.5 L10.5 8.5 L8 10 C9 12.5 11.5 15 14 16 L15.5 13.5 L20.5 15.5 V19 a1.5 1.5 0 0 1 -1.5 1.5 C10.5 20.5 3.5 13.5 3.5 5 a1.5 1.5 0 0 1 1.5 -1.5 Z',
  bell: join('M6 16.5 V11 a6 6 0 0 1 12 0 V16.5 L19.5 18 H4.5 Z', 'M10 20.5 C10.4 21.3 11.1 21.7 12 21.7 C12.9 21.7 13.6 21.3 14 20.5'),
  megaphone: join(pg([[3.5, 9.5], [8, 9.5], [17.5, 4.5], [17.5, 19.5], [8, 14.5], [3.5, 14.5]]), 'M8 14.5 L9.5 20 H12 L11 15.8', ln(20.5, 10, 20.5, 14)),
  send: join(pg([[21, 3], [3, 10.5], [10.5, 13.5], [13.5, 21]]), ln(21, 3, 10.5, 13.5)),
  share: join(circle(18, 5.5, 2.5), circle(6, 12, 2.5), circle(18, 18.5, 2.5), ln(8.2, 10.8, 15.8, 6.7), ln(8.2, 13.2, 15.8, 17.3)),
  inbox: join('M3 13.5 L5.5 5 H18.5 L21 13.5 V18.5 a1.5 1.5 0 0 1 -1.5 1.5 H4.5 a1.5 1.5 0 0 1 -1.5 -1.5 Z', 'M3 13.5 H8.5 L10 16 H14 L15.5 13.5 H21'),
  paperclip: 'M20 11 L11.8 19.2 a5 5 0 0 1 -7.1 -7.1 L12.9 3.9 a3.3 3.3 0 0 1 4.7 4.7 L9.5 16.7 a1.6 1.6 0 0 1 -2.3 -2.3 L14.6 7',

  // Time
  calendar: CALENDAR,
  'calendar-check': join(CALENDAR, pl([[8.5, 15.5], [11, 18], [15.5, 13.5]])),
  clock: join(circle(12, 12, 9), pl([[12, 7], [12, 12], [15.5, 14]])),
  hourglass: join(ln(6.5, 3, 17.5, 3), ln(6.5, 21, 17.5, 21), 'M7.5 3 V6.5 C7.5 9 12 10.5 12 12 C12 13.5 7.5 15 7.5 17.5 V21', 'M16.5 3 V6.5 C16.5 9 12 10.5 12 12 C12 13.5 16.5 15 16.5 17.5 V21'),
  timer: join(circle(12, 13.5, 7.5), ln(10, 2.5, 14, 2.5), ln(12, 2.5, 12, 6), ln(12, 13.5, 14.5, 10.5), ln(18.3, 6.7, 19.5, 5.5)),

  // Content and tools
  file: FILE,
  'file-text': join(FILE, ln(9, 12, 15, 12), ln(9, 15.5, 15, 15.5), ln(9, 8.5, 11, 8.5)),
  folder: 'M3 7 a1.5 1.5 0 0 1 1.5 -1.5 H9 L11 7.5 H19.5 a1.5 1.5 0 0 1 1.5 1.5 V18 a1.5 1.5 0 0 1 -1.5 1.5 H4.5 a1.5 1.5 0 0 1 -1.5 -1.5 Z',
  archive: join(rr(3, 4, 18, 4.5, 1), 'M5 8.5 V19 a1.5 1.5 0 0 0 1.5 1.5 H17.5 a1.5 1.5 0 0 0 1.5 -1.5 V8.5', ln(10, 12.5, 14, 12.5)),
  copy: join(rr(8, 8, 12.5, 12.5, 2), 'M16 8 V5 a1.5 1.5 0 0 0 -1.5 -1.5 H5 a1.5 1.5 0 0 0 -1.5 1.5 V14.5 a1.5 1.5 0 0 0 1.5 1.5 H8'),
  trash: join(ln(3.5, 6, 20.5, 6), 'M9 6 V4 a1 1 0 0 1 1 -1 H14 a1 1 0 0 1 1 1 V6', 'M5.5 6 L6.5 19.5 a1.7 1.7 0 0 0 1.7 1.5 H15.8 a1.7 1.7 0 0 0 1.7 -1.5 L18.5 6', ln(10, 10.5, 10, 16.5), ln(14, 10.5, 14, 16.5)),
  image: join(rr(3, 4, 18, 16, 2), circle(8.5, 9.5, 1.8), pl([[3.5, 18], [9.5, 12.5], [13.5, 16], [16, 13.5], [20.5, 17.5]])),
  video: join(rr(2.5, 6, 13, 12, 2), pg([[15.5, 10.5], [21.5, 7], [21.5, 17], [15.5, 13.5]])),
  camera: join('M4.5 7.5 H7.5 L9.5 4.5 H14.5 L16.5 7.5 H19.5 a1.5 1.5 0 0 1 1.5 1.5 V18 a1.5 1.5 0 0 1 -1.5 1.5 H4.5 a1.5 1.5 0 0 1 -1.5 -1.5 V9 a1.5 1.5 0 0 1 1.5 -1.5 Z', circle(12, 13, 3.5)),
  film: join(rr(4, 3, 16, 18, 1.5), ln(8, 3, 8, 21), ln(16, 3, 16, 21), ln(4, 8, 8, 8), ln(4, 12, 8, 12), ln(4, 16, 8, 16), ln(16, 8, 20, 8), ln(16, 12, 20, 12), ln(16, 16, 20, 16)),
  mic: join(rr(9, 2.5, 6, 11, 3), 'M5.5 11 a6.5 6.5 0 0 0 13 0', ln(12, 17.5, 12, 21), ln(9, 21, 15, 21)),
  music: join('M9 18 V5.5 L19 3.5 V16', circle(6.5, 18, 2.5), circle(16.5, 16, 2.5)),
  play: pg([[7, 4.5], [19, 12], [7, 19.5]]),
  'play-circle': join(circle(12, 12, 9), pg([[10, 8.5], [15.5, 12], [10, 15.5]])),
  pause: join(ln(9, 5, 9, 19), ln(15, 5, 15, 19)),
  book: join('M4 5 a1.5 1.5 0 0 1 1.5 -1.5 H10 a2 2 0 0 1 2 2 V20.5 a1.5 1.5 0 0 0 -1.5 -1.5 H4 Z', 'M20 5 a1.5 1.5 0 0 0 -1.5 -1.5 H14 a2 2 0 0 0 -2 2 V20.5 a1.5 1.5 0 0 1 1.5 -1.5 H20 Z'),
  bookmark: 'M6.5 3 H17.5 V21 L12 17 L6.5 21 Z',
  pen: join('M15 4.5 L19.5 9 L9 19.5 H4.5 V15 Z', ln(12.8, 6.7, 17.3, 11.2)),
  clipboard: join(rr(5, 4.5, 14, 17, 2), rr(9, 2.5, 6, 4, 1)),
  list: join(ln(9, 6, 20, 6), ln(9, 12, 20, 12), ln(9, 18, 20, 18), dot(4.5, 6), dot(4.5, 12), dot(4.5, 18)),
  checklist: join(pl([[3.5, 6], [5, 7.5], [7.5, 4.5]]), ln(11, 6, 20.5, 6), pl([[3.5, 12], [5, 13.5], [7.5, 10.5]]), ln(11, 12, 20.5, 12), pl([[3.5, 18], [5, 19.5], [7.5, 16.5]]), ln(11, 18, 20.5, 18)),
  grid: join(rr(3.5, 3.5, 7, 7, 1.5), rr(13.5, 3.5, 7, 7, 1.5), rr(3.5, 13.5, 7, 7, 1.5), rr(13.5, 13.5, 7, 7, 1.5)),
  layout: join(rr(3, 3.5, 18, 17, 2), ln(3, 9, 21, 9), ln(9.5, 9, 9.5, 20.5)),
  menu: join(ln(4, 6.5, 20, 6.5), ln(4, 12, 20, 12), ln(4, 17.5, 20, 17.5)),
  search: join(circle(10.5, 10.5, 6.5), ln(15.3, 15.3, 20.5, 20.5)),
  'zoom-in': join(circle(10.5, 10.5, 6.5), ln(15.3, 15.3, 20.5, 20.5), ln(10.5, 8, 10.5, 13), ln(8, 10.5, 13, 10.5)),
  filter: pg([[3.5, 4.5], [20.5, 4.5], [14, 12.5], [14, 19], [10, 21], [10, 12.5]]),
  eye: join(EYE, circle(12, 12, 3)),
  'eye-off': join(EYE, circle(12, 12, 3), ln(4, 4, 20, 20)),
  palette: join('M12 3 a9 9 0 0 0 0 18 c1.4 0 2 -1 2 -2 c0 -1.4 -1.2 -1.8 -1.2 -3 c0 -1 .8 -1.8 2 -1.8 H17 a4 4 0 0 0 4 -4 C21 6.5 17 3 12 3 Z', dot(7.5, 11), dot(9.5, 7), dot(14.5, 7)),
  brush: join('M18.5 3 L21 5.5 L12 14.5 L9.5 12 Z', 'M9.5 13 C7 13 5.5 14.5 5.5 17 C5.5 19 4.5 20 3 20.5 C5 21.5 9 21.5 10.5 19.5 C11.5 18 11.5 16 11 15'),
  scissors: join(circle(6, 6.5, 2.8), circle(6, 17.5, 2.8), ln(8.3, 8.1, 20.5, 18), ln(8.3, 15.9, 20.5, 6)),
  wand: join(ln(4, 20, 15, 9), ln(18, 3, 18, 7), ln(16, 5, 20, 5), ln(20, 10.5, 20, 13.5), ln(18.5, 12, 21.5, 12), ln(9.5, 3, 9.5, 6), ln(8, 4.5, 11, 4.5)),

  // Status and signs
  alert: join('M10.3 4.2 a2 2 0 0 1 3.4 0 L20.9 17 a2 2 0 0 1 -1.7 3 H4.8 a2 2 0 0 1 -1.7 -3 Z', ln(12, 9.5, 12, 13.5), dot(12, 16.8)),
  info: join(circle(12, 12, 9), ln(12, 11, 12, 16.5), dot(12, 7.8)),
  help: join(circle(12, 12, 9), 'M9.5 9.5 a2.5 2.5 0 1 1 3.6 2.3 C12.4 12.1 12 12.7 12 13.5', dot(12, 16.8)),
  star: star(12, 12.6, 9.5, 4.1),
  sparkle: 'M12 3 Q13 11 21 12 Q13 13 12 21 Q11 13 3 12 Q11 11 12 3 Z',
  flag: join(ln(5, 21, 5, 4), 'M5 4.5 C8 2.5 11 6.5 14 4.5 C16 3.3 18 3.5 19.5 4.5 V13.5 C18 12.5 16 12.3 14 13.5 C11 15.5 8 11.5 5 13.5'),

  // Places and nature
  pin: join('M12 21.5 C12 21.5 5 15 5 9.5 a7 7 0 0 1 14 0 C19 15 12 21.5 12 21.5 Z', circle(12, 9.5, 2.5)),
  map: join(pg([[3, 6], [9, 3.5], [15, 6], [21, 3.5], [21, 18], [15, 20.5], [9, 18], [3, 20.5]]), ln(9, 3.5, 9, 18), ln(15, 6, 15, 20.5)),
  compass: join(circle(12, 12, 9), pg([[15.5, 8.5], [13.4, 13.4], [8.5, 15.5], [10.6, 10.6]])),
  home: join(pl([[3, 11], [12, 3.5], [21, 11]]), 'M5.5 9 V20 H18.5 V9', 'M10 20 V14.5 H14 V20'),
  sun: sun(),
  moon: 'M20 14.5 A8.5 8.5 0 1 1 9.5 4 A6.8 6.8 0 0 0 20 14.5 Z',
  lightbulb: join('M9 17.5 V15.5 C7 14.2 5.8 12.1 5.8 9.8 a6.2 6.2 0 0 1 12.4 0 C18.2 12.1 17 14.2 15 15.5 V17.5 Z', ln(9.5, 21, 14.5, 21)),
  flame: 'M12 21.5 C8.1 21.5 5.5 18.8 5.5 15.2 C5.5 11 9 9 9.5 4 C12.5 6 13.5 8.5 13 11 C14.2 10.3 15 9.2 15.2 8 C17.3 9.9 18.5 12.5 18.5 15.2 C18.5 18.8 15.9 21.5 12 21.5 Z',
  leaf: join('M5 19 C4.5 11 9 4.5 20 4 C19.5 15 13 19.5 5 19 Z', ln(4, 20, 13, 11)),
  droplet: 'M12 3 C12 3 5.5 10 5.5 14.5 a6.5 6.5 0 0 0 13 0 C18.5 10 12 3 12 3 Z',
  mountain: pg([[2.5, 20], [9, 8], [13, 14.5], [15.5, 11], [21.5, 20]]),
  tree: join(pg([[12, 2.5], [17, 9], [14.5, 9], [19, 15], [5, 15], [9.5, 9], [7, 9]]), ln(12, 15, 12, 21.5)),
  umbrella: join('M3 12 a9 9 0 0 1 18 0 Z', 'M12 12 V18.5 a2 2 0 0 1 -4 0'),
  coffee: join('M4 9 H16 V15 a5 5 0 0 1 -5 5 H9 a5 5 0 0 1 -5 -5 Z', 'M16 10.5 H17.5 a2.5 2.5 0 0 1 0 5 H15.6', ln(8, 3, 8, 6), ln(12, 3, 12, 6)),

  // Devices and vehicles
  laptop: join(rr(4.5, 4.5, 15, 10.5, 1.5), 'M2.5 18.5 L4.5 15 H19.5 L21.5 18.5 Z'),
  desktop: join(rr(2.5, 3.5, 19, 13, 2), ln(12, 16.5, 12, 20.5), ln(8, 20.5, 16, 20.5)),
  tablet: join(rr(4.5, 2.5, 15, 19, 2), dot(12, 18.5)),
  smartphone: join(rr(6.5, 2.5, 11, 19, 2.5), ln(11, 18.5, 13, 18.5)),
  watch: join(rr(6.5, 7, 11, 10, 2.5), 'M9 7 L9.5 3 H14.5 L15 7', 'M9 17 L9.5 21 H14.5 L15 17'),
  headphones: join('M3.5 15.5 V12 a8.5 8.5 0 0 1 17 0 V15.5', rr(3.5, 13.5, 4, 7, 1.5), rr(16.5, 13.5, 4, 7, 1.5)),
  truck: join('M2.5 6.5 H14 V16 H2.5 Z', 'M14 9.5 H18 L21.5 13 V16 H14', circle(6.5, 18, 2), circle(17.5, 18, 2)),
  plane: 'M12 2.5 C13 2.5 13.5 3.5 13.5 5 V9.5 L21 14 V16 L13.5 13.5 V18 L16 20 V21.5 L12 20.5 L8 21.5 V20 L10.5 18 V13.5 L3 16 V14 L10.5 9.5 V5 C10.5 3.5 11 2.5 12 2.5 Z',
  boat: join('M3 16 H21 L18.5 20 H5.5 Z', ln(12, 3, 12, 16), pg([[12, 4], [19, 13.5], [12, 13.5]]), pg([[10.5, 6.5], [10.5, 13.5], [5.5, 13.5]])),
  anchor: join(circle(12, 5, 2), ln(12, 7, 12, 21), ln(8.5, 10.5, 15.5, 10.5), 'M4.5 13.5 C5 18 8 21 12 21 C16 21 19 18 19.5 13.5', pl([[3, 15], [4.5, 13.5], [6.5, 15]]), pl([[17.5, 15], [19.5, 13.5], [21, 15]]))
};

/** name → SVG path data in the 24-unit box. */
export const ICONS = Object.freeze({...DRAWN});
/** Every icon name, in contact-sheet order. */
export const ICON_NAMES = Object.freeze(Object.keys(ICONS));

export const isIcon = name => typeof name === 'string' && Object.hasOwn(ICONS, name);

/** Path data for `name`; throws naming close matches for an unknown icon. */
export function iconPath(name) {
  if (isIcon(name)) return ICONS[name];
  const stem = String(name ?? '').toLowerCase().split('-')[0];
  const near = ICON_NAMES.filter(id => stem && (id.includes(stem) || stem.includes(id.split('-')[0]))).slice(0, 5);
  throw new Error(`unknown icon ${JSON.stringify(name)}${near.length ? ` (did you mean ${near.join(', ')}?)` : ''}; see ICON_NAMES in kit/core/icons.mjs`);
}

/**
 * View node for one icon: an <svg> of `size` px at (x, y) holding one stroked
 * <path>. `stroke` is in box units (ICON_STROKE by default), so the weight
 * scales with the size. `style` is merged into the svg's style (opacity,
 * transforms); `id` lets a timeline animate it.
 */
export function iconNode(name, {id = null, x = 0, y = 0, size = 48, color = '#ffffff', stroke = ICON_STROKE, style = {}} = {}) {
  const d = iconPath(name);
  return el('svg', id, {position: 'absolute', left: x, top: y, width: size, height: size, overflow: 'visible', ...style}, [
    el('path', null, null, [], {d, stroke: color, strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none'})
  ], {width: size, height: size, viewBox: `0 0 ${ICON_BOX} ${ICON_BOX}`, fill: 'none'});
}
