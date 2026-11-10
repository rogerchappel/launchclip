import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { checkStoryboard } from "../src/storyboard_planner.js";
import { DEFAULT_BRAND } from "@launchclip/core/planning-prompt.mjs";
import { SPEAKER_SHIFT, normalisePlan } from "../src/plan_normalise.js";

// A character story whose storyboard failed five times on mechanical slips
// (test/fixtures/storyboard-normalise/attempts.json says how it was saved).
const dir = new URL("./fixtures/storyboard-normalise/", import.meta.url);
const WORDS = JSON.parse(readFileSync(new URL("words.json", dir), "utf8"));
const { attempts: ATTEMPTS } = JSON.parse(readFileSync(new URL("attempts.json", dir), "utf8"));
const clone = (value) => JSON.parse(JSON.stringify(value));
// The plan as last saved: the base every limit test changes one thing in.
const base = () => clone(ATTEMPTS[4]);
const scene = (story, id) => story.scenes.find((entry) => entry.id === id);
const check = (storyboard, direction) => checkStoryboard(storyboard, { words: WORDS, direction, castGate: true, minHold: 2.5 });
const tidy = (storyboard, direction) => normalisePlan(storyboard, { words: WORDS, direction });
// The finding each saved error is, whatever its numbers: the text that names the rule.
const kind = (error) => [/overlaps scenes\[\d+\]/, /does not fit 1 character/, /does not overlap the line's words/, /target character "\w+" is not in this scene/, /but no scene with \w+ is on screen/, /cues\[\d+\]\.at must be between/].find((pattern) => pattern.test(error))?.source ?? null;

for (const attempt of ATTEMPTS) {
  test(`saved attempt ${attempt.attempt}: its mechanical findings are corrected and reported`, () => {
    const kinds = [...new Set(attempt.errors.map(kind))];
    assert.ok(kinds.length && kinds.every(Boolean), "every saved error is one of the mechanical kinds");
    const before = check(attempt.storyboard, attempt.direction);
    const found = new Set(before.errors.map(kind));
    // A one-character side position hides behind the overlaps until they are fixed (validation returns first), as it did in the run.
    for (const name of kinds) if (!(attempt.attempt === 0 && /does not fit/.test(name))) assert.ok(found.has(name), `the plan fails on ${name} before tooling`);
    const fixed = tidy(attempt.storyboard, attempt.direction);
    assert.ok(fixed.changed.length > 0);
    const after = check(fixed.storyboard, fixed.direction);
    // What is left is pace alone (a shot under 2.5 s), which the planner ships as a warning.
    assert.deepEqual(after.errors.filter((error) => !error.startsWith("pace: ")), []);
    // The planner's copy is untouched.
    assert.deepEqual(attempt.storyboard, ATTEMPTS[attempt.attempt].storyboard);
  });
}

test("saved attempts: each correction is named in the report", () => {
  const said = (index) => tidy(ATTEMPTS[index].storyboard, ATTEMPTS[index].direction).changed.join("\n");
  assert.match(said(0), /foal-medium-hay-auto: foal is alone in the shot, so position "left" became "centre"/);
  assert.match(said(0), /foal-mare-wide-arrival ran 0\.38 s into foal-medium-hay-auto on track 0; its end moved 3\.6 → 3\.22 s/);
  assert.match(said(1), /foal-medium-realization-auto: foal's target mare is not in the shot; the target became "right", the side mare stands on/);
  assert.match(said(1), /direction s4 line 1 named foal-mare-wide-start-together, which is not on its words .* it names foal-mare-wide-together-auto/);
  assert.match(said(3), /foal-mare-wide-together-auto: foal's cue at 2\.5 s is outside the 2\.84 s scene .* it moved to 2\.39 s/);
  assert.match(said(4), /the cut to foal-mare-wide-question-auto moved 5\.73 → 5\.39 s, so mare is on screen for all of "Not quite\."/);
  assert.match(said(4), /the cut to foal-mare-wide-shared-start-auto moved 20\.96 → 20\.59 s, so mare is on screen for all of "That's it\."/);
});

test("a plan with nothing to correct comes back as it was", () => {
  const { storyboard, direction } = base();
  const once = tidy(storyboard, direction);
  const twice = tidy(once.storyboard, once.direction);
  assert.deepEqual(twice.changed, []);
  assert.equal(twice.storyboard, once.storyboard);
});

test("positions: one character takes the centre; two keep their sides and lose a centre", () => {
  const { storyboard, direction } = base();
  scene(storyboard, "foal-medium-first-auto").params.cast[0].position = "right";
  scene(storyboard, "foal-mare-wide-arrival").params.cast[1].position = "centre";
  const fixed = tidy(storyboard, direction);
  assert.equal(scene(fixed.storyboard, "foal-medium-first-auto").params.cast[0].position, "centre");
  assert.equal(scene(fixed.storyboard, "foal-mare-wide-arrival").params.cast[0].position, "left");
  assert.equal(scene(fixed.storyboard, "foal-mare-wide-arrival").params.cast[1].position, undefined);
});

test("overlaps: the later scene's start moves when the earlier one cannot be trimmed, and its cue keeps its moment", () => {
  const { storyboard, direction } = base();
  // The approach starts 0.4 s early; trimming the scene before it to 10.71 s keeps it above 2 s, so that is what moves.
  scene(storyboard, "foal-mare-wide-approach").start = 10.71;
  assert.match(tidy(storyboard, direction).changed.join("\n"), /foal-medium-first-auto ran 0\.4 s into foal-mare-wide-approach on track 0; its end moved 11\.11 → 10\.71 s/);
  // It starts 1.3 s early: the scene before it would be left 1.57 s, so its own start moves, and its numeric cue with it.
  const late = base();
  Object.assign(scene(late.storyboard, "foal-mare-wide-start-together"), { start: 15.14 });
  scene(late.storyboard, "foal-mare-wide-together-auto").start = 13.62;
  const fixed = tidy(late.storyboard, late.direction);
  assert.match(fixed.changed.join("\n"), /foal-mare-wide-start-together began 1\.3 s inside foal-mare-wide-together-auto on track 0; its start moved 15\.14 → 16\.44 s/);
  assert.equal(scene(fixed.storyboard, "foal-mare-wide-start-together").start, 16.44);
  assert.equal(scene(fixed.storyboard, "foal-mare-wide-start-together").params.cast[0].cues[0].at, 0);
});

test("overlaps: a scene that ends a few milliseconds into the next one's anchored start ends on it", () => {
  const { storyboard, direction } = base();
  // "Maybe" starts at 8.242 s; the scene before it ends at 8.25 s.
  scene(storyboard, "foal-mare-wide-question-auto").end = 8.25;
  scene(storyboard, "foal-medium-first-auto").start = "word:Maybe";
  const fixed = tidy(storyboard, direction);
  assert.equal(scene(fixed.storyboard, "foal-mare-wide-question-auto").end, 8.242);
  assert.deepEqual(check(fixed.storyboard, fixed.direction).errors.filter((error) => /overlaps/.test(error)), []);
});

test("overlaps: when neither scene keeps its minimum length the overlap stays an error", () => {
  const { storyboard, direction } = base();
  // Two 2.01 s scenes, the second starting 1 s into the first.
  Object.assign(scene(storyboard, "foal-mare-wide-start-together"), { start: 16.44, end: 18.45 });
  Object.assign(scene(storyboard, "foal-medium-realization-auto"), { start: 17.44, end: 19.45 });
  const fixed = tidy(storyboard, direction);
  assert.ok(!fixed.changed.some((entry) => entry.includes("on track 0")));
  assert.ok(check(fixed.storyboard, fixed.direction).errors.some((error) => /foal-medium-realization-auto\) overlaps scenes\[6\]/.test(error)));
});

test("cue times: just outside moves to the edge; far outside stays an error", () => {
  const { storyboard, direction } = base();
  const cues = scene(storyboard, "foal-mare-wide-together-auto").params.cast[0].cues;
  cues[1].at = -0.2;
  cues.push({ at: 6, expression: "happy" });
  const fixed = tidy(storyboard, direction);
  const after = scene(fixed.storyboard, "foal-mare-wide-together-auto").params.cast[0].cues;
  assert.equal(after[1].at, 0);
  assert.equal(after[2].at, 6);
  assert.ok(check(fixed.storyboard, fixed.direction).errors.some((error) => /cues\[2\]\.at must be between/.test(error)));
});

test("targets: a wide shot with room takes the character; a closer shot looks to their side", () => {
  const { storyboard, direction } = base();
  const medium = scene(storyboard, "foal-medium-first-auto");
  medium.params.cast[0].cues[0] = { at: "word:first", action: "gaze-at", target: { character: "mare" } };
  const wide = scene(storyboard, "foal-medium-understands-auto");
  wide.params.shot = "wide";
  wide.params.cast[0].target = { character: "mare" };
  const fixed = tidy(storyboard, direction);
  assert.equal(scene(fixed.storyboard, "foal-medium-first-auto").params.cast[0].cues[0].target, "right");
  assert.deepEqual(scene(fixed.storyboard, "foal-medium-first-auto").params.cast.map((entry) => entry.id), ["foal"]);
  const joined = scene(fixed.storyboard, "foal-medium-understands-auto").params.cast;
  assert.deepEqual(joined.map((entry) => entry.id), ["foal", "mare"]);
  // The character who was alone in the centre takes its side beside the newcomer.
  assert.equal(joined[0].position, undefined);
  assert.deepEqual(joined[0].target, { character: "mare" });
  assert.match(fixed.changed.join("\n"), /foal-medium-understands-auto: foal's target mare is not in the shot; mare joined it/);
  assert.deepEqual(check(fixed.storyboard, fixed.direction).errors.filter((error) => /target|position/.test(error)), []);
});

test("targets: with no side to look to, a target an action needs stays an error and any other is dropped", () => {
  const { storyboard, direction } = base();
  for (const member of storyboard.cast.characters) delete member.position;
  const cast = scene(storyboard, "foal-medium-first-auto").params.cast[0];
  cast.target = { character: "mare" };
  cast.cues[0] = { at: "word:first", action: "gaze-at", target: { character: "mare" } };
  const fixed = tidy(storyboard, direction);
  const after = scene(fixed.storyboard, "foal-medium-first-auto").params.cast[0];
  assert.equal(after.target, undefined);
  assert.deepEqual(after.cues[0].target, { character: "mare" });
  assert.match(fixed.changed.join("\n"), /foal-medium-first-auto: foal's target mare is not in the shot; the target was dropped/);
});

test("speakers: a cut further off than a small move, or most of a line unseen, stays an error", () => {
  // The mare's shot starts 1 s after her two-word line does.
  const far = base();
  scene(far.storyboard, "foal-medium-hay-auto").end = 6.4;
  scene(far.storyboard, "foal-mare-wide-question-auto").start = 6.4;
  assert.ok(6.4 - 5.39 > SPEAKER_SHIFT);
  const kept = tidy(far.storyboard, far.direction);
  assert.equal(scene(kept.storyboard, "foal-mare-wide-question-auto").start, 6.4);
  assert.ok(check(kept.storyboard, kept.direction).errors.some((error) => /mare speaks words \[18, 19\]/.test(error)));
  // The mare's shot is cut after two words of her six-word question: four are unseen, and the cut is 0.9 s off.
  const most = base();
  scene(most.storyboard, "foal-mare-wide-question-auto").end = 7.05;
  scene(most.storyboard, "foal-medium-first-auto").start = 7.05;
  const still = tidy(most.storyboard, most.direction);
  assert.equal(scene(still.storyboard, "foal-mare-wide-question-auto").end, 7.05);
  assert.ok(check(still.storyboard, still.direction).errors.some((error) => /mare speaks words \[20, 25\]/.test(error)));
});

test("speakers: a line's last word past the cut pulls the cut out to it", () => {
  const { storyboard, direction } = base();
  // The mare's question ends on "for?" (7.46–7.94 s); the cut to the foal alone comes at 7.6 s.
  scene(storyboard, "foal-mare-wide-question-auto").end = 7.6;
  scene(storyboard, "foal-medium-first-auto").start = 7.6;
  const fixed = tidy(storyboard, direction);
  assert.match(fixed.changed.join("\n"), /the cut out of foal-mare-wide-question-auto moved 7\.6 → 7\.95 s, so mare is on screen for all of "What else could it be for\?"/);
  assert.equal(scene(fixed.storyboard, "foal-medium-first-auto").start, 7.95);
  assert.deepEqual(check(fixed.storyboard, fixed.direction).errors.filter((error) => !error.startsWith("pace: ")), []);
});

test("speakers: a line that says why the picture is elsewhere is left alone", () => {
  const { storyboard, direction } = base();
  direction.sections[1].lines[1].why = "we stay on the foal as the answer lands";
  const fixed = tidy(storyboard, direction);
  assert.equal(scene(fixed.storyboard, "foal-mare-wide-question-auto").start, 5.73);
});

test("line scenes: a scene off the line's words is dropped beside one that is on them, and two candidates are the model's to choose", () => {
  const { storyboard, direction } = base();
  const line = direction.sections[3].lines[0];
  line.scenes = ["foal-mare-wide-together-auto", "foal-medium-understands-auto"];
  const fixed = tidy(storyboard, direction);
  assert.deepEqual(fixed.direction.sections[3].lines[0].scenes, ["foal-mare-wide-together-auto"]);
  // Two character scenes each over half of the line's words: tooling does not pick.
  const split = base();
  split.direction.sections[3].lines[0].scenes = ["foal-medium-understands-auto"];
  scene(split.storyboard, "foal-mare-wide-approach").end = 15.02;
  scene(split.storyboard, "foal-mare-wide-together-auto").start = 15.02;
  const left = tidy(split.storyboard, split.direction);
  assert.deepEqual(left.direction.sections[3].lines[0].scenes, ["foal-medium-understands-auto"]);
  assert.ok(check(left.storyboard, left.direction).errors.some((error) => /does not overlap the line's words/.test(error)));
});

// An ordinary (no cast, no show bible) narrated video: the planner runs the same step on every lane.
const ORDINARY_WORDS = [["Why", 0.1], ["does", 0.3], ["coffee", 0.5], ["cool", 0.9], ["fast", 1.3], ["then", 3.1], ["slow", 3.5], ["Newton", 4.2], ["named", 4.7], ["the", 5.0], ["law", 5.2], ["of", 5.5], ["cooling", 5.7], ["The", 6.6], ["gap", 6.9], ["shrinks", 7.3], ["follow", 9.4], ["for", 9.8], ["more", 10.0]].map(([text, start]) => ({ text, start, end: start + 0.25 }));
const ordinary = () => ({
  schema: "launchclip.story.v1", title: "Why coffee cools", lane: "voiceover-motion", format: { width: 1080, height: 1920, fps: 30, duration: 12 }, brand: DEFAULT_BRAND, audio: { voice: "assets/audio/narration.wav", words: "NARRATION.json" },
  scenes: [
    { id: "s1", module: "hook-title", start: 0, end: "word:then", energy: 1, params: { headline: "Why does your coffee cool so fast?", emphasis: "fast" } },
    { id: "s2", module: "equation-lockup", start: "word:then", end: "word:the#2", energy: 2, params: { name: "Newton's law of cooling", equation: "dT/dt = −k (T − T_room)", note: "rate follows the gap" } },
    { id: "s3", module: "checklist", start: "word:the#2", end: "word:follow", energy: 2, params: { title: "What sets the pace", rows: [{ label: "Big gap: fast", status: "done", at: 0.4 }, { label: "Small gap: slow", status: "done", at: 1.1 }] } },
    { id: "s4", module: "cta", start: "word:follow", end: 12, energy: 1, params: { action: "Follow for more physics", loop: true } }
  ],
  overlays: [{ type: "captions", style: "word-highlight" }]
});

test("an ordinary video: a valid plan is returned untouched (the same object, nothing reported)", () => {
  const storyboard = ordinary();
  const before = JSON.stringify(storyboard);
  const fixed = normalisePlan(storyboard, { words: ORDINARY_WORDS });
  assert.deepEqual(fixed.changed, []);
  assert.equal(fixed.storyboard, storyboard);
  assert.equal(JSON.stringify(storyboard), before);
});

test("an ordinary video: scenes overlapping on a track are trimmed to meet, anchors and all", () => {
  const storyboard = ordinary();
  // The lockup runs 1.6 s past the word the checklist starts on.
  storyboard.scenes[1].end = "word:the#2+1.6";
  const overlap = (story) => checkStoryboard(story, { words: ORDINARY_WORDS }).errors.filter((error) => /overlaps scenes/.test(error));
  assert.equal(overlap(storyboard).length, 1);
  const fixed = normalisePlan(storyboard, { words: ORDINARY_WORDS });
  assert.deepEqual(fixed.changed, ["s2 ran 1.6 s into s3 on track 0; its end moved 8.2 → 6.6 s"]);
  assert.equal(fixed.storyboard.scenes[1].end, 6.6);
  assert.equal(fixed.storyboard.scenes[2].start, "word:the#2");
  assert.equal(checkStoryboard(ordinary(), { words: ORDINARY_WORDS }).ok, true);
  assert.deepEqual(overlap(fixed.storyboard), []);
});
