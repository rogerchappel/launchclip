// The one SFX type classifier (docs/IMMERSIVE_SOUND_RFC.md §3,
// docs/PLAN_AND_PACE_RFC.md §4.3): the 120 ms after a transient's onset gives
// a decay, a high-frequency share, a centroid and a tonality, and the rules
// below give one of six types, each a row of our effect families. Used to
// test that our families land in their rows, to sort sounds we did not make,
// and (through analyzeRhythm in src/render_audio_analysis.js) to type the
// SFX of reference videos.
//
// Ported from rea-video's sfx_type (rea_video/audio.py), Copyright 2026
// JuneYaooo, licensed under the Apache License, Version 2.0
// (http://www.apache.org/licenses/LICENSE-2.0; THIRD_PARTY_NOTICES.md). Changes: JavaScript, our radix-2 FFT
// (src/scripts/audio-features.mjs), thresholds recalibrated on our kit (see
// SFX_TYPE_RULES), the families each type maps to, and the typing run taking
// events rather than a file.
import { RATE, decode, fft } from "../scripts/audio-features.mjs";

export const SFX_TYPES = Object.freeze(["whoosh", "ding", "impact", "click", "pop", "hit", "typing"]);

// rea-video's thresholds were set on library SFX; ours are band limited (most
// families keep < 5% of their energy above 4 kHz), so the brightness tests
// also accept a centroid and whoosh also accepts "noisy and sustained" (low
// tonality). Calibrated on the default kit (render_audio_rhythm.test.js).
export const SFX_TYPE_RULES = Object.freeze({
  whooshDecay: 0.25, whooshHf: 0.25, // rea-video: long and airy
  whooshNoisyDecay: 0.18, whooshNoisyTonality: 15, // ours: long and noisy, not ringing
  clickDecay: 0.08, clickHf: 0.3, clickCentroid: 550, // short, and bright or above the low mids
  dingTonality: 25, dingCentroid: 1000, // a ringing partial above 1 kHz (rea-video: 1,200 Hz)
  impactCentroid: 350, // energy sits in the lows
  popHf: 0.2, popTonality: 15
});

/** The type of one SFX from its decay, high-frequency share, centroid and tonality. */
export function sfxType({ decay_seconds: decay, hf, centroid_hz: centroid, tonality }) {
  const T = SFX_TYPE_RULES;
  if (decay < T.clickDecay && (hf > T.clickHf || centroid > T.clickCentroid)) return "click";
  if ((decay > T.whooshDecay && hf > T.whooshHf) || (decay > T.whooshNoisyDecay && tonality < T.whooshNoisyTonality && centroid >= T.impactCentroid)) return "whoosh";
  if (tonality > T.dingTonality && centroid > T.dingCentroid) return "ding";
  if (centroid < T.impactCentroid) return "impact";
  if (hf > T.popHf || tonality > T.popTonality) return "pop";
  return "hit";
}

/** family → the type it should measure as; null: no single type (a riser has no attack, a tally is a run of blips). */
export const FAMILY_TYPE = Object.freeze({
  whoosh: "whoosh", swipe: "whoosh", slide: "whoosh", "page-turn": "whoosh",
  impact: "impact", thud: "impact", subdrop: "impact", door: "impact", footstep: "impact",
  ding: "ding", chime: "ding", ping: "ding", notification: "ding", success: "ding", cash: "ding", shimmer: "ding", sparkle: "ding",
  click: "click", tick: "click", keystroke: "click", "keystroke-space": "click", "keystroke-enter": "click", snap: "click", "camera-shutter": "click",
  pop: "pop", boing: "pop",
  riser: null, tally: null, "tape-stop": null, glitch: null, "error-buzz": null, "pen-scribble": null
});

/** type → our families (FAMILY_TYPE by row; typing is a run of clicks, not a family). */
export const TYPE_FAMILIES = Object.freeze(Object.fromEntries(SFX_TYPES.filter((type) => type !== "typing").map((type) => [type, Object.freeze(Object.keys(FAMILY_TYPE).filter((family) => FAMILY_TYPE[family] === type))])));

/**
 * The measures of the transient at frame f of magnitude spectra (bins up to
 * Nyquist or a cap), with db the frame levels (dB of summed power):
 * {decay_seconds, hf, centroid_hz, tonality} over the next `window` seconds.
 * Decay runs from the loudest frame in that window to `decayDb` below it.
 */
export function sfxFeatures(spectra, db, f, { binHz, hopSeconds, window = 0.12, decayDb = 15 }) {
  const frames = spectra.length, typeFrames = Math.max(1, Math.round(window / hopSeconds));
  const peakDb = Math.max(...db.slice(f, f + typeFrames));
  const sum = new Float64Array(spectra[0].length);
  for (let g = f; g < Math.min(frames, f + typeFrames); g += 1) for (let k = 0; k < sum.length; k += 1) sum[k] += spectra[g][k] ** 2;
  let total = 0, high = 0, moment = 0, max = 0, amplitude = 0;
  for (let k = 1; k < sum.length; k += 1) {
    total += sum[k]; moment += sum[k] * k * binHz; if (k * binHz >= 4000) high += sum[k];
    max = Math.max(max, Math.sqrt(sum[k])); amplitude += Math.sqrt(sum[k]);
  }
  let end = f + db.slice(f, f + typeFrames).indexOf(peakDb);
  while (end < frames && db[end] > peakDb - decayDb) end += 1;
  return {
    decay_seconds: round((end - f) * hopSeconds),
    hf: round(total ? high / total : 0),
    centroid_hz: Math.round(total ? moment / total : 0),
    tonality: round(amplitude ? max / (amplitude / (sum.length - 1)) : 0, 1)
  };
}

function round(value, places = 3) { const factor = 10 ** places; return Math.round(Number(value) * factor) / factor; }

// At 48 kHz a 2048-point frame with a 512 hop gives near the bin width and
// hop of the reference scan (22.05 kHz, 1024/256), and the bins stop at its
// Nyquist (11 025 Hz) so both read the same band.
const N = 2048, HOP = 512, TOP_HZ = 11025;

/** Magnitude STFT frames of mono floats up to TOP_HZ (Hann window, zero-padded when short). */
function stft(samples, bins) {
  const window = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  const frames = [];
  for (let start = 0; start === 0 || start + N <= samples.length; start += HOP) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i += 1) re[i] = (samples[start + i] ?? 0) * window[i];
    fft(re, im);
    frames.push(Float64Array.from({ length: bins }, (_, k) => Math.hypot(re[k], im[k])));
  }
  return frames;
}

/**
 * {type, measures} for one isolated sound (mono floats at `rate`); null for
 * silence. The onset is the steepest rise in log spectral sum.
 * shortcut: the onset is the steepest rise of the whole spectrum, not of the
 * percussive part (fine for one isolated sound); mixes go through analyzeRhythm.
 */
export function classifySfx(samples, rate = RATE) {
  const bin = rate / N, S = stft(samples, Math.min(N / 2, Math.floor(TOP_HZ / bin)) + 1);
  const sums = S.map((frame) => frame.reduce((sum, value) => sum + value, 0));
  if (!sums.some((sum) => sum > 0)) return null;
  let c = 0, steepest = -Infinity;
  sums.forEach((sum, f) => { const rise = Math.log1p(sum) - (f ? Math.log1p(sums[f - 1]) : 0); if (rise > steepest) { steepest = rise; c = f; } });
  const db = S.map((frame) => 10 * Math.log10(frame.reduce((sum, value) => sum + value * value, 0) + 1e-12));
  const measures = sfxFeatures(S, db, c, { binHz: bin, hopSeconds: HOP / rate });
  return { type: sfxType(measures), measures };
}

/** Classify an audio file (decoded by FFmpeg, first `seconds`). */
export async function classifySfxFile(file, { seconds = 4 } = {}) {
  const { left, right } = await decode(file, seconds);
  const mono = new Float32Array(left.length);
  for (let i = 0; i < mono.length; i += 1) mono[i] = (left[i] + right[i]) / 2;
  return classifySfx(mono);
}

/**
 * Events [{time, type}] sorted by time, with every run of four or more
 * click/pop/hit events inside 0.6 s relabelled typing.
 */
export function typingRuns(events, { count = 4, within = 0.6 } = {}) {
  const out = events.map((event) => ({ ...event }));
  const small = out.filter((event) => ["click", "pop", "hit", "typing"].includes(event.type));
  for (let i = 0; i + count - 1 < small.length; i += 1) {
    if (small[i + count - 1].time - small[i].time <= within) for (let j = i; j < i + count; j += 1) small[j].type = "typing";
  }
  return out;
}
