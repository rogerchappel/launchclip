import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LIBRARY_SKELETONS, SKELETON_SCHEMA, TITLE_CARD_MODULES, chooseSkeleton, kitCapabilities, mergeSkeletons, skeletonById, skeletonFeasibility, skeletonLibraryReference, skeletonProblems, skeletonScriptPlan, skeletonStale, storyboardStructureErrors, structureCheck } from "../kit/core/skeleton-library.mjs";
import { SHORT_VIDEO_RULES, chooseScriptPlan, scriptPlanLines, scriptRuleLines } from "../kit/core/script-formats.mjs";
import { validateStory } from "../kit/core/story.mjs";
import { loadSkeletonLibrary, runSkeletonsCommand, structureGate } from "../src/skeletons.js";
import { writeScript } from "../src/make/script.js";
import { assessCinematicReadiness } from "../src/production_readiness.js";

const story = (scenes, { duration = 30, base = null } = {}) => ({ schema: "launchclip.story.v1", lane: "motion", format: { width: 1080, height: 1920, fps: 30, duration }, base, scenes });
const scene = (id, module, start, end, params = {}) => ({ id, module, start, end, params });

test("every library skeleton is valid, and the kit can draw all but last-time's key shot", () => {
  for (const skeleton of LIBRARY_SKELETONS) assert.deepEqual(skeletonProblems(skeleton), [], skeleton.id);
  const kit = kitCapabilities();
  const blocked = LIBRARY_SKELETONS.filter((skeleton) => !skeletonFeasibility(skeleton, kit).ok).map((skeleton) => skeleton.id);
  assert.deepEqual(blocked, ["last-time"]);
  assert.deepEqual(skeletonFeasibility(skeletonById("last-time"), kit).missing, ["pose lift"]);
  // Once the rig can lift, last-time is ready.
  assert.equal(skeletonFeasibility(skeletonById("last-time"), { ...kit, poses: new Set([...kit.poses, "lift"]) }).ok, true);
  assert.equal(skeletonStale(skeletonById("versus"), new Date("2026-11-01")), false);
  assert.equal(skeletonStale(skeletonById("versus"), new Date("2027-04-01")), true);
});

test("chooseSkeleton matches a skeleton's own cue, says when a fit is blocked, and leaves other briefs alone", () => {
  const pick = (prompt, options = {}) => chooseSkeleton({ prompt, ...options });
  assert.equal(pick("How big is a billion, in seconds").skeleton.id, "dollar-a-second");
  assert.equal(pick("Renting vs buying a house").skeleton.id, "versus");
  assert.equal(pick("Top 5 tools for writers").skeleton.id, "countdown");
  // A generic product brief matches no skeleton's own cue: the script format's skeleton stays.
  assert.equal(pick("A 30 second promo for LaunchClip").skeleton, null);
  assert.equal(pick("Launch video for our new app feature", { medium: "demo" }).skeleton, null);
  const lastTime = pick("The last time your dad picked you up", { medium: "character" });
  assert.equal(lastTime.skeleton, null);
  assert.match(lastTime.reasons[0], /last-time fits but is blocked \(needs pose lift\)/);
  // Pins, none, unknown ids and long videos.
  assert.equal(pick("anything", { requested: "myth-check" }).skeleton.id, "myth-check");
  assert.equal(pick("How big is a billion", { requested: "none" }).skeleton, null);
  assert.equal(pick("x", { requested: "kazoo" }).unknown, "kazoo");
  assert.throws(() => pick("x", { requested: "last-time" }), /blocked: the kit can't render its key shot \(needs pose lift\)/);
  assert.equal(pick("How big is a billion", { duration: 600 }).skeleton, null);
  assert.equal(pick("How big is a billion", { aspect: "16:9" }).skeleton, null);
});

test("a skeleton's script plan writes on its beats, roles included, and lets its last beat decide the call to action", () => {
  const plan = skeletonScriptPlan({ prompt: "How big is a billion", duration: 30, aspect: "9:16" }, skeletonById("dollar-a-second"));
  assert.equal(plan.skeleton, "dollar-a-second");
  assert.equal(plan.format, "short-form");
  assert.deepEqual(plan.beats.map((entry) => entry.role), ["hook", "proof", "rehook", "escalation", "escalation", "share", "cta_or_loop"]);
  const lines = scriptPlanLines(plan).join("\n");
  assert.match(lines, /Skeleton: \$1 a second \(the skeleton library\)/);
  assert.match(lines, /Key shot \(the image this structure cannot work without\)/);
  assert.match(lines, /Call to action: as the skeleton's last beat says/);
  // The short-video rules are in every short script, on a library skeleton or not; a long one has none.
  const short = chooseScriptPlan({ prompt: "Why sleep matters", duration: 40, aspect: "9:16" });
  assert.deepEqual(scriptRuleLines(short).slice(0, 2), [...SHORT_VIDEO_RULES]);
  assert.equal(scriptRuleLines(chooseScriptPlan({ prompt: "Why sleep matters", duration: 600 })).some((line) => SHORT_VIDEO_RULES.includes(line)), false);
  // --skeleton pins a script format's own skeleton too.
  assert.equal(chooseScriptPlan({ prompt: "x", duration: 30, aspect: "9:16", skeleton: "before-after-bridge" }).skeleton, "before-after-bridge");
});

test("the structure checks: an image opens a short video, the key shot has a scene, the share line lands late", () => {
  const skeleton = skeletonById("dollar-a-second");
  const titleOpen = story([scene("s1", "hook-title", 0, 3), scene("s2", "count-up", 3, 30)]);
  const opened = structureCheck(titleOpen, null, {});
  assert.equal(opened.status, "failed");
  assert.match(opened.findings[0], /^first_frame: opens on hook-title at 0 s \(a title card\)/);
  assert.match(storyboardStructureErrors(titleOpen, null)[0], /^opening: .* a title card \(hook-title/);
  const good = story([scene("s1", "count-up", 0, 3), scene("s2", "hook-title", 3, 20), scene("s3", "odometer", 20, 30)]);
  const words = "I'll pay you a dollar a second they are twelve days and thirty two years apart".split(" ").map((text, i) => ({ text, start: i * 2 }));
  const beats = [{ role: "hook", spoken: "I'll pay you", visual_noun: "a one-dollar coin" }, { role: "share", spoken: "twelve days and thirty two years apart", visual_noun: "two rulers side by side" }];
  const titles = ["a", "b", "c", "d", "e"];
  assert.equal(structureCheck(good, skeleton, { words, beats, titles }).status, "passed");
  // The share line spoken too early, an abstract visual noun, three titles, no key shot.
  const early = structureCheck(story([scene("s1", "stat-card", 0, 30)]), skeleton, { words: [{ text: "twelve", start: 2 }, { text: "days", start: 2.3 }, { text: "and", start: 2.5 }], beats: [{ role: "share", spoken: "twelve days and", visual_noun: "the gap" }], titles: ["a", "b", "c"] });
  assert.deepEqual(Object.entries(early.checks).filter(([, entry]) => !entry.ok).map(([name]) => name), ["key_shot", "share_beat", "concrete_visuals", "packaging"]);
  assert.match(storyboardStructureErrors(story([scene("s1", "stat-card", 0, 30)]), skeleton)[0], /skeleton dollar-a-second: no scene renders the key shot/);
  // A recording opens a footage-led video; a long video on no skeleton is skipped.
  assert.equal(structureCheck(story([scene("s1", "hook-title", 0, 3)], { base: { src: "assets/talk.mp4" } }), null, {}).checks.first_frame, undefined);
  assert.equal(structureCheck(story([scene("s1", "hook-title", 0, 300)], { duration: 300 }), null, {}).status, "skipped");
  assert.ok(TITLE_CARD_MODULES.includes("kinetic-words"));
});

test("storyboard.json takes a skeleton field", () => {
  const base = { schema: "launchclip.story.v1", lane: "motion", format: { width: 1080, height: 1920, fps: 30, duration: 5 }, brand: { colors: { bg: "#000000", paper: "#ffffff", ink: "#000000", primary: "#ff0000", accent: "#00ff00" }, fonts: { display: "Inter", body: "Inter" } }, scenes: [scene("s1", "count-up", 0, 5, { value: 5, label: "x" })] };
  assert.ok(!validateStory({ ...base, skeleton: { id: "versus", version: "2026-10" } }).errors.some((error) => /skeleton/.test(error)));
  assert.ok(validateStory({ ...base, skeleton: "versus" }).errors.some((error) => /^skeleton must be/.test(error)));
  assert.ok(!validateStory({ ...base, skeleton: { id: "versus" } }).warnings.some((warning) => /skeleton is not a story.json v1 field/.test(warning)));
});

test("your own skeletons override the library; a broken one is reported, not used", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "launchclip-skeletons-"));
  try {
    const project = path.join(home, "project");
    await mkdir(path.join(home, ".launchclip", "skeletons"), { recursive: true });
    await mkdir(path.join(project, ".launchclip", "skeletons"), { recursive: true });
    const mine = { ...skeletonById("versus"), title: "Mine vs yours", source: undefined };
    await writeFile(path.join(home, ".launchclip", "skeletons", "versus.json"), JSON.stringify({ ...mine, title: "User versus" }));
    await writeFile(path.join(project, ".launchclip", "skeletons", "versus.json"), JSON.stringify(mine));
    await writeFile(path.join(project, ".launchclip", "skeletons", "broken.json"), JSON.stringify({ schema: SKELETON_SCHEMA, id: "broken" }));
    const { skeletons, problems } = loadSkeletonLibrary({ project, home, env: {} });
    assert.equal(skeletonById("versus", skeletons).title, "Mine vs yours");
    assert.ok(problems.some((problem) => /broken\.json: skeleton broken: family must be/.test(problem)));
    assert.equal(skeletons.length, LIBRARY_SKELETONS.length);
    assert.deepEqual(mergeSkeletons([{ skeleton: { id: "x" }, source: "x.json" }]).skeletons.length, LIBRARY_SKELETONS.length);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("the structure gate reads STORY.json's beats (else SCRIPT.json's) and the titles", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-structure-"));
  try {
    const built = { ...story([scene("s1", "count-up", 0, 3), scene("s2", "odometer", 3, 30)]), skeleton: { id: "dollar-a-second", version: "2026-10" } };
    await writeFile(path.join(project, "SCRIPT.json"), JSON.stringify({ title_options: ["a", "b", "c", "d", "e"], beats: [{ beat: "hook", text: "I'll pay you a dollar" }, { beat: "share", text: "twelve days apart" }] }));
    const words = [{ text: "twelve", start: 20 }, { text: "days", start: 20.4 }, { text: "apart", start: 20.8 }];
    const gate = await structureGate({ project, story: built, words });
    assert.equal(gate.status, "passed", JSON.stringify(gate.findings));
    assert.deepEqual(gate.skeleton, { id: "dollar-a-second", version: "2026-10" });
    // STORY.json wins over SCRIPT.json: here its share beat is missing.
    await writeFile(path.join(project, "STORY.json"), JSON.stringify({ beats: [{ role: "hook", spoken: "I'll pay you", visual_noun: "a coin" }] }));
    assert.match((await structureGate({ project, story: built, words })).findings.join(), /share_beat: no share beat/);
    // --prototype judges the opening only; an unknown skeleton fails.
    assert.deepEqual(Object.keys((await structureGate({ project, story: built, words, prototype: true })).checks), ["first_frame"]);
    assert.equal((await structureGate({ project, story: { ...built, skeleton: { id: "kazoo" } } })).status, "failed");
    // On no library skeleton, a story receipt still needs its share beat.
    const plain = story([scene("s1", "count-up", 0, 30)]);
    assert.match((await structureGate({ project, story: plain, words })).findings.join(), /share_beat: no share beat/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("launchclip skeletons list, show and choose", async () => {
  const list = await runSkeletonsCommand("list", null, {});
  assert.equal(list.skeletons.find((entry) => entry.id === "last-time").status, "blocked");
  assert.ok(list.script_skeletons.includes("call-out-pas"));
  assert.deepEqual((await runSkeletonsCommand("list", null, { medium: "character" })).skeletons.map((entry) => entry.id), ["last-time", "pov"]);
  assert.equal((await runSkeletonsCommand("show", "versus", {})).status, "ready");
  assert.equal((await runSkeletonsCommand("show", "call-out-pas", {})).kind, "script-format skeleton");
  await assert.rejects(runSkeletonsCommand("show", "kazoo", {}), /unknown skeleton kazoo/);
  assert.equal((await runSkeletonsCommand("choose", "How big is a billion", {})).skeleton, "dollar-a-second");
  assert.match(skeletonLibraryReference(), /\| `last-time` The last time \| last-time \| character .* blocked: needs pose lift \|/);
});

test("the script pass on a library skeleton asks for five titles and keeps each beat's role", async () => {
  let request = null;
  const client = {
    provider: "openai",
    async runStructured(input) {
      request = input;
      return { model: "m", usage: {}, value: { title: "A billion", narration: "One. Two.", title_options: ["1", "2", "3", "4", "5", "6"], beats: [{ beat: "hook", text: "One." }, { beat: "share", text: "Two." }] } };
    }
  };
  const result = await writeScript({ client, prompt: "How big is a billion", duration: 30, plan: { aspect: "9:16" }, skeleton: skeletonById("dollar-a-second") });
  assert.match(request.instructions, /title_options: five, the best first, publish-ready titles/);
  assert.match(request.instructions, /Share line: in the last 40% of the script/);
  assert.equal(result.title_options.length, 5);
  assert.deepEqual(result.beats.map((entry) => entry.role), ["hook", "share"]);
  assert.deepEqual(result.plan.structure, { id: "dollar-a-second", version: "2026-10" });
});

test("cinematic readiness blocks on a failed structure gate and passes when it is skipped", () => {
  const input = { concepts: null, story: null, narration: {}, plan: {}, verification: { status: "passed" }, motion: { quality: { ok: true, findings: [] } }, audio: { quality: { ok: true, findings: [] } }, critique: { verdict: "ship", findings: [] }, assembly: { fallback_count: 0 } };
  const failed = assessCinematicReadiness({ ...input, structure: { status: "failed", findings: ["first_frame: opens on hook-title at 0 s (a title card)"] } }, { creativeReceipts: false });
  assert.equal(failed.gates.structure.ok, false);
  assert.ok(failed.blockers.some((entry) => /structure gate failed: first_frame/.test(entry.message ?? JSON.stringify(entry))));
  const skipped = assessCinematicReadiness({ ...input, structure: { status: "skipped" } }, { creativeReceipts: false });
  assert.equal(skipped.gates.structure.status, "not-required");
});
