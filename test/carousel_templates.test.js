// Carousel templates (kit/core/carousel-templates.mjs): grammar picking,
// template validation, copy caps, auto-pick, and the samples under examples/carousel.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CAROUSEL_ARC_IDS, carouselProblems } from "@launchclip/core/carousel.mjs";
import { CAROUSEL_GRAMMARS, CAROUSEL_TEMPLATES, CAROUSEL_TEMPLATE_IDS, MIN_BODY_PX, MIN_HEADLINE_PX, contrastRatio, layoutCarousel, lightBrand, pickTemplate, slideCaps, slideFigure, slideGrammar, templateCopyProblems, templateProblems, templateScores } from "@launchclip/core/carousel-templates.mjs";
import { validateStory } from "@launchclip/core/story.mjs";
import { validateModuleParams } from "@launchclip/core/module-schemas.mjs";
import { declaredTextBoxes } from "../src/carousel/check.js";
import { SAMPLE_PROJECTS, sampleStory } from "../scripts/carousel-template-samples.mjs";

const steps = CAROUSEL_TEMPLATES["numbered-steps"];

test("every template is sound; the proven styles and LaunchClip's own cover the RFC's use cases", () => {
  assert.equal(CAROUSEL_TEMPLATE_IDS.length, 11);
  for (const id of CAROUSEL_TEMPLATE_IDS) assert.deepEqual(templateProblems(id, undefined, { arcIds: CAROUSEL_ARC_IDS }), []);
  for (const arc of ["ad", "listicle", "how-to", "story", "quote", "data", "myth-fact", "before-after"]) assert.ok(CAROUSEL_TEMPLATE_IDS.some((id) => CAROUSEL_TEMPLATES[id].arcs.includes(arc)), `${arc} has a template`);
  for (const ground of ["dark", "light", "brand"]) assert.ok(CAROUSEL_TEMPLATE_IDS.some((id) => CAROUSEL_TEMPLATES[id].ground === ground), `a ${ground} ground`);
  // No fixed colours: a template names the brand's roles, never a hex.
  assert.doesNotMatch(JSON.stringify(CAROUSEL_TEMPLATES), /#[0-9a-f]{3,6}\b/i);
});

test("template validation refuses a mixed ground, an unknown grammar, a content-only grammar and a photo surface without a reading layer", () => {
  const broken = { ...steps, surface: { ...steps.surface, body: "light", cover: "on-image" }, grammar: { ...steps.grammar, payoff: "mosaic", body: "proof-stat" }, reading: undefined };
  const errors = templateProblems("broken", broken).join("\n");
  assert.match(errors, /surface\.body is light on a dark ground/);
  assert.match(errors, /grammar\.payoff must be one of/);
  assert.match(errors, /grammar\.body is proof-stat, which only content asks for/);
  assert.match(errors, /surface\.cover is on-image, so the template needs a reading layer/);
  assert.match(templateProblems("lit", { ...CAROUSEL_TEMPLATES["lit-window"], surface: { ...CAROUSEL_TEMPLATES["lit-window"].surface, cta: "brand" } }).join("\n"), /needs a brandPlate/);
});

test("grammar picking: a pair, a figure, a list, the cover, a photo, then the template's choice", () => {
  assert.equal(slideGrammar({ role: "body", headline: "Myth: remote teams talk less", body: "Fact: they write more" }), "two-region");
  assert.equal(slideGrammar({ role: "body", headline: "After: every merge ships", body: "Before: a weekly train" }), "two-region");
  assert.equal(slideGrammar({ role: "body", headline: "Don't: ship on Friday", body: "Do: ship midweek" }), "two-region");
  assert.equal(slideGrammar({ role: "body", headline: "80% less time on release prep" }), "proof-stat");
  assert.equal(slideGrammar({ role: "body", headline: "It pays", body: "$1,400 back a month" }), "proof-stat");
  assert.equal(slideGrammar({ role: "body", headline: "3.4× more rollbacks on Fridays" }), "proof-stat");
  assert.equal(slideGrammar({ role: "body", headline: "Saved", stat: { value: "12 h", label: "a week" } }), "proof-stat");
  assert.equal(slideGrammar({ role: "body", headline: "3 habits that make teams ship faster" }), "text-card", "a count of habits is not a proof figure");
  assert.equal(slideGrammar({ role: "cover", headline: "A weekly review in 20 minutes" }), "text-card", "a cover stays the promise");
  assert.deepEqual(slideFigure({ headline: "Median commute saved: 52 minutes a day" }), { value: "52 minutes", label: "Median commute saved: a day", source: null }, "a word unit stays whole");
  assert.equal(slideFigure({ headline: "$2m raised" }).value, "$2m");
  assert.equal(slideGrammar({ role: "payoff", headline: "Save this", items: ["One", "Two"] }), "steps");
  assert.equal(slideGrammar({ role: "body", headline: "The routine", body: "First stretch, then jog, finally cool down" }), "steps");
  assert.equal(slideGrammar({ role: "cover", headline: "The year I ran", photo: "assets/a.jpg" }), "full-bleed");
  assert.equal(slideGrammar({ role: "cover", headline: "The year I ran" }), "text-card");
  assert.equal(slideGrammar({ role: "body", headline: "One view", photo: "assets/a.jpg" }), "image-panel");
  assert.equal(slideGrammar({ role: "body", headline: "One view" }), "text-card");
  assert.equal(slideGrammar({ role: "cta", headline: "Save 50% today" }), "text-card", "the cta is the cta");
  // The template's choice for a role, when the slide has what it needs.
  assert.equal(slideGrammar({ role: "body", headline: "Name the problem" }, steps), "step");
  assert.equal(slideGrammar({ role: "cover", headline: "Write the brief", photo: "assets/a.jpg" }, steps), "image-panel");
  assert.equal(slideGrammar({ role: "cover", headline: "Write the brief" }, steps), "text-card", "image-panel needs a photo");
  assert.equal(slideGrammar({ role: "body", headline: "One call", photo: "assets/a.jpg" }, CAROUSEL_TEMPLATES["paper-story"]), "framed-image");
  // A short list with a photo stays in the template's photo panel; a long one becomes a list.
  const block = CAROUSEL_TEMPLATES["caption-block"];
  assert.equal(slideGrammar({ role: "payoff", headline: "Save", items: ["One", "Two", "Three"], photo: "assets/a.jpg" }, block), "image-panel");
  assert.equal(slideGrammar({ role: "payoff", headline: "Save", items: ["1", "2", "3", "4", "5"], photo: "assets/a.jpg" }, block), "steps");
});

test("caps: a template's caps sit inside each grammar's, and copy over them is said for the repair", () => {
  for (const id of CAROUSEL_TEMPLATE_IDS) for (const grammar of Object.keys(CAROUSEL_GRAMMARS)) {
    const caps = slideCaps(CAROUSEL_TEMPLATES[id], grammar);
    assert.ok(caps.headline <= CAROUSEL_GRAMMARS[grammar].caps.headline && caps.body <= CAROUSEL_GRAMMARS[grammar].caps.body);
  }
  // The cta module sets its ask on one line of 40, so a longer one is said for the repair rather than cut with an ellipsis.
  assert.match(templateCopyProblems("bold-statement", [{ id: "cta", role: "cta", headline: "Follow for more reminders to keep going daily" }]).join(" "), /holds 40/);
  assert.deepEqual(templateCopyProblems("cinematic-dark", [{ id: "cta", role: "cta", headline: "Follow for more reminders to keep going" }]), [], "39 characters fit");
  // A plain note with no handle draws its cta in the cta module, so a note's cta is held to 40 too.
  assert.match(templateCopyProblems("plain-note", [{ id: "cta", role: "cta", headline: "Save this before your next productivity review" }]).join(" "), /holds 40/);
  const errors = templateCopyProblems("numbered-steps", [
    { id: "a", role: "cover", headline: "x".repeat(49) },
    { id: "b", role: "payoff", headline: "List", items: ["one", "two", "three", "four", "five", "six", "seven"] },
    { id: "c", role: "body", headline: "Myth: " + "y".repeat(41), body: "Fact: short" },
    { id: "d", role: "body", quote: { text: "Words" } },
    { id: "e", role: "body", headline: "Name the problem", body: "One sentence." },
    { id: "f", role: "body", headline: "Fine" }
  ]).join("\n");
  assert.match(errors, /slides\[0\] \(a\) headline is 49 characters; the numbered-steps template's text-card slide holds 48/);
  assert.match(errors, /slides\[1\] \(b\) has 7 items; a list holds 6/);
  assert.match(errors, /"Myth" side is 41 characters; a two-region side holds 40/);
  assert.match(errors, /quote needs its exact words and the person/);
  assert.match(errors, /slides\[4\] \(e\) has a body; the numbered-steps template's step slide is the headline alone/);
  assert.doesNotMatch(errors, /\(f\)/);
  assert.match(templateCopyProblems("nope", [])[0], /is not a template/);
});

test("auto-pick: the brief's words, the arc and photos lead; the seed varies the pick among close ones", () => {
  const best = (brief, arc, images = false) => templateScores({ brief, arc, images }).sort((a, b) => b.score - a.score)[0].id;
  assert.equal(best("five steps to write a brief, a numbered guide", "how-to"), "numbered-steps");
  assert.equal(best("coaching advice on habits and discipline, with photos", "listicle", true), "cinematic-dark");
  assert.equal(best("our values, a bold manifesto", "quote"), "bold-statement");
  assert.equal(best("customer testimonial quotes", "quote"), "pull-quote");
  assert.equal(best("a photo essay from our community trip", "story", true), "photo-essay");
  assert.equal(best("launch our app feature with screenshots", "ad", true), "lit-window");
  assert.equal(best("education checklist with photos", "listicle", true), "caption-block");
  assert.equal(best("the story behind our product, founder craft", "story", true), "paper-story");
  assert.equal(pickTemplate({ template: "photo-essay", brief: "myths" }), "photo-essay", "carousel.template wins");
  assert.throws(() => pickTemplate({ template: "glossy" }), /carousel.template must be one of/);
  const seeds = Array.from({ length: 24 }, (_, i) => pickTemplate({ brief: "a founder note, one observation", arc: "single", seed: `style-${i}` }));
  assert.ok(new Set(seeds).size >= 2, "different seeds pick different close templates");
  assert.ok(seeds.every((id) => CAROUSEL_TEMPLATES[id].arcs.includes("single")), "only close ones");
  assert.equal(pickTemplate({ brief: "a founder note, one observation", arc: "single", seed: "style-3" }), seeds[3], "the same seed picks the same template");
});

test("carousel.template is a carousel field, checked against the templates", async () => {
  const story = JSON.parse(await readFile(new URL("../examples/carousel/listicle-4x5/storyboard.json", import.meta.url), "utf8"));
  assert.deepEqual(carouselProblems({ ...story, carousel: { ...story.carousel, template: "numbered-steps" } }), []);
  assert.match(carouselProblems({ ...story, carousel: { ...story.carousel, template: "glossy" } }).join("\n"), /carousel.template must be one of/);
});

test("layout: grounds turn the brand over with readable type; photo surfaces and steps", () => {
  const brand = { colors: { bg: "#13151a", primary: "#ffb020", accent: "#ff6b5f", ink: "#13151a", paper: "#f5f1e8" } };
  const slides = [{ id: "c", role: "cover", headline: "Big promise", photo: "assets/p.jpg" }, { id: "b", role: "body", headline: "Point one" }, { id: "b2", role: "body", headline: "Point two", photo: "assets/p.jpg" }, { id: "x", role: "cta", headline: "Follow", handle: "me.test", photo: "assets/p.jpg" }];
  const cinematic = layoutCarousel("cinematic-dark", slides, { brand });
  assert.deepEqual(cinematic.scenes[0].plate, { kind: "image", params: { src: "assets/p.jpg", gradient: CAROUSEL_TEMPLATES["cinematic-dark"].reading.gradient, blur: 0 } }, "the photo crisp under the template's reading gradient");
  assert.equal(cinematic.scenes[1].plate, undefined, "no photo: the ground");
  assert.deepEqual(cinematic.story.background, { kind: "flat" });
  const numbered = layoutCarousel("numbered-steps", slides, { brand });
  assert.deepEqual(numbered.scenes.map((scene) => scene.module), ["split-screen", "section-card", "section-card", "cta"]);
  assert.deepEqual(numbered.scenes.slice(1, 3).map((scene) => scene.params.number), [1, 2], "steps are numbered in slide order");
  assert.equal(numbered.scenes[0].params.body, "SWIPE FOR THE STEPS", "the cover asks for the swipe under its headline");
  // Without a photo the cover is not the panel that draws the swipe line, so it takes the arrow label.
  assert.equal(layoutCarousel("numbered-steps", [{ ...slides[0], photo: undefined }, ...slides.slice(1)], { brand }).scenes[0].params.eyebrow, "Swipe →");
  const note = layoutCarousel("plain-note", slides, { brand });
  assert.match(note.scenes[0].params.quote, / →$/, "a note cover asks for the swipe at the end of its observation");
  assert.ok(note.scenes.slice(0, 3).every((scene) => JSON.stringify(scene.params).includes("me.test")), "the identity line on every slide");
  for (const [id, ground] of [["paper-story", "light"], ["plain-note", "light"], ["bold-statement", "brand"], ["plain-note-dark", "dark"]]) {
    const { colors } = layoutCarousel(id, slides, { brand }).story.brand;
    assert.equal(layoutCarousel(id, slides, { brand }).story.brand.palette, "as-given", id);
    for (const key of ["paper", "primary"]) assert.ok(contrastRatio(colors[key], colors.bg) >= 4.5, `${id} (${ground}): ${key} reads on the ground`);
    assert.ok(contrastRatio(colors.ink, colors.primary) >= 3, `${id}: ink reads on a primary fill`);
  }
  assert.equal(layoutCarousel("bold-statement", slides, { brand }).story.brand.colors.bg, "#ffb020", "the primary is the page");
  // A mid-tone primary: white type reads at 4.5:1 but its 62% muted labels would not, so the page deepens until they do.
  for (const primary of ["#007e5d", "#0079a5"]) {
    const { colors } = layoutCarousel("bold-statement", slides, { brand: { colors: { ...brand.colors, primary } } }).story.brand;
    const muted = `#${[16, 8, 0].map((s) => Math.round(((parseInt(colors.bg.slice(1), 16) >> s) & 255) * 0.38 + ((parseInt(colors.paper.slice(1), 16) >> s) & 255) * 0.62).toString(16).padStart(2, "0")).join("")}`;
    assert.ok(contrastRatio(muted, colors.bg) >= 3, `${primary}: muted labels read on the page (${colors.bg})`);
  }
  assert.equal(lightBrand({ colors: {} }).colors.bg, undefined, "no colours, nothing to turn over");
  assert.throws(() => layoutCarousel("numbered-steps", slides, { aspect: "16:9" }), /lays out at 4:5, 1:1, 9:16/);
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
