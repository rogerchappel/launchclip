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

test('before-after module: two versions full frame, the after side clipped at the handle as it rests and reverses', async () => {
  const {resolveModule} = await import('@launchclip/core/modules.mjs');
  const {mediaLayoutTimeline, mediaLayoutView} = await import('@launchclip/core/catalog-d.mjs');
  const {frameState, propsToStyle} = await import('@launchclip/core/catalog-b-view.mjs');
  const scene = (params) => ({id: 'ba', module: 'before-after', start: 0, end: 6, params});
  const resolve = (params) => {
    const s = scene(params);
    return resolveModule(s, {schema: 'launchclip.story.v1', lane: 'motion', brand, format: {width: 1080, height: 1920, fps: 30, duration: 6}, scenes: [s]});
  };
  // One source needs a grade (else it compares a shot with itself); a grade goes on one side.
  assert.throws(() => resolve({before: 'assets/shots/a.mp4'}), /give params\.after .* or params\.grade/);
  assert.throws(() => resolve({before: 'assets/shots/a.mp4', after: 'assets/shots/b.mp4', gradeSide: 'before'}), /gradeSide.*needs params\.grade/);
  assert.throws(() => resolve({before: 'assets/shots/a.mp4', grade: 'mono', stops: [0.5, 0.5]}), /repeats a position/);
  const graded = resolve({before: 'assets/shots/a.mp4', grade: 'flat', gradeSide: 'before'});
  assert.equal(graded.content.windows[0].media.src, graded.content.windows[1].media.src);
  assert.match(mediaLayoutView(graded).windows[0].style.filter, /saturate/);
  assert.equal(mediaLayoutView(graded).windows[1].style.filter, undefined);

  const model = resolve({before: 'assets/shots/a.jpg', after: 'assets/shots/b.mp4', stops: [0.6, 0.3, 1], labels: {before: 'Before', after: 'After'}});
  const {moves} = model.content.compare;
  assert.deepEqual(moves.map((m) => [m.from, m.to]), [[0, 0.6], [0.6, 0.3], [0.3, 1]]);
  for (let i = 1; i < moves.length; i += 1) assert.ok(moves[i].start > moves[i - 1].start + moves[i - 1].duration, 'a rest between legs');
  const ops = mediaLayoutTimeline(model);
  const at = (t) => frameState(ops, t);
  for (const t of [0.2, moves[0].start + moves[0].duration / 2, moves[1].start - 0.05, moves[1].start + 0.4, moves[2].start + moves[2].duration]) {
    const state = at(t);
    const clip = state.get('ba-win-1').clipL, x = state.get('ba-handle').x;
    // The seam: the after window's left edge, where the handle stands; its label's side shares the clip.
    assert.ok(Math.abs((clip / 100) * 1080 - x) < 0.6, `t=${t}: seam ${clip}% vs handle ${x}px`);
    assert.equal(state.get('ba-side-after').clipL, clip);
    assert.ok(Math.abs(state.get('ba-side-before').clipR - (100 - clip)) < 0.02);
    assert.match(propsToStyle(state.get('ba-win-1')).clipPath, /^inset\(0% 0% 0% [\d.]+%\)$/);
  }
  assert.ok(Math.abs(at(moves[1].start - 0.05).get('ba-win-1').clipL - 40) < 0.01, 'rests at 0.6 revealed');
  assert.ok(at(moves[1].start + moves[1].duration).get('ba-win-1').clipL > 69.9, 'reverses to 0.3');
  assert.equal(at(model.end - 0.4).get('ba-win-1').clipL, 0, 'all after at the end');
  assert.equal(at(model.end - 0.4).get('ba-handle').opacity, 0, 'the handle fades onto the edge');
  // HyperFrames tweens the same clip as a clip-path string.
  const {EMITTERS} = await import('../kit/hyperframes/catalog-d.mjs');
  const out = EMITTERS['before-after'](model);
  assert.match(out.motion, /tl\.fromTo\("#ba-win-1", \{"clipPath":"inset\(0% 0% 0% 100%\)"\}, \{"clipPath":"inset\(0% 0% 0% 40%\)"/);
  assert.match(out.overlay, /id="ba-handle"/);
});
