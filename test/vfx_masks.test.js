// VFX silhouettes (kit/core/vfx/mask.mjs, silhouette.mjs; docs/VFX_LAYER_RFC.md
// phase 8): the (m) effects draw round a module's card or a cast member as
// drawn, validation of `mask`, the plan placing a cue on its mask's feet, the
// plan's JSON actor, and the runtime drawing them exactly as the import does.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {STORY_VFX_MASKED, resolveStory, validateStory} from '@launchclip/core/story.mjs';
import {resolveModule} from '@launchclip/core/modules.mjs';
import {VFX_MASKED, VFX_MODULES} from '@launchclip/core/vfx/catalog.mjs';
import {vfxPlan, vfxSounds} from '@launchclip/core/vfx/plan.mjs';
import {paintVfx} from '@launchclip/core/vfx/paint.mjs';
import {castSilhouette} from '@launchclip/core/vfx/mask.mjs';
import {silhouette, vfxActorFromWire, vfxActorWire, vfxStandIn} from '@launchclip/core/vfx/silhouette.mjs';
import {VFX_RUNTIME} from '@launchclip/core/vfx/runtime.mjs';
import {compileStoryToHyperFrames} from '../kit/hyperframes/story-compiler.mjs';

const EXAMPLE = new URL('../examples/story/vfx-masks-9x16/', import.meta.url);
const STORY = JSON.parse(readFileSync(new URL('storyboard.json', EXAMPLE), 'utf8'));
const resolved = () => resolveStory(structuredClone(STORY), {words: []});
const resolver = story => scene => resolveModule(scene, story);

test('the silhouette effects are the catalogue entries that draw round an actor, named alike in the story contract', () => {
  assert.deepEqual(STORY_VFX_MASKED, [...VFX_MASKED]);
  assert.equal(VFX_MASKED.length, 14);
  for (const name of VFX_MASKED) assert.ok(VFX_MODULES[name].meta.actor, name);
});

test('silhouette scan-fills shapes and strokes into a mask and pixels, feet at 0, 0, and survives the plan JSON', () => {
  const sil = silhouette([{closed: true, fill: '#ff0000', points: [[0, 0], [12, 0], [12, 12], [0, 12]]}, {closed: false, fill: 'none', stroke: '#00ff00', width: 6, points: [[6, 12], [6, 24]]}], {fx: 6, fy: 24, grid: 3});
  assert.deepEqual([sil.w, sil.h, sil.at], [6, 10, [2, 8]]);
  assert.equal(sil.mask.data.filter(Boolean).length, sil.pixels.filter(Boolean).length);
  assert.equal(sil.pixels[2 * sil.w + 2], 0xff0000ff, 'the fill, as the painter packs it');
  const back = vfxActorFromWire(JSON.parse(JSON.stringify(vfxActorWire(sil))));
  assert.deepEqual([...back.mask.data], [...sil.mask.data]);
  assert.deepEqual([...back.pixels], [...sil.pixels]);
  assert.deepEqual([back.x, back.y, back.head, back.chest], [sil.x, sil.y, sil.head, sil.chest]);
  assert.equal(vfxStandIn(), vfxStandIn(), 'one stand-in object, so effects cache its shape');
});

test('a cast silhouette covers the character where it is drawn, inside its reach', () => {
  const story = resolved(), scene = story.scenes[1], model = resolveModule(scene, story);
  for (const actor of model.content.actors) {
    const sil = castSilhouette(actor, 0.5, 6);
    const [left, top] = [sil.at[0] + sil.x, sil.at[1] + sil.y];
    assert.ok(left * 6 >= actor.reach.left - 12 && (left + sil.w) * 6 <= actor.reach.right + 12, `${actor.id} x within its reach`);
    assert.ok(top * 6 >= actor.reach.top - 12 && (top + sil.h) * 6 <= actor.reach.bottom + 12, `${actor.id} y within its reach`);
    assert.ok(sil.mask.data.filter(Boolean).length > 0.3 * sil.w * sil.h, `${actor.id} fills a body, not an outline`);
  }
});

test('mask validates: module or cast:<id> on a silhouette effect only, never with x or y', () => {
  assert.deepEqual(validateStory(STORY).errors, []);
  const bad = structuredClone(STORY);
  bad.scenes[0].vfx = [{effect: 'frozen', at: 1, mask: 'card'}, {effect: 'frozen', at: 1, mask: 'cast:maya'}, {effect: 'poof', at: 1, mask: 'module'}, {effect: 'halo', at: 1, x: 0.5}];
  const errors = validateStory(bad).errors.join('\n');
  for (const text of ['vfx[0].mask must be "module"', 'vfx[1].mask "cast:maya" needs a cast-scene', 'vfx[2].mask applies only to the silhouette effects', 'vfx[3].x does not apply']) assert.ok(errors.includes(text), text);
});

test('the plan sits each silhouette cue on its mask, a status starts on its moment and sounds there', () => {
  const story = resolved();
  assert.throws(() => vfxPlan(story), /needs \{resolve\}/);
  const plan = vfxPlan(story, {resolve: resolver(story)});
  const [scanner, , frozen, electrified] = plan.cues;
  const card = resolveModule(story.scenes[0], story).rect;
  assert.deepEqual([scanner.x, scanner.y], [Math.round((card.x + card.width / 2) / 6), Math.round((card.y + card.height) / 6)]);
  assert.notDeepEqual([frozen.x, frozen.y], [electrified.x, electrified.y], 'each cast member has its own feet');
  assert.equal(frozen.start, 3.4, 'a status loop starts on its moment');
  assert.equal(frozen.end, 8, 'and lasts its scene');
  assert.deepEqual(vfxSounds(story).filter(sound => sound.effect === 'frozen').map(sound => sound.at), [3.4]);
  // without a mask: a cast scene's first member, else the card
  story.scenes[1].vfx = [{effect: 'halo', at: 4}];
  story.scenes[0].vfx = [{effect: 'glitch', at: 1}];
  const plain = vfxPlan(story, {resolve: resolver(story)});
  assert.deepEqual([plain.cues[0].x, plain.cues[0].y], [scanner.x, scanner.y]);
  assert.deepEqual([plain.cues[1].x, plain.cues[1].y], [electrified.x, electrified.y]);
  story.scenes[1].vfx = [{effect: 'halo', at: 4, mask: 'cast:nobody'}];
  assert.throws(() => vfxPlan(story, {resolve: resolver(story)}), /names no cast member/);
});

function recorder() {
  const ctx = {createImageData: (w, h) => ({width: w, height: h, data: new Uint8ClampedArray(w * h * 4)}), putImageData(image) { ctx.image = image; }};
  return ctx;
}
const digest = ctx => createHash('sha256').update(ctx.image.data).digest('hex');

test('the runtime draws the silhouette effects byte for byte as the import, and the page inlines the masks', async () => {
  const story = resolved(), plan = vfxPlan(story, {resolve: resolver(story)}), runtimePlan = structuredClone(plan);
  const sandbox = {window: {}, atob};
  vm.runInNewContext(VFX_RUNTIME, sandbox);
  for (const t of [0.5, 1.2, 2.3, 2.5, 3.5, 4.2, 6.5, 1.2]) {
    const [c1, l1, c2, l2] = [recorder(), recorder(), recorder(), recorder()];
    paintVfx(c1, l1, plan, t);
    sandbox.window.lcVfx.paint(c2, l2, runtimePlan, t);
    assert.equal(digest(c1), digest(c2), `colour at ${t}`);
    assert.equal(digest(l1), digest(l2), `light at ${t}`);
    assert.ok(c1.image.data.some(Boolean) || l1.image.data.some(Boolean), `draws at ${t}`);
  }
  const {html} = await compileStoryToHyperFrames(story, {write: false, sourceDir: new URL('.', EXAMPLE).pathname});
  assert.ok(html.includes(plan.cues[2].opts.actor.pixels), 'the plan carries the cast mask');
  const source = readFileSync(new URL('../kit/remotion/StoryComposition.tsx', import.meta.url), 'utf8');
  assert.match(source, /vfxPlan\(story, \{ resolve: \(scene: any\) => resolveModule\(scene, story\) \}\)/);
});
