// The work the machine queue wraps (src/queue.js): local models take a
// local-model slot, renders a render slot.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { OllamaStructuredClient } from "../src/model_provider.js";
import { acquireSlot } from "../src/queue.js";
import { openSegmenter } from "../src/subject/stage.js";
import { create as createKokoro } from "../src/voice/kokoro.js";

const queue = await mkdtemp(path.join(os.tmpdir(), "launchclip-queue-slots-"));
Object.assign(process.env, { LAUNCHCLIP_QUEUE: "on", LAUNCHCLIP_QUEUE_DIR: queue, LAUNCHCLIP_SLOTS: "local-model:1", LAUNCHCLIP_QUEUE_POLL_MS: "20" });
test.after(() => rm(queue, { recursive: true, force: true }));

// Starts work while another job holds the only local-model slot: it waits
// (and says so) until the holder lets go.
async function waitsForLocalModel(start) {
  const holder = await acquireSlot("local-model", { label: "acme/other", log: () => {} });
  const lines = [];
  let done = false;
  const work = start((line) => lines.push(line)).then((value) => { done = true; return value; });
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(done, false, "waits while the slot is held");
  await holder.release();
  const value = await work;
  return { value, lines };
}

test("a local Ollama call waits for a local-model slot; a remote one does not", async () => {
  const reply = () => new Response(JSON.stringify({ model: "qwen", message: { role: "assistant", content: "{\"ok\":true}" }, done: true }), { status: 200 });
  const local = new OllamaStructuredClient({ provider: "ollama", model: "qwen", fetch: async () => reply() });
  const request = { instructions: "x", input: "y", schema: { type: "object" }, schemaName: "s" };
  const { value } = await waitsForLocalModel(() => local.runStructured(request));
  assert.deepEqual(value.value, { ok: true });

  const holder = await acquireSlot("local-model", { log: () => {} });
  try {
    const remote = new OllamaStructuredClient({ provider: "ollama", model: "qwen", baseUrl: "http://gpu-box.lan:11434", fetch: async () => reply() });
    assert.deepEqual((await remote.runStructured(request)).value, { ok: true });
  } finally {
    await holder.release();
  }
});

test("Kokoro synthesis waits for a local-model slot", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-kokoro-slot-"));
  try {
    const engine = { sampleRate: 24000, async *stream() { yield { text: "", samples: new Float32Array(2400), phonemes: "", durations: null }; } };
    const kokoro = createKokoro({ engine, log: () => {} });
    const { value } = await waitsForLocalModel(() => kokoro.synthesize({ text: "...", outFile: path.join(dir, "take.wav") }));
    assert.equal(value.provider, "kokoro");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a subject segmenter holds a local-model slot from load to release", async () => {
  let released = false;
  const create = async () => ({ async segment() {}, async release() { released = true; } });
  const { value: segmenter } = await waitsForLocalModel(() => openSegmenter("model", {}, create));
  // While it is open, the slot is taken.
  const other = acquireSlot("local-model", { log: () => {} });
  let got = false;
  other.then(() => { got = true; });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(got, false);
  await segmenter.release();
  assert.equal(released, true);
  await (await other).release();

  // A model that fails to load gives its slot back.
  await assert.rejects(openSegmenter("model", {}, async () => { throw new Error("no runtime"); }), /no runtime/);
  await (await acquireSlot("local-model", { log: () => {} })).release();
});
