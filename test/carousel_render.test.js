import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { remotionBundleDir } from "../src/renderers/remotion_segments.js";
import { reframe, renderCarousel } from "../src/carousel/render.js";
import { runStoryCommand } from "../src/story_cli.js";
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
    const media = calls.find(([name]) => name === "renderMedia")[1];
    assert.deepEqual(media.frameRange, [360, 479]);
    assert.equal(media.muted, true);
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
