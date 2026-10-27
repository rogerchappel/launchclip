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

import { cadenceGate, cadenceTarget, eventStats } from './cadence.mjs';
import { DIRECTION_SCHEMA, classifyIntent, narrationWords } from './direction.mjs';
import { longFormChunks } from './long-form.mjs';
import { knownModules, resolveModule } from './modules.mjs';
import { CAPTURE_KIND_VISUALS, capabilitiesFor, capability, capabilityAdditions, capabilityParams, fallbackChain, keyTerms, resolveCapability } from './visual-capabilities.mjs';

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
// States between two plays of the same evidence capture.
const CAPTURE_GAP = 24;
// A phrase can break before these when a sentence runs long.
const PHRASE_STARTS = new Set(['in', 'on', 'with', 'that', 'who', 'from', 'to', 'for', 'by', 'over', 'across', 'after', 'before', 'into', 'about', 'than', 'compared', 'including', 'using', 'down', 'up']);
const CONJUNCTIONS = new Set(['and', 'but', 'so', 'because', 'which', 'while', 'then', 'when', 'where', 'until', 'though', 'although', 'as', 'or', 'yet', 'since', 'unless']);
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
    if (!currency && !unitWord && (/[a-z,]\s[A-Z][\w-]*[\s-]$/.test(before) || /\b(version|v|model|release|chapter|part|step|section|table|footnote|row)\s$/i.test(before))) continue;
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
  const list = value.match(/([\p{L}\p{N}'-]+(?: [\p{L}\p{N}'-]+)?), ([\p{L}\p{N}'-]+(?: [\p{L}\p{N}'-]+)?),? (?:and|or) ([\p{L}\p{N}'-]+(?: [\p{L}\p{N}'-]+)?)/u);
  const items = list ? [list[1].split(' ').at(-1), list[2], list[3].split(' ')[0]].filter((item) => item.length > 1) : [];
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

// The words after a number, up to four, stopping at punctuation and the next number.
function labelAfter(text, index) {
  const words = [];
  for (const word of text.slice(index).split(/[.,;:!?—–]/)[0].trim().split(/\s+/).filter(Boolean)) {
    if (/^\d|^(percent|and)$/i.test(word) || words.length === 4) break;
    words.push(word);
  }
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
  if (facts.quote || beat.intent === 'quote') return 'quote';
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
  for (const [kind, regex] of RULES.slice(7)) if (regex.test(beat.text)) return kind;
  if (facts.items?.length >= 3 || beat.intent === 'list') return 'list';
  if (beat.intent === 'process') return 'process';
  return 'concept';
}

// ---------------------------------------------------------------------------
// Evidence

const contentSet = (text) => new Set(keyTerms(text).map((word) => word.toLowerCase()));

/**
 * The best claim in the research ledger (launchclip.evidence.v1) for a
 * clause, and the capture (launchclip.capture.v1) that shows it (claim.capture,
 * as src/research writes it, then capture.claim(s), then a source URL): the claim
 * whose content words and numbers overlap the clause most, at least 0.3.
 * Contradicted claims never match. → {claim, status, kind, source, quote?,
 * capture?: {id, kind, out}} | null
 */
export function matchEvidence(beat, { ledger = null, captures = [] } = {}) {
  const claims = (ledger?.claims ?? []).filter((claim) => claim?.id && claim.status !== 'contradicted');
  if (!claims.length) return null;
  const words = contentSet(beat.text);
  const numbers = new Set((beat.facts?.numbers ?? []).map((entry) => entry.value));
  let best = null;
  for (const claim of claims) {
    const other = contentSet(claim.text);
    const shared = [...words].filter((word) => other.has(word)).length;
    const claimNumbers = extractFacts(claim.text).numbers.map((entry) => entry.value);
    const sameNumber = claimNumbers.some((n) => numbers.has(n));
    // One shared word is chance ("second" place, the "second" number); a number or two words are not.
    if (shared < 2 && !sameNumber) continue;
    let score = shared / Math.max(1, Math.min(words.size, other.size));
    if (sameNumber) score += 0.35;
    else if (numbers.size && claimNumbers.length) score -= 0.25;
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
    ...(source?.quote?.text ? { quote: source.quote.text } : {}),
    ...(capture ? { capture: { id: capture.id, kind: capture.kind, out: capture.out ?? `assets/evidence/${capture.id}.mp4` } } : {})
  };
}

// ---------------------------------------------------------------------------
// Directing a chunk

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
  const states = beats.map((beat, i) => {
    const facts = extractFacts(beat.text);
    const intent = beat.words[0] === 0 ? classifyIntent(beat.text, { index: 0 }) : classifyIntent(beat.text, { index: 1 });
    const draft = { ...beat, intent, facts };
    const evidence = matchEvidence(draft, { ledger, captures });
    if (evidence?.capture) {
      // A capture plays once in a while: shown again within CAPTURE_GAP states, the claim keeps its source line instead.
      const last = history.captures?.[evidence.capture.id];
      if (last !== undefined && history.states + i - last < CAPTURE_GAP) delete evidence.capture;
      else history.captures = { ...(history.captures ?? {}), [evidence.capture.id]: history.states + i };
    }
    if (evidence) draft.evidence = evidence;
    const opener = chunk.first && i === 0 && beat.words[0] !== 0;
    // The clause under a call-to-action time (or just after it, in a pause) carries it.
    const cta = (options.structure?.ctas ?? []).find((entry) => beat.start - 0.6 <= entry.at && entry.at < beat.end);
    const sting = options.structure?.stings && (beat.words[0] === 0 || beat.words[1] === total - 1);
    if (cta) draft.cta = cta;
    if (sting && options.structure.brand) draft.brand = options.structure.brand;
    draft.kind = sting ? 'sting' : cta ? 'cta' : opener ? 'title' : visualKind(draft);
    // Without the brand's mark, the sting is the video's title.
    if (sting && !draft.brand && options.structure?.title) draft.headline = options.structure.title.split(/[:—–]/)[0].trim();
    draft.headline ??= headlineOf(beat.text);
    if (opener) draft.kicker = `Chapter ${chunk.chapter.index + 1}`;
    const n = facts.numbers[0];
    if (n?.label) draft.label = n.label;
    return draft;
  });
  if (beats.length && beats.at(-1).words[1] === total - 1 && states.at(-1).intent !== 'cta') states.at(-1).closing = true;

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
  const shots = groups.map((group, g) => {
    const shotId = `${chunk.id}-sh${g + 1}`;
    const out = [];
    for (const [k, state] of group.entries()) {
      const previous = out.at(-1) ?? null;
      const decision = decide(state, previous, { history, avoid, registered, wide, check });
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
        change: k === 0 ? 'enter' : decision.change,
        params: decision.params,
        ...(state.evidence ? { evidence: state.evidence } : {}),
        why: decision.why,
        builds
      });
      history.recent = [...history.recent, decision.module].slice(-RECENT);
      history.counts[decision.module] = (history.counts[decision.module] ?? 0) + 1;
      history.states += 1;
    }
    return { id: shotId, start: out[0].start, end: out.at(-1).end, states: out };
  });
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

// The module, params and state change for one clause.
function decide(state, previous, { history, avoid, registered, wide, check }) {
  // A build: the module on screen takes this clause's entries (a bar arrives, then a second bar).
  if (previous && !state.evidence?.capture && previous.builds < 2 && familyOf(state.kind) === familyOf(previous.kind)) {
    const add = capabilityAdditions(previous.module, state);
    const params = add ? appendEntries(previous.params, add, previous.module) : null;
    if (params && check(previous.module, params)) return { capability: previous.capability, module: previous.module, fallback: previous.fallback === true, params, change: 'build', why: `${state.kind}: builds on ${previous.module} (+${add.items.length} ${add.key})` };
  }
  const known = new Set(registered);
  const candidates = capabilitiesFor(state.kind, { evidence: state.evidence?.capture?.kind ?? null, wide });
  const scored = candidates.map((id, order) => {
    const resolved = resolveCapability(id, { registered });
    const recentIndex = history.recent.lastIndexOf(resolved.module);
    const distance = recentIndex < 0 ? Infinity : history.recent.length - recentIndex;
    let score = -0.6 * order;
    if (distance !== Infinity) score -= 4 * Math.max(0, (RECENT + 1 - distance) / RECENT);
    score -= 0.12 * (history.counts[resolved.module] ?? 0);
    score -= 2 * (avoid[resolved.module] ?? 0);
    if (previous?.module === resolved.module) score -= 3;
    if (state.evidence?.capture && capability(id)?.evidence.includes(state.evidence.capture.kind)) score += 3;
    if (!resolved.fallback && capability(id)?.planned) score += 0.5;
    return { id, resolved, score };
  }).sort((a, b) => b.score - a.score);
  const source = state.evidence ? ` (evidence ${state.evidence.claim}${state.evidence.capture ? `, capture ${state.evidence.capture.id}` : ''})` : '';
  for (const { id } of scored) {
    // A registered module takes the clause or is skipped; a planned one walks its fallbacks.
    const modules = known.has(id) ? [id] : fallbackChain(id, { registered });
    for (const module of modules) {
      const params = capabilityParams(module, state);
      if (!check(module, params)) continue;
      const fellBack = module !== id;
      return { capability: id, module, fallback: fellBack, params, change: 'swap', why: `${state.kind}${source}: ${id}${fellBack ? ` (→ ${module} until ${id} is registered)` : ''}` };
    }
  }
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
 * ([launchclip.capture.v1]), format ({width, height}), title}. options:
 * {cadence: 'long-form', style: 'default', chunkSeconds: 180, previous (an
 * earlier beat map: matching chunks are reused), avoid (historyAvoid()),
 * ctas (mid-roll calls to action: seconds or {at, action, detail, handle};
 * the clause at that time becomes a cta state), stings (true: a logo sting
 * opens and closes the video; stingBrand {mark, wordmark} for the brand's own),
 * registered (module ids; knownModules() by default), brand, onChunk}.
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
  const settings = { structure: { ctas: structure.ctas, stings: structure.stings }, cadence, style, format, registered: [...registered].sort(), ledger: input.ledger?.claims?.map((claim) => [claim.id, claim.status, claim.text]) ?? null, captures: (input.captures ?? []).map((entry) => [entry.id, entry.kind, entry.url]) };
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
      result = directChunk(chunk, { words, history, target, ledger: input.ledger ?? null, captures: input.captures ?? [], registered, format, brand: options.brand, avoidWeights: weights, structure });
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
  const map = { schema: BEAT_MAP_SCHEMA, ...(input.title ? { title: input.title } : {}), format, cadence: { format: cadence, style }, duration, chapters, chunks: chunkOut };
  map.report = beatMapReport(map, { reused });
  return map;
}

/** Visual events (every state start) and hard cuts (every shot start), after 0. */
export function beatMapEvents(map) {
  const events = [], cuts = [];
  for (const chapter of map.chapters ?? []) for (const shot of chapter.shots ?? []) {
    if (shot.start > 0) cuts.push(shot.start);
    for (const state of shot.states ?? []) if (state.start > 0) events.push(state.start);
  }
  return { events, cuts, duration: map.duration };
}

/**
 * The planning report: the cadence gate against the map's format and style,
 * module variety, evidence coverage (claims shown with a sourced visual),
 * fallbacks (planned modules not registered yet) and chunk reuse.
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
  for (const state of states) counts[state.module] = (counts[state.module] ?? 0) + 1;
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
    variety: { modules: top.length, top: top.slice(0, 5).map(([id, n]) => ({ id, share: round(n / states.length, 3) })), longest_same_module_across_cuts: longestRun },
    evidence: { claims: claims.length, sourced: sourced.length, coverage: claims.length ? round(sourced.length / claims.length, 3) : null, captures: states.filter((state) => state.evidence?.capture).length },
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
    `beat map: ${map.title ?? 'untitled'} — ${round(map.duration / 60, 1)} min, ${map.chapters.length} chapters, ${r.shots.count} shots, ${c.events + 1} states`,
    `cadence ${c.gate.ok ? 'passed' : 'FAILED'} (${c.gate.format}, ${c.gate.style}): ${c.events} events, ${c.per_min}/min, ${c.words_per_event} words per event; gaps p10 ${c.gap.p10} / p50 ${c.gap.p50} / p90 ${c.gap.p90} s; longest static ${c.longest_static.seconds} s; ${c.cuts} cuts, median ${c.cut_gap?.p50} s apart`
  ];
  for (const check of c.gate.checks) lines.push(`  ${check.ok ? 'ok  ' : 'FAIL'} ${check.id.padEnd(15)} ${String(check.value).padStart(7)}  want ${check.want}`);
  lines.push(`states per shot ${r.shots.states_per_shot.min}–${r.shots.states_per_shot.max} (mean ${r.shots.states_per_shot.mean}); changes ${Object.entries(r.shots.changes).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  lines.push(`variety: ${r.variety.modules} modules; top ${r.variety.top.map((entry) => `${entry.id} ${Math.round(entry.share * 100)}%`).join(', ')}; longest same-module run across cuts ${r.variety.longest_same_module_across_cuts}`);
  lines.push(`evidence: ${r.evidence.sourced}/${r.evidence.claims} claims shown with a sourced visual (${r.evidence.coverage === null ? 'n/a' : `${Math.round(r.evidence.coverage * 100)}%`}), ${r.evidence.captures} on a capture`);
  if (r.fallbacks.length) lines.push(`fallbacks (planned modules not registered yet): ${r.fallbacks.map((entry) => `${entry.wanted}→${entry.using.join('/')} ×${entry.states}`).join(', ')}`);
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
 * soft change inside a shot, the chapter's plate as a chapter (when plates
 * are registered) or its background. A scene whose module does not resolve
 * walks its fallback chain. options: {words, from, to, brand, fps, format,
 * title, plates (true when kit/core/plates.mjs is registered), captions}.
 */
export function beatMapToStory(map, options = {}) {
  const from = options.from ?? 0;
  const to = Math.min(options.to ?? map.duration, map.duration);
  const format = options.format ?? map.format;
  const fps = options.fps ?? 30;
  const brand = options.brand ?? DEFAULT_BRAND;
  const duration = round(to - from);
  const check = makeChecker(format, brand);
  const scenes = [];
  const chapters = [];
  let background = null;
  for (const chapter of map.chapters) {
    if (chapter.end <= from || chapter.start >= to) continue;
    background ??= chapter.background;
    chapters.push({ id: chapter.id, title: chapter.title.slice(0, 60), start: round(Math.max(0, chapter.start - from)), ...(options.plates ? { plate: chapter.plate } : {}) });
    for (const shot of chapter.shots) for (const [k, state] of shot.states.entries()) {
      const a = Math.max(state.start, from), b = Math.min(state.end, to);
      const seconds = round(b - a);
      let module = state.module, params = state.params;
      if (!check(module, params, seconds)) {
        module = fallbackChain(state.capability).find((id) => check(id, capabilityParams(id, state), seconds)) ?? null;
        params = module ? capabilityParams(module, state) : null;
      }
      // Too short for any module that shows it: the scene before holds on.
      if (!module || seconds < 1) { if (scenes.length) scenes.at(-1).end = round(b - from); continue; }
      scenes.push({ id: state.id, module, start: round(a - from), end: round(b - from), params, ...(k > 0 && scenes.length ? { in: { type: 'fade', dur: 0.35 } } : {}) });
    }
  }
  if (scenes.length) scenes[0].start = 0;
  if (scenes.length) scenes.at(-1).end = duration;
  chapters.sort((a, b) => a.start - b.start);
  if (chapters.length) chapters[0].start = 0;
  return {
    schema: 'launchclip.story.v1',
    title: options.title ?? map.title ?? 'Beat map sample',
    lane: 'motion',
    format: { width: format.width, height: format.height, fps, duration, ...(format.platform ? { platform: format.platform } : {}) },
    brand,
    ...(background ? { background: { kind: background } } : {}),
    audio: { words: 'NARRATION.json' },
    scenes,
    ...(chapters.length >= 2 && options.chapters !== false ? { chapters } : {}),
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

