// Code evidence (kit/core/catalog-i-code.mjs, catalog-i-terminal.mjs):
// repo-pr-card, commit-card, diff-view, evidence-chain, date-pinned-timeline
// and terminal-session; their params, token boxes, timing, both renderers'
// output and the settled frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MODULES, VARIANTS, catalogHTimeline, catalogHView} from '../kit/core/catalog-h.mjs';
import {CODE_ADVANCE, codeFont, cropLine, parseLines} from '../kit/core/catalog-i-code-base.mjs';
import {makeCheck} from '../kit/core/catalog-b-base.mjs';
import {frameState} from '../kit/core/catalog-b-view.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-h.mjs';
import {hyperframesEmitters} from '../kit/hyperframes/story-compiler.mjs';
import {knownModules} from '../kit/core/modules.mjs';
import {EXTRA_SAMPLES, SAMPLES} from '../scripts/element-samples.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const light = {colors: {bg: '#f5f1e8', primary: '#b7791f', accent: '#1f6feb', ink: '#f5f1e8', paper: '#14161c'}, fonts: brand.fonts};
const FORMATS = {'9:16': {width: 1080, height: 1920, fps: 30}, '16:9': {width: 1920, height: 1080, fps: 30}};
const ctx = (aspect = '16:9', overrides = {}) => ({id: 'scene', start: 1, duration: 8, format: FORMATS[aspect], brand, aspect, hits: [], ...overrides});
const resolve = (id, params = SAMPLES[id], aspect, overrides) => ({...MODULES[id].resolve(params, ctx(aspect, overrides)), module: id});
const settled = model => frameState(catalogHTimeline(model), model.motion.exitStart - 0.01);
const IDS = ['repo-pr-card', 'commit-card', 'diff-view', 'evidence-chain', 'date-pinned-timeline', 'terminal-session'];

test('the code-evidence modules are registered in the registry, both renderers and the samples', () => {
  const remotion = readFileSync(new URL('../kit/remotion/catalog/CatalogH.tsx', import.meta.url), 'utf8');
  assert.match(remotion, /Object\.keys\(MODULES\)/, 'Remotion draws every catalogue H module from the shared tree');
  for (const id of IDS) {
    assert.ok(knownModules().includes(id), id);
    assert.ok(EMITTERS[id] && hyperframesEmitters()[id], id);
    assert.ok(SAMPLES[id], id);
    assert.ok(MODULES[id].events.includes('build'), id);
  }
  assert.deepEqual([...VARIANTS['repo-pr-card']], ['glass', 'github']);
  assert.deepEqual([...VARIANTS['date-pinned-timeline']], ['axis', 'summary']);
  assert.deepEqual([...VARIANTS['terminal-session']], ['glass', 'solid']);
});

test('every variant resolves in both aspects, on dark and light brands, with the same ids in both renderers', () => {
  for (const id of IDS) for (const variant of VARIANTS[id]) for (const aspect of ['9:16', '16:9']) for (const b of [brand, light]) {
    const label = `${id}/${variant} ${aspect} ${b.colors.bg}`;
    const model = resolve(id, {...SAMPLES[id], variant}, aspect, {brand: b});
    const out = EMITTERS[id](model);
    assert.doesNotMatch(out.html + out.motion, /undefined|NaN/, label);
    assert.ok(model.minTextPx >= 44 - 1e-6, `${label} key text ${model.minTextPx}`);
    for (const [target, props] of settled(model)) if (props.clipR !== undefined) assert.equal(props.clipR, 0, `${label}: ${target} still clipped`);
    const ids = [];
    const walk = node => { if (node && typeof node === 'object') { if (node.id) ids.push(node.id); (node.children ?? []).forEach(walk); } };
    walk(catalogHView(model));
    for (const target of new Set(catalogHTimeline(model).map(op => op.target))) assert.ok(ids.includes(target), `${label}: op target ${target} is in the view`);
    for (const nodeId of ids) assert.ok(out.html.includes(`id="${nodeId}"`), `${label}: ${nodeId} in the HyperFrames HTML`);
  }
  for (const extra of EXTRA_SAMPLES.filter(e => IDS.includes(e.module))) {
    const model = resolve(extra.module, {...extra.params, variant: extra.variant}, extra.shape === 'portrait' ? '9:16' : '16:9');
    assert.doesNotMatch(JSON.stringify(EMITTERS[extra.module](model)), /undefined|NaN/, extra.name);
  }
});

test('cards stay inside their rect, and every code size keeps the meta floor', () => {
  for (const id of IDS) for (const aspect of ['9:16', '16:9']) {
    const model = resolve(id, SAMPLES[id], aspect);
    const c = model.content;
    const boxes = c.cards ?? (c.card ? [{...c.card, x: c.x, y: c.y}] : [{x: c.x, y: c.y, w: c.W, h: c.H}]);
    for (const box of boxes) {
      const w = box.w * (box.scale ?? 1), h = box.h * (box.scale ?? 1);
      assert.ok(box.x >= -0.01 && box.y >= -0.01 && box.x + w <= model.rect.width + 0.01 && box.y + h <= model.rect.height + 0.01, `${id} ${aspect}: ${JSON.stringify({x: box.x, y: box.y, w, h})}`);
      if (box.code && box.scale === undefined) assert.ok(box.code.size >= 26 - 1e-6, `${id} ${aspect} code ${box.code.size}`);
    }
  }
});

test('parseLines reads unified-diff lines, numbers them and drops the common indent', () => {
  const rows = parseLines(makeCheck('t: '), ['@@ -13,3 +13,3 @@ defaults:', '   runs: 5', '-  model: sol', '+  model: terra', '   timeout: 10m'], 'params.lines');
  assert.deepEqual(rows.map(r => [r.type, r.old, r.new, r.text]), [['hunk', null, null, '@@ -13,3 +13,3 @@ defaults:'], ['ctx', 13, 13, 'runs: 5'], ['del', 14, null, 'model: sol'], ['add', null, 14, 'model: terra'], ['ctx', 15, 15, 'timeout: 10m']]);
  assert.throws(() => parseLines(makeCheck('t: '), ['a\nb'], 'params.lines'), /must be one line/);
  assert.deepEqual(cropLine('abcdefghijklmnopqrstuvwxyz', 10, [20, 23]), {text: '…stuvwxyz', shift: 17});
});

test('repo-pr-card: real PR data, the state chip, and the token box on its own cue', () => {
  const model = resolve('repo-pr-card');
  const c = model.content, card = c.card;
  assert.equal(c.variant, 'glass');
  assert.deepEqual(model.events.map(e => e.name), ['enter', 'build', 'highlight']);
  assert.ok(card.items.some(it => it.t === 'chip' && it.v === 'Merged'));
  assert.ok(card.items.some(it => it.t === 'text' && it.v === 'rogerchappel merged on Jul 17, 2026'));
  // The long line is cropped round the token, which still lands on its glyphs.
  const box = card.code.tokens[0], row = card.code.rows[box.row];
  assert.ok(row.text.startsWith('…'));
  assert.equal(row.text.slice(box.col, box.col + 'openrouter/free'.length), 'openrouter/free');
  assert.equal(card.code.adv, Math.round(card.code.size * CODE_ADVANCE * 100) / 100);
  assert.ok(c.highlightAt > c.buildEnd, 'the box draws after the rows land');
  const state = settled(model);
  assert.equal(state.get('scene-card-tkr-0').strokeDashoffset, 0);
  assert.equal(frameState(catalogHTimeline(model), c.highlightAt - 0.01).get('scene-card-tkr-0').strokeDashoffset, 1);
  // A word anchor (hit) times the highlight.
  assert.equal(resolve('repo-pr-card', SAMPLES['repo-pr-card'], '16:9', {hits: [{event: 'highlight', at: 6}]}).content.highlightAt, 6);
  assert.throws(() => resolve('repo-pr-card', {...SAMPLES['repo-pr-card'], highlight: 'gpt-9'}), /token "gpt-9" is not in any line/);
  assert.throws(() => resolve('repo-pr-card', {...SAMPLES['repo-pr-card'], repo: 'launchclip'}), /params\.repo must be "owner\/name"/);
  assert.throws(() => resolve('repo-pr-card', {...SAMPLES['repo-pr-card'], date: '2026-02-30'}), /params\.date must be a date/);
});

test('commit-card: short sha, co-authors and up to three token boxes in sequence', () => {
  const model = resolve('commit-card', {...SAMPLES['commit-card'], verified: true, highlight: ['gpt-5.5', 'o4-mini']});
  const card = model.content.card;
  assert.ok(card.items.some(it => it.t === 'chip' && it.v === 'c3ec4a1'));
  assert.ok(card.items.some(it => it.t === 'chip' && it.v === 'Verified'));
  assert.ok(card.items.some(it => it.t === 'text' && it.v === 'rogerchappel and Claude Fable 5 authored on Jun 13, 2026'));
  assert.equal(card.items.filter(it => it.t === 'avatar').length, 2);
  assert.deepEqual(card.code.tokens.map(t => card.code.rows[t.row].type), ['add', 'del'], 'an added row first, then a removed one');
  const ops = catalogHTimeline(model);
  const starts = [0, 1].map(k => ops.find(op => op.type === 'tween' && op.target === `scene-card-tkr-${k}`).start);
  assert.ok(Math.abs(starts[1] - starts[0] - 0.35) < 1e-6);
  assert.throws(() => resolve('commit-card', {...SAMPLES['commit-card'], sha: 'xyz'}), /params\.sha must be a 7–40 character hex sha/);
});

test('diff-view: the focus ring steps through its states and the other rows dim', () => {
  const model = resolve('diff-view');
  const c = model.content;
  assert.deepEqual(model.events.map(e => e.name), ['enter', 'build', 'focus-0', 'highlight', 'focus-1', 'focus-2']);
  const ops = catalogHTimeline(model);
  const at = t => frameState(ops, t);
  const mid = at(c.focus[1].time + 0.5);
  assert.equal(mid.get('scene-ring-1').opacity, 1);
  assert.equal(mid.get('scene-ring-0').opacity, 0);
  for (let r = 0; r < c.card.code.rows.length; r++) assert.equal(mid.get(`scene-card-row-${r}`).opacity, r >= 4 && r <= 6 ? 1 : 0.3, `row ${r}`);
  // The ring slides from the last state's rows: it starts at their offset and height.
  const slide = ops.find(op => op.type === 'tween' && op.target === 'scene-ring-1');
  assert.ok(Math.abs(slide.from.y - (c.focus[0].top - c.focus[1].top)) < 0.01);
  assert.ok(Math.abs(slide.from.scaleY - c.focus[0].height / c.focus[1].height) < 1e-3);
  assert.equal(resolve('diff-view', {...SAMPLES['diff-view'], focus: [{line: 94}]}).content.focus[0].a, 7, 'line picks the new-file line');
  assert.throws(() => resolve('diff-view', {...SAMPLES['diff-view'], focus: [{row: 1, line: 3}]}), /exactly one of row, rows/);
  assert.throws(() => resolve('diff-view', {...SAMPLES['diff-view'], focus: [{line: 500}]}), /500 is not a new-file line/);
});

test('evidence-chain: one source at a time, each token joined to the last by a connector', () => {
  for (const aspect of ['16:9', '9:16']) {
    const model = resolve('evidence-chain', SAMPLES['evidence-chain'], aspect);
    const c = model.content;
    assert.deepEqual(model.events.map(e => e.name).filter(n => n !== 'enter'), ['build', 'source-0', 'source-1', 'link-1', 'source-2', 'link-2']);
    assert.equal(c.links.length, 2);
    c.timing.forEach((tm, i) => { if (i) assert.ok(tm.at > c.timing[i - 1].at && tm.linkAt > tm.tokenAt, `${aspect} source ${i}`); });
    assert.ok(c.timing.at(-1).linkAt + 0.6 <= model.motion.exitStart + 1e-6, 'the last connector lands before the exit');
    // Each connector runs from one token box to the next.
    c.links.forEach((link, k) => {
      const [a, z] = [c.cards[k], c.cards[k + 1]];
      const end = {x: link.box.x + link.b.x, y: link.box.y + link.b.y};
      const t = z.tokens[0];
      assert.ok(end.x >= z.x + t.x - 1 && end.x <= z.x + t.x + t.w + 1 && end.y >= z.y + t.y - 1 && end.y <= z.y + t.y + t.h + 1, `${aspect} link ${k + 1} ends on the token`);
      assert.ok(a.tokens.length);
    });
    const state = frameState(catalogHTimeline(model), c.timing[1].at - 0.01);
    assert.equal(state.get('scene-s1').opacity, 0, 'the second source is not on screen before its cue');
    assert.equal(settled(model).get('scene-link-2').clipB ?? settled(model).get('scene-link-2').clipR, 0);
  }
  const announcement = EXTRA_SAMPLES.find(e => e.name === 'evidence-chain-announcement');
  const model = resolve('evidence-chain', announcement.params);
  const line = model.content.cards[1].items.find(it => it.t === 'tline');
  assert.equal(line.before, 'openrouter:');
  assert.equal(line.token, 'openrouter/free');
  assert.throws(() => resolve('evidence-chain', {sources: SAMPLES['evidence-chain'].sources}), /highlight is required \(or params\.token\)/);
});

test('date-pinned-timeline: the playhead scrubs to each date as its card pins and stacks', () => {
  const model = resolve('date-pinned-timeline');
  const c = model.content;
  assert.equal(c.ticks.length, 7);
  assert.deepEqual(c.pins.map(p => p.day), [2, 3, 4]);
  c.cards.forEach((card, i) => {
    assert.ok(c.pins[i].x >= card.x && c.pins[i].x <= card.x + card.w, `pin ${i} meets its card`);
    if (i) assert.ok(card.y > c.cards[i - 1].y, 'later cards stack lower');
  });
  const ops = catalogHTimeline(model);
  const head = t => frameState(ops, t).get('scene-head').x;
  c.pins.forEach(pin => assert.ok(Math.abs(head(pin.at) - (pin.x - c.pad)) < 0.01, 'the playhead reaches the date as the card pins'));
  assert.throws(() => resolve('date-pinned-timeline', {...SAMPLES['date-pinned-timeline'], to: '2026-07-15'}), /must fall between params\.from and params\.to/);
  assert.throws(() => resolve('date-pinned-timeline', {...SAMPLES['date-pinned-timeline'], title: 'why now?'}), /summary variant only/);
  const summary = resolve('date-pinned-timeline', {...SAMPLES['date-pinned-timeline'], variant: 'summary'});
  assert.equal(summary.content.subtitle.text, '3 clues in 7 days');
  assert.deepEqual(summary.content.dots.map(d => d.lit >= 0), [false, false, true, true, true, false, false]);
});

test('terminal-session: commands type, output streams, the timer fast-forwards and the box draws', () => {
  const model = resolve('terminal-session');
  const c = model.content;
  const ops = catalogHTimeline(model);
  const at = t => frameState(ops, t);
  const s0 = c.steps[0];
  const half = at((s0.time + s0.typeEnd) / 2);
  const typed = [0, 1, 2].map(g => half.get(`scene-ty-0-${g}`)?.text ?? '').join('');
  assert.ok(typed.length > 0 && 'git clone https://github.com/rogerchappel/launchclip.git'.startsWith(typed) && typed.length < 50, `half typed: ${typed}`);
  const done = at(c.end + 0.01);
  assert.equal([0, 1, 2].map(g => done.get(`scene-ty-0-${g}`).text).join(''), 'git clone https://github.com/rogerchappel/launchclip.git');
  assert.equal(done.get('scene-ty-0-1').text, 'rogerchappel/launchclip', 'the highlighted token is its own span');
  // Output rows appear in order, after their command.
  const rows = c.lines.filter(l => l.kind === 'out');
  for (let k = 1; k < rows.length; k++) assert.ok(rows[k].time >= rows[k - 1].time);
  assert.ok(rows.every(r => r.time > c.steps[r.step].typeEnd));
  assert.equal(done.get('scene-clock').text, '1:35');
  assert.equal(at(c.timer.start - 0.01).get('scene-clock').text, '0:00');
  assert.equal(settled(model).get('scene-hlr').strokeDashoffset, 0);
  // Long runs scroll the window.
  const many = resolve('terminal-session', {steps: [{cmd: 'python3 run_all.py', output: Array.from({length: 24}, (_, k) => ({status: 'PASS', time: `${k}.0 s`, text: `check_${k}.py`}))}]}, '16:9', {duration: 9});
  assert.ok(many.content.scroll.length > 0);
  assert.ok(frameState(catalogHTimeline(many), many.content.end).get('scene-scroll').y < 0);
  assert.throws(() => resolve('terminal-session', {steps: [{cmd: 'ls'}], highlight: 'nope'}), /token "nope" is in no command/);
  assert.throws(() => resolve('terminal-session', {steps: [{cmd: 'ls', output: [{status: 'MAYBE', text: 'x'}]}]}), /status must be one of/);
});

test('code text uses a registered monospace face with a 0.6 em advance', () => {
  assert.match(codeFont({meta: "'JetBrains Mono', monospace"}), /JetBrains Mono/);
  assert.match(codeFont({meta: "'Space Grotesk', sans-serif"}), /^'JetBrains Mono'/, 'a proportional meta font falls back to JetBrains Mono');
});

test('the planner maps receipt lines to the code-evidence modules and states the real-data rule', async () => {
  const {suggestModules, storyboardModulesReference} = await import('../kit/core/planning-prompt.mjs');
  const pick = sentence => suggestModules(sentence)[0].modules;
  assert.ok(pick('They merged pull request #39217 on Oct 16.').includes('repo-pr-card'));
  assert.ok(pick('A commit co-authored by Copilot swapped the model.').includes('commit-card'));
  assert.ok(pick('The same model name shows up again in three repos.').includes('evidence-chain'));
  assert.ok(pick('Why now? Three clues in 9 days.').includes('date-pinned-timeline'));
  assert.ok(pick('Clone the repo, pip install, and all 38 scripts pass.').includes('terminal-session'));
  const reference = storyboardModulesReference();
  assert.match(reference, /## Code evidence \(the receipt\)/);
  assert.match(reference, /node src\/evidence\/github\.js/);
  assert.match(reference, /### evidence-chain \(keeps captions\)/);
});
