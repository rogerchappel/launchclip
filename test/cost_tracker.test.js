import assert from "node:assert/strict";
import test from "node:test";
import { createCostTracker, DEFAULT_MAX_COST_USD, estimateOpenAiUsageCost, parseCostLimit } from "../src/cost_tracker.js";

test("prices normalized OpenAI usage for an in-process circuit breaker", () => {
  const estimate = estimateOpenAiUsageCost("gpt-5.6-sol", {
    input_tokens: 100,
    output_tokens: 20,
    cached_tokens: 40,
    reasoning_tokens: 8
  });
  assert.equal(estimate.complete, true);
  assert.equal(estimate.estimated_usd, .00092);
});

test("totals OpenAI token usage and deduplicates background response polling", async () => {
  const tracker = createCostTracker({ fetch: async () => jsonResponse({
    id: "resp_1",
    status: "completed",
    model: "gpt-5.6-sol",
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      total_tokens: 120,
      input_tokens_details: { cached_tokens: 40 },
      output_tokens_details: { reasoning_tokens: 8 }
    }
  }) });

  await tracker.fetch("https://api.openai.com/v1/responses/resp_1", { method: "GET" });
  await tracker.fetch("https://api.openai.com/v1/responses/resp_1", { method: "GET" });

  const costs = tracker.summary();
  assert.equal(costs.calls, 1);
  assert.equal(costs.total_usd, .00092);
  assert.equal(costs.by_provider.openai.calls, 1);
  assert.equal(costs.line_items[0].usage.cached_input_tokens, 40);
  assert.equal(costs.line_items[0].usage.reasoning_tokens, 8);
});

test("totals Anthropic cache usage at the configured Opus rates", async () => {
  const tracker = createCostTracker({ fetch: async () => jsonResponse({
    id: "msg_1",
    type: "message",
    model: "claude-opus-4-8",
    usage: {
      input_tokens: 100,
      cache_creation_input_tokens: 30,
      cache_creation: { ephemeral_5m_input_tokens: 20, ephemeral_1h_input_tokens: 10 },
      cache_read_input_tokens: 40,
      output_tokens: 20
    }
  }) });

  await tracker.fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-opus-4-8" })
  });

  const costs = tracker.summary();
  assert.equal(costs.total_usd, .001245);
  assert.equal(costs.line_items[0].usage.cache_write_1h_tokens, 10);
});

test("totals ElevenLabs transcription, speech, and music usage", async () => {
  const responses = [
    binaryResponse({ "request-id": "tts_1" }),
    jsonResponse({ words: [{ type: "word", text: "done", start: 179, end: 180 }] }, { "request-id": "stt_1" }),
    binaryResponse({ "request-id": "music_1" })
  ];
  const tracker = createCostTracker({ fetch: async () => responses.shift() });
  await tracker.fetch("https://api.elevenlabs.io/v1/text-to-speech/voice_1", {
    method: "POST",
    body: JSON.stringify({ text: "a".repeat(2_000), model_id: "eleven_multilingual_v2" })
  });
  const form = new FormData();
  form.append("model_id", "scribe_v2");
  form.append("file", new Blob(["audio"]), "take.mp3");
  await tracker.fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", body: form });
  await tracker.fetch("https://api.elevenlabs.io/v1/music", {
    method: "POST",
    body: JSON.stringify({ model_id: "music_v2", music_length_ms: 120_000 })
  });

  const costs = tracker.summary();
  assert.equal(costs.calls, 3);
  assert.equal(costs.total_usd, .511);
  assert.equal(costs.by_provider.elevenlabs.estimated_usd, .511);
  assert.deepEqual(costs.line_items.map((item) => item.product), ["text-to-speech", "transcription", "music-generation"]);
});

test("prices an unknown model at its vendor's highest standard rate and marks the tally an estimate", async () => {
  const tracker = createCostTracker({ fetch: async () => jsonResponse({
    id: "resp_unknown", status: "completed", model: "gpt-future", usage: { input_tokens: 1_000_000, output_tokens: 100_000 }
  }) });
  await tracker.fetch("https://api.openai.com/v1/responses", {
    method: "POST", body: JSON.stringify({ model: "gpt-future" })
  });

  const costs = tracker.summary();
  assert.equal(costs.complete, false);
  assert.equal(costs.total_usd, 8); // $5 in + $3 out at the gpt-5.6 rate
  assert.equal(costs.by_provider.openai.fallback_calls, 1);
  assert.equal(costs.line_items[0].pricing.fallback, true);
  assert.match(costs.warnings[0], /gpt-future.*highest standard OpenAI rate/);
});

test("tracks OpenRouter calls: its reported cost, else the vendor's rates", async () => {
  const replies = [
    { id: "gen-1", model: "openai/gpt-5.6-terra", choices: [{}], usage: { prompt_tokens: 1_000_000, completion_tokens: 100_000 } },
    { id: "gen-2", model: "anthropic/claude-opus-4-8", choices: [{}], usage: { prompt_tokens: 1_000_000, completion_tokens: 0, cost: 4.2 } },
    { id: "gen-3", model: "acme/mystery-1", choices: [{}], usage: { prompt_tokens: 1_000_000, completion_tokens: 0 } }
  ];
  const tracker = createCostTracker({ fetch: async () => jsonResponse(replies.shift()) });
  for (let i = 0; i < 3; i += 1) await tracker.fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", body: JSON.stringify({ model: "x" }) });

  const items = tracker.summary().line_items;
  assert.deepEqual(items.map((item) => [item.provider, item.model, item.estimated_usd]), [
    ["openrouter", "openai/gpt-5.6-terra", 4], // $2.50 in + $1.50 out
    ["openrouter", "anthropic/claude-opus-4-8", 4.2],
    ["openrouter", "acme/mystery-1", 5] // unknown vendor model: the OpenAI fallback rate
  ]);
});

test("the spending limit stops new OpenRouter calls and counts fallback-priced ones", async () => {
  const tracker = createCostTracker({
    limitUsd: 1,
    fetch: async () => jsonResponse({ id: `gen-${Math.random()}`, model: "openai/gpt-new", choices: [{}], usage: { prompt_tokens: 300_000, completion_tokens: 0 } })
  });
  const post = () => tracker.fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", body: "{}" });
  await post(); // $1.50 at the fallback rate
  await assert.rejects(post, (error) => error.code === "LAUNCHCLIP_COST_LIMIT");
});

test("ignores non-AI fetches", async () => {
  const tracker = createCostTracker({ fetch: async () => jsonResponse({ ok: true }) });
  await tracker.fetch("https://example.com/data");
  assert.deepEqual(tracker.summary().line_items, []);
});

test("refuses a new paid call once spending reaches the limit but still polls running work", async () => {
  const sent = [];
  const tracker = createCostTracker({
    limitUsd: .0005,
    fetch: async (url, init) => {
      sent.push(init?.method ?? "GET");
      return jsonResponse({ id: `resp_${sent.length}`, status: "completed", model: "gpt-5.6-sol", usage: { input_tokens: 100, output_tokens: 20 } });
    }
  });
  const post = () => tracker.fetch("https://api.openai.com/v1/responses", { method: "POST", body: JSON.stringify({ model: "gpt-5.6-sol" }) });

  await post();
  await assert.rejects(post, (error) => error.code === "LAUNCHCLIP_COST_LIMIT" && /\$0\.00 limit/.test(error.message));
  await tracker.fetch("https://api.openai.com/v1/responses/resp_running", { method: "GET" });
  await tracker.fetch("https://example.com/asset.png", { method: "POST" });

  assert.deepEqual(sent, ["POST", "GET", "POST"]);
  assert.equal(tracker.limitError().code, "LAUNCHCLIP_COST_LIMIT");
});

test("defaults the spending limit to $50 and accepts none to remove it", () => {
  assert.equal(parseCostLimit(undefined), DEFAULT_MAX_COST_USD);
  assert.equal(DEFAULT_MAX_COST_USD, 50);
  assert.equal(parseCostLimit("15"), 15);
  assert.equal(parseCostLimit("none"), null);
  assert.throws(() => parseCostLimit("0"), /positive dollar amount/);
});

function jsonResponse(value, headers = {}) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json", ...headers } });
}

function binaryResponse(headers = {}) {
  return new Response(Buffer.from("audio"), { status: 200, headers });
}
