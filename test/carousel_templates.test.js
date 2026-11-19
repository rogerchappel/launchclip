// Carousel templates (kit/core/carousel-templates.mjs): grammar picking,
// template validation, copy caps, auto-pick, and the samples under examples/carousel.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CAROUSEL_ARC_IDS, carouselProblems } from "@launchclip/core/carousel.mjs";
import { CAROUSEL_GRAMMARS, CAROUSEL_TEMPLATES, CAROUSEL_TEMPLATE_IDS, MIN_BODY_PX, MIN_HEADLINE_PX, contrastRatio, layoutCarousel, lightBrand, pickTemplate, slideCaps, slideGrammar, templateCopyProblems, templateProblems, templateScores } from "@launchclip/core/carousel-templates.mjs";
import { validateStory } from "@launchclip/core/story.mjs";
import { validateModuleParams } from "@launchclip/core/module-schemas.mjs";
import { declaredTextBoxes } from "../src/carousel/check.js";
import { SAMPLE_PROJECTS, sampleStory } from "../scripts/carousel-template-samples.mjs";

const studyNotes = CAROUSEL_TEMPLATES["study-notes"];

test("every template is sound, and the eight cover the RFC's use cases", () => {
  assert.equal(CAROUSEL_TEMPLATE_IDS.length, 8);
  for (const id of CAROUSEL_TEMPLATE_IDS) assert.deepEqual(templateProblems(id, undefined, { arcIds: CAROUSEL_ARC_IDS }), []);
  for (const arc of ["ad", "listicle", "how-to", "story", "quote", "data", "myth-fact", "before-after"]) assert.ok(CAROUSEL_TEMPLATE_IDS.some((id) => CAROUSEL_TEMPLATES[id].arcs.includes(arc)), `${arc} has a template`);
  assert.ok(CAROUSEL_TEMPLATE_IDS.some((id) => CAROUSEL_TEMPLATES[id].ground === "light"), "a light template");
  // No fixed colours: a template names the brand's roles, never a hex.
  assert.doesNotMatch(JSON.stringify(CAROUSEL_TEMPLATES), /#[0-9a-f]{3,6}\b/i);
});

test("template validation refuses a mixed ground, an unknown grammar and a brand surface without its plate", () => {
  const broken = { ...studyNotes, surface: { ...studyNotes.surface, body: "light" }, grammar: { ...studyNotes.grammar, payoff: "mosaic" }, brandPlate: null };
  const errors = templateProblems("broken", broken).join("\n");
  assert.match(errors, /surface\.body is light on a dark ground/);
  assert.match(errors, /grammar\.payoff must be one of/);
  assert.match(errors, /needs a brandPlate/);
});

test("grammar picking: a pair, a figure, a list, the cover, a photo", () => {
  assert.equal(slideGrammar({ role: "body", headline: "Myth: remote teams talk less", body: "Fact: they write more" }), "two-region");
  assert.equal(slideGrammar({ role: "body", headline: "After: every merge ships", body: "Before: a weekly train" }), "two-region");
  assert.equal(slideGrammar({ role: "body", headline: "Don't: ship on Friday", body: "Do: ship midweek" }), "two-region");
  assert.equal(slideGrammar({ role: "body", headline: "80% less time on release prep" }), "proof-stat");
  assert.equal(slideGrammar({ role: "body", headline: "It pays", body: "$1,400 back a month" }), "proof-stat");
  assert.equal(slideGrammar({ role: "body", headline: "3.4× more rollbacks on Fridays" }), "proof-stat");
  assert.equal(slideGrammar({ role: "body", headline: "Saved", stat: { value: "12 h", label: "a week" } }), "proof-stat");
  assert.equal(slideGrammar({ role: "body", headline: "3 habits that make teams ship faster" }), "text-card", "a count of habits is not a proof figure");
  assert.equal(slideGrammar({ role: "payoff", headline: "Save this", items: ["One", "Two"] }), "steps");
  assert.equal(slideGrammar({ role: "body", headline: "The routine", body: "First stretch, then jog, finally cool down" }), "steps");
  assert.equal(slideGrammar({ role: "cover", headline: "The year I ran", photo: "assets/a.jpg" }), "full-bleed");
  assert.equal(slideGrammar({ role: "cover", headline: "The year I ran" }), "text-card");
  assert.equal(slideGrammar({ role: "body", headline: "One view", photo: "assets/a.jpg" }), "image-panel");
  assert.equal(slideGrammar({ role: "body", headline: "One view" }), "text-card");
  assert.equal(slideGrammar({ role: "cta", headline: "Save 50% today" }), "text-card", "the cta is the cta");
  // The template's choice for a role, when the slide has what it needs.
  assert.equal(slideGrammar({ role: "body", headline: "Week one", photo: "assets/a.jpg" }, CAROUSEL_TEMPLATES["photo-diary"]), "full-bleed");
  assert.equal(slideGrammar({ role: "cover", headline: "Release prep" }, CAROUSEL_TEMPLATES["then-now"]), "text-card", "full-bleed needs a photo");
});

test("caps: a template's caps sit inside each grammar's, and copy over them is said for the repair", () => {
  for (const id of CAROUSEL_TEMPLATE_IDS) for (const grammar of Object.keys(CAROUSEL_GRAMMARS)) {
    const caps = slideCaps(CAROUSEL_TEMPLATES[id], grammar);
    assert.ok(caps.headline <= CAROUSEL_GRAMMARS[grammar].caps.headline && caps.body <= CAROUSEL_GRAMMARS[grammar].caps.body);
  }
  const errors = templateCopyProblems("study-notes", [
    { id: "a", role: "body", headline: "x".repeat(49) },
    { id: "b", role: "payoff", headline: "List", items: ["one", "two", "three", "four", "five", "six", "seven"] },
    { id: "c", role: "body", headline: "Myth: " + "y".repeat(41), body: "Fact: short" },
    { id: "d", role: "body", quote: { text: "Words" } },
    { id: "e", role: "body", headline: "Fine", body: "Short enough" }
  ]).join("\n");
  assert.match(errors, /slides\[0\] \(a\) headline is 49 characters; the study-notes template's text-card slide holds 48/);
  assert.match(errors, /slides\[1\] \(b\) has 7 items; a list holds 6/);
  assert.match(errors, /"Myth" side is 41 characters; a two-region side holds 40/);
  assert.match(errors, /quote needs its exact words and the person/);
  assert.doesNotMatch(errors, /\(e\)/);
  assert.match(templateCopyProblems("nope", [])[0], /is not a template/);
});

test("auto-pick: the brief's words, the arc and photos lead; the seed varies the pick among close ones", () => {
  const best = (brief, arc, images = false) => templateScores({ brief, arc, images }).sort((a, b) => b.score - a.score)[0].id;
  assert.equal(best("launch ad for our saas dashboard app, install today", "ad"), "product-proof");
  assert.equal(best("myths about remote work, the truth", "myth-fact"), "myth-split");
  assert.equal(best("survey report: release data and growth trends", "data"), "signal-report");
  assert.equal(best("my year of running before work, a personal story", "story", true), "photo-diary");
  assert.equal(best("a monday motivation quote", "quote"), "quiet-quote");
  assert.equal(pickTemplate({ template: "then-now", brief: "myths" }), "then-now", "carousel.template wins");
  assert.throws(() => pickTemplate({ template: "glossy" }), /carousel.template must be one of/);
  const seeds = Array.from({ length: 24 }, (_, i) => pickTemplate({ brief: "habits of fast teams", arc: "listicle", seed: `style-${i}` }));
  assert.ok(new Set(seeds).size >= 2, "different seeds pick different close templates");
  assert.ok(seeds.every((id) => CAROUSEL_TEMPLATES[id].arcs.includes("listicle")), "only close ones");
  assert.equal(pickTemplate({ brief: "habits of fast teams", arc: "listicle", seed: "style-3" }), seeds[3], "the same seed picks the same template");
});

test("carousel.template is a carousel field, checked against the templates", async () => {
  const story = JSON.parse(await readFile(new URL("../examples/carousel/listicle-4x5/storyboard.json", import.meta.url), "utf8"));
  assert.deepEqual(carouselProblems({ ...story, carousel: { ...story.carousel, template: "study-notes" } }), []);
  assert.match(carouselProblems({ ...story, carousel: { ...story.carousel, template: "glossy" } }).join("\n"), /carousel.template must be one of/);
});

test("layout: surfaces become plates; a light ground turns the brand over with readable type", () => {
  const slides = [{ id: "c", role: "cover", headline: "Big promise" }, { id: "b", role: "body", headline: "Point", photo: "assets/p.jpg" }, { id: "x", role: "cta", headline: "Follow", photo: "assets/p.jpg" }];
  const dark = layoutCarousel("photo-diary", slides);
  assert.deepEqual(dark.story.plate, { kind: "grain", params: { tint: "neutral" } });
  assert.equal(dark.scenes[1].module, "photo-scene");
  assert.deepEqual(dark.scenes[2].plate, { kind: "image", params: { src: "assets/p.jpg", dim: 0.6, blur: 6 } }, "on-image under a type slide: the photo behind a 0.6 reading layer");
  assert.equal(layoutCarousel("study-notes", slides).scenes[0].plate.params.tint, "primary", "brand surface: a plate lit in the brand's primary");
  const brand = { colors: { bg: "#13151a", primary: "#ffb020", accent: "#ff6b5f", ink: "#13151a", paper: "#f5f1e8" } };
  const light = layoutCarousel("field-notes", slides, { brand }).story.brand;
  assert.equal(light.palette, "as-given");
  assert.equal(light.colors.bg, "#f5f1e8");
  assert.equal(light.colors.paper, "#13151a");
  for (const key of ["paper", "primary", "accent"]) assert.ok(contrastRatio(light.colors[key], light.colors.bg) >= 4.5, `${key} reads on the light ground`);
  assert.equal(lightBrand({ colors: {} }).colors.bg, undefined, "no colours, nothing to turn over");
  assert.throws(() => layoutCarousel("study-notes", slides, { aspect: "16:9" }), /lays out at 4:5, 1:1, 9:16/);
});

test("samples: one per template, current with the templates, valid, and laid out at 4:5, 1:1 and 9:16 above the type floors", async () => {
  const templates = new Set(Object.values(SAMPLE_PROJECTS).map(([id]) => id));
  assert.deepEqual([...templates].sort(), [...CAROUSEL_TEMPLATE_IDS].sort());
  for (const [folder, [template, sample]] of Object.entries(SAMPLE_PROJECTS)) {
    const story = JSON.parse(await readFile(new URL(`../examples/carousel/${folder}/storyboard.json`, import.meta.url), "utf8"));
    assert.deepEqual(story, sampleStory(folder), `${folder} is current (node scripts/carousel-template-samples.mjs)`);
    assert.equal(story.carousel.template, template);
    assert.deepEqual(carouselProblems(story), [], folder);
    assert.deepEqual(validateStory(story, { moduleParams: validateModuleParams }).errors, [], folder);
    assert.deepEqual(templateCopyProblems(template, sample.slides), [], folder);
    for (const [width, height] of [[1080, 1350], [1080, 1080], [1080, 1920]]) {
      for (const box of declaredTextBoxes(story, { width, height })) {
        assert.equal(box.error, undefined, `${folder} ${box.id} at ${width}×${height}: ${box.error}`);
        const floor = (box.role === "cover" ? MIN_HEADLINE_PX : MIN_BODY_PX) * (width / 1080);
        for (const text of box.texts) assert.ok(text.fontSize >= floor, `${folder} ${box.id} at ${width}×${height}: ${text.fontSize} px under ${floor}`);
      }
    }
  }
});
