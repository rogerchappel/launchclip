// The fitted layer (src/scoring/fit.js) on synthetic libraries: a seeded random
// source, no network, no real posts.
import assert from "node:assert/strict";
import test from "node:test";
import { featurise } from "../src/scoring/fit.js";

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
