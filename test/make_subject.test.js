// launchclip make and the subject stage: the presenter probe reaches the
// planner, the planned subject ranges are matted and filed, and finish sees
// them through base.subject "auto". Probe and matte are stand-ins, so no
// model runs.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_BRAND } from "../kit/core/planning-prompt.mjs";
import { runMake } from "../src/make/index.js";
import { readProjectStory } from "../src/story_loader.js";

const words = ["Meet", "Ledgerly.", "It", "matches", "every", "payout", "automatically.", "Try", "it", "today."].map((text, i) => ({ word: text, start: 0.3 + i * 0.6, end: 0.7 + i * 0.6 }));
const head = { x: 0.5, y: 0.3, w: 0.2, h: 0.15 };

async function project(t) {
  const assets = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-subject-"));
  const out = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-subject-out-"));
  t.after(async () => { await rm(assets, { recursive: true, force: true }); await rm(out, { recursive: true, force: true }); });
  await writeFile(path.join(assets, "founder.mp4"), "recording");
  return { assets, out };
}

const inventory = async (dir) => ({ dir, entries: [{ path: "founder.mp4", kind: "video", role: "talking-head", confidence: 0.9, signals: ["camera-look"], description: "Talking-head recording", media: { kind: "video", width: 1080, height: 1920, duration: 7, orientation: "portrait", mountable: true }, speech: { present: true }, transcript: { text: "x", words: words.map((w) => ({ text: w.word, start: w.start, end: w.end })) }, fingerprint: "1" }], counts: {}, summary: [] });

const prepareRecording = async (_input, options) => {
  await mkdir(options.out, { recursive: true });
  await writeFile(path.join(options.out, "base-edit.mp4"), "edited");
  await writeFile(path.join(options.out, "transcript.json"), JSON.stringify({ words, duration_seconds: 6.6 }));
  return { status: "ready", output: path.join(options.out, "base-edit.mp4"), duration_seconds: 6.6, rendered_duration_seconds: 6.6, source_duration_seconds: 7, files: { transcript: path.join(options.out, "transcript.json") }, manifest: path.join(options.out, "recording.json") };
};

function client(prompts, scenes) {
  return {
    client: {
      provider: "openai",
      async runStructured(request) {
        // The direction-map call gets no map; make drafts DIRECTION.json from the storyboard.
        if (request.schemaName === "launchclip_direction") return { model: "recorded", value: { direction_json: "" }, usage: { input_tokens: 1, output_tokens: 1 } };
        prompts.push(request.instructions);
        const board = { schema: "launchclip.story.v1", lane: "footage-led", format: { width: 1080, height: 1920, fps: 30, duration: 6.6 }, brand: DEFAULT_BRAND, audio: { words: "NARRATION.json" }, base: "assets/base-edit.mp4", scenes, overlays: [{ type: "captions", style: "word-highlight" }] };
        return { model: "gpt-5.6-luna", value: { storyboard_json: JSON.stringify(board) }, usage: { input_tokens: 10, output_tokens: 10 } };
      }
    },
    provider: "openai", model: "gpt-5.6-luna", spec: "openai:gpt-5.6-luna", vision: false
  };
}

const finish = async (dir) => {
  await mkdir(path.join(dir, "renders"), { recursive: true });
  await writeFile(path.join(dir, "renders/draft.mp4"), "video");
  return { status: "ready-for-review", seconds: 1, final: path.join(dir, "renders/draft.mp4"), warnings: [], stages: [], gates: {} };
};

// Stand-ins for runSubjectProbe / runSubjectMatte with real output files.
function subjectAdapters({ usable = true, calls }) {
  return {
    describe: async () => ({ sha256: "a".repeat(64), width: 1080, height: 1920, fps: 30, duration: 6.6 }),
    probe: async (file) => {
      calls.push({ probe: file });
      return { probe: { usable, reasons: usable ? [] : ["more than one person is in frame"], framing: "medium", headroom: 0.22, head, people: usable ? "one" : "several" }, cached: false };
    },
    matte: async (_file, range, options) => {
      calls.push({ matte: range });
      const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-fake-matte-"));
      await writeFile(path.join(dir, "matte.webm"), "matte");
      await writeFile(path.join(dir, "plate.jpg"), "plate");
      const frame = { t: range.in, coverage: 0.3, people: "one", head, body: { x: 0.5, y: 0.65, w: 0.6, h: 0.7 } };
      const info = { schema: "launchclip.subject.v1", source: options.source, model: "modnet-fused", range, matte: "matte.webm", plate: "plate.jpg", people: "one", framing: "medium", usable: true, reasons: [], head, body: frame.body, headroom: 0.22, coverage: 0.3, stability: 0.99, frames: [frame] };
      return { info, dir, matte: path.join(dir, "matte.webm"), plate: path.join(dir, "plate.jpg"), cached: false, seconds: 1.2 };
    }
  };
}

test("make probes the presenter, plans with it and mattes the masthead's range", async (t) => {
  const { assets, out } = await project(t);
  const prompts = [];
  const calls = [];
  const scenes = [
    { id: "name", module: "masthead", track: 1, start: "word:meet", end: "word:every", params: { word: "Ledgerly" } },
    { id: "c1", module: "emphasis-caption", track: 2, start: "word:every", end: "word:try", params: { text: "Every payout" } }
  ];
  const report = await runMake("Dress my founder clip", { assets, out, voice: "test" }, { env: {}, client: client(prompts, scenes), inventory, prepareRecording, finish, subject: subjectAdapters({ calls }), notice() {} });
  assert.equal(report.stages.subject?.status, "done", JSON.stringify({ stages: report.stages, steps: report.next_steps }));
  assert.match(prompts[0], /## Presenter \(subject\)/);
  assert.match(prompts[0], /^### masthead \(/m);
  assert.equal(report.subject.status, "usable");
  // masthead runs from "Meet" (0.3 s) to "every" (2.7 s); padded by 0.5 s and clamped at 0.
  assert.deepEqual(calls.filter((call) => call.matte).map((call) => call.matte), [{ in: 0, out: 3.2 }]);
  assert.equal(report.subject.mattes.length, 1);
  assert.ok(existsSync(path.join(out, "assets/subject/0.000-3.200.webm")));
  assert.ok(existsSync(path.join(out, "assets/subject/0.000-3.200.plate.jpg")));
  const { resolved } = await readProjectStory(out);
  assert.equal(resolved.base.subject.mattes[0].src, "assets/subject/0.000-3.200.webm");
  assert.equal(resolved.base.subject.mattes[0].summary.framing, "medium");
});

test("an unusable probe plans without subject modules and mattes nothing", async (t) => {
  const { assets, out } = await project(t);
  const prompts = [];
  const calls = [];
  const scenes = [{ id: "c1", module: "emphasis-caption", track: 1, start: "word:every", end: "word:try", params: { text: "Every payout" } }];
  const report = await runMake("Dress my founder clip", { assets, out, voice: "test" }, { env: {}, client: client(prompts, scenes), inventory, prepareRecording, finish, subject: subjectAdapters({ usable: false, calls }), notice() {} });
  assert.match(prompts[0], /No subject modules: more than one person is in frame/);
  assert.doesNotMatch(prompts[0], /^### masthead/m);
  assert.equal(report.stages.subject.status, "skipped");
  assert.deepEqual(calls.filter((call) => call.matte), []);
});

test("--no-subject skips the probe entirely", async (t) => {
  const { assets, out } = await project(t);
  const prompts = [];
  const calls = [];
  const scenes = [{ id: "c1", module: "emphasis-caption", track: 1, start: "word:every", end: "word:try", params: { text: "Every payout" } }];
  const report = await runMake("Dress my founder clip", { assets, out, voice: "test", subject: false }, { env: {}, client: client(prompts, scenes), inventory, prepareRecording, finish, subject: subjectAdapters({ calls }), notice() {} });
  assert.deepEqual(calls, []);
  assert.deepEqual(report.subject, { status: "off", reason: "--no-subject" });
  assert.match(prompts[0], /No subject modules/);
});
