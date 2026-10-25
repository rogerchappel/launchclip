// Subject layer core (kit/core/subject-layer.mjs): layers, windows, matte
// segments on a trimmed base, the merged subject camera, room state, the
// head on the canvas and the face rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveStory} from '../kit/core/story.mjs';
import {
  checkBehindText, checkSubjectFace, headLocator, subjectCoverShare, subjectLocator, needsSubject, roomChanges, roomStateAt, sceneLayerOf, sourceBoxToCanvas, sourceTimeAt,
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
  const withBody = {...info, frames: info.frames.map((frame) => ({...frame, body: {x: 0.5, y: 0.6, w: 0.5, h: 0.8}}))};
  assert.deepEqual(subjectLocator(resolved, [withBody])(6), {head: {x: 540, y: 288, width: 216, height: 192}, body: {x: 270, y: 384, width: 540, height: 1536}});
  assert.equal(subjectLocator(resolved, [withBody])(1), null);
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

test('subjectContext reports the presenter at a time, from the covering matte', async () => {
  const {subjectContext} = await import('../kit/core/subject-layer.mjs');
  const summary = {source: {width: 1080, height: 1920}, framing: 'medium', head: {x: 0.5, y: 0.25, w: 0.2, h: 0.1}, body: {x: 0.5, y: 0.65, w: 0.6, h: 0.7}, headroom: 0.2};
  const resolved = story({src: 'assets/recording.mp4', subject: {mattes: [{src: 'assets/subject/a.webm', in: 0, out: 4, plate: 'assets/subject/a.plate.jpg', summary}]}});
  const at = subjectContext(resolved, 1);
  assert.equal(at.available, true);
  assert.equal(at.framing, 'medium');
  assert.equal(at.placement, 'measured');
  assert.deepEqual(at.head, {x: 432, y: 384, width: 216, height: 192});
  assert.deepEqual(at.plate, {src: 'assets/subject/a.plate.jpg', fit: 'cover', focus: {x: 0.5, y: 0.5}});
  const later = subjectContext(resolved, 6);
  assert.equal(later.available, false);
  assert.equal(later.placement, 'default');
  assert.equal(subjectContext(story({src: 'assets/recording.mp4', subject: 'off'}), 1), null);
  assert.equal(at.outlineAt(1), null, 'no outline filed');
});

test('subjectOutlineAt maps the nearest traced frame onto the canvas', async () => {
  const {subjectOutlineAt} = await import('../kit/core/subject-layer.mjs');
  const summary = {source: {width: 1080, height: 1920}, framing: 'medium', head: {x: 0.5, y: 0.25, w: 0.2, h: 0.1}};
  const outline = {frames: [{t: 0, points: [[0.5, 0.1], null]}, {t: 0.1, points: [[0.6, 0.2], [0, 1]]}]};
  const resolved = story({src: 'assets/recording.mp4', subject: {mattes: [{src: 'assets/subject/a.webm', in: 0, out: 4, summary, outline}]}});
  assert.deepEqual(subjectOutlineAt(resolved, 0.02), [[540, 192], null]);
  assert.deepEqual(subjectOutlineAt(resolved, 0.09), [[648, 384], [0, 1920]]);
  assert.equal(subjectOutlineAt(resolved, 6), null, 'outside the matte');
});

test('subjectStyle: a sticker outline and shadow on the cut-out for the scene window', async () => {
  const {subjectFilterAt, subjectFilterChanges, subjectCameraOps, subjectCameraAt, needsSubject: needs} = await import('../kit/core/subject-layer.mjs');
  const sticker = {start: 1, end: 3, subjectStyle: {outline: 10, color: '#ffffff', shadow: true}};
  assert.equal(subjectFilterAt([sticker], 0.5), 'none');
  const filter = subjectFilterAt([sticker], 2);
  assert.equal((filter.match(/drop-shadow\([^)]*#ffffff\)/g) ?? []).length, 8, 'eight offsets make the outline');
  assert.match(filter, /rgba\(0, 0, 0, 0\.45\)\)$/);
  assert.deepEqual(subjectFilterChanges([sticker]).map((change) => [change.time, change.filter === 'none']), [[1, false], [3, true]]);
  assert.equal(needs({}, sticker), true);
  // A blurred camera sample carries the style with it.
  const punch = {start: 1, end: 2, camera: {samples: [{t: 1.5, scale: 1.1, x: 0, y: 0, blur: 4}]}};
  const ops = subjectCameraOps([punch, sticker], {subjectFilterAt: (t) => subjectFilterAt([sticker], t)});
  assert.match(subjectCameraAt(ops, 1.6).filter, /^drop-shadow.* blur\(4px\)$/);
  assert.match(subjectModelErrors({subjectStyle: {outline: 40}}).join(), /outline must be between 0 and 24/);
  assert.match(subjectModelErrors({subjectStyle: {color: 'white'}}).join(), /#rrggbb/);
});

test('subjectCoverShare: the head is an ellipse, the body counts only below the chin', () => {
  const head = {x: 100, y: 100, width: 100, height: 100};
  const body = {x: 0, y: 100, width: 300, height: 400};
  assert.equal(subjectCoverShare({x: 400, y: 0, width: 50, height: 50}, {head, body}), 0);
  // The head box's corner is outside the ellipse.
  assert.equal(subjectCoverShare({x: 100, y: 100, width: 12, height: 12}, {head}), 0);
  const inscribed = subjectCoverShare(head, {head});
  assert.ok(Math.abs(inscribed - Math.PI / 4) < 0.03, `${inscribed}`);
  // Beside the head, above the chin: the body box does not count.
  assert.equal(subjectCoverShare({x: 10, y: 120, width: 40, height: 40}, {head, body}), 0);
  assert.equal(subjectCoverShare({x: 10, y: 220, width: 40, height: 40}, {head, body}), 1);
  assert.equal(subjectCoverShare({x: 0, y: 0, width: 10, height: 10}, {}), 0);
});

test('checkBehindText: the worst glyph under 60% visible, once per element', () => {
  const head = {x: 100, y: 100, width: 100, height: 100};
  const glyph = (index, x, y) => ({index, char: 'AB'[index], x, y, width: 40, height: 40});
  const texts = [
    {id: 'clear', module: 'masthead', glyphs: [glyph(0, 300, 0), glyph(1, 340, 0)], times: [1]},
    {id: 'hidden', module: 'masthead', glyphs: [glyph(0, 0, 0), glyph(1, 130, 130)], times: [1, 2], hint: 'Raise it.'}
  ];
  const findings = checkBehindText({texts, subjectAt: (t) => (t === 2 ? {head, body: null} : {head: {...head, y: 300}, body: null})});
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].ids, ['hidden']);
  assert.equal(findings[0].at, 2);
  assert.match(findings[0].detail, /covers 100% of "B" in "AB" at 2 s; behind-layer letters need 60% of each glyph visible\. Raise it\./);
  assert.deepEqual(checkBehindText({texts, subjectAt: () => null}), [], 'no matte, no finding');
});

test('base.crop: validated, normalised to fractions, drawn in one box that the face track maps through', async () => {
  const {validateStory, baseMediaBox, baseMediaStyle} = await import('../kit/core/story.mjs');
  const story = (base) => ({schema: 'launchclip.story.v1', lane: 'footage-led', format: {width: 1920, height: 1080, fps: 30, duration: 4}, brand: {colors: {bg: '#000000', primary: '#ffffff'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}}, base: {src: 'assets/raw.mp4', ...base}, scenes: [{id: 'lt', module: 'lower-third', track: 1, start: 0, end: 2, params: {name: 'Ada'}}]});
  const errors = (base) => validateStory(story(base)).errors.join('\n');
  assert.equal(errors({crop: {right: 80}, size: {width: 1360, height: 720}}), '');
  assert.equal(errors({crop: {right: 0.06}}), '');
  assert.match(errors({crop: {middle: 0.1}}), /base\.crop\.middle is not supported/);
  assert.match(errors({crop: {right: 80.5}}), /whole number/);
  assert.match(errors({crop: {left: 0.3, right: 0.3}}), /more than half the recording's width/);
  assert.match(validateStory({...story({crop: {right: 80}}), resolved: {duration: 4, fps: 30}}).errors.join('\n'), /size is unknown/);
  // Pixels become fractions with the size: base.size, else the track's source size (resolveStory fills base.size).
  const cropped = storyBase(story({crop: {right: 80}, size: {width: 1360, height: 720}}));
  assert.deepEqual(cropped.crop, {left: 0, right: 80 / 1360, top: 0, bottom: 0});
  const tracked = resolveStory(story({crop: {right: 80}}), {track: {source: {width: 1360, height: 720}, fps: 10, frames: [{t: 0, head: {x: 0.47, y: 0.3, w: 0.1, h: 0.2}}]}});
  assert.deepEqual(tracked.base.size, {width: 1360, height: 720});
  assert.equal(storyBase(story({crop: {right: 80}})).crop, null, 'pixels without a size draw uncropped');
  // The crop rect (1280x720) covers the 1920x1080 canvas: the whole recording is 2040 px wide, the bar falls off the right.
  const canvas = {width: 1920, height: 1080};
  assert.deepEqual(baseMediaBox(cropped, canvas), {x: 0, y: 0, width: 2040, height: 1080, clip: {top: 0, right: 120, bottom: 0, left: 0}, origin: {x: 960, y: 540}});
  assert.equal(baseMediaStyle(cropped, canvas).clipPath, 'inset(0px 120px 0px 0px)');
  assert.deepEqual(baseMediaStyle(storyBase(story({})), canvas), {left: 0, top: 0, width: 1920, height: 1080, objectFit: 'cover', objectPosition: '50% 50%', transformOrigin: '50% 50%'});
  // A head at x 0.47 of the 1360-px recording lands where the cropped recording puts it.
  const head = sourceBoxToCanvas({x: 0.47, y: 0.3, w: 0.1, h: 0.2}, cropped, {width: 1360, height: 720}, canvas);
  assert.equal(Math.round(head.x + head.width / 2), Math.round(0.47 * 2040));
});

test('base.crop: both compilers draw the base and the mattes in the crop box', async () => {
  const {readFileSync} = await import('node:fs');
  const {compileStoryToHyperFrames} = await import('../kit/hyperframes/story-compiler.mjs');
  const {readProjectStory} = await import('../src/story_loader.js');
  const dir = new URL('../examples/story/layouts-wide/', import.meta.url).pathname;
  const {resolved} = await readProjectStory(dir);
  const cropped = {...resolved, base: {...resolved.base, crop: {left: 0.08, right: 0.04, top: 0.05}}};
  const {html} = await compileStoryToHyperFrames(cropped, {write: false, sourceDir: dir});
  const media = [...html.matchAll(/<video id="lc-(?:base|subject)-\d+"[^>]*style="([^"]*)"/g)].map((match) => match[1]);
  assert.ok(media.length >= 2);
  for (const style of media) assert.match(style, /clip-path:inset\(.*px\);transform-origin:\d+(\.\d+)?px \d+(\.\d+)?px/);
  assert.equal(new Set(media.map((style) => style.replace(/;z-index:\d+$/, ''))).size, 1, 'base and mattes share one box');
  const source = readFileSync(new URL('../kit/remotion/StoryComposition.tsx', import.meta.url), 'utf8');
  assert.equal((source.match(/baseMediaStyle\(base, \{ width, height \}\)/g) ?? []).length, 2, 'Remotion BaseLayer and SubjectLayer');
});
