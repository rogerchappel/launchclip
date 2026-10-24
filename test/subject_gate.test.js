// The subject gate (docs/SUBJECT_EFFECTS_RFC.md §9): matte quality per range,
// and the fallback finish applies when a range fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {applySubjectFallback, MATTE_GATE, matteQuality, subjectFallbackLines, subjectMatteGate} from '../src/cinematic_check.js';
import {resolveStory} from '../kit/core/story.mjs';
import {readStorySubject} from '../src/subject/project.js';

const PROJECT = fileURLToPath(new URL('../examples/story/subject', import.meta.url));
const exampleInfo = () => JSON.parse(readFileSync(join(PROJECT, 'assets/subject/0.000-6.000.json'), 'utf8'));
const steady = (count = 90, coverage = 0.4) => ({usable: true, reasons: [], frames: Array.from({length: count}, (_, i) => ({t: i / 30, coverage: coverage + 0.004 * Math.sin(i)}))});

test('matteQuality: a steady matte passes', () => {
  const quality = matteQuality(steady());
  assert.equal(quality.ok, true, quality.reasons.join('; '));
  assert.ok(quality.stability > 0.95);
  assert.equal(matteQuality(exampleInfo()).ok, true, 'the example matte is exact');
});

test('matteQuality: a frame that collapses fails it', () => {
  const info = steady();
  info.frames[40].coverage = 0.01;
  const quality = matteQuality(info);
  assert.equal(quality.ok, false);
  assert.deepEqual(quality.collapsed, [1.333]);
  assert.match(quality.reasons.join(' '), /collapses in 1 frame \(coverage under 0\.13\d*, first at 1\.333 s\)/);
});

test('matteQuality: a sudden jump fails it; a gradual change does not', () => {
  const jumpy = steady();
  for (let i = 45; i < 90; i += 1) jumpy.frames[i].coverage = 0.25;
  const quality = matteQuality(jumpy);
  assert.equal(quality.ok, false);
  assert.deepEqual(quality.jumps, [1.5]);
  // The same change spread over a second and a half (hands rising) passes.
  const gradual = steady();
  for (let i = 45; i < 90; i += 1) gradual.frames[i].coverage = 0.4 - 0.15 * Math.min(1, (i - 45) / 45);
  assert.deepEqual(matteQuality(gradual).jumps, []);
});

test('matteQuality: unstable coverage, an unusable range or no frames fail it', () => {
  const wobbly = steady();
  wobbly.frames.forEach((frame, i) => { frame.coverage = 0.1 + 0.6 * ((i % 30) / 29); });
  assert.match(matteQuality(wobbly, {...MATTE_GATE, jump: 1, jumpFloor: 1}).reasons.join(' '), /unstable across the range \(stability 0\.\d+, needs 0\.7\)/);
  assert.match(matteQuality({...steady(), usable: false, reasons: ['more than one person is in frame']}).reasons.join(' '), /marked it unusable \(more than one person is in frame\)/);
  assert.equal(matteQuality({frames: []}).ok, false);
});

test('subjectMatteGate reads each range; a range without info is not measured', async () => {
  const mattes = await readStorySubject(PROJECT, JSON.parse(readFileSync(join(PROJECT, 'storyboard.json'), 'utf8')));
  const gate = await subjectMatteGate(PROJECT, mattes);
  assert.equal(gate.status, 'passed');
  assert.deepEqual(gate.ranges.map((range) => [range.in, range.out, range.ok]), [[0, 6, true]]);
  const bare = await subjectMatteGate(PROJECT, [{src: 'assets/subject/0.000-6.000.webm', in: 0, out: 6}]);
  assert.equal(bare.status, 'passed');
  assert.equal(bare.ranges[0].skipped, true);
  assert.equal((await subjectMatteGate(PROJECT, null)).status, 'skipped');
});

test('applySubjectFallback: subject modules skip, other layered scenes come to the front, only in the failing range', async () => {
  const story = JSON.parse(readFileSync(join(PROJECT, 'storyboard.json'), 'utf8'));
  // Two trims: source 0–3 s plays at 0–3 s, source 3–6 s at 3–6 s; the
  // matte for source 3–6 s fails.
  story.base.trim = [[0, 3], [3, 6]];
  story.base.subject = {mattes: [
    {src: 'assets/subject/a.webm', in: 0, out: 3, info: 'assets/subject/0.000-6.000.json'},
    {src: 'assets/subject/b.webm', in: 3, out: 6, info: 'assets/subject/0.000-6.000.json'}
  ]};
  story.scenes.push({id: 'aside', module: 'emphasis-caption', track: 4, layer: 'behind', start: 4, end: 5, params: {text: 'Ship it'}});
  story.scenes.push({id: 'early', module: 'emphasis-caption', track: 5, layer: 'behind', start: 0.5, end: 2, params: {text: 'Early'}});
  const resolved = resolveStory(story);
  const failed = [{src: 'assets/subject/b.webm', in: 3, out: 6}];
  const kept = [story.base.subject.mattes[0]];
  const {story: fallen, changes} = applySubjectFallback(story, resolved, {failed, kept});
  assert.deepEqual(changes.map((change) => [change.id, change.action]), [['dolly', 'skipped'], ['aside', 'front']]);
  assert.deepEqual(fallen.scenes.map((scene) => scene.id), ['word', 'push', 'name', 'aside', 'early']);
  assert.equal(fallen.scenes.find((scene) => scene.id === 'aside').layer, 'front');
  assert.equal(fallen.scenes.find((scene) => scene.id === 'early').layer, 'behind', 'outside the failing range nothing changes');
  assert.deepEqual(fallen.base.subject, {mattes: [{src: 'assets/subject/a.webm', in: 0, out: 3, info: 'assets/subject/0.000-6.000.json'}]});
  assert.equal(story.scenes.length, 6, 'the input story is not changed');
  assert.deepEqual(subjectFallbackLines(changes), [
    'dolly (dolly-zoom) is skipped: the presenter matte for 3–6 s failed the subject gate, and the module needs the cut-out',
    'aside (emphasis-caption) renders in front: the presenter matte for 3–6 s failed the subject gate'
  ]);
});
