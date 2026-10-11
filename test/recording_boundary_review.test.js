import test from "node:test";
import assert from "node:assert/strict";
import { assessRecordingQa, recordingAcousticIssues, recordingQaEvidenceHash } from "../src/recording_qa.js";
const sha = "b".repeat(64);
const acoustic = { checked: true, issues: [] };
function plan() { return { source_duration_seconds: 6, duration_seconds: 2, kept_segments: [{ source_start_seconds: 1, source_end_seconds: 2, start_seconds: 0, end_seconds: 1 }, { source_start_seconds: 4, source_end_seconds: 5, start_seconds: 1, end_seconds: 2 }], words: [{ word: "Build", start: 0.2, end: 0.5 }, { word: "tools.", start: 1.2, end: 1.5 }], audio_analysis: { unconfirmed_boundaries: [{ side: "start", source_word_boundary_seconds: 4.2, source_keep_boundary_seconds: 4, reason: "no-confirmed-quiet-separator" }] } }; }
function receipt(p, measured = acoustic, resolutions = []) { return { evidence_hash: recordingQaEvidenceHash(p, p.words, sha, undefined, measured), coverage_complete: true, findings: [], transcript_resolutions: [], acoustic_resolutions: resolutions }; }
const review = (index) => ({ issue_index: index, verdict: "natural-transition", explanation: "Source and rendered boundary audition confirms a natural chosen breath without rejected speech residue." });

test("matched transcript and empty click QA cannot pass an unconfirmed speech boundary", () => {
  const p = plan();
  const qa = assessRecordingQa(p, p.words, { acoustic, semantic: receipt(p), mediaSha256: sha });
  assert.equal(qa.status, "needs-attention");
  assert.equal(qa.checks.acoustic, "ambiguous");
  assert.equal(qa.issues[0].kind, "unconfirmed-boundary");
  assert.equal(qa.issues[0].acoustic_issue_index, 0);
  assert.equal(qa.repair_requests.length, 0);
  assert.equal(qa.issues[0].repairable, false);
});
test("explicit evidence-bound source/output review resolves the boundary without changing cuts", () => {
  const p = plan();
  const qa = assessRecordingQa(p, p.words, { acoustic, semantic: receipt(p, acoustic, [review(0)]), mediaSha256: sha });
  assert.equal(qa.status, "passed");
  assert.equal(qa.issues[0].resolved, true);
  assert.equal(qa.repair_requests.length, 0);
  const changed = plan(); changed.audio_analysis.unconfirmed_boundaries[0].source_keep_boundary_seconds = 3.99;
  assert.throws(() => assessRecordingQa(changed, changed.words, { acoustic, semantic: receipt(p, acoustic, [review(0)]), mediaSha256: sha }), /stale/);
});
test("provided acoustic indexes stay stable and every appended boundary requires review", () => {
  const p = plan();
  p.audio_analysis.unconfirmed_boundaries.push({ side: "end", source_word_boundary_seconds: 1.5, source_keep_boundary_seconds: 2, reason: "no-confirmed-quiet-separator" });
  const measured = { checked: true, issues: [{ kind: "join-click-candidate", segment_index: 1, edge: "start", at_seconds: 1, proven: false, explanation: "Isolated join impulse requires audition." }] };
  const findings = recordingAcousticIssues(p, measured);
  assert.equal(findings[0], measured.issues[0]);
  assert.equal(findings[1].segment_index, 0);
  assert.equal(findings[1].edge, "end");
  assert.equal(findings[2].segment_index, 1);
  const partial = assessRecordingQa(p, p.words, { acoustic: measured, semantic: receipt(p, measured, [review(0), review(1)]), mediaSha256: sha });
  assert.equal(partial.status, "needs-attention");
  const complete = assessRecordingQa(p, p.words, { acoustic: measured, semantic: receipt(p, measured, [review(0), review(1), review(2)]), mediaSha256: sha });
  assert.equal(complete.status, "passed");
});
test("flags stay visible with incomplete acoustic coverage and malformed boundaries fail closed", () => {
  const p = plan();
  const qa = assessRecordingQa(p, p.words);
  assert.equal(qa.status, "needs-semantic-review");
  assert.equal(qa.issues[0].kind, "unconfirmed-boundary");
  const invalid = plan(); invalid.audio_analysis.unconfirmed_boundaries[0].side = "unknown";
  assert.throws(() => recordingAcousticIssues(invalid, acoustic), /Invalid unconfirmed/);
  const unmapped = plan(); unmapped.audio_analysis.unconfirmed_boundaries[0].source_word_boundary_seconds = 3; unmapped.audio_analysis.unconfirmed_boundaries[0].source_keep_boundary_seconds = 2.8;
  assert.throws(() => recordingAcousticIssues(unmapped, acoustic), /retained speech/);
});
