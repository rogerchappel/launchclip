// EXPERIMENTAL (docs/rd/per-frame-rig.md): a per-frame character rig. Not
// wired into the storyboard schema; the cast-scene rig (acting.mjs) is
// unchanged.
//
// rigFrame(character, track, t) is a pure function of its inputs: the world
// position of every joint at time t. Nothing is kept between calls. The
// springs that give overlap are integrated from t = 0 at a fixed sub-step
// on every call, so any frame can be evaluated alone (seek-safe) and both
// renderers get the same numbers.
//
// What it adds over the op list:
// - a walk cycle (contact, down, passing, up) whose steps are planned from
//   the travel, so a planted foot stays fixed in the world; knees bend by
//   two-bone IK; heel-toe roll; the body bobs; arms counter-swing.
// - feet pinned through crouches and weight shifts: the knees bend, the legs
//   never shorten.
// - overlap: the upper arm, forearm and glove follow their targets through
//   springs of falling stiffness (shoulder leads, elbow and wrist trail);
//   the body's own channels are critically damped (no overshoot).
// - hand paths: a hand can follow timed points (breakdowns) on a smooth
//   curve by IK, so a big gesture travels in an arc; bones never stretch.
//
// Units are rig units (rig.mjs): the ground is y = 0, y grows downward, an
// adult is about 1000 tall. Angles: a limb's direction is (sin θ, cos θ), so
// θ = 0 hangs straight down and θ = 90° points to +x.
//
// Imports only sibling kit/core files.

import {poseJoints} from './rig.mjs';
import {hoseGeometry} from './style-rubber-hose.mjs';
import {stickGeometry} from './style-stick.mjs';

export const SUBSTEP = 1 / 240;
const RAD = Math.PI / 180;

// Spring per channel: frequency (rad/s) and damping ratio. Body channels are
// critically damped (ζ = 1: no overshoot); the arm chain gets softer toward
// the hand, so the forearm trails the upper arm and the glove trails both.
export const SPRINGS = Object.freeze({
  lean: {w: 16, z: 1}, crouch: {w: 18, z: 1}, shift: {w: 14, z: 1}, head: {w: 9, z: 0.8},
  upper: {w: 22, z: 0.72}, fore: {w: 15, z: 0.58}, glove: {w: 11, z: 0.5}
});

// Walk: share of a step spent with both feet down, foot lift, body bob and
// the arm swing (degrees), all at full pace.
export const WALK = Object.freeze({stepLength: 200, doubleSupport: 0.12, lift: 58, bob: 16, swing: 17, lean: 5, ramp: 0.2, heelPeel: 0.32, peel: 28, strike: 14});
// Knees stay a little bent when standing (rubbery, never locked): pelvis height as a share of the leg.
const STAND_HEIGHT = 0.975;
// Standing life: a breath (pelvis dip, units) and an arm sway (degrees) over one period (s).
export const IDLE = Object.freeze({breath: 5, sway: 3, period: 2.8});
const WALK_HEIGHT = 0.95;
const REACH = 0.9995;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = x => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const dir = th => [Math.sin(th * RAD), Math.cos(th * RAD)];
const add = (p, v, k = 1) => [p[0] + v[0] * k, p[1] + v[1] * k];
const angleOf = v => Math.atan2(v[0], v[1]) / RAD;
// A smooth max: never below max(a, b), within k/2 of it.
const smax = (a, b, k) => (a + b + Math.sqrt((a - b) * (a - b) + k * k)) / 2;

/** The character's lengths, from the style's geometry (so a cast looks the same). */
export function rigLengths(character) {
  const g = character.style === 'rubber-hose' ? hoseGeometry(character.params) : stickGeometry(character.params);
  return {g, thigh: g.thigh, shin: g.shin, foot: g.foot, leg: g.thigh + g.shin, upper: g.upperArm, fore: g.foreArm,
    torso: g.torso, armX: g.armX, armY: g.armY, legX: g.legX, neckY: g.neckY, hipY: g.hipY};
}

/**
 * Two-bone IK in a plane: from root `a` toward `target`, bones l1 then l2,
 * the middle joint bent toward side `bend` (+1: the second bone turns +θ).
 * The target is clamped to the reach, so bones never stretch.
 * → {mid, end, th1, th2, reached}
 */
export function twoBone(a, target, l1, l2, bend) {
  const dx = target[0] - a[0], dy = target[1] - a[1];
  const d0 = Math.hypot(dx, dy);
  const d = clamp(d0, Math.abs(l1 - l2) + 1e-6, (l1 + l2) * REACH);
  const th = d0 > 1e-9 ? angleOf([dx, dy]) : 0;
  const beta = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1)) / RAD;
  const flex = 180 - Math.acos(clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1)) / RAD;
  const th1 = th - bend * beta, th2 = th1 + bend * flex;
  const mid = add(a, dir(th1), l1);
  return {mid, end: add(mid, dir(th2), l2), th1, th2, reached: d0 <= (l1 + l2) * REACH};
}

// ---------------------------------------------------------------------------
// Keys: body channels and hand paths

/** A keyed channel at t: slow→fast→slow between keys, held outside them. */
function keyed(keys, name, t, rest = 0) {
  const ks = keys.filter(k => k[name] !== undefined);
  if (!ks.length) return rest;
  if (t <= ks[0].t) return ks[0][name];
  for (let i = 1; i < ks.length; i++) if (t <= ks[i].t) return lerp(ks[i - 1][name], ks[i][name], smooth((t - ks[i - 1].t) / (ks[i].t - ks[i - 1].t)));
  return ks.at(-1)[name];
}

/**
 * A point on a timed path [{t, at: [x, y]}] by centripetal-in-time
 * Catmull-Rom (Barry–Goldman with the key times as knots): the curve passes
 * through every key (the breakdowns), with no corner at any of them.
 */
export function pathAt(points, t) {
  const n = points.length;
  if (t <= points[0].t) return points[0].at;
  if (t >= points[n - 1].t) return points[n - 1].at;
  let i = 1;
  while (points[i].t < t) i++;
  const P = k => points[clamp(k, 0, n - 1)];
  const p0 = P(i - 2), p1 = P(i - 1), p2 = P(i), p3 = P(i + 1);
  const t0 = i - 2 < 0 ? p1.t - (p2.t - p1.t) : p0.t, t3 = i + 1 > n - 1 ? p2.t + (p2.t - p1.t) : p3.t;
  const t1 = p1.t, t2 = p2.t;
  const L = (a, b, ta, tb) => (tb - ta < 1e-9 ? a.at : [0, 1].map(k => (a.at[k] * (tb - t) + b.at[k] * (t - ta)) / (tb - ta)));
  const A1 = {at: L(p0, p1, t0, t1)}, A2 = {at: L(p1, p2, t1, t2)}, A3 = {at: L(p2, p3, t2, t3)};
  const B1 = {at: L(A1, A2, t0, t2)}, B2 = {at: L(A2, A3, t1, t3)};
  return L(B1, B2, t1, t2);
}

// ---------------------------------------------------------------------------
// The walk planner

/** Share of a walk's distance covered at u ∈ [0, 1]: a ramp in, a steady pace, a ramp out. */
function walkProgress(u, r = WALK.ramp) {
  const a = clamp(u, 0, 1);
  const ramp = x => x * x * x - x * x * x * x / 2; // ∫ smoothstep
  const total = 1 - r;
  if (a < r) return r * ramp(a / r) / total;
  if (a > 1 - r) return 1 - r * ramp((1 - a) / r) / total;
  return (r / 2 + (a - r)) / total;
}

/**
 * Plan the steps of each walk: N steps; feet land on an even spacing so the
 * travel is exactly covered and the last step brings the feet to the final
 * stance. Feet are 'l' and 'r'; positions are along the facing (u = f·x).
 * Landing k (1..N) moves the foot at q[k-1] to q[k+1]: q[0], q[1] are the
 * feet before the walk (back, front), q[N], q[N+1] the final stance, and the
 * landings between are evenly spaced.
 * → {f, plans: [{t0, t1, N, u0, u1, q, landings: [{foot, from, to}]}], initialFeet}
 */
export function planWalks(track) {
  const f = track.facing === 'left' ? -1 : 1;
  let u = f * track.x;
  const half0 = track.stance ?? 22;
  // Screen-left is behind when facing right, ahead when facing left.
  const initialFeet = {l: u - f * half0, r: u + f * half0};
  let feet = {...initialFeet};
  const plans = [];
  for (const w of track.walks ?? []) {
    const u1 = f * w.to, half = w.stance ?? half0;
    // The foot behind steps first.
    const back = feet.l <= feet.r ? 'l' : 'r', front = back === 'l' ? 'r' : 'l';
    const span = u1 - half - feet[front];
    const N = Math.max(2, Math.round(span / (w.stepLength ?? WALK.stepLength)) + 1);
    const q = [feet[back], feet[front]];
    for (let j = 2; j <= N; j++) q.push(feet[front] + (j - 1) * span / (N - 1));
    q.push(u1 + half);
    const landings = [];
    for (let k = 1; k <= N; k++) landings.push({foot: k % 2 ? back : front, from: q[k - 1], to: q[k + 1]});
    plans.push({t0: w.start, t1: w.end, N, u0: u, u1, landings, q});
    feet = {[landings[N - 1].foot]: q[N + 1], [landings[N - 2].foot]: q[N]};
    u = u1;
  }
  return {f, plans, initialFeet};
}

/** Feet and pelvis (along the facing) and the walk's intensity at t, from the plan. */
export function walkState(track, plan, t) {
  const f = plan.f;
  const feet = {...plan.initialFeet};
  let pelvis = f * track.x, intensity = 0, phase = 0, swing = null;
  const pitch = {l: 0, r: 0}, lift = {l: 0, r: 0};
  for (const p of plan.plans) {
    if (t < p.t0) break;
    const u = (t - p.t0) / (p.t1 - p.t0);
    const phi = p.N * walkProgress(u);
    // Pelvis waypoints at each contact: midway between the two planted feet.
    const R = k => (p.q[clamp(k, 0, p.N)] + p.q[clamp(k, 0, p.N) + 1]) / 2;
    const k0 = Math.floor(clamp(phi, 0, p.N - 1e-9));
    const s = phi - k0;
    // Catmull-Rom over the waypoints (uniform in φ), flattened at the walk's ends.
    const r0 = R(k0 - 1), r1 = R(k0), r2 = R(k0 + 1), r3 = R(k0 + 2);
    const s2 = s * s, s3 = s2 * s;
    pelvis = 0.5 * (2 * r1 + (-r0 + r2) * s + (2 * r0 - 5 * r1 + 4 * r2 - r3) * s2 + (-r0 + 3 * r1 - 3 * r2 + r3) * s3);
    if (u >= 1) pelvis = p.u1;
    // Every foot's place: landed steps done, the current step swinging.
    for (let k = 1; k <= p.N; k++) {
      const {foot, from, to} = p.landings[k - 1];
      if (phi >= k) { feet[foot] = to; continue; }
      if (phi < k - 1) continue; // still at the last landing (or where it started)
      const ds = WALK.doubleSupport;
      const sig = clamp((s - ds) / (1 - ds), 0, 1);
      // Heel peels (pivot on the toe) before the foot leaves the ground.
      // (Picking up from the half peel of the step before; the first step starts flat.)
      if (s < ds) { const base = k === 1 ? 0 : 0.5; feet[foot] = from; pitch[foot] = WALK.peel * (base + (1 - base) * smooth(s / ds)); continue; }
      feet[foot] = lerp(from, to, 0.5 - 0.5 * Math.cos(Math.PI * sig));
      lift[foot] = WALK.lift * Math.sin(Math.PI * Math.pow(sig, 0.75)) * Math.min(1, Math.abs(to - from) / 120);
      // Toe down leaving, toe up for the heel strike.
      pitch[foot] = WALK.peel * (1 - sig) * (1 - sig) - WALK.strike * smooth((sig - 0.55) / 0.45);
      swing = foot;
    }
    // The planted foot peels its heel late in the step it carries.
    for (let k = 1; k <= p.N; k++) {
      const {foot} = p.landings[k - 1];
      if (phi >= k - 1 - WALK.heelPeel && phi < k - 1 && foot !== swing) pitch[foot] = WALK.peel * 0.5 * smooth((phi - (k - 1 - WALK.heelPeel)) / WALK.heelPeel);
    }
    // Heel strike settles flat early in the next step.
    for (let k = 1; k <= p.N; k++) {
      const {foot} = p.landings[k - 1];
      if (phi >= k && phi < k + 0.18 && foot !== swing) pitch[foot] = -WALK.strike * (1 - smooth((phi - k) / 0.18));
    }
    const dphi = (p.N * (walkProgress(u + 1e-3) - walkProgress(u - 1e-3)) / 2e-3) / (p.t1 - p.t0);
    const pace = p.N / (p.t1 - p.t0) / (1 - WALK.ramp);
    intensity = u >= 1 ? 0 : clamp(dphi / pace, 0, 1);
    phase = s;
  }
  return {feet, pelvis, intensity, phase, pitch, lift, swing};
}

// ---------------------------------------------------------------------------
// Targets (before the springs) and the frame

/** The rest arms of the style's stand pose (rig.mjs poseJoints), as screen angles; the elbow flexes toward the facing. */
function restArms(character, facing) {
  const j = poseJoints('stand', {facing, geometry: rigLengths(character).g});
  return {l: {upper: -j.armL, flex: Math.abs(j.foreL)}, r: {upper: j.armR, flex: Math.abs(j.foreR)}};
}

/** Hand IK: a timed path for one hand (shoulder-relative, [along the facing, down]), blended in and out. */
function handTarget(track, side, t) {
  const path = track.hands?.[side];
  if (!path?.length) return null;
  const blend = track.handBlend ?? 0.25;
  const t0 = path[0].t, t1 = path.at(-1).t;
  if (t < t0 - blend || t > t1 + blend) return null;
  const w = t < t0 ? smooth((t - t0 + blend) / blend) : t <= t1 ? 1 : 1 - smooth((t - t1) / blend);
  // bend -1: the elbow flexes away from the facing (a cocked throwing arm, the hand up behind the head).
  // Switch it only where the arm is near straight, where both bends meet.
  const bend = path.filter(p => p.t <= t).at(-1)?.bend ?? path[0].bend ?? 1;
  return {at: pathAt(path, clamp(t, t0, t1)), w, bend};
}

/** Every channel's target at t. */
function goals(ctx, t) {
  const {track, plan, L, rest} = ctx;
  const f = plan.f, keys = track.keys ?? [];
  const walk = walkState(track, plan, t);
  const g = {
    lean: keyed(keys, 'lean', t) + WALK.lean * walk.intensity,
    // Standing, the body breathes (a slow dip); a pure function of t, so still seek-safe.
    crouch: keyed(keys, 'crouch', t) + IDLE.breath * (1 - walk.intensity) * (0.5 - 0.5 * Math.cos(2 * Math.PI * t / IDLE.period)),
    shift: keyed(keys, 'shift', t),
    head: keyed(keys, 'head', t),
    walk
  };
  for (const side of ['l', 'r']) {
    const other = side === 'l' ? 'r' : 'l';
    // Counter-swing: an arm goes forward as the opposite foot does.
    const off = clamp((walk.feet[other] - walk.pelvis) / (WALK.stepLength * 0.6), -1, 1) * walk.intensity;
    // Walking, the arms come in from the stance's spread (a front view's) toward the line of the body.
    const sway = IDLE.sway * (1 - walk.intensity) * Math.sin(2 * Math.PI * t / IDLE.period + (side === 'l' ? 0 : 2));
    const upper = rest[side].upper * (1 - 0.6 * walk.intensity) + f * WALK.swing * off + sway;
    const flex = rest[side].flex + 8 * walk.intensity + 14 * Math.max(0, off);
    g[`upper${side}`] = upper;
    g[`fore${side}`] = upper + f * flex;
    // A hand on a path: IK gives the arm's angles (the springs add the drag).
    const h = handTarget(track, side, t);
    if (h) {
      const ik = twoBone([0, 0], [f * h.at[0], h.at[1]], L.upper, L.fore, f * h.bend);
      const fore = upper + f * flex;
      g[`upper${side}`] = lerp(upper, upper + wrap(ik.th1 - upper), h.w);
      g[`fore${side}`] = lerp(fore, fore + wrap(ik.th2 - fore), h.w);
    }
    g[`glove${side}`] = g[`fore${side}`];
    g[`stiff${side}`] = h ? h.w : 0;
  }
  return g;
}

const CHANNELS = ['lean', 'crouch', 'shift', 'head', 'upperl', 'forel', 'glovel', 'upperr', 'forer', 'glover'];
const ARM = new Set(['upperl', 'forel', 'glovel', 'upperr', 'forer', 'glover']);
const springOf = name => SPRINGS[name] ?? SPRINGS[name.slice(0, -1)];
// A hand on a path follows it closely (the arc is the point): its springs stiffen by up to this share.
const PATH_STIFF = 2.2;
const wrap = a => a - 360 * Math.round(a / 360);

/**
 * The frame: every joint's world position at t.
 *   character: {params, style: 'rubber-hose' | 'stick'}
 *   track: {x, facing: 'left'|'right', stance?,
 *           walks: [{start, end, to, stance?, stepLength?}],
 *           keys: [{t, lean?, crouch?, shift?, head?}],
 *           hands?: {l|r: [{t, at: [along the facing, down]}]}  (shoulder-relative),
 *           ball?: {side, release, velocity: [along the facing, down], gravity}}
 * → {joints: {pelvis, chest, neck, hipL, kneeL, ankleL, …, shoulderL, elbowL, wristL, …},
 *    legs, arms, lean, bend, head, ball, walk}
 */
export function rigFrame(character, track, t, plan = planWalks(track)) {
  const ctx = {character, track, plan, L: rigLengths(character), rest: restArms(character, track.facing)};
  // Springs from t = 0 at the fixed sub-step: the same state whatever was evaluated before.
  const g0 = goals(ctx, 0);
  const x = Object.fromEntries(CHANNELS.map(n => [n, g0[n]]));
  const v = Object.fromEntries(CHANNELS.map(n => [n, 0]));
  const step = (time, h) => {
    const g = goals(ctx, time);
    for (const n of CHANNELS) {
      const {w: w0, z} = springOf(n);
      const w = ARM.has(n) ? w0 * (1 + PATH_STIFF * g[`stiff${n.at(-1)}`]) : w0;
      // An angle's goal is taken the near way round from where the joint is (no spin through 360°).
      const goal = ARM.has(n) ? x[n] + wrap(g[n] - x[n]) : g[n];
      v[n] += h * (w * w * (goal - x[n]) - 2 * z * w * v[n]);
      x[n] += h * v[n];
    }
  };
  const steps = Math.floor(t / SUBSTEP + 1e-9);
  for (let i = 1; i <= steps; i++) step(i * SUBSTEP, SUBSTEP);
  if (t - steps * SUBSTEP > 1e-9) step(t, t - steps * SUBSTEP);
  return assemble(ctx, x, goals(ctx, t), t);
}

/** Joints from the sprung channels and the walk. */
function assemble(ctx, s, now, t) {
  const {track, plan, L} = ctx;
  const f = plan.f, walk = now.walk;
  const ankleRest = -L.foot;
  // A foot: the ankle over its place, pitched about the toe (heel peel) or the heel (heel strike), then lifted.
  const foot = side => {
    const x0 = f * walk.feet[side], pitch = walk.pitch[side];
    const pivot = pitch >= 0 ? [x0 + f * 62, 0] : [x0 - f * 16, 0];
    const a = f * pitch * RAD, rx = x0 - pivot[0], ry = ankleRest - pivot[1];
    return {ankle: [pivot[0] + rx * Math.cos(a) - ry * Math.sin(a), pivot[1] + rx * Math.sin(a) + ry * Math.cos(a) - walk.lift[side]], pitch, planted: walk.lift[side] < 1e-6 && walk.swing !== side};
  };
  const feet = {l: foot('l'), r: foot('r')};
  const px = f * (walk.pelvis + s.shift);
  // Pelvis height: stance (or walk) height, the bob and the crouch, then lowered just enough that both feet are in reach.
  const reach = L.leg * REACH * 0.998;
  const bob = WALK.bob * walk.intensity * (0.5 - 0.5 * Math.cos(2 * Math.PI * (walk.phase - 0.2)));
  let py = ankleRest - L.leg * lerp(STAND_HEIGHT, WALK_HEIGHT, walk.intensity) + s.crouch - bob;
  for (const side of ['l', 'r']) {
    const dx = Math.abs(feet[side].ankle[0] - px);
    py = smax(py, feet[side].ankle[1] - Math.sqrt(Math.max(0, reach * reach - dx * dx)), 8);
  }
  const legs = {};
  for (const side of ['l', 'r']) {
    const hip = [px, py];
    // Knees bend toward the facing.
    const ik = twoBone(hip, feet[side].ankle, L.thigh, L.shin, -f);
    legs[side] = {hip, knee: ik.mid, ankle: ik.end, th1: ik.th1, th2: ik.th2, pitch: feet[side].pitch, planted: feet[side].planted, place: f * walk.feet[side], target: feet[side].ankle};
  }
  // Torso, shoulders and neck lean about the pelvis (+ toward the facing).
  const a = f * s.lean * RAD;
  const rot = (lx, ly) => [px + lx * Math.cos(a) - ly * Math.sin(a), py + lx * Math.sin(a) + ly * Math.cos(a)];
  const arms = {};
  for (const side of ['l', 'r']) {
    const shoulder = rot(side === 'l' ? -L.armX : L.armX, L.armY);
    // The elbow never hyperextends more than a little, nor folds flat.
    // (A hand on a path may bend the other way: a cocked arm.)
    const flex = clamp(wrap(f * (s[`fore${side}`] - s[`upper${side}`])), -8 - 142 * now[`stiff${side}`], 150);
    const th1 = s[`upper${side}`], th2 = th1 + f * flex;
    const elbow = add(shoulder, dir(th1), L.upper);
    arms[side] = {shoulder, elbow, wrist: add(elbow, dir(th2), L.fore), th1, th2, glove: s[`glove${side}`]};
  }
  const pelvis = [px, py], chest = rot(0, L.armY), neck = rot(0, L.neckY);
  const joints = {
    pelvis, chest, neck,
    hipL: legs.l.hip, kneeL: legs.l.knee, ankleL: legs.l.ankle, hipR: legs.r.hip, kneeR: legs.r.knee, ankleR: legs.r.ankle,
    shoulderL: arms.l.shoulder, elbowL: arms.l.elbow, wristL: arms.l.wrist, shoulderR: arms.r.shoulder, elbowR: arms.r.elbow, wristR: arms.r.wrist
  };
  // The spine bows with the lean still to come (the target ahead of the spring): a drag curve.
  const bend = clamp((now.lean - s.lean) * 3, -30, 30);
  let ball = null;
  if (track.ball) {
    const b = track.ball, palm = arm => add(arm.wrist, dir(arm.glove), 50);
    if (t <= b.release) ball = {at: palm(arms[b.side]), held: true};
    else {
      const p0 = palm(rigFrame(ctx.character, {...track, ball: null}, b.release, plan).arms[b.side]);
      const dt = t - b.release;
      ball = {at: [p0[0] + f * b.velocity[0] * dt, p0[1] + b.velocity[1] * dt + 0.5 * b.gravity * dt * dt], held: false};
    }
  }
  return {t, facing: track.facing, joints, legs, arms, lean: s.lean, bend, head: s.head, ball, walk: {intensity: walk.intensity, phase: walk.phase, swing: walk.swing}};
}
