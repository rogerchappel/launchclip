import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { lintTimeline } from "../motion-engine/lint.js";
import { validateTimeline, MOTION_TIMELINE_VERSION } from "../motion-engine/schema.js";
import { SCENE_CATALOG, EVENT_CATALOG, renderCatalog } from "../motion-engine/catalog.js";
import { SCENE_TYPES, EVENT_TYPES } from "../motion-engine/schema.js";
import { PRESETS, renderPreset } from "../motion-engine/presets.js";
import { buildSystemPrompt, estimateWords, runDirect } from "../src/director.js";

const words = [
  { word: "One", start: 0.3, end: 0.5 },
  { word: "two", start: 0.9, end: 1.1 },
  { word: "three.", start: 1.5, end: 1.8 },
  { word: "Done", start: 4.0, end: 4.3 },
  { word: "now.", start: 4.6, end: 4.9 }
];

function makeTimeline(scenes, events = []) {
  return validateTimeline({
    version: MOTION_TIMELINE_VERSION,
    duration_seconds: 6,
    base: { type: "placeholder", src: "" },
    words,
    scenes,
    events
  }).timeline;
}

test("catalog covers every renderer scene and event type", () => {
  const catalogScenes = new Set(SCENE_CATALOG.map((entry) => entry.type));
  for (const type of SCENE_TYPES) assert.ok(catalogScenes.has(type), `catalog missing scene type ${type}`);
  const catalogEvents = new Set(EVENT_CATALOG.map((entry) => entry.type));
  for (const type of EVENT_TYPES) assert.ok(catalogEvents.has(type), `catalog missing event type ${type}`);
  const rendered = renderCatalog();
  assert.ok(rendered.includes("card_steps") && rendered.includes("punch_zoom"));
});

test("system prompt assembles digest, catalog, and preset", () => {
  const prompt = buildSystemPrompt("explainer");
  assert.ok(prompt.includes("CADENCE IS ABSOLUTE"));
  assert.ok(prompt.includes("### typography"));
  assert.ok(prompt.includes("Format preset: explainer"));
  assert.ok(renderPreset(PRESETS.software_demo).includes("software_demo"));
});

test("lint flags dead air in graphic scenes", () => {
  const timeline = makeTimeline([
    { id: "a", type: "card_steps", start: 0, end: 6, transition: "cut", items: [{ text: "One", at: 0.3 }] }
  ]);
  const result = lintTimeline(timeline);
  assert.ok(result.failures.some((failure) => failure.includes("idle")));
});

test("lint flags off-word builds and missing tail coverage", () => {
  const timeline = makeTimeline([
    { id: "a", type: "card_steps", start: 0, end: 3, transition: "cut", items: [{ text: "One", at: 0.3 }, { text: "two", at: 0.9 }, { text: "x", at: 2.2 }] }
  ]);
  const result = lintTimeline(timeline);
  assert.ok(result.failures.some((failure) => failure.includes("not on a word start")));
  assert.ok(result.failures.some((failure) => failure.includes("cover the tail")));
});

test("lint verifies direction is honored", () => {
  const timeline = makeTimeline([
    { id: "a", type: "typography", start: 0, end: 2, transition: "cut", items: [{ text: "One two", at: 0.3 }, { text: "three", at: 1.5 }] },
    { id: "b", type: "typography", start: 2, end: 6, transition: "swipe_left", items: [{ text: "Done", at: 4.0 }, { text: "now", at: 4.6 }] }
  ]);
  const direction = {
    must_include: [{ kind: "line", text: "completely absent phrase zebra quantum" }],
    asset_refs: [{ path: "logos/missing.svg", role: "logo" }]
  };
  const result = lintTimeline(timeline, { direction });
  assert.ok(result.failures.some((failure) => failure.includes("zebra") || failure.includes("absent")));
  assert.ok(result.failures.some((failure) => failure.includes("missing.svg")));
});

test("lint passes a dense, grounded, covered timeline", () => {
  const timeline = makeTimeline(
    [
      { id: "a", type: "typography", start: 0, end: 2.5, transition: "cut", items: [{ text: "One", at: 0.3 }, { text: "two", at: 0.9 }, { text: "three", at: 1.5 }] },
      { id: "b", type: "card_steps", start: 2.5, end: 6, transition: "swipe_left", items: [{ text: "Done", at: 4.0 }, { text: "now", at: 4.6 }] }
    ],
    []
  );
  const result = lintTimeline(timeline);
  assert.equal(result.failures.length, 0, result.failures.join("; "));
});

test("reference-grade lint requires proof, variety, and tighter density", () => {
  const weak = makeTimeline([
    { id: "a", type: "typography", start: 0, end: 1.8, transition: "cut", items: [{ text: "One", at: 0.3 }, { text: "two", at: 0.9 }, { text: "three", at: 1.5 }] },
    { id: "b", type: "typography", start: 1.8, end: 3.1, transition: "cut", items: [{ text: "Done", at: 4.0 }] },
    { id: "c", type: "typography", start: 3.1, end: 6, transition: "cut", items: [{ text: "now", at: 4.6 }] }
  ]);
  const weakResult = lintTimeline(weak, { referenceGrade: true });
  assert.ok(weakResult.failures.some((failure) => failure.includes("at least 4")));
  assert.ok(weakResult.failures.some((failure) => failure.includes("include artifact_grid or terminal_receipt")));
  assert.ok(weakResult.failures.some((failure) => failure.includes("repeats")));

  const strong = makeTimeline([
    { id: "a", type: "typography", start: 0, end: 1.8, transition: "cut", items: [{ text: "One", at: 0.3 }, { text: "two", at: 0.9 }, { text: "three", at: 1.5 }] },
    { id: "b", type: "prompt_card", start: 1.8, end: 3.0, transition: "cut", text: "launchclip direct . --voice tts" },
    { id: "c", type: "terminal_receipt", start: 3.0, end: 4.3, transition: "cut", command: "npm run smoke", output: "Smoke OK", status: "passed", at: 4.0 },
    { id: "d", type: "quote_card", start: 4.3, end: 6, transition: "cut", text: "Ship the proof.", at: 4.6 }
  ]);
  const strongResult = lintTimeline(strong, { referenceGrade: true });
  assert.equal(strongResult.failures.length, 0, strongResult.failures.join("; "));
});

test("estimateWords produces monotonic plausible timings", () => {
  const estimated = estimateWords("Ship the launch video today. No editor needed.");
  assert.ok(estimated.length === 8);
  for (let index = 1; index < estimated.length; index += 1) {
    assert.ok(estimated[index].start >= estimated[index - 1].end);
  }
  assert.ok(estimated[estimated.length - 1].end < 10);
});

test("stat_counter, quote_card, chapters validate and lint", () => {
  const timeline = makeTimeline([
    { id: "a", type: "stat_counter", start: 0, end: 2.5, transition: "cut", value: "10x", label: "faster", at: 0.3 },
    { id: "b", type: "quote_card", start: 2.5, end: 4.5, transition: "swipe_left", text: "Ship the proof.", at: 4.0 },
    { id: "c", type: "typography", start: 4.5, end: 6, transition: "zoom_into", items: [{ text: "now", at: 4.6 }] }
  ]);
  assert.ok(timeline.scenes[0].value === "10x");
  assert.equal(timeline.scenes[1].attribution, "");
  const result = lintTimeline(timeline);
  assert.equal(result.failures.length, 0, result.failures.join("; "));
});

test("chapters validate: bounds and count", () => {
  const good = validateTimeline({
    version: MOTION_TIMELINE_VERSION, duration_seconds: 10, base: { type: "placeholder", src: "" }, words,
    scenes: [{ id: "a", type: "typography", start: 0, end: 10, items: [{ text: "x", at: 0.3 }, { text: "y", at: 0.9 }, { text: "z", at: 1.5 }, { text: "w", at: 4.0 }, { text: "v", at: 4.6 }] }],
    chapters: [{ title: "Intro", at: 0 }, { title: "Deep dive into everything", at: 5 }], events: []
  });
  assert.equal(good.ok, true, good.errors.join("; "));
  assert.equal(good.timeline.chapters[1].title.length <= 18, true);
  const bad = validateTimeline({
    version: MOTION_TIMELINE_VERSION, duration_seconds: 10, base: { type: "placeholder", src: "" }, words,
    scenes: [], chapters: [{ title: "Solo", at: 0 }], events: []
  });
  assert.ok(bad.errors.some((error) => error.includes("at least 2")));
});

test("lint requires requested chapters to exist", () => {
  const timeline = makeTimeline([
    { id: "a", type: "typography", start: 0, end: 6, transition: "cut", items: [{ text: "x", at: 0.3 }, { text: "y", at: 0.9 }, { text: "z", at: 1.5 }, { text: "w", at: 4.0 }, { text: "v", at: 4.6 }] }
  ]);
  const result = lintTimeline(timeline, { direction: { must_include: [], asset_refs: [], chapters: ["One", "Two", "Three"] } });
  assert.ok(result.failures.some((failure) => failure.includes("chapter rail")));
});

test("overlay layout validates for talking_head", () => {
  const result = validateTimeline({
    version: MOTION_TIMELINE_VERSION, duration_seconds: 5, base: { type: "placeholder", src: "" }, words,
    scenes: [{ id: "a", type: "talking_head", start: 0, end: 5, src: "base/take.mp4", layout: "overlay", items: [{ text: "yo", at: 0.3 }, { text: "hey", at: 0.9 }, { text: "go", at: 1.5 }, { text: "do", at: 4.0 }] }], events: []
  });
  assert.equal(result.ok, true, result.errors.join("; "));
});

test("golden timeline passes the linter", async () => {
  const raw = JSON.parse(await readFile(new URL("../examples/motion/golden-timeline.json", import.meta.url), "utf8"));
  const validated = validateTimeline(raw);
  assert.equal(validated.ok, true);
  const result = lintTimeline(validated.timeline);
  assert.equal(result.failures.length, 0, result.failures.join("; "));
});

test("direct record mode writes script and waits for a take without an LLM key", async () => {
  const temp = await makeDirectWorkspace();
  try {
    const result = await runDirect(temp, { voice: "record", prompt: "your demo passes", "no-render": true });
    assert.equal(result.status, "awaiting_take");
    assert.match(result.next, /--take/);
    const script = JSON.parse(await readFile(result.script, "utf8"));
    const voiceover = JSON.parse(await readFile(result.voiceover, "utf8"));
    const teleprompter = await readFile(result.teleprompter, "utf8");
    assert.ok(script.word_count >= 130);
    assert.equal(voiceover.segments[0].beat, "hook");
    assert.match(teleprompter, /Teleprompter/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

async function makeDirectWorkspace() {
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-direct-"));
  await mkdir(path.join(temp, "demo"), { recursive: true });
  await writeFile(
    path.join(temp, "launchclip.json"),
    `${JSON.stringify({
      source_repo: {
        name: "sample-tool",
        summary: "proves launchclip can create a grounded launch packet from a local OSS repo"
      }
    })}\n`
  );
  await writeFile(path.join(temp, "demo", "terminal.txt"), "$ npm run smoke\n\nsample-tool smoke passed\n");
  await writeFile(
    path.join(temp, "demo", "command-receipt.json"),
    `${JSON.stringify({ command: "npm run smoke", status: "passed", artifacts: [{ type: "terminal", path: "demo/terminal.txt" }] })}\n`
  );
  return temp;
}
