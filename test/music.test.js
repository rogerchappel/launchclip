import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildElevenLabsMusicPayload, generateMusic, resolveElevenLabsMusicModel, resolveMusicPrompt, shouldAutoGenerateMusic } from "../src/music.js";

test("music prompt resolution prefers override, then script, then default", () => {
  assert.equal(resolveMusicPrompt({ override: "custom bed" }), "custom bed");
  assert.equal(resolveMusicPrompt({ script: { music_prompt: "script bed" } }), "script bed");
  assert.match(resolveMusicPrompt(), /Retro 80s synthwave/);
});

test("direct music auto-generation only runs when enabled and keyed", () => {
  assert.equal(shouldAutoGenerateMusic({}, { ELEVENLABS_API_KEY: "key" }), true);
  assert.equal(shouldAutoGenerateMusic({ music: "music/manual.mp3" }, { ELEVENLABS_API_KEY: "key" }), false);
  assert.equal(shouldAutoGenerateMusic({ "no-music": true }, { ELEVENLABS_API_KEY: "key" }), false);
  assert.equal(shouldAutoGenerateMusic({}, {}), false);
});

test("ElevenLabs music payload is bounded and model-selectable", () => {
  assert.equal(resolveElevenLabsMusicModel({}, { ELEVENLABS_MUSIC_MODEL: "music_v2" }), "music_v2");
  assert.equal(resolveElevenLabsMusicModel({ "music-model": "music_v1" }, { ELEVENLABS_MUSIC_MODEL: "music_v2" }), "music_v1");
  assert.deepEqual(buildElevenLabsMusicPayload({ prompt: "tight tutorial bed", durationSeconds: 12, modelId: "music_v2" }), {
    prompt: "tight tutorial bed",
    music_length_ms: 13500,
    model_id: "music_v2",
    force_instrumental: true
  });
  assert.equal(buildElevenLabsMusicPayload({ durationSeconds: 999 }).music_length_ms, 600000);
});

test("existing generated music still wires into a motion timeline", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-music-"));
  try {
    await mkdir(path.join(temp, "video"), { recursive: true });
    const timelinePath = path.join(temp, "video", "motion-timeline.json");
    await writeFile(
      timelinePath,
      `${JSON.stringify({ version: "motion.timeline.v1", duration_seconds: 12, audio: { music: "" } }, null, 2)}\n`
    );
    const target = path.join(process.cwd(), "public", "music", "unit-test-bed.mp3");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "not a real mp3, just an existing file sentinel");

    const result = await generateMusic(temp, { timeline: timelinePath, output: "music/unit-test-bed.mp3", volume: 0.11 });
    const timeline = JSON.parse(await readFile(timelinePath, "utf8"));
    assert.equal(result.skipped, "exists (use --force to regenerate)");
    assert.equal(timeline.audio.music, "music/unit-test-bed.mp3");
    assert.equal(timeline.audio.music_volume, 0.11);
    await rm(target, { force: true });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
