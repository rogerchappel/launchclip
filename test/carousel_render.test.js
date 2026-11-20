import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { remotionBundleDir } from "../src/renderers/remotion_segments.js";
import { footageProblems, motionStory, reframe, renderCarousel, slideFootage } from "../src/carousel/render.js";
import { runStoryCommand, validateStory } from "../src/story_cli.js";
import { choreographyGate } from "../src/movement_guardrails.js";
import { slideStills } from "@launchclip/core/carousel.mjs";

const SAMPLE = path.resolve("examples/carousel/listicle-4x5/storyboard.json");

// The sample carousel in a temp project, a stubbed @remotion/renderer that
// writes a tiny PNG per still, and a bundle already in place (as in
// remotion_memory.test.js) so nothing is bundled.
async function fixture(edit = (story) => story) {
  const root = await mkdtemp(path.join(os.tmpdir(), "launchclip-carousel-render-"));
  const project = path.join(root, "project");
  await mkdir(project, { recursive: true });
  const story = edit(JSON.parse(await readFile(SAMPLE, "utf8")));
  await writeFile(path.join(project, "storyboard.json"), JSON.stringify(story));
  const remotion = { entry: path.join(root, "entry.tsx"), kitHash: "kit-1", bundleRoot: path.join(root, "bundles") };
  const { dir } = await remotionBundleDir({ ...remotion, project });
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "index.html"), "");
  await writeFile(path.join(dir, "bundle.js"), "");
  const calls = [];
  remotion.renderer = {
    openBrowser: async () => { calls.push(["openBrowser"]); return { close: async () => {} }; },
    selectComposition: async (options) => { calls.push(["selectComposition", options]); return { id: "LaunchclipStory" }; },
    renderStill: async (options) => {
      calls.push(["renderStill", options]);
      await sharp({ create: { width: 4, height: 5, channels: 3, background: "#e2412b" } }).png().toFile(options.output);
    },
    renderMedia: async (options) => { calls.push(["renderMedia", options]); await writeFile(options.outputLocation, "mezzanine"); }
  };
  remotion.encode = async (input, output) => { calls.push(["encode", input, output]); await copyFile(input, output); };
  return { root, project, calls, adapters: { remotion } };
}

test("each destination gets its settled stills, a JPG where it takes one, and render.json", async () => {
  const { root, project, calls, adapters } = await fixture();
  try {
    const report = await renderCarousel(project, { dest: "instagram,tiktok" }, adapters);
    assert.deepEqual(report.destinations.map((dest) => dest.status), ["rendered", "rendered"]);
    const [instagram, tiktok] = report.destinations;
    assert.equal(instagram.reframed, false);
    assert.equal(tiktok.reframed, true);
    assert.deepEqual((await readdir(instagram.out)).sort(), ["01.png", "02.png", "03.png", "04.png", "05.png", "render.json"]);
    assert.deepEqual((await readdir(tiktok.out)).filter((name) => name.endsWith(".jpg")).sort(), ["01.jpg", "02.jpg", "03.jpg", "04.jpg", "05.jpg"]);
    assert.equal((await sharp(path.join(tiktok.out, "01.jpg")).metadata()).format, "jpeg");

    // The stills are the contract's settled frames, rendered on each destination's canvas.
    const stills = calls.filter(([name]) => name === "renderStill").map(([, options]) => options);
    const expected = slideStills(JSON.parse(await readFile(SAMPLE, "utf8"))).map((still) => still.frame);
    assert.deepEqual(stills.map((options) => options.frame), [...expected, ...expected]);
    assert.deepEqual(stills.map((options) => options.inputProps.format.height), [...expected.map(() => 1350), ...expected.map(() => 1920)]);
    assert.equal(calls.filter(([name]) => name === "openBrowser").length, 2, "one browser per destination");

    const manifest = JSON.parse(await readFile(path.join(tiktok.out, "render.json"), "utf8"));
    assert.deepEqual(manifest.canvas, { width: 1080, height: 1920 });
    assert.deepEqual(manifest.slides[0], { id: "cover", index: 0, role: "cover", medium: "still", at: 3.25, frame: 97, alt: "Headline: 3 habits that make teams ship faster", files: ["01.png", "01.jpg"] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a motion slide gets a silent clip of its scene where the destination takes motion, and its still everywhere", async () => {
  const { root, project, calls, adapters } = await fixture((story) => {
    Object.assign(story.scenes[3], { loop: true, slide: { ...story.scenes[3].slide, medium: "motion" } });
    return story;
  });
  try {
    const report = await renderCarousel(project, { dest: "instagram,tiktok" }, adapters);
    const [instagram, tiktok] = report.destinations;
    assert.deepEqual(instagram.slides[3].files, ["04.png", "04.mp4"]);
    assert.deepEqual(instagram.slides[3].clip, { start_frame: 360, end_frame: 480 });
    // The clip is the whole of the slide's own story; its still is a frame of that story.
    const media = calls.find(([name]) => name === "renderMedia")[1];
    assert.deepEqual(media.frameRange, [0, 119]);
    assert.equal(media.muted, true);
    assert.deepEqual([media.inputProps.scenes.map((scene) => scene.id), media.inputProps.ending], [["summary"], { loop_to: "summary" }]);
    const still = calls.find(([name, options]) => name === "renderStill" && options.output.endsWith("instagram/04.png"))[1];
    assert.equal(still.inputProps, media.inputProps);
    assert.equal(still.frame, instagram.slides[3].frame - 360);
    // One browser per destination, for every still and clip.
    assert.equal(calls.filter(([name]) => name === "openBrowser").length, 2);
    assert.deepEqual(await readdir(instagram.out).then((names) => names.filter((name) => name.includes("mezzanine"))), []);
    // TikTok takes images only: the still goes, with the contract's warning.
    assert.deepEqual(tiktok.slides[3].files, ["04.png", "04.jpg"]);
    assert.ok(tiktok.warnings.some((warning) => /images only/.test(warning)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a destination that cannot take the carousel fails on its own; the others render", async () => {
  const { root, project, adapters } = await fixture();
  try {
    const report = await renderCarousel(project, { dest: "x,instagram,nowhere" }, adapters);
    const [x, instagram, nowhere] = report.destinations;
    assert.equal(x.status, "failed");
    assert.match(x.errors[0], /x takes 1 to 4 slides/);
    assert.equal(instagram.status, "rendered");
    assert.equal(nowhere.status, "failed");
    assert.match(nowhere.errors[0], /unknown destination nowhere/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reframe lays the story out on the destination's canvas and reports what no longer fits", async () => {
  const story = (await runStoryCommand("resolve", SAMPLE, {})).story_resolved;
  assert.deepEqual(reframe(story, "instagram"), { story, reframed: false, errors: [] });
  const square = reframe(story, "meta-ads");
  assert.deepEqual(square.errors, []);
  assert.deepEqual([square.story.format.width, square.story.format.height, story.format.height], [1080, 1080, 1350]);
  // A rect inside the 4:5 safe zone (y from 197) but above the 9:16 one (y from 280).
  story.scenes[0] = { ...story.scenes[0], params: { ...story.scenes[0].params, rect: { x: 80, y: 200, width: 860, height: 400 } } };
  assert.deepEqual(reframe(story, "instagram").errors, []);
  const errors = reframe(story, "tiktok").errors;
  assert.ok(errors.length && errors.every((message) => message.startsWith("at 1080x1920: scenes[0]")), errors.join("\n"));
});

test("--dest falls back to the story's destinations, and a video story is refused", async () => {
  const { root, project, adapters } = await fixture();
  try {
    const report = await renderCarousel(path.join(project, "storyboard.json"), {}, adapters);
    assert.deepEqual(report.destinations.map((dest) => dest.id), ["instagram", "linkedin"]);
    const video = JSON.parse(await readFile(SAMPLE, "utf8"));
    delete video.format.kind; delete video.carousel;
    video.scenes = video.scenes.map(({ slide, ...scene }) => scene);
    await writeFile(path.join(project, "storyboard.json"), JSON.stringify(video));
    await assert.rejects(renderCarousel(project, {}, adapters), /is not a carousel/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("motionStory: the slide alone as a valid video story that loops onto itself, seam and all", async () => {
  const story = (await runStoryCommand("resolve", path.resolve("examples/carousel/motion-ad-1x1/storyboard.json"), {})).story_resolved;
  for (const id of ["meta-ads", "instagram", "tiktok"]) {
    const solo = motionStory(reframe(story, id).story, "product");
    assert.deepEqual(validateStory(solo).errors, [], id);
    assert.equal(solo.format.kind, undefined);
    assert.deepEqual([solo.format.duration, solo.resolved.frames, solo.ending], [6, 180, { loop_to: "product" }]);
    assert.deepEqual(solo.scenes.map((scene) => [scene.id, scene.start, scene.end, scene.in?.type, scene.slide]), [["product", 0, 6, "cut", undefined]]);
    // Without the typed in, a plate at frame 0 enters fully visible and the loop blinks.
    assert.deepEqual(choreographyGate(solo).findings, [], id);
  }
});

test("motionStory: a card without loop plays once and holds a settled last frame", async () => {
  const story = (await runStoryCommand("resolve", path.resolve("examples/carousel/motion-ad-1x1/storyboard.json"), {})).story_resolved;
  delete story.scenes.find((scene) => scene.id === "product").loop;
  const solo = motionStory(story, "product");
  assert.deepEqual(validateStory(solo).errors, []);
  assert.deepEqual(solo.ending, { final: "hold" });
  assert.equal(solo.scenes[0].in.type, "cut", "still typed, so its entrance plays from frame 0");
});

test("footage cards: the video under the type, and a source too short for the card is refused", async () => {
  const card = (extra) => ({ id: "shot", module: "motion-title", start: 4, end: 9, slide: { role: "body", medium: "motion", alt: "a shot" }, ...extra });
  assert.deepEqual(slideFootage(card({ plate: { kind: "video", params: { src: "assets/clips/a.mp4", start: 2 } } })), { src: "assets/clips/a.mp4", start: 2 });
  assert.deepEqual(slideFootage(card({ module: "clip", params: { media: { src: "assets/rec.mov", sourceStart: 30 } } })), { src: "assets/rec.mov", start: 30 });
  assert.equal(slideFootage(card({ plate: { kind: "image", params: { src: "assets/a.jpg" } } })), null);
  const probe = async (file) => ({ format: { duration: file.endsWith("short.mp4") ? "6" : "8" } });
  const story = { scenes: [card({ plate: { kind: "video", params: { src: "assets/ok.mp4", start: 3 } } }), card({ id: "late", plate: { kind: "video", params: { src: "assets/short.mp4", start: 2 } } }), card({ id: "still", slide: { medium: "still" }, plate: { kind: "video", params: { src: "assets/short.mp4", start: 5 } } })] };
  const problems = await footageProblems(story, "/p", probe);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /slide late: .* runs 6\.00 s, so from 2 s it cannot fill the 5 s card/);
  assert.match((await footageProblems({ scenes: [story.scenes[0]] }, "/p", async () => { throw new Error("nope"); }))[0], /cannot read its footage/);
});

test("hyperframes: still slides in one snapshot, each motion slide its own story rendered whole and kept silent", async () => {
  const { root, project } = await fixture((story) => {
    Object.assign(story.scenes[3], { loop: true, slide: { ...story.scenes[3].slide, medium: "motion" } });
    return story;
  });
  const calls = [];
  const run = async (command, args) => {
    const display = command === "ffmpeg" ? ["ffmpeg", ...args] : args.slice(1);
    calls.push([...display]);
    if (display[0] === "snapshot") {
      const out = args[args.indexOf("--output") + 1];
      await mkdir(out, { recursive: true });
      for (const [i] of args[args.indexOf("--at") + 1].split(",").entries()) await sharp({ create: { width: 4, height: 5, channels: 3, background: "#151515" } }).png().toFile(path.join(out, `frame-${String(i).padStart(2, "0")}.png`));
    }
    if (display[0] === "render") await writeFile(args[args.indexOf("--output") + 1], "mp4");
    if (command === "ffmpeg") await copyFile(args[args.indexOf("-i") + 1], args.at(-1));
    return { stdout: "", stderr: "" };
  };
  try {
    const report = await renderCarousel(project, { dest: "instagram", renderer: "hyperframes" }, { run });
    const [instagram] = report.destinations;
    assert.equal(instagram.status, "rendered", instagram.errors.join("\n"));
    assert.deepEqual(instagram.slides[3].files, ["04.png", "04.mp4"]);
    const snapshots = calls.filter(([name]) => name === "snapshot").map((args) => args[args.indexOf("--at") + 1].split(",").length);
    assert.deepEqual(snapshots, [4, 1]);
    assert.equal(calls.filter(([name]) => name === "render").length, 1);
    const ffmpeg = calls.find(([name]) => name === "ffmpeg");
    assert.ok(ffmpeg.includes("-an") && ffmpeg.includes("copy"), "the clip is remuxed, silent");
    assert.deepEqual(await readdir(path.join(project, ".launchclip")), [], "the work dir is removed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
