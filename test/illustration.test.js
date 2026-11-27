// illustration (kit/core/illustration.mjs, docs/EXPLAINER_CLAIMS_RFC.md §3.2):
// the closed vocabulary, the icon fallback, the stage's share of the safe
// area, the change landing on its word with no still hold, and the density
// gate counting it as filled.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MODULES, catalogHTimeline, catalogHView} from '@launchclip/core/catalog-h.mjs';
import {frameState} from '@launchclip/core/catalog-b-view.mjs';
import {sceneMotionFindings} from '@launchclip/core/motion-check.mjs';
import {CHANGES, SEEN_SHARE} from '@launchclip/core/illustration.mjs';
import {durationErrors} from '../src/duration_fit.js';
import {EXTRA_SAMPLES, SAMPLES} from '../scripts/element-samples.mjs';
import {elementFixtures} from '../scripts/element-parity.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const FORMATS = {portrait: {width: 1080, height: 1920, fps: 30}, landscape: {width: 1920, height: 1080, fps: 30}};
const resolve = (params, shape = 'portrait', overrides = {}) => ({...MODULES.illustration.resolve(params, {id: 'scene', start: 1, duration: 5, format: FORMATS[shape], brand, aspect: shape === 'portrait' ? '9:16' : '16:9', hits: [], ...overrides}), module: 'illustration'});
const SAMPLE_LIST = [{name: 'wear', shape: 'portrait', params: SAMPLES.illustration}, {name: 'wear', shape: 'landscape', params: SAMPLES.illustration}, ...EXTRA_SAMPLES.filter(e => e.module === 'illustration')];

test('illustration: the change list is closed and every kind has a sample and a parity fixture', () => {
  assert.deepEqual([...new Set(SAMPLE_LIST.map(s => s.params.change))].sort(), [...CHANGES].sort());
  const names = elementFixtures(['illustration']).map(f => f.name);
  for (const change of CHANGES) assert.ok(names.some(n => n === (change === 'wear' ? 'h-illustration-default-portrait' : `h-illustration-${change}`)), change);
  assert.throws(() => resolve({subject: {object: 'clock'}, change: 'explode'}), /params\.change must be one of wear, measure, count, compare, cause, before-after/);
  assert.throws(() => resolve({subject: {object: 'clock'}, change: 'wear', plate: 'marble'}), /params\.plate/);
  assert.throws(() => resolve({subject: {object: 'clock'}, change: 'wear', count: 3}), /params\.count belongs to count, not wear/);
  assert.throws(() => resolve({subject: {object: 'clock'}, change: 'compare'}), /params\.second is required/);
  assert.throws(() => resolve({subject: {object: 'clock'}, change: 'cause', force: 'wind'}), /params\.force/);
  assert.throws(() => resolve({subject: {object: 'clock'}, change: 'wear', colour: 'red'}), /colour/);
});

test('illustration: a drawn object draws in detail, a prop as the prop, an icon as the icon, and an object the kit lacks as its fallback icon', () => {
  assert.deepEqual(resolve(SAMPLES.illustration).content.subject, {object: 'deck', drawn: 'deck', prop: null, icon: null, label: null});
  assert.equal(resolve({subject: {object: 'bench'}, change: 'wear'}).content.subject.prop, 'bench');
  assert.equal(resolve({subject: {object: 'stethoscope'}, change: 'wear'}).content.subject.icon, 'stethoscope');
  const pergola = resolve({subject: {object: 'pergola', icon: 'fence'}, change: 'wear'});
  assert.deepEqual([pergola.content.subject.drawn, pergola.content.subject.prop, pergola.content.subject.icon], [null, null, 'fence']);
  assert.ok(JSON.stringify(catalogHView(pergola)).includes('"tag":"svg"'), 'the icon is drawn, never a placeholder');
  assert.throws(() => resolve({subject: {object: 'pergola'}, change: 'wear'}), /"pergola" is not a drawn object \(deck, calendar, clock\), a world-kit prop .* or an icon.*give icon/);
  assert.throws(() => resolve({subject: {object: 'pergola', icon: 'decking'}, change: 'wear'}), /params\.subject\.icon must be an icon name/);
  assert.throws(() => resolve({subject: {object: 'clock', label: 'Clock'}, change: 'wear'}), /only drawn on a compare/);
  // A calendar counts on its own grid; a clock measures on its own face.
  const cal = resolve(EXTRA_SAMPLES.find(e => e.name === 'illustration-count').params);
  const ids = JSON.stringify(catalogHView(cal));
  assert.ok(ids.includes('scene-calendar-day-13') && ids.includes('scene-calendar-cross-13') && !ids.includes('scene-calendar-day-14'));
  assert.equal(cal.content.geo.tray, null);
  const clock = resolve(EXTRA_SAMPLES.find(e => e.name === 'illustration-measure').params);
  assert.ok(JSON.stringify(catalogHView(clock)).includes('scene-clock-sweep'));
  assert.equal(clock.content.geo.ring, null);
});

test('illustration: what is seen fills 50–80% of the safe area, sits low, and the plate is full-bleed', () => {
  for (const {name, shape, params} of SAMPLE_LIST) {
    const model = resolve(params, shape);
    const {seen, boxes, stage} = model.content.geo;
    assert.ok(seen >= SEEN_SHARE.min && seen <= SEEN_SHARE.max, `${name} ${shape}: ${seen}`);
    // The object stands on the bottom of the rect (just above the caption band), not floating mid-frame.
    const low = Math.max(...boxes.map(b => b.y + b.height));
    assert.ok(stage.y + stage.height - low < 0.2 * model.rect.height, `${name} ${shape}: sits low`);
    for (const box of boxes) assert.ok(box.x >= -0.01 && box.y >= -0.01 && box.x + box.width <= model.rect.width + 0.01 && box.y + box.height <= model.rect.height + 0.01, `${name}: object inside the rect`);
    assert.deepEqual(model.rect, model.safe, 'the module takes the whole safe area');
    if (model.content.number) assert.ok(model.content.number.size >= 100, `${name}: the number is set at hero size (${model.content.number.size})`);
    if (params.plate !== 'style') {
      const g = model.content.ground;
      assert.deepEqual([model.rect.x + g.x, model.rect.y + g.y, g.width, g.height], [0, 0, FORMATS[shape].width, FORMATS[shape].height], `${name}: plate is full-bleed`);
    }
  }
});

test('illustration: the change lands on its word, slow → fast → slow, and the scene never holds still', () => {
  for (const {name, shape, params} of SAMPLE_LIST) {
    const model = resolve(params, shape);
    const ops = catalogHTimeline(model);
    const tweens = ops.filter(op => op.type === 'tween');
    assert.ok(tweens.every(op => !/back|elastic|bounce/.test(op.ease ?? '')), `${name}: no overshoot`);
    const findings = sceneMotionFindings({id: model.id, motion: model.motion, ops, states: [], hits: model.events.map(e => e.time)});
    assert.deepEqual(findings.filter(f => f.rule === 'static-hold'), [], name);
  }
  // A hit on the stressed word moves the change there; the move is centred on it.
  const model = resolve({...SAMPLES.illustration}, 'portrait', {hits: [{event: 'change', at: 4}]});
  const change = model.events.find(e => e.name === 'change');
  assert.equal(change.time, 4);
  assert.equal(model.content.moveAt + model.content.span / 2, 4);
  const worn = t => frameState(catalogHTimeline(model), t).get('scene-deck-worn').opacity;
  assert.equal(worn(model.content.moveAt - 0.05), 0);
  assert.ok(worn(4) > 0.4 && worn(4) < 0.6, 'halfway on the word');
  assert.equal(worn(model.motion.exitStart - 0.01), 1);
});

test('illustration: the density gate counts the scene as filled', async () => {
  const {checkLayoutProject} = await import('../src/layout_check.js');
  const {visualDensity} = await import('../src/visual_density.js');
  const {mkdtemp, rm} = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'launchclip-illustration-'));
  try {
    const story = {schema: 'launchclip.story.v1', lane: 'motion', format: {width: 1080, height: 1920, fps: 30, duration: 10}, brand,
      scenes: [{id: 'a', module: 'illustration', start: 0, end: 5, params: SAMPLES.illustration}, {id: 'b', module: 'illustration', start: 5, end: 10, params: EXTRA_SAMPLES.find(e => e.name === 'illustration-count').params}]};
    const report = await checkLayoutProject(dir, {story, profile: 'shorts'});
    assert.deepEqual(report.findings.filter(f => f.severity === 'error'), []);
    const plates = report.rects.filter(r => r.role === 'media');
    assert.deepEqual(plates.map(r => r.id), ['a-plate', 'b-plate']);
    assert.ok(plates.every(r => r.rect.x <= 0 && r.rect.y <= 0 && r.rect.width >= 1080 && r.rect.height >= 1920), 'the full-bleed plate is declared');
    // Density scores footage shorts, so a footage shot follows; the drawn plates fill without counting as footage.
    const shot = {id: 'shot', role: 'media', rect: {x: 0, y: 0, width: 1080, height: 1920}, start: 10, end: 12};
    const density = visualDensity({...story, format: {...story.format, duration: 12}, resolved: {duration: 12}}, [...report.rects, shot]);
    assert.deepEqual(density.samples.filter(s => s.fill < 1).map(s => s.t), [], 'every moment is filled');
    assert.ok(density.samples.filter(s => s.t < 10).every(s => s.footage === 0), 'an illustration is not footage');
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test('illustration: a kinetic story never carries one object\'s stage into the next object\'s scene', async () => {
  const {resolveModule} = await import('@launchclip/core/modules.mjs');
  const {resolveStory} = await import('@launchclip/core/story.mjs');
  const {readFile} = await import('node:fs/promises');
  const story = resolveStory(JSON.parse(await readFile(new URL('../examples/story/illustration-9x16/storyboard.json', import.meta.url), 'utf8')));
  for (const scene of story.scenes.slice(1)) assert.equal(resolveModule(scene, story).carry ?? null, null, `${scene.id} builds its own object`);
});

test('illustration: a scene too short for the change says to lengthen it, not to move at', () => {
  // A 2 s scene leaves no time between the build and the exit: no `at` can pass.
  assert.throws(
    () => resolve({subject: {object: 'clock'}, change: 'wear', at: 0.5}, 'portrait', {duration: 2}),
    /must fall between [\d.]+ s and [\d.]+ s after the scene start; got 0\.5 s — the scene is too short for illustration: it needs a scene of at least [\d.]+ s; lengthen it or use another module/,
  );
  // A window that fits keeps the plain message.
  assert.throws(
    () => resolve({subject: {object: 'clock'}, change: 'wear', at: 4.9}),
    (error) => /params\.at must fall between/.test(error.message) && !/too short/.test(error.message),
  );
});

test('illustration: a too-short scene is reported in the words duration_fit reads, and the length it asks for resolves', () => {
  let message = '';
  try { resolve({subject: {object: 'clock'}, change: 'wear'}, 'portrait', {duration: 2}); } catch (error) { message = error.message; }
  const [found] = durationErrors([`params: scenes[2] (x): module "illustration" params: ${message}`]);
  assert.equal(found.scene, 2);
  assert.ok(found.min > 2, `asks for a longer scene, got ${found.min}`);
  assert.doesNotThrow(() => resolve({subject: {object: 'clock'}, change: 'wear'}, 'portrait', {duration: found.min}));
});
