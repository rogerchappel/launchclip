// Catalogue H charts (kit/core/catalog-h-charts.mjs, catalog-h-flows.mjs):
// registration, variants, data validation, build timing and number formats.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MODULES, VARIANTS, catalogHStyle, catalogHTimeline, catalogHView, cssProps} from '../kit/core/catalog-h.mjs';
import {numberFormat, seriesColors, contrastRatio} from '../kit/core/catalog-h-base.mjs';
import {makeCheck} from '../kit/core/catalog-b-base.mjs';
import {frameState} from '../kit/core/catalog-b-view.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-h.mjs';
import {hyperframesEmitters} from '../kit/hyperframes/story-compiler.mjs';
import {knownModules} from '../kit/core/modules.mjs';
import {SAMPLES} from '../scripts/element-samples.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const FORMATS = {'9:16': {width: 1080, height: 1920, fps: 30}, '16:9': {width: 1920, height: 1080, fps: 30}};
const ctx = (aspect = '9:16', overrides = {}) => ({id: 'scene', start: 1, duration: 5, format: FORMATS[aspect], brand, aspect, hits: [], ...overrides});
const resolve = (id, params = SAMPLES[id], aspect, overrides) => ({...MODULES[id].resolve(params, ctx(aspect, overrides)), module: id});
const CHARTS = ['bar-chart', 'stacked-bar', 'pie-chart', 'area-chart', 'scatter-plot', 'radar-chart', 'sparkline', 'progress-ring', 'funnel-chart', 'waterfall', 'sankey', 'heatmap', 'leaderboard', 'comparison-table'];

test('every chart is registered in the module registry and both renderers', () => {
  const registry = readFileSync(new URL('../kit/remotion/modules/index.ts', import.meta.url), 'utf8');
  assert.match(registry, /registry-h/);
  for (const id of CHARTS) {
    assert.ok(knownModules().includes(id), id);
    assert.ok(EMITTERS[id] && hyperframesEmitters()[id], id);
    assert.ok(SAMPLES[id], `${id} has sample params`);
    assert.ok(MODULES[id].describe && MODULES[id].params && MODULES[id].events.includes('build'), id);
  }
});

test('every variant of every chart resolves in both aspects and settles cleanly', () => {
  for (const id of CHARTS) {
    assert.ok(Array.isArray(VARIANTS[id]) && VARIANTS[id].length >= 2, `${id} has variants`);
    for (const variant of VARIANTS[id]) for (const aspect of ['9:16', '16:9']) {
      const model = resolve(id, {...SAMPLES[id], variant}, aspect);
      assert.equal(model.variant, variant);
      const out = EMITTERS[id](model);
      assert.doesNotMatch(out.html + out.motion, /undefined|NaN/, `${id}/${variant} ${aspect}`);
      // Settled: nothing blurred, nothing still clipped shut, every element in the rect's frame.
      const state = frameState(catalogHTimeline(model), model.motion.exitStart - 0.01);
      for (const [target, props] of state) {
        if (props.blur !== undefined) assert.equal(props.blur, 0, `${id}/${variant}: ${target} blurred at settle`);
        if (props.clipR !== undefined) assert.equal(props.clipR + props.clipT, 0, `${id}/${variant}: ${target} clipped at settle`);
      }
      assert.ok(model.rect.x >= model.safe.x - 1e-6 && model.rect.y + model.rect.height <= model.safe.y + model.safe.height + 1e-6, `${id} stays in the safe zone`);
    }
  }
});

test('a variant comes from params, then the style, then the first', () => {
  assert.equal(resolve('bar-chart').variant, 'columns');
  assert.equal(resolve('bar-chart', SAMPLES['bar-chart'], '9:16', {variants: {'bar-chart': 'lollipop'}}).variant, 'lollipop');
  assert.equal(resolve('bar-chart', {...SAMPLES['bar-chart'], variant: 'bars'}, '9:16', {variants: {'bar-chart': 'lollipop'}}).variant, 'bars');
  assert.throws(() => resolve('bar-chart', {...SAMPLES['bar-chart'], variant: 'spiral'}), /params\.variant must be one of columns, bars, lollipop, blocks/);
  assert.throws(() => resolve('pie-chart', SAMPLES['pie-chart'], '9:16', {variants: {'pie-chart': 'spiral'}}), /style variants\.pie-chart/);
});

test('bar-chart: bars grow from zero to their values, counting, and the highlight dims the rest', () => {
  const model = resolve('bar-chart', SAMPLES['bar-chart'], '16:9');
  const ops = catalogHTimeline(model);
  const {buildAt, highlightAt} = model.content;
  assert.equal(frameState(ops, buildAt - 0.01).get('scene-bar-0').scaleY, 0);
  const settled = frameState(ops, model.motion.exitStart - 0.01);
  assert.equal(settled.get('scene-bar-0').scaleY, 1);
  assert.equal(settled.get('scene-value-2').text, '1,610');
  assert.ok(settled.get('scene-bar-0').opacity < 0.5, 'other bars dim');
  assert.equal(settled.get('scene-bar-2').opacity, undefined, 'the highlight keeps full opacity');
  assert.ok(highlightAt > model.content.buildAt);
  assert.deepEqual(model.events.map(e => e.name), ['enter', 'build', 'highlight']);
  // Long labels in a narrow frame turn the columns sideways.
  const long = resolve('bar-chart', {data: [{label: 'Engineering hours', value: 3}, {label: 'Design reviews', value: 2}, {label: 'Customer calls', value: 5}, {label: 'Release notes', value: 1}, {label: 'Support tickets', value: 4}, {label: 'Onboarding docs', value: 2}]});
  assert.equal(long.content.layout, 'horizontal');
  assert.throws(() => resolve('bar-chart', {data: [{label: 'A', value: 1}]}), /params\.data must be an array of 2–10/);
  assert.throws(() => resolve('bar-chart', {data: [{label: 'A', value: -1}, {label: 'B', value: 2}]}), /params\.data\[0\]\.value/);
});

test('pie-chart: slices sweep on in order as one turn and the centre counts to the total', () => {
  const model = resolve('pie-chart');
  const slices = model.content.slices;
  for (let i = 1; i < slices.length; i++) assert.ok(Math.abs(slices[i].time - (slices[i - 1].time + slices[i - 1].duration)) < 1e-3, 'each slice starts where the last ends');
  const settled = frameState(catalogHTimeline(model), model.motion.exitStart - 0.01);
  for (let i = 0; i < slices.length; i++) assert.equal(settled.get(`scene-slice-${i}`).strokeDashoffset, 0);
  assert.equal(settled.get('scene-center').text, '100');
  assert.equal(resolve('pie-chart', {...SAMPLES['pie-chart'], variant: 'pie'}).content.center, null, 'a full pie has no centre');
});

test('progress-ring fills to its fraction and counts to the exact value', () => {
  const model = resolve('progress-ring');
  const settled = frameState(catalogHTimeline(model), model.motion.exitStart - 0.01);
  assert.ok(Math.abs(settled.get('scene-arc').strokeDashoffset - 0.13) < 1e-6);
  assert.equal(settled.get('scene-value').text, '87%');
  const segmented = resolve('progress-ring', {...SAMPLES['progress-ring'], variant: 'segmented'});
  assert.equal(segmented.content.segments.filter(s => s.on).length, 35);
  assert.throws(() => resolve('progress-ring', {value: 120, label: 'Too much'}), /params\.value/);
});

test('waterfall steps from each level and turns sideways in portrait', () => {
  const wide = resolve('waterfall', SAMPLES['waterfall'], '16:9');
  assert.equal(wide.content.layout, 'vertical');
  assert.deepEqual(wide.content.bars.map(b => b.text), ['4.2K', '+1.8K', '+950', '−620', '−410', '5.9K']);
  assert.equal(resolve('waterfall').content.layout, 'horizontal');
});

test('sankey places nodes in columns by the longest path and refuses loops', () => {
  const model = resolve('sankey', SAMPLES['sankey'], '16:9');
  const columns = Object.fromEntries(model.content.nodes.map(n => [n.name, n.k]));
  assert.deepEqual([columns.Prompt, columns.Motion, columns.Shorts], [0, 1, 2]);
  assert.throws(() => resolve('sankey', {flows: [{from: 'A', to: 'B', value: 1}, {from: 'B', to: 'A', value: 1}]}), /loop back|at most 4 columns/);
});

test('leaderboard ranks by value and lands from last place to first', () => {
  const model = resolve('leaderboard');
  assert.deepEqual(model.content.rows.map(r => r.label), ['Product launch', 'Explainer', 'Changelog', 'Talking head', 'Lyric video']);
  const times = model.content.rows.map(r => r.time);
  assert.ok(times.every((t, i) => i === 0 || t < times[i - 1]), 'first place lands last');
  assert.throws(() => resolve('leaderboard', {entries: [{label: 'A', value: 1, icon: 'not-an-icon'}, {label: 'B', value: 2}, {label: 'C', value: 3}]}), /icon/);
});

test('comparison-table checks every row against the columns', () => {
  assert.throws(() => resolve('comparison-table', {columns: ['A', 'B'], rows: [{label: 'x', values: [true]}, {label: 'y', values: [true, false]}]}), /params\.rows\[0\]\.values/);
  const model = resolve('comparison-table', SAMPLES['comparison-table'], '16:9');
  assert.match(EMITTERS['comparison-table'](model).html, /id="scene-focus"/);
});

test('number formats are deterministic: currency, percent, unit, compact', () => {
  const check = makeCheck('');
  const f = raw => numberFormat(check, raw).format;
  assert.equal(f({currency: 'USD'})(1400), '$1,400');
  assert.equal(f({style: 'currency', currency: 'EUR', decimals: 2})(-12.5), '−€12.50');
  assert.equal(f({style: 'percent', decimals: 1})(87.25), '87.3%');
  assert.equal(f({unit: 'ms'})(240), '240 ms');
  assert.equal(f({unit: '°C'})(21), '21°C');
  assert.equal(f({compact: true, decimals: 1})(48200), '48.2K');
  assert.equal(f({compact: true, decimals: 1})(860), '860');
  assert.equal(f({compact: true, decimals: 1, currency: 'GBP'})(3_100_000), '£3.1M');
  assert.equal(f({separator: false})(12000), '12000');
  assert.throws(() => f({style: 'unit'}), /unit is required/);
  assert.throws(() => f({currency: 'XYZ'}), /currency/);
});

test('the series palette keeps graphics contrast on the background', () => {
  for (const color of seriesColors(brand.colors, 10)) assert.ok(contrastRatio(color, brand.colors.bg) >= 3, color);
});

test('blur and clip props become CSS for GSAP and for Remotion alike', () => {
  assert.deepEqual(cssProps({opacity: 1, blur: 6, clipT: 0, clipR: 40, clipB: 0, clipL: 0}), {opacity: 1, filter: 'blur(6px)', clipPath: 'inset(0% 40% 0% 0%)'});
  assert.deepEqual(catalogHStyle({blur: 0, clipT: 0, clipR: 0, clipB: 0, clipL: 0}), {filter: 'blur(0px)', clipPath: 'inset(0% 0% 0% 0%)'});
  assert.throws(() => cssProps({clipR: 10}), /all of clipT/);
  assert.ok(catalogHView(resolve('area-chart')).children.length > 0);
});
