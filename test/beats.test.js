import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { resolveAnchor } from "../kit/core/story.mjs";
import { analyzeBeatsFile, analyzeSamples, beatsDocument, gridFromBpm, transformGrid } from "../src/music/beats.js";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");
const SYNTH = path.join(ROOT, "skills/launchclip-create-video/scripts/synth-audio-kit.mjs");
const RATE = 22050;

// A click track: a low thump on every bar line (accent), a bright tick on the
// other beats, light noise, optional timing jitter ("humanised") and an
// optional decaying piano-like tone instead of clicks ("acoustic").
function clickTrack(bpm, seconds, { start = 0.25, accentPhase = 0, noise = 0.02, jitter = 0, acoustic = false, seed = 7 } = {}) {
  const samples = new Float32Array(Math.round(seconds * RATE));
  const period = 60 / bpm;
  let state = seed;
  const random = () => ((state = (state * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < samples.length; i += 1) samples[i] = noise * random();
  const times = [];
  const downbeats = [];
  for (let k = 0; start + k * period < seconds - 0.2; k += 1) {
    const t = start + k * period + jitter * random();
    times.push(t);
    const accent = k % 4 === accentPhase;
    if (accent) downbeats.push(t);
    const at = Math.round(t * RATE);
    const amplitude = accent ? 0.9 : 0.5;
    for (let i = 0; i < RATE * (acoustic ? 0.4 : 0.05) && at + i < samples.length; i += 1) {
      const time = i / RATE;
      samples[at + i] += acoustic
        ? amplitude * (Math.sin(2 * Math.PI * (accent ? 110 : 220) * time) + 0.5 * Math.sin(2 * Math.PI * (accent ? 220 : 660) * time)) * Math.exp(-time / 0.12) * Math.min(1, time / 0.002)
        : amplitude * Math.sin(2 * Math.PI * (accent ? 80 : 1500) * time) * Math.exp(-time / 0.012) + amplitude * 0.5 * random() * Math.exp(-time / 0.002);
    }
  }
  return { samples, times, downbeats };
}

function nearestError(list, t) {
  return Math.min(...list.map((value) => Math.abs(value - t)));
}

function assertGrid(result, truth, { bpm, toleranceMs = 20, label }) {
  assert.ok(Math.abs(result.bpm - bpm) <= 1, `${label}: ${result.bpm} BPM, expected ${bpm} ± 1`);
  const worst = Math.max(...truth.times.map((t) => nearestError(result.beats, t)));
  assert.ok(worst * 1000 <= toleranceMs, `${label}: worst beat error ${(worst * 1000).toFixed(1)} ms`);
  if (truth.downbeats) {
    const worstDownbeat = Math.max(...truth.downbeats.map((t) => nearestError(result.downbeats, t)));
    assert.ok(worstDownbeat * 1000 <= toleranceMs, `${label}: worst downbeat error ${(worstDownbeat * 1000).toFixed(1)} ms`);
  }
}

test("click tracks: BPM within 1 and beats and downbeats within 20 ms at several tempos", () => {
  for (const bpm of [72, 90, 100, 120, 128, 140]) {
    const track = clickTrack(bpm, 20, { accentPhase: bpm % 3 });
    assertGrid(analyzeSamples(track.samples, RATE), track, { bpm, label: `${bpm} BPM` });
  }
});

test("a BPM hint settles octave ambiguity (174 BPM drum and bass)", () => {
  const track = clickTrack(174, 20);
  assertGrid(analyzeSamples(track.samples, RATE, { bpmHint: 174 }), track, { bpm: 174, label: "174 BPM with hint" });
  assertGrid(analyzeSamples(track.samples, RATE, { bpmHint: 170 }), track, { bpm: 174, label: "174 BPM with a near hint" });
});

test("humanised timing and acoustic, piano-like attacks still give a steady grid", () => {
  const humanised = clickTrack(104, 24, { jitter: 0.008, noise: 0.05 });
  assertGrid(analyzeSamples(humanised.samples, RATE), { times: humanised.times }, { bpm: 104, label: "humanised" });
  const acoustic = clickTrack(92, 24, { acoustic: true, noise: 0.01 });
  assertGrid(analyzeSamples(acoustic.samples, RATE), acoustic, { bpm: 92, label: "acoustic" });
});

test("confidence separates a pulse from noise", () => {
  const track = clickTrack(110, 16);
  assert.ok(analyzeSamples(track.samples, RATE).confidence > 0.9);
  let state = 3;
  const noise = Float32Array.from({ length: RATE * 16 }, () => ((state = (state * 16807) % 2147483647) / 2147483647 - 0.5) * 0.4);
  const result = analyzeSamples(noise, RATE);
  assert.ok(result.confidence < 0.3, `noise confidence ${result.confidence} (pulse strength ${result.pulse_strength})`);
});

test("analysis rejects audio that is too short", () => {
  assert.throws(() => analyzeSamples(new Float32Array(RATE), RATE), /at least 2 s/);
});

test("gridFromBpm, transformGrid and beatsDocument feed beat:n anchors", () => {
  const grid = gridFromBpm(120, 4);
  assert.deepEqual(grid.beats, [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
  assert.deepEqual(grid.downbeats, [0, 2]);
  // The track starts 0.25 s in and plays 2% faster.
  const moved = transformGrid({ bpm: 120, beats: [0, 0.5, 1, 1.5, 2.25], downbeats: [0, 2.25] }, { offset: 0.25, tempo: 1.02, duration: 1.2 });
  assert.equal(moved.bpm, 122.4);
  assert.deepEqual(moved.beats, [0.245, 0.735]);
  assert.deepEqual(moved.downbeats, []);
  const document = beatsDocument({ bpm: 120, beat_seconds: 0.5, beats: grid.beats, downbeats: grid.downbeats }, { source: "assets/audio/music.mp3" });
  assert.equal(document.schema_version, "launchclip.beats.v1");
  assert.equal(resolveAnchor("beat:3", { beats: document }), 1.5);
  assert.equal(resolveAnchor("downbeat:1+0.1", { beats: document }), 2.1);
});

async function ffmpegAvailable() {
  try { await execFileAsync("ffmpeg", ["-version"]); return true; } catch { return false; }
}

test("synth-audio-kit beds: the analysed grid matches the bed's own BEATS.json", { timeout: 600_000 }, async (t) => {
  if (!(await ffmpegAvailable())) { t.skip("FFmpeg is not installed"); return; }
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-beats-"));
  try {
    for (const [bpm, from, to, key] of [[84, 0, 14, "A"], [108, 4, 14, "D"], [116, 5, 12, "E"]]) {
      const out = path.join(dir, `bed-${bpm}`);
      await execFileAsync(process.execPath, [SYNTH, out, "--bed", "14", "--bpm", String(bpm), "--kick-from", String(from), "--kick-to", String(to), "--key", key]);
      const truth = JSON.parse(await readFile(path.join(out, "BEATS.json"), "utf8"));
      const result = await analyzeBeatsFile(path.join(out, "music", "bed.wav"));
      // Only the beats where the kick plays are audible beats.
      const times = truth.beats.filter((time) => time >= from && time <= to - 0.3);
      const downbeats = truth.downbeats.filter((time) => time >= from && time <= to - 0.3);
      assertGrid(result, { times, downbeats }, { bpm, label: `synth bed ${bpm} BPM (kick ${from}-${to}s)` });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
