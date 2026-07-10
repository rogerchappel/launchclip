import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function analyzeRenderMotion(videoPath, options = {}, adapters = {}) {
  const resolved = path.resolve(videoPath);
  const run = adapters.run ?? runCommand;
  const runRaw = adapters.runRaw ?? (adapters.run ? adapters.run : runRawCommand);
  const probe = JSON.parse((await run("ffprobe", [
    "-v", "error", "-show_entries", "format=duration,size:stream=index,codec_type,width,height,avg_frame_rate,r_frame_rate",
    "-of", "json", resolved
  ])).stdout);
  const video = (probe.streams ?? []).find((entry) => entry.codec_type === "video");
  if (!video) throw new Error(`No video stream found: ${resolved}`);
  const fps = parseRate(video.avg_frame_rate || video.r_frame_rate);
  const diffResult = await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-i", resolved,
    "-vf", "scale=160:-2,format=gray,tblend=all_mode=difference,signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG:file=-",
    "-an", "-f", "null", "-"
  ]);
  const sceneResult = await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-i", resolved,
    "-vf", "scale=180:-2,select='gte(scene,0)',metadata=mode=print:key=lavfi.scene_score:file=-",
    "-an", "-f", "null", "-"
  ]);
  const diff = parseMetadataSeries(`${diffResult.stdout}\n${diffResult.stderr ?? ""}`, "lavfi.signalstats.YAVG");
  const scenes = parseMetadataSeries(`${sceneResult.stdout}\n${sceneResult.stderr ?? ""}`, "lavfi.scene_score");
  const series = analyzeMotionSeries(diff.map((entry) => entry.value), fps, options);
  const sceneThreshold = Number(options.sceneThreshold ?? 0.35);
  const cutFrames = scenes.filter((entry) => entry.value >= sceneThreshold).map((entry) => entry.frame);
  const duration = Number(probe.format?.duration ?? series.frame_count / fps);
  const cuts = cutFrames.map((frame) => frame / fps).filter((time) => time > 0.05 && time < duration - 0.05);
  const flowFps = Number(options.flowFps ?? 10);
  const flowWidth = Number(options.flowWidth ?? 64);
  const flowHeight = Number(options.flowHeight ?? 36);
  const rawFlow = await runRaw("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-i", resolved,
    "-vf", `fps=${flowFps},scale=${flowWidth}:${flowHeight},format=gray`,
    "-an", "-f", "rawvideo", "pipe:1"
  ]);
  const opticalFlow = analyzeBlockMotion(Buffer.isBuffer(rawFlow.stdout) ? rawFlow.stdout : Buffer.from(rawFlow.stdout ?? "", "binary"), flowWidth, flowHeight, flowFps, { ...options, cutTimes: cuts });
  const shotDurations = boundariesToDurations([0, ...cuts, duration]);
  return {
    schema_version: "launchclip.render-motion.v1",
    video: resolved,
    duration_seconds: round(duration),
    width: Number(video.width),
    height: Number(video.height),
    aspect: aspectOf(video.width, video.height),
    fps: round(fps),
    frame_count: series.frame_count,
    cut_threshold: sceneThreshold,
    cuts,
    cut_rate_per_minute: rate(cuts.length, duration),
    shot_duration_seconds: distribution(shotDurations),
    motion_bursts_per_minute: rate(series.bursts.length, duration),
    motion: series,
    optical_flow: opticalFlow,
    family: classifyMotionFamily({ cut_rate_per_minute: rate(cuts.length, duration), hold_ratio: series.hold_ratio, motion_bursts_per_minute: rate(series.bursts.length, duration) })
  };
}

export function analyzeMotionSeries(values, fps, options = {}) {
  const clean = values.map(Number).filter(Number.isFinite);
  if (!clean.length) return { frame_count: 0, change_energy: distribution([]), hold_ratio: 1, burst_threshold: 0, bursts: [], pixel_change_rate: distribution([]), pixel_change_acceleration: distribution([]), pixel_change_deceleration: distribution([]), pixel_change_jerk: distribution([]), frame_difference: [] };
  const baseline = median(clean);
  const mad = median(clean.map((value) => Math.abs(value - baseline)));
  const threshold = Number(options.burstThreshold ?? baseline + Math.max(mad * 4, 0.45));
  const holdThreshold = Number(options.holdThreshold ?? baseline + Math.max(mad, 0.12));
  const changeRate = clean.map((value) => value / 255);
  const changeAcceleration = differences(changeRate).map((value) => value * fps);
  const changeDeceleration = changeAcceleration.filter((value) => value < 0).map(Math.abs);
  const changeJerk = differences(changeAcceleration).map((value) => value * fps);
  const bursts = groupBursts(clean, threshold, fps, Number(options.mergeGapFrames ?? Math.max(1, Math.round(fps * 0.08))));
  return {
    frame_count: clean.length,
    change_energy: distribution(clean),
    hold_ratio: round(clean.filter((value) => value <= holdThreshold).length / clean.length, 4),
    burst_threshold: round(threshold, 5),
    hold_threshold: round(holdThreshold, 5),
    bursts,
    pixel_change_rate: distribution(changeRate),
    pixel_change_acceleration: signedDistribution(changeAcceleration),
    pixel_change_deceleration: distribution(changeDeceleration),
    pixel_change_jerk: signedDistribution(changeJerk),
    frame_difference: clean.map((value, index) => ({ frame: index, at_seconds: round(index / fps, 4), energy: round(value, 5) }))
  };
}

export function analyzeBlockMotion(rawFrames, width, height, fps, options = {}) {
  const frameSize = width * height;
  const count = Math.floor(rawFrames.length / frameSize);
  const block = Number(options.flowBlockSize ?? 6);
  const radius = Number(options.flowSearchRadius ?? 2);
  const cutTimes = options.cutTimes ?? [];
  const magnitudes = [];
  const samples = [];
  for (let frame = 1; frame < count; frame += 1) {
    const at = frame / fps;
    if (cutTimes.some((time) => Math.abs(time - at) <= 1 / fps)) continue;
    const previousOffset = (frame - 1) * frameSize;
    const currentOffset = frame * frameSize;
    const vectors = [];
    for (let y = radius; y + block + radius < height; y += block) {
      for (let x = radius; x + block + radius < width; x += block) {
        if (blockTexture(rawFrames, previousOffset, width, x, y, block) < Number(options.flowTextureThreshold ?? 5)) continue;
        let bestSad = Infinity;
        let bestMagnitude = 0;
        for (let dy = -radius; dy <= radius; dy += 1) {
          for (let dx = -radius; dx <= radius; dx += 1) {
            const sad = blockSad(rawFrames, previousOffset, currentOffset, width, x, y, dx, dy, block);
            if (sad < bestSad) { bestSad = sad; bestMagnitude = Math.hypot(dx, dy); }
          }
        }
        vectors.push(bestMagnitude * fps);
      }
    }
    const magnitude = vectors.length ? quantile(vectors.sort((a, b) => a - b), .75) : 0;
    magnitudes.push(magnitude);
    samples.push({ frame, at_seconds: round(at, 4), pixels_per_second: round(magnitude, 4), tracked_blocks: vectors.length });
  }
  const acceleration = differences(magnitudes).map((value) => value * fps);
  const deceleration = acceleration.filter((value) => value < 0).map(Math.abs);
  const jerk = differences(acceleration).map((value) => value * fps);
  return {
    method: "block-matching",
    sample_fps: fps,
    block_size: block,
    search_radius: radius,
    tracked_frame_pairs: magnitudes.length,
    velocity_pixels_per_second: distribution(magnitudes),
    acceleration_pixels_per_second_squared: signedDistribution(acceleration),
    deceleration_pixels_per_second_squared: distribution(deceleration),
    jerk_pixels_per_second_cubed: signedDistribution(jerk),
    samples
  };
}

function blockTexture(buffer, offset, width, x, y, block) {
  let sum = 0;
  let sumSquares = 0;
  for (let row = 0; row < block; row += 1) for (let column = 0; column < block; column += 1) {
    const value = buffer[offset + (y + row) * width + x + column];
    sum += value;
    sumSquares += value * value;
  }
  const count = block * block;
  const mean = sum / count;
  return Math.sqrt(Math.max(0, sumSquares / count - mean * mean));
}

function blockSad(buffer, previousOffset, currentOffset, width, x, y, dx, dy, block) {
  let sad = 0;
  for (let row = 0; row < block; row += 1) for (let column = 0; column < block; column += 1) {
    sad += Math.abs(buffer[previousOffset + (y + row) * width + x + column] - buffer[currentOffset + (y + row + dy) * width + x + column + dx]);
  }
  return sad;
}

export function compareMotionProfiles(candidate, references) {
  if (!references?.length) return { compatible_family: null, references: [], summary: null };
  const sameFamily = references.filter((entry) => entry.family === candidate.family);
  const selected = sameFamily.length ? sameFamily : references;
  const referenceEnvelope = {
    cut_rate_per_minute: distribution(selected.map((entry) => entry.cut_rate_per_minute)),
    motion_bursts_per_minute: distribution(selected.map((entry) => entry.motion_bursts_per_minute)),
    hold_ratio: distribution(selected.map((entry) => entry.motion.hold_ratio))
  };
  const distances = selected.map((reference) => ({
    video: reference.video,
    family: reference.family,
    change_energy_wasserstein: round(wassersteinQuantiles(
      candidate.motion.frame_difference.map((entry) => entry.energy),
      reference.motion.frame_difference.map((entry) => entry.energy)
    ), 5),
    flow_velocity_wasserstein: flowDistance(candidate, reference, "velocity"),
    flow_acceleration_wasserstein: flowDistance(candidate, reference, "acceleration"),
    flow_deceleration_wasserstein: flowDistance(candidate, reference, "deceleration"),
    flow_jerk_wasserstein: flowDistance(candidate, reference, "jerk"),
    flow_velocity_temporal_dtw: round(temporalDtw(flowSeries(candidate).velocity, flowSeries(reference).velocity), 5),
    cut_rate_delta: round(candidate.cut_rate_per_minute - reference.cut_rate_per_minute, 3),
    burst_rate_delta: round(candidate.motion_bursts_per_minute - reference.motion_bursts_per_minute, 3),
    hold_ratio_delta: round(candidate.motion.hold_ratio - reference.motion.hold_ratio, 4)
  }));
  return {
    compatible_family: sameFamily.length ? candidate.family : null,
    references: distances,
    reference_envelope: referenceEnvelope,
    summary: {
      cut_rate_position: envelopePosition(candidate.cut_rate_per_minute, referenceEnvelope.cut_rate_per_minute),
      burst_rate_position: envelopePosition(candidate.motion_bursts_per_minute, referenceEnvelope.motion_bursts_per_minute),
      hold_ratio_position: envelopePosition(candidate.motion.hold_ratio, referenceEnvelope.hold_ratio)
    }
  };
}

function flowSeries(profile) {
  const flow = profile.optical_flow ?? {};
  const fps = Number(flow.sample_fps ?? 1);
  const velocity = (flow.samples ?? []).map((entry) => Number(entry.pixels_per_second)).filter(Number.isFinite);
  const acceleration = differences(velocity).map((value) => value * fps);
  return {
    velocity,
    acceleration,
    deceleration: acceleration.filter((value) => value < 0).map(Math.abs),
    jerk: differences(acceleration).map((value) => value * fps)
  };
}

function flowDistance(left, right, key) {
  const a = flowSeries(left)[key];
  const b = flowSeries(right)[key];
  return a.length && b.length ? round(wassersteinQuantiles(a, b), 5) : null;
}

function temporalDtw(left, right, maximumPoints = 600) {
  const a = resampleSeries(left, maximumPoints);
  const b = resampleSeries(right, maximumPoints);
  if (!a.length || !b.length) return NaN;
  const window = Math.max(Math.abs(a.length - b.length), Math.ceil(Math.max(a.length, b.length) * .15));
  let previous = new Float64Array(b.length + 1).fill(Infinity);
  previous[0] = 0;
  for (let row = 1; row <= a.length; row += 1) {
    const current = new Float64Array(b.length + 1).fill(Infinity);
    const start = Math.max(1, row - window);
    const end = Math.min(b.length, row + window);
    for (let column = start; column <= end; column += 1) {
      current[column] = Math.abs(a[row - 1] - b[column - 1]) + Math.min(previous[column], current[column - 1], previous[column - 1]);
    }
    previous = current;
  }
  return previous[b.length] / (a.length + b.length);
}

function resampleSeries(values, maximumPoints) {
  const clean = values.map(Number).filter(Number.isFinite);
  if (clean.length <= maximumPoints) return clean;
  return Array.from({ length: maximumPoints }, (_, index) => clean[Math.round(index * (clean.length - 1) / (maximumPoints - 1))]);
}

export function evaluateMotionQuality(metrics, expected = {}) {
  const findings = [];
  if (expected.duration_seconds != null && Math.abs(metrics.duration_seconds - expected.duration_seconds) > Number(expected.duration_tolerance_seconds ?? 0.15)) {
    findings.push(finding("duration", "blocking", `Rendered duration is ${metrics.duration_seconds}s; expected ${expected.duration_seconds}s.`));
  }
  if (expected.width && metrics.width !== expected.width || expected.height && metrics.height !== expected.height) {
    findings.push(finding("dimensions", "blocking", `Rendered dimensions are ${metrics.width}×${metrics.height}; expected ${expected.width}×${expected.height}.`));
  }
  if (!metrics.frame_count) findings.push(finding("frames", "blocking", "No frame-difference samples were produced."));
  if (metrics.motion.hold_ratio > Number(expected.maximum_hold_ratio ?? 0.985)) findings.push(finding("motion", "major", `Frame-difference analysis reports ${(metrics.motion.hold_ratio * 100).toFixed(1)}% near-static frames.`));
  if (metrics.motion_bursts_per_minute < Number(expected.minimum_bursts_per_minute ?? 4)) findings.push(finding("motion", "major", `Only ${metrics.motion_bursts_per_minute.toFixed(1)} meaningful motion bursts per minute were detected.`));
  return { ok: !findings.some((entry) => entry.severity === "blocking" || entry.severity === "major"), findings };
}

export async function writeMotionReport(videoPath, outputPath, options = {}, adapters = {}) {
  const metrics = await analyzeRenderMotion(videoPath, options, adapters);
  const references = [];
  for (const reference of options.references ?? []) references.push(await analyzeRenderMotion(reference, options, adapters));
  const report = {
    ...metrics,
    comparison: compareMotionProfiles(metrics, references),
    quality: evaluateMotionQuality(metrics, options.expected ?? {})
  };
  await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await writeFile(path.resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export function parseMetadataSeries(text, key) {
  const output = [];
  let frame = -1;
  for (const line of String(text).split(/\r?\n/)) {
    const frameMatch = line.match(/^frame:(\d+)/);
    if (frameMatch) frame = Number(frameMatch[1]);
    const valueMatch = line.match(new RegExp(`^${escapeRegExp(key)}=([-+0-9.eE]+)`));
    if (valueMatch) output.push({ frame: frame >= 0 ? frame : output.length, value: Number(valueMatch[1]) });
  }
  return output.filter((entry) => Number.isFinite(entry.value));
}

export function classifyMotionFamily(metrics) {
  if (metrics.cut_rate_per_minute >= 15) return "rapid-hybrid";
  if (metrics.cut_rate_per_minute < 8 && metrics.hold_ratio >= 0.8) return "continuous-graphic";
  if (metrics.cut_rate_per_minute < 8 && metrics.motion_bursts_per_minute >= 12) return "developing-card";
  return "mixed-editorial";
}

function groupBursts(values, threshold, fps, mergeGap) {
  const ranges = [];
  let start = null;
  let last = null;
  let peak = 0;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] > threshold) {
      if (start == null || index - last > mergeGap) {
        if (start != null) ranges.push(burst(start, last, peak, fps));
        start = index;
        peak = values[index];
      }
      last = index;
      peak = Math.max(peak, values[index]);
    }
  }
  if (start != null) ranges.push(burst(start, last, peak, fps));
  return ranges;
}

function burst(start, end, peak, fps) {
  return { start_frame: start, end_frame: end, start_seconds: round(start / fps, 4), end_seconds: round(end / fps, 4), duration_seconds: round((end - start + 1) / fps, 4), peak_energy: round(peak, 5) };
}

function distribution(values) {
  const clean = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return { count: 0, min: null, p10: null, p25: null, p50: null, p75: null, p90: null, p95: null, max: null, mean: null };
  return { count: clean.length, min: round(clean[0]), p10: round(quantile(clean, .1)), p25: round(quantile(clean, .25)), p50: round(quantile(clean, .5)), p75: round(quantile(clean, .75)), p90: round(quantile(clean, .9)), p95: round(quantile(clean, .95)), max: round(clean.at(-1)), mean: round(clean.reduce((sum, value) => sum + value, 0) / clean.length) };
}

function signedDistribution(values) {
  return { ...distribution(values.map(Math.abs)), signed_mean: values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null };
}

function wassersteinQuantiles(left, right, samples = 101) {
  const a = left.map(Number).filter(Number.isFinite).sort((x, y) => x - y);
  const b = right.map(Number).filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length || !b.length) return Infinity;
  let total = 0;
  for (let index = 0; index < samples; index += 1) {
    const q = index / (samples - 1);
    total += Math.abs(quantile(a, q) - quantile(b, q));
  }
  return total / samples;
}

function envelopePosition(value, envelope) {
  if (value < envelope.p25) return "below-reference-iqr";
  if (value > envelope.p75) return "above-reference-iqr";
  return "inside-reference-iqr";
}

function boundariesToDurations(boundaries) {
  return boundaries.slice(1).map((value, index) => value - boundaries[index]).filter((value) => value > 0);
}

function differences(values) {
  return values.slice(1).map((value, index) => value - values[index]);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return quantile(sorted, .5);
}

function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function parseRate(value) {
  const [numerator, denominator = "1"] = String(value ?? "0").split("/");
  const rate = Number(numerator) / Number(denominator);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error(`Invalid frame rate: ${value}`);
  return rate;
}

function aspectOf(width, height) {
  const ratio = Number(width) / Number(height);
  if (Math.abs(ratio - 16 / 9) < .03) return "16:9";
  if (Math.abs(ratio - 9 / 16) < .03) return "9:16";
  if (Math.abs(ratio - 1) < .03) return "1:1";
  return `${width}:${height}`;
}

function rate(count, duration) {
  return duration > 0 ? round(count * 60 / duration, 3) : 0;
}

function finding(category, severity, message) {
  return { category, severity, message };
}

function round(value, places = 5) {
  const factor = 10 ** places;
  return Math.round(Number(value) * factor) / factor;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function runCommand(command, args) {
  return execFileAsync(command, args, { maxBuffer: 1024 * 1024 * 128 });
}

async function runRawCommand(command, args) {
  return execFileAsync(command, args, { encoding: null, maxBuffer: 1024 * 1024 * 128 });
}
