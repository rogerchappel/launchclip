import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { AMBIENCE_BEDS, GENRE_SPECS, HISTORIC_SFX_FAMILIES, MUSIC_GENRES, SFX_FAMILY_NAMES, SOUND_PALETTES, TONE_SOUND, ambienceForWorld, densityValue, normalizeKey, soundProblems } from "../kit/core/sound/options.mjs";
import { FAMILY_BUILDERS, familySpec } from "../kit/core/sound/families.mjs";
import { palette, paletteChain } from "../kit/core/sound/palettes.mjs";
import { ambienceSpec } from "../kit/core/sound/ambience.mjs";
import { genreBed, musicChoice } from "../kit/core/sound/music.mjs";
import { rng } from "../kit/core/sound/dsp.mjs";
import { SFX_VARIANTS, kitVariants, roleEnvelope } from "../skills/launchclip-create-video/scripts/synth-audio-kit.mjs";
import { mixGraph } from "../skills/launchclip-create-video/scripts/build-mix.mjs";
import { applyDensity, densityTyping } from "../src/sfx/library.js";
import { CUE_LEVELS, PATHS, bindCues, defaultCueFor, kitArgs, runFinish, soundSettings } from "../src/finish.js";
import { mediaSkip } from "./helpers/media.js";

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(import.meta.dirname, "..");
const MINIMAL = path.join(ROOT, "examples/story/minimal");

test("the option lists meet the RFC's targets and agree with each other", () => {
  assert.ok(SOUND_PALETTES.length >= 10);
  assert.ok(SFX_FAMILY_NAMES.length >= 25);
  assert.equal(new Set(SFX_FAMILY_NAMES).size, SFX_FAMILY_NAMES.length);
  assert.deepEqual(HISTORIC_SFX_FAMILIES, ["whoosh", "impact", "riser", "tick", "pop", "shimmer", "subdrop", "click", "keystroke", "keystroke-space", "keystroke-enter"]);
  for (const name of ["office", "cafe", "street-day", "street-night", "crickets", "rain", "waves", "wind", "server-room", "crowd"]) assert.ok(AMBIENCE_BEDS.includes(name), name);
  assert.deepEqual(MUSIC_GENRES, ["ambient", "lo-fi", "house", "synthwave", "acoustic-pluck", "cinematic-pulse", "chiptune", "jazz-hop", "orchestral-lite"]);
  for (const genre of MUSIC_GENRES) assert.ok(GENRE_SPECS[genre].progressions >= 3 && GENRE_SPECS[genre].bpm[0] < GENRE_SPECS[genre].bpm[1], genre);
  for (const { palettes, genres } of Object.values(TONE_SOUND)) {
    for (const id of palettes) assert.ok(SOUND_PALETTES.includes(id), id);
    for (const id of genres) assert.ok(MUSIC_GENRES.includes(id), id);
  }
  // Every family the finish stage can cue is a kit family and has a mix level.
  for (const family of SFX_FAMILY_NAMES) assert.ok(CUE_LEVELS[family] > 0, family);
});

test("world and time pick an ambience bed; values and densities are checked", () => {
  assert.equal(ambienceForWorld({ kind: "cafe", time: "day" }), "cafe");
  assert.equal(ambienceForWorld({ kind: "city-street", time: "day" }), "street-day");
  assert.equal(ambienceForWorld({ kind: "city street", time: "night" }), "street-night");
  assert.equal(ambienceForWorld({ kind: "park", time: "night" }), "crickets");
  assert.equal(ambienceForWorld({ kind: "server-room" }), "server-room");
  assert.equal(ambienceForWorld({ kind: "moon-base" }), null);
  assert.equal(ambienceForWorld(null), null);
  assert.equal(densityValue("low"), 0.25);
  assert.equal(densityValue(0.5), 0.5);
  assert.equal(densityValue(3), 1);
  assert.equal(densityValue("lots"), null);
  assert.equal(normalizeKey("Bb"), "A#");
  assert.equal(normalizeKey("f#m"), "F#");
  assert.deepEqual(soundProblems({ palette: "organic", music: { genre: "lo-fi", bpm: 84, key: "D", progression: 2 }, ambience: "auto", sfx_density: 0.5 }), []);
  assert.equal(soundProblems({ palette: "neon", music: { genre: "polka", progression: 9 }, ambience: "jungle", sfx_density: "loud" }).length, 5);
});

test("no palette: the historic kit's specs are exactly the historic variants", () => {
  assert.deepEqual(kitVariants(), SFX_VARIANTS);
  const withNew = kitVariants({ families: ["whoosh", "chime"] });
  assert.deepEqual(withNew.filter((entry) => entry.family === "whoosh"), SFX_VARIANTS.filter((entry) => entry.family === "whoosh"));
  assert.ok(withNew.some((entry) => entry.family === "chime" && entry.name === "chime"));
});

test("(family, palette, seed) gives a fresh but reproducible variant, and palettes differ", () => {
  for (const id of SOUND_PALETTES) {
    const variants = kitVariants({ palette: id, seed: "7f3a91c2" });
    assert.deepEqual([...new Set(variants.map((entry) => entry.family))], SFX_FAMILY_NAMES, id);
    // The same seed again is the same kit.
    assert.deepEqual(kitVariants({ palette: id, seed: "7f3a91c2" }), variants);
    // Names follow the kit's convention: <family>.wav, then <family>-<n>.wav.
    assert.ok(variants.some((entry) => entry.name === "whoosh-2"));
  }
  const spec = (id, seed, family = "whoosh") => JSON.stringify(familySpec(family, palette(id), rng(`${seed}|${id}|${family}|1`)));
  assert.notEqual(spec("organic", "a"), spec("organic", "b"), "a new seed is a new variant");
  for (const family of ["whoosh", "impact", "ding", "success"]) {
    const sounds = new Set(SOUND_PALETTES.map((id) => spec(id, "a", family)));
    assert.equal(sounds.size, SOUND_PALETTES.length, `${family}: every palette sounds different`);
  }
  // A palette sets the finishing chain: the 8-bit crush and the tape wobble.
  assert.match(paletteChain(palette("retro-8bit")), /acrusher/);
  assert.match(paletteChain(palette("lofi")), /vibrato/);
  assert.equal(Object.keys(FAMILY_BUILDERS).length, SFX_FAMILY_NAMES.length);
});

test("ambience beds and genre beds are deterministic plans", () => {
  for (const name of AMBIENCE_BEDS) {
    const bed = ambienceSpec(name, "s1");
    assert.deepEqual(ambienceSpec(name, "s1"), bed, name);
    assert.ok(bed.seconds >= 12 && bed.crossfade > 0 && bed.layers.length, name);
  }
  for (const genre of MUSIC_GENRES) {
    for (let progression = 0; progression < GENRE_SPECS[genre].progressions; progression++) {
      const bed = genreBed({ genre, bpm: 100, key: "D", progression }, "s1");
      assert.deepEqual(genreBed({ genre, bpm: 100, key: "D", progression }, "s1"), bed);
      // A cycle is a whole number of bars, so the loop keeps the grid exact.
      const bars = bed.cycle / (bed.beat * 4);
      assert.ok(Math.abs(bars - Math.round(bars)) < 1e-9, `${genre} ${progression}: ${bars} bars`);
      assert.ok(bed.stems.some((stem) => stem.role === "drums"), `${genre} has drums for the energy window`);
      for (const stem of bed.stems) assert.ok(stem.level < -14 && stem.level > -40, `${genre}/${stem.name} level ${stem.level}`);
    }
  }
  const choice = musicChoice({ genre: "lo-fi" }, "seed-x");
  assert.ok(choice.bpm >= GENRE_SPECS["lo-fi"].bpm[0] && choice.bpm <= GENRE_SPECS["lo-fi"].bpm[1]);
  assert.deepEqual(musicChoice({ genre: "lo-fi" }, "seed-x"), choice);
  assert.deepEqual(musicChoice({ genre: "house", bpm: 124, key: "Bb", progression: 6 }), { genre: "house", bpm: 124, key: "A#", progression: 2 });
  // Drums and leads play only in the energy window; bass is quieter outside it.
  assert.equal(roleEnvelope("drums", { seconds: 20, kickFrom: 20, kickTo: 20, beat: 0.5 }).includes("*0"), true);
  assert.match(roleEnvelope("bass", { seconds: 20, kickFrom: 4, kickTo: 12, beat: 0.5 }), /0\.35\+0\.65/);
});

test("density: the words keep their behaviour, numbers scale the hits placed", () => {
  const cues = Array.from({ length: 400 }, (_, i) => ({ cue: "tick", at: i / 10, optional: i % 2 === 0, shot: `s${i}` }));
  assert.equal(applyDensity(cues, "normal").length, 400);
  assert.equal(applyDensity(cues, "high").length, 400);
  assert.equal(applyDensity(cues, 0.6).length, 400);
  const low = applyDensity(cues, "low", "x");
  assert.deepEqual(applyDensity(cues, 0.25, "x"), low, "0.25 is low");
  assert.ok(low.every((cue) => cue.optional || true) && low.filter((cue) => !cue.optional).length === 200, "low keeps every hit");
  const counts = [0, 0.1, 0.25, 0.4, 0.6].map((value) => applyDensity(cues, value, "x").length);
  for (let i = 1; i < counts.length; i++) assert.ok(counts[i] > counts[i - 1], `more cues as density rises: ${counts}`);
  assert.deepEqual(densityTyping(0.9), densityTyping("high"));
  assert.deepEqual(densityTyping(0.1), densityTyping("low"));
  assert.throws(() => applyDensity(cues, "loud"), /sfx density/);
});

test("soundSettings reads the style's block, the story's override and the world", () => {
  const pack = { name: "seed-7f3a91c2", generated: { seed: "7f3a91c2" }, world: { kind: "cafe", time: "night" }, sound: { palette: "organic", music: { genre: "lo-fi", bpm: 84, key: "D", progression: 2 }, ambience: "auto", sfx_density: 0.5 } };
  const settings = soundSettings(pack, { audio: {} });
  assert.deepEqual({ ...settings, warnings: undefined }, { active: true, palette: "organic", seed: "7f3a91c2", genre: "lo-fi", key: "D", bpm: 84, progression: 2, ambience: "cafe", world: pack.world, density: 0.5, warnings: undefined });
  const overridden = soundSettings(pack, { audio: { sound: { palette: "retro-8bit", ambience: "none" } } });
  assert.equal(overridden.palette, "retro-8bit");
  assert.equal(overridden.genre, "lo-fi");
  assert.equal(overridden.ambience, null);
  // Older packs (density and hints only) leave finish exactly as it was.
  assert.equal(soundSettings({ sound: { sfx_density: "low", music: { prompt_hints: ["warm"] } } }, {}).active, false);
  assert.equal(soundSettings(null, {}).active, false);
  assert.match(soundSettings({ sound: { palette: "neon" } }, {}).warnings[0], /sound.palette "neon"/);
  assert.deepEqual(kitArgs({ palette: "organic", seed: "s", only: ["pop", "tick"], ambience: "rain" }), ["--palette", "organic", "--seed", "s", "--only", "pop,tick", "--ambience", "rain"]);
  assert.deepEqual(kitArgs(null), []);
});

test("palette event names reach the new families only with a sound block", () => {
  assert.equal(defaultCueFor("error"), "pop");
  assert.equal(defaultCueFor("error", { palette: true }), "error-buzz");
  assert.equal(defaultCueFor("payoff", { palette: true }), "subdrop");
  assert.equal(defaultCueFor("step-2", { palette: true }), "tick");
  const story = { format: { duration: 6 }, resolved: { duration: 6 }, scenes: [{ id: "a", start: 0, end: 6, hits: [{ at: 1, event: "sale" }, { at: 3, event: "x", cue: "chime" }] }] };
  const plain = bindCues(story, { models: () => null }).cues.map((cue) => cue.cue);
  const palette = bindCues(story, { models: () => null, palette: true }).cues.map((cue) => cue.cue);
  assert.deepEqual(plain, ["pop", "chime"]);
  assert.deepEqual(palette, ["cash", "chime"]);
});

test("the mix graph is unchanged without ambience and ducks the loop with it", () => {
  const before = "[0]asplit=2[vo][key];[1]volume=0.3[bedraw];[key]apad=whole_dur=10[keypad];[bedraw][keypad]sidechaincompress=threshold=0.03:ratio=6:attack=15:release=320:makeup=1[bed];[vo][bed]amix=inputs=2:normalize=0,apad=whole_dur=10,atrim=0:10,afade=t=out:st=9.75:d=0.25,alimiter=limit=0.89:level=0[out]";
  assert.equal(mixGraph({ cues: [], duration: 10, hasVoice: true, hasMusic: true, musicVolume: 0.3 }), before);
  const graph = mixGraph({ cues: [], duration: 10, hasVoice: true, hasMusic: true, hasAmbience: true, ambienceVolume: 0.5 });
  assert.match(graph, /asplit=3\[vo\]\[key\]\[akey\]/);
  assert.match(graph, /\[2\]atrim=0:10,asetpts=PTS-STARTPTS,afade=t=in:d=1,volume=0.5\[ambraw\]/);
  assert.match(graph, /\[ambraw\]\[akeypad\]sidechaincompress/);
  const noVoice = mixGraph({ cues: [], duration: 10, hasVoice: false, hasMusic: false, hasAmbience: true });
  assert.match(noVoice, /^\[0\]atrim=0:10/);
});

// The finish stage end to end with offline stand-ins (as test/finish.test.js).
async function project({ sound, world } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-sound-"));
  await cp(MINIMAL, dir, { recursive: true });
  await rm(path.join(dir, "assets/audio/mix.wav"), { force: true });
  await rm(path.join(dir, "NARRATION.json"), { force: true });
  const story = JSON.parse(await readFile(path.join(dir, "storyboard.json"), "utf8"));
  delete story.audio.mix;
  story.audio.narration = { text: "Builds took forty-eight minutes. Now twelve. Three changes did it. Watch again.", provider: "test" };
  if (sound) story.audio.sound = sound;
  if (world) story.world = world;
  await writeFile(path.join(dir, "storyboard.json"), `${JSON.stringify(story, null, 2)}\n`);
  return dir;
}

function adapters() {
  const touch = async (file, content = "x") => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, content); };
  const calls = { kits: [], mixes: [] };
  return {
    calls,
    env: {},
    notice() {},
    renderer: (name) => ({ name, async render(_p, out) { await touch(out, `video ${Math.random()}`); return { output: out }; } }),
    async synthKit(outDir, bed, kit) {
      calls.kits.push({ bed, kit });
      await touch(path.join(outDir, "AUDIO-KIT.json"), "{}");
      if (bed) await touch(path.join(outDir, "music", "bed.wav"));
      if (kit?.ambience) await touch(path.join(outDir, "ambience", `${kit.ambience}.wav`));
      return {};
    },
    async buildMix(options) {
      calls.mixes.push(options);
      await touch(options.out, "mix");
      return { cues: options.cues.map((cue) => ({ ...cue, file: path.join(options.sfxDir, `${cue.cue}.wav`) })) };
    },
    async hasAudio() { return true; },
    async master(_input, output, target) { await touch(output, "m"); return { target: { integrated_lufs: target.lufs, true_peak_dbtp: target.tp }, output: { integrated_lufs: -14, true_peak_dbtp: -1.5 }, compliant: true }; },
    async buildEvidence(dir) { await touch(path.join(dir, PATHS.evidence), JSON.stringify({ schema_version: "launchclip.subscription-temporal-evidence.v1", entries: [] })); return { samples: 0, artifacts: 0, sheets: [] }; },
    async motion(_video, out) { await touch(out, "{}"); return { quality: { ok: true, findings: [] } }; },
    async audio() { return { quality: { ok: true, findings: [] } }; }
  };
}

test("finish with no sound block calls the kit and the mix as it always has", async () => {
  const dir = await project();
  try {
    const fake = adapters();
    await runFinish(dir, { renderer: "remotion" }, fake);
    assert.equal(fake.calls.kits.length, 1);
    assert.equal(fake.calls.kits[0].kit, null);
    assert.equal(fake.calls.kits[0].bed.genre, undefined);
    assert.equal(fake.calls.mixes[0].ambience, null);
    assert.equal("ambienceVolume" in fake.calls.mixes[0], false);
    const manifest = JSON.parse(await readFile(path.join(dir, PATHS.audioManifest), "utf8"));
    assert.equal("ambience" in manifest, false);
    assert.equal("sound" in manifest, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("finish reads the sound block: palette kit, genre bed, ambience from the world", async () => {
  const dir = await project({ sound: { palette: "organic", seed: "7f3a91c2", music: { genre: "lo-fi", key: "D", progression: 2 }, ambience: "auto", sfx_density: 0.5 }, world: { kind: "cafe", time: "day" } });
  try {
    const fake = adapters();
    const report = await runFinish(dir, { renderer: "remotion" }, fake);
    const { bed, kit } = fake.calls.kits[0];
    assert.equal(kit.palette, "organic");
    assert.equal(kit.seed, "7f3a91c2");
    assert.equal(kit.ambience, "cafe");
    assert.ok(kit.only.length >= 1 && kit.only.every((family) => SFX_FAMILY_NAMES.includes(family)));
    assert.equal(bed.genre, "lo-fi");
    assert.equal(bed.key, "D");
    assert.equal(bed.progression, 2);
    assert.ok(bed.bpm >= GENRE_SPECS["lo-fi"].bpm[0] && bed.bpm <= GENRE_SPECS["lo-fi"].bpm[1], `bpm ${bed.bpm} in the genre's range`);
    assert.match(fake.calls.mixes[0].ambience, /ambience\/cafe\.wav$/);
    assert.equal(fake.calls.mixes[0].ambienceVolume, 0.5);
    const manifest = JSON.parse(await readFile(path.join(dir, PATHS.audioManifest), "utf8"));
    assert.equal(manifest.ambience.bed, "cafe");
    assert.deepEqual(manifest.sound, { palette: "organic", seed: "7f3a91c2", genre: "lo-fi", ambience: "cafe" });
    assert.equal(manifest.music.genre, "lo-fi");
    const sfx = JSON.parse(await readFile(path.join(dir, PATHS.sfxManifest), "utf8"));
    assert.equal(sfx.density, "0.5");
    assert.equal(report.stages.find((stage) => stage.name === "sound").status, "done");
    // Run again: nothing changed, so the sound stage and the kit are reused.
    await runFinish(dir, { renderer: "remotion" }, fake);
    assert.equal(fake.calls.kits.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rendered: a palette slice, a genre bed and an ambience loop pass the listen checks", { skip: mediaSkip(), timeout: 600_000 }, async () => {
  const { analyseFile, decodePcm, effectProblems } = await import("../scripts/sound-analysis.mjs");
  const { synthAmbience, synthGenreBed } = await import("../skills/launchclip-create-video/scripts/synth-audio-kit.mjs");
  const { analyzeBeatsFile } = await import("../src/music/beats.js");
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-sound-media-"));
  try {
    const kit = path.join(ROOT, "skills/launchclip-create-video/scripts/synth-audio-kit.mjs");
    await execFileAsync(process.execPath, [kit, path.join(dir, "kit"), "--palette", "retro-8bit", "--seed", "t1", "--only", "whoosh,ding,glitch,keystroke,success"], { maxBuffer: 1 << 26 });
    const manifest = JSON.parse(await readFile(path.join(dir, "kit/AUDIO-KIT.json"), "utf8"));
    assert.equal(manifest.palette, "retro-8bit");
    for (const cue of manifest.sfx) {
      const stats = await analyseFile(cue.file);
      assert.deepEqual(effectProblems(stats, { family: cue.family }), [], `${cue.name}: ${JSON.stringify(stats)}`);
    }
    const bed = await synthGenreBed(path.join(dir, "bed"), { seconds: 14, genre: "lo-fi", bpm: 84, key: "D", progression: 1, kickFrom: 3, kickTo: 12, seed: "t1" });
    const grid = await analyzeBeatsFile(bed.file, { bpmHint: 84 });
    assert.ok(Math.abs(grid.bpm - 84) <= 1, `analysed ${grid.bpm} BPM`);
    const eighth = bed.beat_seconds / 2;
    for (const t of grid.beats.filter((time) => time > 3.5 && time < 11.5)) assert.ok(Math.min(t % eighth, eighth - (t % eighth)) < 0.025, `beat at ${t} is off the grid`);
    assert.equal((await analyseFile(bed.file)).clipped, 0);
    const loop = await synthAmbience("rain", path.join(dir, "ambience"), { seed: "t1" });
    const { left } = await decodePcm(loop.file);
    let typical = 0;
    for (let i = 1; i < left.length; i++) typical += Math.abs(left[i] - left[i - 1]);
    typical /= left.length - 1;
    assert.ok(Math.abs(left[0] - left.at(-1)) < typical * 4 + 0.002, "the loop has no step at its seam");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
