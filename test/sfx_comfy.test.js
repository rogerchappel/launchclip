import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { comfySeed, seedLibrary } from "../src/sfx/seed.js";
import { sfxLicense } from "../src/finish.js";
import { familySource, readLibrary, resolveCueFile } from "../src/sfx/library.js";
import { fakeComfy } from "./helpers/fake_comfy.js";
import { createComfyClient } from "../src/comfy/client.js";

const prompts = {
  schema_version: "launchclip.sfx-prompts.v1",
  model_id: "eleven_text_to_sound_v2",
  output_format: "mp3_44100_128",
  families: {
    impact: { prompt: "single deep cinematic impact hit", duration_seconds: 1.5, prompt_influence: 0.6, variants: 2 },
    riser: { prompt: "short tonal synth riser", duration_seconds: 2, prompt_influence: 0.5, variants: 2 }
  }
};
const ALLOW = "stability-ai-community";

function fakeProcess() {
  const processFile = async (input, output) => {
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, await readFile(input));
    return { ok: true, file: output, measurements: { onset_ms: 1, duration_ms: 400, peak_db: -3 }, stats: {} };
  };
  return processFile;
}
const synthKit = async (outDir, families) => {
  await mkdir(path.join(outDir, "sfx"), { recursive: true });
  for (const family of families) await writeFile(path.join(outDir, "sfx", `${family}.wav`), "kit");
  return { families: Object.fromEntries(families.map((family) => [family, [`${family}.wav`]])) };
};
const temp = () => mkdtemp(path.join(os.tmpdir(), "launchclip-sfx-comfy-"));

test("--provider comfy makes four takes per family, keeps those the classifier puts in the family's row, and records the licence", async () => {
  const dir = await temp();
  try {
    // Take n's bytes say which type the stand-in classifier hears: impacts 0 and 2 land, 1 and 3 do not.
    const fake = fakeComfy({ output: (workflow, n) => Buffer.from(`take ${n} ${n % 2 ? "pop" : "impact"}`) });
    const classify = async (file) => (await readFile(file, "utf8")).split(" ").at(-1);
    const result = await seedLibrary({ dir, provider: "comfy", allowModelLicence: ALLOW, prompts, fetch: fake.fetch, processFile: fakeProcess(), classify, synthKit, env: {}, comfyClient: createComfyClient({ env: {}, fetch: fake.fetch, pollMs: 1 }) });
    assert.equal(result.generations, 8);
    assert.equal(result.kept.impact, 2);
    assert.deepEqual(result.rejected.impact, ["classified as pop, not impact", "classified as pop, not impact"]);
    // The riser has no classifier row, so every take is kept.
    assert.equal(result.kept.riser, 4);
    const queued = fake.calls.filter((call) => call.path === "/prompt").map((call) => call.body.prompt);
    assert.equal(queued[0]["3"].inputs.text, prompts.families.impact.prompt);
    assert.equal(queued[0]["6"].inputs.seconds, 1.5);
    assert.deepEqual(queued.slice(0, 4).map((workflow) => workflow["7"].inputs.seed), [0, 1, 2, 3].map((take) => comfySeed("impact", 0, take)));
    const { manifest } = await readLibrary(dir);
    assert.equal(manifest.families.impact.source, "comfy");
    assert.equal(manifest.families.impact.licence, ALLOW);
    assert.equal(manifest.families.impact.model_id, "Stable Audio Open 1.0");
    assert.equal(manifest.families.impact.variants[0].licence, ALLOW);
    const ledger = (await readFile(path.join(dir, "generation-log.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(ledger.length, 8);
    assert.ok(ledger.every((line) => line.licence === ALLOW && line.provider === "comfy"));
    // finish names the model and licence of every generated sound it used.
    const library = { scope: "user", dir, manifest };
    const cue = resolveCueFile({ cue: "impact", at: 1 }, { libraries: [library], key: "s" });
    assert.equal(cue.generated, "Stable Audio Open 1.0 (stability-ai-community)");
    assert.match(sfxLicense(new Set(["comfy"]), new Set([cue.generated])), /ComfyUI .*Stable Audio Open 1\.0 \(stability-ai-community\)/);
    // Seeding again with --force reuses every take from the cache: nothing is sent.
    const again = await seedLibrary({ dir, provider: "comfy", allowModelLicence: ALLOW, prompts, force: true, fetch: fakeComfy({ down: true }).fetch, processFile: fakeProcess(), classify, synthKit, env: {} });
    assert.equal(again.generations, 0);
    assert.equal(again.cached, 8);
    assert.equal(familySource("impact", [{ ...library, manifest: (await readLibrary(dir)).manifest }]).source, "comfy");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("with no ComfyUI running, every family falls back to the procedural kit with a warning", async () => {
  const dir = await temp();
  try {
    const fake = fakeComfy({ down: true });
    const result = await seedLibrary({ dir, provider: "comfy", allowModelLicence: ALLOW, prompts, fetch: fake.fetch, processFile: fakeProcess(), synthKit, env: {} });
    assert.equal(result.generations, 0);
    assert.equal(result.kept.impact, 1);
    assert.match(result.warnings[0], /impact: ComfyUI is not available \(.*not reachable.*\); using the procedural kit/);
    assert.equal(fake.calls.filter((call) => call.path === "/system_stats").length, 1, "a down server is asked once, not once per family");
    const { manifest } = await readLibrary(dir);
    assert.equal(manifest.families.riser.source, "procedural");
    assert.equal(manifest.families.riser.licence, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--provider comfy refuses a model licence the user has not allowed before sending anything", async () => {
  const dir = await temp();
  try {
    const fake = fakeComfy();
    await assert.rejects(seedLibrary({ dir, provider: "comfy", prompts, fetch: fake.fetch, processFile: fakeProcess(), synthKit, env: {} }), /--allow-model-licence stability-ai-community/);
    assert.equal(fake.calls.length, 0);
    await assert.rejects(seedLibrary({ dir, provider: "comfy", allowModelLicence: ALLOW, comfyUrl: "http://10.0.0.5:8188", prompts, fetch: fake.fetch, processFile: fakeProcess(), synthKit, env: {} }).then((result) => { throw new Error(result.warnings[0]); }), /not loopback/);
    assert.equal(fake.calls.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
