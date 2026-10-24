import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import gsap from 'gsap';
import {MODULES, BASE_CAMERA, cameraOps, cameraOverlaps, catalogCTimeline, catalogCView} from '../kit/core/catalog-c.mjs';
import {frameState} from '../kit/core/catalog-b-view.mjs';
import {EMITTERS, cameraGsap} from '../kit/hyperframes/catalog-c.mjs';
import {knownModules, resolveModule} from '../kit/core/modules.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const IDS = ['punch-in', 'zoom-through', 'footage-callout', 'lower-third', 'emphasis-caption', 'masthead', 'dolly-zoom'];
const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const format = {width: 1080, height: 1920, fps: 30, duration: 30};
const ctx = (overrides = {}) => ({id: 'scene', start: 2, duration: 3, format, brand, aspect: '9:16', ...overrides});
const resolve = (id, params, overrides) => ({...MODULES[id].resolve(params, ctx(overrides)), module: id});

const PARAMS = {
  'punch-in': {scale: 1.15, at: 0.4},
  'zoom-through': {},
  'footage-callout': {text: 'Recorded in one take', label: 'Raw footage', point: {x: 0.56, y: 0.45}},
  'lower-third': {name: 'Ada Park', title: 'Founder, LaunchClip'},
  'emphasis-caption': {text: 'Try it'},
  masthead: {word: 'focus'},
  'dolly-zoom': {}
};

// Real paused GSAP timeline on plain objects, fed the emitted code.
function gsapHarness(motion) {
  const targets = new Map();
  const target = selector => { if (!targets.has(selector)) targets.set(selector, {}); return targets.get(selector); };
  const real = gsap.timeline({paused: true});
  const tl = {
    set: (selector, vars, position) => real.set(target(selector), vars, position),
    fromTo: (selector, from, to, position) => real.fromTo(target(selector), from, to, position),
    to: () => { throw new Error('emitters must use fromTo with explicit from values'); }
  };
  runInNewContext(motion, {tl});
  return {seek: t => { real.seek(t, false); return targets; }};
}
function assertMatchesFrameState(ops, motion, times, selectorFor = id => `#${id}`) {
  const harness = gsapHarness(motion);
  for (const t of times) {
    const objects = harness.seek(t);
    for (const [id, props] of frameState(ops, t)) {
      const object = objects.get(selectorFor(id));
      if (!object) continue;
      for (const [key, value] of Object.entries(props)) {
        if (object[key] === undefined) continue;
        assert.ok(Math.abs(object[key] - value) < 1e-3, `${id}.${key} at ${t}: gsap ${object[key]} vs frameState ${value}`);
      }
    }
  }
}
function scrambledTimes(model) {
  const times = [];
  for (let t = model.start - 0.1; t <= model.end + 0.2; t += 7 / 30) times.push(t);
  times.push(...times.slice().reverse().filter((_, i) => i % 3 === 0));
  for (const event of model.events) times.push(event.time, event.time + 0.4, event.time - 0.01);
  return times;
}

function assertContract(model, id) {
  for (const key of ['id', 'module', 'canvas', 'start', 'duration', 'end', 'rect', 'motion', 'content', 'events', 'layout', 'hidesCaptions', 'theme']) assert.ok(key in model, `model.${key}`);
  assert.equal(model.module, id);
  for (const key of ['enterStart', 'enterEnd', 'exitStart', 'end', 'enterFrom', 'exitTo', 'enterEase', 'exitEase']) assert.ok(key in model.motion, `motion.${key}`);
  for (const key of ['surface', 'foreground', 'muted', 'border', 'accentText']) assert.match(model.theme[key], /^#[0-9a-f]{6}$/);
  assert.deepEqual(model.layout.rect, model.rect);
  assert.deepEqual(Object.keys(model.layout.motion), ['enterEnd', 'exitStart', 'end']);
  for (const [pair, ratio] of Object.entries(model.contrast)) assert.ok(ratio >= 3, `${pair} contrast ${ratio}`);
  for (const event of model.events) {
    assert.match(event.id, new RegExp(`^${model.id}-`));
    assert.ok(event.time >= model.start - 1e-9 && event.time <= model.end + 1e-9, `${event.id} inside the scene`);
  }
  if (model.layout.role !== 'decor') {
    const r = model.rect, bottom = model.hidesCaptions ? 1450 : 1160;
    assert.ok(r.x >= 80 - 1e-6 && r.x + r.width <= 940 + 1e-6, `${id} rect x inside the safe zone`);
    assert.ok(r.y >= 280 - 1e-6 && r.y + r.height <= bottom + 1e-6, `${id} rect y inside the safe zone`);
    assert.ok(model.minTextPx >= 44, `${id} key text ≥ 44 px`);
  }
  assert.ok(model.events.some(event => event.cue), `${id} has a cued event`);
  assert.deepEqual(JSON.parse(JSON.stringify(model)), model, 'model is JSON-only');
}

test('catalogue C: registered in modules.mjs, the HyperFrames emitters and the Remotion registry', () => {
  assert.deepEqual(Object.keys(MODULES).sort(), [...IDS].sort());
  assert.deepEqual(Object.keys(EMITTERS).sort(), [...IDS].sort());
  for (const id of IDS) {
    assert.ok(knownModules().includes(id), id);
    assert.equal(typeof MODULES[id].describe, 'string');
    assert.ok(Array.isArray(MODULES[id].events) && MODULES[id].events.length);
  }
  const registry = readFileSync(join(ROOT, 'kit/remotion/catalog/registry-c.ts'), 'utf8');
  for (const id of IDS) assert.match(registry, new RegExp(`'${id}': \\w+`));
  assert.match(readFileSync(join(ROOT, 'kit/remotion/modules/index.ts'), 'utf8'), /CATALOG_C/);
  assert.ok(knownModules().includes('callout'), 'the editorial callout keeps its id');
});

for (const id of IDS) {
  test(`${id}: model contract, emitter shape and seek-safe GSAP matching the Remotion evaluator`, () => {
    const model = resolve(id, PARAMS[id]);
    assertContract(model, id);
    const out = EMITTERS[id](model);
    assert.deepEqual(Object.keys(out).sort(), ['css', 'events', 'html', 'layout', 'motion']);
    assert.match(out.html, new RegExp(`^<div id="${model.id}" class="clip lc-catalog-c" data-start="2" data-duration="3" data-track-index="2" data-module="${id}"`));
    assert.doesNotMatch(out.html, /https?:\/\//);
    const ops = catalogCTimeline(model);
    for (const op of ops) assert.ok(out.html.includes(`id="${op.target}"`), `target ${op.target} exists`);
    for (const line of out.motion.split('\n')) assert.match(line, /^tl\.(set|fromTo)\(/);
    assert.ok(out.motion.split('\n').filter(line => line.startsWith('tl.fromTo')).every(line => line.includes('"immediateRender":false')));
    assert.doesNotMatch(out.motion, /onUpdate|onComplete|Date|performance|Math\.random|requestAnimationFrame/);
    assertMatchesFrameState(ops, out.motion, scrambledTimes(model));
    assert.equal(catalogCView(model).id, model.id);
  });
}

test('punch-in: a frame-pure spring camera toward the focus, back to identity at the end', () => {
  const model = resolve('punch-in', {scale: 1.2, focus: {x: 0.3, y: 0.25}, at: 0.5, release: 0.6});
  const {samples, focus, punchAt, releaseAt} = model.camera;
  assert.deepEqual(focus, {x: 324, y: 480});
  assert.equal(punchAt, 2.5);
  assert.equal(releaseAt, 4.4);
  assert.equal(samples.length, 91);
  for (let i = 1; i < samples.length; i++) assert.ok(Math.abs(samples[i].t - samples[i - 1].t - 1 / 30) < 1e-3);
  assert.ok(samples.every(s => s.scale >= 1 && s.scale <= 1.2 * 1.03), 'never below 1, small overshoot only');
  assert.ok(samples.filter(s => s.t < punchAt).every(s => s.scale === 1));
  const held = samples.find(s => Math.abs(s.t - 4.2) < 1e-6);
  assert.ok(Math.abs(held.scale - 1.2) < 0.003, `held at the target (${held.scale})`);
  assert.deepEqual({scale: samples.at(-1).scale, x: samples.at(-1).x, y: samples.at(-1).y}, {scale: 1, x: 0, y: 0});
  // Scaling about the focus keeps the focus fixed and the frame covered.
  for (const s of samples) {
    const sx = 540 + (focus.x - 540) * s.scale + s.x, sy = 960 + (focus.y - 960) * s.scale + s.y;
    assert.ok(Math.abs(sx - focus.x) < 0.02 && Math.abs(sy - focus.y) < 0.02);
    assert.ok(540 - 540 * s.scale + s.x <= 1e-6 && 540 + 540 * s.scale + s.x >= 1080 - 1e-6);
  }
  // Re-resolving gives identical samples (no state between calls).
  assert.deepEqual(resolve('punch-in', {scale: 1.2, focus: {x: 0.3, y: 0.25}, at: 0.5, release: 0.6}).camera, model.camera);
  assert.equal(model.layout.role, 'decor');
  assert.equal(model.hidesCaptions, false);
});

test('punch-in: hits time the punch; base.focus is the default focus; strict validation', () => {
  const r = MODULES['punch-in'].resolve;
  assert.equal(r({}, ctx({hits: [{at: 3.1, event: 'punch'}]})).camera.punchAt, 3.1);
  assert.deepEqual(r({}, ctx({base: {focus: {x: 0.5, y: 0.36}}})).camera.focus, {x: 540, y: 691.2});
  assert.throws(() => r({scale: 1.3}, ctx()), /params\.scale must be between 1\.06 and 1\.25/);
  assert.throws(() => r({scale: 1.02}, ctx()), /params\.scale must be between/);
  assert.throws(() => r({zoom: 2}, ctx()), /params\.zoom is not supported/);
  assert.throws(() => r({focus: {x: 2, y: 0}}, ctx()), /params\.focus\.x must be between 0 and 1/);
  assert.throws(() => r({at: 2.8}, ctx()), /params\.at must fall between 0 s and/);
  assert.throws(() => r({}, ctx({duration: 0.5})), /duration must be between 0\.8/);
});

test('cameraOps merges cameras on the base target; GSAP on the base videos matches frameState', () => {
  const a = {...resolve('punch-in', {at: 0.2}), sceneId: 'a'};
  const b = {...resolve('punch-in', {at: 0.1}, {id: 'later', start: 6, duration: 2}), sceneId: 'b'};
  const ops = cameraOps([b, a, {camera: null}]);
  assert.equal(ops[0].time, 0);
  assert.deepEqual(ops[0].props, {x: 0, y: 0, scaleX: 1, scaleY: 1});
  assert.ok(ops.every(op => op.target === BASE_CAMERA && op.type === 'set'));
  assert.equal(ops.length, 1 + a.camera.samples.length + b.camera.samples.length);
  const code = cameraGsap([a, b]);
  assert.ok(code.every(line => line.startsWith('tl.set(".lc-base-media", ')));
  const times = [0, 2.3, 2.45, 3.9, 4.99, 5.5, 6.2, 7.99, 9, 2.6, 6.1, 0.5];
  assertMatchesFrameState(ops, code.join('\n'), times, () => '.lc-base-media');
  assert.deepEqual(cameraOverlaps([a, b]), []);
  assert.deepEqual(cameraOverlaps([a, {...b, start: 4, end: 6}]), [['a', 'b']]);
  assert.deepEqual(cameraOps([]), []);
});

test('footage-callout: placed beside the point inside the safe zone, leader anchored on the sticker', () => {
  const model = resolve('footage-callout', PARAMS['footage-callout']);
  const c = model.content;
  assert.equal(c.side, 'above');
  assert.deepEqual(c.point, {x: 604.8, y: 864});
  assert.ok(c.box.y + c.box.height < c.point.y, 'sticker sits above the point');
  assert.ok(Math.hypot(c.anchor.x - c.point.x, c.anchor.y - c.point.y) >= 100, 'leader line is visible');
  assert.deepEqual(model.events.map(event => [event.name, event.cue]), [['point', 'tick'], ['sticker', 'pop']]);
  assert.equal(model.content.label, 'RAW FOOTAGE');
  // Low on the frame → above; near the top → below; sides when needed.
  assert.equal(resolve('footage-callout', {text: 'Here', point: {x: 0.5, y: 0.2}}).content.side, 'below');
  assert.equal(resolve('footage-callout', {text: 'Here', point: {x: 0.5, y: 0.5}, side: 'left'}).content.side, 'left');
  assert.equal(resolve('footage-callout', {text: 'Hit', point: {x: 0.5, y: 0.5}}, {hits: [{at: 2.7, event: 'point'}]}).content.times.dot, 2.7);
});

test('footage-callout: strict validation, contrast per tone, safe-zone failures', () => {
  const r = (params, o) => MODULES['footage-callout'].resolve(params, ctx(o));
  assert.throws(() => r({point: {x: 0.5, y: 0.5}}), /params\.text is required/);
  assert.throws(() => r({text: 'x'.repeat(43), point: {x: 0.5, y: 0.5}}), /params\.text must be a string of 1–42/);
  assert.throws(() => r({text: '<b>', point: {x: 0.5, y: 0.5}}), /angle brackets/);
  assert.throws(() => r({text: 'Hi', point: {x: 0.99, y: 0.5}}), /params\.point\.x must be between 0\.04 and 0\.96/);
  assert.throws(() => r({text: 'Hi', point: {x: 0.5, y: 0.5}, tone: 'neon'}), /params\.tone must be one of primary, paper, dark/);
  assert.throws(() => r({text: 'Hi', point: {x: 0.5, y: 0.17}, side: 'above'}), /params\.side leaves no room/);
  const dim = {...brand, colors: {...brand.colors, ink: '#3a3a3a', primary: '#444444'}};
  assert.throws(() => r({text: 'Hi', point: {x: 0.5, y: 0.5}}, {brand: dim}), /params\.text on the primary sticker has contrast/);
  const dark = MODULES['footage-callout'].resolve({text: 'Hi', point: {x: 0.5, y: 0.5}, tone: 'dark'}, ctx());
  assert.ok(dark.contrast['text/sticker'] > 10);
});

test('lower-third: sits on the caption band edge, left or centred; strict validation', () => {
  const model = resolve('lower-third', PARAMS['lower-third']);
  assert.equal(model.rect.x, 80);
  assert.ok(Math.abs(model.rect.y + model.rect.height - 1160) < 0.05, 'bottom edge on the caption gap');
  assert.equal(model.content.nameSize, 62);
  assert.equal(model.content.titleSize, 44);
  const centred = resolve('lower-third', {name: 'Ada Park', align: 'center'});
  assert.ok(Math.abs(centred.rect.x + centred.rect.width / 2 - 510) < 0.05);
  assert.equal(centred.events.length, 1);
  const r = params => MODULES['lower-third'].resolve(params, ctx());
  assert.throws(() => r({title: 'x'}), /params\.name is required/);
  assert.throws(() => r({name: 'x'.repeat(33)}), /params\.name must be a string of 1–32/);
  assert.throws(() => r({name: 'Ada', tone: 'glass'}), /params\.tone must be one of dark, primary/);
  assert.throws(() => MODULES['lower-third'].resolve({name: 'Ada'}, ctx({duration: 1.5})), /duration must be between 2/);
});

test('emphasis-caption: hides captions, pops words on a stagger, outlined for contrast', () => {
  const model = resolve('emphasis-caption', {text: 'Ship it today', stagger: 0.1});
  assert.equal(model.hidesCaptions, true);
  assert.deepEqual(model.content.words.map(word => [word.text, word.time]), [['Ship', 2.05], ['it', 2.15], ['today', 2.25]]);
  assert.ok(model.minTextPx >= 96);
  assert.ok(model.rect.width / 860 >= 0.7 && model.rect.width / 860 <= 0.9, 'hero fill 70–90%');
  assert.equal(model.events[0].cue, 'impact');
  const upper = resolve('emphasis-caption', {text: 'Wow', position: 'upper'});
  const lower = resolve('emphasis-caption', {text: 'Wow', position: 'lower'});
  assert.ok(upper.rect.y < model.rect.y && lower.rect.y > model.rect.y);
  const r = params => MODULES['emphasis-caption'].resolve(params, ctx());
  assert.throws(() => r({text: 'one two three four'}), /must be 1–3 words/);
  assert.throws(() => r({text: 'Hi', color: '#0a0a0a'}), /params\.color \(#0a0a0a\) on brand\.colors\.bg \(outline\) has contrast/);
  assert.throws(() => r({text: 'Hi', position: 'side'}), /params\.position must be one of center, upper, lower/);
});

test('landscape canvases keep catalogue C boxes in the title-safe zone', () => {
  const wide = {format: {width: 1920, height: 1080, fps: 30}, aspect: '16:9'};
  for (const id of IDS.filter(id => !['punch-in', 'zoom-through', 'dolly-zoom'].includes(id))) {
    const model = resolve(id, id === 'footage-callout' ? {text: 'Here', point: {x: 0.6, y: 0.5}} : PARAMS[id], wide);
    const r = model.rect;
    assert.ok(r.x >= 96 - 1e-6 && r.x + r.width <= 1824 + 1e-6 && r.y >= 54 - 1e-6, `${id} ${JSON.stringify(r)}`);
  }
});

test('resolveModule passes the story base to punch-in and catalogue C models carry sceneId', () => {
  const story = {schema: 'launchclip.story.v1', lane: 'footage-led', format: {width: 1080, height: 1920, fps: 30, duration: 10}, brand,
    base: {src: 'assets/r.mp4', focus: {x: 0.4, y: 0.3}}, scenes: [{id: 'p', module: 'punch-in', track: 1, start: 1, end: 3}], resolved: {duration: 10, fps: 30, frames: 300}};
  const model = resolveModule(story.scenes[0], story, {track: 6});
  assert.deepEqual(model.camera.focus, {x: 432, y: 576});
  assert.equal(model.sceneId, 'p');
  assert.equal(model.track, 6);
});

test('punch-in steps: punch in, further in and back out on successive words', () => {
  const model = resolve('punch-in', {steps: [{at: 0.2, scale: 1.12}, {at: 1.0, scale: 1.3}, {at: 1.8, scale: 1.06}], release: 0.4}, {duration: 3});
  const {samples, steps} = model.camera;
  const scaleAt = (t) => samples.reduce((best, s) => (Math.abs(s.t - t) < Math.abs(best.t - t) ? s : best)).scale;
  assert.deepEqual(steps.map((step) => step.at), [2.2, 3, 3.8]);
  assert.ok(Math.abs(scaleAt(2.9) - 1.12) < 0.01, `first step settles at 1.12 (${scaleAt(2.9)})`);
  assert.ok(Math.abs(scaleAt(3.7) - 1.3) < 0.01, `second step settles at 1.3 (${scaleAt(3.7)})`);
  assert.ok(Math.abs(scaleAt(4.5) - 1.06) < 0.01, `third step settles at 1.06 (${scaleAt(4.5)})`);
  assert.deepEqual(samples.at(-1), {t: 5, scale: 1, x: 0, y: 0});
  assert.deepEqual(model.events.map((event) => event.name), ['punch', 'step-1', 'step-2', 'release']);
  assert.equal(model.events.find((event) => event.name === 'step-2').cue, 'whoosh-soft', 'a zoom-out step gets the soft whoosh');
  assert.equal(model.camera.scale, 1.3);
});

test('punch-in steps: strict validation', () => {
  const r = (params) => () => resolve('punch-in', params, {duration: 3});
  assert.throws(r({steps: [{at: 0.2, scale: 1.1}], at: 0.2}), /replaces at and scale/);
  assert.throws(r({steps: []}), /1–4 steps/);
  assert.throws(r({steps: [{at: 0.2, scale: 1.1}, {at: 0.3, scale: 1.2}]}), /at least 0\.3 s after/);
  assert.throws(r({steps: [{at: 0.2, scale: 1.1}, {at: 0.8, scale: 1.11}]}), /differ from the step before it/);
  assert.throws(r({steps: [{at: 0.2, scale: 1.02}]}), /must zoom in/);
  assert.throws(r({steps: [{at: 0.2, scale: 1.5}]}), /params\.steps\[0\]\.scale/);
});

test('punch-in blur: velocity-shaped, zero once settled and at the end', () => {
  const model = resolve('punch-in', {scale: 1.2, at: 0.5, blur: true});
  const {samples} = model.camera;
  const moving = samples.filter((s) => s.t > 2.5 && s.t < 2.6);
  assert.ok(moving.some((s) => s.blur > 1), `blur while the zoom moves (${moving.map((s) => s.blur)})`);
  assert.ok(samples.every((s) => s.blur <= 14 + 1e-9), 'capped at 14 px at 1080');
  const settled = samples.filter((s) => s.t > 3.5 && s.t < 4.4);
  assert.ok(settled.every((s) => s.blur === 0), 'no blur once settled');
  assert.equal(samples.at(-1).blur, 0);
  const ops = cameraOps([model]);
  assert.ok(ops.some((op) => /^blur\(/.test(op.props.filter ?? '')));
  assert.equal(ops.at(-1).props.filter, 'none');
  // A room filter rides along in every blurred sample.
  const withRoom = cameraOps([model], {roomFilterAt: () => 'brightness(0.6)'});
  assert.ok(withRoom.some((op) => /^brightness\(0\.6\) blur\(/.test(op.props.filter ?? '')));
  assert.equal(withRoom.at(-1).props.filter, 'brightness(0.6)');
  // Without blur, samples carry no filter at all.
  assert.ok(resolve('punch-in', {scale: 1.2, at: 0.5}).camera.samples.every((s) => s.blur === undefined));
  assert.ok(cameraGsap([model]).some((line) => /filter/.test(line)));
});

const head = (x, y, width, height) => ({subject: {available: true, framing: 'medium', head: {x, y, width, height}, plate: {src: 'assets/subject/a.plate.jpg', fit: 'cover', focus: {x: 0.5, y: 0.5}}, placement: 'measured'}});

test('masthead: one big word whose baseline sits on the head, behind the subject', () => {
  const model = resolve('masthead', {word: 'focus', kicker: 'issue 01'}, head(400, 600, 280, 360));
  assert.equal(model.layer, 'behind');
  assert.equal(model.content.word, 'FOCUS');
  assert.equal(model.content.placement, 'measured');
  const baseline = model.rect.y + model.content.kickerH + model.content.lineH;
  // By default the baseline rises until the head covers at most 30% of the cap height.
  assert.ok(baseline > 600 && baseline <= 600 + 360 * 0.35 + 1e-6, `baseline ${baseline}`);
  assert.ok(model.content.covered > 0.2 && model.content.covered <= 0.3 + 0.01, `the head covers part of the letters (${model.content.covered})`);
  assert.equal(model.content.baseline, Math.round(((baseline - 600) / 360) * 100) / 100);
  // params.baseline places it exactly: 0.35 is the deepest.
  const deep = resolve('masthead', {word: 'focus', kicker: 'issue 01', baseline: 0.35}, head(400, 600, 280, 360));
  assert.ok(Math.abs(deep.rect.y + deep.content.kickerH + deep.content.lineH - (600 + 360 * 0.35)) < 1);
  assert.ok(deep.content.covered > model.content.covered);
  assert.throws(() => resolve('masthead', {word: 'focus', baseline: 0.5}, head(400, 600, 280, 360)), /params\.baseline/);
  assert.ok(model.rect.y >= model.safe.y - 1e-6, 'inside the safe zone');
  assert.deepEqual(model.events.map((event) => event.name), ['title']);
  assert.equal(model.content.letters.length, 5);
});

test('masthead: shrinks into the headroom, and refuses a head with none', () => {
  const roomy = resolve('masthead', {word: 'scale'}, head(400, 700, 280, 360));
  const tight = resolve('masthead', {word: 'scale'}, head(400, 360, 280, 360));
  assert.ok(tight.content.size < roomy.content.size);
  assert.throws(() => resolve('masthead', {word: 'scale'}, head(400, 200, 280, 360)), /needs headroom/);
  assert.throws(() => resolve('masthead', {word: 'two words'}), /must be one word/);
  assert.equal(resolve('masthead', {word: 'edit'}).content.placement, 'default', 'without a matte summary it uses the default head');
});

test('masthead: key glyphs from the text metrics, centred on the word and standing on its baseline', () => {
  const model = resolve('masthead', {word: 'focus'}, head(400, 600, 280, 360));
  const glyphs = MODULES.masthead.glyphs(model);
  assert.deepEqual(glyphs.map((glyph) => glyph.char), ['F', 'O', 'C', 'U', 'S']);
  const c = model.content, R = model.rect;
  const left = glyphs[0].x, right = glyphs.at(-1).x + glyphs.at(-1).width;
  assert.ok(Math.abs((left + right) / 2 - (R.x + R.width / 2)) < 1e-6, 'centred in the rect');
  assert.ok(Math.abs(glyphs[1].x - glyphs[0].x - c.size * 0.57) < 1e-6, 'one advance apart');
  for (const glyph of glyphs) {
    assert.ok(Math.abs(glyph.height - c.size * 0.72) < 1e-6, 'cap height');
    assert.ok(Math.abs(glyph.y + glyph.height - (R.y + c.kickerH + c.lineH - c.size * 0.05)) < 1e-6, 'on the baseline');
  }
});

test('dolly-zoom: scales the room plate, holds the subject still, needs room', () => {
  const model = resolve('dolly-zoom', {scale: 1.4, at: 0.2, move: 1.4}, {...head(400, 500, 280, 360), duration: 3});
  assert.equal(model.layer, 'behind');
  assert.ok(model.subjectCamera.samples.every((s) => s.scale === 1 && s.x === 0 && s.y === 0));
  assert.equal(model.content.plate.src, 'assets/subject/a.plate.jpg');
  assert.deepEqual(model.content.origin, {x: 540, y: 680});
  const ops = catalogCTimeline(model);
  const room = (t) => frameState(ops, t).get('scene-room');
  assert.equal(room(2.1).scaleX, 1);
  assert.ok(Math.abs(room(3.65).scaleX - 1.4) < 1e-6);
  assert.ok(Math.abs(room(4.99).scaleX - 1) < 0.02, 'eased back before the scene ends');
  assert.throws(() => resolve('dolly-zoom', {}, {subject: {framing: 'close-up', head: null}}), /needs room around the presenter/);
  assert.throws(() => resolve('dolly-zoom', {direction: 'pull', release: 0.5}, head(400, 500, 280, 360)), /applies to a push only/);
  const pull = resolve('dolly-zoom', {direction: 'pull'}, head(400, 500, 280, 360));
  assert.equal(pull.content.from, 1.3);
  assert.equal(pull.content.to, 1);
  // Without a plate yet (before matting) it draws nothing rather than failing.
  const bare = resolve('dolly-zoom', {});
  assert.equal(bare.content.plate, null);
  assert.deepEqual(catalogCView(bare).children, []);
});

test('zoom-through: rushes into the edit\'s cut and bursts out of the next take', () => {
  // The base cuts at timeline 3.0 (between two trim segments).
  const base = {focus: {x: 0.5, y: 0.4}, segments: [{index: 0, start: 0, end: 3, duration: 3, sourceStart: 0}, {index: 1, start: 3, end: 10, duration: 7, sourceStart: 5}]};
  const model = resolve('zoom-through', {}, {base, start: 2.4, duration: 1.4});
  const {samples, cut, onCut, scale} = model.camera;
  assert.equal(cut, 3);
  assert.equal(onCut, true);
  const at = (t) => samples.reduce((best, s) => (Math.abs(s.t - t) < Math.abs(best.t - t) ? s : best));
  assert.equal(at(2.6).scale, 1, 'untouched before the rush');
  assert.ok(at(2.97).scale > 2, 'nearly at full scale just before the cut');
  assert.ok(Math.abs(at(3).scale - scale) < 1e-6, 'the cut lands at full scale');
  assert.equal(at(3.5).scale, 1, 'back to framing after the burst');
  assert.ok(at(2.97).blur > 5 && at(3.03).blur > 5, 'blurred either side of the cut');
  assert.equal(at(3.5).blur, 0);
  assert.deepEqual(samples.at(-1), {t: 3.8, scale: 1, x: 0, y: 0, blur: 0});
  assert.deepEqual(model.events.map((event) => event.name), ['rush', 'cut']);
});

test('zoom-through: no cut in the edit means a fake cut mid-scene; strict validation', () => {
  const model = resolve('zoom-through', {blur: false}, {duration: 2});
  assert.equal(model.camera.cut, 3);
  assert.equal(model.camera.onCut, false);
  assert.ok(model.camera.samples.every((s) => s.blur === undefined));
  assert.throws(() => resolve('zoom-through', {at: 0.1}), /params\.at/);
  assert.throws(() => resolve('zoom-through', {scale: 5}), /params\.scale/);
  // Focus defaults to the presenter's face when the subject is known.
  const faced = resolve('zoom-through', {}, {subject: {head: {x: 400, y: 500, width: 280, height: 300}}});
  assert.deepEqual(faced.camera.focus, {x: 540, y: 710});
});
