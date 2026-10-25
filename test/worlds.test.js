// Worlds (kit/core/worlds/) and the world module (kit/core/catalog-world.mjs):
// the library, lighting, palette, detail, props, text readability, the topic
// fit table, and the module in the registry and both renderers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import gsap from 'gsap';
import {WORLDS, WORLD_KINDS, WORLD_GROUPS, WORLD_TIMES, PROP_IDS, STYLE_DETAIL, renderWorld, worldLight, drawProp, storyWorldErrors} from '../kit/core/worlds/index.mjs';
import {scrimFor, TEXT_CONTRAST} from '../kit/core/worlds/readable.mjs';
import {MODULES, WORLD_DEPTH, worldTimeline, worldView} from '../kit/core/catalog-world.mjs';
import {frameState} from '../kit/core/catalog-b-view.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-world.mjs';
import {knownModules, resolveModule} from '../kit/core/modules.mjs';
import {validateStory} from '../kit/core/story.mjs';
import {luminance} from '../kit/core/catalog-b-base.mjs';

const dark = {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'};
const light = {bg: '#f6f1e7', primary: '#1f5eff', accent: '#e8505b', ink: '#ffffff', paper: '#16181d'};
const brand = {colors: dark, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const story = (scenes, extra = {}) => ({schema: 'launchclip.story.v1', lane: 'motion', format: {width: 1920, height: 1080, fps: 30, duration: 6}, brand, scenes, ...extra});
const scene = (params = {}, extra = {}) => ({id: 'w', module: 'world', start: 0, end: 6, params: {kind: 'kitchen', time: 'dusk', ...params}, ...extra});
const resolve = (params, extra) => { const s = scene(params); return resolveModule(s, story([s], extra)); };
const count = nodes => nodes.reduce((n, node) => n + 1 + (node.children ? count(node.children.filter(c => typeof c === 'object')) : 0), 0);

// The RFC library (docs/SEEDED_STYLES_RFC.md §3.5). Each world PR adds its group.
const LIBRARY = {
  inside: ['office', 'home-desk', 'kitchen', 'living-room', 'cafe'],
  street: ['city-street'],
  outside: ['park']
};

test('the library: the RFC worlds in their groups, three times each, 60+ props', () => {
  for (const [group, kinds] of Object.entries(LIBRARY)) for (const kind of kinds) assert.ok(WORLD_GROUPS[group].includes(kind), `${group}: ${kind}`);
  assert.equal(WORLD_KINDS.length, Object.values(LIBRARY).flat().length);
  assert.deepEqual([...WORLD_TIMES], ['day', 'dusk', 'night']);
  assert.ok(PROP_IDS.length >= 60, `${PROP_IDS.length} props`);
  for (const id of ['laptop', 'phone', 'mug', 'plant', 'books', 'whiteboard', 'rocket', 'chart-easel', 'coins', 'trophy', 'lightbulb', 'box', 'bike', 'car', 'tree', 'lamp-post', 'bench']) assert.ok(PROP_IDS.includes(id), id);
  for (const kind of WORLD_KINDS) assert.ok(WORLDS[kind].describe.length > 30, kind);
});

test('every world draws at every time and both formats, deterministically, with layers, anchors and light', () => {
  for (const kind of WORLD_KINDS) for (const time of WORLD_TIMES) for (const canvas of [{width: 1920, height: 1080}, {width: 1080, height: 1920}]) {
    const a = renderWorld({id: 'w', kind, time, colors: dark, canvas});
    for (const layer of ['back', 'mid']) assert.ok(a.layers[layer].length > 0, `${kind} ${time} ${layer}`);
    assert.ok(a.anchors.ground.y > canvas.height * 0.5 && a.anchors.ground.y <= canvas.height, `${kind} ground line`);
    const q = a.quiet;
    assert.ok(q.x >= 0 && q.y >= 0 && q.x + q.width <= canvas.width + 1 && q.y + q.height <= canvas.height + 1 && q.width > 0 && q.height > 0, `${kind} quiet area ${JSON.stringify(q)}`);
    if (time === 'day' && canvas.width === 1920) assert.equal(JSON.stringify(renderWorld({id: 'w', kind, time, colors: dark, canvas}).layers), JSON.stringify(a.layers), `${kind} is deterministic`);
    const l = a.light;
    assert.ok(Math.abs(Math.hypot(l.dir.x, l.dir.y) - 1) < 0.01 && /^#[0-9a-f]{6}$/i.test(l.color) && l.intensity > 0 && l.intensity <= 1, `${kind} ${time} light`);
  }
});

test('lighting: night is darker and cooler than day; dusk is warm and low; night lights glow', () => {
  for (const kind of WORLD_KINDS) {
    const day = worldLight(kind, 'day'), dusk = worldLight(kind, 'dusk'), night = worldLight(kind, 'night');
    assert.ok(night.intensity < dusk.intensity && dusk.intensity < day.intensity, kind);
  }
  assert.ok(worldLight('park', 'dusk').dir.y < worldLight('park', 'day').dir.y, 'the dusk sun is lower');
  const html = (kind, time) => JSON.stringify(renderWorld({id: 'w', kind, time, colors: dark}).layers);
  const lit = renderWorld({kind: 'city-street', time: 'night', colors: dark}).palette.lit;
  assert.ok(html('city-street', 'night').split(lit).length > 20, 'lit windows at night');
  assert.ok(html('city-street', 'day').split(lit).length < html('city-street', 'night').split(lit).length);
  assert.ok(luminance(renderWorld({kind: 'park', time: 'night', colors: dark}).palette.skyTop) < luminance(renderWorld({kind: 'park', time: 'day', colors: dark}).palette.skyTop) / 4);
  assert.throws(() => worldLight('moon-base', 'day'), /unknown world kind/);
  assert.throws(() => worldLight('park', 'noon'), /unknown world time/);
});

test('palette: the brand recolours a world and the time keeps its mood', () => {
  const a = renderWorld({kind: 'kitchen', time: 'day', colors: dark}), b = renderWorld({kind: 'kitchen', time: 'day', colors: light});
  assert.notEqual(a.palette.primary, b.palette.primary);
  assert.notEqual(JSON.stringify(a.layers), JSON.stringify(b.layers));
  for (const colors of [dark, light]) {
    const day = renderWorld({kind: 'office', time: 'day', colors}).palette, night = renderWorld({kind: 'office', time: 'night', colors}).palette;
    assert.ok(luminance(night.wall) < luminance(day.wall), 'night grades the room down');
    assert.equal(night.lit, renderWorld({kind: 'city-street', time: 'night', colors}).palette.lit, 'emissive light is never graded');
  }
});

test('detail follows the drawing style: simple worlds are lighter, rich ones add depth of field and effects', () => {
  assert.equal(STYLE_DETAIL.stick, 'simple');
  assert.equal(STYLE_DETAIL.cinematic, 'rich');
  for (const kind of ['office', 'city-street', 'park']) {
    const simple = renderWorld({kind, time: 'dusk', colors: dark, style: 'line'});
    const rich = renderWorld({kind, time: 'dusk', colors: dark, style: 'cinematic'});
    const n = w => Object.values(w.layers).reduce((sum, nodes) => sum + count(nodes), 0);
    assert.ok(n(simple) < n(rich), `${kind}: ${n(simple)} < ${n(rich)}`);
    assert.equal(simple.defs.back.length, renderWorld({kind, time: 'dusk', colors: dark, style: 'line'}).defs.back.length);
    assert.ok(rich.detail.dof > 0 && rich.detail.vignette > 0 && rich.detail.rays);
    assert.ok(simple.detail.outline && !simple.detail.gradients);
  }
  const view = worldView(resolve({detail: 'rich'}));
  assert.match(view.front.children[0].style.filter, /blur\(/, 'depth of field on the back layer');
});

test('props: every prop draws in every drawing style, by day and night, and props snap to world anchors', () => {
  const box = {x: 0, y: 0, width: 200, height: 200};
  for (const id of PROP_IDS) for (const style of Object.keys(STYLE_DETAIL)) for (const time of ['day', 'night']) {
    const {nodes} = drawProp({id, style, time, colors: dark, box});
    assert.ok(nodes.length > 0, `${id} ${style} ${time}`);
  }
  const w = renderWorld({kind: 'kitchen', time: 'day', colors: dark, props: ['pan', 'mug', 'plant', {id: 'clock', on: 'wall'}, {id: 'car', at: 'right'}]});
  const by = id => w.props.find(prop => prop.id === id);
  assert.equal(by('pan').anchor, 'surface');
  assert.equal(by('plant').anchor, 'floor');
  assert.equal(by('clock').anchor, 'wall');
  assert.equal(by('clock').layer, 'back');
  assert.equal(by('car').x, 1920 * 0.88);
  assert.ok(Math.abs(by('pan').x - 960) > 1920 * 0.08, 'free props keep out of the centre band');
  // A park has no surface: desk props fall back to the ground.
  assert.equal(renderWorld({kind: 'park', colors: dark, props: ['laptop']}).props[0].anchor, 'ground');
  assert.throws(() => renderWorld({kind: 'park', colors: dark, props: ['unicorn']}), /is not a prop/);
  assert.throws(() => renderWorld({kind: 'park', colors: dark, props: [{id: 'mug', at: 2}]}), /at must be/);
});

test('text over a world stays readable: the scrim lifts brand text to 4.5:1 over every quiet area', () => {
  for (const colors of [dark, light]) for (const kind of WORLD_KINDS) for (const time of WORLD_TIMES) {
    const world = renderWorld({kind, time, colors});
    const scrim = scrimFor(world, {text: colors.paper, bg: colors.bg});
    assert.ok(scrim.contrast >= TEXT_CONTRAST, `${kind} ${time} (${colors.bg}): ${scrim.contrast}`);
    assert.ok(scrim.alpha >= 0.18 && scrim.alpha <= 0.94);
    assert.match(scrim.css, /gradient/);
  }
  const model = resolve({scrim: 'auto'});
  assert.equal(model.content.scrim.on, true);
  assert.equal(worldView(model).front.children.at(-1).id, 'w-scrim');
  assert.equal(resolve({}).content.scrim.on, false, 'no scrim unless asked');
});

test('the world module is registered in the module registry, HyperFrames and Remotion', () => {
  assert.ok(knownModules().includes('world'));
  assert.deepEqual(Object.keys(EMITTERS), ['world']);
  assert.match(readFileSync(fileURLToPath(new URL('../kit/remotion/catalog/registry-world.ts', import.meta.url)), 'utf8'), /'world': World/);
  assert.match(readFileSync(fileURLToPath(new URL('../kit/remotion/modules/index.ts', import.meta.url)), 'utf8'), /registry-world/);
  assert.ok(MODULES.world.describe.length > 40 && MODULES.world.timing.minDuration === 2);
});

test('world scenes: params win over story.world, which is the video-wide default', () => {
  const s = {id: 'w', module: 'world', start: 0, end: 4, params: {}};
  const base = story([s], {world: {kind: 'park', time: 'night', props: ['bench']}});
  const model = resolveModule(s, base);
  assert.equal(model.content.kind, 'park');
  assert.equal(model.content.time, 'night');
  assert.deepEqual(model.content.props.map(prop => prop.id), ['bench']);
  const own = resolveModule({...s, params: {kind: 'office', time: 'day'}}, base);
  assert.equal(own.content.kind, 'office');
  assert.deepEqual(own.content.props.map(prop => prop.id), ['bench'], 'props still come from story.world');
  assert.throws(() => resolveModule(s, story([s])), /params\.kind is required \(or set story\.world\.kind\)/);
  assert.throws(() => resolve({kind: 'moon-base'}), /params\.kind must be one of/);
  assert.throws(() => resolve({time: 'noon'}), /params\.time must be one of/);
  assert.throws(() => resolve({props: ['unicorn']}), /params\.props\[0\]/);
  assert.throws(() => resolve({camera: 'zoom'}), /params\.camera\.move must be one of/);
  // The cast's drawing style sets the detail.
  assert.equal(resolve({}, {cast: {style: 'line', characters: [{id: 'maya'}]}}).content.detail, 'simple');
  assert.equal(resolve({detail: 'rich'}).content.detail, 'rich');
});

test('story validation: world is a story field; params.kind is allowed on world scenes only', () => {
  const ok = validateStory(story([scene()], {world: {kind: 'park', time: 'dusk'}}));
  assert.deepEqual(ok.errors, []);
  assert.ok(!ok.warnings.some(w => /world is not a story/.test(w)));
  const bad = validateStory(story([{id: 'h', module: 'hook-title', start: 0, end: 3, params: {kind: 'x', title: 'Hi'}}]));
  assert.ok(bad.errors.some(e => /params\.kind is not allowed/.test(e)));
  assert.ok(validateStory(story([scene()], {world: {kind: 'park', mood: 'x'}})).errors.some(e => /world\.mood is not a world field/.test(e)));
  assert.deepEqual(storyWorldErrors({kind: 'park', time: 'dusk', props: ['bench']}), []);
  assert.ok(storyWorldErrors({kind: 'moon'})[0].includes('world.kind must be one of'));
});

test('the camera move: layers travel at the world camera depths, inside the overscan', () => {
  const model = resolve({camera: {move: 'pan-right', amount: 1}});
  const {states, overscan} = model.content;
  const travel = layer => Math.abs(states[layer].to.x - states[layer].from.x);
  assert.ok(travel('back') < travel('mid') && travel('mid') < travel('front'));
  assert.ok(Math.abs(travel('back') / travel('front') - WORLD_DEPTH.back) < 0.01);
  assert.ok(travel('front') <= overscan, 'a pan never shows the layer edge');
  assert.ok(states.front.to.x < states.front.from.x, 'panning right slides the world left');
  const push = resolve({camera: 'push'}).content.states;
  assert.ok(push.front.to.scale > push.back.to.scale && push.back.to.scale > 1);
  const still = worldTimeline(resolve({camera: 'still'}));
  assert.ok(!still.some(op => op.type === 'tween' && op.target === 'w-front'));
});

test('the op list renders the same through GSAP as through frameState', () => {
  const model = resolve({camera: {move: 'push', amount: 0.8}}, {format: {width: 1920, height: 1080, fps: 30, duration: 8}});
  const later = resolveModule({...scene({camera: 'pan-left'}), start: 1, end: 7}, story([scene()], {format: {width: 1920, height: 1080, fps: 30, duration: 8}}));
  for (const m of [model, later]) {
    const ops = worldTimeline(m);
    const {motion, html} = EMITTERS.world(m);
    assert.match(html, new RegExp(`id="${m.id}-front"`));
    assert.doesNotMatch(motion, /onUpdate|Math\.random|Date/);
    const targets = new Map();
    const real = gsap.timeline({paused: true});
    const target = selector => { if (!targets.has(selector)) targets.set(selector, {}); return targets.get(selector); };
    runInNewContext(motion, {tl: {set: (s, v, p) => real.set(target(s), v, p), fromTo: (s, f, t, p) => real.fromTo(target(s), f, t, p)}});
    for (const t of [0.05, 0.5, 1.2, 2.5, 3.3, 5.1, 5.9]) {
      real.seek(t, false);
      for (const [id, props] of frameState(ops, t)) {
        const object = targets.get(`#${id}`);
        for (const [key, value] of Object.entries(props)) {
          if (object?.[key] === undefined) continue;
          assert.ok(Math.abs(object[key] - value) < 1e-3, `${id}.${key} at ${t}: gsap ${object[key]} vs frameState ${value}`);
        }
      }
    }
  }
  assert.equal(frameState(worldTimeline(model), 0).get('w').opacity, 1, 'a world on frame 0 is shown on frame 0');
});
