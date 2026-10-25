// layout-check's subject rules on examples/story/subject. The face rule:
// the word behind the presenter passes, the same word in front of the face
// fails. Behind-text visibility: the example's masthead hides two letters
// behind the head (there is no headroom on that shot), so it fails; the same
// masthead with the presenter lower in frame passes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {cp, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkLayoutProject} from '../src/layout_check.js';

const PROJECT = fileURLToPath(new URL('../examples/story/subject', import.meta.url));
const story = () => JSON.parse(readFileSync(join(PROJECT, 'storyboard.json'), 'utf8'));
const faceFindings = (report) => report.findings.filter((finding) => finding.rule === 'subject-face');
const textFindings = (report) => report.findings.filter((finding) => finding.rule === 'subject-text');

test('a word behind the presenter passes the face rule', async () => {
  const report = await checkLayoutProject(PROJECT);
  assert.deepEqual(faceFindings(report), []);
});

test('a masthead whose letters the head hides fails, with a repair hint', async () => {
  const report = await checkLayoutProject(PROJECT);
  const [finding] = textFindings(report);
  assert.ok(finding, JSON.stringify(report.findings));
  assert.deepEqual(finding.ids, ['word']);
  assert.equal(finding.severity, 'error');
  assert.match(finding.detail, /covers \d+% of "[CU]" in "FOCUS"/);
  assert.match(finding.detail, /need 60% of each glyph visible/);
  assert.match(finding.detail, /Raise or shrink it: set params\.baseline lower/);
  assert.match(finding.detail, /drop the kicker/);
  assert.equal(report.status, 'failed');
});

// A copy of the example whose subject.json puts the presenter `drop` of the
// frame lower (head and body, every frame and the summary).
async function lowered(t, drop) {
  const dir = await mkdtemp(join(tmpdir(), 'launchclip-subject-text-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  await cp(PROJECT, dir, {recursive: true});
  const file = join(dir, 'assets/subject/0.000-6.000.json');
  const info = JSON.parse(await readFile(file, 'utf8'));
  const move = (box) => box && {...box, y: box.y + drop};
  Object.assign(info, {head: move(info.head), body: move(info.body)});
  info.frames = info.frames.map((frame) => ({...frame, head: move(frame.head), body: move(frame.body)}));
  await writeFile(file, JSON.stringify(info));
  return dir;
}

test('the same masthead clears the 60% rule when the shot has headroom', async (t) => {
  // Without the example's punch-in, which pushes the head up into the letters.
  const dir = await lowered(t, 0.12);
  const still = story();
  still.scenes = still.scenes.filter((scene) => scene.id !== 'push');
  const report = await checkLayoutProject(dir, {story: still});
  assert.deepEqual(textFindings(report), [], JSON.stringify(textFindings(report)));
});

test('the rule follows the head through a punch-in', async (t) => {
  // With headroom the masthead passes at rest; a strong punch-in starting
  // before it settles pushes the head up into the letters.
  const dir = await lowered(t, 0.12);
  const pushed = story();
  pushed.scenes = pushed.scenes.filter((scene) => scene.id === 'word');
  pushed.scenes.push({id: 'push', module: 'punch-in', track: 3, start: 0.4, end: 2.9, params: {scale: 1.25, at: 0.2, focus: {x: 0.5, y: 0.8}}});
  const report = await checkLayoutProject(dir, {story: pushed});
  assert.deepEqual(textFindings(report).map((finding) => finding.ids[0]), ['word'], JSON.stringify(report.findings));
});

test('a front masthead is not a behind-layer word', async () => {
  const front = story();
  front.scenes.find((scene) => scene.id === 'word').layer = 'front';
  const report = await checkLayoutProject(PROJECT, {story: front});
  assert.deepEqual(textFindings(report), []);
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

test('a full-frame insert over the face passes the face rule; the same card in front fails', async () => {
  // An insert replaces the whole picture, so no face is on screen to cover.
  const scene = {id: 'card', module: 'concept-card', track: 5, start: 2, end: 4.5, params: {text: 'Ship it', icon: 'rocket', rect: {x: 560, y: 300, width: 800, height: 520}}};
  const inFront = story();
  inFront.scenes = [...inFront.scenes.filter((entry) => entry.id !== 'word'), scene];
  const front = await checkLayoutProject(PROJECT, {story: inFront});
  assert.deepEqual(faceFindings(front).map((finding) => finding.ids[0]), ['card']);
  const asInsert = story();
  asInsert.scenes = [...asInsert.scenes.filter((entry) => entry.id !== 'word'), {...scene, insert: true, track: 0}];
  const insert = await checkLayoutProject(PROJECT, {story: asInsert});
  assert.deepEqual(faceFindings(insert), [], JSON.stringify(faceFindings(insert)));
});
