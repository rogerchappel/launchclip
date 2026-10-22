// Beat analysis: tempo, beat grid and downbeats of a music track, written as
// BEATS.json (launchclip.beats.v1, the format synth-audio-kit.mjs writes and
// kit/core/story.mjs reads for "beat:n" / "downbeat:n" anchors).
//
// Method (no dependencies): decode to 22.05 kHz mono with FFmpeg; a log
// spectral-flux onset envelope (5.8 ms hop); tempo from the envelope's
// autocorrelation with a harmonic comb and a log-tempo prior (centred on the
// requested BPM when one is known, which settles octave errors); then a fine
// period/phase search that fits one constant-tempo grid to the whole track,
// and a small local refinement of each beat towards its onset. Downbeats
// (4/4) are the beat phase with the most low-frequency attack and the largest
// spectral change across the beat (chord changes land on bar lines).
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const BEATS_SCHEMA = "launchclip.beats.v1";
export const ANALYSIS_RATE = 22050;
const WINDOW = 512;
const HOP = 128;
const MIN_BPM = 55;
const MAX_BPM = 200;
// With the frame time at the window centre, a spectral-flux peak lands about
// 4 ms before the attack; measured on synthetic clicks (see beats.test.js).
const ONSET_DELAY = 0.0038;

/** Decode any audio file to mono float samples at `rate` with FFmpeg. */
export async function decodeAudio(file, { rate = ANALYSIS_RATE, ffmpeg = "ffmpeg" } = {}) {
  const { stdout } = await execFileAsync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", file, "-ac", "1", "-ar", String(rate), "-f", "f32le", "-"], { encoding: "buffer", maxBuffer: 1 << 29 });
  const buffer = Buffer.from(stdout);
  const samples = new Float32Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.length / 4));
  return { samples: Float32Array.from(samples), sampleRate: rate };
}

/** Analyse a file: decode, then analyzeSamples(). */
export async function analyzeBeatsFile(file, options = {}) {
  const { samples, sampleRate } = await decodeAudio(file, options);
  return analyzeSamples(samples, sampleRate, options);
}

/**
 * Tempo and beat grid of mono samples.
 * options: {bpmHint (expected BPM: centres the tempo prior), beatsPerBar (4)}
 * → {bpm, beat_seconds, beats, downbeats, downbeat_phase, first_beat, confidence, duration, method}
 */
export function analyzeSamples(samples, sampleRate, { bpmHint = null, beatsPerBar = 4 } = {}) {
  const duration = samples.length / sampleRate;
  if (duration < 2) throw new Error(`beat analysis needs at least 2 s of audio; got ${duration.toFixed(2)} s`);
  const { env, low, lowMid, spectra, frameRate, frameOffset } = onsetEnvelope(samples, sampleRate);
  const smooth = gaussianSmooth(env, Math.max(1, Math.round(0.008 * frameRate)));
  const coarse = estimateTempo(smooth, frameRate, bpmHint);
  const grid = onBeatNotOffbeat(fitGrid(smooth, frameRate, frameOffset, coarse.period, duration), gaussianSmooth(lowMid, Math.max(1, Math.round(0.008 * frameRate))), frameRate, frameOffset, duration);
  const beats = refineBeats(grid.beats, smooth, frameRate, frameOffset);
  const { phase, scores } = chooseDownbeatPhase(beats, grid.period, { low, spectra, frameRate, frameOffset, beatsPerBar });
  const bpm = 60 / grid.period;
  return {
    bpm: round2(bpm),
    beat_seconds: round5(grid.period),
    beats: beats.map(round3),
    downbeats: beats.filter((_, index) => index % beatsPerBar === phase).map(round3),
    downbeat_phase: phase,
    downbeat_scores: scores.map(round3),
    first_beat: round3(beats[0] ?? 0),
    confidence: round3(grid.confidence),
    duration: round3(duration),
    method: "spectral-flux onset envelope + autocorrelation comb + global grid fit"
  };
}

/** BEATS.json (launchclip.beats.v1) for an analysis, with the source and any alignment. */
export function beatsDocument(analysis, extra = {}) {
  return {
    schema_version: BEATS_SCHEMA,
    bpm: analysis.bpm,
    beat_seconds: analysis.beat_seconds,
    beats: analysis.beats,
    downbeats: analysis.downbeats,
    ...extra
  };
}

/** The exact grid of a constant-tempo bed: beats every 60/bpm s from `start`. */
export function gridFromBpm(bpm, duration, { start = 0, beatsPerBar = 4 } = {}) {
  const period = 60 / bpm;
  const beats = [];
  for (let t = start; t < duration - 1e-9; t += period) beats.push(round3(t));
  return { bpm, beat_seconds: round5(period), beats, downbeats: beats.filter((_, index) => index % beatsPerBar === 0) };
}

/**
 * Map a music-time grid into story time after the track is trimmed by
 * `offset` seconds and sped up by `tempo` (atempo): t_story = (t - offset) / tempo.
 * Beats outside [0, duration] are dropped; downbeats stay downbeats.
 */
export function transformGrid(grid, { offset = 0, tempo = 1, duration = Infinity } = {}) {
  const map = (t) => (t - offset) / tempo;
  const keep = (t) => t >= -1e-6 && t <= duration + 1e-6;
  const beats = (grid.beats ?? []).map(map).filter(keep).map((t) => round3(Math.max(0, t)));
  const downbeats = (grid.downbeats ?? []).map(map).filter(keep).map((t) => round3(Math.max(0, t)));
  const bpm = Number(grid.bpm) * tempo;
  return { ...grid, bpm: round2(bpm), beat_seconds: round5(60 / bpm), beats, downbeats };
}

// ---------------------------------------------------------------------------
// Onset envelope

function onsetEnvelope(samples, sampleRate) {
  const window = new Float64Array(WINDOW);
  for (let i = 0; i < WINDOW; i += 1) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WINDOW);
  const bins = WINDOW / 2;
  const lowBin = Math.max(2, Math.round((200 / sampleRate) * WINDOW));
  const lowMidBin = Math.round((1500 / sampleRate) * WINDOW);
  const frames = Math.max(0, Math.floor((samples.length - WINDOW) / HOP) + 1);
  const env = new Float64Array(frames);
  const low = new Float64Array(frames);
  const lowMid = new Float64Array(frames);
  // A coarse log spectrum per frame (32 bands) for downbeat change detection.
  const bandCount = 32;
  const spectra = new Array(frames);
  const re = new Float64Array(WINDOW);
  const im = new Float64Array(WINDOW);
  let previous = new Float64Array(bins);
  for (let f = 0; f < frames; f += 1) {
    const offset = f * HOP;
    for (let i = 0; i < WINDOW; i += 1) { re[i] = samples[offset + i] * window[i]; im[i] = 0; }
    fft(re, im);
    const current = new Float64Array(bins);
    let flux = 0;
    let lowFlux = 0;
    let lowMidFlux = 0;
    const bands = new Float32Array(bandCount);
    for (let k = 1; k < bins; k += 1) {
      const magnitude = Math.log1p(1000 * Math.hypot(re[k], im[k]));
      current[k] = magnitude;
      const rise = magnitude - previous[k];
      if (rise > 0) { flux += rise; if (k <= lowBin) lowFlux += rise; if (k <= lowMidBin) lowMidFlux += rise; }
      bands[Math.min(bandCount - 1, Math.floor((Math.log2(k) / Math.log2(bins)) * bandCount))] += magnitude;
    }
    env[f] = flux;
    low[f] = lowFlux;
    lowMid[f] = lowMidFlux;
    spectra[f] = bands;
    previous = current;
  }
  const frameRate = sampleRate / HOP;
  return { env: normalizeEnvelope(env, frameRate), low: normalizeEnvelope(low, frameRate), lowMid: normalizeEnvelope(lowMid, frameRate), spectra, frameRate, frameOffset: WINDOW / 2 / sampleRate + ONSET_DELAY };
}

// Remove the slow trend (0.4 s moving mean), half-wave rectify, scale to unit mean.
function normalizeEnvelope(env, frameRate) {
  const half = Math.max(1, Math.round(0.2 * frameRate));
  const out = new Float64Array(env.length);
  let sum = 0;
  let count = 0;
  let lo = 0;
  let hi = -1;
  for (let i = 0; i < env.length; i += 1) {
    while (hi < Math.min(env.length - 1, i + half)) { hi += 1; sum += env[hi]; count += 1; }
    while (lo < i - half) { sum -= env[lo]; lo += 1; count -= 1; }
    out[i] = Math.max(0, env[i] - sum / count);
  }
  let mean = 0;
  for (const value of out) mean += value;
  mean /= out.length || 1;
  if (mean > 0) for (let i = 0; i < out.length; i += 1) out[i] /= mean;
  return out;
}

function gaussianSmooth(values, sigma) {
  const radius = Math.ceil(sigma * 3);
  const kernel = [];
  let total = 0;
  for (let i = -radius; i <= radius; i += 1) { const w = Math.exp(-0.5 * (i / sigma) ** 2); kernel.push(w); total += w; }
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    let acc = 0;
    for (let j = -radius; j <= radius; j += 1) {
      const index = i + j;
      if (index >= 0 && index < values.length) acc += values[index] * kernel[j + radius];
    }
    out[i] = acc / total;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tempo

function estimateTempo(env, frameRate, bpmHint) {
  const minLag = Math.floor((60 / MAX_BPM) * frameRate);
  const maxLag = Math.ceil((60 / MIN_BPM) * frameRate);
  const n = env.length;
  const ac = new Float64Array(maxLag * 4 + 2);
  for (let lag = 1; lag < ac.length && lag < n; lag += 1) {
    let acc = 0;
    for (let i = 0; i + lag < n; i += 1) acc += env[i] * env[i + lag];
    ac[lag] = acc / (n - lag);
  }
  const centre = Number(bpmHint) > 0 ? Number(bpmHint) : 115;
  const width = Number(bpmHint) > 0 ? 0.35 : 1.0;
  let best = { lag: minLag, score: -Infinity };
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    const at = (value) => interpolate(ac, value);
    const comb = at(lag) + 0.5 * at(2 * lag) + 0.33 * at(3 * lag) + 0.25 * at(4 * lag);
    const bpm = (60 * frameRate) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / centre) / width) ** 2);
    const score = comb * prior;
    if (score > best.score) best = { lag, score };
  }
  // Parabolic refinement of the autocorrelation peak.
  const [a, b, c] = [ac[best.lag - 1] ?? 0, ac[best.lag], ac[best.lag + 1] ?? 0];
  const denominator = a - 2 * b + c;
  const shift = denominator !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denominator)) : 0;
  return { period: (best.lag + shift) / frameRate };
}

function interpolate(values, index) {
  const i = Math.floor(index);
  const frac = index - i;
  if (i < 0 || i + 1 >= values.length) return 0;
  return values[i] * (1 - frac) + values[i + 1] * frac;
}

// Fit one constant-tempo grid to the whole track: search the period around
// the estimate in 0.02 BPM steps and every phase, maximising the mean
// envelope at the grid's beats.
function fitGrid(env, frameRate, frameOffset, period0, duration) {
  const bpm0 = 60 / period0;
  const valueAt = (t) => interpolate(env, (t - frameOffset) * frameRate);
  const score = (period, phase) => {
    let acc = 0;
    let count = 0;
    for (let t = phase; t < duration - frameOffset; t += period) { acc += valueAt(t); count += 1; }
    return count ? acc / count : 0;
  };
  const search = (bpmLow, bpmHigh, bpmStep, phaseStep) => {
    let best = { period: period0, phase: 0, score: -Infinity };
    for (let bpm = bpmLow; bpm <= bpmHigh + 1e-9; bpm += bpmStep) {
      const period = 60 / bpm;
      for (let phase = 0; phase < period; phase += phaseStep) {
        const value = score(period, phase);
        if (value > best.score) best = { period, phase, score: value };
      }
    }
    return best;
  };
  const step = 1 / frameRate;
  const rough = search(bpm0 * 0.96, bpm0 * 1.04, 0.1, step);
  const roughBpm = 60 / rough.period;
  const fine = search(roughBpm - 0.15, roughBpm + 0.15, 0.01, step / 4);
  // Confidence: the fitted grid against the same period at the off-beat.
  const offbeat = score(fine.period, (fine.phase + fine.period / 2) % fine.period);
  const confidence = fine.score > 0 ? Math.max(0, Math.min(1, 1 - offbeat / fine.score)) : 0;
  const beats = [];
  for (let t = fine.phase; t < duration - 0.02; t += fine.period) beats.push(t);
  return { period: fine.period, phase: fine.phase, beats, confidence };
}

// The full-band envelope fits hi-hats on the off-beats as well as kicks and
// snares on the beats. Of the grid and the same grid shifted by half a beat,
// keep the one with more attack below 1.5 kHz (kick, snare, bass, chords).
function onBeatNotOffbeat(grid, lowMid, frameRate, frameOffset, duration) {
  const score = (phase) => {
    let acc = 0;
    let count = 0;
    for (let t = phase; t < duration - frameOffset; t += grid.period) { acc += interpolate(lowMid, (t - frameOffset) * frameRate); count += 1; }
    return count ? acc / count : 0;
  };
  const shifted = (grid.phase + grid.period / 2) % grid.period;
  if (!(score(shifted) > score(grid.phase) * 1.1)) return grid;
  const beats = [];
  for (let t = shifted; t < duration - 0.02; t += grid.period) beats.push(t);
  return { ...grid, phase: shifted, beats, shifted_half_beat: true };
}

// Nudge each beat (by at most 20 ms) towards the envelope peak near it, when
// that peak is clearly an onset; otherwise keep the grid time.
function refineBeats(beats, env, frameRate, frameOffset) {
  const radius = Math.round(0.02 * frameRate);
  return beats.map((t) => {
    const centre = Math.round((t - frameOffset) * frameRate);
    let bestIndex = -1;
    let bestValue = 0;
    for (let i = centre - radius; i <= centre + radius; i += 1) {
      if (i <= 0 || i >= env.length - 1) continue;
      if (env[i] > bestValue && env[i] >= env[i - 1] && env[i] >= env[i + 1]) { bestValue = env[i]; bestIndex = i; }
    }
    if (bestIndex < 0 || bestValue < 1.5) return t;
    const [a, b, c] = [env[bestIndex - 1], env[bestIndex], env[bestIndex + 1]];
    const denominator = a - 2 * b + c;
    const shift = denominator !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denominator)) : 0;
    const peak = (bestIndex + shift) / frameRate + frameOffset;
    // Blend towards the peak so one stray onset cannot pull a beat far.
    return t + 0.5 * (peak - t);
  });
}

// ---------------------------------------------------------------------------
// Downbeats

function chooseDownbeatPhase(beats, period, { low, spectra, frameRate, frameOffset, beatsPerBar }) {
  const frameOf = (t) => Math.max(0, Math.min(spectra.length - 1, Math.round((t - frameOffset) * frameRate)));
  const lowAt = beats.map((t) => {
    const centre = frameOf(t);
    let peak = 0;
    for (let i = centre - 3; i <= centre + 3; i += 1) if (i >= 0 && i < low.length) peak = Math.max(peak, low[i]);
    return peak;
  });
  const span = Math.max(1, Math.round(period * frameRate));
  const meanSpectrum = (from, to) => {
    const bands = spectra[0]?.length ?? 0;
    const mean = new Float64Array(bands);
    let count = 0;
    for (let i = Math.max(0, from); i < Math.min(spectra.length, to); i += 1) { for (let k = 0; k < bands; k += 1) mean[k] += spectra[i][k]; count += 1; }
    if (count) for (let k = 0; k < bands; k += 1) mean[k] /= count;
    return mean;
  };
  const change = beats.map((t) => {
    const centre = frameOf(t);
    const before = meanSpectrum(centre - span * 2, centre);
    const after = meanSpectrum(centre, centre + span * 2);
    let dot = 0, na = 0, nb = 0;
    for (let k = 0; k < before.length; k += 1) { dot += before[k] * after[k]; na += before[k] ** 2; nb += after[k] ** 2; }
    return na > 0 && nb > 0 ? 1 - dot / Math.sqrt(na * nb) : 0;
  });
  const normalise = (values) => {
    const mean = values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
    // Cap outliers so one event (an instrument entering off the bar) cannot
    // outvote a steady pattern of bar-line changes.
    return mean > 0 ? values.map((value) => Math.min(3, value / mean)) : values.map(() => 0);
  };
  const lowN = normalise(lowAt);
  const changeN = normalise(change);
  const scores = new Array(beatsPerBar).fill(0);
  const counts = new Array(beatsPerBar).fill(0);
  beats.forEach((_, index) => {
    scores[index % beatsPerBar] += lowN[index] + 1.5 * changeN[index];
    counts[index % beatsPerBar] += 1;
  });
  const averaged = scores.map((score, index) => (counts[index] ? score / counts[index] : 0));
  let phase = 0;
  for (let p = 1; p < beatsPerBar; p += 1) if (averaged[p] > averaged[phase] + 1e-9) phase = p;
  return { phase, scores: averaged };
}

// ---------------------------------------------------------------------------
// FFT (in place, radix 2)

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (-2 * Math.PI) / size;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < size / 2; k += 1) {
        const a = start + k;
        const b = a + size / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
}

function round2(value) { return Math.round(value * 100) / 100; }
function round3(value) { return Math.round(value * 1000) / 1000; }
function round5(value) { return Math.round(value * 100000) / 100000; }
