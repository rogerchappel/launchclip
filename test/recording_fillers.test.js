import test from "node:test";
import assert from "node:assert/strict";
import { planRecordingEdit } from "../src/recording_edit.js";
function phrase(text, start = 1) { return text.split(" ").map((word, index) => ({ word, start: start + index * 0.3, end: start + index * 0.3 + 0.2 })); }
function intersects(plan, word) { return plan.kept_segments.some((segment) => segment.source_start_seconds < word.end - 0.00001 && segment.source_end_seconds > word.start + 0.00001); }

test("lexical filler tokens are physically cut even inside short speech gaps", () => {
  const words = phrase("We um build uh tools erm and er ship umm them uhh today.");
  const plan = planRecordingEdit(words, { durationSeconds: 6, takePolicy: "none" });
  assert.equal(plan.text, "We build tools and ship them today.");
  for (const word of words.filter((entry) => /^(um|uh|erm|er|umm|uhh)$/.test(entry.word))) assert.equal(intersects(plan, word), false);
  assert.equal(plan.removed_segments.filter((segment) => segment.reason === "filler").length, 6);
  assert.ok(plan.words.every((word) => word.start >= 0 && word.end <= plan.duration_seconds));
});
test("speech handles cannot include a leading or trailing rejected filler", () => {
  const words = phrase("Um, useful speech uhh.");
  const plan = planRecordingEdit(words, { durationSeconds: 4, silencePadding: 0.5, takePolicy: "none" });
  assert.equal(plan.text, "useful speech");
  assert.equal(intersects(plan, words[0]), false);
  assert.equal(intersects(plan, words.at(-1)), false);
});
test("disabling pause trim still removes filler words and keeps every other source moment", () => {
  const words = phrase("We um build useful tools.");
  const plan = planRecordingEdit(words, { durationSeconds: 5, silenceDuration: null, takePolicy: "none" });
  assert.equal(plan.text, "We build useful tools.");
  assert.equal(intersects(plan, words[1]), false);
  assert.equal(plan.kept_segments[0].source_start_seconds, 0);
  assert.equal(plan.kept_segments.at(-1).source_end_seconds, 5);
  assert.ok(Math.abs(plan.duration_seconds - 4.8) < 1e-9);
});
test("filler optout preserves words and grammatical but or like", () => {
  const words = phrase("Um I like this but we need time.");
  const plan = planRecordingEdit(words, { durationSeconds: 5, removeFillers: false, takePolicy: "none" });
  assert.equal(plan.text, "Um I like this but we need time.");
  const clean = planRecordingEdit(words, { durationSeconds: 5, takePolicy: "none" });
  assert.equal(clean.text, "I like this but we need time.");
});
test("abandoned connective opening yields to final connective without clipping retained words", () => {
  const words = phrase("But however, but whatever comes next someone must build it.");
  const plan = planRecordingEdit(words, { durationSeconds: 6, takePolicy: "none" });
  assert.equal(plan.text, "but whatever comes next someone must build it.");
  assert.equal(plan.removed_segments[0].reason, "false-start");
  assert.equal(intersects(plan, words[0]), false);
  assert.equal(intersects(plan, words[1]), false);
  assert.equal(intersects(plan, words[2]), true);
});
test("pause after grammatical but stays; explicitly abandoned standalone but is cut", () => {
  const words = [{ word: "But", start: 1, end: 1.2 }, ...phrase("we can build this.", 2)];
  assert.equal(planRecordingEdit(words, { durationSeconds: 5 }).text, "But we can build this.");
  words[0].word = "But.";
  const plan = planRecordingEdit(words, { durationSeconds: 5, silenceDuration: null });
  assert.equal(plan.text, "we can build this.");
  assert.ok(plan.removed_segments.some((segment) => segment.reason === "false-start"));
});
test("filler removal and last-take cleanup compose without retaining rejected audio", () => {
  const first = phrase("We um build useful products and ship together.", 1);
  const second = phrase("We build useful products and ship together.", 6);
  const plan = planRecordingEdit([...first, ...second], { durationSeconds: 10, silenceDuration: null });
  assert.equal(plan.text, "We build useful products and ship together.");
  for (const word of first) assert.equal(intersects(plan, word), false);
});
