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

async function runCommand(command, args) {
  return execFileAsync(command, args, { maxBuffer: 1024 * 1024 * 128 });
}

async function runRawCommand(command, args) {
  return execFileAsync(command, args, { encoding: null, maxBuffer: 1024 * 1024 * 128 });
}
