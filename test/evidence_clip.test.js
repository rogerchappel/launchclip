// evidence-clip (kit/core/catalog-d-evidence-clip.mjs): a captured page in a
// glass frame, a source tag, post zooms and a post cursor; both renderers
// draw the same tree and ops.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {MODULES, evidenceClipParams, evidenceClipTimeline, evidenceClipView} from '../kit/core/catalog-d.mjs';
import {focusAt, focusKeys, shortDate} from '../kit/core/catalog-d-evidence-clip.mjs';
import {resolveModule} from '../kit/core/modules.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-d.mjs';
import {assertMatchesFrameState} from './helpers/frame_state.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const brand = {colors: {bg: '#0b0f17', primary: '#7c70ff', accent: '#22d3ee', ink: '#0b0f17', paper: '#f4f6fb'}, fonts: {display: 'space-grotesk', body: 'inter', meta: 'jetbrains-mono'}};
const story = (scene, format = {width: 1920, height: 1080}) => ({schema: 'launchclip.story.v1', lane: 'voiceover-motion', format: {...format, fps: 30, duration: 14}, brand, scenes: [scene], overlays: [{type: 'captions', style: 'word-highlight'}]});
const base = {media: {src: 'assets/evidence/pr-39217.mp4'}, viewport: {width: 1600, height: 1000}, source: {publisher: 'GitHub · dotnet/efcore', date: 'Oct 16, 2026'}};
const scene = (params = {}) => ({id: 's3', module: 'evidence-clip', start: 2, end: 10, params: {...base, ...params}});
const resolve = (params, format) => { const s = scene(params); return resolveModule(s, story(s, format)); };

test('the window keeps the capture aspect inside the safe zone, the source tag under it', () => {
  for (const format of [{width: 1920, height: 1080}, {width: 1080, height: 1920}]) {
    const model = resolve({}, format);
    const {rect, source, bezel} = model.content;
    assert.ok(Math.abs(rect.width / rect.height - 1.6) < 0.01);
    assert.ok(rect.x - bezel >= model.safe.x - 0.01 && rect.x + rect.width + bezel <= model.safe.x + model.safe.width + 0.01);
    assert.ok(source.box.y >= rect.y + rect.height + bezel);
    assert.ok(source.box.y + source.box.height <= model.safe.y + model.safe.height + 0.01, 'the tag stays above the caption band');
    assert.equal(model.layout.drift, false);
  }
});

test('the push never holds still; a focus zooms in, holds and eases back out', () => {
  const model = resolve({focus: [{at: 2, box: {x: 400, y: 500, width: 600, height: 40}}]});
  const {samples, keys} = model.content;
  assert.equal(samples.length, 8 * 30 + 1);
  for (let i = 1; i < samples.length; i++) assert.notDeepEqual({...samples[i], t: 0}, {...samples[i - 1], t: 0}, `holds still at ${samples[i].t}`);
  const at = (t) => focusAt(keys, t);
  assert.equal(at(3).s, 1);
  assert.equal(at(5).s, 2);
  assert.ok(at(4.4).s > 1 && at(4.4).s < 2);
  assert.equal(at(9.5).s, 1);
  assert.deepEqual(focusKeys([], {start: 0, end: 4, centre: {x: 5, y: 5}}), [{t: 0, s: 1, f: {x: 5, y: 5}}]);
});

test('the sidecar becomes params; dates read short', () => {
  const record = {video: 'pr-39217.mp4', viewport: {width: 1600, height: 1000}, provenance: {publisher: 'GitHub · dotnet/efcore', published_at: '2026-10-16T17:45:34Z'}};
  assert.deepEqual(evidenceClipParams(record), {media: {src: 'assets/evidence/pr-39217.mp4', sourceStart: 0}, viewport: {width: 1600, height: 1000}, source: {publisher: 'GitHub · dotnet/efcore', date: 'Oct 16, 2026'}});
  assert.equal(shortDate('2026-01-02T00:00:00Z'), 'Jan 2, 2026');
});

test('evidence-clip validation names the param', () => {
  assert.throws(() => resolve({media: {src: 'https://x.com/a.mp4'}}), /params\.media\.src must be a project-local assets\/ video/);
  assert.throws(() => resolve({frame: 'neon'}), /params\.frame must be one of glass/);
  assert.throws(() => resolve({push: 0.5}), /params\.push must be between 0 and 0\.12/);
  assert.throws(() => resolve({focus: [{at: 3, box: {x: 0, y: 0, width: 10, height: 10}}, {at: 1, box: {x: 0, y: 0, width: 10, height: 10}}]}), /params\.focus\[1\]\.at must not be earlier/);
  assert.throws(() => resolve({cursor: [{at: 1, x: 1, y: 1}, {at: 1.1, x: 2, y: 2}]}), /params\.cursor\[1\]\.at must be at least 0\.2 s after/);
  assert.throws(() => resolve({viewport: undefined}), /viewport/);
});

test('HyperFrames: the video is hoisted, the frame, cursor and tag above it; GSAP matches the op list', () => {
  const model = resolve({focus: [{at: 1.5, box: {x: 400, y: 500, width: 600, height: 40}}], cursor: [{at: 1, x: 900, y: 200}, {at: 2.5, x: 500, y: 520, click: true}]});
  const out = EMITTERS['evidence-clip'](model);
  assert.match(out.html, /^<video id="s3-media" class="clip" data-start="2" data-duration="8" data-track-index="2" data-media-start="0"/);
  assert.match(out.overlay, /^<div id="s3-overlay" class="clip"[^>]* data-track-index="3"/);
  for (const id of ['s3-bezel', 's3-cursor', 's3-source']) assert.ok(out.overlay.includes(`id="${id}"`), id);
  const ops = evidenceClipTimeline(model);
  for (const op of ops) assert.ok(out.html.includes(`id="${op.target}"`) || out.overlay.includes(`id="${op.target}"`), op.target);
  assertMatchesFrameState(ops, out.motion, [2, 2.2, 2.9, 3.4, 3.8, 4.5, 6, 9.7, 10, 3.1], 'evidence-clip');
  assert.equal(evidenceClipView(model).media.tag, 'video');
  assert.deepEqual(model.events.map((e) => e.name), ['enter', 'source', 'focus-0', 'click-1']);
});

test('evidence-clip is registered in both renderers and the planner', () => {
  assert.equal(typeof MODULES['evidence-clip'].resolve, 'function');
  assert.match(readFileSync(path.join(ROOT, 'kit/remotion/catalog/registry-d.ts'), 'utf8'), /'evidence-clip': EvidenceClip/);
  assert.match(readFileSync(path.join(ROOT, 'skills/launchclip-create-video/references/storyboard-modules.md'), 'utf8'), /### evidence-clip \(keeps captions\)/);
});
