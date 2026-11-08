import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mediaSkip } from "./helpers/media.js";
import { LOOK, analyzeLook, laplacianVariance, lookGrid } from "../src/render_look_analysis.js";
import { analyzeRenderMotion, evaluateMotionQuality } from "../src/render_motion_analysis.js";
import { cinematicMotionExpectations } from "../src/cinematic_check.js";
import { motionMeasures } from "../src/cadence_measures.js";
import { LOOK_MEASURES, MOTION_MEASURES, PROFILE_MEASURES, validateProfile } from "@launchclip/core/profiles.mjs";

const W = 360, H = 640;

// A textured grey frame: 8-px blocks of pseudo-random grey, shifted `shift` px sideways.
function texture(shift = 0, { width = W, height = H, block = 8, low = 0, high = 255 } = {}) {
  const frame = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const bx = Math.floor((x + shift) / block), by = Math.floor(y / block);
    const hash = Math.imul(bx * 73856093 ^ by * 19349663, 2654435761) >>> 0;
    frame[y * width + x] = low + (hash % (high - low + 1));
  }
  return frame;
}

// A horizontal box blur `radius` px either side (a sideways motion smear).
function smear(frame, radius, width = W, height = H) {
  const out = new Uint8Array(frame.length);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    let sum = 0, n = 0;
    for (let dx = -radius; dx <= radius; dx += 1) {
      const xx = Math.min(width - 1, Math.max(0, x + dx));
      sum += frame[y * width + xx]; n += 1;
    }
    out[y * width + x] = Math.round(sum / n);
  }
  return out;
}

function flat(value, width = W, height = H) {
  return new Uint8Array(width * height).fill(value);
}

const join = (frames) => Buffer.concat(frames.map((frame) => Buffer.from(frame)));

// Holds and sideways moves: `blur` smears the moving frames along the move.
function moveSequence(blur) {
  const frames = [];
  let shift = 0;
  for (let round = 0; round < 3; round += 1) {
    for (let i = 0; i < 6; i += 1) frames.push(texture(shift));
    for (let i = 0; i < 6; i += 1) { shift += 24; frames.push(blur ? smear(texture(shift), blur) : texture(shift)); }
  }
  for (let i = 0; i < 6; i += 1) frames.push(texture(shift));
  return frames;
}

test("the look grid has a 360-px short side and the video's aspect", () => {
  assert.deepEqual(lookGrid(1080, 1920), { width: 360, height: 640 });
  assert.deepEqual(lookGrid(720, 1280), { width: 360, height: 640 });
  assert.deepEqual(lookGrid(1920, 1080), { width: 640, height: 360 });
  assert.deepEqual(lookGrid(1080, 1080), { width: 360, height: 360 });
});

test("Laplacian variance: a textured frame is sharp, a smeared one less so, a flat one zero", () => {
  const sharp = laplacianVariance(texture(), W, H);
  const soft = laplacianVariance(smear(texture(), 6), W, H);
  assert.ok(sharp > 1000, `sharp ${sharp}`);
  assert.ok(soft < sharp * LOOK.softSharpness, `soft ${soft} vs sharp ${sharp}`);
  assert.equal(laplacianVariance(flat(80), W, H), 0);
});

test("motion blur on the moves lowers moving_sharpness_ratio; crisp moves hold it near 1", () => {
  const crisp = analyzeLook(join(moveSequence(0)), W, H);
  const blurred = analyzeLook(join(moveSequence(8)), W, H);
  assert.ok(crisp.moving_frames >= 3 && crisp.held_frames >= 3);
  assert.ok(Math.abs(crisp.moving_sharpness_ratio - 1) < 0.1, `crisp ${crisp.moving_sharpness_ratio}`);
  assert.ok(blurred.moving_sharpness_ratio < 0.3, `blurred ${blurred.moving_sharpness_ratio}`);
  // Every smeared frame is also a soft frame.
  assert.equal(crisp.soft_frame_share, 0);
  assert.equal(blurred.soft_frame_share, Number((18 / 42).toFixed(4)));
});

test("a defocused frame among sharp holds counts as soft", () => {
  const frames = [texture(), texture(), texture(), smear(texture(), 6), texture(), texture(), texture(), texture(), texture(), texture()];
  const look = analyzeLook(join(frames), W, H);
  assert.equal(look.soft_frame_share, 0.1);
});

test("single-frame change: p99, max and the mean inside bursts", () => {
  // Holds at 40 with jumps to 60 (change 20) and one to 100 (change 60).
  const values = [40, 40, 60, 40, 40, 100, 40, 40, 40, 40];
  const look = analyzeLook(join(values.map((value) => flat(value))), W, H);
  assert.equal(look.max_change, 60);
  assert.ok(look.change_p99 > 50 && look.change_p99 <= 60, `p99 ${look.change_p99}`);
  assert.equal(look.burst_change_mean, (20 + 20 + 60 + 60) / 4);
  assert.equal(analyzeLook(join([flat(40), flat(40), flat(40)]), W, H).burst_change_mean, null, "no bursts, no mean");
});

test("a glow at the top raises top_light_ratio; a dark top lowers it", () => {
  const lit = flat(30), dim = flat(30);
  for (let i = 0; i < Math.round(H * 0.172) * W; i += 1) { lit[i] = 90; dim[i] = 10; }
  assert.equal(analyzeLook(join([lit, lit, lit]), W, H).top_light_ratio, 3);
  assert.ok(analyzeLook(join([dim, dim]), W, H).top_light_ratio < 1);
  assert.equal(analyzeLook(join([flat(30)]), W, H).top_light_ratio, 1);
});

test("mid-tones are the greys between the background and the ink", () => {
  const frame = flat(5);
  for (let i = 0; i < frame.length / 4; i += 1) frame[i] = 70; // a quarter haze
  for (let i = frame.length / 4; i < frame.length / 2; i += 1) frame[i] = 240; // a quarter ink
  assert.equal(analyzeLook(join([frame, frame]), W, H).midtone_share, 0.25);
  assert.equal(analyzeLook(join([flat(LOOK.midtone[0]), flat(LOOK.midtone[1] + 1)]), W, H).midtone_share, 0.5, "the band's edges: 29 in, 110 out");
});

test("too few frames: the sharpness ratio and burst mean are null, not zero", () => {
  const look = analyzeLook(join([texture()]), W, H);
  assert.equal(look.moving_sharpness_ratio, null);
  assert.equal(look.change_p99, null);
  assert.equal(analyzeLook(Buffer.alloc(0), W, H).frames, 0);
});

// --- Profiles and findings --------------------------------------------------

const FLAT_LOOK = { frames: 1400, moving_sharpness_ratio: 1.77, soft_frame_share: 0.044, change_p99: 27.7, max_change: 61.7, top_light_ratio: 0.73, midtone_share: 0.109, burst_change_mean: 5.37 };
const CINEMATIC_LOOK = { frames: 1375, moving_sharpness_ratio: 0.81, soft_frame_share: 0.144, change_p99: 21.6, max_change: 32.9, top_light_ratio: 1.18, midtone_share: 0.178, burst_change_mean: 6.89 };
const LOOK_BANDS = {
  moving_sharpness_ratio: { p10: 0.69, p50: 0.81, p90: 0.93 },
  soft_frame_share: { p10: 0.122, p50: 0.144, p90: 0.166 },
  change_p99: { p10: 18.4, p50: 21.6, p90: 24.8 },
  top_light_ratio: { p10: 1.0, p50: 1.18, p90: 1.36 },
  midtone_share: { p10: 0.151, p50: 0.178, p90: 0.205 },
  burst_change_mean: { p10: 5.85, p50: 6.89, p90: 7.92 }
};

function reel(look) {
  return {
    duration_seconds: 46, width: 1080, height: 1920, frame_count: 1380, cuts: [],
    motion: { hold_ratio: 0.6, change_energy: { p50: 3 }, bursts: [{ start_seconds: 0 }, { start_seconds: 0.5 }, { start_seconds: 1 }], still_share: 0.02, longest_still_seconds: 0.1, still_spans: [] },
    motion_bursts_per_minute: 30,
    optical_flow: { velocity_pixels_per_second: { p90: 8 }, samples: [] },
    look
  };
}

test("the look measures are profile measures the motion gate reads", () => {
  assert.deepEqual(LOOK_MEASURES, ["moving_sharpness_ratio", "soft_frame_share", "change_p99", "top_light_ratio", "midtone_share", "burst_change_mean"]);
  for (const name of LOOK_MEASURES) assert.ok(PROFILE_MEASURES[name] && MOTION_MEASURES.includes(name), name);
  assert.deepEqual(LOOK_MEASURES.map((name) => PROFILE_MEASURES[name].check), ["max", "min", "max", "min", "min", "min"]);
  const profile = { schema: "launchclip.cadence-profile.v1", id: "look-reel", format: "motion", duration_seconds: [30, 75], references: 0, provenance: { kind: "seed", sources: [], note: "test" }, measures: LOOK_BANDS };
  assert.deepEqual(validateProfile(profile).errors, []);
  assert.match(validateProfile({ ...profile, measures: { soft_frame_share: { p10: 1.2 } } }).errors.join(" "), /share and must be at most 1/);
  assert.deepEqual(Object.fromEntries(LOOK_MEASURES.map((name) => [name, motionMeasures({ look: CINEMATIC_LOOK })[name]])), Object.fromEntries(LOOK_MEASURES.map((name) => [name, CINEMATIC_LOOK[name]])));
});

test("look findings appear only when the profile carries the band, and name their levers", () => {
  const none = cinematicMotionExpectations({ duration: 46, width: 1080, height: 1920 }).expected;
  for (const key of ["maximum_moving_sharpness_ratio", "minimum_soft_frame_share", "maximum_change_p99", "minimum_top_light_ratio", "minimum_midtone_share", "minimum_burst_change_mean"]) assert.equal(none[key], null, key);
  assert.deepEqual(evaluateMotionQuality(reel(FLAT_LOOK), none).findings.filter((entry) => entry.category === "look"), [], "no band, no gate");
  const unbanded = { id: "reel", format: "motion", provenance: { kind: "measured" }, measures: { still_share: { p90: 0.12 } } };
  assert.deepEqual(evaluateMotionQuality(reel(FLAT_LOOK), cinematicMotionExpectations({ duration: 46, width: 1080, height: 1920, profile: unbanded }).expected).findings.filter((entry) => entry.category === "look"), []);

  const profile = { id: "reel", format: "motion", provenance: { kind: "measured" }, measures: LOOK_BANDS };
  const expected = cinematicMotionExpectations({ duration: 46, width: 1080, height: 1920, profile }).expected;
  assert.deepEqual([expected.maximum_moving_sharpness_ratio, expected.minimum_soft_frame_share, expected.maximum_change_p99, expected.minimum_top_light_ratio, expected.minimum_midtone_share, expected.minimum_burst_change_mean], [0.93, 0.122, 24.8, 1.0, 0.151, 5.85]);
  assert.equal(evaluateMotionQuality(reel(CINEMATIC_LOOK), expected).ok, true, "the reference passes its own bands");
  const flat = evaluateMotionQuality(reel(FLAT_LOOK), expected);
  assert.equal(flat.ok, false);
  const look = flat.findings.filter((entry) => entry.category === "look");
  assert.deepEqual(look.map((entry) => entry.measure), LOOK_MEASURES);
  assert.ok(look.every((entry) => entry.severity === "major"));
  const by = Object.fromEntries(look.map((entry) => [entry.measure, entry]));
  assert.equal(by.moving_sharpness_ratio.ceiling, 0.93);
  assert.equal(by.soft_frame_share.floor, 0.122);
  assert.match(by.moving_sharpness_ratio.message, /1\.77× as sharp.*at most 0\.93×.*motion\.blur shutter.*push-blur/);
  assert.match(by.soft_frame_share.message, /4\.4% of frames are soft.*rack-focus entrances \(enter: "focus"\)/);
  assert.match(by.change_p99.message, /27\.7 grey levels \(99th percentile, max 61\.7\).*at most 24\.8/);
  assert.match(by.top_light_ratio.message, /0\.73× as bright.*story\.light/);
  assert.match(by.midtone_share.message, /10\.9% of pixels are mid-tones.*light or haze layers \(story\.light\)/);
  assert.match(by.burst_change_mean.message, /5\.37 grey levels.*light-sweep/);
  // A report without a look pass (an older motion.json) is not judged.
  assert.deepEqual(evaluateMotionQuality(reel(undefined), expected).findings.filter((entry) => entry.category === "look"), []);
});

// --- Encoded media ----------------------------------------------------------

function ffmpegMissing() {
  return spawnSync("ffmpeg", ["-version"]).status === 0 ? false : "ffmpeg is not installed";
}

test("encoded clips: blurred moves read softer than crisp ones, and 720p and 1080p agree", { skip: mediaSkip(ffmpegMissing()) }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "launchclip-look-"));
  try {
    const encode = (file, frames, size) => {
      const result = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", `${W}x${H}`, "-r", "30", "-i", "pipe:0", "-vf", `scale=${size}:flags=neighbor`, "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", file], { input: join(frames), maxBuffer: 1 << 28 });
      assert.equal(result.status, 0, String(result.stderr));
    };
    const crisp = path.join(dir, "crisp.mp4"), blurred = path.join(dir, "blurred.mp4"), small = path.join(dir, "crisp-720.mp4");
    encode(crisp, moveSequence(0), "1080x1920");
    encode(blurred, moveSequence(8), "1080x1920");
    encode(small, moveSequence(0), "720x1280");
    const [a, b, c] = [await analyzeRenderMotion(crisp), await analyzeRenderMotion(blurred), await analyzeRenderMotion(small)];
    assert.deepEqual(a.look.grid, { width: 360, height: 640 });
    assert.equal(a.look.frames, 42);
    assert.ok(b.look.moving_sharpness_ratio < a.look.moving_sharpness_ratio * 0.5, `blurred ${b.look.moving_sharpness_ratio} vs crisp ${a.look.moving_sharpness_ratio}`);
    assert.ok(b.look.soft_frame_share > a.look.soft_frame_share);
    assert.ok(Math.abs(c.look.moving_sharpness_ratio - a.look.moving_sharpness_ratio) < 0.15, `720p ${c.look.moving_sharpness_ratio} vs 1080p ${a.look.moving_sharpness_ratio}`);
    assert.ok(Math.abs(c.look.midtone_share - a.look.midtone_share) < 0.03);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
