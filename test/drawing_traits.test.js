// The drawing-traits measurements (src/drawing_traits.js) on frames painted in
// the test (test/helpers/draw_frames.js): no image files. The video cases make
// a short clip with ffmpeg and are skipped without it.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { combineDrawingNumbers, DRAWING_TRAITS_SCHEMA, drawingNumbers, drawingTraits, grainMotion, lineRidges, lumaPlane, measureDrawing, steppingFromDiffs } from "../src/drawing_traits.js";
import { box, canvas, noise, paint, scene } from "./helpers/draw_frames.js";
import { mediaSkip } from "./helpers/media.js";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const skip = hasFfmpeg ? false : "ffmpeg is not installed";
const traitsOf = (...frames) => drawingTraits(drawingNumbers(frames)).traits;

test("outline: presence and line weight from inked shapes, none from flat shapes", () => {
  const flat = traitsOf(scene()).outline;
  assert.equal(flat.label, "none");
  assert.ok(flat.presence < 0.05 && flat.weight === null);

  // Frames are 540 px on the short side, so a 4 px line is 8 px at 1080.
  for (const [px, expected] of [[2, 4], [4, 8], [8, 16]]) {
    const inked = traitsOf(scene({ outline: px })).outline;
    assert.equal(inked.label, "outlined", `${px} px`);
    assert.ok(inked.presence > 0.7, `${px} px presence ${inked.presence}`);
    assert.ok(Math.abs(inked.weight - expected) <= expected * 0.15, `${px} px line read as ${inked.weight} px at 1080`);
    assert.equal(inked.tone, "dark");
    assert.equal(inked.color, "#1c1820");
    assert.ok(inked.confidence >= 0.7);
  }
});

test("outline: line art has lines but no inked boundaries; chalk lines read as a light pen", () => {
  const line = traitsOf(scene({ outline: 3, fill: false })).outline;
  assert.equal(line.label, "line-art");
  assert.ok(line.line_share > 0.9 && line.presence < 0.25);

  const chalk = traitsOf(scene({ outline: 3, fill: false, bg: [24, 40, 36], ink: [236, 236, 228] })).outline;
  assert.equal(chalk.tone, "light");
  assert.equal(chalk.label, "line-art");
  assert.equal(chalk.color, "#ecece4");
});

test("lineRidges: sub-pixel width of an anti-aliased line, and nothing for a wide dark band or a ramp", () => {
  const line = Float32Array.from([200, 200, 200, 120, 30, 30, 30, 120, 200, 200, 200, 200]);
  const [ridge] = lineRidges(line, line.length, 12);
  assert.ok(Math.abs(ridge.width - 4) < 0.3, `width ${ridge.width}`);
  const band = Float32Array.from({ length: 60 }, (_, i) => (i > 10 && i < 50 ? 30 : 200));
  assert.equal(lineRidges(band, band.length, 12).length, 0);
  const ramp = Float32Array.from({ length: 60 }, (_, i) => 200 - i * 3);
  assert.equal(lineRidges(ramp, ramp.length, 12).length, 0);
});

test("fill: flat, gradient, cel-shaded and textured", () => {
  assert.equal(traitsOf(scene()).fill.type, "flat");

  const graded = traitsOf(scene({ fill: (c) => (_x, y) => c.map((v) => v * (0.55 + (0.45 * y) / 540)) })).fill;
  assert.equal(graded.type, "gradient");
  assert.ok(graded.shaded > 0.5, `shaded ${graded.shaded}`);

  // A background that grades from top to bottom, with flat shapes on it.
  const sky = canvas(960, 540);
  paint(sky, [0, 0, 960, 540], () => -1, (_x, y) => [40 + y * 0.2, 60 + y * 0.25, 120 + y * 0.2]);
  box(sky, 300, 200, 200, 150, [240, 200, 60]);
  assert.equal(traitsOf(sky).fill.type, "gradient");

  // Cel shading: a darker shape of the same hue on each fill.
  const cel = scene();
  const shade = (c) => c.map((v) => v * 0.72);
  paint(cel, [75, 55, 265, 245], (x, y) => Math.max(Math.hypot(x - 170, y - 150) - 95, -(Math.hypot(x - 140, y - 125) - 95)), shade([230, 90, 60]));
  paint(cel, [690, 290, 910, 510], (x, y) => Math.max(Math.hypot(x - 800, y - 400) - 110, -(Math.hypot(x - 770, y - 370) - 110)), shade([60, 120, 220]));
  paint(cel, [410, 350, 550, 490], (x, y) => Math.max(Math.hypot(x - 480, y - 420) - 70, -(Math.hypot(x - 460, y - 400) - 70)), shade([250, 200, 60]));
  box(cel, 330, 180, 300, 80, shade([70, 170, 120])); box(cel, 90, 420, 220, 60, shade([60, 120, 220])); box(cel, 700, 160, 190, 60, shade([230, 90, 60]));
  const celFill = traitsOf(cel).fill;
  assert.equal(celFill.type, "cel-shaded");
  assert.ok(celFill.cel > 0.2 && traitsOf(scene()).fill.cel < 0.05);

  // Texture on half the frame is a textured fill, not the frame's grain.
  const half = drawingTraits(drawingNumbers([noise(scene(), 7, { region: [0, 0, 480, 540] })])).traits;
  assert.equal(half.fill.type, "textured");
  assert.equal(half.grain.label, "none");
});

test("grain: texture over the whole frame, with the fills under it still read", () => {
  const { traits, unmeasured } = drawingTraits(drawingNumbers([noise(scene(), 6)]));
  assert.equal(traits.grain.label, "texture");
  assert.ok(traits.grain.coverage > 0.9 && traits.grain.amount > 4 && traits.grain.amount < 8, JSON.stringify(traits.grain));
  assert.equal(traits.fill.type, "flat");
  assert.ok(unmeasured.some((entry) => entry.trait === "grain.motion"), "a still cannot say paper or grain");
  assert.equal(traitsOf(scene()).grain.label, "none");
});

test("grain motion: the same texture holds still, a new one each frame moves", () => {
  const plane = (seed) => lumaPlane(noise(canvas(128, 128, [200, 190, 170]), 6, { seed }));
  assert.ok(grainMotion(plane(3), plane(3), 128, 128) < 0.05);
  assert.ok(grainMotion(plane(3), plane(4), 128, 128) > 0.8);
  assert.equal(grainMotion(lumaPlane(canvas(128, 128)), lumaPlane(canvas(128, 128)), 128, 128), null, "no texture, nothing to compare");
  const still = drawingNumbers([noise(scene(), 6)], { fps: 24, stepping: null, grain_motion: 0.02 });
  assert.equal(drawingTraits(still).traits.grain.label, "paper");
  assert.equal(drawingTraits({ ...still, motion: { ...still.motion, grain_motion: 0.9 } }).traits.grain.label, "grain");
});

test("palette: saturation, contrast and theme", () => {
  const vivid = traitsOf(scene({ bg: [250, 60, 40] })).palette;
  const muted = traitsOf(scene({ bg: [200, 196, 190], colors: [[170, 160, 150], [150, 155, 165], [180, 175, 160], [160, 170, 165]] })).palette;
  assert.ok(vivid.saturation > muted.saturation * 4, `${vivid.saturation} vs ${muted.saturation}`);
  const dark = traitsOf(scene({ bg: [16, 18, 28] })).palette;
  assert.equal(dark.theme, "dark");
  assert.equal(muted.theme, "light");
  assert.ok(dark.contrast > muted.contrast + 0.3, `${dark.contrast} vs ${muted.contrast}`);
});

test("shape: discs and rounded boxes are rounded, square boxes angular", () => {
  const rounded = traitsOf(scene()).shape;
  assert.equal(rounded.label, "rounded");
  assert.ok(rounded.roundness > 0.85);
  const angular = traitsOf(scene({ discs: false, radius: 0 })).shape;
  assert.equal(angular.label, "angular");
  assert.ok(angular.roundness < 0.15, `roundness ${angular.roundness}`);
  // Corners rounded off a little: more curve than corner, but less than discs.
  const soft = traitsOf(scene({ discs: false, radius: 30 })).shape;
  assert.ok(soft.roundness > 0.55 && soft.roundness < rounded.roundness, `roundness ${soft.roundness}`);
  // An outline doubles the edges without changing the shapes.
  assert.equal(traitsOf(scene({ discs: false, radius: 0, outline: 4 })).shape.label, "angular");
});

test("stepping: ones, twos and threes from frame differences; pauses are not stepping", () => {
  const pattern = (hold, frames = 96) => Array.from({ length: frames }, (_, i) => (i % hold === 0 ? 1.4 : 0.01));
  assert.equal(steppingFromDiffs(pattern(1)).hold, 1);
  const twos = steppingFromDiffs(pattern(2));
  assert.ok(twos.shares.twos > 0.95 && Math.abs(twos.hold - 2) < 0.01);
  const threes = steppingFromDiffs(pattern(3));
  assert.ok(threes.shares.threes > 0.95 && Math.abs(threes.hold - 3) < 0.01);
  // Two seconds of ones, a long hold, then ones again: the hold is a pause.
  const paused = [...pattern(1, 48), ...new Array(40).fill(0.01), ...pattern(1, 48)];
  assert.equal(steppingFromDiffs(paused).shares.ones, 1);
  assert.equal(steppingFromDiffs(new Array(96).fill(0.01)), null, "nothing moves");

  const traits = drawingTraits(drawingNumbers([scene()], { fps: 24, stepping: twos, grain_motion: null })).traits;
  assert.equal(traits.stepping.label, "twos");
  assert.equal(traits.stepping.drawings_per_second, 12);
  const stills = drawingTraits(drawingNumbers([scene()]));
  assert.equal(stills.traits.stepping, undefined);
  assert.ok(stills.unmeasured.some((entry) => entry.trait === "stepping"));
});

test("the traits block: a schema, a confidence per trait, and references that add up", () => {
  const block = drawingTraits(drawingNumbers([scene({ outline: 4 })]));
  assert.equal(block.schema, DRAWING_TRAITS_SCHEMA);
  for (const [name, trait] of Object.entries(block.traits)) assert.ok(trait.confidence > 0 && trait.confidence <= 1, `${name} confidence`);
  // One inked reference and one flat: about half the boundaries are inked.
  const mixed = drawingTraits(combineDrawingNumbers([drawingNumbers([scene({ outline: 4 })]), drawingNumbers([scene()])]));
  assert.equal(mixed.frames, 2);
  assert.ok(mixed.traits.outline.presence > 0.3 && mixed.traits.outline.presence < 0.7, `presence ${mixed.traits.outline.presence}`);
  assert.equal(drawingTraits(drawingNumbers([])).unmeasured.length, 6);
  assert.ok(drawingTraits(drawingNumbers([canvas(960, 540)])).unmeasured.some((entry) => entry.trait === "outline"), "a blank frame has nothing drawn");
});

test("a clip animated on twos is read as twos at 12 drawings a second", { skip: mediaSkip(skip), timeout: 120_000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-drawing-"));
  try {
    const twos = path.join(dir, "twos.mp4"), ones = path.join(dir, "ones.mp4");
    const moving = (rate) => ["-f", "lavfi", "-i", `color=c=0xf0ece4:s=640x360:r=${rate}:d=3`, "-f", "lavfi", "-i", `color=c=0xe65a3c:s=120x120:r=${rate}:d=3`, "-filter_complex", `[0:v][1:v]overlay=x='40+t*150':y=120,fps=24,format=yuv420p[out]`, "-map", "[out]", "-c:v", "libx264", "-crf", "14"];
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...moving(12), twos]);
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...moving(24), ones]);
    const read = async (file) => drawingTraits(await measureDrawing(file, { count: 3 })).traits;
    const onTwos = await read(twos);
    assert.equal(onTwos.stepping.label, "twos", JSON.stringify(onTwos.stepping));
    assert.ok(Math.abs(onTwos.stepping.drawings_per_second - 12) < 1);
    assert.equal(onTwos.stepping.fps, 24);
    assert.equal(onTwos.outline.label, "none");
    assert.equal(onTwos.fill.type, "flat");
    const onOnes = await read(ones);
    assert.equal(onOnes.stepping.label, "ones", JSON.stringify(onOnes.stepping));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
