import assert from "node:assert/strict";
import test from "node:test";
import { ChatCompletionsStructuredClient, OllamaStructuredClient, createStructuredClient, modelRouteKey, parseModelRoute, parseModelRoutes } from "../src/model_provider.js";

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

test("a model that takes no temperature is asked again without it, and not sent it after that", async () => {
  const bodies = [];
  const client = createStructuredClient({ provider: "openrouter", model: "example/no-sampling", reasoning: "none", apiKey: "router-test" }, {
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      if ("temperature" in body) return new Response(JSON.stringify({ error: { message: "No endpoints found that can handle the requested parameters." } }), { status: 404 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] }), { status: 200 });
    }
  });
  await client.runStructured({ schema: { type: "object" }, schemaName: "result", input: "go" });
  await client.runStructured({ schema: { type: "object" }, schemaName: "result", input: "again" });
  assert.deepEqual(bodies.map((body) => "temperature" in body), [true, false, false]);
});

test("a host that refuses array bounds in a schema is sent it without them, and the bounds stay off for that model", async () => {
  const bodies = [];
  const bounded = (schema) => JSON.stringify(schema).includes("minItems") || JSON.stringify(schema).includes("maxItems");
  const refuse = (sent) => "temperature" in sent
    ? new Response(JSON.stringify({ error: { message: "No endpoints found that can handle the requested parameters." } }), { status: 404 })
    : bounded(sent.response_format.json_schema.schema) ? new Response(JSON.stringify({ error: { message: "Provider returned error", code: 400 } }), { status: 400 }) : null;
  const client = createStructuredClient({ provider: "openrouter", model: "example/strict-host", reasoning: "none", apiKey: "router-test" }, {
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      return refuse(body) ?? new Response(JSON.stringify({ choices: [{ message: { content: "{\"items\":[\"a\"]}" } }] }), { status: 200 });
    }
  });
  const schema = { type: "object", required: ["items"], additionalProperties: false, properties: { items: { type: "array", minItems: 1, maxItems: 5, items: { type: "string", minLength: 1 } } } };
  const first = await client.runStructured({ schema, schemaName: "result", input: "go" });
  assert.deepEqual(first.value, { items: ["a"] });
  await client.runStructured({ schema, schemaName: "result", input: "again" });
  // Refused for the temperature, then for the bounds, then answered; the second call is sent right the first time.
  assert.deepEqual(bodies.map((body) => ["temperature" in body, bounded(body.response_format.json_schema.schema)]), [[true, true], [false, true], [false, false], [false, false]]);
  assert.deepEqual(bodies.at(-1).response_format.json_schema.schema.properties.items, { type: "array", items: { type: "string", minLength: 1 } }, "only the array bounds are taken out");
  assert.equal(schema.properties.items.minItems, 1, "the caller's schema is not changed");
  // A 400 on a schema with no bounds to take out is the caller's error.
  const plain = createStructuredClient({ provider: "openrouter", model: "example/other", reasoning: "none", apiKey: "router-test" }, { maxRetries: 0, fetch: async () => new Response(JSON.stringify({ error: { message: "Provider returned error" } }), { status: 400 }) });
  await assert.rejects(plain.runStructured({ schema: { type: "object" }, schemaName: "result", input: "go", temperature: 0 }), /\(400\): Provider returned error/);
});

test("a model that spends its output limit on reasoning is asked again with a small budget, and keeps it", async () => {
  const bodies = [];
  const client = createStructuredClient({ provider: "openrouter", model: "example/thinker", reasoning: "none", apiKey: "router-test" }, {
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      if (!body.reasoning) return new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "" } }], usage: { completion_tokens: 16000, completion_tokens_details: { reasoning_tokens: 15997 } } }), { status: 200 });
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "{\"ok\":true}" } }] }), { status: 200 });
    }
  });
  const first = await client.runStructured({ schema: { type: "object" }, schemaName: "result", input: "go", maxOutputTokens: 16000 });
  assert.deepEqual(first.value ?? first.output, { ok: true });
  await client.runStructured({ schema: { type: "object" }, schemaName: "result", input: "again" });
  assert.deepEqual(bodies.map((body) => body.reasoning?.effort ?? null), [null, "low", "low"]);
});

test("allows prompt-validated provider fallback for the dynamic OpenRouter free route", async () => {
  let body;
  const client = createStructuredClient({ provider: "openrouter", model: "openrouter/free", reasoning: "none", apiKey: "router-test" }, {
    fetch: async (_url, init) => {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({ model: "example/free-model:free", choices: [{ message: { content: "{\"ok\":true}" } }] }), { status: 200 });
    }
  });
  const result = await client.runStructured({ schema: { type: "object" }, schemaName: "result", input: "go", reasoningEffort: "none" });
  assert.deepEqual(body.provider, { require_parameters: false, allow_fallbacks: true });
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

test("accepts CRLF or an omitted closing fence around one structured object", async () => {
  const responses = ["```json\r\n{\"ok\":true}\r\n```", "```json\r\n{\"ok\":true}"];
  const client = createStructuredClient({ provider: "openrouter", model: "openrouter/free", reasoning: "none", apiKey: "router-test" }, {
    fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: responses.shift() } }] }), { status: 200 })
  });
  const request = { schema: { type: "object" }, schemaName: "result", input: "go" };
  assert.deepEqual((await client.runStructured(request)).value, { ok: true });
  assert.deepEqual((await client.runStructured(request)).value, { ok: true });
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

test("a model named for the priority tier asks its host for it and may fall back; other models are sent as before", async () => {
  const bodies = [];
  const fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: "r", model: "m", choices: [{ message: { content: "{}" }, finish_reason: "stop" }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const client = new ChatCompletionsStructuredClient({ provider: "openrouter", model: "google/fast-one", apiKey: "k", fetch, priorityModels: "google/fast-one, other/model" });
  const request = { schema: { type: "object", properties: {}, additionalProperties: false }, schemaName: "s", input: "x" };
  await client.runStructured(request);
  await client.runStructured({ ...request, model: "anthropic/writer" });
  assert.equal(bodies[0].service_tier, "priority");
  assert.deepEqual(bodies[0].provider, { require_parameters: true, allow_fallbacks: true });
  assert.equal("service_tier" in bodies[1], false);
  assert.deepEqual(bodies[1].provider, { require_parameters: true, allow_fallbacks: false });
});
