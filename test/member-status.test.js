// A member whose status changes over time (kit/core/member-status.mjs,
// docs/FLUID_MOTION_RFC.md §10): timed or on-beat changes, legible colours,
// and a crossfade that never leaves the member see-through.
import test from 'node:test';
import assert from 'node:assert/strict';
import {makeCheck} from '@launchclip/core/catalog-b-base.mjs';
import {contrastRatio} from '@launchclip/core/oklch.mjs';
import {STATUS_CHANGE, memberStatus, statusColors, statusOps} from '@launchclip/core/member-status.mjs';

const check = makeCheck('');
const opts = {start: 2, until: 7, beat: 0.5};

test('member status: a fixed state, timed changes and beat changes', () => {
  assert.deepEqual(memberStatus(check, 'pass', 's', opts), [{state: 'pass', time: 2}]);
  assert.deepEqual(memberStatus(check, ['pending', {state: 'active', at: 1}, {state: 'pass', beat: 4}], 's', opts),
    [{state: 'pending', time: 2}, {state: 'active', time: 3}, {state: 'pass', time: 4}]);
});

test('member status: errors say what to change', () => {
  const fails = [
    [[{state: 'pending', at: 1}], /holds from the scene start/],
    [['pending', {state: 'pass'}], /needs at/],
    [['pending', {state: 'pass', at: 1, beat: 2}], /at or beat, not both/],
    [['pending', {state: 'pending', at: 1}], /repeats the state/],
    [['pending', {state: 'pass', at: 1}, {state: 'fail', at: 1.1}], /at least 0.3s apart/],
    [['pending', {state: 'pass', at: 4.9}], /finishes after the module starts to leave/],
    [['done'], /must be one of pending/]
  ];
  for (const [raw, message] of fails) assert.throws(() => memberStatus(check, raw, 's', opts), message, JSON.stringify(raw));
});

test('member status: colours clear 3:1 on bg, and a brand pass colour is used', () => {
  const colors = {bg: '#06070d', primary: '#fdb022', paper: '#f2eee6', pass: '#22c55e'};
  const tones = statusColors(colors, '#6b6a6b');
  for (const hex of Object.values(tones)) assert.ok(contrastRatio(hex, colors.bg) >= 3);
  assert.equal(tones.pass, '#22c55e');
});

test('member status: only the upper layer fades, slow → fast → slow', () => {
  const ops = [];
  statusOps(ops, 'm', [{state: 'pending', time: 0}, {state: 'pass', time: 1}, {state: 'pending', time: 2}], 0);
  const tweens = ops.filter(op => op.type === 'tween');
  assert.deepEqual(tweens.map(op => [op.target, op.start, op.to.opacity]), [['m-status-pass', 1, 1], ['m-status-pass', 2, 0]]);
  assert.ok(tweens.every(op => op.ease === STATUS_CHANGE.ease && op.ease.endsWith('.inOut')));
  assert.ok(ops.some(op => op.type === 'set' && op.target === 'm-status-pending' && op.time === 2 && op.props.opacity === 1));
});
