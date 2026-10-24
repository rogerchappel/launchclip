// Catalogue E (kit/core/catalog-e.mjs): product moments around the presenter.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {MODULES, catalogETimeline, catalogEView} from '../kit/core/catalog-e.mjs';
import {frameState} from '../kit/core/catalog-b-view.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-e.mjs';
import {knownModules} from '../kit/core/modules.mjs';
import {resolveStory} from '../kit/core/story.mjs';
import {compileStoryToHyperFrames} from '../kit/hyperframes/story-compiler.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const format = {width: 1080, height: 1920, fps: 30, duration: 30};
const subject = {available: true, framing: 'medium', head: {x: 420, y: 560, width: 240, height: 300}, body: {x: 200, y: 560, width: 680, height: 1360}, headroom: 0.29, plate: null, placement: 'measured'};
const ctx = (overrides = {}) => ({id: 'scene', start: 2, duration: 4, format, brand, aspect: '9:16', subject, ...overrides});
const resolve = (id, params, overrides) => ({...MODULES[id].resolve(params, ctx(overrides)), module: id});
const IDS = ['feed-frame', 'pull-back', 'backdrop-swap', 'app-stage', 'phone-stage', 'growth-line'];
const PARAMS = {
  'feed-frame': {handle: '@ada', caption: 'Built in a weekend'},
  'pull-back': {steps: ['Transcribe', 'Cut', 'Caption'], title: 'launch.mp4'},
  'backdrop-swap': {title: 'Meet Ledgerly'},
  'app-stage': {media: {src: 'assets/app.png'}, title: 'Ledgerly'},
  'phone-stage': {media: {src: 'assets/demo/flow.mp4', sourceStart: 1.5}},
  'growth-line': {points: [{value: 2}, {value: 3}, {value: 2.5}, {value: 3}, {value: 9}, {value: 14}], pill: 'Scale'}
};

test('catalogue E is registered in the module registry, HyperFrames and Remotion', () => {
  for (const id of IDS) assert.ok(knownModules().includes(id), id);
  assert.deepEqual(Object.keys(EMITTERS).sort(), [...IDS].sort());
  const registry = readFileSync(fileURLToPath(new URL('../kit/remotion/catalog/registry-e.ts', import.meta.url)), 'utf8');
  for (const id of IDS) assert.match(registry, new RegExp(`'${id}': \\w+`));
});

test('every module resolves with its layer, events and a full view', () => {
  const layers = {'feed-frame': 'split', 'pull-back': 'front', 'backdrop-swap': 'behind', 'app-stage': 'behind', 'phone-stage': 'front', 'growth-line': 'behind'};
  for (const id of IDS) {
    const model = resolve(id, PARAMS[id]);
    assert.equal(model.layer ?? 'front', layers[id], id);
    assert.ok(model.events.length >= 1, id);
    const view = catalogEView(model);
    assert.ok(view.front || view.behind, `${id} draws something`);
    assert.ok(catalogETimeline(model).length > 0, id);
  }
  assert.equal(resolve('feed-frame', {}).hidesCaptions, true);
  assert.equal(resolve('pull-back', {steps: ['Render']}).hidesCaptions, true);
});

test('framed base: the camera springs the frame into the window and the hole follows it every frame', () => {
  const model = resolve('feed-frame', PARAMS['feed-frame']);
  const {samples} = model.camera;
  assert.ok(Math.abs(samples.find((s) => s.t >= 3.6).scale - 0.72) < 0.01, 'settles at the window scale');
  assert.deepEqual(samples.at(-1), {t: 6, scale: 1, x: 0, y: 0});
  const ops = catalogETimeline(model);
  const hole = (t) => frameState(ops, t).get('scene-hole');
  const camera = samples.find((s) => Math.abs(s.t - 3.5) < 1e-6);
  assert.equal(hole(3.5).scaleX, camera.scale);
  assert.equal(hole(3.5).x, camera.x);
  // The hole crops the scaled frame at eye level, so the presenter breaks out over its top.
  assert.ok(model.content.crop.y > 600 && model.content.crop.y < 750, `crop top ${model.content.crop.y}`);
  assert.deepEqual(model.parts, {behind: ['hole'], front: ['chrome']});
  assert.ok(hole(5.99).opacity < 0.2, 'the backdrop fades out as the frame springs back');
});

test('feed-frame is honest: no invented counts, follow needs a handle', () => {
  const bare = resolve('feed-frame', {});
  assert.equal(bare.content.handle, null);
  assert.ok(bare.content.icons.every((icon) => icon.label === null));
  const counted = resolve('feed-frame', {handle: 'ada', counts: {likes: '1.2K'}});
  assert.equal(counted.content.handle, '@ada');
  assert.equal(counted.content.icons[0].label, '1.2K');
  assert.throws(() => resolve('feed-frame', {follow: true}), /needs params\.handle/);
  assert.throws(() => resolve('feed-frame', {caption: 'x'.repeat(61)}), /params\.caption/);
});

test('pull-back: real steps tick in order and the percent counts to 100', () => {
  const model = resolve('pull-back', PARAMS['pull-back'], {duration: 5});
  assert.equal(model.camera.frame, true);
  const ops = catalogETimeline(model);
  const pct = (t) => frameState(ops, t).get('scene-pct')?.text;
  assert.equal(pct(2.1), '0%');
  assert.equal(pct(model.content.doneAt + 0.01), '100%');
  const times = model.content.stepTimes;
  assert.ok(times.every((time, i) => i === 0 || time > times[i - 1]));
  assert.deepEqual(model.events.map((event) => event.name), ['pull', 'step-0', 'step-1', 'step-2', 'done']);
  assert.throws(() => resolve('pull-back', {steps: []}), /params\.steps/);
  assert.throws(() => resolve('pull-back', {steps: ['a', 'b', 'c', 'd'], release: 1.2}, {duration: 3}), /per step/);
  const wide = resolve('pull-back', {steps: ['Transcribe', 'Cut']}, {format: {width: 1920, height: 1080, fps: 30, duration: 30}, aspect: '16:9'});
  assert.ok(wide.content.panel.x > wide.content.window.x + wide.content.window.width, 'landscape puts the panel beside the window');
});

test('backdrop-swap moves the presenter, not the room, and fades its backdrop', () => {
  const model = resolve('backdrop-swap', PARAMS['backdrop-swap']);
  assert.equal(model.layer, 'behind');
  const settled = model.subjectCamera.samples.find((s) => s.t >= 3.4);
  assert.ok(Math.abs(settled.scale - 0.78) < 0.01);
  assert.ok(settled.y > 0, 'the presenter moves down to keep the frame bottom');
  assert.equal(model.camera, undefined);
  const ops = catalogETimeline(model);
  assert.ok(frameState(ops, 2.6).get('scene-backdrop').opacity > 0.99);
  const video = resolve('backdrop-swap', {backdrop: {src: 'assets/broll.mp4'}});
  assert.equal(catalogEView(video).media.tag, 'video');
  assert.throws(() => resolve('backdrop-swap', {backdrop: {src: '../x.png'}}), /project-local assets/);
});

test('app-stage: the UI fills the top and the head covers its bottom edge', () => {
  const model = resolve('app-stage', PARAMS['app-stage']);
  const win = model.content.window;
  assert.equal(win.y, model.safe.y);
  assert.ok(Math.abs(win.y + win.height - (560 + 300 * 0.7)) < 1);
  // Little headroom: the window keeps a minimum depth behind the presenter.
  const tight = resolve('app-stage', PARAMS['app-stage'], {subject: {...subject, head: {x: 420, y: 420, width: 240, height: 300}}});
  assert.ok(tight.content.window.height >= tight.safe.height * 0.45 - 1);
  assert.throws(() => resolve('app-stage', PARAMS['app-stage'], {subject: {...subject, head: {x: 420, y: 200, width: 240, height: 120}}}), /needs headroom/);
});

test('phone-stage: beside the head, the media moves with the phone, the room pans away', () => {
  const model = resolve('phone-stage', PARAMS['phone-stage']);
  assert.equal(model.content.side, 'right', 'the side with more room');
  const phone = model.content.phone;
  assert.ok(phone.x >= 420 + 240 + 36 - 100 - 1e-6, 'clear of the head once the room has panned away');
  const ops = catalogETimeline(model);
  for (const t of [2.2, 3, 4.5]) {
    const a = frameState(ops, t).get('scene-phone'), b = frameState(ops, t).get('scene-media');
    assert.equal(b.x, a.x);
    assert.equal(b.y, a.y);
  }
  assert.ok(model.camera.samples.some((s) => s.x < 0), 'the room pans left, away from a phone on the right');
  assert.ok(model.camera.samples.every((s) => Math.abs(s.x) <= (s.scale - 1) * 540 + 1e-6), 'the pan never uncovers the frame edge');
  assert.equal(resolve('phone-stage', {...PARAMS['phone-stage'], pan: false}).camera, undefined);
});

test('HyperFrames: a video is hoisted with its overlay; a split module returns its behind part', () => {
  const phone = EMITTERS['phone-stage'](resolve('phone-stage', PARAMS['phone-stage']));
  assert.match(phone.html, /<video id="scene-media"[^>]*data-media-start="1\.5"/);
  assert.match(phone.overlay, /id="scene-overlay"/);
  const feed = EMITTERS['feed-frame'](resolve('feed-frame', PARAMS['feed-frame']));
  assert.match(feed.behind.html, /id="scene-hole"/);
  assert.match(feed.html, /id="scene-chrome"/);
  const image = EMITTERS['app-stage'](resolve('app-stage', PARAMS['app-stage']));
  assert.match(image.html, /<img id="scene-media"/);
  assert.equal(image.overlay, undefined);
});

test('the story compiler draws feed-frame behind and in front of the subject', async () => {
  const story = resolveStory({schema: 'launchclip.story.v1', lane: 'footage-led', format: {width: 1080, height: 1920, fps: 30, duration: 6}, brand,
    base: {src: 'assets/recording.mp4', subject: {mattes: [{src: 'assets/subject/a.webm', in: 0, out: 6}]}},
    scenes: [{id: 'feed', module: 'feed-frame', track: 1, start: 1, end: 5, params: {handle: '@ada'}}]});
  const {html} = await compileStoryToHyperFrames(story, {write: false});
  const z = (pattern) => Number(html.match(pattern)?.[1]);
  const behind = z(/data-launchclip-part="behind" style="z-index:(\d+)"/);
  const matte = z(/<video id="lc-subject-0"[^>]*z-index:(\d+)/);
  const front = z(/id="lc-scene-feed"[^>]*style="z-index:(\d+)/);
  assert.ok(behind < matte && matte < front, `behind ${behind} < subject ${matte} < front ${front}`);
});

test('growth-line: draws behind the head, kicks up at the biggest rise, honest about data', () => {
  const model = resolve('growth-line', PARAMS['growth-line']);
  assert.equal(model.layer, 'behind');
  assert.equal(model.content.takeoff, 3, 'the spike starts before the biggest rise');
  assert.ok(model.content.bottom >= 560 + 300 * 0.75 - 1, 'the chart reaches behind the head');
  const ys = model.content.xy.map((pt) => pt.y);
  assert.ok(ys.at(-1) < ys[0], 'higher values draw higher');
  const ops = catalogETimeline(model);
  const offset = (t) => frameState(ops, t).get('scene-line').strokeDashoffset;
  assert.equal(offset(2.05), 1);
  assert.equal(offset(model.content.endAt + 0.01), 0);
  assert.deepEqual(model.events.map((event) => event.name), ['draw', 'takeoff', 'pill']);
  assert.throws(() => resolve('growth-line', {points: [{value: 1}, {value: 2}, {value: 3}], mode: 'data'}), /params\.source is required/);
  assert.equal(resolve('growth-line', {points: [{value: 1}, {value: 2}, {value: 3}], mode: 'data', source: 'Stripe dashboard'}).content.source, 'Stripe dashboard');
  assert.throws(() => resolve('growth-line', {points: [{value: 1}, {value: 2}]}), /params\.points/);
  const high = resolve('growth-line', PARAMS['growth-line'], {subject: {...subject, head: {x: 420, y: 300, width: 240, height: 120}}});
  assert.ok(high.content.bottom - high.content.top >= 260 - 1e-6, 'a high head still gets a 260 px chart, behind the presenter');
});
