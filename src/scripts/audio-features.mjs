#!/usr/bin/env node
// Per-video-frame audio features of the final mix and its buses
// (AUDIO_FEATURES.json, launchclip.audio-features.v1), so both renderers read
// the same numbers by frame index and never analyse audio themselves
// (docs/IMMERSIVE_SOUND_RFC.md §4). Plain JS on FFmpeg-decoded floats.
//
// Per frame and bus: loud (momentary K-weighted loudness, -50..-8 LUFS → 0..1),
// five band energies (sub 20–120 Hz, low 120–500, mid 0.5–2k, high 2–8k,
// air 8k+; dB → 0..1) and onset (spectral flux of the percussive part of a
// median-filter harmonic/percussive split). Every series is smoothed by an
// attack/release follower (10 ms / 180 ms) and rounded to three decimals.
// Usage: node audio-features.mjs <out.json> --fps 30 --duration 12 --mix mix.wav [--music m.wav] [--voice v.wav]
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);

export const AUDIO_FEATURES_SCHEMA = 'launchclip.audio-features.v1';
export const RATE = 48000;
export const FFT_SIZE = 2048;
export const BANDS = Object.freeze({ sub: [20, 120], low: [120, 500], mid: [500, 2000], high: [2000, 8000], air: [8000, 24000] });
export const SERIES = Object.freeze(['loud', ...Object.keys(BANDS), 'onset']);
export const LOUD_RANGE = Object.freeze([-50, -8]);
// Band energy in dB relative to a full-scale sine filling the band.
export const BAND_RANGE = Object.freeze([-60, -6]);
export const FOLLOW = Object.freeze({ attack: 0.01, release: 0.18 });
const HPSS_BINS = 17;
const MOMENTARY = 0.4;

/** In-place iterative radix-2 FFT of re/im (length a power of two). */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const step = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k += 1) {
        const wr = Math.cos(step * k), wi = Math.sin(step * k);
        const a = start + k, b = a + size / 2;
        const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

// ITU-R BS.1770 K-weighting at 48 kHz: a high shelf, then a high pass.
const K_WEIGHT = [
  { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [-1.69065929318241, 0.73248077421585] },
  { b: [1, -2, 1], a: [-1.99004745483398, 0.99007225036621] }
];
function kWeight(samples) {
  let out = samples;
  for (const { b, a } of K_WEIGHT) {
    const y = new Float64Array(out.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < out.length; i += 1) {
      const x = out[i];
      const v = b[0] * x + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = v; y[i] = v;
    }
    out = y;
  }
  return out;
}

const median = (values) => { const sorted = Float64Array.from(values).sort(); return sorted[sorted.length >> 1]; };
const scale = (value, [low, high]) => Math.min(1, Math.max(0, (value - low) / (high - low)));
const round3 = (value) => Math.round(value * 1000) / 1000;

/** Attack/release envelope follower at the frame rate, then rounded to three decimals. */
export function follow(series, fps, { attack, release } = FOLLOW) {
  const up = 1 - Math.exp(-1 / (attack * fps)), down = 1 - Math.exp(-1 / (release * fps));
  let level = 0;
  return Array.from(series, (value) => { level += (value - level) * (value > level ? up : down); return round3(level); });
}

/** Features of one bus from interleaved stereo float samples at RATE. */
export function busFeatures(left, right, { fps, frames }) {
  const hop = RATE / fps;
  const half = FFT_SIZE / 2;
  const bin = RATE / FFT_SIZE;
  const window = Float64Array.from({ length: FFT_SIZE }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE));
  const windowPower = window.reduce((sum, w) => sum + w * w, 0);
  const kl = kWeight(left), kr = kWeight(right);
  const squares = new Float64Array(kl.length + 1);
  for (let i = 0; i < kl.length; i += 1) squares[i + 1] = squares[i] + kl[i] * kl[i] + kr[i] * kr[i];
  const spectra = [];
  const raw = Object.fromEntries(SERIES.map((name) => [name, new Float64Array(frames)]));
  const re = new Float64Array(FFT_SIZE), im = new Float64Array(FFT_SIZE);
  for (let f = 0; f < frames; f += 1) {
    const centre = Math.round((f + 0.5) * hop);
    // Momentary loudness: the 400 ms ending at this frame's centre.
    const end = Math.min(kl.length, centre), start = Math.max(0, end - Math.round(MOMENTARY * RATE));
    const power = end > start ? (squares[end] - squares[start]) / Math.round(MOMENTARY * RATE) : 0;
    raw.loud[f] = scale(power > 0 ? -0.691 + 10 * Math.log10(power) : -Infinity, LOUD_RANGE);
    for (let i = 0; i < FFT_SIZE; i += 1) {
      const at = centre - half + i;
      re[i] = at >= 0 && at < left.length ? ((left[at] + right[at]) / 2) * window[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
    const magnitude = new Float64Array(half);
    for (let k = 0; k < half; k += 1) magnitude[k] = Math.hypot(re[k], im[k]);
    spectra.push(magnitude);
    for (const [name, [lowHz, highHz]] of Object.entries(BANDS)) {
      let sum = 0;
      for (let k = Math.max(1, Math.ceil(lowHz / bin)); k < Math.min(half, Math.floor(highHz / bin)); k += 1) sum += magnitude[k] * magnitude[k];
      // Normalised by Parseval so a full-scale sine in the band reads 0 dB.
      const db = 10 * Math.log10((2 * sum) / (windowPower * FFT_SIZE / 2) + 1e-12);
      raw[name][f] = scale(db, BAND_RANGE);
    }
  }
  // Percussive part: per bin, the frequency median beats the time median.
  const radius = HPSS_BINS >> 1;
  let previous = null;
  for (let f = 0; f < frames; f += 1) {
    const percussive = new Float64Array(half);
    for (let k = 0; k < half; k += 1) {
      const across = [], along = [];
      for (let d = -radius; d <= radius; d += 1) {
        along.push(spectra[Math.min(frames - 1, Math.max(0, f + d))][k]);
        across.push(spectra[f][Math.min(half - 1, Math.max(0, k + d))]);
      }
      const p = median(across), h = median(along);
      const pp = p * p, hh = h * h;
      percussive[k] = pp + hh > 0 ? spectra[f][k] * (pp / (pp + hh)) : 0;
    }
    let flux = 0;
    if (previous) for (let k = 0; k < half; k += 1) flux += Math.max(0, Math.log1p(percussive[k]) - Math.log1p(previous[k]));
    raw.onset[f] = flux;
    previous = percussive;
  }
  // Onset strength relative to this bus's own strong onsets (its 98th percentile).
  const ceiling = Float64Array.from(raw.onset).sort()[Math.floor(frames * 0.98)] || 1;
  raw.onset = raw.onset.map((value) => Math.min(1, value / ceiling));
  return Object.fromEntries(SERIES.map((name) => [name, follow(raw[name], fps)]));
}

export async function decode(file, seconds) {
  const { stdout } = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-t', String(seconds), '-ac', '2', '-ar', String(RATE), '-f', 'f32le', '-'], { encoding: 'buffer', maxBuffer: 1 << 30 });
  const all = new Float32Array(stdout.buffer, stdout.byteOffset, stdout.byteLength / 4);
  const left = new Float32Array(all.length / 2), right = new Float32Array(all.length / 2);
  for (let i = 0; i < left.length; i += 1) { left[i] = all[2 * i]; right[i] = all[2 * i + 1]; }
  return { left, right };
}

/** AUDIO_FEATURES.json's content for the given bus files ({mix, music?, voice?}). */
export async function audioFeatures(buses, { fps, duration }) {
  const frames = Math.round(duration * fps);
  const out = { schema: AUDIO_FEATURES_SCHEMA, fps, frames, series: SERIES, buses: {} };
  for (const [name, file] of Object.entries(buses)) {
    if (!file) continue;
    const { left, right } = await decode(file, duration);
    out.buses[name] = busFeatures(left, right, { fps, frames });
  }
  return out;
}

export async function writeAudioFeatures(out, buses, options) {
  const features = await audioFeatures(buses, options);
  await writeFile(out, `${JSON.stringify(features)}\n`);
  return features;
}

async function main(argv) {
  const [out, ...rest] = argv;
  const flag = (name) => { const index = rest.indexOf(name); return index >= 0 ? rest[index + 1] : undefined; };
  if (!out || !flag('--mix') || !flag('--fps') || !flag('--duration')) throw new Error('usage: audio-features.mjs <out.json> --fps 30 --duration 12 --mix mix.wav [--music m.wav] [--voice v.wav]');
  const features = await writeAudioFeatures(out, { mix: flag('--mix'), music: flag('--music'), voice: flag('--voice') }, { fps: Number(flag('--fps')), duration: Number(flag('--duration')) });
  console.log(`${out}: ${features.frames} frames, buses ${Object.keys(features.buses).join(', ')}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exit(1); });
