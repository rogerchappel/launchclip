// make on a fixed planner response: a tool-explainer brief, --style signal-ui
// and a canned plan built on ui-scene (host, burst, arranged stacks, rich
// headlines). No paid calls: the model is a fake and the voice is the test
// voice. Nothing in make builds a ui-scene itself, so this is the path a real
// planner's reel takes through make.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { resolveStory, validateStory } from "@launchclip/core/story.mjs";
import { runMake } from "../src/make/index.js";
import { testVoiceTimings } from "../src/voice/index.js";
import { mediaSkip } from "./helpers/media.js";
import { fakeFinish } from "./helpers/make_fakes.js";

const run = promisify(execFile);
const PROMPT = "An 8-second tool explainer for Clipline, a CLI that snaps every clip on your timeline to the beat";
const NARRATION = "Your timeline misses the beat again and again. Clipline snaps every clip to the grid. Twelve cuts unlocked today.";

// The plan a model would return for NARRATION on the signal-ui style.
function uiPlan(duration) {
  return {
    schema: "launchclip.story.v1",
    title: "Clipline",
    lane: "motion",
    format: { width: 1080, height: 1920, fps: 30, duration },
    audio: { words: "NARRATION.json" },
    scenes: [
      { id: "s1", module: "ui-scene", start: 0, end: "word:clipline", energy: 1, params: { elements: [
        { kind: "headline", rect: { x: 80, y: 280, width: 860, height: 210 }, at: 0, enter: "cut", props: { lines: [{ text: "OFF THE BEAT?", size: "s" }, { text: "*EVERY* CUT.", size: "l" }] } },
        { id: "term", kind: "terminal", rect: { x: 60, y: 660, width: 960, height: 640 }, at: 0, enter: "cut", props: { title: "clipline", sub: "scan", prompt: "clipline scan", typeAt: 0.2, cps: 30, lines: [{ at: "word:beat", key: "misses", text: "14 clips" }] } },
        { kind: "host", rect: { width: 176, height: 136 }, at: 0.3, props: { perch: "term", along: 0.8 }, beats: [{ at: "word:beat", set: { pose: "surprised" } }] }
      ] } },
      { id: "s2", module: "ui-scene", start: "word:clipline", end: "word:twelve", energy: 2, in: { type: "light-sweep", dur: 0.5 }, params: { elements: [
        { kind: "headline", rect: { x: 80, y: 280, width: 860, height: 210 }, at: 0, enter: "cut", props: { lines: [{ text: "ONE COMMAND.", size: "s" }, { text: "*ALL* SNAPPED.", size: "l" }] } },
        { kind: "stack", arrange: "fan", rect: { x: 40, y: 560, width: 1000, height: 890 }, at: 0, enter: "cut", children: [
          { kind: "terminal", props: { title: "clipline", sub: "snap", prompt: "clipline snap", typeAt: 0.1, cps: 40 } },
          { kind: "meter", props: { title: "DRIFT", unit: "FRAMES", from: 9, to: 0, settleAt: 0.6 } },
          { kind: "window", props: { title: "timeline" } }
        ] }
      ] } },
      { id: "s3", module: "ui-scene", start: "word:twelve", end: duration, energy: 2, in: { type: "push-blur", dur: 0.5 }, params: { elements: [
        { kind: "headline", rect: { x: 80, y: 280, width: 860, height: 300 }, at: 0, enter: "cut", props: { lines: [{ text: "12", size: "xl", accent: true, count: true }, { text: "CUTS UNLOCKED", size: "s" }] } },
        { kind: "stack", arrange: "wall", rect: { x: 40, y: 620, width: 1000, height: 830 }, at: 0, enter: "cut", children: [
          { id: "gauge", kind: "meter", props: { title: "ON BEAT", unit: "CUTS", from: 0, to: 12, settleAt: "word:unlocked" } },
          { kind: "window", props: { title: "plan.json" } },
          { kind: "window", props: { title: "render.log" } },
          { kind: "window", props: { title: "captions" } }
        ] },
        { kind: "burst", at: "word:unlocked", props: { target: "gauge" }, cue: "impact" }
      ] } }
    ],
    overlays: [{ type: "captions" }]
  };
}

function cannedModel() {
  const usage = { input_tokens: 4000, output_tokens: 800, total_tokens: 4800 };
  const boards = [];
  const client = {
    provider: "openai",
    async runStructured(request) {
      if (request.schemaName === "launchclip_direction") return { model: "fake", value: { direction_json: "" }, usage };
      if (request.schemaName === "launchclip_make_script") return { model: "fake", value: { title: "Clipline", narration: NARRATION }, usage };
      if (request.schemaName === "launchclip_storyboard") {
        boards.push(request);
        return { model: "fake", value: { storyboard_json: JSON.stringify(uiPlan(Number(/"duration":([\d.]+)/.exec(request.input)[1]))) }, usage };
      }
      throw new Error(`unexpected schema ${request.schemaName}`);
    }
  };
  return { boards, model: { client, provider: "openai", model: "fake", spec: "openai:fake" } };
}

const OPTIONS = { voice: "test", music: "synth", style: "signal-ui", aspect: "9:16" };

test("make: a tool-explainer brief, --style signal-ui and a canned ui-scene plan reach the story with the style's look", async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-ui-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const { boards, model } = cannedModel();
  const report = await runMake(PROMPT, { ...OPTIONS, cwd, out: "reel" }, { env: {}, client: model, finish: fakeFinish([]), notice() {} });
  assert.equal(report.status, "ready-for-review", JSON.stringify({ stages: report.stages, repairs: report.repairs }));
  assert.equal(report.routing.lane, "motion");
  assert.equal(report.style.name, "signal-ui");
  assert.equal(report.profile.id, "ui-explainer-reel");
  assert.equal(report.repairs.used, 0, JSON.stringify(report.repairs.attempts));
  assert.ok(!report.notices.some((line) => /world look/.test(line)), report.notices.join("\n"));

  // The planner saw the interface guide, with these capabilities, and the style's preference.
  const prompt = boards[0].instructions;
  assert.match(prompt, /Interface scenes \(ui-scene\)/);
  assert.match(prompt, /a host element is a small pixel mascot/);
  assert.match(prompt, /props \{perch: "<the panel's id>"/);
  assert.match(prompt, /A perch needs a flat top-level element/);
  assert.match(prompt, /The hero burst: /);
  assert.match(prompt, /arrange: "fan" \| "wall" \| "stack" \| "orbit"/);
  assert.match(prompt, /set a headline as rich lines \(props\.lines\)/);
  assert.match(prompt, /count: true/);
  assert.match(prompt, /Prefer these modules where the script allows: ui-scene/);
  assert.match(prompt, /the style pack sets the motion and camera \(camera\.mode "cuts"\); keep them/);
  assert.doesNotMatch(prompt, /For this request: motion\.grammar/);
  assert.match(boards[0].input, /ui-scene/, "the brief's phrase hint names the module");

  // The story validates, its anchors resolve, and the look is the style's.
  const project = path.join(cwd, "reel");
  const story = JSON.parse(await readFile(path.join(project, "storyboard.json"), "utf8"));
  assert.deepEqual(validateStory(story).errors, []);
  const words = testVoiceTimings(NARRATION).words;
  const resolved = resolveStory(story, { words });
  const seconds = (text) => words.find((word) => word.text.replace(/\W/g, "").toLowerCase() === text).start;
  assert.ok(Math.abs(resolved.scenes[1].start - seconds("clipline")) < 0.05, "scene anchors resolve");
  assert.ok(Math.abs(resolved.scenes[2].start - seconds("twelve")) < 0.05);
  const burst = resolved.scenes[2].params.elements.find((el) => el.kind === "burst");
  assert.equal(typeof burst.at, "number", "element anchors resolve");
  assert.equal(story.style, "signal-ui");
  assert.equal(story.motion.feel, "snap");
  assert.deepEqual(story.motion.blur, { samples: 6, shutter: 1.5 });
  assert.equal(story.light.preset, "studio");
  assert.equal(story.background.kind, "dot-grid");
  assert.equal(story.overlays.find((overlay) => overlay.type === "captions").preset, "word-chip");
  assert.equal(story.overlays.find((overlay) => overlay.type === "captions").position, "low");
  assert.equal(story.brand.colors.accent, "#c8ff3a");
  assert.equal(story.plate, undefined, "the style's dot grid stays the ground: no stock plates over it");
  assert.equal(story.camera.mode, "cuts", "the snap feel is the camera");
});

test("make: the canned ui-scene plan renders a real Remotion draft", { skip: mediaSkip(), timeout: 900_000 }, async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-ui-e2e-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const out = path.join(cwd, "reel");
  const { model } = cannedModel();
  const report = await runMake(PROMPT, { ...OPTIONS, cwd, out, renderer: "remotion" }, { env: {}, client: model, transcribe: async () => null, notice() {} });
  t.diagnostic(`make took ${report.timings.total}s: ${Object.entries(report.timings).map(([name, s]) => `${name} ${s}s`).join(", ")}`);
  assert.notEqual(report.status, "failed", JSON.stringify({ stages: report.stages, next: report.next_steps }));
  assert.equal(report.final, "renders/draft.mp4");
  const probe = JSON.parse((await run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height", "-of", "json", path.join(out, "renders/draft.mp4")])).stdout);
  assert.deepEqual(probe.streams.map((stream) => stream.codec_type).sort(), ["audio", "video"]);
  assert.equal(probe.streams.find((stream) => stream.codec_type === "video").width, 1080);
  // The render carries the style: the checks that read the frames agree. The
  // bands a real reel is gated on (cadence, stillness, packaging) are not this
  // short plan's to pass, and the status says so rather than failing the run.
  for (const gate of ["layout", "holds", "audio", "temporal_evidence"]) assert.equal(report.gates[gate].status, "passed", `${gate}: ${JSON.stringify(report.gates[gate])}`);
  const style = JSON.parse(await readFile(path.join(out, "qa/style-check.json"), "utf8"));
  for (const name of ["palette", "captions"]) assert.ok(style.checks.find((check) => check.check === name).ok, name);
});
