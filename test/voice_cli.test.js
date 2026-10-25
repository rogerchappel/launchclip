import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runCli } from "../src/cli.js";
import { runVoiceCommand } from "../src/voice_cli.js";
import { NARRATION_DEFAULTS, narrationCacheKey, narrationRequest, narrationSentences } from "../src/voice/narrate.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const TEXT = "Builds took forty-eight minutes. Now twelve! Three changes did it.";

function capture() {
  let out = "";
  return { stdout: { write: (text) => { out += text; } }, stderr: { write() {} }, get out() { return out; } };
}

test("narrationRequest fills provider defaults: kokoro, af_heart, 1.2", () => {
  assert.deepEqual(narrationRequest({ text: " Hi. " }), { text: "Hi.", provider: "kokoro", voice: "af_heart", speed: 1.2 });
  assert.deepEqual(NARRATION_DEFAULTS.kokoro, { voice: "af_heart", speed: 1.2 });
  assert.deepEqual(narrationRequest({ text: "Hi.", provider: "test" }), { text: "Hi.", provider: "test", voice: null, speed: 1 });
  assert.deepEqual(narrationRequest({ text: "Hi.", voice: "am_adam", speed: 1.1 }, { speed: "1.3" }), { text: "Hi.", provider: "kokoro", voice: "am_adam", speed: 1.3 });
  assert.throws(() => narrationRequest({ text: "Hi." }, { speed: 4 }), /between 0.5 and 2/);
  assert.notEqual(narrationCacheKey(narrationRequest({ text: "Hi." })), narrationCacheKey(narrationRequest({ text: "Hi.", speed: 1.1 })));
  assert.deepEqual(narrationSentences([{ text: "One.", start: 0, end: 0.4 }, { text: "Two", start: 0.5, end: 0.8 }, { text: "three?", start: 0.9, end: 1.2 }]).map((row) => [row.start, row.end, row.text]), [[0, 0.4, "One."], [0.5, 1.2, "Two three?"]]);
});

test("launchclip voice measures a project's narration before any scenes, and finish reuses the take", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-voice-"));
  try {
    // A storyboard with narration and no scenes yet.
    await writeFile(path.join(project, "storyboard.json"), JSON.stringify({ schema: "launchclip.story.v1", audio: { narration: { text: TEXT, provider: "test" } }, scenes: [] }));
    const io = capture();
    await runCli(["voice", project], { ...io });
    assert.match(io.out, /duration: \d+\.\d\d s {3}words: 10/);
    assert.match(io.out, /word:builds/);
    assert.match(io.out, /word:three/);
    const narration = JSON.parse(await readFile(path.join(project, "NARRATION.json"), "utf8"));
    assert.equal(narration.schema_version, "launchclip.narration.v1");
    assert.equal(narration.words.length, 10);
    assert.ok(existsSync(path.join(project, "assets/audio/narration.wav")));
    const again = await runVoiceCommand(project, {});
    assert.equal(again.cached, true, "the same request is a cached take");
    assert.equal(again.duration_seconds, narration.duration_seconds);
    assert.equal(again.sentences.length, 3);
    // Speed is part of the request.
    const faster = await runVoiceCommand(project, { speed: "1.5" });
    assert.equal(faster.cached, false);
    assert.ok(faster.duration_seconds < again.duration_seconds);
    // JSON output for scripts.
    const json = capture();
    await runCli(["voice", project, "--json"], { ...json });
    assert.equal(JSON.parse(json.out).word_count, 10);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("launchclip voice --text needs no project; --voice takes a provider or a voice id", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-voice-text-"));
  try {
    const env = { LAUNCHCLIP_CACHE: path.join(dir, "cache") };
    const out = path.join(dir, "measure", "NARRATION.json");
    const io = capture();
    await runCli(["voice", "--text", TEXT, "--voice", "test", "--out", out], { ...io, productionAdapters: { voice: { env } } });
    assert.match(io.out, /^voice: test at speed 1/);
    assert.ok(existsSync(out));
    assert.ok(existsSync(path.join(dir, "measure", "NARRATION.wav")));
    assert.ok(existsSync(path.join(dir, "cache", "voice")), "takes without a project cache under $LAUNCHCLIP_CACHE/voice");
    // A voice id is passed through as the voice (the provider still comes from --provider).
    const report = await runVoiceCommand(null, { text: TEXT, provider: "test", voice: "alto", out }, { env });
    assert.equal(report.request.voice, "alto");
    await assert.rejects(runVoiceCommand(null, {}, { env }), /needs a project with audio.narration.text \(or dialogue lines\), or --text/);
    await assert.rejects(runVoiceCommand(null, { text: TEXT, provider: "nope" }, { env }), /Unknown voice provider/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("finish synthesises from the cached take launchclip voice measured", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-voice-finish-"));
  try {
    await cp(path.join(ROOT, "examples/story/minimal"), project, { recursive: true });
    await rm(path.join(project, "NARRATION.json"), { force: true });
    const story = JSON.parse(await readFile(path.join(project, "storyboard.json"), "utf8"));
    delete story.audio.mix;
    delete story.audio.words;
    story.audio.narration = { text: "Builds took forty-eight minutes. Now twelve. Three changes did it. Watch again.", provider: "test" };
    await writeFile(path.join(project, "storyboard.json"), JSON.stringify(story));
    let synth = 0;
    const { createTestVoiceProvider } = await import("../src/voice/index.js");
    const voiceProvider = () => { const real = createTestVoiceProvider(); return { name: "test", synthesize: (request) => { synth += 1; return real.synthesize(request); } }; };
    const measured = await runVoiceCommand(project, {}, { voiceProvider });
    assert.equal(synth, 1);
    const { runFinish } = await import("../src/finish.js");
    const report = await runFinish(project, { renderer: "remotion", previewScene: "s1" }, {
      voiceProvider,
      env: {},
      notice() {},
      renderer: (name) => ({ name, async render(_project, out) { await writeFile(out, "video"); return { output: out }; } }),
      async synthKit() { return {}; },
      async buildMix(options) { await writeFile(options.out, "mix"); return { cues: [] }; }
    });
    const voice = report.stages.find((stage) => stage.name === "voice");
    assert.equal(voice.status, "done", voice.error);
    assert.equal(voice.details.cached_take, true);
    assert.equal(synth, 1, "finish reused the measured take");
    assert.equal(voice.details.duration_seconds, measured.duration_seconds);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

// Joining dialogue lines runs ffmpeg, which the CI test jobs lack.
test("launchclip voice voices a dialogue story line by line, with each word's speaker", async (t) => {
  const { execFile } = await import("node:child_process");
  try { await new Promise((resolve, reject) => execFile("ffmpeg", ["-version"], (error) => error ? reject(error) : resolve())); } catch { t.skip("ffmpeg is unavailable"); return; }
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-voice-dialogue-"));
  try {
    const story = JSON.parse(await readFile(path.join(ROOT, "examples/story/characters-16x9/storyboard.json"), "utf8"));
    story.audio.narration.provider = "test";
    story.audio.narration.lines = story.audio.narration.lines.slice(1, 4);
    await writeFile(path.join(project, "storyboard.json"), JSON.stringify(story));
    const { createTestVoiceProvider } = await import("../src/voice/index.js");
    const requests = [];
    const voiceProvider = () => { const real = createTestVoiceProvider(); return { name: "test", synthesize: (request) => { requests.push(request); return real.synthesize(request); } }; };
    const io = capture();
    await runCli(["voice", project], { ...io, productionAdapters: { voice: { voiceProvider } } });
    assert.match(io.out, /^voice: test dialogue \(narrator:bf_emma, maya:bf_emma, theo:bf_emma\)/);
    assert.match(io.out, /lines: 3/);
    assert.match(io.out, / 2 .* maya +word:not +Not again/);
    assert.equal(requests.length, 3, "one take per line");
    const narration = JSON.parse(await readFile(path.join(project, "NARRATION.json"), "utf8"));
    assert.equal(narration.schema_version, "launchclip.narration.v1");
    assert.deepEqual([...new Set(narration.words.map((word) => word.speaker))], ["narrator", "maya", "theo"]);
    assert.deepEqual(narration.lines.map((line) => line.speaker), ["narrator", "maya", "theo"]);
    assert.equal(narration.lines[1].text, "Not again. Three hours, gone.");
    assert.ok(existsSync(path.join(project, "assets/audio/narration.wav")));
    const again = await runVoiceCommand(project, {}, { voiceProvider });
    assert.equal(again.cached, true);
    assert.equal(again.duration_seconds, narration.duration_seconds);
    assert.ok(again.duration_seconds >= narration.lines.at(-1).end - 0.001);
    // Speed reaches every line, and is a new set of takes.
    const faster = await runVoiceCommand(project, { speed: "1.5" }, { voiceProvider });
    assert.equal(faster.cached, false);
    assert.ok(faster.duration_seconds < again.duration_seconds);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

