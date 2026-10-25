// Outside worlds: park, beach, mountains and forest. Open skies carry the time of day (a high sun, a low warm sun, or
// moon and stars); the land is layered far to near so a camera move shows
// depth, with haze between the layers at standard and rich detail.

import {mixColor} from '../catalog-b-base.mjs';
import {f, pts} from './pen.mjs';
import {span, sky, skyBody, hills, tree, lampPost, haze, rays, starField, cloud} from './common.mjs';

// Outside worlds are seen from further back than rooms: people stand smaller.
export const OUTSIDE_SCALE = 0.62;

function land(k, {horizon = 0.58, ground = 0.86, quiet = 0.24} = {}) {
  const {W, H, portrait} = k;
  const ppm = k.ppm * OUTSIDE_SCALE;
  const horizonY = Math.round(H * (portrait ? horizon + 0.04 : horizon));
  const groundY = Math.round(H * ground);
  return {
    horizonY, groundY, ppm,
    anchors: {
      ground: {y: groundY, x0: W * 0.04, x1: W * 0.96, ppm},
      far: {y: Math.round(horizonY + (groundY - horizonY) * 0.3), x0: W * 0.04, x1: W * 0.96, ppm: ppm * 0.55, layer: 'mid'},
      sky: {y: Math.round(H * 0.2), x0: W * 0.08, x1: W * 0.92, ppm: ppm * 0.8, layer: 'back'}
    },
    quiet: {x: Math.round(W * 0.06), y: Math.round(H * 0.04), width: Math.round(W * 0.88), height: Math.round(H * (portrait ? quiet * 0.8 : quiet)), under: [k.pal.skyTop, k.pal.skyMid]}
  };
}

/** A ground band from y to the bottom with a soft gradient and grass tufts. */
function grassField(k, y, {color = null, tufts = true} = {}) {
  const {p, pal, u, H, d} = k;
  const {x0, w} = span(k);
  const c = color ?? pal.grass;
  const out = [p.rect(x0, y, w, H - y + 4, p.lin([[0, mixColor('#000000', c, 0.06)], [1, mixColor('#000000', c, 0.22)]], 0, y, 0, H), {stroke: false})];
  if (tufts && d.n >= 1) for (let i = 0; i < 46; i++) {
    const tx = x0 + p.rnd() * w, ty = y + Math.pow(p.rnd(), 0.8) * (H - y);
    const s = (0.5 + (ty - y) / (H - y)) * 10 * u;
    out.push(p.stroke(`M${f(tx - s)} ${f(ty)}L${f(tx - s * 0.4)} ${f(ty - s * 1.6)}M${f(tx)} ${f(ty)}L${f(tx)} ${f(ty - s * 2)}M${f(tx + s)} ${f(ty)}L${f(tx + s * 0.5)} ${f(ty - s * 1.5)}`, pal.grassShade, 2));
  }
  return out;
}

// ---------------------------------------------------------------------------

const park = {
  group: 'outside', label: 'Park',
  describe: 'a city park: rolling lawns, trees in three depths, a winding path, a pond, a bench and a lamp, with the skyline beyond',
  geo(k) { return land(k, {horizon: 0.5, ground: 0.84}); },
  back(k, g) {
    const {pal, u, H} = k;
    return [
      sky(k, g.horizonY, {}),
      hills(k, g.horizonY + 20 * u, H * 0.06, mixColor(pal.farther, pal.grass, 0.3), {bumps: 4}),
      haze(k, g.horizonY - H * 0.14, g.horizonY + 30 * u, {alpha: 0.9})
    ];
  },
  mid(k, g) {
    const {W, H, u, p, pal} = k;
    const out = [hills(k, g.horizonY + 70 * u, H * 0.05, mixColor('#000000', pal.grass, 0.1), {bumps: 3, phase: 2})];
    // Far tree line.
    for (let i = 0; i < 14; i++) out.push(tree(k, (i / 13) * (W + 2 * k.ov) - k.ov, g.horizonY + 70 * u + p.rnd(-8, 8) * u, p.rnd(0.9, 1.3) * 160 * u * (k.portrait ? 1.2 : 1), {kind: i % 4 === 1 ? 'pine' : 'round', tone: 2}));
    out.push(haze(k, g.horizonY, g.horizonY + 90 * u, {alpha: 0.6}));
    out.push(grassField(k, g.horizonY + 80 * u, {}));
    // A pond and a path.
    const pondX = W * (k.portrait ? 0.7 : 0.74), pondY = g.horizonY + (g.groundY - g.horizonY) * 0.4;
    const water = k.time === 'night' ? '#16234a' : k.time === 'dusk' ? mixColor('#ffb37a', pal.water, 0.4) : mixColor(pal.water, pal.skyLow, 0.7);
    out.push(p.ellipse(pondX, pondY, W * 0.16, 34 * u, mixColor('#000000', pal.grass, 0.2), {stroke: false}));
    out.push(p.ellipse(pondX, pondY, W * 0.15, 28 * u, water, {}));
    if (k.d.n >= 1) out.push(p.ellipse(pondX - W * 0.04, pondY - 6 * u, W * 0.05, 4 * u, '#ffffff', {opacity: 0.35, stroke: false}));
    const pathC = mixColor('#ffffff', pal.sand, 0.15);
    out.push(p.path(`M${f(W * 0.3)} ${f(g.horizonY + 82 * u)}Q${f(W * 0.2)} ${f(g.horizonY + 200 * u)} ${f(W * 0.42)} ${f(g.groundY - 30 * u)}Q${f(W * 0.6)} ${f(H)} ${f(W * 0.5)} ${f(H + 10)}L${f(W * 0.84)} ${f(H + 10)}Q${f(W * 0.86)} ${f(g.groundY + 40 * u)} ${f(W * 0.52)} ${f(g.groundY - 40 * u)}Q${f(W * 0.3)} ${f(g.horizonY + 200 * u)} ${f(W * 0.33)} ${f(g.horizonY + 82 * u)}Z`, pathC, {}));
    // Mid trees either side.
    for (const [fx, kind] of k.portrait ? [[0.12, 'round'], [0.9, 'round']] : [[0.08, 'round'], [0.22, 'pine'], [0.92, 'round']]) out.push(tree(k, W * fx, g.groundY - 40 * u, 3.4 * g.ppm, {kind}));
    return out;
  },
  front(k, g) {
    const {W, u, p, pal} = k;
    const out = [lampPost(k, W * (k.portrait ? 0.82 : 0.66), g.groundY + 10 * u, 2.6 * g.ppm)];
    out.push(bench(k, W * (k.portrait ? 0.1 : 0.14), g.groundY + 6 * u, 1.6 * g.ppm));
    out.push(tree(k, W * (k.portrait ? 0.98 : 0.99), k.H + 40 * u, 2.4 * g.ppm, {kind: 'bush'}));
    void pal;
    return out;
  },
  fx(k) {
    const b = skyBody(k, k.H * 0.5);
    return k.time === 'night' ? [] : rays(k, b.x, b.y, {angle: k.time === 'dusk' ? 14 : 50, spread: 36, count: 5, alpha: 0.12});
  }
};

/** A park bench, its left end at x, seat w wide. */
export function bench(k, x, groundY, w) {
  const {p, pal, u} = k;
  const seatY = groundY - w * 0.28, c = pal.wood, iron = pal.ink;
  return [
    p.shadow(x + w / 2, groundY, w * 0.6, 10 * u),
    ...[0.08, 0.92].map(t => p.path(`M${f(x + w * t)} ${f(groundY)}L${f(x + w * t)} ${f(seatY - w * 0.32)}`, null, {stroke: iron, sw: 4})),
    ...[0, 1, 2].map(i => p.rect(x, seatY - w * (0.12 + i * 0.09), w, w * 0.05, c, {rx: 3 * u})),
    p.rect(x - w * 0.02, seatY, w * 1.04, w * 0.06, mixColor('#ffffff', c, 0.1), {rx: 3 * u})
  ];
}

const beach = {
  group: 'outside', label: 'Beach',
  describe: 'a beach: open sea to the horizon, rolling surf, warm sand, palms, an umbrella and a deck chair',
  geo(k) { return land(k, {horizon: 0.5, ground: 0.86}); },
  back(k, g) {
    const {W, H, u, p, pal, time} = k;
    const out = [sky(k, g.horizonY, {})];
    const sea = time === 'night' ? '#0b1838' : time === 'dusk' ? mixColor('#e07a6a', pal.water, 0.35) : pal.water;
    const {x0, w} = span(k);
    out.push(p.rect(x0, g.horizonY, w, H - g.horizonY, p.lin([[0, mixColor('#ffffff', sea, 0.12)], [1, mixColor('#000000', sea, 0.25)]], 0, g.horizonY, 0, H), {stroke: false}));
    // Glitter path under the sun or moon.
    const b = skyBody(k, g.horizonY);
    const glint = time === 'night' ? '#e6ecff' : time === 'dusk' ? '#ffd28a' : '#ffffff';
    for (let i = 0; i < 40; i++) {
      const y = g.horizonY + Math.pow(p.rnd(), 1.6) * (H - g.horizonY) * 0.5;
      const spread = 30 * u + (y - g.horizonY) * 0.5;
      out.push(p.rect(b.x + p.rnd(-1, 1) * spread, y, p.rnd(14, 60) * u, 3 * u, glint, {glow: true, stroke: false, opacity: p.rnd(0.3, 0.8)}));
    }
    // Swells.
    if (k.d.n >= 1 || k.d.outline) for (let i = 0; i < 6; i++) {
      const y = g.horizonY + (i + 1) * (H - g.horizonY) * 0.06;
      out.push(p.stroke(`M${f(x0 + p.rnd(0, 200) * u)} ${f(y)}Q${f(W * 0.3)} ${f(y - 6 * u)} ${f(W * 0.6)} ${f(y)}`, '#ffffff', 2, {opacity: 0.25}));
    }
    // A distant headland.
    out.push(hills(k, g.horizonY + 2 * u, 70 * u, pal.far, {bumps: 2, bottom: g.horizonY + 4 * u}));
    void u;
    return out;
  },
  mid(k, g) {
    const {W, H, u, p, pal} = k;
    const {x0, x1, w} = span(k);
    const shore = g.horizonY + (H - g.horizonY) * 0.36;
    const out = [];
    // Surf: a foam line over wet sand.
    out.push(p.path(`M${f(x0)} ${f(shore)}Q${f(W * 0.25)} ${f(shore - 20 * u)} ${f(W * 0.5)} ${f(shore + 6 * u)}T${f(x1)} ${f(shore)}L${f(x1)} ${f(H)}L${f(x0)} ${f(H)}Z`, mixColor('#000000', pal.sand, 0.12), {stroke: false}));
    out.push(p.path(`M${f(x0)} ${f(shore + 26 * u)}Q${f(W * 0.3)} ${f(shore + 8 * u)} ${f(W * 0.55)} ${f(shore + 32 * u)}T${f(x1)} ${f(shore + 24 * u)}L${f(x1)} ${f(H)}L${f(x0)} ${f(H)}Z`, p.lin([[0, pal.sand], [1, mixColor('#000000', pal.sand, 0.1)]], 0, shore, 0, H), {stroke: false}));
    out.push(p.stroke(`M${f(x0)} ${f(shore)}Q${f(W * 0.25)} ${f(shore - 20 * u)} ${f(W * 0.5)} ${f(shore + 6 * u)}T${f(x1)} ${f(shore)}`, '#ffffff', 7, {opacity: 0.85}));
    if (k.d.n >= 1) for (let i = 0; i < 40; i++) out.push(p.circle(x0 + p.rnd() * w, shore + 40 * u + p.rnd() * (H - shore), p.rnd(1, 2.5) * u, pal.sandShade, {stroke: false}));
    // Palms.
    for (const [fx, s] of k.portrait ? [[0.86, 1.2]] : [[0.08, 1.1], [0.16, 0.85], [0.92, 1.2]]) out.push(tree(k, W * fx, g.groundY - 10 * u, 3.6 * g.ppm * s, {kind: 'palm'}));
    return out;
  },
  front(k, g) {
    const {W, u, p, pal} = k;
    const ux = W * (k.portrait ? 0.2 : 0.7), uy = g.groundY + 10 * u, uh = 2.3 * g.ppm;
    const out = [p.shadow(ux + 20 * u, uy, 150 * u, 16 * u)];
    out.push(p.line(ux, uy, ux + 20 * u, uy - uh, pal.white, 5));
    const r = 1.1 * g.ppm;
    const cx = ux + 20 * u, cy = uy - uh;
    const segs = 6;
    for (let i = 0; i < segs; i++) {
      const a0 = Math.PI + i * Math.PI / segs, a1 = Math.PI + (i + 1) * Math.PI / segs;
      out.push(p.path(`M${f(cx)} ${f(cy - r * 0.15)}L${f(cx + Math.cos(a0) * r)} ${f(cy + Math.sin(a0) * r * 0.42 + r * 0.1)}Q${f(cx + Math.cos((a0 + a1) / 2) * r * 1.05)} ${f(cy + Math.sin((a0 + a1) / 2) * r * 0.42 + r * 0.24)} ${f(cx + Math.cos(a1) * r)} ${f(cy + Math.sin(a1) * r * 0.42 + r * 0.1)}Z`, i % 2 ? pal.white : pal.primary, {}));
    }
    // Deck chair.
    const dx = ux + 140 * u * (k.portrait ? 1.6 : 1);
    out.push(p.line(dx, uy, dx + 70 * u, uy - 120 * u, pal.woodShade, 6), p.line(dx + 90 * u, uy, dx + 30 * u, uy - 60 * u, pal.woodShade, 6));
    out.push(p.path(pts([[dx + 10 * u, uy - 20 * u], [dx + 64 * u, uy - 112 * u], [dx + 86 * u, uy - 100 * u], [dx + 40 * u, uy - 10 * u]]), pal.accent, {}));
    // A towel and a beach ball.
    out.push(p.rect(W * (k.portrait ? 0.56 : 0.36), g.groundY + 20 * u, 220 * u, 50 * u, pal.accentLight, {rx: 6 * u, transform: `rotate(-4 ${f(W * 0.4)} ${f(g.groundY)})`}));
    const bx = W * (k.portrait ? 0.86 : 0.5), by = k.H - 70 * u;
    out.push(p.circle(bx, by, 40 * u, pal.white, {}));
    out.push(p.path(`M${f(bx - 40 * u)} ${f(by)}Q${f(bx)} ${f(by - 30 * u)} ${f(bx + 40 * u)} ${f(by)}A${f(40 * u)} ${f(40 * u)} 0 0 0 ${f(bx - 40 * u)} ${f(by)}Z`, pal.primary, {stroke: false}));
    out.push(p.path(`M${f(bx - 10 * u)} ${f(by - 39 * u)}Q${f(bx + 14 * u)} ${f(by)} ${f(bx - 6 * u)} ${f(by + 39 * u)}`, null, {stroke: pal.accent, sw: 7}));
    return out;
  }
};

const mountains = {
  group: 'outside', label: 'Mountains',
  describe: 'mountain country: snow-capped ranges in three depths, pine slopes, a still lake and a lookout rock in front',
  geo(k) { return land(k, {horizon: 0.56, ground: 0.88}); },
  back(k, g) {
    const {pal, u, H} = k;
    return [
      sky(k, g.horizonY, {}),
      range(k, g.horizonY + 10 * u, H * 0.34, pal.farther, {snow: true, peaks: 4, seed: 1}),
      haze(k, g.horizonY - H * 0.2, g.horizonY + 20 * u, {alpha: 1}),
      range(k, g.horizonY + 30 * u, H * 0.24, pal.far, {snow: true, peaks: 5, seed: 2})
    ];
  },
  mid(k, g) {
    const {W, H, u, p, pal, time} = k;
    const {x0, w} = span(k);
    const out = [haze(k, g.horizonY - 40 * u, g.horizonY + 60 * u, {alpha: 0.8})];
    // Lake with a reflection band.
    const lakeY = g.horizonY + 40 * u;
    const water = time === 'night' ? '#0d1a3a' : time === 'dusk' ? mixColor('#ff9a7a', pal.water, 0.35) : mixColor(pal.water, pal.skyMid, 0.5);
    out.push(p.rect(x0, lakeY, w, 120 * u, p.lin([[0, mixColor('#ffffff', water, 0.15)], [1, water]], 0, lakeY, 0, lakeY + 120 * u), {stroke: false}));
    const b = skyBody(k, g.horizonY);
    out.push(p.rect(b.x - 24 * u, lakeY, 48 * u, 110 * u, time === 'night' ? '#e6ecff' : '#fff2c8', {glow: true, opacity: 0.25, stroke: false}));
    // Pine slopes either side.
    const slopeC = mixColor('#000000', pal.foliageShade, 0.15);
    out.push(p.path(`M${f(x0)} ${f(lakeY - 120 * u)}Q${f(W * 0.18)} ${f(lakeY - 60 * u)} ${f(W * 0.36)} ${f(lakeY + 100 * u)}L${f(W * 0.36)} ${f(H)}L${f(x0)} ${f(H)}Z`, slopeC, {}));
    out.push(p.path(`M${f(x0 + w)} ${f(lakeY - 160 * u)}Q${f(W * 0.8)} ${f(lakeY - 80 * u)} ${f(W * 0.6)} ${f(lakeY + 110 * u)}L${f(W * 0.6)} ${f(H)}L${f(x0 + w)} ${f(H)}Z`, slopeC, {}));
    for (let i = 0; i < 26; i++) {
      const left = i % 2 === 0;
      const t = p.rnd();
      const x = left ? x0 + t * (W * 0.34 - x0) : W * 0.62 + t * (x0 + w - W * 0.62);
      const y = lakeY - (left ? 110 : 150) * u * (1 - t) + p.rnd(20, 160) * u + (left ? t : 1 - t) * 60 * u;
      out.push(tree(k, x, y, p.rnd(110, 190) * u, {kind: 'pine', tone: 1}));
    }
    out.push(grassField(k, lakeY + 118 * u, {color: mixColor('#000000', pal.grass, 0.15)}));
    return out;
  },
  front(k, g) {
    const {W, H, u, p, pal} = k;
    // A lookout rock at the lower right and a pine at the left edge.
    const rx = W * (k.portrait ? 0.5 : 0.66);
    const out = [p.path(`M${f(rx - 220 * u)} ${f(H + 10)}Q${f(rx - 180 * u)} ${f(g.groundY - 60 * u)} ${f(rx)} ${f(g.groundY - 40 * u)}Q${f(rx + 260 * u)} ${f(g.groundY - 30 * u)} ${f(rx + 420 * u)} ${f(H + 10)}Z`, pal.rock, {})];
    out.push(p.path(`M${f(rx)} ${f(g.groundY - 40 * u)}Q${f(rx + 260 * u)} ${f(g.groundY - 30 * u)} ${f(rx + 420 * u)} ${f(H + 10)}L${f(rx + 200 * u)} ${f(H + 10)}Z`, pal.rockShade, {stroke: false, opacity: 0.6}));
    out.push(tree(k, W * 0.03, H + 20 * u, 4.4 * g.ppm, {kind: 'pine'}));
    return out;
  },
  fx(k) {
    const b = skyBody(k, k.H * 0.56);
    return k.time === 'night' ? [] : rays(k, b.x, b.y, {angle: k.time === 'dusk' ? 12 : 48, spread: 40, count: 5, alpha: 0.14});
  }
};

/** A mountain range along baseY up to h: jagged peaks with optional snow caps. */
function range(k, baseY, h, color, {snow = false, peaks = 4, seed = 0} = {}) {
  const {p, pal, u, H} = k;
  const {x0, x1} = span(k);
  const pts2 = [[x0, baseY]];
  const n = peaks * 2;
  for (let i = 0; i <= n; i++) {
    const x = x0 + (x1 - x0) * (i + 0.5 + (p.rnd() - 0.5) * 0.4) / (n + 1);
    const y = i % 2 ? baseY - h * p.rnd(0.25, 0.45) : baseY - h * p.rnd(0.65, 1);
    pts2.push([x, y]);
  }
  pts2.push([x1, baseY]);
  const out = [p.path(pts([...pts2, [x1, H], [x0, H]]), color, {stroke: k.d.outline ? true : false, sw: 0.7})];
  // Shaded faces: the side away from the light is darker.
  const shadeC = mixColor('#000000', color, 0.18);
  for (let i = 1; i < pts2.length - 1; i++) {
    const [x, y] = pts2[i];
    if (y > baseY - h * 0.6) continue;
    const [nx, ny] = pts2[i + 1];
    out.push(p.path(pts([[x, y], [nx, ny], [nx, baseY], [x + (nx - x) * 0.3, baseY]]), shadeC, {stroke: false}));
    if (snow) {
      const s = 0.22;
      const [px, py] = pts2[i - 1];
      out.push(p.path(pts([[x, y], [x + (nx - x) * s, y + (ny - y) * s], [x + (nx - x) * s * 0.5, y + (ny - y) * s * 1.1], [x, y + (ny - y) * s * 0.7], [x + (px - x) * s * 0.4, y + (py - y) * s * 1.1], [x + (px - x) * s, y + (py - y) * s]]), k.time === 'night' ? '#aab6d8' : k.time === 'dusk' ? '#ffd2c0' : pal.snow, {stroke: false}));
    }
  }
  void seed; void u;
  return out;
}

const forest = {
  group: 'outside', label: 'Forest',
  describe: 'a deep forest: trunks and canopies in layers fading into mist, shafts of light, ferns and a mossy log in front',
  light: {night: {color: '#9fb6e8', intensity: 0.3}},
  geo(k) {
    const g = land(k, {horizon: 0.62, ground: 0.88});
    g.quiet = {...g.quiet, under: [forestSky(k), k.pal.haze]};
    return g;
  },
  back(k, g) {
    const {W, H, p, pal, u} = k;
    const {x0, w} = span(k);
    const out = [p.rect(x0, -2, w, H + 4, p.lin([[0, forestSky(k)], [1, mixColor(pal.haze, forestSky(k), 0.5)]], 0, 0, 0, g.horizonY), {stroke: false})];
    if (k.time === 'night') out.push(...starField(k, 0, H * 0.3));
    // Far misty trunks.
    for (let i = 0; i < 18; i++) {
      const x = x0 + (i + p.rnd(0, 0.8)) * w / 18, tw = p.rnd(18, 34) * u;
      out.push(p.rect(x, -2, tw, g.horizonY + 40 * u, mixColor(pal.haze, pal.far, 0.35), {stroke: false, opacity: 0.8}));
    }
    out.push(haze(k, 0, g.horizonY + 60 * u, {alpha: 1.4}));
    void W;
    return out;
  },
  mid(k, g) {
    const {W, H, u, p, pal} = k;
    const {x0, w} = span(k);
    const out = [];
    const trunk = mixColor('#000000', pal.trunk, 0.15);
    // Mid trunks with canopy masses along the top.
    for (let i = 0; i < 9; i++) {
      const x = x0 + (i + p.rnd(0.1, 0.7)) * w / 9, tw = p.rnd(38, 64) * u;
      out.push(p.rect(x, -2, tw, g.groundY - 30 * u, trunk, {}));
      out.push(p.shade(x, 0, tw, g.groundY, 'right', 0.35));
    }
    for (let i = 0; i < 12; i++) out.push(p.circle(x0 + i * w / 11, p.rnd(-40, 60) * u, p.rnd(150, 230) * u, i % 2 ? pal.foliageShade : mixColor('#000000', pal.foliageShade, 0.15), {}));
    out.push(haze(k, g.horizonY - 160 * u, g.groundY, {alpha: 0.7}));
    out.push(grassField(k, g.horizonY + 60 * u, {color: mixColor('#000000', pal.grass, 0.25)}));
    // A path of light on the forest floor.
    out.push(p.pool(W * 0.5, g.groundY - 10 * u, W * 0.3, 40 * u, k.time === 'night' ? '#b9c8ff' : '#fff2c0', k.time === 'night' ? 0.2 : 0.35));
    // Ferns.
    for (let i = 0; i < 8; i++) out.push(fern(k, x0 + p.rnd() * w, g.horizonY + 70 * u + p.rnd(0, 1) * (g.groundY - g.horizonY), p.rnd(50, 90) * u));
    void H;
    return out;
  },
  front(k, g) {
    const {W, H, u, p, pal} = k;
    const out = [];
    // Near trunk at the left, a mossy log, ferns.
    out.push(p.rect(-k.ov, -2, W * 0.06 + k.ov, H + 4, mixColor('#000000', pal.trunk, 0.35), {}));
    out.push(p.shade(-k.ov, 0, W * 0.06 + k.ov, H, 'right', 0.4));
    const lx = W * (k.portrait ? 0.4 : 0.62), ly = g.groundY + 30 * u;
    out.push(p.shadow(lx + 160 * u, ly + 20 * u, 220 * u, 18 * u));
    out.push(p.rect(lx, ly - 60 * u, 340 * u, 70 * u, pal.trunk, {rx: 34 * u}));
    out.push(p.ellipse(lx + 336 * u, ly - 25 * u, 26 * u, 35 * u, pal.woodLight, {}));
    out.push(p.path(`M${f(lx + 10 * u)} ${f(ly - 54 * u)}Q${f(lx + 160 * u)} ${f(ly - 84 * u)} ${f(lx + 320 * u)} ${f(ly - 56 * u)}L${f(lx + 300 * u)} ${f(ly - 40 * u)}Q${f(lx + 160 * u)} ${f(ly - 60 * u)} ${f(lx + 20 * u)} ${f(ly - 40 * u)}Z`, pal.foliageLight, {}));
    for (const fx of [0.12, 0.9]) out.push(fern(k, W * fx, H + 10 * u, 160 * u));
    return out;
  },
  fx(k) {
    if (k.time === 'night') return rays(k, k.W * 0.7, 0, {angle: 108, spread: 16, count: 3, alpha: 0.1, color: '#c8d4ff'});
    return rays(k, k.W * (k.time === 'dusk' ? 0.1 : 0.62), 0, {angle: k.time === 'dusk' ? 40 : 105, spread: 30, count: 6, alpha: 0.2});
  }
};

const forestSky = k => (k.time === 'night' ? '#0a1226' : k.time === 'dusk' ? mixColor('#e8946a', k.pal.skyMid, 0.5) : mixColor('#8fbf9a', k.pal.skyMid, 0.55));

function fern(k, x, y, s) {
  const {p, pal} = k;
  const out = [];
  for (const [a, l] of [[-150, 1], [-120, 1.2], [-90, 1.3], [-60, 1.2], [-30, 1]]) {
    const r = a * Math.PI / 180, ex = x + Math.cos(r) * s * l, ey = y + Math.sin(r) * s * l * 0.8;
    out.push(p.path(`M${f(x)} ${f(y)}Q${f((x + ex) / 2)} ${f(Math.min(y, ey) - s * 0.25)} ${f(ex)} ${f(ey)}Q${f((x + ex) / 2)} ${f(Math.min(y, ey) - s * 0.05)} ${f(x)} ${f(y)}Z`, a === -90 ? pal.foliageLight : pal.foliage, {}));
  }
  return out;
}

export const OUTSIDE = {
  park, beach, mountains, forest
};

// Re-exported for props that draw a bench or a cloud.
export {cloud};
