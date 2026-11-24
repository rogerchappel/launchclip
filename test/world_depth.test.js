// The void stage (kit/core/worlds/void-stage.mjs), the filled period worlds
// (period.mjs) and the opt-in depth pass (depth.mjs): drawn at every time,
// deterministic, layered for parallax, the default output unchanged, the
// option validated and carried through the world module and cast scenes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {WORLDS, WORLD_GROUPS, WORLD_KINDS, WORLD_TIMES, renderWorld, worldGrade, storyWorldErrors} from '@launchclip/core/worlds/index.mjs';
import {withoutForeground, worldView} from '@launchclip/core/catalog-world.mjs';
import {OUTLINE} from '@launchclip/core/characters/palette.mjs';
import {resolveModule} from '@launchclip/core/modules.mjs';
import {validateStory} from '@launchclip/core/story.mjs';

const dark = {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'};
const brand = {colors: dark, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const story = (scenes, extra = {}) => ({schema: 'launchclip.story.v1', lane: 'motion', format: {width: 1920, height: 1080, fps: 30, duration: 6}, brand, scenes, ...extra});
const LANDSCAPE = {width: 1920, height: 1080}, PORTRAIT = {width: 1080, height: 1920};
const json = value => JSON.stringify(value);

test('the new worlds sit in their groups and draw at every time and format, deterministically', () => {
  assert.ok(WORLD_GROUPS.outside.includes('void-stage'));
  assert.ok(WORLD_GROUPS.inside.includes('parlour'));
  assert.ok(WORLD_GROUPS.street.includes('cafe-terrace'));
  for (const kind of ['void-stage', 'parlour', 'cafe-terrace']) for (const time of WORLD_TIMES) for (const canvas of [LANDSCAPE, PORTRAIT]) {
    const a = renderWorld({id: 'w', kind, time, colors: dark, canvas, style: 'stick'});
    for (const layer of ['back', 'mid']) assert.ok(a.layers[layer].length > 5, `${kind} ${time} ${layer}`);
    assert.equal(json(renderWorld({id: 'w', kind, time, colors: dark, canvas, style: 'stick'}).layers), json(a.layers), `${kind} ${time} is deterministic`);
  }
});

test('the void stage: fixed black, white and red whatever the brand; slabs in every depth layer that stay with a cast', () => {
  const night = renderWorld({kind: 'void-stage', time: 'night', colors: dark});
  const other = renderWorld({kind: 'void-stage', time: 'night', colors: {...dark, primary: '#00ff00', accent: '#0000ff'}});
  assert.equal(json(other.layers), json(night.layers), 'the brand does not recolour the stage');
  for (const layer of ['back', 'mid', 'front']) assert.match(json(night.layers[layer]), /#(e0262d|[0-9a-f]{6})/, layer);
  assert.match(json(night.layers.mid), /#e0262d/i, 'the red slabs and ground line');
  assert.match(json(night.layers.back), /#050505/, 'a black void at night');
  assert.match(json(renderWorld({kind: 'void-stage', time: 'day'}).layers.back), /#f6f4ef/, 'white paper by day');
  assert.ok(night.edge.length > 0 && night.edge.length === night.layers.front.length);
  assert.equal(json(withoutForeground(night).layers.front), json(night.layers.front), 'a cast standing on the stage keeps the edge slabs');
  // The stick-style detail would tone colours toward paper; the stage keeps its own.
  assert.equal(json(renderWorld({kind: 'void-stage', time: 'night', style: 'stick'}).layers.back[0]), json(renderWorld({kind: 'void-stage', time: 'night', style: 'cinematic'}).layers.back[0]));
});

test('the void stage flips the cast ink to white in the dark and leaves every other colour alone', () => {
  for (const time of ['dusk', 'night']) {
    const g = worldGrade('void-stage', time, 0.5);
    assert.equal(g(OUTLINE), '#f6f4ef', time);
    assert.equal(g('#3d6fd8'), '#3d6fd8', `${time}: no time grade on the cast`);
  }
  assert.equal(worldGrade('void-stage', 'day')(OUTLINE), OUTLINE, 'black ink on white paper');
  const s = {...story([{id: 'c', module: 'cast-scene', start: 0, end: 6, params: {set: 'standing', cast: [{id: 'maya'}]}}]), cast: {style: 'stick-classic', characters: [{id: 'maya'}]}, world: {kind: 'void-stage', time: 'night'}};
  const model = resolveModule(s.scenes[0], s);
  assert.equal(model.content.actors[0].colors.outline, '#f6f4ef');
});

test('depth is opt-in: without it every world draws exactly as before', () => {
  for (const kind of WORLD_KINDS) {
    const plain = renderWorld({id: 'w', kind, time: 'night', colors: dark});
    assert.equal(json(renderWorld({id: 'w', kind, time: 'night', colors: dark, depth: false}).layers), json(plain.layers), kind);
    assert.equal(plain.depth, false);
    if (!WORLDS[kind].edgeFront) assert.deepEqual(plain.edge, [], kind);
  }
});

test('depth fills each group with light, haze, grounding and an edge occluder, at every detail', () => {
  for (const kind of ['city-street', 'park', 'living-room', 'cafe-terrace', 'parlour']) for (const time of WORLD_TIMES) for (const style of ['stick', 'flat', 'cinematic']) {
    const plain = renderWorld({id: 'w', kind, time, colors: dark, style});
    const deep = renderWorld({id: 'w', kind, time, colors: dark, style, depth: true});
    assert.equal(deep.depth, true);
    for (const layer of ['back', 'mid', 'front', 'fx']) assert.ok(deep.layers[layer].length > plain.layers[layer].length, `${kind} ${time} ${style} ${layer}`);
    assert.ok(deep.edge.length > 0, `${kind}: an occluder`);
    assert.equal(json(withoutForeground(deep).layers.front), json(deep.edge), 'the occluder stays when a cast stands in the world');
    assert.equal(json(renderWorld({id: 'w', kind, time, colors: dark, style, depth: true}).layers), json(deep.layers), 'deterministic');
    // Every gradient a layer uses is defined in that layer.
    for (const layer of ['back', 'mid', 'front', 'fx']) {
      const ids = new Set(deep.defs[layer].map(node => node.id));
      for (const [, ref] of json(deep.layers[layer]).matchAll(/url\(#([^)]+)\)/g)) assert.ok(ids.has(ref), `${kind} ${layer}: ${ref}`);
    }
  }
  // Night streets pool warm light; night rooms take moonlight through the window.
  const lamp = renderWorld({kind: 'city-street', time: 'night'}).palette.lampWarm;
  assert.ok(json(renderWorld({kind: 'city-street', time: 'night', depth: true}).defs.fx).split(lamp).length > 4);
  assert.match(json(renderWorld({kind: 'living-room', time: 'night', depth: true}).defs.fx), /#a9c0ff/);
  // The void stage draws its own depth: the option leaves it as it is.
  assert.equal(json(renderWorld({kind: 'void-stage', time: 'night', depth: true}).layers), json(renderWorld({kind: 'void-stage', time: 'night'}).layers));
});

test('the world module takes depth from params or story.world, validates it, and draws it', () => {
  const scene = params => ({id: 'w', module: 'world', start: 0, end: 6, params: {kind: 'city-street', time: 'night', ...params}});
  const on = resolveModule(scene({depth: true}), story([scene({depth: true})]));
  assert.equal(on.content.depth, true);
  assert.equal(on.content.render.depth, true);
  assert.ok(json(worldView(on).front).length > json(worldView(resolveModule(scene({}), story([scene({})]))).front).length);
  const fromStory = resolveModule(scene({}), story([scene({})], {world: {kind: 'city-street', depth: true}}));
  assert.equal(fromStory.content.depth, true);
  assert.equal(resolveModule(scene({depth: false}), story([scene({depth: false})], {world: {kind: 'city-street', depth: true}})).content.depth, false, 'params win');
  assert.equal('depth' in resolveModule(scene({}), story([scene({})])).content.render, false, 'a world without depth renders as before');
  assert.throws(() => resolveModule(scene({depth: 'yes'}), story([scene({depth: 'yes'})])), /params\.depth must be true or false/);
  assert.deepEqual(storyWorldErrors({kind: 'park', depth: true}), []);
  assert.match(storyWorldErrors({kind: 'park', depth: 1}).join(), /depth must be true or false/);
  assert.deepEqual(validateStory(story([scene({})], {world: {kind: 'park', depth: true}})).errors.filter(message => /world/.test(message)), []);
  assert.match(validateStory(story([scene({})], {world: {kind: 'park', depth: 'yes'}})).errors.join(), /world\.depth must be true or false/);
});

test('a cast scene drawing story.world itself carries depth into the world it draws', () => {
  const s = {...story([{id: 'c', module: 'cast-scene', start: 0, end: 6, params: {set: 'standing', cast: [{id: 'maya'}]}}]), cast: {style: 'stick', characters: [{id: 'maya'}]}, world: {kind: 'cafe-terrace', time: 'dusk', depth: true}};
  assert.equal(resolveModule(s.scenes[0], s).content.drawWorld.depth, true);
  const flat = {...s, world: {kind: 'cafe-terrace', time: 'dusk'}};
  assert.equal('depth' in resolveModule(flat.scenes[0], flat).content.drawWorld, false);
});

test('a cast scene with its own params.world can ask for depth', () => {
  const own = (world) => ({...story([{id: 'c', module: 'cast-scene', start: 0, end: 6, params: {set: 'standing', world, cast: [{id: 'maya'}]}}]), cast: {style: 'stick', characters: [{id: 'maya'}]}});
  const lit = own({kind: 'parlour', time: 'night', depth: true});
  assert.equal(resolveModule(lit.scenes[0], lit).content.drawWorld.depth, true);
  const flat = own({kind: 'parlour', time: 'night'});
  assert.equal('depth' in resolveModule(flat.scenes[0], flat).content.drawWorld, false);
  const bad = own({kind: 'parlour', depth: 'yes'});
  assert.throws(() => resolveModule(bad.scenes[0], bad), /params\.world\.depth/);
});
