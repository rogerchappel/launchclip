// Loop (docs/FLUID_MOTION_RFC.md §8, kit/core/loop.mjs): with loop the last
// frame equals the first. The phase-2 loop-seam check is the acceptance test:
// a looped module passes it, the same module without loop fails it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MODULES, catalogHTimeline} from '@launchclip/core/catalog-h.mjs';
import {sceneMotionFindings} from '@launchclip/core/motion-check.mjs';
import {fitBpm, idleOps} from '@launchclip/core/fluid-motion.mjs';
import {resolveModule} from '@launchclip/core/modules.mjs';
import {validateStory} from '@launchclip/core/story.mjs';
import {SAMPLES} from '../scripts/element-samples.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const resolve = (module, loop) => ({...MODULES[module].resolve(SAMPLES[module], {id: 'scene', start: 1, duration: 9, format: {width: 1080, height: 1920, fps: 30}, brand, aspect: '9:16', hits: [], grammar: null, loop}), module});
const findings = model => sceneMotionFindings({id: 'scene', motion: model.motion, ops: catalogHTimeline(model), loop: {start: model.start, end: model.end}});

for (const module of ['node-graph', 'icon-grid', 'social-wall', 'item-list']) {
  test(`${module}: looped, its last frame is its first and nothing else in the check trips; unlooped, the seam shows`, () => {
    const looped = resolve(module, true);
    assert.equal(looped.loop, true);
    assert.deepEqual(looped.motion.exitTo, looped.motion.enterFrom, 'the root leaves into its entrance pose');
    assert.deepEqual(findings(looped).map(f => `${f.rule}: ${f.detail}`), []);
    assert.deepEqual(findings(resolve(module, false)).map(f => f.rule), ['loop-seam']);
  });
}

test('node-graph: a loop keeps pulses on a beat that divides the scene and none after the return starts', () => {
  const model = resolve('node-graph', true), c = model.content;
  assert.ok(Math.abs(model.duration / c.beat - Math.round(model.duration / c.beat)) < 1e-3, `${model.duration} s is whole beats of ${c.beat}`);
  assert.ok(c.pulses.every(p => p.arrive < model.motion.exitStart));
});

test('idle: fitTo stretches the breath to whole half-cycles that land at rest on it, none under 1.6 s', () => {
  const ops = [];
  idleOps(ops, 'x', 0, 1, 9, {bob: 4, tilt: 1}, 9.5);
  const tweens = ops.filter(op => op.type === 'tween');
  assert.ok(tweens.every(op => op.duration >= 1.6));
  assert.equal(Math.round((tweens.at(-1).start + tweens.at(-1).duration) * 1e4) / 1e4, 9.5);
  assert.deepEqual(tweens.at(-1).to, {y: 0, rotation: 0});
  assert.equal(fitBpm(120, 9), 120);
  assert.ok(Math.abs(9.2 / (60 / fitBpm(120, 9.2)) - 18) < 1e-9, 'the nearest whole count of beats');
});

test('scene.loop: validated as a boolean, and refused by modules whose timeline cannot bring elements home', () => {
  const story = {format: {width: 1080, height: 1920, fps: 30, duration: 6}, brand, scenes: [{id: 'a', module: 'node-graph', start: 0, end: 6, loop: 'yes', params: SAMPLES['node-graph']}]};
  assert.ok(validateStory(story).errors.some(e => /scenes\[0\]\.loop must be true or false/.test(e)));
  assert.throws(() => resolveModule({id: 'b', module: 'hook-title', start: 0, end: 4, loop: true, params: {text: 'Hello'}}, story), /loop: true is for catalogue H and I modules/);
  assert.equal(resolveModule({...story.scenes[0], loop: true}, story).loop, true);
});

test('a short that loops: the hand-back lands on the last frame, and a loop to a scene other than the opener warns', async () => {
  const {sceneWindows} = await import('@launchclip/core/transitions.mjs');
  const {storyLoopFindings} = await import('@launchclip/core/story-loop.mjs');
  const scenes = [{id: 'a', module: 'node-graph', start: 0, end: 4, params: SAMPLES['node-graph']}, {id: 'b', module: 'icon-grid', start: 4, end: 8, params: SAMPLES['icon-grid']}];
  const story = {format: {width: 1080, height: 1920, fps: 30, duration: 8}, brand, scenes, ending: {loop_to: 'a', in: {type: 'fade', dur: 0.4}}};
  const {loop} = sceneWindows(story);
  const lastFrame = 8 - 1 / 30;
  assert.ok(Math.max(...loop.tweens.map(tw => tw.at + tw.duration)) <= lastFrame + 1e-6, 'the fade is done on the last frame');
  assert.deepEqual(storyLoopFindings(story), []);
  assert.deepEqual(storyLoopFindings({...story, ending: {loop_to: 'b'}}).map(f => [f.rule, f.severity, f.ids]), [['loop-target', 'warning', ['b', 'a']]]);
});
