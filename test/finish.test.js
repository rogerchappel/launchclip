import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { runCli } from "../src/cli.js";
import { runStoryCommand } from "../src/story_cli.js";
import { checkCinematicProject, resolveMusicMix } from "../src/cinematic_check.js";
import { evaluateAudioQuality } from "../src/render_audio_analysis.js";
import { PATHS, bindCues, buildFinishCopy, chooseBed, defaultCueFor, formatFinishSummary, kitCue, musicSpec, placeholderScenes, runFinish, stageDecision } from "../src/finish.js";
import { createTestVoiceProvider, getVoiceProvider, listVoiceProviders, registerVoiceProvider, testVoiceTimings } from "../src/voice/index.js";
import { mediaSkip } from "./helpers/media.js";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");
const MINIMAL = path.join(ROOT, "examples/story/minimal");
const NARRATION = "Builds took forty-eight minutes. Now twelve. Three changes did it. Watch again.";
const STAGE_NAMES = ["voice", "validate", "captions", "sound", "render", "master", "evidence", "gates"];

// A copy of examples/story/minimal that narrates with the test voice and
// leaves the mix to finish.
async function narratedProject({ mutate } = {}) {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-finish-"));
  await cp(MINIMAL, project, { recursive: true });
  await rm(path.join(project, "assets/audio/mix.wav"), { force: true });
  await rm(path.join(project, "NARRATION.json"), { force: true });
  const story = JSON.parse(await readFile(path.join(project, "storyboard.json"), "utf8"));
  delete story.audio.mix;
  story.audio.narration = { text: NARRATION, provider: "test" };
  await writeFile(path.join(project, "storyboard.json"), `${JSON.stringify(mutate ? mutate(story) ?? story : story, null, 2)}\n`);
  return project;
}

// Offline stand-ins for every heavy adapter; calls are counted per adapter.
function fakeAdapters({ renderError } = {}) {
  const calls = {};
  const count = (name) => { calls[name] = (calls[name] ?? 0) + 1; };
  const touch = async (file, content = "x") => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, content); };
  const adapters = {
    calls,
    // No ELEVENLABS_API_KEY: the music stays on the offline synth bed.
    env: {},
    notice() {},
    renderer: (name) => ({
      name,
      async render(project, out, options) {
        count(`render:${name}`);
        adapters.lastRender = { project, out, options };
        if (renderError) throw new Error(renderError);
        // Each render differs (like a real encode), so later stages see a new input.
        await touch(out, `video ${calls[`render:${name}`]} ${JSON.stringify(options.story?.audio ?? null)}`);
        return { output: out };
      }
    }),
    async compileHyperFrames(resolved, options) {
      count("compile");
      await touch(path.join(options.projectDir, "index.html"), "<html></html>");
      return { warnings: [] };
    },
    async synthKit(outDir, bed) {
      count("synthKit");
      adapters.lastBed = bed;
      await touch(path.join(outDir, "AUDIO-KIT.json"), "{}");
      if (bed) await touch(path.join(outDir, "music", "bed.wav"));
      return {};
    },
    // The real renderer decodes the bank files: the fake kit above writes
    // none, and a user library in ~/.launchclip/sfx must not decide the test.
    async renderTyping(schedule, banks, { out }) {
      count("renderTyping");
      await touch(out, `typing ${schedule.length}`);
      const keystrokes = schedule.map((entry) => ({ at: entry.at, kind: entry.kind, shot: entry.shot }));
      const counts = keystrokes.reduce((acc, entry) => ({ ...acc, [entry.kind]: (acc[entry.kind] ?? 0) + 1 }), {});
      return { file: out, keystrokes, counts };
    },
    async buildMix(options) {
      count("buildMix");
      adapters.lastMix = options;
      await touch(options.out, `mix ${options.cues.length}`);
      return { cues: options.cues.map((cue) => ({ ...cue, file: path.join(options.sfxDir, `${cue.cue}.wav`) })) };
    },
    async hasAudio() { return true; },
    async master(input, output, target) {
      count("master");
      await touch(output, `mastered ${await readFile(input, "utf8")}`);
      return { target: { integrated_lufs: target.lufs, true_peak_dbtp: target.tp }, output: { integrated_lufs: -14.1, true_peak_dbtp: -1.4 }, compliant: true };
    },
    async buildEvidence(project, options) {
      count("evidence");
      adapters.lastEvidence = options;
      await touch(path.join(project, PATHS.evidence), JSON.stringify({ schema_version: "launchclip.subscription-temporal-evidence.v1", entries: [] }));
      return { samples: 0, artifacts: 0, sheets: [] };
    },
    async motion(video, out) {
      count("motion");
      await touch(out, "{}");
      return { quality: { ok: true, findings: [] } };
    },
    async audio() {
      count("audio");
      return { quality: { ok: true, findings: [] } };
    }
  };
  return adapters;
}

test("voice registry lists providers, builds the test provider and reports missing ones", async () => {
  assert.deepEqual(["elevenlabs", "kokoro", "supplied", "test"].filter((name) => listVoiceProviders().includes(name)), ["elevenlabs", "kokoro", "supplied", "test"]);
  assert.throws(() => getVoiceProvider("nope"), /Unknown voice provider "nope"\. Available providers: .*kokoro.*test/);
  for (const name of ["kokoro", "elevenlabs", "supplied"]) {
    if (existsSync(path.join(ROOT, "src/voice", `${name}.js`))) continue;
    await assert.rejects(getVoiceProvider(name).synthesize({ text: "hi", outFile: "/dev/null" }), /not installed/);
  }
  registerVoiceProvider("unit-fake", () => ({ name: "unit-fake", async synthesize() { return { file: "x", words: [], sampleRate: 1, duration: 0 }; } }));
  assert.equal(getVoiceProvider("Unit-Fake").name, "unit-fake");
  assert.throws(() => registerVoiceProvider("bad", null), /needs a factory/);

  const directory = await mkdtemp(path.join(os.tmpdir(), "launchclip-voice-"));
  try {
    const result = await createTestVoiceProvider().synthesize({ text: "one two three four", speed: 2, outFile: path.join(directory, "v.wav") });
    assert.equal(result.words.length, 4);
    assert.deepEqual(result.words[1], { text: "two", start: 0.28, end: 0.408 });
    assert.equal(result.sampleRate, 24000);
    const wav = await readFile(result.file);
    assert.equal(wav.subarray(0, 4).toString("ascii"), "RIFF");
    assert.equal(wav.readUInt32LE(40), Math.round(result.duration * 24000) * 2);
    assert.ok(result.duration > result.words.at(-1).end);
    assert.deepEqual(testVoiceTimings("a b", { speed: 1 }).words.map((word) => word.start), [0.12, 0.44]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("stageDecision runs a stage when forced, new, changed or tampered, else reuses it", () => {
  const previous = { input_hash: "a", outputs: { "out.wav": "h1" } };
  assert.deepEqual(stageDecision(previous, { inputHash: "a", outputs: { "out.wav": "h1" } }), { action: "cached", reason: "inputs and outputs unchanged" });
  assert.equal(stageDecision(previous, { inputHash: "a", outputs: { "out.wav": "h1" } }, { force: true }).reason, "forced");
  assert.equal(stageDecision(undefined, { inputHash: "a", outputs: {} }).reason, "not run before");
  assert.equal(stageDecision(previous, { inputHash: "b", outputs: { "out.wav": "h1" } }).reason, "inputs changed");
  assert.equal(stageDecision(previous, { inputHash: "a", outputs: { "out.wav": null } }).reason, "out.wav is missing");
  assert.equal(stageDecision(previous, { inputHash: "a", outputs: { "out.wav": "h2" } }).reason, "out.wav changed since it was written");
});

test("a hit with cue \"none\" silences the module event it names", () => {
  const story = {
    format: { width: 1920, height: 1080, fps: 30, duration: 10 },
    resolved: { duration: 10, fps: 30, frames: 300 },
    scenes: [{ id: "chart", module: "x", start: 0, end: 6, hits: [{ at: 1, event: "build", cue: "none" }] }]
  };
  const models = { chart: { id: "chart", events: [{ id: "chart-build", name: "build", time: 1, endTime: 2.2, cue: "riser" }, { id: "chart-highlight", name: "highlight", time: 4, cue: "pop" }] } };
  const { cues } = bindCues(story, { models });
  assert.deepEqual(cues.map((cue) => [cue.cue, cue.event]), [["pop", "highlight"]]);
});

test("bindCues binds every hit and cue-carrying module event to a kit cue", () => {
  const story = {
    format: { width: 1080, height: 1920, fps: 30, duration: 10 },
    resolved: { duration: 10, fps: 30, frames: 300 },
    scenes: [
      { id: "s1", module: "x", start: 0, end: 5, hits: [{ at: 1, event: "settle" }, { at: 2, event: "burst", cue: "whoosh-soft" }, { at: 3, event: "mystery-moment" }] },
      { id: "s2", module: "y", start: 5, end: 10, in: { type: "whip", dur: 0.4 }, hits: [{ at: 9.99, event: "late", cue: "pop" }] }
    ]
  };
  const models = {
    s1: { id: "s1", events: [
      { id: "s1-settle", name: "settle", time: 1, cue: "impact" },
      { id: "s1-count", time: 3.5, endTime: 4.2, role: "count", cue: "riser" },
      { id: "s1-plain", time: 4 },
      { id: "s1-odd", time: 4.5, cue: "kazoo" }
    ] },
    s2: { id: "s2", events: [{ id: "s2-fill", time: 6, cue: "riser-short" }] }
  };
  const { cues, warnings } = bindCues(story, { models });
  const summary = cues.map((cue) => [cue.cue, cue.at, cue.source, cue.event]);
  assert.deepEqual(summary, [
    ["impact", 1, "hit", "settle"],
    ["whoosh", 2, "hit", "burst"],
    ["pop", 3, "hit", "mystery-moment"],
    ["riser", 2.87, "module-event", "count"],
    ["riser", 5.16, "module-event", "fill"],
    ["whoosh", 4.783, "transition", "whip-in"]
  ].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])));
  // The hit and the module event at t=1 merge; the hit wins.
  assert.equal(cues.filter((cue) => cue.cue === "impact").length, 1);
  assert.equal(cues.find((cue) => cue.event === "burst").volume, 0.24);
  assert.ok(warnings.some((message) => /"kazoo"/.test(message)));
  assert.ok(warnings.some((message) => /after the end of the video/.test(message)));
  assert.equal(defaultCueFor("readout-plunge"), "impact");
  assert.equal(defaultCueFor("gap-bar-1"), "tick");
  assert.equal(defaultCueFor("hello"), "pop");
  assert.deepEqual(kitCue("whoosh-soft"), { cue: "whoosh", gain: 0.6, modifiers: ["soft"] });
  assert.equal(kitCue("kazoo"), null);
  assert.throws(() => bindCues({ scenes: [{ id: "s1", hits: [{ at: "word:x", event: "e" }] }] }, { models: {} }), /resolved story/);
});

test("bindCues reads cues from real catalogue module events", () => {
  const story = {
    schema: "launchclip.story.v1",
    format: { width: 1080, height: 1920, fps: 30, duration: 6 },
    resolved: { duration: 6, fps: 30, frames: 180 },
    brand: { colors: { bg: "#06070d", primary: "#fdb022", accent: "#46d4ff", ink: "#06070d", paper: "#f2eee6" }, fonts: { display: "anton" } },
    scenes: [{ id: "s1", module: "hook-title", start: 0, end: 6, params: { headline: "Ship faster" } }]
  };
  const { cues } = bindCues(story);
  assert.ok(cues.some((cue) => cue.source === "module-event" && cue.cue === "whoosh"), JSON.stringify(cues));
});

test("chooseBed follows scene energy and musicSpec reads audio.music", () => {
  const story = (energies) => ({ resolved: { duration: 9 }, scenes: energies.map((energy, index) => ({ id: `s${index}`, start: index * 3, end: index * 3 + 3, energy })) });
  assert.deepEqual(chooseBed(story([0, 0, 0])), { seconds: 9, bpm: 84, key: "A", kick_from: 9, kick_to: 9, volume: 0.24, energy: 0 });
  const groove = chooseBed(story([1, "build", 3]));
  assert.equal(groove.bpm, 108);
  assert.equal(groove.kick_from, 6);
  assert.equal(groove.kick_to, 9);
  assert.equal(chooseBed(story([3, 3, 3]), { bpm: 90, key: "D" }).bpm, 90);
  assert.equal(chooseBed(story([3, 3, 3])).volume, 0.36);
  assert.deepEqual(musicSpec({}), { kind: "synth" });
  assert.deepEqual(musicSpec({ music: "none" }), { kind: "none" });
  assert.deepEqual(musicSpec({ music: "assets/audio/song.wav" }), { kind: "file", file: "assets/audio/song.wav" });
  assert.deepEqual(musicSpec({ music: { source: "synth", bpm: 100, key: "C" } }), { kind: "synth", bpm: 100, key: "C" });
  // The bed's gain passes through, as finish's plan reads it.
  assert.deepEqual(musicSpec({ music: { source: "synth", volume: 0.32 } }), { kind: "synth", bpm: undefined, key: undefined, volume: 0.32 });
  assert.equal(musicSpec({ music: { file: "assets/audio/song.wav", volume: 0.2 } }).volume, 0.2);
});

test("buildFinishCopy fills a copy and never touches the user's story", () => {
  const story = { audio: { narration: { text: "hi" } }, overlays: [{ type: "captions", style: "none" }, { type: "captions", style: "word-highlight" }] };
  const before = JSON.stringify(story);
  const copy = buildFinishCopy(story, { voice: "assets/audio/narration.wav", words: "NARRATION.json", captions: "assets/captions/captions.json", mix: "assets/audio/mix.wav" });
  assert.equal(JSON.stringify(story), before);
  assert.deepEqual(copy.audio, { narration: { text: "hi" }, voice: "assets/audio/narration.wav", words: "NARRATION.json", mix: "assets/audio/mix.wav" });
  assert.equal(copy.overlays[0].src, undefined);
  assert.equal(copy.overlays[1].src, "assets/captions/captions.json");
});

test("runFinish runs every stage, writes the resolved copy and report, then reuses stages", async () => {
  const project = await narratedProject();
  try {
    const userStory = await readFile(path.join(project, "storyboard.json"), "utf8");
    const adapters = fakeAdapters();
    const report = await runFinish(project, { renderer: "remotion" }, adapters);

    assert.equal(report.schema_version, "launchclip.finish.v1");
    assert.deepEqual(report.stages.map((stage) => stage.name), STAGE_NAMES);
    assert.deepEqual(report.stages.map((stage) => stage.status), STAGE_NAMES.map(() => "done"));
    for (const stage of report.stages) assert.equal(typeof stage.seconds, "number");
    assert.equal(report.renderer, "remotion");
    assert.equal(report.quality, "draft");
    assert.equal(report.voice, "test");
    assert.equal(report.final, path.join(project, "renders/draft.mp4"));
    assert.deepEqual(Object.keys(report.gates), ["placeholders", "layout", "physics", "loudness", "motion", "audio", "temporal_evidence", "direction", "acting", "coverage", "critic"]);
    assert.equal(report.gates.placeholders.status, "passed");
    assert.equal(report.gates.direction.status, "passed");
    assert.equal(report.gates.coverage.status, "passed");
    assert.equal(report.gates.coverage.profile, "short-motion");
    assert.equal(report.gates.motion.profile, "short-motion", "the motion floors come from the cadence profile");
    assert.equal(report.gates.layout.status, "passed");
    assert.equal(report.gates.loudness.status, "passed");
    assert.equal(report.gates.motion.status, "passed");
    assert.equal(report.gates.temporal_evidence.status, "failed", "the fake evidence manifest has no entries");
    assert.equal(report.gates.critic.status, "pending");
    assert.match(report.gates.critic.next_step, /launchclip cinematic-check .* --renderer remotion --video renders\/draft\.mp4/);
    assert.equal(report.status, "needs-repair");
    assert.deepEqual(JSON.parse(await readFile(path.join(project, "finish.json"), "utf8")).stages.map((stage) => stage.name), STAGE_NAMES);
    assert.match(formatFinishSummary(report), /launchclip finish: needs-repair \(remotion, draft/);

    // The user's storyboard is untouched; the copy carries what finish filled in.
    assert.equal(await readFile(path.join(project, "storyboard.json"), "utf8"), userStory);
    const copy = JSON.parse(await readFile(path.join(project, PATHS.copy), "utf8"));
    assert.equal(copy.audio.voice, "assets/audio/narration.wav");
    assert.equal(copy.audio.words, "NARRATION.json");
    assert.equal(copy.audio.mix, "assets/audio/mix.wav");
    assert.equal(copy.overlays[0].src, "assets/captions/captions.json");
    const resolved = JSON.parse(await readFile(path.join(project, PATHS.resolved), "utf8"));
    assert.equal(resolved.scenes[0].hits[0].at, 1.72, "word:twelve resolves against the synthesised words");
    assert.deepEqual(adapters.lastRender.options.story.audio.mix, "assets/audio/mix.wav");

    const narration = JSON.parse(await readFile(path.join(project, "NARRATION.json"), "utf8"));
    assert.equal(narration.words.length, 12);
    const captions = JSON.parse(await readFile(path.join(project, PATHS.captions), "utf8"));
    assert.ok(captions.chunks.length >= 4);
    const manifest = JSON.parse(await readFile(path.join(project, PATHS.audioManifest), "utf8"));
    assert.equal(manifest.voiceover.provider, "test");
    assert.equal(manifest.music.source, "synth");
    assert.ok(existsSync(manifest.sfx_manifest));
    const sfx = JSON.parse(await readFile(path.join(project, PATHS.sfxManifest), "utf8"));
    assert.deepEqual(sfx.cues.map((cue) => [cue.cue, cue.at_seconds, cue.shot_id]), [["tick", 1.72, "s1"], ["tick", 2.04, "s2"]]);
    assert.equal(adapters.lastMix.musicVolume, 0.3);
    assert.equal(adapters.lastBed.bpm, 96);
    assert.equal(adapters.lastEvidence.renderer, "remotion");
    assert.equal(adapters.lastEvidence.video, path.join(project, "renders/draft.mp4"));

    // Second run: nothing changed, so everything but validation is reused.
    const before = { ...adapters.calls };
    const again = await runFinish(project, { renderer: "remotion" }, adapters);
    assert.deepEqual(again.stages.map((stage) => stage.status), ["cached", "done", "cached", "cached", "cached", "cached", "cached", "cached"]);
    assert.deepEqual(adapters.calls, before);
    assert.equal(again.gates.critic.status, "pending");

    // A narration edit reruns the voice and everything downstream of it.
    const story = JSON.parse(userStory);
    story.audio.narration.text = `${NARRATION} Really.`;
    await writeFile(path.join(project, "storyboard.json"), JSON.stringify(story));
    const edited = await runFinish(project, { renderer: "remotion" }, adapters);
    assert.deepEqual(edited.stages.map((stage) => stage.status), STAGE_NAMES.map(() => "done"));
    assert.equal(edited.stages[0].reason, "inputs changed");
    assert.equal(adapters.calls.synthKit, 1, "the kit is reused when the bed is unchanged");

    // A deleted deliverable reruns only the master; it comes back byte-identical,
    // so the evidence and gates built on it stay valid.
    await rm(path.join(project, "renders/draft.mp4"));
    const remastered = await runFinish(project, { renderer: "remotion" }, adapters);
    assert.deepEqual(remastered.stages.map((stage) => stage.status), ["cached", "done", "cached", "cached", "cached", "done", "cached", "cached"]);
    assert.equal(remastered.stages[5].reason, "renders/draft.mp4 is missing");
    // A changed render invalidates everything after it.
    await writeFile(path.join(project, ".launchclip/finish/render-draft.mp4"), "tampered");
    const rerendered = await runFinish(project, { renderer: "remotion" }, adapters);
    assert.deepEqual(rerendered.stages.map((stage) => stage.status), ["cached", "done", "cached", "cached", "done", "done", "done", "done"]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("runFinish respects supplied voice and mix, quality and --out", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-finish-supplied-"));
  try {
    await cp(MINIMAL, project, { recursive: true });
    const adapters = fakeAdapters();
    const report = await runFinish(project, { quality: "high", out: "out/final-cut.mp4" }, adapters);
    const byName = Object.fromEntries(report.stages.map((stage) => [stage.name, stage]));
    assert.equal(report.renderer, "remotion", "no index.html: remotion by default");
    assert.equal(byName.voice.status, "skipped");
    assert.equal(byName.voice.reason, "no audio.narration");
    assert.equal(byName.captions.status, "done");
    assert.equal(byName.sound.status, "skipped");
    assert.match(byName.sound.reason, /audio\.mix is supplied/);
    assert.equal(adapters.lastRender.options.quality, "high");
    assert.match(adapters.lastRender.out, /render-high\.mp4$/);
    assert.equal(report.final, path.join(project, "out/final-cut.mp4"));
    assert.equal(report.voice, null);

    const story = JSON.parse(await readFile(path.join(project, "storyboard.json"), "utf8"));
    story.audio = { ...story.audio, voice: "assets/audio/mix.wav", narration: { text: NARRATION } };
    await writeFile(path.join(project, "storyboard.json"), JSON.stringify(story));
    const supplied = await runFinish(project, {}, adapters);
    assert.match(supplied.stages[0].reason, /audio\.voice is supplied \(assets\/audio\/mix\.wav\)/);
    await assert.rejects(runFinish(project, { voice: "espeak" }, adapters), /Unknown --voice espeak/);
    await assert.rejects(runFinish(project, { quality: "ultra" }, adapters), /--quality must be draft or high/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("finish writes the chapters: renders/chapters.txt, the MP4 metadata and the report", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-finish-chapters-"));
  try {
    await cp(MINIMAL, project, { recursive: true });
    const story = JSON.parse(await readFile(path.join(project, "storyboard.json"), "utf8"));
    story.chapters = [{ id: "open", title: "Open", start: 0 }, { id: "fix", title: "The fix", start: 3 }];
    await writeFile(path.join(project, "storyboard.json"), JSON.stringify(story));
    const adapters = fakeAdapters();
    const muxed = [];
    adapters.muxChapters = async (input, metadata, output) => {
      muxed.push(await readFile(metadata, "utf8"));
      await writeFile(output, `${await readFile(input, "utf8")} +chapters`);
    };
    const report = await runFinish(project, {}, adapters);
    assert.equal(await readFile(path.join(project, PATHS.chapters), "utf8"), "0:00 Open\n0:03 The fix\n");
    assert.equal(muxed.length, 1);
    assert.match(muxed[0], /START=3000\nEND=6000\ntitle=The fix/);
    assert.match(await readFile(report.final, "utf8"), /\+chapters$/);
    assert.deepEqual(report.chapters.list.map((chapter) => [chapter.id, chapter.start, chapter.end]), [["open", 0, 3], ["fix", 3, 6]]);
    assert.equal(report.chapters.youtube, "ignored");
    assert.ok(report.warnings.some((warning) => /chapters: YouTube would not show them/.test(warning)));
    assert.match(formatFinishSummary(report), /chapters: 2 in renders\/chapters\.txt and the MP4/);
    // An unchanged rerun keeps the master and its chapters.
    const again = await runFinish(project, {}, adapters);
    assert.equal(again.stages.find((stage) => stage.name === "master").status, "cached");
    assert.equal(muxed.length, 1);
    assert.equal(again.chapters.list.length, 2);
    // --prototype carries no chapters.
    const prototype = await runFinish(project, { prototype: true }, adapters);
    assert.equal(prototype.chapters, undefined);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("runFinish compiles HyperFrames projects before rendering them", async () => {
  const project = await narratedProject();
  try {
    const adapters = fakeAdapters();
    const report = await runFinish(project, { renderer: "hyperframes" }, adapters);
    assert.equal(report.renderer, "hyperframes");
    assert.equal(adapters.calls.compile, 1);
    assert.equal(adapters.lastRender.project, path.join(project, PATHS.hyperframes));
    assert.equal(adapters.lastEvidence.stillsProject, path.join(project, PATHS.hyperframes));
    assert.match(report.gates.critic.next_step, /launchclip cinematic-check .* --renderer hyperframes /);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("no scene ships as a Missing module placeholder", async () => {
  // A param error fails the validate stage, as story validate does, before anything renders.
  const invalid = await narratedProject({ mutate: (story) => { story.scenes[1].params.rows[0].at = 99; } });
  try {
    const adapters = fakeAdapters();
    const report = await runFinish(invalid, {}, adapters);
    assert.equal(report.status, "failed");
    assert.equal(report.stages[1].name, "validate");
    assert.equal(report.stages[1].status, "failed");
    assert.match(report.stages[1].error, /both renderers would draw a placeholder/);
    assert.equal(adapters.lastRender, undefined, "nothing renders");
  } finally {
    await rm(invalid, { recursive: true, force: true });
  }
  // An unknown module still renders (it is a warning), but the placeholders gate fails it.
  const unknown = await narratedProject({ mutate: (story) => { story.scenes[1].module = "not-a-module"; } });
  try {
    const report = await runFinish(unknown, {}, fakeAdapters());
    assert.equal(report.status, "needs-repair");
    assert.equal(report.gates.placeholders.status, "failed");
    assert.match(report.gates.placeholders.errors[0], /^s2 \(not-a-module\) renders as a "Missing module" placeholder/);
  } finally {
    await rm(unknown, { recursive: true, force: true });
  }
});

test("placeholderScenes covers custom modules in HyperFrames and compiler fallbacks", async () => {
  const story = (await runStoryCommand("resolve", path.join(MINIMAL, "storyboard.json"), { narration: path.join(MINIMAL, "NARRATION.json") })).story_resolved;
  assert.deepEqual(placeholderScenes(story, { renderer: "hyperframes" }), []);
  const custom = { ...story, scenes: [{ ...story.scenes[0], module: "custom", params: { component: "Hero" } }, ...story.scenes.slice(1)] };
  assert.deepEqual(placeholderScenes(custom, { renderer: "remotion" }), []);
  assert.deepEqual(placeholderScenes(custom, { renderer: "hyperframes" }).map((entry) => entry.id), ["s1"]);
  const fallback = placeholderScenes(story, { renderer: "hyperframes", compileWarnings: [`s2: HyperFrames emitter for "${story.scenes[1].module}" failed (boom); rendering a placeholder`] });
  assert.deepEqual(fallback, [{ id: "s2", module: story.scenes[1].module, reason: `HyperFrames emitter for "${story.scenes[1].module}" failed (boom)` }]);
});

test("a failing stage blocks the rest, is reported, and the CLI exits non-zero", async () => {
  const project = await narratedProject();
  try {
    const adapters = fakeAdapters({ renderError: "Chrome crashed" });
    const report = await runFinish(project, {}, adapters);
    assert.equal(report.status, "failed");
    assert.deepEqual(report.stages.map((stage) => stage.status), ["done", "done", "done", "done", "failed", "blocked", "blocked", "blocked"]);
    assert.equal(report.stages[4].error, "Chrome crashed");
    assert.equal(report.final, null);
    assert.match(report.next_steps[0], /Fix the render stage \(Chrome crashed\)/);

    let out = "";
    const io = { stdout: { write: (text) => { out += text; } }, stderr: { write() {} }, productionAdapters: { finish: adapters } };
    await assert.rejects(runCli(["finish", project, "--json"], io), /launchclip finish failed at the render stage: Chrome crashed/);
    assert.equal(JSON.parse(out).status, "failed");

    const invalid = await narratedProject({ mutate: (story) => { story.scenes[0].hits[0].at = "word:nonexistent"; } });
    try {
      const failed = await runFinish(invalid, {}, fakeAdapters());
      assert.equal(failed.stages[1].status, "failed");
      assert.match(failed.stages[1].error, /no narration word matches "nonexistent"/);
    } finally {
      await rm(invalid, { recursive: true, force: true });
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("launchclip finish prints a summary by default", async () => {
  const project = await narratedProject();
  try {
    let out = "";
    await runCli(["finish", project], { stdout: { write: (text) => { out += text; } }, stderr: { write() {} }, productionAdapters: { finish: fakeAdapters() } });
    assert.match(out, /^launchclip finish: needs-repair/);
    assert.match(out, /voice\s+done/);
    assert.match(out, /critic\s+pending/);
    assert.match(out, /final: .*renders\/draft\.mp4/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

// fakeAdapters() plus a frame-range renderer and FFmpeg stand-ins, so the
// render stage goes through the segment cache.
function segmentAdapters() {
  const adapters = fakeAdapters();
  adapters.segmentCalls = [];
  const touch = async (file, content) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, content); };
  adapters.renderer = (name) => ({
    name,
    segmentEncoder: () => ({ fake: true }),
    async renderSegments(project, segments, options) {
      adapters.segmentCalls.push(segments.map((segment) => [segment.startFrame, segment.endFrame]));
      for (const segment of segments) await touch(segment.output, `${segment.startFrame}-${segment.endFrame} ${options.story.scenes.map((scene) => scene.params?.title).join("|")}\n`);
      return { segments: segments.map(() => ({ seconds: 2 })) };
    },
    async encodeDelivery(input, output) { await touch(output, await readFile(input, "utf8")); },
    async render() { throw new Error("the segment path must not render whole videos"); }
  });
  adapters.segmentTools = {
    async concat(files, output) { await touch(output, (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("")); },
    async encodeAudio({ output }) { await touch(output, "aac"); },
    async mux({ video, output }) { await touch(output, await readFile(video, "utf8")); },
    async countFrames() { return NaN; },
    async still(video, frame, output) { await touch(output, `${frame}: ${await readFile(video, "utf8")}`); },
    async sideBySide(left, right, output) { await touch(output, `${await readFile(left, "utf8")}|${await readFile(right, "utf8")}`); }
  };
  return adapters;
}

test("--scene re-renders that scene's segments, re-runs master, evidence and gates, and shows before/after stills", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-finish-scene-"));
  try {
    await cp(MINIMAL, project, { recursive: true });
    const adapters = segmentAdapters();
    const first = await runFinish(project, { renderer: "remotion" }, adapters);
    const render = first.stages.find((stage) => stage.name === "render");
    assert.equal(render.details.segments.mode, "segments");
    assert.deepEqual(render.details.segments.plan.map((entry) => entry.id), ["00-s1", "01-s1+s2", "02-s2", "03-s2+s1~loop"]);
    assert.deepEqual([render.details.segments.reused, render.details.segments.rendered], [0, 4]);
    assert.ok(existsSync(path.join(project, PATHS.segments, "remotion", "index.json")));
    assert.match(formatFinishSummary(first), /4 segments: 0 reused, 4 rendered/);

    // An unchanged rerun reuses the whole render stage.
    const cached = await runFinish(project, { renderer: "remotion" }, adapters);
    assert.equal(cached.stages.find((stage) => stage.name === "render").status, "cached");

    // An edit to s2 re-renders the three segments that show s2.
    const story = JSON.parse(await readFile(path.join(project, "storyboard.json"), "utf8"));
    story.scenes[1].params.title = "Three fixes";
    await writeFile(path.join(project, "storyboard.json"), JSON.stringify(story));
    const edited = await runFinish(project, { renderer: "remotion" }, adapters);
    const segments = edited.stages.find((stage) => stage.name === "render").details.segments;
    assert.deepEqual([segments.reused, segments.rendered], [1, 3]);
    assert.deepEqual(adapters.segmentCalls.at(-1), [[90, 102], [102, 179], [179, 180]]);
    assert.ok(segments.seconds_saved > 0);
    assert.match(formatFinishSummary(edited), /4 segments: 1 reused, 3 rendered \(~[\d.]+s saved\)/);

    // --scene s1 forces s1's segments and every stage after render, even with no input change.
    const before = { ...adapters.calls };
    const forced = await runFinish(project, { renderer: "remotion", scenes: "s1" }, adapters);
    assert.deepEqual(forced.stages.map((stage) => stage.status), ["skipped", "done", "cached", "skipped", "done", "done", "done", "done"]);
    assert.deepEqual(forced.stages.slice(4).map((stage) => stage.reason), ["forced", "forced", "forced", "forced"]);
    const forcedSegments = forced.stages.find((stage) => stage.name === "render").details.segments;
    assert.deepEqual([forcedSegments.reused, forcedSegments.rendered, forcedSegments.forced], [1, 3, 3]);
    assert.deepEqual(adapters.segmentCalls.at(-1), [[0, 90], [90, 102], [179, 180]]);
    assert.equal(adapters.calls.master, before.master + 1);
    assert.equal(adapters.calls.evidence, before.evidence + 1);
    assert.deepEqual(forced.scenes, ["s1"]);
    const [still] = forced.scene_stills;
    assert.equal(still.scene, "s1");
    assert.equal(still.before, "qa/finish/scenes/s1-before.png");
    assert.equal(still.after, "qa/finish/scenes/s1-after.png");
    assert.equal(still.compare, "qa/finish/scenes/s1-before-after.png");
    assert.equal(still.seconds, 1.467, "the middle of s1's own segment");
    assert.ok(existsSync(path.join(project, still.compare)));
    assert.match(formatFinishSummary(forced), /scene s1 @1\.467s: qa\/finish\/scenes\/s1-before-after\.png \(before \| after\)/);
    assert.match(formatFinishSummary(forced), /3 forced by --scene/);

    await assert.rejects(runFinish(project, { scenes: "s9" }, adapters), /unknown scene "s9"; storyboard\.json has s1, s2/);
    await assert.rejects(runFinish(project, { scenes: "s1", previewScene: "s2" }, adapters), /--scene or --preview-scene, not both/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});


// ---------------------------------------------------------------------------
// Music: provider choice, ElevenLabs (stubbed), beat sync

// A stub ElevenLabs provider and beat analysis: a 120 BPM track whose first
// downbeat sits 0.3 s in, so finish must trim the start to line it up.
function musicAdapters(base = fakeAdapters(), { env = { ELEVENLABS_API_KEY: "sk_test_never_sent" } } = {}) {
  const notices = [];
  const music = { requests: 0, generated: 0, prepared: [] };
  const grid = { bpm: 120, beat_seconds: 0.5, beats: [], downbeats: [], confidence: 0.9, duration: 8.5, method: "stub" };
  for (let t = 0.3; t < 8.5; t += 0.5) grid.beats.push(Math.round(t * 1000) / 1000);
  grid.downbeats = grid.beats.filter((_, index) => index % 4 === 0);
  let cached = false;
  Object.assign(base, {
    env,
    notice: (line) => notices.push(line),
    musicProvider: () => ({
      name: "elevenlabs",
      cacheDir: "/cache/elevenlabs/music",
      request(story, params) { music.requests += 1; music.lastParams = params; return { mode: "plan", body: { composition_plan: { sections: [] }, model_id: "music_v1" }, bpm: params.bpm, length_ms: 8000 }; },
      async generate(story, params, { outFile }) {
        await mkdir(path.dirname(outFile), { recursive: true });
        await writeFile(outFile, "mp3");
        const wasCached = cached;
        if (!cached) music.generated += 1;
        cached = true;
        return { file: outFile, cached: wasCached, cache_file: "/cache/elevenlabs/music/abc.mp3", request: { mode: "plan", bpm: params.bpm, length_ms: 8000 }, generated_seconds: wasCached ? 0 : 8, cost_usd: wasCached ? 0 : 0.02, model: "music_v1", song_id: "song_1" };
      }
    }),
    async analyzeBeats() { return grid; },
    async prepareMusic(input, output, options) { music.prepared.push(options); await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, `prepared ${options.offset} ${options.tempo}`); return { output }; }
  });
  return { adapters: base, notices, music };
}

test("--chapter re-renders that chapter's segments, stitches the master and writes the chapter alone", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-finish-chapter-"));
  try {
    await cp(MINIMAL, project, { recursive: true });
    const story = JSON.parse(await readFile(path.join(project, "storyboard.json"), "utf8"));
    story.chapters = [{ id: "open", title: "Open", start: 0 }, { id: "fix", title: "The fix", start: 3 }];
    await writeFile(path.join(project, "storyboard.json"), JSON.stringify(story));
    const adapters = segmentAdapters();
    adapters.muxChapters = async (input, metadata, output) => { await writeFile(output, await readFile(input, "utf8")); };
    const cuts = [];
    adapters.cutChapter = async (input, output, window) => { cuts.push(window); await writeFile(output, `cut ${window.start}-${window.end}`); };
    const first = await runFinish(project, { renderer: "remotion" }, adapters);
    assert.equal(first.stages.find((stage) => stage.name === "render").details.segments.rendered, 4);
    assert.equal(first.chapter, undefined);

    const report = await runFinish(project, { renderer: "remotion", chapter: "fix" }, adapters);
    const segments = report.stages.find((stage) => stage.name === "render").details.segments;
    assert.deepEqual([segments.reused, segments.forced], [1, 3], "the segments from 3 s on re-render; the opening is reused");
    assert.deepEqual(adapters.segmentCalls.at(-1), [[90, 102], [102, 179], [179, 180]]);
    assert.deepEqual(report.stages.slice(4).map((stage) => stage.reason), ["forced", "forced", "forced", "forced"]);
    assert.deepEqual(cuts, [{ start: 3, end: 6 }]);
    assert.deepEqual(report.chapter, { id: "fix", title: "The fix", start: 3, end: 6, output: "renders/chapters/fix.mp4", segments: { forced: 3, reused: 1, total: 4 } });
    assert.equal(await readFile(path.join(project, "renders/chapters/fix.mp4"), "utf8"), "cut 3-6");
    assert.ok(report.final, "the whole master is still delivered");
    assert.match(formatFinishSummary(report), /chapter fix \(The fix, 3–6 s\): 3 of 4 segments re-rendered, master stitched, renders\/chapters\/fix\.mp4/);

    await assert.rejects(runFinish(project, { chapter: "nope" }, adapters), /unknown chapter "nope"; storyboard\.json has open, fix/);
    await assert.rejects(runFinish(project, { chapter: "fix", scenes: "s1" }, adapters), /--chapter re-renders a whole chapter; drop --scene/);
    await assert.rejects(runFinish(project, { chapter: "fix", prototype: true }, adapters), /--prototype renders the opening; drop --scene, --preview-scene and --chapter/);
    delete story.chapters;
    await writeFile(path.join(project, "storyboard.json"), JSON.stringify(story));
    await assert.rejects(runFinish(project, { chapter: "fix" }, adapters), /--chapter needs chapters in storyboard\.json; run launchclip story long-form first/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("finish defaults to ElevenLabs music with a key, aligns it to the narration and caches it", async () => {
  const project = await narratedProject();
  try {
    const { adapters, notices, music } = musicAdapters();
    const report = await runFinish(project, { renderer: "remotion" }, adapters);
    const sound = report.stages.find((stage) => stage.name === "sound");
    assert.equal(sound.status, "done", sound.error);
    assert.equal(sound.details.music.provider, "elevenlabs");
    assert.ok(notices.some((line) => /paid/.test(line) && /\/cache\/elevenlabs\/music/.test(line)), notices.join("\n"));
    assert.ok(!notices.join("\n").includes("sk_test_never_sent"));
    const sync = JSON.parse(await readFile(path.join(project, PATHS.beatSync), "utf8"));
    assert.equal(sync.schema_version, "launchclip.beat-sync.v1");
    assert.equal(sync.strategy, "align", "narrated: the music moves, the story does not");
    assert.equal(sync.changes.length, 0);
    assert.ok(sync.alignment.offset > 0, JSON.stringify(sync.alignment));
    assert.equal(sync.music.analysed_bpm, 120);
    assert.ok(sync.summary.key_moments_on_downbeat >= 1, JSON.stringify(sync.moments));
    const beats = JSON.parse(await readFile(path.join(project, "BEATS.json"), "utf8"));
    assert.equal(beats.schema_version, "launchclip.beats.v1");
    assert.equal(beats.generated_by, "launchclip finish");
    assert.equal(beats.alignment.offset, sync.alignment.offset);
    assert.equal(music.prepared[0].offset, sync.alignment.offset);
    assert.equal(adapters.lastMix.music, path.join(project, PATHS.musicPrepared));
    const manifest = JSON.parse(await readFile(path.join(project, PATHS.audioManifest), "utf8"));
    assert.equal(manifest.music.provider, "elevenlabs");
    assert.equal(manifest.music.generation.endpoint, "POST /v1/music");
    assert.match(manifest.license, /ElevenLabs/);
    // The story copy keeps the narration timing.
    const resolved = JSON.parse(await readFile(path.join(project, PATHS.resolved), "utf8"));
    assert.equal(resolved.scenes[1].start, 3);

    const again = await runFinish(project, { renderer: "remotion" }, adapters);
    assert.equal(again.stages.find((stage) => stage.name === "sound").status, "cached");
    assert.equal(music.generated, 1, "the track is generated once");
    // --music synth overrides the default without touching the cache.
    const synth = await runFinish(project, { renderer: "remotion", music: "synth" }, adapters);
    assert.equal(synth.stages.find((stage) => stage.name === "sound").details.music.provider, "synth");
    await assert.rejects(runFinish(project, { music: "lofi" }, adapters), /Unknown --music lofi/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("finish and cinematic-check judge the same mix with the same music volume", async () => {
  const project = await narratedProject();
  try {
    const adapters = fakeAdapters();
    const seen = {};
    adapters.audio = async (_video, manifest, options) => { seen.finish = options.musicVolume; return { quality: { ok: true, findings: [] } }; };
    const report = await runFinish(project, { renderer: "remotion" }, adapters);
    assert.equal(report.status === "failed", false, JSON.stringify(report.stages.find((stage) => stage.status === "failed")));
    const manifest = JSON.parse(await readFile(path.join(project, PATHS.audioManifest), "utf8"));
    const bedVolume = manifest.music.volume;
    assert.ok(bedVolume > 0.15, `finish's bed is louder than the old 0.15 assumption (${bedVolume})`);
    assert.equal(seen.finish, bedVolume);

    const checkAdapters = {
      verifyProject: async () => ({ schema_version: "launchclip.subscription-verification.v1", status: "passed", failed: [] }),
      writeMotionReport: async (_video, output) => { await writeFile(output, "{}"); return { quality: { ok: true, findings: [] } }; },
      analyzeProductionAudio: async (_video, _manifest, options) => { seen.check = options.musicVolume; return { expected_audio: true, stream: {}, output: {}, sources: {}, cues: [], quality: { ok: true, findings: [] } }; }
    };
    const checked = await checkCinematicProject(project, { video: report.final ?? "renders/draft.mp4" }, checkAdapters);
    assert.equal(seen.check, bedVolume, "cinematic-check reads the bed volume finish used");
    const audioReport = JSON.parse(await readFile(checked.audio, "utf8"));
    assert.equal(audioReport.mix_settings.source, "AUDIO-MANIFEST.json music.volume");
    assert.equal(audioReport.mix_settings.ducking, manifest.mix.ducking);

    // With the same measured sources both verdicts match; the old 0.15 would not.
    const sources = (volume) => ({ voiceover: { integrated_lufs: -16 }, music: { integrated_lufs: -16.5 }, music_gain_db: 20 * Math.log10(volume) });
    const verdict = (volume) => evaluateAudioQuality({ sources: sources(volume), cues: [] }).ok;
    assert.equal(verdict(seen.check), verdict(seen.finish));

    // No manifest volume: finish.json's sound stage; an explicit flag wins over both.
    delete manifest.music.volume;
    await writeFile(path.join(project, PATHS.audioManifest), JSON.stringify(manifest));
    const fromFinish = await resolveMusicMix(project, path.join(project, PATHS.audioManifest));
    assert.equal(fromFinish.music_volume, bedVolume);
    assert.match(fromFinish.source, /finish\.json/);
    assert.equal((await resolveMusicMix(project, null, { musicVolume: "0.4" })).music_volume, 0.4);
    await assert.rejects(resolveMusicMix(project, null, { musicVolume: "loud" }), /--music-volume must be a number/);
    // A manual project with nothing to read falls back to 0.15.
    const bare = await mkdtemp(path.join(os.tmpdir(), "launchclip-mix-"));
    assert.equal((await resolveMusicMix(bare, null)).music_volume, 0.15);
    await rm(bare, { recursive: true, force: true });

    // The CLI takes --music-volume and keeps --musicVolume as an alias.
    for (const flag of ["--music-volume", "--musicVolume"]) {
      seen.check = null;
      await runCli(["cinematic-check", project, flag, "0.27"], { stdout: { write() {} }, stderr: { write() {} }, productionAdapters: { cinematicCheck: checkAdapters } });
      assert.equal(seen.check, 0.27, flag);
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("finish locks the ElevenLabs track: scene timing reuses it, a new brief or --music-regenerate pays", async () => {
  const project = await narratedProject();
  try {
    const { adapters, notices, music } = musicAdapters();
    // A provider with a real cache lookup, keyed by the request body.
    const cache = new Set();
    const stub = adapters.musicProvider();
    adapters.musicProvider = () => ({
      ...stub,
      request(story, params) { return { mode: "prompt", body: { prompt: `bpm ${params.bpm}`, model_id: "music_v1" }, bpm: params.bpm, length_ms: 10000 }; },
      cacheStatus(story, params) { const key = `k${params.bpm}`; return { cached: cache.has(key), cache_key: key, cache_file: `/cache/${key}.mp3`, length_ms: 10000, cost_usd_estimate: 0.03 }; },
      async generate(story, params, { outFile, force }) {
        const key = `k${params.bpm}`;
        await mkdir(path.dirname(outFile), { recursive: true });
        await writeFile(outFile, `mp3 ${key} ${music.generated}`);
        const hit = cache.has(key) && !force;
        if (!hit) music.generated += 1;
        cache.add(key);
        return { file: outFile, cached: hit, cache_key: key, cache_file: `/cache/${key}.mp3`, request: { mode: "prompt", bpm: params.bpm, length_ms: 10000 }, generated_seconds: hit ? 0 : 10, cost_usd: hit ? 0 : 0.03, model: "music_v1", song_id: null };
      }
    });
    const first = await runFinish(project, { renderer: "remotion" }, adapters);
    assert.equal(first.stages.find((stage) => stage.name === "sound").status, "done");
    assert.equal(music.generated, 1);
    assert.ok(notices.some((line) => /^music: PAID ElevenLabs generation/.test(line) && /no music lock yet/.test(line)), notices.join("\n"));
    const lock = JSON.parse(await readFile(path.join(project, ".launchclip/music-lock.json"), "utf8"));
    assert.equal(lock.schema_version, "launchclip.music-lock.v1");
    assert.equal(lock.request_hash, `k${lock.bpm}`);
    assert.equal(lock.brief.provider, "elevenlabs");
    assert.ok(existsSync(path.join(project, lock.file)));

    // Move a scene boundary: the brief is unchanged, so the locked track is reused.
    notices.length = 0;
    const story = JSON.parse(await readFile(path.join(project, "storyboard.json"), "utf8"));
    story.scenes[0].end = 3.3;
    story.scenes[1].start = 3.3;
    await writeFile(path.join(project, "storyboard.json"), JSON.stringify(story));
    await runFinish(project, { renderer: "remotion" }, adapters);
    assert.equal(music.generated, 1, "timing edits never trigger a paid generation");
    assert.ok(notices.some((line) => /^music: REUSE locked ElevenLabs track/.test(line)), notices.join("\n"));
    assert.ok(!notices.some((line) => /PAID/.test(line)));
    const manifest = JSON.parse(await readFile(path.join(project, PATHS.audioManifest), "utf8"));
    assert.equal(manifest.music.generation.locked, true);

    // A changed music brief (BPM) is a new, paid generation, and the lock follows it.
    notices.length = 0;
    story.audio.music = { provider: "elevenlabs", bpm: 128 };
    await writeFile(path.join(project, "storyboard.json"), JSON.stringify(story));
    await runFinish(project, { renderer: "remotion" }, adapters);
    assert.equal(music.generated, 2);
    assert.ok(notices.some((line) => /PAID/.test(line) && /music brief changed \(bpm\)/.test(line)), notices.join("\n"));
    assert.equal(JSON.parse(await readFile(path.join(project, ".launchclip/music-lock.json"), "utf8")).bpm, 128);

    // --music-regenerate forces one more, even though the stage would be cached.
    notices.length = 0;
    await runFinish(project, { renderer: "remotion", musicRegenerate: true }, adapters);
    assert.equal(music.generated, 3);
    assert.ok(notices.some((line) => /PAID/.test(line) && /--music-regenerate/.test(line)), notices.join("\n"));
    // And the next plain run reuses that track.
    notices.length = 0;
    const settled = await runFinish(project, { renderer: "remotion" }, adapters);
    assert.equal(settled.stages.find((stage) => stage.name === "sound").status, "cached");
    assert.equal(music.generated, 3);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("--preview-scene renders one scene to renders/scene-<id>.mp4 and leaves the final alone", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-finish-preview-"));
  try {
    await cp(MINIMAL, project, { recursive: true });
    const adapters = segmentAdapters();
    const first = await runFinish(project, { renderer: "remotion" }, adapters);
    const final = await readFile(first.final, "utf8");
    const state = await readFile(path.join(project, PATHS.state), "utf8");

    const story = JSON.parse(await readFile(path.join(project, "storyboard.json"), "utf8"));
    story.scenes[1].params.title = "Three fixes";
    await writeFile(path.join(project, "storyboard.json"), JSON.stringify(story));
    let out = "";
    await runCli(["finish", project, "--preview-scene", "s2"], { stdout: { write: (text) => { out += text; } }, stderr: { write() {} }, productionAdapters: { finish: adapters } });
    const report = JSON.parse(await readFile(path.join(project, "finish.json"), "utf8"));
    assert.equal(report.status, "preview");
    assert.equal(report.final, null);
    assert.deepEqual(report.preview, { scene: "s2", output: path.join(project, "renders/scene-s2.mp4") });
    assert.deepEqual(report.stages.map((stage) => stage.status), ["skipped", "done", "cached", "skipped", "done", "skipped", "skipped", "skipped"]);
    assert.match(report.stages[5].reason, /--preview-scene s2: only that scene was rendered; the final is untouched/);
    const segments = report.stages[4].details.segments;
    assert.deepEqual(segments.frames, { start: 90, end: 180, count: 90 });
    assert.deepEqual(segments.plan.map((entry) => entry.status), ["rendered", "rendered", "rendered"]);
    assert.match(await readFile(path.join(project, "renders/scene-s2.mp4"), "utf8"), /^90-102 Build time\|Three fixes\n102-179/);
    assert.equal(await readFile(first.final, "utf8"), final, "the final is untouched");
    assert.equal(await readFile(path.join(project, PATHS.state), "utf8").then((text) => JSON.parse(text).stages.render.input_hash), JSON.parse(state).stages.render.input_hash);
    assert.match(out, /^launchclip finish: preview/);
    assert.match(out, /preview: .*renders\/scene-s2\.mp4/);
    assert.match(report.next_steps.at(-1), /--scene s2 to re-render it into the final/);

    // The full run that follows reuses the segments the preview rendered.
    const full = await runFinish(project, { renderer: "remotion" }, adapters);
    const reused = full.stages.find((stage) => stage.name === "render").details.segments;
    assert.deepEqual([reused.reused, reused.rendered], [4, 0]);
    assert.match(await readFile(full.final, "utf8"), /Three fixes/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("launchclip finish --scene takes a comma-separated list", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-finish-scenes-"));
  try {
    await cp(MINIMAL, project, { recursive: true });
    const adapters = segmentAdapters();
    await runFinish(project, { renderer: "remotion" }, adapters);
    let out = "";
    await runCli(["finish", project, "--scene", "s1,s2", "--json"], { stdout: { write: (text) => { out += text; } }, stderr: { write() {} }, productionAdapters: { finish: adapters } });
    const report = JSON.parse(out);
    assert.deepEqual(report.scenes, ["s1", "s2"]);
    assert.deepEqual(report.scene_stills.map((still) => still.scene), ["s1", "s2"]);
    assert.equal(report.stages.find((stage) => stage.name === "render").details.segments.forced, 4);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});


test("finish snaps a motion story's cuts and hits to the music grid", async () => {
  const project = await narratedProject({
    mutate: (story) => {
      delete story.audio.narration;
      story.overlays = [];
      story.scenes[0].hits = [{ at: 1.1, event: "settle", cue: "tick" }];
      story.scenes[1].hits = [{ at: 3.9, event: "rows-start" }];
      story.scenes[0].end = 2.9;
      story.scenes[1].start = 2.9;
    }
  });
  try {
    const { adapters } = musicAdapters(fakeAdapters(), { env: {} });
    const report = await runFinish(project, { renderer: "remotion" }, adapters);
    const sound = report.stages.find((stage) => stage.name === "sound");
    assert.equal(sound.status, "done", sound.error);
    assert.equal(sound.details.music.provider, "synth");
    const sync = JSON.parse(await readFile(path.join(project, PATHS.beatSync), "utf8"));
    assert.equal(sync.strategy, "snap");
    // Synth bed at 96 BPM: beats every 0.625 s, downbeats every 2.5 s.
    assert.deepEqual(sync.changes.map((change) => [change.kind, change.scene, change.from, change.to, change.grid]), [
      ["cut", "s2", 2.9, 3.125, "beat"],
      ["hit", "s1", 1.1, 1.25, "beat"],
      // s2's hit first moves with its scene (+0.225 s), then onto the beat.
      ["hit", "s2", 4.125, 4.375, "beat"]
    ]);
    const resolved = JSON.parse(await readFile(path.join(project, PATHS.resolved), "utf8"));
    assert.equal(resolved.scenes[1].start, 3.125);
    assert.equal(resolved.scenes[0].end, 3.125);
    // The user's storyboard is untouched and the SFX follow the moved hit.
    assert.equal(JSON.parse(await readFile(path.join(project, "storyboard.json"), "utf8")).scenes[1].start, 2.9);
    const sfx = JSON.parse(await readFile(path.join(project, PATHS.sfxManifest), "utf8"));
    assert.ok(sfx.cues.some((cue) => cue.at_seconds === 1.25), JSON.stringify(sfx.cues));
    // Cached rerun re-applies the snapped timing to the copy.
    const again = await runFinish(project, { renderer: "remotion" }, adapters);
    assert.equal(again.stages.find((stage) => stage.name === "sound").status, "cached");
    assert.equal(JSON.parse(await readFile(path.join(project, PATHS.resolved), "utf8")).scenes[1].start, 3.125);
    assert.equal(again.stages.find((stage) => stage.name === "render").status, "cached");
    // sync: off leaves the story alone.
    const story = JSON.parse(await readFile(path.join(project, "storyboard.json"), "utf8"));
    story.audio.music = { provider: "synth", sync: "off" };
    await writeFile(path.join(project, "storyboard.json"), JSON.stringify(story));
    await runFinish(project, { renderer: "remotion" }, adapters);
    assert.equal(JSON.parse(await readFile(path.join(project, PATHS.resolved), "utf8")).scenes[1].start, 2.9);
    // --music none: no music, no beat sync.
    const none = await runFinish(project, { renderer: "remotion", music: "none" }, adapters);
    assert.equal(none.stages.find((stage) => stage.name === "sound").details.music, null);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("--music elevenlabs without a key fails before anything is sent", async () => {
  const project = await narratedProject();
  try {
    const { adapters, music } = musicAdapters(fakeAdapters(), { env: {} });
    const report = await runFinish(project, { music: "elevenlabs" }, adapters);
    const sound = report.stages.find((stage) => stage.name === "sound");
    assert.equal(sound.status, "failed");
    assert.match(sound.error, /--music elevenlabs needs ELEVENLABS_API_KEY/);
    assert.equal(music.generated, 0);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

async function chromeAvailable() {
  try {
    await execFileAsync("ffmpeg", ["-version"]);
    const { ensureBrowser } = await import("@remotion/renderer");
    await ensureBrowser();
    return null;
  } catch (error) {
    return error.message;
  }
}

test("end to end: examples/story/minimal with the test voice through remotion", { skip: mediaSkip(), timeout: 900_000 }, async (t) => {
  const missing = process.env.LAUNCHCLIP_SKIP_REMOTION === "1" ? "LAUNCHCLIP_SKIP_REMOTION=1" : await chromeAvailable();
  if (missing) { t.skip(`Chrome Headless Shell or FFmpeg is unavailable: ${missing}`); return; }
  const project = await narratedProject();
  try {
    const started = performance.now();
    const report = await runFinish(project, { renderer: "remotion", voice: "test" }, { env: {} });
    const seconds = (performance.now() - started) / 1000;
    t.diagnostic(`finish took ${seconds.toFixed(1)}s: ${report.stages.map((stage) => `${stage.name} ${stage.seconds}s`).join(", ")}`);
    assert.notEqual(report.status, "failed", JSON.stringify(report.stages.filter((stage) => stage.error)));
    assert.deepEqual(report.stages.map((stage) => stage.status), STAGE_NAMES.map(() => "done"));
    const final = path.join(project, "renders/draft.mp4");
    assert.equal(report.final, final);
    const probe = JSON.parse((await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", final])).stdout);
    assert.deepEqual(probe.streams.map((stream) => stream.codec_type).sort(), ["audio", "video"]);
    assert.ok(Math.abs(Number(probe.format.duration) - 6) < 0.2);
    const master = report.stages.find((stage) => stage.name === "master").details;
    assert.equal(master.mastered, true);
    assert.equal(master.loudness.compliant, true);
    for (const name of ["layout", "loudness", "motion", "audio", "temporal_evidence"]) assert.match(report.gates[name].status, /^(passed|failed)$/, name);
    assert.equal(report.gates.temporal_evidence.status, "passed", JSON.stringify(report.gates.temporal_evidence));
    assert.equal(report.gates.audio.status, "passed", JSON.stringify(report.gates.audio));
    assert.equal(report.gates.critic.status, "pending");
    assert.ok(existsSync(path.join(project, "qa/critic-sheets/index.json")));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("finish notes in one line the SFX families that fall back to the kit", async () => {
  const project = await narratedProject();
  const home = await mkdtemp(path.join(os.tmpdir(), "launchclip-finish-sfx-home-"));
  try {
    const dir = path.join(home, ".launchclip/sfx");
    await mkdir(path.join(dir, "impact"), { recursive: true });
    await writeFile(path.join(dir, "impact/impact-1.wav"), "wav");
    await writeFile(path.join(dir, "library.json"), JSON.stringify({ schema_version: "launchclip.sfx-library.v1", families: { impact: { source: "elevenlabs", variants: [{ file: "impact/impact-1.wav", source: "elevenlabs" }] } } }));
    const report = await runFinish(project, { renderer: "remotion", sfxHome: home }, fakeAdapters());
    const notes = report.warnings.filter((line) => line.startsWith("sfx: "));
    assert.equal(notes.length, 1, report.warnings.join("\n"));
    assert.match(notes[0], /not in the SFX library .* procedural kit; fill only the missing families with: launchclip sfx seed --missing/);
    assert.ok(!/\bimpact\b/.test(notes[0].split(" not in ")[0]), "families the library has are not listed");
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

// The subject gate (RFC §9): a matte range that collapses is not used, and
// its subject scenes fall back instead of shipping a broken cut-out. The
// footage base's sound stage probes the recording, so it needs ffprobe.
test("runFinish drops a collapsing matte's subject scenes to their fallback", async (t) => {
  try { await execFileAsync("ffprobe", ["-version"]); } catch { t.skip("ffprobe is unavailable"); return; }
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-finish-subject-"));
  try {
    await cp(path.join(ROOT, "examples/story/subject"), project, { recursive: true });
    const infoFile = path.join(project, "assets/subject/0.000-6.000.json");
    const info = JSON.parse(await readFile(infoFile, "utf8"));
    info.frames = info.frames.map((frame, index) => (index >= 60 && index < 66 ? { ...frame, coverage: 0.002 } : frame));
    await writeFile(infoFile, JSON.stringify(info));
    const story = JSON.parse(await readFile(path.join(project, "storyboard.json"), "utf8"));
    // A plain caption behind the presenter renders in front instead.
    story.scenes.push({ id: "aside", module: "emphasis-caption", track: 4, layer: "behind", start: 5, end: 5.9, params: { text: "Ship it", position: "lower" } });
    await writeFile(path.join(project, "storyboard.json"), JSON.stringify(story, null, 2));
    const adapters = fakeAdapters();
    const report = await runFinish(project, { renderer: "remotion" }, adapters);
    // When the gate is missing, say why: which gates ran and what validate saw.
    assert.ok(report.gates?.subject, JSON.stringify({ gates: Object.keys(report.gates ?? {}), stages: report.stages.map((stage) => [stage.name, stage.status, String(stage.error ?? stage.reason ?? "").slice(0, 300)]), validate: report.stages.find((stage) => stage.name === "validate")?.details?.subject ?? null, warnings: report.warnings.slice(0, 8) }));
    assert.equal(report.gates.subject.status, "fallback");
    assert.match(report.gates.subject.ranges[0].reasons.join(" "), /collapses in 6 frames/);
    assert.deepEqual(report.gates.subject.changes.map((change) => [change.id, change.action]), [["word", "skipped"], ["dolly", "skipped"], ["aside", "front"]]);
    assert.ok(report.warnings.some((warning) => /subject gate: the matte for 0–6 s is not used/.test(warning)), report.warnings.join("\n"));
    assert.equal(report.gates.layout.status, "passed");
    const rendered = adapters.lastRender.options.story;
    assert.deepEqual(rendered.scenes.map((scene) => scene.id), ["push", "name", "aside"]);
    assert.equal(rendered.scenes.find((scene) => scene.id === "aside").layer, "front");
    assert.deepEqual(rendered.base.subject, { mattes: [] });
    // The user's storyboard is untouched.
    assert.equal(JSON.parse(await readFile(path.join(project, "storyboard.json"), "utf8")).scenes.length, 5);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("finish --prototype gates only the direction lines and scenes inside the window", async () => {
  // Narration that runs past the cut with no sentence end inside 20–30 s, so the cut is s2's end (24 s).
  const project = await narratedProject({ mutate: (story) => {
    story.format.duration = 45;
    story.audio.narration.text = `${NARRATION} ${Array(100).fill("and").join(" ")} done.`;
    const [metric, checklist] = story.scenes;
    story.scenes = [{ ...metric, start: 0, end: 12 }, { ...checklist, start: 12, end: 24 }, { ...metric, id: "s3", start: 24, end: 45 }];
    delete story.ending;
    return story;
  } });
  try {
    await rm(path.join(project, "DIRECTION.json"), { force: true });
    const first = await runFinish(project, { renderer: "remotion", prototype: true }, fakeAdapters());
    assert.equal(first.prototype.cut, 24);
    const words = JSON.parse(await readFile(path.join(project, "NARRATION.json"), "utf8")).words;
    const late = words.findIndex((word) => word.start >= 24);
    assert.ok(late > 0, "the narration runs past the cut");
    // The map covers the whole story; s3 starts after the cut.
    const line = (range, scenes) => ({ words: range, intent: "claim", treatment: "dress", scenes });
    await writeFile(path.join(project, "DIRECTION.json"), JSON.stringify({
      schema: "launchclip.direction-map.v1",
      sections: [
        { id: "open", lines: [line([0, late - 1], ["s1", "s2"])] },
        { id: "rest", lines: [line([late, words.length - 1], ["s3"])] }
      ]
    }));
    const report = await runFinish(project, { renderer: "remotion", prototype: true }, fakeAdapters());
    assert.equal(report.gates.direction.status, "passed", JSON.stringify(report.gates.direction));
    assert.equal(report.gates.direction.scope, "prototype: the opening 24 s");
    assert.equal(report.gates.direction.lines, 1);
    // The whole run still checks every line.
    const whole = await runFinish(project, { renderer: "remotion" }, fakeAdapters());
    assert.equal(whole.gates.direction.status, "passed", JSON.stringify(whole.gates.direction));
    assert.equal(whole.gates.direction.lines, 2);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("finish --prototype renders only the opening 20–30 s, cut at a scene end, and gates it", async () => {
  const project = await narratedProject({ mutate: (story) => {
    story.format.duration = 45;
    const [metric, checklist] = story.scenes;
    story.scenes = [{ ...metric, start: 0, end: 12 }, { ...checklist, start: 12, end: 24 }, { ...metric, id: "s3", start: 24, end: 45 }];
    delete story.ending;
    return story;
  } });
  try {
    await rm(path.join(project, "DIRECTION.json"), { force: true });
    const report = await runFinish(project, { renderer: "remotion", prototype: true }, fakeAdapters());
    assert.equal(report.status, "prototype", JSON.stringify(report.stages.filter((stage) => stage.error)));
    assert.equal(report.output, path.join(project, "renders/prototype.mp4"));
    assert.deepEqual(report.prototype, { cut: 24, duration: 45 });
    const copy = JSON.parse(await readFile(path.join(project, PATHS.copy), "utf8"));
    assert.equal(copy.format.duration, 24);
    assert.deepEqual(copy.scenes.map((scene) => scene.id), ["s1", "s2"], "scenes after the cut are dropped");
    assert.equal(report.gates.coverage.scope, "prototype: the opening 24 s");
    assert.ok(report.next_steps.some((step) => /Review the prototype \(renders\/prototype\.mp4, the opening 24 s of 45 s\)/.test(step)));
    await assert.rejects(runFinish(project, { renderer: "remotion", prototype: true, candidate: "a" }, fakeAdapters()), /--prototype or --candidate/);

  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
