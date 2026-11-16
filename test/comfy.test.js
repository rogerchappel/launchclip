import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { comfyUrl, createComfyClient, historyFiles } from "../src/comfy/client.js";
import { generateWithComfy } from "../src/comfy/generate.js";
import { MODEL_LICENCES, assertLicence, bindTemplate, listTemplates, loadTemplate, templateNeeds, workflowKey } from "../src/comfy/templates.js";
import { FAKE_OBJECT_INFO, fakeComfy } from "./helpers/fake_comfy.js";

// Node classes that ship with ComfyUI itself (nodes.py and comfy_extras); templates use no others.
const CORE_NODES = new Set(["CheckpointLoaderSimple", "CLIPLoader", "CLIPTextEncode", "ConditioningStableAudio", "EmptyLatentAudio", "KSampler", "VAEDecodeAudio", "SaveAudio", "EmptyLatentImage", "EmptySD3LatentImage", "VAEDecode", "VAEEncode", "SaveImage", "LoadImage", "UNETLoader", "VAELoader", "ModelSamplingSD3", "Wan22ImageToVideoLatent", "CreateVideo", "SaveVideo", "UpscaleModelLoader", "ImageUpscaleWithModel", "ImageScaleBy"]);

const temp = () => mkdtemp(path.join(os.tmpdir(), "launchclip-comfy-"));

test("only loopback hosts are allowed unless the user names a remote one for the run", () => {
  assert.equal(comfyUrl(undefined, { env: {} }), "http://127.0.0.1:8188");
  assert.equal(comfyUrl("http://localhost:8000", { env: {} }), "http://localhost:8000");
  assert.equal(comfyUrl("http://[::1]:8188", { env: {} }), "http://[::1]:8188");
  assert.equal(comfyUrl(undefined, { env: { LAUNCHCLIP_COMFY_URL: "http://127.0.0.1:9000" } }), "http://127.0.0.1:9000");
  assert.throws(() => comfyUrl("http://192.168.1.20:8188", { env: {} }), /not loopback/);
  assert.throws(() => comfyUrl(undefined, { env: { LAUNCHCLIP_COMFY_URL: "http://gpu.example.com" } }), /not loopback/);
  assert.equal(comfyUrl("http://gpu.example.com:8188", { env: {}, allowRemote: true }), "http://gpu.example.com:8188");
  assert.throws(() => comfyUrl("file:///etc/passwd", { env: {} }), /http/);
});

test("every shipped template is valid, uses core nodes only and names a known licence", async () => {
  const ids = await listTemplates();
  assert.ok(ids.includes("sfx-stable-audio"));
  for (const id of ids) {
    const template = await loadTemplate(id);
    assert.equal(template.id, id);
    assert.ok(MODEL_LICENCES[template.model.licence], `${id}: licence ${template.model.licence}`);
    for (const node of templateNeeds(template).nodes) assert.ok(CORE_NODES.has(node), `${id}: ${node} is not a core node`);
    for (const file of template.model.files) assert.ok(FAKE_OBJECT_INFO[file.node], `${id}: the fake server knows loader ${file.node}`);
  }
  await assert.rejects(loadTemplate("../etc/passwd"), /Bad ComfyUI template id/);
  await assert.rejects(loadTemplate("nope"), /Unknown ComfyUI template nope/);
});

test("binding fills named inputs, keeps types and rejects unknown or mistyped ones", async () => {
  const template = await loadTemplate("sfx-stable-audio");
  const bound = bindTemplate(template, { prompt: "a dry wooden knock", seconds: 1.5, seed: 42 });
  assert.equal(bound["3"].inputs.text, "a dry wooden knock");
  assert.equal(bound["5"].inputs.seconds_total, 1.5);
  assert.equal(bound["6"].inputs.seconds, 1.5);
  assert.equal(bound["7"].inputs.seed, 42);
  assert.equal(bound["7"].inputs.steps, template.inputs.steps);
  assert.deepEqual(bound["7"].inputs.model, ["1", 0]);
  assert.ok(!JSON.stringify(bound).includes("{{"));
  assert.throws(() => bindTemplate(template, { ckpt_name: "evil.safetensors" }), /no input "ckpt_name"/);
  assert.throws(() => bindTemplate(template, { seed: "1" }), /must be a number/);
  assert.throws(() => bindTemplate(template, { seconds: Number.NaN }), /must be a number/);
  assert.notEqual(workflowKey(template, bound), workflowKey(template, bindTemplate(template, { prompt: "a dry wooden knock", seconds: 1.5, seed: 43 })));
});

test("a model licence off the open allowlist is refused unless the user allows its id", async () => {
  const template = await loadTemplate("sfx-stable-audio");
  assert.throws(() => assertLicence(template), /Stability AI Community License.*--allow-model-licence stability-ai-community/s);
  assert.equal(assertLicence(template, ["stability-ai-community"]), "stability-ai-community");
  assert.equal(assertLicence({ ...template, model: { ...template.model, licence: "apache-2.0" } }), "apache-2.0");
});

test("health fails on a missing node class or model file, and when the server is down", async () => {
  const template = await loadTemplate("sfx-stable-audio");
  const healthy = await createComfyClient({ env: {}, fetch: fakeComfy().fetch }).health(templateNeeds(template));
  assert.equal(healthy.ok, true);
  assert.equal(healthy.devices[0].type, "mps");
  const noNode = { ...FAKE_OBJECT_INFO, CLIPTextEncode: {}, KSampler: {}, EmptyLatentAudio: {}, VAEDecodeAudio: {}, SaveAudio: {} };
  const missing = await createComfyClient({ env: {}, fetch: fakeComfy({ objectInfo: noNode }).fetch }).health(templateNeeds(template));
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missing_nodes, ["ConditioningStableAudio"]);
  const noModel = { ...noNode, ConditioningStableAudio: {}, CLIPLoader: { input: { required: { clip_name: [["other.safetensors"]] } } } };
  const unloaded = await createComfyClient({ env: {}, fetch: fakeComfy({ objectInfo: noModel }).fetch }).health(templateNeeds(template));
  assert.deepEqual(unloaded.missing_models, ["t5_base.safetensors"]);
  const down = await createComfyClient({ env: {}, fetch: fakeComfy({ down: true }).fetch }).health(templateNeeds(template));
  assert.equal(down.ok, false);
  assert.match(down.reason, /not reachable/);
});

test("a generation queues the bound workflow, polls history, downloads the output, caches it by inputs and logs it", async () => {
  const dir = await temp();
  try {
    const template = await loadTemplate("sfx-stable-audio");
    const fake = fakeComfy({ pending: 2 });
    const client = createComfyClient({ env: {}, fetch: fake.fetch, pollMs: 1 });
    const ledger = path.join(dir, "generation-log.jsonl");
    const args = { client, template, values: { prompt: "a dry knock", seed: 5 }, cacheDir: path.join(dir, "cache"), allowLicences: ["stability-ai-community"], ledger, extra: { family: "impact" }, now: () => "2026-11-16T00:00:00Z" };
    const first = await generateWithComfy(args);
    assert.equal(first.cached, false);
    assert.equal(path.extname(first.file), ".flac");
    assert.equal((await readFile(first.file)).length, 2048);
    assert.equal(first.licence, "stability-ai-community");
    assert.equal(first.model, "Stable Audio Open 1.0");
    const queued = fake.calls.find((call) => call.path === "/prompt").body;
    assert.equal(queued.prompt["3"].inputs.text, "a dry knock");
    assert.equal(queued.client_id, client.clientId);
    const view = fake.calls.find((call) => call.path === "/view");
    assert.match(view.url, /filename=launchclip_00001_\.flac&subfolder=launchclip&type=output/);
    const line = JSON.parse((await readFile(ledger, "utf8")).trim());
    assert.equal(line.family, "impact");
    assert.equal(line.provider, "comfy");
    assert.equal(line.licence, "stability-ai-community");
    assert.equal(line.seed, 5);
    assert.deepEqual(line.cost, { amount: 0, unit: "local" });
    // Same inputs: from the cache, no server needed.
    const again = await generateWithComfy({ ...args, client: null });
    assert.equal(again.cached, true);
    assert.equal(again.file, first.file);
    assert.equal(fake.calls.filter((call) => call.path === "/prompt").length, 1);
    // A different seed is a new job.
    await generateWithComfy({ ...args, values: { prompt: "a dry knock", seed: 6 } });
    assert.equal(fake.calls.filter((call) => call.path === "/prompt").length, 2);
    assert.equal(fake.calls.filter((call) => call.path === "/object_info").length, 1, "health is checked once per client and template");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("execution errors, the job time cap and the download cap fail the generation without leaving a cache entry", async () => {
  const dir = await temp();
  try {
    const template = await loadTemplate("sfx-stable-audio");
    const run = (fake, options = {}) => generateWithComfy({ client: createComfyClient({ env: {}, fetch: fake.fetch, pollMs: 1, ...options }), template, cacheDir: path.join(dir, "cache"), allowLicences: ["stability-ai-community"] });
    await assert.rejects(run(fakeComfy({ fail: "out of memory" })), /failed in KSampler: out of memory/);
    const slow = fakeComfy({ pending: 1e9 });
    await assert.rejects(run(slow, { timeoutMs: 20 }), /limit and was interrupted/);
    assert.ok(slow.calls.some((call) => call.path === "/interrupt"));
    await assert.rejects(run(fakeComfy(), { maxBytes: 100 }), /over the 100-byte cap/);
    await assert.rejects(generateWithComfy({ client: createComfyClient({ env: {}, fetch: fakeComfy().fetch }), template, cacheDir: path.join(dir, "cache") }), /not on the open-licence allowlist/);
    assert.ok(!existsSync(path.join(dir, "cache")) || (await import("node:fs")).readdirSync(path.join(dir, "cache")).every((name) => !name.endsWith(".json")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("output files come only from history entries", () => {
  const entry = { outputs: { 9: { audio: [{ filename: "a.flac", subfolder: "x", type: "output" }], text: ["ignored"] }, 3: { images: [{ filename: "preview.png" }] } } };
  assert.deepEqual(historyFiles(entry, ["9"]), [{ filename: "a.flac", subfolder: "x", type: "output" }]);
  assert.equal(historyFiles(entry).length, 2);
  assert.deepEqual(historyFiles({}), []);
});
