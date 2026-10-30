// Every frame survives the partial-render pipeline: segments are verified (and
// re-rendered once) before they are cached, the join is timestamp-exact, the
// mux keeps every frame and the final MP4 must hold the story's frame count.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { narrationWords } from "@launchclip/core/captions.mjs";
import { concatArgs, concatList, defaultSegmentTools, ffmpegHasSettsPrescale, muxArgs, planSegments, remuxForJoinArgs, renderWithSegments } from "../src/render_segments.js";
import { resolveStory } from "../src/story.js";
import { mediaSkip } from "./helpers/media.js";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");
const MINIMAL = path.join(ROOT, "examples/story/minimal");

async function minimalStory() {
  const story = JSON.parse(await readFile(path.join(MINIMAL, "storyboard.json"), "utf8"));
  const words = narrationWords(JSON.parse(await readFile(path.join(MINIMAL, "NARRATION.json"), "utf8")));
  return resolveStory(story, { words });
}

// Fake media: a "video" is one line per frame, so counting frames is counting lines.
const frameLines = (start, end) => Array.from({ length: end - start }, (_, i) => `f${start + i}`).join("\n") + "\n";
const lines = async (file) => (await readFile(file, "utf8")).split("\n").filter(Boolean).length;

// A frame-range renderer whose first attempt at the listed segments goes wrong.
function flakyRemotion({ short = [], missing = [], always = false } = {}) {
  const calls = [];
  return {
    calls,
    adapter: {
      name: "remotion",
      segmentEncoder: () => ({ fake: true }),
      async renderSegments(project, segments) {
        const attempt = calls.length;
        calls.push(segments.map((segment) => segment.id));
        for (const segment of segments) {
          const broken = always || attempt === 0;
          if (broken && missing.includes(segment.id)) continue;
          // Drop the segment's last frame.
          const end = broken && short.includes(segment.id) ? segment.endFrame - 1 : segment.endFrame;
          await writeFile(segment.output, frameLines(segment.startFrame, end));
        }
        return { segments: segments.map(() => ({ seconds: 1 })) };
      },
      async encodeDelivery(input, output) { await writeFile(output, await readFile(input, "utf8")); }
    }
  };
}

function frameTools(overrides = {}) {
  return {
    async concat(files, output) { await writeFile(output, (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("")); },
    async encodeAudio({ output }) { await writeFile(output, "aac"); },
    async mux({ video, output }) { await writeFile(output, await readFile(video, "utf8")); },
    countFrames: lines,
    ...overrides
  };
}

async function withProject(fn) {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-frames-"));
  try {
    await cp(MINIMAL, project, { recursive: true });
    await fn(project);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
}

test("a segment rendered a frame short is re-rendered once, alone, before it is cached", async () => {
  await withProject(async (project) => {
    const story = await minimalStory();
    assert.deepEqual(planSegments(story).segments.map((segment) => segment.id), ["00-s1", "01-s1+s2", "02-s2", "03-s2+s1~loop"]);
    const fake = flakyRemotion({ short: ["02-s2"], missing: ["03-s2+s1~loop"] });
    const output = path.join(project, "out/raw.mp4");
    const result = await renderWithSegments({ project, story, renderer: "remotion", adapter: fake.adapter, output, tools: frameTools() });
    assert.deepEqual(fake.calls, [["00-s1", "01-s1+s2", "02-s2", "03-s2+s1~loop"], ["02-s2", "03-s2+s1~loop"]]);
    assert.deepEqual(result.plan.map((entry) => [entry.id, entry.retried ?? null]), [["00-s1", null], ["01-s1+s2", null], ["02-s2", "had 76 frames"], ["03-s2+s1~loop", "was not written"]]);
    assert.equal(await lines(output), 180);
    assert.equal(await readFile(output, "utf8"), frameLines(0, 180));
    // Every cached segment holds exactly its range; no temporary is left.
    const cache = path.join(project, result.cache);
    const names = await readdir(cache);
    assert.ok(!names.some((name) => name.includes(".partial.")));
    const counts = await Promise.all(names.filter((name) => name.endsWith(".mp4")).map((name) => lines(path.join(cache, name))));
    assert.deepEqual(counts.sort((a, b) => a - b), [1, 12, 77, 90]);
  });
});

test("a segment still short after its re-render fails the render loudly and is never cached", async () => {
  await withProject(async (project) => {
    const story = await minimalStory();
    const fake = flakyRemotion({ short: ["01-s1+s2"], always: true });
    const output = path.join(project, "out/raw.mp4");
    await assert.rejects(
      renderWithSegments({ project, story, renderer: "remotion", adapter: fake.adapter, output, tools: frameTools() }),
      /render stage failed: segment 01-s1\+s2 \(frames 90–102, 12 expected\) had 11 frames, then had 11 frames when re-rendered/
    );
    assert.equal(fake.calls.length, 2, "one retry, no more");
    assert.deepEqual(fake.calls[1], ["01-s1+s2"]);
    assert.ok(!existsSync(output));
    const cache = path.join(project, ".launchclip/finish/segments/remotion");
    const names = existsSync(cache) ? await readdir(cache) : [];
    assert.deepEqual(names.filter((name) => name.endsWith(".mp4")), [], "nothing is cached, not even the good segments' temporaries");
  });
});

test("a short segment already in the cache is re-rendered instead of joined", async () => {
  await withProject(async (project) => {
    const story = await minimalStory();
    const fake = flakyRemotion();
    const output = path.join(project, "out/raw.mp4");
    const first = await renderWithSegments({ project, story, renderer: "remotion", adapter: fake.adapter, output, tools: frameTools() });
    // Poison the cache the way a render that failed its final check used to.
    const hash = first.plan.find((entry) => entry.id === "02-s2").hash;
    const cache = path.join(project, first.cache);
    const poisoned = (await readdir(cache)).find((name) => name.startsWith(hash) && name.endsWith(".mp4"));
    await writeFile(path.join(cache, poisoned), frameLines(102, 178));
    const again = await renderWithSegments({ project, story, renderer: "remotion", adapter: fake.adapter, output, tools: frameTools() });
    assert.deepEqual(again.plan.map((entry) => entry.status), ["reused", "reused", "rendered", "reused"]);
    assert.equal(again.plan[2].repaired, "the cached segment had 76 frames");
    assert.deepEqual(fake.calls.at(-1), ["02-s2"]);
    assert.equal(await readFile(output, "utf8"), frameLines(0, 180));
  });
});

test("the final MP4 must hold exactly the story's frame count, else the render stage fails naming the stage", async () => {
  await withProject(async (project) => {
    const story = await minimalStory();
    const output = path.join(project, "out/raw.mp4");
    // A mux that loses the last frame.
    const dropLast = frameTools({ async mux({ video, output: out }) { await writeFile(out, (await readFile(video, "utf8")).split("\n").filter(Boolean).slice(0, -1).join("\n") + "\n"); } });
    await assert.rejects(
      renderWithSegments({ project, story, renderer: "remotion", adapter: flakyRemotion().adapter, output, tools: dropLast }),
      /render stage failed: the final MP4 has 179 frames; the story has 180 \(frames 0–180 at 30 fps\)/
    );
    assert.ok(!existsSync(output), "a video a frame short is not left behind");
    assert.ok(!existsSync(`${output}.video.mp4`) && !existsSync(`${output}.joined.mp4`));
    // A join that loses one is caught at the join.
    const badJoin = frameTools({ async concat(files, out) { await writeFile(out, frameLines(0, 179)); } });
    await assert.rejects(
      renderWithSegments({ project, story, renderer: "remotion", adapter: flakyRemotion().adapter, output, tools: badJoin }),
      /the joined segments has 179 frames; the story has 180/
    );
    // The mux is told the frame count and frame rate.
    const seen = [];
    await renderWithSegments({ project, story, renderer: "remotion", adapter: flakyRemotion().adapter, output, tools: frameTools({ async mux(args) { seen.push(args); await writeFile(args.output, await readFile(args.video, "utf8")); } }) });
    assert.deepEqual([seen[0].frames, seen[0].fps, seen[0].offset, seen[0].duration], [180, 30, 0, undefined]);
  });
});

test("muxArgs keeps every frame: a frame-count limit and a half-frame -t margin, never -shortest", () => {
  const full = muxArgs({ video: "v.mp4", audio: "a.m4a", output: "o.mp4", offset: 0, frames: 180, fps: 30 });
  assert.deepEqual(full, ["-i", "v.mp4", "-i", "a.m4a", "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-frames:v", "180", "-t", String(180.5 / 30), "-movflags", "+faststart", "o.mp4"]);
  // The output -t sits half a frame past the last frame's end (never at it).
  const t = Number(full[full.indexOf("-frames:v") + 3]);
  assert.ok(Math.abs(t - (6 + 0.5 / 30)) < 1e-9);
  assert.ok(!full.includes("-shortest"));
  // A preview: the audio window starts at the offset and lasts the preview's frames.
  const preview = muxArgs({ video: "v.mp4", audio: "a.m4a", output: "o.mp4", offset: 16.2, duration: 5.5, frames: 165, fps: 30 });
  assert.deepEqual(preview.slice(0, 5), ["-i", "v.mp4", "-ss", "16.2", "-i"]);
  assert.deepEqual(preview.slice(preview.indexOf("-frames:v"), preview.indexOf("-movflags")), ["-frames:v", "165", "-t", String(165.5 / 30)]);
  // A duration that rounds below frames / fps does not shorten the video.
  const rounded = muxArgs({ video: "v.mp4", audio: "a.m4a", output: "o.mp4", duration: 7.29, frames: 219, fps: 30 });
  assert.equal(rounded[rounded.indexOf("-frames:v") + 1], "219");
  assert.ok(Number(rounded[rounded.indexOf("-frames:v") + 3]) > 219 / 30);
  // Without a frame count: the window's duration, else -shortest (as before).
  assert.deepEqual(muxArgs({ video: "v", audio: "a", output: "o", duration: 5.5 }).slice(-6, -1), ["copy", "-t", "5.5", "-movflags", "+faststart"]);
  assert.ok(muxArgs({ video: "v", audio: "a", output: "o" }).includes("-shortest"));
});

test("concat: a duration line per segment and packets re-stamped from their index at 90 kHz", () => {
  const list = concatList(["/tmp/a.mp4", "/tmp/it's.mp4"], { fps: 30, frames: [90, 1] });
  assert.equal(list, "file '/tmp/a.mp4'\nduration 3.000000000\nfile '/tmp/it'\\''s.mp4'\nduration 0.033333333\n");
  assert.equal(concatList(["/tmp/a.mp4"]), "file '/tmp/a.mp4'\n");
  const args = concatArgs("list.txt", "out.mp4", { fps: 30 });
  assert.deepEqual(args.slice(args.indexOf("-c")), ["-c", "copy", "-bsf:v", "setts=time_base=1/90000:prescale=1:ts=N/(30*TB_OUT):duration=1/(30*TB_OUT)", "-video_track_timescale", "90000", "-an", "out.mp4"]);
  // FFmpeg before 7.1 (no prescale): segments are remuxed to 90 kHz first, and the stamps use the input timebase.
  const old = concatArgs("list.txt", "out.mp4", { fps: 30, prescale: false });
  assert.equal(old[old.indexOf("-bsf:v") + 1], "setts=ts=N/(30*TB):duration=1/(30*TB)");
  assert.deepEqual(remuxForJoinArgs("a.mp4", "b.mp4"), ["-i", "a.mp4", "-map", "0:v:0", "-c", "copy", "-video_track_timescale", "90000", "-an", "b.mp4"]);
});

async function ffmpegMissing() {
  try { await execFileAsync("ffmpeg", ["-version"]); await execFileAsync("ffprobe", ["-version"]); return null; }
  catch (error) { return error.message; }
}

const ffmpeg = (args) => execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
async function packets(file, stream = "v:0") {
  const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-select_streams", stream, "-show_entries", "packet=pts,dts,duration", "-of", "csv=p=0", file]);
  return String(stdout).trim().split("\n").filter(Boolean).map((line) => line.split(",").map(Number));
}
async function probeDuration(file, stream) {
  const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-select_streams", stream, "-show_entries", "stream=duration", "-of", "csv=p=0", file]);
  return Number(String(stdout).trim());
}

test("FFmpeg: the mux keeps the last frame (B-frames, fractional rate) and the audio ends with the video", { skip: mediaSkip() }, async (t) => {
  const missing = await ffmpegMissing();
  if (missing) { t.skip(`FFmpeg is unavailable: ${missing}`); return; }
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-mux-"));
  try {
    const tools = defaultSegmentTools();
    for (const [rate, fps, frames] of [["30", 30, 180], ["30000/1001", 30000 / 1001, 7]]) {
      const video = path.join(dir, `v-${frames}.mp4`), audio = path.join(dir, "a.m4a"), output = path.join(dir, `o-${frames}.mp4`);
      // A delivery-style encode: x264 with B-frames, so pts run ahead of dts.
      await ffmpeg(["-f", "lavfi", "-i", `testsrc2=size=160x120:rate=${rate}`, "-frames:v", String(frames), "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-video_track_timescale", "90000", video]);
      await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "8", "-c:a", "aac", audio]);
      await tools.mux({ video, audio, output, offset: 0, frames, fps });
      assert.equal((await packets(output)).length, frames, `${rate}: every frame is muxed`);
      // The audio is cut at the -t margin, to AAC packet granularity (1024 samples).
      const audioEnd = await probeDuration(output, "a:0");
      assert.ok(audioEnd >= frames / fps - 1024 / 48000 && audioEnd <= (frames + 0.5) / fps + 1024 / 48000, `${rate}: the audio is cut to the video (${audioEnd})`);
    }
    // A preview window from an offset.
    const output = path.join(dir, "preview.mp4");
    await tools.mux({ video: path.join(dir, "v-180.mp4"), audio: path.join(dir, "a.m4a"), output, offset: 1.5, duration: 6, frames: 180, fps: 30 });
    assert.equal((await packets(output)).length, 180);
    // A soundtrack that ends before the last frame (where -shortest would stop)
    // still gets every frame.
    const short = path.join(dir, "short.m4a"), under = path.join(dir, "under.mp4");
    await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "5.9", "-c:a", "aac", short]);
    await tools.mux({ video: path.join(dir, "v-180.mp4"), audio: short, output: under, offset: 0, frames: 180, fps: 30 });
    assert.equal((await packets(under)).length, 180);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("FFmpeg: the join stamps every frame on its slot, whatever the segments' container durations say", { skip: mediaSkip() }, async (t) => {
  const missing = await ffmpegMissing();
  if (missing) { t.skip(`FFmpeg is unavailable: ${missing}`); return; }
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-join-"));
  try {
    // One-frame segments at a millisecond timescale: each claims 33 ms, so the
    // concat demuxer alone would drift a third of a millisecond per join.
    const files = [];
    for (let i = 0; i < 24; i += 1) {
      const file = path.join(dir, `s${i}.mp4`);
      await ffmpeg(["-f", "lavfi", "-i", `testsrc2=size=160x120:rate=30,trim=start_frame=${i}:end_frame=${i + 1}`, "-c:v", "libx264", "-qp", "0", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-video_track_timescale", "1000", file]);
      files.push(file);
    }
    // Both join paths: with setts prescale (FFmpeg 7.1+) and without (older FFmpeg, as on Ubuntu).
    // The prescale path needs FFmpeg 7.1+; older FFmpeg (Ubuntu's) checks the fallback only.
    for (const prescale of (await ffmpegHasSettsPrescale()) ? [true, false] : [false]) {
      const joined = path.join(dir, `joined-${prescale}.mp4`);
      await defaultSegmentTools().concat(files, joined, { fps: 30, frames: files.map(() => 1), prescale });
      const stamps = await packets(joined);
      assert.equal(stamps.length, 24, `prescale ${prescale}`);
      stamps.forEach(([pts, dts, duration], index) => assert.deepEqual([pts, dts, duration], [index * 3000, index * 3000, 3000], `prescale ${prescale}, frame ${index}`));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a segment render reports its progress in frames, from none to all", async () => {
  await withProject(async (project) => {
    const story = await minimalStory();
    const events = [];
    const adapter = {
      name: "remotion",
      segmentEncoder: () => ({ fake: true }),
      async renderSegments(_project, segments, opts) {
        for (const segment of segments) {
          await writeFile(segment.output, frameLines(segment.startFrame, segment.endFrame));
          opts.onSegment?.(segment, 1);
        }
        return { segments: segments.map(() => ({ seconds: 1 })) };
      },
      async encodeDelivery(input, output) { await writeFile(output, await readFile(input, "utf8")); }
    };
    await renderWithSegments({ project, story, renderer: "remotion", adapter, output: path.join(project, "renders/draft.mp4"), tools: frameTools(), progress: (event) => events.push(event) });
    const total = planSegments(story).segments.reduce((sum, segment) => sum + segment.frames, 0);
    assert.deepEqual(events[0], { step: "render", done: 0, total, unit: "frames" });
    assert.deepEqual(events.at(-1), { step: "render", done: total, total, unit: "frames" });
    assert.equal(events.length, planSegments(story).segments.length + 1);
  });
});
