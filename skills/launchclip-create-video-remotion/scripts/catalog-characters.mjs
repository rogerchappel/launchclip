// Character modules (docs/VIDEO_QUALITY_RFC.md §10.5): animated characters
// drawn in code from the rig in kit/core/characters/. Contract:
// docs/KIT_CONTRACTS.md ("Character modules").
//
//   cast-scene       one to three characters in a set (desk-laptop, phone,
//                    meeting, screen, kitchen-counter, sofa, podium, stage,
//                    car, park-bench, video-call, standing-desk, standing), directed by cues: named poses and
//                    expressions at times or narration words, mouths moving
//                    on their spoken words
//   character-cameo  one character beside a card, or alone on a panel (for
//                    a footage-led or explainer beat)
//
// Characters come from the story cast (story.cast, by id) or the starter
// cast; scenes never change how a character looks, only how it acts, so a
// character is the same person in every shot. The screen in a set plays a
// real capture (params.screen: an assets/ image, video or demo-autopilot
// recording), never an invented UI.
//
// Same conventions as catalogue E: {front, media?, overlay?} views from one
// model, one renderer-neutral op list, absolute times, `at` in seconds from
// the scene start (word anchors resolve before the module sees them).

import {createBase, fitText, r2, rt} from './catalog-b-base.mjs';
import {abs, el, svgRoot, tw, set} from './catalog-b-view.mjs';
import {media, mediaNode} from './catalog-e.mjs';
import {EXPRESSIONS, HELD_AIDS, POSES} from './characters/rig.mjs';
import {drawCharacter, styleGeometry, styleHeight} from './characters/styles.mjs';
import {lightErrors, normalizeLight} from './characters/light.mjs';
import {characterView} from './characters/view.mjs';
import {drawingBounds} from './characters/bounds.mjs';
import {ACTING, actingOps, stateJoints, speechChanges} from './characters/acting.mjs';
import {BACKDROPS, SEATED_SETS, SETS, SET_INFO, WORLD_SETS, layoutSet, phoneProp} from './characters/sets.mjs';
import {castMember, resolveStoryCast} from './characters/cues.mjs';
import {ACTIONS, ACTION_INFO, GAZE, NAMED_TARGETS, TARGET_REQUIRED, VIEWS, gazeOffset, viewFor, sideOf, targetError, targetPoint, walkDuration} from './characters/actions.mjs';
import {WORLD_KINDS, WORLD_TIMES, renderWorld, worldAnchors, worldFocus, worldGrade, worldLight} from './worlds/index.mjs';
import {worldLayerNodes} from './worlds/view.mjs';
import {withoutForeground, worldCameraStates} from './catalog-world.mjs';
import {OVERSCAN} from './worlds/index.mjs';

export const CHARACTER_TIMING = Object.freeze({
  'cast-scene': {minDuration: 2, leadIn: 0, leadOut: ACTING.poseTween},
  'character-cameo': {minDuration: 2, leadIn: 0, leadOut: ACTING.poseTween}
});
const timingOf = id => ({...CHARACTER_TIMING[id], gaps: [], rules: [
  `a pose change tweens over ${ACTING.poseTween} s; cues may sit anywhere from the scene start to ${ACTING.poseTween} s before its end`,
  'an action cue (look-far, turn-to-look, gaze-at, point-at, walk-to, stand-up, stretch) acts out an idea; a character with a target faces it and turns its head to it',
  'gestures (wave, type, walk, cheer, think) loop while the pose holds'
]});

const ACTOR_KEYS = ['id', 'position', 'pose', 'expression', 'facing', 'cues', 'says', 'holds', 'target'];
const CUE_KEYS = ['at', 'pose', 'expression', 'action', 'target', 'facing', 'view'];

// ---------------------------------------------------------------------------
// Shared: actors

/**
 * The scene's key light (characters/light.mjs): params.light, else the light
 * of the world the cast stands in (standingWorld), else the story's light
 * (ctx.light), else the default soft key.
 */
function sceneLight(b, value, ctx, world) {
  const fallback = world ? worldLight(world.kind, world.time) : ctx.light;
  const errors = lightErrors(value, 'params.light');
  if (errors.length) b.check.fail('params.light', errors.join('; ').replace(/^params\.light /, ''));
  return normalizeLight(value ?? (lightErrors(fallback).length ? null : fallback ?? null));
}

function resolveActor(b, raw, path, {cast, seated, slot, setName, enter, light}) {
  const {check} = b;
  check.obj(raw, path, ACTOR_KEYS, ['id']);
  let member;
  try { member = castMember(cast, raw.id, `${path}.id`); } catch (error) { check.fail(path === 'params' ? 'params.character' : `${path}.id`, error.message.replace(/^\S+ /, '')); }
  const pose = raw.pose === undefined ? (seated ? 'sit' : 'stand') : check.oneOf(raw.pose, `${path}.pose`, POSES);
  const expression = raw.expression === undefined ? 'neutral' : check.oneOf(raw.expression, `${path}.expression`, EXPRESSIONS);
  const facing = raw.facing === undefined ? slot.facing : check.oneOf(raw.facing, `${path}.facing`, ['left', 'right']);
  if (raw.target !== undefined) { const problem = targetError(raw.target); if (problem) check.fail(`${path}.target`, problem); }
  const holds = raw.holds === undefined ? null : check.oneOf(raw.holds, `${path}.holds`, ['phone']);
  const states = [{time: b.start, pose, expression}];
  const lastCue = b.duration - ACTING.poseTween;
  const cues = raw.cues === undefined ? [] : check.arr(raw.cues, `${path}.cues`, 0, 24);
  const fitsSet = (value, where) => {
    if (value === 'walk' && seated) check.fail(where, `walk does not fit the seated set ${setName}`);
    if (value === 'sit' && !seated && member.params.mobility !== 'wheelchair') check.fail(where, `sit needs a seated set (${SEATED_SETS.join(', ')})`);
  };
  fitsSet(pose, `${path}.pose`);
  cues.map((cue, i) => {
    const where = `${path}.cues[${i}]`;
    check.obj(cue, where, CUE_KEYS, ['at']);
    if (!CUE_KEYS.slice(1).some(key => cue[key] !== undefined)) check.fail(where, 'needs a pose, an expression, an action, a target or a facing');
    if (typeof cue.at === 'string') check.fail(`${where}.at`, `${JSON.stringify(cue.at)} is a word anchor that was not resolved; pass narration words to the story resolver or give seconds`);
    const at = check.num(cue.at, `${where}.at`, 0, lastCue);
    if (cue.pose !== undefined) { check.oneOf(cue.pose, `${where}.pose`, POSES); fitsSet(cue.pose, `${where}.pose`); }
    if (cue.expression !== undefined) check.oneOf(cue.expression, `${where}.expression`, EXPRESSIONS);
    if (cue.facing !== undefined) check.oneOf(cue.facing, `${where}.facing`, ['left', 'right']);
    if (cue.view !== undefined) check.oneOf(cue.view, `${where}.view`, VIEWS);
    const action = cue.action === undefined ? null : check.oneOf(cue.action, `${where}.action`, ACTIONS);
    if (cue.target !== undefined) { const problem = targetError(cue.target); if (problem) check.fail(`${where}.target`, problem); }
    if (action && TARGET_REQUIRED.includes(action) && cue.target === undefined) check.fail(`${where}.target`, `is required for ${action}`);
    if (action === 'stand-up' && !seated) check.fail(`${where}.action`, `stand-up needs a seated set (${SEATED_SETS.join(', ')})`);
    // An action takes its pose unless the cue names one (walk-to in a seated set needs a stand-up first: checked when directed).
    const pose = cue.pose ?? (action ? ACTION_INFO[action].pose ?? undefined : undefined);
    return {time: rt(b.start + at), pose, expression: cue.expression, action, target: cue.target, facing: cue.facing, view: cue.view};
  }).sort((a, c) => a.time - c.time).forEach(cue => {
    const prev = states[states.length - 1];
    const next = {time: cue.time, pose: cue.pose ?? prev.pose, expression: cue.expression ?? prev.expression, ...(cue.action ? {action: cue.action} : {}), ...(cue.target !== undefined ? {target: cue.target} : {}), ...(cue.facing ? {facing: cue.facing} : {}), ...(cue.view ? {view: cue.view} : {})};
    if (Math.abs(cue.time - prev.time) < 1e-6) Object.assign(prev, next, {time: prev.time});
    else if (cue.time - prev.time < ACTING.poseTween - 1e-6 && next.pose !== prev.pose && states.length > 1) check.fail(`${path}.cues`, `pose changes at ${r2(prev.time - b.start)} s and ${r2(cue.time - b.start)} s are closer than ${ACTING.poseTween} s; space them out`);
    else states.push(next);
  });
  // says "auto" resolves to the character's own dialogue words in the story resolver; without words it stays silent.
  const says = raw.says === undefined || raw.says === 'auto' ? [] : check.arr(raw.says, `${path}.says`, 0, 40).map((range, i) => {
    const where = `${path}.says[${i}]`;
    check.obj(range, where, ['from', 'to', 'words'], ['from', 'to']);
    if (typeof range.from === 'string' || typeof range.to === 'string') check.fail(where, 'has unresolved word anchors; pass narration words to the story resolver or give seconds');
    // A line may run across a cut: spoken ranges are clipped to the scene.
    const clip = value => Math.min(Math.max(value, 0), b.duration);
    const from = clip(check.num(range.from, `${where}.from`, -86400, 86400)), to = clip(check.num(range.to, `${where}.to`, -86400, 86400));
    if (to < from) check.fail(`${where}.to`, 'must not be before from');
    const words = range.words === undefined ? null : check.arr(range.words, `${where}.words`, 0, 400).map((w, k) => {
      if (!Array.isArray(w) || w.length !== 2 || !w.every(Number.isFinite) || w[1] < w[0]) check.fail(`${where}.words[${k}]`, 'must be [start, end] seconds');
      return [rt(b.start + clip(w[0])), rt(b.start + clip(w[1]))];
    }).filter(([s, e]) => e > s);
    return {from: rt(b.start + from), to: rt(b.start + to), words};
  });
  const expressions = [...new Set(states.map(state => state.expression))];
  const geometry = styleGeometry(member.style, member.params);
  return {id: member.id, name: member.name, voice: member.voice, look: member.look, fingerprint: member.fingerprint, params: member.params, colors: member.colors, style: member.style,
    facing, holds, seated, states, expressions, speech: speechChanges(says), says, height: styleHeight(member.style, member.params), geometry, enter, light,
    target: raw.target ?? null, facingSet: raw.facing !== undefined};
}

/**
 * Direct a placed actor (characters/actions.mjs): each state's facing, gaze,
 * standing and walk offset, now that every actor in the scene has its place.
 * A target (the actor's, then each cue's) turns the actor toward it and its
 * face toward it; look-far without a target looks at the world's far point;
 * walk-to walks there at a walking pace and stands; stand-up stands from the
 * seat. → the actor with directed states and `gaze` (any face turn) and
 * `walks` (any walk) flags.
 */
function directActor(b, actor, path, scene) {
  const {check} = b;
  const W = scene.canvas.width;
  const margin = W * 0.12;
  let target = actor.target, facing = actor.facing, standing = false, x = 0;
  const pointOf = value => { try { return targetPoint(value, scene); } catch (error) { check.fail(`${path}.target`, error.message); } return null; };
  if (target !== null && !actor.facingSet) facing = sideOf(pointOf(target), actor.x, scene.canvas);
  const out = [];
  let gazeOn = false, walks = false, turns = false;
  for (let i = 0; i < actor.states.length; i++) {
    const state = actor.states[i];
    const action = state.action ?? null;
    if (action === 'stand-up') standing = true;
    if (state.target !== undefined) target = state.target;
    else if (action && ACTION_INFO[action].gaze && ACTION_INFO[action].target) target = ACTION_INFO[action].target;
    const here = {...actor, x: actor.x + x};
    const point = target === null ? null : pointOf(target);
    if (state.facing) facing = state.facing;
    else if (point) facing = sideOf(point, here.x, scene.canvas);
    if ((state.pose === 'walk' || action === 'walk-to') && actor.seated && !standing) check.fail(`${path}.cues`, `${action ?? 'walk'} at ${r2(state.time - b.start)} s needs the character standing: add a stand-up cue before it`);
    const view = state.view ?? viewFor(point, {seated: actor.seated && !standing});
    const turned = point ? gazeOffset(point, here, scene.canvas) : {x: 0, y: 0};
    // A three-quarter turn swings the face further and narrows it.
    const gaze = view === 'three-quarter' && point ? {x: Math.sign(turned.x || (facing === 'left' ? -1 : 1)) * GAZE.quarter, y: turned.y, scale: GAZE.quarterScale} : turned;
    if (gaze.x || gaze.y) gazeOn = true;
    if (view === 'back') turns = true;
    const directed = {...state, target, facing, standing, gaze, view, x, ...(point ? {point: {x: point.x ?? null, y: point.y ?? null, far: Boolean(point.far), ...(point.toward ? {toward: point.toward} : {})}} : {})};
    out.push(directed);
    if (action === 'walk-to' && point) {
      const to = Math.min(W - margin, Math.max(margin, point.x ?? (facing === 'left' ? margin : W - margin)));
      const dx = r2(to - actor.x - x);
      const dur = walkDuration(dx, actor.scale);
      const arrive = rt(state.time + dur);
      const nextCue = actor.states[i + 1]?.time ?? Infinity;
      if (arrive > b.start + b.duration - ACTING.poseTween + 1e-6) check.fail(`${path}.cues`, `walk-to at ${r2(state.time - b.start)} s takes ${dur} s and would not arrive before the scene ends`);
      if (nextCue < arrive - 1e-6) check.fail(`${path}.cues`, `walk-to at ${r2(state.time - b.start)} s arrives at ${r2(arrive - b.start)} s; the next cue at ${r2(nextCue - b.start)} s comes before it`);
      directed.walk = {from: x, to: r2(x + dx), duration: dur};
      walks = walks || Math.abs(dx) > 0.5;
      x = r2(x + dx);
      // Arrived: stand, facing the way the walk went.
      out.push({time: arrive, pose: 'stand', expression: state.expression, facing, standing, gaze, view, x, arrive: true});
    }
  }
  return {...actor, states: out, gaze: gazeOn, walks, turns};
}

/**
 * The world the cast stands in: params.world ({kind, time?}), else the
 * track-0 world scene the scene plays over (ctx.beneath). → {kind, time} | null.
 */
function standingWorld(b, ctx) {
  const {check} = b;
  const raw = b.params.world;
  if (raw === undefined) return ctx.beneath ? {kind: ctx.beneath.kind, time: ctx.beneath.time} : null;
  check.obj(raw, 'params.world', ['kind', 'time'], ['kind']);
  return {kind: check.oneOf(raw.kind, 'params.world.kind', WORLD_KINDS), time: raw.time === undefined ? 'day' : check.oneOf(raw.time, 'params.world.time', WORLD_TIMES)};
}

// Characters standing in a world take half its time-of-day grade: a night
// street darkens and cools them as it does its own materials, less deeply.
export const WORLD_GRADE_STRENGTH = 0.5;
function inWorld(actor, world) {
  if (!world) return actor;
  const g = worldGrade(world.kind, world.time, WORLD_GRADE_STRENGTH);
  return {...actor, colors: Object.fromEntries(Object.entries(actor.colors).map(([key, hex]) => [key, g(hex)]))};
}

// A held phone sits in the hand away from the facing side (in the facing hand when the other holds a cane).
const actorProps = actor => actor.holds === 'phone' ? {[(actor.facing === 'left') !== HELD_AIDS.includes(actor.params.mobility) ? 'r' : 'l']: phoneProp(actor.colors, 98)} : null;

function actorNode(model, actor, index) {
  const cid = `${model.id}-c${index}`;
  const first = actor.states[0];
  const joints = stateJoints(first, actor);
  const drawing = drawCharacter(actor.style, actor.params, actor.colors, {id: cid, joints, expression: first.expression, expressions: actor.expressions, props: actorProps(actor), light: actor.light, facing: actor.facing, gaze: Boolean(actor.gaze), turns: Boolean(actor.turns)});
  const view = characterView(drawing, {id: cid, x: actor.x, y: actor.floor, scale: actor.scale});
  // A walking character moves on its own wrapper, so its scale stays on the view.
  return actor.walks ? el('div', `${cid}-walk`, abs(0, 0, 0, 0), [view]) : view;
}

// A gesture's far swing (acting.mjs gestureOps) as joint values.
function gesturePeak(j) {
  const g = j.gesture;
  if (!g) return null;
  if (g.joint === 'walk') return {...j, legL: j.legL + g.amount, legR: j.legR - g.amount, armL: j.armL - g.amount * 0.8, armR: j.armR + g.amount * 0.8};
  if (g.joint === 'fore') return {...j, foreL: j.foreL + g.amount, foreR: j.foreR - g.amount};
  if (g.joint === 'bodyY') return {...j, bodyY: j.bodyY + g.amount};
  const s = g.joint.endsWith('L') ? 'L' : 'R';
  return {...j, [`fore${s}`]: j[`fore${s}`] + g.amount};
}

/**
 * How far an actor reaches on the canvas over the scene: the union of its
 * drawn bounds in every pose it takes (and each gesture's far swing), with
 * its held prop. → {left, top, right, bottom} canvas px.
 */
export function actorReach(actor) {
  const out = {left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity};
  const seen = new Map();
  for (const state of actor.states) seen.set(`${state.pose}|${state.facing ?? actor.facing}|${state.standing ? 1 : 0}|${state.x ?? 0}`, state);
  for (const state of seen.values()) {
    const joints = stateJoints({...state, gaze: null}, actor);
    const x = actor.x + (state.x ?? 0);
    for (const j of [joints, gesturePeak(joints)].filter(Boolean)) {
      const b = drawingBounds(drawCharacter(actor.style, actor.params, actor.colors, {id: 'reach', joints: j, expression: 'neutral', expressions: ['neutral'], props: actorProps(actor), light: actor.light, facing: actor.facing}));
      out.left = Math.min(out.left, x + b.left * actor.scale);
      out.right = Math.max(out.right, x + b.right * actor.scale);
      out.top = Math.min(out.top, actor.floor + b.top * actor.scale);
      out.bottom = Math.max(out.bottom, actor.floor + b.bottom * actor.scale);
    }
  }
  return {left: r2(out.left), top: r2(out.top), right: r2(out.right), bottom: r2(out.bottom)};
}

function actorsOps(model, ops) {
  const single = model.content.single ?? {};
  model.content.actors.forEach((actor, index) => {
    const cid = `${model.id}-c${index}`;
    actingOps(ops, {...actor, cid, start: model.start, end: model.end, geometry: actor.geometry});
    // One copy of a person (castPassage): hidden until the transition into
    // this scene has passed, or from the moment the one out of it starts.
    const shown = actor.walks ? `${cid}-walk` : cid;
    if (single.arrive?.ids.includes(actor.id) && single.arrive.at > model.start + 1e-6) { set(ops, shown, model.start, {opacity: 0}); set(ops, shown, single.arrive.at, {opacity: 1}); }
    if (single.leave?.ids.includes(actor.id)) set(ops, shown, single.leave.at, {opacity: 0});
  });
}

// Root fade (opacity only: a set does not slide), on every hoisted part. A
// scene on the video's first frame is the frame-0 hook: it is already shown
// on frame 0, with no fade in (as hook-title and kinetic-words).
//
// A cast that arrives or leaves with the world beneath it (content.entry /
// content.exit, see castPassage) cuts with that plate, or fades over the
// plate's own transition, so it never dissolves on its own over a plate that
// is already there (a see-through ghost).
function rootFade(model, ops, ids) {
  const m = model.motion;
  const entry = model.content.entry ?? null, exit = model.content.exit ?? null;
  const settled = model.start <= 1 / model.fps + 1e-6 || entry?.type === 'cut';
  // A person is never see-through for long (docs/DIRECTION_GUARDRAILS.md §4):
  // a cast's own fade takes at most CAST_FADE seconds, whatever the grammar.
  const enterDuration = entry?.type === 'fade' ? entry.dur : Math.min(m.enterDuration, CAST_FADE);
  const exitDuration = exit?.type === 'fade' ? exit.dur : Math.min(m.exitDuration, CAST_FADE);
  for (const id of ids) {
    if (settled) set(ops, id, model.start, {opacity: 1});
    else {
      set(ops, id, model.start, {opacity: 0});
      tw(ops, id, model.start, enterDuration, 'power1.out', {opacity: 0}, {opacity: 1});
    }
    if (exit?.type !== 'cut') tw(ops, id, rt(model.end - exitDuration), exitDuration, 'power1.in', {opacity: 1}, {opacity: 0});
    set(ops, id, model.end, {opacity: 0});
  }
}

export const PASSAGES = Object.freeze(['fade', 'cut']);
export const CAST_FADE = 0.3;

/**
 * How a character scene arrives and leaves. params.enter / params.exit (fade
 * | cut) win. Otherwise a scene that starts with the world beneath it arrives
 * as that plate does: a cut when the plate cuts in, else a fade over the
 * plate's transition; one that ends with it leaves as the next plate arrives:
 * a cut, or a fade over that transition. Anything else fades as before.
 * → {entry: {type, dur?} | null, exit: {type, dur?} | null} (null: the default fade)
 */
function castPassage(b, ctx, ids = []) {
  const {check} = b;
  const p = b.params;
  const w = ctx.beneath;
  const on = (a, c) => Number.isFinite(a) && Math.abs(a - c) < 1e-3;
  const dur = transition => Math.max(0.1, Number(transition?.dur) || 0.3);
  const passage = transition => (!transition || transition.type === 'cut' ? {type: 'cut'} : {type: 'fade', dur: dur(transition)});
  // No ghosting (docs/DIRECTION_GUARDRAILS.md §4): a character also in the
  // character scene just before arrives as a cut when the plate's transition
  // has passed; one also in the scene just after leaves as a cut. One copy of
  // a person is on screen at a time.
  // The set still arrives and leaves with its plate; only the shared people wait.
  const before = ids.filter(id => (ctx.castNeighbours?.before ?? []).includes(id));
  const after = ids.filter(id => (ctx.castNeighbours?.after ?? []).includes(id));
  const throughPlate = w && on(w.start, b.start) && w.in && w.in.type !== 'cut' ? dur(w.in) : 0;
  const nextPasses = w && on(w.end, b.start + b.duration) && w.nextIn && w.nextIn.type !== 'cut';
  const single = {
    ...(before.length ? {arrive: {ids: before, at: rt(b.start + throughPlate)}} : {}),
    // Leaving into a transition, a shared person leaves as it starts (the
    // riding cast's set slides out with its plate, the person does not).
    ...(after.length && nextPasses ? {leave: {ids: after, at: rt(b.start + b.duration)}} : {})
  };
  const sharedIn = before.length ? {type: 'cut'} : null;
  // Riding a world plate in world mode (camera-world.mjs ridesPlate), the cast
  // moves with the plate and its transition: it never fades on its own.
  if (ctx.rides && p.enter === undefined && p.exit === undefined) return {entry: {type: 'cut'}, exit: {type: 'cut'}, single};
  const named = (value, path) => (value === undefined ? undefined : check.oneOf(value, path, PASSAGES) === 'cut' ? {type: 'cut'} : {type: 'fade', dur: b.motion?.enterDuration ?? 0.5});
  const entry = named(p.enter, 'params.enter') ?? (sharedIn && !throughPlate ? sharedIn : null) ?? (w && on(w.start, b.start) ? passage(w.in) : null);
  const exit = named(p.exit, 'params.exit') ?? (w && on(w.end, b.start + b.duration) && w.nextIn ? passage(w.nextIn) : null);
  return {entry, exit, single};
}

function castEvents(b, actors) {
  actors.forEach(actor => actor.states.slice(1).forEach((state, i) => {
    b.events.push({id: `${b.id}-${actor.id}-cue-${i}`, name: `${actor.id}-cue-${i}`, time: state.time, endTime: rt(state.time + ACTING.poseTween), role: 'detail'});
  }));
}

// ---------------------------------------------------------------------------
// cast-scene

// Screen positions by cast size, left to right (the layout's slots).
const POSITION_NAMES = {1: ['centre'], 2: ['left', 'right'], 3: ['left', 'centre', 'right']};
const POSITIONS = ['left', 'centre', 'center', 'right'];

/**
 * Which layout slot each cast entry takes. A scene entry's `position` wins,
 * then the story cast's `position` for that character (so a character keeps
 * its side from shot to shot), and anyone left fills the free slots in list
 * order. → slot index per entry.
 */
function castSlots(b, entries, cast) {
  const {check} = b;
  const names = POSITION_NAMES[entries.length];
  const wanted = entries.map((raw, i) => {
    const own = raw?.position === undefined ? null : check.oneOf(raw.position, `params.cast[${i}].position`, POSITIONS);
    const name = own === 'center' ? 'centre' : own;
    if (name && !names.includes(name)) check.fail(`params.cast[${i}].position`, `${JSON.stringify(raw.position)} does not fit ${entries.length} character${entries.length === 1 ? '' : 's'} (positions: ${names.join(', ')})`);
    if (name) return {name, explicit: true};
    let story = null;
    try { story = cast?.members?.get(raw?.id)?.position ?? null; } catch { story = null; }
    story = story === 'center' ? 'centre' : story;
    return story && names.includes(story) ? {name: story, explicit: false} : null;
  });
  const taken = new Map();
  wanted.forEach((want, i) => {
    if (!want?.explicit) return;
    if (taken.has(want.name)) check.fail(`params.cast[${i}].position`, `${want.name} is already taken by params.cast[${taken.get(want.name)}]`);
    taken.set(want.name, i);
  });
  // Story-cast positions next, where the slot is still free.
  wanted.forEach((want, i) => { if (want && !want.explicit && !taken.has(want.name)) taken.set(want.name, i); });
  const slots = new Array(entries.length).fill(null);
  for (const [name, i] of taken) slots[i] = names.indexOf(name);
  const free = names.map((_, k) => k).filter(k => !slots.includes(k));
  return slots.map(slot => slot ?? free.shift());
}

/**
 * Where a cast-scene's set stands. backdrop "room" is the set's own room;
 * "world" is its furniture alone, recoloured by the world's time-of-day grade
 * and standing on the world's ground: over the track-0 world scene beneath,
 * else in a world the scene draws behind itself (params.world, else
 * story.world), so a seeded style's world is the room. The default is
 * "world" whenever there is a world and the set has a furniture-only form.
 * → {backdrop, world: {kind, time} | null (the world the cast stands in),
 *    draw: render inputs for a world drawn in the scene | null}
 */
function castStage(b, ctx, setName) {
  const {check} = b;
  const p = b.params;
  const named = standingWorld(b, ctx);
  const story = isStoryWorld(ctx.world) ? {kind: ctx.world.kind, time: ctx.world.time ?? 'day'} : null;
  const fits = SET_INFO[setName].world;
  const backdrop = p.backdrop === undefined ? (fits && (named || story) ? 'world' : 'room') : check.oneOf(p.backdrop, 'params.backdrop', BACKDROPS);
  if (backdrop === 'room') return {backdrop, world: named, draw: null};
  if (!fits) check.fail('params.backdrop', `"world" does not fit the ${setName} set (sets with a furniture-only form: ${WORLD_SETS.join(', ')})`);
  const world = named ?? story;
  if (!world) check.fail('params.backdrop', '"world" needs a world: a track-0 world scene beneath, params.world or story.world');
  // Over a world scene the plate shows through; otherwise the scene draws the world itself.
  const beneath = p.world === undefined && ctx.beneath;
  const props = p.world === undefined && !beneath ? (Array.isArray(ctx.world?.props) ? ctx.world.props : []) : [];
  const detail = p.world === undefined && !beneath ? (ctx.world?.detail ?? null) : null;
  return {backdrop, world, draw: beneath ? null : {kind: world.kind, time: world.time, props, detail, style: ctx.cast?.style ?? ctx.cast?.drawing_style ?? null}};
}

/**
 * The ground line the set stands on, in frame px: the world's own ground. A
 * world plate beneath in world mode is drawn with a bleed (ctx.bleed) on a
 * larger canvas, so its ground is measured there and shifted back.
 */
function worldFloor(stage, ctx, canvas) {
  const bleed = !stage.draw && ctx.bleed ? {x: ctx.bleed.x ?? 0, y: ctx.bleed.y ?? 0} : {x: 0, y: 0};
  const drawn = {width: canvas.width + 2 * bleed.x, height: canvas.height + 2 * bleed.y};
  return worldAnchors(stage.world.kind, {canvas: drawn}).ground.y - bleed.y;
}

/**
 * A set standing in the world plate beneath is anchored to it
 * (kit/core/physics.mjs): its furniture and the cast on it move only with the
 * plate's in-scene camera, by the same x and scale as the world's front layer
 * frame for frame, so a desk never slides across the floor it stands on.
 * → {plate, start, end, move, from, to} | null (no plate beneath, or the set
 * draws its own room or world).
 */
function plateFollow(stage, ctx, canvas) {
  const w = ctx.beneath;
  if (stage.backdrop !== 'world' || stage.draw || !w?.camera) return null;
  const bleedX = ctx.bleed?.x ?? 0;
  const {from, to} = worldCameraStates(w.camera, {overscan: Math.round((canvas.width + 2 * bleedX) * OVERSCAN)}).front;
  return {plate: w.scene, start: w.start, end: Number.isFinite(w.renderEnd) ? w.renderEnd : w.end, move: w.camera.move, from, to};
}

/**
 * Where characters can look (worlds/index.mjs worldFocus) in the world they
 * stand in, in frame px: a plate beneath in world mode is measured on its
 * bleed canvas and shifted back, as worldFloor does. → focus | null
 */
function sceneFocus(world, ctx, canvas, draw) {
  if (!world) return null;
  const bleed = !draw && ctx.bleed ? {x: ctx.bleed.x ?? 0, y: ctx.bleed.y ?? 0} : {x: 0, y: 0};
  const props = draw ? draw.props ?? [] : ctx.beneath?.props ?? [];
  let focus;
  try { focus = worldFocus(world.kind, {canvas: {width: canvas.width + 2 * bleed.x, height: canvas.height + 2 * bleed.y}, time: world.time, props}); } catch { return null; }
  const shift = point => (point ? {...point, x: point.x === null ? null : point.x - bleed.x, y: point.y - bleed.y} : point);
  return {...Object.fromEntries(['far', 'window', 'horizon', 'street', 'skyline'].map(name => [name, shift(focus[name])])), props: focus.props.map(shift)};
}

const isStoryWorld = world => Boolean(world) && typeof world === 'object' && WORLD_KINDS.includes(world.kind) && (world.time === undefined || WORLD_TIMES.includes(world.time));

function resolveCastScene(params, ctx) {
  const b = createBase('cast-scene', params, ctx, {allowed: ['set', 'screen', 'cast', 'light', 'world', 'backdrop', 'enter', 'exit'], required: ['set', 'cast'], hidesCaptions: false});
  const {check, canvas} = b;
  const p = b.params;
  const setName = check.oneOf(p.set, 'params.set', SETS);
  const stage = castStage(b, ctx, setName);
  const info = SET_INFO[setName];
  const screen = p.screen === undefined ? null : media(check, p.screen, 'params.screen');
  if (info.screen === 'required' && !screen) check.fail('params.screen', `is required for the ${setName} set: a real capture (an assets/ image or video, or a demo-autopilot recording); the set never invents a UI`);
  if (info.screen === 'none' && screen) check.fail('params.screen', `is not used by the ${setName} set (screens: ${SETS.filter(name => SET_INFO[name].screen !== 'none').join(', ')})`);
  check.arr(p.cast, 'params.cast', 1, 3);
  let cast;
  try { cast = resolveStoryCast({cast: ctx.cast ?? null, brand: ctx.brand}); } catch (error) { check.fail('story.cast', error.message); }
  const ids = p.cast.map(entry => entry?.id);
  if (new Set(ids).size !== ids.length) check.fail('params.cast', 'names a character twice');
  // Heights first (the set scales to the tallest), then the layout.
  const heights = p.cast.map((entry, i) => {
    try { const member = castMember(cast, entry?.id, `params.cast[${i}].id`); return styleHeight(member.style, member.params); } catch { return 1000; }
  });
  const inWorldSet = stage.backdrop === 'world';
  const layout = layoutSet(setName, {canvas, colors: b.colors, count: p.cast.length, heights, screen: Boolean(screen), unit: b.unit, backdrop: stage.backdrop,
    ...(inWorldSet ? {floor: worldFloor(stage, ctx, canvas), grade: worldGrade(stage.world.kind, stage.world.time)} : {})});
  const slotOf = castSlots(b, p.cast, cast);
  const world = stage.world;
  const light = sceneLight(b, p.light, ctx, world);
  const actors = p.cast.map((raw, i) => {
    const slot = layout.slots[slotOf[i]];
    const actor = inWorld(resolveActor(b, raw, `params.cast[${i}]`, {cast, seated: layout.seated, slot, setName, enter: b.start, light}), world);
    // The phone set: the first character holds the phone unless someone else is given it.
    if (setName === 'phone' && i === 0 && !p.cast.some(entry => entry?.holds !== undefined)) actor.holds = 'phone';
    return {...actor, position: POSITION_NAMES[p.cast.length][slotOf[i]], x: slot.x, floor: slot.floor, scale: slot.scale};
  }).map((placed, i, all) => {
    const directed = directActor(b, placed, `params.cast[${i}]`, {focus: sceneFocus(stage.world, ctx, canvas, stage.draw), actors: all, canvas});
    return {...directed, reach: actorReach(directed)};
  });
  castEvents(b, actors);
  const tops = actors.map(actor => actor.floor - (actor.height + (layout.seated ? -actor.geometry.sitDrop : 0)) * actor.scale);
  const rect = {x: r2(Math.max(0, Math.min(...actors.map(a => a.x)) - 220 * actors[0].scale)), y: r2(Math.max(0, Math.min(...tops))), width: 0, height: 0};
  rect.width = r2(Math.min(canvas.width, Math.max(...actors.map(a => a.x)) + 220 * actors[0].scale) - rect.x);
  rect.height = r2(Math.min(canvas.height, layout.floor) - rect.y);
  b.model.layer = 'front';
  const content = {...castPassage(b, ctx, actors.map(actor => actor.id)), follow: plateFollow(stage, ctx, canvas), set: setName, backdrop: stage.backdrop, world: stage.world, drawWorld: stage.draw, seated: layout.seated, back: layout.back, front: layout.front, screenRect: layout.screenRect, media: screen, actors, colors: layout.colors};
  const model = b.finish(content, {minTextPx: b.min.key});
  // A set fills the frame: fade in place rather than slide.
  model.motion = {...model.motion, enterFrom: {opacity: 0, x: 0, y: 0, scale: 1}, exitTo: {opacity: 0, x: 0, y: 0, scale: 1}};
  // Anchored to a plate, the set never takes the ambient hold drift.
  model.layout = {...model.layout, rect, role: 'media', minTextPx: null, ...(content.follow ? {drift: false} : {})};
  model.minTextPx = null;
  return model;
}

// The wrapper an anchored set moves on (content.follow), centred like the world's layers.
const camWrap = (model, id, kids) => (model.content.follow ? [el('div', id, abs(0, 0, model.canvas.width, model.canvas.height, {transformOrigin: '50% 50%'}), kids)] : kids);

function castSceneView(model) {
  const {id, canvas} = model;
  const c = model.content;
  const W = canvas.width, H = canvas.height;
  // A world the scene draws itself (no world scene beneath): its layers, still,
  // behind the furniture; the cast is the foreground, so its front layer is left out.
  const world = c.drawWorld ? worldLayerNodes(withoutForeground(renderWorld({id: `${id}-world`, ...c.drawWorld, colors: model.theme ? {bg: model.theme.bg, primary: model.theme.primary, accent: model.theme.accent, ink: model.theme.ink, paper: model.theme.paper} : {}, canvas, seed: `${c.drawWorld.kind}|${c.drawWorld.time}|${W}x${H}`})), `${id}-world`) : [];
  const back = svgRoot(W, H, c.back);
  const actors = c.actors.map((actor, i) => actorNode(model, actor, i));
  const front = svgRoot(W, H, c.front);
  const r = c.screenRect;
  const screen = c.media ? mediaNode(id, r, c.media, {origin: {x: r.x + r.width / 2, y: r.y + r.height / 2}}) : null;
  // An image screen stays inside the scene's one tree (both renderers nest it
  // the same way); only a video is split out, for HyperFrames to hoist.
  if (!c.media || c.media.kind !== 'video') return {front: el('div', id, abs(0, 0, W, H, {opacity: 0, overflow: 'hidden'}), camWrap(model, `${id}-cam`, [...world, back, ...(screen ? [{...screen, style: {...screen.style, opacity: 1}}] : []), ...actors, front])), media: null, overlay: null};
  return {
    front: el('div', id, abs(0, 0, W, H, {opacity: 0, overflow: 'hidden'}), camWrap(model, `${id}-cam`, [...world, back])),
    media: screen,
    overlay: el('div', `${id}-overlay`, abs(0, 0, W, H, {opacity: 0, overflow: 'hidden', pointerEvents: 'none'}), camWrap(model, `${id}-overlay-cam`, [...actors, front]))
  };
}

function castSceneTimeline(model, ops) {
  const ids = [model.id];
  if (model.content.media?.kind === 'video') ids.push(`${model.id}-media`, `${model.id}-overlay`);
  rootFade(model, ops, ids);
  followOps(model, ops);
  actorsOps(model, ops);
}

// An anchored set's camera: the plate's front-layer move, with the world
// module's own timing (worldTimeline), so the two never part.
function followOps(model, ops) {
  const f = model.content.follow;
  if (!f) return;
  const a = {x: f.from.x, scaleX: f.from.scale, scaleY: f.from.scale}, z = {x: f.to.x, scaleX: f.to.scale, scaleY: f.to.scale};
  const targets = [`${model.id}-cam`, ...(model.content.media?.kind === 'video' ? [`${model.id}-overlay-cam`] : [])];
  for (const target of targets) {
    set(ops, target, f.start, a);
    if (f.move !== 'still') tw(ops, target, f.start, rt(f.end - f.start), 'sine.inOut', a, z);
  }
}

// ---------------------------------------------------------------------------
// character-cameo

function resolveCameo(params, ctx) {
  // The cameo keeps inside a brand frame's safe area (its card kicker would
  // otherwise sit on the frame's kicker); params.rect places it within that.
  const b = createBase('character-cameo', params, ctx, {allowed: ['character', ...ACTOR_KEYS.filter(key => key !== 'id'), 'side', 'card', 'panel', 'light', 'world', 'enter', 'exit'], required: ['character'], frameSafe: true});
  const {check, rect, u, portrait} = b;
  const p = b.params;
  let cast;
  try { cast = resolveStoryCast({cast: ctx.cast ?? null, brand: ctx.brand}); } catch (error) { check.fail('story.cast', error.message); }
  const side = p.side === undefined ? 'left' : check.oneOf(p.side, 'params.side', ['left', 'right']);
  const panel = p.panel === undefined ? !p.card : check.bool(p.panel, 'params.panel');
  let card = null;
  if (p.card !== undefined) {
    check.obj(p.card, 'params.card', ['kicker', 'title', 'body'], ['title']);
    card = {kicker: p.card.kicker === undefined ? null : check.str(p.card.kicker, 'params.card.kicker', 32), title: check.str(p.card.title, 'params.card.title', 64), body: p.card.body === undefined ? null : check.str(p.card.body, 'params.card.body', 140)};
  }
  const actorRaw = {id: p.character, ...Object.fromEntries(ACTOR_KEYS.filter(key => key !== 'id' && p[key] !== undefined).map(key => [key, p[key]]))};
  const facingDefault = side === 'left' ? 'right' : 'left';
  // Character area: a column beside the card (landscape) or under it (portrait).
  const area = !card ? {...rect}
    : portrait ? {x: rect.x, y: r2(rect.y + rect.height * 0.34), width: rect.width, height: r2(rect.height * 0.66)}
      : {x: side === 'left' ? rect.x : r2(rect.x + rect.width * 0.64), y: rect.y, width: r2(rect.width * 0.36), height: rect.height};
  const world = standingWorld(b, ctx);
  const probe = inWorld(resolveActor(b, actorRaw, 'params', {cast, seated: false, slot: {facing: facingDefault}, setName: 'cameo', enter: b.start, light: sceneLight(b, p.light, ctx, world)}), world);
  const pad = u(10);
  // Sized to its tallest pose: a wave or a cheer reaches above the head.
  const tallest = Math.max(probe.height, -actorReach({...probe, x: 0, floor: 0, scale: 1}).top);
  const scale = r2(Math.min((area.height - pad * 2) / tallest, (area.width - pad * 2) / 620) * 1000) / 1000;
  const x = r2(card && portrait ? (side === 'left' ? area.x + area.width * 0.28 : area.x + area.width * 0.72) : area.x + area.width / 2);
  const floor = r2(area.y + area.height - pad);
  const placed = directActor(b, {...probe, x, floor, scale}, 'params', {focus: sceneFocus(world, ctx, b.canvas, null), actors: [{...probe, x, floor, scale}], canvas: b.canvas});
  const actor = {...placed, reach: actorReach(placed)};
  let cardBox = null;
  if (card) {
    const box = portrait ? {x: rect.x, y: rect.y, width: rect.width, height: r2(rect.height * 0.32)}
      : {x: side === 'left' ? r2(rect.x + rect.width * 0.38) : rect.x, y: r2(rect.y + rect.height * 0.12), width: r2(rect.width * 0.6), height: r2(rect.height * 0.76)};
    const inner = box.width - u(56) * 2;
    const kickerSize = r2(Math.max(b.min.meta, u(28)));
    const title = fitText(check, 'params.card.title', card.title, {family: 'display', width: inner, preferred: u(portrait ? 92 : 84), min: b.min.key, maxLines: 3});
    const body = card.body ? fitText(check, 'params.card.body', card.body, {family: 'body', width: inner, preferred: u(40), min: b.min.meta, maxLines: 4}) : null;
    cardBox = {...box, pad: u(56), kickerSize, titleSize: title.size, titleLines: title.lines, bodySize: body?.size ?? null, radius: u(32)};
  }
  castEvents(b, [actor]);
  b.model.layer = 'front';
  const content = {...castPassage(b, ctx, [actor.id]), actors: [actor], card, cardBox, panel: panel ? {x: r2(x - Math.min(area.width / 2, 340 * scale * 1.3)), y: area.y, width: r2(Math.min(area.width, 680 * scale * 1.3)), height: area.height, radius: u(36)} : null, side};
  return b.finish(content, {minTextPx: card ? cardBox.titleSize : b.min.key});
}

function cameoView(model) {
  const {id, canvas, theme, fonts} = model;
  const c = model.content;
  const kids = [];
  if (c.panel) kids.push(el('div', `${id}-panel`, abs(c.panel.x, c.panel.y, c.panel.width, c.panel.height, {borderRadius: c.panel.radius, background: theme.panel, border: `${r2(2 * model.unit)}px solid ${theme.border}`})));
  if (c.card) {
    const B = c.cardBox;
    const lines = [];
    if (c.card.kicker) lines.push(el('div', null, {fontFamily: fonts.meta, fontSize: B.kickerSize, letterSpacing: '0.14em', textTransform: 'uppercase', color: theme.accent, marginBottom: r2(18 * model.unit)}, [c.card.kicker]));
    lines.push(el('div', null, {fontFamily: fonts.display, fontSize: B.titleSize, lineHeight: '1.04', color: theme.foreground}, [c.card.title]));
    if (c.card.body) lines.push(el('div', null, {fontFamily: fonts.body, fontSize: B.bodySize, lineHeight: '1.3', color: theme.muted, marginTop: r2(22 * model.unit)}, [c.card.body]));
    kids.push(el('div', `${id}-card`, abs(B.x, B.y, B.width, B.height, {boxSizing: 'border-box', padding: B.pad, borderRadius: B.radius, background: theme.panel, border: `${r2(2 * model.unit)}px solid ${theme.border}`,
      display: 'flex', flexDirection: 'column', justifyContent: 'center', boxShadow: `0 ${r2(24 * model.unit)}px ${r2(60 * model.unit)}px #00000059`}), lines));
  }
  kids.push(actorNode(model, c.actors[0], 0));
  return {front: el('div', id, abs(0, 0, canvas.width, canvas.height, {opacity: 0}), kids), media: null, overlay: null};
}

function cameoTimeline(model, ops) {
  rootFade(model, ops, [model.id]);
  const c = model.content;
  if (c.card) {
    const rise = r2(30 * model.unit);
    set(ops, `${model.id}-card`, model.start, {opacity: 0, y: rise});
    tw(ops, `${model.id}-card`, rt(model.start + 0.15), 0.5, 'power3.out', {opacity: 0, y: rise}, {opacity: 1, y: 0});
  }
  actorsOps(model, ops);
}

// ---------------------------------------------------------------------------
// Registry

const DEFINITIONS = {
  'cast-scene': {resolve: resolveCastScene, view: castSceneView, timeline: castSceneTimeline,
    describe: 'One to three animated characters in a set (desk-laptop, phone, meeting, screen, kitchen-counter, sofa, podium, stage, car, park-bench, video-call, standing-desk, standing), acting on cues: named poses and expressions at times or narration words, mouths moving on their lines. The screen set plays a real capture.',
    params: {set: SETS.join(' | '), screen: '{src: "assets/…(image|video|demo-autopilot .mp4)", sourceStart?, fit?} (required for screen, optional for meeting)', cast: `[{id (a story-cast id, or "@1", "@2"… by place in the cast), position?: left|centre|right (default: the story cast's position, then list order), pose?, expression?, facing?: left|right (default: toward its target, else inward), target?: what it attends to (${NAMED_TARGETS.join(' | ')} | {prop} | {character} | {x, y}; it faces it and turns its head to it), cues?: [{at, pose?, expression?, action?: ${ACTIONS.join(' | ')}, target?, facing?, view?: ${VIEWS.join(' | ')}}], says?: [{from, to}] | "auto" (its own dialogue lines), holds?: phone}] 1–3; poses: ${POSES.join(', ')}; expressions: ${EXPRESSIONS.join(', ')}`, light: '{dir?: degrees the key light comes from (0 right, 90 above, 180 left) or a world vector {x, y} from the light toward the subject, color?: hex, intensity?: 0–1} (default: the world\'s light, else a soft key from the upper left); shaded drawing styles follow it', world: `{kind, time?: day|dusk|night} the world the cast stands in: its light and half its time-of-day grade (default: the track-0 world scene beneath this one)`, backdrop: `${BACKDROPS.join(' | ')}: room = the set's own room; world = only its furniture and props, recoloured and lit by the world and standing on its ground, over the world scene beneath or in params.world / story.world drawn behind it (default world when there is a world; not for video-call)`, enter: 'fade | cut: how the cast arrives (default: with the world plate beneath when it starts with it, a cut or a fade over its transition; else a fade)', exit: 'fade | cut: how the cast leaves (default: as the next plate arrives when it ends with the world beneath; else a fade)'},
    events: ['<character>-cue-<i>']},
  'character-cameo': {resolve: resolveCameo, view: cameoView, timeline: cameoTimeline,
    describe: 'One animated character beside a card (kicker, title, body) or alone on a panel, for a beat in a footage-led or explainer video.',
    params: {character: 'a cast or starter character id, or "@1", "@2"… by place in the story cast', pose: POSES.filter(p => p !== 'sit').join(' | '), expression: EXPRESSIONS.join(' | '), facing: 'left | right', target: 'what the character attends to (as cast-scene)', cues: `[{at, pose?, expression?, action?: ${ACTIONS.join(' | ')}, target?, facing?}]`, says: '[{from, to}] | "auto"', side: 'left | right (where the character stands)', card: '{kicker?, title ≤ 64, body? ≤ 140}', panel: 'boolean (default: true without a card)', rect: '{x, y, width, height} canvas px inside the safe zone (and the brand frame\'s safe area), at least half its width and 35% of its height; default: the whole safe area', light: '{dir?, color?, intensity?} the key light (as cast-scene)', world: '{kind, time?} the world the character stands in (as cast-scene)', enter: 'fade | cut (as cast-scene)', exit: 'fade | cut (as cast-scene)'},
    events: ['<character>-cue-<i>']}
};

export const MODULES = Object.fromEntries(Object.entries(DEFINITIONS).map(([id, def]) => [id, {describe: def.describe, params: def.params, events: def.events, timing: timingOf(id), resolve: def.resolve}]));

function definition(model) {
  const def = model && DEFINITIONS[model.module];
  if (!def) throw new Error(`character modules: unknown module ${model?.module}`);
  return def;
}

/** {front, media, overlay} element trees for a character model. */
export function charactersView(model) {
  return definition(model).view(model);
}

/** Renderer-neutral animation ops for a character model. */
export function charactersTimeline(model) {
  const ops = [];
  definition(model).timeline(model, ops);
  return ops;
}
