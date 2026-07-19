import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { produceAudio, produceCinematicNarration } from "../src/production_audio.js";
import { ProductionJobStore, semanticHash } from "../src/job_store.js";
import { PRODUCTION_PLAN_VERSION } from "../src/production_contracts.js";

test("produces ElevenLabs narration and music plus timed local SFX as resumable artifacts", async () => {
  const workspace = await fixture();
  const calls = [];
  const provider = {
    synthesizeNarration: async (options) => {
      calls.push(["voice", options]);
      await writeFile(options.outputPath, "voice");
      await writeFile(options.wordsPath, "[]\n");
      return { provider: "elevenlabs", kind: "narration", path: options.outputPath, words_path: options.wordsPath, duration_seconds: 10, request_id: "voice_req" };
    },
    composeMusic: async (options) => {
      calls.push(["music", options]);
      await writeFile(options.outputPath, "music");
      return { provider: "elevenlabs", kind: "music", path: options.outputPath, duration_seconds: 10, song_id: "song_1" };
    }
  };
  const sfxSource = path.join(workspace, "tick.wav");
  await writeFile(sfxSource, "tick");
  const sfxLibrary = { resolvePlan: async () => [{ id: "tick", path: sfxSource, cue: "evidence tick", score: 2, shot_id: "shot-1", event_id: "shot-1-proof-lock", at_seconds: 1.5, volume: .3, intent: "mark proof" }] };

  const first = await produceAudio(workspace, {}, { provider, sfxLibrary });
  assert.equal(first.status, "ready");
  assert.equal(calls.length, 2);
  assert.equal(calls[0][1].text, "Proof becomes motion.");
  assert.equal(calls[1][1].prompt, "A plan-specific pulse");
  const sfx = JSON.parse(await readFile(first.sfx, "utf8"));
  assert.equal(sfx.cues[0].at_seconds, 1.5);
  assert.equal(sfx.cues[0].event_id, "shot-1-proof-lock");
  assert.match(sfx.cues[0].path, /production\/media\/sfx\/001-tick\.wav$/);

  const cached = await produceAudio(workspace, {}, { provider, sfxLibrary });
  assert.equal(cached.cached, true);
  assert.equal(calls.length, 2);
});

test("segments long-form narration and music within ElevenLabs limits, then joins exact timelines", async () => {
  const narrationText = "Alpha beta gamma. Delta epsilon zeta. Eta theta iota.";
  const workspace = await fixture({ durationSeconds: 1205, narrationText });
  const voiceCalls = [];
  const musicCalls = [];
  let voiceIndex = 0;
  const provider = {
    synthesizeNarration: async (options) => {
      voiceCalls.push(options);
      voiceIndex += 1;
      await writeFile(options.outputPath, `voice-${voiceIndex}`);
      const duration = 1205 / 3;
      const words = [{ word: `part-${voiceIndex}`, start: 0, end: duration }];
      await writeFile(options.wordsPath, `${JSON.stringify(words)}\n`);
      return { provider: "elevenlabs", path: options.outputPath, words_path: options.wordsPath, words, duration_seconds: duration, request_id: `voice-${voiceIndex}` };
    },
    composeMusic: async (options) => {
      musicCalls.push(options);
      await writeFile(options.outputPath, "music");
      return { provider: "elevenlabs", path: options.outputPath, duration_seconds: options.durationSeconds, request_id: `music-${musicCalls.length}`, song_id: `song-${musicCalls.length}` };
    }
  };
  const joins = [];
  const result = await produceAudio(workspace, { noVoice: true, noSfx: true, maxNarrationChars: 100 }, {
    provider,
    combineAudio: async (inputs, output) => { joins.push(inputs); await writeFile(output, "joined"); }
  });
  const manifest = JSON.parse(await readFile(result.manifest, "utf8"));
  assert.equal(voiceCalls.length, 0);
  assert.equal(musicCalls.length, 3);
  assert.ok(musicCalls.every((entry) => entry.durationSeconds <= 600));
  assert.ok(Math.abs(musicCalls.reduce((sum, entry) => sum + entry.durationSeconds, 0) - 1205) < .001);
  assert.equal(manifest.music.segments.length, 3);
  assert.equal(joins.length, 1);

  const segmentedWorkspace = await fixture({ durationSeconds: 1205, narrationText: narrationText.repeat(8) });
  voiceCalls.length = 0;
  musicCalls.length = 0;
  voiceIndex = 0;
  joins.length = 0;
  const segmented = await produceAudio(segmentedWorkspace, { noMusic: true, noSfx: true, maxNarrationChars: 100 }, {
    provider,
    combineAudio: async (inputs, output) => { joins.push(inputs); await writeFile(output, "joined"); },
    conformNarration: async (voiceover, duration) => ({ ...voiceover, original_duration_seconds: voiceover.duration_seconds, duration_seconds: duration, conformed: true })
  });
  const segmentedManifest = JSON.parse(await readFile(segmented.manifest, "utf8"));
  assert.ok(voiceCalls.length > 1);
  assert.equal(voiceCalls[1].previousRequestIds[0], "voice-1");
  assert.ok(voiceCalls.every((entry) => entry.text.length <= 100));
  assert.equal(segmentedManifest.voiceover.segments.length, voiceCalls.length);
  assert.equal(joins.length, 1);
});

test("uses supplied narration without calling TTS and reports timing drift from generated speech", async () => {
  const suppliedPath = path.join(await mkdtemp(path.join(os.tmpdir(), "launchclip-supplied-")), "take.mp4");
  await writeFile(suppliedPath, "take");
  const workspace = await fixture({ suppliedPath });
  const result = await produceAudio(workspace, { noMusic: true, noSfx: true }, { provider: { synthesizeNarration: async () => { throw new Error("must not call"); } }, probeDuration: async () => 10 });
  assert.equal((await readFile(result.voiceover)).toString(), "take");

  const generated = await fixture();
  const driftingProvider = {
    synthesizeNarration: async (options) => { await writeFile(options.outputPath, "voice"); await writeFile(options.wordsPath, "[]"); return { provider: "elevenlabs", path: options.outputPath, words_path: options.wordsPath, duration_seconds: 14 }; }
  };
  const drift = await produceAudio(generated, { noMusic: true, noSfx: true }, { provider: driftingProvider, conformNarration: async (voiceover, duration) => ({ ...voiceover, original_duration_seconds: voiceover.duration_seconds, duration_seconds: duration, conformed: true }) });
  assert.equal(drift.status, "ready");
  assert.match(drift.notes[0], /4\.00s/);
});

test("reuses Scribe word timing while preserving supplied media duration", async () => {
  const suppliedPath = path.join(await mkdtemp(path.join(os.tmpdir(), "launchclip-supplied-words-")), "take.mp4");
  await writeFile(suppliedPath, "take");
  const workspace = await fixture({ suppliedPath });
  const wordsPath = path.join(workspace, "scribed.words.json");
  await writeFile(wordsPath, `${JSON.stringify([{ word: "Proof", start: 0, end: 9.8 }])}\n`);
  await writeFile(path.join(workspace, "production", "evidence.json"), `${JSON.stringify({ items: [{ kind: "voiceover-transcript", role: "voiceover", provenance: suppliedPath, metadata: [{ key: "words_path", value: wordsPath }] }] })}\n`);
  const result = await produceAudio(workspace, { noMusic: true, noSfx: true }, { probeDuration: async () => 10.25 });
  const manifest = JSON.parse(await readFile(result.manifest, "utf8"));
  assert.equal(manifest.voiceover.duration_seconds, 10.25);
  assert.deepEqual(JSON.parse(await readFile(manifest.voiceover.words_path, "utf8")), [{ word: "Proof", start: 0, end: 9.8 }]);
});

test("recovers an interrupted aggregate audio job", async () => {
  const workspace = await fixture();
  const intake = JSON.parse(await readFile(path.join(workspace, "production", "intake.json"), "utf8"));
  const plan = JSON.parse(await readFile(path.join(workspace, "production", "plan.json"), "utf8"));
  const evidence = { items: [] };
  const options = { noMusic: true, noSfx: true };
  const inputHash = semanticHash({ intake, plan, evidence, options: {
    noVoice: false, noMusic: true, noSfx: true, voiceId: null, voiceModel: null, musicModel: null,
    sfxDir: null, words: null, maxNarrationChars: null, voiceSettings: null
  }, audio: "production-audio.v3" });
  const store = await ProductionJobStore.open(workspace, { create: false });
  await store.add({ id: "production-audio", kind: "production-audio", depends_on: ["creative-plan"], input_hash: inputHash });
  await store.markRunning("production-audio");
  const result = await produceAudio(workspace, options, { store, provider: {
    synthesizeNarration: async (request) => {
      await writeFile(request.outputPath, "voice");
      await writeFile(request.wordsPath, "[]\n");
      return { provider: "elevenlabs", path: request.outputPath, words_path: request.wordsPath, duration_seconds: 10 };
    }
  } });
  assert.equal(result.status, "ready");
  assert.equal(store.get("production-audio").status, "succeeded");
});

test("synthesizes cinematic narration before edit planning and reuses the measured take", async () => {
  const workspace = await cinematicFixture();
  const calls = [];
  const provider = { synthesizeNarration: async (options) => {
    calls.push(options);
    const words = [
      { word: "Proof", start: 0.1, end: 0.6 },
      { word: "becomes", start: 0.75, end: 1.3 },
      { word: "motion.", start: 1.35, end: 2.1 }
    ];
    await writeFile(options.outputPath, "measured voice");
    await writeFile(options.wordsPath, `${JSON.stringify(words)}\n`);
    return { provider: "elevenlabs", kind: "narration", path: options.outputPath, words_path: options.wordsPath, words, duration_seconds: 2.1, request_id: "cinematic-voice" };
  } };
  const narration = await produceCinematicNarration(workspace, {}, { provider });
  assert.equal(narration.duration_seconds, 2.1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, "Proof becomes motion.");
  assert.equal(calls[0].voiceSettings.speed, 1.06);
  const timing = JSON.parse(await readFile(narration.manifest, "utf8"));
  assert.equal(timing.timing_source, "measured");
  assert.equal(timing.words[1].word, "becomes");
  assert.deepEqual(timing.pauses, [{ start_seconds: 0.6, end_seconds: 0.75, duration_seconds: 0.15, after_word_index: 0 }]);
  assert.equal(timing.beat_timings[0].measured_end_seconds, 2.1);

  const plan = cinematicPlan(2.1);
  await writeFile(path.join(workspace, "production", "plan.json"), `${JSON.stringify(plan)}\n`);
  const store = await ProductionJobStore.open(workspace, { create: false });
  await store.add({ id: "creative-plan", kind: "creative-plan", depends_on: ["cinematic-narration"], input_hash: semanticHash(plan) });
  await store.markRunning("creative-plan");
  await store.markSucceeded("creative-plan");
  const audio = await produceAudio(workspace, { noMusic: true, noSfx: true }, { store, provider: { synthesizeNarration: async () => { throw new Error("must reuse measured take"); } } });
  assert.equal(audio.status, "ready");
  assert.equal((await readFile(audio.voiceover)).toString(), "measured voice");
  assert.equal(calls.length, 1);
});

test("creates an explicit editorial timing estimate for silent cinematic output", async () => {
  const workspace = await cinematicFixture();
  const result = await produceCinematicNarration(workspace, { noVoice: true }, {});
  const timing = JSON.parse(await readFile(result.manifest, "utf8"));
  assert.equal(result.timing_source, "editorial-estimate");
  assert.equal(timing.duration_seconds, 10);
  assert.equal(timing.word_count, 3);
  assert.equal(timing.words[0].word, "Proof");
});

async function fixture(options = {}) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "launchclip-audio-"));
  await mkdir(path.join(workspace, "production"), { recursive: true });
  const supplied = Boolean(options.suppliedPath);
  const intake = {
    resources: supplied ? [{ id: "voice", role: "voiceover", type: "video", location: options.suppliedPath, is_remote: false, sha256: "voice" }] : []
  };
  const plan = {
    schema_version: PRODUCTION_PLAN_VERSION,
    format: { duration_seconds: options.durationSeconds ?? 10, language: "en" },
    narration: { source: supplied ? "supplied" : "generated", full_text: options.narrationText ?? "Proof becomes motion." },
    audio: { music_prompt: "A plan-specific pulse" },
    shots: [{ id: "shot-1", start_seconds: 0, visual: { events: [{ id: "shot-1-proof-lock", at_seconds: 1.5, sfx_eligible: true }] }, sfx: [{ at_seconds: 1.5, cue: "evidence tick", event_id: "shot-1-proof-lock", intent: "mark proof", volume: .3 }] }]
  };
  await writeFile(path.join(workspace, "production", "intake.json"), `${JSON.stringify(intake)}\n`);
  await writeFile(path.join(workspace, "production", "plan.json"), `${JSON.stringify(plan)}\n`);
  const store = await ProductionJobStore.open(workspace);
  await store.add({ id: "creative-plan", kind: "creative-plan", depends_on: [], input_hash: semanticHash(plan) });
  await store.markRunning("creative-plan");
  await store.markSucceeded("creative-plan");
  return workspace;
}

async function cinematicFixture() {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "launchclip-cinematic-audio-"));
  await mkdir(path.join(workspace, "production"), { recursive: true });
  const intake = {
    profile: { id: "cinematic" },
    resources: [],
    brief: { duration_seconds: 10 }
  };
  const story = {
    format: { duration_seconds: 10, language: "en" },
    narration: {
      source: "generated",
      full_text: "Proof becomes motion.",
      delivery: "Fast, punchy, precise.",
      beats: [{ id: "hook", role: "hook", target_start_seconds: 0, target_end_seconds: 10, spoken_text: "Proof becomes motion." }]
    }
  };
  await writeFile(path.join(workspace, "production", "intake.json"), `${JSON.stringify(intake)}\n`);
  await writeFile(path.join(workspace, "production", "story.json"), `${JSON.stringify(story)}\n`);
  await writeFile(path.join(workspace, "production", "evidence.json"), `${JSON.stringify({ items: [] })}\n`);
  const store = await ProductionJobStore.open(workspace);
  await store.add({ id: "retention-story", kind: "retention-story", depends_on: [], input_hash: semanticHash(story) });
  await store.markRunning("retention-story");
  await store.markSucceeded("retention-story");
  return workspace;
}

function cinematicPlan(durationSeconds) {
  return {
    schema_version: PRODUCTION_PLAN_VERSION,
    format: { duration_seconds: durationSeconds, language: "en" },
    narration: { source: "generated", full_text: "Proof becomes motion." },
    audio: { music_prompt: "A plan-specific pulse" },
    shots: [{ id: "shot-1", start_seconds: 0, visual: { events: [] }, sfx: [] }]
  };
}
