// Drawable stories (src/make/drawable.js): a character story may only turn on
// what the kit draws. The script names what it shows, the script check fails
// one that turns on something else (the one repair pass then moves it), the
// show bible records the story's props and cues the one that changes, and the
// bible gate fails a story that never puts them on screen. The fixture is
// the script of the first real run, "A foal learns why the starting gate
// opens", whose gate never appeared.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { biblePropFindings, validateBible } from "@launchclip/core/bible.mjs";
import { PROP_STATES, STORY_PROP_IDS, WORLD_KINDS } from "@launchclip/core/worlds/index.mjs";
import { SCREENPLAY_SCHEMA, checkAnimationScript, normalizeScreenplay, repairScreenplay, writeScreenplay } from "../src/make/animation.js";
import { TOLD, drawableFindings, drawableLines, drawableVocabulary, lineAnchor, normalizeShows, propsNamed, scriptShows, showsNotes } from "../src/make/drawable.js";
import { BIBLE_DESIGN_SCHEMA, biblePropEntry, normalizeBibleDesign, propBriefLines } from "../src/make/show_bible.js";
import { pinInputs } from "../src/storyboard_planner.js";

const GATE = JSON.parse(readFileSync(new URL("./fixtures/make-animation/starting-gate-script.json", import.meta.url), "utf8"));
const withShows = (things, world = null) => ({ ...GATE, shows: { world, things } });

test("the vocabulary lists every world, set, story prop and character kind, and goes to each writer", () => {
  const v = drawableVocabulary();
  assert.deepEqual(v.worlds.map((world) => world.id), [...WORLD_KINDS]);
  assert.deepEqual(v.props.map((prop) => prop.id), [...STORY_PROP_IDS]);
  assert.deepEqual(v.props.find((prop) => prop.id === "starting-gate").states, ["closed", "open"]);
  assert.ok(v.kinds.some((kind) => kind.id === "foal") && v.sets.some((set) => set.id === "standing"));
  const lines = drawableLines().join("\n");
  assert.match(lines, /racetrack, stable-yard, paddock/);
  assert.match(lines, /starting-gate \(closed, then open\)/);
  assert.match(lines, /may only turn on a place, a thing or a character from these lists/);
  // The script's schema asks what the story shows, from the same lists.
  const shows = SCREENPLAY_SCHEMA.properties.shows.properties;
  assert.deepEqual(shows.world.enum, ["", ...WORLD_KINDS]);
  assert.deepEqual(shows.things.items.properties.prop.enum, [...STORY_PROP_IDS, "told", "none"]);
  assert.ok(SCREENPLAY_SCHEMA.required.includes("shows"));
  assert.deepEqual(BIBLE_DESIGN_SCHEMA.properties.props.items.enum, [...STORY_PROP_IDS]);
});

test("the first run's script: the kit now draws its starting gate, and the gate opens on its silent line", () => {
  const shows = scriptShows(GATE);
  assert.deepEqual(shows.things, [{ name: "starting gate", prop: "starting-gate" }], "found by the script's own words: it was written before `shows` existed");
  assert.deepEqual(shows.props, ["starting-gate"]);
  assert.deepEqual(shows.cues, [{ prop: "starting-gate", state: "open", line: "l10" }], "the silent line, not the talk about it (\"When it opens…\")");
  const check = checkAnimationScript(GATE, { duration: 30 });
  assert.deepEqual(check.errors.filter((error) => ["undrawable", "told-acted"].includes(error.id)), []);
  assert.deepEqual(showsNotes(GATE), ["the story shows starting-gate", "starting-gate becomes open on line l10"]);
  // The cue is anchored on the narration: the last word of the line before that the script says once, plus the rest of the line.
  assert.equal(lineAnchor(GATE, "l10"), "word:get#1+1.25");
  assert.equal(lineAnchor(GATE, "l8"), "word:the#6");
});

test("a script that turns on something the kit cannot draw fails the check, with the way out", () => {
  const script = withShows([{ name: "starting gate", prop: "starting-gate" }, { name: "the old water pump", prop: "none" }]);
  const found = drawableFindings(script);
  assert.deepEqual(found.errors.map((error) => error.id), ["undrawable"]);
  assert.match(found.errors[0].message, /turns on "the old water pump", which the kit cannot draw, so it would never appear on screen/);
  assert.match(found.errors[0].fix, /nearest thing that can be shown \(bucket, hay-bale, saddle/);
  assert.match(found.errors[0].fix, /let only the narrator name "the old water pump".*prop "told"/);
  const check = checkAnimationScript(script, { duration: 30 });
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((error) => error.id === "undrawable"));
  assert.ok(showsNotes(script).some((note) => /"the old water pump" cannot be drawn and the script still turns on it/.test(note)));
  // What the writer could not match but the kit's words do is drawable after all.
  assert.deepEqual(drawableFindings(withShows([{ name: "winning post", prop: "none" }])).errors, []);
});

test("a thing only the narrator names is reported, and fails when a silent line needs it on screen", () => {
  const told = withShows([{ name: "the old water pump", prop: TOLD }]);
  const found = drawableFindings(told);
  assert.deepEqual(found.errors, []);
  assert.deepEqual(found.warnings.map((warning) => warning.id), ["told-not-shown"]);
  assert.ok(showsNotes(told).includes('"the old water pump" cannot be drawn: the narrator carries it and it is never on screen'));
  const acted = { ...told, beats: [...told.beats, { beat: "resolution", lines: [{ id: "l13", speaker: null, action: "The foal drinks at the pump.", seconds: 1 }] }] };
  const errors = drawableFindings(acted).errors;
  assert.deepEqual(errors.map((error) => [error.id, error.line]), [["told-acted", "l13"]]);
});

test("the repair pass is told what failed and what the script showed, and the report says the story was moved", async () => {
  const calls = [];
  const client = { provider: "openai", runStructured: async (request) => { calls.push(request); return { value: { title: "The Starting Gate", title_options: ["The Starting Gate"], shows: { world: "racetrack", things: [{ name: "starting gate", prop: "starting-gate" }] }, beats: GATE.beats.map((beat) => ({ beat: beat.beat, place: "", lines: beat.lines.map((line) => ({ speaker: line.speaker ?? "", text: line.text ?? "", playing: line.playing ?? "", action: line.action ?? "", seconds: line.seconds ?? 0 })) })) }, usage: {}, model: "stub" }; } };
  const bad = withShows([{ name: "the old water pump", prop: null }]);
  const first = checkAnimationScript(bad, { duration: 30 });
  const repaired = await repairScreenplay({ client, provider: "openai", model: "stub", prompt: "A foal learns why the starting gate opens", duration: 30, script: bad, errors: first.errors.filter((error) => error.id === "undrawable") });
  assert.match(calls[0].input, /## What can be shown/);
  assert.match(calls[0].input, /\[undrawable\] The story turns on "the old water pump"/);
  assert.match(calls[0].input, /shows: world \(the designer's choice\); things the old water pump = none/);
  assert.deepEqual(repaired.script.shows, { world: "racetrack", things: [{ name: "starting gate", prop: "starting-gate" }] });
  assert.deepEqual(repaired.check.errors.filter((error) => error.id === "undrawable"), []);
  assert.ok(showsNotes(repaired.script).includes("the script was rewritten once so that it only turns on things the kit can draw"));
  // The writer is given the list on the first pass too.
  await writeScreenplay({ client, provider: "openai", model: "stub", prompt: "x", duration: 30, premise: GATE.premise, characters: GATE.characters, logline: GATE.logline });
  assert.match(calls[1].input, /## What can be shown/);
  assert.match(calls[1].instructions, /The story may only turn on what is listed under "What can be shown"/);
});

test("shows and words: a model's answer is kept to the kit's lists, and one-word names need a determiner", () => {
  assert.deepEqual(normalizeShows({ world: "moon-base", things: [{ name: " Gate ", prop: "starting-gate" }, { name: "gate", prop: "bucket" }, { name: "pump", prop: "pump" }, { name: "", prop: "bucket" }] }), { world: null, things: [{ name: "Gate", prop: "starting-gate" }, { name: "pump", prop: null }] });
  assert.equal(normalizeScreenplay({ title: "T", shows: { world: "paddock", things: [] }, beats: [] }, {}).shows.world, "paddock");
  assert.deepEqual(propsNamed("The foal wants to jump and sign up for the present moment."), []);
  assert.deepEqual(propsNamed("She cleared the jump and won a rosette and the trophy.").map((entry) => entry.prop), ["rosette", "jump", "trophy"]);
  assert.deepEqual(propsNamed("He closed the garden gate."), [], "a gate is the starting gate only in a racing story");
  assert.deepEqual(propsNamed("The foal watched the gate.").map((entry) => entry.prop), ["starting-gate"]);
});

test("the bible records the story's props and its cue; a story with a gate happens on a course", () => {
  const design = normalizeBibleDesign({ characters: [], world: { kind: "park", time: "day" }, sets: ["standing"], props: ["bucket", "moon"], rules: [] }, { characters: GATE.characters, prompt: "A foal learns why the starting gate opens", shows: scriptShows(GATE) });
  assert.deepEqual(design.props, ["starting-gate", "bucket"], "the script's own things first, whatever the designer chose");
  assert.deepEqual(design.world, { kind: "racetrack", time: "day" });
  assert.deepEqual(normalizeBibleDesign({ world: { kind: "paddock", time: "dusk" }, props: [] }, { characters: GATE.characters, shows: scriptShows(GATE) }).world, { kind: "paddock", time: "dusk" }, "a racing world the designer chose stays");
  assert.deepEqual(normalizeBibleDesign({ world: { kind: "park" }, props: ["ball"] }, { characters: [] }).world.kind, "park");
  assert.deepEqual(biblePropEntry("starting-gate", GATE), { id: "starting-gate", cues: [{ at: "word:get#1+1.25", state: "open" }] });
  assert.deepEqual(biblePropEntry("trophy", GATE), { id: "trophy", on: "ground", scale: 2.5 }, "a small prop is enlarged to read beside the cast");
  assert.deepEqual(biblePropEntry("bucket"), { id: "bucket" });
  const world = { kind: "racetrack", time: "day", props: design.props.map((id) => biblePropEntry(id, GATE)), shows: design.props, sets: ["standing"] };
  assert.deepEqual(validateBible({ schema: "launchclip.show-bible.v1", frozen: false, world }).errors.filter((error) => /world/.test(error)), []);
  assert.match(validateBible({ schema: "launchclip.show-bible.v1", world: { ...world, shows: ["saddle"] } }).errors.join("\n"), /world\.shows: "saddle" is not one of world\.props \(starting-gate, bucket\)/);
  const brief = propBriefLines({ script: GATE, bible: { world } }).join("\n");
  assert.match(brief, /Props: starting-gate, bucket\. They are in story\.world\.props/);
  assert.match(brief, /The starting-gate is closed and becomes open on line l10: tooling cues that change/);
  // The planner's pin carries the props into story.world, whatever the plan wrote there.
  const fixed = { lane: "motion", format: {}, brand: {}, audio: {}, world: { kind: world.kind, time: world.time, props: world.props } };
  assert.deepEqual(pinInputs({ world: { kind: "park", props: ["bench"] }, scenes: [] }, fixed).storyboard.world, { kind: "racetrack", time: "day", props: world.props });
  assert.ok(PROP_STATES["starting-gate"]);
});

test("the bible gate's findings: a story prop no scene shows, and a change the story never plays", () => {
  const gate = { id: "starting-gate", cues: [{ at: "word:get#1+1.25", state: "open" }] };
  const bible = { world: { kind: "racetrack", props: [gate, { id: "bucket" }], shows: ["starting-gate"] } };
  const scene = (params = {}) => ({ id: "s", module: "cast-scene", start: 0, end: 4, params: { set: "standing", cast: [{ id: "foal" }], ...params } });
  // The first run: a park, a foal and a mare, no gate anywhere.
  const missing = biblePropFindings({ world: { kind: "park" }, scenes: [scene()] }, bible);
  assert.equal(missing.length, 1);
  assert.match(missing[0], /the story turns on "starting-gate" \(the show bible's world\.shows\), but it never appears on screen/);
  assert.deepEqual(biblePropFindings({ world: { kind: "racetrack", props: [gate, "bucket"] }, scenes: [scene()] }, bible), []);
  // In story.world but no scene draws the story's world: still not on screen.
  assert.equal(biblePropFindings({ world: { kind: "racetrack", props: [gate] }, scenes: [scene({ backdrop: "room" })] }, bible).length, 1);
  // Shown, but it never opens.
  const shut = biblePropFindings({ world: { kind: "racetrack", props: ["starting-gate"] }, scenes: [scene()] }, bible);
  assert.match(shut[0], /the script has the starting-gate become open, but the story never shows it/);
  assert.deepEqual(biblePropFindings({ world: { kind: "racetrack", props: ["starting-gate"] }, scenes: [scene({ props: [{ id: "starting-gate", cues: [{ at: 2, state: "open" }] }] })] }, bible), []);
  // Props that only dress the world (not in shows) are not the gate's business, and a bible without shows asks nothing.
  assert.deepEqual(biblePropFindings({ scenes: [] }, { world: { kind: "office", props: ["laptop", "trophy"] } }), []);
});
