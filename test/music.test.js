import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadCliEnv, loadDotEnv, parseDotEnv } from "../src/env.js";
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
    const target = path.join(temp, "video", "public", "music", "unit-test-bed.mp3");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "not a real mp3, just an existing file sentinel");

    const result = await generateMusic(temp, { timeline: timelinePath, output: "music/unit-test-bed.mp3", volume: 0.11 });
    const timeline = JSON.parse(await readFile(timelinePath, "utf8"));
    assert.equal(result.skipped, "exists (use --force to regenerate)");
    assert.equal(result.music, target);
    assert.equal(timeline.audio.music, "music/unit-test-bed.mp3");
    assert.equal(timeline.audio.music_volume, 0.11);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("music output cannot escape the workspace public directory", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-music-"));
  try {
    await assert.rejects(
      generateMusic(temp, { duration: 12, output: "../../outside.mp3" }),
      /must stay inside the workspace/
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
// ---------------------------------------------------------------------------
// .env loading

test("parseDotEnv reads plain, exported, quoted and commented lines (both parsers)", () => {
  const text = "# comment\nA=1\nexport B=two\nC=\"quoted value\"\nD='single'\nE=bare # trailing comment\n\nBROKEN LINE\n";
  for (const native of [true, false]) {
    const parsed = parseDotEnv(text, { native });
    assert.equal(parsed.A, "1");
    assert.equal(parsed.B, "two");
    assert.equal(parsed.C, "quoted value");
    assert.equal(parsed.D, "single");
    assert.equal(parsed.E, "bare");
  }
});

test("loadDotEnv never overrides variables that are already set", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-env-"));
  try {
    await writeFile(path.join(dir, ".env"), "ELEVENLABS_API_KEY=from-file\nNEW_ONE=added\n");
    const env = { ELEVENLABS_API_KEY: "from-shell" };
    const set = loadDotEnv(dir, { env });
    assert.deepEqual(set, ["NEW_ONE"]);
    assert.equal(env.ELEVENLABS_API_KEY, "from-shell");
    assert.equal(env.NEW_ONE, "added");
    assert.equal(loadDotEnv(path.join(dir, "missing"), { env }), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadCliEnv reads the working directory first, then a project command's directory", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-env-cli-"));
  try {
    const project = path.join(dir, "project");
    await mkdir(project);
    await writeFile(path.join(dir, ".env"), "SHARED=cwd\nONLY_CWD=1\n");
    await writeFile(path.join(project, ".env"), "SHARED=project\nONLY_PROJECT=1\n");
    const env = {};
    const loaded = loadCliEnv(["finish", "project"], { cwd: dir, env });
    assert.deepEqual(loaded, [path.join(dir, ".env"), path.join(project, ".env")]);
    assert.deepEqual(env, { SHARED: "cwd", ONLY_CWD: "1", ONLY_PROJECT: "1" });
    // Non-project commands only read the working directory.
    const other = {};
    assert.deepEqual(loadCliEnv(["doctor"], { cwd: dir, env: other }), [path.join(dir, ".env")]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
