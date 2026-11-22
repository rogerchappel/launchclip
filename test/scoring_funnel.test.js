// The hook funnel (src/scoring/funnel.js) against a stand-in writing client
// and a stand-in for the hosted decision model: no network, no key.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { assembleHooks, parseHookParts, writeHooks } from "../src/scoring/funnel.js";

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
