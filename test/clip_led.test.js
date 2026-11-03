// Clip-led planning (kit/core/clip-led.mjs): with footage to cut and a low
// density dial, a narrated plan is carried by full-frame clip scenes with
// callouts; high density keeps today's motion-graphics plan.
import assert from "node:assert/strict";
import test from "node:test";
import { CLIP_LED_DENSITY, clipLedFindings, clipLedLines, clipLedPlan, clipShare, clipShareBand } from "@launchclip/core/clip-led.mjs";
import { DEFAULT_BRAND, planningPrompt } from "@launchclip/core/planning-prompt.mjs";
import { resolveProfile } from "../src/profile_store.js";
import { densityDial, planStoryboard } from "../src/storyboard_planner.js";
import { assetManifestLines } from "../src/make/index.js";
import { makeOptionsFromFlags, validateMakeOptions } from "../src/make/options.js";

const FORMAT = { width: 1080, height: 1920, fps: 30, duration: 12, platform: "youtube-shorts" };
const AUDIO = { voice: "assets/audio/narration.wav", words: "NARRATION.json", music: { source: "synth", bpm: 96 }, sfx: "auto" };
const SCRIPT = "Slide-on campers ride corrugations better. The weight sits low over the axle. And setup takes two minutes.";
const WORDS = SCRIPT.split(" ").map((text, i) => ({ text, start: round(0.2 + i * 0.62), end: round(0.2 + i * 0.62 + 0.45) }));
function round(value) { return Math.round(value * 1000) / 1000; }
const CLIPS = [{ src: "assets/footage/corrugations.mp4", kind: "video", duration: 20 }, { src: "assets/footage/axle.mp4", kind: "video", duration: 14 }, { src: "assets/photos/setup.jpg", kind: "image" }];

const base = (scenes) => ({ schema: "launchclip.story.v1", title: "Slide-on", lane: "voiceover-motion", format: FORMAT, brand: DEFAULT_BRAND, audio: AUDIO, scenes, overlays: [{ type: "captions", style: "word-highlight" }] });
// Today's plan: motion graphics only.
const graphics = base([
  { id: "s1", module: "hook-title", start: 0, end: "word:weight", energy: 1, params: { headline: "Slide-ons ride corrugations better", emphasis: "corrugations" } },
  { id: "s2", module: "callout", start: "word:weight", end: "word:And", energy: 2, in: { type: "fade", dur: 0.3 }, params: { title: "Weight sits low", body: "Over the axle" } },
  { id: "s3", module: "cta", start: "word:And", end: 12, energy: 1, in: { type: "fade", dur: 0.3 }, params: { action: "Book a test drive" } }
]);
// The clip-led plan: footage on every line, one short graphic.
const clipLed = base([
  { id: "s1", module: "clip", start: 0, end: "word:weight", energy: 1, params: { media: { src: "assets/footage/corrugations.mp4", sourceStart: 2, sourceEnd: 20 }, callouts: [{ text: "Built for corrugations" }] } },
  { id: "s2", module: "clip", start: "word:weight", end: "word:And", energy: 2, params: { media: { src: "assets/footage/axle.mp4", sourceStart: 1, sourceEnd: 14 }, focus: { x: 0.4, y: 0.6 }, callouts: [{ text: "Weight low over the axle" }] } },
  { id: "s3", module: "clip", start: "word:And", end: 12, energy: 1, in: { type: "fade", dur: 0.3 }, params: { media: "assets/photos/setup.jpg", callouts: [{ text: "Two-minute setup", emphasis: true }] } }
]);

function llm(boards) {
  const requests = [];
  return {
    requests,
    async runStructured(request) {
      requests.push(request);
      const board = boards[Math.min(requests.length - 1, boards.length - 1)];
      return { model: "test-model", value: { storyboard_json: JSON.stringify(board) }, usage: { input_tokens: 10, output_tokens: 5 } };
    }
  };
}
const plan = (client, extra) => planStoryboard({ brief: "A 12-second educational short about slide-on campers.", words: WORDS, lane: "voiceover-motion", format: FORMAT, audio: AUDIO, tier: "structured", model: "test-model", client, ...extra });

test("clip-led rule: the mode follows the density dial, and turns on only with footage and a dial", () => {
  const at = (density, extra = {}) => clipLedPlan({ lane: "voiceover-motion", density, densitySource: "test", clips: CLIPS, ...extra });
  assert.equal(at(0.2).mode, "clip-led");
  assert.equal(at(CLIP_LED_DENSITY.clipLed).mode, "mixed");
  assert.equal(at(0.45).mode, "mixed");
  assert.equal(at(CLIP_LED_DENSITY.mixed).mode, "graphics");
  assert.equal(at(0.9).mode, "graphics");
  // Lower density, more footage.
  assert.ok(at(0.1).target > at(0.3).target && at(0.3).target > at(0.45).target);
  assert.deepEqual([at(0.2).target, at(0.2).band], [0.65, [0.5, 0.8]]);
  // Off without a dial, without footage, or in footage-led (its base is the footage).
  assert.equal(at(null).mode, "graphics");
  assert.match(at(null).reason, /no density dial/);
  assert.equal(at(0.2, { clips: [] }).mode, "graphics");
  assert.equal(at(0.2, { clips: [], provider: true }).mode, "clip-led", "an asset provider can supply the footage");
  assert.equal(at(0.2, { lane: "footage-led" }).mode, "graphics");
});

test("clip-led rule: the cadence profile sets the clip length, and a measured clip_share band wins over the seed", async () => {
  const { profile } = resolveProfile("short-motion");
  const rule = clipLedPlan({ lane: "voiceover-motion", density: 0.2, clips: CLIPS, profile });
  assert.deepEqual(rule.shot, { target: profile.measures.shot_seconds.p50, max: profile.measures.shot_seconds.p90 });
  const measured = { id: "measured", measures: { clip_share: { p10: 0.4, p50: 0.6, p90: 0.9 } } };
  assert.deepEqual(clipShareBand(0, measured), { target: 0.9, band: [0.4, 0.9], source: "profile measured" });
  assert.deepEqual(clipShareBand(0.5, measured).target, 0.6);
  assert.equal(clipShareBand(0.2).source, "density");
});

test("clip-led rule: clip share and findings", () => {
  const rule = clipLedPlan({ lane: "voiceover-motion", density: 0.2, clips: CLIPS });
  const resolved = { format: FORMAT, resolved: { duration: 12 }, scenes: [{ id: "a", module: "clip", start: 0, end: 4 }, { id: "b", module: "callout", start: 4, end: 6 }, { id: "c", module: "clip", start: 6, end: 12 }, { id: "d", module: "clip", track: 1, start: 0, end: 12 }] };
  assert.equal(clipShare(resolved), 0.8333, "track-0 clips only");
  assert.deepEqual(clipLedFindings(rule, resolved).errors, []);
  const thin = { ...resolved, scenes: [{ id: "a", module: "clip", start: 0, end: 3 }, { id: "b", module: "callout", start: 3, end: 12 }] };
  const findings = clipLedFindings(rule, thin);
  assert.equal(findings.share, 0.25);
  assert.match(findings.errors[0], /clip scenes cover 25% of the runtime; the clip-led plan \(density 0\.2\) aims at 65% \(50%–80%\)/);
  // Mixed: the same gap is only a warning.
  const mixed = clipLedPlan({ lane: "voiceover-motion", density: 0.45, clips: CLIPS });
  assert.deepEqual(clipLedFindings(mixed, { ...thin, scenes: [{ id: "b", module: "callout", start: 0, end: 12 }] }).errors, []);
  assert.equal(clipLedFindings(mixed, { ...thin, scenes: [{ id: "b", module: "callout", start: 0, end: 12 }] }).warnings.length, 1);
  // A clip longer than the profile's shot is a warning.
  assert.match(clipLedFindings(rule, { ...resolved, scenes: [{ id: "a", module: "clip", start: 0, end: 12 }] }).warnings.at(-1), /clip a runs 12 s, over the profile's 8 s shot/);
});

test("planning prompt: the footage section appears only when the rule is on", () => {
  const rule = clipLedPlan({ lane: "voiceover-motion", density: 0.2, densitySource: "test", clips: CLIPS });
  const prompt = planningPrompt({ lane: "voiceover-motion", format: FORMAT, clipLed: rule });
  assert.match(prompt, /## Footage and graphics \(density\)/);
  assert.match(prompt, /- Clip-led \(density 0\.2 \(test\) with 3 clips: supplied footage carries the video\)\. Put full-frame clip scenes of the supplied footage on track 0 for about 65% of the runtime/);
  assert.match(prompt, /callouts/);
  assert.doesNotMatch(planningPrompt({ lane: "voiceover-motion", format: FORMAT }), /## Footage and graphics/);
  assert.deepEqual(clipLedLines(clipLedPlan({ lane: "voiceover-motion", density: 0.8, clips: CLIPS })), []);
  // The module itself is always in the catalogue section.
  assert.match(planningPrompt({ lane: "voiceover-motion", format: FORMAT }), /### clip \(keeps captions\)/);
});

test("planner: at low density with footage, a graphics-only plan is sent back and the clip-led repair passes", async () => {
  const client = llm([graphics, clipLed]);
  const report = await plan(client, { density: 0.2, clips: CLIPS });
  assert.equal(report.status, "passed", report.errors.join("\n"));
  assert.match(client.requests[0].instructions, /## Footage and graphics \(density\)/);
  assert.equal(report.attempts.length, 2);
  assert.ok(report.attempts[0].errors.some((entry) => /^clips: clip scenes cover 0% of the runtime; the clip-led plan/.test(entry)), report.attempts[0].errors.join("\n"));
  assert.deepEqual(report.storyboard.scenes.map((scene) => scene.module), ["clip", "clip", "clip"]);
  assert.equal(report.clip_led.mode, "clip-led");
  assert.equal(report.clip_led.share, 1);
});

test("planner: at high density (or with no dial) the motion-graphics plan passes as before", async () => {
  for (const extra of [{ density: 0.8, clips: CLIPS }, { clips: CLIPS }]) {
    const client = llm([graphics]);
    const report = await plan(client, extra);
    assert.equal(report.status, "passed", report.errors.join("\n"));
    assert.equal(report.attempts.length, 1);
    assert.equal(report.clip_led.mode, "graphics");
    assert.doesNotMatch(client.requests[0].instructions, /## Footage and graphics/);
  }
});

test("planner: the density dial comes from the option, else the style pack's dials", () => {
  assert.deepEqual(densityDial(0.3, { name: "warm", dials: { density: 0.9 } }), { density: 0.3, densitySource: "density option" });
  assert.deepEqual(densityDial(undefined, { name: "warm-documentary", dials: { density: 0.4 } }), { density: 0.4, densitySource: "style warm-documentary dials" });
  assert.deepEqual(densityDial(undefined, { name: "v2" }), { density: null, densitySource: null });
  assert.throws(() => densityDial(2), /density must be a number from 0 to 1/);
});

test("make: --density reaches the planner, and supplied footage is offered as clips", () => {
  assert.equal(makeOptionsFromFlags({ density: "0.2" }).density, "0.2");
  assert.throws(() => validateMakeOptions({ density: "loud" }), /--density must be a number from 0 to 1/);
  assert.doesNotThrow(() => validateMakeOptions({ density: "0.25" }));
  const ctx = (lane) => ({ routing: { lane, media: [{ path: "footage/beach.mp4", kind: "video", role: "b-roll", description: "B-roll footage", width: 1920, height: 1080, duration: 18 }, { path: "shots/app.png", kind: "image", role: "screenshot", description: "Screenshot" }], logos: [] } });
  const lines = assetManifestLines(ctx("voiceover-motion"));
  assert.equal(lines[0].clip, true);
  assert.match(lines[0].line, /Use as a full-frame clip scene cut to its line, \{"module": "clip", "params": \{"media": \{"kind": "video", "src": "assets\/footage\/beach\.mp4", "sourceStart": 0, "sourceEnd": 18\}/);
  // A screenshot is offered as a window first, then as a clip.
  assert.match(lines[1].line, /Use as a media-window scene .*, or a full-frame clip scene/);
  // footage-led keeps its inserts.
  const led = assetManifestLines(ctx("footage-led"));
  assert.equal(led[0].clip, undefined);
  assert.match(led[0].line, /full-frame insert that covers the speaker/);
});
