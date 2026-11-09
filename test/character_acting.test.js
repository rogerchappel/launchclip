// Acting quality (kit/core/characters/acting.mjs): acted pose changes
// (anticipation, overlap, settle), life while a pose holds, speech shapes and
// acting profiles. Everything is absolute ops, so every check reads frames
// through frameState in any order.
import test from 'node:test';
import assert from 'node:assert/strict';
import {poseJoints, rigGeometry} from '@launchclip/core/characters/rig.mjs';
import {starterCharacter} from '@launchclip/core/characters/cast.mjs';
import {ACTING, ACTING_PROFILES, MOVE, actingOps, jointTargets, poseChangeOps, poseTravel} from '@launchclip/core/characters/acting.mjs';
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
