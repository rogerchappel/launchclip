// Inside worlds: office, home desk, kitchen, living room, classroom, cafe, workshop, server room, studio and gym.
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
// Home desk

const homeDesk = {
  group: 'inside', label: 'Home desk',
  describe: 'a cosy home workspace: a desk under a window, shelves of books and plants, a desk lamp that glows at night',
  geo(k) {
    const g = room(k, {floor: 0.74});
    const dy = g.floorY - 0.74 * k.ppm;
    g.desk = k.portrait ? {x: k.W * 0.1, y: dy, w: k.W * 0.8} : {x: k.W * 0.3, y: dy, w: k.W * 0.42};
    g.anchors.surface = {y: Math.round(dy), x0: g.desk.x + 40 * k.u, x1: g.desk.x + g.desk.w - 40 * k.u, ppm: k.ppm, layer: 'mid'};
    g.win = k.portrait ? {x: k.W * 0.18, y: k.H * 0.22, w: k.W * 0.64, h: k.H * 0.22} : {x: k.W * 0.36, y: k.H * 0.1, w: k.W * 0.3, h: k.H * 0.36};
    g.quiet = k.portrait ? {x: Math.round(k.W * 0.06), y: Math.round(k.H * 0.04), width: Math.round(k.W * 0.88), height: Math.round(k.H * 0.14), under: [k.pal.wall]}
      : {x: Math.round(k.W * 0.04), y: Math.round(k.H * 0.06), width: Math.round(k.W * 0.26), height: Math.round(k.H * 0.36), under: [k.pal.wall, k.pal.wallLight]};
    return g;
  },
  back(k, g) {
    const {W, H, u, pal} = k;
    const warm = mixColor(pal.accent, pal.wall, 0.1);
    const out = [wall(k, g.floorY, {color: warm, dado: false})];
    const {x, y, w, h} = g.win;
    out.push(interiorWindow(k, x, y, w, h, {view: 'trees', cols: 2, rows: 2}));
    out.push(curtains(k, x, y, w, h, {}));
    if (!k.portrait) {
      for (const sy of [0.22, 0.38]) out.push(shelf(k, W * 0.74, H * sy, W * 0.2, {}));
      out.push(frameArt(k, W * 0.08, H * 0.48, W * 0.1, H * 0.14, {kind: 'landscape'}));
    } else {
      out.push(shelf(k, W * 0.08, H * 0.52, W * 0.38, {}));
      out.push(shelf(k, W * 0.54, H * 0.52, W * 0.38, {}));
    }
    out.push(windowBeam(k, x, y, w, h, g.floorY));
    return out;
  },
  mid(k, g) {
    const {W, u, pal} = k;
    const out = [floor(k, g.floorY, {kind: 'wood'})];
    out.push(rug(k, W * 0.5, g.groundY + 30 * u, W * 0.56, 70 * u, {}));
    const {x, y, w} = g.desk;
    out.push(chair(k, x + w * 0.3, y + 70 * u, g.floorY + 30 * u, {color: pal.primaryShade}));
    out.push(desk(k, x, y, w, g.floorY + 30 * u, {color: pal.wood, legs: 'wood', drawer: true}));
    out.push(monitor(k, x + w * 0.56, y, 170 * u));
    out.push(deskLamp(k, x + w * 0.12, y, {size: 110, dir: 1, color: pal.accent}));
    out.push(pottedPlant(k, x + w * 0.88, y, 60 * u, {kind: 'leafy'}));
    out.push(pottedPlant(k, W * (k.portrait ? 0.08 : 0.12), g.floorY + 24 * u, 150 * u, {kind: 'tall'}));
    return out;
  },
  front() { return []; }
};

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

// ---------------------------------------------------------------------------
// Living room

const livingRoom = {
  group: 'inside', label: 'Living room',
  describe: 'a living room: a sofa under framed art, a big window with curtains, a floor lamp, a rug and a coffee table',
  geo(k) {
    const g = room(k, {floor: 0.72});
    g.anchors.surface = {y: Math.round(k.H * (k.portrait ? 0.88 : 0.86)), x0: k.W * 0.34, x1: k.W * 0.66, ppm: k.ppm, layer: 'front'};
    g.win = k.portrait ? {x: k.W * 0.14, y: k.H * 0.12, w: k.W * 0.46, h: k.H * 0.28} : {x: k.W * 0.62, y: k.H * 0.1, w: k.W * 0.28, h: k.H * 0.44};
    g.quiet = k.portrait ? {x: Math.round(k.W * 0.06), y: Math.round(k.H * 0.43), width: Math.round(k.W * 0.88), height: Math.round(k.H * 0.12), under: [k.pal.wall]}
      : {x: Math.round(k.W * 0.06), y: Math.round(k.H * 0.06), width: Math.round(k.W * 0.46), height: Math.round(k.H * 0.2), under: [k.pal.wall]};
    return g;
  },
  back(k, g) {
    const {W, H, u, pal} = k;
    const out = [wall(k, g.floorY, {color: mixColor(pal.primary, pal.wall, 0.16), dado: true, panel: true})];
    const {x, y, w, h} = g.win;
    out.push(interiorWindow(k, x, y, w, h, {view: 'city', cols: 2, rows: 2}));
    out.push(curtains(k, x, y, w, h, {color: mixColor(pal.accent, pal.cream, 0.3)}));
    if (!k.portrait) {
      out.push(frameArt(k, W * 0.16, H * 0.3, W * 0.12, H * 0.18, {}));
      out.push(frameArt(k, W * 0.3, H * 0.33, W * 0.08, H * 0.12, {kind: 'landscape'}));
    } else {
      out.push(frameArt(k, W * 0.68, H * 0.18, W * 0.22, H * 0.12, {}));
    }
    out.push(windowBeam(k, x, y, w, h, g.floorY));
    return out;
  },
  mid(k, g) {
    const {W, u, p, pal} = k;
    const out = [floor(k, g.floorY, {kind: 'wood'})];
    out.push(rug(k, W * 0.5, g.groundY + 40 * u, W * 0.7, 110 * u, {color: mixColor(pal.accent, pal.cream, 0.4)}));
    // Sofa.
    const sx = W * (k.portrait ? 0.08 : 0.12), sw = W * (k.portrait ? 0.84 : 0.44), sy = g.floorY - 0.85 * k.ppm * 0.86;
    const c = mixColor(pal.primary, '#5f6878', 0.55);
    out.push(p.shadow(sx + sw / 2, g.floorY + 6 * u, sw * 0.55, 20 * u));
    out.push(p.rect(sx + 10 * u, sy, sw - 20 * u, (g.floorY - sy) * 0.6, c, {rx: 30 * u}));
    out.push(p.rect(sx, sy + (g.floorY - sy) * 0.42, sw, (g.floorY - sy) * 0.42, mixColor('#ffffff', c, 0.08), {rx: 24 * u}));
    for (const s of [0, 1]) out.push(p.rect(sx - 20 * u + s * (sw - 50 * u), sy + (g.floorY - sy) * 0.25, 70 * u, (g.floorY - sy) * 0.62, mixColor('#000000', c, 0.08), {rx: 28 * u}));
    for (const fx of [0.2, 0.5, 0.8]) out.push(p.line(sx + sw * fx, sy + (g.floorY - sy) * 0.45, sx + sw * fx, sy + (g.floorY - sy) * 0.8, mixColor('#000000', c, 0.2), 2));
    out.push(p.rect(sx + sw * 0.12, sy + (g.floorY - sy) * 0.16, 90 * u, 80 * u, pal.accent, {rx: 18 * u, transform: `rotate(-8 ${f(sx + sw * 0.12)} ${f(sy)})`}));
    for (const s of [0.12, 0.88]) out.push(p.rect(sx + sw * s - 5 * u, g.floorY - 10 * u, 10 * u, 16 * u, pal.woodShade, {}));
    out.push(p.shade(sx, sy, sw, g.floorY - sy, 'bottom', 0.25, {rx: 24 * u}));
    // Floor lamp beside the sofa.
    out.push(floorLamp(k, sx + sw + (k.portrait ? -40 : 80) * u, g.floorY + 6 * u, 1.6 * k.ppm * 0.86));
    out.push(pottedPlant(k, sx - (k.portrait ? -20 : 60) * u, g.floorY + 10 * u, 130 * u, {kind: 'tall'}));
    return out;
  },
  front(k, g) {
    const {u, p, pal} = k;
    const s = g.anchors.surface;
    const out = [p.shadow((s.x0 + s.x1) / 2, k.H, (s.x1 - s.x0) * 0.5, 20 * u)];
    out.push(p.rect(s.x0, s.y, s.x1 - s.x0, 22 * u, pal.woodShade, {rx: 8 * u}));
    out.push(p.rect(s.x0 + 30 * u, s.y + 22 * u, 14 * u, k.H - s.y, pal.woodShade, {}));
    out.push(p.rect(s.x1 - 44 * u, s.y + 22 * u, 14 * u, k.H - s.y, pal.woodShade, {}));
    out.push(p.sheen(s.x0, s.y, s.x1 - s.x0, 8 * u, 0.4));
    return out;
  }
};

function floorLamp(k, x, floorY, h) {
  const {p, pal, u, time} = k;
  const on = time !== 'day';
  const top = floorY - h;
  const out = [p.ellipse(x, floorY - 4 * u, 40 * u, 9 * u, pal.ink, {}), p.rect(x - 4 * u, top + 40 * u, 8 * u, h - 40 * u, pal.ink, {})];
  if (on) {
    out.push(p.glow(x, top + 30 * u, 260 * u, pal.lampWarm, time === 'night' ? 0.55 : 0.32));
    out.push(p.pool(x, floorY + 10 * u, 220 * u, 30 * u, pal.lamp, 0.4));
  }
  out.push(p.path(pts([[x - 46 * u, top + 70 * u], [x + 46 * u, top + 70 * u], [x + 30 * u, top], [x - 30 * u, top]]), on ? '#ffe7b8' : pal.cream, {glow: on}));
  return out;
}

// ---------------------------------------------------------------------------
// Classroom

const classroom = {
  group: 'inside', label: 'Classroom',
  describe: 'a classroom: a big green board (the quiet area for text), tall windows, rows of desks and a teacher\'s desk',
  geo(k) {
    const g = room(k, {floor: 0.7});
    g.board = k.portrait ? {x: k.W * 0.07, y: k.H * 0.1, w: k.W * 0.86, h: k.H * 0.3} : {x: k.W * 0.28, y: k.H * 0.1, w: k.W * 0.56, h: k.H * 0.38};
    g.quiet = {x: Math.round(g.board.x + 40 * k.u), y: Math.round(g.board.y + 30 * k.u), width: Math.round(g.board.w - 80 * k.u), height: Math.round(g.board.h - 60 * k.u), under: [boardColor(k)]};
    g.anchors.surface = {y: Math.round(k.H * 0.84), x0: k.W * (k.portrait ? 0.6 : 0.76), x1: k.W * 0.98, ppm: k.ppm, layer: 'front'};
    return g;
  },
  back(k, g) {
    const {W, H, u, p, pal} = k;
    const out = [wall(k, g.floorY, {color: mixColor('#e9dfc9', pal.wall, 0.5), dado: true})];
    if (!k.portrait) out.push(interiorWindow(k, W * 0.03, H * 0.1, W * 0.17, H * 0.46, {view: 'trees', cols: 2, rows: 3}));
    const b = g.board;
    out.push(p.rect(b.x - 16 * u, b.y - 16 * u, b.w + 32 * u, b.h + 32 * u, pal.woodShade, {rx: 6 * u}));
    out.push(p.rect(b.x, b.y, b.w, b.h, boardColor(k), {stroke: false}));
    out.push(p.sheen(b.x, b.y, b.w, b.h * 0.3, 0.06));
    // Faint chalk smudges, never text.
    if (k.d.n >= 1) for (let i = 0; i < 3; i++) out.push(p.ellipse(b.x + b.w * p.rnd(0.15, 0.85), b.y + b.h * p.rnd(0.2, 0.8), b.w * p.rnd(0.08, 0.16), b.h * 0.05, '#ffffff', {opacity: 0.05, stroke: false}));
    out.push(p.rect(b.x - 10 * u, b.y + b.h + 8 * u, b.w + 20 * u, 14 * u, pal.wood, {}));
    for (const [cx, c] of [[0.2, '#ffffff'], [0.24, '#ffe28a'], [0.7, '#9ad0ff']]) out.push(p.rect(b.x + b.w * cx, b.y + b.h + 2 * u, 28 * u, 7 * u, c, {stroke: false, rx: 3 * u}));
    out.push(clock(k, k.portrait ? W * 0.5 : W * 0.92, k.portrait ? H * 0.05 : H * 0.14, 34 * u));
    if (!k.portrait) out.push(windowBeam(k, W * 0.03, H * 0.1, W * 0.17, H * 0.46, g.floorY));
    return out;
  },
  mid(k, g) {
    const {W, u, pal} = k;
    const out = [floor(k, g.floorY, {kind: 'tile', color: mixColor('#c7c0b2', pal.floor, 0.5)})];
    const dy = g.floorY - 0.7 * k.ppm * 0.8;
    const n = k.portrait ? 2 : 4;
    for (let i = 0; i < n; i++) {
      const x = W * (0.06 + i * (0.88 / n)), w = W * 0.88 / n - 40 * u;
      out.push(chair(k, x + w * 0.5, dy + 70 * u, g.floorY + 6 * u, {color: pal.accent, back: true}));
      out.push(desk(k, x, dy, w, g.floorY, {color: pal.woodLight, legs: 'metal'}));
    }
    return out;
  },
  front(k, g) {
    const {u, pal} = k;
    const s = g.anchors.surface;
    return [desk(k, s.x0, s.y, s.x1 - s.x0 + k.ov, k.H + 100 * u, {color: pal.wood, legs: 'wood', drawer: true, depth: 28})];
  }
};

const boardColor = k => k.p ? k.pal.g('#2f5845') : '#2f5845';

// ---------------------------------------------------------------------------
// Cafe

const cafe = {
  group: 'inside', label: 'Cafe',
  describe: 'a neighbourhood cafe: a brick wall with a menu board, shelves of cups, an espresso counter, pendant lights and a street window',
  geo(k) {
    const g = room(k, {floor: 0.72});
    g.counterY = Math.round(g.floorY - 1.0 * k.ppm * 0.86);
    g.anchors.counter = {y: g.counterY, x0: k.W * (k.portrait ? 0.08 : 0.42), x1: k.W * 0.94, ppm: k.ppm * 0.86, layer: 'mid'};
    g.anchors.surface = {y: Math.round(k.H * 0.86), x0: k.W * 0.02, x1: k.W * 0.24, ppm: k.ppm, layer: 'front'};
    g.quiet = k.portrait ? {x: Math.round(k.W * 0.1), y: Math.round(k.H * 0.06), width: Math.round(k.W * 0.8), height: Math.round(k.H * 0.16), under: [menuColor(k)]}
      : {x: Math.round(k.W * 0.48), y: Math.round(k.H * 0.09), width: Math.round(k.W * 0.3), height: Math.round(k.H * 0.28), under: [menuColor(k)]};
    return g;
  },
  back(k, g) {
    const {W, H, u, p, pal} = k;
    const {x0, w} = span(k);
    const out = [p.rect(x0, -2, w, g.floorY + 4, pal.brick, {stroke: false})];
    const bh = 26 * u, bw = 70 * u;
    for (let r = 0, y = 0; y < g.floorY; y += bh, r++) {
      out.push(p.line(x0, y, x0 + w, y, mixColor('#000000', pal.brick, 0.25), 1.6, {opacity: 0.8}));
      if (k.d.n >= 1 || k.d.outline) for (let x = x0 + (r % 2) * bw / 2; x < x0 + w; x += bw) out.push(p.line(x, y, x, y + bh, mixColor('#000000', pal.brick, 0.25), 1.6, {opacity: 0.8}));
      if (k.d.n >= 1 && r % 3 === 1) out.push(p.rect(x0 + p.rnd(0, w), y + 2 * u, bw - 4 * u, bh - 4 * u, pal.brickShade, {stroke: false, opacity: 0.6}));
    }
    // Street window on the left (landscape) with the street outside.
    if (!k.portrait) out.push(interiorWindow(k, W * 0.03, H * 0.08, W * 0.32, H * 0.5, {view: 'city', cols: 2, rows: 1, frame: pal.ink}));
    // Menu board.
    const q = g.quiet;
    out.push(p.rect(q.x - 20 * u, q.y - 20 * u, q.width + 40 * u, q.height + 40 * u, pal.woodShade, {rx: 6 * u}));
    out.push(p.rect(q.x - 6 * u, q.y - 6 * u, q.width + 12 * u, q.height + 12 * u, menuColor(k), {stroke: false}));
    // Cup shelves.
    const shX = k.portrait ? W * 0.12 : W * 0.8, shW = k.portrait ? W * 0.76 : W * 0.16;
    for (const sy of k.portrait ? [0.3, 0.38] : [0.16, 0.28, 0.4]) {
      const y = H * sy;
      for (let cx = shX + 16 * u; cx < shX + shW - 30 * u; cx += 44 * u) out.push(cup(k, cx, y, p.pick([pal.white, pal.cream, pal.accent, pal.primaryLight])));
      out.push(p.rect(shX, y, shW, 10 * u, pal.woodLight, {}));
    }
    for (const fx of k.portrait ? [0.25, 0.75] : [0.46, 0.62, 0.78]) out.push(pendant(k, W * fx, H * (k.portrait ? 0.44 : 0.42), {size: 54, shade: pal.accent}));
    return out;
  },
  mid(k, g) {
    const {W, u, p, pal} = k;
    const out = [floor(k, g.floorY, {kind: 'wood', color: pal.woodShade})];
    const c = g.anchors.counter;
    out.push(counter(k, c.x0, g.counterY, c.x1 - c.x0 + k.ov, g.floorY, {top: pal.wood, body: mixColor('#000000', pal.primary, 0.3), doors: 1, toe: true}));
    // Espresso machine.
    const ex = c.x0 + (c.x1 - c.x0) * 0.62, ew = 190 * u, eh = 150 * u;
    out.push(p.rect(ex, g.counterY - eh, ew, eh, pal.metal, {rx: 10 * u}));
    out.push(p.rect(ex + 12 * u, g.counterY - eh + 14 * u, ew - 24 * u, 26 * u, pal.metalShade, {rx: 4 * u}));
    for (const s of [0.3, 0.7]) {
      out.push(p.rect(ex + ew * s - 12 * u, g.counterY - eh * 0.52, 24 * u, 22 * u, pal.black, {rx: 4 * u}));
      out.push(cup(k, ex + ew * s, g.counterY - 4 * u, pal.white));
    }
    out.push(p.sheen(ex, g.counterY - eh, ew, eh * 0.3, 0.35));
    out.push(p.shade(ex, g.counterY - eh, ew, eh, 'right', 0.25));
    // Cake stand and till.
    out.push(p.rect(ex - 150 * u, g.counterY - 70 * u, 90 * u, 70 * u, pal.black, {rx: 6 * u}));
    out.push(p.rect(ex - 140 * u, g.counterY - 62 * u, 70 * u, 34 * u, k.time === 'night' ? '#6aa0ff' : '#a7c7e8', {glow: k.time === 'night', stroke: false}));
    // Tables in the room.
    for (const fx of k.portrait ? [0.18] : [0.14, 0.32]) out.push(cafeTable(k, W * fx, g.groundY - 20 * u));
    return out;
  },
  front(k, g) {
    const {u, pal} = k;
    const s = g.anchors.surface;
    return [desk(k, -k.ov, s.y, s.x1 + k.ov, k.H + 80 * u, {color: pal.woodLight, legs: 'wood'})];
  }
};

const menuColor = k => k.pal.g('#24282c');

function cup(k, cx, y, c) {
  const {p, u} = k;
  return [
    p.path(`M${f(cx - 14 * u)} ${f(y - 28 * u)}L${f(cx + 14 * u)} ${f(y - 28 * u)}L${f(cx + 11 * u)} ${f(y)}L${f(cx - 11 * u)} ${f(y)}Z`, c, {}),
    p.stroke(`M${f(cx + 13 * u)} ${f(y - 22 * u)}Q${f(cx + 26 * u)} ${f(y - 18 * u)} ${f(cx + 12 * u)} ${f(y - 8 * u)}`, c, 4)
  ];
}

function cafeTable(k, cx, floorY) {
  const {p, pal, u} = k;
  const ty = floorY - 0.75 * k.ppm * 0.92;
  return [
    p.shadow(cx, floorY, 90 * u, 12 * u),
    p.rect(cx - 6 * u, ty, 12 * u, floorY - ty, pal.ink, {}),
    p.ellipse(cx, floorY - 4 * u, 46 * u, 9 * u, pal.ink, {}),
    p.ellipse(cx, ty, 90 * u, 14 * u, pal.white, {}),
    cup(k, cx - 20 * u, ty - 2 * u, pal.accent)
  ];
}

// ---------------------------------------------------------------------------
// Workshop

const workshop = {
  group: 'inside', label: 'Workshop',
  describe: 'a maker workshop: a pegboard of tools, a sturdy workbench, shelves of parts bins and a hanging work lamp',
  geo(k) {
    const g = room(k, {floor: 0.72});
    g.benchY = Math.round(g.floorY - 0.92 * k.ppm * 0.86);
    g.anchors.surface = {y: g.benchY, x0: k.W * (k.portrait ? 0.08 : 0.22), x1: k.W * (k.portrait ? 0.92 : 0.7), ppm: k.ppm * 0.86, layer: 'mid'};
    g.quiet = k.portrait ? {x: Math.round(k.W * 0.06), y: Math.round(k.H * 0.04), width: Math.round(k.W * 0.88), height: Math.round(k.H * 0.12), under: [k.pal.concrete]}
      : {x: Math.round(k.W * 0.04), y: Math.round(k.H * 0.06), width: Math.round(k.W * 0.92), height: Math.round(k.H * 0.12), under: [k.pal.concrete]};
    return g;
  },
  back(k, g) {
    const {W, H, u, p, pal} = k;
    const out = [wall(k, g.floorY, {color: mixColor('#a9a59d', pal.wall, 0.6)})];
    const pb = k.portrait ? {x: W * 0.08, y: H * 0.2, w: W * 0.84, h: H * 0.3} : {x: W * 0.22, y: H * 0.2, w: W * 0.48, h: H * 0.32};
    out.push(p.rect(pb.x, pb.y, pb.w, pb.h, pal.woodLight, {}));
    if (k.d.n >= 1) for (let y = pb.y + 20 * u; y < pb.y + pb.h; y += 28 * u) for (let x = pb.x + 20 * u; x < pb.x + pb.w; x += 28 * u) out.push(p.circle(x, y, 2.4 * u, mixColor('#000000', pal.woodLight, 0.4), {stroke: false}));
    // Tools on the pegboard.
    const tx = i => pb.x + pb.w * (0.08 + i * 0.12);
    out.push(tool(k, 'hammer', tx(0), pb.y + pb.h * 0.2), tool(k, 'wrench', tx(1), pb.y + pb.h * 0.18), tool(k, 'saw', tx(2), pb.y + pb.h * 0.16), tool(k, 'screwdriver', tx(4), pb.y + pb.h * 0.2), tool(k, 'screwdriver', tx(4.6), pb.y + pb.h * 0.24), tool(k, 'pliers', tx(5.5), pb.y + pb.h * 0.2), tool(k, 'wrench', tx(6.6), pb.y + pb.h * 0.22));
    out.push(p.circle(pb.x + pb.w * 0.5, pb.y + pb.h * 0.72, 46 * u, 'none', {stroke: pal.accent, sw: 5}));
    // Parts bins on shelves at the right.
    if (!k.portrait) {
      for (const sy of [0.18, 0.32, 0.46]) {
        for (let i = 0; i < 4; i++) out.push(p.rect(W * 0.78 + i * 54 * u, H * sy - 40 * u, 46 * u, 40 * u, [pal.primary, pal.accent, pal.primaryLight, pal.accentShade][i], {rx: 3 * u}));
        out.push(p.rect(W * 0.77, H * sy, W * 0.2, 10 * u, pal.metalShade, {}));
      }
      out.push(interiorWindow(k, W * 0.04, H * 0.12, W * 0.12, H * 0.28, {view: 'trees', cols: 2, rows: 2, frame: pal.metalShade}));
    }
    return out;
  },
  mid(k, g) {
    const {W, u, p, pal} = k;
    const out = [floor(k, g.floorY, {kind: 'concrete'})];
    const s = g.anchors.surface;
    const bw = s.x1 - s.x0;
    out.push(p.shadow(s.x0 + bw / 2, g.floorY + 6 * u, bw * 0.55, 16 * u));
    for (const lx of [s.x0 + 20 * u, s.x1 - 50 * u]) out.push(p.rect(lx, g.benchY, 30 * u, g.floorY - g.benchY, pal.woodShade, {}));
    out.push(p.rect(s.x0 + 20 * u, g.floorY - 70 * u, bw - 40 * u, 18 * u, pal.woodShade, {}));
    out.push(p.rect(s.x0, g.benchY, bw, 34 * u, pal.wood, {}));
    out.push(p.sheen(s.x0, g.benchY, bw, 10 * u, 0.3));
    // A vise on the bench end.
    out.push(p.rect(s.x1 - 110 * u, g.benchY - 46 * u, 80 * u, 46 * u, pal.accentShade, {rx: 4 * u}));
    out.push(p.rect(s.x1 - 30 * u, g.benchY - 30 * u, 50 * u, 8 * u, pal.metalShade, {}));
    // Toolbox and crates under the bench.
    out.push(p.rect(s.x0 + bw * 0.3, g.floorY - 120 * u, 170 * u, 120 * u, pal.primary, {rx: 8 * u}));
    out.push(p.rect(s.x0 + bw * 0.3, g.floorY - 120 * u, 170 * u, 24 * u, pal.primaryShade, {rx: 8 * u}));
    // Hanging work lamp.
    out.push(pendant(k, s.x0 + bw * 0.5, k.H * (k.portrait ? 0.5 : 0.08), {size: 80, shade: pal.metalShade, cord: 0}));
    if (k.time === 'day') out.push(rays(k, W * 0.1, 0, {angle: 70, spread: 18, count: 3, alpha: 0.1}));
    return out;
  },
  front(k) {
    const {W, H, u, p, pal} = k;
    // A sawhorse at the left edge.
    const x = W * (k.portrait ? 0.02 : 0.06), y = H * 0.9;
    return [
      p.shadow(x + 90 * u, H, 140 * u, 16 * u),
      p.line(x, H + 10 * u, x + 50 * u, y, pal.woodShade, 14), p.line(x + 100 * u, H + 10 * u, x + 50 * u, y, pal.woodShade, 14),
      p.rect(x - 30 * u, y - 20 * u, 260 * u, 24 * u, pal.woodLight, {})
    ];
  }
};

function tool(k, kind, x, y) {
  const {p, pal, u} = k;
  const steel = pal.metalShade, grip = pal.accent;
  if (kind === 'hammer') return [p.rect(x - 5 * u, y, 10 * u, 110 * u, pal.woodShade, {}), p.rect(x - 30 * u, y - 6 * u, 60 * u, 22 * u, steel, {rx: 4 * u})];
  if (kind === 'wrench') return [p.rect(x - 7 * u, y, 14 * u, 120 * u, steel, {rx: 6 * u}), p.circle(x, y, 20 * u, steel, {}), p.rect(x - 6 * u, y - 22 * u, 12 * u, 22 * u, pal.woodLight, {stroke: false})];
  if (kind === 'saw') return [p.path(pts([[x - 10 * u, y], [x + 50 * u, y + 10 * u], [x + 50 * u, y + 40 * u], [x - 10 * u, y + 150 * u]]), pal.metalLight, {}), p.rect(x - 34 * u, y - 10 * u, 34 * u, 60 * u, grip, {rx: 10 * u})];
  if (kind === 'pliers') return [p.line(x - 10 * u, y, x + 6 * u, y + 110 * u, grip, 10), p.line(x + 10 * u, y, x - 6 * u, y + 110 * u, grip, 10), p.circle(x, y + 20 * u, 8 * u, steel, {})];
  return [p.rect(x - 4 * u, y, 8 * u, 70 * u, steel, {}), p.rect(x - 10 * u, y + 66 * u, 20 * u, 46 * u, grip, {rx: 6 * u})];
}

// ---------------------------------------------------------------------------
// Server room

const serverRoom = {
  group: 'inside', label: 'Server room',
  describe: 'a data centre aisle: rows of racks with blinking status lights, cable trays overhead and a raised tiled floor in cool light',
  light: {day: {color: '#cfe3ff', intensity: 0.7}, dusk: {color: '#bcd4ff', intensity: 0.6}, night: {color: '#7fb4ff', intensity: 0.45}},
  geo(k) {
    const g = room(k, {floor: 0.74});
    g.quiet = k.portrait ? {x: Math.round(k.W * 0.06), y: Math.round(k.H * 0.04), width: Math.round(k.W * 0.88), height: Math.round(k.H * 0.1), under: [serverWall(k)]}
      : {x: Math.round(k.W * 0.3), y: Math.round(k.H * 0.05), width: Math.round(k.W * 0.4), height: Math.round(k.H * 0.12), under: [serverWall(k)]};
    return g;
  },
  back(k, g) {
    const {W, H, u, p, pal} = k;
    const {x0, w} = span(k);
    const wc = serverWall(k);
    const out = [p.rect(x0, -2, w, g.floorY + 4, p.lin([[0, mixColor('#000000', wc, 0.4)], [1, wc]], 0, 0, 0, g.floorY), {stroke: false})];
    // Far racks: a darker row, smaller, for depth.
    const farTop = g.floorY - 1.9 * k.ppm * 0.62;
    for (let x = x0; x < x0 + w; x += 120 * u) out.push(rack(k, x, farTop, 110 * u, g.floorY - farTop - 30 * u, 0.55));
    out.push(haze(k, farTop - 40 * u, g.floorY, {alpha: 1.2, color: k.time === 'night' ? '#1b3f7a' : '#9ec4f0'}));
    // Cable trays and strip lights.
    for (const ty of [0.08, 0.16]) {
      out.push(p.rect(x0, H * ty, w, 14 * u, pal.metalShade, {}));
      if (k.d.n >= 1) for (let x = x0; x < x0 + w; x += 40 * u) out.push(p.line(x, H * ty, x + 20 * u, H * ty + 14 * u, mixColor('#000000', pal.metalShade, 0.3), 1.4));
    }
    for (let x = x0 + 80 * u; x < x0 + w; x += 360 * u) {
      out.push(p.rect(x, H * 0.03, 220 * u, 12 * u, '#e8f2ff', {glow: true, rx: 6 * u}));
      out.push(p.glow(x + 110 * u, H * 0.04, 260 * u, '#bcd8ff', k.time === 'night' ? 0.25 : 0.4, {ry: 80 * u}));
    }
    return out;
  },
  mid(k, g) {
    const {W, u, p, pal} = k;
    const out = [];
    // Raised floor tiles.
    out.push(floor(k, g.floorY, {kind: 'tile', color: mixColor('#c6cdd6', pal.floor, 0.6)}));
    const top = g.floorY - 2 * k.ppm * 0.86;
    const rw = (k.portrait ? 210 : 190) * u;
    const lefts = k.portrait ? [0.02, 0.24] : [0.02, 0.13, 0.24, 0.35];
    const rights = k.portrait ? [0.56, 0.78] : [0.56, 0.67, 0.78, 0.89];
    for (const fx of [...lefts, ...rights]) out.push(rack(k, W * fx, top, rw, g.floorY - top, 1));
    // Cool light down the aisle.
    out.push(p.pool(W * 0.46, g.floorY + 40 * u, W * 0.2, 50 * u, '#bfe0ff', k.time === 'night' ? 0.35 : 0.2));
    return out;
  },
  front() { return []; },
  fx(k) {
    return k.time === 'night' ? [] : rays(k, k.W * 0.46, 0, {angle: 90, spread: 30, count: 3, alpha: 0.08, color: '#d6ecff'});
  }
};

const serverWall = k => (k.time === 'night' ? '#0e1830' : k.pal.g('#2a3446'));

function rack(k, x, y, w, h, scale = 1) {
  const {p, pal, u, time} = k;
  const body = time === 'night' ? '#161b26' : k.pal.g('#20252f');
  const out = [p.rect(x, y, w, h, body, {rx: 4 * u})];
  const units = Math.floor((h - 30 * u) / (26 * u * scale));
  const leds = [pal.neonA, pal.neonB, '#58f08c', '#58f08c', '#58f08c'];
  for (let i = 0; i < units; i++) {
    const uy = y + 14 * u + i * 26 * u * scale;
    out.push(p.rect(x + 10 * u, uy, w - 20 * u, 20 * u * scale, mixColor('#ffffff', body, 0.06), {stroke: false, rx: 2 * u}));
    const n = 2 + Math.floor(p.rnd(0, 3));
    for (let j = 0; j < n; j++) {
      if (p.rnd() < 0.25) continue;
      const c = p.pick(leds);
      out.push(p.rect(x + w - 26 * u - j * 12 * u, uy + 7 * u * scale, 6 * u, 6 * u * scale, c, {glow: true, stroke: false}));
    }
    if (k.d.n >= 1 && p.rnd() < 0.3) out.push(p.rect(x + 16 * u, uy + 6 * u * scale, w * 0.4, 8 * u * scale, mixColor('#000000', body, 0.4), {stroke: false}));
  }
  if (k.d.n >= 1 && time !== 'day') out.push(p.glow(x + w - 30 * u, y + h * 0.5, w * 0.9, pal.neonA, 0.12));
  out.push(p.shade(x, y, w, h, 'right', 0.3));
  return out;
}

// ---------------------------------------------------------------------------
// Studio

const studio = {
  group: 'inside', label: 'Creator studio',
  describe: 'a creator studio: acoustic panels, a neon sign shape, a ring light, a softbox and a camera on a tripod',
  geo(k) {
    const g = room(k, {floor: 0.74});
    g.anchors.surface = {y: Math.round(g.floorY - 0.76 * k.ppm * 0.86), x0: k.W * 0.36, x1: k.W * 0.64, ppm: k.ppm * 0.86, layer: 'mid'};
    g.quiet = k.portrait ? {x: Math.round(k.W * 0.06), y: Math.round(k.H * 0.04), width: Math.round(k.W * 0.88), height: Math.round(k.H * 0.12), under: [studioWall(k)]}
      : {x: Math.round(k.W * 0.06), y: Math.round(k.H * 0.06), width: Math.round(k.W * 0.3), height: Math.round(k.H * 0.3), under: [studioWall(k)]};
    return g;
  },
  back(k, g) {
    const {W, H, u, p, pal} = k;
    const wc = studioWall(k);
    const out = [wall(k, g.floorY, {color: wc, shade: mixColor('#000000', wc, 0.2)})];
    // Acoustic foam panels.
    const panels = k.portrait ? [[0.1, 0.3], [0.56, 0.3]] : [[0.4, 0.16], [0.52, 0.16], [0.64, 0.16]];
    for (const [fx, fy] of panels) {
      const x = W * fx, y = H * fy, s = (k.portrait ? 0.34 : 0.1) * W;
      out.push(p.rect(x, y, s, s, mixColor('#000000', pal.primary, 0.45), {rx: 4 * u}));
      if (k.d.n >= 1) for (let i = 1; i < 6; i++) out.push(p.line(x + s * i / 6, y + 6 * u, x + s * i / 6, y + s - 6 * u, mixColor('#000000', pal.primary, 0.6), 3));
    }
    // A neon shape: a ring and a bolt (no lettering).
    const nx = W * (k.portrait ? 0.5 : 0.8), ny = H * (k.portrait ? 0.48 : 0.26), r = 70 * u;
    out.push(neonTube(k, `M${f(nx - r)} ${f(ny)}A${f(r)} ${f(r)} 0 1 1 ${f(nx + r)} ${f(ny)}A${f(r)} ${f(r)} 0 1 1 ${f(nx - r)} ${f(ny)}`, pal.neonB, 7));
    out.push(neonTube(k, `M${f(nx + 10 * u)} ${f(ny - 46 * u)}L${f(nx - 20 * u)} ${f(ny + 6 * u)}L${f(nx + 12 * u)} ${f(ny + 2 * u)}L${f(nx - 12 * u)} ${f(ny + 50 * u)}`, pal.neonA, 7));
    if (k.d.n >= 1) out.push(p.glow(nx, ny, r * 3.4, pal.neonB, k.time === 'day' ? 0.12 : 0.32));
    if (!k.portrait) out.push(shelf(k, W * 0.06, H * 0.5, W * 0.22, {}));
    return out;
  },
  mid(k, g) {
    const {W, u, p, pal} = k;
    const out = [floor(k, g.floorY, {kind: 'wood', color: mixColor('#000000', pal.wood, 0.2)})];
    out.push(rug(k, W * 0.5, g.groundY, W * 0.5, 80 * u, {color: mixColor('#000000', pal.accent, 0.3)}));
    const s = g.anchors.surface;
    out.push(desk(k, s.x0, s.y, s.x1 - s.x0, g.floorY + 10 * u, {color: pal.ink, legs: 'metal'}));
    // Mic on an arm.
    out.push(p.stroke(`M${f(s.x0 + 60 * u)} ${f(s.y)}L${f(s.x0 + 90 * u)} ${f(s.y - 120 * u)}L${f(s.x0 + 170 * u)} ${f(s.y - 150 * u)}`, pal.metalShade, 6));
    out.push(p.rect(s.x0 + 160 * u, s.y - 190 * u, 34 * u, 70 * u, pal.black, {rx: 16 * u}));
    // Ring light and softbox on stands.
    const rl = W * (k.portrait ? 0.82 : 0.76), top = g.floorY - 1.75 * k.ppm * 0.86;
    out.push(standLegs(k, rl, g.floorY + 12 * u, top + 90 * u));
    out.push(p.glow(rl, top, 220 * u, '#fff7ea', k.time === 'night' ? 0.4 : 0.25));
    out.push(p.circle(rl, top, 82 * u, 'none', {stroke: '#fff6ea', sw: 9, glow: true}));
    out.push(p.circle(rl, top, 82 * u, 'none', {stroke: pal.ink, sw: 2}));
    const sb = W * (k.portrait ? 0.16 : 0.2);
    out.push(standLegs(k, sb, g.floorY + 12 * u, top + 60 * u));
    out.push(p.path(pts([[sb - 90 * u, top - 70 * u], [sb + 90 * u, top - 70 * u], [sb + 40 * u, top + 60 * u], [sb - 40 * u, top + 60 * u]]), '#fbf6ee', {glow: true}));
    out.push(p.glow(sb, top, 240 * u, '#fff4e4', 0.22));
    // Camera on a tripod, near the frame edge.
    const cx = W * (k.portrait ? 0.5 : 0.92);
    if (!k.portrait) {
      out.push(standLegs(k, cx, g.groundY + 60 * u, g.floorY - 120 * u));
      out.push(p.rect(cx - 50 * u, g.floorY - 170 * u, 100 * u, 60 * u, pal.black, {rx: 8 * u}));
      out.push(p.rect(cx - 90 * u, g.floorY - 160 * u, 44 * u, 40 * u, pal.metalShade, {rx: 6 * u}));
      out.push(p.circle(cx + 30 * u, g.floorY - 158 * u, 6 * u, '#ff4d4d', {glow: true, stroke: false}));
    }
    return out;
  },
  front() { return []; }
};

const studioWall = k => k.pal.g(mixColor(k.pal.brand.primary, '#2b2f3a', 0.12));

function standLegs(k, x, floorY, top) {
  const {p, pal, u} = k;
  return [
    p.line(x, top, x, floorY - 40 * u, pal.metalShade, 5),
    p.line(x, floorY - 50 * u, x - 50 * u, floorY, pal.metalShade, 5),
    p.line(x, floorY - 50 * u, x + 50 * u, floorY, pal.metalShade, 5),
    p.line(x, floorY - 50 * u, x + 8 * u, floorY + 4 * u, pal.metalShade, 5)
  ];
}

// ---------------------------------------------------------------------------
// Gym

const gym = {
  group: 'inside', label: 'Gym',
  describe: 'a gym: high windows, a mirror wall, a dumbbell rack, kettlebells, a bench and a rubber floor with a brand-colour stripe',
  geo(k) {
    const g = room(k, {floor: 0.72});
    g.quiet = k.portrait ? {x: Math.round(k.W * 0.06), y: Math.round(k.H * 0.2), width: Math.round(k.W * 0.88), height: Math.round(k.H * 0.12), under: [k.pal.wall]}
      : {x: Math.round(k.W * 0.06), y: Math.round(k.H * 0.28), width: Math.round(k.W * 0.88), height: Math.round(k.H * 0.12), under: [k.pal.wall]};
    return g;
  },
  back(k, g) {
    const {W, H, u, p, pal} = k;
    const {x0, w} = span(k);
    const out = [wall(k, g.floorY, {color: mixColor('#d8d6d2', pal.wall, 0.5)})];
    // High windows.
    const wy = H * 0.05, wh = H * (k.portrait ? 0.1 : 0.16);
    const n = k.portrait ? 2 : 4;
    for (let i = 0; i < n; i++) out.push(interiorWindow(k, W * (0.06 + i * 0.235), wy, W * (k.portrait ? 0.4 : 0.2), wh, {view: 'city', cols: 3, rows: 1, frame: pal.ink}));
    // A brand stripe and a mirror wall.
    const sy = g.quiet.y + g.quiet.height + 20 * u;
    out.push(p.rect(x0, sy, w, 18 * u, pal.primary, {stroke: false}));
    out.push(p.rect(x0, sy + 26 * u, w, 8 * u, pal.accent, {stroke: false}));
    const my = sy + 60 * u;
    out.push(p.rect(x0, my, w, g.floorY - my - 20 * u, p.lin([[0, mixColor('#ffffff', pal.glass, 0.3)], [1, pal.glass]], 0, my, 0, g.floorY), {stroke: false}));
    for (let x = x0 + 300 * u; x < x0 + w; x += 300 * u) out.push(p.line(x, my, x, g.floorY - 20 * u, pal.metalShade, 3));
    if (k.d.n >= 1) for (let x = x0; x < x0 + w; x += 300 * u) out.push(p.path(pts([[x + 40 * u, g.floorY - 20 * u], [x + 120 * u, my], [x + 160 * u, my], [x + 80 * u, g.floorY - 20 * u]]), '#ffffff', {opacity: 0.14, stroke: false}));
    for (const fx of k.portrait ? [0.5] : [0.2, 0.5, 0.8]) out.push(pendant(k, W * fx, H * 0.24, {size: 60, shade: pal.ink, cord: H * 0.21}));
    return out;
  },
  mid(k, g) {
    const {W, u, p, pal} = k;
    const {x0, w} = span(k);
    const out = [floor(k, g.floorY, {kind: 'concrete', color: k.pal.g('#3c4048')})];
    out.push(p.rect(x0, g.floorY + (k.H - g.floorY) * 0.68, w, 10 * u, pal.accent, {stroke: false, opacity: 0.9}));
    // Dumbbell rack.
    const rx = W * (k.portrait ? 0.06 : 0.06), rw = W * (k.portrait ? 0.44 : 0.3), ry = g.floorY - 0.8 * k.ppm * 0.86;
    out.push(p.shadow(rx + rw / 2, g.floorY + 4 * u, rw * 0.55, 14 * u));
    for (const lx of [rx + 10 * u, rx + rw - 24 * u]) out.push(p.rect(lx, ry, 14 * u, g.floorY - ry, pal.ink, {}));
    for (const [row, dy] of [[0, 0], [1, 70 * u]]) {
      out.push(p.rect(rx, ry + dy, rw, 10 * u, pal.metalShade, {}));
      for (let i = 0; i < (k.portrait ? 4 : 6); i++) {
        const cx = rx + 40 * u + i * ((rw - 80 * u) / ((k.portrait ? 4 : 6) - 1)), cy = ry + dy - 14 * u;
        const s = (1 + i * 0.12 + row * 0.2);
        out.push(p.rect(cx - 30 * u, cy - 2 * u, 60 * u, 6 * u, pal.metalShade, {stroke: false}));
        for (const sx of [-1, 1]) out.push(p.rect(cx + sx * 24 * u - 7 * u * s, cy - 12 * u * s, 14 * u * s, 26 * u * s, pal.black, {rx: 4 * u}));
      }
    }
    // Kettlebells and a bench.
    const kx = W * (k.portrait ? 0.62 : 0.62);
    for (let i = 0; i < 3; i++) {
      const cx = kx + i * 70 * u, s = 1 - i * 0.15;
      out.push(p.circle(cx, g.floorY - 26 * u * s, 26 * u * s, [pal.primary, pal.accent, pal.ink][i], {}));
      out.push(p.path(`M${f(cx - 16 * u * s)} ${f(g.floorY - 40 * u * s)}Q${f(cx)} ${f(g.floorY - 76 * u * s)} ${f(cx + 16 * u * s)} ${f(g.floorY - 40 * u * s)}`, null, {stroke: [pal.primary, pal.accent, pal.ink][i], sw: 4}));
    }
    if (!k.portrait) {
      const bx = W * 0.78, by = g.floorY - 0.45 * k.ppm;
      out.push(p.shadow(bx + 110 * u, g.floorY + 6 * u, 140 * u, 12 * u));
      out.push(p.rect(bx, by, 240 * u, 26 * u, pal.black, {rx: 10 * u}));
      for (const lx of [bx + 30 * u, bx + 190 * u]) out.push(p.rect(lx, by + 26 * u, 16 * u, g.floorY - by - 26 * u, pal.metalShade, {}));
    }
    return out;
  },
  front(k) {
    const {W, H, u, p, pal} = k;
    // A medicine ball and a mat at the bottom edge.
    return [
      p.shadow(W * 0.9, H - 10 * u, 110 * u, 18 * u),
      p.circle(W * 0.9, H - 70 * u, 80 * u, pal.accentShade, {}),
      p.path(`M${f(W * 0.9 - 80 * u)} ${f(H - 70 * u)}Q${f(W * 0.9)} ${f(H - 30 * u)} ${f(W * 0.9 + 80 * u)} ${f(H - 70 * u)}`, null, {stroke: pal.ink, sw: 2}),
      p.shade(W * 0.9 - 80 * u, H - 150 * u, 160 * u, 160 * u, 'right', 0.3, {rx: 80 * u})
    ];
  }
};

export const INSIDE = {
  office, 'home-desk': homeDesk, kitchen, 'living-room': livingRoom, classroom, cafe, workshop, 'server-room': serverRoom, studio, gym
};
