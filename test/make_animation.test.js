// launchclip make --animation (docs/ANIMATION_PIPELINE_RFC.md §9, phase 5):
// the writers' room writes SCRIPT.json version 2 and voices it as a dialogue.
// No test here calls a model: the responses are fixtures in
// test/fixtures/make-animation/, written by hand in the shape each call's
// schema asks for, and served by a stub client (test/helpers/make_animation.js).
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SCREENPLAY_VERSION, screenplayNarration, validateScreenplay } from "@launchclip/core/screenplay.mjs";
import { runCli } from "../src/cli.js";
import { JUDGE_SCHEMA, PREMISE_SCHEMA, SCREENPLAY_SCHEMA, animationWordTarget, estimatedPace, normalizeCharacters, normalizeScreenplay, rankLoglines, standInCast } from "../src/make/animation.js";
import { formatMakeSummary } from "../src/make/index.js";
import { PROMPT, room as sharedRoom, schemas as allSchemas } from "./helpers/make_animation.js";

// These tests are about the writers' room and the voice, so every run stops
// after the show bible (--stop-after bible); test/make_animation_bible.test.js
// covers the bible and the shot list.
const room = async (options = {}) => {
  const t = await sharedRoom(options);
  const make = t.make;
  return { ...t, make: (extra = {}) => make({ stopAfter: "bible", ...extra }), calls: t.calls };
};
// The writers' room's calls: the designer's one call is the bible stage's.
const schemas = (calls) => allSchemas(calls).filter((name) => name !== "bible");
const writing = (calls) => calls.filter((call) => call.schemaName !== "launchclip_animation_bible");
const writingCosts = (report) => report.costs.items.map((item) => item.stage).filter((stage) => stage !== "bible");

test("make --animation writes a valid SCRIPT.json and a NARRATION.json with a narrator and two characters; a rerun reuses both", async () => {
  const t = await room();
  try {
    const report = await t.make();
    assert.equal(report.status, "awaiting-approval", JSON.stringify(report.stages));
    assert.equal(report.routing.lane, "motion");
    assert.equal(report.routing.kind, "animation");
    assert.ok(report.routing.reasons.some((reason) => /--animation: a character story/.test(reason)));
    // Three writing calls, in order, and no repair.
    assert.deepEqual(schemas(t.calls), ["premise", "loglines", "script"]);
    assert.deepEqual(writing(t.calls).map((call) => call.schema), [PREMISE_SCHEMA, JUDGE_SCHEMA, SCREENPLAY_SCHEMA]);
    assert.deepEqual(writingCosts(report), ["premise", "loglines", "script"]);
    assert.ok(report.costs.estimated_usd > 0);
    assert.equal(t.notices.filter((line) => /PAID call to openai gpt-5\.6-luna \(writers' room/.test(line)).length, 3);
    // The judge sees the brief and the loglines, never the writer's premise or its notes on each logline.
    const judge = t.calls[1].input;
    assert.match(judge, /Maya keeps shipping a fix that fails/);
    assert.match(judge, /2\. Sam watches Maya ship the same broken fix/);
    assert.doesNotMatch(judge, /before lunch|A bet gives it a clock|short, dry/);
    // The script call gets the story the scores chose, the cast and the word budget.
    const brief = t.calls[2].input;
    assert.match(brief, /Logline: Maya's deploy fails all morning until Sam asks/);
    assert.match(brief, /- maya: lead; wants to ship; speaks short, dry/);
    assert.match(brief, /- narrator: tells the story/);
    assert.match(brief, new RegExp(`about ${animationWordTarget(21)} spoken words`));
    assert.match(brief, /The problem beat must start within 12 seconds/);

    // This run was asked to stop after the show bible: nothing is planned or rendered.
    assert.equal(report.stages.prepare.status, "done");
    for (const stage of ["storyboard", "subject", "finish", "critic"]) {
      assert.equal(report.stages[stage].status, "skipped", stage);
      assert.match(report.stages[stage].reason, /approval of the show bible/);
    }
    assert.equal(report.stopped.after, "bible");
    assert.equal(report.final, null);
    assert.equal(report.gates, null);
    assert.ok(!existsSync(path.join(t.project, "storyboard.json")));
    assert.match(formatMakeSummary(report), /launchclip make: awaiting-approval \(motion lane/);
    assert.match(formatMakeSummary(report), /storyboard\s+skipped/);

    // SCRIPT.json: the screenplay contract.
    const script = await t.read("SCRIPT.json");
    assert.equal(script.schema_version, SCREENPLAY_VERSION);
    const contract = validateScreenplay(script, { duration: 21, wpm: script.take.wpm, problemLandsSeconds: 12 });
    assert.deepEqual(contract.errors, []);
    assert.deepEqual(contract.stats.characters, ["maya", "sam"]);
    assert.deepEqual(contract.stats.speakers, ["narrator", "maya", "sam"]);
    assert.deepEqual(contract.stats.beats, ["setup", "problem", "attempt", "turn", "resolution"]);
    assert.equal(script.check.ok, true, JSON.stringify(script.check.errors));
    assert.equal(script.logline, "Maya's deploy fails all morning until Sam asks the question she has been avoiding.");
    assert.deepEqual(script.premise, { want: "to ship the fix before lunch", obstacle: "the same failing deploy, again", change: "she runs the check first" });
    assert.equal(script.loglines.chosen, 0, "the best total score wins, not the judge's own pick");
    assert.deepEqual(script.loglines.options.map((option) => option.score), [8.25, 6.75, 3.75]);
    assert.deepEqual(script.passes.map((pass) => pass.kind), ["premise", "loglines", "write"]);
    const lines = script.beats.flatMap((beat) => beat.lines);
    assert.deepEqual(lines.map((line) => line.id), lines.map((_, index) => `l${index + 1}`));
    assert.deepEqual(lines[3], { id: "l4", speaker: null, action: "Maya turns to look at Sam.", seconds: 1.2 });
    assert.deepEqual(lines[2], { id: "l3", speaker: "sam", text: "Did you run the check?", playing: "gentle" }, "a speaker written as the name is the character's id");
    assert.equal(lines.at(-1).text, "Run the check first. Then ship.", "a repeated speaker label is not spoken");
    assert.equal(script.beats[0].place, "desk-laptop");
    assert.ok(!("place" in script.beats[2]), "a place the kit has no set for is left to the designer");

    // NARRATION.json: the dialogue, a speaker on every word.
    const narration = await t.read("NARRATION.json");
    assert.equal(narration.text, script.narration);
    assert.equal(narration.words.length, script.narration.split(" ").length);
    assert.deepEqual([...new Set(narration.words.map((word) => word.speaker))], ["narrator", "maya", "sam"]);
    const derived = screenplayNarration(script);
    assert.deepEqual(narration.lines.map((line) => [line.speaker, line.text]), derived.lines.map((line) => [line.speaker, line.text]));
    // A silent line is the pause after the line before it.
    assert.equal(narration.gaps[2], 1.2);
    assert.equal(narration.gaps[4], 1.5);
    assert.equal(narration.gaps[0], 0.3);
    assert.equal(t.takes.length, 8, "one take per spoken line");
    assert.equal(report.script.kind, "animation");
    assert.deepEqual(report.script.characters, ["maya", "sam"]);
    assert.deepEqual(report.script.lines, { spoken: 8, silent: 2 });
    assert.deepEqual(Object.keys(report.script.voices), ["narrator", "maya", "sam"]);
    assert.equal(report.script.reused, false);
    assert.ok(report.warnings.some((warning) => /every character speaks in the narrator's voice/.test(warning)), "the test voice has no voices to hand out");

    // Rerun: no model call, no take, the same files.
    const before = { calls: t.calls.length, takes: t.takes.length, script: await readFile(path.join(t.project, "SCRIPT.json"), "utf8"), narration: await readFile(path.join(t.project, "NARRATION.json"), "utf8") };
    const again = await t.make();
    assert.equal(t.calls.length, before.calls);
    assert.equal(t.takes.length, before.takes);
    assert.equal(again.status, "awaiting-approval");
    assert.equal(again.stages.prepare.status, "cached");
    assert.equal(again.stages.bible.status, "cached");
    assert.equal(again.script.reused, true);
    assert.equal(again.script.voice_reused, true);
    assert.deepEqual(again.costs.items, []);
    assert.equal(await readFile(path.join(t.project, "SCRIPT.json"), "utf8"), before.script);
    assert.equal(await readFile(path.join(t.project, "NARRATION.json"), "utf8"), before.narration);

    // A new target length is a new script.
    await t.make({ duration: 22 });
    assert.equal(t.calls.length, before.calls + 3);
  } finally {
    await t.done();
  }
});

test("a script that fails its checks gets one repair pass, with the findings", async () => {
  const t = await room({ scripts: ["script-bad", "script"] });
  try {
    const report = await t.make();
    assert.deepEqual(schemas(t.calls), ["premise", "loglines", "script", "script"]);
    assert.deepEqual(writingCosts(report), ["premise", "loglines", "script", "script-repair"]);
    const repair = writing(t.calls)[3].input;
    assert.match(repair, /## Repair/);
    assert.match(repair, /\[speaker-unknown\] \(line l3\) Line l3 is spoken by "priya"/);
    assert.match(repair, /\[silent-length\]/);
    assert.match(repair, /\[character-unused\] "sam" is listed but never speaks/);
    assert.match(repair, /\[fact-trace\] \(line l3\) "ninety percent" is not in the brief/);
    assert.match(repair, /l4 \[silent, 5s\] Maya stares at the screen\./);
    assert.match(repair, /l3 priya: It fails for ninety percent of teams\./);
    const script = await t.read("SCRIPT.json");
    assert.equal(script.check.ok, true);
    assert.deepEqual(script.passes.map((pass) => pass.kind), ["premise", "loglines", "write", "repair"]);
    assert.deepEqual(script.passes.at(-1).errors.slice(0, 2), ["speaker-unknown", "silent-length"]);
    assert.equal(script.logline, "Maya's deploy fails all morning until Sam asks the question she has been avoiding.", "a repair keeps the story");
    assert.equal(report.script.passes, 4);
    assert.ok(t.notices.some((line) => /script: 5 script check finding\(s\) \(speaker-unknown, silent-length, character-unused, fact-trace\); one repair pass/.test(line)));
  } finally {
    await t.done();
  }
});

test("a script still failing after the one repair is written with a warning, is not repaired again, and no cast is designed from it", async () => {
  const t = await room({ scripts: ["script-bad"] });
  try {
    const report = await t.make();
    assert.deepEqual(schemas(t.calls), ["premise", "loglines", "script", "script"], "one repair, never two");
    // A line belongs to someone who is not a character, so the bible stage refuses the script.
    assert.equal(report.status, "failed");
    assert.equal(report.failed_stage, "bible");
    assert.match(report.stages.bible.error, /gives lines to "priya", who is not in its characters \(maya, sam\)/);
    assert.ok(!existsSync(path.join(t.project, "BIBLE.json")));
    assert.equal(report.script.check.ok, false);
    assert.ok(report.script.check.errors.includes("speaker-unknown"));
    assert.ok(report.warnings.some((warning) => /the script still fails \d+ script check\(s\): speaker-unknown/.test(warning)));
    const script = await t.read("SCRIPT.json");
    assert.equal(script.check.ok, false);
    // The unknown speaker is still voiced (in the narrator's voice), so the take can be heard.
    const narration = await t.read("NARRATION.json");
    assert.ok(narration.words.some((word) => word.speaker === "priya"));
  } finally {
    await t.done();
  }
});

test("a script that passes the estimate but runs short once voiced spends the repair on the measured take", async () => {
  const t = await room();
  try {
    // 30 s wanted; the fixture script is written for about 21.
    const report = await t.make({ duration: 30 });
    assert.deepEqual(schemas(t.calls), ["premise", "loglines", "script", "script"]);
    assert.deepEqual(writingCosts(report), ["premise", "loglines", "script", "script-repair"]);
    const repair = writing(t.calls)[3].input;
    assert.match(repair, /Your previous script was voiced: it ran [\d.]+ seconds at \d+ words a minute/);
    assert.match(repair, /\[under-length\]/);
    const script = await t.read("SCRIPT.json");
    assert.ok(script.passes.at(-1).measured_seconds > 0);
    assert.ok(report.warnings.some((warning) => /the dialogue runs [\d.]+s, so the video is [\d.]+s \(target 30s\)/.test(warning)));
  } finally {
    await t.done();
  }
});

test("the room's pure parts: the cast, the judge's scores, the script's shape, the stand-in voices and the pace", async () => {
  // Ids: made valid, unique, never the narrator; four characters at most.
  const cast = normalizeCharacters([{ id: "Dr. Lee", name: "Dr. Lee", role: "lead" }, { id: "narrator", name: "Nora" }, { id: "nora", name: "Nora B" }, { id: "", name: "" }, { id: "a" }, { id: "b" }, { id: "c" }]);
  assert.deepEqual(cast.map((character) => character.id), ["dr-lee", "nora", "nora-b", "a"]);
  assert.equal(cast[0].name, "Dr. Lee");
  assert.equal(cast[0].voice_type, "either");

  const loglines = [{ logline: "one" }, { logline: "two" }, { logline: "three" }];
  const tie = rankLoglines(loglines, { scores: [{ index: 1, hook: 5, turn: 5, playable: 5, brief: 5 }, { index: 2, hook: 5, turn: 5, playable: 5, brief: 5 }], chosen: 2 });
  assert.equal(tie.chosen, 1, "a tie goes to the judge's own pick");
  assert.equal(tie.scores[2].score, 0, "a logline the judge skipped scores 0");
  assert.equal(rankLoglines(loglines, { scores: [], chosen: 3 }).chosen, 2, "no scores: the judge's pick");
  assert.equal(rankLoglines(loglines, null).chosen, 0, "no answer: the first");
  assert.equal(rankLoglines(loglines, { scores: [{ index: 3, hook: 99, turn: -4, playable: 10, brief: 10 }], chosen: 1 }).scores[2].score, 7.5, "scores are held to 0-10");

  // Unknown speakers and beats are kept for the check to name; empty lines and beats go.
  const play = normalizeScreenplay({ title: "", beats: [{ beat: "Setup", place: "", lines: [{ speaker: "ghost", text: "Boo.", playing: "", action: "", seconds: 0 }, { speaker: "", text: "", playing: "", action: "", seconds: 0 }] }, { beat: "setup", place: "", lines: [{ speaker: "none", text: "", playing: "", action: "A door closes.", seconds: 0 }] }, { beat: "finale", place: "", lines: [] }] }, { characters: [{ id: "maya" }] });
  assert.equal(play.title, "Untitled");
  assert.deepEqual(play.beats, [{ beat: "setup", lines: [{ id: "l1", speaker: "ghost", text: "Boo." }, { id: "l2", speaker: null, action: "A door closes.", seconds: 1 }] }]);
  assert.equal(play.narration, "Boo.");
  assert.ok(validateScreenplay(play).errors.some((error) => error.id === "speaker-unknown"));

  // Kokoro: a voice each, by type, never the narrator's; any other provider: the narrator speaks for them.
  const characters = [{ id: "maya", voice_type: "female" }, { id: "sam", voice_type: "male" }, { id: "kit", voice_type: "female" }];
  assert.deepEqual(standInCast(characters, { provider: "kokoro", narratorVoice: "af_bella" }), [{ id: "maya", voice: "bf_emma" }, { id: "sam", voice: "am_michael" }, { id: "kit", voice: "af_nova" }]);
  assert.deepEqual(standInCast(characters.slice(0, 1), { provider: "elevenlabs", narratorVoice: "abc" }), [{ id: "maya", voice: null }]);

  assert.equal(estimatedPace("kokoro", 1.2), 180);
  assert.equal(estimatedPace("elevenlabs", 1), 150);
  assert.equal(animationWordTarget(30, 180), 72);
});

test("under Kokoro each character gets a voice of its own for its lines", async () => {
  const t = await room();
  try {
    // The Kokoro provider is stood in for by the test tone; the voices asked for are what is checked.
    const { createTestVoiceProvider } = await import("../src/voice/index.js");
    t.adapters.voiceProvider = () => ({ ...createTestVoiceProvider(), name: "kokoro" });
    const report = await t.make({ voice: "kokoro" });
    assert.deepEqual(report.script.voices, { narrator: "af_heart", maya: "af_bella", sam: "am_michael" });
    const narration = await t.read("NARRATION.json");
    assert.deepEqual([...new Set(narration.lines.map((line) => `${line.speaker}:${line.voice}`))], ["narrator:af_heart", "maya:af_bella", "sam:am_michael"]);
    assert.ok(!report.warnings.some((warning) => /narrator's voice/.test(warning)));
    assert.match(writing(t.calls)[2].input, /about 180 words a minute/, "the script is written for Kokoro's pace");
  } finally {
    await t.done();
  }
});

// The real join runs ffmpeg, which the CI test jobs lack.
test("with ffmpeg, the dialogue is joined into one take and a rerun reuses it", async (t) => {
  try { await new Promise((resolve, reject) => execFile("ffmpeg", ["-version"], (error) => (error ? reject(error) : resolve()))); } catch { t.skip("ffmpeg is unavailable"); return; }
  const r = await room();
  try {
    delete r.adapters.synthesizeDialogue;
    const report = await r.make();
    assert.equal(report.status, "awaiting-approval", JSON.stringify(report.stages));
    const narration = await r.read("NARRATION.json");
    assert.deepEqual([...new Set(narration.words.map((word) => word.speaker))], ["narrator", "maya", "sam"]);
    assert.ok(existsSync(path.join(r.project, ".launchclip/make/narration.wav")));
    const again = await r.make();
    assert.equal(again.script.voice_reused, true);
    assert.equal(r.calls.length, 4);
  } finally {
    await r.done();
  }
});

test("the CLI takes --animation as a switch", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-animation-cli-"));
  const stdout = { text: "", write(chunk) { this.text += chunk; } };
  const saved = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, LAUNCHCLIP_MAKE_MODEL: process.env.LAUNCHCLIP_MAKE_MODEL };
  for (const key of Object.keys(saved)) delete process.env[key];
  try {
    // --animation before another flag parses as a switch; with no key the run fails at the model stage, before any call.
    await assert.rejects(runCli(["make", PROMPT, "--animation", "--out", out], { stdout, stderr: { write() {} } }), /launchclip make failed at the model stage/);
    assert.match(stdout.text, /launchclip make: failed/);
  } finally {
    for (const [key, value] of Object.entries(saved)) if (value !== undefined) process.env[key] = value;
    await rm(out, { recursive: true, force: true });
  }
});
