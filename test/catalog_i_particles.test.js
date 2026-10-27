// Catalogue I particles (kit/core/catalog-i-particles.mjs): dot-field, particle-text,
// particle-logo and particle-cloud on the particle engine: params, defaults, paint plans, both
// renderers' output and the settled frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MODULES, VARIANTS, catalogHTimeline, catalogHView} from '../kit/core/catalog-h.mjs';
import {PAINT_KINDS, PARTICLE_RUNTIME} from '../kit/core/particles.mjs';
import {frameState} from '../kit/core/catalog-b-view.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-h.mjs';
import {hyperframesEmitters} from '../kit/hyperframes/story-compiler.mjs';
import {knownModules} from '../kit/core/modules.mjs';
import {EXTRA_SAMPLES, SAMPLES} from '../scripts/element-samples.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const light = {colors: {bg: '#f5f1e8', primary: '#b7791f', accent: '#1f6feb', ink: '#f5f1e8', paper: '#14161c'}, fonts: brand.fonts};
const FORMATS = {'9:16': {width: 1080, height: 1920, fps: 30}, '16:9': {width: 1920, height: 1080, fps: 30}};
const ctx = (aspect = '16:9', overrides = {}) => ({id: 'scene', start: 1, duration: 6, format: FORMATS[aspect], brand, aspect, hits: [], ...overrides});
const resolve = (id, params = SAMPLES[id], aspect, overrides) => ({...MODULES[id].resolve(params, ctx(aspect, overrides)), module: id});
const IDS = ['dot-field', 'particle-text', 'particle-logo', 'particle-cloud'];
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

test('dot-field: one dot per unit, a counter that lands on the count, a pull-back from close-up dots', () => {
  const model = resolve('dot-field');
  const layer = model.content.paint['scene-paint'].layers[0];
  assert.equal(layer.kind, 'field');
  assert.equal(layer.count, 1050000);
  assert.ok(layer.cols * layer.rows >= 1050000 && (layer.cols * (layer.rows - 1)) < 1050000);
  assert.equal(model.content.samples.at(-1).text, '1,050,000');
  assert.ok(layer.zoom[0].s > 3 && layer.zoom.at(-1).s === 1, 'starts close, ends on the whole field');
  assert.equal(resolve('dot-field', {...SAMPLES['dot-field'], variant: 'still'}).content.paint['scene-paint'].layers[0].zoom.length, 1);
  assert.throws(() => resolve('dot-field', {count: 3_000_000}), /params\.count/);
});

test('particle-text, particle-logo and particle-cloud validate what they draw', () => {
  assert.throws(() => resolve('particle-text', {text: 'café'}), /dot-matrix face does not draw/);
  assert.throws(() => resolve('particle-text', {text: '42', dissolveAt: 3}), /needs params\.mode "dissolve" or "both"/);
  const both = resolve('particle-text', {...SAMPLES['particle-text'], mode: 'both'});
  assert.deepEqual(both.events.map(e => e.name).filter(n => n !== 'enter'), ['assemble', 'dissolve']);
  assert.throws(() => resolve('particle-logo', {logos: [{label: 'X'}]}), /needs exactly one of icon or path/);
  assert.throws(() => resolve('particle-logo', {logos: [{label: 'X', path: {d: 'M0 0 url(x)', viewBox: '0 0 24 24'}}]}), /must be SVG path data/);
  const custom = resolve('particle-logo', {logos: [{label: 'Mark', path: {d: 'M2 2h20v20H2z', viewBox: '0 0 24 24'}}]});
  const layers = custom.content.paint['scene-paint'].layers;
  assert.deepEqual(layers.map(l => `${l.kind}${l.half ? `:${l.half}` : ''}`), ['ring:back', 'swarm', 'ring:front']);
  assert.equal(layers[1].shape.mode, 'fill');
  assert.equal(resolve('particle-cloud', {...SAMPLES['particle-cloud'], variant: 'single'}).content.boxes.length, 1, 'single draws the target alone');
  const cloud = resolve('particle-cloud');
  assert.ok(cloud.content.paint['scene-paint'].layers[0].from, 'the cloud streams up from the first step');
});

