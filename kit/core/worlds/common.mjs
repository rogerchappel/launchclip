// Shared world pieces: skies (sun, moon, stars, clouds), distant hills and
// skylines, interior walls, floors and windows that look outside, street
// lamps, trees, and the light effects (haze, rays, pools, glows).
//
// Every piece takes the world kit k = {W, H, u, ov, p, pal, time, d,
// portrait}: canvas size, unit (min side / 1080), the overscan each layer
// is drawn past the canvas edges (so a camera move never shows an edge),
// the pen, the palette, the time and the detail spec. Pieces return node
// arrays; nothing here reads the clock, so a world is a pure drawing.

import {mixColor} from '../catalog-b-base.mjs';
import {f, pts} from './pen.mjs';

const lerp = (a, b, t) => a + (b - a) * t;

/** x span every full-width piece covers. */
export const span = k => ({x0: -k.ov, x1: k.W + k.ov, w: k.W + 2 * k.ov});

// ---------------------------------------------------------------------------
// Sky

/** Where the sun or moon sits for the time (matches palette timeLight). */
export function skyBody(k, horizon) {
  const {W, H, time} = k;
  if (time === 'day') return {x: W * 0.2, y: Math.min(horizon * 0.34, H * 0.16), r: 46 * k.u};
  if (time === 'dusk') return {x: W * 0.16, y: horizon - 30 * k.u, r: 80 * k.u};
  return {x: W * 0.8, y: Math.min(horizon * 0.32, H * 0.15), r: 38 * k.u};
}

/** A full sky down to the horizon (and a little past it). */
export function sky(k, horizon, {clouds = true, body = true, stars = true, top = 0} = {}) {
  const {p, pal, u, time, d} = k;
  const {x0, w} = span(k);
  const out = [];
  const grad = p.lin(time === 'dusk'
    ? [[0, pal.skyTop], [0.55, pal.skyMid], [0.86, pal.skyLow], [1, mixColor('#ffe2a8', pal.skyLow, 0.5)]]
    : [[0, pal.skyTop], [0.6, pal.skyMid], [1, pal.skyLow]], 0, top, 0, horizon, {force: true});
  out.push(p.rect(x0, top - 2, w, horizon - top + 40 * u, grad, {stroke: false}));
  if (time === 'night' && stars) out.push(...starField(k, top, horizon * 0.85));
  if (body) out.push(...skyBodyNodes(k, horizon));
  if (time === 'dusk' && d.n >= 1) {
    // Low warm streaks of thin cloud across the sunset.
    for (let i = 0; i < 4; i++) {
      const y = horizon - (40 + i * 42 + p.rnd(0, 18)) * u;
      const cx = p.rnd(0.1, 0.9) * k.W, rx = p.rnd(180, 420) * u;
      out.push(p.ellipse(cx, y, rx, p.rnd(5, 9) * u, mixColor('#ffd2a0', pal.skyMid, 0.55), {opacity: 0.7, stroke: false}));
    }
  }
  if (clouds) out.push(...cloudBank(k, top + (horizon - top) * 0.22, horizon - top));
  return out;
}

export function skyBodyNodes(k, horizon) {
  const {p, pal, u, time, d} = k;
  const b = skyBody(k, horizon);
  const out = [];
  if (time === 'day') {
    out.push(p.glow(b.x, b.y, b.r * 7, '#fff6d8', 0.55));
    out.push(p.circle(b.x, b.y, b.r, pal.sun, {glow: true}));
  } else if (time === 'dusk') {
    out.push(p.glow(b.x, b.y, b.r * 9, '#ffb25a', 0.6));
    out.push(p.glow(b.x, b.y, b.r * 3.2, '#ffd890', 0.7));
    out.push(p.circle(b.x, b.y, b.r, pal.sun, {glow: true}));
  } else {
    out.push(p.glow(b.x, b.y, b.r * 6, '#b8c8ff', 0.28));
    out.push(p.circle(b.x, b.y, b.r, pal.moon, {glow: true}));
    if (d.n >= 1) {
      out.push(p.circle(b.x - b.r * 0.3, b.y - b.r * 0.2, b.r * 0.22, '#d6dcef', {glow: true, opacity: 0.8}));
      out.push(p.circle(b.x + b.r * 0.32, b.y + b.r * 0.3, b.r * 0.15, '#d6dcef', {glow: true, opacity: 0.8}));
      out.push(p.circle(b.x + b.r * 0.1, b.y - b.r * 0.45, b.r * 0.1, '#d6dcef', {glow: true, opacity: 0.7}));
    }
  }
  return out;
}

export function starField(k, top, bottom) {
  const {p, u, d} = k;
  const {x0, w} = span(k);
  const count = Math.round([45, 110, 170][d.n] * (k.W * k.H) / (1920 * 1080));
  const out = [];
  for (let i = 0; i < count; i++) {
    const x = x0 + p.rnd() * w, y = lerp(top, bottom, Math.pow(p.rnd(), 1.4));
    const r = p.rnd(0.8, 2.2) * u * (p.rnd() > 0.93 ? 1.7 : 1);
    out.push(p.circle(x, y, r, '#f3f5ff', {glow: true, opacity: p.rnd(0.45, 1)}));
  }
  return out;
}

/** One puffy cloud, its centre at (cx, cy), width w. */
export function cloud(k, cx, cy, w, {color = null, under = null, opacity = 1} = {}) {
  const {p, pal, d} = k;
  const top = color ?? pal.cloud;
  const shade = under ?? (k.time === 'dusk' ? mixColor('#e0708a', top, 0.5) : mixColor(pal.skyMid, top, 0.32));
  const h = w * 0.3;
  const bumps = [[-0.32, 0.1, 0.2], [-0.12, -0.12, 0.26], [0.12, -0.05, 0.24], [0.32, 0.12, 0.18], [0, 0.12, 0.28]];
  const kids = [];
  if (d.n >= 1) kids.push(p.ellipse(cx, cy + h * 0.32, w * 0.46, h * 0.36, shade, {stroke: false}));
  for (const [dx, dy, r] of bumps) kids.push(p.circle(cx + dx * w, cy + dy * h * 2, r * w, top, {stroke: false}));
  kids.push(p.rect(cx - w * 0.44, cy + h * 0.05, w * 0.88, h * 0.42, top, {rx: h * 0.2, stroke: false}));
  if (d.outline) kids.push(p.path(`M${f(cx - w * 0.44)} ${f(cy + h * 0.47)}L${f(cx + w * 0.44)} ${f(cy + h * 0.47)}`, null, {}));
  return p.g(kids, {opacity});
}

export function cloudBank(k, y, depth) {
  const {p, u, time} = k;
  const count = time === 'night' ? 2 : 4;
  const out = [];
  for (let i = 0; i < count; i++) {
    const cx = lerp(-0.05, 1.05, (i + p.rnd(0.1, 0.8)) / count) * k.W;
    const cy = y + p.rnd(-0.2, 0.35) * depth * 0.5;
    out.push(cloud(k, cx, cy, p.rnd(170, 300) * u, {opacity: time === 'night' ? 0.32 : p.rnd(0.82, 1)}));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Distance

/** A soft ridge of hills from baseY up by amp, filled to the bottom. */
export function hills(k, baseY, amp, color, {bottom = null, bumps = 5, phase = 0} = {}) {
  const {p} = k;
  const {x0, x1} = span(k);
  const n = bumps * 2;
  const pts2 = [];
  for (let i = 0; i <= n; i++) {
    const x = lerp(x0, x1, i / n);
    const y = baseY - amp * (0.55 + 0.45 * Math.sin(i * 1.7 + phase + p.rnd(0, 0.8)));
    pts2.push([x, y]);
  }
  let dpath = `M${f(x0)} ${f(bottom ?? k.H)}L${f(pts2[0][0])} ${f(pts2[0][1])}`;
  for (let i = 1; i < pts2.length; i++) {
    const [px, py] = pts2[i - 1], [x, y] = pts2[i];
    dpath += `Q${f((px + x) / 2)} ${f(Math.min(py, y) - amp * 0.2)} ${f(x)} ${f(y)}`;
  }
  dpath += `L${f(x1)} ${f(bottom ?? k.H)}Z`;
  return p.path(dpath, color, {stroke: k.d.outline ? true : false, sw: 0.7});
}

/**
 * A run of buildings along baseY: heights between minH and maxH, lit
 * windows at night and dusk (windows: window density 0..1), roof details.
 */
export function skyline(k, baseY, {minH, maxH, color, windows = 0.5, minW = 60, maxW = 150, roofs = true, litColor = null, gap = 0} = {}) {
  const {p, pal, u, time, d} = k;
  const {x0, x1} = span(k);
  const out = [];
  const lit = litColor ?? pal.lit;
  let x = x0 - p.rnd(0, 40) * u;
  while (x < x1) {
    const w = p.rnd(minW, maxW) * u, h = p.rnd(minH, maxH);
    const top = baseY - h;
    out.push(p.rect(x, top, w + 1, h + 2, color, {stroke: d.outline ? true : false, sw: 0.6}));
    if (roofs && p.rnd() < 0.35) {
      const ax = x + w * p.rnd(0.2, 0.8);
      out.push(p.line(ax, top, ax, top - p.rnd(16, 46) * u, color, 2.4));
      if (time === 'night' && p.rnd() < 0.5) out.push(p.circle(ax, top - 46 * u, 2.4 * u, '#ff5a5a', {glow: true}));
    } else if (roofs && p.rnd() < 0.2) {
      out.push(p.rect(x + w * 0.2, top - 14 * u, w * 0.3, 14 * u, color, {stroke: false}));
    }
    if (windows > 0 && w > 30 * u && h > 40 * u) {
      const cell = 13 * u * (maxW > 110 ? 1.15 : 1);
      const cols = Math.max(1, Math.floor((w - 10 * u) / (cell * 1.8))), rows = Math.max(1, Math.floor((h - 18 * u) / (cell * 2)));
      const prob = time === 'night' ? windows * 0.6 : time === 'dusk' ? windows * 0.34 : 0;
      const dayGlass = mixColor(pal.skyLow, color, 0.18);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const on = p.rnd() < prob;
        if (time === 'day' && (p.rnd() > windows * 0.7)) continue;
        if (time !== 'day' && !on && p.rnd() > 0.4) continue;
        const wx = x + 8 * u + c * ((w - 16 * u) / cols), wy = top + 12 * u + r * cell * 2;
        out.push(p.rect(wx, wy, cell * 0.95, cell * 1.1, on ? lit : time === 'day' ? dayGlass : mixColor('#000000', color, 0.18), {glow: on, stroke: false, opacity: on ? p.rnd(0.7, 1) : 0.8}));
      }
    }
    x += w + gap * u;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Interiors

/** A wall from 0 to floorY with a skirting board; optional dado rail. */
export function wall(k, floorY, {color = null, shade = null, dado = false, stripes = false, panel = false} = {}) {
  const {p, pal, u, d, H} = k;
  const {x0, w} = span(k);
  const c = color ?? pal.wall;
  const out = [p.rect(x0, -2, w, floorY + 4, p.lin([[0, mixColor('#000000', c, 0.06)], [0.75, c], [1, shade ?? pal.wallShade]], 0, 0, 0, floorY), {stroke: false})];
  if (stripes && d.n >= 1) {
    for (let x = x0; x < x0 + w; x += 64 * u) out.push(p.rect(x, 0, 30 * u, floorY, mixColor('#ffffff', c, 0.05), {stroke: false, opacity: 0.6}));
  }
  if (dado) {
    const dy = floorY - Math.min(260 * u, H * 0.18);
    out.push(p.rect(x0, dy, w, floorY - dy, mixColor('#000000', shade ?? pal.wallShade, 0.05), {stroke: false}));
    out.push(p.rect(x0, dy - 6 * u, w, 12 * u, pal.trim, {stroke: d.outline ? true : false, sw: 0.6}));
    if (panel && d.n >= 1) for (let x = x0 + 30 * u; x < x0 + w; x += 220 * u) out.push(p.rect(x, dy + 26 * u, 170 * u, floorY - dy - 60 * u, 'none', {stroke: mixColor('#000000', pal.wallShade, 0.12), sw: 1.5, rx: 4 * u}));
  }
  out.push(p.rect(x0, floorY - 20 * u, w, 22 * u, pal.trim, {stroke: d.outline ? true : false, sw: 0.6}));
  return out;
}

/** A floor from floorY to the bottom: wood planks, tiles, carpet or concrete. */
export function floor(k, floorY, {kind = 'wood', color = null} = {}) {
  const {p, pal, u, H, d} = k;
  const {x0, x1, w} = span(k);
  const base = color ?? (kind === 'wood' ? pal.wood : kind === 'tile' ? pal.cream : kind === 'concrete' ? pal.concrete : pal.floor);
  const out = [p.rect(x0, floorY, w, H - floorY + 4, p.lin([[0, mixColor('#000000', base, 0.14)], [0.25, base], [1, mixColor('#000000', base, 0.2)]], 0, floorY, 0, H), {stroke: false})];
  const lineC = mixColor('#000000', base, 0.22);
  if (kind === 'wood') {
    // Planks: rows grow toward the viewer; staggered joints.
    let y = floorY, gap = 16 * u, row = 0;
    while (y < H) {
      out.push(p.line(x0, y, x1, y, lineC, 1.6, {opacity: 0.7}));
      if (d.n >= 1) for (let x = x0 + ((row * 173) % 260) * u; x < x1; x += 260 * u) out.push(p.line(x, y, x, y + gap, lineC, 1.4, {opacity: 0.55}));
      y += gap; gap *= 1.32; row++;
    }
  } else if (kind === 'tile') {
    let y = floorY, gap = 22 * u;
    while (y < H) { out.push(p.line(x0, y, x1, y, lineC, 1.4, {opacity: 0.5})); y += gap; gap *= 1.3; }
    const cx = k.W / 2;
    for (let i = -14; i <= 14; i++) out.push(p.line(cx + i * 60 * u, floorY, cx + i * 160 * u, H, lineC, 1.4, {opacity: 0.45}));
  } else if (kind === 'concrete' && d.n >= 1) {
    for (let x = x0 + 200 * u; x < x1; x += 420 * u) out.push(p.line(x, floorY, x - 60 * u, H, lineC, 1.6, {opacity: 0.4}));
  } else if (kind === 'carpet' && d.n >= 1) {
    out.push(p.rect(x0, floorY, w, 6 * u, mixColor('#000000', base, 0.2), {stroke: false, opacity: 0.6}));
  }
  return out;
}

/**
 * A window in a wall, showing outside at the time: sky, a distant skyline
 * or hills, the sun or moon; mullions and a sill. view: 'city' | 'trees'.
 */
export function interiorWindow(k, x, y, w, h, {view = 'city', cols = 2, rows = 2, frame = null, blinds = false} = {}) {
  const {p, pal, u, time, d} = k;
  const fr = frame ?? pal.trim;
  const out = [];
  const glass = p.lin([[0, pal.view], [1, pal.viewLow]], 0, y, 0, y + h, {force: true});
  out.push(p.rect(x, y, w, h, glass, {stroke: false}));
  // The view: distant skyline or trees, lit at night.
  const vy = y + h * 0.72;
  if (view === 'city') {
    let bx = x;
    while (bx < x + w) {
      const bw = p.rnd(0.08, 0.18) * w, bh = p.rnd(0.18, 0.55) * h;
      const c = time === 'night' ? '#141c3e' : time === 'dusk' ? mixColor('#6f3c5e', pal.view, 0.6) : mixColor('#7f9fbf', pal.viewLow, 0.55);
      out.push(p.rect(bx, vy - bh + h * 0.28, Math.min(bw, x + w - bx), bh, c, {stroke: false}));
      if (time !== 'day') for (let i = 0; i < 6; i++) if (p.rnd() < (time === 'night' ? 0.7 : 0.3)) out.push(p.rect(bx + p.rnd(0.1, 0.8) * bw, vy - bh + h * 0.28 + p.rnd(0.1, 0.8) * bh, 4 * u, 5 * u, pal.lit, {glow: true, stroke: false}));
      bx += bw;
    }
  } else {
    const c = time === 'night' ? '#0f1a2c' : time === 'dusk' ? mixColor('#6a4a50', pal.view, 0.5) : mixColor('#6fa36a', pal.viewLow, 0.75);
    for (let i = 0; i < 5; i++) out.push(p.circle(x + (i + 0.5) * w / 5, vy + p.rnd(-0.05, 0.08) * h, p.rnd(0.12, 0.2) * w, c, {stroke: false}));
    out.push(p.rect(x, vy + h * 0.04, w, h * 0.24, c, {stroke: false}));
  }
  if (time === 'night') {
    out.push(p.circle(x + w * 0.74, y + h * 0.2, Math.min(w, h) * 0.06, pal.moon, {glow: true}));
    for (let i = 0; i < 8; i++) out.push(p.circle(x + p.rnd(0.05, 0.95) * w, y + p.rnd(0.05, 0.4) * h, 1.4 * u, '#ffffff', {glow: true, opacity: p.rnd(0.5, 1)}));
  } else if (time === 'dusk') {
    out.push(p.circle(x + w * 0.3, y + h * 0.62, Math.min(w, h) * 0.12, '#ffd28a', {glow: true}));
  }
  // Glass sheen.
  if (d.n >= 1) out.push(p.path(pts([[x + w * 0.12, y + h], [x + w * 0.42, y], [x + w * 0.56, y], [x + w * 0.26, y + h]]), '#ffffff', {opacity: time === 'night' ? 0.04 : 0.12, stroke: false}));
  if (blinds) for (let i = 0; i < 9; i++) out.push(p.rect(x, y + i * h * 0.06, w, h * 0.035, mixColor('#ffffff', fr, 0.3), {stroke: false, opacity: 0.92}));
  // Frame, mullions, sill.
  const t = 12 * u;
  out.push(p.path(`M${f(x - t / 2)} ${f(y - t / 2)}H${f(x + w + t / 2)}V${f(y + h + t / 2)}H${f(x - t / 2)}Z`, null, {stroke: fr, sw: 6}));
  for (let c = 1; c < cols; c++) out.push(p.rect(x + w * c / cols - t * 0.35, y, t * 0.7, h, fr, {stroke: false}));
  for (let r = 1; r < rows; r++) out.push(p.rect(x, y + h * r / rows - t * 0.35, w, t * 0.7, fr, {stroke: false}));
  out.push(p.rect(x - t * 2, y + h + t * 0.4, w + t * 4, t * 1.4, fr, {rx: 3 * u}));
  if (d.n >= 1) out.push(p.rect(x - t * 2, y + h + t * 1.8, w + t * 4, t * 0.6, mixColor('#000000', fr, 0.25), {stroke: false, opacity: 0.6}));
  return out;
}

/**
 * Daylight through a window onto the floor: a slanted beam (standard and
 * rich, day and dusk). Returns fx nodes (screen blended).
 */
export function windowBeam(k, x, y, w, h, floorY) {
  const {p, u, time, d} = k;
  if (time === 'night' || d.n < 1) return [];
  const c = time === 'dusk' ? '#ffb36a' : '#fff4d6';
  const a = (time === 'dusk' ? 0.24 : 0.16) * (d.n === 2 ? 1.25 : 0.8);
  const dx = (time === 'dusk' ? 1.1 : 0.55) * (floorY - y);
  const poly = [[x, y], [x + w, y], [x + w + dx, floorY + (k.H - floorY) * 0.55], [x + dx, floorY + (k.H - floorY) * 0.55]];
  const fillv = p.lin([[0, c, a], [1, c, 0]], x, y, x + dx * 0.6, floorY + (k.H - floorY) * 0.5, {force: true, glow: true});
  return [p.path(pts(poly), fillv, {glow: true, blend: 'screen'})];
}

// ---------------------------------------------------------------------------
// Street furniture and nature

/** A street lamp at x on groundY, h tall; lit at dusk and night. */
export function lampPost(k, x, groundY, h, {color = null, double = false} = {}) {
  const {p, pal, u, time} = k;
  const c = color ?? mixColor('#000000', pal.metalShade, 0.35);
  const on = time !== 'day';
  const head = groundY - h;
  const out = [];
  out.push(p.rect(x - 7 * u, head, 14 * u, h, c, {}));
  out.push(p.rect(x - 16 * u, groundY - 26 * u, 32 * u, 26 * u, c, {rx: 4 * u}));
  const arms = double ? [-1, 1] : [1];
  for (const s of arms) {
    const hx = x + s * 46 * u;
    out.push(p.stroke(`M${f(x)} ${f(head + 8 * u)}Q${f(x + s * 10 * u)} ${f(head - 22 * u)} ${f(hx)} ${f(head - 10 * u)}`, c, 9));
    out.push(p.path(pts([[hx - 26 * u, head - 4 * u], [hx + 26 * u, head - 4 * u], [hx + 16 * u, head - 20 * u], [hx - 16 * u, head - 20 * u]]), c, {}));
    out.push(p.rect(hx - 20 * u, head - 4 * u, 40 * u, 8 * u, on ? pal.lamp : mixColor('#ffffff', c, 0.5), {glow: on, rx: 3 * u}));
    if (on) {
      out.push(p.glow(hx, head, 120 * u, pal.lampWarm, time === 'night' ? 0.55 : 0.32));
      const cone = p.lin([[0, pal.lamp, time === 'night' ? 0.32 : 0.16], [1, pal.lamp, 0]], hx, head, hx, groundY, {force: true, glow: true});
      if (k.d.n >= 1) out.push(p.path(pts([[hx - 18 * u, head + 4 * u], [hx + 18 * u, head + 4 * u], [hx + 130 * u, groundY], [hx - 130 * u, groundY]]), cone, {glow: true, blend: 'screen'}));
      out.push(p.pool(hx, groundY + 6 * u, 170 * u, 26 * u, pal.lamp, time === 'night' ? 0.45 : 0.22));
    }
  }
  return out;
}

/** A tree at x on groundY, h tall. kind: 'round' | 'pine' | 'palm' | 'bush'. */
export function tree(k, x, groundY, h, {kind = 'round', tone = 0} = {}) {
  const {p, pal, u, d} = k;
  const leaf = tone ? mixColor('#000000', pal.foliage, 0.12 * tone) : pal.foliage;
  const leafS = pal.foliageShade, leafL = pal.foliageLight;
  const out = [p.shadow(x, groundY, h * 0.32, h * 0.045)];
  if (kind === 'pine') {
    out.push(p.rect(x - h * 0.03, groundY - h * 0.2, h * 0.06, h * 0.2, pal.trunk, {}));
    for (let i = 0; i < 3; i++) {
      const by = groundY - h * (0.14 + i * 0.25), ty = by - h * 0.42, hw = h * (0.3 - i * 0.07);
      out.push(p.poly([[x - hw, by], [x + hw, by], [x, ty]], i % 2 ? leaf : leafS, {}));
      if (d.n >= 1) out.push(p.poly([[x, by], [x + hw, by], [x, ty]], '#000000', {opacity: 0.12, stroke: false}));
    }
    return out;
  }
  if (kind === 'palm') {
    const top = [x + h * 0.16, groundY - h];
    out.push(p.stroke(`M${f(x)} ${f(groundY)}Q${f(x - h * 0.04)} ${f(groundY - h * 0.6)} ${f(top[0])} ${f(top[1])}`, pal.trunk, h * 0.05 / u));
    if (d.n >= 1) for (let i = 1; i < 8; i++) { const t = i / 8; const px = (1 - t) * (1 - t) * x + 2 * (1 - t) * t * (x - h * 0.04) + t * t * top[0]; const py = (1 - t) * (1 - t) * groundY + 2 * (1 - t) * t * (groundY - h * 0.6) + t * t * top[1]; out.push(p.line(px - h * 0.025, py, px + h * 0.025, py - h * 0.01, mixColor('#000000', pal.trunk, 0.3), 2)); }
    for (const [ang, len] of [[-160, 0.42], [-125, 0.38], [-60, 0.4], [-20, 0.42], [-95, 0.3], [10, 0.32], [-190, 0.3]]) {
      const a = ang * Math.PI / 180, ex = top[0] + Math.cos(a) * h * len, ey = top[1] + Math.sin(a) * h * len * 0.6 + h * 0.12;
      const mx = (top[0] + ex) / 2, my = Math.min(top[1], ey) - h * 0.1;
      out.push(p.path(`M${f(top[0])} ${f(top[1])}Q${f(mx)} ${f(my)} ${f(ex)} ${f(ey)}Q${f(mx)} ${f(my + h * 0.08)} ${f(top[0])} ${f(top[1])}Z`, ang < -90 ? leafS : leaf, {}));
    }
    return out;
  }
  if (kind === 'bush') {
    for (const [dx, dy, r, c] of [[-0.3, -0.25, 0.32, leafS], [0.28, -0.22, 0.3, leafS], [0, -0.4, 0.38, leaf], [-0.12, -0.3, 0.3, leaf], [0.18, -0.45, 0.2, leafL]]) out.push(p.circle(x + dx * h, groundY + dy * h, r * h, c, {}));
    return out;
  }
  out.push(p.path(pts([[x - h * 0.05, groundY], [x + h * 0.05, groundY], [x + h * 0.035, groundY - h * 0.55], [x - h * 0.035, groundY - h * 0.55]]), pal.trunk, {}));
  out.push(p.stroke(`M${f(x)} ${f(groundY - h * 0.45)}L${f(x + h * 0.12)} ${f(groundY - h * 0.6)}`, pal.trunk, h * 0.025 / u));
  const blobs = [[-0.2, -0.62, 0.22, leafS], [0.2, -0.64, 0.21, leafS], [0, -0.78, 0.26, leaf], [-0.15, -0.86, 0.18, leaf], [0.16, -0.84, 0.17, leaf], [0.06, -0.94, 0.12, leafL]];
  for (const [dx, dy, r, c] of blobs) out.push(p.circle(x + dx * h, groundY + dy * h, r * h, c, {}));
  if (d.n >= 1) out.push(p.circle(x - h * 0.08, groundY - h * 0.88, h * 0.08, leafL, {opacity: 0.7, stroke: false}));
  return out;
}

// ---------------------------------------------------------------------------
// Light effects

/** A haze band: clear at y0, the time's haze at y1 (standard and rich). */
export function haze(k, y0, y1, {alpha = 1, color = null} = {}) {
  const {p, pal, d} = k;
  if (!d.haze) return [];
  const {x0, w} = span(k);
  const c = color ?? pal.haze;
  const a = pal.hazeAlpha * d.haze * alpha;
  const top = Math.min(y0, y1), bottom = Math.max(y0, y1);
  const fillv = p.lin([[0, c, y0 < y1 ? 0 : a], [1, c, y0 < y1 ? a : 0]], 0, top, 0, bottom, {force: true, glow: true});
  return [p.rect(x0, top, w, bottom - top, fillv, {glow: true})];
}

/** Volumetric rays from (x, y) fanning toward angle (deg, 0 = right, 90 = down). */
export function rays(k, x, y, {angle = 60, spread = 40, length = null, count = 5, color = null, alpha = 0.16} = {}) {
  const {p, pal, d, u} = k;
  if (!d.rays) return [];
  const c = color ?? (k.time === 'dusk' ? '#ffc07a' : k.time === 'night' ? '#b9c8ff' : '#fff2cf');
  const len = length ?? Math.hypot(k.W, k.H);
  const out = [];
  for (let i = 0; i < count; i++) {
    const a0 = (angle - spread / 2 + spread * (i + p.rnd(0.1, 0.4)) / count) * Math.PI / 180;
    const a1 = a0 + (spread / count) * p.rnd(0.25, 0.55) * Math.PI / 180;
    const fillv = p.lin([[0, c, alpha * p.rnd(0.6, 1.1)], [1, c, 0]], x, y, x + Math.cos((a0 + a1) / 2) * len, y + Math.sin((a0 + a1) / 2) * len, {force: true, glow: true});
    out.push(p.path(pts([[x, y], [x + Math.cos(a0) * len, y + Math.sin(a0) * len], [x + Math.cos(a1) * len, y + Math.sin(a1) * len]]), fillv, {glow: true, blend: 'screen'}));
  }
  void u;
  return out;
}

/** A soft sign/neon tube: text-free glowing shape (a rounded bar or ring). */
export function neonTube(k, d, color, width = 6) {
  const {p, u} = k;
  const on = k.time !== 'day';
  const out = [];
  if (on && k.d.gradients) out.push(p.stroke(d, color, width * 4.2, {glow: true, opacity: 0.18}));
  if (on && k.d.gradients) out.push(p.stroke(d, color, width * 2, {glow: true, opacity: 0.35}));
  out.push(p.stroke(d, on ? mixColor('#ffffff', color, 0.45) : mixColor('#000000', color, 0.25), width, {glow: on}));
  void u;
  return out;
}

/**
 * The cinematic grade: a soft-light wash in the time's key colour over the
 * whole frame (warm by day and dusk, teal at night).
 */
export function grade(k) {
  const {p, W, H} = k;
  const c = k.time === 'night' ? '#2a7f8f' : k.time === 'dusk' ? '#ff8a3c' : '#ffb870';
  return [p.rect(-2, -2, W + 4, H + 4, c, {glow: true, blend: 'soft-light', opacity: k.time === 'night' ? 0.32 : 0.24})];
}

/** The canvas vignette (rich and cinematic): dark corners. */
export function vignette(k, strength) {
  const {p, W, H} = k;
  if (!strength) return [];
  const fillv = p.rad([[0, '#000000', 0], [0.62, '#000000', 0], [1, '#000000', strength]], W / 2, H / 2, Math.hypot(W, H) / 2, {force: true});
  return [p.rect(-2, -2, W + 4, H + 4, fillv, {glow: true})];
}
