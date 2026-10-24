// Subject layer core (kit/core/subject-layer.mjs): layers, windows, matte
// segments on a trimmed base, the merged subject camera, room state, the
// head on the canvas and the face rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveStory} from '../kit/core/story.mjs';
import {
  checkSubjectFace, headLocator, needsSubject, roomChanges, roomStateAt, sceneLayerOf, sourceBoxToCanvas, sourceTimeAt,
  subjectCameraAt, subjectCameraOps, subjectModelErrors, subjectSegments, subjectWindows
} from '../kit/core/subject-layer.mjs';
import {storyBase} from '../kit/core/story.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};

function story(base) {
  return resolveStory({schema: 'launchclip.story.v1', lane: 'footage-led', format: {width: 1080, height: 1920, fps: 30, duration: 12}, brand, base,
    scenes: [{id: 'w', module: 'emphasis-caption', track: 1, layer: 'behind', start: 1, end: 3, params: {text: 'FOCUS'}}]});
}

test('sceneLayerOf: scene wins, model default, split needs parts', () => {
  assert.deepEqual(sceneLayerOf({}, {}), {layer: 'front'});
  assert.deepEqual(sceneLayerOf({}, {layer: 'behind'}), {layer: 'behind'});
  assert.deepEqual(sceneLayerOf({layer: 'front'}, {layer: 'behind'}), {layer: 'front'});
  assert.deepEqual(sceneLayerOf({layer: 'split'}, {parts: {behind: {}, front: {}}}), {layer: 'split'});
  const fallback = sceneLayerOf({layer: 'split', module: 'cta'}, {});
  assert.equal(fallback.layer, 'front');
  assert.match(fallback.reason, /draws no split parts/);
  assert.equal(needsSubject({}, {room: {hide: true}}), true);
  assert.equal(needsSubject({}, {subjectCamera: {samples: []}}), true);
  assert.equal(needsSubject({}, {}), false);
});

test('subjectWindows merges the windows of scenes that need the subject', () => {
  const entries = [
    {scene: {layer: 'behind'}, model: {}, start: 1, end: 3},
    {scene: {}, model: {}, start: 2, end: 9},
    {scene: {layer: 'behind'}, model: {}, start: 2.5, end: 4},
    {scene: {}, model: {room: {dim: 0.5}}, start: 6, end: 7}
  ];
  assert.deepEqual(subjectWindows(entries), [[1, 4], [6, 7]]);
});

test('subjectSegments maps mattes through a trimmed base onto the timeline', () => {
  // Base: source 0–5 then 10–17 → timeline 0–5 and 5–12.
  const resolved = story({src: 'assets/recording.mp4', trim: [[0, 5], [10, 17]],
    subject: {mattes: [{src: 'assets/subject/a.webm', in: 2, out: 4}, {src: 'assets/subject/b.webm', in: 11, out: 13}]}});
  const segments = subjectSegments(resolved, [[0, 12]]);
  assert.deepEqual(segments.map(({src, start, end, mediaStart}) => ({src, start, end, mediaStart})), [
    {src: 'assets/subject/a.webm', start: 2, end: 4, mediaStart: 0},
    {src: 'assets/subject/b.webm', start: 6, end: 8, mediaStart: 0}
  ]);
  // Only inside the windows; the matte offset follows.
  const clipped = subjectSegments(resolved, [[3, 7]]);
  assert.deepEqual(clipped.map(({start, end, mediaStart}) => [start, end, mediaStart]), [[3, 4, 1], [6, 7, 0]]);
  assert.deepEqual(subjectSegments(story({src: 'assets/recording.mp4'}), [[0, 12]]), [], 'auto without mattes mounts nothing');
});

test('subjectCameraOps follows base cameras and lets a subject camera take over', () => {
  const punch = {start: 1, end: 2, camera: {samples: [{t: 1, scale: 1.2, x: 10, y: 0}, {t: 2, scale: 1, x: 0, y: 0}]}};
  const dolly = {start: 1.5, end: 3, subjectCamera: {samples: [{t: 1.5, scale: 1, x: 0, y: 0}, {t: 2.9, scale: 1, x: 0, y: 0}]}};
  assert.deepEqual(subjectCameraOps([]), []);
  const followOnly = subjectCameraOps([punch]);
  assert.equal(subjectCameraAt(followOnly, 1.01).scaleX, 1.2);
  const both = subjectCameraOps([punch, dolly]);
  // Before the dolly the subject follows the punch-in; during it, the dolly's own samples.
  assert.equal(subjectCameraAt(both, 1.2).scaleX, 1.2);
  assert.equal(subjectCameraAt(both, 2.5).scaleX, 1);
  assert.equal(both.filter((op) => op.props.scaleX === 1 && op.time === Math.max(0, 2 - 0.0005)).length, 0, 'the base sample inside the dolly window is dropped');
  assert.deepEqual(subjectCameraAt([], 1), {x: 0, y: 0, scaleX: 1, scaleY: 1});
});

test('room state: hide, dim and blur over the window, later room wins', () => {
  const dim = {start: 1, end: 4, room: {dim: 0.4, blur: 6}};
  const hide = {start: 2, end: 3, room: {hide: true}};
  assert.deepEqual(roomStateAt([dim, hide], 0.5), {opacity: 1, filter: 'none'});
  assert.deepEqual(roomStateAt([dim, hide], 1.5), {opacity: 1, filter: 'brightness(0.6) blur(6px)'});
  assert.deepEqual(roomStateAt([dim, hide], 2.5), {opacity: 0, filter: 'none'});
  assert.deepEqual(roomChanges([dim, hide]).map((change) => [change.time, change.state.opacity, change.state.filter]), [
    [1, 1, 'brightness(0.6) blur(6px)'], [2, 0, 'none'], [3, 1, 'brightness(0.6) blur(6px)'], [4, 1, 'none']
  ]);
  assert.deepEqual(roomChanges([{start: 0, end: 1}]), []);
});

test('subjectModelErrors checks the model fields', () => {
  assert.deepEqual(subjectModelErrors({}), []);
  assert.deepEqual(subjectModelErrors({room: {hide: true, dim: 0.2}, subjectCamera: {samples: [{t: 0, scale: 1, x: 0, y: 0}]}, parts: {behind: {}, front: {}}}), []);
  const errors = subjectModelErrors({room: {fade: 1}, subjectCamera: {samples: [{t: 0}]}, parts: {behind: {}}}).join('\n');
  assert.match(errors, /room must be/);
  assert.match(errors, /subjectCamera\.samples/);
  assert.match(errors, /parts must be/);
  assert.match(subjectModelErrors({room: {dim: 2}}).join(), /room\.dim/);
});

test('sourceBoxToCanvas follows cover and contain with the focus', () => {
  const box = {x: 0.5, y: 0.25, w: 0.2, h: 0.3};
  // A 1920×1080 source covering a 1080×1920 canvas: scale 1920/1080, centred.
  const cover = sourceBoxToCanvas(box, {fit: 'cover', focus: {x: 0.5, y: 0.5}}, {width: 1920, height: 1080}, {width: 1080, height: 1920});
  const width = 1920 * (1920 / 1080);
  assert.ok(Math.abs(cover.width - 0.2 * width) < 1e-3);
  assert.ok(Math.abs(cover.x - ((1080 - width) / 2 + 0.4 * width)) < 1e-3);
  assert.equal(cover.y, 0.1 * 1920);
  const contain = sourceBoxToCanvas(box, {fit: 'contain', focus: {x: 0.5, y: 0.5}}, {width: 1920, height: 1080}, {width: 1080, height: 1920});
  assert.ok(Math.abs(contain.width - 0.2 * 1080) < 1e-3);
});

test('headLocator maps timeline time through trims and the matte frames', () => {
  const resolved = story({src: 'assets/recording.mp4', trim: [[0, 5], [10, 17]], subject: {mattes: [{src: 'assets/subject/b.webm', in: 10, out: 12}]}});
  assert.equal(sourceTimeAt(storyBase(resolved), 6), 11);
  const info = {source: {width: 1080, height: 1920}, range: {in: 10, out: 12}, frames: [{t: 10, head: {x: 0.5, y: 0.2, w: 0.2, h: 0.1}}, {t: 11, head: {x: 0.6, y: 0.2, w: 0.2, h: 0.1}}]};
  const headAt = headLocator(resolved, [info]);
  assert.deepEqual(headAt(6), {x: 540, y: 288, width: 216, height: 192});
  assert.equal(headAt(1), null, 'no matte covers source 1 s');
});

test('checkSubjectFace flags front elements over the face for more than 0.3 s', () => {
  const head = {x: 400, y: 300, width: 280, height: 360};
  const headAt = (t) => (t < 5 ? head : null);
  const elements = [
    {id: 'card', rect: {x: 300, y: 250, width: 500, height: 300}, start: 1, end: 2},
    {id: 'brief', rect: {x: 300, y: 250, width: 500, height: 300}, start: 1, end: 1.2},
    {id: 'word', rect: {x: 300, y: 250, width: 500, height: 300}, start: 1, end: 3, layer: 'behind'},
    {id: 'frame', rect: {x: 300, y: 250, width: 500, height: 300}, start: 1, end: 3, framesFace: true},
    {id: 'low', rect: {x: 0, y: 1400, width: 1080, height: 300}, start: 0, end: 4}
  ];
  const findings = checkSubjectFace({elements, headAt});
  assert.deepEqual(findings.map((finding) => finding.ids[0]), ['card']);
  assert.equal(findings[0].rule, 'subject-face');
  assert.match(findings[0].detail, /covers the presenter's face for 1 s from 1 s/);
});
