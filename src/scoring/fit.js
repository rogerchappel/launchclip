// The fitted layer (docs/SCORING_ROADMAP.md, stages 5 and 6).
//
// The hosted decision models cannot be fine-tuned, so the learning happens
// here: each post's answers become a row of numbers, and a ridge regression
// learns which answers go with above-normal results.
//
//   featurise(rows, schema?)        → {schema, X, ids}
//   fit(rows, options)              → the model (plain JSON)
//   predict(model, items, options)  → [{id, predicted_outlier, percentile}]
//   explain(model, options)         → {note, features}
//   runFit(action, target, flags)   → for a future `launchclip fit`
//
// A row is a line of library.tagged.jsonl, or an item of a `launchclip score`
// report: {id, account?, answers: {<key>: {value}}, tags?: {<key>: value},
// outlier?}. `outlier` is the post's views against its own account's median.
//
// The model stays off (`usable: false`) until it ranks posts it has not seen
// better than chance. Its coefficients are associations in one library, not
// causes.

export const FIT_VERSION = 1;
const RARE = 5; // a choice value seen fewer times than this folds into "other"
const MISSING_SHARE = 0.05; // a question gets an is-missing column above this share

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

/** A row's answer to one question: a number, a string, or null when there is none. */
function valueOf(row, key) {
  const raw = row?.answers?.[key]?.value ?? row?.tags?.[key];
  if (typeof raw === "boolean") return Number(raw);
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  return typeof raw === "string" && raw !== "" ? raw : null;
}

function buildSchema(rows) {
  const keys = [...new Set(rows.flatMap((row) => [...Object.keys(row?.answers ?? {}), ...Object.keys(row?.tags ?? {})]))].sort();
  const columns = [];
  for (const key of keys) {
    const seen = rows.map((row) => valueOf(row, key)).filter((value) => value !== null);
    if (!seen.length) continue;
    if (seen.every((value) => typeof value === "number")) columns.push({ name: key, key, kind: "number", fill: mean(seen) });
    else {
      const counts = new Map();
      for (const value of seen) counts.set(String(value), (counts.get(String(value)) ?? 0) + 1);
      const known = [...counts.keys()].filter((value) => counts.get(value) >= RARE).sort();
      for (const value of known) columns.push({ name: `${key}=${value}`, key, kind: "is", value, fill: counts.get(value) / seen.length });
      const rare = seen.length - known.reduce((sum, value) => sum + counts.get(value), 0);
      if (rare) columns.push({ name: `${key}=(other)`, key, kind: "other", known, fill: rare / seen.length });
    }
    if (rows.length - seen.length > MISSING_SHARE * rows.length) columns.push({ name: `${key}:missing`, key, kind: "missing" });
  }
  return { version: FIT_VERSION, columns };
}

function cell(column, row) {
  const value = valueOf(row, column.key);
  if (column.kind === "missing") return value === null ? 1 : 0;
  if (column.kind === "number") return typeof value === "number" ? value : column.fill;
  if (value === null) return column.fill;
  if (column.kind === "is") return String(value) === column.value ? 1 : 0;
  return column.known.includes(String(value)) ? 0 : 1;
}

/**
 * rows: tagged rows or scored items. schema: one saved by an earlier call, to
 * get the same columns for new items. → {schema, X: number[][], ids}
 */
export function featurise(rows, schema = buildSchema(rows)) {
  if (!Array.isArray(rows)) throw new Error("featurise needs a list of rows");
  if (!Array.isArray(schema?.columns)) throw new Error("the schema has no columns: pass one that featurise or fit returned");
  return { schema, X: rows.map((row) => schema.columns.map((column) => cell(column, row))), ids: rows.map((row, index) => String(row?.id ?? index)) };
}
