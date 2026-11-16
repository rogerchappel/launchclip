// End cards (docs/END_CARDS_RFC.md, kit/core/catalog-b-end-card.mjs): every
// layout resolves for every reference brand and logo class in 9:16 and 16:9,
// keeps the catalogue B contract, and the emitter matches the Remotion
// evaluator; the picker is deterministic and honours fit, tags and recency.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MODULES} from '@launchclip/core/catalog-b.mjs';
import {END_CARD_LAYOUTS, endCardCandidates, logoTreatment, pickEndCard} from '@launchclip/core/catalog-b-end-card.mjs';
import {assertEmitter, assertModelContract} from './catalog_b.test.js';

const BRANDS = {
  charcoal: {colors: {bg: '#101516', primary: '#7fd0cc', accent: '#e3b04b', ink: '#121212', paper: '#f2ede4'}, fonts: {display: 'anton', body: 'inter', meta: 'jetbrains-mono'}},
  clay: {colors: {bg: '#2b1d15', primary: '#b5603a', accent: '#7d8a63', ink: '#3a2618', paper: '#efe4d4'}, fonts: {display: 'fraunces', body: 'inter', meta: 'inter'}},
  lime: {colors: {bg: '#0b0b0b', primary: '#d4ff3a', accent: '#ff4d2e', ink: '#0b0b0b', paper: '#ffffff'}, fonts: {display: 'bricolage-grotesque', body: 'inter', meta: 'jetbrains-mono'}}
};
const LOGOS = {
  'dark-clear': {src: 'assets/brand/mark.svg', ratio: 1, tone: 'dark', clear: true},
  'light-clear': {src: 'assets/brand/mark.svg', ratio: 3.2, tone: 'light', clear: true},
  boxed: {src: 'assets/brand/mark.svg', ratio: 1.6, tone: 'dark', clear: false, box: '#efe4d4'},
  unmeasured: 'assets/brand/mark.svg'
};
export const FIELDS = {headline: 'Save this before you pick your deck boards', emphasis: 'deck boards', url: 'harleybuilt.au', handle: '@harleybuilt', keyword: 'DECK', offer: 'the board checklist',
  reason: 'a build every Tuesday', next: 'Why decks rot from the inside', date: '3 Dec', place: 'Byron Bay, NSW', slot: 'Book a site visit', app: 'Deck Planner', hook: 'Your deck boards are lying to you', issue: 'No. 041', rating: '4.8'};
const FORMATS = {'9:16': {width: 1080, height: 1920, fps: 30, duration: 30}, '16:9': {width: 1920, height: 1080, fps: 30, duration: 30}};
const ctx = (brand, aspect, id = 'end') => ({id, start: 10, duration: 4, format: FORMATS[aspect], brand, aspect});
const paramsFor = (layout, logo) => ({layout: layout.id, ...FIELDS, logo, still: 'assets/brand/still.png', ...(layout.needs.includes('badges') ? {badges: ['assets/brand/badge.svg']} : {})});

test('end-card: every layout resolves for every brand, logo and aspect, and keeps the contract', () => {
  assert.ok(END_CARD_LAYOUTS.length >= 1);
  for (const layout of END_CARD_LAYOUTS) for (const [brandName, brand] of Object.entries(BRANDS)) for (const [logoName, logo] of Object.entries(LOGOS)) for (const aspect of Object.keys(FORMATS)) {
    if (layout.aspects && !layout.aspects.includes(aspect)) continue;
    const label = `${layout.id} / ${brandName} / ${logoName} / ${aspect}`;
    let model;
    try { model = MODULES['end-card'].resolve(paramsFor(layout, logo), ctx(brand, aspect)); } catch (error) { throw new Error(`${label}: ${error.message}`); }
    assertModelContract(model, 'end-card');
    assert.equal(model.content.layout, layout.id, label);
    assert.ok(model.events.some(event => event.name === 'ask'), `${label}: an ask event`);
  }
});

test('end-card: emitter output is seek-safe and matches the Remotion evaluator for every layout', () => {
  for (const layout of END_CARD_LAYOUTS) assertEmitter(MODULES['end-card'].resolve(paramsFor(layout, LOGOS['dark-clear']), ctx(BRANDS.charcoal, '9:16', 'ec')));
});

test('end-card: logo treatment tints a see-through mark that would not read, plates a boxed one', () => {
  const c = BRANDS.charcoal.colors;
  assert.deepEqual(logoTreatment(LOGOS['dark-clear'], c.bg, c), {mode: 'tint', color: c.paper});
  assert.deepEqual(logoTreatment(LOGOS['dark-clear'], c.paper, c), {mode: 'native'});
  assert.deepEqual(logoTreatment(LOGOS['light-clear'], c.paper, c), {mode: 'tint', color: c.ink});
  assert.deepEqual(logoTreatment(LOGOS['light-clear'], 'footage', c), {mode: 'native'});
  assert.deepEqual(logoTreatment(LOGOS.boxed, c.bg, c), {mode: 'plate'});
  assert.deepEqual(logoTreatment({src: 'assets/x.png', ratio: 1}, c.bg, c), {mode: 'plate'}, 'unmeasured goes on a plate');
});

test('end-card: the pick is deterministic, fits the action and avoids recent endings', () => {
  const base = {action: 'keyword', fields: FIELDS, logo: LOGOS['dark-clear'], seed: 'video-1'};
  assert.equal(pickEndCard(base), pickEndCard(base));
  for (let i = 0; i < 40; i++) {
    const id = pickEndCard({...base, seed: `v${i}`});
    const layout = END_CARD_LAYOUTS.find(entry => entry.id === id);
    assert.ok(layout.actions.includes('keyword') || layout.actions.includes('any'), id);
  }
  const first = pickEndCard(base);
  const weights = Object.fromEntries(endCardCandidates({...base, avoid: [first]}).map(entry => [entry.id, entry.weight]));
  assert.ok(weights[first] < 0.1, 'the last ending is weighed almost out');
  assert.equal(endCardCandidates({action: 'keyword', fields: {headline: 'x'}}).length, 0, 'a keyword ending needs a keyword');
  const seen = new Set(Array.from({length: 60}, (_, i) => pickEndCard({fields: FIELDS, logo: LOGOS.boxed, footage: true, seed: i})));
  assert.ok(seen.size >= Math.min(6, END_CARD_LAYOUTS.length), `the pick spreads across layouts (${seen.size})`);
});

test('end-card: a stated layout with missing content says what it needs; picks without a layout', () => {
  assert.throws(() => MODULES['end-card'].resolve({layout: 'keyword-ticket', headline: 'x'}, ctx(BRANDS.charcoal, '9:16')), /params\.keyword.*needs keyword, offer/);
  const model = MODULES['end-card'].resolve({...FIELDS, logo: LOGOS['dark-clear'], action: 'url'}, ctx(BRANDS.charcoal, '9:16'));
  assert.ok(END_CARD_LAYOUTS.find(layout => layout.id === model.content.layout).actions.some(a => a === 'url' || a === 'any'));
});
