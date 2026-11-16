// A member whose status changes over time (kit/core/member-status.mjs,
// docs/FLUID_MOTION_RFC.md §10): timed or on-beat changes, legible colours,
// and a crossfade that never leaves the member see-through.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MODULES, catalogHTimeline, catalogHView} from '@launchclip/core/catalog-h.mjs';
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

test('member status: colours clear 3:1 on a dark and a light bg', () => {
  for (const colors of [{bg: '#06070d', primary: '#fdb022'}, {bg: '#f4f1ea', primary: '#2f6bff'}]) {
    for (const hex of Object.values(statusColors(colors, '#8a8780'))) assert.ok(contrastRatio(hex, colors.bg) >= 3, `${hex} on ${colors.bg}`);
  }
});

test('member status: only the upper layer fades, slow → fast → slow', () => {
  const ops = [];
  statusOps(ops, 'm', [{state: 'pending', time: 0}, {state: 'pass', time: 1}, {state: 'pending', time: 2}], 0);
  const tweens = ops.filter(op => op.type === 'tween');
  assert.deepEqual(tweens.map(op => [op.target, op.start, op.to.opacity]), [['m-status-pass', 1, 1], ['m-status-pass', 2, 0]]);
  assert.ok(tweens.every(op => op.ease === STATUS_CHANGE.ease && op.ease.endsWith('.inOut')));
  assert.ok(ops.some(op => op.type === 'set' && op.target === 'm-status-pending' && op.time === 2 && op.props.opacity === 1));
});

test('member status: a node-graph node and an icon-grid item take a status member, timed with the set', () => {
  const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
  const resolve = (module, params) => ({...MODULES[module].resolve(params, {id: 's', start: 1, duration: 6, format: {width: 1080, height: 1920, fps: 30}, brand, aspect: '9:16', hits: []}), module});
  const ids = node => [node.id, ...(Array.isArray(node.children) ? node.children : []).flatMap(child => typeof child === 'object' ? ids(child) : [])].filter(Boolean);
  const member = {module: 'status', icon: 'bot', label: 'Tests', status: ['pending', {state: 'active', beat: 4}, {state: 'pass', at: 3}]};
  const graph = resolve('node-graph', {hub: 'CI', bpm: 120, nodes: ['Lint', {member, id: 't'}, 'Build']});
  assert.deepEqual(graph.content.nodes[1].graphic.status.map(c => c.time), [1, 3, 4]);
  const all = ids(catalogHView(graph));
  for (const id of ['s-g-t-status-pending', 's-g-t-status-active', 's-g-t-status-pass', 's-node-t-lit']) assert.ok(all.includes(id), id);
  assert.equal(all.filter(id => id === 's-node-t-lit').length, 1, 'the lit rim is drawn once, over every state');
  assert.ok(catalogHTimeline(graph).some(op => op.type === 'tween' && op.target === 's-g-t-status-pass' && op.start === 4));
  const grid = resolve('icon-grid', {items: ['star', {member}]});
  assert.ok(catalogHTimeline(grid).some(op => op.target === 's-g-1-status-active'));
  assert.throws(() => resolve('icon-grid', {items: ['star', {member: {...member, badge: '3'}}]}), /member.badge is not supported/);
  assert.throws(() => resolve('icon-grid', {items: ['star', {member: {module: 'status', label: 'x'}}]}), /member.status is required/);
});
