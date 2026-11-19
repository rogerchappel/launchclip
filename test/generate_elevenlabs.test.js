import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createElevenLabsProvider, nearestAspect } from "../src/generate/providers/elevenlabs.js";

const KEY = "sk_test_flows_key_0123456789";
const env = { ELEVENLABS_API_KEY: KEY };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function setup() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-el-"));
  const ref = path.join(dir, "look.png");
  await writeFile(ref, Buffer.from("PNGREF"));
  const brief = {
    id: "b1", kind: "footage", steps: ["image", "video"],
    image: { prompt: "a lighthouse at dusk", negative: "text, watermark", width: 1920, height: 1080, references: [ref] },
    video: { prompt: "the beam sweeps the water", seconds: 4, pad_seconds: 0.5, fps: 30 },
    brief_hash: "sha256:abc"
  };
  return { dir, ref, brief };
}

// A fake flows API: create → pending, first GET generating, then completed.
function fakeApi() {
  const calls = [];
  const polls = {};
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    const u = new URL(url);
    if (u.host === "storage.example") return new Response(Buffer.from(`bytes:${u.pathname}`));
    const [, , , step, id] = u.pathname.split("/");
    if (init.method === "POST") return json({ id: `${step}-gen`, status: "pending" });
    polls[id] = (polls[id] ?? 0) + 1;
    if (polls[id] === 1) return json({ id, status: "generating" });
    return json({ id, status: "completed", content_url: `https://storage.example/${id}?sig=x`, content_mime_type: step === "video" ? "video/mp4" : "image/png" });
  };
  return { fetch, calls };
}

test("image then video: submit → poll → fetch, with the brief mapped onto the flows API", async () => {
  const { dir, brief } = await setup();
  const api = fakeApi();
  const p = createElevenLabsProvider({ imageModel: "img-model", videoModel: "veo-final", draftVideoModel: "veo-draft", fetch: api.fetch, env });
  assert.deepEqual(p.quote(brief, "video", "final"), { amount: null, unit: "credits" });

  const imageJob = await p.submit(brief, "image", "final");
  const post = api.calls[0];
  assert.equal(post.url, "https://api.elevenlabs.io/v1/flows/image");
  assert.equal(post.init.headers["xi-api-key"], KEY);
  const imageBody = JSON.parse(post.init.body);
  assert.equal(imageBody.model_id, "img-model");
  assert.equal(imageBody.aspect_ratio, "16:9");
  assert.equal(imageBody.negative_prompt, undefined);
  assert.deepEqual(imageBody.images, [{ type: "inline_base64", content_base64: Buffer.from("PNGREF").toString("base64"), mime_type: "image/png" }]);

  assert.deepEqual(await p.poll(imageJob), { state: "running" });
  assert.deepEqual(await p.poll(imageJob), { state: "done" });
  const still = await p.fetch(imageJob, dir);
  assert.equal(still.file, path.join(dir, "b1-image.png"));
  assert.equal(await readFile(still.file, "utf8"), "bytes:/image-gen");
  assert.equal(still.model, "img-model");
  assert.match(still.licence, /^see provider terms: https:\/\//);
  const download = api.calls.find((c) => c.url.startsWith("https://storage.example"));
  assert.equal(download.init?.headers?.["xi-api-key"], undefined, "the key never goes to the signed URL host");

  const videoJob = await p.submit(brief, "video", "draft", { startFrame: imageJob });
  const videoBody = JSON.parse(api.calls.at(-1).init.body);
  assert.equal(api.calls.at(-1).url, "https://api.elevenlabs.io/v1/flows/video");
  assert.equal(videoBody.model_id, "veo-draft");
  assert.equal(videoBody.prompt, "the beam sweeps the water");
  assert.equal(videoBody.duration_secs, 5);
  assert.equal(videoBody.negative_prompt, "text, watermark");
  assert.deepEqual(videoBody.start_frame, { type: "generation", generation_id: "image-gen" });
  assert.equal(videoBody.images, undefined);
  assert.equal("fps" in videoBody, false);
  await p.poll(videoJob);
  assert.deepEqual(await p.poll(videoJob), { state: "done" });
  const clip = await p.fetch(videoJob, dir);
  assert.equal(clip.file, path.join(dir, "b1-video.mp4"));
  assert.equal(clip.model, "veo-draft");
});

test("video start frame from a file goes inline; references without one get a role on Veo", async () => {
  const { brief, ref } = await setup();
  const api = fakeApi();
  const p = createElevenLabsProvider({ videoModel: "veo-x", fetch: api.fetch, env });
  await p.submit(brief, "video", "final", { startFrame: ref });
  assert.equal(JSON.parse(api.calls[0].init.body).start_frame.type, "inline_base64");
  await p.submit(brief, "video", "final");
  assert.equal(JSON.parse(api.calls[1].init.body).images[0].role, "subject");
});

test("a failed generation reports its reason", async () => {
  const { brief } = await setup();
  const fetch = async (_url, init = {}) => init.method === "POST" ? json({ id: "g", status: "pending" }) : json({ id: "g", status: "failed", failure_reason: "moderated", error_message: "rejected by moderation" });
  const p = createElevenLabsProvider({ imageModel: "m", fetch, env });
  assert.deepEqual(await p.poll(await p.submit(brief, "image", "final")), { state: "failed", error: "moderated: rejected by moderation" });
});

test("missing key or model: nothing is sent", async () => {
  const { brief } = await setup();
  const api = fakeApi();
  await assert.rejects(createElevenLabsProvider({ imageModel: "m", fetch: api.fetch, env: {} }).submit(brief, "image", "final"), /needs ELEVENLABS_API_KEY/);
  await assert.rejects(createElevenLabsProvider({ fetch: api.fetch, env }).submit(brief, "image", "final"), /no image model chosen/);
  assert.throws(() => createElevenLabsProvider({ fetch: api.fetch, env }).quote(brief, "video", "final"), /no video model chosen/);
  assert.equal(api.calls.length, 0);
});

test("plan, ByteDance access and region refusals become clear errors without the key", async () => {
  const { brief } = await setup();
  const cases = [
    [402, { detail: { code: "paid_plan_required", message: `workspace below Pro ${KEY}` } }, /needs a Pro plan or above/],
    [403, { detail: { type: "authorization_error", code: "model_access_denied", message: "no access" } }, /ByteDance models are off by default/],
    [403, { detail: { code: "feature_not_available", message: "This model is not available in the United States" } }, /not available in your region/]
  ];
  for (const [status, body, pattern] of cases) {
    const p = createElevenLabsProvider({ imageModel: "m", fetch: async () => json(body, status), env });
    await assert.rejects(p.submit(brief, "image", "final"), (error) => {
      assert.match(error.message, pattern);
      assert.equal(error.message.includes(KEY), false);
      assert.equal(error.status, status);
      return true;
    });
  }
});

test("abort: an aborted signal sends nothing, and one aborted mid-request rejects", async () => {
  const { brief } = await setup();
  const api = fakeApi();
  const p = createElevenLabsProvider({ imageModel: "m", fetch: api.fetch, env });
  await assert.rejects(p.submit(brief, "image", "final", { signal: AbortSignal.abort() }), { name: "AbortError" });
  assert.equal(api.calls.length, 0);

  const controller = new AbortController();
  const hanging = (_url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
  const pending = createElevenLabsProvider({ imageModel: "m", fetch: hanging, env }).submit(brief, "image", "final", { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});

test("nearestAspect picks the closest supported ratio", () => {
  assert.equal(nearestAspect(1080, 1920), "9:16");
  assert.equal(nearestAspect(1024, 1024), "1:1");
  assert.equal(nearestAspect(2560, 1080), "21:9");
});
