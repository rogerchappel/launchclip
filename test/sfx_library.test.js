import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveCueFiles, typingBanks } from "../src/finish.js";
import { LIBRARY_SCHEMA, applyDensity, emptyManifest, expandFamilies, familySource, kitLibrary, pickVariant, readLibrary, resolveCueFile, resolveLibraries, writeLibrary } from "../src/sfx/library.js";
import { seedLibrary } from "../src/sfx/seed.js";

async function library(dir, families) {
  const manifest = emptyManifest("2026-10-22T00:00:00.000Z");
  for (const [family, { source = "elevenlabs", count = 2, peakAt = 900 }] of Object.entries(families)) {
    manifest.families[family] = { source, roll: 0, variants: Array.from({ length: count }, (_, i) => ({ file: `${family}/${family}-${i + 1}.wav`, source, hash: `${family}${i}`, measurements: { onset_ms: 1, duration_ms: 100, peak_db: -3, peak_at_ms: peakAt } })), rejected: [] };
  }
  await writeLibrary(dir, manifest);
  return manifest;
}

async function temp() {
  return mkdtemp(path.join(os.tmpdir(), "launchclip-sfx-lib-"));
}

test("the manifest round-trips and malformed manifests are refused", async () => {
  const dir = await temp();
  try {
    assert.equal(await readLibrary(dir), null);
    await library(dir, { whoosh: {} });
    const loaded = await readLibrary(dir);
    assert.equal(loaded.manifest.schema_version, LIBRARY_SCHEMA);
    assert.equal(loaded.manifest.families.whoosh.variants.length, 2);
    await writeFile(path.join(dir, "library.json"), JSON.stringify({ schema_version: "other" }));
    await assert.rejects(readLibrary(dir), /not a launchclip\.sfx-library\.v1/);
    assert.deepEqual(expandFamilies("whoosh, typing"), ["whoosh", "keystroke", "keystroke-space", "keystroke-enter"]);
    assert.equal(expandFamilies(undefined), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolution prefers explicit, then project, then user library, then the kit", async () => {
  const root = await temp();
  try {
    const project = path.join(root, "project");
    const home = path.join(root, "home");
    const style = path.join(root, "style-lib");
    await library(path.join(project, ".launchclip/sfx"), { whoosh: { count: 2 } });
    await library(path.join(home, ".launchclip/sfx"), { whoosh: { count: 3 }, impact: { source: "procedural", count: 1 } });
    await library(style, { pop: { count: 1 } });
    const env = {};
    const libraries = await resolveLibraries({ project, home, env, library: style });
    assert.deepEqual(libraries.map((entry) => entry.scope), ["explicit", "project", "user"]);
    const kit = kitLibrary(path.join(root, "kit/sfx"), { families: { tick: ["tick.wav", "tick-2.wav"] } });
    assert.equal(familySource("pop", libraries, kit).scope, "explicit");
    assert.equal(familySource("whoosh", libraries, kit).scope, "project", "the project library wins over the user library");
    assert.equal(familySource("whoosh", libraries, kit).files.length, 2);
    assert.equal(familySource("impact", libraries, kit).scope, "user", "families missing from the project fall through");
    const tick = familySource("tick", libraries, kit);
    assert.equal(tick.scope, "kit");
    assert.deepEqual(tick.files.map((file) => path.basename(file)), ["tick.wav", "tick-2.wav"]);
    assert.deepEqual(familySource("shimmer", libraries, kitLibrary(path.join(root, "kit/sfx"), {})).files.map((file) => path.basename(file)), ["shimmer.wav"], "an old kit manifest falls back to <family>.wav");
    // LAUNCHCLIP_SFX_HOME overrides the user library location.
    const overridden = await resolveLibraries({ project, home, env: { LAUNCHCLIP_SFX_HOME: path.join(root, "nowhere") } });
    assert.deepEqual(overridden.map((entry) => entry.scope), ["project"]);
    await assert.rejects(resolveLibraries({ project, home, env, library: path.join(root, "missing") }), /SFX library not found/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("variants are picked deterministically per event and vary across events", async () => {
  const root = await temp();
  try {
    await library(root, { whoosh: { count: 3 }, riser: { count: 1, peakAt: 1200 } });
    const libraries = [{ scope: "project", ...(await readLibrary(root)) }];
    const cues = Array.from({ length: 12 }, (_, i) => ({ cue: "whoosh", at: i, shot: `s${i}`, source: "hit", event: `e${i}` }));
    const first = resolveCueFiles(cues, { libraries, storyId: "story-a" });
    const again = resolveCueFiles(cues, { libraries, storyId: "story-a" });
    assert.deepEqual(first.map((cue) => cue.file), again.map((cue) => cue.file), "the same story renders the same variants");
    assert.ok(new Set(first.map((cue) => cue.variant)).size >= 2, "repeated cues use different variants");
    const other = resolveCueFiles(cues, { libraries, storyId: "story-b" });
    assert.notDeepEqual(first.map((cue) => cue.variant), other.map((cue) => cue.variant), "another story picks differently");
    assert.equal(first[0].sfx_source, "project");
    assert.equal(pickVariant(0, "x"), -1);
    assert.equal(pickVariant(1, "x"), 0);
    // A library riser lands its measured peak on its moment.
    const [riser] = resolveCueFiles([{ cue: "riser", at: 2.8, lands_at: 4.2, shot: "s1", source: "module-event", event: "count" }], { libraries });
    assert.equal(riser.at, 3);
    assert.equal(resolveCueFile({ cue: "kazoo", at: 1 }, { libraries }), null);
    const banks = typingBanks(libraries, kitLibrary(path.join(root, "kit"), {}));
    assert.equal(banks.key[0].scope, "kit");
    assert.equal(path.basename(banks.space[0].file), "keystroke-space.wav");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("density thins optional cues deterministically and keeps hits", () => {
  const cues = Array.from({ length: 40 }, (_, i) => ({ cue: "tick", at: i / 4, shot: "s1", source: i % 2 ? "module-event" : "hit", event: `e${i}`, optional: i % 2 === 1 }));
  assert.equal(applyDensity(cues, "normal").length, 40);
  assert.equal(applyDensity(cues, "high").length, 40);
  const low = applyDensity(cues, "low", "story");
  assert.deepEqual(low, applyDensity(cues, "low", "story"));
  assert.equal(low.filter((cue) => !cue.optional).length, 20, "every hit survives");
  const optional = low.filter((cue) => cue.optional).length;
  assert.ok(optional > 3 && optional < 17, `about half the optional cues survive (${optional})`);
  assert.throws(() => applyDensity(cues, "extreme"), /density must be one of/);
});

test("reroll replaces only that family; other families stay locked", async () => {
  const dir = await temp();
  try {
    const synthKit = async (outDir) => {
      await mkdir(path.join(outDir, "sfx"), { recursive: true });
      return { families: { whoosh: ["whoosh.wav", "whoosh-2.wav"], tick: ["tick.wav"] } };
    };
    let counter = 0;
    const processFile = async (input, output) => {
      await mkdir(path.dirname(output), { recursive: true });
      await writeFile(output, `processed ${path.basename(input)} ${counter++}`);
      return { ok: true, file: output, measurements: { onset_ms: 1, duration_ms: 50, peak_db: -3 }, stats: {} };
    };
    const prompts = { schema_version: "launchclip.sfx-prompts.v1", model_id: "m", families: { whoosh: { prompt: "w", variants: 2 }, tick: { prompt: "t", variants: 1 } } };
    // The synth stub writes no kit files; hash them from placeholders.
    await mkdir(path.join(dir, "cache/procedural/sfx"), { recursive: true });
    for (const name of ["whoosh.wav", "whoosh-2.wav", "tick.wav"]) await writeFile(path.join(dir, "cache/procedural/sfx", name), name);
    const first = await seedLibrary({ dir, provider: "synth", prompts, synthKit, processFile, env: {} });
    assert.deepEqual(first.seeded, ["whoosh", "tick"]);
    const before = JSON.parse(await readFile(path.join(dir, "library.json"), "utf8"));
    const second = await seedLibrary({ dir, provider: "synth", prompts, synthKit, processFile, env: {} });
    assert.deepEqual(second.seeded, [], "a seeded library is locked");
    assert.deepEqual(second.locked, ["whoosh", "tick"]);
    const rerolled = await seedLibrary({ dir, provider: "synth", prompts, synthKit, processFile, env: {}, reroll: "tick" });
    assert.deepEqual(rerolled.seeded, ["tick"]);
    const after = JSON.parse(await readFile(path.join(dir, "library.json"), "utf8"));
    assert.deepEqual(after.families.whoosh, before.families.whoosh, "whoosh is untouched by a tick reroll");
    assert.equal(after.families.tick.roll, 1);
    assert.equal(await readFile(path.join(dir, "tick/tick-1.wav"), "utf8"), "processed tick.wav 3");
    await assert.rejects(seedLibrary({ dir, provider: "synth", prompts, synthKit, processFile, env: {}, reroll: "kazoo" }), /Unknown SFX family "kazoo"/);
    // A reroll whose clips are all rejected fails and keeps the current files.
    const reject = async () => ({ ok: false, reason: "silent" });
    await assert.rejects(seedLibrary({ dir, provider: "synth", prompts, synthKit, processFile: reject, env: {}, reroll: "tick" }), /no usable clip/);
    assert.equal(await readFile(path.join(dir, "tick/tick-1.wav"), "utf8"), "processed tick.wav 3");
    assert.equal(JSON.parse(await readFile(path.join(dir, "library.json"), "utf8")).families.tick.roll, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
