// Regression tests for the beat director's module choices, from clauses of a
// real long-form script (written inline; the script itself is not in the repo).
import assert from "node:assert/strict";
import test from "node:test";
import { entityAliases, extractFacts, matchEvidence, visualKind } from "../kit/core/beat-director.mjs";

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

// A small ledger shaped like research/evidence.json: claims with entities, a
// generic launch claim whose capture (a changelog) shares the model's name.
const source = (url, title) => ({ url, title, primary: true, confidence: 0.9, supports: true, fetched_at: "2026-10-27T00:00:00Z", quote: { text: title } });
const LEDGER = {
  schema: "launchclip.evidence.v1",
  claims: [
    { id: "pr", kind: "number", status: "verified", text: "On October 16, 2026, pull request 39217 was merged in dotnet/efcore.", entities: [{ name: "dotnet/efcore", kind: "repo" }], sources: [source("https://github.com/dotnet/efcore/pull/39217", "dotnet/efcore#39217")] },
    { id: "commit", kind: "entity", status: "unverified", text: "A GitHub engineer made a commit in natefinch/council4 that moved Copilot's production code reviews to GPT-6.1 Terra.", entities: [{ name: "natefinch/council4", kind: "repo" }, { name: "GPT-6.1", kind: "model" }, { name: "Terra", kind: "name" }], sources: [] },
    { id: "launch", kind: "date", status: "verified", capture: "changelog", text: "On October 26, 2026, OpenAI announced GPT-6.1 Terra.", entities: [{ name: "GPT-6.1", kind: "model" }, { name: "Terra", kind: "name" }], sources: [source("https://github.blog/changelog", "Changelog")] },
    { id: "copilot", kind: "date", status: "verified", capture: "changelog", text: "GPT-6.1 Terra came to GitHub Copilot on October 26, 2026.", entities: [{ name: "GPT-6.1", kind: "model" }, { name: "Terra", kind: "name" }], sources: [source("https://github.blog/changelog", "Changelog")] },
    { id: "tb4", kind: "number", status: "verified", text: "On Terminal-Bench 4.0, Terra scores 50.3%, up from 21.5% for GPT-5.6 Terra.", entities: [{ name: "Terminal-Bench 4.0", kind: "benchmark" }, { name: "Terra", kind: "name" }], sources: [source("https://example.com/tb4", "TB4")] },
    { id: "tbs", kind: "entity", status: "verified", capture: "explainer", text: "On Terminal-Bench-Science, Terra beats GPT-6.1 Sol at lower cost.", entities: [{ name: "Terminal-Bench-Science", kind: "benchmark" }, { name: "GPT-6.1", kind: "model" }, { name: "Terra", kind: "name" }], sources: [source("https://example.com/tbs", "TBS")] }
  ]
};
const CAPTURES = [{ id: "changelog", kind: "article", url: "https://github.blog/changelog" }, { id: "explainer", kind: "article", url: "https://example.com/tbs" }];
const NARRATION = ["Ten days before OpenAI said a word, a model called GPT-6.1 Terra was already grading code inside a Microsoft repository.", "Start with dotnet/efcore, the open source repository behind Entity Framework, Microsoft's data library for .NET.", "On Terminal-Bench-Science, OpenAI reports Terra beating GPT-6.1 Sol while costing less."]
  .join(" ").split(" ").map((text, i) => ({ text, start: i * 0.4, end: i * 0.4 + 0.3 }));
const beat = (text) => ({ text, facts: extractFacts(text) });

test("picks: the narration names a repo's owner, and the clause finds the repo's claim", () => {
  const aliases = entityAliases(LEDGER, NARRATION);
  assert.ok(aliases.get("dotnet/efcore")?.has("microsoft"), JSON.stringify([...aliases]));
  const cold = "Ten days before OpenAI said a word, a model called GPT-6.1 Terra was already grading code inside a Microsoft repository.";
  assert.equal(matchEvidence(beat(cold), { ledger: LEDGER, captures: CAPTURES, aliases })?.claim, "pr");
});

test("picks: a named benchmark beats the model's name shared by every claim", () => {
  const hit = matchEvidence(beat("On Terminal-Bench-Science, OpenAI reports Terra beating GPT-6.1 Sol while costing less."), { ledger: LEDGER, captures: CAPTURES });
  assert.equal(hit.claim, "tbs");
  assert.equal(hit.capture.id, "explainer");
  // A claim about another benchmark loses for naming a different one.
  assert.equal(matchEvidence(beat("On Terminal-Bench 4.0, Terra scores 50.3%."), { ledger: LEDGER, captures: CAPTURES }).claim, "tb4");
});

test("picks: a capture shown within the last minute weighs against its claim", () => {
  const text = "GPT-6.1 Terra came to GitHub Copilot on October 26.";
  assert.equal(matchEvidence(beat(text), { ledger: LEDGER, captures: CAPTURES })?.claim, "copilot");
  const after = matchEvidence(beat(text), { ledger: LEDGER, captures: CAPTURES, at: 40, played: { changelog: 10 } });
  const later = matchEvidence(beat(text), { ledger: LEDGER, captures: CAPTURES, at: 200, played: { changelog: 10 } });
  assert.ok(after === null || after.score < later.score, JSON.stringify({ after, later }));
});
