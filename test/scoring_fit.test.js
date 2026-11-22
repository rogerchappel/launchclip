// The fitted layer (src/scoring/fit.js) on synthetic libraries: a seeded random
// source, no network, no real posts.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { explain, featurise, fit, foldsFor, predict, runFit, spearman } from "../src/scoring/fit.js";

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Posts where `strong_open` (and a "number" hook, a little) drives the outlier.
// signal 0 makes the outlier pure noise.
function library(count, { seed = 7, signal = 1, accounts = 20 } = {}) {
  const random = seeded(seed);
  const normal = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
  return Array.from({ length: count }, (_, index) => {
    const strong = random();
    const hook = ["question", "number", "story"][Math.floor(random() * 3)];
    const answers = {
      strong_open: { status: "pass", value: strong, p: strong },
      filler: { status: "pass", value: random(), p: 0.5 },
      clarity: random() < 0.1 ? { status: "unsure", value: null, p: null } : { status: "tag", value: Math.floor(random() * 3) },
      hook_type: { status: "tag", value: index < 3 ? "riddle" : hook }
    };
    const outlier = Math.exp(signal * (1.5 * (strong - 0.5) + (hook === "number" ? 0.4 : 0)) + 0.6 * normal());
    return { id: `post-${index}`, platform: "youtube", account: `account-${index % accounts}`, metrics: { views: 1000 }, tags: { hook_type: answers.hook_type.value }, answers, outlier };
  });
}

test("featurise: one column per number, one-hot choices with rare values folded, is-missing only when common", () => {
  const rows = library(100);
  const { schema, X, ids } = featurise(rows);
  assert.deepEqual(schema.columns.map((column) => column.name), ["clarity", "clarity:missing", "filler", "hook_type=number", "hook_type=question", "hook_type=story", "hook_type=(other)", "strong_open"]);
  assert.equal(X.length, 100);
  assert.equal(ids[4], "post-4");
  const at = (name) => schema.columns.findIndex((column) => column.name === name);
  assert.equal(X[0][at("hook_type=(other)")], 1, "a value seen 3 times is folded");
  assert.equal(X[0][at("hook_type=story")], 0);
  const missing = rows.findIndex((row) => row.answers.clarity.value === null);
  assert.equal(X[missing][at("clarity:missing")], 1);
  assert.equal(X[missing][at("clarity")], schema.columns[at("clarity")].fill, "a missing number takes the column mean");
});

test("featurise: a saved schema gives new items the same columns", () => {
  const { schema } = featurise(library(100));
  const saved = JSON.parse(JSON.stringify(schema));
  const items = [
    { id: "draft", answers: { strong_open: { value: 0.9 }, hook_type: { value: "never seen" }, extra: { value: 1 } } },
    { id: "tags-only", tags: { hook_type: "number" } }
  ];
  const { X, schema: used } = featurise(items, saved);
  assert.deepEqual(used, schema);
  const row = (index) => Object.fromEntries(schema.columns.map((column, at) => [column.name, X[index][at]]));
  assert.equal(row(0).strong_open, 0.9);
  assert.equal(row(0)["hook_type=(other)"], 1, "an unseen value counts as other");
  assert.equal(row(0)["clarity:missing"], 1);
  assert.equal(row(0).filler, schema.columns.find((column) => column.name === "filler").fill);
  assert.equal(row(1)["hook_type=number"], 1, "a tag is read when there is no answer");
  assert.throws(() => featurise(items, {}), /schema has no columns/);
});

test("fit: recovers a known driver and is usable at 400 rows", () => {
  const model = fit(library(400), { seed: 3 });
  const coefficient = (name) => model.coefficients[model.schema.columns.findIndex((column) => column.name === name)];
  assert.ok(coefficient("strong_open") > 0.2, `strong_open should push results up; got ${coefficient("strong_open")}`);
  assert.ok(coefficient("hook_type=number") > 0);
  assert.ok(Math.abs(coefficient("filler")) < coefficient("strong_open") / 3);
  assert.equal(model.usable, true, model.reasons.join("; "));
  assert.deepEqual(model.reasons, []);
  assert.equal(model.target, "log_outlier");
  assert.equal(model.trained_on, 400);
  const { spearman: rho, spearman_ci: [low, high], top_quartile_lift: lift, baseline_spearman: baseline, split } = model.held_out;
  assert.ok(low > 0 && low <= rho && rho <= high && rho > baseline);
  assert.ok(lift > 1.2, `the predicted top quarter should beat the median; got ${lift}`);
  assert.equal(split, "account");
  assert.deepEqual(JSON.parse(JSON.stringify(model)), model, "the model is plain JSON");
  assert.deepEqual(fit(library(400), { seed: 3 }), model, "the same seed gives the same model");
});

test("fit: pure noise is not usable, and says why", () => {
  for (const seed of [11, 12, 13]) {
    const model = fit(library(400, { seed, signal: 0 }), { seed });
    assert.equal(model.usable, false, `seed ${seed}: ${JSON.stringify(model.held_out)}`);
    assert.match(model.reasons.join("; "), /chance|shuffled/);
  }
});

test("fit: fewer than 200 rows is not usable whatever the signal", () => {
  const rows = [...library(150), { id: "too-new", account: "account-1", answers: {}, outlier: null }, { id: "no-views", account: "account-1", answers: {}, outlier: 0 }];
  const model = fit(rows);
  assert.equal(model.trained_on, 150, "rows with no usable outlier are left out");
  assert.equal(model.usable, false);
  assert.match(model.reasons[0], /only 150 posts with results: at least 200 are needed/);
  assert.throws(() => fit(library(6)), /at least 10 rows/);
});

test("fit: whole accounts share a fold when there are enough of them", () => {
  const rows = library(200, { accounts: 9 });
  const { fold, split } = foldsFor(rows, 5, 2);
  assert.equal(split, "account");
  const byAccount = new Map();
  rows.forEach((row, index) => byAccount.set(row.account, (byAccount.get(row.account) ?? new Set()).add(fold[index])));
  for (const [account, used] of byAccount) assert.equal(used.size, 1, `${account} is split across folds`);
  assert.equal(new Set(fold).size, 5);

  const few = foldsFor(library(200, { accounts: 3 }), 5, 2);
  assert.equal(few.split, "row");
  assert.deepEqual([0, 1, 2, 3, 4].map((id) => few.fold.filter((value) => value === id).length), [40, 40, 40, 40, 40]);
  assert.equal(fit(library(240, { accounts: 3 })).held_out.split, "row");
});

test("fit: constant and duplicated columns, weights and ties do not break the maths", () => {
  const rows = library(240).map((row) => ({ ...row, own: row.account === "account-0", answers: { ...row.answers, always: { value: 1 }, copy: { value: row.answers.strong_open.value } } }));
  const model = fit(rows, { lambda: 0, weights: (row) => (row.own ? 5 : 1) });
  const coefficient = (name) => model.coefficients[model.schema.columns.findIndex((column) => column.name === name)];
  assert.ok(model.coefficients.every(Number.isFinite));
  assert.equal(coefficient("always"), 0);
  assert.ok(coefficient("strong_open") + coefficient("copy") > 0.2);
  assert.equal(model.lambda, 0);
  assert.throws(() => fit(rows, { weights: () => 0 }), /above 0/);

  assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
  assert.equal(spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1);
  assert.equal(spearman([1, 1, 1], [1, 2, 3]), 0, "a constant side has no rank correlation");
  assert.ok(Math.abs(spearman([1, 2, 2, 3], [1, 2, 3, 4]) - 0.9487) < 1e-4, "ties share their average rank");
});

const draft = (id, strong, hook) => ({ id, kind: "hook", text: id, answers: { strong_open: { value: strong }, filler: { value: 0.5 }, clarity: { value: 1 }, hook_type: { value: hook } } });

test("predict: ranks drafts by the driver, and refuses a model that is not usable unless forced", () => {
  const model = JSON.parse(JSON.stringify(fit(library(400), { seed: 3 })));
  const [strong, weak] = predict(model, { items: [draft("strong", 0.95, "number"), draft("weak", 0.05, "story")] });
  assert.equal(strong.id, "strong");
  assert.ok(strong.predicted_outlier > 1 && weak.predicted_outlier < 1, JSON.stringify([strong, weak]));
  assert.ok(strong.percentile > 80 && weak.percentile < 20);
  assert.equal(predict(model, library(400)).filter((row) => row.percentile >= 50).length > 150, true, "percentiles are against the training library");

  const noise = fit(library(120, { signal: 0 }));
  assert.throws(() => predict(noise, [draft("a", 0.5, "story")]), /not usable.*only 120 posts.*force/s);
  assert.equal(predict(noise, [draft("a", 0.5, "story")], { force: true }).length, 1);
  assert.throws(() => predict({ version: 99 }, []), /not a fitted model/);
});

test("explain: the driver comes first, with its direction, and the associations caveat", () => {
  const { note, features } = explain(fit(library(400), { seed: 3 }), { top: 3 });
  assert.match(note, /associations in this library, not causes/);
  assert.equal(features.length, 3);
  assert.deepEqual({ key: features[0].key, direction: features[0].direction }, { key: "strong_open", direction: "above" });
  assert.equal(features[0].text, "a higher strong_open goes with above-normal results");
  const number = explain(fit(library(400), { seed: 3 })).features.find((feature) => feature.feature === "hook_type=number");
  assert.equal(number.text, 'hook_type being "number" goes with above-normal results');
});

test("runFit: fit prints the held-out numbers and saves the model; predict sorts items by prediction", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-fit-"));
  const file = (name) => path.join(dir, name);
  const out = [];
  const io = { write: (text) => out.push(text) };
  await writeFile(file("library.tagged.jsonl"), `${library(400).map((row, index) => JSON.stringify({ ...row, own: index % 10 === 0 })).join("\n")}\n\n`);
  const model = await runFit("fit", file("library.tagged.jsonl"), { out: file("model.json"), "own-weight": "3", seed: "3" }, io);
  assert.equal(model.usable, true);
  assert.deepEqual(JSON.parse(await readFile(file("model.json"), "utf8")), model);
  assert.match(out.join(""), /Fitted on 400 posts.*rank correlation 0\.\d+ \(95% range .*Usable: it beats chance.*Top features:\n {2}\+0\.\d+ {2}a higher strong_open.*associations in this library, not causes.*Saved /s);

  await writeFile(file("scored.json"), JSON.stringify({ stage: "score", items: [draft("weak", 0.05, "story"), draft("strong", 0.95, "number")] }));
  out.length = 0;
  const predictions = await runFit("predict", file("scored.json"), { model: file("model.json") }, io);
  assert.deepEqual(predictions.map((row) => row.id), ["strong", "weak"]);
  assert.match(out[0], /^\d\.\d\dx {2}top \d+% {2}strong {2}strong\n$/);

  await writeFile(file("small.jsonl"), library(60).map((row) => JSON.stringify(row)).join("\n"));
  out.length = 0;
  await runFit("fit", file("small.jsonl"), { out: file("small.json") }, io);
  assert.match(out.join(""), /Not usable:\n- only 60 posts with results/);
  await assert.rejects(runFit("predict", file("scored.json"), { model: file("small.json") }, io), /not usable/);
  out.length = 0;
  assert.equal((await runFit("predict", file("scored.json"), { model: file("small.json"), force: true }, io)).length, 2);
  assert.match(out[0], /guesses/);

  await writeFile(file("broken.jsonl"), '{"id": 1}\n{oops\n');
  await assert.rejects(runFit("fit", file("broken.jsonl"), {}, io), /line 2 is not valid JSON/);
  await assert.rejects(runFit("fit", file("library.tagged.jsonl"), { "own-weight": "lots" }, io), /--own-weight must be a number/);
  await assert.rejects(runFit("predict", file("scored.json"), {}, io), /needs --model/);
  await assert.rejects(runFit("train", file("scored.json"), {}, io), /usage:/);
});
