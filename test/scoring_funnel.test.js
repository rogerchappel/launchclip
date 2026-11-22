// The hook funnel (src/scoring/funnel.js) against a stand-in writing client
// and a stand-in for the hosted decision model: no network, no key.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { assembleHooks, parseHookParts, shortlist, writeHooks } from "../src/scoring/funnel.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const PARTS = {
  openers: ["{number} mistakes {audience} make with {topic}", "{audience}: {topic} can {payoff}", "why {topic} matters"],
  audiences: ["new runners", "founders"],
  numbers: [3, 5, 7],
  topics: ["pacing", "sleep"],
  payoffs: ["save you an hour a day", "cut your costs"]
};

// Writes `per` hooks a batch, numbered by batch, plus one line every batch repeats.
function fakeWriter(calls = [], { per = 5, failOn = () => false } = {}) {
  return {
    async runStructured(request) {
      const batch = calls.push(request) - 1;
      if (failOn(batch)) throw new Error(`batch ${batch} refused`);
      return { value: { hooks: [...Array.from({ length: per - 1 }, (_, index) => `Batch ${batch}   hook ${index + 1} about ${request.input.split("\n")[0]}`), "The Same line every time"] } };
    }
  };
}

test("writeHooks asks in parallel batches with a different slant each, and drops exact duplicates", async () => {
  const calls = [];
  const hooks = await writeHooks({ topic: "sourdough", brief: "For home bakers.", count: 12, batchSize: 5, client: fakeWriter(calls) });
  assert.equal(calls.length, 3);
  assert.equal(new Set(calls.map((call) => call.instructions)).size, 3, "each batch has its own instructions");
  assert.ok(calls.every((call) => call.input.includes("Topic: sourdough") && call.input.includes("For home bakers.") && call.schemaName && call.schema));
  // 3 batches of 4 distinct lines plus one shared line: 13 distinct, cut to 12.
  assert.equal(hooks.length, 12);
  assert.equal(hooks.filter((hook) => /same line/i.test(hook.text)).length, 1);
  assert.deepEqual(hooks[0], { id: "written-1", kind: "hook", text: "Batch 0 hook 1 about Topic: sourdough", source: "written" });
  assert.equal(new Set(hooks.map((hook) => hook.id)).size, 12);
});

test("writeHooks keeps going past a failed batch and throws when every batch fails", async () => {
  const errors = [];
  const hooks = await writeHooks({ topic: "t", count: 15, batchSize: 5, client: fakeWriter([], { failOn: (batch) => batch === 1 }), onBatchError: (error, index) => errors.push(index) });
  assert.equal(hooks.length, 9);
  assert.deepEqual(errors, [1]);
  await assert.rejects(writeHooks({ topic: "t", count: 10, batchSize: 5, client: fakeWriter([], { failOn: () => true }) }), /refused/);
  await assert.rejects(writeHooks({ topic: " ", count: 10, client: fakeWriter() }), /needs a topic/);
  await assert.rejects(writeHooks({ topic: "t", count: 10, model: "" }), /writing model/);
});

test("assembleHooks fills templates by seed, without repeats, the same way every time", async () => {
  const hooks = assembleHooks({ parts: PARTS, count: 10, seed: "a" });
  assert.equal(hooks.length, 10);
  assert.equal(new Set(hooks.map((hook) => hook.text)).size, 10);
  assert.ok(hooks.every((hook) => hook.kind === "hook" && hook.source === "assembled" && !/[{}]/.test(hook.text) && /^[A-Z0-9]/.test(hook.text)));
  assert.deepEqual(assembleHooks({ parts: PARTS, count: 10, seed: "a" }), hooks);
  assert.notDeepEqual(assembleHooks({ parts: PARTS, count: 10, seed: "b" }).map((hook) => hook.text), hooks.map((hook) => hook.text));
  // 3*2*2 + 2*2*2 + 2 = 22 distinct texts are all these parts can make.
  assert.equal(assembleHooks({ parts: PARTS, count: 500, seed: "a" }).length, 22);
  const example = JSON.parse(await readFile(path.join(ROOT, "docs/guide/scoring-hook-parts.json"), "utf8"));
  assert.equal(assembleHooks({ parts: example, count: 200, seed: 1 }).length, 200);
});

test("parseHookParts names an unknown slot and an empty list", () => {
  assert.throws(() => parseHookParts({ openers: [] }), /at least one template/);
  assert.throws(() => parseHookParts({ openers: ["{who} and {number}"], numbers: [] }), (error) => error.message.includes("{who}") && error.message.includes("numbers is empty"));
  assert.throws(() => parseHookParts({ openers: "x" }), /openers must be a list/);
});

// A scored item as scoreItems reports it. Texts share no content words unless a test wants them to.
const WORDS = ["apple", "bridge", "candle", "dolphin", "engine", "forest", "guitar", "harbor", "island", "jacket", "kettle", "ladder", "marble", "needle", "orchid", "pencil"];
function scored(index, type, { p = 0.9, unsure = [], status = unsure.length ? "review" : "passed", text } = {}) {
  return { id: `h${index}`, kind: "hook", text: text ?? `${WORDS[index]} ${WORDS[index]}s ${index}${index}`, status, failed: status === "failed" ? ["q"] : [], unsure, tags: { hook_type: type }, answers: { q: { status: "pass", value: p, p }, hook_type: { status: "tag", value: type } } };
}

test("shortlist keeps a quota per type, preferring sure answers and then the higher pass probability", () => {
  const items = [
    scored(0, "number", { p: 0.75 }),
    scored(1, "number", { p: 0.99 }),
    scored(2, "number", { p: 0.8 }),
    scored(3, "number", { p: 0.97, unsure: ["q"] }),
    scored(4, "question", { p: 0.71 }),
    scored(5, "number", { status: "failed", p: 0.1 })
  ];
  const { picked, dropped } = shortlist(items, { perType: 2, wildcards: 0 });
  assert.deepEqual(picked.map((item) => item.id), ["h1", "h2", "h4"]);
  assert.deepEqual(picked.map((item) => item.type), ["number", "number", "question"]);
  assert.ok(picked.every((item) => !("wildcard" in item)));
  assert.deepEqual(dropped, { failed: ["h5"], near_recent: [], near_duplicate: [], over_quota: ["h0", "h3"] });
  // The overall top three would all be "number"; the quota is what lets the question in.
  assert.equal(shortlist(items, { perType: 1, wildcards: 0 }).picked.length, 2);
});

test("shortlist marks seeded wildcards, taken from what the quota left out", () => {
  const items = Array.from({ length: 10 }, (_, index) => scored(index, "number", { p: 0.99 - index / 100 }));
  const first = shortlist(items, { perType: 2, wildcards: 2, seed: "s1" });
  assert.deepEqual(first.picked.slice(0, 2).map((item) => item.id), ["h0", "h1"]);
  const wild = first.picked.filter((item) => item.wildcard === true);
  assert.equal(wild.length, 2);
  assert.ok(wild.every((item) => !["h0", "h1"].includes(item.id) && item.status !== "failed"));
  assert.equal(first.dropped.over_quota.length, 6);
  assert.deepEqual(shortlist(items, { perType: 2, wildcards: 2, seed: "s1" }), first);
  const seeds = new Set(["s1", "s2", "s3", "s4", "s5"].map((seed) => shortlist(items, { perType: 2, wildcards: 2, seed }).picked.filter((item) => item.wildcard).map((item) => item.id).join()));
  assert.ok(seeds.size > 1, "another seed draws other wildcards");
});

test("shortlist drops hooks close to recent posts and near-duplicates of a picked hook", () => {
  const items = [
    scored(0, "number", { text: "Five pacing mistakes new runners make every single week" }),
    scored(1, "question", { text: "Five pacing mistakes new runners make every week", p: 0.8 }),
    scored(2, "story", { text: "My sourdough starter died twice before this trick" }),
    scored(3, "story", { text: "Cold water swimming changed my mornings" })
  ];
  const { picked, dropped } = shortlist(items, { recent: ["My sourdough starter died twice before I learned this trick"], wildcards: 2 });
  assert.deepEqual(picked.map((item) => item.id), ["h0", "h3"]);
  assert.deepEqual(dropped, { failed: [], near_recent: ["h2"], near_duplicate: ["h1"], over_quota: [] });
  // A looser limit lets both through.
  assert.equal(shortlist(items, { recent: ["My sourdough starter died twice before I learned this trick"], similarityLimit: 1.01 }).picked.length, 4);
});
