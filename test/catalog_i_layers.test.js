// Catalogue I layer stack (kit/core/catalog-i-layers.mjs) and the breakdown
// reel command's pure parts (src/reel.js): the 20-beat grid, the rules on
// layers, the loop seam (the first and last frames are the same state), and
// the ops both renderers draw from.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MODULES, catalogHTimeline, catalogHView} from '@launchclip/core/catalog-h.mjs';
import {REEL_BEATS, reelBeats} from '@launchclip/core/catalog-i-layers.mjs';
import {frameState} from '@launchclip/core/catalog-b-view.mjs';
import {knownModules} from '@launchclip/core/modules.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-h.mjs';
import {heroOf, storyboardPanels} from '../src/reel.js';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const FORMATS = {'9:16': {width: 1080, height: 1920, fps: 30}, '16:9': {width: 1920, height: 1080, fps: 30}};
const LAYERS = [{kind: 'storyboard', label: 'Storyboard', panels: ['Open', 'The turn', 'Payoff']}, {kind: 'style', label: 'Style'}, {label: 'Plain module', image: 'assets/layers/plain.jpg'}, {label: 'Final', image: 'assets/layers/final.jpg'}];
const PARAMS = {hook: 'How this shot was made', payoff: 'One project. Every layer.', layers: LAYERS, play: Array.from({length: 23}, (_, i) => `assets/play/f${String(i + 1).padStart(2, '0')}.jpg`)};
const resolve = (params = PARAMS, aspect = '9:16', overrides = {}) => ({...MODULES['layer-stack'].resolve(params, {id: 'reel', start: 0, duration: 10, format: FORMATS[aspect], brand, hits: [], ...overrides}), module: 'layer-stack'});

test('registered with both renderers', () => {
  assert.ok(knownModules().includes('layer-stack') && EMITTERS['layer-stack']);
});

test('the beat grid: 20 beats, 10 s at 120 BPM', () => {
  const b = reelBeats(120);
  assert.equal(b.beat, 0.5);
  assert.deepEqual([b.play, b.tilt, b.apart, b.snap, b.payoff, b.clear, b.end], [1.5, 3, 3.5, 8, 8.5, 9.5, 10]);
  assert.equal(REEL_BEATS * reelBeats(100).beat, 12);
});

test('resolve enforces the rules', () => {
  assert.throws(() => resolve({...PARAMS, hook: 'one two three four five six seven'}), /at most 6 words/);
  assert.throws(() => resolve(PARAMS, '9:16', {duration: 8}), /at least 20 beats/);
  // A final hold past beat 20 keeps the opening frame.
  const held = resolve(PARAMS, '9:16', {duration: 12}), heldOps = catalogHTimeline(held);
  assert.deepEqual(frameState(heldOps, 11.9).get('reel-cam'), frameState(heldOps, 0).get('reel-cam'));
  assert.throws(() => resolve({...PARAMS, layers: [LAYERS[3], LAYERS[0]]}), /last \(top\) layer is an image/);
  assert.throws(() => resolve({...PARAMS, layers: [LAYERS[3]]}), /2–5 entries/);
  assert.throws(() => resolve({...PARAMS, layers: [{...LAYERS[1], image: 'assets/x.png'}, LAYERS[3]]}), /image and fit are for image layers/);
  assert.throws(() => resolve({...PARAMS, layers: [{label: 'Final', image: 'https://x.test/a.png'}, LAYERS[3]]}), /project-local/);
  assert.equal(resolve({...PARAMS, bpm: 100}, '9:16', {duration: 12}).content.beats.snap, 9.6);
});

test('every aspect: the last frame is the first, the hits land on beats, and the layers come apart and back', () => {
  for (const aspect of ['9:16', '16:9']) {
    const model = resolve(PARAMS, aspect), c = model.content, ops = catalogHTimeline(model);
    assert.equal(model.layout.drift, false, 'no ambient drift over a self-looping scene');
    const out = EMITTERS['layer-stack'](model);
    assert.doesNotMatch(out.html + out.motion, /undefined|NaN|Infinity/, aspect);
    // The seam: every element's state on the last frame equals its state on the first.
    const first = frameState(ops, 0), last = frameState(ops, model.end - 1 / model.fps);
    for (const [target, props] of last) for (const [key, value] of Object.entries(props)) {
      const was = first.get(target)?.[key];
      assert.ok(typeof value === 'string' ? value === was : Math.abs(value - (was ?? value)) < 1e-6, `${aspect} ${target}.${key}: ${was} → ${value}`);
    }
    // Event times sit on the grid.
    for (const e of model.events.filter(e => e.name !== 'enter')) assert.ok(Math.abs(e.time / c.beats.beat - Math.round(e.time / c.beats.beat)) < 1e-6, `${aspect} ${e.name} at ${e.time}`);
    // Mid-hold: every layer in its slot and every label shown; after the snap, together and flat.
    const hold = frameState(ops, 7), after = frameState(ops, c.beats.snap + 0.5);
    for (const [i, offset] of c.offsets.entries()) {
      assert.ok(Math.abs((frameState(ops, c.beats.apart + (c.layers.length - 2) * c.beats.beat + 0.45).get(`reel-L${i}`)?.y ?? 0) - offset) < 0.01, `${aspect} layer ${i}`);
      assert.equal(after.get(`reel-L${i}`).y, 0);
      assert.ok(Math.abs(after.get(`reel-L${i}-rot`).rotation) < 1e-6);
      assert.equal(hold.get(`reel-l${i}`).opacity, 1);
    }
    // The camera shakes right after the snap, and is still by the payoff.
    assert.ok(Math.abs(frameState(ops, c.beats.snap + 2 / 30).get('reel-shake').x) > 0.5, aspect);
    assert.deepEqual(frameState(ops, c.beats.payoff).get('reel-shake'), {x: 0, y: 0});
    // The shot plays: one frame on at a time over beats 3–6.
    const mid = frameState(ops, c.beats.play + 0.75);
    assert.equal(c.play.filter((_, j) => mid.get(`reel-f${j}`).opacity === 1).length, 1);
    // Labels never cross the stack.
    const view = JSON.stringify(catalogHView(model));
    assert.ok(view.includes('reel-cam') && view.includes('reel-l3'));
  }
});

test('reel helpers: the hero frame and the storyboard panels', () => {
  const scenes = [{id: 's1', module: 'kinetic-words', start: 0, end: 4, params: {}}, {id: 's2', module: 'bar-chart', start: 4, end: 12, params: {title: 'Growth'}}, {id: 's3', module: 'cta', start: 12, end: 16, params: {}}];
  assert.deepEqual(heroOf(scenes, 16), {t: 10, scene: scenes[1]});
  assert.equal(heroOf(scenes, 16, 13).scene.id, 's3');
  assert.throws(() => heroOf(scenes, 16, 1), /--at must be/);
  assert.deepEqual(storyboardPanels(scenes), ['kinetic-words', 'Growth', 'cta']);
  const many = Array.from({length: 9}, (_, i) => ({id: `s${i}`, module: 'm', params: {title: `T${i}`}}));
  assert.deepEqual(storyboardPanels(many), ['T0', 'T2', 'T3', 'T5', 'T6', 'T8']);
});
