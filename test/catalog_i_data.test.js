// Catalogue I data modules (kit/core/catalog-i-data.mjs): race-bars and
// small-multiples, their timing, settled frames and validation. The shared
// variant, aspect and renderer checks for every catalogue I module are in
// test/catalog_i_explain.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MODULES, catalogHTimeline} from '../kit/core/catalog-h.mjs';
import {frameState} from '../kit/core/catalog-b-view.mjs';
import {SAMPLES} from '../scripts/element-samples.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const FORMATS = {'9:16': {width: 1080, height: 1920, fps: 30}, '16:9': {width: 1920, height: 1080, fps: 30}};
const resolve = (id, params = SAMPLES[id], aspect = '16:9', overrides = {}) => ({...MODULES[id].resolve(params, {id: 'scene', start: 1, duration: 6, format: FORMATS[aspect], brand, aspect, hits: [], ...overrides}), module: id});
const at = (model, t) => frameState(catalogHTimeline(model), t);

test('race-bars: rows fill at their own speeds, the fastest finishes first, the badge says how much faster', () => {
  const model = resolve('race-bars');
  const c = model.content;
  assert.equal(c.badge.text, '3× faster', '126 / 42 min');
  const finish = i => model.events.find(e => e.name === `finish-${i}`).time;
  assert.ok(finish(2) < finish(1) && finish(1) < finish(0));
  assert.ok(Math.abs((finish(0) - c.raceAt) / (finish(2) - c.raceAt) - 3) < 0.01, 'finish times keep the ratio');
  assert.ok(model.events.find(e => e.name === 'badge').time >= finish(2));
  const mid = at(model, finish(2));
  assert.ok(Math.abs(mid.get('scene-fill-2').scaleX - 1) < 1e-6);
  assert.ok(Math.abs(mid.get('scene-fill-0').scaleX - 1 / 3) < 0.02, 'the slowest is a third of the way');
  const end = at(model, model.motion.exitStart - 0.01);
  assert.equal(end.get('scene-timer-0').text, '126 min');
  assert.equal(end.get('scene-badge').opacity, 1);
  assert.equal(resolve('race-bars', {...SAMPLES['race-bars'], badge: false}).content.badge, null);
  assert.throws(() => resolve('race-bars', {rows: [{label: 'A', time: 1}]}), /params\.rows must be an array of 2–5/);
  assert.throws(() => resolve('race-bars', {...SAMPLES['race-bars'], race: 10}), /params\.race/);
});

test('small-multiples: bars grow panel by panel, then each panel lights its winner', () => {
  const model = resolve('small-multiples');
  const c = model.content;
  assert.deepEqual(c.panels.map(p => p.highlight), [0, 0, 0, 0]);
  assert.ok(c.panels[1].t0 > c.panels[0].t0);
  assert.ok(c.highlightAt >= c.buildEnd - 1e-6);
  const end = at(model, model.motion.exitStart - 0.01);
  assert.equal(end.get('scene-m0-glow-0').opacity, 1);
  assert.equal(end.get('scene-m0-bar-1').opacity, 0.38);
  assert.equal(end.get('scene-m0-val-0').opacity, 1);
  assert.deepEqual(resolve('small-multiples', SAMPLES['small-multiples'], '9:16').content.panels.map(p => p.box.x > 0), [false, true, false, true], 'two columns in portrait');
  assert.throws(() => resolve('small-multiples', {series: ['A', 'B'], panels: [{title: 'X', values: [1]}, {title: 'Y', values: [1, 2]}]}), /params\.panels\[0\]\.values must be an array of 2–2/);
});
