// Catalogue H motion titles (kit/core/catalog-h-text.mjs): the 24 named
// text effects as variants of motion-title.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MODULES, VARIANTS, catalogHTimeline} from '@launchclip/core/catalog-h.mjs';
import {frameState} from '@launchclip/core/catalog-b-view.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-h.mjs';
import {TEXT_EFFECTS} from '@launchclip/core/catalog-h-text.mjs';
import {SAMPLES} from '../scripts/element-samples.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const FORMATS = {'9:16': {width: 1080, height: 1920, fps: 30}, '16:9': {width: 1920, height: 1080, fps: 30}};
const resolve = (params, aspect = '9:16') => ({...MODULES['motion-title'].resolve(params, {id: 'scene', start: 1, duration: 5, format: FORMATS[aspect], brand, aspect, hits: []}), module: 'motion-title'});

test('motion-title has the 24 named effects and scramble as its variants', () => {
  const all = Object.values(TEXT_EFFECTS).flat();
  assert.equal(all.length, 25);
  assert.deepEqual([...VARIANTS['motion-title']].sort(), [...all].sort());
  assert.deepEqual(Object.fromEntries(Object.entries(TEXT_EFFECTS).map(([k, v]) => [k, v.length])), {character: 8, word: 8, line: 2, element: 7});
});

test('scramble: glyphs from the charset, fixed by frame, locking left to right', () => {
  const model = resolve({text: 'Ship it', variant: 'scramble', charset: 'hex'});
  const ops = catalogHTimeline(model);
  const glyphs = ops.filter(op => op.type === 'set' && /^scene-c\d+-g$/.test(op.target) && op.props.text).map(op => op.props.text);
  assert.ok(glyphs.length > 10 && glyphs.every(g => '0123456789ABCDEF'.includes(g)));
  assert.deepEqual(catalogHTimeline(resolve({text: 'Ship it', variant: 'scramble', charset: 'hex'})), ops, 'seeded: the same title scrambles the same way');
  const lock = i => ops.find(op => op.target === `scene-c${i}-r` && op.props.opacity === 1).time;
  assert.ok(lock(0) < lock(1) && lock(1) < lock(5));
  // Seek purity: a mid-build frame alone equals the same frame after others.
  const t = model.content.t0 + 0.2;
  assert.deepEqual(frameState(ops, t).get('scene-c3-g'), (frameState(ops, t + 1), frameState(ops, t)).get('scene-c3-g'));
  assert.throws(() => resolve({text: 'Ship it', variant: 'typewriter', charset: 'hex'}), /only for the scramble/);
  assert.throws(() => resolve({text: 'Ship it', variant: 'scramble', charset: 'kanji'}), /charset/);
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

test('a mark is drawn over the highlighted words once the title has built, the same stroke every time', async () => {
  const {MARK_KINDS, roughMark} = await import('@launchclip/core/rough-mark.mjs');
  for (const kind of MARK_KINDS) {
    const a = roughMark(kind, {width: 420, height: 160, seed: 'x'}), b = roughMark(kind, {width: 420, height: 160, seed: 'x'});
    assert.deepEqual(a, b, `${kind} is the same for the same seed`);
    assert.notDeepEqual(roughMark(kind, {width: 420, height: 160, seed: 'y'}).paths, a.paths, `${kind} differs with the seed`);
    assert.equal(a.paths.length, kind === 'bracket' ? 2 : 1);
    for (const path of a.paths) {
      assert.match(path.d, /^M-?[\d.]+ -?[\d.]+( [QL]-?[\d.]+ -?[\d.]+( -?[\d.]+ -?[\d.]+)?)+$/, kind);
      const numbers = path.d.match(/-?[\d.]+/g).map(Number);
      // Drawn round the words: never further out than one line height.
      assert.ok(numbers.every(n => Number.isFinite(n) && n > -200 && n < 420 + 200), `${kind} stays by its words`);
    }
  }
  assert.throws(() => roughMark('squiggle', {width: 10, height: 10}), /unknown mark/);
  // On a title: adjacent highlighted words share one mark; the stroke starts hidden and is drawn by the exit.
  const model = resolve({text: 'Ship the video today', highlight: ['the', 'video'], mark: 'circle'}, '16:9');
  const {marks, buildEnd} = model.content;
  assert.equal(marks.length, 1);
  assert.deepEqual([marks[0].from, marks[0].to, marks[0].kind], [1, 2, 'circle']);
  const out = EMITTERS['motion-title'](model);
  assert.match(out.html, /<svg[^>]*preserveAspectRatio="none"[^>]*>\s*<path id="scene-m0-0"/);
  assert.doesNotMatch(out.html + out.motion, /undefined|NaN/);
  const ops = catalogHTimeline(model);
  assert.equal(frameState(ops, buildEnd - 0.2).get('scene-m0-0').strokeDashoffset, 1);
  assert.equal(frameState(ops, model.motion.exitStart - 0.01).get('scene-m0-0').strokeDashoffset, 0);
  // Words apart get a mark each, one after the other; the marked words keep the ink colour.
  const two = resolve({text: 'Ship the video today', highlight: ['ship', 'today'], mark: 'marker'});
  assert.equal(two.content.marks.length, 2);
  assert.ok(two.content.marks[1].at > two.content.marks[0].at);
  assert.doesNotMatch(EMITTERS['motion-title'](two).html, new RegExp(`color:${two.content.accent}[^>]*>Ship`));
  // A masked row would clip a circle: it is an underline there. No mark, no change to the title.
  assert.equal(resolve({text: 'Ship the video', highlight: 'video', mark: 'circle', variant: 'mask-reveal-up'}).content.marks[0].kind, 'underline');
  assert.equal(resolve({text: 'Ship the video', highlight: 'video'}).content.marks, undefined);
  assert.throws(() => resolve({text: 'Ship the video', mark: 'circle'}), /needs params.highlight/);
  assert.throws(() => resolve({text: 'Ship the video', highlight: 'video', mark: 'squiggle'}), /params.mark/);
});
