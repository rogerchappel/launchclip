import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {EDITORIAL_KINDS, EDITORIAL_STYLE, EDITORIAL_SYMBOLS, resolveEditorialModule} from '../kit/core/editorial-core.mjs';
import {buildEditorialModule} from '../skills/launchclip-create-video/scripts/editorial-ui-modules.mjs';

const corpus = JSON.parse(readFileSync(new URL('./fixtures/editorial-golden.json', import.meta.url), 'utf8'));
const attempt = run => {
  try {
    return {value: run()};
  } catch (error) {
    return {error: error.message};
  }
};

test('golden corpus covers every kind with outputs and errors', () => {
  const kinds = new Set(corpus.filter(entry => entry.output).map(entry => entry.spec.kind));
  assert.deepEqual([...kinds].sort(), [...EDITORIAL_KINDS].sort());
  assert.ok(corpus.filter(entry => entry.error).length >= 150);
});

// Explicit-rect 16:9 fixtures resolve at density scale 1, so their outputs and
// errors must stay byte-identical to the corpus captured before the density
// change (sha256 of the subset as it stood at dacadc4). The 9:16 and
// default-rect fixtures were regenerated for content-derived rects and the
// portrait type scale.
const EXPLICIT_16X9_SHA256 = '0767cad85d2becb1f24cdebe2ef51b7494267c56f99e639acfa7b12d7a8fff33';
const explicit16x9 = entry => entry.spec && typeof entry.spec === 'object' && !Array.isArray(entry.spec) && entry.spec.aspect === '16:9' && entry.spec.rect !== undefined;

test('explicit-rect 16:9 golden outputs are unchanged by the density work', () => {
  const subset = corpus.filter(explicit16x9);
  assert.equal(subset.length, 656);
  assert.equal(createHash('sha256').update(JSON.stringify(subset)).digest('hex'), EXPLICIT_16X9_SHA256);
  for (const entry of subset) {
    const result = attempt(() => buildEditorialModule(entry.spec));
    if (entry.error !== undefined) assert.equal(result.error, entry.error, entry.name);
    else assert.equal(JSON.stringify(result.value), JSON.stringify(entry.output), entry.name);
  }
});

test('HyperFrames emitter output is byte-identical to the golden corpus', () => {
  for (const entry of corpus) {
    const result = attempt(() => buildEditorialModule(entry.spec));
    if (entry.error !== undefined) assert.equal(result.error, entry.error, entry.name);
    else {
      assert.equal(result.error, undefined, entry.name);
      assert.equal(JSON.stringify(result.value), JSON.stringify(entry.output), entry.name);
    }
  }
});

test('resolved model events and layout match the emitter for every fixture', () => {
  for (const entry of corpus) {
    const model = attempt(() => resolveEditorialModule(entry.spec));
    if (entry.error !== undefined) {
      assert.equal(model.error, entry.error, entry.name);
      continue;
    }
    const emitted = buildEditorialModule(entry.spec);
    assert.deepEqual(model.value.events, emitted.events, entry.name);
    assert.deepEqual(model.value.layout, emitted.layout, entry.name);
  }
});

test('resolved model fills the contract fields for every valid fixture', () => {
  for (const entry of corpus.filter(item => item.output)) {
    const model = resolveEditorialModule(entry.spec);
    assert.equal(model.id, entry.spec.id, entry.name);
    assert.equal(model.end, model.start + model.duration, entry.name);
    for (const key of ['surface', 'foreground', 'muted', 'border', 'accentText']) assert.match(model.theme[key], /^#[0-9a-fA-F]{6}$/, `${entry.name} theme.${key}`);
    assert.ok(['solid', 'glass'].includes(model.presentation), entry.name);
    for (const key of ['enter', 'exit', 'distance', 'scale', 'enterStart', 'enterEnd', 'exitStart', 'end']) assert.notEqual(model.motion[key], undefined, `${entry.name} motion.${key}`);
    assert.equal(model.motion.enterEase, 'power3.out');
    assert.equal(model.motion.exitEase, 'power2.in');
    assert.equal(model.motion.enterStart, model.start);
    assert.equal(model.motion.end, model.end);
    assert.ok(model.content && typeof model.content === 'object', entry.name);
    assert.doesNotThrow(() => JSON.stringify(model), entry.name);
    assert.deepEqual(model.rect, {x: model.layout.rect.x, y: model.layout.rect.y, width: model.layout.rect.width, height: model.layout.rect.height});
  }
});

test('resolved content carries renderer-ready values', () => {
  const metric = resolveEditorialModule(corpus.find(entry => entry.name === 'metric-number').spec);
  assert.equal(metric.content.initialText, '12');
  assert.equal(metric.content.values[1].frames.length, 19);
  assert.equal(metric.content.values[1].frames.at(-1).text, '180');
  assert.equal(metric.content.attribution, 'Illustration · example values');
  const chart = resolveEditorialModule(corpus.find(entry => entry.name === 'trend-chart-data').spec);
  assert.deepEqual(chart.content.points.map(point => point.from), [0, 12, 36]);
  assert.equal(chart.content.points[1].barHeight, 180);
  assert.equal(chart.content.points[1].bar.y + chart.content.points[1].bar.height, chart.content.points[0].bar.y + chart.content.points[0].bar.height);
  const code = resolveEditorialModule(corpus.find(entry => entry.name === 'code-snippet-typing').spec);
  assert.equal(code.content.lines[0].charTimes.length, code.content.lines[0].characters);
  assert.equal(code.content.lines[0].endTime, code.content.lines[0].time + code.content.lines[0].typeDuration);
  const excerpt = resolveEditorialModule(corpus.find(entry => entry.name === 'excerpt-sweep').spec);
  assert.equal(excerpt.content.highlight.motion, 'sweep');
  assert.equal(excerpt.content.highlight.endTime, excerpt.content.focus.time + .35);
  const focus = resolveEditorialModule(corpus.find(entry => entry.name === 'focus-horizontal').spec);
  assert.equal(focus.content.target.x, 407.25);
  assert.equal(focus.content.icon, 'terminal');
  assert.ok(EDITORIAL_SYMBOLS[focus.content.icon].startsWith('<rect'));
  const rack = resolveEditorialModule(corpus.find(entry => entry.name === 'status-rack/theme').spec);
  assert.equal(rack.content.lightOff, '#9B8769');
  const plain = resolveEditorialModule(corpus.find(entry => entry.name === 'step-rail').spec);
  assert.equal(plain.customTheme, false);
  assert.equal(plain.content.activeColor, plain.accent);
});

test('editorial core is import-free and the skill copy matches kit/core byte for byte', () => {
  const canonical = readFileSync(new URL('../kit/core/editorial-core.mjs', import.meta.url), 'utf8');
  const copy = readFileSync(new URL('../skills/launchclip-create-video/scripts/editorial-core.mjs', import.meta.url), 'utf8');
  assert.equal(copy, canonical);
  assert.doesNotMatch(canonical, /^\s*import\b|\bimport\(|\brequire\(/m);
  assert.equal(EDITORIAL_KINDS.length, 14);
  assert.equal(EDITORIAL_STYLE.space.pad, 24);
  assert.ok(Object.isFrozen(EDITORIAL_STYLE) && Object.isFrozen(EDITORIAL_SYMBOLS));
});
