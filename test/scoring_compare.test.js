// Formats across industries (src/scoring/compare.js) against a stand-in for
// the hosted decision model: no network, no key, no real posts.
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_SCORER_MODEL, parseRubric } from "../src/scorer.js";
import { compareNiches, formatCompare, formatWorthTesting, loadFormatRubric, runCompare, tagFormats } from "../src/scoring/compare.js";

const RUBRIC = parseRubric({ questions: { fmt_opening: { type: "choice", gate: false, instructions: "How does it open?", criteria: { question: "Asks a question.", number: "Opens on a number.", other_unclear: "Neither." } } } });

// Answers "question" when the words hold a "?", else "number", at 1 cent a request.
const fakeModel = (calls = []) => async (url, init) => {
  const body = JSON.parse(init.body);
  calls.push(body);
  const answers = Object.fromEntries(Object.keys(body.questions).map((key) => [key, { type: "choice", choice: body.state.join("\n").includes("?") ? "question" : "number", probabilities: {} }]));
  return new Response(JSON.stringify({ answers, model: body.model, usage: { cost: 0.01 } }));
};

test("the shared format rubric parses, is all choice tags and always offers a way out", async () => {
  const rubric = await loadFormatRubric();
  const questions = Object.values(rubric.questions);
  assert.ok(questions.length >= 5 && questions.length <= 7);
  for (const question of questions) {
    assert.equal(question.type, "choice");
    assert.equal(question.allow, undefined);
    assert.ok("other_unclear" in question.criteria);
  }
});

test("tagFormats tags the words, skips rows with no words or every tag, and keeps other tags", async () => {
  const calls = [];
  const rows = [
    { id: "1", caption: "Ready?", transcript: "Three things", tags: { hook_type: "story" } },
    { id: "2", media: "https://cdn.example.com/2.mp4" },
    { id: "3", caption: "Done already", tags: { fmt_opening: "other_unclear" } },
    { id: "4", transcript: "5 tips" }
  ];
  const { rows: tagged, cost_usd: cost } = await tagFormats(rows, { rubric: RUBRIC, apiKey: "k", fetch: fakeModel(calls), concurrency: 1 });
  assert.equal(calls.length, 2);
  assert.equal(cost, 0.02);
  assert.equal(calls[0].model, DEFAULT_SCORER_MODEL);
  assert.deepEqual(calls[0].state, ["Caption:\nReady?", "Words on screen or spoken:\nThree things"]);
  assert.deepEqual(tagged.map((row) => row.tags), [{ hook_type: "story", fmt_opening: "question" }, undefined, { fmt_opening: "other_unclear" }, { fmt_opening: "number" }]);
  assert.equal(tagged[1], rows[1]);
  assert.equal(tagged[0].outlier, undefined);
  // A second run has nothing left to ask.
  const again = await tagFormats(tagged, { rubric: RUBRIC, apiKey: "k", fetch: async () => { throw new Error("asked again"); } });
  assert.deepEqual(again, { rows: tagged, cost_usd: 0 });
});

// n posts with one tag value, every one at the same outlier.
const posts = (n, value, outlier, extra = {}) => Array.from({ length: n }, (_, i) => ({ url: `https://example.com/${value}/${i}`, account: "acct", caption: `${value} post ${i}`, outlier, tags: { fmt_opening: value, ...extra } }));

test("compareNiches keeps values that lift results in A and are rare in B, highest lift first", () => {
  const a = { name: "a", rows: [
    ...posts(50, "plain", 1),
    ...posts(10, "strong_rare", 2),
    ...posts(10, "strong_common", 3),
    ...posts(7, "too_few", 5),
    ...posts(10, "weak", 1.1),
    ...posts(9, "strongest", 3), { url: "https://example.com/top", account: "top", caption: `Top\n post ${"x".repeat(200)}`, outlier: 9, tags: { fmt_opening: "strongest" } },
    ...posts(3, "plain", null)
  ] };
  const b = { name: "b", rows: [...posts(70, "plain", 1), ...posts(4, "strong_rare", 1), ...posts(20, "strong_common", 1), ...posts(6, "strongest", 1)] };
  const found = compareNiches(a, b);
  // strong_common is as common in B, too_few has under 8 posts, weak lifts under 1.25,
  // and strongest is 6% of B: over rareShare and not under a third of A's 10%.
  assert.deepEqual(found.map((candidate) => candidate.value), ["strong_rare"]);
  assert.deepEqual(found[0], { question: "fmt_opening", value: "strong_rare", a: { posts: 10, share: 0.1, median_outlier: 2, lift: 2 }, b: { posts: 4, share: 0.04 }, examples: found[0].examples });
  // Looser rules let the rest in, sorted by lift.
  const loose = compareNiches(a, b, { minPosts: 7, rareShare: 0.25 });
  assert.deepEqual(loose.map((candidate) => [candidate.value, candidate.a.lift]), [["too_few", 5], ["strong_common", 3], ["strongest", 3], ["strong_rare", 2]]);
  const { examples } = loose.find((candidate) => candidate.value === "strongest");
  assert.equal(examples.length, 3);
  assert.deepEqual([examples[0].url, examples[0].account, examples[0].outlier], ["https://example.com/top", "top", 9]);
  assert.ok(examples[0].words.startsWith("Top post x") && examples[0].words.length === 120);
});

test("compareNiches calls a value rare at under a third of A's share, and skips tags B was never given", () => {
  const a = { name: "a", rows: [...posts(20, "plain", 1, { own_tag: "x" }), ...posts(20, "big", 2, { own_tag: "y" })] };
  const b = { name: "b", rows: [...posts(85, "plain", 1), ...posts(15, "big", 1)] };
  // 15% in B is over rareShare but under a third of A's 50%. own_tag=y lifts too, but B has no own_tag.
  assert.deepEqual(compareNiches(a, b).map((candidate) => `${candidate.question}=${candidate.value}`), ["fmt_opening=big"]);
  assert.deepEqual(compareNiches(a, { name: "b", rows: [...posts(80, "plain", 1), ...posts(20, "big", 1)] }), []);
  assert.deepEqual(compareNiches({ name: "empty", rows: [] }, b), []);
});

test("formatWorthTesting writes one entry a candidate, and one line when there are none", () => {
  const none = formatWorthTesting([], { from: "cooking", to: "cycling" });
  assert.equal(none, "## Worth testing here\n\nNothing stood out: no format that goes with above-normal results in cooking is rare in cycling.\n");
  const candidate = { question: "fmt_opening", value: "number", a: { posts: 12, share: 0.2, median_outlier: 1.8, lift: 1.6 }, b: { posts: 1, share: 0.003 }, examples: [{ url: "https://example.com/1", account: "chef", outlier: 4.2, words: "5 knives" }, { account: "nolink", outlier: 2, words: "" }] };
  const text = formatWorthTesting([candidate], { from: "cooking", to: "cycling", rubric: RUBRIC });
  assert.match(text, /^## Worth testing here\n/);
  assert.match(text, /- \*\*fmt_opening: number\*\*\. Opens on a number\. In cooking: 12 posts \(20%\), with a median of 1\.8x their own account's normal, 1\.6 times the median for that library\. In cycling: 1 post \(under 1%\)\. Examples: \[@chef at 4\.2x\]\(https:\/\/example\.com\/1\), @nolink at 2x\./);
  assert.match(text, /None of these has been tested in cycling\./);
  assert.equal(text.split("\n").filter((line) => line.startsWith("- ")).length, 1);
});

test("runCompare tags an untagged library, writes the tags back and prints the candidates", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-compare-"));
  const write = (name, rows) => writeFile(path.join(dir, name), `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  const bare = (n, caption, outlier) => Array.from({ length: n }, (_, i) => ({ id: `${caption}${i}`, platform: "tiktok", account: "a", url: `https://example.com/${i}`, caption, outlier, metrics: {} }));
  await write("cooking.jsonl", [...bare(10, "Ready?", 2), ...bare(30, "5 tips", 1)]);
  await write("cycling.jsonl", posts(50, "number", 1));
  await write("rubric.json", [{ questions: RUBRIC.questions }]);
  const files = [path.join(dir, "cooking.jsonl"), path.join(dir, "cycling.jsonl")];
  const calls = [];
  let out = "";
  const stdout = { write: (text) => { out += text; } };
  const result = await runCompare(files, { rubric: path.join(dir, "rubric.json") }, { stdout, fetch: fakeModel(calls), apiKey: "k" });
  assert.equal(calls.length, 40);
  assert.deepEqual([result.a.name, result.a.tagged, result.b.name, result.b.tagged, result.cost_usd], ["cooking", 40, "cycling", 50, 0.4]);
  assert.deepEqual(result.candidates.map((candidate) => candidate.value), ["question"]);
  assert.equal(out, formatCompare({ ...result, rubric: RUBRIC }));
  assert.match(out, /^Compared cooking \(40 posts, 40 with format tags\) with cycling \(50 posts, 50 with format tags\)\. Tagging cost \$0\.4\.\n\n## Worth testing here/);
  const saved = (await readFile(files[0], "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(saved[0].tags.fmt_opening, "question");
  // No temp file is left behind.
  assert.deepEqual((await readdir(dir)).sort(), ["cooking.jsonl", "cycling.jsonl", "rubric.json"]);
  // Tagged now: a second run asks nothing, and --json prints the result.
  out = "";
  const again = await runCompare(files, { rubric: path.join(dir, "rubric.json"), json: true }, { stdout, fetch: async () => { throw new Error("asked again"); } });
  assert.deepEqual(JSON.parse(out), again);
  assert.equal(again.cost_usd, 0);
  await assert.rejects(runCompare(["only-one.jsonl"]), /usage: launchclip score library compare/);
});
