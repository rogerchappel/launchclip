// SFX post-processing: turn a raw clip (a provider download or a procedural
// render) into a library-ready 48 kHz WAV whose transient starts within a few
// milliseconds, whose tail is trimmed and faded, whose length fits its family,
// and whose peak matches the family target. Clips that are silent, clipped or
// (for single-hit families) contain several hits with no clean one are
// rejected. Every kept clip carries its measurements.
//
// The signal work is plain JavaScript on Float32Array channels so it is
// deterministic and testable without FFmpeg; FFmpeg only decodes the input and
// measures integrated loudness for clips long enough to have one.
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export const SAMPLE_RATE = 48000;

// Per-family rules. single: one hit only (multi-hit clips keep the cleanest
// hit or are rejected). maxMs: hard length cap from the onset. minGapMs:
// onsets closer than this belong to the same hit. peakDb: normalisation
// target. fadeMs: tail fade. swell: the sound grows in, so its start is where
// it becomes audible rather than a sharp onset. endOnPeak: cut just after the
// loudest moment (a riser lands on its hit).
export const FAMILY_RULES = Object.freeze({
  whoosh: { single: false, maxMs: 1200, minGapMs: 200, peakDb: -3, fadeMs: 60, swell: true },
  impact: { single: true, maxMs: 1600, minGapMs: 250, peakDb: -3, fadeMs: 120 },
  riser: { single: false, maxMs: 2600, minGapMs: 300, peakDb: -3, fadeMs: 12, swell: true, endOnPeak: true },
  tick: { single: true, maxMs: 150, minGapMs: 50, peakDb: -3, fadeMs: 20 },
  pop: { single: true, maxMs: 300, minGapMs: 60, peakDb: -3, fadeMs: 30 },
  shimmer: { single: false, maxMs: 2200, minGapMs: 300, peakDb: -3, fadeMs: 250 },
  subdrop: { single: false, maxMs: 2200, minGapMs: 300, peakDb: -3, fadeMs: 250 },
  click: { single: true, maxMs: 100, minGapMs: 40, peakDb: -3, fadeMs: 10 },
  keystroke: { single: true, maxMs: 120, minGapMs: 45, peakDb: -3, fadeMs: 12 },
  "keystroke-space": { single: true, maxMs: 180, minGapMs: 60, peakDb: -3, fadeMs: 18 },
  "keystroke-enter": { single: true, maxMs: 170, minGapMs: 60, peakDb: -3, fadeMs: 18 }
});

const DEFAULT_RULES = { single: false, maxMs: 2000, minGapMs: 200, peakDb: -3, fadeMs: 60 };
const FRAME_MS = 1;
const PREROLL_MS = 1;
const SILENT_DB = -50;
const MIN_ISOLATION_DB = 6;
const STRONG_HIT_DB = 10;

export function familyRules(family) {
  return { ...DEFAULT_RULES, ...(FAMILY_RULES[family] ?? {}) };
}

export const toDb = (amplitude) => (amplitude > 0 ? 20 * Math.log10(amplitude) : -Infinity);
const fromDb = (db) => 10 ** (db / 20);
const round = (value, digits = 2) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : null);

/** Remove DC: subtract each channel's mean. Returns {channels, offset}. */
export function removeDc(channels) {
  let offset = 0;
  const out = channels.map((channel) => {
    let sum = 0;
    for (let i = 0; i < channel.length; i++) sum += channel[i];
    const mean = channel.length ? sum / channel.length : 0;
    offset = Math.max(offset, Math.abs(mean));
    const copy = new Float32Array(channel.length);
    for (let i = 0; i < channel.length; i++) copy[i] = channel[i] - mean;
    return copy;
  });
  return { channels: out, offset };
}

export function mixdown(channels) {
  if (channels.length === 1) return channels[0];
  const mono = new Float32Array(channels[0].length);
  for (const channel of channels) for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / channels.length;
  return mono;
}

function peakOf(channels, from = 0, to = Infinity) {
  let peak = 0;
  for (const channel of channels) for (let i = Math.max(0, from); i < Math.min(channel.length, to); i++) peak = Math.max(peak, Math.abs(channel[i]));
  return peak;
}

function rmsOf(channels) {
  let sum = 0;
  let count = 0;
  for (const channel of channels) for (let i = 0; i < channel.length; i++) { sum += channel[i] * channel[i]; count++; }
  return count ? Math.sqrt(sum / count) : 0;
}

/**
 * Flat-topped runs: 4+ consecutive samples near full scale (|x| >= 0.98) that
 * hold the same value (within 0.002), the signature of hard clipping. Float
 * decodes of a hot lossy file can exceed 1.0 without clipping; those overs
 * are rescaled by normalisation, so only flat tops count.
 */
export function clippedRuns(channels, threshold = 0.98) {
  let runs = 0;
  for (const channel of channels) {
    let run = 0;
    for (let i = 1; i < channel.length; i++) {
      if (Math.abs(channel[i]) >= threshold && Math.abs(channel[i] - channel[i - 1]) < 0.002) { run++; if (run === 3) runs++; }
      else run = 0;
    }
  }
  return runs;
}

/** 1 ms peak envelope in dB. */
export function envelope(mono, sampleRate = SAMPLE_RATE) {
  const frame = Math.max(1, Math.round(sampleRate * FRAME_MS / 1000));
  const frames = Math.ceil(mono.length / frame);
  const db = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let peak = 0;
    for (let i = f * frame; i < Math.min(mono.length, (f + 1) * frame); i++) peak = Math.max(peak, Math.abs(mono[i]));
    db[f] = Math.max(-120, toDb(peak));
  }
  return { db, frame };
}

function percentile(values, q) {
  const sorted = Array.from(values).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : -120;
}

/**
 * Onsets: frames where the envelope jumps at least riseDb above the loudest
 * frame from 15 to 4 ms earlier and is above the detection threshold. Onsets
 * within minGapMs of the previous one belong to the same hit. Each onset has
 * a sample-accurate start (the first sample of the rise), its hit peak (dB,
 * over minGapMs) and its isolation (hit peak minus the loudest frame of the
 * 15 ms before it).
 */
export function detectOnsets(mono, sampleRate = SAMPLE_RATE, { minGapMs = 45, riseDb = 12, rangeDb = 45 } = {}) {
  const { db, frame } = envelope(mono, sampleRate);
  if (!db.length) return [];
  const peak = Math.max(...db);
  const floor = percentile(db, 0.1);
  const threshold = Math.max(floor + 10, peak - rangeDb, -80);
  const gapFrames = Math.max(1, Math.round(minGapMs / FRAME_MS));
  const onsets = [];
  for (let f = 0; f < db.length; f++) {
    if (db[f] < threshold) continue;
    // Compare with the loudest frame from 15 to 4 ms earlier (a peak hold):
    // the hold keeps the zero crossings of a low tone from reading as fresh
    // transients, and the 4 ms gap lets attacks that take a few ms to rise
    // still clear the threshold.
    let recent = -120;
    for (let k = Math.max(0, f - 15); k < f - 3; k++) recent = Math.max(recent, db[k]);
    if (db[f] - recent < riseDb) continue;
    if (onsets.length && f - onsets.at(-1).frame < gapFrames) continue;
    onsets.push({ frame: f });
  }
  return onsets.map(({ frame: first }) => {
    let hitPeak = -120;
    for (let k = first; k < Math.min(db.length, first + gapFrames); k++) hitPeak = Math.max(hitPeak, db[k]);
    // The attack: the first frame of the group within 20 dB of the hit peak,
    // so faint pre-noise (a codec blip, a breath) never becomes the onset.
    let f = first;
    while (f < Math.min(db.length - 1, first + gapFrames) && db[f] < hitPeak - 20) f++;
    let before = -120;
    for (let k = Math.max(0, f - 15); k < f; k++) before = Math.max(before, db[k]);
    // Sample-accurate start: first sample in the 2 frames before the onset
    // frame (or the frame itself) that clears 5% of the hit peak and the floor.
    const level = Math.max(fromDb(hitPeak) * 0.05, fromDb(floor) * 4);
    let sample = f * frame;
    for (let i = Math.max(0, (f - 2) * frame); i < Math.min(mono.length, (f + 1) * frame); i++) {
      if (Math.abs(mono[i]) >= level) { sample = i; break; }
    }
    return { frame: f, sample, time: sample / sampleRate, peakDb: round(hitPeak), isolationDb: round(hitPeak - before) };
  });
}

/** The first sample where a swelling sound becomes audible (peak - 40 dB). */
function swellStart(mono, peakAmp) {
  const level = peakAmp * fromDb(-40);
  for (let i = 0; i < mono.length; i++) if (Math.abs(mono[i]) >= level) return i;
  return 0;
}

/**
 * Candidate single-hit segments, best first: [{start, end, onset}]. Strong
 * hits are onsets within 10 dB of the loudest; a segment runs to the next
 * strong hit. Ranked by isolation, then loudness.
 */
export function hitSegments(mono, sampleRate, rules) {
  const onsets = detectOnsets(mono, sampleRate, { minGapMs: rules.minGapMs });
  if (!onsets.length) return { onsets, strong: [], segments: [] };
  const loudest = Math.max(...onsets.map((onset) => onset.peakDb));
  const strong = onsets.filter((onset) => onset.peakDb >= loudest - STRONG_HIT_DB);
  const segments = strong.map((onset, index) => {
    const next = strong[index + 1];
    const end = next ? Math.max(onset.sample + 1, next.sample - Math.round(sampleRate * 0.002)) : mono.length;
    const start = index > 0 ? strong[index - 1].sample + 1 : 0;
    return { start, end, onset, score: onset.isolationDb + 0.5 * (onset.peakDb - loudest) };
  }).sort((a, b) => b.score - a.score || a.start - b.start);
  return { onsets, strong, segments };
}

function fadeOut(channels, samples) {
  if (samples <= 1) return;
  for (const channel of channels) {
    const n = Math.min(samples, channel.length);
    for (let i = 0; i < n; i++) channel[channel.length - n + i] *= 0.5 + 0.5 * Math.cos(Math.PI * (i + 1) / n);
  }
}

function fadeIn(channels, samples) {
  for (const channel of channels) for (let i = 0; i < Math.min(samples, channel.length); i++) channel[i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / samples);
}

/** Trim, fade and normalise one segment [start, end) of the cleaned channels. */
function shapeSegment(clean, sampleRate, rules, { start, end, onsetSample }) {
  const mono = mixdown(clean);
  // The cap covers the whole file, pre-roll included.
  const maxEnd = Math.min(end, onsetSample + Math.round(sampleRate * (rules.maxMs - PREROLL_MS) / 1000));
  const segmentPeak = peakOf([mono], onsetSample, maxEnd);
  let last = onsetSample;
  if (rules.endOnPeak) {
    let peakAt = onsetSample;
    for (let i = onsetSample; i < maxEnd; i++) if (Math.abs(mono[i]) > Math.abs(mono[peakAt])) peakAt = i;
    last = Math.min(maxEnd, peakAt + Math.round(sampleRate * 0.02));
  } else {
    // The tail ends at the last 1 ms frame above both peak - 45 dB and 8 dB
    // over the clip's noise floor, so a hissy tail never counts as sound.
    const { db, frame } = envelope(mono, sampleRate);
    const tailDb = Math.max(toDb(segmentPeak) - 45, percentile(db, 0.1) + 8);
    for (let f = Math.floor((maxEnd - 1) / frame); f >= Math.floor(onsetSample / frame); f--) if (db[f] >= tailDb) { last = (f + 1) * frame; break; }
    last = Math.min(maxEnd, last + Math.round(sampleRate * 0.002));
  }
  const from = Math.max(start, onsetSample - Math.round(sampleRate * PREROLL_MS / 1000));
  const channels = clean.map((channel) => channel.slice(from, Math.max(from + 1, last)));
  fadeIn(channels, onsetSample - from);
  const length = channels[0].length;
  fadeOut(channels, Math.min(Math.round(sampleRate * rules.fadeMs / 1000), Math.floor(length * 0.3)));
  const peak = peakOf(channels);
  const gainDb = peak > 0 ? rules.peakDb - toDb(peak) : 0;
  const gain = fromDb(gainDb);
  for (const channel of channels) for (let i = 0; i < channel.length; i++) channel[i] *= gain;
  return { channels, from, to: last, gainDb };
}

/** Measurements of a processed clip. */
export function measure(channels, sampleRate = SAMPLE_RATE, rules = DEFAULT_RULES) {
  const mono = mixdown(channels);
  const peak = peakOf(channels);
  const onsets = detectOnsets(mono, sampleRate, { minGapMs: rules.minGapMs });
  // Transient start: the first sample within 20 dB of the peak (40 dB for a swell).
  const onsetLevel = peak * fromDb(rules.swell ? -40 : -20);
  let onset = 0;
  while (onset < mono.length - 1 && Math.abs(mono[onset]) < onsetLevel) onset++;
  let peakAt = 0;
  for (let i = 0; i < mono.length; i++) if (Math.abs(mono[i]) > Math.abs(mono[peakAt])) peakAt = i;
  return {
    onset_ms: round(onset / sampleRate * 1000),
    duration_ms: round(mono.length / sampleRate * 1000),
    peak_db: round(toDb(peak)),
    peak_at_ms: round(peakAt / sampleRate * 1000),
    rms_db: round(toDb(rmsOf(channels))),
    hits: rules.single ? onsets.filter((entry) => entry.peakDb >= toDb(peak) - STRONG_HIT_DB).length : null,
    channels: channels.length,
    sample_rate: sampleRate
  };
}

/**
 * Process decoded channels for a family. Returns {ok, reason?, channels,
 * measurements, stats} for the best hit; with harvest: n, also `harvested`:
 * up to n clean single hits (single-hit families only), best first.
 */
export function processSamples(input, sampleRate, family, { harvest = 0 } = {}) {
  const rules = familyRules(family);
  if (!input.length || !input[0].length) return { ok: false, reason: "empty clip" };
  const clipped = clippedRuns(input);
  const { channels: clean, offset } = removeDc(input);
  const mono = mixdown(clean);
  const rawPeak = peakOf(clean);
  const stats = { input_ms: round(input[0].length / sampleRate * 1000), input_peak_db: round(toDb(rawPeak)), dc_offset: round(offset, 5), clipped_runs: clipped };
  if (toDb(rawPeak) < SILENT_DB) return { ok: false, reason: `silent (peak ${round(toDb(rawPeak))} dBFS)`, stats };
  if (clipped >= 3) return { ok: false, reason: `clipped (${clipped} runs at full scale)`, stats };
  const shapeOne = (segment) => {
    const shaped = shapeSegment(clean, sampleRate, rules, segment);
    const measurements = measure(shaped.channels, sampleRate, rules);
    if (measurements.duration_ms < 10) return { ok: false, reason: "too short after trimming" };
    return {
      ok: true,
      channels: shaped.channels,
      measurements,
      stats: { ...stats, trimmed_lead_ms: round(shaped.from / sampleRate * 1000), trimmed_tail_ms: round((input[0].length - shaped.to) / sampleRate * 1000), gain_db: round(shaped.gainDb) }
    };
  };
  if (rules.swell) {
    const start = swellStart(mono, rawPeak);
    return shapeOne({ start: 0, end: mono.length, onsetSample: start });
  }
  const { onsets, strong, segments } = hitSegments(mono, sampleRate, rules);
  stats.onsets = onsets.length;
  stats.hits = strong.length;
  // A soft-attack sound in a multi-event family starts where it becomes audible.
  if (!segments.length && !rules.single) return shapeOne({ start: 0, end: mono.length, onsetSample: swellStart(mono, rawPeak) });
  if (!segments.length) return { ok: false, reason: "no onset found", stats };
  if (!rules.single || strong.length === 1) {
    const first = rules.single ? segments[0] : { start: 0, end: mono.length, onset: onsets[0] };
    const result = shapeOne({ start: first.start, end: rules.single ? first.end : mono.length, onsetSample: first.onset.sample });
    if (result.ok && harvest) result.harvested = [result];
    return result;
  }
  // Several strong hits in a single-hit family: keep the cleanest, or reject.
  // A clean hit stands clear of what came before (isolation) and rings for at
  // least 40% of the family's length before the next hit cuts in.
  const minSamples = Math.round(sampleRate * rules.maxMs * 0.4 / 1000);
  const clean_ = segments.filter((segment) => segment.onset.isolationDb >= MIN_ISOLATION_DB && segment.end - segment.onset.sample >= minSamples);
  if (!clean_.length) return { ok: false, reason: `multi-hit (${strong.length} hits) with no isolated hit`, stats };
  const best = shapeOne({ start: clean_[0].start, end: clean_[0].end, onsetSample: clean_[0].onset.sample });
  if (!best.ok) return { ...best, stats };
  best.stats.selected_hit = strong.indexOf(clean_[0].onset) + 1;
  if (harvest) best.harvested = clean_.slice(0, harvest).map((segment) => shapeOne({ start: segment.start, end: segment.end, onsetSample: segment.onset.sample })).filter((entry) => entry.ok);
  return best;
}

// ---------------------------------------------------------------------------
// File I/O

/** Decode any audio file to 48 kHz float channels (mono or stereo). */
export async function decodeAudio(file, { sampleRate = SAMPLE_RATE } = {}) {
  const { stdout: probe } = await execFileAsync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels", "-of", "csv=p=0", file]);
  const count = Math.min(2, Math.max(1, Number(String(probe).trim()) || 1));
  const { stdout } = await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", file, "-ac", String(count), "-ar", String(sampleRate), "-f", "f32le", "-"], { encoding: "buffer", maxBuffer: 1 << 28 });
  const floats = new Float32Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.length / 4));
  const frames = Math.floor(floats.length / count);
  const channels = Array.from({ length: count }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) for (let c = 0; c < count; c++) channels[c][i] = floats[i * count + c];
  return { channels, sampleRate };
}

/** Write 16-bit PCM WAV from float channels. */
export function encodeWav(channels, sampleRate = SAMPLE_RATE) {
  const count = channels.length;
  const frames = channels[0].length;
  const dataSize = frames * count * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(count, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * count * 2, 28);
  buffer.writeUInt16LE(count * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < count; c++) {
      const value = Math.max(-1, Math.min(1, channels[c][i]));
      buffer.writeInt16LE(Math.round(value * 32767), offset);
      offset += 2;
    }
  }
  return buffer;
}

export async function writeWavFile(file, channels, sampleRate = SAMPLE_RATE) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, encodeWav(channels, sampleRate));
}

/** Integrated loudness (LUFS) via FFmpeg ebur128; null for clips under 0.4 s. */
export async function integratedLoudness(file, durationMs) {
  if (!(durationMs >= 400)) return null;
  const { stderr } = await execFileAsync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-filter_complex", "ebur128", "-f", "null", "-"], { maxBuffer: 1 << 26 });
  const value = [...String(stderr).matchAll(/\bI:\s*(-?(?:\d+(?:\.\d+)?|inf))\s+LUFS/g)].at(-1)?.[1];
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Decode `input`, process it for `family` and write `output` (and, with
 * harvest, `<output-stem>-h<n>.wav` for extra hits). Returns the
 * processSamples result without the sample data, plus loudness.
 */
export async function processFile(input, output, family, { harvest = 0 } = {}) {
  const { channels, sampleRate } = await decodeAudio(input);
  const result = processSamples(channels, sampleRate, family, { harvest });
  if (!result.ok) return { ok: false, reason: result.reason, stats: result.stats ?? {} };
  await writeWavFile(output, result.channels, sampleRate);
  const measurements = { ...result.measurements, loudness_lufs: await integratedLoudness(output, result.measurements.duration_ms) };
  const harvested = [];
  for (const [index, extra] of (result.harvested ?? []).entries()) {
    if (index === 0) { harvested.push({ file: output, measurements, stats: result.stats }); continue; }
    const file = output.replace(/\.wav$/, `-h${index + 1}.wav`);
    await writeWavFile(file, extra.channels, sampleRate);
    harvested.push({ file, measurements: { ...extra.measurements, loudness_lufs: null }, stats: extra.stats });
  }
  return { ok: true, file: output, measurements, stats: result.stats, harvested };
}
