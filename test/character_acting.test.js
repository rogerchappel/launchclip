// Acting quality (kit/core/characters/acting.mjs): acted pose changes
// (anticipation, overlap, settle), life while a pose holds, speech shapes and
// acting profiles. Everything is absolute ops, so every check reads frames
// through frameState in any order.
import test from 'node:test';
import assert from 'node:assert/strict';
import {poseJoints, rigGeometry} from '@launchclip/core/characters/rig.mjs';
import {starterCharacter} from '@launchclip/core/characters/cast.mjs';
import {ACTING, ACTING_PROFILES, MOVE, actingOps, blinkTimes, dartTimes, jointTargets, poseChangeOps, poseTravel, shiftTimes} from '@launchclip/core/characters/acting.mjs';
import {frameState} from '@launchclip/core/catalog-b-view.mjs';

const geometry = rigGeometry(starterCharacter('maya').params);
const targets = pose => jointTargets('c', poseJoints(pose, {geometry}));
const actor = (states, extra = {}) => ({cid: 'c', id: 'maya', start: 0, end: 8, geometry, facing: 'right', seated: false, holds: null, states,
  expressions: [...new Set(states.map(state => state.expression))], speech: [], ...extra});
const acted = (states, extra) => { const ops = []; actingOps(ops, actor(states, extra)); return ops; };
const value = (ops, t, target, prop) => frameState(ops, t).get(target)?.[prop];
const change = (from, to, profile) => { const ops = []; const strength = poseChangeOps(ops, targets(from), targets(to), 2, profile); return {ops, strength}; };

test('a big pose change is acted: a counter-move, the travel, a follow-through, at rest on the pose when the window ends', () => {
  const {ops, strength} = change('stand', 'cheer');
  assert.equal(strength, 1, 'a cheer from standing travels far');
  const arm = ops.filter(op => op.target === 'c-arm-r');
  assert.deepEqual(arm.map(op => op.ease), ['sine.inOut', ACTING.poseEase, 'sine.inOut'], 'anticipation, travel (slow, fast, slow), settle');
  const from = targets('stand')['c-arm-r'].rotation, to = targets('cheer')['c-arm-r'].rotation;
  const dir = Math.sign(to - from);
  // Anticipation: the arm first moves against its travel, by a few degrees at most.
  const back = arm[0].to.rotation;
  assert.ok((back - from) * dir < 0, 'moves away first');
  assert.ok(Math.abs(back - from) <= MOVE.cap.rotation + 1e-9);
  // Follow-through: it passes the pose slightly, then settles onto it.
  const peak = arm[1].to.rotation;
  assert.ok((peak - to) * dir > 0 && Math.abs(peak - to) <= MOVE.cap.rotation);
  assert.equal(arm[2].to.rotation, to);
  // The whole change lies inside the timing contract's window.
  for (const op of ops) assert.ok(op.start >= 2 - 1e-9 && op.start + op.duration <= 2 + ACTING.poseTween + 1e-6, `${op.target} ${op.start}+${op.duration}`);
  const state = frameState(ops, 2 + ACTING.poseTween);
  for (const [target, props] of Object.entries(targets('cheer'))) for (const [prop, want] of Object.entries(props)) {
    if (state.get(target)?.[prop] !== undefined) assert.ok(Math.abs(state.get(target)[prop] - want) < 1e-6, `${target}.${prop}`);
  }
  // The torso dips before the move (a squash) even though the pose leaves it alone.
  const torso = ops.filter(op => op.target === 'c-torso');
  assert.ok(torso[0].to.scaleY < torso[0].from.scaleY);
  // Finger opacity never leaves 0–1.
  for (const op of ops.filter(one => /fingerwrap/.test(one.target))) for (const end of [op.from, op.to]) assert.ok(end.opacity >= 0 && end.opacity <= 1);
});

test('a small pose change stays one plain tween, and an unchanged pose adds nothing', () => {
  assert.ok(poseTravel(targets('stand'), targets('slump')) < MOVE.small);
  const {ops, strength} = change('stand', 'slump');
  assert.equal(strength, 0);
  assert.ok(ops.length > 0);
  for (const op of ops) assert.deepEqual([op.start, op.duration, op.ease], [2, ACTING.poseTween, ACTING.poseEase]);
  assert.equal(new Set(ops.map(op => op.target)).size, ops.length, 'one tween per joint');
  assert.equal(change('wave', 'wave').ops.length, 0);
});

test('acting scales with how far the joints travel', () => {
  const mid = change('stand', 'lean-in'), far = change('stand', 'cheer');
  assert.ok(mid.strength > 0.35 && mid.strength < far.strength);
  const dip = ({ops}) => { const [first] = ops.filter(op => op.target === 'c-torso'); return first.from.scaleY - first.to.scaleY; };
  assert.ok(dip(mid) < dip(far));
});

test('overlap: the head, forearms and hands start after the body and still land in the window', () => {
  const {ops} = change('stand', 'cheer');
  const travel = target => ops.find(op => op.target === target && op.ease === ACTING.poseEase);
  const body = travel('c-arm-r').start;
  for (const part of ['c-fore-r', 'c-fore-l', 'c-head']) {
    const first = ops.filter(op => op.target === part)[0];
    assert.ok(first, part);
    assert.ok(first.start > body, `${part} starts at ${first.start}, after the body's ${body}`);
  }
  // A pointing finger comes out last.
  const point = change('stand', 'point').ops;
  const finger = point.find(op => op.target === 'c-fingerwrap-r'), reach = point.find(op => op.target === 'c-arm-r' && op.ease === ACTING.poseEase);
  assert.ok(finger.start > reach.start && finger.start + finger.duration <= 2 + ACTING.poseTween);
  assert.ok(travel('c-head').start < travel('c-fore-r').start, 'the head goes before the forearms');
  // The head and the hair behind it move as one.
  const head = ops.filter(op => op.target === 'c-head'), hair = ops.filter(op => op.target === 'c-hb');
  assert.deepEqual(head.map(op => ({...op, target: 0})), hair.map(op => ({...op, target: 0})));
  // The look leads: a gaze change is one tween from the cue.
  const gaze = [];
  const looking = (x, pose) => jointTargets('c', {...poseJoints(pose, {geometry}), gazeX: x, gazeY: 0, gazeScale: 1});
  poseChangeOps(gaze, looking(0, 'stand'), looking(30, 'cheer'), 2);
  assert.deepEqual(gaze.filter(op => op.target === 'c-turn').map(op => op.start), [2]);
});

test('seek-safe: any frame of an acted scene reads the same in any order, and a held gesture still starts from the pose', () => {
  const ops = acted([{time: 0, pose: 'stand', expression: 'neutral'}, {time: 2, pose: 'wave', expression: 'happy'}, {time: 5, pose: 'stand', expression: 'happy'}]);
  const times = [0.2, 1.9, 2.05, 2.2, 2.45, 3.3, 5.1, 5.45, 7.5];
  const read = t => JSON.stringify([...frameState(ops, t)].sort(([a], [b]) => a.localeCompare(b)));
  const forward = times.map(read);
  assert.deepEqual([...times].reverse().map(read).reverse(), forward);
  assert.ok(Math.abs(value(ops, 2 + ACTING.poseTween, 'c-fore-r', 'rotation') - targets('wave')['c-fore-r'].rotation) < 1e-6);
  assert.ok(Math.abs(value(ops, 5 + ACTING.poseTween, 'c-arm-r', 'rotation') - targets('stand')['c-arm-r'].rotation) < 1e-6);
  assert.doesNotMatch(JSON.stringify(ops), /NaN|null/);
});

test('profiles scale the move: bouncy swings wider, calm less, nervous is quicker; all land on the pose in the window', () => {
  const swing = name => { const {ops} = change('stand', 'cheer', ACTING_PROFILES[name]); const arm = ops.filter(op => op.target === 'c-arm-r'); return {back: Math.abs(arm[0].to.rotation - arm[0].from.rotation), done: Math.max(...ops.map(op => op.start + op.duration)), ops}; };
  const calm = swing('calm'), plain = swing('default'), bouncy = swing('bouncy'), nervous = swing('nervous');
  assert.ok(calm.back < plain.back && plain.back < bouncy.back);
  assert.ok(nervous.done < plain.done - 0.05);
  assert.ok(Math.abs(plain.done - (2 + ACTING.poseTween)) < 1e-6);
  for (const one of [calm, bouncy, nervous]) {
    assert.ok(one.done <= 2 + ACTING.poseTween + 1e-6);
    assert.ok(Math.abs(frameState(one.ops, 2 + ACTING.poseTween).get('c-arm-r').rotation - targets('cheer')['c-arm-r'].rotation) < 1e-6);
  }
});

test('life while holding: blinks come at uneven but repeatable intervals, seeded from the character id', () => {
  const maya = blinkTimes('maya', 0, 40), again = blinkTimes('maya', 0, 40), theo = blinkTimes('theo', 0, 40);
  assert.deepEqual(maya, again, 'the same character blinks at the same times on every run');
  assert.notDeepEqual(maya, theo, 'each character has its own rhythm');
  const gaps = maya.slice(1).map((t, i) => t - maya[i]);
  assert.ok(maya.length >= 8 && maya.length <= 22, `${maya.length} blinks in 40 s`);
  assert.ok(new Set(gaps.map(gap => gap.toFixed(2))).size >= gaps.length * 0.7, 'gaps differ');
  assert.ok(Math.min(...gaps) >= 0.24 - 1e-9 && Math.max(...gaps) <= ACTING.blinkEvery * 1.5 + 0.31);
  assert.ok(blinkTimes('maya', 0, 40, ACTING_PROFILES.nervous).length > maya.length && blinkTimes('maya', 0, 40, ACTING_PROFILES.calm).length < maya.length);
  // A big move brings a blink of its own; one too close to another is dropped.
  assert.ok(blinkTimes('maya', 0, 40, ACTING_PROFILES.default, [20.5]).includes(20.5) || maya.some(t => Math.abs(t - 20.5) < 0.24));
  // In a scene: every face's eyes close together and reopen fully.
  const ops = acted([{time: 0, pose: 'stand', expression: 'neutral'}, {time: 3, pose: 'cheer', expression: 'happy'}]);
  const closes = name => ops.filter(op => op.target === `c-eyes-${name}` && op.to.scaleY < 0.2).map(op => op.start);
  assert.deepEqual(closes('neutral'), closes('happy'));
  assert.ok(closes('neutral').some(t => t > 3 && t < 3 + ACTING.poseTween), 'a blink as the cheer starts');
  for (const t of closes('neutral')) assert.equal(value(ops, t + ACTING.blinkDown + ACTING.blinkUp + 0.01, 'c-eyes-neutral', 'scaleY'), 1);
});

test('life while holding: the eyes dart and return, the chest breathes and the weight shifts, so a held pose never freezes', () => {
  const ops = acted([{time: 0, pose: 'stand', expression: 'neutral'}], {end: 20});
  const darts = dartTimes('maya', 0, 20);
  assert.ok(darts.length >= 2);
  for (const dart of darts) {
    assert.ok(Math.abs(dart.x) <= ACTING.dartX && Math.abs(dart.y) <= ACTING.dartY, 'a dart is small');
    assert.equal(value(ops, dart.time + ACTING.dartOut + dart.hold / 2, 'c-eyes-neutral', 'x'), dart.x, 'held aside');
    assert.equal(value(ops, dart.time + ACTING.dartOut + dart.hold + ACTING.dartBack + 0.01, 'c-eyes-neutral', 'x'), 0, 'and back');
  }
  const shifts = shiftTimes('maya', 0, 20);
  assert.ok(shifts.length >= 3);
  assert.ok(shifts.every((shift, i) => i === 0 || Math.sign(shift.rotation) !== Math.sign(shifts[i - 1].rotation)), 'side to side');
  assert.ok(shifts.every(shift => Math.abs(shift.rotation) <= ACTING.shiftDeg * 1.5));
  // Something moves in every half second of a 20 s hold.
  const frame = t => JSON.stringify([...frameState(ops, t)].sort(([a], [b]) => a.localeCompare(b)));
  for (let t = 0.5; t < 19.5; t += 0.5) assert.notEqual(frame(t), frame(t + 0.25), `frozen at ${t}`);
  // The body's joints stay on the pose throughout: life runs on its own groups.
  for (const t of [1, 7.3, 15.9]) assert.equal(value(ops, t, 'c-arm-r', 'rotation'), targets('stand')['c-arm-r'].rotation);
  // The realistic styles keep their eyes still (the eye group is the whole eye); a stick figure sways on its idle arms instead.
  const real = acted([{time: 0, pose: 'stand', expression: 'neutral'}], {end: 20, style: 'lifelike'});
  assert.ok(!real.some(op => op.target === 'c-eyes-neutral' && op.to?.x !== undefined));
  const stick = acted([{time: 0, pose: 'stand', expression: 'neutral'}], {end: 20, geometry: {...geometry, idleArms: true}});
  assert.ok(stick.some(op => op.target === 'c-armidle-l') && !ops.some(op => op.target === 'c-armidle-l'));
  assert.ok(stick.filter(op => op.target === 'c-breath' && op.to?.rotation !== undefined).every(op => Math.abs(op.to.rotation) <= ACTING.bodyDeg), 'the stick keeps its own sway, with no weight shifts over it');
  // Profiles: a nervous character darts and shifts more, a calm one breathes slower and deeper.
  assert.ok(dartTimes('maya', 0, 20, ACTING_PROFILES.nervous).length > darts.length && shiftTimes('maya', 0, 20, ACTING_PROFILES.nervous).length > shifts.length);
  const breath = name => acted([{time: 0, pose: 'stand', expression: 'neutral'}], {end: 20, acting: name}).find(op => op.target === 'c-breath' && op.to?.scaleY > 1);
  assert.ok(breath('calm').duration > breath('default').duration && breath('calm').to.scaleY > breath('default').to.scaleY);
  assert.deepEqual([breath('default').duration, breath('default').to.scaleY], [ACTING.breath, 1.012], 'the default breath is unchanged');
});
