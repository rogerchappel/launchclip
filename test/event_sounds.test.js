import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyEventSounds, describeCueSound, eventSoundFile, eventSoundHash, generatedBudget, parseSfxMode, placeEventSound, planEventSounds, resolveSfxMode } from "../src/sfx/event_sounds.js";
import { encodeWav } from "../src/sfx/process.js";
import { PATHS, runFinish } from "../src/finish.js";
import { MAKE_FLAGS, makeOptionsFromFlags, validateMakeOptions } from "../src/make/options.js";
import { makeSfxMode } from "../src/make/index.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const MINIMAL = path.join(ROOT, "examples/story/minimal");
const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();
const ffmpegSkip = hasFfmpeg ? false : "needs ffmpeg";

// A short decaying tone with a sharp onset: something processFile accepts as one hit.
function hitWav(seconds = 0.6, freq = 220) {
  const rate = 48000;
  const frames = Math.round(seconds * rate);
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    const t = i / rate;
    mono[i] = t < 0.05 ? 0 : Math.sin(2 * Math.PI * freq * t) * 0.8 * Math.exp(-(t - 0.05) * 8);
  }
  return encodeWav([mono, mono], rate);
}

const cue = (fields) => ({ cue: "pop", at: 2, volume: 0.4, shot: "s1", source: "module-event", event: "show", intent: "module-event show", ...fields });

test("rules name the sound from the event, then the screen, then the narration", () => {
  assert.match(describeCueSound(cue({ event: "stamp" })).prompt, /rubber stamp/);
  const money = describeCueSound(cue({}), { scene: { id: "s1", params: { title: "Fines up to $53,000" } } });
  assert.match(money.prompt, /coins/);
  assert.equal(money.from, "screen");
  const said = describeCueSound(cue({ at: 3 }), { words: [{ word: "the", start: 2.5, end: 2.7 }, { word: "padlock", start: 2.8, end: 3.2 }] });
  assert.match(said.prompt, /padlock/);
  assert.equal(said.from, "narration");
  // A count of money ticks like a register; a bare count like a counter.
  assert.match(describeCueSound(cue({ cue: "tally", event: "count" }), { scene: { params: { label: "Revenue" } } }).prompt, /cash register/);
  assert.match(describeCueSound(cue({ cue: "tally", event: "count" })).prompt, /counter wheels/);
  assert.equal(describeCueSound(cue({ event: "show" }), { scene: { params: { title: "A quiet morning" } } }), null);
  // Paths and media are not words on screen.
  assert.equal(describeCueSound(cue({}), { scene: { params: { media: { src: "assets/coins.mp4" } } } }), null);
});

test("the plan keeps accents only, spaced out, within the budget; the model names the rest", async () => {
  const cues = [
    cue({ at: 0.5, cue: "whoosh", source: "transition", event: "whip-in" }),
    cue({ at: 1, event: "stamp" }),
    cue({ at: 1.5, event: "stamp" }),
    cue({ at: 6, cue: "impact", source: "hit", event: "punch" }),
    cue({ at: 12, cue: "keystroke", source: "typing" }),
    cue({ at: 14, cue: "tick", event: "lock" })
  ];
  const story = { scenes: [{ id: "s1", params: { title: "Plain words" } }] };
  const asked = [];
  const plan = await planEventSounds(cues, { story, duration: 20, describe: async (items) => { asked.push(...items); return { [items[0].id]: { prompt: "a deep wooden knock", seconds: 9 } }; } });
  assert.deepEqual(plan.map((entry) => entry.cue.at), [1, 6, 14]);
  assert.equal(plan.find((entry) => entry.cue.at === 6).prompt, "a deep wooden knock");
  assert.equal(plan.find((entry) => entry.cue.at === 6).seconds, 2);
  assert.equal(plan.find((entry) => entry.cue.at === 6).from, "model");
  assert.deepEqual(asked.map((item) => item.family), ["impact"]);
  // Without a model the unnamed cue keeps its kit sound; a failing model is ignored.
  assert.equal((await planEventSounds(cues, { story, duration: 20 })).length, 2);
  assert.equal((await planEventSounds(cues, { story, duration: 20, describe: async () => { throw new Error("down"); } })).length, 2);
  assert.equal(generatedBudget(60), 10);
  assert.equal(generatedBudget(5), 2);
  assert.equal(generatedBudget(600), 12);
});

test("placement lands the peak on the event, matches the kit's loudness and sits lower under a word", () => {
  const placed = placeEventSound(cue({ at: 2, volume: 0.4 }), { measurements: { peak_at_ms: 300, loudness_lufs: -14 }, kitLufs: -20 });
  assert.equal(placed.at, 1.88);
  assert.equal(placed.pre_roll, 0.12);
  assert.equal(placed.volume, Math.round(0.4 * 10 ** (-6 / 20) * 1000) / 1000);
  const quiet = placeEventSound(cue({ at: 2, volume: 0.4 }), { measurements: { peak_at_ms: 20 }, words: [{ word: "now", start: 1.9, end: 2.2 }] });
  assert.equal(quiet.at, 1.98);
  assert.equal(quiet.volume, 0.28);
  assert.equal(quiet.under_speech, true);
});

test("modes: generated needs a key, kit and off pass through, anything else is refused", () => {
  assert.deepEqual(resolveSfxMode("generated", { ELEVENLABS_API_KEY: "k" }), { mode: "generated" });
  assert.equal(resolveSfxMode("generated", {}).mode, "kit");
  assert.match(resolveSfxMode("generated", {}).warning, /ELEVENLABS_API_KEY/);
  assert.deepEqual(resolveSfxMode(undefined, {}), { mode: "kit" });
  assert.deepEqual(resolveSfxMode("off", {}), { mode: "off" });
  assert.throws(() => parseSfxMode("loud"), /--sfx must be generated, kit, off/);
  assert.ok(MAKE_FLAGS.some(([flag]) => flag === "sfx"));
  assert.equal(makeOptionsFromFlags({ sfx: "kit" }).sfx, "kit");
  assert.throws(() => validateMakeOptions({ sfx: "loud" }), /--sfx/);
  assert.equal(makeSfxMode(undefined, { ELEVENLABS_API_KEY: "k" }), "generated");
  assert.equal(makeSfxMode(undefined, {}), "kit");
  assert.equal(makeSfxMode("off", { ELEVENLABS_API_KEY: "k" }), "off");
});

test("a described sound is generated once: the cache, then the project lock, answer after that", { skip: ffmpegSkip }, async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-event-sfx-"));
  const cacheDir = path.join(project, "cache");
  try {
    const calls = [];
    const generate = async (request) => { calls.push(request); return hitWav(); };
    const env = { ELEVENLABS_API_KEY: "test-key" };
    const sound = { prompt: "single heavy rubber stamp pressed hard onto a sheet of paper on a desk", seconds: 0.8 };
    const first = await eventSoundFile(sound, { project, env, cacheDir, lock: { sounds: {} }, generate });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].text, sound.prompt);
    assert.equal(calls[0].apiKey, "test-key");
    assert.equal(first.cached, false);
    assert.ok(first.cost_usd > 0);
    assert.ok(existsSync(path.join(cacheDir, `${eventSoundHash(sound)}.mp3`)));
    assert.ok(existsSync(first.file));
    const cached = await eventSoundFile(sound, { project, env, cacheDir, lock: { sounds: {} }, generate });
    assert.equal(calls.length, 1);
    assert.equal(cached.cached, true);
    assert.equal(cached.cost_usd, 0);
    const locked = await eventSoundFile(sound, { project, env, cacheDir: path.join(project, "empty-cache"), lock: { sounds: { [first.hash]: { prompt: sound.prompt } } }, generate });
    assert.equal(locked.locked, true);
    assert.equal(calls.length, 1);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("applying sounds: a failure keeps the kit cue, a success replaces it and is locked", { skip: ffmpegSkip }, async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-event-apply-"));
  try {
    const cues = [cue({ at: 1, file: "/kit/pop.wav" }), cue({ at: 8, cue: "impact", file: "/kit/impact.wav" })];
    const plan = [
      { index: 0, cue: cues[0], prompt: "a small handful of metal coins dropping onto a wooden table", seconds: 1, from: "screen" },
      { index: 1, cue: cues[1], prompt: "broken prompt", seconds: 1, from: "screen" }
    ];
    const generate = async ({ text }) => { if (text === "broken prompt") throw new Error("quota exceeded"); return hitWav(); };
    const result = await applyEventSounds(cues, plan, { project, env: { ELEVENLABS_API_KEY: "k" }, cacheDir: path.join(project, "cache"), generate });
    assert.equal(result.cues[0].sfx_source, "generated");
    assert.equal(result.cues[0].replaced, "pop");
    assert.match(result.cues[0].file, /sfx-events/);
    assert.equal(result.cues[1].file, "/kit/impact.wav");
    assert.equal(result.cues[1].sfx_source, undefined);
    assert.equal(result.generated.length, 1);
    assert.match(result.warnings[0], /quota exceeded.*kept the kit sound/);
    const lock = JSON.parse(await readFile(path.join(project, ".launchclip/sfx-events-lock.json"), "utf8"));
    assert.equal(Object.values(lock.sounds)[0].prompt, plan[0].prompt);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

// The finish sound stage end to end with offline stand-ins (as test/sound_palettes.test.js).
function adapters({ generate, describe } = {}) {
  const touch = async (file, content = "x") => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, content); };
  const calls = { mixes: [], notices: [] };
  return {
    calls,
    env: { ELEVENLABS_API_KEY: "test-key" },
    notice(line) { calls.notices.push(line); },
    generateSound: generate,
    describeSounds: describe,
    renderer: (name) => ({ name, async render(_p, out) { await touch(out, `video ${Math.random()}`); return { output: out }; } }),
    async synthKit(outDir, bed) {
      await touch(path.join(outDir, "AUDIO-KIT.json"), "{}");
      if (bed) await touch(path.join(outDir, "music", "bed.wav"));
      return {};
    },
    async buildMix(options) {
      calls.mixes.push(options);
      await touch(options.out, "mix");
      return { cues: options.cues };
    },
    async hasAudio() { return true; },
    async master(_input, output, target) { await touch(output, "m"); return { target: { integrated_lufs: target.lufs, true_peak_dbtp: target.tp }, output: { integrated_lufs: -14, true_peak_dbtp: -1.5 }, compliant: true }; },
    async buildEvidence(dir) { await touch(path.join(dir, PATHS.evidence), JSON.stringify({ schema_version: "launchclip.subscription-temporal-evidence.v1", entries: [] })); return { samples: 0, artifacts: 0, sheets: [] }; },
    async motion(_video, out) { await touch(out, "{}"); return { quality: { ok: true, findings: [] } }; },
    async audio() { return { quality: { ok: true, findings: [] } }; }
  };
}

async function minimalProject() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-event-finish-"));
  await cp(MINIMAL, dir, { recursive: true });
  await rm(path.join(dir, "assets/audio/mix.wav"), { force: true });
  await rm(path.join(dir, "NARRATION.json"), { force: true });
  const story = JSON.parse(await readFile(path.join(dir, "storyboard.json"), "utf8"));
  delete story.audio.mix;
  story.audio.narration = { text: "Builds took forty-eight minutes. Now twelve. Three changes did it. Watch again.", provider: "test" };
  await writeFile(path.join(dir, "storyboard.json"), `${JSON.stringify(story, null, 2)}\n`);
  return dir;
}

test("finish --sfx generated: described cues reach the mix and the SFX manifest; kit leaves them alone", { skip: ffmpegSkip }, async () => {
  const dir = await minimalProject();
  const cache = await mkdtemp(path.join(os.tmpdir(), "launchclip-event-cache-"));
  try {
    const generated = [];
    const fake = adapters({
      generate: async (request) => { generated.push(request.text); return hitWav(); },
      describe: async (items) => Object.fromEntries(items.map((item) => [item.id, { prompt: `a crisp ${item.family} sound for ${item.event ?? "a moment"}`, seconds: 1 }]))
    });
    fake.eventSoundCacheDir = cache;
    const report = await runFinish(dir, { renderer: "remotion", music: "synth", sfx: "generated" }, fake);
    const sound = report.stages.find((stage) => stage.name === "sound");
    assert.equal(sound.status, "done", sound.error);
    assert.equal(sound.details.sfx_mode, "generated");
    const manifest = JSON.parse(await readFile(path.join(dir, PATHS.sfxManifest), "utf8"));
    assert.equal(manifest.mode, "generated");
    const described = manifest.cues.filter((entry) => entry.source === "generated");
    assert.ok(described.length >= 1, "at least one cue got a described sound");
    assert.ok(described.every((entry) => entry.prompt && entry.file.includes("sfx-events")));
    assert.equal(sound.details.sfx_generated.count, manifest.generated.length);
    assert.ok(generated.length >= 1);
    assert.ok(fake.calls.notices.some((line) => /PAID ElevenLabs sound effect/.test(line)));
    const mixed = fake.calls.mixes.at(-1).cues.filter((entry) => entry.sfx_source === "generated");
    assert.equal(mixed.length, described.length);

    const kitDir = await minimalProject();
    try {
      const kit = adapters({ generate: async () => { throw new Error("must not be called"); } });
      await runFinish(kitDir, { renderer: "remotion", music: "synth", sfx: "kit" }, kit);
      const kitManifest = JSON.parse(await readFile(path.join(kitDir, PATHS.sfxManifest), "utf8"));
      assert.equal(kitManifest.mode, "kit");
      assert.equal(kitManifest.cues.some((entry) => entry.source === "generated"), false);
    } finally {
      await rm(kitDir, { recursive: true, force: true });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(cache, { recursive: true, force: true });
  }
});
