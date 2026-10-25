// The painter for the lifelike and cinematic drawing styles (real.mjs).
// Layered shading in plain SVG:
//
// - form: every piece is filled with a five-stop gradient across its form,
//   from a highlight on the side facing the key light (light.mjs) through
//   the lit tone and the base colour to a core shadow, then a little
//   reflected light at the far edge, as paint over a rounded form.
// - edges: a thin line in the piece's own deep tone, for definition.
// - texture: hair gets strands (thin curves in a darker and a lighter tone,
//   clipped to the hair mass); cloth gets folds where the drawing asks.
// - cinematic extras: a rim light hugging the lit edge of each piece (a
//   stroke of the piece shifted away from the light, clipped to the piece),
//   light falloff down the body (`within({falloff})`), and a long soft
//   shadow cast on the floor away from the light.
//
// The pen also speaks the toon pen interface (shape, ellipse, line, limb,
// strand, ground, within, defs), so toon hair, headwear and outfit details
// can be painted by it inside a scaled group.
//
// Imports only sibling kit/core files.

import {el} from '../catalog-b-view.mjs';
import {capsulePath, darken, ellipsePath, group, isHex, lighten, linearGradient, luma, mix, noise, pathBox, pathNode, penState, placedGroup, r1, r3, radialGradient, resolver, strokeLine} from './pens.mjs';

/** Shading strength from the light: flat ambient at 0, hard key at 1. */
const contrast = light => 0.55 + 0.9 * (light?.intensity ?? 0.55);

export function realPen(c, {id, light, cinematic = false}) {
  const col = resolver(c);
  const S = penState(id, light);
  const k = contrast(light);
  const lightColor = light?.color ?? '#fff1dc';
  const state = {falloff: 0};
  const within = (next, draw) => {
    const before = state.falloff;
    if (next && next.falloff !== undefined) state.falloff = next.falloff;
    try { return S.within(next, draw); } finally { state.falloff = before; }
  };
  /** The colour after light falloff down the body. */
  const fall = hex => (state.falloff && isHex(hex) ? darken(hex, state.falloff) : hex);

  /**
   * The form gradient for a colour: 'round' shades toward the light in both
   * axes; 'cyl' shades across a limb (mostly sideways).
   */
  const formFill = (hex, form = 'round') => {
    const base = fall(hex);
    if (!isHex(base)) return base;
    const raw = S.lightDir();
    const dir = form === 'cyl' ? norm({x: raw.x >= 0 ? 1 : -1, y: raw.y * 0.25}) : norm({x: raw.x, y: raw.y * 0.85});
    const key = `g${form}${base}${dir.x.toFixed(2)}${dir.y.toFixed(2)}`;
    const warm = mix(lightColor, base, cinematic ? 0.2 : 0.12);
    // Cinematic light: warmer highlights, cooler and deeper shadows.
    const shadowInk = cinematic ? '#141a2c' : '#1c1820';
    const id2 = S.def(key, defId => linearGradient(defId, dir, [
      [0, lighten(warm, (cinematic ? 0.26 : 0.2) * k)],
      [0.2, lighten(warm, 0.07 * k)],
      [0.52, base],
      [0.82, darken(base, (cinematic ? 0.34 : 0.24) * k, shadowInk)],
      [1, darken(base, (cinematic ? 0.2 : 0.13) * k, shadowInk)]
    ]));
    return `url(#${id2})`;
  };
  const edge = hex => (isHex(hex) ? darken(fall(hex), 0.5) : '#2a2228');

  /**
   * A rim of light on the lit edge of a piece (cinematic only): a soft wide
   * band and a bright thin line, both the piece's outline shifted away from
   * the light and clipped to the piece, so they hug the lit edge.
   */
  const rim = (d, rule, width = 4) => {
    if (!cinematic) return [];
    const dir = S.lightDir();
    const clip = S.uid('rc');
    const box = pathBox(d);
    const size = Math.min(box.x1 - box.x0, box.y1 - box.y0);
    const w = Math.max(1.2, Math.min(width, size * 0.09));
    const strength = light?.intensity ?? 0.55;
    const tone = mix('#ffffff', lightColor, 0.25);
    const shifted = (k, sw, op) => pathNode(d, {fill: 'none', stroke: tone, strokeWidth: r1(sw), strokeOpacity: r3(op), transform: `translate(${r1(-dir.x * k)} ${r1(-dir.y * k)})`, ...(rule ? {fillRule: rule} : {})});
    return [el('clipPath', clip, null, [pathNode(d, rule ? {clipRule: rule} : {})]), group([
      shifted(w * 1.6, w * 3.2, 0.1 + 0.18 * strength),
      shifted(w * 0.7, w * 1.2, 0.18 + 0.42 * strength)
    ], {clipPath: `url(#${clip})`})];
  };

  /**
   * A shaded piece. o: {form, edge: false, rule, opacity, rim: false, width}
   */
  const piece = (d, hex, o = {}) => {
    const rule = o.rule ? {fillRule: o.rule} : {};
    const nodes = [pathNode(d, {fill: formFill(hex, o.form), ...(o.edge === false ? {} : {stroke: edge(hex), strokeWidth: o.width ?? 1.8, strokeOpacity: 0.6, strokeLinejoin: 'round'}), ...rule})];
    if (o.rim !== false) nodes.push(...rim(d, o.rule, o.rimWidth));
    return nodes.length === 1 && o.opacity === undefined ? nodes[0] : group(nodes, o.opacity !== undefined ? {opacity: o.opacity} : undefined);
  };

  /**
   * Strands of hair over a hair mass: curves that fan out from the crown and
   * fall to the ends, in a darker and a lighter tone with varied weight,
   * clipped to the mass.
   */
  const strands = (d, hex, rule, salt) => {
    const box = pathBox(d);
    const w = box.x1 - box.x0, h = box.y1 - box.y0;
    if (w < 8 || h < 8) return [];
    const clip = S.uid('hc');
    const n = Math.max(8, Math.min(34, Math.round(w / 3.4)));
    const cx = box.x0 + w * 0.5, crown = box.y0 + h * 0.04;
    const layers = ['', '', ''];
    for (let i = 0; i < n; i++) {
      const t = (i + noise(`${salt}t${i}`) * 0.8) / n;
      const endX = box.x0 + t * w;
      const startX = cx + (t - 0.5) * w * 0.22;
      const sag = (noise(`${salt}s${i}`) - 0.5) * w * 0.12;
      const len = 0.55 + noise(`${salt}l${i}`) * 0.45;
      const y1 = crown + h * len;
      const seg = `M${r1(startX)} ${r1(crown)}C${r1(startX + (endX - startX) * 0.7 + sag)} ${r1(crown + h * 0.12)} ${r1(endX + sag * 0.5)} ${r1(crown + h * len * 0.45)} ${r1(endX + sag * 0.2)} ${r1(y1)}`;
      layers[i % 3] += seg;
    }
    const base = fall(hex);
    const lightTone = lighten(base, luma(base) < 0.2 ? 0.3 : 0.22);
    const rr = rule ? {clipRule: rule} : {};
    return [el('clipPath', clip, null, [pathNode(d, rr)]), group([
      strokeLine(layers[0], darken(base, 0.38), 1.5, {strokeOpacity: 0.5}),
      strokeLine(layers[1], darken(base, 0.2), 0.9, {strokeOpacity: 0.5}),
      strokeLine(layers[2], lightTone, 1.1, {strokeOpacity: 0.42})
    ], {clipPath: `url(#${clip})`})];
  };

  const toonFill = name => {
    const hex = col(name);
    return {hex, isHair: name === 'hair' || name === 'stubble'};
  };

  return {
    within,
    defs: S.defs,
    state,
    formFill,
    edge,
    fall,
    piece,
    strands,
    rim,
    lightDir: S.lightDir,
    uid: S.uid,
    def: S.def,
    col,
    // ---- toon pen interface (for scaled toon parts) ----
    shape(d, fill, o = {}) {
      const {hex, isHair} = toonFill(fill);
      if (hex === 'none') {
        const stroke = col(o.stroke ?? 'outline');
        return strokeLine(d, o.stroke && o.stroke !== 'outline' ? fall(stroke) : '#2a2228', (o.width ?? 7) * (o.stroke && o.stroke !== 'outline' ? 1 : 0.5));
      }
      if (o.fillOpacity !== undefined) return pathNode(d, {fill: '#ffffff', fillOpacity: 0.15, stroke: '#25212a', strokeWidth: (o.width ?? 7) * 0.8, ...(o.rule ? {fillRule: o.rule} : {})});
      if (o.outline === false || !isHex(hex)) return pathNode(d, {fill: fall(hex), stroke: 'none', ...(o.opacity !== undefined ? {opacity: o.opacity} : {}), ...(o.rule ? {fillRule: o.rule} : {})});
      const nodes = [piece(d, hex, {rule: o.rule, width: 3, rim: isHair})];
      if (isHair) nodes.push(...strands(d, hex, o.rule, d.length.toString(36)));
      return nodes.length === 1 ? nodes[0] : group(nodes);
    },
    ellipse(cx, cy, rx, ry, fill, o = {}) {
      const {hex, isHair} = toonFill(fill);
      if (o.outline === false || Math.min(rx, ry) < 8 || !isHex(hex)) return el('ellipse', null, null, [], {cx: r1(cx), cy: r1(cy), rx: r1(rx), ry: r1(ry), fill: fall(hex), ...(o.opacity !== undefined ? {opacity: o.opacity} : {}), ...(o.fillOpacity !== undefined ? {fillOpacity: o.fillOpacity, stroke: '#25212a', strokeWidth: 4} : {})});
      const d = ellipsePath(cx, cy, rx, ry);
      const nodes = [piece(d, hex, {width: 3, rim: isHair})];
      if (isHair) nodes.push(...strands(d, hex, null, `e${r1(cx)}${r1(cy)}`));
      return nodes.length === 1 ? nodes[0] : group(nodes);
    },
    line: (d, color, width) => {
      // Strands carry the hair's highlights; the toon shine lines would read as bands.
      if (['hairLight', 'skinLight'].includes(color)) return el('g', null, null, []);
      return strokeLine(d, color === 'outline' ? '#2a2228' : fall(col(color)), width * (color === 'outline' ? 0.7 : 0.9));
    },
    limb(length, width, fill, from = 0, place = null) {
      const hex = col(fill);
      const nodes = [piece(capsulePath(from, length, width), hex, {form: 'cyl', width: 3, rim: fill === 'hair'})];
      if (fill === 'hair') nodes.push(...strands(capsulePath(from, length, width), hex, null, `l${length}${width}`));
      return place ? [placedGroup(nodes, place)] : nodes;
    },
    strand(d, fill, width) {
      const hex = fall(col(fill));
      return [strokeLine(d, darken(hex, 0.35), width + 3), strokeLine(d, hex, width), strokeLine(d, lighten(hex, 0.22), width * 0.3, {strokeOpacity: 0.7})];
    },
    /** Contact shadow, and in cinematic light a long shadow cast away from the light. */
    ground(feetWidth = 150) {
      const contact = S.def('rcontact', defId => radialGradient(defId, {}, [[0, '#000000', 0.42], [0.6, '#000000', 0.16], [1, '#000000', 0]]));
      const out = [el('ellipse', null, null, [], {cx: 0, cy: 3, rx: r1(feetWidth), ry: 16, fill: `url(#${contact})`})];
      if (cinematic) {
        const lx = light?.x ?? -0.57, ly = light?.y ?? -0.82;
        // Lower light throws a longer shadow; the shadow falls away from the light.
        const length = r1(feetWidth * (1.2 + 2.2 * (1 - Math.min(1, Math.abs(ly)))));
        const cast = S.def('rcast', defId => radialGradient(defId, {cx: 0.5, cy: 0.5, r: 0.5}, [[0, '#000000', r3(0.18 + 0.3 * (light?.intensity ?? 0.55))], [0.55, '#000000', r3(0.08 + 0.12 * (light?.intensity ?? 0.55))], [1, '#000000', 0]]));
        out.unshift(el('ellipse', null, null, [], {cx: r1(-Math.sign(lx || -1) * length * 0.55), cy: 6, rx: length, ry: r1(18 + 10 * Math.abs(lx)), fill: `url(#${cast})`}));
      }
      return out;
    }
  };
}

function norm({x, y}) {
  const n = Math.hypot(x, y) || 1;
  return {x: x / n, y: y / n};
}
