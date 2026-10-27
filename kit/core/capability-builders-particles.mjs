// Beat-director params builders: Particles and tokens (catalog-i-particles.mjs).
//
// The director picks a capability for a clause and asks for its params
// (capabilityParams in visual-capabilities.mjs). A builder maps the beat to
// the module's own params contract (skills-src/references/storyboard-modules.md),
// or returns null when the beat cannot fill the module honestly; the director
// then walks the capability's fallback chain. A module with no builder here is
// `planned` (isPlanned) and always falls back.
//
// Modules: dot-field, particle-text, tokenizer.
//
// A beat is {id, text, headline, label?, sub?, kicker?, brand?, facts: {numbers,
// items, dates, quote, sides, places}, evidence?: {claim, status, source, quote?,
// capture?: {id, kind, out}, data?}}. evidence.data is the module-ready data the
// research and capture stages attach to a claim or capture:
//   tokens: the precomputed split from src/tokenizer.js ({text, tokens, models?}); a count rides on beat.facts.numbers
// Evidence modules must never invent content: no evidence.data, no params.
//
// h: the shared helpers from visual-capabilities.mjs (clip, keyTerms,
// numbersOf, itemsOf, percentOf, seriesOf, sidesOf, timelineSteps, quoteOf,
// excerptLines, formatValue, sourceOf, iconFor, round).
//
// None of these modules builds across clauses: a dot field, a particle word
// and a tokenizer each show one fact, so there are no additions.
//
// Pure ESM, no imports. Canonical copy: kit/core/capability-builders-particles.mjs.

// The particle-text dot-matrix face (kit/core/particles.mjs DOT_MATRIX_CHARS).
const DOT_MATRIX = /^[A-Z0-9 $%.,+\-×≈/:!?#']+$/;
// dot-field draws 100 to 2,000,000 dots, one per unit.
const FIELD = { min: 100, max: 2_000_000 };
// particle-text needs 140 px tall LEDs: in a 9:16 rect (860 px wide) that is
// at most 43 dot-matrix columns, so about seven letters.
const MAX_COLUMNS = 43;
// Count labels: a clause that runs on after the counted noun, trailing filler,
// and measures that are not countable things.
const RUNS_ON = new Set(['that', 'which', 'who', 'to', 'into', 'over', 'from', 'by', 'across', 'per', 'than', 'is', 'are', 'was', 'were', 'has', 'had', 'uses', 'used', 'called']);
const FILLER = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'in', 'on', 'at', 'for', 'with']);
const MEASURES = new Set(['times', 'dollars', 'euros', 'pounds', 'hours', 'minutes', 'seconds', 'days', 'weeks', 'months', 'years', 'percent', 'gigawatt', 'megawatt', 'kilowatt', 'miles', 'kilometres', 'kilometers', 'pages']);
// Words too vague to be the one word on screen.
const WEAK = new Set(['those', 'these', 'see', 'lot', 'lots', 'rest', 'version', 'model', 'models', 'thing', 'part', 'kind', 'make', 'made', 'take', 'get', 'got', 'said', 'says', 'like', 'well', 'really', 'actually', 'change', 'number', 'first', 'second', 'third', 'next', 'last', 'other', 'another', 'where', 'while', 'there', 'their', 'chapter']);
// The fact extractor's scale words, written compact.
const COMPACT = { thousand: 'K', k: 'K', million: 'M', m: 'M', billion: 'B', bn: 'B', b: 'B', trillion: 'T', t: 'T' };

/**
 * → {builders: {[module]: (beat) => params | null}, additions: {[module]: (beat) => {key, items}},
 *    samples: [beat]}: samples are test beats carrying the evidence.data these
 *    builders need; test/visual_capabilities.test.js resolves every builder against
 *    them, so an evidence-only builder is checked without inventing data elsewhere.
 */
export function particlesBuilders(h) {
  // A short text the dot-matrix face draws (upper-cased) at a readable size in
  // both aspects, or null. Glyphs are 5 columns plus a gap; punctuation is
  // narrow and a space is 3, as dotMatrixColumns counts them.
  const matrix = (text) => {
    const value = String(text ?? '').trim().toUpperCase().replace(/−/g, '-');
    if (!value || value.length > 14 || !DOT_MATRIX.test(value)) return null;
    const columns = [...value].reduce((sum, ch) => sum + (ch === ' ' ? 3 : /[.,:!']/.test(ch) ? 2 : 6), 0) - 1;
    return columns <= MAX_COLUMNS ? value : null;
  };

  // A bare single digit ("Halcyon 2", "step 3") is a name or an ordinal more often than a figure.
  const bare = (entry) => !entry.unit && !entry.prefix && Number.isInteger(entry.value) && entry.value < 10;

  // A number as particle text: a scaled figure compact ("3.2 billion" → "3.2B").
  const figure = (entry) => (COMPACT[entry.unit] ? `${entry.prefix ?? ''}${entry.value}${COMPACT[entry.unit]}` : h.formatValue(entry));

  // A number read whole: its raw text is not cut short of a letter that belongs
  // to it ("$3.2B" read as "$3.2" would misstate it).
  const whole = (beat, entry) => {
    const raw = String(entry.raw ?? '');
    const at = String(beat.text ?? '').indexOf(raw);
    return at < 0 || !/^[\p{L}]/u.test(beat.text.slice(at + raw.length));
  };

  // What a count counts: the words after it, cut before a clause that runs on
  // ("projects that called the …" → "projects") and without trailing filler.
  const countedOf = (label) => {
    const words = String(label ?? '').split(/\s+/).filter(Boolean);
    const cut = words.findIndex((word, i) => i > 0 && RUNS_ON.has(word.toLowerCase()));
    const kept = cut < 0 ? words : words.slice(0, cut);
    while (kept.length && FILLER.has(kept.at(-1).toLowerCase())) kept.pop();
    return kept.length && !MEASURES.has(kept[0].toLowerCase()) ? kept.join(' ') : null;
  };

  // The clause's own count of things: the largest whole number of units
  // (1,050,000 tokens; 2 million users), not money, a share, a multiple or a
  // measure (hours, dollars), with the words that say what is counted, its
  // own or a sibling's ("from 200 thousand tokens to 400 thousand").
  // null when there is none.
  const countOf = (beat) => {
    const numbers = h.numbersOf(beat).filter((entry) => !entry.prefix && entry.unit !== '%' && entry.unit !== '×' && whole(beat, entry));
    const named = numbers.map((entry) => countedOf(entry.label)).find(Boolean);
    let best = null;
    for (const entry of numbers) {
      const value = entry.scaled ?? entry.value;
      if (!Number.isInteger(value) || value < FIELD.min || value > FIELD.max) continue;
      const label = entry.label ? countedOf(entry.label) : named;
      if (label && (!best || value > best.value)) best = { value, label };
    }
    return best;
  };

  // The word worth assembling from particles: a name in the clause (written
  // capitalised mid-sentence: HALCYON, FINNISH), else on a title beat its
  // longest content word. Filler ("those", "lot") is never the word; null
  // when there is none, and the director picks another module.
  const keyWordOf = (beat) => {
    const text = String(beat.text ?? '');
    const named = (term) => new RegExp(`(?<![.!?]\\s|^)\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text) && /^\p{Lu}/u.test(term);
    const terms = [...h.keyTerms(beat.headline), ...h.keyTerms(text)].filter((term, i, all) => all.findIndex((t) => t.toLowerCase() === term.toLowerCase()) === i && !WEAK.has(term.toLowerCase()) && matrix(term));
    const name = terms.find(named);
    if (name) return matrix(name);
    if (beat.kind !== 'title') return null;
    const longest = h.keyTerms(beat.headline).filter((term) => term.length >= 5 && !WEAK.has(term.toLowerCase()) && matrix(term)).sort((x, y) => y.length - x.length)[0];
    return longest ? matrix(longest) : null;
  };

  // The tokenizer's split: {text, tokens, models} that joins back to its text.
  const splitOf = (beat) => {
    const data = beat.evidence?.data?.tokens;
    if (!data || typeof data.text !== 'string' || !Array.isArray(data.tokens)) return null;
    const { text, tokens } = data;
    if (!text || text.length > 160 || !tokens.length || tokens.length > 48 || !tokens.every((t) => typeof t === 'string' && t) || tokens.join('') !== text) return null;
    // The prices are the source's, never assumed: no models, no tokenizer.
    const models = (Array.isArray(data.models) ? data.models : []).filter((m) => typeof m?.label === 'string' && m.label && Number.isFinite(m.price) && m.price > 0).slice(0, 2);
    return models.length ? { text, tokens, models, encoding: data.encoding } : null;
  };

  return {
    builders: {
      // A big count, one dot per unit, with what one dot is: "1,050,000 tokens in context, 1 dot = 1 token".
      'dot-field': (beat) => {
        const count = countOf(beat);
        if (!count) return null;
        const noun = count.label.split(/\s+/)[0].replace(/[^\p{L}\p{N}-]+/gu, '');
        if (!noun) return null;
        const one = noun.length > 3 && /s$/i.test(noun) && !/ss$/i.test(noun) ? noun.slice(0, -1) : noun;
        return { count: count.value, label: h.clip(count.label, 40), legend: h.clip(`1 dot = 1 ${one.toLowerCase()}`, 32), variant: 'pull-back' };
      },
      // The clause's key number ("60%", "$3.2B"), else its key word, assembling from particles.
      'particle-text': (beat) => {
        const number = h.numbersOf(beat).filter((entry) => whole(beat, entry) && !bare(entry)).map((entry) => ({ entry, text: matrix(figure(entry)) })).find((n) => n.text);
        if (number) {
          const sub = number.entry.label ?? beat.label ?? beat.headline;
          return { text: number.text, ...(beat.kicker ? { kicker: h.clip(beat.kicker, 40) } : {}), ...(sub ? { sub: h.clip(sub, 60) } : {}), mode: 'assemble' };
        }
        const word = keyWordOf(beat);
        if (!word) return null;
        const sub = beat.sub ?? (beat.headline.toUpperCase() !== word ? beat.headline : null);
        return { text: word, ...(beat.kicker ? { kicker: h.clip(beat.kicker, 40) } : {}), ...(sub ? { sub: h.clip(sub, 60) } : {}), mode: 'assemble' };
      },
      // Only with the precomputed split and its prices (src/tokenizer.js); kit/core cannot tokenize.
      'tokenizer': (beat) => {
        const split = splitOf(beat);
        if (!split) return null;
        const source = h.sourceOf(beat);
        return { text: split.text, tokens: split.tokens, ...(split.encoding ? { encoding: h.clip(split.encoding, 24) } : {}),
          models: split.models.map((m) => ({ label: h.clip(m.label, 24), price: m.price })), ...(source ? { source: h.clip(source, 60) } : {}) };
      }
    },
    additions: {},
    // A count of things (dot-field) and a precomputed split with its prices (tokenizer).
    samples: [{ id: 'particles-sample', text: 'It holds 1,050,000 tokens in context.', headline: 'Tokens in context', facts: { numbers: [{ value: 1050000, raw: '1,050,000', label: 'tokens in context' }], items: [], dates: [] },
      evidence: { claim: 'c-sample', source: { url: 'https://example.com/launch', title: 'Launch post' }, data: { tokens: { text: 'Terra continues', tokens: ['Ter', 'ra', ' continues'], encoding: 'o200k_base', models: [{ label: 'Atlas 2', price: 10 }] } } } }]
  };
}
