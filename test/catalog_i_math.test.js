// Catalogue I maths (kit/core/catalog-i-math.mjs): equation reveal, boxes
// and diff; title-decompose chips and glossary; feynman-diagram lines.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MODULES, catalogHTimeline, catalogHView} from '../kit/core/catalog-h.mjs';
import {frameState} from '../kit/core/catalog-b-view.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-h.mjs';
import {typesetLatex} from '../src/math/typeset.js';
import {SAMPLES} from '../scripts/element-samples.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const FORMATS = {'9:16': {width: 1080, height: 1920, fps: 30}, '16:9': {width: 1920, height: 1080, fps: 30}};
const resolve = (id, params = SAMPLES[id], aspect = '16:9') => ({...MODULES[id].resolve(params, {id: 'scene', start: 1, duration: 6, format: FORMATS[aspect], brand, aspect, hits: []}), module: id});
const at = (model, t) => frameState(catalogHTimeline(model), t);

test('equation: wipes in, reveals its term, runs the diff, then boxes the term', () => {
  const model = resolve('equation');
  assert.deepEqual(model.events.map(e => e.name), ['enter', 'build', 'term-0', 'diff', 'box-0']);
  const c = model.content;
  const term = model.events.find(e => e.name === 'term-0').time, diff = c.diffAt;
  assert.equal(at(model, term - 0.01).get('scene-l-1').opacity, 0, 'the term waits for its cue');
  const end = at(model, model.motion.exitStart - 0.01);
  assert.equal(end.get('scene-l-0').clipR, 0);
  assert.equal(end.get('scene-l-1').opacity, 1);
  assert.equal(end.get('scene-l-2').opacity, 0, 'the deleted term swaps to its red copy');
  assert.equal(end.get('scene-l-2-red').opacity, 1);
  assert.equal(end.get('scene-strike-2').scaleX, 1);
  assert.equal(end.get('scene-l-3').opacity, 1, 'the added term lands');
  assert.ok(at(model, diff - 0.01).get('scene-l-3').opacity === 0);
  assert.equal(end.get('scene-box-0').opacity, 1);
  // Glyph outlines live once in the base layer's defs, under scene-scoped ids.
  const html = EMITTERS.equation(model).html;
  assert.match(html, /<path id="scene-g-I-1D456"/);
  assert.match(html, /href="#scene-g-/);
  const box = c.boxes[0].frame, eq = c.eq;
  assert.ok(box.x >= eq.x - 20 && box.x + box.width <= eq.x + eq.width + 20, 'the box sits on the equation');
});

test('equation: typeset is required, fresh and well formed', () => {
  const r = params => resolve('equation', params);
  assert.throws(() => r({latex: 'x^2'}), /params\.typeset is missing: equations are typeset from params\.latex/);
  assert.throws(() => r({latex: 'x^3', typeset: typesetLatex('x^2')}), /params\.typeset is stale/);
  assert.throws(() => r({latex: '\\frac{', typeset: {v: 1, latex: '\\frac{', error: 'TeX error: Missing close brace'}}), /params\.latex TeX error/);
  const bad = typesetLatex('x^2');
  bad.glyphs[Object.keys(bad.glyphs)[0]] = 'M0 0"/><script>';
  assert.throws(() => r({latex: 'x^2', typeset: bad}), /must be SVG path data/);
  assert.throws(() => r({latex: 'x^2', typeset: typesetLatex('x^2'), boxes: [{mark: 0}]}), /needs a \\term, \\add or \\del mark/);
  const long = 'a+b+c+d+e+f+g+h+i+j+k+l+m+n+o+p+q+r+s+t+u+v+w+x+y+z+a+b+c+d+e+f+g+h+i+j+k+l+m+n+o+p';
  assert.throws(() => resolve('equation', {latex: long, typeset: typesetLatex(long)}, '9:16'), /too wide to set/);
});

test('title-decompose: every title word is a chip; terms light up, link down and gloss in order', () => {
  const model = resolve('title-decompose');
  const c = model.content;
  assert.equal(c.chips.length, 11);
  assert.deepEqual(c.chips.filter(chip => chip.term >= 0).map(chip => chip.word), ['Quantum', 'Gravity', 'One', 'Loop', 'Scalar', 'Self-Mass']);
  assert.deepEqual(model.events.filter(e => e.name.startsWith('term-')).map(e => e.name), ['term-0', 'term-1', 'term-2', 'term-3']);
  const cells = c.terms.map(term => term.cell.x);
  assert.equal(new Set(cells).size, 4, 'one glossary cell each');
  const end = at(model, model.motion.exitStart - 0.01);
  assert.equal(end.get('scene-link-3-m').strokeDashoffset, 0);
  assert.equal(end.get('scene-cell-3').opacity, 1);
  assert.throws(() => resolve('title-decompose', {text: 'A short title', terms: [{text: 'long', gloss: 'x'}]}), /is not a run of words/);
  assert.throws(() => resolve('title-decompose', {text: 'A short title', terms: [{text: 'short', gloss: 'x'}, {text: 'short', gloss: 'y'}]}), /is not a run of words/);
});

test('feynman-diagram: presets and custom lines draw in order, vertices pop where lines meet', () => {
  for (const preset of ['self-energy', 'exchange', 'annihilation']) {
    const model = resolve('feynman-diagram', {preset});
    const lines = model.events.filter(e => e.name.startsWith('line-'));
    assert.ok(lines.length >= 4, `${preset}: ${lines.length} lines`);
    const end = at(model, model.motion.exitStart - 0.01);
    for (const v of model.content.vertices) assert.equal(end.get(`scene-v-${v.name}`).opacity, 1);
  }
  const self = resolve('feynman-diagram', {preset: 'self-energy'});
  assert.deepEqual(self.content.vertices.map(v => v.name), ['b', 'c']);
  const exchange = resolve('feynman-diagram', {preset: 'exchange'});
  assert.ok(exchange.content.lines.filter(line => line.arrow).length === 4, 'fermions carry arrows');
  assert.ok(exchange.content.lines.find(line => line.type === 'photon').d.split('L').length > 30, 'the photon is a wave');
  const custom = resolve('feynman-diagram', {points: {a: [1, 3], b: [11, 3]}, lines: [{from: 'a', to: 'b', type: 'gluon', label: 'g'}]});
  assert.equal(custom.content.vertices.length, 0);
  assert.throws(() => resolve('feynman-diagram', {points: {a: [1, 3]}, lines: [{from: 'a', to: 'z'}]}), /must name a point/);
  assert.throws(() => resolve('feynman-diagram', {}), /needs a preset, or points and lines/);
  const ids = [];
  const walk = node => { if (node && typeof node === 'object') { if (node.id) ids.push(node.id); (node.children ?? []).forEach(walk); } };
  walk(catalogHView(exchange));
  for (const op of catalogHTimeline(exchange)) assert.ok(ids.includes(op.target), op.target);
});
