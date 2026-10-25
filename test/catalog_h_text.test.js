// Catalogue H motion titles (kit/core/catalog-h-text.mjs): the 24 named
// text effects as variants of motion-title.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MODULES, VARIANTS, catalogHTimeline} from '../kit/core/catalog-h.mjs';
import {frameState} from '../kit/core/catalog-b-view.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-h.mjs';
import {TEXT_EFFECTS} from '../kit/core/catalog-h-text.mjs';
import {SAMPLES} from '../scripts/element-samples.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const FORMATS = {'9:16': {width: 1080, height: 1920, fps: 30}, '16:9': {width: 1920, height: 1080, fps: 30}};
const resolve = (params, aspect = '9:16') => ({...MODULES['motion-title'].resolve(params, {id: 'scene', start: 1, duration: 5, format: FORMATS[aspect], brand, aspect, hits: []}), module: 'motion-title'});

test('motion-title has all 24 named effects as its variants', () => {
  const all = Object.values(TEXT_EFFECTS).flat();
  assert.equal(all.length, 24);
  assert.deepEqual([...VARIANTS['motion-title']].sort(), [...all].sort());
  assert.deepEqual(Object.fromEntries(Object.entries(TEXT_EFFECTS).map(([k, v]) => [k, v.length])), {character: 7, word: 8, line: 2, element: 7});
});

test('every effect starts hidden, builds after at, and settles unblurred with every unit in place', () => {
  for (const variant of VARIANTS['motion-title']) for (const aspect of ['9:16', '16:9']) {
    const model = resolve({...SAMPLES['motion-title'], variant}, aspect);
    const out = EMITTERS['motion-title'](model);
    assert.doesNotMatch(out.html + out.motion, /undefined|NaN/, variant);
    const ops = catalogHTimeline(model);
    const {t0, unit, counts, buildEnd} = model.content;
    const first = unit === 'character' ? 'scene-c0' : unit === 'word' ? 'scene-w0' : unit === 'line' ? 'scene-l0' : 'scene-block';
    const before = frameState(ops, t0 - 0.02).get(first);
    const hidden = before.opacity === 0 || (before.y !== undefined && Math.abs(before.y) >= model.content.size * 0.9);
    assert.ok(hidden, `${variant}: the first ${unit} is hidden before the build`);
    const settled = frameState(ops, variant === 'blur-out-up' ? buildEnd + 0.05 : model.motion.exitStart - 0.01);
    for (let i = 0; i < counts[unit]; i++) {
      const id = unit === 'character' ? `scene-c${i}` : unit === 'word' ? `scene-w${i}` : unit === 'line' ? `scene-l${i}` : 'scene-block';
      const props = settled.get(id);
      if (props.opacity !== undefined) assert.equal(props.opacity, 1, `${variant} ${id} opacity`);
      if (props.blur !== undefined) assert.equal(props.blur, 0, `${variant} ${id} blur`);
      for (const key of ['x', 'y']) if (props[key] !== undefined) assert.ok(Math.abs(props[key]) < 1e-6, `${variant} ${id} ${key}`);
      for (const key of ['scaleX', 'scaleY']) if (props[key] !== undefined) assert.ok(Math.abs(props[key] - 1) < 1e-6, `${variant} ${id} ${key}`);
    }
  }
});

test('typewriter steps whole letters; stagger-from-center opens from the middle', () => {
  const type = resolve({text: 'Hello there', variant: 'typewriter'});
  const ops = catalogHTimeline(type);
  assert.ok(!ops.some(op => op.type === 'tween' && /scene-c\d/.test(op.target)), 'no interpolated letters');
  const centre = resolve({text: 'abcdefg', variant: 'stagger-from-center'});
  const times = Object.fromEntries(catalogHTimeline(centre).filter(op => op.type === 'tween' && /^scene-c\d$/.test(op.target)).map(op => [op.target, op.start]));
  assert.ok(times['scene-c3'] < times['scene-c0'] && times['scene-c3'] < times['scene-c6']);
});

test('highlights are whole words, the title fits or fails clearly', () => {
  const model = resolve({text: 'Ship the video today', highlight: ['video']});
  assert.deepEqual(model.content.rows.flatMap(r => r.words).filter(w => w.highlight).map(w => w.text), ['video']);
  assert.throws(() => resolve({text: 'Ship the video', highlight: 'vid'}), /whole word/);
  assert.throws(() => resolve({text: Array.from({length: 17}, () => 'word').join(' ')}), /16 words/);
  assert.ok(model.hidesCaptions);
});
