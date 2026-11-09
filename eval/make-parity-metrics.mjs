// The make-vs-skill parity metrics (docs/MAKE_SKILL_PARITY.md, "Measuring
// parity"): what one finished project scores, and how two projects compare.
//
//   storyMetrics(resolved, {format, words})  modules, typography share, cadence, held and repeated cards
//   criticMetrics(critique)                  verdict, blocking and major findings
//   scriptMetrics(narration)                 hedging, meta-narration, repeated facts
//   projectMetrics({story, critique, narration, format, words}) → all three
//   compareProjects(make, skill, {kind})     → {rows, typography, parity}
//   formatComparison(comparison, labels)     → the table the CLI prints
//
// Pure: eval/make-parity.mjs reads the files. Nothing here renders or calls a model.

import { cadenceGate, cadenceTarget, eventStats, mergeEvents } from '@launchclip/core/cadence.mjs';

export const PARITY_SCHEMA = 'launchclip.make-parity.v1';
// The RFC's typography modules: words on a backdrop.
export const TYPOGRAPHY_MODULES = Object.freeze(['motion-title', 'kinetic-words', 'concept-card', 'glass-word', 'icon-row', 'object-card']);
// make is at parity when every metric is within this share of the skill's.
export const PARITY_TOLERANCE = 0.15;
// A news or research video is at most this much typography.
export const TYPOGRAPHY_LIMIT = 0.3;
export const TYPOGRAPHY_LIMITED_KINDS = Object.freeze(['news', 'research']);
// Changes closer than this are one visual event (kit/core/cadence.mjs merges the same way).
const EVENT_MERGE_SECONDS = 0.25;

const HEDGES = /\b(?:can help|may help|might help|could help|may need|might need|may want to|might want to|may be (?:worth|able)|might be(?: worth)?|could be|can sometimes|may sometimes|could potentially|potentially|possibly|perhaps|arguably|in some cases|it depends|to some extent|somewhat|kind of|sort of|more or less|it seems|seems to|appears to|reportedly|is said to|it remains to be seen|time will tell|only time)\b/gi;
// The narration talking about the video instead of the subject.
const META = /\b(?:(?:one|two|three|four|five|first|second|third|fourth|fifth|last|next|final) of (?:the |our |today's )?(?:two|three|four|five|six|seven|eight|nine|ten|\d+) (?:stories|items|things|points|topics|updates|headlines)|(?:story|item|number|point|topic) (?:number )?(?:one|two|three|four|five|six|\d+)\b|in (?:this|today's) (?:video|episode|roundup|round-up)|(?:this|today's) (?:video|episode) (?:is|will|covers|looks)|let'?s (?:dive|jump|get) (?:in|into|started)|moving on|next up|up next|as (?:i|we) (?:said|mentioned)|as mentioned|before we (?:start|begin|get)|without further ado|stay tuned|(?:our|the) (?:next|final|last|first|second|third|fourth) (?:story|item|topic|headline)|that'?s (?:it|all) for (?:this|today))/gi;
const STOP = new Set('a an and are as at be but by for from has have he her his i in is it its of on or our she so that the their them they this to was we were what when which who will with you your'.split(' '));

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const round = (value, places = 3) => (finite(value) ? Math.round(value * 10 ** places) / 10 ** places : null);

/** The cadence format a story is judged against when none is named: long form past 3 minutes, short form in portrait, else motion graphics. */
export function inferFormat(resolved) {
  const { width, height } = resolved?.format ?? {};
  const duration = storyDuration(resolved);
  if (duration > 180) return 'long-form';
  return height > width ? 'short-form' : 'motion-graphics';
}

function storyDuration(resolved) {
  const end = (resolved?.scenes ?? []).reduce((max, scene) => Math.max(max, Number(scene?.end) || 0), 0);
  return Number(resolved?.resolved?.duration) || Number(resolved?.format?.duration) || end;
}

// What a card says: the strings in its params, lower-cased. Two cards in a row with the same words are a repeat.
function cardText(scene) {
  const out = [];
  const visit = (value) => {
    if (typeof value === 'string') out.push(value.trim().toLowerCase());
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(scene?.params);
  return out.filter(Boolean).join(' | ');
}

/**
 * A resolved story (scene start and end in seconds) → module variety, the
 * typography share, cuts and visual events a minute against the cadence
 * profile, and held or repeated cards.
 */
export function storyMetrics(resolved, { format = null, words = null } = {}) {
  const duration = storyDuration(resolved);
  if (!(duration > 0)) throw new Error('the storyboard has no duration and no timed scenes');
  const minutes = duration / 60;
  const scenes = (resolved?.scenes ?? []).filter((scene) => scene?.module && finite(Number(scene.start))).sort((a, b) => Number(a.start) - Number(b.start));
  const base = scenes.filter((scene) => (scene.track ?? 0) === 0);
  const modules = [...new Set(scenes.map((scene) => scene.module))].sort();
  const typography = scenes.filter((scene) => TYPOGRAPHY_MODULES.includes(scene.module)).length;
  // A cut: a new base-track scene. A visual event: any scene arriving, on any track, or a state inside a scene.
  const cuts = base.slice(1).map((scene) => Number(scene.start));
  const events = mergeEvents([
    ...scenes.map((scene) => Number(scene.start)),
    ...scenes.flatMap((scene) => (Array.isArray(scene.states) ? scene.states : []).map((state) => Number(state?.at)))
  ].filter((t) => finite(t) && t > 0 && t < duration), EVENT_MERGE_SECONDS);
  const name = format ?? inferFormat(resolved);
  const target = cadenceTarget(name);
  const stats = eventStats(events, { duration, cuts, ...(finite(words) ? { words } : {}) });
  const gate = cadenceGate(stats, target);
  // Held: a base card on screen past the profile's longest static run with no state of its own.
  const held = base.filter((scene) => Number(scene.end) - Number(scene.start) > target.longest_static && !(scene.states?.length)).map((scene) => scene.id);
  // Repeated: a base card with the module and the words of the card before it. A run: the same module several cards in a row.
  const repeated = [];
  let run = base.length ? 1 : 0;
  let longestRun = run;
  for (let i = 1; i < base.length; i += 1) {
    const same = base[i].module === base[i - 1].module;
    if (same && cardText(base[i]) === cardText(base[i - 1])) repeated.push(base[i].id);
    run = same ? run + 1 : 1;
    longestRun = Math.max(longestRun, run);
  }
  return {
    duration_seconds: round(duration, 1),
    scenes: scenes.length,
    modules: { distinct: modules.length, per_min: round(modules.length / minutes, 2), ids: modules },
    typography: { scenes: typography, share: scenes.length ? round(typography / scenes.length) : 0 },
    cadence: {
      format: name,
      cuts_per_min: round(cuts.length / minutes, 2),
      events_per_min: stats.per_min,
      target_per_min: target.per_min,
      longest_static_seconds: stats.longest_static.seconds,
      ok: gate.ok,
      failed: gate.checks.filter((check) => !check.ok).map((check) => check.id)
    },
    cards: { held: held.length, repeated: repeated.length, longest_same_module_run: longestRun, held_ids: held, repeated_ids: repeated }
  };
}

/** qa/critic.json → the verdict and its blocking and major findings. A project with no critique scores null. */
export function criticMetrics(critique) {
  if (!critique || typeof critique !== 'object') return { verdict: null, blocking: null, major: null, findings: null, blocking_findings: [] };
  const findings = Array.isArray(critique.findings) ? critique.findings : [];
  const blocking = findings.filter((finding) => finding?.severity === 'blocking');
  return {
    verdict: critique.verdict ?? null,
    blocking: blocking.length,
    major: findings.filter((finding) => finding?.severity === 'major').length,
    findings: findings.length,
    blocking_findings: blocking.map((finding) => String(finding.message ?? '').trim())
  };
}

function sentences(text) {
  return String(text ?? '').replace(/(\d)\.(\d)/g, '$1·$2').split(/(?<=[.!?…])\s+/).map((sentence) => sentence.replace(/·/g, '.').trim()).filter(Boolean);
}

// The figures a sentence states: "$4.5 billion", "40 percent", "2026" → normalised keys.
function figures(sentence) {
  const out = new Set();
  for (const match of sentence.matchAll(/[$€£]?\d[\d,]*(?:\.\d+)?\s?(?:%|percent|per cent|x|times|thousand|million|billion|trillion|k|m|bn)?/gi)) {
    const key = match[0].toLowerCase().replace(/[\s,]/g, '').replace(/percent/g, '%');
    // A bare one- or two-digit count ("3 steps") is too common to be a fact on its own.
    if (/^\d{1,2}$/.test(key)) continue;
    out.add(key);
  }
  return out;
}

function contentWords(sentence) {
  return new Set(sentence.toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter((word) => word.length > 2 && !STOP.has(word)));
}

/**
 * The narration → hedging phrases, meta-narration and repeated facts (a
 * figure stated in more than one sentence, or a sentence that says what an
 * earlier one said). Rates are per 100 words, so a short and a long script compare.
 */
export function scriptMetrics(narration) {
  const text = String(narration ?? '').trim();
  const words = text ? text.split(/\s+/).length : 0;
  const per100 = (count) => (words ? round(count / words * 100, 2) : null);
  const hedges = [...text.matchAll(HEDGES)].map((match) => match[0].toLowerCase());
  const meta = [...text.matchAll(META)].map((match) => match[0].toLowerCase());
  const list = sentences(text);
  const seen = new Map();
  const repeats = [];
  for (const [index, sentence] of list.entries()) {
    for (const figure of figures(sentence)) {
      if (seen.has(figure) && seen.get(figure) !== index) repeats.push({ kind: 'figure', fact: figure, sentence: index + 1, first: seen.get(figure) + 1 });
      else seen.set(figure, index);
    }
    const bag = contentWords(sentence);
    if (bag.size < 4) continue;
    for (let earlier = 0; earlier < index; earlier += 1) {
      const other = contentWords(list[earlier]);
      if (other.size < 4) continue;
      const shared = [...bag].filter((word) => other.has(word)).length;
      if (shared / (bag.size + other.size - shared) >= 0.7) { repeats.push({ kind: 'sentence', fact: sentence.slice(0, 80), sentence: index + 1, first: earlier + 1 }); break; }
    }
  }
  return {
    words,
    sentences: list.length,
    hedging: { count: hedges.length, per_100_words: per100(hedges.length), phrases: [...new Set(hedges)] },
    meta_narration: { count: meta.length, per_100_words: per100(meta.length), phrases: [...new Set(meta)] },
    repeated_facts: { count: repeats.length, per_100_words: per100(repeats.length), facts: repeats }
  };
}

/** One project's metrics. story: resolved; critique: qa/critic.json or null; narration: its spoken text. */
export function projectMetrics({ story, critique = null, narration = '', format = null } = {}) {
  const script = scriptMetrics(narration);
  return { schema_version: PARITY_SCHEMA, story: storyMetrics(story, { format, words: script.words || null }), critic: criticMetrics(critique), script };
}

// Each compared metric: where it lives, and which way is better ("up", "down", or "near": close to the skill's either way).
const ROWS = Object.freeze([
  { id: 'modules_per_min', label: 'distinct modules per minute', better: 'up', read: (m) => m.story.modules.per_min },
  { id: 'typography_share', label: 'typography share', better: 'down', read: (m) => m.story.typography.share },
  { id: 'cuts_per_min', label: 'cuts per minute', better: 'near', read: (m) => m.story.cadence.cuts_per_min },
  { id: 'events_per_min', label: 'visual events per minute', better: 'near', read: (m) => m.story.cadence.events_per_min },
  { id: 'held_cards', label: 'held cards', better: 'down', read: (m) => m.story.cards.held },
  { id: 'repeated_cards', label: 'repeated cards in a row', better: 'down', read: (m) => m.story.cards.repeated },
  { id: 'critic_blocking', label: 'critic blocking findings', better: 'down', read: (m) => m.critic.blocking },
  { id: 'critic_major', label: 'critic major findings', better: 'down', read: (m) => m.critic.major },
  { id: 'hedging', label: 'hedging per 100 words', better: 'down', read: (m) => m.script.hedging.per_100_words },
  { id: 'meta_narration', label: 'meta-narration per 100 words', better: 'down', read: (m) => m.script.meta_narration.per_100_words },
  { id: 'repeated_facts', label: 'repeated facts per 100 words', better: 'down', read: (m) => m.script.repeated_facts.per_100_words }
]);

/**
 * make's metrics against the skill's on the same brief. A metric passes when
 * it is within PARITY_TOLERANCE of the skill's, or on the better side of it
 * (fewer hedges than the skill is not a miss). A metric either project
 * cannot answer (no critique, no script) is "n/a" and does not count. kind:
 * "news" or "research" adds the typography ceiling.
 * → {rows: [{id, label, make, skill, delta, ok}], cadence, critic, typography, parity}
 */
export function compareProjects(make, skill, { kind = null, tolerance = PARITY_TOLERANCE } = {}) {
  const rows = ROWS.map((row) => {
    const a = row.read(make);
    const b = row.read(skill);
    if (!finite(a) || !finite(b)) return { id: row.id, label: row.label, make: a ?? null, skill: b ?? null, delta: null, ok: null };
    const delta = b === 0 ? (a === 0 ? 0 : null) : round((a - b) / Math.abs(b));
    const within = b === 0 ? a === 0 : Math.abs(a - b) <= tolerance * Math.abs(b) + 1e-9;
    const better = row.better === 'up' ? a >= b : row.better === 'down' ? a <= b : false;
    return { id: row.id, label: row.label, make: a, skill: b, delta, ok: within || better };
  });
  const verdicts = { make: make.critic.verdict, skill: skill.critic.verdict };
  // The critic row: make must ship wherever the skill's cut ships.
  const critic = { ...verdicts, ok: verdicts.make && verdicts.skill ? !(verdicts.skill === 'ship' && verdicts.make !== 'ship') : null };
  const cadence = { format: make.story.cadence.format, make: make.story.cadence.ok, skill: skill.story.cadence.ok, ok: make.story.cadence.ok || !skill.story.cadence.ok, failed: make.story.cadence.failed };
  const limited = TYPOGRAPHY_LIMITED_KINDS.includes(kind);
  const typography = { kind, limit: limited ? TYPOGRAPHY_LIMIT : null, share: make.story.typography.share, ok: limited ? make.story.typography.share <= TYPOGRAPHY_LIMIT : null };
  const checks = [...rows.map((row) => row.ok), critic.ok, cadence.ok, typography.ok];
  const misses = [...rows.filter((row) => row.ok === false).map((row) => row.id), ...(critic.ok === false ? ['critic_verdict'] : []), ...(cadence.ok === false ? ['cadence_profile'] : []), ...(typography.ok === false ? ['typography_limit'] : [])];
  return { schema_version: PARITY_SCHEMA, tolerance, rows, critic, cadence, typography, unanswered: checks.filter((ok) => ok === null).length, misses, parity: misses.length === 0 };
}

const cell = (value) => (value === null || value === undefined ? 'n/a' : typeof value === 'number' ? String(value) : String(value));

/** The comparison as a plain-text table, one line per metric. */
export function formatComparison(comparison, { make = 'make', skill = 'skill' } = {}) {
  const mark = (ok) => (ok === null ? 'n/a ' : ok ? 'ok  ' : 'MISS');
  const lines = [`make-vs-skill parity: ${comparison.parity ? 'AT PARITY' : `NOT AT PARITY (${comparison.misses.join(', ')})`}`, `  make:  ${make}`, `  skill: ${skill}`, '', `  ${'metric'.padEnd(34)} ${'make'.padStart(8)} ${'skill'.padStart(8)} ${'delta'.padStart(8)}`];
  for (const row of comparison.rows) lines.push(`  ${mark(row.ok)} ${row.label.padEnd(29)} ${cell(row.make).padStart(8)} ${cell(row.skill).padStart(8)} ${(row.delta === null ? 'n/a' : `${row.delta > 0 ? '+' : ''}${Math.round(row.delta * 100)}%`).padStart(8)}`);
  lines.push(`  ${mark(comparison.critic.ok)} ${'critic verdict'.padEnd(29)} ${cell(comparison.critic.make).padStart(8)} ${cell(comparison.critic.skill).padStart(8)}`);
  lines.push(`  ${mark(comparison.cadence.ok)} ${`cadence profile (${comparison.cadence.format})`.padEnd(29)} ${(comparison.cadence.make ? 'passed' : 'failed').padStart(8)} ${(comparison.cadence.skill ? 'passed' : 'failed').padStart(8)}${comparison.cadence.failed.length ? `   make misses ${comparison.cadence.failed.join(', ')}` : ''}`);
  if (comparison.typography.limit !== null) lines.push(`  ${mark(comparison.typography.ok)} ${`typography ≤ ${Math.round(comparison.typography.limit * 100)}% (${comparison.typography.kind})`.padEnd(29)} ${cell(comparison.typography.share).padStart(8)}`);
  lines.push('', `  A metric passes within ${Math.round(comparison.tolerance * 100)}% of the skill's, or on the better side of it.${comparison.unanswered ? ` ${comparison.unanswered} could not be answered (a project has no critique or no script).` : ''}`);
  return `${lines.join('\n')}\n`;
}
