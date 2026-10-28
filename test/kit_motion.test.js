import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import gsap from 'gsap';
import {spring} from 'remotion';
import {buildEditorialModule} from '../skills/launchclip-create-video/scripts/editorial-ui-modules.mjs';
import * as motion from '@launchclip/core/motion.mjs';
import {ease, getEase, tween, track, stagger, countUp, springValue, splitWords, splitChars, motionBlurPx,
  interpolateColor, clamp01, seconds, frames} from '@launchclip/core/motion.mjs';

const samples = Array.from({length: 101}, (_, i) => i / 100);
const close = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${label}: ${actual} vs ${expected}`);

const families = ['linear', 'power0', 'power1', 'power2', 'power3', 'power4', 'quad', 'cubic', 'quart', 'quint', 'strong',
  'expo', 'circ', 'sine', 'back', 'elastic', 'bounce'];
const names = ['none', ...families.flatMap(name => [name, `${name}.in`, `${name}.out`, `${name}.inOut`]),
  'back.out(1.7)', 'back.in(2.5)', 'back.inOut(1.2)', 'back(3)', 'elastic.out(1,0.3)', 'elastic.in(1.5,0.4)',
  'elastic.inOut(0.8,0.5)', 'elastic.out(0.5)', 'steps(1)', 'steps(6)', 'steps(12)', 'steps(4, true)'];

test('module is import-free plain ESM', async () => {
  const source = await readFile(new URL('../kit/core/motion.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^\s*import\s/m);
  assert.doesNotMatch(source, /\brequire\(/);
});

test('every ease matches gsap.parseEase within 1e-6 at 101 samples', () => {
  for (const name of names) {
    const ours = getEase(name), theirs = gsap.parseEase(name);
    assert.equal(typeof theirs, 'function', `gsap knows ${name}`);
    for (const p of samples) close(ours(p), theirs(p), 1e-6, `${name}(${p})`);
  }
  for (const [name, fn] of Object.entries(ease)) {
    const theirs = gsap.parseEase(name);
    for (const p of samples) close(fn(p), theirs(p), 1e-6, `ease["${name}"](${p})`);
  }
});

test('getEase passes functions through, defaults to power1.out, rejects unknown names', () => {
  const fn = p => p * p;
  assert.equal(getEase(fn), fn);
  assert.equal(getEase(), ease['power1.out']);
  assert.throws(() => getEase('wobble.out'), /unknown ease/);
  assert.throws(() => getEase('back.out(x)'), /invalid ease/);
});

test('tween clamps outside its window and interpolates numbers, objects and colours', () => {
  const spec = {from: 10, to: 20, start: 1, duration: 2, ease: 'power3.out'};
  assert.equal(tween(0, spec), 10);
  assert.equal(tween(5, spec), 20);
  close(tween(2, spec), 10 + 10 * gsap.parseEase('power3.out')(.5), 1e-12, 'mid');
  assert.deepEqual(tween(1.5, {from: {x: 0, y: 10}, to: {x: 100, y: 0}, start: 1, duration: 1, ease: 'none'}), {x: 50, y: 5});
  assert.deepEqual(tween(9, {from: {x: 0}, to: {x: 4}, start: 0, duration: 1}), {x: 4});
  assert.equal(tween(.5, {from: '#000000', to: '#ffffff', start: 0, duration: 1, ease: 'none'}), '#808080');
  assert.equal(tween(3, {from: 0, to: 1, start: 3, duration: 0}), 1);
});

test('track sorts keys, holds the ends and uses the destination key ease', () => {
  const at = track([{t: 2, v: 100, ease: 'power2.in'}, {t: 0, v: 0}, {t: 1, v: 50, ease: 'none'}]);
  assert.equal(at(-1), 0);
  assert.equal(at(3), 100);
  assert.equal(at(.5), 25);
  close(at(1.5), 50 + 50 * gsap.parseEase('power2.in')(.5), 1e-12, 'segment 2');
  const tuples = track([[0, {x: 0, y: 0}], [1, {x: 10, y: -10}, 'none']]);
  assert.deepEqual(tuples(.5), {x: 5, y: -5});
  const colour = track([{t: 0, v: '#ff0000'}, {t: 1, v: '#0000ff', ease: 'none'}]);
  assert.equal(colour(.5), '#800080');
  assert.equal(colour(2), '#0000ff');
  assert.equal(track([{t: 4, v: 7}])(0), 7);
});

test('track matches a GSAP timeline of sequential tweens', () => {
  const keys = [{t: 0, v: 0}, {t: .5, v: 80, ease: 'back.out(1.7)'}, {t: 1.25, v: 30, ease: 'power3.inOut'}, {t: 2, v: 60}];
  const target = {v: 0};
  const tl = gsap.timeline({paused: true});
  for (let i = 1; i < keys.length; i++) tl.to(target, {v: keys[i].v, duration: keys[i].t - keys[i - 1].t, ease: keys[i].ease ?? 'power1.out'}, keys[i - 1].t);
  const at = track(keys);
  for (const p of samples) {
    const t = p * 2.2;
    tl.seek(t);
    close(at(t), target.v, 1e-6, `t=${t}`);
  }
});

test('interpolateColor works in sRGB channels and keeps alpha', () => {
  assert.equal(interpolateColor(0, '#123', '#456'), '#112233');
  assert.equal(interpolateColor(1, '#123', '#456'), '#445566');
  assert.equal(interpolateColor(.5, '#00000000', '#ffffffff'), '#80808080');
  assert.equal(interpolateColor(.5, '#000000', '#ffffff80'), '#808080c0');
  assert.equal(interpolateColor(2, '#000000', '#ffffff'), '#ffffff');
  assert.throws(() => interpolateColor(.5, 'red', '#fff'), /hex/);
});

test('stagger matches gsap.utils.distribute', () => {
  const froms = ['start', 'end', 'center', 'edges', 0, 2, 5, .25];
  for (const count of [1, 2, 5, 6, 9]) {
    for (const from of froms) {
      for (const extra of [{}, {amount: 1.2}, {ease: 'power2.in'}, {base: .3}]) {
        const vars = {each: .08, from, ...extra};
        const distribute = gsap.utils.distribute(vars);
        const list = Array.from({length: count});
        for (let i = 0; i < count; i++) close(stagger(i, {...vars, count}), distribute(i, null, list), 1e-9, `${JSON.stringify(vars)} ${i}/${count}`);
      }
    }
  }
  assert.equal(stagger(3, {each: .1}), .3);
  assert.throws(() => stagger(1, {each: .1, from: 'center'}), /count/);
});

function emittedMetricStates() {
  const result = buildEditorialModule({id: 'm', kind: 'metric', aspect: '16:9', start: 10, duration: 8, title: 'Weekly installs',
    rect: {x: 80, y: 120, width: 640, height: 420},
    metric: {mode: 'data', source: 'npm registry', format: 'number', unit: 'installs', decimals: 1, values: [{value: 12.5, at: .5}, {value: 1873.4, at: 2.2}]}});
  const calls = [];
  runInNewContext(result.motion, {tl: {fromTo: () => {}, to: () => {}, set: (selector, vars, time) => calls.push({selector, vars, time})}});
  return calls.filter(call => call.selector === '#m-number' && call.time > 10);
}

test('countUp reproduces the editorial textFrames() states exactly', () => {
  const states = emittedMetricStates();
  assert.equal(states.length, 19);
  const format = value => value.toLocaleString('en-US', {minimumFractionDigits: 1, maximumFractionDigits: 1});
  const spec = {from: 12.5, to: 1873.4, start: 12.2, format};
  for (const state of states) {
    assert.equal(countUp(state.time, spec), state.vars.textContent, `t=${state.time}`);
    assert.equal(countUp(state.time + 1 / 60, spec), state.vars.textContent, `held after t=${state.time}`);
  }
  assert.equal(countUp(12.19, spec), '12.5');
  assert.equal(countUp(99, spec), '1,873.4');
  assert.equal(countUp(12.2, {from: 0, to: 100, start: 12.2}), 0);
  let seen;
  countUp(13, {from: 0, to: 10, start: 12, format: value => { seen = value; return ''; }});
  assert.equal(seen, 10);
});

test('springValue matches Remotion spring() within 1e-3', () => {
  const configs = [{damping: 14, stiffness: 140, mass: 1}, {damping: 10, stiffness: 100, mass: 1}, {damping: 200, stiffness: 100, mass: 1},
    {damping: 20, stiffness: 400, mass: .6}, {damping: 8, stiffness: 80, mass: 2}, {damping: 26, stiffness: 170, mass: 1}];
  for (const config of configs) {
    for (let frame = 0; frame <= 90; frame++) {
      const expected = spring({frame, fps: 30, config});
      close(springValue(2 + frame / 30, {start: 2, ...config}), expected, 1e-3, `${JSON.stringify(config)} f${frame}`);
      close(springValue(frame / 30 + .5 / 30, config), spring({frame: frame + .5, fps: 30, config}), 1e-3, `half f${frame}`);
    }
  }
  assert.equal(springValue(0, {start: 1}), 0);
  close(springValue(1 + 10 / 30, {start: 1, from: 100, to: 200}), spring({frame: 10, fps: 30, from: 100, to: 200, config: {damping: 14, stiffness: 140}}), 1e-3, 'from/to');
  assert.ok(springValue(1 + 10 / 30, {start: 1, damping: 6, overshootClamping: true}) <= 1);
  assert.throws(() => springValue(1, {damping: 0}), /damping/);
});

test('splitWords and splitChars index their parts', () => {
  assert.deepEqual(splitWords('  Ship  it\nnow '), [{text: 'Ship', index: 0}, {text: 'it', index: 1}, {text: 'now', index: 2}]);
  assert.deepEqual(splitChars('a b'), [{text: 'a', index: 0}, {text: ' ', index: 1}, {text: 'b', index: 2}]);
  assert.equal(splitChars('👍🏽!').length, 2);
  assert.deepEqual(splitWords(''), []);
});

test('motionBlurPx is zero at rest and capped', () => {
  assert.equal(motionBlurPx(0), 0);
  assert.equal(motionBlurPx(.5), 0);
  assert.equal(motionBlurPx(-40), 10);
  assert.equal(motionBlurPx(1000), 24);
  assert.equal(motionBlurPx(1000, {max: 8}), 8);
});

test('helpers', () => {
  assert.equal(clamp01(-1), 0);
  assert.equal(clamp01(.4), .4);
  assert.equal(clamp01(3), 1);
  assert.equal(seconds(45, 30), 1.5);
  assert.equal(frames(1.5, 30), 45);
  for (const name of ['ease', 'getEase', 'tween', 'track', 'stagger', 'countUp', 'springValue', 'splitWords', 'splitChars', 'motionBlurPx',
    'interpolateColor', 'clamp01', 'seconds', 'frames']) assert.ok(name in motion, name);
});

test("gsapText keeps numeric strings with trailing zeros as text through a real GSAP set", async () => {
  const { gsapText } = await import("@launchclip/core/motion.mjs");
  const gsap = (await import("gsap")).default;
  assert.equal(gsapText("64.5"), "64.5");
  assert.equal(gsapText("70.0"), "⁠70.0");
  assert.equal(gsapText("$1,200"), "$1,200");
  const target = { textContent: "64.5" };
  const tl = gsap.timeline({ paused: true });
  tl.set(target, { textContent: gsapText("70.0") }, 0);
  tl.seek(0.5);
  assert.equal(target.textContent.replace("⁠", ""), "70.0");
});
