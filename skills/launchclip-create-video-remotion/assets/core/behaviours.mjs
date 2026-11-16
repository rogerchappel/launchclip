// Behaviours: opt-in idle motions on a scene's content (scene.behaviour,
// docs/FINISHING_AND_ELEMENTS_RFC.md E.3), written as camera-world ops
// ({type: 'set' | 'tween', target: 'behave', …}) on one wrapper, so both
// renderers play them with what they have: Remotion through opsStateAt, the
// HyperFrames compiler through opsGsap. Frame-pure: every offset is a hash
// of the scene id, never a random number.
//
// Periodic motions are sine.inOut half-cycles between extremes, which is an
// exact sinusoid, entered and left on quarter cycles (sine.out, sine.in) so
// the motion starts and ends at rest with no jump. Amplitudes are px at 1080
// on the short side and degrees, times IDLE_SCALE for the grammar and the
// scene's `amount`. No strobe: a flicker dips at most 40 %, never to black.
//
// Plain ESM; imports only fluid-motion.mjs (hashUnit, IDLE_SCALE) and grammar.mjs.

import { IDLE_SCALE, hashUnit } from './fluid-motion.mjs';
import { resolveGrammar } from './grammar.mjs';

/** Kind → its default period (s) and amplitude, and its pivot in the content's rect (shares). */
export const BEHAVIOURS = Object.freeze({
  wiggle: { period: 2, amp: { x: 7, y: 7, rotation: 1.4 } },
  jitter: { period: 0.1, amp: { x: 2.5, y: 2.5, rotation: 0.5 } },
  orbit: { period: 4, amp: { r: 9 } },
  lissajous: { period: 5, amp: { x: 12, y: 7 } },
  drift: { period: 0, amp: { d: 28 } },
  pendulum: { period: 3, amp: { rotation: 3 }, pivot: [0.5, 0] },
  wobble: { period: 0.9, amp: { skewX: 6 } },
  spin: { period: 6, amp: {} },
  pulse: { period: 0, amp: { scale: 0.05 } },
  heartbeat: { period: 0, amp: { scale: 0.06 } },
  breathe: { period: 4.8, amp: { scale: 0.025 } },
  squash: { period: 0.5, amp: { s: 0.1 }, pivot: [0.5, 1] },
  flicker: { period: 0.32, amp: { dip: 0.4 } },
  'fade-pulse': { period: 2.4, amp: { dip: 0.35 } }
});
export const BEHAVIOUR_KINDS = Object.freeze(Object.keys(BEHAVIOURS));
/** Seconds the content settles after it starts before an idle starts (squash and wobble play on arrival). */
export const BEHAVIOUR_SETTLE = 0.6;
const ARRIVAL = ['squash', 'wobble'];
const r4 = (v) => Math.round(v * 1e4) / 1e4;

// value(θ) = c + A·sin θ over `cycles` full turns of `period` from t0, as
// tweens on one prop: a quarter out of rest, half-cycles, a quarter back.
// shape "cos" is c + A·(1 − cos θ)/2, a rise and fall from rest.
function sineOps(ops, prop, t0, period, cycles, amp, { rest = 0, shape = 'sin' } = {}) {
  if (!(cycles >= 1)) return;
  const tw = (start, duration, ease, from, to) => ops.push({ type: 'tween', target: 'behave', start: r4(start), duration: r4(duration), ease, from: { [prop]: r4(from) }, to: { [prop]: r4(to) } });
  if (shape === 'cos') {
    for (let k = 0; k < cycles * 2; k += 1) tw(t0 + (k * period) / 2, period / 2, 'sine.inOut', k % 2 ? rest + amp : rest, k % 2 ? rest : rest + amp);
    return;
  }
  const q = period / 4;
  tw(t0, q, 'sine.out', rest, rest + amp);
  for (let k = 0; k < cycles * 2 - 1; k += 1) tw(t0 + q + (k * period) / 2, period / 2, 'sine.inOut', rest + (k % 2 ? -amp : amp), rest + (k % 2 ? amp : -amp));
  tw(t0 + q + ((cycles * 2 - 1) * period) / 2, q, 'sine.in', rest - amp, rest);
}

/**
 * A scene's behaviour → {ops, pivot: {x, y} (px), kind} | null.
 * behaviour: {kind, amount? (0–2, default 1), period? (s), angle? (drift,
 * degrees, 0 up), bpm? (pulse, heartbeat)}; window: {start, end} (s), the
 * span the scene is on screen; rect: the content's rect (px; the canvas when
 * absent); grammar: a resolved grammar or null; unit: canvas short side / 1080.
 */
export function behaviourOps(behaviour, { id, window, rect, grammar = null, unit = 1, bpm = 100 }) {
  const spec = BEHAVIOURS[behaviour?.kind];
  if (!spec) return null;
  const kind = behaviour.kind;
  const k = (IDLE_SCALE[grammar?.id] ?? 1) * (Number.isFinite(behaviour.amount) ? behaviour.amount : 1);
  const px = (v) => v * unit * k, deg = (v) => v * k;
  const period = Number(behaviour.period) > 0 ? Number(behaviour.period) : spec.period;
  const beat = 60 / (Number(behaviour.bpm) > 0 ? Number(behaviour.bpm) : bpm);
  const [fx, fy] = spec.pivot ?? [0.5, 0.5];
  const pivot = { x: r4(rect.x + rect.width * fx), y: r4(rect.y + rect.height * fy) };
  const t0 = window.start + (ARRIVAL.includes(kind) ? 0 : BEHAVIOUR_SETTLE);
  const span = window.end - t0;
  const ops = [];
  const turns = (p) => Math.floor(span / p);
  const seed = (i) => hashUnit(`${id}:${kind}:${i}`) * 2 - 1;
  const tw = (start, duration, ease, from, to) => ops.push({ type: 'tween', target: 'behave', start: r4(start), duration: r4(duration), ease, from, to });
  const round = (o) => Object.fromEntries(Object.entries(o).map(([key, v]) => [key, r4(v)]));
  if (span <= 0) return null;
  switch (kind) {
    case 'wiggle': case 'jitter': {
      // wiggle glides between seeded offsets; jitter jumps to them (stepped).
      const steps = Math.floor(span / (kind === 'wiggle' ? period / 4 : period));
      const at = (i) => (i === 0 || i >= steps ? { x: 0, y: 0, rotation: 0 } : round({ x: px(spec.amp.x) * seed(i * 3), y: px(spec.amp.y) * seed(i * 3 + 1), rotation: deg(spec.amp.rotation) * seed(i * 3 + 2) }));
      const step = span / Math.max(1, steps);
      for (let i = 1; i <= steps; i += 1) {
        if (kind === 'wiggle') tw(t0 + (i - 1) * step, step, 'sine.inOut', at(i - 1), at(i));
        else ops.push({ type: 'set', target: 'behave', time: r4(t0 + i * step), props: at(i) });
      }
      if (kind === 'jitter') ops.push({ type: 'set', target: 'behave', time: r4(window.end), props: at(0) });
      break;
    }
    case 'orbit': {
      const n = turns(period);
      sineOps(ops, 'x', t0, period, n, px(spec.amp.r));
      sineOps(ops, 'y', t0, period, n, -2 * px(spec.amp.r), { shape: 'cos' });
      break;
    }
    case 'lissajous': {
      // A figure eight: y at twice x's rate.
      const n = turns(period);
      sineOps(ops, 'x', t0, period, n, px(spec.amp.x));
      sineOps(ops, 'y', t0, period / 2, n * 2, px(spec.amp.y));
      break;
    }
    case 'pendulum': sineOps(ops, 'rotation', t0, period, turns(period), deg(spec.amp.rotation)); break;
    case 'breathe': sineOps(ops, 'scale', t0, period, turns(period), spec.amp.scale * k, { rest: 1, shape: 'cos' }); break;
    case 'fade-pulse': sineOps(ops, 'opacity', t0, period, turns(period), -Math.min(0.6, spec.amp.dip * k), { rest: 1, shape: 'cos' }); break;
    case 'spin': {
      // Whole turns over the span, so it ends upright (the period stretches to fit).
      const n = Math.max(1, Math.round(span / period));
      tw(t0, span, 'none', { rotation: 0 }, { rotation: 360 * n * (behaviour.direction === 'left' ? -1 : 1) });
      break;
    }
    case 'drift': {
      // Out along `angle` and no further than d px, slow at both ends.
      const a = ((Number.isFinite(behaviour.angle) ? behaviour.angle : 90) * Math.PI) / 180, d = px(spec.amp.d);
      tw(t0, span, 'sine.inOut', { x: 0, y: 0 }, round({ x: d * Math.sin(a), y: -d * Math.cos(a) }));
      break;
    }
    case 'pulse': case 'heartbeat': {
      // On the beat: a quick swell and a slower settle (heartbeat: two swells, lub-dub).
      const s = 1 + spec.amp.scale * k, s2 = 1 + spec.amp.scale * k * 0.6;
      for (let t = Math.ceil(t0 / beat) * beat; t + beat <= window.end + 1e-9; t += beat * (kind === 'heartbeat' ? 2 : 1)) {
        tw(t, beat * 0.2, 'power2.out', { scale: 1 }, { scale: r4(s) });
        if (kind === 'pulse') tw(t + beat * 0.2, beat * 0.6, 'sine.inOut', { scale: r4(s) }, { scale: 1 });
        else {
          tw(t + beat * 0.2, beat * 0.2, 'sine.inOut', { scale: r4(s) }, { scale: 1 });
          tw(t + beat * 0.4, beat * 0.15, 'power2.out', { scale: 1 }, { scale: r4(s2) });
          tw(t + beat * 0.55, beat * 0.6, 'sine.inOut', { scale: r4(s2) }, { scale: 1 });
        }
      }
      break;
    }
    case 'wobble': {
      // A damped skew as it lands: each swing 0.6 of the last, back to rest.
      let from = 0, a = deg(spec.amp.skewX), t = t0;
      const step = period / 6;
      for (let i = 0; i < 6; i += 1) {
        const to = i === 5 ? 0 : (i % 2 ? -a : a);
        tw(t, step, 'sine.inOut', { skewX: r4(from) }, { skewX: r4(to) });
        from = to; a *= 0.6; t += step;
      }
      break;
    }
    case 'squash': {
      // It lands: wide and short, then tall and narrow a little, then at rest (about its base).
      const s = spec.amp.s * k, step = period / 3;
      tw(t0, step, 'power2.out', { scaleX: 1, scaleY: 1 }, round({ scaleX: 1 + s, scaleY: 1 - s }));
      tw(t0 + step, step, 'sine.inOut', round({ scaleX: 1 + s, scaleY: 1 - s }), round({ scaleX: 1 - s * 0.3, scaleY: 1 + s * 0.3 }));
      tw(t0 + 2 * step, step, 'sine.inOut', round({ scaleX: 1 - s * 0.3, scaleY: 1 + s * 0.3 }), { scaleX: 1, scaleY: 1 });
      break;
    }
    case 'flicker': {
      // Seeded dips, as a neon tube: most steps whole, some dimmed (never off).
      const dip = Math.min(0.6, spec.amp.dip * k);
      for (let i = 0, t = t0; t + period <= window.end; i += 1, t += period) {
        const v = hashUnit(`${id}:flicker:${i}`);
        ops.push({ type: 'set', target: 'behave', time: r4(t), props: { opacity: v < 0.7 ? 1 : r4(1 - dip * (v - 0.7) / 0.3) } });
      }
      ops.push({ type: 'set', target: 'behave', time: r4(window.end), props: { opacity: 1 } });
      break;
    }
  }
  return ops.length ? { kind, pivot, ops } : null;
}

/** The behaviour wrapper's props → CSS transform, in GSAP CSSPlugin order (translate, rotate, skew, scale). */
export function behaviourTransform(props) {
  const sx = props.scaleX ?? props.scale ?? 1, sy = props.scaleY ?? props.scale ?? 1;
  return `translate(${r4(props.x ?? 0)}px, ${r4(props.y ?? 0)}px) rotate(${r4(props.rotation ?? 0)}deg) skew(${r4(props.skewX ?? 0)}deg, 0deg) scale(${r4(sx)}, ${r4(sy)})`;
}

/**
 * A story scene's behaviour, as both renderers draw it: its content rect
 * (model.layout.rect or model.rect, else the canvas), the story's grammar
 * and music tempo. window: {start, end} the scene is drawn. → behaviourOps().
 */
export function sceneBehaviour(story, scene, model, window) {
  if (!scene?.behaviour) return null;
  const width = Number(story?.format?.width), height = Number(story?.format?.height);
  const rect = model?.layout?.rect ?? model?.rect ?? { x: 0, y: 0, width, height };
  const bpm = Number(story?.audio?.music?.bpm ?? story?.audio?.sound?.music?.bpm) || 100;
  return behaviourOps(scene.behaviour, { id: scene.id, window, rect, grammar: resolveGrammar(story), unit: Math.min(width, height) / 1080, bpm });
}
