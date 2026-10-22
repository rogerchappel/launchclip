// Voice-audio measurements for the enhancement chain (src/audio_enhance.js).
//
// Everything here is pure JavaScript over mono float samples, so it is
// deterministic and testable without FFmpeg. The before and after
// measurements share one speech/silence mask (computed on the "before"
// signal) so the noise floor is read at the same timestamps both times; the
// chain never moves audio in time.

export const ANALYSIS_SAMPLE_RATE = 24000;
const FRAME = 512; // ~21 ms at 24 kHz
const FFT_SIZE = 1024; // ~23 Hz bins for speech-band metrics
const HUM_FFT_SIZE = 32768; // ~0.73 Hz bins: a steady hum stays narrow while moving speech pitch smears
const MIN_SILENCE_SECONDS = 0.2;
export const HUM_PROMINENCE_DB = 10;
const HUM_NOTCH_DB = 6;
const MAX_SPECTRAL_FRAMES = 1500;
const EPS = 1e-12;

/**
 * Classify frames as speech or detected silence. Silence needs a run of at
 * least 200 ms below a floor-relative threshold; speech frames sit well above
 * the floor. Frames between the two thresholds count as neither.
 */
export function classifyFrames(samples, sampleRate, { frame = FRAME } = {}) {
  const count = Math.floor(samples.length / frame);
  if (count < 4) throw new Error("Audio is too short to measure");
  const db = new Float64Array(count);
  for (let index = 0; index < count; index++) {
    let sum = 0;
    for (let offset = index * frame, end = offset + frame; offset < end; offset++) sum += samples[offset] * samples[offset];
    db[index] = 10 * Math.log10(sum / frame + EPS);
  }
  // Classify on a ~107 ms moving average of frame power, so the frame-to-frame
  // flutter of broadband noise does not break up a pause.
  const smooth = new Float64Array(count);
  for (let index = 0; index < count; index++) {
    let sum = 0; let n = 0;
    for (let at = Math.max(0, index - 2); at <= Math.min(count - 1, index + 2); at++) { sum += 10 ** (db[at] / 10); n++; }
    smooth[index] = 10 * Math.log10(sum / n);
  }
  const sorted = Array.from(smooth).sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)];
  const loud = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  const range = Math.max(0, loud - floor);
  const low = floor + Math.max(3, range * 0.15);
  const high = floor + Math.max(6, range * 0.55);
  const silence = new Uint8Array(count);
  const speech = new Uint8Array(count);
  const minRun = Math.ceil(MIN_SILENCE_SECONDS * sampleRate / frame);
  let runStart = -1;
  for (let index = 0; index <= count; index++) {
    const quiet = index < count && smooth[index] < low;
    if (quiet && runStart < 0) runStart = index;
    if (!quiet && runStart >= 0) {
      if (index - runStart >= minRun) for (let at = runStart; at < index; at++) silence[at] = 1;
      runStart = -1;
    }
    if (index < count && smooth[index] >= high && db[index] >= high - 3) speech[index] = 1;
  }
  const silences = [];
  for (let index = 0; index < count; index++) {
    if (!silence[index]) continue;
    const start = index;
    while (index < count && silence[index]) index++;
    silences.push({ start_seconds: start * frame / sampleRate, end_seconds: index * frame / sampleRate });
  }
  return { frame, sampleRate, count, db, silence, speech, silences, thresholds_db: { floor, loud, low, high }, dynamic: range >= 6 };
}

/** Measure a voice signal against a mask (default: its own classification). */
export function measureVoice(samples, sampleRate, { mask } = {}) {
  const frames = mask ?? classifyFrames(samples, sampleRate);
  const { frame } = frames;
  const count = Math.min(frames.count, Math.floor(samples.length / frame));
  let silencePower = 0; let silenceFrames = 0; let speechPower = 0; let speechFrames = 0;
  const speechLevels = [];
  for (let index = 0; index < count; index++) {
    let sum = 0; let peak = 0;
    for (let offset = index * frame, end = offset + frame; offset < end; offset++) { sum += samples[offset] * samples[offset]; peak = Math.max(peak, Math.abs(samples[offset])); }
    const power = sum / frame;
    if (frames.silence[index]) { silencePower += power; silenceFrames++; }
    if (frames.speech[index]) { speechPower += power; speechFrames++; speechLevels.push(20 * Math.log10(peak + EPS)); }
  }
  const noise = silenceFrames ? silencePower / silenceFrames : null;
  const speech = speechFrames ? speechPower / speechFrames : null;
  const speechSpectrum = averageSpectrum(samples, frames, "speech");
  const noiseSpectrum = averageSpectrum(samples, frames, "silence");
  const binHz = sampleRate / FFT_SIZE;
  const band = (spectrum, low, highHz) => sumBand(spectrum, binHz, low, highHz);
  // Speech-band energy with the noise power removed: a denoiser that only
  // takes noise away leaves this unchanged.
  let cleanSpeechBand = null;
  if (speechSpectrum) {
    const clean = speechSpectrum.map((value, bin) => Math.max(0, value - (noiseSpectrum?.[bin] ?? 0)));
    cleanSpeechBand = band(clean, 300, 3400);
  }
  return {
    sample_rate: sampleRate,
    duration_seconds: round(samples.length / sampleRate, 3),
    silence_seconds: round(silenceFrames * frame / sampleRate, 3),
    speech_seconds: round(speechFrames * frame / sampleRate, 3),
    noise_floor_dbfs: noise === null ? null : dbRound(noise),
    speech_level_dbfs: speech === null ? null : dbRound(speech),
    // Loud syllables: the 90th percentile of per-frame sample peaks in speech.
    speech_peak_dbfs: speechLevels.length ? round(speechLevels.sort((a, b) => a - b)[Math.floor(speechLevels.length * 0.9)], 1) : null,
    snr_db: noise === null || speech === null ? null : round(10 * Math.log10(Math.max(speech - noise, EPS) / Math.max(noise, EPS)), 1),
    speech_band_db: cleanSpeechBand === null ? null : dbRound(cleanSpeechBand),
    sibilance_ratio_db: speechSpectrum ? round(10 * Math.log10((band(speechSpectrum, 5000, 10000) + EPS) / (band(speechSpectrum, 300, 3400) + EPS)), 1) : null,
    spectral_tilt_db_per_octave: speechSpectrum ? round(spectralTilt(speechSpectrum, binHz), 2) : null,
    speech_flatness: speechSpectrum ? round(meanFlatness(samples, frames), 4) : null,
    hum: detectHum(samples, sampleRate)
  };
}

/** Change between two measurements (after minus before, in dB where relevant). */
export function compareMeasurements(before, after) {
  const delta = (key) => before?.[key] == null || after?.[key] == null ? null : round(after[key] - before[key], 2);
  return {
    noise_floor_db: delta("noise_floor_dbfs"),
    snr_db: delta("snr_db"),
    speech_band_db: delta("speech_band_db"),
    sibilance_ratio_db: delta("sibilance_ratio_db"),
    spectral_tilt_db_per_octave: delta("spectral_tilt_db_per_octave"),
    speech_flatness_log2: before?.speech_flatness > 0 && after?.speech_flatness > 0 ? round(Math.log2(after.speech_flatness / before.speech_flatness), 3) : null
  };
}

/**
 * Hum: a narrow, steady peak at 50 or 60 Hz (or its low harmonics) standing
 * well above its neighbourhood. Read over the whole signal with ~1.4 s
 * windows: mains hum keeps its exact frequency, so it stays in one 0.73 Hz
 * bin, while speech pitch moves and smears across many.
 */
export function detectHum(samples, sampleRate) {
  const size = sampleRate >= 32000 ? HUM_FFT_SIZE * 2 : HUM_FFT_SIZE;
  const segments = [];
  for (let at = 0; at + size <= samples.length; at += size / 2) segments.push(at);
  if (segments.length < 2) return { detected: false, fundamental_hz: null, harmonics: [], note: "too short for a hum reading (needs about 2 s)" };
  const picked = evenly(segments, 96);
  const spectrum = new Float64Array(size / 2);
  const window = hann(size);
  for (const at of picked) accumulate(spectrum, samples, at, window);
  const binHz = sampleRate / size;
  const prominence = (hz) => {
    const center = Math.round(hz / binHz);
    let peak = 0;
    for (let bin = center - 2; bin <= center + 2; bin++) peak = Math.max(peak, spectrum[bin] ?? 0);
    const around = [];
    for (let bin = Math.round((hz - 20) / binHz); bin <= Math.round((hz + 20) / binHz); bin++) {
      if (Math.abs(bin * binHz - hz) >= 4 && bin > 0) around.push(spectrum[bin] ?? 0);
    }
    around.sort((a, b) => a - b);
    const reference = around[Math.floor(around.length / 2)] ?? 0;
    return 10 * Math.log10((peak + EPS) / (reference + EPS));
  };
  const required = HUM_PROMINENCE_DB;
  const candidates = [50, 60].map((fundamental) => {
    const harmonics = [1, 2, 3, 4, 5, 6].map((order) => ({ hz: fundamental * order, prominence_db: round(prominence(fundamental * order), 1) }));
    const strong = harmonics.filter((entry) => entry.prominence_db >= required);
    return { fundamental, harmonics, strong, score: harmonics.reduce((sum, entry) => sum + Math.max(0, entry.prominence_db - 3), 0) };
  });
  const best = candidates.sort((a, b) => b.score - a.score)[0];
  // The fundamental, or two harmonics, must clear the bar.
  const detected = best.harmonics[0].prominence_db >= required || best.strong.length >= 2;
  return {
    detected,
    fundamental_hz: detected ? best.fundamental : null,
    harmonics: best.harmonics.map((entry) => ({ ...entry, notch: detected && entry.prominence_db >= HUM_NOTCH_DB }))
  };
}

function averageSpectrum(samples, frames, kind) {
  const flags = frames[kind];
  const ratio = FFT_SIZE / frames.frame;
  const starts = [];
  for (let index = 0; index + ratio <= frames.count; index++) {
    let all = true;
    for (let offset = 0; offset < ratio; offset++) if (!flags[index + offset]) { all = false; break; }
    if (all) starts.push(index * frames.frame);
  }
  if (!starts.length) return null;
  const spectrum = new Float64Array(FFT_SIZE / 2);
  const window = hann(FFT_SIZE);
  const picked = evenly(starts, MAX_SPECTRAL_FRAMES);
  for (const at of picked) accumulate(spectrum, samples, at, window);
  for (let bin = 0; bin < spectrum.length; bin++) spectrum[bin] /= picked.length;
  return spectrum;
}

function meanFlatness(samples, frames) {
  const ratio = FFT_SIZE / frames.frame;
  const starts = [];
  for (let index = 0; index + ratio <= frames.count; index += ratio) {
    let all = true;
    for (let offset = 0; offset < ratio; offset++) if (!frames.speech[index + offset]) { all = false; break; }
    if (all) starts.push(index * frames.frame);
  }
  if (!starts.length) return 0;
  const window = hann(FFT_SIZE);
  const binHz = frames.sampleRate / FFT_SIZE;
  const low = Math.ceil(100 / binHz);
  const high = Math.min(FFT_SIZE / 2 - 1, Math.floor(8000 / binHz));
  let total = 0;
  const picked = evenly(starts, MAX_SPECTRAL_FRAMES);
  for (const at of picked) {
    const spectrum = new Float64Array(FFT_SIZE / 2);
    accumulate(spectrum, samples, at, window);
    let logSum = 0; let sum = 0;
    for (let bin = low; bin <= high; bin++) { logSum += Math.log(spectrum[bin] + EPS); sum += spectrum[bin]; }
    const n = high - low + 1;
    total += Math.exp(logSum / n) / (sum / n + EPS);
  }
  return total / picked.length;
}

function spectralTilt(spectrum, binHz) {
  // Octave bands 125 Hz .. 8 kHz; least-squares slope in dB per octave.
  const points = [];
  for (let octave = 0; octave <= 6; octave++) {
    const center = 125 * 2 ** octave;
    const energy = sumBand(spectrum, binHz, center / Math.SQRT2, center * Math.SQRT2);
    if (energy > 0) points.push([octave, 10 * Math.log10(energy)]);
  }
  if (points.length < 2) return 0;
  const meanX = points.reduce((sum, [x]) => sum + x, 0) / points.length;
  const meanY = points.reduce((sum, [, y]) => sum + y, 0) / points.length;
  let numerator = 0; let denominator = 0;
  for (const [x, y] of points) { numerator += (x - meanX) * (y - meanY); denominator += (x - meanX) ** 2; }
  return numerator / denominator;
}

function sumBand(spectrum, binHz, low, high) {
  let sum = 0;
  const first = Math.max(1, Math.ceil(low / binHz));
  const last = Math.min(spectrum.length - 1, Math.floor(high / binHz));
  for (let bin = first; bin <= last; bin++) sum += spectrum[bin];
  return sum;
}

function accumulate(spectrum, samples, at, window) {
  const size = window.length;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let index = 0; index < size; index++) re[index] = (samples[at + index] ?? 0) * window[index];
  fft(re, im);
  const scale = 1 / size;
  for (let bin = 0; bin < size / 2; bin++) spectrum[bin] += (re[bin] * re[bin] + im[bin] * im[bin]) * scale;
}

const windows = new Map();
function hann(size) {
  if (!windows.has(size)) windows.set(size, Float64Array.from({ length: size }, (_, index) => 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (size - 1))));
  return windows.get(size);
}

/** In-place iterative radix-2 FFT. */
export function fft(re, im) {
  const n = re.length;
  for (let index = 1, swap = 0; index < n; index++) {
    let bit = n >> 1;
    for (; swap & bit; bit >>= 1) swap ^= bit;
    swap ^= bit;
    if (index < swap) {
      [re[index], re[swap]] = [re[swap], re[index]];
      [im[index], im[swap]] = [im[swap], im[index]];
    }
  }
  for (let length = 2; length <= n; length <<= 1) {
    const angle = -2 * Math.PI / length;
    const wRe = Math.cos(angle); const wIm = Math.sin(angle);
    for (let start = 0; start < n; start += length) {
      let curRe = 1; let curIm = 0;
      for (let offset = 0; offset < length / 2; offset++) {
        const a = start + offset; const b = a + length / 2;
        const tRe = re[b] * curRe - im[b] * curIm;
        const tIm = re[b] * curIm + im[b] * curRe;
        re[b] = re[a] - tRe; im[b] = im[a] - tIm;
        re[a] += tRe; im[a] += tIm;
        const next = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = next;
      }
    }
  }
}

/**
 * Lag (in samples) of `moved` relative to `reference`, by cross-correlating
 * the loudest one-second window. Positive: `moved` is late.
 */
export function estimateLag(reference, moved, sampleRate, { maxLagSeconds = 0.1 } = {}) {
  const span = Math.min(sampleRate, Math.floor(reference.length / 2));
  const maxLag = Math.round(maxLagSeconds * sampleRate);
  if (span < 64 || reference.length < span + 2 * maxLag) return 0;
  let bestStart = maxLag; let bestEnergy = -1;
  for (let at = maxLag; at + span + maxLag <= reference.length; at += Math.floor(span / 2)) {
    let energy = 0;
    for (let index = at; index < at + span; index += 4) energy += reference[index] * reference[index];
    if (energy > bestEnergy) { bestEnergy = energy; bestStart = at; }
  }
  let bestLag = 0; let best = -Infinity;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let index = bestStart; index < bestStart + span; index += 2) sum += reference[index] * (moved[index + lag] ?? 0);
    if (sum > best) { best = sum; bestLag = lag; }
  }
  return bestLag;
}

function evenly(values, maximum) {
  if (values.length <= maximum) return values;
  const step = values.length / maximum;
  return Array.from({ length: maximum }, (_, index) => values[Math.floor(index * step)]);
}
function round(value, digits) { const scale = 10 ** digits; return Math.round(value * scale) / scale; }
function dbRound(power) { return round(10 * Math.log10(power + EPS), 1); }
