// Inside worlds: office, home desk, kitchen, living room and cafe.
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

export const INSIDE = {
  office, 'home-desk': homeDesk, kitchen, 'living-room': livingRoom, cafe
};
