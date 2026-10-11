import test from "node:test";
import assert from "node:assert/strict";
import { refineRecordingEditPlan } from "../src/recording_audio.js";

function fixture(reason) {
  return {
    schema_version: "launchclip.recording-edit.v1", source_duration_seconds: 10, duration_seconds: 7,
    kept_segments: [
      { source_start_seconds: 0, source_end_seconds: 2, start_seconds: 0, end_seconds: 2 },
      { source_start_seconds: 3, source_end_seconds: 7, start_seconds: 2, end_seconds: 6 },
      { source_start_seconds: 8, source_end_seconds: 9, start_seconds: 6, end_seconds: 7 }
    ],
    removed_segments: [{ source_start_seconds: 2, source_end_seconds: 3, reason }, { source_start_seconds: 7, source_end_seconds: 8, reason: "silence" }],
    words: [{ word: "Begin", start: 0.2, end: 1.5, source_index: 0 }, { word: "A", start: 2.8, end: 2.85, source_index: 4 }, { word: "choice", start: 3.1, end: 5.2, source_index: 5 }, { word: "finish.", start: 6.2, end: 6.8, source_index: 6 }],
    text: "Begin A choice finish."
  };
}

test("facing rejected handles remove untranscribed voiced residue while retaining a short chosen word", () => {
  for (const reason of ["semantic-retake", "repeated-take", "filler", "false-start"]) {
    const source = fixture(reason);
    const before = structuredClone(source);
    const analysis = { source_duration_seconds: 10, threshold_db: -40, silence_intervals: [], waveform: [{ start_seconds: 1.6, end_seconds: 2, rms_db: -20 }, { start_seconds: 3, end_seconds: 3.6, rms_db: -20 }] };
    const refined = refineRecordingEditPlan(source, analysis, { trimEdges: false });
    assert.deepEqual(refined.kept_segments.map((range) => [range.source_start_seconds, range.source_end_seconds]), [[0, 1.5], [3.8, 7], [8, 9]]);
    assert.deepEqual(refined.words.map((word) => word.source_index), [0, 4, 5, 6]);
    assert.ok(Math.abs(refined.words[1].start - 1.5) < 1e-9);
    assert.ok(Math.abs(refined.words[1].end - refined.words[1].start - 0.05) < 1e-9);
    assert.equal(refined.text, source.text);
    assert.ok(Math.abs(refined.audio_analysis.rejected_splice_removed_seconds - 1.3) < 1e-9);
    assert.deepEqual(refined.removed_segments.filter((range) => range.reason === reason), [source.removed_segments[0]]);
    assert.ok(refined.removed_segments.some((range) => range.reason === "rejected-splice-handle" && range.source_start_seconds === 3 && range.source_end_seconds === 3.8));
    assert.deepEqual(source, before);
  }
});

test("quiet-only cuts preserve natural interior handles and do not trigger rejected-splice trimming", () => {
  const source = fixture("silence");
  const refined = refineRecordingEditPlan(source, { source_duration_seconds: 10, threshold_db: -40, silence_intervals: [] }, { trimEdges: false });
  assert.deepEqual(refined.kept_segments, source.kept_segments);
  assert.deepEqual(refined.words.map(({ word, source_index }) => ({ word, source_index })), source.words.map(({ word, source_index }) => ({ word, source_index })));
  refined.words.forEach((word, index) => {
    assert.ok(Math.abs(word.start - source.words[index].start) < 1e-9);
    assert.ok(Math.abs(word.end - source.words[index].end) < 1e-9);
  });
  assert.equal(refined.audio_analysis.rejected_splice_removed_seconds, 0);
});
