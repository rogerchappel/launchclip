// The first real `make --animation` run (a foal and a mare at a starting
// gate) ended needs-repair on three defects. The fixtures are its project,
// trimmed (test/fixtures/animation-first-run): the storyboard as planned,
// the narration's words with their speakers, and the direction map.
//
// 1. Retakes never landed: a cue's word anchor resolved to the first time
//    the narration says the word, not the time it is said in the cue's scene,
//    so cue times came out negative and the retake was undone.
// 2. A character spoke with its mouth closed: a scene that left `says` out
//    (or a line the cut falls inside) played the line over a still mouth.
// 3. A line's action was performed by nobody: a walk-to that could not reach
//    its target before a short shot ended failed validation, so the planner
//    dropped the action; the plan was never held to the acting gate.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveStory, sceneWordAnchor } from "@launchclip/core/story.mjs";
import { resolveModule } from "@launchclip/core/modules.mjs";
import { walkDistance } from "@launchclip/core/characters/actions.mjs";
import { moduleParamErrors, validateStory } from "../src/story_cli.js";
import { lipSyncGate } from "../src/quality_gates.js";
import { actingGate } from "../src/direction_guardrails.js";
import { checkStoryboard } from "../src/storyboard_planner.js";
import { redirectShots } from "../src/make/retakes.js";
import { placeActions } from "../src/acting_place.js";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/animation-first-run/${name}`, import.meta.url), "utf8"));
const STORY = fixture("storyboard.json");
const WORDS = fixture("NARRATION.json").words;
const MAP = fixture("DIRECTION.json");

const story = (change) => { const copy = structuredClone(STORY); change?.(Object.fromEntries(copy.scenes.map((scene) => [scene.id, scene])), copy); return copy; };
const actor = (scene, id) => scene.params.cast.find((entry) => entry.id === id);
const resolve = (raw) => resolveStory(raw, { words: WORDS });
const errors = (raw) => { const check = validateStory(raw); return check.ok ? moduleParamErrors(resolve(raw)) : check.errors; };
const cues = (resolved, scene, id) => actor(resolved.scenes.find((entry) => entry.id === scene), id).cues.map((cue) => cue.at);

// The cues the critic's retake wrote, as its errors name them: each word is
// said in its own scene, and earlier in the narration too.
const retaken = () => story((scenes) => {
  actor(scenes["foal-questions"], "foal").cues = [{ at: "word:Why", expression: "worried" }];
  actor(scenes["mare-encourages"], "mare").cues = [{ at: "word:It", pose: "point", expression: "happy" }];
  actor(scenes["foal-realizes"], "foal").cues = [{ at: "word:looked", action: "turn-to-look", target: "right" }, { at: "word:When", expression: "delighted" }];
});

test("the saved plan is valid as it was written", () => {
  assert.deepEqual(errors(story()), []);
});

test("retake cues: a word anchor is the word as it is said during its scene, not the narration's first", () => {
  const raw = retaken();
  assert.deepEqual(errors(raw), [], "the retake validates");
  const resolved = resolve(raw);
  // "Why" starts a millisecond before the scene does (1.999 s, scene 2 s): the scene's first frame.
  assert.deepEqual(cues(resolved, "foal-questions", "foal"), [0]);
  // "It means you can start" (15.122 s) in a scene from 14.06 s; the first "it" is at 2.404 s (was -11.656).
  assert.deepEqual(cues(resolved, "mare-encourages", "mare"), [1.062]);
  // "When it opens, I get to run!" (18.403 s) in a scene from 16.57 s; the first "When" is at 9.488 s (was -7.082).
  assert.deepEqual(cues(resolved, "foal-realizes", "foal"), [0.463, 1.833]);
});

test("sceneWordAnchor: in the scene first, else nearest; #n stays the narration's; near misses move to the scene's edge", () => {
  const scene = { start: 14.06, end: 16.57 };
  assert.equal(sceneWordAnchor("word:It", scene, WORDS), 1.062);
  assert.equal(sceneWordAnchor("word:it#1", scene, WORDS), -11.656, "an explicit occurrence is kept");
  assert.equal(sceneWordAnchor("word:start+0.6", scene, WORDS), 2.06, "past the last moment a cue may land: the last moment");
  // "Not at all." starts 0.29 s before the scene: it plays as the scene opens.
  assert.equal(sceneWordAnchor("word:Not", scene, WORDS), 0);
  assert.equal(sceneWordAnchor(1.5, scene, WORDS), null, "seconds are the scene's own already");
  assert.equal(sceneWordAnchor("word:zebra", scene, WORDS), null, "an unknown word is the resolver's to report");
  // A word said only far from the scene still fails, by name.
  const far = story((scenes) => { actor(scenes["foal-ready"], "foal").cues = [{ at: "word:watched", expression: "happy" }]; });
  assert.match(errors(far).join("\n"), /foal-ready.*cues\[0\]\.at must be between 0 and/);
});

test("a retake that does not validate gets one corrective pass with the validator's messages, and a failure says what was tried", async () => {
  const scene = structuredClone(STORY.scenes.find((entry) => entry.id === "foal-ready"));
  const bad = structuredClone(scene);
  actor(bad, "foal").cues = [{ at: "word:watched", expression: "happy" }];
  const good = structuredClone(scene);
  actor(good, "foal").cues = [{ at: "word:ready", pose: "cheer", expression: "delighted" }];
  const inputs = [];
  const answers = [bad, good];
  const client = { runStructured: async ({ input }) => { inputs.push(input); return { value: { scenes_json: JSON.stringify([answers[inputs.length - 1] ?? bad]), note: "restaged" }, usage: { input_tokens: 10, output_tokens: 5 }, model: "test" }; } };
  const args = { project: "/nonexistent", story: STORY, words: WORDS, shots: ["foal-ready"], shotList: [], problems: ["critic (major acting, scene foal-ready): flat"] };
  const fixed = await redirectShots({ client, ...args });
  assert.equal(fixed.attempts, 2);
  assert.equal(fixed.usage.length, 2);
  assert.match(inputs[1], /did not validate[\s\S]*cues\[0\]\.at must be between 0 and/);
  assert.deepEqual(fixed.rejected.map((entry) => entry.attempt), [1]);
  // The caller's own checks (make's plan checks) are part of the same loop.
  inputs.length = 0;
  let checks = 0;
  const held = await redirectShots({ client: { runStructured: async ({ input }) => { inputs.push(input); return { value: { scenes_json: JSON.stringify([good]), note: "n" }, usage: {}, model: "test" }; } }, ...args, check: () => (checks++ ? [] : ["acting: foal is not in foal-ready"]) });
  assert.equal(held.attempts, 2);
  assert.match(inputs[1], /acting: foal is not in foal-ready/);
  // Still wrong after the corrective pass: the error carries every attempt's messages and what the calls cost.
  inputs.length = 0;
  answers.splice(0, 2, bad, bad);
  const failure = await redirectShots({ client, ...args }).catch((error) => error);
  assert.match(failure.message, /^the retake did not validate after 2 attempts: /);
  assert.equal(failure.attempts, 2);
  assert.equal(failure.usage.length, 2);
  assert.equal(failure.rejected.length, 2);
  assert.match(failure.rejected[1].errors[0], /must be between 0 and/);
});

test("lip sync: a character with a line in a scene moves its mouth on its words, whether or not the scene sets says", () => {
  const resolved = resolve(story());
  // The mare's "That's right." starts in gate-opens, where the plan gave her no `says`.
  const mare = actor(resolved.scenes.find((scene) => scene.id === "gate-opens"), "mare");
  assert.deepEqual(mare.says.map((range) => range.words[0][2]), ["That's", "right."]);
  // "Why" starts a millisecond before foal-questions: the foal's mouth opens on it.
  const foal = actor(resolved.scenes.find((scene) => scene.id === "foal-questions"), "foal");
  assert.equal(foal.says[0].words[0][2], "Why");
  // The narrator's words move nobody's mouth, and a character with no line in the scene says nothing.
  assert.equal(actor(resolved.scenes.find((scene) => scene.id === "gate-wide"), "foal").says, undefined);
  const gate = lipSyncGate({ resolved, words: WORDS });
  assert.equal(gate.status, "passed", gate.errors?.join("\n"));
  // The mouths the renderers draw: open during the line.
  const model = resolveModule(resolved.scenes.find((scene) => scene.id === "gate-opens"), resolved);
  const speech = model.content.actors.find((entry) => entry.id === "mare").speech;
  assert.ok(speech.some((change) => change.open && change.time >= 21.07 && change.time < 21.51), "the mare's mouth opens on That's right.");
});

test("lip sync: an explicit says is kept, and an empty one keeps the mouth shut", () => {
  const ranges = [{ from: "word:That's", to: "word:right" }];
  const explicit = resolve(story((scenes) => { actor(scenes["gate-opens"], "mare").says = ranges; }));
  const says = actor(explicit.scenes.find((scene) => scene.id === "gate-opens"), "mare").says;
  assert.equal(says.length, 1);
  assert.deepEqual(says[0].words.map((word) => word[2]), ["That's", "right."]);
  const shut = resolve(story((scenes) => { actor(scenes["gate-opens"], "mare").says = []; }));
  assert.deepEqual(actor(shut.scenes.find((scene) => scene.id === "gate-opens"), "mare").says, []);
  assert.deepEqual(lipSyncGate({ resolved: shut, words: WORDS }).findings.map((finding) => [finding.rule, finding.scene, finding.character]), [["mouth-closed", "gate-opens", "mare"]]);
});

// The planner's first answer for "One step, then another." (words 66–69): the foal walks on "another".
const walking = () => story((scenes) => {
  actor(scenes["mare-playful"], "foal").cues = [{ at: 0.1, action: "gaze-at", target: { character: "mare" } }, { at: "word:another", action: "walk-to", target: "right", expression: "focused" }];
});

test("acting: a walk-to in a short shot walks as far as the shot allows instead of failing the plan", () => {
  const raw = walking();
  assert.deepEqual(errors(raw), [], "the walk fits the shot");
  const resolved = resolve(raw);
  const scene = resolved.scenes.find((entry) => entry.id === "mare-playful");
  const model = resolveModule(scene, resolved);
  const foal = model.content.actors.find((entry) => entry.id === "foal");
  const walk = foal.states.find((state) => state.action === "walk-to");
  const arrive = foal.states.find((state) => state.arrive);
  assert.ok(arrive.time <= scene.end - 0.45 + 1e-6, "it stands before the scene ends");
  assert.ok(walk.walk.duration >= 0.4 && walk.walk.to - walk.walk.from > 40, "a real step, to the right");
  assert.ok(Math.abs(walkDistance(walk.walk.duration, foal.scale) - (walk.walk.to - walk.walk.from)) < 0.01, "at a walking pace");
  const gate = actingGate(resolved, { map: MAP, words: WORDS });
  assert.deepEqual(gate.findings, []);
  // No room for even a step: the message says what to change.
  const late = story((scenes) => { actor(scenes["mare-playful"], "foal").cues = [{ at: 1.9, action: "walk-to", target: "right" }]; });
  assert.match(errors(late).join("\n"), /walk-to at 1\.9 s has 0\.22 s before the scene ends; a walk needs at least 0\.4 s: move the cue earlier/);
});

test("acting: the plan is held to its map, and the message says whether the character needs a cue or a place in the shot", () => {
  const options = { words: WORDS, direction: MAP, castGate: true, bandErrors: false };
  // As saved: the foal is in mare-playful with a walk pose, not the walk-to the map names.
  const saved = checkStoryboard(story(), options);
  const acting = saved.errors.filter((entry) => entry.startsWith("acting: "));
  assert.equal(acting.length, 1, saved.errors.join("\n"));
  assert.match(acting[0], /names foal walk-to .* but foal does not perform it in mare-playful; give foal a cue \{at: "word:…", action: "walk-to", target: left \| right \| \{character: id\} \| \{prop: id\}\} there/);
  // The foal left out of the shot on those words.
  const alone = story((scenes) => {
    const mare = actor(scenes["mare-playful"], "mare");
    scenes["mare-playful"].params.cast = [{ ...mare, position: "centre", target: "left", cues: mare.cues.filter((cue) => !cue.target?.character) }];
  });
  const missing = checkStoryboard(alone, options).errors.filter((entry) => entry.startsWith("acting: "));
  assert.match(missing.join("\n"), /foal is not in mare-playful, the cast scene on those words; add foal to that scene's params\.cast with a cue/);
  // With the walk-to in place the plan passes the acting and lip-sync checks.
  const fixed = checkStoryboard(walking(), options);
  assert.deepEqual(fixed.errors.filter((entry) => /^(acting|lip-sync): /.test(entry)), []);
});

test("acting: a character turned to its target is looking at it; a far look with no place in the frame cannot be covered", () => {
  // The mare's "That's right." names mare gaze-at: her scene entry targets the foal and no cue repeats it.
  const quiet = story((scenes) => { actor(scenes["mare-playful"], "mare").cues = [{ at: "word:step", pose: "point", expression: "happy" }]; });
  const found = actingGate(resolve(quiet), { map: MAP, words: WORDS }).findings.filter((finding) => finding.who === "mare");
  assert.deepEqual(found, []);
  // A cameo with a card, looking far with no world beneath: the far point has no x.
  const cameo = story((scenes, copy) => {
    delete copy.world;
    Object.assign(scenes["foal-ready"], { module: "character-cameo", params: { character: "foal", side: "left", card: { title: "Ready" }, cues: [{ at: "word:ready", action: "look-far" }] } });
  });
  const resolved = resolve(cameo);
  const rects = [{ id: "foal-ready", role: "text", start: 24.08, end: 26.6, rect: { x: 0, y: 0, width: 1920, height: 1080 } }];
  assert.deepEqual(actingGate(resolved, { map: MAP, words: WORDS, rects }).findings.filter((finding) => finding.rule === "look-target-hidden"), []);
});

test("a retake is told the actions its shots must keep and the targets a cue can take", async () => {
  let seen = "";
  const scene = structuredClone(STORY.scenes.find((entry) => entry.id === "mare-playful"));
  actor(scene, "foal").expression = "happy";
  const client = { runStructured: async ({ input }) => { seen = input; return { value: { scenes_json: JSON.stringify([scene]), note: "n" }, usage: {}, model: "test" }; } };
  const shotList = [{ id: "mare-playful", start: 21.51, end: 24.08, who: ["foal", "mare"], lines: [], actions: [{ verb: "walk-to", who: "foal", target: "another small step toward the open gate", line: "l11" }] }];
  await redirectShots({ client, project: "/nonexistent", story: STORY, words: WORDS, shots: ["mare-playful"], shotList, problems: [] });
  assert.match(seen, /must still happen in this shot: foal performs a cue with action "walk-to" \(another small step toward the open gate\)/);
  assert.match(seen, /target \(a character's, or a cue's\): exactly one of far, window, horizon, street, skyline, left, right, \{"character"/);
});

test("a retake of several shots keeps the ones that pass when the corrective passes run out", async () => {
  const ready = structuredClone(STORY.scenes.find((entry) => entry.id === "foal-ready"));
  actor(ready, "foal").cues = [{ at: "word:watched", expression: "happy" }];
  const hopeful = structuredClone(STORY.scenes.find((entry) => entry.id === "foal-hopeful"));
  actor(hopeful, "foal").expression = "worried";
  const client = { runStructured: async () => ({ value: { scenes_json: JSON.stringify([ready, hopeful]), note: "restaged" }, usage: {}, model: "test" }) };
  const kept = await redirectShots({ client, project: "/nonexistent", story: STORY, words: WORDS, step: "replan-beat", shots: ["foal-ready", "foal-hopeful"], shotList: [], problems: [] });
  assert.deepEqual(kept.changed, ["foal-hopeful"]);
  assert.equal(kept.attempts, 2);
  assert.match(kept.ignored.join("\n"), /scene foal-ready's retake \(it did not pass the checks; the shot stays as it was\)/);
  assert.deepEqual(kept.story.scenes.find((entry) => entry.id === "foal-ready"), STORY.scenes.find((entry) => entry.id === "foal-ready"));
});

test("acting: a map action whose character is in the shot without its cue is placed by tooling, on the line's words", () => {
  // As saved: the foal is in mare-playful on "One step, then another." with a walk pose and no walk-to.
  const placed = placeActions(story(), { direction: MAP, words: WORDS });
  assert.deepEqual(placed.changed, ["gave foal the map's walk-to in mare-playful at 0.928 s (a new cue)"]);
  const cue = actor(placed.storyboard.scenes.find((scene) => scene.id === "mare-playful"), "foal").cues.at(-1);
  assert.deepEqual(cue, { at: 0.928, action: "walk-to", target: "right" });
  const checked = checkStoryboard(placed.storyboard, { words: WORDS, direction: MAP, castGate: true, bandErrors: false });
  assert.deepEqual(checked.errors.filter((entry) => /^(acting|lip-sync|params|cast): /.test(entry)), []);
  assert.deepEqual(STORY.scenes.find((scene) => scene.id === "mare-playful"), story().scenes.find((scene) => scene.id === "mare-playful"), "the input is not changed");
  // Nothing to do: nothing changes. A character who is not in the shot is left to the planner.
  assert.equal(placeActions(placed.storyboard, { direction: MAP, words: WORDS }).changed.length, 0);
  const alone = story((scenes) => {
    const mare = actor(scenes["mare-playful"], "mare");
    scenes["mare-playful"].params.cast = [{ ...mare, position: "centre", target: "left", cues: mare.cues.filter((entry) => !entry.target?.character) }];
  });
  assert.deepEqual(placeActions(alone, { direction: MAP, words: WORDS }).changed, []);
  // A target the map names as a cast member in the shot becomes that character.
  const map = structuredClone(MAP);
  const line = map.sections.flatMap((section) => section.lines).find((entry) => entry.words[0] === 66);
  line.action = { verb: "point-at", who: "foal", target: "the Mare beside it" };
  const pointed = placeActions(story(), { direction: map, words: WORDS });
  assert.deepEqual(actor(pointed.storyboard.scenes.find((scene) => scene.id === "mare-playful"), "foal").cues.at(-1), { at: 0.928, action: "point-at", target: { character: "mare" } });
});

test("a retake that drops a map action's cue gets it back from the caller's tooling before it is checked", async () => {
  const scene = structuredClone(walking().scenes.find((entry) => entry.id === "mare-playful"));
  actor(scene, "foal").cues = [{ at: 0.1, expression: "happy" }];
  const base = walking();
  const client = { runStructured: async () => ({ value: { scenes_json: JSON.stringify([scene]), note: "n" }, usage: {}, model: "test" }) };
  const options = { words: WORDS, direction: MAP, castGate: true, bandErrors: false };
  const check = (candidate) => checkStoryboard(candidate, options).errors.filter((entry) => entry.startsWith("acting: "));
  const args = { client, project: "/nonexistent", story: base, words: WORDS, shots: ["mare-playful"], shotList: [], problems: [], check };
  await assert.rejects(redirectShots(args), /did not validate after 2 attempts: acting: .*foal does not perform it in mare-playful/);
  const fixed = await redirectShots({ ...args, tidy: (candidate) => placeActions(candidate, { direction: MAP, words: WORDS }).storyboard });
  assert.equal(fixed.attempts, 1);
  assert.equal(actor(fixed.story.scenes.find((entry) => entry.id === "mare-playful"), "foal").cues.at(-1).action, "walk-to");
});
