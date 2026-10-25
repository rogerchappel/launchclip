// Sets for character scenes: the room a cast-scene plays in.
//
//   desk-laptop  a desk with a laptop per character, seen from the front;
//                the cast sits behind it
//   phone        the cast stands; the first character holds a phone
//   meeting      a table the cast sits behind, with a wall screen when a
//                real capture is supplied (otherwise a window)
//   screen       a big screen that plays a real capture (an image or video
//                from assets/, or a demo-autopilot recording); the cast
//                stands beside it
//
// The screen never shows an invented UI: it plays params.screen, the
// user's own capture, or the set has no screen. A set returns its back
// layer (drawn behind the cast), its front layer (furniture in front of the
// cast), the screen rect (canvas px) when there is one, and one slot per
// character ({x, floor, scale, facing}).
//
// Imports only sibling kit/core files.

import {el} from '../catalog-b-view.mjs';
import {mixColor} from '../catalog-b-base.mjs';
import {OUTLINE} from './palette.mjs';

export const SETS = Object.freeze(['desk-laptop', 'phone', 'meeting', 'screen']);
export const SEATED_SETS = Object.freeze(['desk-laptop', 'meeting']);
export const SCREEN_SETS = Object.freeze(['screen', 'meeting']);
export const SET_INFO = Object.freeze({
  'desk-laptop': {seated: true, screen: 'none', describe: 'a desk with a laptop per character; the cast sits behind it'},
  'phone': {seated: false, screen: 'none', describe: 'the cast stands in a room; the first character holds a phone'},
  'meeting': {seated: true, screen: 'optional', describe: 'a meeting table the cast sits behind; a wall screen plays a supplied capture'},
  'screen': {seated: false, screen: 'required', describe: 'a big screen playing a real capture (image, video or demo-autopilot recording) with the cast beside it'}
});

const r1 = value => Math.round(value * 10) / 10;
const OUT = 7;
const rect = (x, y, w, h, fill, extra = {}) => el('rect', null, null, [], {x: r1(x), y: r1(y), width: r1(w), height: r1(h), fill, ...(extra.rx ? {rx: r1(extra.rx)} : {}), ...(extra.stroke ? {stroke: extra.stroke, strokeWidth: extra.width ?? OUT} : {}), ...(extra.opacity !== undefined ? {opacity: extra.opacity} : {})});
const path = (d, fill, extra = {}) => el('path', null, null, [], {d, fill: fill ?? 'none', ...(extra.stroke ? {stroke: extra.stroke, strokeWidth: extra.width ?? OUT, strokeLinejoin: 'round', strokeLinecap: 'round'} : {}), ...(extra.opacity !== undefined ? {opacity: extra.opacity} : {})});
const circle = (cx, cy, r, fill, extra = {}) => el('circle', null, null, [], {cx: r1(cx), cy: r1(cy), r: r1(r), fill, ...(extra.stroke ? {stroke: extra.stroke, strokeWidth: extra.width ?? OUT} : {})});

/** Room colours from the brand: a light wall tinted with the primary. */
export function setColors(colors) {
  const wall = mixColor(colors.primary, colors.paper, 0.1);
  return {
    wall,
    wallShade: mixColor(OUTLINE, wall, 0.06),
    floor: mixColor(colors.primary, colors.paper, 0.24),
    floorLine: mixColor(OUTLINE, mixColor(colors.primary, colors.paper, 0.24), 0.18),
    wood: '#c99a6b', woodShade: '#a8784d', woodTop: '#dcb184',
    metal: '#c9ccd4', metalShade: '#9da2ad',
    screen: '#14161c',
    plant: '#4f8a5b', plantShade: '#3b6c46', pot: mixColor(colors.accent, '#ffffff', 0.85),
    sky: '#cfe6f2', accent: colors.accent, primary: colors.primary, outline: OUTLINE
  };
}

function plant(x, floor, s, c) {
  const pot = [path(`M${r1(x - 46 * s)} ${r1(floor - 110 * s)}L${r1(x + 46 * s)} ${r1(floor - 110 * s)}L${r1(x + 36 * s)} ${r1(floor)}L${r1(x - 36 * s)} ${r1(floor)}Z`, c.pot, {stroke: c.outline, width: OUT * s})];
  const leaves = [[-40, -230, -10], [10, -260, 12], [46, -210, 30], [-14, -190, -26], [30, -170, 4]].map(([dx, dy, lean]) => {
    const bx = x + dx * s * 0.3, by = floor - 110 * s, tx = x + dx * s, ty = floor + dy * s;
    return path(`M${r1(bx)} ${r1(by)}Q${r1(tx - 40 * s + lean * s)} ${r1((by + ty) / 2)} ${r1(tx)} ${r1(ty)}Q${r1(tx + 40 * s + lean * s)} ${r1((by + ty) / 2)} ${r1(bx)} ${r1(by)}Z`, dx % 20 === 0 ? c.plantShade : c.plant, {stroke: c.outline, width: OUT * s});
  });
  return [...leaves, ...pot];
}

function windowFrame(x, y, w, h, s, c) {
  return [
    rect(x, y, w, h, c.sky, {rx: 10 * s, stroke: c.outline, width: OUT * s}),
    path(`M${r1(x + w * 0.2)} ${r1(y + h * 0.72)}Q${r1(x + w * 0.4)} ${r1(y + h * 0.52)} ${r1(x + w * 0.62)} ${r1(y + h * 0.7)}Q${r1(x + w * 0.8)} ${r1(y + h * 0.58)} ${r1(x + w)} ${r1(y + h * 0.7)}L${r1(x + w)} ${r1(y + h)}L${r1(x)} ${r1(y + h)}L${r1(x)} ${r1(y + h * 0.8)}Z`, '#ffffff', {opacity: 0.7}),
    path(`M${r1(x + w / 2)} ${r1(y)}L${r1(x + w / 2)} ${r1(y + h)}M${r1(x)} ${r1(y + h / 2)}L${r1(x + w)} ${r1(y + h / 2)}`, 'none', {stroke: c.outline, width: OUT * s * 0.8}),
    rect(x - 12 * s, y + h - 4 * s, w + 24 * s, 18 * s, c.wallShade, {rx: 6 * s, stroke: c.outline, width: OUT * s})
  ];
}

function frameArt(x, y, w, h, s, c) {
  return [
    rect(x, y, w, h, '#ffffff', {rx: 6 * s, stroke: c.outline, width: OUT * s}),
    circle(x + w * 0.36, y + h * 0.42, Math.min(w, h) * 0.2, c.accent),
    path(`M${r1(x + w * 0.14)} ${r1(y + h * 0.84)}L${r1(x + w * 0.5)} ${r1(y + h * 0.5)}L${r1(x + w * 0.86)} ${r1(y + h * 0.84)}Z`, c.primary, {opacity: 0.85})
  ];
}

function room(canvas, floor, c, s) {
  return [
    rect(0, 0, canvas.width, canvas.height, c.wall),
    rect(0, floor, canvas.width, canvas.height - floor, c.floor),
    rect(0, floor - 14 * s, canvas.width, 18 * s, c.wallShade),
    path(`M0 ${r1(floor)}L${canvas.width} ${r1(floor)}`, 'none', {stroke: c.floorLine, width: 5 * s})
  ];
}

/** Stand-in for the screen's content area when no capture is drawn (a dark panel). */
function screenFrame(r, s, c, {stand = true} = {}) {
  const bezel = 18 * s;
  const out = [rect(r.x - bezel, r.y - bezel, r.width + bezel * 2, r.height + bezel * 2, c.screen, {rx: 16 * s, stroke: c.outline, width: OUT * s})];
  if (stand) out.push(rect(r.x + r.width / 2 - 26 * s, r.y + r.height + bezel, 52 * s, 60 * s, c.metalShade, {stroke: c.outline, width: OUT * s}));
  out.push(rect(r.x, r.y, r.width, r.height, '#20232b'));
  return out;
}

/**
 * Lay out a set. canvas {width, height}; colors: brand colours; count: 1–3
 * characters; heights: drawn heights (rig units) per character; screen:
 * true when a capture is supplied.
 * → {back, front, screenRect | null, slots: [{x, floor, scale, facing}], seated, floor}
 */
export function layoutSet(name, {canvas, colors, count, heights, screen = false, unit = 1}) {
  const c = setColors(colors);
  const portrait = canvas.height > canvas.width;
  const W = canvas.width, H = canvas.height;
  const info = SET_INFO[name];
  if (!info) throw new Error(`unknown set ${JSON.stringify(name)} (sets: ${SETS.join(', ')})`);
  const s = unit;
  const floor = r1(H * (portrait ? 0.74 : 0.8));
  const back = room(canvas, floor, c, s);
  const front = [];
  const tallest = Math.max(...heights);
  let screenRect = null;
  let slots = [];
  // Character scale: the tallest character spans this share of the canvas height.
  const standShare = portrait ? 0.42 : 0.62;
  const scaleFor = share => Math.round((H * share) / tallest * 1000) / 1000;
  const spread = (from, to) => Array.from({length: count}, (_, i) => r1(count === 1 ? (from + to) / 2 : from + (i * (to - from)) / (count - 1)));

  if (name === 'desk-laptop') {
    const scale = scaleFor(portrait ? 0.5 : 0.8);
    const xs = spread(W * (count === 1 ? 0.5 : portrait ? 0.27 : 0.3), W * (portrait ? 0.73 : 0.7));
    slots = xs.map((x, i) => ({x, floor, scale, facing: x < W / 2 ? 'right' : 'left', index: i}));
    if (portrait) back.push(...windowFrame(W * 0.18, H * 0.16, W * 0.3, H * 0.17, s, c), ...frameArt(W * 0.62, H * 0.19, W * 0.2, H * 0.1, s, c));
    else back.push(...windowFrame(W * 0.08, H * 0.12, W * 0.2, H * 0.3, s, c), ...frameArt(W * 0.76, H * 0.16, W * 0.12, H * 0.16, s, c), ...plant(W * 0.9, floor, s * 1.1, c));
    const top = r1(floor - 262 * scale);
    const deskL = Math.min(...xs) - 360 * scale, deskR = Math.max(...xs) + 360 * scale;
    front.push(rect(deskL, top, deskR - deskL, 34 * scale, c.woodTop, {rx: 8 * scale, stroke: c.outline, width: OUT * s}));
    front.push(rect(deskL + 26 * scale, top + 34 * scale, deskR - deskL - 52 * scale, floor - top - 34 * scale + 4, c.wood, {stroke: c.outline, width: OUT * s}));
    front.push(path(`M${r1(deskL + 26 * scale)} ${r1(top + 74 * scale)}L${r1(deskR - 26 * scale)} ${r1(top + 74 * scale)}`, 'none', {stroke: c.woodShade, width: 6 * s}));
    for (const x of xs) {
      // The laptop from behind: the lid's back with a logo, on its base.
      const lw = 220 * scale, lh = 128 * scale;
      front.push(path(`M${r1(x - lw / 2)} ${r1(top)}L${r1(x - lw / 2 + 10 * scale)} ${r1(top - lh)}L${r1(x + lw / 2 - 10 * scale)} ${r1(top - lh)}L${r1(x + lw / 2)} ${r1(top)}Z`, c.metal, {stroke: c.outline, width: OUT * s}));
      front.push(circle(x, top - lh * 0.52, 20 * scale, c.primary));
      front.push(rect(x - lw / 2 - 20 * scale, top - 12 * scale, lw + 40 * scale, 14 * scale, c.metalShade, {rx: 6 * scale, stroke: c.outline, width: OUT * s * 0.8}));
    }
  } else if (name === 'meeting') {
    const scale = scaleFor(portrait ? 0.44 : 0.66);
    if (screen) {
      screenRect = portrait
        ? {x: r1(W * 0.14), y: r1(H * 0.12), width: r1(W * 0.72), height: r1(W * 0.72 * 9 / 16)}
        : {x: r1(W * 0.36), y: r1(H * 0.06), width: r1(W * 0.28), height: r1(W * 0.28 * 9 / 16)};
      back.push(...screenFrame(screenRect, s, c, {stand: false}));
    } else back.push(...windowFrame(W * (portrait ? 0.3 : 0.38), H * (portrait ? 0.14 : 0.1), W * (portrait ? 0.4 : 0.24), H * (portrait ? 0.15 : 0.26), s, c));
    const xs = spread(W * (portrait ? 0.24 : 0.28), W * (portrait ? 0.76 : 0.72));
    slots = xs.map((x, i) => ({x, floor, scale, facing: x < W / 2 ? 'right' : 'left', index: i}));
    const top = r1(floor - 250 * scale);
    front.push(path(`M${r1(W * 0.06)} ${r1(top)}L${r1(W * 0.94)} ${r1(top)}L${r1(W * 0.98)} ${r1(top + 60 * scale)}L${r1(W * 0.02)} ${r1(top + 60 * scale)}Z`, c.woodTop, {stroke: c.outline, width: OUT * s}));
    front.push(rect(W * 0.06, top + 60 * scale, W * 0.88, H - top, c.wood, {stroke: c.outline, width: OUT * s}));
    for (const x of xs) front.push(path(`M${r1(x - 60 * scale)} ${r1(top + 22 * scale)}L${r1(x + 50 * scale)} ${r1(top + 22 * scale)}L${r1(x + 40 * scale)} ${r1(top + 44 * scale)}L${r1(x - 70 * scale)} ${r1(top + 44 * scale)}Z`, '#ffffff', {stroke: c.outline, width: OUT * s * 0.8}));
  } else if (name === 'screen') {
    if (portrait) {
      screenRect = {x: r1(W * 0.1), y: r1(H * 0.1), width: r1(W * 0.8), height: r1(W * 0.8 * 10 / 16)};
      const scale = scaleFor(0.36);
      const xs = spread(W * (count === 1 ? 0.5 : 0.28), W * 0.72);
      slots = xs.map((x, i) => ({x, floor, scale, facing: x < W / 2 ? 'right' : 'left', index: i}));
    } else {
      screenRect = {x: r1(W * 0.07), y: r1(H * 0.1), width: r1(W * 0.52), height: r1(W * 0.52 * 9 / 16)};
      const scale = scaleFor(standShare * 0.92);
      const xs = spread(W * (count === 1 ? 0.78 : 0.7), W * 0.88);
      slots = xs.map((x, i) => ({x, floor, scale, facing: 'left', index: i}));
    }
    back.push(...screenFrame(screenRect, s, c, {stand: false}));
  } else if (name === 'phone') {
    const scale = scaleFor(standShare);
    const xs = spread(W * (count === 1 ? 0.5 : portrait ? 0.3 : 0.32), W * (portrait ? 0.7 : 0.68));
    slots = xs.map((x, i) => ({x, floor, scale, facing: x < W / 2 ? 'right' : 'left', index: i}));
    if (portrait) back.push(...windowFrame(W * 0.26, H * 0.12, W * 0.48, H * 0.18, s, c));
    else back.push(...windowFrame(W * 0.4, H * 0.1, W * 0.2, H * 0.3, s, c), ...frameArt(W * 0.12, H * 0.14, W * 0.12, H * 0.16, s, c), ...plant(W * 0.88, floor, s * 1.1, c));
  }
  return {back, front, screenRect, slots, seated: info.seated, floor, colors: c};
}

/**
 * A phone held in the hand, seen from the back, in rig units with the hand
 * at the origin. `upright`: the rotation that stands it up from the
 * forearm's frame (minus the arm's total angle when it is held).
 */
export function phoneProp(c, upright = 0) {
  return [
    el('g', null, null, [
      rect(-30, -96, 60, 112, '#2a2d36', {rx: 12, stroke: c.outline, width: OUT}),
      circle(-13, -80, 6, '#6b7080'),
      circle(13, -80, 3.5, c.primary ?? '#6b7080')
    ], {transform: `rotate(${upright})`})
  ];
}
