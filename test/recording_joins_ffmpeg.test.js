import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { analyzeRecordingJoins } from "../src/recording_qa_repair.js";
const run = promisify(execFile);

test("local PCM join QA distinguishes an isolated seam impulse from natural sustained voicing", async (context) => {
  try { await run("ffmpeg", ["-version"]); }
  catch (error) { if (error.code !== "ENOENT") throw error; context.skip("Local FFmpeg required"); return; }
  const directory = await mkdtemp(path.join(os.tmpdir(), "launchclip-join-qa-"));
  try {
    const impulse = path.join(directory, "impulse.wav");
    const voiced = path.join(directory, "voiced.wav");
    await run("ffmpeg", ["-hide_banner", "-nostdin", "-f", "lavfi", "-i", "aevalsrc=if(between(t\\,0.79995\\,0.80005)\\,0.8\\,0):s=48000:d=1.6", "-c:a", "pcm_s16le", impulse]);
    await run("ffmpeg", ["-hide_banner", "-nostdin", "-f", "lavfi", "-i", "aevalsrc=0.4*sin(2*PI*220*t):s=48000:d=1.6", "-c:a", "pcm_s16le", voiced]);
    const plan = { source_duration_seconds: 2, duration_seconds: 1.6, kept_segments: [{ source_start_seconds: 0, source_end_seconds: 0.8, start_seconds: 0, end_seconds: 0.8 }, { source_start_seconds: 1.2, source_end_seconds: 2, start_seconds: 0.8, end_seconds: 1.6 }], words: [{ word: "Example", start: 0.2, end: 0.5 }, { word: "speech.", start: 1, end: 1.4 }], removed_segments: [] };
    const click = await analyzeRecordingJoins(impulse, plan);
    assert.equal(click.checked, true);
    assert.equal(click.issues.length, 1);
    assert.equal(click.issues[0].at_seconds, 0.8);
    assert.equal(click.issues[0].proven, false);
    const natural = await analyzeRecordingJoins(voiced, plan);
    assert.equal(natural.checked, true);
    assert.equal(natural.issues.length, 0);
    assert.ok(natural.measurements[0].surrounding_rms > 0.2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
