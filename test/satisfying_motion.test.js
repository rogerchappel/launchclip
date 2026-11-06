// The satisfying-motion kit: the tactile modules (kit/core/catalog-h-tactile.mjs
// on kit/core/tactile.mjs), the brand frame's running counter and scrubber
// (kit/core/brand-frame.mjs), and the tag-chips and serif-accent caption
// presets (kit/core/captions.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {MODULES, VARIANTS, catalogHTimeline} from '@launchclip/core/catalog-h.mjs';
import {frameState} from '@launchclip/core/catalog-b-view.mjs';
import {knownModules} from '@launchclip/core/modules.mjs';
import {TACTILE, burstParticles, seededRandom} from '@launchclip/core/tactile.mjs';
import {brandFramePlan, counterText, frameCounter, frameCues} from '@launchclip/core/brand-frame.mjs';
import {captionPlan, chunkWords} from '@launchclip/core/captions.mjs';
import {validateStory} from '@launchclip/core/story.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-h.mjs';
import {SAMPLES} from '../scripts/element-samples.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const FORMATS = {'9:16': {width: 1080, height: 1920, fps: 30}, '16:9': {width: 1920, height: 1080, fps: 30}};
const ctx = (aspect = '9:16') => ({id: 'scene', start: 1, duration: 6, format: FORMATS[aspect], brand, aspect, hits: []});
const resolve = (id, params = SAMPLES[id], aspect) => ({...MODULES[id].resolve(params, ctx(aspect)), module: id});
const TACTILE_IDS = ['drop-grid', 'live-counter', 'live-bars'];
const numberOf = text => Number(String(text).replace(/[^0-9.]/g, ''));

test('the tactile modules are registered and every variant resolves and emits in both aspects', () => {
  for (const id of TACTILE_IDS) {
    assert.ok(knownModules().includes(id) && EMITTERS[id], id);
    for (const variant of VARIANTS[id]) for (const aspect of ['9:16', '16:9']) {
      const model = resolve(id, {...SAMPLES[id], variant}, aspect);
      const out = EMITTERS[id](model);
      assert.doesNotMatch(out.html + out.motion, /undefined|NaN/, `${id}/${variant} ${aspect}`);
    }
  }
});

test('drop-grid: each item falls, squashes and settles on its own word, and the counter climbs with the landings', () => {
  const times = [0.6, 0.9, 1.2, 1.5, 1.8];
  const model = resolve('drop-grid', {count: 5, times, counter: {suffix: '×'}});
  const ops = catalogHTimeline(model);
  const cells = model.content.cells;
  assert.deepEqual(cells.map(cell => cell.time), times.map(t => Math.round((1 + t) * 1000) / 1000));
  for (const [i, cell] of cells.entries()) {
    const id = `scene-i${i}`;
    assert.equal(frameState(ops, cell.time - 0.02).get(id).opacity, 0, 'hidden before its drop');
    const falling = frameState(ops, cell.time + TACTILE.fall / 2).get(id);
    assert.ok(falling.y < 0 && falling.opacity === 1, 'falling from above');
    const contact = frameState(ops, cell.land + TACTILE.squash).get(id);
    assert.ok(contact.scaleY < 1 && contact.scaleX > 1, 'squashed on contact');
    const settled = frameState(ops, cell.land + TACTILE.squash + TACTILE.settle + 0.01).get(id);
    assert.equal(settled.y, 0);
    assert.ok(Math.abs(settled.scaleY - 1) < 1e-6 && Math.abs(settled.scaleX - 1) < 1e-6, 'settled to shape');
    assert.equal(frameState(ops, cell.land + 0.01).get('scene-count').text, `${i + 1}×`);
  }
  // Every landing is an event for sound design, and the grid filling bursts.
  const lands = model.events.filter(event => event.name.startsWith('land-'));
  assert.equal(lands.length, 5);
  assert.ok(lands.every(event => event.sfx === 'land' && event.cue));
  assert.equal(model.events.find(event => event.name === 'filled').sfx, 'burst');
  // Times must rise, and each item needs one.
  assert.throws(() => resolve('drop-grid', {count: 3, times: [1, 0.8, 1.2]}), /params\.times\[1\]/);
  assert.throws(() => resolve('drop-grid', {count: 3, times: [1, 1.2]}), /params\.times/);
  assert.throws(() => resolve('drop-grid', {count: 3, items: ['a', 'b', 'c']}), /exactly one of count or items/);
});

test('particles are seeded: the same scene draws the same burst, and every mote has faded by the end', () => {
  assert.deepEqual(burstParticles('a|1', 'p', {x: 0, y: 0, count: 6, spread: 100, size: 10, colors: ['#ffffff']}), burstParticles('a|1', 'p', {x: 0, y: 0, count: 6, spread: 100, size: 10, colors: ['#ffffff']}));
  const random = seededRandom('x'), again = seededRandom('x');
  assert.deepEqual([random(), random()], [again(), again()]);
  const model = resolve('drop-grid');
  assert.deepEqual(resolve('drop-grid').content.cells.map(cell => cell.particles), model.content.cells.map(cell => cell.particles));
  const end = frameState(catalogHTimeline(model), model.motion.exitStart - 0.01);
  for (const cell of model.content.cells) for (const p of cell.particles) assert.ok(end.get(p.id).opacity < 0.01, p.id);
});

test('live-counter: the figure ticks up for the whole scene, landing on `to`, and stamps as it passes each milestone', () => {
  const model = resolve('live-counter', {from: 1000, to: 50000, milestones: [20000], delta: '+12%'});
  const ops = catalogHTimeline(model);
  const samples = [1.8, 3, 4.2, 5.4].map(t => numberOf(frameState(ops, t).get('scene-value').text));
  for (let i = 1; i < samples.length; i++) assert.ok(samples[i] > samples[i - 1], `climbing at sample ${i}: ${samples}`);
  assert.equal(numberOf(frameState(ops, model.motion.exitStart).get('scene-value').text), 50000);
  const milestone = model.content.milestones[0];
  assert.ok(numberOf(frameState(ops, milestone.time - 0.1).get('scene-value').text) < 20000);
  assert.ok(numberOf(frameState(ops, milestone.time + 0.1).get('scene-value').text) >= 20000);
  assert.equal(model.events.find(event => event.name === 'milestone-1').sfx, 'stamp');
  assert.equal(model.events.find(event => event.name === 'count').sfx, 'tick');
  assert.throws(() => resolve('live-counter', {to: 100, milestones: [100]}), /milestones\[0\]/);
});

test('live-bars: every bar grows to its value while the number riding its end counts with it', () => {
  const model = resolve('live-bars');
  const ops = catalogHTimeline(model);
  const mid = frameState(ops, (model.content.t0 + model.content.t1) / 2), end = frameState(ops, model.content.t1 + 0.01);
  model.content.rows.forEach((row, i) => {
    assert.ok(mid.get(`scene-b${i}`).scaleX < 1 && mid.get(`scene-b${i}`).scaleX > row.w0 / row.w1);
    assert.equal(end.get(`scene-b${i}`).scaleX, 1);
    assert.equal(end.get(`scene-v${i}`).x, 0);
    assert.equal(numberOf(end.get(`scene-v${i}`).text), row.to);
    assert.ok(numberOf(mid.get(`scene-v${i}`).text) > row.from && numberOf(mid.get(`scene-v${i}`).text) < row.to);
  });
});

const frameStory = (frame) => ({schema: 'launchclip.story.v1', lane: 'motion', title: 'Trial reels', format: {width: 1080, height: 1920, fps: 30, duration: 20}, resolved: {duration: 20},
  brand: {colors: {bg: '#000000', paper: '#ffffff', ink: '#0b0b0f', primary: '#ffd23f', accent: '#46d4ff'}, fonts: {display: 'anton', body: 'inter'}},
  scenes: [{id: 'a', module: 'hook-title', start: 0, end: 10, params: {headline: 'Hi'}}, {id: 'b', module: 'hook-title', start: 10, end: 20, params: {headline: 'There'}}], frame});

test('frame counter: a value climbs step by step in a corner, rolling through in-between values, and never re-enters', () => {
  assert.equal(counterText(3, {prefix: 'DAY ', pad: 2}), 'DAY 03');
  assert.equal(counterText(261118, {prefix: '$'}), '$261,118');
  assert.equal(counterText(1234.5, {decimals: 1, separator: false}), '1234.5');
  const story = frameStory({kicker: {label: 'Trial reels'}, counter: {label: 'Liability', format: {prefix: '$'}, steps: [{start: 0, value: 0}, {start: 4, value: 53000}, {scene: 'b', value: 261118}]}});
  const counter = frameCounter(story);
  assert.equal(counter.position, 'top-right', 'the corner the kicker is not in');
  assert.deepEqual(counter.steps.map(step => step.text), ['$0', '$53,000', '$261,118']);
  const shown = counter.shown.map(entry => numberOf(entry.text));
  for (let i = 1; i < shown.length; i++) assert.ok(shown[i] > shown[i - 1], 'the roll only climbs');
  assert.equal(counter.shown.filter(entry => entry.step !== null).length, 3);
  const plan = brandFramePlan(story);
  assert.ok(plan.layout.regions.some(region => region.id === 'frame-counter'));
  // Each shown value fades in once and out once (the last stays): no re-entry.
  const ids = counter.shown.map((_, i) => `lc-frame-cv-${String(i + 1).padStart(3, '0')}`);
  ids.forEach((id, i) => assert.equal(plan.tweens.filter(tween => tween.id === id).length, i === ids.length - 1 ? 1 : 2, id));
  assert.deepEqual(frameCues(story).map(cue => [cue.at, cue.sfx]), [[4, 'tick'], [10, 'tick']]);
  // Sharing a corner with the section labels, it takes the outer edge.
  const shared = brandFramePlan(frameStory({kicker: false, sections: {position: 'top-right'}, labels: [{start: 0, label: 'Setup'}], counter: {steps: [{start: 0, text: 'DAY 01'}, {start: 5, text: 'DAY 02'}]}}));
  const [c, s] = ['frame-counter', 'frame-section'].map(id => shared.layout.regions.find(region => region.id === id).rect);
  assert.ok(s.x + s.width <= c.x + 1e-6, 'labels sit inside the counter');
});

test('frame counter and scrubber validate, and the scrubber knob travels with the fill', () => {
  const errors = (frame) => validateStory(frameStory(frame)).errors.join('\n');
  assert.equal(errors({counter: {label: 'Day', format: {prefix: 'DAY ', pad: 2}, steps: [{start: 0, value: 1}, {scene: 'b', value: 2}]}, progress: {style: 'scrubber'}}), '');
  assert.match(errors({counter: {steps: []}}), /frame\.counter\.steps/);
  assert.match(errors({counter: {steps: [{start: 0}]}}), /exactly one of value/);
  assert.match(errors({counter: {steps: [{start: 0, value: 1}], format: {pad: 9}}}), /format\.pad/);
  assert.match(errors({progress: {style: 'zigzag'}}), /frame\.progress\.style/);
  const plan = brandFramePlan(frameStory({kicker: false, sections: false, progress: {style: 'scrubber'}}));
  const knob = plan.tweens.find(tween => tween.id === 'lc-frame-knob');
  const inset = plan.layout.progress.inset + plan.layout.progress.knob / 2;
  assert.equal(knob.to.x, 1080 - 2 * inset);
  assert.equal(knob.dur, 20);
  assert.ok(plan.layout.safe.y + plan.layout.safe.height <= 1920 - plan.layout.progress.thickness - inset, 'modules keep clear of the knob');
});

test('tag-chips and serif-accent: the sentence builds word by word; key words get an ink chip or a serif italic', () => {
  const words = [['Claude', 0.2, 0.5], ['posts', 0.55, 0.8], ['ten', 0.85, 1.0], ['reels', 1.05, 1.4], ['a', 1.45, 1.5], ['day', 1.55, 1.9]].map(([text, start, end]) => ({text, start, end}));
  const chunks = chunkWords(words);
  const chips = captionPlan(chunks, {type: 'captions', preset: 'tag-chips', emphasis: ['ten', 'reels']}, {brand, format: {width: 1080, height: 1920}});
  const all = [];
  const walk = (node) => { all.push(node); (node.children ?? []).forEach(walk); };
  chips.nodes.forEach(walk);
  const chipIds = all.filter(node => node.cls === 'lc-cap-tag-b').map(node => node.id);
  assert.equal(chipIds.length, 2, 'one chip per key word');
  assert.match(chips.css, /\.lc-cap-tag-b \{[^}]*background: #f2eee6/, 'paper chips on a dark brand');
  const light = {...brand, colors: {...brand.colors, bg: '#f4efe4', paper: '#ffffff', ink: '#111111'}};
  assert.match(captionPlan(chunks, {type: 'captions', preset: 'tag-chips', emphasis: ['ten']}, {brand: light, format: {width: 1080, height: 1920}}).css, /\.lc-cap-tag-b \{[^}]*background: #111111/, 'ink chips on a light brand');
  for (const id of chipIds) assert.ok(chips.tweens.some(tween => tween.id === id && tween.to.scaleX === 1));
  const serif = captionPlan(chunks, {type: 'captions', preset: 'serif-accent', emphasis: ['reels']}, {brand, format: {width: 1080, height: 1920}});
  const serifWords = [];
  const collect = (node) => { if (String(node.cls ?? '').includes('lc-cap-serif')) serifWords.push(node.text); (node.children ?? []).forEach(collect); };
  serif.nodes.forEach(collect);
  assert.deepEqual(serifWords, ['reels']);
  assert.match(serif.css, /\.lc-cap-serif \{[^}]*Instrument Serif[^}]*font-style: italic/);
});
