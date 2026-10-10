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
  const refined = refineRecordingEditPlan(plan, analysis);
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

test("quiet inside a broad ASR word or speech handle never cuts accepted speech", () => {
  const broad = { ...plan, words: [{ word: "Sentence", start: 0.1, end: 1.6 }, plan.words[2]] };
  const analysis = { source_duration_seconds: 6, threshold_db: -40, silence_intervals: [{ start_seconds: 0.5, end_seconds: 1.1 }, { start_seconds: 4.7, end_seconds: 5.4 }] };
  const refined = refineRecordingEditPlan(broad, analysis);
  assert.deepEqual(refined.words[0], broad.words[0]);
  assert.ok(refined.kept_segments.some((segment) => segment.source_start_seconds <= 0.1 && segment.source_end_seconds >= 1.6));
  assert.ok(refined.kept_segments.some((segment) => segment.source_start_seconds <= 4.1 && segment.source_end_seconds >= 4.88));
  assert.throws(() => refineRecordingEditPlan(plan, { ...analysis, source_duration_seconds: 7 }), /match/);
  assert.throws(() => refineRecordingEditPlan(plan, { ...analysis, silence_intervals: [{ start_seconds: NaN, end_seconds: 1 }] }), /range/);
  assert.throws(() => refineRecordingEditPlan({ ...plan, words: [] }, analysis), /spoken/);
});

test("blank audio fails and adaptive analysis output remains bounded", async () => {
  const blank = async () => ({ stdout: "pts_time:0\nlavfi.astats.Overall.RMS_level=-inf", stderr: "" });
  await assert.rejects(analyzeRecordingAudio("unused.wav", { durationSeconds: 1 }, { run: blank }), /no audible signal/);
  await assert.rejects(analyzeRecordingAudio("unused.wav", { durationSeconds: 1, thresholdDb: NaN }, { run: async () => ({ stdout: "pts_time:0\nlavfi.astats.Overall.RMS_level=-20" }) }), /thresholdDb/);
});
