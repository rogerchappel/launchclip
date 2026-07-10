import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { produceAudio } from "../src/production_audio.js";
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
  const sfxLibrary = { resolvePlan: async () => [{ id: "tick", path: sfxSource, cue: "evidence tick", score: 2, shot_id: "shot-1", at_seconds: 1.5, volume: .3, intent: "mark proof" }] };

  const first = await produceAudio(workspace, {}, { provider, sfxLibrary });
  assert.equal(first.status, "ready");
  assert.equal(calls.length, 2);
  assert.equal(calls[0][1].text, "Proof becomes motion.");
  assert.equal(calls[1][1].prompt, "A plan-specific pulse");
  const sfx = JSON.parse(await readFile(first.sfx, "utf8"));
  assert.equal(sfx.cues[0].at_seconds, 1.5);
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

test("reuses Scribe word timing for supplied narration", async () => {
  const suppliedPath = path.join(await mkdtemp(path.join(os.tmpdir(), "launchclip-supplied-words-")), "take.mp4");
  await writeFile(suppliedPath, "take");
  const workspace = await fixture({ suppliedPath });
  const wordsPath = path.join(workspace, "scribed.words.json");
  await writeFile(wordsPath, `${JSON.stringify([{ word: "Proof", start: 0, end: 9.8 }])}\n`);
  await writeFile(path.join(workspace, "production", "evidence.json"), `${JSON.stringify({ items: [{ kind: "voiceover-transcript", role: "voiceover", provenance: suppliedPath, metadata: [{ key: "words_path", value: wordsPath }] }] })}\n`);
  const result = await produceAudio(workspace, { noMusic: true, noSfx: true }, {});
  const manifest = JSON.parse(await readFile(result.manifest, "utf8"));
  assert.equal(manifest.voiceover.duration_seconds, 9.8);
  assert.deepEqual(JSON.parse(await readFile(manifest.voiceover.words_path, "utf8")), [{ word: "Proof", start: 0, end: 9.8 }]);
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
    shots: [{ id: "shot-1", start_seconds: 0, sfx: [{ at_seconds: 1.5, cue: "evidence tick", intent: "mark proof", volume: .3 }] }]
  };
  await writeFile(path.join(workspace, "production", "intake.json"), `${JSON.stringify(intake)}\n`);
  await writeFile(path.join(workspace, "production", "plan.json"), `${JSON.stringify(plan)}\n`);
  const store = await ProductionJobStore.open(workspace);
  await store.add({ id: "creative-plan", kind: "creative-plan", depends_on: [], input_hash: semanticHash(plan) });
  await store.markRunning("creative-plan");
  await store.markSucceeded("creative-plan");
  return workspace;
}
