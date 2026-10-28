// Catalogue F (kit/core/catalog-f.mjs): the creative set around the presenter.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {MODULES, catalogFTimeline, catalogFView} from '@launchclip/core/catalog-f.mjs';
import {frameState} from '@launchclip/core/catalog-b-view.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-f.mjs';
import {knownModules} from '@launchclip/core/modules.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const subject = {available: true, framing: 'medium', head: {x: 420, y: 560, width: 240, height: 300}, placement: 'measured'};
const ctx = (overrides = {}) => ({id: 'scene', start: 1, duration: 4, format: {width: 1080, height: 1920, fps: 30, duration: 30}, brand, aspect: '9:16', subject, ...overrides});
const resolve = (id, params, overrides) => ({...MODULES[id].resolve(params, ctx(overrides)), module: id});
const ITEMS = [{text: 'Saved me ten hours a week'}, {image: 'assets/app.png'}, {text: 'Shipped in a day'}, {text: 'The edit I wanted'}];

const IDS = ['glass-word', 'orbit-cards', 'proof-wall', 'scrapbook', 'doodle-outline'];

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

const PROOF = [
  {text: 'The launch video tool I wanted', source: 'Product Hunt'},
  {text: 'Shipped in a day', source: '@ada'},
  {image: 'assets/app.png', source: 'Dashboard'},
  {text: 'Ten hours saved every week', source: 'Ledgerly'}
];

test('proof-wall: real items with sources pin one by one, the hero swipes its key word', () => {
  const model = resolve('proof-wall', {items: PROOF, hero: {text: 'Everyone is talking about it', highlight: 'talking', source: 'Launch notes'}});
  assert.equal(model.layer, 'split', 'the hero lands in front');
  assert.ok(model.content.hero.rect.y >= 560 + 300, 'on the chest, under the face');
  assert.equal(resolve('proof-wall', {items: PROOF}).layer, 'behind', 'without a hero it all sits behind');
  const times = model.content.cards.map((card) => card.time);
  assert.ok(times.every((time, i) => i === 0 || time > times[i - 1]), 'cards pin in turn');
  assert.ok(model.content.hero.time > times.at(-1), 'the hero lands last');
  const ops = catalogFTimeline(model);
  assert.equal(frameState(ops, model.content.hero.swipeAt + 0.4).get('scene-mark').scaleX, 1);
  assert.throws(() => resolve('proof-wall', {items: [{text: 'Great tool'}, ...PROOF.slice(1)]}), /source.*is required/);
  assert.throws(() => resolve('proof-wall', {items: PROOF, hero: {text: 'Loved it', highlight: 'hated', source: 'x'}}), /must be a part of params\.hero\.text/);
});

test('scrapbook: paper boils on threes, the presenter is a sticker, letters land above the head', () => {
  const model = resolve('scrapbook', {word: '3x', sub: 'faster edits'});
  assert.equal(model.layer, 'split');
  assert.deepEqual(model.subjectStyle, {outline: 12, color: '#ffffff', shadow: true});
  assert.ok(Math.abs(model.subjectCamera.samples.find((s) => s.t >= 2.6).scale - 0.82) < 0.02, 'the sticker settles smaller');
  const ops = catalogFTimeline(model);
  const shown = (t) => [0, 1, 2].filter((v) => frameState(ops, t).get(`scene-boil-${v}`).opacity === 1);
  assert.equal(shown(2).length, 1, 'one variant at a time');
  assert.notDeepEqual(shown(2), shown(2 + 0.1), 'the variants take turns');
  const settledHeadTop = 960 + (560 - 960) * 0.82 + 960 * 0.18;
  assert.ok(model.rect.y + model.rect.height <= settledHeadTop, 'the letters sit above where the head ends up');
  assert.throws(() => resolve('scrapbook', {word: 'a b'}), /must be one word/);
});

test('doodle-outline: the traced line boils on threes outside the silhouette, doodles draw beside the head', () => {
  // A round presenter of radius 200 centred at (540, 900) that sways right 30 px a second.
  const outlineAt = (t) => Array.from({length: 120}, (_, i) => [540 + 30 * t + Math.cos(i / 120 * Math.PI * 2) * 200, 900 + Math.sin(i / 120 * Math.PI * 2) * 200]);
  const model = resolve('doodle-outline', {doodles: [{icon: 'arrow', side: 'left'}, {icon: 'crown', side: 'top'}]}, {subject: {...subject, outlineAt}});
  assert.equal(model.layer, 'front');
  assert.equal(model.framesFace, true);
  const {frames, doodles} = model.content;
  assert.ok(frames.every((frame, i) => i === 0 || Math.abs(frame.time - frames[i - 1].until) < 1e-6), 'each frame hands over to the next');
  assert.ok(frames.at(-1).draw === 0 && frames[0].draw > 0, 'the line draws on, then stays whole');
  const first = frames[0].d.match(/^M([\d.]+) ([\d.]+)/).slice(1).map(Number);
  assert.ok(Math.hypot(first[0] - 540 - 30 * 1.1, first[1] - 900) > 205, 'pushed outside the silhouette');
  const ops = catalogFTimeline(model);
  const lit = (t) => frames.filter((frame) => frameState(ops, t).get(`scene-line-${frame.index}`).opacity === 1).length;
  assert.equal(lit(2), 1, 'one outline at a time');
  assert.equal(frameState(ops, 2).get('scene-doodle-0-0').strokeDashoffset, 0, 'drawn by then');
  assert.ok(doodles[0].x < subject.head.x && doodles[1].y < subject.head.y);
  assert.equal(catalogFView(model).behind, null);
  // No outline: only the doodles.
  assert.equal(resolve('doodle-outline', {}).content.traced, false);
  assert.throws(() => resolve('doodle-outline', {doodles: []}), /needs at least one doodle/);
  assert.throws(() => resolve('doodle-outline', {doodles: [{icon: 'rocket'}]}), /must be one of/);
});
