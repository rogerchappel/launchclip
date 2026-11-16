// Visual density over the whole timeline (src/visual_density.js): footage or
// full-bleed type to the last second; a footage-in-the-top-half split over an
// empty panel, or flat cards at the end, fail.
import assert from "node:assert/strict";
import test from "node:test";
import { visualDensity, visualDensityErrors, visualDensityGate } from "../src/visual_density.js";

const W = 1080, H = 1920;
const story = (duration, scenes = []) => ({ format: { width: W, height: H, duration }, resolved: { duration }, scenes });
const full = { x: 0, y: 0, width: W, height: H };
const top = { x: 0, y: 0, width: W, height: H * 0.45 };
const line = { x: 80, y: H * 0.55, width: 700, height: 120 };
const headline = { x: 60, y: H * 0.3, width: 960, height: 760 };
const media = (id, start, end, rect = full) => ({ id, role: "media", rect, start, end });
const text = (id, start, end, rect = line) => ({ id, role: "text", rect, start, end });

test("pass: footage, then full-bleed type over a footage plate, to the last second", () => {
  const s = story(20, [{ id: "a", start: 0, end: 14 }, { id: "cta", start: 14, end: 20, backdrop: { kind: "video", params: { src: "assets/a.mp4", treatment: "blur", dim: 0.4, peak: 0.5 } } }]);
  const rects = [media("a", 0, 14), text("a-line", 2, 14), text("cta", 14, 20, headline)];
  const measured = visualDensity(s, rects);
  assert.equal(measured.findings.length, 0, JSON.stringify(measured.findings));
  assert.ok(measured.ending.min_fill >= 0.35);
  assert.ok(measured.footage_share > 0.5);
  assert.equal(visualDensityGate(s, { rects }).status, "passed");
});

test("fail: a top-half split over an empty panel for most of the video, then flat cards at the end", () => {
  const s = story(28, [{ id: "a", start: 0, end: 20 }, { id: "chips", start: 20, end: 24 }, { id: "cta", start: 24, end: 28 }]);
  const rects = [media("a", 0, 20, top), text("a-line", 0, 20), text("chips", 20, 24), text("cta", 24, 28)];
  const measured = visualDensity(s, rects);
  const rules = new Set(measured.findings.map((f) => f.rule));
  assert.ok(rules.has("sparse-ending"), JSON.stringify(measured.findings));
  assert.ok(rules.has("sparse-share"));
  assert.ok(measured.ending.min_fill < 0.35);
  assert.equal(visualDensityGate(s, { rects }).status, "failed");
  assert.match(visualDensityErrors(s, rects)[0], /^density: /);
});

test("fail: a footage plate buried under a near-opaque dim does not count as footage", () => {
  const s = story(12, [{ id: "a", start: 0, end: 8 }, { id: "cta", start: 8, end: 12, backdrop: { kind: "video", params: { src: "assets/a.mp4", dim: 0.92, peak: 1 } } }]);
  const rects = [media("a", 0, 8), text("cta", 8, 12)];
  assert.ok(visualDensity(s, rects).findings.some((f) => f.rule === "sparse-ending"));
});

test("skipped: no footage anywhere (a drawn or character story), or no rects", () => {
  const s = story(12, [{ id: "a", start: 0, end: 12 }]);
  assert.equal(visualDensity(s, [text("a", 0, 12)]), null);
  assert.equal(visualDensityGate(s, { rects: [] }).status, "skipped");
});
