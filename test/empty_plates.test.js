// Empty plates between scenes: the blind-test landscape cut showed a bare
// background for a few frames around a cut into kinetic-words, whose first
// beat arrives 0.1 s into the scene after the count-up has already gone.
// Short empty spans (a timing gap plus the next scene's lead-in, under 0.5 s)
// hold the previous plate; longer ones are reported by story validate and
// layout-check.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {getEase} from '../kit/core/motion.mjs';
import {HOLD_GAP, emptyPlates, layerStateAt, sceneLeadIn, sceneWindows} from '../kit/core/transitions.mjs';
import {resolveStory, validateStory} from '../kit/core/story.mjs';
import {checkLayoutProject} from '../src/layout_check.js';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'inter', meta: 'jetbrains-mono'}};
const story = (scenes) => ({schema: 'launchclip.story.v1', title: 'Plates', lane: 'motion', format: {width: 1920, height: 1080, fps: 30, duration: 10}, brand, scenes});
const count = (id, start, end) => ({id, module: 'count-up', start, end, params: {value: 42, label: 'Things counted'}});
const words = (id, start, end, at = 0.1) => ({id, module: 'kinetic-words', start, end, in: {type: 'cut', dur: 0.1}, params: {words: [{text: 'What can', at}, {text: 'it draw?', at: 0.75}]}});

test('a cut into a kinetic-words lead-in holds the previous plate until the first beat', () => {
  const resolved = resolveStory(story([count('s1', 0, 4), words('s2', 4, 7)]));
  assert.equal(sceneLeadIn(resolved.scenes[1]), 0.1);
  const windows = sceneWindows(resolved);
  const s1 = windows.scenes.find((entry) => entry.id === 's1'), s2 = windows.scenes.find((entry) => entry.id === 's2');
  assert.equal(s1.renderEnd, 4.1);
  // The incoming plate (opaque) stays transparent through the lead-in, then shows.
  assert.equal(layerStateAt(4.05, s2.tweens, getEase).opacity, 0);
  assert.equal(layerStateAt(4.1, s2.tweens, getEase).opacity, 1);
  assert.equal(layerStateAt(5, s2.tweens, getEase).opacity, 1);
  assert.deepEqual(emptyPlates(resolved), []);
  // A beat on frame 0 needs no hold.
  const settled = resolveStory(story([count('s1', 0, 4), words('s2', 4, 7, 0)]));
  assert.equal(sceneWindows(settled).scenes.find((entry) => entry.id === 's1').renderEnd, 4);
});

test('a short gap in scene timing holds the previous plate; a long one is an empty plate', () => {
  const short = resolveStory(story([count('s1', 0, 4), count('s2', 4.3, 8)]));
  assert.equal(sceneWindows(short).scenes.find((entry) => entry.id === 's1').renderEnd, 4.3);
  assert.deepEqual(emptyPlates(short), []);
  const long = resolveStory(story([count('s1', 0, 4), count('s2', 4 + HOLD_GAP + 0.1, 8)]));
  assert.equal(sceneWindows(long).scenes.find((entry) => entry.id === 's1').renderEnd, 4);
  assert.deepEqual(emptyPlates(long), [{from: 4, to: 4.6, before: 's1', after: 's2'}]);
  // Gap plus lead-in together decide: 0.35 s gap + 0.25 s lead-in is too long to hold.
  const both = resolveStory(story([count('s1', 0, 4), words('s2', 4.35, 8, 0.25)]));
  assert.deepEqual(emptyPlates(both), [{from: 4, to: 4.6, before: 's1', after: 's2'}]);
});

test('story validation warns about gaps in scene timing', () => {
  const result = validateStory(story([count('s1', 0, 4), count('s2', 4.3, 7), count('s3', 7.8, 10)]));
  assert.ok(result.ok);
  assert.ok(result.warnings.some((warning) => /^empty plate from 4 s to 4\.3 s \(between scenes\[0\] \(s1\) and scenes\[1\] \(s2\)\): no scene covers it; the previous scene is held through it/.test(warning)), result.warnings.join('\n'));
  assert.ok(result.warnings.some((warning) => /^empty plate from 7 s to 7\.8 s .*the bare background shows/.test(warning)), result.warnings.join('\n'));
  assert.ok(!validateStory(story([count('s1', 0, 4), count('s2', 4, 8)])).warnings.some((warning) => /empty plate/.test(warning)));
});

test('layout-check reports an empty plate it cannot hold', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lc-plates-'));
  try {
    await writeFile(path.join(dir, 'storyboard.json'), JSON.stringify(story([count('s1', 0, 4), count('s2', 4.8, 9)])));
    const report = await checkLayoutProject(dir);
    const finding = report.findings.find((entry) => entry.rule === 'empty-plate');
    assert.ok(finding, JSON.stringify(report.findings));
    assert.equal(finding.severity, 'warning');
    assert.match(finding.detail, /^empty plate from 4 s to 4\.8 s \(after s1, before s2 draws anything\)/);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});
