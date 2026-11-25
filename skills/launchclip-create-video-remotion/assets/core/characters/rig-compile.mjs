// Cast-scene cues → a per-frame rig plan (docs/rd/per-frame-rig.md §7 step 2).
//
// The cast-scene module directs its actors as it always has (directActor,
// planContacts): each actor ends with timed states (pose joints, contact
// phases with their arms and body, walks, facings, faces) and the scene with
// contact events and the op list its props and gag layers play. This file
// turns those into the plan the per-frame rig draws (rig-scene.mjs,
// `launchclip.rig-scene.v1`), so the per-frame figure acts the same beats:
//
//   pose joints   → body keys (lean, crouch, shift, head) and hand targets
//                   (forward kinematics of today's arm angles, so a wave, a
//                   point, a shrug or a facepalm reads the same)
//   gestures      → hand (or crouch) key loops while the pose holds
//   walks         → walks (the step-ins of contact actions too); facings
//   contact       → the phases' hand and foot targets (wind-up, contact on
//                   the cue's time, follow-through, recovery), grips from the
//                   contact events, prop paths (held by a hand, or where the
//                   op list moves them), squash and stagger on the target
//   faces         → expressions and mouth visemes on today's timing
//
// Every state's pose is reached `tween` seconds after its time, as the op
// list's pose tween does; the rig's springs then add the overlap.
// Times are seconds from the scene start; track values are rig units.
//
// Imports only sibling kit/core files.

import {frameState} from '../catalog-b-view.mjs';
import {ACTING, sceneJoints, stateJoints} from './acting.mjs';
import {isKind} from './kinds.mjs';
import {RIG_FRAME_STYLES, RIG_SCENE_SCHEMA as RIG_SCHEMA} from './rig-scene.mjs';

export {RIG_SCHEMA};
export const RIG_MODES = Object.freeze(['ops', 'frame']);

const RAD = Math.PI / 180;
const r1 = v => Math.round(v * 10) / 10;
const rt = v => Math.round(v * 10000) / 10000;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const signOf = facing => (facing === 'left' ? -1 : 1);
// Within this many degrees of the stand pose an arm is at rest: the rig's own arm (idle sway, walk swing) takes it.
const REST_TOLERANCE = 5;
// Prop flight and slides are sampled this often (s); the rig's Catmull-Rom passes through every sample.
const PROP_STEP = 1 / 15;
// A flight's first and last stretch (s) is the rig's curve from the release hand and into the taking hand (rig-scene.mjs).
const HAND_GAP = 0.1;
// The longest hold at the bottom of a lift that the take waits for (s).
const LIFT_SETTLE = 0.3;
const samePoint = (a, b) => a[0] === b[0] && a[1] === b[1];

/**
 * Why a scene asking for the per-frame rig plays on the op list instead, or
 * null when it can play per frame. → string | null
 */
export function rigFallback({module = 'cast-scene', seated = false, actors = []}) {
  if (module !== 'cast-scene') return `${module} draws its character on the op list`;
  for (const actor of actors) {
    if (!RIG_FRAME_STYLES.includes(actor.style)) return `the ${actor.style} drawing style has no per-frame rig (styles: ${RIG_FRAME_STYLES.join(', ')})`;
    if (isKind(actor.params)) return `${actor.id} is a ${actor.params.kind}; the per-frame rig draws people`;
    if (actor.params.mobility) return `${actor.id}'s ${actor.params.mobility} is drawn on the op list only`;
    if (actor.holds === 'phone') return `${actor.id} holds a phone, drawn on the op list only`;
  }
  if (seated) return 'the per-frame rig does not sit yet (a seated set)';
  return null;
}

/** A point at angles a1, a2 (screen degrees) along two bones. */
const chain = (l1, a1, l2, a2) => [l1 * Math.sin(a1 * RAD) + l2 * Math.sin(a2 * RAD), l1 * Math.cos(a1 * RAD) + l2 * Math.cos(a2 * RAD)];

/**
 * A hand's target for joint values (rig.mjs convention): shoulder-relative,
 * [along the facing, down], and the elbow's bend (-1: flexed away from the
 * facing). Torso lean turns the arm with the shoulders (aim.mjs handAt).
 */
export function handTarget(j, side, g, f) {
  const k = side === 'L' ? -1 : 1, arm = j[`arm${side}`], fore = j[`fore${side}`], lean = j.lean ?? 0;
  const [x, y] = chain(g.upperArm, k * arm - lean, g.foreArm, k * (arm + fore) - lean);
  const flex = k * fore;
  return {at: [r1(f * x), r1(y)], ...(Math.abs(flex) > 1 && Math.sign(flex) !== f ? {bend: -1} : {})};
}

/** A foot's target (a kick) from leg and shin angles: hip-relative, [along the facing, down]. */
export function footTarget(j, side, g, f) {
  const k = side === 'L' ? -1 : 1, leg = j[`leg${side}`], shin = j[`shin${side}`] ?? 0;
  const [x, y] = chain(g.thigh, k * leg, g.shin, k * (leg + shin));
  return {at: [r1(f * x), r1(y)]};
}

/** A gesture's far swing (acting.mjs gestureOps) as joint values; held hands sit it out. */
function gesturePeak(j) {
  const g = j.gesture, held = side => (j.held ?? []).includes(side);
  if (!g || g.joint === 'walk') return null;
  if (g.joint === 'bodyY') return {...j, bodyY: j.bodyY + g.amount};
  if (g.joint === 'fore') return {...j, ...(held('L') ? {} : {foreL: j.foreL + g.amount}), ...(held('R') ? {} : {foreR: j.foreR - g.amount})};
  const s = g.joint.endsWith('L') ? 'L' : 'R';
  return held(s) ? null : {...j, [`fore${s}`]: j[`fore${s}`] + g.amount};
}

/**
 * The actor's targets in time order: [{t (story s), j, f, state}]. A state's
 * pose holds from the state before until its time, then is reached `tween`
 * later (or by the next state); a gesture swings between its pose and its far
 * swing while the pose holds, ending on the pose.
 */
function targets(actor, end) {
  const out = [];
  const states = actor.states;
  states.forEach((state, i) => {
    const f = signOf(state.facing ?? actor.facing), j = stateJoints(state, actor);
    const next = states[i + 1]?.time ?? end;
    const d = state.walk ? state.walk.duration : i === 0 ? 0 : state.tween ?? ACTING.poseTween;
    const arrive = Math.min(state.time + d, next);
    if (i > 0) out.push({...out.at(-1), t: state.time, hold: true});
    out.push({t: arrive, j, f, state});
    const peak = gesturePeak(j);
    if (!peak) return;
    const half = j.gesture.period / 2;
    for (let t = arrive; t + 2 * half <= next + 1e-6; t += 2 * half) {
      out.push({t: t + half, j: peak, f, state});
      out.push({t: t + 2 * half, j, f, state});
    }
  });
  // One value per time: the later one wins (a state that starts as the last arrives).
  return out.filter((one, i) => !(out[i + 1] && out[i + 1].t - one.t < 1e-4));
}

/** Insert or merge a key at t into time-sorted keys. */
function putKey(keys, key) {
  const same = keys.find(k => Math.abs(k.t - key.t) < 1e-4);
  if (same) Object.assign(same, key, {t: same.t});
  else keys.push(key);
  keys.sort((a, b) => a.t - b.t);
}

/** A keyed channel's value at t (rig-frame.mjs keyed: smoothstep between keys, held outside). */
function keyedAt(keys, name, t) {
  const ks = keys.filter(k => k[name] !== undefined);
  if (!ks.length) return 0;
  if (t <= ks[0].t) return ks[0][name];
  for (let i = 1; i < ks.length; i++) if (t <= ks[i].t) { const u = (t - ks[i - 1].t) / (ks[i].t - ks[i - 1].t); return ks[i - 1][name] + (ks[i][name] - ks[i - 1][name]) * u * u * (3 - 2 * u); }
  return ks.at(-1)[name];
}

/** The tweens of one op-list target, in time order. */
const tweensOf = (ops, target) => ops.filter(op => op.type === 'tween' && op.target === target).sort((a, b) => a.start - b.start);

/** Squashes (contact.mjs wobble: in, hold, rebound, settle) on one target → [{t, amount, hold, recover}] (story s). */
function squashes(ops, target) {
  const tws = tweensOf(ops, target).filter(op => op.to.scaleY !== undefined);
  const out = [];
  tws.forEach((op, i) => {
    if (op.from.scaleX !== 1 || op.from.scaleY !== 1 || !tws[i + 2]) return;
    out.push({t: op.start, amount: rt(1 - op.to.scaleY), hold: rt(Math.max(0, tws[i + 1].start - op.start - op.duration)), recover: rt(tws[i + 1].duration + tws[i + 2].duration)});
  });
  return out;
}

/** Staggers (contact.mjs recoil: out, hold, back) on a gag layer → [{t, out, hold, back, x (px), rotation}]. */
function recoils(ops, target) {
  const tws = tweensOf(ops, target).filter(op => op.to.x !== undefined);
  const out = [];
  tws.forEach((op, i) => {
    if (op.from.x !== 0 || !tws[i + 1]) return;
    out.push({t: op.start, out: op.duration, hold: tws[i + 1].start - op.start - op.duration, back: tws[i + 1].duration, x: op.to.x, rotation: op.to.rotation ?? 0});
  });
  return out;
}

/**
 * Which hands hold which prop when, from the contact events: [{actor, prop,
 * from, to, action}] (story s; a held prop's from is -Infinity). A pull grips
 * a prop that stays on the floor; every other window owns it.
 */
function gripWindows(actors, contacts) {
  const open = new Map(), out = [];
  for (const actor of actors) if (actor.holds && actor.holds !== 'phone') open.set(actor.id, {actor: actor.id, prop: actor.holds, from: -Infinity, action: 'holds'});
  for (const c of contacts) {
    if (c.kind === 'grip' && c.target?.prop !== undefined) {
      // A lift takes the prop from rest when its hold at the bottom (reach, strain) ends and it rises: the rig's body has crouched to it by then.
      const next = c.action === 'lift' ? actors.find(a => a.id === c.actor)?.states.find(st => st.time > c.at + 1e-6 && !st.contact) : null;
      const from = next && next.time - c.at <= LIFT_SETTLE ? next.time : c.at;
      open.set(c.actor, {actor: c.actor, prop: c.target.prop, reach: c.at, from, action: c.action});
    }
    else if (c.kind === 'release' && open.has(c.actor)) { out.push({...open.get(c.actor), to: c.at}); open.delete(c.actor); }
  }
  for (const w of open.values()) out.push({...w, to: Infinity});
  // The take: a handover's receiver takes it when the giver lets go.
  for (const w of out) {
    const giver = out.find(o => o !== w && o.prop === w.prop && o.action !== 'pull' && w.action !== 'pull' && o.from < w.from && o.to > w.from);
    w.take = giver ? giver.to : w.from;
  }
  return out;
}

/** One actor's track and faces. */
function compileActor(actor, index, {start, end, ops, prefix, grips, single}) {
  const g = actor.geometry, s = actor.scale, rel = t => rt(t - start);
  const list = targets(actor, end);
  const rest = f => sceneJoints('stand', {facing: f < 0 ? 'left' : 'right', seated: false, geometry: g, params: actor.params});
  const atRest = (j, side, f) => { const r = rest(f); return Math.abs(j[`arm${side}`] - r[`arm${side}`]) <= REST_TOLERANCE && Math.abs(j[`fore${side}`] - r[`fore${side}`]) <= REST_TOLERANCE; };

  // Body keys: lean toward the facing, the crouch (the op list's body drop), the weight following the lean, the head's tilt toward what it looks at.
  const keys = [];
  for (const {t, j, f, state} of list) {
    const lean = f * (j.lean ?? 0);
    putKey(keys, {t: rel(t), lean: r1(lean), crouch: r1(j.bodyY ?? 0), shift: r1(clamp(2.5 * lean, -40, 40)), head: r1((j.head ?? 0) + f * (state.gaze?.y ?? 0) * 0.6)});
  }
  // A stagger (a push, hit or pull on this character): the weight thrown and the body tipped, held, and back.
  for (const k of recoils(ops, `${prefix}-c${index}-gag`)) {
    const f = list.filter(one => one.t <= k.t + 1e-9).at(-1)?.f ?? signOf(actor.facing);
    const offset = [0, 1, 1, 0], times = [k.t, k.t + k.out, k.t + k.out + k.hold, k.t + k.out + k.hold + k.back];
    const base = times.map(t => ({lean: keyedAt(keys, 'lean', rel(t)), shift: keyedAt(keys, 'shift', rel(t))}));
    times.forEach((t, n) => putKey(keys, {t: rel(t), lean: r1(base[n].lean + offset[n] * f * k.rotation), shift: r1(base[n].shift + offset[n] * clamp(f * k.x / s, -60, 60))}));
  }

  // Hands: a path from the first target off rest to the one back at rest (held to the scene's end if it never returns).
  const hands = {}, feet = {};
  for (const side of ['L', 'R']) {
    // Kicks: a contact phase that sets the legs (not a step in), through to the recovery.
    const kick = list.map(one => Boolean(one.state.contact && !one.state.walk && one.state.body?.[`leg${side}`] !== undefined));
    const k0 = kick.indexOf(true), k1 = kick.lastIndexOf(true);
    if (k0 >= 0) feet[side.toLowerCase()] = list.slice(Math.max(0, k0 - 1), k1 + 2).map(({t, j, f}) => ({t: rel(t), ...footTarget(j, side, g, f)}));
    const off = list.map(one => !atRest(one.j, side, one.f));
    const first = off.indexOf(true), last = off.lastIndexOf(true);
    if (first < 0) continue;
    const span = list.slice(Math.max(0, first - 1), last + 2);
    if (last === list.length - 1) span.push({...list.at(-1), t: Math.max(end, list.at(-1).t + 0.1)});
    // A hand grips until it takes the prop (then the prop is in it); a pull's hand grips the prop throughout.
    const grip = t => grips.find(w => w.actor === actor.id && (w.reach ?? w.from) <= t + 1e-6 && t < w.to - 1e-6 && (w.action === 'pull' || t <= w.take + 1e-6))?.prop;
    hands[side.toLowerCase()] = span.filter((one, i) => !span[i + 1] || span[i + 1].t - one.t >= 1e-4).map(({t, j, f}) => {
      const prop = (j.held ?? []).includes(side) ? grip(t) : undefined;
      return {t: rel(t), ...handTarget(j, side, g, f), ...(prop ? {grip: prop} : {})};
    });
  }

  const facing = actor.states[0].facing ?? actor.facing;
  const facings = [];
  let now = facing;
  for (const state of actor.states) if ((state.facing ?? now) !== now) { now = state.facing; facings.push({t: rel(state.time), facing: now}); }
  // A walk faces its travel. A walk-to then turns to its state's facing (the target) when it ends;
  // a contact's step back (no action) keeps facing the prop all the way.
  const moving = actor.states.filter(state => state.walk && Math.abs(state.walk.to - state.walk.from) > 0.5);
  const against = state => state.facing && signOf(state.facing) !== Math.sign(state.walk.to - state.walk.from);
  const walks = moving.map(state => ({start: rel(state.time), end: rel(state.time + state.walk.duration), to: r1(state.walk.to / s), ...(against(state) && state.action !== 'walk-to' ? {facing: state.facing} : {})}));
  for (const state of moving) if (against(state) && state.action === 'walk-to') facings.push({t: rel(state.time + state.walk.duration), facing: state.facing});
  facings.sort((a, b) => a.t - b.t);
  const expressions = [];
  for (const state of actor.states) if (expressions.at(-1)?.expression !== state.expression) {
    if (expressions.length && rel(state.time) - expressions.at(-1).t < 1e-4) expressions.pop();
    expressions.push({t: rel(state.time), expression: state.expression});
  }
  const mouth = (actor.speech ?? []).map(change => ({t: rel(change.time), viseme: change.shape})).filter((m, i, all) => !all[i + 1] || all[i + 1].t - m.t >= 1e-4);
  const squash = squashes(ops, `${prefix}-c${index}-gag`).map(q => ({...q, t: rel(q.t)}));
  const track = {x: 0, facing, walks, keys, facings, hands, feet, squash};
  // One copy of a person (catalog-characters.mjs castPassage): hidden until the way in has passed, or from the way out.
  const visible = [];
  if (single.arrive?.ids.includes(actor.id) && single.arrive.at > start + 1e-6) visible.push({t: 0, visible: false}, {t: rel(single.arrive.at), visible: true});
  if (single.leave?.ids.includes(actor.id)) visible.push({t: rel(single.leave.at), visible: false});
  return {id: actor.id, character: {params: actor.params, style: actor.style}, colors: actor.colors, at: {x: actor.x, floor: actor.floor, scale: s}, track, expressions, ...(mouth.length ? {mouth} : {}), ...(visible.length ? {visible} : {}), z: index};
}

/**
 * The prop's own moves. A tween that starts while the prop is free but away
 * from where the moves so far put it is dropped: a carry's leftover (a
 * recovery the prop followed in the hand) that the op list lets jump it.
 */
function freeMoves(mine, id, isFree) {
  const kept = [];
  for (const op of [...mine].sort((x, y) => (x.start ?? x.time) - (y.start ?? y.time))) {
    if (op.type === 'tween' && isFree(op.start)) {
      const now = frameState(kept, op.start).get(id) ?? {};
      if (['x', 'y'].some(k => op.from?.[k] !== undefined && now[k] !== undefined && Math.abs(op.from[k] - now[k]) > 2)) continue;
    }
    kept.push(op);
  }
  return kept;
}

/**
 * A prop's path (rig-scene.mjs prop semantics): a holder key where each hand
 * takes it and where it lets go (a handover passes from the giver's key at
 * the receiver's grip to the receiver's at the release); free, where the op
 * list puts it, sampled on a grid, leaving the first and last HAND_GAP s of a
 * flight to the rig's curve from the release hand and into the catching
 * hand; a resting key just before a pick-up; and its squashes.
 */
function compileProp(prop, {start, end, ops, prefix, grips, actors}) {
  const id = `${prefix}-obj-${prop.id}`, rel = t => rt(t - start);
  const owned = grips.filter(w => w.prop === prop.id && w.action !== 'pull').sort((a, b) => a.from - b.from);
  const handOf = w => {
    const actor = actors.find(one => one.id === w.actor);
    const state = actor.states.filter(one => one.time <= Math.max(w.from, start) + 1e-6).at(-1) ?? actor.states[0];
    const held = stateJoints(state, actor).held ?? [];
    // A one-hand prop sits in the facing hand (contact.mjs carryCenter); a two-hand prop names the first.
    return held.length === 1 ? held[0].toLowerCase() : signOf(state.facing ?? actor.facing) < 0 ? 'l' : 'r';
  };
  // Each owner's span: from its grip (or the giver's release) to its release (or the receiver's grip).
  const spans = owned.map((w, i) => ({holder: {actor: w.actor, hand: handOf(w)},
    from: Math.max(start, owned[i - 1] && owned[i - 1].to > w.from ? owned[i - 1].to : w.from),
    to: Math.min(end, owned[i + 1] && owned[i + 1].from < w.to ? owned[i + 1].from : w.to),
    handover: Boolean(owned[i + 1] && owned[i + 1].from < w.to)}));
  // Between a hand's reach and its take (a lift's strain) the prop rests where the hand reaches it.
  const reaching = op => owned.some(w => op.start >= w.reach - 1e-6 && op.start < w.take - 1e-6);
  const mine = freeMoves(ops.filter(op => op.target === id && !(op.type === 'tween' && reaching(op))), id, t => !spans.some(w => w.from - 1e-6 <= t && t < w.to - 1e-6));
  const freeAt = t => {
    const p = frameState(mine, t).get(id) ?? {};
    return [r1(p.x ?? prop.x), r1(p.y ?? prop.y)];
  };
  const path = [];
  const atKey = (t, at) => {
    const prev = path.at(-1), before = path.at(-2);
    // Three equal points in a row: the middle one goes (two equal neighbours already hold).
    if (prev?.at && before?.at && samePoint(prev.at, at) && samePoint(before.at, at)) prev.t = rel(t);
    else path.push({t: rel(t), at});
  };
  // Where the op list puts it from a to b, on a grid; a flight leaves HAND_GAP s at a release and at a take to the rig.
  const free = (a, b, released, taken) => {
    if (b - a < 1e-4) return;
    const times = new Set([a, b]);
    for (let t = a + PROP_STEP; t < b - 1e-4; t += PROP_STEP) times.add(rt(t));
    for (const op of mine) if (op.type === 'tween' && op.start + op.duration > a && op.start + op.duration < b) times.add(rt(op.start + op.duration));
    const lo = released ? a + HAND_GAP : a, hi = taken ? b - HAND_GAP : b;
    const kept = [...times].sort((x, y) => x - y).filter(t => t >= lo - 1e-6 && t <= hi + 1e-6);
    // Hand to hand (a throw caught): the rig's curve from the release hand through the flight's top into the catching hand.
    if (released && taken) {
      const top = kept.map(t => ({t, at: freeAt(t)})).sort((x, y) => x.at[1] - y.at[1])[0];
      if (top) atKey(top.t, top.at);
      return;
    }
    kept.filter((t, i) => i === 0 || t - kept[i - 1] >= 0.03).forEach(t => atKey(t, freeAt(t)));
  };
  let cursor = start, prev = null;
  for (const span of spans) {
    if (!prev?.handover) free(cursor, span.from, Boolean(prev), true);
    path.push({t: rel(span.from), holder: span.holder});
    if (span.to < end && span.to > span.from + 1e-4) path.push({t: rel(span.to), holder: span.holder});
    cursor = span.to; prev = span;
  }
  if (!prev || prev.to < end) free(cursor, end, Boolean(prev), false);
  const squash = squashes(ops, `${id}-sq`).map(q => ({...q, t: rel(q.t)}));
  return {id: prop.id, prop: prop.prop, path, ...(squash.length ? {squash} : {})};
}

/**
 * The per-frame rig plan for a cast-scene's directed, contact-planned actors.
 *   actors    the model's actors (states expanded by planContacts)
 *   contact   planContacts' result ({props, ops, contacts}) or null
 *   start, duration   the scene's story seconds
 *   prefix    the scene's id (the op list's element ids)
 *   single    castPassage's single ({arrive?, leave?}): people shared with a neighbouring scene
 * → a launchclip.rig-scene.v1 plan (JSON)
 */
export function compileRigScene({actors, contact = null, start, duration, prefix, single = {}}) {
  const end = start + duration, ops = contact?.ops ?? [], grips = gripWindows(actors, contact?.contacts ?? []);
  const ctx = {start, end, ops, prefix, grips, actors, single};
  return {
    schema: RIG_SCHEMA,
    actors: actors.map((actor, i) => compileActor(actor, i, ctx)),
    props: (contact?.props ?? []).map(prop => compileProp(prop, ctx))
  };
}
