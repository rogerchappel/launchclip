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
// - Life while a pose holds, on separate groups: breathing (the chest), a
//   slow head sway, blinks at uneven intervals (and as a big move starts),
//   small eye darts and slight weight shifts, each on a schedule seeded from
//   the character's id.
// - Expressions crossfade their faces; mouths take a shape per sound of the
//   character's spoken words (speechChanges: a small viseme set made from
//   the closed and open mouths every face draws), from the voice's phonemes
//   and their lengths when a word carries them, else from its spelling.
// - An acting profile (ACTING_PROFILES) scales all of it per character.
//
// Every op is an absolute set or from-to tween, so any frame can be drawn
// on its own (seek-safe); nothing is random. Times are absolute seconds.
// Imports only sibling kit/core files.

import {set, tw} from '../catalog-b-view.mjs';
import {HELD_AIDS, poseJoints} from './rig.mjs';

export const ACTING = Object.freeze({turn: 0.12, poseTween: 0.45, poseEase: 'power2.inOut', faceFade: 0.16, breath: 1.7, breathDepth: 0.012, sway: 2.6, swayDeg: 1.4, blinkEvery: 3.4, blinkDown: 0.06, blinkUp: 0.09,
  // Idle arms (styles whose geometry sets idleArms): a slow swing at the shoulder and a give at the elbow, and a slight sway of the body.
  armSway: 2.9, armDeg: 3, foreSway: 2.3, foreDeg: 7, bodySway: 3.7, bodyDeg: 0.9,
  // Life while holding: eye darts (rig units aside and up or down, seconds out and back) and weight shifts (degrees).
  dartX: 5, dartY: 1.2, dartOut: 0.07, dartBack: 0.1, shiftDeg: 0.9});

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

/**
 * A to-and-fro of one prop between a and b from t0 to the scene's end: whole
 * eased swings, then the part of one that fits, so idle motion runs to the
 * last frame rather than stopping where a whole swing no longer fits.
 */
function swing(ops, targets, prop, t0, end, period, a, b) {
  for (let t = t0, k = 0; t < end - 0.05; t += period, k++) {
    const from = k % 2 ? b : a, to = k % 2 ? a : b;
    const whole = t + period <= end + 1e-9;
    // The part of an eased swing covered by the time left.
    const share = whole ? 1 : (1 - Math.cos(Math.PI * (end - t) / period)) / 2;
    for (const target of targets) tw(ops, target, rt(t), whole ? period : rt(end - t), whole || share > 0.5 ? 'sine.inOut' : 'sine.in', {[prop]: from}, {[prop]: rt(from + (to - from) * share)});
  }
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
 *           speech: [{time, shape, open}] mouth changes (speechChanges)}
 */
export function actingOps(ops, actor) {
  const {cid, start, end, states} = actor;
  const A = ACTING;
  const P = actingProfile(actor.acting);
  const jointsAt = state => stateJoints(state, actor);
  // A state's look: its pose, facing and seat (a new look restarts the gesture loop).
  const lookOf = state => `${state.pose}|${state.facing ?? actor.facing}|${state.standing ? 1 : 0}`;
  // Poses
  const moveBlinks = [];
  // Life is seeded from the character's id (the part id when there is none), so each character has its own rhythm.
  const seed = actor.id ?? cid;
  let current = jointsAt(states[0]);
  for (const [target, props] of Object.entries(jointTargets(cid, current))) set(ops, target, start, props);
  states.forEach((state, i) => {
    const next = jointsAt(state);
    const holdEnd = i + 1 < states.length ? states[i + 1].time : end;
    let settle = state.time;
    const from = jointTargets(cid, current), to = jointTargets(cid, next);
    if (i > 0 && Object.keys(to).some(target => !same(from[target], to[target]))) {
      // The eyes close as a big move starts.
      if (poseChangeOps(ops, from, to, state.time, P) >= 0.8) moveBlinks.push(state.time + A.poseTween * P.pace * MOVE.anticipate);
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
  // (the face's own opacity picks which one shows). A spoken shape is the
  // open mouth at that shape's size (VISEMES).
  const mouthAt = (time, shape) => actor.expressions.forEach(name => {
    const size = VISEMES[shape] ?? null;
    set(ops, `${cid}-mouth-${name}`, rt(time), {opacity: size ? 0 : 1});
    set(ops, `${cid}-open-${name}`, rt(time), size ? {opacity: 1, scaleX: size[0], scaleY: size[1]} : {opacity: 0});
  });
  actor.expressions.forEach(name => set(ops, `${cid}-open-${name}`, start, {scaleX: 1, scaleY: 1}));
  mouthAt(start, 'closed');
  for (const change of actor.speech) if (change.time > start && change.time < end) mouthAt(change.time, change.shape ?? (change.open ? 'open' : 'closed'));
  // Idle: breathing and a slow head sway for the whole scene.
  const p = phase(cid);
  swing(ops, [`${cid}-breath`], 'scaleY', start, end, rt(A.breath / P.breathRate), 1, rt(1 + A.breathDepth * P.breath));
  swing(ops, [`${cid}-headidle`, `${cid}-hbidle`], 'rotation', start + p * 0.8, end, A.sway, 0, A.swayDeg);
  // Idle arms and body (geometry.idleArms): each arm swings on its own
  // rhythm, so a figure drawn in lines never holds dead still. These move
  // wrappers inside the posed joints (armidle, foreidle), so a pose change
  // never fights them; they are absolute tweens, so any frame seeks alike.
  if (actor.geometry?.idleArms) {
    swing(ops, [`${cid}-armidle-l`], 'rotation', start + p * 0.7, end, A.armSway, 0, A.armDeg);
    swing(ops, [`${cid}-armidle-r`], 'rotation', start + 0.35 + p * 0.5, end, A.armSway * 1.13, 0, A.armDeg);
    swing(ops, [`${cid}-foreidle-l`], 'rotation', start + 0.2 + p * 0.9, end, A.foreSway, 0, A.foreDeg);
    swing(ops, [`${cid}-foreidle-r`], 'rotation', start + 0.6 + p * 0.4, end, A.foreSway * 1.09, 0, A.foreDeg);
    // The body leans out from upright, then sways side to side about it.
    const half = A.bodySway / 2;
    if (start + p + half <= end) tw(ops, `${cid}-breath`, rt(start + p), half, 'sine.out', {rotation: 0}, {rotation: A.bodyDeg});
    swing(ops, [`${cid}-breath`], 'rotation', start + p + half, end, A.bodySway, A.bodyDeg, -A.bodyDeg);
  }
  // Blinks: irregular, with the odd double blink, and one as each big move starts.
  for (const t of blinkTimes(seed, start, end, P, moveBlinks)) {
    for (const name of actor.expressions) {
      tw(ops, `${cid}-eyes-${name}`, rt(t), A.blinkDown, 'power1.in', {scaleY: 1}, {scaleY: 0.12});
      tw(ops, `${cid}-eyes-${name}`, rt(t + A.blinkDown), A.blinkUp, 'power1.out', {scaleY: 0.12}, {scaleY: 1});
    }
  }
  // Eye darts: a quick glance aside, a short hold, and back (the eyes' own
  // offset, so a blink's scale never fights it). Not for the realistic
  // styles, whose eye group is the whole eye, lids and all.
  if (!NO_DARTS.includes(actor.style)) {
    for (const dart of dartTimes(seed, start, end, P)) {
      const aside = {x: dart.x, y: dart.y};
      for (const name of actor.expressions) {
        tw(ops, `${cid}-eyes-${name}`, rt(dart.time), A.dartOut, 'power2.out', {x: 0, y: 0}, aside);
        tw(ops, `${cid}-eyes-${name}`, rt(dart.time + A.dartOut + dart.hold), A.dartBack, 'power2.inOut', aside, {x: 0, y: 0});
      }
    }
  }
  // Weight shifts: the upper body eases a little to one side, holds, then to
  // the other, at uneven intervals (styles with idle arms sway above instead).
  if (!actor.geometry?.idleArms) {
    let lean = 0;
    for (const shift of shiftTimes(seed, start, end, P)) {
      tw(ops, `${cid}-breath`, rt(shift.time), shift.duration, 'sine.inOut', {rotation: lean}, {rotation: shift.rotation});
      lean = shift.rotation;
    }
  }
}

// ---------------------------------------------------------------------------
// Life while a pose holds. Each schedule is drawn from a generator seeded
// with the character's id, so it is uneven but the same on every run, in
// both renderers and at any seek position.

// Styles whose eyes do not dart (the eye group carries the lids and whites).
const NO_DARTS = Object.freeze(['lifelike', 'cinematic']);

/** A deterministic generator of numbers in [0, 1) for a text seed. */
export function seededRandom(seed) {
  let a = 2166136261;
  for (const ch of String(seed)) a = Math.imul(a ^ ch.charCodeAt(0), 16777619);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * When a character blinks between start and end: gaps around
 * ACTING.blinkEvery (half to one and a half times it, divided by the
 * profile's blink rate), one in five followed by a second blink, plus the
 * `extra` times (big moves). No two closer than a blink takes.
 */
export function blinkTimes(seed, start, end, P = ACTING_PROFILES.default, extra = []) {
  const A = ACTING, rand = seededRandom(`${seed}|blink`);
  const times = [...extra];
  for (let t = start + 0.5 + rand() * 1.6; t + 0.2 < end; t += A.blinkEvery * (0.5 + rand()) / P.blinks) {
    times.push(t);
    if (rand() < 0.2) times.push(t + 0.3);
  }
  const out = [];
  for (const t of times.sort((a, b) => a - b)) if (t >= start && t + 0.2 < end && (!out.length || t - out[out.length - 1] >= 0.24)) out.push(rt(t));
  return out;
}

/** Eye darts between start and end: [{time, hold, x, y}] (rig units; the eyes return after the hold). */
export function dartTimes(seed, start, end, P = ACTING_PROFILES.default) {
  const A = ACTING, rand = seededRandom(`${seed}|dart`);
  const out = [];
  for (let t = start + 1 + rand() * 2.4; ;) {
    const hold = 0.3 + rand() * 0.7;
    const x = (rand() < 0.5 ? -1 : 1) * (A.dartX * (0.55 + 0.45 * rand()));
    const y = (rand() - 0.5) * A.dartY * 2;
    const length = A.dartOut + hold + A.dartBack;
    if (t + length > end - 0.05) break;
    out.push({time: rt(t), hold: rt(hold), x: rt(x), y: rt(y)});
    t += length + (1.8 + rand() * 3.6) / P.darts;
  }
  return out;
}

/** Weight shifts between start and end: [{time, duration, rotation}] (degrees the upper body leans to, alternating sides). */
export function shiftTimes(seed, start, end, P = ACTING_PROFILES.default) {
  const A = ACTING, rand = seededRandom(`${seed}|shift`);
  const out = [];
  let side = rand() < 0.5 ? -1 : 1;
  for (let t = start + 0.7 + rand() * 1.5; ;) {
    const duration = 0.8 + rand() * 0.5;
    if (t + duration > end) break;
    out.push({time: rt(t), duration: rt(duration), rotation: rt(side * A.shiftDeg * (0.6 + 0.4 * rand()) * Math.min(1.5, P.shifts))});
    side = -side;
    t += duration + (1.4 + rand() * 2.8) / P.shifts;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Speech. The rig draws two mouths per face: closed and open. Speech picks a
// mouth shape (a viseme) per sound and makes it from those two: `closed` is
// the closed mouth; the others are the open mouth at a size (view.mjs gives
// it a pivot at its centre), so every expression keeps its own mouth.

/** Mouth shapes: the open mouth's [scaleX, scaleY] (closed: the closed mouth). */
export const VISEMES = Object.freeze({closed: null, small: Object.freeze([0.72, 0.6]), o: Object.freeze([0.62, 0.95]), wide: Object.freeze([1.22, 0.7]), open: Object.freeze([1, 1])});

// English spelling → shapes, longest match first. Rough on purpose: the
// lips press on m, b, p; round on o, u, w; spread on e, i; drop on a; and
// are part open on every other consonant.
const SOUNDS = [
  [/^(oo|ou|ow|oa|au|aw|wh|qu)/, 'o'], [/^(ee|ea|ie|ei|ey|ai|ay)/, 'wide'], [/^(th|sh|ch|ph|ng|ck)/, 'small'],
  [/^[mbp]/, 'closed'], [/^[ouw]/, 'o'], [/^[eiy]/, 'wide'], [/^a/, 'open'], [/^h/, null], [/^[a-z]/, 'small']
];
// The shortest a mouth shape is held, in seconds (about two frames at 30 fps).
const VISEME_MIN = 0.07;

/**
 * A word's mouth shapes from its spelling, at most `max` of them:
 * ['closed' | 'small' | 'o' | 'wide' | 'open', …] ([] when it has no letters).
 * With more sounds than fit, the part-open consonants go first, so the
 * vowels and the pressed lips (the shapes that read) stay.
 */
export function wordVisemes(text, max = Infinity) {
  let rest = String(text ?? '').toLowerCase().replace(/[^a-z]/g, '');
  // A silent final e ("flow" keeps its w, "make" drops its e).
  if (rest.length > 3 && /[^aeiou]e$/.test(rest)) rest = rest.slice(0, -1);
  const out = [];
  while (rest) {
    const [pattern, shape] = SOUNDS.find(([one]) => one.test(rest));
    rest = rest.slice(pattern.exec(rest)[0].length);
    if (shape && out[out.length - 1] !== shape) out.push(shape);
  }
  const merge = list => list.filter((shape, i) => shape !== list[i - 1]);
  let shapes = out;
  while (shapes.length > Math.max(1, max)) {
    // Drop a part-open consonant from the middle first, else the middle shape.
    const smalls = shapes.map((shape, i) => (shape === 'small' ? i : -1)).filter(i => i >= 0);
    const middle = (shapes.length - 1) / 2;
    const drop = smalls.length ? smalls.reduce((best, i) => (Math.abs(i - middle) < Math.abs(best - middle) ? i : best)) : Math.round(middle);
    const next = merge(shapes.filter((_, i) => i !== drop));
    shapes = next.length ? next : [shapes[0]];
  }
  return shapes;
}

// Phonemes → shapes. A voice engine that reports phonemes with their lengths
// (Kokoro, src/voice/kokoro.js) gives each word `symbol:milliseconds` pairs
// in order from the word's start; the symbols are IPA code points as espeak
// writes them, or Kokoro's one-letter diphthongs. A sound not listed here is
// a part-open consonant or a neutral vowel ('small').
const PHONEME_SHAPES = new Map([
  ...Array.from('mbp', c => [c, ['closed']]),
  ...Array.from('wuʊoɔO', c => [c, ['o']]),
  ...Array.from('iɪeɛjA', c => [c, ['wide']]),
  ...Array.from('aɑæʌɐ', c => [c, ['open']]),
  // One-letter diphthongs: I (my), W (now), Y (boy), Q (British "go").
  ['I', ['open', 'wide']], ['W', ['open', 'o']], ['Y', ['o', 'wide']], ['Q', ['small', 'o']]
]);
// Sounds with no shape of their own: the mouth is already on the next one
// (h, a glottal stop, a stress mark) or stays on the last (a length mark).
const PHONEME_LEADS = new Set(Array.from('hʔˈˌ'));
const PHONEME_HOLDS = new Set(Array.from('ːˑʰʲ̩̃'));
// The least a shape keeps when pressed lips beside it take time to be seen.
const VISEME_SPARE = 0.05;
// The longest a closing consonant holds the mouth part open before it closes.
const TAIL_HOLD = 0.16;

/** A word's phonemes as kept in NARRATION.json ("h:55 ə:40 …") → [[symbol, seconds]]; [] when there are none. */
export function parsePhonemes(phonemes) {
  if (typeof phonemes !== 'string') return [];
  const out = [];
  for (const part of phonemes.trim().split(/\s+/)) {
    const cut = part.lastIndexOf(':');
    const ms = cut > 0 ? Number(part.slice(cut + 1)) : NaN;
    if (!Number.isFinite(ms) || ms < 0) return [];
    out.push([part.slice(0, cut), ms / 1000]);
  }
  return out;
}

/**
 * A word's mouth shapes from its phonemes, timed by their lengths and fitted
 * to the word's span: [{time, shape}] in order, the first at `start` (null
 * when the phonemes give no shape, so the caller reads the spelling).
 * - The lengths are scaled to the word (its start may have been snapped to
 *   the audio since they were measured).
 * - A stress mark or an h belongs to the sound after it; a length mark to
 *   the one before; a rest inside the word (`_`) closes the mouth when it is
 *   long enough to see.
 * - No shape is held for less than VISEME_MIN: a short part-open consonant
 *   gives its time to its neighbours first; pressed lips and vowels take
 *   time from a longer neighbour, and go only when there is none to take
 *   (pressed lips read most, so their neighbour may drop to VISEME_SPARE).
 * `end` (returned as the last entry's `until`) is where the mouth may close:
 * the word's end, or sooner when a closing consonant trails off.
 */
export function phonemeVisemes(phonemes, start, end) {
  const sounds = parsePhonemes(phonemes);
  const total = sounds.reduce((sum, [, seconds]) => sum + seconds, 0);
  if (!(total > 0) || !(end > start)) return null;
  const scale = (end - start) / total;
  let runs = [];
  let time = start, lead = null;
  for (const [symbol, seconds] of sounds) {
    const length = seconds * scale;
    if (symbol === '_') { if (length >= VISEME_MIN) runs.push({time, shape: 'closed'}); lead = null; }
    else if (PHONEME_LEADS.has(symbol)) lead ??= time;
    else if (!PHONEME_HOLDS.has(symbol)) {
      const shapes = PHONEME_SHAPES.get(symbol) ?? ['small'];
      const from = lead ?? time, span = time + length - from;
      shapes.forEach((shape, i) => runs.push({time: from + (span * i) / shapes.length, shape}));
      lead = null;
    }
    time += length;
  }
  const merge = list => list.filter((run, i) => i === 0 || run.shape !== list[i - 1].shape);
  runs = merge(runs);
  if (!runs.some(run => run.shape !== 'closed')) return runs.length && sounds.some(([symbol]) => PHONEME_SHAPES.has(symbol)) ? [{time: start, shape: 'closed', until: end}] : null;
  runs[0].time = start;
  const length = i => (i + 1 < runs.length ? runs[i + 1].time : end) - runs[i].time;
  for (let guard = 0; guard < 200 && runs.length > 1; guard++) {
    const short = runs.map((_, i) => i).filter(i => length(i) < (runs[i].least ?? VISEME_MIN) - 1e-9);
    if (!short.length) break;
    // The part-open consonants go first; among equals, the shortest.
    const pick = short.reduce((best, i) => {
      const a = runs[i].shape === 'small' ? 0 : 1, b = runs[best].shape === 'small' ? 0 : 1;
      return a < b || (a === b && length(i) < length(best) - 1e-9) ? i : best;
    });
    const need = (runs[pick].least ?? VISEME_MIN) - length(pick);
    if (runs[pick].shape !== 'small') {
      // Take the time from a neighbour that can spare it: the next one, else the one before.
      const least = runs[pick].shape === 'closed' ? VISEME_SPARE : VISEME_MIN;
      if (pick + 1 < runs.length && length(pick + 1) - need >= least - 1e-9) { runs[pick + 1].time += need; runs[pick + 1].least = least; continue; }
      if (pick > 0 && length(pick - 1) - need >= least - 1e-9) { runs[pick].time -= need; runs[pick - 1].least = least; continue; }
    }
    // Drop it: the shape before holds through it (the first one's time goes to the next).
    if (pick === 0) runs[1].time = start;
    runs = merge(runs.filter((_, i) => i !== pick));
  }
  const last = runs.length - 1;
  const until = runs[last].shape === 'small' && end - runs[last].time > TAIL_HOLD ? runs[last].time + TAIL_HOLD : end;
  return runs.map((run, i) => ({time: run.time, shape: run.shape, ...(i === last ? {until} : {})}));
}

// Shapes for speech with no text to read, in turn.
const UNREAD = ['open', 'small', 'wide', 'open', 'o', 'small'];

/**
 * Mouth changes for spoken ranges: [{time, shape, open}] in time order
 * (shape: a VISEMES name; open: false for the closed mouth).
 * ranges: [{from, to, words?: [[start, end, text?, phonemes?]]}] absolute seconds.
 * - A word with its phonemes ("symbol:milliseconds …", the voice engine's
 *   own) takes a shape per sound for as long as the voice holds it
 *   (phonemeVisemes).
 * - A word with only its text takes the shapes of its spelling
 *   (wordVisemes), spread evenly across the word. Either way the mouth
 *   closes when the word ends unless the next one follows at once.
 * - A word without text opens on its start and closes after most of it (a
 *   long word gets a second flap), cycling through the open shapes.
 * - A range without word timings flaps on a steady 0.24 s rhythm.
 */
export function speechChanges(ranges) {
  const out = [];
  let unread = 0;
  for (const range of ranges) {
    const words = range.words?.length ? range.words : Array.from({length: Math.max(1, Math.floor((range.to - range.from) / 0.24))}, (_, i) => [range.from + i * 0.24, range.from + i * 0.24 + 0.2]);
    words.forEach(([s, e, text, phonemes], index) => {
      const d = Math.max(0.08, e - s);
      const next = words[index + 1];
      const heard = phonemes ? phonemeVisemes(phonemes, s, s + d) : null;
      if (heard) {
        for (const {time, shape} of heard) out.push({time: rt(time), shape, open: shape !== 'closed'});
        const until = heard[heard.length - 1].until;
        if (!next || next[0] - until >= VISEME_MIN) out.push({time: rt(until), shape: 'closed', open: false});
        return;
      }
      const shapes = typeof text === 'string' ? wordVisemes(text, Math.floor(d / VISEME_MIN)) : [];
      if (shapes.length) {
        shapes.forEach((shape, i) => out.push({time: rt(s + (d * i) / shapes.length), shape, open: shape !== 'closed'}));
        if (!next || next[0] - (s + d) >= VISEME_MIN) out.push({time: rt(s + d), shape: 'closed', open: false});
        return;
      }
      const flaps = d > 0.42 ? [[s, d / 2], [s + d / 2, d / 2]] : [[s, d]];
      for (const [t, len] of flaps) {
        out.push({time: rt(t), shape: UNREAD[unread++ % UNREAD.length], open: true});
        out.push({time: rt(t + Math.max(0.06, Math.min(len * 0.62, 0.2))), shape: 'closed', open: false});
      }
    });
  }
  out.sort((a, b) => a.time - b.time || (a.open ? 1 : -1));
  // A shape that repeats the one before it changes nothing.
  return out.filter((change, i) => i === 0 || change.shape !== out[i - 1].shape || change.time === out[i - 1].time);
}
