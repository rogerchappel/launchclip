// Model selection for `launchclip make`.
//
// --model provider:model[@reasoning] wins, then LAUNCHCLIP_MAKE_MODEL, then a
// default for whichever key is set. The defaults are the model IDs the cost
// table (src/cost_tracker.js) prices: openai:gpt-5.6-luna (the least
// expensive priced OpenAI model; also model_provider.js's default) when
// OPENAI_API_KEY is set, else anthropic:claude-opus-4-8 when
// ANTHROPIC_API_KEY is set. OPENROUTER_API_KEY alone needs an explicit --model.
//
// checkModelAccess() answers which roles those keys cover (text and vision),
// without a paid call: `launchclip doctor --models` and MAKE.json model_access.
import { createPlannerClient } from "../storyboard_planner.js";

export const DEFAULT_MAKE_MODELS = Object.freeze({
  openai: "openai:gpt-5.6-luna",
  anthropic: "anthropic:claude-opus-4-8"
});
// make plans at medium reasoning unless the spec says otherwise (the Responses
// client's own default is xhigh, which is slow and costly for a script pass).
export const DEFAULT_MAKE_REASONING = "medium";

/** → {spec, source} or throws with the next step. */
export function selectMakeModel(flag, env = process.env) {
  if (flag !== undefined && flag !== null && flag !== true && String(flag).trim()) return { spec: String(flag).trim(), source: "--model" };
  if (env.LAUNCHCLIP_MAKE_MODEL) return { spec: String(env.LAUNCHCLIP_MAKE_MODEL).trim(), source: "LAUNCHCLIP_MAKE_MODEL" };
  if (env.OPENAI_API_KEY) return { spec: DEFAULT_MAKE_MODELS.openai, source: "default for OPENAI_API_KEY" };
  if (env.ANTHROPIC_API_KEY) return { spec: DEFAULT_MAKE_MODELS.anthropic, source: "default for ANTHROPIC_API_KEY" };
  throw new Error("launchclip make needs a model: set OPENAI_API_KEY or ANTHROPIC_API_KEY (shell or .env), or pass --model provider:model (for example openrouter:<vendor>/<model> with OPENROUTER_API_KEY, or ollama:<model> for a local model)");
}

/**
 * A runStructured() client for the spec, with make's reasoning default
 * injected, plus whether it can take images (for the headless critic).
 * → {client, provider, model, reasoning, vision}
 */
export function createMakeClient(spec, options = {}) {
  const at = spec.lastIndexOf("@");
  const suffix = at > 0 ? spec.slice(at + 1).toLowerCase() : "";
  const efforts = ["none", "low", "medium", "high", "xhigh", "max"];
  const reasoning = efforts.includes(suffix) ? suffix : DEFAULT_MAKE_REASONING;
  const bare = efforts.includes(suffix) ? spec.slice(0, at) : spec;
  // The Anthropic adapter takes the model id verbatim (no @reasoning suffix).
  const anthropic = /^anthropic:/i.test(bare);
  const created = createPlannerClient(anthropic ? bare : `${bare}@${reasoning}`, options);
  const inner = created.client;
  const provider = created.provider;
  const client = {
    provider,
    model: created.model,
    async runStructured(request) {
      return inner.runStructured({ ...request, model: request.model ?? created.model, reasoningEffort: request.reasoningEffort ?? reasoning });
    }
  };
  const { available: vision } = modelVision(provider, inner);
  return { client, provider, model: created.model, reasoning, vision };
}

/**
 * Can this provider's client send images? The OpenAI Responses client, the
 * chat-completions clients (OpenRouter, an OpenAI-compatible endpoint) and
 * the Anthropic adapter do; the Ollama client builds its messages without
 * them (model_provider.js). → {available, reason?, note?}
 */
export function modelVision(provider, client = null) {
  if (provider === "ollama") return { available: false, reason: "the Ollama client sends text only" };
  if (provider === "compatible" && client?.supportsImages === false) return { available: false, reason: "this OpenAI-compatible route is marked as not taking images" };
  if (provider === "openai" || provider === "anthropic") return { available: true };
  if (provider === "openrouter" || provider === "compatible") return { available: true, note: "images are sent; whether they are read depends on the model you chose" };
  return { available: false, reason: `no image input for provider ${provider}` };
}

// ---------------------------------------------------------------------------
// The model check: launchclip doctor --models, and model_access in MAKE.json.

export const MODEL_ACCESS_SCHEMA = "launchclip.model-access.v1";
// Each role a model can play in a make run, and what it needs.
export const MODEL_ROLES = Object.freeze({ writer: "text", designer: "text", director: "text", critic: "vision", "hand-in judge": "vision" });
const PROVIDER_KEYS = Object.freeze({ openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY", openrouter: "OPENROUTER_API_KEY", compatible: "OPENAI_COMPATIBLE_API_KEY" });
const PROVIDER_ALIASES = Object.freeze({ local: "ollama", "openai-compatible": "compatible" });
const DEFAULT_OLLAMA_URL = "http://localhost:11434";

/**
 * With these keys and this machine, which roles can a model play?
 *
 * It reads the environment and, for a local model, asks the Ollama address
 * for its model list. It never calls a metered API.
 *
 * options: {model (the --model flag), env, agent (the skill path: the agent
 * is the model), selected (make's own {spec, source, provider, model,
 * vision}, so MAKE.json reports the client the run really uses), fetch,
 * probeLocal: true | false | "auto" (ask Ollama only when it is selected or
 * OLLAMA_BASE_URL is set), timeoutMs}
 * → {schema, text, vision, roles, keys, local}
 */
export async function checkModelAccess(options = {}) {
  const env = options.env ?? process.env;
  const keys = Object.fromEntries([...Object.values(PROVIDER_KEYS), "OPENAI_COMPATIBLE_BASE_URL", "OLLAMA_BASE_URL"].map((name) => [name, Boolean(env[name])]));
  if (options.agent) {
    const agent = { available: true, source: "agent", provider: "agent", local: false };
    return { schema: MODEL_ACCESS_SCHEMA, text: agent, vision: { ...agent }, roles: Object.fromEntries(Object.keys(MODEL_ROLES).map((role) => [role, "agent"])), keys, local: { provider: "ollama", base_url: ollamaUrl(env), reachable: null } };
  }

  let chosen = options.selected ? { ...options.selected, built: true } : null;
  let unselected = null;
  if (!chosen) {
    try {
      const { spec, source } = selectMakeModel(options.model, env);
      chosen = { spec, source, ...parseSpec(spec) };
    } catch {
      unselected = keys.OPENROUTER_API_KEY ? "OPENROUTER_API_KEY is set, but it has no default model: pass --model openrouter:<vendor>/<model>"
        : keys.OPENAI_COMPATIBLE_API_KEY ? "OPENAI_COMPATIBLE_API_KEY is set, but it has no default model: pass --model compatible:<model>"
        : "no model key is set: set OPENAI_API_KEY or ANTHROPIC_API_KEY, or pass --model provider:model";
    }
  }

  const provider = chosen?.provider ?? null;
  const probe = options.probeLocal ?? "auto";
  const local = { provider: "ollama", base_url: ollamaUrl(env), reachable: null };
  if (probe === true || (probe === "auto" && (provider === "ollama" || keys.OLLAMA_BASE_URL))) {
    const answer = await askOllama(env, options);
    local.reachable = answer.reachable;
    if (answer.models) local.models = answer.models;
  }

  let text;
  if (!chosen) {
    text = { available: false, reason: local.reachable ? `${unselected}; a local Ollama answers at ${local.base_url}: pass --model ollama:<model>` : unselected };
  } else {
    const base = { source: chosen.source, provider, model: chosen.model, spec: chosen.spec, local: provider === "ollama" && isLoopback(local.base_url) };
    const missing = chosen.built ? null : textProblem(provider, env);
    const down = provider === "ollama" ? ollamaProblem(chosen.model, local) : null;
    text = missing || down ? { available: false, ...base, reason: missing ?? down } : { available: true, ...base };
  }

  let vision;
  if (!text.available) vision = { available: false, reason: "no text model" };
  else {
    // make's own client says whether it sends images; otherwise the provider's rule does.
    const rule = modelVision(provider);
    const sees = chosen.built && chosen.vision !== undefined ? Boolean(chosen.vision) : rule.available;
    vision = sees
      ? { available: true, source: text.source, provider, model: text.model, ...(rule.note ? { note: rule.note } : {}) }
      : { available: false, reason: rule.reason ?? `${chosen.spec} is not set up to take images` };
  }

  const roles = Object.fromEntries(Object.entries(MODEL_ROLES).map(([role, needs]) => [role, (needs === "text" ? text : vision).available ? "available" : `pending: no ${text.available ? needs : "text"} model`]));
  return { schema: MODEL_ACCESS_SCHEMA, text, vision, roles, keys, local };
}

/** The check as lines for a terminal. */
export function formatModelAccess(report) {
  const line = (label, entry) => entry.available
    ? `${label}  available: ${entry.provider}${entry.model ? ` ${entry.model}` : ""} (${entry.source}${entry.local ? ", local" : ""})${entry.note ? `; ${entry.note}` : ""}`
    : `${label}  not available: ${entry.reason}`;
  const set = Object.entries(report.keys).filter(([, present]) => present).map(([name]) => name);
  return `${[
    line("text  ", report.text),
    line("vision", report.vision),
    "roles",
    ...Object.entries(report.roles).map(([role, state]) => `  ${role.padEnd(14)}${state}`),
    `keys set: ${set.length ? set.join(", ") : "none"}`,
    `local model: Ollama at ${report.local.base_url} ${report.local.reachable === null ? "was not asked" : report.local.reachable ? "answers" : "does not answer"}`,
    "No paid call was made. LaunchClip draws in code; it generates no images or video."
  ].join("\n")}\n`;
}

function parseSpec(spec) {
  const at = spec.lastIndexOf("@");
  const bare = at > 0 && /^(none|low|medium|high|xhigh|max)$/i.test(spec.slice(at + 1)) ? spec.slice(0, at) : spec;
  const separator = bare.indexOf(":");
  // A spec with no provider is an OpenAI model (parseModelRoute's default).
  const named = separator > 0 ? bare.slice(0, separator).toLowerCase() : "openai";
  return { provider: PROVIDER_ALIASES[named] ?? named, model: separator > 0 ? bare.slice(separator + 1) : bare };
}

function textProblem(provider, env) {
  if (provider === "ollama") return null;
  const key = PROVIDER_KEYS[provider];
  if (!key) return `unsupported model provider: ${provider}`;
  if (!env[key]) return `${key} is not set`;
  if (provider === "compatible" && !env.OPENAI_COMPATIBLE_BASE_URL) return "OPENAI_COMPATIBLE_BASE_URL is not set";
  return null;
}

function ollamaProblem(model, local) {
  if (local.reachable === false) return `Ollama does not answer at ${local.base_url}`;
  if (local.reachable && local.models && model && !local.models.some((name) => name === model || name === `${model}:latest`)) return `Ollama at ${local.base_url} has no model ${model}: run ollama pull ${model}`;
  return null;
}

function ollamaUrl(env) {
  const raw = String(env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL).replace(/\/$/, "");
  // Never echo credentials that were put in the address.
  try { const url = new URL(raw); url.username = ""; url.password = ""; return url.toString().replace(/\/$/, ""); } catch { return raw; }
}

function isLoopback(address) {
  try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(address).hostname); } catch { return false; }
}

// GET /api/tags lists the installed models: free, and it never loads one.
async function askOllama(env, { fetch: fetchImpl = globalThis.fetch, timeoutMs = 1500 } = {}) {
  try {
    const response = await fetchImpl(`${String(env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL).replace(/\/$/, "")}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return { reachable: false };
    const payload = await response.json().catch(() => null);
    const models = Array.isArray(payload?.models) ? payload.models.map((entry) => String(entry?.name ?? entry?.model ?? "")).filter(Boolean) : null;
    return { reachable: true, ...(models ? { models } : {}) };
  } catch {
    return { reachable: false };
  }
}

/** --script-model, else LAUNCHCLIP_SCRIPT_MODEL, else null (the run's model writes the script too). */
export function scriptModelSpec(flag, env = process.env) {
  const spec = flag != null && flag !== true && String(flag).trim() ? String(flag).trim() : String(env?.LAUNCHCLIP_SCRIPT_MODEL ?? "").trim();
  return spec || null;
}
