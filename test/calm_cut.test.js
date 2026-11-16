import assert from "node:assert/strict";
import test from "node:test";
import { CALM_CUT, calmCut, cutMotionScore, motionEnergy, smoothCurve } from "@launchclip/core/calm-cut.mjs";

// A synthetic motion curve at 12 fps over 10 s: busy everywhere (energy 10)
// except a calm trough at 4.5–5 s (energy 1).
function curve() {
  const values = Array.from({ length: 121 }, (_, i) => (i / 12 >= 4.5 && i / 12 <= 5 ? 1 : 10));
  return { fps: 12, values };
}

test("calmCut picks the trough near the wanted cut", () => {
  const cut = calmCut(curve(), { target: 5.4, step: 4 });
  assert.equal(cut.tag, "calm");
  assert.ok(cut.at >= 4.5 && cut.at <= 5, `cut at ${cut.at}`);
  assert.ok(cut.moved < 0);
});

test("calmCut respects the segment's min and max", () => {
  const cut = calmCut(curve(), { target: 5.4, step: 4, min: 5.2, max: 6 });
  assert.ok(cut.at >= 5.2 && cut.at <= 6, `cut at ${cut.at}`);
  assert.equal(calmCut(curve(), { target: 5.4, step: 4, min: 7, max: 6 }), null);
  // Nothing known in range: no answer, so the caller keeps its own cut.
  assert.equal(calmCut({ fps: 12, values: Array(121).fill(null) }, { target: 5, step: 4 }), null);
});

test("calmCut prefers an existing source cut (a free seam)", () => {
  const cut = calmCut(curve(), { target: 5.4, step: 4, cuts: [5.8] });
  assert.deepEqual([cut.at, cut.tag], [5.8, "cut"]);
  // A seam outside the search is ignored.
  assert.equal(calmCut(curve(), { target: 5.4, step: 4, cuts: [9] }).tag, "calm");
});

test("calmCut lands on a beat when the motion is flat", () => {
  const flat = { fps: 12, values: Array(121).fill(5) };
  const beats = Array.from({ length: 20 }, (_, i) => i * 0.5 + 0.2);
  const cut = calmCut(flat, { target: 5.4, step: 4, beats });
  assert.equal(cut.tag, "beat");
  assert.ok(beats.some((beat) => Math.abs(beat - cut.at) < 1e-6), `cut at ${cut.at}`);
});

test("cutMotionScore flags a cut mid-move and off the beat", () => {
  // A fast move at 2.3–2.7 s, twice the usual energy.
  const moving = curve();
  for (let i = 28; i <= 32; i += 1) moving.values[i] = 20;
  const beats = [0, 1, 2, 3, 4, 5, 6];
  assert.ok(cutMotionScore(moving, 2.5, { beats }).score > CALM_CUT.midMotion);
  assert.ok(cutMotionScore(moving, 4.75, { beats }).score < CALM_CUT.midMotion);
});

test("motionEnergy reads grey frames and masks overlay boxes", () => {
  const w = 4, h = 2, frames = [[0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 80, 80], [0, 0, 0, 0, 0, 0, 80, 80]];
  const raw = Uint8Array.from(frames.flat());
  assert.deepEqual(motionEnergy(raw, w, h, { fps: 12 }).values, smoothCurve([0, 20, 0]));
  // The changing corner is an overlay: masked, nothing moves.
  assert.deepEqual(motionEnergy(raw, w, h, { mask: [{ x: 0.5, y: 0.5, w: 0.5, h: 0.5 }] }).values, [0, 0, 0]);
});
