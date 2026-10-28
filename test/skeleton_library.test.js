import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LIBRARY_SKELETONS, SKELETON_SCHEMA, TITLE_CARD_MODULES, chooseSkeleton, kitCapabilities, mergeSkeletons, skeletonById, skeletonFeasibility, skeletonLibraryReference, skeletonProblems, skeletonScriptPlan, skeletonStale, storyboardStructureErrors, structureCheck } from "@launchclip/core/skeleton-library.mjs";
import { SHORT_VIDEO_RULES, chooseScriptPlan, scriptPlanLines, scriptRuleLines } from "@launchclip/core/script-formats.mjs";
import { validateStory } from "@launchclip/core/story.mjs";
import { loadSkeletonLibrary, openingPixels, runSkeletonsCommand, structureGate } from "../src/skeletons.js";
import { parseScriptMarkdown, buildPublishManifest } from "../src/publish_manifest.js";
import { coverFromVideo, renderCover } from "../src/cover.js";
import { resolveModule } from "@launchclip/core/modules.mjs";
import { resolveStory } from "@launchclip/core/story.mjs";
import { parseAngle, rankTitles, writeScript } from "../src/make/script.js";
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
  // dollar-a-second's key shot belongs in its first or second milestone (4.2–9 s or 12–18 s of 30, by the beat shares).
  const good = story([scene("s1", "count-up", 0, 3), scene("s2", "odometer", 3, 18), scene("s3", "hook-title", 18, 30)]);
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

test("a short video's script pass finds the angle and scores the titles in the same call, best first", async () => {
  let request = null;
  const client = {
    provider: "openai",
    async runStructured(input) {
      request = input;
      return { model: "m", usage: {}, value: {
        title: "Working title", narration: "One. Two.", beats: [{ beat: "hook", text: "One." }, { beat: "share", text: "Two." }],
        title_options: ["Wait for the end...", "A billion seconds is 31.7 years", "Big numbers", "Million vs billion", "How long is a billion?"],
        title_scores: [
          { title: "Wait for the end...", curiosity: 10, clarity: 3, match: 4 },
          { title: "A billion seconds is 31.7 years", curiosity: 7, clarity: 10, match: 9 },
          { title: "Big numbers", curiosity: 2, clarity: 4, match: 3 },
          { title: "Million vs billion", curiosity: 6, clarity: 8, match: 7 },
          { title: "How long is a billion?", curiosity: 8, clarity: 8, match: 8 }
        ],
        angle: { crowded: "A chart of how many zeros a billion has.", inventory: ["a one-dollar coin", "a wall calendar"], angles: [{ angle: "Zeros", differs: "none" }, { angle: "Get paid $1 a second", differs: "personal stake" }], chosen: 1 }
      } };
    }
  };
  const result = await writeScript({ client, prompt: "How big is a billion", duration: 30, plan: { aspect: "9:16" } });
  assert.deepEqual(request.schema.required, ["title", "narration", "title_options", "beats", "angle", "title_scores"]);
  assert.match(request.instructions, /## Angle \(before you write\)/);
  assert.match(request.instructions, /title_scores: score every title option 0-10/);
  // The clear, concrete title wins; the tease (the model's own favourite on curiosity) loses 3 and falls to fourth; the best becomes the title.
  assert.deepEqual(result.title_options, ["A billion seconds is 31.7 years", "How long is a billion?", "Million vs billion", "Wait for the end...", "Big numbers"]);
  assert.equal(result.title_scores[3].score, 3.05);
  assert.equal(result.title, "A billion seconds is 31.7 years");
  assert.equal(result.title_scores[0].score, 8.55);
  assert.equal(result.angle.angles[result.angle.chosen].angle, "Get paid $1 a second");
  // A repair keeps the angle; a long video asks for neither.
  await writeScript({ client, prompt: "How big is a billion", duration: 30, plan: { aspect: "9:16" }, angle: result.angle, repair: { previous: "One. Two.", errors: ["x"] } });
  assert.match(request.input, /## Angle \(keep it\)[\s\S]*Get paid \$1 a second/);
  await writeScript({ client, prompt: "How big is a billion", duration: 300, plan: { aspect: "16:9" } });
  assert.deepEqual(request.schema.required, ["title", "narration", "title_options", "beats"]);
  assert.equal(parseAngle({ crowded: "", angles: [] }), null);
  assert.equal(rankTitles(["x".repeat(80), "short"], [{ title: "x".repeat(80), curiosity: 9, clarity: 9, match: 9 }, { title: "short", curiosity: 7, clarity: 7, match: 7 }])[0].title, "short");
});

test("a short video's cover is a thumbnail frame, not a text card opening the video", () => {
  const base = story([scene("s1", "count-up", 0, 30)]);
  assert.match(storyboardStructureErrors({ ...base, cover: { text: "A billion?" } })[0], /cover card \(cover\.frame "first"\)\. Set cover\.frame to the seconds of the strongest image/);
  assert.deepEqual(storyboardStructureErrors({ ...base, cover: { text: "A billion?", frame: 12 } }), []);
  // The resolved story carries the card as a scene: still the cover card.
  const resolved = story([{ ...scene("cover", "hook-title", 0, 1.5), cover: true }, scene("s1", "count-up", 1.5, 30)]);
  assert.match(structureCheck(resolved, null, {}).findings[0], /opens on the cover card/);
});

test("SCRIPT.md's Titles section feeds the structure gate and publish.json; a loop line is not a call to action", async () => {
  const markdown = ["# Script: A billion seconds ago", "", "## Narration", "", "Count back a billion seconds. So, one more time, from right now:", "", "## Titles (best first)", "", "| # | Title | Score |", "| --- | --- | ---: |", "| 1 | A billion seconds ago, it was 1995 | 7.95 |", "| 2 | Count back a billion seconds | 7.9 |", "", "## Cover", "", "x"].join("\n");
  const parsed = parseScriptMarkdown(markdown);
  assert.deepEqual(parsed.title_options, ["A billion seconds ago, it was 1995", "Count back a billion seconds"]);
  assert.equal(parsed.title, "A billion seconds ago, it was 1995");
  assert.match(parsed.narration, /^Count back a billion seconds\. So, one more time/);
  assert.deepEqual(parseScriptMarkdown("# T\n\n## Titles\n\n1. First one\n2. Second one\n- Third one\n").title_options, ["First one", "Second one", "Third one"]);
  const base = { schema: "launchclip.story.v1", lane: "motion", format: { width: 1080, height: 1920, fps: 30, duration: 20 }, scenes: [scene("s1", "count-up", 0, 20)], ending: { loop_to: "s1" } };
  assert.deepEqual(buildPublishManifest({ story: base, script: parsed }).cta, { text: "" });
  assert.equal(buildPublishManifest({ story: base, script: { narration: "Try it today." } }).cta.text, "Try it today.");
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-scriptmd-"));
  try {
    await writeFile(path.join(project, "SCRIPT.md"), markdown);
    const gate = await structureGate({ project, story: story([scene("s1", "count-up", 0, 30)]) });
    assert.deepEqual(gate.checks.packaging, { ok: false, detail: "2 title option(s); write 5, the best first" });
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("the opening plate is drawn on frame 0, keeping its moves; frame 0 is measured in the render", async () => {
  const opening = resolveStory({ schema: "launchclip.story.v1", lane: "motion", format: { width: 1080, height: 1920, fps: 30, duration: 8 }, brand: { colors: { bg: "#000000", paper: "#ffffff", ink: "#000000", primary: "#ff0000", accent: "#00ff00" }, fonts: { display: "Inter", body: "Inter" } }, scenes: [scene("s1", "count-up", 0, 4, { value: 12, suffix: " days", label: "a million seconds" }), { ...scene("s2", "count-up", 4, 8, { value: 32, suffix: " years", label: "a billion seconds" }), in: { type: "fade", dur: 0.3 } }] });
  const first = resolveModule(opening.scenes[0], opening);
  const second = resolveModule(opening.scenes[1], opening);
  assert.equal(first.openingSettled, true);
  for (const from of [first.motion?.enterFrom, ...(first.animations ?? []).filter((anim) => anim.node === "root" && anim.start === 0).map((anim) => anim.from)].filter(Boolean)) {
    if ("opacity" in from) assert.equal(from.opacity, 1);
  }
  assert.equal(second.openingSettled, undefined);
  // The pixel check: an opening that fades up from an empty background fails; an unreadable render is not judged.
  const faded = await openingPixels("v.mp4", { measure: async (_, at) => (at === 0 ? 5.3 : 37.1) });
  assert.equal(faded.ok, false);
  assert.match(faded.detail, /frame 0 carries 14% of the content at 1 s: it fades up/);
  assert.equal((await openingPixels("v.mp4", { measure: async (_, at) => (at === 0 ? 34.5 : 36.7) })).ok, true);
  assert.equal((await openingPixels("v.mp4", { measure: async () => { throw new Error("no video"); } })).ok, true);
});

test("a short video's cover is grabbed from its own frame at cover.frame; a longer one renders the card", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-cover-frame-"));
  try {
    const video = path.join(project, "draft.mp4");
    await writeFile(video, "not really a video");
    const grabs = [];
    const short = { format: { width: 1080, height: 1920, fps: 30, duration: 28 }, cover: { text: "1995", frame: 12 } };
    assert.equal(coverFromVideo(short), true);
    assert.equal(coverFromVideo({ ...short, cover: { text: "1995" } }), false);
    assert.equal(coverFromVideo({ ...short, format: { ...short.format, duration: 600 } }), false);
    const grab = async (file, at, out) => { grabs.push([file, at]); await writeFile(out, "png"); };
    const first = await renderCover({ project, story: short, renderer: "hyperframes", video, grab });
    assert.deepEqual([first.source, first.frame, first.cached], ["video", 12, false]);
    assert.equal((await renderCover({ project, story: short, renderer: "hyperframes", video, grab })).cached, true);
    assert.deepEqual(grabs, [[video, 12]]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("the key shot must land in its beat, and the cover frame on the key shot", () => {
  const skeleton = skeletonById("dollar-a-second");
  // An odometer only at the very end (the loop beat): a key-shot module, but outside first or second.
  const late = story([scene("s1", "stat-card", 0, 24), scene("s2", "odometer", 24, 30)]);
  const check = structureCheck(late, skeleton, {});
  assert.equal(check.checks.key_shot.ok, false);
  assert.match(check.checks.key_shot.detail, /in first \(4\.2–9\.0 s, estimated\) or second \(12\.0–18\.0 s, estimated\); s2 use a key-shot module elsewhere/);
  // Timed from the narration when the beats are spoken.
  const words = ["start", "with", "a", "million", "now", "a", "billion"].map((text, i) => ({ text, start: i * 4 }));
  const timed = structureCheck(story([scene("s1", "stat-card", 0, 12), scene("s2", "odometer", 12, 30)]), skeleton, { words, beats: [{ role: "hook", spoken: "start with" }, { role: "proof", spoken: "a million" }, { role: "rehook", spoken: "now" }, { role: "escalation", spoken: "a billion" }] });
  assert.match(timed.checks.key_shot.detail, /^s2 \(odometer\) in first \(8\.0–16\.0 s\) or second \(20\.0–30\.0 s\)/);
  const covered = { ...story([scene("s1", "count-up", 0, 3), scene("s2", "odometer", 3, 18), scene("s3", "stat-card", 18, 30)]), cover: { text: "1995", frame: 25 } };
  assert.match(structureCheck(covered, skeleton, {}).checks.cover_frame.detail, /cover\.frame 25 s is not on a key-shot scene \(s1 0–3 s, s2 3–18 s\)/);
  assert.equal(structureCheck({ ...covered, cover: { text: "1995", frame: 10 } }, skeleton, {}).checks.cover_frame.ok, true);
  // A passing opening no longer prints what the structure wants.
  assert.equal(structureCheck(covered, skeleton, {}).checks.first_frame.detail, "opens on count-up at 0 s");
});

test("story validate warns when a short video's cover opens it", () => {
  const base = { schema: "launchclip.story.v1", lane: "motion", format: { width: 1080, height: 1920, fps: 30, duration: 20 }, brand: { colors: { bg: "#000000", paper: "#ffffff", ink: "#000000", primary: "#ff0000", accent: "#00ff00" }, fonts: { display: "Inter", body: "Inter" } }, scenes: [scene("s1", "count-up", 2, 20, { value: 5, label: "x" })] };
  assert.ok(validateStory({ ...base, cover: { text: "A billion?" } }).warnings.some((warning) => /cover\.frame is "first" \(the default\): a video of 90 s or less would open on a text card/.test(warning)));
  assert.ok(!validateStory({ ...base, cover: { text: "A billion?", frame: 10 } }).warnings.some((warning) => /cover\.frame is "first"/.test(warning)));
});
