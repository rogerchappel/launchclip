#!/usr/bin/env node
// Stage 0 of docs/SCORING_ROADMAP.md: measure a decision model against labels
// a person wrote, before any gate trusts it (docs/guide/scoring-measure.md).
//
//   node eval/scorer-agreement.mjs --set <file.jsonl> --rubric <file.json> [--model <id>[,<id>...]] [--out report.json]
//
// A labelled set is JSONL, one row per item:
//   {"id", "kind", "text", "labels": {"<question key>": true|false|"<option>"|<level index>}}
// A row with a "_comment" field is skipped.
//
// An answer "agrees" when it lands on the label's side of the gate: for a yes/no
// question the same answer, for a score with `min` the same side of `min`, for
// a choice with `allow` the same side of the allowed list. A question that is
// only a tag (no `min`, no `allow`) agrees when it names the labelled option or
// level, and has no probability, so it is never unsure and has no reliability.
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { parseRubric, questionsFor, scoreItems } from "../src/scorer.js";

const BUCKETS = 5;
const round = (value) => Math.round(value * 1000) / 1000;
const gated = (question) => question.type === "noul" || question.allow !== undefined || question.min !== undefined;
// Whether a label is the passing side of its question's gate.
const wanted = (question, label) => (question.type === "noul" ? label === (question.want !== false) : question.type === "choice" ? question.allow.includes(label) : label >= question.min);

function labelProblem(question, label) {
  if (question.type === "noul") return typeof label === "boolean" ? null : "must be true or false";
  if (question.type === "choice") return Object.hasOwn(question.criteria, label) ? null : `must be one of ${Object.keys(question.criteria).join(", ")}`;
  return Number.isInteger(label) && label >= 0 && label < question.criteria.length ? null : `must be a level index from 0 to ${question.criteria.length - 1}`;
}

/** text: the JSONL file. rubric: from parseRubric. → [{id, kind, text, labels}]; throws naming every problem. */
export function parseLabelled(text, rubric) {
  const rows = [];
  const errors = [];
  const seen = new Set();
  text.split("\n").forEach((line, index) => {
    if (!line.trim()) return;
    const err = (message) => errors.push(`line ${index + 1}: ${message}`);
    let row;
    try { row = JSON.parse(line); } catch { return err("is not JSON"); }
    if (row?._comment !== undefined) return;
    if (typeof row?.id !== "string" || typeof row.kind !== "string" || typeof row.text !== "string" || !row.text.trim()) return err("needs id, kind and text");
    if (seen.has(row.id)) return err(`id ${row.id} is used twice`);
    seen.add(row.id);
    const asked = questionsFor(rubric, row.kind);
    const labels = Object.entries(row.labels ?? {});
    if (!labels.length) err(`${row.id} has no labels`);
    for (const [key, label] of labels) {
      if (!asked[key]) err(`${row.id}: the rubric does not ask ${key} of a ${row.kind}`);
      else if (labelProblem(rubric.questions[key], label)) err(`${row.id}: labels.${key} ${labelProblem(rubric.questions[key], label)}`);
    }
    rows.push({ id: row.id, kind: row.kind, text: row.text, labels: row.labels });
  });
  if (!rows.length) errors.push("the set has no rows");
  if (errors.length) throw new Error(`the labelled set has ${errors.length} problem(s):\n- ${errors.join("\n- ")}`);
  return rows;
}

const blank = () => ({ n: 0, agree: 0, unsure: 0, confident: 0, confidentAgree: 0, buckets: Array.from({ length: BUCKETS }, () => ({ n: 0, p: 0, observed: 0 })) });

function add(stats, question, verdict, label) {
  const p = verdict?.p ?? null;
  const ok = gated(question) ? p !== null && (p >= 0.5) === wanted(question, label) : (question.type === "score" && verdict?.value != null ? Math.round(verdict.value) : verdict?.value) === label;
  stats.n += 1;
  stats.agree += ok;
  if (!verdict || verdict.status === "unsure") stats.unsure += 1;
  else { stats.confident += 1; stats.confidentAgree += ok; }
  if (!gated(question) || p === null) return;
  const bucket = stats.buckets[Math.min(BUCKETS - 1, Math.floor(p * BUCKETS))];
  bucket.n += 1;
  bucket.p += p;
  bucket.observed += wanted(question, label);
}

const finish = (stats) => ({
  n: stats.n,
  agreement: stats.n ? round(stats.agree / stats.n) : null,
  unsure: stats.n ? round(stats.unsure / stats.n) : null,
  confident_accuracy: stats.confident ? round(stats.confidentAgree / stats.confident) : null,
  reliability: stats.buckets.map((bucket, index) => ({ from: index / BUCKETS, to: (index + 1) / BUCKETS, n: bucket.n, predicted: bucket.n ? round(bucket.p / bucket.n) : null, observed: bucket.n ? round(bucket.observed / bucket.n) : null }))
});

/**
 * rows: from parseLabelled. report: what scoreItems returned for them. rubric:
 * from parseRubric. → {rows, overall, questions: {key: stats}} where stats is
 * {n, agreement, unsure, confident_accuracy, reliability: [{from, to, n, predicted, observed}]}.
 */
export function agreement(rows, report, rubric) {
  const scored = new Map(report.items.map((item) => [item.id, item]));
  const overall = blank();
  const questions = {};
  for (const row of rows) {
    for (const [key, label] of Object.entries(row.labels)) {
      const verdict = scored.get(row.id)?.answers?.[key];
      for (const stats of [overall, (questions[key] ??= blank())]) add(stats, rubric.questions[key], verdict, label);
    }
  }
  return { rows: rows.length, overall: finish(overall), questions: Object.fromEntries(Object.entries(questions).map(([key, stats]) => [key, finish(stats)])) };
}

/**
 * Scores the rows with one model and compares. options: what scoreItems takes
 * (model, apiKey, fetch, concurrency). → agreement() plus {model, cost_usd,
 * requests, median_latency_ms}.
 */
export async function measure(rows, rubric, { fetch = globalThis.fetch, ...options } = {}) {
  const latencies = [];
  // Timed to the response headers, retries included as their own requests.
  const timed = async (...args) => {
    const start = performance.now();
    try { return await fetch(...args); } finally { latencies.push(performance.now() - start); }
  };
  // The labels stay here: the model must not see the answer it is measured against.
  const report = await scoreItems(rows.map(({ labels, ...item }) => item), rubric, { ...options, fetch: timed });
  latencies.sort((a, b) => a - b);
  const middle = latencies.length >> 1;
  const median = latencies.length ? (latencies.length % 2 ? latencies[middle] : (latencies[middle - 1] + latencies[middle]) / 2) : null;
  return { model: report.model, cost_usd: report.cost_usd, requests: latencies.length, median_latency_ms: median === null ? null : Math.round(median), ...agreement(rows, report, rubric) };
}

const pct = (share) => (share === null ? "-" : `${Math.round(share * 100)}%`).padStart(11);

/** result: from measure. → the table as text. */
export function formatAgreement(result) {
  const width = Math.max(8, ...Object.keys(result.questions).map((key) => key.length));
  const line = (name, stats) => `${name.padEnd(width)} ${String(stats.n).padStart(5)}${pct(stats.agreement)}${pct(stats.unsure)}${pct(stats.confident_accuracy)}`;
  return [
    `${result.model}: ${result.rows} rows, ${result.overall.n} labels, ${result.requests} requests, cost $${result.cost_usd}, median ${result.median_latency_ms} ms per request`,
    `${"question".padEnd(width)} ${"n".padStart(5)}${"agree".padStart(11)}${"unsure".padStart(11)}${"confident".padStart(11)}`,
    ...Object.entries(result.questions).map(([key, stats]) => line(key, stats)),
    line("overall", result.overall),
    "reliability, all gated questions (model's probability of a pass against the share the labels pass):",
    `${"bucket".padEnd(width)} ${"n".padStart(5)}${"predicted".padStart(11)}${"observed".padStart(11)}`,
    ...result.overall.reliability.map((bucket) => `${`${bucket.from.toFixed(1)}-${bucket.to.toFixed(1)}`.padEnd(width)} ${String(bucket.n).padStart(5)}${pct(bucket.predicted)}${pct(bucket.observed)}`)
  ].join("\n");
}

async function main() {
  const { values } = parseArgs({ options: { set: { type: "string" }, rubric: { type: "string" }, model: { type: "string" }, out: { type: "string" } } });
  if (!values.set || !values.rubric) throw new Error("usage: scorer-agreement.mjs --set <file.jsonl> --rubric <file.json> [--model <id>[,<id>...]] [--out report.json]");
  const rubric = parseRubric(JSON.parse(await readFile(values.rubric, "utf8")));
  const rows = parseLabelled(await readFile(values.set, "utf8"), rubric);
  const models = [];
  for (const model of values.model ? values.model.split(",").map((id) => id.trim()).filter(Boolean) : [undefined]) {
    const result = await measure(rows, rubric, { model });
    models.push(result);
    console.log(`${formatAgreement(result)}\n`);
  }
  if (rows.length < 200) console.log(`${rows.length} rows is too few to choose a model or a threshold on: one label moves a question by several points. Aim for about 200.`);
  if (values.out) await writeFile(values.out, `${JSON.stringify({ set: values.set, rubric: values.rubric, models }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
