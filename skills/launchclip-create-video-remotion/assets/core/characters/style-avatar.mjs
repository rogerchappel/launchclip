// Drawing style "avatar": cute, relatable avatar proportions. A big head
// (HEAD_SCALE times the rig's, with its hair, face and headwear) on a short,
// chunky body: a compact torso, short legs and thick limbs, soft-shaded
// (style-soft-shade.mjs), with a pin at each shoulder, elbow and knee like a
// cut-out puppet. Same rig, poses, part ids and op list as every toon style
// (toon.mjs), so the acting is identical; only the measurements change.
//
// Imports only sibling kit/core files.

import {rigGeometry} from './rig.mjs';
import {drawToon, toonHeight} from './toon.mjs';
import {softShadePen} from './style-soft-shade.mjs';

export const HEAD_SCALE = 1.7;
const EYE_SCALE = 1.35;

// Raised arms restated wide of the big head: the rig's wave and cheer reach
// over a rig-sized head, so on this one they would cross the face.
const POSES = Object.freeze({
  // The elbow out at shoulder height, the forearm up and out, clear of the head.
  wave: {armA: 92, foreA: 56},
  cheer: {armL: 98, foreL: 50, armR: 98, foreR: 50},
  stretch: {armL: 108, foreL: 40, armR: 108, foreR: 40}
});

/**
 * The avatar body's measurements, the head at its rig size (drawToon scales
 * it). Lengths follow the rig's height and age; widths its build.
 */
export function avatarBody(params) {
  const g = rigGeometry(params);
  const k = g.thigh / 180;
  const thigh = Math.round(104 * k), shin = Math.round(94 * k);
  const foot = g.foot + 6;
  // The outfit's details sit at fixed depths below the collar, so the torso keeps their room.
  const torso = Math.max(196, Math.round(212 * k));
  const neck = Math.round(g.neck * 0.4);
  const hipY = -(thigh + shin + foot);
  const armW = Math.round(g.armW * 1.22), legW = Math.round(g.legW * 1.25);
  const shoulder = Math.round(g.shoulder * 1.02), waist = Math.round(g.waist * 1.06), hip = Math.round(g.hip * 1.06);
  return {
    ...g,
    foot, thigh, shin, torso, neck, hipY,
    shoulderY: -torso,
    shoulder, waist, hip, armW, legW,
    upperArm: Math.round(118 * k), foreArm: Math.round(104 * k), hand: Math.round(armW * 0.6),
    armX: shoulder - armW * 0.42, armY: -torso + armW * 0.55,
    legX: hip - legW * 0.5,
    neckY: -torso - neck * 0.55,
    sitDrop: Math.round(thigh * 0.78),
    poses: POSES,
    height: -hipY + torso + neck + g.head.ry * 1.84 * HEAD_SCALE
  };
}

/** The measurements the poses and framing use: the body with the head at its drawn size. */
export function avatarGeometry(params) {
  const g = avatarBody(params);
  const {rx, ry, cy} = g.head;
  return {...g, head: {rx: Math.round(rx * HEAD_SCALE), ry: Math.round(ry * HEAD_SCALE), cy: Math.round(cy * HEAD_SCALE)}};
}

/** Drawn height above the feet, with hair and headwear scaled with the head. */
export function avatarHeight(params) {
  const above = toonHeight(params) - rigGeometry(params).height;
  return Math.round(avatarBody(params).height + above * HEAD_SCALE);
}

export function drawAvatar(params, colors, options) {
  return drawToon(params, colors, {...options, geometry: avatarBody(params), headScale: HEAD_SCALE, eyeScale: EYE_SCALE, pins: true}, softShadePen);
}

export const STYLE = {draw: drawAvatar, height: avatarHeight, geometry: avatarGeometry, describe: 'cute avatar proportions: a big head on a short, chunky body, soft shading and pin joints'};
