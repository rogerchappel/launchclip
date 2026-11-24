// The per-frame character rig (docs/rd/per-frame-rig.md). Scenes use it
// through rig-scene.mjs; the cast-scene rig (acting.mjs) is unchanged.
//
// rigFrame(character, track, t) is a pure function of its inputs: the world
// position of every joint at time t. Nothing is kept between calls. The
// springs that give overlap are integrated at a fixed sub-step from t = 0,
// or from the nearest stored checkpoint (springCheckpoints), which gives the
// same floats bit for bit: any frame can be evaluated alone (seek-safe) and
// both renderers get the same numbers.
//
// What it does:
// - a walk cycle (contact, down, passing, up) whose steps are planned from
//   the travel, so a planted foot stays fixed in the world; knees bend by
//   two-bone IK; heel-toe roll; a bouncy bob with the head lagging it, a
//   shoulder roll and a nod; arms counter-swing.
// - turns: the figure faces left or right; a facing key (or a walk the
//   other way) turns it over TURN seconds, the head passing through front.
// - feet pinned through crouches and weight shifts: the knees bend, the legs
//   never shorten. A foot can follow a timed path (a kick, a stomp).
// - overlap: the upper arm, forearm and glove follow their targets through
//   springs of falling stiffness (shoulder leads, elbow and wrist trail);
//   the body's own channels are critically damped (no overshoot).
// - hand paths: a hand can follow timed points (breakdowns) on a smooth
//   curve by IK, so a big gesture travels in an arc; bones never stretch.
// - hands on props: a hand can lock to a prop's grip (grip keys), a one-hand
//   prop held is carried forward in its hand, a two-hand prop is carried in
//   front of the chest with both hands on its sides.
//
// Units are rig units (rig.mjs): the ground is y = 0, y grows downward, an
// adult is about 1000 tall. Angles: a limb's direction is (sin θ, cos θ), so
// θ = 0 hangs straight down and θ = 90° points to +x.
//
// Imports only sibling kit/core files.

import {poseJoints} from './rig.mjs';
import {HAND_PROPS} from './props.mjs';
import {hoseGeometry} from './style-rubber-hose.mjs';
import {stickGeometry} from './style-stick.mjs';

export const SUBSTEP = 1 / 240;
// Spring state is stored every this many sub-steps (0.5 s): a frame integrates at most this many.
export const CHECKPOINT_STEPS = 120;
// A turn (left ↔ right) takes this long; the head passes through front halfway.
export const TURN = 0.26;
const RAD = Math.PI / 180;

// Spring per channel: frequency (rad/s) and damping ratio. Body channels are
// critically damped (ζ = 1: no overshoot); the arm chain gets softer toward
// the hand, so the forearm trails the upper arm and the glove trails both.
// hbob is the head's vertical lag behind the body's bob; look turns the head
// between front (0) and three-quarter (1).
export const SPRINGS = Object.freeze({
  lean: {w: 16, z: 1}, crouch: {w: 18, z: 1}, shift: {w: 14, z: 1}, head: {w: 9, z: 0.8}, hbob: {w: 15, z: 0.45}, look: {w: 10, z: 1},
  upper: {w: 22, z: 0.72}, fore: {w: 15, z: 0.58}, glove: {w: 11, z: 0.5}
});

// Walk at full pace: step length, share of a step with both feet down, foot
// lift, body bob, arm swing (degrees), forward lean (degrees), the ramp in
// and out (share of the walk), heel peel and strike (degrees), the shoulder
// roll (units), the head's nod per step (degrees) and the body's squash on
// each contact (share; the drawing scales it per style).
export const WALK = Object.freeze({stepLength: 230, doubleSupport: 0.1, lift: 96, bob: 30, swing: 30, lean: 7, ramp: 0.2, heelPeel: 0.32, peel: 30, strike: 16, roll: 12, nod: 4, squash: 0.07});
// Knees stay a little bent when standing (rubbery, never locked): pelvis height as a share of the leg.
const STAND_HEIGHT = 0.975;
// Moving holds: a breath (pelvis dip, units), an arm sway (degrees), a slow
// weight shift (units) and a head drift (degrees), each on its own period (s).
export const IDLE = Object.freeze({breath: 6, sway: 3, period: 2.8, shift: 7, shiftPeriod: 4.3, drift: 1.6, driftPeriod: 5.3});
const WALK_HEIGHT = 0.93;
const REACH = 0.9995;
// A gag squash ramps in over this long before its time (no pop).
const SQUASH_ATTACK = 0.05;
// Carries blend in and out over this long.
export const CARRY_BLEND = 0.25;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = x => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const dir = th => [Math.sin(th * RAD), Math.cos(th * RAD)];
const add = (p, v, k = 1) => [p[0] + v[0] * k, p[1] + v[1] * k];
const angleOf = v => Math.atan2(v[0], v[1]) / RAD;
const wrap = a => a - 360 * Math.round(a / 360);
// A smooth max: never below max(a, b), within k/2 of it.
const smax = (a, b, k) => (a + b + Math.sqrt((a - b) * (a - b) + k * k)) / 2;
const sideSign = facing => (facing === 'left' ? -1 : 1);

/** The character's lengths, from the style's geometry (so a cast looks the same). palm: wrist → the hand's centre. */
export function rigLengths(character) {
  const hose = character.style === 'rubber-hose';
  const g = hose ? hoseGeometry(character.params) : stickGeometry(character.params);
  return {g, thigh: g.thigh, shin: g.shin, foot: g.foot, leg: g.thigh + g.shin, upper: g.upperArm, fore: g.foreArm,
    torso: g.torso, armX: g.armX, armY: g.armY, legX: g.legX, neckY: g.neckY, hipY: g.hipY, palm: hose ? 50 : g.hand * 0.2};
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
// Keys: body channels, squash and paths

/** A keyed channel at t: slow→fast→slow between keys, held outside them. ks: the keys that set it. */
function keyed(ks, name, t, rest = 0) {
  if (!ks.length) return rest;
  if (t <= ks[0].t) return ks[0][name];
  for (let i = 1; i < ks.length; i++) if (t <= ks[i].t) return lerp(ks[i - 1][name], ks[i][name], smooth((t - ks[i - 1].t) / (ks[i].t - ks[i - 1].t)));
  return ks.at(-1)[name];
}

/**
 * A squash track [{t, amount, hold, recover}] at t: the amount (−0.6..0.8;
 * + flattens, − stretches) arrives over a short attack just before t, holds
 * `hold` s, then eases back to 0 over `recover` s. The latest one started wins.
 */
export function squashAt(list, t) {
  let out = 0;
  for (const k of list ?? []) {
    const t0 = k.t - SQUASH_ATTACK;
    if (t < t0) break;
    const hold = k.hold ?? 0, recover = Math.max(1e-3, k.recover ?? 0.2);
    out = t < k.t ? k.amount * smooth((t - t0) / SQUASH_ATTACK) : k.amount * (1 - smooth((t - k.t - hold) / recover));
  }
  return out;
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

/** A limb path (hands or feet: [{t, at?, bend?, grip?}]) at t: the point, its weight (blended in and out) and the bend; null outside it. */
function limbPath(keys, t, blend) {
  const path = (keys ?? []).filter(k => k.at);
  if (!path.length) return null;
  const t0 = path[0].t, t1 = path.at(-1).t;
  if (t < t0 - blend || t > t1 + blend) return null;
  const w = t < t0 ? smooth((t - t0 + blend) / blend) : t <= t1 ? 1 : 1 - smooth((t - t1) / blend);
  // bend -1: the elbow flexes away from the facing (a cocked throwing arm).
  // Switch it only where the limb is near straight, where both bends meet.
  const bend = path.filter(p => p.t <= t).at(-1)?.bend ?? path[0].bend ?? 1;
  return {at: pathAt(path, clamp(t, t0, t1)), w, bend};
}

/** Runs of consecutive grip keys in a hand's keys → [{prop, t0, t1}]. */
export function gripWindows(keys) {
  const out = [];
  for (const k of keys ?? []) {
    const last = out.at(-1);
    if (k.grip && last && last.open && last.prop === k.grip) last.t1 = k.t;
    else if (k.grip) out.push({prop: k.grip, t0: k.t, t1: k.t, open: true});
    else if (last) last.open = false;
  }
  return out.map(({prop, t0, t1}) => ({prop, t0, t1}));
}

/** A window's weight at t: 1 inside, eased to 0 over `blend` either side (none before a window that starts at or before 0). */
function windowWeight(t0, t1, t, blend) {
  if (t >= t0 && t <= t1) return 1;
  if (t < t0) return t0 <= 0 ? 1 : smooth((t - t0 + blend) / blend);
  return 1 - smooth((t - t1) / blend);
}

// ---------------------------------------------------------------------------
// Facing and the walk planner

/** Facing at t from the plan's facing keys: f (−1 | 1, flips halfway through a turn), fc (eased through 0 in a turn), turning (0..1..0). */
export function facingAt(plan, t) {
  let f = plan.f0;
  for (const k of plan.facings) {
    if (k.t > t) break;
    if (k.f === f) continue;
    const u = (t - k.t) / TURN;
    if (u >= 1) { f = k.f; continue; }
    const s = smooth(u);
    return {f: s < 0.5 ? f : k.f, fc: lerp(f, k.f, s), turning: Math.sin(Math.PI * u)};
  }
  return {f, fc: f, turning: 0};
}

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
 * Plan the walks and turns (JSON-serialisable). Each walk: N steps; feet
 * land on an even spacing so the travel is exactly covered and the last step
 * brings the feet to the final stance. Feet are 'l' and 'r' (screen left and
 * right at the start); positions are world x. Landing k (1..N) moves the
 * foot at q[k-1] to q[k+1]: q[0], q[1] are the feet before the walk (back,
 * front), q[N], q[N+1] the final stance, the landings between evenly spaced.
 * A walk faces its travel: it adds a facing key a little before it starts.
 * → {f0, facings: [{t, f}], plans: [{t0, t1, d, N, x1, q, landings: [{foot, from, to}]}], initialFeet}
 */
export function planWalks(track) {
  let x = track.x;
  const half0 = track.stance ?? 22;
  const initialFeet = {l: x - half0, r: x + half0};
  let feet = {...initialFeet};
  const plans = [], facings = (track.facings ?? []).map(k => ({t: k.t, f: sideSign(k.facing)}));
  for (const w of track.walks ?? []) {
    const d = Math.sign(w.to - x);
    if (!d) continue;
    facings.push({t: w.start - TURN * 0.6, f: d});
    const half = w.stance ?? half0, u = v => d * v;
    // The foot behind (along the travel) steps first.
    const back = u(feet.l) <= u(feet.r) ? 'l' : 'r', front = back === 'l' ? 'r' : 'l';
    const span = u(w.to) - half - u(feet[front]);
    const N = Math.max(2, Math.round(span / (w.stepLength ?? WALK.stepLength)) + 1);
    const q = [feet[back], feet[front]];
    for (let j = 2; j <= N; j++) q.push(d * (u(feet[front]) + (j - 1) * span / (N - 1)));
    q.push(d * (u(w.to) + half));
    const landings = [];
    for (let k = 1; k <= N; k++) landings.push({foot: k % 2 ? back : front, from: q[k - 1], to: q[k + 1]});
    plans.push({t0: w.start, t1: w.end, d, N, x1: w.to, landings, q});
    feet = {[landings[N - 1].foot]: q[N + 1], [landings[N - 2].foot]: q[N]};
    x = w.to;
  }
  facings.sort((a, b) => a.t - b.t);
  return {f0: sideSign(track.facing), facings, plans, initialFeet};
}

/** Feet and pelvis (world x), the walk's intensity, the step phase and each foot's pitch and lift at t, from the plan. */
export function walkState(track, plan, t) {
  const feet = {...plan.initialFeet};
  let pelvis = track.x, intensity = 0, phase = 0, swing = null, stride = 0;
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
    if (u >= 1) pelvis = p.x1;
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
      // A high, quick knee: the lift peaks early in the swing.
      lift[foot] = WALK.lift * Math.sin(Math.PI * Math.pow(sig, 0.7)) * Math.min(1, Math.abs(to - from) / 140);
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
    stride = phi;
  }
  return {feet, pelvis, intensity, phase, stride, pitch, lift, swing};
}

// ---------------------------------------------------------------------------
// Targets (before the springs) and the frame

/** The rest arms of the style's stand pose (rig.mjs poseJoints), as screen angles; the elbow flexes toward the facing. */
function restArms(character, facing) {
  const j = poseJoints('stand', {facing, geometry: rigLengths(character).g});
  return {l: {upper: -j.armL, flex: Math.abs(j.foreL)}, r: {upper: j.armR, flex: Math.abs(j.foreR)}};
}

/** A carry's weight for one side at t: [{prop, side, start, end}] → {w, prop} (the strongest). */
function carryAt(carries, side, t) {
  let best = {w: 0, prop: null};
  for (const c of carries ?? []) {
    if (c.side !== side && HAND_PROPS[c.prop]?.hands !== 2) continue;
    const w = windowWeight(c.start, c.end ?? Infinity, t, CARRY_BLEND);
    if (w > best.w) best = {w, prop: c.prop};
  }
  return best;
}

/** Everything a frame needs that doesn't change with t. */
function context(character, track, plan) {
  const keys = track.keys ?? [];
  const chan = Object.fromEntries(['lean', 'crouch', 'shift', 'head', 'look'].map(n => [n, keys.filter(k => k[n] !== undefined)]));
  return {character, track, plan, chan, L: rigLengths(character), rest: {[-1]: restArms(character, 'left'), 1: restArms(character, 'right')}};
}

/** Every channel's target at t. */
function goals(ctx, t) {
  const {track, plan, L, chan} = ctx;
  const {f} = facingAt(plan, t);
  const rest = ctx.rest[f];
  const walk = walkState(track, plan, t);
  const still = 1 - walk.intensity;
  const bob = WALK.bob * walk.intensity * (0.5 - 0.5 * Math.cos(2 * Math.PI * (walk.phase - 0.2)));
  const g = {
    lean: keyed(chan.lean, 'lean', t) + WALK.lean * walk.intensity,
    // Moving holds: a breath and a slow weight shift; pure functions of t, so still seek-safe.
    crouch: keyed(chan.crouch, 'crouch', t) + IDLE.breath * still * (0.5 - 0.5 * Math.cos(2 * Math.PI * t / IDLE.period)),
    shift: keyed(chan.shift, 'shift', t) + IDLE.shift * still * Math.sin(2 * Math.PI * t / IDLE.shiftPeriod),
    // The head nods into each step (the spring makes it lag) and drifts a little standing.
    head: keyed(chan.head, 'head', t) + WALK.nod * walk.intensity * Math.cos(2 * Math.PI * walk.phase) + IDLE.drift * still * Math.sin(2 * Math.PI * t / IDLE.driftPeriod),
    hbob: bob,
    walk, bob, f
  };
  let acting = 0;
  for (const side of ['l', 'r']) {
    const other = side === 'l' ? 'r' : 'l';
    // Counter-swing: an arm goes forward as the opposite foot does.
    const off = clamp(f * (walk.feet[other] - walk.pelvis) / (WALK.stepLength * 0.6), -1, 1) * walk.intensity;
    const sway = IDLE.sway * still * Math.sin(2 * Math.PI * t / IDLE.period + (side === 'l' ? 0 : 2));
    const carry = carryAt(track.carries, side, t);
    // Walking, the arms come in from the stance's spread toward the line of the body; a carrying arm barely swings.
    const upper0 = rest[side].upper * (1 - 0.6 * walk.intensity) + f * WALK.swing * off * (1 - 0.8 * carry.w) + sway;
    const flex0 = rest[side].flex + 16 * walk.intensity + 24 * Math.max(0, off);
    let upper = upper0, fore = upper0 + f * flex0, stiff = 0;
    const toward = (at, w, bend) => {
      const ik = twoBone([0, 0], [f * at[0], at[1]], L.upper, L.fore, f * bend);
      upper = lerp(upper, upper + wrap(ik.th1 - upper), w);
      fore = lerp(fore, fore + wrap(ik.th2 - fore), w);
    };
    // A one-hand prop is carried forward, the forearm out (two-hand carries lock after the springs).
    if (carry.w > 0 && HAND_PROPS[carry.prop]?.hands === 1) { toward([0.42 * (L.upper + L.fore), 0.62 * (L.upper + L.fore)], carry.w, 1); stiff = 0.5 * carry.w; }
    // A hand on a path: IK gives the arm's angles (the springs add the drag).
    const h = limbPath(track.hands?.[side], t, track.handBlend ?? 0.25);
    if (h) { toward(h.at, h.w, h.bend); stiff = Math.max(stiff, h.w); acting = Math.max(acting, h.w); }
    g[`upper${side}`] = upper;
    g[`fore${side}`] = fore;
    g[`glove${side}`] = fore;
    g[`stiff${side}`] = stiff;
  }
  // The head turns three-quarter toward the facing while walking or acting, front when still.
  g.look = chan.look.length ? keyed(chan.look, 'look', t) : Math.max(walk.intensity, 0.8 * acting);
  return g;
}

const CHANNELS = ['lean', 'crouch', 'shift', 'head', 'hbob', 'look', 'upperl', 'forel', 'glovel', 'upperr', 'forer', 'glover'];
const ARM = new Set(['upperl', 'forel', 'glovel', 'upperr', 'forer', 'glover']);
const SPRING = CHANNELS.map(n => SPRINGS[n] ?? SPRINGS[n.slice(0, -1)]);
// A hand on a path follows it closely (the arc is the point): its springs stiffen by up to this share.
const PATH_STIFF = 2.2;

/** One fixed sub-step of every spring toward the goals at `time`. x, v: arrays in CHANNELS order (updated in place). */
function step(ctx, x, v, time, h) {
  const g = goals(ctx, time);
  for (let i = 0; i < CHANNELS.length; i++) {
    const n = CHANNELS[i], {w: w0, z} = SPRING[i];
    const arm = ARM.has(n);
    const w = arm ? w0 * (1 + PATH_STIFF * g[`stiff${n.at(-1)}`]) : w0;
    // An angle's goal is taken the near way round from where the joint is (no spin through 360°).
    const goal = arm ? x[i] + wrap(g[n] - x[i]) : g[n];
    v[i] += h * (w * w * (goal - x[i]) - 2 * z * w * v[i]);
    x[i] += h * v[i];
  }
}

/** The springs at rest on the goals at t = 0. */
function initial(ctx) {
  const g0 = goals(ctx, 0);
  return {x: CHANNELS.map(n => g0[n]), v: CHANNELS.map(() => 0)};
}

/**
 * Spring state every CHECKPOINT_STEPS sub-steps up to `until` seconds
 * (JSON-serialisable): {every, x: [[…]], v: [[…]]}, entry k after k·every
 * sub-steps. rigFrame resumes from the nearest one; the floats are the same
 * as integrating from 0.
 */
export function springCheckpoints(character, track, until, plan = planWalks(track)) {
  const ctx = context(character, track, plan);
  const {x, v} = initial(ctx);
  const out = {every: CHECKPOINT_STEPS, x: [[...x]], v: [[...v]]};
  const steps = Math.floor(until / SUBSTEP + 1e-9);
  for (let i = 1; i <= steps; i++) {
    step(ctx, x, v, i * SUBSTEP, SUBSTEP);
    if (i % CHECKPOINT_STEPS === 0) { out.x.push([...x]); out.v.push([...v]); }
  }
  return out;
}

/**
 * The frame: every joint's world position at t.
 *   character: {params, style: 'rubber-hose' | 'stick' | 'stick-classic'}
 *   track: {x, facing: 'left'|'right', stance?,
 *           facings?: [{t, facing}]                   turns (a walk also faces its travel),
 *           walks?: [{start, end, to, stance?, stepLength?}],
 *           keys?: [{t, lean?, crouch?, shift?, head?, look?}],
 *           hands?: {l|r: [{t, at?: [along the facing, down], bend?, grip?: propId}]}  (shoulder-relative),
 *           feet?: {l|r: [{t, at: [along the facing, down], bend?}]}                    (hip-relative),
 *           squash?: [{t, amount, hold, recover}],
 *           carries?: [{prop, side, start, end?}]     (filled by rig-scene.mjs from the props)}
 *   options: {plan?: planWalks(track), checkpoints?: springCheckpoints(…),
 *             grip?: (propKind, propId, side, t) → world point of that hand's grip | null,
 *             carried?: {l|r: world point of a two-hand prop's centre} (set by the frame itself)}
 * → {t, facing, fc, joints, legs, arms, lean, bend, head, look, hbob, squash, stepSquash, carry, walk}
 */
export function rigFrame(character, track, t, options = {}) {
  // (A plan alone is accepted as the options, as before.)
  const opts = options.plans ? {plan: options} : options;
  const plan = opts.plan ?? planWalks(track);
  const ctx = context(character, track, plan);
  const total = Math.floor(t / SUBSTEP + 1e-9);
  let from = 0, x, v;
  const cp = opts.checkpoints;
  if (cp) {
    const k = Math.min(Math.floor(total / cp.every), cp.x.length - 1);
    from = k * cp.every; x = [...cp.x[k]]; v = [...cp.v[k]];
  } else ({x, v} = initial(ctx));
  for (let i = from + 1; i <= total; i++) step(ctx, x, v, i * SUBSTEP, SUBSTEP);
  if (t - total * SUBSTEP > 1e-9) step(ctx, x, v, t, t - total * SUBSTEP);
  const s = Object.fromEntries(CHANNELS.map((n, i) => [n, x[i]]));
  return assemble(ctx, s, goals(ctx, t), t, opts);
}

/** Joints from the sprung channels, the walk and the locks. */
function assemble(ctx, s, now, t, opts) {
  const {track, plan, L} = ctx;
  const {f, fc, turning} = facingAt(plan, t);
  const walk = now.walk;
  const ankleRest = -L.foot;
  // A foot: the ankle over its place, pitched about the toe (heel peel) or the heel (heel strike), then lifted.
  const foot = side => {
    const x0 = walk.feet[side], pitch = walk.pitch[side];
    const pivot = pitch >= 0 ? [x0 + f * 62, 0] : [x0 - f * 16, 0];
    const a = f * pitch * RAD, rx = x0 - pivot[0], ry = ankleRest - pivot[1];
    return {ankle: [pivot[0] + rx * Math.cos(a) - ry * Math.sin(a), pivot[1] + rx * Math.sin(a) + ry * Math.cos(a) - walk.lift[side]], pitch, planted: walk.lift[side] < 1e-6 && walk.swing !== side};
  };
  const feet = {l: foot('l'), r: foot('r')};
  const kick = {l: limbPath(track.feet?.l, t, track.footBlend ?? 0.2), r: limbPath(track.feet?.r, t, track.footBlend ?? 0.2)};
  const px = walk.pelvis + fc * s.shift;
  // Pelvis height: stance (or walk) height, the bob and the crouch, then lowered just enough that the feet on the ground are in reach.
  const reach = L.leg * REACH * 0.998;
  let py = ankleRest - L.leg * lerp(STAND_HEIGHT, WALK_HEIGHT, walk.intensity) + s.crouch - now.bob;
  for (const side of ['l', 'r']) {
    const dx = Math.abs(feet[side].ankle[0] - px);
    const held = smax(py, feet[side].ankle[1] - Math.sqrt(Math.max(0, reach * reach - dx * dx)), 8);
    py = lerp(held, py, kick[side]?.w ?? 0);
  }
  const legs = {};
  for (const side of ['l', 'r']) {
    const hip = [px, py], k = kick[side];
    const target = k ? [lerp(feet[side].ankle[0], px + f * k.at[0], k.w), lerp(feet[side].ankle[1], py + k.at[1], k.w)] : feet[side].ankle;
    // Knees bend toward the facing (a foot path may bend them the other way).
    const ik = twoBone(hip, target, L.thigh, L.shin, -f * (k && k.w > 0.5 ? k.bend : 1));
    legs[side] = {hip, knee: ik.mid, ankle: ik.end, th1: ik.th1, th2: ik.th2, pitch: k ? feet[side].pitch * (1 - k.w) : feet[side].pitch,
      planted: feet[side].planted && !(k?.w > 0), place: walk.feet[side], target};
  }
  // Torso, shoulders and neck lean about the pelvis (+ toward the facing); the shoulders roll with the stride.
  const a = fc * s.lean * RAD;
  const rot = (lx, ly) => [px + lx * Math.cos(a) - ly * Math.sin(a), py + lx * Math.sin(a) + ly * Math.cos(a)];
  const roll = WALK.roll * walk.intensity * Math.cos(Math.PI * walk.stride);
  const chest = rot(0, L.armY), neck = rot(0, L.neckY);
  const arms = {};
  for (const side of ['l', 'r']) {
    const k = side === 'l' ? 1 : -1;
    const shoulder = rot((side === 'l' ? -L.armX : L.armX) + f * 0.5 * k * roll, L.armY + k * roll);
    // The elbow never hyperextends more than a little, nor folds flat.
    // (A hand on a path, or one mid-turn, may bend the other way.)
    const flex = clamp(wrap(f * (s[`fore${side}`] - s[`upper${side}`])), -8 - 142 * Math.max(now[`stiff${side}`], turning), 150);
    const th1 = s[`upper${side}`], th2 = th1 + f * flex;
    arms[side] = {shoulder, th1, th2, glove: s[`glove${side}`]};
  }
  // Locks after the springs: a hand on a prop's grip; both hands on a two-hand prop carried before the chest.
  let carry = null;
  for (const side of ['l', 'r']) {
    const A = arms[side];
    // palm: the glove lines up with the forearm and the palm lands on the point (a grip); else the wrist sits a little above it (a carry's side).
    const lockTo = (point, w, palm = false) => {
      if (!(w > 0) || !point) return;
      const ik = palm ? twoBone(A.shoulder, point, L.upper, L.fore + L.palm, f) : twoBone(A.shoulder, [point[0], point[1] - L.palm * 0.6], L.upper, L.fore, f);
      A.th1 = lerp(A.th1, A.th1 + wrap(ik.th1 - A.th1), w);
      A.th2 = lerp(A.th2, A.th2 + wrap(ik.th2 - A.th2), w);
      A.glove = lerp(A.glove, A.glove + wrap(A.th2 - A.glove), w);
    };
    for (const win of gripWindows(track.hands?.[side])) {
      const w = windowWeight(win.t0, win.t1, t, track.handBlend ?? 0.25);
      if (w > 0 && opts.grip) lockTo(opts.grip(win.prop, side, clamp(t, win.t0, win.t1)), w, true);
    }
    const c = carryAt(track.carries, side, t);
    const p = HAND_PROPS[c.prop];
    if (p?.hands === 2 && c.w > 0) {
      const centre = [chest[0] + f * (p.w * 0.5 + 40), chest[1] + L.upper * 0.95];
      carry = {prop: c.prop, at: centre, w: c.w};
      lockTo([centre[0] + (side === 'l' ? -1 : 1) * p.w / 2, centre[1]], c.w);
    }
  }
  for (const side of ['l', 'r']) {
    const A = arms[side];
    A.elbow = add(A.shoulder, dir(A.th1), L.upper);
    A.wrist = add(A.elbow, dir(A.th2), L.fore);
    A.palm = add(A.wrist, dir(A.glove), L.palm);
  }
  const pelvis = [px, py];
  const joints = {
    pelvis, chest, neck,
    hipL: legs.l.hip, kneeL: legs.l.knee, ankleL: legs.l.ankle, hipR: legs.r.hip, kneeR: legs.r.knee, ankleR: legs.r.ankle,
    shoulderL: arms.l.shoulder, elbowL: arms.l.elbow, wristL: arms.l.wrist, shoulderR: arms.r.shoulder, elbowR: arms.r.elbow, wristR: arms.r.wrist
  };
  // The spine bows with the lean still to come (the target ahead of the spring): a drag curve.
  const bend = clamp((now.lean - s.lean) * 3, -30, 30);
  // The body squashes on each contact and stretches a little through the passing position.
  const stepSquash = WALK.squash * walk.intensity * (walk.phase < 0.3 ? Math.sin(Math.PI * walk.phase / 0.3) : -0.45 * Math.sin(Math.PI * (walk.phase - 0.3) / 0.7));
  return {t, facing: f < 0 ? 'left' : 'right', fc, turning, joints, legs, arms, lean: s.lean, bend, head: s.head, look: clamp(s.look, 0, 1),
    hbob: now.bob - s.hbob, squash: squashAt(track.squash, t), stepSquash, carry,
    walk: {intensity: walk.intensity, phase: walk.phase, swing: walk.swing}};
}
