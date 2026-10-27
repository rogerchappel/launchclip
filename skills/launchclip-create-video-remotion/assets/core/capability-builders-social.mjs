// Beat-director params builders: Social posts (catalog-i-social.mjs).
//
// The director picks a capability for a clause and asks for its params
// (capabilityParams in visual-capabilities.mjs). A builder maps the beat to
// the module's own params contract (skills-src/references/storyboard-modules.md),
// or returns null when the beat cannot fill the module honestly; the director
// then walks the capability's fallback chain. A module with no builder here is
// `planned` (isPlanned) and always falls back.
//
// Modules: social-post, social-stack, social-wall.
//
// A beat is {id, text, headline, label?, sub?, kicker?, brand?, facts: {numbers,
// items, dates, quote, sides, places}, evidence?: {claim, status, source, quote?,
// capture?: {id, kind, out}, data?}}. evidence.data is the module-ready data the
// research and capture stages attach to a claim or capture:
//   post: {platform, name, handle, verified?, avatar?, text, time?, date?, metrics?, media?, quote?, source: {url, captured_at?, screenshot?}} (one post), or {posts: [post]} (several)
// Evidence modules must never invent content: no evidence.data, no params.
//
// h: the shared helpers from visual-capabilities.mjs (clip, keyTerms,
// numbersOf, itemsOf, percentOf, seriesOf, sidesOf, timelineSteps, quoteOf,
// excerptLines, formatValue, sourceOf, iconFor, round).
//
// Pure ESM, no imports. Canonical copy: kit/core/capability-builders-social.mjs.

/** → {builders: {[module]: (beat) => params | null}, additions: {[module]: (beat) => {key, items}}} */
export function socialBuilders(h) {
  return { builders: {}, additions: {} };
}
