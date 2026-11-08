// The cinematic look of a render: how motion blurs, how often the frame goes
// soft, how hard single frames jump, where the light sits and how much of the
// frame is mid-tone. The frame-difference and flow passes in
// render_motion_analysis.js see how much moves; these see how it looks while
// it moves. A flat reel's panels slide past razor-sharp, never leave focus,
// snap in one frame, sit unlit on near-black and carry no haze.
//
// Every frame is read once, grey, at a fixed grid (360 px short side; 360×640
// for 9:16), at a fixed 30 fps, so a 720p upload and a 1080p render compare.
// The sharpness measures are ratios against the same video's own held frames,
// so a reference softened by platform compression is judged against itself.
// Per frame (change is the mean absolute grey difference from the previous
// frame; the first frame has none):
//
//   sharpness   variance of the 4-neighbour Laplacian over the interior
//   top, middle mean grey of the top band (rows 0–17.2%) and the middle band
//               (rows 39–61%)
//   midtone     share of pixels with grey 29–109 (neither the near-black
//               background nor bright ink: translucent layers, haze, glows)
//
// Aggregates (null when there are too few frames to say):
//
//   moving_sharpness_ratio  median sharpness of moving frames (change > 3)
//                           ÷ median sharpness of held frames (change < 0.4).
//                           Under 1: moves blur. Over 1: moves stay crisp
//                           (and add edges) while holds are no sharper.
//   soft_frame_share        share of frames with sharpness under 35% of the
//                           held median (defocused, blurred or hazed frames)
//   change_p99, max_change  99th percentile and maximum of change: how hard
//                           the hardest single-frame jumps are
//   top_light_ratio         median over frames of top ÷ middle: over 1, light
//                           falls from above; under 1, the top is darker
//   midtone_share           mean midtone share over frames
//   burst_change_mean       mean change over frames with change > 2.5: how
//                           big a move is while something moves
//
// With fewer than three held frames, sharpness is compared with the median of
// every frame; with fewer than three moving frames there is no ratio.
// Only numbers leave this file.
import { spawn } from "node:child_process";

export const LOOK = Object.freeze({
  fps: 30,
  shortSide: 360,
  movingChange: 3,
  stillChange: 0.4,
  burstChange: 2.5,
  softSharpness: 0.35,
  topBand: Object.freeze([0, 0.172]),
  middleBand: Object.freeze([0.39, 0.61]),
  midtone: Object.freeze([29, 109]),
  minimumFrames: 3
});

/** The look grid for a width × height video: 360 px short side, the video's aspect (9:16 → 360×640). */
export function lookGrid(width, height, shortSide = LOOK.shortSide) {
  const w = Number(width) > 0 ? Number(width) : 9, h = Number(height) > 0 ? Number(height) : 16;
  const even = (value) => Math.max(2, 2 * Math.round(value / 2));
  return w >= h ? { width: even(shortSide * w / h), height: even(shortSide) } : { width: even(shortSide), height: even(shortSide * h / w) };
}

/** The ffmpeg arguments that read a video as grey frames on the look grid. */
export function lookFrameArgs(video, grid, fps = LOOK.fps) {
  return ["-hide_banner", "-loglevel", "error", "-i", video, "-vf", `fps=${fps},scale=${grid.width}:${grid.height}:flags=area,format=gray`, "-an", "-f", "rawvideo", "pipe:1"];
}

/**
 * A per-frame accumulator for grey frames of width × height bytes: push(frame)
 * each frame in order, then result(). Keeps one previous frame and five
 * numbers per frame, so a long render streams through in constant memory.
 */
export function lookAccumulator(width, height, fps = LOOK.fps) {
  const size = width * height;
  const topRows = [Math.round(LOOK.topBand[0] * height), Math.max(1, Math.round(LOOK.topBand[1] * height))];
  const middleRows = [Math.round(LOOK.middleBand[0] * height), Math.max(Math.round(LOOK.middleBand[0] * height) + 1, Math.round(LOOK.middleBand[1] * height))];
  const [low, high] = LOOK.midtone;
  const frames = [];
  let previous = null;
  return {
    push(frame) {
      if (!frame || frame.length < size) return;
      let top = 0, middle = 0, midtone = 0, change = 0;
      for (let y = 0; y < height; y += 1) {
        const row = y * width;
        let rowSum = 0;
        for (let x = 0; x < width; x += 1) {
          const value = frame[row + x];
          rowSum += value;
          if (value >= low && value <= high) midtone += 1;
          if (previous) change += Math.abs(value - previous[row + x]);
        }
        if (y >= topRows[0] && y < topRows[1]) top += rowSum;
        if (y >= middleRows[0] && y < middleRows[1]) middle += rowSum;
      }
      frames.push({
        sharpness: laplacianVariance(frame, width, height),
        change: previous ? change / size : null,
        top: top / ((topRows[1] - topRows[0]) * width),
        middle: middle / ((middleRows[1] - middleRows[0]) * width),
        midtone: midtone / size
      });
      previous = Buffer.from(frame.subarray(0, size));
    },
    result() {
      return { method: "laplacian-variance", sample_fps: fps, grid: { width, height }, ...lookFromFrames(frames) };
    }
  };
}

/** The look of raw grey frames (width × height bytes each) in one buffer. */
export function analyzeLook(rawFrames, width, height, fps = LOOK.fps) {
  const look = lookAccumulator(width, height, fps);
  const size = width * height;
  for (let offset = 0; size > 0 && offset + size <= (rawFrames?.length ?? 0); offset += size) look.push(rawFrames.subarray(offset, offset + size));
  return look.result();
}

/**
 * The look aggregates from per-frame stats [{sharpness, change (null for the
 * first frame), top, middle, midtone}].
 */
export function lookFromFrames(frames) {
  const pairs = frames.filter((frame) => frame.change != null);
  const moving = pairs.filter((frame) => frame.change > LOOK.movingChange).map((frame) => frame.sharpness);
  const held = pairs.filter((frame) => frame.change < LOOK.stillChange).map((frame) => frame.sharpness);
  const changes = pairs.map((frame) => frame.change).sort((a, b) => a - b);
  const burst = changes.filter((value) => value > LOOK.burstChange);
  const heldMedian = held.length >= LOOK.minimumFrames ? median(held) : frames.length ? median(frames.map((frame) => frame.sharpness)) : NaN;
  const sharpBase = Number.isFinite(heldMedian) && heldMedian > 0;
  return {
    frames: frames.length,
    moving_frames: moving.length,
    held_frames: held.length,
    held_sharpness: sharpBase ? round(heldMedian, 2) : null,
    moving_sharpness_ratio: sharpBase && moving.length >= LOOK.minimumFrames ? round(median(moving) / heldMedian, 4) : null,
    soft_frame_share: sharpBase ? round(frames.filter((frame) => frame.sharpness < LOOK.softSharpness * heldMedian).length / frames.length, 4) : null,
    change_p99: changes.length ? round(quantile(changes, 0.99), 3) : null,
    max_change: changes.length ? round(changes.at(-1), 3) : null,
    top_light_ratio: frames.length ? round(median(frames.map((frame) => frame.top / Math.max(frame.middle, 1))), 4) : null,
    midtone_share: frames.length ? round(frames.reduce((sum, frame) => sum + frame.midtone, 0) / frames.length, 4) : null,
    burst_change_mean: burst.length ? round(burst.reduce((sum, value) => sum + value, 0) / burst.length, 3) : null,
    thresholds: { moving_change: LOOK.movingChange, still_change: LOOK.stillChange, burst_change: LOOK.burstChange, soft_sharpness: LOOK.softSharpness, midtone: [...LOOK.midtone] }
  };
}

/** Variance of the 4-neighbour Laplacian over a grey frame's interior pixels. */
export function laplacianVariance(frame, width, height) {
  let sum = 0, sumSquares = 0, n = 0;
  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width;
    for (let x = 1; x < width - 1; x += 1) {
      const i = row + x;
      const value = frame[i - width] + frame[i + width] + frame[i - 1] + frame[i + 1] - 4 * frame[i];
      sum += value;
      sumSquares += value * value;
      n += 1;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return Math.max(0, sumSquares / n - mean * mean);
}

/**
 * Run a command whose stdout is raw frames of frameSize bytes and hand each
 * whole frame to onFrame as it arrives (a 1080p render's look pass would
 * otherwise buffer hundreds of MB).
 */
export function streamRawFrames(command, args, frameSize, onFrame) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let pending = Buffer.alloc(0);
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      let offset = 0;
      for (; offset + frameSize <= pending.length; offset += frameSize) onFrame(pending.subarray(offset, offset + frameSize));
      pending = offset ? Buffer.from(pending.subarray(offset)) : pending;
    });
    child.stderr.on("data", (chunk) => { if (stderr.length < 4000) stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}: ${stderr.trim().split("\n")[0] ?? ""}`))));
  });
}

function median(values) {
  return quantile([...values].sort((a, b) => a - b), 0.5);
}

function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const position = (sorted.length - 1) * q;
  const lo = Math.floor(position), hi = Math.ceil(position);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (position - lo);
}

function round(value, places = 4) {
  const factor = 10 ** places;
  return Math.round(Number(value) * factor) / factor;
}
