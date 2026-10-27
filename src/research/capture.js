// Capture requests (launchclip.capture.v1): one per source chosen to appear
// on screen, for src/evidence/ to record. The beats come from the quote span
// that verified the claim: scroll to it, ring the table row, highlight the
// exact figure or sentence, hold. Only verified claims put a source on screen.
import { CAPTURE_SCHEMA } from "./schema.js";
import { safeHost } from "./http.js";

export const CAPTURE_VIEWPORT = Object.freeze({ width: 1600, height: 1000 });
const MAX_BEATS_PER_CLAIM = 3;
const MAX_CLAIMS_PER_CAPTURE = 3;
// Short spans stay inside one element of the page; a long one crosses links and cells and is not found.
const MAX_SPAN_WORDS = 8;

/** ledger → {requests[], byClaim: {claimId: captureId}} */
export function buildCaptureRequests(ledger, options = {}) {
  const max = Number(options.maxCaptures ?? 12);
  const groups = new Map();
  for (const claim of ledger.claims) {
    if (claim.status !== "verified") continue;
    // Only a passage the page itself shows can be highlighted; API facts (sources.js) are checked, never captured.
    const visible = claim.sources.filter((entry) => entry.supports && entry.quote?.text && !isApiFact(entry.quote.text));
    const source = visible.find((entry) => entry.primary) ?? visible[0];
    if (!source) continue;
    // A source that backs many claims is shown more than once, a few claims per capture.
    const chunks = groups.get(source.url) ?? [];
    if (!chunks.length || chunks.at(-1).claims.length >= MAX_CLAIMS_PER_CAPTURE) chunks.push({ source, claims: [] });
    chunks.at(-1).claims.push({ claim, quote: source.quote });
    groups.set(source.url, chunks);
  }
  // Primary sources first, then those that carry the most claims.
  const ordered = [...groups.values()].flat().sort((a, b) => Number(b.source.primary) - Number(a.source.primary) || b.claims.length - a.claims.length).slice(0, max);
  const requests = [];
  const byClaim = {};
  const used = new Set();
  for (const { source, claims } of ordered) {
    let id = captureId(source.url);
    for (let n = 2; used.has(id); n += 1) id = `${captureId(source.url)}-${n}`;
    used.add(id);
    const beats = [{ at: 0, action: "wait", target: null, dur: 0.6, label: "page settles" }];
    let at = 0.6;
    for (const { claim, quote } of claims) {
      for (const beat of beatsFor(claim, quote).slice(0, MAX_BEATS_PER_CLAIM)) {
        beats.push({ at: round1(at), ...beat });
        at += beat.dur;
      }
      byClaim[claim.id] = id;
    }
    beats.push({ at: round1(at), action: "pin", target: null, dur: 1.2, label: source.publisher ?? safeHost(source.url) });
    requests.push({
      schema: CAPTURE_SCHEMA,
      id,
      url: source.url,
      kind: source.kind ?? "page",
      viewport: { ...CAPTURE_VIEWPORT },
      theme: options.theme ?? "dark",
      beats,
      out: `assets/evidence/${id}.mp4`,
      provenance: { source_title: source.title ?? source.url, fetched_at: source.fetched_at, publisher: source.publisher ?? safeHost(source.url), published_at: source.published_at ?? null }
    });
  }
  return { requests, byClaim };
}

export function isApiFact(text) {
  return /^(?:Hugging Face|GitHub) API:/.test(String(text).trim());
}

/** One claim's beats: scroll to the passage, ring the row (tables), highlight the figure or sentence. */
export function beatsFor(claim, quote) {
  const label = shortLabel(claim);
  if (quote.row) {
    const rowLabel = plain(quote.row.label);
    return [
      { action: "scroll", target: { text: rowLabel }, dur: 1.2, label: `to ${rowLabel}` },
      { action: "focus-ring", target: { text: rowLabel }, dur: 1.0, label: rowLabel },
      { action: "highlight", target: { text: plain(quote.row.cell) }, dur: 1.8, label }
    ];
  }
  // The cell split needs the pipes, so the span is cut before the markup comes out.
  const span = plain(highlightSpan(claim, quote.text));
  return [
    { action: "scroll", target: { text: span }, dur: 1.2, label: "to the passage" },
    { action: "highlight", target: { text: span }, dur: 2.2, label }
  ];
}

/**
 * The words to highlight: the whole passage when it is short, else the
 * stretch of up to eight words around the claim's first anchor (a number, a
 * date, an entity), cut on word boundaries and inside one table cell, so the
 * page can find it verbatim.
 */
export function highlightSpan(claim, text) {
  const anchors = [
    ...(claim.values ?? []).map((value) => String(value.raw).split(/\s/)[0]),
    ...(claim.entities ?? []).map((entity) => entity.name.split(/\s/)[0])
  ].map((anchor) => anchor.toLowerCase()).filter(Boolean);
  // A row of an HTML table flattened to "a | b | c": the target is the one cell holding the anchor (a page never shows the pipes).
  const pieces = text.split(/\s+\|\s+/).map((piece) => piece.trim()).filter(Boolean);
  const scoped = pieces.length > 1 ? pieces.find((piece) => anchors.some((anchor) => piece.toLowerCase().includes(anchor))) ?? pieces[0] : text;
  const words = scoped.split(/\s+/).filter(Boolean);
  if (words.length <= MAX_SPAN_WORDS) return scoped.replace(/[,;:]$/, "");
  let index = words.findIndex((word) => anchors.some((anchor) => word.toLowerCase().includes(anchor)));
  if (index < 0) index = 0;
  const start = Math.max(0, Math.min(index - 3, words.length - MAX_SPAN_WORDS));
  return words.slice(start, start + MAX_SPAN_WORDS).join(" ").replace(/[,;:.]$/, "");
}

/** Markdown and table syntax out, so the target matches the rendered page's text. */
export function plain(text) {
  return String(text ?? "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\*+|`/g, "")
    .replace(/^#+\s*|[>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** huggingface.co/deepseek-ai/DeepSeek-V4.1 → hf-deepseek-v4-1; github.com/o/r/pull/12 → gh-o-r-pull-12. */
export function captureId(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return "source"; }
  const host = parsed.hostname.replace(/^www\./, "");
  const prefix = host === "huggingface.co" ? "hf" : host === "github.com" ? "gh" : host === "arxiv.org" ? "arxiv" : host.split(".").slice(0, -1).join("-");
  const tail = parsed.pathname.split("/").filter(Boolean).slice(host === "huggingface.co" ? 1 : 0, 4).join("-");
  return `${prefix}-${tail}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "") || "source";
}

function shortLabel(claim) {
  return claim.text.length > 64 ? `${claim.text.slice(0, 61).replace(/\s+\S*$/, "")}…` : claim.text;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}
