// Real motion blur from sub-frames (story.motion.blur), the plan shared by
// the HyperFrames compiler (where caption changes go) and the render's blend
// (src/motion_blur.js). Plain ESM, no imports. Canonical copy:
// kit/core/motion-blur.mjs. Contract: docs/KIT_CONTRACTS.md, "Motion blur".
//
//   motion.blur = true | {samples?: 2–6, shutter?: 0.25–1.5}
//
// The page is rendered at `rate` sub-frames per output frame (rate × fps),
// and each output frame is the mean of `samples` consecutive sub-frames
// centred on it. A sub-frame stands for 1/rate of a frame, so the blend
// spans samples / rate frames: the shutter. rate = round(samples / shutter),
// so the shutter asked for is met as closely as whole sub-frames allow; a
// shutter over one frame makes neighbouring frames share sub-frames
// (overlapping windows), a heavy smear at no extra render cost.
//
// Render cost: the browser renders `rate` times the frames (the blend itself
// is cheap): true = {samples 3, shutter 1} renders 3×; {samples 6, shutter
// 1.5} renders 4×; {samples 4, shutter 1.33} renders 3×; never over maxRate.
//
// Captions: a word change blended across two sub-frames would show two
// words. Caption changes are snapped into the gap between two output
// frames' one-frame windows (rate sub-frames each, captionSnapOffset), so a
// blend of at most one frame never straddles one. With a shutter over one
// frame every instant is inside two windows, so the frames whose window
// straddles a change (guardFrames) take the caption band from the one-frame
// blend instead of the heavy one.

/** The compiler's sidecar in a HyperFrames project: {guard: {frames, rect}}. */
export const MOTION_BLUR_GUARD_FILE = 'launchclip-motion-blur.json';

export const MOTION_BLUR = Object.freeze({
  samples: Object.freeze([2, 3, 4, 5, 6]),
  shutter: Object.freeze([0.25, 1.5]),
  defaults: Object.freeze({ samples: 3, shutter: 1 }),
  // The share of the frame height kept around the caption band when only the
  // band is guarded (the blend fades between the two over it).
  guardPad: 0.04,
  // The most sub-frames rendered per frame (a short shutter with many
  // samples is clamped here: the shutter grows instead of the cost).
  maxRate: 8
});

const round = (value, digits = 4) => { const f = 10 ** digits; return Math.round(value * f) / f + 0; };

/**
 * The blur plan of a story, or null (off). → {samples, rate, shutter (the
 * effective one, samples / rate), centre (the sub-frame offset of a window's
 * last sample from its frame), overlap (shutter over one frame), cost (rate)}
 */
export function resolveMotionBlur(story) {
  const blur = story?.motion?.blur;
  if (blur !== true && !(blur && typeof blur === 'object' && !Array.isArray(blur))) return null;
  const own = blur === true ? {} : blur;
  const samples = MOTION_BLUR.samples.includes(own.samples) ? own.samples : MOTION_BLUR.defaults.samples;
  const [lo, hi] = MOTION_BLUR.shutter;
  const shutter = typeof own.shutter === 'number' && Number.isFinite(own.shutter) ? Math.min(hi, Math.max(lo, own.shutter)) : MOTION_BLUR.defaults.shutter;
  // At least samples / 1.5 sub-frames per frame, so a window never reaches
  // past the next frame's centre; at most maxRate.
  const rate = Math.min(MOTION_BLUR.maxRate, Math.max(Math.ceil(samples / hi - 1e-9), Math.round(samples / shutter), 1));
  return { samples, rate, shutter: round(samples / rate), centre: Math.floor(samples / 2), overlap: samples > rate, cost: rate };
}

/**
 * Sub-frame offsets (from the output frame's own sub-frame) a window of
 * `samples` covers: [first, last]. The blend's tmix ends on `centre`.
 */
export function windowOffsets(samples) {
  const last = Math.floor(samples / 2);
  return [last - samples + 1, last];
}

/**
 * Where a caption change goes within a frame (a share of a frame after the
 * frame's time): half a sub-frame after the last sub-frame of the one-frame
 * window (rate samples), so it falls between two frames' windows. 0.5 at
 * rate 3 (half frames), 0.75 at rate 2, 0.625 at rate 4.
 */
export function captionSnapOffset(plan) {
  const rate = plan?.rate ?? MOTION_BLUR.defaults.samples;
  return round((windowOffsets(rate)[1] + 0.5) / rate, 6);
}

/**
 * Output frames whose heavy window (overlap only) straddles a caption change
 * (seconds): those take the caption band from the one-frame blend. → sorted
 * frame numbers.
 */
export function guardFrames(plan, changes, fps) {
  if (!plan?.overlap) return [];
  const [first, last] = windowOffsets(plan.samples);
  const frames = new Set();
  for (const time of changes) {
    if (!Number.isFinite(time)) continue;
    const sub = time * fps * plan.rate;
    // Frame n's window holds sub-frames n·rate + first … n·rate + last; it
    // straddles the change when some lie before it and some at or after it.
    const lo = Math.floor((sub - last) / plan.rate) - 1, hi = Math.ceil((sub - first) / plan.rate) + 1;
    for (let n = Math.max(0, lo); n <= hi; n += 1) {
      const a = n * plan.rate + first, b = n * plan.rate + last;
      if (a < sub - 1e-6 && b >= sub - 1e-6) frames.add(n);
    }
  }
  return [...frames].sort((a, b) => a - b);
}

/**
 * The rect (px) a guarded frame takes from the one-frame blend: the caption
 * band (captionPlan options: bandTop, band.left/right/height, shares of the
 * frame) padded by guardPad of the height, full width; the whole frame when
 * the band is unknown or captions are placed in zones.
 */
export function guardRect(options, { width, height }, zoned = false) {
  const band = options?.band;
  if (zoned || !band || !Number.isFinite(options.bandTop) || !Number.isFinite(band.height)) return { x: 0, y: 0, width, height };
  const even = (value) => 2 * Math.round(value / 2);
  const top = even(Math.max(0, (options.bandTop - MOTION_BLUR.guardPad) * height));
  const bottom = even(Math.min(height, (options.bandTop + band.height + MOTION_BLUR.guardPad) * height));
  return { x: 0, y: top, width, height: bottom - top };
}
