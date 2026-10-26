// Character modules (kit/core/catalog-characters.mjs): cast-scene and
// character-cameo, in the registry and both renderers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import gsap from 'gsap';
import {MODULES, charactersTimeline, charactersView} from '../kit/core/catalog-characters.mjs';
import {frameState} from '../kit/core/catalog-b-view.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-characters.mjs';
import {knownModules, resolveModule} from '../kit/core/modules.mjs';
import {resolveStory, validateStory} from '../kit/core/story.mjs';
import {castConsistency, storyCastErrors} from '../kit/core/characters/cues.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const story = (scenes, extra = {}) => ({schema: 'launchclip.story.v1', lane: 'motion', format: {width: 1920, height: 1080, fps: 30, duration: 8}, brand, cast: {characters: [{id: 'maya'}, {id: 'theo'}]}, scenes, ...extra});
const desk = (params = {}) => ({id: 'desk', module: 'cast-scene', start: 0, end: 6, params: {set: 'desk-laptop', cast: [
  {id: 'maya', pose: 'type', expression: 'focused', cues: [{at: 2, pose: 'slump', expression: 'frustrated'}, {at: 4, pose: 'cheer', expression: 'delighted'}], says: [{from: 0.5, to: 1.5}]},
  {id: 'theo', cues: [{at: 3, pose: 'point', expression: 'happy'}]}], ...params}});
const resolve = (scene, extra) => { const s = story([scene], extra); return resolveModule(scene, s); };

test('character modules are registered in the module registry, HyperFrames and Remotion', () => {
  const ids = ['cast-scene', 'character-cameo'];
  for (const id of ids) assert.ok(knownModules().includes(id), id);
  assert.deepEqual(Object.keys(EMITTERS).sort(), ids);
  const registry = readFileSync(fileURLToPath(new URL('../kit/remotion/catalog/registry-characters.ts', import.meta.url)), 'utf8');
  for (const id of ids) assert.match(registry, new RegExp(`'${id}': \\w+`));
  assert.match(readFileSync(fileURLToPath(new URL('../kit/remotion/modules/index.ts', import.meta.url)), 'utf8'), /registry-characters/);
  for (const id of ids) assert.ok(MODULES[id].timing.minDuration >= 2 && MODULES[id].describe.length > 20);
});

test('cast-scene: seated set, cues in order, actors carry their cast identity', () => {
  const model = resolve(desk());
  assert.equal(model.content.set, 'desk-laptop');
  assert.equal(model.content.seated, true);
  const [mayaActor, theoActor] = model.content.actors;
  assert.deepEqual(mayaActor.states.map(s => [s.time, s.pose, s.expression]), [[0, 'type', 'focused'], [2, 'slump', 'frustrated'], [4, 'cheer', 'delighted']]);
  assert.equal(theoActor.states[0].pose, 'sit', 'a seated set seats an actor with no pose');
  assert.ok(mayaActor.x < theoActor.x);
  assert.ok(mayaActor.speech.length > 4);
  assert.deepEqual(model.events.filter(e => e.name.includes('cue')).map(e => e.name), ['maya-cue-0', 'theo-cue-0', 'maya-cue-1']);
  assert.deepEqual(castConsistency(story([desk()]), [model]), []);
});

test('cast-scene refuses invented screens, wrong poses for the set and unknown characters', () => {
  assert.throws(() => resolve({...desk(), params: {set: 'screen', cast: [{id: 'maya'}]}}), /params\.screen is required .*never invents a UI/);
  assert.throws(() => resolve(desk({screen: {src: 'assets/app.png'}})), /not used by the desk-laptop set/);
  assert.throws(() => resolve({...desk(), params: {set: 'screen', screen: {src: 'https://example.com/a.png'}, cast: [{id: 'maya'}]}}), /project-local assets/);
  assert.throws(() => resolve(desk({cast: [{id: 'maya', pose: 'walk'}]})), /walk does not fit the seated set/);
  assert.throws(() => resolve({...desk(), params: {set: 'phone', cast: [{id: 'maya', pose: 'sit'}]}}), /sit needs a seated set/);
  assert.throws(() => resolve(desk({cast: [{id: 'kwame'}]})), /"kwame" is not in the story cast/);
  assert.throws(() => resolve(desk({cast: [{id: 'maya'}, {id: 'maya'}]})), /names a character twice/);
  assert.throws(() => resolve(desk({cast: [{id: 'maya', cues: [{at: 'word:again', pose: 'slump'}]}]})), /word anchor that was not resolved/);
  assert.throws(() => resolve(desk({cast: [{id: 'maya', cues: [{at: 5.9, pose: 'slump'}]}]})), /cues\[0\]\.at must be between 0 and 5\.55/);
  assert.throws(() => resolve(desk({cast: [{id: 'maya', cues: [{at: 1, pose: 'slump'}, {at: 1.2, pose: 'think'}]}]})), /closer than 0\.45 s/);
  assert.throws(() => resolve(desk({cast: [{id: 'maya'}, {id: 'theo'}, {id: 'maya'}, {id: 'theo'}]})), /params\.cast must be an array of 1–3/);
});

test('cast-scene with a real capture: the screen media sits between the set and the cast', () => {
  const scene = {id: 'demo', module: 'cast-scene', start: 1, end: 5, params: {set: 'screen', screen: {src: 'assets/demo/sign-in.mp4'}, cast: [{id: 'maya', pose: 'point', expression: 'happy'}]}};
  const model = resolve(scene);
  const view = charactersView(model);
  assert.equal(view.media.tag, 'video');
  assert.equal(view.media.attrs.src, 'assets/demo/sign-in.mp4');
  assert.equal(view.overlay.id, 'demo-overlay');
  const out = EMITTERS['cast-scene'](model);
  assert.match(out.html, /<video id="demo-media"[^>]*data-media-start="0"/);
  assert.match(out.overlay, /id="demo-overlay"/);
  const state = frameState(charactersTimeline(model), 3);
  for (const id of ['demo', 'demo-media', 'demo-overlay']) assert.equal(state.get(id).opacity, 1, `${id} fades in with the scene`);
  assert.equal(model.content.actors[0].facing, 'left', 'the cast faces the screen');
});

test('a character scene on frame 0 is shown on frame 0; a later one fades in', () => {
  const first = resolve(desk());
  assert.equal(frameState(charactersTimeline(first), 0).get('desk').opacity, 1, 'the frame-0 hook is not blank');
  const later = resolve({...desk(), start: 1, end: 7});
  assert.equal(frameState(charactersTimeline(later), 1).get('desk').opacity, 0);
  assert.equal(frameState(charactersTimeline(later), 3).get('desk').opacity, 1);
});

test('the op list renders the same through GSAP as through frameState', () => {
  const model = resolve(desk());
  const ops = charactersTimeline(model);
  const {motion} = EMITTERS['cast-scene'](model);
  assert.doesNotMatch(motion, /onUpdate|Math\.random|Date/);
  const targets = new Map();
  const real = gsap.timeline({paused: true});
  const target = selector => { if (!targets.has(selector)) targets.set(selector, {}); return targets.get(selector); };
  runInNewContext(motion, {tl: {set: (s, v, p) => real.set(target(s), v, p), fromTo: (s, f, t, p) => real.fromTo(target(s), f, t, p)}});
  for (const t of [0.3, 1.1, 2.2, 2.31, 3.05, 4.2, 5.0, 1.7, 0.05]) {
    real.seek(t, false);
    for (const [id, props] of frameState(ops, t)) {
      const object = targets.get(`#${id}`);
      for (const [key, value] of Object.entries(props)) {
        if (object?.[key] === undefined) continue;
        assert.ok(Math.abs(object[key] - value) < 1e-3, `${id}.${key} at ${t}: gsap ${object[key]} vs frameState ${value}`);
      }
    }
  }
});

test('character-cameo: a card beside one character; sit is refused', () => {
  const scene = {id: 'cameo', module: 'character-cameo', start: 0, end: 4, params: {character: 'kwame', pose: 'wave', expression: 'happy', card: {kicker: 'Step two', title: 'Connect your repo'}}};
  const model = resolveModule(scene, {...story([scene]), cast: undefined, format: {width: 1080, height: 1920, fps: 30, duration: 4}});
  assert.equal(model.content.actors[0].id, 'kwame');
  assert.ok(model.content.cardBox.titleSize >= 44);
  assert.equal(model.content.panel, null, 'no panel behind a character with a card');
  assert.match(EMITTERS['character-cameo'](model).html, /Connect your repo/);
  assert.throws(() => resolveModule({...scene, params: {character: 'kwame', pose: 'sit'}}, {...story([scene]), cast: undefined}), /sit needs a seated set/);
  assert.throws(() => resolveModule({...scene, params: {character: 'nobody'}}, {...story([scene]), cast: undefined}), /params\.character "nobody" is not a starter/);
});

test('character-cameo: keeps inside the brand frame safe area, and takes a rect (guided and bespoke tiers)', async () => {
  const {brandFrameSafe} = await import('../kit/core/brand-frame.mjs');
  const {planningPrompt} = await import('../kit/core/planning-prompt.mjs');
  const scene = {id: 'cameo', module: 'character-cameo', start: 0, end: 4, params: {character: 'maya', pose: 'shrug', card: {kicker: 'Take 1', title: 'Heard as blame'}}};
  const portrait = {format: {width: 1080, height: 1920, fps: 30, duration: 4}};
  const plain = story([scene], portrait);
  const framed = story([scene], {...portrait, title: 'Same couple', frame: {kicker: {label: 'Same couple'}, labels: [{scene: 'cameo', label: 'Take 1'}]}});
  const safe = brandFrameSafe(framed);
  // Without a frame the cameo starts at the profile safe zone's top, where a kicker would sit.
  assert.ok(resolveModule(scene, plain).rect.y < safe.y);
  const model = resolveModule(scene, framed);
  assert.ok(model.rect.y >= safe.y && model.rect.y + model.rect.height <= safe.y + safe.height + 1e-6, JSON.stringify(model.rect));
  assert.ok(model.content.cardBox.y >= safe.y, 'the card clears the kicker');
  // params.rect places it, inside the frame's safe area.
  const rect = {x: 120, y: 420, width: 820, height: 700};
  const placed = resolveModule({...scene, params: {...scene.params, rect}}, framed);
  assert.deepEqual(placed.rect, rect);
  assert.ok(placed.content.cardBox.y >= rect.y && placed.content.actors[0].floor <= rect.y + rect.height);
  assert.throws(() => resolveModule({...scene, params: {...scene.params, rect: {...rect, y: 300}}}, framed), /params\.rect\.y/);
  // The registry lists rect, so the guided and bespoke planners may set it; the structured tier may not.
  assert.ok('rect' in MODULES['character-cameo'].params);
  const line = (tier) => planningPrompt({tier, lane: 'motion', format: portrait.format, brand}).split('\n').find((text) => /^- rect: .*brand frame/.test(text));
  assert.match(line('guided'), /guided and bespoke tiers only/);
  assert.equal(line('structured'), undefined);
});

test('story: cast is a story field; word anchors in cues and lines resolve to scene seconds', () => {
  const scene = {id: 'desk', module: 'cast-scene', start: 'word:Every', end: 6, params: {set: 'desk-laptop', cast: [
    {id: 'maya', pose: 'type', cues: [{at: 'word:again', pose: 'slump', expression: 'frustrated'}], says: [{from: 'word:It', to: 'word:again'}]}]}};
  const s = story([scene]);
  const result = validateStory(s);
  assert.ok(!result.warnings.some(w => /cast is not a story/.test(w)), 'cast is a known story field');
  const words = ['Every', 'morning', 'It', 'broke', 'again'].map((text, i) => ({text, start: 0.5 + i * 0.5, end: 0.9 + i * 0.5}));
  const resolved = resolveStory(s, {words});
  const actor = resolved.scenes[0].params.cast[0];
  assert.equal(actor.cues[0].at, 2, '"again" starts 2 s after the scene start');
  assert.deepEqual(actor.says[0], {from: 1, to: 2.4, words: [[1, 1.4], [1.5, 1.9], [2, 2.4]]});
  const model = resolveModule(resolved.scenes[0], resolved);
  assert.equal(model.content.actors[0].states[1].time, 2.5);
});

const phone = (cast, extra = {}) => ({id: 'talk', module: 'cast-scene', start: 0, end: 4, params: {set: 'phone', cast}, ...extra});
const sides = model => Object.fromEntries(model.content.actors.map(actor => [actor.id, [actor.position, actor.facing]]));

test('cast-scene placement: position wins over list order, then the story cast position; facing defaults inward', () => {
  // List order alone: first on the left, both facing inward.
  assert.deepEqual(sides(resolve(phone([{id: 'maya'}, {id: 'theo'}]))), {maya: ['left', 'right'], theo: ['right', 'left']});
  // An explicit position puts the first-listed character on the right, still facing inward.
  assert.deepEqual(sides(resolve(phone([{id: 'maya', position: 'right'}, {id: 'theo'}]))), {maya: ['right', 'left'], theo: ['left', 'right']});
  // A story cast position keeps a character's side whatever the list order.
  const placed = {cast: {characters: [{id: 'maya', position: 'right'}, {id: 'theo', position: 'left'}]}};
  assert.deepEqual(sides(resolve(phone([{id: 'maya'}, {id: 'theo'}]), placed)), {maya: ['right', 'left'], theo: ['left', 'right']});
  assert.deepEqual(sides(resolve(phone([{id: 'theo'}, {id: 'maya'}]), placed)), {maya: ['right', 'left'], theo: ['left', 'right']});
  // A scene position beats the story cast's; three characters take centre; "center" is accepted.
  assert.deepEqual(sides(resolve(phone([{id: 'maya', position: 'left'}, {id: 'theo'}]), placed)), {maya: ['left', 'right'], theo: ['right', 'left']});
  const trio = resolve(phone([{id: 'maya', position: 'center'}, {id: 'theo'}, {id: 'kwame'}]), {cast: {characters: [{id: 'maya'}, {id: 'theo'}, {id: 'kwame'}]}});
  assert.deepEqual(trio.content.actors.map(actor => actor.position), ['centre', 'left', 'right']);
  assert.throws(() => resolve(phone([{id: 'maya', position: 'centre'}, {id: 'theo'}])), /does not fit 2 characters \(positions: left, right\)/);
  assert.throws(() => resolve(phone([{id: 'maya', position: 'left'}, {id: 'theo', position: 'left'}])), /left is already taken by params.cast\[0\]/);
  assert.match(storyCastErrors({characters: [{id: 'maya', position: 'middle'}]}).join(), /position must be left, centre or right/);
});

test('an actor reaches as far as its widest pose: a point runs toward its facing side', () => {
  const [maya, theo] = resolve(phone([{id: 'maya', pose: 'stand', cues: [{at: 1, pose: 'point'}]}, {id: 'theo'}])).content.actors;
  const standing = resolve(phone([{id: 'maya'}, {id: 'theo'}])).content.actors[0];
  assert.ok(maya.reach.right > standing.reach.right + 150, 'the pointing arm reaches right, toward theo');
  assert.ok(Math.abs(maya.reach.left - standing.reach.left) < 2, 'the other side barely moves (the point leans in)');
  assert.ok(maya.reach.top > 0 && maya.reach.bottom <= 1080);
  assert.ok(theo.reach.left > maya.x);
});

test('HyperFrames: GSAP owns the rig transforms (no CSS transform for it to overwrite), set to the same values first', async () => {
  const {gsapOwnedTransforms, transformProps} = await import('../kit/hyperframes/catalog-characters.mjs');
  const model = resolve(desk());
  const ops = charactersTimeline(model);
  const owned = gsapOwnedTransforms(charactersView(model), ops, model.start);
  const {html, motion} = EMITTERS['cast-scene'](model);
  const moved = new Set(ops.filter(op => ['x', 'y', 'rotation', 'scale', 'scaleX', 'scaleY'].some(key => key in (op.props ?? {...op.from, ...op.to}))).map(op => op.target));
  assert.ok(moved.has('desk-c0-arm-l') && moved.has('desk-c0-body'));
  for (const id of moved) {
    const tag = html.match(new RegExp(`<div id="${id}"[^>]*>`))?.[0];
    if (tag) assert.doesNotMatch(tag, /transform:/, id);
  }
  // Each taken-off transform is written at the scene start, by the scene's own set or a leading one.
  const css = new Map();
  const walk = node => { if (node?.style?.transform && moved.has(node.id)) css.set(node.id, node.style.transform); (node?.children ?? []).forEach(walk); };
  Object.values(charactersView(model)).forEach(walk);
  assert.ok(css.size > 10);
  for (const [id, transform] of css) {
    for (const [key, value] of Object.entries(transformProps(transform))) {
      if (value === (key.startsWith('scale') ? 1 : 0)) continue;
      assert.ok(owned.ops.some(op => op.type === 'set' && op.target === id && op.time === model.start && op.props[key] === value), `${id} ${key}`);
    }
  }
  assert.match(motion, /tl\.set\("#desk-c0-body", \{"y":140\}, 0\);/, "the seated body, as its CSS had it");
  assert.deepEqual(transformProps('translate(4px, -2.5px) rotate(12deg) scale(1, 0.96)'), {x: 4, y: -2.5, rotation: 12, scaleX: 1, scaleY: 0.96});
  assert.deepEqual(transformProps('scale(0.6)'), {x: 0, y: 0, rotation: 0, scaleX: 0.6, scaleY: 0.6});
  assert.throws(() => transformProps('skewX(4deg)'), /unsupported transform/);
});

test('cast-scene and character-cameo take the light of the world they play over', async () => {
  const {normalizeLight, DEFAULT_LIGHT} = await import('../kit/core/characters/light.mjs');
  const {worldLight} = await import('../kit/core/worlds/index.mjs');
  const world = {id: 'street', module: 'world', start: 0, end: 6, params: {kind: 'city-street', time: 'night'}};
  const over = {...desk(), track: 1};
  const s = story([world, over]);
  const lit = resolveModule(over, s).content.actors[0].light;
  assert.deepEqual(lit, normalizeLight(worldLight('city-street', 'night')));
  assert.notEqual(lit.dir, DEFAULT_LIGHT.dir);
  // The world's time comes from story.world when the world scene leaves it out.
  const dusk = story([{...world, params: {kind: 'park'}}, over], {world: {kind: 'office', time: 'dusk'}});
  assert.deepEqual(resolveModule(over, dusk).content.actors[0].light, normalizeLight(worldLight('park', 'dusk')));
  // params.light wins; without a world beneath (same track, or none) the default key stays.
  assert.equal(resolveModule({...over, params: {...over.params, light: {dir: 10}}}, s).content.actors[0].light.dir, 10);
  assert.equal(resolve(desk()).content.actors[0].light.dir, DEFAULT_LIGHT.dir);
  const cameo = {id: 'cameo', module: 'character-cameo', track: 1, start: 1, end: 5, params: {character: 'maya'}};
  assert.deepEqual(resolveModule(cameo, story([world, cameo])).content.actors[0].light, lit);
});

test('characters in a world take half its time-of-day grade; outside one they keep their colours', async () => {
  const {worldGrade} = await import('../kit/core/worlds/index.mjs');
  const world = {id: 'street', module: 'world', start: 0, end: 6, params: {kind: 'city-street', time: 'night'}};
  const over = {...desk(), track: 1};
  const plain = resolve(desk()).content.actors[0].colors;
  const night = resolveModule(over, story([world, over])).content.actors[0].colors;
  const g = worldGrade('city-street', 'night', 0.5);
  for (const key of Object.keys(plain)) assert.equal(night[key], g(plain[key]), key);
  assert.notEqual(night.top, plain.top);
  // Day barely moves them.
  const day = resolveModule(over, story([{...world, params: {kind: 'city-street', time: 'day'}}, over])).content.actors[0].colors;
  assert.ok(Math.abs(parseInt(day.top.slice(1, 3), 16) - parseInt(plain.top.slice(1, 3), 16)) < 12);
});

test('params.world names the world a cast stands in, without a world scene beneath', async () => {
  const {normalizeLight} = await import('../kit/core/characters/light.mjs');
  const {worldLight} = await import('../kit/core/worlds/index.mjs');
  const actor = resolve(desk({world: {kind: 'alley', time: 'dusk'}})).content.actors[0];
  assert.deepEqual(actor.light, normalizeLight(worldLight('alley', 'dusk')));
  assert.notDeepEqual(actor.colors, resolve(desk()).content.actors[0].colors);
  assert.throws(() => resolve(desk({world: {kind: 'moon'}})), /params\.world\.kind/);
});

test('cast references: "@1" and "@2" name the story cast by place', async () => {
  const s = story([{id: 'desk', module: 'cast-scene', start: 0, end: 6, params: {set: 'desk-laptop', cast: [{id: '@2', pose: 'type', says: 'auto'}, {id: '@1'}]}},
    {id: 'cameo', module: 'character-cameo', start: 6, end: 8, params: {character: '@1'}}]);
  const resolved = resolveStory(s);
  assert.deepEqual(resolved.scenes[0].params.cast.map(entry => entry.id), ['theo', 'maya']);
  assert.equal(resolved.scenes[1].params.character, 'maya');
  assert.deepEqual(resolveModule(resolved.scenes[0], resolved).content.actors.map(actor => actor.id), ['theo', 'maya']);
  // A place the cast does not have stays as written, and the module says why.
  const missing = resolveStory(story([{id: 'desk', module: 'cast-scene', start: 0, end: 6, params: {set: 'phone', cast: [{id: '@3'}]}}]));
  assert.equal(missing.scenes[0].params.cast[0].id, '@3');
  assert.throws(() => resolveModule(missing.scenes[0], missing), /"@3" refers to character 3 of the story cast, which has 2 characters \(maya, theo\)/);
});

test('a seeded style tells the planner its cast ids, their places and its world', async () => {
  const {generateStyle} = await import('../kit/core/style-seed.mjs');
  const {stylePromptLines} = await import('../kit/core/style.mjs');
  const pack = generateStyle({seed: '00000001'});
  const lines = stylePromptLines({name: 'seed-00000001', ...pack}).join('\n');
  for (const [i, member] of pack.cast.members.entries()) assert.match(lines, new RegExp(`"${member.id}"[^,]*= "@${i + 1}"`));
  assert.match(lines, new RegExp(`World: ${pack.world.kind}`));
});

test('a set stands in a world with its furniture alone (backdrop world); its room only on backdrop room', async () => {
  const {layoutSet, WORLD_SETS} = await import('../kit/core/characters/sets.mjs');
  const {worldAnchors} = await import('../kit/core/worlds/index.mjs');
  const opts = {canvas: {width: 1920, height: 1080}, colors: brand.colors, count: 2, heights: [1000, 1000]};
  const room = layoutSet('desk-laptop', opts);
  const bare = layoutSet('desk-laptop', {...opts, backdrop: 'world', floor: 900, grade: hex => hex === '#c99a6b' ? '#123456' : hex});
  const fills = nodes => JSON.stringify(nodes);
  // The room's full-canvas wall is gone; the plant (furniture) and the desk stay.
  assert.match(fills(room.back), /"width":1920,"height":1080/);
  assert.doesNotMatch(fills(bare.back), /"width":1920,"height":1080/);
  assert.ok(bare.back.length > 0 && bare.front.length === room.front.length);
  assert.equal(bare.floor, 900);
  assert.match(fills(bare.front), /#123456/);
  assert.ok(!WORLD_SETS.includes('video-call'));
  assert.throws(() => layoutSet('video-call', {...opts, backdrop: 'world'}), /no furniture-only form/);

  // cast-scene: the default backdrop follows the world.
  const world = {id: 'street', module: 'world', start: 0, end: 6, params: {kind: 'city-street', time: 'dusk'}};
  const over = {...desk(), track: 1};
  const onPlate = resolveModule(over, story([world, over])).content;
  assert.equal(onPlate.backdrop, 'world');
  assert.equal(onPlate.drawWorld, null);
  assert.equal(onPlate.actors[0].floor, worldAnchors('city-street').ground.y);
  const inStory = resolve(desk(), {world: {kind: 'cafe', time: 'night', props: ['mug']}}).content;
  assert.equal(inStory.backdrop, 'world');
  assert.deepEqual({kind: inStory.drawWorld.kind, time: inStory.drawWorld.time, props: inStory.drawWorld.props}, {kind: 'cafe', time: 'night', props: ['mug']});
  assert.equal(resolve(desk()).content.backdrop, 'room');
  assert.equal(resolve(desk({backdrop: 'room'}), {world: {kind: 'cafe'}}).content.backdrop, 'room');
  assert.throws(() => resolve(desk({backdrop: 'world'})), /needs a world/);
  const call = {id: 'call', module: 'cast-scene', start: 0, end: 4, params: {set: 'video-call', cast: [{id: 'maya'}, {id: 'theo'}]}};
  assert.equal(resolve(call, {world: {kind: 'cafe'}}).content.backdrop, 'room');
  // The view draws the story's world behind the furniture when no world scene is beneath.
  const view = charactersView(resolve(desk(), {world: {kind: 'cafe', time: 'night'}}));
  assert.ok(view.front.children.some(node => node.id === 'desk-world-back'));
  assert.ok(!charactersView(resolveModule(over, story([world, over]))).front.children.some(node => /-world-/.test(node.id ?? '')));
});

test('a world leaves out its front layer when a cast stands in it', async () => {
  const {worldView} = await import('../kit/core/catalog-world.mjs');
  const world = {id: 'street', module: 'world', start: 0, end: 6, params: {kind: 'city-street', time: 'day'}};
  const over = {...desk(), track: 1};
  const front = model => worldView(model).front.children.find(node => node.id === 'street-front').children[0].children.length;
  const alone = resolveModule(world, story([world]));
  const withCast = resolveModule(world, story([world, over]));
  assert.equal(alone.content.foreground, true);
  assert.equal(withCast.content.foreground, false);
  assert.ok(front(alone) > 0);
  assert.equal(front(withCast), 0);
  // A room set, or params.foreground, keeps it.
  assert.equal(resolveModule(world, story([world, {...over, params: {...over.params, backdrop: 'room'}}])).content.foreground, true);
  assert.equal(resolveModule({...world, params: {...world.params, foreground: true}}, story([world, over])).content.foreground, true);
});
