import test from "node:test";
import assert from "node:assert/strict";
import { analyzeRecordingAudio, refineRecordingEditPlan } from "../src/recording_audio.js";

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

test("verified separators preserve accepted consonant tails and exclude untranscribed rejected residue", () => {
  const source = fixture("repeated-take");
  const analysis = { source_duration_seconds: 10, threshold_db: -40, silence_intervals: [],
    boundary_silence_intervals: [{ start_seconds: 1.64, end_seconds: 1.69 }, { start_seconds: 3.65, end_seconds: 3.75 }] };
  const refined = refineRecordingEditPlan(source, analysis, { trimEdges: false });
  assert.ok(Math.abs(refined.kept_segments[0].source_end_seconds - 1.665) < 1e-9, "cut inside quiet after the untranscribed chosen tail");
  assert.ok(Math.abs(refined.kept_segments[1].source_start_seconds - 3.7) < 1e-9, "cut after rejected voiced residue, inside quiet before chosen onset");
  assert.deepEqual(refined.words.map((word) => word.source_index), source.words.map((word) => word.source_index));
  assert.ok(Math.abs(refined.words[1].end - refined.words[1].start - 0.05) < 1e-9);
  assert.equal(refined.removed_segments.find((range) => range.reason === "rejected-splice-handle").source_start_seconds, 1.665);
});

test("separator search is bounded and never crosses accepted words or original rejected ranges", () => {
  const source = fixture("filler");
  const analysis = { source_duration_seconds: 10, threshold_db: -40, silence_intervals: [],
    boundary_silence_intervals: [{ start_seconds: 1.995, end_seconds: 2.2 }, { start_seconds: 3.79, end_seconds: 3.85 }] };
  const refined = refineRecordingEditPlan(source, analysis, { trimEdges: false });
  assert.equal(refined.kept_segments[0].source_end_seconds, 1.5, "separator has too little quiet inside original keep");
  assert.equal(refined.kept_segments[1].source_start_seconds, 3.8, "overlapping chosen word leaves too little confirmed quiet");
  assert.throws(() => refineRecordingEditPlan(source, { ...analysis, boundary_silence_intervals: [{ start_seconds: NaN, end_seconds: 4 }] }), /range/);
  assert.throws(() => refineRecordingEditPlan(source, { ...analysis, boundary_silence_intervals: {} }), /boundary silence/);
});

test("noise-relative confirmation preserves soft tails and rejects brief dips before resumed energy", async () => {
  const calls = [];
  const analysis = await analyzeRecordingAudio("fixture.wav", { durationSeconds: 10, thresholdDb: -40 }, { run: async (_, args) => {
    const filter = args[args.indexOf("-af") + 1]; calls.push(filter);
    if (filter.includes("astats")) return { stdout: "pts_time:0\nlavfi.astats.Overall.RMS_level=-60\npts_time:0.1\nlavfi.astats.Overall.RMS_level=-20", stderr: "" };
    if (filter.includes("noise=-54dB")) return { stdout: "", stderr: "silence_start: 1.53\nsilence_end: 1.55\nsilence_start: 1.75\nsilence_end: 1.9\nsilence_start: 3.6\nsilence_end: 3.85" };
    return { stdout: "", stderr: "silence_start: 1.51\nsilence_end: 1.9" };
  } });
  assert.ok(calls.some((filter) => filter.includes("silencedetect=noise=-54dB:d=0.04")));
  assert.equal(analysis.boundary_silence_receipt.threshold_db, -54);
  assert.equal(analysis.boundary_silence_receipt.join_tolerance_seconds, 0);
  assert.equal(analysis.boundary_silence_intervals.length, 2, "20ms dip is not a separator");
  const refined = refineRecordingEditPlan(fixture("filler"), analysis, { trimEdges: false });
  assert.equal(refined.kept_segments[0].source_end_seconds, 1.825, "keeps soft accepted tail below dialogue cutoff until sustained noise-relative quiet");
  assert.ok(refined.kept_segments[1].source_start_seconds > 3.6 && refined.kept_segments[1].source_start_seconds < 3.8);
  assert.deepEqual(refined.audio_analysis.unconfirmed_boundaries, []);
  const withDialogueQuiet = refineRecordingEditPlan(fixture("filler"), { ...analysis, silence_intervals: [{ start_seconds: 1.51, end_seconds: 1.9 }] }, { trimEdges: false });
  assert.equal(withDialogueQuiet.kept_segments[0].source_end_seconds, 1.825, "normal pause cutoff cannot undo stricter acoustic tail protection");
});

test("no confirmed separator preserves original handles with unresolved receipt instead of clipping", () => {
  const source = fixture("semantic-retake");
  const refined = refineRecordingEditPlan(source, { source_duration_seconds: 10, threshold_db: -40, silence_intervals: [], boundary_silence_intervals: [], boundary_silence_receipt: { threshold_db: -54 } }, { trimEdges: false });
  assert.deepEqual(refined.kept_segments, source.kept_segments);
  assert.deepEqual(refined.audio_analysis.unconfirmed_boundaries.map((boundary) => boundary.side), ["end", "start"]);
  assert.equal(refined.audio_analysis.rejected_splice_removed_seconds, 0);
});

test("boundary cutoff stays below dialogue cutoff in noisy backgrounds and is bounded for low floors", async () => {
  for (const [floor, expected] of [[-25, -40], [-110, -80]]) {
    const analysis = await analyzeRecordingAudio("fixture.wav", { durationSeconds: 2, thresholdDb: -40 }, { run: async (_, args) => args[args.indexOf("-af") + 1].includes("astats") ? { stdout: `pts_time:0\nlavfi.astats.Overall.RMS_level=${floor}\npts_time:0.1\nlavfi.astats.Overall.RMS_level=-20`, stderr: "" } : { stdout: "", stderr: "" } });
    assert.equal(analysis.boundary_silence_receipt.threshold_db, expected);
  }
});

test("analysis retains short precise separators without debounce while long-gap trimming remains separate", async () => {
  const analysis = await analyzeRecordingAudio("fixture.wav", { durationSeconds: 2, thresholdDb: -40 }, { run: async (_, args) => args.includes("-af") && args[args.indexOf("-af") + 1].includes("astats")
    ? { stdout: "pts_time:0\nlavfi.astats.Overall.RMS_level=-20", stderr: "" }
    : { stdout: "", stderr: "silence_start: 0.4\nsilence_end: 0.45\nsilence_start: 0.455\nsilence_end: 0.5\nsilence_start: 1\nsilence_end: 1.5" } });
  assert.deepEqual(analysis.boundary_silence_intervals, [{ start_seconds: 0.4, end_seconds: 0.45 }, { start_seconds: 0.455, end_seconds: 0.5 }, { start_seconds: 1, end_seconds: 1.5 }]);
  assert.deepEqual(analysis.silence_intervals, [{ start_seconds: 1, end_seconds: 1.5 }]);
});
