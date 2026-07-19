import assert from "node:assert/strict";
import test from "node:test";
import { assessCinematicReadiness, CINEMATIC_READINESS_VERSION } from "../src/production_readiness.js";

test("passes only when every cinematic readiness gate has current evidence", () => {
  const result = assessCinematicReadiness(passingInput());
  assert.equal(result.schema_version, CINEMATIC_READINESS_VERSION);
  assert.equal(result.ok, true);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.repair_findings, []);
  assert.deepEqual(result.blockers, []);
});

test("fails closed when required verification, analysis, or critique evidence is missing", () => {
  const result = assessCinematicReadiness({ plan: {} });
  assert.equal(result.ok, false);
  assert.deepEqual(result.blockers.map((entry) => entry.gate), ["concepts", "story", "narration", "verification", "motion", "audio", "critic", "fallbacks"]);
  assert.equal(result.gates.concepts.status, "missing");
  assert.equal(result.gates.verification.status, "missing");
  assert.equal(result.gates.fallbacks.status, "missing");
  assert.equal(result.repair_findings.length, 0);
});

test("normalizes hook, motion, editing, and audio failures into typed repair findings", () => {
  const input = passingInput();
  input.motion.quality = { ok: false, findings: [
    { category: "hook", severity: "major", message: "Only one event landed in the first four seconds." },
    { category: "motion", severity: "major", message: "Motion energy is too low." },
    { category: "editing", severity: "major", message: "Material changes are too sparse." }
  ] };
  input.audio.quality = { ok: false, findings: [{ category: "masking", severity: "major", message: "Voice-to-music margin is 2 dB." }] };
  const result = assessCinematicReadiness(input);
  assert.deepEqual(result.repair_findings.map((entry) => entry.repair_scope), ["plan", "plan", "plan", "audio"]);
  assert.deepEqual(result.repair_findings.map((entry) => entry.category), ["motion", "motion", "timing", "audio"]);
  assert.ok(result.repair_findings.every((entry) => entry.shot_ids.length === 0), "aggregate findings must not be sprayed across every frame");
});

test("keeps structural render and failed native verification findings as non-speculative blockers", () => {
  const input = passingInput();
  input.verification = { status: "failed", failed: ["inspect:shot-2"] };
  input.motion.quality = { ok: false, findings: [
    { category: "duration", severity: "blocking", message: "Rendered duration is wrong." },
    { category: "dimensions", severity: "blocking", message: "Rendered dimensions are wrong." }
  ] };
  const result = assessCinematicReadiness(input);
  assert.deepEqual(result.blockers.map((entry) => entry.id), ["verification-failed", "motion-duration-1", "motion-dimensions-2"]);
  assert.equal(result.repair_findings.length, 0);
});

test("rejects deterministic fallbacks and targets only their authored scenes", () => {
  const input = passingInput();
  input.assembly = { fallback_count: 2, fallbacks: [{ shot_id: "shot-2" }, { shot_id: "shot-4" }] };
  const result = assessCinematicReadiness(input);
  assert.equal(result.gates.fallbacks.ok, false);
  assert.equal(result.repair_findings[0].repair_scope, "frames");
  assert.deepEqual(result.repair_findings[0].shot_ids, ["shot-2", "shot-4"]);
  assert.equal(assessCinematicReadiness(input, { zeroFallbacks: false }).gates.fallbacks.ok, true);
});

function passingInput() {
  return {
    concepts: { selected_id: "concept-1" },
    story: { concept_id: "concept-1" },
    narration: { duration_seconds: 10, words: [] },
    plan: { shots: [{ id: "shot-1" }] },
    verification: { status: "passed", failed: [] },
    motion: { quality: { ok: true, findings: [] } },
    audio: { quality: { ok: true, findings: [] } },
    critique: { verdict: "ship", findings: [] },
    assembly: { fallback_count: 0, fallbacks: [] }
  };
}
