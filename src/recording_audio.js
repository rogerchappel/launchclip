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
  const joinTolerance = nonnegative(options.silenceJoinToleranceSeconds ?? 0.01, "silenceJoinToleranceSeconds");
  if (joinTolerance > 0.01) throw new Error("Silence debounce cannot exceed 10ms");
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
  const noiseFloor = percentile(levels, 0.2);
  const speechReference = percentile(levels, 0.75);
  const threshold = options.thresholdDb === undefined
    ? Math.max(-60, Math.min(-30, Math.max(noiseFloor + 10, speechReference - 18)))
    : options.thresholdDb;
  if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold < -80 || threshold > -10) throw new Error("thresholdDb must be finite between -80 and -10 dB");
  // Detect short quiet pieces before debouncing; otherwise a brief noise click
  // can discard the preceding quiet piece before the requested duration gate.
  const detectorDuration = Math.min(silenceDuration, 0.01);
  const quiet = await run("ffmpeg", [...common, "-af", `aresample=16000,aformat=channel_layouts=mono,silencedetect=noise=${threshold}dB:d=${detectorDuration}`, "-f", "null", "-"], { maxBuffer: 8 * 1024 * 1024 });
  const silence = parseAudioSilence(quiet.stderr, duration, { joinToleranceSeconds: joinTolerance }).filter((interval) => interval.end_seconds - interval.start_seconds >= silenceDuration - 1e-6);
  // Dialogue-relative quiet can contain soft consonants. Confirm separators
  // against the noise floor for 40ms, without joining across voiced blips.
  const boundaryThreshold = Math.max(-80, Math.min(threshold, noiseFloor + 6));
  const boundaryWindows = options.boundaryPlan ? recordingBoundaryWindows(options.boundaryPlan, duration, silence, waveform, noiseFloor) : null;
  const boundaryMinimum = boundaryWindows ? 0.02 : 0.04;
  let boundarySilence;
  if (boundaryWindows) {
    boundarySilence = [];
    for (const window of boundaryWindows) {
      const pcm = await run("ffmpeg", ["-hide_banner", "-nostdin", "-loglevel", "error", "-ss", String(window.start), "-i", input, "-t", String(window.end - window.start), "-map", "0:a:0", "-vn", "-af", "aresample=16000,aformat=sample_fmts=s16:channel_layouts=mono", "-f", "f32le", "-"], { encoding: "buffer", maxBuffer: 32000 });
      boundarySilence.push(...parseBoundaryPcm(pcm.stdout, window, boundaryThreshold));
    }
  } else {
    const boundaryDetection = await run("ffmpeg", [...common, "-af", `aresample=16000,aformat=channel_layouts=mono,silencedetect=noise=${boundaryThreshold}dB:d=0.04`, "-f", "null", "-"], { maxBuffer: 8 * 1024 * 1024 });
    boundarySilence = parseAudioSilence(boundaryDetection.stderr, duration, { joinToleranceSeconds: 0 }).filter((interval) => interval.end_seconds - interval.start_seconds >= boundaryMinimum - 1e-6);
  }
  if (silence.length === 1 && silence[0].start_seconds === 0 && silence[0].end_seconds >= duration - 0.001) throw new Error("Recording audio is entirely below the silence threshold");
  return { schema_version: RECORDING_AUDIO_VERSION, source_duration_seconds: duration, threshold_db: threshold, threshold_receipt: { noise_floor_db: noiseFloor, speech_reference_db: speechReference, speech_percentile: 75, rule: options.thresholdDb === undefined ? "max(noise-floor+10dB,speech-p75-18dB),clamped[-60,-30]" : "explicit-override" }, silence_duration_seconds: silenceDuration, silence_padding_seconds: padding, silence_join_tolerance_seconds: joinTolerance, envelope_step_seconds: step, silence_intervals: silence, boundary_silence_intervals: boundarySilence, boundary_silence_receipt: { threshold_db: boundaryThreshold, noise_floor_db: noiseFloor, rule: "max(-80,min(dialogue-threshold,noise-floor+6dB))", minimum_duration_seconds: boundaryMinimum, join_tolerance_seconds: 0, measurement: boundaryWindows ? "mono16k-float-rms-10ms" : "silencedetect-peak", windows: boundaryWindows }, waveform };
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

export function parseAudioSilence(output, durationSeconds, { joinToleranceSeconds = 0.005 } = {}) {
  const duration = positive(durationSeconds, "durationSeconds");
  nonnegative(joinToleranceSeconds, "joinToleranceSeconds");
  if (joinToleranceSeconds > 0.01) throw new Error("Silence debounce cannot exceed 10ms");
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
  return union(intervals, joinToleranceSeconds).map(({ start, end }) => ({ start_seconds: start, end_seconds: end }));
}

/** Align silent ASR boundaries, then trim measured quiet outside voiced words. */
export function refineRecordingEditPlan(plan, analysis, { silencePadding = 0.08, trimEdges = true } = {}) {
  const padding = nonnegative(silencePadding, "silencePadding");
  if (typeof trimEdges !== "boolean") throw new Error("trimEdges must be a boolean");
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
  if (analysis.boundary_silence_intervals !== undefined && !Array.isArray(analysis.boundary_silence_intervals)) throw new Error("Invalid boundary silence intervals");
  const boundaryQuiet = union((analysis.boundary_silence_intervals ?? analysis.silence_intervals).map((interval) => checkedRange(interval.start_seconds, interval.end_seconds, duration)));
  const boundaryMinimum = analysis.boundary_silence_receipt?.minimum_duration_seconds ?? 0.04;
  if (!Number.isFinite(boundaryMinimum) || boundaryMinimum < 0.02 || boundaryMinimum > 0.04) throw new Error("Invalid boundary silence minimum duration");
  if (analysis.waveform !== undefined && !Array.isArray(analysis.waveform)) throw new Error("Invalid acoustic waveform");
  const waveform = (analysis.waveform ?? []).map((point) => {
    checkedRange(point.start_seconds, point.end_seconds, duration);
    if (!Number.isFinite(point.rms_db)) throw new Error("Invalid acoustic waveform level");
    return point;
  });
  const floor = analysis.threshold_receipt?.noise_floor_db;
  if (floor !== undefined && !Number.isFinite(floor)) throw new Error("Invalid acoustic noise floor");
  const alignedWords = [];
  const droppedWords = [];
  const sourceWords = originalSourceWords.flatMap((word) => {
    // Only quiet touching a boundary can move it. An interior quiet span may be
    // a natural intra-word pause and cannot split an accepted ASR token.
    let start = word.start;
    let end = word.end;
    // A dialogue-relative cutoff can classify a whispered token as quiet. When
    // its local RMS rises above the measured noise floor, retain it rather than
    // treating it as an ASR phantom. Boundary alignment stays signal-driven.
    const whollyQuiet = measuredQuiet.some((quiet) => quiet.start <= word.start && quiet.end >= word.end);
    const quietSignal = Number.isFinite(floor) && waveform.some((point) => point.start_seconds < word.end && point.end_seconds > word.start && point.rms_db > floor + 6);
    if (whollyQuiet && quietSignal) return [{ ...word }];
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
  const rejectedReasons = new Set(["semantic-retake", "repeated-take", "filler", "false-start"]);
  const rejectedCuts = plan.removed_segments.filter((segment) => rejectedReasons.has(segment.reason));
  const spliceRanges = [];
  const spliceProtection = [];
  const unconfirmedBoundaries = [];
  const ambiguousWordSpans = [];
  for (const keep of keeps) {
    const spoken = sourceWords.filter((word) => word.start >= keep.start - 1e-6 && word.end <= keep.end + 1e-6);
    if (!spoken.length) continue; // Wordless ranges are removed separately below.
    // ASR bounds on a rejected word can underestimate its audible tail. A
    // facing handle may therefore contain rejected speech even when not quiet.
    const touchesEarlierCut = rejectedCuts.some((cut) => Math.abs(cut.source_end_seconds - keep.start) <= 1e-6);
    const touchesLaterCut = rejectedCuts.some((cut) => Math.abs(cut.source_start_seconds - keep.end) <= 1e-6);
    // A first-word timestamp can swallow the rejected take's short tail and a
    // long pause before the chosen word. Neither RMS nor matching ASR proves
    // which island belongs to that word, so retain speech and request review.
    if (touchesEarlierCut) {
      const first = spoken[0];
      const separator = measuredQuiet.find((quiet) => first.end - first.start >= 0.8
        && quiet.start > first.start && quiet.start - first.start <= 0.2 + 1e-6
        && quiet.end < first.end && quiet.end - quiet.start >= 0.4 - 1e-6);
      if (separator) ambiguousWordSpans.push({
        source_word_start_seconds: first.start, source_word_end_seconds: first.end,
        source_keep_boundary_seconds: keep.start,
        quiet_start_seconds: separator.start, quiet_end_seconds: separator.end,
        reason: "retake-word-timestamp-spans-quiet"
      });
    }
    if (touchesEarlierCut && spoken[0].start > keep.start) {
      const wordStart = spoken[0].start;
      const separator = boundaryQuiet.map((quiet) => ({ start: Math.max(quiet.start, keep.start), end: Math.min(quiet.end, wordStart) })).filter((quiet) => quiet.end - quiet.start >= boundaryMinimum - 1e-6 && quiet.end > wordStart - 0.5).at(-1);
      if (!separator && analysis.boundary_silence_receipt) { unconfirmedBoundaries.push({ side: "start", source_word_boundary_seconds: wordStart, source_keep_boundary_seconds: keep.start, reason: "no-confirmed-quiet-separator" }); }
      const boundary = separator ? Math.max(wordStart - 0.5, separator.end - Math.min(padding, (separator.end - separator.start) / 2)) : analysis.boundary_silence_receipt ? keep.start : wordStart;
      if (boundary > keep.start) {
      spliceRanges.push({ start: keep.start, end: boundary });
      keep.start = boundary;
      }
      if (keep.start < wordStart) spliceProtection.push({ start: keep.start, end: wordStart });
    }
    if (touchesLaterCut && spoken.at(-1).end < keep.end) {
      const wordEnd = spoken.at(-1).end;
      const separator = boundaryQuiet.map((quiet) => ({ start: Math.max(quiet.start, wordEnd), end: Math.min(quiet.end, keep.end) })).find((quiet) => quiet.end - quiet.start >= boundaryMinimum - 1e-6 && quiet.start < wordEnd + 0.5);
      if (!separator && analysis.boundary_silence_receipt) { unconfirmedBoundaries.push({ side: "end", source_word_boundary_seconds: wordEnd, source_keep_boundary_seconds: keep.end, reason: "no-confirmed-quiet-separator" }); }
      const boundary = separator ? Math.min(wordEnd + 0.5, separator.start + Math.min(padding, (separator.end - separator.start) / 2)) : analysis.boundary_silence_receipt ? keep.end : wordEnd;
      if (boundary < keep.end) {
      spliceRanges.push({ start: boundary, end: keep.end });
      keep.end = boundary;
      }
      if (keep.end > wordEnd) spliceProtection.push({ start: wordEnd, end: keep.end });
    }
  }
  // The looser dialogue pause cutoff must not undo conservative splice proof.
  const protectedRanges = union([...sourceWords.map((word) => ({ start: Math.max(0, word.start - padding), end: Math.min(duration, word.end + padding) })), ...spliceProtection]);
  const quiet = measuredQuiet.map((range) => {
    return { start: range.start + padding, end: range.end - padding };
  }).filter((range) => range.end > range.start);
  const removals = union(quiet.flatMap((range) => subtract(range, protectedRanges)).flatMap((range) => keeps.flatMap((keep) => {
    const start = Math.max(range.start, keep.start);
    const end = Math.min(range.end, keep.end);
    return end > start ? [{ start, end }] : [];
  })));
  const wordlessRanges = [];
  const refined = keeps.flatMap((keep) => subtract(keep, removals)).filter((range) => {
    const spoken = sourceWords.some((word) => word.start >= range.start - 1e-6 && word.end <= range.end + 1e-6);
    if (!spoken) wordlessRanges.push(range);
    return spoken;
  });
  if (!refined.length) throw new Error("Waveform refinement cannot remove the entire recording");
  const boundaryRanges = [];
  if (trimEdges) {
    const first = refined[0];
    const last = refined.at(-1);
    const firstWord = sourceWords[0];
    const lastWord = sourceWords.at(-1);
    if (firstWord.start > first.start) boundaryRanges.push({ start: first.start, end: firstWord.start });
    if (lastWord.end < last.end) boundaryRanges.push({ start: lastWord.end, end: last.end });
    first.start = firstWord.start;
    last.end = lastWord.end;
  }
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
  }), ...removals.map((range) => ({ source_start_seconds: range.start, source_end_seconds: range.end, reason: "waveform-silence" })), ...wordlessRanges.map((range) => ({ source_start_seconds: range.start, source_end_seconds: range.end, reason: "wordless-range" })), ...boundaryRanges.map((range) => ({ source_start_seconds: range.start, source_end_seconds: range.end, reason: "speech-boundary" })), ...spliceRanges.map((range) => ({ source_start_seconds: range.start, source_end_seconds: range.end, reason: "rejected-splice-handle" }))].sort((a, b) => a.source_start_seconds - b.source_start_seconds);
  return { ...plan, duration_seconds: clock, kept_segments, removed_segments, words, text: words.map((word) => word.word ?? word.text).join(" "), audio_analysis: { schema_version: RECORDING_AUDIO_VERSION, threshold_db: analysis.threshold_db, threshold_receipt: analysis.threshold_receipt, silence_padding_seconds: padding, trim_edges: trimEdges, boundary_silence_receipt: analysis.boundary_silence_receipt, boundary_search_seconds: 0.5, unconfirmed_boundaries: unconfirmedBoundaries, ambiguous_word_spans: ambiguousWordSpans, speech_boundary_removed_seconds: boundaryRanges.reduce((sum, range) => sum + range.end - range.start, 0), rejected_splice_removed_seconds: spliceRanges.reduce((sum, range) => sum + range.end - range.start, 0), wordless_removed_seconds: wordlessRanges.reduce((sum, range) => sum + range.end - range.start, 0), removed_seconds: plan.duration_seconds - clock, aligned_words: alignedWords, dropped_words: droppedWords } };
}

function recordingBoundaryWindows(plan, duration, silence, waveform, floor) {
  if (Math.abs(plan?.source_duration_seconds - duration) > 0.001 || !Array.isArray(plan?.words) || !Array.isArray(plan?.kept_segments) || !Array.isArray(plan?.removed_segments)) throw new Error("Invalid acoustic boundary plan");
  const rejected = plan.removed_segments.filter((cut) => ["semantic-retake", "repeated-take", "filler", "false-start"].includes(cut.reason));
  const windows = [];
  for (const keep of plan.kept_segments) {
    checkedRange(keep.source_start_seconds, keep.source_end_seconds, duration);
    const words = plan.words.filter((word) => word.start >= keep.start_seconds - 1e-6 && word.end <= keep.end_seconds + 1e-6).flatMap((word) => {
      const offset = keep.source_start_seconds - keep.start_seconds;
      const range = checkedRange(word.start + offset, word.end + offset, duration);
      const whollyQuiet = silence.some((quiet) => quiet.start_seconds <= range.start && quiet.end_seconds >= range.end);
      const quietSignal = waveform.some((point) => point.start_seconds < range.end && point.end_seconds > range.start && point.rms_db > floor + 6);
      if (whollyQuiet && quietSignal) return [range];
      for (const quiet of silence) {
        if (quiet.start_seconds <= range.start && quiet.end_seconds > range.start) range.start = Math.min(range.end, quiet.end_seconds);
        if (quiet.start_seconds < range.end && quiet.end_seconds >= range.end) range.end = Math.max(range.start, quiet.start_seconds);
      }
      return range.end - range.start > 1e-6 ? [range] : [];
    });
    if (!words.length) continue;
    if (rejected.some((cut) => Math.abs(cut.source_end_seconds - keep.source_start_seconds) <= 1e-6)) windows.push({ start: Math.max(keep.source_start_seconds, words[0].start - 0.5), end: words[0].start });
    if (rejected.some((cut) => Math.abs(cut.source_start_seconds - keep.source_end_seconds) <= 1e-6)) windows.push({ start: words.at(-1).end, end: Math.min(keep.source_end_seconds, words.at(-1).end + 0.5) });
  }
  if (windows.length > 512) throw new Error("Acoustic boundary windows exceed 512-window budget");
  return windows.filter((window) => window.end - window.start >= 0.02 - 1e-6);
}

/** Local PCM only: two consecutive quiet 10ms RMS frames, never joined over signal. */
export function parseBoundaryPcm(pcm, window, thresholdDb) {
  if (!Buffer.isBuffer(pcm) || pcm.length > 32000 || pcm.length % 4 || !Number.isFinite(thresholdDb) || thresholdDb < -80 || thresholdDb > -10 || !Number.isFinite(window?.start) || !Number.isFinite(window?.end) || window.start < 0 || window.end <= window.start || window.end - window.start > 0.5 + 1e-6) throw new Error("Invalid bounded boundary PCM");
  const frames = Math.min(Math.floor(pcm.length / 640), Math.floor((window.end - window.start + 1e-6) / 0.01));
  const result = [];
  let first = null;
  for (let frame = 0; frame <= frames; frame++) {
    let energy = 0;
    if (frame < frames) for (let sample = 0; sample < 160; sample++) {
      const value = pcm.readFloatLE((frame * 160 + sample) * 4);
      if (!Number.isFinite(value)) throw new Error("Invalid boundary PCM sample");
      energy += value * value;
    }
    const quiet = frame < frames && 10 * Math.log10(energy / 160) <= thresholdDb;
    if (quiet && first === null) first = frame;
    if (!quiet && first !== null) {
      if (frame - first >= 2) result.push({ start_seconds: window.start + first * 0.01, end_seconds: Math.min(window.end, window.start + frame * 0.01) });
      first = null;
    }
  }
  return result;
}

function percentile(values, fraction) { return values[Math.min(values.length - 1, Math.floor(values.length * fraction))]; }
function positive(value, label) { if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive finite number`); return value; }
function nonnegative(value, label) { if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${label} must be a nonnegative finite number`); return value; }
function checkedRange(start, end, duration) { if (![start, end].every(Number.isFinite) || start < 0 || end <= start || end > duration + 1e-6) throw new Error("Invalid audio/edit range"); return { start, end }; }
function union(ranges, tolerance = 0) {
  const result = [];
  for (const entry of ranges.map((range) => ({ start: range.start ?? range.start_seconds, end: range.end ?? range.end_seconds })).sort((a, b) => a.start - b.start)) {
    const last = result.at(-1);
    if (last && entry.start <= last.end + tolerance) last.end = Math.max(last.end, entry.end);
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
