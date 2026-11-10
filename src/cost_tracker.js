const PRICING_AS_OF = "2026-11-03";

const SOURCES = {
  openai: "https://developers.openai.com/api/docs/models",
  openaiPricing: "https://developers.openai.com/api/docs/pricing",
  anthropic: "https://www.anthropic.com/news/claude-opus-4-8",
  anthropicPricing: "https://platform.claude.com/docs/en/about-claude/pricing",
  elevenlabs: "https://elevenlabs.io/pricing/api",
  brave: "https://brave.com/search/api/",
  tavily: "https://docs.tavily.com/documentation/api-credits",
  serper: "https://serper.dev/"
};

// Web search, USD per request (Tavily: per credit). Brave's Search plan;
// Tavily's pay-as-you-go credit (a basic search is 1 credit, advanced 2);
// Serper's smallest top-up pack (Starter, $1.00 per 1K queries), the highest
// per-query rate it sells. Free monthly allowances are not subtracted.
const WEB_SEARCH_RATES = { brave: .005, tavily: .008, serper: .001 };

// USD per 1M tokens, Standard tier. cacheWrite is OpenAI's 30-minute cache
// write. A longContext entry replaces every rate once a request's input passes
// its threshold (OpenAI: more than 272K input tokens).
const OPENAI_RATES = [
  { pattern: /^gpt-6\.1-terra(?:-|$)/, input: 1, cached: .05, cacheWrite: 1.25, output: 5, longContext: { above: 272_000, input: 2, cached: .1, cacheWrite: 2.5, output: 7.5 }, source: SOURCES.openaiPricing },
  { pattern: /^gpt-6\.1-sol(?:-|$)/, input: 2, cached: .1, cacheWrite: 2.5, output: 10, longContext: { above: 272_000, input: 4, cached: .2, cacheWrite: 5, output: 15 }, source: SOURCES.openaiPricing },
  { pattern: /^gpt-6-astra(?!-law)(?:-|$)/, input: 10, cached: 1, cacheWrite: 12.5, output: 50, longContext: { above: 272_000, input: 20, cached: 2, cacheWrite: 25, output: 75 }, source: SOURCES.openaiPricing },
  { pattern: /^gpt-6-sol(?:-|$)/, input: 2, cached: .2, cacheWrite: 2.5, output: 10, longContext: { above: 272_000, input: 4, cached: .4, cacheWrite: 5, output: 15 }, source: SOURCES.openaiPricing },
  { pattern: /^gpt-6-luna(?:-|$)/, input: .1, cached: .01, cacheWrite: .125, output: .5, longContext: { above: 272_000, input: .2, cached: .02, cacheWrite: .25, output: .75 }, source: SOURCES.openaiPricing },
  { pattern: /^gpt-5\.6-terra(?:-|$)/, input: 2, cached: .2, cacheWrite: 2.5, output: 12, longContext: { above: 272_000, input: 4, cached: .4, cacheWrite: 5, output: 18 }, source: SOURCES.openaiPricing },
  { pattern: /^gpt-5\.6-luna(?:-|$)/, input: .2, cached: .02, cacheWrite: .25, output: 1.2, longContext: { above: 272_000, input: .4, cached: .04, cacheWrite: .5, output: 1.8 }, source: SOURCES.openaiPricing },
  { pattern: /^gpt-5\.6(?:-sol)?(?:-|$)/, input: 4, cached: .4, cacheWrite: 5, output: 20, longContext: { above: 272_000, input: 8, cached: .8, cacheWrite: 10, output: 30 }, source: SOURCES.openaiPricing },
  { pattern: /^gpt-5\.5-pro(?:-|$)/, input: 30, cached: null, cacheWrite: null, output: 180, longContext: { above: 272_000, input: 60, cached: null, cacheWrite: null, output: 270 } },
  { pattern: /^gpt-5\.5(?:-|$)/, input: 5, cached: .5, cacheWrite: 6.25, output: 30, longContext: { above: 272_000, input: 10, cached: 1, cacheWrite: 12.5, output: 45 } }
];

// A model missing from the tables above is still billed against the spending
// limit: at the highest standard rate its vendor publishes, flagged as an
// estimate, so a new or renamed model can never run the limit up unseen.
// OpenAI: gpt-6-astra. Anthropic: Claude Fable 5.1, with Claude Fable 5's
// cache-hit rate (the higher of the two).
const FALLBACK_RATES = {
  openai: { input: 10, cached: 1, cacheWrite: 12.5, output: 50 },
  anthropic: { input: 10, cacheWrite5m: 12.5, cacheWrite1h: 20, cached: 1, output: 50 }
};

// USD per 1M tokens. A longContext entry replaces every rate once the prompt
// (input, cache reads and cache writes together) passes its threshold.
const ANTHROPIC_RATES = [
  { pattern: /^claude-fable-5-1(?:-|$)/, input: 10, cacheWrite5m: 12.5, cacheWrite1h: 20, cached: .25, output: 50, source: SOURCES.anthropicPricing },
  { pattern: /^claude-opus-5-5(?:-|$)/, input: 4, cacheWrite5m: 5, cacheWrite1h: 8, cached: .2, output: 20, source: SOURCES.anthropicPricing },
  { pattern: /^claude-sonnet-5-5(?:-|$)/, input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cached: .1, output: 10, source: SOURCES.anthropicPricing },
  { pattern: /^claude-haiku-5-5(?:-|$)/, input: .1, cacheWrite5m: .125, cacheWrite1h: .2, cached: .01, output: .5, longContext: { above: 100_000, input: .5, cacheWrite5m: .625, cacheWrite1h: 1, cached: .05, output: 2.5 }, source: SOURCES.anthropicPricing },
  { pattern: /^claude-opus-4-8(?:-|$)/, input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cached: .5, output: 25 }
];

export const DEFAULT_MAX_COST_USD = 50;

// A response asking for more output than this is not expected from any listed
// model; a request that names no output limit is bounded by it.
const UNSTATED_OUTPUT_TOKENS = 128_000;
// No listed model reads one image as more tokens than this.
const IMAGE_TOKEN_BOUND = 5_000;
// A background response nothing has polled for this long was given up on.
const STALE_BACKGROUND_MS = 120_000;
const BACKGROUND_STATES = new Set(["queued", "in_progress"]);

/**
 * options: {fetch, limitUsd (null: no limit), now (ms; tests)}.
 *
 * The limit with calls in flight. A paid call is refused once the spending
 * has reached the limit, as before. A call that would start beside others
 * starts only when the most the calls in flight can still cost, plus the most
 * it can cost itself (costBound), fits under the limit; otherwise it waits,
 * in the order asked, until that is true or nothing else is in flight. So
 * overlapping calls can never take the total past the limit: the one way past
 * it is the last call of a run sent one at a time, by at most its own cost.
 */
export function createCostTracker(options = {}) {
  const originalFetch = options.fetch ?? globalThis.fetch;
  if (typeof originalFetch !== "function") throw new Error("Cost tracking requires fetch");
  const limitUsd = options.limitUsd ?? null;
  const now = options.now ?? (() => Date.now());
  let limitError = null;
  const items = [];
  const seen = new Set();
  let anonymousId = 0;
  // Paid calls in flight: token → {bound, id (a background response's, until it ends), seen}.
  const inFlight = new Map();
  const queue = [];
  let staleTimer = null;

  const spentUsd = () => summarize(items).total_usd;
  const heldUsd = () => [...inFlight.values()].reduce((sum, entry) => sum + entry.bound, 0);

  function pump() {
    for (const [token, entry] of inFlight) if (entry.id && now() - entry.seen > STALE_BACKGROUND_MS) inFlight.delete(token);
    while (queue.length) {
      const head = queue[0];
      const spent = spentUsd();
      if (spent >= limitUsd) {
        queue.shift();
        head.reject(limitError = costLimitError(spent, limitUsd));
        continue;
      }
      if (inFlight.size && spent + heldUsd() + head.bound > limitUsd) break;
      queue.shift();
      const token = Symbol("paid call");
      inFlight.set(token, { bound: head.bound, id: null, seen: now() });
      head.resolve(token);
    }
    // Only an abandoned background response can leave the queue waiting on nothing: look again when it goes stale.
    clearTimeout(staleTimer);
    staleTimer = queue.length && [...inFlight.values()].some((entry) => entry.id) ? setTimeout(pump, STALE_BACKGROUND_MS / 4) : null;
  }
  const admit = (bound) => new Promise((resolve, reject) => { queue.push({ bound, resolve, reject }); pump(); });
  const settle = (token) => { if (inFlight.delete(token)) pump(); };

  // An OpenAI background response is paid for when a later poll sees it end, so its share is held until then.
  // → the calls this answer ends (settled once its cost is counted).
  function watchBackground(token, payload) {
    if (limitUsd == null || !payload?.id) return [];
    if (token && BACKGROUND_STATES.has(payload.status)) {
      const entry = inFlight.get(token);
      if (entry) entry.id = String(payload.id);
      return [];
    }
    const ended = [];
    for (const [held, entry] of inFlight) {
      if (entry.id !== String(payload.id)) continue;
      entry.seen = now();
      if (!BACKGROUND_STATES.has(payload.status)) ended.push(held);
    }
    return ended;
  }

  async function trackedFetch(input, init) {
    const request = await describeRequest(input, init);
    // Only a POST to a paid provider starts new work; polling a background response must still finish it.
    // A web search is new paid work even as a GET (Brave).
    const gated = limitUsd != null && (requestMethod(input, init) === "POST" || isWebSearch(request.url)) && providerForUrl(request.url) !== "unknown";
    const token = gated ? await admit(costBound(request)) : null;
    let response;
    try {
      response = await originalFetch(input, init);
    } catch (error) {
      settle(token);
      throw error;
    }
    if (!response?.ok) {
      settle(token);
      return response;
    }
    // A streamed answer (server-sent events) is handed back at once and counted when its stream ends; its share of the limit is held until then.
    if (/text\/event-stream/i.test(response.headers?.get?.("content-type") ?? "")) {
      account(request, response, token).catch(() => {});
      return response;
    }
    await account(request, response, token);
    return response;
  }

  async function account(request, response, token) {
    let ended = [];
    try {
      const item = await lineItemFor(request, response, (payload) => { ended = watchBackground(token, payload); });
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
    // The call's cost is counted: its share is free, unless it is a background response still running.
    if (token && !inFlight.get(token)?.id) settle(token);
    for (const held of ended) settle(held);
  }

  return {
    fetch: trackedFetch,
    summary: () => summarize(items),
    // A caller may have caught the refusal and carried on (a fallback, a skipped critic), so the CLI checks here too.
    limitError: () => limitError,
    lineItems: () => structuredClone(items)
  };
}

/**
 * The most one paid request can add to the tally, in USD, from the request
 * alone: what lets calls overlap without passing the spending limit.
 * Infinity when nothing in the request bounds it (the call then runs alone).
 *
 * A model call is its whole body read as input tokens (a token is never less
 * than a byte; an attached image counts as IMAGE_TOKEN_BOUND) at the model's
 * highest input rate, plus the output it may ask for at its highest output
 * rate. An OpenRouter route that reports its own cost is bounded at the
 * vendor's rates, as the tally prices it when it reports none.
 */
export function costBound(request) {
  let url;
  try { url = new URL(request.url); } catch { return 0; }
  if (isOpenAi(url) || isOpenRouter(url) || isAnthropic(url)) {
    const model = String(request.json?.model ?? "unknown").replace(isOpenRouter(url) ? /^[^/]+\// : /^$/, "");
    const anthropic = isAnthropic(url) || (isOpenRouter(url) && (/^anthropic\//.test(String(request.json?.model ?? "")) || /^claude-/.test(model)));
    const known = (anthropic ? ANTHROPIC_RATES : OPENAI_RATES).find((entry) => entry.pattern.test(model)) ?? FALLBACK_RATES[anthropic ? "anthropic" : "openai"];
    const rates = known.longContext ?? known;
    const input = Math.max(rates.input, rates.cacheWrite ?? 0, rates.cacheWrite1h ?? 0, rates.cacheWrite5m ?? 0);
    const asked = Number(request.json?.max_output_tokens ?? request.json?.max_completion_tokens ?? request.json?.max_tokens);
    const output = Number.isFinite(asked) && asked > 0 ? asked : UNSTATED_OUTPUT_TOKENS;
    return (inputTokenBound(request) * input + output * rates.output) / 1_000_000;
  }
  if (isElevenLabs(url)) {
    if (/\/text-to-speech\//.test(url.pathname)) return [...String(request.json?.text ?? "")].length / 1_000 * .1;
    if (url.pathname.endsWith("/music")) {
      const sections = request.json?.composition_plan?.sections ?? request.json?.composition_plan?.chunks;
      const planMs = Array.isArray(sections) ? sections.reduce((sum, section) => sum + Number(section?.duration_ms ?? 0), 0) : 0;
      const seconds = Number(request.json?.music_length_ms ?? planMs) / 1_000;
      return Number.isFinite(seconds) ? seconds / 60 * .15 : Infinity;
    }
    // A transcription is priced from the audio's length, which the request does not state.
    if (url.pathname.endsWith("/speech-to-text")) return Infinity;
    return 0;
  }
  // A Tavily search is at most two credits (advanced); the others are one request.
  if (isTavily(url)) return 2 * WEB_SEARCH_RATES.tavily;
  if (isBrave(url)) return WEB_SEARCH_RATES.brave;
  if (isSerper(url)) return WEB_SEARCH_RATES.serper;
  return 0;
}

// The body's bytes, with each attached image counted as IMAGE_TOKEN_BOUND instead of its base64 text.
function inputTokenBound(request) {
  let saved = 0;
  const visit = (value, parent) => {
    if (typeof value === "string") {
      const image = /^data:image\//.test(value) || (parent?.type === "base64" && /^image\//.test(String(parent.media_type ?? "")));
      if (image && value.length > IMAGE_TOKEN_BOUND) saved += value.length - IMAGE_TOKEN_BOUND;
    } else if (Array.isArray(value)) for (const item of value) visit(item, value);
    else if (value && typeof value === "object") for (const item of Object.values(value)) visit(item, value);
  };
  if (request.bytes == null) return Infinity;
  visit(request.json, null);
  return Math.max(0, request.bytes - saved);
}

export function estimateOpenAiUsageCost(model, usage = {}) {
  const item = openAiLineItem(
    { json: { model: String(model ?? "unknown") } },
    { status: "completed", model: String(model ?? "unknown"), usage }
  );
  return {
    estimated_usd: item.estimated_usd,
    complete: item.estimated_usd != null,
    fallback: item.fallback,
    warning: item.warning ?? null,
    pricing: item.pricing ?? null
  };
}

// Estimate one LLM call from its normalized usage ({input_tokens,
// output_tokens, cached_tokens}) when the call did not pass through the
// tracked fetch (an SDK client, or a test). OpenRouter-style ids such as
// "openai/gpt-5.6-luna" or "anthropic/claude-opus-4-8" use the vendor's rates.
export function estimateModelUsageCost(provider, model, usage = {}) {
  const bare = String(model ?? "unknown").replace(/^(openai|anthropic)\//, "");
  const anthropic = provider === "anthropic" || /^claude-/.test(bare);
  // A router writes a Claude version with a dot ("claude-opus-5.5"); the rate table has the vendor's own id ("claude-opus-5-5").
  const name = anthropic ? bare.replace(/\./g, "-") : bare;
  const item = anthropic
    ? anthropicLineItem({ json: { model: name } }, {
      type: "message",
      model: name,
      usage: { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, cache_read_input_tokens: usage.cached_tokens ?? usage.cached_input_tokens ?? 0 }
    })
    : openAiLineItem({ json: { model: name } }, { status: "completed", model: name, usage });
  return {
    estimated_usd: item.estimated_usd,
    complete: item.estimated_usd != null,
    fallback: item.fallback,
    warning: item.warning ?? null
  };
}

// A runaway guard for one command: a call that started under the limit still finishes, so the total can pass it by that one call's cost (never by several in flight: createCostTracker).
function costLimitError(spent, limit) {
  const error = new Error(`API spending reached the $${limit.toFixed(2)} limit for this command ($${spent.toFixed(2)} so far), so no new paid call was started. Raise it with --max-cost-usd <amount> or LAUNCHCLIP_MAX_COST_USD, or pass none to remove it.`);
  error.code = "LAUNCHCLIP_COST_LIMIT";
  return error;
}

function requestMethod(input, init = {}) {
  return String(init?.method ?? (typeof input === "object" && !(input instanceof URL) ? input?.method : null) ?? "GET").toUpperCase();
}

export function isCostLimitError(error) {
  return error?.code === "LAUNCHCLIP_COST_LIMIT";
}

export function parseCostLimit(value) {
  if (value == null || value === "") return DEFAULT_MAX_COST_USD;
  if (String(value).trim().toLowerCase() === "none") return null;
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit <= 0) throw new Error(`Expected a positive dollar amount or none for --max-cost-usd, received ${value}`);
  return limit;
}

async function describeRequest(input, init = {}) {
  const url = String(typeof input === "string" || input instanceof URL ? input : input?.url ?? "");
  const body = init?.body;
  let json = null;
  let form = null;
  // bytes: the body's size, 0 with no body, null when it cannot be read here (a form, a stream).
  let bytes = body == null ? 0 : null;
  if (typeof body === "string") { json = parseJson(body); bytes = Buffer.byteLength(body); }
  else if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
    const text = Buffer.from(body).toString("utf8");
    json = parseJson(text);
    bytes = Buffer.byteLength(text);
  }
  else if (isFormData(body)) form = Object.fromEntries([...body.entries()].filter(([, value]) => typeof value === "string"));
  else if (!body && input && typeof input !== "string" && !(input instanceof URL) && typeof input.clone === "function") {
    const contentType = input.headers?.get?.("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const text = await input.clone().text();
      json = parseJson(text);
      bytes = Buffer.byteLength(text);
    }
  }
  return { url, json, form, bytes };
}

async function lineItemFor(request, response, onOpenAi = null) {
  const url = new URL(request.url);
  if (isOpenAi(url)) {
    const payload = await responseJson(response);
    onOpenAi?.(payload);
    return openAiLineItem(request, payload);
  }
  if (isOpenRouter(url)) return openRouterLineItem(request, await responseJson(response));
  if (isAnthropic(url)) return anthropicLineItem(request, await responseJson(response));
  if (isElevenLabs(url)) return elevenLabsLineItem(url, request, response);
  if (isWebSearch(url)) return webSearchLineItem(url, request, response);
  return null;
}

async function webSearchLineItem(url, request, response) {
  const provider = providerForUrl(url.href);
  const requestId = response.headers?.get?.("x-request-id") ?? response.headers?.get?.("request-id") ?? null;
  if (provider === "tavily") {
    const payload = await responseJson(response);
    const depth = String(request.json?.search_depth ?? "basic");
    const reported = Number(payload?.usage?.credits);
    const credits = Number.isFinite(reported) && reported > 0 ? reported : depth === "advanced" ? 2 : 1;
    return pricedItem({ provider, product: "web-search", model: `search-${depth}`, requestId: payload?.request_id ?? requestId, usage: { requests: 1, credits }, cost: credits * WEB_SEARCH_RATES.tavily, rates: { unit: "USD per credit", web_search: WEB_SEARCH_RATES.tavily }, source: SOURCES.tavily });
  }
  const model = provider === "brave" ? "web-search" : "google-search";
  return pricedItem({ provider, product: "web-search", model, requestId, usage: { requests: 1 }, cost: WEB_SEARCH_RATES[provider], rates: { unit: "USD per request", web_search: WEB_SEARCH_RATES[provider] }, source: SOURCES[provider] });
}

function openAiLineItem(request, payload) {
  const usage = payload?.usage;
  const completed = payload?.status === "completed" || Array.isArray(payload?.choices);
  if (!usage && !completed) return null;
  const model = String(payload?.model ?? request.json?.model ?? "unknown");
  const normalized = normalizeOpenAiUsage(usage);
  const known = OPENAI_RATES.find((entry) => entry.pattern.test(model));
  const fallback = known ? null : `No public PAYG rate is configured for OpenAI model ${model}; estimated at the highest standard OpenAI rate`;
  const long = known?.longContext && normalized.input_tokens > known.longContext.above ? known.longContext : null;
  const rates = long ?? known ?? FALLBACK_RATES.openai;

  const uncached = Math.max(0, normalized.input_tokens - normalized.cached_input_tokens - normalized.cache_write_input_tokens);
  const cachedCost = rates.cached == null && normalized.cached_input_tokens > 0 ? null : normalized.cached_input_tokens * Number(rates.cached ?? 0);
  const writeCost = rates.cacheWrite == null && normalized.cache_write_input_tokens > 0 ? null : normalized.cache_write_input_tokens * Number(rates.cacheWrite ?? 0);
  if (cachedCost == null || writeCost == null) {
    return unpricedItem({ provider: "openai", product: "llm", model, requestId: payload?.id, usage: normalized, warning: `OpenAI model ${model} returned cache usage without a configured cache rate` });
  }
  const cost = (uncached * rates.input + cachedCost + writeCost + normalized.output_tokens * rates.output) / 1_000_000;
  const note = long ? `Long-context rates applied because input exceeded ${Math.round(long.above / 1_000)}K tokens.` : null;
  return pricedItem({
    provider: "openai", product: "llm", model, requestId: payload?.id, usage: normalized, cost,
    rates: { unit: "USD per 1M tokens", input: rates.input, cached_input: rates.cached, cache_write: rates.cacheWrite, output: rates.output, ...(fallback ? { fallback: true } : {}) },
    source: known?.source ?? SOURCES.openai, note, warning: fallback, fallback: Boolean(fallback)
  });
}

// OpenRouter answers in the OpenAI shape with a vendor-prefixed model
// ("openai/gpt-5.6-terra", "anthropic/claude-opus-4-8"). Its own usage.cost
// (USD) wins; otherwise the vendor's rates (or the vendor fallback) apply.
function openRouterLineItem(request, payload) {
  if (!payload?.usage && !Array.isArray(payload?.choices)) return null;
  const model = String(payload?.model ?? request.json?.model ?? "unknown");
  const name = model.replace(/^[^/]+\//, "");
  const usage = normalizeOpenAiUsage(payload?.usage);
  const reported = Number(payload?.usage?.cost);
  if (payload?.usage?.cost != null && Number.isFinite(reported) && reported >= 0) {
    return pricedItem({ provider: "openrouter", product: "llm", model, requestId: payload?.id, usage, cost: reported, rates: { unit: "USD reported by OpenRouter" }, source: "https://openrouter.ai/docs/use-cases/usage-accounting" });
  }
  const anthropic = /^anthropic\//.test(model) || /^claude-/.test(name);
  const vendor = anthropic
    ? anthropicLineItem({ json: { model: name } }, { type: "message", model: name, usage: { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, cache_read_input_tokens: usage.cached_input_tokens } })
    : openAiLineItem({ json: { model: name } }, { status: "completed", model: name, usage: payload?.usage ?? {} });
  return { ...vendor, provider: "openrouter", model, request_id: payload?.id ?? null };
}

function anthropicLineItem(request, payload) {
  if (!payload?.usage && payload?.type !== "message") return null;
  const model = String(payload?.model ?? request.json?.model ?? "unknown");
  const normalized = normalizeAnthropicUsage(payload?.usage);
  const known = ANTHROPIC_RATES.find((entry) => entry.pattern.test(model));
  const fallback = known ? null : `No public PAYG rate is configured for Anthropic model ${model}; estimated at the highest standard Anthropic rate`;
  const prompt = normalized.input_tokens + normalized.cached_input_tokens + normalized.cache_write_5m_tokens + normalized.cache_write_1h_tokens + normalized.cache_write_unspecified_tokens;
  const long = known?.longContext && prompt > known.longContext.above ? known.longContext : null;
  const rates = long ?? known ?? FALLBACK_RATES.anthropic;
  const cost = (
    normalized.input_tokens * rates.input
    + normalized.cache_write_5m_tokens * rates.cacheWrite5m
    + normalized.cache_write_1h_tokens * rates.cacheWrite1h
    + normalized.cache_write_unspecified_tokens * rates.cacheWrite5m
    + normalized.cached_input_tokens * rates.cached
    + normalized.output_tokens * rates.output
  ) / 1_000_000;
  const note = long ? `Long-context rates applied because the prompt exceeded ${Math.round(long.above / 1_000)}K tokens.` : null;
  return pricedItem({
    provider: "anthropic", product: "llm", model, requestId: payload?.id, usage: normalized, cost,
    rates: { unit: "USD per 1M tokens", input: rates.input, cache_write_5m: rates.cacheWrite5m, cache_write_1h: rates.cacheWrite1h, cached_input: rates.cached, output: rates.output, ...(fallback ? { fallback: true } : {}) },
    source: known?.source ?? SOURCES.anthropic, note, warning: fallback, fallback: Boolean(fallback)
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
    // A composition plan has no music_length_ms; its sections carry the length.
    const sections = request.json?.composition_plan?.sections ?? request.json?.composition_plan?.chunks;
    const planMs = Array.isArray(sections) ? sections.reduce((sum, section) => sum + Number(section?.duration_ms ?? 0), 0) : 0;
    const generatedSeconds = Number(request.json?.music_length_ms ?? planMs) / 1_000;
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

// Every line item says whether it was priced at a vendor fallback rate, so a
// biller can charge the priced ones exactly and flag the estimates.
function pricedItem({ provider, product, model, requestId, usage, cost, rates, source, note = null, warning = null, fallback = false }) {
  return {
    provider, product, model, request_id: requestId ?? null, usage: usage ?? {},
    estimated_usd: roundMoney(cost), fallback: Boolean(fallback), pricing: { ...rates, as_of: PRICING_AS_OF, source },
    ...(note ? { note } : {}),
    ...(warning ? { warning } : {})
  };
}

function unpricedItem({ provider, product, model, requestId, usage = {}, warning }) {
  return { provider: provider ?? "unknown", product, model: model ?? null, request_id: requestId ?? null, usage, estimated_usd: null, fallback: false, pricing: null, warning };
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
      // Priced at a fallback rate: counted, and the tally says it is an estimate.
      if (item.fallback) provider.fallback_calls = (provider.fallback_calls ?? 0) + 1;
      if (item.warning) warnings.push(item.warning);
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
  // A streamed Responses call: the finished response rides in its last event.
  if (/text\/event-stream/i.test(response.headers?.get?.("content-type") ?? "")) {
    try {
      const text = await clone.text();
      for (const line of text.split(/\r?\n/).reverse()) {
        if (!line.startsWith("data:") || !line.includes("response.completed")) continue;
        const event = JSON.parse(line.slice(5));
        if (event?.type === "response.completed") return event.response ?? null;
      }
    } catch { /* an unreadable stream is an uncounted call */ }
    return null;
  }
  try { return await clone.json(); } catch { return null; }
}

function maximumWordEnd(words) {
  return roundUnit(Math.max(0, ...(words ?? []).map((entry) => finite(entry?.end))));
}

function isFormData(value) {
  return typeof FormData !== "undefined" && value instanceof FormData;
}

function isOpenAi(url) { return /(^|\.)openai\.com$/i.test(url.hostname); }
function isOpenRouter(url) { return /(^|\.)openrouter\.ai$/i.test(url.hostname); }
function isAnthropic(url) { return /(^|\.)anthropic\.com$/i.test(url.hostname); }
function isElevenLabs(url) { return /(^|\.)elevenlabs\.io$/i.test(url.hostname); }
function isBrave(url) { return /^api\.search\.brave\.com$/i.test(url.hostname); }
function isTavily(url) { return /^api\.tavily\.com$/i.test(url.hostname); }
function isSerper(url) { return /^google\.serper\.dev$/i.test(url.hostname); }
function isWebSearch(value) {
  try {
    const url = value instanceof URL ? value : new URL(value);
    return isBrave(url) || isTavily(url) || isSerper(url);
  } catch { return false; }
}

function providerForUrl(value) {
  try {
    const url = new URL(value);
    if (isOpenAi(url)) return "openai";
    if (isOpenRouter(url)) return "openrouter";
    if (isAnthropic(url)) return "anthropic";
    if (isElevenLabs(url)) return "elevenlabs";
    if (isBrave(url)) return "brave";
    if (isTavily(url)) return "tavily";
    if (isSerper(url)) return "serper";
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
