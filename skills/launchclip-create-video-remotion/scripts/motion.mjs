/**
 * Frame-pure motion primitives shared by the HyperFrames and Remotion paths.
 *
 * The frame-pure rule: every function here takes absolute time (or a frame
 * index) plus its configuration and returns a value. Nothing keeps state
 * between calls, nothing reads a clock, and nothing caches per-instance
 * progress. A renderer can therefore seek to any frame, in any order
 * (including backwards, or several frames in parallel), and get exactly the
 * same pixels. Nothing can go stale.
 *
 * Eases replicate GSAP 3's implementations (gsap-core.js), so a GSAP
 * `ease: "power3.out"` maps one-to-one and matches `gsap.parseEase()` to well
 * within 1e-6. `springValue` replicates Remotion's `spring()` stepping.
 *
 * Plain ESM with no imports: this file is bundled into Remotion and copied
 * into skills by scripts/sync-skills.mjs. kit/core/ is the canonical copy.
 */

const TINY = 1e-8;
const TWO_PI = Math.PI * 2;
const HALF_PI = TWO_PI / 4;

export const clamp01 = value => (value < 0 ? 0 : value > 1 ? 1 : value);

export const seconds = (frame, fps = 30) => frame / fps;
export const frames = (time, fps = 30) => time * fps;

// ---------------------------------------------------------------------------
// Eases (GSAP 3 semantics)

const inOutFromIn = easeIn => p => (p < .5 ? easeIn(p * 2) / 2 : 1 - easeIn((1 - p) * 2) / 2);
const inOutFromOut = easeOut => p => (p < .5 ? (1 - easeOut(1 - p * 2)) / 2 : .5 + easeOut((p - .5) * 2) / 2);

function family(easeIn, easeOut = p => 1 - easeIn(1 - p), easeInOut = inOutFromIn(easeIn)) {
  return {in: easeIn, out: easeOut, inOut: easeInOut};
}

function powerFamily(power) {
  if (power === 1) return family(p => p, p => 1 - Math.pow(1 - p, 1), p => (p < .5 ? Math.pow(p * 2, 1) / 2 : 1 - Math.pow((1 - p) * 2, 1) / 2));
  return family(p => Math.pow(p, power), p => 1 - Math.pow(1 - p, power),
    p => (p < .5 ? Math.pow(p * 2, power) / 2 : 1 - Math.pow((1 - p) * 2, power) / 2));
}

function configBack(type, overshoot = 1.70158) {
  const easeOut = p => (p ? --p * p * ((overshoot + 1) * p + overshoot) + 1 : 0);
  return type === 'out' ? easeOut : type === 'in' ? p => 1 - easeOut(1 - p) : inOutFromOut(easeOut);
}

function configElastic(type, amplitude, period) {
  const p1 = amplitude >= 1 ? amplitude : 1;
  let p2 = (period || (type ? .3 : .45)) / (amplitude < 1 ? amplitude : 1);
  const p3 = p2 / TWO_PI * (Math.asin(1 / p1) || 0);
  p2 = TWO_PI / p2;
  const easeOut = p => (p === 1 ? 1 : p1 * Math.pow(2, -10 * p) * Math.sin((p - p3) * p2) + 1);
  return type === 'out' ? easeOut : type === 'in' ? p => 1 - easeOut(1 - p) : inOutFromOut(easeOut);
}

const bounceOut = (() => {
  const n = 7.5625, c = 2.75, n1 = 1 / c, n2 = 2 * n1, n3 = 2.5 * n1;
  return p => (p < n1 ? n * p * p : p < n2 ? n * Math.pow(p - 1.5 / c, 2) + .75
    : p < n3 ? n * (p -= 2.25 / c) * p + .9375 : n * Math.pow(p - 2.625 / c, 2) + .984375);
})();

function steps(count = 1, immediateStart = false) {
  const p1 = 1 / count, p2 = count + (immediateStart ? 0 : 1), p3 = immediateStart ? 1 : 0, max = 1 - TINY;
  return p => (((p2 * Math.min(max, Math.max(0, p))) | 0) + p3) * p1;
}

const FAMILIES = {
  linear: powerFamily(1), power0: powerFamily(1),
  power1: powerFamily(2), quad: powerFamily(2),
  power2: powerFamily(3), cubic: powerFamily(3),
  power3: powerFamily(4), quart: powerFamily(4),
  power4: powerFamily(5), quint: powerFamily(5), strong: powerFamily(5),
  expo: family(p => Math.pow(2, 10 * (p - 1)) * p + p * p * p * p * p * p * (1 - p)),
  circ: family(p => -(Math.sqrt(1 - p * p) - 1)),
  sine: family(p => (p === 1 ? 1 : -Math.cos(p * HALF_PI) + 1)),
  bounce: family(p => 1 - bounceOut(1 - p), bounceOut),
  back: {in: configBack('in'), out: configBack('out'), inOut: configBack()},
  elastic: {in: configElastic('in'), out: configElastic('out'), inOut: configElastic()}
};
const CONFIGURABLE = {
  back: (type, overshoot) => configBack(type, overshoot),
  elastic: (type, amplitude, period) => configElastic(type, amplitude, period)
};

/**
 * Every named ease, keyed by GSAP name: "power3.out", "power3" (= .out), "none", …
 * @type {Record<string, (progress: number) => number>}
 */
export const ease = {none: FAMILIES.linear.in};
for (const [name, variants] of Object.entries(FAMILIES)) {
  ease[name] = variants.out;
  ease[`${name}.in`] = variants.in;
  ease[`${name}.out`] = variants.out;
  ease[`${name}.inOut`] = variants.inOut;
}
Object.freeze(ease);

export const DEFAULT_EASE = 'power1.out';

/**
 * Resolve a GSAP-style ease name to a function of progress p ∈ [0, 1].
 * Accepts "power3.out", "power2" (= .out), "back.out(1.4)", "elastic.out(1,0.3)",
 * "steps(6)", "none"/"linear", or a function (returned as is). Throws on
 * unknown names rather than silently falling back like GSAP does.
 */
export function getEase(name = DEFAULT_EASE) {
  if (typeof name === 'function') return name;
  if (name === null || name === undefined) return ease[DEFAULT_EASE];
  if (typeof name !== 'string') throw new Error(`ease must be a string or function, got ${typeof name}`);
  const key = name.trim();
  if (Object.hasOwn(ease, key)) return ease[key];
  const match = /^([a-zA-Z0-9]+)(?:\.(in|out|inOut))?\s*\(([^)]*)\)$/.exec(key);
  if (match) {
    const [, base, type, rawArgs] = match;
    const args = rawArgs.split(',').map(arg => arg.trim()).filter(Boolean)
      .map(arg => (arg === 'true' ? true : arg === 'false' ? false : Number(arg)));
    if (args.some(arg => typeof arg === 'number' && !Number.isFinite(arg))) throw new Error(`invalid ease arguments: ${name}`);
    if (base === 'steps' && !type) return steps(...args);
    if (CONFIGURABLE[base]) return CONFIGURABLE[base](type ?? 'out', ...args);
    const plain = ease[type ? `${base}.${type}` : base];
    if (plain) return plain;
  }
  throw new Error(`unknown ease: ${name}`);
}

// ---------------------------------------------------------------------------
// Interpolation

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const isColor = value => typeof value === 'string' && HEX.test(value);

function parseHex(value) {
  let hex = value.slice(1);
  if (hex.length <= 4) hex = [...hex].map(ch => ch + ch).join('');
  const channels = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
  const alpha = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : null;
  return {channels, alpha};
}
const toHex = value => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0');

/**
 * Interpolate two hex colours (#rgb, #rgba, #rrggbb, #rrggbbaa) channel by
 * channel in sRGB, as GSAP does, returning lowercase "#rrggbb" (or
 * "#rrggbbaa" when either side carries alpha). t is clamped to [0, 1].
 */
export function interpolateColor(t, from, to) {
  if (!isColor(from) || !isColor(to)) throw new Error('interpolateColor expects hex colours');
  const p = clamp01(t), a = parseHex(from), b = parseHex(to);
  const rgb = a.channels.map((c, i) => toHex(c + (b.channels[i] - c) * p)).join('');
  if (a.alpha === null && b.alpha === null) return `#${rgb}`;
  const fa = a.alpha ?? 255, ta = b.alpha ?? 255;
  return `#${rgb}${toHex(fa + (ta - fa) * p)}`;
}

function lerpValue(from, to, p) {
  if (typeof from === 'number' && typeof to === 'number') return from + (to - from) * p;
  if (isColor(from) && isColor(to)) return interpolateColor(p, from, to);
  if (from && to && typeof from === 'object' && typeof to === 'object') {
    const out = {};
    for (const key of Object.keys(to)) out[key] = key in from ? lerpValue(from[key], to[key], p) : to[key];
    for (const key of Object.keys(from)) if (!(key in out)) out[key] = from[key];
    return out;
  }
  throw new Error('can only interpolate numbers, hex colours, or plain objects of them');
}
// GSAP ends a tween on the exact destination value; mirror that for objects.
const settle = value => (value && typeof value === 'object' ? {...value} : value);

/**
 * Value of a single tween at absolute time t. Before `start` returns `from`,
 * after `start + duration` returns `to`. Numbers, hex colours and plain
 * objects of them are supported.
 */
export function tween(t, {from, to, start = 0, duration, ease: easeName = DEFAULT_EASE}) {
  if (!(duration >= 0)) throw new Error('tween duration must be >= 0');
  if (t <= start && duration > 0) return settle(from);
  if (t >= start + duration) return settle(to);
  return lerpValue(from, to, getEase(easeName)(clamp01((t - start) / duration)));
}

// A scale change this wide (larger over smaller) is eased in log space.
export const WIDE_SCALE = 2;

/**
 * Scale between `from` and `to` at eased progress k, even to the eye. A
 * linear scale looks fast at the small end and slow at the large end, because
 * the eye reads the ratio between frames, not the difference. From WIDE_SCALE
 * up the scale is interpolated in log space (equal progress, equal ratio);
 * a smaller change stays linear, where the two are within a few per cent.
 */
export function scaleLerp(from, to, k) {
  const wide = from > 0 && to > 0 && Math.max(from / to, to / from) >= WIDE_SCALE;
  return wide ? from * Math.pow(to / from, k) : from + (to - from) * k;
}

/** tween() for a scale: the same timing and ease, interpolated with scaleLerp. */
export function tweenScale(t, {from, to, start = 0, duration, ease: easeName = DEFAULT_EASE}) {
  if (!(duration >= 0)) throw new Error('tween duration must be >= 0');
  if (t <= start && duration > 0) return from;
  if (t >= start + duration) return to;
  return scaleLerp(from, to, getEase(easeName)(clamp01((t - start) / duration)));
}

// Straight steps a second along a wide scale change: fine enough that the
// speed has no visible corner at a step, at 30 or 60 frames a second.
const SCALE_STEPS = 240;
// Where step i of `count` starts (a share of the move): the steps are
// shortest at the two ends, where an ease turns hardest, so the scale leaves
// and lands with the ease's own speed and not a step's average.
const stepAt = (i, count) => (i <= 0 ? 0 : i >= count ? 1 : (1 - Math.cos((Math.PI * i) / count)) / 2);
const wideScale = (a, b) => a > 0 && b > 0 && Math.max(a / b, b / a) >= WIDE_SCALE;
const r6 = value => Math.round(value * 1e6) / 1e6;

/**
 * The scale a camera draws at linear progress p of a move: scaleLerp, sampled
 * about 240 times a second (closer at the ends) and joined by straight lines when the change is wide, so it is
 * exactly what scaleTweenOps' linear tweens draw at any time.
 */
export function scaleStepAt(p, {from, to, duration, ease: easeName = DEFAULT_EASE}, rate = SCALE_STEPS) {
  const eased = getEase(easeName);
  if (p >= 1) return to;
  if (!wideScale(from, to)) return scaleLerp(from, to, eased(p));
  const count = Math.max(1, Math.ceil(duration * rate - 1e-6));
  let i = Math.min(count - 1, Math.max(0, Math.floor((Math.acos(1 - 2 * clamp01(p)) / Math.PI) * count)));
  while (i < count - 1 && stepAt(i + 1, count) <= p) i += 1;
  while (i > 0 && stepAt(i, count) > p) i -= 1;
  const at = n => r6(n >= count ? to : n <= 0 ? from : scaleLerp(from, to, eased(stepAt(n, count))));
  return at(i) + (at(i + 1) - at(i)) * ((p - stepAt(i, count)) / (stepAt(i + 1, count) - stepAt(i, count)));
}

/**
 * A tween op ({start, duration, ease, from, to} with from[key] a scale) as the
 * ops that draw it: itself when the scale change is small; else its other
 * properties as one tween, and the scale as short linear tweens along
 * the scaleLerp curve, so a renderer that only tweens linearly (a GSAP
 * fromTo) draws scaleStepAt.
 */
export function scaleTweenOps(op, key = 'scale', rate = SCALE_STEPS) {
  const a = op.from[key], b = op.to[key];
  if (!wideScale(a, b)) return [op];
  const count = Math.max(1, Math.ceil(op.duration * rate - 1e-6)), eased = getEase(op.ease);
  const at = i => r6(i >= count ? b : i <= 0 ? a : scaleLerp(a, b, eased(stepAt(i, count))));
  const time = i => r6(op.start + op.duration * stepAt(i, count));
  const {[key]: _from, ...from} = op.from, {[key]: _to, ...to} = op.to;
  return [
    ...(Object.keys(to).length ? [{...op, from, to}] : []),
    ...Array.from({length: count}, (_, i) => ({...op, start: time(i), duration: r6(time(i + 1) - time(i)), ease: 'none', from: {[key]: at(i)}, to: {[key]: at(i + 1)}}))
  ];
}

/**
 * Keyframe track. keys: [{t, v, ease?}] or [[t, v, ease?]]. Returns a function
 * of absolute time. Keys are sorted by t; the first value holds before the
 * first key and the last value after the last key. Each segment uses the
 * destination key's ease (GSAP keyframe semantics), defaulting to
 * "power1.out" like a plain GSAP tween. Values may be numbers, hex colours or
 * plain objects of them.
 */
export function track(keys) {
  if (!Array.isArray(keys) || keys.length === 0) throw new Error('track needs at least one key');
  const sorted = keys
    .map((key, order) => (Array.isArray(key) ? {t: key[0], v: key[1], ease: key[2], order} : {...key, order}))
    .sort((a, b) => a.t - b.t || a.order - b.order)
    .map(key => ({t: key.t, v: key.v, ease: getEase(key.ease ?? DEFAULT_EASE)}));
  for (const key of sorted) if (!Number.isFinite(key.t)) throw new Error('track key t must be a finite number');
  const last = sorted.length - 1;
  return t => {
    if (t <= sorted[0].t) return settle(sorted[0].v);
    if (t >= sorted[last].t) return settle(sorted[last].v);
    let i = 1;
    while (sorted[i].t <= t) i++;
    const a = sorted[i - 1], b = sorted[i];
    return lerpValue(a.v, b.v, b.ease((t - a.t) / (b.t - a.t)));
  };
}

// ---------------------------------------------------------------------------
// Stagger (gsap.utils.distribute, one-dimensional)

/**
 * Delay in seconds for element `index` of `count`, following GSAP stagger
 * semantics: from = "start" | "end" | "center" | "edges" | index | ratio in
 * (0, 1). Optional `amount` (total spread, overrides each), `ease` and `base`
 * behave like GSAP's. `count` may be omitted only for from = "start".
 */
export function stagger(index, {each = 0, from = 'start', count, amount, ease: easeName, base = 0} = {}) {
  if (count === undefined) {
    if (from !== 'start' && from !== 0) throw new Error('stagger needs count unless from is "start"');
    count = index + 1;
    if (amount !== undefined || easeName !== undefined) throw new Error('stagger with amount or ease needs count');
  }
  if (!Number.isInteger(count) || count < 1) throw new Error('stagger count must be a positive integer');
  const isDecimal = typeof from === 'number' && from > 0 && from < 1;
  const ratios = typeof from === 'string' || isDecimal;
  const ratio = typeof from === 'string' ? ({center: .5, edges: .5, end: 1}[from] || 0) : from;
  const origin = ratios ? count * ratio - .5 : from % 1e8;
  let max = 0, min = 1e8;
  const distances = [];
  for (let j = 0; j < count; j++) {
    const d = Math.abs(j - origin);
    distances.push(d);
    if (d > max) max = d;
    if (d < min) min = d;
  }
  const spread = ((Number(amount) || Number(each) * (count - 1)) || 0) * (from === 'edges' ? -1 : 1);
  const offset = spread < 0 ? base - spread : base;
  let shape = easeName === undefined ? null : getEase(easeName);
  if (shape && spread < 0) { const inner = shape; shape = p => 1 - inner(1 - p); }
  const progress = (distances[index] - min) / (max - min) || 0;
  return Math.round((offset + (shape ? shape(progress) : progress) * spread) * 1e7) / 1e7 || 0;
}

// ---------------------------------------------------------------------------
// Count-up (matches editorial textFrames(): frames+1 discrete states)

/**
 * Discrete count-up. State k (0..frames) appears at start + k / fps with value
 * from + (to - from) * (1 - (1 - k / frames)^3); the value at t is the latest
 * state at or before t (`from` before start). Returns format(value) when a
 * format callback is given, otherwise the number.
 */
export function countUp(t, {from, to, start = 0, frames: stateFrames = 18, fps = 30, format} = {}) {
  let value = from;
  for (let frame = 0; frame <= stateFrames; frame++) {
    if (start + frame / fps > t) break;
    const progress = frame / stateFrames, eased = 1 - (1 - progress) ** 3;
    value = from + (to - from) * eased;
  }
  return format ? format(value) : value;
}

// ---------------------------------------------------------------------------
// Spring (Remotion spring() replica)

function springStep(state, now, damping, stiffness, mass) {
  const deltaTime = Math.min(now - state.lastTimestamp, 64);
  const v0 = -state.velocity, x0 = 1 - state.current;
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  const omega0 = Math.sqrt(stiffness / mass);
  const omega1 = omega0 * Math.sqrt(1 - zeta ** 2);
  const t = deltaTime / 1000;
  if (zeta < 1) {
    const sin1 = Math.sin(omega1 * t), cos1 = Math.cos(omega1 * t);
    const envelope = Math.exp(-zeta * omega0 * t);
    const frag = envelope * (sin1 * ((v0 + zeta * omega0 * x0) / omega1) + x0 * cos1);
    return {lastTimestamp: now, current: 1 - frag,
      velocity: zeta * omega0 * frag - envelope * (cos1 * (v0 + zeta * omega0 * x0) - omega1 * x0 * sin1)};
  }
  const envelope = Math.exp(-omega0 * t);
  return {lastTimestamp: now, current: 1 - envelope * (x0 + (v0 + omega0 * x0) * t),
    velocity: envelope * (v0 * (t * omega0 - 1) + t * x0 * omega0 * omega0)};
}

/**
 * Damped spring from `from` to `to`, starting at absolute time `start`.
 * Replicates Remotion 4's spring() exactly: the same per-frame fixed-step
 * analytic advance (frame 0..floor(frame), then the fractional remainder),
 * the same 64 ms step cap, and the same critically-damped formula for
 * zeta >= 1. Returns `from` before start. `overshootClamping` is supported.
 */
export function springValue(t, {start = 0, damping = 14, stiffness = 140, mass = 1, from = 0, to = 1, fps = 30, overshootClamping = false} = {}) {
  if (!(damping > 0)) throw new Error('spring damping must be greater than 0');
  let frame = Math.max(0, (t - start) * fps);
  const nearest = Math.round(frame);
  if (Math.abs(frame - nearest) < 1e-9) frame = nearest;
  let state = {lastTimestamp: 0, current: 0, velocity: 0};
  for (let f = 0; f <= Math.floor(frame); f++) state = springStep(state, f / fps * 1000, damping, stiffness, mass);
  if (frame % 1 > 0) state = springStep(state, frame / fps * 1000, damping, stiffness, mass);
  let inner = state.current;
  if (overshootClamping) inner = Math.min(inner, 1); // progress always runs 0 to 1, whichever way from and to point
  return from === 0 && to === 1 ? inner : from + (to - from) * inner;
}

// ---------------------------------------------------------------------------
// Springs by feel (visible duration and bounce ↔ damping, stiffness, mass)

/** A spring has visibly arrived once it is within this fraction of its travel from the target. */
export const SPRING_ARRIVAL = .01;

// Time, in units of 1/ω0, at which a unit spring of damping ratio zeta first
// comes within SPRING_ARRIVAL of its target. The distance left falls
// monotonically until the first peak (t = π/ω1), so bisection finds it.
function springArrival(zeta) {
  const omega1 = Math.sqrt(1 - zeta ** 2);
  const left = zeta < 1
    ? (tau) => Math.exp(-zeta * tau) * (Math.cos(omega1 * tau) + zeta / omega1 * Math.sin(omega1 * tau))
    : (tau) => Math.exp(-tau) * (1 + tau);
  let lo = 0, hi = zeta < 1 ? Math.min(Math.PI / omega1, 60) : 60;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (left(mid) > SPRING_ARRIVAL) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * A spring chosen by how it looks → the {damping, stiffness, mass} that
 * `springValue` takes.
 *
 * `duration` is the visible duration in seconds: the time from the start
 * until the value first comes within 1 % of its travel (SPRING_ARRIVAL) of
 * the target. That is when the eye reads the move as landed; the bounce and
 * the settle that follow run longer, so time neighbours off this number.
 * `bounce` is the first overshoot as a fraction of the travel: 0 is a
 * critically damped spring that never passes the target, 0.27 passes it by
 * 27 %. Must be at least 0 and below 1.
 *
 * From the damped-spring solution: the first peak is exp(−πζ/√(1−ζ²)), which
 * gives the damping ratio ζ for a bounce, and time scales as 1/ω0, which
 * gives ω0 for a duration. Mass is always 1.
 */
export function springByFeel(duration, bounce = 0) {
  if (!(duration > 0) || !Number.isFinite(duration)) throw new Error('spring duration must be greater than 0');
  if (!(bounce >= 0 && bounce < 1)) throw new Error('spring bounce must be at least 0 and below 1');
  const log = bounce > 0 ? -Math.log(bounce) : Infinity;
  const zeta = bounce > 0 ? log / Math.hypot(Math.PI, log) : 1;
  const omega0 = springArrival(zeta) / duration;
  return {damping: 2 * zeta * omega0, stiffness: omega0 ** 2, mass: 1};
}

/**
 * The visible duration, in seconds, of a spring given as {damping, stiffness,
 * mass}: the inverse of `springByFeel`, with the same 1 % definition and
 * `springValue`'s defaults. A follower that should start as the spring lands
 * starts at `start + springVisibleDuration(config)`. `springValue` draws
 * every spring with ζ ≥ 1 as critically damped, so this does too.
 */
export function springVisibleDuration({damping = 14, stiffness = 140, mass = 1} = {}) {
  if (!(damping > 0 && stiffness > 0 && mass > 0)) throw new Error('spring damping, stiffness and mass must be greater than 0');
  return springArrival(Math.min(1, damping / (2 * Math.sqrt(stiffness * mass)))) / Math.sqrt(stiffness / mass);
}

// ---------------------------------------------------------------------------
// Spring ease (GSAP-native, parameterised by overshoot)

/** springEase()'s default overshoot when called with none: 27 % of the travel. The feel presets use 0. */
export const SPRING_OVERSHOOT = .27;
const springPeriods = new Map();

function peakOvershoot(fn, steps = 2000) {
  let peak = 0;
  for (let i = 0; i <= steps; i++) peak = Math.max(peak, fn(i / steps) - 1);
  return peak;
}

/**
 * A spring as a GSAP ease name: "elastic.out(1, P)" with the period P solved
 * so its first overshoot is `overshoot` of the travel (0.27 → 27 %). The
 * elastic decay 2^(−10p) makes each following swing about the same fraction
 * of the one before, as a damped spring does, and GSAP plays the name
 * natively, so both renderers draw the same curve. Overshoot 0 → "power3.out".
 */
export function springEase(overshoot = SPRING_OVERSHOOT) {
  const target = Number(overshoot);
  if (!Number.isFinite(target) || target < 0 || target > .6) throw new Error('spring overshoot must be between 0 and 0.6');
  if (target < .005) return 'power3.out';
  const key = Math.round(target * 1000) / 1000;
  if (!springPeriods.has(key)) {
    let lo = .1, hi = 2;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (peakOvershoot(configElastic('out', 1, mid)) > key) lo = mid; else hi = mid;
    }
    springPeriods.set(key, Math.round(((lo + hi) / 2) * 1000) / 1000);
  }
  return `elastic.out(1, ${springPeriods.get(key)})`;
}

// ---------------------------------------------------------------------------
// Text splitting

/** Whitespace-separated words, in order. → [{text, index}] */
export function splitWords(text) {
  return String(text ?? '').split(/\s+/).filter(Boolean).map((word, index) => ({text: word, index}));
}

/** Grapheme clusters (spaces included, so layout is preserved). → [{text, index}] */
export function splitChars(text) {
  const value = String(text ?? '');
  const parts = typeof Intl !== 'undefined' && Intl.Segmenter
    ? Array.from(new Intl.Segmenter(undefined, {granularity: 'grapheme'}).segment(value), part => part.segment)
    : Array.from(value);
  return parts.map((ch, index) => ({text: ch, index}));
}

// ---------------------------------------------------------------------------
// Motion blur

/**
 * Velocity-shaped motion-blur radius in px. A `shutter` (fraction of a frame,
 * 0.5 = 180°) smears |velocity| * shutter px; the blur radius is half that
 * length, capped at `max`. Sub-`threshold` radii resolve to exactly 0, so a
 * settled element is always sharp.
 */
export function motionBlurPx(velocityPxPerFrame, {max = 24, shutter = .5, threshold = .25} = {}) {
  const speed = Math.abs(Number(velocityPxPerFrame) || 0);
  const radius = speed * shutter / 2;
  return radius < threshold ? 0 : Math.min(max, radius);
}

/**
 * Text for a GSAP `textContent` set. When the element already holds a number,
 * GSAP parses a numeric string and writes it back as a number, dropping
 * trailing zeros ("70.0" becomes "70"). A leading WORD JOINER (U+2060, zero
 * width) keeps such strings as text. Other strings are returned unchanged.
 */
export function gsapText(text) {
  const value = String(text);
  return /^[-+]?\d*\.?\d+$/.test(value.trim()) && String(Number(value)) !== value ? `⁠${value}` : value;
}
