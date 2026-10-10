import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { probeMedia } from "./media_trim.js";

const execute = promisify(execFile);
export const RECORDING_AUDIO_VERSION = "launchclip.recording-audio.v1";

/** Read a bounded mono RMS envelope and measured quiet intervals locally. */
export async function analyzeRecordingAudio(input, options = {}, adapters = {}) {
  const duration = positive(options.durationSeconds ?? Number((await (adapters.probeMedia ?? probeMedia)(input)).format?.duration), "durationSeconds");
  const silenceDuration = positive(options.silenceDuration ?? 0.4, "silenceDuration");
  const padding = nonnegative(options.silencePadding ?? 0.08, "silencePadding");
  const maximum = options.maxEnvelopePoints ?? 6000;
  if (!Number.isInteger(maximum) || maximum < 2 || maximum > 6000) throw new Error("maxEnvelopePoints must be an integer between 2 and 6000");
  const samples = Math.max(1600, Math.ceil(duration * 16000 / maximum));
  const step = samples / 16000;
  const run = adapters.run ?? execute;
  const common = ["-hide_banner", "-nostdin", "-nostats", "-i", input, "-t", String(duration), "-map", "0:a:0", "-vn"];
  const envelope = await run("ffmpeg", [...common, "-af", `aresample=16000,aformat=channel_layouts=mono,asetnsamples=n=${samples}:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-`, "-f", "null", "-"], { maxBuffer: 8 * 1024 * 1024 });
  const waveform = parseRmsEnvelope(envelope.stdout, { durationSeconds: duration, stepSeconds: step, maxPoints: maximum });
  const levels = waveform.map((point) => point.rms_db).sort((a, b) => a - b);
  if (!levels.length || levels.at(-1) <= -75) throw new Error("Recording audio contains no audible signal; cannot create a speech edit");
  const threshold = options.thresholdDb === undefined
    ? Math.max(-60, Math.min(-30, percentile(levels, 0.9) - 24, percentile(levels, 0.2) + 8))
    : options.thresholdDb;
  if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold < -80 || threshold > -10) throw new Error("thresholdDb must be finite between -80 and -10 dB");
  const quiet = await run("ffmpeg", [...common, "-af", `aresample=16000,aformat=channel_layouts=mono,silencedetect=noise=${threshold}dB:d=${silenceDuration}`, "-f", "null", "-"], { maxBuffer: 8 * 1024 * 1024 });
  const silence = parseAudioSilence(quiet.stderr, duration);
  if (silence.length === 1 && silence[0].start_seconds === 0 && silence[0].end_seconds >= duration - 0.001) throw new Error("Recording audio is entirely below the silence threshold");
  return { schema_version: RECORDING_AUDIO_VERSION, source_duration_seconds: duration, threshold_db: threshold, silence_duration_seconds: silenceDuration, silence_padding_seconds: padding, envelope_step_seconds: step, silence_intervals: silence, waveform };
}

export function parseRmsEnvelope(output, { durationSeconds, stepSeconds, maxPoints = 6000 }) {
  const duration = positive(durationSeconds, "durationSeconds");
  const step = positive(stepSeconds, "stepSeconds");
  if (!Number.isInteger(maxPoints) || maxPoints < 1) throw new Error("maxPoints must be positive");
  const points = [];
  let start = null;
  for (const line of String(output).split(/\r?\n/)) {
    const frame = line.match(/\bpts_time:([-+0-9.eE]+)/);
    if (frame) { start = Number(frame[1]); continue; }
    const rms = line.match(/lavfi\.astats\.Overall\.RMS_level=([^\s]+)/);
    if (!rms) continue;
    let db = Number(rms[1]);
    if (rms[1].toLowerCase() === "-inf") db = -120;
    if (!Number.isFinite(start) || start < 0 || !Number.isFinite(db)) throw new Error("Invalid FFmpeg RMS envelope timing or level");
    if (start >= duration) continue;
    if (points.length >= maxPoints) throw new Error("FFmpeg envelope exceeds bounded point budget");
    if (points.length && start <= points.at(-1).start_seconds) throw new Error("FFmpeg envelope timestamps must increase");
    const level = Math.max(-120, Math.min(0, db));
    points.push({ start_seconds: start, end_seconds: Math.min(duration, start + step), rms_db: level, rms: level <= -120 ? 0 : 10 ** (level / 20) });
    start = null;
  }
  return points;
}

export function parseAudioSilence(output, durationSeconds) {
  const duration = positive(durationSeconds, "durationSeconds");
  const intervals = [];
  let start = null;
  for (const line of String(output).split(/\r?\n/)) {
    const beginning = line.match(/silence_start:\s*([-+0-9.eE]+)/);
    if (beginning) {
      start = Number(beginning[1]);
      if (!Number.isFinite(start) || start < 0 || start > duration + 0.001) throw new Error("Invalid detected silence start");
    }
    const ending = line.match(/silence_end:\s*([-+0-9.eE]+)/);
    if (ending && start !== null) {
      const end = Number(ending[1]);
      if (!Number.isFinite(end) || end <= start || end > duration + 0.1) throw new Error("Invalid detected silence end");
      intervals.push({ start_seconds: start, end_seconds: Math.min(duration, end) });
      start = null;
    }
  }
  if (start !== null && start < duration) intervals.push({ start_seconds: start, end_seconds: duration });
  return union(intervals).map(({ start, end }) => ({ start_seconds: start, end_seconds: end }));
}

/** Align silent ASR boundaries, then trim measured quiet outside voiced words. */
export function refineRecordingEditPlan(plan, analysis, { silencePadding = 0.08 } = {}) {
  const padding = nonnegative(silencePadding, "silencePadding");
  const duration = positive(plan?.source_duration_seconds, "source duration");
  if (Math.abs(analysis?.source_duration_seconds - duration) > 0.001 || !Number.isFinite(analysis?.source_duration_seconds) || !Array.isArray(analysis.silence_intervals)) throw new Error("Audio analysis must match the source recording");
  if (!Number.isFinite(analysis.threshold_db) || analysis.threshold_db < -80 || analysis.threshold_db > -10) throw new Error("Audio analysis requires a valid silence threshold");
  if (!Array.isArray(plan.kept_segments) || !plan.kept_segments.length || !Array.isArray(plan.words) || !plan.words.length || !Array.isArray(plan.removed_segments)) throw new Error("Recording plan requires kept ranges and accepted spoken words");
  let clock = 0;
  let previous = 0;
  const keeps = plan.kept_segments.map((segment) => {
    const range = checkedRange(segment.source_start_seconds, segment.source_end_seconds, duration);
    if (range.start < previous || !Number.isFinite(segment.start_seconds) || !Number.isFinite(segment.end_seconds) || Math.abs(segment.start_seconds - clock) > 0.001 || Math.abs(segment.end_seconds - (clock + range.end - range.start)) > 0.001) throw new Error("Recording plan has invalid source/edit mapping");
    clock = segment.end_seconds;
    previous = range.end;
    return range;
  });
  if (!Number.isFinite(plan.duration_seconds) || Math.abs(plan.duration_seconds - clock) > 0.001) throw new Error("Recording plan duration does not match its mapping");
  const originalSourceWords = plan.words.map((word) => {
    checkedRange(word.start, word.end, plan.duration_seconds);
    const segment = plan.kept_segments.find((entry) => word.start >= entry.start_seconds - 1e-6 && word.end <= entry.end_seconds + 1e-6);
    if (!segment || !String(word.word ?? word.text ?? "").trim()) throw new Error("Accepted word crosses an edit boundary or has no text");
    const offset = segment.source_start_seconds - segment.start_seconds;
    return { ...word, start: word.start + offset, end: word.end + offset };
  });
  for (let index = 1; index < originalSourceWords.length; index++) if (originalSourceWords[index].start < originalSourceWords[index - 1].end - 1e-6) throw new Error("Accepted words must be ordered and non-overlapping");
  const measuredQuiet = union(analysis.silence_intervals.map((interval) => checkedRange(interval.start_seconds, interval.end_seconds, duration)));
  const alignedWords = [];
  const droppedWords = [];
  const sourceWords = originalSourceWords.flatMap((word) => {
    // Only quiet touching a boundary can move it. An interior quiet span may be
    // a natural intra-word pause and cannot split an accepted ASR token.
    let start = word.start;
    let end = word.end;
    for (const quiet of measuredQuiet) {
      if (quiet.start <= start && quiet.end > start) start = Math.min(end, quiet.end);
      if (quiet.start < end && quiet.end >= end) end = Math.max(start, quiet.start);
    }
    const record = { word: word.word ?? word.text, source_start_seconds: word.start, source_end_seconds: word.end };
    if (end - start <= 1e-6) { droppedWords.push({ ...record, reason: "unvoiced-transcript-artifact" }); return []; }
    if (start !== word.start || end !== word.end) alignedWords.push({ ...record, aligned_start_seconds: start, aligned_end_seconds: end });
    return [{ ...word, start, end }];
  });
  if (!sourceWords.length) throw new Error("Audio alignment found no voiced transcript words");
  const protectedRanges = union(sourceWords.map((word) => ({ start: Math.max(0, word.start - padding), end: Math.min(duration, word.end + padding) })));
  const quiet = measuredQuiet.map((range) => {
    return { start: range.start + padding, end: range.end - padding };
  }).filter((range) => range.end > range.start);
  const removals = union(quiet.flatMap((range) => subtract(range, protectedRanges)).flatMap((range) => keeps.flatMap((keep) => {
    const start = Math.max(range.start, keep.start);
    const end = Math.min(range.end, keep.end);
    return end > start ? [{ start, end }] : [];
  })));
  const refined = keeps.flatMap((keep) => subtract(keep, removals));
  if (!refined.length) throw new Error("Waveform refinement cannot remove the entire recording");
  clock = 0;
  const kept_segments = refined.map((range) => {
    const segment = { source_start_seconds: range.start, source_end_seconds: range.end, start_seconds: clock, end_seconds: clock + range.end - range.start };
    clock = segment.end_seconds;
    return segment;
  });
  const words = sourceWords.map((word) => {
    const segment = kept_segments.find((entry) => word.start >= entry.source_start_seconds - 1e-6 && word.end <= entry.source_end_seconds + 1e-6);
    if (!segment) throw new Error("Waveform refinement cut through an accepted word");
    const offset = segment.start_seconds - segment.source_start_seconds;
    return { ...word, start: word.start + offset, end: word.end + offset };
  });
  const removed_segments = [...plan.removed_segments.map((segment) => {
    checkedRange(segment.source_start_seconds, segment.source_end_seconds, duration);
    return { ...segment };
  }), ...removals.map((range) => ({ source_start_seconds: range.start, source_end_seconds: range.end, reason: "waveform-silence" }))].sort((a, b) => a.source_start_seconds - b.source_start_seconds);
  return { ...plan, duration_seconds: clock, kept_segments, removed_segments, words, text: words.map((word) => word.word ?? word.text).join(" "), audio_analysis: { schema_version: RECORDING_AUDIO_VERSION, threshold_db: analysis.threshold_db, silence_padding_seconds: padding, removed_seconds: plan.duration_seconds - clock, aligned_words: alignedWords, dropped_words: droppedWords } };
}

function percentile(values, fraction) { return values[Math.min(values.length - 1, Math.floor(values.length * fraction))]; }
function positive(value, label) { if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive finite number`); return value; }
function nonnegative(value, label) { if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${label} must be a nonnegative finite number`); return value; }
function checkedRange(start, end, duration) { if (![start, end].every(Number.isFinite) || start < 0 || end <= start || end > duration + 1e-6) throw new Error("Invalid audio/edit range"); return { start, end }; }
function union(ranges) {
  const result = [];
  for (const entry of ranges.map((range) => ({ start: range.start ?? range.start_seconds, end: range.end ?? range.end_seconds })).sort((a, b) => a.start - b.start)) {
    const last = result.at(-1);
    if (last && entry.start <= last.end) last.end = Math.max(last.end, entry.end);
    else result.push({ ...entry });
  }
  return result;
}
function subtract(range, cuts) {
  const result = [];
  let cursor = range.start;
  for (const cut of cuts) {
    if (cut.end <= cursor || cut.start >= range.end) continue;
    if (cut.start > cursor) result.push({ start: cursor, end: Math.min(cut.start, range.end) });
    cursor = Math.max(cursor, cut.end);
    if (cursor >= range.end) break;
  }
  if (cursor < range.end) result.push({ start: cursor, end: range.end });
  return result;
}
