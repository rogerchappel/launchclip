// Model selection for `launchclip make`.
//
// --model provider:model[@reasoning] wins, then LAUNCHCLIP_MAKE_MODEL, then a
// default for whichever key is set. The defaults are the model IDs the cost
// table (src/cost_tracker.js) prices: openai:gpt-5.6-luna (the least
// expensive priced OpenAI model; also model_provider.js's default) when
// OPENAI_API_KEY is set, else anthropic:claude-opus-4-8 when
// ANTHROPIC_API_KEY is set. OPENROUTER_API_KEY alone needs an explicit --model.
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
  // The OpenAI Responses and chat-completions clients send images; the
  // Anthropic planner adapter sends text only, and Ollama models usually
  // cannot see (model_provider.js supportsImages).
  const vision = provider === "openai" || provider === "openrouter" || (provider === "compatible" && inner.supportsImages !== false);
  return { client, provider, model: created.model, reasoning, vision };
}
