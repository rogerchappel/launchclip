// Movement guardrails (docs/DIRECTION_GUARDRAILS.md §7): nothing holds still
// over 3 s, and no shot runs over 10 s without a state change.
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveStory} from '../kit/core/story.mjs';
import {MOVEMENT, holdGate, stateGate} from '../src/movement_guardrails.js';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const DATA = [{label: 'Model A', value: 1}, {label: 'Model B', value: 3}];
const story = (scene, extra = {}) => resolveStory({schema: 'launchclip.story.v1', lane: 'motion', brand, format: {width: 1920, height: 1080, fps: 30, duration: 16}, scenes: [scene], ...extra});
const bars = (extra = {}) => ({id: 'cost', module: 'bar-chart', start: 0, end: 16, params: {title: 'Cost per task', data: DATA}, ...extra});

test('a long chart hold with no drift is static; with drift it only warns', () => {
  const still = holdGate(story(bars(), {ambient: 'off'}));
  assert.equal(still.status, 'failed');
  const finding = still.findings.find(f => f.rule === 'static-hold');
  assert.ok(finding && finding.ids.includes('cost') && /nothing moves for \d/.test(finding.detail), JSON.stringify(still.findings));
  const drifting = holdGate(story(bars()));
  assert.equal(drifting.status, 'passed');
  assert.ok(drifting.findings.some(f => f.rule === 'drift-only' && f.severity === 'warning'));
});

test('states keep the hold alive and the shot changing', () => {
  const states = [{at: 4, set: {focus: 1}}, {at: 7, set: {guide: {value: 1.5, label: 'HALF'}}}, {at: 10, set: {focus: 0, glow: 0}}, {at: 13, set: {note: {text: 'Cheaper', target: 0}}}];
  const s = story(bars({states}), {ambient: 'off'});
  const hold = holdGate(s);
  assert.equal(hold.findings.filter(f => f.rule === 'static-hold').length, 0, JSON.stringify(hold.findings));
  const shot = stateGate(s);
  assert.equal(shot.status, 'passed', JSON.stringify(shot.findings));
  assert.equal(shot.states, 4);
});

test('one shot over 10 s with no change fails the state gate', () => {
  const s = story({id: 'card', module: 'stat-card', start: 0, end: 16, params: {value: '12', label: 'videos a week', source: 'LaunchClip telemetry'}});
  const shot = stateGate(s);
  assert.equal(shot.status, 'failed');
  assert.match(shot.findings[0].detail, /card holds one state for 1\d(\.\d)? s/);
  assert.equal(MOVEMENT.shot, 10);
  assert.equal(MOVEMENT.still, 3);
});
