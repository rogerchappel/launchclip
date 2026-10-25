// Outside worlds: park. Open skies carry the time of day (a high sun, a low warm sun, or
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

export const OUTSIDE = {
  park
};

// Re-exported for props that draw a bench or a cloud.
export {cloud};
