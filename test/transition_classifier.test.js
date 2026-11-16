// Transition classifier (docs/PLAN_AND_PACE_RFC.md §4.1, phase 4): synthetic
// grey frames for each basic kind, a letterboxed copy, and the profile stats.
import assert from "node:assert/strict";
import test from "node:test";
import { TRANSITION_TYPES } from "@launchclip/core/transitions.mjs";
import { KIND_TRANSITION_TYPES, TRANSITION_KINDS, TRANSITION_TYPE_KINDS, classifyTransitions, pictureCrop, transitionStats } from "../src/render_motion_analysis.js";

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
