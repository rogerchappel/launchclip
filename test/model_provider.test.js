import assert from "node:assert/strict";
import test from "node:test";
import { ChatCompletionsStructuredClient, createStructuredClient, modelRouteKey, parseModelRoute, parseModelRoutes } from "../src/model_provider.js";

test("parses provider, model tag, and reasoning without losing model colons", () => {
  assert.deepEqual(modelRouteKey(parseModelRoute("ollama:qwen2.5-coder:latest@none")), {
    provider: "ollama",
    model: "qwen2.5-coder:latest",
    reasoning: "none",
    base_url: "http://localhost:11434/v1",
    supports_images: false
  });
  assert.deepEqual(parseModelRoutes(["openai:gpt-5.6-luna@medium", "openrouter:kwaipilot/kat-coder-air-v2.5@none"]).map(modelRouteKey), [
    { provider: "openai", model: "gpt-5.6-luna", reasoning: "medium", base_url: "https://api.openai.com/v1", supports_images: true },
    { provider: "openrouter", model: "kwaipilot/kat-coder-air-v2.5", reasoning: "none", base_url: "https://openrouter.ai/api/v1", supports_images: true }
  ]);
});

test("sends strict structured output to an Ollama-compatible chat endpoint", async () => {
  let request;
  const client = new ChatCompletionsStructuredClient({
    provider: "ollama",
    model: "qwen2.5-coder:latest",
    fetch: async (url, init) => {
      request = { url, init, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({
        id: "chatcmpl_local",
        model: "qwen2.5-coder:latest",
        choices: [{ message: { content: JSON.stringify({ ok: true }) } }],
        usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  const result = await client.runStructured({
    instructions: "Return the contract.",
    input: "Fix this.",
    images: [{ url: "data:image/png;base64,AAAA", detail: "original" }],
    schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
    schemaName: "probe",
    maxOutputTokens: 100
  });
  assert.equal(request.url, "http://localhost:11434/v1/chat/completions");
  assert.equal(request.body.temperature, 0);
  assert.equal(request.body.response_format.json_schema.strict, true);
  assert.equal(request.body.messages[1].content, "Fix this.");
  assert.equal(request.init.headers.Authorization, undefined);
  assert.deepEqual(result.value, { ok: true });
  assert.equal(result.usage.total_tokens, 25);
  assert.equal(client.supportsImages, false);
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

test("rejects unsupported providers before a request", () => {
  assert.throws(() => parseModelRoute("mystery:model@low"), /Unsupported model provider/);
});
