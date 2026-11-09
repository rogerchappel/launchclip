// The Anthropic adapter takes images, so the headless critic runs with only ANTHROPIC_API_KEY.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runHeadlessCritic } from "../src/make/critic.js";
import { runMake } from "../src/make/index.js";
import { createMakeClient } from "../src/make/models.js";
import { ANTHROPIC_STREAM_ABOVE, AnthropicPlannerClient, anthropicImageBlocks } from "../src/storyboard_planner.js";
import { PROMPT, assetsDir, fakeFinish, fakeInventory, fakeModel } from "./helpers/make_fakes.js";

// A stand-in for @anthropic-ai/sdk: records each request and answers with one text block.
function fakeSdk(text) {
  const requests = [];
  const message = (request) => ({ id: "msg_1", model: request.model, content: [{ type: "thinking", thinking: "" }, { type: "text", text }], usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 0 } });
  return { requests, messages: {
    async create(request) { requests.push({ via: "create", ...request }); return message(request); },
    stream(request) { requests.push({ via: "stream", ...request }); return { finalMessage: async () => message(request) }; }
  } };
}

test("images become Anthropic image blocks: base64 for data URLs, url for https, anything else refused", () => {
  assert.deepEqual(anthropicImageBlocks([{ url: "data:image/jpeg;base64,QUJD", detail: "high" }, { url: "https://example.com/a.png" }]), [
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJD" } },
    { type: "image", source: { type: "url", url: "https://example.com/a.png" } }
  ]);
  assert.deepEqual(anthropicImageBlocks(undefined), []);
  assert.throws(() => anthropicImageBlocks([{ url: "data:image/tiff;base64,QUJD" }]), /image 1 is image\/tiff/);
  assert.throws(() => anthropicImageBlocks([{ url: "file:///tmp/a.png" }]), /neither a base64 data URL nor an https URL/);
});

test("the Anthropic client sends images before the text, and streams a request with a large max_tokens", async () => {
  const sdk = fakeSdk("{\"ok\":true}");
  const client = new AnthropicPlannerClient({ model: "claude-opus-4-8", sdk });
  const plain = await client.runStructured({ instructions: "Be brief.", input: "Hello", maxOutputTokens: 6000 });
  assert.equal(sdk.requests[0].via, "create");
  assert.equal(sdk.requests[0].messages[0].content, "Hello", "a text-only request is unchanged");
  assert.equal(plain.text, "{\"ok\":true}");
  assert.deepEqual(plain.usage, { input_tokens: 1200, output_tokens: 300, total_tokens: 1500, cached_tokens: 0 });
  await client.runStructured({ instructions: "Look.", input: "What is on the sheet?", images: [{ url: "data:image/png;base64,QUJD" }], maxOutputTokens: 6000 });
  assert.deepEqual(sdk.requests[1].messages[0].content, [{ type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } }, { type: "text", text: "What is on the sheet?" }]);
  assert.equal(sdk.requests[1].system, "Look.");
  await client.runStructured({ input: "A long one", maxOutputTokens: ANTHROPIC_STREAM_ABOVE + 1 });
  assert.equal(sdk.requests[2].via, "stream");
  assert.equal(sdk.requests[2].max_tokens, ANTHROPIC_STREAM_ABOVE + 1);
  await client.runStructured({ input: "At the line", maxOutputTokens: ANTHROPIC_STREAM_ABOVE });
  assert.equal(sdk.requests[3].via, "create");
});

test("make counts an Anthropic model as able to see, so the critic is on by default", () => {
  const made = createMakeClient("anthropic:claude-opus-4-8", { apiKey: "test-key" });
  assert.equal(made.provider, "anthropic");
  assert.equal(made.vision, true);
  assert.equal(made.client.model, "claude-opus-4-8");
});

async function sheetProject() {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-anthropic-critic-"));
  await mkdir(path.join(project, "qa/temporal-evidence"), { recursive: true });
  await mkdir(path.join(project, "qa/critic-sheets"), { recursive: true });
  const entries = [{ evidence_id: "hook-001-browser-still", sample_id: "hook-001", source: "browser-still", at_seconds: 0.5 }, { evidence_id: "hook-001-encoded-draft", sample_id: "hook-001", source: "encoded-draft", at_seconds: 0.5 }];
  await writeFile(path.join(project, "qa/temporal-evidence/manifest.json"), JSON.stringify({ entries }));
  await writeFile(path.join(project, "qa/critic-sheets/index.json"), JSON.stringify({ sheets: [{ sheet: "sheet-01.jpg", samples: ["hook-001"] }] }));
  await writeFile(path.join(project, "qa/critic-sheets/sheet-01.jpg"), "jpg");
  await writeFile(path.join(project, "qa/critic-sheets/overview-every-1.5s.jpg"), "strip");
  return project;
}

test("the headless critic reviews the sheets through the Anthropic client and writes qa/critic.json", async (t) => {
  const project = await sheetProject();
  t.after(() => rm(project, { recursive: true, force: true }));
  // The model answers in prose around the JSON, as a text-only response may.
  const sdk = fakeSdk(`Here is the review.\n${JSON.stringify({ verdict: "repair", summary: "The hook is hard to read.", findings: [{ id: "f1", severity: "major", category: "typography", message: "The headline is too small on a phone; raise it to 96 px.", evidence_ids: ["hook-001"] }] })}`);
  const client = new AnthropicPlannerClient({ model: "claude-opus-4-8", sdk });
  const result = await runHeadlessCritic({ project, client, model: "claude-opus-4-8", provider: "anthropic" });
  assert.equal(result.status, "written", result.reason);
  assert.equal(result.verdict, "repair");
  assert.equal(result.model, "claude-opus-4-8");
  assert.equal(typeof result.cost_usd, "number");
  const content = sdk.requests[0].messages[0].content;
  assert.deepEqual(content.map((block) => block.type), ["image", "image", "text"], "the sheet and the overview strip, then the evidence ids");
  assert.equal(content[0].source.media_type, "image/jpeg");
  assert.equal(Buffer.from(content[0].source.data, "base64").toString(), "jpg");
  assert.match(content[2].text, /hook-001-browser-still/);
  const critique = JSON.parse(await readFile(path.join(project, "qa/critic.json"), "utf8"));
  assert.deepEqual(critique.findings[0].evidence_ids, ["hook-001-browser-still", "hook-001-encoded-draft"]);
  assert.equal(critique.reviewer.model, "claude-opus-4-8");
});

test("with an Anthropic model, make runs the critic without --critic and the gate is set from its verdict", async (t) => {
  const assets = await assetsDir();
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-anthropic-make-"));
  t.after(() => Promise.all([rm(assets, { recursive: true, force: true }), rm(cwd, { recursive: true, force: true })]));
  // The planning calls use the fake model; what make sees is an Anthropic model that can take images.
  const fake = fakeModel({ vision: createMakeClient("anthropic:claude-opus-4-8", { apiKey: "test-key" }).vision });
  const model = { ...fake.model, provider: "anthropic", model: "claude-opus-4-8", spec: "anthropic:claude-opus-4-8" };
  const criticCalls = [];
  const critic = async (args) => { criticCalls.push(args); return { status: "written", verdict: "ship", findings: 0, reviewed: 2, unreviewed: 0, warnings: [], model: "claude-opus-4-8", critique: { verdict: "ship", summary: "", findings: [] } }; };
  const report = await runMake(PROMPT, { assets, voice: "test", music: "synth", concepts: "off", cwd, out: "video" }, { env: {}, client: model, inventory: fakeInventory, finish: fakeFinish([]), critic, notice() {} });
  assert.equal(criticCalls.length, 1);
  assert.equal(criticCalls[0].provider, "anthropic");
  assert.equal(report.model.vision, true);
  assert.equal(report.critic.status, "written");
  assert.equal(report.gates.critic.status, "passed");
  assert.equal(report.status, "ready", "the critic ran, so the video is not left ready-for-review");
});
