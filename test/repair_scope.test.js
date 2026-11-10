import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { keepUnnamed, repairScope } from "../src/repair_scope.js";
import { planStoryboard } from "../src/storyboard_planner.js";

const dir = new URL("./fixtures/storyboard-normalise/", import.meta.url);
const WORDS = JSON.parse(readFileSync(new URL("words.json", dir), "utf8"));
const { attempts: ATTEMPTS } = JSON.parse(readFileSync(new URL("attempts.json", dir), "utf8"));
const clone = (value) => JSON.parse(JSON.stringify(value));
const base = () => clone(ATTEMPTS[4]);
const scene = (story, id) => story.scenes.find((entry) => entry.id === id);
const scope = (errors, { storyboard, direction } = base()) => repairScope(errors, { storyboard, direction, words: WORDS });

test("a finding opens the scene it names, the scenes on the line it names and the scenes on screen at its times", () => {
  assert.deepEqual([...scope(ATTEMPTS[3].errors).open], ["foal-mare-wide-together-auto"]);
  // "Not quite." (5.39–6.17 s): the line's scene and the one that ends as it starts.
  assert.deepEqual([...scope([ATTEMPTS[4].errors[0]]).open].sort(), ["foal-mare-wide-question-auto", "foal-medium-hay-auto"]);
  assert.deepEqual([...scope(['acting: "words 55–61" names foal turn-to-look at 18.45–20.3 s, but nobody performs it']).open].sort(), ["foal-mare-wide-start-together", "foal-medium-realization-auto"]);
});

test("a finding about the plan as a whole, or a gate's list cut short, opens everything", () => {
  assert.equal(scope(["cadence: coverage 0.2 is below the band (profile short-motion); dress more lines"]).open, null);
  assert.equal(scope([...ATTEMPTS[3].errors, "hook: the opening shows no subject"]).open, null);
  assert.equal(scope(Array.from({ length: 8 }, () => "cast: scenes[5] (foal-mare-wide-together-auto): a limb is off the canvas")).open, null);
  assert.equal(scope([]).open, null);
});

test("scenes outside the scope get their params back; timing, new scenes and open scenes are the repair's", () => {
  const { storyboard } = base();
  const repaired = clone(storyboard);
  scene(repaired, "foal-mare-wide-together-auto").params.cast[0].cues[1].at = 1.2;
  scene(repaired, "foal-medium-first-auto").params.cast[0].position = "left";
  scene(repaired, "foal-medium-first-auto").end = 11;
  repaired.scenes.push({ id: "new-shot", module: "cast-scene", start: 26.2, end: 28.4, params: { cast: [{ id: "foal" }] } });
  const { storyboard: kept, kept: ids } = keepUnnamed(storyboard, repaired, { open: new Set(["foal-mare-wide-together-auto"]) });
  assert.deepEqual(ids, ["foal-medium-first-auto"]);
  assert.equal(scene(kept, "foal-medium-first-auto").params.cast[0].position, "centre");
  assert.equal(scene(kept, "foal-medium-first-auto").end, 11);
  assert.equal(scene(kept, "foal-mare-wide-together-auto").params.cast[0].cues[1].at, 1.2);
  assert.ok(scene(kept, "new-shot"));
  assert.deepEqual(keepUnnamed(storyboard, repaired, { open: null }), { storyboard: repaired, kept: [] });
});

// The planner on the saved story: `responses` are the storyboards the model returns, in order.
async function plan(responses, direction) {
  const story = responses[0];
  const bible = { schema: "launchclip.show-bible.v1", frozen: true, hash: story.bible.hash, cast: story.cast, world: story.world };
  const calls = [];
  const client = { provider: "openai", async runStructured(request) { calls.push(request); return { model: "gpt-5.6-luna", value: { storyboard_json: JSON.stringify(responses[Math.min(calls.length - 1, responses.length - 1)]), direction_json: "" }, usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } }; } };
  const report = await planStoryboard({ brief: "A foal learns why the starting gate opens", words: WORDS, lane: "motion", format: story.format, brand: story.brand, audio: { words: "NARRATION.json" }, tier: "structured", model: "openai:gpt-5.6-luna", client, direction, bible, maxRepairs: 2 });
  return { report, calls };
}

for (const attempt of ATTEMPTS) {
  test(`the planner passes saved attempt ${attempt.attempt} without a repair call, and says what tooling corrected`, async () => {
    const { report, calls } = await plan([attempt.storyboard], attempt.direction);
    assert.equal(report.status, "passed", report.errors.join("\n"));
    assert.equal(calls.length, 1);
    assert.ok(report.warnings.some((entry) => entry.startsWith("normalise: ")));
    // The pace fit lengthens the shot before the mare's reply out of her first word; the cut is put back on that word.
    assert.ok(report.warnings.includes('normalise: the cut to foal-mare-wide-question-auto moved 5.73 → 5.39 s, so mare is on screen for all of "Not quite."'));
    assert.equal(report.storyboard.scenes.find((entry) => entry.id === "foal-mare-wide-question-auto").start, 5.39);
  });
}

test("a repair that fixes its finding and breaks a scene nobody named passes: that scene is kept as it was", async () => {
  const { storyboard, direction } = base();
  // A cue far outside its scene is the model's to fix.
  const first = clone(storyboard);
  scene(first, "foal-mare-wide-together-auto").params.cast[0].cues[1].at = 6;
  // The repair fixes it, and moves the lone foal of another shot to a side with a pose the kit does not have.
  const second = clone(storyboard);
  Object.assign(scene(second, "foal-medium-understands-auto").params.cast[0], { pose: "gallop" });
  const { report, calls } = await plan([first, second], direction);
  assert.equal(report.status, "passed", report.errors.join("\n"));
  assert.equal(calls.length, 2);
  assert.match(report.attempts[0].errors.join("\n"), /cues\[1\]\.at must be between/);
  assert.equal(report.attempts[0].candidate.scenes.length, first.scenes.length);
  assert.ok(report.warnings.includes("repair: tooling kept the params of 1 scene the findings did not reach (foal-medium-understands-auto)"));
  assert.match(calls[1].input, /gets its previous params back/);
});

test("a plan with more shots than its runtime holds passes: merged shots hand their characters and actions to the shot that takes their place", async () => {
  const saved = JSON.parse(readFileSync(new URL("merged-shots.json", dir), "utf8"));
  assert.ok(saved.errors.every((error) => error.startsWith("acting: ")));
  const calls = [];
  const client = { provider: "openai", async runStructured(request) { calls.push(request); return { model: "gpt-5.6-luna", value: { storyboard_json: JSON.stringify(saved.storyboard), direction_json: "" }, usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } }; } };
  const report = await planStoryboard({ brief: "A foal learns why the starting gate opens", words: saved.words, lane: "motion", format: saved.format, brand: saved.brand, audio: { words: "NARRATION.json" }, tier: "structured", model: "openai:gpt-5.6-luna", client, direction: saved.direction, bible: saved.bible, maxRepairs: 0 });
  assert.equal(report.status, "passed", report.errors.join("\n"));
  assert.equal(calls.length, 1);
  const said = report.warnings.join("\n");
  assert.match(said, /foal-asks-why \(1\.19 s\) merged into mare-names-gate, which takes foal from it/);
  assert.match(said, /acting: tooling gave foal the map's turn-to-look in mare-names-gate/);
  assert.match(said, /normalise: mare-names-gate ran 0\.002 s into mare-explains-start on track 0; its end moved 21\.29 → 21\.288 s/);
  assert.deepEqual(report.storyboard.scenes.find((entry) => entry.id === "mare-names-gate").params.cast.map((entry) => entry.id), ["mare", "foal"]);
});
