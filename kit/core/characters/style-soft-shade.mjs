// Drawing style "soft-shade": soft vector shading with no hard outline.
// Every piece is filled with a gradient from a lit tint on the side facing
// the key light (light.mjs) through its own colour to a deeper shade on the
// far side, and edged with a thin line of its own darker tone, so pieces of
// one colour still separate. Limbs are filled capsules shaded across their
// width. The shadow under the feet is a soft radial falloff. The toon body
// (toon.mjs) lays out the shapes.
//
// Imports only sibling kit/core files.

import {el} from '../catalog-b-view.mjs';
import {drawToon, toonHeight} from './toon.mjs';
import {rigGeometry} from './rig.mjs';
import {capsulePath, darken, isHex, lighten, linearGradient, pathNode, penState, placedGroup, r1, radialGradient, resolver, strokeLine} from './pens.mjs';

export function softShadePen(c, {id, light}) {
  const col = resolver(c);
  const S = penState(id, light);
  const k = 0.6 + 0.8 * (light?.intensity ?? 0.55);
  /** The gradient id for a colour in the current frame (lit side toward the light). */
  const shaded = hex => {
    const dir = S.lightDir();
    const key = `g${hex}${dir.x.toFixed(2)}${dir.y.toFixed(2)}`;
    return `url(#${S.def(key, defId => linearGradient(defId, dir, [[0, lighten(hex, 0.2 * k)], [0.45, hex], [1, darken(hex, 0.26 * k)]]))})`;
  };
  const edge = hex => darken(hex, 0.32);
  const fillOf = (hex, o) => (isHex(hex) && o.outline !== false && o.fillOpacity === undefined ? shaded(hex) : hex);
  const common = o => ({...(o.opacity !== undefined ? {opacity: o.opacity} : {}), ...(o.rule ? {fillRule: o.rule} : {}), ...(o.fillOpacity !== undefined ? {fillOpacity: o.fillOpacity} : {})});
  return {
    within: S.within,
    defs: S.defs,
    shape(d, fill, o = {}) {
      const hex = col(fill);
      if (hex === 'none') {
        const inked = !o.stroke || o.stroke === 'outline';
        return strokeLine(d, col(o.stroke ?? 'outline'), (o.width ?? 7) * (inked ? 0.6 : 1));
      }
      if (o.outline === false) return pathNode(d, {fill: hex, stroke: 'none', ...common(o)});
      const lens = o.fillOpacity !== undefined;
      return pathNode(d, {fill: fillOf(hex, o), stroke: lens ? c.outline : edge(hex), strokeWidth: lens ? 4.5 : 2.6, strokeLinejoin: 'round', ...(lens ? {} : {strokeOpacity: 0.7}), ...common(o)});
    },
    ellipse(cx, cy, rx, ry, fill, o = {}) {
      const hex = col(fill);
      const plain = o.outline === false || Math.min(rx, ry) < 10;
      return el('ellipse', null, null, [], {cx: r1(cx), cy: r1(cy), rx: r1(rx), ry: r1(ry), fill: plain ? hex : fillOf(hex, o), stroke: plain ? 'none' : o.fillOpacity !== undefined ? c.outline : edge(hex), strokeWidth: o.fillOpacity !== undefined ? 4.5 : 2.6, ...(o.fillOpacity === undefined && !plain ? {strokeOpacity: 0.7} : {}), ...common(o)});
    },
    line: (d, color, width) => strokeLine(d, col(color), color === 'outline' ? width * 0.9 : width),
    limb(length, width, fill, from = 0, place = null) {
      const hex = col(fill);
      const nodes = [pathNode(capsulePath(from, length, width), {fill: fillOf(hex, {}), stroke: isHex(hex) ? edge(hex) : 'none', strokeWidth: 2.6, strokeOpacity: 0.7})];
      return place ? [placedGroup(nodes, place)] : nodes;
    },
    strand(d, fill, width) {
      const hex = col(fill);
      return [strokeLine(d, edge(hex), width + 3), strokeLine(d, hex, width), strokeLine(d, lighten(hex, 0.18), width * 0.35, {opacity: 0.8})];
    },
    ground() {
      const grad = S.def('rground', defId => radialGradient(defId, {}, [[0, '#000000', 0.28], [0.7, '#000000', 0.1], [1, '#000000', 0]]));
      return [el('ellipse', null, null, [], {cx: r1(-(light?.x ?? -0.57) * 40), cy: 4, rx: 190, ry: 26, fill: `url(#${grad})`})];
    }
  };
}

export function drawSoftShade(params, colors, options) {
  return drawToon(params, colors, options, softShadePen);
}

export const STYLE = {draw: drawSoftShade, height: toonHeight, geometry: rigGeometry, describe: 'soft vector shading: gradients from the lit side to the shade, no hard outline'};
