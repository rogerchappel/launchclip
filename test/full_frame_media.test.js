// Full-frame media as content (src/media_presence.js): a photo-scene that
// shows a detailed or moving picture is not the empty plate the layout,
// density and hold gates used to read it as; a flat one still is.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveStory } from "@launchclip/core/story.mjs";
import { checkLayoutProject } from "../src/layout_check.js";
import { densityGate } from "../src/direction_guardrails.js";
import { holdGate } from "../src/movement_guardrails.js";
import { MEDIA_PRESENCE, mediaPresenceFacts, probeFullFrameMedia } from "../src/media_presence.js";
import { predictCaptionPlates } from "../src/caption_legibility.js";
import { mediaSkip } from "./helpers/media.js";

const W = 144, H = 256;
const brand = { colors: { bg: "#101820", primary: "#2a9d8f", accent: "#e9c46a", ink: "#101820", paper: "#f4f1ea" }, fonts: { display: "anton", body: "space-grotesk", meta: "jetbrains-mono" } };

// A cream fridge door with a tally sheet; `marks` strokes are drawn on it.
function fridgeFrame(marks = 0, { flat = false } = {}) {
  const frame = Buffer.alloc(W * H, 226);
  if (flat) return frame;
  for (let y = 20; y < 236; y += 1) for (let x = 24; x < 120; x += 1) frame[y * W + x] = 240;
  for (let y = 20; y < 236; y += 1) { frame[y * W + 24] = 60; frame[y * W + 119] = 60; }
  for (let x = 24; x < 120; x += 1) { frame[20 * W + x] = 60; frame[235 * W + x] = 60; frame[120 * W + x] = 90; }
  for (let y = 60; y < 110; y += 1) { frame[y * W + 30] = 70; frame[y * W + 113] = 70; }
  for (let m = 0; m < marks; m += 1) for (let y = 70; y < 100; y += 1) frame[y * W + 40 + m * 6] = 20;
  return frame;
}
const clip = (frames) => Buffer.concat(frames);

test("presence facts: a flat plate is empty, a detailed still is content, drawn-on marks are motion", () => {
  const flat = mediaPresenceFacts(clip(Array.from({ length: 8 }, () => fridgeFrame(0, { flat: true }))), { width: W, height: H });
  assert.deepEqual({ detailed: flat.detailed, moving: flat.moving_spans, meaningful: flat.meaningful }, { detailed: false, moving: [], meaningful: false });
  const still = mediaPresenceFacts(clip(Array.from({ length: 8 }, () => fridgeFrame(2))), { width: W, height: H });
  assert.equal(still.detailed, true);
  assert.deepEqual(still.moving_spans, []);
  // A mark at 1 s and at 2 s (4 samples a second), then held.
  const drawing = mediaPresenceFacts(clip([0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2].map((marks) => fridgeFrame(marks))), { width: W, height: H });
  assert.equal(drawing.meaningful, true);
  assert.deepEqual(drawing.moving_spans, [[0.75, 1], [1.75, 2]]);
  // Marks every half second join into one span.
  const busy = mediaPresenceFacts(clip([0, 0, 1, 1, 2, 2, 3, 3, 4].map((marks) => fridgeFrame(marks))), { width: W, height: H });
  assert.deepEqual(busy.moving_spans, [[0.25, 2]]);
});

test("probeFullFrameMedia maps a video's moving spans onto the story clock and skips missing assets", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-presence-"));
  try {
    await mkdir(path.join(dir, "assets"), { recursive: true });
    spawnSync("touch", [path.join(dir, "assets", "fridge.mp4"), path.join(dir, "assets", "flat.png")]);
    const calls = [];
    const frames = async (file, options) => {
      calls.push({ file: path.basename(file), ...options });
      if (file.endsWith("flat.png")) return { frames: fridgeFrame(0, { flat: true }), width: W, height: H };
      return { frames: clip([0, 1, 2, 3, 3, 3, 3, 3].map((marks) => fridgeFrame(marks))), width: W, height: H };
    };
    const resolved = { scenes: [
      { id: "door", module: "photo-scene", start: 10, end: 14, params: { media: { src: "assets/fridge.mp4", kind: "video", sourceStart: 0.5 } } },
      { id: "plate", module: "photo-scene", start: 14, end: 16, params: { media: "assets/flat.png" } },
      { id: "gone", module: "photo-scene", start: 16, end: 18, params: { media: "assets/missing.mp4" } },
      { id: "talk", module: "world", start: 0, end: 10, params: { kind: "kitchen" } }
    ] };
    const facts = await probeFullFrameMedia(dir, resolved, { frames });
    assert.deepEqual(Object.keys(facts).sort(), ["door", "plate"]);
    assert.equal(facts.door.meaningful, true);
    assert.deepEqual(facts.door.moving_spans, [[10, 10.75]]);
    assert.equal(facts.plate.meaningful, false);
    assert.deepEqual(calls.find((call) => call.file === "fridge.mp4"), { file: "fridge.mp4", kind: "video", start: 0.5, duration: 4, fps: MEDIA_PRESENCE.fps });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// A portrait story: a fridge photo-scene (track 0) with a character cameo
// standing at it (track 1), and captions.
function fridgeStory() {
  return {
    schema: "launchclip.story.v1", lane: "motion", brand,
    format: { width: 1080, height: 1920, fps: 30, duration: 8 },
    cast: { characters: [{ id: "mia" }] },
    scenes: [
      { id: "door", module: "photo-scene", start: 0, end: 8, params: { media: { src: "assets/fridge.mp4", kind: "video" }, scrim: "none" } },
      { id: "door-mia", module: "character-cameo", track: 1, start: 0, end: 8, params: { character: "mia", side: "left", panel: false, rect: { x: 80, y: 280, width: 540, height: 700 } } }
    ],
    overlays: [{ type: "captions" }]
  };
}

test("layout and density read a meaningful full-frame photo-scene as content, and a flat one as the plate", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-presence-layout-"));
  try {
    const story = fridgeStory();
    const shown = { door: { src: "assets/fridge.mp4", kind: "video", detail: 0.13, detailed: true, moving_spans: [[0.5, 6]], meaningful: true } };
    const flat = { door: { src: "assets/fridge.mp4", kind: "video", detail: 0, detailed: false, moving_spans: [], meaningful: false } };
    const withFridge = await checkLayoutProject(dir, { story, words: [], mediaPresence: shown });
    const media = withFridge.rects.find((rect) => rect.id === "door-media");
    assert.deepEqual({ role: media.role, fullFrame: media.fullFrame, rect: media.rect }, { role: "media", fullFrame: true, rect: { x: 0, y: 0, width: 1080, height: 1920 } });
    assert.ok(!withFridge.findings.some((finding) => finding.rule === "lower-third-empty"), JSON.stringify(withFridge.findings));
    // It sits under everything: the cameo over it is no collision.
    assert.ok(!withFridge.findings.some((finding) => finding.rule === "collision"));
    assert.deepEqual(withFridge.media, shown);
    const resolved = resolveStory(story, { words: [] });
    assert.equal(densityGate(resolved, { rects: withFridge.rects, profile: withFridge.profile }).status, "passed");

    const withPlate = await checkLayoutProject(dir, { story, words: [], mediaPresence: flat });
    assert.equal(withPlate.rects.some((rect) => rect.id === "door-media"), false);
    assert.ok(withPlate.findings.some((finding) => finding.rule === "lower-third-empty"));
    const empty = densityGate(resolved, { rects: withPlate.rects, profile: withPlate.profile });
    assert.equal(empty.status, "failed");
    assert.ok(empty.findings.some((finding) => finding.rule === "empty-region" && /bottom third holds only the plate/.test(finding.detail)), JSON.stringify(empty.findings));

    // The photo-scene's picture is not a reason to pre-plate captions (measured on the render instead).
    const chunks = [{ id: "c1", start: 1, end: 2, words: [{ word: "fridge", start: 1, end: 2 }] }];
    assert.deepEqual(predictCaptionPlates(resolved, chunks, withFridge.rects.filter((rect) => rect.id === "door-media")), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("holds: a photo-scene video counts as live while its pixels move, and a held stretch still fails", () => {
  const resolved = resolveStory({ ...fridgeStory(), scenes: [fridgeStory().scenes[0]], overlays: [], ambient: "off" }, { words: [] });
  const before = holdGate(resolved);
  assert.equal(before.status, "failed");
  assert.ok(before.findings.some((finding) => finding.rule === "static-hold"));
  const moving = holdGate(resolved, { media: { door: { moving_spans: [[0, 8]], meaningful: true } } });
  assert.equal(moving.findings.filter((finding) => finding.rule === "static-hold").length, 0, JSON.stringify(moving.findings));
  // Marks drawn only in the first 2 s: the 6 s that follow are still a hold.
  const partly = holdGate(resolved, { media: { door: { moving_spans: [[0, 2]], meaningful: true } } });
  const held = partly.findings.find((finding) => finding.rule === "static-hold");
  assert.ok(held && held.at >= 2, JSON.stringify(partly.findings));
});

test("probeFullFrameMedia reads real assets with ffmpeg", { skip: mediaSkip(spawnSync("ffmpeg", ["-version"]).status === 0 ? false : "ffmpeg is not installed") }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-presence-ffmpeg-"));
  try {
    await mkdir(path.join(dir, "assets"), { recursive: true });
    const run = (args) => assert.equal(spawnSync("ffmpeg", ["-v", "error", "-y", ...args]).status, 0);
    run(["-f", "lavfi", "-i", "color=c=0xEDE4D3:s=540x960:d=2:r=30", "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(dir, "assets", "flat.mp4")]);
    // A box sliding across a cream plate.
    run(["-f", "lavfi", "-i", "color=c=0xEDE4D3:s=540x960:d=2:r=30", "-f", "lavfi", "-i", "color=c=0x202020:s=80x200:d=2:r=30", "-filter_complex", "[0][1]overlay=x='40+t*150':y=300", "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(dir, "assets", "moving.mp4")]);
    const facts = await probeFullFrameMedia(dir, { scenes: [
      { id: "flat", module: "photo-scene", start: 0, end: 2, params: { media: "assets/flat.mp4" } },
      { id: "moving", module: "photo-scene", start: 2, end: 4, params: { media: "assets/moving.mp4" } }
    ] });
    assert.equal(facts.flat.meaningful, false);
    assert.equal(facts.moving.meaningful, true);
    assert.ok(facts.moving.moving_spans.length >= 1 && facts.moving.moving_spans[0][0] < 2.5, JSON.stringify(facts.moving));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
