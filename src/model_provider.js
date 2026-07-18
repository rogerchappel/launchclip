import { randomUUID } from "node:crypto";
import { OpenAIResponsesClient } from "./openai_responses.js";

const REASONING_EFFORTS = new Set(["none", "low", "medium", "high", "xhigh", "max"]);
const PROVIDER_ALIASES = new Map([["local", "ollama"], ["openai-compatible", "compatible"]]);

export function parseModelRoute(value, defaults = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) return normalizeRoute({ ...defaults, ...value });
  const raw = String(value ?? "").trim();
  if (!raw) return normalizeRoute(defaults);
  const at = raw.lastIndexOf("@");
  const suffix = at > 0 ? raw.slice(at + 1).toLowerCase() : "";
  const hasReasoning = REASONING_EFFORTS.has(suffix);
  const route = hasReasoning ? raw.slice(0, at) : raw;
  const separator = route.indexOf(":");
  const provider = separator > 0 ? route.slice(0, separator) : defaults.provider;
  const model = separator > 0 ? route.slice(separator + 1) : route;
  return normalizeRoute({ ...defaults, provider, model, reasoning: hasReasoning ? suffix : defaults.reasoning });
}

export function parseModelRoutes(value, defaults = {}) {
  const entries = (Array.isArray(value) ? value : value == null ? [] : [value])
    .flatMap((entry) => String(entry).split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);
  return (entries.length ? entries : [defaults]).map((entry) => parseModelRoute(entry, defaults));
}

export function modelRouteKey(route) {
  const normalized = parseModelRoute(route);
  return {
    provider: normalized.provider,
    model: normalized.model,
    reasoning: normalized.reasoning,
    base_url: normalized.baseUrl,
    supports_images: normalized.supportsImages
  };
}

export function createStructuredClient(route, options = {}) {
  const normalized = parseModelRoute(route);
  if (normalized.provider === "openai" && normalized.transport === "responses") {
    return new OpenAIResponsesClient({
      apiKey: options.apiKey ?? normalized.apiKey ?? process.env.OPENAI_API_KEY,
      baseUrl: normalized.baseUrl,
      fetch: options.fetch,
      sleep: options.sleep,
      maxRetries: options.maxRetries
    });
  }
  if (normalized.provider === "ollama") return new OllamaStructuredClient({ ...normalized, ...options });
  return new ChatCompletionsStructuredClient({ ...normalized, ...options });
}

export class ChatCompletionsStructuredClient {
  constructor(options = {}) {
    const route = parseModelRoute(options);
    this.provider = route.provider;
    this.model = route.model;
    this.baseUrl = route.baseUrl;
    this.apiKey = options.apiKey ?? route.apiKey ?? providerApiKey(route.provider);
    if (!this.apiKey && route.provider !== "ollama") throw new Error(`${providerApiKeyName(route.provider)} is not set`);
    this.fetch = options.fetch ?? globalThis.fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const freeOpenRouterRoute = isFreeOpenRouterRoute(route);
    this.maxRetries = Number(options.maxRetries ?? (freeOpenRouterRoute ? 0 : 2));
    this.requestTimeoutMs = nonNegativeInteger(
      options.requestTimeoutMs ?? (freeOpenRouterRoute ? process.env.LAUNCHCLIP_OPENROUTER_FREE_TIMEOUT_MS ?? 120_000 : 0),
      "requestTimeoutMs"
    );
    this.supportsResume = false;
    this.supportsImages = route.supportsImages;
    this.reasoning = route.reasoning;
  }

  async runStructured(options = {}) {
    if (!options.schema || !options.schemaName) throw new Error("Structured responses require schema and schemaName");
    const model = String(options.model ?? this.model ?? "").trim();
    if (!model) throw new Error("Structured responses require a model");
    const body = {
      model,
      messages: buildMessages(options.instructions, options.input, this.supportsImages ? options.images : []),
      response_format: {
        type: "json_schema",
        json_schema: { name: String(options.schemaName), strict: true, schema: options.schema }
      },
      temperature: Number(options.temperature ?? 0),
      stream: false
    };
    if (options.maxOutputTokens != null) body.max_tokens = positiveInteger(options.maxOutputTokens, "maxOutputTokens");
    if (this.provider === "openrouter") {
      const dynamicFreeRouter = model === "openrouter/free";
      body.provider = { require_parameters: !dynamicFreeRouter, allow_fallbacks: dynamicFreeRouter };
      if (options.reasoningEffort && (options.reasoningEffort !== "none" || model === "openrouter/free")) {
        body.reasoning = { effort: options.reasoningEffort };
      }
    }
    const payload = await this.request("/chat/completions", { method: "POST", body: JSON.stringify(body) });
    const result = chatStructuredResult(payload, model);
    await options.onSubmitted?.({ id: result.response_id, status: result.status, model: result.model });
    return result;
  }

  async resumeStructured() {
    const error = new Error(`${this.provider} chat completions cannot resume a submitted response`);
    error.code = "LAUNCHCLIP_PROVIDER_CANNOT_RESUME";
    throw error;
  }

  async request(endpoint, init) {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      let response;
      let payload;
      const timeoutController = this.requestTimeoutMs > 0 ? new AbortController() : null;
      const timeoutSignal = timeoutController?.signal ?? null;
      const timeoutHandle = timeoutController
        ? setTimeout(() => timeoutController.abort(), this.requestTimeoutMs)
        : null;
      const signal = init.signal && timeoutSignal ? AbortSignal.any([init.signal, timeoutSignal]) : init.signal ?? timeoutSignal ?? undefined;
      try {
        response = await this.fetch(`${this.baseUrl}${endpoint}`, {
          ...init,
          signal,
          headers: {
            "Content-Type": "application/json",
            ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
            ...(this.provider === "openrouter" && process.env.OPENROUTER_HTTP_REFERER ? { "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER } : {}),
            ...(this.provider === "openrouter" && process.env.OPENROUTER_APP_NAME ? { "X-OpenRouter-Title": process.env.OPENROUTER_APP_NAME } : {}),
            ...(init.headers ?? {})
          }
        });
        payload = await parseResponseBody(response);
      } catch (error) {
        if (attempt >= this.maxRetries) {
          if (timeoutSignal?.aborted) {
            const timeoutError = new Error(`${this.provider} request timed out after ${this.requestTimeoutMs}ms`);
            timeoutError.code = "LAUNCHCLIP_PROVIDER_TIMEOUT";
            throw timeoutError;
          }
          throw new Error(`${this.provider} request failed: ${sanitize(error?.message ?? error)}`);
        }
        await this.sleep(retryDelayMs(null, attempt));
        continue;
      } finally {
        if (timeoutHandle != null) clearTimeout(timeoutHandle);
      }
      if (response.ok) return payload;
      const retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
      if (retryable && attempt < this.maxRetries) {
        await this.sleep(retryDelayMs(response.headers?.get?.("retry-after"), attempt));
        continue;
      }
      const detail = payload?.error?.message ?? payload?.message ?? JSON.stringify(payload);
      throw new Error(`${this.provider} chat completions failed (${response.status}): ${sanitize(detail).slice(0, 1000)}`);
    }
    throw new Error(`${this.provider} request exhausted retries`);
  }
}

export class OllamaStructuredClient extends ChatCompletionsStructuredClient {
  constructor(options = {}) {
    super(options);
    this.contextTokens = positiveInteger(options.contextTokens ?? process.env.OLLAMA_CONTEXT_LENGTH ?? 32_768, "Ollama context length");
  }

  async runStructured(options = {}) {
    if (!options.schema || !options.schemaName) throw new Error("Structured responses require schema and schemaName");
    const model = String(options.model ?? this.model ?? "").trim();
    if (!model) throw new Error("Structured responses require a model");
    const generation = {
      temperature: Number(options.temperature ?? 0),
      seed: Number(options.seed ?? 0),
      num_ctx: positiveInteger(options.contextTokens ?? this.contextTokens, "Ollama context length")
    };
    if (options.maxOutputTokens != null) generation.num_predict = positiveInteger(options.maxOutputTokens, "maxOutputTokens");
    const keepAlive = options.keepAlive;
    if (keepAlive != null && !((typeof keepAlive === "number" && Number.isFinite(keepAlive)) || (typeof keepAlive === "string" && keepAlive.trim()))) {
      throw new Error("Ollama keepAlive must be a finite number or non-empty duration string");
    }
    const payload = await this.request("/api/chat", {
      method: "POST",
      body: JSON.stringify({
        model,
        messages: buildMessages(options.instructions, options.input, []),
        format: options.schema,
        stream: false,
        think: false,
        ...(keepAlive == null ? {} : { keep_alive: keepAlive }),
        options: generation
      })
    });
    const result = ollamaStructuredResult(payload, model);
    await options.onSubmitted?.({ id: result.response_id, status: result.status, model: result.model });
    return result;
  }
}

function normalizeRoute(route = {}) {
  const provider = PROVIDER_ALIASES.get(String(route.provider ?? "openai").trim().toLowerCase()) ?? String(route.provider ?? "openai").trim().toLowerCase();
  if (!["openai", "openrouter", "ollama", "compatible"].includes(provider)) throw new Error(`Unsupported model provider: ${provider}`);
  const model = String(route.model ?? defaultModel(provider)).trim();
  if (!model) throw new Error(`Missing model for ${provider}`);
  const reasoning = String(route.reasoning ?? "medium").trim().toLowerCase();
  if (!REASONING_EFFORTS.has(reasoning)) throw new Error(`Unsupported reasoning effort: ${reasoning}`);
  const transport = String(route.transport ?? (provider === "openai" ? "responses" : "chat-completions"));
  if (!["responses", "chat-completions"].includes(transport)) throw new Error(`Unsupported model transport: ${transport}`);
  const baseUrl = String(route.baseUrl ?? providerBaseUrl(provider)).replace(/\/$/, "");
  if (!baseUrl) throw new Error(`Missing base URL for ${provider}`);
  return {
    provider,
    model,
    reasoning,
    transport,
    baseUrl,
    apiKey: route.apiKey,
    supportsImages: route.supportsImages == null ? provider !== "ollama" : Boolean(route.supportsImages)
  };
}

function defaultModel(provider) {
  if (provider === "ollama") return process.env.OLLAMA_MODEL ?? "qwen2.5-coder:latest";
  return "gpt-5.6-luna";
}

function providerBaseUrl(provider) {
  if (provider === "openai") return process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  if (provider === "openrouter") return process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
  if (provider === "ollama") return process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  return process.env.OPENAI_COMPATIBLE_BASE_URL ?? "";
}

function providerApiKey(provider) {
  if (provider === "openai") return process.env.OPENAI_API_KEY;
  if (provider === "openrouter") return process.env.OPENROUTER_API_KEY;
  if (provider === "compatible") return process.env.OPENAI_COMPATIBLE_API_KEY;
  return null;
}

function providerApiKeyName(provider) {
  if (provider === "openrouter") return "OPENROUTER_API_KEY";
  if (provider === "compatible") return "OPENAI_COMPATIBLE_API_KEY";
  return "OPENAI_API_KEY";
}

function buildMessages(instructions, input, images = []) {
  const messages = [];
  if (instructions) messages.push({ role: "system", content: String(instructions) });
  const text = typeof input === "string" ? input : JSON.stringify(input ?? {});
  if (!images?.length) messages.push({ role: "user", content: text });
  else messages.push({
    role: "user",
    content: [
      { type: "text", text },
      ...images.map((image) => ({ type: "image_url", image_url: { url: image.url, detail: image.detail ?? "auto" } }))
    ]
  });
  return messages;
}

function chatStructuredResult(payload, fallbackModel) {
  const choice = payload?.choices?.[0] ?? {};
  const content = choice?.message?.content;
  const text = typeof content === "string"
    ? content
    : Array.isArray(content) ? content.map((entry) => entry?.text ?? "").join("") : "";
  if (!text.trim()) {
    const usage = payload?.usage ?? {};
    const model = sanitize(payload?.model ?? fallbackModel ?? "unknown").slice(0, 200);
    const finishReason = sanitize(choice?.finish_reason ?? "unknown").slice(0, 80);
    const completionTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
    const reasoningTokens = Number(usage.completion_tokens_details?.reasoning_tokens ?? usage.output_tokens_details?.reasoning_tokens ?? 0);
    throw new Error(`Chat completion contained no structured output text (model=${model}, finish_reason=${finishReason}, completion_tokens=${completionTokens}, reasoning_tokens=${reasoningTokens})`);
  }
  let value;
  try { value = JSON.parse(stripJsonFence(text)); }
  catch (error) { throw new Error(`Chat completion structured output was not valid JSON: ${error.message}`); }
  const usage = payload?.usage ?? {};
  return {
    response_id: payload?.id ?? `chatcmpl-local-${randomUUID()}`,
    model: payload?.model ?? fallbackModel,
    status: "completed",
    value,
    usage: {
      input_tokens: Number(usage.prompt_tokens ?? usage.input_tokens ?? 0),
      output_tokens: Number(usage.completion_tokens ?? usage.output_tokens ?? 0),
      total_tokens: Number(usage.total_tokens ?? 0),
      cached_tokens: Number(usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens ?? 0),
      cache_write_tokens: 0,
      reasoning_tokens: Number(usage.completion_tokens_details?.reasoning_tokens ?? usage.output_tokens_details?.reasoning_tokens ?? 0)
    },
    reasoning: null
  };
}

function stripJsonFence(text) {
  const trimmed = String(text).trim();
  const opening = trimmed.match(/^```(?:json)?[^\S\r\n]*(?:\r?\n)?/i);
  if (!opening) return trimmed;
  const body = trimmed.slice(opening[0].length);
  return body.replace(/\r?\n```[^\S\r\n]*$/i, "").trim();
}

function ollamaStructuredResult(payload, fallbackModel) {
  const text = payload?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new Error("Ollama chat response contained no structured output text");
  let value;
  try { value = JSON.parse(text); }
  catch (error) { throw new Error(`Ollama structured output was not valid JSON: ${error.message}`); }
  const inputTokens = Number(payload?.prompt_eval_count ?? 0);
  const outputTokens = Number(payload?.eval_count ?? 0);
  return {
    response_id: payload?.id ?? `ollama-${randomUUID()}`,
    model: payload?.model ?? fallbackModel,
    status: payload?.done === false ? "incomplete" : "completed",
    value,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
      cached_tokens: 0,
      cache_write_tokens: 0,
      reasoning_tokens: 0
    },
    reasoning: null
  };
}

async function parseResponseBody(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); }
  catch { return { message: text }; }
}

function retryDelayMs(header, attempt) {
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(60_000, seconds * 1000);
  return Math.min(30_000, 500 * 2 ** attempt);
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer`);
  return number;
}

function nonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${label} must be a non-negative integer`);
  return number;
}

function isFreeOpenRouterRoute(route) {
  return route.provider === "openrouter" && (route.model === "openrouter/free" || route.model.endsWith(":free"));
}

function sanitize(value) {
  return String(value ?? "").replace(/\b(?:sk|sess)-[a-z0-9_-]{12,}\b/gi, "[REDACTED]");
}
