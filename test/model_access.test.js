// The model check (launchclip doctor --models, MAKE.json model_access) and
// image input on the Anthropic client. Nothing here calls a real API: the
// check gets a fetch that fails the test if anything but a local Ollama's
// model list is asked for, and the Anthropic SDK is a stub.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseFlags, runCli } from "../src/cli.js";
import { diagnoseModels } from "../src/doctor.js";
import { runMake } from "../src/make/index.js";
import { MODEL_ACCESS_SCHEMA, checkModelAccess, createMakeClient, formatModelAccess, modelVision } from "../src/make/models.js";
import { AnthropicPlannerClient, anthropicContent } from "../src/storyboard_planner.js";
import { PROMPT, assetsDir, fakeFinish, fakeInventory, fakeModel } from "./helpers/make_fakes.js";

const TEXT_ROLES = ["writer", "designer", "director"];
const VISION_ROLES = ["critic", "hand-in judge"];

// A fetch for the check: only GET <ollama>/api/tags is allowed, and it is counted.
function localOnlyFetch({ models = null } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push(String(url));
    assert.match(String(url), /\/api\/tags$/, `the model check asked for ${url}`);
    assert.equal(init.method ?? "GET", "GET");
    if (!models) throw new Error("connect ECONNREFUSED");
    return { ok: true, json: async () => ({ models: models.map((name) => ({ name })) }) };
  };
  return { fetch, calls };
}

const check = (env, extra = {}) => {
  const local = localOnlyFetch(extra.ollama);
  return checkModelAccess({ env, fetch: local.fetch, probeLocal: true, ...extra }).then((report) => ({ report, calls: local.calls }));
};

const roleStates = (report, roles) => [...new Set(roles.map((role) => report.roles[role]))];

test("each combination of keys reports the right text and vision access, with no paid call", async () => {
  const cases = [
    { name: "no keys", env: {}, text: false, vision: false, reason: /no model key is set/ },
    { name: "OpenAI only", env: { OPENAI_API_KEY: "k" }, text: "openai", vision: true, source: "default for OPENAI_API_KEY" },
    { name: "Anthropic only", env: { ANTHROPIC_API_KEY: "k" }, text: "anthropic", vision: true, source: "default for ANTHROPIC_API_KEY" },
    { name: "OpenAI and Anthropic (OpenAI is make's default)", env: { OPENAI_API_KEY: "k", ANTHROPIC_API_KEY: "k" }, text: "openai", vision: true },
    { name: "both keys, Anthropic asked for", env: { OPENAI_API_KEY: "k", ANTHROPIC_API_KEY: "k" }, model: "anthropic:claude-opus-4-8", text: "anthropic", vision: true, source: "--model" },
    { name: "OpenRouter only: no default model", env: { OPENROUTER_API_KEY: "k" }, text: false, vision: false, reason: /OPENROUTER_API_KEY is set, but it has no default model/ },
    { name: "OpenRouter with a model", env: { OPENROUTER_API_KEY: "k" }, model: "openrouter:vendor/model@high", text: "openrouter", vision: true, note: /depends on the model/ },
    { name: "a model whose key is missing", env: { LAUNCHCLIP_MAKE_MODEL: "anthropic:claude-opus-4-8" }, text: false, vision: false, reason: /ANTHROPIC_API_KEY is not set/ },
    { name: "an OpenAI-compatible key with no address", env: { OPENAI_COMPATIBLE_API_KEY: "k" }, model: "compatible:some-model", text: false, vision: false, reason: /OPENAI_COMPATIBLE_BASE_URL is not set/ },
    { name: "an OpenAI-compatible endpoint", env: { OPENAI_COMPATIBLE_API_KEY: "k", OPENAI_COMPATIBLE_BASE_URL: "https://llm.example.test/v1" }, model: "openai-compatible:some-model", text: "compatible", vision: true },
    { name: "an unknown provider", env: {}, model: "mystery:model", text: false, vision: false, reason: /unsupported model provider: mystery/ }
  ];
  for (const entry of cases) {
    const { report, calls } = await check(entry.env, { model: entry.model });
    assert.equal(report.schema, MODEL_ACCESS_SCHEMA, entry.name);
    assert.equal(report.text.available, Boolean(entry.text), `${entry.name}: text ${JSON.stringify(report.text)}`);
    assert.equal(report.vision.available, entry.vision, `${entry.name}: vision ${JSON.stringify(report.vision)}`);
    if (entry.text) assert.equal(report.text.provider, entry.text, entry.name);
    if (entry.source) assert.equal(report.text.source, entry.source, entry.name);
    if (entry.reason) assert.match(report.text.reason, entry.reason, entry.name);
    if (entry.note) assert.match(report.vision.note, entry.note, entry.name);
    assert.deepEqual(roleStates(report, TEXT_ROLES), [entry.text ? "available" : "pending: no text model"], entry.name);
    assert.deepEqual(roleStates(report, VISION_ROLES), [entry.vision ? "available" : "pending: no text model"], entry.name);
    assert.ok(calls.every((url) => url === "http://localhost:11434/api/tags"), `${entry.name}: only the local model list was asked for`);
    // Presence only: no key value is in the report.
    assert.equal(JSON.stringify(report).includes('"k"'), false, entry.name);
  }
});

test("a local Ollama model writes but cannot see; one that does not answer, or lacks the model, is not available", async () => {
  const env = { OLLAMA_BASE_URL: "http://user:secret@localhost:11434/" };
  const up = await check(env, { model: "ollama:qwen2.5-coder", ollama: { models: ["qwen2.5-coder:latest"] } });
  assert.deepEqual({ available: up.report.text.available, provider: up.report.text.provider, local: up.report.text.local }, { available: true, provider: "ollama", local: true });
  assert.deepEqual(up.report.vision, { available: false, reason: "the Ollama client sends text only" });
  assert.deepEqual(roleStates(up.report, TEXT_ROLES), ["available"]);
  assert.deepEqual(roleStates(up.report, VISION_ROLES), ["pending: no vision model"]);
  assert.equal(up.report.local.reachable, true);
  assert.equal(up.report.local.base_url, "http://localhost:11434", "credentials in the address are not echoed");
  assert.equal(JSON.stringify(up.report).includes("secret"), false);

  const down = await check({}, { model: "local:qwen2.5-coder" });
  assert.equal(down.report.text.available, false);
  assert.match(down.report.text.reason, /Ollama does not answer at http:\/\/localhost:11434/);

  const missing = await check({}, { model: "ollama:llava", ollama: { models: ["qwen2.5-coder:latest"] } });
  assert.match(missing.report.text.reason, /has no model llava: run ollama pull llava/);

  // With no key, an Ollama that answers is named as the way in.
  const hint = await check({}, { ollama: { models: ["qwen2.5-coder:latest"] } });
  assert.match(hint.report.text.reason, /a local Ollama answers at http:\/\/localhost:11434: pass --model ollama:<model>/);

  // A remote Ollama is not a local model.
  const remote = await check({ OLLAMA_BASE_URL: "https://ollama.example.test" }, { model: "ollama:qwen2.5-coder", ollama: { models: ["qwen2.5-coder"] } });
  assert.equal(remote.report.text.local, false);
});

test("make's own check asks Ollama only when it is in play, and reports the client the run uses", async () => {
  const idle = localOnlyFetch({ models: [] });
  const report = await checkModelAccess({ env: { OPENAI_API_KEY: "k" }, fetch: idle.fetch });
  assert.equal(idle.calls.length, 0);
  assert.equal(report.local.reachable, null);

  // make hands over the client it built; a client that sends no images is reported as such.
  const blind = await checkModelAccess({ env: {}, fetch: idle.fetch, selected: { spec: "openai:m", source: "adapter", provider: "openai", model: "m", vision: false } });
  assert.equal(blind.text.available, true);
  assert.deepEqual(blind.vision, { available: false, reason: "openai:m is not set up to take images" });
});

test("on the skill path every role is the agent's", async () => {
  const { report, calls } = await check({}, { agent: true });
  assert.deepEqual(Object.values(report.roles), ["agent", "agent", "agent", "agent", "agent"]);
  assert.equal(report.text.source, "agent");
  assert.equal(report.vision.available, true);
  assert.equal(calls.length, 0);
});

test("launchclip doctor --models prints the check, as lines or JSON", async () => {
  const seen = [];
  const models = async (options) => { seen.push(options); return diagnoseModels({ ...options, env: { ANTHROPIC_API_KEY: "k" }, fetch: localOnlyFetch().fetch }); };
  const run = async (argv) => { const out = []; await runCli(argv, { stdout: { write: (value) => out.push(value) }, productionAdapters: { models } }); return out.join(""); };

  const json = JSON.parse(await run(["doctor", "--models", "--json"]));
  assert.equal(json.schema, MODEL_ACCESS_SCHEMA);
  assert.deepEqual({ text: json.text.provider, vision: json.vision.provider, model: json.text.model }, { text: "anthropic", vision: "anthropic", model: "claude-opus-4-8" });
  assert.equal(json.roles.critic, "available");
  assert.equal(json.keys.ANTHROPIC_API_KEY, true);

  const lines = await run(["doctor", "--models", "--model", "ollama:llava"]);
  assert.equal(seen.at(-1).model, "ollama:llava");
  assert.match(lines, /^text {4}not available: Ollama does not answer/m);
  assert.match(lines, /hand-in judge pending: no text model/);
  assert.match(lines, /No paid call was made/);

  // --agent is a switch here, wherever it sits.
  assert.match(await run(["doctor", "--models", "--agent"]), /critic {8}agent/);
  assert.match(await run(["doctor", "--agent", "--models", "--json"]), /"writer": "agent"/);
  assert.equal(parseFlags(["--models", "--json"]).models, true);
  assert.equal(formatModelAccess(json).includes("\"k\""), false);
});

test("the Anthropic client sends images as content blocks, before the text", async () => {
  assert.equal(anthropicContent("brief"), "brief", "text alone stays a string");
  assert.equal(anthropicContent({ a: 1 }, []), "{\"a\":1}");
  const png = Buffer.from("png-bytes").toString("base64");
  assert.deepEqual(anthropicContent("look", [{ url: `data:image/png;base64,${png}`, detail: "high" }, { url: "https://example.test/sheet.jpg" }]), [
    { type: "image", source: { type: "base64", media_type: "image/png", data: png } },
    { type: "image", source: { type: "url", url: "https://example.test/sheet.jpg" } },
    { type: "text", text: "look" }
  ]);
  assert.throws(() => anthropicContent("look", [{ url: "data:image/tiff;base64,AAAA" }]), /takes JPEG, PNG, GIF or WebP/);
  assert.throws(() => anthropicContent("look", [{ url: "file:///tmp/sheet.jpg" }]), /neither a base64 data URL nor an https URL/);

  const bodies = [];
  const sdk = { messages: { create: async (body) => { bodies.push(body); return { id: "msg_1", model: body.model, content: [{ type: "text", text: "{\"verdict\":\"ship\"}" }], usage: { input_tokens: 1200, output_tokens: 40 } }; } } };
  const client = new AnthropicPlannerClient({ model: "claude-test", sdk });
  assert.equal(client.supportsImages, true);
  const result = await client.runStructured({ instructions: "judge", input: "sheet 1", images: [{ url: `data:image/jpeg;base64,${png}` }], maxOutputTokens: 6000 });
  assert.equal(bodies[0].system, "judge");
  assert.equal(bodies[0].max_tokens, 6000);
  assert.deepEqual(bodies[0].messages[0].content.map((block) => block.type), ["image", "text"]);
  assert.equal(bodies[0].messages[0].content[0].source.media_type, "image/jpeg");
  assert.equal(result.text, "{\"verdict\":\"ship\"}");
});

test("which clients can take images", () => {
  assert.equal(modelVision("openai").available, true);
  assert.equal(modelVision("anthropic").available, true);
  assert.equal(modelVision("openrouter").available, true);
  assert.equal(modelVision("compatible", { supportsImages: false }).available, false);
  assert.equal(modelVision("ollama").available, false);
  const sdk = { messages: { create: async () => ({}) } };
  assert.equal(createMakeClient("anthropic:claude-opus-4-8", { sdk }).vision, true);
});

// The Anthropic SDK, stubbed: each Messages call is answered by the fake
// model the other make tests use (told apart by its system prompt), and a
// call that carries images is the critic's.
function anthropicSdk() {
  const fake = fakeModel();
  const bodies = [];
  const schemaFor = (system) => /voiceover scripts/.test(system) ? "launchclip_make_script" : /DIRECTION\.json/.test(system) ? "launchclip_direction" : /storyboard\.json/.test(system) ? "launchclip_storyboard" : null;
  const create = async (body) => {
    bodies.push(body);
    const content = body.messages[0].content;
    const usage = { input_tokens: 4000, output_tokens: 800 };
    if (Array.isArray(content)) {
      return { id: "msg_critic", model: body.model, content: [{ type: "text", text: JSON.stringify({ verdict: "ship", summary: "Reads cleanly on a phone.", findings: [{ id: "f1", severity: "minor", category: "typography", message: "Tighten the headline tracking.", evidence_ids: ["hook-001"] }] }) }], usage };
    }
    const schemaName = schemaFor(body.system);
    assert.ok(schemaName, `an unexpected Anthropic call: ${body.system.slice(0, 60)}`);
    const result = await fake.model.client.runStructured({ schemaName, instructions: body.system, input: content });
    return { id: "msg_text", model: body.model, content: [{ type: "text", text: JSON.stringify(result.value) }], usage };
  };
  return { sdk: { messages: { create } }, bodies };
}

// finish, standing in: the render plus the evidence and contact sheets the critic reads.
function finishWithEvidence() {
  const inner = fakeFinish([]);
  return async (project, options, adapters) => {
    const report = await inner(project, options, adapters);
    await mkdir(path.join(project, "qa/temporal-evidence"), { recursive: true });
    await mkdir(path.join(project, "qa/critic-sheets"), { recursive: true });
    const entries = ["hook-001", "hook-002"].flatMap((sample, i) => ["browser-still", "encoded-draft"].map((source) => ({ sample_id: sample, evidence_id: `${sample}-${source}`, source, role: "hook", at_seconds: i * 0.5 })));
    await writeFile(path.join(project, "qa/temporal-evidence/manifest.json"), JSON.stringify({ entries }));
    await writeFile(path.join(project, "qa/critic-sheets/index.json"), JSON.stringify({ sheets: [{ sheet: "sheet-01.jpg", samples: ["hook-001", "hook-002"] }] }));
    await writeFile(path.join(project, "qa/critic-sheets/sheet-01.jpg"), "jpg");
    return report;
  };
}

test("with only an Anthropic key, make --critic writes qa/critic.json and MAKE.json records model_access", async (t) => {
  const assets = await assetsDir();
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-model-access-"));
  t.after(() => Promise.all([rm(assets, { recursive: true, force: true }), rm(cwd, { recursive: true, force: true })]));
  const { sdk, bodies } = anthropicSdk();
  const report = await runMake(PROMPT, { assets, voice: "test", music: "synth", cwd, out: "video", critic: true }, { env: { ANTHROPIC_API_KEY: "test-key" }, clientOptions: { apiKey: "test-key", sdk }, fetch: localOnlyFetch().fetch, inventory: fakeInventory, finish: finishWithEvidence(), notice() {} });
  const project = path.join(cwd, "video");
  assert.notEqual(report.status, "failed", JSON.stringify(report.stages));
  assert.deepEqual({ spec: report.model.spec, source: report.model.source, vision: report.model.vision }, { spec: "anthropic:claude-opus-4-8", source: "default for ANTHROPIC_API_KEY", vision: true });

  assert.ok(existsSync(path.join(project, "qa/critic.json")));
  const critique = JSON.parse(await readFile(path.join(project, "qa/critic.json"), "utf8"));
  assert.equal(critique.verdict, "ship");
  assert.deepEqual(critique.findings[0].evidence_ids, ["hook-001-browser-still", "hook-001-encoded-draft"]);
  assert.equal(critique.reviewer.model, "claude-opus-4-8");
  assert.equal(report.critic.status, "written");
  assert.equal(report.gates.critic.status, "passed");
  assert.ok(report.costs.items.some((item) => item.stage === "critic" && item.provider === "anthropic"), JSON.stringify(report.costs.items));

  // The critic's call carried the sheet as a JPEG block.
  const critic = bodies.find((body) => Array.isArray(body.messages[0].content));
  assert.deepEqual(critic.messages[0].content.map((block) => block.type), ["image", "text"]);
  assert.deepEqual(critic.messages[0].content[0].source, { type: "base64", media_type: "image/jpeg", data: Buffer.from("jpg").toString("base64") });
  assert.equal(critic.model, "claude-opus-4-8");

  const written = JSON.parse(await readFile(path.join(project, "MAKE.json"), "utf8"));
  assert.equal(written.model_access.schema, MODEL_ACCESS_SCHEMA);
  assert.deepEqual({ text: written.model_access.text.provider, vision: written.model_access.vision.available, critic: written.model_access.roles.critic, judge: written.model_access.roles["hand-in judge"] }, { text: "anthropic", vision: true, critic: "available", judge: "available" });
  assert.equal(JSON.stringify(written).includes("test-key"), false);
});

test("a model that cannot see leaves the critic pending, with the reason from the check", async (t) => {
  const assets = await assetsDir();
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-model-access-"));
  t.after(() => Promise.all([rm(assets, { recursive: true, force: true }), rm(cwd, { recursive: true, force: true })]));
  const { model } = fakeModel();
  const report = await runMake(PROMPT, { assets, voice: "test", music: "synth", cwd, out: "video", critic: true }, { env: {}, client: { ...model, provider: "ollama", spec: "ollama:qwen2.5-coder", model: "qwen2.5-coder" }, fetch: localOnlyFetch({ models: ["qwen2.5-coder:latest"] }).fetch, inventory: fakeInventory, finish: finishWithEvidence(), notice() {} });
  assert.equal(report.critic.status, "pending");
  assert.equal(report.critic.reason, "ollama:qwen2.5-coder cannot take images (the Ollama client sends text only)");
  assert.equal(report.model_access.roles.critic, "pending: no vision model");
  assert.equal(report.model_access.roles.writer, "available");
});
