// concept-card and icon-row looks beyond the box (kit/core/catalog-g-looks.mjs),
// optional icons, the measured rule and relevantIcon.
import test from 'node:test';
import assert from 'node:assert/strict';
import {VARIANTS, catalogGTimeline, catalogGView} from '@launchclip/core/catalog-g.mjs';
import {CONCEPT_LOOKS, ICON_ROW_LOOKS} from '@launchclip/core/catalog-g-looks.mjs';
import {ICON_ALIASES, isIcon, relevantIcon} from '@launchclip/core/icons.mjs';
import {resolveModule} from '@launchclip/core/modules.mjs';
import {BRAND, SAMPLES} from '../scripts/variant-sheet.mjs';

const FORMATS = {'9:16': {width: 1080, height: 1920, fps: 30, duration: 10}, '16:9': {width: 1920, height: 1080, fps: 30, duration: 10}};
const resolve = (module, params, aspect = '9:16', extra = {}) => resolveModule({id: 's1', module, start: 1, end: 6, params: {...SAMPLES[module], ...params}},
  {schema: 'launchclip.story.v1', lane: 'motion', format: FORMATS[aspect], brand: BRAND, scenes: [], ...extra}, {track: 2});
const nodes = (tree, out = []) => { for (const node of [tree].flat()) { if (!node || typeof node !== 'object') continue; out.push(node); nodes(node.children ?? [], out); } return out; };
const footage = {lane: 'footage-led', base: {src: 'assets/recording.mp4'}};
// The looks that keep their shape under a presenter's head in 9:16 (dropping the icon if need be).
const KEEPS = ['free', 'scrim', 'chips', 'ticks'];

test('the looks are listed after the original variants', () => {
  assert.deepEqual(VARIANTS['concept-card'].slice(4), [...CONCEPT_LOOKS]);
  assert.deepEqual(VARIANTS['icon-row'].slice(4), [...ICON_ROW_LOOKS]);
});

test('a look draws its own shape with no card under it, even over footage', () => {
  for (const [module, looks] of [['concept-card', CONCEPT_LOOKS], ['icon-row', ICON_ROW_LOOKS]]) for (const variant of looks) for (const aspect of ['9:16', '16:9']) {
    const model = resolve(module, {variant, surface: 'card'}, aspect, footage);
    // Short of room beside the presenter a look falls back to the original card (a tilted sticker, a stack of tags).
    if (KEEPS.includes(variant) || aspect === '16:9') assert.equal(model.content.layout.mode, variant, `${module}/${variant} ${aspect}`);
    if (model.content.layout.mode !== variant) continue;
    assert.ok(!nodes(catalogGView(model)).some(node => node.id === `${model.id}-card`), `${module}/${variant} ${aspect} draws no card`);
  }
});

test('every look breathes once it is in, and is at rest by the exit', () => {
  for (const [module, looks] of [['concept-card', CONCEPT_LOOKS], ['icon-row', ICON_ROW_LOOKS]]) for (const variant of looks) {
    const model = resolve(module, {variant});
    const idle = catalogGTimeline(model).filter(op => op.type === 'tween' && /-idle$/.test(op.target));
    assert.ok(idle.length >= 2, `${module}/${variant} idles`);
    const last = Math.max(...model.events.map(event => event.time));
    assert.ok(idle.every(op => op.start >= last - 1 && op.start + op.duration <= model.motion.exitStart + 1e-6), `${module}/${variant} idles between the build and the exit`);
  }
});

test('icon-row items need no icon, and none is drawn without one', () => {
  const items = [{label: 'Merbau'}, {label: 'Spotted gum'}, {label: 'Blackbutt'}];
  for (const variant of VARIANTS['icon-row']) for (const aspect of ['9:16', '16:9']) {
    const model = resolve('icon-row', {variant, items}, aspect);
    const svgs = nodes(catalogGView(model)).filter(node => node.tag === 'svg');
    // ticks bullets each row with a check; nothing else draws an icon.
    assert.equal(svgs.length, variant === 'ticks' ? 3 : 0, `${variant} ${aspect}`);
  }
});

test('the side-icon rule is as wide as the word, not a set bar', () => {
  const model = resolve('concept-card', {variant: 'side-icon', text: 'Really oil it?', sub: 'Be honest'});
  const all = nodes(catalogGView(model));
  const rule = all.find(node => node.id === `${model.id}-rule`);
  assert.equal(rule.style.width, undefined);
  const wrap = all.find(node => node.children?.includes(rule));
  assert.equal(wrap.style.display, 'inline-flex');
  assert.equal(wrap.style.alignItems, 'stretch');
  const word = wrap.children.find(node => node.id === `${model.id}-word`);
  assert.deepEqual(word.children.map(line => line.children[0]), model.content.layout.word.rows);
});

test('relevantIcon: an icon only when a word names one', () => {
  assert.equal(relevantIcon('Really oil it?'), 'droplet');
  assert.equal(relevantIcon('Security first'), 'shield');
  assert.equal(relevantIcon('Ship faster'), 'rocket');
  assert.equal(relevantIcon('Free weekends'), 'calendar');
  assert.equal(relevantIcon('rockets'), 'rocket');
  for (const words of ['Merbau', 'Spotted gum', 'Save now', 'Key point', 'Now: one click', '', null]) assert.equal(relevantIcon(words), null, String(words));
  for (const [word, icon] of Object.entries(ICON_ALIASES)) assert.ok(isIcon(icon), `${word} → ${icon}`);
});
