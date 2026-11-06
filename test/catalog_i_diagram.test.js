// line-diagram (kit/core/catalog-i-diagram.mjs) and the shared diagram
// layout (kit/core/diagram-layout.mjs): labels clear of the strokes, the
// read-time rule for labels, the note shown with the drawing, and a drawing
// that fills its plate; feynman-diagram shares the label and timing rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MODULES, catalogHTimeline, catalogHView} from '@launchclip/core/catalog-h.mjs';
import {frameState} from '@launchclip/core/catalog-b-view.mjs';
import {contrastRatio} from '@launchclip/core/catalog-b-base.mjs';
import {discHitsRect, labelHold, placeLabel, scheduleDraw, strokesHitRect} from '@launchclip/core/diagram-layout.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-h.mjs';
import {timingErrors} from '../src/timing_fit.js';
import {SAMPLES} from '../scripts/element-samples.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const light = {colors: {bg: '#f5f1e8', primary: '#b7791f', accent: '#1f6feb', ink: '#f5f1e8', paper: '#14161c'}, fonts: brand.fonts};
const FORMATS = {'9:16': {width: 1080, height: 1920, fps: 30}, '16:9': {width: 1920, height: 1080, fps: 30}};
const resolve = (id, params, {aspect = '9:16', duration = 4.5, b = brand} = {}) => ({...MODULES[id].resolve(params, {id: 'scene', start: 1, duration, format: FORMATS[aspect], brand: b, aspect, hits: []}), module: id});
const at = (model, t) => frameState(catalogHTimeline(model), t);

// The sketches from a real talking-head short about building a deck.
const SKETCHES = {
  squaring: {title: 'Squaring the deck', note: 'Illustrative layout, not a measured plan', points: {a: [0, 0], b: [60, 0], c: [60, 80], d: [0, 80]},
    lines: [{from: 'a', to: 'b', weight: 'heavy'}, {from: 'b', to: 'c', weight: 'heavy'}, {from: 'c', to: 'd', weight: 'heavy'}, {from: 'd', to: 'a', weight: 'heavy'}, {from: 'a', to: 'c', style: 'dashed', label: 'string lines'}, {from: 'b', to: 'd', style: 'dashed'}]},
  // Planned on the old 12 × 6 grid: wide in a tall frame.
  wide: {title: 'Squaring the deck', note: 'Illustrative layout, not a measured plan', points: {a: [2, 1], b: [10, 1], c: [10, 5], d: [2, 5]},
    lines: [{from: 'a', to: 'b', style: 'dashed'}, {from: 'b', to: 'c', style: 'dashed'}, {from: 'c', to: 'd', style: 'dashed'}, {from: 'd', to: 'a', style: 'dashed'}, {from: 'a', to: 'c', style: 'dashed', label: 'string lines'}, {from: 'b', to: 'd', style: 'dashed'}]},
  roof: {title: 'Planned roof', points: {a: [0, 30], b: [50, 0], c: [100, 30], d: [100, 60], e: [0, 60]},
    lines: [{from: 'e', to: 'a', weight: 'heavy'}, {from: 'd', to: 'c', weight: 'heavy'}, {from: 'a', to: 'b', style: 'dashed', label: 'planned roof'}, {from: 'b', to: 'c', style: 'dashed'}, {from: 'e', to: 'd', weight: 'heavy', label: 'deck'}]},
  stirrups: {title: 'Beam to post', points: {e: [0, 10], f: [60, 10], a: [30, 14], b: [30, 70], c: [20, 78], d: [40, 78], g: [20, 90], h: [40, 90]},
    lines: [{from: 'e', to: 'f', weight: 'heavy', label: 'beam'}, {from: 'a', to: 'b', weight: 'heavy', label: 'new post'}, {from: 'c', to: 'd'}, {from: 'd', to: 'h'}, {from: 'h', to: 'g'}, {from: 'g', to: 'c'}],
    marks: [{point: 'a', label: 'stirrup'}, {point: 'g', label: 'footing'}]}
};

const labelsOf = model => [...model.content.lines.filter(line => line.label).map(line => ({text: line.text, box: line.label.box, time: line.label.time, hold: line.label.hold})),
  ...model.content.marks.map(mark => ({text: mark.text, box: mark.box, time: mark.time, hold: mark.hold}))];
const inside = (r, outer) => r.x >= outer.x - 0.01 && r.y >= outer.y - 0.01 && r.x + r.width <= outer.x + outer.width + 0.01 && r.y + r.height <= outer.y + outer.height + 0.01;

test('line-diagram: every label sits clear of every stroke, dot and other label, inside the plate', () => {
  for (const [name, params] of Object.entries({...SKETCHES, sample: SAMPLES['line-diagram']})) for (const aspect of ['9:16', '16:9']) {
    const model = resolve('line-diagram', params, {aspect});
    const c = model.content;
    const strokes = c.lines.map(line => ({points: line.polyline, half: line.width / 2}));
    const labels = labelsOf(model);
    assert.ok(labels.length >= 1, `${name} ${aspect}: has labels`);
    for (const [i, item] of labels.entries()) {
      const where = `${name} ${aspect} "${item.text}"`;
      assert.equal(strokesHitRect(strokes, item.box, 0), false, `${where} overlaps a stroke`);
      assert.ok(c.vertices.every(v => !discHitsRect({x: v.x, y: v.y, r: v.r}, item.box)), `${where} overlaps a dot`);
      assert.ok(inside(item.box, c.inner), `${where} leaves the plate`);
      for (const other of labels.slice(i + 1)) assert.ok(item.box.x + item.box.width <= other.box.x || other.box.x + other.box.width <= item.box.x || item.box.y + item.box.height <= other.box.y || other.box.y + other.box.height <= item.box.y, `${where} overlaps "${other.text}"`);
    }
    assert.ok(c.labelSize >= 44, `${name} ${aspect}: labels are key text`);
  }
});

test('line-diagram: a label nearer another stroke than its own gets a leader to its own', () => {
  // The diagonal's label cannot sit beside it in a portrait plate, so it hangs off a leader.
  const model = resolve('line-diagram', SKETCHES.squaring);
  const diagonal = model.content.lines.find(line => line.text === 'string lines');
  assert.ok(diagonal.label.leader, 'the diagonal label has a leader');
  const ids = [];
  const walk = node => { if (node && typeof node === 'object') { if (node.id) ids.push(node.id); (node.children ?? []).forEach(walk); } };
  walk(catalogHView(model));
  for (const op of catalogHTimeline(model)) assert.ok(ids.includes(op.target), op.target);
  assert.equal(at(model, model.motion.exitStart - 0.01).get(`scene-leader-l${diagonal.index}`).strokeDashoffset, 0);
});

test('line-diagram: the drawing fills its plate, the plate fills the rect, strokes read on a phone', () => {
  for (const [name, params] of Object.entries(SKETCHES)) for (const aspect of ['9:16', '16:9']) for (const b of [brand, light]) {
    const model = resolve('line-diagram', params, {aspect, b});
    const c = model.content;
    const where = `${name} ${aspect} ${b.colors.bg}`;
    const plate = catalogHView(model);
    assert.ok(JSON.stringify(plate).includes('"scene-plate"'), `${where}: draws its plate`);
    assert.notEqual(c.plate.fill, b.colors.bg, `${where}: the plate is not the flat background`);
    // The binding axis of the drawing spans most of the area left for it.
    const fill = Math.max(c.drawing.width / c.area.width, c.drawing.height / c.area.height);
    assert.ok(fill > 0.98, `${where}: drawing fills ${fill.toFixed(2)} of its area`);
    // And a good share of the plate itself, labels' room included.
    const share = Math.max(c.drawing.width / c.inner.width, c.drawing.height / c.inner.height);
    assert.ok(share >= 0.55, `${where}: drawing spans ${share.toFixed(2)} of the plate`);
    for (const line of c.lines) assert.ok(line.width >= 9 * model.unit - 1e-6, `${where}: stroke ${line.width}px`);
    // Brand colours for strokes: the primary (the accent for dashed ones) when it reads 3:1 on the plate, else paper.
    const want = color => (contrastRatio(color, c.plate.fill) >= 3 ? color : b.colors.paper);
    for (const line of c.lines) assert.equal(line.color, line.style === 'dashed' ? want(b.colors.accent) : want(b.colors.primary), `${where}: stroke colour`);
    for (const line of c.lines) assert.ok(contrastRatio(line.color, c.plate.fill) >= 3, `${where}: stroke contrast`);
  }
  // A drawing planned wide on a tall frame (the old 12 × 6 grid) still spans the plate's width.
  const wide = resolve('line-diagram', SKETCHES.wide).content;
  assert.ok(wide.drawing.width / wide.inner.width > 0.8, `wide sketch spans ${(wide.drawing.width / wide.inner.width).toFixed(2)} of the plate`);
});

test('line-diagram: each label stays up 1 s plus reading time before the exit; the note lands with the drawing', () => {
  for (const [name, params] of Object.entries(SKETCHES)) for (const duration of [2.6, 3.5, 4.5, 8]) {
    const model = resolve('line-diagram', params, {duration});
    for (const item of labelsOf(model)) {
      assert.ok(item.hold >= labelHold(item.text) - 1e-9 && labelHold(item.text) >= 1.3, `${name} ${duration}s "${item.text}" hold ${item.hold}`);
      assert.ok(item.time + item.hold <= model.motion.exitStart + 1e-6, `${name} ${duration}s "${item.text}" shows at ${item.time}, only ${(model.motion.exitStart - item.time).toFixed(2)} s before the exit`);
    }
    const kept = labelsOf(model).map(item => item.text);
    const all = [...params.lines.filter(line => line.label).map(line => line.label), ...(params.marks ?? []).map(mark => mark.label)];
    assert.deepEqual([...kept, ...model.content.dropped].sort(), all.sort(), `${name} ${duration}s: every label is shown or reported dropped`);
    if (model.content.note) {
      const state = at(model, model.content.buildAt + 0.45);
      assert.equal(state.get('scene-note').opacity, 1, `${name} ${duration}s: the note shows with the build`);
      assert.ok(model.content.buildAt < Math.min(...labelsOf(model).map(item => item.time), Infinity) + 1e-9, 'the note is not left to the end');
    }
  }
  // A long scene keeps every label; a very short one drops the ones it cannot hold, longest read first.
  assert.deepEqual(resolve('line-diagram', SKETCHES.stirrups, {duration: 8}).content.dropped, []);
  const short = resolve('line-diagram', SKETCHES.stirrups, {duration: 2.4});
  assert.ok(short.content.dropped.length >= 1, 'a 2.4 s scene cannot hold four labels');
  // Labels show only once their stroke has drawn.
  for (const line of resolve('line-diagram', SKETCHES.roof).content.lines) if (line.label) assert.ok(line.label.time >= line.time + line.duration * 0.5);
});

test('line-diagram: an explicit line time too late for its label is a timing error tooling can move', () => {
  const params = structuredClone(SKETCHES.roof);
  params.lines[2].at = 3.9;
  const error = `params: scenes[0] (scene): ${(() => { try { resolve('line-diagram', params); } catch (e) { return e.message; } return ''; })()}`;
  const [found] = timingErrors([error]);
  assert.ok(found, error);
  assert.equal(found.path, 'params.lines[2].at');
  assert.ok(found.max + labelHold('planned roof') <= 4.5 - 0.35 + 1e-6, `latest start ${found.max} leaves the read`);
  params.lines[2].at = found.max;
  const model = resolve('line-diagram', params);
  const label = model.content.lines[2].label;
  assert.ok(label.time + label.hold <= model.motion.exitStart + 1e-6);
});

test('line-diagram: params are checked; both renderers draw it', () => {
  assert.throws(() => resolve('line-diagram', {points: {a: [0, 0]}, lines: [{from: 'a', to: 'a'}]}), /2–16 points/);
  assert.throws(() => resolve('line-diagram', {points: {a: [0, 0], b: [1, 1]}, lines: [{from: 'a', to: 'z'}]}), /must name a point/);
  assert.throws(() => resolve('line-diagram', {points: {a: [0, 0], b: [1, 1]}, lines: [{from: 'a', to: 'b', style: 'dotted'}]}), /style/);
  assert.throws(() => resolve('line-diagram', {points: {a: [0, 0], b: [1, 1]}, lines: [{from: 'a', to: 'b'}], marks: [{point: 'q', label: 'x'}]}), /must name a point/);
  const out = EMITTERS['line-diagram'](resolve('line-diagram', SKETCHES.stirrups));
  assert.doesNotMatch(out.html + out.motion, /undefined|NaN/);
});

test('diagram layout: scheduleDraw compresses before it drops, and drops the longest read first', () => {
  const relaxed = scheduleDraw([{hold: 0}, {hold: 1.6}], {first: 0.5, lastEvent: 7, readEnd: 7.5});
  assert.deepEqual(relaxed.starts, [0.5, 1]);
  assert.equal(relaxed.draw, 0.6);
  const tight = scheduleDraw([{hold: 0}, {hold: 0}, {hold: 1.3}, {hold: 1.3}], {first: 0.5, lastEvent: 2.8, readEnd: 3.1});
  assert.deepEqual(tight.dropped, []);
  tight.labelAt.forEach((t, i) => { if (t !== null) assert.ok(t + [0, 0, 1.3, 1.3][i] <= 3.1 + 1e-9, `label ${i} at ${t}`); });
  const none = scheduleDraw([{hold: 1.3}, {hold: 1.9}], {first: 0.5, lastEvent: 1.8, readEnd: 2.1});
  assert.deepEqual(none.dropped, [1], 'the longer read goes first');
  assert.ok(none.labelAt[0] + 1.3 <= 2.1 + 1e-9);
  // placeLabel: a box over a stroke is never chosen while a clear one exists.
  const strokes = [{points: [[0, 50], [200, 50]], half: 4}];
  const spot = placeLabel({w: 60, h: 20, candidates: [{cx: 100, cy: 50, anchor: [100, 50], d: 0}, {cx: 100, cy: 74, anchor: [100, 50], d: 10}], strokes, bounds: {x: 0, y: 0, width: 200, height: 200}});
  assert.equal(spot.clear, true);
  assert.equal(spot.y, 64);
});

test('feynman-diagram: labels clear of the lines, held for a read, caption with the build', () => {
  const sketch = {variant: 'ink', title: 'Existing stirrups', caption: 'Illustrative layout, not a measured plan', points: {a: [6, 0.5], b: [6, 4.5], c: [4.5, 5.5], d: [7.5, 5.5], e: [1, 1], f: [11, 1]},
    lines: [{from: 'e', to: 'f', label: 'beam'}, {from: 'a', to: 'b', type: 'scalar', label: 'new post'}, {from: 'c', to: 'd', label: 'footing'}, {from: 'b', to: 'c', type: 'scalar', label: 'stirrup'}]};
  for (const params of [sketch, {preset: 'self-energy'}, {preset: 'exchange'}, {preset: 'annihilation'}]) for (const aspect of ['9:16', '16:9']) {
    const model = resolve('feynman-diagram', params, {aspect});
    const c = model.content;
    const strokes = c.lines.map(line => ({points: [line.ends[0], line.ends[1]], half: 2.5}));
    const boxes = c.lines.filter(line => line.labelBox).map(line => ({text: line.text, time: rtTime(model, line), box: {x: line.labelBox.x, y: line.labelBox.y, width: line.labelBox.w, height: c.labelSize * 1.2}}));
    for (const {text, box, time} of boxes) {
      if (!params.preset) assert.equal(strokesHitRect(strokes, box, 0), false, `${aspect} "${text}" overlaps a line`);
      assert.ok(time + labelHold(text) <= model.motion.exitStart + 1e-6, `${aspect} "${text}" leaves no time to read it`);
    }
    if (c.source) assert.equal(c.sourceAt, c.buildAt, 'the caption shows with the build, not after it');
  }
});

const rtTime = (model, line) => line.time + line.duration * 0.6;
