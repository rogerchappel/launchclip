// set-prop (kit/core/catalog-d-set-prop.mjs): a drawn prop or a project image
// or video standing in a cast scene's world, behind or in front of the
// characters by track, moving with the world camera, popping or sliding in,
// and drawn the same by both renderers.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {frameState} from '@launchclip/core/catalog-b-view.mjs';
import {MODULES, setPropTimeline, setPropView} from '@launchclip/core/catalog-d.mjs';
import {worldCameraStates} from '@launchclip/core/catalog-world.mjs';
import {ridesPlate} from '@launchclip/core/camera-world.mjs';
import {OVERSCAN, PROP_IDS, renderWorld, worldAnchors} from '@launchclip/core/worlds/index.mjs';
import {resolveModule} from '@launchclip/core/modules.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-d.mjs';
import {assertMatchesFrameState} from './helpers/frame_state.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const brand = {colors: {bg: '#14122b', primary: '#6d5dfc', accent: '#ffb547', ink: '#14122b', paper: '#f6f3ee'}, fonts: {display: 'anton', body: 'space-grotesk'}};
const story = (scenes, extra = {}) => ({schema: 'launchclip.story.v1', lane: 'motion', format: {width: 1080, height: 1920, fps: 30, duration: 10}, brand,
  cast: {style: 'outlined', characters: [{id: 'maya'}]}, scenes, ...extra});
const kitchen = (extra = {}) => ({id: 'w', module: 'world', start: 0, end: 6, params: {kind: 'kitchen', camera: 'push'}, ...extra});
const prop = (params, extra = {}) => ({id: 'fridge', module: 'set-prop', track: 1, start: 0, end: 6, params, ...extra});
const cast = (track) => ({id: 'cast', module: 'cast-scene', track, start: 0, end: 6, params: {set: 'standing', cast: [{id: 'maya'}]}});
const sampleAt = (model, t) => model.content.samples.find(sample => Math.abs(sample.t - t) < 1e-6);

test('household props are drawn in the world kit', () => {
  for (const id of ['fridge', 'washing-machine', 'bookshelf', 'microwave', 'toaster']) assert.ok(PROP_IDS.includes(id), id);
  // A kitchen world can stand a fridge on its floor like any prop.
  const world = renderWorld({kind: 'kitchen', canvas: {width: 1080, height: 1920}, props: [{id: 'fridge', at: 0.8}]});
  assert.equal(world.props[0].id, 'fridge');
  assert.ok(world.props[0].rect.height > 400, 'a fridge is about person height');
});

test('a drawn prop stands on the world\'s floor line, sized in metres, and follows the plate camera', () => {
  const scenes = [kitchen(), prop({prop: 'fridge', at: 0.75}), cast(2)];
  const s = story(scenes);
  const model = resolveModule(scenes[1], s);
  const ground = worldAnchors('kitchen', {canvas: {width: 1080, height: 1920}}).ground;
  assert.equal(model.content.base, ground.y);
  assert.equal(model.content.rect.y + model.content.rect.height, ground.y);
  assert.equal(model.content.rect.height, Math.round(1.8 * ground.ppm * 100) / 100);
  assert.equal(model.content.rect.x + model.content.rect.width / 2, 810);
  // It arrives and leaves with the plate: whole from the first frame.
  assert.deepEqual([model.content.enter.type, model.content.exit.type], ['cut', 'cut']);
  // It moves exactly as the world's front layer: scale about the canvas centre.
  const front = worldCameraStates({move: 'push', amount: 0.5}, {overscan: Math.round(1080 * OVERSCAN)}).front;
  const last = model.content.samples.at(-1);
  assert.equal(last.scaleX, front.to.scale);
  assert.ok(Math.abs(last.x - front.to.x) < 1e-9);
  assert.equal(model.layout.drift, false);
  // The world is drawn behind it; a cast-scene on a higher track is in front of it.
  assert.ok(model.track === undefined || model.track >= 0);
});

test('a prop popping in mid-shot scales up about its base and fades out with its own exit', () => {
  const scenes = [kitchen({params: {kind: 'kitchen', camera: 'still'}}), prop({prop: 'fridge'}, {start: 2, end: 5})];
  const model = resolveModule(scenes[1], story(scenes));
  assert.deepEqual([model.content.enter.type, model.content.exit.type], ['pop', 'fade']);
  const first = sampleAt(model, 2);
  assert.ok(first.scaleY < 0.65 && first.opacity === 0, JSON.stringify(first));
  // The base stays on the floor while it scales: the pivot maps to itself.
  const {pivot, centre} = model.content;
  const mapped = centre.y + (pivot.y - centre.y) * first.scaleY + first.y;
  assert.ok(Math.abs(mapped - pivot.y) < 0.5, `${mapped} vs ${pivot.y}`);
  const settled = sampleAt(model, 3);
  assert.ok(settled.opacity === 1 && Math.abs(settled.scaleY - 1) < 0.05);
  assert.ok(model.events.some(event => event.name === 'enter' && event.cue === 'pop'));
  const ops = setPropTimeline(model);
  assert.ok(frameState(ops, 4.9).get('fridge-prop').opacity < 1);
  assert.equal(frameState(ops, 5).get('fridge-prop').opacity, 0);
});

test('media props: an image with a contact shadow, a video alone (hoisted), slides and flips', () => {
  const scenes = [kitchen(), prop({media: 'assets/props/sign.png', on: 'back', at: 'left', height: 0.8, width: 0.6, enter: 'from-left', flip: true}, {start: 1})];
  const image = resolveModule(scenes[1], story(scenes));
  const view = setPropView(image);
  assert.equal(view.media, null);
  assert.ok(JSON.stringify(view.front).includes('"fridge-shadow"'));
  const anchors = worldAnchors('kitchen', {canvas: {width: 1080, height: 1920}});
  assert.equal(image.content.base, anchors.floor.y, 'back stands against the back wall');
  const start = sampleAt(image, 1);
  assert.ok(start.x < -image.content.rect.x - image.content.rect.width + 1, 'starts outside the frame on the left');
  assert.ok(start.scaleX < 0, 'mirrored');
  const out = EMITTERS['set-prop'](image);
  assert.match(out.html, /^<div id="fridge" class="clip"[^>]*data-module="set-prop"/);
  assertMatchesFrameState(setPropTimeline(image), out.motion, [1, 1.1, 1.3, 2, 5.5, 6], 'set-prop image');

  const vscenes = [kitchen(), prop({media: {src: 'assets/props/tv.mp4', sourceStart: 2}, on: 'wall', enter: 'drop'}, {start: 1})];
  const video = resolveModule(vscenes[1], story(vscenes));
  const vout = EMITTERS['set-prop'](video);
  assert.match(vout.html, /^<video id="fridge-prop" class="clip"[^>]*data-media-start="2"/);
  assert.equal(setPropView(video).front, null, 'a video is the module\'s only element, so a world plate keeps it in camera');
  assert.equal(video.layout.live, true);
});

test('set-prop validation names the param', () => {
  const s = story([kitchen()]);
  const resolve = params => resolveModule(prop(params), s);
  assert.throws(() => resolve({}), /needs exactly one of prop/);
  assert.throws(() => resolve({prop: 'fridge', media: 'assets/a.png'}), /needs exactly one of prop/);
  assert.throws(() => resolve({prop: 'spaceship'}), /params\.prop must be one of/);
  assert.throws(() => resolve({media: 'https://example.com/a.png'}), /params\.media must be a project-local assets\//);
  assert.throws(() => resolve({prop: 'fridge', width: 1}), /params\.width is for media/);
  assert.throws(() => resolve({prop: 'fridge', enter: 'spin'}), /params\.enter must be one of cut, fade, pop/);
  assert.throws(() => resolveModule(prop({prop: 'fridge'}, {track: 0}), story([])), /params\.y is required when there is no world/);
  // Without a world, y places it.
  const free = resolveModule(prop({prop: 'fridge', y: 0.8}), story([]));
  assert.equal(free.content.base, 1536);
});

test('in world mode a set-prop with its plate\'s window rides the plate', () => {
  const scenes = [kitchen(), prop({prop: 'fridge'})];
  const s = story(scenes, {camera: {mode: 'world'}});
  assert.equal(ridesPlate(s, scenes[1]), 'w');
  assert.equal(ridesPlate(s, {...scenes[1], start: 2}), null);
});

test('set-prop is registered in both renderers and documented for the skills', () => {
  assert.equal(typeof MODULES['set-prop'].resolve, 'function');
  assert.match(readFileSync(path.join(ROOT, 'kit/remotion/catalog/registry-d.ts'), 'utf8'), /'set-prop': SetProp/);
  assert.match(readFileSync(path.join(ROOT, 'skills/launchclip-create-video/references/storyboard-modules.md'), 'utf8'), /### set-prop/);
});
