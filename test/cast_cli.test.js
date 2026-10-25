// `launchclip cast`, the cast consistency gate and dialogue voices
// (src/cast.js, src/voice/dialogue.js).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { castGate, castList, castShow, castSheetHtml, castUsage, runCastCommand } from "../src/cast.js";
import { DIALOGUE_GAP, dialogueGaps, dialogueLayout, dialogueRequests, dialogueText, synthesizeDialogue } from "../src/voice/dialogue.js";
import { createTestVoiceProvider } from "../src/voice/index.js";
import { resolveStory, validateStory } from "../kit/core/story.mjs";
import { resolveModule } from "../kit/core/modules.mjs";
import { USAGE } from "../src/cli_usage.js";
import { checkStoryDirection } from "../src/story_cli.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const execFileAsync = promisify(execFile);
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

test("dialogue: each line goes to its speaker's voice", () => {
  const story = example();
  const requests = dialogueRequests(story);
  assert.deepEqual(requests.map((entry) => [entry.speaker, entry.request.voice]), [["narrator", "bf_emma"], ["narrator", "bf_emma"], ["maya", "af_heart"], ["theo", "am_michael"], ["narrator", "bf_emma"], ["maya", "af_heart"]]);
  assert.match(dialogueText(story), /^Every launch, Maya[\s\S]*with the launch!$/);
  assert.throws(() => dialogueRequests({ ...story, audio: { narration: { lines: [{ speaker: "zed", text: "Hi." }] } } }), /not in the story cast/);
  assert.equal(dialogueRequests(story, { provider: "test" })[2].request.voice, "bf_emma", "only Kokoro takes a character's Kokoro voice; others keep the narration voice");
});

test("dialogue gaps: audio.narration.gap, a line's own gap, and takes trimmed to their words", () => {
  const story = example();
  assert.equal(DIALOGUE_GAP, 0.3);
  assert.deepEqual(dialogueGaps(story), [0.3, 0.3, 0.3, 0.3, 0.3]);
  const lines = story.audio.narration.lines.map((line, i) => i === 1 ? { ...line, gap: 0.8 } : line);
  assert.deepEqual(dialogueGaps({ ...story, audio: { narration: { ...story.audio.narration, gap: 0.2, lines } } }), [0.2, 0.8, 0.2, 0.2, 0.2]);
  // Two takes with the engine's lead and trail silence (0.2 s and 0.25 s).
  const take = (text, duration) => ({ take: { words: [{ text, start: 0.2, end: duration - 0.25 }], duration, cached: true }, speaker: "maya", request: { voice: "af_heart", text } });
  const layout = dialogueLayout([take("One.", 1), take("Two.", 1.5)], [0.3]);
  assert.deepEqual(layout.cuts, [{ start: 0.14, end: 0.81, pad: 0.18 }, { start: 0.14, end: 1.31, pad: 0 }]);
  assert.deepEqual(layout.words.map((word) => [word.start, word.end]), [[0.06, 0.61], [0.91, 1.96]]);
  assert.equal(layout.duration, 2.02);
  // Sound past the last word's timed end (a final consonant) is kept.
  const late = take("Rewind.", 1);
  late.take.sound = { start: 0.2, end: 1 };
  assert.deepEqual(dialogueLayout([late, take("Two.", 1.5)], [0.3]).cuts[0], { start: 0.14, end: 1, pad: 0.24 });
  // A gap shorter than the kept edges shrinks them; zero abuts the words.
  const tight = dialogueLayout([take("One.", 1), take("Two.", 1.5)], [0]);
  assert.equal(tight.words[1].start, tight.words[0].end);
  assert.ok(tight.cuts.every((cut) => cut.pad >= 0));
});

test("story validation checks the dialogue gap", () => {
  const base = { schema: "launchclip.story.v1", lane: "voiceover-motion", format: { width: 1920, height: 1080, fps: 30, duration: 4 }, brand: example().brand, scenes: [{ id: "s1", module: "cast-scene", start: 0, end: 4, params: { set: "phone", cast: [{ id: "maya" }] } }] };
  assert.deepEqual(validateStory({ ...base, audio: { narration: { gap: 0.25, lines: [{ speaker: "maya", text: "Hi.", gap: 1 }, { speaker: "maya", text: "Bye." }] } } }).errors, []);
  const bad = validateStory({ ...base, audio: { narration: { gap: -1, lines: [{ speaker: "maya", text: "Hi.", gap: "long" }] } } });
  assert.match(bad.errors.join("\n"), /lines\[0\]\.gap must be[\s\S]*audio\.narration\.gap must be/);
});

// Joining the lines into one take runs ffmpeg, which the CI test jobs lack.
test("dialogue: the lines join into one take with each word's speaker", async (t) => {
  try { await execFileAsync("ffmpeg", ["-version"]); } catch { t.skip("ffmpeg is unavailable"); return; }
  const story = example();
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-dialogue-"));
  try {
    const provider = createTestVoiceProvider();
    const take = await synthesizeDialogue(dialogueRequests(story, { provider: "test" }).slice(2, 4), { outFile: path.join(dir, "voice.wav"), voiceProvider: () => provider });
    assert.ok(existsSync(path.join(dir, "voice.wav")));
    assert.deepEqual(take.lines.map((line) => line.speaker), ["maya", "theo"]);
    const mayaLast = take.words.filter((word) => word.speaker === "maya").at(-1);
    const theoFirst = take.words.find((word) => word.speaker === "theo");
    assert.ok(Math.abs(theoFirst.start - mayaLast.end - 0.3) < 0.002, "a 0.3 s pause from one line's last word to the next line's first");
    assert.ok(take.lines[1].start >= take.lines[0].end);
    const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(dir, "voice.wav")]);
    assert.ok(Math.abs(Number(stdout) - take.duration) < 0.02, "the joined file is as long as the timeline says");
    const tight = await synthesizeDialogue(dialogueRequests(story, { provider: "test" }).slice(2, 4), { outFile: path.join(dir, "tight.wav"), voiceProvider: () => provider, gap: [0] });
    assert.ok(tight.duration < take.duration - 0.25);
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

test("the cast gate fails a limb off the canvas or out of the safe zone, and a couple swapping sides", async () => {
  const { castPlacement } = await import("../kit/core/characters/placement.mjs");
  const brand = example().brand;
  const short = (scenes) => ({ schema: "launchclip.story.v1", lane: "motion", format: { width: 1080, height: 1920, fps: 30, duration: 8 }, brand, cast: { characters: [{ id: "maya" }, { id: "theo" }] }, scenes });
  const phone = (id, start, cast) => ({ id, module: "cast-scene", start, end: start + 4, params: { set: "phone", cast } });
  // Facing outward, a point on the right-hand character runs off a 9:16 canvas.
  const outward = short([phone("a", 0, [{ id: "theo" }, { id: "maya", facing: "right", cues: [{ at: 1, pose: "point" }] }])]);
  const off = castGate(resolveStory(outward, { words: [] }));
  assert.equal(off.status, "failed");
  assert.match(off.findings.map((f) => f.detail).join("\n"), /maya in a reaches off the canvas \(x \d+; canvas 1080x1920\) in stand, point facing right/);
  // Inward (the default) it stays on the canvas.
  const inward = short([phone("a", 0, [{ id: "theo" }, { id: "maya", cues: [{ at: 1, pose: "point" }] }])]);
  assert.deepEqual(castGate(resolveStory(inward, { words: [] })).findings, []);
  // A phone held in the outer hand, arms spread: on the canvas, under the Shorts UI rail.
  const shrug = short([phone("a", 0, [{ id: "theo" }, { id: "maya", holds: "phone", pose: "shrug" }])]);
  assert.match(castGate(resolveStory(shrug, { words: [] })).findings.map((f) => f.detail).join(), /maya in a reaches out of the safe zone right to x \d+ \(safe to 940\) in shrug facing left holding a phone/);
  // Reordering the cast list swaps the couple between shots.
  const swap = short([phone("a", 0, [{ id: "maya" }, { id: "theo" }]), phone("b", 4, [{ id: "theo", holds: "phone" }, { id: "maya" }])]);
  assert.match(castGate(resolveStory(swap, { words: [] })).findings.map((f) => f.detail).join(), /theo and maya swap sides between a and b|maya and theo swap sides between a and b/);
  // With positions the order no longer matters; explicit positions in both scenes allow a deliberate swap.
  const kept = short([phone("a", 0, [{ id: "maya" }, { id: "theo" }]), phone("b", 4, [{ id: "theo", holds: "phone", position: "right" }, { id: "maya", position: "left" }])]);
  assert.deepEqual(castGate(resolveStory(kept, { words: [] })).findings, []);
  const meant = short([phone("a", 0, [{ id: "maya", position: "left" }, { id: "theo", position: "right" }]), phone("b", 4, [{ id: "maya", position: "right" }, { id: "theo", position: "left" }])]);
  assert.deepEqual(castPlacement(resolveStory(meant, { words: [] }), [meant.scenes[0], meant.scenes[1]].map((scene) => resolveModule(scene, meant))), []);
});

test("cast show and sheet draw a styled story in its style pack's colours, as finish does", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-cast-style-"));
  try {
    const story = example();
    delete story.brand;
    story.style = "bold-creator";
    await writeFile(path.join(dir, "storyboard.json"), JSON.stringify(story));
    const { applyProjectStyle } = await import("../src/story_style.js");
    const styled = (await applyProjectStyle(story, { projectDir: dir })).story;
    const theo = await castShow("theo", { story: dir });
    assert.equal(theo.colors.top, styled.brand.colors.accent, "theo's top is the accent role, here the pack's accent");
    assert.notEqual(theo.colors.top, (await castShow("theo", { story: EXAMPLE })).colors.top);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
