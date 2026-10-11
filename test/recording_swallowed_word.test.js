import test from "node:test";
import assert from "node:assert/strict";
import { refineRecordingEditPlan } from "../src/recording_audio.js";
import { assessRecordingQa, recordingAcousticIssues, recordingQaEvidenceHash } from "../src/recording_qa.js";

function fixture() {
  return {
    source_duration_seconds: 3, duration_seconds: 2.5,
    kept_segments: [
      { source_start_seconds: 0, source_end_seconds: 0.5, start_seconds: 0, end_seconds: 0.5 },
      { source_start_seconds: 1, source_end_seconds: 3, start_seconds: 0.5, end_seconds: 2.5 }
    ],
    removed_segments: [{ source_start_seconds: 0.5, source_end_seconds: 1, reason: "semantic-retake" }],
    words: [{ word: "Ready.", start: 0, end: 0.5 }, { word: "Then", start: 0.5, end: 1.8 }, { word: "build.", start: 1.8, end: 2.4 }]
  };
}
const analysis = { source_duration_seconds: 3, threshold_db: -40, silence_intervals: [{ start_seconds: 1.1, end_seconds: 2.1 }] };

test("retake-facing swallowed timestamp stays intact but cannot silently pass matching ASR", () => {
  const original = fixture();
  const refined = refineRecordingEditPlan(original, analysis, { trimEdges: false });
  assert.deepEqual(refined.words.map((word) => word.word), original.words.map((word) => word.word));
  refined.words.forEach((word, index) => {
    assert.ok(Math.abs(word.start - original.words[index].start) < 1e-9);
    assert.ok(Math.abs(word.end - original.words[index].end) < 1e-9);
  });
  assert.deepEqual(refined.kept_segments, original.kept_segments);
  assert.equal(refined.audio_analysis.ambiguous_word_spans.length, 1);
  const measured = { checked: true, issues: [] };
  const qa = assessRecordingQa(refined, refined.words, { acoustic: measured });
  assert.equal(qa.status, "needs-semantic-review");
  assert.equal(qa.issues[0].kind, "unconfirmed-boundary");
  assert.equal(qa.issues[0].segment_index, 1);
  assert.deepEqual(qa.repair_requests, []);
  const semantic = { evidence_hash: recordingQaEvidenceHash(refined, refined.words, "a".repeat(64), undefined, measured), coverage_complete: true, findings: [], transcript_resolutions: [] };
  assert.equal(assessRecordingQa(refined, refined.words, { acoustic: measured, semantic, mediaSha256: "a".repeat(64) }).status, "needs-attention");
  const resolved = { ...semantic, acoustic_resolutions: [{ issue_index: 0, verdict: "natural-transition", explanation: "Independent source and output alignment confirms both signal islands belong to the chosen first word." }] };
  assert.equal(assessRecordingQa(refined, refined.words, { acoustic: measured, semantic: resolved, mediaSha256: "a".repeat(64) }).status, "passed");
  assert.deepEqual(original.audio_analysis, undefined);
});

test("ordinary interior pauses and short first words never trigger retake residue guesses", () => {
  const natural = fixture(); natural.removed_segments[0].reason = "transcript-gap";
  assert.deepEqual(refineRecordingEditPlan(natural, analysis, { trimEdges: false }).audio_analysis.ambiguous_word_spans, []);
  assert.deepEqual(refineRecordingEditPlan(fixture(), { ...analysis, silence_intervals: [] }, { trimEdges: false }).audio_analysis.ambiguous_word_spans, []);
  const short = fixture(); short.words[1].end = 1;
  assert.deepEqual(refineRecordingEditPlan(short, { ...analysis, silence_intervals: [{ start_seconds: 1.1, end_seconds: 1.4 }] }, { trimEdges: false }).audio_analysis.ambiguous_word_spans, []);
  const laterPause = { ...analysis, silence_intervals: [{ start_seconds: 1.3, end_seconds: 2.1 }] };
  assert.deepEqual(refineRecordingEditPlan(fixture(), laterPause, { trimEdges: false }).audio_analysis.ambiguous_word_spans, []);
});

test("ambiguous timestamp metadata is strict, hash bound, and appended after measured issues", () => {
  const refined = refineRecordingEditPlan(fixture(), analysis, { trimEdges: false });
  const impulse = { kind: "join-click-candidate", segment_index: 1, edge: "start", at_seconds: 0.5, proven: false, explanation: "Unproven impulse." };
  assert.equal(recordingAcousticIssues(refined, { issues: [impulse] })[0], impulse);
  for (const patch of [{ quiet_start_seconds: 0.9 }, { quiet_end_seconds: 1.2 }, { source_word_end_seconds: Infinity }, { reason: "guess" }, { source_word_start_seconds: 1.01 }]) {
    const changed = structuredClone(refined);
    Object.assign(changed.audio_analysis.ambiguous_word_spans[0], patch);
    assert.throws(() => recordingAcousticIssues(changed, { issues: [] }), /Invalid ambiguous|retained timed word/);
  }
  const sha = "a".repeat(64);
  const before = recordingQaEvidenceHash(refined, refined.words, sha);
  const changed = structuredClone(refined); changed.audio_analysis.ambiguous_word_spans[0].quiet_end_seconds = 2.15;
  assert.notEqual(recordingQaEvidenceHash(changed, changed.words, sha), before);
});
