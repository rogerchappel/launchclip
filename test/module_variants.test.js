// Module variants (docs/SEEDED_STYLES_RFC.md §3.2, phase 3): each module's
// designed looks, chosen by story.variants (a style's) or params.variant.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MODULES, VARIANTS, catalogGTimeline, catalogGView} from '../kit/core/catalog-g.mjs';
import {frameState} from '../kit/core/catalog-b-view.mjs';
import {moduleVariants, resolveModule} from '../kit/core/modules.mjs';
import {validateStory} from '../kit/core/story.mjs';
import {BRAND, SAMPLES} from '../scripts/variant-sheet.mjs';

const FORMATS = {'9:16': {width: 1080, height: 1920, fps: 30, duration: 10}, '16:9': {width: 1920, height: 1080, fps: 30, duration: 10}};
const story = (aspect, extra = {}) => ({schema: 'launchclip.story.v1', lane: 'motion', format: FORMATS[aspect], brand: BRAND, scenes: [], ...extra});
const scene = (module, params = {}) => ({id: 's1', module, start: 1, end: 5, params: {...SAMPLES[module], ...params}});
const resolve = (module, params, aspect = '9:16', extra) => resolveModule(scene(module, params), story(aspect, extra), {track: 2});
const inside = (a, b) => a.x >= b.x - 0.01 && a.y >= b.y - 0.01 && a.x + a.width <= b.x + b.width + 0.01 && a.y + a.height <= b.y + b.height + 0.01;
const WITH_VARIANTS = Object.keys(SAMPLES).filter(module => VARIANTS[module]?.length > 1);

test('modules with variants have at least three, the default first, listed by moduleVariants', () => {
  assert.ok(WITH_VARIANTS.length >= 3);
  const listed = moduleVariants();
  for (const module of WITH_VARIANTS) {
    assert.ok(VARIANTS[module].length >= 3, module);
    assert.equal(new Set(VARIANTS[module]).size, VARIANTS[module].length, `${module} names are unique`);
    assert.deepEqual(listed[module], VARIANTS[module]);
    assert.deepEqual(MODULES[module].variants, VARIANTS[module]);
    assert.match(MODULES[module].params.variant, /VARIANTS/);
  }
});

test('the default variant is the original render: naming it changes nothing', () => {
  for (const module of WITH_VARIANTS) for (const aspect of ['9:16', '16:9']) {
    const plain = resolve(module, {}, aspect), named = resolve(module, {variant: VARIANTS[module][0]}, aspect);
    assert.equal(plain.variant, VARIANTS[module][0]);
    assert.deepEqual(catalogGView(named), catalogGView(plain), `${module} ${aspect}`);
    assert.deepEqual(catalogGTimeline(named), catalogGTimeline(plain), `${module} ${aspect}`);
  }
});

test('the style picks the variant; a scene\'s params.variant wins', () => {
  const module = 'concept-card';
  assert.equal(resolve(module, {}, '9:16', {variants: {[module]: 'banner'}}).variant, 'banner');
  assert.equal(resolve(module, {variant: 'marker'}, '9:16', {variants: {[module]: 'banner'}}).variant, 'marker');
  // Another module's entry does not leak.
  assert.equal(resolve('icon-row', {}, '9:16', {variants: {[module]: 'banner'}}).variant, 'tiles');
});

test('an unknown variant name fails with the list of names', () => {
  assert.throws(() => resolve('concept-card', {variant: 'sparkly'}), /params\.variant must be one of stacked, side-icon, banner, marker \(the concept-card variants\); got "sparkly"/);
  assert.throws(() => resolve('icon-row', {}, '9:16', {variants: {'icon-row': 'grid'}}), /style variants\.icon-row must be one of tiles, pills, orbit, list/);
});

test('story.variants is validated as {module: name}', () => {
  const ok = {...story('9:16', {variants: {'concept-card': 'banner'}}), scenes: [scene('concept-card')]};
  assert.equal(validateStory(ok).errors.length, 0, JSON.stringify(validateStory(ok).errors));
  const bad = {...ok, variants: {'concept-card': 3}};
  assert.ok(validateStory(bad).errors.some(error => /variants\.concept-card must be a variant name/.test(error)));
  assert.ok(validateStory({...ok, variants: ['banner']}).errors.some(error => /variants must be/.test(error)));
});

test('every variant fits its box at both aspects, on a plate and over footage, with legible text', () => {
  for (const module of WITH_VARIANTS) for (const variant of VARIANTS[module]) for (const aspect of ['9:16', '16:9']) {
    const label = `${module}/${variant} ${aspect}`;
    const model = resolve(module, {variant}, aspect);
    assert.equal(model.variant, variant, label);
    assert.ok(model.content.layout.height <= model.rect.height + 0.01, `${label} fits the plate`);
    assert.ok(model.minTextPx >= (aspect === '9:16' ? 44 : 32), `${label} text ${model.minTextPx}`);
    // Over footage: wherever the default fits beside the presenter, so does
    // the variant (its own shape, or the default as a fallback).
    const overlay = v => resolve(module, {variant: v, surface: 'card'}, aspect, {lane: 'footage-led', base: {src: 'assets/recording.mp4'}});
    let fits = true;
    try { overlay(VARIANTS[module][0]); } catch { fits = false; }
    if (!fits) continue;
    const card = overlay(variant);
    assert.ok(inside(card.rect, card.safe), `${label} card inside the safe zone`);
  }
});

test('every variant draws its own shape where it has room, and shows all of it by the hold', () => {
  for (const module of WITH_VARIANTS) for (const variant of VARIANTS[module]) for (const aspect of ['9:16', '16:9']) {
    const model = resolve(module, {variant}, aspect);
    const ops = catalogGTimeline(model);
    const hold = frameState(ops, model.motion.exitStart - 0.05);
    for (const [id, props] of hold) {
      if (id === model.id) continue;
      if (props.opacity !== undefined) assert.ok(props.opacity >= 0.45, `${module}/${variant} ${aspect} ${id} opacity ${props.opacity}`);
      for (const key of ['scaleX', 'scaleY']) if (props[key] !== undefined) assert.equal(props[key], 1, `${module}/${variant} ${aspect} ${id} ${key}`);
    }
    // Before the first beat nothing of the content shows.
    const before = frameState(ops, model.start);
    assert.ok([...before].filter(([id]) => id !== model.id).every(([, props]) => props.opacity === undefined || props.opacity === 0 || props.scaleX === 0 || props.scaleY === 0), `${module}/${variant} ${aspect} starts hidden`);
  }
  // Variants are different looks, not one layout renamed.
  for (const module of WITH_VARIANTS) {
    const views = VARIANTS[module].map(variant => JSON.stringify(catalogGView(resolve(module, {variant}))));
    assert.equal(new Set(views).size, views.length, `${module} variants draw differently`);
  }
});

test('a variant that has no room falls back to the original look instead of failing', () => {
  const rect = {x: 140, y: 400, width: 800, height: 210};
  const model = resolve('concept-card', {variant: 'banner', rect, surface: 'plate', sub: undefined}, '9:16');
  assert.equal(model.variant, 'banner');
  assert.ok(model.content.layout.height <= rect.height + 0.01);
});

test('stat-card: the ticker rolls each digit slot and lands on the value as written; ring and bar fill to a stated share', () => {
  const ticker = resolve('stat-card', {variant: 'ticker', value: '$1,240', count: true});
  assert.equal(ticker.content.start, '$0,000');
  assert.ok(ticker.content.samples.every(sample => sample.text.length === '$1,240'.length));
  assert.equal(ticker.content.samples.at(-1).text, '$1,240');
  assert.equal(resolve('stat-card', {variant: 'ring'}).content.share, 0.87);
  assert.equal(resolve('stat-card', {variant: 'bar', value: '3.2×'}).content.share, 1);
});

test('quote-card: a one-line highlight sweeps in on a marker; every variant keeps the named attribution', () => {
  for (const variant of VARIANTS['quote-card'].slice(1)) {
    const model = resolve('quote-card', {variant});
    assert.equal(model.content.sweep, true, variant);
    assert.match(JSON.stringify(catalogGView(model)), /Priya Natarajan/);
  }
});

// Editorial modules (kit/core/editorial-core.mjs): variants restyle the shell
// and its entrance over the geometry the core measured.
import {EDITORIAL_VARIANTS, editorialVariantCss} from '../kit/core/editorial-core.mjs';
import {EMITTERS as EDITORIAL_EMITTERS} from '../kit/hyperframes/editorial-ui-modules.mjs';

const EDITORIAL = Object.keys(EDITORIAL_VARIANTS);

test('editorial variants: listed, at least three each, the default first and unstyled', () => {
  const listed = moduleVariants();
  for (const kind of EDITORIAL) {
    assert.ok(EDITORIAL_VARIANTS[kind].length >= 3, kind);
    assert.deepEqual(listed[kind], [...EDITORIAL_VARIANTS[kind]]);
    const model = resolve(kind, {});
    assert.equal(model.variant, 'panel');
    assert.equal(editorialVariantCss(model), '');
    assert.equal(model.motion.supplied, false);
  }
});

test('editorial variants keep the geometry, events and text; change the shell CSS and the entrance', () => {
  for (const kind of EDITORIAL) for (const aspect of ['9:16', '16:9']) {
    const base = resolve(kind, {}, aspect);
    for (const variant of EDITORIAL_VARIANTS[kind].slice(1)) {
      const model = resolve(kind, {variant}, aspect);
      assert.deepEqual(model.rect, base.rect, `${kind}/${variant} rect`);
      assert.deepEqual(model.content, base.content, `${kind}/${variant} content`);
      assert.deepEqual(model.events, base.events, `${kind}/${variant} events`);
      assert.equal(model.motion.enterDuration, base.motion.enterDuration);
      assert.notDeepEqual(model.motion.enterFrom, base.motion.enterFrom, `${kind}/${variant} entrance`);
      const css = EDITORIAL_EMITTERS[kind](model).css;
      assert.ok(editorialVariantCss(model).length > 0 && css.includes(editorialVariantCss(model)), `${kind}/${variant} css`);
      // Never a size: no width, height, padding, margin, font-size or border width.
      assert.doesNotMatch(editorialVariantCss(model), /(?:^|[{;])(?:width|height|padding|margin|font-size|font|border-width|letter-spacing)\s*:/, `${kind}/${variant}`);
    }
  }
});

test('editorial variants: the style picks, the scene wins, unknown names fail', () => {
  assert.equal(resolve('checklist', {}, '9:16', {variants: {checklist: 'banner'}}).variant, 'banner');
  assert.equal(resolve('checklist', {variant: 'flat'}, '9:16', {variants: {checklist: 'banner'}}).variant, 'flat');
  assert.throws(() => resolve('metric', {variant: 'neon'}), /variant must be one of panel, flat, outline, banner \(the metric variants\); got "neon"/);
  assert.throws(() => resolve('callout', {}, '9:16', {variants: {callout: 'neon'}}), /style variants\.callout must be one of panel, flat, outline, banner/);
  // A kind with no variants ignores the style's entries and refuses params.variant.
  const window_ = {schema: 'launchclip.story.v1', lane: 'motion', format: FORMATS['9:16'], brand: BRAND, scenes: [], variants: {'progress': 'flat'}};
  assert.throws(() => resolveModule({id: 's1', module: 'progress', start: 1, end: 5, params: {title: 'Upload', progress: {mode: 'illustration', unit: 'example percent', format: 'percent', values: [{value: 10, at: 0.4}, {value: 80, at: 1.2}]}, variant: 'flat'}}, window_), /progress has no designed variants/);
});
