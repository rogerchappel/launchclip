// Regression tests for the beat director's module choices, from clauses of a
// real long-form script (written inline; the script itself is not in the repo).
import assert from "node:assert/strict";
import test from "node:test";
import { extractFacts, visualKind } from "../kit/core/beat-director.mjs";

const kind = (text) => visualKind({ text, facts: extractFacts(text) });

test("picks: a status code or a PR number is not a figure", () => {
  assert.deepEqual(extractFacts("That repository now returns a 404 page.").numbers, []);
  assert.deepEqual(extractFacts("On October 16, pull request 39217 was merged.").numbers, []);
  assert.deepEqual(extractFacts("It scored 404 points in total.").numbers.map((entry) => entry.value), [404]);
});

test("picks: a list keeps its noun phrases and wins over its words", () => {
  const text = "The answer runs through a leak, a price sheet and a rival that has been quietly winning.";
  assert.deepEqual(extractFacts(text).items, ["leak", "price sheet", "rival"]);
  assert.equal(kind(text), "list");
});
