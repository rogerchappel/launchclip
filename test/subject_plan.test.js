// Planned subject ranges (src/subject/plan.js): the source seconds make mattes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveStory} from '../kit/core/story.mjs';
import {plannedSubjectRanges, plannedSubjectWindows} from '../src/subject/plan.js';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const story = (base, scenes) => resolveStory({schema: 'launchclip.story.v1', lane: 'footage-led', format: {width: 1080, height: 1920, fps: 30, duration: 20}, brand, base, scenes});

const scenes = [
  {id: 'word', module: 'masthead', track: 1, start: 2, end: 4, params: {word: 'focus'}},
  {id: 'name', module: 'lower-third', track: 2, start: 3, end: 7, params: {name: 'Ada Park'}},
  {id: 'push', module: 'punch-in', track: 3, start: 8, end: 9, params: {at: 0.1}},
  {id: 'dolly', module: 'dolly-zoom', track: 1, start: 12, end: 14.5, params: {}},
  {id: 'chart', module: 'emphasis-caption', track: 1, layer: 'behind', start: 14.4, end: 16, params: {text: 'Grow'}}
];

test('only scenes that need the subject count, merged', () => {
  assert.deepEqual(plannedSubjectWindows(story({src: 'assets/base-edit.mp4'}, scenes)), [[2, 4], [12, 16]]);
});

test('ranges are padded, clamped and merged on an untrimmed base', () => {
  assert.deepEqual(plannedSubjectRanges(story({src: 'assets/base-edit.mp4'}, scenes), {sourceDuration: 15.8}), [{in: 1.5, out: 4.5}, {in: 11.5, out: 15.8}]);
});

test('ranges map back through base.trim', () => {
  // Timeline 0–10 is source 0–10; timeline 10–20 is source 30–40.
  const trimmed = story({src: 'assets/recording.mp4', trim: [[0, 10], [30, 40]]}, scenes);
  assert.deepEqual(plannedSubjectRanges(trimmed, {pad: 0.5}), [{in: 1.5, out: 4.5}, {in: 31.5, out: 36.5}]);
});

test('a storyboard without subject scenes needs no matte', () => {
  assert.deepEqual(plannedSubjectRanges(story({src: 'assets/base-edit.mp4'}, scenes.filter((scene) => ['name', 'push'].includes(scene.id)))), []);
});
