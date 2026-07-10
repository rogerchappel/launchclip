import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeMotionSeries,
  analyzeRenderMotion,
  classifyMotionFamily,
  compareMotionProfiles,
  evaluateMotionQuality,
  parseMetadataSeries
} from "../src/render_motion_analysis.js";

test("parses frame metadata and measures bursts, stillness, acceleration, deceleration, and jerk", () => {
  const parsed = parseMetadataSeries("frame:0 pts:0\nlavfi.signalstats.YAVG=0.1\nframe:1 pts:1\nlavfi.signalstats.YAVG=8.5", "lavfi.signalstats.YAVG");
  assert.deepEqual(parsed, [{ frame: 0, value: .1 }, { frame: 1, value: 8.5 }]);
  const values = [...Array(20).fill(.1), 4, 8, 4, ...Array(20).fill(.1), 10, 6, ...Array(20).fill(.1)];
  const result = analyzeMotionSeries(values, 10);
  assert.equal(result.bursts.length, 2);
  assert.ok(result.hold_ratio > .8);
  assert.ok(result.acceleration.max > 0);
  assert.ok(result.deceleration.max > 0);
  assert.ok(result.jerk.max > 0);
  assert.equal(result.frame_difference[20].at_seconds, 2);
});

test("analyzes ffmpeg frame differences and scene scores without comparing pixels to references", async () => {
  const commands = [];
  const outputs = [
    { stdout: JSON.stringify({ format: { duration: "10" }, streams: [{ codec_type: "video", width: 1080, height: 1920, avg_frame_rate: "30/1" }] }) },
    { stdout: metadata("lavfi.signalstats.YAVG", [0.1, 0.1, 5, 0.1, 0.1, 7, 0.1]) },
    { stdout: metadata("lavfi.scene_score", [0, .1, .6, .1, .7, .1, .1]) }
  ];
  const metrics = await analyzeRenderMotion("/tmp/candidate.mp4", {}, { run: async (command, args) => { commands.push([command, args]); return outputs.shift(); } });
  assert.equal(metrics.aspect, "9:16");
  assert.deepEqual(metrics.cuts.map((value) => Number(value.toFixed(3))), [.067, .133]);
  assert.equal(metrics.cut_rate_per_minute, 12);
  assert.ok(metrics.motion.frame_difference.length > 0);
  assert.match(commands[1][1].join(" "), /tblend=all_mode=difference/);
  assert.match(commands[2][1].join(" "), /scene_score/);
});

test("compares temporal distributions within compatible reference families", () => {
  const profile = (video, cut, bursts, hold, energies) => ({
    video, family: classifyMotionFamily({ cut_rate_per_minute: cut, motion_bursts_per_minute: bursts, hold_ratio: hold }),
    cut_rate_per_minute: cut, motion_bursts_per_minute: bursts,
    motion: { hold_ratio: hold, frame_difference: energies.map((energy, frame) => ({ frame, energy })) }
  });
  const candidate = profile("candidate", 20, 22, .4, [0, 1, 4, 1]);
  const comparison = compareMotionProfiles(candidate, [profile("fast", 24, 20, .35, [0, 2, 5, 1]), profile("slow", 3, 18, .9, [0, .1, 1, .1])]);
  assert.equal(comparison.compatible_family, "rapid-hybrid");
  assert.equal(comparison.references.length, 1);
  assert.equal(comparison.references[0].video, "fast");
  assert.ok(Number.isFinite(comparison.references[0].change_energy_wasserstein));
});

test("quality gates exact duration, dimensions, dead motion, and missing samples", () => {
  const result = evaluateMotionQuality({ duration_seconds: 9, width: 720, height: 1280, frame_count: 0, motion_bursts_per_minute: 0, motion: { hold_ratio: 1 } }, { duration_seconds: 10, width: 1080, height: 1920 });
  assert.equal(result.ok, false);
  assert.deepEqual(new Set(result.findings.map((entry) => entry.category)), new Set(["duration", "dimensions", "frames", "motion"]));
});

function metadata(key, values) {
  return values.map((value, frame) => `frame:${frame} pts:${frame}\n${key}=${value}`).join("\n");
}
