// Street worlds: city street, shopfronts and crossing. A side-on street: sky and a distant skyline at the back, facades
// along the pavement in the middle, the road and kerb-side furniture in
// front. Night lights the windows, shop glass, street lamps and neon; dusk
// rakes warm light across the facades.

import {mixColor} from '../catalog-b-base.mjs';
import {f, pts} from './pen.mjs';
import {span, sky, skyline, lampPost, tree, haze, rays, neonTube, skyBody} from './common.mjs';

// Streets are seen from further back than rooms: people stand smaller.
export const STREET_SCALE = 0.62;

/** Street geometry: pavement line (characters stand on it), kerb, road. */
function street(k, {base = 0.72} = {}) {
  const {W, H, portrait} = k;
  const ppm = k.ppm * STREET_SCALE;
  const baseY = Math.round(H * (portrait ? Math.min(0.74, base + 0.04) : base));
  const kerbY = Math.round(baseY + (H - baseY) * 0.42);
  const groundY = Math.round(baseY + (kerbY - baseY) * 0.6);
  return {
    baseY, kerbY, groundY,
    anchors: {
      ground: {y: groundY, x0: W * 0.04, x1: W * 0.96, ppm},
      road: {y: Math.round(kerbY + (H - kerbY) * 0.55), x0: W * 0.02, x1: W * 0.98, ppm: ppm * 1.1, layer: 'front'},
      wall: {y: Math.round(baseY - 0.9 * ppm), x0: W * 0.06, x1: W * 0.94, ppm: ppm * 0.9, layer: 'mid'}
    }
  };
}

const quietTop = (k, h, under) => ({x: Math.round(k.W * 0.06), y: Math.round(k.H * 0.04), width: Math.round(k.W * 0.88), height: Math.round(k.H * h), under});

/** Pavement and road from baseY to the bottom. */
function pavementRoad(k, g, {lanes = true, crossing = false} = {}) {
  const {p, pal, u, H} = k;
  const {x0, x1, w} = span(k);
  const out = [];
  out.push(p.rect(x0, g.baseY, w, g.kerbY - g.baseY, p.lin([[0, mixColor('#000000', pal.concrete, 0.12)], [1, pal.concrete]], 0, g.baseY, 0, g.kerbY), {stroke: false}));
  if (k.d.n >= 1 || k.d.outline) for (let x = x0; x < x1; x += 150 * u) out.push(p.line(x, g.baseY, x - 30 * u, g.kerbY, pal.concreteShade, 1.6, {opacity: 0.6}));
  out.push(p.rect(x0, g.kerbY, w, 14 * u, mixColor('#ffffff', pal.concrete, 0.2), {stroke: k.d.outline ? true : false, sw: 0.6}));
  out.push(p.rect(x0, g.kerbY + 14 * u, w, H - g.kerbY, p.lin([[0, pal.asphaltShade], [1, pal.asphalt]], 0, g.kerbY, 0, H), {stroke: false}));
  const midY = g.kerbY + 14 * u + (H - g.kerbY) * 0.48;
  if (lanes && !crossing) for (let x = x0; x < x1; x += 220 * u) out.push(p.rect(x, midY, 120 * u, 10 * u, pal.line, {stroke: false, opacity: 0.9}));
  if (k.time !== 'day' && k.d.n >= 1) out.push(p.rect(x0, g.kerbY + 14 * u, w, H - g.kerbY, p.lin([[0, '#ffffff', 0.05], [1, '#ffffff', 0]], 0, g.kerbY, 0, H, {force: true}), {glow: true}));
  return out;
}

/**
 * A building facade from x, w wide, standing on baseY, h tall: floors of
 * windows (lit at night), a cornice, and a ground floor shop or door.
 * ground: 'shop' | 'door' | 'lobby' | null.
 */
function facade(k, x, w, baseY, h, {color, ground = 'shop', awning = null, floors = null, sign = null, glass = false} = {}) {
  const {p, pal, u, time, d} = k;
  const top = baseY - h;
  const out = [p.rect(x, top, w, h + 2, color, {})];
  if (d.n >= 1) out.push(p.shade(x, top, w, h, time === 'dusk' ? 'right' : 'right', time === 'dusk' ? 0.32 : 0.18));
  if (time === 'dusk' && d.n >= 1) out.push(p.rect(x, top, w * 0.4, h, p.lin([[0, '#ffb070', 0.22], [1, '#ffb070', 0]], x, 0, x + w * 0.4, 0, {force: true, glow: true}), {glow: true, blend: 'screen'}));
  out.push(p.rect(x - 8 * u, top - 14 * u, w + 16 * u, 18 * u, mixColor('#000000', color, 0.2), {}));
  const groundH = ground ? Math.min(1.1 * (k.ppm * STREET_SCALE) * 1.25, h * 0.3) : 0;
  const n = floors ?? Math.max(1, Math.floor((h - groundH - 30 * u) / ((k.ppm * STREET_SCALE) * 0.62)));
  const fh = (h - groundH - 30 * u) / n;
  const cols = Math.max(1, Math.round(w / (glass ? 90 * u : 130 * u)));
  const cw = w / cols;
  for (let r = 0; r < n; r++) for (let c = 0; c < cols; c++) {
    const wx = x + c * cw + cw * (glass ? 0.06 : 0.2), wy = top + 20 * u + r * fh + fh * 0.16;
    const ww = cw * (glass ? 0.88 : 0.6), wh = fh * (glass ? 0.76 : 0.62);
    const lit = time === 'night' ? p.rnd() < 0.55 : time === 'dusk' ? p.rnd() < 0.25 : false;
    const dayGlass = mixColor(pal.skyLow, mixColor('#000000', color, 0.3), 0.5);
    const g = lit ? pal.lit : time === 'day' ? dayGlass : mixColor('#000000', color, 0.45);
    if (lit && d.gradients) out.push(p.glow(wx + ww / 2, wy + wh / 2, ww * 1.2, pal.lampWarm, 0.18));
    out.push(p.rect(wx, wy, ww, wh, g, {glow: lit, rx: 2 * u}));
    if (lit && d.n >= 1 && p.rnd() < 0.4) out.push(p.rect(wx, wy, ww * p.rnd(0.3, 0.5), wh, mixColor('#7a4a3a', pal.lit, 0.5), {glow: true, stroke: false, opacity: 0.8}));
    if (time === 'day' && d.n >= 1) out.push(p.path(pts([[wx + ww * 0.15, wy + wh], [wx + ww * 0.5, wy], [wx + ww * 0.7, wy], [wx + ww * 0.35, wy + wh]]), '#ffffff', {opacity: 0.18, stroke: false}));
    if (!glass) out.push(p.rect(wx - 4 * u, wy + wh, ww + 8 * u, 7 * u, mixColor('#ffffff', color, 0.25), {stroke: false}));
  }
  if (ground === 'shop') out.push(shopFront(k, x + 12 * u, w - 24 * u, baseY, groundH, {awning: awning ?? pal.primary, sign}));
  else if (ground === 'door') {
    const dw = Math.min(110 * u, w * 0.3);
    out.push(p.rect(x + w / 2 - dw / 2, baseY - groundH * 0.85, dw, groundH * 0.85, mixColor('#000000', color, 0.45), {rx: 6 * u}));
    out.push(p.rect(x + w / 2 - dw / 2 - 10 * u, baseY - groundH * 0.85 - 12 * u, dw + 20 * u, 12 * u, mixColor('#ffffff', color, 0.2), {}));
    if (time !== 'day') out.push(p.glow(x + w / 2, baseY - groundH * 0.92, 80 * u, pal.lampWarm, 0.5), p.circle(x + w / 2, baseY - groundH * 0.92, 7 * u, pal.lamp, {glow: true}));
  } else if (ground === 'lobby') {
    out.push(p.rect(x + 20 * u, baseY - groundH, w - 40 * u, groundH, time === 'night' ? '#ffe2a8' : time === 'dusk' ? mixColor('#ffd2a0', pal.glass, 0.5) : pal.glass, {glow: time === 'night'}));
    for (let i = 1; i < 4; i++) out.push(p.line(x + 20 * u + (w - 40 * u) * i / 4, baseY - groundH, x + 20 * u + (w - 40 * u) * i / 4, baseY, mixColor('#000000', color, 0.3), 4));
  }
  return out;
}

/** A ground-floor shop: glass that glows at night, a striped awning, a sign shape. */
function shopFront(k, x, w, baseY, h, {awning, sign = null}) {
  const {p, pal, u, time, d} = k;
  const out = [];
  const glassC = time === 'night' ? '#ffe4ae' : time === 'dusk' ? '#ffd9a8' : mixColor(pal.skyLow, pal.glass, 0.5);
  const gx = x + w * 0.08, gw = w * 0.6, gy = baseY - h * 0.78;
  out.push(p.rect(x, baseY - h, w, h, mixColor('#000000', pal.ink, 0.1), {}));
  out.push(p.rect(gx, gy, gw, h * 0.74, glassC, {glow: time !== 'day'}));
  if (time !== 'day' && d.gradients) out.push(p.glow(gx + gw / 2, baseY, gw * 0.9, pal.lampWarm, time === 'night' ? 0.4 : 0.2, {ry: 70 * u}));
  // Shelves and goods in the window.
  for (const fy of [0.45, 0.75]) {
    const sy = gy + h * 0.74 * fy;
    out.push(p.rect(gx + 6 * u, sy, gw - 12 * u, 5 * u, mixColor('#000000', glassC, 0.35), {stroke: false}));
    for (let i = 0; i < 5; i++) out.push(p.rect(gx + 16 * u + i * (gw - 40 * u) / 5, sy - p.rnd(16, 34) * u, p.rnd(14, 26) * u, p.rnd(16, 34) * u, p.pick([pal.accent, pal.primary, pal.cream, pal.accentShade]), {stroke: false, rx: 3 * u}));
  }
  if (time === 'day' && d.n >= 1) out.push(p.path(pts([[gx + gw * 0.1, gy + h * 0.74], [gx + gw * 0.4, gy], [gx + gw * 0.55, gy], [gx + gw * 0.25, gy + h * 0.74]]), '#ffffff', {opacity: 0.25, stroke: false}));
  // Door.
  const dx = gx + gw + w * 0.06, dw = w - (dx - x) - w * 0.06;
  out.push(p.rect(dx, baseY - h * 0.82, dw, h * 0.82, time === 'day' ? mixColor('#000000', awning, 0.35) : mixColor(glassC, awning, 0.3), {glow: time !== 'day'}));
  out.push(p.circle(dx + dw * 0.8, baseY - h * 0.4, 4 * u, pal.metalLight, {stroke: false}));
  // Striped awning.
  const ay = baseY - h - 6 * u, ah = h * 0.26;
  const stripes = Math.max(4, Math.round(w / (46 * u)));
  for (let i = 0; i < stripes; i++) {
    const sx = x - 14 * u + i * (w + 28 * u) / stripes, sw = (w + 28 * u) / stripes;
    out.push(p.path(pts([[sx, ay], [sx + sw, ay], [sx + sw + 4 * u, ay + ah], [sx + 4 * u, ay + ah]]), i % 2 ? awning : mixColor('#ffffff', awning, 0.8), {stroke: false}));
  }
  for (let i = 0; i < stripes; i++) {
    const sx = x - 10 * u + i * (w + 28 * u) / stripes, sw = (w + 28 * u) / stripes;
    out.push(p.path(`M${f(sx)} ${f(ay + ah)}Q${f(sx + sw / 2)} ${f(ay + ah + 18 * u)} ${f(sx + sw)} ${f(ay + ah)}Z`, i % 2 ? awning : mixColor('#ffffff', awning, 0.8), {}));
  }
  out.push(p.path(pts([[x - 14 * u, ay], [x + w + 14 * u, ay], [x + w + 18 * u, ay + ah], [x - 10 * u, ay + ah]]), null, {}));
  if (d.n >= 1) out.push(p.rect(x - 10 * u, ay + ah, w + 28 * u, 16 * u, '#000000', {opacity: 0.12, stroke: false}));
  // Sign: a blank board, or a neon shape at dusk and night.
  if (sign) {
    const sx = x + w * 0.18, sy = ay - 70 * u, swd = w * 0.64;
    if (sign === 'neon') out.push(neonTube(k, `M${f(sx)} ${f(sy + 26 * u)}H${f(sx + swd * 0.4)}M${f(sx + swd * 0.55)} ${f(sy + 26 * u)}A${f(22 * u)} ${f(22 * u)} 0 1 1 ${f(sx + swd * 0.55 + 0.1)} ${f(sy + 26.1 * u)}M${f(sx + swd * 0.78)} ${f(sy + 8 * u)}L${f(sx + swd)} ${f(sy + 44 * u)}`, pal.neonB, 6));
    else out.push(p.rect(sx, sy, swd, 52 * u, pal.cream, {rx: 6 * u}), p.rect(sx + swd * 0.1, sy + 18 * u, swd * 0.5, 14 * u, awning, {stroke: false, rx: 4 * u}), p.circle(sx + swd * 0.8, sy + 26 * u, 14 * u, pal.accent, {stroke: false}));
  }
  return out;
}

/** A side-on car at x (its left end) on y. */
export function car(k, x, y, w, {color = null, facing = 1} = {}) {
  const {p, pal, u, time} = k;
  const c = color ?? pal.primary;
  const h = w * 0.36;
  const out = [p.shadow(x + w / 2, y, w * 0.55, 14 * u)];
  const body = `M${f(x)} ${f(y - h * 0.32)}Q${f(x)} ${f(y - h * 0.62)} ${f(x + w * 0.1)} ${f(y - h * 0.64)}L${f(x + w * 0.24)} ${f(y - h * 0.66)}Q${f(x + w * 0.34)} ${f(y - h)} ${f(x + w * 0.46)} ${f(y - h)}L${f(x + w * 0.68)} ${f(y - h)}Q${f(x + w * 0.78)} ${f(y - h)} ${f(x + w * 0.86)} ${f(y - h * 0.64)}L${f(x + w * 0.96)} ${f(y - h * 0.58)}Q${f(x + w)} ${f(y - h * 0.5)} ${f(x + w)} ${f(y - h * 0.3)}L${f(x + w)} ${f(y - h * 0.18)}L${f(x)} ${f(y - h * 0.18)}Z`;
  out.push(p.path(body, c, {transform: facing < 0 ? `translate(${f(2 * x + w)} 0) scale(-1 1)` : undefined}));
  const glassC = time === 'night' ? '#1a2240' : mixColor(pal.skyLow, '#3a4a60', 0.5);
  const win = pts([[x + w * 0.3, y - h * 0.64], [x + w * 0.42, y - h * 0.92], [x + w * 0.56, y - h * 0.92], [x + w * 0.56, y - h * 0.64]]);
  const win2 = pts([[x + w * 0.6, y - h * 0.64], [x + w * 0.6, y - h * 0.92], [x + w * 0.68, y - h * 0.92], [x + w * 0.8, y - h * 0.64]]);
  const flip = facing < 0 ? `translate(${f(2 * x + w)} 0) scale(-1 1)` : undefined;
  out.push(p.path(win, glassC, {transform: flip}), p.path(win2, glassC, {transform: flip}));
  out.push(p.rect(x, y - h * 0.24, w, h * 0.08, mixColor('#000000', c, 0.25), {stroke: false}));
  for (const wx of [0.2, 0.8]) {
    out.push(p.circle(x + w * wx, y - h * 0.16, h * 0.2, pal.black, {}));
    out.push(p.circle(x + w * wx, y - h * 0.16, h * 0.1, pal.metalLight, {stroke: false}));
  }
  const front = facing > 0 ? x + w - 8 * u : x + 8 * u, back = facing > 0 ? x + 8 * u : x + w - 8 * u;
  if (time !== 'day') {
    out.push(p.glow(front, y - h * 0.38, 90 * u, '#fff2c8', 0.5));
    out.push(p.glow(back, y - h * 0.38, 50 * u, '#ff4a4a', 0.5));
  }
  out.push(p.rect(front - 6 * u, y - h * 0.44, 12 * u, 10 * u, time === 'day' ? '#fff3c8' : '#fffbe6', {glow: time !== 'day', stroke: false, rx: 3 * u}));
  out.push(p.rect(back - 5 * u, y - h * 0.44, 10 * u, 10 * u, '#e04040', {glow: time !== 'day', stroke: false, rx: 3 * u}));
  out.push(p.sheen(x + w * 0.1, y - h * 0.64, w * 0.8, h * 0.12, 0.3));
  return out;
}

const facadeColors = k => [k.pal.brick, k.pal.g('#c9b79c'), k.pal.g(mixColor(k.pal.brand.primary, '#8a8f99', 0.18)), k.pal.g('#d9cdb8'), k.pal.g('#8c6e5c'), k.pal.g(mixColor(k.pal.brand.accent, '#9aa3ad', 0.15))];

// ---------------------------------------------------------------------------

const cityStreet = {
  group: 'street', label: 'City street',
  describe: 'a city street: mixed facades with shops, a skyline behind, street lamps, trees and a parked car',
  geo(k) {
    const g = street(k);
    g.quiet = quietTop(k, k.portrait ? 0.12 : 0.18, [k.pal.skyTop, k.pal.skyMid]);
    return g;
  },
  back(k, g) {
    const {pal, u} = k;
    return [
      sky(k, g.baseY - 200 * u, {}),
      skyline(k, g.baseY - 60 * u, {minH: k.H * 0.2, maxH: k.H * 0.42, color: pal.farther, windows: 0.4, minW: 70, maxW: 140}),
      haze(k, g.baseY - k.H * 0.45, g.baseY - 60 * u, {alpha: 0.8})
    ];
  },
  mid(k, g) {
    const {W, H, u, pal} = k;
    const {x0, x1} = span(k);
    const colors = facadeColors(k);
    const out = [];
    let x = x0, i = 0;
    const kinds = ['shop', 'door', 'shop', 'lobby', 'shop', 'door'];
    while (x < x1) {
      const w = (k.portrait ? 340 : 360) * u * (0.8 + 0.5 * ((i * 37) % 10) / 10);
      const h = H * (k.portrait ? 0.34 : 0.42) + ((i * 53) % 7) * 34 * u;
      out.push(facade(k, x, w, g.baseY, h, {color: colors[i % colors.length], ground: kinds[i % kinds.length], awning: i % 2 ? pal.accent : pal.primary, sign: i % 3 === 0 ? 'neon' : 'board'}));
      x += w; i++;
    }
    out.push(pavementRoad(k, g));
    for (const fx of k.portrait ? [0.18, 0.84] : [0.12, 0.5, 0.88]) out.push(tree(k, W * fx + 90 * u, g.groundY - 6 * u, 1.9 * (k.ppm * STREET_SCALE) * 0.9, {kind: 'round'}));
    return out;
  },
  front(k, g) {
    const {W, u, pal} = k;
    return [
      lampPost(k, W * (k.portrait ? 0.06 : 0.3), g.kerbY + 4 * u, 3.4 * (k.ppm * STREET_SCALE)),
      ...(k.portrait ? [] : [lampPost(k, W * 0.78, g.kerbY + 4 * u, 3.4 * (k.ppm * STREET_SCALE))]),
      car(k, W * (k.portrait ? 0.48 : 0.56), g.anchors.road.y - 30 * u, 3.6 * (k.ppm * STREET_SCALE) * 1.1, {color: pal.accent, facing: -1})
    ];
  },
  fx(k, g) {
    const b = skyBody(k, g.baseY - 200 * k.u);
    return k.time === 'dusk' ? rays(k, b.x, b.y, {angle: 10, spread: 30, count: 4, alpha: 0.14}) : [];
  }
};

const shopfronts = {
  group: 'street', label: 'Shopfronts',
  describe: 'a row of shopfronts up close: striped awnings, glowing windows, sign boards and neon shapes, with a sandwich board and planters',
  geo(k) {
    const g = street(k, {base: 0.76});
    g.quiet = quietTop(k, k.portrait ? 0.14 : 0.16, [mixColor(k.pal.brick, k.pal.g('#c9b79c'), 0.5), k.pal.g('#c9b79c')]);
    return g;
  },
  back(k, g) {
    const {pal} = k;
    const {x0, w} = span(k);
    return [k.p.rect(x0, -2, w, g.baseY, pal.g('#b9a993'), {stroke: false})];
  },
  mid(k, g) {
    const {W, H, u, pal} = k;
    const {x0, x1} = span(k);
    const colors = facadeColors(k);
    const out = [];
    const sw = (k.portrait ? 0.56 : 0.36) * W;
    let x = x0, i = 0;
    while (x < x1) {
      out.push(facade(k, x, sw, g.baseY, H * 1.2, {color: colors[(i * 2 + 1) % colors.length], ground: 'shop', awning: [pal.primary, pal.accent, pal.primaryShade][i % 3], sign: i % 2 ? 'neon' : 'board', floors: 1}));
      x += sw; i++;
    }
    out.push(pavementRoad(k, g));
    return out;
  },
  front(k, g) {
    const {W, u, p, pal} = k;
    const out = [];
    // Sandwich board and planters.
    const bx = W * (k.portrait ? 0.78 : 0.62), by = g.groundY + 20 * u;
    out.push(p.shadow(bx, by, 60 * u, 8 * u));
    out.push(p.poly([[bx - 50 * u, by], [bx - 26 * u, by - 150 * u], [bx + 26 * u, by - 150 * u], [bx + 50 * u, by]], pal.ink, {}));
    out.push(p.poly([[bx - 40 * u, by - 14 * u], [bx - 22 * u, by - 138 * u], [bx + 22 * u, by - 138 * u], [bx + 40 * u, by - 14 * u]], menuBoard(k), {}));
    for (let i = 0; i < 3; i++) out.push(p.line(bx - 20 * u, by - (110 - i * 30) * u, bx + 18 * u, by - (110 - i * 30) * u, '#f4f0e6', 3, {opacity: 0.7}));
    for (const fx of k.portrait ? [0.12] : [0.1, 0.9]) {
      const px = W * fx;
      out.push(p.rect(px - 70 * u, g.groundY - 60 * u, 140 * u, 70 * u, pal.woodShade, {rx: 4 * u}));
      out.push(tree(k, px, g.groundY - 56 * u, 150 * u, {kind: 'bush'}));
    }
    out.push(lampPost(k, W * (k.portrait ? 0.4 : 0.38), g.kerbY + 4 * u, 3.6 * (k.ppm * STREET_SCALE)));
    return out;
  }
};

const menuBoard = k => k.pal.g('#2a2e33');

const crossing = {
  group: 'street', label: 'Crossing',
  describe: 'a pedestrian crossing: zebra stripes across the road, a traffic light, a crossing signal, buildings behind and cars waiting',
  geo(k) {
    const g = street(k, {base: 0.64});
    g.quiet = quietTop(k, k.portrait ? 0.14 : 0.2, [k.pal.skyTop, k.pal.skyMid]);
    return g;
  },
  back(k, g) {
    const {pal, u} = k;
    return [
      sky(k, g.baseY - 160 * u, {}),
      skyline(k, g.baseY - 40 * u, {minH: k.H * 0.16, maxH: k.H * 0.36, color: pal.farther, windows: 0.4}),
      haze(k, g.baseY - k.H * 0.4, g.baseY, {alpha: 0.7})
    ];
  },
  mid(k, g) {
    const {u, H, pal} = k;
    const {x0, x1} = span(k);
    const colors = facadeColors(k);
    const out = [];
    let x = x0, i = 0;
    while (x < x1) {
      const w = 300 * u * (0.9 + 0.4 * ((i * 41) % 10) / 10);
      out.push(facade(k, x, w, g.baseY, H * 0.3 + ((i * 29) % 5) * 30 * u, {color: colors[(i + 2) % colors.length], ground: i % 2 ? 'shop' : 'lobby', awning: i % 4 === 1 ? pal.primary : pal.accent, sign: null, glass: i % 3 === 0}));
      x += w; i++;
    }
    out.push(pavementRoad(k, g, {crossing: true}));
    return out;
  },
  front(k, g) {
    const {W, H, u, p, pal} = k;
    const out = [];
    // Zebra stripes: wide bars across the road, in perspective.
    const top = g.kerbY + 20 * u, bottom = H;
    const n = 7;
    for (let i = 0; i < n; i++) {
      const cx = W * 0.5 + (i - (n - 1) / 2) * 110 * u;
      const spread = 1.7;
      out.push(p.poly([[cx - 34 * u, top], [cx + 34 * u, top], [W * 0.5 + (cx + 34 * u - W * 0.5) * spread, bottom], [W * 0.5 + (cx - 34 * u - W * 0.5) * spread, bottom]], pal.line, {opacity: 0.95}));
    }
    // Traffic light and crossing signal.
    const tx = W * (k.portrait ? 0.86 : 0.8), ty = g.kerbY - 3.4 * (k.ppm * STREET_SCALE);
    out.push(p.rect(tx - 7 * u, ty, 14 * u, g.kerbY - ty, pal.ink, {}));
    out.push(p.rect(tx - 34 * u, ty - 20 * u, 68 * u, 190 * u, pal.ink, {rx: 12 * u}));
    const lights = [['#ff4a3c', false], ['#ffc23c', false], ['#3cf07c', true]];
    lights.forEach(([c, on], i) => {
      const ly = ty + 18 * u + i * 56 * u;
      if (on) out.push(p.glow(tx, ly, 90 * u, c, k.time === 'day' ? 0.25 : 0.55));
      out.push(p.circle(tx, ly, 20 * u, on ? c : mixColor('#000000', c, 0.65), {glow: on}));
    });
    const sx = W * (k.portrait ? 0.14 : 0.2), sy = g.kerbY - 2.4 * (k.ppm * STREET_SCALE);
    out.push(p.rect(sx - 6 * u, sy, 12 * u, g.kerbY - sy, pal.ink, {}));
    out.push(p.rect(sx - 30 * u, sy - 10 * u, 60 * u, 80 * u, pal.ink, {rx: 8 * u}));
    out.push(p.glow(sx, sy + 30 * u, 60 * u, '#ffffff', k.time === 'day' ? 0.15 : 0.4));
    // A walking figure glyph in the signal (simple strokes).
    out.push(p.circle(sx, sy + 10 * u, 6 * u, '#e9fff1', {glow: true}));
    out.push(p.stroke(`M${f(sx)} ${f(sy + 18 * u)}L${f(sx - 2 * u)} ${f(sy + 40 * u)}M${f(sx - 2 * u)} ${f(sy + 40 * u)}L${f(sx - 12 * u)} ${f(sy + 58 * u)}M${f(sx - 2 * u)} ${f(sy + 40 * u)}L${f(sx + 10 * u)} ${f(sy + 58 * u)}M${f(sx - 12 * u)} ${f(sy + 30 * u)}L${f(sx + 12 * u)} ${f(sy + 26 * u)}`, '#e9fff1', 4, {glow: true}));
    if (!k.portrait) out.push(car(k, -k.ov * 0.5, g.anchors.road.y, 3.6 * (k.ppm * STREET_SCALE) * 1.1, {color: pal.primary, facing: 1}));
    out.push(car(k, W * (k.portrait ? 0.7 : 0.86), g.anchors.road.y + 10 * u, 3.6 * (k.ppm * STREET_SCALE) * 1.1, {color: pal.g('#d8dde4'), facing: -1}));
    return out;
  }
};

export const STREET = {
  'city-street': cityStreet, shopfronts, crossing
};
