const PRICING_AS_OF = "2026-07-13";

const SOURCES = {
  openai: "https://developers.openai.com/api/docs/models",
  anthropic: "https://www.anthropic.com/news/claude-opus-4-8",
  elevenlabs: "https://elevenlabs.io/pricing/api"
};

const OPENAI_RATES = [
  { pattern: /^gpt-5\.6-terra(?:-|$)/, input: 2.5, cached: .25, cacheWrite: 3.125, output: 15 },
  { pattern: /^gpt-5\.6-luna(?:-|$)/, input: 1, cached: .1, cacheWrite: 1.25, output: 6 },
  { pattern: /^gpt-5\.6(?:-sol)?(?:-|$)/, input: 5, cached: .5, cacheWrite: 6.25, output: 30 },
  { pattern: /^gpt-5\.5-pro(?:-|$)/, input: 30, cached: null, cacheWrite: null, output: 180 },
  { pattern: /^gpt-5\.5(?:-|$)/, input: 5, cached: .5, cacheWrite: 6.25, output: 30 }
];

const ANTHROPIC_RATES = [
  { pattern: /^claude-opus-4-8(?:-|$)/, input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cached: .5, output: 25 }
];

export function createCostTracker(options = {}) {
  const originalFetch = options.fetch ?? globalThis.fetch;
  if (typeof originalFetch !== "function") throw new Error("Cost tracking requires fetch");
  const items = [];
  const seen = new Set();
  let anonymousId = 0;

  async function trackedFetch(input, init) {
    const request = await describeRequest(input, init);
    const response = await originalFetch(input, init);
    if (!response?.ok) return response;
    try {
      const item = await lineItemFor(request, response);
      if (item) {
        const key = item.request_id ? `${item.provider}:${item.request_id}` : `${item.provider}:anonymous:${anonymousId++}`;
        if (!seen.has(key)) {
          seen.add(key);
          items.push(item);
        }
      }
    } catch (error) {
      items.push(unpricedItem({
        provider: providerForUrl(request.url),
        product: "unclassified-api-call",
        model: request.json?.model ?? request.form?.model_id ?? null,
        requestId: null,
        warning: `Cost classification failed: ${String(error?.message ?? error)}`
      }));
    }
    return response;
  }

  return {
    fetch: trackedFetch,
    summary: () => summarize(items),
    lineItems: () => structuredClone(items)
  };
}

export function estimateOpenAiUsageCost(model, usage = {}) {
  const item = openAiLineItem(
    { json: { model: String(model ?? "unknown") } },
    { status: "completed", model: String(model ?? "unknown"), usage }
  );
  return {
    estimated_usd: item.estimated_usd,
    complete: item.estimated_usd != null,
    warning: item.warning ?? null,
    pricing: item.pricing ?? null
  };
}

async function describeRequest(input, init = {}) {
  const url = String(typeof input === "string" || input instanceof URL ? input : input?.url ?? "");
  const body = init?.body;
  let json = null;
  let form = null;
  if (typeof body === "string") json = parseJson(body);
  else if (isFormData(body)) form = Object.fromEntries([...body.entries()].filter(([, value]) => typeof value === "string"));
  else if (!body && input && typeof input !== "string" && !(input instanceof URL) && typeof input.clone === "function") {
    const contentType = input.headers?.get?.("content-type") ?? "";
    if (contentType.includes("application/json")) json = parseJson(await input.clone().text());
  }
  return { url, json, form };
}

async function lineItemFor(request, response) {
  const url = new URL(request.url);
  if (isOpenAi(url)) return openAiLineItem(request, await responseJson(response));
  if (isAnthropic(url)) return anthropicLineItem(request, await responseJson(response));
  if (isElevenLabs(url)) return elevenLabsLineItem(url, request, response);
  return null;
}

function openAiLineItem(request, payload) {
  const usage = payload?.usage;
  const completed = payload?.status === "completed" || Array.isArray(payload?.choices);
  if (!usage && !completed) return null;
  const model = String(payload?.model ?? request.json?.model ?? "unknown");
  const normalized = normalizeOpenAiUsage(usage);
  const rates = OPENAI_RATES.find((entry) => entry.pattern.test(model));
  if (!rates) return unpricedItem({ provider: "openai", product: "llm", model, requestId: payload?.id, usage: normalized, warning: `No public PAYG rate is configured for OpenAI model ${model}` });

  const uncached = Math.max(0, normalized.input_tokens - normalized.cached_input_tokens - normalized.cache_write_input_tokens);
  const cachedCost = rates.cached == null && normalized.cached_input_tokens > 0 ? null : normalized.cached_input_tokens * Number(rates.cached ?? 0);
  const writeCost = rates.cacheWrite == null && normalized.cache_write_input_tokens > 0 ? null : normalized.cache_write_input_tokens * Number(rates.cacheWrite ?? 0);
  if (cachedCost == null || writeCost == null) {
    return unpricedItem({ provider: "openai", product: "llm", model, requestId: payload?.id, usage: normalized, warning: `OpenAI model ${model} returned cache usage without a configured cache rate` });
  }
  let cost = (uncached * rates.input + cachedCost + writeCost + normalized.output_tokens * rates.output) / 1_000_000;
  let note = null;
  if (/^gpt-5\.5(?:-|$)/.test(model) && normalized.input_tokens > 272_000) {
    cost = (uncached * rates.input * 2 + cachedCost * 2 + writeCost * 2 + normalized.output_tokens * rates.output * 1.5) / 1_000_000;
    note = "GPT-5.5 long-context multiplier applied because input exceeded 272K tokens.";
  }
  return pricedItem({
    provider: "openai", product: "llm", model, requestId: payload?.id, usage: normalized, cost,
    rates: { unit: "USD per 1M tokens", input: rates.input, cached_input: rates.cached, cache_write: rates.cacheWrite, output: rates.output },
    source: SOURCES.openai, note
  });
}

function anthropicLineItem(request, payload) {
  if (!payload?.usage && payload?.type !== "message") return null;
  const model = String(payload?.model ?? request.json?.model ?? "unknown");
  const normalized = normalizeAnthropicUsage(payload?.usage);
  const rates = ANTHROPIC_RATES.find((entry) => entry.pattern.test(model));
  if (!rates) return unpricedItem({ provider: "anthropic", product: "llm", model, requestId: payload?.id, usage: normalized, warning: `No public PAYG rate is configured for Anthropic model ${model}` });
  const cost = (
    normalized.input_tokens * rates.input
    + normalized.cache_write_5m_tokens * rates.cacheWrite5m
    + normalized.cache_write_1h_tokens * rates.cacheWrite1h
    + normalized.cache_write_unspecified_tokens * rates.cacheWrite5m
    + normalized.cached_input_tokens * rates.cached
    + normalized.output_tokens * rates.output
  ) / 1_000_000;
  return pricedItem({
    provider: "anthropic", product: "llm", model, requestId: payload?.id, usage: normalized, cost,
    rates: { unit: "USD per 1M tokens", input: rates.input, cache_write_5m: rates.cacheWrite5m, cache_write_1h: rates.cacheWrite1h, cached_input: rates.cached, output: rates.output },
    source: SOURCES.anthropic
  });
}

async function elevenLabsLineItem(url, request, response) {
  const requestId = response.headers?.get?.("request-id") ?? response.headers?.get?.("x-request-id") ?? null;
  const model = String(request.json?.model_id ?? request.form?.model_id ?? "unknown");
  if (/\/text-to-speech\//.test(url.pathname)) {
    const characters = [...String(request.json?.text ?? "")].length;
    const rate = /(?:flash|turbo)/i.test(model) ? .05 : /(?:multilingual|eleven_v3|v3)/i.test(model) ? .1 : null;
    if (rate == null) return unpricedItem({ provider: "elevenlabs", product: "text-to-speech", model, requestId, usage: { characters }, warning: `No public PAYG rate is configured for ElevenLabs TTS model ${model}` });
    return pricedItem({ provider: "elevenlabs", product: "text-to-speech", model, requestId, usage: { characters }, cost: characters / 1_000 * rate, rates: { unit: "USD per 1K characters", text_to_speech: rate }, source: SOURCES.elevenlabs });
  }
  if (url.pathname.endsWith("/speech-to-text")) {
    const payload = await responseJson(response);
    const audioSeconds = maximumWordEnd(payload?.words);
    if (!(audioSeconds > 0)) return unpricedItem({ provider: "elevenlabs", product: "transcription", model, requestId, usage: { audio_seconds: null }, warning: "ElevenLabs transcription response did not expose enough timing data to estimate audio duration" });
    const rate = /^scribe_v[12](?:$|_)/.test(model) ? .22 : /realtime/.test(model) ? .39 : null;
    if (rate == null) return unpricedItem({ provider: "elevenlabs", product: "transcription", model, requestId, usage: { audio_seconds: audioSeconds }, warning: `No public PAYG rate is configured for ElevenLabs transcription model ${model}` });
    return pricedItem({ provider: "elevenlabs", product: "transcription", model, requestId, usage: { audio_seconds: audioSeconds }, cost: audioSeconds / 3_600 * rate, rates: { unit: "USD per audio hour", transcription: rate }, source: SOURCES.elevenlabs, note: "Audio duration is estimated from the final timestamp returned by Scribe." });
  }
  if (url.pathname.endsWith("/music")) {
    const generatedSeconds = Number(request.json?.music_length_ms ?? 0) / 1_000;
    return pricedItem({ provider: "elevenlabs", product: "music-generation", model, requestId, usage: { generated_seconds: generatedSeconds }, cost: generatedSeconds / 60 * .15, rates: { unit: "USD per generated minute", music_generation: .15 }, source: SOURCES.elevenlabs });
  }
  return unpricedItem({ provider: "elevenlabs", product: url.pathname, model, requestId, warning: `No cost classifier is configured for ElevenLabs endpoint ${url.pathname}` });
}

function normalizeOpenAiUsage(usage = {}) {
  const input = finite(usage.input_tokens ?? usage.prompt_tokens);
  const output = finite(usage.output_tokens ?? usage.completion_tokens);
  const inputDetails = usage.input_tokens_details ?? usage.prompt_tokens_details ?? {};
  const outputDetails = usage.output_tokens_details ?? usage.completion_tokens_details ?? {};
  return {
    input_tokens: input,
    cached_input_tokens: finite(inputDetails.cached_tokens ?? usage.cached_tokens),
    cache_write_input_tokens: finite(inputDetails.cache_write_tokens ?? usage.cache_write_tokens),
    output_tokens: output,
    reasoning_tokens: finite(outputDetails.reasoning_tokens ?? usage.reasoning_tokens),
    total_tokens: finite(usage.total_tokens || input + output)
  };
}

function normalizeAnthropicUsage(usage = {}) {
  const cacheCreation = finite(usage.cache_creation_input_tokens);
  const cacheWrite5m = finite(usage.cache_creation?.ephemeral_5m_input_tokens);
  const cacheWrite1h = finite(usage.cache_creation?.ephemeral_1h_input_tokens);
  return {
    input_tokens: finite(usage.input_tokens),
    cached_input_tokens: finite(usage.cache_read_input_tokens),
    cache_write_5m_tokens: cacheWrite5m,
    cache_write_1h_tokens: cacheWrite1h,
    cache_write_unspecified_tokens: Math.max(0, cacheCreation - cacheWrite5m - cacheWrite1h),
    output_tokens: finite(usage.output_tokens)
  };
}

function pricedItem({ provider, product, model, requestId, usage, cost, rates, source, note = null }) {
  return {
    provider, product, model, request_id: requestId ?? null, usage: usage ?? {},
    estimated_usd: roundMoney(cost), pricing: { ...rates, as_of: PRICING_AS_OF, source },
    ...(note ? { note } : {})
  };
}

function unpricedItem({ provider, product, model, requestId, usage = {}, warning }) {
  return { provider: provider ?? "unknown", product, model: model ?? null, request_id: requestId ?? null, usage, estimated_usd: null, pricing: null, warning };
}

function summarize(items) {
  const providers = {};
  const warnings = [];
  let total = 0;
  for (const item of items) {
    const provider = providers[item.provider] ??= { calls: 0, estimated_usd: 0, unpriced_calls: 0 };
    provider.calls += 1;
    if (item.estimated_usd == null) {
      provider.unpriced_calls += 1;
      warnings.push(item.warning);
    } else {
      total += item.estimated_usd;
      provider.estimated_usd += item.estimated_usd;
    }
  }
  for (const provider of Object.values(providers)) provider.estimated_usd = roundMoney(provider.estimated_usd);
  return {
    schema_version: "launchclip.costs.v1",
    currency: "USD",
    pricing_basis: "public-pay-as-you-go-estimate",
    pricing_as_of: PRICING_AS_OF,
    total_usd: roundMoney(total),
    complete: warnings.length === 0,
    calls: items.length,
    by_provider: providers,
    line_items: structuredClone(items),
    warnings: [...new Set(warnings)]
  };
}

async function responseJson(response) {
  const clone = response?.clone?.();
  if (!clone) return null;
  try { return await clone.json(); } catch { return null; }
}

function maximumWordEnd(words) {
  return roundUnit(Math.max(0, ...(words ?? []).map((entry) => finite(entry?.end))));
}

function isFormData(value) {
  return typeof FormData !== "undefined" && value instanceof FormData;
}

function isOpenAi(url) { return /(^|\.)openai\.com$/i.test(url.hostname); }
function isAnthropic(url) { return /(^|\.)anthropic\.com$/i.test(url.hostname); }
function isElevenLabs(url) { return /(^|\.)elevenlabs\.io$/i.test(url.hostname); }

function providerForUrl(value) {
  try {
    const url = new URL(value);
    if (isOpenAi(url)) return "openai";
    if (isAnthropic(url)) return "anthropic";
    if (isElevenLabs(url)) return "elevenlabs";
  } catch {}
  return "unknown";
}

function parseJson(value) {
  try { return JSON.parse(value); } catch { return null; }
}

function finite(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function roundMoney(value) { return Math.round(Number(value) * 100_000_000) / 100_000_000; }
function roundUnit(value) { return Math.round(Number(value) * 1_000) / 1_000; }
