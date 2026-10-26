// The quality loop's gates (docs/VIDEO_QUALITY_RFC.md §11): coverage,
// direction and face against the cadence profile, the motion gate's profile
// bands, the critic rubric, and the prototype cut. Phase 7's done-when: a
// sparse draft fails coverage and gets missed-opportunity findings; a dressed
// one passes.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { cinematicMotionExpectations } from "../src/cinematic_check.js";
import { evaluateMotionQuality } from "../src/render_motion_analysis.js";
import { coverageGate, directionGate, faceGate, prototypeCut, prototypeScope, qualityFindings, readFaceData, toTimeline } from "../src/quality_gates.js";
import { CRITIC_CATEGORIES, MAKE_CRITIC_SCHEMA, runHeadlessCritic, toolingFindings } from "../src/make/critic.js";
import { shippedProfiles } from "../src/profile_store.js";
import { runStoryCommand } from "../src/story_cli.js";

const FOOTAGE = fileURLToPath(new URL("../examples/story/footage/", import.meta.url));
const profile = (id) => shippedProfiles().find((entry) => entry.id === id);
const resolved = async () => (await runStoryCommand("resolve", `${FOOTAGE}storyboard.json`)).story_resolved;
const words = async () => JSON.parse(await readFile(`${FOOTAGE}NARRATION.json`, "utf8")).words;
const map = async () => JSON.parse(await readFile(`${FOOTAGE}DIRECTION.json`, "utf8"));

// A launchclip.subject-track.v1 file for the footage base: head visible at the given seconds.
function track(frames) {
  const box = { x: 0.4, y: 0.2, w: 0.2, h: 0.2 };
  return JSON.stringify({
    schema: "launchclip.subject-track.v1", base: "assets/recording.mp4", model: "mediapipe-selfie", fps: 10,
    source: { sha256: "0".repeat(64), width: 1080, height: 1920, fps: 30, duration: 22 },
    people: "one", framing: "medium", usable: true, reasons: [], head: box, body: null, coverage: 0.3, stability: 0.9, headroom: 0.2,
    frames: frames.map(([t, head]) => ({ t, coverage: head ? 0.3 : 0, people: head ? "one" : "none", head: head ? box : null, body: null }))
  });
}

// The same footage with nothing but punch-ins, every line held on the face.
async function sparse() {
  const story = await resolved();
  const bare = { ...story, scenes: story.scenes.filter((scene) => scene.module === "punch-in") };
  const direction = structuredClone(await map());
  for (const section of direction.sections) for (const line of section.lines) { line.treatment = "face"; line.why = "the plain recording"; delete line.scenes; }
  return { story: bare, direction };
}

test("a sparse draft fails coverage with missed-opportunity and sparseness findings; the dressed one passes", async () => {
  const thin = await sparse();
  const failed = coverageGate({ resolved: thin.story, words: await words(), map: thin.direction, profile: profile("short-talking-head") });
  assert.equal(failed.status, "failed");
  assert.match(failed.errors.join("\n"), /coverage 0% is below the profile band/);
  assert.match(failed.errors.join("\n"), /longest_undressed_seconds 20 s is above the profile band/);
  const categories = failed.findings.map((finding) => finding.category);
  assert.ok(categories.filter((category) => category === "missed-opportunity").length >= 5, categories.join(", "));
  assert.ok(categories.includes("sparseness"));
  const dressed = coverageGate({ resolved: await resolved(), words: await words(), map: await map(), profile: profile("short-talking-head") });
  assert.equal(dressed.status, "passed", dressed.errors.join("\n"));
  assert.equal(dressed.profile, "short-talking-head");
  assert.ok(dressed.measures.coverage > 0.35);
  assert.deepEqual(dressed.findings.map((finding) => finding.category), ["missed-opportunity"], "only the punch-in hook");
});

test("the direction gate: a valid map passes, a broken one fails, a missing one fails only with narration", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-direction-gate-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const story = await resolved();
  const list = await words();
  assert.equal((await directionGate({ project: dir, resolved: story, words: list, direction: { file: path.join(dir, "DIRECTION.json"), map: await map() } })).status, "passed");
  const broken = await map();
  broken.sections[0].lines.pop();
  const bad = await directionGate({ project: dir, resolved: story, words: list, direction: { file: path.join(dir, "DIRECTION.json"), map: broken } });
  assert.equal(bad.status, "failed");
  assert.match(bad.errors.join("\n"), /every line needs an entry/);
  const missing = await directionGate({ project: dir, resolved: story, words: list });
  assert.equal(missing.status, "failed");
  assert.match(missing.errors[0], /DIRECTION\.json is missing/);
  assert.equal((await directionGate({ project: dir, resolved: story, words: [] })).status, "skipped");
});

test("face data: a whole-video track or the probe maps through base.trim onto the timeline", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-face-gate-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const story = await resolved();
  assert.deepEqual(story.base.trim, [[0, 8], [10, 22]]);
  assert.deepEqual(toTimeline([{ start: 6, end: 12 }], story), [{ start: 6, end: 10 }]);
  assert.equal((await readFaceData(dir, story)).source, "storyboard");
  await mkdir(path.join(dir, ".launchclip/subject/abc"), { recursive: true });
  await writeFile(path.join(dir, ".launchclip/subject/abc/probe.json"), JSON.stringify({ source: { duration: 22 }, samples: [{ t: 0, head: { x: 1 } }, { t: 11, head: null }, { t: 16, head: { x: 1 } }] }));
  const probe = await readFaceData(dir, story);
  assert.equal(probe.source, path.join(".launchclip", "subject", "abc", "probe.json"));
  assert.deepEqual(probe.intervals, [{ start: 0, end: 9 }, { start: 14, end: 20 }]);
  await mkdir(path.join(dir, "assets/subject"), { recursive: true });
  await writeFile(path.join(dir, "assets/subject/track.json"), track([[0, true], [21.9, false]]));
  const tracked = await readFaceData(dir, story);
  assert.equal(tracked.source, "assets/subject/track.json", "a track wins over the probe");
  assert.deepEqual(tracked.intervals, [{ start: 0, end: 19.9 }], "source 0–21.9 s through the trim");
});

test("the face gate fails on layout-check's face rule and on face time outside the band", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-face-rule-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const story = await resolved();
  const clean = await faceGate({ project: dir, resolved: story, layout: { findings: [] }, profile: profile("short-talking-head") });
  assert.equal(clean.status, "passed");
  assert.equal(clean.source, "storyboard");
  const covered = await faceGate({ project: dir, resolved: story, layout: { findings: [{ rule: "subject-face", ids: ["builder"], at: 3, detail: "builder covers the presenter's face for 0.6 s" }] }, profile: profile("short-talking-head") });
  assert.equal(covered.status, "failed");
  assert.match(covered.errors[0], /builder @3s/);
  await mkdir(path.join(dir, "assets/subject"), { recursive: true });
  await writeFile(path.join(dir, "assets/subject/track.json"), track([[0, false], [21, true]]));
  const away = await faceGate({ project: dir, resolved: story, layout: { findings: [] }, profile: profile("short-talking-head") });
  assert.equal(away.status, "failed");
  assert.match(away.errors.join("\n"), /face_time .* below the profile band/);
});

test("the motion gate's floors are profile bands: a locked-off talking head passes its own profile", () => {
  const still = { duration_seconds: 20, width: 1080, height: 1920, frame_count: 600, cuts: [], motion: { hold_ratio: 0.97, change_energy: { p50: 0.02 }, bursts: [{ start_seconds: 1.1 }] }, motion_bursts_per_minute: 3, optical_flow: { velocity_pixels_per_second: { p90: 0.4 } } };
  const fixed = cinematicMotionExpectations({ duration: 20, width: 1080, height: 1920 });
  assert.equal(fixed.expected.minimum_flow_velocity_p90, 2);
  assert.equal(evaluateMotionQuality(still, fixed.expected).ok, false, "the old fixed floors fail a locked-off talking head");
  const footage = cinematicMotionExpectations({ duration: 20, width: 1080, height: 1920, profile: profile("short-talking-head") });
  assert.equal(footage.cadence.id, "short-talking-head");
  assert.equal(footage.expected.minimum_flow_velocity_p90, 0);
  assert.deepEqual(evaluateMotionQuality(still, footage.expected).findings, []);
  const motion = cinematicMotionExpectations({ duration: 20, width: 1080, height: 1920, profile: profile("short-motion") });
  assert.deepEqual([motion.expected.minimum_flow_velocity_p90, motion.expected.maximum_hold_ratio, motion.expected.minimum_bursts_per_minute, motion.expected.maximum_first_motion_seconds], [2, 0.8, 20, 0.35], "motion profiles keep the floors motion stories had");
  assert.equal(evaluateMotionQuality(still, motion.expected).ok, false);
});

test("the critic rubric carries the RFC categories", () => {
  for (const category of ["missed-opportunity", "sparseness", "brand-consistency", "acting", "character-consistency"]) assert.ok(CRITIC_CATEGORIES.includes(category), category);
  assert.deepEqual(MAKE_CRITIC_SCHEMA.properties.findings.items.properties.category.enum, CRITIC_CATEGORIES);
});

test("the headless critic is told the measured findings and records them with citations", async (t) => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-critic-quality-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  await mkdir(path.join(project, "qa/temporal-evidence"), { recursive: true });
  await mkdir(path.join(project, "qa/critic-sheets"), { recursive: true });
  const entries = [0.5, 6, 12].flatMap((at, i) => ["browser-still", "encoded-draft"].map((source) => ({ evidence_id: `s${i}-${source}`, sample_id: `s${i}`, source, at_seconds: at })));
  await writeFile(path.join(project, "qa/temporal-evidence/manifest.json"), JSON.stringify({ entries }));
  await writeFile(path.join(project, "qa/critic-sheets/index.json"), JSON.stringify({ sheets: [{ sheet: "sheet-01.jpg", samples: ["s0", "s1", "s2"] }] }));
  await writeFile(path.join(project, "qa/critic-sheets/sheet-01.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const thin = await sparse();
  const quality = qualityFindings((await import("../kit/core/direction.mjs")).directionMeasures(thin.direction, thin.story, { words: await words() }), profile("short-talking-head"));
  const seen = [];
  const client = { provider: "openai", async runStructured(request) { seen.push(request); return { model: "stand-in", value: { verdict: "ship", summary: "fine", findings: [] }, usage: { input_tokens: 1, output_tokens: 1 } }; } };
  const result = await runHeadlessCritic({ project, client, quality });
  assert.equal(result.status, "written");
  assert.match(seen[0].instructions, /missed-opportunity: a line whose intent calls for a visual/);
  assert.match(seen[0].input, /Measured from the direction map and the storyboard/);
  const critique = JSON.parse(await readFile(path.join(project, "qa/critic.json"), "utf8"));
  assert.equal(critique.verdict, "repair", "a ship verdict with major measured findings is recorded as repair");
  assert.ok(critique.findings.some((finding) => finding.category === "missed-opportunity"));
  for (const finding of critique.findings) assert.ok(finding.evidence_ids.length && finding.evidence_ids.every((id) => entries.some((entry) => entry.evidence_id === id)), finding.id);
  assert.deepEqual(toolingFindings([{ category: "sparseness", at: 11, message: "x" }], entries)[0].evidence_ids, ["s2-browser-still", "s2-encoded-draft"], "cites the nearest sample");
});

test("the prototype cut lands between 20 and 30 s at a sentence end", async () => {
  const story = await resolved();
  const long = { ...story, format: { ...story.format, duration: 90 }, resolved: { ...story.resolved, duration: 90 }, scenes: [...story.scenes, { id: "late", module: "lower-third", track: 1, start: 40, end: 44, params: { name: "Ada", title: "Founder" } }] };
  const list = [{ text: "One.", start: 1, end: 1.4 }, { text: "Two", start: 21, end: 21.5 }, { text: "three.", start: 22, end: 22.6 }, { text: "Four.", start: 27, end: 27.3 }];
  const cut = prototypeCut(long, list);
  assert.equal(cut.cut, 22.8, "the sentence end nearest 25 s, plus a breath");
  assert.equal(cut.story.format.duration, 22.8);
  assert.ok(cut.story.scenes.every((scene) => scene.end <= 22.8 && scene.id !== "late"));
  assert.equal(cut.story.ending, undefined);
  assert.equal(prototypeCut(story, await words()), null, "a 20 s story needs no prototype");
});

test("a prototype with no sentence end in its window never cuts a word in half", async () => {
  const story = await resolved();
  const long = { ...story, format: { ...story.format, duration: 90 }, resolved: { ...story.resolved, duration: 90 } };
  const sentence = [{ text: "One.", start: 1, end: 1.4 }, { text: "the", start: 29.6, end: 29.9 }, { text: "part.", start: 30.1, end: 30.5 }];
  assert.equal(prototypeCut(long, sentence).cut, 30.7, "a sentence ending just past 30 s finishes, plus a breath");
  const running = [{ text: "One.", start: 1, end: 1.4 }, { text: "and", start: 29.4, end: 29.7 }, { text: "then", start: 29.8, end: 30.4 }, { text: "more.", start: 35, end: 35.5 }];
  assert.equal(prototypeCut(long, running).cut, 29.8, "else the cut falls between the last two words inside the window");
});

test("prototypeScope keeps the lines and scenes inside the prototype window", () => {
  const list = Array.from({ length: 10 }, (_, i) => ({ text: `w${i}.`, start: i * 4, end: i * 4 + 1 }));
  const full = { scenes: [{ id: "a", start: 0, end: 8 }, { id: "b", start: 8, end: 20 }, { id: "c", start: 24, end: 30 }, { id: "d", start: 30, end: 36 }] };
  const story = { scenes: full.scenes.slice(0, 2) };
  const direction = (late) => ({
    schema: "launchclip.direction-map.v1",
    sections: [
      { id: "s1", lines: [{ words: [0, 1], intent: "hook", treatment: "dress", scenes: ["a"] }, { words: [2, 4], intent: "claim", treatment: "dress", scenes: ["b"] }] },
      { id: "s2", end: 40, lines: [late, { words: [7, 9], intent: "claim", treatment: "dress", scenes: ["d"] }] },
      { id: "s3", lines: [{ words: [10, 11], intent: "cta", treatment: "dress", scenes: ["d"] }] }
    ]
  });
  // A dressed line whose scenes all come after the cut ends the window before it.
  const after = prototypeScope({ map: direction({ words: [5, 6], intent: "claim", treatment: "dress", scenes: ["c"] }), words: list, cut: 22, story, full });
  assert.deepEqual(after.map.sections.map((section) => section.id), ["s1"]);
  assert.equal(after.words.length, 5);
  assert.equal(after.lines, 2);
  // A line straddling the cut keeps the scenes the window shows and its words before the cut.
  const straddle = prototypeScope({ map: direction({ words: [5, 6], intent: "claim", treatment: "dress", scenes: ["b", "c"] }), words: list, cut: 22, story, full });
  assert.deepEqual(straddle.map.sections.map((section) => section.id), ["s1", "s2"]);
  assert.deepEqual(straddle.map.sections[1].lines, [{ words: [5, 5], intent: "claim", treatment: "dress", scenes: ["b"] }]);
  assert.equal(straddle.map.sections[1].end, 22);
  assert.equal(straddle.words.length, 6);
  // A scene in neither story is kept, so validation still reports the typo.
  const typo = prototypeScope({ map: direction({ words: [5, 6], intent: "claim", treatment: "dress", scenes: ["zzz"] }), words: list, cut: 22, story, full });
  assert.deepEqual(typo.map.sections[1].lines[0].scenes, ["zzz"]);
});

test("in a prototype, the whole-video share bands are advisory; run lengths still fail", async () => {
  const thin = await sparse();
  const gate = coverageGate({ resolved: thin.story, words: await words(), map: thin.direction, profile: profile("short-talking-head"), prototype: true });
  assert.match(gate.advisory.join("\n"), /coverage 0% is below the profile band/);
  assert.doesNotMatch(gate.errors.join("\n"), /coverage 0%/);
  assert.match(gate.errors.join("\n"), /longest_undressed_seconds 20 s is above the profile band/);
  assert.equal(gate.status, "failed");
});
