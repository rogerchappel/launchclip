import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { directionJson } from "../kit/core/direction.mjs";
import { ffmetadataChapters, structureLongForm } from "../kit/core/long-form.mjs";
import { PATHS, defaultAdapters, runFinish } from "../src/finish.js";
import { longFormFixture } from "./helpers/long_form.js";
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

// The ~10-minute fixture as a project: storyboard (structured: chapters,
// cards, resets), DIRECTION.json, NARRATION.json and a tiny stand-in base.
export async function longFormProject(dir) {
  const { story, map, words } = longFormFixture();
  const structured = structureLongForm(story, { words, map });
  await mkdir(path.join(dir, "assets"), { recursive: true });
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x334455:s=64x36:r=2:d=600", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", "600", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", path.join(dir, "assets/recording.mp4")]);
  await writeFile(path.join(dir, "storyboard.json"), `${JSON.stringify(structured.story, null, 2)}\n`);
  await writeFile(path.join(dir, "DIRECTION.json"), directionJson(structured.map));
  await writeFile(path.join(dir, "NARRATION.json"), JSON.stringify({ words }));
  return structured;
}

// Real FFmpeg segment tools, chapters mux and chapter cut; a stand-in renderer
// that encodes each segment's exact frame range (a flat colour per segment) so
// the test exercises the cache, the join and the stitch without Chromium.
function chapterAdapters() {
  const base = defaultAdapters();
  const calls = [];
  const touch = async (file, content = "{}") => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, content); };
  return {
    ...base,
    calls,
    env: {},
    notice() {},
    renderer: (name) => ({
      name,
      segmentEncoder: () => ({ standIn: "lavfi-color" }),
      async renderSegments(project, segments) {
        calls.push(segments.map((segment) => [segment.startFrame, segment.endFrame]));
        for (const segment of segments) {
          const colour = (segment.startFrame * 2654435761 % 0xffffff).toString(16).padStart(6, "0");
          await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=c=0x${colour}:s=160x90:r=30`, "-frames:v", String(segment.endFrame - segment.startFrame), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-g", "30", segment.output]);
        }
        return { segments: segments.map(() => ({ seconds: 0.1 })) };
      },
      // The base's own sound under the whole timeline (Remotion mixes it; here, the base's audio as AAC).
      async renderAudio(project, output) {
        await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", path.join(project, "assets/recording.mp4"), "-vn", "-ar", "48000", "-ac", "2", "-c:a", "aac", "-f", "adts", output]);
      },
      async render() { throw new Error("the chapter test renders segments only"); }
    }),
    async synthKit(outDir) { await touch(path.join(outDir, "AUDIO-KIT.json")); return {}; },
    async buildMix(options) {
      await mkdir(path.dirname(options.out), { recursive: true });
      await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", String(options.duration), "-c:a", "pcm_s16le", options.out]);
      return { cues: [] };
    },
    async master(input, output) {
      await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-c", "copy", output]);
      return { compliant: true, output: { integrated_lufs: -14, true_peak_dbtp: -1 } };
    },
    async buildEvidence(project) { await touch(path.join(project, PATHS.evidence), JSON.stringify({ schema_version: "launchclip.subscription-temporal-evidence.v1", entries: [] })); return { samples: 0, artifacts: 0, sheets: [] }; },
    async motion(video, out) { await touch(out); return { quality: { ok: true, findings: [] } }; },
    async audio() { return { quality: { ok: true, findings: [] } }; }
  };
}

const probe = async (file, args) => JSON.parse((await run("ffprobe", ["-v", "error", ...args, "-of", "json", file])).stdout);
const frameCount = async (file) => Number((await probe(file, ["-select_streams", "v:0", "-count_packets", "-show_entries", "stream=nb_read_packets"])).streams[0].nb_read_packets);

test("a 10-minute fixture renders by chapter: one chapter re-renders, the master is stitched with its chapters", { skip: mediaSkip(hasFfmpeg ? false : "ffmpeg not installed"), timeout: 900_000 }, async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-long-form-render-"));
  try {
    const structured = await longFormProject(project);
    const adapters = chapterAdapters();
    const first = await runFinish(project, { renderer: "remotion" }, adapters);
    assert.ok(["ready-for-review", "needs-repair"].includes(first.status), JSON.stringify(first.stages.filter((stage) => stage.error)));
    const whole = first.stages.find((stage) => stage.name === "render").details.segments;
    assert.equal(whole.rendered, whole.segments);
    assert.equal(await frameCount(first.final), 18000);
    const chapters = (await probe(first.final, ["-show_chapters"])).chapters;
    assert.deepEqual(chapters.map((chapter) => chapter.tags.title), structured.chapters.map((chapter) => chapter.title));
    assert.equal((await readFile(path.join(project, PATHS.chapters), "utf8")).split("\n")[1], "1:40 Tool of the week");
    assert.equal(first.gates.coverage.status, "passed", JSON.stringify(first.gates.coverage.errors));

    const c3 = structured.chapters.find((chapter) => chapter.id === "c3");
    const report = await runFinish(project, { renderer: "remotion", chapter: "c3" }, adapters);
    const segments = report.stages.find((stage) => stage.name === "render").details.segments;
    const inside = segments.plan.filter((entry) => entry.frames[0] < Math.round(c3.end * 30) && entry.frames[1] > Math.round(c3.start * 30));
    assert.equal(segments.forced, inside.length);
    assert.equal(segments.reused, segments.segments - inside.length);
    assert.ok(segments.reused > segments.forced, "most of the video comes from the cache");
    assert.deepEqual(adapters.calls.at(-1), inside.map((entry) => entry.frames));
    assert.equal(await frameCount(report.final), 18000, "the stitched master keeps every frame");
    assert.equal((await probe(report.final, ["-show_chapters"])).chapters.length, structured.chapters.length);
    const alone = await probe(path.join(project, report.chapter.output), ["-show_entries", "format=duration"]);
    assert.ok(Math.abs(Number(alone.format.duration) - (c3.end - c3.start)) < 0.1, `chapter file lasts ${alone.format.duration} s`);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
