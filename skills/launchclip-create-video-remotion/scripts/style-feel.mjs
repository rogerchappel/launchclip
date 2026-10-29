// Motion feel and backdrops for generated styles (docs/SEEDED_STYLES_RFC.md
// §3.8): how a brand's world moves, drawn from a seed inside a tone's ranges.
//
//   drawMotionFeel(stream, {grammar, tone, overshoot}) → {grammar, camera, feel, transitions}
//   drawBackdrops(stream, {dark, tone}) → a style plate with a cycle, or null
//
// The feel is written in the shapes the renderers already read, so both draw
// it the same way with no new renderer code:
//   motion.grammar  {base, ease, duration, overshoot, stagger, camera}: the
//                   base grammar's eases replaced by one ease family with no
//                   overshoot (slow-fast-slow .inOut on moves and the camera,
//                   .out on entrances), a tempo scaling every duration, and the
//                   camera's whip ease, drift and motion blur
//                   (kit/core/grammar.mjs resolveGrammar);
//   camera          {mode, layout, spacing, parallax} (kit/core/camera-world.mjs);
//   motion.feel     the summary planners read: {ease, tempo, whip, blur,
//                   focus_zooms: {every, scale}}, how often a shot gets a
//                   focus zoom (every n shots) and how far it dives
//                   (kit/core/zooms.mjs scale).
// Overshooting eases (back, elastic, bounce) are never drawn unless the
// caller asks for them with overshoot: true; then entrances and emphasis keep
// the base grammar's own eases.
//
// Backdrops: on a dark look, most seeds get a set of 2–4 backdrop plates
// (kit/core/plates.mjs) with seeded focus, intensity, drift, depth and tint,
// and a cycle that changes plate every n shots; with a world camera the
// plates are the world's backdrops (kit/core/world-backdrops.mjs) and change
// with its moves. Plates are dark by design, so light looks keep their
// background field and their world.
//
// Pure ESM that imports only kit/core siblings. Canonical copy:
// kit/core/style-feel.mjs.

import { GRAMMARS } from './grammar.mjs';
import { CAMERA_LAYOUTS } from './camera-world.mjs';
import { DARK_PLATE_KINDS, PLATE_TINTS } from './plates.mjs';

// Ease families with no overshoot, gentlest first.
export const FEEL_EASES = Object.freeze(['sine', 'power1', 'power2', 'power3', 'circ', 'power4', 'expo']);
// The whip: how a fast sideways move reads. blur-whip is a whip-pan with full
// motion blur; slide a clean pan; push a push or zoom through; cut no
// travelling move at all.
export const FEEL_WHIPS = Object.freeze(['blur-whip', 'slide', 'push', 'cut']);
const WHIP_TRANSITIONS = Object.freeze({ 'blur-whip': ['whip-pan'], slide: ['pan'], push: ['push', 'zoom'], cut: ['cut', 'fade'] });
// Focus zooms: every n shots (0: none), and how far they dive.
export const FEEL_ZOOM_EVERY = Object.freeze([0, 2, 3, 4, 6]);

// Per tone: the ease families it fits, its tempo range (a multiplier on
// every duration of the base grammar: below 1 is faster), its motion blur
// range, the whips it fits, how often it zooms and the share of world camera
// (most travel: motion videos are expected to move through one world).
export const FEEL_TONES = Object.freeze({
  calm: { eases: ['sine', 'power1', 'power2'], tempo: [1.05, 1.35], blur: [0.15, 0.4], whips: ['slide', 'cut'], zooms: [0, 4, 6], world: 0.8 },
  serious: { eases: ['power1', 'power2', 'power3'], tempo: [0.95, 1.25], blur: [0.15, 0.45], whips: ['slide', 'push', 'cut'], zooms: [3, 4, 6], world: 0.75 },
  warm: { eases: ['sine', 'power2', 'power3'], tempo: [0.95, 1.25], blur: [0.2, 0.5], whips: ['slide', 'push'], zooms: [3, 4, 6], world: 0.85 },
  energetic: { eases: ['power3', 'power4', 'expo', 'circ'], tempo: [0.7, 0.95], blur: [0.45, 0.85], whips: ['blur-whip', 'push', 'slide'], zooms: [2, 3], world: 0.95 },
  playful: { eases: ['power2', 'power3', 'circ', 'expo'], tempo: [0.8, 1.05], blur: [0.35, 0.75], whips: ['blur-whip', 'slide', 'push'], zooms: [2, 3, 4], world: 0.95 },
  premium: { eases: ['power2', 'power3', 'sine'], tempo: [1, 1.3], blur: [0.25, 0.6], whips: ['slide', 'push'], zooms: [3, 4, 6], world: 0.85 },
  technical: { eases: ['power3', 'power4', 'expo', 'circ'], tempo: [0.8, 1.05], blur: [0.3, 0.7], whips: ['blur-whip', 'push', 'slide', 'cut'], zooms: [2, 3, 4], world: 0.9 }
});
const NO_TONE = Object.freeze({ eases: FEEL_EASES, tempo: [0.75, 1.3], blur: [0.15, 0.85], whips: FEEL_WHIPS, zooms: FEEL_ZOOM_EVERY, world: 0.85 });
// The fastest families whip; a gentle family whips with power3.
const WHIP_EASE = Object.freeze({ sine: 'power3', power1: 'power3', power2: 'power3', power3: 'power4', circ: 'circ', power4: 'expo', expo: 'expo' });

const round = (value, places = 2) => Math.round(value * 10 ** places) / 10 ** places;
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

/**
 * The motion feel for a base grammar and tone. `pick` and `range` come from
 * the generator's seeded stream for the feel. → {grammar: the override
 * object for motion.grammar, camera: story.camera, feel: motion.feel,
 * transitions: the preferred transitions, the whip's first}
 */
export function drawMotionFeel(s, { grammar, tone = null, overshoot = false, transitions = [] } = {}) {
  const t = FEEL_TONES[tone] ?? NO_TONE;
  const base = GRAMMARS[grammar] ?? GRAMMARS.editorial;
  const family = s.pick(t.eases);
  const exitFamily = s.pick(t.eases);
  const tempo = round(s.range(...t.tempo));
  const blur = round(s.range(...t.blur));
  const whip = s.pick(t.whips);
  const every = s.pick(t.zooms);
  const zoomScale = round(s.range(1.25, 1.7));
  const world = s.chance(t.world);
  const layout = s.pick(CAMERA_LAYOUTS);
  const spacing = round(s.range(0.08, 0.22));
  const parallax = s.chance(0.75);
  const drift = round(base.camera.drift * s.range(0.6, 1.4), 1);
  const staggerScale = s.range(0.8, 1.25);

  const ease = overshoot
    ? { move: `${family}.inOut`, camera: `${family}.inOut` }
    : { enter: `${family}.out`, exit: `${exitFamily}.in`, move: `${family}.inOut`, camera: `${family}.inOut`, emphasis: `${family}.out` };
  const duration = Object.fromEntries(Object.entries(base.duration).map(([role, seconds]) => [role, round(clamp(seconds * tempo, role === 'camera' ? 0.45 : 0.12, role === 'camera' ? 1.6 : 1.2))]));
  const motion = {
    base: base.id,
    ease,
    duration,
    ...(overshoot ? {} : { overshoot: 0 }),
    stagger: round(clamp(base.stagger * staggerScale, 0.5, 1.6)),
    camera: { whip: `${WHIP_EASE[family]}.inOut`, anticipation: overshoot ? base.camera.anticipation : false, moveBlur: whip === 'cut' ? round(blur / 2) : blur, drift }
  };
  const camera = world ? { mode: 'world', layout, spacing, parallax } : { mode: 'cuts' };
  const preferred = [...WHIP_TRANSITIONS[whip], ...transitions].filter((name, i, list) => list.indexOf(name) === i).slice(0, 4);
  return {
    grammar: motion,
    camera,
    transitions: preferred,
    feel: { ease: family, tempo, whip, blur: motion.camera.moveBlur, focus_zooms: { every, scale: zoomScale } }
  };
}

// The share of dark looks that travel over plates.
export const PLATE_CHANCE = 0.65;

/** A backdrop plate set with a cycle for a dark look, or null. */
export function drawBackdrops(s, { dark }) {
  const use = s.chance(PLATE_CHANCE);
  const order = [...DARK_PLATE_KINDS];
  for (let i = order.length - 1; i > 0; i -= 1) { const k = Math.floor(s.random() * (i + 1)); [order[i], order[k]] = [order[k], order[i]]; }
  const count = 2 + Math.floor(s.random() * 3);
  const every = 1 + Math.floor(s.random() * 4);
  const plates = order.slice(0, count).map((kind) => ({
    kind,
    params: { focus: round(s.range(0.45, 0.85)), intensity: round(s.range(0.35, 0.65)), speed: round(s.range(0.5, 1.3)), depth: round(s.range(0.3, 0.8)), tint: s.pick(PLATE_TINTS) }
  }));
  if (!dark || !use) return null;
  return { kind: plates[0].kind, params: { ...plates[0].params }, cycle: { every, plates } };
}
