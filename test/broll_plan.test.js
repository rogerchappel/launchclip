import test from "node:test";
import assert from "node:assert/strict";
import { createBrollPlan, renderBrollChecklist } from "../src/broll_plan.js";

test("capture cards follow the edited transcript, clamp bounds and avoid repeated topics", () => {
  const transcript = { segments: [
    { text: "Our agent creates a checklist.", start: 1, end: 4 },
    { text: "The agent does another task.", start: 4, end: 7 },
    { text: "Shipmates share progress in the community.", start: 7, end: 12 }
  ] };
  const plan = createBrollPlan(transcript, { durationSeconds: 10 });
  assert.equal(plan.planning_method, "offline-keyword-heuristics");
  assert.equal(plan.cards.length, 2);
  assert.deepEqual(plan.cards.map((card) => [card.start_seconds, card.end_seconds]), [[1, 4], [7, 10]]);
  assert.match(plan.cards[0].spoken_line, /agent creates/);
  assert.match(plan.cards[0].capture_instructions, /sandbox/);
  assert.match(plan.cards[1].capture_instructions, /hide member names/);
  for (const card of plan.cards) {
    assert.equal(card.status, "planned");
    assert.equal(card.media_path, null);
    assert.match(card.capture_instructions, /10–15 seconds/);
    assert.match(card.capture_instructions, /hide sensitive data/);
    assert.match(card.suggested_filename, /^broll-\d\d-[a-z]+\.mp4$/);
    assert.equal(card.capture_duration_seconds, 12);
  }
  assert.deepEqual(createBrollPlan(transcript, { durationSeconds: 10 }), plan);
});

test("flat, wrapped and Whisper nested words produce matching placements", () => {
  const words = [{ word: "Build", start: 2, end: 2.3 }, { word: "code.", start: 2.3, end: 3 }, { text: "Video", start: 4, end: 4.5 }, { text: "content.", start: 4.5, end: 5 }];
  const flat = createBrollPlan(words);
  assert.deepEqual(createBrollPlan({ words }), flat);
  assert.deepEqual(createBrollPlan({ segments: [{ words: words.slice(0, 2) }, { words: words.slice(2) }] }), flat);
  assert.equal(flat.duration_seconds, 5);
  assert.equal(flat.cards[0].spoken_line, "Build code.");
  assert.match(flat.cards[0].capture_instructions, /actual test/);
  assert.match(flat.cards[1].shot_description, /content edit/);
});

test("explicit shots handle subjects without keyword matches and checklist preserves capture state", () => {
  const plan = createBrollPlan({ segments: [{ text: "A quiet moment.", start: 0, end: 3 }] }, { aspect: "9:16", shots: [{ start_seconds: 1, end_seconds: 3, shot_description: "Show my notebook", capture_instructions: "Film your own notebook with sample notes.", priority: "low" }] });
  assert.equal(plan.cards[0].spoken_line, "A quiet moment.");
  const checklist = renderBrollChecklist(plan);
  assert.match(checklist, /Capture aspect: 9:16/);
  assert.match(checklist, /1.00–3.00s/);
  assert.match(checklist, /broll-01-custom.mp4/);
  assert.match(checklist, /\[ \] low priority — planned/);
  assert.match(checklist, /not captured/);
  plan.cards[0].status = "captured";
  plan.cards[0].media_path = "captures/broll-01-custom.mp4";
  assert.match(renderBrollChecklist(plan), /\[x\] low priority — captured/);
  assert.match(renderBrollChecklist(plan), /Media: captures\/broll-01-custom.mp4/);
});

test("unrelated speech stays empty and malformed timings fail instead of guessing", () => {
  assert.equal(createBrollPlan([{ text: "Hello.", start: 0, end: 1 }]).cards.length, 0);
  assert.throws(() => createBrollPlan({ text: "No timings" }), /needs words/);
  assert.throws(() => createBrollPlan([{ text: "code", start: 3, end: 2 }]), /timings/);
  assert.throws(() => createBrollPlan([{ text: "code", start: 0, end: 1 }], { durationSeconds: -1 }), /positive/);
  assert.throws(() => createBrollPlan([{ text: "code", start: 0, end: 1 }], { shots: [{ start_seconds: 2, end_seconds: 3, shot_description: "Beyond edit" }] }), /valid timeline/);
});
