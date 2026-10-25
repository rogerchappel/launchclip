import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { ffmetadataChapters } from "../kit/core/long-form.mjs";
import { defaultAdapters } from "../src/finish.js";
import { mediaSkip } from "./helpers/media.js";

const run = promisify(execFile);
const hasFfmpeg = await run("ffmpeg", ["-version"]).then(() => true, () => false);

test("the chapters mux into the delivery MP4 (FFmpeg, stream copy)", { skip: mediaSkip(hasFfmpeg ? false : "ffmpeg not installed") }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-chapters-mux-"));
  try {
    const video = path.join(dir, "final.mp4");
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=30:d=30", "-f", "lavfi", "-i", "sine=f=440:d=30", "-shortest", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", video]);
    const chapters = [{ id: "a", title: "Intro", start: 0 }, { id: "b", title: "Tool; of = the week", start: 10 }, { id: "c", title: "Wrap", start: 20 }];
    const meta = path.join(dir, "chapters.ffmetadata");
    await writeFile(meta, ffmetadataChapters(chapters, { duration: 30, title: "Fixture" }));
    const out = path.join(dir, "final.chapters.mp4");
    await defaultAdapters().muxChapters(video, meta, out);
    const { stdout } = await run("ffprobe", ["-v", "error", "-show_chapters", "-show_streams", "-of", "json", out]);
    const probe = JSON.parse(stdout);
    assert.deepEqual(probe.chapters.map((chapter) => [Number(chapter.start_time), Number(chapter.end_time), chapter.tags.title]), [[0, 10, "Intro"], [10, 20, "Tool; of = the week"], [20, 30, "Wrap"]]);
    // The MP4 muxer adds a QuickTime chapter track (data) beside the picture and sound.
    assert.deepEqual(probe.streams.map((stream) => stream.codec_type).filter((type) => type !== "data").sort(), ["audio", "video"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
