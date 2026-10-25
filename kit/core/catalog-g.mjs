// Catalogue G: the visual vocabulary (docs/VIDEO_QUALITY_RFC.md §8), cards
// chosen by intent that draw on the icon set (kit/core/icons.mjs). Contract:
// docs/KIT_CONTRACTS.md ("Catalogue G").
//
//   concept-card  a big word or short phrase, an icon and a sub-line
//   icon-row      2–5 icons with labels that build on their words
//   section-card  the brand frame's kicker and a section title
//   object-card   a simple illustrated object from icons and brand shapes
//   stat-card     a real figure that counts up, with its label and source
//   quote-card    a real quote with a named attribution
//   excerpt       real lines of code or text with highlights, in a window
//   compare       before and after, or two columns
//   timeline      steps along a line that build on their words
//
// Every module works in the motion lanes (on the plate), as a footage-led
// insert (full frame) and as a footage-led overlay (on a brand card clear of
// the presenter's head): see catalog-g-base.mjs. Each module has designed
// variants (VARIANTS, docs/SEEDED_STYLES_RFC.md §3.2): params.variant, else
// the style's story.variants[module], else the first, its original look. Conventions are catalogue
// B's (one static view tree, one renderer-neutral op list, `at` from the
// scene start, hits time events of the same name).

import {rootNode, rootOps} from './catalog-b-view.mjs';
import {grammarTweens} from './grammar.mjs';
import {cardSurface} from './catalog-g-base.mjs';
import {conceptCard, iconRow, objectCard, sectionCard} from './catalog-g-cards.mjs';
import {excerpt, quoteCard, statCard} from './catalog-g-proof.mjs';
import {compare, timeline} from './catalog-g-sequence.mjs';

const ASPECTS = ['9:16', '16:9'];
const DEFINITIONS = [conceptCard, iconRow, sectionCard, objectCard, statCard, quoteCard, excerpt, compare, timeline];

export const MODULES = Object.fromEntries(DEFINITIONS.map(def => [def.id, {describe: def.describe, params: def.params, events: def.events, timing: def.timing, resolve: def.resolve, aspects: ASPECTS, mood: def.mood, variants: def.variants}]));
/** Each module's designed variants, the default (its original look) first. */
export const VARIANTS = Object.freeze(Object.fromEntries(DEFINITIONS.map(def => [def.id, def.variants])));
const BY_ID = Object.fromEntries(DEFINITIONS.map(def => [def.id, def]));

function definition(model) {
  const def = model && BY_ID[model.module];
  if (!def) throw new Error(`catalogue G: unknown module ${model?.module}`);
  return def;
}

/** Static element tree for a catalogue G model (initial state at scene start). */
export function catalogGView(model) {
  return rootNode(model, [cardSurface(model), ...definition(model).view(model)].filter(Boolean));
}

/** Renderer-neutral animation ops for a catalogue G model, root first. */
export function catalogGTimeline(model) {
  const ops = [];
  rootOps(model, ops);
  definition(model).timeline(model, ops);
  if (model.grammar) grammarTweens(ops, model.grammar, {roles: ['emphasis']});
  return ops;
}
