// Verification: each claim against every fetched snapshot. A source supports
// a claim only when its text holds the claim's anchors (every number, the
// date, the quote verbatim, the named entities) inside one passage, and that
// passage becomes the quote span the capture highlights. A primary source
// stating a different number for the same thing contradicts the claim.
// Nothing here guesses: a claim with no supporting passage stays unverified
// and carries a flag for the script.
import { LEDGER_SCHEMA } from "./schema.js";
import { numericValue } from "./claims.js";

const WINDOW = 320;
const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "at", "for", "with", "by", "is", "are", "was", "were", "be", "it", "its", "this", "that", "as", "from", "has", "have", "had", "just", "now", "than", "more", "most", "up", "out", "into", "over", "about", "which", "who", "what", "their", "they", "them", "we", "our", "you", "your", "can", "will", "new"]);

/** → {status, confidence, sources[], flag?} for one claim. */
export function verifyClaim(claim, snapshots) {
  const sources = [];
  for (const snapshot of snapshots) {
    const result = matchSnapshot(claim, snapshot);
    if (!result) continue;
    sources.push({
      url: snapshot.url,
      title: snapshot.title ?? snapshot.url,
      publisher: snapshot.publisher ?? null,
      published_at: snapshot.published_at ?? null,
      fetched_at: snapshot.fetched_at,
      sha256: snapshot.sha256 ?? null,
      kind: snapshot.kind ?? "page",
      primary: Boolean(snapshot.primary),
      finder: snapshot.finder ?? null,
      supports: result.supports,
      confidence: round2(result.score * (snapshot.primary ? 1 : 0.75)),
      quote: result.quote,
      ...(result.conflict ? { conflict: result.conflict } : {})
    });
  }
  sources.sort((a, b) => Number(b.supports) - Number(a.supports) || Number(b.primary) - Number(a.primary) || b.confidence - a.confidence);
  const support = sources.filter((source) => source.supports && source.confidence >= 0.5);
  const conflicts = sources.filter((source) => !source.supports && source.primary && source.conflict);
  if (support.length) {
    const best = Math.min(0.99, support[0].confidence + 0.05 * (support.length - 1));
    return { status: "verified", confidence: round2(best), primary_support: support.some((source) => source.primary), sources: sources.slice(0, 6) };
  }
  if (conflicts.length) {
    const conflict = conflicts[0].conflict;
    return { status: "contradicted", confidence: round2(conflicts[0].confidence), sources: sources.slice(0, 6), flag: { action: "fix", message: `${conflicts[0].publisher ?? conflicts[0].url} says ${conflict.found} where the script says ${conflict.claimed}` } };
  }
  return { status: "unverified", confidence: 0, sources: sources.slice(0, 6), flag: { action: claim.kind === "quote" ? "cut" : "soften-or-cite", message: unverifiedMessage(claim, snapshots.length) } };
}

/** claims + snapshots → the ledger. */
export function buildLedger({ claims, snapshots, input, entities, now, search, notes = [] }) {
  const ledgerClaims = claims.map((claim) => {
    const verdict = verifyClaim(claim, snapshots);
    return {
      id: claim.id,
      text: claim.text,
      kind: claim.kind,
      section: claim.section ?? null,
      values: claim.values ?? [],
      dates: claim.dates ?? [],
      quote: claim.quote ?? null,
      entities: claim.entities ?? [],
      origin: claim.origin ?? "pattern",
      ...verdict
    };
  });
  const counts = Object.fromEntries(["verified", "contradicted", "unverified"].map((status) => [status, ledgerClaims.filter((claim) => claim.status === status).length]));
  return {
    schema: LEDGER_SCHEMA,
    created_at: now,
    input,
    summary: { claims: ledgerClaims.length, ...counts, sources_checked: snapshots.length, primary_sources: snapshots.filter((snapshot) => snapshot.primary).length, web_search: search ?? null },
    policy: {
      verified: "a fetched source holds every number, date, quote and named entity of the claim in one passage; that passage is the quote span",
      contradicted: "a primary source states a different value for the same measure and no source supports the claim",
      unverified: "flagged for the script: cut it, soften it, or add a source; never kept silently",
      remote_content_is_untrusted: true
    },
    entities,
    claims: ledgerClaims,
    notes
  };
}

// ---------------------------------------------------------------------------

/** One snapshot against one claim → {supports, score, quote, conflict?} or null when unrelated. */
export function matchSnapshot(claim, snapshot) {
  const text = String(snapshot.text ?? "");
  if (!text) return null;
  const lower = text.toLowerCase();
  // A quote is checked verbatim (case, punctuation and spacing aside).
  if (claim.quote) {
    const span = findLoose(text, claim.quote);
    if (span) return { supports: true, score: 0.95, quote: span };
    return null;
  }
  const values = claim.values ?? [];
  const keywords = keywordsFor(claim);
  const entityNames = (claim.entities ?? []).filter((entity) => entity.kind !== "url").map((entity) => entity.name);
  const passages = passagesOf(text);
  let best = null;
  let mismatch = null;
  for (const passage of passages) {
    if (passage.isHeader) continue;
    const passageLower = passage.text.toLowerCase();
    const numbersFound = values.filter((value) => numberAppears(passage.text, value));
    const datesFound = (claim.dates ?? []).filter((date) => dateAppears(passage.text, date, snapshot));
    const keywordHits = keywords.filter((word) => passageLower.includes(word));
    const keywordShare = keywords.length ? keywordHits.length / keywords.length : 0;
    const entitiesHere = entityNames.filter((name) => looseIncludes(passageLower, name));
    // In a table the model is the column, not the row: the number must sit in the column headed by the claim's model.
    let cell = null;
    if (passage.row && numbersFound.length) {
      cell = tableCell(passage, numbersFound[0], entityNames);
      if (cell?.mismatch) {
        // The row is the claim's measure but the number is another model's: the claim's own column is the conflict.
        if (keywordShare >= 0.25 && !mismatch) mismatch = { passage, cell };
        continue;
      }
      if (cell?.header) entitiesHere.push(cell.header);
    }
    const anchors = values.length + (claim.dates?.length ?? 0);
    const anchorsFound = numbersFound.length + datesFound.length;
    let score = 0;
    if (anchors) {
      if (anchorsFound < anchors) continue;
      // Numbers in a passage that shares none of the claim's words are coincidences (a "3" anywhere).
      if (keywordShare < 0.25 && !entitiesHere.length) continue;
      // A date written in the passage beats one taken from the page's publish date.
      const literalDates = (claim.dates ?? []).filter((date) => dateAppears(passage.text, date)).length;
      score = 0.55 + 0.25 * Math.min(1, keywordShare * 2) + (entitiesHere.length ? 0.1 : 0) + 0.05 * (claim.dates?.length ? literalDates / claim.dates.length : 1);
    } else {
      // No number or date: the named entities and most of the claim's words share a passage.
      if (!entityNames.length || entitiesHere.length < Math.min(entityNames.length, 2) || keywordShare < 0.6) continue;
      score = 0.5 + 0.35 * keywordShare;
    }
    if (!best || score > best.score) best = { supports: true, score: Math.min(0.95, score), quote: { text: passage.text, start: passage.start, end: passage.end, ...(cell ? { row: { label: cell.label, cell: cell.text, column: cell.header ?? null } } : {}) } };
  }
  if (best) return best;
  if (mismatch?.cell.expected) {
    const { passage, cell } = mismatch;
    return { supports: false, score: 0.7, quote: { text: passage.text, start: passage.start, end: passage.end, row: { label: cell.label, cell: cell.expected.text, column: cell.expected.header } }, conflict: { claimed: values.map((value) => value.raw).join(", "), found: `${cell.expected.text} (${cell.expected.header}; ${cell.text} is ${cell.header})` } };
  }
  // Conflict: a passage about the same measure (claim words plus the unit) with a different number.
  for (const value of values.filter((entry) => entry.unit)) {
    for (const passage of passages) {
      const passageLower = passage.text.toLowerCase();
      const keywordHits = keywords.filter((word) => passageLower.includes(word));
      if (!passageLower.includes(value.unit) || keywordHits.length < Math.max(2, Math.ceil(keywords.length * 0.5))) continue;
      const other = numbersIn(passage.text).find((found) => found.unit === value.unit && found.value !== value.value && sameMagnitude(found.value, value.value));
      if (other) return { supports: false, score: 0.6, quote: { text: passage.text, start: passage.start, end: passage.end }, conflict: { claimed: value.raw, found: other.raw } };
    }
  }
  return null;
}

/** Sentences and table rows, each with its character offsets in the snapshot. */
export function passagesOf(text) {
  const passages = [];
  let offset = 0;
  let header = null;
  for (const line of String(text).split("\n")) {
    const start = offset;
    offset += line.length + 1;
    const trimmed = line.trim();
    if (!trimmed) continue;
    // A table row is one passage, with its header row's words joined in for context.
    if (/^\|.*\|$/.test(trimmed) || (trimmed.match(/\|/g) ?? []).length >= 2) {
      // The row above a |---| separator is the header for the rows below it.
      if (/^\|?\s*:?-{2,}/.test(trimmed)) {
        const previous = passages.at(-1);
        if (previous?.row) { previous.isHeader = true; header = previous.cells; }
        continue;
      }
      const cells = splitRow(trimmed);
      passages.push({ text: trimmed.slice(0, WINDOW * 2), start: start + line.indexOf(trimmed), end: start + line.indexOf(trimmed) + trimmed.length, row: true, cells, header });
      continue;
    }
    header = null;
    const pieces = trimmed.split(/(?<=[.!?])\s+(?=[A-Z0-9"“*(])/);
    let cursor = start + line.indexOf(trimmed);
    for (const piece of pieces) {
      const at = text.indexOf(piece, cursor);
      const begin = at >= 0 ? at : cursor;
      passages.push({ text: piece.slice(0, WINDOW * 2), start: begin, end: begin + piece.length });
      cursor = begin + piece.length;
    }
  }
  return passages;
}

export function splitRow(row) {
  return row.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

/**
 * The cell of a table row holding the number → {label, text, header} when its
 * column is the claim's model (or the table has no model columns), or
 * {mismatch, expected} when the number sits under another model's column.
 */
export function tableCell(passage, value, entityNames) {
  const cells = passage.cells ?? [];
  const index = cells.findIndex((cell, at) => at > 0 && numberAppears(cell, value));
  if (index < 0) return null;
  const label = cells[0];
  const header = passage.header?.[index] ?? null;
  if (!passage.header || !entityNames.length) return { label, text: cells[index], header };
  const tokens = (name) => String(name).toLowerCase().split(/[\s_/-]+/).filter(Boolean);
  const similarity = (a, b) => {
    const left = new Set(tokens(a));
    const right = new Set(tokens(b));
    const shared = [...left].filter((token) => right.has(token)).length;
    return shared / Math.max(1, new Set([...left, ...right]).size);
  };
  const scores = passage.header.map((cell, at) => at === 0 ? 0 : Math.max(0, ...entityNames.map((name) => similarity(cell, name))));
  const bestScore = Math.max(...scores);
  // No header names a claim entity: the table compares something else (benchmarks as columns), so any column counts.
  if (bestScore < 0.34) return { label, text: cells[index], header };
  if (scores[index] === bestScore) return { label, text: cells[index], header };
  const expectedAt = scores.indexOf(bestScore);
  return { mismatch: true, label, text: cells[index], header, expected: cells[expectedAt] ? { text: cells[expectedAt], header: passage.header[expectedAt] } : null };
}

/** "284B" in a claim matches 284B, 284 B, 284 billion, 284,000,000,000, 284000000000 in the source. */
export function numberAppears(text, value) {
  return numbersIn(text).some((found) => Math.abs(found.value - value.value) <= Math.abs(value.value) * 1e-9 + (value.unit === "percent" ? 0.001 : 0));
}

export function numbersIn(text) {
  const out = [];
  const pattern = /(?<![\w.])(\$|€|£)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(%|percent|x\b|×|[kKmMbBtT]\b|thousand|million|billion|trillion)?(?:\s?(parameters?|params|tokens?|context|experts?|layers|GPUs?|hours?|days?|languages?|points?|seconds?|minutes?))?/g;
  for (const match of String(text).matchAll(pattern)) {
    const [raw, currency, digits, scale, unit] = match;
    const prior = text[match.index - 1];
    if (prior && /[A-Za-z-]/.test(prior)) continue;
    const isScaleWord = scale && !/^(?:%|percent|x|×)$/i.test(scale);
    out.push({
      raw: raw.trim(),
      value: numericValue(digits, isScaleWord ? scale : null),
      unit: currency ? { "$": "usd", "€": "eur", "£": "gbp" }[currency] : scale && /^(?:%|percent)$/i.test(scale) ? "percent" : scale && /^(?:x|×)$/i.test(scale) ? "multiple" : unit ? unit.toLowerCase().replace(/s$/, "") : null
    });
  }
  return out;
}

export function dateAppears(text, date, snapshot = {}) {
  const target = parseLooseDate(date);
  if (!target) return false;
  // The source's own publish date counts when the claim is about when it was released.
  if (snapshot.published_at && sameDay(snapshot.published_at, target)) return true;
  if (target.precision === "year") return new RegExp(`\\b${target.year}\\b`).test(text);
  for (const match of String(text).matchAll(/\b\d{4}-\d{2}-\d{2}(?=\b|T)|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b|\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?,?\s+\d{4}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}\b/g)) {
    const found = parseLooseDate(match[0]);
    if (!found) continue;
    if (target.precision === "month" ? found.year === target.year && found.month === target.month : found.year === target.year && found.month === target.month && found.day === target.day) return true;
  }
  return false;
}

export function parseLooseDate(value) {
  const text = String(value).trim();
  if (/^(?:19|20)\d{2}$/.test(text)) return { year: Number(text), precision: "year" };
  const monthOnly = text.match(/^([A-Za-z]+)\.?\s+(\d{4})$/);
  if (monthOnly) {
    const month = new Date(`${monthOnly[1].slice(0, 3)} 1, 2000`).getMonth();
    return Number.isNaN(month) ? null : { year: Number(monthOnly[2]), month, precision: "month" };
  }
  const time = Date.parse(text.replace(/(\d)(st|nd|rd|th)/, "$1"));
  if (!Number.isFinite(time)) return null;
  const date = /^\d{4}-\d{2}-\d{2}/.test(text) ? new Date(`${text.slice(0, 10)}T00:00:00Z`) : new Date(time);
  const utc = /^\d{4}-\d{2}-\d{2}/.test(text);
  return { year: utc ? date.getUTCFullYear() : date.getFullYear(), month: utc ? date.getUTCMonth() : date.getMonth(), day: utc ? date.getUTCDate() : date.getDate(), precision: "day" };
}

function sameDay(iso, target) {
  if (target.precision === "year") return Number(String(iso).slice(0, 4)) === target.year;
  const date = new Date(iso);
  if (target.precision === "month") return date.getUTCFullYear() === target.year && date.getUTCMonth() === target.month;
  return date.getUTCFullYear() === target.year && date.getUTCMonth() === target.month && date.getUTCDate() === target.day;
}

/** The claim's content words (not stop words, not the numbers), for passage matching. */
export function keywordsFor(claim) {
  const words = String(claim.text).toLowerCase().replace(/https?:\/\/\S+/g, " ").match(/[a-z][a-z0-9.+-]{2,}/g) ?? [];
  return [...new Set(words.map((word) => word.replace(/[.]+$/, "")).filter((word) => !STOP.has(word) && word.length >= 3))].slice(0, 14);
}

function findLoose(text, quote) {
  const norm = (value) => value.toLowerCase().replace(/[“”"‘’'`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const needle = norm(quote);
  if (needle.length < 8) return null;
  for (const passage of passagesOf(text)) {
    if (norm(passage.text).includes(needle)) return { text: passage.text, start: passage.start, end: passage.end };
  }
  // A quote can span sentences: fall back to a window over the whole text.
  const flat = norm(text);
  return flat.includes(needle) ? { text: quote, start: null, end: null } : null;
}

function looseIncludes(haystackLower, name) {
  const needle = String(name).toLowerCase();
  if (haystackLower.includes(needle)) return true;
  // DeepSeek-V4.1-Flash also matches "DeepSeek V4.1 Flash" and "DS-V4.1-Flash" style columns lose; spacing variants win.
  return haystackLower.replace(/[\s_-]+/g, "").includes(needle.replace(/[\s_-]+/g, ""));
}

function sameMagnitude(a, b) {
  return a > 0 && b > 0 && Math.max(a, b) / Math.min(a, b) < 20;
}

function unverifiedMessage(claim, checked) {
  if (!checked) return "no sources could be fetched; check it by hand or cut it";
  if (claim.kind === "quote") return "the quote was not found verbatim in any fetched source; cut it or link the original";
  if (claim.values?.length) return `no fetched source states ${claim.values.map((value) => value.raw).join(", ")} in context; soften it, or add the source with --url`;
  return "no fetched source states this; soften it, or add the source with --url";
}

function round2(value) {
  return Math.round(value * 100) / 100;
}
