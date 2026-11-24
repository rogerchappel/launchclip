// Depth and light for a world (renderWorld({depth: true})): an opt-in pass
// over any world kind that fills it with light and layers it in depth,
// without changing a world drawn without it.
//
// - Atmospheric perspective: outside and on streets the back layer (sky,
//   far skyline, hills) is veiled toward the horizon in the time's haze, so
//   far reads lighter and less saturated than near.
// - Light: warm window and lamp pools on the pavement with spill shafts at
//   dusk and night (amber noir); moonlight through a room's window at night,
//   warm low sun at dusk, a daylight beam by day; a lamp pool where the cast
//   stands; a ceiling falloff indoors and a light falloff at the frame edges.
// - Grounding: a soft contact band along the ground line the cast stands
//   on, and ambient occlusion where an inside wall meets the floor.
// - A foreground occluder at the frame edges (a lamp post and a bush
//   outside; a plant and a table edge inside), returned as `edge`: it
//   stays when a cast stands in the world (which drops the rest of the
//   front layer), and the camera's parallax slides it past fastest.
//
// Lights pass {glow: true} and force their gradients, so they draw at every
// detail level; occluders go through the pen like the rest of the world (ink
// outlines and pale fills at simple detail).

import {mixColor} from '../catalog-b-base.mjs';
import {f, pts} from './pen.mjs';
import {span} from './common.mjs';

const G = {glow: true};
// Where the near lamp post stands (its pool falls under its head, 130 u to the right).
const LAMP_X = k => k.W * (k.portrait ? 0.05 : 0.035);
const SCREEN = {glow: true, blend: 'screen'};

/** Where a world's horizon sits (its far edge) and its ground line. */
function lines(k, g) {
  const ground = g.anchors.ground.y;
  const horizon = g.baseY ?? g.horizonY ?? g.vanishY ?? g.waterY ?? g.floorY ?? Math.round(k.H * 0.6);
  return {ground, horizon};
}

/** Soft warm pools on the ground with light spilling down to them (windows, lamps). */
function pools(k, g, {ground, horizon}, {shafts, xs}) {
  const {p, pal, W, u, time} = k;
  const night = time === 'night';
  const out = [];
  const c = pal.lampWarm;
  for (const fx of xs) {
    const x = W * fx;
    const rx = (k.portrait ? 200 : 180) * u, ry = 34 * u;
    if (shafts) {
      const top = horizon - 150 * u;
      const a = night ? 0.17 : 0.1;
      out.push(p.path(pts([[x - 70 * u, top], [x + 70 * u, top], [x + rx * 0.9, ground], [x - rx * 0.9, ground]]), p.lin([[0, c, a], [1, c, a * 0.15]], 0, top, 0, ground, {force: true, glow: true}), SCREEN));
    }
    out.push(p.ellipse(x, ground + 6 * u, rx, ry, p.rad([[0, c, night ? 0.42 : 0.26], [0.5, c, night ? 0.18 : 0.1], [1, c, 0]], x, ground + 6 * u, rx, {force: true, glow: true}), SCREEN));
  }
  return out;
}

/** Light through a room's window onto the floor: moonlight at night, low sun at dusk, daylight by day. */
function windowLight(k, g) {
  const {p, u, time, H} = k;
  const win = g.win;
  if (!win) return [];
  const floorY = g.floorY ?? g.anchors.ground.y;
  const c = time === 'night' ? '#a9c0ff' : time === 'dusk' ? '#ffb36a' : '#fff4d6';
  const a = time === 'night' ? 0.2 : time === 'dusk' ? 0.24 : 0.16;
  const lean = (time === 'dusk' ? 0.9 : 0.5) * (floorY - win.y) * (win.x + win.w / 2 > k.W / 2 ? -1 : 1);
  const foot = floorY + (H - floorY) * 0.6;
  const beam = [[win.x, win.y + win.h * 0.1], [win.x + win.w, win.y + win.h * 0.1], [win.x + win.w + lean, foot], [win.x + lean, foot]];
  const out = [p.path(pts(beam), p.lin([[0, c, a], [1, c, a * 0.2]], 0, win.y, 0, foot, {force: true, glow: true}), SCREEN)];
  // The window's patch of light on the floor.
  const cx = win.x + win.w / 2 + lean * 0.92;
  out.push(p.ellipse(cx, foot - 20 * u, win.w * 0.62, 46 * u, p.rad([[0, c, a * 1.6], [1, c, 0]], cx, foot - 20 * u, win.w * 0.62, {force: true, glow: true}), SCREEN));
  // Night: the glass itself glows faintly blue.
  if (time === 'night') out.push(p.rect(win.x, win.y, win.w, win.h, p.rad([[0, c, 0.22], [1, c, 0]], win.x + win.w * 0.7, win.y + win.h * 0.25, Math.max(win.w, win.h), {force: true, glow: true}), SCREEN));
  return out;
}

/** A tall lamp post close to the camera, cropped by the frame. */
function nearLampPost(k, x) {
  const {p, pal, u, H, time} = k;
  const c = mixColor('#000000', pal.metalShade, 0.62);
  const w = 30 * u;
  const headY = H * (k.portrait ? 0.12 : 0.1);
  const out = [
    p.rect(x - w / 2, headY, w, H - headY + 4, c, {}),
    p.rect(x - w * 1.3, H - 120 * u, w * 2.6, 124 * u, c, {rx: 8 * u}),
    p.rect(x - w * 0.9, H - 150 * u, w * 1.8, 34 * u, c, {rx: 6 * u}),
    p.stroke(`M${f(x)} ${f(headY + 20 * u)}Q${f(x + 30 * u)} ${f(headY - 60 * u)} ${f(x + 130 * u)} ${f(headY - 40 * u)}`, c, 16),
    p.path(pts([[x + 80 * u, headY - 34 * u], [x + 180 * u, headY - 34 * u], [x + 160 * u, headY + 10 * u], [x + 100 * u, headY + 10 * u]]), c, {})
  ];
  if (time !== 'day') {
    out.push(p.rect(x + 104 * u, headY + 6 * u, 52 * u, 12 * u, pal.lamp, G));
    out.push(p.ellipse(x + 130 * u, headY + 30 * u, 260 * u, 200 * u, p.rad([[0, pal.lampWarm, time === 'night' ? 0.4 : 0.22], [1, pal.lampWarm, 0]], x + 130 * u, headY + 30 * u, 260 * u, {force: true, glow: true}), SCREEN));
  }
  // Rim light down the post's lit edge.
  out.push(p.line(x + w / 2 - 2 * u, headY + 30 * u, x + w / 2 - 2 * u, H, time === 'day' ? '#ffffff' : pal.lampWarm, 3, {glow: true, opacity: time === 'day' ? 0.35 : 0.5, cap: 'butt'}));
  return out;
}

/** A dark clump of foliage in a bottom corner. */
function nearBush(k, x, side) {
  const {p, pal, u, H} = k;
  const dark = mixColor('#000000', pal.foliageShade, 0.6);
  const rim = mixColor('#ffffff', pal.foliage, 0.2);
  const out = [];
  const blobs = [[0, 0, 190], [-150, 40, 150], [120, 50, 170], [-40, -120, 130], [60, -70, 120]];
  for (const [dx, dy, r] of blobs) out.push(p.circle(x + dx * u * side, H + 40 * u + dy * u, r * u, rim, {stroke: false, opacity: 0.5, transform: `translate(${f(-6 * u * side)} ${f(-6 * u)})`}));
  for (const [dx, dy, r] of blobs) out.push(p.circle(x + dx * u * side, H + 40 * u + dy * u, r * u, dark, {}));
  return out;
}

/** A potted plant close to the camera, its leaves cropped by the frame. */
function nearPlant(k, x) {
  const {p, pal, u, H} = k;
  const leaf = mixColor('#000000', pal.foliageShade, 0.5);
  const pot = mixColor('#000000', pal.wallShade, 0.55);
  const out = [p.path(pts([[x - 110 * u, H - 170 * u], [x + 110 * u, H - 170 * u], [x + 90 * u, H + 10], [x - 90 * u, H + 10]]), pot, {})];
  const leaves = [[-70, -430, -0.9], [-10, -520, -0.2], [60, -470, 0.5], [110, -360, 1.1], [-120, -320, -1.4], [20, -380, 0.1]];
  for (const [dx, dy, bend] of leaves) {
    const tx = x + dx * u, ty = H + dy * u, bx = x, by = H - 170 * u;
    const mx = (tx + bx) / 2 + bend * 60 * u, my = (ty + by) / 2;
    out.push(p.path(`M${f(bx)} ${f(by)}Q${f(mx - 50 * u)} ${f(my)} ${f(tx)} ${f(ty)}Q${f(mx + 50 * u)} ${f(my + 30 * u)} ${f(bx)} ${f(by)}Z`, leaf, {}));
  }
  return out;
}

/** The edge of a table close to the camera, with a mug on it. */
function nearTable(k, x0) {
  const {p, pal, u, H} = k;
  const {x1} = span(k);
  const top = mixColor('#000000', pal.woodShade, 0.45);
  const y = H - 110 * u;
  return [
    p.rect(x0, y + 22 * u, x1 - x0, H - y, mixColor('#000000', top, 0.35), {}),
    p.path(pts([[x0, y + 22 * u], [x0 + 40 * u, y], [x1, y], [x1, y + 22 * u]]), top, {}),
    p.line(x0 + 40 * u, y + 1 * u, x1, y + 1 * u, mixColor('#ffffff', pal.wood, 0.4), 2.5, {glow: true, opacity: 0.45, cap: 'butt'}),
    p.rect(x0 + 120 * u, y - 96 * u, 78 * u, 100 * u, mixColor('#000000', pal.cream, 0.5), {rx: 8 * u}),
    p.path(`M${f(x0 + 198 * u)} ${f(y - 76 * u)}q${f(40 * u)} ${f(10 * u)} 0 ${f(56 * u)}`, null, {stroke: mixColor('#000000', pal.cream, 0.5), sw: 4})
  ];
}

/**
 * The depth pass for a drawn world. k: the world kit; g: its geometry;
 * group: inside | street | outside. → {back, mid, edge, fx} node arrays,
 * each drawn with the pen at its own layer (gradient defs land there).
 */
export function depthPass(k, g, group) {
  const {p, pal, W, H, u, time} = k;
  const {x0, w} = span(k);
  const {ground, horizon} = lines(k, g);
  const back = [], mid = [], edge = [], fx = [];
  const inside = group === 'inside';

  p.at('back');
  if (!inside) {
    // Atmospheric perspective: the far layer veiled toward the horizon.
    const veil = time === 'night' ? pal.skyLow : pal.haze;
    const a = time === 'night' ? 0.24 : time === 'dusk' ? 0.3 : 0.3;
    back.push(p.rect(x0, 0, w, horizon + 2, p.lin([[0, veil, 0], [0.55, veil, a * 0.4], [1, veil, a]], 0, 0, 0, horizon, {force: true, glow: true}), G));
  } else {
    // Indoors the light falls off toward the ceiling, and pools where wall meets floor.
    back.push(p.rect(x0, -2, w, H * 0.42, p.lin([[0, '#000000', time === 'night' ? 0.4 : 0.22], [1, '#000000', 0]], 0, 0, 0, H * 0.42, {force: true, glow: true}), G));
    const floorY = g.floorY ?? ground;
    p.at('mid');
    mid.push(p.rect(x0, floorY - 46 * u, w, 70 * u, p.lin([[0, '#000000', 0], [0.66, '#000000', 0.22], [1, '#000000', 0]], 0, floorY - 46 * u, 0, floorY + 24 * u, {force: true, glow: true}), G));
  }

  // Grounding: a soft contact band where the cast stands.
  p.at('mid');
  mid.push(p.ellipse(W / 2, ground + 10 * u, W * 0.52, 46 * u, p.rad([[0, pal.shadow, Math.min(0.5, pal.shadowAlpha * 1.4)], [0.7, pal.shadow, pal.shadowAlpha * 0.5], [1, pal.shadow, 0]], W / 2, ground + 10 * u, W * 0.52, {force: true}), G));

  // Light.
  p.at('fx');
  if (inside) {
    fx.push(...windowLight(k, g));
    if (time !== 'day') fx.push(p.ellipse(W / 2, ground, W * 0.34, 70 * u, p.rad([[0, pal.lampWarm, time === 'night' ? 0.3 : 0.16], [1, pal.lampWarm, 0]], W / 2, ground, W * 0.34, {force: true, glow: true}), SCREEN));
  } else if (group === 'street' && time !== 'day') {
    // Shop and window light: pools with spill shafts along the pavement, and an amber wash over the street.
    fx.push(...pools(k, g, {ground, horizon}, {shafts: true, xs: k.portrait ? [0.18, 0.78] : [0.12, 0.38, 0.64, 0.9]}));
    fx.push(p.rect(x0, horizon - 220 * u, w, ground - horizon + 300 * u, p.lin([[0, pal.lampWarm, 0], [0.6, pal.lampWarm, time === 'night' ? 0.12 : 0.06], [1, pal.lampWarm, 0]], 0, horizon - 220 * u, 0, ground + 80 * u, {force: true, glow: true}), SCREEN));
  } else if (time !== 'day') {
    // Outside, the one pool is under the near lamp post's head.
    fx.push(...pools(k, g, {ground, horizon}, {shafts: false, xs: [LAMP_X(k) / W + 130 * u / W]}));
  }
  if (time === 'dusk' && !inside) fx.push(p.rect(x0, 0, w, H, p.lin([[0, '#ffb070', 0.16], [0.5, '#ffb070', 0]], x0, 0, x0 + w, 0, {force: true, glow: true}), SCREEN));
  if (time === 'day') fx.push(p.rect(x0, 0, w, H, p.rad([[0, '#fff3d6', 0.14], [1, '#fff3d6', 0]], W * 0.2, 0, Math.hypot(W, H) * 0.7, {force: true, glow: true}), SCREEN));

  // Foreground occluders at the frame edges.
  p.at('front');
  if (inside) edge.push(nearPlant(k, W * (k.portrait ? 0.06 : 0.04)), nearTable(k, W * (k.portrait ? 0.7 : 0.8)));
  else edge.push(nearLampPost(k, LAMP_X(k)), nearBush(k, W * 0.97, 1));

  p.at('fx');
  // A light falloff at the frame edges (under a stronger vignette the detail already draws).
  fx.push(p.rect(-2, -2, W + 4, H + 4, p.rad([[0, '#000000', 0], [0.58, '#000000', 0], [1, '#000000', time === 'night' ? 0.5 : 0.32]], W / 2, H * 0.55, Math.hypot(W, H) / 2, {force: true, glow: true}), G));

  return {back, mid, edge: edge.flat(Infinity).filter(Boolean), fx: fx.flat(Infinity).filter(Boolean)};
}
