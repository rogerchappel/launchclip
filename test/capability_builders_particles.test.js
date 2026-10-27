import assert from "node:assert/strict";
import test from "node:test";
import { capabilityAdditions, capabilityParams, hasParamsBuilder } from "../kit/core/visual-capabilities.mjs";
import { extractFacts } from "../kit/core/beat-director.mjs";
import { resolveModule } from "../kit/core/modules.mjs";

const BRAND = { colors: { bg: "#06070d", primary: "#fdb022", accent: "#46d4ff", ink: "#06070d", paper: "#f2eee6" } };
const beat = (text, extra = {}) => ({ id: "b", text, headline: extra.headline ?? text, facts: extractFacts(text), ...extra });
// The split src/tokenizer.js writes (o200k_base) and the source's prices.
const TOKENS = { text: "Terra continues to advance the cost-intelligence frontier", tokens: ["Ter", "ra", " continues", " to", " advance", " the", " cost", "-int", "elligence", " frontier"], encoding: "o200k_base", models: [{ label: "Atlas 2", price: 10 }, { label: "Atlas 2 Mini", price: 5 }] };
const EVIDENCE = { claim: "c1", source: { url: "https://example.com/post", title: "Launch post", date: "2026-10-26" } };

function resolves(module, params) {
  for (const [width, height] of [[1920, 1080], [1080, 1920]]) {
    const story = { schema: "launchclip.story.v1", lane: "motion", format: { width, height, fps: 30, duration: 10 }, brand: BRAND, scenes: [], resolved: { duration: 10, fps: 30 } };
    const scene = { id: "s", module, start: 1, end: 6, params };
    assert.doesNotThrow(() => resolveModule(scene, { ...story, scenes: [scene] }), `${module} at ${width}x${height}: ${JSON.stringify(params)}`);
  }
}

test("particles builders: registered for the three modules, with no additions", () => {
  for (const id of ["dot-field", "particle-text", "tokenizer"]) {
    assert.ok(hasParamsBuilder(id), id);
    assert.equal(capabilityAdditions(id, beat("It holds 1,050,000 tokens in context.")), null, id);
  }
});

test("dot-field: the clause's own count, one dot per unit, and what a dot is", () => {
  const params = capabilityParams("dot-field", beat("It holds 1,050,000 tokens in context."));
  assert.deepEqual(params, { count: 1050000, label: "tokens in context", legend: "1 dot = 1 token", variant: "pull-back" });
  resolves("dot-field", params);
  const million = capabilityParams("dot-field", beat("Now a 2 million user waitlist."));
  assert.equal(million.count, 2000000);
  assert.equal(million.legend, "1 dot = 1 user");
  resolves("dot-field", million);
  // Never a count it was not given: money, shares, multiples, too small or too big, or nothing counted.
  for (const text of ["It raised $1,050,000 last week.", "It scored 60% on the hard set.", "Costs fell 9x per task.", "Only 40 people came.", "It cost 3.2 billion dollars.", "The launch landed without warning."]) assert.equal(capabilityParams("dot-field", beat(text)), null, text);
});

test("particle-text: the key number, else the key word, in the dot-matrix face", () => {
  const number = capabilityParams("particle-text", beat("It scored 60% on the hard set.", { headline: "A 60% score", kicker: "Hard set" }));
  assert.deepEqual(number, { text: "60%", kicker: "Hard set", sub: "on the hard set", mode: "assemble" });
  resolves("particle-text", number);
  const money = capabilityParams("particle-text", beat("Training cost $3.2 billion in total."));
  assert.equal(money.text, "$3.2B", "a scaled figure is written compact");
  // "$3.2B" reads as $3.2 to the fact extractor: never shown cut short.
  assert.equal(capabilityParams("particle-text", beat("Training cost $3.2B.", { headline: "Training cost" })).text, "COST", "TRAINING is too wide for 9:16; the next key term");
  resolves("particle-text", money);
  const word = capabilityParams("particle-text", beat("What changes when the agents arrive.", { headline: "Agents arrive" }));
  assert.equal(word.text, "AGENTS");
  assert.equal(word.sub, "Agents arrive");
  resolves("particle-text", word);
  // Too wide for 9:16 at a readable size: the next drawable thing, else nothing.
  assert.equal(capabilityParams("particle-text", beat("Read 1,234,567,890 rows.", { headline: "Rows" })).text, "ROWS");
  // A word the face cannot draw is skipped, and nothing drawable means no params.
  assert.equal(capabilityParams("particle-text", beat("Café über naïve.", { headline: "Café über naïve" })), null);
});

test("tokenizer: only with the precomputed split and the source's prices", () => {
  const plain = beat("A token is part of a word.");
  assert.equal(capabilityParams("tokenizer", plain), null, "kit/core cannot tokenize");
  const params = capabilityParams("tokenizer", { ...plain, evidence: { ...EVIDENCE, data: { tokens: TOKENS } } });
  assert.deepEqual(params.tokens, TOKENS.tokens);
  assert.deepEqual(params.models, TOKENS.models);
  assert.equal(params.encoding, "o200k_base");
  assert.equal(params.source, "Launch post, 2026-10-26");
  resolves("tokenizer", params);
  // A split that does not join back, or no prices, is not shown.
  assert.equal(capabilityParams("tokenizer", { ...plain, evidence: { ...EVIDENCE, data: { tokens: { ...TOKENS, tokens: TOKENS.tokens.slice(1) } } } }), null);
  assert.equal(capabilityParams("tokenizer", { ...plain, evidence: { ...EVIDENCE, data: { tokens: { ...TOKENS, models: [] } } } }), null);
});
