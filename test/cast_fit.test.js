// The planner's cast fit (src/cast_fit.js): a character story's direction
// cues get the kit's poses, expressions and sets, and a seeded style's
// default cast takes the story's own names, so finish's cast gate passes.
import assert from "node:assert/strict";
import test from "node:test";
import { generateCast } from "@launchclip/core/characters/generate.mjs";
import { DEFAULT_BRAND } from "@launchclip/core/planning-prompt.mjs";
import { resolveStory } from "@launchclip/core/story.mjs";
import { STYLE_SCHEMA } from "@launchclip/core/style.mjs";
import { bindStoryCast, fitDirectionCast, nearestExpression, nearestPose, nearestSet, normalizeCastCues, plannedCast } from "../src/cast_fit.js";
import { castGate } from "../src/cast.js";
import { checkStoryboard, planStoryboard } from "../src/storyboard_planner.js";

const FORMAT = { width: 1080, height: 1920, fps: 30, duration: 9, platform: "youtube-shorts" };
const WORDS = [
  ["Mia", 0.1], ["keeps", 0.4], ["a", 0.7], ["tally", 0.9], ["on", 1.3], ["the", 1.5], ["fridge", 1.7],
  ["Sam", 3.0], ["swears", 3.4], ["he", 3.8], ["does", 4.0], ["half", 4.3],
  ["Who", 6.0], ["is", 6.3], ["right?", 6.5]
].map(([text, start]) => ({ text, start, end: start + 0.25 }));
const AUDIO = { voice: "assets/audio/narration.wav", words: "NARRATION.json" };
const MEMBERS = generateCast({ seed: "cast-fit", count: 4 });

// A seeded style: generated, with a random default roster.
const seededStyle = () => ({ schema: STYLE_SCHEMA, name: "seed-castfit", generated: { seed: "castfit", generator: "launchclip.style-seed.v2" }, cast: { drawing_style: "flat", members: structuredClone(MEMBERS) } });

// What the model wrote in the failing run: the story's names, free-text
// poses, expressions and a set.
function storyNamesMap() {
  return {
    schema: "launchclip.direction-map.v1",
    sections: [{ id: "s1", title: "The tally", beat: "setup", lines: [
      { words: [0, 6], intent: "hook", treatment: "insert", scenes: ["s1"], set: "shared kitchen", cast: [{ id: "Mia", pose: "standing beside fridge", expression: "hopeful, then wary", at: "word:Mia" }], action: { verb: "point-at", who: "Mia", target: "fridge" } },
      { words: [7, 11], intent: "problem", treatment: "insert", scenes: ["s2"], set: "kitchen-counter", cast: [{ id: "sam", pose: "facing Mia across the fridge", expression: "defensive", at: "word:Sam" }, { id: "mia", pose: "look", expression: "annoyed", at: "word:half" }], action: { verb: "turn-to-look", who: "sam", target: "mia" } },
      { words: [12, 14], intent: "cta", treatment: "insert", scenes: ["s3"] }
    ] }]
  };
}

function storyboard(ids = ["mia", "sam"]) {
  const [a, b] = ids;
  return {
    schema: "launchclip.story.v1",
    title: "Keeping score",
    lane: "motion",
    format: FORMAT,
    brand: DEFAULT_BRAND,
    audio: { ...AUDIO, music: { source: "synth", bpm: 96 } },
    scenes: [
      { id: "s1", module: "cast-scene", start: 0, end: "word:Sam", params: { set: "kitchen-counter", cast: [{ id: a, position: "centre", pose: "point", expression: "happy" }] } },
      { id: "s2", module: "cast-scene", start: "word:Sam", end: "word:Who", params: { set: "kitchen-counter", cast: [{ id: a, position: "left", pose: "look", expression: "frustrated" }, { id: b, position: "right", pose: "look", expression: "frustrated" }] } },
      { id: "s3", module: "cta", start: "word:Who", end: 9, params: { action: "Comment who is right", loop: true } }
    ],
    overlays: [{ type: "captions", style: "word-highlight" }]
  };
}

function fakeClient(responses, { direction }) {
  const calls = [];
  const directionCalls = [];
  return {
    provider: "openai",
    calls,
    directionCalls,
    async runStructured(request) {
      if (request.schemaName === "launchclip_direction") {
        directionCalls.push(request);
        const map = typeof direction === "function" ? direction(request, directionCalls.length) : direction;
        return { model: "gpt-5.6-luna", value: { direction_json: JSON.stringify(map) }, usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } };
      }
      calls.push(request);
      const next = responses[Math.min(calls.length - 1, responses.length - 1)];
      return { model: "gpt-5.6-luna", value: { storyboard_json: JSON.stringify(typeof next === "function" ? next(request) : next) }, usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } };
    }
  };
}

const plan = (client, extra = {}) => planStoryboard({ brief: "Mia and Sam keep a chore tally on the fridge.", words: WORDS, lane: "motion", format: FORMAT, audio: AUDIO, tier: "structured", model: "openai:gpt-5.6-luna", client, direction: true, ...extra });

const cueIds = (map) => map.sections.flatMap((section) => section.lines.flatMap((line) => (line.cast ?? []).map((cue) => cue.id)));

test("free text maps to the nearest pose, expression and set; exact values pass through", () => {
  assert.equal(nearestPose("standing beside fridge"), "stand");
  assert.equal(nearestPose("facing Mia across fridge"), "look");
  assert.equal(nearestPose("looking toward imagined Sam"), "look");
  assert.equal(nearestPose("pointing at the tally"), "point");
  assert.equal(nearestPose("moving beside Mia"), "walk");
  assert.equal(nearestPose("starts the tally"), "stand", "a stem starts a word, and nothing matches: stand");
  assert.equal(nearestExpression("hopeful, then wary"), "happy", "the earliest keyword wins");
  assert.equal(nearestExpression("wary"), "confused");
  assert.equal(nearestExpression("unsure"), "confused");
  assert.equal(nearestExpression("defensive"), "frustrated");
  assert.equal(nearestExpression("annoyed"), "frustrated");
  assert.equal(nearestExpression("reserved"), "neutral");
  assert.equal(nearestSet("shared kitchen"), "kitchen-counter");
  assert.equal(nearestSet("laundry area"), null);
  const { map, changed } = normalizeCastCues(storyNamesMap());
  const [first, second] = map.sections[0].lines;
  assert.deepEqual(first.cast[0], { id: "Mia", pose: "stand", expression: "happy", at: "word:Mia" });
  assert.equal(first.set, "kitchen-counter");
  assert.equal(second.cast[1].pose, "look", "a kit pose is kept");
  assert.equal(second.cast[1].expression, "frustrated");
  assert.ok(changed.includes('sections[0].lines[0].cast[0].pose "standing beside fridge" → stand'), changed.join("\n"));
  assert.ok(changed.includes('sections[0].lines[0].set "shared kitchen" → kitchen-counter'));
  assert.ok(!changed.some((entry) => entry.includes("lines[1].set")), "a kit set is kept");
  const dropped = normalizeCastCues({ sections: [{ lines: [{ set: "laundry area" }] }] });
  assert.equal(dropped.map.sections[0].lines[0].set, undefined, "a set with no match is dropped");
});

test("a seeded style's default cast takes the story's names; a user's cast never does", () => {
  const seeded = plannedCast({ style: seededStyle() });
  assert.equal(seeded.source, "style");
  assert.equal(seeded.bindable, true);
  const fit = fitDirectionCast(storyNamesMap(), { cast: seeded, words: WORDS });
  assert.deepEqual(fit.bound.map(({ from, to, name }) => [from, to, name]), [[MEMBERS[0].id, "mia", "Mia"], [MEMBERS[1].id, "sam", "Sam"]], "in order of first appearance");
  const [mia, sam, ...rest] = fit.cast.characters;
  const { id: _a, name: _b, ...look0 } = MEMBERS[0];
  const { id: _c, name: _d, ...miaLook } = mia;
  assert.deepEqual(miaLook, look0, "the look and voice are kept");
  assert.equal(sam.id, "sam");
  assert.deepEqual(rest.map((member) => member.id), MEMBERS.slice(2).map((member) => member.id), "unused members are kept");
  assert.deepEqual(cueIds(fit.map), ["mia", "sam", "mia"], "cue ids take the bound spelling");
  assert.equal(fit.map.sections[0].lines[0].action.who, "mia");
  assert.ok(fit.warnings.some((entry) => /bound the story's "Mia" to the style cast's/.test(entry)), fit.warnings.join("\n"));

  // A hand-written style's cast (no generated block) and a story's own cast are the author's.
  const authored = { ...seededStyle(), generated: undefined };
  assert.equal(plannedCast({ style: authored }).bindable, false);
  const own = plannedCast({ story: { cast: { characters: [{ id: "maya" }, { id: "theo" }] } }, style: seededStyle() });
  assert.equal(own.source, "story");
  assert.equal(own.bindable, false);
  for (const cast of [plannedCast({ style: authored }), own]) {
    const kept = bindStoryCast(storyNamesMap(), cast, { words: WORDS });
    assert.deepEqual(kept.bound, []);
    assert.deepEqual(kept.cast, cast.cast, "the cast is untouched");
    assert.deepEqual(cueIds(kept.map), ["Mia", "sam", "mia"], "the cues are left for the checks");
  }
});

test("the failing story plans valid cues on a seeded style, ships the bound cast, and passes finish's cast gate", async () => {
  const style = seededStyle();
  const client = fakeClient([{ ...storyboard(), style: style.name }], { direction: storyNamesMap() });
  const report = await plan(client, { style });
  assert.equal(report.status, "passed", report.errors.join("\n"));
  assert.equal(client.directionCalls.length, 1, "tooling fixed the cues; no repair call");
  const prompt = client.directionCalls[0].instructions;
  assert.match(prompt, /## Cast \(the character kit\)/);
  assert.match(prompt, new RegExp(`default characters \\("${MEMBERS[0].id}"`));
  assert.match(prompt, /pose: exactly one of stand, point/);
  assert.match(prompt, /expression: exactly one of neutral, happy/);
  // The storyboard prompt names the bound cast, and the storyboard carries it.
  assert.match(client.calls[0].instructions, /the style's people are "mia" \(Mia\) = "@1", "sam" \(Sam\) = "@2"/);
  const ids = report.storyboard.cast.characters.map((member) => member.id);
  assert.deepEqual(ids.slice(0, 2), ["mia", "sam"]);
  for (const id of cueIds(report.direction)) assert.ok(ids.includes(id), `${id} is in the story cast`);
  assert.equal(report.direction.sections[0].lines[0].cast[0].pose, "stand");
  assert.equal(report.direction.sections[0].lines[0].set, "kitchen-counter");
  assert.ok(report.warnings.some((entry) => /^cast: tooling mapped DIRECTION\.json sections\[0\]\.lines\[0\]\.cast\[0\]\.expression "hopeful, then wary" → happy$/.test(entry)), report.warnings.join("\n"));
  // The style re-applied (as finish does) keeps the story's cast.
  const again = checkStoryboard(report.storyboard, { words: WORDS, tier: "structured", style, direction: report.direction });
  assert.equal(again.ok, true, again.errors.join("\n"));
  assert.deepEqual(again.storyboard.cast.characters.map((member) => member.id), ids);
  const gate = castGate(resolveStory(structuredClone(report.storyboard), { words: WORDS }), { direction: report.direction });
  assert.equal(gate.status, "passed", gate.findings.map((entry) => entry.detail).join("\n"));
});

test("a cast the style author defined is not renamed: the direction repair gets the cast errors", async () => {
  const style = { ...seededStyle(), generated: undefined };
  const [a, b] = MEMBERS.map((member) => member.id);
  const fixedMap = storyNamesMap();
  for (const section of fixedMap.sections) for (const line of section.lines) {
    for (const cue of line.cast ?? []) cue.id = cue.id.toLowerCase() === "mia" ? a : b;
    if (line.action) line.action.who = line.action.who.toLowerCase() === "mia" ? a : b;
  }
  const client = fakeClient([{ ...storyboard([a, b]), style: style.name }], { direction: (request, n) => (n === 1 ? storyNamesMap() : fixedMap) });
  const report = await plan(client, { style });
  assert.equal(report.status, "passed", report.errors.join("\n"));
  assert.equal(client.directionCalls.length, 2);
  assert.match(client.directionCalls[0].instructions, new RegExp(`Cue ids and action.who name characters of the story cast only: "${a}"`));
  assert.match(client.directionCalls[1].input, /cast\[0\]\.id "Mia" is not in the story cast/);
  assert.doesNotMatch(client.directionCalls[1].input, /is not a pose/, "free-text poses were fixed by tooling, not sent back");
  assert.deepEqual(report.storyboard.cast.characters.map((member) => member.id), MEMBERS.map((member) => member.id), "the author's cast is unchanged");
});

test("the storyboard check sends cast cue errors to the plan repair", () => {
  const story = { ...storyboard(), cast: { characters: [{ id: "mia" }, { id: "sam" }] } };
  const map = normalizeCastCues(storyNamesMap()).map;
  map.sections[0].lines[0].cast[0].id = "bea";
  const checked = checkStoryboard(story, { words: WORDS, tier: "structured", direction: map });
  assert.equal(checked.ok, false);
  assert.ok(checked.errors.some((entry) => /^direction: .*cast\[0\]\.id "bea" is not in the story cast \(mia, sam\)/.test(entry)), checked.errors.join("\n"));
});
