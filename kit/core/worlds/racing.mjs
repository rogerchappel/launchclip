// Racing worlds: a racetrack, a stable yard and a paddock (parade ring).
// Unlike the other outside worlds these are seen from close by: the ground
// line is at the cast's own scale (STORY_SCALE), so a horse standing in one
// reads against the rail, the stall doors and the winning post beside it.
// What a story needs to see (rail, post, stalls, ring) is in the mid layer,
// behind the cast: a cast scene leaves out a world's front layer.

import {mixColor} from '../catalog-b-base.mjs';
import {f, pts} from './pen.mjs';
import {span, sky, skyBody, hills, tree, haze, rays} from './common.mjs';

/**
 * Pixels per metre where the cast stands, as a share of the kit's own
 * (worlds/index.mjs ppm): a wide-shot horse is drawn about this much
 * larger than a person in an inside world, and story props match it.
 */
export const STORY_SCALE = 1.15;

function yard(k, {horizon = 0.5, ground = 0.84, quiet = 0.22} = {}) {
  const {W, H, portrait} = k;
  const ppm = k.ppm * STORY_SCALE;
  const horizonY = Math.round(H * (portrait ? horizon + 0.04 : horizon));
  const groundY = Math.round(H * ground);
  return {
    horizonY, groundY, ppm,
    anchors: {
      ground: {y: groundY, x0: W * 0.04, x1: W * 0.96, ppm},
      far: {y: Math.round(horizonY + (groundY - horizonY) * 0.35), x0: W * 0.04, x1: W * 0.96, ppm: ppm * 0.45, layer: 'mid'},
      sky: {y: Math.round(H * 0.2), x0: W * 0.08, x1: W * 0.92, ppm: ppm * 0.6, layer: 'back'}
    },
    quiet: {x: Math.round(W * 0.06), y: Math.round(H * 0.04), width: Math.round(W * 0.88), height: Math.round(H * (portrait ? quiet * 0.8 : quiet)), under: [k.pal.skyTop, k.pal.skyMid]}
  };
}

/** A band of mown turf from y0 to y1: alternate light and dark stripes, wider toward the camera. */
function turf(k, y0, y1, {stripes = 5} = {}) {
  const {p, pal} = k;
  const {x0, w} = span(k);
  const out = [];
  let y = y0;
  for (let i = 0; i < stripes; i++) {
    const h = (y1 - y0) * (i + 1) / (stripes * (stripes + 1) / 2);
    out.push(p.rect(x0, y, w, h + 1, i % 2 ? mixColor('#000000', pal.grass, 0.08) : mixColor('#ffffff', pal.grass, 0.06), {stroke: false}));
    y += h;
  }
  return out;
}

/** A running rail: a white top rail on leaning posts, from x0 to x1 at railY, h tall. */
export function runningRail(k, x0, x1, baseY, h, {gap = null, color = null} = {}) {
  const {p, pal, u} = k;
  const c = color ?? pal.white;
  const step = gap ?? h * 1.5;
  const out = [];
  for (let x = x0 + step / 2; x < x1; x += step) out.push(p.path(pts([[x - h * 0.05, baseY], [x + h * 0.05, baseY], [x + h * 0.16, baseY - h * 0.92], [x + h * 0.08, baseY - h * 0.92]]), mixColor('#000000', c, 0.08), {}));
  out.push(p.rect(x0, baseY - h, x1 - x0, h * 0.16, c, {rx: h * 0.08}));
  out.push(p.rect(x0, baseY - h + h * 0.11, x1 - x0, h * 0.05, mixColor('#000000', c, 0.14), {stroke: false}));
  void u;
  return out;
}

/** A winning post at x on baseY, h tall: a striped pole with a round disc on top. */
export function winningPost(k, x, baseY, h) {
  const {p, pal} = k;
  const red = pal.g('#d8343a');
  const w = h * 0.045, r = h * 0.1;
  const out = [p.shadow(x, baseY, h * 0.12, h * 0.02), p.rect(x - w / 2, baseY - h + r, w, h - r, pal.white, {})];
  for (let i = 0; i < 4; i++) out.push(p.rect(x - w / 2, baseY - h * (0.2 + i * 0.2), w, h * 0.1, red, {stroke: false}));
  out.push(p.circle(x, baseY - h + r, r, pal.white, {}), p.circle(x, baseY - h + r, r * 0.62, red, {stroke: false}), p.circle(x, baseY - h + r, r * 0.26, pal.white, {stroke: false}));
  return out;
}

/** A grandstand in the distance: tiers of seats under a flat roof, flags on top. */
function grandstand(k, x, baseY, w, h) {
  const {p, pal, u, time} = k;
  const body = mixColor(pal.far, pal.white, 0.55), roof = mixColor(pal.far, pal.primary, 0.55);
  const out = [p.rect(x, baseY - h * 0.62, w, h * 0.62, body, {})];
  // Tiers: three rows of seats, a few lit at night.
  for (let i = 0; i < 3; i++) {
    const y = baseY - h * (0.54 - i * 0.17);
    out.push(p.rect(x + w * 0.03, y, w * 0.94, h * 0.1, mixColor('#000000', body, 0.16), {stroke: false}));
    if (k.d.n >= 1) for (let j = 0; j < 14; j++) out.push(p.circle(x + w * (0.07 + j * 0.066), y + h * 0.05, h * 0.022, time === 'day' ? (j % 3 ? pal.accent : pal.primary) : pal.lit, {stroke: false, glow: time !== 'day', opacity: 0.85}));
  }
  out.push(p.path(pts([[x - w * 0.04, baseY - h * 0.66], [x + w * 1.04, baseY - h * 0.66], [x + w * 0.98, baseY - h * 0.8], [x + w * 0.02, baseY - h * 0.8]]), roof, {}));
  for (const t of [0.12, 0.5, 0.88]) {
    const fx = x + w * t, fy = baseY - h * 0.8;
    out.push(p.line(fx, fy, fx, fy - h * 0.2, pal.metalShade, 2));
    out.push(p.path(pts([[fx, fy - h * 0.2], [fx + h * 0.14, fy - h * 0.16], [fx, fy - h * 0.12]]), t === 0.5 ? pal.accent : pal.primary, {stroke: false}));
  }
  void u;
  return out;
}

const racetrack = {
  group: 'outside', label: 'Racetrack',
  describe: 'a racetrack seen from beside the course: mown turf underfoot, the white running rail behind, a dirt track and the far rail beyond it, a grandstand with flags in the distance and the winning post by the rail',
  geo(k) { return yard(k, {horizon: 0.46, ground: 0.84}); },
  back(k, g) {
    const {W, H, u, pal} = k;
    const gw = W * (k.portrait ? 0.62 : 0.4);
    return [
      sky(k, g.horizonY, {}),
      hills(k, g.horizonY + 14 * u, H * 0.05, mixColor(pal.farther, pal.grass, 0.3), {bumps: 4}),
      grandstand(k, W * (k.portrait ? 0.3 : 0.5), g.horizonY + 16 * u, gw, gw * 0.42),
      haze(k, g.horizonY - H * 0.12, g.horizonY + 30 * u, {alpha: 0.7})
    ];
  },
  mid(k, g) {
    const {W, H, u, p, pal} = k;
    const {x0, x1, w} = span(k);
    const out = [];
    const farY = g.horizonY + 16 * u, span2 = g.groundY - farY;
    // Far tree line, the infield, the far rail, the dirt track, then the turf course.
    for (let i = 0; i < 9; i++) out.push(tree(k, x0 + (i + 0.5) * w / 9, farY + 6 * u, p.rnd(90, 130) * u, {kind: 'round', tone: 2}));
    out.push(p.rect(x0, farY, w, H - farY, mixColor('#000000', pal.grass, 0.12), {stroke: false}));
    out.push(...runningRail(k, x0, x1, farY + span2 * 0.14, 0.4 * g.ppm * 0.4));
    const dirt = pal.g('#c9a57a');
    out.push(p.rect(x0, farY + span2 * 0.16, w, span2 * 0.2, p.lin([[0, mixColor('#ffffff', dirt, 0.08)], [1, mixColor('#000000', dirt, 0.12)]], 0, farY + span2 * 0.16, 0, farY + span2 * 0.36), {stroke: false}));
    out.push(...turf(k, farY + span2 * 0.36, H + 4, {stripes: 5}));
    // The winning post stands by the running rail, then the rail itself.
    const railY = g.groundY - 0.5 * g.ppm;
    out.push(...winningPost(k, W * (k.portrait ? 0.86 : 0.84), railY + 4 * u, 3 * g.ppm * 0.78));
    out.push(...runningRail(k, x0, x1, railY, 1.05 * g.ppm * 0.78));
    return out;
  },
  front(k, g) {
    const {W, u, p, pal} = k;
    // Grass tufts at the near edge.
    const out = [];
    for (let i = 0; i < 12; i++) {
      const tx = W * (0.04 + i * 0.085), ty = k.H - p.rnd(4, 30) * u, s = 16 * u;
      out.push(p.stroke(`M${f(tx - s)} ${f(ty)}L${f(tx - s * 0.4)} ${f(ty - s * 1.6)}M${f(tx)} ${f(ty)}L${f(tx)} ${f(ty - s * 2)}M${f(tx + s)} ${f(ty)}L${f(tx + s * 0.5)} ${f(ty - s * 1.5)}`, pal.grassShade, 3));
    }
    void g;
    return out;
  },
  fx(k) {
    const b = skyBody(k, k.H * 0.46);
    return k.time === 'night' ? [] : rays(k, b.x, b.y, {angle: k.time === 'dusk' ? 14 : 50, spread: 36, count: 4, alpha: 0.1});
  }
};

/** A stall: a dark doorway with a half door (a Z brace) across its lower part. x: its centre. */
export function stallDoor(k, x, baseY, w, h, {open = false} = {}) {
  const {p, pal} = k;
  const door = pal.g('#3f7a5a'), doorS = mixColor('#000000', door, 0.2);
  const inside = mixColor('#000000', pal.woodShade, 0.62);
  const half = h * 0.52;
  const out = [p.rect(x - w / 2 - w * 0.06, baseY - h - w * 0.06, w * 1.12, h + w * 0.06, pal.white, {})];
  out.push(p.rect(x - w / 2, baseY - h, w, h, inside, {stroke: false}));
  // Straw on the stall floor, seen over the door.
  out.push(p.rect(x - w / 2, baseY - half - h * 0.05, w, h * 0.05, pal.g('#e2c26a'), {stroke: false, opacity: 0.5}));
  if (!open) {
    out.push(p.rect(x - w / 2, baseY - half, w, half, door, {}));
    out.push(p.path(pts([[x - w * 0.44, baseY - half * 0.9], [x + w * 0.44, baseY - half * 0.9], [x + w * 0.44, baseY - half * 0.76], [x - w * 0.3, baseY - half * 0.2], [x + w * 0.44, baseY - half * 0.2], [x + w * 0.44, baseY - half * 0.08], [x - w * 0.44, baseY - half * 0.08], [x - w * 0.44, baseY - half * 0.22], [x + w * 0.3, baseY - half * 0.76], [x - w * 0.44, baseY - half * 0.76]]), doorS, {stroke: false}));
    out.push(p.rect(x + w * 0.3, baseY - half * 0.6, w * 0.1, half * 0.07, pal.metalShade, {stroke: false}));
  }
  return out;
}

/** A stack of hay bales, its left edge at x. */
export function hayStack(k, x, baseY, s, rows = [2, 1]) {
  const {p, pal} = k;
  const hay = pal.g('#e2c26a'), hayS = pal.g('#b9983f');
  const bw = 0.9 * s, bh = 0.45 * s;
  const out = [p.shadow(x + bw * rows[0] / 2, baseY, bw * rows[0] * 0.6, bh * 0.14)];
  rows.forEach((n, r) => {
    for (let i = 0; i < n; i++) {
      const bx = x + i * bw + r * bw * 0.5, by = baseY - (r + 1) * bh;
      out.push(p.rect(bx, by, bw, bh, hay, {rx: bh * 0.12}));
      for (const t of [0.3, 0.7]) out.push(p.line(bx + bw * t, by + 2, bx + bw * t, by + bh - 2, hayS, 3));
      if (k.d.n >= 1) for (const [a, c] of [[0.1, 0.3], [0.45, 0.6], [0.78, 0.4]]) out.push(p.line(bx + bw * a, by + bh * c, bx + bw * (a + 0.12), by + bh * (c + 0.08), hayS, 2));
    }
  });
  return out;
}

/** A bucket at x on baseY, s px per metre. */
export function bucketNodes(k, x, baseY, s, {water = true} = {}) {
  const {p, pal} = k;
  const w = 0.36 * s, h = 0.34 * s;
  return [p.shadow(x, baseY, w * 0.6, h * 0.1),
    p.path(`M${f(x - w * 0.5)} ${f(baseY - h)}Q${f(x)} ${f(baseY - h * 1.75)} ${f(x + w * 0.5)} ${f(baseY - h)}`, null, {stroke: pal.metalShade, sw: 1.4}),
    p.path(pts([[x - w * 0.5, baseY - h], [x + w * 0.5, baseY - h], [x + w * 0.38, baseY], [x - w * 0.38, baseY]]), pal.primary, {}),
    p.ellipse(x, baseY - h, w * 0.5, h * 0.12, water ? mixColor(pal.water, pal.waterLight, 0.5) : pal.primaryShade, {}),
    p.rect(x - w * 0.46, baseY - h * 0.62, w * 0.92, h * 0.1, pal.primaryLight, {stroke: false})];
}

const stableYard = {
  group: 'outside', label: 'Stable yard',
  describe: 'a stable yard: a timber stable block with a row of stalls, each a dark doorway with a green half door, a lantern, hay bales and a water bucket on a swept yard, trees and sky over the roof',
  geo(k) {
    const g = yard(k, {horizon: 0.3, ground: 0.84, quiet: 0.16});
    const {W} = k;
    // The stalls: their centres and size at the cast's scale.
    const n = k.portrait ? 2 : 3;
    const sw = 1.25 * g.ppm * 0.8, sh = 2.35 * g.ppm * 0.8;
    const wallBase = g.groundY - Math.round(0.42 * g.ppm);
    const xs = Array.from({length: n}, (_, i) => W * (n === 2 ? [0.3, 0.7][i] : [0.22, 0.5, 0.78][i]));
    const roofY = wallBase - sh - 0.5 * g.ppm;
    g.stalls = {xs, w: sw, h: sh, base: wallBase, roofY};
    g.anchors.wall = {y: Math.round(wallBase - sh - 0.22 * g.ppm), x0: W * 0.06, x1: W * 0.94, ppm: g.ppm * 0.8, layer: 'mid'};
    g.quiet = {...g.quiet, height: Math.max(40, Math.round(roofY * 0.6))};
    return g;
  },
  back(k, g) {
    const {W, u, p} = k;
    const {x0, w} = span(k);
    const out = [sky(k, g.stalls.roofY + 60 * u, {})];
    for (let i = 0; i < 7; i++) out.push(tree(k, x0 + (i + 0.5) * w / 7, g.stalls.roofY + 80 * u, p.rnd(240, 330) * u, {kind: i % 3 === 1 ? 'pine' : 'round', tone: 1}));
    void W;
    return out;
  },
  mid(k, g) {
    const {W, H, u, p, pal, time} = k;
    const {x0, x1, w} = span(k);
    const s = g.stalls;
    const wood = mixColor(pal.wood, pal.cream, 0.25), woodS = mixColor('#000000', wood, 0.14);
    const out = [];
    // The block: boarded wall, a pitched roof with an overhang.
    out.push(p.rect(x0, s.roofY, w, s.base - s.roofY, wood, {stroke: false}));
    if (k.d.n >= 1) for (let x = x0; x < x1; x += 0.3 * g.ppm) out.push(p.line(x, s.roofY, x, s.base, woodS, 2, {opacity: 0.5}));
    const roof = mixColor(pal.brickShade, pal.primary, 0.25);
    out.push(p.path(pts([[x0, s.roofY - 0.5 * g.ppm], [x1, s.roofY - 0.5 * g.ppm], [x1, s.roofY + 0.12 * g.ppm], [x0, s.roofY + 0.12 * g.ppm]]), roof, {}));
    out.push(p.rect(x0, s.roofY + 0.12 * g.ppm, w, 0.07 * g.ppm, mixColor('#000000', roof, 0.3), {stroke: false}));
    for (const x of s.xs) out.push(...stallDoor(k, x, s.base, s.w, s.h));
    // A lantern between the first two stalls, lit at dusk and night.
    const lx = (s.xs[0] + s.xs[1]) / 2, ly = s.base - s.h * 0.86;
    out.push(p.rect(lx - 0.07 * g.ppm, ly, 0.14 * g.ppm, 0.2 * g.ppm, time === 'day' ? pal.metalLight : pal.lamp, {rx: 0.03 * g.ppm, glow: time !== 'day'}));
    out.push(p.rect(lx - 0.09 * g.ppm, ly - 0.04 * g.ppm, 0.18 * g.ppm, 0.05 * g.ppm, pal.ink, {stroke: false}));
    if (time !== 'day') out.push(p.glow(lx, ly + 0.1 * g.ppm, 1.2 * g.ppm, pal.lampWarm, time === 'night' ? 0.5 : 0.3));
    // The yard: a kerb under the wall, then swept ground.
    const yardC = pal.g('#d8c7a4');
    out.push(p.rect(x0, s.base, w, H - s.base + 4, p.lin([[0, mixColor('#ffffff', yardC, 0.06)], [1, mixColor('#000000', yardC, 0.16)]], 0, s.base, 0, H), {stroke: false}));
    out.push(p.rect(x0, s.base, w, 0.06 * g.ppm, mixColor('#000000', yardC, 0.22), {stroke: false}));
    if (k.d.n >= 1) for (let i = 0; i < 30; i++) out.push(p.ellipse(x0 + p.rnd() * w, s.base + 20 * u + p.rnd() * (H - s.base), p.rnd(8, 22) * u, p.rnd(2, 4) * u, mixColor('#000000', yardC, 0.12), {stroke: false, opacity: 0.6}));
    // Hay against the wall at one side and a water bucket by the first door.
    out.push(...hayStack(k, W * (k.portrait ? 0.82 : 0.86), s.base + 0.1 * g.ppm, g.ppm * 0.8, [2, 1]));
    out.push(...bucketNodes(k, s.xs[0] - s.w * 0.78, s.base + 0.12 * g.ppm, g.ppm * 0.8));
    return out;
  },
  front(k, g) {
    const {W, H, u} = k;
    return [hayStack(k, -W * 0.04, H + 30 * u, g.ppm * 1.1, [1])];
  },
  fx(k) {
    const b = skyBody(k, k.H * 0.3);
    return k.time === 'night' ? [] : rays(k, b.x, b.y, {angle: k.time === 'dusk' ? 20 : 56, spread: 30, count: 3, alpha: 0.08});
  }
};

const paddock = {
  group: 'outside', label: 'Paddock',
  describe: 'a paddock (parade ring): an oval sand walking path round a lawn with a tree, a white rail on the far side, a clipped hedge and trees behind it',
  geo(k) { return yard(k, {horizon: 0.44, ground: 0.84}); },
  back(k, g) {
    const {u, H, pal} = k;
    return [
      sky(k, g.horizonY, {}),
      hills(k, g.horizonY + 16 * u, H * 0.05, mixColor(pal.farther, pal.grass, 0.3), {bumps: 3, phase: 1}),
      haze(k, g.horizonY - H * 0.12, g.horizonY + 30 * u, {alpha: 0.7})
    ];
  },
  mid(k, g) {
    const {W, H, u, p, pal} = k;
    const {x0, x1, w} = span(k);
    const out = [];
    const farY = g.horizonY + 16 * u, depth = g.groundY - farY;
    for (let i = 0; i < 8; i++) out.push(tree(k, x0 + (i + 0.5) * w / 8, farY + 10 * u, p.rnd(170, 240) * u * (k.portrait ? 1.15 : 1), {kind: i % 4 === 2 ? 'pine' : 'round', tone: 1}));
    // The hedge, the grass behind the ring, the far rail.
    const hedge = mixColor('#000000', pal.foliageShade, 0.1);
    out.push(p.rect(x0, farY - 0.5 * g.ppm * 0.5, w, 0.5 * g.ppm * 0.5 + 6 * u, hedge, {rx: 10 * u}));
    out.push(p.rect(x0, farY, w, H - farY + 4, mixColor('#000000', pal.grass, 0.1), {stroke: false}));
    out.push(...runningRail(k, x0, x1, farY + depth * 0.2, 1 * g.ppm * 0.42));
    // The ring: an oval sand path with a lawn inside; the cast walks its near side.
    const cx = W / 2, cy = farY + depth * 0.66, rx = W * (k.portrait ? 0.78 : 0.62), ry = depth * 0.56;
    const sand = mixColor('#ffffff', pal.sand, 0.1);
    out.push(p.ellipse(cx, cy, rx, ry, p.lin([[0, mixColor('#000000', sand, 0.06)], [1, sand]], 0, cy - ry, 0, cy + ry), {}));
    out.push(p.ellipse(cx, cy - ry * 0.22, rx * 0.62, ry * 0.44, pal.grass, {}));
    if (k.d.n >= 1) out.push(p.ellipse(cx, cy - ry * 0.16, rx * 0.5, ry * 0.3, mixColor('#ffffff', pal.grass, 0.08), {stroke: false}));
    out.push(tree(k, cx + rx * 0.2, cy - ry * 0.22, 2.6 * g.ppm * 0.5, {kind: 'round'}));
    // A flower bed at the lawn's near edge, in the brand colours.
    for (let i = 0; i < 7; i++) out.push(p.circle(cx - rx * 0.3 + i * rx * 0.06, cy - ry * 0.02 + (i % 2) * 5 * u, 9 * u, i % 2 ? pal.accent : pal.primary, {}));
    return out;
  },
  front(k, g) {
    const {u, H} = k;
    const {x0, x1} = span(k);
    return runningRail(k, x0, x1, H + 20 * u, 1 * g.ppm * 0.9);
  },
  fx(k) {
    const b = skyBody(k, k.H * 0.44);
    return k.time === 'night' ? [] : rays(k, b.x, b.y, {angle: k.time === 'dusk' ? 14 : 50, spread: 36, count: 4, alpha: 0.1});
  }
};

export const RACING = {racetrack, 'stable-yard': stableYard, paddock};
