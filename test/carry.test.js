// Elements carried across scenes (kit/core/carry.mjs, kit/core/flow.mjs;
// docs/FLUID_MOTION_RFC.md §6): pins hold through the boundary with no exit
// or entrance, the rest of each module leaves and arrives on lift layers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveModule} from '@launchclip/core/modules.mjs';
import {carrySource, opList, stillPlateProblem} from '@launchclip/core/flow.mjs';
import {visualBoxes} from '@launchclip/core/carry.mjs';
import {frameState} from '@launchclip/core/catalog-b-view.mjs';
import {validateStory} from '@launchclip/core/story.mjs';

const brand = {colors: {bg: '#0b0d1a', primary: '#ffb547', accent: '#46d4ff', ink: '#0b0d1a', paper: '#f6f3ee'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const graph = (id, start, end, nodes, extra = {}) => ({id, module: 'node-graph', start, end, params: {title: 'The team', hub: 'Director', nodes}, ...extra});
export const pinStory = (scenes) => ({schema: 'launchclip.story.v1', title: 'carry', lane: 'motion', format: {width: 1080, height: 1920, fps: 30, duration: 12}, brand, scenes});

const twoGraphs = (carry = {map: {'s1-title': 's2-title'}}, extra = {}) => pinStory([
  graph('s1', 0, 4, ['Research', 'Script', 'Voice', 'Camera']),
  graph('s2', 4, 8, ['Edit', 'Music', 'Publish'], {carry, ...extra})
]);

const state = (model, t) => frameState(opList(model).ops, t);

test('a pinned title holds through the boundary; the rest exits and enters on lift layers', () => {
  const story = twoGraphs();
  const a = resolveModule(story.scenes[0], story), b = resolveModule(story.scenes[1], story);
  assert.deepEqual(a.carry.out, {ids: ['s1-title'], to: 's2', at: 4});
  assert.equal(b.carry.in.items[0].pin, true);
  // A: the root rests, the title stays whole to the last frame, the rest fades on its lift.
  const late = state(a, 3.99);
  assert.equal(late.get('s1').opacity, 1);
  assert.equal(late.get('s1-title').opacity, 1);
  assert.ok(late.get('s1-cam-lift').opacity < 0.2);
  // The same frame swap: A's root hides on its end as B's shows.
  assert.equal(state(a, 4).get('s1').opacity, 0);
  // B: the title is whole on the first frame (its entrance skipped), the rest enters on its lift.
  const first = state(b, 4);
  assert.equal(first.get('s2').opacity, 1);
  assert.deepEqual({opacity: first.get('s2-title').opacity, y: first.get('s2-title').y}, {opacity: 1, y: 0});
  assert.equal(first.get('s2-cam-lift').opacity, 0);
  assert.equal(state(b, 5).get('s2-cam-lift').opacity, 1);
  // Same rect on screen on both sides of the cut.
  const {children: ca, ops: oa} = opList(a), {children: cb, ops: ob} = opList(b);
  assert.deepEqual(visualBoxes(a, ca, oa, 4, ['s1-title'])['s1-title'], visualBoxes(b, cb, ob, 4, ['s2-title'])['s2-title']);
});

test('lift layers wrap the siblings in the view, the size of their parent, origin at the module centre', () => {
  const story = twoGraphs();
  const b = resolveModule(story.scenes[1], story);
  const {children} = opList(b);
  assert.deepEqual(children.map(node => node.id), ['s2-title', 's2-cam-lift']);
  assert.equal(children[1].style.width, '100%');
  assert.equal(children[1].style.transformOrigin, `${b.rect.width / 2}px ${b.rect.height / 2}px`);
  assert.equal(children[1].children[0].id, 's2-cam');
});

test('a scene with no carry renders as before', () => {
  const story = twoGraphs(undefined);
  delete story.scenes[1].carry;
  const plain = resolveModule(story.scenes[1], story);
  assert.equal(plain.carry, undefined);
  assert.equal(plain.motion.enterFrom.opacity, 0);
});

test('the source is the last op-list scene on the track; a footage cutaway between is skipped', () => {
  const story = pinStory([
    graph('s1', 0, 4, ['Research', 'Script', 'Voice']),
    {id: 'talk', module: 'clip', start: 4, end: 6, params: {src: 'host.mp4'}},
    graph('s3', 6, 10, ['Edit', 'Music', 'Publish'], {carry: {map: {'s1-title': 's3-title'}}})
  ]);
  assert.equal(carrySource(story, story.scenes[2]).id, 's1');
  const a = resolveModule(story.scenes[0], story);
  assert.deepEqual(a.carry.out.ids, ['s1-title']);
  // Resumes where it left off: whole on the first frame back.
  const b = resolveModule(story.scenes[2], story);
  assert.equal(state(b, 6).get('s3-title').opacity, 1);
});

test('carry needs a cut, a camera move or a slide, and real elements', () => {
  const fade = twoGraphs(undefined, {in: {type: 'fade', dur: 0.4}});
  assert.equal(stillPlateProblem(fade, {in: {type: 'push', dur: 0.6}}), null);
  assert.match(stillPlateProblem(fade, fade.scenes[1]), /fade/);
  assert.throws(() => resolveModule(fade.scenes[1], fade), /carry needs a cut/);
  for (const extra of [{in: {type: 'whip-pan', dur: 0.26, direction: 'left'}}, {in: {type: 'pan', dur: 0.8}}]) assert.equal(stillPlateProblem(twoGraphs(undefined, extra), twoGraphs(undefined, extra).scenes[1]), null);
  const missing = twoGraphs({map: {'s1-nope': 's2-title'}});
  assert.throws(() => resolveModule(missing.scenes[1], missing), /no element "s1-nope"/);
  const wrongFrom = twoGraphs({from: 'zz', map: {'s1-title': 's2-title'}});
  assert.throws(() => resolveModule(wrongFrom.scenes[1], wrongFrom), /from must be s1/);
});

test('story validation checks the carry shape', () => {
  const errors = (carry) => validateStory(twoGraphs(carry)).errors.filter(error => /carry/.test(error));
  assert.deepEqual(errors(false), []);
  assert.deepEqual(errors({map: {'s1-title': 's2-title'}}), []);
  assert.equal(errors({map: {}}).length, 1);
  assert.equal(errors({map: {'s1-title': 's2-title'}, via: 'x'}).length, 1);
  assert.equal(errors({map: {'s1-a': 's2-x', 's1-b': 's2-x'}}).length, 1);
});

const flipStory = () => pinStory([
  graph('s1', 0, 4, ['Research', 'Script', 'Voice', 'Camera']),
  graph('s2', 4, 8, ['Research', 'Script', 'Voice', 'Camera', 'Edit'], {carry: {map: {'s1-title': 's2-title', 's1-hub': 's2-hub', 's1-node-n0': 's2-node-n0', 's1-node-n1': 's2-node-n1', 's1-node-n2': 's2-node-n2', 's1-node-n3': 's2-node-n3'}}})
]);

test('carry: each element starts on its source rect and settles on its slot (the FLIP)', () => {
  const story = flipStory();
  const a = resolveModule(story.scenes[0], story), b = resolveModule(story.scenes[1], story);
  const items = b.carry.in.items;
  assert.equal(items.find(item => item.id === 's2-title').pin, true);
  assert.ok(items.filter(item => item.id.includes('node')).every(item => !item.pin), 'the cards move to a five-node fan');
  const {children: ca, ops: oa} = opList(a), {children: cb, ops: ob} = opList(b);
  const ids = items.map(item => item.id), from = ids.map(id => id.replace('s2-', 's1-'));
  const end = visualBoxes(a, ca, oa, 4, from), first = visualBoxes(b, cb, ob, 4, ids);
  for (const [k, id] of ids.entries()) for (const key of ['cx', 'cy', 'w', 'h', 'rotation']) assert.ok(Math.abs(end[from[k]][key] - first[id][key]) < 1, `${id}.${key}: ${end[from[k]][key]} vs ${first[id][key]}`);
  // Settled on the slot once the flock has landed: the same as with no carry.
  const plain = flipStory();
  delete plain.scenes[1].carry;
  const free = resolveModule(plain.scenes[1], plain), {children: cf, ops: of} = opList(free);
  const settled = visualBoxes(b, cb, ob, 6.6, ids), slot = visualBoxes(free, cf, of, 6.6, ids);
  for (const id of ids.filter(id => id.includes('node'))) assert.ok(Math.abs(settled[id].cx - slot[id].cx) < 1 && Math.abs(settled[id].cy - slot[id].cy) < 1, `${id} settles on its slot`);
  // Visible throughout, and members leave a little apart, nearest first.
  const cards = ob.filter(op => op.type === 'tween' && /node-n[0-3]$/.test(op.target) && 'x' in op.to && op.from.x !== op.to.x && op.start < 5);
  assert.equal(new Set(cards.map(op => op.start)).size, 4);
  assert.ok(Math.max(...cards.map(op => op.start)) - 4 <= 0.3 + 1e-6);
  assert.equal(frameState(ob, 4.2).get('s2-node-n0').opacity, 1);
});

test('carry eases slow → fast → slow with no overshoot', () => {
  const story = flipStory();
  const b = resolveModule(story.scenes[1], story);
  const moves = opList(b).ops.filter(op => op.type === 'tween' && op.target === 's2-node-n0' && op.start < 5);
  assert.deepEqual(moves.map(op => op.ease).sort(), ['power2.inOut', 'power3.inOut', 'power3.inOut']);
});

test('both sides of a carry sit on a still plate: no per-scene hold drift', async () => {
  const {sceneDrift} = await import('@launchclip/core/ambient.mjs');
  const story = twoGraphs();
  const [a, b] = story.scenes.map(scene => resolveModule(scene, story));
  assert.equal(sceneDrift(story, story.scenes[0], a), null);
  assert.equal(sceneDrift(story, story.scenes[1], b), null);
  const plain = twoGraphs();
  delete plain.scenes[1].carry;
  assert.notEqual(sceneDrift(plain, plain.scenes[1], resolveModule(plain.scenes[1], plain)), null);
});

test('an overlay that rests hidden and only flashes is not an entrance: lit rims stay dark on the first frame', () => {
  const story = flipStory();
  const b = resolveModule(story.scenes[1], story);
  const first = state(b, 4);
  assert.equal(first.get('s2-node-n0-lit').opacity, 0);
  assert.equal(first.get('s2-hub-ring').opacity, 0);
  assert.equal(first.get('s2-node-n0').opacity, 1);
});

// ---------------------------------------------------------------------------
// The switch: story.motion.flow (docs/FLUID_MOTION_RFC.md §6.1)

import {resolveFlow} from '@launchclip/core/flow.mjs';

test('flow: feels set the default, an explicit motion.flow wins', () => {
  const on = {carry: 'auto', pin: true};
  assert.deepEqual(resolveFlow({motion: {feel: 'kinetic'}}), on);
  assert.deepEqual(resolveFlow({motion: {feel: 'steady'}}), on);
  assert.deepEqual(resolveFlow({motion: {feel: {preset: 'steady', kicks: false}}}), on);
  assert.equal(resolveFlow({motion: {feel: 'snap'}}), null);
  assert.equal(resolveFlow({}), null);
  assert.equal(resolveFlow({motion: {feel: 'kinetic', flow: false}}), null);
  assert.deepEqual(resolveFlow({motion: {feel: 'snap', flow: true}}), on);
  assert.deepEqual(resolveFlow({motion: {flow: {carry: false}}}), {carry: false, pin: true});
  assert.equal(resolveFlow({motion: {flow: {carry: false, pin: false}}}), null);
});

const autoStory = (motion, second = {}) => ({...pinStory([
  graph('s1', 0, 4, ['Research', 'Script', 'Voice', 'Camera']),
  graph('s2', 4, 8, ['Research', 'Script', 'Voice', 'Camera', 'Edit'], second)
]), motion});

test('flow on: identical elements pin, same-kind elements with the same text carry, nearest first', () => {
  const story = autoStory({feel: 'steady'});
  const a = resolveModule(story.scenes[0], story), b = resolveModule(story.scenes[1], story);
  const items = Object.fromEntries(b.carry.in.items.map(item => [item.id, item.pin]));
  assert.equal(items['s2-title'], true);
  for (const k of [0, 1, 2, 3]) assert.equal(items[`s2-node-n${k}`], false, `card ${k} carries`);
  assert.equal(items['s2-node-n4'], undefined, 'the new card flocks in');
  assert.ok(a.carry.out.ids.includes('s1-node-n0'));
  // Every pair is the same card by its label.
  const {children: ca} = opList(a), {children: cb} = opList(b);
  const label = (children, id) => JSON.stringify(children).includes(id);
  assert.ok(label(ca, 's1-node-n3') && label(cb, 's2-node-n3'));
});

test('flow: carry: false on a scene opts it out; a typed transition, snap or flow: false leave it off', () => {
  const opt = autoStory({feel: 'steady'}, {carry: false});
  assert.equal(resolveModule(opt.scenes[1], opt).carry, undefined);
  assert.equal(resolveModule(opt.scenes[0], opt).carry, undefined);
  const fade = autoStory({feel: 'kinetic'}, {in: {type: 'fade', dur: 0.4}});
  assert.equal(resolveModule(fade.scenes[1], fade).carry, undefined);
  assert.equal(resolveModule(autoStory({feel: 'snap'}).scenes[1], autoStory({feel: 'snap'})).carry, undefined);
  const off = autoStory({feel: 'kinetic', flow: false});
  assert.equal(resolveModule(off.scenes[1], off).carry, undefined);
});

test('flow: pin false drops pins; carry false keeps only pins', () => {
  const noPin = autoStory({flow: {pin: false}});
  const ids = resolveModule(noPin.scenes[1], noPin).carry.in.items.map(item => item.id);
  assert.ok(!ids.includes('s2-title') && ids.includes('s2-node-n0'));
  const pinsOnly = autoStory({flow: {carry: false}});
  assert.deepEqual(resolveModule(pinsOnly.scenes[1], pinsOnly).carry.in.items.map(item => item.id), ['s2-title']);
});

test('flow: an explicit carry map replaces the automatic pairing', () => {
  const story = autoStory({feel: 'steady'}, {carry: {map: {'s1-title': 's2-title'}}});
  assert.deepEqual(resolveModule(story.scenes[1], story).carry.in.items.map(item => item.id), ['s2-title']);
});

test('story validation checks motion.flow', () => {
  const errors = (flow) => validateStory({...twoGraphs(), motion: {flow}}).errors.filter(error => /flow/.test(error));
  for (const ok of [true, false, {carry: 'auto'}, {carry: false, pin: true}, {}]) assert.deepEqual(errors(ok), [], JSON.stringify(ok));
  for (const bad of ['on', {carry: true}, {pin: 'yes'}, {carry: 'auto', mode: 'x'}]) assert.equal(errors(bad).length, 1, JSON.stringify(bad));
});

test('style packs carry flow: calm and premium seeds always have it, and applyStyle passes it to the story', async () => {
  const {generateStyle} = await import('@launchclip/core/style-seed.mjs');
  const {applyStyle, validateStylePack} = await import('@launchclip/core/style.mjs');
  for (const tone of ['calm', 'premium']) for (const seed of ['0badc0de', '12345678', 'cafef00d']) {
    const pack = generateStyle({seed, tone}).pack ?? generateStyle({seed, tone});
    assert.equal(pack.motion.flow, true, `${tone} ${seed}`);
    assert.deepEqual(validateStylePack(pack).errors ?? [], []);
    const story = applyStyle(twoGraphs(), pack).story ?? applyStyle(twoGraphs(), pack);
    assert.equal(story.motion.flow, true);
  }
  assert.ok(validateStylePack({schema: 'launchclip.style.v3', name: 'x', motion: {flow: 'yes'}}).errors.some(error => /motion\.flow/.test(error)));
});

// Carry through a moving camera (docs/rd/carry-moving-camera.md).
import {cameraPlan, cameraStateAt, driftAt, screenPoint, sceneObjectLookup, worldPoint} from '@launchclip/core/camera-world.mjs';
import {sceneWindows} from '@launchclip/core/transitions.mjs';
import {sceneRenderEnd} from '@launchclip/core/modules.mjs';
import {getEase} from '@launchclip/core/motion.mjs';

// A slide moves B's layer, not the camera: its offset at t from the window's in-tweens.
const layerAt = (story, id, t) => {
  const tweens = sceneWindows(story).scenes.find(entry => entry.id === id).tweens.filter(tw => tw.role === 'in' && (tw.prop === 'x' || tw.prop === 'y'));
  const out = {x: 0, y: 0};
  for (const tw of tweens) { const p = Math.min(1, Math.max(0, (t - tw.at) / tw.duration)); out[tw.prop] = tw.from + (tw.to - tw.from) * (p >= 1 ? 1 : getEase(tw.ease)(p)); }
  return out;
};
const movingStory = (transition, camera) => ({...flipStory(), camera, scenes: flipStory().scenes.map((scene, k) => (k ? {...scene, in: transition} : scene))});

/** Screen centre of each id on scene B's plate at t, through the camera. */
function onScreen(story, b, ids, t) {
  const plan = cameraPlan(story, {windows: sceneWindows(story), objects: sceneObjectLookup(story, (scene, value) => resolveModule(scene, value))});
  const {children, ops} = opList(b), boxes = visualBoxes(b, children, ops, t, ids);
  const layer = layerAt(story, b.id, t);
  // Less the ambient drift, which moves the whole frame (carried elements too) and adds up over a long overview.
  const still = ({x, y}) => { const d = driftAt(plan, t), W2 = plan.width / 2, H2 = plan.height / 2; return {x: W2 + (x - W2 - d.x) / d.scale, y: H2 + (y - H2 - d.y) / d.scale}; };
  return Object.fromEntries(ids.map(id => [id, (({x, y}) => ({x: x + layer.x, y: y + layer.y}))(plan ? still(screenPoint(plan, worldPoint(plan.placements[b.id], {x: boxes[id].cx, y: boxes[id].cy}), t)) : {x: boxes[id].cx, y: boxes[id].cy})]));
}

for (const [name, transition, camera] of [
  ['a whip-pan in a cuts story', {type: 'whip-pan', dur: 0.3, direction: 'left'}, {mode: 'cuts'}],
  ['a pan in a world-camera story', {type: 'pan', dur: 0.9}, {mode: 'world'}],
  ['a push in a cuts story', {type: 'push', dur: 0.6, direction: 'up'}, {mode: 'cuts'}],
  ['a whip in a cuts story', {type: 'whip', dur: 0.4, direction: 'left'}, {mode: 'cuts'}],
  // §6.6: through a zoom the element rides a layer that cancels the camera.
  ['a push in a world-camera story', {type: 'push', dur: 0.9}, {mode: 'world'}],
  ['a pull in a world-camera story', {type: 'pull', dur: 0.9}, {mode: 'world'}],
  ['a pull in a cuts story', {type: 'pull', dur: 0.8}, {mode: 'cuts'}],
  ['an orbit in a world-camera story', {type: 'orbit', dur: 0.9, direction: 'right'}, {mode: 'world'}],
  ['an orbit in a cuts story', {type: 'orbit', dur: 0.9, direction: 'left'}, {mode: 'cuts'}],
  // Two legs (out to the span, a hold, in to B): the ride takes both, the FLIP spans them.
  ['an overview in a world-camera story', {type: 'overview', dur: 2.4}, {mode: 'world'}]
]) {
  test(`carry rides ${name}: a straight line on screen with the camera's ease, a held title stays put`, () => {
    const story = movingStory(transition, camera);
    const a = resolveModule(story.scenes[0], story, {end: sceneRenderEnd(story, story.scenes[0])}), b = resolveModule(story.scenes[1], story);
    const {move, items} = b.carry.in;
    assert.ok(move && move.start === 4, 'the move is recorded');
    assert.ok(items.every(item => !item.pin), 'nothing is a pin across a move: the plates sit apart in the world');
    // A zoom rides a layer whose scale is the camera's reciprocal on every sample (§6.6); pans and slides have none.
    const ride = b.carry.in.ride;
    assert.equal(Boolean(ride), ['orbit', 'pull', 'overview'].includes(transition.type) || (transition.type === 'push' && camera.mode === 'world'));
    if (ride) {
      const plan = cameraPlan(story, {windows: sceneWindows(story), objects: sceneObjectLookup(story, (scene, value) => resolveModule(scene, value))});
      const P = plan.placements[b.id];
      for (const [t, , , scale, rotation] of ride.samples) {
        const cam = cameraStateAt(plan, t);
        assert.ok(Math.abs(scale * cam.zoom * P.scale - 1) < 1e-4, `ride scale at ${t}`);
        assert.ok(Math.abs(rotation + cam.rotation + P.rotation) < 1e-3, `ride rotation at ${t}`);
      }
    }
    // A hides its handed copies on the boundary; it is drawn on through the move.
    assert.ok(a.end > 4);
    assert.equal(frameState(opList(a).ops, 4).get('s1-node-n0').opacity, 0);
    assert.equal(frameState(opList(a).ops, 3.99).get('s1-node-n0').opacity, 1);
    // Every member moves in unison with the move's own ease.
    const tweens = opList(b).ops.filter(op => op.type === 'tween' && /node-n\d$|title$|hub$/.test(op.target) && op.start === move.start && op.duration === move.duration);
    assert.ok(tweens.length >= 6 * 3 - 3 && tweens.every(op => op.ease === move.ease));
    const ids = items.map(item => item.id);
    const plain = movingStory(transition, camera);
    delete plain.scenes[1].carry;
    const free = resolveModule(plain.scenes[1], plain);
    const start = onScreen(story, b, ids, 4), end = onScreen(story, b, ids, move.start + move.duration);
    const settled = onScreen(story, b, ids, 6.6), slot = onScreen(plain, free, ids, 6.6);
    const from = Object.fromEntries(ids.map(id => [id, onScreen(story, a, [id.replace('s2-', 's1-')], 3.99)[id.replace('s2-', 's1-')]]));
    for (const id of ids) {
      assert.ok(Math.hypot(start[id].x - from[id].x, start[id].y - from[id].y) < 1.5, `${id} starts where A's copy was on screen`);
      assert.ok(Math.hypot(settled[id].x - slot[id].x, settled[id].y - slot[id].y) < 1.5, `${id} settles on its slot`);
    }
    // A ride makes B's px screen px: on every frame of the move each element is on screen where it is in B's px
    // with the ride taken out (node-graph's own -cam push included).
    if (ride) {
      const strip = node => (!node || typeof node !== 'object' ? node : node.id?.endsWith('-ride') ? strip(node.children[0]) : {...node, children: (node.children ?? []).map(strip)});
      const {children, ops} = opList(b), bare = children.map(strip);
      for (let k = 0; k <= 10; k += 1) {
        const t = move.start + (move.duration * k) / 10, now = onScreen(story, b, ids, t), canvas = visualBoxes(b, bare, ops, t, ids);
        for (const id of ids) assert.ok(Math.hypot(now[id].x - canvas[id].cx, now[id].y - canvas[id].cy) < 1, `${id} at ${t}: on screen where it is in B's px`);
      }
    }
    // In between: on the straight line from start to end, never past either end (an overview's 2.4 s path also
    // carries node-graph's own slow -cam push on its own ease, so it bows by a few px: the check above covers it).
    if (move.duration > 1.5) return;
    const tol = 1.5;
    for (let k = 1; k < 10; k += 1) {
      const t = move.start + (move.duration * k) / 10, now = onScreen(story, b, ids, t);
      for (const id of ids) {
        const dx = end[id].x - start[id].x, dy = end[id].y - start[id].y, len = Math.hypot(dx, dy);
        const ox = now[id].x - start[id].x, oy = now[id].y - start[id].y;
        if (len < 1) { assert.ok(Math.hypot(ox, oy) < tol, `${id} holds still on screen at ${t}`); continue; }
        const along = (ox * dx + oy * dy) / len, off = Math.abs(ox * dy - oy * dx) / len;
        assert.ok(off < tol && along > -tol && along < len + tol, `${id} at ${t}: ${along.toFixed(1)} of ${len.toFixed(1)}, ${off.toFixed(1)} off the line`);
      }
    }
  });
}

test('a world-camera cut stacks the plates: the carry is the still-plate FLIP', () => {
  const story = {...flipStory(), camera: {mode: 'world'}};
  const b = resolveModule(story.scenes[1], story);
  assert.equal(b.carry.in.move, undefined);
  assert.equal(b.carry.in.items.find(item => item.id === 's2-title').pin, true);
});
