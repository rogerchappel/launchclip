// A visual explainer (src/make/visual_explainer.js): one call directs, every
// scene is drawn at once, and each scene is a custom-module fragment.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { customModuleProblems } from "../kit/hyperframes/custom-module.mjs";
import { makeOptionsFromFlags, validateMakeOptions } from "../src/make/options.js";
import { VISUAL_DIR, codeProblem, explainerMode, planVisualExplainer, tileScenes, visualArea, visualExplainer, visualHelpers, visualPalette } from "../src/make/visual_explainer.js";
import { validateDirection } from "@launchclip/core/direction.mjs";
import { checkStoryboard } from "../src/storyboard_planner.js";

const FORMAT = { width: 1080, height: 1920, duration: 12 };
const WORDS = "Three boards build a deck and the third one ends the upkeep argument for good".split(" ").map((text, index) => ({ text, start: index * 0.8, end: index * 0.8 + 0.6 }));
const scene = (id, start, end, more = {}) => ({ id, heading: `${id} heading`, start, end, brief: `what ${id} shows`, beats: [{ at: start + 0.5, what: "a board drops in" }], hits: [{ at: start + 0.5, cue: "impact" }], ...more });
const PLAN = { look: "Headings at the top in the display face.", scenes: [scene("yard", 0, 4), scene("boards", 4, 8), scene("verdict", 8, 12)], props: "// (parent, x, y, w): a board seen from above\nconst propBoard = (parent, x, y, w) => S('rect', { x, y, width: w, height: 60, fill: PRIMARY, stroke: INK }, G(parent));" };
const GOOD = "const board = propBoard(svg, 200, 600, 500);\npop(board, scene.start + 0.5);";

/** A client answering from a table; `scenes` maps a scene id to its answers in turn (a string is code, an Error is thrown). */
function fakeClient({ director = [PLAN], scenes = {}, wait = 0 } = {}) {
  const calls = [];
  let open = 0, peak = 0;
  return {
    calls,
    get peak() { return peak; },
    provider: "openai",
    async runStructured(request) {
      calls.push(request);
      const usage = { input_tokens: 100, output_tokens: 50 };
      if (request.schemaName === "launchclip_visual_director") return { model: "test-model", usage, value: director[Math.min(director.length - 1, calls.filter((call) => call.schemaName === request.schemaName).length - 1)] };
      const id = request.input.match(/YOUR SCENE: (\S+) /)[1];
      const nth = calls.filter((call) => call.schemaName === request.schemaName && call.input.includes(`YOUR SCENE: ${id} `)).length - 1;
      open += 1; peak = Math.max(peak, open);
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      open -= 1;
      const answers = scenes[id] ?? [GOOD];
      const answer = answers[Math.min(answers.length - 1, nth)];
      if (answer instanceof Error) throw answer;
      return { model: "test-model", usage, value: { code: answer } };
    }
  };
}

const plan = (client, more = {}) => planVisualExplainer({ client, model: "test-model", provider: "openai", brief: "3 common deck materials", words: WORDS, narration: WORDS.map((word) => word.text).join(" "), format: FORMAT, brand: { colors: { bg: "#f4ead9", primary: "#c8552b", accent: "#2f6f5e", paper: "#1d1a16", ink: "#f4ead9" }, fonts: { display: "young-serif", body: "dm-sans", meta: "jetbrains-mono" } }, title: "Deck boards", ...more });

test("a visual explainer is the default where a video has nothing to show, on the HyperFrames renderer", () => {
  assert.equal(visualExplainer(true), true);
  assert.equal(visualExplainer(false), false, "the video has something to show, or is not an explainer");
  assert.equal(visualExplainer(true, { renderer: "hyperframes" }), true);
  assert.equal(visualExplainer(true, { renderer: "remotion" }), false, "its scenes have no Remotion form: an asked-for Remotion render keeps the cast");
  assert.equal(visualExplainer(true, { mode: "characters" }), false);
  assert.equal(visualExplainer(true, { draft: true }), false, "a fast draft's plan is rule-made");
  assert.equal(explainerMode(undefined), "visual");
  assert.equal(explainerMode("Characters"), "characters");
  assert.throws(() => explainerMode("puppets"), /--explainer must be visual or characters/);
  assert.equal(makeOptionsFromFlags({ explainer: "characters" }).explainer, "characters");
  assert.throws(() => validateMakeOptions({ explainer: "puppets" }), /--explainer/);
});

test("text sits in the platform's safe zone above the captions; pictures may fill more", () => {
  const { text, picture, caption } = visualArea(FORMAT);
  assert.deepEqual(text, { x: 80, y: 280, width: 860, height: 900 });
  assert.equal(caption, 1190);
  assert.ok(text.y + text.height < caption && picture.y + picture.height < caption, "nothing is drawn in the caption band");
  assert.ok(picture.x < text.x && picture.y < text.y && picture.width > text.width);
  const wide = visualArea({ width: 1920, height: 1080, duration: 12 });
  assert.ok(wide.text.x >= 0 && wide.text.x + wide.text.width <= 1920 && wide.text.y + wide.text.height < wide.caption);
});

test("the line colour is the one that reads on the brand's background", () => {
  assert.equal(visualPalette({ colors: { bg: "#f4ead9" } }).INK, "#1d1a16");
  assert.equal(visualPalette({ colors: { bg: "#101418" } }).INK, "#f7f2e8");
  assert.deepEqual([visualPalette({ colors: { primary: "#112233", accent: "#445566" } }).PRIMARY, visualPalette({ colors: { primary: "#112233", accent: "#445566" } }).ACCENT], ["#112233", "#445566"]);
});

test("scene code is parsed and held to the custom-module rules, never run", () => {
  const helpers = visualHelpers(visualPalette(null));
  assert.equal(codeProblem(GOOD, { helpers, props: PLAN.props }), null);
  assert.match(codeProblem("const a = ;", { helpers }), /does not parse/);
  assert.match(codeProblem("setTimeout(() => {}, 100);", { helpers }), /timer/);
  assert.match(codeProblem("const x = Math.random();", { helpers }), /Math\.random/);
  assert.match(codeProblem("  ", { helpers }), /no code/);
  // A scene may reuse a helper's name for its own value: its code runs in its own block.
  assert.equal(codeProblem("const draw = 3;", { helpers }), null);
  assert.equal(codeProblem("globalThis.__ran = true;", { helpers }), null);
  assert.equal(globalThis.__ran, undefined);
});

test("the director's scenes are made to tile the video", () => {
  const { scenes, notes } = tileScenes([scene("B Side", 4.2, 9), scene("a", 0.3, 4), scene("blink", 4.9, 5.5), scene("end", 11.5, 12), scene("a", 8, 11)], 12);
  assert.deepEqual(scenes.map((entry) => [entry.id, entry.start, entry.end]), [["a", 0, 4.2], ["b-side", 4.2, 8], ["a-3", 8, 12]]);
  assert.equal(notes.length, 2, "the scene too short to read and the one at the very end joined the scene before them");
  assert.match(scenes[1].brief, /what B Side shows Then: what blink shows/);
  // Beats and hits outside their scene's time are dropped; an unknown cue becomes a pop.
  const odd = tileScenes([scene("one", 0, 6, { beats: [{ at: 1, what: "in" }, { at: 9, what: "late" }], hits: [{ at: 2, cue: "kaboom" }, { at: 7, cue: "pop" }] }), scene("two", 6, 12)], 12).scenes[0];
  assert.deepEqual([odd.beats.map((beat) => beat.at), odd.hits], [[1], [{ at: 2, cue: "pop" }]]);
  assert.deepEqual(tileScenes(null, 12).scenes, []);
});

test("one direction call, then every scene drawn at once, each as its own fragment", async () => {
  const client = fakeClient({ wait: 30 });
  const result = await plan(client);
  assert.equal(result.status, "passed");
  assert.deepEqual(client.calls.map((call) => call.schemaName), ["launchclip_visual_director", "launchclip_visual_scene", "launchclip_visual_scene", "launchclip_visual_scene"]);
  assert.equal(client.peak, 3, "the scene calls were in flight together");
  // The director sees every word with its time; an illustrator sees the look, the props and its own scene's words.
  assert.match(client.calls[0].input, /Three@0 boards@0\.8/);
  const second = client.calls.find((call) => call.input.includes("YOUR SCENE: boards "));
  assert.match(second.input, /Headings at the top/);
  assert.match(second.input, /propBoard/);
  assert.match(second.input, /and@4 the@4\.8 third@5\.6/);
  assert.doesNotMatch(second.input, /opening scene/);
  assert.match(client.calls.find((call) => call.input.includes("YOUR SCENE: yard ")).input, /opening scene: its main picture is drawn with no entrance/);
  // The storyboard: a custom scene each, tiling the video, cut together with the kit's transitions, the director's hits as sound cues.
  const story = result.storyboard;
  assert.deepEqual(story.scenes.map((entry) => [entry.id, entry.module, entry.start, entry.end, entry.source.hyperframes]), [["yard", "custom", 0, 4, `${VISUAL_DIR}/yard.html`], ["boards", "custom", 4, 8, `${VISUAL_DIR}/boards.html`], ["verdict", "custom", 8, 12, `${VISUAL_DIR}/verdict.html`]]);
  assert.deepEqual([story.scenes[0].in, story.scenes[1].in.type, story.scenes[2].in.type], [undefined, "whip", "push"]);
  assert.deepEqual(story.scenes[1].hits, [{ at: 4.5, event: "boards-1", cue: "impact" }]);
  assert.deepEqual(story.scenes[0].params.rect, visualArea(FORMAT).text);
  assert.deepEqual(story.overlays, [{ type: "captions", position: "auto" }]);
  assert.equal(story.title, "Deck boards");
  // The direction map is the director's plan in the map's form: a section per scene, its line the words spoken under it.
  assert.deepEqual(result.direction.sections.map((section) => [section.lines[0].words, section.lines[0].scenes, section.lines[0].intent]), [[[0, 4], ["yard"], "hook"], [[5, 9], ["boards"], "list"], [[10, 14], ["verdict"], "claim"]]);
  assert.equal(result.direction.sections[1].lines[0].why, "what boards shows");
  assert.deepEqual(validateDirection(result.direction, { words: WORDS, story }).errors, []);
  const checked = checkStoryboard(story, { words: WORDS, tier: "bespoke", direction: result.direction, bandErrors: false });
  assert.deepEqual(checked.errors ?? [], []);
  // The fragments keep the custom-module rules, and each holds the helpers, the props and its scene's code.
  const dir = await mkdtemp(path.join(os.tmpdir(), "lc-visual-"));
  try {
    await mkdir(path.join(dir, VISUAL_DIR), { recursive: true });
    for (const fragment of result.fragments) await writeFile(path.join(dir, fragment.file), fragment.html);
    assert.deepEqual(await customModuleProblems(story, { sourceDir: dir }), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
  const html = result.fragments[1].html;
  assert.match(html, /const propBoard = /);
  assert.match(html, /pop\(board, scene\.start \+ 0\.5\)/);
  assert.match(html, /viewBox="0 0 1080 1920"/);
  assert.match(html, /scale: 1\.04/, "the camera pushes in for the whole scene");
  // What it cost, a call at a time.
  assert.deepEqual(result.attempts.map((attempt) => [attempt.kind, attempt.ok]), [["director", true], ["scene", true], ["scene", true], ["scene", true]]);
  assert.ok(result.attempts.every((attempt) => attempt.usage.input_tokens === 100));
  assert.equal(result.drawn, 3);
});

test("a scene whose code cannot be used is drawn once more with the reason, then becomes a heading card", async () => {
  const client = fakeClient({ scenes: { boards: ["const a = ;", GOOD], verdict: ["setTimeout(() => {}, 5);", new Error("the provider hung up")] } });
  const result = await plan(client);
  assert.equal(result.status, "passed");
  const retry = client.calls.filter((call) => call.input.includes("YOUR SCENE: boards "))[1];
  assert.match(retry.input, /Your last code could not be used: it does not parse/);
  assert.equal(result.drawn, 2);
  assert.deepEqual(result.attempts.filter((attempt) => attempt.kind === "scene" && !attempt.ok).map((attempt) => attempt.id), ["boards-1", "verdict-1", "verdict-2"]);
  assert.match(result.warnings.join("\n"), /scene verdict could not be drawn \(the call failed \(the provider hung up\)\); it shows its heading as a card/);
  const card = result.fragments[2].html;
  assert.match(card, /"verdict heading"/);
  assert.doesNotMatch(card, /setTimeout/);
  // A drawn scene falls back to the same card if its code throws in the browser.
  assert.match(result.fragments[1].html, /catch \(error\)[\s\S]*"boards heading"/);
});

test("a plan that cannot be used is asked for again; a video that is mostly cards fails", async () => {
  const fixed = await plan(fakeClient({ director: [{ ...PLAN, props: "const propBoard = ;" }, PLAN] }));
  assert.equal(fixed.status, "passed");
  assert.deepEqual(fixed.attempts.slice(0, 2).map((attempt) => [attempt.kind, attempt.ok]), [["director", false], ["director", true]]);
  const none = await plan(fakeClient({ director: [{ look: "", scenes: [], props: "" }] }));
  assert.equal(none.status, "failed");
  assert.match(none.errors[0], /it had no scenes/);
  const cards = await plan(fakeClient({ scenes: { yard: ["const a = ;"], boards: ["const a = ;"] } }));
  assert.equal(cards.status, "failed");
  assert.match(cards.errors[0], /2 of 3 scenes could not be drawn/);
  // The cost limit is the run's to stop on, never a scene's to swallow.
  const limit = Object.assign(new Error("over the limit"), { code: "LAUNCHCLIP_COST_LIMIT" });
  await assert.rejects(plan(fakeClient({ scenes: { yard: [limit] } })), /over the limit/);
});
