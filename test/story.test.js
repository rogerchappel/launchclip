import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runCli } from "../src/cli.js";
import { parseDeclaredSequenceBoundaries } from "../src/cinematic_evidence.js";
import * as storyApi from "../src/story.js";
import { STORY_SCHEMA, deriveBoundaries, parseAnchor, resolveAnchor, resolveStory, storyFormat, storyHits, validateStory } from "../kit/core/story.mjs";
import { buildEditorialModule } from "../skills/launchclip-create-video/scripts/editorial-ui-modules.mjs";

const root = path.resolve(import.meta.dirname, "..");
const goldenPath = path.join(root, "examples/story/cooling.story.json");
const narrationPath = path.join(root, "examples/story/cooling.NARRATION.json");

const words = [
  { text: "Hot", start: 0.1, end: 0.4 },
  { text: "coffee", start: 0.5, end: 0.9 },
  { text: "cools", start: 1.0, end: 1.3 },
  { text: "FAST,", start: 1.4, end: 1.7 },
  { text: "thirty", start: 2.0, end: 2.3 },
  { text: "five", start: 2.4, end: 2.6 },
  { text: "then", start: 3.0, end: 3.2 },
  { text: "thirty-five.", start: 3.5, end: 3.9 },
  { text: "Newton's", start: 4.2, end: 4.6 },
  { text: "fast!", start: 5.0, end: 5.3 }
];
const beats = { beats: [0, 0.6, 1.2, 1.8, 2.4, 3.0, 3.6, 4.2, 4.8], downbeats: [0, 2.4, 4.8] };

function baseStory(overrides = {}) {
  return {
    schema: STORY_SCHEMA,
    lane: "motion",
    format: { width: 1080, height: 1920, fps: 30, duration: 10 },
    brand: { colors: { bg: "#06070d", primary: "#fdb022" }, fonts: { display: "anton", body: "space-grotesk" } },
    scenes: [
      { id: "s1", module: "hook-title", start: 0, end: 4, energy: 1, params: { headline: "Hi" } },
      { id: "s2", module: "metric", start: 4, end: 10, energy: 2, in: { type: "push", dur: 0.4 } }
    ],
    overlays: [{ type: "captions", style: "word-highlight" }],
    ending: { loop_to: "s1" },
    ...overrides
  };
}

test("src/story.js re-exports the kit core", () => {
  assert.equal(storyApi.validateStory, validateStory);
  assert.equal(storyApi.resolveStory, resolveStory);
  assert.equal(storyApi.STORY_SCHEMA, "launchclip.story.v1");
});

test("kit/core/story.mjs has no imports", async () => {
  const source = await readFile(path.join(root, "kit/core/story.mjs"), "utf8");
  assert.doesNotMatch(source, /^\s*import\s/m);
  assert.doesNotMatch(source, /\bimport\(/);
  assert.doesNotMatch(source, /\brequire\(/);
});

test("a minimal valid story passes", () => {
  assert.deepEqual(validateStory(baseStory()), { ok: true, errors: [], warnings: [] });
});

test("validation reports human-readable errors with paths", () => {
  const story = baseStory({
    schema: "launchclip.story.v2",
    lane: "documentary",
    format: { width: 1000, height: 1000.5, fps: 0, duration: -1 },
    brand: { colors: { bg: "#123" }, fonts: { display: "" } },
    overlays: [{ type: "captions", style: "karaoke" }],
    ending: { loop_to: "nope" },
    scenes: [
      { id: "s1", module: "hook-title", start: 0, end: 4, energy: 5 },
      { id: "s1", module: "metric", start: 5, end: 4, in: { type: "spin", dur: 0 } },
      { id: "s3", module: "Bad Module", start: "word:", end: "beat:x", hits: [{ at: "later", event: "" }] }
    ]
  });
  const { ok, errors } = validateStory(story);
  assert.equal(ok, false);
  const expect = [
    /schema launchclip\.story\.v2 is not supported/,
    /^lane must be one of motion, voiceover-motion, footage-led/,
    /^format\.height must be a positive integer/,
    /^format\.fps must be/,
    /^format\.duration must be a positive number/,
    /^brand\.colors\.bg must be a six-digit hex color/,
    /^brand\.fonts\.display must be a non-empty/,
    /^scenes\[0\]\.energy must be 0, 1, 2, 3 or "build"/,
    /^scenes\[1\]\.id "s1" duplicates scenes\[0\]\.id/,
    /^scenes\[1\]\.start must be before scenes\[1\]\.end/,
    /^scenes\[1\]\.in\.type must be one of cut, fade, push, whip, zoom, iris, morph/,
    /^scenes\[1\]\.in\.dur must be a positive number/,
    /^scenes\[2\]\.module must be a catalogue module id/,
    /^scenes\[2\]\.start must be seconds or a time anchor/,
    /^scenes\[2\]\.end must be seconds or a time anchor/,
    /^scenes\[2\]\.hits\[0\]\.at must be seconds or a time anchor/,
    /^scenes\[2\]\.hits\[0\]\.event must be a non-empty string/,
    /^overlays\[0\]\.style must be one of word-highlight, line, none/,
    /^ending\.loop_to must reference a scene id/
  ];
  for (const pattern of expect) assert.ok(errors.some((entry) => pattern.test(entry)), `missing ${pattern}\n${errors.join("\n")}`);
});

test("validation rejects unsupported aspects and out-of-range scenes", () => {
  const story = baseStory({ format: { width: 1000, height: 700, fps: 30, duration: 8 } });
  const { errors } = validateStory(story);
  assert.ok(errors.some((entry) => /format aspect 1000x700 is not supported/.test(entry)));
  assert.ok(errors.some((entry) => /scenes\[1\]\.end \(10\) is beyond format\.duration \(8\)/.test(entry)));
  for (const [width, height] of [[1080, 1920], [1920, 1080], [1080, 1080], [1080, 1350]]) {
    assert.equal(validateStory(baseStory({ format: { width, height, fps: 30, duration: 10 } })).ok, true, `${width}x${height}`);
  }
});

test("validation forbids same-track overlaps but allows other tracks", () => {
  const overlapping = baseStory();
  overlapping.scenes[1].start = 3.5;
  assert.match(validateStory(overlapping).errors.join("\n"), /scenes\[1\] \(s2\) overlaps scenes\[0\] \(s1\) on track 0/);
  overlapping.scenes[1].track = 1;
  assert.equal(validateStory(overlapping).ok, true);
});

test("validation checks transitions against the scene length and from_object", () => {
  const story = baseStory();
  story.scenes[1].in = { type: "zoom", dur: 6 };
  assert.match(validateStory(story).errors.join("\n"), /scenes\[1\]\.in\.dur \(6\) must be shorter than the scene \(6s\)/);
  story.scenes[1].in = { type: "zoom", dur: 0.5, from_object: "s9.gap" };
  assert.match(validateStory(story).errors.join("\n"), /scenes\[1\]\.in\.from_object references unknown scene "s9"/);
  story.scenes[1].in = { type: "zoom", dur: 0.5, from_object: "s2.gap" };
  assert.match(validateStory(story).errors.join("\n"), /must reference an earlier scene/);
  story.scenes[0].in = { type: "fade", dur: 0.5, from_object: "s2.gap" };
  story.scenes[1].in = { type: "zoom", dur: 0.5, from_object: "s1.gap-bracket" };
  const result = validateStory(story);
  assert.match(result.errors.join("\n"), /scenes\[0\]\.in\.from_object must reference an earlier scene; "s2" does not come before scenes\[0\] \(s1\)/);
  assert.ok(!result.errors.some((entry) => entry.startsWith("scenes[1].in")));
  story.scenes[1].in = { type: "push", dur: 0.5, direction: "diagonal" };
  assert.match(validateStory(story).errors.join("\n"), /scenes\[1\]\.in\.direction must be one of left, right, up, down/);
});

test("validation enforces lanes, assets, params and the modules registry", () => {
  const voiceover = baseStory({ lane: "voiceover-motion" });
  assert.match(validateStory(voiceover).errors.join("\n"), /audio\.voice is required for the voiceover-motion lane/);
  voiceover.audio = { voice: "/tmp/narration.wav", words: "../NARRATION.json" };
  const errors = validateStory(voiceover).errors.join("\n");
  assert.match(errors, /audio\.voice must be a project-relative path/);
  assert.match(errors, /audio\.words must be a project-relative path/);
  voiceover.audio = { voice: "assets/audio/narration.wav", words: "NARRATION.json", music: { source: "synth", bpm: 100 }, sfx: "auto" };
  assert.equal(validateStory(voiceover).ok, true);

  assert.match(validateStory(baseStory({ lane: "footage-led" })).errors.join("\n"), /base is required for the footage-led lane/);

  const story = baseStory();
  story.scenes[1].params = { id: "x", start: 1, title: "ok" };
  assert.match(validateStory(story).errors.join("\n"), /scenes\[1\]\.params\.id is not allowed/);
  delete story.scenes[1].params;
  assert.equal(validateStory(story, { modules: ["hook-title", "metric"] }).ok, true);
  assert.match(validateStory(story, { modules: new Set(["metric"]) }).errors.join("\n"), /scenes\[0\]\.module "hook-title" is not a known module/);
});

test("custom modules need a project-relative source and warn", () => {
  const story = baseStory();
  story.scenes[0] = { id: "s1", module: "custom", start: 0, end: 4 };
  assert.match(validateStory(story).errors.join("\n"), /scenes\[0\]\.source is required for a custom module/);
  story.scenes[0].source = "../outside.tsx";
  assert.match(validateStory(story).errors.join("\n"), /scenes\[0\]\.source must be a project-relative path/);
  story.scenes[0].source = "modules/thermal-hero.tsx";
  const result = validateStory(story, { modules: ["metric"] });
  assert.equal(result.ok, true);
  assert.match(result.warnings.join("\n"), /scenes\[0\] \(s1\) uses a custom module \(modules\/thermal-hero\.tsx\)/);
  story.scenes[1].source = "x.tsx";
  assert.match(validateStory(story).errors.join("\n"), /scenes\[1\]\.source is only allowed with module "custom"/);
});

test("anchors parse with occurrences and offsets", () => {
  assert.deepEqual(parseAnchor("word:Fast#2+0.12"), { kind: "word", text: "fast", occurrence: 2, offset: 0.12 });
  assert.deepEqual(parseAnchor("word:thirty-five-0.1"), { kind: "word", text: "thirty-five", occurrence: 1, offset: -0.1 });
  assert.deepEqual(parseAnchor("beat:4"), { kind: "beat", index: 4, offset: 0 });
  assert.deepEqual(parseAnchor("downbeat:1+.05"), { kind: "downbeat", index: 1, offset: 0.05 });
  assert.deepEqual(parseAnchor(2.5), { kind: "seconds", seconds: 2.5 });
  assert.deepEqual(parseAnchor("2.5"), { kind: "seconds", seconds: 2.5 });
  for (const bad of ["word:", "word:#2", "word:fast#0", "beat:", "beat:-1", "bar:2", "later", null, {}]) assert.equal(parseAnchor(bad), null, String(bad));
});

test("word anchors are case-insensitive, punctuation-free and occurrence-aware", () => {
  const context = { words, beats };
  assert.equal(resolveAnchor("word:fast", context), 1.4);
  assert.equal(resolveAnchor("word:FAST#2", context), 5.0);
  assert.equal(resolveAnchor("word:newtons", context), 4.2);
  assert.equal(resolveAnchor("word:newton's", context), 4.2);
  assert.equal(resolveAnchor("word:fast+0.1", context), 1.5);
  assert.equal(resolveAnchor("word:fast#2-0.25", context), 4.75);
  assert.equal(resolveAnchor(3, context), 3);
  assert.throws(() => resolveAnchor("word:fast#3", context), /occurs 2 times/);
  assert.throws(() => resolveAnchor("word:slow", context), /Unknown anchor word:slow/);
  assert.throws(() => resolveAnchor("soon", context), /Invalid time anchor/);
});

test("hyphenated anchors match a single token or consecutive tokens", () => {
  const context = { words };
  assert.equal(resolveAnchor("word:thirty-five", context), 2.0);
  assert.equal(resolveAnchor("word:thirty-five#2", context), 3.5);
  assert.equal(resolveAnchor("word:five", context), 2.4);
  assert.throws(() => resolveAnchor("word:five#2", context), /occurs 1 time/);
  assert.equal(resolveAnchor("word:coffee", { words: { words } }), 0.5);
});

test("beat and downbeat anchors resolve from BEATS.json", () => {
  assert.equal(resolveAnchor("beat:0", { beats }), 0);
  assert.equal(resolveAnchor("beat:3", { beats }), 1.8);
  assert.equal(resolveAnchor("beat:3+0.05", { beats }), 1.85);
  assert.equal(resolveAnchor("downbeat:1", { beats }), 2.4);
  assert.equal(resolveAnchor("downbeat:2", { beats: { beats: beats.beats } }), 4.8);
  assert.throws(() => resolveAnchor("beat:99", { beats }), /only 9 beats available/);
  assert.throws(() => resolveAnchor("beat:1", { beats: null }), /no beats/);
});

test("resolveStory replaces anchors, sorts scenes and adds resolved metadata", () => {
  const story = baseStory();
  story.scenes = [
    { id: "s2", module: "metric", start: "word:thirty-five#2", end: 10, in: { type: "zoom", dur: 0.5, from_object: "s1.gap" }, hits: [{ at: "beat:7", event: "bar" }, { at: "word:fast#2", event: "pop", cue: "tick" }] },
    { id: "s1", module: "hook-title", start: 0, end: "word:thirty-five#2", hits: [{ at: "word:fast+0.1", event: "plunge" }] }
  ];
  story.overlays = [{ type: "captions", style: "line", start: "downbeat:0", end: "beat:8" }];
  assert.equal(validateStory(story).ok, true);
  const before = JSON.stringify(story);
  const resolved = resolveStory(story, { words, beats });
  assert.equal(JSON.stringify(story), before, "input is not mutated");
  assert.deepEqual(resolved.scenes.map((scene) => [scene.id, scene.start, scene.end]), [["s1", 0, 3.5], ["s2", 3.5, 10]]);
  assert.deepEqual(resolved.overlays[0], { type: "captions", style: "line", start: 0, end: 4.8 });
  assert.deepEqual(resolved.resolved, { duration: 10, fps: 30, frames: 300 });
  assert.equal(validateStory(resolved).ok, true);
  assert.deepEqual(storyHits(resolved), [
    { scene_id: "s1", at: 1.5, event: "plunge" },
    { scene_id: "s2", at: 4.2, event: "bar" },
    { scene_id: "s2", at: 5, event: "pop", cue: "tick" }
  ]);
  assert.deepEqual(storyFormat(resolved), { duration: 10, width: 1080, height: 1920, fps: 30 });
  assert.throws(() => resolveStory(story, { words: [] , beats }), /scenes\[0\]\.start: Unknown anchor word:thirty-five#2/);
});

test("deriveBoundaries matches the declared-boundary shape and kinds", () => {
  const story = baseStory({ format: { width: 1920, height: 1080, fps: 30, duration: 12 } });
  story.scenes = [
    { id: "s1", module: "hook-title", start: 0, end: 4 },
    { id: "s2", module: "metric", start: 4, end: 8, in: { type: "push", dur: 0.4, direction: "left" } },
    { id: "s3", module: "callout", start: 8, end: 12, in: { type: "morph", dur: 0.5 } },
    { id: "badge", module: "callout", start: 5, end: 7, track: 1, in: { type: "fade", dur: 0.3, from_object: "s1.logo" } }
  ];
  story.ending = { loop_to: "s1", in: { type: "fade", dur: 0.4 } };
  const result = validateStory(story);
  assert.equal(result.ok, true, result.errors.join("\n"));
  const boundaries = deriveBoundaries(resolveStory(story));
  assert.deepEqual(boundaries, [
    { boundary_id: "s2-in", sequence_id: null, kind: "ordinary", start_seconds: 4, duration_seconds: 0.4, from_id: "s1", to_id: "s2" },
    { boundary_id: "badge-in", sequence_id: "s1", kind: "shared-world", start_seconds: 5, duration_seconds: 0.3, from_id: "s2", to_id: "badge" },
    { boundary_id: "s3-in", sequence_id: null, kind: "shared-world", start_seconds: 8, duration_seconds: 0.5, from_id: "s2", to_id: "s3" },
    { boundary_id: "s1-in", sequence_id: null, kind: "ordinary", start_seconds: 11.6, duration_seconds: 0.4, from_id: "s3", to_id: "s1" }
  ]);
  // Same keys as parseDeclaredSequenceBoundaries() produces from HTML.
  const html = boundaries.map((entry) => `<div data-launchclip-transition-start="${entry.start_seconds}" data-launchclip-transition-duration="${entry.duration_seconds}" data-launchclip-boundary-id="${entry.boundary_id}" data-launchclip-transition-kind="${entry.kind}" data-launchclip-transition-from="${entry.from_id}" data-launchclip-transition-to="${entry.to_id}"${entry.sequence_id ? ` data-launchclip-sequence-id="${entry.sequence_id}"` : ""}></div>`).join("");
  const parsed = parseDeclaredSequenceBoundaries(html, 12);
  assert.equal(parsed.ok, true, parsed.errors.join("\n"));
  assert.deepEqual(parsed.boundaries.map((entry) => ({ ...entry, sequence_id: entry.sequence_id ?? null })), boundaries);
  assert.throws(() => deriveBoundaries(baseStory({ scenes: [{ id: "s1", module: "metric", start: "word:fast", end: 2 }] })), /needs a resolved story/);
});

test("ending.in may not collide with the loop target's own boundary", () => {
  const story = baseStory({ ending: { loop_to: "s2", in: { type: "fade", dur: 0.4 } } });
  assert.match(validateStory(story).errors.join("\n"), /ending\.in conflicts with scenes\[1\]\.in/);
});

test("the cooling golden story validates, resolves and derives five boundaries", async () => {
  const story = JSON.parse(await readFile(goldenPath, "utf8"));
  const narration = JSON.parse(await readFile(narrationPath, "utf8"));
  assert.deepEqual(validateStory(story), { ok: true, errors: [], warnings: [] });
  assert.deepEqual(storyFormat(story), { duration: 29.5, width: 1080, height: 1920, fps: 30 });
  assert.equal(story.scenes.length, 5);
  const resolved = resolveStory(story, { words: narration.words });
  assert.equal(validateStory(resolved).ok, true);
  assert.deepEqual(resolved.resolved, { duration: 29.5, fps: 30, frames: 885 });
  const boundaries = deriveBoundaries(resolved);
  assert.equal(boundaries.length, 5);
  assert.ok(boundaries.some((entry) => entry.kind === "shared-world"));
  assert.deepEqual(boundaries.map((entry) => entry.boundary_id), ["s2-in", "s3-in", "s4-in", "s5-in", "s1-in"]);
  assert.equal(parseDeclaredSequenceBoundaries(boundaries.map((entry) => `<i data-launchclip-transition-start="${entry.start_seconds}" data-launchclip-transition-duration="${entry.duration_seconds}" data-launchclip-boundary-id="${entry.boundary_id}" data-launchclip-transition-kind="${entry.kind}"></i>`).join(""), 29.5).ok, true);
  assert.deepEqual(resolved.overlays, [{ type: "captions", style: "word-highlight" }]);
  assert.equal(resolved.ending.loop_to, "s1");
  const hits = storyHits(resolved);
  assert.ok(hits.length >= 10);
  for (const hit of hits) {
    const scene = resolved.scenes.find((entry) => entry.id === hit.scene_id);
    assert.ok(hit.at >= scene.start && hit.at <= scene.end, `${hit.event} at ${hit.at} inside ${scene.id}`);
  }
  // Editorial params are the editorial spec minus id/kind/aspect/start/duration.
  for (const scene of resolved.scenes.filter((entry) => ["metric", "growth-chart", "callout", "checklist", "step-rail"].includes(entry.module))) {
    assert.doesNotThrow(() => buildEditorialModule({ id: scene.id, kind: scene.module, aspect: "9:16", start: scene.start, duration: scene.end - scene.start, ...scene.params }), scene.id);
  }
});

test("CLI validates and resolves stories", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "launchclip-story-"));
  try {
    const capture = () => {
      const chunks = [];
      return { stdout: { write: (value) => chunks.push(value) }, read: () => JSON.parse(chunks.join("")) };
    };
    let io = capture();
    await runCli(["story", "validate", goldenPath, "--narration", narrationPath], io);
    let output = io.read();
    assert.equal(output.stage, "story");
    assert.equal(output.status, "passed");
    assert.equal(output.anchors_resolved, true);
    assert.equal(output.boundaries.length, 5);

    const out = path.join(directory, "story.resolved.json");
    io = capture();
    await runCli(["story", "resolve", goldenPath, "--out", out], io);
    output = io.read();
    assert.equal(output.status, "resolved");
    assert.equal(output.narration, narrationPath, "audio.words is found next to the story");
    assert.equal(output.boundaries.length, 5);
    const written = JSON.parse(await readFile(out, "utf8"));
    assert.equal(written.resolved.frames, 885);
    assert.equal(typeof written.scenes[0].hits[0].at, "number");

    const broken = path.join(directory, "broken.story.json");
    const story = baseStory();
    story.scenes[1].in.type = "spin";
    await writeFile(broken, JSON.stringify(story));
    io = capture();
    await runCli(["story", "validate", broken], io);
    output = io.read();
    assert.equal(output.status, "failed");
    assert.match(output.errors.join("\n"), /scenes\[1\]\.in\.type/);
    await assert.rejects(runCli(["story", "resolve", broken], capture()), /story\.json is invalid/);
    await assert.rejects(runCli(["story", "explode", broken], capture()), /Unknown story action/);
    await assert.rejects(runCli(["story", "validate"], capture()), /Missing story\.json path/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("audio.narration is validated and defers the voice, words and word anchors", () => {
  const story = baseStory({ lane: "voiceover-motion", audio: { narration: { text: "Hot coffee cools fast.", provider: "kokoro", voice: "af_heart", speed: 1.2 } } });
  story.scenes[1].start = "word:fast";
  story.scenes[0].end = "word:fast";
  const result = validateStory(story);
  assert.deepEqual(result.errors, []);
  assert.ok(!result.warnings.some((entry) => /word anchors are used/.test(entry)));

  const bad = baseStory({ audio: { narration: { text: "", provider: "say", voice: "", speed: 3 } } });
  const errors = validateStory(bad).errors.join("\n");
  assert.match(errors, /audio\.narration\.text must be a non-empty string/);
  assert.match(errors, /audio\.narration\.provider must be one of kokoro, elevenlabs, supplied, test/);
  assert.match(errors, /audio\.narration\.voice must be a non-empty string/);
  assert.match(errors, /audio\.narration\.speed must be a number between 0\.5 and 2/);
  assert.match(validateStory(baseStory({ audio: { narration: { text: "x".repeat(4001) } } })).errors.join("\n"), /at most 4000 characters/);
  assert.match(validateStory(baseStory({ audio: { narration: "hello" } })).errors.join("\n"), /audio\.narration must be an object/);
  assert.equal(validateStory(baseStory({ audio: { narration: { text: "x".repeat(4000), speed: 0.5 } } })).ok, true);
});

test("audio.music accepts synth, none, a file or a provider object with prompt, bpm and sync", () => {
  const ok = (music) => assert.deepEqual(validateStory(baseStory({ audio: { music } })).errors, [], JSON.stringify(music));
  ok("synth");
  ok("none");
  ok("assets/audio/song.mp3");
  ok({ source: "synth", bpm: 100, key: "A" });
  ok({ provider: "elevenlabs", prompt: "Warm lo-fi house", bpm: 104, sync: "cuts", seed: 7, model: "music_v1", volume: 0.3 });
  ok({ provider: "file", file: "assets/audio/song.mp3", sync: "off" });
  ok({ bpm: 96 });
  const errors = (music) => validateStory(baseStory({ audio: { music } })).errors.join("\n");
  assert.match(errors({ provider: "suno" }), /audio\.music\.provider must be one of synth, elevenlabs, file/);
  assert.match(errors({ provider: "file" }), /needs audio\.music\.file/);
  assert.match(errors({ provider: "elevenlabs", file: "assets/audio/song.mp3" }), /only used with provider "file"/);
  assert.match(errors({ file: "/etc/song.mp3" }), /audio\.music\.file must be a project-relative path/);
  assert.match(errors({ sync: "always" }), /audio\.music\.sync must be one of auto, off, cuts, hits/);
  assert.match(errors({ prompt: "" }), /audio\.music\.prompt must be a non-empty string/);
  assert.match(errors({ prompt: "x".repeat(2001) }), /at most 2000 characters/);
  assert.match(errors({ seed: -1 }), /audio\.music\.seed must be a non-negative integer/);
  assert.match(errors({ bpm: 400 }), /audio\.music\.bpm must be a number between 1 and 300/);
  const warnings = validateStory(baseStory({ audio: { music: { provider: "synth", prompt: "x", tempo: 3 } } })).warnings.join("\n");
  assert.match(warnings, /audio\.music\.prompt is only used by the elevenlabs provider/);
  assert.match(warnings, /audio\.music\.tempo is not a music field/);
});

test("story validate fails a scene whose module params would render a placeholder", async () => {
  // Regression: a process-steps hit 0.2 s into the scene passed validate with
  // zero warnings, then both compilers drew the "Missing module" placeholder.
  const directory = await mkdtemp(path.join(os.tmpdir(), "launchclip-story-params-"));
  try {
    const story = {
      schema: STORY_SCHEMA, lane: "motion",
      format: { width: 1920, height: 1080, fps: 30, duration: 6 },
      brand: { colors: { bg: "#0b1020", primary: "#ffb547", accent: "#4fd1c5", ink: "#0b1020", paper: "#f4f1ea" }, fonts: { display: "anton", body: "space-grotesk", meta: "jetbrains-mono" } },
      scenes: [{ id: "s1", module: "process-steps", start: 0, end: 6, params: { steps: ["Connect", "Pick", "Publish"] }, hits: [{ at: 0.2, event: "step-0" }] }]
    };
    const file = path.join(directory, "storyboard.json");
    await writeFile(file, JSON.stringify(story));
    const chunks = [];
    await runCli(["story", "validate", file], { stdout: { write: (value) => chunks.push(value) } });
    const output = JSON.parse(chunks.join(""));
    assert.equal(output.status, "failed");
    assert.match(output.errors.join("\n"), /scenes\[0\] \(s1\): module "process-steps" params: .*step-0.*placeholder/);

    story.scenes[0].hits[0].at = 0.8;
    await writeFile(file, JSON.stringify(story));
    chunks.length = 0;
    await runCli(["story", "validate", file], { stdout: { write: (value) => chunks.push(value) } });
    assert.deepEqual(JSON.parse(chunks.join("")).errors, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
