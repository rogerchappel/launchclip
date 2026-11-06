import assert from "node:assert/strict";
import test from "node:test";
import { isTopicQuestion } from "../src/script_check.js";
import { cardErrors, fitShotCallouts, hookErrors, labelFitsNotes, MAX_SAME_CARD } from "../src/short_form_checks.js";

const scene = (id, module, params = {}, extra = {}) => ({ id, module, start: 0, end: 2, params, ...extra });
const board = (scenes, duration = 46) => ({ format: { width: 1080, height: 1920, duration }, scenes });

test("a bare topic on the opening is a hook error when the app has a footage library", () => {
  const opening = scene("cover", "photo-scene", { media: { kind: "video", src: "assets/shots/a.mp4" }, lines: [{ text: "Fence care?", at: 0 }] });
  const errors = hookErrors(board([opening]), { footage: true });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^hook: the opening scene cover shows "Fence care\?", a bare topic question/);
  // The stakes on screen pass.
  const strong = scene("cover", "photo-scene", { media: { kind: "video", src: "assets/shots/a.mp4" }, lines: [{ text: "Low-upkeep fences still need 2 cleans a year", at: 0 }] });
  assert.deepEqual(hookErrors(board([strong]), { footage: true }), []);
  // Without a library, over a recording, or in a long video, the rule is off.
  assert.deepEqual(hookErrors(board([opening])), []);
  assert.deepEqual(hookErrors(board([opening]), { footage: true, base: true }), []);
  assert.deepEqual(hookErrors(board([opening], 300), { footage: true }), []);
});

test("text and icon cards are capped by length, never back to back, and no module more than twice", () => {
  const clip = (id) => scene(id, "clip", { media: { kind: "video", src: `assets/shots/${id}.mp4` } });
  const card = (id, module = "concept-card") => scene(id, module, { text: id, icon: "brush" });
  const crowded = board([clip("a"), card("c1"), clip("b"), card("c2"), card("c3", "icon-row"), clip("c"), card("c4"), card("c5", "checklist")]);
  const errors = cardErrors(crowded, { footage: true });
  assert.ok(errors.some((entry) => /^cards: 5 text or icon cards .* in 46 s; keep at most 3/.test(entry)), errors.join("\n"));
  assert.ok(errors.some((entry) => /^cards: c2 \(concept-card\) and c3 \(icon-row\) are text or icon cards back to back/.test(entry)), errors.join("\n"));
  assert.ok(errors.some((entry) => new RegExp(`^cards: concept-card is used 3 times; at most ${MAX_SAME_CARD}`).test(entry)), errors.join("\n"));
  // Footage between two cards, within the cap: clean.
  assert.deepEqual(cardErrors(board([clip("a"), card("c1"), clip("b"), card("c2", "icon-row"), clip("c")]), { footage: true }), []);
  // No library: graphics-only videos are not capped.
  assert.deepEqual(cardErrors(crowded), []);
});

test("a label fits a shot when at least half its words are in the app's notes", () => {
  const saw = { description: "Man using circular saw on timber joists in a backyard", subjects: ["power saw", "timber joists"] };
  assert.equal(labelFitsNotes("Composite: regular cleaning", saw), false);
  assert.equal(labelFitsNotes("May need oiling", saw), false);
  assert.equal(labelFitsNotes("Cutting the joists", saw), true);
  // "hardwood" contains the notes' "wood".
  assert.equal(labelFitsNotes("Hardwood boards", { description: "Close-up of wood boards with visible grain" }), true);
  // No notes, or a label of stop words only, is not judged.
  assert.equal(labelFitsNotes("Cleaning needed", null), true);
  assert.equal(labelFitsNotes("Still needs it", saw), true);
});

test("tooling drops the callouts and grid labels a shot's notes do not support", () => {
  const story = board([
    scene("clean", "clip", { media: { kind: "video", src: "assets/shots/clean.mp4" }, callouts: [{ text: "Composite: regular cleaning", at: 0 }] }),
    scene("grid", "media-grid", { items: [
      { media: { kind: "video", src: "assets/shots/g1.mp4" }, label: "Hardwood" },
      { media: { kind: "video", src: "assets/shots/g2.mp4" }, label: "Composite" }
    ] }),
    scene("cut", "clip", { media: { kind: "video", src: "assets/shots/cut.mp4" }, callouts: [{ text: "Cutting the joists", at: 0 }] })
  ]);
  const shots = [
    { scene_id: "clean", src: "assets/shots/clean.mp4", notes: { description: "Man using circular saw on timber joists" } },
    { scene_id: "grid", slot: "items[0].media", src: "assets/shots/g1.mp4", notes: { description: "Close-up of dense hardwood grain" } },
    { scene_id: "grid", slot: "items[1].media", src: "assets/shots/g2.mp4", notes: { description: "White outdoor table and chairs on a raised deck" } },
    { scene_id: "cut", src: "assets/shots/cut.mp4", notes: { description: "Worker cutting joists with a saw" } },
    { scene_id: "clean", slot: "backdrop", src: "assets/shots/bg.mp4", notes: { description: "Trees" } }
  ];
  const { storyboard, dropped } = fitShotCallouts(story, shots);
  assert.deepEqual(dropped, ['clean: "Composite: regular cleaning"', 'grid: "Composite"']);
  assert.deepEqual(storyboard.scenes[0].params.callouts, []);
  assert.equal(storyboard.scenes[1].params.items[0].label, "Hardwood");
  assert.equal("label" in storyboard.scenes[1].params.items[1], false);
  assert.equal(storyboard.scenes[2].params.callouts.length, 1);
  // The input is untouched, and shots without notes change nothing.
  assert.equal(story.scenes[0].params.callouts.length, 1);
  assert.equal(fitShotCallouts(story, [{ scene_id: "clean", src: "assets/shots/clean.mp4" }]).storyboard, story);
});

test("a bare topic question is not a hook; one with a number, a contrast or a stake is", () => {
  for (const text of ["Choosing deck boards for your home?", "Thinking about solar?", "Looking for a new CRM?", "Are you planning a kitchen reno?"]) assert.equal(isTopicQuestion(text), true, text);
  for (const text of ["Choosing between 3 boards?", "Are you choosing the wrong deck board?", "Why do decks rot?", "Looking for a new CRM.", "Low-upkeep boards still need care."]) assert.equal(isTopicQuestion(text), false, text);
});
