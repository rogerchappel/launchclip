// Beat-director params builders: Code evidence (catalog-i-code.mjs).
//
// The director picks a capability for a clause and asks for its params
// (capabilityParams in visual-capabilities.mjs). A builder maps the beat to
// the module's own params contract (skills-src/references/storyboard-modules.md),
// or returns null when the beat cannot fill the module honestly; the director
// then walks the capability's fallback chain. A module with no builder here is
// `planned` (isPlanned) and always falls back.
//
// Modules: repo-pr-card, commit-card, diff-view, evidence-chain, date-pinned-timeline, terminal-session.
//
// A beat is {id, text, headline, label?, sub?, kicker?, brand?, start?, end?,
// facts: {numbers, items, dates, quote, sides, places}, evidence?: {claim,
// status, source, quote?, capture?: {id, kind, out}, data?}}. evidence.data is
// the module-ready data the research and capture stages attach to a claim or
// capture:
//   pr | commit | diff: what src/evidence/github.js maps ({module, params}, or the params alone)
//   chain: {sources: [{module, params, token?} | a source {kind, …}], token?}
//   timeline: {cards: [{date, label?, module, params} | {date, label?, kind, …}], from?, to?}
//   terminal: {steps: [{cmd, output?}], title?, prompt?, timer?}
// Evidence modules must never invent content: no evidence.data, no params.
// What a builder adds is only clause-specific: the token the clause names gets
// the highlight, timed (highlightAt) to where the clause says it, and a diff's
// focus rows go to that token's row.
//
// h: the shared helpers from visual-capabilities.mjs (clip, keyTerms,
// numbersOf, itemsOf, percentOf, seriesOf, sidesOf, timelineSteps, quoteOf,
// excerptLines, formatValue, sourceOf, iconFor, round).
//
// Pure ESM, no imports. Canonical copy: kit/core/capability-builders-code.mjs.

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const MODULE_KIND = { 'repo-pr-card': 'pr', 'commit-card': 'commit' };
// Fields a compact source (evidence-chain, date-pinned-timeline) takes, per kind.
const SOURCE_FIELDS = {
  pr: ['repo', 'number', 'state', 'author', 'date', 'file', 'additions', 'deletions', 'lines', 'startLine', 'highlight'],
  commit: ['repo', 'sha', 'verified', 'authors', 'date', 'file', 'additions', 'deletions', 'lines', 'startLine', 'highlight'],
  excerpt: ['file', 'repo', 'sub', 'date', 'lines', 'startLine', 'highlight'],
  announcement: ['site', 'title', 'text', 'date', 'highlight']
};
const COMPACT_LINES = 4;
const AXIS_LINES = 2;

/** evidence.data as params: {module, params} when module is one of `accept`, else the object itself (a bare mapping). */
function unwrap(data, accept) {
  if (!isObject(data)) return null;
  if (isObject(data.params) && typeof data.module === 'string') return accept.includes(data.module) ? data.params : null;
  return data;
}

const lineText = (line) => (typeof line === 'string' ? line : isObject(line) ? String(line.text ?? '') : '');
// A diff line's code (its +/-/space prefix off); a hunk header is no code.
const codeOf = (line) => { const text = lineText(line); return /^@@ /.test(text) ? '' : typeof line === 'string' && /^[+\- ]/.test(text) ? text.slice(1) : text; };
// Identifier characters: a model id, a path, a flag (not quotes, =, :, @ or brackets).
const IDENT = /[\w.\-/]/;

/** Spoken words of the clause, in order, with their character offset (for timing). */
function spokenWords(text) {
  const out = [];
  for (const match of String(text ?? '').matchAll(/\S+/g)) {
    const word = match[0].replace(/^[^\w]+|[^\w]+$/g, '');
    if (word.length >= 3) out.push({ word, at: match.index });
  }
  return out;
}

/**
 * The token the clause names in `texts` (code lines or prose): a spoken word
 * found in them (case-insensitive), widened to the identifier it sits in
 * ("terra" → "gpt-6.1-terra"); else `fallback` when it is in them. → {token,
 * at: the word's character offset in the clause, or null} | null.
 */
function namedToken(beat, texts, fallback = null) {
  const hay = texts.filter(Boolean);
  const words = spokenWords(beat.text).sort((a, b) => b.word.length - a.word.length);
  // The data's own token, when the clause says any part of it ("terra" for gpt-6.1-terra).
  if (fallback && hay.some((text) => text.includes(fallback))) {
    const said = words.find(({ word }) => fallback.toLowerCase().includes(word.toLowerCase()));
    if (said) return { token: fallback, at: said.at };
  }
  for (const { word, at } of words) {
    for (const text of hay) {
      const i = text.toLowerCase().indexOf(word.toLowerCase());
      if (i < 0) continue;
      let a = i, b = i + word.length;
      while (a > 0 && IDENT.test(text[a - 1])) a -= 1;
      while (b < text.length && IDENT.test(text[b])) b += 1;
      const token = text.slice(a, b).replace(/^[.\-/]+|[.\-/]+$/g, '');
      // A common word ("model", "the") is not a token worth a box unless it is the whole identifier.
      if (token.length >= 3 && (token.length > word.length || /[\d._\-/]/.test(token))) return { token, at };
    }
  }
  if (fallback && hay.some((text) => text.includes(fallback))) return { token: fallback, at: null };
  return null;
}

/**
 * Seconds from the scene start at which the clause says the token, when the
 * beat has timing and that falls after the rows land (`earliest`) and before
 * the exit; else undefined (the module's own default).
 */
function spokenAt(beat, found, earliest, h) {
  if (!found || found.at === null || !Number.isFinite(beat.start) || !Number.isFinite(beat.end)) return undefined;
  const span = beat.end - beat.start;
  const t = h.round((found.at / Math.max(1, String(beat.text).length)) * span, 2);
  return t >= earliest && t <= span - 0.75 ? t : undefined;
}

// When a single card's rows have landed (catalog-i-code.mjs: build at 0.5 s, rows 0.35 s on, ≤ 0.8 s of stagger).
const rowsLanded = (count) => 0.5 + 0.35 + (count > 1 ? Math.min(0.09 * (count - 1), 0.8) : 0) + 0.32 + 0.05;

/** Keep `keep` lines round the token (else the first change), numbering from the window's first line. */
function trimLines(lines, startLine, token, keep) {
  if (!Array.isArray(lines) || lines.length <= keep) return { lines, startLine };
  const codes = lines.map(codeOf);
  let anchor = token ? lines.findIndex((line, i) => lineText(line)[0] === '+' && codes[i].includes(token)) : -1;
  if (anchor < 0 && token) anchor = codes.findIndex((code) => code.includes(token));
  if (anchor < 0) anchor = lines.findIndex((line) => /^[+-]/.test(lineText(line)));
  const from = Math.max(0, Math.min(Math.max(0, anchor) - Math.min(2, keep - 1), lines.length - keep));
  if (/^@@ /.test(lineText(lines[0])) && from > 0) return { lines: lines.slice(from, from + keep), startLine: undefined };
  let old = isObject(startLine) ? startLine.old ?? 1 : startLine ?? 1, neu = isObject(startLine) ? startLine.new ?? old : startLine ?? 1;
  for (const line of lines.slice(0, from)) { const t = lineText(line); if (t[0] !== '+') old += 1; if (t[0] !== '-') neu += 1; }
  return { lines: lines.slice(from, from + keep), startLine: isObject(startLine) || startLine === undefined ? { old, new: neu } : neu };
}

/** A card params object (repo-pr-card / commit-card / a source) → a compact source of `kind`, or null. */
function toSource(entry, kind, keep, token) {
  if (!SOURCE_FIELDS[kind]) return null;
  const out = { kind };
  for (const key of SOURCE_FIELDS[kind]) if (entry[key] !== undefined) out[key] = entry[key];
  if (kind === 'pr' && !(out.repo && out.number)) return null;
  if (kind === 'commit' && !(out.repo && out.sha)) return null;
  if (kind === 'excerpt' && !(out.file && Array.isArray(out.lines) && out.lines.length)) return null;
  if (kind === 'announcement') {
    if (!(out.site && out.title && out.text)) return null;
    if (token && out.text.includes(token)) out.highlight = token;
    return out.highlight && !out.text.includes(typeof out.highlight === 'string' ? out.highlight : out.highlight.token) ? null : out;
  }
  if (Array.isArray(out.lines)) {
    const trimmed = trimLines(out.lines, out.startLine, token, keep);
    out.lines = trimmed.lines;
    if (trimmed.startLine === undefined) delete out.startLine; else out.startLine = trimmed.startLine;
    if (token && out.lines.some((line) => codeOf(line).includes(token))) out.highlight = token;
    else if (out.highlight && !out.lines.some((line) => codeOf(line).includes(typeof out.highlight === 'string' ? out.highlight : out.highlight.token))) delete out.highlight;
  }
  return out;
}

/** One chain or timeline entry ({module, params} or a bare source with kind) → a compact source, or null. */
function entrySource(entry, keep, token) {
  if (!isObject(entry)) return null;
  if (isObject(entry.params)) {
    const kind = MODULE_KIND[entry.module] ?? (entry.module === 'source' ? entry.params.kind : null);
    return toSource({ ...entry.params, ...(entry.date ? { date: entry.date } : {}) }, kind, keep, entry.token ?? token);
  }
  return toSource(entry, entry.kind, keep, entry.token ?? token);
}

const hasToken = (source) => Boolean(source?.highlight);
const firstToken = (highlight) => (typeof highlight === 'string' ? highlight : Array.isArray(highlight) ? firstToken(highlight[0]) : highlight?.token ?? null);
const dayOf = (iso) => (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5) : null);
const isoOf = (day) => new Date(day * 864e5).toISOString().slice(0, 10);

// Sample beats for the resolve test: src/evidence/github.js mappings of real
// public changes (rogerchappel/launchclip PR #82, commit c3ec4a11, cached in
// test/fixtures/github), trimmed to the rows round their tokens.
const PR82 = { repo: 'rogerchappel/launchclip', number: 82, title: 'feat: support OpenRouter free repairs', state: 'merged', author: 'rogerchappel', date: '2026-07-16', file: 'src/model_provider.js', additions: 1, deletions: 1,
  lines: ['-      body.provider = { require_parameters: true, allow_fallbacks: false };', '+      body.provider = { require_parameters: true, allow_fallbacks: model === "openrouter/free" };'], startLine: { old: 87, new: 87 }, highlight: 'openrouter/free' };
const C3EC = { repo: 'rogerchappel/launchclip', sha: 'c3ec4a1198b8', verified: false, authors: ['rogerchappel', 'Claude Fable 5'], message: 'direct: default OpenAI model to gpt-5.5', date: '2026-06-13', file: 'src/director.js', additions: 4, deletions: 3,
  lines: ['-    // --model or OPENAI_MODEL.', '-    const model = flags.model || process.env.OPENAI_MODEL || "o4-mini";', '+    // fallback. Override via --model or OPENAI_MODEL.', '+    const model = flags.model || process.env.OPENAI_MODEL || "gpt-5.5";'], startLine: { old: 92, new: 93 }, highlight: 'gpt-5.5' };
const sample = (id, text, data) => ({ id, text, headline: 'The receipt', start: 0, end: 4, facts: { numbers: [], items: [], dates: [], places: [] }, evidence: { claim: id, status: 'verified', source: { url: 'https://github.com/rogerchappel/launchclip' }, data } });
const SAMPLES = [
  sample('code-pr', 'The free router lands in the provider code', { module: 'repo-pr-card', params: PR82 }),
  sample('code-commit', 'The default flips from o4-mini to gpt-5.5', { module: 'commit-card', params: C3EC }),
  sample('code-diff', 'One line swaps the default to gpt-5.5', { module: 'diff-view', params: { file: C3EC.file, lines: C3EC.lines, startLine: C3EC.startLine, additions: 4, deletions: 3, focus: [{ rows: [1, 3] }], highlight: 'gpt-5.5' } }),
  sample('code-chain', 'The same free router shows up again', { token: 'openrouter/free', sources: [{ module: 'repo-pr-card', params: PR82 }, { kind: 'excerpt', file: 'docs/guide/advanced.md', lines: ['  --repair-route openrouter:openrouter/free@none'], startLine: 334 }] }),
  sample('code-timeline', 'Free repairs arrive in mid July', { cards: [{ date: '2026-07-16', label: 'Free repairs', module: 'repo-pr-card', params: PR82 }] }),
  sample('code-terminal', 'git show on c3ec4a11 tells the story', { title: 'launchclip — zsh', steps: [{ cmd: 'git show --stat c3ec4a11 --format=%s', output: ['direct: default OpenAI model to gpt-5.5', ' src/director.js | 7 ++++---'] }] })
];

/**
 * → {builders: {[module]: (beat) => params | null}, additions: {[module]: (beat) => {key, items}},
 *    samples: [beat]}: samples are test beats carrying the evidence.data these
 *    builders need; test/visual_capabilities.test.js resolves every builder against
 *    them, so an evidence-only builder is checked without inventing data elsewhere.
 */
export function codeBuilders(h) {
  // A PR or commit card: the mapped params as they are, the clause's token boxed on its word.
  const card = (module, required) => (beat) => {
    const params = unwrap(beat.evidence?.data, [module]);
    if (!params || required.some((key) => params[key] === undefined) || !Array.isArray(params.lines) || !params.lines.length) return null;
    const out = { ...params };
    const found = namedToken(beat, params.lines.map(codeOf), firstToken(params.highlight));
    if (found) {
      out.highlight = found.token;
      const at = spokenAt(beat, found, rowsLanded(params.lines.length) + 0.1, h);
      if (at !== undefined) out.highlightAt = at; else delete out.highlightAt;
    }
    return out;
  };

  const builders = {
    'repo-pr-card': card('repo-pr-card', ['repo', 'number', 'title']),
    'commit-card': card('commit-card', ['repo', 'sha', 'message']),

    // A diff: diff-view params, or a PR's / commit's file excerpt. The focus
    // steps to the change, then to the row with the clause's token.
    'diff-view': (beat) => {
      const params = unwrap(beat.evidence?.data, ['diff-view', 'repo-pr-card', 'commit-card']);
      if (!params?.file || !Array.isArray(params.lines) || params.lines.length < 2) return null;
      const lines = params.lines.slice(0, 18);
      const codes = lines.map(codeOf);
      const out = { file: params.file, lines, ...(params.startLine !== undefined ? { startLine: params.startLine } : {}), ...(params.additions !== undefined ? { additions: params.additions, deletions: params.deletions ?? 0 } : {}) };
      const found = namedToken(beat, codes, firstToken(params.highlight));
      const tokenRow = found ? lines.findIndex((line, i) => lineText(line)[0] === '+' && codes[i].includes(found.token)) : -1;
      const row = tokenRow >= 0 ? tokenRow : found ? codes.findIndex((code) => code.includes(found.token)) : -1;
      const changed = lines.map((line, i) => (/^[+-]/.test(lineText(line)) ? i : -1)).filter((i) => i >= 0);
      const focus = [];
      if (changed.length) focus.push(changed.length > 1 && changed.at(-1) - changed[0] <= 5 ? { rows: [changed[0], changed.at(-1)] } : { row: changed[0] });
      if (row >= 0 && !(focus[0]?.row === row || (focus[0]?.rows?.[0] === row && focus[0].rows[1] === row))) focus.push({ row });
      out.focus = focus.length ? focus : Array.isArray(params.focus) && params.focus.length ? params.focus.slice(0, 6) : [{ row: 0 }];
      if (found) out.highlight = found.token;
      return out;
    },

    // The same token in 2–4 sources: each source keeps the rows round it.
    'evidence-chain': (beat) => {
      const data = beat.evidence?.data;
      if (!isObject(data) || !Array.isArray(data.sources)) return null;
      const texts = data.sources.flatMap((entry) => { const p = isObject(entry?.params) ? entry.params : entry; return isObject(p) ? [...(p.lines ?? []).map(codeOf), p.text ?? ''] : []; });
      const named = namedToken(beat, texts, data.token ?? null);
      const token = named?.token ?? data.token ?? null;
      // Three or four cards stack in a third of a 9:16 rect each: two rows round the token, else three.
      const keep = data.sources.length > 2 ? 2 : 3;
      const sources = data.sources.map((entry) => entrySource(entry, keep, token)).filter(hasToken).slice(0, 4);
      return sources.length >= 2 ? { ...(token ? { token } : {}), sources } : null;
    },

    // Dated sources on a day axis (or the "why now?" summary when the clause asks why now).
    'date-pinned-timeline': (beat) => {
      const data = beat.evidence?.data;
      const raw = Array.isArray(data?.cards) ? data.cards : null;
      if (!raw) return null;
      const summary = /\bwhy now\b|\bclues?\b/i.test(beat.text ?? '');
      const texts = raw.flatMap((entry) => { const p = isObject(entry?.params) ? entry.params : entry; return isObject(p) ? [...(p.lines ?? []).map(codeOf), p.text ?? ''] : []; });
      const token = namedToken(beat, texts, data.token ?? null)?.token ?? data.token ?? null;
      const cards = raw.map((entry) => {
        const source = entrySource(entry, summary ? COMPACT_LINES : AXIS_LINES, token);
        const date = entry?.date ?? source?.date;
        if (!source || dayOf(date) === null) return null;
        return { ...source, date, ...(entry.label ? { label: h.clip(entry.label, 32) } : {}) };
      }).filter(Boolean).sort((a, b) => dayOf(a.date) - dayOf(b.date)).slice(0, 4);
      if (!cards.length) return null;
      const first = dayOf(data.from) ?? dayOf(cards[0].date) - 1, last = dayOf(data.to) ?? dayOf(cards.at(-1).date) + 1;
      if (last - first < 1 || last - first > 45 || dayOf(cards[0].date) < first || dayOf(cards.at(-1).date) > last) return null;
      return { from: isoOf(first), to: isoOf(last), cards, ...(summary ? { variant: 'summary' } : {}) };
    },

    // A recorded session: its steps as they ran; the clause's token boxed in its command.
    'terminal-session': (beat) => {
      const data = beat.evidence?.data;
      if (!isObject(data) || !Array.isArray(data.steps) || !data.steps.length || !data.steps.every((step) => isObject(step) && typeof step.cmd === 'string' && step.cmd.trim())) return null;
      const steps = data.steps.slice(0, 8).map((step) => ({ cmd: step.cmd, ...(Array.isArray(step.output) && step.output.length ? { output: step.output.slice(0, 30) } : {}) }));
      const found = namedToken(beat, steps.map((step) => step.cmd), firstToken(data.highlight));
      return {
        ...(data.title ? { title: h.clip(data.title, 60) } : {}),
        ...(data.prompt ? { prompt: data.prompt } : {}),
        steps,
        ...(isObject(data.timer) && Number.isFinite(data.timer.to) ? { timer: data.timer } : {}),
        ...(found ? { highlight: found.token } : {})
      };
    }
  };
  return { builders, additions: {}, samples: SAMPLES };
}
