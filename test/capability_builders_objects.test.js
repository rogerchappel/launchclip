// Beat-director params builders for the 3D data objects
// (kit/core/capability-builders-objects.mjs): each builds from the clause's own
// numbers or its evidence data only, returns null otherwise, and its params
// resolve in 16:9 and 9:16.
import assert from "node:assert/strict";
import test from "node:test";
import { capabilityAdditions, capabilityParams, hasParamsBuilder, isPlanned } from "../kit/core/visual-capabilities.mjs";
import { extractFacts } from "../kit/core/beat-director.mjs";
import { resolveModule } from "../kit/core/modules.mjs";

const BRAND = { colors: { bg: "#06070d", primary: "#fdb022", accent: "#46d4ff", ink: "#06070d", paper: "#f2eee6" } };
const IDS = ["glass-bars-3d", "coin-stack", "rack-shelf"];
const SOURCE = { url: "https://example.com/report", title: "Lab report", date: "2026-03-01" };
const beat = (text, extra = {}) => ({ id: "b", text, headline: extra.headline ?? "The line-up", facts: extractFacts(text), ...extra });

const resolves = (id, params) => {
  for (const [width, height] of [[1920, 1080], [1080, 1920]]) {
    const scene = { id: "s", module: id, start: 1, end: 6, params };
    const story = { schema: "launchclip.story.v1", lane: "motion", format: { width, height, fps: 30, duration: 10 }, brand: BRAND, scenes: [scene], resolved: { duration: 10, fps: 30 } };
    assert.doesNotThrow(() => resolveModule(scene, story), `${id} at ${width}x${height}: ${JSON.stringify(params)}`);
  }
};

// Beats each builder should fill, from real clauses or their evidence data.
const SERIES = { claim: "c1", source: SOURCE, data: { series: [{ label: "Atlas", value: 50, unit: "USD" }, { label: "Orbit", value: 10, unit: "USD" }, { label: "Nova", value: 0.5, unit: "USD" }], source: SOURCE } };
const CASES = {
  "glass-bars-3d": [
    beat("Scores were 39 percent on the old suite, 48 percent on the new suite and 55 percent on the hard suite."),
    beat("It took 4.1 seconds before and 1.8 seconds after.", { headline: "Median response time" }),
    beat("Here is how the family is priced.", { evidence: SERIES })
  ],
  "coin-stack": [
    beat("One task costs $1 with Nova and $10 with Atlas.", { headline: "Cost of one task" }),
    beat("It dropped from $8.82 per task to $1.01 per task.", { headline: "Cost per finished task" })
  ],
  "rack-shelf": [beat("Here is the line-up.", { headline: "Model by model", evidence: SERIES }), beat("It scored 84 points on coding and 78 points on maths.")]
};

test("objects builders: every module has a builder, and each case resolves in 16:9 and 9:16", () => {
  for (const id of IDS) {
    assert.ok(hasParamsBuilder(id) && !isPlanned(id), `${id} has a builder`);
    for (const entry of CASES[id]) {
      const params = capabilityParams(id, entry);
      assert.ok(params, `${id} builds for "${entry.text}"`);
      resolves(id, params);
    }
  }
});

test("objects builders: nothing is invented; no data, no params", () => {
  const bare = beat("The launch landed without warning.", { headline: "Launch without warning" });
  for (const id of IDS) assert.equal(capabilityParams(id, bare), null, id);
  // One number is no series and one price is no comparison.
  assert.equal(capabilityParams("glass-bars-3d", beat("It scored 71 percent.")), null);
  assert.equal(capabilityParams("coin-stack", beat("It costs $5 per million tokens.")), null);
  // Mixed units are not one series; dollars and euros are not one pile.
  assert.equal(capabilityParams("glass-bars-3d", beat("It went from 40 percent to $3.2 billion.")), null);
  assert.equal(capabilityParams("coin-stack", beat("It costs $5 here and €9 there.")), null);
  // Names longer than a 9:16 bar holds, or two bars with one name, fall back to the 2D chart.
  const four = { claim: "c", data: { series: ["Northlight", "Halcyon", "Meridian", "Lumen"].map((label, i) => ({ label, value: 40 - i * 10 })) } };
  assert.equal(capabilityParams("glass-bars-3d", beat("x", { evidence: four })), null);
  assert.equal(capabilityParams("glass-bars-3d", beat("It went from 4.1 seconds to 1.8 seconds.")), null, "no bar without its own name");
  assert.equal(capabilityParams("glass-bars-3d", beat("The flagship costs $50, the mid model $10 and the small one $5.")), null);
  // A shelf row needs its own name: unlabelled numbers are not rows.
  assert.equal(capabilityParams("rack-shelf", beat("It went from 12 to 48.")), null);
});

test("objects builders: values and labels are the clause's or the evidence's own", () => {
  const bars = capabilityParams("glass-bars-3d", CASES["glass-bars-3d"][0]);
  assert.equal(bars.variant, "bars", "a rising series is bars, the last one lit");
  assert.deepEqual(bars.data.map((entry) => [entry.label, entry.value]), [["Old suite", 39], ["New suite", 48], ["Hard suite", 55]]);
  assert.deepEqual(bars.data.map((entry) => entry.display), ["39%", "48%", "55%"]);
  assert.equal(bars.highlight, 2);
  const stairs = capabilityParams("glass-bars-3d", CASES["glass-bars-3d"][2]);
  assert.equal(stairs.variant, "staircase", "a descending series is a staircase line-up");
  assert.deepEqual(stairs.data.map((entry) => [entry.label, entry.display]), [["Atlas", "$50"], ["Orbit", "$10"], ["Nova", "$0.5"]]);
  assert.equal(stairs.source, "Lab report, 2026-03-01");

  const coins = capabilityParams("coin-stack", CASES["coin-stack"][0]);
  assert.deepEqual(coins.stacks.map((entry) => [entry.value, entry.display]), [[1, "$1"], [10, "$10"]]);
  assert.deepEqual(coins.callout, { text: "×10", stack: 1 });

  const rack = capabilityParams("rack-shelf", CASES["rack-shelf"][0]);
  assert.deepEqual(rack.rows.map((entry) => entry.label), ["Atlas", "Orbit", "Nova"]);
  assert.equal(rack.focus, 0, "the top value is the focus tray");

});

test("objects builders: a later clause adds its own bar, stack or row", () => {
  assert.deepEqual(capabilityAdditions("glass-bars-3d", beat("Then 71 percent on docs.")).items.map((entry) => entry.value), [71]);
  assert.equal(capabilityAdditions("coin-stack", beat("A third option costs $4 per task.")).items[0].display, "$4");
  assert.deepEqual(capabilityAdditions("rack-shelf", beat("It scored 62 points on maths.")).items, [{ label: "Maths", cells: ["62"] }]);
  assert.equal(capabilityAdditions("rack-shelf", beat("The next model scored 62 points.")), null, "a value with no name adds no row");
  assert.equal(capabilityAdditions("glass-bars-3d", beat("Nothing to add here.")), null);
});
