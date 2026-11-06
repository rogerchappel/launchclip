import assert from "node:assert/strict";
import test from "node:test";
import { fitDiagrams, isSketchFeynman, sketchParams } from "../src/diagram_fit.js";
import { checkStoryboard } from "../src/storyboard_planner.js";

const brand = { colors: { bg: "#06070d", primary: "#fdb022", accent: "#46d4ff", ink: "#06070d", paper: "#f2eee6" }, fonts: { display: "anton", body: "space-grotesk", meta: "jetbrains-mono" } };
const story = (scenes) => ({ schema: "launchclip.story.v1", lane: "motion", format: { width: 1080, height: 1920, fps: 30, duration: 12 }, brand, base: null, scenes });

// The deck sketch a planner drew with feynman-diagram: dashed scalar lines and plain-word labels.
const DECK = { module: "feynman-diagram", start: 0, end: 4.5, params: { variant: "ink", title: "Squaring the deck", caption: "Illustrative layout, not a measured plan",
  points: { a: [2, 1], b: [10, 1], c: [10, 5], d: [2, 5] },
  lines: [{ from: "a", to: "b", type: "scalar" }, { from: "b", to: "c", type: "scalar" }, { from: "c", to: "d", type: "scalar" }, { from: "d", to: "a", type: "scalar" }, { from: "a", to: "c", type: "scalar", label: "string lines" }, { from: "b", to: "d", type: "scalar" }] } };

test("a line sketch planned as a Feynman diagram becomes a line-diagram; a real one stays", () => {
  assert.equal(isSketchFeynman({ id: "s1", ...DECK }), true);
  assert.equal(isSketchFeynman({ module: "feynman-diagram", params: { preset: "self-energy" } }), false);
  assert.equal(isSketchFeynman({ module: "feynman-diagram", params: { points: { a: [1, 3], b: [11, 3] }, lines: [{ from: "a", to: "b", type: "photon", label: "beam" }] } }), false, "a wavy line is physics");
  assert.equal(isSketchFeynman({ module: "feynman-diagram", params: { points: { a: [1, 3], b: [11, 3] }, lines: [{ from: "a", to: "b", label: "e⁻" }], title: "Electron scattering" } }), false);
  assert.equal(isSketchFeynman({ module: "feynman-diagram", params: { points: { a: [1, 3], b: [11, 3] }, lines: [{ from: "a", to: "b", label: "φ" }] } }), false);

  const params = sketchParams(DECK.params);
  assert.equal(params.note, "Illustrative layout, not a measured plan");
  assert.equal(params.variant, undefined);
  assert.ok(params.lines.every((line) => line.style === "dashed" && line.type === undefined));

  const planned = story([{ id: "s1", ...DECK }, { id: "s2", module: "feynman-diagram", start: 4.5, end: 9, params: { preset: "exchange" } }]);
  const { storyboard, changed } = fitDiagrams(planned);
  assert.equal(storyboard.scenes[0].module, "line-diagram");
  assert.equal(storyboard.scenes[1].module, "feynman-diagram");
  assert.equal(planned.scenes[0].module, "feynman-diagram", "the planner's copy is untouched");
  assert.equal(changed.length, 1);
  assert.match(changed[0], /^s1 feynman-diagram → line-diagram/);
  const checked = checkStoryboard(storyboard);
  assert.deepEqual(checked.errors.filter((entry) => entry.startsWith("params:")), []);
});

test("labels a scene is too short to read are dropped from the plan, with a warning", () => {
  const sketch = { module: "line-diagram", start: 0, end: 2.4, params: { points: { e: [0, 10], f: [60, 10], a: [30, 14], b: [30, 70], g: [20, 90], h: [40, 90] },
    lines: [{ from: "e", to: "f", label: "beam" }, { from: "a", to: "b", weight: "heavy", label: "new post" }, { from: "g", to: "h", label: "footing" }], marks: [{ point: "a", label: "stirrup" }] } };
  const { storyboard, changed } = fitDiagrams(story([{ id: "s1", ...sketch }]));
  assert.equal(changed.length, 1);
  assert.match(changed[0], /^s1 line-diagram: dropped labels? "/);
  const kept = [...storyboard.scenes[0].params.lines.map((line) => line.label).filter(Boolean), ...(storyboard.scenes[0].params.marks ?? []).map((mark) => mark.label)];
  assert.ok(kept.length < 4, `kept ${kept.join(", ")}`);
  // The fitted plan now resolves to exactly what it says.
  const again = fitDiagrams(storyboard);
  assert.deepEqual(again.changed, []);
  // A scene long enough keeps every label.
  assert.deepEqual(fitDiagrams(story([{ id: "s1", ...sketch, end: 8 }])).changed, []);
});

test("the planner fits a sketch planned as a Feynman diagram without a repair call", async () => {
  const { planStoryboard } = await import("../src/storyboard_planner.js");
  const { DEFAULT_BRAND } = await import("@launchclip/core/planning-prompt.mjs");
  const format = { width: 1080, height: 1920, fps: 30, duration: 10, platform: "youtube-shorts" };
  const words = [["First", 0.1], ["square", 0.4], ["the", 0.8], ["deck", 1.0], ["with", 1.4], ["string", 1.7], ["lines", 2.1], ["then", 5.2], ["check", 5.6], ["the", 6.0], ["diagonals", 6.3]]
    .map(([text, start]) => ({ text, start, end: start + 0.25 }));
  const planned = { schema: "launchclip.story.v1", title: "Squaring a deck", lane: "voiceover-motion", format, brand: DEFAULT_BRAND,
    audio: { voice: "assets/audio/narration.wav", words: "NARRATION.json", music: { source: "synth", bpm: 96 }, sfx: "auto" },
    scenes: [
      { id: "s1", module: "hook-title", start: 0, end: 1.4, energy: 1, params: { headline: "Square the deck first", emphasis: "Square" } },
      { id: "s2", ...DECK, start: 1.4, end: 5.6, energy: 2 },
      { id: "s3", module: "cta", start: 5.6, end: 10, energy: 1, params: { action: "Follow for the next step", loop: true } }
    ],
    overlays: [{ type: "captions", style: "word-highlight" }], ending: { loop_to: "s1" } };
  const calls = [];
  const client = { provider: "openai", async runStructured(request) {
    if (request.schemaName === "launchclip_direction") return { model: "m", value: { direction_json: "" }, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
    calls.push(request);
    return { response_id: "r", model: "m", status: "completed", value: { storyboard_json: JSON.stringify(planned) }, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
  } };
  const report = await planStoryboard({ brief: "How to square a deck with string lines.", words, lane: "voiceover-motion", format, audio: planned.audio, tier: "structured", model: "openai:m", client });
  assert.equal(report.status, "passed", report.errors.join("\n"));
  assert.equal(calls.length, 1);
  assert.equal(report.storyboard.scenes.find((scene) => scene.id === "s2").module, "line-diagram");
  assert.ok(report.warnings.some((entry) => /^diagrams: tooling s2 feynman-diagram → line-diagram/.test(entry)), report.warnings.join("\n"));
});
