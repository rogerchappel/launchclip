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
  parseMetadataSeries,
  STILLNESS,
  analyzeStillness,
  analyzeZoom,
  cameraMoves,
  globalMotion,
  stillnessFromEnergy,
  stillnessGrid,
  suggestStillFix,
  worstStillSpans,
  zoomDetectGrid
} from "../src/render_motion_analysis.js";
import { cinematicMotionExpectations } from "../src/cinematic_check.js";
import { assessCinematicReadiness } from "../src/production_readiness.js";
import { validateCritique } from "../src/production_contracts.js";

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
  assert.equal(rawCalls, 3, "one raw pass for stillness, one for optical flow, one for zoom detection");
  assert.deepEqual(metrics.motion.zoom_events, []);
  assert.equal(metrics.motion.zoom.method, "scale-fit");
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
  assert.ok(commands.some((args) => /scale=180:320:flags=area/.test(args.join(" "))), "the flow pass reads 180×320");
  assert.ok(commands.some((args) => /fps=30,scale=144:256:flags=area/.test(args.join(" "))), "the zoom pass reads every frame at 144×256");
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

// --- Absolute stillness -----------------------------------------------------

// A 72×128 grey frame: a textured background with a bright square at (x, y).
function stillFrame(x = 20, y = 40, { size = 16, shift = 0 } = {}) {
  const width = 72, height = 128;
  const frame = new Uint8Array(width * height);
  for (let row = 0; row < height; row += 1) for (let column = 0; column < width; column += 1) {
    const u = column + shift;
    // Blocky noise: 4×4 cells of a hashed grey, so a shift is unambiguous.
    const cell = Math.imul((u >> 2) + 1000, 73856093) ^ Math.imul((row >> 2) + 1000, 19349663);
    frame[row * width + column] = 40 + ((cell >>> 0) % 160);
  }
  for (let row = y; row < y + size; row += 1) for (let column = x; column < x + size; column += 1) if (row >= 0 && row < height && column >= 0 && column < width) frame[row * width + column] = 250;
  return frame;
}

const series = (frames) => Buffer.concat(frames.map((frame) => Buffer.from(frame)));

test("stillnessGrid reads 72×128 portrait, 128×72 landscape and 72×72 square", () => {
  assert.deepEqual(stillnessGrid(1080, 1920), { width: 72, height: 128 });
  assert.deepEqual(stillnessGrid(1920, 1080), { width: 128, height: 72 });
  assert.deepEqual(stillnessGrid(1080, 1080), { width: 72, height: 72 });
});

test("stillnessFromEnergy: share, longest mid-video run, closing hold, spans and per-second energy", () => {
  // 30 fps: 0.5 s moving, 0.9 s still, 0.5 s moving, 0.2 s still, 0.5 s moving, then a 1 s end hold.
  const energy = [...Array(15).fill(2), ...Array(27).fill(0.1), ...Array(15).fill(3), ...Array(6).fill(0.2), ...Array(15).fill(2.5), ...Array(30).fill(0)];
  const result = stillnessFromEnergy(energy, 30);
  assert.equal(result.still_share, Number(((27 + 6 + 30) / energy.length).toFixed(4)));
  assert.equal(result.longest_still_seconds, 0.9, "the end hold does not count");
  assert.equal(result.closing_hold_seconds, 1);
  assert.deepEqual(result.still_spans, [{ start: 0.5, end: 1.4, seconds: 0.9 }, { start: 2.6, end: 3.6, seconds: 1, closing: true }]);
  assert.equal(result.energy_per_second.length, 4);
  assert.ok(result.energy_per_second[0] > 1 && result.energy_per_second.at(-1) < 0.5);
  // A run that ends just before the last frames (a fade's last wobble) is still the closing hold.
  const tail = stillnessFromEnergy([...Array(30).fill(2), ...Array(36).fill(0), ...Array(5).fill(1)], 30);
  assert.equal(tail.closing_hold_seconds, 1.2);
  assert.equal(tail.longest_still_seconds, 0);
  assert.deepEqual(stillnessFromEnergy([], 30).still_spans, []);
});

test("analyzeStillness measures mean frame change on raw frames and finds whole-frame shifts", () => {
  const moving = Array.from({ length: 31 }, (_, index) => stillFrame(4 + index, 40, { size: 24 }));
  const held = Array.from({ length: 30 }, () => stillFrame(34, 40, { size: 24 }));
  const result = analyzeStillness(series([...moving, ...held, ...moving]), 72, 128, 30);
  assert.equal(result.method.grid.width, 72);
  assert.equal(result.method.threshold, STILLNESS.threshold);
  assert.equal(result.still_spans.length, 1);
  assert.equal(result.still_spans[0].seconds, 1);
  assert.ok(Math.abs(result.still_spans[0].start - 1) < 0.05, `held from ${result.still_spans[0].start}`);
  assert.equal(result.longest_still_seconds, 1);
  assert.equal(result.still_share, Number((30 / 91).toFixed(4)));
  assert.deepEqual(result.shift_times, [], "a small object moving is not a camera move");
  // The whole frame panning 3 px per frame is a camera move.
  const pan = Array.from({ length: 10 }, (_, index) => stillFrame(20 - index * 3, 40, { shift: index * 3 }));
  const panned = analyzeStillness(series(pan), 72, 128, 30, { shiftEnergy: 0 });
  assert.equal(panned.shift_times.length, 9);
  assert.equal(panned.still_share, 0);
  assert.equal(analyzeStillness(Buffer.alloc(10), 72, 128, 30).still_share, null, "too few frames is unmeasured");
});

test("globalMotion fits pans and zooms to the moving blocks; cameraMoves merges events", () => {
  const blocks = (fn) => { const out = []; for (let y = 10; y < 300; y += 20) for (let x = 10; x < 170; x += 20) out.push({ x, y, ...fn(x - 90, y - 160) }); return out; };
  const pan = blocks(() => ({ dx: 3, dy: 0 }));
  assert.equal(globalMotion(pan.map((entry) => ({ ...entry, magnitude: 3 })), pan.length, 180, 320).kind, "pan");
  const zoom = blocks((rx, ry) => ({ dx: Math.round(rx * 0.04), dy: Math.round(ry * 0.04) }));
  assert.equal(globalMotion(zoom, zoom.length, 180, 320).kind, "zoom");
  let seed = 7;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return (seed >> 8) % 7 - 3; };
  const scattered = blocks(() => ({ dx: random(), dy: random() }));
  assert.equal(globalMotion(scattered, scattered.length, 180, 320), null, "independent motion is not a camera move");
  const camera = cameraMoves({ still_share: 0.1, shift_times: [1, 1.033, 1.067, 4] }, { samples: [{ at_seconds: 4.1, camera: { kind: "zoom" } }, { at_seconds: 9, camera: { kind: "pan" } }] });
  assert.deepEqual(camera, { count: 3, events: [{ at: 1, kind: "shift" }, { at: 4, kind: "zoom" }, { at: 9, kind: "pan" }] });
  assert.equal(cameraMoves({ still_share: null }, { samples: [] }).count, null);
});

test("each still span gets a fix: zoom-kick, drift, whip, dot-wipe or new visual", () => {
  assert.equal(suggestStillFix({ start: 1, end: 1.5, seconds: 0.5 }, []).fix, "zoom-kick");
  assert.equal(suggestStillFix({ start: 1, end: 2, seconds: 1 }, []).fix, "drift");
  assert.equal(suggestStillFix({ start: 1, end: 1.5, seconds: 0.5 }, [1.55]).fix, "whip");
  assert.equal(suggestStillFix({ start: 1, end: 2, seconds: 1 }, [2.1]).fix, "dot-wipe");
  assert.equal(suggestStillFix({ start: 1, end: 3, seconds: 2 }, [3]).fix, "new visual");
  const metrics = { cuts: [5.1], motion: { still_spans: [{ start: 1, end: 1.4, seconds: 0.4 }, { start: 4.2, end: 5.1, seconds: 0.9 }, { start: 8, end: 9, seconds: 1, closing: true }] } };
  assert.deepEqual(worstStillSpans(metrics).map((span) => [span.start, span.fix]), [[4.2, "dot-wipe"], [1, "zoom-kick"]], "worst first, the closing hold left out");
});

function stillMetrics({ still_share, longest_still_seconds, spans = [], energy = 3 }) {
  return {
    duration_seconds: 60, width: 1080, height: 1920, frame_count: 1800, cuts: [20],
    motion: { hold_ratio: 0.6, change_energy: { p50: energy }, bursts: [{ start_seconds: 0 }, { start_seconds: 0.5 }, { start_seconds: 1 }, { start_seconds: 1.5 }], still_share, longest_still_seconds, still_spans: spans, stillness: { threshold: 0.4 } },
    motion_bursts_per_minute: 60,
    optical_flow: { velocity_pixels_per_second: { p90: 8 }, samples: [] }
  };
}

test("the motion gate fails a render that sits still and lists its worst spans with fixes", () => {
  const { expected } = cinematicMotionExpectations({ duration: 60, width: 1080, height: 1920 });
  assert.equal(expected.maximum_still_share, 0.1);
  assert.equal(expected.maximum_longest_still_seconds, 0.6);
  const moving = stillMetrics({ still_share: 0.02, longest_still_seconds: 0.1 });
  assert.deepEqual(evaluateMotionQuality(moving, expected).findings, []);
  const spans = [{ start: 7.667, end: 8.567, seconds: 0.9 }, { start: 19.2, end: 20, seconds: 0.8 }, { start: 30, end: 30.4, seconds: 0.4 }, { start: 58.9, end: 60, seconds: 1.1, closing: true }];
  const holding = stillMetrics({ still_share: 0.46, longest_still_seconds: 0.9, spans });
  const result = evaluateMotionQuality(holding, expected);
  assert.equal(result.ok, false);
  const summary = result.findings.filter((entry) => entry.measure);
  assert.deepEqual(summary.map((entry) => entry.measure), ["still_share", "longest_still_seconds"]);
  assert.match(summary[0].message, /46\.0% of frame pairs are near-still.*at most 10\.0%.*0:07\.67–0:08\.57 \(0\.90 s, drift\)/);
  const perSpan = result.findings.filter((entry) => entry.category === "stillness" && entry.start_seconds != null);
  assert.deepEqual(perSpan.map((entry) => [entry.start_seconds, entry.end_seconds, entry.fix]), [[7.667, 8.567, "drift"], [19.2, 20, "dot-wipe"], [30, 30.4, "zoom-kick"]]);
  assert.ok(perSpan.every((entry) => entry.instruction && entry.severity === "major"));
  // Only the longest run over its ceiling: the spans listed are the ones over it.
  const one = evaluateMotionQuality(stillMetrics({ still_share: 0.05, longest_still_seconds: 0.9, spans }), expected);
  assert.deepEqual(one.findings.filter((entry) => entry.start_seconds != null).map((entry) => entry.start_seconds), [7.667, 19.2]);
  // Unmeasured stillness (an older report) is not a failure.
  assert.deepEqual(evaluateMotionQuality(stillMetrics({ still_share: null, longest_still_seconds: null }), expected).findings, []);
});

test("stillness ceilings come from the profile, else from defaults by format; talking heads stay loose", () => {
  const measured = { id: "reel", format: "motion", provenance: { kind: "measured" }, measures: { still_share: { p90: 0.1886 }, longest_still_seconds: { p90: 0.433 }, change_energy_p50: { p10: 1.619 }, first_motion_seconds: { p90: 0 }, camera_moves_per_min: { p10: 8.629 } } };
  const reel = cinematicMotionExpectations({ duration: 60, width: 1080, height: 1920, profile: measured }).expected;
  assert.deepEqual([reel.maximum_still_share, reel.maximum_longest_still_seconds, reel.minimum_change_energy_p50, reel.maximum_first_motion_seconds, reel.minimum_camera_moves_per_minute], [0.1886, 0.433, 1.619, 0.1, 8.629]);
  // A reference measured into the profile passes it at the stored precision.
  const reference = stillMetrics({ still_share: 0.18857, longest_still_seconds: 0.433, energy: 1.61897 });
  reference.motion.camera_moves_per_minute = 8.62899;
  assert.equal(evaluateMotionQuality(reference, reel).ok, true);
  const ours = stillMetrics({ still_share: 0.4558, longest_still_seconds: 1, energy: 0.617 });
  ours.motion.camera_moves_per_minute = 0;
  const failed = evaluateMotionQuality(ours, reel);
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.findings.filter((entry) => entry.measure).map((entry) => entry.measure), ["still_share", "longest_still_seconds", "camera_moves_per_min"]);
  assert.equal(cinematicMotionExpectations({ duration: 60, width: 1080, height: 1920 }).expected.minimum_camera_moves_per_minute, null, "no camera-move floor without a measured band");
  const head = { id: "head", format: "footage-led", provenance: { kind: "seed" }, measures: { hold_ratio: { p90: 0.995 } } };
  const talking = cinematicMotionExpectations({ duration: 30, width: 1080, height: 1920, profile: head }).expected;
  assert.equal(talking.maximum_still_share, null, "a locked-off talking head has no still-share ceiling");
  assert.equal(talking.maximum_longest_still_seconds, 4, "only a frozen picture fails it");
  const locked = stillMetrics({ still_share: 0.9, longest_still_seconds: 3, energy: 0.05 });
  assert.equal(evaluateMotionQuality(locked, talking).findings.filter((entry) => entry.category === "stillness").length, 0);
  const demo = cinematicMotionExpectations({ duration: 30, width: 1920, height: 1080, profile: { ...head, format: "demo-led" } }).expected;
  assert.deepEqual([demo.maximum_still_share, demo.maximum_longest_still_seconds], [0.25, 1.5]);
});

test("still-span findings become timed repair findings the critique contract accepts", () => {
  const { expected } = cinematicMotionExpectations({ duration: 60, width: 1080, height: 1920 });
  const quality = evaluateMotionQuality(stillMetrics({ still_share: 0.46, longest_still_seconds: 0.9, spans: [{ start: 7.667, end: 8.567, seconds: 0.9 }] }), expected);
  const readiness = assessCinematicReadiness({
    concepts: { selected_id: "c" }, story: { concept_id: "c" }, narration: { words: [] }, plan: { shots: [{ id: "shot-1" }] },
    verification: { status: "passed", failed: [] }, motion: { quality }, audio: { quality: { ok: true, findings: [] } },
    critique: { verdict: "ship", findings: [] }, assembly: { fallback_count: 0, fallbacks: [] }
  });
  assert.equal(readiness.gates.motion.ok, false);
  const timed = readiness.repair_findings.filter((entry) => entry.start_seconds != null);
  assert.equal(timed.length, 1);
  assert.deepEqual([timed[0].start_seconds, timed[0].end_seconds, timed[0].category, timed[0].repair_scope], [7.667, 8.567, "motion", "plan"]);
  assert.match(timed[0].instruction, /7\.67s and 8\.57s.*drift/);
  assert.ok(readiness.repair_findings.some((entry) => /zoom-kick, drift/.test(entry.instruction)), "the summary finding names the fixes");
  const check = validateCritique({ schema_version: "launchclip.production-critique.v1", verdict: "repair", summary: "readiness", findings: readiness.repair_findings }, ["shot-1"]);
  assert.deepEqual(check.errors.filter((error) => !/schema_version/.test(error)), []);
});

// A textured 144×256 grey frame of a smooth pattern, scaled by `scale` about
// the centre and shifted by (tx, ty) px.
function zoomFrame({ scale = 1, tx = 0, ty = 0 }, width = 144, height = 256) {
  const out = new Uint8Array(width * height);
  const pattern = (x, y) => 128 + 40 * Math.sin(x * 0.21 + Math.sin(y * 0.05) * 2) + 35 * Math.sin(y * 0.17 + x * 0.03) + 25 * Math.sin((x + y) * 0.11);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const sx = width / 2 + (x - width / 2 - tx) / scale, sy = height / 2 + (y - height / 2 - ty) / scale;
    out[y * width + x] = Math.max(0, Math.min(255, Math.round(pattern(sx, sy))));
  }
  return out;
}
const zoomClip = (at, frames = 30) => series(Array.from({ length: frames }, (_, f) => zoomFrame(at(f / 30))));
const punch = (u) => 1 - (1 - u) ** 2;
// A kinetic-feel kick: from 1 to S over 0.12 s (power2.out) at 0.3 s, then held.
const kickAt = (S, from = 1) => (t) => ({ scale: t < 0.3 ? from : t < 0.42 ? from + (S - from) * punch((t - 0.3) / 0.12) : S });

test("analyzeZoom detects a quick centred zoom kick that the flow and phase correlation miss", () => {
  const kick = analyzeZoom(zoomClip(kickAt(1.05)), 144, 256, 30);
  assert.equal(kick.events.length, 1);
  assert.ok(Math.abs(kick.events[0].at - 0.333) < 0.04, `at ${kick.events[0].at}`);
  assert.ok(Math.abs(kick.events[0].scale - 1.05) < 0.006, `scale ${kick.events[0].scale}`);
  assert.deepEqual(kick.zoom_times, [kick.events[0].at]);
  // A content-safe kick reduced to ×1.037 still counts; a zoom out counts too.
  assert.equal(analyzeZoom(zoomClip(kickAt(1.037)), 144, 256, 30).events.length, 1);
  const out = analyzeZoom(zoomClip(kickAt(1, 1.05)), 144, 256, 30).events;
  assert.equal(out.length, 1);
  assert.ok(out[0].scale < 0.96);
  // A kick with the ambient drift moving the frame at the same time.
  assert.equal(analyzeZoom(zoomClip((t) => ({ ...kickAt(1.05)(t), tx: t * 9, ty: -t * 15 })), 144, 256, 30).events.length, 1);
  // Not zooms: a held frame, a pan and the ambient breathing (×1.02–1.045 over 4 s).
  assert.deepEqual(analyzeZoom(zoomClip(() => ({ scale: 1 })), 144, 256, 30).events, []);
  assert.deepEqual(analyzeZoom(zoomClip((t) => ({ tx: t * 60 })), 144, 256, 30).events, []);
  assert.deepEqual(analyzeZoom(zoomClip((t) => ({ scale: 1.0325 + 0.0125 * Math.sin((2 * Math.PI * t) / 4) }), 60), 144, 256, 30).events, []);
  // A figure growing in the lower half under a title that holds still is not
  // a whole-frame zoom, though the per-pair fit alone can mistake it for one.
  const figure = (t) => {
    const grow = kickAt(1.12)(t).scale, moving = zoomFrame({ scale: grow, ty: 40 * (grow - 1) }), held = zoomFrame({ scale: 1 });
    const out = new Uint8Array(144 * 256);
    out.set(held.subarray(0, 144 * 100));
    out.set(moving.subarray(144 * 100), 144 * 100);
    return out;
  };
  assert.deepEqual(analyzeZoom(series(Array.from({ length: 30 }, (_, f) => figure(f / 30))), 144, 256, 30).events, []);
  // A cut between two unrelated frames is skipped when it is a known cut.
  const cut = series([...Array.from({ length: 10 }, () => zoomFrame({ scale: 1 })), ...Array.from({ length: 10 }, () => zoomFrame({ scale: 1.3, tx: 20 }))]);
  assert.deepEqual(analyzeZoom(cut, 144, 256, 30, { cutTimes: [10 / 30] }).events, []);
  assert.equal(analyzeZoom(Buffer.alloc(10), 144, 256, 30).events.length, 0, "too few frames");
  assert.deepEqual(zoomDetectGrid(1080, 1920), { width: 144, height: 256 });
  assert.deepEqual(zoomDetectGrid(1920, 1080), { width: 256, height: 144 });
});

test("cameraMoves counts the 30 fps zoom events alongside shifts and flow moves", () => {
  const camera = cameraMoves({ still_share: 0.1, shift_times: [1], zoom_times: [2.3, 6] }, { samples: [{ at_seconds: 6.1, camera: { kind: "pan" } }] });
  assert.deepEqual(camera, { count: 3, events: [{ at: 1, kind: "shift" }, { at: 2.3, kind: "zoom" }, { at: 6, kind: "zoom" }] });
});

test("block matching is sub-pixel, so the flow velocity is continuous rather than quantised", () => {
  // The same texture panning 1.0, 1.3, 1.6 and 2.2 px a frame (on the 36-px
  // reference scale, at 10 fps): the measured velocity follows the shift,
  // not the whole-pixel steps.
  const measure = (step) => {
    const frames = Array.from({ length: 8 }, (_, f) => zoomFrame({ tx: f * step }));
    return analyzeBlockMotion(series(frames), 144, 256, 10, { velocityScale: 1 }).velocity_pixels_per_second.p50;
  };
  const speeds = [1, 1.3, 1.6, 2.2].map(measure);
  for (const [i, step] of [1, 1.3, 1.6, 2.2].entries()) assert.ok(Math.abs(speeds[i] - step * 10) < 1.5, `${step} px/frame read ${speeds[i]} px/s`);
  assert.ok(speeds[0] < speeds[1] && speeds[1] < speeds[2] && speeds[2] < speeds[3], `monotonic ${speeds.join(", ")}`);
  assert.ok(new Set(speeds.map((value) => Math.round(value))).size === 4, "no two steps collapse onto one whole-pixel value");
});
