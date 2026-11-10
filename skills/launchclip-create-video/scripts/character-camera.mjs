// The camera inside a character story's shots. A cast scene that names no
// zooms of its own gets one slow move for as long as it is up, so a planned
// character story is never a row of still frames between cuts:
//
//   speaker   a slow push-in on the character who speaks
//   wide      a gentle drift across a wide shot (with a touch of push)
//   reaction  a punch-in on a character who only listens, then a slow creep
//
// Which one follows from the storyboard alone (the shot, who says a line),
// so the planner adds nothing; a scene's own `zooms` replace it and
// story.camera.moves: false turns it off.
//
// The moves are keys in the shape shotZooms returns (kit/core/zooms.mjs:
// {start, duration, ease, from: {x, y, s}, to: {x, y, s}}), so both
// compilers play them through the code that plays a shot's zooms: camera
// moves in world mode (camera-world.mjs: parallax, the world backdrops and
// velocity blur follow), a scale over a translate around the scene in cuts
// mode. Frame-pure and seek-safe: every key is an absolute from → to.
//
// Feel: every move eases in, travels and eases out (slow, fast, slow), with
// no overshoot. A slow move is three keys with one velocity through the
// joins: power1.in up to the cruising speed, linear, power1.out down from it.
// The punch-in is one key on the grammar's camera ease, and the only one
// fast enough for the camera's velocity blur to show at its peak.
//
// A move starts and ends on a cut, so it needs no rest at either end. A scene
// that arrives or leaves on anything but a cut (a dissolve, a camera move
// between plates) keeps the camera at rest, as before.
//
// Imports only kit/core siblings.

import { CAST_MODULES, isCharacterStory } from './character-story.mjs';
import { defaultShot } from './characters/framing.mjs';
import { resolveGrammar } from './grammar.mjs';

export const CHARACTER_CAMERA = Object.freeze({
  // The scale a slow move adds each second, and the least and most a whole move adds.
  rate: 0.028, min: 0.045, max: 0.12,
  // A wide shot's drift: the scale it sits at (room to travel inside the plate),
  // how far it travels each second and at most (shares of the canvas width).
  wide: Object.freeze({ scale: 1.05, travel: 0.02, most: 0.044, push: 0.4 }),
  // A reaction's punch-in: the scale it lands at and how long it takes.
  punch: Object.freeze({ scale: 1.07, seconds: 0.42 }),
  // The ramps of a slow move: this long, and at most this share of the move.
  ramp: Object.freeze({ seconds: 0.3, share: 0.25 }),
  // A scene shorter than this keeps the camera at rest.
  shortest: 0.8
});

const round = (value, digits = 6) => { const f = 10 ** digits; return Math.round(value * f) / f + 0; };
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const cutIn = (scene) => scene?.in === undefined || scene?.in === null || scene.in === 'cut' || scene.in?.type === 'cut';

/** Whether a story's cast scenes take the default moves: a character story that has not turned them off. */
export function characterCameraOn(story) {
  return isCharacterStory(story) && story?.camera?.moves !== false;
}

/**
 * The move a track-0 scene of a character story takes by default:
 * 'speaker' | 'wide' | 'reaction', or null (not a cast scene or a world
 * plate, has its own zooms, too short, or does not arrive and leave on a cut).
 */
export function characterMove(story, scene) {
  if (!characterCameraOn(story) || !isObject(scene) || (scene.track ?? 0) !== 0) return null;
  if (Array.isArray(scene.zooms) && scene.zooms.length) return null;
  const start = Number(scene.start), end = Number(scene.end);
  if (!(end - start >= CHARACTER_CAMERA.shortest)) return null;
  const plates = (Array.isArray(story.scenes) ? story.scenes : []).filter((item) => (item?.track ?? 0) === 0).sort((a, b) => Number(a.start) - Number(b.start));
  const next = plates[plates.indexOf(scene) + 1];
  if (!cutIn(scene) || (next && !cutIn(next))) return null;
  // The last scene hands over to the ending (a loop back to the hook is a move of its own).
  if (!next && story.ending) return null;
  if (scene.module === 'world') return 'wide';
  if (!CAST_MODULES.includes(scene.module)) return null;
  const cast = Array.isArray(scene.params?.cast) ? scene.params.cast : scene.module === 'character-cameo' ? [scene.params ?? {}] : [];
  const walks = cast.some((actor) => actor?.pose === 'walk' || (Array.isArray(actor?.cues) && actor.cues.some((cue) => cue?.action === 'walk-to' || cue?.pose === 'walk')));
  const canvas = { width: Number(story.format?.width), height: Number(story.format?.height) };
  const shot = scene.params?.shot ?? (scene.module === 'character-cameo' ? 'wide' : walks ? 'wide' : defaultShot(scene.params?.set, canvas));
  if (shot === 'wide') return 'wide';
  return cast.some((actor) => actor?.says !== undefined && actor.says !== null && actor.says !== false) ? 'speaker' : 'reaction';
}

// A slow move from → to over [start, start + seconds]: ease in, cruise, ease out, one velocity through the joins.
function slowKeys(start, seconds, from, to) {
  const ramp = Math.min(CHARACTER_CAMERA.ramp.seconds, seconds * CHARACTER_CAMERA.ramp.share);
  // Distance shares: each ramp covers half of what the cruise covers in the same time.
  const edge = ramp / (2 * (seconds - ramp));
  const at = (k) => ({ x: round(from.x + (to.x - from.x) * k, 4), y: round(from.y + (to.y - from.y) * k, 4), s: round(from.s + (to.s - from.s) * k) });
  const a = at(edge), b = at(1 - edge);
  return [
    { start: round(start), duration: round(ramp), ease: 'power1.in', from: at(0), to: a },
    { start: round(start + ramp), duration: round(seconds - 2 * ramp), ease: 'none', from: a, to: b },
    { start: round(start + seconds - ramp), duration: round(ramp), ease: 'power1.out', from: b, to: at(1) }
  ];
}

/**
 * The default camera keys of one scene of a character story, in shotZooms'
 * shape, or [] (characterMove is null). index: the scene's place among the
 * story's plates (a wide shot drifts right on even places, left on odd).
 * The last key puts the camera back at rest as the scene ends, so the next
 * shot starts from its own framing.
 */
export function characterKeys(story, scene) {
  const move = characterMove(story, scene);
  if (!move) return [];
  const W = Number(story.format.width), H = Number(story.format.height);
  if (!(W > 0 && H > 0)) return [];
  const C = CHARACTER_CAMERA;
  const start = Number(scene.start), end = Number(scene.end), seconds = end - start;
  const rest = { x: W / 2, y: H / 2, s: 1 };
  const push = (time) => clamp(C.rate * time, C.min, C.max);
  const plates = (story.scenes ?? []).filter((item) => (item?.track ?? 0) === 0).sort((a, b) => Number(a.start) - Number(b.start));
  let keys;
  if (move === 'wide') {
    const s0 = C.wide.scale, s1 = round(s0 + push(seconds) * C.wide.push);
    // Travel across, kept inside the plate at the smaller scale.
    const room = (W / 2) * (1 - 1 / s0);
    const half = Math.min(room, (clamp(C.wide.travel * seconds, 0, C.wide.most) * W) / 2);
    const dir = plates.indexOf(scene) % 2 === 0 ? 1 : -1;
    keys = slowKeys(start, seconds, { x: W / 2 - dir * half, y: H / 2, s: s0 }, { x: W / 2 + dir * half, y: H / 2, s: s1 });
  } else if (move === 'speaker') {
    keys = slowKeys(start, seconds, rest, { ...rest, s: round(1 + push(seconds)) });
  } else {
    const { ease } = { ease: resolveGrammar(story).ease.camera };
    const landed = { ...rest, s: C.punch.scale };
    const punch = Math.min(C.punch.seconds, seconds / 3);
    keys = [{ start: round(start), duration: round(punch), ease, from: rest, to: landed }, ...slowKeys(start + punch, seconds - punch, landed, { ...rest, s: round(C.punch.scale + push(seconds - punch) * 0.6) })];
  }
  return [...keys, { start: round(end), duration: round(1 / 30), ease: 'none', from: rest, to: rest }];
}
