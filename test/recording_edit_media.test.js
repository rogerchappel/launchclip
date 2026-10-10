import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { planRecordingEdit } from "../src/recording_edit.js";
import { editRecording } from "../src/recording_edit_media.js";
import { probeMedia } from "../src/media_trim.js";
const run = promisify(execFile);
const plan = () => planRecordingEdit([{ word: "first", start: 0.5, end: 1 }, { word: "second", start: 2.5, end: 3 }], { durationSeconds: 4, silencePadding: 0.25 });

test("renderer rejects collisions and malformed plans without touching input", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "launchclip-edit-test-"));
  try {
    const input = path.join(directory, "source.mp4");
    const output = path.join(directory, "edited.mp4");
    await writeFile(input, "original");
    const probe = { format: { duration: "4" }, streams: [{ codec_type: "video" }, { codec_type: "audio" }] };
    const adapters = { probeMedia: async () => probe };
    await assert.rejects(editRecording(input, input, plan(), {}, adapters), /differ/);
    await writeFile(output, "existing");
    await assert.rejects(editRecording(input, output, plan(), {}, adapters), /already exists/);
    await assert.rejects(editRecording(input, path.join(directory, "bad.mp4"), { ...plan(), duration_seconds: 40 }, {}, adapters), /duration/);
    assert.equal(await readFile(input, "utf8"), "original");
    assert.equal(await readFile(output, "utf8"), "existing");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("renderer cleans unique scratch files after FFmpeg failure", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "launchclip-edit-test-"));
  try {
    const input = path.join(directory, "source.mp4");
    await writeFile(input, "original");
    await assert.rejects(editRecording(input, path.join(directory, "edited.mp4"), plan(), {}, {
      probeMedia: async () => ({ format: { duration: "4" }, streams: [{ codec_type: "video" }, { codec_type: "audio" }] }),
      run: async () => { throw new Error("render failure"); }
    }), /render failure/);
    assert.deepEqual(await readdir(directory), ["source.mp4"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("local FFmpeg concatenates synchronized video and audio at original dimensions and frame rate", async (context) => {
  try { await run("ffmpeg", ["-version"]); await run("ffprobe", ["-version"]); } catch (error) {
    if (error.code !== "ENOENT") throw error;
    context.skip("Local FFmpeg and ffprobe are required for the rendering smoke test");
    return;
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), "launchclip-edit-smoke-"));
  try {
    const input = path.join(directory, "source.mp4");
    const output = path.join(directory, "edited.mp4");
    await run("ffmpeg", ["-hide_banner", "-nostdin", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=4", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-c:v", "libx264", "-c:a", "aac", "-shortest", input]);
    const original = await readFile(input);
    const receipt = await editRecording(input, output, plan());
    const probe = await probeMedia(output);
    assert.equal(receipt.kept_segments, 2);
    assert.ok(Math.abs(receipt.rendered_duration_seconds - 2) < 0.08);
    const video = probe.streams.find((stream) => stream.codec_type === "video");
    const audio = probe.streams.find((stream) => stream.codec_type === "audio");
    assert.equal(video.width, 320);
    assert.equal(video.height, 180);
    assert.equal(video.r_frame_rate, "30/1");
    assert.ok(Math.abs(Number(video.duration) - Number(audio.duration)) < 0.08);
    assert.deepEqual(await readFile(input), original);
    assert.deepEqual((await readdir(directory)).sort(), ["edited.mp4", "source.mp4"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
