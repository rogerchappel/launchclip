import test from "node:test";
import assert from "node:assert/strict";

import { clockTime, explainGates } from "../src/gate_summary.js";

// The held render's gates (the triage of a 31 s short), as finish wrote them.
const held = {
  layout: { status: "failed", errors: 11, findings: [{ rule: "caption-illegible", severity: "error", ids: ["cap-7"], at: 16.2, detail: '"Number three," reads at 1.93:1 with 14% of its surround in the text colour' }, { rule: "safe-zone", severity: "warning", at: 2, detail: "near the edge" }] },
  visual_density: { status: "failed", findings: [{ rule: "sparse-run", severity: "error", at: 3, detail: "flat surface 3–5.5 s, fill < 0.55" }, { rule: "sparse-run", severity: "error", at: 10.4, detail: "flat surface 10.4–13 s" }, { rule: "sparse-share", severity: "warning", at: 22 }] },
  pace: { status: "failed", findings: [{ rule: "slow-hook", severity: "error", at: 0, ids: [], detail: "the opening 3 s has 2 events" }] },
  motion: { status: "failed", findings: [{ category: "motion", severity: "minor", message: "72.3% near-static", measure: "hold_ratio" }, { category: "stillness", severity: "major", message: "Still from 0:10.00 to 0:12.00", start_seconds: 10, end_seconds: 12 }, { category: "stillness", severity: "major", message: "Still from 0:22.40 to 0:24.00", start_seconds: 22.4, end_seconds: 24 }] },
  style: { status: "failed", findings: ["major: palette: off"] },
  ghosting: { status: "passed", findings: [{ rule: "text-hold", severity: "warning", at: 26.1, detail: "2.04 s of 2.2 s" }] },
  critic: { status: "pending" }
};

test("every failed gate gets a plain summary with the times a viewer can seek to", () => {
  const gates = explainGates(held);
  assert.equal(gates.layout.summary, "Some captions are hard to read over what's behind them (0:16)");
  assert.deepEqual(gates.layout.at, [16]);
  assert.equal(gates.visual_density.summary, "The screen looks empty in places (0:03, 0:10)");
  assert.equal(gates.pace.summary, "The opening is slow to get going");
  assert.equal(gates.motion.summary, "The picture stands still in places (0:10, 0:22)", "the advisory hold_ratio does not lead");
  assert.equal(gates.style.summary, "The video drifts from its chosen style", "string findings fall back to the gate's line");
  assert.deepEqual(gates.style.at, []);
  // No gate names, ratios or percentages in what a user reads.
  for (const gate of Object.values(gates)) if (gate.summary) assert.doesNotMatch(gate.summary, /\d%|\d:1\b|gate|_/);
});

test("timed findings get `at`; passed and pending gates get no summary", () => {
  const gates = explainGates(held);
  assert.deepEqual(gates.motion.findings.map((finding) => finding.at), [undefined, 10, 22.4]);
  assert.equal(gates.ghosting.summary, undefined);
  assert.equal(gates.ghosting.findings[0].at, 26.1);
  assert.deepEqual(gates.critic, { status: "pending" });
  assert.equal(held.motion.findings[1].at, undefined, "the input is not changed");
});

test("more than three times are cut short; clock times are m:ss", () => {
  const gates = explainGates({ visual_density: { status: "failed", findings: [3, 10, 22, 26, 29].map((at) => ({ rule: "sparse-run", severity: "error", at })) } });
  assert.equal(gates.visual_density.summary, "The screen looks empty in places (0:03, 0:10, 0:22, …)");
  assert.deepEqual([clockTime(0), clockTime(16.9), clockTime(75)], ["0:00", "0:16", "1:15"]);
});
