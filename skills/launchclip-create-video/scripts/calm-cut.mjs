// Calm-moment cut scoring (docs/PLAN_AND_PACE_RFC.md §4.4), ported from
// rea-video's drive.py `cut_points` (Apache-2.0). Frame-pure: the motion
// curve is read by src/motion_curve.js (ffmpeg) or built by a test.
//
// A curve is {fps, values}: values[i] is the motion energy at i / fps, the
// mean absolute grey change from the previous sample, 3-tap smoothed. A null
// value is unknown (no footage there).

export const CALM_CUT = Object.freeze({
  fps: 12, // the curve's sample rate: fine enough for a cut, cheap on an hour of footage
  shortSide: 160, // grey frame width the energy is read at
  search: 0.3, // search ±30% of the segment length around the wanted cut
  beatWeight: 0.4, // being off the beat costs up to 0.4 (a full beat away)
  targetWeight: 0.3, // drifting from the wanted time costs 0.3 per segment length
  seam: 0.1, // an existing source cut is a free seam: it starts at 0.1
  beatTag: 0.25, // within a quarter beat of one, a cut is tagged `beat`
  midMotion: 1.2, // a planned cut scoring above this cuts mid-move and off the beat
});

/** 3-tap moving average; null samples stay null and are skipped by neighbours. */
export function smoothCurve(values) {
  return values.map((value, i) => {
    if (value == null) return null;
    const near = [values[i - 1], value, values[i + 1]].filter((entry) => entry != null);
    return near.reduce((sum, entry) => sum + entry, 0) / near.length;
  });
}

/**
 * Motion energy of grey frames (w × h bytes each), one frame at a time: the
 * mean absolute change from the previous frame with `mask` boxes ({x, y, w, h}
 * in 0–1 of the frame: overlay captions or a logo) left out, smoothed at the end.
 * → {push(frame), result() → {fps, values}}
 */
export function energyAccumulator(width, height, { fps = CALM_CUT.fps, mask = [] } = {}) {
  const size = width * height;
  const keep = new Uint8Array(size).fill(1);
  for (const box of mask) {
    const x0 = Math.max(0, Math.floor(box.x * width)), x1 = Math.min(width, Math.ceil((box.x + box.w) * width));
    const y0 = Math.max(0, Math.floor(box.y * height)), y1 = Math.min(height, Math.ceil((box.y + box.h) * height));
    for (let y = y0; y < y1; y += 1) keep.fill(0, y * width + x0, y * width + x1);
  }
  const kept = keep.reduce((sum, entry) => sum + entry, 0) || 1;
  const values = [];
  let previous = null;
  return {
    push(frame) {
      let sum = 0;
      if (previous) for (let k = 0; k < size; k += 1) if (keep[k]) sum += Math.abs(frame[k] - previous[k]);
      values.push(previous ? sum / kept : 0);
      previous = Uint8Array.from(frame.subarray(0, size));
    },
    result: () => ({ fps, values: smoothCurve(values) }),
  };
}

/** energyAccumulator over a buffer of whole frames. */
export function motionEnergy(raw, width, height, options = {}) {
  const energy = energyAccumulator(width, height, options);
  const size = width * height;
  for (let offset = 0; offset + size <= raw.length; offset += size) energy.push(raw.subarray(offset, offset + size));
  return energy.result();
}

/** The curve's value at t (linear between samples); null when unknown. */
export function energyAt(curve, t) {
  const x = t * curve.fps;
  const i = Math.floor(x);
  const a = curve.values[i], b = curve.values[i + 1];
  if (a == null) return b == null || x - i < 0.5 ? null : b;
  if (b == null) return a;
  return a + (b - a) * (x - i);
}

/** The curve's 90th percentile (the RFC's motion scale). */
export function curveP90(curve) {
  const known = curve.values.filter((value) => value != null).sort((a, b) => a - b);
  return known.length ? known[Math.min(known.length - 1, Math.floor(0.9 * known.length))] : 0;
}

/** Median gap between beats, or null. */
export function beatPeriod(beats = []) {
  const gaps = beats.slice(1).map((beat, i) => beat - beats[i]).filter((gap) => gap > 0).sort((a, b) => a - b);
  return gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
}

function beatOffset(t, beats, period) {
  if (!beats?.length || !period) return null;
  let best = Infinity;
  for (const beat of beats) best = Math.min(best, Math.abs(beat - t));
  return Math.min(1, best / period);
}

/**
 * The motion and beat score of a cut at t (lower is calmer); the target term
 * is left out. A planned cut above CALM_CUT.midMotion warns `cut-mid-motion`.
 * → {score, motion, beat} or null when the curve is unknown at t.
 */
export function cutMotionScore(curve, t, { beats = null, p90 = curveP90(curve), period = beatPeriod(beats ?? []) } = {}) {
  const e = energyAt(curve, t);
  if (e == null) return null;
  const motion = p90 > 0 ? e / p90 : 0;
  const beat = beatOffset(t, beats, period);
  return { score: motion + CALM_CUT.beatWeight * (beat ?? 0), motion, beat };
}

/**
 * The calmest place for a wanted cut. target: the wanted time; step: the
 * segment length (scales the target term and the search); span: the search
 * half-width (default 30% of step); min/max: hard bounds (the segment's);
 * beats: beat times; cuts: existing source cuts (free seams).
 * → {at, score, tag: 'cut'|'beat'|'calm', moved} or null when nothing in
 * range is known.
 */
export function calmCut(curve, { target, step, span = CALM_CUT.search * step, min = -Infinity, max = Infinity, beats = null, cuts = [] } = {}) {
  if (!(step > 0)) throw new Error('calmCut needs a positive step (the segment length)');
  const lo = Math.max(min, target - span), hi = Math.min(max, target + span);
  if (hi < lo) return null;
  const p90 = curveP90(curve);
  const period = beatPeriod(beats ?? []);
  const drift = (t) => CALM_CUT.targetWeight * Math.abs(t - target) / step;
  let best = null;
  const offer = (at, score, tag) => { if (!best || score < best.score - 1e-9) best = { at, score, tag }; };
  for (const cut of cuts) if (cut >= lo && cut <= hi) offer(cut, CALM_CUT.seam + drift(cut), 'cut');
  // Every curve sample in range, plus the beats there (so a cut can sit on one exactly).
  const times = [];
  for (let i = Math.ceil(lo * curve.fps - 1e-9); i / curve.fps <= hi + 1e-9; i += 1) times.push(i / curve.fps);
  for (const beat of beats ?? []) if (beat >= lo && beat <= hi) times.push(beat);
  for (const t of times) {
    const scored = cutMotionScore(curve, t, { beats, p90, period });
    if (!scored) continue;
    offer(t, scored.score + drift(t), scored.beat != null && scored.beat < CALM_CUT.beatTag ? 'beat' : 'calm');
  }
  if (!best) return null;
  return { at: Math.round(best.at * 1000) / 1000, score: Math.round(best.score * 1000) / 1000, tag: best.tag, moved: Math.round((best.at - target) * 1000) / 1000 };
}
