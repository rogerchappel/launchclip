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

// ---------------------------------------------------------------------------
// Reaching a point with a hand (contact actions, characters/contact.mjs).
// The same two-bone reach in any direction, for either arm, on a body that
// may lean: the bones keep their lengths, so a point past the arm's length
// is not reached (`reached: false`); the caller moves the actor or the prop.

const rad = d => (d * Math.PI) / 180;

/** The reach of an arm to the centre of the hand (rig units). */
export const armReach = g => g.upperArm + g.foreArm + g.hand * 0.3;

/**
 * Canvas px of a placed actor's shoulder joint. side 'L' | 'R'; j: joint
 * values (lean, bodyY, shoulderY, squash; missing ones at rest); dx: the
 * actor's walk offset. The torso pivots at the hip (rig.mjs).
 */
export function shoulderAt(actor, side, j = {}, dx = 0) {
  const g = actor.geometry, s = actor.scale, lean = rad(j.lean ?? 0);
  const ox = (side === 'L' ? -1 : 1) * g.armX, oy = (g.armY + (j.shoulderY ?? 0)) * (j.squash ?? 1);
  return {x: actor.x + dx + (ox * Math.cos(lean) - oy * Math.sin(lean)) * s, y: actor.floor + (g.hipY + (j.bodyY ?? 0)) * s + (ox * Math.sin(lean) + oy * Math.cos(lean)) * s};
}

/** Canvas px of the hand's centre for arm and forearm angles (rig convention) from a shoulder. */
export function handAt(shoulder, side, arm, fore, g, s, lean = 0) {
  const k = side === 'L' ? -1 : 1, B = armReach(g) - g.upperArm;
  const a1 = rad(k * arm - lean), a2 = rad(k * (arm + fore) - lean);
  return {x: shoulder.x + (g.upperArm * Math.sin(a1) + B * Math.sin(a2)) * s, y: shoulder.y + (g.upperArm * Math.cos(a1) + B * Math.cos(a2)) * s};
}

/**
 * Arm and forearm angles that put `side`'s hand on `target` (canvas px).
 * The elbow bends to whichever side keeps it out from the body (below the
 * line on a tie, as pointAim's). → {arm, fore, reached}; an unreachable
 * target is reached for as far as the straight arm goes, never further.
 */
export function reachArm({shoulder, side, target, geometry: g, scale: s, lean = 0}) {
  const k = side === 'L' ? -1 : 1, A = g.upperArm, B = armReach(g) - A;
  const dx = (target.x - shoulder.x) / s, dy = (target.y - shoulder.y) / s;
  const dist = Math.hypot(dx, dy);
  const reached = dist <= A + B + 1;
  const phi = k * (deg(Math.atan2(dx, dy)) + lean);
  const r = clamp(dist, Math.abs(A - B) + 2, A + B);
  if (r >= A + B - 0.5) return {arm: r1(phi), fore: 0, reached};
  const gamma = deg(Math.acos(clamp((A * A + B * B - r * r) / (2 * A * B), -1, 1)));
  const eps = deg(Math.acos(clamp((A * A + r * r - B * B) / (2 * A * r), -1, 1)));
  const down = Math.sin(rad(phi - eps)), up = Math.sin(rad(phi + eps));
  return up > down + 1e-6 ? {arm: r1(phi + eps), fore: r1(gamma - 180), reached} : {arm: r1(phi - eps), fore: r1(180 - gamma), reached};
}
