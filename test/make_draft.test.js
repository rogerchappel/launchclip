// A fast draft (make --speed draft) and its refine, on recorded answers.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { characterShare } from "@launchclip/core/explainer.mjs";
import { resolveStory } from "@launchclip/core/story.mjs";
import { applyDraftDirection, deadlineProvider, joinSentenceTakes, ruleClient } from "../src/make/draft.js";
import { draftLines, draftStoryboard, lineTitle } from "../src/make/draft_plan.js";
import { makeOptionsFromFlags, makeSpeed, validateMakeOptions } from "../src/make/options.js";
import { sentenceStream } from "../src/make/script.js";
import { planStoryboard } from "../src/storyboard_planner.js";
import { getVoiceProvider, testVoiceTimings } from "../src/voice/index.js";
import { readWav } from "../src/voice/words.js";
import { DRAFT_DIRECTION, DRAFT_NARRATION, DRAFT_SENTENCES, draftRun } from "./helpers/draft_fakes.js";
import { recordedRun } from "./helpers/make_recorded_run.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref());

test("--speed draft: one streamed script call, a take per sentence, a rule-made plan with one direction call, and a stop at the plan", async () => {
  const draft = await draftRun();
  try {
    const { report, events } = await draft.run({ speed: "draft" });
    // Two model calls in all: no concepts, judge, story, retention edit, repair, direction map or storyboard call.
    assert.deepEqual(draft.calls, ["launchclip_make_draft_script", "launchclip_draft_direction"]);
    assert.equal(draft.requests[0].reasoningEffort, "low");
    assert.equal(draft.requests[1].reasoningEffort, "low");
    // The run ends at the plan: nothing after the storyboard ran (the finish stand-in throws).
    assert.equal(report.status, "awaiting-approval");
    assert.deepEqual(report.stopped.after, "storyboard");
    for (const stage of ["candidates", "animatic", "subject", "finish", "critic"]) assert.equal(report.stages[stage].status, "skipped", stage);
    assert.equal(report.gates, null);
    assert.equal(report.concept.status, "off");
    assert.equal(report.research_decision.run, false);
    assert.match(report.next_steps[0], /--refine/);
    assert.match(report.next_steps[1], /launchclip finish /);
    // A host can show the script as it is written: a line a sentence, then the script, the voice and the plan.
    const steps = events.filter((event) => event.step).map((event) => event.step);
    assert.deepEqual(steps, [...DRAFT_SENTENCES.map(() => "sentence"), "script", "voice", "plan"]);
    assert.deepEqual(events.filter((event) => event.step === "sentence").map((event) => event.text), DRAFT_SENTENCES);
    assert.equal(events.find((event) => event.step === "script").status, "ready");
    // The voice: one take a sentence, then the narration joined from them (never the whole text in one request).
    assert.deepEqual([...draft.voiced].sort(), [...DRAFT_SENTENCES].sort());
    const narration = await draft.read("NARRATION.json");
    assert.equal(narration.text, DRAFT_NARRATION);
    assert.equal(narration.words.map((word) => word.text).join(" "), DRAFT_NARRATION);
    for (let index = 1; index < narration.words.length; index += 1) assert.ok(narration.words[index].start >= narration.words[index - 1].end, `word ${index} starts after the one before it`);
    const wav = await readWav(path.join(draft.project, ".launchclip/make/narration.wav"));
    assert.ok(Math.abs(wav.duration - narration.duration_seconds) < 0.01);
    // The script is a draft's: the plan's budget, no repair or resize pass.
    const script = await draft.read("SCRIPT.json");
    assert.equal(script.draft, true);
    assert.equal(script.narration, DRAFT_NARRATION);
    assert.deepEqual(script.passes.map((pass) => pass.kind), ["draft"]);
    assert.ok(script.word_count <= script.plan.word_ceiling);
    // The storyboard: the direction call's cast and its hook, on the rule-made scenes; characters carry it.
    const story = await draft.read("storyboard.json");
    assert.deepEqual(story.cast.characters.map((member) => member.id), ["jar", "yeast"]);
    assert.equal(story.scenes[0].module, "character-cameo");
    assert.equal(story.scenes[0].start, 0);
    assert.deepEqual([story.scenes[0].params.character, story.scenes[0].params.pose, story.scenes[0].params.card.title], ["jar", "shrug", "Why a starter?"]);
    assert.equal(story.scenes.at(-1).module, "cta");
    assert.ok(characterShare(resolveStory(structuredClone(story), { words: narration.words })).share >= 0.5);
    assert.ok(existsSync(path.join(draft.project, "DIRECTION.json")));
    // The report says what was draft-made and how long each part took.
    assert.deepEqual(report.draft.parts, { script: "draft", voice: "draft", storyboard: "draft", render: "none" });
    assert.equal(report.draft.storyboard.source, "rules+direction");
    assert.equal(report.draft.storyboard.direction.status, "applied");
    assert.equal(report.draft.voice.sentences, DRAFT_SENTENCES.length);
    assert.deepEqual(Object.keys(report.milestones), ["first_sentence_seconds", "script_seconds", "voice_seconds", "plan_seconds"]);
    assert.deepEqual(report.costs.items.map((item) => item.stage), ["draft-script", "draft-direction"]);
    assert.equal(report.options.speed, "draft");

    // The same command again reuses the script, the voice and the plan: no call, no take.
    const calls = draft.calls.length;
    const voiced = draft.voiced.length;
    const again = await draft.run({ speed: "draft" });
    assert.equal(draft.calls.length, calls);
    assert.equal(draft.voiced.length, voiced);
    assert.equal(again.report.stages.storyboard.status, "cached");
    assert.equal(again.report.status, "awaiting-approval");
    assert.equal(again.report.draft.parts.storyboard, "draft");
  } finally { await draft.cleanup(); }
});

test("a direction call that is late leaves the rule-made plan standing, and the run does not wait for it", async () => {
  const draft = await draftRun({ directionMs: 2500, env: { LAUNCHCLIP_DRAFT_DIRECTION_MS: "30" } });
  try {
    const started = performance.now();
    const { report } = await draft.run({ speed: "draft" });
    assert.ok(performance.now() - started < 2400, "the run ended before the late call answered");
    assert.equal(report.status, "awaiting-approval");
    assert.equal(report.draft.storyboard.source, "rules");
    assert.equal(report.draft.storyboard.direction.status, "late");
    const story = await draft.read("storyboard.json");
    assert.deepEqual(story.cast.characters.map((member) => member.id), ["guide", "spark"]);
    assert.equal(story.scenes[0].params.character, "guide");
    // What the late call cost is not known: the tally says so instead of leaving it out.
    assert.equal(report.costs.items.find((item) => item.stage === "draft-direction").estimated_usd, null);
    assert.equal(report.costs.complete, false);
  } finally { await draft.cleanup(); }
});

test("a direction answer the kit cannot use, or a failed call, leaves the rule-made plan standing", async () => {
  for (const [direction, status] of [[{ cast: [{ id: "x", kind: "dragon", plays: "?" }], scenes: [{ id: "d1", character: "nobody", pose: "fly", expression: "glow", title: "", kicker: "" }] }, "invalid"], [() => { throw new Error("503 from the provider"); }, "failed"], [{ nonsense: true }, "invalid"]]) {
    const draft = await draftRun({ direction });
    try {
      const { report } = await draft.run({ speed: "draft" });
      assert.equal(report.status, "awaiting-approval", status);
      assert.equal(report.draft.storyboard.direction.status, status);
      assert.equal(report.draft.storyboard.source, "rules");
      assert.deepEqual((await draft.read("storyboard.json")).cast.characters.map((member) => member.id), ["guide", "spark"]);
    } finally { await draft.cleanup(); }
  }
});

test("LAUNCHCLIP_DRAFT_DIRECTION_MS=0 sends no direction call: the draft is one model call", async () => {
  const draft = await draftRun({ env: { LAUNCHCLIP_DRAFT_DIRECTION_MS: "0" } });
  try {
    const { report } = await draft.run({ speed: "draft" });
    assert.deepEqual(draft.calls, ["launchclip_make_draft_script"]);
    assert.equal(report.draft.storyboard.direction.status, "off");
    assert.equal(report.status, "awaiting-approval");
  } finally { await draft.cleanup(); }
});

test("a draft asks the asset provider for every shot at once; a clip that is late is drawn instead", async () => {
  const draft = await draftRun({ env: { LAUNCHCLIP_DRAFT_SHOT_MS: "200", LAUNCHCLIP_DRAFT_DIRECTION_MS: "0" } });
  const clip = path.join(draft.cwd, "clip.mp4");
  await writeFile(clip, "a clip");
  try {
    const asked = [];
    let open = 0;
    let peak = 0;
    const assets = {
      // An app's provider that says nothing about concurrency: the draft still sends its requests together.
      async findShot(request) {
        asked.push(request);
        open += 1;
        peak = Math.max(peak, open);
        // The first request answers at once; every other one takes longer than the draft waits.
        const first = asked.length === 1;
        await wait(first ? 5 : 2500);
        open -= 1;
        return first ? { file: clip, kind: "video" } : null;
      }
    };
    const started = performance.now();
    const { report } = await draft.run({ speed: "draft", minShots: 2 }, { assets });
    assert.ok(performance.now() - started < 2400, "the run did not wait for the late clips");
    assert.equal(report.status, "awaiting-approval");
    assert.ok(asked.length >= 2, `asked for ${asked.length} shots`);
    assert.equal(peak, asked.length, "every request was in flight together");
    const story = await draft.read("storyboard.json");
    const clips = story.scenes.filter((scene) => scene.module === "clip");
    assert.equal(clips.length, 1);
    assert.match(clips[0].params.media.src, /^assets\/shots\//);
    assert.ok(existsSync(path.join(draft.project, clips[0].params.media.src)));
    // The late ones: drawn scenes with the same ids, and the report says so.
    for (const request of asked.slice(1)) assert.equal(story.scenes.find((scene) => scene.id === request.scene_id).module, "character-cameo");
    assert.deepEqual(report.draft.storyboard.shots, { asked: asked.length, answered: 1, late: asked.length - 1, deadline_seconds: 0.2 });
    assert.equal(report.warnings.filter((warning) => /^draft: scene d\d+: .*the scene is drawn instead \(character-cameo\)/.test(warning)).length, asked.length - 1);
    assert.equal(report.shots.length, 1);
  } finally { await draft.cleanup(); }
});

test("--refine keeps the draft's script and voice and plans the storyboard the ordinary way", async () => {
  const draft = await draftRun();
  try {
    await draft.run({ speed: "draft" });
    const script = await draft.read("SCRIPT.json");
    const narration = await readFile(path.join(draft.project, "NARRATION.json"), "utf8");
    const drafted = await draft.read("storyboard.json");
    const calls = draft.calls.length;
    const voiced = draft.voiced.length;
    const { report } = await draft.run({ refine: true });
    // The full plan's calls, and nothing for the script or the voice.
    assert.deepEqual([...new Set(draft.calls.slice(calls))], ["launchclip_direction", "launchclip_storyboard"]);
    assert.equal(draft.voiced.length, voiced);
    const kept = await draft.read("SCRIPT.json");
    assert.deepEqual([kept.narration, kept.beats, kept.title, kept.draft, kept.passes], [script.narration, script.beats, script.title, true, script.passes]);
    assert.equal(await readFile(path.join(draft.project, "NARRATION.json"), "utf8"), narration);
    // The storyboard is the refined one; the draft's is kept beside it.
    const refined = await draft.read("storyboard.json");
    assert.ok(refined.scenes.every((scene) => scene.id.startsWith("r")));
    assert.deepEqual(await draft.read(".launchclip/draft/storyboard.json"), drafted);
    assert.equal(report.status, "awaiting-approval");
    assert.equal(report.stopped.after, "storyboard");
    assert.equal(report.draft.mode, "refine");
    assert.deepEqual(report.draft.parts, { script: "draft", voice: "draft", storyboard: "refined", render: "none" });
    assert.equal(report.draft.draft_storyboard, ".launchclip/draft/storyboard.json");
    assert.equal(report.script.reused, true);
    assert.equal(report.script.draft, true);
    assert.equal(report.concept.status, "off");
    assert.match(report.next_steps.at(-1), /launchclip finish /);
    // A refine again reuses the refined plan.
    const again = await draft.run({ refine: true });
    assert.equal(again.report.stages.storyboard.status, "cached");
    assert.deepEqual(again.report.draft.parts, { script: "draft", voice: "draft", storyboard: "refined", render: "none" });
  } finally { await draft.cleanup(); }
});

test("--refine on a project with no draft fails with the next step, and the flags are checked", async () => {
  const draft = await draftRun();
  try {
    const { report } = await draft.run({ refine: true });
    assert.equal(report.status, "failed");
    assert.equal(report.failed_stage, "prepare");
    assert.match(report.stages.prepare.error, /--refine continues a fast draft.*--speed draft/);
    assert.equal(draft.calls.length, 0);
  } finally { await draft.cleanup(); }
  assert.equal(makeSpeed(undefined), "standard");
  assert.equal(makeSpeed("Draft"), "draft");
  assert.throws(() => validateMakeOptions({ speed: "fast" }), /--speed must be standard or draft; got fast/);
  assert.throws(() => validateMakeOptions({ speed: "draft", refine: true }), /--speed draft or --refine, not both/);
  assert.throws(() => validateMakeOptions({ draftModel: "luna" }), /--draft-model must be provider:model/);
  assert.deepEqual((({ speed, draftModel, refine }) => ({ speed, draftModel, refine }))(makeOptionsFromFlags({ speed: "draft", "draft-model": "openai:gpt-5.6-luna@low", refine: true })), { speed: "draft", draftModel: "openai:gpt-5.6-luna@low", refine: true });
  assert.equal(makeOptionsFromFlags({}).refine, undefined);
});

test("the default run has no draft in it: the same calls, stages and progress steps as before", async () => {
  const recorded = await recordedRun({ screenshots: [] });
  try {
    const { report, lines, calls } = await recorded.run();
    assert.equal(report.draft, undefined);
    assert.equal(report.options.speed, undefined);
    assert.equal(report.stopped, undefined);
    assert.equal(report.stages.finish.status, "done");
    assert.ok(calls.includes("launchclip_make_script") && calls.includes("launchclip_storyboard"));
    assert.ok(!calls.some((name) => /draft/.test(name)));
    assert.ok(!lines.some((line) => /"step":"(sentence|script|voice|plan)"/.test(line)));
    assert.equal(report.milestones, undefined);
  } finally { await recorded.cleanup(); }
});

test("the sentences of a draft script arrive as its JSON streams, whatever the pieces", () => {
  const json = JSON.stringify({ title: "T", beats: [{ beat: "hook", text: "Why does bread rise? It is the \"yeast\" and 4.5 hours." }, { beat: "cta", text: "Save this — now.\nFollow." }], call_to_action: "Save this." });
  for (const size of [1, 3, 7, 50, json.length]) {
    const stream = sentenceStream();
    const got = [];
    for (let at = 0; at < json.length; at += size) got.push(...stream.feed(json.slice(at, at + size)));
    assert.deepEqual(got, ["Why does bread rise?", "It is the \"yeast\" and 4.5 hours.", "Save this — now.", "Follow."], `pieces of ${size}`);
  }
});

test("the rule-made storyboard passes the planner's checks in every frame, with and without shots", async () => {
  const texts = [
    DRAFT_NARRATION,
    "Payouts never match your books. Ledgerly matches each payout to its invoice. Try Ledgerly free.",
    "Your phone battery does not die because it is old. It dies because of heat, deep drains, and fast charging every single night, which slowly wears out the lithium inside until it can no longer hold the charge it once did when you first unboxed it. Keep it between twenty and eighty percent. Follow for more.",
    "One."
  ];
  for (const text of texts) for (const [width, height] of [[1080, 1920], [1920, 1080], [1080, 1080]]) for (const shots of [null, { min: 2, max: 6 }]) {
    const { words, duration } = testVoiceTimings(text, {});
    const format = { width, height, fps: 30, duration: Math.round((duration + 0.8) * 10) / 10 };
    const draft = draftStoryboard({ words, format, shots });
    // No provider answers: every shot falls back to its drawn scene.
    const assets = shots ? { concurrency: 8, async findShot() { return null; } } : null;
    const plan = await planStoryboard({ brief: text, words, lane: "motion", format, client: ruleClient(draft.storyboard), model: "rules:beat-director", maxRepairs: 0, explainer: true, direction: true, explainerCast: { cast: draft.cast, roles: [] }, ...(assets ? { assets, shotFallback: draft.fallbacks } : {}) });
    const label = `${text.slice(0, 24)}… ${width}x${height} shots=${Boolean(shots)}`;
    assert.equal(plan.status, "passed", `${label}: ${plan.errors.join("; ")}`);
    assert.ok(plan.explainer.character_share >= 0.5, label);
    assert.equal(plan.storyboard.scenes[0].start, 0);
    assert.ok(plan.storyboard.scenes.every((scene) => !scene.params?.media || scene.params.media.kind !== "shot"), `${label}: no request is left in the plan`);
    if (shots && draft.lines.length >= 5) assert.ok(Object.keys(draft.fallbacks).length >= 1, `${label}: asked for a shot`);
  }
});

test("the rule-made lines: sentences, a long one cut at its clauses, a short one joined; titles are the line's own words", () => {
  const { words } = testVoiceTimings(DRAFT_NARRATION, {});
  const lines = draftLines(words);
  assert.equal(lines.map((line) => line.text).join(" "), DRAFT_NARRATION);
  for (const line of lines) assert.ok(line.end - line.start <= 4.5 * 1.25 + 0.01, `${line.text} holds ${line.end - line.start}s`);
  assert.ok("But inside that jar, two tiny workers are busy.".includes(lineTitle("But inside that jar, two tiny workers are busy.", 3)));
  assert.ok(lineTitle("Most people think it is just for the sour taste.", 2.2).split(" ").length <= 6);
  assert.equal(lineTitle("Most people think it is just for the sour taste.", 1.2), "Most people");
  assert.ok(DRAFT_NARRATION.includes(lineTitle("Wild yeast eats the flour and makes gas, and the gas lifts the loaf.", 4)));
  // Supplied media is shown in order, one a line, and characters keep their share.
  const format = { width: 1920, height: 1080, fps: 30, duration: words.at(-1).end + 0.8 };
  const made = draftStoryboard({ words, format, media: [{ src: "assets/a.png", kind: "image" }, { src: "assets/b.mp4", kind: "video" }, { src: "assets/notes.md", kind: "notes" }] });
  assert.deepEqual(made.storyboard.scenes.filter((scene) => scene.module === "media-window").map((scene) => scene.params.media.src), ["assets/a.png", "assets/b.mp4"].slice(0, made.storyboard.scenes.filter((scene) => scene.module === "media-window").length));
  assert.ok(made.character_share >= 0.5);
});

test("a direction answer is applied field by field: what the kit has is kept, the rest is ignored", () => {
  const { words, duration } = testVoiceTimings(DRAFT_NARRATION, {});
  const rule = { words, format: { width: 1080, height: 1920, fps: 30, duration: duration + 0.8 } };
  const applied = applyDraftDirection(rule, { ...DRAFT_DIRECTION, scenes: [...DRAFT_DIRECTION.scenes, { id: "d2", character: "nobody", pose: "fly", expression: "smirk", title: "A title far too long for the few seconds this short scene has on screen", kicker: "" }] });
  assert.deepEqual(applied.explainer.cast.characters.map((member) => member.kind), ["cup", "blob"]);
  const [first, second] = applied.storyboard.scenes;
  assert.equal(first.params.card.title, "Why a starter?");
  // d2: the unknown character and pose and the long title are ignored; the expression is one the kit has.
  assert.equal(second.params.expression, "smirk");
  assert.notEqual(second.params.character, "nobody");
  assert.notEqual(second.params.pose, "fly");
  assert.ok(second.params.card.title.split(" ").length <= 7);
  assert.equal(applyDraftDirection(rule, { cast: [], scenes: [] }), null);
  assert.equal(applyDraftDirection(rule, "no"), null);
});

test("sentence takes join into one narration on one clock; a provider's late answer is null", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-draft-join-"));
  try {
    const provider = getVoiceProvider("test", {});
    const takes = [];
    for (const [index, text] of ["One two three.", "Four five."].entries()) takes.push(await provider.synthesize({ text, speed: 1, outFile: path.join(dir, `${index}.wav`) }));
    const joined = await joinSentenceTakes(takes.map((take, index) => ({ ...take, file: path.join(dir, `${index}.wav`) })), path.join(dir, "joined.wav"), { gap: 0.1 });
    assert.deepEqual(joined.words.map((word) => word.text), ["One", "two", "three.", "Four", "five."]);
    assert.ok(Math.abs(joined.duration - (takes[0].duration + 0.1 + takes[1].duration)) < 0.005);
    assert.ok(Math.abs(joined.words[3].start - (takes[0].duration + 0.1 + takes[1].words[0].start)) < 0.005);
    assert.ok(Math.abs((await readWav(joined.file)).duration - joined.duration) < 0.005);
  } finally { await rm(dir, { recursive: true, force: true }); }
  const provider = deadlineProvider({ async findShot(request) { await wait(request.id === "slow" ? 120 : 1); return { src: `assets/${request.id}.mp4` }; } }, 40);
  assert.ok(provider.concurrency >= 2);
  const [quick, slow] = await Promise.all([provider.findShot({ id: "quick" }), provider.findShot({ id: "slow" })]);
  assert.deepEqual(quick, { src: "assets/quick.mp4" });
  assert.equal(slow, null);
  assert.deepEqual(provider.late, ["slow"]);
  await wait(100);
});
