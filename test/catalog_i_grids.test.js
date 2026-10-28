// Catalogue I unit grids at scale (kit/core/catalog-i-grids.mjs): grid-race and
// cell-grid: params, defaults, paint plans, both
// renderers' output and the settled frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MODULES, VARIANTS, catalogHTimeline, catalogHView} from '@launchclip/core/catalog-h.mjs';
import {MAX_CELLS, fitCells} from '@launchclip/core/catalog-i-grids.mjs';
import {PAINT_KINDS, PARTICLE_RUNTIME} from '@launchclip/core/particles.mjs';
import {frameState} from '@launchclip/core/catalog-b-view.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-h.mjs';
import {hyperframesEmitters} from '../kit/hyperframes/story-compiler.mjs';
import {knownModules} from '@launchclip/core/modules.mjs';
import {EXTRA_SAMPLES, SAMPLES} from '../scripts/element-samples.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const light = {colors: {bg: '#f5f1e8', primary: '#b7791f', accent: '#1f6feb', ink: '#f5f1e8', paper: '#14161c'}, fonts: brand.fonts};
const FORMATS = {'9:16': {width: 1080, height: 1920, fps: 30}, '16:9': {width: 1920, height: 1080, fps: 30}};
const ctx = (aspect = '16:9', overrides = {}) => ({id: 'scene', start: 1, duration: 6, format: FORMATS[aspect], brand, aspect, hits: [], ...overrides});
const resolve = (id, params = SAMPLES[id], aspect, overrides) => ({...MODULES[id].resolve(params, ctx(aspect, overrides)), module: id});
const IDS = ['grid-race', 'cell-grid'];
const PAINTED = IDS.filter(id => id !== 'tokenizer');

test('catalogue I modules are registered in the registry, both renderers and the samples', () => {
  const remotion = readFileSync(new URL('../kit/remotion/catalog/CatalogH.tsx', import.meta.url), 'utf8');
  assert.match(remotion, /PaintCanvas/, 'Remotion paints canvases with paint plans');
  for (const id of IDS) {
    assert.ok(knownModules().includes(id), id);
    assert.ok(EMITTERS[id] && hyperframesEmitters()[id], id);
    assert.ok(SAMPLES[id], id);
  }
});

test('every variant resolves in both aspects, on dark and light brands, inside its rect, with the same ids in both renderers', () => {
  for (const id of IDS) for (const variant of VARIANTS[id]) for (const aspect of ['9:16', '16:9']) for (const b of [brand, light]) {
    const tag = `${id}/${variant} ${aspect} ${b.colors.bg}`;
    const model = resolve(id, {...SAMPLES[id], variant}, aspect, {brand: b});
    const out = EMITTERS[id](model);
    assert.doesNotMatch(out.html + out.motion.replace(PARTICLE_RUNTIME, ''), /undefined|NaN/, tag);
    assert.ok(model.minTextPx >= (aspect === '9:16' ? 44 : 32) - 1e-6, `${tag} key text ${model.minTextPx}`);
    const ids = [];
    const walk = node => { if (node && typeof node === 'object') { if (node.id) ids.push(node.id); (node.children ?? []).forEach(walk); } };
    walk(catalogHView(model));
    for (const target of new Set(catalogHTimeline(model).map(op => op.target))) assert.ok(ids.includes(target), `${tag}: op target ${target} is in the view`);
    for (const nodeId of ids) assert.ok(out.html.includes(`id="${nodeId}"`), `${tag}: ${nodeId} in the HyperFrames HTML`);
    for (const [canvasId, plan] of Object.entries(model.content.paint ?? {})) {
      assert.ok(ids.includes(canvasId), `${tag}: painted canvas ${canvasId} is in the view`);
      assert.match(out.motion, new RegExp(`getElementById\\("${canvasId}"\\)`), `${tag}: HyperFrames paints ${canvasId}`);
      assert.equal(plan.width, Math.ceil(model.rect.width));
      for (const layer of plan.layers) assert.ok(PAINT_KINDS.includes(layer.kind), `${tag}: ${layer.kind}`);
    }
    // Every DOM label settles inside the rect.
    const state = frameState(catalogHTimeline(model), model.motion.exitStart - 0.01);
    for (const [target, props] of state) if (props.clipR !== undefined) assert.equal(props.clipR, 0, `${tag}: ${target} still clipped`);
  }
  for (const extra of EXTRA_SAMPLES.filter(e => IDS.includes(e.module))) resolve(extra.module, {...extra.params, variant: extra.variant}, extra.shape === 'portrait' ? '9:16' : '16:9');
});

test('painted modules emit the painter once per page and drive each canvas from the timeline', () => {
  for (const id of PAINTED) {
    const out = EMITTERS[id](resolve(id));
    assert.match(out.motion, /window\.lcPaintParticles = window\.lcPaintParticles \|\|/, id);
    assert.match(out.motion, /onUpdate: function \(\) \{ window\.lcPaintParticles\(c2, plan, clock\.t\); \}/, id);
  }
});

test('grid-race: counters and cells finish together; same-rate finishes the smaller total first; empty slots show a shortfall', () => {
  const race = resolve('grid-race', {...SAMPLES['grid-race'], racers: [{label: 'A', total: 1000000}, {label: 'B', total: 960000}]});
  const grids = race.content.paint['scene-paint'].layers[0].grids;
  assert.deepEqual(grids.map(g => g.count), [100, 96]);
  assert.deepEqual(grids.map(g => g.slots), [100, 100]);
  assert.equal(grids[0].t1, grids[1].t1);
  assert.deepEqual(race.content.racers.map(r => r.samples.at(-1).text), ['1,000,000 tokens', '960,000 tokens']);
  const paced = resolve('grid-race', {...SAMPLES['grid-race'], pace: 'same-rate', racers: [{label: 'A', total: 1000000}, {label: 'B', total: 500000}]});
  const [a, b] = paced.content.paint['scene-paint'].layers[0].grids;
  assert.ok(b.t1 < a.t1);
  assert.equal(race.content.racers.length, 2);
  assert.throws(() => resolve('grid-race', {unit: 1, racers: [{label: 'A', total: MAX_CELLS + 1}, {label: 'B', total: 5}]}), /params\.racers\[0\]\.total/);
  assert.match(resolve('grid-race').content.racers[1].spendSamples.at(-1).text, /^spent \$5\.00$/);
});

test('cell-grid: one pitch for every grid, segments, ticks and a highlight', () => {
  const cost = resolve('cell-grid');
  const [small, big] = cost.content.paint['scene-paint'].layers[0].grids;
  assert.equal(small.cell, big.cell, 'heights compare');
  assert.ok(big.y < small.y, 'the bigger count stands taller');
  const money = EXTRA_SAMPLES.find(e => e.name === 'cell-grid-stacked-money');
  const m = resolve('cell-grid', money.params);
  assert.deepEqual(m.content.paint['scene-paint'].layers[0].grids[0].segs.map(s => [s.from, s.to]), [[0, 20], [20, 102]]);
  const ticks = resolve('cell-grid', EXTRA_SAMPLES.find(e => e.name === 'cell-grid-ticks').params, '9:16');
  const t = ticks.content.paint['scene-paint'].layers[0].grids;
  assert.deepEqual(t.map(g => [g.cols, g.tick.count]), [[10, 24], [10, 6]]);
  const hl = resolve('cell-grid', EXTRA_SAMPLES.find(e => e.name === 'cell-grid-highlight').params);
  assert.equal(hl.content.paint['scene-paint'].layers[0].grids[0].hl.to, 124);
  assert.throws(() => resolve('cell-grid', {legend: 'x', grids: [{label: 'A', count: 10, segments: [{count: 11, tone: 'good'}]}]}), /segments\[0\]\.count/);
  assert.deepEqual(fitCells(100, 100, 100), {cols: 10, rows: 10, pitch: 10});
});

