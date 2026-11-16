// Coarse SFX type classifier (docs/IMMERSIVE_SOUND_RFC.md §3): the first
// 120 ms of a transient's spectrum and its decay to −15 dB give one of six
// types, each a row of our effect families. Three uses: a test that every
// family × palette × variant lands in its row, sorting sounds we did not make
// into families, and measuring reference videos.
//
// Ported from rea-video's sfx_type (rea_video/audio.py), Apache-2.0,
// Copyright 2026 JuneYaooo. Changes: JavaScript, our radix-2 FFT
// (src/scripts/audio-features.mjs) at 48 kHz with the source's bin width,
// onset and band, the families each type maps to, and the typing run taking
// events rather than a file.
import { RATE, decode, fft } from "../scripts/audio-features.mjs";

export const SFX_TYPES = Object.freeze(["whoosh", "ding", "impact", "click", "pop", "hit", "typing"]);

/** type → our families. A family sits in exactly one row; typing is a run of clicks, not a family. */
export const TYPE_FAMILIES = Object.freeze({
  whoosh: Object.freeze(["whoosh", "swipe", "slide", "riser"]),
  ding: Object.freeze(["ding", "chime", "ping", "notification", "success", "sparkle", "cash", "shimmer", "tally"]),
  impact: Object.freeze(["impact", "thud", "subdrop", "door", "footstep"]),
  click: Object.freeze(["click", "tick", "keystroke", "keystroke-space", "keystroke-enter", "camera-shutter"]),
  pop: Object.freeze(["pop", "snap", "boing", "glitch"]),
  hit: Object.freeze(["page-turn", "pen-scribble", "tape-stop", "error-buzz"])
});

/** family → its type (the row TYPE_FAMILIES puts it in). */
export const FAMILY_TYPE = Object.freeze(Object.fromEntries(Object.entries(TYPE_FAMILIES).flatMap(([type, families]) => families.map((family) => [family, type]))));

const WINDOW = 0.12;
// The source works at 22.05 kHz with a 1024-point STFT; at 48 kHz a 2048-point
// frame with a 512 hop gives near the same bin width and hop, and the bins
// stop at the source's Nyquist (11 025 Hz).
const N = 2048, HOP = 512, TOP_HZ = 11025, SPLIT_HZ = 4000;

/** Magnitude STFT frames of mono floats (Hann window, zero-padded when short). */
function stft(samples) {
  const window = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  const frames = [];
  for (let start = 0; start === 0 || start + N <= samples.length; start += HOP) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i += 1) re[i] = (samples[start + i] ?? 0) * window[i];
    fft(re, im);
    frames.push(Float64Array.from({ length: N / 2 + 1 }, (_, k) => Math.hypot(re[k], im[k])));
  }
  return frames;
}

/**
 * The classifier's measures of one sound (mono floats at `rate`), from its
 * onset frame (the steepest rise in log spectral sum): over the next 120 ms'
 * mean magnitude spectrum, the centroid (Hz), the share above 4 kHz and the
 * peak/mean; and the seconds until the frame level falls 15 dB below the
 * onset frame's (capped at 1.5 s).
 * shortcut: the onset is the steepest rise of the whole spectrum, not of the
 * percussive part (fine for one isolated sound); a reference-video scan needs
 * the HPSS onset curve of src/scripts/audio-features.mjs.
 */
export function sfxMeasures(samples, rate = RATE) {
  const S = stft(samples);
  const bin = rate / N, bins = Math.floor(TOP_HZ / bin) + 1;
  const sums = S.map((frame) => { let sum = 0; for (let k = 0; k < bins; k += 1) sum += frame[k]; return sum; });
  if (!sums.some((sum) => sum > 0)) return null;
  let c = 0, steepest = -Infinity;
  sums.forEach((sum, f) => { const rise = Math.log1p(sum) - (f ? Math.log1p(sums[f - 1]) : 0); if (rise > steepest) { steepest = rise; c = f; } });
  const hop = HOP / rate, span = Math.max(1, Math.floor(WINDOW / hop));
  const spec = new Float64Array(bins);
  const last = Math.min(S.length, c + span);
  for (let f = c; f < last; f += 1) for (let k = 0; k < bins; k += 1) spec[k] += S[f][k] / (last - c);
  let total = 1e-9, high = 0, weighted = 0, top = 0;
  for (let k = 0; k < bins; k += 1) {
    total += spec[k]; weighted += spec[k] * k * bin; top = Math.max(top, spec[k]);
    if (k * bin > SPLIT_HZ) high += spec[k];
  }
  const db = S.map((frame) => { let power = 0; for (let k = 0; k < bins; k += 1) power += frame[k] * frame[k]; return 10 * Math.log10(power / bins + 1e-12); });
  let j = c;
  while (j < db.length - 1 && db[j] > db[c] - 15 && (j - c) * hop < 1.5) j += 1;
  return { centroid: weighted / total, high: high / total, peakMean: top / (total / bins + 1e-9), decay: (j - c) * hop };
}

/** The rules, in order (the RFC's table). */
export function sfxTypeOf({ centroid, high, peakMean, decay }) {
  if (decay > 0.25 && high > 0.25) return "whoosh";
  if (peakMean > 25 && centroid > 1200) return "ding";
  if (centroid < 350) return "impact";
  if (decay < 0.06 && high > 0.3) return "click";
  if (high > 0.2 || peakMean > 15) return "pop";
  return "hit";
}

/** {type, measures} for mono floats; null for silence. */
export function classifySfx(samples, rate = RATE) {
  const measures = sfxMeasures(samples, rate);
  return measures ? { type: sfxTypeOf(measures), measures } : null;
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
