// Catalogue H channel furniture (kit/core/catalog-h-channel.mjs): logo-sting,
// subscribe-cta and channel-watermark: registration, every variant in both
// aspects, glass surfaces, seek-safe weather and the CTA's beats.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MODULES, VARIANTS, catalogHTimeline, catalogHView} from '@launchclip/core/catalog-h.mjs';
import {frameState} from '@launchclip/core/catalog-b-view.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-h.mjs';
import {hyperframesEmitters} from '../kit/hyperframes/story-compiler.mjs';
import {knownModules} from '@launchclip/core/modules.mjs';
import {SAMPLES} from '../scripts/element-samples.mjs';

const brand = {colors: {bg: '#04070d', paper: '#f3f8ff', ink: '#04070d', primary: '#3fd8ff', accent: '#ff9b54'}, fonts: {display: 'inter', body: 'inter', meta: 'jetbrains-mono'}};
const light = {colors: {bg: '#f5f1e8', primary: '#0e7490', accent: '#c2410c', ink: '#f5f1e8', paper: '#14161c'}, fonts: brand.fonts};
const FORMATS = {'9:16': {width: 1080, height: 1920, fps: 30}, '16:9': {width: 1920, height: 1080, fps: 30}};
const ctx = (aspect = '16:9', overrides = {}) => ({id: 'scene', start: 2, duration: 6, format: FORMATS[aspect], brand, aspect, hits: [], ...overrides});
const resolve = (id, params = SAMPLES[id], aspect, overrides) => ({...MODULES[id].resolve(params, ctx(aspect, overrides)), module: id});
const IDS = ['logo-sting', 'subscribe-cta', 'channel-watermark'];
const find = (node, id) => { if (!node || typeof node !== 'object') return null; if (node.id === id) return node; for (const child of node.children ?? []) { const hit = find(child, id); if (hit) return hit; } return null; };

test('the channel modules are registered in the registry, both renderers and the samples', () => {
  for (const id of IDS) {
    assert.ok(knownModules().includes(id), id);
    assert.ok(EMITTERS[id] && hyperframesEmitters()[id], id);
    assert.ok(SAMPLES[id], id);
  }
  assert.deepEqual([...VARIANTS['logo-sting']], ['rain', 'particles', 'clear']);
  assert.deepEqual([...VARIANTS['subscribe-cta']], ['pill', 'compact']);
  assert.deepEqual([...VARIANTS['channel-watermark']], ['glass', 'bare']);
});

test('every variant resolves in both aspects on dark and light brands, inside its rect', () => {
  for (const id of IDS) for (const variant of VARIANTS[id]) for (const aspect of ['9:16', '16:9']) for (const b of [brand, light]) {
    const label = `${id}/${variant} ${aspect} ${b.colors.bg}`;
    const model = resolve(id, {...SAMPLES[id], variant}, aspect, {brand: b});
    const out = EMITTERS[id](model);
    assert.doesNotMatch(out.html + out.motion, /undefined|NaN/, label);
    const ids = [];
    const walk = node => { if (node && typeof node === 'object') { if (node.id) ids.push(node.id); (node.children ?? []).forEach(walk); } };
    walk(catalogHView(model));
    for (const target of new Set(catalogHTimeline(model).map(op => op.target))) assert.ok(ids.includes(target), `${label}: op target ${target} is in the view`);
    const box = model.content.pill ?? model.content.box ?? {x: model.content.tile.x, y: model.content.tile.y, width: model.content.tile.size, height: model.content.tile.size};
    assert.ok(box.x >= -1e-6 && box.y >= -1e-6 && box.x + box.width <= model.rect.width + 1e-6 && box.y + box.height <= model.rect.height + 1e-6, `${label}: inside the rect`);
  }
});

test('the furniture is glass whatever the story panel', () => {
  const sting = catalogHView(resolve('logo-sting'));
  const cta = catalogHView(resolve('subscribe-cta'));
  const mark = catalogHView(resolve('channel-watermark'));
  const glassy = node => JSON.stringify(node).includes('backdropFilter');
  assert.ok(glassy(find(sting, 'scene-mark')));
  assert.ok(glassy(find(cta, 'scene-pill')));
  assert.ok(glassy(find(mark, 'scene-mark')));
  assert.ok(!glassy(find(catalogHView(resolve('channel-watermark', {...SAMPLES['channel-watermark'], variant: 'bare'})), 'scene-mark')));
});

test('logo-sting: rain falls and particles rise as seek-safe loops; the logo lands, then the name', () => {
  for (const variant of ['rain', 'particles']) {
    const model = resolve('logo-sting', {...SAMPLES['logo-sting'], variant});
    const loops = catalogHTimeline(model).filter(op => op.type === 'loop');
    assert.equal(loops.length, 2, variant);
    for (const loop of loops) {
      assert.ok(loop.start <= model.start + 1e-6 && loop.start + loop.cycle * loop.repeats >= model.end - 1e-6, `${variant}: the loop covers the scene`);
      assert.ok(variant === 'rain' ? loop.to.y > loop.from.y : loop.to.y < loop.from.y, `${variant} direction`);
    }
    // Seeking is pure: the same time gives the same state whatever was asked before.
    const ops = catalogHTimeline(model);
    const a = frameState(ops, 4.2).get('scene-near'), b = (frameState(ops, 7.9), frameState(ops, 4.2).get('scene-near'));
    assert.deepEqual(a, b);
  }
  assert.equal(catalogHTimeline(resolve('logo-sting', {...SAMPLES['logo-sting'], variant: 'clear'})).filter(op => op.type === 'loop').length, 0);
  const model = resolve('logo-sting');
  const events = Object.fromEntries(model.events.map(e => [e.name, e.time]));
  assert.ok(events.name > events.logo);
  assert.equal(model.hidesCaptions, true);
  const settled = frameState(catalogHTimeline(model), model.motion.exitStart - 0.01);
  assert.equal(settled.get('scene-mark').opacity, 1);
  assert.equal(settled.get('scene-mark').blur, 0);
  assert.equal(settled.get('scene-name').opacity, 1);
  assert.match(MODULES['logo-sting'].resolve({name: 'X'}, ctx()).content.mark.monogram, /^X$/);
  assert.equal(resolve('logo-sting', {name: 'Signal Lab', logo: 'assets/logo.png'}).content.mark.logo, 'assets/logo.png');
});

test('subscribe-cta: slides in, clicks, turns to Subscribed, rings and slides out', () => {
  const model = resolve('subscribe-cta');
  const c = model.content;
  assert.deepEqual(model.events.map(e => e.name).filter(name => name !== 'enter'), ['in', 'click', 'bell', 'out']);
  assert.equal(model.hidesCaptions, false, 'it sits above the captions');
  const ops = catalogHTimeline(model);
  const before = frameState(ops, c.click - 0.05), after = frameState(ops, c.click + 0.5), gone = frameState(ops, model.end - 0.02);
  assert.equal(before.get('scene-sub').opacity, 1);
  assert.equal(before.get('scene-done').opacity, 0);
  assert.equal(after.get('scene-sub').opacity, 0);
  assert.equal(after.get('scene-done').opacity, 1);
  assert.equal(before.get('scene-pill').y, 0, 'settled before the click');
  assert.ok(gone.get('scene-pill').y > 0 && gone.get('scene-pill').opacity === 0, 'slid out downward');
  assert.ok(Math.abs(frameState(ops, c.click + 0.35 + 0.11 * 5 + 0.01).get('scene-bell').rotation) < 1e-6, 'the bell comes to rest');
  // Mid-video: an overlay on a later scene clicks on its own cue.
  const later = resolve('subscribe-cta', {...SAMPLES['subscribe-cta'], at: 2}, '16:9', {start: 30, duration: 5});
  assert.equal(later.content.click, 32);
  assert.throws(() => resolve('subscribe-cta', {...SAMPLES['subscribe-cta'], at: 4}, '16:9', {duration: 5}), /between the click and the slide out/);
  assert.throws(() => resolve('subscribe-cta', {name: 'The Weekly Machine Learning Show'}, '9:16'), /wider than the rect/);
  assert.equal(resolve('subscribe-cta', SAMPLES['subscribe-cta'], '9:16').content.likeBox, null, 'portrait drops the like');
});

test('channel-watermark sits in its corner at its opacity', () => {
  for (const corner of ['top-right', 'top-left', 'bottom-right', 'bottom-left']) {
    const model = resolve('channel-watermark', {...SAMPLES['channel-watermark'], corner, opacity: 0.5, showName: true});
    const {box} = model.content;
    assert.ok(corner.endsWith('right') ? Math.abs(box.x + box.width - model.rect.width) < 0.01 : box.x === 0, corner);
    assert.ok(corner.startsWith('bottom') ? Math.abs(box.y + box.height - model.rect.height) < 0.01 : box.y === 0, corner);
    assert.equal(frameState(catalogHTimeline(model), model.start + 3).get('scene-mark').opacity, 0.5);
  }
  assert.throws(() => resolve('channel-watermark', {...SAMPLES['channel-watermark'], opacity: 0.1}), /opacity/);
});

test('a story with a sting, a mid-video CTA over a card and a watermark passes the layout gate', async () => {
  const {checkLayoutProject} = await import('../src/layout_check.js');
  const {mkdtemp, rm, writeFile} = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'launchclip-channel-'));
  try {
    const story = {schema: 'launchclip.story.v1', lane: 'motion', format: {width: 1920, height: 1080, fps: 30, duration: 16}, brand, panel: {treatment: 'rim-glass'}, plate: 'bokeh',
      scenes: [
        {id: 'intro', module: 'logo-sting', start: 0, end: 4, params: {name: 'Signal Lab', tagline: 'AI, explained weekly'}},
        {id: 'card', module: 'window-chrome', start: 4, end: 12, params: {title: 'eval.yaml', lines: ['judge: glass-6', 'effort: high'], rect: {x: 96, y: 54, width: 1728, height: 560}}},
        {id: 'cta', module: 'subscribe-cta', track: 1, start: 6, end: 11, params: {name: 'Signal Lab'}},
        {id: 'outro', module: 'logo-sting', start: 12, end: 16, params: {name: 'Signal Lab', variant: 'particles'}},
        {id: 'bug', module: 'channel-watermark', track: 2, start: 4, end: 12, params: {name: 'Signal Lab'}}
      ], ending: {loop: false, final: 'hold'}};
    await writeFile(path.join(dir, 'storyboard.json'), JSON.stringify(story));
    const report = await checkLayoutProject(dir, {profile: 'landscape'});
    assert.deepEqual(report.findings.filter(f => f.severity === 'error'), []);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test('subscribe-cta never shows both button labels at once', () => {
  const model = resolve('subscribe-cta');
  const ops = catalogHTimeline(model);
  for (let t = model.content.click - 0.1; t < model.content.click + 0.5; t += 1 / 60) {
    const state = frameState(ops, t);
    assert.ok(Math.min(state.get('scene-sub').opacity, state.get('scene-done').opacity) < 0.02, `both labels at ${t}`);
  }
});
