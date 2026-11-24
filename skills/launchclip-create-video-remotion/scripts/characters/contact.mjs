// Contact acting: cast members push, pull, hit, catch, lift, drop, throw and
// hand things over, with cause and effect. Each action is a timed chain:
//
//   anticipation (a wind-up against the direction) → contact (a held frame)
//   → follow-through (the force carries on into what it met) → recovery
//
// and what it meets reacts: a character recoils, squashes and looks
// surprised (on its own gag layer, so its bones keep their lengths); a prop
// squashes on contact, slides, falls, lands and settles, a paper stack's
// sheets lag and spring back, a ball bounces.
//
// A cue's `at` is the contact (the moment a word lands on), not the start:
// the wind-up plays before it. Hands reach their points with fixed bones
// (aim.mjs reachArm); a contact out of arm's length is an error that says to
// move the actor or the prop, never a stretched arm. Props are drawn on the
// scene, not in a hand (props.mjs): the hands reach the prop's grips, and a
// prop has one owner at a time; a handover goes giver alone → both hands on
// it → receiver alone.
//
// Gag squash (the cue field `squash: {amount, hold?, recover?}`): a planned
// whole-body flatten (amount > 0) or stretch (amount < 0) on the character's
// own wrapper (`<cid>-gag`), entering fast, holding, rebounding and settling.
// The rig's ordinary small dip before a move (acting.mjs MOVE.squash) is
// unchanged.
//
// Contact events (planContacts → contacts; catalog-characters.mjs
// contactEvents(model)), for spotting sound and VFX (hit-spark,
// impact-frame) onto contacts:
//
//   [{at, actor, action, kind, target}]
//     at      story seconds (the op list's clock)
//     actor   the character whose action it is (a land is the thrower's or dropper's)
//     action  push | pull | hit | catch | lift | drop | throw | give
//     kind    impact (a push or hit lands) | grip (a hand closes on it: pull,
//             lift, catch, a handover's receiver) | release (it leaves a
//             hand: throw, drop, the giver, the end of a pull) | land (a
//             dropped or thrown prop meets the floor)
//     target  {character: id} | {prop: id} | {x, y} | null
//
// Every op is an absolute set or from-to tween (seek-safe), as acting.mjs.
// Imports only sibling kit/core files.

import {set, tw} from '../catalog-b-view.mjs';
import {ACTING} from './acting.mjs';
import {CONTACT_ACTIONS, targetPoint} from './actions.mjs';
import {armReach, reachArm, shoulderAt} from './aim.mjs';
import {HAND_PROPS, gripPoints} from './props.mjs';

export const CONTACT_KINDS = Object.freeze(['impact', 'grip', 'release', 'land']);

// Phase lengths (seconds) per action, and distances (rig units).
export const CONTACT = Object.freeze({
  push: Object.freeze({wind: 0.26, strike: 0.14, hold: 0.14, follow: 0.18, recover: 0.42, shove: 120}),
  hit: Object.freeze({wind: 0.28, strike: 0.08, hold: 0.06, follow: 0.12, recover: 0.42, shove: 70}),
  pull: Object.freeze({reach: 0.34, hold: 0.12, pull: 0.36, recover: 0.4, haul: 110}),
  throw: Object.freeze({wind: 0.3, strike: 0.1, follow: 0.14, recover: 0.4}),
  drop: Object.freeze({open: 0.12, recover: 0.36}),
  lift: Object.freeze({reach: 0.46, strain: 0.2, rise: 0.5}),
  give: Object.freeze({reach: 0.42, shared: 0.3, back: 0.4}),
  catch: Object.freeze({reach: 0.3, absorb: 0.18, settle: 0.3})
});

// The gag squash cue: entry seconds, default hold and recovery, the amount's range.
export const GAG = Object.freeze({entry: 0.08, hold: 0.25, recover: 0.4, min: -0.6, max: 0.8});

const rt = v => Math.round(v * 10000) / 10000;
const r2 = v => Math.round(v * 100) / 100;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const signOf = facing => (facing === 'left' ? -1 : 1);
const armSide = sigma => (sigma < 0 ? 'L' : 'R');
const bodyHalf = g => g.armX + g.armW * 0.5;
const chestY = a => a.floor - (a.marks?.chest ?? a.height * 0.6) * a.scale;
const scene = t => r2(t);

/** Problems with a squash cue value ({amount, hold?, recover?}), or null. */
export function squashError(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'must be {amount, hold?, recover?}';
  for (const key of Object.keys(value)) if (!['amount', 'hold', 'recover'].includes(key)) return `.${key} is not supported (allowed: amount, hold, recover)`;
  if (!Number.isFinite(value.amount) || value.amount < GAG.min || value.amount > GAG.max || Math.abs(value.amount) < 0.02) return `.amount must be ${GAG.min}–${GAG.max} (more than 0 flattens, less than 0 stretches; not 0)`;
  if (value.hold !== undefined && !(Number.isFinite(value.hold) && value.hold >= 0 && value.hold <= 3)) return '.hold must be 0–3 seconds';
  if (value.recover !== undefined && !(Number.isFinite(value.recover) && value.recover >= 0.1 && value.recover <= 2)) return '.recover must be 0.1–2 seconds';
  return null;
}

/** Seconds a squash cue lasts from its `at`. */
export const squashLength = q => GAG.entry + (q.hold ?? GAG.hold) + (q.recover ?? GAG.recover);

/** A squash to (sx, sy), a rebound past rest by a third, and a settle. */
function wobble(ops, target, t, sx, sy, {out = 0.06, hold = 0, back = 0.3, ease = 'power2.out'} = {}) {
  const rest = {scaleX: 1, scaleY: 1}, low = {scaleX: r2(sx), scaleY: r2(sy)}, over = {scaleX: r2(1 + (1 - sx) * 0.3), scaleY: r2(1 + (1 - sy) * 0.3)};
  tw(ops, target, rt(t), out, ease, rest, low);
  tw(ops, target, rt(t + out + hold), rt(back * 0.4), 'sine.inOut', low, over);
  tw(ops, target, rt(t + out + hold + back * 0.4), rt(back * 0.6), 'sine.out', over, rest);
}

/** A gag squash cue's scales: amount > 0 flattens, < 0 stretches. */
export function squashScales(amount) {
  return amount > 0 ? {scaleX: r2(1 + amount * 0.6), scaleY: r2(1 - amount)} : {scaleX: r2(1 + amount * 0.4), scaleY: r2(1 - amount)};
}

/** A knocked character's stagger on its gag layer: away (or toward), tipped, held, and back. */
function recoil(ops, target, t, dx, tilt, {out, hold, back}) {
  const rest = {x: 0, rotation: 0}, to = {x: r2(dx), rotation: r2(tilt)};
  tw(ops, target, rt(t), out, 'power2.out', rest, to);
  tw(ops, target, rt(t + out + hold), back, 'sine.inOut', to, rest);
}

// The state fields a phase keeps from the cue it plays (or the state it interrupts).
const KEEP = ['facing', 'standing', 'gaze', 'view', 'x', 'target', 'point', 'expression'];
function phase(base, time, tween, ease, extra = {}) {
  const out = {time: rt(time), pose: 'stand', tween: rt(tween), ease};
  for (const key of KEEP) if (base[key] !== undefined) out[key] = base[key];
  return {...out, contact: true, ...extra};
}

function activeState(actor, t) {
  let found = actor.states[0];
  for (const state of actor.states) if (state.time <= t + 1e-9) found = state;
  return found;
}

/**
 * Plan every contact action and squash cue in a scene.
 *   actors   directed actors ({id, x, floor, scale, geometry, marks, height,
 *            facing, holds, states: [{time, pose, action?, cueTarget?, squash?, x, facing, …}]})
 *   objects  props on the floor: [{id, prop, x}] (canvas px; they stand on the actors' floor)
 *   canvas, start, end   the scene's canvas and story seconds
 *   prefix   the scene's id (element ids: <prefix>-obj-<id>, <prefix>-c<i>-gag)
 *   paths    each actor's params path, for errors
 *   targets  the scene targetPoint() resolves in ({focus, actors, canvas, anchorsOf})
 * → {actors (states expanded, carry arms set), props: [{id, prop, x, y}],
 *    ops (renderer-neutral), contacts (see the top of this file), gag: [actor index]}
 * Throws an Error with `where` (a params path) when an action cannot play.
 */
export function planContacts({actors: input, objects = [], canvas, start, end, prefix, paths = [], targets = null}) {
  const actors = input.map(actor => ({...actor, expressions: [...actor.expressions], states: actor.states.map(state => ({...state}))}));
  const ops = [], contacts = [], gag = new Set();
  // A failure carries where the floor props had moved by then (moves), so the caller can re-aim walks at them and try again.
  const fail = (index, message) => { throw Object.assign(new Error(message), {where: `${paths[index] ?? `params.cast[${index}]`}.cues`, moves: moves()}); };
  const indexOf = actor => actors.indexOf(actor);
  const gagOf = actor => { gag.add(indexOf(actor)); return `${prefix}-c${indexOf(actor)}-gag`; };
  const xAt = (actor, t) => actor.x + (activeState(actor, t).x ?? 0);

  // Props: the floor objects and the ones held from the start (holds: a prop name).
  const props = new Map();
  for (const object of objects) props.set(object.id, {...object, def: HAND_PROPS[object.prop], keys: [], spans: [], owner: null, x: object.x, y: object.y, x0: object.x, y0: object.y});
  actors.forEach((actor, index) => {
    if (!HAND_PROPS[actor.holds]) return;
    if (props.has(actor.holds)) fail(index, `holds ${actor.holds}, which ${props.get(actor.holds).owner ? `${props.get(actor.holds).owner.id} already holds` : 'is also on the floor (params.objects)'}; give each prop its own id in params.objects`);
    props.set(actor.holds, {id: actor.holds, prop: actor.holds, def: HAND_PROPS[actor.holds], keys: [], spans: [{actor, from: -Infinity, to: Infinity}], owner: actor, x: null, y: null, x0: undefined, y0: undefined});
  });
  const heldBy = actor => [...props.values()].find(prop => prop.owner === actor) ?? null;
  const gain = (prop, actor, t) => { prop.owner = actor; prop.spans.push({actor, from: t, to: Infinity}); };
  const lose = (prop, t) => { const span = prop.spans.at(-1); if (span) span.to = t; prop.owner = null; };
  const key = (prop, time, dur, ease, to, extra = {}) => prop.keys.push({time: rt(time), dur: rt(dur), ease, to, ...extra});
  const event = (t, actor, action, kind, target) => contacts.push({at: rt(t), actor: actor.id, action, kind, target: target ?? null});
  // Where each floor prop is from when (its moves so far): [{time, x, y}] per id, for targeting a prop that has moved.
  const moves = () => Object.fromEntries([...props.values()].filter(prop => !prop.spans.length || prop.spans[0].from > -Infinity).map(prop => {
    const now = {x: prop.x0, y: prop.y0}, out = [{time: start, x: r2(now.x), y: r2(now.y)}];
    for (const k of prop.keys.map((one, n) => ({...one, n})).sort((a, b) => a.time - b.time || a.n - b.n)) {
      if (k.to.x === undefined && k.to.y === undefined) continue;
      Object.assign(now, k.to);
      out.push({time: k.time, x: r2(now.x), y: r2(now.y)});
    }
    return [prop.id, out];
  }));

  /** Where a carried prop sits for an actor in a state (its walk offset and body). */
  const carryCenter = (actor, state, prop, dx = state.x ?? 0) => {
    const def = prop.def, s = actor.scale, g = actor.geometry, sigma = signOf(state.facing ?? actor.facing), body = state.body ?? {};
    if (def.hands === 2) return {x: actor.x + dx + sigma * 30 * s, y: actor.floor + (g.hipY + (body.bodyY ?? 0) - 100) * s};
    const S = shoulderAt(actor, armSide(sigma), body, dx);
    return {x: S.x + (sigma * 110 - def.grip.x) * s, y: S.y + (170 - def.grip.y) * s};
  };
  const carryGrips = (actor, state, prop, center) => gripPoints(prop.prop, {cx: center.x, cy: center.y, s: actor.scale, side: armSide(signOf(state.facing ?? actor.facing))});

  /** Arms that put each named hand on its point: {arms, short (px past arm's length; 0 when every hand reaches)}. */
  const solve = (actor, state, hands, body = {}) => {
    const arms = {};
    let short = 0;
    for (const [side, point] of Object.entries(hands)) {
      const S = shoulderAt(actor, side, body, state.x ?? 0);
      const a = reachArm({shoulder: S, side, target: point, geometry: actor.geometry, scale: actor.scale, lean: body.lean ?? 0});
      if (!a.reached) short = Math.max(short, Math.hypot(point.x - S.x, point.y - S.y) - armReach(actor.geometry) * actor.scale);
      arms[`arm${side}`] = a.arm;
      arms[`fore${side}`] = a.fore;
    }
    return {arms, short: r2(short)};
  };
  /**
   * The least bend that lets every hand reach: the legs give (a crouch: they
   * shorten and the body drops onto them, feet on the floor) and the body
   * leans in toward sigma, from `from` degrees, preferring a lean to a deep
   * crouch. → {body, arms, short: 0} | {short (px still out of reach)}
   */
  const bend = (actor, state, hands, sigma, from = 0) => {
    let best = null;
    for (let k = 1; k >= 0.44 - 1e-9; k -= 0.04) for (let lean = from; lean <= 85; lean += 5) {
      const cost = (1 - k) * 120 + lean;
      if (best && cost >= best.cost) continue;
      const body = k > 0.999 ? {lean: r2(sigma * lean)} : {legScale: r2(k), bodyY: r2(-actor.geometry.hipY * (1 - k)), lean: r2(sigma * lean)};
      const sol = solve(actor, state, hands, body);
      if (sol.short <= 0) best = {cost, body, arms: sol.arms, short: 0};
    }
    if (best) return {body: best.body, arms: best.arms, short: 0};
    return {short: solve(actor, state, hands, {lean: sigma * from}).short};
  };
  const must = (actor, label, what, sol) => {
    if (sol.short > 0) fail(indexOf(actor), `${label}: ${actor.id}'s hand cannot reach ${what}: it is ${Math.round(sol.short)} px past arm's length (bones never stretch); stand closer (walk-to it first, or change positions) or move the prop`);
    return sol.arms;
  };

  /** Put an action's phases into an actor's states: its window must be free of the actor's other moves. */
  const place = (actor, frames, cue, label) => {
    const ws = frames[0].time, we = Math.max(...frames.map(f => f.time + (f.tween ?? 0)));
    const at = t => `${scene(t - start)} s`;
    if (ws < start - 1e-6) fail(indexOf(actor), `${label} winds up from ${at(ws)}, before the scene starts; move it at least ${scene(start - ws)} s later`);
    if (we > end + 1e-6) fail(indexOf(actor), `${label} recovers until ${at(we)}, after the scene ends at ${at(end)}; move it earlier`);
    const first = actor.states[0];
    const others = actor.states.filter(state => state !== cue || state === first);
    if (cue === first) for (const field of ['action', 'cueTarget', 'squash', 'posed']) delete first[field];
    // A cue that only changes the face (or squashes on the gag layer) may land inside the chain.
    const faceOnly = state => state.reaction || (!state.posed && !state.action && state.cueTarget === undefined && !state.walk && !state.arrive && !state.contact && !state.shot);
    const inside = state => state !== first && state.time > ws - 1e-6 && state.time < we + 1e-6;
    const clash = others.find(state => inside(state) && !faceOnly(state));
    if (clash) fail(indexOf(actor), `${label} plays from ${at(ws)} to ${at(we)}; ${actor.id}'s ${clash.contact ? 'other action' : 'cue'} at ${at(clash.time)} falls inside it: move one`);
    const prev = others.filter(state => state.time < ws - 1e-6 && !faceOnly(state)).at(-1);
    if (prev && prev !== first) {
      // A walk's arrival only settles the legs: an action may wind up as the walker arrives.
      const settled = prev.time + (prev.arrive ? 0 : prev.walk ? prev.walk.duration : prev.tween ?? ACTING.poseTween);
      if (settled > ws + 1e-6) fail(indexOf(actor), `${label} winds up from ${at(ws)}, before ${actor.id}'s move at ${at(prev.time)} has settled (${at(settled)}); move it later`);
    }
    // The recovery returns to the pose the cue names, else the one the action interrupted.
    const rest = cue?.posed ? cue.pose : prev?.pose ?? first.pose;
    for (const f of frames) if (f.rest) { f.pose = rest; delete f.rest; }
    // A face-only cue inside the chain takes the phase it lands in, keeping its own face.
    for (const state of others.filter(inside)) {
      const under = frames.filter(f => f.time <= state.time + 1e-9).at(-1);
      if (!under) continue;
      const {time, expression, squash} = state;
      for (const field of Object.keys(state)) delete state[field];
      Object.assign(state, under, {time, expression, ...(squash ? {squash} : {}), reaction: true});
    }
    actor.states = [...others, ...frames].sort((a, b) => a.time - b.time);
  };

  /** A reacting character's face changes on the contact (it keeps its pose). */
  const react = (actor, t, expression) => {
    if (t < start || t > end) return;
    const {walk: _walk, arrive: _arrive, shot: _shot, action: _action, cueTarget: _cueTarget, squash: _squash, ...base} = activeState(actor, t);
    actor.states.push({...base, time: rt(t), expression, reaction: true});
    actor.states.sort((a, b) => a.time - b.time);
    if (!actor.expressions.includes(expression)) actor.expressions.push(expression);
  };

  /** What a contact action is aimed at: a character, a prop in the scene, or a point. */
  const resolveTarget = (actor, target, t, label, allow) => {
    if (target && typeof target === 'object' && target.character !== undefined) {
      const other = actors.find(one => one.id === target.character);
      if (!other) fail(indexOf(actor), `${label}: ${target.character} is not in this scene`);
      if (other === actor) fail(indexOf(actor), `${label}: a character cannot ${label.split(' ')[0]} itself`);
      if (allow.includes('character')) return {kind: 'character', other};
    } else if (target && typeof target === 'object' && target.prop !== undefined && props.has(target.prop)) {
      if (allow.includes('prop')) return {kind: 'prop', prop: props.get(target.prop)};
    } else if (target !== null && target !== undefined && allow.includes('point')) {
      let point;
      try { point = targetPoint(target, targets ?? {focus: null, actors, canvas}); } catch (error) { fail(indexOf(actor), `${label}: ${error.message}`); }
      return {kind: 'point', point: {x: point.x ?? xAt(actor, t), y: point.y ?? chestY(actor)}};
    }
    fail(indexOf(actor), `${label} needs ${allow.map(kind => ({character: '{character: id}', prop: '{prop: id} (a prop in params.objects or held)', point: '{x, y} or a named target'})[kind]).join(' or ')}`);
  };
  // An action faces what it is aimed at where that is by now (a prop may have been pushed past the actor).
  const targetX = (target, t) => (target.kind === 'character' ? xAt(target.other, t) : target.kind === 'prop' ? target.prop.x : target.point.x);
  const toward = (actor, cue, x) => {
    const dx = x - xAt(actor, cue.time);
    const sigma = Math.abs(dx) < 1 ? signOf(cue.facing ?? actor.facing) : Math.sign(dx);
    return {sigma, cue: {...cue, facing: sigma < 0 ? 'left' : 'right'}};
  };
  const handsFree = (actor, label) => { const prop = heldBy(actor); if (prop) fail(indexOf(actor), `${label}: ${actor.id} has its hands full (it holds ${prop.id}); drop, throw or give it first`); };
  const holding = (actor, label) => heldBy(actor) ?? fail(indexOf(actor), `${label}: ${actor.id} holds nothing (holds: a prop, or lift or catch one first)`);
  const person = (actor, label, t) => {
    if (!actor.geometry?.upperArm || actor.geometry.noAim) fail(indexOf(actor), `${label}: ${actor.id} has no arms to act with (contact actions are for people)`);
    if (actor.seated && !activeState(actor, t).standing) fail(indexOf(actor), `${label} needs ${actor.id} standing: add a stand-up cue before it`);
  };
  const landing = (prop, t, actor, action) => {
    event(t, actor, action, 'land', {prop: prop.id});
    const id = `${prefix}-obj-${prop.id}`;
    wobble(ops, `${id}-sq`, t, 1.16, 0.8, {out: 0.05, back: 0.32});
    if (prop.def.layers) layerLag(ops, id, prop.def.layers, t, 0, -6);
    if (prop.def.bouncy) {
      const y = prop.y, s = actor.scale;
      key(prop, t, 0.18, 'power2.out', {y: y - 60 * s});
      key(prop, t + 0.18, 0.18, 'power2.in', {y});
      key(prop, t + 0.36, 0.1, 'power2.out', {y: y - 18 * s});
      key(prop, t + 0.46, 0.1, 'power2.in', {y});
    }
  };

  // --- push and hit: a strike with the facing hand.
  function strike(job) {
    const {actor, cue, action} = job, T = CONTACT[action], tc = cue.time, label = `${action} at ${scene(tc - start)} s`;
    person(actor, label, tc); handsFree(actor, label);
    const target = resolveTarget(actor, cue.cueTarget, tc, label, ['character', 'prop', 'point']);
    const {sigma, cue: faced} = toward(actor, cue, targetX(target, tc)), side = armSide(sigma), s = actor.scale;
    let C, what;
    if (target.kind === 'character') { C = {x: xAt(target.other, tc) - sigma * bodyHalf(target.other.geometry) * target.other.scale, y: chestY(target.other)}; what = target.other.id; }
    else if (target.kind === 'prop') {
      if (target.prop.owner) fail(indexOf(actor), `${label}: ${target.prop.id} is in ${target.prop.owner.id}'s hands; aim at ${target.prop.owner.id}`);
      C = {x: target.prop.x - sigma * target.prop.def.w / 2 * s, y: target.prop.y}; what = target.prop.id;
    } else { C = target.point; what = 'the point'; }
    const S = shoulderAt(actor, side, {}, faced.x ?? 0);
    const hit = action === 'hit';
    const lean = {wind: -sigma * 4, strike: sigma * (hit ? 6 : 9), follow: sigma * (hit ? 8 : 11)};
    const wind = hit ? {x: S.x - sigma * 50 * s, y: S.y - 40 * s} : {x: S.x - sigma * 10 * s, y: S.y + 110 * s};
    const through = hit ? {x: C.x + sigma * 50 * s, y: C.y + 40 * s} : {x: C.x + sigma * 40 * s, y: C.y};
    // The contact: leaning in, bending down to it when it is low (a prop on the floor).
    const reach = bend(actor, faced, {[side]: C}, sigma, Math.abs(lean.strike));
    must(actor, label, what, reach);
    const followBody = {...reach.body, lean: r2(reach.body.lean + sigma * 3)};
    place(actor, [
      phase(faced, tc - T.strike - T.wind, T.wind, 'power2.out', {arms: solve(actor, faced, {[side]: wind}, {lean: lean.wind}).arms, body: {lean: lean.wind}}),
      phase(faced, tc - T.strike, T.strike, hit ? 'power3.in' : 'power2.in', {arms: reach.arms, body: reach.body, ...(cue.shot ? {shot: cue.shot} : {})}),
      phase(faced, tc + T.hold, T.follow, 'power2.out', {arms: solve(actor, faced, {[side]: through}, followBody).arms, body: followBody}),
      phase(faced, tc + T.hold + T.follow + 0.06, T.recover, 'sine.inOut', {rest: true, contact: false})
    ], cue, label);
    const targetRef = target.kind === 'character' ? {character: target.other.id} : target.kind === 'prop' ? {prop: target.prop.id} : {x: r2(C.x), y: r2(C.y)};
    event(tc, actor, action, 'impact', targetRef);
    if (target.kind === 'character') {
      const other = target.other, g = gagOf(other);
      recoil(ops, g, tc, sigma * T.shove * other.scale, sigma * (hit ? 12 : 7), hit ? {out: 0.12, hold: 0.1, back: 0.5} : {out: 0.22, hold: 0.12, back: 0.55});
      if (hit) wobble(ops, g, tc, 0.88, 1.08, {out: 0.05, back: 0.3});
      react(other, tc, 'surprised');
    } else if (target.kind === 'prop') {
      const prop = target.prop, id = `${prefix}-obj-${prop.id}`;
      wobble(ops, `${id}-sq`, tc, hit ? 0.8 : 0.85, hit ? 1.14 : 1.1, {out: 0.06, back: 0.34});
      if (prop.def.layers) layerLag(ops, id, prop.def.layers, tc, -sigma * 16, 0);
      if (hit) {
        key(prop, tc, 0.12, 'power2.out', {y: prop.y - 30 * s});
        key(prop, tc + 0.12, 0.14, 'power2.in', {y: prop.y});
      } else {
        // It slides until it would meet someone (it stops short of them) or the frame's edge.
        const half = prop.def.w / 2 * s;
        let x = clamp(prop.x + sigma * T.shove * s, half, canvas.width - half);
        for (const other of actors) {
          const ox = xAt(other, tc);
          if (other === actor || sigma * (ox - prop.x) <= 0) continue;
          const stop = ox - sigma * (bodyHalf(other.geometry) * other.scale + 20 * s + half);
          if (sigma * (x - stop) > 0) x = stop;
        }
        if (sigma * (x - prop.x) < 0) x = prop.x;
        key(prop, tc, T.hold + T.follow, 'power2.out', {x});
        prop.x = x;
      }
    }
  }

  // --- pull: grip, haul toward the body, let go.
  function pull(job) {
    const {actor, cue} = job, T = CONTACT.pull, tc = cue.time, label = `pull at ${scene(tc - start)} s`;
    person(actor, label, tc); handsFree(actor, label);
    const target = resolveTarget(actor, cue.cueTarget, tc, label, ['character', 'prop']);
    const {sigma, cue: faced} = toward(actor, cue, targetX(target, tc)), side = armSide(sigma), s = actor.scale;
    let C, what, haul;
    if (target.kind === 'character') {
      const other = target.other;
      C = {x: xAt(other, tc) - sigma * bodyHalf(other.geometry) * other.scale, y: chestY(other)}; what = other.id;
      haul = T.haul * 0.5;
    } else {
      const prop = target.prop;
      if (prop.owner) fail(indexOf(actor), `${label}: ${prop.id} is in ${prop.owner.id}'s hands`);
      C = {x: prop.x - sigma * prop.def.w / 2 * s, y: prop.y}; what = prop.id;
      // The prop stops short of the puller's body.
      haul = clamp(sigma * (C.x - xAt(actor, tc)) / s - bodyHalf(actor.geometry) - 50, 0, T.haul);
    }
    const back = {x: C.x - sigma * haul * s, y: C.y};
    const reach = bend(actor, faced, {[side]: C}, sigma, 5);
    must(actor, label, what, reach);
    // Hauling: the body leans back from its reach (sitting back into the crouch for a low prop).
    const haulBody = {...reach.body, lean: r2(reach.body.lean - sigma * 22)};
    place(actor, [
      phase(faced, tc - T.reach, T.reach, 'power2.inOut', {arms: reach.arms, body: reach.body, ...(cue.shot ? {shot: cue.shot} : {})}),
      phase(faced, tc + T.hold, T.pull, 'power2.inOut', {arms: solve(actor, faced, {[side]: back}, haulBody).arms, body: haulBody}),
      phase(faced, tc + T.hold + T.pull + 0.05, T.recover, 'sine.inOut', {rest: true, contact: false})
    ], cue, label);
    const ref = target.kind === 'character' ? {character: target.other.id} : {prop: target.prop.id};
    event(tc, actor, 'pull', 'grip', ref);
    event(tc + T.hold + T.pull, actor, 'pull', 'release', ref);
    if (target.kind === 'character') {
      recoil(ops, gagOf(target.other), tc + T.hold, -sigma * haul * target.other.scale, -sigma * 8, {out: T.pull, hold: 0.15, back: 0.5});
      react(target.other, tc, 'surprised');
    } else if (haul > 1) {
      const prop = target.prop;
      key(prop, tc + T.hold, T.pull, 'power2.inOut', {x: back.x + sigma * prop.def.w / 2 * s});
      prop.x = back.x + sigma * prop.def.w / 2 * s;
      if (prop.def.layers) layerLag(ops, `${prefix}-obj-${prop.id}`, prop.def.layers, tc + T.hold, sigma * 12, 0);
    }
  }

  // --- lift: crouch, grip, (strain), rise into a carry.
  function lift(job) {
    const {actor, cue} = job, T = CONTACT.lift, tc = cue.time, label = `lift at ${scene(tc - start)} s`;
    person(actor, label, tc); handsFree(actor, label);
    const target = resolveTarget(actor, cue.cueTarget, tc, label, ['prop']);
    const prop = target.prop;
    if (prop.owner) fail(indexOf(actor), `${label}: ${prop.id} is in ${prop.owner.id}'s hands`);
    const {sigma, cue: faced} = toward(actor, cue, prop.x), s = actor.scale;
    const grips = gripPoints(prop.prop, {cx: prop.x, cy: prop.y, s, side: armSide(sigma)});
    // Bent over it: the least crouch and lean from which both hands reach its grips.
    const bent = bend(actor, faced, grips, sigma, 20);
    const crouch = bent.short > 0 ? null : {body: bent.body, arms: bent.arms};
    if (!crouch) fail(indexOf(actor), `${label}: ${actor.id} cannot reach ${prop.id} on the floor even crouching; walk-to {prop: "${prop.id}"} first`);
    const strain = prop.def.heavy ? T.strain : 0.05;
    const frames = [phase(faced, tc - T.reach, T.reach, 'power2.inOut', {...crouch, ...(cue.shot ? {shot: cue.shot} : {})})];
    if (prop.def.heavy) {
      // A heavy box resists: the body strains and it barely leaves the floor before the lift.
      const body = {...crouch.body, bodyY: r2((crouch.body.bodyY ?? 0) - 8), lean: r2(crouch.body.lean * 0.85)};
      const up = gripPoints(prop.prop, {cx: prop.x, cy: prop.y - 8 * s, s, side: armSide(sigma)});
      frames.push(phase(faced, tc + 0.04, strain - 0.04, 'sine.inOut', {arms: solve(actor, faced, up, body).arms, body}));
      key(prop, tc + 0.04, strain - 0.04, 'sine.inOut', {y: prop.y - 8 * s});
    }
    frames.push(phase(faced, tc + strain, T.rise, 'power2.inOut', {rest: true, contact: false}));
    place(actor, frames, cue, label);
    gain(prop, actor, tc);
    event(tc, actor, 'lift', 'grip', {prop: prop.id});
  }

  // --- drop: the hands open, the prop falls and lands.
  function drop(job) {
    const {actor, cue} = job, T = CONTACT.drop, tc = cue.time, label = `drop at ${scene(tc - start)} s`;
    person(actor, label, tc);
    const prop = holding(actor, label), s = actor.scale;
    const center = carryCenter(actor, cue, prop);
    const open = Object.fromEntries(Object.entries(carryGrips(actor, cue, prop, center)).map(([side, p]) => [side, {x: p.x + (side === 'L' ? -26 : 26) * s, y: p.y - 18 * s}]));
    place(actor, [
      phase(cue, tc, T.open, 'power2.out', {arms: solve(actor, cue, open).arms}),
      phase(cue, tc + T.open + 0.08, T.recover, 'sine.inOut', {rest: true, contact: false})
    ], cue, label);
    lose(prop, tc);
    event(tc, actor, 'drop', 'release', {prop: prop.id});
    const floorY = actor.floor - prop.def.h / 2 * s;
    const fall = r2(clamp(0.2 + (floorY - center.y) / canvas.height * 0.9, 0.22, 0.55));
    key(prop, tc, fall, 'power2.in', {x: center.x, y: floorY});
    Object.assign(prop, {x: center.x, y: floorY});
    landing(prop, tc + fall, actor, 'drop');
  }

  // --- throw: wind back, release on `at`, the prop flies to a catcher or the floor.
  function toss(job) {
    const {actor, action} = job;
    const s = actor.scale;
    const catcher = job.catcher ?? null;
    const ref = job.cue ? job.cue.time : job.lands;
    const base = job.cue ?? {...activeState(actor, ref - 0.6), facing: xAt(catcher, ref) < xAt(actor, ref) ? 'left' : 'right'};
    const sigma = signOf(base.facing ?? actor.facing), side = armSide(sigma);
    const T = CONTACT.throw;
    const labelAt = t => `${action} at ${scene(t - start)} s`;
    const prop = holding(actor, labelAt(job.cue?.time ?? job.lands));
    const def = prop.def;
    // The hand (one hand) or the prop's centre (two) behind, then ahead and up.
    const mid = (() => { const l = shoulderAt(actor, 'L', {}, base.x ?? 0), r = shoulderAt(actor, 'R', {}, base.x ?? 0); return {x: (l.x + r.x) / 2, y: (l.y + r.y) / 2}; })();
    const S = shoulderAt(actor, side, {}, base.x ?? 0);
    const centreOf = (hand) => (def.hands === 2 ? hand : {x: hand.x - def.grip.x * s, y: hand.y - def.grip.y * s});
    const W = centreOf(def.hands === 2 ? {x: mid.x - sigma * 30 * s, y: mid.y - 170 * s} : {x: S.x - sigma * 90 * s, y: S.y - 70 * s});
    const R = centreOf(def.hands === 2 ? {x: mid.x + sigma * 60 * s, y: mid.y - 120 * s} : {x: S.x + sigma * 120 * s, y: S.y - 110 * s});
    let D, catchHands = null, sigmaQ = 0;
    if (catcher) {
      sigmaQ = xAt(actor, ref) < xAt(catcher, ref) ? -1 : 1;
      D = {x: xAt(catcher, ref) + sigmaQ * (bodyHalf(catcher.geometry) * catcher.scale + (40 + def.w / 2) * s), y: chestY(catcher)};
    } else {
      const half = def.w / 2 * s;
      const p = job.point ?? {x: xAt(actor, ref) + sigma * canvas.width * 0.3};
      D = {x: clamp(p.x, half, canvas.width - half), y: actor.floor - def.h / 2 * s};
    }
    const flight = r2(clamp(0.35 + Math.abs(D.x - R.x) / canvas.width * 0.9, 0.4, 0.9));
    const tc = job.cue ? job.cue.time : rt(job.lands - flight);
    const tl = rt(tc + flight);
    // A catch cue drives its thrower's throw; the thrower's own throw cue to the catcher is then the same throw.
    const label = job.cue ? labelAt(tc) : `catch at ${scene(tl - start)} s (${catcher.id}'s catch makes ${actor.id} throw, released at ${scene(tc - start)} s; leave out ${actor.id}'s own throw cue)`;
    if (job.cue && job.catchCue && Math.abs(tl - job.catchCue.time) > 0.1) fail(indexOf(catcher), `catch at ${scene(job.catchCue.time - start)} s: ${actor.id}'s throw at ${scene(tc - start)} s lands in ${catcher.id}'s hands at ${scene(tl - start)} s; give only one of them (a catch cue alone times the throw to land on it)`);
    person(actor, label, tc);
    const gripsAt = c => gripPoints(prop.prop, {cx: c.x, cy: c.y, s, side});
    const follow = Object.fromEntries(Object.keys(gripsAt(R)).map(arm => { const sh = shoulderAt(actor, arm, {}, base.x ?? 0); return [arm, {x: sh.x + sigma * 150 * s, y: sh.y + 90 * s}]; }));
    place(actor, [
      phase(base, tc - T.strike - T.wind, T.wind, 'power2.out', {arms: solve(actor, base, gripsAt(W), {lean: -sigma * 5}).arms, body: {lean: -sigma * 5}}),
      phase(base, tc - T.strike, T.strike, 'power2.in', {arms: solve(actor, base, gripsAt(R), {lean: sigma * 6}).arms, body: {lean: sigma * 6}, ...(base.shot && job.cue ? {shot: base.shot} : {})}),
      phase(base, tc, T.follow, 'power2.out', {arms: solve(actor, base, follow, {lean: sigma * 8}).arms, body: {lean: sigma * 8}}),
      phase(base, tc + T.follow + 0.05, T.recover, 'sine.inOut', {rest: true, contact: false})
    ], job.cue ?? null, label);
    key(prop, tc - T.strike - T.wind, T.wind, 'power2.out', W);
    key(prop, tc - T.strike, T.strike, 'power2.in', R);
    lose(prop, tc);
    event(tc, actor, 'throw', 'release', catcher ? {character: catcher.id} : {x: r2(D.x), y: r2(D.y)});
    // The flight: straight across, up and over in an arc, one turn.
    const apex = Math.min(R.y, D.y) - (0.18 * Math.abs(D.x - R.x) + 40 * s);
    key(prop, tc, flight, 'none', {x: D.x});
    key(prop, tc, flight, 'none', {}, {spin: sigma * 360});
    key(prop, tc, flight / 2, 'power2.out', {y: apex});
    key(prop, tc + flight / 2, flight / 2, 'power2.in', {y: D.y});
    Object.assign(prop, {x: D.x, y: D.y});
    if (!catcher) { landing(prop, tl, actor, 'throw'); return; }
    // The catch: hands up to meet it, give with it as it lands, settle into a carry.
    const C = CONTACT.catch, qLabel = `catch at ${scene(tl - start)} s`;
    person(catcher, qLabel, tl); handsFree(catcher, qLabel);
    const qBase = job.catchCue ?? activeState(catcher, tl - C.reach);
    const facing = sigmaQ < 0 ? 'right' : 'left';
    catchHands = gripPoints(prop.prop, {cx: D.x, cy: D.y, s: catcher.scale, side: armSide(-sigmaQ)});
    const qState = {...qBase, facing};
    place(catcher, [
      phase(qState, tl - C.reach, C.reach, 'power2.out', {arms: must(catcher, qLabel, prop.id, solve(catcher, qState, catchHands)), ...(job.catchCue?.shot ? {shot: job.catchCue.shot} : {})}),
      phase(qState, tl, C.absorb, 'power2.out', {rest: true, contact: false, body: {bodyY: 18, lean: r2(sigmaQ * 4)}}),
      phase(qState, tl + C.absorb, C.settle, 'sine.inOut', {rest: true, contact: false})
    ], job.catchCue ?? null, qLabel);
    gain(prop, catcher, tl);
    event(tl, catcher, 'catch', 'grip', {prop: prop.id});
    wobble(ops, `${prefix}-obj-${prop.id}-sq`, tl, 1.08, 0.9, {out: 0.05, back: 0.24});
  }

  // --- give: giver alone → both hands on it → receiver alone.
  function give(job) {
    const {actor, cue} = job, T = CONTACT.give, tc = cue.time, label = `give at ${scene(tc - start)} s`;
    person(actor, label, tc);
    const prop = holding(actor, label);
    const target = resolveTarget(actor, cue.cueTarget, tc, label, ['character']);
    const other = target.other;
    const qLabel = `${label} (to ${other.id})`;
    person(other, qLabel, tc); handsFree(other, qLabel);
    const sigma = xAt(other, tc) < xAt(actor, tc) ? -1 : 1, s = actor.scale;
    const ya = shoulderAt(actor, 'L', {}, cue.x ?? 0).y, qBase = {...activeState(other, tc - 0.3), facing: sigma < 0 ? 'right' : 'left'};
    const yb = shoulderAt(other, 'L', {}, qBase.x ?? 0).y;
    const M = {x: (xAt(actor, tc) + xAt(other, tc)) / 2, y: (ya + yb) / 2 + 120 * s};
    const giverHands = gripPoints(prop.prop, {cx: M.x, cy: M.y, s, side: armSide(sigma), mode: 'near', from: -sigma});
    const takerHands = gripPoints(prop.prop, {cx: M.x, cy: M.y, s, side: armSide(-sigma), mode: 'near', from: sigma});
    const tooFar = sol => { if (sol.short > 0) fail(indexOf(actor), `${label}: ${actor.id} and ${other.id} stand too far apart to hand ${prop.id} over (a hand is ${Math.round(sol.short)} px short of the middle); walk one toward the other first`); return sol.arms; };
    place(actor, [
      phase(cue, tc - T.reach, T.reach, 'power2.inOut', {arms: tooFar(solve(actor, cue, giverHands, {lean: sigma * 4})), body: {lean: sigma * 4}, ...(cue.shot ? {shot: cue.shot} : {})}),
      phase(cue, tc + T.shared, T.back, 'sine.inOut', {rest: true, contact: false})
    ], cue, label);
    key(prop, tc - T.reach, T.reach, 'power2.inOut', M);
    Object.assign(prop, {x: M.x, y: M.y});
    place(other, [
      phase(qBase, tc - 0.3, 0.3, 'power2.out', {arms: tooFar(solve(other, qBase, takerHands, {lean: -sigma * 4})), body: {lean: -sigma * 4}}),
      phase(qBase, tc + T.shared, T.back, 'power2.inOut', {rest: true, contact: false})
    ], null, qLabel);
    event(tc, other, 'give', 'grip', {prop: prop.id});
    lose(prop, tc + T.shared);
    gain(prop, other, tc + T.shared);
    event(tc + T.shared, actor, 'give', 'release', {character: other.id});
  }

  // Jobs in time order (a catch is the thrower's throw, timed to land on the catch).
  const jobs = [];
  actors.forEach(actor => actor.states.forEach(cue => {
    if (!CONTACT_ACTIONS.includes(cue.action)) return;
    if (cue.action === 'catch') {
      const label = `catch at ${scene(cue.time - start)} s`;
      const thrower = resolveTarget(actor, cue.cueTarget, cue.time, label, ['character']).other;
      jobs.push({actor: thrower, action: 'catch', catcher: actor, catchCue: cue, lands: cue.time, order: cue.time - 0.6});
    } else jobs.push({actor, action: cue.action, cue, order: cue.time});
  }));
  // A throw cue at the catcher just before its catch cue is one throw: the catcher's frames replace its catch cue.
  for (const job of jobs.filter(one => one.action === 'catch')) {
    const pair = jobs.find(one => one.action === 'throw' && one.actor === job.actor && one.cue.cueTarget?.character === job.catcher.id && one.cue.time < job.lands && one.cue.time > job.lands - 1.2);
    if (pair) { pair.catchCue = job.catchCue; jobs.splice(jobs.indexOf(job), 1); }
  }
  jobs.sort((a, b) => a.order - b.order);
  for (const job of jobs) {
    if (job.action === 'push' || job.action === 'hit') strike(job);
    else if (job.action === 'pull') pull(job);
    else if (job.action === 'lift') lift(job);
    else if (job.action === 'drop') drop(job);
    else if (job.action === 'give') give(job);
    else if (job.action === 'catch') toss(job);
    else {
      // A throw to a character is a pass they catch; to anything else it lands.
      const label = `throw at ${scene(job.cue.time - start)} s`;
      const target = job.cue.cueTarget;
      if (target && typeof target === 'object' && target.character !== undefined) job.catcher = resolveTarget(job.actor, target, job.cue.time, label, ['character']).other;
      else if (target !== undefined && target !== null) {
        const aim = resolveTarget(job.actor, target, job.cue.time, label, ['point', 'prop']);
        job.point = aim.kind === 'prop' ? {x: aim.prop.x, y: aim.prop.y} : aim.point;
      }
      toss(job);
    }
  }

  // Carrying: every other state of a holder puts its hands on the prop, and the prop goes where it is carried (walks too).
  actors.forEach(actor => actor.states.forEach((state, i) => {
    if (state.contact) return;
    const prop = [...props.values()].find(one => one.spans.some(span => span.actor === actor && span.from <= state.time + 1e-6 && state.time < span.to - 1e-6));
    if (!prop) return;
    const here = carryCenter(actor, state, prop);
    state.arms = solve(actor, state, carryGrips(actor, state, prop, here), state.body ?? {}).arms;
    const there = state.walk ? carryCenter(actor, state, prop, state.walk.to) : here;
    if (i === 0 && prop.x0 === undefined) Object.assign(prop, {x0: here.x, y0: here.y});
    // A reaction (a face change) moves nothing: the carry it interrupts is already under way.
    if (!state.reaction) key(prop, state.time, state.walk ? state.walk.duration : i === 0 ? 0 : state.tween ?? ACTING.poseTween, state.walk ? 'none' : state.ease ?? ACTING.poseEase, {x: there.x, y: there.y});
  }));

  // Gag squash cues: the whole body on its own layer.
  actors.forEach(actor => input[indexOf(actor)].states.forEach(state => {
    if (!state.squash) return;
    const q = state.squash, {scaleX, scaleY} = squashScales(q.amount);
    if (state.time + squashLength(q) > end + 1e-6) fail(indexOf(actor), `squash at ${scene(state.time - start)} s lasts ${r2(squashLength(q))} s, past the scene's end; move it earlier or shorten hold and recover`);
    const hold = q.hold ?? GAG.hold, back = q.recover ?? GAG.recover;
    wobble(ops, gagOf(actor), state.time, scaleX, scaleY, {out: GAG.entry, hold, back, ease: 'power3.out'});
    // What it carries goes down (or up) with it: its centre scales about the feet as the body does.
    const carried = [...props.values()].find(one => one.spans.some(span => span.actor === actor && span.from <= state.time + 1e-6 && state.time < span.to - 1e-6));
    if (carried) {
      const here = activeState(actor, state.time), c = carryCenter(actor, here, carried), X = actor.x + (here.x ?? 0);
      const at = (sx, sy) => ({x: X + (c.x - X) * sx, y: actor.floor - (actor.floor - c.y) * sy});
      const over = [1 + (1 - scaleX) * 0.3, 1 + (1 - scaleY) * 0.3];
      key(carried, state.time, GAG.entry, 'power3.out', at(scaleX, scaleY));
      key(carried, state.time + GAG.entry + hold, back * 0.4, 'sine.inOut', at(...over));
      key(carried, state.time + GAG.entry + hold + back * 0.4, back * 0.6, 'sine.out', at(1, 1));
    }
  }));

  // Prop tracks: keys in time order, each from where the prop is by then.
  const out = [];
  for (const prop of props.values()) {
    const id = `${prefix}-obj-${prop.id}`;
    const now = {x: r2(prop.x0), y: r2(prop.y0), rotation: 0};
    set(ops, id, start, {...now});
    out.push({id: prop.id, prop: prop.prop, x: now.x, y: now.y});
    const keys = prop.keys.map((k, n) => ({...k, n})).sort((a, b) => a.time - b.time || a.n - b.n);
    for (const k of keys) {
      const to = Object.fromEntries(Object.entries(k.to).map(([name, v]) => [name, r2(v)]));
      if (k.spin) to.rotation = r2(now.rotation + k.spin);
      if (!Object.keys(to).length) continue;
      const from = Object.fromEntries(Object.keys(to).map(name => [name, now[name]]));
      if (k.dur > 0) tw(ops, id, k.time, k.dur, k.ease, from, to);
      else set(ops, id, k.time, to);
      Object.assign(now, to);
    }
  }
  for (const actor of actors) for (const state of actor.states) { delete state.cueTarget; delete state.squash; delete state.posed; }
  return {actors, props: out, ops, contacts: contacts.sort((a, b) => a.at - b.at), gag: [...gag].sort((a, b) => a - b), moves: moves()};
}

/** Paper-stack sheets: each lags the stack by its height in the pile, then springs back past and settles. */
function layerLag(ops, id, n, t, dx, dy) {
  for (let k = 0; k < n; k++) {
    const share = (k + 1) / n, target = `${id}-l${k}`, start = rt(t + k * 0.015);
    const out = {x: r2(dx * share), y: r2(dy * share)}, over = {x: r2(-dx * share * 0.3), y: r2(-dy * share * 0.3)}, rest = {x: 0, y: 0};
    tw(ops, target, start, 0.08, 'power2.out', rest, out);
    tw(ops, target, rt(start + 0.08), 0.3, 'sine.inOut', out, over);
    tw(ops, target, rt(start + 0.38), 0.2, 'sine.out', over, rest);
  }
}

/**
 * How far short of a target a walk-to stops, in canvas px: a character's
 * arm's length from another (so a push or a hit lands), right beside a prop
 * (so a lift reaches it); 0 for anything else.
 */
export function standOff(actor, target, {actors = [], objects = []} = {}) {
  if (!target || typeof target !== 'object' || !actor.geometry?.upperArm) return 0;
  if (target.character !== undefined) {
    const other = actors.find(one => one.id === target.character);
    return other?.geometry?.armX === undefined ? 0 : bodyHalf(other.geometry) * other.scale + (actor.geometry.armX + armReach(actor.geometry) * 0.75) * actor.scale;
  }
  const object = target.prop !== undefined ? objects.find(one => one.id === target.prop) : null;
  return object ? (HAND_PROPS[object.prop].w / 2 + 110) * actor.scale : 0;
}
