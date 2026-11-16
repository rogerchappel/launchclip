// Catalogue G sequence cards (kit/core/catalog-g-sequence.mjs): compare and timeline.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MODULES, catalogGTimeline} from '@launchclip/core/catalog-g.mjs';
import {frameState} from '@launchclip/core/catalog-b-view.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-g.mjs';
import {knownModules} from '@launchclip/core/modules.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const LANDSCAPE = {format: {width: 1920, height: 1080, fps: 30, duration: 30}, aspect: '16:9'};
const ctx = (overrides = {}) => ({id: 'scene', start: 1, duration: 5, format: {width: 1080, height: 1920, fps: 30, duration: 30}, brand, aspect: '9:16', hits: [], ...overrides});
const resolve = (id, params, overrides) => ({...MODULES[id].resolve(params, ctx(overrides)), module: id});

const COMPARE = {left: {title: 'Before', items: ['A week in the editor', 'Captions by hand']}, right: {title: 'After', items: ['Twelve minutes', 'Captions from the transcript']}};
const STEPS = {title: 'Launch week', steps: [{label: 'Record', detail: 'One take'}, {label: 'Edit', icon: 'scissors'}, {label: 'Review'}, {label: 'Post', icon: 'send'}]};

test('the sequence cards are registered in both renderers', () => {
  for (const id of ['compare', 'timeline']) {
    assert.ok(knownModules().includes(id), id);
    assert.ok(EMITTERS[id], id);
  }
});

test('compare: the left lands, then the arrow, then the right, side by side when it fits', () => {
  const wide = resolve('compare', COMPARE, LANDSCAPE);
  assert.equal(wide.content.layout.layout, 'columns');
  const ops = catalogGTimeline(wide);
  const {leftAt, rightAt} = wide.content;
  assert.ok(rightAt > leftAt);
  assert.equal(frameState(ops, rightAt - 0.2).get('scene-side-1').opacity, 0);
  assert.ok(frameState(ops, rightAt - 0.05).get('scene-side-0').opacity > 0.99, 'the left has landed');
  const hold = frameState(ops, wide.motion.exitStart - 0.05);
  for (const target of ['scene-side-1', 'scene-arrow', 'scene-item-1-1']) assert.equal(hold.get(target).opacity, 1, target);
  const html = EMITTERS.compare(wide).html;
  assert.match(html, /stroke="#fdb022"/, 'ticks on the after side');
  // A narrow frame with long items stacks.
  const tall = resolve('compare', {left: {title: 'The old way', items: ['Exporting every caption by hand', 'Re-rendering for every platform']}, right: {title: 'With LaunchClip', items: ['Captions from the transcript', 'One story, every aspect ratio']}});
  assert.equal(tall.content.layout.layout, 'stacked');
  assert.ok(tall.minTextPx >= 44);
  assert.equal(resolve('compare', {...COMPARE, mode: 'columns'}, LANDSCAPE).content.tones[0].mark, null);
  assert.throws(() => resolve('compare', {left: COMPARE.left}), /right.*is required/);
  assert.throws(() => resolve('compare', {...COMPARE, right: {title: 'After', items: []}}), /params\.right\.items/);
});

test('timeline: nodes land in order while the line runs on to each', () => {
  const model = resolve('timeline', STEPS);
  assert.equal(model.content.layout.direction, 'vertical');
  const ops = catalogGTimeline(model);
  const times = model.content.steps.map(step => step.time);
  assert.ok(times.every((t, i) => i === 0 || t > times[i - 1]));
  assert.ok(frameState(ops, times[0] + 0.1).get('scene-progress').scaleY < 1e-6, 'no line before the second step');
  assert.equal(frameState(ops, times[2] + 0.01).get('scene-progress').scaleY, frameState(ops, times[2] + 0.05).get('scene-progress').scaleY, 'the line reaches a node as it lands and waits there');
  assert.equal(frameState(ops, times.at(-1) + 0.1).get('scene-progress').scaleY, 1);
  assert.equal(frameState(ops, times[1] - 0.05).get('scene-node-1').opacity, 0);
  const across = resolve('timeline', STEPS, LANDSCAPE);
  assert.equal(across.content.layout.direction, 'horizontal');
  assert.equal(frameState(catalogGTimeline(across), across.motion.exitStart - 0.1).get('scene-progress').scaleX, 1);
  assert.throws(() => resolve('timeline', {steps: [{label: 'A', at: 2}, {label: 'B', at: 1}]}), /must not come before/);
  assert.throws(() => resolve('timeline', {steps: [{label: 'Only one'}]}), /params\.steps/);
});

test('the phrase table suggests compare and timeline for their intents', async () => {
  const {suggestModules} = await import('@launchclip/core/planning-prompt.mjs');
  const lines = {compare: 'We used to edit for a week; instead of that, it takes minutes.', timeline: 'By week three the roadmap was done.'};
  for (const [id, sentence] of Object.entries(lines)) for (const lane of ['motion', 'footage-led'])
    assert.ok(suggestModules(sentence, {lane})[0]?.modules.includes(id), `${id} in ${lane}`);
});

test('timeline: vertical steps share one pitch, and a stacked compare spreads in a panel', () => {
  const rect = {x: 96, y: 132, width: 898, height: 689};
  const tl = resolve('timeline', {direction: 'vertical', rect, steps: [{label: "Experiments we've done"}, {label: 'Working now'}, {label: 'Next'}]}, LANDSCAPE);
  const gaps = tl.content.centres.slice(1).map((c, i) => c.y - tl.content.centres[i].y);
  assert.ok(Math.max(...gaps) - Math.min(...gaps) < 0.05, `even spacing ${gaps}`);
  const cmp = resolve('compare', {...COMPARE, rect: {...rect, width: 600}}, LANDSCAPE);
  if (cmp.content.layout.layout === 'stacked') assert.ok(cmp.content.layout.height >= rect.height * 0.75, `compare fills ${cmp.content.layout.height}`);
});

// A node by id in a view tree, and every node with a style key.
const walk = (node, out = []) => { if (node && typeof node === 'object') { out.push(node); for (const child of node.children ?? []) walk(child, out); } return out; };

test('compare free variants: no panel, the right side on a beat, every block breathing', async () => {
  const {catalogGView} = await import('@launchclip/core/catalog-g.mjs');
  for (const variant of ['halves', 'versus', 'verdict']) for (const overrides of [{}, LANDSCAPE]) {
    const model = resolve('compare', {...COMPARE, variant}, overrides);
    assert.equal(model.content.layout.mode, variant, variant);
    const nodes = walk(catalogGView(model));
    // No filled box behind the text: only washes, the divider and the stamp frame carry a background or border.
    assert.ok(nodes.every(n => !n.style?.background || /wash|divider|strike/.test(n.id ?? '')), `${variant}: no panel`);
    // 120 bpm from the scene start: the right side lands on a whole beat.
    assert.ok(Math.abs(((model.content.rightAt - model.start) / 0.5) % 1) < 1e-6, `${variant}: right at ${model.content.rightAt}`);
    const ops = catalogGTimeline(model);
    const idle = ops.filter(op => op.type === 'tween' && /-idle$|-vs-shake$/.test(op.target) && op.ease === 'sine.inOut');
    assert.ok(idle.length >= 2, `${variant}: breathes after landing`);
    assert.ok(EMITTERS.compare(model).html.length > 0);
  }
  // Over footage the free type carries a shadow; on the plate it does not.
  const shadowed = model => walk(catalogGView(model)).some(n => n.style?.textShadow);
  assert.ok(shadowed(resolve('compare', {...COMPARE, variant: 'halves'}, {footage: true})));
  assert.ok(!shadowed(resolve('compare', {...COMPARE, variant: 'halves'})));
});

test('compare verdict strikes the left, then stamps the right title down and shakes it', () => {
  const model = resolve('compare', {...COMPARE, variant: 'verdict'});
  const ops = catalogGTimeline(model), c = model.content;
  const strike = ops.find(op => op.target === 'scene-strike' && op.type === 'tween');
  const stamp = ops.find(op => op.target === 'scene-stamp' && op.type === 'tween' && op.to.scaleX === 1);
  assert.equal(strike.start, c.rightAt);
  assert.ok(stamp.start > strike.start && stamp.to.rotation === -4);
  assert.ok(ops.some(op => op.target === 'scene-stamp-shake' && op.type === 'tween' && op.start >= stamp.start + stamp.duration - 1e-6));
  assert.equal(c.layout.stamp.text, 'AFTER');
  // The pick's items wait for the stamp.
  assert.ok(c.sides[1].items.every(item => item.time >= stamp.start));
  assert.deepEqual(frameState(ops, model.end - 0.6).get('scene-stamp').rotation, -4);
});
