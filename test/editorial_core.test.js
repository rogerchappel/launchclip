import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {EDITORIAL_KINDS, EDITORIAL_STYLE, EDITORIAL_SYMBOLS, resolveEditorialModule, statusContrast} from '@launchclip/core/editorial-core.mjs';
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
// portrait type scale. The hash was then re-taken once when editorial fonts
// moved to the story's brand-font variables (var(--lc-font-*, <old stack>));
// that capture differed from dacadc4 only in those font wrappers. Re-taken again
// when the wrapper fallbacks became the bundled registry stacks (fonts only),
// once when three validator error messages (code line, checklist doneAt) were
// made to say what to change (error strings only), and once more when
// checklist rows stopped showing the pending label before they turn active or
// done (checklist entries only), and once when bound messages started printing
// their bounds to 2 decimals (kit/core/bounds.mjs; two focus-flow error
// strings, "8.389999999999999" → "8.39" and "8.149999999999999" → "8.15").
const EXPLICIT_16X9_SHA256 = '45c528200fb88850369afee5518317015f2fc7992261c1c473e0555b803a7fd7';
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

test('editorial core imports only the font registry and the motion grammar, and the skill copy matches kit/core byte for byte', () => {
  const canonical = readFileSync(new URL('../kit/core/editorial-core.mjs', import.meta.url), 'utf8');
  const copy = readFileSync(new URL('../skills/launchclip-create-video/scripts/editorial-core.mjs', import.meta.url), 'utf8');
  assert.equal(copy, canonical);
  assert.deepEqual(canonical.match(/^[ \t]*import\b.*$/gm), ["import {formatBound, withinBounds} from './bounds.mjs';", "import {fontStack} from './fonts.mjs';", "import {grammarDuration, grammarEase} from './grammar.mjs';"]);
  assert.doesNotMatch(canonical, /\bimport\(|\brequire\(/);
  assert.equal(EDITORIAL_STYLE.font.sans, "var(--lc-font-body, 'Inter', 'STIX Two Math', sans-serif)");
  assert.equal(EDITORIAL_STYLE.font.mono, "var(--lc-font-meta, 'JetBrains Mono', 'STIX Two Math', monospace)");
  assert.equal(EDITORIAL_KINDS.length, 14);
  assert.equal(EDITORIAL_STYLE.space.pad, 24);
  assert.ok(Object.isFrozen(EDITORIAL_STYLE) && Object.isFrozen(EDITORIAL_SYMBOLS));
});

test('code-snippet label: "<language> · Example" by default, the real label when the code is real, hidden with label: false', () => {
  const spec = (code, extra = {}) => ({id: 'code', kind: 'code-snippet', aspect: '16:9', start: 0, duration: 3, rect: {x: 360, y: 300, width: 1200, height: 300}, title: 'Terminal',
    code: {lines: [{at: .4, tokens: [{text: '$ ', type: 'comment'}, {text: 'launchclip finish', type: 'plain'}]}], ...code}, ...extra});
  const label = (code, extra) => resolveEditorialModule(spec(code, extra)).content.label;
  assert.equal(label({language: 'shell'}), 'shell · Example');
  assert.equal(label({}), 'Example code · Example');
  assert.equal(label({language: 'shell', source: 'real'}), 'shell');
  assert.equal(label({source: 'real'}), null);
  assert.equal(label({language: 'json', filename: 'storyboard.json'}), 'storyboard.json');
  assert.equal(label({language: 'shell'}, {label: 'zsh — launch'}), 'zsh — launch');
  assert.equal(label({language: 'shell'}, {label: false}), null);
  // The default stays byte-identical; a hidden label drops the row from the markup.
  const shown = buildEditorialModule(spec({language: 'shell'}));
  assert.match(shown.html, /<p class="ui-code-language">shell · Example<\/p>/);
  const hidden = buildEditorialModule(spec({language: 'shell'}, {label: false}));
  assert.doesNotMatch(hidden.html, /ui-code-language">/);
  const real = buildEditorialModule(spec({language: 'shell', source: 'real'}));
  assert.match(real.html, /<p class="ui-code-language">shell<\/p>/);
  // The hidden row gives its height back: a rect 44 px shorter still fits.
  const tight = {x: 360, y: 300, width: 1200, height: 160};
  assert.throws(() => resolveEditorialModule({...spec({language: 'shell'}), rect: tight}), /code-snippet rect too short/);
  assert.doesNotThrow(() => resolveEditorialModule({...spec({language: 'shell'}, {label: false}), rect: tight}));
  assert.throws(() => resolveEditorialModule(spec({source: 'yes'})), /code.source must be example or real/);
  assert.throws(() => resolveEditorialModule({...spec({}), kind: 'callout', code: undefined, body: 'Hi', label: 'x'}), /label is only for code-snippet/);
});

test('status-rack status palette: lights can go red → green, with contrast-checked tones; the default stays the accent', () => {
  const rows = states => [{label: 'Tests', states}];
  const spec = (states, extra = {}) => ({id: 'rack', kind: 'status-rack', aspect: '16:9', start: 0, duration: 4, rect: {x: 400, y: 200, width: 1100, height: 400}, title: 'Quality gates', accent: '#ffa630',
    rack: {mode: 'illustration', rows: rows(states)}, ...extra});
  const lights = (on) => [on, on, on];
  // Default: lit lights are the accent and a repeated state changes nothing.
  const plain = resolveEditorialModule(spec([{at: .4, lights: lights(true)}, {at: 1.2, lights: lights(true)}]));
  assert.deepEqual(plain.content.rows[0].states[0].changes.map(change => change.color), ['#ffa630', '#ffa630', '#ffa630']);
  assert.deepEqual(plain.content.rows[0].states[1].changes, []);
  assert.equal(plain.content.palette, undefined);
  // Tones: fail then pass recolours the lit lights; the colour change alone is a state change (with its event).
  const toned = resolveEditorialModule(spec([{at: .4, lights: lights(true), tone: 'fail'}, {at: 1.2, lights: lights(true), tone: 'pass'}]));
  const {tones} = toned.content;
  assert.equal(toned.content.palette, 'status');
  assert.deepEqual(toned.content.rows[0].states[0].changes.map(change => change.color), [tones.fail, tones.fail, tones.fail]);
  assert.deepEqual(toned.content.rows[0].states[1].changes.map(change => change.color), [tones.pass, tones.pass, tones.pass]);
  assert.ok(toned.events.some(event => event.id === 'rack-rack-0-state-1'));
  assert.notEqual(tones.pass, tones.fail);
  for (const tone of ['pending', 'active', 'pass', 'fail']) assert.ok(statusContrast(tones[tone], toned.theme.surface) >= 3, tone);
  assert.equal(tones.active, '#ffa630');
  // palette "status": positions mean fail, active, pass; a light may name its own tone.
  const positional = resolveEditorialModule(spec([{at: .4, lights: [true, false, false]}, {at: 1.2, lights: [false, false, true]}], {palette: 'status'}));
  assert.equal(positional.content.rows[0].states[0].changes[0].color, positional.content.tones.fail);
  assert.equal(positional.content.rows[0].states[1].changes.find(change => change.light === 2).color, positional.content.tones.pass);
  const named = resolveEditorialModule(spec([{at: .4, lights: ['fail', false, 'pending']}]));
  assert.deepEqual(named.content.rows[0].states[0].colors, [named.content.tones.fail, named.content.lightOff, named.content.tones.pending]);
  // Supplied tones that fail 3:1 on the light surface are darkened toward the foreground.
  const light = resolveEditorialModule(spec([{at: .4, lights: lights(true), tone: 'pass'}], {theme: {surface: '#ffffff', foreground: '#111111', muted: '#555555', border: '#cccccc'}, tones: {pass: '#a8f0c0'}}));
  assert.ok(statusContrast(light.content.tones.pass, '#ffffff') >= 3);
  assert.notEqual(light.content.tones.pass, '#a8f0c0');
  // Both renderers draw change.color: the HyperFrames timeline tweens to the pass tone.
  assert.match(buildEditorialModule(spec([{at: .4, lights: lights(true), tone: 'fail'}, {at: 1.2, lights: lights(true), tone: 'pass'}])).motion, new RegExp(`backgroundColor:"${tones.pass}"`));
  assert.throws(() => resolveEditorialModule(spec([{at: .4, lights: lights(true), tone: 'green'}])), /tone must be pending, active, pass, fail/);
  assert.throws(() => resolveEditorialModule(spec([{at: .4, lights: ['ok', true, true]}])), /each a boolean or a tone/);
  assert.throws(() => resolveEditorialModule(spec([{at: .4, lights: lights(true)}], {palette: 'rgb'})), /palette must be "status"/);
  assert.throws(() => resolveEditorialModule({...spec([]), kind: 'callout', rack: undefined, body: 'Hi', palette: 'status'}), /palette is only for status-rack/);
});

test('status-rack status palette takes pass and fail from brand roles through the module registry', async () => {
  const {resolveModule} = await import('@launchclip/core/modules.mjs');
  const story = colors => ({format: {width: 1920, height: 1080, fps: 30, duration: 5}, brand: {colors}, scenes: []});
  const scene = params => ({id: 'gates', module: 'status-rack', start: 0, end: 4, params: {title: 'Gates', rect: {x: 400, y: 200, width: 1100, height: 400}, rack: {mode: 'illustration', rows: [{label: 'Tests', states: [{at: .4, lights: [true, true, true], tone: 'fail'}, {at: 1.2, lights: [true, true, true], tone: 'pass'}]}]}, ...params}});
  const brand = {bg: '#0a0b10', paper: '#f3efe6', primary: '#ffa630', success: '#22c55e', danger: '#ef4444'};
  const model = resolveModule(scene({}), story(brand));
  assert.equal(model.content.tones.pass, '#22c55e');
  assert.equal(model.content.tones.fail, '#ef4444');
  // A plain rack ignores the brand roles: no tones, accent lights.
  const plain = resolveModule(scene({rack: {mode: 'illustration', rows: [{label: 'Tests', states: [{at: .4, lights: [true, false, false]}]}]}}), story(brand));
  assert.equal(plain.content.tones, undefined);
  assert.equal(plain.content.rows[0].states[0].changes[0].color, '#ffa630');
});
