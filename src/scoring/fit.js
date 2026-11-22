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

const MIN_ROWS = 200;
const LAMBDAS = [0.1, 1, 10, 100, 1000];
const RESAMPLES = 1000;
const SHUFFLES = 5;
const round = (value) => Math.round(value * 1000) / 1000;

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(list, random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function ranks(values) {
  const order = values.map((_, index) => index).sort((a, b) => values[a] - values[b]);
  const out = new Array(values.length);
  for (let start = 0; start < order.length;) {
    let end = start;
    while (end + 1 < order.length && values[order[end + 1]] === values[order[start]]) end += 1;
    for (let at = start; at <= end; at += 1) out[order[at]] = (start + end) / 2 + 1; // ties share their average rank
    start = end + 1;
  }
  return out;
}

/** Rank correlation, ties given their average rank. 0 when either side is constant. */
export function spearman(a, b) {
  const [ra, rb] = [ranks(a), ranks(b)];
  const [ma, mb] = [mean(ra), mean(rb)];
  let [ab, aa, bb] = [0, 0, 0];
  for (let i = 0; i < ra.length; i += 1) {
    ab += (ra[i] - ma) * (rb[i] - mb);
    aa += (ra[i] - ma) ** 2;
    bb += (rb[i] - mb) ** 2;
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
}

/** Gauss-Jordan with pivoting. A column that depends on the others keeps a coefficient of 0. */
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  const tiny = 1e-10 * Math.max(1, ...A.map((row, i) => Math.abs(row[i])));
  const x = new Array(n).fill(0);
  const pivots = [];
  for (let col = 0, row = 0; col < n && row < n; col += 1) {
    let best = row;
    for (let i = row + 1; i < n; i += 1) if (Math.abs(M[i][col]) > Math.abs(M[best][col])) best = i;
    if (Math.abs(M[best][col]) <= tiny) continue;
    [M[row], M[best]] = [M[best], M[row]];
    for (let i = 0; i < n; i += 1) {
      const factor = i === row ? 0 : M[i][col] / M[row][col];
      if (factor) for (let k = col; k <= n; k += 1) M[i][k] -= factor * M[row][k];
    }
    pivots.push([row, col]);
    row += 1;
  }
  for (const [row, col] of pivots) x[col] = M[row][n] / M[row][col];
  return x;
}

/** Weighted ridge on the rows in idx, columns standardised. A constant column gets 0. */
function ridge(X, y, w, idx, lambda) {
  const p = X[idx[0]].length;
  const columns = [...Array(p).keys()];
  let total = 0;
  let intercept = 0;
  const center = new Array(p).fill(0);
  for (const i of idx) {
    total += w[i];
    intercept += w[i] * y[i];
    for (const j of columns) center[j] += w[i] * X[i][j];
  }
  intercept /= total;
  for (const j of columns) center[j] /= total;
  const scale = new Array(p).fill(0);
  for (const i of idx) for (const j of columns) scale[j] += w[i] * (X[i][j] - center[j]) ** 2;
  for (const j of columns) scale[j] = Math.sqrt(scale[j] / total) > 1e-9 ? Math.sqrt(scale[j] / total) : 1;
  const A = columns.map(() => new Array(p).fill(0));
  const b = new Array(p).fill(0);
  for (const i of idx) {
    const z = columns.map((j) => (X[i][j] - center[j]) / scale[j]);
    for (const j of columns) {
      b[j] += w[i] * z[j] * (y[i] - intercept);
      for (let k = 0; k <= j; k += 1) A[j][k] += w[i] * z[j] * z[k];
    }
  }
  for (const j of columns) {
    for (let k = 0; k < j; k += 1) A[k][j] = A[j][k];
    A[j][j] += lambda;
  }
  return { center, scale, intercept, coefficients: solve(A, b) };
}

const apply = (model, x) => x.reduce((sum, value, j) => sum + model.coefficients[j] * (value - model.center[j]) / model.scale[j], model.intercept);

/** Each row in idx predicted by a model that never saw its fold. lambda undefined: chosen inside each training part. */
function heldOut(X, y, w, fold, lambda, idx) {
  const predicted = new Array(y.length);
  for (const held of new Set(idx.map((i) => fold[i]))) {
    const train = idx.filter((i) => fold[i] !== held);
    const model = ridge(X, y, w, train, lambda ?? pickLambda(X, y, w, fold, train));
    for (const i of idx) if (fold[i] === held) predicted[i] = apply(model, X[i]);
  }
  return predicted;
}

/** The lambda with the lowest held-out squared error across the folds in idx. */
function pickLambda(X, y, w, fold, idx) {
  if (new Set(idx.map((i) => fold[i])).size < 2) return LAMBDAS[2];
  let best = null;
  for (const lambda of LAMBDAS) {
    const predicted = heldOut(X, y, w, fold, lambda, idx);
    const error = idx.reduce((sum, i) => sum + w[i] * (predicted[i] - y[i]) ** 2, 0);
    if (!best || error < best.error) best = { lambda, error };
  }
  return best.lambda;
}

/** → {fold: a fold number per row, split: "account" | "row"} */
export function foldsFor(rows, folds = 5, seed = 1) {
  const random = seededRandom(seed);
  const sizes = new Map();
  for (const row of rows) sizes.set(row.account, (sizes.get(row.account) ?? 0) + 1);
  if (sizes.has(undefined) || sizes.has(null) || sizes.size < folds) {
    const order = shuffled(rows.map((_, index) => index), random);
    const fold = new Array(rows.length);
    order.forEach((index, at) => { fold[index] = at % folds; });
    return { fold, split: "row" };
  }
  // Whole accounts go to one fold, so a model cannot pass by memorising a channel.
  const load = new Array(folds).fill(0);
  const foldOf = new Map();
  for (const account of shuffled([...sizes.keys()], random).sort((a, b) => sizes.get(b) - sizes.get(a))) {
    const lightest = load.indexOf(Math.min(...load));
    foldOf.set(account, lightest);
    load[lightest] += sizes.get(account);
  }
  return { fold: rows.map((row) => foldOf.get(row.account)), split: "account" };
}

/**
 * rows: tagged rows; those with no positive `target` are left out. weights:
 * (row) → a positive number, so a brand's own posts can count for more.
 * → the model: plain JSON, safe to save. `usable` says whether to trust it.
 */
export function fit(rows, { target = "outlier", lambda, folds = 5, seed = 1, weights } = {}) {
  if (!Array.isArray(rows)) throw new Error("fit needs a list of tagged rows");
  if (!(Number.isInteger(folds) && folds >= 2)) throw new Error(`folds must be a whole number, 2 or more; got ${folds}`);
  if (lambda !== undefined && !(lambda >= 0)) throw new Error(`lambda must be 0 or more; got ${lambda}`);
  const used = rows.filter((row) => Number.isFinite(row?.[target]) && row[target] > 0);
  if (used.length < folds * 2) throw new Error(`fit needs at least ${folds * 2} rows with a ${target} above 0; got ${used.length} of ${rows.length}`);
  const w = used.map((row) => (weights ? Number(weights(row)) : 1));
  if (w.some((weight) => !(weight > 0 && Number.isFinite(weight)))) throw new Error("weights must give every row a number above 0");
  const { schema, X } = featurise(used);
  const y = used.map((row) => Math.log(row[target]));
  const all = used.map((_, index) => index);
  const { fold, split } = foldsFor(used, folds, seed);
  const random = seededRandom(seed + 1);

  const predicted = heldOut(X, y, w, fold, lambda, all);
  const rho = spearman(predicted, y);
  const resampled = Array.from({ length: RESAMPLES }, () => {
    const pick = all.map(() => Math.floor(random() * all.length));
    return spearman(pick.map((i) => predicted[i]), pick.map((i) => y[i]));
  }).sort((a, b) => a - b);
  const interval = [resampled[Math.floor(0.025 * RESAMPLES)], resampled[Math.ceil(0.975 * RESAMPLES) - 1]];
  // The highest of a few shuffles: one shuffle alone lands below zero half the time.
  const baseline = Math.max(...Array.from({ length: SHUFFLES }, () => {
    const mixed = shuffled(y, random);
    return spearman(heldOut(X, mixed, w, fold, lambda, all), mixed);
  }));
  const top = [...all].sort((a, b) => predicted[b] - predicted[a]).slice(0, Math.ceil(all.length / 4));
  const lift = median(top.map((i) => Math.exp(y[i]))) / median(y.map(Math.exp));

  const chosen = lambda ?? pickLambda(X, y, w, fold, all);
  const final = ridge(X, y, w, all, chosen);
  const fitted = all.map((i) => apply(final, X[i])).sort((a, b) => a - b);
  const reasons = [];
  if (used.length < MIN_ROWS) reasons.push(`only ${used.length} posts with results: at least ${MIN_ROWS} are needed`);
  if (!(interval[0] > 0)) reasons.push(`its ranking of posts it had not seen could be chance (rank correlation ${round(rho)}, 95% range ${round(interval[0])} to ${round(interval[1])})`);
  if (!(rho > baseline)) reasons.push(`it ranks no better than the same model trained on shuffled results (${round(rho)} against ${round(baseline)})`);
  return {
    version: FIT_VERSION,
    schema,
    coefficients: final.coefficients, // per standard deviation of each column
    intercept: final.intercept,
    center: final.center,
    scale: final.scale,
    fitted_percentiles: Array.from({ length: 101 }, (_, k) => fitted[Math.round(k * (fitted.length - 1) / 100)]),
    target: `log_${target}`,
    lambda: chosen,
    trained_on: used.length,
    held_out: { spearman: round(rho), spearman_ci: interval.map(round), top_quartile_lift: round(lift), baseline_spearman: round(baseline), folds, split },
    usable: reasons.length === 0,
    reasons
  };
}

function checkModel(model) {
  if (model?.version !== FIT_VERSION || !Array.isArray(model.coefficients) || model.coefficients.length !== model.schema?.columns?.length) throw new Error(`not a fitted model this version reads (version ${FIT_VERSION}): fit it again`);
}

/**
 * items: scored items, a `launchclip score` report, or tagged rows.
 * → [{id, predicted_outlier, percentile}] in the order given. percentile is
 * against the model's predictions for the posts it was trained on (0 to 100).
 */
export function predict(model, items, { force = false } = {}) {
  checkModel(model);
  if (!model.usable && !force) throw new Error(`this model is not usable, so its predictions would be guesses: ${model.reasons.join("; ")}. Pass force to predict anyway.`);
  const { X, ids } = featurise(Array.isArray(items) ? items : items?.items, model.schema);
  return X.map((x, index) => {
    const log = apply(model, x);
    return { id: ids[index], predicted_outlier: round(Math.exp(log)), percentile: Math.max(0, model.fitted_percentiles.filter((value) => value <= log).length - 1) };
  });
}

export const ASSOCIATION_NOTE = "These are associations in this library, not causes: a feature can go with good results without producing them.";

/** → {note, features: [{feature, key, value?, coefficient, direction, text}]}, largest standardised coefficient first. */
export function explain(model, { top = 10 } = {}) {
  checkModel(model);
  const features = model.schema.columns
    .map((column, index) => ({ column, coefficient: model.coefficients[index] }))
    .filter(({ coefficient }) => coefficient !== 0)
    .sort((a, b) => Math.abs(b.coefficient) - Math.abs(a.coefficient))
    .slice(0, top)
    .map(({ column, coefficient }) => {
      const what = { number: `a higher ${column.key}`, is: `${column.key} being "${column.value}"`, other: `${column.key} being a rare value`, missing: `no answer for ${column.key}` }[column.kind];
      const direction = coefficient > 0 ? "above" : "below";
      return { feature: column.name, key: column.key, ...(column.kind === "is" ? { value: column.value } : {}), coefficient: round(coefficient), direction, text: `${what} goes with ${direction}-normal results` };
    });
  return { note: ASSOCIATION_NOTE, features };
}
