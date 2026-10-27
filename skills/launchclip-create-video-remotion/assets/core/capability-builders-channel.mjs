// Beat-director params builders: Channel furniture (catalog-h-channel.mjs).
//
// The director picks a capability for a clause and asks for its params
// (capabilityParams in visual-capabilities.mjs). A builder maps the beat to
// the module's own params contract (skills-src/references/storyboard-modules.md),
// or returns null when the beat cannot fill the module honestly; the director
// then walks the capability's fallback chain. A module with no builder here is
// `planned` (isPlanned) and always falls back.
//
// Modules: logo-sting.
//
// A beat is {id, text, headline, label?, sub?, kicker?, brand?, facts: {numbers,
// items, dates, quote, sides, places}, evidence?: {claim, status, source, quote?,
// capture?: {id, kind, out}, data?}}. evidence.data is the module-ready data the
// research and capture stages attach to a claim or capture:
//   none: the channel comes from the story brand (beat.brand: {name?, wordmark?,
//   logo?, mark?, tagline?}; the director sets it on the sting beats at the open
//   and the close)
// Evidence modules must never invent content: no evidence.data, no params.
//
// h: the shared helpers from visual-capabilities.mjs (clip, keyTerms,
// numbersOf, itemsOf, percentOf, seriesOf, sidesOf, timelineSteps, quoteOf,
// excerptLines, formatValue, sourceOf, iconFor, round).
//
// Pure ESM, no imports. Canonical copy: kit/core/capability-builders-channel.mjs.

/**
 * → {builders: {[module]: (beat) => params | null}, additions: {[module]: (beat) => {key, items}},
 *    samples: [beat]}: samples are test beats carrying the evidence.data these
 *    builders need; test/visual_capabilities.test.js resolves every builder against
 *    them, so an evidence-only builder is checked without inventing data elsewhere.
 */
export function channelBuilders(h) {
  // An image path the module can draw (a project asset); anything else is not a logo.
  const asset = (value) => (typeof value === 'string' && /^assets\/\S+\.(svg|png|jpe?g|webp)$/i.test(value) ? value : null);
  return {
    builders: {
      // The channel's sting: its name (or wordmark) on the glass tile, its logo
      // when it has one, else a monogram. No brand, no sting: the title carries the open.
      'logo-sting': (beat) => {
        const brand = beat.brand && typeof beat.brand === 'object' ? beat.brand : null;
        // A wordmark is a name only when it is text (brand-lockup's is an image {src, ratio}).
        const name = h.clip(brand?.name ?? (typeof brand?.wordmark === 'string' ? brand.wordmark : ''), 32);
        if (!name) return null;
        const logo = asset(brand.logo) ?? asset(brand.mark);
        const tagline = brand.tagline ? h.clip(brand.tagline, 48) : undefined;
        return { name, ...(logo ? { logo } : {}), ...(tagline ? { tagline } : {}) };
      }
    },
    additions: {},
    // A sting beat: the director sets the story brand on the open and the close.
    samples: [{ id: 'sting', text: 'Welcome back to Signal Lab.', headline: 'Welcome back', brand: { name: 'Signal Lab', tagline: 'AI, explained weekly' }, facts: { numbers: [], items: [], dates: [], quote: null, sides: [], places: [] } }]
  };
}
