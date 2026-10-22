// Catalogue D product-demo (kit/core/catalog-d.mjs): action-log-driven zoom
// math, the action log → params converter, the resolved model, the emitter's
// hoisted overlay, and story validation.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {PRODUCT_DEMO_TIMING, cameraAt, cameraKeys, cameraTransform, mapBox, productDemoParams, productDemoTimeline, productDemoView, throughCamera, zoomScale} from '../kit/core/catalog-d.mjs';
import {knownModules, moduleTiming, resolveModule} from '../kit/core/modules.mjs';
import {resolveStory, validateStory} from '../kit/core/story.mjs';
import {emitProductDemo} from '../kit/hyperframes/catalog-d.mjs';
import {compileStoryToHyperFrames} from '../kit/hyperframes/story-compiler.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const canvas = {width: 1920, height: 1080};
const centre = {x: 960, y: 540};
const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;

test('mapBox and zoomScale: viewport boxes map into the video rect and zoom to half the canvas', () => {
  const rect = {x: 96, y: 54, width: 1728, height: 972};
  assert.deepEqual(mapBox({x: 0, y: 0, width: 1920, height: 1080}, rect, canvas), rect);
  assert.deepEqual(mapBox({x: 960, y: 540, width: 200, height: 100}, rect, canvas), {x: 960, y: 540, width: 180, height: 90});
  assert.equal(zoomScale({width: 180, height: 90}, canvas), 1.8, 'a button hits the max');
  assert.equal(zoomScale({width: 180, height: 90}, canvas, {max: 2.5}), 2.5);
  assert.equal(zoomScale({width: 1200, height: 400}, canvas), 1, 'a wide panel stays at 1');
  assert.equal(zoomScale({width: 640, height: 200}, canvas), 1.5);
});

test('cameraTransform centres the focus and clamps at the video edges', () => {
  const full = {x: 0, y: 0, width: 1920, height: 1080};
  // Identity at s = 1 whatever the focus.
  assert.deepEqual(cameraTransform({s: 1, f: {x: 100, y: 100}}, full, canvas), {scale: 1, x: 0, y: 0});
  // Centre focus: scale about the centre.
  assert.deepEqual(cameraTransform({s: 2, f: centre}, full, canvas), {scale: 2, x: -960, y: -540});
  // A corner focus clamps so the video still covers the canvas.
  const corner = cameraTransform({s: 2, f: {x: 40, y: 30}}, full, canvas);
  assert.deepEqual(corner, {scale: 2, x: 0, y: 0});
  assert.deepEqual(throughCamera({x: 40, y: 30}, corner), {x: 80, y: 60});
  // A windowed video smaller than the canvas after scaling stays fully on screen.
  const small = {x: 560, y: 315, width: 800, height: 450};
  const t = cameraTransform({s: 1.5, f: {x: 600, y: 330}}, small, canvas);
  const tl = throughCamera({x: small.x, y: small.y}, t), br = throughCamera({x: small.x + small.width, y: small.y + small.height}, t);
  assert.ok(tl.x >= -1e-6 && tl.y >= -1e-6 && br.x <= 1920 + 1e-6 && br.y <= 1080 + 1e-6, JSON.stringify({tl, br}));
});

test('cameraKeys: lead, hold, pan within a shot, zoom out, and a separate shot after a long gap', () => {
  const targets = [
    {at: 2, s: 1.8, f: {x: 900, y: 500}},
    {at: 3.5, s: 1.6, f: {x: 1100, y: 600}},
    {at: 9, until: 9.8, s: 1.8, f: {x: 700, y: 400}}
  ];
  const keys = cameraKeys(targets, {start: 0, end: 12, centre});
  const T = PRODUCT_DEMO_TIMING;
  assert.deepEqual(keys.map(k => [k.t, Math.round(k.s * 100) / 100]), [
    [0, 1], [2 - T.zoomLead, 1], [2, 1.8],
    [3.5 - T.pan, 1.8], [3.5, 1.6],
    [3.5 + T.hold, 1.6], [3.5 + T.hold + T.zoomOut, 1],
    [9 - T.zoomLead, 1], [9, 1.8],
    [9.8 + 0.4, 1.8], [9.8 + 0.4 + T.zoomOut, 1]
  ].map(([t, s]) => [Math.round(t * 1e4) / 1e4, s]));
  // The zoom lands on the action (the lead is shorter than a full zoom-in).
  assert.ok(T.zoomLead <= T.zoomIn);
  // Eased in log space: halfway through the zoom in, the scale is the geometric mean.
  const mid = cameraAt(keys, 2 - T.zoomLead / 2);
  assert.ok(near(mid.s, Math.sqrt(1.8), 1e-6));
  assert.deepEqual(cameraAt(keys, 12), {s: 1, f: centre});
  // A zoom that cannot land before the scene ends is skipped.
  assert.equal(cameraKeys([{at: 11.9, s: 1.8, f: centre}], {start: 0, end: 12, centre}).length, 1);
  // A shot near the end zooms out by the end.
  const late = cameraKeys([{at: 10.5, s: 1.8, f: centre}], {start: 0, end: 12, centre});
  assert.equal(late.at(-1).t, 12);
});

const fixture = async () => JSON.parse(await readFile(path.join(ROOT, 'test/fixtures/parity/d-product-demo.json'), 'utf8'));

test('productDemoParams turns an action log into scene-relative params', async () => {
  const record = JSON.parse(await readFile(path.join(ROOT, 'test/fixtures/demo-sign-in.actions.json'), 'utf8'));
  const params = productDemoParams(record, {sourceStart: 1, duration: 10});
  assert.equal(params.media.src, 'assets/demo/sign-in.mp4');
  assert.deepEqual(params.viewport, {width: 1920, height: 1080});
  assert.deepEqual(params.actions.map(a => a.type), ['type', 'type', 'click']);
  const click = record.actions.find(a => a.type === 'click');
  assert.equal(params.actions[2].at, Math.round((click.at - 1) * 1000) / 1000);
  assert.deepEqual(params.actions[2].box, click.box);
  assert.equal(params.actions[0].keys.length, record.actions[1].keys.length);
  assert.deepEqual(params.callouts.map(c => c.text), ['Straight in']);
  assert.ok(!JSON.stringify(record).includes('demo-pass-123'), 'the password never reaches the action log');
});

test('the product-demo model: rect, camera samples, events and the shared view', async () => {
  const {story} = await fixture();
  const resolved = resolveStory(story);
  assert.deepEqual(validateStory(story, {modules: knownModules()}).errors, []);
  const model = resolveModule(resolved.scenes[0], resolved);
  assert.deepEqual(model.content.rect, {x: 96, y: 54, width: 1728, height: 972});
  assert.equal(model.content.samples.length, Math.round(10 * 30) + 1);
  assert.ok(model.content.samples.some(s => s.scale >= 1.79));
  assert.deepEqual(model.content.samples.at(-1), {t: 10.5, scale: 1, x: 0, y: 0});
  const cues = model.events.reduce((acc, e) => ({...acc, [e.cue]: (acc[e.cue] ?? 0) + 1}), {});
  assert.equal(cues.click, 1);
  assert.equal(cues['keystroke-soft'], 33);
  assert.equal(cues.pop, 1);
  assert.ok(cues['whoosh-soft'] >= 1);
  const view = productDemoView(model);
  assert.equal(view.media.tag, 'video');
  assert.equal(view.overlay.children[0].id, 'demo-cam');
  const ops = productDemoTimeline(model);
  const camOps = ops.filter(op => op.target === 'demo-cam');
  assert.deepEqual(camOps.map(op => op.props), ops.filter(op => op.target === 'demo-media' && op.type === 'set' && op.props.scaleX !== undefined).map(op => op.props), 'video and overlay share the camera');
  assert.deepEqual(moduleTiming('product-demo').minDuration, PRODUCT_DEMO_TIMING.minDuration);
});

test('product-demo rejects remote media, unordered actions and a full frame of the wrong aspect', async () => {
  const {story} = await fixture();
  const scene = story.scenes[0];
  const attempt = params => () => resolveModule({...scene, params: {...scene.params, ...params}}, resolveStory(story));
  assert.throws(attempt({media: {src: 'https://example.com/x.mp4'}}), /project-local assets\/ video/);
  assert.throws(attempt({actions: [scene.params.actions[2], scene.params.actions[0]]}), /must not be earlier than the previous action/);
  assert.throws(attempt({frame: 'full', viewport: {width: 1280, height: 1024}}), /"full" needs a recording with the canvas aspect/);
  assert.doesNotThrow(attempt({zoom: false}));
  // Cut short mid-typing: keystrokes past the scene end are dropped.
  const typing = {...scene.params.actions[0], keys: [...scene.params.actions[0].keys, 50], until: 50};
  const cut = resolveModule({...scene, params: {...scene.params, actions: [typing]}}, resolveStory(story));
  assert.equal(cut.events.filter(e => e.cue === 'keystroke-soft').length, scene.params.actions[0].keys.length);
  const flat = resolveModule({...scene, params: {...scene.params, zoom: false}}, resolveStory(story));
  assert.ok(flat.content.samples.every(s => s.scale === 1));
});

test('HyperFrames: the video and the overlay are hoisted to the root, overlay above', async () => {
  const {story} = await fixture();
  const resolved = resolveStory(story);
  const out = emitProductDemo(resolveModule(resolved.scenes[0], resolved, {track: 2}));
  assert.match(out.html, /^<video id="demo-media"[^>]*data-media-start="1"/);
  assert.match(out.overlay, /^<div id="demo-overlay"[^>]*data-track-index="3"/);
  const {html} = await compileStoryToHyperFrames(resolved, {write: false, sourceDir: path.join(ROOT, 'test/fixtures/parity')});
  const video = html.indexOf('<video id="demo-media"'), overlay = html.indexOf('<div id="demo-overlay"');
  assert.ok(video > 0 && overlay > video);
  const z = tag => Number(/z-index:(\d+)/.exec(html.slice(html.indexOf(tag)))[1]);
  assert.equal(z('<div id="demo-overlay"'), z('<video id="demo-media"') + 1);
});

test('the demo autopilot proof story validates and every scene resolves', async () => {
  const dir = path.join(ROOT, 'examples/story/demo-autopilot-16x9');
  const story = JSON.parse(await readFile(path.join(dir, 'storyboard.json'), 'utf8'));
  const narration = JSON.parse(await readFile(path.join(dir, 'NARRATION.json'), 'utf8'));
  assert.deepEqual(validateStory(story, {modules: knownModules()}).errors, []);
  const resolved = resolveStory(story, {words: narration.words});
  const demos = resolved.scenes.filter(scene => scene.module === 'product-demo');
  assert.equal(demos.length, 3);
  for (const scene of resolved.scenes) assert.doesNotThrow(() => resolveModule(scene, resolved), scene.id);
  for (const scene of demos) {
    const log = JSON.parse(await readFile(path.join(dir, scene.params.media.src.replace(/\.mp4$/, '.actions.json')), 'utf8'));
    assert.ok(scene.end - scene.start <= log.duration + 1e-3, `${scene.id} fits its clip`);
  }
});
