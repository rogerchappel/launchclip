import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { generateSoundEffect, loadPrompts, redact, requestHash, seedLibrary } from "../src/sfx/seed.js";

const KEY = "sk_test_DO_NOT_LEAK_0123456789abcdef";
const prompts = {
  schema_version: "launchclip.sfx-prompts.v1",
  model_id: "eleven_text_to_sound_v2",
  output_format: "mp3_44100_128",
  families: {
    whoosh: { prompt: "single soft cinematic whoosh", duration_seconds: 1, prompt_influence: 0.6, variants: 2 },
    keystroke: { prompt: "single mechanical keyboard key press", duration_seconds: 0.5, prompt_influence: 0.8, variants: 1, keep: 3, harvest: true }
  }
};

function fakeFetch({ status = 200, body = "error" } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (status !== 200) return { ok: false, status, text: async () => body, arrayBuffer: async () => new ArrayBuffer(0) };
    const audio = Buffer.alloc(4096, calls.length);
    return { ok: true, status, arrayBuffer: async () => audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.length) };
  };
  return { fetch, calls };
}

// Stand-in for FFmpeg processing: one kept file per take (three for harvest).
function fakeProcess() {
  const seen = [];
  const processFile = async (input, output, family, { harvest = 0 } = {}) => {
    seen.push({ input, family, harvest });
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `wav from ${path.basename(input)}`);
    const measurements = { onset_ms: 1, duration_ms: 90, peak_db: -3, peak_at_ms: 3, rms_db: -20, hits: 1 };
    const harvested = [];
    for (let i = 0; i < harvest; i++) {
      const file = i === 0 ? output : output.replace(/\.wav$/, `-h${i + 1}.wav`);
      if (i) await writeFile(file, `hit ${i + 1}`);
      harvested.push({ file, measurements, stats: {} });
    }
    return { ok: true, file: output, measurements, stats: { hits: 1 }, harvested };
  };
  return { processFile, seen };
}

async function temp() {
  return mkdtemp(path.join(os.tmpdir(), "launchclip-sfx-seed-"));
}

test("the checked-in prompt set covers every cue family with sane request values", async () => {
  const set = await loadPrompts();
  assert.deepEqual(Object.keys(set.families).sort(), ["click", "impact", "keystroke", "keystroke-enter", "keystroke-space", "pop", "riser", "shimmer", "subdrop", "tick", "whoosh"]);
  let generations = 0;
  for (const [family, spec] of Object.entries(set.families)) {
    assert.ok(spec.prompt.length > 20, family);
    assert.ok(spec.duration_seconds >= 0.5 && spec.duration_seconds <= 30, family);
    assert.ok(spec.prompt_influence >= 0 && spec.prompt_influence <= 1, family);
    generations += spec.variants;
  }
  assert.ok(generations <= 30, `a default seed stays small (${generations} generations)`);
  assert.match(set.families.keystroke.prompt, /one keystroke only/);
});

test("seeding calls POST /v1/sound-generation, caches by request hash and never repeats a cached request", async () => {
  const dir = await temp();
  try {
    const { fetch, calls } = fakeFetch();
    const { processFile, seen } = fakeProcess();
    const logs = [];
    const result = await seedLibrary({ dir, provider: "elevenlabs", prompts, fetch, processFile, env: { ELEVENLABS_API_KEY: KEY }, log: (line) => logs.push(line) });
    assert.equal(result.generations, 3);
    assert.equal(calls.length, 3);
    const [call] = calls;
    assert.equal(call.url, "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128");
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.headers["xi-api-key"], KEY);
    assert.deepEqual(call.body, { text: "single soft cinematic whoosh", model_id: "eleven_text_to_sound_v2", duration_seconds: 1, prompt_influence: 0.6 });
    assert.equal(seen.find((entry) => entry.family === "keystroke").harvest, 3, "harvest asks for up to `keep` hits");
    const manifest = JSON.parse(await readFile(path.join(dir, "library.json"), "utf8"));
    assert.equal(manifest.schema_version, "launchclip.sfx-library.v1");
    assert.equal(manifest.generations, 3);
    assert.equal(manifest.families.whoosh.source, "elevenlabs");
    assert.equal(manifest.families.whoosh.prompt, "single soft cinematic whoosh");
    assert.equal(manifest.families.whoosh.variants.length, 2);
    assert.equal(manifest.families.keystroke.variants.length, 3, "one generation harvested into three keystrokes");
    assert.deepEqual(manifest.families.keystroke.variants.map((variant) => variant.file), ["keystroke/keystroke-1.wav", "keystroke/keystroke-2.wav", "keystroke/keystroke-3.wav"]);
    const hash = requestHash({ modelId: "eleven_text_to_sound_v2", outputFormat: "mp3_44100_128", text: "single soft cinematic whoosh", durationSeconds: 1, promptInfluence: 0.6, take: 0, roll: 0 });
    assert.equal(manifest.families.whoosh.variants[0].hash, hash);
    assert.ok(existsSync(path.join(dir, "cache", `${hash}.mp3`)));

    // Re-processing everything (--force) reuses every cached download.
    const again = await seedLibrary({ dir, provider: "elevenlabs", prompts, fetch, processFile, env: { ELEVENLABS_API_KEY: KEY }, force: true });
    assert.equal(again.generations, 0);
    assert.equal(again.cached, 3);
    assert.equal(calls.length, 3, "no request is sent for a cached take");
    // Even without the key, a fully cached library re-processes offline.
    const offline = await seedLibrary({ dir, provider: "elevenlabs", prompts, fetch, processFile, env: {}, force: true });
    assert.equal(offline.generations, 0);
    // A reroll changes the hash, so it generates new takes for that family only.
    const rerolled = await seedLibrary({ dir, provider: "elevenlabs", prompts, fetch, processFile, env: { ELEVENLABS_API_KEY: KEY }, reroll: "whoosh" });
    assert.equal(rerolled.generations, 2);
    assert.deepEqual(rerolled.seeded, ["whoosh"]);
    const after = JSON.parse(await readFile(path.join(dir, "library.json"), "utf8"));
    assert.equal(after.families.whoosh.roll, 1);
    assert.equal(after.generations, 5);
    assert.notEqual(after.families.whoosh.variants[0].hash, hash);

    // The key is never written to disk or logged.
    for (const line of logs) assert.ok(!line.includes(KEY));
    const files = await readdir(dir, { recursive: true });
    for (const file of files.filter((name) => name.endsWith(".json"))) assert.ok(!(await readFile(path.join(dir, file), "utf8")).includes(KEY), file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("errors never contain the key, and nothing is sent without one", async () => {
  const dir = await temp();
  try {
    const echo = fakeFetch({ status: 401, body: `{"detail":"invalid api key ${KEY}"}` });
    const error = await seedLibrary({ dir, provider: "elevenlabs", prompts, fetch: echo.fetch, processFile: fakeProcess().processFile, env: { ELEVENLABS_API_KEY: KEY } }).catch((caught) => caught);
    assert.ok(error instanceof Error);
    assert.match(error.message, /\(401\)/);
    assert.ok(!error.message.includes(KEY), error.message);
    assert.match(error.message, /\[redacted\]/);

    const thrown = await generateSoundEffect({ text: "x", modelId: "m", apiKey: KEY, fetch: async () => { throw new Error(`socket closed for ${KEY}`); } }).catch((caught) => caught);
    assert.ok(!thrown.message.includes(KEY));

    const silent = fakeFetch();
    await assert.rejects(seedLibrary({ dir: path.join(dir, "fresh"), provider: "elevenlabs", prompts, fetch: silent.fetch, processFile: fakeProcess().processFile, env: {} }), /not cached and ELEVENLABS_API_KEY is not set\. Nothing was sent/);
    assert.equal(silent.calls.length, 0);
    await assert.rejects(generateSoundEffect({ text: "x", modelId: "m", fetch: silent.fetch }), /need ELEVENLABS_API_KEY/);
    assert.equal(redact(`a ${KEY} b`, KEY), "a [redacted] b");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("without a key the default provider is the procedural kit", async () => {
  const dir = await temp();
  try {
    await mkdir(path.join(dir, "cache/procedural/sfx"), { recursive: true });
    for (const name of ["whoosh.wav", "whoosh-2.wav", "keystroke.wav"]) await writeFile(path.join(dir, "cache/procedural/sfx", name), name);
    const synthKit = async () => ({ families: { whoosh: ["whoosh.wav", "whoosh-2.wav"], keystroke: ["keystroke.wav"] } });
    const { fetch, calls } = fakeFetch();
    const result = await seedLibrary({ dir, prompts, fetch, synthKit, processFile: fakeProcess().processFile, env: {} });
    assert.equal(result.provider, "synth");
    assert.equal(calls.length, 0);
    const manifest = JSON.parse(await readFile(path.join(dir, "library.json"), "utf8"));
    assert.equal(manifest.families.whoosh.source, "procedural");
    assert.equal(manifest.families.whoosh.variants[0].kit_file, "whoosh.wav");
    await assert.rejects(seedLibrary({ dir, provider: "freesound", prompts, env: {} }), /--provider must be elevenlabs or synth/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
