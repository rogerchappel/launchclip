import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { DEFAULT_NARRATED_MUSIC_VOLUME } from "./production_contracts.js";
import { PLATFORM_LOUDNESS } from "./production_profiles.js";
import { decodeAudio } from "./music/beats.js";
import { fft, percussiveSpectra } from "./scripts/audio-features.mjs";

const execFileAsync = promisify(execFile);

export async function analyzeProductionAudio(videoPath, manifestPath, options = {}, adapters = {}) {
  const run = adapters.run ?? runCommand;
  const manifest = manifestPath ? JSON.parse(await readFile(path.resolve(manifestPath), "utf8")) : { voiceover: null, music: null, sfx_manifest: null };
  const sfx = manifest.sfx_manifest ? JSON.parse(await readFile(path.resolve(manifest.sfx_manifest), "utf8")) : { cues: [] };
  const probe = JSON.parse((await run("ffprobe", ["-v", "error", "-show_entries", "stream=index,codec_type,codec_name,channels,sample_rate:format=duration", "-of", "json", path.resolve(videoPath)])).stdout);
  const audioStream = (probe.streams ?? []).find((entry) => entry.codec_type === "audio") ?? null;
  const expectedAudio = Boolean(manifest.voiceover || manifest.music || (sfx.cues ?? []).length);
  const output = audioStream ? await loudnessAndPeaks(path.resolve(videoPath), run) : null;
  const [voiceover, music] = await Promise.all([
    manifest.voiceover?.path ? loudnessAndPeaks(path.resolve(manifest.voiceover.path), run) : null,
    manifest.music?.path ? loudnessAndPeaks(path.resolve(manifest.music.path), run) : null
  ]);
  const cues = (sfx.cues ?? []).map((cue) => cueEvidence(cue, output?.peaks ?? []));
  const report = {
    schema_version: "launchclip.render-audio.v1",
    video: path.resolve(videoPath),
    duration_seconds: Number(probe.format?.duration ?? 0),
    expected_audio: expectedAudio,
    stream: audioStream,
    output,
    sources: { voiceover, music, music_gain_db: round(20 * Math.log10(Number(options.musicVolume ?? DEFAULT_NARRATED_MUSIC_VOLUME))) },
    cues,
  };
  report.quality = evaluateAudioQuality(report, options);
  return report;
}

export async function writeAudioReport(videoPath, manifestPath, outputPath, options = {}, adapters = {}) {
  const report = await analyzeProductionAudio(videoPath, manifestPath, options, adapters);
  await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await writeFile(path.resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export function evaluateAudioQuality(report, options = {}) {
  const findings = [];
  if (report.expected_audio && !report.stream) findings.push(finding("audio-stream", "blocking", "Rendered video has no audio stream despite a produced audio manifest."));
  const ceiling = Number(options.maximumTruePeakDbfs ?? PLATFORM_LOUDNESS.true_peak_dbtp);
  if (report.output?.true_peak_dbfs != null && report.output.true_peak_dbfs > ceiling) {
    findings.push(finding("clipping", "major", `Rendered true peak is ${report.output.true_peak_dbfs} dBFS; keep it at or below ${ceiling} dBTP so platform encoding does not clip.`));
  }
  const target = Number(options.targetIntegratedLufs ?? PLATFORM_LOUDNESS.integrated_lufs);
  const tolerance = Number(options.loudnessToleranceLu ?? PLATFORM_LOUDNESS.tolerance_lu);
  const integrated = report.output?.integrated_lufs;
  if (report.sources.voiceover && Number.isFinite(integrated) && Math.abs(integrated - target) > tolerance) {
    findings.push(finding("loudness", "major", `Rendered program loudness is ${integrated} LUFS; master to ${target} LUFS (±${tolerance} LU) so platform normalization neither buries nor squashes the mix.`));
  }
  if (report.sources.voiceover && report.sources.music) {
    const adjustedMusic = report.sources.music.integrated_lufs + report.sources.music_gain_db;
    const margin = report.sources.voiceover.integrated_lufs - adjustedMusic;
    if (margin < Number(options.minimumVoiceMusicMarginDb ?? 6)) findings.push(finding("masking", "major", `Estimated voice-to-music margin is ${round(margin)} dB; expected at least ${options.minimumVoiceMusicMarginDb ?? 6} dB.`));
    if (margin > Number(options.maximumVoiceMusicMarginDb ?? 14)) findings.push(finding("music-presence", "major", `Estimated voice-to-music margin is ${round(margin)} dB; expected at most ${options.maximumVoiceMusicMarginDb ?? 14} dB so the music bed remains audible.`));
  }
  if (report.sources.voiceover && report.output?.silence_ratio > Number(options.maximumNarratedSilenceRatio ?? .25)) {
    findings.push(finding("silence", "major", `Rendered audio is near-silent for ${(report.output.silence_ratio * 100).toFixed(1)}% of analyzed windows while narration is expected.`));
  }
  if (report.cues.length && report.cues.filter((cue) => cue.transient_delta_db >= Number(options.minimumCueTransientDb ?? 1)).length / report.cues.length < .5) {
    findings.push(finding("sfx-sync", "minor", "Fewer than half of planned SFX cues have a measurable transient at their scheduled time."));
  }
  return { ok: !findings.some((entry) => entry.severity === "blocking" || entry.severity === "major"), findings };
}

async function loudnessAndPeaks(filePath, run) {
  const loudness = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", filePath, "-filter_complex", "ebur128=peak=true", "-f", "null", "-"]);
  const peakFrames = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", filePath, "-af", "asetnsamples=n=2048,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.Peak_level:file=-", "-f", "null", "-"]);
  const text = `${loudness.stdout ?? ""}\n${loudness.stderr ?? ""}`;
  const integrated = [...text.matchAll(/\bI:\s*(-?(?:\d+(?:\.\d+)?|inf))\s+LUFS/g)].at(-1)?.[1];
  const truePeak = [...text.matchAll(/\bPeak:\s*(-?(?:\d+(?:\.\d+)?|inf))\s+dBFS/g)].at(-1)?.[1];
  const peaks = parsePeakSeries(`${peakFrames.stdout ?? ""}\n${peakFrames.stderr ?? ""}`);
  const finitePeaks = peaks.map((entry) => entry.peak_dbfs).filter(Number.isFinite);
  return {
    integrated_lufs: numeric(integrated),
    true_peak_dbfs: numeric(truePeak),
    silence_ratio: peaks.length ? round(peaks.filter((entry) => !Number.isFinite(entry.peak_dbfs) || entry.peak_dbfs <= -50).length / peaks.length, 4) : null,
    median_peak_dbfs: finitePeaks.length ? round(quantile(finitePeaks.sort((a, b) => a - b), .5)) : null,
    peaks
  };
}

export function parsePeakSeries(text) {
  const output = [];
  let time = null;
  for (const line of String(text).split(/\r?\n/)) {
    const frame = line.match(/\bpts_time:([-+0-9.eE]+)/);
    if (frame) time = Number(frame[1]);
    const peak = line.match(/^lavfi\.astats\.Overall\.Peak_level=(-?(?:\d+(?:\.\d+)?|inf))/);
    if (peak && Number.isFinite(time)) output.push({ at_seconds: round(time, 4), peak_dbfs: numeric(peak[1]) });
  }
  return output;
}

function cueEvidence(cue, peaks) {
  const at = Number(cue.at_seconds);
  const near = peaks.filter((entry) => Math.abs(entry.at_seconds - at) <= .12).map((entry) => entry.peak_dbfs).filter(Number.isFinite);
  const baseline = peaks.filter((entry) => Math.abs(entry.at_seconds - at) > .2 && Math.abs(entry.at_seconds - at) <= .7).map((entry) => entry.peak_dbfs).filter(Number.isFinite);
  const peak = near.length ? Math.max(...near) : null;
  const background = baseline.length ? quantile(baseline.sort((a, b) => a - b), .5) : null;
  return { id: cue.id, shot_id: cue.shot_id, at_seconds: at, intent: cue.intent, peak_dbfs: peak, baseline_dbfs: background, transient_delta_db: peak != null && background != null ? round(peak - background) : 0 };
}

function numeric(value) {
  if (value == null || /inf/i.test(String(value))) return String(value).startsWith("-") ? -Infinity : Infinity;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function finding(category, severity, message) { return { category, severity, message }; }
function round(value, places = 3) { const factor = 10 ** places; return Math.round(Number(value) * factor) / factor; }
function quantile(sorted, q) { const position = (sorted.length - 1) * q; const lower = Math.floor(position); const upper = Math.ceil(position); return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower); }
async function runCommand(command, args) { return execFileAsync(command, args, { maxBuffer: 1024 * 1024 * 128 }); }

// Tempo, beat grid, SFX typing and cut sync of a reference's soundtrack
// (docs/PLAN_AND_PACE_RFC.md §4.3). Ported from rea-video's audio.py
// (Apache-2.0); the FFT and the harmonic/percussive split are the ones
// AUDIO_FEATURES.json uses (src/scripts/audio-features.mjs).
export const AUDIO_RHYTHM = Object.freeze({
  rate: 22050, // analysis sample rate (Hz)
  nFft: 1024, // STFT window
  hop: 256, // 11.6 ms per onset frame
  minBpm: 60, maxBpm: 190, // tempo search range
  doubleBelow: 75, // a slower pulse is read as half time
  // No beat when either is low. rea-video needs both low and sets strength at
  // 0.2; speech has a high percussive share (≈ 0.8), and a dozen irregular keys
  // in silence reach 0.22 while click tracks sit at 0.55 and above.
  noBeatShare: 0.045, // p90 percussive energy share below this…
  noBeatStrength: 0.3, // …or autocorrelation strength at the tempo lag below this
  snapHops: 3, // each grid beat snaps to the onset peak within ±3 hops
  sfxGap: 0.06, // onset peaks at least this far apart (s)
  sfxStrength: 3, // onset ÷ local 90th percentile over ±1 s
  sfxStrengthUnderMusic: 6, // stricter when a beat is present
  sfxFloorDb: -30, // louder than the loudest frame minus this
  sfxBeatGap: 0.05, // an onset this close to a beat is the music
  typeWindow: 0.12, // spectrum read over the 120 ms after onset
  decayDb: 15, // decay = time to fall this far from the onset peak
  typingCount: 4, typingSpan: 0.6, // ≥ 4 click/pop/hit within ±0.6 s is typing
  onPicture: 0.12, // an SFX this close to a cut or visual event is on-picture
  onBeat: 0.07, // a cut this close to a beat is on-beat
  silenceSeconds: 0.4, silenceDb: -30, // near silence: ≥ 0.4 s at ≤ peak − 30 dB
  // Speech (when no spans are given): voiced frames (pitch 80–400 Hz with
  // normalised autocorrelation ≥ 0.5, half the energy under 1 kHz, within
  // 40 dB of the peak) merged across 0.5 s gaps (padded 0.2 s) into phrases of ≥ 3 voiced
  // runs (each ≥ 3 frames), ≥ 0.6 s and ≥ 30% voiced: syllables, so a decaying
  // pitched effect or a burst of keys is not a voice.
  voiceHz: [80, 400], voicedCorrelation: 0.5, voiceLowHz: 1000, voiceLowShare: 0.5, voiceFloorDb: -40,
  voiceGap: 0.5, voiceRuns: 3, voiceRunFrames: 3, voiceCoverage: 0.3, voiceSeconds: 0.6, voicePad: 0.2, // pad: consonants either side of the voicing
  // Frame f's onset peaks when the attack sits this far into its window; measured on clicks (render_audio_rhythm.test.js).
  onsetLead: 0.0375
});

export const SFX_TYPES = Object.freeze(["whoosh", "ding", "impact", "click", "pop", "typing", "hit"]);

/** Magnitude STFT of mono samples at AUDIO_RHYTHM.rate (Hann, no padding). */
export function stft(samples, { nFft = AUDIO_RHYTHM.nFft, hop = AUDIO_RHYTHM.hop } = {}) {
  const window = Float64Array.from({ length: nFft }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / nFft));
  const re = new Float64Array(nFft), im = new Float64Array(nFft);
  const spectra = [];
  for (let start = 0; start + nFft <= samples.length; start += hop) {
    for (let i = 0; i < nFft; i += 1) { re[i] = samples[start + i] * window[i]; im[i] = 0; }
    fft(re, im);
    const magnitude = new Float64Array(nFft / 2 + 1);
    for (let k = 0; k <= nFft / 2; k += 1) magnitude[k] = Math.hypot(re[k], im[k]);
    spectra.push(magnitude);
  }
  return spectra;
}

/** [[start, end]] seconds of voiced phrases, from magnitude spectra (see AUDIO_RHYTHM.voice*). */
export function speechSpans(spectra, { rate = AUDIO_RHYTHM.rate, nFft = AUDIO_RHYTHM.nFft, hop = AUDIO_RHYTHM.hop } = {}) {
  const R = AUDIO_RHYTHM;
  const hopSeconds = hop / rate, binHz = rate / nFft;
  const lags = [Math.floor(rate / R.voiceHz[1]), Math.ceil(rate / R.voiceHz[0])];
  // The Hann window's own autocorrelation, divided out so long lags are not penalised.
  const wr = new Float64Array(nFft), wi = new Float64Array(nFft);
  for (let i = 0; i < nFft; i += 1) wr[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / nFft);
  fft(wr, wi);
  for (let k = 0; k < nFft; k += 1) { wr[k] = wr[k] ** 2 + wi[k] ** 2; wi[k] = 0; }
  fft(wr, wi);
  const energies = spectra.map((spectrum) => spectrum.reduce((sum, value) => sum + value * value, 0));
  const floor = 10 * Math.log10(Math.max(...energies) + 1e-12) + R.voiceFloorDb;
  const re = new Float64Array(nFft), im = new Float64Array(nFft);
  const voiced = spectra.map((spectrum, f) => {
    if (10 * Math.log10(energies[f] + 1e-12) < floor) return false;
    let low = 0;
    for (let k = 0; k < spectrum.length; k += 1) if (k * binHz < R.voiceLowHz) low += spectrum[k] ** 2;
    if (low < R.voiceLowShare * energies[f]) return false;
    for (let k = 0; k <= nFft / 2; k += 1) { re[k] = spectrum[k] ** 2; if (k && k < nFft / 2) re[nFft - k] = re[k]; }
    im.fill(0);
    fft(re, im);
    let best = 0;
    for (let lag = lags[0]; lag <= lags[1]; lag += 1) best = Math.max(best, (re[lag] / re[0]) / (wr[lag] / wr[0]));
    return best >= R.voicedCorrelation;
  });
  const runs = [];
  for (let f = 0; f < voiced.length; f += 1) {
    if (!voiced[f]) continue;
    const start = f;
    while (f < voiced.length && voiced[f]) f += 1;
    if (f - start >= R.voiceRunFrames) runs.push([start * hopSeconds, f * hopSeconds + nFft / rate, (f - start) * hopSeconds]);
  }
  const phrases = [];
  for (const run of runs) {
    const last = phrases.at(-1);
    if (last && run[0] - last.end <= R.voiceGap) { last.end = run[1]; last.runs += 1; last.voiced += run[2]; } else phrases.push({ start: run[0], end: run[1], runs: 1, voiced: run[2] });
  }
  return phrases.filter((phrase) => phrase.runs >= R.voiceRuns && phrase.end - phrase.start >= R.voiceSeconds && phrase.voiced >= R.voiceCoverage * (phrase.end - phrase.start)).map((phrase) => [round(Math.max(0, phrase.start - R.voicePad)), round(phrase.end + R.voicePad)]);
}

/**
 * Tempo, beats, SFX and near silences of mono samples at AUDIO_RHYTHM.rate.
 * options.speech: [[start, end]] seconds where a voice talks (no SFX there);
 * detected by speechSpans() when not given.
 * → {tempo_bpm, beat_strength, percussive_share_p90, beats, sfx: [{at_seconds, type, strength, decay_seconds, hf, centroid_hz, tonality}], near_silences, duration_seconds}
 */
export function analyzeRhythm(samples, options = {}) {
  const R = AUDIO_RHYTHM;
  const hopSeconds = R.hop / R.rate;
  const duration = samples.length / R.rate;
  const spectra = stft(samples);
  const frames = spectra.length;
  if (frames < 8) return { tempo_bpm: null, beat_strength: 0, percussive_share_p90: 0, beats: [], sfx: [], near_silences: [], duration_seconds: round(duration) };
  const speech = options.speech ?? speechSpans(spectra);
  const percussive = percussiveSpectra(spectra);
  const energy = spectra.map((spectrum) => spectrum.reduce((sum, value) => sum + value * value, 0));
  const share = percussive.map((spectrum, f) => (energy[f] > 0 ? spectrum.reduce((sum, value) => sum + value * value, 0) / energy[f] : 0));
  const level = percussive.map((spectrum) => Math.log1p(spectrum.reduce((sum, value) => sum + value, 0)));
  const onset = level.map((value, f) => (f ? Math.max(0, value - level[f - 1]) : 0));
  // Frame f's onset is the change into it; its time is the start of that frame's window plus the measured lead.
  const timeOf = (f) => f * hopSeconds + R.onsetLead;
  const db = energy.map((value) => 10 * Math.log10(value + 1e-12));
  const loudest = Math.max(...db);

  // Tempo: autocorrelation of the mean-removed onset curve.
  const mean = onset.reduce((sum, value) => sum + value, 0) / frames;
  const centred = onset.map((value) => value - mean);
  const ac0 = centred.reduce((sum, value) => sum + value * value, 0) || 1;
  const lagMin = Math.floor(60 / R.maxBpm / hopSeconds), lagMax = Math.min(frames - 2, Math.ceil(60 / R.minBpm / hopSeconds));
  const ac = (lag) => { let sum = 0; for (let i = 0; i + lag < frames; i += 1) sum += centred[i] * centred[i + lag]; return sum; };
  let best = -Infinity, bestLag = lagMin;
  for (let lag = lagMin; lag <= lagMax; lag += 1) { const value = ac(lag); if (value > best) { best = value; bestLag = lag; } }
  const strength = Math.max(0, best / ac0);
  const shareP90 = quantile([...share].sort((a, b) => a - b), 0.9);
  const hasBeat = lagMax > lagMin && shareP90 >= R.noBeatShare && strength >= R.noBeatStrength;
  let beats = [], tempo = null;
  if (hasBeat) {
    let period = bestLag;
    if (60 / (period * hopSeconds) < R.doubleBelow) period /= 2;
    // Grid: the period (±2%, 0.05% steps) and phase whose comb sums most onset energy.
    const at = (x) => { const i = Math.floor(x); return i + 1 < frames ? onset[i] + (onset[i + 1] - onset[i]) * (x - i) : 0; };
    let top = -Infinity, grid = { period, phase: 0 };
    for (let p = period * 0.98; p <= period * 1.02; p += period * 0.0005) {
      for (let phase = 0; phase < p; phase += 0.5) {
        let sum = 0;
        for (let x = phase; x < frames - 1; x += p) sum += at(x);
        if (sum > top) { top = sum; grid = { period: p, phase }; }
      }
    }
    tempo = round(60 / (grid.period * hopSeconds), 2);
    for (let x = grid.phase; x < frames - 1; x += grid.period) {
      const centre = Math.round(x);
      let peak = centre;
      for (let f = Math.max(1, centre - R.snapHops); f <= Math.min(frames - 1, centre + R.snapHops); f += 1) if (onset[f] > onset[peak]) peak = f;
      beats.push(round(timeOf(peak)));
    }
  }

  // SFX: strong, isolated onset peaks outside speech and off the beat.
  const radius = Math.round(1 / hopSeconds);
  const candidates = [];
  for (let f = 1; f < frames - 1; f += 1) {
    if (!(onset[f] > 0 && onset[f] >= onset[f - 1] && onset[f] > onset[f + 1])) continue;
    const local = quantile(onset.slice(Math.max(0, f - radius), f + radius + 1).sort((a, b) => a - b), 0.9);
    const ratio = onset[f] / (local + 1e-9);
    if (ratio < (hasBeat ? R.sfxStrengthUnderMusic : R.sfxStrength)) continue;
    const typeFrames = Math.max(1, Math.round(R.typeWindow / hopSeconds));
    const peakDb = Math.max(...db.slice(f, f + typeFrames));
    if (peakDb < loudest + R.sfxFloorDb) continue;
    const t = timeOf(f);
    if (speech.some(([start, end]) => t >= start && t <= end)) continue;
    if (beats.some((beat) => Math.abs(beat - t) < R.sfxBeatGap)) continue;
    candidates.push({ f, t, ratio, peakDb });
  }
  const kept = [];
  for (const candidate of [...candidates].sort((a, b) => b.ratio - a.ratio)) if (!kept.some((other) => Math.abs(other.t - candidate.t) < R.sfxGap)) kept.push(candidate);
  kept.sort((a, b) => a.t - b.t);
  const binHz = R.rate / R.nFft;
  const sfx = kept.map(({ f, t, ratio, peakDb }) => {
    const typeFrames = Math.max(1, Math.round(R.typeWindow / hopSeconds));
    const sum = new Float64Array(spectra[0].length);
    for (let g = f; g < Math.min(frames, f + typeFrames); g += 1) for (let k = 0; k < sum.length; k += 1) sum[k] += spectra[g][k] ** 2;
    let total = 0, high = 0, moment = 0, max = 0, amplitude = 0;
    for (let k = 1; k < sum.length; k += 1) {
      total += sum[k]; moment += sum[k] * k * binHz; if (k * binHz >= 4000) high += sum[k];
      max = Math.max(max, Math.sqrt(sum[k])); amplitude += Math.sqrt(sum[k]);
    }
    let end = f + db.slice(f, f + typeFrames).indexOf(peakDb);
    while (end < frames && db[end] > peakDb - R.decayDb) end += 1;
    const features = {
      decay_seconds: round((end - f) * hopSeconds),
      hf: round(total ? high / total : 0),
      centroid_hz: Math.round(total ? moment / total : 0),
      tonality: round(amplitude ? max / (amplitude / (sum.length - 1)) : 0, 1)
    };
    return { at_seconds: round(t), type: sfxType(features), strength: round(Math.min(ratio, 99), 2), ...features };
  });
  for (const entry of sfx) {
    const near = sfx.filter((other) => ["click", "pop", "hit", "typing"].includes(other.type) && Math.abs(other.at_seconds - entry.at_seconds) <= R.typingSpan);
    if (["click", "pop", "hit"].includes(entry.type) && near.length >= R.typingCount) for (const other of near) other.type = "typing";
  }

  // Near silences: interior runs ≥ 0.4 s at or below peak − 30 dB.
  const near_silences = [];
  for (let f = 0; f < frames; f += 1) {
    if (db[f] > loudest + R.silenceDb) continue;
    const start = f;
    while (f < frames && db[f] <= loudest + R.silenceDb) f += 1;
    if (start > 0 && f < frames && (f - start) * hopSeconds >= R.silenceSeconds) near_silences.push([round(start * hopSeconds), round(f * hopSeconds)]);
  }
  return { tempo_bpm: tempo, beat_strength: round(strength), percussive_share_p90: round(shareP90, 4), beats, sfx, near_silences, speech, duration_seconds: round(duration) };
}

// SFX type thresholds. rea-video's were set on library SFX; ours are band
// limited (most families keep < 5% of their energy above 4 kHz), so the
// brightness tests also accept a centroid and whoosh also accepts "noisy and
// sustained" (low tonality). Calibrated on the default kit (render_audio_rhythm.test.js).
export const SFX_TYPE_RULES = Object.freeze({
  whooshDecay: 0.25, whooshHf: 0.25, // rea-video: long and airy
  whooshNoisyDecay: 0.18, whooshNoisyTonality: 15, // ours: long and noisy, not ringing
  clickDecay: 0.08, clickHf: 0.3, clickCentroid: 550, // short, and bright or above the low mids
  dingTonality: 25, dingCentroid: 1000, // a ringing partial above 1 kHz (rea-video: 1,200 Hz)
  impactCentroid: 350, // energy sits in the lows
  popHf: 0.2, popTonality: 15
});

/** The §4.3 type of one SFX from its decay, high-frequency share, centroid and tonality. */
export function sfxType({ decay_seconds: decay, hf, centroid_hz: centroid, tonality }) {
  const T = SFX_TYPE_RULES;
  if (decay < T.clickDecay && (hf > T.clickHf || centroid > T.clickCentroid)) return "click";
  if ((decay > T.whooshDecay && hf > T.whooshHf) || (decay > T.whooshNoisyDecay && tonality < T.whooshNoisyTonality && centroid >= T.impactCentroid)) return "whoosh";
  if (tonality > T.dingTonality && centroid > T.dingCentroid) return "ding";
  if (centroid < T.impactCentroid) return "impact";
  if (hf > T.popHf || tonality > T.popTonality) return "pop";
  return "hit";
}

/** The type each of our SFX families should measure as (null: no single type: a riser has no attack, a tally is a run of blips). */
export const SFX_FAMILY_TYPES = Object.freeze({
  whoosh: "whoosh", swipe: "whoosh", slide: "whoosh", "page-turn": "whoosh",
  impact: "impact", subdrop: "impact", thud: "impact", door: "impact", footstep: "impact",
  ding: "ding", chime: "ding", ping: "ding", notification: "ding", success: "ding", cash: "ding", shimmer: "ding", sparkle: "ding",
  click: "click", tick: "click", keystroke: "click", "keystroke-space": "click", "keystroke-enter": "click", snap: "click", "camera-shutter": "click",
  pop: "pop", boing: "pop",
  riser: null, tally: null, "tape-stop": null, glitch: null, "error-buzz": null, "pen-scribble": null
});

/**
 * Cut and SFX sync against the beat grid (§4.3). cuts: hard cut times;
 * events: every visual event (cuts included) an SFX may land on.
 * → {cuts_on_beat_ratio, cuts_on_beat_chance, cuts_on_beat_lift, beat_synced, sfx_on_picture_ratio}
 */
export function rhythmSync({ beats = [], sfx = [], cuts = [], events = cuts, duration }) {
  const R = AUDIO_RHYTHM;
  const near = (times, t, within) => times.some((other) => Math.abs(other - t) <= within);
  const picture = [...cuts, ...events];
  const sfx_on_picture_ratio = sfx.length && picture.length ? round(sfx.filter((entry) => near(picture, entry.at_seconds, R.onPicture)).length / sfx.length) : null;
  if (!beats.length || !cuts.length || !(duration > 0)) return { cuts_on_beat_ratio: null, cuts_on_beat_chance: null, cuts_on_beat_lift: null, beat_synced: false, sfx_on_picture_ratio };
  const ratio = cuts.filter((cut) => near(beats, cut, R.onBeat)).length / cuts.length;
  const chance = Math.min(1, (beats.length / duration) * 2 * R.onBeat);
  return {
    cuts_on_beat_ratio: round(ratio),
    cuts_on_beat_chance: round(chance),
    cuts_on_beat_lift: round(ratio / chance, 2),
    beat_synced: cuts.length >= 4 && ratio > Math.max(0.5, 1.8 * chance),
    sfx_on_picture_ratio
  };
}

/** Decode a file's audio and run analyzeRhythm (null when it has no audio). */
export async function analyzeRhythmFile(file, options = {}) {
  const { samples } = await decodeAudio(file, { rate: AUDIO_RHYTHM.rate });
  return samples.length ? analyzeRhythm(samples, options) : null;
}
