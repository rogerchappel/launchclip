// The captions-visible gate (src/caption_visibility.js): captions that are on
// may be hidden under cards for a small share of the narration only, and a
// failure names the scenes. In the planner's check (a "captions:" error a
// repair can act on), and so in make's storyboard stage, and in finish's gates.
import assert from "node:assert/strict";
import test from "node:test";
import { fitCaptionBand } from "../src/caption_band_fit.js";
import { CAPTION_HIDDEN_MAX, captionVisibilityGate } from "../src/caption_visibility.js";
import { checkStoryboard, planStoryboard, resolveChecked } from "../src/storyboard_planner.js";
import { BAND_DURATION, BAND_WORDS, bandStory, bandStyle } from "./helpers/caption_band_story.js";

const options = { words: BAND_WORDS, tier: "structured", style: bandStyle(), bandErrors: false };
const resolved = (story) => resolveChecked(story, options);
const withHide = (hide) => ({ ...bandStory(), overlays: [{ type: "captions", hide }] });

test("captions hidden for a small share of the narration pass; more fails and names the scenes, worst first", () => {
  assert.equal(CAPTION_HIDDEN_MAX, 0.15);
  // 3 of 27 s: one scene.
  const small = captionVisibilityGate(resolved(withHide([[3, 6]])), BAND_WORDS);
  assert.equal(small.status, "passed");
  assert.ok(small.share > 0.1 && small.share <= 0.15, `share ${small.share}`);
  assert.deepEqual(small.scenes.map((scene) => scene.id), ["boards"]);
  assert.equal(small.errors, undefined);
  // 7.5 of 27 s: over the share.
  const large = captionVisibilityGate(resolved(withHide([[3, 6], [12, 16.5]])), BAND_WORDS, { band: { y: 826, height: 269 } });
  assert.equal(large.status, "failed");
  assert.deepEqual(large.scenes.map((scene) => scene.id), ["boards", "ask", "mix"]);
  assert.equal(large.errors.length, 1);
  assert.match(large.errors[0], /^captions are on but hidden for 28% of the narration \(6\.\d of 24\.3 s; at most 15%\): under boards \(process-steps, 3–6 s\), ask \(concept-card, 12–15 s\), mix \(picture-in-picture, 15–18 s\)\. Plan those scenes' text clear of the caption band \(y 826–1095\)/);
});

test("only spoken time counts, a scene flagged hides_captions counts, and a module that carries the line itself does not", () => {
  const words = BAND_WORDS.filter((word) => word.start < 9 || word.start >= 18);
  // Hidden over a stretch nobody speaks in: nothing is lost.
  assert.equal(captionVisibilityGate(resolved(withHide([[9, 18]])), words).share, 0);
  const flagged = bandStory((scenes) => scenes.map((scene) => (["boards", "ask"].includes(scene.id) ? { ...scene, hides_captions: true } : scene)));
  const gate = captionVisibilityGate(resolved(flagged), BAND_WORDS);
  assert.equal(gate.status, "failed");
  assert.deepEqual(gate.scenes.map((scene) => scene.id), ["boards", "ask"]);
  // A hook title hides the captions while it carries the line: reported, not gated.
  const titled = bandStory((scenes) => scenes.map((scene) => (scene.id === "boards" ? { ...scene, module: "hook-title", params: { headline: "Three deck boards" } } : scene)));
  const own = captionVisibilityGate(resolved(titled), BAND_WORDS);
  assert.deepEqual({ status: own.status, share: own.share, scenes: own.scenes }, { status: "passed", share: 0, scenes: [] });
  assert.ok(own.module_share > 0.1);
});

test("no captions, or no narration words: skipped", () => {
  assert.equal(captionVisibilityGate(resolved({ ...bandStory(), style: undefined, overlays: [] }), BAND_WORDS).status, "skipped");
  assert.equal(captionVisibilityGate(resolved({ ...bandStory(), overlays: [{ type: "captions", preset: "none" }] }), BAND_WORDS).status, "skipped");
  assert.equal(captionVisibilityGate(resolved(bandStory()), []).status, "skipped");
});

test("the storyboard check fails a story whose captions were hidden under most of its cards, with the scenes in the error", () => {
  // The fixture settled the old way: every clash hidden.
  const story = bandStory();
  const hidden = fitCaptionBand(story, checkStoryboard(story, options).errors, { from: 4 }).storyboard;
  const checked = checkStoryboard(hidden, options);
  assert.deepEqual(checked.errors.filter((line) => line.includes("caption-band")), [], "the layout check itself is satisfied");
  const errors = checked.errors.filter((line) => line.startsWith("captions: "));
  assert.equal(errors.length, 1, checked.errors.join("\n"));
  assert.match(errors[0], /^captions: captions are on but hidden for 7\d% of the narration .*under .*boards \(process-steps, 3–6 s\).*caption band \(y 826–1095\)/);
  assert.equal(checked.ok, false);
});

test("planned from a recorded answer, the fixture passes with its captions on, and the report says what moved", async () => {
  const client = {
    provider: "openai",
    calls: [],
    async runStructured(request) {
      if (request.schemaName === "launchclip_direction") return { model: "gpt-5.6-luna", value: { direction_json: "" }, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
      this.calls.push(request);
      return { model: "gpt-5.6-luna", value: { storyboard_json: JSON.stringify(bandStory()) }, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
    }
  };
  const story = bandStory();
  const report = await planStoryboard({ brief: "Three deck boards compared.", words: BAND_WORDS, lane: story.lane, format: story.format, audio: { words: "NARRATION.json" }, tier: "structured", model: "openai:gpt-5.6-luna", client, style: bandStyle(), maxRepairs: 0 });
  assert.equal(report.status, "passed", report.errors.join("\n"));
  assert.equal(client.calls.length, 1, "no repair call is spent");
  assert.ok(report.warnings.some((line) => line.startsWith("layout: tooling cleared the caption band: open (position \"top\"); boards (re-fitted above it)")), report.warnings.join("\n"));
  assert.ok(report.warnings.some((line) => line.startsWith("layout: tooling placed captions 15–18 s moved below mix")), report.warnings.join("\n"));
  assert.deepEqual(report.warnings.filter((line) => line.startsWith("layout: tooling hid")), []);
  const gate = captionVisibilityGate(resolveChecked(report.storyboard, { words: BAND_WORDS, style: bandStyle() }), BAND_WORDS);
  assert.deepEqual({ status: gate.status, share: gate.share }, { status: "passed", share: 0 });
  assert.equal(BAND_DURATION, 27);
});
