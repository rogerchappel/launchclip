import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { brandFramePlan } from "@launchclip/core/brand-frame.mjs";
import { storyboardMeasures } from "@launchclip/core/cadence.mjs";
import { validateDirection } from "@launchclip/core/direction.mjs";
import { PROMISE_ID, chaptersFromMap, matchSegment, ffmetadataChapters, sectionCardId, structureLongForm, youtubeChapterProblems, youtubeChapters, youtubeTimestamp } from "@launchclip/core/long-form.mjs";
import { directionPrompt } from "@launchclip/core/planning-prompt.mjs";
import { resolveStory, storyChapters, validateStory } from "@launchclip/core/story.mjs";
import { brandFrameErrors, segmentErrors, stylePromptLines, validateStylePack } from "@launchclip/core/style.mjs";
import { runCli } from "../src/cli.js";
import { profileForStory } from "../src/profile_store.js";
import { coverageGate } from "../src/quality_gates.js";
import { runStoryCommand } from "../src/story_cli.js";
import { buildTimeline } from "../src/nle/timeline.js";
import { readFcpxml, validateFcpxml, writeFcpxml } from "../src/nle/fcpxml.js";
import { checkStoryboard, planStoryboard } from "../src/storyboard_planner.js";
import { LONG_FORM_TITLES, longFormFixture } from "./helpers/long_form.js";

test("chapters: the contract in story.json, checked and resolved", () => {
  const { story } = longFormFixture();
  const chaptered = { ...story, chapters: [{ id: "intro", title: "Intro", start: 0 }, { id: "tools", title: "Tool of the week", start: 100, segment: "tool-of-the-week" }, { id: "end", title: "Wrap", start: 300 }] };
  assert.equal(validateStory(chaptered).ok, true, validateStory(chaptered).errors.join("\n"));
  const bad = validateStory({ ...story, chapters: [{ id: "a", title: "A", start: 5 }, { id: "a", title: "", start: 3, extra: 1 }] });
  assert.ok(bad.errors.some((error) => /chapters\[0\]\.start must be 0/.test(error)));
  assert.ok(bad.errors.some((error) => /"a" is used twice/.test(error)));
  assert.ok(bad.errors.some((error) => /chapters\[1\]\.title must be 1-60/.test(error)));
  assert.ok(bad.errors.some((error) => /chapters\[1\]\.extra is not supported/.test(error)));
  assert.ok(bad.errors.some((error) => /must be after the chapter before it/.test(error)));
  const short = validateStory({ ...story, chapters: [{ id: "a", title: "A", start: 0 }, { id: "b", title: "B", start: 4 }] });
  assert.ok(short.warnings.some((warning) => /YouTube ignores a chapter list with a chapter under 10s/.test(warning)));
  assert.ok(short.warnings.some((warning) => /at least 3/.test(warning)));
  const { words } = longFormFixture();
  const resolved = resolveStory(chaptered, { words });
  const chapters = storyChapters(resolved);
  assert.deepEqual(chapters.map((chapter) => [chapter.id, chapter.start, chapter.end, chapter.segment]), [["intro", 0, 100, null], ["tools", 100, 300, "tool-of-the-week"], ["end", 300, 600, null]]);
  // A start may be a word anchor.
  const anchored = storyChapters(resolveStory({ ...chaptered, chapters: [chaptered.chapters[0], { id: "b", title: "B", start: "word:pipeline" }] }, { words }));
  assert.equal(anchored[1].start, words.find((word) => word.text === "pipeline").start);
});

test("chaptersFromMap: one chapter per section, the first at 0, short sections merged", () => {
  const { map, words } = longFormFixture();
  const chapters = chaptersFromMap(map, words, { duration: 600 });
  assert.deepEqual(chapters.map((chapter) => chapter.title), LONG_FORM_TITLES);
  assert.equal(chapters[0].start, 0);
  assert.ok(chapters.every((chapter, i) => i === 0 || chapter.start - chapters[i - 1].start >= 10));
  // A 5 s section joins the chapter after it; an untitled one is "Part n".
  const squeezed = { ...map, sections: [map.sections[0], { id: "tiny", start: chapters[2].start - 5, lines: map.sections[1].lines.slice(0, 1) }, { ...map.sections[2], title: undefined }] };
  const merged = chaptersFromMap(squeezed, words, { duration: 600 });
  assert.deepEqual(merged.map((chapter) => [chapter.id, chapter.title, chapter.start]), [["c1", "The problem", 0], ["c3", "Part 3", chapters[2].start - 5]]);
});

test("structureLongForm: section cards, the opening promise and the progress line, idempotent", () => {
  const { story, map, words } = longFormFixture();
  const result = structureLongForm(story, { words, map });
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.chapters.map((chapter) => chapter.title), LONG_FORM_TITLES);
  assert.deepEqual(result.story.chapters.map((chapter) => chapter.id), ["c1", "c2", "c3", "c4", "c5", "c6"]);
  // A card at each chapter start after the first: a numbered insert.
  const cards = result.story.scenes.filter((scene) => scene.module === "section-card");
  assert.deepEqual(cards.map((card) => card.id), ["c2", "c3", "c4", "c5", "c6"].map(sectionCardId));
  for (const card of cards) {
    const chapter = result.chapters.find((entry) => sectionCardId(entry.id) === card.id);
    assert.equal(card.start, chapter.start);
    assert.equal(card.insert, true);
    assert.equal(card.params.title, chapter.title);
    assert.equal(card.params.kicker, `Chapter ${chapter.index + 1}`);
    assert.equal(card.params.number, chapter.index + 1);
  }
  // The concept card each chapter opens with starts after its section card.
  assert.equal(result.changed.length, 5);
  for (const move of result.changed) assert.ok(move.start > move.was[0] && move.end === move.was[1]);
  // The promise lists the chapters to come, right after the hook line.
  const promise = result.story.scenes.find((scene) => scene.id === PROMISE_ID);
  assert.equal(promise.module, "icon-row");
  assert.equal(promise.track, 1);
  assert.deepEqual(promise.params.items.map((item) => item.label), LONG_FORM_TITLES.slice(1));
  assert.ok(promise.params.items.every((item) => typeof item.icon === "string"));
  assert.equal(promise.params.items[0].icon, "wrench", "\"Tool of the week\" gets a tool icon");
  assert.equal(result.story.frame.progress.ticks, true);
  // Section titles land in the map, and the moved scenes still cover their lines.
  assert.ok(result.map.sections.every((section) => section.title));
  const check = checkStoryboard(result.story, { words, direction: result.map, tier: "guided" });
  assert.equal(check.ok, true, check.errors.join("\n"));
  assert.equal(validateDirection(result.map, { words, story: resolveStory(result.story, { words }) }).ok, true);
  // Running it again replaces what it added.
  const again = structureLongForm(result.story, { words, map: result.map });
  assert.deepEqual(again.story.scenes.map((scene) => [scene.id, scene.start, scene.end]), result.story.scenes.map((scene) => [scene.id, scene.start, scene.end]));
  assert.deepEqual(again.changed, []);
});

test("structureLongForm: a card with no room is skipped with a warning; a face line under a card becomes an insert", () => {
  const { story, map, words, lines } = longFormFixture();
  const chapters = chaptersFromMap(map, words, { duration: 600 });
  // A long, line-bound scene across chapter 3's start cannot move: its line is all it covers.
  const at = chapters[2].start;
  story.scenes = story.scenes.filter((scene) => !(scene.start < at + 6 && scene.end > at - 6));
  story.scenes.push({ id: "wall", module: "concept-card", track: 1, start: at - 0.5, end: at + 8, params: { text: "No room" } });
  const line = lines.find((entry) => entry.start <= at && entry.end > at);
  for (const section of map.sections) for (const entry of section.lines) {
    if (entry.words[0] === line.words[0]) Object.assign(entry, { treatment: "dress", scenes: ["wall"], why: undefined });
    else if (Array.isArray(entry.scenes) && entry.scenes.some((id) => !story.scenes.some((scene) => scene.id === id))) Object.assign(entry, { treatment: "face", scenes: undefined, why: "held" });
  }
  const result = structureLongForm(story, { words, map });
  assert.ok(result.warnings.some((warning) => /section card for chapter "c3": no room/.test(warning)), result.warnings.join("\n"));
  assert.equal(result.story.scenes.some((scene) => scene.id === sectionCardId("c3")), false);
  // Chapter 4 opens on a face line in this map? No: make one, and the card claims it.
  const faceMap = JSON.parse(JSON.stringify(map));
  const c4 = faceMap.sections[3];
  Object.assign(c4.lines[0], { treatment: "face", scenes: undefined, why: "held" });
  const plain = { ...story, scenes: story.scenes.filter((scene) => !c4.lines[0].words || scene.id !== `card-${c4.lines[0].words[0] / 12 + 1}`) };
  const second = structureLongForm(plain, { words, map: faceMap });
  const opened = second.map.sections[3].lines[0];
  assert.equal(opened.treatment, "insert");
  assert.deepEqual(opened.scenes, [sectionCardId("c4")]);
});

test("the brand frame: chapter labels by default and a tick per chapter on the progress line", () => {
  const { story, map, words } = longFormFixture();
  const { story: structured } = structureLongForm(story, { words, map });
  const resolved = resolveStory(structured, { words });
  const plan = brandFramePlan(resolved);
  const find = (nodes, id) => nodes.flatMap((node) => [node, ...(node.children ? [find(node.children, id)].flat() : [])]).filter(Boolean).find((node) => node?.id === id);
  const progress = find(plan.nodes, "lc-frame-progress");
  assert.deepEqual(progress.children.map((node) => node.id), ["lc-frame-progress-fill", "lc-frame-tick-01", "lc-frame-tick-02", "lc-frame-tick-03", "lc-frame-tick-04", "lc-frame-tick-05"]);
  assert.match(plan.css, /#lc-frame-tick-01 \{ left: 16\.\d+%; \}/);
  assert.deepEqual(plan.layout.labels.map((label) => label.label), LONG_FORM_TITLES);
  assert.deepEqual(brandFrameErrors({ progress: { ticks: "yes" } }), ["brand_frame.progress.ticks must be true or false (a mark at each chapter start)"]);
  const off = brandFramePlan({ ...resolved, frame: { progress: { ticks: false } } });
  assert.equal(find(off.nodes, "lc-frame-progress").children.length, 1);
});

test("YouTube chapters and FFMETADATA: timestamps, problems and escaping", () => {
  assert.equal(youtubeTimestamp(0), "0:00");
  assert.equal(youtubeTimestamp(100.3), "1:40");
  assert.equal(youtubeTimestamp(3725), "1:02:05");
  const chapters = [{ id: "a", title: "Intro", start: 0 }, { id: "b", title: "Tool of the week", start: 100.3 }, { id: "c", title: "Q&A; = #1", start: 500 }];
  assert.equal(youtubeChapters(chapters), "0:00 Intro\n1:40 Tool of the week\n8:20 Q&A; = #1\n");
  assert.deepEqual(youtubeChapterProblems(chapters, 600), []);
  assert.deepEqual(youtubeChapterProblems(chapters, 505), ["chapter \"c\" runs 5 s; YouTube needs at least 10 s"]);
  assert.deepEqual(youtubeChapterProblems(chapters.slice(1), 600), ["the first chapter does not start at 0:00", "2 chapters; YouTube needs at least 3"]);
  const meta = ffmetadataChapters(chapters, { duration: 600, title: "Long = form" });
  assert.match(meta, /^;FFMETADATA1\ntitle=Long \\= form\n/);
  assert.match(meta, /\[CHAPTER\]\nTIMEBASE=1\/1000\nSTART=100300\nEND=500000\ntitle=Tool of the week/);
  assert.match(meta, /title=Q&A\\; \\= \\#1/);
});

test("the direction prompt asks a long story for chapter titles", () => {
  const { words } = longFormFixture();
  const long = directionPrompt({ lane: "footage-led", format: { width: 1920, height: 1080, fps: 30, duration: 600 }, words });
  assert.match(long, /## Long form/);
  assert.match(long, /each section is a chapter/);
  const short = directionPrompt({ lane: "footage-led", format: { width: 1080, height: 1920, fps: 30, duration: 40 }, words: words.slice(0, 50) });
  assert.doesNotMatch(short, /## Long form/);
});

test("planStoryboard structures a long plan; the planned storyboard keeps its scenes", async () => {
  const { story, map, words } = longFormFixture();
  const client = {
    provider: "openai",
    async runStructured(request) {
      if (request.schemaName === "launchclip_direction") return { model: "m", value: { direction_json: JSON.stringify(map) }, usage: {} };
      return { model: "m", value: { storyboard_json: JSON.stringify(story) }, usage: {} };
    }
  };
  const report = await planStoryboard({ brief: "A ten-minute walkthrough", words, lane: "footage-led", format: story.format, tier: "guided", client, direction: true, base: story.base.src, audio: story.audio, brand: story.brand });
  assert.equal(report.status, "passed", report.errors.join("\n"));
  assert.equal(report.long_form.chapters.length, 6);
  assert.equal(report.long_form.added.filter((entry) => entry.kind === "section-card").length, 5);
  assert.ok(report.storyboard.scenes.some((scene) => scene.id === PROMISE_ID));
  assert.ok(report.direction.sections.every((section) => section.title));
  const off = await planStoryboard({ brief: "A ten-minute walkthrough", words, lane: "footage-led", format: story.format, tier: "guided", client, direction: true, base: story.base.src, audio: story.audio, brand: story.brand, longForm: false });
  assert.equal(off.long_form, null);
  assert.equal(off.storyboard.chapters, undefined);
});

test("launchclip story long-form writes the chapters into the project", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-long-form-"));
  try {
    const { story, map, words } = longFormFixture();
    await writeFile(path.join(project, "storyboard.json"), JSON.stringify(story));
    await writeFile(path.join(project, "DIRECTION.json"), JSON.stringify(map));
    await writeFile(path.join(project, "NARRATION.json"), JSON.stringify({ words }));
    const dry = await runCli(["story", "long-form", project, "--dry-run"], { stdout: { write() {} } });
    assert.equal(dry?.status ?? "planned", "planned");
    assert.equal(JSON.parse(await readFile(path.join(project, "storyboard.json"), "utf8")).chapters, undefined);
    let printed = "";
    await runCli(["story", "long-form", project], { stdout: { write(text) { printed += text; } } });
    const written = JSON.parse(await readFile(path.join(project, "storyboard.json"), "utf8"));
    assert.equal(written.chapters.length, 6);
    assert.match(printed, /"0:00 The problem"/);
    assert.ok(JSON.parse(await readFile(path.join(project, "DIRECTION.json"), "utf8")).sections.every((section) => section.title));
    // No map and no chapters: nothing to make chapters from.
    await rm(path.join(project, "DIRECTION.json"));
    await writeFile(path.join(project, "storyboard.json"), JSON.stringify(story));
    await assert.rejects(runCli(["story", "long-form", project], { stdout: { write() {} } }), /makes chapters from the direction map's sections/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("NLE exports carry the chapters as markers (FCPXML chapter markers)", () => {
  const { story, map, words } = longFormFixture({ duration: 120, sections: 3 });
  const { story: structured } = structureLongForm(story, { words, map });
  const resolved = resolveStory(structured, { words });
  const models = Object.fromEntries(resolved.scenes.map((scene) => [scene.id, {}]));
  const timeline = buildTimeline(resolved, { base: { source: "/project/assets/recording.mp4", duration: 120, hasAudio: true, audioChannels: 1, width: 1920, height: 1080 } }, { name: "long", models });
  const chapters = timeline.markers.filter((marker) => marker.kind === "chapter");
  assert.deepEqual(chapters.map((marker) => [marker.frame, marker.name]), storyChapters(resolved).map((chapter) => [Math.round(chapter.start * 30), chapter.title]));
  const xml = fcpxmlText(writeFcpxml(timeline));
  assert.equal((xml.match(/<chapter-marker /g) ?? []).length, 3);
  assert.deepEqual(validateFcpxml(xml), []);
  const parsed = readFcpxml(xml);
  assert.equal(parsed.markers.filter((marker) => marker.chapter).length, 3);
});

const fcpxmlText = (written) => (typeof written === "string" ? written : written.xml ?? written.fcpxml);

test("attention resets: the measure counts inserts, section cards and layout changes", () => {
  const story = { schema: "launchclip.story.v1", lane: "footage-led", format: { width: 1920, height: 1080, fps: 30, duration: 300 }, brand: {}, base: { src: "assets/r.mp4" }, scenes: [
    { id: "i", module: "concept-card", insert: true, start: 40, end: 44, params: { text: "x" } },
    { id: "o", module: "concept-card", track: 1, start: 60, end: 64, params: { text: "x" } },
    { id: "c", module: "section-card", insert: true, start: 150, end: 152.6, params: { title: "x" } }
  ], sections: [{ id: "s", start: 200, end: 220, layout: "split-right" }] };
  const measures = storyboardMeasures(story);
  assert.deepEqual(measures.reset_times, [40, 150, 200, 220]);
  assert.equal(measures.longest_without_reset_seconds, 110);
  assert.deepEqual(measures.intervals.unreset.at(-1), [220, 300]);
  // A direction map's section layouts count too.
  const mapped = storyboardMeasures(story, { sections: [{ start: 0, end: 100, layout: "full" }, { start: 100, end: 300, layout: "framed" }] });
  assert.deepEqual(mapped.reset_times, [40, 100, 150, 200, 220]);
});

test("attention resets: the pass makes overlay cards inserts, else changes the layout", () => {
  const { story, map, words } = longFormFixture();
  const profile = { id: "youtube-long-form", measures: { longest_without_reset_seconds: { p50: 60, p90: 120 } } };
  const result = structureLongForm(story, { words, map, profile });
  assert.deepEqual(result.resets.sections, []);
  assert.equal(result.resets.promoted.length, 6);
  assert.ok(result.resets.longest <= 60, `longest run ${result.resets.longest} s`);
  for (const id of result.resets.promoted) {
    const scene = result.story.scenes.find((entry) => entry.id === id);
    assert.equal(scene.insert, true);
    assert.equal(scene.track, undefined);
    const line = result.map.sections.flatMap((section) => section.lines).find((entry) => entry.scenes?.includes(id));
    assert.equal(line.treatment, "insert");
  }
  const resolved = resolveStory(result.story, { words });
  assert.equal(storyboardMeasures(resolved).longest_without_reset_seconds, result.resets.longest);
  assert.equal(checkStoryboard(result.story, { words, direction: result.map, tier: "guided" }).ok, true);
  // Chapter 2 has no cards: a layout change resets it instead.
  const c2 = map.sections[1];
  const bare = JSON.parse(JSON.stringify(map));
  for (const line of bare.sections[1].lines) Object.assign(line, { treatment: "face", scenes: undefined, why: "held" });
  const ids = new Set(c2.lines.flatMap((line) => line.scenes ?? []));
  const plain = { ...story, scenes: story.scenes.filter((scene) => !ids.has(scene.id)) };
  const layout = structureLongForm(plain, { words, map: bare, profile });
  assert.deepEqual(layout.resets.sections, ["reset-1"]);
  const section = layout.story.sections[0];
  assert.equal(section.layout, "split-right");
  assert.ok(section.end - section.start <= 20);
  assert.equal(checkStoryboard(layout.story, { words, direction: layout.map, tier: "guided" }).ok, true);
  assert.ok(layout.resets.longest <= 60);
  // Off by option, and not for a story with no presenter.
  assert.equal(structureLongForm(story, { words, map, resets: false }).resets, null);
});

test("attention resets: the coverage gate and story validate check the ceiling", async () => {
  const { story, map, words } = longFormFixture();
  const { profile } = profileForStory(story, { direction: map });
  assert.equal(profile.id, "youtube-long-form");
  const resolved = resolveStory(story, { words });
  const gate = coverageGate({ resolved, words, map, profile });
  assert.equal(gate.status, "failed");
  assert.ok(gate.errors.some((error) => /longest_without_reset_seconds 600 s is above the profile band/.test(error)), gate.errors.join("\n"));
  assert.ok(gate.findings.some((finding) => finding.category === "sparseness" && /no attention reset/.test(finding.message)));
  const structured = structureLongForm(story, { words, map, profile });
  const passed = coverageGate({ resolved: resolveStory(structured.story, { words }), words, map: structured.map, profile });
  assert.equal(passed.bands.find((band) => band.measure === "longest_without_reset_seconds").status, "inside");
  assert.ok(passed.measures.resets >= 10);

  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-resets-"));
  try {
    await writeFile(path.join(project, "storyboard.json"), JSON.stringify(story));
    await writeFile(path.join(project, "DIRECTION.json"), JSON.stringify(map));
    await writeFile(path.join(project, "NARRATION.json"), JSON.stringify({ words }));
    const before = await runStoryCommand("validate", path.join(project, "storyboard.json"));
    assert.ok(before.errors.some((error) => /longest_without_reset_seconds .*\(launchclip story long-form places them\)/.test(error)), before.errors.join("\n"));
    await runCli(["story", "long-form", project], { stdout: { write() {} } });
    const after = await runStoryCommand("validate", path.join(project, "storyboard.json"));
    assert.deepEqual(after.errors, []);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

const TOOL = Object.freeze({ id: "tool-of-the-week", title: "Tool of the week", kicker: "Every Friday", layout: "split-right", modules: ["object-card", "concept-card"], icon: "wrench", match: ["tool of the week", "this week's tool"] });

test("segment formats: the style's shape, its prompt lines and the map's segment field", () => {
  assert.deepEqual(segmentErrors([TOOL]), []);
  assert.deepEqual(segmentErrors([{ ...TOOL, id: "Bad Id", layout: "insert", extra: 1, modules: ["nope"] }, TOOL, TOOL], { modules: ["concept-card"] }), [
    "segments[0].extra is not supported (id, title, kicker, layout, modules, icon, match)",
    "segments[0].id must be a lowercase slug (a-z, 0-9, -)",
    "segments[0].layout must be one of full, split-left, split-right, framed, stacked",
    "segments[0].modules: \"nope\" is not a module",
    "segments[1].modules: \"object-card\" is not a module",
    "segments[2].id \"tool-of-the-week\" is used twice",
    "segments[2].modules: \"object-card\" is not a module"
  ]);
  assert.ok(validateStylePack({ schema: "launchclip.style.v3", name: "show", segments: "x" }).errors.some((error) => /segments must be a list/.test(error)));
  const lines = stylePromptLines({ name: "show", segments: [TOOL] }, { lane: "footage-led" });
  assert.ok(lines.some((line) => /Recurring segments/.test(line)));
  assert.ok(lines.includes("- tool-of-the-week: \"Tool of the week\", layout split-right, prefer object-card, concept-card (a section titled like \"tool of the week\" or \"this week's tool\")."));
  const { map, words } = longFormFixture();
  const named = { ...map, sections: map.sections.map((section, i) => (i === 1 ? { ...section, segment: "tool-of-the-week" } : section)) };
  assert.equal(validateDirection(named, { words, lane: "footage-led", segments: [TOOL] }).ok, true);
  assert.ok(validateDirection(named, { words, lane: "footage-led", segments: [] }).errors.some((error) => /segment "tool-of-the-week" is not one of the style's segment formats/.test(error)));
  const prompt = directionPrompt({ lane: "footage-led", format: { width: 1920, height: 1080, fps: 30, duration: 600 }, words, segments: [TOOL] });
  assert.match(prompt, /## Recurring segments/);
  assert.match(prompt, /- tool-of-the-week: "Tool of the week", layout split-right, prefer object-card, concept-card/);
});

test("segment formats: every episode's segment chapter opens and lays out the same way", () => {
  const episodes = [0, 1].map((n) => {
    const { story, map, words } = longFormFixture();
    map.sections[1].title = n ? "This week's tool: Raycast" : "Tool of the week";
    return structureLongForm(story, { words, map, segments: [TOOL] });
  });
  for (const episode of episodes) {
    const card = episode.story.scenes.find((scene) => scene.id === sectionCardId("c2"));
    assert.equal(card.params.kicker, "Every Friday");
    assert.equal(card.params.icon, "wrench");
    assert.equal(card.params.number, undefined);
    const other = episode.story.scenes.find((scene) => scene.id === sectionCardId("c3"));
    assert.equal(other.params.kicker, "Chapter 3");
    assert.equal(episode.story.chapters[1].segment, "tool-of-the-week");
    assert.equal(episode.map.sections[1].segment, "tool-of-the-week");
    assert.equal(episode.map.sections[1].layout, "split-right");
    const chapter = episode.chapters[1];
    assert.deepEqual(episode.story.sections.find((section) => section.id === "segment-c2"), { id: "segment-c2", start: chapter.start, end: chapter.end, layout: "split-right" });
    assert.deepEqual(episode.segments, [{ chapter: "c2", segment: "tool-of-the-week", card: sectionCardId("c2"), layout: "split-right", modules: ["concept-card"] }]);
    assert.equal(checkStoryboard(episode.story, { words: longFormFixture().words, direction: episode.map, tier: "guided", style: null }).ok, true);
  }
  // A segment none of whose modules play gets a warning; an unknown one too.
  const { story, map, words } = longFormFixture();
  const strict = structureLongForm(story, { words, map, segments: [{ ...TOOL, modules: ["object-card"] }] });
  assert.ok(strict.warnings.some((warning) => /chapter "c2" uses none of its modules \(object-card\)/.test(warning)));
  const unknown = structureLongForm({ ...story, chapters: [{ id: "a", title: "A", start: 0, segment: "nope" }, { id: "b", title: "B", start: 200 }, { id: "c", title: "C", start: 400 }] }, { words, map, segments: [TOOL] });
  assert.ok(unknown.warnings.some((warning) => /names segment "nope", which the style does not define/.test(warning)));
  assert.equal(matchSegment("Tool Of The Week #12", [TOOL]).id, "tool-of-the-week");
  assert.equal(matchSegment("How it works", [TOOL]), null);
});
