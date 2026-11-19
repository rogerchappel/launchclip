import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { carouselProblems, destinationProblems, slideStills, slideStem, CAROUSEL_ARCS, CAROUSEL_DESTINATIONS } from "@launchclip/core/carousel.mjs";
import { validateStory } from "@launchclip/core/story.mjs";

const sample = () => JSON.parse(readFileSync(new URL("../examples/carousel/listicle-4x5/storyboard.json", import.meta.url), "utf8"));

test("the sample carousel validates as a story", () => {
  const story = sample();
  assert.deepEqual(carouselProblems(story), []);
  const report = validateStory(story);
  assert.deepEqual(report.errors, []);
  assert.ok(!report.warnings.some((w) => w.startsWith("carousel is not")), "carousel is a known top-level field");
});

test("a video (no format.kind) has no carousel problems", () => {
  const story = sample();
  delete story.format.kind;
  delete story.carousel;
  assert.deepEqual(carouselProblems(story), []);
});

test("slide order: cover first, one cta and it is last", () => {
  const story = sample();
  [story.scenes[0], story.scenes[1]] = [story.scenes[1], story.scenes[0]];
  assert.ok(carouselProblems(story).some((e) => e.includes("first slide must be the cover")));
  const ctaMid = sample();
  ctaMid.scenes[2].slide.role = "cta";
  assert.ok(carouselProblems(ctaMid).some((e) => e.includes("cta slide must be the last")));
});

test("arc rules: slide count and payoff", () => {
  const story = sample();
  story.scenes[3].slide.role = "body";
  assert.ok(carouselProblems(story).some((e) => e.includes("needs a payoff slide")));
  const single = sample();
  single.carousel.arc = "single";
  assert.ok(carouselProblems(single).some((e) => e.includes("has 1 slide; this one has 5")));
  assert.equal(CAROUSEL_ARCS.ad.slides[1], 5);
});

test("slide fields: role, medium, motion slides loop within 3-8 s, cuts only", () => {
  const story = sample();
  story.scenes[1].slide.medium = "motion";
  story.scenes[1].in = { type: "fade", dur: 0.4 };
  story.scenes[2].slide.extra = 1;
  delete story.scenes[4].slide;
  const errors = carouselProblems(story);
  assert.ok(errors.some((e) => e.includes("must loop")));
  assert.ok(errors.some((e) => e.includes("scenes[1].in must be")));
  assert.ok(errors.some((e) => e.includes("slide.extra is not a slide field")));
  assert.ok(errors.some((e) => e.includes("scenes[4].slide must be")));
  story.scenes[1].loop = true;
  story.scenes[1].end = 14;
  assert.ok(carouselProblems(story).some((e) => e.includes("motion slides run 3 to 8 s")));
});

test("carousel block: arc, goal, caption, destinations", () => {
  const story = sample();
  story.carousel = { arc: "nope", goal: "buy", caption: { hook: 1, tags: [""] }, destinations: ["myspace"], extra: true };
  const errors = carouselProblems(story);
  for (const part of ["carousel.arc", "carousel.goal", "caption.hook must be", "caption.tags", "carousel.destinations", "carousel.extra"]) assert.ok(errors.some((e) => e.includes(part)), part);
  const bad = sample();
  bad.format.kind = "deck";
  assert.ok(validateStory(bad).errors.some((e) => e.includes('format.kind must be "carousel"')));
});

test("destinations: slide limits block, motion on an image-only platform falls back to the still", () => {
  const story = sample();
  assert.equal(destinationProblems(story, "x").errors.length, 1, "x takes 4 slides");
  story.scenes[1].slide.medium = "motion";
  const tiktok = destinationProblems(story, "tiktok");
  assert.deepEqual(tiktok.errors, []);
  assert.match(tiktok.warnings[0], /slide 2 \(habit-1\) is sent as its still/);
  assert.deepEqual(destinationProblems(story, "instagram").warnings, []);
  assert.match(destinationProblems(story, "nope").errors[0], /unknown destination/);
  for (const dest of Object.values(CAROUSEL_DESTINATIONS)) assert.ok(dest.width > 0 && dest.height > 0 && dest.slides[0] <= dest.slides[1]);
});

test("slideStills: the settled frame, or still_at", () => {
  const story = sample();
  story.scenes[2].slide.still_at = 1.5;
  const stills = slideStills(story);
  assert.equal(stills.length, 5);
  assert.deepEqual(stills[0], { id: "cover", index: 0, role: "cover", medium: "still", at: 3.25, frame: 97 });
  assert.equal(stills[2].at, 9.5);
  assert.equal(stills[2].frame, 285);
  for (const still of stills) assert.ok(still.frame < Math.ceil(story.scenes[still.index].end * 30));
  assert.equal(slideStem(0, 5), "01");
  assert.equal(slideStem(4, 120), "005");
});
