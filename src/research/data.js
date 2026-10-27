// Data extraction: tables in a source (benchmark scores, prices, specs) are
// lifted into research/data/<id>.json with the source cited, so the data
// modules (bar-chart, leaderboard, comparison-table) rebuild the chart in house
// style instead of showing a screenshot of someone else's. Cells keep the
// source's spelling next to the parsed number, and footnote marks survive as
// notes, so nothing is rounded or cleaned away silently.
import { DATA_SCHEMA } from "./schema.js";
import { captureId } from "./capture.js";
import { splitRow } from "./verify.js";

const MIN_ROWS = 2;

/** snapshots + ledger → data files [{schema, id, title, source, columns, rows, views, claims}] */
export function extractData(snapshots, ledger, options = {}) {
  const files = [];
  const max = Number(options.maxTables ?? 8);
  const subject = options.subject ?? null;
  for (const snapshot of snapshots) {
    if (!snapshot.primary) continue;
    const tables = parseTables(snapshot.text);
    tables.forEach((table, index) => {
      const numeric = table.rows.flatMap((row) => row.cells.slice(1)).filter((cell) => cell.value != null).length;
      const total = table.rows.flatMap((row) => row.cells.slice(1)).length;
      if (table.rows.length < MIN_ROWS || !total || numeric / total < 0.5) return;
      // Tables a verified claim quotes come first; a benchmark or price table counts too.
      const claims = (ledger?.claims ?? []).filter((claim) => claim.status === "verified" && claim.sources.some((source) => source.url === snapshot.url && source.quote?.start != null && source.quote.start >= table.start && source.quote.end <= table.end)).map((claim) => claim.id);
      const kind = /bench|score|eval|accuracy|pass@|elo|mmlu|swe|arena/i.test(`${table.title} ${table.columns.join(" ")} ${table.rows.map((row) => row.label).join(" ")}`) ? "benchmark"
        : /price|cost|\$|usd|per\s?(?:1m|million)/i.test(`${table.title} ${table.columns.join(" ")}`) ? "price" : "table";
      if (!claims.length && kind === "table") return;
      const id = `${captureId(snapshot.url)}-${kind}${tables.length > 1 ? `-${index + 1}` : ""}`;
      files.push({
        schema: DATA_SCHEMA,
        id,
        kind,
        title: table.title ?? `${snapshot.title ?? snapshot.url} table ${index + 1}`,
        source: { url: snapshot.url, title: snapshot.title ?? snapshot.url, publisher: snapshot.publisher ?? null, published_at: snapshot.published_at ?? null, fetched_at: snapshot.fetched_at, sha256: snapshot.sha256 ?? null },
        columns: table.columns,
        rows: table.rows.map((row) => ({ label: row.label, values: Object.fromEntries(row.cells.slice(1).map((cell, at) => [table.columns[at + 1] ?? `col${at + 1}`, cell.value])), raw: row.cells.map((cell) => cell.raw), ...(row.cells.some((cell) => cell.note) ? { notes: Object.fromEntries(row.cells.slice(1).filter((cell) => cell.note).map((cell) => [table.columns[row.cells.indexOf(cell)] ?? "?", cell.note])) } : {}) })),
        notes: table.footnotes,
        claims,
        views: viewsFor(table, subject)
      });
    });
  }
  return files.sort((a, b) => b.claims.length - a.claims.length).slice(0, max);
}

/**
 * Ready-made module props for the data modules. Rows are measures (a
 * benchmark per row, models across): one bar-chart per row with the subject's
 * column highlighted. A two-column spec table becomes one comparison-table.
 */
export function viewsFor(table, subject) {
  const columns = table.columns.slice(1);
  if (columns.length === 1) {
    const rows = table.rows.slice(0, 8).map((row) => ({ label: row.label, values: [row.cells[1]?.raw ?? null] }));
    return [{ module: "comparison-table", props: { columns: [table.columns[0] || "", columns[0]], rows } }];
  }
  const highlight = subject ? columns.find((column) => similar(column, subject)) ?? null : null;
  return table.rows.slice(0, 12).map((row) => {
    const data = columns.map((column, at) => ({ label: column, value: row.cells[at + 1]?.value })).filter((entry) => entry.value != null).slice(0, 10);
    return data.length >= 2 ? { module: "bar-chart", title: row.label, props: { data, ...(highlight && data.some((entry) => entry.label === highlight) ? { highlight } : {}) } } : null;
  }).filter(Boolean);
}

/** Markdown pipe tables (and HTML tables htmlToText flattened to pipes) with their heading and offsets. */
export function parseTables(text) {
  const tables = [];
  const lines = String(text ?? "").split("\n");
  let offset = 0;
  let heading = null;
  let current = null;
  const close = () => {
    if (current?.rows.length) tables.push(current);
    current = null;
  };
  for (const line of lines) {
    const start = offset;
    offset += line.length + 1;
    const trimmed = line.trim();
    const isRow = (trimmed.match(/\|/g) ?? []).length >= 2;
    if (!isRow) {
      if (current && trimmed.startsWith("*") && /[†‡*]/.test(trimmed)) current.footnotes.push(trimmed.replace(/^\*+|\*+$/g, "").trim());
      else if (current && trimmed && !/^<\/?div/.test(trimmed)) close();
      const match = trimmed.match(/^#{1,6}\s+(.*)$|^\*\*([^*]{3,80})\*\*:?$/);
      if (match) heading = (match[1] ?? match[2]).trim();
      continue;
    }
    if (/^\|?\s*:?-{2,}/.test(trimmed)) continue;
    const cells = splitRow(trimmed);
    if (!current) {
      current = { title: heading, columns: cells.map(cleanCell), rows: [], footnotes: [], start, end: start + line.length };
      continue;
    }
    current.rows.push({ label: cleanCell(cells[0]), cells: cells.map(parseCell) });
    current.end = start + line.length;
  }
  close();
  return tables;
}

/** "42.6 (44.0†)" → {raw, value: 42.6, note: "44.0†"}; "—" → value null; "$0.28" → 0.28; "87.5%" → 87.5. */
export function parseCell(raw) {
  const text = cleanCell(raw);
  const match = text.match(/^[$€£]?\s?(-?\d{1,3}(?:,\d{3})+|-?\d+(?:\.\d+)?)\s?(%|[kKmMbB])?\b/);
  const note = text.match(/\(([^)]+)\)/)?.[1] ?? (/[†‡*]$/.test(text) ? text.match(/[†‡*]+$/)[0] : null);
  if (!match) return { raw: text, value: null, ...(note ? { note } : {}) };
  return { raw: text, value: Number(match[1].replace(/,/g, "")), ...(note ? { note } : {}) };
}

function cleanCell(cell) {
  return String(cell ?? "").replace(/\*\*|`/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").trim();
}

function similar(column, subject) {
  const tokens = (value) => new Set(String(value).toLowerCase().split(/[\s_/-]+/).filter(Boolean));
  const left = tokens(column);
  const right = tokens(subject);
  const shared = [...left].filter((token) => right.has(token)).length;
  return shared / Math.max(1, new Set([...left, ...right]).size) >= 0.5;
}
