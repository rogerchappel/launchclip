// Capture requests (launchclip.capture.v1): one per source chosen to appear
// on screen, for src/evidence/ to record. The beats come from the quote span
// that verified the claim: scroll to it, ring the table row, highlight the
// exact figure or sentence, hold. Only verified claims put a source on screen.
import { CAPTURE_SCHEMA } from "./schema.js";
import { safeHost } from "./http.js";

export const CAPTURE_VIEWPORT = Object.freeze({ width: 1600, height: 1000 });
const MAX_BEATS_PER_CLAIM = 3;
const MAX_CLAIMS_PER_CAPTURE = 3;

/** ledger → {requests[], byClaim: {claimId: captureId}} */
export function buildCaptureRequests(ledger, options = {}) {
  const max = Number(options.maxCaptures ?? 12);
  const groups = new Map();
  for (const claim of ledger.claims) {
    if (claim.status !== "verified") continue;
    const source = claim.sources.find((entry) => entry.supports && entry.primary) ?? claim.sources.find((entry) => entry.supports);
    if (!source?.quote?.text) continue;
    const group = groups.get(source.url) ?? { source, claims: [] };
    if (group.claims.length < MAX_CLAIMS_PER_CAPTURE) group.claims.push({ claim, quote: source.quote });
    groups.set(source.url, group);
  }
  // Primary sources first, then those that carry the most claims.
  const ordered = [...groups.values()].sort((a, b) => Number(b.source.primary) - Number(a.source.primary) || b.claims.length - a.claims.length).slice(0, max);
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
  const span = highlightSpan(claim, plain(quote.text));
  return [
    { action: "scroll", target: { text: span }, dur: 1.2, label: "to the passage" },
    { action: "highlight", target: { text: span }, dur: 2.2, label }
  ];
}

/**
 * The words to highlight: the whole passage when it is short, else the
 * stretch of up to ~14 words around the claim's first anchor (a number, a
 * date, an entity), cut on word boundaries so the page can find it verbatim.
 */
export function highlightSpan(claim, text) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 16) return text;
  const anchors = [
    ...(claim.values ?? []).map((value) => String(value.raw).split(/\s/)[0]),
    ...(claim.entities ?? []).map((entity) => entity.name.split(/\s/)[0])
  ].map((anchor) => anchor.toLowerCase());
  let index = words.findIndex((word) => anchors.some((anchor) => word.toLowerCase().includes(anchor)));
  if (index < 0) index = 0;
  const start = Math.max(0, index - 5);
  return words.slice(start, start + 14).join(" ").replace(/[,;:]$/, "");
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
