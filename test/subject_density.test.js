// The subject-effect density budget (docs/SUBJECT_EFFECTS_RFC.md §7.5): a
// warning, never an error, when presenter effects cover too much of the
// runtime, sit too close together, or two different ones run back to back.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {isSubjectEffect, SUBJECT_DENSITY, subjectDensityFindings, subjectDensityWarnings} from '../kit/core/modules.mjs';
import {checkLayoutProject} from '../src/layout_check.js';
import {checkStoryboard} from '../src/storyboard_planner.js';

const PROJECT = fileURLToPath(new URL('../examples/story/subject', import.meta.url));
const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};

function story(scenes, {duration = 30, lane = 'footage-led'} = {}) {
  return {
    schema: 'launchclip.story.v1', lane, format: {width: 1080, height: 1920, fps: 30, duration}, brand,
    base: lane === 'footage-led' ? {src: 'assets/recording.mp4'} : null,
    scenes: scenes.map(([id, module, start, end, extra = {}], i) => ({id, module, track: i + 1, start, end, params: {}, ...extra}))
  };
}

test('subject effects: modules that need the subject, behind scenes and the presenter cameras', () => {
  assert.equal(isSubjectEffect({module: 'masthead'}), true);
  assert.equal(isSubjectEffect({module: 'scrapbook'}), true);
  for (const id of SUBJECT_DENSITY.cameras) assert.equal(isSubjectEffect({module: id}), true, id);
  assert.equal(isSubjectEffect({module: 'emphasis-caption', layer: 'behind'}), true);
  assert.equal(isSubjectEffect({module: 'lower-third'}), false);
  assert.equal(isSubjectEffect({module: 'callout'}), false);
});

test('a sparse story gets no warnings', () => {
  const sparse = story([['a', 'masthead', 2, 5], ['b', 'lower-third', 5, 9], ['c', 'punch-in', 12, 14], ['d', 'dolly-zoom', 20, 22.5]]);
  assert.deepEqual(subjectDensityWarnings(sparse), []);
});

test('stories outside the footage-led lane are never checked', () => {
  assert.deepEqual(subjectDensityWarnings(story([['a', 'punch-in', 0, 10], ['b', 'masthead', 10, 20]], {lane: 'motion'})), []);
});

test('over 35% of the runtime warns, counting overlaps once', () => {
  // 0–8 and 6–11 overlap: 11 s of 30 is 37%.
  const crowded = story([['a', 'masthead', 0, 8], ['b', 'punch-in', 6, 11]]);
  const [cover] = subjectDensityFindings(crowded).filter((finding) => /of the runtime/.test(finding.detail));
  assert.ok(cover);
  assert.match(cover.detail, /cover 37% of the runtime \(11 of 30 s; a, b\)/);
  assert.deepEqual(cover.ids, ['a', 'b']);
  // 10 s of 30 (33%) is inside the budget.
  assert.deepEqual(subjectDensityWarnings(story([['a', 'masthead', 0, 5], ['b', 'masthead', 15, 20]])), []);
});

test('two effects closer than 3 s warn', () => {
  const [finding] = subjectDensityFindings(story([['a', 'punch-in', 2, 4], ['b', 'punch-in', 5.5, 7]]));
  assert.deepEqual(finding.ids, ['a', 'b']);
  assert.equal(finding.at, 4);
  assert.match(finding.detail, /are 1\.5 s apart .* at least 3 s apart/);
  assert.deepEqual(subjectDensityWarnings(story([['a', 'punch-in', 2, 4], ['b', 'punch-in', 7, 8]])), []);
});

test('two different effects back to back warn as such', () => {
  const [finding] = subjectDensityFindings(story([['a', 'masthead', 2, 4], ['b', 'dolly-zoom', 4, 6]]));
  assert.match(finding.detail, /a \(masthead\) and b \(dolly-zoom\) run back to back at 4 s/);
  // The same module chained is only "too close".
  const [same] = subjectDensityWarnings(story([['a', 'punch-in', 2, 4], ['b', 'punch-in', 4, 6]]));
  assert.match(same, /are 0 s apart/);
});

test('layout-check reports the budget as warnings and still passes', async () => {
  // The subject example is a 6 s showcase: three effects in a row.
  const report = await checkLayoutProject(PROJECT);
  const density = report.findings.filter((finding) => finding.rule === 'subject-density');
  assert.ok(density.length >= 2, JSON.stringify(report.findings));
  assert.ok(density.every((finding) => finding.severity === 'warning'));
  assert.ok(density.some((finding) => /of the runtime/.test(finding.detail)));
  assert.equal(report.status, 'passed');
});

test('the planner check carries the warnings without failing', () => {
  const checked = checkStoryboard(story([['a', 'punch-in', 2, 4, {params: {at: 0.5}}], ['b', 'punch-in', 5, 7, {params: {at: 0.5}}]]), {tier: 'guided'});
  assert.ok(checked.warnings.some((warning) => /subject effects a \(punch-in\) and b \(punch-in\) are 1 s apart/.test(warning)), checked.warnings.join('\n'));
  assert.ok(!checked.errors.some((error) => /subject effects/.test(error)));
});

test('story validate lists the warnings and passes', async () => {
  const {mkdtemp, writeFile} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os');
  const {join} = await import('node:path');
  const {runStoryCommand} = await import('../src/story_cli.js');
  const dir = await mkdtemp(join(tmpdir(), 'lc-density-'));
  const file = join(dir, 'storyboard.json');
  await writeFile(file, JSON.stringify(story([['a', 'masthead', 2, 4, {params: {word: 'Focus'}}], ['b', 'dolly-zoom', 4, 6]])));
  const result = await runStoryCommand('validate', file);
  assert.equal(result.status, 'passed', result.errors.join('\n'));
  assert.ok(result.warnings.some((warning) => /run back to back/.test(warning)), result.warnings.join('\n'));
});
