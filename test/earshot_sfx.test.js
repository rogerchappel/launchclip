import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  EARSHOT_FAMILIES, EARSHOT_FIT_CREDITS, applyEarshotSounds, cueEventTime, earshotCredit, earshotPitch, earshotRenderArgs,
  earshotRenderKey, findEarshot, matchGain, placeEarshotTake, planEarshotCues
} from "../src/sfx/earshot.js";
import { SFX_MODES, resolveSfxMode } from "../src/sfx/event_sounds.js";
import { SFX_FAMILY_NAMES } from "@launchclip/core/sound/options.mjs";
import { PATHS, runFinish, sfxLicense } from "../src/finish.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const MINIMAL = path.join(ROOT, "examples/story/minimal");
const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();

// A fake render: writes a file and returns the meta `earshot sfx render --json` gives.
function fakeRender(calls = []) {
  return async (_bin, request, out) => {
    calls.push(request);
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, `take ${request.id} ${request.seed ?? ""}`);
    return { meta: { id: request.id, seed: request.seed ?? 1, onset_s: 0.004, peak_s: request.apex ?? 0.05, dur_s: request.dur ?? 0.3, checks: { ok: true } } };
  };
}

test("earshot mapping: every mapped family is a LaunchClip family with bank ids; unmapped families are left alone", () => {
  for (const [family, spec] of Object.entries(EARSHOT_FAMILIES)) {
    assert.ok(SFX_FAMILY_NAMES.includes(family), `${family} is a kit family`);
    assert.ok(spec.ids.length >= 1);
    for (const id of spec.ids) assert.match(id, /^[a-z0-9_.]+(\/[a-z0-9_.]+)+$/, id);
    assert.ok(["onset", "peak"].includes(spec.align));
  }
  // The core roles are covered; families with no fitting bank sound are not guessed at.
  for (const family of ["whoosh", "impact", "pop", "tick", "click", "riser", "snap", "thud", "ding", "glitch"]) assert.ok(EARSHOT_FAMILIES[family], family);
  for (const family of ["tally", "keystroke", "cash", "door", "footstep", "error-buzz"]) assert.equal(EARSHOT_FAMILIES[family], undefined, family);
});

test("earshot plan: members in turn per family, a new take past the members, typing and unmapped cues skipped", () => {
  const cues = [
    { cue: "pop", at: 1, source: "hit", volume: 0.35 },
    { cue: "pop", at: 2, source: "hit", volume: 0.35 },
    { cue: "tally", at: 3, source: "hit", volume: 0.16 },
    ...Array.from({ length: 4 }, (_, i) => ({ cue: "pop", at: 4 + i, source: "hit", volume: 0.35 })),
    { cue: "typing", at: 0, source: "typing", volume: 1 },
    { cue: "whoosh", at: 5.783, source: "transition", volume: 0.4 }
  ];
  const plan = planEarshotCues(cues, { storyId: "demo" });
  const pops = plan.filter((entry) => entry.family === "pop");
  assert.equal(pops.length, 6);
  const members = EARSHOT_FAMILIES.pop.ids;
  assert.deepEqual(new Set(pops.slice(0, members.length).map((entry) => entry.id)), new Set(members), "each member before a repeat");
  assert.equal(pops[0].seed, null);
  assert.ok(Number.isInteger(pops[members.length].seed), "a repeat past the members gets a new take");
  assert.equal(plan.some((entry) => entry.family === "tally" || entry.family === "typing"), false);
  const whoosh = plan.find((entry) => entry.family === "whoosh");
  assert.equal(whoosh.event_at, 6, "a transition whoosh's event is its cut");
  assert.equal(whoosh.align, "peak");
  assert.deepEqual(planEarshotCues(cues, { storyId: "demo" }), plan, "deterministic");
});

test("earshot placement: onset or peak on the event plus offset; a take that would start before 0 is head-trimmed", () => {
  assert.deepEqual(placeEarshotTake({ event_at: 2, offset_ms: 0, align: "onset" }, { onset_s: 0.01, peak_s: 0.05 }), { at: 1.99, offset: 0, sync_at: 2 });
  assert.deepEqual(placeEarshotTake({ event_at: 2, offset_ms: 37, align: "peak" }, { onset_s: 0.02, peak_s: 0.22 }), { at: 1.817, offset: 0, sync_at: 2.037 });
  assert.deepEqual(placeEarshotTake({ event_at: 0.1, offset_ms: 0, align: "peak" }, { peak_s: 0.3 }), { at: 0, offset: 0.2, sync_at: 0.1 });
  assert.equal(cueEventTime({ cue: "riser", at: 3, lands_at: 4.33, source: "hit" }), 4.33);
  assert.equal(cueEventTime({ cue: "pop", at: 3, source: "hit" }), 3);
});

test("earshot levels, pitch, render args and cache key", () => {
  assert.equal(matchGain(-20, -20), 1);
  assert.ok(Math.abs(matchGain(-26, -20) - 0.501) < 0.01);
  assert.equal(matchGain(-60, -6), 0.5, "clamped");
  assert.equal(matchGain(-6, -60), 2, "clamped");
  assert.equal(matchGain(null, -6), 1);
  assert.equal(earshotPitch("mallet/glock", "D#"), "D#6");
  assert.equal(earshotPitch("mallet/glock", "Bbm"), "Bb6");
  assert.equal(earshotPitch("cut_hit/punch", "D"), null);
  assert.equal(earshotPitch("mallet/glock", null), null);
  assert.deepEqual(earshotRenderArgs({ id: "whoosh_fast/crisp", dur: 0.6, apex: 0.22, pitch: null, seed: null }, "/t/a.wav"), ["sfx", "render", "whoosh_fast/crisp", "-o", "/t/a.wav", "--json", "--dur", "0.6", "--apex", "0.22"]);
  assert.notEqual(earshotRenderKey({ id: "a/b", seed: 1 }), earshotRenderKey({ id: "a/b", seed: 2 }));
  assert.equal(earshotRenderKey({ id: "a/b" }), earshotRenderKey({ id: "a/b", dur: null }));
});

test("earshot credits: fitted bank sounds carry a CC0 credit; recipes need none; the licence line says so", () => {
  assert.equal(Object.keys(EARSHOT_FIT_CREDITS).length, 15);
  const credit = earshotCredit("fit/pop/lip_pop");
  assert.equal(credit.license, "CC0-1.0");
  assert.match(credit.source, /freesound\.org\/s\/202230/);
  assert.equal(earshotCredit("ui_pop/soft"), null);
  assert.match(sfxLicense(new Set(["procedural", "earshot"])), /Earshot sound bank.*MIT/);
  assert.match(sfxLicense(new Set(["earshot-fit"])), /CC0 1\.0.*sfx_credits/);
  assert.doesNotMatch(sfxLicense(new Set(["earshot"])), /Other SFX library sources/);
});

test("--sfx earshot: used when the tool is found, else the kit with a warning", async () => {
  assert.ok(SFX_MODES.includes("earshot"));
  const missing = resolveSfxMode("earshot", { PATH: "" });
  assert.equal(missing.mode, "kit");
  assert.match(missing.warning, /needs the earshot tool/);
  assert.deepEqual(resolveSfxMode("earshot", {}, { earshot: () => "/opt/earshot" }), { mode: "earshot", earshot: "/opt/earshot" });
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-earshot-bin-"));
  try {
    const bin = path.join(dir, "earshot");
    await writeFile(bin, "#!/bin/sh\nexit 0\n");
    await chmod(bin, 0o755);
    assert.equal(findEarshot({ PATH: dir }), bin);
    assert.equal(findEarshot({ PATH: "", LAUNCHCLIP_EARSHOT: bin }), bin);
    assert.equal(findEarshot({ PATH: dir, LAUNCHCLIP_EARSHOT: path.join(dir, "nope") }), null);
    assert.equal(findEarshot({ PATH: "" }), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("applyEarshotSounds: mapped cues get takes placed on their events and matched in level; failures and gaps keep their files", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-earshot-apply-"));
  const cache = path.join(project, "cache");
  try {
    const calls = [];
    const render = fakeRender(calls);
    const failing = async (bin, request, out) => { if (request.family === "tick") throw new Error("boom"); return render(bin, request, out); };
    const kitPop = path.join(project, "kit", "pop.wav");
    await mkdir(path.dirname(kitPop), { recursive: true });
    await writeFile(kitPop, "kit pop");
    const level = async (file) => (file === kitPop ? -20 : -14);
    const cues = [
      { cue: "pop", at: 1, volume: 0.35, source: "hit", file: kitPop },
      { cue: "tick", at: 2, volume: 0.3, source: "hit", file: "/kit/tick.wav" },
      { cue: "tally", at: 3, volume: 0.16, source: "hit", file: "/kit/tally.wav", offset: 0.4 },
      { cue: "pop", at: 4, volume: 0.35, source: "hit", file: kitPop }
    ];
    const result = await applyEarshotSounds(cues, { project, bin: "/fake/earshot", storyId: "s", cacheDir: cache, render: failing, level, timbre: async () => null });
    // pop: onset 4 ms in → starts 4 ms after the event (offset_ms 4) minus the onset.
    assert.equal(result.cues[0].sfx_source, "earshot");
    assert.equal(result.cues[0].at, 1);
    assert.equal(result.cues[0].earshot.sync_at, 1.004);
    assert.ok(Math.abs(result.cues[0].volume - 0.35 * 10 ** (-6 / 20)) < 0.002, "matched to the replaced file");
    assert.ok(result.cues[0].file.startsWith(path.join(project, ".launchclip", "sfx-earshot")));
    assert.notEqual(result.cues[0].earshot.id, result.cues[3].earshot.id, "the repeat takes another member");
    assert.equal(result.cues[1].file, "/kit/tick.wav", "a failed render keeps the kit file");
    assert.match(result.warnings[0], /no usable take for tick.*boom.*kept the kit sound/);
    assert.equal(result.cues[2].file, "/kit/tally.wav");
    assert.equal(result.cues[2].offset, 0.4);
    assert.equal(result.rendered.length, 2);
    // Cached: a second run renders nothing.
    calls.length = 0;
    await applyEarshotSounds(cues, { project, bin: "/fake/earshot", storyId: "s", cacheDir: cache, render, level, timbre: async () => null });
    assert.equal(calls.filter((request) => request.id.includes("pop")).length, 0);

    const none = await applyEarshotSounds(cues, { project, bin: null });
    assert.deepEqual(none.cues, cues);
    assert.match(none.warnings[0], /needs the earshot tool/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("applyEarshotSounds: a fitted take is credited and a pitched one is tuned, retrying unpitched on failure", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-earshot-fit-"));
  try {
    const calls = [];
    const render = fakeRender(calls);
    const pickyRender = async (bin, request, out) => { if (request.pitch) throw new Error("no pitch"); return render(bin, request, out); };
    const clicks = Array.from({ length: 3 }, (_, i) => ({ cue: "click", at: i, volume: 0.3, source: "hit", file: null }));
    const result = await applyEarshotSounds([...clicks, { cue: "chime", at: 5, volume: 0.3, source: "hit", file: null }], { project, bin: "/fake/earshot", storyId: "x", key: "D", cacheDir: path.join(project, "c"), render: pickyRender, level: async () => -14, timbre: async () => null });
    assert.ok(result.credits.some((credit) => credit.id === "fit/click/floss_lid"));
    assert.ok(result.cues.some((cue) => cue.sfx_origin === "earshot-fit"));
    const chime = result.cues.at(-1);
    assert.equal(chime.sfx_source, "earshot");
    assert.ok(calls.some((request) => request.id === chime.earshot.id && request.pitch === null), "retried without the pitch");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("applyEarshotSounds: a take the timbre guard refuses gives way to the next member, else the cue keeps its file", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-earshot-timbre-"));
  try {
    const first = EARSHOT_FAMILIES.tick.ids;
    const hissy = new Set(first.slice(0, -1));
    const timbre = async (_family, file) => ([...hissy].some((id) => file.includes(earshotRenderKey({ id }))) ? "hiss: 98% of its energy is above 5 kHz" : null);
    const cues = [{ cue: "tick", at: 1, volume: 0.3, source: "hit", file: null }];
    const result = await applyEarshotSounds(cues, { project, bin: "/fake/earshot", storyId: "t", cacheDir: path.join(project, "c"), render: fakeRender(), level: async () => -14, timbre });
    assert.equal(result.cues[0].earshot.id, first.at(-1), "the member that passes");
    assert.ok(result.refused.length >= 1 && result.refused.every((item) => hissy.has(item.id) && /hiss/.test(item.problem)));
    const all = await applyEarshotSounds(cues, { project, bin: "/fake/earshot", storyId: "t", cacheDir: path.join(project, "c"), render: fakeRender(), level: async () => -14, timbre: async () => "hiss" });
    assert.equal(all.cues[0].sfx_source, undefined);
    assert.match(all.warnings[0], /no usable take/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

// The finish sound stage end to end with offline stand-ins (as test/event_sounds.test.js).
function adapters(extra = {}) {
  const touch = async (file, content = "x") => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, content); };
  const calls = { mixes: [] };
  return {
    calls,
    env: { PATH: "" },
    renderer: (name) => ({ name, async render(_p, out) { await touch(out, `video ${Math.random()}`); return { output: out }; } }),
    async synthKit(outDir, bed) {
      await touch(path.join(outDir, "AUDIO-KIT.json"), "{}");
      if (bed) await touch(path.join(outDir, "music", "bed.wav"));
      return {};
    },
    async buildMix(options) {
      calls.mixes.push(options);
      await touch(options.out, "mix");
      return { cues: options.cues };
    },
    async hasAudio() { return true; },
    async master(_input, output, target) { await touch(output, "m"); return { target: { integrated_lufs: target.lufs, true_peak_dbtp: target.tp }, output: { integrated_lufs: -14, true_peak_dbtp: -1.5 }, compliant: true }; },
    async buildEvidence(dir) { await touch(path.join(dir, PATHS.evidence), JSON.stringify({ schema_version: "launchclip.subscription-temporal-evidence.v1", entries: [] })); return { samples: 0, artifacts: 0, sheets: [] }; },
    async motion(_video, out) { await touch(out, "{}"); return { quality: { ok: true, findings: [] } }; },
    async audio() { return { quality: { ok: true, findings: [] } }; },
    ...extra
  };
}

async function minimalProject() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-earshot-finish-"));
  await cp(MINIMAL, dir, { recursive: true });
  await rm(path.join(dir, "assets/audio/mix.wav"), { force: true });
  await rm(path.join(dir, "NARRATION.json"), { force: true });
  const story = JSON.parse(await readFile(path.join(dir, "storyboard.json"), "utf8"));
  delete story.audio.mix;
  story.audio.narration = { text: "Builds took forty-eight minutes. Now twelve. Three changes did it. Watch again.", provider: "test" };
  await writeFile(path.join(dir, "storyboard.json"), `${JSON.stringify(story, null, 2)}\n`);
  return dir;
}

test("finish --sfx earshot: takes reach the mix and the manifests; without the tool the kit plays", { skip: hasFfmpeg ? false : "needs ffmpeg" }, async () => {
  const dir = await minimalProject();
  try {
    const fake = adapters({ earshotRender: fakeRender(), earshotLevel: async () => -14, earshotTimbre: async () => null, earshotCacheDir: path.join(dir, "es-cache") });
    fake.env = { PATH: "", LAUNCHCLIP_EARSHOT: process.execPath };
    const report = await runFinish(dir, { renderer: "remotion", music: "synth", sfx: "earshot" }, fake);
    const sound = report.stages.find((stage) => stage.name === "sound");
    assert.equal(sound.status, "done", sound.error);
    assert.equal(sound.details.sfx_mode, "earshot");
    const manifest = JSON.parse(await readFile(path.join(dir, PATHS.sfxManifest), "utf8"));
    assert.equal(manifest.mode, "earshot");
    const takes = manifest.cues.filter((entry) => entry.source === "earshot");
    assert.ok(takes.length >= 1, "at least one cue got an earshot take");
    assert.ok(takes.every((entry) => entry.earshot?.id && entry.file.includes("sfx-earshot")));
    assert.equal(manifest.earshot.rendered.length, takes.length);
    assert.equal(fake.calls.mixes.at(-1).cues.filter((entry) => entry.sfx_source === "earshot").length, takes.length);
    const audio = JSON.parse(await readFile(path.join(dir, PATHS.audioManifest), "utf8"));
    assert.match(audio.license, /Earshot sound bank/);

    const kitDir = await minimalProject();
    try {
      const kit = adapters({ earshotRender: async () => { throw new Error("must not be called"); } });
      const kitReport = await runFinish(kitDir, { renderer: "remotion", music: "synth", sfx: "earshot" }, kit);
      assert.equal(kitReport.stages.find((stage) => stage.name === "sound").details.sfx_mode, "kit");
      assert.ok(kitReport.warnings.some((line) => /needs the earshot tool/.test(line)));
    } finally {
      await rm(kitDir, { recursive: true, force: true });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
