// launchclip carousel make with a stubbed model (src/carousel/make.js, plan.js).
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { isEditorialKind } from "@launchclip/core/modules.mjs";
import { run } from "../src/carousel/make.js";
import { slideModules, slideRange } from "../src/carousel/plan.js";

const slide = (id, role, module, params, alt = `${id} slide`) => ({ id, role, module, params, alt });
const listicle = (extra = {}) => ({
  title: "Three habits of fast teams",
  arc: "listicle",
  goal: "save",
  caption: { hook: "Most teams are not slow. They wait.", body: "Where the waiting hides in a week.", cta: "Save this for planning.", tags: ["productivity"] },
  slides: [
    slide("cover", "cover", "hook-title", { headline: "3 habits that make teams ship faster", emphasis: "ship faster" }),
    slide("one", "body", "hook-title", { headline: "Decide in the thread" }),
    slide("two", "body", "motion-title", { text: "Ship the smallest change that works" }),
    slide("summary", "payoff", "item-list", { title: "Save this", items: ["Decide in thread", "Ship small"] }),
    slide("cta", "cta", "cta", { action: "Save for your next planning" })
  ],
  ...extra
});

// A make-style test double: answers each call in turn and keeps the requests.
function fakeModel(...answers) {
  const requests = [];
  return {
    requests,
    provider: "test",
    model: "stub",
    client: { async runStructured(request) { requests.push(request); const next = answers.shift(); return { value: { carousel_json: JSON.stringify(typeof next === "function" ? next(request) : next) }, usage: { input_tokens: 1, output_tokens: 1 } }; } }
  };
}

const notBuilt = (stage) => async () => { throw new Error(`launchclip carousel ${stage} is not built yet (docs/CAROUSELS_RFC.md)`); };
const stubStages = { render: notBuilt("render"), check: notBuilt("check"), export: notBuilt("export") };

async function make(brief, flags, model, stages = stubStages) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "carousel-make-"));
  try {
    const report = await run(brief, { out: path.join(dir, "out"), json: true, seed: "7f3a91c2", ...flags }, { client: model, stages, stdout: { write() {} }, stderr: { write() {} }, env: {} });
    const story = JSON.parse(await readFile(path.join(dir, "out", "storyboard.json"), "utf8"));
    return { report, story };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test("auto arc: the model picks it, the plan names the arcs, and the arc's goal is the default", async () => {
  const model = fakeModel(listicle({ arc: "how-to" }));
  const { report, story } = await make("how to ship faster", {}, model);
  assert.match(model.requests[0].instructions, /Pick the arc/);
  assert.equal(story.carousel.arc, "how-to");
  assert.equal(story.carousel.goal, "save");
  assert.equal(report.arc, "how-to");
});

test("--slides is clamped to the smallest destination limit", async () => {
  assert.deepEqual(slideRange({ arc: null, destinations: ["instagram", "x"], slides: 9 }), { min: 1, max: 4, exact: 4 });
  const four = listicle();
  four.slides.splice(1, 1);
  const model = fakeModel(four);
  const { story } = await make("fast teams", { arc: "listicle", dest: "instagram,x", slides: "9" }, model);
  assert.match(model.requests[0].instructions, /Make exactly 4 slides/);
  assert.equal(story.scenes.length, 4);
  assert.deepEqual(story.carousel.destinations, ["instagram", "x"]);
});

test("editorial modules are never offered, and one is refused", async () => {
  const offered = slideModules({ photos: true }).map((module) => module.id);
  assert.ok(offered.length > 50);
  assert.ok(offered.every((id) => !isEditorialKind(id)));
  assert.ok(!slideModules().some((module) => module.id === "photo-scene"), "photo modules need photos");
  const model = fakeModel(listicle({ slides: listicle().slides.map((entry) => (entry.id === "one" ? { ...entry, module: "checklist", params: { title: "x" } } : entry)) }), listicle());
  const { report } = await make("fast teams", { arc: "listicle" }, model);
  assert.ok(!/### checklist/.test(model.requests[0].instructions));
  assert.match(report.plan_attempts[0].errors.join("\n"), /checklist, which is not a slide module/);
});

test("repair round: the errors go back in one call; a second failure fails clearly", async () => {
  const noPayoff = listicle({ slides: listicle().slides.filter((entry) => entry.role !== "payoff") });
  const model = fakeModel(noPayoff, listicle());
  const { report } = await make("fast teams", { arc: "listicle" }, model);
  assert.equal(model.requests.length, 2);
  assert.match(model.requests[1].input, /needs a payoff slide/);
  assert.deepEqual(report.plan_attempts.map((entry) => entry.ok), [false, true]);
  await assert.rejects(make("fast teams", { arc: "listicle" }, fakeModel(noPayoff, noPayoff)), /could not be planned[\s\S]*payoff/);
});

test("caption and alt text are required and written", async () => {
  const blank = listicle({ caption: { hook: "", body: "", cta: "", tags: [] }, slides: listicle().slides.map((entry) => ({ ...entry, alt: "" })) });
  const model = fakeModel(blank, listicle());
  const { story, report } = await make("fast teams", {}, model);
  const errors = report.plan_attempts[0].errors.join("\n");
  assert.match(errors, /caption.hook is empty/);
  assert.match(errors, /needs alt text/);
  assert.equal(story.carousel.caption.hook, "Most teams are not slow. They wait.");
  assert.ok(story.scenes.every((scene) => scene.slide.alt && scene.slide.medium === "still"));
});

test("stages that are not built yet are pending; the plan still succeeds", async () => {
  const { report } = await make("fast teams", {}, fakeModel(listicle()));
  assert.equal(report.status, "planned");
  assert.deepEqual(Object.values(report.stages).map((entry) => entry.status), ["pending", "pending", "pending"]);
  const ran = [];
  const built = { render: async (project) => { ran.push(path.basename(project)); return { slides: 5 }; }, check: async () => ({ ok: true }), export: notBuilt("export") };
  const second = await make("fast teams", {}, fakeModel(listicle()), built);
  assert.deepEqual([second.report.stages.render.status, second.report.stages.check.status, second.report.stages.export.status], ["done", "done", "pending"]);
  assert.deepEqual(ran, ["out"]);
  await assert.rejects(make("fast teams", {}, fakeModel(listicle()), { ...stubStages, render: async () => { throw new Error("chromium crashed"); } }), /carousel render failed .*chromium crashed/);
});

test("an optional param a slide's module refuses is taken off without a repair call", async () => {
  const model = fakeModel(listicle({ slides: listicle().slides.map((entry) => (entry.id === "cta" ? { ...entry, params: { ...entry.params, icon: "bell" } } : entry)) }));
  const { story, report } = await make("fast teams", { arc: "listicle" }, model);
  assert.equal(model.requests.length, 1);
  assert.equal(story.scenes.at(-1).params.icon, undefined);
  assert.match(report.warnings.join("\n"), /cta: tooling took params.icon off/);
});

test("a refused param that is required is reported as refused, not as missing", async () => {
  const long = listicle({ slides: listicle().slides.map((entry) => (entry.id === "two" ? { ...entry, params: { text: "Ship the smallest change that works ".repeat(4).trim() } } : entry)) });
  const { report } = await make("fast teams", { arc: "listicle" }, fakeModel(long, listicle()));
  const errors = report.plan_attempts[0].errors.join("\n");
  assert.match(errors, /two \(motion-title\) does not lay out/);
  assert.doesNotMatch(errors, /is required/);
});
