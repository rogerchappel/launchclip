// The stage 0 measurement (eval/scorer-agreement.mjs) against a stand-in for
// the hosted decision model: no network, no key.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { agreement, formatAgreement, measure, parseLabelled } from "../eval/scorer-agreement.mjs";
import { parseRubric, questionsFor } from "../src/scorer.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const rubric = parseRubric({
  questions: {
    has_number: { type: "noul", instructions: "Does it state a number?" },
    filler: { type: "noul", want: false, instructions: "Does it open with a greeting?" },
    clarity: { type: "score", min: 1, instructions: "How clear?", criteria: ["Unclear", "Clear", "Very clear"] },
    hook_type: { type: "choice", instructions: "Which kind?", criteria: { number: "", other: "" } }
  }
});
const row = (id, text, labels) => JSON.stringify({ id, kind: "hook", text, labels });
const SET = [
  '{"_comment": "a header row is skipped"}',
  row("a", "3 fixes for slow builds", { has_number: true, filler: false, clarity: 2, hook_type: "number" }),
  row("b", "Hey guys, some tips", { has_number: false, filler: true, clarity: 0, hook_type: "other" }),
  row("c", "Builds feel slow", { has_number: true, hook_type: "number" }),
  ""
].join("\n");

// Answers from the text alone: "some" is the unsure band, clarity always says level 1.
function fakeFetch(calls = []) {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const text = body.state.text;
    const answers = {
      has_number: { type: "noul", noul: /\d/.test(text) ? 0.95 : /some/.test(text) ? 0.5 : 0.04 },
      filler: { type: "noul", noul: /^hey/i.test(text) ? 0.97 : 0.02 },
      clarity: { type: "score", score: 1.1, probabilities: { 0: 0.1, 1: 0.7, 2: 0.2 } },
      hook_type: { type: "choice", choice: /\d/.test(text) ? "number" : "other", probabilities: {} }
    };
    return new Response(JSON.stringify({ answers, model: body.model, usage: { cost: 0.00002 } }), { status: 200 });
  };
}

test("parseLabelled reads rows, skips the comment row and names every problem", () => {
  assert.deepEqual(parseLabelled(SET, rubric).map((item) => item.id), ["a", "b", "c"]);
  const bad = [row("a", "x", { has_number: "yes", clarity: 3, hook_type: "story", nope: true }), row("a", "x", {}), "{oops", '{"id":"z"}'].join("\n");
  assert.throws(() => parseLabelled(bad, rubric), (error) => {
    for (const part of ["labels.has_number must be true or false", "labels.clarity must be a level index from 0 to 2", "labels.hook_type must be one of number, other", "does not ask nope of a hook", "id a is used twice", "line 3: is not JSON", "line 4: needs id, kind and text"]) assert.ok(error.message.includes(part), part);
    return true;
  });
  assert.throws(() => parseLabelled("\n", rubric), /has no rows/);
});

test("measure: agreement, the unsure band, confident accuracy, reliability, cost and latency", async () => {
  const calls = [];
  const result = await measure(parseLabelled(SET, rubric), rubric, { model: "m", apiKey: "k", fetch: fakeFetch(calls) });
  assert.ok(calls.every((body) => !JSON.stringify(body).includes("labels")), "the labels are never sent to the model");
  assert.equal(result.model, "m");
  assert.equal(result.cost_usd, 0.00006);
  assert.equal(result.requests, 3);
  assert.ok(result.median_latency_ms >= 0);

  const q = result.questions;
  // a agrees, b is unsure (0.5 does not count as the labelled "no"), c is confidently wrong.
  assert.deepEqual([q.has_number.n, q.has_number.agreement, q.has_number.unsure, q.has_number.confident_accuracy], [3, 0.333, 0.333, 0.5]);
  // want: false. A confident "yes" is a fail, which is what the label true expects.
  assert.equal(q.filler.agreement, 1);
  // The model always passes clarity at 0.9: right for level 2, wrong for level 0.
  assert.equal(q.clarity.agreement, 0.5);
  assert.deepEqual(q.clarity.reliability[4], { from: 0.8, to: 1, n: 2, predicted: 0.9, observed: 0.5 });
  // A tag has no probability: exact match, never unsure, no reliability rows.
  assert.deepEqual([q.hook_type.agreement, q.hook_type.unsure, q.hook_type.reliability.reduce((sum, bucket) => sum + bucket.n, 0)], [0.667, 0, 0]);
  assert.deepEqual([result.overall.n, result.overall.agreement, result.overall.unsure, result.overall.confident_accuracy], [10, 0.6, 0.1, 0.667]);
  assert.equal(result.overall.reliability.reduce((sum, bucket) => sum + bucket.n, 0), 7);

  const table = formatAgreement(result);
  assert.match(table, /^m: 3 rows, 10 labels, 3 requests, cost \$0\.00006, median \d+ ms per request\n/);
  assert.match(table, /has_number\s+3\s+33%\s+33%\s+50%\n/);
  assert.match(table, /overall\s+10\s+60%\s+10%\s+67%\n/);
  assert.match(table, /0\.8-1\.0\s+4\s+93%\s+75%$/);
});

test("agreement counts a missing or malformed answer as unsure and wrong", () => {
  const rows = parseLabelled(SET, rubric);
  const result = agreement(rows, { items: [{ id: "a", answers: { has_number: { status: "unsure", value: null, p: null } } }] }, rubric);
  assert.deepEqual([result.overall.agreement, result.overall.unsure, result.overall.confident_accuracy], [0, 1, null]);
});

test("the seed set fits the starter rubric and labels every question", async () => {
  const starter = parseRubric(JSON.parse(await readFile(path.join(ROOT, "docs/guide/scoring-rubric.json"), "utf8")));
  const rows = parseLabelled(await readFile(path.join(ROOT, "eval/fixtures/scorer-seed.jsonl"), "utf8"), starter);
  assert.ok(rows.length >= 40);
  const labelled = new Set(rows.flatMap((item) => Object.keys(item.labels)));
  assert.deepEqual([...labelled].sort(), Object.keys(starter.questions).sort());
  for (const item of rows) assert.deepEqual(Object.keys(item.labels).sort(), Object.keys(questionsFor(starter, item.kind)).sort(), item.id);
});
