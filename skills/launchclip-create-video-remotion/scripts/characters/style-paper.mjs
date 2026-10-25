// Drawing style "paper": cut paper. No outlines: every piece is a cut shape
// with a slightly hand-cut edge (its points nudged by deterministic noise),
// a soft offset shadow cast away from the key light onto whatever lies
// under it, and a fine grain of light and dark specks clipped to the piece.
// Colours lean a touch toward the paper. The toon body (toon.mjs) lays out
// the shapes.
//
// Imports only sibling kit/core files.

import {el} from '../catalog-b-view.mjs';
import {drawToon, toonHeight} from './toon.mjs';
import {rigGeometry} from './rig.mjs';
import {darken, ellipsePath, group, isHex, jitter, mix, noise, pathBox, pathNode, penState, placedGroup, r1, resolver, strokeLine} from './pens.mjs';

const PAPER_TINT = '#f4ecdc';
const INK = '#2e2730';

/** Grain specks over a box, one per cell of a jittered grid: [light path, dark path] of tiny squares. */
function grain(box, salt) {
  const w = box.x1 - box.x0, h = box.y1 - box.y0;
  const step = Math.max(14, Math.sqrt((w * h) / 110));
  let light = '', dark = '';
  let i = 0;
  for (let y = box.y0; y < box.y1; y += step) {
    for (let x = box.x0; x < box.x1; x += step, i++) {
      const px = r1(x + noise(`${salt}x${i}`) * step), py = r1(y + noise(`${salt}y${i}`) * step);
      const s = 2.4;
      const sq = `M${px} ${py}L${r1(px + s)} ${py}L${r1(px + s)} ${r1(py + s)}L${px} ${r1(py + s)}Z`;
      if (noise(`${salt}k${i}`) < 0.5) light += sq; else dark += sq;
    }
  }
  return [light, dark];
}

export function paperPen(c, {id, light}) {
  const col = resolver(c);
  const S = penState(id, light);
  const tint = hex => (isHex(hex) ? mix(PAPER_TINT, hex, 0.08) : hex);
  const away = (k) => { const d = S.lightDir(); return [r1(-d.x * k), r1(-d.y * k)]; };
  /** A cut piece: its cast shadow, the piece, its grain. */
  const piece = (d, fill, o, big = true) => {
    const hex = col(fill);
    const rule = o.rule ? {fillRule: o.rule} : {};
    const cut = jitter(d, 1.6, d.length.toString(36));
    const [sx, sy] = away(9);
    const nodes = [pathNode(cut, {fill: '#1a1414', opacity: 0.2, transform: `translate(${sx} ${sy})`, ...rule}), pathNode(cut, {fill: tint(hex), ...rule})];
    if (big) {
      const box = pathBox(d);
      if ((box.x1 - box.x0) * (box.y1 - box.y0) > 2400) {
        const clip = S.uid('cp');
        const [lightSpecks, darkSpecks] = grain(box, cut.slice(0, 40));
        nodes.push(el('clipPath', clip, null, [pathNode(cut, rule)]), group([
          pathNode(lightSpecks, {fill: '#ffffff', opacity: 0.16}),
          pathNode(darkSpecks, {fill: '#000000', opacity: 0.07})
        ], {clipPath: `url(#${clip})`}));
      }
    }
    return group(nodes, o.opacity !== undefined ? {opacity: o.opacity} : undefined);
  };
  return {
    within: S.within,
    shape(d, fill, o = {}) {
      const hex = col(fill);
      // A stroke with no fill (a hood's edge, a headphone band): a paper strip.
      if (hex === 'none') return !o.stroke || o.stroke === 'outline' ? strokeLine(d, INK, (o.width ?? 7) * 0.7) : strokeLine(d, tint(col(o.stroke)), o.width ?? 7);
      if (o.outline === false || o.fillOpacity !== undefined) return pathNode(d, {fill: o.fillOpacity !== undefined ? '#ffffff' : tint(hex), ...(o.fillOpacity !== undefined ? {fillOpacity: 0.3, stroke: INK, strokeWidth: 4} : {}), ...(o.opacity !== undefined ? {opacity: o.opacity} : {}), ...(o.rule ? {fillRule: o.rule} : {})});
      return piece(d, fill, o);
    },
    ellipse(cx, cy, rx, ry, fill, o = {}) {
      const hex = col(fill);
      if (o.outline === false || o.fillOpacity !== undefined || Math.min(rx, ry) < 12) {
        return el('ellipse', null, null, [], {cx: r1(cx), cy: r1(cy), rx: r1(rx), ry: r1(ry), fill: o.fillOpacity !== undefined ? '#ffffff' : tint(hex), ...(o.fillOpacity !== undefined ? {fillOpacity: 0.3, stroke: INK, strokeWidth: 4} : {}), ...(o.opacity !== undefined ? {opacity: o.opacity} : {})});
      }
      return piece(ellipsePath(cx, cy, rx, ry), fill, o, Math.min(rx, ry) > 24);
    },
    line(d, color, width) {
      const hex = col(color);
      return strokeLine(d, color === 'outline' ? INK : tint(hex), width);
    },
    limb(length, width, fill, from = 0, place = null) {
      const d = `M0 ${r1(from)}L0 ${r1(length)}`;
      const [sx, sy] = away(8);
      const nodes = [strokeLine(d, '#1a1414', width, {opacity: 0.2, transform: `translate(${sx} ${sy})`}), strokeLine(d, tint(col(fill)), width)];
      return place ? [placedGroup(nodes, place)] : nodes;
    },
    strand(d, fill, width) {
      const [sx, sy] = away(6);
      return [strokeLine(d, '#1a1414', width, {opacity: 0.2, transform: `translate(${sx} ${sy})`}), strokeLine(d, tint(col(fill)), width)];
    },
    ground: () => [pathNode(jitter(ellipsePath(r1(-(light?.x ?? -0.57) * 50), 4, 160, 20), 2, 'ground'), {fill: darken('#8a7a68', 0.2), opacity: 0.32})]
  };
}

export function drawPaper(params, colors, options) {
  return drawToon(params, colors, options, paperPen);
}

export const STYLE = {draw: drawPaper, height: toonHeight, geometry: rigGeometry, describe: 'cut paper: hand-cut pieces with offset shadows and a fine grain, no outlines'};
