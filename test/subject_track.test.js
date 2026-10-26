// The whole-video head track (docs/VIDEO_QUALITY_RFC.md §7.2): filed as
// assets/subject/track.json, it gives subjectContext, footage placement and
// layout-check's face rule the presenter's head outside every matted range.
// The track here is the synthetic presenter's exact per-frame boxes from
// examples/story/subject, sampled at 10 fps.
import test from 'node:test';
import assert from 'node:assert/strict';
import {cp, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {TRACK_SCHEMA, summarizeSamples, validateSubjectTrack} from '../kit/core/subject.mjs';
import {resolveStory} from '../kit/core/story.mjs';
import {resolveModule} from '../kit/core/modules.mjs';
import {subjectContext, subjectLocator} from '../kit/core/subject-layer.mjs';
import {fileProjectTrack, readStoryTrack, TRACK_FILE} from '../src/subject/project.js';
import {checkLayoutProject} from '../src/layout_check.js';
import {readProjectStory} from '../src/story_loader.js';

const EXAMPLE = fileURLToPath(new URL('../examples/story/subject', import.meta.url));
const INFO = JSON.parse(readFileSync(join(EXAMPLE, 'assets/subject/0.000-6.000.json'), 'utf8'));
const rows = [{label: 'Drop in your clip', status: 'active', at: 0.3, doneAt: 0.9}, {label: 'Ship the video', status: 'active', at: 1.0, doneAt: 1.6}];

// The example's frames at 10 fps as a launchclip.subject-track.v1 file.
function exampleTrack() {
  const frames = INFO.frames.filter((_, index) => index % 3 === 0).map((frame, index) => ({...frame, t: Math.round(index * 100) / 1000}));
  return {schema: TRACK_SCHEMA, source: INFO.source, model: 'synthetic', fps: 10, ...summarizeSamples(frames), frames};
}

// A copy of the example with no matte at all (base.subject: {mattes: []})
// and a front checklist drawn over the presenter's head from 3 s.
async function unmatted(t, {track = true} = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'launchclip-subject-track-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  await cp(EXAMPLE, dir, {recursive: true});
  const story = JSON.parse(await readFile(join(dir, 'storyboard.json'), 'utf8'));
  story.base.subject = {mattes: []};
  story.scenes = [{id: 'card', module: 'checklist', track: 1, start: 3, end: 5.5, params: {title: 'All you need to do', rows, rect: {x: 240, y: 360, width: 600, height: 480}}}];
  await writeFile(join(dir, 'storyboard.json'), JSON.stringify(story, null, 2));
  if (track) await fileProjectTrack(dir, join(dir, 'assets/recording.mp4'), exampleTrack());
  return {dir, story};
}

test('the example track is a valid track file', () => {
  assert.deepEqual(validateSubjectTrack(exampleTrack()).errors, []);
  assert.equal(exampleTrack().frames.length, 60);
});

test('layout-check fails an overlay on the head outside any matted range', async (t) => {
  const {dir} = await unmatted(t);
  const report = await checkLayoutProject(dir);
  const face = report.findings.filter((finding) => finding.rule === 'subject-face');
  assert.deepEqual(face.map((finding) => finding.ids[0]), ['card'], JSON.stringify(report.findings));
  assert.equal(face[0].severity, 'error');
  assert.equal(face[0].at, 3);
  assert.equal(report.status, 'failed');
});

test('an overlay on top of a full-frame insert does not cover the face', async (t) => {
  const {dir, story} = await unmatted(t);
  story.scenes.push({id: 'cover', module: 'concept-card', insert: true, track: 0, start: 2.5, end: 6, params: {text: 'Insert'}});
  await writeFile(join(dir, 'storyboard.json'), JSON.stringify(story, null, 2));
  const report = await checkLayoutProject(dir);
  assert.deepEqual(report.findings.filter((finding) => finding.rule === 'subject-face'), [], JSON.stringify(report.findings));
});

test('without the track the same overlay is not seen', async (t) => {
  const {dir} = await unmatted(t, {track: false});
  const report = await checkLayoutProject(dir);
  assert.deepEqual(report.findings.filter((finding) => finding.rule === 'subject-face'), []);
});

test('readStoryTrack loads the filed track for its base only', async (t) => {
  const {dir, story} = await unmatted(t);
  const track = await readStoryTrack(dir, story);
  assert.equal(track.fps, 10);
  assert.equal(track.frames.length, 60);
  assert.deepEqual(Object.keys(track.frames[0]), ['t', 'head', 'body']);
  assert.equal(await readStoryTrack(dir, {...story, base: {...story.base, src: 'assets/other.mp4'}}), null);
  assert.equal(await readStoryTrack(dir, {...story, base: {...story.base, subject: 'off'}}), null);
  const filed = JSON.parse(await readFile(join(dir, TRACK_FILE), 'utf8'));
  assert.equal(filed.base, 'assets/recording.mp4');
  const loaded = await readProjectStory(dir);
  assert.equal(loaded.resolved.resolved.subjectTrack.frames.length, 60, 'every story reader passes the track');
});

test('fileProjectTrack refuses a video outside the project assets', async (t) => {
  const {dir} = await unmatted(t, {track: false});
  await assert.rejects(fileProjectTrack(dir, '/tmp/elsewhere.mp4', exampleTrack()), /inside .*assets/);
});

// A footage-led story on the example recording with the track and no matte.
function trackedStory(scenes, {track = exampleTrack()} = {}) {
  return resolveStory({schema: 'launchclip.story.v1', lane: 'footage-led', format: {width: 1080, height: 1920, fps: 30, duration: 6},
    brand: {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}},
    base: {src: 'assets/recording.mp4'}, scenes}, {track: track && {source: track.source, fps: track.fps, frames: track.frames.map(({t, head, body}) => ({t, head, body}))}});
}

test('subjectContext reads the track where no matte covers t', () => {
  const story = trackedStory([]);
  const context = subjectContext(story, 1, {end: 4});
  assert.equal(context.available, false, 'no matte, so no subject layer');
  assert.equal(context.source, 'track');
  assert.equal(context.placement, 'measured');
  assert.equal(context.framing, INFO.framing);
  // The extent over the window holds the head at every sampled frame but the outliers.
  const locate = subjectLocator(story, []);
  let inside = 0, total = 0;
  for (let at = 1; at < 4; at += 0.1) {
    const head = locate(at).head;
    total += 1;
    if (head.x >= context.head.x - 1 && head.x + head.width <= context.head.x + context.head.width + 1) inside += 1;
  }
  assert.ok(inside / total >= 0.8, `${inside}/${total} heads inside the extent`);
  assert.equal(subjectContext(trackedStory([], {track: null}), 1).head, null, 'no track, no head');
});

test('a footage checklist is placed clear of a tracked head', () => {
  const story = trackedStory([{id: 'steps', module: 'checklist', track: 1, start: 1, end: 4, params: {title: 'All you need to do', rows}}]);
  const model = resolveModule(story.scenes[0], story);
  assert.equal(model.subjectPlacement, 'chest');
  const head = subjectContext(story, 1, {end: 4}).head;
  assert.ok(model.rect.y >= head.y + head.height, `card top ${model.rect.y} below the head ${head.y + head.height}`);
});
