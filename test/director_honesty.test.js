// The beat director's honesty gates, from clauses of a real long-form script
// (written inline) and a tiny ledger with unverified claims: nothing reported
// reaches the screen as fact, and a quote is a verified source's own words.
import assert from "node:assert/strict";
import test from "node:test";
import { directLongForm, extractFacts, gateEvidence, isQuotable, matchEvidence } from "../kit/core/beat-director.mjs";
import { capabilityParams } from "../kit/core/visual-capabilities.mjs";

const source = (url, title, quote) => ({ url, title, primary: true, confidence: 0.9, supports: true, fetched_at: "2026-10-27T00:00:00Z", ...(quote ? { quote: { text: quote } } : {}) });
const LEDGER = {
  schema: "launchclip.evidence.v1",
  claims: [
    { id: "tibo", kind: "quote", status: "unverified", flag: "quote found nowhere", text: "Tibo from OpenAI posted \"This week is going to be interesting.\"", quote: "This week is going to be interesting.", entities: [{ name: "Tibo", kind: "person" }], sources: [] },
    { id: "faster", kind: "entity", status: "unverified", flag: "OpenAI only", text: "OpenAI says Terra finishes Agents' Last Exam tasks 3 times faster than GPT-6 Astra.", entities: [{ name: "Astra", kind: "name" }], sources: [] },
    { id: "cheaper", kind: "number", status: "unverified", flag: "OpenAI only", text: "OpenAI says Terra completes computer-use tasks at 9x lower cost than Claude Opus 5.5.", sources: [] },
    { id: "exam", kind: "entity", status: "verified", text: "On Agents' Last Exam, OpenAI says Terra performs on par with GPT-6 Astra.", entities: [{ name: "Agents' Last Exam", kind: "benchmark" }], sources: [source("https://example.com/guide", "Release guide", "| Agents' Last Exam, medium effort | 15 points above GPT-5.6 Terra |")] },
    { id: "pr", kind: "number", status: "verified", text: "On October 16, 2026, pull request 39217 was merged in dotnet/efcore.", entities: [{ name: "dotnet/efcore", kind: "repo" }], sources: [source("https://github.com/dotnet/efcore/pull/39217", "dotnet/efcore#39217", "GitHub API: Pull request dotnet/efcore#39217 merged")] },
    { id: "price", kind: "number", status: "verified", text: "GPT-6.1 Terra costs $1 per million input tokens and $5 per million output tokens.", sources: [source("https://openai.com/api/pricing", "Pricing", "GPT-6.1 Terra is priced at $1 per million input tokens and $5 per million output tokens.")] }
  ]
};
const beat = (text) => ({ text, facts: extractFacts(text) });

test("honesty: a quote is a verified source's own prose, never a table row or an API record", () => {
  assert.equal(isQuotable("| Agents' Last Exam, medium effort | 15 points above |"), false);
  assert.equal(isQuotable("GitHub API: Pull request dotnet/efcore#39217 merged"), false);
  assert.equal(isQuotable("- a list item that runs on"), false);
  assert.equal(isQuotable("GPT-6.1 Terra is priced at $1 per million input tokens."), true);
  assert.equal(matchEvidence(beat("The same day, OpenAI's Tibo posted that there was a fun week ahead."), { ledger: LEDGER })?.quote, undefined);
  assert.equal(matchEvidence(beat("On Agents' Last Exam, a test of long professional tasks done on a computer,"), { ledger: LEDGER })?.quote, undefined);
  assert.match(matchEvidence(beat("The price is $1 per million input tokens and $5 per million output tokens."), { ledger: LEDGER }).quote, /priced at \$1/);
});

test("honesty: an unverified claim keeps its source line and nothing else", () => {
  const gated = gateEvidence({ claim: "x", status: "unverified", source: { url: "https://x.example" }, quote: "q", capture: { id: "c" }, data: { series: [] } });
  assert.deepEqual(gated, { claim: "x", status: "unverified", source: { url: "https://x.example" }, unverified: true });
  const verified = { claim: "y", status: "verified", quote: "q" };
  assert.equal(gateEvidence(verified), verified);
  // With no verified quote, a quote card has nothing to show, whatever the narration quotes.
  assert.equal(capabilityParams("quote-card", { ...beat("That repository now returns a \"not found\" page."), headline: "Not found", evidence: { claim: "pr", status: "verified", source: { title: "dotnet/efcore#39217" } } }), null);
  assert.equal(capabilityParams("quote-card", { ...beat("Tibo said \"This week is going to be interesting.\""), headline: "Tibo", evidence: gateEvidence({ claim: "tibo", status: "unverified", quote: "This week is going to be interesting." }) }), null);
});

function timedWords(sentences) {
  const words = [];
  let t = 0;
  for (const sentence of sentences) { for (const text of sentence.split(" ")) { words.push({ text, start: +t.toFixed(2), end: +(t + 0.32).toFixed(2) }); t += 0.4; } t += 0.6; }
  return words;
}

test("honesty: on a real script's clauses, reported figures are attributed claim cards and reported quotes never quote cards", () => {
  const sentences = [
    "The same day, OpenAI's Tibo posted that there was a fun week ahead.",
    "That repository now returns a \"not found\" page, so the screenshot is all that is left.",
    "On Agents' Last Exam, a test of long professional tasks done on a computer, Terra is on par with Astra.",
    "OpenAI also says Terra is 3 times faster than Astra,",
    "and 9 times cheaper per task than Claude Opus 5.5.",
    "The price is $1 per million input tokens and $5 per million output tokens."
  ];
  const map = directLongForm({ words: timedWords(sentences), chapters: [{ id: "claims", title: "The claims", start: 0 }], ledger: LEDGER, captures: [], title: "Terra" });
  const states = map.chapters.flatMap((chapter) => chapter.shots.flatMap((shot) => shot.states));
  const at = (fragment) => states.find((state) => state.text.includes(fragment));
  for (const state of states) {
    if (state.module === "quote-card" || state.module === "social-post") assert.equal(state.evidence?.status, "verified", `${state.id} quotes ${state.evidence?.claim}`);
    if (state.evidence?.unverified) assert.ok(!["count-up", "odometer", "stat-card", "percent-fill", "glass-bars-3d", "bar-chart", "quote-card", "social-post", "media-window"].includes(state.module), `${state.text}: ${state.module}`);
    assert.ok(!JSON.stringify(state.params).includes("| Agents"), `${state.id} shows a table row`);
  }
  const faster = at("3 times faster");
  assert.equal(faster.kind, "claim");
  assert.deepEqual([faster.params.text, faster.params.sub], ["3×", "faster than Astra: OpenAI's claim, not verified"]);
  assert.match(at("9 times cheaper").params.sub, /OpenAI's claim, not verified$/);
  assert.notEqual(at("not found").module, "quote-card");
});

import { GENERIC_MODULES, beatMapToStory, verbatimHeadline } from "../kit/core/beat-director.mjs";
import { resolveModule } from "../kit/core/modules.mjs";

test("honesty: a generic card says a line the narration says, never its stripped key words", () => {
  // The clauses behind "Surface routine updated", "Mid October Microsoft", "Showed commit GitHub", "Model tested real", "Numbers" vs "Anything".
  assert.equal(verbatimHeadline("On the surface it was routine. It updated the evaluation harness,"), "On the surface it was routine");
  assert.equal(verbatimHeadline("So by mid October, Microsoft engineers were already trusting Terra to mark Sol's homework."), "mark Sol's homework");
  assert.equal(verbatimHeadline("Andrew Curran wrote that the number of people on his feed switching to Anthropic"), "Andrew Curran");
  assert.equal(verbatimHeadline("Start with dotnet/efcore, the open source repository behind Entity Framework, Microsoft's data library for .NET."), "Entity Framework");
  assert.equal(verbatimHeadline("We could not check those two numbers against anything outside OpenAI"), "outside OpenAI");
  // Nothing worth setting: the card on screen holds, unless a static run would outlast its limit.
  assert.equal(verbatimHeadline("and that is what it is,"), null);
  assert.equal(verbatimHeadline("and it is, as it was before,", { loose: true }), null);
  assert.equal(capabilityParams("compare", { ...beat("We could not check those two numbers against anything outside OpenAI."), headline: "Numbers" }), null);
  assert.equal(capabilityParams("code-snippet", { ...beat("Then, according to a screenshot on X, it turned up in code reviews."), headline: "Screenshot" }), null);
  assert.equal(capabilityParams("kinetic-words", { ...beat("And they are not choosing one model."), headline: "Choosing model" }), null);
});

test("honesty: on a real script's clauses, every generic card's words are said in its clause, or the card before holds", () => {
  const sentences = [
    "On the surface it was routine. It updated the evaluation harness,",
    "the setup that tests how well AI agents handle real coding work in that codebase.",
    "So by mid October, Microsoft engineers were already trusting Terra to mark Sol's homework.",
    "It showed a commit by a GitHub engineer that switched Copilot's production code reviews.",
    "We could not check those two numbers against anything outside OpenAI.",
    "Anyone can rerun it. Either way, the leak trail tells you something on its own.",
    "The model was being tested on real work, in real repositories, a week before the launch."
  ];
  const map = directLongForm({ words: timedWords(sentences), chapters: [{ id: "trail", title: "The leak trail", start: 0 }], ledger: LEDGER, captures: [], title: "Terra" });
  const states = map.chapters.flatMap((chapter) => chapter.shots.flatMap((shot) => shot.states));
  const said = (state) => [state.params?.text, state.params?.word, ...(state.params?.words ?? []).map((entry) => entry.text)].filter(Boolean);
  for (const state of states) {
    if (!GENERIC_MODULES.has(state.module) && state.module !== "particle-text") continue;
    if (state.change === "hold" || state.kind === "title") continue;
    for (const text of said(state)) assert.ok(state.text.includes(text), `${state.module} "${text}" is not said in "${state.text}"`);
  }
  assert.ok(!states.some((state) => state.module === "compare"), states.map((state) => state.module).join(", "));
});

test("honesty: a focus step carries the card on as one of its shot states", () => {
  const params = { title: "Price per million", data: [{ label: "Terra", value: 5 }, { label: "Sol", value: 10 }] };
  const state = (id, start, change, extra = {}) => ({ id, words: [0, 0], start, end: start + 4, text: "x", intent: "claim", kind: "series", capability: "bar-chart", module: "bar-chart", change, params, why: "", ...extra });
  const map = { schema: "launchclip.beat-map.v1", format: { width: 1920, height: 1080 }, duration: 12, chapters: [{ id: "c", title: "Prices", start: 0, end: 12, background: "mesh", shots: [{ id: "s", start: 0, end: 12, states: [state("a", 0, "enter"), state("b", 4, "focus", { focus: 1 }), state("c", 8, "hold")] }] }] };
  const story = beatMapToStory(map, { captions: false });
  assert.equal(story.scenes.length, 1);
  assert.deepEqual([story.scenes[0].start, story.scenes[0].end], [0, 12]);
  assert.deepEqual(story.scenes[0].states, [{ at: 4, set: { focus: 1 } }]);
  assert.doesNotThrow(() => resolveModule(story.scenes[0], { ...story, resolved: { duration: 12, fps: 30 } }));
});

import { pairSeries } from "../kit/core/beat-director.mjs";

const clauses = (texts) => texts.map((text, i) => ({ text, start: i * 5, end: i * 5 + 5, kind: "concept", headline: "x", facts: extractFacts(text) }));

test("data: what the same $10 buys on each model is a race of the tokens bought, never 10 against 10", () => {
  const states = pairSeries(clauses(["So Terra is exactly half the price of Sol, on both sides. Picture $10 of output.", "On Sol, that buys 1 million tokens. On Terra, the same $10 buys 2 million."]));
  const race = states.at(-1);
  assert.equal(race.kind, "race");
  assert.deepEqual(race.evidence.data.race, { spend: 10, suffix: "tokens", rows: [{ label: "Sol", total: 1e6 }, { label: "Terra", total: 2e6 }] });
  const params = capabilityParams("grid-race", { ...race, headline: "x" });
  assert.deepEqual(params.racers.map((racer) => [racer.label, racer.total, racer.spend.total]), [["Sol", 1e6, 10], ["Terra", 2e6, 10]]);
  assert.equal(params.title, "Tokens for $10");
});

test("data: a chart is titled by what it measures, never by a fragment of the clause", () => {
  const prices = pairSeries(clauses(["The price is $1 per million input tokens and $5 per million output tokens.", "Cached input drops to $0.05 per million.", "GPT-6.1 Sol costs $2 in and $10 out."]));
  for (const state of prices.filter((entry) => entry.kind === "series")) assert.equal(state.evidence.data.title, "Price per million tokens");
  const bars = capabilityParams("glass-bars-3d", { ...prices.at(-1), headline: "GPT-6.1 Sol costs" });
  assert.equal(bars.title, "Price per million tokens");
  const scores = pairSeries(clauses(["On Terminal-Bench 4.0, which measures agents working in a command line, Terra scores 50.3%.", "GPT-5.6 Terra scored 21.5%. That is more than double in one generation."]));
  assert.equal(scores[1].evidence.data.title, "Terminal-Bench 4.0");
  // With no title of its own, a chart has none.
  assert.equal(capabilityParams("bar-chart", { text: "x", headline: "Cached input drops", facts: { numbers: [] }, evidence: { status: "verified", data: { series: [{ label: "A", value: 1 }, { label: "B", value: 2 }] } } }).title, undefined);
});
