// Catalogue G (kit/core/catalog-g.mjs): the visual vocabulary cards.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {MODULES, catalogGTimeline, catalogGView} from '../kit/core/catalog-g.mjs';
import {OBJECTS} from '../kit/core/catalog-g-cards.mjs';
import {frameState} from '../kit/core/catalog-b-view.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-g.mjs';
import {knownModules, resolveModule} from '../kit/core/modules.mjs';
import {isIcon} from '../kit/core/icons.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const PORTRAIT = {width: 1080, height: 1920, fps: 30, duration: 30};
const LANDSCAPE = {width: 1920, height: 1080, fps: 30, duration: 30};
const ctx = (overrides = {}) => ({id: 'scene', start: 1, duration: 4, format: PORTRAIT, brand, aspect: '9:16', hits: [], ...overrides});
const resolve = (id, params, overrides) => ({...MODULES[id].resolve(params, ctx(overrides)), module: id});
const inside = (inner, outer) => inner.x >= outer.x - 0.01 && inner.y >= outer.y - 0.01 && inner.x + inner.width <= outer.x + outer.width + 0.01 && inner.y + inner.height <= outer.y + outer.height + 0.01;
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const SAMPLES = {
  'concept-card': {text: 'Ship faster', icon: 'rocket', sub: 'From recording to Short'},
  'icon-row': {title: 'Three steps', items: [{icon: 'mic', label: 'Record'}, {icon: 'scissors', label: 'Cut'}, {icon: 'send', label: 'Post'}]},
  'section-card': {title: 'How it works', kicker: 'Part two', number: 2},
  'object-card': {object: 'box', caption: 'It ships as one file', label: 'Export'}
};
const IDS = Object.keys(SAMPLES);

test('catalogue G is registered in the module registry, HyperFrames and Remotion', () => {
  for (const id of IDS) assert.ok(knownModules().includes(id), id);
  for (const id of IDS) assert.equal(typeof EMITTERS[id], 'function', id);
  const registry = readFileSync(fileURLToPath(new URL('../kit/remotion/catalog/registry-g.ts', import.meta.url)), 'utf8');
  for (const id of IDS) assert.match(registry, new RegExp(`'${id}': \\w+`));
  for (const id of IDS) {
    assert.deepEqual(MODULES[id].aspects, ['9:16', '16:9']);
    assert.ok(MODULES[id].mood.length && MODULES[id].describe && MODULES[id].events.length && MODULES[id].timing.minDuration, id);
  }
});

test('on a plate every module fills the safe zone above the caption band, with legible text', () => {
  for (const format of [PORTRAIT, LANDSCAPE]) for (const id of IDS) {
    const model = resolve(id, SAMPLES[id], {format, aspect: format === PORTRAIT ? '9:16' : '16:9', lane: 'motion'});
    assert.equal(model.placement, 'plate', id);
    assert.equal(model.surface, 'plate', id);
    assert.deepEqual(model.rect, model.safe, `${id} keeps the safe rect`);
    assert.ok(model.minTextPx >= 44, `${id} key text ${model.minTextPx}`);
    assert.ok(model.content.layout.height <= model.rect.height, `${id} fits`);
  }
  // A footage-led insert is a plate too.
  assert.equal(resolve('concept-card', SAMPLES['concept-card'], {lane: 'footage-led', insert: true}).placement, 'plate');
});

test('over footage, a card sits clear of the presenter\'s head and above the captions', () => {
  const head = {x: 430, y: 420, width: 220, height: 280};
  for (const id of IDS) {
    const model = resolve(id, SAMPLES[id], {lane: 'footage-led', subject: {available: true, head, placement: 'measured'}});
    assert.equal(model.surface, 'card', id);
    assert.equal(model.placement, 'below', id);
    assert.ok(!overlaps(model.rect, head), `${id} misses the head`);
    assert.ok(inside(model.rect, model.safe), `${id} inside the safe zone`);
    assert.ok(model.minTextPx >= 44, id);
  }
  // Landscape: beside the head.
  const wide = resolve('icon-row', SAMPLES['icon-row'], {format: LANDSCAPE, aspect: '16:9', lane: 'footage-led'});
  assert.ok(['left', 'right'].includes(wide.placement));
  // No room anywhere: it says so instead of covering the face.
  const close = {x: 140, y: 300, width: 800, height: 900};
  assert.throws(() => resolve('section-card', SAMPLES['section-card'], {lane: 'footage-led', subject: {available: true, head: close, placement: 'measured'}}), /beside the presenter.*insert/);
  // An explicit rect (a layout panel) wins.
  const rect = {x: 440, y: 400, width: 500, height: 700};
  assert.deepEqual(resolve('concept-card', {...SAMPLES['concept-card'], rect, surface: 'card'}, {lane: 'footage-led'}).rect, rect);
});

test('concept-card: icon, then word, then sub-line, all visible by the hold', () => {
  const model = resolve('concept-card', SAMPLES['concept-card']);
  assert.deepEqual(model.events.map(e => e.name).filter(name => name !== 'enter'), ['icon', 'word', 'sub']);
  const ops = catalogGTimeline(model);
  const hold = frameState(ops, model.motion.exitStart - 0.05);
  for (const part of ['icon', 'word', 'sub']) assert.equal(hold.get(`scene-${part}`).opacity, 1, part);
  assert.equal(frameState(ops, 1.2).get('scene-sub').opacity, 0, 'the sub-line waits');
  assert.throws(() => resolve('concept-card', {text: 'one two three four'}), /at most three words/);
  assert.throws(() => resolve('concept-card', {text: 'Fast', icon: 'chart'}), /is not an icon.*chart-up/);
  // A word hit times the word.
  assert.equal(resolve('concept-card', {text: 'Fast'}, {hits: [{event: 'word', at: 2.5}]}).content.t0, 2.5);
});

test('icon-row: items pop in order, as a row or a list', () => {
  const model = resolve('icon-row', SAMPLES['icon-row']);
  assert.equal(model.content.layout.mode, 'row');
  const times = model.content.items.map(item => item.time);
  assert.ok(times.every((t, i) => i === 0 || t > times[i - 1]));
  const ops = catalogGTimeline(model);
  assert.equal(frameState(ops, times[1] - 0.01).get('scene-item-1').opacity, 0);
  assert.equal(frameState(ops, times[2] + 0.6).get('scene-item-2').scaleX, 1);
  const long = resolve('icon-row', {items: [{icon: 'users', label: 'Small teams shipping weekly'.slice(0, 24)}, {icon: 'building', label: 'Agencies with many clients'.slice(0, 24)}, {icon: 'user', label: 'Solo founders'}, {icon: 'code', label: 'Open-source maintainers'}, {icon: 'heart', label: 'Creators'}]});
  assert.equal(long.content.layout.mode, 'list', 'long labels fall back to a list');
  assert.throws(() => resolve('icon-row', {items: [{icon: 'mic', label: 'One'}]}), /params\.items/);
  assert.throws(() => resolve('icon-row', {items: [{icon: 'nope', label: 'A'}, {icon: 'mic', label: 'B'}]}), /is not an icon/);
});

test('section-card: the rule draws out with the kicker before the title', () => {
  const model = resolve('section-card', SAMPLES['section-card']);
  assert.equal(model.content.number, '02');
  assert.equal(model.content.kicker, 'PART TWO');
  const ops = catalogGTimeline(model);
  assert.equal(frameState(ops, 1).get('scene-rule').scaleX, 0);
  assert.equal(frameState(ops, model.content.kickAt + 0.6).get('scene-rule').scaleX, 1);
  assert.ok(model.content.kickAt < model.content.t0);
  assert.throws(() => resolve('section-card', {title: 'X', number: 2, icon: 'rocket'}), /pick one/);
});

test('object-card: every object is composed from real icons and brand shapes', () => {
  for (const [name, object] of Object.entries(OBJECTS)) {
    assert.ok(isIcon(object.hero.icon), `${name} hero`);
    for (const accent of object.accents) assert.ok(isIcon(accent.icon), `${name} accent ${accent.icon}`);
    const model = resolve('object-card', {object: name, caption: 'A caption'});
    const view = catalogGView(model);
    assert.ok(JSON.stringify(view).includes('"tag":"path"'), name);
  }
  const model = resolve('object-card', SAMPLES['object-card']);
  const ops = catalogGTimeline(model);
  const hold = frameState(ops, model.motion.exitStart - 0.05);
  for (const part of ['stage', 'hero', 'text', 'accent-0']) assert.equal(hold.get(`scene-${part}`).opacity, 1, part);
  assert.throws(() => resolve('object-card', {object: 'spaceship', caption: 'x'}), /must be one of/);
});

test('the HyperFrames emitter and the view share ids and tint icons from the brand', () => {
  for (const id of IDS) {
    const model = resolve(id, SAMPLES[id]);
    const out = EMITTERS[id]({...model, track: 3});
    assert.match(out.html, new RegExp(`^<div id="scene" class="clip lc-catalog-g" data-start="1"`));
    if (id !== 'section-card') assert.match(out.html, /stroke="#fdb022"/, `${id} tints icons primary`);
    assert.match(out.motion, /tl\.fromTo\("#scene"/);
  }
});

test('resolveModule passes the insert flag and the lane through', () => {
  const story = {lane: 'footage-led', format: PORTRAIT, brand, base: {src: 'assets/recording.mp4'}, scenes: []};
  const scene = {id: 'c', module: 'concept-card', start: 1, end: 4, params: SAMPLES['concept-card']};
  const story2 = {...story, scenes: [scene, {...scene, id: 'i', insert: true}]};
  assert.equal(resolveModule(story2.scenes[0], story2).surface, 'card');
  assert.equal(resolveModule(story2.scenes[1], story2).surface, 'plate');
});

test('the phrase table suggests each card for its intent', async () => {
  const {PHRASE_MODULE_TABLE, suggestModules} = await import('../kit/core/planning-prompt.mjs');
  const lines = {
    'concept-card': 'The problem is editing takes too long.',
    'icon-row': 'You get your repo, your clips and your brand.',
    'section-card': 'Part two: how it works.',
    'object-card': 'It ships in a box.'
  };
  for (const [id, sentence] of Object.entries(lines)) {
    for (const lane of ['motion', 'footage-led']) assert.ok(suggestModules(sentence, {lane})[0]?.modules.includes(id), `${id} in ${lane}`);
    if (id !== 'section-card') assert.ok(PHRASE_MODULE_TABLE.find(row => row.module === id).intents.length, `${id} names its intents`);
  }
  // Row intents are the direction map's intents (section-card is picked at section starts, not by intent).
  const {DIRECTION_INTENTS} = await import('../kit/core/direction.mjs');
  for (const row of PHRASE_MODULE_TABLE.filter(entry => entry.intents)) for (const intent of row.intents) assert.ok(DIRECTION_INTENTS.includes(intent), `${row.module}: ${intent}`);
});

test('in a footage layout section, a card places inside the layout panel', async () => {
  const story = {schema: 'launchclip.story.v1', lane: 'footage-led', format: {width: 1920, height: 1080, fps: 30, duration: 6}, brand, base: {src: 'assets/recording.mp4'},
    sections: [{id: 'a', start: 0, end: 6, layout: 'split-right'}], scenes: [{id: 'c', module: 'concept-card', track: 1, start: 0.5, end: 4, params: SAMPLES['concept-card']}]};
  const {layoutAt} = await import('../kit/core/footage-layout.mjs');
  const panel = layoutAt(story, 0.5).safe;
  const model = resolveModule(story.scenes[0], story);
  assert.equal(model.placement, 'panel');
  assert.ok(inside(model.rect, panel), 'inside the panel');
});

test('a brand frame narrows where a card may go', () => {
  const story = {schema: 'launchclip.story.v1', lane: 'motion', format: {width: 1080, height: 1920, fps: 30, duration: 6}, brand, frame: {kicker: {label: 'Ledgerly'}, progress: true},
    scenes: [{id: 'c', module: 'concept-card', start: 0.5, end: 4, params: SAMPLES['concept-card']}]};
  const model = resolveModule(story.scenes[0], story);
  assert.ok(model.frame?.safe, 'the story has a frame');
  assert.ok(inside(model.rect, model.frame.safe), 'the card stays inside the frame safe area');
});

test('in a panel or rect, a list fills the room and its title reads at 4.5:1', async () => {
  const {contrastRatio} = await import('../kit/core/catalog-b-base.mjs');
  const rect = {x: 96, y: 132, width: 898, height: 689};
  const items = [{icon: 'code', label: 'Code templates'}, {icon: 'play-circle', label: 'Live builds'}, {icon: 'users', label: 'Direct help'}];
  const model = resolve('icon-row', {title: 'You get', layout: 'list', items, rect}, {format: LANDSCAPE, aspect: '16:9'});
  const L = model.content.layout;
  assert.ok(L.height >= rect.height * 0.75, `fills ${L.height} of ${rect.height}`);
  assert.ok(L.height <= rect.height, 'still fits');
  assert.ok(L.gap <= L.rowH * 0.6 + 0.01, 'gaps stay capped');
  assert.ok(model.minTextPx >= 44, 'legible');
  assert.ok(contrastRatio(model.content.titleColor, brand.colors.bg) >= 4.5, 'title contrast');
  assert.notEqual(model.content.titleColor, model.theme.muted);
});
