import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveStory } from "@launchclip/core/story.mjs";
import { DEFAULT_BRAND } from "@launchclip/core/planning-prompt.mjs";
import { checkConstraints, constraintsPrompt, enforceHiddenLines, fillConstraints, hiddenExposure, neverUseMatcher, parseConstraints, storyMediaRefs } from "../src/constraints.js";
import { planStoryboard } from "../src/storyboard_planner.js";
import { runStoryCommand } from "../src/story_cli.js";

// A 12 s footage-led story: four lines of three words each.
const WORDS = [
  ["Slide-on", 0.2], ["campers", 0.7], ["ride.", 1.2],
  ["Corrugations", 3.0], ["shake", 3.6], ["caravans.", 4.0],
  ["Weight", 5.4], ["sits", 6.0], ["low.", 6.6],
  ["See", 9.0], ["the", 9.4], ["build.", 9.8]
].map(([text, start]) => ({ text, start, end: start + 0.45 }));
const FORMAT = { width: 1080, height: 1920, fps: 30, duration: 12 };

function footageStory(scenes = []) {
  return {
    schema: "launchclip.story.v1",
    lane: "footage-led",
    format: FORMAT,
    brand: DEFAULT_BRAND,
    audio: { words: "NARRATION.json" },
    base: { src: "assets/base.mp4", fit: "cover" },
    scenes,
    overlays: [{ type: "captions" }]
  };
}

const map = (treatments) => ({
  schema: "launchclip.direction-map.v1",
  profile: "short-talking-head",
  sections: [{ id: "s1", lines: [
    { words: [0, 2], intent: "hook", ...treatments[0] },
    { words: [3, 5], intent: "problem", ...treatments[1] },
    { words: [6, 8], intent: "claim", ...treatments[2] },
    { words: [9, 11], intent: "cta", ...treatments[3] }
  ] }]
});
const FACE = { treatment: "face", why: "on the presenter" };

const CONSTRAINTS = parseConstraints({
  version: 1,
  ranges: [{ start: 3.0, end: 6.0, picture: "hidden", reason: "voiceover_only" }],
  media: { must_use: [{ src: "broll/pinned.mp4", reason: "pinned" }], never_use: ["broll/banned.mp4", { id: "lib-9", reason: "licence" }] }
}).constraints;

const MEDIA = [
  { src: "assets/broll/pinned.mp4", kind: "video", duration: 8, width: 1080, height: 1920, notes: { description: "Camper on a corrugated track", tags: ["corrugations", "track"], windows: [{ start: 1, end: 6, quality: 0.9 }] } },
  { src: "assets/broll/beach.mp4", kind: "video", duration: 10, width: 1920, height: 1080, notes: { description: "Ute on the beach at sunset", subjects: ["beach"], quality: 0.7 } }
];

test("parseConstraints normalises paths and lists, merges ranges and reports every mistake", () => {
  const parsed = parseConstraints({ version: 1, ranges: [{ start: 2, end: 4, picture: "hidden" }, { start: 3.5, end: 5, picture: "hidden", reason: "b" }], media: { must_use: ["./assets/a.mp4", "a.mp4"], never_use: [{ src: "b.png" }, { id: "x1" }] } });
  assert.equal(parsed.ok, true, parsed.errors.join("\n"));
  assert.deepEqual(parsed.constraints.ranges, [{ start: 2, end: 5, picture: "hidden", reason: "b" }]);
  assert.deepEqual(parsed.constraints.must_use, [{ src: "a.mp4" }]);
  assert.deepEqual(parsed.constraints.never_use, [{ src: "b.png" }, { id: "x1" }]);

  const bad = parseConstraints({ version: 2, ranges: [{ start: 5, end: 4, picture: "hidden" }, { start: 1, end: 2, picture: "blurred" }], media: { must_use: ["../x.mp4", "music.mp3", "c.mp4"], never_use: ["c.mp4"], always: [] }, extra: true });
  assert.equal(bad.ok, false);
  const text = bad.errors.join("\n");
  for (const pattern of [/version must be 1/, /unknown field "extra"/, /ranges\[0\]\.end must be seconds after start/, /ranges\[1\]\.picture must be "hidden"/, /must_use\[0\]\.src must be a path under the assets folder/, /music\.mp3 is not an image or video/, /media has unknown field "always"/, /c\.mp4 is in both media\.must_use and media\.never_use/]) assert.match(text, pattern);
});

test("checkConstraints: an exposed hidden range, a face line over it, a missing must_use and a never_use file are errors", () => {
  const story = footageStory([{ id: "beach", module: "photo-scene", insert: true, start: 3.4, end: 5.0, params: { media: { src: "assets/broll/banned.mp4", kind: "video" } } }]);
  const resolved = resolveStory(structuredClone(story), { words: WORDS });
  const result = checkConstraints(resolved, CONSTRAINTS, { map: map([FACE, FACE, FACE, FACE]), words: WORDS });
  assert.equal(result.ok, false);
  const text = result.errors.join("\n");
  assert.match(text, /hidden range 3–6 s \(voiceover_only\) shows the base picture at 3–3\.4 s, 5–6 s/);
  assert.match(text, /direction line words \[3, 5\] .* overlaps the hidden range 3–6 s .* but is "face"/);
  assert.match(text, /direction line words \[6, 8\] .* but is "face"/);
  assert.doesNotMatch(text, /words \[0, 2\]/);
  assert.match(text, /must_use assets\/broll\/pinned\.mp4 \(pinned\) does not appear/);
  assert.match(text, /never_use assets\/broll\/banned\.mp4 appears at scenes\[0\]\.params\.media\.src/);
  assert.deepEqual(result.summary, { ranges: 1, exposed: 1, must_use: 1, missing: ["broll/pinned.mp4"], never_use: 2, present: ["broll/banned.mp4"] });
});

test("hidden ranges: inserts and insert sections cover them; a fade in from the base does not", () => {
  const covered = footageStory([
    { id: "a", module: "photo-scene", insert: true, start: 2.5, end: 4.5, params: { media: { src: "assets/broll/pinned.mp4", kind: "video" } } },
    { id: "b", module: "photo-scene", insert: true, start: 4.5, end: 6.5, in: { type: "fade", dur: 0.3 }, params: { media: { src: "assets/broll/beach.mp4", kind: "video" } } }
  ]);
  const ok = hiddenExposure(resolveStory(structuredClone(covered), { words: WORDS }), CONSTRAINTS);
  assert.deepEqual(ok[0].gaps, [], "a fade between two inserts does not show the base");
  covered.scenes[1].start = 4.6;
  const gap = hiddenExposure(resolveStory(structuredClone(covered), { words: WORDS }), CONSTRAINTS);
  assert.deepEqual(gap[0].gaps.map(([a, b]) => [Math.round(a * 100) / 100, Math.round(b * 100) / 100]), [[4.5, 4.9]], "the gap and the fade from the base both show it");
  const section = { ...footageStory([]), sections: [{ id: "cover", start: 2.8, end: 6.2, layout: "insert" }] };
  assert.deepEqual(hiddenExposure(resolveStory(structuredClone(section), { words: WORDS }), CONSTRAINTS)[0].gaps, []);
});

test("enforceHiddenLines makes every line over a hidden range an insert line", () => {
  const { map: forced, changed } = enforceHiddenLines(map([FACE, FACE, { treatment: "dress", scenes: ["note"] }, FACE]), CONSTRAINTS, WORDS);
  const lines = forced.sections[0].lines;
  assert.deepEqual(lines.map((line) => line.treatment), ["face", "insert", "insert", "face"]);
  assert.deepEqual(lines[1].scenes, ["hidden-1"]);
  assert.deepEqual(lines[2].scenes, ["note"]);
  assert.deepEqual(changed.map((entry) => entry.from), ["face", "dress"]);
});

test("fillConstraints covers the hidden range with the best clip in its usable window and places must_use", () => {
  const story = footageStory([{ id: "hook", module: "emphasis-caption", track: 1, start: 0.2, end: 2.0, params: { text: "Built tough" } }]);
  const fill = fillConstraints(story, CONSTRAINTS, { words: WORDS, media: [...MEDIA, { src: "assets/broll/banned.mp4", kind: "video", duration: 9, notes: { tags: ["corrugations", "caravans", "weight"], quality: 1 } }] });
  assert.deepEqual(fill.errors, []);
  const hidden = fill.storyboard.scenes.find((scene) => scene.id === "hidden-1");
  assert.equal(hidden.insert, true);
  assert.equal(hidden.module, "photo-scene");
  assert.equal(hidden.params.media.src, "assets/broll/pinned.mp4", "the unplaced must_use clip that matches the line wins; never_use is never picked");
  assert.equal(hidden.params.media.sourceStart, 1, "its usable window sets the in point");
  assert.ok(hidden.start <= 2.6 && hidden.end >= 6.4, `padded past the range: ${hidden.start}–${hidden.end}`);
  assert.ok(!fill.storyboard.scenes.some((scene) => scene.id.startsWith("must-use")), "the pinned clip is already placed by the hidden fill");
  const resolved = resolveStory(structuredClone(fill.storyboard), { words: WORDS });
  assert.deepEqual(checkConstraints(resolved, CONSTRAINTS, { words: WORDS }).errors, []);
});

test("fillConstraints places a must_use clip on the free line it matches best", () => {
  const only = parseConstraints({ version: 1, media: { must_use: ["broll/beach.mp4"] } }).constraints;
  const story = footageStory([{ id: "first", module: "photo-scene", insert: true, start: 0, end: 2.5, params: { media: { src: "assets/broll/pinned.mp4", kind: "video" } } }]);
  const words = WORDS.map((word, index) => (index === 10 ? { ...word, text: "beach" } : word));
  const fill = fillConstraints(story, only, { words, media: MEDIA });
  const placed = fill.storyboard.scenes.find((scene) => scene.id === "must-use-1");
  assert.equal(placed.params.media.src, "assets/broll/beach.mp4");
  assert.ok(placed.start >= 8.8 && placed.start < 9.1, `on the line that mentions the beach: ${placed.start}`);
});

test("the planner honours hidden ranges and must_use when the model ignores them (deterministic pass)", async () => {
  const lazy = footageStory([{ id: "hook", module: "emphasis-caption", track: 1, start: 0.2, end: 2.0, params: { text: "Built tough" } }]);
  const calls = [];
  const client = {
    provider: "openai",
    async runStructured(request) {
      calls.push(request);
      if (request.schemaName === "launchclip_direction") return { value: { direction_json: JSON.stringify(map([{ treatment: "dress", scenes: ["hook"] }, FACE, FACE, FACE])) }, usage: {} };
      return { value: { storyboard_json: JSON.stringify(lazy) }, usage: {} };
    }
  };
  const report = await planStoryboard({ brief: "Why slide-on campers ride corrugations well.", words: WORDS, lane: "footage-led", format: FORMAT, audio: { words: "NARRATION.json" }, base: "assets/base.mp4", tier: "guided", client, direction: true, constraints: CONSTRAINTS, media: MEDIA, maxRepairs: 2 });
  assert.equal(report.status, "passed", report.errors.join("\n"));
  assert.equal(report.attempts.length, 1, "constraint errors alone are fixed by tooling, without a repair call");
  assert.match(calls[0].input, /## Constraints from the app/);
  assert.match(calls[1].instructions, /3–6 s picture hidden \(voiceover_only\): "Corrugations shake caravans\. Weight"/);
  assert.match(calls[1].instructions, /Use assets\/broll\/pinned\.mp4 \(pinned\)/);
  const lines = report.direction.sections[0].lines;
  assert.deepEqual(lines.map((line) => line.treatment), ["dress", "insert", "insert", "face"]);
  assert.deepEqual(lines[1].scenes, ["hidden-1"]);
  const resolved = resolveStory(structuredClone(report.storyboard), { words: WORDS });
  assert.deepEqual(checkConstraints(resolved, CONSTRAINTS, { map: report.direction, words: WORDS }).errors, []);
  assert.ok(report.warnings.some((entry) => /tooling added hidden-1/.test(entry)));
});

test("never_use matches story paths, files under the assets folder and provider ids", () => {
  const match = neverUseMatcher(CONSTRAINTS, { assetsDir: "/lib/assets" });
  assert.equal(match({ src: "assets/broll/banned.mp4" })?.src, "broll/banned.mp4");
  assert.equal(match({ file: "/lib/assets/broll/banned.mp4" })?.src, "broll/banned.mp4");
  assert.equal(match({ file: "/elsewhere/broll/banned.mp4" })?.src, "broll/banned.mp4");
  assert.equal(match({ source: { asset_id: "lib-9" } })?.id, "lib-9");
  assert.equal(match({ src: "assets/broll/beach.mp4" }), null);
  assert.deepEqual([...storyMediaRefs(footageStory([])).keys()], ["assets/base.mp4"]);
  assert.equal(constraintsPrompt(null), "");
});

test("story validate reports constraint violations from CONSTRAINTS.json or --constraints", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-constraints-"));
  try {
    await mkdir(path.join(dir, "assets"), { recursive: true });
    await writeFile(path.join(dir, "NARRATION.json"), JSON.stringify({ words: WORDS }));
    await writeFile(path.join(dir, "storyboard.json"), JSON.stringify(footageStory([{ id: "hook", module: "emphasis-caption", track: 1, start: 0.2, end: 2.0, params: { text: "Built tough" } }])));
    await writeFile(path.join(dir, "DIRECTION.json"), JSON.stringify(map([{ treatment: "dress", scenes: ["hook"] }, FACE, FACE, FACE])));
    const clean = await runStoryCommand("validate", path.join(dir, "storyboard.json"));
    assert.equal(clean.constraints, null);
    assert.ok(!clean.errors.some((entry) => entry.startsWith("constraints:")));
    await writeFile(path.join(dir, "CONSTRAINTS.json"), JSON.stringify({ version: 1, ranges: [{ start: 3, end: 6, picture: "hidden" }], media: { must_use: ["broll/pinned.mp4"] } }));
    const result = await runStoryCommand("validate", path.join(dir, "storyboard.json"));
    assert.equal(result.status, "failed");
    assert.match(result.errors.join("\n"), /constraints: hidden range 3–6 s shows the base picture/);
    assert.match(result.errors.join("\n"), /constraints: must_use assets\/broll\/pinned\.mp4 does not appear/);
    assert.equal(result.constraints.status, "failed");
    await writeFile(path.join(dir, "other.json"), JSON.stringify({ version: 1, media: { never_use: ["base.mp4"] } }));
    const flagged = await runStoryCommand("validate", path.join(dir, "storyboard.json"), { constraints: path.join(dir, "other.json") });
    assert.match(flagged.errors.join("\n"), /never_use assets\/base\.mp4 appears at base\.src/);
    assert.doesNotMatch(flagged.errors.join("\n"), /hidden range/);
    await writeFile(path.join(dir, "bad.json"), JSON.stringify({ version: 1, ranges: [{ start: 2, end: 1, picture: "hidden" }] }));
    const invalid = await runStoryCommand("validate", path.join(dir, "storyboard.json"), { constraints: path.join(dir, "bad.json") });
    assert.match(invalid.errors.join("\n"), /constraints: [^]*ranges\[0\]\.end must be seconds after start/);
    assert.ok(await readFile(path.join(dir, "CONSTRAINTS.json"), "utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("coverage forced up by hidden ranges is advisory in the coverage gate", async () => {
  const { coverageGate } = await import("../src/quality_gates.js");
  const profile = JSON.parse(await readFile(new URL("../kit/profiles/short-talking-head.json", import.meta.url), "utf8"));
  const story = footageStory([{ id: "all", module: "photo-scene", insert: true, start: 0, end: 12, params: { media: { src: "assets/broll/pinned.mp4", kind: "video" } } }]);
  const resolved = resolveStory(structuredClone(story), { words: WORDS });
  const plain = coverageGate({ resolved, words: WORDS, map: null, profile });
  assert.ok(plain.errors.some((entry) => /coverage/.test(entry)), plain.errors.join("\n"));
  const forced = coverageGate({ resolved, words: WORDS, map: null, profile, hidden: true });
  assert.ok(!forced.errors.some((entry) => /coverage|face/.test(entry)), forced.errors.join("\n"));
  assert.ok(forced.advisory.some((entry) => /coverage/.test(entry)));
});
