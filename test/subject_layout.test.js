// layout-check's face rule on examples/story/subject: the word behind the
// presenter passes; the same word in front of the face fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkLayoutProject} from '../src/layout_check.js';

const PROJECT = fileURLToPath(new URL('../examples/story/subject', import.meta.url));
const story = () => JSON.parse(readFileSync(join(PROJECT, 'storyboard.json'), 'utf8'));
const faceFindings = (report) => report.findings.filter((finding) => finding.rule === 'subject-face');

test('a word behind the presenter passes the face rule', async () => {
  const report = await checkLayoutProject(PROJECT);
  assert.deepEqual(faceFindings(report), []);
  assert.equal(report.status, 'passed');
});

test('the same word in front of the face fails it', async () => {
  const front = story();
  front.scenes.find((scene) => scene.id === 'word').layer = 'front';
  const report = await checkLayoutProject(PROJECT, {story: front});
  const [finding] = faceFindings(report);
  assert.ok(finding, JSON.stringify(report.findings));
  assert.deepEqual(finding.ids, ['word']);
  assert.equal(finding.severity, 'error');
  assert.match(finding.detail, /covers the presenter's face/);
  assert.equal(report.status, 'failed');
});

test('without the matte info the rule is skipped with a note', async () => {
  const bare = story();
  delete bare.base.subject.mattes[0].info;
  const report = await checkLayoutProject(PROJECT, {story: bare});
  assert.deepEqual(faceFindings(report), []);
  assert.ok(report.warnings.some((warning) => /has no info/.test(warning)), report.warnings.join('\n'));
});
