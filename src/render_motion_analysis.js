import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { LOOK, lookAccumulator, lookFrameArgs, lookGrid, streamRawFrames } from "./render_look_analysis.js";

const execFileAsync = promisify(execFile);

export async function analyzeRenderMotion(videoPath, options = {}, adapters = {}) {
  const resolved = path.resolve(videoPath);
  const run = adapters.run ?? runCommand;
  const runRaw = adapters.runRaw ?? (adapters.run ? adapters.run : runRawCommand);
  const probe = JSON.parse((await run("ffprobe", [
    "-v", "error", "-count_frames", "-show_entries", "format=duration,size:stream=index,codec_type,width,height,avg_frame_rate,r_frame_rate,nb_frames,nb_read_frames",
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
  const encodedFrameCount = positiveInteger(video.nb_read_frames)
    ?? positiveInteger(video.nb_frames)
    ?? (duration > 0 && fps > 0 ? Math.round(duration * fps) : series.frame_count + 1);
  const cuts = cutFrames.map((frame) => frame / fps).filter((time) => time > 0.05 && time < duration - 0.05);
  const flowFps = Number(options.flowFps ?? 10);
  // The flow grid keeps the video's aspect (a portrait render is sampled
  // portrait) and is fine enough to see a drawn figure's limbs move.
  const grid = flowGrid(Number(video.width), Number(video.height), options);
  // Absolute stillness reads a fixed small grey grid at a fixed rate, so its
  // threshold means the same at any resolution and frame rate.
  const stillGrid = stillnessGrid(Number(video.width), Number(video.height));
  const rawStill = await runRaw("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-i", resolved,
    "-vf", `fps=${STILLNESS.fps},scale=${stillGrid.width}:${stillGrid.height},format=gray`,
    "-an", "-f", "rawvideo", "pipe:1"
  ]);
  const rawFlow = await runRaw("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-i", resolved,
    "-vf", `fps=${flowFps},scale=${grid.width}:${grid.height}:flags=area,format=gray`,
    "-an", "-f", "rawvideo", "pipe:1"
  ]);
  // Zoom kicks are too quick for the 10 fps flow (a 0.12 s punch carries
  // edge blocks past its search radius) and a centred one has no shift for
  // phase correlation: a third pass reads every frame at 30 fps and fits a
  // scale about the centre (analyzeZoom).
  const zoomGrid = zoomDetectGrid(Number(video.width), Number(video.height));
  const rawZoom = await runRaw("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-i", resolved,
    "-vf", `fps=${ZOOM_DETECT.fps},scale=${zoomGrid.width}:${zoomGrid.height}:flags=area,format=gray`,
    "-an", "-f", "rawvideo", "pipe:1"
  ]);
  const opticalFlow = analyzeBlockMotion(Buffer.isBuffer(rawFlow.stdout) ? rawFlow.stdout : Buffer.from(rawFlow.stdout ?? "", "binary"), grid.width, grid.height, flowFps, { ...options, cutTimes: cuts, velocityScale: grid.velocityScale });
  const stillness = analyzeStillness(Buffer.isBuffer(rawStill.stdout) ? rawStill.stdout : Buffer.from(rawStill.stdout ?? "", "binary"), stillGrid.width, stillGrid.height, STILLNESS.fps, options);
  const zoom = analyzeZoom(Buffer.isBuffer(rawZoom.stdout) ? rawZoom.stdout : Buffer.from(rawZoom.stdout ?? "", "binary"), zoomGrid.width, zoomGrid.height, ZOOM_DETECT.fps, { cutTimes: cuts });
  const camera = cameraMoves({ ...stillness, zoom_times: zoom.zoom_times }, opticalFlow);
  // A fourth pass reads the look (src/render_look_analysis.js): sharpness,
  // light and mid-tones on a 360-px-short-side grid, streamed frame by frame.
  const lookSize = lookGrid(Number(video.width), Number(video.height));
  const look = lookAccumulator(lookSize.width, lookSize.height);
  const readLook = adapters.streamRaw ?? (adapters.runRaw || adapters.run ? bufferedFrames(runRaw) : streamRawFrames);
  await readLook("ffmpeg", lookFrameArgs(resolved, lookSize), lookSize.width * lookSize.height, (frame) => look.push(frame));
  const shotDurations = boundariesToDurations([0, ...cuts, duration]);
  return {
    schema_version: "launchclip.render-motion.v1",
    video: resolved,
    duration_seconds: round(duration),
    width: Number(video.width),
    height: Number(video.height),
    aspect: aspectOf(video.width, video.height),
    fps: round(fps),
    frame_count: encodedFrameCount,
    frame_difference_count: series.frame_count,
    cut_threshold: sceneThreshold,
    cuts,
    cut_rate_per_minute: rate(cuts.length, duration),
    shot_duration_seconds: distribution(shotDurations),
    motion_bursts_per_minute: rate(series.bursts.length, duration),
    motion: {
      ...series,
      still_share: stillness.still_share,
      longest_still_seconds: stillness.longest_still_seconds,
      closing_hold_seconds: stillness.closing_hold_seconds,
      still_spans: stillness.still_spans,
      camera_moves: camera.count,
      camera_moves_per_minute: camera.count == null ? null : rate(camera.count, duration),
      camera_move_events: camera.events,
      zoom_events: zoom.events,
      energy_per_second: stillness.energy_per_second,
      stillness: stillness.method,
      zoom: zoom.method
    },
    optical_flow: opticalFlow,
    look: look.result(),
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

// Optical flow samples a grid with the video's aspect: its short side is
// FLOW_GRID.shortSide px (a 1080×1920 render is read at 180×320), fine enough
// that a drawn figure's limbs (a stroke of a few px at 1080) still show. The
// velocities are reported on the legacy scale, px/s on a grid whose short side
// is FLOW_GRID.referenceShortSide (the 64×36 grid the profile floors were set
// on), so a profile's flow_velocity_p90 floor keeps its meaning at any
// resolution: 2 px/s is one grid pixel per sample at 10 fps.
export const FLOW_GRID = Object.freeze({ shortSide: 180, referenceShortSide: 36, blockSize: 6, searchRadius: 4 });

// A frame pair moves when enough textured blocks find a clearly better match
// away from where they were (FLOW_MATCH): at least minMovingBlocks of them
// and minMovingShare of the tracked blocks, so one blinking eye or encoder
// noise is not motion, but a gesturing arm is. The pair's velocity is the
// median speed of the blocks that moved; a held frame measures 0.
export const FLOW_MATCH = Object.freeze({ gain: 0.25, noisePerPixel: 1.5, residualPerPixel: 16, minMovingBlocks: 3, minMovingShare: 0.004 });

/** The flow grid for a width × height video: {width, height, velocityScale}. options.flowWidth/flowHeight force a grid. */
export function flowGrid(width, height, options = {}) {
  if (options.flowWidth != null && options.flowHeight != null) {
    const w = Number(options.flowWidth), h = Number(options.flowHeight);
    return { width: w, height: h, velocityScale: FLOW_GRID.referenceShortSide / Math.min(w, h) };
  }
  const shortSide = Number(options.flowShortSide ?? FLOW_GRID.shortSide);
  const w = Number(width) > 0 ? Number(width) : 16, h = Number(height) > 0 ? Number(height) : 9;
  const even = (value) => Math.max(2, 2 * Math.round(value / 2));
  const grid = w >= h ? { width: even(shortSide * w / h), height: even(shortSide) } : { width: even(shortSide), height: even(shortSide * h / w) };
  return { ...grid, velocityScale: FLOW_GRID.referenceShortSide / Math.min(grid.width, grid.height) };
}

export function analyzeBlockMotion(rawFrames, width, height, fps, options = {}) {
  const frameSize = width * height;
  const count = Math.floor(rawFrames.length / frameSize);
  const block = Number(options.flowBlockSize ?? FLOW_GRID.blockSize);
  const radius = Number(options.flowSearchRadius ?? FLOW_GRID.searchRadius);
  const scale = Number(options.velocityScale ?? 1);
  const gain = Number(options.flowMatchGain ?? FLOW_MATCH.gain);
  const noise = Number(options.flowNoisePerPixel ?? FLOW_MATCH.noisePerPixel) * block * block;
  const residual = Number(options.flowResidualPerPixel ?? FLOW_MATCH.residualPerPixel) * block * block;
  const minBlocks = Number(options.flowMinMovingBlocks ?? FLOW_MATCH.minMovingBlocks);
  const minShare = Number(options.flowMinMovingShare ?? FLOW_MATCH.minMovingShare);
  const cutTimes = options.cutTimes ?? [];
  const magnitudes = [];
  const samples = [];
  const sads = new Float64Array((2 * radius + 1) ** 2);
  for (let frame = 1; frame < count; frame += 1) {
    const at = frame / fps;
    if (cutTimes.some((time) => Math.abs(time - at) <= 1 / fps)) continue;
    const previousOffset = (frame - 1) * frameSize;
    const currentOffset = frame * frameSize;
    let tracked = 0;
    const moving = [];
    for (let y = radius; y + block + radius <= height; y += block) {
      for (let x = radius; x + block + radius <= width; x += block) {
        if (blockTexture(rawFrames, previousOffset, width, x, y, block) < Number(options.flowTextureThreshold ?? 5)) continue;
        tracked += 1;
        // Staying put is the default: a shift wins only by a clear margin.
        const match = searchBlock(rawFrames, previousOffset, currentOffset, width, x, y, block, radius, sads);
        const { still, bestSad, bestDx, bestDy } = match;
        if ((bestDx || bestDy) && bestSad <= still * (1 - gain) && still - bestSad >= noise && bestSad <= residual) {
          // Sub-pixel: the integer match refined on the SAD surface, so the
          // velocity is continuous rather than a multiple of the grid step.
          const dx = bestDx + match.ox, dy = bestDy + match.oy;
          moving.push({ magnitude: Math.hypot(dx, dy), x: x + block / 2, y: y + block / 2, dx, dy });
        }
      }
    }
    const enough = moving.length >= Math.max(minBlocks, Math.ceil(tracked * minShare));
    const magnitude = enough ? median(moving.map((entry) => entry.magnitude)) * fps * scale : 0;
    magnitudes.push(magnitude);
    const camera = enough ? globalMotion(moving, tracked, width, height) : null;
    samples.push({ frame, at_seconds: round(at, 4), pixels_per_second: round(magnitude, 4), tracked_blocks: tracked, moving_blocks: moving.length, ...(camera ? { camera } : {}) });
  }
  const acceleration = differences(magnitudes).map((value) => value * fps);
  const deceleration = acceleration.filter((value) => value < 0).map(Math.abs);
  const jerk = differences(acceleration).map((value) => value * fps);
  return {
    method: "block-matching",
    subpixel: "equiangular",
    sample_fps: fps,
    grid: { width, height },
    velocity_units: `px/s at a ${FLOW_GRID.referenceShortSide}-px short side`,
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

/**
 * Full search of one block within ±radius: the best integer shift (staying
 * put wins ties, a shorter shift wins equal SADs) and its sub-pixel offset
 * (ox, oy in −0.5…0.5) from an equiangular (V-shaped) fit of the SAD along
 * each axis, which suits SAD's linear walls. sads: scratch, (2r+1)² long.
 * → {still, bestSad, bestDx, bestDy, ox, oy}
 */
function searchBlock(buffer, previousOffset, currentOffset, width, x, y, block, radius, sads) {
  const side = 2 * radius + 1;
  const still = blockSad(buffer, previousOffset, currentOffset, width, x, y, 0, 0, block);
  let bestSad = still, bestMagnitude = 0, bestDx = 0, bestDy = 0;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const sad = !dx && !dy ? still : blockSad(buffer, previousOffset, currentOffset, width, x, y, dx, dy, block);
      sads[(dy + radius) * side + dx + radius] = sad;
      if (!dx && !dy) continue;
      if (sad < bestSad || (sad === bestSad && bestMagnitude && Math.hypot(dx, dy) < bestMagnitude)) { bestSad = sad; bestMagnitude = Math.hypot(dx, dy); bestDx = dx; bestDy = dy; }
    }
  }
  const at = (dx, dy) => sads[(dy + radius) * side + dx + radius];
  const ox = Math.abs(bestDx) < radius ? equiangular(at(bestDx - 1, bestDy), bestSad, at(bestDx + 1, bestDy)) : 0;
  const oy = Math.abs(bestDy) < radius ? equiangular(at(bestDx, bestDy - 1), bestSad, at(bestDx, bestDy + 1)) : 0;
  return { still, bestSad, bestDx, bestDy, ox, oy };
}

// The minimum of a V through (−1, a), (0, b), (1, c) with b the smallest:
// the offset in −0.5…0.5 (0 when the samples are flat).
function equiangular(a, b, c) {
  const wall = Math.max(a, c) - b;
  if (!(wall > 0)) return 0;
  return Math.max(-0.5, Math.min(0.5, (a - c) / (2 * wall)));
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

// Absolute stillness (alongside the relative hold_ratio, which compares a
// frame with the render's own median). Every frame pair is read on a small
// grey grid (72 px short side, 128 px long side for 9:16 and 16:9) at a fixed
// 30 fps; a pair is still when its mean absolute difference is under
// `threshold` grey levels. Calibrated on two public faceless animated
// explainer reels (9:16, 62–70 s): 1.8% and 19% still pairs (the second is
// animated on twos), longest mid-video still 0.1 s and 0.43 s; a render that
// bursts and then holds measures 46% and 1 s.
//
//   still_spans: every still run of at least minSpanSeconds, {start, end, seconds}
//   longest_still_seconds: the longest run, not counting the closing hold
//   closing_hold_seconds: the longest run ending within closingTailSeconds of
//     the last frame (an end card may hold)
export const STILLNESS = Object.freeze({ fps: 30, shortSide: 72, longSide: 128, threshold: 0.4, minSpanSeconds: 0.3, closingTailSeconds: 0.5, shiftEnergy: 3, shiftPixels: 2, shiftResidual: 1 });

/** The stillness grid for a width × height video: 72×128 portrait, 128×72 landscape, 72×72 square. */
export function stillnessGrid(width, height) {
  const w = Number(width) > 0 ? Number(width) : 9, h = Number(height) > 0 ? Number(height) : 16;
  const ratio = Math.max(w, h) / Math.min(w, h);
  const long = Math.abs(ratio - 16 / 9) < 0.05 ? STILLNESS.longSide : Math.max(2, 2 * Math.round(STILLNESS.shortSide * ratio / 2));
  return w >= h ? { width: long, height: STILLNESS.shortSide } : { width: STILLNESS.shortSide, height: long };
}

/**
 * Absolute stillness of raw grey frames (width × height bytes each) sampled
 * at fps. → {still_share, longest_still_seconds, closing_hold_seconds,
 * still_spans, energy_per_second, shift_times, method}; the shares are null
 * when there are fewer than two frames.
 */
export function analyzeStillness(rawFrames, width, height, fps = STILLNESS.fps, options = {}) {
  const threshold = Number(options.stillThreshold ?? STILLNESS.threshold);
  const minSpan = Number(options.stillMinSpanSeconds ?? STILLNESS.minSpanSeconds);
  const frameSize = width * height;
  const count = frameSize > 0 ? Math.floor((rawFrames?.length ?? 0) / frameSize) : 0;
  const method = { method: "mean-abs-diff", sample_fps: fps, grid: { width, height }, threshold, min_span_seconds: minSpan, camera: "phase-correlation" };
  if (count < 2) return { still_share: null, longest_still_seconds: null, closing_hold_seconds: null, still_spans: [], energy_per_second: [], shift_times: [], method };
  const energy = new Float64Array(count - 1);
  for (let pair = 0; pair < count - 1; pair += 1) {
    const a = pair * frameSize, b = a + frameSize;
    let sum = 0;
    for (let i = 0; i < frameSize; i += 1) sum += Math.abs(rawFrames[b + i] - rawFrames[a + i]);
    energy[pair] = sum / frameSize;
  }
  const result = stillnessFromEnergy(energy, fps, { threshold, minSpan });
  const shifts = [];
  const pc = phaseCorrelator(width, height);
  for (let pair = 0; pair < energy.length; pair += 1) {
    if (energy[pair] <= Number(options.shiftEnergy ?? STILLNESS.shiftEnergy)) continue;
    const shift = pc(rawFrames, pair * frameSize, (pair + 1) * frameSize);
    if (Math.abs(shift.dx) < STILLNESS.shiftPixels && Math.abs(shift.dy) < STILLNESS.shiftPixels) continue;
    // A camera move: undoing the shift leaves less change than there was (a
    // whip's motion blur still leaves some). Undoing an object's jump across
    // a held background misaligns the background and leaves more.
    const residual = shiftedDifference(rawFrames, pair * frameSize, (pair + 1) * frameSize, width, height, shift);
    if (residual <= energy[pair] * Number(options.shiftResidual ?? STILLNESS.shiftResidual)) shifts.push(round((pair + 1) / fps, 4));
  }
  return { ...result, shift_times: shifts, method };
}

/**
 * Stillness from a per-pair energy series (mean |Δ| grey levels per pixel)
 * sampled at fps. Pair i spans frames i and i + 1.
 */
export function stillnessFromEnergy(values, fps, { threshold = STILLNESS.threshold, minSpan = STILLNESS.minSpanSeconds, closingTail = STILLNESS.closingTailSeconds } = {}) {
  const energy = Array.from(values, Number);
  const n = energy.length;
  if (!n) return { still_share: null, longest_still_seconds: null, closing_hold_seconds: null, still_spans: [], energy_per_second: [] };
  const runs = [];
  let start = -1;
  for (let i = 0; i <= n; i += 1) {
    const still = i < n && energy[i] < threshold;
    if (still && start < 0) start = i;
    if (!still && start >= 0) { runs.push({ first: start, length: i - start }); start = -1; }
  }
  // The closing hold: the longest run that ends within closingTail of the
  // last frame (an end card may hold; a fade's last frames may still move).
  const tail = n - Math.round(Number(closingTail) * fps);
  const closing = runs.filter((run) => run.first + run.length >= tail).reduce((best, run) => (!best || run.length > best.length ? run : best), null);
  const spans = runs.filter((run) => run.length / fps >= minSpan - 1e-9).map((run) => ({
    start: round(run.first / fps, 3),
    end: round((run.first + run.length) / fps, 3),
    seconds: round(run.length / fps, 3),
    ...(run === closing ? { closing: true } : {})
  }));
  const longest = runs.filter((run) => run !== closing).reduce((max, run) => Math.max(max, run.length), 0);
  const perSecond = [];
  for (let second = 0; second * fps < n; second += 1) {
    const slice = energy.slice(Math.round(second * fps), Math.round((second + 1) * fps));
    if (slice.length >= fps / 2) perSecond.push(round(slice.reduce((sum, value) => sum + value, 0) / slice.length, 2));
  }
  return {
    still_share: round(energy.filter((value) => value < threshold).length / n, 4),
    longest_still_seconds: round(longest / fps, 3),
    closing_hold_seconds: closing ? round(closing.length / fps, 3) : 0,
    still_spans: spans,
    energy_per_second: perSecond
  };
}

// A whole-frame camera move in the optical flow: most moving blocks fit one
// shift plus one scale about the centre within GLOBAL_MOTION.residual px.
export const GLOBAL_MOTION = Object.freeze({ minShare: 0.4, minBlocks: 12, residual: 0.75, minShift: 1, minZoom: 1 });

/** {kind: "pan" | "zoom", shift, zoom} when the moving blocks move as one frame, else null. */
export function globalMotion(moving, tracked, width, height) {
  if (moving.length < GLOBAL_MOTION.minBlocks || moving.length < tracked * GLOBAL_MOTION.minShare) return null;
  const cx = width / 2, cy = height / 2;
  const n = moving.length;
  let rx = 0, ry = 0, vx = 0, vy = 0;
  for (const entry of moving) { rx += entry.x - cx; ry += entry.y - cy; vx += entry.dx; vy += entry.dy; }
  rx /= n; ry /= n; vx /= n; vy /= n;
  let num = 0, den = 0;
  for (const entry of moving) {
    const ax = entry.x - cx - rx, ay = entry.y - cy - ry;
    num += ax * (entry.dx - vx) + ay * (entry.dy - vy);
    den += ax * ax + ay * ay;
  }
  const scale = den > 0 ? num / den : 0;
  const tx = vx - scale * rx, ty = vy - scale * ry;
  let error = 0;
  for (const entry of moving) {
    const px = tx + scale * (entry.x - cx), py = ty + scale * (entry.y - cy);
    error += (entry.dx - px) ** 2 + (entry.dy - py) ** 2;
  }
  const residual = Math.sqrt(error / n);
  if (residual > GLOBAL_MOTION.residual) return null;
  const shift = Math.hypot(tx, ty);
  const zoom = Math.abs(scale) * Math.min(width, height) / 2;
  if (zoom >= GLOBAL_MOTION.minZoom) return { kind: "zoom", shift: round(shift, 3), zoom: round(scale, 5) };
  if (shift >= GLOBAL_MOTION.minShift) return { kind: "pan", shift: round(shift, 3), zoom: round(scale, 5) };
  return null;
}

// Zoom detection (analyzeZoom): every frame pair at 30 fps on a grid with a
// 144 px short side, blocks of 8 px every 12 px, matched within ±4 px to a
// sub-pixel shift. One shift plus one scale about the centre is fitted to
// the matched textured blocks (robustScaleShift: outliers dropped in passes
// down to `outlier` px); a pair counts when at least minBlocks and minShare
// of them fit within `residual` px RMS and the fit spans minQuadrants
// quadrants of the frame. A candidate is a window of `window` seconds whose
// scale changes by at least minScale (log): a ×1.05 kick in 0.12 s changes
// ln 0.049, the kinetic feel's ambient breathing at most about 0.004 in
// 0.2 s.
// Each candidate window is then verified end to end (verifyZoom): the
// frames either side of it matched within ±verifyRadius px, one fit holding
// for verifyShare of the textured blocks (outliers beyond verifyOutlier px)
// within verifyResidual px RMS, and blocks at least farShare of the short
// side from the centre fitting in minQuadrants quadrants. verifyShare is
// under a half so a zoom of the picture under a held title, caption or
// presenter layer still counts (the references zoom their illustration under
// a fixed headline); a figure moving under a held title does not fit one
// scale that well.
export const ZOOM_DETECT = Object.freeze({ fps: 30, shortSide: 144, block: 8, stride: 12, searchRadius: 4, texture: 6, residualPerPixel: 24, outlier: 1, residual: 0.6, minBlocks: 16, minShare: 0.5, minQuadrants: 3, window: 0.2, minScale: 0.025,
  verifyRadius: 10, verifyOutlier: 1.5, verifyResidual: 0.8, verifyShare: 0.45, farShare: 0.3 });

/** The zoom grid for a width × height video (144 px short side, the video's aspect). */
export function zoomDetectGrid(width, height) {
  const w = Number(width) > 0 ? Number(width) : 9, h = Number(height) > 0 ? Number(height) : 16;
  const even = (value) => Math.max(2, 2 * Math.round(value / 2));
  const short = ZOOM_DETECT.shortSide;
  return w >= h ? { width: even(short * w / h), height: short } : { width: short, height: even(short * h / w) };
}

// Least squares d = t + s·(p − c) over the matches → {tx, ty, s, rms}.
function fitScaleShift(matches, cx, cy) {
  const n = matches.length;
  let rx = 0, ry = 0, vx = 0, vy = 0;
  for (const m of matches) { rx += m.x - cx; ry += m.y - cy; vx += m.dx; vy += m.dy; }
  rx /= n; ry /= n; vx /= n; vy /= n;
  let num = 0, den = 0;
  for (const m of matches) {
    const ax = m.x - cx - rx, ay = m.y - cy - ry;
    num += ax * (m.dx - vx) + ay * (m.dy - vy);
    den += ax * ax + ay * ay;
  }
  const s = den > 0 ? num / den : 0;
  const tx = vx - s * rx, ty = vy - s * ry;
  let error = 0;
  for (const m of matches) error += (m.dx - tx - s * (m.x - cx)) ** 2 + (m.dy - ty - s * (m.y - cy)) ** 2;
  return { tx, ty, s, rms: Math.sqrt(error / n) };
}

// fitScaleShift with outliers dropped in passes (4 px, 2 px, then `outlier`
// px from the previous fit), so a fast zoom whose first fit is pulled about
// by a few bad matches still settles on the frame's scale. → {fit, inliers}
function robustScaleShift(matches, cx, cy, outlier) {
  let inliers = matches, fit = fitScaleShift(matches, cx, cy);
  for (const limit of [4, 2, outlier]) {
    const kept = matches.filter((m) => Math.hypot(m.dx - fit.tx - fit.s * (m.x - cx), m.dy - fit.ty - fit.s * (m.y - cy)) <= limit);
    if (kept.length < 3) return { fit, inliers: kept };
    inliers = kept;
    fit = fitScaleShift(inliers, cx, cy);
  }
  return { fit, inliers };
}

/**
 * Whole-frame scale changes in raw grey frames (width × height bytes each,
 * sampled at fps): the per-pair scale about the centre and the zoom events.
 * → {zoom_times, events: [{at, scale}], samples: [{at_seconds, scale}], method}
 * (scale: the event's change over its window, e.g. 1.05; samples only for
 * pairs whose fit held)
 */
export function analyzeZoom(rawFrames, width, height, fps = ZOOM_DETECT.fps, options = {}) {
  const Z = { ...ZOOM_DETECT, ...(options.zoom ?? {}) };
  const frameSize = width * height;
  const count = frameSize > 0 ? Math.floor((rawFrames?.length ?? 0) / frameSize) : 0;
  const method = { method: "scale-fit", sample_fps: fps, grid: { width, height }, block_size: Z.block, stride: Z.stride, search_radius: Z.searchRadius, window_seconds: Z.window, min_scale: Z.minScale };
  if (count < 2) return { zoom_times: [], events: [], samples: [], method };
  const cutTimes = options.cutTimes ?? [];
  const radius = Z.searchRadius, block = Z.block;
  const sads = new Float64Array((2 * radius + 1) ** 2);
  const cx = width / 2, cy = height / 2;
  const logs = new Float64Array(count - 1);
  const samples = [];
  for (let pair = 0; pair < count - 1; pair += 1) {
    const at = (pair + 1) / fps;
    if (cutTimes.some((time) => Math.abs(time - at) <= 1 / fps)) continue;
    const a = pair * frameSize, b = a + frameSize;
    let tracked = 0;
    const matches = [];
    for (let y = radius; y + block + radius <= height; y += Z.stride) {
      for (let x = radius; x + block + radius <= width; x += Z.stride) {
        if (blockTexture(rawFrames, a, width, x, y, block) < Z.texture) continue;
        tracked += 1;
        const match = searchBlock(rawFrames, a, b, width, x, y, block, radius, sads);
        if (match.bestSad > Z.residualPerPixel * block * block) continue;
        matches.push({ x: x + block / 2, y: y + block / 2, dx: match.bestDx + match.ox, dy: match.bestDy + match.oy });
      }
    }
    if (matches.length < Z.minBlocks) continue;
    const { fit, inliers } = robustScaleShift(matches, cx, cy, Z.outlier);
    if (inliers.length < Z.minBlocks || inliers.length < tracked * Z.minShare || fit.rms > Z.residual) continue;
    const quadrants = new Set(inliers.map((m) => (m.x >= cx ? 1 : 0) + (m.y >= cy ? 2 : 0)));
    if (quadrants.size < Z.minQuadrants) continue;
    // d = t + s·(p − c) maps the earlier frame to the later one: the later
    // frame is the earlier scaled by 1 + s.
    logs[pair] = Math.log(1 + fit.s);
    samples.push({ at_seconds: round(at, 4), scale: round(1 + fit.s, 5) });
  }
  const span = Math.max(1, Math.round(Z.window * fps));
  const candidates = [];
  let open = null;
  for (let start = 0; start < logs.length; start += 1) {
    let sum = 0;
    for (let i = start; i < Math.min(logs.length, start + span); i += 1) sum += logs[i];
    if (Math.abs(sum) >= Z.minScale) {
      if (!open) {
        // The event starts at the window's first pair that carries the move.
        let first = start;
        while (first < start + span - 1 && Math.abs(logs[first]) < Z.minScale / span) first += 1;
        open = { first, sum };
        candidates.push(open);
      }
    } else open = null;
  }
  // Each candidate is checked end to end: the frame before its first move
  // against the frame where its scale peaks within the window (a kick's
  // spring may turn back inside it), where a real zoom has moved the frame's
  // far blocks by several px, so content that holds still (a title over a
  // moving figure) cannot pass for a zoom.
  const events = [];
  for (const candidate of candidates) {
    let sum = 0, peak = 0, at = candidate.first;
    for (let i = candidate.first; i < Math.min(logs.length, candidate.first + span); i += 1) {
      sum += logs[i];
      if (Math.abs(sum) > Math.abs(peak)) { peak = sum; at = i; }
    }
    const from = candidate.first, to = Math.min(count - 1, at + 1);
    const scale = verifyZoom(rawFrames, width, height, from * frameSize, to * frameSize, Z);
    if (scale != null && Math.abs(Math.log(scale)) >= Z.minScale) events.push({ at: round((candidate.first + 1) / fps, 4), scale: round(scale, 4) });
  }
  return { zoom_times: events.map((event) => event.at), events, samples, method };
}

/**
 * The scale about the centre between two frames (offsets a, b), or null when
 * no single shift-plus-scale explains at least verifyShare of the textured
 * blocks within verifyResidual px RMS, with blocks far from the centre (at
 * least farShare of the short side) fitting in minQuadrants quadrants.
 */
function verifyZoom(buffer, width, height, a, b, Z) {
  const radius = Z.verifyRadius, block = Z.block;
  const sads = new Float64Array((2 * radius + 1) ** 2);
  const cx = width / 2, cy = height / 2, far = Z.farShare * Math.min(width, height);
  const matches = [];
  let tracked = 0;
  for (let y = radius; y + block + radius <= height; y += Z.stride) {
    for (let x = radius; x + block + radius <= width; x += Z.stride) {
      if (blockTexture(buffer, a, width, x, y, block) < Z.texture) continue;
      tracked += 1;
      const match = searchBlock(buffer, a, b, width, x, y, block, radius, sads);
      if (match.bestSad > Z.residualPerPixel * block * block) continue;
      matches.push({ x: x + block / 2, y: y + block / 2, dx: match.bestDx + match.ox, dy: match.bestDy + match.oy });
    }
  }
  if (matches.length < Z.minBlocks) return null;
  const { fit, inliers } = robustScaleShift(matches, cx, cy, Z.verifyOutlier);
  if (inliers.length < Z.minBlocks || inliers.length < tracked * Z.verifyShare || fit.rms > Z.verifyResidual) return null;
  const quadrants = new Set(inliers.filter((m) => Math.hypot(m.x - cx, m.y - cy) >= far).map((m) => (m.x >= cx ? 1 : 0) + (m.y >= cy ? 2 : 0)));
  return quadrants.size >= Z.minQuadrants ? 1 + fit.s : null;
}

/**
 * Camera moves: whole-frame shifts from phase correlation on the stillness
 * grid, pans or zooms from the optical flow and zooms from the 30 fps scale
 * fit (stillness.zoom_times, analyzeZoom), merged into events that are at
 * least 0.25 s apart. → {count, events: [{at, kind}]}
 */
export function cameraMoves(stillness, flow, mergeSeconds = 0.25) {
  if (stillness?.still_share == null && !(flow?.samples ?? []).length && !(stillness?.zoom_times ?? []).length) return { count: null, events: [] };
  const raw = [
    ...(stillness?.shift_times ?? []).map((at) => ({ at: Number(at), kind: "shift" })),
    ...(stillness?.zoom_times ?? []).map((at) => ({ at: Number(at), kind: "zoom" })),
    ...(flow?.samples ?? []).filter((sample) => sample.camera).map((sample) => ({ at: Number(sample.at_seconds), kind: sample.camera.kind }))
  ].filter((entry) => Number.isFinite(entry.at)).sort((a, b) => a.at - b.at);
  const events = [];
  for (const entry of raw) {
    const last = events.at(-1);
    if (last && entry.at - last.until <= mergeSeconds) { last.until = entry.at; if (entry.kind === "zoom") last.kind = "zoom"; continue; }
    events.push({ at: entry.at, until: entry.at, kind: entry.kind });
  }
  return { count: events.length, events: events.map((entry) => ({ at: round(entry.at, 3), kind: entry.kind })) };
}

// Mean |a(x + dx, y + dy) − b(x, y)| over the overlap, with {dx, dy} the
// phase-correlation peak (A·conj(B)): what is left of the change once a
// whole-frame shift is undone.
function shiftedDifference(buffer, first, second, width, height, { dx, dy }) {
  let sum = 0, count = 0;
  for (let y = Math.max(0, -dy); y < Math.min(height, height - dy); y += 1) {
    for (let x = Math.max(0, -dx); x < Math.min(width, width - dx); x += 1) {
      sum += Math.abs(buffer[first + (y + dy) * width + x + dx] - buffer[second + y * width + x]);
      count += 1;
    }
  }
  return count ? sum / count : Infinity;
}

// Phase correlation of two equal-size grey frames on the largest centred
// power-of-two crop: → {dx, dy} in grid pixels (signed).
function phaseCorrelator(width, height) {
  const w = 2 ** Math.floor(Math.log2(width)), h = 2 ** Math.floor(Math.log2(height));
  const x0 = Math.floor((width - w) / 2), y0 = Math.floor((height - h) / 2);
  const size = w * h;
  const aRe = new Float64Array(size), aIm = new Float64Array(size), bRe = new Float64Array(size), bIm = new Float64Array(size);
  const load = (buffer, offset, re, im) => {
    let mean = 0;
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) mean += buffer[offset + (y + y0) * width + x + x0];
    mean /= size;
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) { re[y * w + x] = buffer[offset + (y + y0) * width + x + x0] - mean; im[y * w + x] = 0; }
  };
  return (buffer, first, second) => {
    load(buffer, first, aRe, aIm);
    load(buffer, second, bRe, bIm);
    fft2(aRe, aIm, w, h, false);
    fft2(bRe, bIm, w, h, false);
    for (let i = 0; i < size; i += 1) {
      // A · conj(B), normalised to unit magnitude.
      const re = aRe[i] * bRe[i] + aIm[i] * bIm[i];
      const im = aIm[i] * bRe[i] - aRe[i] * bIm[i];
      const magnitude = Math.hypot(re, im) + 1e-6;
      aRe[i] = re / magnitude; aIm[i] = im / magnitude;
    }
    fft2(aRe, aIm, w, h, true);
    let best = 0, at = 0;
    for (let i = 0; i < size; i += 1) {
      const value = Math.hypot(aRe[i], aIm[i]);
      if (value > best) { best = value; at = i; }
    }
    const px = at % w, py = Math.floor(at / w);
    return { dx: px > w / 2 ? px - w : px, dy: py > h / 2 ? py - h : py };
  };
}

function fft2(re, im, w, h, inverse) {
  const rowRe = new Float64Array(w), rowIm = new Float64Array(w);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) { rowRe[x] = re[y * w + x]; rowIm[x] = im[y * w + x]; }
    fft1(rowRe, rowIm, inverse);
    for (let x = 0; x < w; x += 1) { re[y * w + x] = rowRe[x]; im[y * w + x] = rowIm[x]; }
  }
  const colRe = new Float64Array(h), colIm = new Float64Array(h);
  for (let x = 0; x < w; x += 1) {
    for (let y = 0; y < h; y += 1) { colRe[y] = re[y * w + x]; colIm[y] = im[y * w + x]; }
    fft1(colRe, colIm, inverse);
    for (let y = 0; y < h; y += 1) { re[y * w + x] = colRe[y]; im[y * w + x] = colIm[y]; }
  }
}

// In-place iterative radix-2 FFT (unnormalised; the peak position is all
// phase correlation needs).
function fft1(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let length = 2; length <= n; length <<= 1) {
    const angle = (inverse ? 2 : -2) * Math.PI / length;
    const wRe = Math.cos(angle), wIm = Math.sin(angle);
    for (let i = 0; i < n; i += length) {
      let uRe = 1, uIm = 0;
      for (let k = 0; k < length / 2; k += 1) {
        const a = i + k, b = a + length / 2;
        const tRe = re[b] * uRe - im[b] * uIm, tIm = re[b] * uIm + im[b] * uRe;
        re[b] = re[a] - tRe; im[b] = im[a] - tIm;
        re[a] += tRe; im[a] += tIm;
        const next = uRe * wRe - uIm * wIm;
        uIm = uRe * wIm + uIm * wRe; uRe = next;
      }
    }
  }
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
  if (above(metrics.motion.hold_ratio, expected.maximum_hold_ratio ?? 0.985)) findings.push(finding("motion", "major", `Frame-difference analysis reports ${(metrics.motion.hold_ratio * 100).toFixed(1)}% near-static frames.`));
  if (below(metrics.motion_bursts_per_minute, expected.minimum_bursts_per_minute ?? 4)) findings.push(finding("motion", "major", `Only ${metrics.motion_bursts_per_minute.toFixed(1)} meaningful motion bursts per minute were detected.`));
  const motionFamily = metrics.family ?? classifyMotionFamily(metrics);
  const familyEnergyFloor = expected.minimum_change_energy_p50_by_family?.[motionFamily];
  const minimumChangeEnergy = familyEnergyFloor ?? expected.minimum_change_energy_p50;
  if (minimumChangeEnergy != null && below(metrics.motion?.change_energy?.p50 ?? 0, minimumChangeEnergy)) {
    const source = familyEnergyFloor != null ? `the ${motionFamily} floor` : "the profile's floor";
    findings.push(finding("motion", "major", `Median frame-change energy is ${Number(metrics.motion?.change_energy?.p50 ?? 0).toFixed(3)}; expected at least ${Number(minimumChangeEnergy).toFixed(3)} (${source}). Raise it with a livelier ambient camera (motion.feel ambient scale and period), camera.kicks on stressed words, and more scene changes or big panel entrances.`));
  }
  if (expected.minimum_flow_velocity_p90 != null && below(metrics.optical_flow?.velocity_pixels_per_second?.p90 ?? 0, expected.minimum_flow_velocity_p90)) {
    findings.push(finding("motion", "major", `90th-percentile motion velocity is ${Number(metrics.optical_flow?.velocity_pixels_per_second?.p90 ?? 0).toFixed(1)} px/s; expected at least ${Number(expected.minimum_flow_velocity_p90).toFixed(1)} px/s. Fast moves are too short or too few: lengthen whip-pans toward 0.4 s, add sideways sweeps or drifts with travel.`));
  }
  if (expected.minimum_cut_rate_per_minute != null && Number(metrics.cut_rate_per_minute ?? 0) < Number(expected.minimum_cut_rate_per_minute)) {
    findings.push(finding("editing", "major", `Only ${Number(metrics.cut_rate_per_minute ?? 0).toFixed(1)} cuts per minute were detected; expected at least ${Number(expected.minimum_cut_rate_per_minute).toFixed(1)}.`));
  }
  findings.push(...stillnessFindings(metrics, expected));
  const cameraRate = metrics.motion?.camera_moves_per_minute;
  if (expected.minimum_camera_moves_per_minute != null && cameraRate != null && below(cameraRate, expected.minimum_camera_moves_per_minute)) {
    findings.push({ ...finding("motion", "major", `Only ${Number(cameraRate).toFixed(1)} whole-frame camera moves per minute were detected; expected at least ${Number(expected.minimum_camera_moves_per_minute).toFixed(1)}. Move the camera between and inside scenes: zoom-kicks on stressed words, drifts through holds, whips or dot-wipes between scenes.`), measure: "camera_moves_per_min", value: Number(cameraRate), floor: Number(expected.minimum_camera_moves_per_minute) });
  }
  if (expected.maximum_camera_moves_per_minute != null && cameraRate != null && cameraRate > Number(expected.maximum_camera_moves_per_minute)) {
    findings.push({ ...finding("motion", "major", `${Number(cameraRate).toFixed(1)} whole-frame camera moves per minute were detected; expected at most ${Number(expected.maximum_camera_moves_per_minute).toFixed(1)}. A camera that reframes this often pumps and disorients: use the steady feel (motion.feel "steady") and keep camera.kicks to the few words that earn one.`), source: "camera" });
  }
  findings.push(...lookFindings(metrics, expected));
  const firstMotion = firstMeaningfulMotionSeconds(metrics);
  if (expected.maximum_first_motion_seconds != null && (firstMotion == null || firstMotion > Number(expected.maximum_first_motion_seconds))) {
    findings.push(finding("hook", "major", firstMotion == null
      ? "No meaningful motion was detected in the opening."
      : `The first meaningful motion arrives at ${firstMotion.toFixed(2)}s; expected it by ${Number(expected.maximum_first_motion_seconds).toFixed(2)}s.`));
  }
  if (expected.minimum_hook_events != null) {
    const window = Number(expected.hook_window_seconds ?? 4);
    const events = hookEventSeconds(metrics, window);
    if (events.length < Number(expected.minimum_hook_events)) {
      findings.push(finding("hook", "major", `Only ${events.length} distinct motion/cut event${events.length === 1 ? "" : "s"} landed in the first ${window.toFixed(1)}s; expected at least ${Number(expected.minimum_hook_events)}.`));
    }
  }
  return { ok: !findings.some((entry) => entry.severity === "blocking" || entry.severity === "major"), findings };
}

// The look findings (src/render_look_analysis.js): one per look measure
// outside the profile's band, each naming the levers that move it. A measure
// gates only when the expectations carry its bound (a profile measured with
// it); a render without a look pass is not judged.
export const LOOK_CHECKS = Object.freeze([
  { measure: "moving_sharpness_ratio", key: "maximum_moving_sharpness_ratio", side: "ceiling",
    say: (value, bound) => `Moving frames are ${value.toFixed(2)}× as sharp as held ones (median Laplacian variance); expected at most ${bound.toFixed(2)}×. Fast moves slide past as crisp cut-outs: stronger motion blur on fast moves (motion.blur shutter), and push-blur transitions between scenes.` },
  { measure: "soft_frame_share", key: "minimum_soft_frame_share", side: "floor",
    say: (value, bound) => `Only ${(value * 100).toFixed(1)}% of frames are soft (sharpness under ${LOOK_SOFT_PERCENT}% of the held median); expected at least ${(bound * 100).toFixed(1)}%. Nothing ever leaves focus: rack-focus entrances (enter: "focus"), depth layers behind the panels, and push-blur transitions.` },
  { measure: "change_p99", key: "maximum_change_p99", side: "ceiling",
    say: (value, bound, look) => `The hardest single-frame jumps change ${value.toFixed(1)} grey levels (99th percentile${look.max_change != null ? `, max ${Number(look.max_change).toFixed(1)}` : ""}); expected at most ${bound.toFixed(1)}. Moves snap in one frame: stronger motion blur on fast moves (motion.blur shutter), ease whips and kicks over more frames, or carry the change with a light-sweep or push-blur transition.` },
  { measure: "top_light_ratio", key: "minimum_top_light_ratio", side: "floor",
    say: (value, bound) => `The top of the frame is ${value.toFixed(2)}× as bright as the middle (median); expected at least ${bound.toFixed(2)}×. The frame is unlit: a key light from above (story.light), or light-sweep transitions that carry light across the frame.` },
  { measure: "midtone_share", key: "minimum_midtone_share", side: "floor",
    say: (value, bound) => `Only ${(value * 100).toFixed(1)}% of pixels are mid-tones (grey ${LOOK_MIDTONE}); expected at least ${(bound * 100).toFixed(1)}%. The frame is near-black background and bright ink with nothing between: light or haze layers (story.light), translucent depth planes behind the panels.` },
  { measure: "burst_change_mean", key: "minimum_burst_change_mean", side: "floor",
    say: (value, bound) => `Motion bursts change the frame by ${value.toFixed(2)} grey levels on average; expected at least ${bound.toFixed(2)}. Moves are timid: more travel on whips and kicks, bigger entrances, and light-sweep transitions through scene changes.` }
]);

const LOOK_SOFT_PERCENT = Math.round(LOOK.softSharpness * 100);
const LOOK_MIDTONE = `${LOOK.midtone[0]}–${LOOK.midtone[1]}`;

function lookFindings(metrics, expected) {
  const look = metrics.look ?? {};
  const out = [];
  for (const check of LOOK_CHECKS) {
    const bound = expected[check.key];
    const value = look[check.measure];
    if (bound == null || value == null || !Number.isFinite(Number(value))) continue;
    const outside = check.side === "ceiling" ? above(value, bound) : below(value, bound);
    if (outside) out.push({ ...finding("look", "major", check.say(Number(value), Number(bound), look)), measure: check.measure, value: Number(value), [check.side]: Number(bound) });
  }
  return out;
}

// What a director does about a still span, worst first. A span that runs
// into a cut carries the next scene in early (whip for a short one, dot-wipe
// for a longer one); a long span needs a new visual; a medium one a slow
// drift; a short one a zoom kick on the stressed word.
export const STILL_FIXES = Object.freeze({
  "zoom-kick": "punch the camera in 8–12% over 0.2–0.3 s on the stressed word, then ease back or keep drifting",
  drift: "keep the camera moving through the hold: a slow push or pan of 3–6% across the span, eased in and out",
  whip: "start a whip (fast pan with motion blur) into the next scene during the hold instead of a hard cut after it",
  "dot-wipe": "open a dot or shape wipe into the next scene during the hold so the transition carries the motion",
  "new visual": "add a new element in the span: an insert, a diagram or chart building, a callout or a character action"
});
const STILL_FIX_LIMITS = Object.freeze({ shortSeconds: 0.8, longSeconds: 1.5, cutBefore: 0.1, cutAfter: 0.25 });

/** The suggested fix for one still span ({start, end, seconds}) given the render's cuts. → {fix, reason} */
export function suggestStillFix(span, cuts = []) {
  const seconds = Number(span.seconds ?? Number(span.end) - Number(span.start));
  const end = Number(span.end);
  const intoCut = cuts.map(Number).some((cut) => cut >= end - STILL_FIX_LIMITS.cutBefore && cut <= end + STILL_FIX_LIMITS.cutAfter);
  if (seconds >= STILL_FIX_LIMITS.longSeconds) return { fix: "new visual", reason: `a ${seconds.toFixed(2)} s hold is too long for a camera move alone` };
  if (intoCut) return seconds >= STILL_FIX_LIMITS.shortSeconds
    ? { fix: "dot-wipe", reason: "the hold runs into a cut, so the transition can carry it" }
    : { fix: "whip", reason: "a short hold before a cut" };
  if (seconds >= STILL_FIX_LIMITS.shortSeconds) return { fix: "drift", reason: "a mid-length hold inside a scene" };
  return { fix: "zoom-kick", reason: "a short hold inside a scene" };
}

/**
 * The still spans worth fixing, worst (longest) first: every mid-video span
 * of at least `minimum` seconds, each with its suggested fix.
 */
export function worstStillSpans(metrics, { limit = 6, minimum = STILLNESS.minSpanSeconds } = {}) {
  const spans = (metrics?.motion?.still_spans ?? []).filter((span) => !span.closing && Number(span.seconds) >= minimum - 1e-9);
  return [...spans].sort((a, b) => b.seconds - a.seconds || a.start - b.start).slice(0, limit).map((span) => {
    const { fix, reason } = suggestStillFix(span, metrics?.cuts ?? []);
    return { start: span.start, end: span.end, seconds: span.seconds, fix, reason, instruction: STILL_FIXES[fix] };
  });
}

// The stillness findings: one summary finding per measure over its ceiling,
// then one finding per worst span (category "stillness", with start_seconds,
// end_seconds, fix and instruction) that a critic, the repair step or a
// director can act on directly.
function stillnessFindings(metrics, expected) {
  const motion = metrics?.motion ?? {};
  const share = Number(motion.still_share);
  const longest = Number(motion.longest_still_seconds);
  const shareCeiling = expected.maximum_still_share;
  const longestCeiling = expected.maximum_longest_still_seconds;
  const out = [];
  const shareOver = shareCeiling != null && motion.still_share != null && Number.isFinite(share) && above(share, shareCeiling);
  const longestOver = longestCeiling != null && motion.longest_still_seconds != null && Number.isFinite(longest) && above(longest, longestCeiling);
  if (!shareOver && !longestOver) return out;
  const spans = worstStillSpans(metrics, { limit: Number(expected.still_span_limit ?? 6), minimum: shareOver ? STILLNESS.minSpanSeconds : Math.max(Number(longestCeiling), STILLNESS.minSpanSeconds) });
  const list = spans.map((span) => `${clock(span.start)}–${clock(span.end)} (${span.seconds.toFixed(2)} s, ${span.fix})`).join(", ");
  if (shareOver) out.push({ ...finding("stillness", "major", `${(share * 100).toFixed(1)}% of frame pairs are near-still (mean change under ${motion.stillness?.threshold ?? STILLNESS.threshold} grey levels); expected at most ${(Number(shareCeiling) * 100).toFixed(1)}%.${list ? ` Worst still spans: ${list}.` : ""}`), measure: "still_share", value: share, ceiling: Number(shareCeiling), spans });
  if (longestOver) out.push({ ...finding("stillness", "major", `The longest mid-video still lasts ${longest.toFixed(2)} s; expected at most ${Number(longestCeiling).toFixed(2)} s.${list ? ` Worst still spans: ${list}.` : ""}`), measure: "longest_still_seconds", value: longest, ceiling: Number(longestCeiling), spans });
  for (const span of spans) {
    out.push({
      ...finding("stillness", "major", `Still from ${clock(span.start)} to ${clock(span.end)} (${span.seconds.toFixed(2)} s): ${span.fix}, ${span.instruction}.`),
      start_seconds: span.start,
      end_seconds: span.end,
      fix: span.fix,
      reason: span.reason,
      instruction: span.instruction
    });
  }
  return out;
}

function clock(seconds) {
  const value = Number(seconds);
  const minutes = Math.floor(value / 60);
  return `${minutes}:${(value - minutes * 60).toFixed(2).padStart(5, "0")}`;
}

// Optical-flow motion events: the start of a run of at least
// FLOW_EVENT.minimumSamples flow samples moving at FLOW_EVENT.velocity px/s
// or more (a gesture, a mark being drawn, a camera move). They count with the
// frame-difference bursts, which miss motion that covers little of the frame.
export const FLOW_EVENT = Object.freeze({ velocity: 2, minimumSamples: 2 });

/** Seconds where a run of optical-flow motion starts (metrics.optical_flow.samples). */
export function flowOnsetSeconds(metrics) {
  const samples = (metrics?.optical_flow?.samples ?? []).filter((entry) => Number.isFinite(Number(entry?.at_seconds)));
  const step = 1 / Number(metrics?.optical_flow?.sample_fps || 10);
  const onsets = [];
  let run = [];
  const close = () => { if (run.length >= FLOW_EVENT.minimumSamples) onsets.push(Math.max(0, run[0] - step)); run = []; };
  for (const sample of samples) {
    const at = Number(sample.at_seconds);
    // A cut skips its pair, so a run does not continue across a gap.
    if (run.length && at - run.at(-1) > step * 1.5) close();
    if (Number(sample.pixels_per_second) >= FLOW_EVENT.velocity) run.push(at);
    else close();
  }
  close();
  return onsets.map((time) => round(time, 4));
}

export function hookEventSeconds(metrics, windowSeconds = 4, minimumGapSeconds = .2) {
  const events = [
    ...(metrics.cuts ?? []),
    ...(metrics.motion?.bursts ?? []).map((entry) => Number(entry.start_seconds)),
    ...flowOnsetSeconds(metrics)
  ].map(Number).filter((time) => Number.isFinite(time) && time >= 0 && time <= windowSeconds).sort((a, b) => a - b);
  return events.reduce((distinct, time) => {
    if (!distinct.length || time - distinct.at(-1) >= minimumGapSeconds) distinct.push(time);
    return distinct;
  }, []);
}

function firstMeaningfulMotionSeconds(metrics) {
  const flow = flowOnsetSeconds(metrics)[0];
  const burst = (metrics.motion?.bursts ?? []).map((entry) => Number(entry.start_seconds)).filter(Number.isFinite).sort((a, b) => a - b)[0];
  const candidates = [burst, flow].filter(Number.isFinite);
  if (candidates.length) return Math.min(...candidates);
  const threshold = Number(metrics.motion?.hold_threshold ?? metrics.motion?.burst_threshold);
  if (!Number.isFinite(threshold)) return null;
  const sample = (metrics.motion?.frame_difference ?? []).find((entry) => Number(entry.energy) > threshold);
  return sample ? Number(sample.at_seconds) : null;
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

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
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

// Profile bands are stored to 4 decimals, so a render is compared at that
// precision (a reference measured into a profile passes its own band).
function below(value, floor) {
  return round(Number(value), 4) < Number(floor);
}

function above(value, ceiling) {
  return round(Number(value), 4) > Number(ceiling);
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

// A raw-frame reader over a buffered runRaw (the test adapters).
function bufferedFrames(runRaw) {
  return async (command, args, frameSize, onFrame) => {
    const { stdout } = await runRaw(command, args);
    const buffer = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? "", "binary");
    for (let offset = 0; frameSize > 0 && offset + frameSize <= buffer.length; offset += frameSize) onFrame(buffer.subarray(offset, offset + frameSize));
  };
}

async function runCommand(command, args) {
  return execFileAsync(command, args, { maxBuffer: 1024 * 1024 * 128 });
}

async function runRawCommand(command, args) {
  return execFileAsync(command, args, { encoding: null, maxBuffer: 1024 * 1024 * 128 });
}

// ---------------------------------------------------------------------------
// Transition classifier (docs/PLAN_AND_PACE_RFC.md §4.1). Grey frames at
// 30 fps; the picture is cropped out of any letterbox and resampled to a
// work grid with a 48 px short side, so a letterboxed copy reads the same.
// Every threshold is the RFC's unless its line says otherwise.
export const TRANSITION_CLASSIFY = Object.freeze({
  fps: 30, // a 0.2 s window is 6 frames
  workShortSide: 48,
  thumb: [12, 16], // short × long side of the thumb the distances read
  blocks: [6, 8], // short × long side of the block grid
  crop: Object.freeze({ samples: 48, longSide: 640, share: 0.08, levels: 16, minHeight: 0.15, minWidth: 0.3 }),
  windows: Object.freeze([0.2, 0.35, 0.6, 1.0, 1.5]),
  minAcross: 10, // mean abs diff of the window's ends on the thumb
  outside: 0.3, // change just outside ≤ this × change across
  blockShare: 0.5, // blocks changed between the ends
  warp: 0.45, // a shift-and-scale explaining the change this well is a camera move, not a transition
  progressBefore: 0.3, progressAfter: 0.7, tightenLow: 0.12, tightenHigh: 0.88,
  cutSpan: 0.25, // a hard cut whose span is under this is a cut
  dip: Object.freeze({ flatStd: 8, dark: 45, light: 210, cover: 1.2 }), // cover: a middle frame this far (÷ the A–B change) from both pictures
  flash: Object.freeze({ minSpan: 0.15, peak: 170, lift: 50 }),
  iris: Object.freeze({ correlation: 0.55, residual: 0.35 }),
  edge: Object.freeze({ positions: 33, residual: 0.35, vsBlend: 0.6, rise: 0.8, travel: 0.3, moveBeat: 0.2 }),
  spin: Object.freeze({ degrees: 25, net: 0.7 }),
  zoom: Object.freeze({ net: 0.25, consistent: 0.4 }), // |net log scale|, and net ≥ this × summed |log scale| (the RFC: summed ≥ 0.5)
  whip: Object.freeze({ net: 0.3, path: 1.5, sharpness: 0.7 }),
  shake: Object.freeze({ path: 0.4, net: 3 }),
  blur: 0.5,
  dissolve: Object.freeze({ residual: 0.25, rise: 0.85 }),
  glitch: Object.freeze({ swings: 2, drop: 0.2 })
});

export const TRANSITION_KINDS = Object.freeze(['cut', 'dip', 'flash', 'iris', 'wipe', 'push', 'cover', 'reveal', 'spin', 'zoom', 'whip', 'shake', 'blur', 'dissolve', 'glitch', 'other']);

// The kind each of our TRANSITION_TYPES draws in cuts mode (camera.mode
// world turns push into a dolly, which measures as zoom). Between two
// footage plates morph, rack-focus and card-to-card play as a fade. The
// VFX covers, dot-wipe and light-sweep cover the whole frame at their
// midpoint, so they read as dips. overview needs a chapter: null.
export const TRANSITION_TYPE_KINDS = Object.freeze({
  cut: 'cut', fade: 'dissolve', push: 'push', whip: 'whip', zoom: 'zoom', iris: 'iris', morph: 'dissolve',
  pan: 'push', pull: 'zoom', orbit: 'push', 'whip-pan': 'whip', 'rack-focus': 'dissolve', 'glow-wipe': 'wipe',
  'card-to-card': 'dissolve', overview: null, 'dot-wipe': 'dip', 'light-sweep': 'dip', 'push-blur': 'whip',
  'light-leak': 'flash', 'before-after': 'wipe', 'burn-away': 'dip', 'slash-wipe': 'dip', shatter: 'dip',
  'crt-off': 'dip', 'glitch-wipe': 'dip', blinds: 'dip', 'diamond-wipe': 'dip', 'star-iris': 'dip', 'pixel-dissolve': 'dip'
});

// Measured kind → our types to prefer, first first (the RFC's map, plus the
// kinds it leaves out). A style drafted from references orders its
// transition_preference by these.
export const KIND_TRANSITION_TYPES = Object.freeze({
  cut: ['cut'], dissolve: ['fade'], dip: ['light-sweep', 'crt-off'], flash: ['light-leak'], iris: ['iris'],
  wipe: ['glow-wipe'], push: ['push'], cover: ['push'], reveal: ['push'], spin: ['orbit'],
  zoom: ['zoom', 'push-blur'], whip: ['whip', 'whip-pan'], shake: ['whip'], blur: ['rack-focus'], glitch: ['glitch-wipe'], other: []
});

/**
 * Profile fields from classified transitions over `duration` seconds:
 * transitions_per_min, transition_mix (share by kind) and
 * transition_seconds (p50 of the spans that are not cuts, null without).
 */
export function transitionStats(transitions, duration) {
  const list = transitions ?? [];
  const spans = list.filter((entry) => entry.kind !== 'cut').map((entry) => entry.seconds);
  const mix = {};
  for (const entry of list) mix[entry.kind] = (mix[entry.kind] ?? 0) + 1;
  return {
    transitions_per_min: duration > 0 ? round(list.length * 60 / duration, 2) : 0,
    transition_mix: Object.fromEntries(Object.entries(mix).sort((a, b) => b[1] - a[1]).map(([kind, n]) => [kind, round(n / list.length, 3)])),
    transition_seconds: spans.length ? round(median(spans), 3) : null
  };
}

/**
 * The picture inside any letterbox or pillarbox: over `samples` frames
 * spread through the video, a row (column) is picture when more than
 * `share` of its pixels vary by more than `levels`. The crop is skipped
 * (the whole frame) when what is left is under minHeight of the height or
 * minWidth of the width. → {x, y, width, height}
 */
export function pictureCrop(rawFrames, width, height, options = {}) {
  const C = { ...TRANSITION_CLASSIFY.crop, ...options };
  const size = width * height;
  const count = Math.floor(rawFrames.length / size);
  const whole = { x: 0, y: 0, width, height };
  if (count < 2) return whole;
  const picks = Array.from({ length: Math.min(C.samples, count) }, (_, i) => Math.round(i * (count - 1) / Math.max(1, Math.min(C.samples, count) - 1)));
  const lo = new Uint8Array(size).fill(255), hi = new Uint8Array(size);
  for (const f of picks) for (let k = 0; k < size; k += 1) { const v = rawFrames[f * size + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
  const varies = (k) => hi[k] - lo[k] > C.levels;
  const rows = [], cols = [];
  for (let y = 0; y < height; y += 1) { let n = 0; for (let x = 0; x < width; x += 1) n += varies(y * width + x); if (n > C.share * width) rows.push(y); }
  for (let x = 0; x < width; x += 1) { let n = 0; for (let y = 0; y < height; y += 1) n += varies(y * width + x); if (n > C.share * height) cols.push(x); }
  if (!rows.length || !cols.length) return whole;
  const crop = { x: cols[0], y: rows[0], width: cols.at(-1) - cols[0] + 1, height: rows.at(-1) - rows[0] + 1 };
  return crop.height < C.minHeight * height || crop.width < C.minWidth * width ? whole : crop;
}

/** Area-average a crop of each grey frame onto a w × h grid. → [Float32Array] */
function resampleFrames(rawFrames, width, height, crop, w, h) {
  const size = width * height;
  const count = Math.floor(rawFrames.length / size);
  const frames = [];
  const sx = crop.width / w, sy = crop.height / h;
  for (let f = 0; f < count; f += 1) {
    const out = new Float32Array(w * h);
    for (let j = 0; j < h; j += 1) {
      const y0 = crop.y + j * sy, y1 = y0 + sy;
      for (let i = 0; i < w; i += 1) {
        const x0 = crop.x + i * sx, x1 = x0 + sx;
        let sum = 0, area = 0;
        for (let y = Math.floor(y0); y < Math.ceil(y1); y += 1) {
          const wy = Math.min(y + 1, y1) - Math.max(y, y0);
          for (let x = Math.floor(x0); x < Math.ceil(x1); x += 1) {
            const wx = Math.min(x + 1, x1) - Math.max(x, x0);
            sum += rawFrames[f * size + y * width + x] * wx * wy; area += wx * wy;
          }
        }
        out[j * w + i] = sum / area;
      }
    }
    frames.push(out);
  }
  return frames;
}

function shrink(frame, w, h, tw, th) {
  const out = new Float32Array(tw * th), n = new Float32Array(tw * th);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) { const k = Math.floor(y * th / h) * tw + Math.floor(x * tw / w); out[k] += frame[y * w + x]; n[k] += 1; }
  for (let k = 0; k < out.length; k += 1) out[k] /= n[k];
  return out;
}

function meanAbs(a, b) { let s = 0; for (let k = 0; k < a.length; k += 1) s += Math.abs(a[k] - b[k]); return s / a.length; }
function frameMean(a) { let s = 0; for (const v of a) s += v; return s / a.length; }
function frameMedian(a) { return median(Array.from(a)); }
function robustSpread(a) { const m = frameMedian(a); return 1.4826 * median(Array.from(a, (v) => Math.abs(v - m))); }
function detail(frame, w, h) { let s = 0; for (let y = 0; y < h - 1; y += 1) for (let x = 0; x < w - 1; x += 1) { const k = y * w + x; s += Math.abs(frame[k + 1] - frame[k]) + Math.abs(frame[k + w] - frame[k]); } return s / ((w - 1) * (h - 1)); }
function correlation(xs, ys) {
  const n = xs.length; if (n < 3) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i += 1) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

/**
 * Transitions in grey frames (width × height bytes each, at fps): each
 * boundary's span and kind (TRANSITION_KINDS), with a direction for wipes,
 * pushes, covers, reveals and whips and `via` (black or white) for a dip.
 * → {crop, transitions: [{at, start, end, seconds, kind, direction?, via?}]}
 */
export function classifyTransitions(rawFrames, width, height, fps = TRANSITION_CLASSIFY.fps, options = {}) {
  const T = { ...TRANSITION_CLASSIFY, ...options };
  const crop = options.cropped ? { x: 0, y: 0, width, height } : pictureCrop(rawFrames, width, height, T.crop);
  const portrait = crop.height >= crop.width;
  const shortSide = T.workShortSide, longSide = Math.max(shortSide, Math.round(shortSide * Math.max(crop.width, crop.height) / Math.min(crop.width, crop.height)));
  const W = portrait ? shortSide : longSide, H = portrait ? longSide : shortSide;
  const frames = resampleFrames(rawFrames, width, height, crop, W, H);
  const [ts, tl] = T.thumb, [bs, bl] = T.blocks;
  const thumbs = frames.map((f) => portrait ? shrink(f, W, H, ts, tl) : shrink(f, W, H, tl, ts));
  const blocks = frames.map((f) => portrait ? shrink(f, W, H, bs, bl) : shrink(f, W, H, bl, bs));
  const count = frames.length;
  const dist = (i, j) => meanAbs(thumbs[i], thumbs[j]);
  const progress = (t, s, e) => { const a = dist(t, s), b = dist(t, e); return a + b > 0 ? a / (a + b) : 0; };
  const candidates = [];
  for (const L of T.windows) {
    const n = Math.max(1, Math.round(L * fps)), step = Math.max(1, Math.round(n / 5)), k = Math.max(2, Math.round(n / 4));
    for (let s = k; s + n + k < count; s += step) {
      const e = s + n;
      const across = dist(s, e);
      if (across < T.minAcross) continue;
      if (Math.max(dist(s - k, s), dist(e, e + k)) > T.outside * across) continue;
      let changed = 0;
      for (let b = 0; b < blocks[s].length; b += 1) if (Math.abs(blocks[s][b] - blocks[e][b]) > T.minAcross) changed += 1;
      if (changed < T.blockShare * blocks[s].length) continue;
      let ok = true;
      for (let t = s - k; t <= s && ok; t += 1) if (progress(t, s, e) >= T.progressBefore) ok = false;
      for (let t = e; t <= e + k && ok; t += 1) if (progress(t, s, e) <= T.progressAfter) ok = false;
      if (!ok) continue;
      let a = e, b = s, half = e;
      for (let t = s; t <= e; t += 1) { const p = progress(t, s, e); if (p >= T.tightenLow && a === e) a = t; if (p <= T.tightenHigh) b = t; if (p >= 0.5 && half === e) half = t; }
      candidates.push({ s, e, a, b, half, across });
    }
  }
  // Windows whose tightened spans overlap are one boundary (a long window
  // reaches the next boundary, its tightened span does not). Keep the widest:
  // a cover through a held dark frame also passes as old → dark and dark → new.
  for (const c of candidates) { c.from = Math.min(c.a, c.b + 1); c.to = Math.max(c.a, c.b + 1); }
  candidates.sort((x, y) => x.from - y.from);
  const clusters = [];
  for (const c of candidates) {
    const last = clusters.at(-1);
    if (last && c.from <= last.to) { last.to = Math.max(last.to, c.to); if (c.to - c.from > last.best.to - last.best.from || (c.to - c.from === last.best.to - last.best.from && c.across > last.best.across)) last.best = c; }
    else clusters.push({ to: c.to, best: c });
  }
  const transitions = [];
  for (const { best } of clusters) {
    if (warpExplains(frames[best.s], frames[best.e], W, H, T.warp)) continue;
    const start = Math.min(best.a, best.b + 1), end = Math.max(best.a, best.b + 1);
    const entry = { at: round((best.half - 0.5) / fps, 3), start: round((start - 0.5) / fps, 3), end: round((end - 0.5) / fps, 3), seconds: round((end - start) / fps, 3) };
    transitions.push({ ...entry, ...classifySpan(frames, W, H, fps, best, T, dist) });
  }
  return { crop, grid: { width: W, height: H }, transitions };
}

// Is frame b frame a shifted and scaled (a camera move, not a new picture)?
// Search on a half-size grid: scale in five steps, shift up to 30% of the side.
function warpExplains(a, b, w, h, limit) {
  const hw = Math.floor(w / 2), hh = Math.floor(h / 2);
  const A = shrink(a, w, h, hw, hh), B = shrink(b, w, h, hw, hh);
  const raw = meanAbs(A, B);
  let best = raw;
  const rx = Math.round(hw * 0.3), ry = Math.round(hh * 0.3);
  for (const s of [1 / 1.3, 1 / 1.15, 1, 1.15, 1.3]) for (let dy = -ry; dy <= ry; dy += 1) for (let dx = -rx; dx <= rx; dx += 1) {
    if (s === 1 && !dx && !dy) continue;
    let sum = 0, n = 0;
    for (let y = 0; y < hh; y += 2) for (let x = 0; x < hw; x += 2) {
      const sxp = Math.round((x - hw / 2) / s + hw / 2 - dx), syp = Math.round((y - hh / 2) / s + hh / 2 - dy);
      if (sxp < 0 || syp < 0 || sxp >= hw || syp >= hh) continue;
      sum += Math.abs(B[y * hw + x] - A[syp * hw + sxp]); n += 1;
    }
    if (n > hw * hh / 8) best = Math.min(best, sum / n);
  }
  return best < limit * raw;
}

function classifySpan(frames, W, H, fps, { s, e, a, b, half }, T, dist) {
  const A = frames[s], B = frames[e];
  const norm = Math.max(1, meanAbs(A, B));
  const middle = [];
  for (let t = Math.min(a, b); t <= Math.max(a, b); t += 1) if (t > s && t < e) middle.push(t);
  const seconds = Math.max(0, b - a + 1) / fps;
  // Dip through a flat black or white frame.
  // Spread is 1.4826 × the median absolute deviation (the std of a flat
  // frame's noise), so sparks and streaks over the cover do not count.
  for (const t of middle) {
    const m = frameMedian(frames[t]);
    if (robustSpread(frames[t]) < T.dip.flatStd && (m < T.dip.dark || m > T.dip.light)) return { kind: 'dip', via: m < T.dip.dark ? 'black' : 'white' };
  }
  if (seconds >= T.flash.minSpan && middle.length) {
    const peak = Math.max(...middle.map((t) => frameMean(frames[t])));
    if (peak > T.flash.peak && peak > frameMean(A) + T.flash.lift && peak > frameMean(B) + T.flash.lift) return { kind: 'flash' };
  }
  // Not in the RFC: a dip through a patterned cover (a halftone grid, a
  // pattern card): a middle frame far from both pictures.
  const away = Math.max(0, ...middle.map((t) => Math.min(meanAbs(frames[t], A), meanAbs(frames[t], B)) / norm));
  if (away >= T.dip.cover) return { kind: 'dip', via: 'pattern' };
  // A hard cut: one frame pair goes from the old picture (progress ≤ 0.12)
  // to the new (≥ 0.88); an eased push can be as short, but passes through.
  const progress = (t) => { const x = dist(t, s), y = dist(t, e); return x + y > 0 ? x / (x + y) : 0; };
  let hard = false;
  for (let t = s + 1; t <= e && !hard; t += 1) hard = progress(t - 1) <= T.tightenLow && progress(t) >= T.tightenHigh;
  if (hard && seconds < T.cutSpan) return { kind: 'cut' };
  if (middle.length < 2) return { kind: 'other' };
  const iris = irisFit(frames, W, H, s, e, middle, norm);
  if (Math.abs(iris.r) >= T.iris.correlation && iris.residual <= T.iris.residual) return { kind: 'iris', direction: iris.r > 0 ? 'open' : 'close' };
  const blend = middle.map((t) => blendFit(frames[t], A, B));
  const blendResidual = median(blend.map((x) => x.residual)) / norm;
  const edge = edgeFit(frames, W, H, A, B, middle, norm, T.edge);
  // A smeared picture is not a clean wipe: it goes on to the motion tests.
  if (edge && edge.residual <= T.edge.residual && edge.residual < T.edge.vsBlend * blendResidual && !(edge.mode === 'wipe' && edge.sharpness < T.whip.sharpness)) {
    // A slide smeared by motion blur is a whip.
    return { kind: edge.mode !== 'wipe' && edge.sharpness < T.whip.sharpness ? 'whip' : edge.mode, direction: edge.direction };
  }
  const motion = spanMotion(frames, W, H, s, e);
  if (motion.rotation >= T.spin.degrees && Math.abs(motion.netRotation) >= T.spin.net * motion.rotation) return { kind: 'spin' };
  if (Math.abs(motion.netLogScale) >= T.zoom.net && Math.abs(motion.netLogScale) >= T.zoom.consistent * motion.logScale) return { kind: 'zoom', direction: motion.netLogScale > 0 ? 'in' : 'out' };
  const base = Math.min(detail(A, W, H), detail(B, W, H));
  const sharpness = base > 0 ? Math.min(...middle.map((t) => detail(frames[t], W, H))) / base : 1;
  if (motion.net >= T.whip.net && motion.path < T.whip.path * motion.net && sharpness < T.whip.sharpness) return { kind: 'whip', direction: motion.direction };
  if (motion.path >= T.shake.path && motion.path > T.shake.net * motion.net) return { kind: 'shake' };
  const near = [half - 1, half].filter((t) => t > s && t < e);
  if (near.length === 2 && detail(frames[near[0]], W, H) < T.blur * detail(A, W, H) && detail(frames[near[1]], W, H) < T.blur * detail(B, W, H)) return { kind: 'blur' };
  if (blendResidual < T.dissolve.residual && correlation(middle, blend.map((x) => x.alpha)) > T.dissolve.rise) return { kind: 'dissolve' };
  let swings = 0, peak = 0, falling = false;
  for (const t of middle) {
    const p = dist(t, s) / Math.max(1e-6, dist(t, s) + dist(t, e));
    if (p > peak) { peak = p; falling = false; } else if (!falling && peak - p >= T.glitch.drop) { swings += 1; falling = true; peak = p; }
  }
  if (swings >= T.glitch.swings) return { kind: 'glitch' };
  return { kind: 'other' };
}

// frame ≈ A + α(B − A): the best α and the mean abs residual.
function blendFit(f, A, B) {
  let num = 0, den = 0;
  for (let k = 0; k < f.length; k += 1) { const d = B[k] - A[k]; num += (f[k] - A[k]) * d; den += d * d; }
  const alpha = den > 0 ? Math.max(0, Math.min(1, num / den)) : 0;
  let r = 0;
  for (let k = 0; k < f.length; k += 1) r += Math.abs(f[k] - A[k] - alpha * (B[k] - A[k]));
  return { alpha, residual: r / f.length };
}

// Per cell of the thumb grid, the frame it turns from old to new; the turn
// time against the distance from the centre (r), and how well "new inside,
// old outside" explains the middle frames (residual, ÷ the A–B change).
function irisFit(frames, W, H, s, e, middle, norm) {
  const A = frames[s], B = frames[e];
  const cell = Math.max(2, Math.round(Math.min(W, H) / 12));
  const turns = [], radii = [];
  const cx = W / 2, cy = H / 2;
  const cells = [];
  for (let y = 0; y + cell <= H; y += cell) for (let x = 0; x + cell <= W; x += cell) cells.push([x, y]);
  const cellDiff = (f, g, x, y) => { let d = 0; for (let j = 0; j < cell; j += 1) for (let i = 0; i < cell; i += 1) { const k = (y + j) * W + x + i; d += Math.abs(f[k] - g[k]); } return d / (cell * cell); };
  const turned = new Map();
  for (const [x, y] of cells) {
    if (cellDiff(A, B, x, y) < 10) continue;
    let turn = null, flips = 0, prev = false;
    for (let t = s; t <= e; t += 1) {
      const isNew = cellDiff(frames[t], B, x, y) < cellDiff(frames[t], A, x, y);
      if (isNew !== prev) { flips += 1; prev = isNew; if (isNew && turn === null) turn = t; }
    }
    if (turn === null || flips > 1) continue;
    turns.push(turn); radii.push(Math.hypot(x + cell / 2 - cx, y + cell / 2 - cy) / Math.hypot(cx, cy));
    turned.set(`${x},${y}`, turn);
  }
  if (turns.length < cells.length * 0.3) return { r: 0, residual: Infinity };
  const r = correlation(radii, turns);
  const residuals = middle.map((t) => {
    let d = 0;
    for (const [x, y] of cells) { const turn = turned.get(`${x},${y}`); d += cellDiff(frames[t], turn !== undefined && turn <= t ? B : A, x, y); }
    return d / cells.length;
  });
  return { r, residual: median(residuals) / norm };
}

// A straight edge travelling across the frame: wipe (both pictures still),
// push (both move), cover (the new one slides over) or reveal (the old one
// slides off). The best mode and direction by median residual over the
// middle frames, with the edge position rising and travelling far enough.
function edgeFit(frames, W, H, A, B, middle, norm, E) {
  const results = [];
  const comp = new Float32Array(W * H), best = new Float32Array(W * H);
  for (const direction of ['right', 'left', 'down', 'up']) {
    const horizontal = direction === 'right' || direction === 'left';
    const side = horizontal ? W : H;
    for (const mode of ['wipe', 'push', 'cover', 'reveal']) {
      const qs = [], res = [], sharp = [];
      for (const t of middle) {
        const f = frames[t];
        let bestR = Infinity, bestQ = 0;
        for (let p = 0; p < E.positions; p += 1) {
          const q = p / (E.positions - 1), edge = Math.round(q * side);
          for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
            // u: distance along the travel from the side the new picture enters.
            const u = direction === 'right' ? x : direction === 'left' ? W - 1 - x : direction === 'down' ? y : H - 1 - y;
            let src, uu;
            if (u < edge) { src = B; uu = mode === 'push' || mode === 'cover' ? u + side - edge : u; }
            else { src = A; uu = mode === 'push' || mode === 'reveal' ? u - edge : u; }
            const sx = horizontal ? (direction === 'right' ? uu : W - 1 - uu) : x, sy = horizontal ? y : (direction === 'down' ? uu : H - 1 - uu);
            comp[y * W + x] = src[sy * W + sx];
          }
          // One gain per frame: a glow or an exposure dip over the move.
          let fc = 0, cc = 0;
          for (let k = 0; k < comp.length; k += 1) { fc += f[k] * comp[k]; cc += comp[k] * comp[k]; }
          const g = cc > 0 ? fc / cc : 1;
          let sum = 0, plain = 0;
          for (let k = 0; k < comp.length; k += 1) { sum += Math.abs(f[k] - g * comp[k]); plain += Math.abs(f[k] - comp[k]); }
          const r = Math.min(sum, plain) / (W * H);
          if (r < bestR) { bestR = r; bestQ = q; best.set(comp); }
        }
        qs.push(bestQ); res.push(bestR);
        const d = detail(best, W, H);
        sharp.push(d > 0 ? detail(f, W, H) / d : 1);
      }
      const rise = correlation(middle, qs), travel = Math.max(...qs) - Math.min(...qs);
      if (rise >= E.rise && travel >= E.travel) results.push({ mode, direction, residual: median(res) / norm, sharpness: Math.min(...sharp) });
    }
  }
  if (!results.length) return null;
  const wipe = results.filter((x) => x.mode === 'wipe').sort((x, y) => x.residual - y.residual)[0];
  // Cover and reveal (one picture moves) must beat push (both move) by the
  // same margin a moving mode needs over a wipe: near ties read as push.
  const push = results.filter((x) => x.mode === 'push').sort((x, y) => x.residual - y.residual)[0];
  const single = results.filter((x) => x.mode === 'cover' || x.mode === 'reveal').sort((x, y) => x.residual - y.residual)[0];
  const moving = push && (!single || single.residual >= (1 - E.moveBeat) * push.residual) ? push : single;
  if (!wipe) return moving;
  return moving && moving.residual < (1 - E.moveBeat) * wipe.residual ? moving : wipe;
}

// Whole-frame motion across the span from consecutive frame pairs: a
// similarity (shift, scale, rotation) fitted to block matches on the work
// grid. Shifts are fractions of the short side. → {net, path, direction,
// logScale, netLogScale, rotation, netRotation (degrees)}
function spanMotion(frames, W, H, s, e) {
  const block = 6, radius = 6;
  const sads = new Float64Array((2 * radius + 1) ** 2);
  const buffer = new Uint8Array(W * H * 2);
  let nx = 0, ny = 0, path = 0, logScale = 0, netLogScale = 0, rotation = 0, netRotation = 0;
  for (let t = s + 1; t <= e; t += 1) {
    for (let k = 0; k < W * H; k += 1) { buffer[k] = frames[t - 1][k]; buffer[W * H + k] = frames[t][k]; }
    const matches = [];
    for (let y = radius; y + block + radius <= H; y += block) for (let x = radius; x + block + radius <= W; x += block) {
      if (blockTexture(buffer, 0, W, x, y, block) < 4) continue;
      const m = searchBlock(buffer, 0, W * H, W, x, y, block, radius, sads);
      if (m.bestSad > 24 * block * block) continue;
      matches.push({ x: x + block / 2, y: y + block / 2, dx: m.bestDx + m.ox, dy: m.bestDy + m.oy });
    }
    if (matches.length < 6) continue;
    const fit = fitSimilarity(matches, W / 2, H / 2);
    const short = Math.min(W, H);
    nx += fit.tx / short; ny += fit.ty / short; path += Math.hypot(fit.tx, fit.ty) / short;
    const ls = Math.log(Math.max(0.2, fit.scale));
    logScale += Math.abs(ls); netLogScale += ls;
    const deg = fit.angle * 180 / Math.PI;
    rotation += Math.abs(deg); netRotation += deg;
  }
  const net = Math.hypot(nx, ny);
  // Content moving right means the camera whips left; report the content's travel.
  const direction = Math.abs(nx) >= Math.abs(ny) ? (nx > 0 ? 'right' : 'left') : (ny > 0 ? 'down' : 'up');
  return { net, path, direction, logScale, netLogScale, rotation, netRotation };
}

// Least squares d = t + a·(p − c) + b·perp(p − c), outliers over 2 px dropped once.
function fitSimilarity(matches, cx, cy) {
  const solve = (list) => {
    const n = list.length;
    let mx = 0, my = 0, mdx = 0, mdy = 0;
    for (const m of list) { mx += m.x - cx; my += m.y - cy; mdx += m.dx; mdy += m.dy; }
    mx /= n; my /= n; mdx /= n; mdy /= n;
    let sa = 0, sb = 0, den = 0;
    for (const m of list) {
      const x = m.x - cx - mx, y = m.y - cy - my, dx = m.dx - mdx, dy = m.dy - mdy;
      sa += x * dx + y * dy; sb += x * dy - y * dx; den += x * x + y * y;
    }
    const a = den > 0 ? sa / den : 0, b = den > 0 ? sb / den : 0;
    return { a, b, tx: mdx - a * mx + b * my, ty: mdy - b * mx - a * my };
  };
  let fit = solve(matches);
  const kept = matches.filter((m) => { const x = m.x - cx, y = m.y - cy; return Math.hypot(m.dx - fit.tx - fit.a * x + fit.b * y, m.dy - fit.ty - fit.b * x - fit.a * y) <= 2; });
  if (kept.length >= 6) fit = solve(kept);
  return { tx: fit.tx, ty: fit.ty, scale: Math.hypot(1 + fit.a, fit.b), angle: Math.atan2(fit.b, 1 + fit.a) };
}

/**
 * Classify the transitions of a video file. Two decodes: 48 grey frames
 * spread through the video find the picture inside any letterbox
 * (pictureCrop), then ffmpeg crops that picture and scales it straight to
 * the work grid at 30 fps, so a letterboxed copy is read from the same
 * pixels. → {crop (source px), grid, transitions, duration_seconds}
 */
export async function analyzeTransitionsFile(videoPath, options = {}, adapters = {}) {
  const resolved = path.resolve(videoPath);
  const run = adapters.run ?? runCommand;
  const runRaw = adapters.runRaw ?? ((command, args) => execFileAsync(command, args, { encoding: null, maxBuffer: 1024 * 1024 * 1024 }));
  const probe = JSON.parse((await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", resolved])).stdout);
  const { width: vw, height: vh } = probe.streams?.[0] ?? {};
  const duration = Number(probe.format?.duration);
  if (!vw || !vh) throw new Error(`No video stream found: ${resolved}`);
  const T = TRANSITION_CLASSIFY;
  const even = (v) => Math.max(2, 2 * Math.round(v / 2));
  const cropLong = Math.min(Math.max(vw, vh), T.crop.longSide);
  const sw = vw >= vh ? cropLong : even(cropLong * vw / vh), sh = vw >= vh ? even(cropLong * vh / vw) : cropLong;
  const sampleRate = Number.isFinite(duration) && duration > 0 ? T.crop.samples / duration : 1;
  const samples = await runRaw("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", resolved, "-vf", `fps=${sampleRate},scale=${sw}:${sh}:flags=area,format=gray`, "-an", "-f", "rawvideo", "pipe:1"]);
  const small = pictureCrop(Buffer.from(samples.stdout ?? []), sw, sh);
  // Rounded inward, so no letterbox bar bleeds into the picture.
  const x0 = Math.ceil(small.x * vw / sw), y0 = Math.ceil(small.y * vh / sh);
  const crop = { x: x0, y: y0, width: Math.min(vw, Math.floor((small.x + small.width) * vw / sw)) - x0, height: Math.min(vh, Math.floor((small.y + small.height) * vh / sh)) - y0 };
  const portrait = crop.height >= crop.width;
  const long = Math.max(T.workShortSide, Math.round(T.workShortSide * Math.max(crop.width, crop.height) / Math.min(crop.width, crop.height)));
  const W = portrait ? T.workShortSide : long, H = portrait ? long : T.workShortSide;
  const raw = await runRaw("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", resolved, "-vf", `fps=${T.fps},crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},scale=${W}:${H}:flags=area,format=gray`, "-an", "-f", "rawvideo", "pipe:1"]);
  const buffer = Buffer.from(raw.stdout ?? []);
  const result = classifyTransitions(buffer, W, H, T.fps, { ...options, cropped: true });
  return { ...result, crop, duration_seconds: round(buffer.length / (W * H) / T.fps, 3) };
}

// ---------------------------------------------------------------------------
// Per-element entrances (docs/PLAN_AND_PACE_RFC.md §4.2). RGB frames 180 px
// wide are reduced, frame by frame, to per-cell stats (4 px cells), so a
// reference never sits in memory as pixels. Every threshold is the RFC's
// unless its line says otherwise.
export const ENTRANCE_CLASSIFY = Object.freeze({
  width: 180,
  fps: 30, // the RFC says ≤ 15: at 15 fps a start is only known to 67 ms, and the stagger test is one 30 fps frame
  maxSeconds: 120, // shortcut: only the first two minutes are read (~0.65 MB of cell stats a second); stream events out if long references matter
  cell: 4,
  levels: 12, // a pixel changed when any channel moves more than this
  cellShare: 0.12, // a cell is active when more than this share of its pixels changed
  cut: Object.freeze({ share: 0.5, spike: 3 }), // a frame pair with this share of cells active, ≥ spike × both neighbours, splits shots (the RFC leaves "a shot" open)
  continuous: Object.freeze({ active: 0.7, drift: 8, driftShare: 0.6, driftSeconds: 1 }), // drift is counted over 1 s windows in which the cell is never active, so an element that enters and stays is not drift
  join: 1, // a cell's activity bridges gaps of this many frame pairs
  splitSeconds: 0.12,
  minArea: 0.002,
  maxArea: 0.6, // not in the RFC: change over more of the frame is a transition or a camera move, not an element
  role: 1.25, // not in the RFC: detail (luma gradient) after ÷ before ≥ this is an entrance, before ÷ after an exit, else a change
  ease: Object.freeze({ out: 0.68, in: 0.32, linearCv: 0.45, floorPairs: 6, tail: 0.05, onset: 0.25 }), // not in the RFC (onset: an entrance starts where its activity first crosses this share of its peak): the noise floor taken off the activity is read over floorPairs each side, and the span runs out from the peak (up to floorPairs past the thresholded one) while activity is above tail × the peak
  kind: Object.freeze({ tip: 0.35, correlation: 0.6, travel: 0.02, ownTravel: 0.25, scale: 0.6, presence: 10, firstShare: 0.5 }), // not in the RFC: presence is a cell's mean moved this far from before the event; the first frame read is the first with firstShare of the final presence; a slide also travels ownTravel of its own extent (a blurred shrink-in drifts ≤ 0.07, a slide ~1)
  stagger: Object.freeze({ min: 3, size: 0.4, duration: 0.5, regularity: 0.4 })
});

export const ENTRANCE_EASES = Object.freeze(['ease-out', 'ease-in', 'in-out', 'linear']);
export const ENTRANCE_KINDS = Object.freeze(['draw-on', 'slide', 'scale', 'fade']);
// Measured ease → the grammar ease role it plays (kit/core/grammar.mjs easeRole); linear has none.
export const ENTRANCE_EASE_ROLES = Object.freeze({ 'ease-out': 'enter', 'ease-in': 'exit', 'in-out': 'move', linear: null });
// The median element-level module stagger (end-card and media layouts 0.28; equation 0.22, logo-row 0.14; brand lockup and short lists 0.35, photo lines 0.45):
// a measured interval ÷ this is the grammar's stagger multiplier.
export const MODULE_STAGGER_SECONDS = 0.28;

/**
 * A per-frame reducer for classifyEntrances: push(frame) takes one RGB frame
 * (width × height × 3), finish(options) classifies what was pushed.
 */
export function entranceAccumulator(width, height, fps = ENTRANCE_CLASSIFY.fps) {
  const E = ENTRANCE_CLASSIFY, S = E.cell;
  const cw = Math.floor(width / S), ch = Math.floor(height / S), cells = cw * ch, perCell = S * S;
  const means = [], details = [], shares = [], mags = [];
  let previous = null;
  return {
    push(frame) {
      const mean = new Uint8Array(cells * 3), detail = new Uint8Array(cells);
      const share = previous ? new Uint8Array(cells) : null, mag = previous ? new Uint8Array(cells) : null;
      for (let cy = 0; cy < ch; cy += 1) for (let cx = 0; cx < cw; cx += 1) {
        let r = 0, g = 0, b = 0, grad = 0, changed = 0, moved = 0;
        for (let y = cy * S; y < cy * S + S; y += 1) for (let x = cx * S; x < cx * S + S; x += 1) {
          const k = (y * width + x) * 3;
          r += frame[k]; g += frame[k + 1]; b += frame[k + 2];
          const luma = frame[k] + 2 * frame[k + 1] + frame[k + 2];
          if (x + 1 < width) { const j = k + 3; grad += Math.abs(luma - (frame[j] + 2 * frame[j + 1] + frame[j + 2])); }
          if (y + 1 < height) { const j = k + width * 3; grad += Math.abs(luma - (frame[j] + 2 * frame[j + 1] + frame[j + 2])); }
          if (previous) {
            const d = Math.max(Math.abs(frame[k] - previous[k]), Math.abs(frame[k + 1] - previous[k + 1]), Math.abs(frame[k + 2] - previous[k + 2]));
            moved += d;
            if (d > E.levels) changed += 1;
          }
        }
        const c = cy * cw + cx;
        mean[c * 3] = r / perCell; mean[c * 3 + 1] = g / perCell; mean[c * 3 + 2] = b / perCell;
        detail[c] = Math.min(255, grad / (perCell * 8));
        if (previous) { share[c] = Math.round(changed / perCell * 255); mag[c] = Math.min(255, Math.round(moved / perCell)); }
      }
      means.push(mean); details.push(detail);
      if (previous) { shares.push(share); mags.push(mag); }
      previous = Buffer.from(frame);
    },
    finish(options = {}) { return classifyCells({ means, details, shares, mags, cw, ch, fps }, options); }
  };
}

/**
 * Per-element entrances from RGB frames (width × height × 3 each) at `fps`.
 * → {events: [{at, seconds, role (enter | exit | change), area, box, ease?,
 * kind?, direction?}], entrances (the role-enter events), sequences: [{at,
 * count, interval, item_seconds, kind, ease}], continuous: {share, box},
 * duration_seconds}
 */
export function classifyEntrances(rgbFrames, width, height, fps = ENTRANCE_CLASSIFY.fps, options = {}) {
  const accumulator = entranceAccumulator(width, height, fps);
  const size = width * height * 3;
  for (let offset = 0; offset + size <= rgbFrames.length; offset += size) accumulator.push(rgbFrames.subarray(offset, offset + size));
  return accumulator.finish(options);
}

function classifyCells({ means, details, shares, mags, cw, ch, fps }, options) {
  const E = { ...ENTRANCE_CLASSIFY, ...options };
  const cells = cw * ch, pairs = shares.length, on = Math.round(E.cellShare * 255);
  const duration = round(means.length / fps, 3);
  if (pairs < 2) return { events: [], entrances: [], sequences: [], continuous: { share: 0, box: null }, duration_seconds: duration };
  const active = (p, c) => shares[p][c] > on;
  const activeShare = shares.map((share) => { let n = 0; for (let c = 0; c < cells; c += 1) if (share[c] > on) n += 1; return n / cells; });
  // Shots: frame ranges [first, last] split at hard cuts.
  const shots = [];
  let shotStart = 0;
  for (let p = 0; p < pairs; p += 1) {
    const s = activeShare[p], before = activeShare[p - 1] ?? 0, after = activeShare[p + 1] ?? 0;
    if (s >= E.cut.share && s >= E.cut.spike * before && s >= E.cut.spike * after) { shots.push([shotStart, p]); shotStart = p + 1; }
  }
  shots.push([shotStart, means.length - 1]);
  const events = [];
  const continuousCells = new Uint8Array(cells);
  let continuousWeight = 0;
  const driftFrames = Math.round(E.continuous.driftSeconds * fps);
  for (const [first, last] of shots) {
    const shotPairs = last - first; // pairs first … last - 1
    if (shotPairs < 2) continue;
    // The continuous layer: cells active most of the shot, or drifting slowly while never active.
    // Drifting cells are never active, so they make no events; only the busy ones are left out.
    const continuous = new Uint8Array(cells), busy = new Uint8Array(cells);
    const prefix = new Int32Array(shotPairs + 1);
    for (let c = 0; c < cells; c += 1) {
      for (let i = 0; i < shotPairs; i += 1) prefix[i + 1] = prefix[i] + (active(first + i, c) ? 1 : 0);
      if (prefix[shotPairs] > E.continuous.active * shotPairs) { continuous[c] = 1; busy[c] = 1; continue; }
      let eligible = 0, drifting = 0;
      for (let t = first; t + driftFrames <= last; t += 1) {
        if (prefix[t - first + driftFrames] - prefix[t - first] > 0) continue;
        eligible += 1;
        const a = means[t], b = means[t + driftFrames];
        if (Math.max(Math.abs(a[c * 3] - b[c * 3]), Math.abs(a[c * 3 + 1] - b[c * 3 + 1]), Math.abs(a[c * 3 + 2] - b[c * 3 + 2])) > E.continuous.drift) drifting += 1;
      }
      if (eligible && drifting > E.continuous.driftShare * eligible) continuous[c] = 1;
    }
    let count = 0;
    for (let c = 0; c < cells; c += 1) if (continuous[c]) { count += 1; continuousCells[c] = 1; }
    continuousWeight += count / cells * (last - first + 1);
    // Runs of activity per cell, joined across small gaps.
    const runs = [], byCell = new Map();
    for (let c = 0; c < cells; c += 1) {
      if (busy[c]) continue;
      let start = -1, end = -1;
      for (let p = first; p < last; p += 1) {
        if (!active(p, c)) continue;
        if (start >= 0 && p - end - 1 <= E.join) { end = p; continue; }
        if (start >= 0) runs.push({ c, a: start, b: end });
        start = p; end = p;
      }
      if (start >= 0) runs.push({ c, a: start, b: end });
    }
    runs.forEach((run, i) => { if (!byCell.has(run.c)) byCell.set(run.c, []); byCell.get(run.c).push(i); });
    // Connected cells whose runs overlap in time are one piece.
    const parent = runs.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    runs.forEach((run, i) => {
      const x = run.c % cw, y = Math.floor(run.c / cw);
      for (const [nx, ny] of [[x + 1, y], [x, y + 1]]) {
        if (nx >= cw || ny >= ch) continue;
        for (const j of byCell.get(ny * cw + nx) ?? []) if (runs[j].a <= run.b + 1 && run.a <= runs[j].b + 1) parent[find(i)] = find(j);
      }
    });
    const groups = new Map();
    runs.forEach((run, i) => { const root = find(i); if (!groups.has(root)) groups.set(root, []); groups.get(root).push(run); });
    const split = E.splitSeconds * fps;
    for (const group of groups.values()) {
      group.sort((left, right) => left.a - right.a);
      let piece = [group[0]];
      for (let i = 1; i <= group.length; i += 1) {
        if (i < group.length && group[i].a - group[i - 1].a <= split) { piece.push(group[i]); continue; }
        const event = describeEvent(piece, { means, details, mags, cw, ch, cells, fps, E });
        if (event) events.push(event);
        piece = [group[i]];
      }
    }
  }
  events.sort((left, right) => left.first - right.first);
  // Touching draw-ons where one starts as the last ends are one draw-on (not
  // any entrance: staggered items whose interval is their duration would join).
  const entering = events.filter((event) => event.role === 'enter');
  for (let i = 0; i < entering.length; i += 1) {
    const a = entering[i];
    if (a.joined) continue;
    for (let j = i + 1; j < entering.length; j += 1) {
      const b = entering[j];
      if (b.joined || a.kind !== 'draw-on' || b.kind !== 'draw-on' || Math.abs(b.first - (a.last + 1)) > E.join + 1 || !touches(a.cellSet, b.cellSet, cw)) continue;
      b.joined = true;
      Object.assign(a, describeEvent([...a.runs, ...b.runs], { means, details, mags, cw, ch, cells, fps, E }), { kind: 'draw-on' });
    }
  }
  const kept = events.filter((event) => !event.joined);
  const entrances = kept.filter((event) => event.role === 'enter');
  return {
    events: kept.map(publicEvent),
    entrances: entrances.map(publicEvent),
    sequences: staggerSequences(entrances, shots, fps, E),
    continuous: { share: round(continuousWeight / means.length, 4), box: cellBox(continuousCells, cw, ch) },
    duration_seconds: duration
  };
}

function publicEvent({ at, seconds, role, area, box, ease, kind, direction }) {
  return { at, seconds, role, area, box, ...(role === 'enter' ? { ease, kind, ...(direction ? { direction } : {}) } : {}) };
}

function touches(a, b, cw) {
  for (const c of b) {
    const x = c % cw;
    if (a.has(c) || a.has(c - cw) || a.has(c + cw) || (x > 0 && a.has(c - 1)) || (x < cw - 1 && a.has(c + 1))) return true;
  }
  return false;
}

function cellBox(set, cw, ch) {
  let x0 = cw, y0 = ch, x1 = -1, y1 = -1;
  const list = set instanceof Uint8Array ? [...set.keys()].filter((c) => set[c]) : set;
  for (const c of list) { const x = c % cw, y = Math.floor(c / cw); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return x1 < 0 ? null : { x: round(x0 / cw, 3), y: round(y0 / ch, 3), width: round((x1 - x0 + 1) / cw, 3), height: round((y1 - y0 + 1) / ch, 3) };
}

// One event from its runs: span, role, and for an entrance its ease and how it enters.
function describeEvent(runs, { means, details, mags, cw, ch, cells, fps, E }) {
  const cellSet = new Set(runs.map((run) => run.c));
  const area = cellSet.size / cells;
  if (area < E.minArea || area > E.maxArea) return null;
  const first = Math.min(...runs.map((run) => run.a)), last = Math.max(...runs.map((run) => run.b));
  const list = [...cellSet];
  const detailAt = (f) => list.reduce((sum, c) => sum + details[f][c], 0);
  const before = detailAt(first), after = detailAt(last + 1);
  const role = after >= E.role * Math.max(1, before) ? 'enter' : before >= E.role * Math.max(1, after) ? 'exit' : 'change';
  const event = { first, last, runs, cellSet, role, at: round(first / fps, 3), seconds: round((last - first + 1) / fps, 3), area: round(area, 4), box: cellBox(list, cw, ch) };
  if (role !== 'enter') return event;
  // Ease: the share of the activity done by the span's midpoint.
  const level = (p) => list.reduce((sum, c) => sum + mags[p][c], 0);
  // Less the noise floor: the quietest of the medians just before and just after.
  const around = (from, to) => { const values = []; for (let p = Math.max(0, from); p <= Math.min(mags.length - 1, to); p += 1) values.push(level(p)); return values.length ? median(values) : 0; };
  const floor = Math.min(around(first - E.ease.floorPairs, first - 1), around(last + 1, last + E.ease.floorPairs));
  // The thresholded span misses an ease's slow ends and keeps bridged noise:
  // the span runs out from the peak while the activity stays above a share of it.
  let top = first, peak = -Infinity;
  for (let p = first; p <= last; p += 1) if (level(p) - floor > peak) { peak = level(p) - floor; top = p; }
  let from = top, to = top;
  while (from > Math.max(0, first - E.ease.floorPairs) && level(from - 1) - floor > E.ease.tail * peak) from -= 1;
  while (to < Math.min(mags.length - 1, last + E.ease.floorPairs) && level(to + 1) - floor > E.ease.tail * peak) to += 1;
  const curve = [];
  for (let p = from; p <= to; p += 1) curve.push(Math.max(0, level(p) - floor));
  const total = curve.reduce((sum, v) => sum + v, 0) || 1, n = curve.length;
  let done = 0;
  for (let i = 0; i < Math.floor(n / 2); i += 1) done += curve[i];
  if (n % 2) done += curve[(n - 1) / 2] / 2;
  const share = done / total, mean = total / n;
  const cv = Math.sqrt(curve.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n) / (mean || 1);
  // An entrance lasts its widened span. Its onset, which staggers read, is
  // where the curve first crosses a share of its peak, between frame pairs:
  // the thresholded start jitters with an item's size on a slow ease-in.
  event.seconds = round(n / fps, 3);
  const cross = E.ease.onset * Math.max(...curve);
  const k = curve.findIndex((v) => v >= cross);
  event.onset = from + (k > 0 ? k - 1 + (cross - curve[k - 1]) / (curve[k] - curve[k - 1]) : 0);
  event.at = round(event.onset / fps, 3);
  event.ease = share > E.ease.out ? 'ease-out' : share < E.ease.in ? 'ease-in' : cv < E.ease.linearCv ? 'linear' : 'in-out';
  Object.assign(event, entranceKind(event, list, { means, cw, fps, E }));
  return event;
}

// How an element enters: a draw-on or wipe (a thin active tip whose start
// time runs along x or y), a slide (the centroid travels), a scale (it
// starts narrow), else a fade.
function entranceKind({ first, last, runs }, list, { means, cw, E }) {
  const K = E.kind;
  const starts = new Map();
  for (const run of runs) starts.set(run.c, Math.min(starts.get(run.c) ?? Infinity, run.a));
  const tips = [];
  for (let p = first; p <= last; p += 1) tips.push(runs.filter((run) => run.a <= p && run.b >= p).length / list.length);
  const xs = list.map((c) => c % cw), ys = list.map((c) => Math.floor(c / cw)), ts = list.map((c) => starts.get(c));
  const rx = pearson(xs, ts), ry = pearson(ys, ts);
  if (median(tips) < K.tip && Math.max(Math.abs(rx), Math.abs(ry)) > K.correlation) {
    return { kind: 'draw-on', direction: Math.abs(rx) >= Math.abs(ry) ? (rx > 0 ? 'right' : 'left') : (ry > 0 ? 'down' : 'up') };
  }
  const base = means[first];
  const present = (f) => list.filter((c) => { const m = means[f]; return Math.max(Math.abs(m[c * 3] - base[c * 3]), Math.abs(m[c * 3 + 1] - base[c * 3 + 1]), Math.abs(m[c * 3 + 2] - base[c * 3 + 2])) > K.presence; });
  const final = present(last + 1);
  if (!final.length) return { kind: 'fade' };
  let early = final;
  for (let f = first + 1; f <= last + 1; f += 1) { const seen = present(f); if (seen.length >= K.firstShare * final.length) { early = seen; break; } }
  const centroid = (set) => [set.reduce((s, c) => s + c % cw, 0) / set.length, set.reduce((s, c) => s + Math.floor(c / cw), 0) / set.length];
  const [ex, ey] = centroid(early), [fx, fy] = centroid(final);
  const ch = means[0].length / 3 / cw;
  const dx = (fx - ex) / cw, dy = (fy - ey) / ch;
  const extent = (f) => Math.max(...final.map(f)) - Math.min(...final.map(f)) + 1;
  const ownX = Math.abs(fx - ex) / extent((c) => c % cw), ownY = Math.abs(fy - ey) / extent((c) => Math.floor(c / cw));
  if ((Math.abs(dx) > K.travel && ownX >= K.ownTravel) || (Math.abs(dy) > K.travel && ownY >= K.ownTravel)) return { kind: 'slide', direction: Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up') };
  const width = (set) => Math.max(...set.map((c) => c % cw)) - Math.min(...set.map((c) => c % cw)) + 1;
  return width(early) < K.scale * width(final) ? { kind: 'scale' } : { kind: 'fade' };
}

function pearson(a, b) {
  const n = a.length;
  if (n < 3) return 0;
  const ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i += 1) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
}

// Staggers: per shot, entrances of one kind with similar sizes and
// durations, at least three, starting at regular gaps.
function staggerSequences(entrances, shots, fps, E) {
  const S = E.stagger, sequences = [];
  const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance * Math.max(a, b);
  for (const [first, last] of shots) {
    let remaining = entrances.filter((event) => event.first >= first && event.first < last);
    while (remaining.length) {
      const [head] = remaining;
      // The entrances like the first, taken in order while each gap stays near the first gap.
      const like = remaining.filter((event) => event === head || (event.kind === head.kind && near(event.area, head.area, S.size) && near(event.seconds, head.seconds, S.duration)));
      const chain = like.slice(0, 2);
      for (const event of like.slice(2)) if (Math.abs(event.onset - chain.at(-1).onset - (chain[1].onset - head.onset)) <= S.regularity * (chain[1].onset - head.onset)) chain.push(event); else break;
      const gaps = differences(chain.map((event) => event.onset));
      const mean = gaps.reduce((s, v) => s + v, 0) / Math.max(1, gaps.length);
      const std = Math.sqrt(gaps.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, gaps.length));
      if (chain.length < S.min || mean <= 0 || std > S.regularity * mean) { remaining = remaining.slice(1); continue; }
      remaining = remaining.filter((event) => !chain.includes(event));
      const eases = chain.map((event) => event.ease);
      sequences.push({ at: chain[0].at, count: chain.length, interval: round(mean / fps, 3), item_seconds: round(median(chain.map((event) => event.seconds)), 3), kind: head.kind,
        ease: eases.sort((a, b) => eases.filter((v) => v === b).length - eases.filter((v) => v === a).length)[0] });
    }
  }
  return sequences;
}

/**
 * Profile fields from classifyEntrances: entrance_seconds (p50),
 * stagger_interval_seconds (p50 of the sequences' intervals),
 * entrance_ease_mix, entrance_kind_mix (shares) and continuous_layer_share.
 * Medians are null without entrances or sequences.
 */
export function entranceStats(result) {
  const entrances = result?.entrances ?? [];
  const mix = (key) => {
    const counts = {};
    for (const event of entrances) counts[event[key]] = (counts[event[key]] ?? 0) + 1;
    return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([name, n]) => [name, round(n / entrances.length, 3)]));
  };
  const intervals = (result?.sequences ?? []).map((sequence) => sequence.interval);
  return {
    entrance_seconds: entrances.length ? round(median(entrances.map((event) => event.seconds)), 3) : null,
    stagger_interval_seconds: intervals.length ? round(median(intervals), 3) : null,
    entrance_ease_mix: mix('ease'),
    entrance_kind_mix: mix('kind'),
    continuous_layer_share: result?.continuous?.share ?? 0
  };
}

/** Decode a video at 180 px wide and ENTRANCE_CLASSIFY.fps (the first maxSeconds) and classify its entrances. adapters.stream replaces the ffmpeg reader. */
export async function analyzeEntrancesFile(videoPath, options = {}, adapters = {}) {
  const resolved = path.resolve(videoPath);
  const run = adapters.run ?? runCommand;
  const probe = JSON.parse((await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", resolved])).stdout);
  const { width: vw, height: vh } = probe.streams?.[0] ?? {};
  if (!vw || !vh) throw new Error(`No video stream found: ${resolved}`);
  const E = ENTRANCE_CLASSIFY;
  const W = E.width, H = Math.max(E.cell, 2 * Math.round(W * vh / vw / 2));
  const accumulator = entranceAccumulator(W, H, E.fps);
  await (adapters.stream ?? streamRawFrames)("ffmpeg", ["-hide_banner", "-loglevel", "error", "-t", String(E.maxSeconds), "-i", resolved, "-vf", `fps=${E.fps},scale=${W}:${H}:flags=area,format=rgb24`, "-an", "-f", "rawvideo", "pipe:1"], W * H * 3, (frame) => accumulator.push(frame));
  return accumulator.finish(options);
}
