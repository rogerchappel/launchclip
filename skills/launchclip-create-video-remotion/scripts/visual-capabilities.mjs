// The capability table (the beat director's module vocabulary): what each
// module can show, which evidence it renders, and the closest module to fall
// back to while it is not registered. The beat director picks a capability
// for every clause; resolveCapability() turns it into a module the kit has
// today, so the director merges in any order with the sessions adding
// modules (social-post, repo-pr-card, glass-bars-3d, …).
//
//   VISUAL_KINDS                       what a clause can ask to be shown as
//   CAPABILITIES                       [{id, kinds, evidence, fallback, wide?, planned?}]
//   capabilitiesFor(kind, {evidence})  → capability ids, best first
//   resolveCapability(id, {registered}) → {module, wanted, fallback: bool, chain}
//   capabilityParams(module, beat)     → params for that module from a beat's facts
//
// Pure ESM; imports only kit/core siblings. Canonical copy: kit/core/visual-capabilities.mjs.

import { knownModules } from './modules.mjs';

export const VISUAL_KINDS = Object.freeze([
  'title', 'concept', 'stat', 'money', 'compute', 'compare', 'share', 'series', 'ranking', 'list', 'process',
  'timeline', 'date', 'month', 'quote', 'social', 'code', 'terminal', 'pr', 'commit', 'diff', 'chain', 'lineage',
  'equation', 'map', 'tokens', 'documents', 'family', 'grid', 'page'
]);

// Capture kinds (launchclip.capture.v1) and the visual kind that shows each.
export const CAPTURE_KIND_VISUALS = Object.freeze({ post: 'social', pr: 'pr', commit: 'commit', diff: 'diff', repo: 'pr', page: 'page', article: 'page', 'model-card': 'page', chart: 'series' });

const cap = (id, kinds, fallback, extra = {}) => Object.freeze({ id, kinds: Object.freeze(kinds), fallback: Object.freeze(fallback), evidence: Object.freeze(extra.evidence ?? []), ...(extra.wide ? { wide: true } : {}), ...(extra.planned ? { planned: true } : {}) });

// Order inside a kind is preference: the director walks it and skips what the
// visual history says it has used too often. `planned` capabilities are
// modules other sessions are adding; `fallback` is walked when one is not
// registered (and when its params do not resolve).
export const CAPABILITIES = Object.freeze([
  // Evidence modules (planned): a real post, PR, commit, diff or page.
  cap('social-post', ['social', 'quote'], ['feed-frame', 'quote-card'], { evidence: ['post'], planned: true }),
  cap('social-stack', ['social'], ['quote-card', 'feed-frame'], { evidence: ['post'], planned: true }),
  cap('social-wall', ['social', 'grid'], ['proof-wall', 'icon-grid'], { evidence: ['post'], planned: true }),
  cap('repo-pr-card', ['pr'], ['window-chrome', 'excerpt'], { evidence: ['pr', 'repo'], planned: true }),
  cap('commit-card', ['commit'], ['excerpt', 'window-chrome'], { evidence: ['commit'], planned: true }),
  cap('diff-view', ['diff', 'code'], ['excerpt', 'code-snippet'], { evidence: ['diff'], planned: true }),
  cap('evidence-chain', ['chain'], ['timeline', 'process-steps'], { planned: true }),
  cap('date-pinned-timeline', ['timeline', 'date'], ['timeline'], { planned: true }),
  cap('terminal-session', ['terminal', 'code'], ['window-chrome', 'excerpt'], { planned: true }),
  cap('media-window', ['page'], ['excerpt'], { evidence: ['page', 'article', 'model-card', 'repo'] }),
  // Numbers.
  cap('stat-card', ['stat', 'money', 'compute'], ['concept-card']),
  cap('count-up', ['stat', 'money'], ['stat-card']),
  cap('odometer', ['stat', 'compute', 'money'], ['count-up', 'stat-card']),
  cap('glass-bars-3d', ['compare', 'series'], ['bar-chart'], { planned: true }),
  cap('coin-stack', ['money'], ['stat-card'], { planned: true }),
  cap('rack-shelf', ['compute'], ['stat-card'], { planned: true }),
  cap('percent-fill', ['share'], ['stat-card']),
  cap('unit-grid', ['share'], ['percent-fill']),
  cap('dot-field', ['share', 'grid'], ['unit-grid'], { planned: true }),
  cap('pie-chart', ['share'], ['percent-fill']),
  cap('bar-chart', ['series', 'compare', 'ranking'], ['leaderboard']),
  cap('leaderboard', ['ranking'], ['bar-chart']),
  cap('small-multiples', ['series', 'grid'], ['bar-chart'], { planned: true }),
  cap('compare', ['compare'], ['icon-row']),
  cap('gauge-compare', ['compare'], ['compare']),
  cap('comparison-table', ['compare', 'ranking'], ['compare'], { wide: true }),
  cap('number-line', ['share', 'stat'], ['percent-fill']),
  // Time.
  cap('date-carousel', ['date', 'timeline'], ['timeline'], { planned: true }),
  cap('month-grid', ['month', 'date'], ['timeline'], { planned: true }),
  cap('timeline', ['timeline', 'process', 'date'], ['icon-row']),
  // Structure.
  cap('icon-row', ['list', 'concept'], ['concept-card']),
  cap('icon-grid', ['list', 'grid'], ['icon-row']),
  cap('process-steps', ['process', 'list'], ['timeline']),
  cap('checklist', ['list'], ['icon-row']),
  cap('lineage-graph', ['lineage', 'family'], ['timeline'], { planned: true }),
  cap('planet-family', ['family'], ['icon-row'], { planned: true }),
  cap('paper-stack', ['documents'], ['excerpt'], { planned: true }),
  cap('equation', ['equation'], ['equation-lockup'], { planned: true }),
  cap('equation-lockup', ['equation'], ['concept-card']),
  cap('map-highlight', ['map'], ['icon-row']),
  cap('tokenizer', ['tokens'], ['kinetic-words'], { planned: true }),
  // Words.
  cap('quote-card', ['quote', 'social'], ['concept-card']),
  cap('excerpt', ['documents', 'code', 'quote'], ['quote-card']),
  cap('code-snippet', ['code'], ['excerpt']),
  cap('window-chrome', ['terminal', 'code'], ['excerpt']),
  cap('title-decompose', ['title'], ['motion-title'], { planned: true }),
  cap('particle-text', ['title', 'concept'], ['glass-word', 'motion-title'], { planned: true }),
  cap('motion-title', ['title', 'concept'], ['concept-card']),
  cap('kinetic-words', ['title', 'concept', 'tokens'], ['concept-card']),
  cap('glass-word', ['concept', 'title'], ['concept-card']),
  cap('concept-card', ['concept', 'title', 'stat'], []),
  cap('object-card', ['concept'], ['concept-card'])
]);

const BY_ID = new Map(CAPABILITIES.map((entry) => [entry.id, entry]));

/** The capability entry for a module id (or null). */
export function capability(id) {
  return BY_ID.get(id) ?? null;
}

/**
 * Capability ids that can show a visual kind, best first. evidence: a
 * capture kind (post, pr, …): capabilities that render that evidence lead.
 * wide: false drops the ones that need a landscape canvas.
 */
export function capabilitiesFor(kind, { evidence = null, wide = true } = {}) {
  const fits = CAPABILITIES.filter((entry) => entry.kinds.includes(kind) && (wide || !entry.wide));
  if (!evidence) return fits.map((entry) => entry.id);
  const lead = CAPABILITIES.filter((entry) => entry.evidence.includes(evidence) && (wide || !entry.wide));
  return [...new Set([...lead, ...fits].map((entry) => entry.id))];
}

/**
 * The module to use for a capability: itself when registered, else the first
 * registered module down its fallback chain (breadth first). registered: the
 * module ids the kit has (knownModules() by default).
 * → {module, wanted, fallback: boolean, chain: [ids tried]}
 */
export function resolveCapability(id, { registered = null } = {}) {
  const known = new Set(registered ?? knownModules());
  const chain = [];
  const queue = [id];
  const seen = new Set();
  while (queue.length) {
    const next = queue.shift();
    if (seen.has(next)) continue;
    seen.add(next);
    chain.push(next);
    if (known.has(next)) return { module: next, wanted: id, fallback: next !== id, chain };
    for (const fallback of capability(next)?.fallback ?? []) queue.push(fallback);
  }
  return { module: 'concept-card', wanted: id, fallback: true, chain: [...chain, 'concept-card'] };
}

/** The fallback modules to try after `module` for a capability, in order (registered only). */
export function fallbackChain(id, { registered = null } = {}) {
  const known = new Set(registered ?? knownModules());
  const out = [];
  const queue = [...(capability(id)?.fallback ?? [])];
  const seen = new Set([id]);
  while (queue.length) {
    const next = queue.shift();
    if (seen.has(next)) continue;
    seen.add(next);
    if (known.has(next)) out.push(next);
    for (const fallback of capability(next)?.fallback ?? []) queue.push(fallback);
  }
  if (!out.includes('concept-card') && id !== 'concept-card') out.push('concept-card');
  return out;
}

// ---------------------------------------------------------------------------
// Params from a beat's facts

// Icons every kit has (lucide names).
const ICONS = ['sparkles', 'zap', 'target', 'layers', 'cpu', 'database', 'globe', 'shield', 'rocket', 'chart-line', 'clock', 'users', 'code', 'search', 'lightbulb', 'gauge', 'brain', 'scale', 'flag', 'key'];

const clip = (text, max) => {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  return `${(cut.lastIndexOf(' ') > max * 0.5 ? cut.slice(0, cut.lastIndexOf(' ')) : cut).replace(/[,;:.\s-]+$/, '')}…`;
};
const cap1 = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);
const iconFor = (beat, n = 0) => ICONS[(hash(`${beat.id ?? ''}${beat.headline ?? ''}`) + n) % ICONS.length];

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0);
}

function numbersOf(beat) {
  return (beat.facts?.numbers ?? []).filter((entry) => Number.isFinite(entry.value));
}

// A clause's list ("A, B and C"), else its content words; null when it has fewer than min.
function itemsOf(beat, min = 3, max = 4) {
  const items = (beat.facts?.items ?? []).map((item) => cap1(clip(item, 22))).filter(Boolean);
  if (items.length >= min) return items.slice(0, max);
  const words = keyTerms(beat.text).map(cap1);
  return words.length >= min ? words.slice(0, max) : null;
}

const STOP = new Set(['a', 'an', 'and', 'the', 'so', 'to', 'of', 'for', 'that', 'this', 'it', 'its', 'is', 'are', 'was', 'were', 'we', 'i', 'you', 'they', 'he', 'she', 'in', 'on', 'at', 'from', 'with', 'which', 'because', 'has', 'have', 'had', 'just', 'our', 'your', 'their', 'but', 'or', 'as', 'be', 'by', 'then', 'there', 'here', 'what', 'when', 'how', 'why', 'not', 'into', 'than', 'more', 'most', 'will', 'would', 'can', 'could', 'about', 'every', 'each', 'one', 'all', 'also', 'only', 'even', 'now', 'still', 'that\'s', 'it\'s', 'does', 'did', 'do', 'been', 'being', 'very', 'much', 'many', 'some', 'any', 'out', 'up', 'down', 'over', 'same', 'way', 'thing', 'things']);

/** Content words of a text, in order, unique, capitalised as written. */
export function keyTerms(text) {
  const out = [];
  for (const raw of String(text ?? '').split(/\s+/)) {
    const token = raw.replace(/[^\p{L}\p{N}'.-]+/gu, '').replace(/[.'-]+$/, '');
    if (token.length < 3 || STOP.has(token.toLowerCase()) || /^\d/.test(token)) continue;
    if (!out.some((entry) => entry.toLowerCase() === token.toLowerCase())) out.push(token);
  }
  return out;
}

const formatValue = (entry) => entry.raw ?? `${entry.value}${entry.unit ? ` ${entry.unit}` : ''}`;
const sourceOf = (beat) => beat.evidence?.source ? clip(`${beat.evidence.source.title ?? beat.evidence.source.publisher ?? new URL(beat.evidence.source.url).hostname}${beat.evidence.source.date ? `, ${beat.evidence.source.date}` : ''}`, 60) : undefined;

const BUILDERS = {
  'concept-card': (beat) => ({ text: clip(beat.headline, 26), icon: iconFor(beat), ...(beat.sub ? { sub: clip(beat.sub, 40) } : {}) }),
  'glass-word': (beat) => ({ word: clip(keyTerms(beat.headline)[0] ?? beat.headline, 12) }),
  'object-card': (beat) => ({ object: 'box', caption: clip(beat.headline, 30), label: clip(keyTerms(beat.text)[0] ?? 'Note', 12) }),
  'motion-title': (beat) => ({ text: clip(beat.headline, 34), ...(beat.kicker ? { kicker: clip(beat.kicker, 24) } : {}), highlight: keyTerms(beat.headline)[0] }),
  'kinetic-words': (beat) => ({ words: keyTerms(beat.text).slice(0, 3).map((text, i) => ({ text: clip(text, 14), at: round(0.2 + i * 0.7), ...(i === 2 ? { emphasis: true } : {}) })), layout: 'stack', variant: 'rise' }),
  // Number modules show only the clause's own numbers: no number, no params (null), never a placeholder figure.
  'stat-card': (beat) => { const n = numbersOf(beat)[0]; return n ? { value: clip(formatValue(n), 12), label: clip(beat.label ?? beat.headline, 40), icon: iconFor(beat), ...(sourceOf(beat) ? { source: sourceOf(beat) } : {}) } : null; },
  'count-up': (beat) => { const n = numbersOf(beat)[0]; return n ? { value: n.value, ...(n.prefix ? { prefix: n.prefix } : {}), ...(n.unit ? { suffix: (n.unit === '%' || n.unit === '×' ? n.unit : ` ${n.unit}`).slice(0, 8) } : {}), label: clip(beat.label ?? beat.headline, 40), ...(sourceOf(beat) ? { note: sourceOf(beat) } : {}) } : null; },
  'odometer': (beat) => { const n = numbersOf(beat).find((entry) => Number.isInteger(entry.scaled ?? entry.value)); return n ? { value: Math.round(n.scaled ?? n.value), label: clip(beat.label ?? beat.headline, 40), ...(sourceOf(beat) ? { sub: sourceOf(beat) } : {}), variant: 'mechanical' } : null; },
  'percent-fill': (beat) => { const n = percentOf(beat); return n ? { value: Math.round(n.value), label: clip(beat.label ?? beat.headline, 36), variant: 'bar' } : null; },
  'unit-grid': (beat) => { const n = percentOf(beat); if (!n) return null; const lit = Math.max(1, Math.min(99, Math.round(n.value))); return { title: clip(beat.headline, 36), count: 100, groups: [{ count: lit, label: clip(`${lit} in 100`, 24), tone: 'primary' }, { count: 100 - lit, label: 'The rest', tone: 'accent' }], variant: 'dots' }; },
  'pie-chart': (beat) => { const n = percentOf(beat); if (!n) return null; const v = Math.max(1, Math.min(99, Math.round(n.value))); return { title: clip(beat.headline, 36), data: [{ label: clip(beat.label ?? 'This', 18), value: v }, { label: 'The rest', value: 100 - v }], variant: 'donut' }; },
  'number-line': (beat) => { const n = numbersOf(beat)[0]; if (!n) return null; const v = n.value; const to = v <= 100 ? 100 : 10 ** Math.ceil(Math.log10(v)); return { from: 0, to, ranges: [{ from: 0, to: Math.max(1, Math.round(v)), label: clip(beat.label ?? 'Here', 18), tone: 'good' }], marker: { value: v, label: clip(formatValue(n), 12) }, variant: 'ruler' }; },
  'bar-chart': (beat) => { const data = seriesOf(beat, 2); return data ? { title: clip(beat.headline, 40), data, highlight: data.length - 1, ...(sourceOf(beat) ? { source: sourceOf(beat) } : {}), variant: 'bars' } : null; },
  'leaderboard': (beat) => { const data = seriesOf(beat, 3); return data ? { title: clip(beat.headline, 40), entries: data, variant: 'bars' } : null; },
  'compare': (beat) => { const sides = sidesOf(beat); return sides ? { left: { title: sides[0].label, items: [sides[0].detail] }, right: { title: sides[1].label, items: [sides[1].detail] } } : null; },
  'gauge-compare': (beat) => { const sides = sidesOf(beat, true); if (!sides || sides[0].unit !== sides[1].unit || !sides[0].unit) return null; return { left: { label: sides[0].label, value: sides[0].value, unit: clip(sides[0].unit, 8), color: 'primary' }, right: { label: sides[1].label, value: sides[1].value, unit: clip(sides[1].unit, 8), color: 'accent' } }; },
  // Two columns, a row per pair of the clause's numbers (two pairs at least).
  'comparison-table': (beat) => { const n = numbersOf(beat); if (n.length < 4) return null; const rows = []; for (let i = 0; i + 1 < n.length && rows.length < 4; i += 2) rows.push({ label: cap1(clip(n[i].label ?? `Row ${rows.length + 1}`, 28)), values: [formatValue(n[i]), formatValue(n[i + 1])] }); return { title: clip(beat.headline, 40), columns: [cap1(clip(beat.facts?.sides?.[0] ?? 'Before', 16)), cap1(clip(beat.facts?.sides?.[1] ?? 'After', 16))], rows, highlight: 1, variant: 'cards' }; },

  'timeline': (beat) => { const steps = timelineSteps(beat); return steps.length >= 2 ? { steps: steps.map((label, i) => ({ label, icon: iconFor(beat, i) })) } : null; },
  'icon-row': (beat) => { const items = itemsOf(beat, 3, 3); return items ? { title: clip(beat.headline, 32), items: items.map((label, i) => ({ icon: iconFor(beat, i), label: clip(label, 14) })) } : null; },
  'icon-grid': (beat) => { const items = itemsOf(beat, 4, 6); return items ? { title: clip(beat.headline, 32), items: items.map((label, i) => ({ icon: iconFor(beat, i), label: clip(label, 14) })), variant: 'duotone' } : null; },
  'process-steps': (beat) => { const items = itemsOf(beat, 3, 3); return items ? { title: clip(beat.headline, 32), steps: items.map((label) => ({ label: clip(label, 22) })) } : null; },
  'checklist': (beat) => { const items = itemsOf(beat, 3, 3); return items ? { title: clip(beat.headline, 32), rows: items.map((label, i) => ({ label: clip(label, 28), status: 'done', at: round(0.6 + i * 0.6) })) } : null; },
  // Quotes, posts and excerpts show only words someone said or wrote: a quote in the clause, or the source's own quote. Narration is never dressed as a quote.
  'quote-card': (beat) => { const quote = quoteOf(beat); return quote ? { quote: clip(quote, 90), author: clip(beat.facts?.quote ? beat.speaker ?? beat.evidence?.source?.title ?? 'Quoted' : beat.evidence.source?.title ?? 'Source', 32), ...(beat.evidence?.source?.date ? { role: clip(beat.evidence.source.date, 24) } : {}) } : null; },
  'feed-frame': (beat) => (beat.facts?.handle ? { handle: clip(beat.facts.handle, 20), caption: clip(beat.headline, 26) } : null),
  'proof-wall': (beat) => !itemsOf(beat, 3, 4) || !sourceOf(beat) ? null : ({ items: itemsOf(beat, 3, 4).map((text) => ({ text: clip(text, 32), source: clip(sourceOf(beat) ?? 'Source', 20) })), hero: { text: clip(beat.headline, 32), highlight: keyTerms(clip(beat.headline, 32))[0] ?? clip(beat.headline, 32).split(' ')[0], source: clip(sourceOf(beat) ?? 'Source', 20) } }),
  'excerpt': (beat) => (quoteOf(beat) && sourceOf(beat) ? { type: 'text', title: clip(beat.evidence.source.title ?? beat.headline, 40), source: clip(sourceOf(beat), 40), lines: excerptLines(beat) } : null),
  'code-snippet': (beat) => ({ title: clip(beat.headline, 32), code: { language: 'text', typing: true, lines: keyTerms(beat.text).slice(0, 3).map((text, i) => ({ at: round(0.5 + i * 0.9), typeDuration: 0.7, tokens: [{ text: clip(text, 24), type: i ? 'string' : 'keyword' }] })) } }),
  'window-chrome': (beat) => ({ title: clip(beat.evidence?.source?.title ?? 'terminal', 30), lines: excerptLines(beat).map((line) => (typeof line === 'string' ? line : line.text)), caption: clip(beat.headline, 36), variant: 'mac' }),
  'media-window': (beat) => ({ title: clip(beat.evidence?.source?.title ?? beat.headline, 54), media: { kind: 'video', src: beat.evidence?.capture?.out } }),
  'equation-lockup': (beat) => ({ name: clip(beat.headline, 30), equation: clip(beat.facts?.equation ?? beat.headline, 30) }),
  'map-highlight': (beat) => ({ title: clip(beat.headline, 36), highlight: (beat.facts?.places ?? []).slice(0, 4).map((country) => ({ country })), variant: 'fill' })
};

function percentOf(beat) {
  const n = numbersOf(beat).find((entry) => entry.unit === '%');
  return n && n.value >= 0 && n.value <= 100 ? n : null;
}

// Two or more of the clause's own numbers as labelled bars (null when it has fewer).
function seriesOf(beat, least = 2) {
  const numbers = numbersOf(beat);
  if (numbers.length < least) return null;
  const terms = keyTerms(beat.text);
  return numbers.slice(0, 5).map((entry, i) => ({ label: cap1(clip(entry.label ?? terms[i] ?? formatValue(entry), 14)), value: entry.value }));
}

// The two sides of a comparison: named sides ("A versus B") or two numbers.
// numeric: both sides need a number of the clause (null otherwise).
function sidesOf(beat, numeric = false) {
  const numbers = numbersOf(beat);
  const named = beat.facts?.sides ?? [];
  if (numeric && numbers.length < 2) return null;
  if (!named.length && numbers.length < 2) return null;
  const side = (i) => ({ label: cap1(clip(named[i] ?? numbers[i]?.label ?? (i ? 'After' : 'Before'), 16)), value: numbers[i]?.value, unit: numbers[i]?.unit, detail: clip(numbers[i] ? formatValue(numbers[i]) : named[i], 22) });
  return [side(0), side(1)];
}

function timelineSteps(beat) {
  const dates = (beat.facts?.dates ?? []).map((entry) => entry.label).filter(Boolean);
  return (dates.length >= 2 ? dates : itemsOf(beat, 3, 3) ?? []).slice(0, 4).map((label) => clip(label, 14));
}

function quoteOf(beat) {
  return beat.facts?.quote ?? beat.evidence?.quote ?? null;
}

function excerptLines(beat) {
  const text = quoteOf(beat) ?? beat.text;
  const words = String(text).split(/\s+/);
  const lines = [];
  for (let i = 0; i < words.length && lines.length < 3; i += 6) lines.push(words.slice(i, i + 6).join(' '));
  const key = keyTerms(text)[0];
  return lines.map((line) => (key && line.includes(key) ? { text: line, highlight: true } : line));
}

/**
 * Params for a module from a beat ({id, text, headline, label?, sub?, kicker?,
 * facts: {numbers, items, dates, quote, sides, places}, evidence?}). Unknown
 * (planned) modules get the beat's facts as a neutral bag the module's own
 * session can map; the story builder checks every scene and falls back.
 * null: the module cannot show this beat (a number module and no number).
 */
export function capabilityParams(module, beat) {
  const build = BUILDERS[module];
  if (build) { const params = build(beat); return params ? strip(params) : null; }
  return strip({ title: clip(beat.headline, 40), text: clip(beat.text, 120), ...(numbersOf(beat).length ? { values: numbersOf(beat).map((entry) => ({ value: entry.value, unit: entry.unit, label: entry.label })) } : {}), ...(beat.evidence ? { evidence: { claim: beat.evidence.claim, url: beat.evidence.source?.url, capture: beat.evidence.capture?.out } } : {}) });
}

// What one more clause adds to a module that builds (a bar, an icon, a step):
// the params key it extends and the new entries.
const ADDITIONS = {
  'bar-chart': (beat) => ({ key: 'data', items: numbersOf(beat).map((entry, i) => ({ label: cap1(clip(entry.label ?? keyTerms(beat.text)[i] ?? formatValue(entry), 14)), value: entry.value })) }),
  'leaderboard': (beat) => ({ key: 'entries', items: numbersOf(beat).map((entry, i) => ({ label: cap1(clip(entry.label ?? keyTerms(beat.text)[i] ?? formatValue(entry), 18)), value: entry.value })) }),
  'icon-row': (beat) => ({ key: 'items', items: [{ icon: iconFor(beat), label: clip(beat.headline, 14) }] }),
  'icon-grid': (beat) => ({ key: 'items', items: [{ icon: iconFor(beat), label: clip(beat.headline, 14) }] }),
  'process-steps': (beat) => ({ key: 'steps', items: [{ label: clip(beat.headline, 22) }] }),
  'timeline': (beat) => ({ key: 'steps', items: ((beat.facts?.dates ?? []).length ? beat.facts.dates.map((entry) => entry.label) : [beat.headline]).map((label, i) => ({ label: clip(label, 14), icon: iconFor(beat, i) })) }),
  'checklist': (beat) => ({ key: 'rows', items: [{ label: clip(beat.headline, 28), status: 'done' }] })
};

/**
 * What a clause adds to a module that is already on screen (a build state):
 * {key, items} or null when the module does not build or the clause adds nothing.
 */
export function capabilityAdditions(module, beat) {
  const add = ADDITIONS[module]?.(beat);
  return add?.items?.length ? strip(add) : null;
}

/** Whether the table has a params builder for a module (otherwise it is a planned module's neutral bag). */
export function hasParamsBuilder(module) {
  return Object.hasOwn(BUILDERS, module);
}

function strip(value) {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, strip(v)]));
  return value;
}

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
