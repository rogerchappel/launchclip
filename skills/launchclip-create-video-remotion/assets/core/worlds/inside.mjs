// Inside worlds: office and kitchen.
//
// Each world is {group, label, describe, geo, back, mid, front, fx?}:
// geo(k) lays the room out once (floor line, anchors for props and
// characters, the quiet area for text); back draws the wall and what hangs
// on it, mid the furniture against the wall, front the foreground pieces
// at the frame edges (the centre stays open for characters and text).
// Windows look outside at the world's time; lamps glow at dusk and night.

import {mixColor} from '../catalog-b-base.mjs';
import {f, pts} from './pen.mjs';
import {span, wall, floor, interiorWindow, windowBeam, haze, rays, neonTube} from './common.mjs';
import {desk, monitor, chair, shelf, pottedPlant, pendant, deskLamp, frameArt, curtains, rug, counter} from './furniture.mjs';

/**
 * Room geometry: the floor line, where characters stand, and the anchors
 * props snap to. floor: the floor line as a share of the height.
 */
function room(k, {floor: share = 0.7, surface = null, quiet = null} = {}) {
  const {W, H, ppm, portrait} = k;
  const floorY = Math.round(H * (portrait ? Math.min(0.78, share + 0.05) : share));
  const groundY = Math.round(floorY + (H - floorY) * 0.42);
  const anchors = {
    ground: {y: groundY, x0: W * 0.04, x1: W * 0.96, ppm},
    floor: {y: floorY + 6, x0: W * 0.04, x1: W * 0.96, ppm: ppm * 0.86, layer: 'mid'},
    wall: {y: Math.round(floorY * 0.46), x0: W * 0.06, x1: W * 0.94, ppm: ppm * 0.86, layer: 'back'}
  };
  if (surface) anchors.surface = {layer: 'front', ppm, ...surface};
  const q = quiet ?? (portrait ? {x: 0.06, y: 0.05, w: 0.88, h: 0.24} : {x: 0.52, y: 0.07, w: 0.42, h: 0.36});
  return {floorY, groundY, anchors, quiet: {x: Math.round(q.x * W), y: Math.round(q.y * H), width: Math.round(q.w * W), height: Math.round(q.h * H)}};
}

const quietOf = (g, under) => ({...g.quiet, under});

// ---------------------------------------------------------------------------
// Office

const office = {
  group: 'inside', label: 'Office',
  describe: 'an open-plan office: a window wall over the city, desks with monitors, pendant lights and plants',
  geo(k) {
    const g = room(k, {floor: 0.7, surface: {y: Math.round(k.H * (k.portrait ? 0.9 : 0.87)), x0: -k.ov * 0.2, x1: k.W * (k.portrait ? 0.46 : 0.3)}});
    g.win = k.portrait ? {x: k.W * 0.08, y: k.H * 0.2, w: k.W * 0.84, h: k.H * 0.3} : {x: k.W * 0.05, y: k.H * 0.1, w: k.W * 0.42, h: k.H * 0.46};
    g.quiet = quietOf(g, [k.pal.wall, k.pal.wallLight]);
    if (k.portrait) g.quiet = {...g.quiet, y: Math.round(k.H * 0.03), height: Math.round(k.H * 0.15)};
    return g;
  },
  back(k, g) {
    const {W, u, pal} = k;
    const {x, y, w, h} = g.win;
    const out = [wall(k, g.floorY, {})];
    out.push(interiorWindow(k, x, y, w, h, {view: 'city', cols: k.portrait ? 3 : 3, rows: 1}));
    if (!k.portrait) {
      // A pinboard and a clock on the plain wall.
      out.push(p0(k).rect(W * 0.62, k.H * 0.2, W * 0.2, k.H * 0.22, mixColor('#c49a6c', pal.wall, 0.8), {rx: 6 * u}));
      const pins = [[0.64, 0.23, pal.accentLight], [0.7, 0.27, pal.cream], [0.76, 0.22, pal.primaryLight], [0.66, 0.32, pal.cream], [0.74, 0.31, pal.accentLight]];
      for (const [px, py, c] of pins) out.push(k.p.rect(W * px, k.H * py, W * 0.045, W * 0.04, c, {transform: `rotate(${k.p.rnd(-6, 6)} ${f(W * px)} ${f(k.H * py)})`}));
      out.push(clock(k, W * 0.9, k.H * 0.16, 40 * u));
    } else {
      out.push(clock(k, W * 0.86, k.H * 0.1, 44 * u));
    }
    out.push(windowBeam(k, x, y + h * 0.1, w * 0.8, h, g.floorY));
    return out;
  },
  mid(k, g) {
    const {W, u, p, pal} = k;
    const out = [floor(k, g.floorY, {kind: 'carpet', color: mixColor(pal.primary, '#8e8a86', 0.12)})];
    // A row of desks along the back wall.
    const dy = g.floorY - 0.74 * k.ppm * 0.8;
    const rows = k.portrait ? [[0.04, 0.5], [0.56, 0.4]] : [[0.03, 0.27], [0.33, 0.24], [0.63, 0.3]];
    for (const [fx, fw] of rows) {
      const dx = W * fx, dw = W * fw;
      out.push(chair(k, dx + dw * (fw > 0.26 ? 0.52 : 0.62), dy + 60 * u, g.floorY + 4 * u, {}));
      out.push(desk(k, dx, dy, dw, g.floorY, {color: pal.cream, drawer: fw > 0.26}));
      out.push(monitor(k, dx + dw * 0.32, dy, 130 * u));
      if (fw > 0.26) out.push(monitor(k, dx + dw * 0.72, dy, 120 * u));
      else out.push(pottedPlant(k, dx + dw * 0.78, dy, 48 * u, {kind: 'cactus'}));
    }
    for (const fx of k.portrait ? [0.3, 0.75] : [0.25, 0.52, 0.8]) out.push(pendant(k, W * fx, k.H * 0.1, {size: 70, shade: pal.ink}));
    out.push(pottedPlant(k, W * (k.portrait ? 0.92 : 0.95), g.floorY + 8 * u, 120 * u, {kind: 'tall'}));
    out.push(haze(k, g.floorY - 280 * u, g.floorY, {alpha: 0.5}));
    void p;
    return out;
  },
  front(k, g) {
    const {W, H, u, pal, ov} = k;
    const s = g.anchors.surface;
    return [
      desk(k, -ov, s.y, s.x1 + ov, H + 200 * u, {color: pal.woodLight, legs: 'wood'}),
      pottedPlant(k, W * 0.97, H + 10 * u, 230 * u, {kind: 'leafy'})
    ];
  },
  fx(k, g) {
    return k.time === 'day' ? rays(k, g.win.x + g.win.w * 0.4, g.win.y, {angle: 62, spread: 26, count: 4, alpha: 0.1}) : [];
  }
};

const p0 = k => k.p;

function clock(k, cx, cy, r) {
  const {p, pal, u} = k;
  return [
    p.circle(cx, cy, r, pal.white, {stroke: pal.ink, sw: 2}),
    p.line(cx, cy, cx, cy - r * 0.62, pal.ink, 3),
    p.line(cx, cy, cx + r * 0.45, cy + r * 0.1, pal.ink, 3),
    p.circle(cx, cy, 3 * u, pal.accent, {stroke: false})
  ];
}

// ---------------------------------------------------------------------------
// Kitchen

const kitchen = {
  group: 'inside', label: 'Kitchen',
  describe: 'a bright kitchen: tiled splashback, upper cabinets, a stove and sink under a window, and an island in front to cook on',
  geo(k) {
    const g = room(k, {floor: 0.72});
    const islandY = Math.round(k.H * (k.portrait ? 0.82 : 0.8));
    g.anchors.surface = {y: islandY, x0: k.W * 0.06, x1: k.W * 0.94, ppm: k.ppm, layer: 'front'};
    g.anchors.counter = {y: Math.round(g.floorY - 0.9 * k.ppm * 0.86), x0: k.W * 0.04, x1: k.W * 0.96, ppm: k.ppm * 0.86, layer: 'mid'};
    g.counterY = g.anchors.counter.y;
    g.islandY = islandY;
    g.win = k.portrait ? {x: k.W * 0.3, y: k.H * 0.3, w: k.W * 0.4, h: k.H * 0.14} : {x: k.W * 0.4, y: k.H * 0.2, w: k.W * 0.2, h: k.H * 0.24};
    g.quiet = k.portrait ? {x: Math.round(k.W * 0.06), y: Math.round(k.H * 0.04), width: Math.round(k.W * 0.88), height: Math.round(k.H * 0.12), under: [k.pal.wall]}
      : {x: Math.round(k.W * 0.04), y: Math.round(k.H * 0.04), width: Math.round(k.W * 0.92), height: Math.round(k.H * 0.12), under: [k.pal.wall, k.pal.primary]};
    return g;
  },
  back(k, g) {
    const {W, H, u, p, pal} = k;
    const {x0, w: sw} = span(k);
    const out = [wall(k, g.floorY, {color: pal.wallLight})];
    // Splashback tiles between the counter and the cabinets.
    const ty0 = g.counterY - (k.portrait ? 300 : 210) * u, ty1 = g.counterY;
    out.push(p.rect(x0, ty0, sw, ty1 - ty0, pal.cream, {stroke: false}));
    const tile = 34 * u;
    if (k.d.n >= 1 || k.d.outline) {
      for (let y = ty0; y < ty1; y += tile) out.push(p.line(x0, y, x0 + sw, y, mixColor('#000000', pal.cream, 0.12), 1.2));
      for (let r = 0, y = ty0; y < ty1; y += tile, r++) for (let x = x0 + (r % 2) * tile / 2; x < x0 + sw; x += tile) out.push(p.line(x, y, x, Math.min(y + tile, ty1), mixColor('#000000', pal.cream, 0.12), 1.2));
    }
    const {x, y, w, h} = g.win;
    out.push(interiorWindow(k, x, y, w, h, {view: 'trees', cols: 2, rows: 1}));
    // Upper cabinets either side of the window.
    const cy = k.portrait ? H * 0.16 : H * 0.05, ch = ty0 - 30 * u - cy;
    const cab = pal.primary;
    for (const [cx, cw] of [[x0, x - 60 * u - x0], [x + w + 60 * u, x0 + sw - (x + w + 60 * u)]]) {
      out.push(p.rect(cx, cy, cw, ch, cab, {}));
      const n = Math.max(1, Math.round(cw / (170 * u)));
      for (let i = 0; i < n; i++) {
        const dx = cx + i * cw / n;
        out.push(p.rect(dx + 10 * u, cy + 10 * u, cw / n - 20 * u, ch - 20 * u, mixColor('#ffffff', cab, 0.1), {rx: 5 * u}));
        out.push(p.rect(dx + (i % 2 ? 20 * u : cw / n - 28 * u), cy + ch - 60 * u, 6 * u, 36 * u, pal.metalLight, {stroke: false, rx: 3 * u}));
      }
      out.push(p.shade(cx, cy, cw, ch, 'bottom', 0.3));
      if (k.time !== 'day') out.push(p.rect(cx, cy + ch, cw, 6 * u, pal.lamp, {glow: true, stroke: false}));
      if (k.time !== 'day') out.push(p.glow(cx + cw / 2, cy + ch + 40 * u, cw * 0.6, pal.lampWarm, 0.3, {ry: 90 * u}));
    }
    out.push(windowBeam(k, x, y, w, h, g.floorY));
    return out;
  },
  mid(k, g) {
    const {W, u, p, pal} = k;
    const {x0, w: sw} = span(k);
    const out = [floor(k, g.floorY, {kind: 'tile'})];
    out.push(counter(k, x0, g.counterY, sw, g.floorY, {top: pal.white, body: mixColor(pal.primary, pal.cream, 0.55), doors: Math.round(sw / (200 * u))}));
    // Stove with hood, and a sink under the window.
    const sx = W * (k.portrait ? 0.12 : 0.18), swid = 230 * u;
    out.push(p.rect(sx, g.counterY - 6 * u, swid, 8 * u, pal.black, {stroke: false}));
    for (const bx of [0.27, 0.73]) out.push(p.ellipse(sx + swid * bx, g.counterY - 6 * u, 40 * u, 6 * u, pal.metalShade, {}));
    out.push(p.rect(sx + 10 * u, g.counterY + 40 * u, swid - 20 * u, 140 * u, pal.black, {rx: 6 * u}));
    out.push(p.rect(sx + 26 * u, g.counterY + 56 * u, swid - 52 * u, 90 * u, k.time === 'night' ? '#3a2a20' : '#2b2d33', {rx: 4 * u, stroke: false}));
    const hood = [[sx + swid * 0.1, g.counterY - 260 * u], [sx + swid * 0.9, g.counterY - 260 * u], [sx + swid * 1.02, g.counterY - 180 * u], [sx - swid * 0.02, g.counterY - 180 * u]];
    out.push(p.rect(sx + swid * 0.38, g.counterY - 420 * u, swid * 0.24, 170 * u, pal.metal, {}));
    out.push(p.poly(hood, pal.metal, {}));
    out.push(p.shade(sx, g.counterY - 260 * u, swid, 80 * u, 'right', 0.3));
    const sinkX = g.win.x + g.win.w / 2;
    out.push(p.rect(sinkX - 90 * u, g.counterY - 2 * u, 180 * u, 8 * u, pal.metalShade, {stroke: false}));
    out.push(p.stroke(`M${f(sinkX + 30 * u)} ${f(g.counterY)}L${f(sinkX + 30 * u)} ${f(g.counterY - 70 * u)}Q${f(sinkX + 30 * u)} ${f(g.counterY - 92 * u)} ${f(sinkX + 6 * u)} ${f(g.counterY - 92 * u)}L${f(sinkX - 6 * u)} ${f(g.counterY - 80 * u)}`, pal.metalShade, 7));
    // Canisters and a plant on the counter.
    const right = W * (k.portrait ? 0.74 : 0.74);
    for (const [i, c] of [[0, pal.accent], [1, pal.cream], [2, pal.primaryShade]]) out.push(p.rect(right + i * 50 * u, g.counterY - (70 - i * 12) * u, 40 * u, (70 - i * 12) * u, c, {rx: 6 * u}));
    out.push(pottedPlant(k, right + 210 * u, g.counterY, 70 * u, {kind: 'leafy'}));
    if (!k.portrait) for (const fx of [0.32, 0.68]) out.push(pendant(k, W * fx, k.H * 0.34, {size: 66, shade: pal.accent}));
    void sw;
    return out;
  },
  front(k, g) {
    const {u, pal} = k;
    const {x0, w} = span(k);
    return [counter(k, x0 + k.W * 0.04, g.islandY, w - k.W * 0.08, k.H + 60 * u, {top: pal.wood, body: mixColor('#000000', pal.primary, 0.18), doors: 6, toe: false})];
  }
};

export const INSIDE = {
  office, kitchen
};
