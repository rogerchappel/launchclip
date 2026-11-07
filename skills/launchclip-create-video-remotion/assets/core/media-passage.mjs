// How a media scene arrives and leaves (photo-scene, evidence-clip,
// product-demo and set-prop; clip has its own enter/exit grammar): from the
// scene's typed transitions, not a fixed fade.
//
// A media scene that fades itself under a cut dips to the background for a
// few frames while anything on a higher track (a character, a card) stays
// solid and seems to float; one that opens the video at opacity 0 leaves
// frame 0 nearly empty. So:
// - enter: params.enter wins. Otherwise a scene on the video's first frame,
//   one with a typed `in` (a cut is a cut; any other transition dresses the
//   scene's layer itself) and a plate cut straight after the previous plate
//   are whole on their first frame. Anything else fades in as before.
// - exit: params.exit wins. Otherwise a plate followed straight away by the
//   next plate leaves with that change (a cut, or the next plate's own
//   transition). Anything else fades out as before.
//
// ctx.passage (kit/core/modules.mjs) carries what the module needs from the
// story: {in, out, after, opening, track}.

export const MEDIA_PASSAGES = Object.freeze(['cut', 'fade']);
const NEAR = 0.05;

const typed = (transition) => (transition && typeof transition === 'object' && typeof transition.type === 'string'
  ? {type: transition.type, dur: Number(transition.dur) || 0} : null);

/**
 * What a scene's entrance and exit meet in the story. → {in: {type, dur} |
 * null (its own typed transition), out: {type, dur} | null (the next plate's
 * transition, a cut when it has none; null when no plate follows straight
 * away), after: boolean (a plate ends where this one starts), opening:
 * boolean (on the first frame), track} | null.
 */
export function scenePassage(story, scene) {
  const start = Number(scene?.start), end = Number(scene?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const fps = Number(story?.resolved?.fps ?? story?.format?.fps) || 30;
  const track = Number.isInteger(scene.track) ? scene.track : 0;
  const plates = (Array.isArray(story?.scenes) ? story.scenes : [])
    .filter((other) => other && other !== scene && other.id !== scene.id && (other.track ?? 0) === 0 && Number.isFinite(Number(other.start)) && Number.isFinite(Number(other.end)));
  const plate = track === 0;
  const next = plate ? plates.find((other) => Math.abs(Number(other.start) - end) < NEAR) : null;
  const after = plate && plates.some((other) => Number(other.start) < start - 1e-6 && Math.abs(Number(other.end) - start) < NEAR);
  return {in: typed(scene.in), out: next ? (typed(next.in) ?? {type: 'cut', dur: 0}) : null, after, opening: start <= 1 / fps + 1e-6, track};
}

/**
 * The entrance and exit of a media scene: {enter, exit}, each cut | fade.
 * enter / exit are the scene's params (already validated), or undefined.
 */
export function mediaPassage(ctx, {enter, exit} = {}) {
  const p = ctx?.passage ?? null;
  return {
    enter: enter ?? (p && (p.opening || p.in || p.after) ? 'cut' : 'fade'),
    exit: exit ?? (p?.out ? 'cut' : 'fade')
  };
}

/** Read params.enter / params.exit (cut | fade) with the module's check. */
export function passageParams(check, params) {
  return {
    enter: params.enter === undefined ? undefined : check.oneOf(params.enter, 'params.enter', MEDIA_PASSAGES),
    exit: params.exit === undefined ? undefined : check.oneOf(params.exit, 'params.exit', MEDIA_PASSAGES)
  };
}

export const PASSAGE_PARAMS = Object.freeze({
  enter: 'cut | fade: how the scene arrives (default: whole on its first frame when it opens the video, has a typed `in` transition or cuts straight from the previous plate; else a fade)',
  exit: 'cut | fade: how the scene leaves (default: with the change when the next plate starts where it ends; else a fade)'
});
