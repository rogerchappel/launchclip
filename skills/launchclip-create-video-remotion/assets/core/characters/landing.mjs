// Camera landings in a cast scene (scene.zooms[].land, kit/core/zooms.mjs
// LAND): the subject a landing names, measured on the resolved cast-scene
// model, and the camera state that lands it on its screen anchor.
//
//   land  a character's id (its face: the head between crown and chin, at
//         the pose and place it has once the move ends), a world point
//         (far, window, horizon, street, skyline) or a prop id of the world
//         the scene draws itself
//   shot  the framing to land at (characters/framing.mjs: the face framed as
//         a single-character shot at that distance); a character only
//   scale the camera's scale (1–3) instead of a shot
//
// With neither, a landing takes the least scale that keeps the view inside
// the plate (a reveal across a wide set comes in just far enough to travel);
// in 9:16 a character lands at least at medium. While it holds, the camera
// follows a landed character that walks, crouches or changes pose
// (followKeys). A landing that cannot hold the frame's rules fails the
// scene: the view leaves the plate, a landed face's crown leaves the safe
// zone, its chin drops into the caption band or its head leaves the safe
// zone's sides, at the landing or through a cue it follows.
//
// Imports only kit/core files.

import {LAND, landingMinScale, landingScreen, landingState} from '../zooms.mjs';
import {ACTING, stateJoints} from './acting.mjs';
import {frameCast, frameGuides} from './framing.mjs';
import {worldFocus} from '../worlds/index.mjs';

export const WORLD_POINTS = Object.freeze(['far', 'window', 'horizon', 'street', 'skyline']);
const r2 = value => Math.round(value * 100) / 100;
const round = (value, digits = 6) => { const f = 10 ** digits; return Math.round(value * f) / f + 0; };

/**
 * The subject a landing names, in plate px at time t (absolute seconds): a
 * character in the state it is in (or heading to) at t.
 * → {point: {x, y}, head: {x, width, top, chin} | null (a character's face),
 *    shotScale: (shot) → scale | null, actor?}. Throws when it names nothing here.
 */
export function landingSubject(model, name, t) {
  const c = model.content;
  const canvas = model.canvas;
  const actor = c.actors.find(one => one.id === name);
  if (actor) {
    const state = [...actor.states].reverse().find(one => one.time <= t + 1e-6) ?? actor.states[0];
    // The torso's lean (degrees clockwise, about the hips) carries the head across, as framing.mjs punchIn does;
    // the body's drop (bodyY: a crouch, a slump) lowers the hips and the head's drop (headY) the head, both rig units down.
    const j = stateJoints(state, actor);
    const lean = ((j.lean ?? 0) * Math.PI) / 180;
    const hip = actor.marks.hip - (j.bodyY ?? 0);
    const x0 = actor.x + (state.x ?? 0);
    const at = mark => { const above = mark - actor.marks.hip - (j.headY ?? 0); return {x: x0 + Math.sin(lean) * above * actor.scale, y: actor.floor - (hip + Math.cos(lean) * above) * actor.scale}; };
    const top = at(actor.marks.top), chin = at(actor.marks.chin);
    const point = {x: (top.x + chin.x) / 2, y: (top.y + chin.y) / 2};
    const width = actor.marks.headW * actor.scale;
    const shotScale = shot => {
      const single = frameCast(shot, {canvas, actors: [{x: actor.x, scale: actor.wideScale ?? actor.scale, marks: actor.marks}], floor: actor.floor});
      return Math.max(1, single.scale / actor.scale);
    };
    return {point, head: {x: point.x - width / 2, width, top: top.y, chin: chin.y}, shotScale, actor};
  }
  const world = c.drawWorld;
  const names = [...c.actors.map(one => one.id), ...(world ? [...WORLD_POINTS, ...(world.props ?? []).map(entry => (typeof entry === 'string' ? entry : entry?.id)).filter(Boolean)] : [])];
  if (!world || !(WORLD_POINTS.includes(name) || (world.props ?? []).some(entry => (typeof entry === 'string' ? entry : entry?.id) === name))) {
    throw new Error(`names nothing in this scene: ${JSON.stringify(name)} (it can land on: ${names.join(', ')}${world ? '' : '; world points and props need a world the scene draws itself'})`);
  }
  const focus = worldFocus(world.kind, {canvas, time: world.time, props: world.props ?? []});
  const found = WORLD_POINTS.includes(name) ? focus[name] : focus.props.find(entry => entry.id === name);
  if (!found) throw new Error(`the ${world.kind} world has no ${name} to land on`);
  // A framed shot brings the world it draws closer by less than the set (catalog-characters.mjs castSceneView).
  const kw = 1 + ((c.shot?.set?.scale ?? 1) - 1) * 0.35;
  const W = canvas.width, H = canvas.height;
  return {point: {x: W / 2 + kw * ((found.x ?? W / 2) - W / 2), y: H / 2 + kw * (found.y - H / 2)}, head: null, shotScale: () => null};
}

/**
 * Solve one landing (a scene.zooms entry with `land`, its `at` in absolute
 * seconds) on a cast-scene model. `until` (absolute seconds) is when its
 * hold ends: its own until, the next zoom or the shot's end; without it
 * nothing is followed. cues: the landed character's scene cues (`at` in
 * seconds from the scene start), to name the one a follow cannot keep.
 * → {landing: {x, y, s}, follow: [{start, duration, ease, to, cue}], rect, point}
 * or throws with what to change.
 */
export function solveLanding(model, zoom, {until = null, cues = null} = {}) {
  if (model.module !== 'cast-scene') throw new Error(`land is for cast-scene shots (this is ${model.module}); zoom on a box, target or object`);
  if (model.content.shot?.punches?.length) throw new Error('a camera landing cannot share a scene with cue shots (both reframe it): land with move "cut" instead of a cue shot');
  const canvas = model.canvas, W = canvas.width, H = canvas.height;
  const at = Number(zoom.at);
  const dur = zoom.move === 'cut' ? 0 : Number(zoom.dur ?? LAND.dur[zoom.move] ?? 0);
  const subject = landingSubject(model, zoom.land, at + dur);
  const target = landingScreen(zoom.screen, canvas);
  const least = landingMinScale(subject.point, target, canvas);
  let s = least;
  if (zoom.shot !== undefined) {
    s = subject.shotScale(zoom.shot);
    if (s === null) throw new Error(`shot frames a character; ${zoom.land} is a place: give a scale instead`);
    // A close shot from a wide scene can ask for more than the camera's most: it lands at the most.
    s = Math.min(s, LAND.scale.max);
  } else if (zoom.scale !== undefined) s = Number(zoom.scale);
  // 9:16: a character landed with no shot of its own is framed at least at medium, so the face reads on a phone.
  else if (subject.head && H > W) s = Math.min(LAND.scale.max, Math.max(least, subject.shotScale('medium')));
  if (least > LAND.scale.max + 1e-6) throw new Error(`landing ${zoom.land} at ${JSON.stringify(zoom.screen ?? 'center')} needs a scale of ${r2(least)}, past the most (${LAND.scale.max}); pick a screen anchor on the subject's side of the frame`);
  if (s < least - 1e-6) throw new Error(`at ${r2(s)}× the view would leave the plate to put ${zoom.land} at ${JSON.stringify(zoom.screen ?? 'center')}: land at a scale of at least ${r2(least)} (a closer shot), or pick a screen anchor on the subject's side of the frame`);
  const {safe, band} = frameGuides(canvas);
  // Why a face (head: {x, width, top, chin}) breaks the frame with the camera at `state`, or null.
  const misfit = (head, state) => {
    const screen = (x, y) => ({x: W / 2 + state.s * (x - state.x), y: H / 2 + state.s * (y - state.y)});
    const top = screen(head.x, head.top), chin = screen(head.x + head.width, head.chin), tol = 0.5;
    if (top.y < safe.y - tol) return `puts the crown at y ${r2(top.y)}, above the safe zone (${r2(safe.y)}): land the face lower on screen or frame it wider`;
    if (chin.y > band.y + tol) return `puts the chin at y ${r2(chin.y)}, inside the caption band (from ${r2(band.y)}): land the face higher on screen or frame it wider`;
    if (top.x < safe.x - tol || chin.x > safe.x + safe.width + tol) return `puts the head (x ${r2(top.x)}–${r2(chin.x)}) past the safe zone's sides (${r2(safe.x)}–${r2(safe.x + safe.width)}): pick a screen anchor nearer the middle or frame it wider`;
    return null;
  };
  const landing = landingState(subject.point, target, s, canvas);
  const head = subject.head;
  const wrong = head && misfit(head, landing);
  if (wrong) throw new Error(`landing ${zoom.land} ${wrong}`);
  const follow = head && until !== null && Number.isFinite(Number(until)) ? followKeys(model, zoom, {subject, target, landing, at, until: Number(until), misfit, cues}) : [];
  const rect = head ? {x: r2(head.x), y: r2(head.top), width: r2(head.width), height: r2(head.chin - head.top)} : {x: r2(subject.point.x - 4), y: r2(subject.point.y - 4), width: 8, height: 8};
  return {landing, follow, rect, point: {x: r2(subject.point.x), y: r2(subject.point.y)}};
}

// The camera targets that keep a landed face on its anchor through the
// character's moves, from the landing's start (`at`: a move during the
// travel retargets it) to the hold's end, at the landing's scale. A move
// under LAND.follow.still of the frame's height is a gesture, and the camera
// holds. Every follow eases on sine.inOut (zero speed at both ends, no
// overshoot, a peak only π/2 of its average). A walk is followed from a
// little before it starts to a little after it arrives (LAND.follow.lead of
// the walk each side), so the camera keeps pace with the even walk; a pose
// change (a crouch, a lunge) over its tween, at least LAND.follow.min, and
// slow enough to average at most LAND.follow.speed frame heights a second. shotZooms chains them: a key cut short by the next ends
// where it had reached, so the camera never jumps. The view stays inside the
// plate; a face it cannot keep in the frame fails the scene, naming the cue.
// The scene cue nearest t (seconds from the scene start; a contact action's phases start before its cue), named.
function cueName(cues, t) {
  const near = (cues ?? []).filter(cue => Number.isFinite(Number(cue?.at)) && Math.abs(Number(cue.at) - t) <= 1).sort((a, b) => Math.abs(a.at - t) - Math.abs(b.at - t))[0];
  return near ? `${near.action ?? near.pose ?? 'cue'} cue at ${r2(Number(near.at))} s` : null;
}

function followKeys(model, zoom, {subject, target, landing, at, until, misfit, cues}) {
  const {width: W, height: H} = model.canvas;
  const F = LAND.follow, s = landing.s;
  const clampView = state => ({x: Math.min(W - W / (2 * s), Math.max(W / (2 * s), state.x)), y: Math.min(H - H / (2 * s), Math.max(H / (2 * s), state.y)), s});
  const keys = [];
  // The face the camera is heading for: the landing's (the subject as the travel ends), until a move changes it.
  let held = subject.point, camera = landing;
  for (const state of subject.actor.states) {
    if (state.arrive || state.time <= at + 1e-6 || state.time >= until - 1e-6) continue;
    const walk = state.walk;
    const next = landingSubject(model, zoom.land, walk ? state.time + walk.duration : state.time);
    if (Math.hypot(next.point.x - held.x, next.point.y - held.y) * s < F.still * H) continue;
    const lead = walk ? walk.duration * F.lead : 0;
    const start = Math.max(at + 1 / 30, keys.length ? keys.at(-1).start + 1 / 30 : 0, state.time - lead);
    const to = clampView(landingState(next.point, target, s, model.canvas));
    // However fast the pose snaps (a lunge, a crouch), the camera averages at most F.speed frame heights a second.
    const travel = Math.hypot(to.x - camera.x, to.y - camera.y) * s / (F.speed * H);
    const end = Math.min(until, walk ? state.time + walk.duration + lead : state.time + Math.max(state.tween ?? ACTING.poseTween, F.min, travel));
    if (end - start < 1 / 30) continue;
    const cue = cueName(cues, state.time - (model.start ?? 0)) ?? `${state.action ?? state.pose} at ${r2(state.time - (model.start ?? 0))} s`;
    const wrong = misfit(next.head, to);
    if (wrong) throw new Error(`landing ${zoom.land} cannot keep ${zoom.land} in frame through the ${cue}: following it ${wrong}`);
    keys.push({start: round(start), duration: round(end - start), ease: 'sine.inOut', to: {x: round(to.x, 4), y: round(to.y, 4), s: round(s)}, cue});
    held = next.point;
    camera = to;
  }
  return keys;
}
