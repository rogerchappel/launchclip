import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readProjectStory } from "../src/story_loader.js";
import { captionZones, chestZone, layoutPlan } from "@launchclip/core/footage-layout.mjs";
import { resolveStory, validateStory } from "@launchclip/core/story.mjs";
import { OVERLAY, OVERLAY_CAPTIONS, applyOverlayLayout, freeZones, overlayLayoutErrors, overlayPrompt } from "../src/overlay_layout.js";
import { layoutCaptions } from "../src/talking_head_layout.js";
import { planStoryboard } from "../src/storyboard_planner.js";
import { DEFAULT_BRAND } from "@launchclip/core/planning-prompt.mjs";

const TALL = { width: 1080, height: 1920 };

function talkingHead(extra = {}) {
  return {
    schema: "launchclip.story.v1",
    lane: "footage-led",
    format: { width: 1080, height: 1920, fps: 30, duration: 20 },
    base: { src: "assets/recording.mp4" },
    brand: DEFAULT_BRAND,
    scenes: [],
    overlays: [{ type: "captions", style: "word-highlight" }],
    ...extra
  };
}

test("free zones: the headroom above the presenter and the space beside their body", () => {
  const zones = freeZones(talkingHead(), 0, 5);
  // The default head: a fifth of the width wide, its top at 30% of the height.
  assert.deepEqual(zones.above, { x: 80, y: 280, width: 860, height: 264 });
  assert.ok(zones.above.y + zones.above.height < zones.face.y);
  // In front of their hands: under the chest caption, as wide as the body.
  assert.deepEqual(zones.front, { x: 259, y: 1123, width: 562, height: 327 });
  // The body (2.6 head-widths) leaves too little room beside it at 1080 wide.
  assert.equal(zones.left, null);
  assert.equal(zones.right, null);
  assert.equal(zones.body.width, Math.round(TALL.width * 0.2 * OVERLAY.bodyWidths));
});

test("applyOverlayLayout: one take, inserts become overlays, overlays go to free zones, captions at the chest", () => {
  const story = talkingHead({
    sections: [{ id: "s1", start: 0, end: 10, layout: "stacked" }],
    scenes: [
      { id: "title", module: "motion-title", track: 1, start: 0, end: 3, params: { text: "The ultimate caption" } },
      { id: "choice", module: "icon-row", track: 1, start: 3, end: 5, params: { title: "Choose", items: [{ icon: "check", label: "A" }, { icon: "x", label: "B" }] } },
      { id: "count", module: "count-up", insert: true, start: 5, end: 8, params: { value: 1000, label: "comments" } },
      { id: "steps", module: "checklist", track: 1, start: 8, end: 18, params: { title: "Structure", rows: [{ label: "Hook", status: "done" }] } },
      { id: "zoom", module: "punch-in", track: 2, start: 2, end: 4, params: { scale: 1.2 } }
    ]
  });
  const { storyboard, changed, skipped } = applyOverlayLayout(story);
  assert.equal(skipped, null);
  assert.deepEqual(storyboard.sections, [{ id: "take", start: 0, end: 20, layout: "full", transition: { type: "cut" } }]);
  const byId = Object.fromEntries(storyboard.scenes.map((scene) => [scene.id, scene]));
  assert.equal(byId.count.insert, undefined);
  assert.equal(byId.count.track, 1);
  // Overlays go to the first free zone they fit, sized to what the module needs
  // (moduleFit). With the default head the headroom is 264 px: too short for a
  // motion-title (410 px) or a count-up, which keep their own placement; the
  // icon row (302 px) fits in front of the presenter's hands.
  const front = freeZones(story, 3, 5).front;
  const choice = byId.choice.params.rect;
  assert.deepEqual({ x: choice.x, y: choice.y, width: choice.width }, { x: front.x, y: front.y, width: front.width });
  assert.ok(choice.height >= 302 && choice.height <= front.height, JSON.stringify(choice));
  assert.ok(changed.some((line) => /^choice placed in front of the presenter$/.test(line)), changed.join("\n"));
  assert.equal(byId.title.params.rect, undefined);
  assert.ok(changed.some((line) => /^title kept its own placement/.test(line)), changed.join("\n"));
  assert.ok(changed.some((line) => /^count kept its own placement/.test(line)), changed.join("\n"));
  // The checklist places itself around the head; the punch-in is a camera move.
  assert.equal(byId.steps.params.rect, undefined);
  assert.equal(byId.zoom.params.rect, undefined);
  assert.ok(changed.some((line) => /insert count became an overlay/.test(line)), changed.join("\n"));
  assert.ok(changed.some((line) => /sections replaced by one full-frame take/.test(line)));
  const captions = storyboard.overlays[0];
  assert.deepEqual({ position: captions.position, preset: captions.preset, max_words: captions.max_words }, layoutCaptions("overlay"));
  assert.deepEqual(layoutCaptions("overlay"), { ...OVERLAY_CAPTIONS });
  const errors = [];
  validateStory(storyboard, { err: (line) => errors.push(line), warn: () => {} });
  assert.deepEqual(errors.filter((line) => /section|caption|insert|track/.test(line)), []);
  assert.deepEqual(overlayLayoutErrors(storyboard).errors, []);
  assert.match(applyOverlayLayout(talkingHead({ lane: "motion" })).skipped, /footage-led/);
});

test("chest captions: the zone sits a head-height under the chin, in the full take", () => {
  const { storyboard } = applyOverlayLayout(talkingHead());
  const resolved = resolveStory(storyboard, { words: [] });
  const zones = captionZones(resolved);
  assert.equal(zones.length, 1);
  const band = { x: 65, y: 1190, width: 853, height: 230 };
  const rect = chestZone(resolved, TALL, band, 0, 20);
  // Default head: top 576 px, 250 px tall → chest centre 975 px.
  assert.equal(Math.round(rect.y + rect.height / 2), Math.round(1920 * 0.3 + 1920 * 0.13 * 1.6));
  // Both renderers get the zone through the layout plan.
  assert.equal(layoutPlan(resolved).captions.length, 1);
});

test("overlayLayoutErrors: inserts, layout sections and captions off the chest are repair errors; a prop on the face is a warning", () => {
  const story = talkingHead({
    sections: [{ id: "s1", start: 0, end: 10, layout: "stacked" }],
    scenes: [{ id: "cut", module: "count-up", insert: true, start: 1, end: 3, params: { value: 3 } }]
  });
  const { errors } = overlayLayoutErrors(story);
  assert.ok(errors.some((line) => /^overlay: scene cut cuts away/.test(line)), errors.join("\n"));
  assert.ok(errors.some((line) => /^overlay: the take holds the full frame/.test(line)));
  assert.ok(errors.some((line) => /^overlay: the captions sit at "auto"/.test(line)));
});

test("with a measured presenter the zones and the face check follow their head", async () => {
  const { resolved } = await readProjectStory(fileURLToPath(new URL("../examples/story/layouts-tall", import.meta.url)));
  // The example's matte covers 5–7.5 s.
  const zones = freeZones(resolved, 5, 7.5);
  assert.notDeepEqual(zones.face, freeZones(talkingHead(), 5, 7.5).face, "the measured head, not the default");
  const face = zones.face;
  const prop = { id: "prop", module: "stat-card", track: 1, start: 5.5, end: 7, params: { value: "50%", rect: { x: face.x, y: face.y, width: face.width, height: face.height } } };
  const covering = { ...resolved, scenes: [...resolved.scenes, prop] };
  assert.ok(overlayLayoutErrors(covering).warnings.some((line) => /^overlay: prop covers 100% of the presenter's face/.test(line)), JSON.stringify(overlayLayoutErrors(covering).warnings));
  // Behind the presenter, the same prop is fine.
  const behind = { ...resolved, scenes: [...resolved.scenes, { ...prop, layer: "behind" }] };
  assert.deepEqual(overlayLayoutErrors(behind).warnings.filter((line) => /prop/.test(line)), []);
});

test("the planner lays an overlay talking head out and asks for it in the prompt", async () => {
  const dir = new URL("../examples/story/footage/", import.meta.url);
  const story = JSON.parse(await readFile(new URL("storyboard.json", dir), "utf8"));
  const map = JSON.parse(await readFile(new URL("DIRECTION.json", dir), "utf8"));
  const words = JSON.parse(await readFile(new URL("NARRATION.json", dir), "utf8")).words;
  const calls = [];
  const client = {
    provider: "openai",
    async runStructured(request) {
      calls.push(request);
      return { model: "gpt-5.6-luna", status: "completed", value: { storyboard_json: JSON.stringify(story) }, usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } };
    }
  };
  const report = await planStoryboard({ brief: "A builder explains the tool.", words, lane: "footage-led", format: story.format, base: story.base.src, audio: story.audio, tier: "guided", model: "openai:gpt-5.6-luna", client, direction: map, layout: "overlay", maxRepairs: 0 });
  assert.equal(calls[0].instructions.includes(overlayPrompt()), true);
  const planned = report.storyboard;
  assert.ok(planned, JSON.stringify(report.errors));
  assert.deepEqual(planned.sections.map((section) => section.layout), ["full"]);
  assert.equal(planned.scenes.filter((scene) => scene.insert === true).length, 0);
  assert.equal(planned.overlays.find((overlay) => overlay.type === "captions").position, "chest");
});
