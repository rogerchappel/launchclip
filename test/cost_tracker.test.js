import assert from "node:assert/strict";
import test from "node:test";
import { costBound, createCostTracker, DEFAULT_MAX_COST_USD, estimateModelUsageCost, estimateOpenAiUsageCost, parseCostLimit } from "../src/cost_tracker.js";

test("prices normalized OpenAI usage for an in-process circuit breaker", () => {
  const estimate = estimateOpenAiUsageCost("gpt-5.6-sol", {
    input_tokens: 100,
    output_tokens: 20,
    cached_tokens: 40,
    reasoning_tokens: 8
  });
  assert.equal(estimate.complete, true);
  assert.equal(estimate.estimated_usd, .000656);
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
  assert.equal(costs.total_usd, .000656);
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

test("prices the GPT-6.1 family at its published rates, long context included", async () => {
  const replies = [
    { id: "resp_terra", status: "completed", model: "gpt-6.1-terra", usage: { input_tokens: 272_000, output_tokens: 100_000 } },
    { id: "resp_terra_cached", status: "completed", model: "gpt-6.1-terra-2026-10-01", usage: { input_tokens: 200_000, output_tokens: 0, input_tokens_details: { cached_tokens: 100_000, cache_write_tokens: 100_000 } } },
    { id: "resp_terra_long", status: "completed", model: "gpt-6.1-terra", usage: { input_tokens: 300_000, output_tokens: 100_000 } }
  ];
  const tracker = createCostTracker({ fetch: async () => jsonResponse(replies.shift()) });
  for (let i = 0; i < 3; i += 1) await tracker.fetch("https://api.openai.com/v1/responses", { method: "POST", body: JSON.stringify({ model: "gpt-6.1-terra" }) });

  const costs = tracker.summary();
  assert.equal(costs.complete, true);
  assert.deepEqual(costs.warnings, []);
  const [plain, cached, long] = costs.line_items;
  assert.equal(plain.estimated_usd, .772); // at the 272K line: $1 in + $5 out per 1M
  assert.equal(cached.estimated_usd, .13); // 100K cached at $0.05 + 100K written at $1.25
  assert.equal(long.estimated_usd, 1.35); // over 272K input: $2 in + $7.50 out
  assert.match(long.note, /272K/);
  for (const item of costs.line_items) {
    assert.equal(item.fallback, false);
    assert.equal(item.provider, "openai");
    assert.equal(item.pricing.source, "https://developers.openai.com/api/docs/pricing");
  }
  assert.equal(plain.usage.input_tokens, 272_000);
  // 100K in + 100K out, short context.
  assert.equal(estimateOpenAiUsageCost("gpt-6.1-sol", { input_tokens: 100_000, output_tokens: 100_000 }).estimated_usd, 1.2);
  assert.equal(estimateOpenAiUsageCost("gpt-6-luna", { input_tokens: 100_000, output_tokens: 100_000 }).estimated_usd, .06);
  assert.equal(estimateOpenAiUsageCost("gpt-6-sol", { input_tokens: 100_000, output_tokens: 0, cached_tokens: 100_000 }).estimated_usd, .02);
  assert.equal(estimateOpenAiUsageCost("gpt-6-astra", { input_tokens: 100_000, output_tokens: 100_000 }).estimated_usd, 6);
  // No gpt-6.1-luna is published: it stays an estimate.
  assert.equal(estimateOpenAiUsageCost("gpt-6.1-luna", { input_tokens: 1, output_tokens: 1 }).fallback, true);
});

test("prices the Claude 5.x models at their published rates, Haiku's long prompts included", async () => {
  const usage = { input_tokens: 1_000_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1_000_000 };
  const models = ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
  const replies = [
    ...models.map((model, index) => ({ id: `msg_${index}`, type: "message", model, usage })),
    { id: "msg_cache", type: "message", model: "claude-opus-5-5", usage: { input_tokens: 0, cache_creation_input_tokens: 2_000_000, cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 1_000_000 }, cache_read_input_tokens: 1_000_000, output_tokens: 0 } },
    { id: "msg_haiku_short", type: "message", model: "claude-haiku-5-5", usage: { input_tokens: 100_000, output_tokens: 0 } }
  ];
  const tracker = createCostTracker({ fetch: async () => jsonResponse(replies.shift()) });
  for (let i = 0; i < 6; i += 1) await tracker.fetch("https://api.anthropic.com/v1/messages", { method: "POST", body: "{}" });

  const costs = tracker.summary();
  assert.equal(costs.complete, true);
  assert.deepEqual(costs.line_items.map((item) => [item.model, item.estimated_usd, item.fallback]), [
    ["claude-fable-5-1", 60, false], // $10 in + $50 out
    ["claude-opus-5-5", 24, false], // $4 + $20
    ["claude-sonnet-5-5", 12, false], // $2 + $10
    ["claude-haiku-5-5", 3, false], // a 1M prompt is over 100K: $0.50 + $2.50
    ["claude-opus-5-5", 13.2, false], // $5 (5m write) + $8 (1h write) + $0.20 (read)
    ["claude-haiku-5-5", .01, false] // exactly 100K: $0.10 per 1M
  ]);
  assert.match(costs.line_items[3].note, /100K/);
  assert.equal(costs.line_items[0].pricing.source, "https://platform.claude.com/docs/en/about-claude/pricing");
  assert.equal(estimateModelUsageCost("anthropic", "anthropic/claude-sonnet-5-5", { input_tokens: 0, output_tokens: 0, cached_tokens: 1_000_000 }).estimated_usd, .1);
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
  assert.equal(costs.total_usd, 15); // $10 in + $5 out at the gpt-6-astra rate
  assert.equal(costs.by_provider.openai.fallback_calls, 1);
  assert.equal(costs.line_items[0].pricing.fallback, true);
  assert.equal(costs.line_items[0].fallback, true);
  assert.match(costs.warnings[0], /gpt-future.*highest standard OpenAI rate/);
});

test("itemises research web searches: Brave, Tavily and Serper", async () => {
  const replies = [{ web: { results: [] } }, { results: [] }, { results: [], usage: { credits: 2 } }, { organic: [] }];
  const tracker = createCostTracker({ fetch: async () => jsonResponse(replies.shift()) });
  await tracker.fetch("https://api.search.brave.com/res/v1/web/search?q=launch&count=5", { headers: { accept: "application/json" } });
  await tracker.fetch("https://api.tavily.com/search", { method: "POST", body: JSON.stringify({ query: "launch", max_results: 5 }) });
  await tracker.fetch("https://api.tavily.com/search", { method: "POST", body: JSON.stringify({ query: "launch", search_depth: "advanced" }) });
  await tracker.fetch("https://google.serper.dev/search", { method: "POST", body: JSON.stringify({ q: "launch", num: 5 }) });

  const costs = tracker.summary();
  assert.equal(costs.complete, true);
  assert.deepEqual(costs.line_items.map((item) => [item.provider, item.product, item.model, item.usage, item.estimated_usd, item.fallback]), [
    ["brave", "web-search", "web-search", { requests: 1 }, .005, false],
    ["tavily", "web-search", "search-basic", { requests: 1, credits: 1 }, .008, false],
    ["tavily", "web-search", "search-advanced", { requests: 1, credits: 2 }, .016, false],
    ["serper", "web-search", "google-search", { requests: 1 }, .001, false]
  ]);
  assert.equal(costs.total_usd, .03);
});

test("the spending limit stops a new web search, GET included", async () => {
  const tracker = createCostTracker({ limitUsd: .004, fetch: async () => jsonResponse({ web: { results: [] } }) });
  const search = () => tracker.fetch("https://api.search.brave.com/res/v1/web/search?q=launch");
  await search();
  await assert.rejects(search, (error) => error.code === "LAUNCHCLIP_COST_LIMIT");
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
    ["openrouter", "openai/gpt-5.6-terra", 5.8], // over 272K input: $4 in + $1.80 out at the long-context rate
    ["openrouter", "anthropic/claude-opus-4-8", 4.2],
    ["openrouter", "acme/mystery-1", 10] // unknown vendor model: the OpenAI fallback rate
  ]);
});

test("the spending limit stops new OpenRouter calls and counts fallback-priced ones", async () => {
  const tracker = createCostTracker({
    limitUsd: 1,
    fetch: async () => jsonResponse({ id: `gen-${Math.random()}`, model: "openai/gpt-new", choices: [{}], usage: { prompt_tokens: 300_000, completion_tokens: 0 } })
  });
  const post = () => tracker.fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", body: "{}" });
  await post(); // $3 at the fallback rate
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

// A provider whose answers stay open until the test releases them, so calls are really in flight together.
function heldProvider(answer) {
  const open = [];
  let inFlight = 0;
  let peak = 0;
  const fetch = async (url, init) => {
    const index = open.length;
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => open.push(resolve));
    inFlight -= 1;
    return jsonResponse(answer({ url: String(url), init, index }));
  };
  // Answers the oldest open call; false when none is open.
  const release = async () => {
    await settle();
    const next = open.findIndex(Boolean);
    if (next < 0) return false;
    open[next]();
    open[next] = null;
    await settle();
    return true;
  };
  return { fetch, release, peak: () => peak, started: () => open.length };
}

const settle = async () => { for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setImmediate(resolve)); };
// One model call: asks for up to 20,000 output tokens and uses them all, $0.24 at gpt-5.6-terra's rate (at most $0.36 at its long-context rate).
const terraCall = (tracker) => tracker.fetch("https://api.openai.com/v1/chat/completions", { method: "POST", body: JSON.stringify({ model: "gpt-5.6-terra", max_completion_tokens: 20_000, messages: [] }) });
const terraAnswer = ({ index }) => ({ id: `chat_${index}`, model: "gpt-5.6-terra", choices: [{}], usage: { prompt_tokens: 0, completion_tokens: 20_000 } });
const outcome = (results) => results.map((result) => (result.status === "fulfilled" ? "paid" : result.reason.code));

test("the spending limit holds when calls overlap: six calls at once spend exactly what six calls in a row spend", async () => {
  // In a row: five calls run ($0.24 each; the fifth starts at $0.96, under the $1.00 limit) and the sixth is refused.
  const inRow = createCostTracker({ limitUsd: 1, fetch: async (url, init) => jsonResponse(terraAnswer({ index: JSON.parse(init.body).n ?? Math.random() })) });
  const sequential = [];
  for (let call = 0; call < 6; call += 1) sequential.push(await terraCall(inRow).then(() => ({ status: "fulfilled" }), (reason) => ({ status: "rejected", reason })));
  assert.deepEqual(outcome(sequential), ["paid", "paid", "paid", "paid", "paid", "LAUNCHCLIP_COST_LIMIT"]);
  assert.equal(inRow.summary().total_usd, 1.2);

  // At once: every call is asked for before any answers.
  const provider = heldProvider(terraAnswer);
  const tracker = createCostTracker({ limitUsd: 1, fetch: provider.fetch });
  const calls = Promise.allSettled(Array.from({ length: 6 }, () => terraCall(tracker)));
  await settle();
  assert.equal(provider.started(), 2, "two fit under the limit at their most ($0.72); a third ($1.08) waits");
  while (await provider.release()) { /* answer them one by one */ }
  assert.deepEqual(outcome(await calls), outcome(sequential));
  assert.equal(tracker.summary().total_usd, inRow.summary().total_usd, "no more is spent because calls were in flight together");
  assert.equal(tracker.summary().calls, 5);
  assert.equal(provider.peak(), 2);
  assert.equal(tracker.limitError().code, "LAUNCHCLIP_COST_LIMIT");
});

test("far from the limit, or with none, nothing is held back: all the calls are in flight together", async () => {
  // Far from the limit nothing waits: all six are in flight together.
  const provider = heldProvider(terraAnswer);
  const tracker = createCostTracker({ limitUsd: 50, fetch: provider.fetch });
  const calls = Promise.allSettled(Array.from({ length: 6 }, () => terraCall(tracker)));
  await settle();
  assert.equal(provider.started(), 6);
  while (await provider.release()) { /* answer them */ }
  assert.deepEqual(outcome(await calls), Array(6).fill("paid"));
  assert.equal(tracker.summary().total_usd, 1.44);
  // No limit at all: nothing is held back either.
  const free = heldProvider(terraAnswer);
  const unlimited = createCostTracker({ limitUsd: null, fetch: free.fetch });
  const more = Promise.allSettled(Array.from({ length: 3 }, () => terraCall(unlimited)));
  await settle();
  assert.equal(free.started(), 3);
  while (await free.release()) { /* answer them */ }
  await more;
});

test("waiting calls start in the order asked, and a failed call frees its share", async () => {
  const order = [];
  const provider = heldProvider(({ init, index }) => { order.push(JSON.parse(init.body).tag); return index === 0 ? { error: "no usage: an answer that is not a completion" } : terraAnswer({ index }); });
  const tracker = createCostTracker({ limitUsd: .5, fetch: provider.fetch });
  const call = (tag) => tracker.fetch("https://api.openai.com/v1/chat/completions", { method: "POST", body: JSON.stringify({ model: "gpt-5.6-terra", max_completion_tokens: 20_000, tag }) });
  const calls = Promise.allSettled(["a", "b", "c"].map(call));
  await settle();
  assert.equal(provider.started(), 1, "$0.36 twice does not fit under $0.50");
  while (await provider.release()) { /* answer them */ }
  assert.deepEqual(order, ["a", "b", "c"]);
  // a cost nothing, so its share was freed and b ($0.24) and c ($0.48) both ran, one at a time.
  assert.deepEqual(outcome(await calls), ["paid", "paid", "paid"]);
  assert.equal(tracker.summary().total_usd, .48);
  assert.equal(provider.peak(), 1);
});

test("a background response holds its share of the limit until a poll sees it finish", async () => {
  const sent = [];
  let finished = false;
  const tracker = createCostTracker({
    limitUsd: .5,
    fetch: async (url, init) => {
      sent.push(`${init?.method ?? "GET"} ${String(url).split("/v1/")[1]}`);
      if (init?.method === "POST") return jsonResponse({ id: `resp_${sent.filter((entry) => entry.startsWith("POST")).length}`, status: "queued", model: "gpt-5.6-terra" });
      return jsonResponse(finished ? { id: "resp_1", status: "completed", model: "gpt-5.6-terra", usage: { input_tokens: 0, output_tokens: 20_000 } } : { id: "resp_1", status: "in_progress", model: "gpt-5.6-terra" });
    }
  });
  const post = () => tracker.fetch("https://api.openai.com/v1/responses", { method: "POST", body: JSON.stringify({ model: "gpt-5.6-terra", max_output_tokens: 20_000, background: true }) });
  await post();
  let second = "waiting";
  const next = post().then(() => { second = "started"; });
  await tracker.fetch("https://api.openai.com/v1/responses/resp_1", { method: "GET" });
  await settle();
  assert.equal(second, "waiting", "the first response is still running and unpaid: $0.36 twice does not fit under $0.50");
  finished = true;
  await tracker.fetch("https://api.openai.com/v1/responses/resp_1", { method: "GET" });
  await next;
  assert.equal(second, "started");
  assert.equal(tracker.summary().total_usd, .24);
  assert.deepEqual(sent, ["POST responses", "GET responses/resp_1", "GET responses/resp_1", "POST responses"]);
});

test("the most a request can cost is read from the request alone", () => {
  const post = (url, json, body = JSON.stringify(json)) => ({ url, json, bytes: body == null ? null : Buffer.byteLength(body) });
  const bound = (value) => Math.round(value * 1e6) / 1e6;
  // 20,000 output tokens at the long-context rate ($18), and the body's bytes as input at the highest input rate ($5 cache write).
  const terra = post("https://api.openai.com/v1/chat/completions", { model: "gpt-5.6-terra", max_completion_tokens: 20_000, messages: [] });
  assert.equal(bound(costBound(terra)), bound((terra.bytes * 5 + 20_000 * 18) / 1e6));
  // An attached image counts as 5,000 tokens, not as its megabyte of base64.
  const image = `data:image/png;base64,${"A".repeat(1_000_000)}`;
  const withImage = post("https://api.anthropic.com/v1/messages", { model: "claude-opus-4-8", max_tokens: 6000, messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "B".repeat(500_000) } }, { type: "text", text: image }] }] });
  assert.ok(costBound(withImage) < .4, `two images and 6,000 output tokens on Opus stay well under a dollar; got ${costBound(withImage)}`);
  assert.ok(costBound(withImage) > 6000 * 25 / 1e6);
  // No stated output limit: the most any listed model writes. An unknown model: the vendor's highest rates.
  const mystery = post("https://api.openai.com/v1/responses", { model: "gpt-9-mystery" });
  assert.equal(bound(costBound(mystery)), bound((mystery.bytes * 12.5 + 128_000 * 50) / 1e6));
  // An OpenRouter route is bounded at its vendor's rates (Haiku 5.5's long-prompt ones: $1 cache write, $2.50 output).
  const routed = post("https://openrouter.ai/api/v1/chat/completions", { model: "anthropic/claude-haiku-5-5", max_tokens: 1000 });
  assert.equal(bound(costBound(routed)), bound((routed.bytes * 1 + 1000 * 2.5) / 1e6));
  // Speech, music and searches are priced from the request; a transcription is not, so it runs alone.
  assert.equal(costBound(post("https://api.elevenlabs.io/v1/text-to-speech/voice", { text: "x".repeat(2000), model_id: "eleven_v3" })), .2);
  assert.equal(costBound(post("https://api.elevenlabs.io/v1/music", { music_length_ms: 60_000 })), .15);
  assert.equal(costBound(post("https://api.elevenlabs.io/v1/speech-to-text", null, null)), Infinity);
  assert.equal(costBound(post("https://api.tavily.com/search", { query: "x" })), .016);
  assert.equal(costBound({ url: "https://api.search.brave.com/res/v1/web/search?q=x", json: null, bytes: 0 }), .005);
  // A model call whose body cannot be read is not bounded.
  assert.equal(costBound(post("https://api.openai.com/v1/audio/transcriptions", null, null)), Infinity);
});

test("a call that nothing bounds waits to run alone, and nothing starts beside it", async () => {
  const provider = heldProvider(({ url }) => (url.includes("speech-to-text") ? { words: [{ end: 3600 }] } : terraAnswer({ index: 1 })));
  const tracker = createCostTracker({ limitUsd: 50, fetch: provider.fetch });
  const transcribe = () => tracker.fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", body: new FormData() });
  const calls = Promise.allSettled([terraCall(tracker), transcribe(), terraCall(tracker)]);
  await settle();
  assert.equal(provider.started(), 1, "the transcription waits for the model call");
  await provider.release();
  assert.equal(provider.started(), 2, "then runs alone: the model call behind it waits");
  while (await provider.release()) { /* answer them */ }
  assert.deepEqual(outcome(await calls), ["paid", "paid", "paid"]);
  assert.equal(provider.peak(), 1);
});

function jsonResponse(value, headers = {}) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json", ...headers } });
}

function binaryResponse(headers = {}) {
  return new Response(Buffer.from("audio"), { status: 200, headers });
}
