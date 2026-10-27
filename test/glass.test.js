// The glass surface role (VISUAL_GAP_MAP D5): story.panel rim-glass, drawn by
// catalogue G's cards and opted into by catalogue H's window-chrome and
// comparison-table; the glass-explainer starter style that sets it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PANEL_TREATMENTS, contrast, glassSurface, panelFill, panelSurfaceStyle} from '../kit/core/panels.mjs';
import {SEED_PANEL_TREATMENTS} from '../kit/core/style-seed.mjs';
import {MODULES, catalogHTimeline, catalogHView} from '../kit/core/catalog-h.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-h.mjs';
import {cardSurface} from '../kit/core/catalog-g-base.mjs';
import {knownModules, resolveModule} from '../kit/core/modules.mjs';
import {applyStyle, validateStylePack} from '../kit/core/style.mjs';
import {STORY_PANEL_TREATMENTS, validateStory} from '../kit/core/story.mjs';
import {SAMPLES} from '../scripts/element-samples.mjs';

const pack = JSON.parse(readFileSync(new URL('../kit/styles/glass-explainer.json', import.meta.url), 'utf8'));
const brand = {colors: pack.brand.colors, fonts: {display: 'inter', body: 'inter', meta: 'jetbrains-mono'}};
const ctx = {id: 'scene', start: 0, duration: 6, format: {width: 1920, height: 1080, fps: 30}, brand, aspect: '16:9', hits: []};
const glassModel = (id, params = SAMPLES[id]) => ({...MODULES[id].resolve(params, ctx), module: id, panel: {treatment: 'rim-glass', radius: 22}});
const find = (node, id) => { if (!node || typeof node !== 'object') return null; if (node.id === id) return node; for (const child of node.children ?? []) { const hit = find(child, id); if (hit) return hit; } return null; };

test('rim-glass is a panel treatment in step with story.mjs, kept out of seeded styles', () => {
  assert.ok(PANEL_TREATMENTS.includes('rim-glass'));
  assert.deepEqual(STORY_PANEL_TREATMENTS, [...PANEL_TREATMENTS]);
  assert.ok(!SEED_PANEL_TREATMENTS.includes('rim-glass'), 'existing seeds keep their draw');
  assert.deepEqual(validateStory({schema: 'launchclip.story.v1', lane: 'motion', format: {width: 1920, height: 1080, fps: 30, duration: 2}, panel: {treatment: 'rim-glass'}, scenes: [{id: 's', module: 'metric', start: 0, end: 2}]}).errors.filter(e => /panel/.test(e)), []);
});

test('the rim-glass surface: translucent blurred fill, 1.5 px primary rim, outer glow and inner highlight', () => {
  const colors = pack.brand.colors;
  const style = panelSurfaceStyle('rim-glass', {colors, unit: 1, radius: 22});
  assert.match(style.backdropFilter, /^blur\(24px\)/);
  assert.match(style.border, new RegExp(`^1.5px solid ${colors.primary}`));
  assert.match(style.boxShadow, /^inset 0 1px 0 #ffffff/, 'inner highlight along the top edge');
  assert.match(style.boxShadow, new RegExp(`0 0 22px ${colors.primary}`), 'outer glow in the rim colour');
  assert.match(style.background, /^linear-gradient\(180deg/, 'top-lit sheen over the fill');
  const fill = panelFill('rim-glass', colors);
  assert.ok(fill.alpha < 1);
  // Over the darkest and a lifted plate tone, paper text keeps 4.5:1.
  for (const tone of [colors.bg, '#2a3442']) {
    const [a, b] = [tone, fill.color].map(hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)));
    const mixed = '#' + a.map((v, i) => Math.round(v + (b[i] - v) * fill.alpha).toString(16).padStart(2, '0')).join('');
    assert.ok(contrast(colors.paper, mixed) >= 4.5, `${tone} → ${mixed}`);
  }
});

test('glassSurface opts in only under rim-glass', () => {
  const model = glassModel('window-chrome');
  assert.ok(glassSurface(model));
  assert.equal(glassSurface({...model, panel: {treatment: 'glass'}}), null);
  assert.equal(glassSurface({...model, panel: undefined}), null);
});

test('window-chrome and comparison-table draw glass under rim-glass and their own look otherwise', () => {
  for (const variant of MODULES['window-chrome'].variants) {
    const model = glassModel('window-chrome', {...SAMPLES['window-chrome'], variant});
    const pane = find(catalogHView(model), `${model.id}-window`);
    assert.match(pane.style.backdropFilter, /blur/, variant);
    const plain = find(catalogHView({...model, panel: undefined}), `${model.id}-window`);
    assert.equal(plain.style.backdropFilter, undefined, variant);
  }
  for (const variant of MODULES['comparison-table'].variants) {
    const model = glassModel('comparison-table', {...SAMPLES['comparison-table'], variant});
    const view = catalogHView(model);
    const sheet = variant === 'cards' ? find(view, `${model.id}-colcard-0`) : find(view, `${model.id}-glass`);
    assert.match(sheet.style.backdropFilter, /blur/, variant);
    const ops = catalogHTimeline(model);
    assert.ok(ops.some(op => op.target === sheet.id && op.type === 'tween'), `${variant}: the glass rises in`);
    const out = EMITTERS['comparison-table'](model);
    assert.match(out.html, /backdrop-filter:blur/, variant);
    assert.equal(find(catalogHView({...model, panel: undefined}), `${model.id}-glass`), null, variant);
  }
});

test('catalogue G cards take rim-glass through the story panel', () => {
  const story = {schema: 'launchclip.story.v1', lane: 'motion', format: {width: 1920, height: 1080, fps: 30, duration: 6}, brand, panel: {treatment: 'rim-glass', radius: 22}};
  const params = {
    'stat-card': {value: '1.05M', label: 'tokens of context', source: 'Model card, Oct 2026'},
    excerpt: {lines: ['"model": "glass-6",', '"effort": "high"'], type: 'code', source: 'config.json'},
    'quote-card': {quote: 'Ship the build, not the cut.', author: 'A. Editor'}
  };
  for (const [id, own] of Object.entries(params)) {
    const model = resolveModule({id: 's', module: id, start: 0, end: 6, params: {...own, surface: 'card'}}, story);
    const card = cardSurface(model);
    assert.match(card.style.backdropFilter, /blur/, id);
    assert.match(card.style.boxShadow, /inset/, id);
  }
});

test('the glass-explainer starter validates and sets rim-glass and a cycling plate', () => {
  const {errors, warnings} = validateStylePack(pack, {modules: knownModules()});
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  const merged = applyStyle({schema: 'launchclip.story.v1', lane: 'motion', format: {width: 1920, height: 1080, fps: 30, duration: 6}, scenes: []}, pack);
  const story = merged.story ?? merged;
  assert.equal(story.panel.treatment, 'rim-glass');
  assert.deepEqual(story.plate, pack.plate);
  // White and cyan, one accent: paper and primary read on bg; accent is the only warm colour.
  assert.ok(contrast(pack.brand.colors.paper, pack.brand.colors.bg) >= 15);
  assert.ok(contrast(pack.brand.colors.primary, pack.brand.colors.bg) >= 7);
});
