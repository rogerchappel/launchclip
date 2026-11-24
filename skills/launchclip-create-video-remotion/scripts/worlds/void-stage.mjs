// The void stage: the classic black-and-white stick-figure look with
// 3D-feeling elements. A flat figure stands on an empty floor plane in a
// pure black void (night), a red-backlit void (dusk) or on white paper
// (day), between extruded slabs in one bold red, drawn as flat faces in
// one-point perspective toward a vanishing point above the cast. Depth
// comes from the perspective (floor grid, receding side faces), from
// parallax (far pillars in back, slabs in mid, cropped monoliths at the
// frame edges in front) and from light: a spotlight cone and pool, rim
// light on the lit slab edges, a glossy floor that reflects the red.
//
// The palette is fixed (black, white, one red), whatever the brand: that is
// the look. On a dark stage the cast's ink flips to white (the world's
// grade maps the character outline to paper), so the classic stick figure
// draws white on black with its face in ink on a white head.
//
// Every fill passes {glow: true}: the stage keeps its exact colours and
// gradients at every detail level (no mono toning, no outlines).

import {mixColor} from '../catalog-b-base.mjs';
import {OUTLINE} from '../characters/palette.mjs';
import {pts} from './pen.mjs';
import {span} from './common.mjs';

export const VOID_RED = '#e0262d';
const BLACK = '#050505';
const WHITE = '#f6f4ef';
const G = {glow: true};

/** The stage colours for a time: bg, ink (lines, the cast), red and its faces. */
export function voidColors(time) {
  const paper = time === 'day';
  return {
    paper,
    bg: paper ? WHITE : BLACK,
    ink: paper ? '#111111' : WHITE,
    line: paper ? '#000000' : '#ffffff',
    red: VOID_RED,
    redSide: mixColor('#000000', VOID_RED, paper ? 0.3 : 0.5),
    redTop: mixColor('#ffffff', VOID_RED, 0.22),
    redFar: paper ? mixColor(WHITE, VOID_RED, 0.45) : mixColor(BLACK, VOID_RED, 0.55),
    redFarSide: paper ? mixColor(WHITE, VOID_RED, 0.62) : mixColor(BLACK, VOID_RED, 0.78),
    rim: paper ? '#ffffff' : '#ffd3cf'
  };
}

/** One-point perspective: a point moved t of the way toward the vanishing point. */
const toward = (vp, [x, y], t) => [x + (vp.x - x) * t, y + (vp.y - y) * t];

/**
 * An extruded block: its front face [x0, x1] × [y0, y1] and its back face t
 * of the way toward the vanishing point. Draws the visible side, top or
 * bottom faces, then the front, then a rim of light along the front edge
 * nearest the light (the inner edge, toward the centre).
 */
function block(k, vp, {x0, x1, y0, y1, t, front, side, top = null, rim = null, rimAlpha = 0.85}) {
  const {p} = k;
  const A = [x0, y0], B = [x1, y0], C = [x1, y1], D = [x0, y1];
  const [a, b, c, d] = [A, B, C, D].map(pt => toward(vp, pt, t));
  const out = [];
  // Side faces fade into the dark as they recede.
  const sideFill = (from, to) => p.lin([[0, side], [1, mixColor(BLACK, side, 0.35)]], from[0], from[1], to[0], to[1], {force: true, glow: true});
  if (x1 < vp.x) out.push(p.path(pts([B, b, c, C]), sideFill(B, b), G));
  if (x0 > vp.x) out.push(p.path(pts([A, a, d, D]), sideFill(A, a), G));
  if (y0 > vp.y) out.push(p.path(pts([A, B, b, a]), top ?? side, G));
  if (y1 < vp.y) out.push(p.path(pts([D, C, c, d]), mixColor(BLACK, side, 0.3), G));
  out.push(p.rect(x0, y0, x1 - x0, y1 - y0, front, G));
  if (rim) {
    const rx = x1 < vp.x ? x1 : x0;
    out.push(p.line(rx, y0, rx, y1, rim, 2.4, {glow: true, opacity: rimAlpha, cap: 'butt'}));
    if (y0 > vp.y || x1 < vp.x || x0 > vp.x) out.push(p.line(x0, y0, x1, y0, rim, 1.6, {glow: true, opacity: rimAlpha * 0.6, cap: 'butt'}));
  }
  // A faint shade down the front face (lit from above).
  out.push(p.rect(x0, y0, x1 - x0, y1 - y0, p.lin([[0, '#ffffff', 0.1], [0.4, '#ffffff', 0], [1, '#000000', 0.28]], 0, y0, 0, y1, {force: true, glow: true}), G));
  return out;
}

/** The red of a block mirrored in the glossy floor below it. */
function reflection(k, x0, x1, y1, color, alpha, depth) {
  const {p} = k;
  return p.rect(x0, y1, x1 - x0, depth, p.lin([[0, color, alpha], [1, color, 0]], 0, y1, 0, y1 + depth, {force: true, glow: true}), G);
}

/** A long soft shadow a block casts across the paper floor, away from the light (day). */
function castShadow(k, x0, x1, y1, len) {
  const {p, u} = k;
  const dx = len * 0.9, dy = Math.min(len * 0.18, k.H - y1);
  const poly = [[x0, y1], [x1, y1], [x1 + dx, y1 + dy], [x0 + dx * 0.7, y1 + dy]];
  return p.path(pts(poly), p.lin([[0, '#000000', 0.22], [1, '#000000', 0]], x0, y1, x0 + dx, y1 + dy, {force: true, glow: true}), G);
}

function geometry(k) {
  const {W, H, portrait} = k;
  const vp = {x: W / 2, y: Math.round(H * (portrait ? 0.44 : 0.4))};
  const floorY = Math.round(H * (portrait ? 0.56 : 0.58));
  const groundY = Math.round(H * (portrait ? 0.76 : 0.8));
  const c = voidColors(k.time);
  return {
    vp, floorY, groundY, c,
    anchors: {
      ground: {y: groundY, x0: W * 0.16, x1: W * 0.84, ppm: k.ppm},
      floor: {y: Math.round(floorY + (groundY - floorY) * 0.35), x0: W * 0.22, x1: W * 0.78, ppm: k.ppm * 0.7, layer: 'mid'}
    },
    quiet: {x: Math.round(W * (portrait ? 0.08 : 0.24)), y: Math.round(H * (portrait ? 0.06 : 0.07)), width: Math.round(W * (portrait ? 0.84 : 0.52)), height: Math.round(H * (portrait ? 0.2 : 0.26)),
      under: k.time === 'dusk' ? [c.bg, mixColor(c.bg, VOID_RED, 0.2)] : [c.bg, mixColor(c.bg, c.line, 0.06)]}
  };
}

const voidStage = {
  group: 'outside', label: 'Void stage',
  // Its front slabs stand at the frame edges: they stay when a cast stands on the stage.
  edgeFront: true,
  describe: 'the classic black-and-white stage: a stick figure on an empty floor plane in a black void (night), a red-backlit void (dusk) or white paper (day), between extruded red slabs in perspective, with a spotlight and a glossy floor',
  light: {
    day: {dir: {x: 0.45, y: 0.89}, color: '#ffffff', intensity: 0.85},
    dusk: {dir: {x: 0, y: 1}, color: '#ffd6d2', intensity: 0.6},
    night: {dir: {x: 0, y: 1}, color: '#ffffff', intensity: 0.5}
  },
  /** The cast keeps its colours here (no time grade); on a dark stage its ink turns white. */
  grade(time) {
    const ink = voidColors(time).ink;
    const outline = OUTLINE.toLowerCase();
    return hex => (time !== 'day' && typeof hex === 'string' && hex.toLowerCase() === outline ? ink : hex);
  },
  geo: geometry,
  back(k, g) {
    const {W, H, u, p} = k;
    const {x0, w} = span(k);
    const {vp, c} = g;
    const out = [p.rect(x0, -2, w, H + 4, c.bg, G)];
    // Backlight: a soft glow at the vanishing point (red at dusk).
    const glowC = k.time === 'dusk' ? VOID_RED : c.paper ? '#ffffff' : '#ffffff';
    const glowA = k.time === 'dusk' ? 0.5 : c.paper ? 0.9 : 0.1;
    out.push(p.rect(x0, -2, w, H + 4, p.rad([[0, glowC, glowA], [0.55, glowC, glowA * 0.3], [1, glowC, 0]], vp.x, vp.y, W * 0.55, {force: true, glow: true}), G));
    // A far doorway frame round the vanishing point: the void has a back.
    const fw = W * (k.portrait ? 0.34 : 0.2), fh = H * (k.portrait ? 0.2 : 0.3);
    const fx = vp.x - fw / 2, fy = g.floorY - fh;
    const bar = 10 * u;
    out.push(p.path(`M${fx} ${fy}h${fw}v${fh}h${-bar}v${-(fh - bar)}h${-(fw - 2 * bar)}v${fh - bar}h${-bar}Z`, c.redFar, G));
    // Far pillars, dimmed by the distance (atmospheric perspective).
    const far = k.portrait ? [0.16, 0.3, 0.7, 0.84] : [0.27, 0.35, 0.65, 0.73];
    for (const fxr of far) {
      const pw = W * (k.portrait ? 0.05 : 0.028);
      const px = W * fxr - pw / 2;
      out.push(block(k, vp, {x0: px, x1: px + pw, y0: H * (k.portrait ? 0.3 : 0.22), y1: g.floorY + 6 * u, t: 0.18, front: c.redFar, side: c.redFarSide}));
    }
    return out;
  },
  mid(k, g) {
    const {W, H, u, p} = k;
    const {x0, x1, w} = span(k);
    const {vp, c, floorY, groundY} = g;
    const out = [];
    // The floor plane: perspective lines to the vanishing point and depth rows.
    const lineA = c.paper ? 0.1 : 0.16;
    const t0 = (floorY - vp.y) / (H - vp.y);
    for (let i = -14; i <= 14; i++) {
      const xb = vp.x + i * 190 * u;
      out.push(p.line(vp.x + (xb - vp.x) * t0, floorY, xb, H, c.line, 1.4, {glow: true, opacity: lineA}));
    }
    for (let n = 1; n < 12; n++) {
      const y = vp.y + (floorY - vp.y) / (1 - n * 0.075);
      if (y > H) break;
      out.push(p.line(x0, y, x1, y, c.line, 1.2, {glow: true, opacity: lineA * 0.9}));
    }
    // The floor fades into the void toward the back.
    out.push(p.rect(x0, floorY - 2, w, (groundY - floorY) * 0.9, p.lin([[0, c.bg, 1], [1, c.bg, 0]], 0, floorY - 2, 0, floorY + (groundY - floorY) * 0.9, {force: true, glow: true}), G));
    // Mid slabs: a tall pillar on one side, a low step on the other.
    const L = k.portrait
      ? {x0: W * 0.04, x1: W * 0.16, y0: H * 0.26, y1: H * 0.66}
      : {x0: W * 0.1, x1: W * 0.165, y0: H * 0.16, y1: H * 0.7};
    const R = k.portrait
      ? {x0: W * 0.74, x1: W * 0.94, y0: H * 0.6, y1: H * 0.67}
      : {x0: W * 0.77, x1: W * 0.9, y0: H * 0.55, y1: H * 0.7};
    for (const b of [L, R]) {
      out.push(reflection(k, b.x0, b.x1, b.y1, c.red, c.paper ? 0.12 : 0.22, 90 * u));
      if (c.paper) out.push(castShadow(k, b.x0, b.x1, b.y1, (b.y1 - b.y0) * 1.2));
      out.push(block(k, vp, {...b, t: 0.12, front: c.red, side: c.redSide, top: c.redTop, rim: c.rim, rimAlpha: 0.7}));
    }
    // The red ground line the cast stands on: bright in the middle, gone at the ends.
    out.push(p.rect(x0, groundY + 2 * u, w, 5 * u, p.lin([[0, VOID_RED, 0], [0.3, VOID_RED, 0.9], [0.7, VOID_RED, 0.9], [1, VOID_RED, 0]], x0, 0, x1, 0, {force: true, glow: true}), G));
    return out;
  },
  front(k, g) {
    const {W, H, p} = k;
    const {vp, c} = g;
    const {x0, x1} = span(k);
    // Monoliths cropped by the frame edges: the nearest red, the deepest side faces.
    const edgeW = W * (k.portrait ? 0.06 : 0.05);
    const out = [];
    for (const [a, b] of [[x0 - 4, edgeW], [W - edgeW, x1 + 4]]) {
      out.push(reflection(k, a, b, H * 0.9, c.red, c.paper ? 0.1 : 0.2, H * 0.1));
      out.push(block(k, vp, {x0: a, x1: b, y0: H * (k.portrait ? 0.16 : 0.06), y1: H * 0.9, t: 0.1, front: c.red, side: c.redSide, rim: c.rim}));
    }
    return out;
  },
  fx(k, g) {
    const {W, H, u, p} = k;
    const {c, groundY} = g;
    const out = [];
    // The spotlight: a cone from above and its pool on the floor.
    const coneA = c.paper ? 0.05 : k.time === 'dusk' ? 0.1 : 0.14;
    const spread = W * (k.portrait ? 0.36 : 0.2);
    out.push(p.path(pts([[W / 2 - 50 * u, -10], [W / 2 + 50 * u, -10], [W / 2 + spread, groundY], [W / 2 - spread, groundY]]),
      p.lin([[0, '#ffffff', coneA], [1, '#ffffff', coneA * 0.25]], 0, 0, 0, groundY, {force: true, glow: true}), {glow: true, blend: c.paper ? undefined : 'screen'}));
    out.push(p.ellipse(W / 2, groundY, spread * 1.15, 70 * u, p.rad([[0, c.paper ? '#000000' : '#ffffff', c.paper ? 0.1 : 0.22], [1, c.paper ? '#000000' : '#ffffff', 0]], W / 2, groundY, spread * 1.15, {force: true, glow: true}), G));
    // Vignette: the void closes in at the corners.
    out.push(p.rect(-2, -2, W + 4, H + 4, p.rad([[0, c.bg, 0], [0.62, c.bg, 0], [1, c.bg, c.paper ? 0.5 : 0.75]], W / 2, H / 2, Math.hypot(W, H) / 2, {force: true, glow: true}), G));
    return out;
  }
};

export const VOID = {'void-stage': voidStage};
