// `launchclip cast`, the cast consistency gate and dialogue voices
// (src/cast.js, src/voice/dialogue.js).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { castGate, castList, castShow, castSheetHtml, castUsage, runCastCommand } from "../src/cast.js";
import { dialogueRequests, dialogueText, synthesizeDialogue } from "../src/voice/dialogue.js";
import { createTestVoiceProvider } from "../src/voice/index.js";
import { resolveStory, validateStory } from "../kit/core/story.mjs";
import { USAGE } from "../src/cli_usage.js";
import { checkStoryDirection } from "../src/story_cli.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const EXAMPLE = path.join(ROOT, "examples/story/characters-16x9");
const example = () => JSON.parse(readFileSync(path.join(EXAMPLE, "storyboard.json"), "utf8"));
const exampleWords = () => JSON.parse(readFileSync(path.join(EXAMPLE, "NARRATION.json"), "utf8")).words;

test("cast list and show: the starter cast, a story cast, one character's params and voice", async () => {
  const list = await castList();
  assert.equal(list.starter.length, 24);
  assert.equal(list.story.length, 0);
  const withStory = await castList(EXAMPLE);
  assert.deepEqual(withStory.story.map((row) => row.id), ["maya", "theo"]);
  const theo = await castShow("theo", { story: EXAMPLE });
  assert.equal(theo.voice, "am_michael");
  assert.equal(theo.colors.top, "#ffb547", "the example brand's accent");
  await assert.rejects(castShow("kwame", { story: EXAMPLE }), /not in the story cast/);
  await assert.rejects(runCastCommand("dance"), /Unknown cast action/);
  for (const action of ["list", "show", "sheet"]) assert.ok(USAGE.some(([name]) => name === `cast ${action}`), action);
});

test("cast usage gathers every pose and expression a story's scenes and map cues use", () => {
  const usage = castUsage(example(), { sections: [{ lines: [{ cast: [{ id: "theo", pose: "think", expression: "confused" }] }] }] });
  assert.deepEqual([...usage.keys()], ["maya", "theo"]);
  assert.deepEqual(usage.get("maya").poses, ["type", "slump", "shrug", "stand", "think", "point", "cheer", "wave"]);
  assert.ok(usage.get("theo").poses.includes("think"), "the direction map's cues count");
  assert.ok(usage.get("theo").expressions.includes("confused"));
  const { html, rows } = castSheetHtml(example(), usage);
  assert.equal(rows.length, 2);
  for (const pose of usage.get("maya").poses) assert.match(html, new RegExp(`<figcaption>${pose}</figcaption>`));
  assert.doesNotMatch(html, /"tag":"joint"/);
});

test("the cast gate passes the example and names drift, bad cues and bad voices", () => {
  const story = example();
  const resolved = resolveStory(story, { words: exampleWords() });
  assert.deepEqual(castGate(resolved), { status: "passed", findings: [], characters: ["maya", "theo"] });
  assert.equal(castGate({ scenes: [] }).status, "skipped");
  const badMap = { sections: [{ lines: [{ words: [0, 3], set: "garage", cast: [{ id: "maya", pose: "moonwalk" }] }] }] };
  const failing = castGate(resolved, { direction: badMap });
  assert.equal(failing.status, "failed");
  assert.match(failing.findings.map((f) => f.detail).join("\n"), /set "garage"[\s\S]*pose "moonwalk"/);
  const badVoice = castGate({ ...resolved, cast: { characters: [{ id: "maya", voice: "af_nobody" }, { id: "theo" }] } });
  assert.match(badVoice.findings.map((f) => f.detail).join(), /not a local Kokoro voice/);
  const stranger = castGate({ ...resolved, cast: { characters: [{ id: "maya" }] } });
  assert.match(stranger.findings.map((f) => f.detail).join(), /"theo" is not in the story cast/);
});

test("the example story validates, resolves its dialogue mouths and passes the gate", () => {
  const story = example();
  assert.deepEqual(validateStory(story).errors, []);
  const resolved = resolveStory(story, { words: exampleWords() });
  const phone = resolved.scenes.find((scene) => scene.id === "phone-turn");
  const theo = phone.params.cast.find((actor) => actor.id === "theo");
  assert.ok(Array.isArray(theo.says) && theo.says.length >= 2, "says auto becomes Theo's own words");
  const maya = phone.params.cast.find((actor) => actor.id === "maya");
  const mayaWords = exampleWords().filter((word) => word.speaker === "maya" && word.start >= phone.start && word.start < phone.end);
  assert.equal(maya.says.length, mayaWords.length);
  assert.equal(story.cast.characters.length, 2);
});

test("dialogue: each line in its speaker's voice, joined with speakers on every word", async () => {
  const story = example();
  const requests = dialogueRequests(story);
  assert.deepEqual(requests.map((entry) => [entry.speaker, entry.request.voice]), [["narrator", "bf_emma"], ["narrator", "bf_emma"], ["maya", "af_heart"], ["theo", "am_michael"], ["narrator", "bf_emma"], ["maya", "af_heart"]]);
  assert.match(dialogueText(story), /^Every launch, Maya[\s\S]*with the launch!$/);
  assert.throws(() => dialogueRequests({ ...story, audio: { narration: { lines: [{ speaker: "zed", text: "Hi." }] } } }), /not in the story cast/);
  assert.equal(dialogueRequests(story, { provider: "test" })[2].request.voice, "bf_emma", "only Kokoro takes a character's Kokoro voice; others keep the narration voice");
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-dialogue-"));
  try {
    const provider = createTestVoiceProvider();
    const take = await synthesizeDialogue(dialogueRequests(story, { provider: "test" }).slice(2, 4), { outFile: path.join(dir, "voice.wav"), voiceProvider: () => provider });
    assert.ok(existsSync(path.join(dir, "voice.wav")));
    assert.deepEqual(take.lines.map((line) => line.speaker), ["maya", "theo"]);
    assert.ok(take.lines[1].start >= take.lines[0].end + 0.29, "a pause between lines");
    assert.equal(take.words[0].speaker, "maya");
    assert.equal(take.words.at(-1).speaker, "theo");
    assert.ok(take.words.every((word, i) => i === 0 || word.start >= take.words[i - 1].start));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("story validation accepts dialogue lines and rejects bad ones", () => {
  const base = { schema: "launchclip.story.v1", lane: "voiceover-motion", format: { width: 1920, height: 1080, fps: 30, duration: 4 }, brand: example().brand, scenes: [{ id: "s1", module: "cast-scene", start: 0, end: 4, params: { set: "phone", cast: [{ id: "maya" }] } }] };
  const ok = validateStory({ ...base, audio: { narration: { lines: [{ speaker: "maya", text: "Hi." }] } } });
  assert.deepEqual(ok.errors, []);
  const bad = validateStory({ ...base, audio: { narration: { lines: [{ speaker: "Maya!", text: "" }] } } });
  assert.match(bad.errors.join(), /lines\[0\] must be \{speaker, text\}/);
});

test("cast sheet renders a PNG with Chromium", { timeout: 120_000 }, async (t) => {
  const { findChromium, loadPlaywright } = await import("../src/demo/record.js");
  if (!(await loadPlaywright()) || !(await findChromium())) { t.skip("no Chromium for Playwright"); return; }
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-cast-sheet-"));
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "storyboard.json"), JSON.stringify(example()));
    const result = await runCastCommand("sheet", dir, {});
    assert.ok(existsSync(result.png));
    const report = JSON.parse(readFileSync(result.json, "utf8"));
    assert.equal(report.schema, "launchclip.cast-sheet.v1");
    assert.deepEqual(report.characters.map((row) => row.id), ["maya", "theo"]);
    assert.ok(readFileSync(result.png).length > 20_000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("story validate checks a narrative map's cast cues with the character kit", async () => {
  const story = example();
  const words = exampleWords();
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-direction-"));
  try {
    const map = JSON.parse(readFileSync(path.join(EXAMPLE, "DIRECTION.json"), "utf8"));
    const ok = await checkStoryDirection({ story, resolved: resolveStory(story, { words }), words, storyDir: EXAMPLE });
    assert.deepEqual(ok.errors, []);
    map.sections[1].lines[0].cast[0].pose = "moonwalk";
    map.sections[1].lines[0].set = "garage";
    await writeFile(path.join(dir, "DIRECTION.json"), JSON.stringify(map));
    const bad = await checkStoryDirection({ story, resolved: resolveStory(story, { words }), words, storyDir: dir });
    assert.match(bad.errors.join("\n"), /pose "moonwalk"/);
    assert.match(bad.errors.join("\n"), /set "garage"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
