// Tempo, beat grid, SFX typing and sync (docs/PLAN_AND_PACE_RFC.md §4.3, phase 3 tests).
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzeRhythm, analyzeRhythmFile, AUDIO_RHYTHM, rhythmSync } from "../src/render_audio_analysis.js";
import { FAMILY_TYPE as SFX_FAMILY_TYPES, sfxType } from "../src/sfx/classify.js";
import { decodeAudio } from "../src/music/beats.js";
import { kitVariants, synthCue } from "../src/scripts/synth-audio-kit.mjs";
import { SFX_FAMILY_NAMES } from "@launchclip/core/sound/options.mjs";
import { mediaSkip } from "./helpers/media.js";

const SR = AUDIO_RHYTHM.rate;
const ROOT = path.resolve(import.meta.dirname, "..");

function rng(seed) {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; };
}

/** A 20 s click track at `bpm`, each click jittered by up to ±10 ms; → {samples, clicks}. */
function clickTrack(bpm, seconds = 20) {
  const next = rng(bpm);
  const samples = new Float32Array(seconds * SR);
  const clicks = [];
  for (let t = 0.5; t < seconds - 0.3; t += 60 / bpm) {
    const at = t + (next() * 2 - 1) * 0.01;
    clicks.push(at);
    const start = Math.round(at * SR);
    for (let i = 0; i < 0.03 * SR; i += 1) samples[start + i] += 0.8 * (next() * 2 - 1) * Math.exp(-i / (0.005 * SR));
  }
  return { samples, clicks };
}

for (const bpm of [90, 120, 150]) {
  test(`click track at ${bpm} BPM with ±10 ms jitter: tempo within 1 BPM, beats within 20 ms`, () => {
    const { samples, clicks } = clickTrack(bpm);
    const rhythm = analyzeRhythm(samples);
    assert.ok(Math.abs(rhythm.tempo_bpm - bpm) <= 1, `tempo ${rhythm.tempo_bpm}`);
    assert.ok(rhythm.beat_strength >= AUDIO_RHYTHM.noBeatStrength, `strength ${rhythm.beat_strength}`);
    for (const click of clicks) {
      const nearest = Math.min(...rhythm.beats.map((beat) => Math.abs(beat - click)));
      assert.ok(nearest <= 0.02, `click at ${click.toFixed(3)} s: nearest beat ${(nearest * 1000).toFixed(1)} ms away`);
    }
    assert.equal(rhythm.sfx.length, 0, "clicks on the beat are music, not SFX");
  });
}

test("silence has no beat, no SFX and no interior near silence", () => {
  const rhythm = analyzeRhythm(new Float32Array(5 * SR));
  assert.equal(rhythm.tempo_bpm, null);
  assert.deepEqual([rhythm.beats, rhythm.sfx, rhythm.near_silences], [[], [], []]);
});

test("SFX are typed by the §4.3 rules, as calibrated on our kit", () => {
  assert.equal(sfxType({ decay_seconds: 0.5, hf: 0.4, centroid_hz: 4000, tonality: 3 }), "whoosh");
  assert.equal(sfxType({ decay_seconds: 0.4, hf: 0.02, centroid_hz: 1500, tonality: 8 }), "whoosh");
  assert.equal(sfxType({ decay_seconds: 0.6, hf: 0.02, centroid_hz: 1500, tonality: 60 }), "ding");
  assert.equal(sfxType({ decay_seconds: 0.5, hf: 0, centroid_hz: 90, tonality: 80 }), "impact");
  assert.equal(sfxType({ decay_seconds: 0.04, hf: 0.05, centroid_hz: 2000, tonality: 20 }), "click");
  assert.equal(sfxType({ decay_seconds: 0.1, hf: 0, centroid_hz: 500, tonality: 40 }), "pop");
  assert.equal(sfxType({ decay_seconds: 0.1, hf: 0.1, centroid_hz: 2000, tonality: 10 }), "hit");
  for (const family of SFX_FAMILY_NAMES) assert.ok(family in SFX_FAMILY_TYPES, `${family} has an expected type (or null)`);
});

test("sync: on-beat cuts against chance, and SFX on picture", () => {
  const beats = Array.from({ length: 40 }, (_, i) => i * 0.5);
  const onBeat = rhythmSync({ beats, cuts: [2, 4.02, 6.5, 9.04, 12], sfx: [{ at_seconds: 4.1 }, { at_seconds: 7.3 }], duration: 20 });
  assert.equal(onBeat.cuts_on_beat_ratio, 1);
  assert.equal(onBeat.cuts_on_beat_chance, 0.28);
  assert.equal(onBeat.beat_synced, true);
  assert.equal(onBeat.sfx_on_picture_ratio, 0.5);
  const offBeat = rhythmSync({ beats, cuts: [2.2, 4.3, 6.2, 9.3], duration: 20 });
  assert.equal(offBeat.cuts_on_beat_ratio, 0);
  assert.equal(offBeat.beat_synced, false);
  assert.equal(rhythmSync({ beats: [], cuts: [1, 2], duration: 5 }).cuts_on_beat_ratio, null);
});

test("speech only: no beat, and few SFX outside the detected phrases", { skip: mediaSkip(), timeout: 60_000 }, async () => {
  const rhythm = await analyzeRhythmFile(path.join(ROOT, "examples/codex-hyperframes-quick-iteration/assets/narration-elevenlabs.mp3"));
  assert.equal(rhythm.tempo_bpm, null, `strength ${rhythm.beat_strength}, percussive share ${rhythm.percussive_share_p90}`);
  assert.deepEqual(rhythm.beats, []);
  assert.ok(rhythm.speech.length >= 3, "phrases are found");
  // Consonants outside the voiced phrases still slip through; keep them under the low density line.
  assert.ok(rhythm.sfx.length / (rhythm.duration_seconds / 60) < 15, `${rhythm.sfx.length} SFX in ${rhythm.duration_seconds} s`);
});

test("our synthesized SFX families measure as their type at least 80% of the time", { skip: mediaSkip(), timeout: 240_000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "launchclip-sfx-types-"));
  try {
    const entries = kitVariants({ families: SFX_FAMILY_NAMES.filter((family) => SFX_FAMILY_TYPES[family]) });
    const misses = [];
    for (let i = 0; i < entries.length; i += 8) {
      await Promise.all(entries.slice(i, i + 8).map(async (entry) => {
        const { file } = await synthCue(entry, directory);
        const { samples } = await decodeAudio(file, { rate: SR });
        // One second of silence either side: the cue alone, as an isolated SFX.
        const padded = new Float32Array(samples.length + 2 * SR);
        padded.set(samples, SR);
        const found = analyzeRhythm(padded).sfx[0];
        if (found?.type !== SFX_FAMILY_TYPES[entry.family] || Math.abs(found.at_seconds - 1) > 0.05) misses.push(`${entry.name}: ${found ? `${found.type} at ${found.at_seconds - 1} s` : "none"}`);
      }));
    }
    const right = 1 - misses.length / entries.length;
    assert.ok(right >= 0.8, `${(right * 100).toFixed(0)}% right; misses: ${misses.join(", ")}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a burst of keystrokes is typing", { skip: mediaSkip(), timeout: 60_000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "launchclip-sfx-typing-"));
  try {
    const keys = kitVariants({ families: ["keystroke"] }).slice(0, 3);
    const decoded = await Promise.all(keys.map(async (entry) => (await decodeAudio((await synthCue(entry, directory)).file, { rate: SR })).samples));
    const samples = new Float32Array(4 * SR);
    // Irregular, as typing is (a steady rate would read as a beat).
    const next = rng(7);
    for (let i = 0, at = 1; i < 8; i += 1, at += 0.1 + next() * 0.12) samples.set(decoded[i % decoded.length].subarray(0, Math.round(0.09 * SR)), Math.round(at * SR));
    const rhythm = analyzeRhythm(samples);
    assert.ok(rhythm.sfx.length >= 6, `${rhythm.sfx.length} keys found`);
    assert.ok(rhythm.sfx.every((entry) => entry.type === "typing"), rhythm.sfx.map((entry) => entry.type).join(", "));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
