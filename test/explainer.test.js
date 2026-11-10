// A short explainer is carried by characters (kit/core/explainer.mjs), and
// the planner catches what the finish gates would fail. The fixtures are a
// real run's storyboard, direction map, narration and gate results
// (test/fixtures/make-sourdough): nine scenes of line diagrams, step rows and
// cards, no character, failing ghosting, structure and motion.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CHARACTER_SCENE_MODULES, EXPLAINER_TONE, abstractErrors, abstractFindings, castFromDirection, characterErrors, characterShare, defaultExplainerCast, explainerDirectionLines, explainerLook, explainerStoryboardLines, openingErrors } from "@launchclip/core/explainer.mjs";
import { directionPrompt, planningPrompt } from "@launchclip/core/planning-prompt.mjs";
import { resolveStory } from "@launchclip/core/story.mjs";
import { applyStyle } from "@launchclip/core/style.mjs";
import { generateStyle } from "@launchclip/core/style-seed.mjs";
import { castGate } from "../src/cast.js";
import { ghostingGate, paramWords, readingFindings, varietyGate } from "../src/direction_guardrails.js";
import { characterLed, explainerContent, explainerSeed } from "../src/make/explainer.js";
import { planReadingErrors, planStoryboard } from "../src/storyboard_planner.js";
import { promptConstraints, promptTone } from "../src/style_seed_store.js";
import { SOURDOUGH_CAST, explainerDirection, explainerStoryboard } from "./helpers/explainer_fakes.js";

const fixture = async (name) => JSON.parse(await readFile(new URL(`./fixtures/make-sourdough/${name}`, import.meta.url), "utf8"));
const [saved, narration, direction, gates] = await Promise.all([fixture("storyboard.json"), fixture("narration.json"), fixture("direction.json"), fixture("gates.json")]);
const PROMPT = "A 30-second explainer on why sourdough needs a starter";
const resolved = (story) => resolveStory(JSON.parse(JSON.stringify(story)), { words: narration.words });
const portrait = { width: 1080, height: 1920, fps: 30, duration: 26.2 };

test("reproduced: the saved video is nine scenes of diagrams, step rows and cards with no character", () => {
  const story = resolved(saved);
  assert.deepEqual(story.scenes.map((scene) => scene.module), ["line-diagram", "process-steps", "line-diagram", "compare", "process-steps", "line-diagram", "process-steps", "line-diagram", "cta"]);
  assert.ok(!story.scenes.some((scene) => CHARACTER_SCENE_MODULES.includes(scene.module)));
  assert.equal(characterShare(story).share, 0);
  assert.equal(saved.cast.characters.length > 0, true, "the seeded style had a cast; nothing told the director to use it");
});

test("the variety gate fails a video made only of line diagrams and dot rows, and passes one that pictures its subject", () => {
  const story = resolved(saved);
  assert.equal(abstractFindings(story).abstract, true);
  const gate = varietyGate(story);
  assert.equal(gate.status, "failed");
  assert.match(gate.findings.find((finding) => finding.rule === "abstract-only").detail, /all 9 scenes are line diagrams, step rows and text cards \(line-diagram, process-steps, compare, cta\), with nothing pictured/);
  assert.match(abstractErrors(story)[0], /^variety: all 9 scenes/);
  // One pictured scene is enough to pass it; so is a short piece, or one over a recording.
  const withChart = { ...story, scenes: story.scenes.map((scene, index) => (index === 4 ? { ...scene, module: "bar-chart" } : scene)) };
  assert.equal(abstractFindings(withChart).abstract, false);
  assert.equal(abstractFindings({ ...story, scenes: story.scenes.slice(0, 4) }).abstract, false);
  assert.equal(abstractFindings({ ...story, base: "assets/talk.mp4" }).abstract, false);
  const characters = resolved(explainerStoryboard({ format: portrait, brand: saved.brand }));
  assert.equal(varietyGate({ ...characters, cast: castFromDirection({ cast: SOURDOUGH_CAST }).cast }).findings.some((finding) => finding.rule === "abstract-only"), false);
});

test("reproduced: the ghosting failure counted a diagram's wiring as words to read (33 for a 10-word sketch)", () => {
  const first = saved.scenes[0];
  assert.equal(first.module, "line-diagram");
  assert.match(gates.ghosting.findings[0].detail, /starter-jar-and-loaf \(33 words\) is fully shown for 2\.24 s; it needs 7\.26 s/);
  // What is on screen: a 7-word title, two labels and a question mark. The other 23 were "from", "to", "point", "weight" and "style" values.
  assert.equal(first.params.title.split(" ").length + first.params.marks.length + 1, 10);
  assert.equal(paramWords(first.params), 10);
  // Copy still counts, in every module the run used.
  assert.equal(paramWords({ title: "Just For Sour Taste?", steps: [{ label: "Starter Jar", at: 0.49 }, { label: "Sourdough Loaf", at: 0.9 }], layout: "horizontal", numbered: false }), 8);
  assert.equal(paramWords({ character: "yeast", pose: "cheer", expression: "delighted", side: "right", card: { kicker: "Job one", title: "Yeast makes gas", body: "Bubbles lift the loaf" } }), 7);
  // With the count right, three of the saved storyboard's four findings are gone. One was real:
  // 12 words (a title, two labels and a five-word note) on a card fully shown for 2.35 s.
  const story = resolved(saved);
  const holds = ghostingGate(story).findings.filter((finding) => finding.rule === "text-hold");
  assert.deepEqual(holds.map((finding) => finding.ids[0]), ["starter-ingredients-and-microbes"]);
  assert.match(holds[0].detail, /\(12 words\) is fully shown for 2\.35 s; it needs 2\.64 s/);
});

test("at planning time, a card with more words than its time on screen allows is a repair note with the number that fits", () => {
  const story = resolved(saved);
  const [found, ...rest] = readingFindings(story);
  assert.deepEqual(rest, []);
  assert.deepEqual(found, { id: "starter-ingredients-and-microbes", module: "line-diagram", words: 12, hold: 2.35, need: 2.64, fits: 10 });
  assert.deepEqual(planReadingErrors(story), ["reading: starter-ingredients-and-microbes (line-diagram) shows 12 words but is fully on screen for 2.35 s, which is time to read 10; cut its copy to 10 words or fewer (title, body, labels and steps together), or split it into two scenes"]);
  // Cut to what fits (the note goes), it passes.
  const cut = { ...story, scenes: story.scenes.map((scene) => (scene.id === found.id ? { ...scene, params: { ...scene.params, note: undefined } } : scene)) };
  assert.deepEqual(planReadingErrors(JSON.parse(JSON.stringify(cut))), []);
});

test("reproduced: the opening was a line diagram, which draws itself from an empty plate (frame 0 carried 30% of the picture)", () => {
  assert.equal(gates.structure.checks.opening_pixels.ok, false);
  assert.match(gates.structure.checks.opening_pixels.detail, /frame 0 carries 30% of the content at 1 s/);
  const story = resolved(saved);
  assert.match(openingErrors(story)[0], /^opening: starter-jar-and-loaf \(line-diagram\) draws itself from an empty plate, so frame 0 of the video is blank; open on an image that is whole on the first frame/);
  // A character scene, or the same diagram later in the video, is fine; a story over a recording opens on the recording.
  assert.deepEqual(openingErrors(resolved(explainerStoryboard({ format: portrait, brand: saved.brand }))), []);
  assert.deepEqual(openingErrors({ ...story, scenes: story.scenes.slice(1) }), []);
  assert.deepEqual(openingErrors({ ...story, base: "assets/talk.mp4" }), []);
});

test("a character-led explainer needs a character on screen for most of it, and from the first frame", () => {
  const cast = castFromDirection({ cast: SOURDOUGH_CAST }).cast;
  const errors = characterErrors(resolved(saved), { cast });
  assert.equal(errors.length, 2);
  assert.match(errors[0], /^characters: a character is on screen for 0% of the video \(0 of [\d.]+ s\); an explainer needs one for at least 50%\. Replace diagram and card scenes with character-cameo scenes \(starter, yeast, bacteria beside a card/);
  assert.match(errors[1], /^characters: the opening scene starter-jar-and-loaf \(line-diagram\) has no character; open on a character-cameo from 0 s whose card title is the hook/);
  const led = resolved(explainerStoryboard({ format: portrait, brand: saved.brand }));
  assert.deepEqual(characterErrors(led, { cast }), []);
  // From the first real run: a 5.2 s cast-scene in 9:16 left the top third to its plate and failed the density gate.
  const long = { ...led, scenes: led.scenes.map((scene) => (scene.id === "inside" ? { ...scene, end: 11.64 } : scene)).filter((scene) => scene.id !== "jobs") };
  assert.match(characterErrors(long, { cast })[0], /^characters: inside \(cast-scene\) holds for 5\.69 s; in 9:16 the top third of the frame is only its plate, and the density gate fails that after 4 s/);
  assert.deepEqual(characterErrors({ ...long, format: { ...long.format, width: 1920, height: 1080 } }, { cast }), []);
  assert.ok(characterShare(led).share > 0.7);
});

test("the direction map casts the explainer: the subject as an object with a face, its parts as mascots", () => {
  const chosen = castFromDirection(explainerDirection(direction));
  assert.equal(chosen.cast.style, "chibi");
  assert.deepEqual(chosen.cast.characters, [
    { id: "starter", name: "Starter", kind: "cup", size: "large", colors: { body: "#f3e3c0", detail: "#c9482f" } },
    { id: "yeast", name: "Yeast", kind: "blob", colors: { body: "#f6b73c" } },
    { id: "bacteria", name: "Bacteria", kind: "monster", size: "small", colors: { body: "#58b368" } }
  ]);
  assert.deepEqual(chosen.roles.map((role) => role.plays), ["the sourdough starter in its jar", "the wild yeast", "the bacteria"]);
  // What the kit cannot draw is dropped with the reason; a fourth is one too many; a starter person keeps its id.
  const mixed = castFromDirection({ cast: { characters: [{ id: "Bread Loaf!", kind: "loaf", plays: "the loaf" }, { id: "idea", kind: "bulb", colors: { body: "not-a-colour" } }, { id: "maya", starter: "maya", plays: "the baker" }, { id: "coin", kind: "coin" }, { id: "extra", kind: "robot" }] } });
  assert.deepEqual(mixed.cast.characters, [{ id: "idea", name: "Idea", kind: "bulb" }, { id: "maya" }, { id: "coin", name: "Coin", kind: "coin" }]);
  assert.deepEqual(mixed.dropped, ['bread-loaf: kind "loaf" is not one an explainer casts', "extra: an explainer casts at most 3"]);
  assert.equal(castFromDirection({ sections: [] }), null);
  assert.deepEqual(defaultExplainerCast().characters.map((member) => member.id), ["guide", "spark"]);
});

test("the rules are in both prompts: casting in the direction map, scenes and honest evidence in the storyboard", () => {
  const map = directionPrompt({ lane: "motion", format: portrait, words: narration.words, explainer: true });
  assert.match(map, /## Characters carry the explainer \(cast them here\)/);
  assert.match(map, /A video of only diagrams, dot rows and text cards fails the checks/);
  assert.match(map, /Make the subject itself a character \(the thing being explained, as an object with a face\) and give its parts, causes or forces a mascot each/);
  assert.match(map, /a recoloured cup is a jar, a pot or a bottle; a blob or a monster is a germ, a cell or an ingredient/);
  const casting = map.slice(map.indexOf("## Characters carry the explainer"), map.indexOf("## Narration lines"));
  assert.doesNotMatch(casting, /sourdough|yeast|bacteria/i, "the brief gives the rule and another topic's example, never this topic's answer");
  assert.match(map, /kind, objects: phone \(phone: the face on its screen\); laptop/);
  assert.match(map, /It never states, shows or labels a fact, a number or a quote the script does not have/);
  assert.doesNotMatch(directionPrompt({ lane: "motion", format: portrait, words: narration.words }), /Characters carry the explainer/);
  const explainer = castFromDirection({ cast: SOURDOUGH_CAST });
  const board = planningPrompt({ lane: "motion", format: portrait, brand: saved.brand, words: narration.words, explainer });
  assert.match(board, /## Characters carry the explainer\n/);
  assert.match(board, /"starter" \(a takeaway coffee cup with a lid, large\) plays the sourdough starter in its jar; "yeast" \(a round blob with a sprout on top\) plays the wild yeast/);
  assert.match(board, /A character is on screen for at least 50% of the runtime/);
  assert.match(board, /The opening scene is a character scene from 0 s/);
  assert.match(board, /Diagrams, charts and cards support the cast/);
  assert.match(board, /A 3 s scene holds 10 words at most/);
  assert.match(board, /No card, label or speech bubble states a fact, a number or a quote the script does not have, and a character never speaks lines of its own/);
  assert.doesNotMatch(planningPrompt({ lane: "motion", format: portrait, brand: saved.brand }), /Characters carry the explainer/);
  assert.equal(explainerDirectionLines().length > 8 && explainerStoryboardLines(explainer).length > 6, true);
});

test("replayed: the planner casts from the map, pins the cast, and holds the storyboard to it", async () => {
  const seen = [];
  const boards = [
    // First the storyboard the run really produced (for this format), then a character-led one.
    { ...saved, format: portrait },
    explainerStoryboard({ format: portrait, brand: saved.brand })
  ];
  const client = { provider: "openai", async runStructured(request) {
    seen.push(request);
    if (request.schemaName === "launchclip_direction") return { value: { direction_json: JSON.stringify(explainerDirection(direction)) }, usage: {} };
    const board = boards[Math.min(boards.length - 1, seen.filter((entry) => entry.schemaName === "launchclip_storyboard").length - 1)];
    return { value: { storyboard_json: JSON.stringify(board), direction_json: "" }, usage: {} };
  } };
  const plan = await planStoryboard({ brief: PROMPT, words: narration.words, lane: "motion", format: portrait, brand: saved.brand, client, direction: true, explainer: true, maxRepairs: 2, audio: { words: "NARRATION.json" } });
  assert.equal(plan.status, "passed", JSON.stringify(plan.errors));
  assert.equal(plan.repairs_used, 1);
  // The saved storyboard is refused for the reasons its video failed, and the repair is told each one.
  const first = plan.attempts[0].errors;
  for (const prefix of ["characters: a character is on screen for 0%", "characters: the opening scene", "opening: ", "variety: all 9 scenes"]) assert.ok(first.some((error) => error.startsWith(prefix)), `${prefix}\n${first.join("\n")}`);
  const repair = seen.filter((request) => request.schemaName === "launchclip_storyboard")[1].input;
  assert.match(repair, /characters: a character is on screen for 0% of the video/);
  // The cast is the map's, pinned into the storyboard and named in the prompt.
  assert.deepEqual(plan.storyboard.cast.characters.map((member) => [member.id, member.kind]), [["starter", "cup"], ["yeast", "blob"], ["bacteria", "monster"]]);
  assert.equal(plan.storyboard.cast.style, "chibi");
  assert.deepEqual(plan.direction.cast, plan.storyboard.cast);
  assert.match(seen.find((request) => request.schemaName === "launchclip_storyboard").instructions, /"bacteria" \(a little monster: two horns, a pale belly, spots, small\) plays the bacteria/);
  assert.deepEqual(plan.explainer.roles.map((role) => role.id), ["starter", "yeast", "bacteria"]);
  assert.ok(plan.explainer.character_share >= 0.5, String(plan.explainer.character_share));
  // What it plans passes the gates that failed: no card over its reading time, a character whole on frame 0, limbs inside the frame.
  const story = resolved(plan.storyboard);
  assert.deepEqual(ghostingGate(story).findings, []);
  assert.deepEqual(openingErrors(story), []);
  assert.equal(castGate(story).status, "passed");
  assert.equal(varietyGate(story).status, "passed");
});

test("without the option the planner is unchanged: no cast is chosen and the style's applies", async () => {
  const client = { provider: "openai", async runStructured(request) {
    if (request.schemaName === "launchclip_direction") return { value: { direction_json: JSON.stringify(direction) }, usage: {} };
    return { value: { storyboard_json: JSON.stringify({ ...saved, format: portrait, scenes: saved.scenes.map((scene, index) => (index === 0 ? { ...scene, module: "process-steps", params: { title: "Why Starter?", steps: ["Jar", "Loaf"] } } : index === 4 ? { ...scene, module: "bar-chart", params: { title: "Gas over time", data: [{ label: "Hour 1", value: 1 }, { label: "Hour 4", value: 4 }] } } : scene)) }), direction_json: "" }, usage: {} };
  } };
  const plan = await planStoryboard({ brief: PROMPT, words: narration.words, lane: "motion", format: portrait, brand: saved.brand, client, direction: true, maxRepairs: 0, audio: { words: "NARRATION.json" } });
  assert.equal(plan.explainer, undefined);
  assert.ok(!plan.errors.some((error) => error.startsWith("characters: ")), plan.errors.join("\n"));
});

test("a cameo keeps a wide character inside the frame in every pose (a blob, a cup, a cheer)", () => {
  const cast = castFromDirection({ cast: SOURDOUGH_CAST }).cast;
  for (const [character, pose, side] of [["yeast", "cheer", "left"], ["yeast", "wave", "right"], ["starter", "shrug", "left"], ["starter", "cheer", "right"], ["bacteria", "point-self", "left"]]) {
    for (const format of [portrait, { width: 1920, height: 1080, fps: 30, duration: 26.2 }]) {
      const story = { schema: "launchclip.story.v1", lane: "motion", format: { ...format, duration: 4 }, brand: saved.brand, cast, scenes: [{ id: "c", module: "character-cameo", start: 0, end: 4, params: { character, pose, expression: "happy", side, card: { title: "Yeast makes gas" } } }] };
      const gate = castGate(resolveStory(story, { words: [] }));
      assert.equal(gate.status, "passed", `${character} ${pose} ${side} ${format.width}x${format.height}: ${gate.findings.map((finding) => finding.detail).join("; ")}`);
    }
  }
});

test("make plans a character-led explainer only where the video has no picture of its own", () => {
  const base = { lane: "motion", format: "explainer" };
  assert.equal(explainerContent(base), true);
  assert.equal(explainerContent({ ...base, format: "short-form" }), true);
  for (const off of [{ lane: "footage-led" }, { format: "promo" }, { format: "story" }, { media: 2 }, { provider: true }, { bible: { frozen: true } }, { animation: true }, { skeleton: { id: "last-time" } }, { longForm: true }]) assert.equal(explainerContent({ ...base, ...off }), false, JSON.stringify(off));
  assert.equal(characterLed(true, { source: "generated" }), true);
  assert.equal(characterLed(true, null), true);
  assert.equal(characterLed(true, { source: "library" }), false, "a style the user chose keeps its look and its cast");
  assert.equal(characterLed(false, { source: "generated" }), false);
});

test("the seeded style of an explainer: a lively palette when the prompt names no tone, a look when the topic suits one", () => {
  assert.equal(promptTone(PROMPT), null, "the saved run's prompt named no tone, so the seed drew from the neutral range");
  const asked = { tone: promptTone(PROMPT), constraints: promptConstraints(PROMPT) };
  const seed = explainerSeed(PROMPT, asked);
  assert.equal(seed.tone, EXPLAINER_TONE);
  assert.equal(seed.constraints.look, undefined, "sourdough has no look of its own");
  // The same seed as the saved run, playful: a more saturated palette and a livelier grammar.
  const dull = generateStyle({ seed: "12b02b25", tone: null, constraints: asked.constraints, at: "2026-11-10T00:00:00Z" });
  const lively = generateStyle({ seed: "12b02b25", tone: seed.tone, constraints: seed.constraints, at: "2026-11-10T00:00:00Z" });
  assert.equal(dull.brand.colors.bg, "#312033");
  const grammar = (pack) => pack.motion.grammar?.base ?? pack.motion.grammar;
  assert.ok(["playful", "snappy"].includes(grammar(lively)), String(grammar(lively)));
  assert.ok(lively.dials.playfulness > dull.dials.playfulness);
  // A tone the prompt names wins; a topic the looks kit pictures takes its look; a look or medium the prompt names is kept.
  assert.equal(explainerSeed("A calm explainer on sleep", { tone: "calm", constraints: {} }).tone, "calm");
  assert.equal(explainerLook("How a jet engine works"), "blueprint");
  assert.equal(explainerLook("Why your house loses heat: insulation explained"), "thermal");
  assert.equal(explainerLook(PROMPT), null);
  assert.deepEqual(explainerSeed("How a jet engine works", { tone: null, constraints: { look: "hologram" } }).constraints, { look: "hologram" });
  assert.deepEqual(explainerSeed("How a jet engine works", { tone: null, constraints: {} }).constraints, { look: "blueprint" });
});

test("from the first real run: character scenes that share a character are joined by a cut, so there is never a second copy", async () => {
  const { fitCastCuts, sceneCharacters } = await import("../src/cast_cut_fit.js");
  const cast = castFromDirection({ cast: SOURDOUGH_CAST }).cast;
  // The run's joins: the starter in two cameos joined by a zoom, the bacteria in a cameo then a cast-scene joined by a whip-pan.
  const board = explainerStoryboard({ format: portrait, brand: saved.brand });
  const joins = { belief: { type: "zoom", dur: 0.35 }, inside: { type: "zoom", dur: 0.4 }, both: { type: "whip-pan", dur: 0.35, direction: "right" }, rise: { type: "push", dur: 0.6 }, tang: { type: "zoom", dur: 0.3 } };
  const planned = { ...board, cast, scenes: board.scenes.map((scene) => (joins[scene.id] ? { ...scene, in: joins[scene.id] } : scene)) };
  const copies = ghostingGate(resolved(planned)).findings.filter((finding) => finding.rule === "two-copies");
  assert.deepEqual(copies.map((finding) => finding.ids.join("+")), ["hook+belief", "tang+both"]);
  assert.match(copies[0].detail, /two copies of starter on screen/);
  const fitted = fitCastCuts(planned);
  assert.deepEqual(fitted.changed, ["belief cuts in instead of zoom (starter is also in hook)", "both cuts in instead of whip-pan (bacteria is also in tang)"]);
  const scenes = Object.fromEntries(fitted.storyboard.scenes.map((scene) => [scene.id, scene.in]));
  assert.equal(scenes.belief, undefined, "no transition is a cut");
  assert.deepEqual(scenes.inside, joins.inside, "a join between scenes that share nobody keeps its transition");
  assert.deepEqual(scenes.rise, joins.rise);
  assert.deepEqual(scenes.tang, joins.tang, "so does one into a character scene from a diagram");
  assert.deepEqual(ghostingGate(resolved(fitted.storyboard)).findings, []);
  assert.deepEqual(sceneCharacters(planned.scenes[2]), ["yeast", "bacteria"]);
  assert.equal(fitCastCuts(fitted.storyboard).changed.length, 0);
  // Through the planner, on a seeded style, the fitted storyboard passes every check first time (the second real run
  // failed here: tooling wrote a cut the story contract refuses, on every attempt).
  const pack = generateStyle({ seed: "1c85c831", tone: "playful", constraints: {}, at: "2026-11-10T00:00:00Z" });
  const client = { provider: "openai", async runStructured(request) {
    if (request.schemaName === "launchclip_direction") return { value: { direction_json: JSON.stringify(explainerDirection(direction)) }, usage: {} };
    const { cast: _cast, ...written } = planned;
    return { value: { storyboard_json: JSON.stringify(written), direction_json: "" }, usage: {} };
  } };
  const plan = await planStoryboard({ brief: PROMPT, words: narration.words, lane: "motion", format: portrait, style: pack, client, direction: true, explainer: true, maxRepairs: 0, audio: { words: "NARRATION.json" } });
  assert.equal(plan.status, "passed", JSON.stringify(plan.errors));
  assert.ok(plan.warnings.some((warning) => warning === "cast: tooling made belief cuts in instead of zoom (starter is also in hook)"), plan.warnings.join("\n"));
  assert.equal(plan.storyboard.cast.style, "chibi");
  const styled = resolveStory(applyStyle(JSON.parse(JSON.stringify(plan.storyboard)), pack).story, { words: narration.words });
  assert.deepEqual(ghostingGate(styled).findings, []);
  // A card on screen for less than the shortest read is told to grow or go, never to "cut to 0 words".
  const blink = { ...resolved(planned), scenes: resolved(planned).scenes.map((scene) => (scene.id === "rise" ? { ...scene, module: "concept-card", params: { text: "Gas", sub: "Lifts the whole loaf" }, end: scene.start + 1.7 } : scene.id === "tang" ? { ...scene, start: 14.15 + 1.7 } : scene)) };
  assert.match(planReadingErrors(blink).find((error) => error.includes("rise")), /a card needs at least 1\.2 s to be read; lengthen the scene, or drop it and give its 5 words to the scene before or after it/);
});
