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

test("uses supplied narration without calling TTS and reports timing drift from generated speech", async () => {
  const suppliedPath = path.join(await mkdtemp(path.join(os.tmpdir(), "launchclip-supplied-")), "take.mp4");
  await writeFile(suppliedPath, "take");
  const workspace = await fixture({ suppliedPath });
  const result = await produceAudio(workspace, { noMusic: true, noSfx: true }, { provider: { synthesizeNarration: async () => { throw new Error("must not call"); } } });
  assert.equal((await readFile(result.voiceover)).toString(), "take");

  const generated = await fixture();
  const driftingProvider = {
    synthesizeNarration: async (options) => { await writeFile(options.outputPath, "voice"); await writeFile(options.wordsPath, "[]"); return { path: options.outputPath, words_path: options.wordsPath, duration_seconds: 14 }; }
  };
  const drift = await produceAudio(generated, { noMusic: true, noSfx: true }, { provider: driftingProvider });
  assert.equal(drift.status, "needs-retiming");
  assert.match(drift.warnings[0], /4\.00s/);
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
    format: { duration_seconds: 10, language: "en" },
    narration: { source: supplied ? "supplied" : "generated", full_text: "Proof becomes motion." },
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
