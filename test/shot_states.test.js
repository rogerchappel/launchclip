// Shot states and the focus device (kit/core/shot-states.mjs): one module
// instance advancing through timed states, drawn by both renderers from the
// shared view tree and op list.
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveStory, validateStory} from '@launchclip/core/story.mjs';
import {resolveModule} from '@launchclip/core/modules.mjs';
import {catalogHTimeline, catalogHView} from '@launchclip/core/catalog-h.mjs';
import {catalogBTimeline, catalogBView} from '@launchclip/core/catalog-b.mjs';
import {catalogGTimeline, catalogGView} from '@launchclip/core/catalog-g.mjs';
import {frameState} from '@launchclip/core/catalog-b-view.mjs';
import {EMITTERS as H_EMITTERS} from '../kit/hyperframes/catalog-h.mjs';
import {FOCUS_DIM, STATE_MODULES, STATE_MOVE, countText, focusDevice, indexView, shotStateErrors} from '@launchclip/core/shot-states.mjs';
import {EXTRA_SAMPLES, SAMPLES} from '../scripts/element-samples.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const story = (scene, format = {width: 1920, height: 1080, fps: 30, duration: 12}) => ({schema: 'launchclip.story.v1', lane: 'motion', brand, format, scenes: [scene]});
const model = (scene, format) => { const s = resolveStory(story(scene, format)); return resolveModule(s.scenes[0], s); };
const DRAW = {'process-steps': [catalogBView, catalogBTimeline], excerpt: [catalogGView, catalogGTimeline]};
const draw = m => (DRAW[m.module] ?? [catalogHView, catalogHTimeline]);
const ids = view => { const out = []; const walk = n => { if (n && typeof n === 'object') { if (n.id) out.push(n.id); (n.children ?? []).forEach(walk); } }; walk(view); return out; };

const BARS = {title: 'Cost per task', format: {style: 'currency'}, data: [{label: 'Model A', value: 1}, {label: 'Model B', value: 1}]};
const barScene = (states, params = BARS) => ({id: 'cost', module: 'bar-chart', start: 0, end: 12, params, states});

test('states validate: structure in story.mjs, the set and the module in shot-states', () => {
  assert.equal(validateStory(story(barScene([{at: 3, set: {focus: 1}}]))).ok, true);
  assert.match(validateStory(story(barScene([{at: 3, set: {focus: 1}}, {at: 2, set: {focus: 0}}]))).errors.join(), /must come after the state before it/);
  assert.match(validateStory(story(barScene([{at: 13, set: {focus: 1}}]))).errors.join(), /must fall inside/);
  assert.match(validateStory(story(barScene(Array.from({length: 6}, (_, i) => ({at: i + 2, set: {focus: 0}}))))).errors.join(), /1–5 states/);
  assert.match(shotStateErrors([{at: 1, set: {wobble: true}}]).join(), /set\.wobble is not supported/);
  assert.match(shotStateErrors([{at: 1, set: {dim: 0.2}}]).join(), /must change something/);
  assert.throws(() => model(barScene([{at: 3, set: {params: {title: 'x'}}}])), /title is not state-animatable on bar-chart/);
  assert.throws(() => model(barScene([{at: 3, set: {params: {data: [{label: 'A', value: 1}]}}}])), /must keep 2 entries/);
  assert.throws(() => model(barScene([{at: 0.8, set: {focus: 1}}])), /after the module has entered/);
  assert.throws(() => model(barScene([{at: 3, set: {focus: 4}}])) && catalogHView(model(barScene([{at: 3, set: {focus: 4}}]))), /has no item 4/);
  assert.throws(() => model({id: 'h', module: 'hook-title', start: 0, end: 4, params: {headline: 'Hi'}, states: [{at: 2, set: {focus: 0}}]}), /does not run states/);
});

test('states resolve word anchors like hits', () => {
  const words = [{text: 'the', start: 2.1}, {text: 'half', start: 6.4}];
  const s = resolveStory(story(barScene([{at: 'word:half', set: {guide: {value: 0.5}}}])), {words});
  assert.equal(s.scenes[0].states[0].at, 6.4);
});

test('a param state morphs each element to where the new model settles it', () => {
  const m = model(barScene([{at: 3, set: {params: {data: [{label: 'Model A', value: 1}, {label: 'Model B', value: 3}]}}}]));
  const ops = catalogHTimeline(m);
  const before = frameState(ops, 2.99), after = frameState(ops, 3 + STATE_MOVE + 0.01);
  assert.equal(before.get('cost-bar-0').scaleY, 1);
  // Model B is now the peak, so Model A drops to a third of the plot.
  assert.ok(Math.abs(after.get('cost-bar-0').scaleY - 1 / 3) < 0.01, JSON.stringify(after.get('cost-bar-0')));
  assert.equal(after.get('cost-value-1').text, '$3');
  assert.ok(after.get('cost-value-0').y > 100, 'the value label rides down with its bar');
  // Mid-move is between the two (seek-safe interpolation), and the count runs.
  const mid = frameState(ops, 3 + STATE_MOVE / 2).get('cost-bar-0').scaleY;
  assert.ok(mid < 1 && mid > 1 / 3);
  assert.match(String(frameState(ops, 3 + STATE_MOVE * 0.6).get('cost-value-1').text), /^\$[123]$/);
});

test('the focus ring travels between targets and the rest dims to 30 %', () => {
  const m = model(barScene([{at: 3, set: {focus: 1}}, {at: 6, set: {focus: 0}}, {at: 9, set: {focus: null}}]));
  const view = catalogHView(m), ops = catalogHTimeline(m);
  const rings = ids(view).filter(id => /-ss-ring-/.test(id));
  assert.deepEqual(rings, ['cost-ss-ring-0', 'cost-ss-ring-1']);
  const at = t => frameState(ops, t);
  assert.equal(at(2.9).get('cost-ss-ring-0').opacity, 0);
  assert.equal(at(3.5).get('cost-ss-ring-0').opacity, 1);
  assert.ok(Math.abs(at(3.5).get('cost-bar-0').opacity - FOCUS_DIM) < 1e-6);
  assert.equal(at(3.5).get('cost-bar-1').opacity ?? 1, 1);
  // At the hand-over the new ring sits exactly on the old one, then settles on its own target.
  const hand = at(6);
  assert.equal(hand.get('cost-ss-ring-0').opacity, 0);
  assert.ok(Math.abs(hand.get('cost-ss-ring-1').x) > 100);
  const settled = at(6 + STATE_MOVE + 0.01).get('cost-ss-ring-1');
  assert.deepEqual([settled.x, settled.y, settled.scaleX, settled.scaleY], [0, 0, 1, 1]);
  assert.equal(at(7).get('cost-bar-1').opacity, FOCUS_DIM);
  assert.equal(at(7).get('cost-bar-0').opacity, 1);
  // focus: null hides the ring and restores everything.
  assert.equal(at(9.5).get('cost-ss-ring-1').opacity, 0);
  assert.equal(at(9.5).get('cost-bar-1').opacity, 1);
});

test('reveal holds an item back until its state; guide, glow and note persist until clear', () => {
  const m = model(barScene([{at: 4, set: {reveal: [1]}}, {at: 6, set: {guide: {value: 0.5, label: 'HALF'}, glow: 0}}, {at: 8, set: {note: {text: 'Winner', target: 0}}}, {at: 10, set: {clear: true}}]));
  const ops = catalogHTimeline(m);
  const at = t => frameState(ops, t);
  assert.equal(at(3.9).get('cost-bar-1').scaleY, 0, 'held back');
  assert.equal(at(3.9).get('cost-value-1').opacity, 0);
  assert.equal(at(5.5).get('cost-bar-1').scaleY, 1, 'grown in after its state');
  assert.equal(at(5.9).get('cost-ss-guide-1').opacity, 0);
  assert.equal(at(7).get('cost-ss-guide-1').scaleX, 1);
  assert.equal(at(7).get('cost-ss-glow-1').opacity, 1);
  assert.equal(at(9).get('cost-ss-note-2').opacity, 1);
  assert.equal(at(9).get('cost-ss-glow-1').opacity, 1, 'still there');
  for (const id of ['cost-ss-guide-1', 'cost-ss-guide-1-label', 'cost-ss-glow-1', 'cost-ss-note-2']) assert.equal(at(10.5).get(id).opacity, 0, `${id} cleared`);
  // The value guide sits at half the axis.
  const guide = indexView(catalogHView(m).children).byId.get('cost-ss-guide-1');
  const plot = m.content.plot;
  assert.ok(Math.abs(guide.y + 1.5 - (plot.y + plot.height / 2)) < 1);
});

test('scatter-plot states work on its points form too', () => {
  const params = EXTRA_SAMPLES.find(entry => entry.name === 'scatter-plot-points').params;
  const m = model({id: 's', module: 'scatter-plot', start: 0, end: 10, params, states: [{at: 5, set: {params: {points: params.points.map(p => ({...p, y: p.y - 5}))}, focus: 3}}]}, {width: 1920, height: 1080, fps: 30, duration: 12});
  const all = ids(catalogHView(m));
  assert.ok(all.includes('s-ss-ring-0'));
  for (const target of new Set(catalogHTimeline(m).map(op => op.target))) assert.ok(all.includes(target), target);
});

const STATE_CASES = {
  'bar-chart': {params: SAMPLES['bar-chart'], set: {params: {data: SAMPLES['bar-chart'].data.map((row, i) => ({...row, value: row.value + i * 100}))}, focus: 2}},
  'scatter-plot': {params: SAMPLES['scatter-plot'], set: {params: {series: SAMPLES['scatter-plot'].series.map(s => ({...s, points: s.points.map(p => ({...p, y: p.y + 4}))}))}, focus: 3}},
  'comparison-table': {params: SAMPLES['comparison-table'], set: {focus: 'row-3'}},
  leaderboard: {params: SAMPLES.leaderboard, set: {params: {entries: SAMPLES.leaderboard.entries.map((e, i) => ({...e, value: e.value + (i === 4 ? 2000 : 0)}))}, focus: 1}},
  'unit-grid': {params: SAMPLES['unit-grid'], set: {focus: [0, 1, 2]}},
  'process-steps': {params: {steps: ['Plan', 'Build', 'Ship']}, set: {focus: 1, note: {text: 'Here', target: 1}}},
  excerpt: {params: {type: 'code', title: 'package.json', source: 'github.com/acme/app', lines: ['"scripts": {', '  "video": "launchclip make",', '}']}, set: {focus: 'line-1'}}
};

test('every state module runs a state in both aspects, and the emitter carries the state nodes', () => {
  assert.deepEqual(Object.keys(STATE_CASES).sort(), Object.keys(STATE_MODULES).sort());
  for (const [id, c] of Object.entries(STATE_CASES)) for (const format of [{width: 1920, height: 1080, fps: 30, duration: 12}, {width: 1080, height: 1920, fps: 30, duration: 12}]) {
    const label = `${id} ${format.width}x${format.height}`;
    const m = model({id: 's', module: id, start: 0, end: 10, params: c.params, states: [{at: 5, set: c.set}]}, format);
    const [view, timeline] = draw(m);
    const tree = view(m), ops = timeline(m);
    const all = ids(tree);
    assert.ok(all.includes('s-ss-ring-0'), `${label}: ring in the view`);
    for (const target of new Set(ops.map(op => op.target))) assert.ok(all.includes(target), `${label}: op target ${target} in the view`);
    const ring = frameState(ops, 5 + STATE_MOVE).get('s-ss-ring-0');
    assert.equal(ring.opacity, 1, label);
    const dimmed = [...frameState(ops, 6).values()].filter(props => Math.abs((props.opacity ?? 1) - FOCUS_DIM) < 0.02);
    assert.ok(dimmed.length > 0, `${label}: siblings dim`);
    assert.doesNotMatch(JSON.stringify(ops), /NaN|null/, label);
    if (H_EMITTERS[id]) assert.match(H_EMITTERS[id](m).html, /id="s-ss-ring-0"/, label);
  }
});

test('focusDevice is usable on its own: one ring per distinct target, FLIP travel, dims restored', () => {
  const device = focusDevice({id: 'm', start: 0, color: '#46d4ff', steps: [
    {at: 1, rect: {x: 0, y: 0, width: 100, height: 50}, dim: ['m-b']},
    {at: 2, rect: {x: 0, y: 0, width: 100, height: 50}, dim: ['m-b']},
    {at: 3, rect: {x: 200, y: 0, width: 200, height: 50}, dim: ['m-a']}]});
  assert.equal(device.nodes.length, 2);
  assert.match(device.nodes[0].style.border, /#46d4ff/);
  const ops = [];
  device.apply(ops);
  const at = t => frameState(ops, t);
  assert.equal(at(3).get('m-ss-ring-1').x, -250);
  assert.ok(Math.abs(at(3).get('m-ss-ring-1').scaleX - 124 / 224) < 1e-6);
  assert.equal(at(3 + STATE_MOVE).get('m-ss-ring-1').x, 0);
  assert.equal(at(4).get('m-b').opacity, 1);
  assert.equal(at(4).get('m-a').opacity, FOCUS_DIM);
});

test('countText counts between numbers in the same frame and swaps other text', () => {
  const ops = [];
  countText(ops, 't', 1, '$1,200', '$3,600');
  assert.equal(ops.at(-1).props.text, '$3,600');
  assert.ok(ops.some(op => /^\$[23],\d{3}$/.test(op.props.text)));
  const swap = [];
  countText(swap, 't', 1, 'Before', 'After');
  assert.deepEqual(swap, [{type: 'set', target: 't', time: 1 + STATE_MOVE / 2, props: {text: 'After'}}]);
});

test('the planner and the storyboard reference teach builds, the ring and the depth transitions', async () => {
  const {buildLines, storyboardModulesReference} = await import('@launchclip/core/planning-prompt.mjs');
  const lines = buildLines().join('\n');
  for (const id of Object.keys(STATE_MODULES)) assert.match(lines, new RegExp(id), id);
  assert.match(lines, /rack-focus.*card-to-card.*glow-wipe/s);
  assert.match(storyboardModulesReference(), /## Builds, not cuts \(shot states\)/);
});

test('each state is a module event with a soft cue', () => {
  const m = model(barScene([{at: 3, set: {focus: 1}}, {at: 6, set: {focus: 0}}]));
  const events = m.events.filter(event => /^state-/.test(event.name));
  assert.deepEqual(events.map(event => [event.name, event.time, event.cue]), [['state-1', 3, 'hit-soft'], ['state-2', 6, 'hit-soft']]);
  assert.ok(H_EMITTERS['bar-chart'](m).events.some(event => event.name === 'state-2'));
});

test('dim: false on a later state stops dimming from then on, not before', () => {
  const m = model(barScene([{at: 3, set: {focus: 1}}, {at: 6, set: {focus: [0, 1], dim: false}}]));
  const ops = catalogHTimeline(m);
  assert.equal(frameState(ops, 4).get('cost-bar-0').opacity, FOCUS_DIM);
  assert.equal(frameState(ops, 7).get('cost-bar-0').opacity, 1);
});

test('brand.colors.focus colours the ring, so the accent stays free; one that cannot read on bg falls back to the accent', () => {
  const ring = colors => {
    const s = resolveStory({...story(barScene([{at: 3, set: {focus: 1}}])), brand: {...brand, colors: {...brand.colors, ...colors}}});
    const m = resolveModule(s.scenes[0], s);
    const node = (function find(n) { if (n?.id === 'cost-ss-ring-0') return n; for (const c of n?.children ?? []) { const hit = find(c); if (hit) return hit; } return null; })(catalogHView(m));
    return node.style.border;
  };
  assert.match(ring({}), /#46d4ff$/);
  assert.match(ring({focus: '#F1ECE2'}), /#f1ece2$/);
  assert.match(ring({focus: '#0a0b10'}), /#46d4ff$/, 'under 3:1 on bg');
});
