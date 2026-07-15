import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeMotionSeries,
  analyzeBlockMotion,
  analyzeRenderMotion,
  classifyMotionFamily,
  compareMotionProfiles,
  evaluateMotionQuality,
  hookEventSeconds,
  parseMetadataSeries
} from "../src/render_motion_analysis.js";

test("parses frame metadata and labels luma derivatives as pixel-change metrics", () => {
  const parsed = parseMetadataSeries("frame:0 pts:0\nlavfi.signalstats.YAVG=0.1\nframe:1 pts:1\nlavfi.signalstats.YAVG=8.5", "lavfi.signalstats.YAVG");
  assert.deepEqual(parsed, [{ frame: 0, value: .1 }, { frame: 1, value: 8.5 }]);
  const values = [...Array(20).fill(.1), 4, 8, 4, ...Array(20).fill(.1), 10, 6, ...Array(20).fill(.1)];
  const result = analyzeMotionSeries(values, 10);
  assert.equal(result.bursts.length, 2);
  assert.ok(result.hold_ratio > .8);
  assert.ok(result.pixel_change_acceleration.max > 0);
  assert.ok(result.pixel_change_deceleration.max > 0);
  assert.ok(result.pixel_change_jerk.max > 0);
  assert.equal(result.frame_difference[20].at_seconds, 2);
});

test("measures velocity and easing from block-matched frame motion", () => {
  const width = 24;
  const height = 18;
  const frame = (offset) => {
    const output = Buffer.alloc(width * height);
    for (let y = 5; y < 11; y += 1) for (let x = 4 + offset; x < 10 + offset; x += 1) output[y * width + x] = (x + y) % 2 ? 255 : 80;
    return output;
  };
  const metrics = analyzeBlockMotion(Buffer.concat([frame(0), frame(1), frame(3), frame(3)]), width, height, 10, { flowBlockSize: 4, flowSearchRadius: 2, flowTextureThreshold: 1 });
  assert.equal(metrics.method, "block-matching");
  assert.ok(metrics.velocity_pixels_per_second.max > 0);
  assert.ok(metrics.acceleration_pixels_per_second_squared.max > 0);
  assert.ok(metrics.deceleration_pixels_per_second_squared.max > 0);
});

test("analyzes ffmpeg frame differences and scene scores without comparing pixels to references", async () => {
  const commands = [];
  const outputs = [
    { stdout: JSON.stringify({ format: { duration: "10" }, streams: [{ codec_type: "video", width: 1080, height: 1920, avg_frame_rate: "30/1", nb_frames: "300", nb_read_frames: "300" }] }) },
    { stdout: metadata("lavfi.signalstats.YAVG", [0.1, 0.1, 5, 0.1, 0.1, 7, 0.1]) },
    { stdout: metadata("lavfi.scene_score", [0, .1, .6, .1, .7, .1, .1]) }
  ];
  let rawCalls = 0;
  const metrics = await analyzeRenderMotion("/tmp/candidate.mp4", {}, {
    run: async (command, args) => { commands.push([command, args]); return outputs.shift(); },
    runRaw: async () => { rawCalls += 1; return { stdout: Buffer.alloc(64 * 36 * 3) }; }
  });
  assert.equal(metrics.aspect, "9:16");
  assert.equal(metrics.frame_count, 300);
  assert.equal(metrics.frame_difference_count, 7);
  assert.equal(metrics.motion.frame_count, 7);
  assert.deepEqual(metrics.cuts.map((value) => Number(value.toFixed(3))), [.067, .133]);
  assert.equal(metrics.cut_rate_per_minute, 12);
  assert.ok(metrics.motion.frame_difference.length > 0);
  assert.equal(metrics.optical_flow.method, "block-matching");
  assert.equal(rawCalls, 1);
  assert.match(commands[1][1].join(" "), /tblend=all_mode=difference/);
  assert.match(commands[2][1].join(" "), /scene_score/);
  assert.match(commands[0][1].join(" "), /-count_frames/);
  assert.match(commands[0][1].join(" "), /nb_read_frames/);
});

test("compares temporal distributions and optical-flow easing within compatible reference families", () => {
  const profile = (video, cut, bursts, hold, energies, velocity) => ({
    video, family: classifyMotionFamily({ cut_rate_per_minute: cut, motion_bursts_per_minute: bursts, hold_ratio: hold }),
    cut_rate_per_minute: cut, motion_bursts_per_minute: bursts,
    motion: { hold_ratio: hold, frame_difference: energies.map((energy, frame) => ({ frame, energy })) },
    optical_flow: { sample_fps: 10, samples: velocity.map((pixels_per_second, frame) => ({ frame, pixels_per_second })) }
  });
  const candidate = profile("candidate", 20, 22, .4, [0, 1, 4, 1], [0, 10, 30, 12, 0]);
  const comparison = compareMotionProfiles(candidate, [
    profile("fast", 24, 20, .35, [0, 2, 5, 1], [0, 12, 28, 10, 0]),
    profile("slow", 3, 18, .9, [0, .1, 1, .1], [0, 1, 2, 1, 0])
  ]);
  assert.equal(comparison.compatible_family, "rapid-hybrid");
  assert.equal(comparison.references.length, 1);
  assert.equal(comparison.references[0].video, "fast");
  assert.ok(Number.isFinite(comparison.references[0].change_energy_wasserstein));
  assert.ok(Number.isFinite(comparison.references[0].flow_velocity_temporal_dtw));
  assert.ok(Number.isFinite(comparison.references[0].flow_acceleration_wasserstein));
  assert.ok(Number.isFinite(comparison.references[0].flow_deceleration_wasserstein));
});

test("quality gates exact duration, dimensions, dead motion, and missing samples", () => {
  const result = evaluateMotionQuality({ duration_seconds: 9, width: 720, height: 1280, frame_count: 0, motion_bursts_per_minute: 0, motion: { hold_ratio: 1 } }, { duration_seconds: 10, width: 1080, height: 1920 });
  assert.equal(result.ok, false);
  assert.deepEqual(new Set(result.findings.map((entry) => entry.category)), new Set(["duration", "dimensions", "frames", "motion"]));
});

test("quality gates opening cadence, frame energy, and velocity", () => {
  const metrics = {
    duration_seconds: 30, width: 1080, height: 1920, frame_count: 900,
    cuts: [3.8], cut_rate_per_minute: 2, motion_bursts_per_minute: 8,
    motion: {
      hold_ratio: .7,
      hold_threshold: .2,
      change_energy: { p50: .15 },
      bursts: [{ start_seconds: 1.1 }, { start_seconds: 1.18 }, { start_seconds: 3.7 }],
      frame_difference: []
    },
    optical_flow: { velocity_pixels_per_second: { p90: 1.5 } }
  };
  assert.deepEqual(hookEventSeconds(metrics, 4), [1.1, 3.7]);
  const result = evaluateMotionQuality(metrics, {
    maximum_first_motion_seconds: .5,
    minimum_hook_events: 3,
    hook_window_seconds: 4,
    minimum_change_energy_p50: .5,
    minimum_flow_velocity_p90: 4,
    minimum_cut_rate_per_minute: 4
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.findings.map((entry) => entry.category), ["motion", "motion", "editing", "hook", "hook"]);
  assert.match(result.findings.at(-1).message, /Only 2 distinct/);
});

function metadata(key, values) {
  return values.map((value, frame) => `frame:${frame} pts:${frame}\n${key}=${value}`).join("\n");
}
