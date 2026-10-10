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
