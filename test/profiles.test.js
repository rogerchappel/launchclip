// Cadence profiles (docs/VIDEO_QUALITY_RFC.md §5): the schema and validator,
// the shipped seed profiles and their provenance, selection by lane, aspect,
// duration and platform, exact storyboard measures, and `profile measure`
// with stand-in measurers (no ffmpeg, no models).
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile, cp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CADENCE_PROFILE_SCHEMA, compareMeasures, compareToBand, profilePromptLines, selectProfile, validateProfile } from "@launchclip/core/profiles.mjs";
import { storyboardMeasures, unionIntervals } from "@launchclip/core/cadence.mjs";
import { aggregateMeasures, isDesignedFrame, measureProfile, renderMeasures } from "../src/cadence_measures.js";
import { PROFILE_DIR, profileForStory, provenanceMarkdown, shippedProfiles } from "../src/profile_store.js";
import { runProfileCommand } from "../src/profile_cli.js";
import { runStoryCommand } from "../src/story_cli.js";
import { runCli } from "../src/cli.js";

const SHIPPED = ["explainer-motion", "product-demo", "short-motion", "short-talking-head", "story-characters", "youtube-long-form", "youtube-talking-head-launch"];
const example = (name) => fileURLToPath(new URL(`../examples/story/${name}/storyboard.json`, import.meta.url));

async function resolved(name) {
  const result = await runStoryCommand("resolve", example(name));
  return result.story_resolved;
}

function seed(overrides = {}) {
  return { schema: CADENCE_PROFILE_SCHEMA, id: "test-profile", format: "footage-led", duration_seconds: [10, 60], references: 0, provenance: { kind: "seed", note: "hand-set", sources: [] }, measures: { coverage: { p10: 0.3, p50: 0.6, p90: 0.9 } }, ...overrides };
}

test("the six RFC profiles and story-characters ship as valid seed profiles", () => {
  const profiles = shippedProfiles();
  assert.deepEqual(profiles.map((profile) => profile.id), SHIPPED);
  for (const profile of profiles) {
    const check = validateProfile(profile);
    assert.ok(check.ok, `${profile.id}: ${check.errors.join("; ")}`);
    assert.equal(profile.provenance.kind, "seed", `${profile.id} is not measured yet`);
    assert.equal(profile.references, 0);
    assert.ok(profile.measures.coverage, `${profile.id} carries a coverage band`);
  }
});

test("PROVENANCE.md is generated from the shipped profiles", async () => {
  assert.equal(await readFile(path.join(PROFILE_DIR, "PROVENANCE.md"), "utf8"), provenanceMarkdown());
});

test("the validator holds the provenance rules", () => {
  assert.ok(validateProfile(seed()).ok);
  const withSources = validateProfile(seed({ provenance: { kind: "seed", note: "x", sources: [{ id: "a", rights: "own" }] } }));
  assert.match(withSources.errors.join("\n"), /seed profile measured no references/);
  const measured = (sources, extra = {}) => validateProfile(seed({ references: sources.length, provenance: { kind: "measured", sources }, ...extra }));
  assert.ok(measured([{ id: "a", rights: "own" }, { id: "b", rights: "licensed" }]).ok);
  assert.match(measured([{ id: "a", rights: "scraped" }]).errors.join("\n"), /rights must be one of own, licensed, public-statistics/);
  assert.match(measured([{ id: "a", rights: "own", frames: ["f.jpg"] }]).errors.join("\n"), /measurements only, never a reference's frames, audio or text/);
  assert.match(measured([{ id: "a", rights: "own", transcript: "hi" }]).errors.join("\n"), /frames, audio or text/);
  assert.match(measured([]).errors.join("\n"), /lists the references it was measured from/);
  assert.match(validateProfile(seed({ references: 3, provenance: { kind: "measured", sources: [{ id: "a", rights: "own" }] } })).errors.join("\n"), /must equal the number of provenance.sources/);
});

test("the validator checks measures", () => {
  assert.match(validateProfile(seed({ measures: { coverage: { p10: 0.8, p50: 0.5 } } })).errors.join("\n"), /must not decrease/);
  assert.match(validateProfile(seed({ measures: { coverage: { p90: 1.4 } } })).errors.join("\n"), /share and must be at most 1/);
  assert.match(validateProfile(seed({ measures: { coverrage: { p50: 0.5 } } })).errors.join("\n"), /not a known measure/);
  assert.match(validateProfile(seed({ measures: { coverage: { p95: 0.5 } } })).errors.join("\n"), /not a percentile/);
  assert.match(validateProfile(seed({ format: "vlog" })).errors.join("\n"), /format must be one of/);
});

test("profiles are selected by lane, aspect, duration and platform", () => {
  const profiles = shippedProfiles();
  const pick = (context) => selectProfile(profiles, context).profile?.id;
  assert.equal(pick({ lane: "footage-led", aspect: "9:16", duration: 30, platform: "youtube-shorts" }), "short-talking-head");
  assert.equal(pick({ lane: "footage-led", aspect: "16:9", duration: 144 }), "youtube-talking-head-launch");
  assert.equal(pick({ lane: "footage-led", aspect: "16:9", duration: 900 }), "youtube-long-form");
  assert.equal(pick({ lane: "motion", aspect: "9:16", duration: 20 }), "short-motion");
  assert.equal(pick({ lane: "voiceover-motion", aspect: "16:9", duration: 31 }), "explainer-motion");
  assert.equal(pick({ lane: "voiceover-motion", aspect: "16:9", duration: 45, demo: true }), "product-demo");
  assert.equal(pick({ lane: "motion", aspect: "9:16", duration: 60, cast: true }), "story-characters");
  assert.equal(pick({ lane: "footage-led", format: { width: 1080, height: 1920, duration: 20 } }), "short-talking-head");
  assert.equal(pick({ id: "youtube-long-form", lane: "motion" }), "youtube-long-form", "an explicit id wins");
});

test("profileForStory picks from the story, and a named profile wins", async () => {
  assert.equal(profileForStory(await resolved("footage")).profile.id, "short-talking-head");
  assert.equal(profileForStory(await resolved("cinematic-16x9")).profile.id, "explainer-motion");
  assert.equal(profileForStory(await resolved("demo-autopilot-16x9")).profile.id, "product-demo");
  assert.equal(profileForStory(await resolved("footage"), { direction: { profile: "youtube-talking-head-launch" } }).profile.id, "youtube-talking-head-launch");
  assert.equal(profileForStory(await resolved("footage"), { style: { profile: "youtube-long-form" } }).profile.id, "youtube-long-form");
  const footage = await resolved("footage");
  assert.throws(() => profileForStory(footage, { profile: "nope" }), /Unknown cadence profile: nope/);
});

test("bands compare by each measure's check", () => {
  assert.equal(compareToBand(0.2, { p10: 0.3, p90: 0.9 }).status, "below");
  assert.equal(compareToBand(0.95, { p10: 0.3, p90: 0.9 }).status, "above");
  assert.equal(compareToBand(0.95, { p10: 0.3, p90: 0.9 }, "min").status, "inside");
  assert.equal(compareToBand(0.1, { p10: 0.3, p90: 0.9 }, "max").status, "inside");
  const profile = shippedProfiles().find((entry) => entry.id === "short-talking-head");
  const results = compareMeasures({ coverage: 0.1, longest_undressed_seconds: 12, shot_seconds: { p50: 2 } }, profile);
  assert.equal(results.find((entry) => entry.measure === "coverage").status, "below");
  assert.equal(results.find((entry) => entry.measure === "longest_undressed_seconds").status, "above");
  assert.equal(results.find((entry) => entry.measure === "shot_seconds").status, "inside");
  assert.match(results.find((entry) => entry.measure === "coverage").detail, /coverage 10% is below the profile band \(35%–92%, target 60%\)/);
  const lines = profilePromptLines(profile);
  assert.ok(lines.some((line) => /^coverage .*target 60%, band 35%–92%/.test(line)), lines.join("\n"));
  assert.ok(!lines.some((line) => line.startsWith("flow_velocity_p90")), "motion floors stay out of the planner prompt");
});

test("a render's coverage, face time and undressed run come exactly from its storyboard", async () => {
  const story = await resolved("footage");
  const measures = renderMeasures(story, null);
  const graphic = unionIntervals(story.scenes.filter((scene) => scene.module !== "punch-in").map((scene) => [scene.start, scene.end]));
  const covered = graphic.reduce((sum, [a, b]) => sum + b - a, 0);
  assert.equal(measures.coverage, Math.round((covered / story.format.duration) * 10000) / 10000);
  const insert = story.scenes.find((scene) => scene.insert);
  assert.equal(measures.face_time, Math.round(((story.format.duration - (insert.end - insert.start)) / story.format.duration) * 10000) / 10000);
  const gaps = [];
  let cursor = 0;
  for (const [a, b] of graphic) { gaps.push(a - cursor); cursor = b; }
  gaps.push(story.format.duration - cursor);
  assert.equal(measures.longest_undressed_seconds, Math.round(Math.max(...gaps) * 1000) / 1000);
  assert.equal(measures.first_visual_seconds, graphic[0][0]);
  assert.equal(measures.layout_changes_per_min, Math.round((2 / (story.format.duration / 60)) * 100) / 100, "one insert switches layout twice");
  assert.equal(measures.source, "storyboard");
});

test("a motion story covers its whole runtime and has no face time", async () => {
  const measures = storyboardMeasures(await resolved("promo-16x9"));
  assert.equal(measures.coverage, 1);
  assert.equal(measures.face_time, null);
  assert.equal(measures.longest_undressed_seconds, 0);
  assert.ok(measures.visual_changes_per_min > 0);
});

test("face data narrows face time, and section layouts count as layout changes", async () => {
  const story = await resolved("footage");
  const all = storyboardMeasures(story);
  const half = storyboardMeasures(story, { face: [{ start: 0, end: story.format.duration / 2 }] });
  assert.ok(half.face_time < all.face_time);
  const split = storyboardMeasures(story, { sections: [{ start: 0, end: 10, layout: "split-right" }, { start: 10, end: 20, layout: "full" }] });
  assert.ok(split.layout_changes_per_min > all.layout_changes_per_min);
});

function flatFrame(width = 32, height = 32) {
  return { width, height, data: Buffer.alloc(width * height * 3, 90) };
}

function noisyFrame(width = 32, height = 32, seedValue = 1) {
  let s = seedValue;
  const data = Buffer.alloc(width * height * 3);
  for (let i = 0; i < data.length; i += 1) { s = (s * 1103515245 + 12345) % 2147483648; data[i] = 80 + (s % 40); }
  return { width, height, data };
}

test("the reference coverage heuristic tells flat designed fills from footage noise", () => {
  assert.equal(isDesignedFrame(flatFrame()), true);
  assert.equal(isDesignedFrame(noisyFrame()), false);
});

function standIns({ cuts = [2, 4, 6], frames }) {
  return {
    motion: async () => ({ duration_seconds: 8, width: 1920, height: 1080, cuts, motion: { hold_ratio: 0.9, change_energy: { p50: 0.2 }, bursts: [{ start_seconds: 0.5 }, { start_seconds: 3 }] }, motion_bursts_per_minute: 15, optical_flow: { velocity_pixels_per_second: { p90: 1.2 } } }),
    frames: async () => ({ fps: 1, duration: 8, frames }),
    face: async () => 0.7
  };
}

test("profile measure turns a folder of references into a measured profile with provenance", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-profile-measure-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, "a.mp4"), "reference a");
  await writeFile(path.join(dir, "b.mp4"), "reference b");
  await writeFile(path.join(dir, "notes.txt"), "not a video");
  const frames = [flatFrame(), flatFrame(), noisyFrame(32, 32, 2), noisyFrame(32, 32, 3), flatFrame(), noisyFrame(32, 32, 4), noisyFrame(32, 32, 5), noisyFrame(32, 32, 6)];
  await assert.rejects(measureProfile(dir, { id: "mine" }, standIns({ frames })), /needs --rights own \| licensed \| public-statistics/);
  const { profile, references } = await measureProfile(dir, { id: "mine", rights: "own", now: () => "2026-10-25T00:00:00Z" }, standIns({ frames }));
  assert.ok(validateProfile(profile).ok);
  assert.equal(profile.provenance.kind, "measured");
  assert.equal(profile.references, 2);
  assert.deepEqual(profile.provenance.sources.map((source) => [source.title, source.rights]), [["a.mp4", "own"], ["b.mp4", "own"]]);
  assert.equal(references[0].measures.coverage, 0.375);
  assert.equal(references[0].measures.first_visual_seconds, 0);
  assert.equal(references[0].measures.longest_undressed_seconds, 3);
  assert.equal(profile.measures.face_time.p50, 0.7);
  assert.equal(profile.measures.shot_seconds.p50, 2);
  // Nothing but numbers and source descriptions is stored.
  const text = JSON.stringify(profile);
  assert.doesNotMatch(text, /reference a|"frames"|"data"/);
});

test("profile measure --replace writes over a shipped profile and refreshes PROVENANCE.md", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-profile-replace-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const refs = path.join(dir, "refs");
  const profiles = path.join(dir, "profiles");
  await mkdir(refs);
  await cp(PROFILE_DIR, profiles, { recursive: true });
  await writeFile(path.join(refs, "talk.mp4"), "x");
  const result = await runProfileCommand("measure", refs, { replace: "youtube-talking-head-launch", rights: "own" }, { profileDir: profiles, now: () => "2026-10-25T00:00:00Z", measure: standIns({ frames: [flatFrame(), noisyFrame()] }) });
  assert.equal(result.out, path.join(profiles, "youtube-talking-head-launch.json"));
  const written = JSON.parse(await readFile(result.out, "utf8"));
  assert.equal(written.id, "youtube-talking-head-launch");
  assert.equal(written.provenance.kind, "measured");
  assert.deepEqual(written.match, shippedProfiles().find((profile) => profile.id === written.id).match, "keeps the shipped match");
  assert.ok(written.measures.subject_effect_share, "keeps bands the references cannot measure");
  assert.ok(result.warnings.some((warning) => /kept the base profile's band/.test(warning)));
  assert.match(await readFile(path.join(profiles, "PROVENANCE.md"), "utf8"), /## youtube-talking-head-launch[\s\S]*Provenance: measured[\s\S]*\| talk\.mp4 \| own \|/);
});

test("aggregateMeasures takes p10, p50 and p90 across references", () => {
  const bands = aggregateMeasures([{ measures: { coverage: 0.2 } }, { measures: { coverage: 0.6 } }, { measures: { coverage: 1 } }]);
  assert.deepEqual(bands.coverage, { p10: 0.28, p50: 0.6, p90: 0.92 });
});

test("launchclip profile list and show run from the CLI", async () => {
  let out = "";
  await runCli(["profile", "list"], { stdout: { write: (text) => { out += text; } } });
  assert.deepEqual(JSON.parse(out).profiles.map((profile) => profile.id), SHIPPED);
  out = "";
  await runCli(["profile", "show", "short-talking-head"], { stdout: { write: (text) => { out += text; } } });
  assert.equal(JSON.parse(out).profile.id, "short-talking-head");
  await assert.rejects(runCli(["profile", "explode"], { stdout: { write() {} } }), /Unknown profile action: explode/);
});
