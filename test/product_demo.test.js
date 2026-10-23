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
  const pan = keys[4].t - keys[3].t;
  assert.deepEqual(keys.map(k => [k.t, Math.round(k.s * 100) / 100]), [
    [0, 1], [2 - T.zoomLead, 1], [2 - T.settle, 1.8],
    [3.5 - T.settle - pan, 1.8], [3.5 - T.settle, 1.6],
    [3.5 + T.hold, 1.6], [3.5 + T.hold + T.zoomOut, 1],
    [9 - T.zoomLead, 1], [9 - T.settle, 1.8],
    [9.8 + 0.4, 1.8], [9.8 + 0.4 + T.zoomOut, 1]
  ].map(([t, s]) => [Math.round(t * 1e4) / 1e4, s]));
  // The zoom settles before the action, and a nearby pan takes pan..panMax.
  assert.ok(near(T.zoomLead, T.zoomIn + T.settle, 1e-9));
  assert.ok(pan >= T.pan && pan <= T.panMax, String(pan));
  // Eased in log space: halfway through the zoom in, the scale is the geometric mean.
  const mid = cameraAt(keys, 2 - T.zoomLead + T.zoomIn / 2);
  assert.ok(near(mid.s, Math.sqrt(1.8), 1e-6));
  assert.deepEqual(cameraAt(keys, 12), {s: 1, f: centre});
  // A zoom that cannot land before the scene ends is skipped.
  assert.equal(cameraKeys([{at: 11.9, s: 1.8, f: centre}], {start: 0, end: 12, centre}).length, 1);
  // A shot near the end zooms out by the end.
  const late = cameraKeys([{at: 10.5, s: 1.8, f: centre}], {start: 0, end: 12, centre});
  assert.equal(late.at(-1).t, 12);
});

// Fastest on-screen motion of the camera, per frame at 30 fps: the largest
// move of the canvas centre and the video corners, and the largest zoom step.
function cameraSpeed(keys, rect) {
  let px = 0, zoom = 0, previous = null;
  for (let frame = 0; frame <= 12 * 30; frame++) {
    const cam = cameraTransform(cameraAt(keys, frame / 30, {rect, canvas}), rect, canvas);
    const points = [centre, {x: rect.x, y: rect.y}, {x: rect.x + rect.width, y: rect.y + rect.height}].map(p => throughCamera(p, cam));
    if (previous) {
      px = Math.max(px, ...points.map((p, k) => Math.hypot(p.x - previous.points[k].x, p.y - previous.points[k].y)));
      zoom = Math.max(zoom, Math.abs(Math.log(cam.scale / previous.cam.scale)));
    }
    previous = {cam, points};
  }
  return {px, zoom};
}

test('cameraKeys never snaps: moves take at least minMove, close or far actions alike', () => {
  const T = PRODUCT_DEMO_TIMING;
  const rect = {x: 96, y: 54, width: 1728, height: 972};
  const at = (x, y) => ({x, y});
  const logs = {
    // Clicks a third of a second apart across the screen: one wide shot, no whip pans.
    burst: [{at: 2, s: 1.8, f: at(200, 150)}, {at: 2.3, s: 1.8, f: at(1700, 950)}, {at: 2.6, s: 1.8, f: at(300, 900)}],
    // Two clicks 1 s apart, far apart on the same page.
    hop: [{at: 2, s: 1.8, f: at(200, 150)}, {at: 3, s: 1.8, f: at(1700, 950)}],
    // A corner target that hits the clamp mid-zoom.
    corner: [{at: 1, s: 1.8, f: at(110, 1010)}, {at: 2.4, s: 1.8, f: at(1800, 60)}],
    // A navigating click followed by a field on the next page (the ClutchCut API key flow).
    navigate: [{at: 2.81, navigates: true, s: 1.8, f: at(160, 850)}, {at: 4.65, s: 1.8, f: at(880, 260)}]
  };
  for (const [name, targets] of Object.entries(logs)) {
    const keys = cameraKeys(targets, {start: 0, end: 12, centre, canvas});
    for (let k = 1; k < keys.length; k++) {
      if (!near(keys[k].s, keys[k - 1].s, 1e-6) || !near(keys[k].f.x, keys[k - 1].f.x, 1e-6) || !near(keys[k].f.y, keys[k - 1].f.y, 1e-6)) assert.ok(keys[k].t - keys[k - 1].t >= T.minMove - 1e-6, `${name}: a ${keys[k].t - keys[k - 1].t} s move at ${keys[k].t}`);
    }
    const {px, zoom} = cameraSpeed(keys, rect);
    assert.ok(px < 150, `${name}: ${px.toFixed(1)} px in one frame`);
    assert.ok(zoom < 0.06, `${name}: a ${(zoom * 100).toFixed(1)}% zoom step in one frame`);
  }
  // The burst is framed together (wide here: it spans the screen) rather than chased.
  assert.ok(cameraKeys(logs.burst, {start: 0, end: 12, centre, canvas}).every(k => k.s === 1));
  // A far hop pulls back halfway instead of whipping across at full zoom.
  const hop = cameraKeys(logs.hop, {start: 0, end: 12, centre, canvas});
  assert.ok(hop.some(k => k.dip && k.dip < 1.8));
});

test('cameraAt with a view keeps the focus inside the clamp, so a zoom to a corner glides', () => {
  const rect = {x: 96, y: 54, width: 1728, height: 972};
  const keys = cameraKeys([{at: 2, s: 1.8, f: {x: 110, y: 1010}}], {start: 0, end: 6, centre, canvas});
  for (let t = 0; t <= 6; t += 1 / 30) {
    const state = cameraAt(keys, t, {rect, canvas});
    const free = {scale: state.s, x: canvas.width / 2 - state.s * state.f.x, y: canvas.height / 2 - state.s * state.f.y};
    const clamped = cameraTransform(state, rect, canvas);
    assert.ok(near(free.x, clamped.x, 0.02) && near(free.y, clamped.y, 0.02), `t=${t}: ${JSON.stringify({free, clamped})}`);
  }
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

// The ClutchCut "Create an API key" flow: "API Keys" in the Settings sidebar
// opens another page, then the name field on it is typed into.
const NAVIGATING_LOG = {
  schema: 'launchclip.demo-actions.v1', video: 'api-keys.mp4', viewport: {width: 1920, height: 1080}, duration: 8,
  actions: [
    {index: 0, type: 'goto', path: '/settings', url: 'http://localhost:3000/settings', start: 0, end: 0, box: null, callout: null},
    {index: 1, type: 'click', text: 'API Keys', label: 'API Keys', start: 2.2, at: 2.81, end: 3.42, url: 'http://localhost:3000/settings/api-keys',
      box: {x: 24, y: 857, width: 200, height: 40}, callout: 'Settings → API Keys'},
    {index: 2, type: 'type', text: 'Key name', label: 'Key name', start: 3.6, at: 4.65, end: 5.9, url: 'http://localhost:3000/settings/api-keys',
      box: {x: 700, y: 235, width: 520, height: 44}, keys: [4.9, 5.0, 5.1, 5.2], callout: null}
  ]
};

test('a navigating click: its callout leads the click and leaves with the page, its outline too', () => {
  const T = PRODUCT_DEMO_TIMING;
  const params = productDemoParams(NAVIGATING_LOG, {src: 'assets/demo/api-keys.mp4', duration: 8});
  const [click, typing] = params.actions;
  assert.equal(click.navigates, true, 'the URL changed across the click');
  assert.equal(typing.navigates, undefined, 'typing stayed on the page');
  // The callout shows as the cursor reaches "API Keys", before the click.
  const [callout] = params.callouts;
  assert.ok(callout.at <= click.at - 0.3 && callout.at >= click.at - 1, JSON.stringify(callout));

  const story = {schema: 'launchclip.story.v1', lane: 'motion', format: {width: 1920, height: 1080, fps: 30, duration: 8},
    brand: {colors: {bg: '#0b0d12', primary: '#5b4dff', accent: '#22c3ee', paper: '#f4efe6', ink: '#0b0d12'}, fonts: {display: 'system-ui', body: 'system-ui'}},
    scenes: [{id: 'keys', module: 'product-demo', start: 0, end: 8, params}]};
  const resolved = resolveStory(story);
  assert.deepEqual(validateStory(story, {modules: knownModules()}).errors, []);
  const model = resolveModule(resolved.scenes[0], resolved);
  const pill = model.content.callouts[0];
  // Gone by the time the next page has replaced Settings, and before the camera heads for the name field.
  assert.ok(pill.until <= click.at + T.navLeave + 1e-6, `callout until ${pill.until}`);
  const toField = model.content.keys.find(key => key.t > click.at && key.f.y < 540);
  assert.ok(toField && pill.until < toField.t);
  // While it shows, the element it points at stays where it was placed (the camera has settled on it).
  const anchor = mapBox(callout.box, model.content.rect, params.viewport);
  const seenAt = t => {
    const cam = cameraTransform(cameraAt(model.content.keys, t, {rect: model.content.rect, canvas}), model.content.rect, canvas);
    return throughCamera({x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height / 2}, cam);
  };
  const placed = seenAt(click.at);
  for (let t = pill.at + 0.4; t <= pill.until; t += 1 / 30) {
    const seen = seenAt(t);
    assert.ok(Math.hypot(seen.x - placed.x, seen.y - placed.y) < 24, `t=${t.toFixed(2)}: the anchor drifted to ${JSON.stringify(seen)} from ${JSON.stringify(placed)}`);
  }
  assert.ok(pill.box.y > placed.y || pill.box.y + pill.box.height < placed.y, 'the pill sits beside the element, not on it');
  // The outline on "API Keys" is gone with the page; the camera leaves soon after the click.
  const ops = productDemoTimeline(model);
  const outline = ops.filter(op => op.target === 'keys-hl-0' && op.type !== 'set').at(-1);
  assert.ok(outline.start + outline.duration <= click.at + T.navLeave + 1e-6, JSON.stringify(outline));
  const hold = model.content.keys.find(key => key.t >= click.at - 1e-6);
  assert.ok(hold.t <= click.at + T.navLeave + 1e-6, `the camera holds on the old page until ${hold.t}`);
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
