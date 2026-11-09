import assert from "node:assert/strict";
import test from "node:test";
import { resolveStory } from "@launchclip/core/story.mjs";
import { resolveModule } from "@launchclip/core/modules.mjs";
import { fitSceneTimings, fitTimings, timingErrors, unfittableCallouts } from "../src/timing_fit.js";

const ERROR = 'params: scenes[3] (six-in-ten): module "unit-grid" params: six-in-ten (unit-grid): params.at must fall between 0.5 s and 1.37 s after the scene start; got 0.28 s';

test("an explicit time outside its window moves to the nearest edge, and the planner's copy is untouched", () => {
  const storyboard = { scenes: [{}, {}, {}, { id: "six-in-ten", module: "unit-grid", params: { at: 0.28, count: 10 } }] };
  const { storyboard: fitted, moved } = fitTimings(storyboard, [ERROR, "something else"]);
  assert.equal(fitted.scenes[3].params.at, 0.51);
  assert.deepEqual(moved, ["six-in-ten params.at 0.28 → 0.51 s"]);
  assert.equal(storyboard.scenes[3].params.at, 0.28);
  const nested = { scenes: [{ id: "q", params: { stamp: { at: 9 } } }] };
  const late = fitTimings(nested, ['params: scenes[0] (q): module "quote-card" params: q (quote-card): params.stamp.at must fall between 0.5 s and 4.35 s after the scene start; got 9 s']);
  assert.equal(late.storyboard.scenes[0].params.stamp.at, 4.34);
});

test("a default time, an empty window or a missing param is not tooling's to move", () => {
  assert.deepEqual(timingErrors(['params: scenes[0] (x): params.highlightAt must fall between 1.44 s and 1.36 s after the scene start; got 1.44 s']), []);
  const storyboard = { scenes: [{ id: "x", params: {} }] };
  assert.deepEqual(fitTimings(storyboard, ['params: scenes[0] (x): params.at must fall between 0.5 s and 1 s after the scene start; got 0.2 s']).moved, []);
  assert.deepEqual(fitTimings(storyboard, ['params: scenes[0] (x): tail_zoom.at (default for "tail-zoom") must fall between 0.5 s and 1 s after the scene start; got 2 s']).moved, []);
});

test("a callout the scene is too short to show is dropped, and the rest of the scene stays", () => {
  const short = (i, max) => `params: scenes[${i}] (s${i}): module "clip" params: s${i} (clip): params.callouts[0].at must fall between 0 s and ${max} s after the scene start; got 0 s`;
  const storyboard = { scenes: [
    { id: "s0", module: "clip", params: { media: "a.mp4", callouts: [{ text: "Hardwood", at: 0 }] } },
    { id: "s1", module: "clip", params: { media: "b.mp4", callouts: ["Pine", "Composite"] } }
  ] };
  const errors = [short(0, -0.33), short(1, -0.09), short(1, -0.09)];
  assert.deepEqual(unfittableCallouts(errors), [{ scene: 0, index: 0 }, { scene: 1, index: 0 }]);
  const { storyboard: fitted, moved } = fitTimings(storyboard, errors);
  assert.equal(fitted.scenes[0].params.callouts, undefined);
  assert.equal(fitted.scenes[0].params.media, "a.mp4");
  assert.deepEqual(fitted.scenes[1].params.callouts, ["Composite"]);
  assert.equal(moved.length, 2);
  assert.match(moved[0], /s1 params\.callouts\[0\] dropped \("Pine"\)/);
  assert.equal(storyboard.scenes[0].params.callouts.length, 1);
  // Any other empty window is still not tooling's to touch.
  assert.deepEqual(unfittableCallouts(['params: scenes[0] (x): params.highlightAt must fall between 1.44 s and 1.36 s after the scene start; got 1.44 s']), []);
});

// fitSceneTimings: finish's repair, once the real narration has settled each
// scene's window. The window comes from the module's error (error.timing).
function diagramStory(end, lines) {
  return {
    schema: "launchclip.story.v1",
    lane: "motion",
    format: { width: 1080, height: 1920, fps: 30, duration: end + 3 },
    brand: { colors: { bg: "#06070d", primary: "#fdb022", accent: "#46d4ff", ink: "#06070d", paper: "#f2eee6" } },
    // A scene after it, so the diagram's window is its own (a last scene runs on).
    scenes: [
      { id: "hardwood-detail", module: "line-diagram", start: 0, end, params: { title: "Planned roof", points: { a: [0, 30], b: [50, 0], c: [100, 30], d: [100, 60], e: [0, 60] }, lines } },
      { id: "after", module: "line-diagram", start: end, end: end + 3, params: { title: "Deck", points: { a: [0, 0], b: [50, 0] }, lines: [{ from: "a", to: "b" }] } }
    ]
  };
}
const ROOF = [["e", "a"], ["d", "c"], ["a", "b"], ["b", "c"], ["e", "d"]];

test("a line time planned for a longer scene moves into the settled window, read from the module's error", () => {
  const lines = ROOF.map(([from, to], i) => ({ from, to, at: [0.6, 0.9, 1.2, 1.5, 2.8][i] }));
  const story = diagramStory(4, lines);
  const resolved = resolveStory(structuredClone(story));
  let caught = null;
  try { resolveModule(resolved.scenes[0], resolved); } catch (error) { caught = error; }
  assert.ok(caught, "the planned time fails the shortened scene");
  assert.deepEqual(Object.keys(caught.timing).sort(), ["explicit", "got", "max", "min", "path"]);
  assert.equal(caught.timing.path, "params.lines[4].at");
  assert.equal(caught.timing.explicit, true);

  const { storyboard, moved } = fitSceneTimings(story, resolved);
  assert.deepEqual(moved, [`hardwood-detail params.lines[4].at 2.8 → ${Math.round((caught.timing.max - 0.01) * 100) / 100} s`]);
  const again = resolveStory(structuredClone(storyboard));
  assert.doesNotThrow(() => resolveModule(again.scenes[0], again));
  assert.deepEqual(storyboard.scenes[0].params.lines.slice(0, 4).map((line) => line.at), [0.6, 0.9, 1.2, 1.5], "times already inside stay");
  assert.equal(story.scenes[0].params.lines[4].at, 2.8, "the input is not mutated");
  // A scene that resolves is left as it is.
  assert.deepEqual(fitSceneTimings(storyboard, again).moved, []);
});

test("every bad time in a scene is fixed, one per module error", () => {
  const lines = ROOF.map(([from, to], i) => ({ from, to, at: [0.6, 0.9, 1.2, 2.7, 2.8][i] }));
  const story = diagramStory(3, lines);
  const { storyboard, moved } = fitSceneTimings(story, resolveStory(structuredClone(story)));
  assert.ok(moved.length >= 2, moved.join("; "));
  const again = resolveStory(structuredClone(storyboard));
  assert.doesNotThrow(() => resolveModule(again.scenes[0], again));
});

test("a default time, an empty window or a non-numeric time is left for the checks to report", () => {
  const story = { scenes: [{ id: "a", module: "x", params: { at: 3 } }, { id: "b", module: "x", params: { at: 3 } }, { id: "c", module: "x", params: { at: "beat:2" } }, { id: "d", module: "x", params: { size: 3 } }] };
  const timings = {
    a: { path: "params.at", min: 0.5, max: 2, got: 3, explicit: false },
    b: { path: "params.at", min: 2, max: 1, got: 3, explicit: true },
    c: { path: "params.at", min: 0.5, max: 2, got: 3, explicit: true }
  };
  const resolve = (scene) => {
    if (scene.id === "d") throw new Error("params.size must be between 0 and 1");
    throw Object.assign(new Error("bad time"), { timing: timings[scene.id] });
  };
  const result = fitSceneTimings(story, structuredClone(story), { resolve });
  assert.deepEqual(result.moved, []);
  assert.equal(result.storyboard, story);
});
