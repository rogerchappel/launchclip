// Timing rules tables (kit/core/modules.mjs moduleTiming): generated from each
// module's own timing constants, and held to the validators here by probing
// the boundaries they state.
import assert from "node:assert/strict";
import test from "node:test";
import { knownModules, moduleTiming, resolveModule, timingWindow } from "../kit/core/modules.mjs";
import { storyboardModulesReference, timingTableLines } from "../kit/core/planning-prompt.mjs";
import { formatModuleFit, moduleFitReport } from "../src/module_fit.js";

const BRAND = { colors: { bg: "#0b0d12", primary: "#ffb020", accent: "#46d4ff", ink: "#0b0d12", paper: "#f2eee6" }, fonts: { display: "anton", body: "inter", meta: "jetbrains-mono" } };
const story = (duration, extra = {}) => ({ format: { width: 1920, height: 1080, fps: 30, duration: Math.max(duration, 1) + 1 }, brand: BRAND, scenes: [], ...extra });
const resolves = (module, params, duration, extra) => {
  try { resolveModule({ id: "m", module, start: 0, end: duration, params }, story(duration, extra)); return true; } catch { return false; }
};

test("every module exports a timing table", () => {
  for (const id of knownModules()) {
    const timing = moduleTiming(id);
    assert.ok(timing, id);
    assert.ok(Number.isFinite(timing.minDuration) && timing.minDuration > 0, `${id} minDuration`);
    assert.ok(Array.isArray(timing.gaps) && Array.isArray(timing.rules), id);
    for (const gap of timing.gaps) assert.ok(typeof gap.between === "string" && gap.seconds > 0, id);
  }
  assert.equal(moduleTiming("no-such-module"), null);
  assert.deepEqual(timingWindow(moduleTiming("status-rack"), 3), { from: 0.28, to: 2.55 });
});

test("editorial timing tables match the validator: status-rack lead-in, lead-out and gap", () => {
  const timing = moduleTiming("status-rack"), duration = 3;
  const rack = (states) => ({ title: "Gates", rect: { x: 400, y: 200, width: 1100, height: 400 }, rack: { mode: "illustration", rows: [{ label: "Tests", states }] } });
  const one = (at) => rack([{ at, lights: [true, false, false] }]);
  assert.ok(resolves("status-rack", one(timing.leadIn), duration));
  assert.ok(!resolves("status-rack", one(timing.leadIn - 0.01), duration));
  assert.ok(resolves("status-rack", one(duration - timing.leadOut), duration));
  assert.ok(!resolves("status-rack", one(duration - timing.leadOut + 0.01), duration));
  const gap = timing.gaps[0].seconds;
  assert.ok(resolves("status-rack", rack([{ at: 0.5, lights: [true, false, false] }, { at: 0.5 + gap, lights: [true, true, false] }]), duration));
  assert.ok(!resolves("status-rack", rack([{ at: 0.5, lights: [true, false, false] }, { at: 0.5 + gap - 0.01, lights: [true, true, false] }]), duration));
  // Below the minimum scene the module does not resolve.
  assert.ok(!resolves("status-rack", one(0.3), moduleTiming("status-rack").minDuration - 0.05));
  // metric's longer lead-out and value gap.
  const metric = moduleTiming("metric");
  const values = (list) => ({ title: "Stars", rect: { x: 400, y: 200, width: 1100, height: 500 }, metric: { mode: "illustration", unit: "stars", format: "number", values: list } });
  assert.ok(resolves("metric", values([{ value: 1, at: 0.3 }, { value: 2, at: 0.3 + metric.gaps[0].seconds }]), 3));
  assert.ok(!resolves("metric", values([{ value: 1, at: 0.3 }, { value: 2, at: 0.3 + metric.gaps[0].seconds - 0.02 }]), 3));
  assert.ok(!resolves("metric", values([{ value: 1, at: 3 - metric.leadOut + 0.01 }]), 3));
});

test("catalogue timing tables match the validators: minimum scenes, process-steps window and gap, lower-third lead-out", () => {
  for (const [id, params] of [["cta", { action: "Star it" }], ["hook-title", { headline: "Ship it" }]]) {
    const { minDuration } = moduleTiming(id);
    assert.ok(resolves(id, params, minDuration), `${id} at ${minDuration} s`);
    assert.ok(!resolves(id, params, minDuration - 0.05), `${id} under ${minDuration} s`);
  }
  const steps = moduleTiming("process-steps"), duration = 4;
  assert.deepEqual([steps.minDuration, steps.leadIn, steps.leadOut, steps.gaps[0].seconds], [2, 0.5, 0.65, 0.35]);
  const params = (ats) => ({ steps: ats.map((at, i) => ({ label: `Step ${i + 1}`, at })) });
  assert.ok(resolves("process-steps", params([steps.leadIn, steps.leadIn + steps.gaps[0].seconds]), duration));
  assert.ok(!resolves("process-steps", params([steps.leadIn, steps.leadIn + steps.gaps[0].seconds - 0.02]), duration));
  assert.ok(resolves("process-steps", params([1, duration - steps.leadOut]), duration));
  assert.throws(() => resolveModule({ id: "m", module: "process-steps", start: 0, end: duration, params: params([1, duration - steps.leadOut + 0.05]) }, story(duration)),
    new RegExp(`must fall between ${steps.leadIn} s and ${duration - steps.leadOut} s`));
  const lower = moduleTiming("lower-third");
  const footage = { lane: "footage-led", base: { src: "assets/base.mp4" } };
  assert.ok(resolves("lower-third", { name: "Roger", at: 3 - lower.leadOut }, 3, footage));
  assert.ok(!resolves("lower-third", { name: "Roger", at: 3 - lower.leadOut + 0.05 }, 3, footage));
  assert.ok(!resolves("lower-third", { name: "Roger" }, lower.minDuration - 0.05, footage));
});

test("the timing table reaches the skill reference and launchclip module fit", () => {
  const reference = storyboardModulesReference();
  assert.match(reference, /## Timing rules/);
  assert.match(reference, /\| process-steps \| 2 s \| 0\.5 s \| scene − 0\.65 s \| steps\[\]\.at: ≥ 0\.35 s apart \|/);
  assert.match(reference, /\| code-snippet \| 1 s \| 0\.28 s \| scene − 0\.45 s \| code\.lines\[\]\.at: ≥ 0\.3 s apart/);
  assert.equal(timingTableLines().filter((line) => line.startsWith("| ") && !line.startsWith("| Module") && !line.startsWith("| ---")).length, knownModules().length);
  const scene = { id: "fit", module: "code-snippet", start: 0, end: 3, params: { title: "Terminal", code: { lines: [{ at: 0.4, tokens: [{ text: "npm test", type: "plain" }] }] } } };
  const report = moduleFitReport(scene, { format: { width: 1920, height: 1080, fps: 30, duration: 3 }, brand: BRAND, scenes: [scene] }, { aspect: "16:9" });
  assert.deepEqual(report.timing.window, { from: 0.28, to: 2.55 });
  const text = formatModuleFit(report);
  assert.match(text, /timing:\n {4}scene at least 1 s\n {4}at from 0\.28 s to scene − 0\.45 s \(0\.28–2\.55 s in a 3 s scene\)\n {4}code\.lines\[\]\.at: at least 0\.3 s apart/);
});
