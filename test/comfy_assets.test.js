import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createComfyClient } from "../src/comfy/client.js";
import { createComfyAssetProvider, generationSize, shotText, wanFrames } from "../src/comfy/asset_provider.js";
import { normalizeShot } from "../src/asset_provider.js";
import { fakeComfy } from "./helpers/fake_comfy.js";

const temp = () => mkdtemp(path.join(os.tmpdir(), "launchclip-comfy-assets-"));
const vertical = { width: 1080, height: 1920, aspect: "9:16" };

test("sizes keep the request's aspect on the model's grid, and Wan frame counts are 4n + 1", () => {
  assert.deepEqual(generationSize({ width: 1920, height: 1080 }, { pixels: 1024 * 1024, step: 64 }), { width: 1344, height: 768 });
  assert.deepEqual(generationSize(vertical, { pixels: 832 * 480, step: 32 }), { width: 480, height: 832 });
  assert.deepEqual(generationSize(null, { pixels: 832 * 480, step: 32 }), { width: 832, height: 480 });
  assert.equal(wanFrames(3), 73);
  assert.equal(wanFrames(10), 121);
  assert.equal(wanFrames(0.2), 25);
  assert.equal(wanFrames(null), 73);
  for (const seconds of [1, 1.7, 2.3, 4]) assert.equal((wanFrames(seconds) - 1) % 4, 0);
  assert.match(shotText({ shows: "a barista pouring latte art", role: "background" }), /^a barista pouring latte art, wide establishing shot, nobody in frame.*no text, no lettering/);
});

test("image requests get a plate, video requests a Wan draft; both are cached, logged and carry their licence", async () => {
  const project = await temp();
  try {
    const fake = fakeComfy({ filename: "launchclip_00001_.png" });
    const provider = await createComfyAssetProvider({ project, client: createComfyClient({ env: {}, fetch: fake.fetch, pollMs: 1 }), notice: () => {} });
    const still = await provider.findShot({ id: "r1", scene_id: "s1", shows: "a quiet harbour at dawn", type: "any", format: vertical });
    assert.equal(still.kind, "image");
    assert.equal(still.source.provider, "comfy");
    assert.equal(still.source.license, "apache-2.0");
    assert.equal(still.source.model, "FLUX.1 schnell");
    assert.equal(still.source.generated, true);
    assert.ok(still.file.startsWith(path.join(project, ".launchclip", "cache", "comfy")));
    const image = fake.calls.find((call) => call.path === "/prompt").body.prompt;
    assert.equal(image["4"].inputs.width, 768);
    assert.equal(image["4"].inputs.height, 1344);
    assert.match(image["2"].inputs.text, /^a quiet harbour at dawn\. .*no text/);
    const clip = await provider.findShot({ id: "r2", scene_id: "s2", shows: "waves rolling onto rocks", type: "video", duration: 2, format: vertical });
    assert.equal(clip.kind, "video");
    assert.equal(clip.source.model, "Wan 2.2 TI2V-5B");
    const video = fake.calls.filter((call) => call.path === "/prompt")[1].body.prompt;
    assert.equal(video["7"].inputs.length, 49);
    assert.deepEqual([video["7"].inputs.width, video["7"].inputs.height], [480, 832]);
    // A still slot turns a video request into a plate.
    assert.equal((await provider.findShot({ id: "r3", shows: "waves rolling onto rocks", type: "video", still: true, format: vertical })).kind, "image");
    const ledger = (await readFile(path.join(project, "qa", "generation-log.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(ledger.map((line) => [line.shot, line.tier, line.licence]), [["s1", "plate", "apache-2.0"], ["s2", "draft", "apache-2.0"], ["r3", "plate", "apache-2.0"]]);
    // The same request again comes from the cache.
    const again = await provider.findShot({ id: "r1", scene_id: "s1", shows: "a quiet harbour at dawn", type: "any", format: vertical });
    assert.equal(again.file, still.file);
    assert.equal(fake.calls.filter((call) => call.path === "/prompt").length, 3);
    assert.equal(normalizeShot(still).source.license, "apache-2.0");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("no ComfyUI, a missing model or a failed job means no shot, with one notice per reason", async () => {
  const project = await temp();
  try {
    const notices = [];
    const down = await createComfyAssetProvider({ project, fetch: fakeComfy({ down: true }).fetch, env: {}, notice: (line) => notices.push(line) });
    assert.equal(await down.findShot({ shows: "a", type: "image" }), null);
    assert.equal(await down.findShot({ shows: "b", type: "image" }), null);
    assert.equal(notices.length, 1);
    assert.match(notices[0], /comfy: ComfyUI cannot run plate-flux-schnell: .*not reachable.*drawn in code/);
    const noModel = fakeComfy({ objectInfo: { CheckpointLoaderSimple: { input: { required: { ckpt_name: [["other.safetensors"]] } } } } });
    const missing = await createComfyAssetProvider({ project, client: createComfyClient({ env: {}, fetch: noModel.fetch }), notice: (line) => notices.push(line) });
    assert.equal(await missing.findShot({ shows: "a", type: "image" }), null);
    assert.match(notices.at(-1), /missing model files: flux1-schnell-fp8\.safetensors/);
    assert.ok(!noModel.calls.some((call) => call.path === "/prompt"), "nothing is queued on an unhealthy server");
    const failing = await createComfyAssetProvider({ project, client: createComfyClient({ env: {}, fetch: fakeComfy({ fail: "MPS out of memory" }).fetch, pollMs: 1 }), notice: (line) => notices.push(line) });
    assert.equal(await failing.findShot({ shows: "a", type: "video" }), null);
    assert.match(notices.at(-1), /MPS out of memory/);
    await assert.rejects(createComfyAssetProvider({ project, plate: "plate-flux-dev" }), /--comfy-plate must be/);
    await assert.rejects(createComfyAssetProvider({ project, url: "http://10.1.1.1:8188", env: {} }), /not loopback/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
