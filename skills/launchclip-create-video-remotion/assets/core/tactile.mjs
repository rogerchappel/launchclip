// Tactile motion for the satisfying-motion modules (catalog-h-tactile.mjs):
// drops with weight (a gravity fall, a squash on contact, an overshoot
// settle), contact shadows that firm up as an object lands, a stamp press,
// and small seeded particle bursts on landings and impacts. Frame-pure:
// every move is a set or tween on the module's op list, and every random
// number comes from a generator seeded by the scene and object id, so both
// renderers and every seek draw the same frame.

import {abs, el, set, tw} from './catalog-b-view.mjs';
import {mixColor, r2, rt} from './catalog-h-base.mjs';

// Seconds and shares at the default feel: the fall, the squash on contact,
// the settle back to shape, and how far the object squashes.
export const TACTILE = Object.freeze({fall: 0.3, squash: 0.06, settle: 0.28, give: 0.14, burst: 0.55});

/** A seeded generator in [0, 1): the same seed gives the same sequence everywhere. */
export function seededRandom(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Depth for a raised face of colour `fill`: a darker edge under it and a soft cast shadow. */
export function tactileDepth(fill, depth) {
  return `0 ${r2(depth)}px 0 ${mixColor(fill, '#000000', 0.62)}, 0 ${r2(depth * 2.6)}px ${r2(depth * 4.5)}px rgba(0,0,0,.34)`;
}

/** A face's light: a top highlight fading into `fill`. */
export function tactileFace(fill) {
  return `linear-gradient(180deg, ${mixColor(fill, '#ffffff', 0.8)} 0%, ${fill} 46%, ${mixColor(fill, '#000000', 0.9)} 100%)`;
}

/**
 * A drop with weight on `id` (its transform origin at the bottom): hidden
 * until `t`, then a gravity fall of `height` px, a squash on contact and an
 * overshoot settle. → the landing time.
 */
export function dropOps(ops, id, start, t, height, {fall = TACTILE.fall, give = TACTILE.give} = {}) {
  set(ops, id, start, {opacity: 0, x: 0, y: -height, scaleX: 1, scaleY: 1});
  set(ops, id, t, {opacity: 1});
  tw(ops, id, t, fall, 'power2.in', {y: -height}, {y: 0});
  const land = rt(t + fall);
  const squashed = {scaleX: r2(1 + give * 0.6), scaleY: r2(1 - give)};
  tw(ops, id, land, TACTILE.squash, 'power1.out', {scaleX: 1, scaleY: 1}, squashed);
  tw(ops, id, rt(land + TACTILE.squash), TACTILE.settle, 'back.out(3)', squashed, {scaleX: 1, scaleY: 1});
  return land;
}

/** A contact shadow under an object: an ellipse that darkens and widens as it falls. */
export function shadowNode(id, x, y, width, height) {
  return el('div', id, abs(r2(x), r2(y), r2(width), r2(height), {borderRadius: '50%', background: 'radial-gradient(closest-side, rgba(0,0,0,.55), rgba(0,0,0,0))', opacity: 0}));
}

export function shadowOps(ops, id, start, t, fall = TACTILE.fall) {
  set(ops, id, start, {opacity: 0, scaleX: 0.35, scaleY: 0.35});
  tw(ops, id, t, fall, 'power2.in', {opacity: 0, scaleX: 0.35, scaleY: 0.35}, {opacity: 0.7, scaleX: 1, scaleY: 1});
}

/** A stamp press: in large and tilted, pressed down hard, a small recoil. */
export function stampOps(ops, id, start, t, {tilt = -4} = {}) {
  set(ops, id, start, {opacity: 0, scaleX: 1.7, scaleY: 1.7, rotation: tilt - 8});
  tw(ops, id, t, 0.14, 'power4.in', {opacity: 0, scaleX: 1.7, scaleY: 1.7, rotation: tilt - 8}, {opacity: 1, scaleX: 0.94, scaleY: 0.94, rotation: tilt});
  tw(ops, id, rt(t + 0.14), 0.3, 'elastic.out(1,0.45)', {scaleX: 0.94, scaleY: 0.94}, {scaleX: 1, scaleY: 1});
}

/** A pulse on a landed object (a milestone, a count step): up and back. */
export function pulseOps(ops, id, t, amount = 0.12) {
  tw(ops, id, t, 0.08, 'power2.out', {scaleX: 1, scaleY: 1}, {scaleX: r2(1 + amount), scaleY: r2(1 + amount)});
  tw(ops, id, rt(t + 0.08), 0.32, 'back.out(2.4)', {scaleX: r2(1 + amount), scaleY: r2(1 + amount)}, {scaleX: 1, scaleY: 1});
}

/**
 * Burst particles from (x, y): `count` dust motes (sideways, low: a landing)
 * or confetti (all round, rising: a finish), seeded by `seed`.
 * → [{id, x, y, w, h, color, round, dx, dy, rotation, duration}].
 */
export function burstParticles(seed, id, {x, y, count, spread, size, colors, kind = 'dust'}) {
  const random = seededRandom(seed);
  return Array.from({length: count}, (_, i) => {
    const dust = kind === 'dust';
    const angle = dust ? (random() < 0.5 ? Math.PI : 0) + (random() - 0.5) * 0.9 : random() * Math.PI * 2;
    const reach = spread * (0.45 + random() * 0.55);
    const s = size * (0.55 + random() * 0.6);
    return {id: `${id}-p${i}`, x: r2(x - s / 2), y: r2(y - s / 2), w: r2(s), h: r2(dust ? s : s * 0.55), color: colors[Math.floor(random() * colors.length)], round: dust || random() < 0.4,
      dx: r2(Math.cos(angle) * reach), dy: r2(dust ? -Math.abs(Math.sin(angle)) * reach * 0.5 - spread * 0.08 : Math.sin(angle) * reach - spread * 0.25), rotation: dust ? 0 : Math.round((random() - 0.5) * 540),
      duration: rt(TACTILE.burst * (0.75 + random() * 0.5))};
  });
}

export function burstNodes(particles) {
  return particles.map(p => el('div', p.id, abs(p.x, p.y, p.w, p.h, {background: p.color, borderRadius: p.round ? '50%' : r2(p.w * 0.18), opacity: 0})));
}

/** Particles fly out from `t` and fade as they slow. */
export function burstOps(ops, particles, start, t) {
  for (const p of particles) {
    set(ops, p.id, start, {opacity: 0, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1});
    set(ops, p.id, t, {opacity: 1});
    tw(ops, p.id, t, p.duration, 'power3.out', {x: 0, y: 0, rotation: 0}, {x: p.dx, y: p.dy, rotation: p.rotation});
    tw(ops, p.id, rt(t + p.duration * 0.35), rt(p.duration * 0.65), 'power1.in', {opacity: 1, scaleX: 1, scaleY: 1}, {opacity: 0, scaleX: 0.3, scaleY: 0.3});
  }
}
