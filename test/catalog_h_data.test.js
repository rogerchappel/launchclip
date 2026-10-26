// Catalogue H data explainers (kit/core/catalog-h-data.mjs): unit-grid and
// number-line, their params, defaults, both renderers' output and the
// settled frame; the planner's phrase rows and "the study says" lines.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MODULES, VARIANTS, catalogHTimeline, catalogHView} from '../kit/core/catalog-h.mjs';
import {MAX_UNITS} from '../kit/core/catalog-h-data.mjs';
import {contrastRatio} from '../kit/core/catalog-h-base.mjs';
import {frameState} from '../kit/core/catalog-b-view.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-h.mjs';
import {hyperframesEmitters} from '../kit/hyperframes/story-compiler.mjs';
import {knownModules, resolveModule} from '../kit/core/modules.mjs';
import {PHRASE_MODULE_TABLE, phraseRowModule, planningPrompt, storyboardModulesReference, suggestModules} from '../kit/core/planning-prompt.mjs';
import {SAMPLES} from '../scripts/element-samples.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const light = {colors: {bg: '#f5f1e8', primary: '#b7791f', accent: '#1f6feb', ink: '#f5f1e8', paper: '#14161c'}, fonts: brand.fonts};
const FORMATS = {'9:16': {width: 1080, height: 1920, fps: 30}, '16:9': {width: 1920, height: 1080, fps: 30}};
const ctx = (aspect = '9:16', overrides = {}) => ({id: 'scene', start: 1, duration: 5, format: FORMATS[aspect], brand, aspect, hits: [], ...overrides});
const resolve = (id, params = SAMPLES[id], aspect, overrides) => ({...MODULES[id].resolve(params, ctx(aspect, overrides)), module: id});
const settled = model => frameState(catalogHTimeline(model), model.motion.exitStart - 0.01);
const IDS = ['unit-grid', 'number-line'];

test('unit-grid and number-line are registered in the registry, both renderers and the samples', () => {
  const remotion = readFileSync(new URL('../kit/remotion/catalog/CatalogH.tsx', import.meta.url), 'utf8');
  assert.match(remotion, /Object\.keys\(MODULES\)/, 'Remotion draws every catalogue H module from the shared tree');
  for (const id of IDS) {
    assert.ok(knownModules().includes(id), id);
    assert.ok(EMITTERS[id] && hyperframesEmitters()[id], id);
    assert.ok(SAMPLES[id], id);
    assert.ok(MODULES[id].events.includes('build'), id);
  }
  assert.deepEqual([...VARIANTS['unit-grid']], ['solid', 'stroke', 'dots']);
  assert.deepEqual([...VARIANTS['number-line']], ['ruler', 'track']);
});

test('every variant resolves in both aspects, on dark and light brands, and settles inside its rect', () => {
  for (const id of IDS) for (const variant of VARIANTS[id]) for (const aspect of ['9:16', '16:9']) for (const b of [brand, light]) {
    const label = `${id}/${variant} ${aspect} ${b.colors.bg}`;
    const model = resolve(id, {...SAMPLES[id], variant}, aspect, {brand: b});
    const out = EMITTERS[id](model);
    assert.doesNotMatch(out.html + out.motion, /undefined|NaN/, label);
    assert.ok(model.minTextPx >= (aspect === '9:16' ? 44 : 32) - 1e-6, `${label} key text ${model.minTextPx}`);
    for (const [target, props] of settled(model)) if (props.clipR !== undefined) assert.equal(props.clipR, 0, `${label}: ${target} still clipped`);
    // The Remotion tree and the HyperFrames HTML carry the same element ids.
    const ids = [];
    const walk = node => { if (node && typeof node === 'object') { if (node.id) ids.push(node.id); (node.children ?? []).forEach(walk); } };
    walk(catalogHView(model));
    for (const target of new Set(catalogHTimeline(model).map(op => op.target))) assert.ok(ids.includes(target), `${label}: op target ${target} is in the view`);
    for (const nodeId of ids) assert.ok(out.html.includes(`id="${nodeId}"`), `${label}: ${nodeId} in the HyperFrames HTML`);
  }
});

test('unit-grid: count, icon, groups and highlight are validated', () => {
  const r = params => resolve('unit-grid', params);
  assert.throws(() => r({count: 0}), /params\.count must be an integer between 1 and 200/);
  assert.throws(() => r({count: MAX_UNITS + 1}), /params\.count/);
  assert.throws(() => r({count: 10, icon: 'not-an-icon'}), /params\.icon must be "person" or an icon name/);
  assert.throws(() => r({count: 10, groups: [{count: 4, label: 'A'}, {count: 5, label: 'B'}]}), /params\.groups counts must add up to params\.count \(10\); they add up to 9/);
  assert.throws(() => r({count: 10, groups: [{count: 10, label: 'All'}]}), /params\.groups must be an array of 2–3/);
  assert.throws(() => r({count: 10, groups: [{count: 5, label: 'A'}, {count: 5, label: 'B'}], highlight: {count: 1}}), /cannot be combined with params\.groups/);
  assert.throws(() => r({count: 10, highlight: {count: 10}}), /params\.highlight\.count must be an integer between 1 and 9/);
  assert.throws(() => r({count: 10, splitAt: 2}), /params\.splitAt needs params\.groups/);
  assert.throws(() => r({count: 10, groups: [{count: 5, label: 'A', tone: 'great'}, {count: 5, label: 'B'}]}), /tone must be one of good, bad, neutral, primary, accent, paper/);
  // 200 units still fit, in cells of at least 30 px.
  for (const aspect of ['9:16', '16:9']) assert.ok(resolve('unit-grid', {count: 200, groups: [{count: 120, label: 'A'}, {count: 50, label: 'B'}, {count: 30, label: 'C'}]}, aspect).content.cell >= 30);
});

test('unit-grid: defaults, the count-in, the split into groups and the count-up', () => {
  const model = resolve('unit-grid');
  const c = model.content;
  assert.equal(c.variant, 'solid');
  assert.equal(c.icon, 'person');
  assert.equal(c.units.length, 49);
  assert.equal(c.base, brand.colors.paper, 'units start in paper');
  assert.deepEqual(model.events.map(e => e.name), ['enter', 'build', 'split']);
  assert.ok(c.splitAt > c.buildEnd, 'the split follows the build');
  assert.ok(c.units.at(-1).time - c.units[0].time <= 1.1 + 1e-6, 'the count-in takes about a second');
  const ops = catalogHTimeline(model);
  assert.equal(frameState(ops, c.buildAt - 0.01).get('scene-ui-0').opacity, 0);
  const state = settled(model);
  c.units.forEach((unit, i) => {
    assert.equal(state.get(`scene-ui-${i}`).opacity, 1);
    const outer = state.get(`scene-u-${i}`);
    assert.equal(outer.x, unit.move.dx);
    assert.ok(outer.scaleX > 0 && outer.scaleX <= 1);
    assert.equal(state.get(`scene-uc-${i}`).opacity, 1, 'every unit takes its group colour');
  });
  assert.equal(state.get('scene-gn-0').text, '24');
  assert.equal(state.get('scene-gn-1').text, '25');
  // The first 24 units go left, the rest right, and nothing leaves the rect.
  const at = (unit) => ({x: unit.x + unit.move.dx, y: unit.y + unit.move.dy});
  assert.ok(at(c.units[23]).x < at(c.units[24]).x);
  for (const unit of c.units) {
    const p = at(unit), size = c.cell * unit.move.scale;
    assert.ok(p.x >= -0.01 && p.x + size <= model.rect.width + 0.01 && p.y >= -0.01 && p.y + size <= model.rect.height + 0.01, JSON.stringify(p));
  }
  // A hit times the split.
  assert.equal(resolve('unit-grid', SAMPLES['unit-grid'], '9:16', {hits: [{event: 'split', at: 4}]}).content.splitAt, 4);
});

test('unit-grid: a highlight lights the first units and dims the rest', () => {
  const model = resolve('unit-grid', {count: 10, highlight: {count: 1, label: '1 IN 10', tone: 'bad'}});
  const state = settled(model);
  assert.deepEqual(model.events.map(e => e.name), ['enter', 'build', 'highlight']);
  assert.equal(state.get('scene-uc-0').opacity, 1);
  assert.equal(state.get('scene-ui-0').opacity, 1);
  for (let i = 1; i < 10; i++) assert.ok(Math.abs(state.get(`scene-ui-${i}`).opacity - 0.28) < 1e-6);
  assert.equal(state.get('scene-hl').opacity, 1);
  assert.ok(contrastRatio(model.content.highlight.color, brand.colors.bg) >= 3, 'the "bad" red reads on the background');
  assert.ok(contrastRatio(resolve('unit-grid', {count: 10, highlight: {count: 1, tone: 'bad'}}, '9:16', {brand: light}).content.highlight.color, light.colors.bg) >= 3, 'and on a light one');
});

test('number-line: range, step, ranges and marker are validated', () => {
  const r = params => resolve('number-line', params);
  const ranges = [{from: 8, to: 12, label: 'Size'}];
  assert.throws(() => r({from: 5, to: 5, ranges}), /params\.to must be greater than params\.from/);
  assert.throws(() => r({from: 1, to: 25, ranges: []}), /params\.ranges must be an array of 1–3/);
  assert.throws(() => r({from: 1, to: 25, ranges: [{from: 8, to: 30, label: 'Size'}]}), /params\.ranges\[0\]\.to must be between 1 and 25/);
  assert.throws(() => r({from: 1, to: 25, ranges: [{from: 8, to: 12, label: 'A'}, {from: 10, to: 14, label: 'B'}]}), /params\.ranges\[1\] overlaps params\.ranges\[0\]/);
  assert.throws(() => r({from: 1, to: 25, ranges: [{from: 12, to: 8, label: 'A'}]}), /params\.ranges\[0\]\.to must be greater/);
  assert.throws(() => r({from: 1, to: 25, step: 0.1, ranges}), /params\.step/);
  assert.throws(() => r({from: 1, to: 25, ranges, marker: {value: 40}}), /params\.marker\.value/);
});

test('number-line: defaults, labelled range ends, and ranges lighting up one at a time', () => {
  const model = resolve('number-line');
  const c = model.content;
  assert.equal(c.variant, 'ruler');
  assert.equal(c.ticks.length, 25, '1–25 in steps of 1');
  const labelled = c.tickLabels.map(t => t.text);
  for (const end of ['8', '12', '15', '25']) assert.ok(labelled.includes(end), `range end ${end} is labelled`);
  for (let i = 1; i < c.tickLabels.length; i++) assert.ok(c.tickLabels[i].x - c.tickLabels[i - 1].x >= c.labelW, 'tick labels never overlap');
  assert.deepEqual(model.events.map(e => e.name), ['enter', 'build', 'range-0', 'range-1']);
  const [a, b] = c.ranges;
  assert.ok(a.time >= c.buildEnd && b.time > a.time + 0.5, 'each range on its own cue after the build');
  assert.ok(contrastRatio(b.color, brand.colors.bg) >= 3 && b.color !== brand.colors.primary, 'bad is a red');
  assert.equal(a.color, brand.colors.primary, 'good is the brand primary');
  const ops = catalogHTimeline(model);
  const between = frameState(ops, a.time + 0.6);
  assert.equal(between.get('scene-band-0').scaleX, 1);
  assert.equal(between.get('scene-band-1').scaleX, 0, 'the second range waits for its cue');
  const state = settled(model);
  assert.equal(state.get('scene-band-1').scaleX, 1);
  assert.equal(state.get('scene-rl-1').opacity, 1);
  assert.equal(state.get('scene-tl-24-r1').opacity, 1, '25 lights up red');
  // Hits time each range by name; a marker drops after the ranges.
  const timed = resolve('number-line', {...SAMPLES['number-line'], marker: {value: 10, label: 'Sweet spot'}}, '9:16', {hits: [{event: 'range-1', at: 3.4}], duration: 6});
  assert.equal(timed.content.ranges[1].time, 3.4);
  assert.ok(timed.content.marker.time > timed.content.ranges[0].time);
  assert.equal(settled(timed).get('scene-marker').opacity, 1);
  // Neighbouring labels that would collide stack into rows.
  const crowded = resolve('number-line', {from: 0, to: 10, ranges: [{from: 2, to: 3, label: 'Too little'}, {from: 3, to: 4, label: 'Just right'}, {from: 4, to: 5, label: 'Too much'}]}).content.ranges;
  for (const x of crowded) for (const y of crowded) if (x !== y && x.row === y.row) assert.ok(x.labelX + x.labelW <= y.labelX || y.labelX + y.labelW <= x.labelX, 'labels in one row never overlap');
  assert.ok(new Set(crowded.map(r => r.row)).size > 1, 'crowded labels stack');
});

test('the planner: phrase rows for the people, the rule and the source, and the study-says hint', () => {
  const first = text => suggestModules(text)[0]?.modules ?? [];
  assert.equal(first('They took 49 trained lifters and split them into two groups.')[0], 'unit-grid');
  assert.ok(first('One in 10 people never finish.').includes('unit-grid'));
  assert.equal(first('The gym rule: 8-12 reps builds size, over 15 is just cardio.')[0], 'number-line');
  assert.ok(first('Sleep between 7 and 9 hours.').includes('number-line'));
  assert.equal(first('According to Morton et al., 2016, it made no difference.')[0], 'frame.sources');
  assert.ok(first('Researchers found no difference after 12 weeks.').includes('frame.sources'));
  const row = PHRASE_MODULE_TABLE.find(entry => entry.overlay);
  assert.equal(phraseRowModule(row), 'frame.sources');
  const prompt = planningPrompt({tier: 'structured', lane: 'voiceover-motion', format: {width: 1080, height: 1920, fps: 30, duration: 30}});
  assert.match(prompt, /## Data explainers \(the study says\)/);
  assert.match(prompt, /question .* → what everyone believes .* → the fair test .* → the result/);
  assert.match(prompt, /No source, no study claim/);
  assert.match(prompt, /frame\.sources \(story overlay, not a scene module\)/);
  assert.match(prompt, /^### unit-grid \(/m);
  assert.match(prompt, /^### number-line \(/m);
  assert.match(storyboardModulesReference(), /## Data explainers \(the study says\)/);
});

test('a data story resolves through the registry with its frame safe area', () => {
  const story = {format: {width: 1080, height: 1920, fps: 30, duration: 10}, brand, scenes: [], frame: {kicker: false, sections: false, sources: [{text: 'Morton et al., 2016 · J Appl Physiol', start: 0}]}};
  const model = resolveModule({id: 's1', module: 'number-line', start: 0, end: 5, params: SAMPLES['number-line']}, story);
  assert.equal(model.module, 'number-line');
  assert.ok(model.rect.y + model.rect.height <= model.frame.safe.y + model.frame.safe.height + 1e-6);
});
