// cinematic-check waives only the authoring lint warnings on the composition
// finish compiled from a storyboard; everything else stays strict.
import test from "node:test";
import assert from "node:assert/strict";
import { COMPILED_AUTHORING_LINT, waiveAuthoringLint } from "../src/cinematic_check.js";

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
