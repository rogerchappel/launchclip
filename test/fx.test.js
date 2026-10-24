// launchclip fx: one module on a clip. The matte and finish are stand-ins
// (the example's exact matte, no render), so no model runs.
import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { canvasFor, parseFxTime, readFxParams, runFx } from "../src/fx.js";
import { readProjectStory } from "../src/story_loader.js";

const EXAMPLE = fileURLToPath(new URL("../examples/story/subject", import.meta.url));
const SOURCE = { sha256: "a".repeat(64), width: 720, height: 1280, fps: 30, duration: 6 };

async function clip(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-fx-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await copyFile(path.join(EXAMPLE, "assets/recording.mp4"), path.join(dir, "founder.mp4"));
  return dir;
}

function adapters(calls) {
  return {
    describe: async () => SOURCE,
    matte: async (file, range) => {
      calls.push({ matte: range, file });
      const info = JSON.parse(await readFile(path.join(EXAMPLE, "assets/subject/0.000-6.000.json"), "utf8"));
      return { info: { ...info, range }, matte: path.join(EXAMPLE, "assets/subject/0.000-6.000.webm"), cached: false };
    },
    transcribe: async () => ({ segments: [{ words: [{ word: " Meet", start: 0.4, end: 0.8 }, { word: " Ledgerly.", start: 0.9, end: 1.5 }, { word: " Try", start: 3.6, end: 3.9 }, { word: " it.", start: 4, end: 4.3 }] }] }),
    finish: async (project, options) => { calls.push({ finish: options }); return { status: "ready-for-review", final: path.join(project, "renders/draft.mp4"), warnings: [], stages: [] }; }
  };
}

test("fx builds a one-scene footage story, mattes the scene's range and finishes", async (t) => {
  const dir = await clip(t);
  const calls = [];
  const report = await runFx(path.join(dir, "founder.mp4"), "masthead", { at: 0.2, for: 3, params: { word: "Ledgerly" } }, adapters(calls));
  assert.equal(report.project, path.join(dir, "founder.fx"));
  assert.deepEqual(report.scene, { start: 0.2, end: 3.2 });
  // The masthead is behind the presenter, so its range is matted (padded 0.5 s), from the project's copy.
  assert.deepEqual(calls[0].matte, { in: 0, out: 3.7 });
  assert.equal(calls[0].file, path.join(dir, "founder.fx/assets/founder.mp4"));
  assert.deepEqual(calls[1].finish, { quality: "draft", music: "none" });
  const { resolved } = await readProjectStory(report.project);
  assert.equal(resolved.lane, "footage-led");
  assert.equal(resolved.base.volume, 1);
  assert.equal(resolved.base.subject.mattes[0].src, "assets/subject/0.000-3.700.webm");
  assert.deepEqual(resolved.scenes.map((scene) => [scene.module, scene.start, scene.end]), [["masthead", 0.2, 3.2]]);
});

test("fx resolves word anchors from the clip's words and skips matting for a front module", async (t) => {
  const dir = await clip(t);
  const calls = [];
  const report = await runFx(path.join(dir, "founder.mp4"), "emphasis-caption", { at: "word:ledgerly", until: "word:try", params: { text: "Ledgerly" } }, adapters(calls));
  assert.deepEqual(report.scene, { start: 0.9, end: 3.6 });
  assert.equal(report.subject, null);
  assert.deepEqual(calls.map((call) => Object.keys(call)[0]), ["finish"]);
  const words = JSON.parse(await readFile(path.join(report.project, "NARRATION.json"), "utf8")).words;
  assert.deepEqual(words.map((word) => word.text), ["Meet", "Ledgerly.", "Try", "it."]);
});

test("fx refuses an unknown module, a word anchor without --until, and a scene that does not fit", async (t) => {
  const dir = await clip(t);
  const video = path.join(dir, "founder.mp4");
  await assert.rejects(runFx(video, "sparkles", {}, adapters([])), /Unknown module sparkles/);
  await assert.rejects(runFx(video, "masthead", { at: "word:meet" }, adapters([])), /give --until/);
  await assert.rejects(runFx(video, "masthead", { at: 0, for: 2, params: {} }, adapters([])), /does not fit this clip.*word/);
});

test("fx helpers: times, params and the canvas", async () => {
  assert.equal(parseFxTime("2.5", "--at"), 2.5);
  assert.equal(parseFxTime("word:try#2", "--at"), "word:try#2");
  assert.throws(() => parseFxTime("soon", "--at"), /seconds or word/);
  assert.deepEqual(await readFxParams('{"word":"Hi"}'), { word: "Hi" });
  await assert.rejects(readFxParams("[1]"), /JSON object/);
  assert.deepEqual(canvasFor({ width: 2160, height: 3840 }), { width: 1080, height: 1920 });
  assert.deepEqual(canvasFor({ width: 1279, height: 719 }), { width: 1280, height: 720 });
});
