// Card backdrops (make --card-backdrops footage): a full-screen card sits on
// a calm clip from the app's library, under a dim, blur or tint, instead of a
// stock plate; no shot keeps the stock plate.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { DEFAULT_BRAND } from "@launchclip/core/planning-prompt.mjs";
import { scenePlatePlan } from "@launchclip/core/plates.mjs";
import { resolveStory, validateStory } from "@launchclip/core/story.mjs";
import { compileStoryToHyperFrames } from "../kit/hyperframes/story-compiler.mjs";
import { BACKDROP_BUSY_MOTION, MAX_BACKDROP_REQUESTS, backdropPrompt, backdropRequests, cardBackdrops, footageStats, measureFootage, resolveShots, shotRequests } from "../src/asset_provider.js";
import { worldLook } from "../src/make/index.js";
import { makeOptionsFromFlags, validateMakeOptions } from "../src/make/options.js";
import { planStoryboard } from "../src/storyboard_planner.js";

const FORMAT = { width: 1080, height: 1920, fps: 30, duration: 9, platform: "youtube-shorts" };
const WORDS = [["Decking", 0.2], ["boards", 0.7], ["come", 3.1], ["in", 3.4], ["three", 3.6], ["materials", 4.0], ["Care", 6.2], ["matters", 6.7]].map(([text, start]) => ({ text, start, end: start + 0.4 }));
const AUDIO = { voice: "assets/audio/narration.wav", words: "NARRATION.json", music: { source: "synth", bpm: 96 }, sfx: "auto" };
const CLIP = { kind: "shot", shows: "a deck being sanded, close up", type: "video" };

// s1 cuts to a library clip, s2 is a full-screen card, s3 the call to action.
function story({ backdrop } = {}) {
  return {
    schema: "launchclip.story.v1",
    title: "Decking",
    lane: "voiceover-motion",
    format: FORMAT,
    brand: DEFAULT_BRAND,
    audio: AUDIO,
    scenes: [
      { id: "s1", module: "clip", start: 0, end: "word:come", energy: 1, params: { media: CLIP } },
      { id: "s2", module: "hook-title", start: "word:come", end: "word:Care", energy: 1, params: { headline: "Three materials", emphasis: "Three" }, ...(backdrop ? { backdrop } : {}) },
      { id: "s3", module: "cta", start: "word:Care", end: 9, energy: 1, in: { type: "fade", dur: 0.3 }, params: { action: "Care matters", loop: true } }
    ],
    overlays: [{ type: "captions", style: "word-highlight" }],
    ending: { loop_to: "s1" }
  };
}

const BACKDROP = { kind: "shot", shows: "a quiet timber deck at dusk, slow pan", treatment: "tint" };
const calm = async () => ({ peak: 0.62, motion: 0.02, frames: 8 });

async function library(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-backdrops-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const project = path.join(dir, "project");
  const files = {};
  for (const name of ["sanding", "dusk", "beach"]) { files[name] = path.join(dir, `${name}.mp4`); await writeFile(files[name], `${name} bytes`); }
  return { project, files };
}

test("a backdrop request is asked after the other shots, for a calm clip that is not the scene beside it", async (t) => {
  const { project, files } = await library(t);
  const asked = [];
  const assets = { async findShot(request) { asked.push(request); return request.slot === "backdrop" ? { file: files.dusk, kind: "video", source: "library", asset_id: "dusk-1", duration: 12 } : { file: files.sanding, kind: "video", source: "library", asset_id: "sand-1" }; } };
  const found = await resolveShots(story({ backdrop: BACKDROP }), { assets, words: WORDS, project, measure: calm });
  assert.deepEqual(found.errors, []);
  assert.deepEqual(asked.map((request) => request.slot), ["media", "backdrop"]);
  const request = asked[1];
  assert.deepEqual([request.role, request.motion, request.type, request.still, request.shows], ["background", "low", "video", false, BACKDROP.shows]);
  assert.equal(request.line, "come in three materials");
  assert.ok(request.duration > 2.5);
  assert.deepEqual(request.avoid, [{ scene_id: "s1", src: found.storyboard.scenes[0].params.media.src, asset_id: "sand-1" }]);
  const backdrop = found.storyboard.scenes[1].backdrop;
  assert.equal(backdrop.kind, "video");
  assert.match(backdrop.params.src, /^assets\/shots\/s2-backdrop-[0-9a-f]{10}\.mp4$/);
  assert.deepEqual([backdrop.params.treatment, backdrop.params.peak], ["tint", 0.62]);
  assert.equal(await readFile(path.join(project, backdrop.params.src), "utf8"), "dusk bytes");
  assert.equal(backdropRequests(found.storyboard).length, 0);
  assert.equal(shotRequests(found.storyboard).length, 0);
  const shot = found.shots.find((entry) => entry.slot === "backdrop");
  assert.deepEqual([shot.scene_id, shot.treatment, shot.footage.peak], ["s2", "tint", 0.62]);
  // The story checks, and the card's plate is the clip under its treatment.
  const resolved = resolveStory(found.storyboard, { words: WORDS });
  assert.deepEqual(validateStory(found.storyboard, { words: WORDS }).errors.filter((error) => /backdrop|plate/.test(error)), []);
  const plan = scenePlatePlan(resolved, resolved.scenes[1]);
  assert.equal(plan.kind, "video");
  assert.ok(plan.contrast.ok);
});

test("a backdrop the app cannot find, or the shot beside it, leaves the card on the stock plate", async (t) => {
  const { project, files } = await library(t);
  const none = await resolveShots(story({ backdrop: BACKDROP }), { assets: { async findShot(request) { return request.slot === "backdrop" ? null : { file: files.sanding, kind: "video", source: "library", asset_id: "sand-1" }; } }, words: WORDS, project, measure: calm });
  assert.deepEqual(none.errors, []);
  assert.equal(none.storyboard.scenes[1].backdrop, undefined);
  assert.ok(none.warnings.some((warning) => /scene s2: the app has no backdrop shot .* keeps the story's plate$/.test(warning)), none.warnings.join("\n"));
  const same = await resolveShots(story({ backdrop: BACKDROP }), { assets: { async findShot() { return { file: files.sanding, kind: "video", source: "library", asset_id: "sand-1" }; } }, words: WORDS, project, measure: calm });
  assert.equal(same.storyboard.scenes[1].backdrop, undefined);
  assert.ok(same.warnings.some((warning) => /the one a scene beside it shows \(sand-1\)/.test(warning)), same.warnings.join("\n"));
  const thrown = await resolveShots(story({ backdrop: BACKDROP }), { assets: { async findShot(request) { if (request.slot === "backdrop") throw new Error("library offline"); return { file: files.sanding, kind: "video" }; } }, words: WORDS, project, measure: calm });
  assert.equal(thrown.storyboard.scenes[1].backdrop, undefined);
  assert.ok(thrown.warnings.some((warning) => /library offline/.test(warning)));
});

test("busy footage is placed with a warning; a still becomes an image plate", async (t) => {
  const { project, files } = await library(t);
  const busy = await resolveShots(story({ backdrop: BACKDROP }), { assets: { async findShot(request) { return { file: request.slot === "backdrop" ? files.beach : files.sanding, kind: "video" }; } }, words: WORDS, project, measure: async () => ({ peak: 1, motion: BACKDROP_BUSY_MOTION + 0.05, frames: 6 }) });
  assert.equal(busy.storyboard.scenes[1].backdrop.kind, "video");
  assert.ok(busy.warnings.some((warning) => /moves a lot/.test(warning)));
  const still = path.join(path.dirname(files.beach), "deck.jpg");
  await writeFile(still, "jpeg");
  const image = await resolveShots(story({ backdrop: BACKDROP }), { assets: { async findShot(request) { return request.slot === "backdrop" ? { file: still } : { file: files.sanding, kind: "video" }; } }, words: WORDS, project, measure: calm });
  assert.equal(image.storyboard.scenes[1].backdrop.kind, "image");
  assert.match(image.storyboard.scenes[1].backdrop.params.src, /\.jpg$/);
});

test("cardBackdrops asks for footage behind the full-screen cards a plan left on a stock plate", () => {
  const { storyboard, added } = cardBackdrops(story(), { words: WORDS });
  // s1 is footage of its own; s2 and s3 are cards, longest first.
  assert.deepEqual(added, ["s2", "s3"]);
  assert.equal(storyboard.scenes[0].backdrop, undefined);
  assert.equal(storyboard.scenes[1].backdrop.kind, "shot");
  assert.match(storyboard.scenes[1].backdrop.shows, /calm, steady shot .*come in three materials/);
  assert.equal(storyboard.scenes[1].backdrop.treatment, "dim");
  // The plan's own backdrop choices count toward the cap and are kept.
  const own = cardBackdrops(story({ backdrop: BACKDROP }), { words: WORDS, max: 2 });
  assert.deepEqual(own.added, ["s3"]);
  assert.deepEqual(own.storyboard.scenes[1].backdrop, BACKDROP);
  assert.deepEqual(cardBackdrops(story(), { words: WORDS, max: 1 }).added, ["s2"]);
  assert.deepEqual(cardBackdrops({ ...story(), lane: "footage-led" }, { words: WORDS }).added, []);
  assert.match(backdropPrompt(), new RegExp(`at most ${MAX_BACKDROP_REQUESTS}`));
});

test("the planner offers card backdrops only with a provider and --card-backdrops footage", async (t) => {
  const { project, files } = await library(t);
  const boards = [story()];
  const client = { requests: [], async runStructured(request) { this.requests.push(request); return { model: "m", value: { storyboard_json: JSON.stringify(boards[0]) }, usage: { input_tokens: 1, output_tokens: 1 } }; } };
  const assets = { async findShot(request) { return { file: request.slot === "backdrop" ? files.dusk : files.sanding, kind: "video" }; } };
  const base = { brief: "Decking materials and their care.", words: WORDS, lane: "voiceover-motion", format: FORMAT, audio: AUDIO, tier: "structured", model: "m", client, assets, project };
  const off = await planStoryboard(base);
  assert.doesNotMatch(client.requests[0].instructions, /Card backdrops/);
  assert.equal(off.storyboard.scenes[1].backdrop, undefined);
  const on = await planStoryboard({ ...base, cardBackdrops: "footage" });
  assert.equal(on.status, "passed", on.errors.join("\n"));
  assert.match(client.requests.at(-1).instructions, /Card backdrops from the app's media library/);
  assert.equal(on.storyboard.scenes[1].backdrop.kind, "video");
  assert.equal(on.shot_counts.answered, 1, "backdrops are not counted as shots");
  assert.equal(makeOptionsFromFlags({ "card-backdrops": "footage" }).cardBackdrops, "footage");
  assert.throws(() => validateMakeOptions({ cardBackdrops: "stock" }), /--card-backdrops must be off or footage/);
});

test("footageStats: the 99th-percentile level and the mean change between frames", () => {
  const pixels = 100;
  const frame = (value, bright = 0) => Array.from({ length: pixels }, (_, i) => (i < bright ? 255 : value));
  const still = footageStats(Uint8Array.from([...frame(40, 2), ...frame(40, 2)]), pixels);
  assert.deepEqual(still, { peak: 1, motion: 0, frames: 2 });
  const dark = footageStats(Uint8Array.from([...frame(51), ...frame(102)]), pixels);
  assert.deepEqual(dark, { peak: 0.4, motion: 0.2, frames: 2 });
  assert.equal(footageStats(Uint8Array.from([]), pixels), null);
});

test("measureFootage reads a real clip with ffmpeg", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-measure-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "grey.mp4");
  try {
    await promisify(execFile)("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x404040:s=160x284:d=2:r=10", "-pix_fmt", "yuv420p", file]);
  } catch {
    t.skip("no ffmpeg");
    return;
  }
  const stats = await measureFootage(file, { start: 0, duration: 2 });
  assert.ok(stats.frames >= 3, JSON.stringify(stats));
  assert.ok(stats.peak > 0.2 && stats.peak < 0.3, JSON.stringify(stats));
  assert.equal(stats.motion, 0);
});

test("both renderers' inputs: HyperFrames plays the clip as a timed video in cuts and world mode", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-backdrop-hf-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const board = story({ backdrop: { kind: "video", params: { src: "assets/shots/dusk.mp4", start: 2, treatment: "blur" } } });
  board.scenes[0].params.media = { kind: "video", src: "assets/shots/sand.mp4" };
  for (const mode of ["cuts", "world"]) {
    const out = path.join(dir, mode);
    await compileStoryToHyperFrames(resolveStory({ ...board, camera: { mode } }, { words: WORDS }), { projectDir: out, sourceDir: dir });
    const html = await readFile(path.join(out, "index.html"), "utf8");
    const video = /<video id="[^"]+-video-clip" class="clip lc-plate-video" src="assets\/shots\/dusk\.mp4" data-start="([\d.]+)" data-duration="([\d.]+)" data-media-start="2" data-track-index="\d+" muted playsinline/.exec(html);
    assert.ok(video, `${mode}: ${html.slice(0, 200)}`);
    assert.ok(Number(video[2]) > 2, mode);
    assert.match(html, /filter:blur\(26px\)/, mode);
  }
});

test("worldLook keeps the plate cycle for the other shots when a card sits on footage", () => {
  const scenes = Array.from({ length: 6 }, (_, i) => ({ id: `s${i + 1}`, module: "stat-card", start: i * 3, end: i * 3 + 3 }));
  scenes[2].backdrop = { kind: "video", params: { src: "assets/shots/a.mp4" } };
  const plated = { lane: "motion", format: { duration: 18 }, scenes };
  assert.deepEqual(worldLook(plated, ""), ["camera.mode world", "plate cycle every 3 shots (neutral plates)"]);
});
