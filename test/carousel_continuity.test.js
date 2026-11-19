import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { carouselProblems } from "@launchclip/core/carousel.mjs";
import { carouselPlanFindings } from "@launchclip/core/carousel-check.mjs";
import { crossesSeam, panoramaSlice, seamBox, slideContinuity } from "@launchclip/core/carousel-continuity.mjs";

const sample = () => JSON.parse(readFileSync(new URL("../examples/carousel/seam-panorama-4x5/storyboard.json", import.meta.url), "utf8"));

test("the seams and panorama sample validates", () => {
  assert.deepEqual(carouselProblems(sample()), []);
});

test("seams must cross the seam after a slide that has a next slide", () => {
  const story = sample();
  story.carousel.seams.push({ after: "cta", kind: "rule", x: -0.2, y: 0.5, w: 0.4, h: 0.01 }, { after: "cover", kind: "card", x: 0.1, y: 0.5, w: 0.4, h: 0.1 }, { after: "cover", kind: "word", x: -0.1, y: 0.5, w: 0.2, h: 0.1 });
  const errors = carouselProblems(story);
  assert.ok(errors.some((e) => e.includes("seams[3].after")));
  assert.ok(errors.some((e) => e.includes("seams[4] must cross")));
  assert.ok(errors.some((e) => e.includes("seams[5] is a word")));
  story.carousel.panorama.slides = [3, 9];
  assert.ok(carouselProblems(story).some((e) => e.includes("panorama.slides")));
});

// Draw each slide the way both renderers do (a box at its left, clipped to the
// slide) into a column mask, put the slides side by side and compare with the
// element drawn once on the pair's canvas: every column, the seam's included.
function columns(left, width, from, to) {
  const out = [];
  for (let x = from; x < to; x++) out.push(x >= left && x < left + width ? 1 : 0);
  return out;
}

test("a seam element's halves meet exactly when the slides sit side by side", () => {
  for (const [W, H] of [[1080, 1350], [1080, 1080], [1080, 1920], [1001, 1251]]) {
    const story = { ...sample(), format: { ...sample().format, width: W, height: H } };
    story.carousel.seams.forEach((seam) => {
      const box = seamBox(seam, W, H);
      const left = slideContinuity(story, seam.after).seams.find((s) => s.kind === seam.kind);
      const ids = story.scenes.map((scene) => scene.id);
      const right = slideContinuity(story, ids[ids.indexOf(seam.after) + 1]).seams.find((s) => s.kind === seam.kind);
      assert.equal(left.style.top, right.style.top);
      const px = (value) => Number.parseInt(value, 10);
      const stitched = [...columns(px(left.style.left), box.width, 0, W), ...columns(px(right.style.left), box.width, 0, W)];
      assert.deepEqual(stitched, columns(box.left, box.width, 0, 2 * W), `${seam.kind} at ${W}×${H}`);
      assert.equal(stitched[W - 1], 1, "it reaches the left slide's last column");
      assert.equal(stitched[W], 1, "and the right slide's first");
    });
  }
});

test("panorama slices tile the plate: slide i shows [i·W, (i+1)·W) of one N·W-wide layout", () => {
  const story = sample();
  const { width: W, height: H } = story.format;
  const slices = story.scenes.map((scene) => slideContinuity(story, scene.id)?.panorama ?? null);
  assert.equal(slices[4], null, "the cta is outside the panorama");
  slices.slice(0, 4).forEach((slice, i) => {
    assert.deepEqual(slice, { src: "assets/panorama.jpg", left: -i * W, width: 4 * W, height: H }, "one size for every slide, a whole-width offset each");
  });
  // Stitched plate columns: slide i column x is plate column x - left; side by side they run 0 … 4W-1 with no gap or repeat.
  const stitched = slices.slice(0, 4).flatMap((slice) => Array.from({ length: W }, (_, x) => x - slice.left));
  assert.deepEqual(stitched, Array.from({ length: 4 * W }, (_, x) => x));
  assert.equal(panoramaSlice({ src: "p", slides: [2, 3] }, 0, W, H), null);
  assert.deepEqual(panoramaSlice({ src: "p", slides: [2, 3] }, 2, W, H), { src: "p", offset: W, width: 2 * W, height: H });
});

test("swipe-cue counts a seam element or the panorama on the cover or slide 2", () => {
  const story = sample();
  delete story.scenes[0].params.kicker;
  assert.ok(crossesSeam(story, 0));
  assert.ok(!carouselPlanFindings(story).some((f) => f.rule === "swipe-cue"));
  delete story.carousel.panorama;
  story.carousel.seams = story.carousel.seams.filter((seam) => seam.after !== "cover");
  assert.ok(!crossesSeam(story, 0) && !crossesSeam(story, 1));
  assert.ok(carouselPlanFindings(story).some((f) => f.rule === "swipe-cue"));
});
