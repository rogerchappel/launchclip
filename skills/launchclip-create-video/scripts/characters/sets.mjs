// Sets for character scenes: the room a cast-scene plays in.
//
//   desk-laptop  a desk with a laptop per character, seen from the front;
//                the cast sits behind it
//   phone        the cast stands; the first character holds a phone
//   standing     the cast just stands, hands free: in a world, nothing else
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

export const SETS = Object.freeze(['desk-laptop', 'phone', 'meeting', 'screen', 'kitchen-counter', 'sofa', 'podium', 'stage', 'car', 'park-bench', 'video-call', 'standing-desk', 'standing']);
export const SEATED_SETS = Object.freeze(['desk-laptop', 'meeting', 'sofa', 'car', 'park-bench', 'video-call']);
export const SCREEN_SETS = Object.freeze(['screen', 'meeting']);
// Backdrops: the set's own room, or its furniture alone in a world.
export const BACKDROPS = Object.freeze(['room', 'world']);
export const SET_INFO = Object.freeze({
  'desk-laptop': {seated: true, screen: 'none', world: true, describe: 'a desk with a laptop per character; the cast sits behind it'},
  'phone': {seated: false, screen: 'none', world: true, describe: 'the cast stands in a room; the first character holds a phone'},
  'meeting': {seated: true, screen: 'optional', world: true, describe: 'a meeting table the cast sits behind; a wall screen plays a supplied capture'},
  'screen': {seated: false, screen: 'required', world: true, describe: 'a big screen playing a real capture (image, video or demo-autopilot recording) with the cast beside it'},
  'kitchen-counter': {seated: false, screen: 'none', world: true, describe: 'a kitchen: the cast stands behind a counter with a chopping board and a pot, cabinets and a hood behind'},
  'sofa': {seated: true, screen: 'none', world: true, describe: 'a living room: the cast sits on a sofa, a lamp and a picture behind'},
  'podium': {seated: false, screen: 'none', world: true, describe: 'a talk: the first character speaks at a lectern with a microphone, a banner behind; the rest stand beside'},
  'stage': {seated: false, screen: 'none', world: true, describe: 'a stage: curtains, spotlights and footlights, the cast standing in the light'},
  'car': {seated: true, screen: 'none', world: true, describe: 'a car seen through the windscreen: the first character drives, the rest ride beside'},
  'park-bench': {seated: true, screen: 'none', world: true, describe: 'a park: the cast sits on a bench under trees and sky'},
  'video-call': {seated: true, screen: 'none', world: false, describe: 'a video call: each character in their own tile at home, with call controls below'},
  'standing-desk': {seated: false, screen: 'none', world: true, describe: 'an office: the cast stands at a standing desk with monitors seen from behind'},
  'standing': {seated: false, screen: 'none', world: true, describe: 'the cast stands with nothing in hand: in a world (a street, a rooftop, a park) there is no furniture at all; its own room is a plain wall and window'}
});
// Sets with a furniture-only form (backdrop "world"); a video call is its own room.
export const WORLD_SETS = Object.freeze(SETS.filter(name => SET_INFO[name].world));

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

// ---------------------------------------------------------------------------
// Scenery for the newer sets

function outdoor(canvas, floor, c, s) {
  const W = canvas.width, H = canvas.height;
  const sky = mixColor('#ffffff', c.sky, 0.25);
  const grass = mixColor(c.plant, '#9cc77d', 0.45);
  const out = [rect(0, 0, W, floor, sky)];
  for (let i = 0; i < 3; i++) {
    const cx = W * (0.2 + i * 0.3), cy = floor * (0.18 + (i % 2) * 0.08);
    out.push(path(`M${r1(cx - 120 * s)} ${r1(cy)}Q${r1(cx - 70 * s)} ${r1(cy - 50 * s)} ${r1(cx)} ${r1(cy - 20 * s)}Q${r1(cx + 60 * s)} ${r1(cy - 60 * s)} ${r1(cx + 130 * s)} ${r1(cy)}Z`, '#ffffff', {opacity: 0.85}));
  }
  out.push(path(`M0 ${r1(floor - 90 * s)}Q${r1(W * 0.3)} ${r1(floor - 170 * s)} ${r1(W * 0.6)} ${r1(floor - 100 * s)}Q${r1(W * 0.85)} ${r1(floor - 60 * s)} ${W} ${r1(floor - 120 * s)}L${W} ${r1(floor)}L0 ${r1(floor)}Z`, mixColor(c.plantShade, grass, 0.3)));
  out.push(rect(0, floor, W, H - floor, grass));
  out.push(path(`M${r1(W * 0.42)} ${H}L${r1(W * 0.47)} ${r1(floor)}L${r1(W * 0.53)} ${r1(floor)}L${r1(W * 0.6)} ${H}Z`, '#e3d3b4', {opacity: 0.8}));
  return out;
}

function tree(x, floor, s, c) {
  return [
    rect(x - 22 * s, floor - 320 * s, 44 * s, 320 * s, c.woodShade, {stroke: c.outline, width: OUT * s}),
    circle(x - 70 * s, floor - 360 * s, 110 * s, c.plantShade, {stroke: c.outline, width: OUT * s}),
    circle(x + 70 * s, floor - 380 * s, 120 * s, c.plant, {stroke: c.outline, width: OUT * s}),
    circle(x, floor - 470 * s, 130 * s, c.plant, {stroke: c.outline, width: OUT * s})
  ];
}

function lamp(x, floor, s, c) {
  return [
    rect(x - 6 * s, floor - 420 * s, 12 * s, 420 * s, c.metalShade),
    rect(x - 60 * s, floor - 12 * s, 120 * s, 14 * s, c.metalShade, {rx: 6 * s}),
    path(`M${r1(x - 70 * s)} ${r1(floor - 400 * s)}L${r1(x + 70 * s)} ${r1(floor - 400 * s)}L${r1(x + 46 * s)} ${r1(floor - 500 * s)}L${r1(x - 46 * s)} ${r1(floor - 500 * s)}Z`, mixColor(c.accent, '#ffffff', 0.7), {stroke: c.outline, width: OUT * s})
  ];
}

/** A video-call tile's room: a tinted wall, a shelf with books and a plant. */
function callRoom(t, s, c, i) {
  const wall = mixColor(i % 2 ? c.accent : c.primary, '#f4efe6', 0.12 + 0.06 * i);
  const out = [rect(t.x, t.y, t.width, t.height, wall)];
  const sy = t.y + t.height * 0.3;
  out.push(rect(t.x + t.width * 0.6, sy, t.width * 0.32, 10 * s, c.woodShade));
  const books = ['#c8553d', '#2f6690', '#e0a458', '#3a7d44'];
  books.forEach((color, k) => out.push(rect(t.x + t.width * 0.62 + k * 22 * s, sy - (50 + (k % 2) * 12) * s, 18 * s, (50 + (k % 2) * 12) * s, color)));
  out.push(...plant(t.x + t.width * 0.14, t.y + t.height * 0.62, s * 0.55, c));
  return out;
}

/**
 * Lay out a set. canvas {width, height}; colors: brand colours; count: 1–3
 * characters; heights: drawn heights (rig units) per character; screen:
 * true when a capture is supplied.
 * backdrop: "room" draws the set's own room (walls, windows, sky, trees);
 * "world" draws only its furniture and props, to stand in a world drawn
 * behind it. floor: the floor line in canvas px (a world's ground; default
 * the set's own). grade: hex → hex, recolouring every set colour (a world's
 * time-of-day grade).
 * → {back, front, screenRect | null, slots: [{x, floor, scale, facing}], seated, floor}
 */
export function layoutSet(name, {canvas, colors, count, heights, screen = false, unit = 1, backdrop = 'room', floor: floorAt = null, grade = null}) {
  if (!BACKDROPS.includes(backdrop)) throw new Error(`unknown set backdrop ${JSON.stringify(backdrop)} (${BACKDROPS.join(', ')})`);
  if (backdrop === 'world' && !SET_INFO[name]?.world) throw new Error(`the ${name} set has no furniture-only form; it cannot stand in a world (sets that can: ${WORLD_SETS.join(', ')})`);
  const own = setColors(colors);
  const c = grade ? Object.fromEntries(Object.entries(own).map(([key, hex]) => [key, grade(hex)])) : own;
  const portrait = canvas.height > canvas.width;
  const W = canvas.width, H = canvas.height;
  const info = SET_INFO[name];
  if (!info) throw new Error(`unknown set ${JSON.stringify(name)} (sets: ${SETS.join(', ')})`);
  const s = unit;
  const floor = floorAt ?? r1(H * (portrait ? 0.74 : 0.8));
  // Scenery (walls, windows, pictures, sky, trees, curtains) stays apart from
  // the furniture, so a set can stand in a world with its furniture alone.
  const scenery = room(canvas, floor, c, s);
  const back = [];
  const front = [];
  const frontScenery = [];
  const tallest = Math.max(...heights);
  let screenRect = null;
  let slots = [];
  // Character scale: the tallest character spans this share of the canvas height.
  const standShare = portrait ? 0.42 : 0.62;
  const scaleFor = share => Math.round((H * share) / tallest * 1000) / 1000;
  const spread = (from, to) => Array.from({length: count}, (_, i) => r1(count === 1 ? (from + to) / 2 : from + (i * (to - from)) / (count - 1)));

  if (name === 'desk-laptop') {
    const scale = scaleFor(portrait ? 0.5 : 0.8);
    const xs = spread(W * (count === 1 ? 0.5 : portrait ? 0.31 : 0.3), W * (portrait ? 0.69 : 0.7));
    slots = xs.map((x, i) => ({x, floor, scale, facing: x < W / 2 ? 'right' : 'left', index: i}));
    if (portrait) scenery.push(...windowFrame(W * 0.18, H * 0.16, W * 0.3, H * 0.17, s, c), ...frameArt(W * 0.62, H * 0.19, W * 0.2, H * 0.1, s, c));
    else scenery.push(...windowFrame(W * 0.08, H * 0.12, W * 0.2, H * 0.3, s, c), ...frameArt(W * 0.76, H * 0.16, W * 0.12, H * 0.16, s, c)), back.push(...plant(W * 0.9, floor, s * 1.1, c));
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
    } else scenery.push(...windowFrame(W * (portrait ? 0.3 : 0.38), H * (portrait ? 0.14 : 0.1), W * (portrait ? 0.4 : 0.24), H * (portrait ? 0.15 : 0.26), s, c));
    const xs = spread(W * (portrait ? 0.29 : 0.28), W * (portrait ? 0.71 : 0.72));
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
  } else if (name === 'phone' || name === 'standing') {
    const scale = scaleFor(standShare);
    const xs = spread(W * (count === 1 ? 0.5 : portrait ? 0.3 : 0.32), W * (portrait ? 0.7 : 0.68));
    slots = xs.map((x, i) => ({x, floor, scale, facing: x < W / 2 ? 'right' : 'left', index: i}));
    if (portrait) scenery.push(...windowFrame(W * 0.26, H * 0.12, W * 0.48, H * 0.18, s, c));
    else scenery.push(...windowFrame(W * 0.4, H * 0.1, W * 0.2, H * 0.3, s, c), ...frameArt(W * 0.12, H * 0.14, W * 0.12, H * 0.16, s, c)), back.push(...plant(W * 0.88, floor, s * 1.1, c));
  }
  else slots = newerSet(name, {canvas, c, count, s, floor, scenery, back, front, frontScenery, portrait, scaleFor, spread, standShare, W, H, tallest});
  const inRoom = backdrop === 'room';
  return {back: inRoom ? [...scenery, ...back] : back, front: inRoom ? [...frontScenery, ...front] : front, screenRect, slots, seated: info.seated, floor, colors: c};
}

/** The newer sets: draws their scenery into back and front, returns their slots. */
function newerSet(name, {canvas, c, count, s, floor, scenery, back, front, frontScenery, portrait, scaleFor, spread, standShare, W, H, tallest}) {
  const facingOf = x => (x < W / 2 ? 'right' : 'left');
  const slotsAt = (xs, scale, y = floor) => xs.map((x, i) => ({x, floor: y, scale, facing: facingOf(x), index: i}));
  if (name === 'kitchen-counter') {
    const scale = scaleFor(standShare);
    const xs = spread(W * (count === 1 ? 0.5 : portrait ? 0.3 : 0.32), W * (portrait ? 0.7 : 0.68));
    // Upper cabinets, a tiled splash and a hood behind; the counter in front at hip height.
    const cabTop = floor - 900 * scale, cabBottom = floor - 640 * scale;
    for (let x = W * 0.04; x < W * 0.96 - 10; x += W * 0.15) {
      if (Math.abs(x + W * 0.075 - W / 2) < W * 0.09) continue;
      scenery.push(rect(x, cabTop, W * 0.14, cabBottom - cabTop, mixColor(c.primary, '#ffffff', 0.78), {rx: 6 * s, stroke: c.outline, width: OUT * s}));
      scenery.push(circle(x + W * 0.12, cabBottom - 26 * s, 6 * s, c.metalShade));
    }
    scenery.push(path(`M${r1(W * 0.42)} ${r1(cabBottom - 40 * s)}L${r1(W * 0.58)} ${r1(cabBottom - 40 * s)}L${r1(W * 0.62)} ${r1(cabBottom + 40 * s)}L${r1(W * 0.38)} ${r1(cabBottom + 40 * s)}Z`, c.metal, {stroke: c.outline, width: OUT * s}));
    scenery.push(rect(W * 0.47, cabTop, W * 0.06, cabBottom - cabTop - 40 * s, c.metalShade, {stroke: c.outline, width: OUT * s}));
    for (let y = cabBottom + 70 * s; y < floor - 340 * scale; y += 46 * s) scenery.push(path(`M0 ${r1(y)}L${W} ${r1(y)}`, 'none', {stroke: c.wallShade, width: 3 * s}));
    const top = r1(floor - 340 * scale);
    front.push(rect(W * 0.04, top, W * 0.92, 30 * scale, mixColor('#ffffff', c.metal, 0.5), {rx: 6 * scale, stroke: c.outline, width: OUT * s}));
    front.push(rect(W * 0.05, top + 30 * scale, W * 0.9, floor - top - 30 * scale + 4, mixColor(c.primary, c.wood, 0.25), {stroke: c.outline, width: OUT * s}));
    for (let x = W * 0.05; x < W * 0.94; x += W * 0.15) {
      front.push(path(`M${r1(x)} ${r1(top + 30 * scale)}L${r1(x)} ${r1(floor)}`, 'none', {stroke: c.outline, width: OUT * s * 0.8}));
      front.push(rect(x + W * 0.06, top + 70 * scale, W * 0.03, 10 * scale, c.metalShade, {rx: 4 * scale}));
    }
    // A chopping board and a pot on the counter.
    front.push(rect(W * 0.12, top - 14 * scale, 150 * scale, 16 * scale, c.woodTop, {rx: 6 * scale, stroke: c.outline, width: OUT * s * 0.8}));
    front.push(path(`M${r1(W * 0.8)} ${r1(top - 110 * scale)}L${r1(W * 0.8 + 150 * scale)} ${r1(top - 110 * scale)}L${r1(W * 0.8 + 140 * scale)} ${r1(top)}L${r1(W * 0.8 + 10 * scale)} ${r1(top)}Z`, c.metalShade, {stroke: c.outline, width: OUT * s}));
    return slotsAt(xs, scale);
  }
  if (name === 'sofa') {
    const scale = scaleFor(portrait ? 0.48 : 0.74);
    const xs = spread(W * (count === 1 ? 0.5 : portrait ? 0.3 : 0.34), W * (portrait ? 0.7 : 0.66));
    if (portrait) scenery.push(...frameArt(W * 0.3, H * 0.14, W * 0.4, H * 0.12, s, c));
    else scenery.push(...frameArt(W * 0.38, H * 0.1, W * 0.24, H * 0.2, s, c)), back.push(...lamp(W * 0.1, floor, s * 1.2, c), ...plant(W * 0.9, floor, s * 1.1, c));
    const L = Math.min(...xs) - 300 * scale, R = Math.max(...xs) + 300 * scale;
    const sofa = mixColor(c.primary, '#5c5a66', 0.35);
    const backTop = floor - 620 * scale, seat = floor - 230 * scale;
    back.push(rect(L, backTop, R - L, seat - backTop + 40 * scale, sofa, {rx: 40 * scale, stroke: c.outline, width: OUT * s}));
    for (const x of xs) back.push(rect(x - 150 * scale, backTop + 40 * scale, 300 * scale, seat - backTop - 40 * scale, mixColor('#ffffff', sofa, 0.12), {rx: 30 * scale, stroke: c.outline, width: OUT * s * 0.8}));
    front.push(rect(L + 40 * scale, seat, R - L - 80 * scale, 120 * scale, mixColor('#ffffff', sofa, 0.08), {rx: 24 * scale, stroke: c.outline, width: OUT * s}));
    front.push(rect(L, seat + 100 * scale, R - L, floor - seat - 140 * scale, sofa, {rx: 16 * scale, stroke: c.outline, width: OUT * s}));
    for (const x of [L - 10 * scale, R - 110 * scale]) front.push(rect(x, seat - 140 * scale, 120 * scale, floor - seat + 100 * scale, sofa, {rx: 40 * scale, stroke: c.outline, width: OUT * s}));
    for (const x of [L + 40 * scale, R - 60 * scale]) front.push(rect(x, floor - 44 * scale, 20 * scale, 44 * scale, c.woodShade));
    return slotsAt(xs, scale);
  }
  if (name === 'podium') {
    const scale = scaleFor(standShare);
    const xs = count === 1 ? [r1(W * 0.5)] : spread(W * (portrait ? 0.32 : 0.36), W * (portrait ? 0.7 : 0.66));
    // A banner behind the speaker.
    scenery.push(rect(W * 0.18, H * 0.08, W * 0.64, floor - H * 0.08 - 200 * scale, c.primary, {rx: 12 * s, stroke: c.outline, width: OUT * s}));
    scenery.push(rect(W * 0.18, H * 0.08 + (floor - H * 0.08 - 200 * scale) * 0.78, W * 0.64, 22 * s, c.accent));
    scenery.push(circle(W * 0.5, H * 0.08 + (floor - H * 0.08) * 0.3, Math.min(W, H) * 0.06, mixColor('#ffffff', c.primary, 0.3)));
    // The lectern in front of the first character, with a microphone.
    const x = xs[0], top = floor - 520 * scale;
    front.push(path(`M${r1(x - 170 * scale)} ${r1(top)}L${r1(x + 170 * scale)} ${r1(top)}L${r1(x + 130 * scale)} ${r1(floor)}L${r1(x - 130 * scale)} ${r1(floor)}Z`, c.wood, {stroke: c.outline, width: OUT * s}));
    front.push(rect(x - 190 * scale, top - 26 * scale, 380 * scale, 30 * scale, c.woodTop, {rx: 8 * scale, stroke: c.outline, width: OUT * s}));
    front.push(circle(x, top + 160 * scale, 46 * scale, c.accent, {stroke: c.outline, width: OUT * s * 0.8}));
    front.push(path(`M${r1(x + 60 * scale)} ${r1(top - 20 * scale)}Q${r1(x + 70 * scale)} ${r1(top - 150 * scale)} ${r1(x + 20 * scale)} ${r1(top - 190 * scale)}`, 'none', {stroke: '#2a2d36', width: 8 * scale}));
    front.push(circle(x + 16 * scale, top - 196 * scale, 16 * scale, '#2a2d36'));
    return slotsAt(xs, scale);
  }
  if (name === 'stage') {
    const scale = scaleFor(standShare * 0.94);
    const xs = spread(W * (count === 1 ? 0.5 : portrait ? 0.3 : 0.32), W * (portrait ? 0.7 : 0.68));
    const curtain = mixColor('#14101a', c.primary, 0.35);
    scenery.push(rect(0, 0, W, H, mixColor('#0d0b12', c.primary, 0.12)));
    for (let x = 0; x < W; x += W / 14) scenery.push(path(`M${r1(x)} 0Q${r1(x + W / 28)} ${r1(floor * 0.5)} ${r1(x)} ${r1(floor)}`, 'none', {stroke: mixColor('#000000', curtain, 0.3), width: 6 * s, opacity: 0.6}));
    scenery.push(path(`M0 0L${r1(W * 0.16)} 0Q${r1(W * 0.1)} ${r1(floor * 0.6)} ${r1(W * 0.12)} ${r1(floor)}L0 ${r1(floor)}Z`, curtain, {stroke: c.outline, width: OUT * s}));
    scenery.push(path(`M${W} 0L${r1(W * 0.84)} 0Q${r1(W * 0.9)} ${r1(floor * 0.6)} ${r1(W * 0.88)} ${r1(floor)}L${W} ${r1(floor)}Z`, curtain, {stroke: c.outline, width: OUT * s}));
    scenery.push(rect(0, 0, W, H * 0.07, curtain, {stroke: c.outline, width: OUT * s}));
    scenery.push(rect(0, floor, W, H - floor, mixColor('#2a1f18', c.wood, 0.45)));
    // Spotlights on each character.
    for (const x of xs) back.push(path(`M${r1(x - 30 * s)} 0L${r1(x + 30 * s)} 0L${r1(x + 240 * scale)} ${r1(floor)}L${r1(x - 240 * scale)} ${r1(floor)}Z`, '#fff6d8', {opacity: 0.13}), path(`M${r1(x - 240 * scale)} ${r1(floor - 20 * scale)}Q${r1(x)} ${r1(floor - 60 * scale)} ${r1(x + 240 * scale)} ${r1(floor - 20 * scale)}Q${r1(x)} ${r1(floor + 40 * scale)} ${r1(x - 240 * scale)} ${r1(floor - 20 * scale)}Z`, '#fff6d8', {opacity: 0.22}));
    front.push(rect(0, floor + 30 * s, W, 26 * s, mixColor('#000000', c.wood, 0.5)));
    for (let x = W * 0.08; x < W; x += W * 0.12) front.push(circle(x, floor + 43 * s, 9 * s, '#ffd27a'));
    return slotsAt(xs, scale);
  }
  if (name === 'car') {
    const scale = scaleFor(portrait ? 0.5 : 0.78);
    const n = Math.min(count, 3);
    const xs = spread(W * (n === 1 ? 0.4 : portrait ? 0.32 : 0.36), W * (portrait ? 0.68 : 0.64));
    const body = c.primary, glass = mixColor('#ffffff', c.sky, 0.3);
    // Outside: sky and road; inside the car: the rear window and seats.
    scenery.push(rect(0, 0, W, H, mixColor('#ffffff', c.sky, 0.2)));
    scenery.push(rect(0, H * 0.58, W, H * 0.42, '#6d6f78'));
    const roof = floor - 880 * scale, belt = floor - 330 * scale;
    const L = W * (portrait ? 0.04 : 0.14), R = W * (portrait ? 0.96 : 0.86);
    back.push(path(`M${r1(L + 60 * s)} ${r1(roof + 40 * s)}L${r1(R - 60 * s)} ${r1(roof + 40 * s)}L${r1(R)} ${r1(belt)}L${r1(L)} ${r1(belt)}Z`, mixColor('#1d1f26', '#3a3d46', 0.5)));
    back.push(path(`M${r1(L + 120 * s)} ${r1(roof + 80 * s)}L${r1(R - 120 * s)} ${r1(roof + 80 * s)}L${r1(R - 160 * s)} ${r1(roof + 240 * s)}L${r1(L + 160 * s)} ${r1(roof + 240 * s)}Z`, glass, {opacity: 0.7}));
    for (const x of xs) back.push(rect(x - 150 * scale, belt - 560 * scale, 300 * scale, 600 * scale, '#2c2e36', {rx: 50 * scale}), rect(x - 80 * scale, belt - 660 * scale, 160 * scale, 110 * scale, '#2c2e36', {rx: 30 * scale}));
    // The car around them: roof, pillars, the windscreen's glare, the bonnet, the wheel.
    frontScenery.push(path(`M0 0L${W} 0L${W} ${r1(roof)}L0 ${r1(roof)}Z`, mixColor('#ffffff', c.sky, 0.2)));
    front.push(path(`M${r1(L - 40 * s)} ${r1(roof - 30 * s)}L${r1(R + 40 * s)} ${r1(roof - 30 * s)}L${r1(R - 30 * s)} ${r1(roof + 40 * s)}L${r1(L + 30 * s)} ${r1(roof + 40 * s)}Z`, body, {stroke: c.outline, width: OUT * s}));
    for (const [a, b] of [[L - 40 * s, L + 50 * s], [R + 40 * s, R - 50 * s]]) front.push(path(`M${r1(a)} ${r1(roof - 30 * s)}L${r1(b)} ${r1(roof + 40 * s)}L${r1(b + (a < b ? 60 : -60) * s)} ${r1(belt)}L${r1(a + (a < b ? -30 : 30) * s)} ${r1(belt)}Z`, body, {stroke: c.outline, width: OUT * s}));
    front.push(path(`M${r1(L + 200 * s)} ${r1(roof + 60 * s)}L${r1(L + 300 * s)} ${r1(roof + 60 * s)}L${r1(L + 120 * s)} ${r1(belt - 40 * s)}L${r1(L + 60 * s)} ${r1(belt - 40 * s)}Z`, '#ffffff', {opacity: 0.16}));
    front.push(circle(xs[0], belt - 40 * scale, 120 * scale, 'none', {stroke: '#23252b', width: 22 * scale}));
    front.push(path(`M${r1(L - 80 * s)} ${r1(belt)}L${r1(R + 80 * s)} ${r1(belt)}L${r1(R + 120 * s)} ${r1(H)}L${r1(L - 120 * s)} ${r1(H)}Z`, body, {stroke: c.outline, width: OUT * s}));
    front.push(rect(L - 60 * s, belt - 6 * s, R - L + 120 * s, 26 * s, mixColor('#000000', body, 0.25), {rx: 8 * s}));
    for (const x of [L + 40 * s, R - 200 * s]) front.push(rect(x, belt + 110 * s, 160 * s, 60 * s, '#f6f1d8', {rx: 26 * s, stroke: c.outline, width: OUT * s}));
    return slotsAt(xs, scale);
  }
  if (name === 'park-bench') {
    scenery.push(...outdoor(canvas, floor, c, s));
    const scale = scaleFor(portrait ? 0.5 : 0.76);
    const xs = spread(W * (count === 1 ? 0.5 : portrait ? 0.3 : 0.34), W * (portrait ? 0.7 : 0.66));
    if (!portrait) scenery.push(...tree(W * 0.1, floor, s * 1.2, c), ...tree(W * 0.9, floor, s * 1.1, c));
    else scenery.push(...tree(W * 0.15, floor, s * 0.9, c));
    const L = Math.min(...xs) - 280 * scale, R = Math.max(...xs) + 280 * scale;
    const seat = floor - 230 * scale;
    for (let k = 0; k < 3; k++) back.push(rect(L, seat - (420 - k * 110) * scale, R - L, 70 * scale, c.wood, {rx: 10 * scale, stroke: c.outline, width: OUT * s}));
    for (const x of [L + 40 * scale, R - 70 * scale]) back.push(rect(x, seat - 430 * scale, 30 * scale, 430 * scale, '#3a3d46'));
    front.push(rect(L - 20 * scale, seat, R - L + 40 * scale, 60 * scale, c.woodTop, {rx: 10 * scale, stroke: c.outline, width: OUT * s}));
    for (const x of [L + 30 * scale, R - 80 * scale]) front.push(path(`M${r1(x)} ${r1(seat + 60 * scale)}L${r1(x + 50 * scale)} ${r1(seat + 60 * scale)}L${r1(x + 60 * scale)} ${r1(floor)}L${r1(x - 10 * scale)} ${r1(floor)}Z`, '#3a3d46', {stroke: c.outline, width: OUT * s * 0.8}));
    return slotsAt(xs, scale);
  }
  if (name === 'video-call') {
    // Tiles in a row (landscape) or a column (portrait). Each character sits
    // at a desk whose edge runs along its tile's bottom, so nobody reaches
    // past their tile; the app frame masks everything outside the tiles.
    const n = count;
    const gap = 24 * s, bar = 120 * s, pad = 40 * s;
    const area = {x: pad, y: pad, width: W - pad * 2, height: H - pad * 2 - bar};
    const tiles = [];
    if (portrait) {
      const th = Math.min((area.height - gap * (n - 1)) / n, area.width * 0.9);
      const y0 = area.y + (area.height - (th * n + gap * (n - 1))) / 2;
      for (let i = 0; i < n; i++) tiles.push({x: area.x, y: y0 + i * (th + gap), width: area.width, height: th});
    } else {
      const tw = Math.min((area.width - gap * (n - 1)) / n, area.height * 1.4);
      const x0 = W / 2 - (tw * n + gap * (n - 1)) / 2;
      const th = Math.min(area.height, tw / 1.2);
      for (let i = 0; i < n; i++) tiles.push({x: x0 + i * (tw + gap), y: area.y + (area.height - th) / 2, width: tw, height: th});
    }
    const app = '#15171e';
    back.push(rect(0, 0, W, H, app));
    tiles.forEach((t, i) => back.push(...callRoom(t, s, c, i)));
    const hole = t => { const r = 18 * s; return `M${r1(t.x + r)} ${r1(t.y)}L${r1(t.x + t.width - r)} ${r1(t.y)}Q${r1(t.x + t.width)} ${r1(t.y)} ${r1(t.x + t.width)} ${r1(t.y + r)}L${r1(t.x + t.width)} ${r1(t.y + t.height - r)}Q${r1(t.x + t.width)} ${r1(t.y + t.height)} ${r1(t.x + t.width - r)} ${r1(t.y + t.height)}L${r1(t.x + r)} ${r1(t.y + t.height)}Q${r1(t.x)} ${r1(t.y + t.height)} ${r1(t.x)} ${r1(t.y + t.height - r)}L${r1(t.x)} ${r1(t.y + r)}Q${r1(t.x)} ${r1(t.y)} ${r1(t.x + r)} ${r1(t.y)}Z`; };
    front.push(el('path', null, null, [], {d: `M0 0L${W} 0L${W} ${H}L0 ${H}Z${tiles.map(hole).join('')}`, fill: app, fillRule: 'evenodd'}));
    tiles.forEach((t, i) => {
      front.push(rect(t.x, t.y + t.height * 0.84, t.width, t.height * 0.16, mixColor(c.woodShade, c.woodTop, 0.4)), path(`M${r1(t.x)} ${r1(t.y + t.height * 0.84)}L${r1(t.x + t.width)} ${r1(t.y + t.height * 0.84)}`, 'none', {stroke: c.woodShade, width: 5 * s}));
      front.push(rect(t.x + 18 * s, t.y + t.height - 52 * s, 150 * s, 34 * s, '#000000', {rx: 17 * s, opacity: 0.45}));
      front.push(circle(t.x + 38 * s, t.y + t.height - 35 * s, 9 * s, i === 0 ? '#5ad17a' : '#ffffff'));
      front.push(rect(t.x + 56 * s, t.y + t.height - 39 * s, 90 * s, 8 * s, '#ffffff', {rx: 4 * s, opacity: 0.75}));
    });
    const by = H - pad - bar / 2;
    [-2, -1, 0, 1, 2].forEach(k => front.push(circle(W / 2 + k * 90 * s, by, 32 * s, k === 2 ? '#e5484d' : '#2c2f3a')));
    // Seated at the desk: hips just under its edge, the head near the tile's top.
    return tiles.map((t, i) => {
      // Seated, a character is about 0.84 of its standing height; the feet stay inside the tile.
      const scale = Math.round(Math.min((t.height * 0.8) / (tallest * 0.84), (t.width * 0.66) / (tallest * 0.5)) * 1000) / 1000;
      const x = r1(t.x + t.width * 0.5);
      return {x, floor: r1(t.y + t.height - 4 * s), scale, facing: i % 2 ? 'left' : 'right', index: i};
    });
  }
  if (name === 'standing-desk') {
    const scale = scaleFor(standShare);
    const xs = spread(W * (count === 1 ? 0.5 : portrait ? 0.3 : 0.32), W * (portrait ? 0.7 : 0.68));
    if (portrait) scenery.push(...windowFrame(W * 0.26, H * 0.12, W * 0.48, H * 0.16, s, c));
    else scenery.push(...windowFrame(W * 0.08, H * 0.12, W * 0.2, H * 0.3, s, c)), back.push(...plant(W * 0.92, floor, s * 1.1, c));
    const top = floor - 480 * scale;
    const L = Math.min(...xs) - 330 * scale, R = Math.max(...xs) + 330 * scale;
    for (const x of xs) {
      // A monitor from behind, on an arm.
      front.push(rect(x - 130 * scale, top - 170 * scale, 260 * scale, 140 * scale, c.metalShade, {rx: 12 * scale, stroke: c.outline, width: OUT * s}));
      front.push(rect(x - 14 * scale, top - 32 * scale, 28 * scale, 32 * scale, c.metal, {stroke: c.outline, width: OUT * s * 0.8}));
    }
    front.push(rect(L, top, R - L, 30 * scale, c.woodTop, {rx: 8 * scale, stroke: c.outline, width: OUT * s}));
    for (const x of [L + 50 * scale, R - 86 * scale]) front.push(rect(x, top + 30 * scale, 36 * scale, floor - top - 30 * scale, c.metalShade, {stroke: c.outline, width: OUT * s * 0.8}), rect(x - 50 * scale, floor - 18 * scale, 136 * scale, 18 * scale, c.metalShade, {rx: 6 * scale}));
    front.push(rect(L + 90 * scale, top + 60 * scale, R - L - 180 * scale, 40 * scale, c.metal, {rx: 6 * scale, opacity: 0.85}));
    return slotsAt(xs, scale);
  }
  throw new Error(`unknown set ${JSON.stringify(name)}`);
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
