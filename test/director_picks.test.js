// Regression tests for the beat director's module choices, from clauses of a
// real long-form script (written inline; the script itself is not in the repo).
import assert from "node:assert/strict";
import test from "node:test";
import { entityAliases, extractFacts, matchEvidence, pairSeries, visualKind } from "../kit/core/beat-director.mjs";
import { capabilityParams } from "../kit/core/visual-capabilities.mjs";

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

const clauses = (texts, names = null) => texts.map((text, i) => ({ text, start: i * 5, end: i * 5 + 5, kind: "concept", headline: "Price", facts: extractFacts(text), ...(i === 0 && names ? { evidence: { claim: "c", names } } : {}) }));

test("picks: prices across clauses pair into one series, with the half guide", () => {
  const states = pairSeries(clauses(["The price is $1 per million input tokens and $5 per million output tokens.", "Cached input drops to $0.05 per million. GPT-6.1 Sol costs $2 in and $10 out.", "So Terra is exactly half the price of Sol, on both sides."], ["Terra"]));
  assert.deepEqual(states.map((state) => state.kind), ["series", "series", "series"]);
  assert.deepEqual(states[1].evidence.data.series.map((row) => `${row.label} ${row.value}`), ["Terra in 1", "Terra out 5", "Sol in 2", "Sol out 10"]);
  assert.deepEqual(states[2].evidence.data.reference, { value: 5, label: "half" });
  const bars = capabilityParams("glass-bars-3d", { ...states[2], headline: "Half the price" });
  assert.deepEqual(bars.data.map((row) => row.display), ["$1", "$5", "$2", "$10"]);
  assert.deepEqual(bars.reference, { value: 5, label: "half" });
});

test("picks: a count across clauses pairs, and its first figure leads a stat", () => {
  const states = pairSeries(clauses(["Picture $10 of output. On Sol, that buys 1 million tokens.", "On Terra, the same $10 buys 2 million. For an agent that writes a lot,"]));
  assert.equal(states[0].kind, "stat");
  assert.equal(states[0].facts.numbers[0].value, 1);
  assert.deepEqual(states[1].evidence.data.series.map((row) => `${row.label} ${row.value}`), ["Sol 1", "Terra 2"]);
  // A bar chart reads the pair, never the clause's own $10 beside its 2 million.
  assert.deepEqual(capabilityParams("bar-chart", states[1]).data.map((row) => row.value), [1, 2]);
  assert.equal(capabilityParams("bar-chart", { ...states[1], evidence: undefined }), null);
});

test("picks: scores across clauses pair, and \"more than double\" draws the 2× guide", () => {
  const states = pairSeries(clauses(["On Terminal-Bench 4.0, which measures agents working in a command line, Terra scores 50.3%.", "GPT-5.6 Terra scored 21.5%. That is more than double in one generation."]));
  assert.equal(states[0].kind, "share");
  assert.deepEqual(states[1].evidence.data.series, [{ label: "Terra", value: 50.3, unit: "%" }, { label: "GPT-5.6 Terra", value: 21.5, unit: "%" }]);
  assert.deepEqual(states[1].evidence.data.reference, { value: 43, label: "2×" });
  assert.deepEqual(extractFacts("GPT-5.6 Terra scored 21.5%.").numbers.map((entry) => entry.value), [21.5]);
});
