// Footage checklist mode (kit/core/modules.mjs): with a measured presenter, a
// checklist without a rect sits above their head or on their chest, at a size
// whose text stays legal; without one it is placed exactly as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveStory} from '../kit/core/story.mjs';
import {resolveModule} from '../kit/core/modules.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const rows = [{label: 'Drop in your clip', status: 'active', at: 0.3, doneAt: 0.9}, {label: 'Ship the video', status: 'active', at: 1.0, doneAt: 1.6}];

function story(head, {subject = true, lane = 'footage-led'} = {}) {
  const summary = {source: {width: 1080, height: 1920}, framing: 'medium', head, body: {x: 0.5, y: 0.7, w: 0.6, h: 0.6}, headroom: head.y - head.h / 2};
  return resolveStory({schema: 'launchclip.story.v1', lane, format: {width: 1080, height: 1920, fps: 30, duration: 6}, brand,
    base: subject ? {src: 'assets/r.mp4', subject: {mattes: [{src: 'assets/subject/a.webm', in: 0, out: 6, summary}]}} : {src: 'assets/r.mp4'},
    scenes: [{id: 'steps', module: 'checklist', track: 1, start: 1, end: 4, params: {title: 'All you need to do', rows}}]});
}
const model = (value) => resolveModule(value.scenes[0], value);

test('with headroom the card sits above the head', () => {
  // Head centred low: y 0.62 → top 1075 px.
  const m = model(story({x: 0.5, y: 0.62, w: 0.22, h: 0.13}));
  assert.equal(m.subjectPlacement, 'above-head');
  assert.ok(m.rect.y + m.rect.height <= 0.555 * 1920 - 16 + 1e-6, 'ends above the head');
});

test('without headroom the card sits on the chest, above the caption band', () => {
  const m = model(story({x: 0.5, y: 0.3, w: 0.27, h: 0.24}));
  assert.equal(m.subjectPlacement, 'chest');
  assert.ok(m.rect.y >= (0.3 + 0.12) * 1920 + 16 - 1e-6, 'starts below the head');
  assert.ok(m.rect.y + m.rect.height <= 1190 - 16 + 1e-6, 'ends above the caption band');
  assert.ok(m.minTextPx >= 32 - 1e-6, `body text stays legal (${m.minTextPx})`);
});

test('no room anywhere keeps the derived card and says so', () => {
  const m = model(story({x: 0.5, y: 0.4, w: 0.4, h: 0.45}));
  assert.equal(m.subjectPlacement, 'none');
  assert.deepEqual(m.rect, model(story({x: 0.5, y: 0.4, w: 0.4, h: 0.45}, {subject: false})).rect);
});

test('without a measured presenter nothing changes', () => {
  const m = model(story({x: 0.5, y: 0.3, w: 0.27, h: 0.24}, {subject: false}));
  assert.equal(m.subjectPlacement, undefined);
  const explicit = story({x: 0.5, y: 0.3, w: 0.27, h: 0.24});
  explicit.scenes[0].params.rect = {x: 120, y: 300, width: 840, height: 480};
  assert.equal(model(explicit).subjectPlacement, undefined, 'an explicit rect wins');
});
