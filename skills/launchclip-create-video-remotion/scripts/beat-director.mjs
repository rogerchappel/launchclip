// The beat director (long form, 10–60 min): narration words and chapters in,
// a whole-transcript beat map out. Every 3–10 s clause gets a targeted
// visual decision (a module, its data or evidence source, and the state
// change it makes), clauses group into shots of 2–4 states over a chapter's
// backdrop plate, and hard cuts land every 15–25 s. Most visual events are
// builds inside a shot, not cuts (docs/BEAT_DIRECTOR.md).
//
//   clauseBeats(words, {min, max, target})   → [{words: [a, b], text, start, end}]
//   extractFacts(text)                       → {numbers, dates, items, quote, …}
//   visualKind(beat)                         → a VISUAL_KINDS entry
//   matchEvidence(beat, {ledger, captures})  → {claim, status, source, capture?} | null
//   directChunk(chunk, {history, …})         → {shots, history}
//   directLongForm(input, options)           → the beat map (launchclip.beat-map.v1)
//   beatMapEvents(map)                       → {events, cuts, duration}
//   beatMapReport(map)                       → cadence gate, variety, evidence, fallbacks
//   beatMapToDirection(map)                  → a launchclip.direction-map.v1 map
//   beatMapToStory(map, {from, to, …})        → a storyboard for a window of it
//   parseScript(markdown) / dryRunWords(script, {wpm}) → chapters and timed
//                                               words for a dry run without a voice
//
// Long videos are directed chapter by chapter in chunks of at most
// chunkSeconds. Each chunk is keyed by its words, its chapter, the options
// and the visual history it starts from, so a re-run reuses every chunk
// whose key matches (options.previous) and resumes after the last good one.
// The history (recent modules, module counts, plates) carries across chunks
// and chapters so motifs do not repeat, and options.avoid (the visual
// history of recent videos) weighs against modules they leaned on.
//
// Pure ESM; imports only kit/core siblings. Canonical copy: kit/core/beat-director.mjs.

import { ENTRY, cameraSummary, planCamera } from './beat-camera.mjs';
import { cadenceGate, cadenceTarget, eventStats } from './cadence.mjs';
import { DIRECTION_SCHEMA, classifyIntent, narrationWords } from './direction.mjs';
import { longFormChunks } from './long-form.mjs';
import { TRANSITION_TYPES } from './transitions.mjs';
import { catalogModules, knownModules, moduleVariants, resolveModule } from './modules.mjs';
import { MAX_SHOT_STATES, stateSpec } from './shot-states.mjs';
import { CAPTURE_KIND_VISUALS, capabilitiesFor, capability, capabilityAdditions, capabilityParams, fallbackChain, isPlanned, keyTerms, resolveCapability } from './visual-capabilities.mjs';

export const BEAT_MAP_SCHEMA = 'launchclip.beat-map.v1';
export const BEAT_MAP_FILE = 'BEATMAP.json';
export const STATE_CHANGES = Object.freeze(['enter', 'build', 'swap']);
// Backdrop plates (kit/core/plates.mjs, when registered) and the story
// background each falls back to.
export const BACKDROP_PLATES = Object.freeze([
  Object.freeze({ kind: 'hex-shell', tint: 'neutral', background: 'mesh' }),
  Object.freeze({ kind: 'silk', tint: 'primary', background: 'light-rays' }),
  Object.freeze({ kind: 'strands', tint: 'accent', background: 'topographic' }),
  Object.freeze({ kind: 'bokeh', tint: 'primary', background: 'grain-gradient' }),
  Object.freeze({ kind: 'silk', tint: 'neutral', background: 'gradient' }),
  Object.freeze({ kind: 'hex-shell', tint: 'accent', background: 'dot-grid' }),
  Object.freeze({ kind: 'strands', tint: 'primary', background: 'geometric' }),
  Object.freeze({ kind: 'bokeh', tint: 'accent', background: 'halftone' })
]);
const MAX_ITEMS = { data: 5, items: 4, steps: 4, entries: 6, rows: 4 };
const RECENT = 8;
// Seconds between two plays of the same evidence capture.
const CAPTURE_GAP_SECONDS = 60;
// A phrase can break before these when a sentence runs long.
const PHRASE_STARTS = new Set(['in', 'on', 'with', 'that', 'who', 'from', 'to', 'for', 'by', 'over', 'across', 'after', 'before', 'into', 'about', 'than', 'compared', 'including', 'using', 'down', 'up']);
const CONJUNCTIONS = new Set(['and', 'but', 'so', 'because', 'which', 'while', 'then', 'when', 'where', 'until', 'though', 'although', 'as', 'or', 'yet', 'since', 'unless']);
// The subscribe pill: about 5.5 s on screen, and never under 4 s (the click needs room either side).
const CTA_SECONDS = 5.5, CTA_MIN_SECONDS = 4;
const DEFAULT_BRAND = Object.freeze({ colors: Object.freeze({ bg: '#070b14', primary: '#5ee6ff', accent: '#ffb347', ink: '#070b14', paper: '#eef4ff' }), fonts: Object.freeze({ display: 'space-grotesk', body: 'space-grotesk', meta: 'jetbrains-mono' }) });

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

// ---------------------------------------------------------------------------
// Clauses

/**
 * Split narration into clauses of min–max seconds, near target: at sentence
 * ends first, then commas, dashes, pauses and conjunctions. A clause never
 * crosses a word range's end (chapters are directed apart).
 */
export function clauseBeats(words, { min = 3, max = 10, target = 4.6, weight = 0.65, from = 0, to = null } = {}) {
  const list = narrationWords(words);
  const last = to ?? list.length - 1;
  const score = (i) => {
    if (i >= last) return 10;
    const text = list[i].text, next = list[i + 1];
    let value = 0;
    if (/[.!?]["”')\]]?$/.test(text)) value += 3;
    else if (/[,;:—–]["”')\]]?$/.test(text) || /^[—–]/.test(next.text)) value += 2;
    if (finite(next.start) && next.start - list[i].end >= 0.3) value += 1.5;
    const lead = next.text.toLowerCase().replace(/[^a-z]/g, '');
    if (CONJUNCTIONS.has(lead)) value += 1;
    else if (PHRASE_STARTS.has(lead)) value += 0.8;
    return value;
  };
  const beats = [];
  let s = from;
  while (s <= last) {
    let best = null;
    for (let j = s; j <= last; j += 1) {
      const dur = list[j].end - list[s].start;
      if (dur > max && j > s) break;
      if (dur < min && j < last) continue;
      const value = score(j) - weight * Math.abs(dur - target);
      if (!best || value > best.value) best = { j, value };
    }
    let j = best?.j;
    if (j === undefined) { j = s; while (j < last && list[j + 1].end - list[s].start <= max) j += 1; }
    beats.push({ words: [s, j], text: list.slice(s, j + 1).map((entry) => entry.text).join(' '), start: list[s].start, end: list[j].end });
    s = j + 1;
  }
  // A short tail joins the clause before it.
  if (beats.length > 1 && beats.at(-1).end - beats.at(-1).start < min) {
    const tail = beats.pop();
    const head = beats.at(-1);
    beats[beats.length - 1] = { words: [head.words[0], tail.words[1]], text: `${head.text} ${tail.text}`, start: head.start, end: tail.end };
  }
  return beats.map((beat) => ({ ...beat, start: round(beat.start), end: round(beat.end) }));
}

// ---------------------------------------------------------------------------
// Facts

const SCALE = { thousand: 1e3, k: 1e3, million: 1e6, m: 1e6, billion: 1e9, bn: 1e9, b: 1e9, trillion: 1e12, t: 1e12 };
const WORD_NUMBERS = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100 };
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const PLACES = ['France', 'Germany', 'Spain', 'Italy', 'Japan', 'China', 'India', 'Brazil', 'Canada', 'Mexico', 'Australia', 'Korea', 'Taiwan', 'Singapore', 'Netherlands', 'Sweden', 'Ireland', 'Israel', 'Nigeria', 'Kenya', 'Egypt', 'Argentina', 'Chile', 'Norway', 'Finland', 'Poland', 'Indonesia', 'Vietnam'];
const NUMBER = /(\$|€|£)?\b(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?:\s*(%|percent\b|per cent\b|x\b|×|times\b|thousand\b|million\b|billion\b|trillion\b|bn\b|k\b))?/gi;

/**
 * The checkable facts in a clause: numbers (value, unit, label: the words
 * after it), dates (years, month-day), a list ("A, B and C"), a quote, two
 * sides ("A versus B"), places, an @handle and an equation.
 */
export function extractFacts(text) {
  const value = String(text ?? '');
  const numbers = [];
  const dates = [];
  for (const match of value.matchAll(NUMBER)) {
    const [raw, currency, digits, unitRaw] = match;
    const n = Number(digits.replace(/,/g, ''));
    const unitWord = unitRaw?.toLowerCase();
    if (!currency && !unitWord && /^(1[89]|20)\d{2}$/.test(digits)) { dates.push({ label: digits, year: n }); continue; }
    // A number in a name ("Halcyon 2", "version 1.5", "GPT-4") is not a figure.
    const before = value.slice(0, match.index);
    if (!currency && !unitWord && (/[a-z,]\s[A-Z][\w-]*[\s-]$/.test(before) || /\b(version|v|model|release|chapter|part|step|section|table|footnote|row|request|issue|pr|commit|build|run)\s#?$/i.test(before) || /#$/.test(before))) continue;
    // A model id ("GPT-5.6", "Llama-3") is a name.
    if (!currency && !unitWord && /[A-Za-z]-$/.test(before)) continue;
    // A status code ("a 404 page", "returns 503") is not a count.
    if (!currency && !unitWord && /^[45]\d\d$/.test(digits) && /\b(error|status|page|code|returns?|not found|http)\b/i.test(value)) continue;
    const unit = !unitWord ? undefined : /^(%|percent|per cent)$/.test(unitWord) ? '%' : /^(x|×|times)$/.test(unitWord) ? '×' : unitWord;
    const after = labelAfter(value, match.index + raw.length);
    numbers.push({ value: n, ...(unit ? { unit } : {}), ...(currency ? { prefix: currency } : {}), raw: raw.trim().replace(/\s*percent$/i, '%').replace(/\s*per cent$/i, '%'), ...(SCALE[unit] ? { scaled: n * SCALE[unit] } : {}), ...(after ? { label: after } : {}) });
  }
  const spelled = Object.keys(WORD_NUMBERS).join('|');
  for (const match of value.matchAll(new RegExp(`\\b(${spelled}) (hundred )?(percent|times|thousand|million|billion)\\b`, 'gi'))) {
    const unitWord = match[3].toLowerCase();
    const n = WORD_NUMBERS[match[1].toLowerCase()] * (match[2] ? 100 : 1);
    const unit = unitWord === 'percent' ? '%' : unitWord === 'times' ? '×' : unitWord;
    const after = labelAfter(value, match.index + match[0].length);
    numbers.push({ value: n, unit, raw: unit === '%' ? `${n}%` : unit === '×' ? `${n}×` : `${n} ${unit}`, ...(SCALE[unit] ? { scaled: n * SCALE[unit] } : {}), ...(after ? { label: after } : {}) });
  }
  for (const match of value.matchAll(new RegExp(`\\b(${MONTHS.join('|')})(?:\\s+(\\d{1,2}))?\\b`, 'gi'))) {
    if (match[1].toLowerCase() === 'may' && !match[2]) continue;
    dates.push({ label: `${match[1].charAt(0).toUpperCase()}${match[1].slice(1, 3).toLowerCase()}${match[2] ? ` ${match[2]}` : ''}`, month: MONTHS.indexOf(match[1].toLowerCase()) + 1, ...(match[2] ? { day: Number(match[2]) } : {}) });
  }
  const items = listItems(value);
  const quote = value.match(/["“]([^"”]{8,})["”]/)?.[1];
  const sides = value.match(/\b([\p{L}\p{N}.-]+) (?:versus|vs\.?|against|compared (?:to|with)) ([\p{L}\p{N}.-]+)/iu);
  const places = PLACES.filter((place) => new RegExp(`\\b${place}\\b`).test(value));
  const handle = value.match(/@[A-Za-z0-9_]{2,}/)?.[0];
  const equation = value.match(/\b[\p{L}\p{N}]+\s*=\s*[\p{L}\p{N}\s×*/+^-]+/u)?.[0]?.trim();
  return {
    numbers, dates, items,
    ...(quote ? { quote } : {}),
    ...(sides ? { sides: [sides[1], sides[2]] } : {}),
    ...(places.length ? { places } : {}),
    ...(handle ? { handle } : {}),
    ...(equation ? { equation } : {})
  };
}

// "A, B and C": each item a short noun phrase, articles off ("a leak, a price
// sheet and a rival that…" → leak, price sheet, rival). The first item is the
// last word before its comma unless an article opens it; the last stops at
// a relative word or the clause's end.
const ARTICLE = /^(a|an|the|its|their|our|your|his|her|this|that)$/i;
const ITEM_STOP = /^(that|which|who|whose|where|when|to|for|with|in|on|at|from|by|of)$/i;
function listItems(text) {
  const match = String(text).match(/((?:[\p{L}\p{N}'-]+ ){0,3}[\p{L}\p{N}'-]+), ((?:[\p{L}\p{N}'-]+ ){0,3}[\p{L}\p{N}'-]+),? (?:and|or) ((?:[\p{L}\p{N}'-]+ ?){1,6})/u);
  if (!match) return [];
  const words = (part) => part.trim().split(/\s+/).filter(Boolean);
  const first = words(match[1]);
  const article = first.findLastIndex((word) => ARTICLE.test(word));
  const head = article >= 0 && article < first.length - 1 ? first.slice(article + 1) : first.slice(-1);
  const middle = words(match[2]).filter((word, i) => !(i === 0 && ARTICLE.test(word)));
  const last = [];
  for (const [i, word] of words(match[3]).entries()) { if (i === 0 && ARTICLE.test(word)) continue; if (ITEM_STOP.test(word) || last.length === 3) break; last.push(word); }
  return [head, middle, last].map((item) => item.join(' ')).filter((item) => item.length > 1 && item.split(' ').length <= 3);
}

// The words after a number, up to six, stopping at punctuation and the next number.
function labelAfter(text, index) {
  const words = [];
  for (const word of text.slice(index).split(/[.,;:!?—–]/)[0].trim().split(/\s+/).filter(Boolean)) {
    if (/^\d|^(percent|and)$/i.test(word) || words.length === 6) break;
    words.push(word);
  }
  // Not a dangling "than" or "of": the label ends on a content word.
  while (words.length > 1 && /^(than|of|to|for|per|the|a|an|by|with)$/i.test(words.at(-1))) words.pop();
  return words.join(' ');
}

const RULES = [
  ['commit', /\bcommits?\b|\bcommitted\b/i],
  ['pr', /\bpull requests?\b|\bPR #?\d+|\bmerged\b/i],
  ['diff', /\bdiffs?\b|\bchanged lines?\b/i],
  ['terminal', /\bterminal\b|\bcommand line\b|\bin the shell\b|\bran (the )?command\b/i],
  ['code', /\b(code|function|api call|script)\b/i],
  ['tokens', /\btokens?\b|\btokeni[sz]/i],
  ['equation', /\b(equation|formula)\b/i],
  ['lineage', /\b(descend\w*|forked|lineage|based on|successor|ancestor)\b/i],
  ['family', /\b(family|lineup|line-up|sizes|tiers)\b/i],
  ['chain', /\b(which means|that means|leads to|so that|chain|in turn)\b/i],
  ['documents', /\b(paper|papers|report|documents?|pages?|filing|system card)\b/i],
  ['ranking', /\b(rank\w*|top \w+|leaderboard|first place|beat every)\b/i],
  ['compute', /\b(gpus?|compute|data cent(er|re)s?|servers?|flops|chips?|clusters?)\b/i],
  ['money', /[$€£]|\b(dollars?|revenue|cost|price|funding|valuation|spend\w*)\b/i]
];

/** The visual kind a clause asks for (evidence first, then facts, then wording). */
export function visualKind(beat) {
  const facts = beat.facts ?? extractFacts(beat.text);
  if (beat.evidence?.capture?.kind && CAPTURE_KIND_VISUALS[beat.evidence.capture.kind]) return CAPTURE_KIND_VISUALS[beat.evidence.capture.kind];
  if (facts.handle || /\b(posted|tweeted|wrote on x|replied)\b/i.test(beat.text)) return 'social';
  // "OpenAI says Terra is 3 times faster" reports a figure: it is a number, not a quote.
  if (facts.quote || (beat.intent === 'quote' && !facts.numbers?.length)) return 'quote';
  if (facts.equation) return 'equation';
  for (const [kind, regex] of RULES.slice(0, 7)) if (regex.test(beat.text)) return kind;
  const numbers = facts.numbers ?? [];
  if (numbers.length) {
    if (numbers.some((entry) => entry.unit === '%')) return numbers.length >= 3 ? 'series' : 'share';
    if (numbers.length >= 3) return 'series';
    if (numbers.length === 2 || facts.sides) return 'compare';
    if (RULES.find(([kind]) => kind === 'money')[1].test(beat.text)) return 'money';
    if (RULES.find(([kind]) => kind === 'compute')[1].test(beat.text)) return 'compute';
    return 'stat';
  }
  if (facts.dates?.length >= 2) return 'timeline';
  if (facts.dates?.length === 1) return facts.dates[0].month && !facts.dates[0].day ? 'month' : 'date';
  if (facts.places?.length >= 2) return 'map';
  if (facts.sides) return 'compare';
  // A clause that lists three things is a list, whatever its words ("a leak, a price sheet and a rival").
  if (facts.items?.length >= 3) return 'list';
  for (const [kind, regex] of RULES.slice(7)) if (regex.test(beat.text)) return kind;
  if (beat.intent === 'list') return 'list';
  if (beat.intent === 'process') return 'process';
  return 'concept';
}

// ---------------------------------------------------------------------------
// Evidence

const contentSet = (text) => new Set(keyTerms(text).map((word) => word.toLowerCase()));

/**
 * Whether a source's quote span can be shown as a quote: prose, not an API
 * record ("GitHub API: …"), a table row ("| a | b |"), a heading, a list item
 * or a code line, and long enough to say something.
 */
export function isQuotable(text) {
  const value = String(text ?? '').trim();
  if (value.length < 12 || value.length > 280) return false;
  if (/^(GitHub|Hugging Face) API:/.test(value)) return false;
  if (/\|/.test(value) || /^(#{1,6}\s|[-*+]\s|\d+\.\s|>|```|\{|\[|<)/.test(value)) return false;
  return /\p{L}{3,}/u.test(value) && value.split(/\s+/).length >= 3;
}

// Clauses that point back at an entity named before them.
const POINTERS = { repo: /\b(that|this|the same)\s+(repository|repo|codebase)\b/i, benchmark: /\b(that|this|the same)\s+(benchmark|test|leaderboard)\b/i };

// Entity kinds a clause names with a common noun.
const ENTITY_HINTS = [['repo', /\b(repositor(y|ies)|repo|codebase)\b/], ['benchmark', /\b(benchmark|leaderboard)\b/]];
// The research ledger as the matcher reads it: content words, numbers, days and entity counts per claim (built once).
const LEDGER_INDEX = new WeakMap();
function ledgerIndex(ledger, claims) {
  const cached = LEDGER_INDEX.get(ledger);
  if (cached) return cached;
  const df = new Map(), entityDf = new Map(), words = new Map(), facts = new Map(), byName = new Map();
  for (const claim of claims) {
    const set = contentSet(claim.text);
    words.set(claim.id, set);
    for (const word of set) df.set(word, (df.get(word) ?? 0) + 1);
    const parsed = extractFacts(claim.text);
    const values = (claim.values ?? []).map((entry) => entry?.value).filter(finite);
    facts.set(claim.id, { numbers: [...parsed.numbers.map((entry) => entry.value), ...values], days: parsed.dates.filter((entry) => entry.month && entry.day).map((entry) => `${entry.month}-${entry.day}`) });
    for (const e of claim.entities ?? []) {
      if (!e?.name) continue;
      const key = e.name.toLowerCase();
      entityDf.set(key, (entityDf.get(key) ?? 0) + 1);
      if (!byName.has(key)) byName.set(key, { name: e.name, kind: e.kind });
    }
  }
  // Specific: a repo or a benchmark, or any name at most two claims share.
  const entities = [...byName.entries()].map(([key, e]) => ({ ...e, specific: ['repo', 'benchmark'].includes(e.kind) || entityDf.get(key) <= 2 })).filter((e) => e.name.length > 2);
  const index = { n: claims.length, df, entityDf, words, facts, entities };
  LEDGER_INDEX.set(ledger, index);
  return index;
}

/**
 * Words the narration uses for the ledger's specific entities: a capitalised
 * word (not opening its sentence) that appears beside exactly one repo or
 * benchmark, in four or fewer sentences in all, and is neither an entity
 * nor a word two claims use. "Start with dotnet/efcore, …
 * Microsoft's …" makes "Microsoft" an alias of dotnet/efcore, so "a Microsoft
 * repository" earlier points at it. → Map(entity name lower case → Set(alias))
 */
export function entityAliases(ledger, words) {
  const claims = (ledger?.claims ?? []).filter((claim) => claim?.id);
  if (!claims.length) return new Map();
  const index = ledgerIndex(ledger, claims);
  const specific = index.entities.filter((e) => ['repo', 'benchmark'].includes(e.kind));
  // A word that is itself an entity, or that two claims use, already speaks for itself.
  const own = (token) => index.entities.some((e) => e.name.toLowerCase() === token.toLowerCase()) || (index.df.get(token.toLowerCase()) ?? 0) >= 2;
  const sentences = narrationWords(words).map((word) => word.text).join(' ').split(/(?<=[.!?])\s+/);
  const seen = new Map(), beside = new Map();
  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    const caps = new Set(sentence.split(/\s+/).slice(1).map((token) => token.replace(/['’]s$/, '').replace(/[^\p{L}\p{N}-]+/gu, '')).filter((token) => /^\p{Lu}[\p{Ll}]{2,}$/u.test(token) && !STOP_CAPS.has(token.toLowerCase())));
    const here = specific.filter((e) => mentions(lower, e.name)).map((e) => e.name.toLowerCase());
    for (const token of caps) {
      seen.set(token, (seen.get(token) ?? 0) + 1);
      const set = beside.get(token) ?? new Set();
      for (const name of here) set.add(name);
      beside.set(token, set);
    }
  }
  const out = new Map();
  for (const [token, names] of beside) {
    if (names.size !== 1 || seen.get(token) > 4 || own(token) || specific.some((e) => e.name.toLowerCase().includes(token.toLowerCase()))) continue;
    const [name] = names;
    if (!out.has(name)) out.set(name, new Set());
    out.get(name).add(token.toLowerCase());
  }
  return out;
}
const STOP_CAPS = new Set(['the', 'this', 'that', 'then', 'and', 'but', 'so', 'on', 'in', 'it', 'its', 'we', 'you', 'they', 'start', 'one', 'each', 'every']);

function mentions(text, name) {
  const escaped = String(name).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\w.-])${escaped}(?![\\w-]|\\.\\d)`).test(text);
}

/**
 * The best claim in the research ledger (launchclip.evidence.v1) for a
 * clause, and the capture (launchclip.capture.v1) that shows it (claim.capture,
 * as src/research writes it, then capture.claim(s), then a source URL): the claim
 * whose content words and numbers overlap the clause most, at least 0.3.
 * Words are weighed by how few claims use them ("Terra" in ten claims counts
 * little), a named entity by how few claims share it, a repo or benchmark
 * named in passing ("a … repository") points at the claim about one, a
 * benchmark the claim does not cover counts against it, and so does a
 * capture already shown within a minute (at, played: {captureId: seconds}).
 * Contradicted claims never match. → {claim, status, kind, source, quote?,
 * capture?: {id, kind, out}, data?} | null (data: capture.data, else claim.data)
 */
export function matchEvidence(beat, { ledger = null, captures = [], at = null, played = null, aliases = null, refer = null } = {}) {
  const claims = (ledger?.claims ?? []).filter((claim) => claim?.id && claim.status !== 'contradicted');
  if (!claims.length) return null;
  const index = ledgerIndex(ledger, claims);
  const words = contentSet(beat.text);
  const numbers = new Set((beat.facts?.numbers ?? []).map((entry) => entry.value));
  const days = new Set((beat.facts?.dates ?? []).filter((entry) => entry.month && entry.day).map((entry) => `${entry.month}-${entry.day}`));
  const text = String(beat.text ?? '').toLowerCase();
  // The specific names the clause says (a repo, a benchmark, a model that few claims share).
  const named = index.entities.filter((entity) => entity.specific && (mentions(text, entity.name) || [...(aliases?.get(entity.name.toLowerCase()) ?? [])].some((alias) => mentions(text, alias))));
  const idf = (word) => Math.log((index.n + 1) / ((index.df.get(word) ?? 0) + 0.5));
  const known = [...words].filter((word) => index.df.has(word));
  const beatWeight = known.reduce((sum, word) => sum + idf(word), 0);
  let best = null;
  // A clause that points back ("that repository") is about the claim it points to.
  const pinned = refer ? claims.find((claim) => claim.id === refer) : null;
  if (pinned) best = { score: 1, claim: pinned };
  for (const claim of pinned ? [] : claims) {
    const other = index.words.get(claim.id);
    const shared = [...words].filter((word) => other.has(word));
    const claimWeight = [...other].reduce((sum, word) => sum + idf(word), 0);
    const facts = index.facts.get(claim.id);
    const sameNumber = facts.numbers.some((n) => numbers.has(n));
    const sameDay = facts.days.some((day) => days.has(day));
    const entities = claim.entities ?? [];
    // An entity the clause names, weighted by how few claims share it.
    let entity = 0;
    for (const e of entities) {
      if (!e?.name) continue;
      const key = e.name.toLowerCase();
      if (mentions(text, e.name)) entity += 0.6 / (index.entityDf.get(key) ?? 1);
      // Or a word the narration uses for it ("Microsoft" for dotnet/efcore).
      else if ([...(aliases?.get(key) ?? [])].some((alias) => mentions(text, alias))) entity += 0.6 / (index.entityDf.get(key) ?? 1);
    }
    // A kind the clause names in passing: "a … repository" points at the claim about a repo.
    // When the clause names one (directly or by an alias), only that one's claims take the hint.
    for (const [kind, regex] of ENTITY_HINTS) if (regex.test(text) && !named.some((e) => e.kind === kind) && entities.some((e) => e?.kind === kind)) entity += 0.45;
    // One shared word is chance; a number, a date, two words or a named entity are not.
    if (shared.length < 2 && !sameNumber && !sameDay && entity < 0.3) continue;
    let score = shared.reduce((sum, word) => sum + idf(word), 0) / Math.max(1e-6, Math.min(beatWeight, claimWeight)) + Math.min(entity, 0.9);
    if (sameNumber) score += 0.35;
    else if (numbers.size && facts.numbers.length) score -= 0.25;
    if (sameDay) score += 0.35;
    // The clause names (or aliases) a benchmark or repo this claim does not have, and the claim names another of that kind.
    const has = (e) => entities.some((own) => own?.name?.toLowerCase() === e.name.toLowerCase());
    for (const e of named) if (!has(e) && entities.some((own) => own?.kind === e.kind)) score -= 0.5;
    // A claim about none of the clause's named repos or benchmarks is about something else.
    if (named.length && !named.some(has)) score -= 0.3;
    // A capture shown within the last minute weighs against its claim.
    if (claim.capture && finite(at) && finite(played?.[claim.capture]) && at - played[claim.capture] < CAPTURE_GAP_SECONDS) score -= 0.3;
    if (claim.status === 'verified') score += 0.05;
    if (score >= 0.3 && (!best || score > best.score)) best = { score, claim };
  }
  if (!best) return null;
  const claim = best.claim;
  const source = (claim.sources ?? []).filter((entry) => entry?.supports !== false).sort((a, b) => Number(b.primary) - Number(a.primary) || (b.confidence ?? 0) - (a.confidence ?? 0))[0] ?? null;
  const urls = new Set((claim.sources ?? []).map((entry) => entry?.url).filter(Boolean));
  // The research stage writes claim.capture (the capture's id); a capture may also name its claims, or share a source URL.
  const capture = (claim.capture ? captures.find((entry) => entry?.id === claim.capture) : null)
    ?? captures.find((entry) => entry?.claim === claim.id || (Array.isArray(entry?.claims) && entry.claims.includes(claim.id)))
    ?? captures.find((entry) => urls.has(entry?.url));
  return {
    claim: claim.id,
    status: claim.status ?? 'unverified',
    kind: claim.kind ?? 'statement',
    score: round(best.score),
    source: source ? { url: source.url, ...(source.title ? { title: source.title } : {}), ...(source.publisher ? { publisher: source.publisher } : {}), ...(source.published_at ?? source.date ? { date: String(source.published_at ?? source.date).slice(0, 10) } : {}) } : null,
    // A quote only from a verified claim's supporting source, verbatim, and only prose (never an API record or a table row).
    ...(claim.status === 'verified' && source?.supports === true && isQuotable(source?.quote?.text) ? { quote: source.quote.text.trim() } : {}),
    // The claim's subjects, shortest first ("Terra" before "GPT-6.1"): who a figure belongs to when the clause does not say.
    ...((claim.entities ?? []).some((e) => e?.kind === 'name') ? { names: (claim.entities ?? []).filter((e) => e?.kind === 'name' && e.name).map((e) => e.name).sort((a, b) => a.length - b.length) } : {}),
    ...(capture ? { capture: { id: capture.id, kind: capture.kind, out: capture.out ?? `assets/evidence/${capture.id}.mp4` } } : {}),
    // Module-ready data for the evidence builders (capability-builders-*.mjs): the capture's, else the claim's.
    ...(capture?.data ?? claim.data ? { data: capture?.data ?? claim.data } : {})
  };
}

// ---------------------------------------------------------------------------
// Directing a chunk

/**
 * What an unverified claim may put on screen: its source line at most. Its
 * capture, its data and any quote stay off, so a reported claim never shows
 * as a quote, a post or proof; the director shows its figures as an
 * attributed claim card instead (kind `claim`).
 */
export function gateEvidence(evidence) {
  if (!evidence || evidence.status === 'verified') return evidence;
  const { capture, data, quote, ...rest } = evidence;
  return { ...rest, unverified: true };
}

// The one who makes a claim: "OpenAI also says …", "Salio reported …".
const SPEAKER = /\b([A-Z][\w'.-]*(?:\s[A-Z][\w'.-]*)?)\s+(?:also\s+)?(?:says|said|claims|claimed|reports|reported|writes|wrote|estimates|estimated|told)\b/;
function speakerOf(...texts) {
  for (const text of texts) {
    const name = String(text ?? '').match(SPEAKER)?.[1];
    if (name && !/^(It|This|That|He|She|They|We|The)$/.test(name)) return name.replace(/'s$/, '');
  }
  return null;
}

/** A fresh visual history (what the director carries across chunks). */
export function emptyHistory() {
  return { recent: [], counts: {}, plates: [], captures: {}, states: 0 };
}

/**
 * The module weights of recent videos (src/visual_history.js historyAvoid()
 * → avoid.recent[].modules): a module's share of those videos' scenes.
 */
export function avoidWeights(avoid) {
  const counts = {};
  let total = 0;
  for (const entry of avoid?.recent ?? []) for (const id of entry?.modules ?? []) { counts[id] = (counts[id] ?? 0) + 1; total += 1; }
  return Object.fromEntries(Object.entries(counts).map(([id, n]) => [id, round(n / Math.max(1, total), 3)]));
}

function headlineOf(text) {
  const terms = keyTerms(text.replace(/^(and|but|so|now|then|well|okay|here's|here is)\b[\s,]*/i, ''));
  const picked = [];
  for (const term of terms) { if ([...picked, term].join(' ').length > 26) break; picked.push(term); if (picked.length === 3) break; }
  const phrase = picked.join(' ') || text.split(/\s+/).slice(0, 3).join(' ');
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

function choosePlate(history, chapterIndex) {
  const used = history.plates.slice(-3).map((plate) => `${plate.kind}/${plate.tint}`);
  for (let k = 0; k < BACKDROP_PLATES.length; k += 1) {
    const plate = BACKDROP_PLATES[(chapterIndex + k) % BACKDROP_PLATES.length];
    if (!used.includes(`${plate.kind}/${plate.tint}`) && history.plates.at(-1)?.kind !== plate.kind) return { ...plate };
  }
  return { ...BACKDROP_PLATES[chapterIndex % BACKDROP_PLATES.length] };
}

/**
 * Direct one chunk: its clauses become states, grouped into shots.
 * chunk: {id, chapter: {id, title, index}, words: [a, b], first: bool};
 * options: {words, history, target (cadenceTarget), ledger, captures,
 * registered, format, brand, avoidWeights, plate}.
 * → {shots, history}
 */
export function directChunk(chunk, options) {
  const { words, target, ledger = null, captures = [], registered = knownModules(), format = { width: 1920, height: 1080 } } = options;
  const history = clone(options.history ?? emptyHistory());
  const avoid = options.avoidWeights ?? {};
  const wide = format.width >= format.height;
  const factor = (target.gap.p50_min + target.gap.p50_max) / 2 / 5.25;
  const beats = clauseBeats(words, { from: chunk.words[0], to: chunk.words[1], min: 3 * factor, max: 10 * factor, weight: 0.65 / factor, target: target.gap.p50_min + 0.15 * (target.gap.p50_max - target.gap.p50_min) });
  const total = narrationWords(words).length;
  const aliases = ledger ? entityAliases(ledger, words) : null;
  const lastOfKind = {};
  const states = beats.map((beat, i) => {
    const facts = extractFacts(beat.text);
    const intent = beat.words[0] === 0 ? classifyIntent(beat.text, { index: 0 }) : classifyIntent(beat.text, { index: 1 });
    const draft = { ...beat, intent, facts };
    // "That repository", "the same benchmark": the claim about the last one named.
    const pointer = Object.entries(POINTERS).find(([, regex]) => regex.test(beat.text))?.[0];
    const evidence = matchEvidence(draft, { ledger, captures, at: beat.start, played: history.captures, aliases, refer: pointer ? lastOfKind[pointer] ?? null : null });
    for (const e of ledger?.claims?.find((claim) => claim.id === evidence?.claim)?.entities ?? []) if (e?.kind && !pointer) lastOfKind[e.kind] = evidence.claim;
    if (evidence?.capture) {
      // A capture plays once a minute at most: shown again sooner, the claim keeps its source line instead.
      const last = history.captures?.[evidence.capture.id];
      if (finite(last) && beat.start - last < CAPTURE_GAP_SECONDS) delete evidence.capture;
      else history.captures = { ...(history.captures ?? {}), [evidence.capture.id]: beat.start };
    }
    if (evidence) draft.evidence = gateEvidence(evidence);
    // A quote in the narration ("a 'not found' page") is the narrator's words, not a source's: it is shown as a
    // quote only when the verified source's own quote span says it.
    if (facts.quote && !(draft.evidence?.quote && draft.evidence.quote.toLowerCase().includes(facts.quote.toLowerCase()))) delete facts.quote;
    const opener = chunk.first && i === 0 && beat.words[0] !== 0;
    // The clause under a call-to-action time (or just after it, in a pause) carries it.
    const cta = (options.structure?.ctas ?? []).find((entry) => beat.start - 0.6 <= entry.at && entry.at < beat.end);
    const sting = options.structure?.stings && (beat.words[0] === 0 || beat.words[1] === total - 1);
    if (cta) draft.cta = cta;
    if (sting && options.structure.brand) draft.brand = options.structure.brand;
    draft.kind = sting ? 'sting' : cta ? 'cta' : opener ? 'title' : visualKind(draft);
    // Without the brand's mark, the sting is the video's title.
    if (sting && !draft.brand && options.structure?.title) draft.headline = options.structure.title.split(/[:—–]/)[0].trim();
    // A chapter opens on its own title (a real headline), not on the clause's key words.
    if (opener && chunk.chapter.title) draft.headline = chunk.chapter.title;
    draft.headline ??= headlineOf(beat.text);
    draft.chapterTitle = chunk.chapter.title ?? null;
    if (opener) draft.kicker = `Chapter ${chunk.chapter.index + 1}`;
    // A figure's label is what the narration says it measures, else who it belongs to ("Terra scores 50.3%"), never key words.
    const n = facts.numbers[0];
    const label = n ? n.label || figureSubject(beat.text, n) : null;
    if (label) draft.label = label;
    return draft;
  });
  if (beats.length && beats.at(-1).words[1] === total - 1 && states.at(-1).intent !== 'cta') states.at(-1).closing = true;
  // Story-shaped evidence: a clause on a dated day pins the timeline so far; a model id in code is tokenised.
  const cards = ledger ? ledgerTimeline(ledger) : [];
  const prices = ledger ? ledgerOutputPrices(ledger) : [];
  for (const state of states) {
    if (STRUCTURE_KINDS.has(state.kind)) continue;
    const pinned = timelineFor(cards, state);
    if (pinned) {
      state.kind = 'date';
      state.evidence = { ...(state.evidence ?? {}), data: { cards: pinned } };
      delete state.evidence.capture;
      continue;
    }
    const id = state.text.match(MODEL_ID)?.[0];
    const split = id ? options.tokens?.[id] : null;
    if (split && prices.length) {
      state.kind = 'tokens';
      state.evidence = { ...(state.evidence ?? {}), data: { tokens: { ...split, models: prices } } };
      delete state.evidence.capture;
    }
  }
  pairSeries(states);
  // A figure from an unverified claim is never a hero stat: it is an attributed claim card ("OpenAI's claim, not verified").
  let speaker = null;
  for (const state of states) {
    if (STRUCTURE_KINDS.has(state.kind)) continue;
    const claimText = ledger?.claims?.find((claim) => claim.id === state.evidence?.claim)?.text;
    speaker = speakerOf(state.text, claimText) ?? (state.evidence?.unverified ? speaker : null);
    const figure = state.facts?.numbers?.[0];
    if (!state.evidence?.unverified || !figure || familyOf(state.kind) !== 'number') continue;
    state.kind = 'claim';
    state.headline = figure.unit === '×' ? `${figure.value}×` : String(figure.raw ?? figure.value);
    state.sub = clip(`${figure.label ? `${figure.label}: ` : ''}${speaker ? `${speaker}'s claim` : 'reported'}, not verified`, 64);
  }

  // Shots: 2–4 states, cut near the target cut gap, at a topic shift when one is close.
  const groups = [];
  const cutMid = (target.cut_gap.min + target.cut_gap.max) / 2;
  for (const state of states) {
    const shot = groups.at(-1);
    if (!shot) { groups.push([state]); continue; }
    const span = state.end - shot[0].start;
    const held = shot.at(-1).end - shot[0].start;
    const shift = /[.!?]["”']?$/.test(shot.at(-1).text) && familyOf(state.kind) !== familyOf(shot.at(-1).kind);
    const close = shot.length >= target.states.max || span > target.cut_gap.max
      || (shot.length >= target.states.min && held >= target.cut_gap.min && (shift || held >= cutMid));
    if (close) groups.push([state]); else shot.push(state);
  }
  // A lone short shot at the end joins the one before when it has room.
  if (groups.length > 1 && groups.at(-1).length === 1 && groups.at(-2).length < target.states.max + 1 && groups.at(-1)[0].end - groups.at(-1)[0].start < target.cut_gap.min / 2) groups.at(-2).push(...groups.pop());

  const check = makeChecker(format, options.brand ?? DEFAULT_BRAND);
  let lastOut = null;
  let lastEventAt = null;
  const built = groups.map((group, g) => {
    const shotId = `${chunk.id}-sh${g + 1}`;
    const out = [];
    for (const [k, state] of group.entries()) {
      const previous = out.at(-1) ?? null;
      const decision = decide(state, previous, { history, avoid, registered, wide, check, last: previous && !STRUCTURE_KINDS.has(previous.kind) ? previous : lastOut, sinceEvent: lastEventAt === null ? null : state.start - lastEventAt, limit: target.longest_static * 0.8 });
      if (decision.change !== 'hold') lastEventAt = state.start;
      const id = `${shotId}-${k + 1}`;
      const builds = decision.change === 'build' ? (previous?.builds ?? 0) + 1 : 0;
      out.push({
        id,
        words: state.words,
        start: state.start,
        end: state.end,
        text: state.text,
        intent: state.intent,
        kind: state.kind,
        capability: decision.capability,
        module: decision.module,
        ...(decision.fallback ? { fallback: true } : {}),
        change: k === 0 && !EXTENDS.has(decision.change) ? 'enter' : decision.change,
        params: decision.params,
        ...(decision.focus !== undefined ? { focus: decision.focus } : {}),
        ...(decision.guide ? { guide: decision.guide } : {}),
        ...(state.evidence ? { evidence: state.evidence } : {}),
        why: decision.why,
        builds
      });
      // A call to action or a sting is never carried on: the card before it is.
      if (!STRUCTURE_KINDS.has(state.kind)) lastOut = out.at(-1);
      history.recent = [...history.recent, decision.module].slice(-RECENT);
      history.counts[decision.module] = (history.counts[decision.module] ?? 0) + 1;
      history.states += 1;
    }
    return { id: shotId, start: out[0].start, end: out.at(-1).end, states: out };
  });
  // States that open a shot by extending the card before it belong to that shot (no cut); the rest of the shot cuts in after them.
  const shots = [];
  for (const shot of built) {
    let lead = 0;
    while (shots.length && lead < shot.states.length && EXTENDS.has(shot.states[lead].change)) lead += 1;
    if (lead) shots.at(-1).states.push(...shot.states.slice(0, lead));
    const rest = shot.states.slice(lead);
    if (!rest.length) continue;
    if (lead) rest[0].change = 'enter';
    shots.push({ ...shot, start: rest[0].start, states: rest });
  }
  // States run back to back: each holds until the next starts.
  const all = shots.flatMap((shot) => shot.states);
  for (let i = 0; i < all.length - 1; i += 1) all[i].end = all[i + 1].start;
  for (const shot of shots) shot.end = shot.states.at(-1).end;
  for (const state of all) delete state.builds;
  return { shots, history };
}

function familyOf(kind) {
  if (['list', 'process', 'concept', 'chain', 'lineage', 'family', 'grid'].includes(kind)) return 'idea';
  if (['stat', 'money', 'compute', 'share', 'series', 'compare', 'ranking'].includes(kind)) return 'number';
  if (['timeline', 'date', 'month', 'chain', 'lineage'].includes(kind)) return 'time';
  if (['social', 'quote', 'pr', 'commit', 'diff', 'page', 'documents', 'code', 'terminal'].includes(kind)) return 'evidence';
  return kind;
}

const STRUCTURE_KINDS = new Set(['cta', 'sting']);
// Cards that can show any clause (its key words): picked only when no specific module draws it.
export const GENERIC_MODULES = Object.freeze(new Set(['icon-row', 'concept-card', 'motion-title', 'kinetic-words', 'glass-word', 'object-card']));

// ---------------------------------------------------------------------------
// Series across clauses

// Words that compare two figures already on screen, and the guide each draws.
const RATIO = [
  [/\b(exactly |about |roughly )?half\b/i, (rows) => ({ value: round(Math.max(...rows.map((r) => r.value)) / 2, 4), label: 'half' })],
  [/\b(more than |over |nearly |almost )?(double|twice)\b/i, (rows) => ({ value: round(Math.min(...rows.map((r) => r.value)) * 2, 4), label: '2×' })],
  [/\b(\d+(?:\.\d+)?)\s*(?:x|×|times)\b/i, (rows, match) => ({ value: round(Math.min(...rows.map((r) => r.value)) * Number(match[1]), 4), label: `${Number(match[1])}×` })]
];
const QUALIFIER = [[/\bcached\b/i, 'cached'], [/\b(in|input)\b/i, 'in'], [/\b(out|output)\b/i, 'out']];

// The side a figure is on (in, out, cached): the words just after it, else the three just before it in its sentence ("Cached input drops to $0.05").
function sideOf(text, figure) {
  const after = String(figure.label ?? '').split(/\s+/).slice(0, 3).join(' ');
  const raw = String(figure.raw ?? figure.value);
  const at = text.indexOf(raw);
  const before = at >= 0 ? text.slice(0, at).split(/[.!?]\s+/).at(-1).trim().split(/\s+/).slice(-4).join(' ') : '';
  return QUALIFIER.find(([regex]) => regex.test(after))?.[1] ?? QUALIFIER.find(([regex]) => regex.test(before))?.[1] ?? null;
}
const NAME_TOKEN = /^(?:[A-Z][\w.]*(?:-[\w.]+)*|[a-z]+-\d[\w.-]*)$/;
const NOT_NAMES = new Set(['The', 'On', 'In', 'So', 'That', 'This', 'It', 'And', 'But', 'A', 'An', 'Now', 'Then', 'If', 'For', 'At', 'By', 'Picture', 'Cached', 'Each', 'One', 'We', 'You', 'They']);
const MAX_SERIES = 6;

// What a figure counts: money in one currency, a share, or a scaled count of one thing; null for anything else.
function figureFamily(entry, running = null) {
  if (entry.prefix) return `money:${entry.prefix}`;
  if (entry.unit === '%') return 'share';
  if (['million', 'billion', 'thousand', 'trillion'].includes(entry.unit)) {
    const noun = String(entry.label ?? '').split(/\s+/).find((word) => /^[a-z]{3,}$/i.test(word) && !/^(per|of|for|the|and)$/i.test(word));
    // "2 million" after "1 million tokens" counts the same thing.
    return noun ? `count:${noun.toLowerCase().replace(/s$/, '')}` : running?.startsWith('count:') ? running : null;
  }
  return null;
}

// The name a figure belongs to: "GPT-5.6 Terra scored 21.5%", "for GPT-5.6 Terra", "On Sol, that buys 1 million".
function figureSubject(text, entry) {
  const raw = String(entry.raw ?? entry.value).replace(/%$/, '');
  const at = text.indexOf(raw.replace(/^[$€£]/, '')) >= 0 ? text.indexOf(raw.replace(/^[$€£]/, '')) : -1;
  if (at < 0) return null;
  const after = text.slice(at + raw.length).match(/^%?\s*(?:\w+\s){0,2}?(?:for|on|by)\s+((?:[A-Z][\w.-]*|[a-z]+-\d[\w.-]*)(?:\s[A-Z][\w.-]*)?)/);
  if (after) return after[1];
  const sentence = text.slice(0, at).split(/[.!?]\s+/).at(-1);
  const tokens = sentence.split(/\s+/).map((token) => token.replace(/[,;:]$/, '')).filter(Boolean);
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    if (!NAME_TOKEN.test(tokens[i]) || NOT_NAMES.has(tokens[i])) continue;
    let j = i;
    while (j > 0 && NAME_TOKEN.test(tokens[j - 1]) && !NOT_NAMES.has(tokens[j - 1])) j -= 1;
    return tokens.slice(j, i + 1).join(' ');
  }
  return null;
}

/**
 * Figures that belong together across neighbouring clauses become one series
 * ("$1 in and $5 out … Sol costs $2 in and $10 out … exactly half"): up to
 * four clauses in a row with figures of one family (money in one currency,
 * shares, or a count of one thing), or a clause that compares them (half,
 * double, N times) right after. Each clause then carries the series so far
 * (evidence.data.series, the rows labelled by the name each figure belongs
 * to and its side: in, out), and a comparing clause adds a guide
 * (evidence.data.reference). The clauses become `series` states, so a 3D bar
 * build shows it rather than a card per clause. A one-off qualifier
 * (cached) beside a pair of others stays out.
 */
export function pairSeries(states) {
  let run = null;
  const runs = [];
  const close = () => { if (run) runs.push(run); run = null; };
  for (const state of states) {
    if (STRUCTURE_KINDS.has(state.kind) || state.kind === 'title') { close(); continue; }
    // A run takes at most four clauses (a shot's states) in 25 s.
    if (run && (run.states.length >= 4 || state.end - run.states[0].state.start > 25)) close();
    // A scaled figure with no noun ("2 million") counts what the clause or run counted last ("1 million tokens").
    let counting = run?.family?.startsWith('count:') ? run.family : null;
    const all = (state.facts?.numbers ?? []).map((entry) => { const family = figureFamily(entry, counting); if (family?.startsWith('count:')) counting = family; return { entry, family }; }).filter((figure) => figure.family);
    // One family per clause: a count wins over the money spent on it ("the same $10 buys 2 million"), then the run's, then the last figure's.
    const count = all.find((figure) => figure.family.startsWith('count:'))?.family;
    const family = count ?? (run && all.some((figure) => figure.family === run.family) ? run.family : all.at(-1)?.family ?? null);
    const figures = all.filter((figure) => figure.family === family);
    const ratio = RATIO.map(([regex, guide]) => ({ match: state.text.match(regex), guide })).find((entry) => entry.match);
    if (run && (figures.length ? family === run.family : ratio)) { run.states.push({ state, figures, ratio }); continue; }
    close();
    if (figures.length) run = { family, states: [{ state, figures, ratio }] };
  }
  close();
  for (const entry of runs) {
    // Before the clauses name one, the figures belong to the matched claim's subject.
    let subject = entry.states[0].state.evidence?.names?.[0] ?? null;
    const rows = [];
    for (const step of entry.states) {
      step.rows = [];
      for (const { entry: figure } of step.figures) {
        subject = figureSubject(step.state.text, figure) ?? subject;
        const side = sideOf(step.state.text, figure);
        const name = subject ?? (side ? null : tidyLabel(figure.label));
        if (!name && !side) continue;
        const row = { label: [name, side].filter(Boolean).join(' ').replace(/^./, (c) => c.toUpperCase()), name, value: figure.value, side, ...(figure.unit === '%' ? { unit: '%' } : figure.prefix === '$' ? { unit: 'USD' } : figure.prefix === '€' ? { unit: 'EUR' } : figure.prefix === '£' ? { unit: 'GBP' } : figure.unit ? { unit: { million: 'M', billion: 'B', thousand: 'K', trillion: 'T' }[figure.unit] } : {}) };
        if (!rows.some((other) => other.label.toLowerCase() === row.label.toLowerCase())) { rows.push(row); step.rows.push(row); }
      }
    }
    // A side only one figure has (cached) beside sides that pair up (in, out) stays out.
    const sides = {};
    for (const row of rows) if (row.side) sides[row.side] = (sides[row.side] ?? 0) + 1;
    const lone = Object.values(sides).some((n) => n >= 2) ? new Set(Object.keys(sides).filter((side) => sides[side] === 1)) : new Set();
    const kept = rows.filter((row) => !lone.has(row.side));
    if (kept.length < 2 || new Set(kept.map((row) => row.label)).size < 2) continue;
    // A name's last word when it alone tells the rows apart ("GPT-6.1 Sol" → "Sol" beside "Terra").
    const names = [...new Set(kept.map((row) => row.name).filter(Boolean))];
    const short = names.map((name) => name.split(' ').at(-1));
    if (new Set(short).size === names.length) for (const row of kept) if (row.name) row.label = [row.name.split(' ').at(-1), row.side].filter(Boolean).join(' ');
    let shown = [];
    for (const step of entry.states) {
      // A clause whose own figures all stay out of the series (a lone "cached" price) shows them itself.
      if (step.rows.length && !step.rows.some((row) => kept.includes(row)) && !step.ratio) { step.state.alone = true; continue; }
      shown = [...shown, ...step.rows.filter((row) => kept.includes(row))].slice(-MAX_SERIES);
      // A run's first figure on its own is a stat; the series builds from the next clause.
      if (shown.length < 2) {
        if (shown.length === 1) {
          step.state.kind = entry.family === 'share' ? 'share' : 'stat';
          // Its figure leads, so the stat shows the run's number ("1 million tokens", not the "$10" before it).
          const lead = step.figures.map((figure) => figure.entry);
          step.state.facts = { ...step.state.facts, numbers: [...lead, ...step.state.facts.numbers.filter((entry) => !lead.includes(entry))] };
        }
        continue;
      }
      const series = shown.map(({ label, value, unit }) => ({ label, value, ...(unit ? { unit } : {}) }));
      const guide = step.ratio ? step.ratio.guide(series, step.ratio.match) : null;
      const reference = guide && guide.value > 0 && guide.value <= Math.max(...series.map((row) => row.value)) ? guide : null;
      const evidence = { ...(step.state.evidence ?? {}) };
      // The series is the visual: a capture of the page it came from waits for another clause.
      delete evidence.capture;
      const title = seriesTitle(entry);
      // What one budget buys from two options ("$10 buys 1 million … the same $10 buys 2 million") is a race of unit grids.
      const race = raceOf(entry, series);
      evidence.data = { ...(isPlain(evidence.data) ? evidence.data : {}), series, ...(reference ? { reference } : {}), ...(title ? { title } : {}), ...(race ? { race } : {}) };
      step.state.evidence = evidence;
      step.state.kind = race ? 'race' : 'series';
      step.state.paired = entry.states.indexOf(step);
    }
  }
  return states;
}

const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const SCALE_OF = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

/**
 * A chart title from what the run measures, never a clause fragment: money
 * per a unit ("Price per million tokens"), a count bought with one budget
 * ("Tokens for $10"), or the benchmark a share is on ("Terminal-Bench 4.0");
 * null when the run does not say.
 */
export function seriesTitle(run) {
  const figures = run.states.flatMap((step) => step.figures.map((figure) => figure.entry));
  if (run.family.startsWith('money:')) {
    const per = figures.map((entry) => String(entry.label ?? '').match(/^per\s+((?:million|thousand|billion)\s+)?(?:input\s+|output\s+|cached\s+)?([a-z]+)/i)).find(Boolean);
    return per ? `Price per ${per[1] ?? ''}${per[2]}`.replace(/\s+/g, ' ').trim() : 'Price';
  }
  if (run.family.startsWith('count:')) {
    const noun = run.family.slice('count:'.length);
    const spend = spendOf(run);
    return `${noun.charAt(0).toUpperCase()}${noun.slice(1)}s${spend ? ` for ${spend.raw}` : ''}`;
  }
  // A share is on a test: the name the run says that is not one of its rows.
  const rows = new Set(figures.map((entry) => String(entry.label ?? '').toLowerCase()));
  for (const step of run.states) {
    const name = String(step.state.text).match(/\b((?:[A-Z][\w'’-]*\s){0,3}[A-Z][\w'’-]*(?:\s\d[\d.]*)?)(?=,|\s(?:which|a test|measures))/)?.[1];
    const clean = name?.split(/\s+/).filter((word, i, all) => !(i < all.length - 1 && NOT_NAME_START.has(word))).join(' ');
    if (clean && !rows.has(clean.toLowerCase()) && /\p{Lu}.*(?:\d|[A-Z].*[A-Z]|-)/u.test(clean)) return clean.length <= 28 ? clean : null;
  }
  return null;
}

// The budget a count run spends on each side ("$10 of output … the same $10"): a money figure every mention shares.
function spendOf(run) {
  const money = run.states.flatMap((step) => (step.state.facts?.numbers ?? []).filter((entry) => entry.prefix));
  if (!money.length || new Set(money.map((entry) => entry.value)).size !== 1) return null;
  return { value: money[0].value, raw: money[0].raw ?? `${money[0].prefix}${money[0].value}` };
}

/** Two counts bought with the same budget → {spend, suffix, rows: [{label, total}]} for a grid race, else null. */
function raceOf(run, series) {
  if (!run.family.startsWith('count:') || series.length !== 2) return null;
  const spend = spendOf(run);
  if (!spend) return null;
  const rows = series.map((row) => ({ label: row.label, total: row.value * (SCALE_OF[row.unit] ?? 1) }));
  return rows.every((row) => row.total > 0) ? { spend: spend.value, suffix: run.family.slice('count:'.length) + 's', rows } : null;
}

// ---------------------------------------------------------------------------
// Story-shaped evidence: a running timeline, a model's tokens

const clip = (text, max) => { const value = String(text ?? '').replace(/\s+/g, ' ').trim(); return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`; };
const MONTH_INDEX = Object.fromEntries(MONTHS.map((name, i) => [name, i + 1]));
// "October 16, 2026" / "2026-10-16" → "2026-10-16", else null.
function isoDate(value) {
  const text = String(value ?? '');
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const long = text.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  const month = long ? MONTH_INDEX[long[1].toLowerCase()] : null;
  return month ? `${long[3]}-${String(month).padStart(2, '0')}-${String(Number(long[2])).padStart(2, '0')}` : null;
}

/**
 * The ledger's dated claims as date-pinned-timeline cards, one per day: a
 * PR or commit as its card (claim.data), anything else as an announcement
 * of its source (site, title, the supporting quote or the claim). Sorted by
 * date. → [{date, label, …source}]
 */
export function ledgerTimeline(ledger) {
  const days = new Map();
  for (const claim of ledger?.claims ?? []) {
    if (!claim?.id || claim.status === 'contradicted') continue;
    const date = (claim.dates ?? []).map(isoDate).find(Boolean) ?? null;
    if (!date || days.has(date)) continue;
    const label = clip(keyTerms(claim.text).filter((word) => !/^(october|november|september|december|january|february|march|april|june|july|august)$/i.test(word)).slice(0, 4).join(' '), 32);
    const data = claim.data;
    if (isPlain(data?.params) && ['repo-pr-card', 'commit-card'].includes(data.module)) { days.set(date, { date, label, module: data.module, params: data.params, claim: claim.id }); continue; }
    const source = (claim.sources ?? []).find((entry) => entry?.supports !== false) ?? null;
    if (!source?.url) continue;
    let site;
    try { site = source.publisher ?? new URL(source.url).hostname.replace(/^www\./, ''); } catch { continue; }
    days.set(date, { date, label, kind: 'announcement', site: clip(site, 40), title: clip(source.title ?? claim.text, 80), text: clip(source.quote?.text && !/^(GitHub|Hugging Face) API:/.test(source.quote.text) ? source.quote.text : claim.text, 160), claim: claim.id });
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The cards up to a clause's date (the story so far: three at most, within
 * three weeks), or null when the clause's day has no card. The first dated
 * clause pins one card; later ones add theirs.
 */
function timelineFor(cards, beat) {
  const day = (beat.facts?.dates ?? []).find((entry) => entry.month && entry.day);
  if (!day || !cards.length) return null;
  const year = cards.at(-1).date.slice(0, 4);
  const iso = `${year}-${String(day.month).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`;
  if (!cards.some((card) => card.date === iso)) return null;
  const toDay = (value) => Date.UTC(+value.slice(0, 4), +value.slice(5, 7) - 1, +value.slice(8, 10)) / 864e5;
  const shown = cards.filter((card) => card.date <= iso && toDay(iso) - toDay(card.date) <= TIMELINE_DAYS).slice(-3);
  return shown.map(({ claim, ...card }) => card);
}

const TIMELINE_DAYS = 21;

// A model id as written in code: lower case, a hyphen and a digit ("gpt-6.1-terra").
const MODEL_ID = /\b[a-z][a-z0-9]*-\d[\w.]*(?:-[a-z0-9.]+)*\b/;

/**
 * Output prices per million tokens the ledger states ("… $5 per million
 * output tokens"), by the model they belong to, at most two. → [{label, price}]
 */
export function ledgerOutputPrices(ledger) {
  const out = [];
  for (const claim of ledger?.claims ?? []) {
    if (!claim?.text || claim.status === 'contradicted') continue;
    for (const figure of extractFacts(claim.text).numbers) {
      if (!figure.prefix || !/\boutput\b/i.test(String(figure.label ?? ''))) continue;
      const name = figureSubject(claim.text, figure) ?? (claim.entities ?? []).find((e) => e?.kind === 'name')?.name;
      if (!name || out.some((entry) => entry.label === name)) continue;
      out.push({ label: clip(name, 24), price: figure.value });
    }
  }
  return out.slice(0, 2);
}

// A figure's label as a bar name: its first words, prepositions off ("per million input tokens" → null).
function tidyLabel(label) {
  const words = String(label ?? '').split(/\s+/).filter((word) => word && !/^(per|of|on|in|to|for|the|a|an|and|is|was|that|which)$/i.test(word));
  return words.length && words.length <= 2 ? words.join(' ') : null;
}

// The module, params and state change for one clause.
function decide(state, previous, options) {
  const decision = choose(state, previous, options);
  // The same card again (same module, same params) is the card on screen carrying on, not a new one.
  const last = options.last;
  if (last && decision.module === last.module && JSON.stringify(decision.params) === JSON.stringify(last.params) && !STRUCTURE_KINDS.has(state.kind)) {
    // A guide the clause draws ("exactly half") over a chart that takes one as a shot state is a new event on the same card.
    const reference = state.evidence?.data?.reference;
    if (reference && stateSpec(last.module, catalogModules()[last.module] ?? null)?.guide) return { ...decision, change: 'guide', guide: { value: reference.value, ...(reference.label ? { label: reference.label.toUpperCase() } : {}) }, why: `${decision.why}; draws the ${reference.label} guide` };
    return { ...decision, change: 'hold', why: `${decision.why}; the same card carries on` };
  }
  if (!isSalad(decision, state)) return decision;
  // A line the narration says, verbatim (a short sentence, a full name), is a headline; its key words are not.
  // Held this long already, the clause's own words carry the next event rather than a longer static run.
  const loose = Number.isFinite(options.sinceEvent) && options.limit && options.sinceEvent + (state.end - state.start) > options.limit;
  const line = verbatimHeadline(state.text, { loose });
  if (line) {
    const said = { ...state, headline: line, line, kicker: null, sub: null };
    // Typography takes turns (the least used first, a fresh motion-title effect each time), so lines do not all look alike.
    const counts = options.history?.counts ?? {};
    // The card type on screen goes last: a new line on it is still a new card, but another type reads better.
    const order = ['motion-title', 'kinetic-words', 'concept-card'].sort((a, b) => Number(options.last?.module === a) - Number(options.last?.module === b) || (counts[a] ?? 0) - (counts[b] ?? 0));
    const effects = moduleVariants()['motion-title'] ?? [];
    for (const module of order) {
      let params = capabilityParams(module, said);
      if (!params) continue;
      if (module === 'concept-card' && (params.text !== line || line.split(/\s+/).length > 3)) continue;
      if (module === 'motion-title' && effects.length) params = { ...params, variant: effects[(counts['motion-title'] ?? 0) % effects.length] };
      if (options.check(module, params)) return { capability: module, module, fallback: false, params, change: 'swap', why: `${state.kind}: nothing specific draws it; the line itself ("${line}")` };
    }
  }
  // No specific module draws the clause and its key words are no headline: the card on screen carries on.
  if (last) {
    const items = focusItems(last);
    if (items) {
      const focus = ((last.focus ?? -1) + 1) % items;
      return { capability: last.capability, module: last.module, fallback: last.fallback === true, params: last.params, change: 'focus', focus, why: `${state.kind}: nothing specific draws it; ${last.module} holds, focus on item ${focus + 1}` };
    }
    return { capability: last.capability, module: last.module, fallback: last.fallback === true, params: last.params, change: 'hold', why: `${state.kind}: nothing specific draws it; ${last.module} holds` };
  }
  // Nothing on screen to carry on: the chapter's own title.
  const title = { ...state, headline: state.chapterTitle ?? state.headline, kicker: null };
  const params = capabilityParams('motion-title', title);
  if (state.chapterTitle && options.check('motion-title', params)) return { capability: 'motion-title', module: 'motion-title', fallback: false, params, change: 'swap', why: `${state.kind}: nothing specific draws it; the chapter title` };
  return decision;
}

const NAME_PART = /^(?:\p{Lu}[\p{L}\d.'’-]*|\d[\d.]*)$/u;
const NOT_NAME_START = new Set(['The', 'A', 'An', 'And', 'But', 'So', 'Then', 'On', 'In', 'At', 'If', 'It', 'This', 'That', 'These', 'Those', 'We', 'You', 'They', 'He', 'She', 'Now', 'Look', 'Start']);

/**
 * A headline the clause itself says, verbatim: a whole sentence of two to
 * six words ("That is not a rounding error"), else a full proper name of two
 * or more words ("Andrew Curran", "Agents' Last Exam"), else the stressed end
 * of a sentence it completes ("mark Sol's homework"); null when it says none
 * of these (then its key words are no headline and the card on screen holds).
 */
export function verbatimHeadline(text, { loose = false } = {}) {
  const sentences = String(text ?? '').split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim().replace(/[.!?,;:]+$/, '')).filter(Boolean);
  const short = sentences.find((sentence) => { const n = sentence.split(/\s+/).length; return n >= 2 && n <= 6 && sentence.length <= 34 && keyTerms(sentence).length >= 1; });
  if (short) return short;
  const raw = String(text ?? '').split(/\s+/);
  const tokens = raw.map((token) => token.replace(/^[("“]+|[)"”,;:.!?]+$/g, ''));
  let best = null;
  for (let i = 0; i < tokens.length; i += 1) {
    if (!NAME_PART.test(tokens[i]) || /^\d/.test(tokens[i]) || NOT_NAME_START.has(tokens[i])) continue;
    let j = i;
    // A name stops at punctuation ("Entity Framework, Microsoft's …" is two names).
    while (j + 1 < tokens.length && !/[,;:.!?)]$/.test(raw[j]) && NAME_PART.test(tokens[j + 1])) j += 1;
    const name = tokens.slice(i, j + 1).join(' ').replace(/['’]s$/, '');
    if (j > i && name.length <= 34 && (!best || name.length > best.length)) best = name;
    i = j;
  }
  if (best) return best;
  // A clause that opens on a phrase of its own before a comma ("a full legal case file, or …"), as said.
  const opening = String(text ?? '').match(/^((?:a|an|the)\s+)?([^,;:.!?]+?),/i);
  if (opening) {
    const words = opening[0].replace(/,$/, '').trim().split(/\s+/);
    const head = words[0].toLowerCase();
    if (words.length >= 2 && words.length <= 5 && opening[0].length <= 31 && (!TAIL_STOP.has(head) || /^(a|an|the)$/.test(head)) && keyTerms(opening[0]).length >= 2) return opening[0].replace(/,$/, '').trim();
  }
  // The stressed end of a sentence the clause completes ("… trusting Terra to mark Sol's homework."), as said: two to four words from a content word.
  // Else the end of the clause itself, where its stress falls ("… hand it an entire codebase,").
  const ended = String(text ?? '').split(/(?<=[.!?])\s+/).filter((sentence) => /[.!?]["”']?$/.test(sentence.trim()) || sentence.trim().split(/\s+/).length >= 6);
  for (const sentence of ended.reverse()) {
    const words = sentence.trim().replace(/[.!?,;:"”']+$/, '').split(/\s+/);
    for (let k = 4; k >= 2; k -= 1) {
      const tail = words.slice(-k);
      const lead = tail[0].toLowerCase().replace(/[^\p{L}'’-]/gu, '');
      const last = tail.at(-1).toLowerCase().replace(/[^\p{L}'’-]/gu, '');
      // A phrasal verb may end on its particle ("the others catch up"), a verb on its object ("actually uses it").
      if (tail.length < k || (TAIL_STOP.has(lead) && !/^(a|an|the)$/.test(lead)) || (TAIL_STOP.has(last) && !/^(up|out|down|over|it|them|one)$/.test(last)) || /^(be|been|has|have|had|do|does|did|can|will|would)$/.test(last) || /[,;:]$/.test(tail.slice(0, -1).join(' '))) continue;
      const phrase = tail.join(' ');
      if (phrase.length <= 30 && keyTerms(phrase).length >= 1) return phrase;
    }
  }
  if (!loose) return null;
  // Loose (a static run would outlast the format's limit): the last run of two to four words the clause says that starts and ends on a content word.
  const all = String(text ?? '').split(/\s+/).map((word) => word.replace(/[,;:.!?"“”()]+$/g, '').replace(/^["“(]+/, '')).filter(Boolean);
  for (let end = all.length; end >= 2; end -= 1) {
    for (let k = 4; k >= 2; k -= 1) {
      const run = all.slice(Math.max(0, end - k), end);
      const first = run[0].toLowerCase(), final = run.at(-1).toLowerCase();
      if (run.length === k && !TAIL_STOP.has(first) && !TAIL_STOP.has(final) && run.join(' ').length <= 30) return run.join(' ');
    }
  }
  return null;
}
const TAIL_STOP = new Set(['others', 'theirs', 'ours', 'yours', 'mine', 'something', 'anything', 'everything', 'nothing', 'a', 'an', 'the', 'and', 'but', 'or', 'so', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'it', 'its', 'that', 'this', 'than', 'as', 'if', 'not', 'one', 'there', 'they', 'we', 'you', 'he', 'she', 'his', 'her', 'their', 'our', 'your', 'about', 'into', 'over', 'up', 'down', 'out', 'what', 'which', 'who', 'when', 'where', 'how', 'why']);

// States that carry on the card already on screen (no new card): a focus step through its items, a guide line drawn
// over it, or a plain hold.
export const EXTENDS = Object.freeze(new Set(['focus', 'hold', 'guide']));
const ITEM_KEYS = ['data', 'entries', 'rows', 'steps', 'lines', 'points'];

/** How many items a focus can step through on a state's card (a module with shot states), else null. */
function focusItems(state) {
  const definition = catalogModules()[state.module] ?? null;
  const spec = stateSpec(state.module, definition);
  if (!spec?.items?.length || state.module === 'unit-grid') return null;
  const key = ITEM_KEYS.find((name) => Array.isArray(state.params?.[name]));
  return key && state.params[key].length >= 2 ? state.params[key].length : null;
}

// A card made of the clause's key words ("Surface routine updated", "ENTITY") is not a headline. A chapter
// opener (its chapter title), a claim card, a call to action and a sting say something of their own.
function isSalad(decision, state) {
  if (['title', 'claim', 'sting', 'cta'].includes(state.kind)) return false;
  if (GENERIC_MODULES.has(decision.module)) return true;
  return decision.module === 'particle-text' && !/\d/.test(String(decision.params?.text ?? ''));
}

function choose(state, previous, { history, avoid, registered, wide, check }) {
  // A chapter opens on its title.
  if (state.kind === 'title' && state.chapterTitle) {
    const params = capabilityParams('motion-title', state);
    if (check('motion-title', params)) return { capability: 'motion-title', module: 'motion-title', fallback: false, params, change: 'swap', why: 'title: the chapter title' };
  }
  // A paired clause rebuilds the series on screen with its own figures (and guide) added.
  if (previous && state.paired > 0 && previous.kind === 'series') {
    const params = capabilityParams(previous.module, state);
    if (check(previous.module, params)) return { capability: previous.capability, module: previous.module, fallback: previous.fallback === true, params, change: 'build', why: `series: builds on ${previous.module} (${state.evidence.data.series.length} values${state.evidence.data.reference ? `, ${state.evidence.data.reference.label} guide` : ''})` };
  }
  // A build: the module on screen takes this clause's entries (a bar arrives, then a second bar).
  // Never onto a generic card (a headline is not an entry), nor for a clause with a list of its own.
  if (previous && !state.alone && !state.evidence?.capture && previous.builds < 2 && familyOf(state.kind) === familyOf(previous.kind) && !GENERIC_MODULES.has(previous.module) && !(state.facts?.items?.length >= 3)) {
    const add = capabilityAdditions(previous.module, state);
    const params = add ? appendEntries(previous.params, add, previous.module) : null;
    if (params && check(previous.module, params)) return { capability: previous.capability, module: previous.module, fallback: previous.fallback === true, params, change: 'build', why: `${state.kind}: builds on ${previous.module} (+${add.items.length} ${add.key})` };
  }
  const known = new Set(registered);
  // A call to action or a sting is structure: it never plays the clause's capture.
  const capture = STRUCTURE_KINDS.has(state.kind) ? null : state.evidence?.capture ?? null;
  // A clause backed by a source's own words can show them (a quote card, a post) where it would get a generic card.
  const quoted = state.evidence?.quote && familyOf(state.kind) === 'idea' ? capabilitiesFor('quote', { wide }) : [];
  // A verified claim's own card (a PR, a commit, a diff in evidence.data) can show any clause it backs.
  const carded = !STRUCTURE_KINDS.has(state.kind) && state.evidence?.status === 'verified' && typeof state.evidence?.data?.module === 'string' && capability(state.evidence.data.module) ? [state.evidence.data.module] : [];
  const candidates = [...new Set([...capabilitiesFor(state.kind, { evidence: capture?.kind ?? null, wide }), ...quoted, ...carded])];
  const scored = candidates.map((id, order) => {
    const resolved = resolveCapability(id, { registered });
    const recentIndex = history.recent.lastIndexOf(resolved.module);
    const distance = recentIndex < 0 ? Infinity : history.recent.length - recentIndex;
    let score = -0.6 * order;
    if (distance !== Infinity) score -= 4 * Math.max(0, (RECENT + 1 - distance) / RECENT);
    score -= 0.12 * (history.counts[resolved.module] ?? 0);
    score -= 2 * (avoid[resolved.module] ?? 0);
    if (previous?.module === resolved.module) score -= 3;
    if (capture && capability(id)?.evidence.includes(capture.kind)) score += 3;
    if (!resolved.fallback && isPlanned(id)) score += 0.5;
    return { id, resolved, score };
  }).sort((a, b) => b.score - a.score);
  const source = state.evidence ? ` (evidence ${state.evidence.claim}${state.evidence.capture ? `, capture ${state.evidence.capture.id}` : ''})` : '';
  // A pinned timeline that has no room for every card keeps the latest ones.
  const cards = state.evidence?.data?.cards;
  if (Array.isArray(cards) && cards.length > 1 && known.has('date-pinned-timeline')) {
    for (let drop = 0; drop < cards.length; drop += 1) {
      const trimmed = { ...state, evidence: { ...state.evidence, data: { ...state.evidence.data, cards: cards.slice(drop) } } };
      const params = capabilityParams('date-pinned-timeline', trimmed);
      if (check('date-pinned-timeline', params)) return { capability: 'date-pinned-timeline', module: 'date-pinned-timeline', fallback: false, params, change: 'swap', why: `${state.kind}${source}: date-pinned-timeline (${cards.length - drop} of ${cards.length} cards)` };
    }
  }
  // The best candidate that draws the clause, a specific module ahead of any generic one (the cap on generic cards).
  let generic = null;
  for (const { id } of scored) {
    // A registered module takes the clause or is skipped; a planned one walks its fallbacks.
    const modules = known.has(id) ? [id] : fallbackChain(id, { registered });
    for (const module of modules) {
      const params = capabilityParams(module, state);
      if (!check(module, params)) continue;
      const fellBack = module !== id;
      const decision = { capability: id, module, fallback: fellBack, params, change: 'swap', why: `${state.kind}${source}: ${id}${fellBack ? ` (→ ${module} until ${id} is registered)` : ''}` };
      if (!GENERIC_MODULES.has(module)) return generic ? { ...decision, why: `${decision.why}, ahead of ${generic.module}` } : decision;
      generic ??= decision;
      break;
    }
  }
  if (generic) return generic;
  const params = capabilityParams('concept-card', state);
  return { capability: 'concept-card', module: 'concept-card', fallback: false, params, change: 'swap', why: `${state.kind}${source}: nothing else fits, a concept card` };
}

function appendEntries(before, add, module) {
  if (!Array.isArray(before?.[add.key])) return null;
  const label = (item) => String(item?.label ?? JSON.stringify(item)).toLowerCase();
  const seen = new Set(before[add.key].map(label));
  const added = add.items.filter((item) => !seen.has(label(item)));
  if (!added.length) return null;
  let merged = [...before[add.key], ...added].slice(-(MAX_ITEMS[add.key] ?? 4));
  if (module === 'checklist') merged = merged.map((row, i) => ({ ...row, at: round(0.6 + i * 0.5, 2) }));
  return { ...before, [add.key]: merged, ...(module === 'bar-chart' ? { highlight: merged.length - 1 } : {}) };
}

function makeChecker(format, brand) {
  const story = { schema: 'launchclip.story.v1', lane: 'motion', format: { width: format.width, height: format.height, fps: 30, duration: 20 }, brand, scenes: [], resolved: { duration: 20, fps: 30 } };
  const cache = new Map();
  return (module, params, seconds = 6) => {
    if (!params) return false;
    const key = `${module}:${seconds}:${JSON.stringify(params)}`;
    if (cache.has(key)) return cache.get(key);
    const scene = { id: 'check', module, start: 0, end: seconds, params };
    let ok = true;
    try { resolveModule(scene, { ...story, scenes: [scene] }); } catch { ok = false; }
    cache.set(key, ok);
    return ok;
  };
}

// ---------------------------------------------------------------------------
// The whole transcript

/**
 * Direct a long video. input: {words (NARRATION.json words), chapters
 * ([{id, title, start}]), ledger (research/evidence.json), captures
 * ([launchclip.capture.v1]), format ({width, height}), title, tokens
 * ({[model id]: {text, tokens, encoding}}: BPE splits precomputed by
 * src/tokenizer.js for the model ids the script names)}. options:
 * {cadence: 'long-form', style: 'default', chunkSeconds: 180, previous (an
 * earlier beat map: matching chunks are reused), avoid (historyAvoid()),
 * ctas (mid-roll calls to action: seconds or {at, action, detail, handle};
 * the clause at that time becomes a cta state), stings (true: a logo sting
 * opens and closes the video; stingBrand {name?, logo?, tagline?, mark?,
 * wordmark?} for the channel's own: with a name the sting is the channel's
 * logo-sting, and the map keeps it as map.channel for the story's subscribe
 * pill and watermark),
 * registered (module ids; knownModules() by default), brand, onChunk,
 * camera (false: no camera pass; by default every shot gets an entry move,
 * the cards the narration points into get zooms and each chapter of 4+ shots
 * an overview, kit/core/beat-camera.mjs)}.
 * → the beat map, with its report.
 */
export function directLongForm(input, options = {}) {
  const words = narrationWords(input.words);
  if (!words.length) throw new Error('directLongForm needs narration words');
  const format = { width: input.format?.width ?? 1920, height: input.format?.height ?? 1080 };
  const cadence = options.cadence ?? 'long-form';
  const style = options.style ?? 'default';
  const target = cadenceTarget(cadence, style);
  const registered = options.registered ?? knownModules();
  const weights = avoidWeights(options.avoid);
  const duration = round(words.at(-1).end + 0.5);
  const chunks = longFormChunks(input.chapters ?? [], words, { chunkSeconds: options.chunkSeconds ?? 180, duration });
  const reuse = new Map((options.previous?.chunks ?? []).map((chunk) => [chunk.key, chunk]));
  const previousShots = new Map();
  for (const chapter of options.previous?.chapters ?? []) for (const shot of chapter.shots ?? []) previousShots.set(shot.id, shot);
  // Structure: mid-roll calls to action (seconds, or {at, action, detail, handle}) and logo stings at the open and close.
  const structure = { ctas: (options.ctas ?? []).map((entry) => (typeof entry === 'number' ? { at: entry } : { ...entry })).sort((a, b) => a.at - b.at), stings: options.stings === true, brand: options.stingBrand ?? null, title: input.title ?? null };
  // The brand joins the cache key only when set, so maps planned without one keep their keys.
  const settings = { structure: { ctas: structure.ctas, stings: structure.stings, ...(structure.brand ? { brand: structure.brand } : {}) }, cadence, style, format, registered: [...registered].sort(), ...(input.tokens ? { tokens: input.tokens } : {}), ledger: input.ledger?.claims?.map((claim) => [claim.id, claim.status, claim.text]) ?? null, captures: (input.captures ?? []).map((entry) => [entry.id, entry.kind, entry.url]) };
  const settingsKey = hashText(JSON.stringify(settings));

  let history = emptyHistory();
  const chapters = [];
  const chunkOut = [];
  let reused = 0;
  for (const chunk of chunks) {
    let chapter = chapters.find((entry) => entry.id === chunk.chapter.id);
    if (!chapter) {
      const plate = choosePlate(history, chunk.chapter.index);
      history.plates = [...history.plates, plate];
      chapter = { id: chunk.chapter.id, title: chunk.chapter.title, start: chunk.chapter.start, end: chunk.chapter.end, plate: { kind: plate.kind, params: { tint: plate.tint } }, background: plate.background, shots: [] };
      chapters.push(chapter);
    }
    const text = words.slice(chunk.words[0], chunk.words[1] + 1).map((word) => `${word.text}@${word.start}`).join(' ');
    const key = hashText(`${settingsKey}|${chunk.id}|${chunk.first}|${text}|${JSON.stringify(history)}|${JSON.stringify(weights)}`);
    const hit = reuse.get(key);
    let result;
    if (hit && hit.shots.every((id) => previousShots.has(id))) {
      result = { shots: hit.shots.map((id) => previousShots.get(id)), history: hit.history };
      reused += 1;
    } else {
      result = directChunk(chunk, { words, history, target, ledger: input.ledger ?? null, captures: input.captures ?? [], registered, format, brand: options.brand, avoidWeights: weights, structure, tokens: input.tokens ?? null });
    }
    // The chunk before holds until this one starts.
    const lastBefore = chapters.flatMap((entry) => entry.shots).at(-1);
    if (lastBefore && result.shots.length) { lastBefore.states.at(-1).end = result.shots[0].start; lastBefore.end = result.shots[0].start; }
    chapter.shots.push(...result.shots);
    history = result.history;
    chunkOut.push({ id: chunk.id, chapter: chunk.chapter.id, words: chunk.words, start: chunk.start, end: chunk.end, key, shots: result.shots.map((shot) => shot.id), history: clone(history) });
    options.onChunk?.({ chunk: chunk.id, reused: Boolean(hit) && result.history === hit.history });
  }
  const lastShot = chapters.flatMap((entry) => entry.shots).at(-1);
  if (lastShot) { lastShot.states.at(-1).end = duration; lastShot.end = duration; }
  for (const chapter of chapters) { chapter.start = chapter.shots[0]?.start ?? chapter.start; chapter.end = chapter.shots.at(-1)?.end ?? chapter.end; }
  chapters[0].start = 0;
  if (chapters[0].shots[0]) { chapters[0].shots[0].start = 0; chapters[0].shots[0].states[0].start = 0; }
  const channel = typeof structure.brand?.name === 'string' && structure.brand.name.trim() ? structure.brand : null;
  const map = { schema: BEAT_MAP_SCHEMA, ...(input.title ? { title: input.title } : {}), format, cadence: { format: cadence, style }, duration, ...(channel ? { channel } : {}), chapters, chunks: chunkOut };
  // The camera (kit/core/beat-camera.mjs): each shot's entry move, zooms into what a line names, an overview per chapter.
  if (options.camera !== false) planCamera(map, words, { format, brand: options.brand ?? DEFAULT_BRAND });
  map.report = beatMapReport(map, { reused });
  return map;
}

/** Visual events (every state start) and hard cuts (every shot start), after 0. */
export function beatMapEvents(map) {
  const events = [], cuts = [];
  for (const chapter of map.chapters ?? []) for (const shot of chapter.shots ?? []) {
    if (shot.start > 0) cuts.push(shot.start);
    // A hold carries the card on: no new visual, no event. A focus step is one.
    for (const state of shot.states ?? []) if (state.start > 0 && state.change !== 'hold') events.push(state.start);
  }
  return { events, cuts, duration: map.duration };
}

/**
 * The planning report: the cadence gate against the map's format and style,
 * module variety, evidence coverage (claims shown with a sourced visual),
 * fallbacks (modules without params yet, or not registered) and chunk reuse.
 */
export function beatMapReport(map, { reused = 0 } = {}) {
  const { events, cuts, duration } = beatMapEvents(map);
  const states0 = (map.chapters ?? []).flatMap((chapter) => chapter.shots.flatMap((shot) => shot.states));
  const words = states0.length ? states0.at(-1).words[1] - states0[0].words[0] + 1 : null;
  const stats = eventStats(events, { duration, cuts, words });
  const target = cadenceTarget(map.cadence?.format ?? 'long-form', map.cadence?.style ?? 'default');
  const gate = cadenceGate(stats, target);
  const states = (map.chapters ?? []).flatMap((chapter) => chapter.shots.flatMap((shot) => shot.states));
  const shots = (map.chapters ?? []).flatMap((chapter) => chapter.shots);
  const counts = {};
  // Variety counts the cards put on screen; a hold carries one on.
  const shown = states.filter((state) => state.change !== 'hold');
  for (const state of shown) counts[state.module] = (counts[state.module] ?? 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  let run = 1, longestRun = states.length ? 1 : 0;
  for (let i = 1; i < shots.length; i += 1) {
    run = shots[i].states[0].module === shots[i - 1].states.at(-1).module ? run + 1 : 1;
    longestRun = Math.max(longestRun, run);
  }
  const claims = states.filter(isClaim);
  const sourced = claims.filter((state) => state.evidence?.source);
  const wanted = {};
  for (const state of states) if (state.fallback) {
    const entry = (wanted[state.capability] ??= { states: 0, using: {} });
    entry.states += 1;
    entry.using[state.module] = (entry.using[state.module] ?? 0) + 1;
  }
  const changes = {};
  for (const state of states) changes[state.change] = (changes[state.change] ?? 0) + 1;
  const perShot = shots.map((shot) => shot.states.length);
  return {
    cadence: { ...stats, gate },
    shots: { count: shots.length, states_per_shot: { min: Math.min(...perShot), max: Math.max(...perShot), mean: round(perShot.reduce((a, b) => a + b, 0) / Math.max(1, perShot.length), 2) }, changes },
    variety: { modules: top.length, top: top.slice(0, 5).map(([id, n]) => ({ id, share: round(n / Math.max(1, shown.length), 3) })), longest_same_module_across_cuts: longestRun },
    evidence: { claims: claims.length, sourced: sourced.length, coverage: claims.length ? round(sourced.length / claims.length, 3) : null, captures: states.filter((state) => state.evidence?.capture).length },
    camera: cameraSummary(map),
    fallbacks: Object.entries(wanted).sort((a, b) => b[1].states - a[1].states).map(([id, entry]) => ({ wanted: id, states: entry.states, using: Object.keys(entry.using).sort((x, y) => entry.using[y] - entry.using[x]) })),
    chunks: { count: map.chunks?.length ?? 0, reused }
  };
}

/** Whether a state makes a checkable claim (a number, a date, a quote or a proof line). */
export function isClaim(state) {
  return ['number', 'proof', 'quote'].includes(state.intent) || ['stat', 'money', 'compute', 'share', 'series', 'compare', 'ranking', 'quote', 'social', 'date', 'pr', 'commit', 'diff', 'page'].includes(state.kind) || Boolean(state.evidence);
}

/** The beat map as a text report (the planning gate's output). */
export function beatMapReportText(map) {
  const r = map.report ?? beatMapReport(map);
  const c = r.cadence;
  const lines = [
    `beat map: ${map.title ?? 'untitled'} — ${round(map.duration / 60, 1)} min, ${map.chapters.length} chapters, ${r.shots.count} shots, ${c.events + 1} states, ${r.camera?.zooms ?? 0} zooms, ${r.camera?.overviews ?? 0} overviews`,
    `cadence ${c.gate.ok ? 'passed' : 'FAILED'} (${c.gate.format}, ${c.gate.style}): ${c.events} events, ${c.per_min}/min, ${c.words_per_event} words per event; gaps p10 ${c.gap.p10} / p50 ${c.gap.p50} / p90 ${c.gap.p90} s; longest static ${c.longest_static.seconds} s; ${c.cuts} cuts, median ${c.cut_gap?.p50} s apart`
  ];
  for (const check of c.gate.checks) lines.push(`  ${check.ok ? 'ok  ' : 'FAIL'} ${check.id.padEnd(15)} ${String(check.value).padStart(7)}  want ${check.want}`);
  lines.push(`states per shot ${r.shots.states_per_shot.min}–${r.shots.states_per_shot.max} (mean ${r.shots.states_per_shot.mean}); changes ${Object.entries(r.shots.changes).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  lines.push(`variety: ${r.variety.modules} modules; top ${r.variety.top.map((entry) => `${entry.id} ${Math.round(entry.share * 100)}%`).join(', ')}; longest same-module run across cuts ${r.variety.longest_same_module_across_cuts}`);
  lines.push(`evidence: ${r.evidence.sourced}/${r.evidence.claims} claims shown with a sourced visual (${r.evidence.coverage === null ? 'n/a' : `${Math.round(r.evidence.coverage * 100)}%`}), ${r.evidence.captures} on a capture`);
  if (r.fallbacks.length) lines.push(`fallbacks (modules without params yet, or not registered): ${r.fallbacks.map((entry) => `${entry.wanted}→${entry.using.join('/')} ×${entry.states}`).join(', ')}`);
  const cam = r.camera;
  if (cam && Object.keys(cam.entries).length) {
    lines.push(`camera: ${Object.entries(cam.entries).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}; longest push-in run ${cam.longest_push_run}; ${cam.zooms} zooms (${cam.zooms_per_min}/min), ${cam.overviews} overviews`);
    for (const zoom of cam.list.zooms) lines.push(`  zoom     ${clock(zoom.at)}  ${zoom.module} → ${zoom.element} on "${zoom.word}" (${zoom.by})`);
    for (const overview of cam.list.overviews) lines.push(`  overview ${clock(overview.at)}  ${overview.chapter}: ${overview.why.replace(/^overview of [^:]+: /, '')}`);
  }
  lines.push(`chunks: ${r.chunks.count} (${r.chunks.reused} reused)`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Conversions

/** The beat map as a direction map (launchclip.direction-map.v1): a section per chapter, a line per state. */
export function beatMapToDirection(map, { profile = 'youtube-long-form' } = {}) {
  return {
    schema: DIRECTION_SCHEMA,
    profile,
    sections: map.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      layout: 'full',
      lines: chapter.shots.flatMap((shot) => shot.states.map((state) => ({ words: state.words, intent: state.intent, treatment: 'insert', scenes: [state.id], why: state.why })))
    }))
  };
}

/**
 * A storyboard for [from, to] of the map (a sample to render, or a cut):
 * a scene per state on the story's clock, a cut at each shot start and a
 * soft change inside a shot. A scene whose module does not resolve walks its
 * fallback chain. options: {words, from, to, brand, fps, format, title,
 * plates, channel, style, captions, chapters}.
 *
 * The long-form look (kit/core/plates.mjs, catalog-h-channel.mjs), on a
 * long-form map only, so Shorts and other formats are untouched:
 * - plates (default: on for a long-form map): each chapter's plate on its
 *   chapter, so the backdrop changes at chapter boundaries and never cuts
 *   inside one; a window inside one chapter takes it as the story's plate;
 * - channel ({name, logo?}; default map.channel): a subscribe-cta pill on
 *   track 1 at each call to action, over the scene before it (which holds),
 *   and a channel-watermark on track 2 across the whole video;
 * - style "glass-explainer": the story names the style and its rim-glass panel;
 * - camera (default: on for a long-form map; false: hard cuts as before): a
 *   world camera, each shot entering on its planned move (push, pull,
 *   whip-pan, orbit, overview), the cards inside a shot on a rack focus, and
 *   each card's zooms as scene.zooms on the story clock. An overview whose
 *   chapter has fewer than 3 scenes in the window, or a kit without the
 *   overview transition, enters on a pull instead.
 */
export function beatMapToStory(map, options = {}) {
  const from = options.from ?? 0;
  const to = Math.min(options.to ?? map.duration, map.duration);
  const format = options.format ?? map.format;
  const fps = options.fps ?? 30;
  const brand = options.brand ?? DEFAULT_BRAND;
  const duration = round(to - from);
  const check = makeChecker(format, brand);
  const longForm = (map.cadence?.format ?? 'long-form') === 'long-form';
  const plates = options.plates ?? longForm;
  const channelIn = options.channel === undefined ? (longForm ? map.channel : null) : options.channel;
  const channel = typeof channelIn?.name === 'string' && channelIn.name.trim() ? { name: channelIn.name.trim().slice(0, 32), ...(channelIn.logo ? { logo: channelIn.logo } : {}) } : null;
  const scenes = [];
  const overlays = [];
  const chapters = [];
  let background = null;
  const camera = options.camera ?? longForm;
  const overviewReady = TRANSITION_TYPES.includes('overview');
  const entered = new Set();
  const sceneChapter = new Map();
  const pendingZooms = new Map();
  for (const chapter of map.chapters) {
    if (chapter.end <= from || chapter.start >= to) continue;
    background ??= chapter.background;
    chapters.push({ id: chapter.id, title: chapter.title.slice(0, 60), start: round(Math.max(0, chapter.start - from)), ...(plates && chapter.plate ? { plate: chapter.plate } : {}) });
    for (const shot of chapter.shots) for (const [k, state] of shot.states.entries()) {
      const a = Math.max(state.start, from), b = Math.min(state.end, to);
      const seconds = round(b - a);
      // A call to action with a channel: the subscribe pill rides over the scene before, which holds through it.
      if (channel && state.kind === 'cta' && scenes.length) {
        scenes.at(-1).end = round(b - from);
        const end = Math.min(a + CTA_SECONDS, to);
        if (end - a >= CTA_MIN_SECONDS) overlays.push({ id: `${state.id}-subscribe`, module: 'subscribe-cta', track: 1, start: round(a - from), end: round(end - from), params: { name: channel.name, ...(channel.logo ? { logo: channel.logo } : {}) } });
        continue;
      }
      // A hold or a focus step carries the card before on: its scene runs longer, and a focus step becomes one of its shot states.
      if (EXTENDS.has(state.change) && scenes.length && scenes.at(-1).module === state.module) {
        const scene = scenes.at(-1);
        scene.end = round(b - from);
        if (state.change === 'focus' && Number.isInteger(state.focus) && (scene.states?.length ?? 0) < MAX_SHOT_STATES) scene.states = [...(scene.states ?? []), { at: round(a - from), set: { focus: state.focus } }];
        if (state.change === 'guide' && state.guide && (scene.states?.length ?? 0) < MAX_SHOT_STATES) scene.states = [...(scene.states ?? []), { at: round(a - from), set: { guide: state.guide } }];
        continue;
      }
      let module = state.module, params = state.params;
      if (!check(module, params, seconds)) {
        module = fallbackChain(state.capability).find((id) => check(id, capabilityParams(id, state), seconds)) ?? null;
        params = module ? capabilityParams(module, state) : null;
      }
      // Too short for any module that shows it: the scene before holds on.
      if (!module || seconds < 1) { if (scenes.length) scenes.at(-1).end = round(b - from); continue; }
      let entry = k > 0 && scenes.length ? { type: 'rack-focus', dur: 0.4 } : null;
      // With the camera, a shot's first scene enters on the shot's move.
      if (camera && scenes.length && !entered.has(shot.id) && shot.camera) {
        const { type, dur, direction, span, hold } = shot.camera;
        entry = type === 'overview' ? { type, dur, span, hold, chapter: shot.camera.chapter } : { type, dur, ...(direction ? { direction } : {}) };
      }
      entered.add(shot.id);
      const scene = { id: state.id, module, start: round(a - from), end: round(b - from), params, ...(entry ? { in: entry } : {}) };
      scenes.push(scene);
      sceneChapter.set(scene, chapter.id);
      if (camera && state.zooms?.length) pendingZooms.set(scene, state.zooms);
    }
  }
  // A scene whose focus steps do not fit (too close to its entrance or exit) keeps its card and drops the steps.
  for (const scene of scenes) {
    if (!scene.states) continue;
    const story = { schema: 'launchclip.story.v1', lane: 'motion', format: { width: format.width, height: format.height, fps, duration }, brand, scenes: [scene], resolved: { duration, fps } };
    try { resolveModule(scene, story); } catch { delete scene.states; }
  }
  if (scenes.length) scenes[0].start = 0;
  if (scenes.length) scenes.at(-1).end = duration;
  chapters.sort((a, b) => a.start - b.start);
  if (chapters.length) chapters[0].start = 0;
  const withChapters = chapters.length >= 2 && options.chapters !== false;
  if (camera) {
    // An overview needs the chapter it maps in the window (and the kit's overview move); otherwise it pulls back.
    scenes.forEach((scene, i) => {
      if (scene.in?.type !== 'overview') return;
      const { chapter: id, ...entry } = scene.in;
      const shown = scenes.slice(0, i).filter((before) => sceneChapter.get(before) === id).length;
      if (!overviewReady || shown < 3) scene.in = { type: 'pull', dur: ENTRY.pull };
      else scene.in = withChapters ? entry : { ...entry, span: Math.min(8, shown) };
    });
    // Zooms on the story clock, kept clear of the scene's entry and exit; none on a scene under 3 s.
    for (const [scene, zooms] of pendingZooms) {
      if (scene.end - scene.start < 3) continue;
      const after = scene.start + (scene.in?.dur ?? 0) + 0.3;
      const kept = zooms.map((zoom) => ({ at: round(zoom.at - from), until: round(zoom.until - from), ...(zoom.target !== undefined ? { target: zoom.target } : { box: zoom.box }) }))
        .filter((zoom) => zoom.at >= after && zoom.until <= scene.end - 0.2);
      if (kept.length) scene.zooms = kept;
    }
  }
  // One chapter in the window (or no chapter list): its plate is the story's.
  const plate = plates && !withChapters ? chapters[0]?.plate ?? null : null;
  if (channel && duration > 0) overlays.push({ id: 'channel-watermark', module: 'channel-watermark', track: 2, start: 0, end: duration, params: { name: channel.name, ...(channel.logo ? { logo: channel.logo } : {}) } });
  const glass = options.style === 'glass-explainer';
  return {
    schema: 'launchclip.story.v1',
    title: options.title ?? map.title ?? 'Beat map sample',
    lane: 'motion',
    format: { width: format.width, height: format.height, fps, duration, ...(format.platform ? { platform: format.platform } : {}) },
    brand,
    ...(glass ? { style: 'glass-explainer', panel: { treatment: 'rim-glass', radius: 22 } } : {}),
    ...(camera ? { camera: { mode: 'world', layout: 'path', spacing: 0.14, parallax: true } } : {}),
    ...(background ? { background: { kind: background } } : {}),
    ...(plate ? { plate } : {}),
    audio: { words: 'NARRATION.json' },
    scenes: [...scenes, ...overlays],
    ...(withChapters ? { chapters } : {}),
    overlays: options.captions === false ? [] : [{ type: 'captions', style: 'word-highlight' }]
  };
}

/** NARRATION.json words for [from, to] of the map's clock, from 0. */
export function windowWords(words, from, to) {
  return narrationWords(words).filter((word) => word.start >= from - 1e-6 && word.end <= to + 1e-6).map((word) => ({ text: word.text, start: round(word.start - from), end: round(word.end - from) }));
}

// ---------------------------------------------------------------------------
// Dry runs

/** A markdown script: `# Title`, then `## Chapter` headings over paragraphs. → {title, chapters: [{id, title, text}]} */
export function parseScript(markdown) {
  const lines = String(markdown ?? '').split(/\r?\n/);
  let title = null;
  const chapters = [];
  for (const line of lines) {
    const heading = line.match(/^(#{1,2})\s+(.+?)\s*$/);
    if (heading?.[1] === '#' && !title) { title = heading[2]; continue; }
    if (heading?.[1] === '##') { chapters.push({ id: slugOf(heading[2]) || `c${chapters.length + 1}`, title: heading[2], text: '' }); continue; }
    if (!line.trim()) continue;
    if (!chapters.length) chapters.push({ id: 'intro', title: title ?? 'Intro', text: '' });
    chapters.at(-1).text = `${chapters.at(-1).text} ${line.trim()}`.trim();
  }
  return { title, chapters: chapters.filter((chapter) => chapter.text) };
}

/**
 * Timed words for a script with no voice yet: a steady wpm, longer words
 * taking longer, and pauses at commas, sentence ends and chapter breaks.
 * Deterministic. → {words: [{text, start, end}], chapters: [{id, title, start}], duration}
 */
export function dryRunWords(script, { wpm = 140, comma = 0.18, sentence = 0.42, chapter = 1.2 } = {}) {
  const parsed = typeof script === 'string' ? parseScript(script) : script;
  const all = parsed.chapters.map((entry) => entry.text.split(/\s+/).filter(Boolean));
  const tokens = all.flat();
  const weight = (text) => 0.55 + 0.45 * Math.min(2.4, text.replace(/[^\p{L}\p{N}]/gu, '').length / 5);
  const mean = tokens.reduce((sum, text) => sum + weight(text), 0) / Math.max(1, tokens.length);
  const unit = 60 / wpm / mean;
  const words = [];
  const chapters = [];
  let t = 0.3;
  parsed.chapters.forEach((entry, c) => {
    if (c > 0) t += chapter;
    chapters.push({ id: entry.id, title: entry.title, start: c === 0 ? 0 : round(t - 0.2) });
    for (const text of all[c]) {
      const dur = weight(text) * unit;
      words.push({ text, start: round(t), end: round(t + dur * 0.92) });
      t += dur;
      if (/[.!?]["”')]?$/.test(text)) t += sentence;
      else if (/[,;:—–]$/.test(text)) t += comma;
    }
  });
  return { title: parsed.title, words, chapters, duration: round(t + 0.5) };
}

function clock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function slugOf(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hashText(text) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < text.length; i += 1) { const c = text.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822507); }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

function round(value, places = 3) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

