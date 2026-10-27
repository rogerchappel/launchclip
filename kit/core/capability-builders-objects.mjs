// Beat-director params builders: 3D data objects (catalog-i-3d.mjs).
//
// The director picks a capability for a clause and asks for its params
// (capabilityParams in visual-capabilities.mjs). A builder maps the beat to
// the module's own params contract (skills-src/references/storyboard-modules.md),
// or returns null when the beat cannot fill the module honestly; the director
// then walks the capability's fallback chain. A module with no builder here is
// `planned` (isPlanned) and always falls back.
//
// Modules: glass-bars-3d, coin-stack, rack-shelf, paper-stack, planet-family.
//
// A beat is {id, text, headline, label?, sub?, kicker?, brand?, facts: {numbers,
// items, dates, quote, sides, places}, evidence?: {claim, status, source, quote?,
// capture?: {id, kind, out}, data?}}. evidence.data is the module-ready data the
// research and capture stages attach to a claim or capture:
//   series: {series: [{label, value, unit?}], source} from research/data/*.json; documents: {sections: [{label, pages?, status?}]}; family: {members: [{name, tagline?}]}
// Evidence modules must never invent content: no evidence.data, no params.
//
// h: the shared helpers from visual-capabilities.mjs (clip, keyTerms,
// numbersOf, itemsOf, percentOf, seriesOf, sidesOf, timelineSteps, quoteOf,
// excerptLines, formatValue, sourceOf, iconFor, round).
//
// Every value, label and status comes from the clause or its evidence. Labels
// are clipped shorter than the modules allow, so a builder's params keep key
// text size in 9:16 as well as 16:9; a module that still cannot fit its text
// fails validation and the director falls back.
//
// Pure ESM, no imports. Canonical copy: kit/core/capability-builders-objects.mjs.

const LIMIT = { bars: 4, stacks: 4, rows: 4, sections: 7, members: 5 };
// Characters a line of a label keeps at key size in 9:16 (measured against the modules, one spare), by
// how many bars, stacks or steps share the width: a bar name may wrap to two lines; stack and step
// names stay on one.
const BAR_WORD = { 2: 8, 3: 7, 4: 5 };
const STACK_CHARS = { 2: 12, 3: 8, 4: 5 };
const STEP_CHARS = { 3: 7, 4: 4 };
// Compact units for a value on a 3D object ($400M, 4.1 s, 200K).
const SHORT_UNIT = { thousand: 'K', million: 'M', billion: 'B', trillion: 'T', k: 'K', m: 'M', b: 'B', t: 'T', '%': '%', '×': '×', seconds: ' s', second: ' s', s: ' s', ms: ' ms', minutes: ' min', minute: ' min', hours: ' h', hour: ' h', days: ' days', points: ' pts', point: ' pt' };
const EDGE = /^(on|in|at|of|to|for|from|with|per|by|the|a|an|and|or|than|vs|versus|instead|compared|down|up|into|roughly|about|around|nearly|almost|only|just|over|under|while|whereas|each)$/i;
// Unit words the parser leaves at the front of a label ("seconds before", "points on coding"); they are the number's unit.
const UNIT_WORD = /^(seconds?|minutes?|hours?|days?|points?|pts|percent|tokens?|dollars?|euros?|pounds?|times|requests?|users?|parameters?|params)$/i;
const CURRENCY_WORD = { dollar: '$', dollars: '$', euro: '€', euros: '€', pound: '£', pounds: '£' };
// A verb between a name and its number ("Halcyon 2 scored 48%").
const PRONOUN = /^(it|this|that|they|we|he|she|there|these|those|you|i|our|its)$/i;
const VERB = /^(scored|scores|costs?|cost|is|was|hit|hits|reached|reaches|got|gets|at|runs?|ran|takes?|took|charges?|sells?|sold)$/i;
// A family small to large: the kind is how a member looks, not a claim about it.
const BODIES = { 2: ['moon', 'sun'], 3: ['moon', 'earth', 'sun'], 4: ['moon', 'earth', 'sun', 'galaxy'], 5: ['moon', 'ice', 'earth', 'sun', 'galaxy'] };
const CURRENCY = { USD: '$', EUR: '€', GBP: '£', JPY: '¥' };
const OK = /^(ok|pass(ed)?|verified|done|clean|green)$/i;
const FLAG = /^(flag(ged)?|fail(ed)?|issue|error|red|warning)$/i;

/**
 * → {builders: {[module]: (beat) => params | null}, additions: {[module]: (beat) => {key, items}},
 *    samples: [beat]}: samples are test beats carrying the evidence.data these
 *    builders need; test/visual_capabilities.test.js resolves every builder against
 *    them, so an evidence-only builder is checked without inventing data elsewhere.
 */
export function objectsBuilders(h) {
  const cap1 = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);
  // A value as a chart shows it: the clause's sign, the number, a compact unit (or none when it does not fit in 8).
  const display = (entry) => {
    const word = unitWord(entry);
    const sign = entry.prefix ?? CURRENCY_WORD[`${word ?? ''}s`] ?? '';
    const unit = entry.unit !== undefined ? SHORT_UNIT[String(entry.unit).toLowerCase()] ?? ` ${entry.unit}` : word && !CURRENCY_WORD[`${word}s`] ? SHORT_UNIT[`${word}s`] ?? '' : '';
    const digits = /^[\d,.]+$/.test(String(entry.raw ?? '').replace(/^[$€£]/, '')) ? String(entry.raw).replace(/^[$€£]/, '') : String(entry.value);
    const text = `${sign}${digits}${unit}`;
    return text.length <= 8 ? text : `${sign}${digits}${unit.length <= 2 ? unit : ''}`;
  };
  // A parsed label without the prepositions at its edges ("on Nova" → "Nova", "seconds to" → "Seconds"); null when nothing is left.
  const tidy = (label) => {
    if (!label) return null;
    const words = String(label).split(/\s+/).filter(Boolean);
    while (words.length && (EDGE.test(words[0]) || UNIT_WORD.test(words[0]))) words.shift();
    while (words.length && EDGE.test(words.at(-1))) words.pop();
    return words.length ? cap1(words.join(' ')) : null;
  };
  // Labels that fit (`chars` in all, or in the longest word with `word`) and name different things; else null (the 2D fallback holds longer names).
  const fitted = (labels, chars, { lines = 1 } = {}) => {
    // Greedy word wrap: every line holds `chars` at most, in `lines` lines at most.
    const fits = (label) => {
      let count = 1, width = 0;
      for (const part of label.split(/\s+/)) {
        if (part.length > chars) return false;
        if (width && width + 1 + part.length > chars) { count += 1; width = part.length; } else width += (width ? 1 : 0) + part.length;
      }
      return count <= lines;
    };
    return labels.every((label) => label && label.length <= 24 && fits(label)) && new Set(labels.map((label) => label.toLowerCase())).size === labels.length ? labels : null;
  };

  // The research series attached to the clause (evidence.data.series): [{label, value, unit?}] with finite values ≥ 0.
  const evidenceSeries = (beat) => {
    const series = beat.evidence?.data?.series;
    if (!Array.isArray(series)) return null;
    const rows = series.filter((entry) => entry && typeof entry.label === 'string' && entry.label.trim() && Number.isFinite(entry.value) && entry.value >= 0);
    return rows.length ? rows.map((entry) => ({ label: entry.label, value: entry.value, ...(entry.unit ? { unit: entry.unit } : {}) })) : null;
  };
  // The unit word a parsed label starts with ("seconds before" → seconds), lower case, or null.
  const unitWord = (entry) => { const first = String(entry.label ?? '').split(/\s+/)[0]; return UNIT_WORD.test(first) ? first.toLowerCase().replace(/s$/, '') : null; };
  const currencyOf = (entry) => entry.prefix ?? CURRENCY_WORD[String(entry.label ?? '').split(/\s+/)[0].toLowerCase()] ?? null;
  // The name a number belongs to when it comes before it: the capitalised words just before a verb ("Halcyon 2 scored 48%").
  const nameBefore = (beat, entry) => {
    // The parser rewrites "48 percent" as "48%": find the figure by its sign and digits.
    const digits = String(entry.raw ?? entry.value).match(/[$€£]?[\d][\d,.]*/)?.[0];
    const found = digits ? new RegExp(`(^|[^\\w.])${digits.replace(/[$.]/g, '\\$&')}(?![\\d])`).exec(String(beat.text ?? '')) : null;
    if (!found) return null;
    const at = found.index + found[1].length;
    const words = beat.text.slice(0, at).trim().split(/\s+/).slice(-5);
    if (!words.length || !VERB.test(words.at(-1))) return null;
    words.pop();
    const name = [];
    while (words.length && /^([A-Z][\w-]*|\d[\w.]*)$/.test(words.at(-1).replace(/[,;:]$/, '')) && !/[,;:.]$/.test(words.at(-1))) name.unshift(words.pop());
    return name.length && /^[A-Z]/.test(name[0]) && !PRONOUN.test(name[0]) ? name.join(' ') : null;
  };
  // The clause's own numbers that share one unit (a bar of % beside a bar of $ would mislead). Labels: the name just before a number, else the words after it, else the clause's content words (marked unlabelled).
  const clauseSeries = (beat, least) => {
    const numbers = h.numbersOf(beat).filter((entry) => entry.value >= 0);
    if (numbers.length < least) return null;
    const unitOf = (entry) => `${currencyOf(entry) ?? ''}|${entry.unit ?? ''}|${unitWord(entry) ?? ''}`;
    if (new Set(numbers.map(unitOf)).size !== 1) return null;
    const terms = h.keyTerms(beat.text);
    return numbers.map((entry, i) => {
      // A name before the verb ("Nova costs 3 dollars per task") beats the words after ("per task").
      const before = nameBefore(beat, entry);
      const own = before ?? tidy(entry.label);
      return { label: own ?? terms[i] ?? null, value: entry.scaled ?? entry.value, display: display(entry), labelled: Boolean(own), subject: Boolean(before) };
    });
  };
  const seriesData = (beat, least) => {
    const evidence = evidenceSeries(beat);
    if (evidence && evidence.length >= least) return evidence.map((entry) => ({ label: entry.label, value: entry.value, display: unitText(entry), labelled: true }));
    return clauseSeries(beat, least);
  };
  // A research value as written in a chart: currency codes as signs ($0.5), % tight, other units spaced.
  const unitText = ({ value, unit }) => {
    const sign = CURRENCY[String(unit ?? '').toUpperCase()];
    return h.clip(sign ? `${sign}${value}` : `${value}${unit ? (unit === '%' ? '%' : ` ${unit}`) : ''}`, 10);
  };
  const descending = (data) => data.every((entry, i) => i === 0 || entry.value <= data[i - 1].value) && data[0].value > data.at(-1).value;
  const source = (beat) => { const s = h.sourceOf(beat); return s ? { source: h.clip(s, 80) } : {}; };
  // Money: the clause's figures with a currency sign or word, in one currency.
  const money = (beat) => {
    const figures = h.numbersOf(beat).filter((entry) => currencyOf(entry) && entry.value >= 0);
    return new Set(figures.map(currencyOf)).size === 1 ? figures : [];
  };
  // A stack's name: the name before its figure, the words after it, or the comparison's named side; null when the clause names none.
  const moneyLabel = (beat, entry, i) => nameBefore(beat, entry) ?? tidy(entry.label) ?? tidy(beat.facts?.sides?.[i]);
  const sections = (beat) => (Array.isArray(beat.evidence?.data?.sections) ? beat.evidence.data.sections.filter((entry) => entry && typeof entry.label === 'string' && entry.label.trim()) : []);
  const section = (entry) => {
    const pages = entry.pages === undefined || entry.pages === null ? null : String(entry.pages).trim();
    const status = typeof entry.status === 'string' ? (OK.test(entry.status) ? 'ok' : FLAG.test(entry.status) ? 'flag' : 'none') : 'none';
    const label = h.clip(entry.label, 18);
    const detail = pages ? h.clip(/^p/i.test(pages) ? pages : `${/[–-]/.test(pages) ? 'pp.' : 'p.'} ${pages}`, 12) : null;
    // A 9:16 row holds about 20 characters at key size: the pages stay when name and pages fit together.
    return { label, ...(detail && label.length + detail.length <= 20 ? { detail } : {}), status };
  };
  const members = (beat) => (Array.isArray(beat.evidence?.data?.members) ? beat.evidence.data.members.filter((entry) => entry && typeof entry.name === 'string' && entry.name.trim()) : []);

  const builders = {
    // Bars from a series of 2+ (research data first, else the clause's own numbers); a descending one is a staircase line-up.
    'glass-bars-3d': (beat) => {
      const data = seriesData(beat, 2)?.slice(0, LIMIT.bars);
      const labels = data && data.every((entry) => entry.labelled) && fitted(data.map((entry) => cap1(entry.label)), BAR_WORD[data.length], { lines: 2 });
      if (!labels) return null;
      const stairs = data.length >= 3 && descending(data) && labels.every((label) => label.length <= STEP_CHARS[data.length]);
      // The lit bar is the clause's subject when it names one ("Halcyon 2 scored…"), else the last.
      const subject = data.findIndex((entry) => entry.subject);
      // A guide the clause draws over the bars ("exactly half", "more than double"): evidence.data.reference from the director's series.
      const guide = beat.evidence?.data?.reference;
      const reference = !stairs && guide && Number.isFinite(guide.value) && guide.value > 0 && guide.value <= Math.max(...data.map((entry) => entry.value)) ? { value: guide.value, ...(guide.label ? { label: h.clip(guide.label, 12) } : {}) } : null;
      // The title says what the bars measure (the series' own title), never a fragment of the clause.
      const title = beat.evidence?.data?.title;
      return { variant: stairs ? 'staircase' : 'bars', ...(title ? { title: h.clip(title, 28) } : {}), data: data.map((entry, i) => ({ label: labels[i], value: entry.value, display: entry.display })), ...(stairs ? {} : { highlight: subject >= 0 ? subject : data.length - 1 }), ...(reference ? { reference } : {}), ...source(beat) };
    },
    // Two (to four) money figures in one currency: stacks sized by value, with the ratio beside the larger.
    'coin-stack': (beat) => {
      const figures = money(beat).slice(0, LIMIT.stacks);
      if (figures.length < 2) return null;
      const values = figures.map((entry) => entry.scaled ?? entry.value);
      const top = Math.max(...values), low = Math.min(...values);
      if (!(top > 0)) return null;
      const big = values.indexOf(top);
      const ratio = low > 0 ? h.round(top / low, 1) : null;
      const labels = fitted(figures.map((entry, i) => moneyLabel(beat, entry, i)), STACK_CHARS[figures.length]);
      if (!labels) return null;
      // Fewer than 16 coins per stack: the smallest gets at least one.
      return { variant: 'coins', title: h.clip(beat.headline, 28), stacks: figures.map((entry, i) => ({ label: labels[i], value: values[i], display: display(entry) })), highlight: big, ...(ratio && ratio >= 2 && ratio < 1000 ? { callout: { text: `×${ratio}`, stack: big } } : {}), ...source(beat) };
    },
    // Rows with a name and a value (model · score or price): the research series, else the clause's own labelled numbers. A row needs its own name.
    'rack-shelf': (beat) => {
      const data = seriesData(beat, 2)?.slice(0, LIMIT.rows);
      if (!data || data.some((entry) => !entry.labelled) || !fitted(data.map((entry) => cap1(entry.label)), 16)) return null;
      const top = data.reduce((best, entry, i) => (entry.value > data[best].value ? i : best), 0);
      return { variant: 'rack', title: h.clip(beat.headline, 28), rows: data.map((entry) => ({ label: cap1(entry.label), cells: [entry.display] })), focus: top, ...source(beat) };
    },
    // Only a document's own sections (evidence.data.sections), each with its pages and check or flag.
    'paper-stack': (beat) => {
      const rows = sections(beat).slice(0, LIMIT.sections);
      return rows.length >= 2 ? { variant: 'sections', title: h.clip(beat.headline, 28), items: rows.map(section), ...source(beat) } : null;
    },
    // Only a family's own members (evidence.data.members), in the order given (small to large reads best).
    'planet-family': (beat) => {
      const rows = members(beat).slice(0, LIMIT.members);
      if (rows.length < 2) return null;
      return { variant: 'track', title: h.clip(beat.headline, 28), bodies: rows.map((entry, i) => ({ kind: BODIES[rows.length][i], name: h.clip(entry.name, 12), ...(entry.tagline ? { tagline: h.clip(entry.tagline, 22) } : {}) })), ...source(beat) };
    }
  };

  // A later clause adds its own entries to the object on screen (another bar, stack, row, section or member).
  const additions = {
    'glass-bars-3d': (beat) => ({ key: 'data', items: (seriesData(beat, 1) ?? []).filter((entry) => entry.labelled).map((entry) => ({ label: cap1(h.clip(entry.label, 14)), value: entry.value, display: entry.display })) }),
    'coin-stack': (beat) => ({ key: 'stacks', items: money(beat).map((entry, i) => ({ label: moneyLabel(beat, entry, i), value: entry.scaled ?? entry.value, display: display(entry) })) }),
    'rack-shelf': (beat) => ({ key: 'rows', items: (seriesData(beat, 1) ?? []).filter((entry) => entry.labelled).map((entry) => ({ label: cap1(h.clip(entry.label, 16)), cells: [entry.display] })) }),
    'paper-stack': (beat) => ({ key: 'items', items: sections(beat).map(section) })
    // planet-family has none: a member's look depends on the family's size, so the family builds at once.
  };

  // Test beats with the data these builders need (test/visual_capabilities.test.js resolves every builder against them).
  const samples = [
    // Two prices in one currency, each with its name (coin-stack).
    { id: 'objects-prices', text: 'One task costs $1 with Nova and $10 with Atlas.', headline: 'Cost of one task', facts: { numbers: [{ value: 1, prefix: '$', raw: '$1', label: 'with Nova' }, { value: 10, prefix: '$', raw: '$10', label: 'with Atlas' }], items: [], dates: [] } },
    // A document's sections and a product family, as the research stage attaches them (paper-stack, planet-family).
    { id: 'objects-evidence', text: 'The audit went section by section, across the whole family.', headline: 'The audit', facts: { numbers: [], items: [], dates: [] },
      evidence: { claim: 'c-objects', source: { url: 'https://example.com/report', title: 'Lab report' }, data: {
        sections: [{ label: 'Methods', pages: '1–4', status: 'verified' }, { label: 'Results', pages: '5–9', status: 'fail' }, { label: 'Appendix', pages: 12 }],
        members: [{ name: 'Luna', tagline: 'fast and cheap' }, { name: 'Terra', tagline: 'mid-range value' }, { name: 'Sol', tagline: 'the flagship' }] } } }
  ];

  return { builders, additions, samples };
}
