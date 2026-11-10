// The racing worlds (kit/core/worlds/racing.mjs), the story props and the
// starting gate with its two states (kit/core/worlds/props.mjs), and the cues
// that open it (kit/core/catalog-world.mjs sceneProps): in a world scene, in
// a cast-scene, and once for a whole story. Renderer parity for all of them
// is test/fixtures/parity/{world,characters}-{racetrack,stable-yard,paddock}-*.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {PROPS, PROP_IDS, PROP_STATES, RACING_WORLDS, STORY_PROP_IDS, WORLD_GROUPS, WORLDS, drawProp, renderWorld, storyWorldErrors, suggestWorld, worldAnchors} from '@launchclip/core/worlds/index.mjs';
import {STORY_SCALE} from '@launchclip/core/worlds/racing.mjs';
import {gateBays} from '@launchclip/core/worlds/props.mjs';
import {propStatesBefore, worldTimeline, worldView} from '@launchclip/core/catalog-world.mjs';
import {charactersTimeline, charactersView} from '@launchclip/core/catalog-characters.mjs';
import {frameState} from '@launchclip/core/catalog-b-view.mjs';
import {resolveModule} from '@launchclip/core/modules.mjs';
import {resolveStory, validateStory} from '@launchclip/core/story.mjs';
import {isFourLegged} from '@launchclip/core/characters/kinds.mjs';
import {racingStory, RACING_CAST} from '../scripts/racing-sheet.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const L = {width: 1920, height: 1080}, P = {width: 1080, height: 1920};
const find = (node, id) => (node && typeof node === 'object' ? (node.id === id ? node : (node.children ?? []).map(child => find(child, id)).find(Boolean)) : null);
const opacityAt = (ops, t, id) => frameState(ops, t).get(id)?.opacity;

test('three racing worlds, outside, drawn at the cast\'s scale in landscape and portrait', () => {
  assert.deepEqual([...RACING_WORLDS], ['racetrack', 'stable-yard', 'paddock']);
  for (const kind of RACING_WORLDS) {
    assert.ok(WORLD_GROUPS.outside.includes(kind));
    assert.ok(WORLDS[kind].describe.length > 40);
    for (const canvas of [L, P]) for (const time of ['day', 'dusk', 'night']) {
      const world = renderWorld({kind, time, canvas, colors: brand.colors});
      assert.ok(world.layers.back.length && world.layers.mid.length, `${kind} ${time}`);
      assert.deepEqual(renderWorld({kind, time, canvas, colors: brand.colors}).layers.mid, world.layers.mid, 'the same inputs give the same nodes');
      // The ground the cast stands on is at the cast's scale, inside the frame.
      const {ground} = world.anchors;
      assert.ok(ground.y > canvas.height * 0.7 && ground.y < canvas.height * 0.9);
      const u = Math.min(canvas.width, canvas.height) / 1080;
      assert.equal(ground.ppm, (canvas.height > canvas.width ? 330 : 290) * u * STORY_SCALE);
    }
  }
  // The stable yard has a wall to hang a rosette on.
  assert.ok(worldAnchors('stable-yard', {canvas: L}).wall);
  assert.equal(suggestWorld('a foal learns why the starting gate opens').kind, 'racetrack');
  assert.equal(suggestWorld('two ponies share a stable').kind, 'stable-yard');
});

test('story props: a few shapes each, at the cast\'s scale in any world', () => {
  for (const id of ['bucket', 'hay-bale', 'saddle', 'rosette', 'finish-post', 'jump', 'sign', 'starting-gate']) {
    assert.ok(PROP_IDS.includes(id) && STORY_PROP_IDS.includes(id) && PROPS[id].story, id);
    const drawn = drawProp({id, colors: brand.colors, box: {x: 0, y: 0, width: 300, height: 300}});
    assert.ok(drawn.nodes.length >= 3 && drawn.nodes.length <= 40, `${id}: ${drawn.nodes.length} shapes`);
  }
  for (const id of ['trophy', 'ball', 'gift']) assert.ok(STORY_PROP_IDS.includes(id), id);
  // A bucket in the park is as large as one on the racetrack: the cast's scale, not the park's.
  const scaleIn = kind => renderWorld({kind, canvas: L, props: ['bucket']}).props[0].scale;
  assert.equal(scaleIn('park'), scaleIn('racetrack'));
  assert.equal(scaleIn('racetrack'), 290 * STORY_SCALE);
  // A mare in a wide shot is about two metres of that scale tall, so she stands under the gate's beam.
  const gate = renderWorld({kind: 'racetrack', canvas: L, props: ['starting-gate']}).props[0];
  assert.ok(gate.rect.height > 400 && gate.rect.height < 620, `gate ${gate.rect.height}px`);
});

test('the starting gate: closed and open, two stalls in portrait and three in landscape, centred', () => {
  assert.deepEqual(PROP_STATES, {'starting-gate': ['closed', 'open']});
  assert.equal(gateBays({portrait: true}), 2);
  assert.equal(gateBays({portrait: false}), 3);
  const closed = drawProp({id: 'starting-gate', state: 'closed', colors: brand.colors, box: {x: 0, y: 0, width: 400, height: 300}}).nodes;
  const open = drawProp({id: 'starting-gate', state: 'open', colors: brand.colors, box: {x: 0, y: 0, width: 400, height: 300}}).nodes;
  assert.notDeepEqual(closed, open);
  for (const canvas of [L, P]) {
    const world = renderWorld({id: 'w', kind: 'racetrack', canvas, props: ['starting-gate']});
    const gate = world.props[0];
    assert.equal(gate.x, canvas.width / 2, 'the gate takes the centre');
    assert.equal(gate.state, 'closed');
    assert.deepEqual(gate.groups, {closed: 'w-prop0-closed', open: 'w-prop0-open'});
    // Both states are drawn, the other one clear.
    const mid = {children: world.layers.mid};
    assert.equal(find(mid, 'w-prop0-closed').attrs?.opacity, undefined);
    assert.equal(find(mid, 'w-prop0-open').attrs.opacity, 0);
    const opened = renderWorld({id: 'w', kind: 'racetrack', canvas, props: [{id: 'starting-gate', state: 'open'}]});
    assert.equal(find({children: opened.layers.mid}, 'w-prop0-closed').attrs.opacity, 0);
  }
  assert.throws(() => renderWorld({kind: 'racetrack', props: [{id: 'starting-gate', state: 'ajar'}]}), /state must be one of closed, open/);
  assert.throws(() => renderWorld({kind: 'racetrack', props: [{id: 'bucket', state: 'open'}]}), /bucket has no states/);
});

test('a world scene cues the gate open, and the state lasts into later scenes', () => {
  const scenes = [
    {id: 'a', module: 'world', start: 0, end: 4, params: {kind: 'racetrack', props: [{id: 'starting-gate', cues: [{at: 1.5, state: 'open'}]}]}},
    {id: 'b', module: 'world', start: 4, end: 8, params: {kind: 'racetrack', props: ['starting-gate']}}
  ];
  const story = {schema: 'launchclip.story.v1', lane: 'motion', format: {...L, fps: 30, duration: 8}, brand, scenes};
  assert.deepEqual(validateStory(story).errors, []);
  const model = resolveModule(scenes[0], story);
  assert.deepEqual(model.content.propCues, [{prop: 0, id: 'starting-gate', at: 1.5, from: 'closed', to: 'open'}]);
  assert.ok(find(worldView(model).front, 'a-prop0-open'));
  const ops = worldTimeline(model);
  assert.equal(opacityAt(ops, 1.4, 'a-prop0-open'), undefined, 'closed until the cue (the drawing\'s own opacity)');
  assert.equal(opacityAt(ops, 1.6, 'a-prop0-open'), 1);
  assert.equal(opacityAt(ops, 1.6, 'a-prop0-closed'), 0);
  assert.deepEqual(propStatesBefore(story, scenes[1]), {'starting-gate': 'open'});
  const later = resolveModule(scenes[1], story);
  assert.equal(later.content.props[0].state, 'open');
  assert.equal(later.content.propCues, undefined);
  assert.throws(() => resolveModule({...scenes[0], params: {kind: 'racetrack', props: [{id: 'bucket', cues: [{at: 1, state: 'open'}]}]}}, story), /bucket has no states to cue/);
});

test('a cast-scene places props behind a foal and a mare and cues the gate; both stand on the ground', () => {
  for (const kind of RACING_WORLDS) for (const format of [L, P]) {
    const story = racingStory(kind, format);
    assert.ok(RACING_CAST.every(member => isFourLegged(member.kind)));
    const plain = resolveModule(story.scenes[0], story);
    const ground = worldAnchors(kind, {canvas: format}).ground.y;
    for (const actor of plain.content.actors) assert.equal(actor.floor, ground, `${kind}: ${actor.id} stands on the world's ground`);
    assert.equal(plain.content.back.length, 0, 'no pot plant on a racetrack');
    const [foal, mare] = plain.content.actors;
    assert.ok(foal.x < mare.x && foal.facing === 'right' && mare.facing === 'left', 'they face each other along the course');
    const gate = resolveModule(story.scenes[1], story);
    assert.equal(gate.content.drawWorld.props[0].state, 'closed');
    assert.deepEqual(gate.content.propCues, [{prop: 0, id: 'starting-gate', at: 2, from: 'closed', to: 'open'}]);
    const ops = charactersTimeline(gate);
    assert.ok(find(charactersView(gate).front, 'gate-world-prop0-closed'));
    assert.equal(opacityAt(ops, 5.9, 'gate-world-prop0-open'), undefined);
    assert.equal(opacityAt(ops, 6.1, 'gate-world-prop0-open'), 1);
    assert.equal(opacityAt(ops, 6.1, 'gate-world-prop0-closed'), 0);
  }
});

test('a story cues the gate once for every scene: closed before, opening in the scene on screen, open after', () => {
  const cast = [{id: 'foal'}, {id: 'mare'}];
  const scene = (id, start, end, extra = {}) => ({id, module: 'cast-scene', start, end, params: {set: 'standing', shot: 'wide', cast, ...extra}});
  const story = {schema: 'launchclip.story.v1', lane: 'motion', format: {...P, fps: 30, duration: 9}, brand, cast: {style: 'chibi', characters: RACING_CAST},
    world: {kind: 'racetrack', time: 'day', props: [{id: 'starting-gate', cues: [{at: 'word:go+0.5', state: 'open'}]}, {id: 'trophy', on: 'ground', scale: 2.5}]},
    scenes: [scene('before', 0, 3), scene('during', 3, 6), scene('after', 6, 9)]};
  assert.deepEqual(storyWorldErrors(story.world), []);
  const words = [{text: 'Ready,', start: 1, end: 1.4}, {text: 'go!', start: 4, end: 4.3}];
  const resolved = resolveStory(story, {words});
  const play = resolved.story ?? resolved;
  assert.equal(play.world.props[0].cues[0].at, 4.5);
  const [before, during, after] = play.scenes.map(entry => resolveModule(entry, play));
  assert.equal(before.content.drawWorld.props[0].state, 'closed');
  assert.equal(before.content.propCues, undefined);
  assert.deepEqual(during.content.propCues, [{prop: 0, id: 'starting-gate', at: 1.5, from: 'closed', to: 'open'}]);
  assert.equal(after.content.drawWorld.props[0].state, 'open');
  assert.equal(after.content.propCues, undefined);
  // A scene can still say otherwise for itself.
  const shut = resolveModule(scene('after', 6, 9, {props: [{id: 'starting-gate', state: 'closed'}]}), play);
  assert.equal(shut.content.drawWorld.props[0].state, 'closed');
  assert.match(storyWorldErrors({kind: 'racetrack', props: [{id: 'bucket', cues: [{at: 1, state: 'open'}]}]})[0], /bucket has no states to cue/);
  assert.match(storyWorldErrors({kind: 'racetrack', props: [{id: 'starting-gate', cues: [{at: 1, state: 'ajar'}]}]})[0], /state must be one of closed, open/);
});

test('stories without stateful props draw as before: props as written, no cues, the pot plant where it was', () => {
  const story = {schema: 'launchclip.story.v1', lane: 'motion', format: {...L, fps: 30, duration: 4}, brand, cast: {style: 'flat', characters: [{id: 'maya'}, {id: 'theo'}]}, world: {kind: 'park', time: 'day', props: ['bench', {id: 'kite', at: 'left'}]},
    scenes: [{id: 's', module: 'cast-scene', start: 0, end: 4, params: {set: 'standing', cast: [{id: 'maya'}, {id: 'theo'}]}}]};
  const model = resolveModule(story.scenes[0], story);
  assert.deepEqual(model.content.drawWorld.props, ['bench', {id: 'kite', at: 'left'}], 'the story\'s props pass through untouched');
  assert.equal(model.content.propCues, undefined);
  assert.ok(model.content.back.length > 0, 'the standing set keeps its plant in a park');
  assert.throws(() => resolveModule({...story.scenes[0], params: {...story.scenes[0].params, backdrop: 'room', props: ['bucket']}}, story), /needs the world the cast stands in/);
});

test('parity fixtures cover each racing world, the gate\'s two states and the props, in both aspects', () => {
  const dir = fileURLToPath(new URL('./fixtures/parity/', import.meta.url));
  const fixtures = readdirSync(dir).filter(name => /racetrack|stable-yard|paddock/.test(name)).map(name => JSON.parse(readFileSync(`${dir}${name}`, 'utf8')).story);
  const text = JSON.stringify(fixtures);
  for (const kind of RACING_WORLDS) assert.ok(fixtures.some(story => story.world?.kind === kind || story.scenes[0].params.kind === kind), kind);
  for (const id of ['starting-gate', 'bucket', 'hay-bale', 'saddle', 'rosette', 'finish-post', 'jump', 'sign']) assert.ok(text.includes(`"${id}"`), id);
  assert.ok(text.includes('"state":"open"'), 'the open state');
  assert.ok(fixtures.some(story => story.format.height > story.format.width) && fixtures.some(story => story.format.width > story.format.height));
  assert.ok(fixtures.some(story => story.scenes[0].module === 'cast-scene') && fixtures.some(story => story.scenes[0].module === 'world'));
  assert.ok(existsSync(fileURLToPath(new URL('../scripts/racing-sheet.mjs', import.meta.url))));
});
