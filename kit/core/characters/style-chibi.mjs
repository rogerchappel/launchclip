// Drawing style "chibi": the cute family. A very big, round head (HEAD_SCALE
// times the rig's, with its hair, face and headwear) on a small, soft body:
// about two heads tall, short legs, chunky limbs and big shoes. The face is
// the toon's cute face (toon.mjs): large glossy eyes set low and wide, no
// nose, a small mouth and blushing cheeks. Flat fills with one even, heavy
// outline: the head's pen restates its line weights so the scaled head and
// the body are inked alike.
//
// Same rig, poses, part ids and op list as every toon style, so the acting
// is identical; only the measurements and the face change.
//
// Imports only sibling kit/core files.

import {rigGeometry} from './rig.mjs';
import {drawToon, toonHeight} from './toon.mjs';
import {flatPen, placed} from './style-flat.mjs';

export const HEAD_SCALE = 2.1;
// The outline, in flat's outline widths: the body's, and the head's before it is scaled.
const INK = 1.45;
const BASE = 7;

// Raised and face-touching arms restated wide of the big head (as style-avatar.mjs does).
const POSES = Object.freeze({
  wave: {armA: 96, foreA: 58},
  cheer: {armL: 102, foreL: 52, armR: 102, foreR: 52},
  stretch: {armL: 110, foreL: 44, armR: 110, foreR: 44},
  look: {armA: 104, foreA: 96},
  think: {armA: 70, foreA: 118, armO: 10, foreO: -70},
  facepalm: {armA: 86, foreA: 128}
});

/** A pen whose outlines and lines are k times as heavy. */
function weighted(pen, k) {
  const ink = BASE * k;
  const limb = (d, fill, width) => [pen.line(d, 'outline', width + ink * 2), pen.line(d, fill, width)];
  return {
    ...pen,
    shape: (d, fill, o = {}) => pen.shape(d, fill, {...o, width: (o.width ?? BASE) * k}),
    ellipse: (cx, cy, rx, ry, fill, o = {}) => pen.ellipse(cx, cy, rx, ry, fill, {...o, width: (o.width ?? BASE) * k}),
    line: (d, color, width) => pen.line(d, color, width * k),
    limb: (length, width, fill, from = 0, place = null) => {
      const nodes = limb(`M0 ${from}L0 ${length}`, fill, width);
      return place ? [placed(nodes, place)] : nodes;
    },
    strand: (d, fill, width) => limb(d, fill, width)
  };
}

const chibiPen = (colors, options) => weighted(flatPen(colors, options), INK);
// The head is scaled after it is drawn, so its pen is lighter by the scale.
const headPen = pen => weighted(pen, 1 / HEAD_SCALE);

/** The chibi body's measurements, the head at its rig size (drawToon scales it). */
export function chibiBody(params) {
  const g = rigGeometry(params);
  // Half the rig's height range: tall and short still differ, but nobody turns lanky.
  const k = 1 + (g.thigh / 180 - 1) * 0.5;
  const thigh = Math.round(74 * k), shin = Math.round(70 * k);
  const foot = g.foot + 10;
  // The outfit's details sit at fixed depths below the collar, so the torso keeps their room.
  const torso = Math.max(196, Math.round(200 * k));
  const neck = Math.round(g.neck * 0.25);
  const hipY = -(thigh + shin + foot);
  const armW = Math.round(g.armW * 1.3), legW = Math.round(g.legW * 1.36);
  // Slim builds keep a soft, rounded trunk.
  const shoulder = Math.max(88, Math.round(g.shoulder * 1.04)), waist = Math.max(80, Math.round(g.waist * 1.16)), hip = Math.max(84, Math.round(g.hip * 1.16));
  const headR = g.head.ry;
  return {
    ...g,
    foot, thigh, shin, torso, neck, hipY,
    shoulderY: -torso,
    shoulder, waist, hip, armW, legW,
    upperArm: Math.round(104 * k), foreArm: Math.round(92 * k), hand: Math.round(armW * 0.62),
    armX: shoulder - armW * 0.42, armY: -torso + armW * 0.55,
    legX: hip - legW * 0.5,
    neckY: -torso - neck * 0.55,
    // A rounder head than the rig's egg.
    head: {rx: Math.round(headR * 0.99), ry: Math.round(headR * 0.96), cy: -Math.round(headR * 0.96 * 0.9)},
    sitDrop: Math.round(thigh * 0.78),
    poses: POSES,
    height: -hipY + torso + neck + headR * 0.96 * 1.84 * HEAD_SCALE
  };
}

/** The measurements the poses and framing use: the body with the head at its drawn size. */
export function chibiGeometry(params) {
  const g = chibiBody(params);
  const {rx, ry, cy} = g.head;
  return {...g, head: {rx: Math.round(rx * HEAD_SCALE), ry: Math.round(ry * HEAD_SCALE), cy: Math.round(cy * HEAD_SCALE)}};
}

/** Drawn height above the feet, with hair and headwear scaled with the head. */
export function chibiHeight(params) {
  const above = toonHeight(params) - rigGeometry(params).height;
  return Math.round(chibiBody(params).height + above * HEAD_SCALE);
}

export function drawChibi(params, colors, options) {
  return drawToon(params, colors, {...options, geometry: chibiBody(params), headScale: HEAD_SCALE, face: 'cute', headPen}, chibiPen);
}

// The plain figure: the same cute body with no skin tone, a paper-white
// person like a stick figure's head, told apart by hair and clothes alone.
const PLAIN = Object.freeze({skin: '#fbf7ef', skinShade: '#ded6c8', skinLight: '#ffffff', blush: '#f2b3a6'});

export function drawChibiPlain(params, colors, options) {
  return drawChibi(params, {...colors, ...PLAIN}, options);
}

export const STYLE_PLAIN = {draw: drawChibiPlain, height: chibiHeight, geometry: chibiGeometry, describe: 'the cute family as a neutral figure: the chibi body in paper white with no skin tone, told apart by hair and clothes'};

export const STYLE = {draw: drawChibi, height: chibiHeight, geometry: chibiGeometry, describe: 'the cute family: a very big round head with large glossy eyes on a small soft body, flat fills and one even heavy outline'};
