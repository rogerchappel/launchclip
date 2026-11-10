// The camera inside a character story's shots. A cast scene that names no
// zooms of its own gets one slow move for as long as it is up, so a planned
// character story is never a row of still frames between cuts:
//
//   speaker   a slow push-in on the character who speaks, rising to the face
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
// Feel: every move is slow, fast, slow, with no overshoot. A slow move
// starts and ends on a cut, so it never stops: it climbs from 40% of its
// cruising speed to all of it over 0.32 s, cruises, and comes back down the
// same way (slowKeys). The punch-in is one key on the grammar's camera ease,
// from rest, and the only one fast enough for the camera's velocity blur to
// show at its peak. In cuts mode a scene zooms inside its own layer, so it
// moves through any transition but a camera move between plates. Under the
// world camera (one camera for every plate) it moves only between cuts, or
// transitions short enough to read as cuts; elsewhere the camera rests, as
// before.
//
// How much: the finish motion gate calls a frame pair still when its mean
// change is under 0.4 grey levels on a 72 px grid, and fails a render with
// more than a tenth of them. On flat drawn worlds a push changes few pixels
// (only edges move, and less near the centre), so a move travels along the
// long side as well as pushing: about 3.3% of it a second.
//
// Imports only kit/core siblings.

import { CAST_MODULES, isCharacterStory } from './character-story.mjs';
import { defaultShot } from './characters/framing.mjs';
import { resolveGrammar } from './grammar.mjs';
import { isCameraTransition } from './transitions.mjs';

export const CHARACTER_CAMERA = Object.freeze({
  // A slow move travels this share of the canvas's long side each second,
  // along that side (up the frame in 9:16, across it in 16:9), and pushes in
  // by this much scale each second, at most `most` in all.
  travel: 0.033, push: 0.025, most: 0.1,
  // The shot starts a little closer than its framing, so the travel has room
  // inside the plate: at least `closer`, at most `closest`.
  closer: 1.05, closest: 1.14,
  // A wide shot's drift also crosses the short side by this share of its room.
  across: 0.8,
  // A reaction's punch-in from the shot's own framing: how long it takes.
  punch: 0.42,
  // A slow move's ramps: this long (at most a quarter of the move), in `steps`
  // even steps of speed from `slow` (a share of the cruising speed) up to it.
  ramp: Object.freeze({ seconds: 0.32, share: 0.25, steps: 4, slow: 0.4 }),
  // A scene shorter than this keeps the camera at rest.
  shortest: 0.8,
  // A transition this short or shorter reads as a cut.
  cutLike: 0.2
});

const round = (value, digits = 6) => { const f = 10 ** digits; return Math.round(value * f) / f + 0; };
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
// The world camera is one camera for every plate; in cuts mode each scene zooms inside its own layer.
const worldMode = (story) => story?.camera?.mode === 'world' && story?.lane !== 'footage-led';
const transitionOf = (scene) => (typeof scene?.in === 'string' ? { type: scene.in } : isObject(scene?.in) ? scene.in : null);
const cameraIn = (story, scene) => isCameraTransition(transitionOf(scene), worldMode(story) ? 'world' : 'cuts');
// A cut, or a transition short enough to read as one (a 0.1 s push-blur).
const cutIn = (scene) => { const t = transitionOf(scene); return !t || t.type === 'cut' || Number(t.dur) <= CHARACTER_CAMERA.cutLike; };
// Whether a scene may move as it arrives: never on a camera move between plates (the plates travel at rest);
// under the world camera only on a cut; inside its own layer (cuts mode) on any other transition.
const movesIn = (story, scene) => !cameraIn(story, scene) && (!worldMode(story) || cutIn(scene));

/** Whether a story's cast scenes take the default moves: a character story that has not turned them off. */
export function characterCameraOn(story) {
  return isCharacterStory(story) && story?.camera?.moves !== false;
}

/**
 * The move a track-0 scene of a character story takes by default:
 * 'speaker' | 'wide' | 'reaction', or null: not a cast scene (a `world` plate
 * moves with its own params.camera); has its own zooms; too short; it or the
 * next plate arrives on a camera move between plates; or, under the world
 * camera, on anything but a cut (or a transition of 0.2 s or less).
 */
export function characterMove(story, scene) {
  if (!characterCameraOn(story) || !isObject(scene) || (scene.track ?? 0) !== 0) return null;
  if (Array.isArray(scene.zooms) && scene.zooms.length) return null;
  const start = Number(scene.start), end = Number(scene.end);
  if (!(end - start >= CHARACTER_CAMERA.shortest)) return null;
  const plates = (Array.isArray(story.scenes) ? story.scenes : []).filter((item) => (item?.track ?? 0) === 0).sort((a, b) => Number(a.start) - Number(b.start));
  const next = plates[plates.indexOf(scene) + 1];
  if (!movesIn(story, scene) || (next && !movesIn(story, next))) return null;
  // A last scene that loops back to the hook hands over to that move.
  if (!next && typeof story.ending?.loop_to === 'string') return null;
  if (!CAST_MODULES.includes(scene.module)) return null;
  const cast = Array.isArray(scene.params?.cast) ? scene.params.cast : scene.module === 'character-cameo' ? [scene.params ?? {}] : [];
  const walks = cast.some((actor) => actor?.pose === 'walk' || (Array.isArray(actor?.cues) && actor.cues.some((cue) => cue?.action === 'walk-to' || cue?.pose === 'walk')));
  const canvas = { width: Number(story.format?.width), height: Number(story.format?.height) };
  const shot = scene.params?.shot ?? (scene.module === 'character-cameo' ? 'wide' : walks ? 'wide' : defaultShot(scene.params?.set, canvas));
  if (shot === 'wide') return 'wide';
  return cast.some((actor) => actor?.says !== undefined && actor.says !== null && actor.says !== false) ? 'speaker' : 'reaction';
}

// A slow move from → to over [start, start + seconds]: slow, fast, slow.
// It starts and ends on a cut, so it never stops: each ramp climbs from
// ramp.slow of the cruising speed to all of it in ramp.steps even steps, each
// a linear key (a staircase of speed whose steps are too small to see), and
// the cruise between them is one linear key. Linear keys chain exactly, so
// the move is the same whichever way the timeline is sought.
function slowKeys(start, seconds, from, to) {
  const R = CHARACTER_CAMERA.ramp;
  const ramp = Math.min(R.seconds, seconds * R.share);
  const step = ramp / R.steps;
  // Speeds as shares of the cruise: the ramp's steps, the cruise, the steps back down.
  const up = Array.from({ length: R.steps }, (_, i) => R.slow + ((1 - R.slow) * i) / R.steps);
  const parts = [...up.map((speed) => ({ seconds: step, speed })), { seconds: seconds - 2 * ramp, speed: 1 }, ...[...up].reverse().map((speed) => ({ seconds: step, speed }))];
  const total = parts.reduce((sum, part) => sum + part.seconds * part.speed, 0);
  const at = (k) => ({ x: round(from.x + (to.x - from.x) * k, 4), y: round(from.y + (to.y - from.y) * k, 4), s: round(from.s + (to.s - from.s) * k) });
  const keys = [];
  let time = start, done = 0;
  for (const part of parts) {
    const next = done + (part.seconds * part.speed) / total;
    keys.push({ start: round(time), duration: round(part.seconds), ease: 'none', from: at(done), to: at(Math.min(1, next)) });
    time += part.seconds;
    done = next;
  }
  keys.at(-1).to = at(1);
  return keys;
}

/**
 * The default camera keys of one scene of a character story, in shotZooms'
 * shape, or [] (characterMove is null).
 *
 * Every move starts a little closer than the shot's framing and travels
 * along the canvas's long side while it pushes in: up toward the face on a
 * speaker or a reaction in 9:16 (across in 16:9, toward the side the plate's
 * place gives), and on a wide shot across both sides at once, a drift, its
 * direction alternating with the plate's place in the story. A reaction
 * first punches in from the shot's own framing on the grammar's camera ease.
 * When the next shot has no move of its own, a last key puts the camera back
 * at rest as the scene ends, so that shot starts from its own framing.
 */
export function characterKeys(story, scene) {
  const move = characterMove(story, scene);
  if (!move) return [];
  const W = Number(story.format.width), H = Number(story.format.height);
  if (!(W > 0 && H > 0)) return [];
  const C = CHARACTER_CAMERA;
  const start = Number(scene.start), end = Number(scene.end);
  const rest = { x: W / 2, y: H / 2, s: 1 };
  const plates = (story.scenes ?? []).filter((item) => (item?.track ?? 0) === 0).sort((a, b) => Number(a.start) - Number(b.start));
  const turn = plates.indexOf(scene) % 2 === 0 ? 1 : -1;
  const punch = move === 'reaction' ? Math.min(C.punch, (end - start) / 3) : 0;
  const seconds = end - start - punch;
  const portrait = H > W;
  const long = Math.max(W, H);
  // How far it travels, and the scale that gives that much room inside the plate.
  const s0 = clamp(1 / (1 - (C.travel * seconds)), C.closer, C.closest);
  const s1 = round(s0 + Math.min(C.most, C.push * seconds));
  const room = (side) => (side / 2) * (1 - 1 / s0);
  const half = Math.min(room(long), (C.travel * seconds * long) / 2);
  // Along the long side: a speaker and a reaction rise to the face in 9:16; a wide shot alternates.
  const along = portrait ? (move === 'wide' ? turn : -1) * half : turn * half;
  const across = move === 'wide' ? turn * room(Math.min(W, H)) * C.across * (portrait ? 1 : -1) : 0;
  const point = (k) => (portrait ? { x: W / 2 + k * across, y: H / 2 + k * along } : { x: W / 2 + k * along, y: H / 2 + k * across });
  // After its punch-in a reaction creeps on from the centre it landed on.
  const from = { ...point(punch ? 0 : -1), s: round(s0) }, to = { ...point(1), s: s1 };
  const keys = [];
  if (punch) keys.push({ start: round(start), duration: round(punch), ease: resolveGrammar(story).ease.camera, from: rest, to: from });
  keys.push(...slowKeys(start + punch, seconds, from, to));
  // Under the world camera: back at rest as the scene ends, unless the next shot's own move takes over on
  // the cut. A scene that zooms inside its own layer (cuts mode) holds where it ended while the next arrives.
  const next = plates[plates.indexOf(scene) + 1];
  if (!worldMode(story) || (next && characterMove(story, next))) return keys;
  return [...keys, { start: round(end), duration: round(1 / 30), ease: 'none', from: rest, to: rest }];
}
