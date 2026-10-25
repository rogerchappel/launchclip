// Drawing style "outlined": comic-book ink. A heavy outline round every
// piece and a hard cel shadow on the side away from the key light (light.mjs):
// each piece is filled in its shade, then its lit colour is laid over it
// shifted toward the light and clipped to the piece, leaving a crescent of
// shade on the far edge. Limbs get a shade stripe on their far side. The toon
// body (toon.mjs) lays out the shapes.
//
// Imports only sibling kit/core files.

import {el} from '../catalog-b-view.mjs';
import {drawToon, toonHeight} from './toon.mjs';
import {rigGeometry} from './rig.mjs';
import {darken, ellipsePath, pathBox, group, isHex, lighten, pathNode, penState, placedGroup, r1, resolver, strokeLine} from './pens.mjs';

const INK = 7 * 1.8;

export function outlinedPen(c, {id, light}) {
  const col = resolver(c);
  const S = penState(id, light);
  const ink = c.outline;
  const shade = hex => darken(hex, 0.3 + 0.2 * (light?.intensity ?? 0.55));
  /** A piece: shade, the lit colour shifted toward the light and clipped, then the ink. */
  const piece = (d, fill, o) => {
    const hex = col(fill);
    const width = (o.width ?? 7) * 1.8;
    const stroke = o.stroke === 'none' ? 'none' : col(o.stroke ?? 'outline');
    const extra = {...(o.opacity !== undefined ? {opacity: o.opacity} : {}), ...(o.rule ? {fillRule: o.rule} : {})};
    if (!isHex(hex) || o.fillOpacity !== undefined || o.outline === false) {
      return pathNode(d, {fill: hex, stroke: o.outline === false ? 'none' : stroke, strokeWidth: width, strokeLinejoin: 'round', strokeLinecap: 'round', ...extra, ...(o.fillOpacity !== undefined ? {fillOpacity: o.fillOpacity} : {})});
    }
    const dir = S.lightDir();
    const clip = S.uid('cp');
    // The shade crescent grows with the piece: a fifth of its smaller side.
    const box = pathBox(d);
    const shift = Math.max(6, Math.min(34, 0.2 * Math.min(box.x1 - box.x0, box.y1 - box.y0)));
    return group([
      el('clipPath', clip, null, [pathNode(d, o.rule ? {fillRule: o.rule} : {})]),
      pathNode(d, {fill: shade(hex), stroke: 'none', ...(o.rule ? {fillRule: o.rule} : {})}),
      group([pathNode(d, {fill: hex, stroke: 'none', transform: `translate(${r1(dir.x * shift)} ${r1(dir.y * shift)})`, ...(o.rule ? {fillRule: o.rule} : {})})], {clipPath: `url(#${clip})`}),
      ...(stroke === 'none' ? [] : [pathNode(d, {fill: 'none', stroke, strokeWidth: width, strokeLinejoin: 'round', strokeLinecap: 'round', ...(o.rule ? {fillRule: o.rule} : {})})])
    ], o.opacity !== undefined ? {opacity: o.opacity} : undefined);
  };
  return {
    within: S.within,
    shape: (d, fill, o = {}) => piece(d, fill, o),
    ellipse: (cx, cy, rx, ry, fill, o = {}) => {
      // Small dots (eyes, buttons, studs) stay plain.
      if (o.outline === false || Math.min(rx, ry) < 14) return el('ellipse', null, null, [], {cx: r1(cx), cy: r1(cy), rx: r1(rx), ry: r1(ry), fill: col(fill), stroke: o.outline === false ? 'none' : ink, strokeWidth: (o.width ?? 7) * 1.4, ...(o.opacity !== undefined ? {opacity: o.opacity} : {}), ...(o.fillOpacity !== undefined ? {fillOpacity: o.fillOpacity} : {})});
      return piece(ellipsePath(cx, cy, rx, ry), fill, o);
    },
    line: (d, color, width) => strokeLine(d, col(color), color === 'outline' ? width * 1.25 : width),
    limb(length, width, fill, from = 0, place = null) {
      const hex = col(fill);
      const d = `M0 ${r1(from)}L0 ${r1(length)}`;
      const dir = S.lightDir();
      // The shade stripe runs down the side away from the light.
      const off = r1(-Math.sign(dir.x || -1) * width * 0.26);
      const nodes = [strokeLine(d, ink, width + INK * 2), strokeLine(d, hex, width)];
      if (isHex(hex) && width > 12) nodes.push(strokeLine(`M${off} ${r1(from + width * 0.15)}L${off} ${r1(length - width * 0.05)}`, shade(hex), width * 0.44));
      return place ? [placedGroup(nodes, place)] : nodes;
    },
    strand: (d, fill, width) => [strokeLine(d, ink, width + INK * 2), strokeLine(d, col(fill), width), strokeLine(d, lighten(col(fill), 0.2), width * 0.3)],
    ground: () => [el('ellipse', null, null, [], {cx: r1(-(light?.x ?? -0.57) * 40), cy: 4, rx: 160, ry: 20, fill: '#000000', opacity: 0.2})]
  };
}

export function drawOutlined(params, colors, options) {
  return drawToon(params, colors, options, outlinedPen);
}

export const STYLE = {draw: drawOutlined, height: toonHeight, geometry: rigGeometry, describe: 'comic ink: a heavy outline and a hard cel shadow away from the key light'};
