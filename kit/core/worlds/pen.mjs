// The world pen: SVG element nodes (kit/core/catalog-b-view.mjs `el`) with
// the active detail level applied, so every world and prop draws through
// one place: outlines on or off, pale fills for line styles, gradients
// collapsing to flat colour at simple detail, and gradient defs collected
// per layer with ids unique to the scene.
//
// Attribute names stay ones both renderers write the same way (the
// HyperFrames serialiser kebab-cases attrs, React takes them camelCase), so
// no gradientTransform, patterns or SVG filters: blur and shadows are CSS
// filters on the layer divs.

import {el} from '../catalog-b-view.mjs';
import {mixColor} from '../catalog-b-base.mjs';
import {seededRandom, hashString} from '../ambient.mjs';

const r1 = v => Math.round(v * 10) / 10;
export const f = r1;

/** Points [[x, y], …] → an SVG path (closed unless open). */
export const pts = (list, open = false) => list.map(([x, y], i) => `${i ? 'L' : 'M'}${r1(x)} ${r1(y)}`).join('') + (open ? '' : 'Z');

/**
 * A pen for one world render. id: the scene id (gradient ids derive from
 * it); detail: detailSpec(); pal: worldPalette(); u: canvas unit (min side /
 * 1080); seed: any string for the scene's deterministic randomness.
 */
export function makePen({id, detail, pal, u, seed}) {
  const defs = {};
  let layer = 'back';
  let count = 0;
  const rand = seededRandom(hashString(String(seed ?? id)));
  const paperTone = mixColor(pal.paper, '#ffffff', 0.5);
  const tone = c => (detail.mono && typeof c === 'string' && c.startsWith('#') ? mixColor(c, paperTone, 0.42) : c);

  const stroke = (o = {}) => {
    if (o.stroke === false || o.glow) return {};
    if (o.stroke) return {stroke: o.stroke === true ? pal.ink : o.stroke, strokeWidth: r1((o.sw ?? 1) * (o.stroke === true || detail.outline ? detail.outlineWidth : 2) * u), strokeLinejoin: 'round', strokeLinecap: 'round'};
    if (!detail.outline || o.thin === false) return {};
    return {stroke: pal.ink, strokeWidth: r1((o.sw ?? 1) * detail.outlineWidth * u), strokeLinejoin: 'round', strokeLinecap: 'round'};
  };
  const common = (o = {}) => ({
    ...(o.opacity !== undefined && o.opacity !== 1 ? {opacity: r1(o.opacity * 100) / 100} : {}),
    ...(o.transform ? {transform: o.transform} : {})
  });
  const fill = (c, o = {}) => (o.glow ? c : tone(c));
  const style = o => (o.blend ? {mixBlendMode: o.blend} : null);

  const pen = {
    detail, pal, u, rand,
    get layer() { return layer; },
    /** Switch the layer that later gradients are defined in. */
    at(name) { layer = name; if (!defs[name]) defs[name] = []; return pen; },
    defsOf(name) { return defs[name] ?? []; },
    /** A random number in [a, b). */
    rnd(a = 0, b = 1) { return a + (b - a) * rand(); },
    pick(list) { return list[Math.floor(rand() * list.length) % list.length]; },
    tone,

    rect(x, y, w, h, c, o = {}) {
      return el('rect', null, style(o), [], {x: r1(x), y: r1(y), width: r1(Math.max(0, w)), height: r1(Math.max(0, h)), fill: fill(c, o), ...(o.rx ? {rx: r1(o.rx)} : {}), ...stroke(o), ...common(o)});
    },
    path(d, c, o = {}) {
      return el('path', null, style(o), [], {d, fill: c ? fill(c, o) : 'none', ...stroke(o), ...common(o)});
    },
    poly(list, c, o = {}) { return pen.path(pts(list), c, o); },
    circle(cx, cy, r, c, o = {}) {
      return el('circle', null, style(o), [], {cx: r1(cx), cy: r1(cy), r: r1(Math.max(0, r)), fill: fill(c, o), ...stroke(o), ...common(o)});
    },
    ellipse(cx, cy, rx, ry, c, o = {}) {
      return el('ellipse', null, style(o), [], {cx: r1(cx), cy: r1(cy), rx: r1(Math.max(0, rx)), ry: r1(Math.max(0, ry)), fill: fill(c, o), ...stroke(o), ...common(o)});
    },
    /** A stroked line (always drawn, outlines or not). */
    line(x1, y1, x2, y2, c, w = 2, o = {}) {
      return el('path', null, style(o), [], {d: `M${r1(x1)} ${r1(y1)}L${r1(x2)} ${r1(y2)}`, fill: 'none', stroke: o.glow ? c : tone(c), strokeWidth: r1(w * u), strokeLinecap: o.cap ?? 'round', ...common(o)});
    },
    /** A stroked open path (always drawn). */
    stroke(d, c, w = 2, o = {}) {
      return el('path', null, style(o), [], {d, fill: 'none', stroke: o.glow ? c : tone(c), strokeWidth: r1(w * u), strokeLinecap: 'round', strokeLinejoin: 'round', ...common(o)});
    },
    g(children, o = {}) {
      const kids = children.flat(Infinity).filter(Boolean);
      return el('g', null, style(o), kids, common(o));
    },

    /**
     * A linear gradient → a fill value. stops: [[offset 0..1, colour,
     * opacity?], …]. Below standard detail it collapses to one colour
     * (stop `flat`, default the middle) unless o.force.
     */
    lin(stops, x1, y1, x2, y2, o = {}) {
      if (!detail.gradients && !o.force) return tone(stops[o.flat ?? Math.floor(stops.length / 2)][1]);
      const gid = `${id}-${layer}-g${count++}`;
      (defs[layer] ??= []).push(el('linearGradient', gid, null, stops.map(([offset, c, a]) => el('stop', null, null, [], {offset: r1(offset * 100) / 100, stopColor: o.glow ? c : tone(c), ...(a === undefined || a === 1 ? {} : {stopOpacity: Math.round(a * 1000) / 1000})})),
        {gradientUnits: 'userSpaceOnUse', x1: r1(x1), y1: r1(y1), x2: r1(x2), y2: r1(y2)}));
      return `url(#${gid})`;
    },
    /** A radial gradient → a fill value (same rules as lin). */
    rad(stops, cx, cy, r, o = {}) {
      if (!detail.gradients && !o.force) return tone(stops[o.flat ?? 0][1]);
      const gid = `${id}-${layer}-g${count++}`;
      (defs[layer] ??= []).push(el('radialGradient', gid, null, stops.map(([offset, c, a]) => el('stop', null, null, [], {offset: r1(offset * 100) / 100, stopColor: o.glow ? c : tone(c), ...(a === undefined || a === 1 ? {} : {stopOpacity: Math.round(a * 1000) / 1000})})),
        {gradientUnits: 'userSpaceOnUse', cx: r1(cx), cy: r1(cy), r: r1(Math.max(1, r))}));
      return `url(#${gid})`;
    },

    /**
     * A soft light glow (lamp halo, neon bloom, window spill): a radial
     * fade from colour to clear. At simple detail it is a faint flat disc
     * of a third the size.
     */
    glow(cx, cy, r, c, alpha = 0.5, o = {}) {
      if (!detail.gradients) return alpha >= 0.3 && !o.soft ? pen.circle(cx, cy, r * 0.32, c, {opacity: alpha * 0.45, glow: true}) : null;
      const fillv = pen.rad([[0, c, alpha], [0.4, c, alpha * 0.45], [1, c, 0]], cx, cy, r, {force: true, glow: true});
      return o.ry ? pen.ellipse(cx, cy, r, o.ry, fillv, {glow: true, blend: o.blend}) : pen.circle(cx, cy, r, fillv, {glow: true, blend: o.blend});
    },
    /** A floor light pool: a flattened glow (standard and rich). */
    pool(cx, cy, rx, ry, c, alpha = 0.35) {
      if (!detail.pools) return null;
      const fillv = pen.rad([[0, c, alpha], [0.5, c, alpha * 0.4], [1, c, 0]], cx, cy, rx, {force: true, glow: true});
      return el('ellipse', null, null, [], {cx: r1(cx), cy: r1(cy), rx: r1(rx), ry: r1(ry), fill: fillv});
    },
    /** A soft contact shadow under an object. */
    shadow(cx, cy, rx, ry, alpha = 1) {
      if (!detail.shadows) return detail.outline ? null : pen.ellipse(cx, cy, rx, ry, pal.shadow, {opacity: pal.shadowAlpha * 0.8 * alpha, stroke: false});
      const fillv = pen.rad([[0, pal.shadow, pal.shadowAlpha * 1.6 * alpha], [0.6, pal.shadow, pal.shadowAlpha * 0.8 * alpha], [1, pal.shadow, 0]], cx, cy, rx, {force: true});
      return el('ellipse', null, null, [], {cx: r1(cx), cy: r1(cy), rx: r1(rx), ry: r1(ry), fill: fillv});
    },
    /**
     * A shading wash over a box (rich detail and soft-shade only): darker
     * on the side away from the light. side: 'left' | 'right' | 'top' |
     * 'bottom' (the shaded side).
     */
    shade(x, y, w, h, side = 'right', alpha = 0.22, o = {}) {
      if (detail.n < 2 && detail.style !== 'soft-shade') return null;
      const [x1, y1, x2, y2] = side === 'left' ? [x + w, y, x, y] : side === 'top' ? [x, y + h, x, y] : side === 'bottom' ? [x, y, x, y + h] : [x, y, x + w, y];
      const fillv = pen.lin([[0, '#000000', 0], [1, o.color ?? pal.shadow, alpha]], x1, y1, x2, y2, {force: true});
      return el('rect', null, null, [], {x: r1(x), y: r1(y), width: r1(w), height: r1(h), fill: fillv, ...(o.rx ? {rx: r1(o.rx)} : {})});
    },
    /** A highlight strip along a top edge (rich detail and soft-shade). */
    sheen(x, y, w, h, alpha = 0.25) {
      if (detail.n < 2 && detail.style !== 'soft-shade') return null;
      return el('rect', null, null, [], {x: r1(x), y: r1(y), width: r1(w), height: r1(h), fill: pen.lin([[0, '#ffffff', alpha], [1, '#ffffff', 0]], x, y, x, y + h, {force: true})});
    }
  };
  pen.at('back');
  return pen;
}
