// Pen artwork for the hand-drawn reveal: a marker, pencil, brush or fountain
// pen whose writing tip sits at its node's (0, 0), so the scene moves the node
// to the tip position with x/y transforms while the stroke draws on.
//
// The pen is drawn along +x in its own frame (tip at the origin, 1 unit = 1px
// at unit 1) inside a wrapper rotated -ANGLE degrees: it lies up and to the
// right of the tip the way a right hand holds it. Plain SVG shapes and flat
// fills with darker/lighter stripes only, so Remotion and HyperFrames draw it
// the same; the shadow is a CSS drop-shadow on the unrotated root (screen
// space, down-right). Barrel text is a rotated div, never SVG <text>.

import {el, text} from './catalog-b-view.mjs';
import {mixColor, luminance} from './catalog-b-base.mjs';

export const PENS = Object.freeze(['marker', 'pencil', 'brush', 'fountain']);

/** The stroke each pen lays down: width in px at unit 1. */
export const PEN_INK = Object.freeze({
  marker: Object.freeze({width: 9, cap: 'round', opacity: 0.94}),
  pencil: Object.freeze({width: 2.6, cap: 'round', opacity: 0.72}),
  brush: Object.freeze({width: 6, cap: 'round', opacity: 0.9}),
  fountain: Object.freeze({width: 2.4, cap: 'round', opacity: 1})
});

const LIFT = {marker: 14, pencil: 10, brush: 18, fountain: 12};
/** How far (px at unit 1) the pen lifts off the page between strokes. */
export const penTipLift = kind => LIFT[check(kind)];

const ANGLE = 37;
const MAX_TEXT = 24;
const WHITE = '#ffffff', BLACK = '#000000';
const METAL = '#c3c7cc', GOLD = '#d3a648';
const DEFAULT_BODY = {marker: '#2e3239', pencil: '#f2b705', brush: '#8e2a22', fountain: '#1f2b4d'};
const DEFAULT_INK = '#222222';

const r = n => Math.round(n * 100) / 100;
const lit = (c, a) => mixColor(WHITE, c, a);
const dim = (c, a) => mixColor(BLACK, c, a);
const path = (d, fill, extra = {}) => el('path', null, null, [], {d, fill, ...extra});
const rect = (x, y, w, h, fill, extra = {}) => el('rect', null, null, [], {x: r(x), y: r(y), width: r(w), height: r(h), fill, ...extra});
const line = (x1, y1, x2, y2, stroke, width, extra = {}) => path(`M${r(x1)} ${r(y1)}L${r(x2)} ${r(y2)}`, 'none', {stroke, strokeWidth: width, strokeLinecap: 'round', ...extra});

function check(kind) {
  if (!PENS.includes(kind)) throw new Error(`sketch-pens: unknown pen "${kind}" (${PENS.join(', ')})`);
  return kind;
}

// A cylinder lit from the upper left: in the pen frame -y faces up-left, so a
// highlight stripe runs along -y and a shade stripe along +y.
function shade(x0, x1, h, body) {
  return [
    rect(x0, h * 0.25, x1 - x0, h * 0.75, dim(body, 0.28)),
    rect(x0, h * 0.72, x1 - x0, h * 0.28, dim(body, 0.42)),
    line(x0 + 3, -h * 0.5, x1 - 3, -h * 0.5, lit(body, 0.45), h * 0.22, {strokeOpacity: 0.9})
  ];
}

// Each builder returns {length, thick, label: [x0, x1], shapes} in the pen frame.
const BUILD = {
  marker(ink, body) {
    const L = 340, T = 34, h = T / 2;
    const collar = dim(body, 0.35);
    return {length: L, thick: T, label: [62, 284], shapes: [
      // felt nib: rounded bullet in the ink colour
      path('M1.2 -2.6Q-0.8 0 1.2 2.6L15 5.2L15 -5.2Z', ink),
      path('M2 -2.2L15 -5.2L15 -2.4Z', lit(ink, 0.25)),
      // tapered front collar
      path(`M13 -6.5C26 -8 34 ${-h + 1} 48 ${-h}L48 ${h}C34 ${h - 1} 26 8 13 6.5Z`, collar),
      path(`M13 2.5C26 4 34 ${h - 5} 48 ${h - 4}L48 ${h}C34 ${h - 1} 26 8 13 6.5Z`, dim(collar, 0.35)),
      line(18, -4.6, 44, -h + 3.5, lit(collar, 0.35), 2.2),
      // barrel
      rect(46, -h, 250, T, body, {rx: 4}),
      ...shade(48, 294, h, body),
      // posted cap with clip, in the ink colour
      rect(288, -h - 2, 52, T + 4, ink, {rx: 9}),
      rect(288, h * 0.25, 52, h * 0.75 + 2, dim(ink, 0.25), {rx: 6}),
      line(294, -h * 0.5, 334, -h * 0.5, lit(ink, 0.35), 3.5),
      rect(288, -h - 2, 5, T + 4, dim(ink, 0.35)),
      path(`M300 ${-h - 2}L300 ${-h - 7}Q300 ${-h - 9} 303 ${-h - 9}L336 ${-h - 9}Q338 ${-h - 9} 338 ${-h - 7}L338 ${-h - 2}Z`, dim(ink, 0.3)),
      line(304, -h - 7, 334, -h - 7, lit(ink, 0.3), 1.6)
    ]};
  },
  pencil(ink, body) {
    const L = 330, T = 24, h = T / 2;
    const wood = '#ecc99b', third = T / 3;
    const facet = (y0, y1, fill) => path(`M298 ${y0}L44 ${y0}Q35 ${r((y0 + y1) / 2)} 44 ${y1}L298 ${y1}Z`, fill);
    return {length: L, thick: T, label: [58, 290], shapes: [
      // sharpened wood cone and graphite point
      path(`M9 -2.8L46 ${-h}L46 ${h}L9 2.8Z`, wood),
      path(`M9 0L46 0L46 ${h}L9 2.8Z`, dim(wood, 0.12)),
      line(14, -2.2, 40, -h + 2, lit(wood, 0.4), 1.6),
      path('M0 0L10 -3.1L10 3.1Z', ink),
      path('M0 0L10 0L10 3.1Z', dim(ink, 0.3)),
      // three painted facets read as a hexagonal barrel
      facet(-h, -h + third, lit(body, 0.28)),
      facet(-h + third, h - third, body),
      facet(h - third, h, dim(body, 0.22)),
      line(48, -h + third, 296, -h + third, dim(body, 0.12), 0.8),
      line(48, h - third, 296, h - third, dim(body, 0.32), 0.8),
      line(50, -h + 3, 294, -h + 3, lit(body, 0.6), 1.6, {strokeOpacity: 0.8}),
      // ferrule and eraser
      rect(296, -h - 0.5, 18, T + 1, METAL),
      rect(296, h * 0.3, 18, h * 0.7 + 0.5, dim(METAL, 0.3)),
      line(299.5, -h + 1, 299.5, h - 1, dim(METAL, 0.35), 1.2),
      line(310.5, -h + 1, 310.5, h - 1, dim(METAL, 0.35), 1.2),
      line(302, -h * 0.55, 308, -h * 0.55, lit(METAL, 0.6), 2),
      path(`M314 ${-h}L324 ${-h}Q330 ${-h} 330 ${-h + 6}L330 ${h - 6}Q330 ${h} 324 ${h}L314 ${h}Z`, '#e98b95'),
      path(`M314 ${h * 0.3}L330 ${h * 0.3}L330 ${h - 6}Q330 ${h} 324 ${h}L314 ${h}Z`, '#cf6f7b')
    ]};
  },
  brush(ink, body) {
    const L = 360, T = 22, h = T / 2;
    const hair = '#e2cea6';
    return {length: L, thick: T, label: [112, 300], shapes: [
      // bristles, loaded with ink toward the point
      path('M0 0C10 -3.4 30 -9.2 52 -8.4L52 8.4C30 9.2 10 3.4 0 0Z', hair),
      path('M0 0C10 -1 30 1.5 52 2L52 8.4C30 9.2 10 3.4 0 0Z', dim(hair, 0.15)),
      path('M0 0C7 -2.4 17 -5.6 27 -6.6C29.5 -2 29.5 2 27 6.6C17 5.6 7 2.4 0 0Z', ink),
      line(30, -3.6, 50, -4.6, dim(hair, 0.2), 0.8),
      line(32, 1.2, 50, 1.4, dim(hair, 0.2), 0.8),
      // crimped ferrule
      path('M49 -8.6L92 -11L92 11L49 8.6Z', METAL),
      path('M49 3L92 4L92 11L49 8.6Z', dim(METAL, 0.3)),
      line(52, -6.2, 90, -8, lit(METAL, 0.6), 2),
      line(60, -8.6, 60, 8.6, dim(METAL, 0.4), 1.2),
      line(64, -8.8, 64, 8.8, dim(METAL, 0.4), 1.2),
      // lacquered handle, swelling then tapering to a rounded end
      path(`M90 -11C140 -13.5 210 -11 350 -4.6Q360 0 350 4.6C210 11 140 13.5 90 11Z`, body),
      path(`M90 4C140 5 210 4 352 1.8Q358 3 350 4.6C210 11 140 13.5 90 11Z`, dim(body, 0.32)),
      path('M96 -6.2C150 -8.4 220 -6.6 338 -2.4', 'none', {stroke: lit(body, 0.45), strokeWidth: 2.6, strokeLinecap: 'round'})
    ]};
  },
  fountain(ink, body) {
    const L = 320, T = 26, h = T / 2;
    const section = '#19191c';
    return {length: L, thick: T, label: [96, 262], shapes: [
      // nib: gold with a slit, breather hole and an inked point
      path('M0 0L8 -2.8C18 -8.6 28 -9.6 36 -9L36 9C28 9.6 18 8.6 8 2.8Z', GOLD),
      path('M0 0L36 0L36 9C28 9.6 18 8.6 8 2.8Z', dim(GOLD, 0.2)),
      path('M0 0L6 -2.2L6 2.2Z', ink),
      line(2, 0, 21, 0, dim(GOLD, 0.6), 0.9),
      el('circle', null, null, [], {cx: 22.5, cy: 0, r: 1.7, fill: dim(GOLD, 0.6)}),
      line(12, -4.6, 32, -7.4, lit(GOLD, 0.5), 1.2),
      // grip section
      path('M33 -8.5L74 -11.5L74 11.5L33 8.5Z', section),
      path('M33 3L74 4L74 11.5L33 8.5Z', lit(section, 0.08)),
      line(38, -6.6, 70, -8.8, lit(section, 0.35), 1.8),
      rect(73, -h + 0.5, 5, T - 1, GOLD),
      rect(73, h * 0.3, 5, h * 0.7 - 0.5, dim(GOLD, 0.25)),
      // barrel, cap band, rounded end, clip
      rect(77, -h, 243, T, body, {rx: 12}),
      ...shade(84, 306, h, body),
      rect(268, -h, 6, T, GOLD),
      rect(268, h * 0.3, 6, h * 0.7, dim(GOLD, 0.25)),
      rect(236, -h - 4.6, 78, 4.6, GOLD, {rx: 2.3}),
      rect(236, -h - 1.6, 78, 1.6, dim(GOLD, 0.3)),
      el('circle', null, null, [], {cx: 238, cy: -h - 2.2, r: 3.4, fill: GOLD})
    ]};
  }
};

/** How high (px at unit 1) the pen reaches above its tip, barrel and lift included: the room it needs below anything it must not cover. */
export function penRise(kind) {
  const {length, thick} = BUILD[check(kind)](DEFAULT_INK, DEFAULT_BODY[kind]);
  return Math.round(length * Math.sin(ANGLE * Math.PI / 180) + thick + LIFT[kind]);
}

/**
 * One pen node with its writing tip at (0, 0).
 * opts: {u, ink, body?, barrel?: {text, color?}, family?}
 */
export function penNode(id, kind, {u = 1, ink = DEFAULT_INK, body, barrel, family = 'Inter, sans-serif'} = {}) {
  check(kind);
  const label = barrel?.text ? String(barrel.text) : '';
  if (label.length > MAX_TEXT) throw new Error(`sketch-pens: barrel text is ${label.length} chars, max ${MAX_TEXT}`);
  const fill = body ?? DEFAULT_BODY[kind];
  const pen = BUILD[kind](ink, fill);
  const {length: L, thick: T} = pen;
  const svg = el('svg', null, {position: 'absolute', left: 0, top: r(-T / 2 * u) - 12 * u, overflow: 'visible'}, pen.shapes,
    {width: r(L * u), height: r((T + 24) * u), viewBox: `0 ${-T / 2 - 12} ${L} ${T + 24}`, fill: 'none'});
  const kids = [svg];
  if (label) {
    const [x0, x1] = pen.label;
    // shortcut: fixed 0.66em advance for bold caps-ish sans, fine for short brand names
    const size = r(Math.min(T * 0.44, (x1 - x0) * 0.9 / (label.length * 0.66)) * u);
    const color = barrel.color ?? (luminance(fill) > 0.35 ? dim(fill, 0.75) : lit(fill, 0.85));
    kids.push(text(`${id}-label`, {position: 'absolute', left: r(x0 * u), top: r(-T / 2 * u), width: r((x1 - x0) * u), height: r(T * u),
      lineHeight: `${r(T * u)}px`, textAlign: 'center', fontFamily: family, fontWeight: 700, fontSize: size, letterSpacing: '0.06em', color}, label));
  }
  const rotated = el('div', `${id}-pen`, {position: 'absolute', left: 0, top: 0, width: 0, height: 0, overflow: 'visible', transform: `rotate(${-ANGLE}deg)`, transformOrigin: '0 0'}, kids);
  return el('div', id, {position: 'absolute', left: 0, top: 0, width: 0, height: 0, overflow: 'visible',
    filter: `drop-shadow(${r(9 * u)}px ${r(14 * u)}px ${r(8 * u)}px rgba(0,0,0,0.26))`}, [rotated]);
}
