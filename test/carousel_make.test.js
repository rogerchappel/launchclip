// launchclip carousel make with a stubbed model (src/carousel/make.js, plan.js).
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { isEditorialKind } from "@launchclip/core/modules.mjs";
import { run } from "../src/carousel/make.js";
import { planToStory, slideModules, slideRange } from "../src/carousel/plan.js";

const slide = (id, role, module, params, alt = `${id} slide`) => ({ id, role, module, params, alt });
const listicle = (extra = {}) => ({
  title: "Three habits of fast teams",
  arc: "listicle",
  goal: "save",
  caption: { hook: "Most teams are not slow. They wait.", body: "Where the waiting hides in a week.", cta: "Save this for planning.", tags: ["productivity"] },
  slides: [
    slide("cover", "cover", "hook-title", { headline: "3 habits that make teams ship faster", emphasis: "ship faster", kicker: "Swipe" }),
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
  assert.match(model.requests[0].instructions, /reads as a how-to carousel; keep that arc unless/);
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

test("repair round: the check's plan rules that fail go to the repair call", async () => {
  const leaky = listicle({ slides: listicle().slides.map((entry) => entry.id === "one" ? { ...entry, params: { headline: "Slide 2: Decide in the thread" } } : entry) });
  const model = fakeModel(leaky, listicle());
  const { report } = await make("fast teams", { arc: "listicle" }, model);
  assert.equal(model.requests.length, 2);
  assert.match(model.requests[1].input, /- scaffold-leak \(slide 2\): "Slide 2:" is a planning label/);
  assert.deepEqual(report.plan_attempts.map((entry) => entry.ok), [false, true]);
  // A rule story validation already reports (payoff) is said once.
  const noPayoff = listicle({ slides: listicle().slides.filter((entry) => entry.role !== "payoff") });
  const once = fakeModel(noPayoff, listicle());
  const second = await make("fast teams", { arc: "listicle" }, once);
  assert.equal(second.report.plan_attempts[0].errors.filter((line) => line.includes("needs a payoff slide")).length, 1);
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

test("a plan of slide content is laid out by a template: --template, or picked from the brief", async () => {
  const content = listicle({ slides: [
    { id: "cover", role: "cover", headline: "3 habits of teams that ship daily", alt: "cover" },
    { id: "one", role: "body", eyebrow: "01", headline: "Decide in the thread", body: "A written call travels further.", alt: "one" },
    { id: "summary", role: "payoff", headline: "Save this", items: ["Decide in thread", "Ship small"], alt: "list" },
    { id: "cta", role: "cta", headline: "Save it for your sprint", handle: "fast.test", alt: "cta" }
  ] });
  const model = fakeModel(content);
  const { story } = await make("habits of fast teams", { arc: "listicle", template: "bold-statement" }, model);
  assert.match(model.requests[0].instructions, /tooling lays them out with a carousel template/);
  assert.equal(story.carousel.template, "bold-statement");
  assert.deepEqual(story.scenes.map((scene) => scene.module), ["hook-title", "motion-title", "item-list", "cta"]);
  assert.deepEqual(story.background, { kind: "flat" });
  assert.equal(story.brand.palette, "as-given", "the template's brand ground");
  // A step slide is the headline alone, so the other templates get the slide without its line.
  const plain = listicle({ slides: content.slides.map(({ body, ...slide }) => slide) });
  const auto = await make("habits of fast teams", { arc: "listicle" }, fakeModel(plain));
  assert.ok(["numbered-steps", "plain-note", "plain-note-dark"].includes(auto.story.carousel.template), auto.story.carousel.template);
  const long = fakeModel(listicle({ slides: plain.slides.map((slide) => (slide.id === "one" ? { ...slide, headline: "x".repeat(70) } : slide)) }), plain);
  const { report } = await make("habits", { arc: "listicle", template: "numbered-steps" }, long);
  assert.match(report.plan_attempts[0].errors.join("\n"), /headline is 70 characters; the numbered-steps template's step slide holds 48/);
});

test("slide copy is one plain line: no line breaks or angle brackets reach a module", () => {
  const plan = { slides: [{ id: "only", role: "cover", headline: "Open studio\nday", body: "Saturday <10am to 4pm>\n22 Wharf Street", alt: "the date", items: undefined }] };
  const story = planToStory(plan, { arc: "single", goal: "visit", destinations: ["instagram"], brand: null, template: "plain-note" });
  const text = JSON.stringify(story.scenes[0].params);
  assert.ok(!/[<>]|\\n/.test(text), text);
  assert.match(text, /Open studio day/);
});

// A generate command: a fixed price, the fixture still for a keyframe and a 6 s fixture clip for the video.
const FIXTURES = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "parity", "assets");
const GENERATE = `import { createInterface } from "node:readline";
createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, op, step } = JSON.parse(line);
  const file = step === "video" ? ${JSON.stringify(path.join(FIXTURES, "shots", "blocks-static.mp4"))} : ${JSON.stringify(path.join(FIXTURES, "testsrc.png"))};
  console.log(JSON.stringify(op === "quote" ? { id, amount: 0.25, unit: "usd" } : { id, file, model: "test-" + step, licence: "test fixture" }));
});`;

test("a video carousel: cards sized 2-10 s, handed-in and generated footage under free type, drawn cards, no forced loop", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "carousel-video-"));
  try {
    const clips = path.join(dir, "clips");
    await mkdir(clips);
    await copyFile(path.join(FIXTURES, "shots", "blocks-static.mp4"), path.join(clips, "blocks.mp4"));
    const script = path.join(dir, "gen.mjs");
    await writeFile(script, GENERATE);
    const plan = {
      title: "Three ways to stack blocks", arc: "listicle", goal: "save",
      caption: { hook: "Stacking blocks is a skill.", body: "Three ways that hold.", cta: "Save this for later.", tags: ["blocks"] },
      slides: [
        { id: "cover", role: "cover", headline: "3 ways to stack blocks that hold", alt: "Headline over a shot of blocks", seconds: 4, clip: "assets/clips/blocks.mp4", clip_start: 9 },
        { id: "beat", role: "body", headline: "Start wide at the base", alt: "Headline on the brand ground", seconds: 1 },
        { id: "made", role: "body", headline: "Lock every second row", alt: "Headline over generated footage", seconds: 5, image: "wooden blocks stacked on a table in soft light" },
        { id: "summary", role: "payoff", headline: "Wide, locked, light on top", alt: "The summary", seconds: 14 },
        { id: "cta", role: "cta", headline: "Save this for your next build", alt: "Save prompt", seconds: 3 }
      ]
    };
    const model = fakeModel((request) => { assert.match(request.instructions, /video carousel/); assert.match(request.instructions, /assets\/clips\/blocks\.mp4 \(6 s\)/); return plan; }, { ...plan, slides: plan.slides.map((entry) => (entry.id === "cover" ? { ...entry, clip_start: 1 } : entry)) });
    const out = path.join(dir, "out");
    const report = await run("three ways to stack blocks", { out, json: true, seed: "7f3a91c2", arc: "listicle", template: "cinematic-dark", clips, generate: `cmd:${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`, budget: "2usd" }, { client: model, stages: stubStages, stdout: { write() {} }, stderr: { write() {} }, env: {} });
    // The first plan ran the cover's clip past its end (9 s + 4 s of a 6 s clip); the repair fixed it.
    assert.match(report.plan_attempts[0].errors.join("\n"), /cover: assets\/clips\/blocks\.mp4 is 6 s long/);
    const story = JSON.parse(await readFile(path.join(out, "storyboard.json"), "utf8"));
    assert.ok(story.scenes.every((scene) => scene.slide.medium === "motion"));
    assert.deepEqual(story.scenes.map((scene) => scene.end - scene.start), [4, 2, 5, 10, 3], "seconds clamped to 2-10");
    assert.equal(story.format.duration, 24);
    assert.ok(story.scenes.every((scene) => scene.loop === undefined), "a card loops only when the plan asks");
    assert.deepEqual(report.cards.map((card) => [card.id, card.kind, card.source ?? null]), [["cover", "footage", "assets/clips/blocks.mp4"], ["beat", "drawn", null], ["made", "footage", "assets/generated/made.mp4"], ["summary", "drawn", null], ["cta", "drawn", null]]);
    // The generated clip went through the keyframe first, and the card starts past its padding.
    assert.equal(report.images.made[0].source.made_with, "cmd:test-image → cmd:test-video");
    const made = story.scenes[2];
    const start = made.plate?.params.start ?? made.params.media.sourceStart;
    assert.ok(start > 0);
    await readFile(path.join(out, "assets", "generated", "made.mp4"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a footage card the template has no photo layout for is the template's full-bleed slide over the clip", () => {
  const plan = { slides: [
    { id: "cover", role: "cover", headline: "Start a project in under a minute", alt: "Headline over the app", seconds: 3, clip: "assets/clips/app.mp4" },
    { id: "pick", role: "body", headline: "Pick a template", body: "Then invite your team", alt: "Over the app", seconds: 4, clip: "assets/clips/app.mp4", clip_start: 2 }
  ] };
  const story = planToStory(plan, { arc: "how-to", goal: "save", destinations: ["instagram"], brand: null, template: "numbered-steps", video: true });
  const [cover, pick] = story.scenes;
  assert.equal(cover.module, "photo-scene");
  assert.equal(cover.params.title, "Start a project in under a minute", "the cover keeps its headline for the check");
  assert.ok(cover.params.lines.every((line) => line.text.length <= 22), JSON.stringify(cover.params.lines));
  assert.match(cover.params.lines.at(-1).text, /→/, "the cover asks for the swipe");
  assert.deepEqual(pick.params.media, { src: "assets/clips/app.mp4", sourceStart: 2 });
});

// Generated backgrounds and the panorama (make --background / --panorama).
const textPlan = (extra = {}) => ({
  title: "Quiet mornings", arc: "listicle", goal: "save",
  caption: { hook: "Mornings set the day.", body: "Three small habits.", cta: "Save this for tomorrow.", tags: ["mornings"] },
  slides: [
    { id: "cover", role: "cover", headline: "3 quiet habits for calmer mornings", alt: "Headline" },
    { id: "light", role: "body", headline: "Open the curtains first", alt: "Headline" },
    { id: "water", role: "body", headline: "Drink a glass of water", alt: "Headline" },
    { id: "summary", role: "payoff", headline: "Light, water, a slow start", alt: "Summary" },
    { id: "cta", role: "cta", headline: "Save this for tomorrow", alt: "Save prompt" }
  ],
  ...extra
});

test("a shared generated background sits under every type slide, behind the template's reading layer", async () => {
  const { carouselProblems } = await import("@launchclip/core/carousel.mjs");
  const plan = textPlan({ background: { mode: "shared", image: "soft morning light on a linen wall" } });
  const story = planToStory(plan, { arc: "listicle", goal: "save", destinations: ["instagram"], brand: null, template: "plain-note", extras: { background: null, panorama: null } });
  assert.deepEqual(story.carousel.background, { mode: "shared", shows: "soft morning light on a linen wall" });
  for (const scene of story.scenes) assert.equal(scene.plate?.params.src, "assets/generated/background.png", scene.id);
  assert.equal(story.scenes[0].plate.kind, "image");
  assert.ok(story.scenes[0].plate.params.dim >= 0.4, "under a reading layer");
  assert.deepEqual(carouselProblems(story), []);
  // Without --generate (no extras) the plan's background is ignored.
  assert.ok(planToStory(plan, { arc: "listicle", goal: "save", destinations: ["instagram"], brand: null, template: "plain-note" }).scenes.every((scene) => !scene.plate));
  assert.match(carouselProblems({ ...story, carousel: { ...story.carousel, background: { mode: "wall" } } }).join("\n"), /carousel.background must be/);
});

test("per-slide video backgrounds are looping-length video plates; a footage card keeps its clip", () => {
  const plan = textPlan({ slides: textPlan().slides.map((slide, i) => ({ ...slide, seconds: 3 + i, background: `slow mist over water, take ${i + 1}` })) });
  plan.slides[1] = { ...plan.slides[1], clip: "assets/clips/a.mp4" };
  const story = planToStory(plan, { arc: "listicle", goal: "save", destinations: ["instagram"], brand: null, template: "plain-note", video: true, extras: { background: "per-slide", panorama: true } });
  assert.equal(story.scenes[0].plate.kind, "video");
  assert.equal(story.scenes[0].plate.params.src, "assets/generated/cover-background.mp4");
  assert.equal(story.scenes[0].plate.params.start, 0);
  assert.notEqual(story.scenes[1].plate?.params.src ?? story.scenes[1].params.media?.src, "assets/generated/light-background.mp4");
  assert.equal(story.carousel.panorama, undefined, "a video carousel takes no panorama");
});

test("a panorama spans its slides, which take no background; an image under it goes to the repair", async () => {
  const { extrasErrors } = await import("../src/carousel/plan.js");
  const plan = textPlan({ background: { mode: "shared", image: "warm dawn haze" }, panorama: { image: "a wide valley at dawn", slides: [1, 3] } });
  const story = planToStory(plan, { arc: "listicle", goal: "save", destinations: ["instagram"], brand: null, template: "plain-note", extras: { background: null, panorama: null } });
  assert.deepEqual(story.carousel.panorama, { src: "assets/generated/panorama.png", slides: [1, 3] });
  assert.deepEqual(story.camera, { mode: "cuts" }, "slices meet only without the world camera");
  assert.deepEqual(story.scenes.map((scene) => scene.plate?.params.src ?? null), [null, null, null, "assets/generated/background.png", "assets/generated/background.png"]);
  assert.deepEqual(extrasErrors(plan, story), []);
  // A bad span falls back to the first three slides; a missing image is an error.
  const loose = planToStory({ ...plan, panorama: { slides: [4, 2] } }, { arc: "listicle", goal: "save", destinations: ["instagram"], brand: null, template: "plain-note", extras: { background: "none", panorama: true } });
  assert.deepEqual(loose.carousel.panorama.slides, [1, 3]);
  assert.match(extrasErrors({ ...plan, panorama: {} }, loose).join("\n"), /panorama.image/);
  loose.scenes[1].plate = { kind: "image", params: { src: "assets/generated/light.png" } };
  assert.match(extrasErrors(plan, loose).join("\n"), /slide 2 \(light\) is under the panorama/);
});

test("make --background shared --panorama: one batch, the background file, and a panorama plate of exactly span × width", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "carousel-backdrops-"));
  try {
    const script = path.join(dir, "gen.mjs");
    await writeFile(script, GENERATE);
    const plan = textPlan({ background: { mode: "shared", image: "soft morning light on a linen wall" }, panorama: { image: "a wide valley at dawn with open sky", slides: [1, 3] } });
    const model = fakeModel((request) => { assert.match(request.instructions, /one generated background/); assert.match(request.instructions, /one wide generated panorama/); return plan; });
    const out = path.join(dir, "out");
    const report = await run("three quiet habits for calmer mornings", { out, json: true, seed: "7f3a91c2", arc: "listicle", template: "plain-note", background: "shared", panorama: true, generate: `cmd:${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`, budget: "2usd" }, { client: model, stages: stubStages, stdout: { write() {} }, stderr: { write() {} }, env: {} });
    assert.deepEqual(report.images.backgrounds.map((entry) => entry.file), ["assets/generated/background.png", "assets/generated/panorama.png"]);
    const story = JSON.parse(await readFile(path.join(out, "storyboard.json"), "utf8"));
    assert.deepEqual(story.carousel.panorama.slides, [1, 3]);
    const { probeMedia } = await import("../src/media_trim.js");
    const stream = (await probeMedia(path.join(out, "assets", "generated", "panorama.png"))).streams[0];
    assert.deepEqual([stream.width, stream.height], [3 * 1080, 1350]);
    await readFile(path.join(out, "assets", "generated", "background.png"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("--background takes shared, per-slide, none or auto", async () => {
  await assert.rejects(make("a brief", { background: "wall" }, fakeModel()), /--background must be shared, per-slide, none or auto/);
});

test("a plan that names its arc in prose keeps the arc it leads with, and a type-only slide's alt is its words", async () => {
  const plan = listicle({ arc: "how-to: one step per slide, then a recipe to save" });
  const model = fakeModel(plan);
  const { report, story } = await make("fast teams", {}, model);
  assert.equal(report.plan_attempts[0].ok, true, report.plan_attempts[0].errors.join("\n"));
  assert.equal(story.carousel.arc, "how-to");
  const words = planToStory({ slides: [{ id: "a", role: "cta", headline: "Save this list", body: "Before you record" }] }, { arc: "listicle", goal: "save", destinations: ["instagram"], brand: null, template: "bold-statement" });
  assert.equal(words.scenes[0].slide.alt, "Save this list. Before you record");
});

test("a slide on a plate keeps its background on under a style pack that turns plates off", async () => {
  const { scenePlatePlan } = await import("@launchclip/core/plates.mjs");
  const plan = { slides: [
    { id: "cover", role: "cover", headline: "Start a project in under a minute", alt: "Over the app", seconds: 3, clip: "assets/clips/app.mp4" },
    { id: "cta", role: "cta", headline: "Save this setup", alt: "Save prompt", seconds: 3 }
  ] };
  const story = planToStory(plan, { arc: "how-to", goal: "save", destinations: ["instagram"], brand: null, template: "cinematic-dark", video: true });
  const packed = { ...story, ambient: { background: false } };
  assert.ok(scenePlatePlan(packed, packed.scenes[0]), "the clip's plate draws");
  assert.equal(packed.scenes[1].ambient, undefined, "a slide with no plate keeps the pack's setting");
  const lit = planToStory({ slides: [{ id: "a", role: "cover", headline: "Our launch in three numbers", alt: "Headline" }] }, { arc: "data", goal: "save", destinations: ["instagram"], brand: null, template: "lit-window" });
  assert.equal(lit.scenes[0].ambient?.background, true, "the template's own light is a plate too");
});
