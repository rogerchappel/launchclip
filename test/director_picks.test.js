// Regression tests for the beat director's module choices, from clauses of a
// real long-form script (written inline; the script itself is not in the repo).
import assert from "node:assert/strict";
import test from "node:test";
import { GENERIC_MODULES, directLongForm, entityAliases, extractFacts, ledgerOutputPrices, ledgerTimeline, matchEvidence, pairSeries, visualKind } from "../kit/core/beat-director.mjs";
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

// A dated ledger: a merged PR (with its card data), a post, a launch, and a rival's launch a month before.
const PR = { repo: "dotnet/efcore", number: 39217, title: "Make the evals more realistic", state: "merged", author: "AndriySvyryd", date: "2026-10-16", file: "evals/config.yaml", lines: ["-  judge: gpt-5.6-terra", "+  judge: gpt-6.1-terra"], startLine: { old: 4, new: 4 } };
const DATED = {
  schema: "launchclip.evidence.v1",
  claims: [
    { id: "merged", kind: "date", status: "verified", text: "On October 16, 2026, pull request 39217 was merged in dotnet/efcore.", dates: ["October 16, 2026"], entities: [{ name: "dotnet/efcore", kind: "repo" }], data: { module: "repo-pr-card", params: PR }, sources: [source("https://github.com/dotnet/efcore/pull/39217", "dotnet/efcore#39217")] },
    { id: "posted", kind: "date", status: "verified", text: "Salio posted on X on October 25, 2026 that GPT-6.1 Terra was showing up on GitHub.", dates: ["October 25, 2026"], sources: [{ ...source("https://x.com/salio/status/1", "Salio on X"), publisher: "X", quote: { text: "GPT-6.1 Terra is showing up in GitHub code review" } }] },
    { id: "launched", kind: "date", status: "verified", text: "On October 26, 2026, OpenAI announced GPT-6.1 Terra.", dates: ["October 26, 2026"], sources: [{ ...source("https://openai.com/index/terra", "Introducing GPT-6.1 Terra"), publisher: "OpenAI", quote: { text: "GPT-6.1 Terra is available today in the API, ChatGPT and Codex." } }] },
    { id: "rival", kind: "date", status: "verified", text: "Claude Opus 5.5 launched on September 22, 2026.", dates: ["September 22, 2026"], sources: [{ ...source("https://example.com/opus", "Opus 5.5"), publisher: "Example", quote: { text: "Opus 5.5 is out" } }] },
    { id: "prices", kind: "number", status: "verified", text: "GPT-6.1 Terra costs $1 per million input tokens and $5 per million output tokens.", entities: [{ name: "Terra", kind: "name" }], sources: [source("https://openai.com/api/pricing", "Pricing")] },
    { id: "sol", kind: "number", status: "verified", text: "That is half the price of GPT-6.1 Sol, which costs $2 per million input tokens and $10 per million output tokens.", entities: [{ name: "Sol", kind: "name" }], sources: [source("https://openai.com/api/pricing", "Pricing")] }
  ]
};

test("picks: dated claims make a running timeline, one card per day", () => {
  const cards = ledgerTimeline(DATED);
  assert.deepEqual(cards.map((card) => card.date), ["2026-09-22", "2026-10-16", "2026-10-25", "2026-10-26"]);
  assert.equal(cards[1].module, "repo-pr-card");
  assert.equal(cards[2].kind, "announcement");
  assert.deepEqual(ledgerOutputPrices(DATED), [{ label: "GPT-6.1 Terra", price: 5 }, { label: "GPT-6.1 Sol", price: 10 }]);
});

// Timed words for inline narration: 0.4 s a word, a pause after each sentence.
function timedWords(sentences) {
  const words = [];
  let t = 0;
  for (const sentence of sentences) { for (const text of sentence.split(" ")) { words.push({ text, start: +t.toFixed(2), end: +(t + 0.32).toFixed(2) }); t += 0.4; } t += 0.6; }
  return words;
}

test("picks: on a real script's clauses, dates pin the timeline, a model id is tokenised, and generic cards are capped", () => {
  const sentences = [
    "Start with dotnet/efcore, the open source repository behind Entity Framework.",
    "On October 16, pull request 39217 was merged.",
    "It updated the evaluation harness that tests how well agents handle real work.",
    "On October 25, Salio posted a screenshot on X.",
    "We are treating that one as reported, not proven.",
    "On October 26, GPT-6.1 Terra became generally available.",
    "In the API, the model name is gpt-6.1-terra.",
    "The price is $1 per million input tokens and $5 per million output tokens.",
    "GPT-6.1 Sol costs $2 in and $10 out.",
    "So Terra is exactly half the price of Sol, on both sides.",
    "OpenAI also says Terra is 3 times faster than Astra.",
    "That repository now returns a 404 page, so the screenshot is all that is left."
  ];
  const words = timedWords(sentences);
  const tokens = { "gpt-6.1-terra": { text: "gpt-6.1-terra", tokens: ["g", "pt", "-", "6", ".", "1", "-ter", "ra"], encoding: "o200k_base" } };
  const map = directLongForm({ words, chapters: [{ id: "trail", title: "The leak trail", start: 0 }], ledger: DATED, captures: [], tokens, title: "Terra" });
  const states = map.chapters.flatMap((chapter) => chapter.shots.flatMap((shot) => shot.states));
  const at = (fragment) => states.find((state) => state.text.includes(fragment));
  for (const day of ["October 16", "October 25", "October 26"]) assert.equal(at(day).module, "date-pinned-timeline", `${day}: ${at(day).module}`);
  // The story so far, latest last (oldest cards drop when the canvas has no room for them).
  const days = at("October 26").params.cards.map((card) => card.date);
  assert.ok(days.length >= 2 && days.at(-1) === "2026-10-26" && days.includes("2026-10-25"), days.join(", "));
  assert.deepEqual(at("October 16").params.cards.map((card) => card.date), ["2026-10-16"]);
  assert.equal(at("gpt-6.1-terra").module, "tokenizer");
  assert.deepEqual(at("gpt-6.1-terra").params.models, [{ label: "GPT-6.1 Terra", price: 5 }, { label: "GPT-6.1 Sol", price: 10 }]);
  assert.ok(["glass-bars-3d", "bar-chart"].includes(at("exactly half").module), at("exactly half").module);
  assert.notEqual(at("3 times faster").kind, "quote");
  assert.notEqual(at("404 page").module, "odometer");
  const generic = states.filter((state) => GENERIC_MODULES.has(state.module)).length;
  assert.ok(generic / states.length <= 0.35, `${generic} of ${states.length} generic: ${states.map((state) => state.module).join(", ")}`);
});
