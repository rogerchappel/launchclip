import test from "node:test";
import assert from "node:assert/strict";
import { planRecordingEdit } from "../src/recording_edit.js";
function phrase(text, start = 1) { return text.split(" ").map((word, index) => ({ word, start: start + index * 0.3, end: start + index * 0.3 + 0.2 })); }
function decision(first, last, next, final) { return { earlier: { first_word: first, last_word: last }, later: { first_word: next, last_word: final }, later_complete: true, explanation: "Later phrasing completes the same thought." }; }

test("semantic paraphrase decisions cut source words without changing unique speech order", () => {
  const words = [...phrase("We make the process easier.", 1), ...phrase("A useful example follows.", 4), ...phrase("This simplifies how people work.", 7)];
  const plan = planRecordingEdit(words, { durationSeconds: 11, semanticRetakes: [decision(0, 4, 9, 13)], takePolicy: "none" });
  assert.equal(plan.text, "A useful example follows. This simplifies how people work.");
  assert.ok(plan.removed_segments.some((range) => range.reason === "semantic-retake"));
  for (const word of words.slice(0, 5)) assert.equal(plan.kept_segments.some((range) => range.source_start_seconds < word.end && range.source_end_seconds > word.start), false);
});
test("semantic final take stays protected when lexical matching finds a later similar sentence", () => {
  const words = [...phrase("This helps everyone work more efficiently.", 1), ...phrase("We build useful products and ship together.", 5), ...phrase("We build useful products and ship together.", 9)];
  const plan = planRecordingEdit(words, { durationSeconds: 13, semanticRetakes: [decision(0, 5, 6, 12)] });
  assert.equal(plan.text, "We build useful products and ship together. We build useful products and ship together.");
});
test("semantic indexes remain original after fillers and preserve paused source moments", () => {
  const words = [...phrase("Um we make work simpler.", 1), ...phrase("This makes the job easy.", 5)];
  const plan = planRecordingEdit(words, { durationSeconds: 9, silenceDuration: null, semanticRetakes: [decision(0, 4, 5, 9)] });
  assert.equal(plan.text, "This makes the job easy.");
  assert.equal(plan.removed_segments[0].reason, "semantic-retake");
  assert.equal(plan.kept_segments.at(-1).source_end_seconds, 9);
});
test("invalid semantic word bounds, ordering, completeness, explanation and window reject", () => {
  const words = [...phrase("We simplify the process.", 1), ...phrase("People can work easily.", 5)];
  const bad = [decision(-1, 3, 4, 7), decision(0, 8, 4, 7), decision(0.5, 3, 4, 7), decision(4, 7, 0, 3), { ...decision(0, 3, 4, 7), later_complete: false }, { ...decision(0, 3, 4, 7), explanation: "" }];
  for (const retake of bad) assert.throws(() => planRecordingEdit(words, { durationSeconds: 9, semanticRetakes: [retake] }), /Semantic retake/);
  assert.throws(() => planRecordingEdit(words, { durationSeconds: 9, semanticRetakes: [decision(0, 3, 4, 7)], retakeWindow: 1 }), /retakeWindow/);
});
test("exact semantic chains keep only the terminal later take", () => {
  const words = [...phrase("This makes the job easier.", 1), ...phrase("We simplify how people work.", 5), ...phrase("People get things done easily.", 9)];
  const plan = planRecordingEdit(words, { durationSeconds: 13, semanticRetakes: [decision(0, 4, 5, 9), decision(5, 9, 10, 14)] });
  assert.equal(plan.text, "People get things done easily.");
  assert.throws(() => planRecordingEdit(words, { durationSeconds: 13, semanticRetakes: [decision(0, 4, 5, 9), decision(8, 9, 10, 14)] }), /conflict/);
});
