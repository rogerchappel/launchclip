import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { GRADE_PRESET_NAMES, buildCube, cubeText, gradeContrastLosses, gradeErrors, mixCube, parseCube, presetCube, resolveGrade, sampleCube } from "@launchclip/core/grade.mjs";
import { STORY_GRADE_PRESETS, validateStory } from "@launchclip/core/story.mjs";
import { applyStyle, validateStylePack } from "@launchclip/core/style.mjs";
import { generateStyle } from "@launchclip/core/style-seed.mjs";
import { DEFAULT_BRAND } from "@launchclip/core/default-brand.mjs";
import { GRADE_CUBE_FILE, applyGrade } from "../src/grade.js";
import { mediaSkip } from "./helpers/media.js";

const story = (grade) => ({
  schema: "launchclip.story.v1", lane: "motion", grade,
  format: { width: 1080, height: 1920, fps: 30, duration: 4 },
  brand: { colors: { bg: "#101014", paper: "#f2eee6", ink: "#101014", primary: "#fdb022", accent: "#46d4ff" }, fonts: { display: "anton", body: "inter", meta: "jetbrains-mono" } },
  scenes: [{ id: "a", module: "hook-title", start: 0, end: 4, params: { headline: "Hello" } }]
});

test("story.grade presets stay in step with grade.mjs, and both validators agree", () => {
  assert.deepEqual(STORY_GRADE_PRESETS, [...GRADE_PRESET_NAMES]);
  const values = ["off", "warm-film", "sepia", { preset: "bleach", strength: 0.5 }, { cube: "luts/mine.cube" }, { cube: "luts/mine.png" }, { preset: "clean", cube: "a.cube" }, { strength: 1 }, { preset: "clean", strength: 2 }, 3];
  for (const value of values) {
    const storyErrors = validateStory(story(value)).errors.filter((message) => message.startsWith("grade"));
    assert.equal(storyErrors.length > 0, gradeErrors(value).length > 0, JSON.stringify(value));
  }
});

test("resolveGrade: names, objects, off and strength 0", () => {
  assert.deepEqual(resolveGrade(story("teal-amber")), { preset: "teal-amber", strength: 1 });
  assert.deepEqual(resolveGrade(story({ cube: "a.cube", strength: 0.4 })), { cube: "a.cube", strength: 0.4 });
  for (const off of [undefined, "off", false, { preset: "clean", strength: 0 }, "nope"]) assert.equal(resolveGrade(story(off)), null);
});

test("strength 0 is identity and strength mixes linearly", () => {
  const identity = buildCube((rgb) => rgb, 9);
  const cube = presetCube("bleach", 9);
  assert.deepEqual(Array.from(mixCube(cube, 0).data), Array.from(identity.data));
  const half = mixCube(cube, 0.5);
  half.data.forEach((v, i) => assert.ok(Math.abs(v - (identity.data[i] + cube.data[i]) / 2) < 1e-6));
  // An identity cube samples back the colour it was given.
  const out = sampleCube(identity, [0.2, 0.55, 0.9]);
  out.forEach((v, i) => assert.ok(Math.abs(v - [0.2, 0.55, 0.9][i]) < 1e-6));
});

test(".cube round trip and rejections", () => {
  const cube = presetCube("warm-film", 5);
  const back = parseCube(cubeText(cube));
  assert.equal(back.size, 5);
  back.data.forEach((v, i) => assert.ok(Math.abs(v - cube.data[i]) < 1e-6));
  assert.throws(() => parseCube("LUT_1D_SIZE 4\n0 0 0\n"), /1D/);
  assert.throws(() => parseCube("LUT_3D_SIZE 2\n0 0 0\n"), /needs 8/);
  assert.throws(() => parseCube("LUT_3D_SIZE 2\nDOMAIN_MAX 255 255 255\n"), /DOMAIN_MAX/);
  assert.equal(parseCube(`# comment\nTITLE "x"\nDOMAIN_MIN 0 0 0\nLUT_3D_SIZE 2\n${cubeText(buildCube((c) => c, 2)).split("\n").slice(2).join("\n")}`).size, 2);
});

test("no preset pushes the default brand's text pairs under AA contrast; a heavy grade is named", () => {
  for (const name of GRADE_PRESET_NAMES) assert.deepEqual(gradeContrastLosses(presetCube(name), DEFAULT_BRAND.colors), [], name);
  const crush = buildCube(([r, g, b]) => [0.4 + r * 0.2, 0.4 + g * 0.2, 0.4 + b * 0.2], 5);
  assert.ok(gradeContrastLosses(crush, { ink: "#000000", paper: "#ffffff" }).length === 1);
});

test("presets keep neutrals neutral (no colour cast on greys) except the tinted ones, and black stays near black", () => {
  for (const name of ["clean", "bleach", "neon-crush"]) {
    const grey = sampleCube(presetCube(name), [0.5, 0.5, 0.5]);
    assert.ok(Math.max(...grey) - Math.min(...grey) < 0.01, name);
  }
  for (const name of GRADE_PRESET_NAMES) assert.ok(Math.max(...sampleCube(presetCube(name), [0, 0, 0])) < 0.05, name);
});

test("a seeded style carries a valid grade the story inherits; the story's own grade wins", () => {
  const pack = generateStyle({ seed: "7f3a91c2", tone: "technical" });
  assert.equal(pack.grade, "cool-tech");
  assert.ok(validateStylePack(pack).ok);
  assert.equal(generateStyle({ seed: "7f3a91c2", constraints: { look: "neon-night" } }).grade, "neon-crush");
  assert.equal(applyStyle(story(undefined), pack).story.grade, "cool-tech");
  assert.equal(applyStyle(story("off"), pack).story.grade, "off");
  assert.ok(!validateStylePack({ ...pack, grade: "sepia" }).ok);
});

test("applyGrade leaves an ungraded story alone and writes the cube for a graded one", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "grade-"));
  try {
    const calls = [];
    const ffmpeg = async (args) => { calls.push(args); await writeFile(args[args.length - 1], "graded"); };
    await writeFile(path.join(dir, "raw.mp4"), "raw");
    assert.equal(await applyGrade(dir, story("off"), path.join(dir, "raw.mp4"), { ffmpeg }), null);
    assert.equal(calls.length, 0);
    assert.deepEqual(await applyGrade(dir, story({ preset: "bleach", strength: 0.6 }), path.join(dir, "raw.mp4"), { ffmpeg }), { preset: "bleach", strength: 0.6 });
    assert.match(calls[0].join(" "), /lut3d=file=grade\.cube:interp=tetrahedral/);
    assert.equal(await readFile(path.join(dir, "raw.mp4"), "utf8"), "graded");
    assert.equal(parseCube(await readFile(path.join(dir, GRADE_CUBE_FILE), "utf8")).size, 33);
    await assert.rejects(applyGrade(dir, story({ cube: "missing.cube" }), path.join(dir, "raw.mp4"), { ffmpeg }), /not found/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// LUT agreement: ffmpeg's lut3d over a colour chart lands where the cube says
// (the chart goes through yuv420p, so flat patches are compared at their centres).
test("ffmpeg lut3d grades a colour chart the way the cube samples it", { skip: mediaSkip(), timeout: 60_000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "grade-chart-"));
  try {
    const chart = ["#d23c3c", "#3cb45a", "#3c64d2", "#e6c83c", "#808080", "#f2ede4", "#191714", "#ff6b3d"];
    const inputs = chart.flatMap((hex) => ["-f", "lavfi", "-i", `color=c=${hex}:s=64x64:d=0.1:r=10`]);
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...inputs, "-filter_complex", `hstack=inputs=${chart.length},scale=out_color_matrix=bt709:out_range=tv,format=yuv420p`, "-c:v", "libx264", "-qp", "0", "-colorspace", "bt709", "chart.mp4"], { cwd: dir });
    const pack = story("teal-amber");
    await applyGrade(dir, pack, path.join(dir, "chart.mp4"));
    const raw = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", "chart.mp4", "-frames:v", "1", "-vf", "scale=in_color_matrix=bt709:in_range=tv,format=rgb24", "-f", "rawvideo", "-"], { cwd: dir });
    const cube = presetCube("teal-amber");
    chart.forEach((hex, i) => {
      const at = (32 * 64 * chart.length + i * 64 + 32) * 3;
      const got = [raw[at], raw[at + 1], raw[at + 2]].map((v) => v / 255);
      const want = sampleCube(cube, [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255));
      got.forEach((v, c) => assert.ok(Math.abs(v - want[c]) < 0.03, `${hex} channel ${c}: ${v} vs ${want[c]}`));
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
