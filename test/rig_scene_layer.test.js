// The per-frame rig layer (kit/core/characters/rig-scene-layer.mjs) in both
// renderers: where the layer sits in a cast scene's tree, the HyperFrames
// emitter's proxy tween, and the inlined runtime (RIG_RUNTIME) drawing the
// same markup as rigSceneTree for any t, seeked in any order.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {resolveModule} from '@launchclip/core/modules.mjs';
import {charactersView} from '@launchclip/core/catalog-characters.mjs';
import {RIG_FRAME_STYLES} from '@launchclip/core/characters/rig-scene.mjs';
import {fillRigLayer, rigLayerId, rigScenePrepare, rigSceneTree} from '@launchclip/core/characters/rig-scene-layer.mjs';
import {emitCharacters} from '../kit/hyperframes/catalog-characters.mjs';
import {renderNode} from '../kit/hyperframes/catalog-b.mjs';
import {RIG_RUNTIME} from '../kit/hyperframes/rig-runtime.mjs';
import {rigRuntimeSource} from '../scripts/rig-runtime.mjs';

const fixture = name => JSON.parse(readFileSync(new URL(`fixtures/parity/${name}.json`, import.meta.url), 'utf8'));

/** A parity fixture's cast scene, on the per-frame rig (story.cast.rig: "frame") or today's. */
function castModel(name, rig = true) {
  const {story, sceneId} = fixture(name);
  const cast = {...story.cast, ...(rig ? {rig: 'frame', style: RIG_FRAME_STYLES.includes(story.cast.style) ? story.cast.style : 'stick'} : {rig: 'ops'})};
  const model = resolveModule(story.scenes.find(scene => scene.id === sceneId), {...story, cast});
  if (rig) assert.ok(model.content.rigScene, `${name}: ${model.content.rigFallback}`);
  return model;
}
const RIG = castModel('characters-rig-rubber-hose-world');
const PLAN = RIG.content.rigScene;
const CANVAS = RIG.canvas;

const ids = node => (node && typeof node === 'object' ? (node.children ?? []).map(child => child.id ?? child.tag) : []);
const byId = (node, id) => (typeof node !== 'object' ? null : node.id === id ? node : (node.children ?? []).map(child => byId(child, id)).find(Boolean) ?? null);

test('the rig layer sits where the actors do: over the set, under its foreground, inside the camera wrappers', () => {
  const model = RIG;
  const view = charactersView(model);
  const layer = byId(view.front, rigLayerId(model));
  assert.ok(layer, 'rig layer in the scene tree');
  assert.deepEqual(layer.children, []);
  const parent = [view.front, ...view.front.children].find(node => node.children?.includes(layer));
  assert.equal(parent.children.at(-1).tag, 'svg', 'the foreground stays over the layer');
  assert.equal(parent.children.at(-2), layer);
  const plain = castModel('characters-rig-rubber-hose-world', false);
  assert.equal(byId(charactersView(plain).front, rigLayerId(plain)), null, 'no rigScene, no layer');
});

test('a video screen: the rig layer goes in the overlay, under its foreground', () => {
  const model = castModel('characters-screen');
  const view = charactersView(model);
  assert.ok(view.overlay, 'the fixture plays a video screen');
  const cam = view.overlay.children.length === 1 ? view.overlay.children[0] : view.overlay;
  assert.equal(ids(cam).at(-2), rigLayerId(model));
});

test('fillRigLayer puts the frame in the layer and leaves the rest of the tree shared', () => {
  const model = RIG;
  const view = charactersView(model);
  const tree = rigSceneTree(PLAN, 1, CANVAS);
  const filled = fillRigLayer(view, model, tree);
  assert.deepEqual(byId(filled.front, rigLayerId(model)).children, [tree]);
  assert.deepEqual(byId(view.front, rigLayerId(model)).children, [], 'the memoised view is untouched');
  assert.equal(filled.front.children[0].children[0], view.front.children[0].children[0], 'siblings off the path are shared');
});

test('HyperFrames: the emitter writes the empty layer and a proxy tween that paints it', () => {
  const model = RIG;
  const out = emitCharacters(model);
  assert.match(out.html, new RegExp(`<div id="${rigLayerId(model)}" style="[^"]*"></div>`));
  assert.match(out.motion, /window\.lcRigScene\(host, plan, prepared, clock\.t - 0, canvas\)/);
  assert.match(out.motion, /tl\.fromTo\(clock, \{t: 0\}, \{t: \d+(\.\d+)?, duration: [\d.]+, ease: 'none', immediateRender: false, onUpdate: paint\}, 0\);/);
  const plain = castModel('characters-rig-rubber-hose-world', false);
  assert.doesNotMatch(emitCharacters(plain).html, /-rig"/);
  assert.doesNotMatch(emitCharacters(plain).motion, /lcRigScene/);
});

test('RIG_RUNTIME is current (node scripts/rig-runtime.mjs)', async () => {
  const file = readFileSync(new URL('../kit/hyperframes/rig-runtime.mjs', import.meta.url), 'utf8');
  assert.equal(file, await rigRuntimeSource(), 'stale: run node scripts/rig-runtime.mjs');
});

test('the inlined runtime paints what rigSceneTree draws, seeked in any order', () => {
  const window = {};
  vm.runInNewContext(RIG_RUNTIME, {window});
  assert.equal(typeof window.lcRigScene, 'function');
  const prepared = JSON.parse(JSON.stringify(rigScenePrepare(PLAN)));
  const times = [0, 0.5, 1.1, 2.4, 4.3, 4.47, 6.9];
  const paint = t => { const host = {innerHTML: ''}; window.lcRigScene(host, PLAN, prepared, t, CANVAS); return host.innerHTML; };
  const inOrder = times.map(paint);
  times.forEach((t, i) => assert.equal(inOrder[i], renderNode(rigSceneTree(PLAN, t, CANVAS)), `t=${t}`));
  // One host seeked backwards and forwards, as a scrubbed timeline is.
  const host = {innerHTML: ''};
  for (const i of [6, 0, 4, 2, 5, 1, 3, 3]) { window.lcRigScene(host, PLAN, prepared, times[i], CANVAS); assert.equal(host.innerHTML, inOrder[i], `seek to ${times[i]}`); }
});
