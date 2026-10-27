// Beat-director params builders: Explainer data, calendars, people and maths (catalog-i-explain.mjs).
//
// The director picks a capability for a clause and asks for its params
// (capabilityParams in visual-capabilities.mjs). A builder maps the beat to
// the module's own params contract (skills-src/references/storyboard-modules.md),
// or returns null when the beat cannot fill the module honestly; the director
// then walks the capability's fallback chain. A module with no builder here is
// `planned` (isPlanned) and always falls back.
//
// Modules: small-multiples, date-carousel, month-grid, lineage-graph, equation, title-decompose.
//
// A beat is {id, text, headline, label?, sub?, kicker?, brand?, facts: {numbers,
// items, dates, quote, sides, places}, evidence?: {claim, status, source, quote?,
// capture?: {id, kind, out}, data?}}. evidence.data is the module-ready data the
// research and capture stages attach to a claim or capture:
//   series: {panels: [{title, series: [{label, value}]}], source}; people: {people: [{name, role?, photo?, links?}]}; equation: {tex, svg?} from src/ precompute; title: {title, terms: [{text, gloss, icon?}]}
// Evidence modules must never invent content: no evidence.data, no params.
//
// h: the shared helpers from visual-capabilities.mjs (clip, keyTerms,
// numbersOf, itemsOf, percentOf, seriesOf, sidesOf, timelineSteps, quoteOf,
// excerptLines, formatValue, sourceOf, iconFor, round).
//
// Pure ESM, no imports. Canonical copy: kit/core/capability-builders-explain.mjs.

/** → {builders: {[module]: (beat) => params | null}, additions: {[module]: (beat) => {key, items}}} */
export function explainBuilders(h) {
  return { builders: {}, additions: {} };
}
