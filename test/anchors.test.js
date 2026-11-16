// Anchors (kit/core/anchors.mjs; docs/FLUID_MOTION_RFC.md §7): node-graph
// publishes its hub, cards and converge; cast cues aim at them and default
// their time to the anchor's.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveStory} from '@launchclip/core/story.mjs';
import {resolveModule, sceneAnchors} from '@launchclip/core/modules.mjs';
import {targetError} from '@launchclip/core/characters/actions.mjs';

const golden = () => JSON.parse(readFileSync(new URL('../examples/story/node-graph-9x16/storyboard.json', import.meta.url), 'utf8'));
const withCues = (cues, edit = story => story) => {
  const story = golden();
  story.scenes[0].params.cast[0].cues = cues;
  return resolveStory(edit(story));
};
const castModel = story => resolveModule(story.scenes.find(scene => scene.id === 'room'), story);

test('node-graph publishes hub, converge and node-<id> at their events, centred on their elements', () => {
  const story = resolveStory(golden());
  const graph = resolveModule(story.scenes.find(scene => scene.id === 'team'), story);
  const anchors = sceneAnchors(story, 'team');
  const {hub, nodes} = graph.content;
  const eventTime = name => graph.events.find(event => event.name === name).time;
  assert.deepEqual(Object.keys(anchors).sort(), ['converge', 'hub', ...nodes.map(n => `node-${n.id}`)].sort());
  assert.deepEqual([anchors.hub.x, anchors.hub.y], [graph.rect.x + hub.x, graph.rect.y + hub.y]);
  assert.equal(anchors.hub.time, eventTime('build'));
  assert.equal(anchors.converge.time, eventTime('converge'));
  for (const n of nodes) {
    const anchor = anchors[`node-${n.id}`];
    assert.ok(Math.abs(anchor.x - (graph.rect.x + n.cx)) < 0.02 && Math.abs(anchor.y - (graph.rect.y + n.cy)) < 0.02, `node-${n.id} at its card centre`);
    assert.equal(anchor.time, eventTime(`node-${n.id}`));
  }
});

test('a cast cue aimed at an anchor plays as it lands and looks at it; an explicit at is honoured', () => {
  const story = withCues([{action: 'gaze-at', target: {scene: 'team', anchor: 'node-n3'}}, {pose: 'cheer', target: {scene: 'team', anchor: 'converge'}}, {at: 6.2, pose: 'look', target: {scene: 'team', anchor: 'hub'}}]);
  const anchors = sceneAnchors(story, 'team');
  const states = castModel(story).content.actors[0].states;
  assert.deepEqual(states.slice(1).map(state => state.time), [anchors['node-n3'].time, anchors.converge.time, 6.2]);
  assert.deepEqual(states[1].point, {x: anchors['node-n3'].x, y: anchors['node-n3'].y, far: false});
  assert.equal(states[2].pose, 'cheer');
  assert.ok(states[1].gaze.x !== 0, 'the face turns toward the card');
});

test('anchor targets: unknown anchor, unknown scene, a scene without anchors and an anchor outside the scene are errors', () => {
  assert.throws(() => castModel(withCues([{action: 'gaze-at', target: {scene: 'team', anchor: 'node-n9'}}])), /cues\[0\]\.target scene "team" has no anchor "node-n9" \(anchors: hub, converge, node-n0/);
  assert.throws(() => castModel(withCues([{action: 'gaze-at', target: {scene: 'nope', anchor: 'hub'}}])), /cues\[0\]\.target scene "nope" is not in the story/);
  assert.throws(() => castModel(withCues([{action: 'gaze-at', target: {scene: 'room', anchor: 'hub'}}])), /scene "room" \(cast-scene\) publishes no anchors \(modules with anchors: concept-card, node-graph/);
  // The graph starts after the cast scene's cues end: a defaulted time falls outside it.
  assert.throws(() => castModel(withCues([{pose: 'cheer', target: {scene: 'team', anchor: 'converge'}}], story => { story.scenes[0].end = 3; return story; })), /cues\[0\]\.at defaults to anchor "converge" of scene "team" at 4\.5 s, outside this scene's cues/);
  assert.equal(targetError({scene: 'team', anchor: 'hub'}), null);
  assert.match(targetError({scene: 'team'}), /\{scene: id, anchor: name\}/);
});

test('the anchors sample looks at each card as it lands, left to right, from the front, and cheers at converge', () => {
  const story = resolveStory(JSON.parse(readFileSync(new URL('../examples/story/node-graph-anchors-9x16/storyboard.json', import.meta.url), 'utf8')));
  const anchors = sceneAnchors(story, 'team');
  const states = castModel(story).content.actors[0].states;
  const looks = ['n0', 'n1', 'n2', 'n3'].map(id => states.find(state => state.time === anchors[`node-${id}`].time));
  assert.ok(looks.every(state => state && state.view === 'front'), 'a plate graphic is looked at from the front');
  for (let i = 1; i < looks.length; i++) assert.ok(looks[i].gaze.x > looks[i - 1].gaze.x + 5, `the face moves on to card ${i}`);
  assert.equal(states.find(state => state.time === anchors.converge.time)?.pose, 'cheer');
});

// A concept card on a plate, then the same card pinned across a cut (RFC §6.4).
const cardStory = (pin = true) => resolveStory({
  schema: 'launchclip.story.v1', title: 'card', lane: 'motion', format: {width: 1080, height: 1920, fps: 30, duration: 6},
  brand: {colors: {bg: '#0b0d1a', primary: '#ffb547', accent: '#46d4ff', ink: '#0b0d1a', paper: '#f6f3ee'}},
  camera: {mode: 'cuts'},
  scenes: ['ad', 'ad2'].map((id, i) => ({id, module: 'concept-card', start: i * 3, end: i * 3 + 3,
    ...(i && pin ? {carry: {map: {'ad-card': 'ad2-card', 'ad-icon': 'ad2-icon', 'ad-word': 'ad2-word'}}} : {}),
    params: {text: 'Your ad', icon: 'megaphone', surface: 'card', rect: {x: 140, y: 420, width: 800, height: 520}}}))
});

test('concept-card publishes its card (with its box) and icon; an anchor stays until its scene ends or the last pin', () => {
  const story = cardStory();
  const model = resolveModule(story.scenes[0], story);
  const {card, icon} = sceneAnchors(story, 'ad');
  assert.deepEqual([card.x, card.y, card.width, card.height, card.element], [540, 680, 800, 520, 'ad-card']);
  assert.equal(card.time, model.events.find(event => event.name === 'word').time);
  assert.equal(icon.time, model.events.find(event => event.name === 'icon').time);
  assert.equal(card.until, 6, 'pinned into ad2, which ends at 6 s');
  assert.equal(sceneAnchors(cardStory(false), 'ad').card.until, 3);
});
