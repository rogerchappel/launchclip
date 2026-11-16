// Behaviours (kit/core/behaviours.mjs): opt-in idle motions on a scene's
// content, as ops both renderers play. Each starts and ends at rest, stays
// inside its amplitude, and GSAP seeking the compiled lines gives the state
// Remotion draws on every frame.
import assert from 'node:assert/strict';
import test from 'node:test';
import gsap from 'gsap';
import {BEHAVIOURS, BEHAVIOUR_KINDS, BEHAVIOUR_SETTLE, behaviourOps, behaviourTransform} from '@launchclip/core/behaviours.mjs';
import {opsStateAt} from '@launchclip/core/camera-world.mjs';
import {STORY_BEHAVIOURS, resolveStory, validateStory} from '@launchclip/core/story.mjs';
import {compileStoryToHyperFrames} from '../kit/hyperframes/story-compiler.mjs';

const REST = {x: 0, y: 0, rotation: 0, skewX: 0, scale: 1, scaleX: 1, scaleY: 1, opacity: 1};
const rect = {x: 140, y: 600, width: 800, height: 500};
const window = {start: 2, end: 10};
const value = (state, key) => state[key] ?? (key === 'scaleX' || key === 'scaleY' ? state.scale ?? 1 : REST[key]);

test('the kinds match the import-free copy in story.mjs', () => {
  assert.deepEqual([...STORY_BEHAVIOURS], [...BEHAVIOUR_KINDS]);
});

test('every behaviour starts and ends at rest and stays inside its amplitude', () => {
  for (const kind of BEHAVIOUR_KINDS) {
    const plan = behaviourOps({kind}, {id: 's1', window, rect});
    assert.ok(plan && plan.ops.length, kind);
    const arrival = ['squash', 'wobble'].includes(kind);
    for (const t of arrival ? [window.start, window.end + 0.01] : [window.start, window.start + BEHAVIOUR_SETTLE, window.end + 0.01]) {
      const state = opsStateAt(plan.ops, 'behave', t);
      for (const key of Object.keys(REST)) {
        if (kind === 'drift' || (kind === 'spin' && key === 'rotation')) continue;
        assert.ok(Math.abs(value(state, key) - REST[key]) < 1e-3, `${kind} ${key} at ${t}: ${value(state, key)}`);
      }
    }
    // Idle motions wait for the content to settle; arrivals play at once.
    const first = Math.min(...plan.ops.map((op) => op.start ?? op.time));
    const from = arrival ? window.start : window.start + BEHAVIOUR_SETTLE;
    assert.ok(first >= from - 1e-9 && first <= from + (BEHAVIOURS[kind].period || 60 / 100) + 1e-9, `${kind} starts at ${first}`);
    for (let t = window.start; t <= window.end; t += 1 / 30) {
      const state = opsStateAt(plan.ops, 'behave', t);
      assert.ok(Math.hypot(value(state, 'x'), value(state, 'y')) <= 30, `${kind} travels at most 30 px`);
      assert.ok(Math.abs(value(state, 'skewX')) <= 6 + 1e-9 && value(state, 'opacity') >= 0.6 - 1e-9, `${kind} at ${t}`);
      assert.ok(Math.abs(value(state, 'scaleX') - 1) <= 0.1 + 1e-9 && Math.abs(value(state, 'scaleY') - 1) <= 0.1 + 1e-9, `${kind} scale at ${t}`);
      if (kind !== 'spin') assert.ok(Math.abs(value(state, 'rotation')) <= 3 + 1e-9, `${kind} rotation at ${t}`);
    }
  }
});

test('an orbit is a circle and a lissajous a figure eight', () => {
  const r = BEHAVIOURS.orbit.amp.r, P = BEHAVIOURS.orbit.period;
  const orbit = behaviourOps({kind: 'orbit'}, {id: 's1', window, rect}).ops;
  const t0 = window.start + BEHAVIOUR_SETTLE;
  for (let k = 0; k <= 40; k += 1) {
    const s = opsStateAt(orbit, 'behave', t0 + P * (k / 40));
    assert.ok(Math.abs(Math.hypot(s.x, s.y + r) - r) < 0.02, `on the circle at ${k}/40`);
  }
  const eight = behaviourOps({kind: 'lissajous'}, {id: 's1', window, rect}).ops;
  const half = opsStateAt(eight, 'behave', t0 + BEHAVIOURS.lissajous.period / 2);
  assert.ok(Math.abs(half.x) < 1e-3 && Math.abs(half.y) < 1e-3, 'crosses the middle at half a turn');
});

test('pendulum swings about the top of the content; squash about its base', () => {
  assert.deepEqual(behaviourOps({kind: 'pendulum'}, {id: 's1', window, rect}).pivot, {x: 540, y: 600});
  assert.deepEqual(behaviourOps({kind: 'squash'}, {id: 's1', window, rect}).pivot, {x: 540, y: 1100});
  assert.equal(behaviourTransform({}), 'translate(0px, 0px) rotate(0deg) skew(0deg, 0deg) scale(1, 1)');
});

test('validation and the HyperFrames timeline: GSAP seeks to the state Remotion draws', async () => {
  const story = (behaviour) => ({
    schema: 'launchclip.story.v1', lane: 'motion', format: {width: 1080, height: 1920, fps: 30, duration: 6},
    brand: {colors: {bg: '#0b1020', primary: '#ff7a59', accent: '#7ce7ff', ink: '#0b1020', paper: '#f5f1ea'}, fonts: {display: 'anton', body: 'inter', meta: 'jetbrains-mono'}},
    scenes: [{id: 's1', module: 'hook-title', start: 0, end: 6, params: {headline: 'Steady'}, behaviour}]
  });
  assert.match(validateStory(story({kind: 'spin', angle: 20})).errors.join(' '), /only drift takes it/);
  assert.match(validateStory(story({kind: 'bounce'})).errors.join(' '), /behaviour must be/);
  for (const kind of BEHAVIOUR_KINDS) {
    const input = story({kind});
    assert.deepEqual(validateStory(input).errors, [], kind);
    const {html} = await compileStoryToHyperFrames(resolveStory(input), {write: false});
    assert.match(html, /<div id="lc-behave-s1" class="lc-drift" style="transform-origin:/, kind);
    const proxy = {...REST};
    const tl = gsap.timeline({paused: true});
    const ops = [];
    for (const match of html.matchAll(/tl\.(set|fromTo)\("#lc-behave-s1", (\{.*?\})(?:, (\{.*?\}))?, ([\d.]+)\);/g)) {
      const [, type, a, b, at] = match;
      const strip = ({force3D, duration, ease, immediateRender, ...rest}) => rest;
      if (type === 'set') { tl.set(proxy, strip(JSON.parse(a)), Number(at)); ops.push({type: 'set', target: 'behave', time: Number(at), props: strip(JSON.parse(a))}); }
      else { const to = JSON.parse(b); tl.fromTo(proxy, strip(JSON.parse(a)), {...strip(to), duration: to.duration, ease: to.ease, immediateRender: false}, Number(at)); ops.push({type: 'tween', target: 'behave', start: Number(at), duration: to.duration, ease: to.ease, from: strip(JSON.parse(a)), to: strip(to)}); }
    }
    assert.ok(ops.length > 0, `${kind}: compiled behaviour lines`);
    for (let frame = 0; frame < 180; frame += 1) {
      tl.seek(frame / 30, false);
      const state = opsStateAt(ops, 'behave', frame / 30);
      for (const key of Object.keys(state)) assert.ok(Math.abs(proxy[key] - state[key]) < 1e-3, `${kind} ${key} at frame ${frame}: GSAP ${proxy[key]}, ops ${state[key]}`);
    }
    tl.kill();
  }
});
