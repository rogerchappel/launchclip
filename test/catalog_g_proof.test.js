// Catalogue G proof cards (kit/core/catalog-g-proof.mjs): stat-card,
// quote-card and excerpt show real material only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MODULES, catalogGTimeline, catalogGView} from '@launchclip/core/catalog-g.mjs';
import {parseFigure} from '@launchclip/core/catalog-g-proof.mjs';
import {frameState} from '@launchclip/core/catalog-b-view.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-g.mjs';
import {knownModules} from '@launchclip/core/modules.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const LANDSCAPE = {width: 1920, height: 1080, fps: 30, duration: 30};
const ctx = (overrides = {}) => ({id: 'scene', start: 1, duration: 4, format: {width: 1080, height: 1920, fps: 30, duration: 30}, brand, aspect: '9:16', hits: [], ...overrides});
const resolve = (id, params, overrides) => ({...MODULES[id].resolve(params, ctx(overrides)), module: id});
const text = (state, target) => state.get(target)?.text;

const STAT = {value: '$1,240.5', label: 'saved per launch', source: 'Ledgerly finance report, 2026'};
const QUOTE = {quote: 'It turned a four-hour edit into a coffee break.', author: 'Ada Park', role: 'Founder, Ledgerly', highlight: 'a coffee break'};
const EXCERPT = {type: 'code', title: 'package.json', source: 'github.com/acme/app', lines: ['"scripts": {', {text: '  "video": "launchclip make",', highlight: true}, '}']};

test('the proof cards are registered in both renderers', () => {
  for (const id of ['stat-card', 'quote-card', 'excerpt']) {
    assert.ok(knownModules().includes(id), id);
    assert.ok(EMITTERS[id], id);
  }
});

test('stat-card counts up to the exact figure as written, and needs a real source', () => {
  assert.deepEqual(parseFigure('$1,240.5k'), {prefix: '$', number: 1240.5, decimals: 1, grouped: true, suffix: 'k'});
  assert.equal(parseFigure('n/a'), null);
  const model = resolve('stat-card', STAT);
  const ops = catalogGTimeline(model);
  assert.equal(text(frameState(ops, model.content.t0 + 0.3), 'scene-value').startsWith('$'), true);
  assert.match(text(frameState(ops, model.content.t0 + 0.3), 'scene-value'), /^\$\d{1,3}(,\d{3})*\.\d$/, 'keeps the grouping and decimals while counting');
  assert.equal(text(frameState(ops, model.content.hitAt + 0.01), 'scene-value'), '$1,240.5', 'lands on the value as written');
  assert.equal(frameState(ops, model.motion.exitStart - 0.05).get('scene-source').opacity, 1, 'the source shows');
  assert.ok(catalogGView(model).children.length);
  assert.equal(resolve('stat-card', {...STAT, value: '3×'}).content.count, true);
  assert.equal(resolve('stat-card', {...STAT, value: '#1', count: false}).content.samples.length, 0);
  assert.throws(() => resolve('stat-card', {value: '87%', label: 'x'}), /source.*is required/);
  for (const source of ['Source', 'TBD', 'illustrative', 'n/a', 'example']) assert.throws(() => resolve('stat-card', {...STAT, source}), /must name where the figure comes from/, source);
  assert.throws(() => resolve('stat-card', {...STAT, value: 'lots'}), /at least one digit/);
});

test('quote-card needs a named attribution and lights up an exact phrase', () => {
  const model = resolve('quote-card', QUOTE);
  assert.deepEqual(model.content.parts, ['It turned a four-hour edit into ', 'a coffee break', '.']);
  const ops = catalogGTimeline(model);
  assert.ok(model.content.highlightAt > model.content.authorAt);
  assert.equal(frameState(ops, model.content.authorAt - 0.01).get('scene-highlight').opacity, 0);
  assert.equal(frameState(ops, model.content.highlightAt + 0.4).get('scene-highlight').opacity, 1);
  const html = EMITTERS['quote-card'](model).html;
  assert.match(html, /<span style="[^"]*background:#fdb022[^"]*">a coffee break<\/span>/);
  for (const author of ['Anonymous', 'a customer', 'Happy customer', 'our users', 'Someone']) assert.throws(() => resolve('quote-card', {...QUOTE, author}), /needs a real attribution/, author);
  assert.throws(() => resolve('quote-card', {...QUOTE, highlight: 'a nap'}), /must be a part of params\.quote/);
  assert.equal(resolve('quote-card', {quote: '"Fast."', author: 'The Verge'}).content.quote, 'Fast.', 'outer quote marks drop; the mark draws them');
});

test('excerpt shows the supplied lines verbatim, reveals them in turn and sweeps the marked ones', () => {
  const model = resolve('excerpt', EXCERPT);
  assert.deepEqual(model.content.lines.map(line => line.text), ['"scripts": {', '  "video": "launchclip make",', '}']);
  const ops = catalogGTimeline(model);
  const times = model.content.lines.map(line => line.time);
  assert.ok(times.every((t, i) => i === 0 || t > times[i - 1]));
  const late = frameState(ops, model.content.highlightAt + 0.5);
  assert.equal(late.get('scene-mark-1').scaleX, 1);
  assert.equal(late.get('scene-line-0').opacity, 0.45, 'unmarked lines dim');
  assert.equal(late.get('scene-line-1').opacity, 1);
  assert.match(EMITTERS.excerpt(model).html, /white-space:pre/);
  assert.throws(() => resolve('excerpt', {...EXCERPT, source: undefined}), /source.*is required/);
  assert.throws(() => resolve('excerpt', {...EXCERPT, lines: ['Lorem ipsum dolor sit amet']}), /placeholder/);
  assert.throws(() => resolve('excerpt', {...EXCERPT, type: 'code', lines: ['x'.repeat(60)]}), /does not fit 1 line/);
  assert.throws(() => resolve('excerpt', {lines: ['a'], source: 'README', highlightAt: 2}), /needs a line with highlight/);
  // Landscape fits long code lines.
  assert.equal(resolve('excerpt', {...EXCERPT, lines: ['const story = await plan(brief, {lane: "motion"});']}, {format: LANDSCAPE, aspect: '16:9'}).minTextPx >= 44, true);
});

test('the proof cards keep key text legible in every placement', () => {
  for (const [id, params] of [['stat-card', STAT], ['quote-card', QUOTE], ['excerpt', EXCERPT]]) {
    for (const overrides of [{}, {format: LANDSCAPE, aspect: '16:9'}, ...(id === 'excerpt' ? [] : [{lane: 'footage-led', format: LANDSCAPE, aspect: '16:9'}])]) {
      const model = resolve(id, params, overrides);
      assert.ok(model.minTextPx >= 44, `${id} ${model.placement}`);
    }
  }
});

test('the phrase table suggests each proof card for its intent', async () => {
  const {suggestModules} = await import('@launchclip/core/planning-prompt.mjs');
  const lines = {'stat-card': 'It saves teams 87% of their editing time.', 'quote-card': 'As Ada put it, "this replaced our whole video workflow."', 'excerpt': 'Here is the one line in the README that matters.'};
  for (const [id, sentence] of Object.entries(lines)) for (const lane of ['motion', 'footage-led'])
    assert.ok(suggestModules(sentence, {lane})[0]?.modules.includes(id), `${id} in ${lane}`);
});
