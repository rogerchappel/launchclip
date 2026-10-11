import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { analyzeRecordingAudio, refineRecordingEditPlan } from "../src/recording_audio.js";
import { planRecordingEdit } from "../src/recording_edit.js";

const run = promisify(execFile);

test("local FFmpeg measures a quiet gap between speech-like tones and shortens the mapped edit", async (context) => {
  try { await run("ffmpeg", ["-version"]); }
  catch (error) { if (error.code === "ENOENT") { context.skip("FFmpeg unavailable"); return; } throw error; }
  const directory = await mkdtemp(path.join(os.tmpdir(), "launchclip-audio-signal-"));
  try {
    const input = path.join(directory, "tone-gap-tone.wav");
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.8", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono:d=0.5", "-f", "lavfi", "-i", "sine=frequency=660:duration=0.8", "-filter_complex", "[0:a][1:a][2:a]concat=n=3:v=0:a=1", "-c:a", "pcm_s16le", input]);
    const analysis = await analyzeRecordingAudio(input, { durationSeconds: 2.1 });
    assert.equal(analysis.silence_intervals.length, 1);
    assert.ok(Math.abs(analysis.silence_intervals[0].start_seconds - 0.8) < 0.01);
    assert.ok(Math.abs(analysis.silence_intervals[0].end_seconds - 1.3) < 0.01);
    assert.equal(analysis.waveform.length, 21);
    assert.ok(analysis.waveform[3].rms > 0.05);
    assert.equal(analysis.waveform[10].rms, 0);
    assert.ok(analysis.threshold_db >= -60 && analysis.threshold_db <= -30);
    const base = planRecordingEdit([{ word: "First.", start: 0.05, end: 0.7 }, { word: "Second.", start: 1.4, end: 2.05 }], { durationSeconds: 2.1, silenceDuration: 0.8, silencePadding: 0.15, takePolicy: "none" });
    const refined = refineRecordingEditPlan(base, analysis);
    assert.ok(Math.abs(base.duration_seconds - 2.1) < 0.001);
    assert.ok(Math.abs(refined.duration_seconds - 1.76) < 0.01);
    assert.ok(Math.abs(refined.words[1].start - 1.06) < 0.01);
    assert.ok(refined.removed_segments.some((segment) => segment.reason === "waveform-silence"));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
