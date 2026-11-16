// The before-and-after wipe (kit/core/before-after.mjs): the story contract,
// the plate clip both renderers evaluate, the handle on the same edge, and
// what the HyperFrames compiler draws. The in-scene compare (the
// before-after media layout) is tested in test/media_layouts.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {STORY_TRANSITIONS, resolveStory, validateStory} from '@launchclip/core/story.mjs';
import {TRANSITION_TYPES, layerStateAt, sceneWindows, transitionTweens} from '@launchclip/core/transitions.mjs';
import {BEFORE_AFTER, beforeAfterAt, beforeAfterAxis, beforeAfterGsap, beforeAfterHtml, beforeAfterSteps, beforeAfterWipes, moveValue} from '@launchclip/core/before-after.mjs';
import {getEase} from '@launchclip/core/motion.mjs';
import {compileStoryToHyperFrames} from '../kit/hyperframes/story-compiler.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const size = {width: 1080, height: 1920};
const brand = {colors: {bg: '#0a0b08', primary: '#c8ff3a', accent: '#c8ff3a', ink: '#0a0b08', paper: '#f4f6ee'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const card = (id, start, end, extra = {}) => ({id, module: 'stat-card', start, end, params: {value: '12', label: 'videos a week', source: 'Example log'}, ...extra});
const raw = (scenes, extra = {}) => ({schema: 'launchclip.story.v1', lane: 'motion', brand, format: {width: 1080, height: 1920, fps: 30, duration: 12}, scenes, ...extra});
const two = (transition, extra) => raw([card('a', 0, 6), card('b', 6, 12, {in: transition})], extra);
const errorsOf = (story) => validateStory(story).errors;

test('before-after is a story transition with validated options', () => {
  assert.ok(STORY_TRANSITIONS.includes('before-after') && TRANSITION_TYPES.includes('before-after'));
  assert.deepEqual(errorsOf(two({type: 'before-after', dur: 1.6})), []);
  assert.deepEqual(errorsOf(two({type: 'before-after', dur: 1.6, direction: 'up', pause: 0.6, labels: {before: 'Raw', after: 'Graded'}})), []);
  assert.match(errorsOf(two({type: 'before-after', dur: 1.6, pause: 1})).join('\n'), /in\.pause \(1s\) must be at most half the wipe/);
  assert.match(errorsOf(two({type: 'before-after', dur: 1.6, pause: -1})).join('\n'), /in\.pause must be the seconds/);
  assert.match(errorsOf(two({type: 'before-after', dur: 1.6, labels: {left: 'x'}})).join('\n'), /in\.labels\.left is not a side/);
  assert.match(errorsOf(two({type: 'before-after', dur: 1.6, labels: {after: ''}})).join('\n'), /in\.labels\.after must be a word or two/);
  assert.match(errorsOf(two({type: 'fade', dur: 0.5, pause: 0.2})).join('\n'), /in\.pause is a before-after option; "fade" does not take it/);
  // The handle crosses the whole frame: track 0 only; the loop ending takes it too.
  assert.match(errorsOf(raw([card('a', 0, 12), card('b', 2, 5, {track: 1, in: {type: 'before-after', dur: 1}})])).join('\n'), /"before-after" covers the whole frame/);
  assert.deepEqual(errorsOf(raw([card('a', 0, 12)], {ending: {loop_to: 'a', in: {type: 'before-after', dur: 1.2}}})), []);
});

test('before-after: slow → fast → slow with no overshoot, resting half-way on a pause', () => {
  const steps = beforeAfterSteps(1.6);
  assert.deepEqual(steps, [{start: 0, duration: 1.6, from: 0, to: 1}]);
  const values = Array.from({length: 49}, (_, i) => moveValue(steps, (i / 48) * 1.6));
  for (let i = 1; i < values.length; i += 1) assert.ok(values[i] >= values[i - 1] && values[i] <= 1, 'monotonic, never past 1');
  const speed = (a, b) => moveValue(steps, b) - moveValue(steps, a);
  assert.ok(speed(0.7, 0.9) > 3 * speed(0, 0.2) && speed(0.7, 0.9) > 3 * speed(1.4, 1.6), 'fast in the middle, slow at both ends');
  const paused = beforeAfterSteps(2, 0.6);
  assert.deepEqual(paused.map((s) => [s.start, s.duration, s.from, s.to]), [[0, 0.7, 0, 0.5], [1.3, 0.7, 0.5, 1]]);
  for (const t of [0.7, 1, 1.29]) assert.equal(moveValue(paused, t), 0.5);
  assert.equal(moveValue(paused, 2), 1);
  // A pause longer than half the wipe is clamped.
  assert.equal(beforeAfterSteps(1, 5)[1].start, 0.75, "the rest is at most half: legs of 0.25 s around 0.5 s");
});

test('before-after: the incoming plate is clipped at the handle, in every direction, through a pause', () => {
  const d = 2, pause = 0.6;
  for (const direction of BEFORE_AFTER.directions) {
    const tw = transitionTweens({type: 'before-after', dur: d, direction, pause}, size);
    assert.deepEqual(tw.out, [], 'the outgoing plate stays whole under it');
    assert.ok(tw.in.every((item) => item.ease === BEFORE_AFTER.ease), 'its own ease, whatever the grammar');
    const wipe = {start: 10, dur: d, pause, direction};
    const g = beforeAfterAxis(direction, size.width, size.height);
    for (const t of [10, 10.3, 10.7, 11, 11.5, 11.99]) {
      const state = layerStateAt(t, tw.in.map((item) => ({...item, at: 10 + item.start, role: 'in'})), getEase);
      const share = beforeAfterAt(wipe, t);
      const inset = state[{left: 'wipeL', right: 'wipeR', up: 'wipeT', down: 'wipeB'}[direction]];
      assert.notEqual(inset, null, `${direction} t=${t}: clipped (also while it rests half-way)`);
      // The seam (where the clip ends) is where the handle is drawn.
      const span = g.axis === 'x' ? size.width : size.height;
      const seam = ['left', 'up'].includes(direction) ? (inset / 100) * span : (1 - inset / 100) * span;
      assert.ok(Math.abs(seam - (g.origin + share * g.span)) < 0.5, `${direction} t=${t}: seam ${seam} vs handle ${g.origin + share * g.span}`);
    }
    const done = layerStateAt(12.01, tw.in.map((item) => ({...item, at: 10 + item.start, role: 'in'})), getEase);
    assert.equal(done.wipeL ?? done.wipeR ?? done.wipeT ?? done.wipeB, null, 'no clip once revealed');
  }
});

test('before-after: the handle and labels markup, and HyperFrames drives the same property', async () => {
  const html = beforeAfterHtml(1080, 1920, {direction: 'left', labels: {before: 'Raw <take>', after: 'Graded'}});
  assert.match(html, /RAW|Raw &lt;take&gt;/);
  assert.equal((html.match(/class="lc-ba-side"/g) ?? []).length, 2);
  assert.match(html, /clip-path:inset\(0 calc\(var\(--lc-ba\) \* 100%\) 0 0\)/, 'before keeps the left side');
  assert.match(html, /clip-path:inset\(0 0 0 calc\(\(1 - var\(--lc-ba\)\) \* 100%\)\)/, 'after opens from the right');
  assert.match(html, /translate\(calc\(1080px \+ var\(--lc-ba\) \* -1080px\), 0\)/);
  assert.doesNotMatch(html, /NaN|undefined|null/);
  assert.equal((beforeAfterHtml(1080, 1920, {direction: 'up'}).match(/lc-ba-side/g) ?? []).length, 0, 'no labels, no sides');

  const story = resolveStory(two({type: 'before-after', dur: 1.6, pause: 0.4, labels: {before: 'Before', after: 'After'}}));
  const [wipe] = beforeAfterWipes(story, sceneWindows(story));
  assert.deepEqual(wipe, {id: 'lc-ba-b', sceneId: 'b', start: 6, dur: 1.6, direction: 'left', pause: 0.4, labels: {before: 'Before', after: 'After'}});
  const lines = beforeAfterGsap(wipe);
  assert.equal(lines.length, 4);
  const compiled = await compileStoryToHyperFrames(story, {write: false, sourceDir: path.join(ROOT, 'examples/story/cinematic-transitions-9x16')});
  assert.ok(compiled.html.includes(`<div id="lc-ba-b" class="lc-before-after" data-launchclip-transition="before-after"`));
  assert.ok(compiled.html.includes(beforeAfterHtml(1080, 1920, wipe)));
  for (const line of lines) assert.ok(compiled.html.includes(line), line);
});
