// The direction map (docs/VIDEO_QUALITY_RFC.md §6): contract, intents and
// treatments, validation against the narration and the storyboard,
// coverage from map plus storyboard, the cast hook, and drafting.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DIRECTION_INTENTS, DIRECTION_SCHEMA, DIRECTION_TREATMENTS, INTENT_RULES, classifyIntent, directionMeasures, draftDirectionMap, intentHints, segmentLines, validateDirection } from "@launchclip/core/direction.mjs";
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
  const face = silent.sections[0].lines[0];
  face.treatment = "camera";
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
  assert.deepEqual(measures.missed, [], "every visual line in the example is dressed");
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

test("a narrative map names the key action of every line with cast cues, and of each section", async () => {
  const { validateDirection } = await import("@launchclip/core/direction.mjs");
  const words = Array.from({ length: 4 }, (_, i) => ({ text: `w${i}`, start: i, end: i + 0.5 }));
  const line = (extra) => ({ words: [0, 3], intent: "claim", treatment: "insert", scenes: ["c"], ...extra });
  const map = (lines) => ({ schema: "launchclip.direction-map.v1", sections: [{ id: "s", beat: "resolution", lines }] });
  assert.match(validateDirection(map([line({ cast: [{ id: "maya", pose: "sit" }] })]), { words, deferScenes: true }).errors.join("\n"), /has cast cues but no key action/);
  assert.match(validateDirection(map([line({})]), { words, deferScenes: true }).errors.join("\n"), /names no key action/);
  assert.deepEqual(validateDirection(map([line({ cast: [{ id: "maya" }], action: { verb: "look-far", who: "maya", target: "street" } })]), { words, deferScenes: true }).errors, []);
  assert.match(validateDirection(map([line({ action: { verb: "teleport", who: "maya" } })]), { words, deferScenes: true }).errors.join("\n"), /action.verb must be one of look-far/);
  // A map without beats (not narrative) needs no action.
  assert.deepEqual(validateDirection({ schema: "launchclip.direction-map.v1", sections: [{ id: "s", lines: [line({})] }] }, { words, deferScenes: true }).errors, []);
});

// Shot fields (docs/ANIMATION_PIPELINE_RFC.md §4.3): a map line names its
// script line, a speaking character is on screen, and the shot list.
const DIALOGUE = fileURLToPath(new URL("../examples/story/dialogue-9x16/", import.meta.url));
const dialogue = async () => {
  const read = async (name) => JSON.parse(await readFile(`${DIALOGUE}${name}`, "utf8"));
  return {
    map: await read("DIRECTION.json"),
    script: await read("SCRIPT.json"),
    words: (await read("NARRATION.json")).words,
    story: (await runStoryCommand("resolve", `${DIALOGUE}storyboard.json`)).story_resolved
  };
};
const mapLine = (map, id) => map.sections.flatMap((section) => section.lines).find((line) => line.line === id);

test("the dialogue example validates, with a script line id on every map line", async () => {
  const report = await runStoryCommand("validate", `${DIALOGUE}storyboard.json`);
  assert.deepEqual(report.errors, []);
  assert.equal(report.direction.status, "valid");
  const { map, script } = await dialogue();
  const { scriptLines } = await import("@launchclip/core/direction.mjs");
  const spoken = scriptLines(script).filter((line) => line.speaker !== null).map((line) => line.id);
  assert.deepEqual(map.sections.flatMap((section) => section.lines.map((line) => line.line)), spoken, "each spoken script line is played once, in order");
  // The voice lines the storyboard carries are the script's spoken lines.
  const story = JSON.parse(await readFile(`${DIALOGUE}storyboard.json`, "utf8"));
  assert.deepEqual(story.audio.narration.lines.map(({ speaker, text }) => ({ speaker, text })), scriptLines(script).filter((line) => line.speaker !== null).map(({ speaker, text }) => ({ speaker, text })));
});

test("a map line's line names a spoken line of the script, said by the same speaker", async () => {
  const { map, script, words, story } = await dialogue();
  const check = (edit, options = {}) => {
    const copy = structuredClone(map);
    edit(copy);
    return validateDirection(copy, { words, story, script, ...options });
  };
  assert.deepEqual(check(() => {}).errors, []);
  assert.match(check((copy) => { mapLine(copy, "l2").line = ""; }).errors.join("\n"), /\.line must be the id of the script line it plays/);
  assert.match(check((copy) => { mapLine(copy, "l2").line = "l99"; }).errors.join("\n"), /\.line "l99" is not a line of the script \(l1, l2/);
  assert.match(check((copy) => { mapLine(copy, "l2").line = "l4"; }).errors.join("\n"), /\.line "l4" is a silent line of the script/);
  assert.match(check((copy) => { mapLine(copy, "l3").line = "l2"; }).errors.join("\n"), /\.line "l2" is spoken by sam in the script, but its words \[13, 16\] are voiced by maya/);
  // The same speaker, other words: a warning to check the range.
  assert.match(check((copy) => { mapLine(copy, "l5").line = "l7"; }).warnings.join("\n"), /\.line "l7" reads "Oh\. It's broken\." in the script, but its words \[17, 20\] say "Fine\. One quick test\."/);
  // Without a script the id is only checked for shape.
  assert.deepEqual(check((copy) => { mapLine(copy, "l2").line = "l99"; }, { script: undefined }).errors, []);
});

test("a line a character speaks off screen fails unless it says why", async () => {
  const { map, script, words, story } = await dialogue();
  // l8: Sam speaks over Maya's reaction shot, and the line says why.
  assert.ok(mapLine(map, "l8").why);
  assert.deepEqual(validateDirection(map, { words, story, script }).errors, []);
  const silent = structuredClone(map);
  delete mapLine(silent, "l8").why;
  const errors = validateDirection(silent, { words, story, script }).errors;
  assert.equal(errors.length, 1);
  assert.match(errors[0], /sections\[3\] \(turn\)\.lines\[1\]: sam speaks words \[24, 28\] \("Better now than at midnight\.", [\d.]+–[\d.]+ s\), but no scene with sam is on screen then; put sam in a character scene over the line, or say why/);
  // The narrator is never on screen, and a map without story beats is not held to the rule.
  assert.equal(errors.some((error) => /narrator speaks/.test(error)), false);
  const plain = structuredClone(silent);
  for (const section of plain.sections) delete section.beat;
  assert.deepEqual(validateDirection(plain, { words, story, script }).errors, []);
  // While the storyboard is not planned yet there are no scenes to check.
  assert.deepEqual(validateDirection(silent, { words, script, lane: "voiceover-motion", deferScenes: true }).errors, []);
  // Part of a line: the character leaves before the line ends.
  const short = structuredClone(story);
  short.scenes.find((scene) => scene.id === "ask").end = words[18].start - 0.01;
  assert.match(validateDirection(map, { words, story: short, script }).errors.join("\n"), /maya speaks words \[17, 20\] .* but no scene with maya is on screen for 3 of those 4 words \(from "One quick test\."\)/);
});

test("words with no speaker take the speaker of the script line the map names", async () => {
  const { offScreenSpeech } = await import("@launchclip/core/direction.mjs");
  const { map, script, words, story } = await dialogue();
  const bare = words.map(({ speaker, ...word }) => word);
  const line = mapLine(map, "l8");
  assert.deepEqual(offScreenSpeech(line, { words: bare, story }), [], "nobody is known to speak");
  const [found] = offScreenSpeech(line, { words: bare, story, script });
  assert.equal(found.speaker, "sam");
  assert.deepEqual(found.words, [24, 28]);
  assert.deepEqual(found.missing, [24, 25, 26, 27, 28]);
  assert.deepEqual(offScreenSpeech(mapLine(map, "l2"), { words: bare, story, script }), [], "sam is in the scene over l2");
});

test("sceneCharacters names who a scene draws", async () => {
  const { sceneCharacters } = await import("@launchclip/core/direction.mjs");
  const { story } = await dialogue();
  assert.deepEqual(story.scenes.map((scene) => [scene.id, sceneCharacters(scene)]), [["desk", ["maya"]], ["ask", ["maya", "sam"]], ["test", ["maya"]], ["saved", ["maya", "sam"]], ["close", ["sam"]]]);
  assert.deepEqual(sceneCharacters({ module: "concept-card", params: { cast: [{ id: "maya" }] } }), []);
});

test("story shots lists each shot with frames, who, set, framing, poses and lines", async () => {
  const report = await runStoryCommand("shots", DIALOGUE);
  assert.equal(report.action, "shots");
  assert.deepEqual(report.warnings, []);
  assert.deepEqual(report.shots.map((shot) => shot.id), ["desk", "ask", "test", "saved", "close"]);
  // Frames tile the story: each shot starts on the frame after the last one.
  for (const [i, shot] of report.shots.entries()) {
    assert.equal(shot.frames, shot.last_frame - shot.first_frame + 1);
    if (i) assert.equal(shot.first_frame, report.shots[i - 1].last_frame + 1);
  }
  const ask = report.shots[1];
  const board = JSON.parse(await readFile(`${DIALOGUE}storyboard.json`, "utf8"));
  assert.deepEqual({ who: ask.who, set: ask.set, framing: ask.framing, beats: ask.beats }, { who: ["maya", "sam"], set: "standing", framing: "medium", beats: ["problem", "attempt"] });
  assert.equal(board.scenes[1].params.shot, undefined, "the scene names no shot: the list gives the framing it resolves to");
  assert.equal(report.shots.at(-1).last_frame, Math.round(board.scenes.at(-1).end * report.fps) - 1);
  assert.deepEqual(ask.lines.map(({ line, speaker, on_screen, text }) => ({ line, speaker, on_screen, text })), [
    { line: "l2", speaker: "sam", on_screen: true, text: "Did you test the rollback?" },
    { line: "l3", speaker: "maya", on_screen: true, text: "It worked last month." },
    { line: "l5", speaker: "maya", on_screen: true, text: "Fine. One quick test." }
  ]);
  assert.equal(ask.lines[0].playing, "light, as if in passing");
  assert.deepEqual(ask.poses.maya.map(({ pose, expression }) => [pose, expression]), [["stand", "neutral"], ["shrug", "happy"], ["hands-on-hips", "frustrated"]]);
  assert.deepEqual(ask.poses.sam.map(({ pose }) => pose), ["stand", "think", "arms-crossed"]);
  assert.equal(ask.poses.maya[1].frame, Math.round(ask.poses.maya[1].at * report.fps));
  assert.deepEqual(ask.actions, [{ verb: "think", who: "sam", line: "l2" }, { verb: "shrug", who: "maya", line: "l3" }, { verb: "hands-on-hips", who: "maya", line: "l5" }]);
  // The reaction shot: Sam's line is listed, off screen, with the map's why.
  const off = report.shots[2].lines.find((line) => line.line === "l8");
  assert.deepEqual({ speaker: off.speaker, on_screen: off.on_screen }, { speaker: "sam", on_screen: false });
  assert.match(off.why, /we stay on Maya/);
  assert.equal(report.shots[0].lines[0].on_screen, false, "the narrator is not on screen");
  // The script's silent lines are the ones no map line plays.
  assert.deepEqual(report.script_lines.unplaced.map((line) => line.id), ["l4", "l6"]);
  assert.equal(report.script_lines.played, 8);

  const { formatShots } = await import("../src/story_shots.js");
  const text = formatShots(report);
  assert.match(text, /5 shots, 20\.00 s at 30 fps/);
  assert.match(text, / 2 {2}ask {2}[\d.]+–[\d.]+ s {2}frames \d+–\d+ \(\d+\)/);
  assert.match(text, /l8 sam \(off screen\): "Better now than at midnight\."/);
  assert.match(text, /sam: [\d.]+ stand, neutral → [\d.]+ think, happy/);
  assert.match(text, /Script lines no map line plays \(2 of 10\)/);
});

test("the shot list works without a map or a script, and the CLI prints text or JSON", async () => {
  const { shotList } = await import("../src/story_shots.js");
  const { words, story } = await dialogue();
  const bare = shotList(story, { words });
  assert.equal(bare.script_lines, undefined);
  assert.deepEqual(bare.shots[1].lines.map(({ speaker, text }) => [speaker, text]), [["sam", "Did you test the rollback?"], ["maya", "It worked last month. Fine. One quick test."]]);
  assert.deepEqual(bare.shots[1].beats, []);
  // In the footage-led lane a character scene above track 0 is an overlay, not a shot.
  const { isShot } = await import("../src/story_shots.js");
  assert.equal(isShot({ module: "character-cameo", track: 1 }, { lane: "footage-led" }), false);
  assert.equal(isShot({ module: "cast-scene", track: 1 }, { lane: "motion" }), true);
  assert.equal(isShot({ module: "concept-card" }, { lane: "motion" }), false);

  const { runCli } = await import("../src/cli.js");
  const run = async (args) => {
    let out = "";
    await runCli(["story", "shots", DIALOGUE, ...args], { stdout: { write: (text) => { out += text; } }, stderr: { write: () => {} } });
    return out;
  };
  assert.match(await run([]), /^Test the rollback: a two-character dialogue: 5 shots/);
  assert.equal(JSON.parse(await run(["--json"])).shots.length, 5);
});
