export class OpenAIResponsesClient {
  constructor(options = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    if (!this.apiKey) throw new Error("OPENAI_API_KEY is not set");
    this.baseUrl = String(options.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.fetch = options.fetch ?? globalThis.fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.maxRetries = Number(options.maxRetries ?? 3);
  }

  async submitStructured(options) {
    const body = buildStructuredRequest(options);
    return this.request("/responses", { method: "POST", body: JSON.stringify(body) });
  }

  async retrieve(responseId) {
    if (!responseId) throw new Error("Missing OpenAI response id");
    return this.request(`/responses/${encodeURIComponent(responseId)}`, { method: "GET" });
  }

  async wait(responseOrId, options = {}) {
    let response = typeof responseOrId === "string" ? await this.retrieve(responseOrId) : responseOrId;
    const pollIntervalMs = Number(options.pollIntervalMs ?? 5000);
    const maxWaitMs = Number(options.maxWaitMs ?? 20 * 60 * 1000);
    const maxPolls = Math.max(1, Math.ceil(maxWaitMs / Math.max(1, pollIntervalMs)));
    for (let poll = 0; poll <= maxPolls; poll += 1) {
      options.onStatus?.(response);
      if (response.status === "completed") return response;
      if (new Set(["failed", "cancelled", "incomplete"]).has(response.status)) throw responseFailure(response);
      if (!response.id) throw new Error("OpenAI background response did not include an id");
      if (poll === maxPolls) throw new Error(`OpenAI response ${response.id} did not complete within ${maxWaitMs}ms`);
      if (pollIntervalMs > 0) await this.sleep(pollIntervalMs);
      response = await this.retrieve(response.id);
    }
    throw new Error("OpenAI response polling ended unexpectedly");
  }

  async runStructured(options) {
    const submitted = await this.submitStructured(options);
    const response = submitted.status === "completed" ? submitted : await this.wait(submitted, options);
    return {
      response_id: response.id,
      model: response.model ?? options.model,
      status: response.status,
      value: parseStructuredOutput(response),
      usage: normalizeUsage(response.usage),
      reasoning: response.reasoning ?? null
    };
  }

  async request(endpoint, init) {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      let response;
      try {
        response = await this.fetch(`${this.baseUrl}${endpoint}`, {
          ...init,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            ...(init.headers ?? {})
          }
        });
      } catch (error) {
        if (attempt >= this.maxRetries) throw new Error(`OpenAI request failed: ${sanitize(String(error?.message ?? error))}`);
        await this.sleep(retryDelayMs(null, attempt));
        continue;
      }
      const payload = await parseResponseBody(response);
      if (response.ok) return payload;
      const retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
      if (retryable && attempt < this.maxRetries) {
        await this.sleep(retryDelayMs(response.headers?.get?.("retry-after"), attempt));
        continue;
      }
      const detail = payload?.error?.message ?? payload?.message ?? JSON.stringify(payload);
      throw new Error(`OpenAI Responses API failed (${response.status}): ${sanitize(detail).slice(0, 1000)}`);
    }
    throw new Error("OpenAI request exhausted retries");
  }
}

export function buildStructuredRequest(options = {}) {
  if (!options.schema || !options.schemaName) throw new Error("Structured responses require schema and schemaName");
  const model = String(options.model ?? "gpt-5.6");
  const reasoningEffort = String(options.reasoningEffort ?? "xhigh");
  if (!["none", "low", "medium", "high", "xhigh", "max"].includes(reasoningEffort)) throw new Error(`Unsupported reasoning effort: ${reasoningEffort}`);
  const reasoning = {
    effort: reasoningEffort,
    context: String(options.reasoningContext ?? "current_turn")
  };
  if (options.pro) reasoning.mode = "pro";
  const body = {
    model,
    instructions: String(options.instructions ?? ""),
    input: buildInput(options.input, options.images),
    reasoning,
    background: options.background !== false,
    store: options.store !== false,
    text: {
      format: {
        type: "json_schema",
        name: String(options.schemaName),
        strict: true,
        schema: options.schema
      }
    }
  };
  if (options.maxOutputTokens != null) body.max_output_tokens = positiveInteger(options.maxOutputTokens, "maxOutputTokens");
  if (options.previousResponseId) body.previous_response_id = String(options.previousResponseId);
  if (options.promptCacheKey) body.prompt_cache_key = String(options.promptCacheKey);
  if (options.safetyIdentifier) body.safety_identifier = String(options.safetyIdentifier);
  if (options.metadata) body.metadata = normalizeMetadata(options.metadata);
  return body;
}

export function parseStructuredOutput(response) {
  if (response?.status && response.status !== "completed") throw responseFailure(response);
  if (typeof response?.output_text === "string" && response.output_text.trim()) return parseJson(response.output_text);
  const text = [];
  for (const item of response?.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "refusal") throw new Error(`OpenAI refused the request: ${sanitize(content.refusal ?? "request refused")}`);
      if (content.type === "output_text" && content.text) text.push(content.text);
    }
  }
  if (!text.length) throw new Error("OpenAI response contained no structured output text");
  return parseJson(text.join(""));
}

function buildInput(input, images = []) {
  if (!images?.length) return typeof input === "string" ? input : input ?? "";
  const content = [{ type: "input_text", text: typeof input === "string" ? input : JSON.stringify(input ?? {}) }];
  for (const image of images) {
    if (!image?.url) throw new Error("Image inputs require url");
    const detail = image.detail ?? "original";
    if (!["low", "high", "original", "auto"].includes(detail)) throw new Error(`Unsupported image detail: ${detail}`);
    content.push({ type: "input_image", image_url: image.url, detail });
  }
  return [{ role: "user", content }];
}

function normalizeMetadata(metadata) {
  return Object.fromEntries(Object.entries(metadata).slice(0, 16).map(([key, value]) => [String(key).slice(0, 64), String(value).slice(0, 512)]));
}

function normalizeUsage(usage = {}) {
  return {
    input_tokens: Number(usage.input_tokens ?? 0),
    output_tokens: Number(usage.output_tokens ?? 0),
    total_tokens: Number(usage.total_tokens ?? 0),
    cached_tokens: Number(usage.input_tokens_details?.cached_tokens ?? 0),
    cache_write_tokens: Number(usage.input_tokens_details?.cache_write_tokens ?? 0),
    reasoning_tokens: Number(usage.output_tokens_details?.reasoning_tokens ?? 0)
  };
}

function responseFailure(response) {
  const detail = response?.error?.message ?? response?.incomplete_details?.reason ?? response?.status ?? "unknown failure";
  return new Error(`OpenAI response ${response?.id ?? "(unknown)"} ${response?.status ?? "failed"}: ${sanitize(detail)}`);
}

async function parseResponseBody(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`OpenAI structured output was not valid JSON: ${error.message}`);
  }
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

function sanitize(value) {
  return String(value ?? "").replace(/\b(?:sk|sess)-[a-z0-9_-]{12,}\b/gi, "[REDACTED]");
}
