// Transitions between two full-frame plates (kit/core/transition-frames.mjs):
// every transition type, in cuts and in world mode, keeps the frame covered,
// keeps its plates moving and never pops; the HyperFrames timeline plays the
// tweens the check evaluates, as GSAP runs them. The rendered half is the
// footage-transitions-9x16 story in test/parity_camera.test.js.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import gsap from 'gsap';
import {getEase} from '@launchclip/core/motion.mjs';
import {resolveStory, STORY_CARD_TRANSITIONS, STORY_FOOTAGE_PLATES, validateStory} from '@launchclip/core/story.mjs';
import {
  CARD_TRANSITIONS, CARRY_TRANSITIONS, FOOTAGE_PLATES, FULL_FRAME_PLATES, LAYER_IDENTITY, SMEAR_PROPS, TRANSITION_TYPES,
  footageTransition, gsapVars, layerStateAt, sceneWindows
} from '@launchclip/core/transitions.mjs';
import {TRANSITION_CHECK, transitionFindings, transitionFrameFindings, transitionFrames} from '@launchclip/core/transition-frames.mjs';
import {compileStoryToHyperFrames} from '../kit/hyperframes/story-compiler.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const W = 1080, H = 1920, FPS = 30;
const DIRECTED = ['push', 'whip', 'pan', 'whip-pan', 'orbit', 'glow-wipe', 'push-blur'];
const MODES = ['cuts', 'world'];

// Two full-frame plates, the second arriving with `transition`.
function footageStory(transition, {mode = 'cuts', modules = ['clip', 'clip']} = {}) {
  const plate = (id, module, src, start, extra = {}) => ({id, module, start, end: start + 4, energy: 1, params: {media: src}, ...extra});
  return resolveStory({
    schema: 'launchclip.story.v1', lane: 'motion',
    format: {width: W, height: H, fps: FPS, duration: 8},
    brand: {colors: {bg: '#0b1020', primary: '#ff7a59', accent: '#7ce7ff', ink: '#0b1020', paper: '#f5f1ea'}, fonts: {display: 'anton', body: 'inter', meta: 'jetbrains-mono'}},
    ...(mode === 'world' ? {camera: {mode: 'world'}} : {}),
    scenes: [plate('s1', modules[0], 'assets/shots/ridge.svg', 0), plate('s2', modules[1], 'assets/shots/boards.svg', 4, {in: transition})]
  });
}

// Every transition a planner can write: each type, each direction of the directed ones, short and long.
function everyTransition(mode) {
  const out = [];
  for (const type of new Set([...TRANSITION_TYPES, ...CARRY_TRANSITIONS])) {
    if (type === 'cut') continue;
    // An overview is a world-camera move of at least 2 s (cuts mode plays it as a fade).
    const durs = type === 'overview' ? [2.4] : [0.3, 0.5, 0.8];
    for (const dur of durs) for (const direction of DIRECTED.includes(type) ? ['left', 'right', 'up', 'down'] : [undefined]) out.push({type, dur, ...(direction ? {direction} : {})});
  }
  return out.map((transition) => ({transition, mode, name: `${mode} ${transition.type} ${transition.dur} s${transition.direction ? ` ${transition.direction}` : ''}`}));
}

test('the footage lists match the import-free copies in story.mjs', () => {
  assert.deepEqual([...STORY_FOOTAGE_PLATES], [...FOOTAGE_PLATES]);
  assert.deepEqual([...STORY_CARD_TRANSITIONS], [...CARD_TRANSITIONS]);
  for (const module of FOOTAGE_PLATES) assert.ok(FULL_FRAME_PLATES.includes(module), `${module} is a full-frame plate`);
  for (const type of CARD_TRANSITIONS) assert.ok(TRANSITION_TYPES.includes(type));
});

test('every transition between two full-frame plates covers the frame, keeps moving and never pops', () => {
  for (const mode of MODES) {
    for (const {transition, name} of everyTransition(mode)) {
      for (const modules of [['clip', 'clip'], ['photo-scene', 'clip'], ['clip', 'photo-scene']]) {
        const story = footageStory(transition, {mode, modules});
        const frames = transitionFrames(story, 's2');
        assert.ok(frames && frames.from === 's1' && frames.frames.length === Math.round(transition.dur * FPS) + 1, `${name}: the transition carries s1 into s2 over ${transition.dur} s`);
        assert.deepEqual(transitionFindings(story).map((finding) => `${finding.kind}: ${finding.detail}`), [], `${name} (${modules.join(' → ')})`);
        // Both plates are whole when it ends: the incoming one at rest, alone.
        const last = frames.frames.at(-1);
        assert.equal(last.out, null, `${name}: the outgoing plate is gone when the transition ends`);
        assert.ok(last.cover > 1 - 1e-9 && last.in.opacity === 1, `${name}: the incoming plate fills the frame at the end`);
      }
    }
  }
});

test('the incoming plate arrives on one ease: its cover never goes back', () => {
  // Types whose incoming plate grows, wipes or slides in over the outgoing one.
  for (const mode of MODES) for (const type of ['fade', 'zoom', 'iris', 'glow-wipe', 'push', 'whip']) {
    const story = footageStory({type, dur: 0.5}, {mode});
    const windows = sceneWindows(story);
    const incoming = windows.scenes.find((entry) => entry.id === 's2');
    const s1 = windows.scenes.find((entry) => entry.id === 's1');
    assert.equal(s1.renderEnd, 4.5, `${mode} ${type}: the outgoing plate is drawn to the end of the transition`);
    let before = -1;
    for (let frame = 0; frame <= 15; frame += 1) {
      const state = layerStateAt(4 + frame / FPS, incoming.tweens, getEase);
      // The share of the frame the incoming plate has taken: its opacity, scale, iris or travel.
      const travel = 1 - Math.max(Math.abs(state.x) / W, Math.abs(state.y) / H);
      const open = state.iris === null ? 1 : Math.min(1, state.iris / Math.hypot(W / 2, H / 2));
      const wiped = 1 - Math.max(...['wipeT', 'wipeR', 'wipeB', 'wipeL'].map((prop) => state[prop] ?? 0)) / 100;
      const share = state.opacity * Math.min(1, state.scale) * travel * open * wiped;
      assert.ok(share >= before - 1e-9, `${mode} ${type}: the incoming plate recedes at frame ${frame} (${share.toFixed(4)} after ${before.toFixed(4)})`);
      assert.ok(state.scale <= 1 + 1e-9 || type === 'zoom', `${mode} ${type}: no overshoot`);
      before = share;
    }
    assert.ok(Math.abs(before - 1) < 1e-9);
  }
});

test('a world push between two clips: the picture grows out of the outgoing clip, which stays whole', () => {
  const story = footageStory({type: 'push', dur: 0.5}, {mode: 'world'});
  const windows = sceneWindows(story);
  const [s1, s2] = ['s1', 's2'].map((id) => windows.scenes.find((entry) => entry.id === id));
  assert.equal(s2.transitionIn.camera, true);
  assert.deepEqual(s1.tweens, [], 'the outgoing clip never fades');
  // The incoming clip is hidden on the first frame, not whole and inset.
  assert.equal(layerStateAt(4, s2.tweens, getEase).opacity, 0);
  assert.equal(layerStateAt(4 + 1 / FPS, s2.tweens, getEase).opacity, 0);
  const frames = transitionFrames(story, 's2').frames;
  // Its screen width grows on every frame once the camera is under way, to the full frame, with no overshoot.
  const widths = frames.map((frame) => frame.in.corners[1].x - frame.in.corners[0].x);
  for (let k = 1; k < widths.length; k += 1) assert.ok(widths[k] >= widths[k - 1] - 1e-6 && widths[k] <= W + 1e-6, `frame ${k}: ${widths[k]} after ${widths[k - 1]}`);
  assert.ok(widths[0] < W * 0.7 && Math.abs(widths.at(-1) - W) < 0.01);
  // Slow, fast, slow: the fastest growth is in the middle third.
  const speed = widths.slice(1).map((width, k) => width - widths[k]);
  const peak = speed.indexOf(Math.max(...speed));
  assert.ok(peak >= speed.length / 3 && peak <= (speed.length * 2) / 3, `the camera peaks at frame ${peak} of ${speed.length}`);
  assert.ok(speed[0] < speed[peak] / 10 && speed.at(-1) < speed[peak] / 10);
});

test('the check reports the picture dropping out: an inset that sits still, an empty frame, a pop', () => {
  const story = footageStory({type: 'push', dur: 0.5}, {mode: 'world'});
  const windows = sceneWindows(story);
  const [s1, s2] = ['s1', 's2'].map((id) => windows.scenes.find((entry) => entry.id === id));
  // The hand-over of two cards (out, then in, meeting near zero), with the incoming fade not held.
  const tween = (start, duration, from, to, role) => ({prop: 'opacity', from, to, start, duration, ease: 'power1.inOut', at: 4 + start, role});
  s2.tweens = [tween(0.2, 0.225, 0, 1, 'in')];
  s1.tweens = [tween(0.05, 0.175, 1, 0, 'out')];
  const findings = transitionFrameFindings(transitionFrames(story, 's2', {windows}));
  assert.deepEqual(findings.map((finding) => finding.kind).sort(), ['cover', 'pop', 'stall']);
  const cover = findings.find((finding) => finding.kind === 'cover');
  assert.match(cover.detail, /cover \d+% of the frame/);
  assert.equal(findings.find((finding) => finding.kind === 'stall').frame, 120, 'the inset sits still from the transition\'s first frame');
  // A crossfade that dips to the background is a cover finding too.
  const fade = footageStory({type: 'fade', dur: 0.5});
  const fadeWindows = sceneWindows(fade);
  fadeWindows.scenes.find((entry) => entry.id === 's1').tweens = [{prop: 'opacity', from: 1, to: 0, start: 0, duration: 0.5, ease: 'power1.inOut', at: 4, role: 'out'}];
  assert.deepEqual(transitionFrameFindings(transitionFrames(fade, 's2', {windows: fadeWindows})).map((finding) => finding.kind), ['cover']);
  assert.ok(TRANSITION_CHECK.cover >= 0.95 && TRANSITION_CHECK.gap < TRANSITION_CHECK.cover);
});

test('between two footage plates a card transition plays as a fade, and validation says so', () => {
  for (const type of CARD_TRANSITIONS) {
    const transition = {type, dur: 0.5, ...(type === 'morph' ? {from_object: 's1.media'} : {})};
    assert.deepEqual(footageTransition(transition, {module: 'clip'}, {module: 'photo-scene'}), {type: 'fade', dur: 0.5});
    assert.equal(footageTransition(transition, {module: 'metric'}, {module: 'clip'}), transition, 'a card on either side keeps the transition');
    assert.equal(footageTransition(transition, {module: 'clip'}, {module: 'checklist'}), transition);
    const story = footageStory(transition);
    const s2 = sceneWindows(story).scenes.find((entry) => entry.id === 's2');
    assert.equal(s2.transitionIn.type, 'fade');
    assert.deepEqual(s2.tweens.map((tw) => [tw.prop, tw.from, tw.to]), [['opacity', 0, 1]]);
    const {errors, warnings} = validateStory(story);
    assert.deepEqual(errors, []);
    assert.ok(warnings.some((warning) => warning.includes('"s2"') && warning.includes(type) && warning.includes('plays as a fade')), `${type}: ${warnings.join(' | ')}`);
  }
  assert.equal(footageTransition({type: 'zoom', dur: 0.5}, {module: 'clip'}, {module: 'clip'}).type, 'zoom');
  const fine = validateStory(footageStory({type: 'zoom', dur: 0.5}));
  assert.ok(!fine.warnings.some((warning) => warning.includes('plays as a fade')));
});

test('the footage-transitions example: valid, five transitions between clips, no findings', async () => {
  const raw = JSON.parse(await readFile(path.join(ROOT, 'examples/story/footage-transitions-9x16/storyboard.json'), 'utf8'));
  const checked = validateStory(raw);
  assert.deepEqual(checked.errors, []);
  assert.deepEqual(checked.warnings, []);
  const story = resolveStory(raw);
  const windows = sceneWindows(story);
  assert.deepEqual(windows.scenes.map((entry) => entry.transitionIn?.type ?? null), [null, 'push', 'zoom', 'pull', 'iris', 'fade']);
  assert.deepEqual(transitionFindings(story), []);
  // The outgoing clip keeps its opacity through every one of them.
  for (const entry of windows.scenes) assert.ok(!entry.tweens.some((tw) => tw.role === 'out' && tw.prop === 'opacity'), `${entry.id} fades out under the next clip`);
  const {warnings} = await compileStoryToHyperFrames(story, {write: false});
  assert.deepEqual(warnings.filter((warning) => /root media|placeholder/.test(warning)), []);
});

// The HyperFrames timeline: every layer tween as a GSAP fromTo, parsed back from the compiled composition.
function compiledTweens(html, sceneId) {
  const out = [];
  const pattern = new RegExp(`tl\\.fromTo\\("#lc-layer-${sceneId}", (\\{.*?\\}), (\\{.*?\\}), ([\\d.]+)\\);`, 'g');
  for (const match of html.matchAll(pattern)) out.push({from: JSON.parse(match[1]), to: JSON.parse(match[2]), at: Number(match[3])});
  return out;
}

test('HyperFrames plays the tweens the check evaluates, and GSAP gives the same layer state on every frame', async () => {
  for (const mode of MODES) {
    for (const {transition, name} of everyTransition(mode).filter(({transition: item}) => item.dur !== 0.3 && (!item.direction || item.direction === 'left'))) {
      // Validation keeps the overview for the world camera.
      if (mode === 'cuts' && transition.type === 'overview') continue;
      const story = footageStory(transition, {mode});
      const windows = sceneWindows(story);
      const {html} = await compileStoryToHyperFrames(story, {write: false});
      for (const entry of windows.scenes) {
        const tweens = entry.tweens.filter((tw) => !SMEAR_PROPS.includes(tw.prop));
        const lines = compiledTweens(html, entry.id);
        assert.equal(lines.length, tweens.length, `${name} ${entry.id}: ${lines.length} GSAP tweens for ${tweens.length} layer tweens`);
        tweens.forEach((tw, k) => {
          const {duration, ease, immediateRender, ...to} = lines[k].to;
          assert.deepEqual(lines[k].from, gsapVars(tw.prop, tw.from), `${name} ${entry.id} tween ${k} from`);
          assert.deepEqual(to, gsapVars(tw.prop, tw.to), `${name} ${entry.id} tween ${k} to`);
          assert.equal(immediateRender, false);
          assert.equal(ease, tw.ease);
          assert.ok(Math.abs(duration - tw.duration) < 1e-4 && Math.abs(lines[k].at - tw.at) < 1e-4, `${name} ${entry.id} tween ${k} timing`);
        });
        // The same list on a GSAP timeline, as HyperFrames seeks it, against the state Remotion draws.
        const proxy = {...LAYER_IDENTITY, iris: 0, wipeT: 0, wipeR: 0, wipeB: 0, wipeL: 0};
        const tl = gsap.timeline({paused: true});
        for (const tw of tweens) tl.fromTo(proxy, {[tw.prop]: tw.from}, {[tw.prop]: tw.to, duration: tw.duration, ease: tw.ease, immediateRender: false}, tw.at);
        for (let frame = Math.round(entry.start * FPS); frame < Math.round(entry.renderEnd * FPS); frame += 1) {
          const t = frame / FPS;
          tl.seek(t, false);
          const state = layerStateAt(t, entry.tweens, getEase);
          for (const prop of ['opacity', 'x', 'y', 'scale', 'blur', 'glow', 'rackIn', 'veil', 'dip', 'focus', 'iris', 'wipeT', 'wipeR', 'wipeB', 'wipeL']) {
            // A finished iris or wipe is no clip at all.
            if (state[prop] === null) continue;
            assert.ok(Math.abs(proxy[prop] - state[prop]) < 1e-3, `${name} ${entry.id} ${prop} at frame ${frame}: GSAP ${proxy[prop]}, layerStateAt ${state[prop]}`);
          }
        }
        tl.kill();
      }
    }
  }
});
