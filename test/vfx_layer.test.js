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
import {VFX_EFFECTS, VFX_EFFECT_NAMES, VFX_MODULES, VFX_TRANSITIONS} from '@launchclip/core/vfx/catalog.mjs';
import {STORY_VFX_TRANSITIONS} from '@launchclip/core/story.mjs';
import {VFX_COVER_TRANSITIONS, sceneWindows} from '@launchclip/core/transitions.mjs';
import {rampOf, vfxPlan, vfxSounds} from '@launchclip/core/vfx/plan.mjs';
import {drawVfxFrame, paintVfx, vfxWordAt} from '@launchclip/core/vfx/paint.mjs';
import {VFX_RUNTIME} from '@launchclip/core/vfx/runtime.mjs';
import {SFX_FAMILY_NAMES} from '@launchclip/core/sound/options.mjs';
import {compileStoryToHyperFrames} from '../kit/hyperframes/story-compiler.mjs';
import {bindCues} from '../src/finish.js';
import {measureCover, measurePeak} from '../scripts/vfx-peaks.mjs';
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
  assert.match(html, /window\.lcVfx\.paint\(color, light, plan, t\); window\.lcVfx\.words\(words, plan, t\)/);
  assert.match(html, /onUpdate: function \(\) \{ paint\(clock\.t\); \}/);
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

const HITS = new URL('../examples/story/vfx-hits-9x16/', import.meta.url);
const hitsStory = () => resolveStory(JSON.parse(readFileSync(new URL('storyboard.json', HITS), 'utf8')), {words: JSON.parse(readFileSync(new URL('NARRATION.json', HITS), 'utf8'))});

test('celebration hits draw their words as brand text, moved alike in both renderers; vfx.words "pixel" keeps the pixel font', async () => {
  const plan = vfxPlan(hitsStory());
  const crit = plan.cues.find(cue => cue.effect === 'crit-number');
  assert.deepEqual([crit.words, crit.opts], [false, {text: '4×', label: 'FASTER'}]);
  assert.deepEqual(plan.cues.find(cue => cue.effect === 'combo-counter').opts, {count: 3, label: 'CHANGES'});
  assert.deepEqual(plan.words.map(word => word.text), ['SHIP IT', '4×', 'FASTER', 'x3 CHANGES', 'MILESTONE', '12 MIN BUILDS']);
  assert.match(plan.words[0].font, /Anton/);
  const four = plan.words[1];
  assert.equal(vfxWordAt(four, four.start - 0.01, 6).opacity, '0', 'not before its effect');
  assert.match(vfxWordAt(four, four.start, 6).transform, /scale\(1\.7\)/, 'slams in big');
  assert.deepEqual(vfxWordAt(four, four.start + 0.6, 6), {opacity: '1', transform: 'translate(-50%, -50%) translate(0px, 0px) scale(1)'});
  assert.equal(vfxWordAt(four, four.start + 1.2, 6).opacity, '0', 'gone with its pop');
  // the runtime's word painter writes exactly vfxWordAt's styles
  const sandbox = {window: {}};
  vm.runInNewContext(VFX_RUNTIME, sandbox);
  for (const t of [0.5, 2.3, 2.6, 3.2, 4.7, 5.5]) {
    const nodes = plan.words.map(() => ({style: {}}));
    sandbox.window.lcVfx.words(nodes, plan, t);
    plan.words.forEach((word, i) => assert.deepEqual({...nodes[i].style}, vfxWordAt(word, t, plan.grid), `${word.text} at ${t}`));
  }
  const {html} = await compileStoryToHyperFrames(hitsStory(), {write: false, sourceDir: new URL('.', HITS).pathname});
  assert.match(html, /<div id="lc-vfx-word-1" data-launchclip-vfx="word"[^>]*font-family:&#39;Anton&#39;[^>]*>4×<\/div>/);
  const pixel = hitsStory();
  pixel.vfx = {words: 'pixel'};
  const pixelPlan = vfxPlan(pixel);
  assert.deepEqual(pixelPlan.words, []);
  assert.ok(pixelPlan.cues.every(cue => cue.words === undefined));
  assert.match(validateStory({...pixel, vfx: {words: 'comic'}}).errors.join('\n'), /vfx\.words must be/);
});

const TRANSITIONS = new URL('../examples/story/vfx-transitions-9x16/', import.meta.url);
const transitionsStory = () => resolveStory(JSON.parse(readFileSync(new URL('storyboard.json', TRANSITIONS), 'utf8')), {words: []});

test('the nine VFX transitions: one list everywhere, a known sound and a measured full cover each', () => {
  assert.deepEqual(STORY_VFX_TRANSITIONS, [...VFX_COVER_TRANSITIONS]);
  assert.deepEqual(Object.keys(VFX_TRANSITIONS), [...VFX_COVER_TRANSITIONS]);
  for (const [type, info] of Object.entries(VFX_TRANSITIONS)) {
    assert.ok(SFX_FAMILY_NAMES.includes(info.sfx), `${type}: ${info.sfx}`);
    assert.deepEqual(info.cover, measureCover(info.module), `${type} cover (rerun node scripts/vfx-peaks.mjs)`);
  }
});

test('a VFX transition validates like a dot-wipe: track 0 only, a cover colour, no dot-wipe options', () => {
  const raw = JSON.parse(readFileSync(new URL('storyboard.json', TRANSITIONS), 'utf8'));
  assert.deepEqual(validateStory(raw).errors, []);
  raw.scenes[1].in = {type: 'burn-away', dur: 0.9, cover: 0.5, color: 'nope'};
  raw.scenes[2].track = 1;
  const errors = validateStory(raw).errors.join('\n');
  assert.match(errors, /scenes\[1\]\.in\.cover is a dot-wipe option/);
  assert.match(errors, /scenes\[1\]\.in\.color must be one of/);
  assert.match(errors, /scenes\[2\]\.in\.type "slash-wipe" covers the whole frame/);
});

test('the plates swap at the midpoint, under a full cover drawn the same by the runtime', () => {
  const story = transitionsStory(), windows = sceneWindows(story), plan = vfxPlan(story);
  const sandbox = {window: {}};
  vm.runInNewContext(VFX_RUNTIME, sandbox);
  for (const scene of story.scenes.filter(scene => scene.in)) {
    const entry = windows.scenes.find(own => own.id === scene.id), mid = scene.start + scene.in.dur / 2;
    assert.deepEqual(entry.tweens.filter(tw => tw.role === 'in').map(tw => [tw.prop, tw.at, tw.to]), [['opacity', scene.start, 0], ['opacity', mid, 1]], `${scene.id} appears at the midpoint`);
    const cue = plan.cues.find(own => own.effect === scene.in.type);
    assert.ok(cue.quarter && cue.speed > 1, `${cue.effect} turned for portrait and sped up`);
    for (const t of [mid - 1 / 30, mid, mid + 1 / 30]) {
      const frame = drawVfxFrame(plan, t);
      assert.ok(frame.color.every(c => c >>> 24), `${cue.effect} covers every pixel at ${t}`);
    }
    for (const t of [scene.start + 0.1, mid + 0.3]) {
      const [c1, l1, c2, l2] = [recorder(), recorder(), recorder(), recorder()];
      paintVfx(c1, l1, plan, t);
      sandbox.window.lcVfx.paint(c2, l2, structuredClone(plan), t);
      assert.equal(digest(c1), digest(c2), `${cue.effect} colour at ${t}`);
      assert.equal(digest(l1), digest(l2), `${cue.effect} light at ${t}`);
    }
  }
  assert.equal(plan.cues.find(cue => cue.effect === 'crt-off').opts.color, STORY.brand.colors.accent, 'a named cover colour');
  assert.equal(plan.cues[0].opts.color, STORY.brand.colors.ink, 'the ink by default');
  const wide = vfxPlan(resolveStory({...JSON.parse(readFileSync(new URL('storyboard.json', TRANSITIONS), 'utf8')), format: {width: 1920, height: 1080, fps: 30, duration: 16}}, {words: []}));
  assert.deepEqual([wide.cues[0].x, wide.cues[0].y, wide.cues[0].quarter], [0, 0, undefined], 'landscape: the screen as drawn');
  assert.deepEqual(vfxSounds(story).filter(sound => sound.effect === 'shatter').map(sound => [sound.at, sound.cue]), [[story.scenes[3].start, 'snap']]);
});

test('pixel-dissolve is retro only; the retro-pixel family keeps pixel words and a crisp picture', async () => {
  const raw = JSON.parse(readFileSync(new URL('storyboard.json', TRANSITIONS), 'utf8'));
  delete raw.vfx;
  assert.match(validateStory(raw).errors.join('\n'), /"pixel-dissolve" is retro only/);
  assert.deepEqual(validateStory({...raw, look: 'pixel-arcade'}).errors, []);
  const {generateStyle} = await import('@launchclip/core/style-seed.mjs');
  const {applyStyle, validateStylePack} = await import('@launchclip/core/style.mjs');
  const pack = generateStyle({seed: '1a2b3c4d', constraints: {family: 'retro-pixel'}});
  assert.deepEqual([pack.look, pack.vfx, pack.brand.fonts.body, pack.layouts.panel], [undefined, {words: 'pixel'}, 'jetbrains-mono', {...pack.layouts.panel, treatment: 'outline', radius: 0}]);
  assert.deepEqual(validateStylePack(pack).errors, []);
  const styled = applyStyle({...raw, look: undefined}, pack);
  assert.equal((styled.story ?? styled).vfx.words, 'pixel');
  assert.equal(generateStyle({seed: '1a2b3c4d'}).vfx, undefined, 'no family, nothing added');
  assert.throws(() => generateStyle({seed: '1a2b3c4d', constraints: {family: 'vaporwave'}}), /family must be one of retro-pixel/);
});
