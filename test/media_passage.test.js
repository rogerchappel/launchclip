// Media scenes honour their typed transitions (kit/core/media-passage.mjs):
// photo-scene, evidence-clip and product-demo are whole on the first frame of
// a cut (no dip to the background under a character on a higher track), can
// open a video at full opacity, leave with the cut into the next plate, and
// still fade where nothing carries them.
import assert from 'node:assert/strict';
import test from 'node:test';
import {frameState} from '@launchclip/core/catalog-b-view.mjs';
import {evidenceClipTimeline, photoSceneTimeline, productDemoTimeline, scenePassage} from '@launchclip/core/catalog-d.mjs';
import {resolveModule} from '@launchclip/core/modules.mjs';

const brand = {colors: {bg: '#10132a', primary: '#7c70ff', accent: '#22c3ee', ink: '#10132a', paper: '#f4f2ff'}, fonts: {display: 'space-grotesk', body: 'inter', meta: 'jetbrains-mono'}};
const story = (scenes) => ({schema: 'launchclip.story.v1', lane: 'motion', format: {width: 1080, height: 1920, fps: 30, duration: 12}, brand, scenes});
const world = (id, start, end, extra = {}) => ({id, module: 'world', start, end, params: {kind: 'kitchen'}, ...extra});
const photo = (id, start, end, extra = {}, params = {}) => ({id, module: 'photo-scene', start, end, params: {media: {src: 'assets/fridge.mp4', kind: 'video'}, zoom: 0.02, ...params}, ...extra});
const opacityAt = (ops, id, t) => frameState(ops, t).get(id)?.opacity;

test('a photo-scene cut in and out between world plates is whole on every frame', () => {
  const scenes = [world('a', 0, 3), photo('fridge', 3, 6, {in: {type: 'cut', dur: 0.1}}), world('b', 6, 9, {in: {type: 'cut', dur: 0.1}}),
    {id: 'mia', module: 'character-cameo', track: 1, start: 3, end: 6, params: {character: 'mia', panel: false}}];
  const s = story(scenes);
  const model = resolveModule(scenes[1], s);
  assert.deepEqual([model.content.enter, model.content.exit], ['cut', 'cut']);
  const ops = photoSceneTimeline(model);
  for (const t of [3, 3 + 1 / 30, 3.2, 4.5, 5.8, 6 - 1 / 30]) {
    assert.equal(opacityAt(ops, 'fridge-media', t), 1, `media at ${t}`);
    assert.equal(opacityAt(ops, 'fridge-overlay', t), 1, `overlay at ${t}`);
  }
  assert.equal(opacityAt(ops, 'fridge-media', 6), 0, 'gone when the next plate cuts in');
  // An untyped plate change is a cut too: the plates are adjacent.
  const untyped = story([world('a', 0, 3), photo('fridge', 3, 6), world('b', 6, 9)]);
  const m2 = resolveModule(untyped.scenes[1], untyped);
  assert.deepEqual([m2.content.enter, m2.content.exit], ['cut', 'cut']);
});

test('a photo-scene opens the video at full opacity on frame 0', () => {
  for (const extra of [{}, {in: {type: 'cut', dur: 0.1}}]) {
    const s = story([photo('open', 0, 3, extra), world('b', 3, 6, {in: {type: 'whip-pan', dur: 0.4, direction: 'left'}})]);
    const model = resolveModule(s.scenes[0], s);
    const ops = photoSceneTimeline(model);
    assert.equal(opacityAt(ops, 'open-media', 0), 1, JSON.stringify(extra));
    assert.equal(model.motion.enterFrom.opacity, 1);
  }
});

test('a typed transition dresses the scene; a lone scene and params.enter / exit still fade', () => {
  // A whip-pan into the photo-scene: the transition moves the layer; the module never fades under it.
  const s = story([world('a', 0, 3), photo('fridge', 3, 6, {in: {type: 'whip-pan', dur: 0.4, direction: 'right'}})]);
  const whip = resolveModule(s.scenes[1], s);
  assert.equal(whip.content.enter, 'cut');
  assert.equal(opacityAt(photoSceneTimeline(whip), 'fridge-media', 3.1), 1);
  // Nothing before or after (after a gap): the old fade in and out.
  const lone = story([photo('lone', 2, 6)]);
  const faded = resolveModule(lone.scenes[0], lone);
  assert.deepEqual([faded.content.enter, faded.content.exit], ['fade', 'fade']);
  const ops = photoSceneTimeline(faded);
  assert.equal(opacityAt(ops, 'lone-media', 2), 0);
  assert.ok(opacityAt(ops, 'lone-media', 2.2) < 1);
  assert.ok(opacityAt(ops, 'lone-media', 5.9) < 1);
  // Asked for: a fade into a cut.
  const asked = story([world('a', 0, 3), photo('fridge', 3, 6, {in: {type: 'cut'}}, {enter: 'fade', exit: 'fade'})]);
  const m = resolveModule(asked.scenes[1], asked);
  assert.deepEqual([m.content.enter, m.content.exit], ['fade', 'fade']);
  assert.equal(opacityAt(photoSceneTimeline(m), 'fridge-media', 3), 0);
  assert.throws(() => resolveModule(photo('x', 3, 6, {}, {enter: 'pop'}), asked), /params\.enter must be one of cut, fade/);
});

test('scenePassage reads the scene\'s own transition and the change after it', () => {
  const s = story([world('a', 0, 3), photo('p', 3, 6, {in: {type: 'cut', dur: 0.1}}), world('b', 6, 9, {in: {type: 'fade', dur: 0.4}})]);
  assert.deepEqual(scenePassage(s, s.scenes[1]), {in: {type: 'cut', dur: 0.1}, out: {type: 'fade', dur: 0.4}, after: true, opening: false, track: 0});
  assert.deepEqual(scenePassage(s, s.scenes[0]), {in: null, out: {type: 'cut', dur: 0.1}, after: false, opening: true, track: 0});
  assert.equal(scenePassage(s, s.scenes[2]).out, null);
});

test('evidence-clip and product-demo cut with their plates too', () => {
  const evidence = {id: 'ev', module: 'evidence-clip', start: 3, end: 6, in: {type: 'cut'}, params: {media: {src: 'assets/evidence/page.mp4'}, viewport: {width: 1280, height: 800}, source: {publisher: 'Example'}}};
  const s1 = story([world('a', 0, 3), evidence, world('b', 6, 9)]);
  const ev = resolveModule(evidence, s1);
  assert.equal(opacityAt(evidenceClipTimeline(ev), 'ev-media', 3), 1);
  assert.equal(opacityAt(evidenceClipTimeline(ev), 'ev-media', 5.95), 1);
  const demo = {id: 'demo', module: 'product-demo', start: 0, end: 4, params: {media: {src: 'assets/demo/flow.mp4'}, actions: [{at: 1.5, type: 'click', box: {x: 100, y: 100, width: 200, height: 60}}]}};
  const s2 = story([demo]);
  const pd = resolveModule(demo, s2);
  assert.equal(pd.content.enter, 'cut', 'opens the video whole');
  assert.equal(opacityAt(productDemoTimeline(pd), 'demo-media', 0), 1);
});
