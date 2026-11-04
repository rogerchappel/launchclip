import assert from "node:assert/strict";
import test from "node:test";
import { durationErrors, fitDurations } from "../src/duration_fit.js";

const format = { width: 1080, height: 1920, fps: 30, duration: 20 };
const short = (index, id, module, min, got) => `params: scenes[${index}] (${id}): module "${module}" params: ${id} (${module}): duration must be between ${min} and 3600, got ${got}`;
const scene = (id, module, start, end, extra = {}) => ({ id, module, start, end, params: {}, ...extra });

test("only scene-length errors below the minimum are read", () => {
  assert.deepEqual(durationErrors([short(1, "a", "clip", 1, 0.98), "params: scenes[0] (x): params.at must fall between 0.5 s and 1 s after the scene start; got 0.2 s", "layout: something"]), [{ scene: 1, min: 1, max: 3600, got: 0.98 }]);
  assert.deepEqual(durationErrors(['params: scenes[0] (s1): module "hook-title" params: hook-title: hook-title needs a scene of at least 1.5 s']), [{ scene: 0, min: 1.5, max: null, got: null }]);
});

test("a short shot grows into the gap after it, and the planner's copy is untouched", () => {
  const storyboard = { format, scenes: [scene("title", "hook-title", 0, 2), scene("deck", "clip", 3, 3.98), scene("photo", "photo-scene", 6, 9)] };
  const { storyboard: fitted, changed } = fitDurations(storyboard, [short(1, "deck", "clip", 1, 0.98)]);
  assert.equal(fitted.scenes[1].start, 3);
  assert.equal(fitted.scenes[1].end, 4.01);
  assert.deepEqual(changed, ["deck lengthened 0.98 → 1.01 s"]);
  assert.equal(storyboard.scenes[1].end, 3.98);
});

test("with no gap, it takes time from the next scene while that one keeps its own minimum", () => {
  const storyboard = { format, scenes: [scene("a", "photo-scene", 0, 1.29), scene("b", "photo-scene", 1.29, 5)] };
  const { storyboard: fitted } = fitDurations(storyboard, [short(0, "a", "photo-scene", 2, 1.29)]);
  assert.equal(fitted.scenes[0].end, 2.01);
  assert.equal(fitted.scenes[1].start, 2.01);
  assert.equal(fitted.scenes[1].end, 5);
});

test("anchored times are written back as seconds, and other tracks are not neighbours", () => {
  const words = [{ text: "hardwood", start: 4, end: 4.6 }, { text: "lasts", start: 4.6, end: 5.29 }, { text: "longest", start: 5.3, end: 6 }];
  const storyboard = { format, scenes: [scene("h", "photo-scene", "word:hardwood", "word:lasts+0.69"), scene("lt", "lower-third", 5.29, 9, { track: 1 }), scene("next", "clip", 6.5, 9)] };
  const { storyboard: fitted } = fitDurations(storyboard, [short(0, "h", "photo-scene", 2, 1.29)], { words });
  assert.equal(fitted.scenes[0].start, 4);
  assert.equal(fitted.scenes[0].end, 6.01);
  assert.equal(fitted.scenes[1].start, 5.29);
});

test("a run of short photos with no room merges into the same-module neighbour, and the map follows", () => {
  const storyboard = {
    format: { ...format, duration: 3.74 },
    scenes: [scene("hardwood", "photo-scene", 0, 1.29), scene("pine", "photo-scene", 1.29, 2.49), scene("composite", "photo-scene", 2.49, 3.74)]
  };
  const direction = { lines: [{ words: [0, 1], treatment: "insert", scenes: ["hardwood"] }, { words: [2, 3], treatment: "insert", scenes: ["pine"] }, { words: [4, 5], treatment: "insert", scenes: ["composite"] }] };
  const errors = [short(0, "hardwood", "photo-scene", 2, 1.29), short(1, "pine", "photo-scene", 2, 1.2), short(2, "composite", "photo-scene", 2, 1.25)];
  const { storyboard: fitted, direction: map, changed } = fitDurations(storyboard, errors, { direction });
  for (const kept of fitted.scenes) assert.ok(kept.end - kept.start >= 2, `${kept.id} is ${kept.end - kept.start} s`);
  assert.equal(fitted.scenes.at(-1).end, 3.74);
  assert.ok(changed.some((line) => line.includes("merged into")));
  const ids = new Set(fitted.scenes.map((kept) => kept.id));
  for (const line of map.lines) for (const id of line.scenes) assert.ok(ids.has(id), `map names ${id}`);
});

test("a lone short shot with no room and no neighbour is dropped", () => {
  const storyboard = { format: { ...format, duration: 1.2 }, scenes: [scene("only", "photo-scene", 0, 1.2)] };
  const { storyboard: fitted, changed } = fitDurations(storyboard, [short(0, "only", "photo-scene", 2, 1.2)]);
  assert.equal(fitted.scenes.length, 0);
  assert.deepEqual(changed, ["only (1.2 s, no room) dropped"]);
});

test("nothing short, nothing changed", () => {
  const storyboard = { format, scenes: [scene("a", "clip", 0, 3)] };
  const result = fitDurations(storyboard, ["layout: overlap"]);
  assert.equal(result.storyboard, storyboard);
  assert.deepEqual(result.changed, []);
});
