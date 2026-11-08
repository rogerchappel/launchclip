// SFX families missing from the library (blind test 2: the user library had
// no whoosh, tick or subdrop, so they fell back to the kit, unannounced).
// `sfx list` names them, `finish` prints one line when it falls back, and
// `sfx seed --missing` fills only those (here offline, with the synth kit).
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { emptyManifest, libraryFallbacks, missingFamilies, readLibrary, writeLibrary } from "../src/sfx/library.js";
import { listLibraries, loadPrompts, refusedFamilies, seedLibrary } from "../src/sfx/seed.js";
import { measureTimbre, timbreProblem } from "../src/sfx/timbre.js";

async function library(dir, families, { withFiles = true } = {}) {
  const manifest = emptyManifest("2026-10-22T00:00:00.000Z");
  for (const family of families) {
    manifest.families[family] = { source: "elevenlabs", roll: 0, variants: [{ file: `${family}/${family}-1.wav`, source: "elevenlabs", hash: family }], rejected: [] };
    if (withFiles) { await mkdir(path.join(dir, family), { recursive: true }); await writeFile(path.join(dir, family, `${family}-1.wav`), "wav"); }
  }
  await writeLibrary(dir, manifest);
}

test("missing families: absent, or every variant file gone", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lc-sfx-missing-"));
  try {
    await library(dir, ["impact", "riser"]);
    await library(path.join(dir, "ghost"), ["tick"], { withFiles: false });
    const loaded = await readLibrary(dir);
    assert.deepEqual(missingFamilies(loaded, ["whoosh", "impact", "riser", "tick"]), ["whoosh", "tick"]);
    assert.deepEqual(missingFamilies(await readLibrary(path.join(dir, "ghost")), ["tick"]), ["tick"], "a variant whose file is gone does not count");
    assert.deepEqual(libraryFallbacks(["whoosh", "impact", "tick", "whoosh"], [loaded]), ["tick", "whoosh"]);
    assert.deepEqual(libraryFallbacks(["whoosh"], []), [], "no library, nothing to fall back from");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sfx list reports the families missing compared with the prompt set", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lc-sfx-list-"));
  try {
    const known = Object.keys((await loadPrompts()).families);
    const user = path.join(root, "user");
    await library(user, known.filter((family) => !["whoosh", "tick", "subdrop"].includes(family)));
    const report = await listLibraries({ project: path.join(root, "project"), env: { LAUNCHCLIP_SFX_HOME: user } });
    assert.deepEqual(report.missing, ["whoosh", "tick", "subdrop"].sort((a, b) => known.indexOf(a) - known.indexOf(b)));
    assert.deepEqual(report.libraries[0].missing, report.missing);
    assert.match(report.next_step, /launchclip sfx seed --missing/);
    assert.equal(report.families.whoosh.resolves_to, "kit");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sfx seed --missing fills only the missing families and never calls the API without a key", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lc-sfx-seed-missing-"));
  try {
    const prompts = { schema_version: "launchclip.sfx-prompts.v1", model_id: "m", output_format: "mp3_44100_128", families: {
      whoosh: { prompt: "w", duration_seconds: 1, prompt_influence: 0.6, variants: 2 },
      impact: { prompt: "i", duration_seconds: 1, prompt_influence: 0.6, variants: 2 },
      tick: { prompt: "t", duration_seconds: 0.5, prompt_influence: 0.6, variants: 2 }
    } };
    await library(dir, ["impact"]);
    const before = await readFile(path.join(dir, "impact/impact-1.wav"), "utf8");
    await mkdir(path.join(dir, "cache/procedural/sfx"), { recursive: true });
    for (const name of ["whoosh.wav", "tick.wav", "impact.wav"]) await writeFile(path.join(dir, "cache/procedural/sfx", name), name);
    const synthKit = async () => ({ families: { whoosh: ["whoosh.wav"], tick: ["tick.wav"], impact: ["impact.wav"] } });
    const processFile = async (input, output) => { await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, `processed ${path.basename(input)}`); return { ok: true, file: output, measurements: {}, stats: {} }; };
    const fetch = async () => { throw new Error("no network call may be made"); };
    const result = await seedLibrary({ dir, prompts, missing: true, synthKit, processFile, fetch, env: {} });
    assert.equal(result.provider, "synth");
    assert.deepEqual(result.missing, ["whoosh", "tick"]);
    assert.deepEqual(result.seeded, ["whoosh", "tick"]);
    assert.deepEqual(result.locked, ["impact"]);
    assert.equal(await readFile(path.join(dir, "impact/impact-1.wav"), "utf8"), before, "the existing family is untouched");
    const manifest = JSON.parse(await readFile(path.join(dir, "library.json"), "utf8"));
    assert.equal(manifest.families.whoosh.source, "procedural");
    // Nothing missing now: a second run seeds nothing.
    assert.deepEqual((await seedLibrary({ dir, prompts, missing: true, synthKit, processFile, fetch, env: {} })).seeded, []);
    await assert.rejects(seedLibrary({ dir, prompts, missing: true, only: "whoosh", env: {} }), /--missing fills only the missing families/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// A clip seeded before the timbre guard (a 30 ms air burst sold as a "tick")
// is refused on every render and replaced by the kit; --missing replaces it
// in the library, so the warning stops.
test("sfx seed --missing replaces a family whose every variant fails the timbre guard", async () => {
  const rate = 48000;
  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 * 2 - 1; };
  // A first difference of white noise is almost all top end: an air burst.
  const burst = Float64Array.from({ length: Math.round(rate * 0.03) }, () => random());
  for (let i = burst.length - 1; i > 0; i--) burst[i] -= burst[i - 1];
  const hiss = measureTimbre([burst], rate);
  assert.match(timbreProblem("tick", hiss), /^hiss: \d+% of its energy is above 5 kHz/);
  // A tonal tick (the kit's: 2.2 kHz and 3.3 kHz partials, fast decay) passes.
  const tonal = Float64Array.from({ length: Math.round(rate * 0.12) }, (_, i) => { const t = i / rate; return Math.sin(2 * Math.PI * 2200 * t) * Math.exp(-t / 0.018) + 0.4 * Math.sin(2 * Math.PI * 3300 * t) * Math.exp(-t / 0.012); });
  assert.equal(timbreProblem("tick", measureTimbre([tonal], rate)), null);

  const dir = await mkdtemp(path.join(os.tmpdir(), "lc-sfx-refused-"));
  try {
    const prompts = { schema_version: "launchclip.sfx-prompts.v1", model_id: "m", output_format: "mp3_44100_128", families: {
      impact: { prompt: "i", duration_seconds: 1, prompt_influence: 0.6, variants: 1 },
      tick: { prompt: "t", duration_seconds: 0.5, prompt_influence: 0.6, variants: 1 }
    } };
    await library(dir, ["impact", "tick"]);
    const measure = async (file) => (/tick-1\.wav$/.test(file) && !(await readFile(file, "utf8")).startsWith("processed") ? hiss : null);
    assert.deepEqual(await refusedFamilies(await readLibrary(dir), ["impact", "tick"], { measure }), ["tick"]);
    await mkdir(path.join(dir, "cache/procedural/sfx"), { recursive: true });
    await writeFile(path.join(dir, "cache/procedural/sfx/tick.wav"), "tick.wav");
    const synthKit = async () => ({ families: { tick: ["tick.wav"], impact: ["impact.wav"] } });
    const processFile = async (input, output) => { await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, `processed ${path.basename(input)}`); return { ok: true, file: output, measurements: {}, stats: {} }; };
    const result = await seedLibrary({ dir, prompts, missing: true, synthKit, processFile, measureTimbre: measure, fetch: async () => { throw new Error("no network"); }, env: {} });
    assert.deepEqual(result.seeded, ["tick"]);
    assert.deepEqual(result.locked, ["impact"]);
    assert.equal(await readFile(path.join(dir, "tick/tick-1.wav"), "utf8"), "processed tick.wav");
    assert.deepEqual(await refusedFamilies(await readLibrary(dir), ["impact", "tick"], { measure }), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
