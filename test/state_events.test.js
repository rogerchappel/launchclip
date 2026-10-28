// State events (eval/scorecard.mjs stateEvents, scripts/state-events.mjs):
// every state change must read as a visual event, a peak scene score at the
// reference's event threshold. The pure measure always runs; the sample's
// rendered measure runs with the media tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {STATE_EVENT, scoreBrief, stateEvents, stateMarks} from '../eval/scorecard.mjs';
import {resolveStory} from '@launchclip/core/story.mjs';
import {mediaSkip} from './helpers/media.js';

const SAMPLE = new URL('../examples/story/shot-states-16x9/storyboard.json', import.meta.url);
const story = (scenes) => ({scenes});

test('state marks are scene.states and in-shot swaps, never hard cuts', () => {
  const marks = stateMarks(story([
    {id: 'a', module: 'bar-chart', start: 0, end: 6, states: [{at: 2, set: {focus: 1}}, {at: 4, set: {focus: 0}}]},
    {id: 'b', module: 'stat-card', start: 6, end: 9, in: {type: 'rack-focus', dur: 0.5}},
    {id: 'c', module: 'stat-card', start: 9, end: 12},
    {id: 'd', module: 'stat-card', start: 12, end: 14, in: {type: 'cut', dur: 0}},
    {id: 'e', module: 'callout', track: 1, start: 13, end: 14, in: {type: 'fade', dur: 0.3}}
  ]));
  assert.deepEqual(marks.map(mark => [mark.t, mark.id, mark.kind]), [[2, 'a', 'state'], [4, 'a', 'state'], [6, 'b', 'swap']]);
});

test('stateEvents takes each change\'s peak score in its window and the median against 0.08', () => {
  const s = story([{id: 'a', module: 'bar-chart', start: 0, end: 9, states: [{at: 2, set: {focus: 1}}, {at: 4, set: {focus: 0}}, {at: 6, set: {focus: null}}]}]);
  const scores = [{t: 1.5, score: 0.5}, {t: 2.03, score: 0.11}, {t: 2.07, score: 0.04}, {t: 4.1, score: 0.02}, {t: 6.4, score: 0.09}, {t: 7.2, score: 0.9}];
  const result = stateEvents(scores, s);
  assert.deepEqual(result.marks.map(mark => mark.peak), [0.11, 0.02, 0.09], 'scores outside [t - 0.1, t + 0.8] do not count');
  assert.equal(result.median, 0.09);
  assert.deepEqual(result.under, ['a']);
  assert.equal(STATE_EVENT.min, 0.08);
  const brief = {id: 'x', format: 'long-form'};
  assert.equal(scoreBrief(brief, {states: result}).checks.find(check => check.id === 'state_events').status, 'pass');
  assert.equal(scoreBrief(brief, {states: {...result, median: 0.03}}).checks.find(check => check.id === 'state_events').status, 'fail');
});

test('the shot-states sample: every state change reads as a visual event (median ≥ 0.08)', {skip: mediaSkip(), timeout: 600_000}, async () => {
  const {measureStateEvents} = await import('../scripts/state-events.mjs');
  const resolved = resolveStory(JSON.parse(await readFile(SAMPLE, 'utf8')));
  const result = await measureStateEvents(resolved);
  assert.ok(result.marks.length >= 6, JSON.stringify(result.marks));
  assert.ok(result.median >= STATE_EVENT.min, `median ${result.median}: ${result.marks.map(mark => `${mark.t} ${mark.label} ${mark.peak}`).join('; ')}`);
});
