import test from "node:test";
import assert from "node:assert/strict";
import { refineRecordingEditPlan } from "../src/recording_audio.js";

function mappedPlan(ranges, words, duration = 12) {
  let clock = 0;
  const kept_segments = ranges.map(([start, end]) => {
    const segment = { source_start_seconds: start, source_end_seconds: end, start_seconds: clock, end_seconds: clock + end - start };
    clock = segment.end_seconds;
    return segment;
  });
  const remapped = words.map((word) => {
    const segment = kept_segments.find((range) => word.start >= range.source_start_seconds && word.end <= range.source_end_seconds);
    const offset = segment.start_seconds - segment.source_start_seconds;
    return { ...word, start: word.start + offset, end: word.end + offset };
  });
  return { schema_version: "launchclip.recording-edit.v1", source_duration_seconds: duration, duration_seconds: clock, kept_segments, removed_segments: [], words: remapped, text: remapped.map((word) => word.word).join(" ") };
}

test("chosen speech removes initial and tail frame islands, rejected intro residue and wordless interior keeps", () => {
  const source = mappedPlan([[0, 0.08], [2, 4], [5, 5.1], [6, 9], [10.5, 12]], [
    { word: "Build", start: 2.2, end: 3, source_index: 7 },
    { word: "the", start: 6.1, end: 6.7, source_index: 8 },
    { word: "chosen take.", start: 7, end: 8, source_index: 10 }
  ]);
  source.removed_segments = [{ source_start_seconds: 0.08, source_end_seconds: 2, reason: "repeated-take" }];
  const before = structuredClone(source);
  const refined = refineRecordingEditPlan(source, { source_duration_seconds: 12, threshold_db: -40, silence_intervals: [] });
  assert.deepEqual(refined.kept_segments.map((range) => [range.source_start_seconds, range.source_end_seconds]), [[2.2, 4], [6, 8]]);
  assert.deepEqual(refined.words.map((word) => word.source_index), [7, 8, 10]);
  assert.equal(refined.words[0].start, 0);
  assert.ok(Math.abs(refined.words[1].start - 1.9) < 1e-9);
  assert.ok(Math.abs(refined.words.at(-1).end - refined.duration_seconds) < 1e-9);
  assert.equal(refined.text, source.text);
  assert.deepEqual(refined.removed_segments.find((range) => range.reason === "repeated-take"), source.removed_segments[0]);
  assert.equal(refined.removed_segments.filter((range) => range.reason === "wordless-range").length, 3);
  assert.ok(Math.abs(refined.audio_analysis.wordless_removed_seconds - 1.68) < 1e-9);
  assert.ok(Math.abs(refined.audio_analysis.speech_boundary_removed_seconds - 1.2) < 1e-9);
  assert.deepEqual(source, before);
});

test("waveform-created edge handles disappear and global speech endpoints follow aligned words", () => {
  const source = mappedPlan([[0, 12]], [{ word: "Then", start: 2, end: 4, source_index: 4 }, { word: "finish.", start: 8, end: 10, source_index: 5 }]);
  const refined = refineRecordingEditPlan(source, { source_duration_seconds: 12, threshold_db: -40, silence_intervals: [{ start_seconds: 0, end_seconds: 3 }, { start_seconds: 9, end_seconds: 12 }] });
  assert.equal(refined.kept_segments[0].source_start_seconds, 3);
  assert.equal(refined.kept_segments.at(-1).source_end_seconds, 9);
  assert.equal(refined.words[0].start, 0);
  assert.equal(refined.words.at(-1).end, refined.duration_seconds);
  assert.deepEqual(refined.words.map((word) => word.source_index), [4, 5]);
  assert.ok(refined.removed_segments.some((range) => range.reason === "wordless-range" && range.source_start_seconds === 0));
  assert.ok(refined.removed_segments.some((range) => range.reason === "wordless-range" && range.source_end_seconds === 12));
});

test("explicit edge opt-out retains global handles but still removes wordless islands", () => {
  const source = mappedPlan([[0, 0.1], [2, 5], [7, 8]], [{ word: "Keep speech.", start: 2.5, end: 4.5, source_index: 3 }]);
  const analysis = { source_duration_seconds: 12, threshold_db: -40, silence_intervals: [] };
  const refined = refineRecordingEditPlan(source, analysis, { trimEdges: false });
  assert.deepEqual(refined.kept_segments.map((range) => [range.source_start_seconds, range.source_end_seconds]), [[2, 5]]);
  assert.equal(refined.words[0].start, 0.5);
  assert.equal(refined.audio_analysis.trim_edges, false);
  assert.equal(refined.audio_analysis.speech_boundary_removed_seconds, 0);
  assert.throws(() => refineRecordingEditPlan(source, analysis, { trimEdges: "false" }), /boolean/);
});
