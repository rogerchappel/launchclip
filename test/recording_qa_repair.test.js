import test from "node:test";
import assert from "node:assert/strict";
import { repairRecordingPlan, analyzeRecordingJoins } from "../src/recording_qa_repair.js";
function plan() { return { source_duration_seconds: 5, duration_seconds: 1.6, kept_segments: [{ source_start_seconds: 1.1, source_end_seconds: 1.9, start_seconds: 0, end_seconds: 0.8 }, { source_start_seconds: 3.1, source_end_seconds: 3.9, start_seconds: 0.8, end_seconds: 1.6 }], words: [{ word: "Useful", start: 0, end: 0.4 }, { word: "tools.", start: 0.8, end: 1.2 }], text: "Useful tools.", removed_segments: [{ source_start_seconds: 0, source_end_seconds: 1.1, reason: "waveform-silence" }, { source_start_seconds: 1.9, source_end_seconds: 3.1, reason: "waveform-silence" }, { source_start_seconds: 3.9, source_end_seconds: 5, reason: "waveform-silence" }] }; }
const source = [{ word: "Useful", start: 1, end: 1.5 }, { word: "tools.", start: 3, end: 3.5 }];
const expand = (segment, edge, seconds = 0.15) => ({ kind: "expand-boundary", segment_index: segment, edge, seconds, explanation: "Source timing proves the retained word boundary was shortened." });

test("bounded restoration remaps retained speech without changing unique words", () => {
  const result = repairRecordingPlan(plan(), [expand(0, "start"), expand(1, "start")], { sourceTranscript: source, trimEdges: false });
  assert.equal(result.applied.length, 2);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.plan.kept_segments[0].source_start_seconds, 1);
  assert.equal(result.plan.words[0].start, 0);
  assert.ok(Math.abs(result.plan.words[1].start - 0.9) < 1e-6);
  assert.equal(result.plan.text, "Useful tools.");
});
test("repair cannot resurrect filler/take cuts or exceed budgets", () => {
  const blocked = repairRecordingPlan(plan(), [expand(0, "start")], { sourceTranscript: source, protectedCuts: [{ start: 1, end: 1.1 }], trimEdges: false });
  assert.equal(blocked.changed, false);
  assert.match(blocked.rejected[0].reason, /rejected/);
  const budget = repairRecordingPlan(plan(), [expand(0, "start"), expand(1, "start")], { sourceTranscript: source, totalMaxExpansionSeconds: 0.15, trimEdges: false });
  assert.equal(budget.applied.length, 1);
  assert.match(budget.rejected[0].reason, /budget/);
});
test("complete unique speech deletion and ambiguous boundary requests fail closed", () => {
  const result = repairRecordingPlan(plan(), [{ kind: "remove-fragment", complete_word: false, segment_index: 0 }, expand(0, "end"), expand(99, "start")], { sourceTranscript: source, trimEdges: false });
  assert.equal(result.changed, false);
  assert.equal(result.rejected.length, 3);
});
test("QA restoration cannot bring rejected splice-handle sound back", () => {
  const candidate = plan();
  candidate.removed_segments.push({ source_start_seconds: 1, source_end_seconds: 1.1, reason: "rejected-splice-handle" });
  const result = repairRecordingPlan(candidate, [expand(0, "start")], { sourceTranscript: source, trimEdges: false });
  assert.equal(result.changed, false);
  assert.equal(result.applied.length, 0);
  assert.match(result.rejected[0].reason, /rejected/);
});
test("drop wordless splices and trim first/last to accepted speech without restoring the raw head", () => {
  const original = plan();
  original.kept_segments.unshift({ source_start_seconds: 0, source_end_seconds: 0.1, start_seconds: 0, end_seconds: 0.1 });
  for (const segment of original.kept_segments.slice(1)) { segment.start_seconds += 0.1; segment.end_seconds += 0.1; }
  for (const word of original.words) { word.start += 0.1; word.end += 0.1; }
  original.duration_seconds += 0.1;
  const result = repairRecordingPlan(original);
  assert.equal(result.plan.kept_segments.length, 2);
  assert.equal(result.plan.kept_segments[0].source_start_seconds, 1.1);
  assert.equal(result.plan.kept_segments.at(-1).source_end_seconds, 3.5);
  assert.ok(result.applied.some((request) => request.kind === "drop-wordless-splice"));
  assert.equal(result.plan.words.at(-1).end, result.plan.duration_seconds);
});
test("independent acoustic and retranscription proof preserves a restored first speech onset", () => {
  const original = [{ word: "Useful", start: 1.1, end: 1.5 }, ...source.slice(1)];
  const request = { ...expand(0, "start"), evidence: { acoustic_proven: true, retranscription_proven: true, source_word: { word: "Useful", start: 1, end: 1.5 } } };
  const result = repairRecordingPlan(plan(), [request], { sourceTranscript: original });
  assert.equal(result.plan.kept_segments[0].source_start_seconds, 1);
  assert.equal(result.plan.words[0].start, 0);
  const unproven = repairRecordingPlan(plan(), [{ ...request, evidence: { ...request.evidence, acoustic_proven: false } }], { sourceTranscript: original, trimEdges: false });
  assert.equal(unproven.changed, false);
});
test("invalid mapping and excessive expansion policy reject before repair", () => {
  const invalid = plan(); invalid.kept_segments[0].start_seconds = NaN;
  assert.throws(() => repairRecordingPlan(invalid), /mapping/);
  assert.throws(() => repairRecordingPlan(plan(), [], { maxExpansionSeconds: 0.3 }), /policy/);
});
test("PCM seam impulse is a candidate while a sustained vowel is not", async () => {
  const impulse = Buffer.alloc(3840 * 4);
  impulse.writeFloatLE(0.8, 1920 * 4);
  const report = await analyzeRecordingJoins("local.wav", plan(), {}, { run: async () => ({ stdout: impulse }) });
  assert.equal(report.issues.length, 1);
  assert.equal(report.issues[0].proven, false);
  const voiced = Buffer.alloc(3840 * 4);
  for (let index = 0; index < 3840; index++) voiced.writeFloatLE(0.4 * Math.sin(index * 0.03), index * 4);
  const natural = await analyzeRecordingJoins("local.wav", plan(), {}, { run: async () => ({ stdout: voiced }) });
  assert.equal(natural.issues.length, 0);
});
test("join batches preserve original indexes and never claim partial coverage passes", async () => {
  const segments = Array.from({ length: 301 }, (_, index) => ({ source_start_seconds: index * 0.3, source_end_seconds: index * 0.3 + 0.2, start_seconds: index * 0.2, end_seconds: index * 0.2 + 0.2 }));
  const many = { source_duration_seconds: 91, duration_seconds: segments.at(-1).end_seconds, kept_segments: segments, words: segments.map((segment, index) => ({ word: `word${index}`, start: segment.start_seconds + 0.02, end: segment.end_seconds - 0.02 })), removed_segments: [] };
  const adapters = { run: async () => ({ stdout: Buffer.alloc(3840 * 4) }) };
  const reports = [];
  let offset = 0;
  do {
    const report = await analyzeRecordingJoins("local.wav", many, { joinOffset: offset }, adapters);
    reports.push(report);
    assert.equal(report.checked, false);
    assert.equal(report.total_joins, 300);
    assert.equal(report.unresolved_joins.length, 300 - report.sampled_joins);
    offset = report.next_join_offset;
  } while (offset !== null);
  assert.deepEqual(reports.map((report) => report.sampled_joins), [128, 128, 44]);
  assert.deepEqual(reports.map((report) => report.join_offset), [0, 128, 256]);
  assert.deepEqual(reports.flatMap((report) => report.measurements.map((measurement) => measurement.segment_index)), Array.from({ length: 300 }, (_, index) => index + 1));
  for (const invalid of [-1, 0.5, 301]) await assert.rejects(analyzeRecordingJoins("local.wav", many, { joinOffset: invalid }, adapters), /joinOffset/);
  const end = await analyzeRecordingJoins("local.wav", many, { joinOffset: 300 }, adapters);
  assert.equal(end.sampled_joins, 0);
  assert.equal(end.checked, false);
  assert.equal(end.next_join_offset, null);
  assert.equal(end.unresolved_joins.length, 300);
});
test("a repair elsewhere keeps the rejected cuts in a gap as they were", () => {
  // The gap before "tools." holds a splice handle, a false start and another
  // handle; repairing the first segment must not merge them into one cut,
  // since audio_analysis spans and QA cite the false start's own boundary.
  const candidate = plan();
  candidate.removed_segments.splice(1, 1,
    { source_start_seconds: 1.9, source_end_seconds: 2.2, reason: "rejected-splice-handle" },
    { source_start_seconds: 2.2, source_end_seconds: 2.8, reason: "false-start" },
    { source_start_seconds: 2.8, source_end_seconds: 3.1, reason: "rejected-splice-handle" });
  const result = repairRecordingPlan(candidate, [expand(0, "start")], { sourceTranscript: source, trimEdges: false });
  assert.equal(result.applied.length, 1);
  const gap = result.plan.removed_segments.filter((cut) => cut.source_start_seconds >= 1.9 - 1e-6 && cut.source_end_seconds <= 3.1 + 1e-6);
  assert.deepEqual(gap.map((cut) => [cut.source_start_seconds, cut.source_end_seconds, cut.reason]), [[1.9, 2.2, "rejected-splice-handle"], [2.2, 2.8, "false-start"], [2.8, 3.1, "rejected-splice-handle"]]);
  // The repaired head: the silence cut is clipped to the new keep start.
  assert.deepEqual(result.plan.removed_segments[0], { source_start_seconds: 0, source_end_seconds: 1, reason: "waveform-silence" });
});
