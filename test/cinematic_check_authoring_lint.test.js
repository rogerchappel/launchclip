// cinematic-check waives only the authoring lint warnings on the composition
// finish compiled from a storyboard; everything else stays strict.
import test from "node:test";
import assert from "node:assert/strict";
import { COMPILED_AUTHORING_LINT, engineWrapperOverflow, waiveAuthoringLint, waiveEngineWarnings } from "../src/cinematic_check.js";

const section = (findings = [], extra = {}) => ({
  ok: true,
  errorCount: findings.filter((f) => f.severity === "error").length,
  warningCount: findings.filter((f) => f.severity === "warning").length,
  findings,
  ...extra
});
const report = (lint, overrides = {}) => ({ ok: false, strict: true, lint: section(lint), runtime: section(), layout: section(), motion: section(), contrast: section(), ...overrides });
const authoring = COMPILED_AUTHORING_LINT.map((code) => ({ code, severity: "warning" }));

test("only the authoring lint warnings are waived", () => {
  assert.deepEqual(waiveAuthoringLint(report(authoring)), { ok: true, waived: [...COMPILED_AUTHORING_LINT] });
  assert.equal(waiveAuthoringLint(report([...authoring, { code: "overlapping_gsap_tweens", severity: "warning" }])), null, "another lint warning still fails");
  assert.equal(waiveAuthoringLint(report(authoring, { layout: section([{ code: "container_overflow", severity: "warning" }]) })), null, "a layout warning still fails");
  assert.equal(waiveAuthoringLint(report(authoring, { layout: section([{ code: "content_overlap", severity: "error" }]) })), null, "an error still fails");
  assert.equal(waiveAuthoringLint(report([{ code: "composition_file_too_large", severity: "error" }])), null, "an authoring code at error severity still fails");
  assert.equal(waiveAuthoringLint({ ...report(authoring), ok: true }), null, "a passing report needs no waiver");
  assert.equal(waiveAuthoringLint(report(authoring, { lint: { ...section(authoring), warningCount: 5 } })), null, "warnings missing from the findings list are not waived");
});

// The engine's camera wrappers overflowing their own engine parent (finish's
// compiled composition); the scene ids are the composition's.
const overflow = (selector, containerSelector, extra = {}) => ({ code: "container_overflow", severity: "warning", selector, containerSelector, ...extra });
const scenes = ["s1", "s1-cast", "s1-say"];

test("engine camera wrappers overflowing their own parent are waived, by exact selector pair", () => {
  for (const [child, parent] of [["#lc-cam-drift", "#lc-camera"], ["#lc-cam-zoom", "#lc-cam-drift"], ["#lc-par-s1-say", "#lc-scene-s1-say"], ["#lc-zs-s1", "#lc-layer-s1"], ["#lc-drift-s1", "#lc-layer-s1"], ["#s1-cast-cam", "#s1-cast"], ["#s1-cast-overlay-cam", "#s1-cast-overlay"]]) {
    assert.equal(engineWrapperOverflow(overflow(child, parent), new Set(scenes)), true, `${child} in ${parent}`);
  }
  for (const [child, parent, why] of [
    ["#s1-say-card", "#lc-scene-s1-say", "a module's own element"],
    ["#lc-par-s9", "#lc-scene-s9", "a scene the composition does not have"],
    ["#lc-par-s1-say", "#lc-scene-s1", "another scene's container"],
    ["#s1-cast-cam", "#s1-say", "a camera in a foreign parent"],
    ["#lc-cam-drift", "#lc-scene-s1", "the world camera outside its stack"],
    ["#my-cam", "#my", "an author id that only looks like a camera"]
  ]) assert.equal(engineWrapperOverflow(overflow(child, parent), new Set(scenes)), false, why);
  assert.equal(engineWrapperOverflow({ ...overflow("#lc-cam-drift", "#lc-camera"), severity: "error" }), false, "an error is never waived");
  assert.equal(engineWrapperOverflow({ ...overflow("#lc-cam-pan", "#lc-cam-zoom"), code: "escaped_container" }), true, "a pan carrying its wrapper a frame away");
  assert.equal(engineWrapperOverflow({ ...overflow("#lc-cam-drift", "#lc-camera"), code: "text_overflow" }), false, "only container_overflow and escaped_container");
  assert.equal(engineWrapperOverflow({ ...overflow("#lc-drift-s1", "#launchclip-root"), code: "canvas_overflow" }), false, "text leaving the canvas is never waived");
});

test("a strict check that fails only on engine-made warnings passes verification; anything else still fails", () => {
  const wrappers = [overflow("#lc-cam-drift", "#lc-camera"), overflow("#lc-par-s1-say", "#lc-scene-s1-say"), overflow("#s1-cast-cam", "#s1-cast")];
  const wrappersOnly = report(authoring, { layout: section(wrappers, { truncated: false }) });
  assert.deepEqual(waiveEngineWarnings(wrappersOnly, { scenes }), { ok: true, waived: [...COMPILED_AUTHORING_LINT, "container_overflow"], counts: { composition_file_too_large: 1, timeline_track_too_dense: 1, container_overflow: 3 } });
  // Without the composition's scene ids, per-scene wrappers are not recognised.
  assert.equal(waiveEngineWarnings(wrappersOnly), null);
  // An author-caused overflow among them, a truncated list, an author's clip that does not fit its slot, or a tween overlap: all still fail.
  assert.equal(waiveEngineWarnings(report(authoring, { layout: section([...wrappers, overflow("#s1-say-text", "#lc-scene-s1-say")]) }), { scenes }), null);
  assert.equal(waiveEngineWarnings(report(authoring, { layout: section(wrappers, { truncated: true }) }), { scenes }), null);
  assert.equal(waiveEngineWarnings(report(authoring, { layout: section(wrappers), runtime: section([{ code: "clip_media_fit", severity: "warning" }]) }), { scenes }), null);
  assert.equal(waiveEngineWarnings(report([...authoring, { code: "overlapping_gsap_tweens", severity: "warning", selector: "#s1-cast-c1-eyes-neutral" }], { layout: section(wrappers) }), { scenes }), null);
});
