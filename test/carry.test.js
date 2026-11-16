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
  assert.deepEqual(a.carry.out, {ids: ['s1-title'], to: 's2'});
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

test('carry needs a still plate and real elements', () => {
  const whip = twoGraphs(undefined, {in: {type: 'whip-pan', dur: 0.26, direction: 'left'}});
  whip.scenes[1].carry = {map: {'s1-title': 's2-title'}};
  assert.match(stillPlateProblem(whip, whip.scenes[1]), /whip-pan/);
  assert.throws(() => resolveModule(whip.scenes[1], whip), /carry needs a cut/);
  const world = {...twoGraphs(), camera: {mode: 'world'}};
  assert.throws(() => resolveModule(world.scenes[1], world), /world camera/);
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
