// Typed scene transitions and scene render windows, shared by the HyperFrames
// compiler (as GSAP fromTo calls) and the Remotion StoryComposition (evaluated
// per frame through motion.mjs), so both renderers move the same layers by
// the same amounts with the same eases. Plain ESM with no imports.
// Canonical copy: kit/core/transitions.mjs.
//
// Model: every track-0 scene is an opaque plate (brand background). A scene's
// `in` transition runs over [scene.start, scene.start + in.dur]. The previous
// track-0 scene stays on screen underneath until the transition settles (its
// render window is extended, because the validator forbids same-track
// overlap), and receives the matching "out" tweens. Scenes on higher tracks
// are transparent overlays and only receive "in" tweens.

export const TRANSITION_TYPES = Object.freeze(['cut', 'fade', 'push', 'whip', 'zoom', 'iris', 'morph']);

/** Identity state of a scene layer. iris: null = no clip. */
export const LAYER_IDENTITY = Object.freeze({ opacity: 1, x: 0, y: 0, scale: 1, blur: 0, iris: null });

const EPS = 1e-6;
const ADJACENT = 0.1;

/** Radius (px) of a circle centred on the canvas that covers every corner. */
export function irisRadius(width, height) {
  return Math.ceil(Math.hypot(width / 2, height / 2)) + 2;
}

/**
 * Property tweens for one typed transition.
 * → {type, duration, in: Tween[], out: Tween[]}
 * Tween = {prop: "opacity"|"x"|"y"|"scale"|"blur"|"iris", from, to, start, duration, ease}
 * where start is seconds relative to the transition start.
 */
export function transitionTweens(transition, { width, height }) {
  const type = transition?.type ?? 'cut';
  const d = Number(transition?.dur ?? 0);
  const direction = transition?.direction ?? 'left';
  if (!TRANSITION_TYPES.includes(type)) throw new Error(`unknown transition type ${JSON.stringify(type)}`);
  const t = (prop, from, to, ease, start = 0, duration = d) => ({ prop, from, to, start, duration, ease });
  if (type === 'cut' || !(d > 0)) return { type: 'cut', duration: 0, in: [], out: [] };
  const axis = direction === 'up' || direction === 'down' ? 'y' : 'x';
  const span = axis === 'x' ? width : height;
  // "left" = the content travels left: the incoming plate enters from the right.
  const sign = direction === 'left' || direction === 'up' ? -1 : 1;
  switch (type) {
    case 'fade':
      return { type, duration: d, in: [t('opacity', 0, 1, 'power1.inOut')], out: [] };
    case 'morph':
      // Crossfade; the module pair hands the named shared object across.
      return { type, duration: d, in: [t('opacity', 0, 1, 'power2.inOut')], out: [t('opacity', 1, 0, 'power2.inOut')] };
    case 'push':
      return { type, duration: d, in: [t(axis, -sign * span, 0, 'power3.inOut')], out: [t(axis, 0, sign * span, 'power3.inOut')] };
    case 'whip': {
      const half = d / 2, blur = 24;
      const blurs = [t('blur', 0, blur, 'power2.in', 0, half), t('blur', blur, 0, 'power2.out', half, half)];
      return { type, duration: d, in: [t(axis, -sign * span, 0, 'expo.inOut'), ...blurs], out: [t(axis, 0, sign * span, 'expo.inOut'), ...blurs] };
    }
    case 'zoom':
      return { type, duration: d, in: [t('scale', 0.6, 1, 'power3.out'), t('opacity', 0, 1, 'power2.out', 0, d * 0.6)], out: [t('scale', 1, 1.5, 'power3.in')] };
    case 'iris':
      return { type, duration: d, in: [t('iris', 0, irisRadius(width, height), 'power2.inOut')], out: [] };
    default:
      return { type: 'cut', duration: 0, in: [], out: [] };
  }
}

/**
 * Layer state at absolute time t. `tweens` carry absolute starts
 * ({...Tween, at}); later tweens win, as on a GSAP timeline. `ease` is a
 * function (name) → (p) => value, normally motion.mjs getEase.
 */
export function layerStateAt(t, tweens, getEase) {
  const state = { ...LAYER_IDENTITY };
  let clipped = false;
  for (const tw of tweens) {
    if (t < tw.at - EPS) continue;
    const p = tw.duration > 0 ? Math.min(1, Math.max(0, (t - tw.at) / tw.duration)) : 1;
    const value = tw.from + (tw.to - tw.from) * (p >= 1 ? 1 : getEase(tw.ease)(p));
    state[tw.prop] = value;
    if (tw.prop === 'iris') clipped = p < 1;
  }
  // A finished iris covers the whole frame; drop the clip so the layer is
  // identical to an unclipped one.
  if (!clipped) state.iris = null;
  return state;
}

/** Layer state → inline CSS values (camelCase, React style keys). */
export function layerStyle(state) {
  const style = { opacity: state.opacity };
  if (state.x || state.y || state.scale !== 1) style.transform = `translate(${round(state.x)}px, ${round(state.y)}px) scale(${round(state.scale, 5)})`;
  if (state.blur > 0.001) style.filter = `blur(${round(state.blur, 3)}px)`;
  if (state.iris !== null && state.iris !== undefined) style.clipPath = `circle(${round(state.iris, 2)}px at 50% 50%)`;
  return style;
}

/** One tween property → GSAP vars (`blur` and `iris` become filter / clipPath strings). */
export function gsapVars(prop, value) {
  if (prop === 'blur') return { filter: `blur(${round(value, 3)}px)` };
  if (prop === 'iris') return { clipPath: `circle(${round(value, 2)}px at 50% 50%)` };
  return { [prop]: value };
}

/**
 * Render windows for every scene of a resolved story.
 * → {scenes: [{id, index, scene, track, plate, start, end, renderEnd, transitionIn, tweens}], loop}
 *   scenes are sorted by track, then start (back-to-front drawing order).
 *   transitionIn: {type, dur, direction, from_object} | null
 *   tweens: absolute tweens for this layer ({...Tween, at, role: "in"|"out"})
 * plus `loop`: {sceneId, start, end, transitionIn, tweens} | null (the ending).
 */
export function sceneWindows(story) {
  const format = story?.format ?? {};
  const width = format.width, height = format.height;
  const duration = Number(story?.resolved?.duration ?? format.duration);
  const fps = Number(story?.resolved?.fps ?? format.fps ?? 30);
  const scenes = (Array.isArray(story?.scenes) ? story.scenes : []).map((scene, index) => {
    if (typeof scene?.start !== 'number' || typeof scene?.end !== 'number') throw new Error(`sceneWindows needs a resolved story; scenes[${index}] has unresolved start/end`);
    const track = Number.isInteger(scene.track) ? scene.track : 0;
    return { id: scene.id, index, scene, track, plate: track === 0, start: scene.start, end: scene.end, renderEnd: scene.end, transitionIn: null, tweens: [] };
  });
  const plates = scenes.filter((entry) => entry.plate).sort((a, b) => a.start - b.start || a.index - b.index);
  for (const entry of scenes) {
    const transition = entry.scene.in;
    if (!transition || typeof transition !== 'object') continue;
    const tweens = transitionTweens(transition, { width, height });
    entry.transitionIn = { type: tweens.type, dur: tweens.duration, direction: transition.direction ?? null, from_object: transition.from_object ?? null };
    entry.tweens.push(...tweens.in.map((tw) => ({ ...tw, at: entry.start + tw.start, role: 'in' })));
    if (!entry.plate || tweens.type === 'cut') continue;
    // Only an adjacent plate (gap of at most ADJACENT seconds) is carried
    // through the transition; after a gap the background shows instead.
    const previous = plates.filter((other) => other !== entry && other.start < entry.start - EPS && other.end <= entry.start + EPS && entry.start - other.end <= ADJACENT + EPS)
      .reduce((best, other) => (!best || other.end > best.end + EPS ? other : best), null);
    if (!previous) continue;
    previous.renderEnd = Math.max(previous.renderEnd, Math.min(duration, entry.start + tweens.duration));
    previous.tweens.push(...tweens.out.map((tw) => ({ ...tw, at: entry.start + tw.start, role: 'out' })));
  }
  for (const entry of scenes) entry.tweens.sort((a, b) => a.at - b.at);
  let loop = null;
  const ending = story?.ending;
  if (ending && typeof ending === 'object' && typeof ending.loop_to === 'string' && scenes.some((entry) => entry.id === ending.loop_to)) {
    const target = scenes.find((entry) => entry.id === ending.loop_to);
    if (ending.in && typeof ending.in === 'object') {
      const tweens = transitionTweens(ending.in, { width, height });
      const start = round(duration - tweens.duration, 6);
      loop = { sceneId: target.id, scene: target.scene, start, end: duration, transitionIn: { type: tweens.type, dur: tweens.duration, direction: ending.in.direction ?? null, from_object: ending.in.from_object ?? null },
        tweens: tweens.in.map((tw) => ({ ...tw, at: start + tw.start, role: 'in' })) };
      const last = plates.reduce((best, entry) => (!best || entry.end >= best.end ? entry : best), null);
      if (last && tweens.type !== 'cut') {
        last.tweens.push(...tweens.out.map((tw) => ({ ...tw, at: start + tw.start, role: 'out' })));
        last.tweens.sort((a, b) => a.at - b.at);
      }
    } else {
      // No typed ending: the last frame returns to the loop scene's first state.
      loop = { sceneId: target.id, scene: target.scene, start: round(duration - 1 / fps, 6), end: duration, transitionIn: { type: 'cut', dur: 0, direction: null, from_object: null }, tweens: [] };
    }
  }
  scenes.sort((a, b) => a.track - b.track || a.start - b.start || a.index - b.index);
  return { scenes, loop };
}

function round(value, digits = 3) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
