// One idea per frame (src/text_blocks.js, docs/EXPLAINER_CLAIMS_RFC.md §3.3):
// text blocks on screen at once, captions and decor aside.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateStory } from "@launchclip/core/story.mjs";
import { DEFAULT_BRAND } from "@launchclip/core/planning-prompt.mjs";
import { textBlockFindings, TEXT_BLOCKS } from "../src/text_blocks.js";
import { checkLayoutProject } from "../src/layout_check.js";
import { checkStoryboard } from "../src/storyboard_planner.js";

const W = 1080, H = 1920;
const story = (scenes) => ({ format: { width: W, height: H, duration: 12 }, resolved: { duration: 12 }, scenes });
const box = (y) => ({ x: 100, y, width: 860, height: 140 });
const text = (id, start, end, y = 400) => ({ id, role: "text", rect: box(y), start, end });
const caption = { id: "captions", role: "caption", rect: { x: 80, y: 1500, width: 920, height: 160 }, start: 0, end: 12 };
const blocks = (s, rects) => textBlockFindings(s, rects).filter((f) => f.rule === "text-blocks");

test("a title over the captions passes", () => {
  assert.deepEqual(blocks(story([{ id: "title", start: 0, end: 6 }]), [text("title", 0, 6), caption]), []);
});

test("a title, its own sub-line and a list's bullets over the captions is flagged, with a note to cut rather than shrink", () => {
  const s = story([{ id: "title", start: 0, end: 6 }, { id: "sub", start: 0.5, end: 6, track: 1 }, { id: "bullets", start: 1, end: 6, track: 2 }]);
  // The list's two bullets are parts of one scene: one block.
  const found = blocks(s, [text("title", 0, 6), text("sub", 0.5, 6, 600), text("bullets-0", 1, 6, 800), text("bullets-1", 1.5, 6, 1000), caption]);
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.match(found[0].detail, /^3 text blocks at once/);
  assert.match(found[0].detail, /captions already say the words, so cut the sub-line or the bullets rather than shrinking them/);
  assert.deepEqual(found[0].ids, ["title", "sub", "bullets"]);
  // Shipped as a warning for this release (RFC §6), the three-block case included.
  assert.equal(found[0].severity, "warning");
  assert.equal(TEXT_BLOCKS.severity, "warning");
});

test("two blocks: over 1 s is busy, a 1 s overlap at a handover is not", () => {
  const s = story([{ id: "a", start: 0, end: 5 }, { id: "b", start: 3, end: 8, track: 1 }]);
  const busy = blocks(s, [text("a", 0, 5), text("b", 3, 8, 700)]);
  assert.equal(busy.length, 1);
  assert.match(busy[0].detail, /2 text blocks on screen for 2 s/);
  assert.deepEqual(blocks(s, [text("a", 0, 4), text("b", 3, 8, 700)]), []);
});

test("a comparison-table counts once; decor, media and captions never count", () => {
  const s = story([{ id: "table", start: 0, end: 6 }, { id: "frame", start: 0, end: 6, track: 1 }]);
  const rects = [text("table", 0, 6), text("table-col-a", 0, 6, 700), text("table-col-b", 0, 6, 900), { id: "frame", role: "decor", rect: box(200), start: 0, end: 6 }, { id: "base", role: "media", rect: box(0), start: 0, end: 6 }, caption];
  assert.deepEqual(blocks(s, rects), []);
});

test("allow_text: 2 with a why lets one scene share the frame; without a why the story is invalid", () => {
  const scenes = [{ id: "a", start: 0, end: 5 }, { id: "b", start: 1, end: 5, track: 1, allow_text: 2, why: "the label names the axis the chart draws" }];
  assert.deepEqual(blocks(story(scenes), [text("a", 0, 5), text("b", 1, 5, 700)]), []);
  // Three still crowd the frame.
  assert.equal(blocks(story([...scenes, { id: "c", start: 2, end: 5, track: 2 }]), [text("a", 0, 5), text("b", 1, 5, 700), text("c", 2, 5, 900)]).length, 1);

  const valid = (scene) => validateStory({ schema: "launchclip.story.v1", lane: "voiceover-motion", format: { width: W, height: H, fps: 30, duration: 4 }, brand: DEFAULT_BRAND, audio: { voice: "a.wav", words: "NARRATION.json" }, scenes: [{ id: "a", module: "hook-title", start: 0, end: 4, params: { headline: "One idea" }, ...scene }] });
  assert.deepEqual(valid({ allow_text: 2, why: "the sub-line carries the number" }).errors.filter((e) => /allow_text/.test(e)), []);
  assert.ok(valid({ allow_text: 2 }).errors.some((e) => /allow_text needs a short why/.test(e)));
  assert.ok(valid({ allow_text: 3, why: "x" }).errors.some((e) => /allow_text must be 2/.test(e)));
});

test("the plan and finish give the same text-blocks verdict on the same storyboard", async () => {
  const words = ["One", "idea", "per", "frame", "keeps", "the", "short", "clear", "every", "time"].map((t, i) => ({ text: t, start: i * 0.6, end: i * 0.6 + 0.4 }));
  const storyboard = {
    schema: "launchclip.story.v1", title: "One idea", lane: "voiceover-motion",
    format: { width: W, height: H, fps: 30, duration: 6, platform: "youtube-shorts" }, brand: DEFAULT_BRAND,
    audio: { voice: "assets/audio/narration.wav", words: "NARRATION.json" },
    scenes: [
      { id: "s1", module: "hook-title", start: 0, end: 6, params: { headline: "One idea per frame" } },
      { id: "s2", module: "lower-third", start: 1, end: 5, track: 1, params: { name: "Keep it clear", title: "Cut the extra line" } }
    ],
    overlays: [{ type: "captions", style: "word-highlight" }]
  };
  const plan = checkStoryboard(structuredClone(storyboard), { words, tier: "advanced" });
  const planned = (plan.layout?.findings ?? []).filter((f) => f.rule === "text-blocks");
  const project = await mkdtemp(path.join(os.tmpdir(), "text-blocks-"));
  try {
    const finish = await checkLayoutProject(project, { story: structuredClone(storyboard), words });
    const finished = finish.findings.filter((f) => f.rule === "text-blocks");
    assert.ok(finished.length > 0, JSON.stringify(finish.findings.map((f) => f.rule)));
    assert.deepEqual(planned, finished);
    assert.ok(plan.warnings.some((w) => w.startsWith("layout: text-blocks")), plan.warnings.join("\n"));
    // The opt-out survives resolution on both sides.
    const allowed = structuredClone(storyboard);
    Object.assign(allowed.scenes[1], { allow_text: 2, why: "the lower third names the speaker" });
    assert.deepEqual(checkStoryboard(structuredClone(allowed), { words, tier: "advanced" }).layout.findings.filter((f) => f.rule === "text-blocks"), []);
    assert.deepEqual((await checkLayoutProject(project, { story: allowed, words })).findings.filter((f) => f.rule === "text-blocks"), []);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
