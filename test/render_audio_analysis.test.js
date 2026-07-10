import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzeProductionAudio, evaluateAudioQuality, parsePeakSeries } from "../src/render_audio_analysis.js";

test("parses time-aligned peak evidence", () => {
  const peaks = parsePeakSeries("frame:0 pts:0 pts_time:0.25\nlavfi.astats.Overall.Peak_level=-12.5\nframe:1 pts:1 pts_time:0.5\nlavfi.astats.Overall.Peak_level=-inf");
  assert.deepEqual(peaks, [{ at_seconds: .25, peak_dbfs: -12.5 }, { at_seconds: .5, peak_dbfs: -Infinity }]);
});

test("analyzes mixed and source audio with loudness, clipping, masking, and cue sync gates", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "launchclip-audio-qa-"));
  const manifestPath = path.join(directory, "manifest.json");
  const sfxPath = path.join(directory, "sfx.json");
  await writeFile(sfxPath, `${JSON.stringify({ cues: [{ id: "tick", shot_id: "shot-1", at_seconds: .5, intent: "proof" }] })}\n`);
  await writeFile(manifestPath, `${JSON.stringify({ voiceover: { path: "/tmp/voice.mp3" }, music: { path: "/tmp/music.mp3" }, sfx_manifest: sfxPath })}\n`);
  const outputs = [
    { stdout: JSON.stringify({ format: { duration: "1" }, streams: [{ codec_type: "audio", codec_name: "aac", channels: 2, sample_rate: "48000" }] }) },
    ...audioOutputs(-12, 0, [-20, -8, -20]),
    ...audioOutputs(-16, -3, [-18, -16]),
    ...audioOutputs(-10, -1, [-12, -10])
  ];
  const report = await analyzeProductionAudio("/tmp/final.mp4", manifestPath, { musicVolume: 1 }, { run: async () => outputs.shift() });
  assert.equal(report.stream.codec_name, "aac");
  assert.equal(report.output.true_peak_dbfs, 0);
  assert.equal(report.cues[0].transient_delta_db, 12);
  assert.equal(report.quality.ok, false);
  assert.deepEqual(new Set(report.quality.findings.map((entry) => entry.category)), new Set(["clipping", "masking"]));
});

test("blocks a missing audio stream when the manifest expects audio", () => {
  const quality = evaluateAudioQuality({ expected_audio: true, stream: null, output: null, sources: { voiceover: null, music: null }, cues: [] });
  assert.equal(quality.ok, false);
  assert.equal(quality.findings[0].severity, "blocking");
});

test("does not require an audio stream for an empty SFX manifest", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "launchclip-silent-qa-"));
  const sfxPath = path.join(directory, "sfx.json");
  const manifestPath = path.join(directory, "manifest.json");
  await writeFile(sfxPath, `${JSON.stringify({ cues: [] })}\n`);
  await writeFile(manifestPath, `${JSON.stringify({ voiceover: null, music: null, sfx_manifest: sfxPath })}\n`);
  const report = await analyzeProductionAudio("/tmp/silent.mp4", manifestPath, {}, {
    run: async () => ({ stdout: JSON.stringify({ format: { duration: "1" }, streams: [{ codec_type: "video" }] }) })
  });
  assert.equal(report.expected_audio, false);
  assert.equal(report.quality.ok, true);
});

function audioOutputs(lufs, peak, peaks) {
  return [
    { stdout: "", stderr: `Summary:\n  I: ${lufs} LUFS\n  Peak: ${peak} dBFS` },
    { stdout: peaks.map((value, index) => `frame:${index} pts:${index} pts_time:${index * .5}\nlavfi.astats.Overall.Peak_level=${value}`).join("\n"), stderr: "" }
  ];
}
