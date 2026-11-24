// The per-frame rig prototype (kit/core/characters/rig-frame.mjs, docs/rd/per-frame-rig.md):
// pure and seek-safe, planted feet stay put, bones keep their lengths, IK never stretches.
import test from 'node:test';
import assert from 'node:assert/strict';
import {planWalks, rigFrame, rigLengths, twoBone} from '@launchclip/core/characters/rig-frame.mjs';
import {PROTOTYPE, prototypeCast, prototypeTree} from '@launchclip/core/characters/rig-frame-draw.mjs';

const cast = prototypeCast();
const track = PROTOTYPE.track;
const FPS = 30;
const frames = Array.from({length: 8 * FPS + 1}, (_, i) => rigFrame(cast.character, track, i / FPS, cast.plan));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

test('rigFrame is pure and seek-safe: any frame alone equals the same frame in sequence', () => {
  for (const i of [0, 1, 37, 120, 133, 134, 200, 240]) {
    assert.deepEqual(rigFrame(cast.character, track, i / FPS), frames[i]);
    assert.deepEqual(rigFrame(cast.character, track, i / FPS, planWalks(track)), frames[i]);
  }
  // Evaluating backwards gives the same frames as forwards.
  for (let i = 240; i >= 0; i -= 41) assert.deepEqual(rigFrame(cast.character, track, i / FPS, cast.plan), frames[i]);
});

test('no NaN in any joint or the drawing', () => {
  for (const fr of frames) for (const [name, p] of Object.entries(fr.joints)) assert.ok(Number.isFinite(p[0]) && Number.isFinite(p[1]), `${name} at ${fr.t}`);
  assert.doesNotMatch(JSON.stringify(prototypeTree(4.45)), /NaN/);
});

test('bones keep their lengths every frame', () => {
  const L = rigLengths(cast.character);
  for (const fr of frames) for (const side of ['l', 'r']) {
    const leg = fr.legs[side], arm = fr.arms[side];
    assert.ok(Math.abs(dist(leg.hip, leg.knee) - L.thigh) < 1e-6);
    assert.ok(Math.abs(dist(leg.knee, leg.ankle) - L.shin) < 1e-6);
    assert.ok(Math.abs(dist(arm.shoulder, arm.elbow) - L.upper) < 1e-6);
    assert.ok(Math.abs(dist(arm.elbow, arm.wrist) - L.fore) < 1e-6);
  }
});

test('a planted foot stays within 1 px of its place, and the leg reaches it', () => {
  let planted = 0;
  for (const side of ['l', 'r']) {
    let place = null;
    for (const fr of frames) {
      const leg = fr.legs[side];
      if (!leg.planted) { place = null; continue; }
      planted++;
      // The ankle is exactly where the foot puts it: the pelvis comes down rather than the leg stretching.
      assert.ok(dist(leg.ankle, leg.target) < 1e-6, `${side} ankle off its target at ${fr.t}`);
      place ??= leg.place;
      assert.ok(Math.abs(leg.place - place) * PROTOTYPE.at.scale < 1, `${side} foot slid at ${fr.t}`);
    }
  }
  assert.ok(planted > 300, 'feet are planted most of the time');
  // The walk really travels: both feet end where the plan puts them.
  assert.ok(Math.abs(frames.at(-1).joints.pelvis[0] - track.walks[0].to) < 60);
});

test('two-bone IK clamps to its reach: bones never stretch', () => {
  const far = twoBone([0, 0], [1000, 200], 160, 140, 1);
  assert.equal(far.reached, false);
  assert.ok(dist([0, 0], far.end) <= 300 + 1e-9);
  assert.ok(Math.abs(dist([0, 0], far.mid) - 160) < 1e-9 && Math.abs(dist(far.mid, far.end) - 140) < 1e-9);
  const near = twoBone([0, 0], [100, 120], 160, 140, 1);
  assert.equal(near.reached, true);
  assert.ok(dist(near.end, [100, 120]) < 1e-9);
  // The bend side picks the elbow: mirror images.
  const other = twoBone([0, 0], [100, 120], 160, 140, -1);
  assert.ok(Math.sign(near.th2 - near.th1) === -Math.sign(other.th2 - other.th1));
});

test('the walk plan covers the travel in even steps that alternate feet', () => {
  const {plans} = planWalks(track);
  const p = plans[0];
  assert.equal(p.landings.length, p.N);
  for (let k = 1; k < p.N; k++) assert.notEqual(p.landings[k].foot, p.landings[k - 1].foot);
  const half = track.walks[0].stance;
  assert.ok(Math.abs(p.q.at(-1) - (p.u1 + half)) < 1e-9 && Math.abs(p.q.at(-2) - (p.u1 - half)) < 1e-9);
});
