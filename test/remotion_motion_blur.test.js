// story.motion.blur through the Remotion path: the composition runs on
// sub-frames, segments cache them unblended, and the blend after the join is
// src/motion_blur.js, as in HyperFrames.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { narrationWords } from "@launchclip/core/captions.mjs";
import { resolveMotionBlur } from "@launchclip/core/motion-blur.mjs";
import { compileStoryToHyperFrames } from "../kit/hyperframes/story-compiler.mjs";
import { motionBlurArgs, motionBlurOptions } from "../src/motion_blur.js";
import { LOOK, laplacianVariance, lookFrameArgs, lookGrid } from "../src/render_look_analysis.js";
import { defaultSegmentTools, planSegments, renderWithSegments, storyMotionBlurGuard } from "../src/render_segments.js";
import { getRenderer } from "../src/renderers/index.js";
import { createRemotionRenderer, withSubframes } from "../src/renderers/remotion.js";
import { resolveStory } from "../src/story.js";
import { mediaSkip } from "./helpers/media.js";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");
const MINIMAL = path.join(ROOT, "examples/story/minimal");
const HEAVY = { samples: 6, shutter: 1.5 };

async function minimalStory(blur = HEAVY) {
  const story = JSON.parse(await readFile(path.join(MINIMAL, "storyboard.json"), "utf8"));
  const words = narrationWords(JSON.parse(await readFile(path.join(MINIMAL, "NARRATION.json"), "utf8")));
  return resolveStory({ ...story, motion: { ...story.motion, ...(blur ? { blur } : {}) } }, { words });
}

async function withProject(fn) {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-remotion-blur-"));
  try {
    await cp(MINIMAL, project, { recursive: true });
    await fn(project);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
}

// Fake media: a "video" is one line per frame.
const frameLines = (start, end) => Array.from({ length: end - start }, (_, i) => `f${start + i}`).join("\n") + "\n";
const lineCount = async (file) => (await readFile(file, "utf8")).split("\n").filter(Boolean).length;

function fakeAdapter({ subframes = true, shortOnce = null } = {}) {
  const calls = [];
  return {
    calls,
    adapter: {
      name: "remotion",
      ...(subframes ? { subframes: true } : {}),
      segmentEncoder: () => ({ fake: true }),
      async renderSegments(project, segments, opts) {
        const attempt = calls.length;
        calls.push({ ranges: segments.map((segment) => [segment.startFrame, segment.endFrame]), subframes: opts.subframes });
        for (const segment of segments) {
          const short = attempt === 0 && segment.id === shortOnce;
          await writeFile(segment.output, frameLines(segment.startFrame, segment.endFrame - (short ? 1 : 0)));
        }
        return { segments: segments.map(() => ({ seconds: 1 })) };
      },
      async encodeDelivery(input, output) { await writeFile(output, await readFile(input, "utf8")); }
    }
  };
}

function fakeTools(log = {}, overrides = {}) {
  return {
    async concat(files, output, options) { log.concat = options; await writeFile(output, (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("")); },
    async blend(input, output, options) {
      log.blend = options;
      const all = (await readFile(input, "utf8")).split("\n").filter(Boolean);
      await writeFile(output, all.filter((_, n) => n % options.rate === 0).join("\n") + "\n");
    },
    async encodeAudio({ output }) { await writeFile(output, "aac"); },
    async mux({ video, output }) { await writeFile(output, await readFile(video, "utf8")); },
    countFrames: lineCount,
    ...overrides
  };
}

test("withSubframes keeps the story's fps: only the composition runs faster", () => {
  const props = { format: { fps: 30 }, resolved: { fps: 30, frames: 221, duration: 7.35 } };
  assert.deepEqual(withSubframes(props, 4), { ...props, __subframes: 4 });
  assert.throws(() => withSubframes(props, 0), /sub-frame rate/);
  assert.throws(() => withSubframes(props, 1.5), /sub-frame rate/);
});

test("StoryComposition: sub-frames sample absolute time; what steps per story frame still does", async () => {
  const source = await readFile(path.join(ROOT, "kit/remotion/StoryComposition.tsx"), "utf8");
  // calculateMetadata multiplies the story's own frame count, not a re-rounded duration × fps.
  assert.match(source, /Number\(props\.resolved\?\.frames \?\? Math\.round\(duration \* fps\)\)\) \* rate/);
  assert.match(source, /fps: fps \* rate, durationInFrames/);
  assert.match(source, /blurSnappedChunks\(/);
  // Layers mount on whole story frames, the segment plan's frame space.
  assert.match(source, /const frames = \(seconds: number\) => Math\.round\(seconds \* storyFps\) \* rate;/);
  // The feel holds each story frame's sample (the tl.set of HyperFrames), the medium boils per story frame.
  assert.match(source, /feelStateAt\(plan, Math\.floor\(\(frame \* plan\.fps\) \/ fps \+ 1e-6\) \/ plan\.fps\)/);
  assert.match(source, /mediumLayerStyle\(plan, \(frame \* plan\.fps\) \/ fps\)/);
});

test("the Remotion adapter's render takes motionBlur: rate × fps, then the shared blend with the guard", async () => {
  await withProject(async (project) => {
    const story = await minimalStory();
    const calls = [], blends = [];
    const run = async (command, args) => { calls.push(args); return { ok: true, exit_code: 0, stdout: "", stderr: "" }; };
    const adapter = createRemotionRenderer({ run, browserExecutable: null });
    const guard = { frames: [3], rect: { x: 0, y: 10, width: 100, height: 20 } };
    const out = path.join(project, "renders/final.mp4");
    const result = await adapter.render(project, out, { story, motionBlur: { ...motionBlurOptions(story), guard }, blend: async (input, output, options) => blends.push({ input, output, options }) });
    const args = calls[0];
    assert.equal(args[args.indexOf("render") + 3], `${out}.subframes.mp4`);
    const props = JSON.parse(await readFile(args[args.indexOf("--props") + 1], "utf8"));
    assert.equal(props.__subframes, 4);
    assert.deepEqual([props.format.fps, props.resolved.fps, props.resolved.frames], [30, 30, story.resolved.frames]);
    // The project's own resolved story, which stills and the studio read, stays at the story's rate.
    assert.notEqual(args[args.indexOf("--props") + 1], path.join(project, ".launchclip/story.resolved.json"));
    assert.deepEqual(blends, [{ input: `${out}.subframes.mp4`, output: out, options: { samples: 6, fps: 30, rate: 4, guard } }]);
    assert.deepEqual(result.motionBlur, { samples: 6, rate: 4 });

    calls.length = 0;
    await adapter.render(project, out, { story });
    assert.equal(calls[0][calls[0].indexOf("render") + 3], out);
    assert.equal(JSON.parse(await readFile(calls[0][calls[0].indexOf("--props") + 1], "utf8")).__subframes, undefined);
  });
});

test("segments hold sub-frames; the blend follows the join, then the delivery encode", async () => {
  await withProject(async (project) => {
    const story = await minimalStory();
    const plan = planSegments(story);
    const fake = fakeAdapter();
    const log = {};
    const output = path.join(project, "out/raw.mp4");
    const result = await renderWithSegments({ project, story, renderer: "remotion", adapter: fake.adapter, output, tools: fakeTools(log) });
    assert.deepEqual(fake.calls[0].ranges, plan.segments.map((segment) => [segment.startFrame * 4, segment.endFrame * 4]));
    assert.equal(fake.calls[0].subframes, 4);
    assert.equal(log.concat.fps, 120);
    assert.deepEqual(log.concat.frames, plan.segments.map((segment) => segment.frames * 4));
    assert.deepEqual([log.blend.samples, log.blend.rate, log.blend.fps], [6, 4, 30]);
    assert.equal(await lineCount(output), plan.frames);
    assert.deepEqual([result.motion_blur.samples, result.motion_blur.rate, result.motion_blur.shutter], [6, 4, 1.5]);
    assert.deepEqual(result.frames, { start: 0, end: plan.frames, count: plan.frames });

    // A second render reuses the sub-frame segments and only blends again.
    delete log.blend;
    const again = await renderWithSegments({ project, story, renderer: "remotion", adapter: fake.adapter, output, tools: fakeTools(log) });
    assert.equal(fake.calls.length, 1);
    assert.equal(again.reused, plan.segments.length);
    assert.equal(log.blend.rate, 4);

    // Another shutter, or no blur, never reuses them.
    const light = await renderWithSegments({ project, story: await minimalStory(true), renderer: "remotion", adapter: fake.adapter, output, tools: fakeTools(log) });
    assert.equal(light.reused, 0);
    assert.equal(fake.calls.at(-1).subframes, resolveMotionBlur({ motion: { blur: true } }).rate);
    const off = await renderWithSegments({ project, story: await minimalStory(null), renderer: "remotion", adapter: fake.adapter, output, tools: fakeTools(log) });
    assert.equal(off.reused, 0);
    assert.equal(off.motion_blur, undefined);
    assert.equal(fake.calls.at(-1).subframes, undefined);
    assert.deepEqual(fake.calls.at(-1).ranges, plan.segments.map((segment) => [segment.startFrame, segment.endFrame]));
  });
});

test("a segment short by a sub-frame is re-rendered, and a blend that loses a frame fails the render", async () => {
  await withProject(async (project) => {
    const story = await minimalStory();
    const [first] = planSegments(story).segments;
    const fake = fakeAdapter({ shortOnce: first.id });
    const output = path.join(project, "out/raw.mp4");
    const result = await renderWithSegments({ project, story, renderer: "remotion", adapter: fake.adapter, output, tools: fakeTools() });
    assert.equal(result.plan[0].retried, `had ${first.frames * 4 - 1} frames`);
    await assert.rejects(
      renderWithSegments({ project, story, renderer: "remotion", adapter: fake.adapter, output, tools: fakeTools({}, { async blend(input, out) { await writeFile(out, "f0\n"); } }) }),
      /the motion-blur blend has 1 frames; the story has \d+/
    );
  });
});

test("an adapter that cannot render sub-frames keeps story-frame ranges", async () => {
  await withProject(async (project) => {
    const story = await minimalStory();
    const fake = fakeAdapter({ subframes: false });
    const log = {};
    const result = await renderWithSegments({ project, story, renderer: "remotion", adapter: fake.adapter, output: path.join(project, "out/raw.mp4"), tools: fakeTools(log) });
    assert.equal(log.blend, undefined);
    assert.equal(result.motion_blur, undefined);
    assert.equal(fake.calls[0].subframes, undefined);
  });
});

test("the guard is the HyperFrames compiler's, and a preview rebases it to its own frames", async () => {
  await withProject(async (project) => {
    const story = await minimalStory();
    const guard = await storyMotionBlurGuard(project, story);
    assert.ok(guard?.frames.length > 0, "the minimal story's narration changes words under a heavy shutter");
    const compiled = path.join(project, "compiled");
    await mkdir(compiled, { recursive: true });
    await compileStoryToHyperFrames(story, { projectDir: compiled, sourceDir: project });
    const sidecar = JSON.parse(await readFile(path.join(compiled, "launchclip-motion-blur.json"), "utf8"));
    assert.deepEqual(guard, sidecar.guard);

    const scene = story.scenes[1].id;
    const log = {};
    const output = path.join(project, "out/preview.mp4");
    const result = await renderWithSegments({ project, story, renderer: "remotion", adapter: fakeAdapter().adapter, output, previewScene: scene, tools: fakeTools(log) });
    const { start, end, count } = result.frames;
    assert.ok(start > 0);
    assert.deepEqual(log.blend.guard.frames, guard.frames.filter((frame) => frame >= start && frame < end).map((frame) => frame - start));
    assert.equal(await lineCount(output), count);
    assert.match(result.motion_blur.note, /first frame's window/);

    // A one-frame shutter has no guard: the snap alone keeps one word.
    assert.equal(await storyMotionBlurGuard(project, await minimalStory(true)), null);
  });
});

test("motionBlurArgs: HyperFrames keeps its final encode; a mezzanine blend overrides only the encoder", () => {
  const final = motionBlurArgs("in.mp4", "out.mp4", { samples: 6, rate: 4, fps: 30 });
  assert.deepEqual(final.slice(final.indexOf("-r")), ["-r", "30", "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", "out.mp4"]);
  const mezzanine = motionBlurArgs("in.mp4", "out.mp4", { samples: 6, rate: 4, fps: 30, encode: ["-c:v", "libx264", "-qp", "0"] });
  assert.deepEqual(mezzanine.slice(mezzanine.indexOf("-r"), mezzanine.indexOf("-pix_fmt")), ["-r", "30", "-c:v", "libx264", "-qp", "0"]);
  assert.deepEqual(mezzanine.slice(0, mezzanine.indexOf("-r")), final.slice(0, final.indexOf("-r")));
});

// ---------------------------------------------------------------------------
// Real FFmpeg and a real render.

// 24 fps × 4 = 96 fps is not a whole number of 90 kHz ticks: the join's stamps
// round, and the blend must still keep exactly one picture per story frame.
test("FFmpeg: sub-frames at a rate the join's timescale cannot hold exactly still blend to the story's frames", { skip: mediaSkip() }, async () => {
  const work = await mkdtemp(path.join(os.tmpdir(), "launchclip-remotion-blur-ffmpeg-"));
  try {
    const tools = defaultSegmentTools();
    const parts = [];
    for (const [index, frames] of [40, 56, 24].entries()) {
      const file = path.join(work, `part-${index}.mp4`);
      await execFileAsync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=64x64:r=96", "-frames:v", String(frames), "-c:v", "libx264", "-qp", "0", "-preset", "ultrafast", "-pix_fmt", "yuv420p", file]);
      parts.push(file);
    }
    const joined = path.join(work, "joined.mp4"), blended = path.join(work, "blended.mp4");
    await tools.concat(parts, joined, { fps: 96, frames: [40, 56, 24] });
    assert.equal(await tools.countFrames(joined), 120);
    await tools.blend(joined, blended, { samples: 6, rate: 4, fps: 24, guard: { frames: [3, 4, 20], rect: { x: 0, y: 16, width: 64, height: 32 } } });
    assert.equal(await tools.countFrames(blended), 30);
    const [video] = await probe(blended);
    assert.equal(video.r_frame_rate, "24/1");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

async function toolsMissing() {
  if (process.env.LAUNCHCLIP_SKIP_REMOTION === "1") return "LAUNCHCLIP_SKIP_REMOTION=1";
  try {
    await execFileAsync("ffmpeg", ["-version"]);
    await execFileAsync("ffprobe", ["-version"]);
    const { ensureBrowser } = await import("@remotion/renderer");
    await ensureBrowser();
    return null;
  } catch (error) {
    return error.message;
  }
}

function pushStory(blur, headline = "SHIPPED") {
  const panel = (text) => [
    { kind: "headline", rect: { x: 60, y: 300, width: 960, height: 130 }, at: 0, enter: "cut", props: { text, size: 120 } },
    { kind: "terminal", rect: { x: 60, y: 660, width: 960, height: 600 }, at: 0, enter: "cut", props: { title: "launchclip", sub: "make", prompt: "make a launch video" } }
  ];
  return {
    schema: "launchclip.story.v1",
    title: "Motion blur media test",
    lane: "motion",
    format: { width: 1080, height: 1920, fps: 30, duration: 2.4, platform: "youtube-shorts" },
    brand: { colors: { bg: "#0a0b08", primary: "#c8ff3a", accent: "#c8ff3a", ink: "#0a0b08", paper: "#f4f6ee" }, fonts: { display: "inter", body: "inter", meta: "jetbrains-mono" } },
    ...(blur ? { motion: { blur } } : {}),
    audio: { mix: "assets/tone.m4a", words: "NARRATION.json" },
    overlays: [{ type: "captions", style: "word-highlight" }],
    scenes: [
      { id: "s1", module: "ui-scene", start: 0, end: 1.2, params: { elements: panel("ONE PROMPT") } },
      { id: "s2", module: "ui-scene", start: 1.2, end: 2.4, in: { type: "push", dur: 0.45, direction: "up" }, params: { elements: panel(headline) } }
    ]
  };
}

async function probe(file) {
  const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-count_frames", "-show_entries", "stream=codec_type,r_frame_rate,nb_read_frames,duration", "-of", "json", file]);
  return JSON.parse(stdout).streams;
}

async function sharpnessPerFrame(file) {
  const grid = lookGrid(1080, 1920);
  const { stdout } = await execFileAsync("ffmpeg", lookFrameArgs(file, grid, LOOK.fps), { encoding: "buffer", maxBuffer: 1 << 30 });
  const size = grid.width * grid.height;
  return Array.from({ length: Math.floor(stdout.length / size) }, (_, n) => laplacianVariance(stdout.subarray(n * size, (n + 1) * size), grid.width, grid.height));
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

test("Remotion renders story.motion.blur: moving frames smear, held frames stay sharp, fps, frames and audio hold", { skip: mediaSkip(), timeout: 600_000 }, async (t) => {
  const missing = await toolsMissing();
  if (missing) { t.skip(`Chrome Headless Shell or FFmpeg is unavailable: ${missing}`); return; }
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-remotion-blur-media-"));
  try {
    await mkdir(path.join(project, "assets"));
    await execFileAsync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=2.4", "-c:a", "aac", path.join(project, "assets/tone.m4a")]);
    const words = "one prompt makes a launch video".split(" ").map((text, i) => ({ text, start: 0.2 + i * 0.35, end: 0.2 + i * 0.35 + 0.3 }));
    await writeFile(path.join(project, "NARRATION.json"), JSON.stringify({ words }));
    const adapter = getRenderer("remotion");
    const render = (blur, output, headline) => renderWithSegments({ project, story: resolveStory(pushStory(blur, headline), { words }), renderer: "remotion", adapter, quality: "draft", output: path.join(project, output), concurrency: 4 });

    const sharp = await render(null, "sharp.mp4");
    const blurred = await render(HEAVY, "blurred.mp4");
    assert.deepEqual([blurred.motion_blur.samples, blurred.motion_blur.rate], [6, 4]);
    assert.ok(blurred.motion_blur.guard_frames > 0);

    const streams = await probe(path.join(project, "blurred.mp4"));
    const video = streams.find((stream) => stream.codec_type === "video");
    const audio = streams.find((stream) => stream.codec_type === "audio");
    assert.equal(video.r_frame_rate, "30/1");
    assert.equal(Number(video.nb_read_frames), 72);
    assert.ok(audio, "the soundtrack survives the blend");
    assert.ok(Math.abs(Number(audio.duration) - 2.4) < 0.15, `audio lasts ${audio.duration} s`);

    const [a, b] = [await sharpnessPerFrame(path.join(project, "sharp.mp4")), await sharpnessPerFrame(path.join(project, "blurred.mp4"))];
    assert.deepEqual([a.length, b.length], [72, 72]);
    // The push (no blur of its own) runs over 1.2–1.65 s. Its fast middle frames smear; the last frames are held.
    t.diagnostic(`Laplacian blurred / sharp, frames 34–52: ${Array.from({ length: 19 }, (_, i) => (b[34 + i] / Math.max(a[34 + i], 1)).toFixed(2)).join(" ")}`);
    const moving = [38, 39, 40, 41, 42, 43];
    const held = [62, 63, 64, 65, 66];
    const ratio = median(moving.map((n) => b[n] / Math.max(a[n], 1)));
    const heldRatio = median(held.map((n) => b[n] / Math.max(a[n], 1)));
    t.diagnostic(`moving Laplacian ratio ${ratio.toFixed(3)}, held ${heldRatio.toFixed(3)}`);
    assert.ok(ratio < 0.8, `moving frames are blurred: Laplacian ratio ${ratio}`);
    assert.ok(heldRatio > 0.85, `held frames stay sharp: Laplacian ratio ${heldRatio}`);

    // Editing s2 reuses s1's sub-frames; a preview of s2 keeps its frames and fps.
    const edited = await render(HEAVY, "edited.mp4", "DONE");
    assert.equal(edited.plan[0].status, "reused");
    assert.ok(edited.plan.slice(1).every((entry) => entry.status === "rendered"));
    const preview = await renderWithSegments({ project, story: resolveStory(pushStory(HEAVY), { words }), renderer: "remotion", adapter, quality: "draft", output: path.join(project, "preview.mp4"), previewScene: "s2", concurrency: 4 });
    const previewVideo = (await probe(path.join(project, "preview.mp4"))).find((stream) => stream.codec_type === "video");
    assert.equal(previewVideo.r_frame_rate, "30/1");
    assert.equal(Number(previewVideo.nb_read_frames), preview.frames.count);
    assert.equal(preview.frames.end, 72);
    assert.ok((await readdir(path.join(project, ".launchclip/finish/segments/remotion"))).every((name) => !name.includes(".partial.")));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
