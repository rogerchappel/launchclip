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
