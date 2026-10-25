// photo-scene (kit/core/catalog-d-photo-scene.mjs): the Ken Burns move keeps
// the canvas covered and never stops, the text stays above the caption band,
// and both renderers draw the same tree and ops.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {MODULES, kenBurnsAt, photoSceneTimeline, photoSceneView} from '../kit/core/catalog-d.mjs';
import {resolveModule} from '../kit/core/modules.mjs';
import {sceneDrift} from '../kit/core/ambient.mjs';
import {profileGeometry} from '../kit/core/layout-check.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-d.mjs';
import {assertMatchesFrameState} from './helpers/frame_state.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const brand = {colors: {bg: '#10132a', primary: '#7c70ff', accent: '#22c3ee', ink: '#10132a', paper: '#f4f2ff'}, fonts: {display: 'space-grotesk', body: 'inter', meta: 'jetbrains-mono'}};
const story = (scene, extra = {}) => ({schema: 'launchclip.story.v1', lane: 'voiceover-motion', format: {width: 1920, height: 1080, fps: 30, duration: 12}, brand, scenes: [scene], overlays: [{type: 'captions', style: 'word-highlight'}], ...extra});
const scene = (params, extra = {}) => ({id: 's2', module: 'photo-scene', start: 4, end: 8, params: {media: 'assets/photos/dawn.jpg', ...params}, ...extra});
const resolve = (params, extra) => { const s = scene(params, extra); return resolveModule(s, story(s)); };

// The photo's corners through its transform (about the focus point).
function covers(state, origin, canvas) {
  const map = (x, y) => ({x: origin.x + (x - origin.x) * state.scale + state.x, y: origin.y + (y - origin.y) * state.scale + state.y});
  const tl = map(0, 0), br = map(canvas.width, canvas.height);
  return tl.x <= 1e-6 && tl.y <= 1e-6 && br.x >= canvas.width - 1e-6 && br.y >= canvas.height - 1e-6;
}

test('every Ken Burns move keeps the canvas covered and moves on every frame', () => {
  const canvas = {width: 1920, height: 1080};
  for (const move of ['push-in', 'pull-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down']) {
    for (const focus of [{x: 0.5, y: 0.5}, {x: 0.2, y: 0.8}]) {
      const model = resolve({move, focus, zoom: 0.1});
      const {samples, origin} = model.content;
      assert.equal(samples.length, 4 * 30 + 1);
      for (const sample of samples) assert.ok(covers(sample, origin, canvas), `${move} ${JSON.stringify(focus)} at ${sample.t}: ${JSON.stringify(sample)}`);
      for (let i = 1; i < samples.length; i++) assert.notDeepEqual({...samples[i], t: 0}, {...samples[i - 1], t: 0}, `${move} holds still at ${samples[i].t}`);
    }
  }
  assert.deepEqual(kenBurnsAt('push-in', 1, {zoom: 0.08, focus: {x: 0.5, y: 0.5}, canvas}), {scale: 1.08, x: 0, y: 0});
  assert.deepEqual(kenBurnsAt('pull-out', 0, {zoom: 0.08, focus: {x: 0.5, y: 0.5}, canvas}), {scale: 1.08, x: 0, y: 0});
  // A pan to the left slides the picture right, from one overscan edge to the other.
  const left = (p) => kenBurnsAt('pan-left', p, {zoom: 0.1, focus: {x: 0.5, y: 0.5}, canvas}).x;
  assert.ok(left(0) < 0 && left(1) > 0 && Math.abs(left(0.5)) < 1e-9);
});

test('text lines sit above the caption band, rise in order, and keep the captions on', () => {
  const model = resolve({lines: [{text: 'Every launch starts'}, {text: 'with a deadline', emphasis: true}]});
  assert.equal(model.hidesCaptions, false);
  const band = profileGeometry({width: 1920, height: 1080}).captionBand;
  for (const line of model.content.lines) assert.ok(line.box.y + line.box.height <= band.y, `${line.text} above the caption band`);
  assert.deepEqual(model.content.lines.map(line => line.at), [4.35, 4.8]);
  assert.ok(model.content.lines[0].size > model.content.lines[1].size, 'the first line is set larger');
  assert.equal(model.content.lines[1].color, '#7c70ff');
  assert.equal(model.content.scrim, 'bottom');
  assert.deepEqual(model.layout.rect, {x: 96, y: model.content.lines[0].box.y, width: model.content.lines[0].box.width, height: model.layout.rect.height});
  assert.equal(model.layout.role, 'text');
  // No lines: decor, no scrim, and no key text to check.
  const bare = resolve({});
  assert.equal(bare.layout.role, 'decor');
  assert.equal(bare.content.scrim, 'none');
});

test('photo-scene moves on its own, so the ambient hold drift leaves it alone', () => {
  const s = scene({lines: ['A line']});
  const st = story(s);
  const model = resolveModule(s, st);
  assert.equal(model.layout.drift, false);
  assert.equal(sceneDrift(st, s, model, {window: {start: 4, end: 8}, geometry: profileGeometry({width: 1920, height: 1080})}), null);
});

test('photo-scene validation names the param', () => {
  assert.throws(() => resolve({media: 'https://cdn.example.com/a.jpg'}), /params\.media must be a project-local assets\/ image/);
  assert.throws(() => resolve({media: 'assets/a.gif'}), /params\.media must be a project-local assets\/ image/);
  assert.throws(() => resolve({media: {src: 'assets/a.jpg', kind: 'video'}}), /params\.media\.kind is video but assets\/a\.jpg is an image/);
  assert.throws(() => resolve({media: {src: 'assets/a.jpg', sourceStart: 1}}), /sourceStart is for videos only/);
  assert.throws(() => resolve({move: 'spin'}), /params\.move must be one of push-in/);
  assert.throws(() => resolve({zoom: 0.5}), /params\.zoom must be between 0\.02 and 0\.25/);
  assert.throws(() => resolve({lines: ['One', 'Two', 'Three', 'Four']}), /params\.lines must be an array of 1–3/);
  assert.throws(() => resolve({lines: ['A line'], scrim: 'none'}), /params\.scrim must be bottom, left or full when the scene has text lines/);
  assert.throws(() => resolve({lines: [{text: 'x'.repeat(41)}]}), /params\.lines\[0\]\.text must be a string of 1–40/);
  assert.throws(() => resolve({lines: [{text: 'Late', at: 3.9}]}), /params\.lines\[0\]\.at must fall between/);
});

test('HyperFrames: an image stays in the layer with its overlay; a video is hoisted with the overlay above', () => {
  const image = resolve({lines: ['A line']});
  const out = EMITTERS['photo-scene'](image);
  assert.equal(out.overlay, undefined);
  assert.match(out.html, /^<div id="s2-frame" class="clip" data-start="4" data-duration="4" data-track-index="2" data-module="photo-scene"/);
  assert.match(out.html, /<img id="s2-media" src="assets\/photos\/dawn\.jpg"/);
  assert.ok(out.html.indexOf('s2-media') < out.html.indexOf('s2-overlay'), 'the overlay is drawn above the photo');
  const ops = photoSceneTimeline(image);
  for (const op of ops) assert.ok(out.html.includes(`id="${op.target}"`), op.target);
  const times = [4, 4.1, 4.4, 5, 6.5, 7.7, 8, 5.2, 4.2];
  assertMatchesFrameState(ops, out.motion, times, 'photo-scene');
  const video = resolve({media: {src: 'assets/media/clip.mp4', sourceStart: 1.5}});
  const hoisted = EMITTERS['photo-scene'](video);
  assert.match(hoisted.html, /^<video id="s2-media" class="clip" data-start="4" data-duration="4" data-track-index="2" data-media-start="1\.5"/);
  assert.match(hoisted.overlay, /^<div id="s2-overlay" class="clip"[^>]* data-track-index="3"/);
  assert.equal(photoSceneView(video).media.tag, 'video');
});

test('photo-scene is registered in both renderers and the planner', () => {
  assert.equal(typeof MODULES['photo-scene'].resolve, 'function');
  assert.match(readFileSync(path.join(ROOT, 'kit/remotion/catalog/registry-d.ts'), 'utf8'), /'photo-scene': PhotoScene/);
  assert.match(readFileSync(path.join(ROOT, 'skills/launchclip-create-video/references/storyboard-modules.md'), 'utf8'), /### photo-scene \(keeps captions\)/);
});
