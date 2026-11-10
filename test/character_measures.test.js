// The character and dialogue measures (docs/ANIMATION_PIPELINE_RFC.md §8.2):
// kit/core/cadence.mjs characterMeasures, the bands story-characters carries
// for them, and the two-character example read end to end.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DIALOGUE_MEASURES, characterMeasures, spokenRuns } from "@launchclip/core/cadence.mjs";
import { PROFILE_MEASURES, compareMeasures, validateProfile } from "@launchclip/core/profiles.mjs";
import { shippedProfiles } from "../src/profile_store.js";
import { readProjectStory } from "../src/story_loader.js";
import { storyShotsCommand } from "../src/story_shots.js";

const word = (text, start, end, speaker) => ({ text, start, end, speaker });
// Ada asks (0–2 s), Ben answers (2.5–4 s) while Ada's face falls, then a cut to Ada alone as Ben finishes off screen (4–6 s).
const words = [word("Did", 0, 0.9, "ada"), word("you?", 1, 2, "ada"), word("No.", 2.5, 3, "ben"), word("Never.", 3.2, 4, "ben"), word("Not", 4.2, 5, "ben"), word("once.", 5.1, 6, "ben")];
const shots = [
  { id: "two", start: 0, end: 4.1, who: ["ada", "ben"], set: "desk", framing: "medium", beats: ["problem"],
    lines: [{ speaker: "ada", start: 0, end: 2, beat: "problem" }, { speaker: "ben", start: 2.5, end: 4, beat: "problem" }],
    poses: { ada: [{ at: 0, pose: "stand", expression: "neutral" }, { at: 3, pose: "stand", expression: "sad" }], ben: [{ at: 0, pose: "stand", expression: "neutral" }] } },
  { id: "single", start: 4.1, end: 8, who: ["ada"], set: "desk", framing: "close", beats: ["turn"],
    lines: [{ speaker: "ben", start: 4.2, end: 6, beat: "turn" }],
    poses: { ada: [{ at: 4.1, pose: "stand", expression: "sad" }] } }
];

test("dialogue measures: turns, line lengths, reactions and the longest framing", () => {
  const measures = characterMeasures(shots, { duration: 10, words });
  assert.equal(measures.character_screen_time, 0.8);
  assert.equal(measures.expression_changes_per_min, 6, "one change in ten seconds");
  assert.equal(measures.problem_lands_seconds, 0);
  // Ada, then Ben (a 0.5 s pause is the same line; the cut at 4.1 s is not a new speaker).
  assert.equal(measures.counts.lines, 2);
  assert.equal(measures.speaker_turns_per_min, 6);
  assert.deepEqual([measures.line_seconds.p10, measures.line_seconds.p90], [2.15, 3.35]);
  // Ada speaks 2 s with nobody reacting; Ben speaks 1.5 s while Ada reacts, then 1.8 s unseen over Ada.
  assert.equal(measures.counts.spoken_seconds, 5.3);
  assert.equal(measures.reaction_share, 0.6226);
  assert.equal(measures.longest_framing_seconds, 4.1);
  assert.deepEqual(measures.framings.map((entry) => entry.framing), ["medium", "close"]);
});

test("dialogue measures: a script splits one speaker's run into its written lines, and a silent story measures no dialogue", () => {
  const script = { beats: [{ beat: "problem", lines: [{ id: "l1", speaker: "ada", text: "Did you?" }, { id: "l2", speaker: "ben", text: "No. Never." }, { id: "l3", speaker: null, action: "Ada looks away.", seconds: 1 }, { id: "l4", speaker: "ben", text: "Not once." }] }] };
  assert.deepEqual(spokenRuns(words, { script }).map((run) => [run.id, run.speaker, run.start, run.end]), [["l1", "ada", 0, 2], ["l2", "ben", 2.5, 4], ["l4", "ben", 4.2, 6]]);
  // A script that does not match the take's words is ignored, not trusted.
  assert.equal(spokenRuns(words, { script: { beats: [{ lines: [{ id: "l1", speaker: "ada", text: "Other words entirely here." }] }] } }).length, 2);
  // Two shots in a row on one set, one framing and the same people are one framing.
  const same = characterMeasures([{ ...shots[0], lines: [] }, { ...shots[0], id: "again", start: 4.1, end: 9, lines: [] }], { duration: 10 });
  assert.equal(same.longest_framing_seconds, 9);
  assert.equal(same.speaker_turns_per_min, null);
  assert.equal(same.line_seconds, null);
  assert.equal(same.reaction_share, null);
  assert.throws(() => characterMeasures(shots, {}), /duration/);
});

test("story-characters carries the dialogue bands, marked provisional", () => {
  const profile = shippedProfiles().find((entry) => entry.id === "story-characters");
  assert.ok(validateProfile(profile).ok);
  for (const name of DIALOGUE_MEASURES) {
    assert.ok(PROFILE_MEASURES[name], `${name} is a known measure`);
    assert.ok(profile.measures[name], `${name} has a band`);
  }
  // Still a seed: nothing here was measured from a reference, and the note says so for the dialogue measures by name.
  assert.equal(profile.provenance.kind, "seed");
  assert.equal(profile.references, 0);
  assert.match(profile.provenance.note, /provisional/);
  for (const name of DIALOGUE_MEASURES) assert.ok(profile.provenance.note.includes(name), `the note names ${name}`);
  assert.match(readFileSync("kit/profiles/PROVENANCE.md", "utf8"), /speaker_turns_per_min, line_seconds, reaction_share, longest_framing_seconds\) are provisional/);
  const bands = compareMeasures(characterMeasures(shots, { duration: 10, words }), profile, { only: DIALOGUE_MEASURES });
  assert.deepEqual(bands.map((band) => band.measure), DIALOGUE_MEASURES);
});

test("the two-character example reads inside the dialogue bands", async () => {
  const dir = "examples/story/dialogue-9x16";
  const report = await storyShotsCommand(dir, {});
  const loaded = await readProjectStory(dir);
  const measures = characterMeasures(report.shots, { duration: report.duration, words: loaded.words, script: JSON.parse(readFileSync(`${dir}/SCRIPT.json`, "utf8")) });
  assert.equal(measures.counts.lines, 8, "one line per spoken script line");
  assert.equal(measures.counts.speakers, 3);
  assert.ok(measures.reaction_share > 0);
  const profile = shippedProfiles().find((entry) => entry.id === "story-characters");
  for (const band of compareMeasures(measures, profile, { only: DIALOGUE_MEASURES })) assert.equal(band.status, "inside", band.detail);
});
