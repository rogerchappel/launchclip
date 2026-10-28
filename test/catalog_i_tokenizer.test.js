// Catalogue I the tokenizer (kit/core/catalog-i-tokenizer.mjs) and its BPE
// precompute helper (src/tokenizer.js): params, defaults, paint plans, both
// renderers' output and the settled frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MODULES, VARIANTS, catalogHTimeline, catalogHView} from '@launchclip/core/catalog-h.mjs';
import {perTokenPrice} from '@launchclip/core/catalog-i-tokenizer.mjs';
import {PAINT_KINDS, PARTICLE_RUNTIME} from '@launchclip/core/particles.mjs';
import {frameState} from '@launchclip/core/catalog-b-view.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-h.mjs';
import {hyperframesEmitters} from '../kit/hyperframes/story-compiler.mjs';
import {knownModules} from '@launchclip/core/modules.mjs';
import {EXTRA_SAMPLES, SAMPLES} from '../scripts/element-samples.mjs';
import {tokenize} from '../src/tokenizer.js';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const light = {colors: {bg: '#f5f1e8', primary: '#b7791f', accent: '#1f6feb', ink: '#f5f1e8', paper: '#14161c'}, fonts: brand.fonts};
const FORMATS = {'9:16': {width: 1080, height: 1920, fps: 30}, '16:9': {width: 1920, height: 1080, fps: 30}};
const ctx = (aspect = '16:9', overrides = {}) => ({id: 'scene', start: 1, duration: 6, format: FORMATS[aspect], brand, aspect, hits: [], ...overrides});
const resolve = (id, params = SAMPLES[id], aspect, overrides) => ({...MODULES[id].resolve(params, ctx(aspect, overrides)), module: id});
const IDS = ['tokenizer'];


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

test('the tokenizer is all DOM: no painter on the page', () => {
  assert.doesNotMatch(EMITTERS.tokenizer(resolve('tokenizer')).motion, /lcPaintParticles/);
});

test('tokenizer: chips join back to the text, per-token prices, counts and totals', () => {
  assert.equal(perTokenPrice(10), '$0.00001');
  assert.equal(perTokenPrice(5), '$0.000005');
  assert.equal(perTokenPrice(15000000), '$15.00');
  const model = resolve('tokenizer');
  const c = model.content;
  assert.deepEqual(c.chips.items.map(i => i.shown), ['Ter', 'ra', 'continues', 'to', 'advance', 'the', 'cost', '-int', 'elligence', 'frontier']);
  assert.equal(c.tokenCount, 10);
  assert.equal(c.charCount, 57);
  assert.deepEqual(c.models.map(m => m.samples.at(-1).text), ['$10.00', '$5.00']);
  assert.deepEqual(c.models.map(m => m.fill), [1, 0.5]);
  assert.equal(c.outSamples.at(-1).text, '1,000,000');
  assert.throws(() => resolve('tokenizer', {...SAMPLES.tokenizer, tokens: ['Terra']}), /must join back to params\.text exactly/);
});

test('src/tokenizer.js precomputes a real BPE split', async () => {
  assert.deepEqual(await tokenize('Terra continues to advance the cost-intelligence frontier'), SAMPLES.tokenizer.tokens);
  const cl = await tokenize('Terra continues', {encoding: 'cl100k_base'});
  assert.equal(cl.join(''), 'Terra continues');
  await assert.rejects(() => tokenize('x', {encoding: 'p50k'}), /encoding must be one of/);
});
