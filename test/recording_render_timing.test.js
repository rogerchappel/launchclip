import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { editRecording } from "../src/recording_edit_media.js";
import { probeMedia } from "../src/media_trim.js";
const run = promisify(execFile);

test("many subframe cuts retain planned audio timestamps and one continuous original frame cadence", async (context) => {
  try { await run("ffmpeg", ["-version"]); await run("ffprobe", ["-version"]); }
  catch (error) { if (error.code !== "ENOENT") throw error; context.skip("Local FFmpeg and ffprobe required"); return; }
  const directory = await mkdtemp(path.join(os.tmpdir(), "launchclip-render-timing-"));
  try {
    const input = path.join(directory, "source.mp4");
    const output = path.join(directory, "edited.mp4");
    await run("ffmpeg", ["-hide_banner", "-nostdin", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=30:duration=8",
      "-f", "lavfi", "-i", "aevalsrc=if(between(t\\,6.69\\,6.73)\\,0.8*sin(2*PI*1000*t)\\,0):s=48000:d=8",
      "-c:v", "libx264", "-c:a", "aac", input]);
    let clock = 0;
    const kept_segments = Array.from({ length: 20 }, (_, index) => {
      const start = index * 0.35 + 0.017;
      const segment = { source_start_seconds: start, source_end_seconds: start + 0.217, start_seconds: clock, end_seconds: clock + 0.217 };
      clock = segment.end_seconds;
      return segment;
    });
    const plan = { schema_version: "launchclip.recording-edit.v1", source_duration_seconds: 8, duration_seconds: clock, kept_segments, removed_segments: [] };
    await editRecording(input, output, plan);
    const probe = await probeMedia(output);
    const audio = probe.streams.find((stream) => stream.codec_type === "audio");
    const video = probe.streams.find((stream) => stream.codec_type === "video");
    assert.ok(Math.abs(Number(audio.duration) - clock) < 0.005, "Audio must follow exact planned segment origins");
    assert.ok(Math.abs(Number(video.duration) - clock) <= 1 / 30 + 0.001, "Video rounding must occur once on the final frame grid");
    assert.equal(video.r_frame_rate, "30/1");
    assert.equal(video.width, 160);
    assert.equal(video.height, 90);
    const { stdout } = await run("ffmpeg", ["-hide_banner", "-nostdin", "-i", output, "-map", "0:a:0", "-ar", "48000", "-ac", "1", "-f", "f32le", "-"], { encoding: null, maxBuffer: 4 * 1024 * 1024 });
    let first = -1;
    let last = -1;
    for (let index = 0; index < stdout.length / 4; index++) if (Math.abs(stdout.readFloatLE(index * 4)) > 0.2) { if (first < 0) first = index; last = index; }
    const tail = kept_segments.at(-1);
    const expectedStart = tail.start_seconds + 6.69 - tail.source_start_seconds;
    const expectedEnd = tail.start_seconds + 6.73 - tail.source_start_seconds;
    assert.ok(first >= 0, "Expected late pulse must survive");
    assert.ok(Math.abs(first / 48000 - expectedStart) < 0.02, "Late audio must not drift with accumulated video rounding");
    assert.ok(Math.abs(last / 48000 - expectedEnd) < 0.02);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("varied short and long acoustic cuts retain planned duration with a shorter source audio tail", async (context) => {
  try { await run("ffmpeg", ["-version"]); await run("ffprobe", ["-version"]); }
  catch (error) { if (error.code !== "ENOENT") throw error; context.skip("Local FFmpeg and ffprobe required"); return; }
  const directory = await mkdtemp(path.join(os.tmpdir(), "launchclip-varied-timing-"));
  try {
    const input = path.join(directory, "source.mp4");
    const output = path.join(directory, "edited.mp4");
    await run("ffmpeg", ["-hide_banner", "-nostdin", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=60:duration=8",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=7.933", "-c:v", "libx264", "-c:a", "aac", input]);
    let clock = 0;
    let source = 0;
    const lengths = [0.08, 0.182937, 0.42875, 0.314063, 0.406687, 0.714687, 0.378563, 1.392624, 0.67625, 0.434563, 0.392688];
    const kept_segments = lengths.map((length) => {
      const segment = { source_start_seconds: source, source_end_seconds: source + length, start_seconds: clock, end_seconds: clock + length };
      source += length + 0.04;
      clock = segment.end_seconds;
      return segment;
    });
    kept_segments.push({ source_start_seconds: 7.85198, source_end_seconds: 8, start_seconds: clock, end_seconds: clock + 0.14802 });
    clock += 0.14802;
    const plan = { schema_version: "launchclip.recording-edit.v1", source_duration_seconds: 8, duration_seconds: clock, kept_segments, removed_segments: [] };
    await editRecording(input, output, plan);
    const probe = await probeMedia(output);
    const video = probe.streams.find((stream) => stream.codec_type === "video");
    const audio = probe.streams.find((stream) => stream.codec_type === "audio");
    assert.ok(Math.abs(Number(probe.format.duration) - clock) <= 1 / 60 + 0.001);
    assert.equal(video.r_frame_rate, "60/1");
    assert.ok(Math.abs(Number(video.start_time)) < 0.001);
    assert.ok(Math.abs(Number(audio.start_time)) < 0.001);
    assert.ok(clock - Number(audio.duration) < 0.08, "Only the source's missing audio tail may remain short");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
