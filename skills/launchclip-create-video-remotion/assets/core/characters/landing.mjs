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
// the plate (a reveal across a wide set comes in just far enough to travel).
// A landing that cannot hold the frame's rules fails the scene: the view
// leaves the plate, a landed face's crown leaves the safe zone, its chin
// drops into the caption band or its head leaves the safe zone's sides.
//
// Imports only kit/core files.

import {LAND, landingMinScale, landingScreen, landingState} from '../zooms.mjs';
import {stateJoints} from './acting.mjs';
import {frameCast, frameGuides} from './framing.mjs';
import {worldFocus} from '../worlds/index.mjs';

export const WORLD_POINTS = Object.freeze(['far', 'window', 'horizon', 'street', 'skyline']);
const r2 = value => Math.round(value * 100) / 100;

/**
 * The subject a landing names, in plate px at time t (absolute seconds).
 * → {point: {x, y}, head: {x, width, top, chin} | null (a character's face),
 *    shotScale: (shot) → scale | null}. Throws when it names nothing here.
 */
export function landingSubject(model, name, t) {
  const c = model.content;
  const canvas = model.canvas;
  const actor = c.actors.find(one => one.id === name);
  if (actor) {
    const state = [...actor.states].reverse().find(one => one.time <= t + 1e-6) ?? actor.states[0];
    // The torso's lean (degrees clockwise, about the hips) carries the head across, as framing.mjs punchIn does.
    const lean = (stateJoints(state, actor).lean * Math.PI) / 180;
    const x0 = actor.x + (state.x ?? 0);
    const at = mark => { const above = mark - actor.marks.hip; return {x: x0 + Math.sin(lean) * above * actor.scale, y: actor.floor - (actor.marks.hip + Math.cos(lean) * above) * actor.scale}; };
    const top = at(actor.marks.top), chin = at(actor.marks.chin);
    const point = {x: (top.x + chin.x) / 2, y: (top.y + chin.y) / 2};
    const width = actor.marks.headW * actor.scale;
    const shotScale = shot => {
      const single = frameCast(shot, {canvas, actors: [{x: actor.x, scale: actor.wideScale ?? actor.scale, marks: actor.marks}], floor: actor.floor});
      return Math.max(1, single.scale / actor.scale);
    };
    return {point, head: {x: point.x - width / 2, width, top: top.y, chin: chin.y}, shotScale};
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
 * seconds) on a cast-scene model. → {landing: {x, y, s}, rect} or throws
 * with what to change.
 */
export function solveLanding(model, zoom) {
  if (model.module !== 'cast-scene') throw new Error(`land is for cast-scene shots (this is ${model.module}); zoom on a box, target or object`);
  if (model.content.shot?.punches?.length) throw new Error('a camera landing cannot share a scene with cue shots (both reframe it): land with move "cut" instead of a cue shot');
  const canvas = model.canvas;
  const dur = zoom.move === 'cut' ? 0 : Number(zoom.dur ?? LAND.dur[zoom.move] ?? 0);
  const subject = landingSubject(model, zoom.land, Number(zoom.at) + dur);
  const target = landingScreen(zoom.screen, canvas);
  const least = landingMinScale(subject.point, target, canvas);
  let s = least;
  if (zoom.shot !== undefined) {
    s = subject.shotScale(zoom.shot);
    if (s === null) throw new Error(`shot frames a character; ${zoom.land} is a place: give a scale instead`);
    // A close shot from a wide scene can ask for more than the camera's most: it lands at the most.
    s = Math.min(s, LAND.scale.max);
  } else if (zoom.scale !== undefined) s = Number(zoom.scale);
  if (least > LAND.scale.max + 1e-6) throw new Error(`landing ${zoom.land} at ${JSON.stringify(zoom.screen ?? 'center')} needs a scale of ${r2(least)}, past the most (${LAND.scale.max}); pick a screen anchor on the subject's side of the frame`);
  if (s < least - 1e-6) throw new Error(`at ${r2(s)}× the view would leave the plate to put ${zoom.land} at ${JSON.stringify(zoom.screen ?? 'center')}: land at a scale of at least ${r2(least)} (a closer shot), or pick a screen anchor on the subject's side of the frame`);
  const landing = landingState(subject.point, target, s, canvas);
  const toScreen = (x, y) => ({x: canvas.width / 2 + s * (x - landing.x), y: canvas.height / 2 + s * (y - landing.y)});
  const head = subject.head;
  if (head) {
    const {safe, band} = frameGuides(canvas);
    const top = toScreen(head.x, head.top), chin = toScreen(head.x + head.width, head.chin);
    const tol = 0.5;
    if (top.y < safe.y - tol) throw new Error(`landing ${zoom.land} puts the crown at y ${r2(top.y)}, above the safe zone (${r2(safe.y)}): land the face lower on screen or frame it wider`);
    if (chin.y > band.y + tol) throw new Error(`landing ${zoom.land} puts the chin at y ${r2(chin.y)}, inside the caption band (from ${r2(band.y)}): land the face higher on screen or frame it wider`);
    if (top.x < safe.x - tol || chin.x > safe.x + safe.width + tol) throw new Error(`landing ${zoom.land} puts the head (x ${r2(top.x)}–${r2(chin.x)}) past the safe zone's sides (${r2(safe.x)}–${r2(safe.x + safe.width)}): pick a screen anchor nearer the middle or frame it wider`);
  }
  const rect = head ? {x: r2(head.x), y: r2(head.top), width: r2(head.width), height: r2(head.chin - head.top)} : {x: r2(subject.point.x - 4), y: r2(subject.point.y - 4), width: 8, height: 8};
  return {landing, rect, point: {x: r2(subject.point.x), y: r2(subject.point.y)}};
}
