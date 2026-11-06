import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { captionZone, layoutGeometry, layoutPlan, layoutStateAt } from "@launchclip/core/footage-layout.mjs";
import { captionOptions, CAPTION_PRESETS } from "@launchclip/core/captions.mjs";
import { resolveStory, validateStory } from "@launchclip/core/story.mjs";
import { STACKED, applyStackedLayout, stackedLayoutErrors, stackedPrompt } from "../src/stacked_layout.js";
import { TALKING_HEAD_LAYOUTS, cameraPoint, layoutCaptions, talkingHeadLayout, talkingHeadLayoutError } from "../src/talking_head_layout.js";
import { MAKE_FLAGS, makeOptionsFromFlags, validateMakeOptions } from "../src/make/options.js";
import { planStoryboard } from "../src/storyboard_planner.js";

const TALL = { width: 1080, height: 1920 };

function talkingHead(extra = {}) {
  return {
    schema: "launchclip.story.v1",
    lane: "footage-led",
    format: { width: 1080, height: 1920, fps: 30, duration: 30 },
    base: { src: "assets/recording.mp4" },
    scenes: [],
    overlays: [{ type: "captions", style: "word-highlight", position: "auto" }],
    ...extra
  };
}

test("stacked geometry: the presenter's share of the height, the panel above", () => {
  assert.deepEqual(layoutGeometry("stacked", "bottom", TALL, { share: 0.45 }), { window: { x: 0, y: 1056, width: 1080, height: 864 }, radius: 0, panel: { x: 0, y: 0, width: 1080, height: 1056 } });
  // Half by default, and the share is held to its range.
  assert.equal(layoutGeometry("stacked", "bottom", TALL).window.height, 960);
  assert.equal(layoutGeometry("stacked", "bottom", TALL, { share: 0.9 }).window.height, 1152);
});

test("seam captions centre on the line between the panel and the presenter", () => {
  const band = { x: 65, y: 1190, width: 853, height: 230 };
  assert.deepEqual(captionZone("stacked", "bottom", TALL, band, { share: 0.45, position: "seam" }), { x: 65, y: 941, width: 853, height: 230 });
  assert.deepEqual(captionZone("stacked", "top", TALL, band, { share: 0.45, position: "seam" }), { x: 65, y: 749, width: 853, height: 230 });
  // Elsewhere the seam position is today's presenter-side zone.
  assert.equal(captionZone("full", null, TALL, band, { position: "seam" }), null);
  assert.equal(CAPTION_PRESETS["seam-word"].maxWords, 1);
  const options = captionOptions({ type: "captions", preset: "seam-word", position: "seam" }, { format: { ...TALL, duration: 10 } });
  assert.equal(options.position, "seam");
  assert.equal(options.maxWords, 1);
});

test("applyStackedLayout covers the video: stacked, with the planner's close-ups and inserts clamped", () => {
  const story = talkingHead({
    sections: [
      { id: "confess", start: 10, end: 16, layout: "full" },
      { id: "demo", start: 22, end: 25, layout: "insert" },
      { id: "blink", start: 27, end: 27.8, layout: "full" }
    ]
  });
  const { storyboard, changed, skipped } = applyStackedLayout(story);
  assert.equal(skipped, null);
  assert.deepEqual(storyboard.sections.map((section) => [section.id, section.layout, section.start, section.end]), [
    ["stack-1", "stacked", 0, 10],
    ["confess", "full", 10, 14],
    ["stack-2", "stacked", 14, 22],
    ["demo", "insert", 22, 25],
    ["stack-3", "stacked", 25, 30]
  ]);
  assert.equal(storyboard.sections[0].share, STACKED.share);
  assert.equal(storyboard.sections[1].zoom, STACKED.zoom);
  assert.ok(storyboard.sections.every((section) => section.transition.type === "cut"));
  assert.ok(changed.some((line) => /close-up confess held 6 s; cut to 4 s/.test(line)), changed.join("\n"));
  assert.ok(changed.some((line) => /close-up blink dropped/.test(line)), changed.join("\n"));
  // Captions go where the layout says: one word at a time on the seam.
  const captions = storyboard.overlays[0];
  assert.deepEqual({ position: captions.position, preset: captions.preset, max_words: captions.max_words, style: captions.style }, { ...layoutCaptions("stacked"), style: undefined });
  // The original is untouched, and the result is a valid story.
  assert.equal(story.sections.length, 3);
  const errors = [];
  validateStory(storyboard, { err: (line) => errors.push(line), warn: () => {} });
  assert.deepEqual(errors.filter((line) => /section|caption/.test(line)), []);
});

test("applyStackedLayout keeps a plan with no moments all stacked, and skips stories it cannot lay out", () => {
  const all = applyStackedLayout(talkingHead()).storyboard.sections;
  assert.deepEqual(all.map((section) => [section.layout, section.start, section.end]), [["stacked", 0, 30]]);
  assert.match(applyStackedLayout(talkingHead({ format: { width: 1920, height: 1080, fps: 30, duration: 30 } })).skipped, /9:16/);
  assert.match(applyStackedLayout(talkingHead({ lane: "motion" })).skipped, /footage-led/);
  // Two close-ups with no panel between: the second goes.
  const twice = applyStackedLayout(talkingHead({ sections: [{ id: "a", start: 4, end: 7, layout: "full" }, { id: "b", start: 7.5, end: 10, layout: "full" }] }));
  assert.deepEqual(twice.storyboard.sections.map((section) => section.id), ["stack-1", "a", "stack-2"]);
});

test("stackedLayoutErrors: long holds and captions off the seam are repair errors; a long stretch without a close-up is a warning", () => {
  const story = talkingHead({
    format: { width: 1080, height: 1920, fps: 30, duration: 50 },
    sections: [
      { id: "s1", start: 0, end: 5, layout: "stacked" },
      { id: "face", start: 5, end: 12, layout: "full" },
      { id: "s2", start: 12, end: 50, layout: "stacked" }
    ]
  });
  const { errors, warnings } = stackedLayoutErrors(story);
  assert.ok(errors.some((line) => /^stacked: close-up face holds 7 s/.test(line)), errors.join("\n"));
  assert.ok(errors.some((line) => /^stacked: the captions sit at "auto"/.test(line)), errors.join("\n"));
  assert.ok(warnings.some((line) => /no close-up between 12 s and 50 s/.test(line)), warnings.join("\n"));
  assert.deepEqual(stackedLayoutErrors(applyStackedLayout(talkingHead()).storyboard).errors, []);
});

test("a stacked story's layout plan reframes the presenter into the lower window and the close-up fills the frame", () => {
  const { storyboard } = applyStackedLayout(talkingHead({ sections: [{ id: "face", start: 10, end: 13, layout: "full" }] }));
  const plan = layoutPlan(resolveStory(storyboard, { words: [] }));
  const stacked = layoutStateAt(plan, 5);
  assert.deepEqual(stacked.window, { x: 0, y: 1056, width: 1080, height: 864 });
  const close = layoutStateAt(plan, 11.5);
  assert.deepEqual(close.window, { x: 0, y: 0, width: 1080, height: 1920 });
  assert.equal(close.camera.scale, STACKED.zoom);
  // A point at the head's default height lands inside the presenter's window in the stacked stretch.
  const [, y] = cameraPoint(stacked.camera, TALL, 540, 1920 * 0.35);
  assert.ok(y > 1056 && y < 1920, `head at ${y}`);
});

test("the layout enum: full and stacked are built, overlay is named but refused", () => {
  assert.deepEqual(TALKING_HEAD_LAYOUTS, ["full", "stacked", "overlay"]);
  assert.equal(talkingHeadLayout(undefined), "full");
  assert.equal(talkingHeadLayout("Stacked"), "stacked");
  assert.equal(talkingHeadLayoutError("stacked"), null);
  assert.match(talkingHeadLayoutError("overlay"), /planned but not built/);
  assert.match(talkingHeadLayoutError("sideways"), /must be one of full, stacked, overlay/);
  assert.equal(layoutCaptions("full"), null);
});

test("make: --layout is a setting flag a host can detect, validated and passed on", () => {
  assert.ok(MAKE_FLAGS.some(([flag, spec]) => flag === "layout" && spec.setting));
  const options = makeOptionsFromFlags({ layout: "stacked" });
  assert.equal(options.layout, "stacked");
  assert.doesNotThrow(() => validateMakeOptions(options));
  assert.throws(() => validateMakeOptions({ layout: "overlay" }), /planned but not built/);
});

test("the planner lays a stacked talking head out after the model's plan and asks for it in the prompt", async () => {
  const dir = new URL("../examples/story/footage/", import.meta.url);
  const story = JSON.parse(await readFile(new URL("storyboard.json", dir), "utf8"));
  const map = JSON.parse(await readFile(new URL("DIRECTION.json", dir), "utf8"));
  const words = JSON.parse(await readFile(new URL("NARRATION.json", dir), "utf8")).words;
  story.sections = [{ id: "turn", start: 8, end: 11, layout: "full" }];
  const calls = [];
  const client = {
    provider: "openai",
    async runStructured(request) {
      calls.push(request);
      return { model: "gpt-5.6-luna", status: "completed", value: { storyboard_json: JSON.stringify(story) }, usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } };
    }
  };
  const report = await planStoryboard({ brief: "A builder explains the tool.", words, lane: "footage-led", format: story.format, base: story.base.src, audio: story.audio, tier: "guided", model: "openai:gpt-5.6-luna", client, direction: map, layout: "stacked", maxRepairs: 0 });
  assert.match(calls[0].instructions, /## Stacked talking head \(this run\)/);
  assert.equal(calls[0].instructions.includes(stackedPrompt()), true);
  const sections = report.storyboard?.sections ?? [];
  assert.deepEqual(sections.map((section) => section.layout), ["stacked", "full", "stacked"], JSON.stringify(report.errors));
  assert.equal(report.storyboard.overlays.find((overlay) => overlay.type === "captions").position, "seam");
});
