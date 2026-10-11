import test from "node:test";
import assert from "node:assert/strict";
import { analyzeRecordingAudio, parseRmsEnvelope, parseAudioSilence, refineRecordingEditPlan } from "../src/recording_audio.js";

test("audio parsers retain source timestamps, trailing silence and finite plot levels", () => {
  const points = parseRmsEnvelope("frame:0 pts:0 pts_time:0\nlavfi.astats.Overall.RMS_level=-20\nframe:1 pts:1600 pts_time:0.1\nlavfi.astats.Overall.RMS_level=-inf", { durationSeconds: 0.15, stepSeconds: 0.1 });
  assert.equal(points.length, 2);
  assert.equal(points[0].rms, 0.1);
  assert.equal(points[1].rms, 0);
  assert.equal(points[1].end_seconds, 0.15);
  assert.ok(points.every((point) => [point.start_seconds, point.end_seconds, point.rms_db, point.rms].every(Number.isFinite)));
  assert.deepEqual(parseAudioSilence("silence_start: 0.8\nsilence_end: 1.3\nsilence_start: 2", 3), [{ start_seconds: 0.8, end_seconds: 1.3 }, { start_seconds: 2, end_seconds: 3 }]);
  assert.throws(() => parseRmsEnvelope("pts_time:0\nlavfi.astats.Overall.RMS_level=nan", { durationSeconds: 1, stepSeconds: 0.1 }), /Invalid/);
  assert.throws(() => parseRmsEnvelope("pts_time:0\nlavfi.astats.Overall.RMS_level=-20\npts_time:0.1\nlavfi.astats.Overall.RMS_level=-20", { durationSeconds: 1, stepSeconds: 0.1, maxPoints: 1 }), /bounded/);
});

const plan = {
  schema_version: "launchclip.recording-edit.v1", source_duration_seconds: 6, duration_seconds: 4,
  kept_segments: [{ source_start_seconds: 0, source_end_seconds: 2, start_seconds: 0, end_seconds: 2 }, { source_start_seconds: 4, source_end_seconds: 6, start_seconds: 2, end_seconds: 4 }],
  removed_segments: [{ source_start_seconds: 2, source_end_seconds: 3, reason: "repeated-take" }, { source_start_seconds: 3, source_end_seconds: 4, reason: "filler" }],
  words: [{ word: "Build", start: 0.1, end: 0.6 }, { word: "it.", start: 1.15, end: 1.6 }, { word: "Now.", start: 2.1, end: 2.8 }], text: "Build it. Now."
};

test("waveform quiet below transcript gap threshold shortens edit and remaps through rejected takes", () => {
  const analysis = { source_duration_seconds: 6, threshold_db: -40, silence_intervals: [{ start_seconds: 0.65, end_seconds: 1.1 }] };
  const refined = refineRecordingEditPlan(plan, analysis, { trimEdges: false });
  assert.ok(Math.abs(refined.duration_seconds - 3.71) < 1e-9);
  assert.ok(Math.abs(refined.words[1].start - 0.86) < 1e-9);
  assert.ok(Math.abs(refined.words[2].start - 1.81) < 1e-9);
  assert.equal(refined.text, plan.text);
  assert.deepEqual(refined.removed_segments.filter((segment) => segment.reason !== "waveform-silence"), plan.removed_segments);
  assert.equal(refined.removed_segments[0].reason, "waveform-silence");
  assert.ok(Math.abs(refined.removed_segments[0].source_start_seconds - 0.73) < 1e-9);
  assert.ok(Math.abs(refined.removed_segments[0].source_end_seconds - 1.02) < 1e-9);
  assert.equal(plan.duration_seconds, 4, "input plan remains unchanged");
});

test("interior midword quiet stays protected while a proven quiet word tail is aligned", () => {
  const broad = { ...plan, words: [{ word: "Sentence", start: 0.1, end: 1.6 }, plan.words[2]] };
  const analysis = { source_duration_seconds: 6, threshold_db: -40, silence_intervals: [{ start_seconds: 0.5, end_seconds: 1.1 }, { start_seconds: 4.7, end_seconds: 5.4 }] };
  const refined = refineRecordingEditPlan(broad, analysis, { trimEdges: false });
  assert.deepEqual(refined.words[0], broad.words[0]);
  assert.ok(refined.kept_segments.some((segment) => segment.source_start_seconds <= 0.1 && segment.source_end_seconds >= 1.6));
  assert.ok(refined.kept_segments.some((segment) => segment.source_start_seconds <= 4.1 && segment.source_end_seconds >= 4.78));
  assert.equal(refined.audio_analysis.aligned_words[0].aligned_end_seconds, 4.7);
  assert.throws(() => refineRecordingEditPlan(plan, { ...analysis, source_duration_seconds: 7 }), /match/);
  assert.throws(() => refineRecordingEditPlan(plan, { ...analysis, silence_intervals: [{ start_seconds: NaN, end_seconds: 1 }] }), /range/);
  assert.throws(() => refineRecordingEditPlan({ ...plan, words: [] }, analysis), /spoken/);
});

test("broad leading ASR timestamp trims measured silence but keeps the actual voiced token and handles", () => {
  const broad = { schema_version: plan.schema_version, source_duration_seconds: 4, duration_seconds: 4,
    kept_segments: [{ source_start_seconds: 0, source_end_seconds: 4, start_seconds: 0, end_seconds: 4 }], removed_segments: [],
    words: [{ word: "Build", start: 0.2, end: 0.5 }, { word: "Then", start: 0.7, end: 2.1 }, { word: "ship.", start: 2.2, end: 2.7 }], text: "Build Then ship." };
  const refined = refineRecordingEditPlan(broad, { source_duration_seconds: 4, threshold_db: -52, silence_intervals: [{ start_seconds: 0.6, end_seconds: 2 }] }, { trimEdges: false });
  assert.ok(Math.abs(refined.audio_analysis.removed_seconds - 1.24) < 1e-9);
  assert.equal(refined.audio_analysis.aligned_words[0].aligned_start_seconds, 2);
  assert.ok(Math.abs(refined.words[1].start - 0.76) < 1e-9);
  assert.ok(Math.abs(refined.words[1].end - 0.86) < 1e-9);
  assert.ok(refined.kept_segments.some((segment) => segment.source_start_seconds <= 1.92 && segment.source_end_seconds >= 2.18));
  assert.equal(refined.text, broad.text);
});

test("whole quiet transcript artifacts drop without removing genuine quiet phrases outside measured silence", () => {
  const source = { schema_version: plan.schema_version, source_duration_seconds: 3, duration_seconds: 3,
    kept_segments: [{ source_start_seconds: 0, source_end_seconds: 3, start_seconds: 0, end_seconds: 3 }], removed_segments: [],
    words: [{ word: "Quiet", start: 0.1, end: 0.5 }, { word: "Um", start: 0.8, end: 1 }, { word: "phrase.", start: 1.6, end: 2 }], text: "Quiet Um phrase." };
  const analysis = { source_duration_seconds: 3, threshold_db: -52, silence_intervals: [{ start_seconds: 0.6, end_seconds: 1.5 }] };
  const refined = refineRecordingEditPlan(source, analysis);
  assert.deepEqual(refined.words.map((word) => word.word), ["Quiet", "phrase."]);
  assert.equal(refined.text, "Quiet phrase.");
  assert.equal(refined.audio_analysis.dropped_words[0].word, "Um");
  assert.equal(refined.audio_analysis.dropped_words[0].reason, "unvoiced-transcript-artifact");
  assert.throws(() => refineRecordingEditPlan({ ...source, words: [source.words[1]] }, analysis), /no voiced transcript/);
  assert.throws(() => refineRecordingEditPlan(source, { ...analysis, threshold_db: NaN }), /valid silence threshold/);
});

test("blank audio fails and adaptive analysis output remains bounded", async () => {
  const blank = async () => ({ stdout: "pts_time:0\nlavfi.astats.Overall.RMS_level=-inf", stderr: "" });
  await assert.rejects(analyzeRecordingAudio("unused.wav", { durationSeconds: 1 }, { run: blank }), /no audible signal/);
  await assert.rejects(analyzeRecordingAudio("unused.wav", { durationSeconds: 1, thresholdDb: NaN }, { run: async () => ({ stdout: "pts_time:0\nlavfi.astats.Overall.RMS_level=-20" }) }), /thresholdDb/);
});

test("dialogue threshold receipt uses speech and noise references and keeps explicit overrides", async () => {
  const output = ["pts_time:0", "lavfi.astats.Overall.RMS_level=-70", "pts_time:0.1", "lavfi.astats.Overall.RMS_level=-30", "pts_time:0.2", "lavfi.astats.Overall.RMS_level=-20"].join("\n");
  const run = async () => ({ stdout: output, stderr: "" });
  const analysis = await analyzeRecordingAudio("unused.wav", { durationSeconds: 0.3 }, { run });
  assert.equal(analysis.threshold_db, -38);
  assert.equal(analysis.threshold_receipt.noise_floor_db, -70);
  assert.equal(analysis.threshold_receipt.speech_reference_db, -20);
  assert.equal(analysis.threshold_receipt.speech_percentile, 75);
  assert.match(analysis.threshold_receipt.rule, /clamped/);
  const explicit = await analyzeRecordingAudio("unused.wav", { durationSeconds: 0.3, thresholdDb: -44 }, { run });
  assert.equal(explicit.threshold_db, -44);
  assert.equal(explicit.threshold_receipt.rule, "explicit-override");
});

test("5ms noise debounce joins tiny interruptions while preserving a 20ms voiced plosive", () => {
  const joined = parseAudioSilence("silence_start:0\nsilence_end:0.7\nsilence_start:0.702\nsilence_end:1.5", 2);
  assert.deepEqual(joined, [{ start_seconds: 0, end_seconds: 1.5 }]);
  const separate = parseAudioSilence("silence_start:0\nsilence_end:0.7\nsilence_start:0.72\nsilence_end:1.5", 2);
  assert.equal(separate.length, 2);
  assert.throws(() => parseAudioSilence("", 2, { joinToleranceSeconds: 0.02 }), /10ms/);
  const source = { schema_version: plan.schema_version, source_duration_seconds: 2, duration_seconds: 2,
    kept_segments: [{ source_start_seconds: 0, source_end_seconds: 2, start_seconds: 0, end_seconds: 2 }], removed_segments: [],
    words: [{ word: "Tap", start: 0.7, end: 0.72 }, { word: "again.", start: 1.6, end: 1.9 }], text: "Tap again." };
  const refined = refineRecordingEditPlan(source, { source_duration_seconds: 2, threshold_db: -40, silence_intervals: separate });
  assert.equal(refined.words[0].word, "Tap");
  assert.ok(Math.abs(refined.words[0].end - refined.words[0].start - 0.02) < 1e-9);
});

test("measured quiet speech above noise floor survives a dialogue-relative silent interval", () => {
  const source = { schema_version: plan.schema_version, source_duration_seconds: 3, duration_seconds: 3,
    kept_segments: [{ source_start_seconds: 0, source_end_seconds: 3, start_seconds: 0, end_seconds: 3 }], removed_segments: [],
    words: [{ word: "Whisper", start: 0.1, end: 0.5 }, { word: "Uh", start: 0.8, end: 1 }, { word: "louder.", start: 1.6, end: 2 }], text: "Whisper Uh louder." };
  const refined = refineRecordingEditPlan(source, { source_duration_seconds: 3, threshold_db: -40, threshold_receipt: { noise_floor_db: -70 }, silence_intervals: [{ start_seconds: 0, end_seconds: 1.5 }], waveform: [{ start_seconds: 0.1, end_seconds: 0.5, rms_db: -50 }, { start_seconds: 0.8, end_seconds: 1, rms_db: -75 }] });
  assert.deepEqual(refined.words.map((word) => word.word), ["Whisper", "louder."]);
  assert.equal(refined.audio_analysis.dropped_words[0].word, "Uh");
  assert.throws(() => refineRecordingEditPlan(source, { source_duration_seconds: 3, threshold_db: -40, silence_intervals: [], waveform: [{ start_seconds: 0, end_seconds: 1, rms_db: NaN }] }), /waveform level/);
});

test("a short quiet prefix joins across noise before the requested pause duration gate", async () => {
  const calls = [];
  const run = async (command, args) => {
    calls.push(args);
    return calls.length === 1
      ? { stdout: "pts_time:0\nlavfi.astats.Overall.RMS_level=-20", stderr: "" }
      : { stdout: "", stderr: "silence_start:0.6\nsilence_end:0.98\nsilence_start:0.986\nsilence_end:1.7\nsilence_start:2\nsilence_end:2.1" };
  };
  const analysis = await analyzeRecordingAudio("unused.wav", { durationSeconds: 3, silenceDuration: 0.4 }, { run });
  assert.deepEqual(analysis.silence_intervals, [{ start_seconds: 0.6, end_seconds: 1.7 }]);
  assert.equal(analysis.silence_join_tolerance_seconds, 0.01);
  assert.ok(calls[1].some((arg) => arg.includes("silencedetect=noise=-30dB:d=0.01")));
});
