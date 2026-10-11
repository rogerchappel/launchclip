import test from "node:test";
import assert from "node:assert/strict";
import { assessRecordingQa, identifyRecordingCoherence, recordingQaEvidenceHash, validateRecordingCoherence } from "../src/recording_qa.js";
const sha = "a".repeat(64);
function phrase(text, start = 0.2) { return text.split(" ").map((word, index) => ({ word, start: start + index * 0.3, end: start + index * 0.3 + 0.2 })); }
const plan = { duration_seconds: 2, words: phrase("The garden grows well."), kept_segments: [{ source_start_seconds: 4, source_end_seconds: 6, start_seconds: 0, end_seconds: 2 }] };
function receipt(actual = plan.words, extra = {}) { return { evidence_hash: recordingQaEvidenceHash(plan, actual, sha), coverage_complete: true, findings: [], transcript_resolutions: [], ...extra }; }
const acoustic = { checked: true, issues: [] };

test("matching transcript alone cannot silently pass missing acoustic or semantic coverage", () => {
  const qa = assessRecordingQa(plan, plan.words);
  assert.equal(qa.status, "needs-semantic-review");
  assert.deepEqual(qa.checks, { transcript: "passed", acoustic: "pending", coherence: "pending" });
  assert.equal(assessRecordingQa(plan, plan.words, { acoustic }).status, "needs-semantic-review");
});
test("fully bound complete semantic and acoustic checks permit pass", () => {
  const qa = assessRecordingQa(plan, plan.words, { acoustic, semantic: receipt(), mediaSha256: sha });
  assert.equal(qa.status, "passed");
  assert.deepEqual(qa.repair_requests, []);
});
test("punctuation and capitalization variations are robust while substitutions stay ambiguous", () => {
  const normalized = phrase("THE garden grows well");
  assert.equal(assessRecordingQa(plan, normalized).issues.length, 0);
  const changed = phrase("The garden grows slowly.");
  const qa = assessRecordingQa(plan, changed, { acoustic });
  assert.equal(qa.status, "needs-attention");
  assert.equal(qa.issues[0].kind, "asr-disagreement");
  assert.equal(qa.issues[0].repairable, false);
  assert.equal(qa.repair_requests.length, 0);
});
test("ASR omissions near cuts are located but never used as proof of clipping", () => {
  const actual = plan.words.slice(1);
  const qa = assessRecordingQa(plan, actual);
  assert.equal(qa.issues[0].word_index, 0);
  assert.equal(qa.issues[0].segment_index, 0);
  assert.equal(qa.issues[0].edge, "start");
  assert.equal(qa.repair_requests.length, 0);
});
test("explicit evidence-bound ASR resolution can distinguish recognition variation", () => {
  const actual = phrase("The garden grows good.");
  const semantic = receipt(actual, { transcript_resolutions: [{ issue_index: 0, verdict: "asr-variation", explanation: "Audition confirms the source final word; the recognizer substituted it." }] });
  const qa = assessRecordingQa(plan, actual, { acoustic, semantic, mediaSha256: sha });
  assert.equal(qa.status, "passed");
  assert.equal(qa.issues[0].resolved, true);
});
test("source delivery observations are nonblocking; introduced lost context requires attention", () => {
  const source = { kind: "source-delivery", start_seconds: 0, end_seconds: 1, explanation: "The source contains the same informal phrase." };
  assert.equal(assessRecordingQa(plan, plan.words, { acoustic, semantic: receipt(plan.words, { findings: [source] }), mediaSha256: sha }).status, "passed");
  const broken = { ...source, kind: "missing-context", explanation: "The edit removed the antecedent of the retained reference." };
  const qa = assessRecordingQa(plan, plan.words, { acoustic, semantic: receipt(plan.words, { findings: [broken] }), mediaSha256: sha });
  assert.equal(qa.status, "needs-attention");
  assert.equal(qa.issues[0].repairable, false);
});
test("proven acoustic clipping emits a bounded request and needs repair", () => {
  const evidence = { checked: true, issues: [{ kind: "clipped-boundary", segment_index: 0, edge: "start", seconds: 0.08, proven: true, explanation: "Independent source timing places voiced onset 80ms before the cut." }] };
  const qa = assessRecordingQa(plan, plan.words, { acoustic: evidence, semantic: receipt(), mediaSha256: sha });
  assert.equal(qa.status, "repair-needed");
  assert.deepEqual(qa.repair_requests[0], { kind: "expand-boundary", segment_index: 0, edge: "start", seconds: 0.08, explanation: evidence.issues[0].explanation });
  assert.throws(() => assessRecordingQa(plan, plan.words, { acoustic: { checked: true, issues: [{ ...evidence.issues[0], seconds: 0.3 }] } }), /Invalid proven/);
});
test("semantic findings cannot authorize repairs or invent index/timing coverage", () => {
  for (const finding of [
    { kind: "delete", start_seconds: 0, end_seconds: 1, explanation: "bad" },
    { kind: "orphan-fragment", start_seconds: -1, end_seconds: 1, explanation: "bad" },
    { kind: "orphan-fragment", start_seconds: 0, end_seconds: 1, explanation: "bad", repairable: true },
    { kind: "orphan-fragment", start_seconds: 0, end_seconds: 1, explanation: "bad", segment_index: 99 },
  ]) assert.throws(() => validateRecordingCoherence(receipt(plan.words, { findings: [finding] }), plan, plan.words, { mediaSha256: sha }), /Invalid/);
});
test("stale transcript, plan, media, and source receipts fail closed", () => {
  assert.throws(() => validateRecordingCoherence(receipt(), plan, phrase("Other words entirely."), { mediaSha256: sha }), /stale/);
  assert.throws(() => validateRecordingCoherence(receipt(), { ...plan, duration_seconds: 3 }, plan.words, { mediaSha256: sha }), /stale/);
  assert.throws(() => validateRecordingCoherence(receipt(), plan, plan.words, { mediaSha256: "b".repeat(64) }), /stale/);
  assert.throws(() => validateRecordingCoherence(receipt(), plan, plan.words, { mediaSha256: sha, sourceTranscript: phrase("Different source speech.") }), /stale/);
  assert.throws(() => recordingQaEvidenceHash(plan, plan.words, "invalid"), /SHA256/);
});
test("incomplete semantic receipts and invalid resolution indexes cannot pass", () => {
  assert.throws(() => validateRecordingCoherence(receipt(plan.words, { coverage_complete: false }), plan, plan.words, { mediaSha256: sha }), /incomplete/);
  assert.throws(() => validateRecordingCoherence(receipt(plan.words, { transcript_resolutions: [{ issue_index: 0, verdict: "asr-variation", explanation: "none" }] }), plan, plan.words, { mediaSha256: sha }), /resolution/);
});
test("inference opt-in uses generic evidence and binds response locally", async () => {
  await assert.rejects(identifyRecordingCoherence(plan, plan.words, { mediaSha256: sha }), /explicitly selected/);
  let captured;
  const result = await identifyRecordingCoherence(plan, plan.words, { mediaSha256: sha }, { infer: async (input) => { captured = input; return JSON.stringify({ coverage_complete: true, findings: [], transcript_resolutions: [] }); } });
  assert.equal(result.evidence_hash, receipt().evidence_hash);
  assert.match(captured.prompt, /content-specific rules/);
  await assert.rejects(identifyRecordingCoherence(plan, plan.words, { mediaSha256: sha }, { infer: async () => "bad JSON" }), /invalid JSON/);
  await assert.rejects(identifyRecordingCoherence(plan, plan.words, { mediaSha256: sha, model: "local", baseUrl: "https://example.com" }), /local Ollama/);
});

test("independent acoustic and fresh transcription onset evidence is preserved for guarded repair", () => {
  const proof = { acoustic_proven: true, retranscription_proven: true, source_word: { word: "The", start: 3.92, end: 4.2 } };
  const finding = { kind: "clipped-boundary", segment_index: 0, edge: "start", seconds: 0.08, proven: true, explanation: "Source onset independently confirmed before the accepted cut.", evidence: proof };
  const qa = assessRecordingQa(plan, plan.words, { acoustic: { checked: true, issues: [finding] } });
  assert.deepEqual(qa.repair_requests[0].evidence, proof);
  assert.throws(() => assessRecordingQa(plan, plan.words, { acoustic: { checked: true, issues: [{ ...finding, evidence: { ...proof, retranscription_proven: false } }] } }), /independently proven/);
});
