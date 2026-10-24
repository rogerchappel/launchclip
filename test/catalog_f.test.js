// Catalogue F (kit/core/catalog-f.mjs): the creative set around the presenter.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {MODULES, catalogFTimeline, catalogFView} from '../kit/core/catalog-f.mjs';
import {frameState} from '../kit/core/catalog-b-view.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-f.mjs';
import {knownModules} from '../kit/core/modules.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const subject = {available: true, framing: 'medium', head: {x: 420, y: 560, width: 240, height: 300}, placement: 'measured'};
const ctx = (overrides = {}) => ({id: 'scene', start: 1, duration: 4, format: {width: 1080, height: 1920, fps: 30, duration: 30}, brand, aspect: '9:16', subject, ...overrides});
const resolve = (id, params, overrides) => ({...MODULES[id].resolve(params, ctx(overrides)), module: id});
const ITEMS = [{text: 'Saved me ten hours a week'}, {image: 'assets/app.png'}, {text: 'Shipped in a day'}, {text: 'The edit I wanted'}];

const IDS = ['glass-word', 'orbit-cards'];

test('catalogue F is registered in the module registry, HyperFrames and Remotion', () => {
  for (const id of IDS) assert.ok(knownModules().includes(id), id);
  assert.deepEqual(Object.keys(EMITTERS).sort(), [...IDS].sort());
  const registry = readFileSync(fileURLToPath(new URL('../kit/remotion/catalog/registry-f.ts', import.meta.url)), 'utf8');
  for (const id of IDS) assert.match(registry, new RegExp(`'${id}': \\w+`));
});

test('glass-word sits behind the head at head height and sweeps once', () => {
  const model = resolve('glass-word', {word: 'design'});
  assert.equal(model.layer, 'behind');
  assert.equal(model.content.word, 'DESIGN');
  const centre = model.rect.y + model.rect.height / 2;
  assert.ok(Math.abs(centre - (560 + 150)) < 1, 'centred on the head');
  const ops = catalogFTimeline(model);
  const band = (t) => frameState(ops, t).get('scene-band')?.x;
  assert.equal(band(1.5), 0);
  assert.ok(band(model.content.sweepAt + 0.9) > model.rect.width, 'the band crosses the whole word');
  assert.equal(frameState(ops, model.content.sweepAt + 0.9).get('scene-band-text').x, -band(model.content.sweepAt + 0.9), 'its text counter-moves');
  assert.equal(resolve('glass-word', {word: 'ai', sweep: false}).events.length, 1);
  assert.throws(() => resolve('glass-word', {word: 'two words'}), /one word/);
});

test('orbit-cards: real items only, and each card shows in exactly one part', () => {
  const model = resolve('orbit-cards', {items: ITEMS});
  assert.equal(model.layer, 'split');
  const ops = catalogFTimeline(model);
  for (const t of [2, 2.7, 3.4]) {
    const state = frameState(ops, t);
    for (const item of model.content.items) {
      const far = state.get(`scene-far-${item.index}`).opacity, near = state.get(`scene-near-${item.index}`).opacity;
      assert.ok(far === 0 || near === 0, `card ${item.index} is in one part at ${t}`);
      assert.ok(far > 0 || near > 0, `card ${item.index} is visible at ${t}`);
    }
  }
  const nearScales = model.content.tracks.flat().filter((s) => s.near).map((s) => s.scale);
  const farScales = model.content.tracks.flat().filter((s) => !s.near).map((s) => s.scale);
  assert.ok(Math.min(...nearScales) >= Math.max(...farScales) - 1e-6, 'near cards are larger');
  assert.throws(() => resolve('orbit-cards', {items: [{}, {}, {}]}), /needs an image or text/);
  assert.throws(() => resolve('orbit-cards', {items: ITEMS.slice(0, 2)}), /params\.items/);
  assert.throws(() => resolve('orbit-cards', {items: [{image: 'assets/clip.mp4'}, ...ITEMS.slice(0, 2)]}), /must be an image/);
  const view = catalogFView(model);
  assert.ok(view.front && view.behind);
  const out = EMITTERS['orbit-cards'](model);
  assert.match(out.behind.html, /id="scene-far-0"/);
  assert.match(out.html, /id="scene-near-0"/);
});
