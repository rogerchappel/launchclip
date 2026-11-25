// The per-frame rig (kit/core/characters/rig-frame.mjs, rig-frame-draw.mjs,
// rig-scene.mjs; docs/rd/per-frame-rig.md): pure and seek-safe, checkpoints
// bit-identical to a full replay, planted feet stay put, bones keep their
// lengths, IK never stretches, every rig style draws, plans are validated.
import test from 'node:test';
import assert from 'node:assert/strict';
import {planWalks, rigFrame, rigLengths, springCheckpoints, squashAt, twoBone} from '@launchclip/core/characters/rig-frame.mjs';
import {PROTOTYPE, RIG_FRAME_STYLES, RIG_SCENE_SCHEMA, prototypePlan, rigScenePrepare, rigSceneState, rigSceneTree, validateRigScenePlan} from '@launchclip/core/characters/rig-scene.mjs';
import {characterLook, starterCharacter} from '@launchclip/core/characters/cast.mjs';

const FPS = 30;
const plan = prototypePlan();
const prepared = rigScenePrepare(plan);
const actor = plan.actors[0];
const track = prepared.actors[actor.id].track;
const walkPlan = prepared.actors[actor.id].walk;
const frames = Array.from({length: 8 * FPS + 1}, (_, i) => rigFrame(actor.character, track, i / FPS, {plan: walkPlan}));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const canvas = {width: 1080, height: 1920};

test('rigFrame is pure and seek-safe: any frame alone equals the same frame in sequence', () => {
  for (const i of [0, 1, 37, 120, 133, 134, 200, 240]) {
    assert.deepEqual(rigFrame(actor.character, track, i / FPS), frames[i]);
    assert.deepEqual(rigFrame(actor.character, track, i / FPS, planWalks(track)), frames[i]);
  }
  for (let i = 240; i >= 0; i -= 41) assert.deepEqual(rigFrame(actor.character, track, i / FPS, {plan: walkPlan}), frames[i]);
});

test('spring checkpoints give the same floats as replaying from 0, also after a JSON round trip', () => {
  const cp = JSON.parse(JSON.stringify(springCheckpoints(actor.character, track, 8, walkPlan)));
  for (let i = 0; i <= 8 * FPS; i += 7) assert.deepEqual(rigFrame(actor.character, track, i / FPS, {plan: walkPlan, checkpoints: cp}), frames[i], `frame ${i}`);
  // Off the frame grid and past the last checkpoint too.
  for (const t of [0.5, 2.0000001, 4.47, 8.4, 9.1]) assert.deepEqual(rigFrame(actor.character, track, t, {plan: walkPlan, checkpoints: cp}), rigFrame(actor.character, track, t, {plan: walkPlan}));
});

test('the scene tree is deterministic and the same with or without prepared (also from JSON)', () => {
  const again = JSON.parse(JSON.stringify(prepared));
  for (const t of [0, 1.1, 2.4, 4.47, 4.6, 7.9]) {
    const tree = rigSceneTree(plan, t, canvas, prepared);
    assert.deepEqual(rigSceneTree(plan, t, canvas, again), tree);
    assert.deepEqual(rigSceneTree(plan, t, canvas), tree);
    assert.equal(tree.tag, 'svg');
    assert.equal(tree.attrs.viewBox, '0 0 1080 1920');
  }
});

test('no NaN in any joint or the drawing', () => {
  for (const fr of frames) for (const [name, p] of Object.entries(fr.joints)) assert.ok(Number.isFinite(p[0]) && Number.isFinite(p[1]), `${name} at ${fr.t}`);
  for (const t of [0.6, 2.4, 4.45, 4.7]) assert.doesNotMatch(JSON.stringify(rigSceneTree(plan, t, canvas, prepared)), /NaN|undefined/);
});

test('bones keep their lengths every frame', () => {
  const L = rigLengths(actor.character);
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
      assert.ok(Math.abs(leg.place - place) * actor.at.scale < 1, `${side} foot slid at ${fr.t}`);
    }
  }
  assert.ok(planted > 300, 'feet are planted most of the time');
  assert.ok(Math.abs(frames.at(-1).joints.pelvis[0] - PROTOTYPE.track.walks[0].to) < 60);
});

test('two-bone IK clamps to its reach: bones never stretch', () => {
  const far = twoBone([0, 0], [1000, 200], 160, 140, 1);
  assert.equal(far.reached, false);
  assert.ok(dist([0, 0], far.end) <= 300 + 1e-9);
  assert.ok(Math.abs(dist([0, 0], far.mid) - 160) < 1e-9 && Math.abs(dist(far.mid, far.end) - 140) < 1e-9);
  const near = twoBone([0, 0], [100, 120], 160, 140, 1);
  assert.equal(near.reached, true);
  assert.ok(dist(near.end, [100, 120]) < 1e-9);
  const other = twoBone([0, 0], [100, 120], 160, 140, -1);
  assert.ok(Math.sign(near.th2 - near.th1) === -Math.sign(other.th2 - other.th1));
});

test('the walk plan covers the travel in even steps that alternate feet, and faces its travel', () => {
  const p = walkPlan.plans[0];
  assert.equal(p.landings.length, p.N);
  for (let k = 1; k < p.N; k++) assert.notEqual(p.landings[k].foot, p.landings[k - 1].foot);
  const half = PROTOTYPE.track.walks[0].stance, to = PROTOTYPE.track.walks[0].to;
  assert.deepEqual([...p.q.slice(-2)].sort((a, b) => a - b), [to - half, to + half]);
  // A walk right after facing left turns first.
  const right = planWalks({x: 0, facing: 'left', walks: [{start: 1, end: 2, to: 300}]});
  assert.equal(right.plans[0].d, 1);
  assert.ok(right.facings.some(k => k.f === 1 && k.t < 1));
  // A step back keeps its own facing.
  const back = planWalks({x: 0, facing: 'right', walks: [{start: 1, end: 1.5, to: -80, facing: 'right'}]});
  assert.equal(back.plans[0].d, -1);
  assert.ok(back.facings.every(k => k.f === 1));
});

test('a turn passes the head through front and flips the facing halfway', () => {
  const before = rigFrame(actor.character, track, 2.25, {plan: walkPlan}), mid = rigFrame(actor.character, track, 2.3 + 0.13, {plan: walkPlan}), after = rigFrame(actor.character, track, 2.7, {plan: walkPlan});
  assert.equal(before.facing, 'left');
  assert.equal(after.facing, 'right');
  assert.ok(Math.abs(mid.fc) < 0.05);
});

test('a foot path lifts the foot (a kick) and lands it back on its place', () => {
  const kick = {x: 0, facing: 'right', feet: {r: [{t: 0.5, at: [60, 330]}, {t: 0.7, at: [260, 200]}, {t: 0.9, at: [80, 340]}]}};
  const ch = actor.character, L = rigLengths(ch);
  const rest = rigFrame(ch, kick, 0), up = rigFrame(ch, kick, 0.7), back = rigFrame(ch, kick, 1.5);
  assert.equal(up.legs.r.planted, false);
  assert.ok(up.legs.r.ankle[1] < rest.legs.r.ankle[1] - 100, 'the kicked foot is up');
  assert.ok(Math.abs(dist(up.legs.r.hip, up.legs.r.knee) - L.thigh) < 1e-6);
  assert.ok(back.legs.r.planted && dist(back.legs.r.ankle, rest.legs.r.ankle) < 1);
});

test('squash keys ramp in, hold and recover', () => {
  const list = [{t: 1, amount: 0.5, hold: 0.1, recover: 0.2}];
  assert.equal(squashAt(list, 0.5), 0);
  assert.equal(squashAt(list, 1.05), 0.5);
  assert.equal(squashAt(list, 1.5), 0);
  assert.ok(squashAt(list, 0.97) > 0 && squashAt(list, 0.97) < 0.5);
});

test('the ball rides in the hand until the release, then flies from there', () => {
  const at = t => rigSceneState(plan, t, prepared).props[0];
  const held = at(3), release = at(4.47), flying = at(4.6);
  assert.equal(held.holder.actor, 'oliver');
  assert.equal(flying.holder, null);
  assert.deepEqual(plan.props[0].path.find(k => k.t > 4.47 && k.at) && prepared.props.ball.runs[0].points[0].at, release.at);
  assert.ok(flying.at[0] > release.at[0], 'thrown to the right');
});

test('a two-hand prop is carried before the chest with both hands on its sides', () => {
  const {params} = starterCharacter('oliver');
  const box = {
    schema: RIG_SCENE_SCHEMA,
    actors: [{id: 'a', character: {params, style: 'stick'}, colors: characterLook(params, {style: 'stick'}).colors, at: {x: 300, floor: 1500, scale: 0.8},
      track: {x: 0, facing: 'right', walks: [{start: 0.5, end: 2, to: 400}]}, expressions: [{t: 0, expression: 'happy'}]}],
    props: [{id: 'box', prop: 'box', path: [{t: 0, holder: {actor: 'a', hand: 'r'}}]}]
  };
  assert.deepEqual(validateRigScenePlan(box), []);
  for (const t of [0, 1, 1.4, 2.5]) {
    const {actors: [{frame}], props: [p]} = rigSceneState(box, t);
    assert.ok(frame.carry, `carrying at ${t}`);
    assert.equal(p.holder.actor, 'a');
    // Both wrists sit at the box's sides (the hand's centre on the grip).
    for (const [side, k] of [['l', -1], ['r', 1]]) {
      const grip = [frame.carry.at[0] + k * 85, frame.carry.at[1]];
      assert.ok(dist(frame.arms[side].wrist, [grip[0], grip[1] - rigLengths(box.actors[0].character).palm * 0.6]) < 1, `${side} hand on the box at ${t}`);
    }
  }
});

test('every rig style draws the prototype; other styles are refused', () => {
  assert.deepEqual([...RIG_FRAME_STYLES], ['rubber-hose', 'stick', 'stick-classic']);
  for (const style of RIG_FRAME_STYLES) {
    const p = prototypePlan(undefined, {style});
    assert.deepEqual(validateRigScenePlan(p), []);
    for (const t of [1, 4.4]) assert.doesNotMatch(JSON.stringify(rigSceneTree(p, t, canvas)), /NaN|undefined/);
  }
  const flat = prototypePlan();
  flat.actors[0].character = {...flat.actors[0].character, style: 'flat'};
  assert.ok(validateRigScenePlan(flat).some(e => /style/.test(e)));
});

test('speech: a viseme opens the mouth', () => {
  const talk = {...plan, actors: [{...actor, mouth: [{t: 0, viseme: 'open'}, {t: 1, viseme: 'closed'}]}]};
  const open = JSON.stringify(rigSceneTree(talk, 0.5, canvas)), shut = JSON.stringify(rigSceneTree(talk, 1.5, canvas));
  assert.notEqual(open, shut);
  assert.equal(shut, JSON.stringify(rigSceneTree(plan, 1.5, canvas)));
});

test('validateRigScenePlan names what is wrong', () => {
  assert.deepEqual(validateRigScenePlan(plan), []);
  assert.deepEqual(validateRigScenePlan(null), ['plan: not an object']);
  const bad = structuredClone(plan);
  bad.schema = 'x';
  bad.actors[0].at.scale = 0;
  bad.actors[0].track.facing = 'up';
  bad.actors[0].track.sit = true;
  bad.actors[0].track.walks = [{start: 2, end: 1, to: 0}];
  bad.actors[0].track.keys = [{t: 2}, {t: 1}];
  bad.actors[0].track.hands = {l: [{t: 0, grip: 'nothing'}], x: []};
  bad.actors[0].track.feet = {r: [{t: 0, grip: 'ball'}]};
  bad.actors[0].track.squash = [{t: 0, amount: 2}];
  bad.actors[0].mouth = [{t: 0, viseme: 'scream'}];
  bad.props[0].prop = 'anvil';
  bad.props[0].path = [{t: 0, at: [0, 0], holder: {actor: 'oliver', hand: 'r'}}, {t: 1, holder: {actor: 'nobody', hand: 'r'}}];
  bad.props.push({id: 'ball', prop: 'ball', path: []});
  const errors = validateRigScenePlan(bad);
  for (const want of [/^schema/, /\.at: needs x, floor and a positive scale/, /facing: left or right/, /sit: sitting is not supported/, /walks\[0\]: needs start < end/,
    /keys\[1\]: out of time order/, /hands\.l\[0\]: grip: no prop nothing/, /side x: l or r/, /feet\.r\[0\]: feet cannot grip/, /squash\[0\]: amount/, /viseme must be/,
    /prop: one of/, /path\[0\]: needs one of at or holder/, /path\[1\]: holder needs a cast actor/, /props: ids must be unique/, /path: needs at least one key/]) {
    assert.ok(errors.some(e => want.test(e)), `${want} in ${JSON.stringify(errors, null, 1)}`);
  }
});

test('checkpoints make late frames as cheap as early ones', () => {
  const time = t => { const s = performance.now(); for (let i = 0; i < 20; i++) rigFrame(actor.character, track, t, {plan: walkPlan, checkpoints: prepared.actors.oliver.checkpoints}); return (performance.now() - s) / 20; };
  time(1); // warm up
  assert.ok(time(7.9) < Math.max(2, time(0.4) * 4), 'a late frame costs about what an early one does');
});
