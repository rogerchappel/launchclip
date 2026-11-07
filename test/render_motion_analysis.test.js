import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mediaSkip } from "./helpers/media.js";
import {
  analyzeMotionSeries,
  analyzeBlockMotion,
  analyzeRenderMotion,
  classifyMotionFamily,
  compareMotionProfiles,
  evaluateMotionQuality,
  flowGrid,
  flowOnsetSeconds,
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

test("quality uses a family-specific motion floor for developing cards", () => {
  const metrics = {
    duration_seconds: 45, width: 1080, height: 1920, frame_count: 1350,
    cuts: [14.6], cut_rate_per_minute: 1.33, motion_bursts_per_minute: 43.97,
    motion: { hold_ratio: .58, change_energy: { p50: .19 }, bursts: [], frame_difference: [] }
  };
  const result = evaluateMotionQuality(metrics, {
    minimum_change_energy_p50: .35,
    minimum_change_energy_p50_by_family: { "developing-card": .15 }
  });
  assert.equal(classifyMotionFamily(metrics), "developing-card");
  assert.equal(result.ok, true);
  assert.deepEqual(result.findings, []);
});

function metadata(key, values) {
  return values.map((value, frame) => `frame:${frame} pts:${frame}\n${key}=${value}`).join("\n");
}

// A synthetic portrait stick figure, drawn at 1080×1920 with 8 px strokes and
// box-filtered down to a flow grid (as ffmpeg's area scale does).
function stickFrame(armDegrees, { width = 1080, height = 1920 } = {}) {
  const canvas = new Uint8Array(width * height).fill(232);
  const line = (x0, y0, x1, y1, thickness = 8) => {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    for (let i = 0; i <= steps; i += 1) {
      const cx = x0 + (x1 - x0) * i / steps, cy = y0 + (y1 - y0) * i / steps;
      for (let y = Math.floor(cy - thickness / 2); y <= cy + thickness / 2; y += 1) for (let x = Math.floor(cx - thickness / 2); x <= cx + thickness / 2; x += 1) {
        if (x >= 0 && y >= 0 && x < width && y < height) canvas[y * width + x] = 30;
      }
    }
  };
  for (let a = 0; a < 360; a += 2) { const r = (a * Math.PI) / 180; line(540 + 60 * Math.cos(r), 700 + 60 * Math.sin(r), 540 + 60 * Math.cos(r + 0.04), 700 + 60 * Math.sin(r + 0.04)); }
  line(540, 760, 540, 1100);
  line(540, 1100, 460, 1400); line(540, 1100, 620, 1400);
  line(540, 850, 400, 1000);
  const r = (armDegrees * Math.PI) / 180;
  line(540, 850, 540 + 300 * Math.cos(r), 850 - 300 * Math.sin(r));
  return canvas;
}

function areaScale(canvas, width, height, gridWidth, gridHeight) {
  const out = Buffer.alloc(gridWidth * gridHeight);
  const fx = width / gridWidth, fy = height / gridHeight;
  for (let gy = 0; gy < gridHeight; gy += 1) for (let gx = 0; gx < gridWidth; gx += 1) {
    let sum = 0, count = 0;
    for (let y = Math.floor(gy * fy); y < Math.floor((gy + 1) * fy); y += 1) for (let x = Math.floor(gx * fx); x < Math.floor((gx + 1) * fx); x += 1) { sum += canvas[y * width + x]; count += 1; }
    out[gy * gridWidth + gx] = Math.round(sum / count);
  }
  return out;
}

function portraitClip(angles, grid) {
  return Buffer.concat(angles.map((angle) => areaScale(stickFrame(angle), 1080, 1920, grid.width, grid.height)));
}

test("the flow grid keeps the video's aspect: portrait renders are sampled portrait", () => {
  assert.deepEqual(flowGrid(1080, 1920), { width: 180, height: 320, velocityScale: 0.2 });
  assert.deepEqual(flowGrid(1920, 1080), { width: 320, height: 180, velocityScale: 0.2 });
  assert.deepEqual(flowGrid(1080, 1080), { width: 180, height: 180, velocityScale: 0.2 });
  // The legacy 64×36 grid reads at its own scale (velocityScale 1).
  assert.equal(flowGrid(1080, 1920, { flowWidth: 64, flowHeight: 36 }).velocityScale, 1);
});

test("a portrait stick figure waving its arm passes the flow floor; the same figure held still fails it", () => {
  const grid = flowGrid(1080, 1920);
  const waving = [0, 6, 12, 18, 24, 30, 24, 18, 12, 6, 0, -6, -12, -6, 0, 6];
  const acting = analyzeBlockMotion(portraitClip(waving, grid), grid.width, grid.height, 10, { velocityScale: grid.velocityScale });
  assert.ok(acting.velocity_pixels_per_second.p90 >= 2, `acting p90 ${acting.velocity_pixels_per_second.p90}`);
  // Every frame pair of the gesture registers.
  assert.equal(acting.samples.filter((sample) => sample.pixels_per_second > 0).length, waving.length - 1);
  const held = analyzeBlockMotion(portraitClip(Array(16).fill(12), grid), grid.width, grid.height, 10, { velocityScale: grid.velocityScale });
  assert.equal(held.velocity_pixels_per_second.p90, 0);
  assert.equal(held.velocity_pixels_per_second.max, 0);
  const floor = { minimum_flow_velocity_p90: 2 };
  const quality = (flow) => evaluateMotionQuality({ duration_seconds: 1.6, width: 1080, height: 1920, frame_count: 48, motion_bursts_per_minute: 60, motion: { hold_ratio: 0.2, bursts: [] }, optical_flow: flow }, floor);
  assert.equal(quality(acting).ok, true);
  assert.equal(quality(held).ok, false);
  assert.match(quality(held).findings[0].message, /90th-percentile motion velocity is 0\.0 px\/s/);
});

test("the old landscape 64×36 grid could not see the same portrait acting", () => {
  const legacy = { width: 64, height: 36 };
  const waving = [0, 6, 12, 18, 24, 30, 24, 18, 12, 6, 0];
  // A portrait frame squeezed into a landscape grid, as the gate sampled it.
  const metrics = analyzeBlockMotion(Buffer.concat(waving.map((angle) => areaScale(stickFrame(angle), 1080, 1920, legacy.width, legacy.height))), legacy.width, legacy.height, 10, { flowBlockSize: 6, flowSearchRadius: 2 });
  assert.equal(metrics.velocity_pixels_per_second.p90, 0);
});

test("a blink-sized change or encoder noise on a held frame is not motion", () => {
  const grid = flowGrid(1080, 1920);
  const base = areaScale(stickFrame(12), 1080, 1920, grid.width, grid.height);
  const frames = [];
  for (let i = 0; i < 12; i += 1) {
    const frame = Buffer.from(base);
    // ±2 levels of noise everywhere, and a 6×3 px "eye" that blinks.
    for (let p = 0; p < frame.length; p += 1) frame[p] = Math.max(0, Math.min(255, frame[p] + ((p * 7 + i * 13) % 5) - 2));
    for (let y = 114; y < 117; y += 1) for (let x = 88; x < 94; x += 1) frame[y * grid.width + x] = i % 2 ? 30 : 232;
    frames.push(frame);
  }
  const metrics = analyzeBlockMotion(Buffer.concat(frames), grid.width, grid.height, 10, { velocityScale: grid.velocityScale });
  assert.equal(metrics.velocity_pixels_per_second.max, 0);
});

test("optical-flow onsets count as motion events in the hook and as first motion", () => {
  const samples = [0, 0, 2, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 4, 0].map((pixels_per_second, index) => ({ at_seconds: (index + 1) / 10, pixels_per_second }));
  const metrics = { cuts: [], motion: { bursts: [] }, optical_flow: { sample_fps: 10, samples } };
  assert.deepEqual(flowOnsetSeconds(metrics), [0.2, 1.9]);
  assert.deepEqual(hookEventSeconds(metrics, 4), [0.2, 1.9]);
  // A single moving sample is flicker, not an event.
  assert.deepEqual(flowOnsetSeconds({ optical_flow: { sample_fps: 10, samples: [{ at_seconds: 0.1, pixels_per_second: 4 }, { at_seconds: 0.2, pixels_per_second: 0 }] } }), []);
  const result = evaluateMotionQuality({ ...metrics, duration_seconds: 3, frame_count: 90, motion_bursts_per_minute: 30, motion: { hold_ratio: .5, bursts: [], frame_difference: [] } }, { maximum_first_motion_seconds: 0.35 });
  assert.equal(result.ok, true);
});

test("analyzeRenderMotion samples a portrait render on a portrait flow grid", async () => {
  const commands = [];
  const outputs = [
    { stdout: JSON.stringify({ format: { duration: "1" }, streams: [{ codec_type: "video", width: 1080, height: 1920, avg_frame_rate: "30/1", nb_read_frames: "30" }] }) },
    { stdout: metadata("lavfi.signalstats.YAVG", [0.1, 0.1]) },
    { stdout: metadata("lavfi.scene_score", [0, 0]) }
  ];
  const metrics = await analyzeRenderMotion("/tmp/portrait.mp4", {}, {
    run: async (command, args) => { commands.push(args); return outputs.shift(); },
    runRaw: async (command, args) => { commands.push(args); return { stdout: Buffer.alloc(180 * 320 * 2) }; }
  });
  assert.match(commands.at(-1).join(" "), /scale=180:320:flags=area/);
  assert.deepEqual(metrics.optical_flow.grid, { width: 180, height: 320 });
  assert.match(metrics.optical_flow.velocity_units, /36-px short side/);
});

test("encoded portrait clips: acting registers on the flow grid, a held frame does not", { skip: mediaSkip(ffmpegMissing()) }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "launchclip-flow-"));
  try {
    const encode = (file, angles) => {
      const result = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", "1080x1920", "-r", "10", "-i", "pipe:0", "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", file], { input: Buffer.concat(angles.map((angle) => Buffer.from(stickFrame(angle)))) });
      assert.equal(result.status, 0, String(result.stderr));
    };
    const acting = path.join(dir, "acting.mp4"), held = path.join(dir, "held.mp4");
    encode(acting, [0, 6, 12, 18, 24, 30, 24, 18, 12, 6, 0, -6, -12, -6, 0, 6, 12, 18, 24, 30]);
    encode(held, Array(20).fill(12));
    const moving = await analyzeRenderMotion(acting);
    const still = await analyzeRenderMotion(held);
    assert.deepEqual(moving.optical_flow.grid, { width: 180, height: 320 });
    assert.ok(moving.optical_flow.velocity_pixels_per_second.p90 >= 2, `acting p90 ${moving.optical_flow.velocity_pixels_per_second.p90}`);
    assert.equal(still.optical_flow.velocity_pixels_per_second.max, 0);
    const floor = { minimum_flow_velocity_p90: 2 };
    assert.equal(evaluateMotionQuality(moving, floor).findings.some((entry) => /velocity/.test(entry.message)), false);
    assert.equal(evaluateMotionQuality(still, floor).findings.some((entry) => /velocity/.test(entry.message)), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function ffmpegMissing() {
  return spawnSync("ffmpeg", ["-version"]).status === 0 ? false : "ffmpeg is not installed";
}
