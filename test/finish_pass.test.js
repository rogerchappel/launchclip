// The finishing chain (docs/FINISHING_AND_ELEMENTS_RFC.md §E.1): story.finish
// validation and planning (kit/core/finish.mjs), and the GL pass itself
// (src/finish_pass.js) as a media test: seek purity, the protect mask,
// identity at zero and LUT agreement with ffmpeg lut3d.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FINISH_PASS_NAMES, activeRects, finishParams, finishTimes, protectRects, resolveFinish } from "@launchclip/core/finish.mjs";
import { STORY_FINISH_PASSES, validateStory } from "@launchclip/core/story.mjs";
import { cubeText, gradeErrors, mixCube, presetCube, resolveGrade, tintPreset, GRADE_PRESETS } from "@launchclip/core/grade.mjs";
import { FINISH_SHADER_PASSES } from "../src/finish_shaders.js";
import { finishChain, runFinishPass } from "../src/finish_pass.js";

const media = process.env.LAUNCHCLIP_MEDIA_TESTS ? false : "media test: run with npm run test:media (LAUNCHCLIP_MEDIA_TESTS=1)";
const base = { format: { width: 1080, height: 1920, fps: 30, duration: 4 }, scenes: [{ id: "a", module: "hook-title", start: 0, end: 4, params: { title: "Hi" } }] };
const errorsOf = (finish) => validateStory({ ...base, finish }).errors.filter((line) => line.startsWith("finish"));

test("every finish pass has a shader, in the table's chain order", () => {
  assert.deepEqual([...FINISH_SHADER_PASSES].sort(), [...FINISH_PASS_NAMES].sort());
  assert.deepEqual(FINISH_PASS_NAMES, Object.keys(STORY_FINISH_PASSES));
});

test("story.finish validation", () => {
  assert.deepEqual(errorsOf([{ pass: "grain", amount: 0.1 }, { pass: "aberration" }, { pass: "grade", preset: "bleach", tint: "#ff8800" }]), []);
  assert.match(errorsOf({ pass: "grain" })[0], /or a list of \{pass/);
  assert.match(errorsOf([{ pass: "sparkle" }])[0], /pass must be one of/);
  assert.match(errorsOf([{ pass: "grain" }, { pass: "grain" }])[0], /listed twice/);
  assert.match(errorsOf([{ pass: "grain", amount: 2 }])[0], /amount must be a number from 0 to 1/);
  assert.match(errorsOf([{ pass: "grain", mono: "yes" }])[0], /mono must be true or false/);
  assert.match(errorsOf([{ pass: "aberration", glow: 1 }])[0], /not a aberration param/);
  assert.match(errorsOf([{ pass: "grade" }])[0], /needs a preset or a cube/);
  assert.match(errorsOf(Array.from({ length: 9 }, () => ({ pass: "grain" })))[0], /at most 8/);
});

test("story.finish validation: colours, choices, points and hit times", () => {
  assert.deepEqual(errorsOf([{ pass: "bloom", tint: "#ffeecc" }, { pass: "zoom-blur", centre: [0.3, 0.7], at: [1, 2.5] }, { pass: "burn", at: "cuts" }, { pass: "crt", powerOn: true }, { pass: "halftone", mode: "duotone" }]), []);
  assert.match(errorsOf([{ pass: "bloom", tint: "white" }])[0], /#rrggbb/);
  assert.match(errorsOf([{ pass: "halftone", mode: "stipple" }])[0], /one of dot, line, duotone/);
  assert.match(errorsOf([{ pass: "zoom-blur", centre: [0.5, 2] }])[0], /\[x, y\]/);
  assert.match(errorsOf([{ pass: "burn", at: [-1] }])[0], /"cuts" or up to 32 times/);
  assert.match(errorsOf([{ pass: "burn", at: Array(33).fill(1) }])[0], /up to 32/);
});

test("hit times: a list as given, or the track-0 cuts", () => {
  const story = { scenes: [{ start: 0 }, { start: 3 }, { start: 3, track: 1 }, { start: 1.5, track: 1 }, { start: 6 }] };
  assert.deepEqual(finishTimes(story, "cuts"), [3, 6]);
  assert.deepEqual(finishTimes(story, [2, 1]), [1, 2]);
  assert.deepEqual(resolveFinish({ ...story, finish: [{ pass: "burn" }] })[0].params.at, [3, 6]);
  assert.deepEqual(resolveFinish({ ...story, finish: [{ pass: "zoom-blur" }] })[0].params.at, []);
  assert.deepEqual(finishParams("halftone").mode, "dot");
  assert.deepEqual(finishParams("zoom-blur").centre, [0.5, 0.5]);
});

test("the finish is off unless a story lists a shader pass", () => {
  assert.equal(resolveFinish(base), null);
  assert.equal(resolveFinish({ ...base, grade: "bleach" }), null);
  assert.equal(resolveFinish({ ...base, finish: [{ pass: "grade", preset: "bleach" }] }), null);
  assert.equal(resolveFinish({ ...base, finish: [] }), null);
});

test("the chain runs in table order with defaults, and the grade joins it", () => {
  const chain = resolveFinish({ ...base, grade: "warm-film", finish: [{ pass: "grain", amount: 0.2 }, { pass: "aberration" }] });
  assert.deepEqual(chain.map((entry) => entry.pass), ["aberration", "grade", "grain"]);
  assert.deepEqual(chain[0].params, finishParams("aberration"));
  assert.equal(chain[1].params, "warm-film");
  assert.deepEqual(chain[2].params, { ...finishParams("grain"), amount: 0.2 });
  // A {pass: "grade"} entry wins over story.grade; "off" leaves it out.
  assert.deepEqual(resolveFinish({ ...base, grade: "warm-film", finish: [{ pass: "grain" }, { pass: "grade", preset: "bleach" }] })[0].params, { preset: "bleach" });
  assert.deepEqual(resolveFinish({ ...base, grade: "off", finish: [{ pass: "grain" }] }).map((entry) => entry.pass), ["grain"]);
});

test("a finish look adds its passes; the story's own entries win, pass by pass", () => {
  assert.deepEqual(resolveFinish({ ...base, look: "stained-glass" }).map((entry) => entry.pass), ["stained-glass", "bloom"]);
  assert.deepEqual(resolveFinish({ ...base, look: { name: "silkscreen" } }).map((entry) => entry.pass), ["silkscreen", "grain"]);
  const own = resolveFinish({ ...base, look: "silkscreen", finish: [{ pass: "grain", amount: 0.3 }, { pass: "aberration" }] });
  assert.deepEqual(own.map((entry) => entry.pass), ["silkscreen", "aberration", "grain"]);
  assert.equal(own.at(-1).params.amount, 0.3);
  assert.equal(resolveFinish({ ...base, look: "hologram" }), null, "an SVG look adds no pass");
});

test("stained glass and silkscreen compile, change the frame and are seek-pure", { skip: media, timeout: 120_000 }, async (t) => {
  const dir = await scratch(t);
  for (const pass of ["stained-glass", "silkscreen"]) {
    const chain = resolveFinish({ finish: [{ pass, ...(pass === "stained-glass" ? { cell: 16 } : { cell: 4 }) }] });
    await runFinishPass({ input: path.join(dir, "in%03d.png"), output: path.join(dir, `${pass}%03d.png`), chain, width: W, height: H, fps: 30, kind: "image" });
    await runFinishPass({ input: path.join(dir, "in005.png"), output: path.join(dir, `${pass}-alone.png`), chain, width: W, height: H, fps: 30, frameStart: 4, kind: "image" });
    assert.ok(rgbOf(path.join(dir, `${pass}004.png`)).equals(rgbOf(path.join(dir, `${pass}-alone.png`))), `${pass}: frame 4 differs between the sequence and a seek`);
    assert.ok(!rgbOf(path.join(dir, `${pass}004.png`)).equals(rgbOf(path.join(dir, "in005.png"))), `${pass} changed nothing`);
  }
});

test("protect rects: the caption band while a caption shows, the brand frame while it shows", () => {
  const captionRect = { x: 0, y: 1400, width: 1080, height: 200 };
  const rects = protectRects(base, { captions: [[0.5, 1.5], [2, 3]], captionRect });
  assert.equal(rects.length, 2);
  assert.deepEqual(activeRects(rects, 1), [{ ...captionRect, start: 0.5, end: 1.5 }]);
  assert.deepEqual(activeRects(rects, 1.7), []);
  const framed = protectRects({ ...base, frame: { kicker: { label: "LAB", position: "top-left" } } }, { captions: [[0, 1]], captionRect });
  assert.ok(framed.some((r) => r.start === 0 && r.end === 4 && r.y < 300), "the kicker's rect protects for the whole video");
});

test("grade tint: a brand hue turns the split tone, a .cube cannot take one", () => {
  assert.deepEqual(gradeErrors({ preset: "teal-amber", tint: "brand" }), []);
  assert.match(gradeErrors({ cube: "a.cube", tint: "#ff0000" }).join(), /re-tints a preset/);
  assert.equal(resolveGrade({ grade: { preset: "clean", tint: "brand" }, brand: { colors: { accent: "#3366ff" } } }).tint, "#3366ff");
  assert.equal(resolveGrade({ grade: { preset: "clean", tint: "brand" } }).tint, undefined);
  const tinted = tintPreset(GRADE_PRESETS["teal-amber"], "#3366ff");
  // Same strength, the highlight along the tint's hue (blue: b < 0), the shadow opposite.
  assert.ok(Math.abs(Math.hypot(...tinted.highlight) - Math.hypot(...GRADE_PRESETS["teal-amber"].highlight)) < 1e-9);
  assert.ok(tinted.highlight[1] < 0 && tinted.shadow[1] > 0);
  assert.ok(tintPreset(GRADE_PRESETS.clean, "#3366ff").highlight, "a preset with no tint gets a light one");
});

// --- the GL pass ------------------------------------------------------------

const ffmpeg = (args, input) => {
  const out = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { input, maxBuffer: 1 << 28 });
  if (out.status !== 0) throw new Error(String(out.stderr));
  return out.stdout;
};
const rgbOf = (file) => ffmpeg(["-i", file, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]);
const W = 96, H = 160;

async function scratch(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-finish-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  // Eight frames of a moving test pattern as lossless PNGs.
  ffmpeg(["-f", "lavfi", "-i", `testsrc2=size=${W}x${H}:rate=30:duration=0.27`, "-frames:v", "8", path.join(dir, "in%03d.png")]);
  return dir;
}

test("seek purity: frame N alone equals frame N in a sequence (grain, aberration)", { skip: media, timeout: 120_000 }, async (t) => {
  const dir = await scratch(t);
  const chain = resolveFinish({ finish: [{ pass: "grain", amount: 0.4, size: 2 }, { pass: "aberration", px: 3 }] });
  await runFinishPass({ input: path.join(dir, "in%03d.png"), output: path.join(dir, "seq%03d.png"), chain, width: W, height: H, fps: 30, kind: "image" });
  await runFinishPass({ input: path.join(dir, "in005.png"), output: path.join(dir, "alone.png"), chain, width: W, height: H, fps: 30, frameStart: 4, kind: "image" });
  assert.ok(rgbOf(path.join(dir, "seq004.png")).equals(rgbOf(path.join(dir, "alone.png"))), "frame 4 differs between the sequence and a seek");
  assert.ok(!rgbOf(path.join(dir, "seq004.png")).equals(rgbOf(path.join(dir, "seq003.png"))), "grain is a fresh field each frame");
});

test("segment seam: burn and zoom-blur hits land on the same frames when finished in pieces", { skip: media, timeout: 120_000 }, async (t) => {
  const dir = await scratch(t);
  // Hits inside the clip: 0.1 s is frame 3 of 8.
  const chain = resolveFinish({ finish: [{ pass: "zoom-blur", amount: 0.3, at: [0.1] }, { pass: "burn", at: [0.1], frames: 8 }] });
  await runFinishPass({ input: path.join(dir, "in%03d.png"), output: path.join(dir, "seq%03d.png"), chain, width: W, height: H, fps: 30, kind: "image" });
  // The second half alone, as a segment render starting at frame 4.
  for (const n of [5, 6, 7, 8]) await (await import("node:fs/promises")).copyFile(path.join(dir, `in${String(n).padStart(3, "0")}.png`), path.join(dir, `tail${String(n - 4).padStart(3, "0")}.png`));
  await runFinishPass({ input: path.join(dir, "tail%03d.png"), output: path.join(dir, "part%03d.png"), chain, width: W, height: H, fps: 30, frameStart: 4, kind: "image" });
  for (const n of [4, 5, 6, 7]) assert.ok(rgbOf(path.join(dir, `seq${String(n).padStart(3, "0")}.png`)).equals(rgbOf(path.join(dir, `part${String(n).padStart(3, "0")}.png`))), `frame ${n} differs across the seam`);
  assert.ok(!rgbOf(path.join(dir, "seq003.png")).equals(rgbOf(path.join(dir, "in004.png"))), "the hit frame is untouched");
});

test("strength 0 is identity, and the protect mask leaves caption pixels unchanged", { skip: media, timeout: 120_000 }, async (t) => {
  const dir = await scratch(t);
  const input = path.join(dir, "in001.png");
  const zero = await finishChain(dir, {}, resolveFinish({ grade: { preset: "bleach", strength: 0 }, finish: [{ pass: "grain", amount: 0 }] }));
  await runFinishPass({ input, output: path.join(dir, "zero.png"), ...zero, width: W, height: H, fps: 30, kind: "image" });
  assert.ok(rgbOf(path.join(dir, "zero.png")).equals(rgbOf(input)));

  const rect = { x: 0, y: 100, width: W, height: 40, start: 0, end: 1 };
  const chain = resolveFinish({ finish: [{ pass: "grain", amount: 1 }, { pass: "aberration", px: 4, falloff: 0 }] });
  await runFinishPass({ input, output: path.join(dir, "masked.png"), chain, width: W, height: H, fps: 30, rects: [rect], kind: "image" });
  const a = rgbOf(input), b = rgbOf(path.join(dir, "masked.png"));
  let inside = 0, outside = 0;
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const i = (y * W + x) * 3, diff = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    if (y >= rect.y && y < rect.y + rect.height) inside = Math.max(inside, diff);
    else if (y < rect.y - 12 || y >= rect.y + rect.height + 12) outside += diff;
  }
  assert.equal(inside, 0, "a caption pixel changed");
  assert.ok(outside > 0, "the passes did nothing outside the mask");
});

// CIEDE2000 between two sRGB 0–255 colours (Sharma, Wu and Dalal 2005).
function deltaE2000(c1, c2) {
  const lab = (rgb) => {
    const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    const [x, y, z] = [(0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, 0.2126 * r + 0.7152 * g + 0.0722 * b, (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883].map(f);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  };
  const [L1, a1, b1] = lab(c1), [L2, a2, b2] = lab(c2);
  const rad = Math.PI / 180, Cbar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const ap1 = a1 * (1 + G), ap2 = a2 * (1 + G), C1 = Math.hypot(ap1, b1), C2 = Math.hypot(ap2, b2);
  const h = (b, a) => { const v = Math.atan2(b, a) / rad; return v < 0 ? v + 360 : v; };
  const h1 = h(b1, ap1), h2 = h(b2, ap2);
  let dh = h2 - h1; if (C1 * C2 === 0) dh = 0; else if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
  const dL = L2 - L1, dC = C2 - C1, dH = 2 * Math.sqrt(C1 * C2) * Math.sin((dh / 2) * rad);
  const Lb = (L1 + L2) / 2, Cb = (C1 + C2) / 2;
  let hb = h1 + h2; if (C1 * C2 !== 0) hb = Math.abs(h1 - h2) > 180 ? (h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2) : (h1 + h2) / 2;
  const T = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad) + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.2 * Math.cos((4 * hb - 63) * rad);
  const SL = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2), SC = 1 + 0.045 * Cb, SH = 1 + 0.015 * Cb * T;
  const RT = -2 * Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hb - 275) / 25) ** 2)) * rad);
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}

test("LUT agreement: the GL grade matches ffmpeg lut3d within ΔE2000 1 on a colour chart", { skip: media, timeout: 120_000 }, async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-finish-lut-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  // 64×64 chart: a grey ramp row and seeded colours.
  const size = 64, chart = Buffer.alloc(size * size * 3);
  let seed = 7;
  for (let i = 0; i < size * size; i += 1) for (let c = 0; c < 3; c += 1) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    chart[i * 3 + c] = i < size ? Math.round((i / (size - 1)) * 255) : seed >>> 24;
  }
  const input = path.join(dir, "chart.png");
  ffmpeg(["-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${size}x${size}`, "-i", "pipe:0", input], chart);
  for (const preset of ["teal-amber", "neon-crush", "ink-mono"]) {
    const cube = mixCube(presetCube(preset), 0.8);
    await writeFile(path.join(dir, "grade.cube"), cubeText(cube));
    const reference = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", input, "-vf", "format=rgb24,lut3d=file=grade.cube:interp=tetrahedral", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { cwd: dir, maxBuffer: 1 << 24 }).stdout;
    await runFinishPass({ input, output: path.join(dir, `${preset}.png`), chain: [{ pass: "grade", params: preset }], cube, width: size, height: size, fps: 30, kind: "image" });
    const ours = rgbOf(path.join(dir, `${preset}.png`));
    let worst = 0;
    for (let i = 0; i < size * size; i += 1) worst = Math.max(worst, deltaE2000([...reference.subarray(i * 3, i * 3 + 3)], [...ours.subarray(i * 3, i * 3 + 3)]));
    assert.ok(worst < 1, `${preset}: worst ΔE2000 ${worst.toFixed(3)}`);
  }
});
