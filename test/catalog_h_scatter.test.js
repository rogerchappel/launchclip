// Catalogue H scatter-plot (kit/core/catalog-h-scatter.mjs): series drawn on
// in order, the focus glow, annotations as reveal ids, log axes and the
// two-panel compare layout; the legacy points form still resolves.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MODULES, catalogHTimeline, catalogHView} from '../kit/core/catalog-h.mjs';
import {frameState} from '../kit/core/catalog-b-view.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-h.mjs';
import {EXTRA_SAMPLES, SAMPLES} from '../scripts/element-samples.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const FORMATS = {'9:16': {width: 1080, height: 1920, fps: 30}, '16:9': {width: 1920, height: 1080, fps: 30}};
const ctx = (aspect = '16:9', overrides = {}) => ({id: 'scene', start: 1, duration: 6, format: FORMATS[aspect], brand, aspect, hits: [], ...overrides});
const resolve = (params = SAMPLES['scatter-plot'], aspect, overrides) => ({...MODULES['scatter-plot'].resolve(params, ctx(aspect, overrides)), module: 'scatter-plot'});
const settled = model => frameState(catalogHTimeline(model), model.motion.exitStart - 0.01);
const extra = name => EXTRA_SAMPLES.find(entry => entry.name === name).params;

test('scatter-plot: series draw on in order, then the focus, then each annotation on its reveal id', () => {
  const model = resolve();
  const names = model.events.map(e => e.name);
  assert.deepEqual(names, ['enter', 'build', 'series-0', 'series-1', 'focus', 'reveal-best', 'reveal-next', 'reveal-cheap']);
  const times = model.events.map(e => e.time);
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
  assert.ok(model.events.at(-1).time <= model.start + model.duration - 0.6, 'the last reveal leaves room before the exit');
  const state = settled(model);
  assert.equal(state.get('scene-s-0-wrap').opacity, 0.3, 'the other series dims');
  assert.equal(state.get('scene-s-1-glow').opacity, 0.75, 'the focus series glows');
  assert.equal(state.get('scene-s-1-line').strokeDashoffset, 0, 'lines are drawn by the end');
  for (const part of ['v', 'h']) assert.equal(state.get(`scene-n-best-${part}`).clipB + state.get(`scene-n-best-${part}`).clipL, 0, `guide ${part} drawn`);
  assert.equal(state.get('scene-n-next-dot').opacity, 1);
  assert.equal(state.get('scene-n-cheap-card').opacity, 1);
  const out = EMITTERS['scatter-plot'](model);
  assert.doesNotMatch(out.html + out.motion, /undefined|NaN/);
});

test('scatter-plot: hits and at time the cues; annotations reveal one by one', () => {
  const model = resolve({...SAMPLES['scatter-plot'], annotations: [{type: 'guide', id: 'best', series: 1, index: 2, at: 3}, {type: 'placeholder', id: 'next', x: 60, y: 88}]}, '16:9', {hits: [{event: 'reveal-next', at: 4.5}]});
  assert.equal(model.events.find(e => e.name === 'reveal-best').time, 4);
  assert.equal(model.events.find(e => e.name === 'reveal-next').time, 4.5);
  const before = frameState(catalogHTimeline(model), 4.4);
  assert.equal(before.get('scene-n-next-dot').opacity, 0, 'the placeholder waits for its cue');
});

test('scatter-plot: log axes tick by decade and place values on the log scale', () => {
  const model = resolve();
  const c = model.content;
  assert.deepEqual(c.xTicks.map(t => t.text), ['$0.1', '$1', '$10', '$100']);
  const xs = c.panels[0].xTickX;
  assert.ok(Math.abs((xs[1] - xs[0]) - (xs[2] - xs[1])) < 0.05, 'decades are evenly spaced');
  assert.throws(() => resolve({series: [{points: [{x: 0, y: 1}, {x: 2, y: 3}]}], x: {scale: 'log'}}), /"log" needs positive values/);
});

test('scatter-plot: two panels sit side by side in landscape and stack in portrait', () => {
  const land = resolve(extra('scatter-plot-compare'), '16:9');
  const [a, b] = land.content.panels.map(p => p.box);
  assert.equal(a.y, b.y);
  assert.ok(b.x >= a.x + a.width, 'side by side');
  assert.ok(land.events.some(e => e.name === 'panel-1'));
  assert.deepEqual(land.events.filter(e => e.name.startsWith('series-')).map(e => e.name), ['series-0', 'series-1', 'series-2', 'series-3']);
  const port = resolve(extra('scatter-plot-compare'), '9:16');
  const [c, d] = port.content.panels.map(p => p.box);
  assert.ok(d.y >= c.y + c.height, 'stacked');
  const state = settled(land);
  assert.equal(state.get('scene-s-2-wrap').opacity, 0.3, 'the focus applies in both panels');
});

test('scatter-plot: the legacy points form keeps its trend and highlight', () => {
  const model = resolve(extra('scatter-plot-points'), '9:16');
  assert.deepEqual(model.events.map(e => e.name), ['enter', 'build', 'highlight']);
  assert.ok(model.content.trendLine);
  assert.equal(settled(model).get('scene-callout').opacity, 1);
});

test('scatter-plot: params are validated', () => {
  assert.throws(() => resolve({}), /needs exactly one of points, series or panels/);
  assert.throws(() => resolve({series: [{points: [{x: 1, y: 1}]}], focus: 0}), /params\.focus needs at least two series/);
  assert.throws(() => resolve({...SAMPLES['scatter-plot'], annotations: [{type: 'callout', series: 0, index: 0}]}), /text is required for a callout/);
  assert.throws(() => resolve({...SAMPLES['scatter-plot'], annotations: [{type: 'guide', id: 'a'}, {type: 'guide', id: 'a', series: 0}]}), /needs series and index, or x and y|repeats "a"/);
  assert.throws(() => resolve({...SAMPLES['scatter-plot'], annotations: [{type: 'placeholder', x: 500, y: 50}]}), /params\.x\.max must be between 500/);
  assert.throws(() => resolve({...SAMPLES['scatter-plot'], annotations: [{type: 'guide', id: 'Bad id', series: 0, index: 0}]}), /lowercase letters/);
  // Every node a tween targets is in the view.
  const ids = [];
  const walk = node => { if (node && typeof node === 'object') { if (node.id) ids.push(node.id); (node.children ?? []).forEach(walk); } };
  const model = resolve();
  walk(catalogHView(model));
  for (const target of new Set(catalogHTimeline(model).map(op => op.target))) assert.ok(ids.includes(target), target);
});
