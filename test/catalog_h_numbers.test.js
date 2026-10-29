// Catalogue H counters (kit/core/catalog-h-numbers.mjs): registration,
// variants, and that every counter lands exactly on its value.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MODULES, VARIANTS, catalogHTimeline} from '@launchclip/core/catalog-h.mjs';
import {frameState} from '@launchclip/core/catalog-b-view.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-h.mjs';
import {knownModules} from '@launchclip/core/modules.mjs';
import {SAMPLES} from '../scripts/element-samples.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const FORMATS = {'9:16': {width: 1080, height: 1920, fps: 30}, '16:9': {width: 1920, height: 1080, fps: 30}};
const ctx = (aspect = '9:16', overrides = {}) => ({id: 'scene', start: 1, duration: 5, format: FORMATS[aspect], brand, aspect, hits: [], ...overrides});
const resolve = (id, params = SAMPLES[id], aspect, overrides) => ({...MODULES[id].resolve(params, ctx(aspect, overrides)), module: id});
const settled = model => frameState(catalogHTimeline(model), model.motion.exitStart - 0.01);
const COUNTERS = ['odometer', 'flip-clock', 'ticker-tape', 'slot-roll', 'countdown', 'percent-fill'];

test('every counter is registered, with variants that resolve in both aspects', () => {
  for (const id of COUNTERS) {
    assert.ok(knownModules().includes(id) && EMITTERS[id], id);
    assert.ok(VARIANTS[id].length >= 3, id);
    for (const variant of VARIANTS[id]) for (const aspect of ['9:16', '16:9']) {
      const model = resolve(id, {...SAMPLES[id], variant}, aspect);
      const out = EMITTERS[id](model);
      assert.doesNotMatch(out.html + out.motion, /undefined|NaN/, `${id}/${variant} ${aspect}`);
      for (const [target, props] of settled(model)) if (props.blur !== undefined) assert.equal(props.blur, 0, `${id}: ${target} blurred at settle`);
    }
  }
});

test('odometer: every reel lands on its digit, rolling forward, lower places turning more', () => {
  const model = resolve('odometer');
  const h = model.content.h;
  const digits = model.content.cells.filter(cell => cell.digit);
  assert.equal(digits.map(cell => cell.strip.at(-1)).join(''), '1284503');
  const state = settled(model);
  model.content.cells.forEach((cell, i) => { if (cell.digit) assert.ok(Math.abs(state.get(`scene-strip-${i}`).y + (cell.strip.length - 1) * h) < 0.02); });
  assert.ok(digits.at(-1).strip.length > digits[0].strip.length, 'the units turn the most');
  assert.ok(digits.every(cell => cell.endY <= cell.startY), 'reels only roll forward');
  // From a start value: digits begin at that value, zero-padded.
  const from = resolve('odometer', {value: 250, from: 199});
  assert.deepEqual(from.content.cells.map(cell => cell.strip[Math.round(-cell.startY / from.content.h)]), ['1', '9', '9']);
  assert.throws(() => resolve('odometer', {value: 1, from: 5}), /params\.from/);
  assert.equal(resolve('odometer', {value: 1400, format: {currency: 'USD'}}).content.cells.map(cell => cell.char).join(''), '$1,400');
});

test('flip-clock: only changed cards flip, top half falling before the bottom', () => {
  const model = resolve('flip-clock', {values: ['11:58', '11:59', '12:00']});
  const steps = model.content.cells.map(cell => cell.steps.length);
  assert.deepEqual(steps, [0, 1, 0, 1, 2]);
  const ops = catalogHTimeline(model);
  const t = model.content.cells[4].steps[0].time;
  const mid = frameState(ops, t + 0.08);
  assert.ok(mid.get('scene-flap-4-0').scaleY < 1 && mid.get('scene-fall-4-0').scaleY === 0);
  const done = frameState(ops, t + 0.4);
  assert.equal(done.get('scene-flap-4-0').scaleY, 0);
  assert.equal(done.get('scene-fall-4-0').scaleY, 1);
  assert.deepEqual(model.events.filter(e => e.name.startsWith('flip-')).map(e => e.name), ['flip-1', 'flip-2']);
});

test('ticker-tape loops one strip width seamlessly for the whole scene', () => {
  const model = resolve('ticker-tape');
  const loop = catalogHTimeline(model).find(op => op.type === 'loop');
  assert.equal(loop.to.x, -model.content.stripW);
  assert.ok(loop.start + loop.cycle * loop.repeats >= model.end, 'the loop outlasts the scene');
  assert.ok(model.content.copies * model.content.stripW >= model.rect.width + model.content.stripW - 1e-6, 'copies cover the band while it wraps');
  assert.match(EMITTERS['ticker-tape'](model).motion, /repeat/);
});

test('slot-roll lands on the final word, unblurred', () => {
  for (const variant of VARIANTS['slot-roll']) {
    const model = resolve('slot-roll', {...SAMPLES['slot-roll'], variant});
    const c = model.content;
    const index = -c.endY / c.h + (c.rows === 3 ? 1 : 0);
    assert.equal(c.sequence[Math.round(index)], 'creators', variant);
    const state = settled(model);
    assert.equal(state.get('scene-strip').y, c.endY);
    assert.equal(state.get('scene-strip').blur, 0);
  }
  assert.throws(() => resolve('slot-roll', {items: ['a', 'b'], final: 'c'}), /params\.final/);
});

test('countdown ticks down to zero and the end word replaces it', () => {
  const model = resolve('countdown', SAMPLES.countdown, '16:9');
  const ops = catalogHTimeline(model);
  const {steps, end} = model.content;
  assert.deepEqual(steps.map(s => s.text), ['3', '2', '1', '0']);
  assert.equal(frameState(ops, steps[1].time + 0.01).get('scene-num').text, '2');
  const state = settled(model);
  assert.equal(state.get('scene-num').opacity, 0);
  assert.equal(state.get('scene-end').opacity, 1);
  assert.ok(end.time > steps.at(-1).time);
  const clock = resolve('countdown', {from: 15, step: 0.1, variant: 'clock'});
  assert.equal(clock.content.steps[0].text, '00:15');
  // A step too slow for the scene ticks faster to fit instead of failing the plan.
  const fitted = resolve('countdown', {from: 20, step: 1});
  assert.ok(fitted.content.step < 1 && fitted.content.steps.at(-1).time <= 1 + 5 + 1e-6);
  assert.equal(resolve('countdown', {from: 3, step: 0.5}).content.step, 0.5);
  assert.throws(() => resolve('countdown', {from: 200}), /runs past the scene even at 0\.1 s/);
});

test('percent-fill rises to its share and counts to the exact figure', () => {
  const model = resolve('percent-fill', SAMPLES['percent-fill'], '16:9', {});
  const state = settled(model);
  assert.equal(state.get('scene-value').text, '72%');
  const battery = resolve('percent-fill', {...SAMPLES['percent-fill'], variant: 'battery'});
  assert.equal(settled(battery).get('scene-fill').scaleX, 1);
  assert.equal(resolve('percent-fill', {value: 3.5, max: 5, format: {decimals: 1, suffix: ' / 5'}}).content.samples.at(-1).text, '3.5 / 5');
});
