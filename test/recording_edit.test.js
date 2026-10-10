import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRecordingTranscript, planRecordingEdit } from "../src/recording_edit.js";
function phrase(text, start) { return text.split(" ").map((word, index) => ({ word, start: start + index * 0.3, end: start + index * 0.3 + 0.2 })); }
const passage = "We build useful products and ship them together.";

test("silence trim preserves speech handles and remaps words", () => {
  const words = [...phrase("Hello world.", 2), ...phrase("Let's ship.", 6)];
  const plan = planRecordingEdit(words, { durationSeconds: 9 });
  assert.equal(plan.kept_segments.length, 2);
  assert.equal(plan.kept_segments[0].source_start_seconds, 1.85);
  assert.ok(Math.abs(plan.words[0].start - 0.15) < 1e-9);
  assert.equal(plan.text, "Hello world. Let's ship.");
  assert.ok(plan.removed_segments.every((segment) => segment.reason === "silence"));
  assert.ok(Math.abs(plan.duration_seconds - 1.6) < 1e-9);
});
test("latest repeated passage wins without removing unique surrounding lines", () => {
  const words = [...phrase("Welcome aboard.", 0.2), ...phrase(passage, 2), ...phrase("This matters.", 5), ...phrase(passage, 7), ...phrase("Join us.", 11)];
  const plan = planRecordingEdit(words, { durationSeconds: 13 });
  assert.equal(plan.text, `Welcome aboard. This matters. ${passage} Join us.`);
  assert.equal(plan.words.filter((word) => word.word === "build").length, 1);
  assert.ok(plan.removed_segments.some((segment) => segment.reason === "repeated-take"));
});
test("modest wording differences preserve the later delivery", () => {
  const words = [...phrase(passage, 1), ...phrase("We build useful tools and ship them together.", 6)];
  const plan = planRecordingEdit(words, { durationSeconds: 10 });
  assert.equal(plan.text, "We build useful tools and ship them together.");
});
test("unfinished prefixes yield to a completed take", () => {
  const words = [...phrase("We build useful products and ship", 1), ...phrase(passage, 5)];
  assert.equal(planRecordingEdit(words, { durationSeconds: 9 }).text, passage);
});
test("tiny common phrases and distant repeats are retained", () => {
  const short = [...phrase("Let's ship.", 1), ...phrase("Let's ship.", 4)];
  assert.equal(planRecordingEdit(short, { durationSeconds: 7 }).words.length, 4);
  const distant = [...phrase(passage, 1), ...phrase(passage, 60)];
  assert.equal(planRecordingEdit(distant, { durationSeconds: 65 }).words.length, 16);
});
test("none policy preserves repeated takes", () => {
  const words = [...phrase(passage, 1), ...phrase(passage, 6)];
  assert.equal(planRecordingEdit(words, { durationSeconds: 10, takePolicy: "none" }).words.length, 16);
});
test("Whisper segments and Scribe word records normalize consistently", () => {
  const expected = phrase("Hello world.", 1);
  assert.deepEqual(normalizeRecordingTranscript({ segments: [{ words: expected }] }), expected);
  assert.deepEqual(normalizeRecordingTranscript({ words: expected.map(({ word, ...timing }) => ({ ...timing, text: word, type: "word" })).concat([{ text: " ", type: "spacing" }]) }), expected);
});
test("missing, overlapping, reversed, or out-of-source timestamps are rejected", () => {
  for (const words of [[{ word: "Hello" }], [{ word: "Hello", start: 2, end: 1 }], [{ word: "A", start: 1, end: 2 }, { word: "B", start: 1.5, end: 3 }]]) assert.throws(() => planRecordingEdit(words, { durationSeconds: 5 }));
  assert.throws(() => planRecordingEdit(phrase("Hi", 6), { durationSeconds: 5 }), /exceed/);
  assert.throws(() => planRecordingEdit([], { durationSeconds: 5 }), /word-level/);
});
test("three successive retakes leave only the last and no clipped word", () => {
  const plan = planRecordingEdit([...phrase(passage, 1), ...phrase(passage, 5), ...phrase(passage, 9)], { durationSeconds: 13 });
  assert.equal(plan.text, passage);
  assert.equal(plan.words.length, 8);
  assert.ok(plan.words.every((word) => word.start >= 0 && word.end <= plan.duration_seconds));
});
test("pause preservation keeps the full source when silence removal is disabled", () => {
  const plan = planRecordingEdit([...phrase("Hello world.", 2), ...phrase("Let's ship.", 6)], { durationSeconds: 9, silenceDuration: null });
  assert.equal(plan.duration_seconds, 9);
  assert.equal(plan.kept_segments.length, 1);
  assert.equal(plan.removed_segments.length, 0);
  assert.equal(plan.words[0].start, 2);
});
test("short false starts are removed only when the longer restart completes them", () => {
  const words = [...phrase("You get actual code templates", 1), ...phrase("You get actual code templates and support.", 5)];
  const plan = planRecordingEdit(words, { durationSeconds: 10 });
  assert.equal(plan.text, "You get actual code templates and support.");
});
test("pause preservation still excises retakes and maps all retained words", () => {
  const words = [...phrase("Welcome aboard.", 1), ...phrase(passage, 3), ...phrase(passage, 7)];
  const plan = planRecordingEdit(words, { durationSeconds: 12, silenceDuration: null });
  assert.equal(plan.text, `Welcome aboard. ${passage}`);
  assert.equal(plan.kept_segments[0].source_start_seconds, 0);
  assert.equal(plan.kept_segments.at(-1).source_end_seconds, 12);
});
test("zero-duration transcription artifacts are discarded without invented timing", () => {
  const words = [{ word: "hallucination", start: 1, end: 1 }, { word: "Actual", start: 1, end: 1.2 }, { word: "speech.", start: 1.3, end: 1.5 }];
  assert.equal(planRecordingEdit(words, { durationSeconds: 3 }).text, "Actual speech.");
});
test("retakes remain detectable across changed sentence boundaries", () => {
  const earlier = "Your own hands free AI agent working for you content and video to scale so people actually see what you built and how you turn it into products and income.";
  const later = "Your own hands free AI agent working for you content and video at scale so people actually see what you built. And how to turn all of that into products and income.";
  const plan = planRecordingEdit([...phrase(earlier, 1), ...phrase(later, 15)], { durationSeconds: 30 });
  assert.equal(plan.text, later);
});
test("substantial repeated passages tolerate a changed opening and exact five-word lines", () => {
  const earlier = "Engineering principles so that what you build doesn't fall over.";
  const later = "Engineering principles so that what you build won't fail over.";
  const plan = planRecordingEdit([...phrase(earlier, 1), ...phrase(later, 6), ...phrase("We call our members shipmates.", 12), ...phrase("We call our members shipmates.", 16)], { durationSeconds: 20 });
  assert.equal(plan.text, `${later} We call our members shipmates.`);
});
