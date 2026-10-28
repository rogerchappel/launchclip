import assert from "node:assert/strict";
import test from "node:test";
import { CADENCE_BENCHMARK, CADENCE_FORMATS, cadenceGate, cadenceReport, cadenceTarget, eventStats, mergeEvents } from "@launchclip/core/cadence.mjs";

// A synthetic run shaped like the benchmark: an event every 5.2 s, a cut every fourth.
function benchmarkLike() {
  const events = [];
  for (let t = 2.6; t < CADENCE_BENCHMARK.duration_seconds; t += 5.2 + (events.length % 3 - 1) * 1.6) events.push(Math.round(t * 100) / 100);
  const cuts = events.filter((_, i) => i % 4 === 0);
  return { events, cuts };
}

test("cadence: the benchmark is stored as the long-form target", () => {
  assert.equal(CADENCE_BENCHMARK.events, 170);
  assert.equal(CADENCE_BENCHMARK.duration_seconds, 975);
  assert.deepEqual({ ...CADENCE_BENCHMARK.gap }, { p10: 2.5, p50: 5.2, p90: 9.8 });
  const target = cadenceTarget("long-form");
  assert.ok(target.gap.p50_min <= CADENCE_BENCHMARK.gap.p50 && CADENCE_BENCHMARK.gap.p50 <= target.gap.p50_max);
  assert.ok(target.gap.p90_max >= CADENCE_BENCHMARK.gap.p90);
  assert.ok(target.cut_gap.min <= CADENCE_BENCHMARK.cut_gap_p50 && CADENCE_BENCHMARK.cut_gap_p50 <= target.cut_gap.max);
  assert.deepEqual(CADENCE_FORMATS, ["long-form", "short-form", "talking-head", "art-direction", "motion-graphics", "animated"]);
});

test("cadence: a style scales seconds and rates inversely", () => {
  const calm = cadenceTarget("long-form", "calm"), base = cadenceTarget("long-form");
  assert.ok(calm.gap.p50_max > base.gap.p50_max);
  assert.ok(calm.per_min.min < base.per_min.min);
  assert.throws(() => cadenceTarget("vlog"), /no cadence target/);
  assert.throws(() => cadenceTarget("long-form", "loud"), /no cadence style/);
});

test("cadence: event stats and the gate", () => {
  assert.deepEqual(mergeEvents([3, 1, 1.2, 5], 1.5), [1, 3, 5]);
  const { events, cuts } = benchmarkLike();
  const stats = eventStats(events, { duration: 975, cuts });
  assert.ok(stats.events > 150 && stats.events < 200, String(stats.events));
  const gate = cadenceGate(stats, cadenceTarget("long-form"));
  assert.equal(gate.ok, true, cadenceReport(gate, stats));
  // A run that holds 40 s still fails on the longest static span and p90.
  const sparse = eventStats([...events.filter((t) => t < 300 || t > 340)], { duration: 975, cuts });
  const failed = cadenceGate(sparse, cadenceTarget("long-form"));
  assert.equal(failed.ok, false);
  assert.ok(failed.checks.find((check) => check.id === "longest_static" && !check.ok));
  assert.match(cadenceReport(failed, sparse), /FAIL longest_static/);
});
