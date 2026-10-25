// Listen-check numbers for synthesized audio: level, crest, spectrum and
// tail, measured from the decoded PCM. Used by scripts/sound-audition.mjs and
// the media tests to catch harsh, clipped, dull or broken sounds.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const RATE = 48000;
const FFT = 2048;

/** Mono float samples of a file at 48 kHz (both channels averaged), plus the stereo pair. */
export async function decodePcm(file) {
  const { stdout } = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-ac', '2', '-ar', String(RATE), '-f', 'f32le', '-'], { encoding: 'buffer', maxBuffer: 1 << 30 });
  const data = new Float32Array(stdout.buffer, stdout.byteOffset, stdout.byteLength / 4);
  const frames = data.length / 2;
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let i = 0; i < frames; i++) { left[i] = data[2 * i]; right[i] = data[2 * i + 1]; }
  return { left, right, rate: RATE };
}

function fftMag(frame) {
  // Radix-2 FFT of a real frame (Hann-windowed) → magnitudes of bins 0..N/2.
  const n = frame.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = frame[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const step = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k++) {
        const wr = Math.cos(step * k), wi = Math.sin(step * k);
        const a = start + k, b = a + size / 2;
        const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
  const mags = new Float64Array(n / 2 + 1);
  for (let k = 0; k <= n / 2; k++) mags[k] = Math.hypot(re[k], im[k]);
  return mags;
}

const db = (value) => (value > 0 ? 20 * Math.log10(value) : -Infinity);
const round = (value, digits = 1) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : null);

/**
 * {duration, peak_db, rms_db, crest_db, clipped, dc, centroid_hz, rolloff_hz,
 * hf_ratio (energy share above 8 kHz), harsh_ratio (2.5–5 kHz share, where
 * the ear is most sensitive), low_ratio (below 150 Hz), active_seconds,
 * tail_db (level of the last 3 ms), width (side/mid energy)}.
 */
export function analysePcm({ left, right, rate = RATE }) {
  const n = left.length;
  let peak = 0, sum = 0, dc = 0, clipped = 0, mid2 = 0, side2 = 0;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const m = (left[i] + right[i]) / 2;
    mono[i] = m;
    const a = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    if (a > peak) peak = a;
    if (a >= 0.999) clipped++;
    sum += m * m; dc += m;
    mid2 += m * m; const s = (left[i] - right[i]) / 2; side2 += s * s;
  }
  const rms = Math.sqrt(sum / Math.max(1, n));
  const bins = new Float64Array(FFT / 2 + 1);
  let active = 0;
  const gate = Math.max(peak * 0.01, 1e-5);
  for (let start = 0; start + FFT <= n; start += FFT / 2) {
    const frame = mono.subarray(start, start + FFT);
    let e = 0;
    for (const v of frame) e += v * v;
    if (Math.sqrt(e / FFT) < gate) continue;
    active += FFT / 2;
    const mags = fftMag(frame);
    for (let k = 0; k < mags.length; k++) bins[k] += mags[k] * mags[k];
  }
  let total = 0, weighted = 0, hf = 0, harsh = 0, low = 0;
  const hz = (k) => (k * rate) / FFT;
  for (let k = 1; k < bins.length; k++) {
    total += bins[k]; weighted += bins[k] * hz(k);
    if (hz(k) > 8000) hf += bins[k];
    if (hz(k) >= 2500 && hz(k) <= 5000) harsh += bins[k];
    if (hz(k) < 150) low += bins[k];
  }
  const BANDS = [[0, 150], [150, 500], [500, 2000], [2000, 5000], [5000, 24000]];
  const shares = BANDS.map(([lo, hi]) => {
    let e = 0;
    for (let k = 1; k < bins.length; k++) if (hz(k) >= lo && hz(k) < hi) e += bins[k];
    return total ? Number((e / total).toFixed(3)) : 0;
  });
  let acc = 0, rolloff = 0;
  for (let k = 1; k < bins.length; k++) { acc += bins[k]; if (acc >= total * 0.85) { rolloff = hz(k); break; } }
  const tail = mono.subarray(Math.max(0, n - Math.round(rate * 0.003)));
  let tailPeak = 0;
  for (const v of tail) tailPeak = Math.max(tailPeak, Math.abs(v));
  return {
    duration: round(n / rate, 3),
    peak_db: round(db(peak)),
    rms_db: round(db(rms)),
    crest_db: round(db(peak) - db(rms)),
    clipped,
    dc: round(dc / Math.max(1, n), 5),
    centroid_hz: total ? Math.round(weighted / total) : null,
    rolloff_hz: Math.round(rolloff),
    hf_ratio: total ? round(hf / total, 3) : null,
    harsh_ratio: total ? round(harsh / total, 3) : null,
    low_ratio: total ? round(low / total, 3) : null,
    active_seconds: round(active / rate, 2),
    tail_db: round(db(tailPeak)),
    width: mid2 ? round(Math.sqrt(side2 / mid2), 3) : 0,
    // Energy share per band: <150, 150–500, 500–2k, 2–5k, 5k+ Hz.
    bands: shares
  };
}

export async function analyseFile(file) {
  return analysePcm(await decodePcm(file));
}

/** Integrated loudness (LUFS) and true peak (dBTP) by FFmpeg's ebur128. */
export async function loudness(file) {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { maxBuffer: 1 << 26 });
  const summary = stderr.slice(stderr.lastIndexOf('Summary:'));
  const lufs = Number(summary.match(/I:\s*(-?[\d.]+|-inf) LUFS/)?.[1]);
  const tp = Number(summary.match(/Peak:\s*(-?[\d.]+|-inf) dBFS/)?.[1]);
  const lra = Number(summary.match(/LRA:\s*(-?[\d.]+) LU/)?.[1]);
  return { lufs: Number.isFinite(lufs) ? lufs : null, true_peak_db: Number.isFinite(tp) ? tp : null, lra: Number.isFinite(lra) ? lra : null };
}

/**
 * Problems a listener would hear in one effect, as short strings: clipping,
 * a DC offset, a cut-off tail, harshness (too much 2.5–5 kHz or 8 kHz+ energy
 * relative to the family's register), silence.
 */
export function effectProblems(stats, { family = '' } = {}) {
  const problems = [];
  if (stats.clipped > 0) problems.push(`clips (${stats.clipped} samples at full scale)`);
  if (Math.abs(stats.dc) > 0.01) problems.push(`DC offset ${stats.dc}`);
  if (stats.peak_db === null || stats.peak_db < -40) problems.push('silent');
  // A riser ends on its hit by design.
  if (!/riser/.test(family) && stats.tail_db !== null && stats.tail_db > -30) problems.push(`tail cut off (last 3 ms at ${stats.tail_db} dB)`);
  // Bright by design: clicks, ticks, keys, snaps, sparkles, shutters, scribbles.
  const bright = /tick|click|key|snap|sparkle|shutter|scribble|page|glitch|ping|cash/.test(family);
  if (stats.hf_ratio > (bright ? 0.55 : 0.35)) problems.push(`harsh top end (${Math.round(stats.hf_ratio * 100)}% above 8 kHz)`);
  // Presence-band energy only hurts when it lasts: a 40 ms tick is fine.
  if (stats.active_seconds >= 0.2 && stats.centroid_hz > 2500 && stats.harsh_ratio > (bright ? 0.75 : 0.6)) problems.push(`piercing presence (${Math.round(stats.harsh_ratio * 100)}% in 2.5–5 kHz)`);
  return problems;
}
