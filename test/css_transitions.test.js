// CSS transitions on the plate layers (docs/FINISHING_AND_ELEMENTS_RFC.md
// E.3): wipe, clock-wipe and card-flip, as layer tweens both renderers
// evaluate (layerStyle in Remotion, gsapVars in HyperFrames).
import assert from 'node:assert/strict';
import test from 'node:test';
import {getEase} from '@launchclip/core/motion.mjs';
import {validateStory} from '@launchclip/core/story.mjs';
import {CSS_TRANSITION, gsapVars, layerStateAt, layerStyle, maskCover, maskCss, transitionTweens} from '@launchclip/core/transitions.mjs';

const W = 1080, H = 1920;
const size = {width: W, height: H};
const at = (tweens, t) => layerStateAt(t, tweens.map((tw) => ({...tw, at: tw.start})), getEase);
const numbers = (text) => text.match(/-?\d+(\.\d+)?/g).map(Number);

test('a mask string is linear in its progress, so GSAP interpolating two strings draws the same mask', () => {
  for (const args of [{kind: 'wipe', angle: 135, feather: 8}, {kind: 'clock', start: 30, segments: 3, feather: 4}]) {
    const [a, b, mid] = [0, 1, 0.37].map((p) => numbers(maskCss(p, args)));
    assert.equal(a.length, b.length);
    mid.forEach((value, i) => assert.ok(Math.abs(value - (a[i] + (b[i] - a[i]) * 0.37)) < 2e-3, `${args.kind} number ${i}`));
    assert.deepEqual(gsapVars('mask', 0.37, args), {maskImage: maskCss(0.37, args)});
  }
});

test('wipe: hidden at the start, whole at the end, the edge travels the way it says', () => {
  const {in: inn} = transitionTweens({type: 'wipe', dur: 1, direction: 'right'}, size);
  assert.equal(at(inn, 0).maskArgs.angle, 90);
  // Travelling right: the left side opens first.
  const half = at(inn, 0.5);
  assert.equal(maskCover(half, 50, H / 2, W, H), 1);
  assert.equal(maskCover(half, W - 50, H / 2, W, H), 0);
  for (const [x, y] of [[0, 0], [W, H], [W / 2, H / 2]]) assert.equal(maskCover(at(inn, 0), x, y, W, H), 0);
  // Landed: no mask at all, in either renderer.
  const end = at(inn, 1);
  assert.equal(end.mask, null);
  assert.equal(layerStyle(end).maskImage, undefined);
  assert.deepEqual(gsapVars('mask', 1, {kind: 'none'}), {maskImage: 'none'});
  assert.equal(at(transitionTweens({type: 'wipe', dur: 1, angle: 45, feather: 0}, size).in, 0.2).maskArgs.angle, 45);
});

test('clock-wipe: a hand sweeps clockwise from 12; segments open like a fan', () => {
  const {in: inn} = transitionTweens({type: 'clock-wipe', dur: 1}, size);
  const quarter = at(inn, 0.5);
  // power2.inOut at half: the hand is at 6 o'clock.
  assert.equal(maskCover(quarter, W / 2 + 200, H / 2 - 5, W, H), 1, '3 o\'clock is open');
  assert.equal(maskCover(quarter, W / 2 - 200, H / 2 + 5, W, H), 0, '9 o\'clock is not');
  const fan = at(transitionTweens({type: 'clock-wipe', dur: 1, segments: 4}, size).in, 0.5);
  // Clockwise from 12: 20° into each quarter is open, 70° in is not yet.
  const cover = (deg) => maskCover(fan, W / 2 + 300 * Math.sin((deg * Math.PI) / 180), H / 2 - 300 * Math.cos((deg * Math.PI) / 180), W, H);
  assert.deepEqual([20, 110, 200, 290].map(cover), [1, 1, 1, 1], 'each quarter opens at once');
  assert.deepEqual([70, 160, 250, 340].map(cover), [0, 0, 0, 0]);
});

test('card-flip: slow, fast, slow; edge-on at the middle, never past it, blurred at peak speed', () => {
  const {in: inn, out} = transitionTweens({type: 'card-flip', dur: 1}, size);
  const frames = Array.from({length: 31}, (_, k) => k / 30);
  // The outgoing card turns away in the first half; the incoming one is hidden until then.
  for (const t of frames.filter((t) => t < 0.5)) assert.equal(at(inn, t).opacity, 0);
  const angle = frames.map((t) => (t < 0.5 ? Math.abs(at(out, t).flip) : 180 - Math.abs(at(inn, t).flip)));
  const speed = angle.slice(1).map((a, k) => a - angle[k]);
  assert.ok(speed.every((v) => v >= -1e-9), 'one way, no overshoot');
  assert.ok(Math.max(...angle) <= 180 + 1e-9 && Math.abs(angle.at(-1) - 180) < 1e-9);
  const peak = speed.indexOf(Math.max(...speed));
  assert.ok(peak >= 12 && peak <= 17, `fastest at the middle (step ${peak})`);
  assert.ok(speed[0] < speed[peak] / 5 && speed.at(-1) < speed[peak] / 5);
  assert.ok(at(out, 0.49).blur > CSS_TRANSITION.flipBlur * 0.8, 'blurred while edge-on');
  const style = layerStyle(at(inn, 0.75));
  assert.match(style.transform, /^perspective\(\d+px\) translate\(0px, 0px\) rotateY\(-?[\d.]+deg\) scale\([\d.]+\)$/);
  assert.equal(gsapVars('flip', 30, {perspective: 2688}).transformPerspective, 2688);
  assert.equal(layerStyle(at(inn, 1)).transform, undefined, 'at rest: no transform');
});

test('validation: the options belong to their transition and stay in range', () => {
  const story = (input) => ({
    schema: 'launchclip.story.v1', lane: 'motion', format: {width: W, height: H, fps: 30, duration: 4},
    brand: {colors: {bg: '#0b1020', primary: '#ff7a59', accent: '#7ce7ff', ink: '#0b1020', paper: '#f5f1ea'}, fonts: {display: 'anton', body: 'inter', meta: 'jetbrains-mono'}},
    scenes: [{id: 's1', module: 'hook-title', start: 0, end: 2, params: {title: 'One'}}, {id: 's2', module: 'hook-title', start: 2, end: 4, params: {title: 'Two'}, in: input}]
  });
  assert.deepEqual(validateStory(story({type: 'wipe', dur: 0.6, angle: 135, feather: 12})).errors, []);
  assert.deepEqual(validateStory(story({type: 'clock-wipe', dur: 0.6, start: 90, segments: 3})).errors, []);
  assert.deepEqual(validateStory(story({type: 'card-flip', dur: 0.6, direction: 'right'})).errors, []);
  const errors = (input) => validateStory(story(input)).errors.join(' | ');
  assert.match(errors({type: 'fade', dur: 0.6, segments: 2}), /segments is a clock-wipe option/);
  assert.match(errors({type: 'clock-wipe', dur: 0.6, segments: 12}), /segments must be a whole number of hands from 1 to 8/);
  assert.match(errors({type: 'wipe', dur: 0.6, feather: 80}), /feather must be the soft edge/);
  assert.match(errors({type: 'card-flip', dur: 0.6, angle: 20}), /angle is a light-sweep option/);
});
