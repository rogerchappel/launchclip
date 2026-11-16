// Transition classifier (docs/PLAN_AND_PACE_RFC.md §4.1, phase 4): synthetic
// grey frames for each basic kind, a letterboxed copy, and the profile stats.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { TRANSITION_TYPES } from "@launchclip/core/transitions.mjs";
import { KIND_TRANSITION_TYPES, TRANSITION_KINDS, TRANSITION_TYPE_KINDS, analyzeTransitionsFile, classifyTransitions, pictureCrop, transitionStats } from "../src/render_motion_analysis.js";
import { getRenderer } from "../src/renderers/index.js";
import { compileStoryCommand } from "../src/story_cli.js";
import { mediaSkip } from "./helpers/media.js";

const W = 96, H = 54, FPS = 30;
// Two textured pictures: diagonal stripes and a checker over a gradient.
const pictureA = (x, y) => 60 + 100 * (((x + y) >> 3) & 1) + x / 3;
const pictureB = (x, y) => 40 + 150 * ((((x >> 4) + (y >> 4)) & 1)) + y;
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));

/** 1 s of A, `frames` of transition (mix(x, y, p) for p 0→1), 1 s of B. */
function clip(mix, frames = 12) {
  const out = [];
  const push = (fn) => { const f = new Uint8Array(W * H); for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) f[y * W + x] = clamp(fn(x, y)); out.push(f); };
  for (let i = 0; i < FPS; i += 1) push(pictureA);
  for (let i = 1; i <= frames; i += 1) push((x, y) => mix(x, y, i / (frames + 1)));
  for (let i = 0; i < FPS; i += 1) push(pictureB);
  return Buffer.concat(out);
}

const kinds = (buffer, width = W, height = H) => classifyTransitions(buffer, width, height, FPS).transitions.map((entry) => entry.kind);

test("a hard cut, a dissolve, a wipe, a push and a dip to black", () => {
  assert.deepEqual(kinds(clip(() => 0, 0)), ["cut"]);
  assert.deepEqual(kinds(clip((x, y, p) => pictureA(x, y) * (1 - p) + pictureB(x, y) * p)), ["dissolve"]);
  const wipe = classifyTransitions(clip((x, y, p) => (x < p * W ? pictureB(x, y) : pictureA(x, y))), W, H, FPS).transitions;
  assert.deepEqual(wipe.map((entry) => [entry.kind, entry.direction]), [["wipe", "right"]]);
  // Content travels left: the new picture enters from the right.
  const push = clip((x, y, p) => { const edge = (1 - p) * W; return x >= edge ? pictureB(x - edge, y) : pictureA(x + p * W, y); });
  assert.deepEqual(classifyTransitions(push, W, H, FPS).transitions.map((entry) => [entry.kind, entry.direction]), [["push", "left"]]);
  const dip = classifyTransitions(clip((x, y, p) => (p < 0.5 ? pictureA(x, y) * (1 - 2 * p) : pictureB(x, y) * (2 * p - 1)) + 8), W, H, FPS).transitions;
  assert.deepEqual(dip.map((entry) => [entry.kind, entry.via]), [["dip", "black"]]);
});

test("a letterboxed copy is cropped and classified the same", () => {
  const source = clip((x, y, p) => (x < p * W ? pictureB(x, y) : pictureA(x, y)));
  const BW = W, BH = 120, top = 33;
  const frames = source.length / (W * H);
  const boxed = Buffer.alloc(frames * BW * BH);
  for (let f = 0; f < frames; f += 1) for (let y = 0; y < H; y += 1) source.copy(boxed, f * BW * BH + (y + top) * BW, f * W * H + y * W, f * W * H + (y + 1) * W);
  assert.deepEqual(pictureCrop(boxed, BW, BH), { x: 0, y: top, width: W, height: H });
  const result = classifyTransitions(boxed, BW, BH, FPS);
  assert.deepEqual(result.transitions.map((entry) => [entry.kind, entry.direction]), [["wipe", "right"]]);
});

test("a held picture and a slow pan are not transitions", () => {
  const frames = (fn, count) => Buffer.concat(Array.from({ length: count }, (_, i) => { const f = new Uint8Array(W * H); for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) f[y * W + x] = clamp(fn(x, y, i)); return f; }));
  assert.deepEqual(kinds(frames((x, y) => pictureA(x, y), 2 * FPS)), []);
  // A smooth picture panning 1 px a frame for 3 s.
  const smooth = (x, y) => 128 + 60 * Math.sin(x / 9) * Math.cos(y / 7);
  assert.deepEqual(kinds(frames((x, y, i) => smooth(x + i, y), 3 * FPS)), []);
});

test("every transition type maps to a kind, and every kind back to types", () => {
  assert.deepEqual(Object.keys(TRANSITION_TYPE_KINDS).sort(), [...TRANSITION_TYPES].sort());
  for (const kind of Object.values(TRANSITION_TYPE_KINDS)) if (kind !== null) assert.ok(TRANSITION_KINDS.includes(kind), kind);
  assert.deepEqual(Object.keys(KIND_TRANSITION_TYPES).sort(), [...TRANSITION_KINDS].sort());
  for (const types of Object.values(KIND_TRANSITION_TYPES)) for (const type of types) assert.ok(TRANSITION_TYPES.includes(type), type);
});

test("transition stats: rate, mix and the median span without cuts", () => {
  const stats = transitionStats([{ kind: "cut", seconds: 0 }, { kind: "dissolve", seconds: 0.4 }, { kind: "dissolve", seconds: 0.6 }, { kind: "push", seconds: 0.3 }], 30);
  assert.deepEqual(stats, { transitions_per_min: 8, transition_mix: { dissolve: 0.5, cut: 0.25, push: 0.25 }, transition_seconds: 0.4 });
  assert.deepEqual(transitionStats([], 10), { transitions_per_min: 0, transition_mix: {}, transition_seconds: null });
});

// The RFC's test: every TRANSITION_TYPE (but overview, which needs a
// chapter) between two footage stills, rendered by both renderers at
// 360×640; the measured kinds must match TRANSITION_TYPE_KINDS for at least
// 85% of them, and a letterboxed copy of each render must read the same.
test("both renderers: every transition type is classified, letterboxed copies agree", { skip: mediaSkip(), timeout: 900_000 }, async (t) => {
  const run = promisify(execFile);
  const source = path.resolve(import.meta.dirname, "../examples/story/footage-transitions-9x16");
  const work = await mkdtemp(path.join(os.tmpdir(), "launchclip-transitions-"));
  try {
    const base = JSON.parse(await readFile(path.join(source, "storyboard.json"), "utf8"));
    const types = TRANSITION_TYPES.filter((type) => TRANSITION_TYPE_KINDS[type] !== null);
    const seg = 1.6, media = ["assets/shots/ridge.svg", "assets/shots/boards.svg"];
    const scene = (i, extra) => ({ id: `s${i}`, module: "clip", start: +(i * seg).toFixed(3), end: +((i + 1) * seg).toFixed(3), energy: 1, ...extra, params: { media: media[i % 2], focus: { x: 0.5, y: 0.5 }, move: "none" } });
    const { camera, ...story } = base;
    // vfx.words "pixel" lets pixel-dissolve (retro only) validate.
    Object.assign(story, { title: "Every transition", vfx: { words: "pixel" }, format: { ...base.format, width: 360, height: 640, duration: +((types.length + 1) * seg).toFixed(3) },
      scenes: [scene(0, {}), ...types.map((type, i) => scene(i + 1, { in: { type, dur: 0.5 } }))] });
    const measured = {};
    for (const name of ["hyperframes", "remotion"]) {
      const project = path.join(work, name);
      await cp(path.join(source, "assets"), path.join(project, "assets"), { recursive: true });
      await writeFile(path.join(project, "storyboard.json"), JSON.stringify(story));
      await compileStoryCommand(project, { renderer: name, ...(name === "hyperframes" ? { out: path.join(project, "hyperframes") } : {}) });
      const video = path.join(work, `${name}.mp4`), boxed = path.join(work, `${name}-boxed.mp4`);
      await getRenderer(name).render(name === "hyperframes" ? path.join(project, "hyperframes") : project, video, { quality: "draft" });
      // Pillarboxed into 16:9 and letterboxed with bars on all sides.
      await run("ffmpeg", ["-v", "error", "-i", video, "-vf", name === "hyperframes" ? "pad=1138:640:389:0:black" : "pad=480:900:60:130:black", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-y", boxed]);
      for (const [key, file] of [[name, video], [`${name}-boxed`, boxed]]) {
        const { transitions } = await analyzeTransitionsFile(file);
        // The measured transition overlapping each planned one.
        measured[key] = types.map((type, i) => { const at = (i + 1) * seg; return transitions.find((entry) => entry.start - 0.15 <= at + 0.5 && entry.end + 0.15 >= at)?.kind ?? "missed"; });
      }
    }
    for (const name of ["hyperframes", "remotion"]) {
      const right = types.filter((type, i) => measured[name][i] === TRANSITION_TYPE_KINDS[type]);
      t.diagnostic(`${name}: ${right.length}/${types.length} right; misses: ${types.filter((type) => !right.includes(type)).map((type) => `${type} → ${measured[name][types.indexOf(type)]}`).join(", ") || "none"}`);
      assert.ok(right.length >= 0.85 * types.length, `${name}: ${right.length}/${types.length}`);
      assert.deepEqual(measured[`${name}-boxed`], measured[name], `${name}: the letterboxed copy reads the same`);
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test("a measured transition mix sets the style's transition preference", async () => {
  const { grammarFromPacing } = await import("../src/style_reference.js");
  const guessed = grammarFromPacing({ median_shot_seconds: 2.4 }, { activity: 0.3 });
  assert.deepEqual(guessed.transitions, ["push", "fade"]);
  const measured = grammarFromPacing({ median_shot_seconds: 2.4, transition_mix: { dissolve: 0.5, iris: 0.3, other: 0.15, wipe: 0.05 } }, { activity: 0.3 });
  assert.equal(measured.grammar, guessed.grammar);
  assert.deepEqual(measured.transitions, ["fade", "iris"]);
  assert.match(measured.reason, /dissolve 50%, iris 30%/);
});
