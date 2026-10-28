import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {MODULES, catalogBTimeline, catalogBView, contrastRatio, formatNumber, mixColor, parseExpression, sampleIndex} from '@launchclip/core/catalog-b.mjs';
import {createBase} from '@launchclip/core/catalog-b-base.mjs';
import {loopValue, propsToStyle, transformString} from '@launchclip/core/catalog-b-view.mjs';
import {EMITTERS, gsapOwnedTransforms, opsToGsap, renderNode} from '../kit/hyperframes/catalog-b.mjs';
import {assertMatchesFrameState} from './helpers/frame_state.js';
import {mediaSkip} from './helpers/media.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURES = join(ROOT, 'test/fixtures/parity');
const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const format = {width: 1080, height: 1920, fps: 30, duration: 30};
const ctx = (overrides = {}) => ({id: 'scene', start: 2, duration: 6, format, brand, aspect: '9:16', ...overrides});

// ---------------------------------------------------------------------------
// Expression parser

test('expression parser evaluates arithmetic, precedence and functions', () => {
  const cases = [
    ['20 + 70 * 2^(-t/10)', 10, 55],
    ['2^3^2 + t', 0, 512],
    ['-2^2 + t', 0, -4],
    ['(1 + 2) * 3 - t / 2', 4, 7],
    ['exp(0) + log(1) + sqrt(t) + abs(-3)', 16, 1 + 0 + 4 + 3],
    ['sin(pi/2) * cos(0) + e - e + x', 1, 2],
    ['1.5e1 + .5 - t', 1, 14.5],
    ['20 + 70 × 2^(−t/10)', 20, 37.5]
  ];
  for (const [source, value, expected] of cases) assert.ok(Math.abs(parseExpression(source).evaluate(value) - expected) < 1e-9, source);
});

test('expression parser rejects anything outside the grammar', () => {
  const bad = [
    'alert(1)', 'constructor', 't.constructor', 'this', 'globalThis', 'process.exit()', 'Function("return 1")', '__proto__',
    't; 1', 't = 1', '[t]', '{}', '`t`', '"t"', "'t'", 't => t', '2t', 't t', '(t', 't)', 'sin t', 'sin()', 'pow(t, 2)', 'max(t)', '1 + 2', '', ' ',
    't'.padEnd(161, ' '), '((((((((((((((((((((((((((t))))))))))))))))))))))))))', 'Math.sin(t)', 'eval(t)', 't % 2', 't ** 2', '1..2 + t', '#t'
  ];
  for (const source of bad) assert.throws(() => parseExpression(source), Error, JSON.stringify(source));
  assert.throws(() => parseExpression(42), /non-empty string/);
  assert.throws(() => parseExpression('1 / t').evaluate(0), /not finite/);
  assert.throws(() => parseExpression('log(t)').evaluate(-1), /not finite/);
});

test('expression parser never reaches eval or Function', () => {
  const source = readFileSync(join(ROOT, 'kit/core/catalog-b-base.mjs'), 'utf8');
  assert.doesNotMatch(source, /\beval\s*\(|new Function|Function\s*\(/);
  const frozen = parseExpression('t + 1');
  assert.ok(Object.isFrozen(frozen));
});

// ---------------------------------------------------------------------------
// Colour, numbers, base

test('WCAG contrast and colour mixing', () => {
  assert.equal(Math.round(contrastRatio('#000000', '#ffffff') * 100) / 100, 21);
  assert.equal(contrastRatio('#777777', '#777777'), 1);
  assert.equal(mixColor('#ffffff', '#000000', 0.5), '#808080');
  assert.equal(formatNumber(17.5), '17.5');
  assert.equal(formatNumber(-3, 1), '−3.0');
  assert.equal(formatNumber(70), '70');
});

test('createBase validates ctx, params keys, brand contrast and safe zone', () => {
  const opts = {allowed: ['title'], required: []};
  const base = createBase('demo', {title: 'x'}, ctx(), opts);
  assert.deepEqual(base.rect, {x: 80, y: 280, width: 860, height: 880});
  assert.equal(base.min.key, 44);
  assert.equal(base.model.theme.muted, mixColor(brand.colors.paper, brand.colors.bg, 0.62));
  assert.ok(base.model.fonts.display.startsWith("'Anton',"));
  assert.throws(() => createBase('demo', {nope: 1}, ctx(), opts), /scene \(demo\): params\.nope is not supported/);
  assert.throws(() => createBase('demo', {}, ctx(), {allowed: ['title'], required: ['title']}), /params\.title is required/);
  const lowContrast = {...brand, colors: {...brand.colors, paper: '#1a1b22'}};
  assert.throws(() => createBase('demo', {}, ctx({brand: lowContrast}), opts), /contrast .*at least 3:1/);
  assert.throws(() => base.resolveColor('#0a0a12', 'params.color'), /params\.color .* contrast/);
  assert.throws(() => base.resolveColor('purple', 'params.color'), /primary, accent, paper or a six-digit hex/);
  assert.throws(() => createBase('demo', {rect: {x: 0, y: 280, width: 860, height: 600}}, ctx(), opts), /params\.rect\.x must be between 80/);
  // Captions hidden: the full Shorts band y 280–1450.
  assert.equal(createBase('demo', {}, ctx(), {...opts, hidesCaptions: true}).rect.height, 1170);
  // Scales with the canvas: 720×1280 → key text 29.33 px, rect scaled.
  const small = createBase('demo', {}, ctx({format: {width: 720, height: 1280, fps: 30}}), opts);
  assert.equal(small.min.key, 29.34);
  assert.equal(small.rect.x, 53.34);
  // Landscape uses the title-safe zone above the caption band.
  const wide = createBase('demo', {}, ctx({format: {width: 1920, height: 1080, fps: 30}, aspect: '16:9'}), opts);
  assert.deepEqual(wide.rect, {x: 96, y: 54, width: 1728, height: 780});
  // Event timing: params at > ctx hit > fallback, inside [enter, exit − 0.3].
  const hit = createBase('demo', {}, ctx({hits: [{event: 'pop', at: 4.5}]}), opts);
  assert.equal(hit.timeOf('pop', undefined, 'params.at', 1), 4.5);
  assert.equal(hit.timeOf('pop', 1.25, 'params.at', 1), 3.25);
  assert.equal(hit.timeOf('other', undefined, 'params.at', 1), 3);
  assert.throws(() => hit.timeOf('pop', 5.9, 'params.at', 1), /params\.at must fall between 0\.5 s and 5\.35 s/);
});

test('sampleIndex follows the tl.set lead rule', () => {
  const samples = [{t: 1}, {t: 1.0333}, {t: 1.0667}];
  assert.equal(sampleIndex(samples, 0.99), -1);
  assert.equal(sampleIndex(samples, 1), 0);
  assert.equal(sampleIndex(samples, 1.0333), 1);
  assert.equal(sampleIndex(samples, 5), 2);
});

// ---------------------------------------------------------------------------
// Ops, frameState and GSAP: the same op list must render the same values

test('op list → GSAP code is seek-safe and matches frameState in any seek order', () => {
  const ops = [
    {type: 'set', target: 'a', time: 0, props: {opacity: 0, x: 10, y: 0, scaleX: 1, scaleY: 1}},
    {type: 'tween', target: 'a', start: 1, duration: 0.5, ease: 'power3.out', from: {opacity: 0, x: 10}, to: {opacity: 1, x: 0}},
    {type: 'tween', target: 'a', start: 3, duration: 0.4, ease: 'back.out(1.7)', from: {scaleX: 0.5, scaleY: 0.5}, to: {scaleX: 1, scaleY: 1}},
    {type: 'set', target: 'b', time: 0, props: {text: '0'}},
    {type: 'set', target: 'b', time: 1.4995, props: {text: '5'}},
    {type: 'set', target: 'c', time: 0, props: {strokeDashoffset: 1}},
    {type: 'tween', target: 'c', start: 0.5, duration: 2, ease: 'power2.inOut', from: {strokeDashoffset: 1}, to: {strokeDashoffset: 0}},
    {type: 'set', target: 'd', time: 0, props: {x: -100}},
    {type: 'loop', target: 'd', start: 1, cycle: 0.7, repeats: 6, from: {x: -100}, to: {x: 0}}
  ];
  const code = opsToGsap(ops);
  assert.ok(code.every(line => /^tl\.(set|fromTo)\(/.test(line)));
  assert.ok(code.filter(line => line.startsWith('tl.fromTo')).every(line => line.includes('"immediateRender":false')));
  assert.match(code.join('\n'), /"autoRound":false/);
  assert.doesNotMatch(code.join('\n'), /onUpdate|onComplete|Date|performance|Math\.random/);
  const times = [0, 0.7, 1.2, 1.5, 2.2, 3.15, 4.4, 5.9, 0.3, 2.0, 1.1];
  assertMatchesFrameState(ops, code.join('\n'), times, 'synthetic');
  assert.ok(Math.abs(loopValue(ops[8], 1.35).x + 50) < 1e-9);
  assert.deepEqual(loopValue(ops[8], 9), {x: 0});
});

test('renderNode serialises the shared view tree to HTML', () => {
  const html = renderNode({tag: 'div', id: 'x', style: {left: 10, opacity: 0.5, WebkitMaskImage: 'none', lineHeight: '1.2'}, children: [
    {tag: 'svg', attrs: {viewBox: '0 0 10 10', width: 10}, children: [{tag: 'path', attrs: {d: 'M0 0', strokeWidth: 2, pathLength: 1}, children: []}]},
    '<b>&', {tag: 'img', attrs: {src: 'assets/a.svg', alt: ''}, children: []}
  ]}, 'class="clip"');
  assert.equal(html, '<div id="x" class="clip" style="left:10px;opacity:0.5;-webkit-mask-image:none;line-height:1.2"><svg viewBox="0 0 10 10" width="10"><path d="M0 0" stroke-width="2" pathLength="1"/></svg>&lt;b&gt;&amp;<img src="assets/a.svg" alt=""></div>');
  assert.equal(transformString({x: 1, y: 2, rotation: -5, scaleX: 2, scaleY: 3}), 'translate(1px, 2px) rotate(-5deg) scale(2, 3)');
  assert.deepEqual(propsToStyle({opacity: 0.5, x: 0, strokeDashoffset: 0.25}), {opacity: 0.5, transform: 'translate(0px, 0px)', strokeDashoffset: 0.25});
});

// ---------------------------------------------------------------------------
// Module helpers shared by the per-module tests below

export function resolveScene(story, scene) {
  const f = story.format;
  return MODULES[scene.module].resolve(scene.params ?? {}, {id: scene.id, start: scene.start, duration: scene.end - scene.start, format: f, brand: story.brand,
    aspect: f.height > f.width ? '9:16' : '16:9', hits: (scene.hits ?? []).filter(hit => typeof hit.at === 'number')});
}
export function loadFixture(id) {
  const fixture = JSON.parse(readFileSync(join(FIXTURES, `b-cat-${id}.json`), 'utf8'));
  const scene = fixture.story.scenes.find(entry => entry.id === fixture.sceneId);
  return {fixture, scene, model: resolveScene(fixture.story, scene)};
}

/** Contract checks every catalogue B model must pass. */
export function assertModelContract(model, moduleId) {
  for (const key of ['id', 'module', 'canvas', 'start', 'duration', 'end', 'rect', 'motion', 'content', 'events', 'layout', 'hidesCaptions', 'theme']) assert.ok(key in model, `model.${key}`);
  assert.equal(model.module, moduleId);
  assert.equal(model.end, Math.round((model.start + model.duration) * 1e4) / 1e4);
  for (const key of ['enterStart', 'enterEnd', 'exitStart', 'end', 'enterFrom', 'exitTo', 'enterEase', 'exitEase']) assert.ok(key in model.motion, `motion.${key}`);
  for (const key of ['surface', 'foreground', 'muted', 'border', 'accentText']) assert.match(model.theme[key], /^#[0-9a-f]{6}$/);
  assert.deepEqual(model.layout.rect, model.rect);
  assert.deepEqual(Object.keys(model.layout.motion), ['enterEnd', 'exitStart', 'end']);
  // Safe zone (Shorts: x 80–940, y 280–1450 at 1080×1920; caption band kept clear unless hidden).
  const r = model.rect, portrait = model.canvas.height > model.canvas.width;
  const s = model.canvas.width / (portrait ? 1080 : 1920), sy = model.canvas.height / (portrait ? 1920 : 1080);
  const zone = portrait ? {x0: 80, x1: 940, y0: 280, y1: model.hidesCaptions ? 1450 : 1160} : {x0: 96, x1: 1824, y0: 54, y1: model.hidesCaptions ? 1026 : 840};
  assert.ok(r.x >= zone.x0 * s - 1e-6 && r.x + r.width <= zone.x1 * s + 1e-6, 'rect x inside the safe zone');
  assert.ok(r.y >= zone.y0 * sy - 1e-6 && r.y + r.height <= zone.y1 * sy + 1e-6, 'rect y inside the safe zone');
  assert.ok(model.minTextPx >= 44 * Math.min(model.canvas.width, model.canvas.height) / 1080 - 1e-6, 'key text ≥ 44 px');
  for (const [pair, ratio] of Object.entries(model.contrast)) assert.ok(ratio >= 3, `${pair} contrast ${ratio}`);
  for (const event of model.events) {
    assert.match(event.id, new RegExp(`^${model.id}-`));
    assert.ok(event.time >= model.start && event.time <= model.motion.exitStart, `${event.id} inside the hold`);
    if (event.endTime !== undefined) assert.ok(event.endTime >= event.time);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(model)), model, 'model is JSON-only');
}

/** Emitter shape, seek-safety against real GSAP, and DOM ids present for every op target. */
export function assertEmitter(model) {
  const out = EMITTERS[model.module](model);
  assert.deepEqual(Object.keys(out).sort(), ['css', 'events', 'html', 'layout', 'motion']);
  assert.match(out.html, new RegExp(`^<div id="${model.id}" class="clip lc-catalog-b" data-start="${model.start}" data-duration="${model.duration}" data-track-index="2"`));
  assert.doesNotMatch(out.html, /https?:\/\//);
  assert.deepEqual(out.events, model.events);
  const ops = catalogBTimeline(model);
  for (const op of ops) assert.ok(out.html.includes(`id="${op.target}"`), `target ${op.target} exists in the HTML`);
  for (const line of out.motion.split('\n')) assert.match(line, /^tl\.(set|fromTo)\(/);
  assert.doesNotMatch(out.motion, /onUpdate|onComplete|Date|performance|Math\.random|requestAnimationFrame/);
  const m = model.motion, fps = model.fps;
  const times = [];
  for (let t = model.start; t <= model.end + 0.2; t += 1 / fps * 7) times.push(t);
  times.push(...times.slice().reverse().filter((_, i) => i % 3 === 0), m.enterStart + 0.2, m.exitStart + 0.1);
  for (const event of model.events) times.push(event.time, event.time + 0.4, event.time - 0.01);
  assertMatchesFrameState(ops, out.motion, times, model.module);
  assert.equal(catalogBView(model).id, model.id);
}

// Real Remotion stills (skipped when Chrome is unavailable).
const require = createRequire(import.meta.url);
const remotionCli = join(require.resolve('@remotion/cli/package.json'), '..', 'remotion-cli.js');
const chromeDir = join(ROOT, 'node_modules/.remotion');
export const CHROME = existsSync(chromeDir) && readdirSync(chromeDir).length > 0 && process.env.LAUNCHCLIP_SKIP_REMOTION !== '1';
export function remotionStill(id, seconds) {
  const {fixture, scene} = loadFixture(id);
  const dir = mkdtempSync(join(tmpdir(), 'lc-catalog-b-'));
  try {
    const props = join(dir, 'props.json'), out = join(dir, 'still.png');
    writeFileSync(props, JSON.stringify({scene, story: fixture.story}));
    const frame = Math.round((seconds - scene.start) * fixture.story.format.fps);
    const result = spawnSync(process.execPath, [remotionCli, 'still', join(ROOT, 'test/fixtures/parity-entry-cat-b/entry.tsx'), 'ModuleReview', out, `--props=${props}`, `--frame=${frame}`, `--public-dir=${FIXTURES}`, '--log=error'], {cwd: ROOT, encoding: 'utf8', timeout: 240000});
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const png = readFileSync(out);
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), fixture.story.format.width);
    assert.equal(png.readUInt32BE(20), fixture.story.format.height);
    return png.length;
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}

// ---------------------------------------------------------------------------
// function-chart

const chartParams = {fn: '20 + 70 * 2^(-t/10)', x: [0, 60, 'min'], y: [0, 100, '°C'], baseline: {value: 20, label: 'Room'}, gap_bars: [0, 10, 20], label: 'illustrative values'};

test('function-chart: fixture model meets the contract', () => {
  const {model} = loadFixture('function-chart');
  assertModelContract(model, 'function-chart');
  const c = model.content;
  assert.equal(model.hidesCaptions, false);
  assert.match(c.path, /^M[\d.]+ [\d.]+( L[\d.]+ [\d.]+){160}$/);
  assert.deepEqual(model.events.map(e => e.name), ['enter', 'draw', 'gap-bar-0', 'gap-bar-2', 'gap-bar-1', 'probe-settle', 'tail-zoom']);
  // The hit on gap-bar-1 (absolute 14.2 s) times that bar.
  assert.equal(model.events.find(e => e.name === 'gap-bar-1').time, 14.2);
  assert.deepEqual(c.gapBars.map(bar => bar.text), ['70°C', '35°C', '17.5°C']);
  assert.equal(c.baseline.text, 'Room 20°C');
  assert.equal(c.label.text, 'ILLUSTRATIVE VALUES');
  // Probe rides the line tip: first sample at x min, last at x max, one per frame.
  const samples = c.probe.samples;
  assert.equal(samples[0].text, '90.0°C');
  assert.equal(samples.at(-1).text, '21.1°C');
  assert.equal(samples.at(-1).meta, 't = 60 min');
  assert.equal(samples[0].x, c.plot.x);
  assert.equal(samples.at(-1).x, c.plot.x + c.plot.width);
  for (let i = 1; i < samples.length - 1; i++) assert.ok(Math.abs(samples[i].t - samples[i - 1].t - 1 / 30) < 1e-3);
  assert.ok(samples.at(-1).t - samples.at(-2).t <= 1 / 30 + 1e-6);
  // Tail zoom inset sits inside the plot and starts from the lens rect.
  const T = c.tail;
  assert.equal(T.corner, 'top-right');
  assert.ok(T.inset.x >= c.plot.x && T.inset.x + T.inset.width <= c.plot.x + c.plot.width + 1e-6);
  assert.ok(T.zoomFrom.scaleX < 1 && T.zoomFrom.scaleY < 1);
  assert.equal(T.endText, '21.1°C');
});

test('function-chart: the RFC example params resolve; strict validation', () => {
  const resolve = MODULES['function-chart'].resolve;
  const model = resolve({fn: '20 + 70 * 2^(-t/10)', x: [0, 60, 'min'], y: [0, 100, '°C'], gap_bars: [0, 10, 20], label: 'illustrative values'}, ctx({duration: 8.7}));
  // Without a baseline the bars measure from y min.
  assert.equal(model.content.gapBars[1].text, '55°C');
  assert.throws(() => resolve({...chartParams, fn: 'process.exit(1)'}, ctx()), /params\.fn is not a valid expression/);
  assert.throws(() => resolve({...chartParams, fn: '20 + 70 * 2^(t/10)'}, ctx()), /params\.fn leaves the y range \[0, 100\]/);
  assert.throws(() => resolve({...chartParams, fn: '20 + sqrt(t - 30)'}, ctx()), /params\.fn expression is not finite at 0 /);
  assert.throws(() => resolve({...chartParams, x: [10, 0]}, ctx()), /params\.x max must be greater than min/);
  assert.throws(() => resolve({...chartParams, gap_bars: [0, 1]}, ctx()), /params\.gap_bars\[1\] label "[^"]+" collides/);
  assert.throws(() => resolve({...chartParams, colour: 'red'}, ctx()), /params\.colour is not supported/);
  assert.throws(() => resolve({...chartParams, tail_zoom: {from: 40}}, ctx({duration: 3})), /tail_zoom\.at \(default for "tail-zoom"\) must fall between/);
  assert.throws(() => resolve({...chartParams, color: '#111111'}, ctx()), /params\.color \(#111111\) on brand\.colors\.bg has contrast/);
  assert.throws(() => resolve({...chartParams, gap_bars: [0], draw: {at: 0.1}}, ctx()), /params\.draw\.at must fall between 0\.5 s/);
});

test('function-chart: landscape and small canvases stay in their safe zones', () => {
  const resolve = MODULES['function-chart'].resolve;
  const wide = resolve({...chartParams, title: 'The gap halves'}, ctx({format: {width: 1920, height: 1080, fps: 30}, aspect: '16:9'}));
  assert.deepEqual(wide.rect, {x: 96, y: 54, width: 1728, height: 780});
  const small = resolve(chartParams, ctx({format: {width: 720, height: 1280, fps: 24}}));
  assertModelContract(small, 'function-chart');
  assert.equal(small.content.probe.samples.length > 20, true);
});

test('function-chart: emitter output is seek-safe and matches the Remotion evaluator', () => {
  const {model} = loadFixture('function-chart');
  assertEmitter(model);
  const out = EMITTERS['function-chart'](model);
  assert.match(out.motion, /tl\.fromTo\("#s3-line", \{"strokeDashoffset":1,"autoRound":false\}/);
  assert.match(out.html, /pathLength="1"/);
  assert.ok((out.motion.match(/tl\.set\("#s3-probe"/g) ?? []).length >= model.content.probe.samples.length);
});

test('function-chart: real Remotion still', {skip: mediaSkip(!CHROME && 'Remotion Chrome is not installed')}, () => {
  assert.ok(remotionStill('function-chart', 16) > 20000);
});

// ---------------------------------------------------------------------------
// gauge-compare

test('gauge-compare: the golden cooling story params resolve, with an addressable gap bracket', () => {
  const story = JSON.parse(readFileSync(join(ROOT, 'examples/story/cooling.story.json'), 'utf8'));
  const scene = story.scenes.find(entry => entry.module === 'gauge-compare');
  const model = resolveScene(story, scene);
  assertModelContract(model, 'gauge-compare');
  const c = model.content;
  assert.deepEqual(c.scale, {min: 0, max: 100});
  assert.deepEqual(c.gauges.map(g => [g.label, g.text, g.color]), [['Mug', '90°C', '#fdb022'], ['Room', '20°C', '#46d4ff']]);
  assert.deepEqual(model.events.map(e => e.name), ['enter', 'left-fill', 'right-fill', 'gap-bracket']);
  const object = model.objects['gap-bracket'];
  assert.deepEqual(object.rect, c.bracket.rectCanvas);
  const r = object.rect;
  assert.ok(r.x >= model.rect.x && r.y >= model.rect.y && r.x + r.width <= model.rect.x + model.rect.width && r.y + r.height <= model.rect.y + model.rect.height);
  assert.equal(model.events.at(-1).object, 'gap-bracket');
  assert.equal(c.bracket.text, '70°C');
  // Count-up samples land on the final readout.
  for (const g of c.gauges) {
    assert.equal(g.samples.at(-1).text, g.text);
    assert.equal(g.initialText, '0°C');
    assert.ok(g.fill.scaleTo > g.fill.scaleFrom);
  }
});

test('gauge-compare: fixture hits time the fills; strict validation', () => {
  const {model} = loadFixture('gauge-compare');
  assertModelContract(model, 'gauge-compare');
  assert.deepEqual(model.events.slice(1).map(e => e.time), [6.4, 7.9, 9.6]);
  const resolve = MODULES['gauge-compare'].resolve;
  const params = {left: {label: 'Mug', value: 90, unit: '°C'}, right: {label: 'Room', value: 20, unit: '°C'}};
  assert.throws(() => resolve({...params, gap: {value: 60}}, ctx()), /params\.gap\.value is 60 but \|left\.value − right\.value\| is 70/);
  assert.throws(() => resolve({...params, right: {label: 'Room', value: 20, unit: 'K'}}, ctx()), /params\.right\.unit must match params\.left\.unit/);
  assert.throws(() => resolve({...params, gap: {object: 'Gap Bracket'}}, ctx()), /params\.gap\.object must be a lowercase object name/);
  assert.throws(() => resolve({...params, left: {...params.left, colour: 'primary'}}, ctx()), /params\.left\.colour is not supported/);
  assert.throws(() => resolve({...params, left: {...params.left, label: 'An extremely long gauge label'}}, ctx()), /params\.left\.label must be a string of 1–16 characters/);
  assert.throws(() => resolve({...params, gap: {at: 0.6}}, ctx()), /params\.gap\.at must come at least 0\.35 s after both gauges/);
  assert.throws(() => resolve({left: params.left}, ctx()), /params\.right is required/);
  const column = resolve({...params, style: 'column', gap: false, title: 'Then vs now'}, ctx());
  assert.equal(column.content.bracket, null);
  assert.deepEqual(column.objects, {});
});

test('gauge-compare: emitter output is seek-safe and matches the Remotion evaluator', () => {
  const {model} = loadFixture('gauge-compare');
  assertEmitter(model);
  assert.match(EMITTERS['gauge-compare'](model).html, /id="s2-gap-bracket"/);
});

test('gauge-compare: real Remotion still', {skip: mediaSkip(!CHROME && 'Remotion Chrome is not installed')}, () => {
  assert.ok(remotionStill('gauge-compare', 10.2) > 20000);
});

// ---------------------------------------------------------------------------
// flow-compare

test('flow-compare: fixture model meets the contract; particles are a pure function of t', async () => {
  const {model} = loadFixture('flow-compare');
  assertModelContract(model, 'flow-compare');
  const [top, bottom] = model.content.lanes;
  assert.ok(top.speed > bottom.speed, 'big rate moves faster');
  assert.ok(top.pipe.height > bottom.pipe.height, 'big rate gets the fatter pipe');
  assert.deepEqual(model.events.map(e => e.name), ['enter', 'top-flow', 'bottom-flow']);
  assert.equal(top.tag.text, 'FAST');
  const {flowOffset} = await import('@launchclip/core/catalog-b-flow-compare.mjs');
  const op = catalogBTimeline(model).find(entry => entry.type === 'loop' && entry.target === 'flow-top-belt');
  for (const t of [0, top.time, top.time + 0.01, 1.7, 3.33, 4.9, 2.2, 1.1]) {
    const a = flowOffset(top, t), b = loopValue(op, t).x;
    assert.ok(Math.abs(a - b) < 1e-9, `offset at ${t}`);
    assert.ok(a <= 0 && a >= -top.period);
    assert.equal(flowOffset(top, t), a, 'same t, same offset');
  }
  // Repeats cover the whole scene.
  assert.ok(top.time + top.cycle * top.repeats >= model.end);
});

test('flow-compare: strict validation', () => {
  const resolve = MODULES['flow-compare'].resolve;
  const params = {top: {label: 'Big gap', rate: 1}, bottom: {label: 'Small gap', rate: 0.25}};
  assert.ok(resolve(params, ctx()));
  assert.throws(() => resolve({...params, bottom: {label: 'Same', rate: 1}}, ctx()), /params\.bottom\.rate must differ/);
  assert.throws(() => resolve({...params, top: {label: 'Big', rate: 0}}, ctx()), /params\.top\.rate must be between 0\.05 and 100/);
  assert.throws(() => resolve({...params, top: {label: 'Big', rate: 1, speed: 3}}, ctx()), /params\.top\.speed is not supported/);
  assert.throws(() => resolve({...params, top: {label: 'Big', rate: 1, value: 'much much faster'}}, ctx()), /params\.top\.value must be a string of 1–10/);
  assert.throws(() => resolve({...params, top: {label: 'Big', rate: 1, color: '#0b0b10'}}, ctx()), /params\.top\.color .* contrast/);
});

test('flow-compare: emitter loops are seek-safe repeats that match the Remotion evaluator', () => {
  const {model} = loadFixture('flow-compare');
  assertEmitter(model);
  const out = EMITTERS['flow-compare'](model);
  assert.match(out.motion, /tl\.fromTo\("#flow-top-belt", \{"x":-320\}, \{"x":0,"duration":[\d.]+,"ease":"none","repeat":\d+,"immediateRender":false\}/);
});

test('flow-compare: real Remotion still', {skip: mediaSkip(!CHROME && 'Remotion Chrome is not installed')}, () => {
  assert.ok(remotionStill('flow-compare', 3) > 20000);
});

// ---------------------------------------------------------------------------
// process-steps

test('process-steps: fixture model meets the contract; steps light in order', () => {
  const {model} = loadFixture('process-steps');
  assertModelContract(model, 'process-steps');
  const c = model.content;
  assert.equal(c.layout, 'vertical');
  assert.deepEqual(model.events.map(e => e.name), ['enter', 'step-0', 'step-1', 'step-2']);
  assert.equal(c.connectors.length, 2);
  c.connectors.forEach((k, i) => {
    assert.ok(Math.abs(k.time + k.duration - c.steps[i + 1].time) < 1e-6, 'connector fills into the next step');
    assert.equal(k.axis, 'y');
  });
  assert.equal(c.steps[0].doneTime, c.steps[1].time);
  assert.equal(c.steps.at(-1).doneTime, null);
  assert.ok(model.contrast['ink/step'] >= 3);
});

test('process-steps: horizontal in landscape; strict validation', () => {
  const resolve = MODULES['process-steps'].resolve;
  const wide = resolve({steps: ['Plan', 'Build', 'Ship']}, ctx({format: {width: 1920, height: 1080, fps: 30}, aspect: '16:9'}));
  assertModelContract(wide, 'process-steps');
  assert.equal(wide.content.layout, 'horizontal');
  assert.equal(wide.content.connectors[0].axis, 'x');
  assert.throws(() => resolve({steps: ['Only one']}, ctx()), /params\.steps must be an array of 2–5 entries/);
  assert.throws(() => resolve({steps: ['A', 'B', 'C', 'D', 'E', 'F']}, ctx()), /params\.steps must be an array of 2–5/);
  assert.throws(() => resolve({steps: [{label: 'A', at: 2}, {label: 'B', at: 2.1}]}, ctx()), /params\.steps\[1\]\.at must come at least 0\.35 s after/);
  assert.throws(() => resolve({steps: [{label: 'A', note: 'x'}, 'B']}, ctx()), /params\.steps\[0\]\.note is not supported/);
  assert.throws(() => resolve({steps: ['A', 'B'], color: 'accent'}, ctx({brand: {...brand, colors: {...brand.colors, ink: '#2fa8d0'}}})), /ink on the step colour/);
});

test('process-steps: emitter output is seek-safe and matches the Remotion evaluator', () => {
  assertEmitter(loadFixture('process-steps').model);
});

test('process-steps: real Remotion still', {skip: mediaSkip(!CHROME && 'Remotion Chrome is not installed')}, () => {
  assert.ok(remotionStill('process-steps', 3.3) > 20000);
});

// ---------------------------------------------------------------------------
// archive-card

test('archive-card: fixture model meets the contract; the stamp slams after the quote', () => {
  const {model} = loadFixture('archive-card');
  assertModelContract(model, 'archive-card');
  const c = model.content;
  assert.equal(model.hidesCaptions, true);
  assert.deepEqual(model.events.map(e => e.name), ['enter', 'quote', 'stamp']);
  assert.equal(c.meta.text, 'ROYAL SOCIETY · 1701');
  assert.equal(c.stamp.text, '1701');
  assert.ok(c.stamp.time > c.quote.words.at(-1).time, 'stamp after the last word');
  assert.equal(model.events.at(-1).cue, 'impact');
  for (const pair of ['ink/paper', 'source/paper', 'ink/primary']) assert.ok(model.contrast[pair] >= 3, pair);
  // The card is centred near the Shorts centre of mass (y 860).
  const centre = model.rect.y + c.card.y + c.card.height / 2;
  assert.ok(Math.abs(centre - 860) < 40, `card centre ${centre}`);
});

test('archive-card: title plates, local images only, strict validation', () => {
  const resolve = MODULES['archive-card'].resolve;
  const plate = resolve({title: 'Newton’s cooling law', source: 'Philosophical Transactions', date: '1701', image: 'assets/plates/newton.jpg'}, ctx());
  assert.equal(plate.content.quote, null);
  assert.equal(plate.content.image.src, 'assets/plates/newton.jpg');
  assert.equal(resolve({quote: 'Short.', source: 'Somebody', stamp: false, date: '1701'}, ctx()).content.stamp, null);
  assert.throws(() => resolve({quote: 'x', source: 'y', image: 'https://example.com/a.jpg'}, ctx()), /params\.image must be a project-local assets\/ path/);
  assert.throws(() => resolve({quote: 'x', source: 'y', image: 'assets/../secret.png'}, ctx()), /params\.image must be a project-local/);
  assert.throws(() => resolve({source: 'y'}, ctx()), /params needs a quote or a title/);
  assert.throws(() => resolve({quote: 'x'}, ctx()), /params\.source is required/);
  assert.throws(() => resolve({quote: 'x', source: 'y', stamp: {text: 'OK', at: 0.1}}, ctx()), /params\.stamp\.at must fall between/);
  assert.throws(() => resolve({quote: 'x', source: 'y'}, ctx({brand: {...brand, colors: {...brand.colors, ink: '#d8d4cc'}}})), /ink on brand\.colors\.paper/);
});

test('archive-card: emitter output is seek-safe and matches the Remotion evaluator', () => {
  assertEmitter(loadFixture('archive-card').model);
});

test('archive-card: real Remotion still', {skip: mediaSkip(!CHROME && 'Remotion Chrome is not installed')}, () => {
  assert.ok(remotionStill('archive-card', 3) > 20000);
});

// ---------------------------------------------------------------------------
// logo-row

test('logo-row: fixture model meets the contract; logos pop on a stagger', () => {
  const {model} = loadFixture('logo-row');
  assertModelContract(model, 'logo-row');
  const logos = model.content.logos;
  assert.deepEqual(model.events.map(e => e.name), ['enter', 'logo-0', 'logo-1', 'logo-2']);
  assert.deepEqual(logos.map(l => Math.round((l.time - logos[0].time) * 100) / 100), [0, 0.14, 0.28]);
  for (const logo of logos) {
    assert.ok(existsSync(join(FIXTURES, logo.src)), `${logo.src} exists in the fixture assets`);
    assert.ok(logo.tile.x >= 0 && logo.tile.x + logo.tile.size <= model.rect.width + 1e-6);
  }
  assert.ok(model.content.title.y > 0, 'title travels with the grid');
});

test('logo-row: grids, local assets only, strict validation', () => {
  const resolve = MODULES['logo-row'].resolve;
  const logos = n => Array.from({length: n}, (_, i) => ({src: `assets/logos/l${i}.svg`, label: `Logo ${i}`}));
  const five = resolve({logos: logos(5)}, ctx());
  assert.deepEqual([...new Set(five.content.logos.map(l => l.tile.y))].length, 2, 'two rows in portrait');
  const wide = resolve({logos: logos(5)}, ctx({format: {width: 1920, height: 1080, fps: 30}, aspect: '16:9'}));
  assert.deepEqual([...new Set(wide.content.logos.map(l => l.tile.y))].length, 1, 'one row in landscape');
  assert.throws(() => resolve({logos: [{src: 'https://cdn.example.com/a.svg', label: 'A'}, {src: 'assets/b.svg', label: 'B'}]}, ctx()), /params\.logos\[0\]\.src must be a project-local assets\/ path/);
  assert.throws(() => resolve({logos: [{src: 'assets/a.gif', label: 'A'}, {src: 'assets/b.svg', label: 'B'}]}, ctx()), /must be an \.svg, \.png, \.jpg or \.webp image/);
  assert.throws(() => resolve({logos: logos(1)}, ctx()), /params\.logos must be an array of 2–6/);
  assert.throws(() => resolve({logos: logos(7)}, ctx()), /params\.logos must be an array of 2–6/);
  assert.throws(() => resolve({logos: [{src: 'assets/a.svg'}, {src: 'assets/b.svg', label: 'B'}]}, ctx()), /params\.logos\[0\]\.label is required/);
  assert.throws(() => resolve({logos: logos(3), at: 5.9}, ctx()), /params\.at must fall between/);
});

test('logo-row: emitter output is seek-safe and matches the Remotion evaluator', () => {
  const {model} = loadFixture('logo-row');
  assertEmitter(model);
  assert.match(EMITTERS['logo-row'](model).html, /<img src="assets\/logos\/orbit\.svg"/);
});

test('logo-row: real Remotion still', {skip: mediaSkip(!CHROME && 'Remotion Chrome is not installed')}, () => {
  assert.ok(remotionStill('logo-row', 2) > 20000);
});

// ---------------------------------------------------------------------------
// brand-lockup

const landscape = (overrides = {}) => ctx({format: {width: 1920, height: 1080, fps: 30}, aspect: '16:9', start: 0, duration: 4.5, ...overrides});
const lockup = {mark: 'assets/brand/mark.png', wordmark: {src: 'assets/brand/wordmark.png', ratio: 7.5}};

test('brand-lockup: a title card lands the mark first, then the wordmark, eyebrow and headline, and hides captions', () => {
  const model = MODULES['brand-lockup'].resolve({...lockup, tint: 'paper', eyebrow: 'Launch analytics', headline: 'Launch analytics for small teams'}, landscape());
  assertModelContract(model, 'brand-lockup');
  assert.equal(model.hidesCaptions, true);
  const {mark, wordmark} = model.content;
  assert.deepEqual(model.content.beats.map(beat => beat.key), ['mark', 'wordmark', 'eyebrow', 'headline']);
  assert.deepEqual(model.content.beats.map(beat => beat.time), [0, 0.35, 0.7, 1.05]);
  // The light bloom sits behind the lockup, centred on it.
  assert.equal(model.content.glow.color, brand.colors.primary);
  assert.ok(Math.abs(model.content.glow.y + model.content.glow.size / 2 - (mark.y + mark.height / 2)) < 0.02);
  assert.equal(MODULES['brand-lockup'].resolve({...lockup, glow: false}, landscape()).content.glow, undefined);
  // Row lockup: the mark beside the wordmark, both centred, the wordmark 62% of the mark's height.
  assert.ok(Math.abs(mark.y + mark.height / 2 - (wordmark.y + wordmark.height / 2)) < 0.02);
  assert.ok(Math.abs(wordmark.height / mark.height - 0.62) < 0.01);
  assert.ok(Math.abs(mark.x + (wordmark.x + wordmark.width - mark.x) / 2 - model.rect.width / 2) < 0.02, 'the lockup is centred');
  // The tint is a colour matrix to the paper colour, applied to the wordmark only.
  assert.deepEqual(model.content.filters, [{id: 'scene-tint', values: '0 0 0 0 0.949 0 0 0 0 0.9333 0 0 0 0 0.902 0 0 0 1 0'}]);
  const html = EMITTERS['brand-lockup'](model).html;
  assert.match(html, /<filter id="scene-tint" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="[^"]+"><\/feColorMatrix><\/filter>/);
  assert.match(html, /<img id="scene-wordmark"[^>]* style="[^"]*filter:url\(#scene-tint\)/);
  assert.doesNotMatch(html.match(/<img id="scene-mark"[^>]*>/)[0], /filter/);
  assertEmitter(model);
  // The mark lands at once: the hook's first motion.
  assert.ok(model.events.filter(event => event.time < 2).length >= 3);
});

test('brand-lockup: the end card stacks the lockup over a badge and a URL pill; a hit moves the beats after it', () => {
  const model = MODULES['brand-lockup'].resolve({...lockup, variant: 'end', tint: '#ffffff', badge: 'assets/brand/store-badge.svg', url: 'pulseboard.example'},
    landscape({start: 20, duration: 6, hits: [{event: 'badge', at: 21.6}]}));
  assertModelContract(model, 'brand-lockup');
  const {mark, wordmark, badge, url} = model.content;
  assert.equal(model.content.layout, 'stack');
  assert.ok(mark.y + mark.height < wordmark.y && wordmark.y + wordmark.height < badge.y && badge.y + badge.height < url.y, 'mark, wordmark, badge, URL from top to bottom');
  assert.equal(badge.width / badge.height, 3, 'an app-store badge ratio by default');
  assert.deepEqual(model.content.beats.map(beat => [beat.key, beat.time]), [['mark', 20], ['wordmark', 20.35], ['badge', 21.6], ['url', 21.95]]);
  assert.ok(model.contrast['url/primary'] >= 3);
  assertEmitter(model);
});

test('brand-lockup: an opener with no headline still has two hook beats: a light sweep at once, then a glint', () => {
  // The shape of a cinematic opener: mark, wordmark (tinted), eyebrow and glow, the wordmark on a hit, no headline.
  const cinematic = {id: 'cinematic', ease: {enter: 'power2.inOut', exit: 'power2.in', move: 'power2.inOut', camera: 'power2.inOut', emphasis: 'power2.inOut'},
    duration: {enter: 0.7, exit: 0.45, transition: 0.9, camera: 1.3}, stagger: 1.4};
  const model = MODULES['brand-lockup'].resolve({...lockup, tint: 'paper', eyebrow: 'Launch analytics', glow: 'primary', at: 0, stagger: 0.25},
    landscape({duration: 3.4, hits: [{event: 'wordmark', at: 0.25}], grammar: cinematic}));
  assertModelContract(model, 'brand-lockup');
  assert.equal(model.content.headline, undefined);
  const [sweep, glint] = model.content.sweeps;
  // The sweep starts with the mark and crosses the whole card; the glint crosses the lockup once the wordmark has landed.
  assert.equal(sweep.key, 'sweep');
  assert.equal(sweep.time, 0);
  assert.ok(sweep.x + sweep.width <= 0 && sweep.x + sweep.width + sweep.travel >= model.rect.width, 'the sweep travels from off the left to off the right');
  assert.equal(glint.key, 'shine');
  const wordmarkLands = model.content.beats.find(beat => beat.key === 'wordmark').time + model.content.land * 1.3;
  assert.ok(glint.time > wordmarkLands && glint.time + glint.duration <= model.motion.exitStart, `glint at ${glint.time}`);
  assert.ok(glint.time - sweep.time >= 1, 'two distinct beats, apart');
  assert.deepEqual(model.events.filter(event => event.name === 'shine').map(event => event.time), [glint.time]);
  // Light, not colour: the bands are paper over the frame, screened, faded at both ends.
  const html = EMITTERS['brand-lockup'](model).html;
  assert.match(html, /id="scene-sweep"[^>]*mix-blend-mode:screen/);
  assert.ok(html.lastIndexOf('id="scene-shine"') > html.indexOf('id="scene-wordmark"'), 'the glint is drawn above the wordmark');
  assertEmitter(model);
  // shine: false, or a scene too short for the glint, drops them.
  assert.deepEqual(MODULES['brand-lockup'].resolve({...lockup, shine: false}, landscape()).content.sweeps, []);
  assert.deepEqual(MODULES['brand-lockup'].resolve({...lockup}, landscape({duration: 2})).content.sweeps.map(s => s.key), ['sweep']);
});

test('brand-lockup: validation names the param', () => {
  const resolve = (params, extra) => MODULES['brand-lockup'].resolve(params, landscape(extra));
  assert.throws(() => resolve({eyebrow: 'x'}), /params\.mark or params\.wordmark is required/);
  assert.throws(() => resolve({...lockup, badge: 'assets/brand/badge.svg'}), /params\.badge is for the end variant/);
  assert.throws(() => resolve({...lockup, variant: 'end', url: 'pulse board.example'}), /params\.url must not contain spaces/);
  assert.throws(() => resolve({...lockup, tint: 'white'}), /params\.tint must be none, paper, ink, primary, accent or a six-digit hex colour/);
  assert.throws(() => resolve({mark: 'https://cdn.example.com/m.png'}), /params\.mark must be a project-local assets\/ path/);
  assert.throws(() => resolve({...lockup, wordmark: {src: 'assets/w.png', ratio: 20}}), /params\.wordmark\.ratio must be between 0\.2 and 12/);
  assert.throws(() => resolve({...lockup, headline: 'A headline that keeps going far past what two lines of display type can ever hold on one card'}), /params\.headline/);
  // A mark alone, or a wordmark alone, is a lockup too.
  assert.equal(resolve({mark: 'assets/m.png'}).content.wordmark, undefined);
  assert.equal(resolve({wordmark: 'assets/w.png'}).content.mark, undefined);
});

test('catalogue B: every module is registered in all three registries', async () => {
  const ids = ['function-chart', 'gauge-compare', 'flow-compare', 'process-steps', 'archive-card', 'logo-row', 'brand-lockup'];
  assert.deepEqual(Object.keys(MODULES).sort(), [...ids].sort());
  assert.deepEqual(Object.keys(EMITTERS).sort(), [...ids].sort());
  const registry = readFileSync(join(ROOT, 'kit/remotion/catalog/registry-b.ts'), 'utf8');
  for (const id of ids) {
    assert.match(registry, new RegExp(`'${id}': \\w+`));
    assert.equal(typeof MODULES[id].describe, 'string');
    assert.ok(Array.isArray(MODULES[id].events));
  }
  for (const file of readdirSync(FIXTURES).filter(name => /^b-cat-.*\.json$/.test(name))) {
    const fixture = JSON.parse(readFileSync(join(FIXTURES, file), 'utf8'));
    assert.ok(fixture.story.scenes.some(scene => scene.id === fixture.sceneId), file);
  }
});

test('HyperFrames: GSAP owns a moved transform; a lead tl.set restores it unless the start already sets it', () => {
  const node = (id, transform) => ({tag: 'div', id, style: {opacity: 0, transform}, children: []});
  const view = {tag: 'div', id: 'm', style: {}, children: [node('a', 'translate(-60px, 0px)'), node('b', 'translate(0px, 40px) scale(0.97, 0.97)'), node('c', 'translate(-50%, 0px)'), node('d', 'translate(0px, 8px)')]};
  const tween = target => ({type: 'tween', target, start: 1, duration: 0.5, ease: 'none', from: {x: -60}, to: {x: 0}});
  const ops = [{type: 'set', target: 'b', time: 2, props: {y: 40, scale: 0.97}}, tween('a'), tween('b'), tween('c')];
  const owned = gsapOwnedTransforms(view, ops, 2);
  const style = id => owned.view.children.find(child => child.id === id).style;
  assert.equal(style('a').transform, undefined);
  assert.equal(style('a').opacity, 0, 'only the transform comes off');
  assert.equal(style('b').transform, undefined);
  assert.equal(style('c').transform, 'translate(-50%, 0px)', 'a percentage GSAP x cannot express stays in the CSS');
  assert.equal(style('d').transform, 'translate(0px, 8px)', 'an element no op moves keeps its CSS');
  assert.deepEqual(owned.ops.slice(0, 1), [{type: 'set', target: 'a', time: 2, props: {x: -60, y: 0, rotation: 0, scaleX: 1, scaleY: 1}}]);
  assert.deepEqual(owned.ops.slice(1), ops, "b's own set at the start already owns its transform");
});
