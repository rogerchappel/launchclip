// Typed scene transitions and scene render windows, shared by the HyperFrames
// compiler (as GSAP fromTo calls) and the Remotion StoryComposition (evaluated
// per frame through motion.mjs), so both renderers move the same layers by
// the same amounts with the same eases. Plain ESM; imports only grammar.mjs.
// Canonical copy: kit/core/transitions.mjs.
//
// Model: every track-0 scene is an opaque plate (brand background). A scene's
// `in` transition runs over [scene.start, scene.start + in.dur]. The previous
// track-0 scene stays on screen underneath until the transition settles (its
// render window is extended, because the validator forbids same-track
// overlap), and receives the matching "out" tweens. Scenes on higher tracks
// are transparent overlays and only receive "in" tweens.
//
// Motion grammar (kit/core/grammar.mjs): the tween eases follow the story's
// grammar; editorial keeps every ease below exactly.
// Camera transitions (pan, pull, orbit, whip-pan, and push when camera.mode
// is "world") move the camera, not the layers (kit/core/camera-world.mjs):
// here they only hold the outgoing plate and add the crossfades a dolly
// needs. In world mode plates are transparent, so layered transitions (fade,
// zoom, iris) also fade the outgoing plate out.
//
// Movement grammar transitions (docs/KIT_CONTRACTS.md, "Shot states"):
// rack-focus (the outgoing card blurs back while the incoming one sharpens
// forward; the default between builds), glow-wipe (a straight wipe that flares
// bright at the edge, for chapter breaks) and card-to-card (the incoming card
// starts on the outgoing card's rect, params.rect or the canvas, and settles
// on its own).
//
// Empty plates: a short gap between two plates (a gap in scene timing, plus
// any lead-in before the next scene draws anything, sceneLeadIn) would show a
// dead frame. When that whole span is under HOLD_GAP seconds the previous
// plate is held on screen through it (its render window ends where the next
// scene's content starts); longer gaps are reported by emptyPlates() and show
// the background.

import { grammarEase, resolveGrammar } from './grammar.mjs';

export const TRANSITION_TYPES = Object.freeze(['cut', 'fade', 'push', 'whip', 'zoom', 'iris', 'morph', 'pan', 'pull', 'orbit', 'whip-pan', 'rack-focus', 'glow-wipe', 'card-to-card', 'overview']);
/** Transitions that carry the card: its module rests (whole) at both ends instead of fading (kit/core/modules.mjs). */
export const CARRY_TRANSITIONS = Object.freeze(['rack-focus', 'card-to-card']);
export const CAMERA_TRANSITION_TYPES = Object.freeze(['pan', 'pull', 'orbit', 'whip-pan']);

/** Whether a transition moves the world camera (push and overview only in world mode). */
export function isCameraTransition(transition, mode = 'cuts') {
  const type = transition?.type;
  return CAMERA_TRANSITION_TYPES.includes(type) || ((type === 'push' || type === 'overview') && mode === 'world');
}

/**
 * The overview move (world mode): the camera pulls back to frame the last
 * shots and the incoming one, holds, then pushes into the incoming shot.
 * minDur: the shortest overview (s); gap: the least time between two (s);
 * span: the shots it frames when a number; cap: the most the camera zooms out
 * past the incoming shot's rest (past it the framed span shrinks, oldest
 * first); margin: the share of the frame left around the framed shots.
 */
export const OVERVIEW = Object.freeze({ minDur: 2, gap: 60, span: Object.freeze({ min: 3, max: 8 }), cap: 6, margin: 0.08, hold: 0.6 });

/**
 * The shots an overview into plates[index] frames, oldest first, the
 * incoming one excluded: span "chapter" is every plate of the chapter that is
 * ending (story.chapters: the last chapter starting at or before the previous
 * plate; without chapters, every earlier plate), a number n the last n
 * plates; at most OVERVIEW.span.max either way. plates: track-0 window
 * entries in start order. → [entry]
 */
export function overviewSpan(story, plates, index) {
  const transition = plates[index]?.scene?.in;
  const before = plates.slice(0, index);
  if (!before.length) return [];
  let list = before;
  if (transition?.span === 'chapter' || transition?.span === undefined) {
    const previous = before.at(-1);
    const starts = (Array.isArray(story?.chapters) ? story.chapters : []).map((chapter) => Number(chapter?.start)).filter((start) => Number.isFinite(start) && start <= previous.start + EPS);
    if (starts.length) { const from = Math.max(...starts); list = before.filter((entry) => entry.start >= from - EPS); }
  } else if (Number.isInteger(transition.span)) list = before.slice(-transition.span);
  return list.slice(-OVERVIEW.span.max);
}

/**
 * Identity state of a scene layer. iris: null = no clip; wipeT/R/B/L: percent
 * insets of a straight-edged clip (null = none); glow: extra brightness (0 =
 * none, 0.8 = brightness(1.8)); rackIn: a rack-focus card arriving, 1 → 0
 * (blur(RACK.blurIn × v) brightness(1 + RACK.lift × v) in one filter, so the
 * two never overwrite each other in GSAP).
 */
export const LAYER_IDENTITY = Object.freeze({ opacity: 1, x: 0, y: 0, scale: 1, blur: 0, iris: null, wipeT: null, wipeR: null, wipeB: null, wipeL: null, glow: 0, rackIn: 0 });
const WIPE_PROPS = ['wipeT', 'wipeR', 'wipeB', 'wipeL'];

const EPS = 1e-6;
const ADJACENT = 0.1;
/** Empty spans shorter than this (seconds) are covered by holding the previous plate. */
export const HOLD_GAP = 0.5;

// Seconds after its start before a scene's module draws anything, read from
// its params (no module resolution, so every caller of sceneWindows agrees).
// kinetic-words draws nothing until its first beat; a beat at or before the
// first frame is settled on frame 0 (catalog-a.mjs).
const LEAD_IN = {
  'kinetic-words': (params, fps) => {
    const at = Number(params?.words?.[0]?.at);
    return Number.isFinite(at) && at > 1 / fps + EPS ? at : 0;
  }
};

/** Seconds from a scene's start until its module first draws content. */
export function sceneLeadIn(scene, fps = 30) {
  const rule = LEAD_IN[scene?.module];
  const lead = rule ? rule(scene?.params ?? {}, fps) : 0;
  const length = Number(scene?.end) - Number(scene?.start);
  return Number.isFinite(lead) && lead > 0 ? Math.min(lead, Number.isFinite(length) ? length : lead) : 0;
}

// rack-focus: blur (px) and scale of the card racked out of focus.
// The change lands in its first frames (expo.out), so a viewer and a scene
// detector both read it as an event.
const RACK = Object.freeze({ blurIn: 22, scaleIn: 1.08, blurOut: 26, scaleOut: 0.9, lift: 0.45 });
// glow-wipe: peak extra brightness at the wipe edge.
const GLOW_WIPE = 0.85;

/**
 * Layer transform (pivoting on the canvas centre) that puts rect `a`'s centre
 * where rect `b`'s is and scales it to b's area. Null or equal rects → identity.
 */
export function cardMap(a, b, width, height) {
  if (!a || !b || !(a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0)) return { x: 0, y: 0, scale: 1 };
  const scale = round(Math.sqrt((b.width * b.height) / (a.width * a.height)), 4);
  const cx = width / 2, cy = height / 2;
  const x = round(b.x + b.width / 2 - cx - scale * (a.x + a.width / 2 - cx), 2);
  const y = round(b.y + b.height / 2 - cy - scale * (a.y + a.height / 2 - cy), 2);
  return { x, y, scale };
}

/** A scene's card rect for card-to-card: params.rect when the scene sets one, else the canvas. */
export function sceneCardRect(scene, width, height) {
  const r = scene?.params?.rect;
  return r && [r.x, r.y, r.width, r.height].every(Number.isFinite) ? r : { x: 0, y: 0, width, height };
}

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
export function transitionTweens(transition, { width, height, grammar = null, mode = 'cuts', fromRect = null, toRect = null }) {
  const type = transition?.type ?? 'cut';
  const d = Number(transition?.dur ?? 0);
  const direction = transition?.direction ?? 'left';
  if (!TRANSITION_TYPES.includes(type)) throw new Error(`unknown transition type ${JSON.stringify(type)}`);
  const roles = ['enter', 'exit', 'emphasis', 'move'];
  const t = (prop, from, to, ease, start = 0, duration = d) => ({ prop, from, to, start, duration, ease: grammarEase(grammar, ease, { props: [prop], roles }) });
  if (type === 'cut' || !(d > 0)) return { type: 'cut', duration: 0, in: [], out: [] };
  // Overview outside world mode (validation refuses it): a plain crossfade.
  if (type === 'overview' && mode !== 'world') return { type: 'fade', duration: d, in: [t('opacity', 0, 1, 'power1.inOut')], out: [] };
  if (isCameraTransition(transition, mode)) {
    // The camera travels (camera-world.mjs). A dolly lands on a scene drawn
    // inside (push) or around (pull) the outgoing one, so the two plates
    // crossfade while the camera moves.
    // The outgoing plate is gone before the object it zooms into fills the
    // frame, so its magnified content never sits on top of the new scene.
    if (type === 'push') return { type, duration: d, camera: true, in: [t('opacity', 0, 1, 'power1.inOut', d * 0.15, d * 0.45)], out: [t('opacity', 1, 0, 'power1.inOut', d * 0.3, d * 0.35)] };
    if (type === 'pull') return { type, duration: d, camera: true, in: [t('opacity', 0, 1, 'power1.inOut', 0, d * 0.5)], out: [t('opacity', 1, 0, 'power1.inOut', d * 0.3, d * 0.7)] };
    return { type, duration: d, camera: true, in: [], out: [] };
  }
  // World mode: plates are transparent, so a layered reveal also fades the
  // outgoing plate (cuts mode covers it with the incoming opaque plate).
  const fadeOut = mode === 'world' ? [t('opacity', 1, 0, 'power1.inOut')] : [];
  const axis = direction === 'up' || direction === 'down' ? 'y' : 'x';
  const span = axis === 'x' ? width : height;
  // "left" = the content travels left: the incoming plate enters from the right.
  const sign = direction === 'left' || direction === 'up' ? -1 : 1;
  switch (type) {
    case 'fade':
      return { type, duration: d, in: [t('opacity', 0, 1, 'power1.inOut')], out: fadeOut };
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
      return { type, duration: d, in: [t('scale', 0.6, 1, 'power3.out'), t('opacity', 0, 1, 'power2.out', 0, d * 0.6)], out: [t('scale', 1, 1.5, 'power3.in'), ...fadeOut] };
    case 'iris':
      return { type, duration: d, in: [t('iris', 0, irisRadius(width, height), 'power2.inOut')], out: fadeOut };
    case 'rack-focus':
      // The outgoing card blurs back into the plate while the incoming one
      // sharpens forward: depth of field racks from one to the other.
      // Both cards move at once and most of the move lands in the first frames:
      // the new card is there within a few frames, blurred and lifted, and
      // then pulls sharp while the old one falls back under it.
      return { type, duration: d,
        in: [t('rackIn', 1, 0, 'expo.out'), t('scale', RACK.scaleIn, 1, 'expo.out'), t('opacity', 0, 1, 'expo.out', 0, d * 0.25)],
        out: [t('blur', 0, RACK.blurOut, 'expo.out'), t('scale', 1, RACK.scaleOut, 'expo.out'), t('opacity', 1, 0, 'power2.out', d * 0.2, d * 0.8)] };
    case 'glow-wipe': {
      // Chapter break: a straight wipe in the travel direction, with the
      // frame flaring bright at the edge and settling as the new plate lands.
      const side = { left: 'wipeL', right: 'wipeR', up: 'wipeT', down: 'wipeB' }[direction] ?? 'wipeL';
      return { type, duration: d,
        in: [t(side, 100, 0, 'power2.inOut'), t('glow', GLOW_WIPE, 0, 'power2.out', d * 0.35, d * 0.65)],
        out: [t('glow', 0, GLOW_WIPE, 'power2.in', 0, d * 0.6), ...fadeOut] };
    }
    case 'card-to-card': {
      // Morph continuity: the incoming card starts where the outgoing card
      // was (FLIP: same centre and area) and settles on its own rect, while
      // the outgoing card travels on to the incoming one's rect and fades.
      const there = cardMap(toRect, fromRect, width, height), back = cardMap(fromRect, toRect, width, height);
      const same = there.scale === 1 && there.x === 0 && there.y === 0;
      const inScale = same ? 0.97 : there.scale;
      return { type, duration: d,
        in: [t('opacity', 0, 1, 'power2.inOut', 0, d * 0.6), ...(there.x ? [t('x', there.x, 0, 'power3.inOut')] : []), ...(there.y ? [t('y', there.y, 0, 'power3.inOut')] : []), t('scale', inScale, 1, 'power3.inOut')],
        out: [t('opacity', 1, 0, 'power2.inOut', d * 0.2, d * 0.6), ...(back.x ? [t('x', 0, back.x, 'power3.inOut')] : []), ...(back.y ? [t('y', 0, back.y, 'power3.inOut')] : []), ...(same ? [] : [t('scale', 1, back.scale, 'power3.inOut')])] };
    }
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
  let clipped = false, wiped = false;
  for (const tw of tweens) {
    if (t < tw.at - EPS) continue;
    const p = tw.duration > 0 ? Math.min(1, Math.max(0, (t - tw.at) / tw.duration)) : 1;
    const value = tw.from + (tw.to - tw.from) * (p >= 1 ? 1 : getEase(tw.ease)(p));
    state[tw.prop] = value;
    if (tw.prop === 'iris') clipped = p < 1;
    if (WIPE_PROPS.includes(tw.prop)) wiped = p < 1;
  }
  // A finished iris or wipe covers the whole frame; drop the clip so the
  // layer is identical to an unclipped one.
  if (!clipped) state.iris = null;
  if (!wiped) for (const prop of WIPE_PROPS) state[prop] = null;
  return state;
}

/** Layer state → inline CSS values (camelCase, React style keys). */
export function layerStyle(state) {
  const style = { opacity: state.opacity };
  if (state.x || state.y || state.scale !== 1) style.transform = `translate(${round(state.x)}px, ${round(state.y)}px) scale(${round(state.scale, 5)})`;
  const filters = [];
  if (state.blur > 0.001) filters.push(`blur(${round(state.blur, 3)}px)`);
  if (state.rackIn > 0.0001) filters.push(...rackFilter(state.rackIn));
  if (state.glow > 0.001) filters.push(`brightness(${round(1 + state.glow, 4)})`);
  if (filters.length) style.filter = filters.join(' ');
  if (state.iris !== null && state.iris !== undefined) style.clipPath = `circle(${round(state.iris, 2)}px at 50% 50%)`;
  else if (WIPE_PROPS.some((prop) => state[prop] !== null && state[prop] !== undefined)) style.clipPath = wipeCss(state);
  return style;
}

/** A rack-focus arrival at v (1 → 0): its blur and its exposure lift, as filter functions. */
export function rackFilter(v) {
  return [`blur(${round(RACK.blurIn * v, 3)}px)`, `brightness(${round(1 + RACK.lift * v, 4)})`];
}

/** A wipe state → CSS inset() (unset edges are 0 %). */
export function wipeCss(state) {
  const edge = (prop) => `${round(Math.max(0, state[prop] ?? 0), 3)}%`;
  return `inset(${edge('wipeT')} ${edge('wipeR')} ${edge('wipeB')} ${edge('wipeL')})`;
}

/** One tween property → GSAP vars (`blur` and `iris` become filter / clipPath strings). */
export function gsapVars(prop, value) {
  if (prop === 'blur') return { filter: `blur(${round(value, 3)}px)` };
  if (prop === 'iris') return { clipPath: `circle(${round(value, 2)}px at 50% 50%)` };
  if (prop === 'glow') return { filter: `brightness(${round(1 + value, 4)})` };
  if (prop === 'rackIn') return { filter: rackFilter(value).join(' ') };
  if (WIPE_PROPS.includes(prop)) return { clipPath: wipeCss({ [prop]: value }) };
  return { [prop]: value };
}

/**
 * Render windows for every scene of a resolved story.
 * → {scenes: [{id, index, scene, track, plate, start, end, renderEnd, transitionIn, tweens, holds}], loop}
 *   scenes are sorted by track, then start (back-to-front drawing order).
 *   transitionIn: {type, dur, direction, from_object} | null (an overview
 *   adds span: [scene ids], oldest first, and hold: seconds)
 *   holds: [{start, end, overview}] spans after the scene's render window when
 *   it is drawn again, frozen (an overview frames it: overviewSpan). The
 *   previous plate is not held: like any outgoing plate it stays through the
 *   transition (renderEnd).
 *   tweens: absolute tweens for this layer ({...Tween, at, role: "in"|"out"})
 * plus `loop`: {sceneId, start, end, transitionIn, tweens} | null (the ending).
 */
export function sceneWindows(story) {
  const format = story?.format ?? {};
  const width = format.width, height = format.height;
  const duration = Number(story?.resolved?.duration ?? format.duration);
  const fps = Number(story?.resolved?.fps ?? format.fps ?? 30);
  const grammar = resolveGrammar(story);
  const mode = story?.camera?.mode === 'world' && story?.lane !== 'footage-led' ? 'world' : 'cuts';
  const options = { width, height, grammar, mode };
  const scenes = (Array.isArray(story?.scenes) ? story.scenes : []).map((scene, index) => {
    if (typeof scene?.start !== 'number' || typeof scene?.end !== 'number') throw new Error(`sceneWindows needs a resolved story; scenes[${index}] has unresolved start/end`);
    const track = Number.isInteger(scene.track) ? scene.track : 0;
    return { id: scene.id, index, scene, track, plate: track === 0, start: scene.start, end: scene.end, renderEnd: scene.end, transitionIn: null, tweens: [], holds: [] };
  });
  const plates = scenes.filter((entry) => entry.plate).sort((a, b) => a.start - b.start || a.index - b.index);
  const adjacentPlate = (entry) => plates.filter((other) => other !== entry && other.start < entry.start - EPS && other.end <= entry.start + EPS && entry.start - other.end <= ADJACENT + EPS)
    .reduce((best, other) => (!best || other.end > best.end + EPS ? other : best), null);
  for (const entry of scenes) {
    const transition = entry.scene.in;
    if (!transition || typeof transition !== 'object') continue;
    // card-to-card maps the outgoing card's rect onto the incoming one's.
    const before = entry.plate ? adjacentPlate(entry) : null;
    const tweens = transitionTweens(transition, transition.type === 'card-to-card' ? { ...options, fromRect: before ? sceneCardRect(before.scene, width, height) : null, toRect: sceneCardRect(entry.scene, width, height) } : options);
    entry.transitionIn = { type: tweens.type, dur: tweens.duration, direction: transition.direction ?? null, from_object: transition.from_object ?? null };
    if (tweens.camera) entry.transitionIn.camera = true;
    if (tweens.camera && transition.type === 'overview' && entry.plate) {
      // The span stays drawn, frozen, while the camera shows it from afar.
      const span = overviewSpan(story, plates, plates.indexOf(entry));
      entry.transitionIn.span = span.map((other) => other.id);
      entry.transitionIn.hold = round(Math.min(Number.isFinite(Number(transition.hold)) ? Number(transition.hold) : OVERVIEW.hold, d(transition) - 1), 6);
      const end = round(Math.min(duration, entry.start + tweens.duration), 6);
      for (const other of span) if (other !== before) other.holds.push({ start: entry.start, end, overview: entry.id });
    }
    entry.tweens.push(...tweens.in.map((tw) => ({ ...tw, at: entry.start + tw.start, role: 'in' })));
    if (!entry.plate || tweens.type === 'cut') continue;
    // Only an adjacent plate (gap of at most ADJACENT seconds) is carried
    // through the transition; after a gap the background shows instead.
    const previous = before;
    if (!previous) continue;
    previous.renderEnd = Math.max(previous.renderEnd, Math.min(duration, entry.start + tweens.duration));
    previous.tweens.push(...tweens.out.map((tw) => ({ ...tw, at: entry.start + tw.start, role: 'out' })));
  }
  // Hold the previous plate through a short empty span (timing gap plus the
  // next scene's lead-in), so the cut never shows a dead frame.
  for (let i = 1; i < plates.length; i += 1) {
    const entry = plates[i];
    const previous = plates.slice(0, i).filter((other) => other.end <= entry.start + EPS).reduce((best, other) => (!best || other.end > best.end + EPS ? other : best), null);
    if (!previous) continue;
    const lead = sceneLeadIn(entry.scene, fps), contentStart = entry.start + lead;
    const held = Math.max(previous.renderEnd, previous.end);
    // A transition that already carries the previous plate into this scene
    // owns the hand-over.
    if (held > entry.start + EPS) continue;
    if (!(contentStart - held > EPS && contentStart - previous.end < HOLD_GAP - EPS)) continue;
    previous.renderEnd = Math.min(duration, round(contentStart, 6));
    // The incoming plate is opaque: on a cut, keep it transparent through its
    // lead-in so the held plate shows, then show it as its content arrives. (A
    // layered transition in reveals the held plate by itself.)
    if (lead > EPS && entry.tweens.length === 0) {
      entry.tweens.push({ prop: 'opacity', from: 0, to: 0, start: 0, duration: round(lead, 6), ease: 'none', at: entry.start, role: 'hold' },
        { prop: 'opacity', from: 0, to: 1, start: 0, duration: 0, ease: 'none', at: round(contentStart, 6), role: 'hold' });
    }
  }
  for (const entry of scenes) entry.tweens.sort((a, b) => a.at - b.at);
  let loop = null;
  const ending = story?.ending;
  if (ending && typeof ending === 'object' && typeof ending.loop_to === 'string' && scenes.some((entry) => entry.id === ending.loop_to)) {
    const target = scenes.find((entry) => entry.id === ending.loop_to);
    if (ending.in && typeof ending.in === 'object') {
      const tweens = transitionTweens(ending.in, options);
      const start = round(duration - tweens.duration, 6);
      loop = { sceneId: target.id, scene: target.scene, start, end: duration, transitionIn: { type: tweens.type, dur: tweens.duration, direction: ending.in.direction ?? null, from_object: ending.in.from_object ?? null },
        tweens: tweens.in.map((tw) => ({ ...tw, at: start + tw.start, role: 'in' })) };
      if (tweens.camera) loop.transitionIn.camera = true;
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

/**
 * The time a held shot (window entry.holds) freezes at: its settled last
 * frame, one frame before its module starts to exit (model.motion.exitStart)
 * or before its render window ends.
 */
export function holdTime(entry, model, fps = 30) {
  const exit = Number(model?.motion?.exitStart);
  const end = Math.min(entry.renderEnd, Number.isFinite(exit) ? exit : entry.renderEnd);
  return round(Math.max(entry.start, end - 1 / fps), 6);
}

/**
 * Spans with no plate content on screen: from where one plate's render window
 * ends (or the story starts) to where the next plate's content starts (its
 * start plus sceneLeadIn), when longer than one frame. → [{from, to, before,
 * after}] (scene ids; before is null at the story start). Spans under HOLD_GAP
 * are normally covered by the hold in sceneWindows, so these are the gaps a
 * viewer sees as an empty plate.
 */
export function emptyPlates(story, windows = sceneWindows(story)) {
  const fps = Number(story?.resolved?.fps ?? story?.format?.fps ?? 30);
  const plates = windows.scenes.filter((entry) => entry.plate).sort((a, b) => a.start - b.start || a.index - b.index);
  const out = [];
  let shown = 0, before = null;
  for (const entry of plates) {
    const contentStart = entry.start + sceneLeadIn(entry.scene, fps);
    if (contentStart - shown > 1 / fps + EPS) out.push({ from: round(shown, 3), to: round(contentStart, 3), before, after: entry.id });
    if (entry.renderEnd > shown) { shown = entry.renderEnd; before = entry.id; }
  }
  return out;
}

const d = (transition) => Math.max(0, Number(transition?.dur) || 0);

function round(value, digits = 3) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
