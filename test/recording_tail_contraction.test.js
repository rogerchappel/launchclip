import test from "node:test";
import assert from "node:assert/strict";
import { planRecordingEdit } from "../src/recording_edit.js";
import { provenRejectedTail, refineRecordingEditPlan, rejectedTailWindows } from "../src/recording_audio.js";
import { pcmFrameLevels } from "../src/recording_consensus.js";
import { assessRecordingQa } from "../src/recording_qa.js";
import { repairRecordingPlan } from "../src/recording_qa_repair.js";

const RATE = 16000;
const DURATION = 4;
const THRESHOLD = -50;
/** Synthetic mono float PCM: room tone, voiced spans, optional exponential decay. */
function pcm(voiced) {
  const buffer = Buffer.alloc(DURATION * RATE * 4);
  for (let index = 0; index < buffer.length / 4; index++) {
    const time = index / RATE;
    let value = 0.0005 * Math.sin(index * 1.7);
    for (const span of voiced) {
      if (time < span.start || time >= span.end) continue;
      value += 0.2 * (span.decay ? Math.exp(-(time - span.start) / span.decay) : 1) * Math.sin(2 * Math.PI * 180 * time);
    }
    buffer.writeFloatLE(value, index * 4);
  }
  return buffer;
}
// A rejected take ends on "stuck." at 1.0s; its tail decays into quiet; the
// chosen "And" starts at 2.0s, but the primary recogniser starts it at 1.0s.
const tail = { start: 1.0, end: 1.3, decay: 0.03 };
const speech = [{ start: 0.1, end: 1.0 }, { start: 2.0, end: 3.6 }];
const words = [
  { word: "We", start: 0.1, end: 0.3 }, { word: "get", start: 0.3, end: 0.5 }, { word: "stuck.", start: 0.5, end: 1.0 },
  { word: "And", start: 1.0, end: 2.4 }, { word: "honestly", start: 2.45, end: 2.9 }, { word: "we", start: 2.95, end: 3.2 }, { word: "ship.", start: 3.25, end: 3.6 },
];
const retake = { earlier: { first_word: 0, last_word: 2 }, later: { first_word: 3, last_word: 6 }, later_complete: true, explanation: "The later take restates it." };
const independent = [{ word: "And", start: 2.0, end: 2.38, model: "small.en" }];

function fixture(voiced = [...speech, tail]) {
  const plan = planRecordingEdit(words, { durationSeconds: DURATION, silenceDuration: null, semanticRetakes: [retake] });
  const levels = pcmFrameLevels(pcm(voiced));
  const analysis = {
    source_duration_seconds: DURATION, threshold_db: -45,
    threshold_receipt: { noise_floor_db: -69 },
    silence_intervals: [{ start_seconds: 0, end_seconds: 0.1 }, { start_seconds: 1.2, end_seconds: 2.0 }, { start_seconds: 3.6, end_seconds: 4 }],
    boundary_silence_receipt: { threshold_db: THRESHOLD, minimum_duration_seconds: 0.02 },
    boundary_silence_intervals: [{ start_seconds: 0, end_seconds: 0.1 }, { start_seconds: 1.2, end_seconds: 2.0 }, { start_seconds: 3.6, end_seconds: 4 }],
    tail_windows: rejectedTailWindows(plan, DURATION, levels),
    waveform: [],
  };
  return { plan, analysis, levels };
}

test("the envelope proves a rejected word's decaying tail and refuses a new onset", () => {
  const { analysis } = fixture();
  const proof = provenRejectedTail(analysis.tail_windows, 1.0, THRESHOLD);
  assert.ok(proof.tail_end_seconds > 1.05 && proof.tail_end_seconds < 1.3, `tail ends at ${proof.tail_end_seconds}`);
  assert.equal(proof.quiet_end_seconds, 2.0);
  // Another word starting after the cut rises again: not a tail.
  const onset = fixture([...speech, tail, { start: 1.08, end: 1.18 }]).analysis;
  assert.equal(provenRejectedTail(onset.tail_windows, 1.0, THRESHOLD), null);
  // A slow decay lasting past 0.4s is not a word's tail.
  const slow = fixture([...speech, { start: 1.0, end: 1.9, decay: 0.3 }]).analysis;
  assert.equal(provenRejectedTail(slow.tail_windows, 1.0, THRESHOLD), null);
  // Quiet at the cut: there is no tail to remove.
  const clean = fixture(speech).analysis;
  assert.equal(provenRejectedTail(clean.tail_windows, 1.0, THRESHOLD), null);
  assert.throws(() => rejectedTailWindows(fixture().plan, DURATION, { step_seconds: 0.1, levels_db: [] }), /10ms/);
});

test("a keep starting inside a proven tail contracts to the quiet before the independently aligned word", () => {
  const { plan, analysis } = fixture();
  const refined = refineRecordingEditPlan(plan, analysis, { trimEdges: false, independentWords: independent });
  const [contraction] = refined.audio_analysis.tail_contractions;
  assert.equal(contraction.source_keep_boundary_seconds, 1.0);
  assert.ok(contraction.contracted_to_seconds > contraction.quiet_start_seconds && contraction.contracted_to_seconds <= 2.0);
  assert.equal(contraction.chosen_word.independent_model, "small.en");
  assert.equal(refined.kept_segments[0].source_start_seconds, contraction.contracted_to_seconds);
  assert.ok(refined.removed_segments.some((cut) => cut.reason === "rejected-speech-tail" && cut.source_start_seconds === 1.0));
  // The chosen word takes the independent start; its own end stays.
  const offset = refined.kept_segments[0].source_start_seconds - refined.kept_segments[0].start_seconds;
  assert.deepEqual([refined.words[0].start + offset, refined.words[0].end + offset].map((time) => Math.round(time * 1000) / 1000), [2.0, 2.4]);
  assert.equal(refined.audio_analysis.ambiguous_word_spans.length, 0);
  assert.equal(refined.text, "And honestly we ship.");
});

test("without every proof the boundary stays and the ambiguous span still needs review", () => {
  const cases = [
    ["no independent alignment", fixture(), []],
    ["the other recogniser agrees with the early start", fixture(), [{ word: "And", start: 1.02, end: 2.38, model: "small.en" }]],
    ["the independent word is a different word", fixture(), [{ word: "So", start: 2.0, end: 2.38, model: "small.en" }]],
    ["no decaying tail in the envelope", fixture([...speech, tail, { start: 1.08, end: 1.18 }]), independent],
  ];
  for (const [label, { plan, analysis }, independentWords] of cases) {
    const refined = refineRecordingEditPlan(plan, analysis, { trimEdges: false, independentWords });
    assert.equal(refined.audio_analysis.tail_contractions.length, 0, label);
    assert.equal(refined.kept_segments[0].source_start_seconds, 1.0, label);
    assert.equal(refined.audio_analysis.ambiguous_word_spans.length, 1, label);
  }
  const { plan, analysis } = fixture();
  assert.throws(() => refineRecordingEditPlan(plan, analysis, { independentWords: [{ word: "And", start: 2, end: 1, model: "x" }] }), /Invalid audio/);
});

test("QA records the contraction with its proof, and repairs cannot restore the tail", () => {
  const { plan, analysis } = fixture();
  const refined = refineRecordingEditPlan(plan, analysis, { trimEdges: false, independentWords: independent });
  const qa = assessRecordingQa(refined, refined.words);
  const [issue] = qa.issues.filter((entry) => entry.kind === "rejected-tail-contraction");
  assert.equal(issue.blocking, false);
  assert.equal(issue.segment_index, 0);
  assert.match(issue.explanation, /small\.en starts the word at 2\.00s/);
  const forged = { ...refined, audio_analysis: { ...refined.audio_analysis, tail_contractions: [{ ...refined.audio_analysis.tail_contractions[0], contracted_to_seconds: 0.5 }] } };
  assert.throws(() => assessRecordingQa(forged, refined.words), /rejected-tail contraction/);
  const source = words.map((word, index) => index === 3 ? { ...word, start: refined.kept_segments[0].source_start_seconds - 0.1, end: 2.4 } : word);
  const repaired = repairRecordingPlan(refined, [{ kind: "expand-boundary", segment_index: 0, edge: "start", seconds: 0.2, explanation: "Output ASR disagrees at the join." }], { sourceTranscript: source });
  assert.equal(repaired.applied.filter((entry) => entry.kind === "expand-boundary").length, 0);
  assert.match(repaired.rejected[0].reason, /rejected filler or take audio/);
});
