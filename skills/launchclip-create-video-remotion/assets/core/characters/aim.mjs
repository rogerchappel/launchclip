// Pointing: the arm a character points with, aimed at what it points at.
//
// The point pose holds the arm straight out. Aimed instead, the arm points
// along the line from the shoulder to the target (a character's chest, a
// place, a point on the canvas) and the fingertip stops short when it would
// go too far, by bending the elbow (two-bone reach):
//
// - at another character: before half the gap between them, so two people
//   pointing at each other never cross arms or poke through a body;
// - at the frame's edge: inside the safe zone, so a hand never ends under a
//   Shorts UI rail or off the canvas.
//
// Angles are the rig's (rig.mjs): 0 hangs straight down, positive swings
// out on the arm's own side; the forearm's angle is relative to the upper
// arm. Imports nothing.

const deg = rad => (rad * 180) / Math.PI;
const r1 = value => Math.round(value * 10) / 10;
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

// The fingertip stops at this share of the gap to another character.
export const AIM = Object.freeze({gap: 0.46, pad: 14, minAngle: 35, maxAngle: 150});

/**
 * The arm and forearm angles for a point at `point`.
 *   actor   {x, floor, scale, geometry, seated} placed (canvas px)
 *   facing  left | right (the pointing arm is on that side)
 *   point   targetPoint() of the target, or null (straight out)
 *   other   the character pointed at, placed ({x, floor, scale, height, marks?}) | null
 *   safe    the safe zone {x, y, width, height} | null
 *   standing  a seated character who has stood up
 * → {side: 'L' | 'R', arm, fore, tip: {x, y} (canvas px)}
 */
export function pointAim({actor, facing, point = null, other = null, safe = null, standing = false}) {
  const g = actor.geometry;
  const s = actor.scale;
  const side = facing === 'left' ? -1 : 1;
  const drop = actor.seated && !standing ? g.sitDrop : 0;
  const shoulder = {x: actor.x + side * g.armX * s, y: actor.floor + (g.hipY + g.armY + drop) * s};
  const A = g.upperArm, B = g.foreArm + g.hand * 1.8;
  // Where it points: another character's chest, else the point, else straight out.
  let aimAt = null;
  if (other) aimAt = {x: other.x, y: other.floor - (other.marks?.chest ?? other.height * 0.6) * other.scale};
  else if (point && Number.isFinite(point.x)) aimAt = {x: point.x, y: Number.isFinite(point.y) ? point.y : shoulder.y};
  const h = aimAt ? Math.max(1, side * (aimAt.x - shoulder.x)) / s : 1;
  const v = aimAt ? (aimAt.y - shoulder.y) / s : -0.03;
  const phi = clamp(deg(Math.atan2(h, v)), AIM.minAngle, AIM.maxAngle);
  const sin = Math.sin((phi * Math.PI) / 180), cos = Math.cos((phi * Math.PI) / 180);
  let r = A + B;
  if (aimAt) r = Math.min(r, Math.hypot(h, v));
  if (other) r = Math.min(r, (AIM.gap * Math.abs(other.x - actor.x)) / s / Math.max(0.2, sin));
  if (safe) {
    const edge = side > 0 ? safe.x + safe.width - AIM.pad : safe.x + AIM.pad;
    if (sin > 0.05) r = Math.min(r, (side * (edge - shoulder.x)) / s / sin);
    if (cos < -0.05) r = Math.min(r, (shoulder.y - safe.y - AIM.pad) / s / -cos);
  }
  r = clamp(r, Math.abs(A - B) + 2, A + B);
  let arm = phi, fore = 0;
  if (r < A + B - 0.5) {
    // Two-bone reach: the elbow drops below the line to the fingertip.
    const gamma = deg(Math.acos(clamp((A * A + B * B - r * r) / (2 * A * B), -1, 1)));
    const eps = deg(Math.acos(clamp((A * A + r * r - B * B) / (2 * A * r), -1, 1)));
    arm = phi - eps;
    fore = 180 - gamma;
  }
  const tip = {x: shoulder.x + side * r * sin * s, y: shoulder.y + r * cos * s};
  return {side: facing === 'left' ? 'L' : 'R', arm: r1(arm), fore: r1(fore), tip: {x: r1(tip.x), y: r1(tip.y)}};
}
