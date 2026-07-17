import assert from "node:assert/strict";
import test from "node:test";
import { OllamaStructuredClient, createStructuredClient, modelRouteKey, parseModelRoute, parseModelRoutes } from "../src/model_provider.js";

test("parses provider, model tag, and reasoning without losing model colons", () => {
  assert.deepEqual(modelRouteKey(parseModelRoute("ollama:qwen2.5-coder:latest@none")), {
    provider: "ollama",
    model: "qwen2.5-coder:latest",
    reasoning: "none",
    base_url: "http://localhost:11434",
    supports_images: false
  });
  assert.deepEqual(parseModelRoutes(["openai:gpt-5.6-luna@medium", "openrouter:kwaipilot/kat-coder-air-v2.5@none"]).map(modelRouteKey), [
    { provider: "openai", model: "gpt-5.6-luna", reasoning: "medium", base_url: "https://api.openai.com/v1", supports_images: true },
    { provider: "openrouter", model: "kwaipilot/kat-coder-air-v2.5", reasoning: "none", base_url: "https://openrouter.ai/api/v1", supports_images: true }
  ]);
});

test("sends deterministic structured output to Ollama with a coding-sized context", async () => {
  let request;
  const client = new OllamaStructuredClient({
    provider: "ollama",
    model: "qwen2.5-coder:latest",
    fetch: async (url, init) => {
      request = { url, init, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({
        model: "qwen2.5-coder:latest",
        message: { role: "assistant", content: JSON.stringify({ ok: true }) },
        done: true,
        prompt_eval_count: 20,
        eval_count: 5
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  const result = await client.runStructured({
    instructions: "Return the contract.",
    input: "Fix this.",
    images: [{ url: "data:image/png;base64,AAAA", detail: "original" }],
    schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
    schemaName: "probe",
    maxOutputTokens: 100,
    keepAlive: 0
  });
  assert.equal(request.url, "http://localhost:11434/api/chat");
  assert.deepEqual(request.body.format, { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false });
  assert.deepEqual(request.body.options, { temperature: 0, seed: 0, num_ctx: 32768, num_predict: 100 });
  assert.equal(request.body.keep_alive, 0);
  assert.equal(request.body.think, false);
  assert.equal(request.body.messages[1].content, "Fix this.");
  assert.equal(request.init.headers.Authorization, undefined);
  assert.deepEqual(result.value, { ok: true });
  assert.equal(result.usage.total_tokens, 25);
  assert.equal(client.supportsImages, false);
});

test("creates the native Ollama client for local routes", () => {
  assert.ok(createStructuredClient("ollama:qwen2.5-coder:latest@none") instanceof OllamaStructuredClient);
});

test("pins OpenRouter parameters and disables provider fallback", async () => {
  let body;
  const client = createStructuredClient({ provider: "openrouter", model: "kwaipilot/kat-coder-air-v2.5", reasoning: "none", apiKey: "router-test" }, {
    fetch: async (_url, init) => {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] }), { status: 200 });
    }
  });
  await client.runStructured({ schema: { type: "object" }, schemaName: "result", input: "go" });
  assert.deepEqual(body.provider, { require_parameters: true, allow_fallbacks: false });
});

test("allows provider fallback for the dynamic OpenRouter free route", async () => {
  let body;
  const client = createStructuredClient({ provider: "openrouter", model: "openrouter/free", reasoning: "none", apiKey: "router-test" }, {
    fetch: async (_url, init) => {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({ model: "example/free-model:free", choices: [{ message: { content: "{\"ok\":true}" } }] }), { status: 200 });
    }
  });
  const result = await client.runStructured({ schema: { type: "object" }, schemaName: "result", input: "go", reasoningEffort: "none" });
  assert.deepEqual(body.provider, { require_parameters: true, allow_fallbacks: true });
  assert.deepEqual(body.reasoning, { effort: "none" });
  assert.equal(result.model, "example/free-model:free");
});

test("reports safe provider metadata when a structured completion is empty", async () => {
  const client = createStructuredClient({ provider: "openrouter", model: "openrouter/free", reasoning: "none", apiKey: "router-test" }, {
    fetch: async () => new Response(JSON.stringify({
      model: "example/reasoning-model:free",
      choices: [{ finish_reason: "length", message: { content: "" } }],
      usage: {
        completion_tokens: 4_000,
        completion_tokens_details: { reasoning_tokens: 4_000 }
      }
    }), { status: 200 })
  });
  await assert.rejects(
    () => client.runStructured({ schema: { type: "object" }, schemaName: "result", input: "go" }),
    /model=example\/reasoning-model:free, finish_reason=length, completion_tokens=4000, reasoning_tokens=4000/
  );
});

test("accepts a single fenced JSON object from compatible chat providers", async () => {
  const client = createStructuredClient({ provider: "openrouter", model: "openrouter/free", reasoning: "none", apiKey: "router-test" }, {
    fetch: async () => new Response(JSON.stringify({
      model: "example/free-model:free",
      choices: [{ finish_reason: "stop", message: { content: "```json\n{\"ok\":true}\n```" } }]
    }), { status: 200 })
  });
  const result = await client.runStructured({ schema: { type: "object" }, schemaName: "result", input: "go" });
  assert.deepEqual(result.value, { ok: true });
});

test("times out a silent pinned free route without retrying it", async () => {
  let calls = 0;
  const client = createStructuredClient({ provider: "openrouter", model: "example/silent:free", reasoning: "none", apiKey: "router-test" }, {
    requestTimeoutMs: 10,
    fetch: async (_url, init) => {
      calls += 1;
      await new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
    }
  });
  await assert.rejects(
    () => client.runStructured({ schema: { type: "object" }, schemaName: "result", input: "go" }),
    (error) => error.code === "LAUNCHCLIP_PROVIDER_TIMEOUT" && /timed out after 10ms/.test(error.message)
  );
  assert.equal(calls, 1);
});

test("reports the same bounded timeout when a response body stalls after headers", async () => {
  const client = createStructuredClient({ provider: "openrouter", model: "example/stalled-body:free", reasoning: "none", apiKey: "router-test" }, {
    requestTimeoutMs: 10,
    fetch: async (_url, init) => ({
      ok: true,
      text: async () => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }))
    })
  });
  await assert.rejects(
    () => client.runStructured({ schema: { type: "object" }, schemaName: "result", input: "go" }),
    (error) => error.code === "LAUNCHCLIP_PROVIDER_TIMEOUT" && /timed out after 10ms/.test(error.message)
  );
});

test("rejects unsupported providers before a request", () => {
  assert.throws(() => parseModelRoute("mystery:model@low"), /Unsupported model provider/);
});
