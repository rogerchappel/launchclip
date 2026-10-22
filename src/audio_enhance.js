// Voice clean-up for recorded speech: the base edit's audio (launchclip
// edit-recording) and supplied voiceovers (src/voice/supplied.js).
//
// The chain, in order, all FFmpeg built-ins and all sample-count preserving:
//
//   0. optional ElevenLabs voice isolation (--voice-isolation elevenlabs;
//      paid, cached by input hash, never called without the flag);
//   1. clean:  high-pass (~80 Hz) for rumble; 50/60 Hz notches on the hum
//              harmonics that were measured; broadband denoise with afftdn
//              using a noise profile sampled from the longest detected
//              silence (a tracked noise floor when there is no usable
//              silence);
//   2. voice:  a small presence lift (~4 kHz), de-ess (deesser), gentle
//              compression (acompressor ~3:1, threshold set from the
//              measured speech level) and, for `podcast`, a dynamic leveller
//              (dynaudnorm) for speakers recorded at different levels;
//   3. level:  a latency-compensated look-ahead limiter and linear gain to
//              -16 LUFS integrated (voice-only intermediates) or a delivery
//              target, true peak -1.5 dBTP.
//
// Every run is measured before and after on the same speech/silence mask:
// noise floor (in detected silences), estimated SNR, integrated LUFS, true
// peak, spectral tilt, sibilance and speech-band energy. Over-processing is
// guarded: when the denoiser costs more than the preset's allowance of
// speech-band energy (noise power removed) or changes the spectral flatness
// of speech regions beyond its limit, the denoise is backed off (half
// strength, then none) and the reason is recorded in audio-enhance.json.
//
// RNNoise (arnndn) is not used: FFmpeg ships no model, and a model would have
// to be bundled with a licence that permits redistribution. The chain stays
// on afftdn, which needs no model file.

import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { probeMedia } from "./media_trim.js";
import { ANALYSIS_SAMPLE_RATE, classifyFrames, compareMeasurements, estimateLag, measureVoice } from "./audio_metrics.js";
import { readWav } from "./voice/words.js";
import { isolateVoiceElevenLabs } from "./voice_isolation.js";

const execute = promisify(execFile);
export const AUDIO_ENHANCE_VERSION = "launchclip.audio-enhance.v1";
export const ENHANCE_PRESET_NAMES = Object.freeze(["light", "podcast", "off"]);
export const VOICE_ISOLATION_CHOICES = Object.freeze(["none", "elevenlabs"]);
export const DEFAULT_ENHANCE_PRESET = "light";
export const VOICE_TARGET_LUFS = -16;
export const VOICE_TRUE_PEAK_DBTP = -1.5;
/** Source files whose contents define the chain (for cache keys). */
export const AUDIO_ENHANCE_ENGINE_FILES = Object.freeze(["audio_enhance.js", "audio_metrics.js", "voice_isolation.js"]);
const PROCESS_RATE = 48000;
const REQUIRED_FILTERS = Object.freeze(["highpass", "bandreject", "afftdn", "asendcmd", "equalizer", "deesser", "agate", "acompressor", "dynaudnorm", "alimiter", "loudnorm", "volume", "atrim", "apad", "concat"]);

export const ENHANCE_PRESETS = Object.freeze({
  light: Object.freeze({
    description: "conservative clean-up: rumble, hum, moderate denoise, light de-ess, 3:1 compression, small presence lift",
    highpass_hz: 80,
    denoise_nr_db: 12,
    max_speech_loss_db: 1.5,
    max_flatness_change_log2: 2,
    presence: { hz: 4000, q: 0.9, gain_db: 1.5 },
    deesser: { intensity: 0.25, harsh_intensity: 0.45, max_ducking: 0.5 },
    expander: { range_db: -6, ratio: 2 },
    compressor: { ratio: 3, threshold_offset_db: -4, attack_ms: 15, release_ms: 180, knee: 3 },
    leveler: null
  }),
  podcast: Object.freeze({
    description: "stronger clean-up and levelling across speakers: firmer denoise, 4:1 compression, dynamic leveller",
    highpass_hz: 85,
    denoise_nr_db: 16,
    max_speech_loss_db: 2.5,
    max_flatness_change_log2: 2.5,
    presence: { hz: 4000, q: 0.9, gain_db: 2.5 },
    deesser: { intensity: 0.35, harsh_intensity: 0.6, max_ducking: 0.6 },
    expander: { range_db: -10, ratio: 2.5 },
    compressor: { ratio: 4, threshold_offset_db: -10, attack_ms: 8, release_ms: 120, knee: 4 },
    leveler: { frame_ms: 250, gauss: 15, peak: 0.9, max_gain: 6 }
  })
});

let availability = null;

/**
 * Feature check for callers such as `launchclip make`: resolves to
 * {available, version, presets, default_preset, voice_isolation, missing}.
 * Never throws; `available` is false when FFmpeg or a required filter is missing.
 */
export async function audioEnhancementAvailable(options = {}) {
  const run = options.run ?? execute;
  const env = options.env ?? process.env;
  if (!options.run && availability) return withIsolation(availability, env);
  let result;
  try {
    const { stdout } = await run("ffmpeg", ["-hide_banner", "-filters"], { maxBuffer: 4 * 1024 * 1024 });
    const names = new Set(String(stdout).split(/\r?\n/).map((line) => line.trim().split(/\s+/)[1]).filter(Boolean));
    const missing = REQUIRED_FILTERS.filter((name) => !names.has(name));
    result = { available: missing.length === 0, missing, reason: missing.length ? `FFmpeg lacks ${missing.join(", ")}` : null };
  } catch (error) {
    result = { available: false, missing: [...REQUIRED_FILTERS], reason: error?.code === "ENOENT" ? "FFmpeg is not installed" : `FFmpeg filter check failed: ${error?.message ?? error}` };
  }
  result = { ...result, version: AUDIO_ENHANCE_VERSION, presets: [...ENHANCE_PRESET_NAMES], default_preset: DEFAULT_ENHANCE_PRESET };
  if (!options.run) availability = result;
  return withIsolation(result, env);
}
function withIsolation(result, env) {
  return { ...result, voice_isolation: { choices: [...VOICE_ISOLATION_CHOICES], elevenlabs: { configured: Boolean(env.ELEVENLABS_API_KEY), paid: true } } };
}

export function validateEnhanceOptions(options = {}) {
  const preset = options.preset ?? DEFAULT_ENHANCE_PRESET;
  if (!ENHANCE_PRESET_NAMES.includes(preset)) throw new Error(`--enhance must be one of ${ENHANCE_PRESET_NAMES.join(", ")}; got ${preset}`);
  const voiceIsolation = options.voiceIsolation ?? "none";
  if (!VOICE_ISOLATION_CHOICES.includes(voiceIsolation)) throw new Error(`--voice-isolation must be one of ${VOICE_ISOLATION_CHOICES.join(", ")}; got ${voiceIsolation}`);
  const targetLufs = options.targetLufs ?? VOICE_TARGET_LUFS;
  if (!Number.isFinite(targetLufs) || targetLufs > -5 || targetLufs < -40) throw new Error("targetLufs must be between -40 and -5 LUFS");
  const truePeak = options.truePeakDbtp ?? VOICE_TRUE_PEAK_DBTP;
  if (!Number.isFinite(truePeak) || truePeak > 0 || truePeak < -9) throw new Error("truePeakDbtp must be between -9 and 0 dBTP");
  return { preset, voiceIsolation, targetLufs, truePeak };
}

/**
 * Enhance the voice audio of `input` (video or audio) into `output`.
 * Video is stream-copied; the audio is replaced by the enhanced track, with
 * the same sample count, so cut points and word timings do not move.
 *
 * options: {preset: light|podcast|off, voiceIsolation: none|elevenlabs,
 *   targetLufs (-16), truePeakDbtp (-1.5), report (path | false; default
 *   audio-enhance.json beside output), channels, env, fetch, cacheDir,
 *   notice(line), signal}
 * adapters: {run, probe, isolate}
 * Returns the report (also written to `report`).
 */
export async function enhanceRecordingAudio(input, output, options = {}, adapters = {}) {
  const { preset, voiceIsolation, targetLufs, truePeak } = validateEnhanceOptions(options);
  const source = path.resolve(input);
  const destination = path.resolve(output);
  if (source === destination) throw new Error("Audio enhancement output must differ from its input");
  const run = adapters.run ?? options.run ?? execute;
  const notice = options.notice ?? (() => {});
  const reportPath = options.report === false ? null : path.resolve(options.report ?? path.join(path.dirname(destination), "audio-enhance.json"));
  const probe = await (adapters.probe ?? probeMedia)(source);
  const audioStream = probe.streams?.find((stream) => stream.codec_type === "audio");
  if (!audioStream) throw new Error("Audio enhancement requires an audio stream");
  const hasVideo = Boolean(probe.streams?.some((stream) => stream.codec_type === "video" && stream.disposition?.attached_pic !== 1));
  const report = {
    schema_version: AUDIO_ENHANCE_VERSION, status: "pending", preset, voice_isolation: { requested: voiceIsolation, status: voiceIsolation === "none" ? "not-requested" : "pending" },
    input: source, output: destination, loudness_target_lufs: targetLufs, true_peak_target_dbtp: truePeak,
    chain: [], detections: {}, guard: { checks: [], backoffs: [] }, metrics: {}, notes: []
  };
  await mkdir(path.dirname(destination), { recursive: true });
  if (preset === "off" && voiceIsolation === "none") {
    await replaceWith(destination, async (temporary) => copyFile(source, temporary));
    report.status = "off";
    report.notes.push("--enhance off: audio copied unchanged");
    if (reportPath) await writeReport(reportPath, report);
    return { ...report, report: reportPath };
  }
  const temporary = await mkdtemp(path.join(os.tmpdir(), "launchclip-enhance-"));
  const ff = (args) => run("ffmpeg", ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", ...args], { maxBuffer: 16 * 1024 * 1024, signal: options.signal });
  const file = (name) => path.join(temporary, name);
  try {
    // Decode once: 48 kHz mono float is the working format for every stage.
    await ff(["-i", source, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", String(PROCESS_RATE), "-c:a", "pcm_f32le", file("source.wav")]);
    const sourceAnalysis = await analysisSamples(file("source.wav"), file("analysis.wav"), ff);
    const sourceLength = (await readWav(file("source.wav"))).samples.length;
    let mask;
    try { mask = classifyFrames(sourceAnalysis, ANALYSIS_SAMPLE_RATE); }
    catch (error) { return await skipped(`audio cannot be measured: ${error.message}`); }
    if (!mask.dynamic || !mask.speech.some(Boolean)) return await skipped("no speech level distinct from the noise floor was found; nothing to enhance safely");
    const before = measureVoice(sourceAnalysis, ANALYSIS_SAMPLE_RATE, { mask });
    report.metrics.before = { ...before, ...await measureLoudness(file("source.wav"), run, options.signal) };
    report.detections.silences = mask.silences.length;
    report.detections.silence_seconds = before.silence_seconds;

    let working = file("source.wav");
    if (voiceIsolation === "elevenlabs") {
      try {
        await ff(["-i", working, "-c:a", "pcm_s16le", file("isolation-input.wav")]);
        const receipt = await (adapters.isolate ?? isolateVoiceElevenLabs)(file("isolation-input.wav"), file("isolated-raw.wav"), {
          env: options.env, fetch: options.fetch, cacheDir: options.cacheDir, notice, signal: options.signal, run, sampleRate: PROCESS_RATE, durationSeconds: sourceLength / PROCESS_RATE
        });
        // Re-align to the source sample grid: decoders and codecs may add
        // priming, and the edit's cut points must not move.
        const isolatedAnalysis = await analysisSamples(file("isolated-raw.wav"), file("analysis-iso.wav"), ff);
        const lag = estimateLag(sourceAnalysis, isolatedAnalysis, ANALYSIS_SAMPLE_RATE);
        await alignAudio(file("isolated-raw.wav"), file("isolated.wav"), Math.round(lag * PROCESS_RATE / ANALYSIS_SAMPLE_RATE), sourceLength, ff);
        working = file("isolated.wav");
        const isolatedAligned = await analysisSamples(working, file("analysis-iso2.wav"), ff);
        report.metrics.after_isolation = measureVoice(isolatedAligned, ANALYSIS_SAMPLE_RATE, { mask });
        report.voice_isolation = { requested: voiceIsolation, ...receipt, alignment_shift_ms: round(lag / ANALYSIS_SAMPLE_RATE * 1000, 2) };
        report.chain.push({ stage: "isolation", provider: "elevenlabs", status: receipt.status });
      } catch (error) {
        report.voice_isolation = { requested: voiceIsolation, status: "failed", error: String(error?.message ?? error) };
        report.notes.push("voice isolation failed; continuing with the FFmpeg chain only");
        notice(`voice isolation: failed (${report.voice_isolation.error}); continuing with the FFmpeg chain only`);
      }
    }
    if (preset === "off") {
      // Isolation only: level and deliver it.
      const leveled = await levelStage(working, file("final.wav"), { targetLufs, truePeak, run, ff, signal: options.signal });
      report.chain.push(leveled.entry);
      return await finish(file("final.wav"));
    }
    const settings = ENHANCE_PRESETS[preset];
    const working0 = report.metrics.after_isolation ?? before;
    const hum = working0.hum;
    report.detections.hum = hum;
    const notches = hum.detected ? hum.harmonics.filter((entry) => entry.notch).map((entry) => entry.hz) : [];
    const profile = noiseProfileWindow(mask.silences, sourceLength);
    report.detections.noise_profile = profile ? { start_seconds: round(profile.start / PROCESS_RATE, 3), end_seconds: round(profile.end / PROCESS_RATE, 3) } : null;
    if (!profile) report.notes.push("no detected silence of 0.25 s or more: afftdn tracks the noise floor instead of sampling a profile");

    // 1. Clean stage, with the over-processing guard.
    const strengths = [settings.denoise_nr_db, round(settings.denoise_nr_db / 2, 1), 0];
    let clean = null;
    for (const [attempt, nr] of strengths.entries()) {
      const out = file(`clean-${attempt}.wav`);
      const filters = cleanFilters(settings, { notches, nr, noiseFloor: working0.noise_floor_dbfs, profile });
      await runCleanStage(working, out, filters, profile && nr > 0 ? profile : null, ff);
      const cleanAnalysis = await analysisSamples(out, file(`analysis-clean-${attempt}.wav`), ff);
      const measured = measureVoice(cleanAnalysis, ANALYSIS_SAMPLE_RATE, { mask });
      const change = compareMeasurements(working0, measured);
      const speechLoss = change.speech_band_db === null ? 0 : -change.speech_band_db;
      const flatness = change.speech_flatness_log2 ?? 0;
      const problems = [];
      if (nr > 0 && speechLoss > settings.max_speech_loss_db) problems.push(`denoise removed ${speechLoss.toFixed(2)} dB of speech-band energy (limit ${settings.max_speech_loss_db} dB)`);
      if (nr > 0 && Math.abs(flatness) > settings.max_flatness_change_log2) problems.push(`speech spectral flatness changed by ${flatness.toFixed(2)} octaves (limit ±${settings.max_flatness_change_log2})`);
      report.guard.checks.push({ attempt: attempt + 1, denoise_nr_db: nr, speech_band_change_db: change.speech_band_db, flatness_change_log2: flatness, noise_floor_change_db: change.noise_floor_db, passed: problems.length === 0 });
      if (!problems.length) { clean = { file: out, measured, filters, nr }; break; }
      const next = strengths[attempt + 1];
      report.guard.backoffs.push({ from_nr_db: nr, to_nr_db: next ?? null, reasons: problems });
      notice(`audio enhance: backing off denoise (${problems.join("; ")})`);
    }
    if (!clean) throw new Error("Audio enhancement guard rejected every clean-up strength");
    report.chain.push({ stage: "clean", filters: clean.filters.map(describeFilter), denoise_nr_db: clean.nr, noise_profile: Boolean(profile && clean.nr > 0), hum_notches_hz: notches });

    // 2. Voice stage.
    const harsh = clean.measured.sibilance_ratio_db !== null && clean.measured.sibilance_ratio_db > HARSH_SIBILANCE_DB;
    const voice = voiceFilters(settings, { speechLevel: clean.measured.speech_level_dbfs, noiseFloor: clean.measured.noise_floor_dbfs, harsh });
    await ff(["-i", clean.file, "-af", voice.map((filter) => filter.text).join(","), "-c:a", "pcm_f32le", file("voice.wav")]);
    report.detections.harsh_sibilance = harsh;
    report.chain.push({ stage: "voice", filters: voice.map(describeFilter) });

    // 3. Level stage.
    const leveled = await levelStage(file("voice.wav"), file("final.wav"), { targetLufs, truePeak, run, ff, signal: options.signal });
    report.chain.push(leveled.entry);
    return await finish(file("final.wav"));

    async function finish(finalFile) {
      // Sample-count and alignment proof before anything is published.
      let final = finalFile;
      const finalLength = (await readWav(final)).samples.length;
      const finalAnalysis0 = await analysisSamples(final, file("analysis-final0.wav"), ff);
      const lag = estimateLag(sourceAnalysis, finalAnalysis0, ANALYSIS_SAMPLE_RATE, { maxLagSeconds: 0.05 });
      if (finalLength !== sourceLength || Math.abs(lag) > 1) {
        await alignAudio(final, file("final-aligned.wav"), Math.round(lag * PROCESS_RATE / ANALYSIS_SAMPLE_RATE), sourceLength, ff);
        final = file("final-aligned.wav");
        report.notes.push(`realigned the enhanced audio by ${round(lag / ANALYSIS_SAMPLE_RATE * 1000, 2)} ms and ${sourceLength - finalLength} samples to keep the source timing`);
      }
      const finalAnalysis = final === finalFile ? finalAnalysis0 : await analysisSamples(final, file("analysis-final.wav"), ff);
      report.metrics.after = { ...measureVoice(finalAnalysis, ANALYSIS_SAMPLE_RATE, { mask }), ...await measureLoudness(final, run, options.signal) };
      report.metrics.change = { ...compareMeasurements(report.metrics.before, report.metrics.after), integrated_lufs: diff(report.metrics.before.integrated_lufs, report.metrics.after.integrated_lufs), true_peak_dbtp: diff(report.metrics.before.true_peak_dbtp, report.metrics.after.true_peak_dbtp) };
      report.alignment = { samples: sourceLength, sample_rate: PROCESS_RATE, residual_lag_ms: round(lag / ANALYSIS_SAMPLE_RATE * 1000, 2) };
      await deliver(source, final, destination, { hasVideo, channels: options.channels ?? (hasVideo ? Math.min(2, Number(audioStream.channels) || 1) : 1), ff });
      report.status = "enhanced";
      if (reportPath) await writeReport(reportPath, report);
      return { ...report, report: reportPath };
    }
    async function skipped(reason) {
      await replaceWith(destination, async (temporaryOut) => copyFile(source, temporaryOut));
      report.status = "skipped";
      report.notes.push(reason);
      notice(`audio enhance: skipped (${reason}); audio copied unchanged`);
      if (reportPath) await writeReport(reportPath, report);
      return { ...report, report: reportPath };
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/** Sibilance above this (5-10 kHz energy relative to 300-3400 Hz, dB) is harsh. */
export const HARSH_SIBILANCE_DB = -12;

/** FFmpeg filters for the clean stage: high-pass, hum notches, denoise. */
export function cleanFilters(settings, { notches = [], nr, noiseFloor, profile }) {
  const filters = [{ name: "highpass", text: `highpass=f=${settings.highpass_hz}:poles=2`, purpose: "rumble" }];
  for (const hz of notches) filters.push({ name: "bandreject", text: `bandreject=f=${hz}:width_type=q:width=12`, purpose: `hum notch ${hz} Hz` });
  if (nr > 0) {
    // afftdn reaches its full `nr` only when nf sits about 10 dB above the
    // broadband noise RMS; lower values cap the reduction at a few dB.
    const nf = clamp(Math.round((noiseFloor ?? -60) + 10), -80, -20);
    filters.push(profile
      ? { name: "afftdn", text: `afftdn=nr=${nr}:nf=${nf}:tn=0`, purpose: "broadband denoise (profile sampled from detected silence)" }
      : { name: "afftdn", text: `afftdn=nr=${nr}:nf=${nf}:tn=1`, purpose: "broadband denoise (tracked noise floor)" });
  }
  return filters;
}

/** FFmpeg filters for the voice stage: presence, de-ess, compression, leveller, pause expander. */
export function voiceFilters(settings, { speechLevel, noiseFloor, harsh }) {
  const { presence, deesser, expander, compressor, leveler } = settings;
  const threshold = clamp((speechLevel ?? -20) + compressor.threshold_offset_db, -50, -6);
  const filters = [
    { name: "equalizer", text: `equalizer=f=${presence.hz}:t=q:w=${presence.q}:g=${presence.gain_db}`, purpose: "presence lift" },
    { name: "deesser", text: `deesser=i=${harsh ? deesser.harsh_intensity : deesser.intensity}:m=${deesser.max_ducking}:f=0.5:s=o`, purpose: harsh ? "de-ess (harsh sibilance measured)" : "de-ess" },
    { name: "acompressor", text: `acompressor=threshold=${linear(threshold).toFixed(6)}:ratio=${compressor.ratio}:attack=${compressor.attack_ms}:release=${compressor.release_ms}:knee=${compressor.knee}:makeup=1`, purpose: `compression ${compressor.ratio}:1 above ${threshold.toFixed(1)} dBFS` }
  ];
  // A gentle range-limited downward expander: the compressor and loudness
  // gain would otherwise lift the residual noise in pauses. It
  // only runs when speech stands at least 20 dB above the cleaned floor, and
  // its threshold stays 18 dB under the speech level, so it never chops words.
  if (expander && Number.isFinite(speechLevel) && Number.isFinite(noiseFloor) && speechLevel - noiseFloor >= 20) {
    const gateDb = Math.min(noiseFloor + 8, speechLevel - 18);
    filters.push({ name: "agate", text: `agate=threshold=${linear(gateDb).toFixed(6)}:ratio=${expander.ratio}:range=${linear(expander.range_db).toFixed(6)}:attack=10:release=250:knee=2.828:detection=rms`, purpose: `pause expander below ${gateDb.toFixed(1)} dBFS (at most ${-expander.range_db} dB)` });
  }
  if (leveler) {
    // After the expander: frames under the threshold (pauses) are not raised.
    const gate = linear(clamp((noiseFloor ?? -60) + 10, -70, -30));
    filters.push({ name: "dynaudnorm", text: `dynaudnorm=f=${leveler.frame_ms}:g=${leveler.gauss}:p=${leveler.peak}:m=${leveler.max_gain}:t=${gate.toFixed(6)}`, purpose: "level across speakers" });
  }
  return filters;
}

async function levelStage(input, output, { targetLufs, truePeak, run, ff, signal }) {
  const measured = await measureLoudness(input, run, signal);
  if (!Number.isFinite(measured.integrated_lufs) || measured.integrated_lufs < -69) throw new Error("Audio enhancement cannot level silent audio");
  // Limit before the gain so the post-gain peak lands under the target; the
  // limiter lowers the loudness a little, so correct the gain and rerun from
  // the same input (at most three passes).
  let correction = 0;
  let result = null;
  let gain = 0; let ceiling = 0; let limit = 1;
  for (let pass = 0; pass < 3; pass++) {
    gain = targetLufs - measured.integrated_lufs + correction;
    ceiling = Math.min(-0.1, truePeak - gain - 0.5);
    limit = clamp(linear(ceiling), 0.0625, 1);
    await ff(["-i", input, "-af", `alimiter=limit=${limit.toFixed(6)}:level=0:attack=5:release=50:latency=1,volume=${gain.toFixed(2)}dB`, "-c:a", "pcm_f32le", output]);
    result = await measureLoudness(output, run, signal);
    const miss = targetLufs - result.integrated_lufs;
    if (!Number.isFinite(miss) || Math.abs(miss) <= 0.3) break;
    correction += miss;
  }
  let trim = 0;
  if (result.true_peak_dbtp > truePeak + 0.1) {
    // Inter-sample peaks the limiter could not see: pull the whole take down.
    trim = truePeak - result.true_peak_dbtp - 0.05;
    const adjusted = `${output}.trim.wav`;
    await ff(["-i", output, "-af", `volume=${trim.toFixed(2)}dB`, "-c:a", "pcm_f32le", adjusted]);
    await rename(adjusted, output);
    result = await measureLoudness(output, run, signal);
  }
  return { entry: { stage: "level", filters: [
    { name: "alimiter", filter: `alimiter=limit=${limit.toFixed(6)}:level=0:attack=5:release=50:latency=1`, purpose: `look-ahead limiter at ${ceiling.toFixed(1)} dBFS before gain (latency-compensated)` },
    { name: "volume", filter: `volume=${gain.toFixed(2)}dB`, purpose: `linear gain to ${targetLufs} LUFS` }
  ], input_lufs: measured.integrated_lufs, gain_db: round(gain, 2), true_peak_trim_db: round(trim, 2), output_lufs: result.integrated_lufs, output_true_peak_dbtp: result.true_peak_dbtp } };
}

/** Integrated loudness and true peak through FFmpeg's EBU R128 meter. */
export async function measureLoudness(file, run = execute, signal) {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostdin", "-i", file, "-map", "0:a:0", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"], { maxBuffer: 16 * 1024 * 1024, signal });
  const text = String(stderr ?? "");
  const start = text.lastIndexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("FFmpeg loudnorm produced no measurement");
  const json = JSON.parse(text.slice(start, end + 1));
  const value = (key) => { const number = Number(json[key]); return Number.isFinite(number) ? round(number, 2) : null; };
  return { integrated_lufs: value("input_i"), true_peak_dbtp: value("input_tp"), loudness_range_lu: value("input_lra") };
}

/** The middle of the longest detected silence, as a sample range (0.25-2 s). */
export function noiseProfileWindow(silences, totalSamples, sampleRate = PROCESS_RATE) {
  const longest = [...silences].sort((a, b) => (b.end_seconds - b.start_seconds) - (a.end_seconds - a.start_seconds))[0];
  if (!longest) return null;
  const start = longest.start_seconds + 0.05;
  const end = Math.min(longest.end_seconds - 0.05, start + 2);
  if (end - start < 0.25) return null;
  return { start: Math.round(start * sampleRate), end: Math.min(totalSamples, Math.round(end * sampleRate)) };
}

/** afftdn delays its output by half its 50 ms window (1200 samples at 48 kHz). */
export const AFFTDN_LATENCY_SAMPLES = Math.floor(0.025 * PROCESS_RATE);

async function runCleanStage(input, output, filters, profile, ff) {
  const chain = filters.map((filter) => filter.text);
  const denoise = chain.findIndex((text) => text.startsWith("afftdn"));
  if (denoise < 0) {
    await ff(["-i", input, "-af", chain.join(","), "-c:a", "pcm_f32le", output]);
    return;
  }
  // afftdn is not latency-compensated: pad its input by the latency and drop
  // that many samples from the front of its output, so nothing moves.
  const latency = AFFTDN_LATENCY_SAMPLES;
  const before = chain.slice(0, denoise);
  const after = chain.slice(denoise + 1);
  if (!profile) {
    const graph = `[0:a]${[...before, `apad=pad_len=${latency}`, chain[denoise], `atrim=start_sample=${latency}`, "asetpts=N/SR/TB", ...after].join(",")}[out]`;
    await ff(["-i", input, "-filter_complex", graph, "-map", "[out]", "-c:a", "pcm_f32le", output]);
    return;
  }
  // Prepend the silence sample, let afftdn learn its noise profile from it
  // (sn start/stop), then cut the sample off again: the whole take is
  // denoised with the learned profile and keeps its exact length.
  const length = profile.end - profile.start;
  const seconds = length / PROCESS_RATE;
  const sampling = `asendcmd=c='0.0 afftdn sn start; ${(seconds - 0.01).toFixed(4)} afftdn sn stop'`;
  const graph = `[1:a]atrim=start_sample=${profile.start}:end_sample=${profile.end},asetpts=N/SR/TB[noise];[noise][0:a]concat=n=2:v=0:a=1,${[...before, `apad=pad_len=${latency}`, sampling, chain[denoise], `atrim=start_sample=${length + latency}`, "asetpts=N/SR/TB", ...after].join(",")}[out]`;
  await ff(["-i", input, "-i", input, "-filter_complex", graph, "-map", "[out]", "-c:a", "pcm_f32le", output]);
}

async function alignAudio(input, output, lagSamples, totalSamples, ff) {
  // Positive lag: the audio is late, so drop its first samples; negative: pad the start.
  const shift = lagSamples > 0 ? `atrim=start_sample=${lagSamples},asetpts=N/SR/TB,` : lagSamples < 0 ? `adelay=delays=${-lagSamples}S:all=1,` : "";
  await ff(["-i", input, "-af", `${shift}apad=whole_len=${totalSamples},atrim=end_sample=${totalSamples}`, "-ac", "1", "-ar", String(PROCESS_RATE), "-c:a", "pcm_f32le", output]);
}

async function analysisSamples(input, output, ff) {
  await ff(["-i", input, "-ac", "1", "-ar", String(ANALYSIS_SAMPLE_RATE), "-c:a", "pcm_f32le", output]);
  return (await readWav(output)).samples;
}

async function deliver(source, finalWav, destination, { hasVideo, channels, ff }) {
  const extension = path.extname(destination).toLowerCase();
  await replaceWith(destination, async (temporary) => {
    const audio = extension === ".wav" ? ["-c:a", "pcm_s16le"] : extension === ".flac" ? ["-c:a", "flac"] : extension === ".mp3" ? ["-c:a", "libmp3lame", "-b:a", "192k"] : ["-c:a", "aac", "-b:a", "192k"];
    const container = [".mp4", ".mov", ".m4v", ".m4a"].includes(extension) ? ["-movflags", "+faststart"] : [];
    if (hasVideo && ![".wav", ".flac", ".mp3", ".m4a"].includes(extension)) {
      await ff(["-i", source, "-i", finalWav, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", ...audio, "-ac", String(channels), "-ar", String(PROCESS_RATE), ...container, temporary]);
    } else {
      await ff(["-i", finalWav, "-map", "0:a:0", ...audio, "-ac", String(channels), "-ar", String(PROCESS_RATE), ...container, temporary]);
    }
  });
}

async function replaceWith(destination, write) {
  const extension = path.extname(destination);
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination, extension)}.enhance-${process.pid}-${Date.now()}${extension}`);
  try { await write(temporary); await rename(temporary, destination); }
  finally { await rm(temporary, { force: true }); }
}

async function writeReport(file, report) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  try { await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`); await rename(temporary, file); }
  finally { await rm(temporary, { force: true }); }
}

function describeFilter(filter) { return { name: filter.name, filter: filter.text, purpose: filter.purpose }; }
function linear(db) { return 10 ** (db / 20); }
function clamp(value, low, high) { return Math.min(high, Math.max(low, value)); }
function round(value, digits) { const scale = 10 ** digits; return Math.round(value * scale) / scale; }
function diff(before, after) { return before == null || after == null ? null : round(after - before, 2); }
