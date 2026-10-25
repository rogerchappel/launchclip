// Drawing style "flat": flat fills with a dark outline, rounded limbs and a
// simple friendly face. The toon body (toon.mjs) lays out the shapes; this
// pen fills each one and outlines it in the character's ink.
//
// Imports only sibling kit/core files.

import {el} from '../catalog-b-view.mjs';
import {drawToon, toonHeight} from './toon.mjs';

export {svgTransform} from './toon.mjs';

const OUT = 7;
const r1 = value => Math.round(value * 10) / 10;

/**
 * The flat pen: fills in the named colour, outlines in the outline colour
 * (unless `outline: false`), limbs as outlined round-capped strokes.
 */
export function flatPen(c) {
  const col = name => (name === null || name === undefined ? 'none' : c[name] ?? name);
  const line = (d, color, width) => el('path', null, null, [], {d, fill: 'none', stroke: col(color), strokeWidth: width, strokeLinecap: 'round', strokeLinejoin: 'round'});
  return {
    within: (_state, draw) => draw(),
    shape: (d, fill, o = {}) => el('path', null, null, [], {d, fill: col(fill), stroke: o.outline === false ? 'none' : col(o.stroke ?? 'outline'), strokeWidth: o.width ?? OUT, strokeLinejoin: 'round', strokeLinecap: 'round', ...(o.opacity !== undefined ? {opacity: o.opacity} : {}), ...(o.rule ? {fillRule: o.rule} : {}), ...(o.fillOpacity !== undefined ? {fillOpacity: o.fillOpacity} : {})}),
    ellipse: (cx, cy, rx, ry, fill, o = {}) => el('ellipse', null, null, [], {cx: r1(cx), cy: r1(cy), rx: r1(rx), ry: r1(ry), fill: col(fill), stroke: o.outline === false ? 'none' : col(o.stroke ?? 'outline'), strokeWidth: o.width ?? OUT, ...(o.opacity !== undefined ? {opacity: o.opacity} : {}), ...(o.fillOpacity !== undefined ? {fillOpacity: o.fillOpacity} : {})}),
    line,
    /** An outlined capsule from (0, from) to (0, length). */
    limb: (length, width, fill, from = 0) => {
      const d = `M0 ${r1(from)}L0 ${r1(length)}`;
      return [line(d, 'outline', width + OUT * 2), line(d, fill, width)];
    },
    strand: (d, fill, width) => [line(d, 'outline', width + OUT * 2), line(d, fill, width)],
    ground: () => [el('ellipse', null, null, [], {cx: 0, cy: 4, rx: 150, ry: 18, fill: '#000000', stroke: 'none', strokeWidth: OUT, opacity: 0.16})]
  };
}

/**
 * Draw one character in the flat style (options: toon.mjs drawToon).
 * → node: a <g> with the feet at (0, 0).
 */
export function drawFlat(params, colors, options) {
  return drawToon(params, colors, options, flatPen);
}

/** Height of the drawn character above the feet, in rig units (with hair). */
export const drawnHeight = toonHeight;
