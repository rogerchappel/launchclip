// The direction map (docs/VIDEO_QUALITY_RFC.md §6): contract, intents and
// treatments, validation against the narration and the storyboard,
// coverage from map plus storyboard, the cast hook, and drafting.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DIRECTION_INTENTS, DIRECTION_SCHEMA, DIRECTION_TREATMENTS, INTENT_RULES, classifyIntent, directionMeasures, draftDirectionMap, intentHints, segmentLines, validateDirection } from "../kit/core/direction.mjs";
import { runStoryCommand } from "../src/story_cli.js";

const FOOTAGE = fileURLToPath(new URL("../examples/story/footage/", import.meta.url));
const words = async () => JSON.parse(await readFile(`${FOOTAGE}NARRATION.json`, "utf8")).words;
const resolved = async () => (await runStoryCommand("resolve", `${FOOTAGE}storyboard.json`)).story_resolved;
const map = async () => JSON.parse(await readFile(`${FOOTAGE}DIRECTION.json`, "utf8"));

test("the contract lists the RFC's intents and treatments", () => {
  assert.equal(DIRECTION_SCHEMA, "launchclip.direction-map.v1");
  assert.deepEqual(DIRECTION_INTENTS, ["hook", "claim", "problem", "turn", "proof", "number", "list", "process", "product", "personal", "quote", "cta"]);
  assert.deepEqual(DIRECTION_TREATMENTS, ["dress", "insert", "face", "camera"]);
  for (const rule of INTENT_RULES) assert.ok(DIRECTION_INTENTS.includes(rule.intent), rule.intent);
});

test("the shared intent rules classify lines", () => {
  assert.equal(classifyIntent("Most launch videos bury the demo.", { index: 0 }), "hook");
  assert.equal(classifyIntent("Edits take twelve minutes, not two days.", { index: 3 }), "number");
  assert.equal(classifyIntent("Try it on your next launch.", { index: 0 }), "cta", "a call to action wins over the hook");
  assert.equal(classifyIntent("But it never worked for us.", { index: 2 }), "turn");
  assert.equal(classifyIntent("Captions, punch-ins and callouts come straight from the words.", { index: 4 }), "list");
  assert.equal(classifyIntent("It feels great.", { index: 4 }), "claim");
});

test("narration splits into lines at sentence ends", async () => {
  const lines = segmentLines(await words());
  assert.equal(lines.length, 7);
  assert.deepEqual(lines[0].words, [0, 5]);
  assert.equal(lines[0].text, "Most launch videos bury the demo.");
  assert.equal(lines.at(-1).words[1], (await words()).length - 1);
  assert.deepEqual(intentHints(await words()).map((line) => line.intent), ["hook", "product", "product", "process", "number", "list", "cta"]);
});

test("the footage example's map is valid against its narration and storyboard", async () => {
  const result = validateDirection(await map(), { words: await words(), story: await resolved() });
  assert.deepEqual(result.errors, []);
});

test("validation finds uncovered words, missing scenes and lines without a why", async () => {
  const base = await map();
  const story = await resolved();
  const list = await words();
  const dropped = structuredClone(base);
  dropped.sections[0].lines.splice(1, 1);
  assert.match(validateDirection(dropped, { words: list, story }).errors.join("\n"), /every line needs an entry: words \[6, \d+\]/);
  const ghost = structuredClone(base);
  ghost.sections[0].lines.find((line) => line.treatment === "dress").scenes = ["nope"];
  assert.match(validateDirection(ghost, { words: list, story }).errors.join("\n"), /names scene "nope", which is not in the storyboard/);
  const far = structuredClone(base);
  far.sections[0].lines[0].treatment = "dress";
  far.sections[0].lines[0].scenes = ["captions-note"];
  assert.match(validateDirection(far, { words: list, story }).errors.join("\n"), /does not overlap the line's words/);
  const silent = structuredClone(base);
  const face = silent.sections.flatMap((section) => section.lines).find((line) => line.treatment === "face" || line.treatment === "camera");
  delete face.why;
  assert.match(validateDirection(silent, { words: list, story }).errors.join("\n"), /needs a short why/);
  const bare = structuredClone(base);
  delete bare.sections[0].lines.find((line) => line.treatment === "dress").scenes;
  assert.match(validateDirection(bare, { words: list, story }).errors.join("\n"), /names the scenes that show it/);
  const overlap = structuredClone(base);
  overlap.sections[0].lines[1].words = [3, overlap.sections[0].lines[1].words[1]];
  assert.match(validateDirection(overlap, { words: list, story }).errors.join("\n"), /starts before the previous line ends/);
  assert.match(validateDirection({ ...base, schema: "x" }, { words: list }).errors.join("\n"), /schema must be/);
  assert.match(validateDirection({ ...structuredClone(base), sections: [{ ...base.sections[0], layout: "split-right" }] }, { words: list, lane: "motion" }).errors.join("\n"), /footage layout/);
});

test("a motion story cannot hold a line on a face", async () => {
  const motion = { schema: DIRECTION_SCHEMA, sections: [{ id: "s1", lines: [{ words: [0, 51], intent: "claim", treatment: "face", why: "x" }] }] };
  assert.match(validateDirection(motion, { words: await words(), lane: "motion" }).errors.join("\n"), /no presenter/);
});

test("deferScenes checks a map before its storyboard exists", async () => {
  const result = validateDirection(await map(), { words: await words(), lane: "footage-led", deferScenes: true });
  assert.deepEqual(result.errors, []);
});

test("cast and set cues pass through to the character kit's check", async () => {
  const cued = structuredClone(await map());
  cued.sections[0].lines[0].cast = [{ id: "maya", pose: "slump", expression: "frustrated", at: "word:demo" }];
  cued.sections[0].lines[0].set = "desk-laptop";
  assert.deepEqual(validateDirection(cued, { words: await words(), story: await resolved() }).errors, [], "without a cast check, cues pass through");
  const seen = [];
  const validateCast = (line, cast) => { seen.push([line.set, cast]); return ["unknown pose slump"]; };
  const result = validateDirection(cued, { words: await words(), story: await resolved(), validateCast, cast: [{ id: "maya" }] });
  assert.deepEqual(seen, [["desk-laptop", [{ id: "maya" }]]]);
  assert.match(result.errors.join("\n"), /lines\[0\]: unknown pose slump/);
});

test("coverage, face time and the longest undressed run come from map plus storyboard", async () => {
  const story = await resolved();
  const measures = directionMeasures(await map(), story, { words: await words() });
  assert.ok(measures.coverage > 0.3 && measures.coverage < 0.9, String(measures.coverage));
  assert.ok(measures.face_time < 1, "the insert hides the presenter");
  assert.ok(measures.longest_undressed_seconds > 0);
  assert.equal(measures.lines.length, 7);
  assert.deepEqual(measures.missed.map((line) => line.intent), ["hook"], "the example's hook plays on a punch-in only");
  const sparse = structuredClone(await map());
  for (const section of sparse.sections) for (const line of section.lines) { line.treatment = "face"; line.why = "on the face"; delete line.scenes; }
  const bare = { ...story, scenes: story.scenes.filter((scene) => scene.module === "punch-in") };
  const empty = directionMeasures(sparse, bare, { words: await words() });
  assert.equal(empty.coverage, 0);
  assert.ok(empty.missed.length >= 5, "visual intents held on the face are missed opportunities");
});

test("draftDirectionMap drafts a valid map from a storyboard", async () => {
  const story = await resolved();
  const draft = draftDirectionMap(story, await words(), { profile: "short-talking-head" });
  assert.equal(draft.profile, "short-talking-head");
  assert.deepEqual(validateDirection(draft, { words: await words(), story }).errors, []);
});
