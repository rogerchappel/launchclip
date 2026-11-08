// Cinematic transitions of light and camera (kit/core/light-sweep.mjs,
// kit/core/transitions.mjs light-sweep and push-blur) and heavy sub-frame
// motion blur (kit/core/motion-blur.mjs): the story contract, the layer
// tweens both renderers evaluate, the shared streak markup, and what the
// HyperFrames compiler and the Remotion composition draw.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {STORY_TRANSITIONS, resolveStory, validateStory} from '@launchclip/core/story.mjs';
import {LIGHT_SWEEP_LAYER, PUSH_BLUR, SMEAR_PROPS, TRANSITION_TYPES, gsapVars, layerStateAt, layerStyle, sceneWindows, smearFilterId, smearFilterSvg, transitionTweens} from '@launchclip/core/transitions.mjs';
import {LIGHT_SWEEP, lightSweepCss, lightSweepGsap, lightSweepHtml, lightSweepOptions, lightSweepProgress, lightSweepStreaks, lightSweeps} from '@launchclip/core/light-sweep.mjs';
import {MOTION_BLUR_GUARD_FILE} from '@launchclip/core/motion-blur.mjs';
import {getEase} from '@launchclip/core/motion.mjs';
import {compileStoryToHyperFrames} from '../kit/hyperframes/story-compiler.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXAMPLE = path.join(ROOT, 'examples/story/cinematic-transitions-9x16');
const size = {width: 1080, height: 1920};
const brand = {colors: {bg: '#0a0b08', primary: '#c8ff3a', accent: '#c8ff3a', ink: '#0a0b08', paper: '#f4f6ee'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const card = (id, start, end, extra = {}) => ({id, module: 'stat-card', start, end, params: {value: '12', label: 'videos a week', source: 'Example log'}, ...extra});
const raw = (scenes, extra = {}) => ({schema: 'launchclip.story.v1', lane: 'motion', brand, format: {width: 1080, height: 1920, fps: 30, duration: 12}, scenes, ...extra});
const two = (transition, extra) => raw([card('a', 0, 6), card('b', 6, 12, {in: transition})], extra);
const errorsOf = (story) => validateStory(story).errors;

test('light-sweep and push-blur are story transitions with validated options', () => {
  for (const type of ['light-sweep', 'push-blur']) assert.ok(STORY_TRANSITIONS.includes(type) && TRANSITION_TYPES.includes(type), type);
  assert.deepEqual(errorsOf(two({type: 'light-sweep', dur: 0.5})), []);
  assert.deepEqual(errorsOf(two({type: 'light-sweep', dur: 0.5, streaks: 4, angle: 30, color: '#ffffff'})), []);
  assert.deepEqual(errorsOf(two({type: 'push-blur', dur: 0.5, direction: 'left'})), []);
  assert.match(errorsOf(two({type: 'light-sweep', dur: 0.5, streaks: 7})).join('\n'), /in\.streaks must be a whole number of light streaks from 2 to 4/);
  assert.match(errorsOf(two({type: 'light-sweep', dur: 0.5, angle: 90})).join('\n'), /in\.angle must be the streaks' tilt from the horizontal, 20 to 80 degrees/);
  assert.match(errorsOf(two({type: 'light-sweep', dur: 0.5, color: 'lime'})).join('\n'), /in\.color must be one of accent, ink, paper or a #rrggbb hex/);
  assert.match(errorsOf(two({type: 'light-sweep', dur: 0.5, cover: 0.5})).join('\n'), /in\.cover is a dot-wipe option; "light-sweep" does not take it/);
  assert.match(errorsOf(two({type: 'push-blur', dur: 0.5, streaks: 3})).join('\n'), /in\.streaks is a light-sweep option; "push-blur" does not take it/);
  // The streaks cover the whole frame: track-0 only.
  const overlay = raw([card('a', 0, 12), card('b', 2, 5, {track: 1, in: {type: 'light-sweep', dur: 0.5}})]);
  assert.match(errorsOf(overlay).join('\n'), /"light-sweep" covers the whole frame/);
  // The loop ending takes them too.
  assert.deepEqual(errorsOf(raw([card('a', 0, 12)], {ending: {loop_to: 'a', in: {type: 'light-sweep', dur: 0.5, streaks: 2}}})), []);
});

test('light-sweep: the outgoing plate veils and drifts forward; the incoming one is hidden, then rises from under the veil', () => {
  const d = 0.5, tw = transitionTweens({type: 'light-sweep', dur: d}, size);
  const L = LIGHT_SWEEP_LAYER;
  const abs = (list, role) => list.map((t) => ({...t, at: 10 + t.start, role}));
  const incoming = abs(tw.in, 'in'), outgoing = abs(tw.out, 'out');
  const at = (list, t) => layerStateAt(t, list, getEase);
  // From the first frame the incoming plate is in its first state (held), not drawn.
  assert.deepEqual(pick(at(incoming, 10), ['opacity', 'veil', 'scale']), {opacity: 0, veil: 1, scale: L.scaleIn});
  assert.equal(at(incoming, 10 + d * L.rise - 0.01).opacity, 0);
  assert.ok(at(incoming, 10 + d * 0.6).opacity > 0.5);
  assert.deepEqual(pick(at(incoming, 10 + d), ['opacity', 'veil', 'scale']), {opacity: 1, veil: 0, scale: 1});
  // The outgoing plate is fully veiled by `veil` of the way and gone by the end.
  assert.equal(at(outgoing, 10 + d * L.veil).veil, 1);
  assert.ok(at(outgoing, 10 + d * 0.3).veil > 0.2 && at(outgoing, 10 + d * 0.3).veil < 1);
  assert.deepEqual(pick(at(outgoing, 10 + d), ['opacity', 'scale']), {opacity: 0, scale: L.scaleOut});
  // The veil is one filter: blur, darken, contrast.
  assert.equal(layerStyle({...at(outgoing, 10 + d * L.veil)}).filter, `blur(${L.blur}px) brightness(${1 - L.dim}) contrast(${1 + L.contrast})`);
  assert.deepEqual(gsapVars('veil', 1), {filter: `blur(${L.blur}px) brightness(${1 - L.dim}) contrast(${1 + L.contrast})`});
  assert.deepEqual(gsapVars('veil', 0), {filter: 'blur(0px) brightness(1) contrast(1)'});
});

test('push-blur: a push with a smear along the travel and an exposure dip, then a defocused arrival that racks sharp', () => {
  const d = 0.5, P = PUSH_BLUR;
  const up = transitionTweens({type: 'push-blur', dur: d}, size);
  const props = (list) => list.map((t) => t.prop);
  // Up by default: the smear is vertical and the content travels up.
  assert.ok(props(up.out).includes('smearY') && !props(up.out).includes('smearX'));
  const travel = up.out.find((t) => t.prop === 'y');
  assert.equal(travel.to, -P.travelOut * 1920);
  assert.equal(up.out.find((t) => t.prop === 'smearY').to, Math.round(P.smear * 1920 * 100) / 100);
  assert.equal(up.out.find((t) => t.prop === 'scale').to, P.scaleOut);
  const left = transitionTweens({type: 'push-blur', dur: d, direction: 'left'}, size);
  assert.ok(props(left.out).includes('smearX'));
  assert.equal(left.out.find((t) => t.prop === 'x').to, -P.travelOut * 1080);
  const abs = (list) => list.map((t) => ({...t, at: t.start}));
  const incoming = abs(up.in), outgoing = abs(up.out);
  const cut = d * P.cut, swapEnd = cut + d * P.swap / 2;
  // At the cut: the outgoing plate is pushed, smeared and dipped.
  const out = layerStateAt(swapEnd, outgoing, getEase);
  assert.equal(out.dip, 1);
  assert.equal(out.opacity, 0);
  assert.equal(layerStyle(layerStateAt(cut - 0.03, outgoing, getEase)).filter.startsWith('brightness('), true);
  // The incoming plate waits, held defocused, then racks into focus within
  // about six frames of the cut (most of its blur gone in four).
  assert.deepEqual(pick(layerStateAt(0, incoming, getEase), ['opacity', 'focus', 'scale']), {opacity: 0, focus: 1, scale: P.scaleIn});
  assert.ok(layerStateAt(cut + 4 / 30, incoming, getEase).focus < 0.35);
  assert.ok(layerStateAt(cut + 6 / 30, incoming, getEase).focus < 0.2);
  assert.deepEqual(pick(layerStateAt(d, incoming, getEase), ['opacity', 'focus', 'scale', 'y']), {opacity: 1, focus: 0, scale: 1, y: 0});
  assert.equal(layerStyle({...layerStateAt(cut, incoming, getEase), opacity: 1}).filter, `blur(${P.defocus}px) brightness(${1 - P.focusDim})`);
  // The smear is not the layer's CSS filter: an SVG filter both renderers draw.
  assert.deepEqual(SMEAR_PROPS, ['smearX', 'smearY']);
  assert.equal(layerStyle({...out, dip: 0}).filter, undefined);
  assert.equal(smearFilterId('s 3/x'), 'lc-smear-s_3_x');
  assert.match(smearFilterSvg('lc-smear-a', 0, 49.9), /<filter id="lc-smear-a"[^>]*><feGaussianBlur id="lc-smear-a-k" in="SourceGraphic" stdDeviation="0 49.9">/);
});

test('light sweep streaks: options, geometry and one progress variable both renderers drive', () => {
  assert.deepEqual(lightSweepOptions({}), {streaks: 3, angle: 64, color: 'accent'});
  assert.deepEqual(lightSweepOptions({streaks: 9, angle: 5, color: 'ink'}), {streaks: 4, angle: 20, color: 'ink'});
  const streaks = lightSweepStreaks(1080, 1920, {streaks: 3});
  assert.equal(streaks.length, 3);
  // Every streak covers the frame's diagonal and finishes inside the sweep.
  for (const streak of streaks) {
    assert.ok(streak.length > Math.hypot(1080, 1920));
    assert.ok(streak.offset + streak.span <= 1 + 1e-9);
  }
  const html = lightSweepHtml(1080, 1920, {streaks: 3, angle: 64, color: '#c8ff3a'});
  assert.equal((html.match(/lc-ls-core/g) ?? []).length, 3);
  assert.equal((html.match(/lc-ls-halo/g) ?? []).length, 3);
  assert.match(html, /rotate\(-64deg\) translateY\(calc\(\(clamp\(0, \(var\(--lc-ls\) - 0\) \/ 0\.78, 1\)/);
  assert.match(html, /rgba\(200,255,58,/);
  assert.match(lightSweepCss(1080, 1920), /\.lc-light-sweep \{[^}]*mix-blend-mode: screen;/);
  const s = resolveStory(two({type: 'light-sweep', dur: 0.5, streaks: 2}));
  const sweeps = lightSweeps(s, sceneWindows(s));
  assert.deepEqual(sweeps, [{id: 'lc-ls-b', sceneId: 'b', start: 6, dur: 0.5, streaks: 2, angle: 64, color: '#c8ff3a'}]);
  assert.equal(lightSweepProgress(sweeps[0], 5.9), 0);
  assert.equal(lightSweepProgress(sweeps[0], 6.25), 0.5);
  assert.equal(lightSweepProgress(sweeps[0], 6.5), 0);
  assert.deepEqual(lightSweepGsap(sweeps[0]), [
    'tl.set("#lc-ls-b", { opacity: 1 }, 6);',
    'tl.fromTo("#lc-ls-b", { "--lc-ls": 0 }, { "--lc-ls": 1, duration: 0.5, ease: "none", immediateRender: false }, 6);',
    'tl.set("#lc-ls-b", { opacity: 0 }, 6.5);'
  ]);
  // The loop ending sweeps too.
  const looped = resolveStory(raw([card('a', 0, 12)], {ending: {loop_to: 'a', in: {type: 'light-sweep', dur: 0.4}}}));
  assert.equal(lightSweeps(looped, sceneWindows(looped))[0].id, 'lc-ls-a-loop');
  assert.equal(LIGHT_SWEEP.z.hyperframes, 79000);
});

test('HyperFrames: the sweep sits over the scenes, the smear filter rides the outgoing scene, and blur writes its caption guard', async () => {
  const s = resolveStory(JSON.parse(await readFile(path.join(EXAMPLE, 'storyboard.json'), 'utf8')));
  const {html, warnings} = await compileStoryToHyperFrames(s, {write: false, sourceDir: EXAMPLE});
  assert.deepEqual(warnings, []);
  const sweep = html.indexOf('<div id="lc-ls-s2" class="lc-light-sweep"');
  assert.ok(sweep > html.indexOf('data-launchclip-scene="s3"'), 'the sweep is drawn after (over) every scene');
  assert.match(html, /tl\.fromTo\("#lc-ls-s2", \{ "--lc-ls": 0 \}/);
  // s2 leaves by push-blur: its outer element carries the smear filter.
  assert.match(html, /<div id="lc-scene-s2" [^>]*style="z-index:\d+;--lc-smear:none;filter:var\(--lc-smear\)"><svg class="lc-smear-defs"/);
  assert.match(html, /tl\.fromTo\("#lc-smear-s2-k", \{ attr: \{ stdDeviation: "0 0" \} \}, \{ attr: \{ stdDeviation: "0 49\.92" \}/);
  assert.match(html, /tl\.fromTo\("#lc-scene-s2", \{ "--lc-smear": "none" \}, \{ "--lc-smear": "url\(#lc-smear-s2\)"/);
  // The smear never reaches the layer's own filter tweens.
  assert.ok(!/smearY/.test(html));
  // With captions and a shutter over one frame, the compiler writes the guard.
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lc-cine-'));
  try {
    await writeFile(path.join(dir, 'words.json'), JSON.stringify({words: ['every', 'frame', 'lands', 'here'].map((text, i) => ({text, start: 0.3 + i * 0.4, end: 0.6 + i * 0.4}))}));
    const captioned = resolveStory({...JSON.parse(await readFile(path.join(EXAMPLE, 'storyboard.json'), 'utf8')), audio: {words: 'words.json'}, overlays: [{type: 'captions', preset: 'word-chip', position: 'low'}]});
    const project = path.join(dir, 'hf');
    await compileStoryToHyperFrames(captioned, {projectDir: project, sourceDir: dir, copyAssets: false});
    const guard = JSON.parse(await readFile(path.join(project, MOTION_BLUR_GUARD_FILE), 'utf8')).guard;
    assert.ok(guard.frames.length > 0 && guard.frames.every(Number.isInteger));
    assert.equal(guard.rect.width, 1080);
    assert.ok(guard.rect.y > 800 && guard.rect.height < 500);
    // The same story with a one-frame shutter needs none (and leaves none behind).
    await compileStoryToHyperFrames({...captioned, motion: {blur: true}}, {projectDir: project, sourceDir: dir, copyAssets: false});
    assert.equal(existsSync(path.join(project, MOTION_BLUR_GUARD_FILE)), false);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test('Remotion draws the same sweep markup and smear filter from the same state', async () => {
  const tsx = await readFile(path.join(ROOT, 'kit/remotion/StoryComposition.tsx'), 'utf8');
  assert.match(tsx, /lightSweepHtml\(width, height, sweep\)/);
  assert.match(tsx, /\["--lc-ls" as any\]: lightSweepProgress\(sweep, t\)/);
  assert.match(tsx, /mixBlendMode: "screen"/);
  assert.match(tsx, /smearFilterSvg\(smearId, state\.smearX, state\.smearY\)/);
  assert.match(tsx, /filter: `url\(#\$\{smearId\}\)`/);
});

function pick(object, keys) {
  return Object.fromEntries(keys.map((key) => [key, object[key]]));
}

test("motion blur: a reel's worth of guarded caption frames splits into short overlays ffmpeg can parse", async () => {
  const { motionBlurFilter } = await import("../src/motion_blur.js");
  // 47 s of word changes: two guarded frames every 7 frames, 200 runs.
  const frames = [];
  for (let n = 0; n < 1400; n += 7) frames.push(n, n + 1);
  const filter = motionBlurFilter(6, 30, { rate: 4, guard: { frames, rect: { x: 0, y: 998, width: 1080, height: 231 } } });
  const enables = [...filter.matchAll(/enable='([^']*)'/g)].map((match) => match[1].split("+").length);
  assert.equal(enables.reduce((sum, count) => sum + count, 0), 200, "every run is guarded once");
  assert.ok(enables.every((count) => count <= 24), `an overlay guards at most 24 runs (${enables.join(", ")})`);
  assert.match(filter, /\[v\]$/);
});
