// Acting: one character's cues → renderer-neutral animation ops
// (kit/core/catalog-b-view.mjs op list), so HyperFrames (GSAP) and Remotion
// (frameState) interpolate every pose change the same way.
//
// - Pose changes take ACTING.poseTween seconds from the cue and are at rest
//   on the new pose when it ends. A small change is one eased tween. A big
//   one is acted (poseChangeOps): a short counter-move (anticipation), the
//   travel, then a follow-through that settles back onto the pose, each
//   scaled by how far the joints travel; the head, forearms, shins and
//   hands start a little after the body (overlap).
// - A pose with a gesture (a wave, typing, walking, a cheer's bounce, a
//   head scratch) loops whole cycles while it holds and ends each loop back
//   on the pose, so the next change always starts from the pose's values.
// - Idle life on separate groups: breathing (the chest), a slow head sway,
//   and blinks at a steady, per-character rhythm.
// - Expressions crossfade their faces; mouths open and close on the
//   character's spoken words (open and closed shapes, not lip sync).
// - An acting profile (ACTING_PROFILES) scales all of it per character.
//
// Every op is an absolute set or from-to tween, so any frame can be drawn
// on its own (seek-safe); nothing is random. Times are absolute seconds.
// Imports only sibling kit/core files.

import {set, tw} from '../catalog-b-view.mjs';
import {HELD_AIDS, poseJoints} from './rig.mjs';

export const ACTING = Object.freeze({turn: 0.12, poseTween: 0.45, poseEase: 'power2.inOut', faceFade: 0.16, breath: 1.7, sway: 2.6, swayDeg: 1.4, blinkEvery: 3.4, blinkDown: 0.06, blinkUp: 0.09,
  // Idle arms (styles whose geometry sets idleArms): a slow swing at the shoulder and a give at the elbow, and a slight sway of the body.
  armSway: 2.9, armDeg: 3, foreSway: 2.3, foreDeg: 7, bodySway: 3.7, bodyDeg: 0.9});

// Acting profiles: how one character moves. Each scales the amplitude and
// rhythm of the acting around the default (1 = today's feel); none changes
// the timing contract: a pose change is always at rest ACTING.poseTween
// seconds after its cue.
//   pace          share of the pose-change window the move takes (≤ 1; less = quicker, then held)
//   anticipation  size of the counter-move before a big move
//   settle        size of the follow-through after it
//   lag           how far the head, forearms and hands trail the body
//   blinks, darts, shifts   how often it blinks, its eyes dart, its weight shifts
//   breath, breathRate      depth and speed of breathing
const profile = values => Object.freeze({pace: 1, anticipation: 1, settle: 1, lag: 1, blinks: 1, darts: 1, shifts: 1, breath: 1, breathRate: 1, ...values});
export const ACTING_PROFILES = Object.freeze({
  default: profile({}),
  calm: profile({anticipation: 0.5, settle: 0.5, lag: 1.3, blinks: 0.7, darts: 0.5, shifts: 0.6, breath: 1.25, breathRate: 0.85}),
  bouncy: profile({pace: 0.88, anticipation: 1.7, settle: 1.8, lag: 1.4, blinks: 1.1, shifts: 1.3, breath: 1.5, breathRate: 1.1}),
  nervous: profile({pace: 0.78, anticipation: 0.8, settle: 1.2, lag: 0.7, blinks: 1.8, darts: 2.4, shifts: 1.8, breath: 1.3, breathRate: 1.35})
});
export const ACTING_PROFILE_NAMES = Object.freeze(Object.keys(ACTING_PROFILES));

/** A profile by name (null or undefined: the default). Throws on an unknown name. */
export function actingProfile(name) {
  if (name === null || name === undefined) return ACTING_PROFILES.default;
  const found = Object.hasOwn(ACTING_PROFILES, name) ? ACTING_PROFILES[name] : null;
  if (!found) throw new Error(`unknown acting profile ${JSON.stringify(name)} (profiles: ${ACTING_PROFILE_NAMES.join(', ')})`);
  return found;
}

const rt = value => Math.round(value * 10000) / 10000;

/** Animated targets and props for joint values. */
export function jointTargets(cid, j) {
  return {
    [`${cid}-body`]: {y: j.bodyY},
    [`${cid}-torso`]: {rotation: j.lean, scaleY: j.squash},
    [`${cid}-head`]: {rotation: j.head, y: j.headY},
    [`${cid}-hb`]: {rotation: j.head, y: j.headY},
    [`${cid}-arm-l`]: {rotation: j.armL, y: j.shoulderY},
    [`${cid}-fore-l`]: {rotation: j.foreL},
    [`${cid}-arm-r`]: {rotation: j.armR, y: j.shoulderY},
    [`${cid}-fore-r`]: {rotation: j.foreR},
    [`${cid}-leg-l`]: {rotation: j.legL, scaleY: j.legScale},
    [`${cid}-shin-l`]: {rotation: j.shinL},
    [`${cid}-leg-r`]: {rotation: j.legR, scaleY: j.legScale},
    [`${cid}-shin-r`]: {rotation: j.shinR},
    [`${cid}-fingerwrap-l`]: {opacity: j.fingerL},
    [`${cid}-fingerwrap-r`]: {opacity: j.fingerR},
    // The head and the face turned toward a target (drawn only for a
    // character with one; each style draws its share, toon.mjs HEAD_TURN).
    ...(j.gazeX !== undefined ? {[`${cid}-turn`]: {x: j.gazeX, y: j.gazeY}, [`${cid}-gaze`]: {x: j.gazeX, scaleX: j.gazeScale ?? 1}} : {})
  };
}

const same = (a, b) => Object.keys(a).every(key => Math.abs(a[key] - b[key]) < 1e-9);

// Acted pose changes. A change whose joints travel less than `small` degrees
// is one plain tween; from there the acting grows to full strength at `full`.
// The window (ACTING.poseTween × the profile's pace) splits into the
// anticipation, the travel and the settle. `back` and `over` are the shares
// of a joint's travel it moves against first and past afterwards, capped per
// prop (degrees, rig units, scale) so nothing swings wide of the pose.
export const MOVE = Object.freeze({small: 24, full: 140, anticipate: 0.2, settle: 0.22, back: 0.1, over: 0.06,
  cap: Object.freeze({rotation: 7, x: 6, y: 10, scaleY: 0.03}),
  // The torso dips before a big move and stretches a touch past it; the head nods as the move lands.
  squash: 0.018, stretch: 0.01, nod: 5,
  // Seconds each trailing part starts after the body.
  lag: Object.freeze({head: 0.035, fore: 0.045, hand: 0.06})});

// A prop's change in degrees-equivalent (offsets and scales weighed in; opacity is not travel).
const TRAVEL_WEIGHT = {rotation: 1, x: 0.5, y: 0.5, scaleX: 200, scaleY: 200, opacity: 0};

/** How far a pose change travels: its largest joint move (jointTargets values). */
export function poseTravel(from, to) {
  let travel = 0;
  for (const target of Object.keys(to)) for (const prop of Object.keys(to[target])) travel = Math.max(travel, Math.abs(to[target][prop] - (from[target]?.[prop] ?? to[target][prop])) * (TRAVEL_WEIGHT[prop] ?? 0));
  return travel;
}

// The parts that trail the body, and the ones that lead it (the look).
const trails = target => (/-(head|hb)$/.test(target) ? 'head' : /-(fore|shin)-[lr]$/.test(target) ? 'fore' : /-fingerwrap-[lr]$/.test(target) ? 'hand' : null);
const leads = target => /-(turn|gaze)$/.test(target);

/**
 * Ops for one pose change at `time`: from and to are jointTargets values.
 * Everything ends by time + ACTING.poseTween, on the new pose.
 * → the change's strength: 0 (nothing moved, or a small change: one plain
 * tween per joint) up to 1 (a full acted move).
 */
export function poseChangeOps(ops, from, to, time, P = ACTING_PROFILES.default) {
  const A = ACTING;
  const changed = Object.keys(to).filter(target => !same(from[target], to[target]));
  if (!changed.length) return 0;
  const travel = poseTravel(from, to);
  if (travel < MOVE.small) {
    for (const target of changed) tw(ops, target, rt(time), A.poseTween, A.poseEase, from[target], to[target]);
    return 0;
  }
  const k = 0.35 + 0.65 * Math.min(1, (travel - MOVE.small) / (MOVE.full - MOVE.small));
  const window = A.poseTween * P.pace, ant = window * MOVE.anticipate, rest = window * MOVE.settle;
  // A joint's values moved by a share of its travel (capped), along `sign`.
  const shifted = (target, base, share, scale, sign) => Object.fromEntries(Object.keys(base).map(prop => {
    const delta = to[target][prop] - from[target][prop];
    const amount = Math.sign(delta) * Math.min(Math.abs(delta) * share, MOVE.cap[prop] ?? 0) * k * scale;
    return [prop, rt(base[prop] + sign * amount)];
  }));
  const body = Object.keys(to).filter(target => /-torso$/.test(target) || /-(head|hb)$/.test(target));
  for (const target of new Set([...changed, ...body])) {
    const a = from[target], b = to[target];
    if (leads(target)) { tw(ops, target, rt(time), rt(window), A.poseEase, a, b); continue; }
    const trail = trails(target);
    const peak = shifted(target, b, MOVE.over * (trail ? 1.5 : 1), P.settle, 1);
    if (/-torso$/.test(target)) peak.scaleY = rt(peak.scaleY + MOVE.stretch * k * P.settle);
    if (trail === 'head') peak.y = rt(peak.y + MOVE.nod * k * P.settle);
    if (!trail) {
      const back = shifted(target, a, MOVE.back, P.anticipation, -1);
      if (/-torso$/.test(target)) back.scaleY = rt(back.scaleY - MOVE.squash * k * P.anticipation);
      if (!same(a, back)) tw(ops, target, rt(time), rt(ant), 'sine.inOut', a, back);
      tw(ops, target, rt(time + ant), rt(window - ant - rest), A.poseEase, back, peak);
      if (!same(peak, b)) tw(ops, target, rt(time + window - rest), rt(rest), 'sine.inOut', peak, b);
      continue;
    }
    // A trailing part holds through the anticipation, starts late and settles in what is left.
    const lag = Math.min(MOVE.lag[trail] * P.lag, rest * 0.6);
    tw(ops, target, rt(time + ant + lag), rt(window - ant - rest), A.poseEase, a, peak);
    if (!same(peak, b)) tw(ops, target, rt(time + window - rest + lag), rt(rest - lag), 'sine.inOut', peak, b);
  }
  return k;
}

// A small stable hash, so each character blinks on its own rhythm.
function phase(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return h / 997;
}

/**
 * Joint values for a pose in a scene, with a held prop's arm. holds: 'phone'
 * puts the other arm (not the facing one) in front of the chest whenever the
 * pose leaves that arm at rest. params.mobility: a wheelchair seats the lower
 * body in any set; a cane or crutch keeps its arm (away from the facing
 * side) at rest, so the aid stays on the floor.
 */
export function sceneJoints(pose, {facing, seated, geometry, holds = null, params = null}) {
  const aid = HELD_AIDS.includes(params?.mobility);
  const j = poseJoints(pose, {facing, seated: seated || params?.mobility === 'wheelchair', geometry});
  if (aid) {
    // A cane or crutch stays in the hand away from the facing side, at rest.
    const side = facing === 'left' ? 'R' : 'L';
    j[`arm${side}`] = 8;
    j[`fore${side}`] = 2;
    j[`finger${side}`] = 0;
    if (j.gesture && (j.gesture.joint === 'fore' || j.gesture.joint === `fore${side}`)) j.gesture = null;
  }
  if (holds === 'phone') {
    // With a cane in the other hand, the phone goes in the facing hand.
    const side = (facing === 'left') !== aid ? 'R' : 'L';
    const rest = Math.abs(j[`arm${side}`]) <= 20 && j[`fore${side}`] > -60 && j[`fore${side}`] < 60;
    if (rest || pose === 'type') {
      j[`arm${side}`] = 16;
      j[`fore${side}`] = -114;
      if (pose === 'type') { const o = side === 'L' ? 'R' : 'L'; j[`arm${o}`] = 16; j[`fore${o}`] = -112; }
      if (j.gesture && j.gesture.joint === 'fore') j.gesture = null;
    }
  }
  return j;
}

/**
 * Joint values for one directed state (catalog-characters.mjs directActor):
 * its pose at its facing, seated unless it has stood up, with the face
 * turned by its gaze when the character has one (actor.gaze).
 */
export function stateJoints(state, actor) {
  const seated = actor.seated && !state.standing;
  const j = sceneJoints(state.pose, {...actor, facing: state.facing ?? actor.facing, seated});
  // An aimed point (characters/aim.mjs): the pointing arm's own angles.
  if (state.aim) { j[`arm${state.aim.side}`] = state.aim.arm; j[`fore${state.aim.side}`] = state.aim.fore; }
  if (actor.gaze) { j.gazeX = state.gaze?.x ?? 0; j.gazeY = state.gaze?.y ?? 0; j.gazeScale = state.gaze?.scale ?? 1; }
  return j;
}

/** Gesture loops between t0 and t1 (whole cycles, ending on the pose). */
function gestureOps(ops, cid, j, t0, t1) {
  const g = j.gesture;
  if (!g) return;
  const half = g.period / 2;
  const cycles = Math.floor((t1 - t0) / g.period);
  const targets = jointTargets(cid, j);
  const swing = (target, prop, amount, phaseShift) => {
    const base = targets[target][prop];
    for (let k = 0; k < cycles; k++) {
      const t = t0 + k * g.period;
      const from = {...targets[target]}, peak = {...targets[target], [prop]: base + amount * (phaseShift ? -1 : 1)};
      tw(ops, target, rt(t), half, 'sine.inOut', from, peak);
      tw(ops, target, rt(t + half), half, 'sine.inOut', peak, {...targets[target]});
    }
  };
  if (g.joint === 'walk') {
    swing(`${cid}-leg-l`, 'rotation', g.amount, false);
    swing(`${cid}-leg-r`, 'rotation', -g.amount, false);
    swing(`${cid}-arm-l`, 'rotation', -g.amount * 0.8, false);
    swing(`${cid}-arm-r`, 'rotation', g.amount * 0.8, false);
    // Two steps per cycle: the body bobs twice.
    const base = targets[`${cid}-body`].y;
    for (let k = 0; k < cycles * 2; k++) {
      const t = t0 + k * half;
      tw(ops, `${cid}-body`, rt(t), half / 2, 'sine.out', {y: base}, {y: base - 8});
      tw(ops, `${cid}-body`, rt(t + half / 2), half / 2, 'sine.in', {y: base - 8}, {y: base});
    }
  } else if (g.joint === 'fore') {
    swing(`${cid}-fore-l`, 'rotation', g.amount, false);
    swing(`${cid}-fore-r`, 'rotation', g.amount, true);
  } else if (g.joint === 'bodyY') {
    swing(`${cid}-body`, 'y', g.amount, false);
  } else {
    const side = g.joint.endsWith('L') ? 'l' : 'r';
    swing(`${cid}-fore-${side}`, 'rotation', g.amount, false);
  }
}

/**
 * Ops for one actor.
 *   actor: {cid, id?, start, end, geometry, facing, seated, holds,
 *           acting?: an acting profile name (ACTING_PROFILES; default: default),
 *           states: [{time, pose, expression}] (first at start),
 *           expressions: every expression drawn,
 *           speech: [{time, open: boolean}] mouth changes}
 */
export function actingOps(ops, actor) {
  const {cid, start, end, states} = actor;
  const A = ACTING;
  const P = actingProfile(actor.acting);
  const jointsAt = state => stateJoints(state, actor);
  // A state's look: its pose, facing and seat (a new look restarts the gesture loop).
  const lookOf = state => `${state.pose}|${state.facing ?? actor.facing}|${state.standing ? 1 : 0}`;
  // Poses
  let current = jointsAt(states[0]);
  for (const [target, props] of Object.entries(jointTargets(cid, current))) set(ops, target, start, props);
  states.forEach((state, i) => {
    const next = jointsAt(state);
    const holdEnd = i + 1 < states.length ? states[i + 1].time : end;
    let settle = state.time;
    const from = jointTargets(cid, current), to = jointTargets(cid, next);
    if (i > 0 && Object.keys(to).some(target => !same(from[target], to[target]))) {
      poseChangeOps(ops, from, to, state.time, P);
      settle = rt(state.time + A.poseTween);
    }
    if (i === 0 || lookOf(state) !== lookOf(states[i - 1])) gestureOps(ops, cid, next, settle + (i === 0 ? 0.2 : 0), holdEnd - 0.05);
    current = next;
  });
  // Views: turning away swaps the face for the back of the head and hides
  // the front of the clothes, quickly (a head turn, not a dissolve).
  if (actor.turns) {
    const back = state => state.view === 'back';
    set(ops, `${cid}-back`, start, {opacity: back(states[0]) ? 1 : 0});
    set(ops, `${cid}-front`, start, {opacity: back(states[0]) ? 0 : 1});
    set(ops, `${cid}-face-front`, start, {opacity: back(states[0]) ? 0 : 1});
    states.forEach((state, i) => {
      if (i === 0 || back(state) === back(states[i - 1])) return;
      const at = rt(state.time + A.poseTween * 0.4);
      tw(ops, `${cid}-back`, at, A.turn, 'power1.inOut', {opacity: back(state) ? 0 : 1}, {opacity: back(state) ? 1 : 0});
      tw(ops, `${cid}-front`, at, A.turn, 'power1.inOut', {opacity: back(state) ? 1 : 0}, {opacity: back(state) ? 0 : 1});
      tw(ops, `${cid}-face-front`, at, A.turn, 'power1.inOut', {opacity: back(state) ? 1 : 0}, {opacity: back(state) ? 0 : 1});
    });
  }
  // Walks: the character crosses the floor on its own wrapper, at a steady pace.
  if (actor.walks) {
    set(ops, `${cid}-walk`, start, {x: states[0].x ?? 0});
    for (const state of states) if (state.walk) tw(ops, `${cid}-walk`, rt(state.time), state.walk.duration, 'none', {x: state.walk.from}, {x: state.walk.to});
  }
  // Faces: the first expression shows; each change crossfades.
  for (const name of actor.expressions) set(ops, `${cid}-face-${name}`, start, {opacity: name === states[0].expression ? 1 : 0});
  states.forEach((state, i) => {
    if (i === 0 || state.expression === states[i - 1].expression) return;
    tw(ops, `${cid}-face-${states[i - 1].expression}`, rt(state.time), A.faceFade, 'power1.inOut', {opacity: 1}, {opacity: 0});
    tw(ops, `${cid}-face-${state.expression}`, rt(state.time), A.faceFade, 'power1.inOut', {opacity: 0}, {opacity: 1});
  });
  // Mouths: closed unless speaking; every face's mouth follows together
  // (the face's own opacity picks which one shows).
  const mouthAt = (time, open) => actor.expressions.forEach(name => {
    set(ops, `${cid}-mouth-${name}`, rt(time), {opacity: open ? 0 : 1});
    set(ops, `${cid}-open-${name}`, rt(time), {opacity: open ? 1 : 0});
  });
  mouthAt(start, false);
  for (const change of actor.speech) if (change.time > start && change.time < end) mouthAt(change.time, change.open);
  // Idle: breathing and a slow head sway for the whole scene.
  for (let t = start, k = 0; t + A.breath <= end; t += A.breath, k++) {
    tw(ops, `${cid}-breath`, rt(t), A.breath, 'sine.inOut', {scaleY: k % 2 ? 1.012 : 1}, {scaleY: k % 2 ? 1 : 1.012});
  }
  const p = phase(cid);
  for (let t = start + p * 0.8, k = 0; t + A.sway <= end; t += A.sway, k++) {
    const from = {rotation: k % 2 ? A.swayDeg : 0}, to = {rotation: k % 2 ? 0 : A.swayDeg};
    tw(ops, `${cid}-headidle`, rt(t), A.sway, 'sine.inOut', from, to);
    tw(ops, `${cid}-hbidle`, rt(t), A.sway, 'sine.inOut', from, to);
  }
  // Idle arms and body (geometry.idleArms): each arm swings on its own
  // rhythm, so a figure drawn in lines never holds dead still. These move
  // wrappers inside the posed joints (armidle, foreidle), so a pose change
  // never fights them; they are absolute tweens, so any frame seeks alike.
  if (actor.geometry?.idleArms) {
    const loop = (target, period, amount, offset) => {
      for (let t = start + offset, k = 0; t + period <= end; t += period, k++) {
        tw(ops, target, rt(t), period, 'sine.inOut', {rotation: k % 2 ? amount : 0}, {rotation: k % 2 ? 0 : amount});
      }
    };
    loop(`${cid}-armidle-l`, A.armSway, A.armDeg, p * 0.7);
    loop(`${cid}-armidle-r`, A.armSway * 1.13, A.armDeg, 0.35 + p * 0.5);
    loop(`${cid}-foreidle-l`, A.foreSway, A.foreDeg, 0.2 + p * 0.9);
    loop(`${cid}-foreidle-r`, A.foreSway * 1.09, A.foreDeg, 0.6 + p * 0.4);
    // The body leans out from upright, then sways side to side about it.
    const half = A.bodySway / 2;
    if (start + p + half <= end) tw(ops, `${cid}-breath`, rt(start + p), half, 'sine.out', {rotation: 0}, {rotation: A.bodyDeg});
    for (let t = start + p + half, k = 0; t + A.bodySway <= end; t += A.bodySway, k++) {
      tw(ops, `${cid}-breath`, rt(t), A.bodySway, 'sine.inOut', {rotation: k % 2 ? -A.bodyDeg : A.bodyDeg}, {rotation: k % 2 ? A.bodyDeg : -A.bodyDeg});
    }
  }
  // Blinks
  for (let t = start + 0.9 + p * 1.6; t + 0.2 < end; t += A.blinkEvery + (p - 0.5) * 0.6) {
    for (const name of actor.expressions) {
      tw(ops, `${cid}-eyes-${name}`, rt(t), A.blinkDown, 'power1.in', {scaleY: 1}, {scaleY: 0.12});
      tw(ops, `${cid}-eyes-${name}`, rt(t + A.blinkDown), A.blinkUp, 'power1.out', {scaleY: 0.12}, {scaleY: 1});
    }
  }
}

/**
 * Mouth changes for spoken ranges: open on each word's start, closed after
 * most of a short word (long words get a second flap). ranges: [{from, to,
 * words?: [[start, end]]}] absolute seconds. Without word timings the mouth
 * flaps on a steady 0.24 s rhythm across the range.
 */
export function speechChanges(ranges) {
  const out = [];
  for (const range of ranges) {
    const words = range.words?.length ? range.words : Array.from({length: Math.max(1, Math.floor((range.to - range.from) / 0.24))}, (_, i) => [range.from + i * 0.24, range.from + i * 0.24 + 0.2]);
    for (const [s, e] of words) {
      const d = Math.max(0.08, e - s);
      const flaps = d > 0.42 ? [[s, d / 2], [s + d / 2, d / 2]] : [[s, d]];
      for (const [t, len] of flaps) {
        out.push({time: rt(t), open: true});
        out.push({time: rt(t + Math.max(0.06, Math.min(len * 0.62, 0.2))), open: false});
      }
    }
  }
  return out.sort((a, b) => a.time - b.time || (a.open ? 1 : -1));
}
