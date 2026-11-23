// The scorer (src/scorer.js) and `launchclip score` (src/score_cli.js), against
// a stand-in for the hosted decision model: no network, no key.
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runCli } from "../src/cli.js";
import { formatScore, readItems, runScore } from "../src/score_cli.js";
import { ask, judge, parseRubric, questionsFor, scoreItems } from "../src/scorer.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const RUBRIC = {
  questions: {
    has_number: { type: "noul", on: "hook", instructions: "Does it state a number?" },
    filler: { type: "noul", want: false, instructions: "Does it open with a greeting?" },
    clarity: { type: "score", min: 1, instructions: "How clear?", criteria: ["Unclear", "Clear", "Very clear"] },
    hook_type: { type: "choice", on: "hook", instructions: "Which kind?", criteria: { number: "", question: "", other: "" } }
  }
};

// Answers from the text alone, the way the model's reply is shaped.
function fakeFetch(calls = []) {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, auth: init.headers.authorization });
    const text = body.state.text;
    const answers = {};
    for (const [key, question] of Object.entries(body.questions)) {
      if (key === "has_number") answers[key] = { type: "noul", noul: /\d/.test(text) ? 0.95 : /some/.test(text) ? 0.5 : 0.04 };
      else if (key === "filler") answers[key] = { type: "noul", noul: /^hey/i.test(text) ? 0.97 : 0.02 };
      else if (question.type === "score") answers[key] = { type: "score", score: 1.1, probabilities: { 0: 0.1, 1: 0.7, 2: 0.2 }, confidence: 0.7 };
      else answers[key] = { type: "choice", choice: /\d/.test(text) ? "number" : "other", probabilities: { number: 0.8, question: 0.1, other: 0.1 }, confidence: 0.8 };
    }
    return new Response(JSON.stringify({ answers, model: `${body.model}-dated`, usage: { cost: 0.00002 } }), { status: 200 });
  };
}

test("parseRubric names every problem and accepts the example rubric", async () => {
  assert.throws(() => parseRubric({}), /at least one question/);
  assert.throws(() => parseRubric({ pass_at: 0.4, questions: { "bad key": { type: "noul", instructions: "x" }, a: { type: "rank" }, b: { type: "choice", instructions: "x", criteria: { one: "" } }, c: { type: "score", instructions: "x", criteria: ["a", "b"], min: 2 }, d: { type: "choice", instructions: "x", criteria: { x: "", y: "" }, allow: ["z"] } } }), (error) => {
    for (const part of ["pass_at", "questions.bad key", "questions.a: type", "questions.b: criteria", "questions.c: min", "questions.d: allow"]) assert.ok(error.message.includes(part), part);
    return true;
  });
  const example = parseRubric(JSON.parse(await readFile(path.join(ROOT, "docs/guide/scoring-rubric.json"), "utf8")));
  assert.equal(example.pass_at, 0.7);
});

test("questionsFor asks only the questions for a kind, without the gate's fields", () => {
  const rubric = parseRubric(RUBRIC);
  assert.deepEqual(Object.keys(questionsFor(rubric, "slide")), ["filler", "clarity"]);
  assert.deepEqual(questionsFor(rubric, "hook").filler, { type: "noul", instructions: "Does it open with a greeting?" });
});

test("judge: pass, fail, unsure and tag", () => {
  const q = RUBRIC.questions;
  assert.equal(judge(q.has_number, { type: "noul", noul: 0.9 }).status, "pass");
  assert.equal(judge(q.has_number, { type: "noul", noul: 0.3 }).status, "fail");
  assert.equal(judge(q.has_number, { type: "noul", noul: 0.5 }).status, "unsure");
  assert.deepEqual(judge(q.filler, { type: "noul", noul: 0.97 }), { status: "fail", value: 0.97, p: 0.03 });
  assert.equal(judge(q.clarity, { type: "score", score: 1.1, probabilities: { 0: 0.1, 1: 0.7, 2: 0.2 } }).p, 0.9);
  assert.deepEqual(judge(q.hook_type, { type: "choice", choice: "number", probabilities: { number: 1 } }), { status: "tag", value: "number" });
  assert.equal(judge({ ...q.hook_type, allow: ["number", "question"] }, { type: "choice", choice: "other", probabilities: { number: 0.1, question: 0.1, other: 0.8 } }).status, "fail");
  assert.equal(judge(q.has_number, undefined).status, "unsure");
});

test("gate: false makes any question a tag that never fails an item", async () => {
  const q = RUBRIC.questions;
  assert.deepEqual(judge({ ...q.has_number, gate: false }, { type: "noul", noul: 0.02 }), { status: "tag", value: 0.02 });
  assert.deepEqual(judge({ ...q.filler, gate: false }, { type: "noul", noul: 0.97 }), { status: "tag", value: 0.97 });
  assert.deepEqual(judge({ ...q.clarity, gate: false }, { type: "score", score: 0.1, probabilities: { 0: 0.9, 1: 0.1 } }), { status: "tag", value: 0.1 });
  assert.deepEqual(judge({ ...q.hook_type, allow: ["question"], gate: false }, { type: "choice", choice: "other", probabilities: { other: 1 } }), { status: "tag", value: "other" });
  assert.deepEqual(judge({ ...q.has_number, gate: false }, { type: "refusal" }), { status: "tag", value: null }, "no answer is not a reason to review");
  assert.throws(() => parseRubric({ questions: { a: { ...q.has_number, gate: "no" } } }), /questions\.a: gate must be true or false/);
  // Every gate would fail this text; as tags they are recorded and it passes. Unknown fields are kept and never sent.
  const tagsOnly = parseRubric({ questions: Object.fromEntries(Object.entries(q).map(([key, question]) => [key, { ...question, gate: false, evidence: { rho: 0.1 } }])) });
  assert.deepEqual(tagsOnly.questions.filler.evidence, { rho: 0.1 });
  assert.deepEqual(Object.keys(questionsFor(tagsOnly, "hook").filler), ["type", "instructions"]);
  const report = await scoreItems([{ id: "h", kind: "hook", text: "Hey, welcome back" }], tagsOnly, { apiKey: "k", fetch: fakeFetch() });
  assert.deepEqual([report.status, report.items[0].failed, report.items[0].unsure], ["passed", [], []]);
  assert.deepEqual(report.items[0].tags, { has_number: 0.04, filler: 0.97, clarity: 1.1, hook_type: "other" });
});

test("ask sends the request shape, retries a busy answer and reports a refusal", async () => {
  const calls = [];
  const reply = await ask({ state: { text: "3 fixes" }, questions: { has_number: { type: "noul", instructions: "?" } }, apiKey: "k", fetch: fakeFetch(calls) });
  assert.equal(calls[0].url, "https://openrouter.ai/api/alpha/decisions");
  assert.equal(calls[0].auth, "Bearer k");
  assert.deepEqual(Object.keys(calls[0].body), ["model", "state", "questions"]);
  assert.equal(reply.answers.has_number.noul, 0.95);

  let tries = 0;
  const busy = async (...args) => (++tries < 3 ? new Response("slow down", { status: 429 }) : fakeFetch()(...args));
  await ask({ state: { text: "x" }, questions: {}, apiKey: "k", fetch: busy, sleep: async () => {} });
  assert.equal(tries, 3);
  await assert.rejects(ask({ state: "x", questions: {}, apiKey: "k", fetch: async () => new Response("bad model", { status: 400 }) }), /answered 400: bad model/);
  await assert.rejects(ask({ state: "x", questions: {}, apiKey: "" }), /OPENROUTER_API_KEY is not set/);
});

test("scoreItems gates each item and totals the run", async () => {
  const items = [{ id: "a", kind: "hook", text: "3 fixes for slow builds" }, { id: "b", kind: "hook", text: "Hey guys, some tips" }, { id: "c", kind: "hook", text: "Builds feel slow for some teams" }, { id: "d", kind: "caption", text: "x" }];
  const report = await scoreItems(items, parseRubric({ questions: { has_number: RUBRIC.questions.has_number, filler: { ...RUBRIC.questions.filler, on: "hook" }, hook_type: RUBRIC.questions.hook_type } }), { apiKey: "k", fetch: fakeFetch(), context: { brief: "B" } });
  assert.deepEqual(report.items.map((item) => item.status), ["passed", "failed", "review", "skipped"]);
  assert.deepEqual(report.items[1].failed, ["filler"]);
  assert.deepEqual(report.items[1].unsure, ["has_number"]);
  assert.deepEqual(report.items[0].tags, { hook_type: "number" });
  assert.deepEqual(report.counts, { passed: 1, review: 1, failed: 1, skipped: 1 });
  assert.equal(report.status, "failed");
  assert.equal(report.cost_usd, 0.00006);
  assert.match(formatScore(report), /FAIL {4}b .*\n {8}failed: filler \(0\.03\); unsure: has_number \(0\.5\)\nREVIEW {2}c[\s\S]*4 scored with typesafe\/jev-1\.13-dated: 1 passed, 1 to review, 1 failed, 1 with no question/);
});

test("readItems: lines, lists, a script and a carousel project", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-score-"));
  await writeFile(path.join(dir, "hooks.txt"), "First hook\n\n  Second hook  \n");
  assert.deepEqual(await readItems(path.join(dir, "hooks.txt")), [{ kind: "hook", text: "First hook", id: "hook-1" }, { kind: "hook", text: "Second hook", id: "hook-2" }]);
  await writeFile(path.join(dir, "items.jsonl"), '"A line"\n{"id":"x","kind":"cover","text":"A cover"}\n');
  assert.deepEqual((await readItems(path.join(dir, "items.jsonl"), { kind: "slide" })).map((item) => [item.id, item.kind]), [["slide-1", "slide"], ["x", "cover"]]);
  await writeFile(path.join(dir, "bad.json"), "[{}]");
  await assert.rejects(readItems(path.join(dir, "bad.json")), /item 1 needs text/);

  const project = path.join(dir, "project");
  await mkdir(project);
  await copyFile(path.join(ROOT, "examples/carousel/listicle-4x5/storyboard.json"), path.join(project, "storyboard.json"));
  await writeFile(path.join(project, "SCRIPT.json"), JSON.stringify({ narration: "Close the books in a day. Here is how." }));
  const items = await readItems(project);
  assert.equal(items[0].kind, "cover");
  assert.ok(items.some((item) => item.kind === "slide"));
  assert.deepEqual(items.slice(-2), [{ id: "hook", kind: "hook", text: "Close the books in a day." }, { id: "script", kind: "script", text: "Close the books in a day. Here is how." }]);
});

test("launchclip score: readable output, --passed, --out, and exit 1 on a failure", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-score-cli-"));
  await writeFile(path.join(dir, "hooks.txt"), "3 fixes for slow builds\nHey guys, 5 tips\n");
  await writeFile(path.join(dir, "rubric.json"), JSON.stringify(RUBRIC));
  const out = [];
  const io = { stdout: { write: (value) => out.push(value) }, stderr: { write: () => {} }, fetch: fakeFetch() };
  const before = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";
  try {
    await assert.rejects(runCli(["score", path.join(dir, "hooks.txt"), "--rubric", path.join(dir, "rubric.json"), "--passed", path.join(dir, "passed.txt"), "--out", path.join(dir, "report.json")], io), /1 of 2 failed the rubric/);
    assert.match(out.join(""), /FAIL {4}hook-2/);
    assert.equal(await readFile(path.join(dir, "passed.txt"), "utf8"), "3 fixes for slow builds\n");
    assert.equal(JSON.parse(await readFile(path.join(dir, "report.json"), "utf8")).counts.failed, 1);
    await assert.rejects(runScore(path.join(dir, "hooks.txt"), {}), /needs a rubric/);
  } finally {
    if (before === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = before;
  }
});

test("ask retries a call that never answers, then says so", async () => {
  const { ask } = await import("../src/scorer.js");
  let calls = 0;
  const fetch = async () => { calls += 1; throw new Error("timed out"); };
  await assert.rejects(ask({ state: { text: "x" }, questions: { q: { type: "noul", instructions: "?" } }, apiKey: "k", fetch, sleep: async () => {} }), /did not answer: timed out/);
  assert.equal(calls, 3);
});
