// The VFX layer (kit/core/vfx): the catalogue (names, sound pairings,
// measured peaks), scene.vfx validation and anchors, the plan, the runtime
// HyperFrames inlines drawing exactly what Remotion's import draws, the
// compiled page, and the effects' sounds on their peaks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {STORY_VFX_EFFECTS, resolveStory, validateStory} from '@launchclip/core/story.mjs';
import {VFX_EFFECTS, VFX_EFFECT_NAMES, VFX_MODULES} from '@launchclip/core/vfx/catalog.mjs';
import {rampOf, vfxPlan, vfxSounds} from '@launchclip/core/vfx/plan.mjs';
import {paintVfx} from '@launchclip/core/vfx/paint.mjs';
import {VFX_RUNTIME} from '@launchclip/core/vfx/runtime.mjs';
import {SFX_FAMILY_NAMES} from '@launchclip/core/sound/options.mjs';
import {compileStoryToHyperFrames} from '../kit/hyperframes/story-compiler.mjs';
import {bindCues} from '../src/finish.js';
import {measurePeak} from '../scripts/vfx-peaks.mjs';
import {RUNTIME_FILE, vfxRuntimeSource} from '../scripts/vfx-runtime.mjs';

const EXAMPLE = new URL('../examples/story/vfx-impacts-9x16/', import.meta.url);
const STORY = JSON.parse(readFileSync(new URL('storyboard.json', EXAMPLE), 'utf8'));
const WORDS = JSON.parse(readFileSync(new URL('NARRATION.json', EXAMPLE), 'utf8'));
const resolved = () => resolveStory(structuredClone(STORY), {words: WORDS});

test('the story contract names exactly the catalogue, and every effect has a known sound and its measured peak', () => {
  assert.deepEqual(STORY_VFX_EFFECTS, [...VFX_EFFECT_NAMES]);
  assert.deepEqual(Object.keys(VFX_EFFECTS), [...VFX_EFFECT_NAMES]);
  for (const [name, info] of Object.entries(VFX_EFFECTS)) {
    assert.ok(SFX_FAMILY_NAMES.includes(info.sfx), `${name}: ${info.sfx}`);
    assert.equal(info.peak, measurePeak(VFX_MODULES[name]), `${name} peak (rerun node scripts/vfx-peaks.mjs)`);
    assert.ok(VFX_MODULES[name].meta.duration <= 6, `${name}: simulated effects stay at 6 s or less`);
  }
});

test('scene.vfx validates its cues and resolves word anchors', () => {
  assert.deepEqual(validateStory(STORY).errors, []);
  const bad = structuredClone(STORY);
  bad.scenes[0].vfx = [{effect: 'bullet-impact', at: 1, x: 2, color: 'nope', align: 'end', seed: 0, flip: 'yes', angle: 400, light: 3, sfx: ''}, {at: 1, effect: 'poof'}, 'x', {effect: 'poof'}];
  const errors = validateStory(bad).errors.join('\n');
  for (const field of ['.effect must be one of', '.x must be', '.color must name', '.align must be', '.seed must be', '.flip must be', '.angle must be', '.light must be', '.sfx must be', 'vfx[2] must be an object', 'vfx[3].at is required']) assert.match(errors, new RegExp(field.replace(/[.[\]]/g, '\\$&')), field);
  const story = resolved();
  assert.equal(story.scenes[0].vfx[0].at, 0.9);
  assert.equal(story.scenes[1].vfx[3].at, 5.22);
});

test('the plan places cues on the art grid, aligns them on their peak and maps brand colours to ramps', () => {
  const plan = vfxPlan(resolved());
  assert.deepEqual([plan.aw, plan.ah, plan.grid], [180, 320, 6]);
  const firework = plan.cues.find(cue => cue.effect === 'firework-burst');
  assert.equal(firework.start, Math.round((5.22 - VFX_EFFECTS['firework-burst'].peak) * 1000) / 1000);
  assert.deepEqual([firework.x, firework.y], [90, 54]);
  assert.deepEqual(firework.palette, rampOf(STORY.brand.colors.accent, STORY.brand.colors.bg));
  assert.equal(rampOf('#ff0000', '#000000').length, 8);
  assert.equal(vfxPlan({format: {width: 1920, height: 1080}, scenes: [{id: 's1'}]}), null);
  assert.equal(vfxPlan({format: {width: 1920, height: 1080}, scenes: [{id: 's1', end: 4, vfx: [{effect: 'sunburst', at: 1}]}]}).cues[0].end, 4, 'a loop ends with its scene');
});

/** A 2D context whose putImageData keeps the last image. */
function recorder() {
  const ctx = {createImageData: (w, h) => ({width: w, height: h, data: new Uint8ClampedArray(w * h * 4)}), putImageData(image) { ctx.image = image; }};
  return ctx;
}
const digest = ctx => createHash('sha256').update(ctx.image.data).digest('hex');

test('VFX_RUNTIME is current and draws the same bytes as the import, frame by frame', async () => {
  assert.equal(readFileSync(RUNTIME_FILE, 'utf8'), await vfxRuntimeSource(), 'rerun node scripts/vfx-runtime.mjs');
  const sandbox = {window: {}};
  vm.runInNewContext(VFX_RUNTIME, sandbox);
  const plan = vfxPlan(resolved());
  const runtimePlan = structuredClone(plan);
  let drew = 0;
  // forward through the story, then a backwards seek
  for (const t of [0.9, 0.95, 1.0, 2.33, 3.3, 3.6, 4.3, 5.4, 5.9, 1.0, 3.3]) {
    const [c1, l1, c2, l2] = [recorder(), recorder(), recorder(), recorder()];
    paintVfx(c1, l1, plan, t);
    sandbox.window.lcVfx.paint(c2, l2, runtimePlan, t);
    assert.equal(digest(c1), digest(c2), `colour at ${t}`);
    assert.equal(digest(l1), digest(l2), `light at ${t}`);
    if (c1.image.data.some(Boolean) || l1.image.data.some(Boolean)) drew += 1;
  }
  assert.ok(drew >= 9, `the cues draw (${drew} frames)`);
});

test('the HyperFrames page carries both canvases, the runtime and the proxy tween; no cues, nothing added', async () => {
  const {html} = await compileStoryToHyperFrames(resolved(), {write: false, sourceDir: new URL('.', EXAMPLE).pathname});
  assert.match(html, /<canvas id="lc-vfx-color"[^>]*width="180" height="320"[^>]*z-index:78500/);
  assert.match(html, /<canvas id="lc-vfx-light"[^>]*mix-blend-mode:plus-lighter/);
  assert.ok(html.includes('window.lcVfx = window.lcVfx ||'));
  assert.match(html, /window\.lcVfx\.paint\(color, light, plan, clock\.t\)/);
  const plain = structuredClone(STORY);
  for (const scene of plain.scenes) delete scene.vfx;
  const {html: none} = await compileStoryToHyperFrames(resolveStory(plain, {words: WORDS}), {write: false, sourceDir: new URL('.', EXAMPLE).pathname});
  assert.ok(!none.includes('lc-vfx') && !none.includes('lcVfx'));
});

test('each cue plays its paired sound on its peak; sfx none is silent and a named family wins', () => {
  const story = resolved();
  assert.deepEqual(vfxSounds(story).map(sound => [sound.at, sound.cue]), [[0.9, 'impact'], [2.3, 'impact'], [3.2, 'thud'], [3.5, 'pop'], [4.1, 'pop'], [5.22, 'sparkle']]);
  story.scenes[0].vfx[0].sfx = 'none';
  story.scenes[0].vfx[1].sfx = 'snap';
  story.scenes[1].vfx[3].align = 'start';
  story.scenes[1].vfx[3].at = 5;
  assert.deepEqual(vfxSounds(story).map(sound => [sound.at, sound.cue]), [[2.3, 'snap'], [3.2, 'thud'], [3.5, 'pop'], [4.1, 'pop'], [5 + VFX_EFFECTS['firework-burst'].peak, 'sparkle']]);
  const {cues} = bindCues(story, {models: {}});
  assert.ok(cues.some(cue => cue.cue === 'snap' && cue.at === 2.3 && cue.event === 'vfx hit-spark'));
  assert.ok(cues.some(cue => cue.cue === 'thud' && cue.at === 3.2));
});
