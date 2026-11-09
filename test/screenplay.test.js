// The screenplay contract (SCRIPT.json version 2, kit/core/screenplay.mjs):
// a two-character script validates, every rule has a failing case, a version
// 1 script still reads, and the derived lines are voiced speaker by speaker.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateStory } from "@launchclip/core/story.mjs";
import {
  MAX_SILENCE_SECONDS,
  NARRATED_SCRIPT_VERSION,
  SCREENPLAY_VERSION,
  isScreenplay,
  readScreenplay,
  screenplayNarration,
  screenplayText,
  screenplayTiming,
  spokenLines,
  validateScreenplay
} from "@launchclip/core/screenplay.mjs";
import { runCli } from "../src/cli.js";
import { SCRIPT_VERSION } from "../src/make/script.js";
import { checkScreenplay, formatScriptCheck } from "../src/script_check.js";
import { parseScriptFile, runScriptCheck } from "../src/script_check_cli.js";
import { scriptBeats } from "../src/skeletons.js";
import { runVoiceCommand } from "../src/voice_cli.js";

const FIXTURE = path.resolve(import.meta.dirname, "fixtures/screenplay/two-characters.json");
const BRIEF = "Maya ships a fix three times. The check takes one minute, the deploy takes ten.";
const OPTIONS = { duration: 25, problemLandsSeconds: 12 };
const good = async () => JSON.parse(await readFile(FIXTURE, "utf8"));
const ids = (list) => list.map((item) => item.id);
/** The fixture with one change, and its narration rebuilt from the lines unless the case is about it. */
async function changed(edit, { narration = true } = {}) {
  const script = await good();
  edit(script);
  if (narration) script.narration = screenplayText(script);
  return script;
}

test("a hand-written two-character script validates", async () => {
  const script = await good();
  assert.equal(script.schema_version, SCREENPLAY_VERSION);
  assert.equal(isScreenplay(script), true);
  const report = validateScreenplay(script, OPTIONS);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
  assert.equal(report.ok, true);
  assert.deepEqual(report.stats.speakers, ["narrator", "maya", "sam"]);
  assert.deepEqual(report.stats.characters, ["maya", "sam"]);
  assert.equal(report.stats.spoken_lines, 8);
  assert.equal(report.stats.silent_lines, 2);
  assert.equal(report.stats.problem_seconds, 3.5);
  // And it passes the script checks on its spoken lines, with its figures traced to the brief.
  const full = checkScreenplay({ script, ...OPTIONS, brief: BRIEF });
  assert.deepEqual(full.errors, []);
  assert.equal(full.ok, true);
  assert.equal(full.stats.format, "story");
  assert.equal(full.stats.screenplay.spoken_lines, 8);
});

// Every rule in docs/ANIMATION_PIPELINE_RFC.md §4.1, each with a script that breaks it.
const FAILING = [
  ["a speaker who is not a listed character", "speaker-unknown", (s) => { s.beats[1].lines[1].speaker = "theo"; }],
  ["a listed character who never speaks or acts", "character-unused", (s) => { s.characters.push({ id: "theo", role: "extra" }); }],
  ["a silent line with no action", "line-shape", (s) => { delete s.beats[1].lines[2].action; }],
  ["a silent line with no length", "silent-length", (s) => { delete s.beats[1].lines[2].seconds; }],
  ["a silent line longer than a pause can be", "silent-length", (s) => { s.beats[1].lines[2].seconds = MAX_SILENCE_SECONDS + 0.5; }],
  ["silent lines in a row that add up to more than a pause", "silent-length", (s) => { s.beats[1].lines.push({ id: "l4b", speaker: null, action: "Sam waits.", seconds: 2.5 }); }],
  ["a spoken line with no text", "line-shape", (s) => { s.beats[2].lines[0].text = " "; }],
  ["a spoken line that carries an action", "line-shape", (s) => { s.beats[2].lines[0].action = "Maya sighs."; }],
  ["a line with no speaker field", "line-shape", (s) => { delete s.beats[2].lines[0].speaker; }],
  ["a line with no id", "line-id", (s) => { delete s.beats[2].lines[0].id; }],
  ["two lines with one id", "line-id", (s) => { s.beats[2].lines[1].id = "l5"; }],
  ["a beat that is not a story beat", "beat-name", (s) => { s.beats[0].beat = "hook"; }],
  ["a character called narrator", "script-shape", (s) => { s.characters.push({ id: "narrator" }); }],
  ["a character listed twice", "script-shape", (s) => { s.characters.push({ id: "maya" }); }],
  ["narration that is not the spoken lines joined", "narration-mismatch", (s) => { s.narration = `${s.narration} Maya turns to look at him.`; }, { narration: false }],
  ["a playing note inside the narration", "narration-mismatch", (s) => { s.narration = s.narration.replace("Third time.", "Third time, flat, to herself."); }, { narration: false }],
  ["no problem beat", "problem-missing", (s) => { s.beats[1].beat = "attempt"; }],
  ["a problem that lands too late", "problem-lands", (s) => { s.beats[0].lines[0].text = "Maya has shipped this fix three times today, and each time she pushed it the build went red, and each time she said it was the last time, and each time she was wrong about that."; }, { duration: 60 }],
  ["more words than the length holds at the voice's pace", "fits-length", () => {}, { duration: 15 }],
  ["a slower measured voice that no longer fits", "fits-length", () => {}, { wpm: 100 }]
];

for (const [name, id, edit, extra = {}] of FAILING) {
  test(`a screenplay fails on ${name} (${id})`, async () => {
    const { narration, ...options } = extra;
    const report = validateScreenplay(await changed(edit, { narration }), { ...OPTIONS, ...options });
    assert.equal(report.ok, false);
    assert.ok(ids(report.errors).includes(id), `expected ${id}, got ${ids(report.errors).join(", ") || "no errors"}`);
    for (const error of report.errors) assert.ok(error.message && error.fix, "every error says what is wrong and how to fix it");
  });
}

test("a character who only acts is used, by id or by name", async () => {
  const byId = await changed((s) => { s.characters.push({ id: "theo", role: "extra" }); s.beats[3].lines[0].action = "Theo walks past. Maya runs the check."; });
  assert.deepEqual(validateScreenplay(byId, OPTIONS).errors, []);
  const byName = await changed((s) => { s.characters.push({ id: "it-lead", name: "Priya", role: "extra" }); s.beats[3].lines[0].action = "Priya walks past. Maya runs the check."; });
  assert.deepEqual(validateScreenplay(byName, OPTIONS).errors, []);
  // A name inside another word is not a mention.
  const inside = await changed((s) => { s.characters.push({ id: "may", role: "extra" }); });
  assert.ok(ids(validateScreenplay(inside, OPTIONS).errors).includes("character-unused"));
});

test("a spoken line that breaks today's script checks fails, and names its line", async () => {
  const long = await changed((s) => { s.beats[2].lines[0].text = "The check takes a whole minute and then it wants a second minute and then it prints a wall of text that nobody on this team has ever once read to the end."; });
  const report = checkScreenplay({ script: long, duration: 35, problemLandsSeconds: 12, brief: BRIEF });
  const error = report.errors.find((item) => item.id === "sentence-length");
  assert.ok(error, ids(report.errors).join(", "));
  assert.equal(error.line, "l5");
  assert.equal(error.speaker, "maya");
  assert.match(formatScriptCheck(report, { label: "SCRIPT.json" }), /error: \[sentence-length\] \(line l5\)/);
  const filler = await changed((s) => { s.beats[0].lines[0].text = "Hey guys, welcome back. Maya has shipped this fix three times today."; });
  assert.ok(ids(checkScreenplay({ script: filler, ...OPTIONS, duration: 28, brief: BRIEF }).errors).includes("opener-filler"));
  // A stage direction written into the words is caught as a placeholder.
  const direction = await changed((s) => { s.beats[1].lines[0].text = "[sighs] Third time. Same red build."; });
  assert.ok(ids(checkScreenplay({ script: direction, ...OPTIONS, brief: BRIEF }).errors).includes("placeholder"));
});

test("figures and claims in a line follow the evidence rules", async () => {
  const figure = await changed((s) => { s.beats[4].lines[0].text = "One minute of checking saved her forty per cent of the afternoon."; });
  const report = checkScreenplay({ script: figure, ...OPTIONS, brief: BRIEF });
  const error = report.errors.find((item) => item.id === "fact-trace");
  assert.ok(error, ids(report.errors).join(", "));
  assert.equal(error.line, "l9");
  assert.equal(error.speaker, "narrator");
  const proof = await changed((s) => { s.beats[4].lines[1].text = "Trusted by ten thousand teams. Run the check first."; });
  assert.ok(ids(checkScreenplay({ script: proof, ...OPTIONS, brief: BRIEF }).errors).some((id) => ["social-proof", "fact-trace"].includes(id)));
  // With no brief nothing can be traced, and the report says so.
  assert.ok(ids(checkScreenplay({ script: figure, ...OPTIONS }).warnings).includes("no-brief"));
});

test("a call to action is only required when the script has a cta beat", async () => {
  const script = await good();
  assert.equal(checkScreenplay({ script, ...OPTIONS, brief: BRIEF }).ok, true);
  const withBeat = await changed((s) => { s.beats.push({ beat: "cta", lines: [{ id: "l11", speaker: "narrator", text: "That was the whole story." }] }); });
  assert.ok(ids(checkScreenplay({ script: withBeat, duration: 28, problemLandsSeconds: 12, brief: BRIEF }).errors).includes("cta-missing"));
});

test("a version 1 script still reads, as all-narrator", () => {
  const v1 = { schema_version: NARRATED_SCRIPT_VERSION, title: "Close faster", title_options: ["Close faster"], narration: "Month-end close should not take a week. Ledgerly matches every payout. Try Ledgerly free today.", beats: [{ beat: "hook", role: "hook", text: "Month-end close should not take a week." }, { beat: "proof", text: "Ledgerly matches every payout." }, { beat: "cta", text: "Try Ledgerly free today." }], plan: { format: "promo", wpm: 160 } };
  assert.equal(SCRIPT_VERSION, NARRATED_SCRIPT_VERSION, "make's narrated script pass still writes version 1");
  assert.equal(isScreenplay(v1), false);
  const script = readScreenplay(v1);
  assert.equal(script.schema_version, SCREENPLAY_VERSION);
  assert.equal(script.source_version, NARRATED_SCRIPT_VERSION);
  assert.deepEqual(script.characters, []);
  assert.deepEqual(script.beats.map((beat) => beat.beat), ["hook", "proof", "cta"]);
  assert.equal(script.beats[0].role, "hook");
  assert.deepEqual(spokenLines(script).map((line) => [line.id, line.speaker]), [["l1", "narrator"], ["l2", "narrator"], ["l3", "narrator"]]);
  assert.equal(screenplayText(script), v1.narration);
  assert.equal(script.narration, v1.narration);
  assert.deepEqual(script.plan, v1.plan);
  assert.deepEqual(script.title_options, v1.title_options);
  // Its beat ids are the script skeleton's, not story beats: that is not an error for a narrated script.
  const report = validateScreenplay(v1, { duration: 6 });
  assert.deepEqual(report.errors, []);
  assert.equal(report.stats.version, NARRATED_SCRIPT_VERSION);
  assert.deepEqual(screenplayNarration(script).lines.map((line) => line.speaker), ["narrator", "narrator", "narrator"]);
  // An older file with no version and no beats is one narrator line.
  const bare = readScreenplay({ narration: "Builds took forty-eight minutes. Now twelve." });
  assert.equal(spokenLines(bare).length, 1);
  assert.equal(screenplayText(bare), "Builds took forty-eight minutes. Now twelve.");
  // Reading a version 2 file changes nothing.
  const v2 = { schema_version: SCREENPLAY_VERSION, title: "t", beats: [] };
  assert.equal(readScreenplay(v2), v2);
  assert.throws(() => readScreenplay({ schema_version: "launchclip.make-script.v9", narration: "x" }), /unknown script version/);
  assert.throws(() => readScreenplay({ title: "nothing spoken" }), /no narration and no beats/);
  assert.deepEqual(ids(validateScreenplay(null).errors), ["script-shape"]);
});

test("spoken lines become audio.narration.lines; silent lines become gaps of their length", async () => {
  const script = await good();
  const derived = screenplayNarration(script);
  assert.deepEqual(derived.lines, [
    { speaker: "narrator", text: "Maya has shipped this fix three times today." },
    { speaker: "maya", text: "Third time. Same red build." },
    { speaker: "sam", text: "Did you run the check?", gap: 1.2 },
    { speaker: "maya", text: "The check takes a whole minute." },
    { speaker: "sam", text: "The deploy takes ten.", gap: 1.5 },
    { speaker: "maya", text: "Oh. It was the config all along." },
    { speaker: "narrator", text: "One minute of checking saved her the afternoon." },
    { speaker: "sam", text: "Run the check first. Then ship." }
  ]);
  assert.equal(derived.lead_seconds, 0);
  assert.equal(derived.tail_seconds, 0);
  // `playing` and `action` are never spoken.
  const spoken = derived.lines.map((line) => line.text).join(" ");
  assert.equal(spoken, script.narration);
  assert.doesNotMatch(spoken, /flat, to herself|gentle|turns to look/);
  assert.deepEqual(Object.keys(derived.lines[1]), ["speaker", "text"]);
  // Silent lines in a row are one pause; one before the first line or after the last is reported, not voiced.
  const edges = await changed((s) => {
    s.beats[0].lines.unshift({ id: "l0", speaker: null, action: "Maya stares at the screen.", seconds: 1 });
    s.beats[1].lines.push({ id: "l4b", speaker: null, action: "Sam shrugs.", seconds: 0.8 });
    s.beats[4].lines.push({ id: "l11", speaker: null, action: "Maya ships.", seconds: 2 });
  });
  const edged = screenplayNarration(edges);
  assert.equal(edged.lines[2].gap, 2);
  assert.equal(edged.lead_seconds, 1);
  assert.equal(edged.tail_seconds, 2);
  const report = validateScreenplay(edges, { duration: 30, problemLandsSeconds: 12 });
  assert.deepEqual(report.errors, []);
  assert.deepEqual(ids(report.warnings), ["edge-silence"]);
  // The story contract accepts the derived lines as they are.
  const story = { audio: { narration: { provider: "kokoro", lines: derived.lines } } };
  assert.deepEqual(validateStory(story).errors.filter((error) => /narration/.test(error)), []);
});

test("the estimated timing runs words at the voice's pace and silent lines at their own length", async () => {
  const script = await good();
  const timing = screenplayTiming(script);
  assert.equal(timing.words, 49);
  assert.equal(timing.silent_seconds, 2.7);
  assert.equal(timing.spoken_seconds, 19.6);
  // Five pauses between spoken lines with nothing silent between them.
  assert.equal(timing.seconds, 23.8);
  assert.deepEqual(timing.beats.map((beat) => beat.beat), ["setup", "problem", "attempt", "turn", "resolution"]);
  const turn = timing.lines.find((line) => line.id === "l4");
  assert.equal(Math.round((turn.end - turn.start) * 1000) / 1000, 1.2);
  assert.ok(screenplayTiming(script, { wpm: 100 }).seconds > timing.seconds);
});

test("launchclip script check <project> checks the project's SCRIPT.json", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-screenplay-"));
  try {
    await assert.rejects(runScriptCheck(project, {}), /has no SCRIPT\.json/);
    const script = await good();
    await writeFile(path.join(project, "SCRIPT.json"), JSON.stringify(script));
    await writeFile(path.join(project, "brief.md"), BRIEF);
    assert.equal(parseScriptFile("SCRIPT.json", JSON.stringify(script)).kind, "screenplay");
    const out = [];
    const io = { stdout: { write: (value) => out.push(value) }, stderr: { write() {} } };
    await runCli(["script", "check", project, "--duration", "25", "--brief", path.join(project, "brief.md")], io);
    assert.match(out.join(""), /^launchclip script check: ok/);
    assert.match(out.join(""), /screenplay: 8 spoken and 2 silent lines; speakers narrator, maya, sam; about 23\.8s at 150 wpm \(target 25s\); problem at 3\.5s \(limit 12s\)/);
    out.length = 0;
    await runCli(["script", "check", path.join(project, "SCRIPT.json"), "--duration", "25", "--brief", path.join(project, "brief.md"), "--json"], io);
    const json = JSON.parse(out.join(""));
    assert.equal(json.ok, true);
    assert.equal(json.input, "screenplay");
    assert.equal(json.profile, "story-characters");
    assert.equal(json.stats.screenplay.problem_limit_seconds, 12);
    assert.deepEqual(json.narration.lines, screenplayNarration(script).lines);
    // A slower measured voice, and a script with a stranger in it, fail with exit 1.
    await assert.rejects(runCli(["script", "check", project, "--duration", "25", "--wpm", "90"], io), /1 error\(s\)/);
    script.beats[1].lines[1].speaker = "theo";
    await writeFile(path.join(project, "SCRIPT.json"), JSON.stringify(script));
    out.length = 0;
    await assert.rejects(runCli(["script", "check", project, "--duration", "25"], io), /script check: \d error\(s\)/);
    assert.match(out.join(""), /error: \[speaker-unknown\] \(line l3\) Line l3 is spoken by "theo"/);
    // A version 1 SCRIPT.json in a project is checked as before.
    await writeFile(path.join(project, "SCRIPT.json"), JSON.stringify({ schema_version: NARRATED_SCRIPT_VERSION, narration: "Month-end close should not take a week. Ledgerly matches every payout to its invoice. Try Ledgerly free today.", plan: { format: "promo" } }));
    const narrated = await runScriptCheck(project, { duration: 8 });
    assert.equal(narrated.input, "script");
    assert.equal(narrated.ok, true);
    assert.equal(narrated.stats.screenplay, undefined);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("the structure gate reads a version 2 beat as its spoken lines", async () => {
  const beats = scriptBeats(await good());
  assert.deepEqual(beats[1], { role: "problem", spoken: "Third time. Same red build. Did you run the check?" });
  assert.deepEqual(scriptBeats({ beats: [{ beat: "hook", text: "One." }] }), [{ role: "hook", spoken: "One." }]);
});

// Joining dialogue lines runs ffmpeg, which the CI test jobs lack.
test("launchclip voice voices the derived lines in three voices, with a speaker on every word", async (t) => {
  try { await new Promise((resolve, reject) => execFile("ffmpeg", ["-version"], (error) => error ? reject(error) : resolve())); } catch { t.skip("ffmpeg is unavailable"); return; }
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-screenplay-voice-"));
  try {
    const script = await good();
    const derived = screenplayNarration(script);
    const story = {
      cast: { characters: [{ id: "maya", voice: "af_heart" }, { id: "sam", voice: "am_michael" }] },
      audio: { narration: { provider: "kokoro", voice: "bf_emma", lines: derived.lines } }
    };
    await writeFile(path.join(project, "storyboard.json"), JSON.stringify(story));
    const { createTestVoiceProvider } = await import("../src/voice/index.js");
    const requests = [];
    const voiceProvider = () => { const real = createTestVoiceProvider(); return { name: "kokoro", synthesize: (request) => { requests.push(request); return real.synthesize(request); } }; };
    const report = await runVoiceCommand(project, {}, { voiceProvider });
    assert.equal(requests.length, 8, "one take per spoken line");
    assert.deepEqual(report.request.voices, { narrator: "bf_emma", maya: "af_heart", sam: "am_michael" });
    const narration = JSON.parse(await readFile(path.join(project, "NARRATION.json"), "utf8"));
    assert.equal(narration.words.length, 49);
    assert.ok(narration.words.every((word) => ["narrator", "maya", "sam"].includes(word.speaker)), "every word has its speaker");
    assert.deepEqual([...new Set(narration.words.map((word) => word.speaker))], ["narrator", "maya", "sam"]);
    assert.deepEqual(narration.lines.map((line) => [line.speaker, line.voice]), derived.lines.map((line) => [line.speaker, report.request.voices[line.speaker]]));
    assert.equal(narration.text, script.narration);
    // A silent line is the pause after the line before it.
    assert.equal(narration.gaps[2], 1.2);
    assert.equal(narration.gaps[4], 1.5);
    assert.equal(narration.gaps[0], 0.3);
    const last = (speaker, index) => narration.words.filter((word) => word.speaker === speaker && word.start >= narration.lines[index].start - 0.001 && word.end <= narration.lines[index].end + 0.001).at(-1);
    const pause = narration.words.find((word) => word.start >= narration.lines[3].start - 0.001).start - last("sam", 2).end;
    assert.ok(Math.abs(pause - 1.2) < 0.15, `the pause after l3 is ${pause}s`);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
