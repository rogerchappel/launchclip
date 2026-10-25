// Drawing style "line": single-weight line art. Every stroke is the same
// weight in one ink; shapes are filled with paper so lines behind them stay
// hidden. Dark hair and dark clothes fill with ink (as a pen-and-ink drawing
// would), so people keep their silhouettes; tints (blush, highlights, shine)
// are left out. The toon body (toon.mjs) lays out the shapes.
//
// Imports only sibling kit/core files.

import {el} from '../catalog-b-view.mjs';
import {drawToon, toonHeight} from './toon.mjs';
import {rigGeometry} from './rig.mjs';
import {luma, placedGroup, r1, resolver, strokeLine, pathNode, penState} from './pens.mjs';

export const LINE_WEIGHT = 5;
const INK = '#221d27';
const PAPER = '#fbf9f4';

export function linePen(c, {id, light}) {
  const col = resolver(c);
  const S = penState(id, light);
  const w = LINE_WEIGHT;
    // Paper for skin and light fills; ink for dark hair (brown and darker) and near-black clothes.
  const fillOf = name => {
    const hex = col(name);
    if (hex === 'none') return 'none';
    if (String(name).startsWith('skin')) return PAPER;
    return luma(hex) < (name === 'hair' || name === 'stubble' ? 0.32 : 0.15) ? INK : PAPER;
  };
  // Details without an outline that the ink keeps: eyes and other dark marks, never skin tints or blush.
  const inked = name => {
    if (String(name).startsWith('skin') || name === 'blush') return false;
    const hex = col(name);
    return hex !== 'none' && luma(hex) < 0.3;
  };
  const skipLine = name => ['hairLight', 'skinLight', 'accentLight', 'topLight'].includes(name);
  const empty = () => el('g', null, null, []);
  return {
    within: S.within,
    shape(d, fill, o = {}) {
      if (o.outline === false) {
        // A tint or a detail without an outline: dark ones become ink, light ones go.
        if (inked(fill)) return pathNode(d, {fill: INK, stroke: 'none', ...(o.rule ? {fillRule: o.rule} : {}), ...(o.opacity !== undefined ? {opacity: r1(o.opacity * 0.5)} : {})});
        if (fill === '#ffffff') return pathNode(d, {fill: PAPER, stroke: 'none'});
        return empty();
      }
      if (o.stroke === 'none') return pathNode(d, {fill: fillOf(fill), stroke: 'none', ...(o.rule ? {fillRule: o.rule} : {})});
      // Glass lenses (fillOpacity) stay clear; everything else fills paper or ink.
      const lens = o.fillOpacity !== undefined;
      return pathNode(d, {fill: lens ? 'none' : fillOf(fill), stroke: INK, strokeWidth: w, strokeLinejoin: 'round', strokeLinecap: 'round', ...(o.rule ? {fillRule: o.rule} : {})});
    },
    ellipse(cx, cy, rx, ry, fill, o = {}) {
      if (o.outline === false) {
        if (inked(fill)) return el('ellipse', null, null, [], {cx: r1(cx), cy: r1(cy), rx: r1(rx), ry: r1(ry), fill: INK, stroke: 'none'});
        if (fill === '#ffffff') return el('ellipse', null, null, [], {cx: r1(cx), cy: r1(cy), rx: r1(rx), ry: r1(ry), fill: PAPER, stroke: 'none'});
        return empty();
      }
      return el('ellipse', null, null, [], {cx: r1(cx), cy: r1(cy), rx: r1(rx), ry: r1(ry), fill: o.fillOpacity !== undefined ? 'none' : fillOf(fill), stroke: INK, strokeWidth: w});
    },
    line(d, color, width) {
      if (skipLine(color)) return empty();
      return strokeLine(d, INK, Math.min(w, width));
    },
    limb(length, width, fill, from = 0, place = null) {
      const d = `M0 ${r1(from)}L0 ${r1(length)}`;
      const nodes = [strokeLine(d, INK, width + w * 2), strokeLine(d, fillOf(fill), width)];
      return place ? [placedGroup(nodes, place)] : nodes;
    },
    strand: (d, fill, width) => [strokeLine(d, INK, width + w * 2), strokeLine(d, fillOf(fill), width)],
    ground: () => [strokeLine('M-120 6L120 6', INK, w, {opacity: 0.35})]
  };
}

export function drawLine(params, colors, options) {
  return drawToon(params, colors, options, linePen);
}

export const STYLE = {draw: drawLine, height: toonHeight, geometry: rigGeometry, describe: 'single-weight line art: one ink, paper fills, dark hair and clothes inked in'};
