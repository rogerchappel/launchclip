// Mattes filed in a project (src/subject/project.js): base.subject "auto"
// resolves to them in every story reader.
import test from 'node:test';
import assert from 'node:assert/strict';
import {cp, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fileProjectMatte, MATTES_MANIFEST, readStorySubject} from '../src/subject/project.js';
import {readProjectStory} from '../src/story_loader.js';
import {compileStoryToHyperFrames} from '../kit/hyperframes/story-compiler.mjs';
import {checkLayoutProject} from '../src/layout_check.js';

const EXAMPLE = fileURLToPath(new URL('../examples/story/subject', import.meta.url));

// A copy of examples/story/subject whose storyboard leaves base.subject on auto.
async function autoProject(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'launchclip-subject-project-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  await cp(EXAMPLE, dir, {recursive: true});
  const story = JSON.parse(await readFile(path.join(dir, 'storyboard.json'), 'utf8'));
  delete story.base.subject;
  await writeFile(path.join(dir, 'storyboard.json'), JSON.stringify(story, null, 2));
  const info = JSON.parse(await readFile(path.join(dir, 'assets/subject/0.000-6.000.json'), 'utf8'));
  return {dir, story, result: {info, matte: path.join(dir, 'assets/subject/0.000-6.000.webm')}};
}

test('fileProjectMatte files the matte and readStorySubject finds it for auto', async (t) => {
  const {dir, story, result} = await autoProject(t);
  assert.equal(await readStorySubject(dir, story), null, 'nothing filed yet');
  const entry = await fileProjectMatte(dir, path.join(dir, 'assets/recording.mp4'), result);
  assert.deepEqual(entry, {base: 'assets/recording.mp4', src: 'assets/subject/0.000-6.000.webm', in: 0, out: 6, info: 'assets/subject/0.000-6.000.json'});
  const [found] = await readStorySubject(dir, story);
  const {summary, ...rest} = found;
  assert.deepEqual(rest, {src: entry.src, in: 0, out: 6, info: entry.info});
  assert.equal(summary.framing, 'medium');
  assert.deepEqual(summary.source, {width: 720, height: 1280});
  assert.equal(await readStorySubject(dir, {...story, base: {...story.base, subject: 'off'}}), null);
  assert.equal(await readStorySubject(dir, {...story, base: {...story.base, src: 'assets/other.mp4'}}), null);
  // Explicit mattes get their summaries too.
  const explicit = await readStorySubject(dir, {...story, base: {...story.base, subject: {mattes: [{src: entry.src, in: 0, out: 6, info: entry.info}]}}});
  assert.equal(explicit[0].summary.framing, 'medium');
  // Re-filing an overlapping range replaces the old entry.
  await fileProjectMatte(dir, path.join(dir, 'assets/recording.mp4'), {...result, info: {...result.info, range: {in: 1, out: 4}}});
  const manifest = JSON.parse(await readFile(path.join(dir, MATTES_MANIFEST), 'utf8'));
  assert.deepEqual(manifest.mattes.map((matte) => [matte.in, matte.out]), [[1, 4]]);
});

test('fileProjectMatte files the contours and readStorySubject loads the outline on threes', async (t) => {
  const {dir, story, result} = await autoProject(t);
  const contours = path.join(dir, 'contours.json');
  const frames = Array.from({length: 7}, (_, i) => ({t: i / 30, points: [[0.5, 0.2], null]}));
  await writeFile(contours, JSON.stringify({schema: 'launchclip.subject-contours.v1', range: {in: 0, out: 6}, frames}));
  const entry = await fileProjectMatte(dir, path.join(dir, 'assets/recording.mp4'), {...result, info: {...result.info, contours: 'contours.json'}, contours});
  assert.equal(entry.contours, 'assets/subject/0.000-6.000.contours.json');
  const [found] = await readStorySubject(dir, story);
  assert.deepEqual(found.outline.frames.map((frame) => frame.t), [0, 3 / 30, 6 / 30]);
});

test('fileProjectMatte refuses a video outside the project assets', async (t) => {
  const {dir, result} = await autoProject(t);
  await assert.rejects(fileProjectMatte(dir, '/tmp/elsewhere.mp4', result), /--project needs the video inside/);
});

test('readProjectStory, the compiler and layout-check see filed mattes', async (t) => {
  const {dir, result} = await autoProject(t);
  await fileProjectMatte(dir, path.join(dir, 'assets/recording.mp4'), result);
  const loaded = await readProjectStory(dir);
  assert.equal(loaded.resolved.base.subject.mattes[0].src, 'assets/subject/0.000-6.000.webm');
  const {html} = await compileStoryToHyperFrames(loaded.resolved, {write: false, sourceDir: dir});
  assert.match(html, /<video id="lc-subject-0"/);
  const front = JSON.parse(await readFile(path.join(dir, 'storyboard.json'), 'utf8'));
  front.scenes.find((scene) => scene.id === 'word').layer = 'front';
  const report = await checkLayoutProject(dir, {story: front});
  assert.ok(report.findings.some((finding) => finding.rule === 'subject-face'), 'the face rule reads the filed subject.json');
});
