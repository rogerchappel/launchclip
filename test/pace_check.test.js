// The pace gate (docs/PLAN_AND_PACE_RFC.md §2): a front-loaded hook, no long
// gap after it, no frozen frame, per cadence format.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {resolveStory} from '@launchclip/core/story.mjs';
import {CADENCE_TARGETS, cadenceTarget} from '@launchclip/core/cadence.mjs';
import {paceFindings, paceFormat} from '@launchclip/core/pace-check.mjs';
import {gateProfile, paceGate} from '../src/quality_gates.js';

const short = cadenceTarget('short-form').pace;
const rules = (findings) => findings.map(f => `${f.severity}:${f.rule}`);
// A 20 s short with three opening events, then one every 2 s.
const steady = [0, 1, 2, ...Array.from({length: 9}, (_, i) => 3 + 2 * i)];

test('the pace bands sit inside each format\'s cadence band, and calm stretches the seconds', () => {
  for (const [format, target] of Object.entries(CADENCE_TARGETS)) {
    const {pace} = target;
    assert.ok(pace.gap_fail <= Math.max(target.gap.p90_max, target.longest_static), format);
    assert.ok(pace.gap_warn < pace.gap_fail, format);
  }
  assert.deepEqual([short.hook_window, short.hook_events, short.hook_ratio, short.gap_warn, short.gap_fail, short.max_still], [3, 3, 1.3, 2.5, 5, 0.5]);
  const calm = cadenceTarget('short-form', 'calm').pace;
  assert.equal(calm.gap_fail, 6.5);
  assert.equal(calm.hook_window, 3, 'the hook window does not stretch');
  assert.equal(cadenceTarget('talking-head').pace.max_still, null);
});

test('the format follows the profile, the lane and the runtime', () => {
  assert.equal(paceFormat({duration: 20, profile: 'short-motion'}), 'short-form');
  assert.equal(paceFormat({duration: 20, profile: {id: 'animated-explainer-reel'}}), 'short-form');
  assert.equal(paceFormat({duration: 40, profile: 'explainer-motion'}), 'motion-graphics');
  assert.equal(paceFormat({duration: 40, footage: true}), 'talking-head');
  assert.equal(paceFormat({duration: 30, profile: 'story-characters'}), 'animated');
  assert.equal(paceFormat({duration: 400, footage: true}), 'long-form');
});

test('a steady short passes', () => {
  assert.deepEqual(paceFindings({events: steady, duration: 20, pace: short}), []);
});

test('a slow hook and a flat hook warn on a plan and fail on a render', () => {
  const slow = [0, ...Array.from({length: 9}, (_, i) => 3 + 2 * i)];
  assert.deepEqual(rules(paceFindings({events: slow, duration: 20, pace: short})), ['warning:slow-hook', 'warning:flat-hook']);
  assert.deepEqual(rules(paceFindings({events: slow, duration: 20, pace: short, source: 'render'})), ['error:slow-hook', 'error:flat-hook']);
  // Events closer than 0.25 s are one.
  assert.match(paceFindings({events: [0, 0.1, 0.2, ...steady.slice(3)], duration: 20, pace: short})[0].detail, /has 1 event \(0 s\)/);
  // A hook that is mostly playing footage is left to the render.
  assert.deepEqual(rules(paceFindings({events: slow, opaque: [[0, 3]], duration: 20, pace: short})), ['warning:flat-hook']);
});

test('a gap after the hook warns past the band and fails past the fail line', () => {
  const gap = (seconds) => paceFindings({events: [0, 1, 2, 3, 3 + seconds, 19], duration: 20, pace: short}).filter(f => f.rule === 'event-gap' && f.at === 3);
  assert.deepEqual(rules(gap(2.4)), []);
  assert.deepEqual(rules(gap(3)), ['warning:event-gap']);
  assert.deepEqual(rules(gap(6)), ['error:event-gap']);
  assert.match(gap(6)[0].detail, /nothing new for 6 s \(3–9 s\)/);
  // Footage playing through the gap is not a gap.
  assert.deepEqual(paceFindings({events: [0, 1, 2, 3, 9, 11, 13, 15, 17, 19], opaque: [[3, 9]], duration: 20, pace: short}), []);
});

test('a frozen frame warns past max_still, and fails past the treatment\'s own hold>N', () => {
  const frozen = [[5, 6, ['s2']]];
  assert.deepEqual(rules(paceFindings({events: steady, duration: 20, pace: short, frozen})), ['warning:frozen-frame']);
  assert.deepEqual(rules(paceFindings({events: steady, duration: 20, pace: short, frozen, maxStill: 0.8})), ['error:frozen-frame']);
  assert.deepEqual(rules(paceFindings({events: steady, duration: 20, pace: short, frozen, maxStill: 1.2})), []);
  assert.deepEqual(rules(paceFindings({events: steady, duration: 20, pace: cadenceTarget('talking-head').pace, frozen: [[5, 9]]})), []);
});

const examples = readdirSync('examples/story').filter(name => existsSync(`examples/story/${name}/storyboard.json`));
const load = (name) => {
  const file = `examples/story/${name}/NARRATION.json`;
  const narration = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
  const story = resolveStory(JSON.parse(readFileSync(`examples/story/${name}/storyboard.json`, 'utf8')), {words: Array.isArray(narration) ? narration : narration.words ?? []});
  const mapFile = `examples/story/${name}/DIRECTION.json`;
  const map = existsSync(mapFile) ? JSON.parse(readFileSync(mapFile, 'utf8')) : null;
  return {story, map, profile: gateProfile(story, {direction: map, project: `examples/story/${name}`}).profile};
};

test('the shipped example stories pass the pace gate', () => {
  assert.ok(examples.length > 30);
  for (const name of examples) {
    const {story, map, profile} = load(name);
    const gate = paceGate({resolved: story, profile, map});
    assert.equal(gate.status, 'passed', `${name}: ${JSON.stringify(gate.findings.filter(f => f.severity === 'error'))}`);
  }
});

test('the pace gate holds a story to its treatment\'s hold>N and counts a closing card as held', () => {
  const {story, map, profile} = load('promo-16x9');
  const gate = paceGate({resolved: story, profile, map: {...map, treatment: {banned: ['hold>1']}}});
  assert.equal(gate.status, 'failed');
  assert.ok(gate.findings.some(f => f.rule === 'frozen-frame' && f.severity === 'error' && /at most 1 s/.test(f.detail)), JSON.stringify(gate.findings));
  // demo-autopilot ends on a 9.6 s call to action: a closing card, not a gap.
  const demo = load('demo-autopilot-16x9');
  assert.equal(paceGate({resolved: demo.story, profile: demo.profile, map: demo.map}).findings.filter(f => f.rule === 'event-gap' && f.at >= 35).length, 0);
});
