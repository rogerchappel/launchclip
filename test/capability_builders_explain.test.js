// Beat-director params builders for the explainer modules
// (kit/core/capability-builders-explain.mjs): each builds from a beat's real
// dates or evidence data, the result resolves in 16:9 and 9:16, and a beat
// without them gets null, so the director falls back instead of inventing.
import assert from "node:assert/strict";
import test from "node:test";
import { capabilityAdditions, capabilityParams, hasParamsBuilder, isPlanned } from "../kit/core/visual-capabilities.mjs";
import { resolveModule } from "../kit/core/modules.mjs";
import { extractFacts } from "../kit/core/beat-director.mjs";
import { typesetLatex } from "../src/math/typeset.js";

const BRAND = { colors: { bg: "#06070d", primary: "#fdb022", accent: "#46d4ff", ink: "#06070d", paper: "#f2eee6" } };
const MODULES = ["small-multiples", "date-carousel", "month-grid", "lineage-graph", "equation", "title-decompose"];
const SOURCE = { url: "https://example.com/report", title: "Lab report", date: "2026-10-24" };
const beat = (text, headline, extra = {}) => ({ id: "b", text, headline, facts: extractFacts(text), ...extra });
const withData = (text, headline, data) => beat(text, headline, { evidence: { claim: "c1", status: "verified", source: SOURCE, data } });

const PANELS = { panels: ["Coding", "Science", "Agents"].map((title, i) => ({ title, series: [{ label: "Model A", value: 60 + i }, { label: "Model B", value: 55 + 2 * i }] })), source: "Model card, table 4" };
const TEX = "E = \\term{mc^2}";
const SAMPLES = {
  "small-multiples": withData("It leads on every benchmark in the card.", "Leads on every benchmark", PANELS),
  "date-carousel": beat("It all started on October 5 2026, three weeks before the launch on October 26.", "Where it started", { label: "Beta" }),
  "month-grid": beat("From October 5 2026 the team shipped every day for 28 days.", "Shipping daily · 28 days"),
  "lineage-graph": withData("Her doctoral advisor was Ana Ruiz.", "Trained under Ana Ruiz", { people: [{ name: "Ana Ruiz", role: "Doctoral advisor", links: [{ to: "Sam Okafor", label: "doctoral advisor" }] }, { name: "Sam Okafor", role: "Ph.D. 2008" }] }),
  equation: withData("The famous relation ties energy to mass.", "Energy and mass", { tex: TEX, typeset: typesetLatex(TEX) }),
  "title-decompose": withData("The paper's title says it all.", "The paper's title", { title: "Quantum Gravity Corrections to the One Loop Scalar Self-Mass", terms: [{ text: "Quantum Gravity", gloss: "Quantum gravity", icon: "atom" }, { text: "Self-Mass", gloss: "the field's own mass" }, { text: "Dark Energy", gloss: "not in the title" }] })
};

const resolves = (module, params, width, height) => {
  const story = { schema: "launchclip.story.v1", lane: "motion", format: { width, height, fps: 30, duration: 10 }, brand: BRAND, scenes: [], resolved: { duration: 10, fps: 30 } };
  const scene = { id: "s", module, start: 1, end: 7, params };
  return resolveModule(scene, { ...story, scenes: [scene] });
};

test("explain builders: every module has a builder whose params resolve in 16:9 and 9:16", () => {
  for (const id of MODULES) {
    assert.ok(hasParamsBuilder(id) && !isPlanned(id), `${id} has a builder`);
    const params = capabilityParams(id, SAMPLES[id]);
    assert.ok(params, `${id} builds from its sample`);
    for (const [w, h] of [[1920, 1080], [1080, 1920]]) assert.doesNotThrow(() => resolves(id, params, w, h), `${id} at ${w}x${h}`);
  }
});

test("explain builders: no dates, people, equations or data are invented", () => {
  const bare = beat("The launch landed without warning in the spring.", "Launch without warning");
  for (const id of MODULES) assert.equal(capabilityParams(id, bare), null, id);
  // Evidence without data is not enough.
  const sourced = { ...bare, evidence: { claim: "c", source: SOURCE } };
  for (const id of ["small-multiples", "lineage-graph", "equation", "title-decompose"]) assert.equal(capabilityParams(id, sourced), null, id);
  // People without links are not a lineage; an equation without its typeset is left to fall back.
  assert.equal(capabilityParams("lineage-graph", withData("x", "x", { people: [{ name: "A B" }, { name: "C D" }] })), null);
  assert.equal(capabilityParams("equation", withData("x", "x", { tex: TEX })), null);
  assert.equal(capabilityParams("equation", withData("x", "x", { tex: "x^3", typeset: typesetLatex(TEX) })), null, "a typeset for other LaTeX");
  // Panels that do not share their series are not small multiples.
  assert.equal(capabilityParams("small-multiples", withData("x", "x", { panels: [{ title: "A", series: [{ label: "X", value: 1 }, { label: "Y", value: 2 }] }, { title: "B", series: [{ label: "X", value: 1 }] }] })), null);
  // A month-day date with no year in the clause has no weekday to show.
  assert.equal(capabilityParams("date-carousel", beat("It shipped on October 5 and again on October 26.", "Two ships")), null);
});

test("explain builders: dates come from the clause, or from the evidence source", () => {
  const carousel = capabilityParams("date-carousel", SAMPLES["date-carousel"]);
  assert.deepEqual([carousel.from, carousel.to], ["2026-10-26", "2026-10-05"], "rewinds from the later day to the first");
  assert.equal(carousel.event.label, "Beta");
  const one = capabilityParams("date-carousel", beat("It started on October 5 2026.", "Where it started", { evidence: { claim: "c", source: SOURCE } }));
  assert.deepEqual([one.from, one.to], ["2026-10-24", "2026-10-05"], "one date rewinds from the source's own date");
  assert.deepEqual(capabilityParams("month-grid", SAMPLES["month-grid"]), { from: "2026-10-05", days: 28, title: "Shipping daily · 28 days" });
  const whole = capabilityParams("month-grid", beat("In February 2028 the lab went quiet.", "A quiet month"));
  assert.deepEqual([whole.from, whole.days], ["2028-02-01", 29], "a named month is the whole month (leap year)");
  assert.deepEqual(capabilityParams("month-grid", withData("x", "Run", { run: { from: "2026-03-01T00:00:00Z", days: 10 } })).from, "2026-03-01");
});

test("explain builders: evidence maps onto the module params as written", () => {
  const multiples = capabilityParams("small-multiples", SAMPLES["small-multiples"]);
  assert.deepEqual(multiples.series, ["Model A", "Model B"]);
  assert.deepEqual(multiples.panels.map((panel) => panel.values), [[60, 55], [61, 57], [62, 59]]);
  assert.equal(multiples.source, "Model card, table 4");
  const lineage = capabilityParams("lineage-graph", SAMPLES["lineage-graph"]);
  assert.deepEqual(lineage.links, [{ from: 0, to: 1, label: "doctoral advisor" }]);
  const title = capabilityParams("title-decompose", SAMPLES["title-decompose"]);
  assert.deepEqual(title.terms.map((term) => term.text), ["Quantum Gravity", "Self-Mass"], "a gloss for words not in the title is dropped");
  assert.equal(title.citation, "Lab report, 2026-10-24");
  // Nested research output ({people: {people}}) reads the same.
  assert.ok(capabilityParams("lineage-graph", withData("x", "x", { people: { people: SAMPLES["lineage-graph"].evidence.data.people } })));
  // One more clause adds its panels to a dashboard on screen.
  assert.equal(capabilityAdditions("small-multiples", SAMPLES["small-multiples"]).items.length, 3);
  assert.equal(capabilityAdditions("small-multiples", beat("x", "x")), null);
});
