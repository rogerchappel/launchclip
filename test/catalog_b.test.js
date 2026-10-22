import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import gsap from 'gsap';
import {MODULES, catalogBTimeline, catalogBView, contrastRatio, formatNumber, mixColor, parseExpression, sampleIndex} from '../kit/core/catalog-b.mjs';
import {createBase} from '../kit/core/catalog-b-base.mjs';
import {frameState, loopValue, propsToStyle, transformString} from '../kit/core/catalog-b-view.mjs';
import {EMITTERS, opsToGsap, renderNode} from '../kit/hyperframes/catalog-b.mjs';

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

/** Run emitted GSAP code against a real paused GSAP timeline on plain objects. */
export function gsapHarness(motion) {
  const targets = new Map();
  const target = selector => {
    if (!targets.has(selector)) targets.set(selector, {});
    return targets.get(selector);
  };
  const real = gsap.timeline({paused: true});
  const tl = {
    set: (selector, vars, position) => real.set(target(selector), vars, position),
    fromTo: (selector, from, to, position) => real.fromTo(target(selector), from, to, position),
    to: () => { throw new Error('emitters must use fromTo with explicit from values'); }
  };
  runInNewContext(motion, {tl});
  return {seek: t => { real.seek(t, false); return targets; }, targets};
}
const GSAP_KEYS = {text: 'textContent'};
export function assertMatchesFrameState(ops, motion, times, label = '') {
  const harness = gsapHarness(motion);
  for (const t of times) {
    const objects = harness.seek(t);
    const state = frameState(ops, t);
    for (const [id, props] of state) {
      const object = objects.get(`#${id}`);
      if (!object) continue;
      for (const [key, value] of Object.entries(props)) {
        const actual = object[GSAP_KEYS[key] ?? key];
        if (actual === undefined) continue; // not touched by GSAP yet: the static view holds it
        if (typeof value === 'number') assert.ok(Math.abs(actual - value) < 1e-3, `${label} ${id}.${key} at ${t}: gsap ${actual} vs frameState ${value}`);
        else assert.equal(String(actual), value, `${label} ${id}.${key} at ${t}`);
      }
    }
  }
}

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

test('function-chart: real Remotion still', {skip: !CHROME && 'Remotion Chrome is not installed'}, () => {
  assert.ok(remotionStill('function-chart', 16) > 20000);
});
