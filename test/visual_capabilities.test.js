import assert from "node:assert/strict";
import test from "node:test";
import { CAPABILITIES, VISUAL_KINDS, capabilitiesFor, capabilityAdditions, capabilityParams, capabilitySamples, fallbackChain, hasParamsBuilder, isPlanned, resolveCapability } from "../kit/core/visual-capabilities.mjs";
import { knownModules, resolveModule } from "../kit/core/modules.mjs";

const BRAND = { colors: { bg: "#06070d", primary: "#fdb022", accent: "#46d4ff", ink: "#06070d", paper: "#f2eee6" } };
const BEAT = {
  id: "b1",
  text: "Training compute grew from 40 percent to 3.2 billion dollars across France, Japan and Brazil in 2024 and 2025.",
  headline: "Compute grew tenfold",
  label: "of the budget",
  brand: { mark: "assets/brand/mark.png", wordmark: { src: "assets/brand/wordmark.png", ratio: 7.5 } },
  facts: { numbers: [{ value: 40, unit: "%", raw: "40%", label: "Before" }, { value: 3.2, unit: "B", prefix: "$", raw: "$3.2B", label: "After" }], items: ["data", "compute", "talent", "energy"], dates: [{ label: "2024" }, { label: "2025" }], places: ["France", "Japan", "Brazil"], handle: "@lab" },
  evidence: { claim: "c1", source: { url: "https://example.com/a", title: "Lab report", date: "2026-03-01" }, quote: "compute grew tenfold", capture: { out: "assets/evidence/x.mp4" } }
};

test("capabilities: every kind has a module and every planned module falls back to a registered one", () => {
  const known = new Set(knownModules());
  for (const kind of VISUAL_KINDS) assert.ok(capabilitiesFor(kind).length, `no capability shows "${kind}"`);
  for (const entry of CAPABILITIES) {
    const resolved = resolveCapability(entry.id);
    assert.ok(known.has(resolved.module), `${entry.id} resolves to ${resolved.module}, which is not registered`);
    if (!isPlanned(entry.id)) assert.ok(known.has(entry.id), `${entry.id} has a params builder, so it must be registered`);
  }
  // Registered, a module is used as is; without it, its fallback chain is walked.
  assert.deepEqual(resolveCapability("social-post"), { module: "social-post", wanted: "social-post", fallback: false, chain: ["social-post"] });
  assert.equal(resolveCapability("social-post", { registered: [...known].filter((id) => id !== "social-post") }).fallback, true);
  assert.equal(fallbackChain("glass-bars-3d")[0], "bar-chart");
});

test("capabilities: evidence leads, and portrait drops wide-only modules", () => {
  assert.equal(capabilitiesFor("quote", { evidence: "post" })[0], "social-post");
  assert.equal(capabilitiesFor("concept", { evidence: "pr" })[0], "repo-pr-card");
  assert.ok(capabilitiesFor("compare").includes("comparison-table"));
  assert.ok(!capabilitiesFor("compare", { wide: false }).includes("comparison-table"));
});

// Four same-unit numbers: the multi-number modules (leaderboard, gauges, table) have data.
const SERIES = { ...BEAT, text: "Scores rose from 39 percent to 48 percent, then 55 percent and 71 percent.", facts: { ...BEAT.facts, numbers: [39, 48, 55, 71].map((value, i) => ({ value, unit: "%", raw: `${value}%`, label: ["Old", "New", "Maths", "Docs"][i] })) } };

test("capabilities: number modules never invent a number", () => {
  const bare = { id: "b2", text: "The launch landed without warning.", headline: "Launch without warning", facts: { numbers: [], dates: [], items: [] } };
  for (const id of ["stat-card", "count-up", "odometer", "percent-fill", "unit-grid", "pie-chart", "number-line", "bar-chart", "leaderboard", "gauge-compare", "comparison-table"]) assert.equal(capabilityParams(id, bare), null, id);
  assert.equal(capabilityParams("bar-chart", SERIES).data.length, 4);
  assert.deepEqual(capabilityParams("gauge-compare", SERIES).left, { label: "Old", value: 39, unit: "%", color: "primary" });
});

test("capabilities: narration is never dressed as a quote, a post or a sourced excerpt", () => {
  const plain = { id: "b3", text: "On a long document reading test, it leads.", headline: "Long document test", facts: { numbers: [], dates: [], items: [] } };
  for (const id of ["quote-card", "feed-frame", "excerpt", "proof-wall"]) assert.equal(capabilityParams(id, plain), null, id);
  const quoted = { ...plain, evidence: { claim: "c", source: { url: "https://x.example", title: "Lab report" }, quote: "71% on long-document QA" } };
  assert.equal(capabilityParams("quote-card", quoted).quote, "71% on long-document QA");
  assert.equal(capabilityParams("quote-card", quoted).author, "Lab report");
});

test("capabilities: every params builder resolves in 16:9 and 9:16", () => {
  for (const [width, height] of [[1920, 1080], [1080, 1920]]) {
    const story = { schema: "launchclip.story.v1", lane: "motion", format: { width, height, fps: 30, duration: 10 }, brand: BRAND, scenes: [], resolved: { duration: 10, fps: 30 } };
    for (const id of [...CAPABILITIES.map((entry) => entry.id), "feed-frame", "proof-wall"]) {
      if (!hasParamsBuilder(id)) { assert.ok(isPlanned(id), `${id} has no params builder`); continue; }
      // The shared sample beats, then the family files' evidence-carrying samples.
      const params = [BEAT, SERIES, ...capabilitySamples()].map((beat) => capabilityParams(id, beat)).find(Boolean);
      assert.ok(params, `${id} has no params for any sample beat (add one with its evidence.data to its family file's samples)`);
      const scene = { id: "s", module: id, start: 1, end: 5, params };
      assert.doesNotThrow(() => resolveModule(scene, { ...story, scenes: [scene] }), `${id} at ${width}x${height}`);
    }
  }
  // A module without a builder gets a neutral bag of facts.
  assert.deepEqual(Object.keys(capabilityParams("a-module-with-no-builder", BEAT)).sort(), ["evidence", "text", "title", "values"]);
});

test("capabilities: a build adds the clause's own entries", () => {
  assert.deepEqual(capabilityAdditions("bar-chart", SERIES).items.map((entry) => entry.value), [39, 48, 55, 71]);
  assert.equal(capabilityAdditions("process-steps", BEAT).items[0].label, "Compute grew tenfold");
  assert.equal(capabilityAdditions("stat-card", BEAT), null);
});
