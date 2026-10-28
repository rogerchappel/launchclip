// Movement-grammar transitions (kit/core/transitions.mjs): rack-focus,
// glow-wipe and card-to-card, as layer tweens both renderers evaluate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {LAYER_IDENTITY, TRANSITION_TYPES, cardMap, gsapVars, layerStateAt, layerStyle, sceneWindows, transitionTweens} from '@launchclip/core/transitions.mjs';
import {STORY_TRANSITIONS, resolveStory, validateStory} from '@launchclip/core/story.mjs';
import {getEase} from '@launchclip/core/motion.mjs';

const size = {width: 1920, height: 1080};
const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const card = (id, start, end, extra = {}) => ({id, module: 'stat-card', start, end, params: {value: '12', label: 'videos a week', source: 'LaunchClip telemetry'}, ...extra});
const story = (scenes) => ({schema: 'launchclip.story.v1', lane: 'motion', brand, format: {...size, fps: 30, duration: 8}, scenes});
const atEnd = (list, t) => layerStateAt(t, list, getEase);

test('the new transitions are story transitions too', () => {
  for (const type of ['rack-focus', 'glow-wipe', 'card-to-card']) {
    assert.ok(TRANSITION_TYPES.includes(type) && STORY_TRANSITIONS.includes(type), type);
    assert.equal(validateStory(story([card('a', 0, 4), card('b', 4, 8, {in: {type, dur: 0.6}})])).ok, true, type);
  }
  assert.deepEqual([...TRANSITION_TYPES], STORY_TRANSITIONS);
});

test('rack-focus: the outgoing card blurs back, the incoming one sharpens forward', () => {
  const {in: inn, out} = transitionTweens({type: 'rack-focus', dur: 0.8}, size);
  const at = (list, t) => atEnd(list.map(tw => ({...tw, at: tw.start})), t);
  const start = at(inn, 0), end = at(inn, 0.8);
  assert.ok(start.rackIn === 1 && start.scale > 1 && start.opacity === 0);
  // Blur and the exposure lift travel in one filter, so GSAP never drops one.
  assert.equal(layerStyle(start).filter, 'blur(22px) brightness(1.45)');
  assert.deepEqual(gsapVars('rackIn', 1), {filter: 'blur(22px) brightness(1.45)'});
  // Most of the rack lands in the first frames: past half by the third.
  assert.ok(at(inn, 3 / 30).rackIn < 0.5 && at(inn, 3 / 30).opacity > 0.5);
  assert.deepEqual([end.rackIn, end.scale, end.opacity], [0, 1, 1]);
  const gone = at(out, 0.8);
  assert.ok(gone.blur > 10 && gone.scale < 1 && gone.opacity === 0);
  // Nothing stays blurred once it lands.
  assert.equal(layerStyle(end).filter, undefined);
});

test('glow-wipe: a straight wipe from the travel side, flaring bright, unclipped once landed', () => {
  for (const [direction, side] of [['left', 'wipeL'], ['right', 'wipeR'], ['up', 'wipeT'], ['down', 'wipeB']]) {
    const {in: inn} = transitionTweens({type: 'glow-wipe', dur: 1, direction}, size);
    assert.equal(inn[0].prop, side, direction);
  }
  const {in: inn, out} = transitionTweens({type: 'glow-wipe', dur: 1}, size);
  const list = inn.map(tw => ({...tw, at: tw.start}));
  const mid = atEnd(list, 0.5);
  assert.match(layerStyle(mid).clipPath, /^inset\(0% 0% 0% \d+(\.\d+)?%\)$/);
  assert.match(layerStyle(mid).filter, /^brightness\(1\.\d+\)$/);
  const landed = atEnd(list, 1);
  assert.deepEqual(layerStyle(landed), {opacity: 1});
  assert.ok(out.some(tw => tw.prop === 'glow' && tw.to > 0.5), 'the outgoing plate flares too');
  assert.deepEqual(gsapVars('wipeL', 40), {clipPath: 'inset(0% 0% 0% 40%)'});
  assert.deepEqual(gsapVars('glow', 0.5), {filter: 'brightness(1.5)'});
  assert.equal(LAYER_IDENTITY.glow, 0);
});

test('card-to-card: the incoming card starts on the outgoing card and settles on its own', () => {
  const from = {x: 100, y: 100, width: 600, height: 400}, to = {x: 960, y: 240, width: 800, height: 600};
  const map = cardMap(to, from, size.width, size.height);
  // The incoming rect's centre, scaled about the canvas centre by `scale` and moved by x/y, lands on the outgoing centre.
  const cx = size.width / 2, cy = size.height / 2;
  assert.ok(Math.abs(cx + (to.x + to.width / 2 - cx) * map.scale + map.x - (from.x + from.width / 2)) < 0.1);
  assert.ok(Math.abs(cy + (to.y + to.height / 2 - cy) * map.scale + map.y - (from.y + from.height / 2)) < 0.1);
  assert.ok(Math.abs(map.scale - Math.sqrt((600 * 400) / (800 * 600))) < 1e-3);
  const s = resolveStory(story([card('a', 0, 4, {params: {value: '12', label: 'videos a week', source: 'LaunchClip telemetry', rect: from}}), card('b', 4, 8, {params: {value: '3', label: 'formats each', source: 'LaunchClip telemetry', rect: to}, in: {type: 'card-to-card', dur: 0.7}})]));
  const windows = sceneWindows(s);
  const b = windows.scenes.find(entry => entry.id === 'b'), a = windows.scenes.find(entry => entry.id === 'a');
  const first = atEnd(b.tweens, 4);
  assert.ok(Math.abs(first.x - map.x) < 0.01 && Math.abs(first.scale - map.scale) < 1e-3);
  assert.deepEqual([atEnd(b.tweens, 4.7).x, atEnd(b.tweens, 4.7).scale], [0, 1]);
  assert.ok(a.renderEnd >= 4.7 - 1e-6 && a.tweens.some(tw => tw.role === 'out' && tw.prop === 'opacity'));
  // Same rects (no params.rect on either): a crossfade with a little depth.
  const plain = transitionTweens({type: 'card-to-card', dur: 0.7}, {...size, fromRect: null, toRect: null});
  assert.deepEqual(plain.in.map(tw => tw.prop), ['opacity', 'scale']);
});

test('a rack-focus carries the cards: the incoming one is whole on its first frame, the outgoing one stays whole into the rack', async () => {
  const {resolveModule} = await import('@launchclip/core/modules.mjs');
  const s = resolveStory(story([card('a', 0, 4), card('b', 4, 8, {in: {type: 'rack-focus', dur: 0.4}}), card('c', 8, 12, {in: {type: 'fade', dur: 0.35}})]));
  const [a, b, c] = s.scenes.map(scene => resolveModule(scene, s));
  assert.equal(a.carriedOut, true);
  assert.equal(a.motion.exitTo.opacity, 1);
  assert.equal(b.carriedIn, true);
  assert.equal(b.motion.enterFrom.opacity, 1);
  // A fade does not carry: b fades out under c, and c fades in.
  assert.equal(b.carriedOut, undefined);
  assert.equal(c.motion.enterFrom.opacity, 0);
});
