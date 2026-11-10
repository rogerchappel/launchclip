import assert from "node:assert/strict";
import test from "node:test";
import { applyEdits, editRequest, editable, extractEdits, scenesNamed } from "../src/storyboard_edits.js";

const story = () => ({ scenes: [
  { id: "open", module: "hook-title", track: 0, start: 0, end: 3, params: { headline: "Why decks rot" } },
  { id: "pine", module: "cast-scene", track: 0, start: 2.8, end: 6, params: { cast: [{ character: "maya", cues: [{ at: 0.5, do: "walk-to" }, { at: 0.7, do: "point" }] }] } },
  { id: "end", module: "cta", track: 0, start: 6, end: 8, params: { action: "Follow", icon: "arrow" } }
] });

test("edits set, delete and remove by scene id, and leave the given storyboard alone", () => {
  const given = story();
  const { storyboard, applied, rejected } = applyEdits(given, [
    { scene: "open", op: "set", path: "end", value_json: "2.8" },
    { scene: "pine", op: "set", path: "params.cast.0.cues.1.at", value_json: "1.1" },
    { scene: "pine", op: "set", path: "start", value_json: "\"word:pine#2\"" },
    { scene: "end", op: "delete", path: "params.icon", value_json: "null" }
  ]);
  assert.deepEqual(rejected, []);
  assert.equal(applied.length, 4);
  assert.equal(storyboard.scenes[0].end, 2.8);
  assert.equal(storyboard.scenes[1].params.cast[0].cues[1].at, 1.1);
  assert.equal(storyboard.scenes[1].start, "word:pine#2");
  assert.equal("icon" in storyboard.scenes[2].params, false);
  assert.equal(given.scenes[0].end, 3);
  assert.deepEqual(applyEdits(given, [{ scene: "pine", op: "remove-scene", path: "", value_json: "null" }]).storyboard.scenes.map((scene) => scene.id), ["open", "end"]);
});

test("an edit that names no scene, changes a module or reaches outside the scene is refused", () => {
  const { applied, rejected } = applyEdits(story(), [
    { scene: "nope", op: "set", path: "end", value_json: "1" },
    { scene: "open", op: "set", path: "module", value_json: "\"cta\"" },
    { scene: "open", op: "set", path: "__proto__.x", value_json: "1" },
    { scene: "open", op: "delete", path: "params.missing", value_json: "null" },
    { scene: "open", op: "set", path: "", value_json: "1" }
  ]);
  assert.deepEqual(applied, []);
  assert.equal(rejected.length, 5);
});

test("the request shows the failing checks, every scene's place, the named scenes in full and the narration", () => {
  const errors = ["validation: scenes[1] (pine) overlaps scenes[0] (open) on track 0; move one to another track or adjust start/end"];
  assert.deepEqual(scenesNamed(story(), errors), ["open", "pine"]);
  const text = editRequest({ storyboard: story(), errors, words: [{ text: "Pine", start: 2.8 }, { text: "rots", start: 3.1 }, { text: "pine", start: 4 }], round: 2, rounds: 6 });
  assert.match(text, /## Edit round 2 of 6/);
  assert.match(text, /1 \| pine \| track 0 \| cast-scene \| start 2\.8 end 6 \| plays 2\.8-6 s/);
  assert.match(text, /\{"id":"pine"/);
  assert.doesNotMatch(text, /\{"id":"end"/);
  assert.match(text, /Pine@2\.8 rots@3\.1 pine#2@4/);
});

test("edit rounds take timing and value slips; a plan that needs a new scene or module goes to the full repair", () => {
  assert.equal(editable(["validation: scenes[5] (a) overlaps scenes[4] (b) on track 0", "reading: step (character-cameo) is fully on screen for 1.13 s, and a card needs at least 1.2 s to be read"]), true);
  assert.equal(editable(['anchors: scenes[17].params.cast[0].cues[0].at: Unknown anchor word:composite#3: "composite" occurs 2 times']), true);
  assert.equal(editable(['validation: scenes[1].module "formula-card" is not a known module']), false);
  assert.equal(editable(["validation: scenes[5] (a) overlaps scenes[4] (b) on track 0", "cards: concept-card is used 3 times; at most 2 a video. Vary the treatment."]), false);
  assert.equal(editable(["model: request failed"]), false);
  assert.equal(editable([]), false);
});

test("edits are read from a client result", () => {
  assert.deepEqual(extractEdits({ value: { edits: [{ scene: "a", op: "set", path: "end", value_json: "1" }, "junk"] } }), { ok: true, edits: [{ scene: "a", op: "set", path: "end", value_json: "1" }] });
  assert.equal(extractEdits({ value: { storyboard_json: "{}" } }).ok, false);
});
