import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { storyboardMeasures } from "@launchclip/core/cadence.mjs";
import { chooseCutWindow, cutTrim, cutWords, cutdownStory, keyWords, mapTime } from "@launchclip/core/cutdown.mjs";
import { validateDirection } from "@launchclip/core/direction.mjs";
import { structureLongForm } from "@launchclip/core/long-form.mjs";
import { resolveStory, storyBase } from "@launchclip/core/story.mjs";
import { runCli } from "../src/cli.js";
import { runCutdown } from "../src/cutdown.js";
import { profileForStory, resolveProfile } from "../src/profile_store.js";
import { coverageGate } from "../src/quality_gates.js";
import { checkStoryboard } from "../src/storyboard_planner.js";
import { readStoryTrack } from "../src/subject/project.js";
import { longFormFixture } from "./helpers/long_form.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const SHORTS = resolveProfile("short-talking-head").profile;
const TOOL = { id: "tool-of-the-week", title: "Tool of the week", layout: "split-right" };

// The fixture with a base edit that cuts 10 s out at 250 s, structured, a
// segment chapter (split-right) and anchored scenes.
function longForm() {
  const { story, map, words } = longFormFixture();
  story.base.trim = [[0, 250], [260, 620]];
  const anchored = story.scenes.find((scene) => scene.id === "card-24");
  const word = words.find((entry) => Math.abs(entry.start - anchored.start) < 1e-6);
  anchored.start = `word:${word.text.replace(/\.$/, "")}#${words.filter((entry) => entry.text.replace(/\.$/, "") === word.text.replace(/\.$/, "") && entry.start <= word.start).length}`;
  const structured = structureLongForm(story, { words, map, segments: [TOOL] });
  return { ...structured, words, resolved: resolveStory(structured.story, { words }) };
}

test("cutdown: the window is the strongest 15–58 s run of lines in the section", () => {
  const { map, words } = longForm();
  const window = chooseCutWindow(map, words, { section: "c2" });
  assert.equal(window.section, "c2");
  assert.equal(window.title, "Tool of the week");
  assert.ok(window.end - window.start <= 58 && window.end - window.start >= 15);
  assert.equal(window.start, map.sections[1].lines[0] && words[map.sections[1].lines[0].words[0]].start, "it opens on the section's claim line");
  assert.deepEqual(window.words, [window.lines[0].words[0], window.lines.at(-1).words[1]]);
  const anywhere = chooseCutWindow(map, words);
  assert.ok(map.sections.some((section) => section.id === anywhere.section));
  assert.throws(() => chooseCutWindow(map, words, { section: "nope" }), /no direction-map section "nope"; the map has c1, c2/);
  assert.throws(() => chooseCutWindow(map, words, { section: "c2", max: 3, min: 2 }), /no run of lines between 2 and 3 s in section "c2"/);
});

test("cutdown: the base edit, the words and the anchors map into the section's time range", () => {
  const { resolved, words } = longForm();
  // 240–270 s on the long form's clock crosses the cut at 250 s (source 250–260 is gone).
  assert.deepEqual(cutTrim(resolved, 240, 270), [[240, 250], [260, 280]]);
  assert.deepEqual(cutTrim(resolved, 100, 150), [[100, 150]]);
  const local = cutWords(words, 100, 110);
  assert.equal(local[0].start, round(words.find((word) => word.start >= 100).start - 100));
  assert.ok(local.every((word) => word.start >= 0 && word.end <= 10));
  assert.equal(mapTime("word:pipeline", 101.5, 100, [{ text: "pipeline", start: 1.5, end: 1.8 }]), "word:pipeline");
  assert.equal(mapTime("word:pipeline#7", 101.5, 100, [{ text: "pipeline", start: 0.4, end: 0.7 }, { text: "pipeline", start: 1.5, end: 1.8 }]), "word:pipeline#2", "re-counted in the Short's narration");
  assert.equal(mapTime("word:pipeline+0.2", 101.7, 100, [{ text: "pipeline", start: 1.5, end: 1.8 }]), "word:pipeline+0.2");
  assert.equal(mapTime("word:pipeline", 101.5, 100, [{ text: "other", start: 1.5, end: 1.8 }]), 1.5, "no anchor reaches it: seconds");
  assert.equal(mapTime(42.25, 42.25, 40, []), 2.25);
  assert.equal(keyWords("so we built a pipeline which reads the recording"), "Built pipeline reads");
  assert.ok(keyWords("a b c").length <= 28);
});

test("cutdown: a Short re-planned for 9:16 that passes the Shorts profile", () => {
  const { resolved, story, map, words } = longForm();
  const window = chooseCutWindow(map, words, { section: "c2" });
  const cut = cutdownStory(resolved, { story, words, window, profile: SHORTS });
  const short = cut.story;
  assert.deepEqual([short.format.width, short.format.height, short.format.platform], [1080, 1920, "youtube-shorts"]);
  assert.ok(short.format.duration <= 60);
  // Re-planned, not cropped: the segment's split becomes stacked, the chapter structure stays behind.
  assert.deepEqual(short.sections.map((section) => [section.id, section.layout, section.start]), [["segment-c2", "stacked", 0]]);
  assert.equal(short.chapters, undefined);
  assert.equal(short.scenes.some((scene) => scene.module === "section-card" || scene.id === "promise"), false);
  assert.equal(short.frame?.progress, undefined);
  assert.ok(short.overlays.some((overlay) => overlay.type === "captions"));
  // The base edit: the window's source range; the subject and track come along by path.
  assert.deepEqual(short.base.src, "assets/recording.mp4");
  assert.equal(short.base.edl, undefined);
  assert.equal(storyBase(resolveStory(short, { words: cut.words })).segments[0].sourceStart, short.base.trim[0][0]);
  // The hook: the opening line's key words on a card at 0, and the loop back to it.
  const hook = short.scenes[0];
  assert.equal(hook.id, "hook");
  assert.equal(hook.start, 0);
  assert.ok(hook.end >= 2 && hook.end <= 3);
  assert.equal(hook.params.text, keyWords(cut.hook.text));
  assert.deepEqual(short.ending, { loop_to: "hook" });
  assert.equal(cut.map.sections[0].lines[0].intent, "hook");
  // The long form's word anchor is re-counted for the Short's narration and lands on the same word.
  const anchored = short.scenes.find((scene) => scene.id === "card-24");
  assert.match(String(anchored.start), /^word:[a-z]+(#\d+)?$/);
  assert.notEqual(anchored.start, story.scenes.find((scene) => scene.id === "card-24").start);
  const offset = words[window.words[0]].start - cut.words[0].start;
  const longStart = resolved.scenes.find((scene) => scene.id === "card-24").start;
  assert.equal(resolveStory(short, { words: cut.words }).scenes.find((scene) => scene.id === "card-24").start, round(longStart - offset));
  // Checks: the planner's, the map's and the Shorts profile's.
  const check = checkStoryboard(short, { words: cut.words, direction: cut.map, tier: "guided" });
  assert.equal(check.ok, true, check.errors.join("\n"));
  const local = resolveStory(short, { words: cut.words });
  assert.equal(validateDirection(cut.map, { words: cut.words, story: local }).ok, true);
  assert.equal(profileForStory(local, { direction: cut.map }).profile.id, "short-talking-head");
  const gate = coverageGate({ resolved: local, words: cut.words, map: cut.map, profile: SHORTS });
  assert.equal(gate.status, "passed", gate.errors.join("\n"));
  assert.ok(storyboardMeasures(local).first_visual_seconds <= SHORTS.measures.first_visual_seconds.p90);
});

test("cutdown: an undressed section is dressed into the Shorts band", () => {
  const { story, map, words } = longFormFixture();
  const bare = JSON.parse(JSON.stringify(map));
  for (const line of bare.sections[2].lines) Object.assign(line, { treatment: "face", scenes: undefined, why: "held" });
  const ids = new Set(map.sections[2].lines.flatMap((line) => line.scenes ?? []));
  const plain = { ...story, scenes: story.scenes.filter((scene) => !ids.has(scene.id)) };
  const resolved = resolveStory(plain, { words });
  const window = chooseCutWindow(bare, words, { section: "c3" });
  const cut = cutdownStory(resolved, { story: plain, words, window, profile: SHORTS });
  assert.ok(cut.added.length > 5, `added ${cut.added.join(", ")}`);
  assert.deepEqual(cut.carried, []);
  const local = resolveStory(cut.story, { words: cut.words });
  assert.equal(coverageGate({ resolved: local, words: cut.words, map: cut.map, profile: SHORTS }).status, "passed");
  assert.equal(checkStoryboard(cut.story, { words: cut.words, direction: cut.map, tier: "guided" }).ok, true);
});

async function longFormProjectDir() {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-cutdown-"));
  const { story, map, words } = longForm();
  await mkdir(path.join(project, "assets/subject"), { recursive: true });
  await mkdir(path.join(project, "assets/audio"), { recursive: true });
  await writeFile(path.join(project, "assets/recording.mp4"), "stand-in");
  await writeFile(path.join(project, "assets/audio/mix.wav"), "long-form mix");
  // A whole-video track for the recording (the example's 10 s pattern, repeated).
  const track = JSON.parse(await readFile(path.join(ROOT, "examples/story/layouts-wide/assets/subject/track.json"), "utf8"));
  const pattern = track.frames;
  track.frames = Array.from({ length: 6200 }, (_, i) => ({ ...pattern[i % pattern.length], t: Math.round(i) / 10 }));
  await writeFile(path.join(project, "assets/subject/track.json"), JSON.stringify(track));
  await writeFile(path.join(project, "storyboard.json"), JSON.stringify(story));
  await writeFile(path.join(project, "DIRECTION.json"), JSON.stringify(map));
  await writeFile(path.join(project, "NARRATION.json"), JSON.stringify({ words }));
  return project;
}

test("launchclip cutdown writes a 9:16 project that reuses the long form's assets", async () => {
  const project = await longFormProjectDir();
  try {
    let printed = "";
    await runCli(["cutdown", project, "--to", "shorts", "--section", "c2"], { stdout: { write(text) { printed += text; } } });
    const result = JSON.parse(printed);
    const out = path.join(project, "cutdowns", "c2-shorts");
    assert.equal(result.out, out);
    assert.equal(result.status, "ready");
    assert.equal(result.profile.id, "short-talking-head");
    assert.equal(result.profile.status, "passed");
    assert.equal(result.planner, "deterministic");
    for (const file of ["storyboard.json", "DIRECTION.json", "NARRATION.json", "CUTDOWN.json"]) assert.ok(existsSync(path.join(out, file)), file);
    const receipt = JSON.parse(await readFile(path.join(out, "CUTDOWN.json"), "utf8"));
    assert.equal(receipt.schema, "launchclip.cutdown.v1");
    assert.equal(receipt.source, "../..");
    assert.equal(receipt.loop_to, "hook");
    // Assets are hard links to the long form's (real files a renderer can copy), without its audio.
    for (const file of ["assets/recording.mp4", "assets/subject/track.json"]) {
      const [own, long] = await Promise.all([stat(path.join(out, file)), stat(path.join(project, file))]);
      assert.equal(own.ino, long.ino, `${file} is the long form's file`);
      assert.equal((await lstat(path.join(out, file))).isSymbolicLink(), false);
    }
    assert.equal(existsSync(path.join(out, "assets/audio")), false);
    // The face track is reused: it reads through the link for the Short's base.
    const short = JSON.parse(await readFile(path.join(out, "storyboard.json"), "utf8"));
    const track = await readStoryTrack(out, short);
    assert.equal(track.frames.length, 6200);
    // story validate passes on the Short.
    let validated = "";
    await runCli(["story", "validate", path.join(out, "storyboard.json")], { stdout: { write(text) { validated += text; } } });
    assert.equal(JSON.parse(validated).status, "passed", validated);

    await assert.rejects(runCutdown(project, { to: "shorts", section: "c2" }), /already holds a storyboard; pass --force/);
    const again = await runCutdown(project, { to: "shorts", section: "c2", force: true });
    assert.equal(again.out, out);
    await assert.rejects(runCutdown(project, {}), /cutdown needs --to shorts/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("launchclip cutdown --model re-plans with the planner and keeps the base edit and the loop", async () => {
  const project = await longFormProjectDir();
  try {
    const requests = [];
    const client = {
      provider: "openai",
      async runStructured(request) {
        requests.push(request);
        if (request.schemaName === "launchclip_direction") return { model: "m", value: { direction_json: "" }, usage: {} };
        const format = JSON.parse(/format: (\{[^\n]+\})/.exec(request.input)[1]);
        const story = { schema: "launchclip.story.v1", lane: "footage-led", format, brand: { colors: { bg: "#06070d", primary: "#fdb022", accent: "#46d4ff", ink: "#06070d", paper: "#f2eee6" }, fonts: { display: "anton", body: "space-grotesk", meta: "jetbrains-mono" } }, audio: { words: "NARRATION.json" }, base: "assets/recording.mp4",
          scenes: Array.from({ length: Math.floor(format.duration / 5) }, (_, i) => ({ id: `p${i + 1}`, module: "concept-card", track: 1, start: i * 5 + (i ? 0.2 : 0), end: i * 5 + 3.5, params: { text: `Point ${i + 1}` } })) };
        return { model: "m", value: { storyboard_json: JSON.stringify(story) }, usage: {} };
      }
    };
    const result = await runCutdown(project, { to: "shorts", section: "c2", model: "openai:gpt-5.6-luna" }, { client });
    assert.equal(result.planner.model, "openai:gpt-5.6-luna");
    assert.match(requests.at(-1).input, /Hook line: "/);
    const short = JSON.parse(await readFile(path.join(result.out, "storyboard.json"), "utf8"));
    assert.ok(Array.isArray(short.base.trim), "the base edit replaces the planner's bare base");
    assert.deepEqual(short.ending, { loop_to: "p1" });
    assert.equal(result.profile.status, "passed", JSON.stringify(result.profile));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

function round(value) {
  return Math.round(value * 1000) / 1000;
}
