import assert from "node:assert/strict";
import test from "node:test";
import { fitTimings, timingErrors, unfittableCallouts } from "../src/timing_fit.js";

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
