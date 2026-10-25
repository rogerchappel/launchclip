import test from "node:test";
import assert from "node:assert/strict";
import { planRecordingEdit } from "../src/recording_edit.js";
import { identifySemanticRetakes, semanticTranscriptHash, validateSemanticRetakes } from "../src/semantic_retakes.js";
import { repairRecordingPlan } from "../src/recording_qa_repair.js";

function phrase(text, start = 1) { return text.split(" ").map((word, index) => ({ word, start: start + index * 0.3, end: start + index * 0.3 + 0.2 })); }
function restart(first, last, next, final, explanation = "The restatement replaces the abandoned words.") {
  return { earlier: { first_word: first, last_word: last }, later: { first_word: next, last_word: final }, later_complete: true, explanation };
}
function duration(words) { return words.at(-1).end + 1; }

test("a short exact restart inside a sentence is cut and its restatement kept", () => {
  const words = phrase("You get actual code templates, you get actual code templates and tools I use, live builds.");
  const plan = planRecordingEdit(words, { durationSeconds: duration(words) });
  assert.equal(plan.text, "you get actual code templates and tools I use, live builds.");
  const cut = plan.removed_segments.find((range) => range.reason === "false-start");
  assert.equal(cut.source_start_seconds <= words[0].start, true);
  assert.equal(cut.source_end_seconds >= words[4].end && cut.source_end_seconds <= words[5].start, true);
});

test("chained short restarts keep only the final launch", () => {
  const words = phrase("Then you get, you get, you get actual feedback from people.");
  assert.equal(planRecordingEdit(words, { durationSeconds: duration(words) }).text, "Then you get actual feedback from people.");
});

test("emphasis, single-word doubling and whole repeated sentences are left to their own rules", () => {
  for (const text of [
    "It works every time, it works every time.", // the restatement does not go on
    "This is very very good for the team.", // a single doubled word
    "We ship fast. We ship fast and often.", // a complete earlier sentence, not an abandoned run
    "Say no no to that.", // too few distinct words
  ]) {
    const words = phrase(text);
    assert.equal(planRecordingEdit(words, { durationSeconds: duration(words) }).text, text, text);
  }
  const words = phrase("You get actual code templates, you get actual code templates and tools.");
  assert.equal(planRecordingEdit(words, { durationSeconds: duration(words), takePolicy: "none" }).text, words.map((word) => word.word).join(" "));
  // Six or more repeated words stay with the passage-level retake detector.
  const long = phrase("We can help every team, we can help every team, ship it.");
  assert.equal(planRecordingEdit(long, { durationSeconds: duration(long) }).text, "we can help every team, ship it.");
  assert.equal(planRecordingEdit(long, { durationSeconds: duration(long), minRepeatWords: 4 }).text, long.map((word) => word.word).join(" "));
});

test("a repeated connective after a clause comma abandons the first launch", () => {
  const words = phrase("Everyone says so, but however, but whatever comes next, someone builds it.");
  const plan = planRecordingEdit(words, { durationSeconds: duration(words) });
  assert.equal(plan.text, "Everyone says so, but whatever comes next, someone builds it.");
  assert.ok(plan.removed_segments.some((range) => range.reason === "false-start"));
  const contrast = phrase("We tried, but we can ship it, but only next week.");
  assert.equal(planRecordingEdit(contrast, { durationSeconds: duration(contrast) }).text, contrast.map((word) => word.word).join(" "));
});

test("bound word-level restart decisions remove only the abandoned words", async () => {
  const words = phrase("So less consuming, shipping, more shipping, enter ship mode.");
  const decisions = { transcript_hash: semanticTranscriptHash(words), retakes: [], restarts: [restart(3, 3, 4, 5)] };
  const result = await identifySemanticRetakes(words, { decisions, durationSeconds: duration(words) });
  assert.deepEqual(result.restarts, [restart(3, 3, 4, 5)]);
  assert.deepEqual(result.removals.map(({ first_word, last_word, reason }) => ({ first_word, last_word, reason })), [{ first_word: 3, last_word: 3, reason: "semantic-restart" }]);
  const plan = planRecordingEdit(words, { durationSeconds: duration(words), semanticRetakes: result.retakes, semanticRestarts: result.restarts });
  assert.equal(plan.text, "So less consuming, more shipping, enter ship mode.");
  assert.ok(plan.removed_segments.some((range) => range.reason === "semantic-restart"));
  assert.throws(() => validateSemanticRetakes({ ...decisions, transcript_hash: semanticTranscriptHash(phrase("So less consuming.")) }, words), /transcript_hash/);
});

test("invalid word-level restarts fail closed", () => {
  const words = [...phrase("We can build, we really can build products here.", 1), ...phrase("Then we ship.", 6)];
  const receipt = (restarts) => ({ transcript_hash: semanticTranscriptHash(words), retakes: [], restarts });
  const cases = [
    [restart(0, 2, 2, 6), /strictly later/],
    [restart(0, 1, 3, 6), /immediately/], // "can build," then a unique "we" in between
    [restart(0, 2, 3, 3), /two words/],
    [restart(0, 2, 3, 10), /one passage/],
    [restart(0, 2, 3, 6, " "), /explained/],
    [{ ...restart(0, 2, 3, 6), later_complete: false }, /complete/],
    [restart(0, 2, 3, 99), /valid inclusive/],
  ];
  for (const [entry, pattern] of cases) assert.throws(() => validateSemanticRetakes(receipt([entry]), words), pattern);
  assert.throws(() => validateSemanticRetakes({ ...receipt([]), restarts: {} }, words), /restarts array/);
  assert.throws(() => validateSemanticRetakes(receipt([restart(0, 2, 3, 6), restart(1, 2, 3, 6)]), words), /overlap/);
  assert.throws(() => validateSemanticRetakes(receipt([restart(0, 2, 3, 6), restart(3, 3, 4, 6)]), words), /restatement/);
  const many = phrase("one two three four five six seven eight nine ten eleven twelve thirteen, one two three four five six seven eight nine ten eleven twelve thirteen fourteen.");
  assert.throws(() => validateSemanticRetakes({ transcript_hash: semanticTranscriptHash(many), retakes: [], restarts: [restart(0, 12, 13, 26)] }, many), /more than 12 words/);
  const late = [...phrase("We can build,", 1), ...phrase("we can build it.", 6)];
  assert.throws(() => validateSemanticRetakes({ transcript_hash: semanticTranscriptHash(late), retakes: [], restarts: [restart(0, 2, 3, 6)] }, late), /restart window|one passage/);
  // Only filler words may sit between the abandoned words and the restatement.
  const filled = phrase("We can, um, we can build it.");
  const plan = planRecordingEdit(filled, { durationSeconds: duration(filled), semanticRestarts: validateSemanticRetakes({ transcript_hash: semanticTranscriptHash(filled), retakes: [], restarts: [restart(0, 1, 3, 6)] }, filled).restarts });
  assert.equal(plan.text, "we can build it.");
});

test("the latest restatement wins for a repeated decision and restarts can clean a kept retake", () => {
  const words = phrase("We help teams. We help, we help teams ship, we help teams ship faster.");
  const hash = semanticTranscriptHash(words);
  const result = validateSemanticRetakes({ transcript_hash: hash, retakes: [], restarts: [restart(3, 4, 5, 8), restart(3, 4, 5, 12), restart(3, 4, 5, 6)] }, words);
  assert.deepEqual(result.restarts, [restart(3, 4, 5, 12)]);
  const retake = { earlier: { first_word: 0, last_word: 2 }, later: { first_word: 3, last_word: 13 }, later_complete: true, explanation: "The later passage restates it." };
  // The restart cleans the retained retake; the lexical stage removes the exact second launch.
  const plan = planRecordingEdit(words, { durationSeconds: duration(words), semanticRetakes: [retake], semanticRestarts: [restart(3, 4, 5, 8)] });
  assert.equal(plan.text, "we help teams ship faster.");
  const merged = planRecordingEdit(words, { durationSeconds: duration(words), takePolicy: "none", semanticRetakes: [retake], semanticRestarts: [restart(3, 8, 9, 13)] });
  assert.equal(merged.text, "we help teams ship faster.");
  assert.throws(() => planRecordingEdit(words, { durationSeconds: duration(words), semanticRestarts: [restart(3, 4, 5, 8), restart(5, 6, 7, 10)] }), /retained restatement/);
  assert.throws(() => planRecordingEdit(words, { durationSeconds: duration(words), semanticRestarts: {} }), /semanticRestarts must be an array/);
});

test("the model prompt asks for in-sentence restarts and returns them validated", async () => {
  const words = phrase("So less consuming, shipping, more shipping, enter ship mode.");
  let request;
  const result = await identifySemanticRetakes(words, {}, { infer: async (input) => { request = input; return JSON.stringify({ retakes: [], restarts: [restart(3, 3, 4, 5)] }); } });
  assert.match(request.prompt, /restarts INSIDE a sentence/);
  assert.equal(request.schema.properties.restarts.type, "array");
  assert.deepEqual(result.restarts, [restart(3, 3, 4, 5)]);
  assert.deepEqual((await identifySemanticRetakes(words, {}, { infer: async () => ({ retakes: [] }) })).restarts, []);
});

test("QA repair never re-expands a boundary into removed restart speech", () => {
  const words = phrase("So less consuming, shipping, more shipping, enter ship mode.");
  const plan = planRecordingEdit(words, { durationSeconds: duration(words), semanticRestarts: [restart(3, 3, 4, 5)] });
  const index = plan.kept_segments.findIndex((segment) => segment.source_start_seconds >= words[3].end - 1e-6);
  assert.equal(plan.kept_segments[index].source_start_seconds, words[3].end);
  // An independent timing that starts "more" inside the removed restart.
  const source = words.map((word, position) => position === 4 ? { ...word, start: words[3].end - 0.05 } : position === 3 ? { ...word, end: words[3].end - 0.05 } : word);
  const result = repairRecordingPlan(plan, [{ kind: "expand-boundary", segment_index: index, edge: "start", seconds: 0.2, explanation: "Output ASR disagrees at the join." }], { sourceTranscript: source });
  assert.equal(result.applied.filter((entry) => entry.kind === "expand-boundary").length, 0);
  assert.match(result.rejected[0].reason, /rejected filler or take audio/);
});

test("a restart that abuts the kept words is cut from the audio when pauses are preserved", () => {
  // Contiguous timings, as recognisers give them: "so AI, AI does the lifting."
  const words = [["so", 1, 1.1], ["AI,", 1.1, 1.4], ["AI", 1.5, 1.6], ["does", 1.6, 2.0], ["the", 2.0, 2.2], ["lifting.", 2.2, 2.7]].map(([word, start, end]) => ({ word, start, end }));
  const plan = planRecordingEdit(words, { durationSeconds: 3, silenceDuration: null, semanticRestarts: [restart(1, 1, 2, 5)] });
  assert.equal(plan.text, "so AI does the lifting.");
  assert.equal(plan.kept_segments.some((range) => range.source_start_seconds < 1.4 && range.source_end_seconds > 1.1), false);
  assert.deepEqual(plan.kept_segments.map((range) => [range.source_start_seconds, range.source_end_seconds]), [[0, 1.1], [1.4, 3]]);
});
