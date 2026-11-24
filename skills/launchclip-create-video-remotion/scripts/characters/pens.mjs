// Helpers shared by the toon pens (toon.mjs): colour maths, the light in a
// part's own frame, unique ids for gradients and clips, capsule outlines and
// deterministic noise. Everything is plain SVG (paths, ellipses, linear and
// radial gradients in object-bounding-box units, clip paths), so HyperFrames
// and Remotion draw it the same way.
//
// Imports only sibling kit/core files.

import {el} from '../catalog-b-view.mjs';
import {mixColor} from '../catalog-b-base.mjs';

export const r1 = value => Math.round(value * 10) / 10;
export const r3 = value => Math.round(value * 1000) / 1000;
const HEX6 = /^#[0-9a-fA-F]{6}$/;

export const isHex = value => typeof value === 'string' && HEX6.test(value);
export const mix = (toward, hex, amount) => (isHex(hex) && isHex(toward) ? mixColor(toward, hex, amount) : hex);
export const darken = (hex, amount, ink = '#1c1820') => mix(ink, hex, amount);
export const lighten = (hex, amount) => mix('#ffffff', hex, amount);

/** Relative luminance 0..1 of a hex colour (sRGB, no gamma; enough to sort light from dark). */
export function luma(hex) {
  if (!isHex(hex)) return 0.5;
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

/** A colour resolver over the character's colour keys: names → hex, hex and 'none' pass through. */
export const resolver = c => name => (name === null || name === undefined ? 'none' : c[name] ?? name);

/**
 * Pen state: the mirror flag of the frame being drawn (the right limbs are
 * drawn mirrored, so the light's x flips there), a counter for unique ids,
 * and the defs (gradients) gathered while drawing.
 */
export function penState(id, light) {
  const state = {mirror: false, n: 0, defs: new Map(), light: light ?? {x: -0.57, y: -0.82, intensity: 0.55, color: '#fff1dc', dir: 125}};
  return {
    state,
    within(next, draw) {
      const before = state.mirror;
      if (next && next.mirror !== undefined) state.mirror = next.mirror;
      try { return draw(); } finally { state.mirror = before; }
    },
    /** The light's direction (toward the light) in the current frame. */
    lightDir: () => ({x: state.light.x * (state.mirror ? -1 : 1), y: state.light.y}),
    uid: kind => `${id}-${kind}${(state.n++).toString(36)}`,
    /** A def (gradient) under a stable key, added once. → its id. */
    def(key, build) {
      if (!state.defs.has(key)) {
        const defId = `${id}-${kind(key)}${state.defs.size.toString(36)}`;
        state.defs.set(key, {id: defId, node: build(defId)});
      }
      return state.defs.get(key).id;
    },
    defs: () => (state.defs.size ? [el('defs', null, null, [...state.defs.values()].map(entry => entry.node))] : [])
  };
}
const kind = key => (String(key).startsWith('r') ? 'r' : 'g');

/**
 * A linear gradient in bounding-box units across a shape, from its lit side
 * (toward the light) to its shaded side. stops: [[offset, hex, opacity?]].
 */
export function linearGradient(defId, dir, stops) {
  const x1 = r3(0.5 + 0.5 * dir.x), y1 = r3(0.5 + 0.5 * dir.y), x2 = r3(0.5 - 0.5 * dir.x), y2 = r3(0.5 - 0.5 * dir.y);
  return el('linearGradient', defId, null, stops.map(([offset, color, opacity]) => el('stop', null, null, [], {offset, stopColor: color, ...(opacity !== undefined ? {stopOpacity: opacity} : {})})), {x1, y1, x2, y2});
}

/** A radial gradient in bounding-box units centred at (cx, cy) with radius r (fractions). */
export function radialGradient(defId, {cx = 0.5, cy = 0.5, r = 0.5, fx, fy}, stops) {
  return el('radialGradient', defId, null, stops.map(([offset, color, opacity]) => el('stop', null, null, [], {offset, stopColor: color, ...(opacity !== undefined ? {stopOpacity: opacity} : {})})), {cx: r3(cx), cy: r3(cy), r: r3(r), ...(fx !== undefined ? {fx: r3(fx), fy: r3(fy)} : {})});
}

/** A round-capped capsule outline from (0, from) to (0, to), `width` wide. */
export function capsulePath(from, to, width) {
  const r = width / 2, k = r * 0.5523;
  return `M${r1(-r)} ${r1(from)}L${r1(-r)} ${r1(to)}C${r1(-r)} ${r1(to + k)} ${r1(-k)} ${r1(to + r)} 0 ${r1(to + r)}C${r1(k)} ${r1(to + r)} ${r1(r)} ${r1(to + k)} ${r1(r)} ${r1(to)}L${r1(r)} ${r1(from)}C${r1(r)} ${r1(from - k)} ${r1(k)} ${r1(from - r)} 0 ${r1(from - r)}C${r1(-k)} ${r1(from - r)} ${r1(-r)} ${r1(from - k)} ${r1(-r)} ${r1(from)}Z`;
}

/** The numbers of a path, as [x, y] pairs. */
export const pathPairs = d => {
  const n = (d.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
  const out = [];
  for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i], n[i + 1]]);
  return out;
};

/** Bounding box {x0, y0, x1, y1} of a path's points. */
export function pathBox(d) {
  const pairs = pathPairs(d);
  const xs = pairs.map(p => p[0]), ys = pairs.map(p => p[1]);
  return {x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys)};
}

/** A deterministic hash in [0, 1) of a string. */
export function noise(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return (h >>> 0) / 4294967296;
}

/** The path with every coordinate nudged by up to ±amount (a hand-cut edge), the same every time. */
export function jitter(d, amount, salt = '') {
  let i = 0;
  return d.replace(/-?\d*\.?\d+/g, value => r1(Number(value) + (noise(`${salt}:${i++}:${value}`) - 0.5) * 2 * amount));
}

/** An ellipse as a closed cubic path (for pens that cut, clip or jitter it). */
export function ellipsePath(cx, cy, rx, ry) {
  const kx = rx * 0.5523, ky = ry * 0.5523;
  return `M${r1(cx - rx)} ${r1(cy)}C${r1(cx - rx)} ${r1(cy - ky)} ${r1(cx - kx)} ${r1(cy - ry)} ${r1(cx)} ${r1(cy - ry)}C${r1(cx + kx)} ${r1(cy - ry)} ${r1(cx + rx)} ${r1(cy - ky)} ${r1(cx + rx)} ${r1(cy)}C${r1(cx + rx)} ${r1(cy + ky)} ${r1(cx + kx)} ${r1(cy + ry)} ${r1(cx)} ${r1(cy + ry)}C${r1(cx - kx)} ${r1(cy + ry)} ${r1(cx - rx)} ${r1(cy + ky)} ${r1(cx - rx)} ${r1(cy)}Z`;
}

export const group = (children, attrs) => el('g', null, null, children, attrs);
export const placedGroup = (nodes, {at = [0, 0], angle = 0}) => group(nodes, {transform: `translate(${r1(at[0])} ${r1(at[1])})${angle ? ` rotate(${r1(angle)})` : ''}`});
export const pathNode = (d, attrs) => el('path', null, null, [], {d, ...attrs});
export const strokeLine = (d, color, width, extra = {}) => pathNode(d, {fill: 'none', stroke: color, strokeWidth: width, strokeLinecap: 'round', strokeLinejoin: 'round', ...extra});

/** n + 1 points along the cubic p0 → p3 (control points p1, p2), each [x, y]. */
export function cubicPoints(p0, p1, p2, p3, n = 12) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]);
  }
  return out;
}

const smooth = t => t * t * (3 - 2 * t);

/**
 * A pressure ink stroke along points [[x, y], …]: a filled ribbon (one
 * absolute M/L path, so bounds.mjs reads it) `width` wide at full pressure,
 * thinning to `tip` of it over the first and last `taper` shares of its
 * length ([start, end]; 0 keeps that end full, for a joint), with round
 * ends and an uneven pressure of ±`wobble` along it. The unevenness comes
 * from `seed` alone, so every render and both renderers draw the same stroke.
 */
export function pressureStroke(points, width, color, {seed = '', taper = [0.3, 0.3], tip = 0.3, wobble = 0.14} = {}) {
  const n = points.length - 1;
  const knots = [0, 1, 2, 3, 4].map(i => (noise(`${seed}:p${i}`) - 0.5) * 2);
  const halfAt = i => {
    const t = i / n, k = t * 4, i0 = Math.min(3, Math.floor(k));
    const pressure = 1 + wobble * (knots[i0] + (knots[i0 + 1] - knots[i0]) * smooth(k - i0));
    const a = taper[0] > 0 ? smooth(Math.min(1, t / taper[0])) : 1, b = taper[1] > 0 ? smooth(Math.min(1, (1 - t) / taper[1])) : 1;
    return width / 2 * pressure * (tip + (1 - tip) * a * b);
  };
  const left = [], right = [], normals = [];
  for (let i = 0; i <= n; i++) {
    const [x0, y0] = points[Math.max(0, i - 1)], [x1, y1] = points[Math.min(n, i + 1)];
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const nx = -(y1 - y0) / len, ny = (x1 - x0) / len, h = halfAt(i);
    normals.push([nx, ny]);
    left.push([points[i][0] + nx * h, points[i][1] + ny * h]);
    right.push([points[i][0] - nx * h, points[i][1] - ny * h]);
  }
  // A round end: a half circle round the end point, from the side `from` (+1 left, -1 right) to the other.
  const cap = (i, from) => {
    const [cx, cy] = points[i], h = halfAt(i), a0 = Math.atan2(from * normals[i][1], from * normals[i][0]);
    return [1, 2, 3].map(s => [cx + Math.cos(a0 - s * Math.PI / 4) * h, cy + Math.sin(a0 - s * Math.PI / 4) * h]);
  };
  const ring = [...left, ...cap(n, 1), ...right.reverse(), ...cap(0, -1)];
  return pathNode(ring.map(([x, y], i) => `${i ? 'L' : 'M'}${r1(x)} ${r1(y)}`).join('') + 'Z', {fill: color, stroke: 'none'});
}
