// Cut-downs of voiceover-motion videos (kit/core/cutdown.mjs
// cutdownMotionStory, src/cutdown.js): picked lines or seconds, the narration
// spliced, shots, beats and states re-timed and laid out again at 9:16, an
// image on the first frame.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cutdownMotionStory, pickCutWindow } from "@launchclip/core/cutdown.mjs";
import { structureCheck } from "@launchclip/core/skeleton-library.mjs";
import { resolveStory, validateStory } from "@launchclip/core/story.mjs";
import { runCutdown } from "../src/cutdown.js";
import { resolveProfile } from "../src/profile_store.js";
import { coverageGate } from "../src/quality_gates.js";
import { checkStoryboard } from "../src/storyboard_planner.js";
import { longFormFixture } from "./helpers/long_form.js";

const SHORT_MOTION = resolveProfile("short-motion").profile;

// The long-form fixture as narration over motion graphics: one shot per line,
// butt-joined, each section opening on a title card, a beat and a state
// change on every chart, and a watermark over the whole video.
function motionLongForm() {
  const { story, map, words, lines } = longFormFixture();
  const scenes = lines.map((line, i) => {
    const start = i === 0 ? 0 : round(line.start - 0.1);
    const end = i + 1 < lines.length ? round(lines[i + 1].start - 0.1) : story.format.duration;
    const id = `s${i + 1}`;
    const opensSection = map.sections.some((section) => section.lines[0].words[0] === line.words[0]);
    if (opensSection) return { id, module: "hook-title", start, end, params: { headline: `Part ${i + 1}` } };
    if (i % 2) return { id, module: "concept-card", start, end, params: { text: `Point ${i + 1}` } };
    return {
      id, module: "bar-chart", start, end, in: { type: "pan", dur: 0.5, direction: "right" },
      params: { title: `Renders in week ${i + 1}`, data: [{ label: "Before", value: 2 }, { label: "After", value: 1 }], source: `Internal render telemetry for week ${i + 1}, before and after the cache landed` },
      hits: [{ at: round(line.start + 1), event: "build", cue: "whoosh" }],
      states: [{ at: round(line.start + 2), set: { focus: 1 } }]
    };
  });
  scenes.push({ id: "wm", module: "channel-watermark", track: 2, start: 0, end: story.format.duration, params: { name: "Fixture" } });
  const motion = { ...story, lane: "voiceover-motion", audio: { voice: "assets/audio/narration.wav", words: "NARRATION.json" }, scenes, frame: { progress: { ticks: true } } };
  delete motion.base;
  return { story: motion, map, words, lines, resolved: resolveStory(motion, { words }) };
}

test("cutdown: --lines and --range pick the narration, joining neighbouring lines into one segment", () => {
  const { map, words, lines } = motionLongForm();
  const window = pickCutWindow(map, words, { lines: "3-5,9" });
  assert.deepEqual(window.segments.map((segment) => segment.words), [[lines[2].words[0], lines[4].words[1]], lines[8].words]);
  assert.equal(window.lines.length, 4);
  assert.equal(window.section, "c1");
  assert.deepEqual(pickCutWindow(map, words, { lines: "5,3-4" }).segments.length, 1, "picks are put in order");
  const ranged = pickCutWindow(map, words, { range: `${lines[2].start}-${lines[3].end}` });
  assert.deepEqual(ranged.segments.map((segment) => segment.words), [[lines[2].words[0], lines[3].words[1]]]);
  assert.deepEqual(ranged.lines.map((line) => line.words), [lines[2].words, lines[3].words], "a range keeps the map's lines");
  assert.throws(() => pickCutWindow(map, words, { lines: "0" }), /--lines 0 is not a line of the direction map/);
  assert.throws(() => pickCutWindow(map, words, { lines: "4-2" }), /runs backwards/);
  assert.throws(() => pickCutWindow(map, words, { range: "12" }), /start-end seconds/);
  assert.throws(() => pickCutWindow(map, words, { range: "9000-9100" }), /holds no narration words/);
});

test("cutdown: a voiceover-motion Short re-times shots, beats and states across spliced segments", () => {
  const { story, resolved, map, words, lines } = motionLongForm();
  const window = pickCutWindow(map, words, { lines: "3-5,9" });
  const cut = cutdownMotionStory(resolved, { story, words, window, profile: SHORT_MOTION });
  const short = cut.story;
  assert.deepEqual([short.format.width, short.format.height, short.lane], [1080, 1920, "voiceover-motion"]);
  assert.deepEqual(short.audio, { voice: "assets/audio/narration.wav", words: "NARRATION.json" });
  assert.equal(short.frame.progress, undefined);
  assert.ok(short.overlays.some((overlay) => overlay.type === "captions"));
  // Two segments, back to back on the Short's clock.
  assert.equal(cut.segments.length, 2);
  assert.equal(cut.segments[0].offset, 0);
  assert.equal(round(cut.segments[1].offset), round(cut.segments[0].end - cut.segments[0].start));
  assert.equal(short.format.duration, round(cut.segments.reduce((sum, segment) => sum + segment.end - segment.start, 0)));
  // The words: the picked lines' words only, in order, on the Short's clock.
  assert.equal(cut.words.length, 4 * 12);
  assert.equal(cut.words[36].text, words[lines[8].words[0]].text);
  assert.ok(cut.words.every((word, i) => word.start >= 0 && (i === 0 || word.start > cut.words[i - 1].start)));
  // Shots butt-join from 0 to the end; the watermark runs the whole Short as one scene.
  const local = resolveStory(short, { words: cut.words });
  const shots = local.scenes.filter((scene) => (scene.track ?? 0) === 0);
  assert.equal(shots[0].start, 0);
  assert.equal(shots.at(-1).end, short.format.duration);
  shots.slice(1).forEach((scene, i) => assert.equal(scene.start, shots[i].end));
  assert.deepEqual(local.scenes.filter((scene) => scene.id.startsWith("wm")).map((scene) => [scene.id, scene.start, scene.end]), [["wm", 0, short.format.duration]]);
  // A chart's beat and state land on the same word as in the long form.
  const chart = local.scenes.find((scene) => scene.id === "s9");
  const shift = cut.segments[1].start - cut.segments[1].offset;
  const longChart = resolved.scenes.find((scene) => scene.id === "s9");
  assert.equal(chart.hits[0].at, round(longChart.hits[0].at - shift));
  assert.equal(chart.states[0].at, round(longChart.states[0].at - shift));
  // The chart's source line does not fit 9:16: it is dropped, not the shot.
  assert.ok(cut.warnings.some((warning) => /^s\d+: params\.source dropped to fit 9:16/.test(warning)), cut.warnings.join("\n"));
  assert.equal(validateStory(short).ok, true, validateStory(short).errors?.join("\n"));
  const check = checkStoryboard(short, { words: cut.words, direction: cut.map, tier: "guided", profile: SHORT_MOTION, bandErrors: false });
  assert.equal(check.ok, true, check.errors.join("\n"));
  assert.equal(coverageGate({ resolved: local, words: cut.words, map: cut.map, profile: SHORT_MOTION }).status, "passed");
});

test("cutdown: a Short re-times its shots' zooms and fits box zooms to the 9:16 safe area", () => {
  const { story, map, words } = motionLongForm();
  const s3 = story.scenes.find((scene) => scene.id === "s3"), s5 = story.scenes.find((scene) => scene.id === "s5");
  // A box in the long form's 1920x1080 plate px: copied as it is, it would sit off the Short's 1080 px wide plate.
  s3.zooms = [{ at: 11.5, until: 14.2, box: { x: 1300, y: 200, width: 500, height: 600 }, scale: 1.5 }];
  s5.zooms = [{ at: 21.5, target: 0 }];
  const resolved = resolveStory(story, { words });
  const long = validateStory(story);
  assert.ok(long.ok, long.errors.join("\n"));

  const cut = cutdownMotionStory(resolved, { story, words, window: pickCutWindow(map, words, { lines: "3-5" }), profile: SHORT_MOTION });
  const shift = cut.segments[0].start;
  const short3 = cut.story.scenes.find((scene) => scene.id === "s3"), short5 = cut.story.scenes.find((scene) => scene.id === "s5");
  assert.equal(short3.zooms[0].at, round(11.5 - shift));
  assert.equal(short3.zooms[0].until, round(14.2 - shift));
  assert.deepEqual(short3.zooms[0].box, { x: 731.3, y: 355.6, width: 281.3, height: 1066.7 });
  assert.equal(short3.zooms[0].scale, 1.5);
  assert.deepEqual(short5.zooms, [{ at: round(21.5 - shift), target: 0 }]);
  const check = validateStory(cut.story);
  assert.ok(check.ok, check.errors.join("\n"));

  // A range that starts after s5's zoom carries the shot without it; one that cuts s3 short drops the zoom it can no longer hold.
  const later = cutdownMotionStory(resolved, { story, words, window: pickCutWindow(map, words, { range: "22-30" }), profile: SHORT_MOTION });
  assert.equal(later.story.scenes.find((scene) => scene.id === "s5")?.zooms, undefined);
  const early = cutdownMotionStory(resolved, { story, words, window: pickCutWindow(map, words, { range: "10.3-13" }), profile: SHORT_MOTION });
  assert.equal(early.story.scenes.find((scene) => scene.id === "s3")?.zooms, undefined);
  assert.ok(validateStory(early.story).ok);
});

test("cutdown: a voiceover-motion Short opens on an image, not the section's title card", () => {
  const { story, resolved, map, words } = motionLongForm();
  // Line 1 of section c2 opens on a hook-title.
  const first = map.sections[0].lines.length + 1;
  const window = pickCutWindow(map, words, { lines: `${first}-${first + 4}` });
  const cut = cutdownMotionStory(resolved, { story, words, window, profile: SHORT_MOTION });
  const shots = cut.story.scenes.filter((scene) => (scene.track ?? 0) === 0);
  assert.equal(shots[0].id, "opening");
  assert.notEqual(shots[0].module, "hook-title");
  assert.equal(shots[0].in, undefined);
  assert.equal(shots[1].module, "hook-title", "the title card follows the opening image");
  assert.ok(shots[0].end >= 1.5 && shots[0].end <= 3, `the opening holds ${shots[0].end} s`);
  assert.equal(shots[1].start, shots[0].end);
  assert.deepEqual(cut.story.ending, { loop_to: "opening" });
  assert.deepEqual(cut.added, ["opening"]);
  assert.equal(cut.map.sections[0].lines[0].intent, "hook");
  const structure = structureCheck(cut.story, null, { words: cut.words });
  assert.equal(structure.checks.first_frame.ok, true, structure.checks.first_frame.detail);
});

test("launchclip cutdown cuts a voiceover-motion project: the narration spliced, the style found from the Short's folder", async () => {
  const { story, map, words } = motionLongForm();
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-cutdown-motion-"));
  try {
    await mkdir(path.join(project, "assets/audio"), { recursive: true });
    await mkdir(path.join(project, "styles"), { recursive: true });
    await writeFile(path.join(project, "assets/audio/narration.wav"), "long-form voice");
    await writeFile(path.join(project, "assets/mark.png"), "mark");
    await writeFile(path.join(project, "styles/house.json"), "{}");
    await writeFile(path.join(project, "storyboard.json"), JSON.stringify({ ...story, style: "styles/house.json" }));
    await writeFile(path.join(project, "DIRECTION.json"), JSON.stringify(map));
    await writeFile(path.join(project, "NARRATION.json"), JSON.stringify({ words }));
    const spliced = [];
    const spliceAudio = async (voice, segments, output) => { spliced.push({ voice, segments, output }); await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, "short voice"); };
    const result = await runCutdown(project, { to: "shorts", lines: "3-5,9" }, { spliceAudio });
    const out = path.join(project, "cutdowns", "c1-l3-5-9-shorts");
    assert.equal(result.out, out);
    assert.equal(result.status, "ready", JSON.stringify(result.profile));
    assert.equal(result.profile.id, "short-motion");
    assert.equal(result.voice, "assets/audio/narration.wav");
    assert.equal(result.window.segments.length, 2);
    assert.deepEqual(spliced.map((entry) => [entry.voice, entry.output, entry.segments.length]), [[path.join(project, "assets/audio/narration.wav"), path.join(out, "assets/audio/narration.wav"), 2]]);
    assert.ok(existsSync(path.join(out, "assets/mark.png")), "the long form's assets come along");
    const short = JSON.parse(await readFile(path.join(out, "storyboard.json"), "utf8"));
    assert.equal(short.style, "../../styles/house.json");
    await assert.rejects(runCutdown(project, { to: "shorts", lines: "3", section: "c1" }), /not several/);
    await assert.rejects(runCutdown(project, { to: "shorts", lines: "1-200" }), /not a line of the direction map/);
    await assert.rejects(runCutdown(project, { to: "shorts", section: "c1", model: "openai:gpt" }), /footage-led cut-downs only/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("launchclip cutdown still refuses a lane it cannot cut", async () => {
  const { story, map, words } = motionLongForm();
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-cutdown-motion-"));
  try {
    await writeFile(path.join(project, "storyboard.json"), JSON.stringify({ ...story, lane: "motion" }));
    await writeFile(path.join(project, "DIRECTION.json"), JSON.stringify(map));
    await writeFile(path.join(project, "NARRATION.json"), JSON.stringify({ words }));
    await assert.rejects(runCutdown(project, { to: "shorts" }), /cuts footage-led and voiceover-motion videos; this story is motion/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

function round(value) {
  return Math.round(value * 1000) / 1000;
}
