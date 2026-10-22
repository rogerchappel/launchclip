// Supplied voiceover preparation (RFC §9).
//
// `create({ source })` returns a provider whose synthesize() does not speak
// the text. It prepares the supplied recording instead:
//
//   1. decode to 48 kHz mono;
//   2. find pauses with the recording-edit silence analysis
//      (analyzeRecordingAudio: noise-floor-relative threshold);
//   3. remove leading and trailing silence (keeping 50 ms of air) and tighten
//      every interior pause longer than 0.6 s to 0.35 s, with 5 ms fades at
//      each cut;
//   4. clean up and level the voice with the shared enhancement chain
//      (src/audio_enhance.js, preset `light` by default: high-pass, hum
//      notches, profile denoise, presence, de-ess, gentle compression) to
//      about -17 LUFS integrated, -1.5 dBTP, because mono voice plays about
//      3 LU louder as stereo; `enhance: "off"` keeps the plain two-pass
//      loudnorm (linear gain);
//   5. transcribe the prepared audio with the repo's local Whisper path
//      (transcribeRecording), align the recognised words back to `text` when
//      given, pull word boundaries off quiet audio (Whisper tends to start a
//      word at the end of the previous one, swallowing the pause), and snap
//      onsets to RMS energy onsets within 60 ms.

import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { enhanceRecordingAudio } from "../audio_enhance.js";
import { analyzeRecordingAudio } from "../recording_audio.js";
import { normalizeRecordingTranscript } from "../recording_edit.js";
import {
  alignWordsToText, detectOnsets, envelopeLevels, finalizeWords, onsetError, readWav,
  rmsEnvelope, snapOnsets, trimWordsToVoiced, writeWav
} from "./words.js";

const execute = promisify(execFile);
export const SUPPLIED_SAMPLE_RATE = 48000;
export const PAUSE_LIMIT_SECONDS = 0.6;
export const PAUSE_TARGET_SECONDS = 0.35;
export const TARGET_LUFS = -17;
export const TARGET_TRUE_PEAK = -1.5;
const EDGE_AIR_SECONDS = 0.05;
const FADE_SECONDS = 0.005;

export function create(options = {}) {
  const run = options.run ?? execute;
  return {
    name: "supplied",
    async synthesize({ text, outFile, signal } = {}) {
      const source = options.source;
      if (!source) throw new Error("Supplied voice needs create({ source })");
      if (!outFile) throw new Error("Supplied voice needs outFile");
      if (path.resolve(source) === path.resolve(outFile)) throw new Error("Supplied voice output must not overwrite the source recording");
      const temporary = await mkdtemp(path.join(os.tmpdir(), "launchclip-voice-"));
      try {
        const decoded = path.join(temporary, "decoded.wav");
        await run("ffmpeg", ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", source, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", String(SUPPLIED_SAMPLE_RATE), "-c:a", "pcm_f32le", decoded], { signal, maxBuffer: 8 * 1024 * 1024 });
        const audio = await readWav(decoded);
        const analysis = await (options.analyze ?? analyzeRecordingAudio)(decoded, { durationSeconds: audio.duration, silenceDuration: PAUSE_LIMIT_SECONDS }, { run });
        const plan = planPauseEdit(audio.samples, audio.sampleRate, analysis);
        const tightened = applyPauseEdit(audio.samples, audio.sampleRate, plan.keep);
        const tightenedFile = path.join(temporary, "tightened.wav");
        await writeWav(tightenedFile, tightened, audio.sampleRate);
        const { loudness, enhancement } = await prepareLoudness(tightenedFile, outFile, { preset: options.enhance ?? "light", run, signal, enhance: options.enhanceAudio, notice: options.notice });
        const prepared = await readWav(outFile);
        const transcript = await (options.transcribe ?? defaultTranscribe)(outFile, { model: options.model ?? "base.en", language: options.language ?? "en", signal });
        const recognised = normalizeRecordingTranscript(transcript).map((word) => ({ text: word.word, start: word.start, end: word.end }));
        const aligned = typeof text === "string" && text.trim() ? alignWordsToText(recognised, text) : recognised;
        const envelope = rmsEnvelope(prepared.samples, prepared.sampleRate);
        const levels = envelopeLevels(envelope);
        const { words: voiced, moved } = trimWordsToVoiced(aligned, envelope, Math.max(levels.floor + 8, levels.speech - 35));
        const onsets = detectOnsets(prepared.samples, prepared.sampleRate);
        const { words: snapped, snapped: snappedCount } = snapOnsets(voiced, onsets, { windowSeconds: 0.06 });
        const words = finalizeWords(snapped, prepared.duration);
        return {
          file: outFile, words, sampleRate: prepared.sampleRate, duration: prepared.duration,
          provider: "supplied", source,
          prep: {
            source_duration_seconds: audio.duration,
            leading_trim_seconds: plan.leading, trailing_trim_seconds: plan.trailing,
            pauses_tightened: plan.tightened, keep_ranges: plan.keep, removed_seconds: audio.duration - tightened.length / audio.sampleRate,
            loudness_target_lufs: TARGET_LUFS, loudness_measured_lufs: loudness.output_i, true_peak_dbtp: loudness.output_tp,
            enhancement
          },
          timing: { method: typeof text === "string" && text.trim() ? "asr-aligned-to-text" : "asr", trimmed_to_voiced: moved, snapped_words: snappedCount, onset_error_ms: msOrNull(onsetError(words, onsets).mean_seconds) }
        };
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    }
  };
}

/**
 * Keep ranges (seconds) for the tightened voiceover: edges trimmed to the
 * first and last audible frame plus 50 ms, and each interior silence longer
 * than 0.6 s shortened to 0.35 s by removing its middle.
 */
export function planPauseEdit(samples, sampleRate, analysis, { limit = PAUSE_LIMIT_SECONDS, target = PAUSE_TARGET_SECONDS } = {}) {
  const duration = samples.length / sampleRate;
  const envelope = rmsEnvelope(samples, sampleRate);
  const threshold = Number.isFinite(analysis?.threshold_db) ? analysis.threshold_db : Math.max(envelopeLevels(envelope).floor + 10, -60);
  let first = 0;
  let last = envelope.db.length - 1;
  while (first < last && envelope.db[first] < threshold) first++;
  while (last > first && envelope.db[last] < threshold) last--;
  if (first >= last) throw new Error("Supplied voiceover has no audible speech");
  const voicedStart = Math.max(0, first * envelope.hopSeconds - EDGE_AIR_SECONDS);
  const voicedEnd = Math.min(duration, last * envelope.hopSeconds + 2 * envelope.offsetSeconds + EDGE_AIR_SECONDS);
  const keep = [];
  let cursor = voicedStart;
  let tightened = 0;
  const intervals = (analysis?.silence_intervals ?? [])
    .map((interval) => ({ start: interval.start_seconds, end: interval.end_seconds }))
    .filter((interval) => interval.end - interval.start > limit && interval.start > voicedStart && interval.end < voicedEnd)
    .sort((a, b) => a.start - b.start);
  for (const interval of intervals) {
    const half = target / 2;
    const cutStart = interval.start + half;
    const cutEnd = interval.end - half;
    if (cutStart <= cursor || cutEnd <= cutStart) continue;
    keep.push({ start: cursor, end: cutStart });
    cursor = cutEnd;
    tightened += 1;
  }
  keep.push({ start: cursor, end: voicedEnd });
  return { keep: keep.filter((range) => range.end > range.start), leading: voicedStart, trailing: duration - voicedEnd, tightened };
}

/** Concatenate keep ranges with short fades at every cut to avoid clicks. */
export function applyPauseEdit(samples, sampleRate, keep) {
  const fade = Math.max(1, Math.round(FADE_SECONDS * sampleRate));
  const pieces = keep.map((range) => samples.slice(Math.round(range.start * sampleRate), Math.round(range.end * sampleRate)));
  const total = pieces.reduce((sum, piece) => sum + piece.length, 0);
  const result = new Float32Array(total);
  let offset = 0;
  pieces.forEach((piece, index) => {
    const copy = Float32Array.from(piece);
    const length = Math.min(fade, Math.floor(copy.length / 2));
    for (let sample = 0; sample < length; sample++) {
      const gain = sample / length;
      if (index > 0) copy[sample] *= gain;
      if (index < pieces.length - 1) copy[copy.length - 1 - sample] *= gain;
    }
    result.set(copy, offset);
    offset += copy.length;
  });
  return result;
}

/**
 * Level the tightened voiceover to TARGET_LUFS. With a preset (default
 * light) the shared enhancement chain cleans and levels it in one pass; when
 * the chain is off or cannot measure the take, two-pass loudnorm levels it.
 */
export async function prepareLoudness(input, output, { preset = "light", run = execute, signal, enhance, notice } = {}) {
  if (preset !== "off") {
    const report = await (enhance ?? enhanceRecordingAudio)(input, output, { preset, targetLufs: TARGET_LUFS, truePeakDbtp: TARGET_TRUE_PEAK, report: false, signal, notice }, { run });
    const summary = { preset, status: report.status, chain: (report.chain ?? []).map((stage) => stage.stage), backoffs: report.guard?.backoffs ?? [], notes: report.notes ?? [], before: pick(report.metrics?.before), after: pick(report.metrics?.after) };
    if (report.status === "enhanced") return { loudness: { input_i: report.metrics?.before?.integrated_lufs ?? null, output_i: report.metrics?.after?.integrated_lufs ?? null, output_tp: report.metrics?.after?.true_peak_dbtp ?? null }, enhancement: summary };
    const loudness = await normalizeLoudness(input, output, run, signal);
    return { loudness, enhancement: summary };
  }
  return { loudness: await normalizeLoudness(input, output, run, signal), enhancement: { preset: "off", status: "off" } };
}
function pick(metrics) {
  if (!metrics) return null;
  const keys = ["noise_floor_dbfs", "snr_db", "integrated_lufs", "true_peak_dbtp", "spectral_tilt_db_per_octave"];
  return Object.fromEntries(keys.map((key) => [key, metrics[key] ?? null]));
}

/** Two-pass EBU R128 loudnorm to TARGET_LUFS with linear gain; returns measured output. */
export async function normalizeLoudness(input, output, run = execute, signal) {
  const filter = `loudnorm=I=${TARGET_LUFS}:TP=${TARGET_TRUE_PEAK}:LRA=11`;
  const first = await run("ffmpeg", ["-hide_banner", "-nostdin", "-i", input, "-af", `${filter}:print_format=json`, "-f", "null", "-"], { signal, maxBuffer: 8 * 1024 * 1024 });
  const measured = parseLoudnormJson(first.stderr);
  const second = await run("ffmpeg", ["-hide_banner", "-nostdin", "-y", "-i", input, "-af", `${filter}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true:print_format=json`, "-ac", "1", "-ar", String(SUPPLIED_SAMPLE_RATE), "-c:a", "pcm_s16le", output], { signal, maxBuffer: 8 * 1024 * 1024 });
  const result = parseLoudnormJson(second.stderr);
  return { input_i: Number(measured.input_i), output_i: Number(result.output_i), output_tp: Number(result.output_tp), normalization_type: result.normalization_type };
}

export function parseLoudnormJson(stderr) {
  const text = String(stderr ?? "");
  const start = text.lastIndexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("FFmpeg loudnorm produced no measurement");
  return JSON.parse(text.slice(start, end + 1));
}

async function defaultTranscribe(file, options) {
  const { transcribeRecording } = await import("../recording_workflow.js");
  return transcribeRecording(file, options);
}

function msOrNull(seconds) { return seconds === null ? null : Math.round(seconds * 10000) / 10; }
