// Storyboard planner: brief (+ narration) → storyboard.json through one model
// call and a bounded repair loop (docs/STORYBOARD_ENGINE_RFC.md §7).
//
//   planStoryboard({brief, words, lane, format, brand, tier, model, client})
//
// 1. The model gets planningPrompt() (generated from the module registry) and
//    the brief, and returns one storyboard JSON object.
// 2. Tooling pins the fixed inputs (lane, format, brand, voice, words, base),
//    places editorial modules that declare no rect in the safe slot, then
//    checks the result: validateStory against knownModules(), the tier rules,
//    anchor resolution, resolveModule() for every scene (param errors), and the
//    layout check on the declared geometry.
// 3. On failure the exact errors go back to the model, which returns a
//    corrected storyboard; at most `maxRepairs` (default 2) times. Repairs
//    target scenes and params; the checks and their thresholds never change.
//
// `client` is any object with runStructured(request) → {value?, text?, usage,
// model, response_id} (src/model_provider.js clients, the Anthropic adapter
// below, or a fake in tests), so the planner runs keyless in tests.

import { STORY_LANES, resolveStory, validateStory } from "../kit/core/story.mjs";
import { isEditorialKind, knownModules, formatAspect, resolveModule } from "../kit/core/modules.mjs";
import { checkLayout, elementsFromEditorialLayout, elementsFromStory } from "../kit/core/layout-check.mjs";
import { DEFAULT_BRAND, PLANNER_TIERS, SAFE_EDITORIAL_RECTS, TUNING_PARAMS, planningPrompt, suggestModules } from "../kit/core/planning-prompt.mjs";
import { createStructuredClient, parseModelRoute } from "./model_provider.js";
import { estimateModelUsageCost } from "./cost_tracker.js";

export const STORYBOARD_PLAN_VERSION = "launchclip.storyboard-plan.v1";
export const DEFAULT_MAX_REPAIRS = 2;

// Strict-mode compatible envelope: the storyboard travels as a JSON string,
// because its params are open objects that strict JSON schemas cannot express.
export const STORYBOARD_ENVELOPE_SCHEMA = Object.freeze({
  type: "object",
  properties: { storyboard_json: { type: "string", description: "The complete storyboard.json document, serialised as JSON." } },
  required: ["storyboard_json"],
  additionalProperties: false
});

/**
 * Plan a storyboard. Returns a report (never throws on a model or check
 * failure; status is "passed" or "failed"):
 * {schema_version, status, storyboard, tier, lane, model, attempts, repairs_used,
 *  valid_first_attempt, errors, warnings, layout, usage, cost, elapsed_ms, phrase_hints}
 */
export async function planStoryboard(options = {}) {
  const { brief, words = null, beats = null, lane = "motion", format, brand = DEFAULT_BRAND, tier = "structured", model = null, client, audio = null, base = null, maxRepairs = DEFAULT_MAX_REPAIRS, now = () => Date.now() } = options;
  if (!nonEmpty(brief)) throw new Error("planStoryboard needs a non-empty brief");
  if (!PLANNER_TIERS.includes(tier)) throw new Error(`tier must be one of ${PLANNER_TIERS.join(", ")}`);
  if (!STORY_LANES.includes(lane)) throw new Error(`lane must be one of ${STORY_LANES.join(", ")}`);
  if (!format || !Number.isInteger(format.width) || !Number.isInteger(format.height) || !(format.duration > 0)) throw new Error("planStoryboard needs format {width, height, fps, duration}");
  if (!client || typeof client.runStructured !== "function") throw new Error("planStoryboard needs a client with runStructured()");
  const repairs = Math.max(0, Math.min(5, Number.isInteger(maxRepairs) ? maxRepairs : DEFAULT_MAX_REPAIRS));
  const wordList = Array.isArray(words) ? words : Array.isArray(words?.words) ? words.words : [];
  const fixed = fixedInputs({ lane, format, brand, audio, base });
  const instructions = planningPrompt({ tier, lane, format: fixed.format, brand: fixed.brand, words: wordList.length ? wordList : undefined });
  const hints = suggestModules([brief, wordList.map((entry) => entry?.text ?? entry?.word ?? "").join(" ")].join(" "), { lane });
  const request = planRequest({ brief, fixed, hints });
  const started = now();
  const attempts = [];
  let previous = null;
  let last = null;

  for (let attempt = 0; attempt <= repairs; attempt += 1) {
    const kind = attempt === 0 ? "plan" : "repair";
    const input = kind === "plan" ? request : repairRequest({ request, previous: previous?.candidate ?? null, errors: previous?.errors ?? [], attempt, repairs });
    const callStarted = now();
    let result;
    try {
      result = await client.runStructured({
        instructions,
        input,
        schema: STORYBOARD_ENVELOPE_SCHEMA,
        schemaName: "launchclip_storyboard",
        model: model ?? undefined,
        temperature: 0,
        maxOutputTokens: 16_000
      });
    } catch (error) {
      // A transport failure is not something a repair prompt can fix.
      attempts.push({ attempt, kind, ok: false, errors: [`model: ${message(error)}`], warnings: [], layout: { errors: 0, warnings: 0 }, usage: emptyUsage(), cost_usd: 0, model, elapsed_ms: now() - callStarted });
      last = { ok: false, errors: [`model: ${message(error)}`], warnings: [], storyboard: null, layout: emptyLayout() };
      break;
    }
    const usage = normalizeUsage(result?.usage);
    const cost = estimateModelUsageCost(providerOf(client, model), result?.model ?? model, usage);
    const extracted = extractStoryboard(result);
    let checked;
    if (!extracted.ok) checked = { ok: false, errors: [`json: ${extracted.error}`], warnings: [], storyboard: null, layout: emptyLayout(), candidate: extracted.text ?? null };
    else {
      const pinned = pinInputs(extracted.storyboard, fixed);
      checked = checkStoryboard(pinned.storyboard, { words: wordList, beats, tier });
      checked.warnings = [...pinned.warnings, ...checked.warnings];
      checked.candidate = extracted.storyboard;
    }
    attempts.push({
      attempt,
      kind,
      ok: checked.ok,
      errors: checked.errors,
      warnings: checked.warnings,
      layout: { errors: checked.layout.errors, warnings: checked.layout.warnings },
      modules: checked.storyboard ? moduleIds(checked.storyboard) : [],
      usage,
      cost_usd: cost.estimated_usd,
      cost_warning: cost.warning,
      model: result?.model ?? model,
      response_id: result?.response_id ?? null,
      elapsed_ms: now() - callStarted
    });
    last = checked;
    previous = checked;
    if (checked.ok) break;
  }

  const totals = attempts.reduce((sum, entry) => ({
    input_tokens: sum.input_tokens + entry.usage.input_tokens,
    output_tokens: sum.output_tokens + entry.usage.output_tokens,
    total_tokens: sum.total_tokens + entry.usage.total_tokens
  }), emptyUsage());
  const priced = attempts.filter((entry) => entry.cost_usd != null);
  const costWarnings = [...new Set(attempts.map((entry) => entry.cost_warning).filter(Boolean))];
  return {
    schema_version: STORYBOARD_PLAN_VERSION,
    status: last?.ok ? "passed" : "failed",
    storyboard: last?.storyboard ?? null,
    tier,
    lane,
    model,
    attempts,
    repairs_used: Math.max(0, attempts.length - 1),
    max_repairs: repairs,
    valid_first_attempt: Boolean(attempts[0]?.ok),
    errors: last?.errors ?? [],
    warnings: last?.warnings ?? [],
    layout: last?.layout ?? emptyLayout(),
    usage: totals,
    cost: {
      estimated_usd: Math.round(priced.reduce((sum, entry) => sum + entry.cost_usd, 0) * 1e8) / 1e8,
      complete: priced.length === attempts.length && attempts.length > 0,
      warnings: costWarnings
    },
    elapsed_ms: now() - started,
    phrase_hints: hints
  };
}

// ---------------------------------------------------------------------------
// Checks

/**
 * Check one storyboard the way the planner does. Returns
 * {ok, errors, warnings, storyboard (with safe editorial rects applied), layout:
 * {errors, warnings, findings}}. Error strings are prefixed by stage:
 * "validation:", "tier:", "anchors:", "params:", "layout:".
 */
export function checkStoryboard(input, { words = [], beats = null, tier = "structured" } = {}) {
  const errors = [];
  const warnings = [];
  const layout = emptyLayout();
  const validation = validateStory(input, { modules: knownModules() });
  errors.push(...validation.errors.map((entry) => `validation: ${entry}`));
  warnings.push(...validation.warnings);
  errors.push(...tierErrors(input, tier).map((entry) => `tier: ${entry}`));
  if (errors.length) return { ok: false, errors, warnings, storyboard: input, layout };

  const storyboard = applySafeDefaults(input);
  let resolved;
  try {
    resolved = resolveStory(storyboard, { words, beats });
  } catch (error) {
    errors.push(`anchors: ${message(error)}`);
    return { ok: false, errors, warnings, storyboard, layout };
  }
  const second = validateStory(resolved, { modules: knownModules() });
  errors.push(...second.errors.filter((entry) => !validation.errors.includes(entry)).map((entry) => `validation: ${entry} (after resolving anchors)`));

  const models = new Map();
  for (const scene of resolved.scenes) {
    if (scene.module === "custom") { warnings.push(`${scene.id} is a custom module; its params and layout are not checked here`); continue; }
    try { models.set(scene.id, resolveModule(scene, resolved)); }
    catch (error) { errors.push(`params: ${message(error)}`); }
  }
  if (errors.length) return { ok: false, errors, warnings, storyboard, layout };

  const canvas = { width: resolved.format.width, height: resolved.format.height };
  try {
    const elements = elementsFromStory(resolved, {
      moduleLayout: (scene) => {
        const model = models.get(scene.id);
        if (!model?.layout?.rect) return [];
        return elementsFromEditorialLayout(model.layout, {
          id: scene.id,
          role: model.layout.role ?? (scene.module === "media-window" ? "media" : "text"),
          start: Number(scene.start),
          end: Number(scene.end),
          canvas,
          ...(model.layout.minTextPx !== undefined ? { minTextPx: model.layout.minTextPx } : {}),
          hidesCaptions: model.hidesCaptions === true || model.layout.hidesCaptions === true
        });
      }
    });
    const report = checkLayout({ canvas, elements, duration: Number(resolved.resolved?.duration) || undefined });
    layout.findings = report.findings;
    layout.errors = report.findings.filter((finding) => finding.severity === "error").length;
    layout.warnings = report.findings.filter((finding) => finding.severity !== "error").length;
    for (const finding of report.findings) {
      const line = `${finding.rule} @${finding.at}s [${finding.ids.join(", ")}] ${finding.detail}`;
      if (finding.severity === "error") errors.push(`layout: ${line}`);
      else warnings.push(`layout: ${line}`);
    }
  } catch (error) {
    errors.push(`layout: ${message(error)}`);
  }
  return { ok: errors.length === 0, errors, warnings, storyboard, layout };
}

/** Tier rules (RFC §7) as error strings. */
export function tierErrors(story, tier) {
  const errors = [];
  if (tier === "bespoke") return errors;
  const scenes = Array.isArray(story?.scenes) ? story.scenes : [];
  scenes.forEach((scene, index) => {
    const where = `scenes[${index}]${scene?.id ? ` (${scene.id})` : ""}`;
    if (scene?.module === "custom") errors.push(`${where} uses "custom", which only the bespoke tier may use; pick the nearest catalogue module`);
    if (tier !== "structured") return;
    const params = scene?.params && typeof scene.params === "object" ? scene.params : {};
    for (const key of TUNING_PARAMS) if (key in params) errors.push(`${where}.params.${key} is not allowed in the structured tier; remove it (tooling places and styles modules)`);
    if (scene?.track !== undefined && scene.track !== 0) errors.push(`${where}.track is not allowed in the structured tier; remove it`);
  });
  return errors;
}

/** Copy with every editorial scene that declares no rect placed in the safe slot. */
export function applySafeDefaults(story) {
  const copy = JSON.parse(JSON.stringify(story));
  const rect = SAFE_EDITORIAL_RECTS[formatAspect(copy.format)];
  if (!rect) return copy;
  for (const scene of Array.isArray(copy.scenes) ? copy.scenes : []) {
    if (!scene || !isEditorialKind(scene.module)) continue;
    const params = scene.params && typeof scene.params === "object" ? scene.params : (scene.params = {});
    if (params.rect === undefined) params.rect = { ...rect };
  }
  return copy;
}

// ---------------------------------------------------------------------------
// Inputs and prompts

/** The tooling-owned fields: the model never chooses them (RFC §3). */
export function fixedInputs({ lane, format, brand = DEFAULT_BRAND, audio = null, base = null }) {
  const fixed = {
    lane,
    format: { fps: 30, ...format },
    brand: brand ?? DEFAULT_BRAND,
    audio: {},
    base: null
  };
  if (audio && typeof audio === "object") {
    for (const key of ["voice", "words", "mix"]) if (audio[key] != null) fixed.audio[key] = audio[key];
  }
  if (lane === "footage-led") {
    if (!nonEmpty(base)) throw new Error("the footage-led lane needs a base recording path (assets/…)");
    fixed.base = base;
  }
  return fixed;
}

export function pinInputs(story, fixed) {
  const warnings = [];
  if (!story || typeof story !== "object" || Array.isArray(story)) return { storyboard: story, warnings };
  const copy = JSON.parse(JSON.stringify(story));
  for (const key of ["lane", "format", "brand"]) {
    if (copy[key] !== undefined && JSON.stringify(copy[key]) !== JSON.stringify(fixed[key])) warnings.push(`${key} was changed by the model and has been reset to the fixed input`);
    copy[key] = JSON.parse(JSON.stringify(fixed[key]));
  }
  if (Object.keys(fixed.audio).length) copy.audio = { ...(copy.audio && typeof copy.audio === "object" ? copy.audio : {}), ...fixed.audio };
  if (fixed.lane === "footage-led") copy.base = fixed.base;
  else if (copy.base !== undefined && copy.base !== null) { warnings.push("base is only for the footage-led lane and has been removed"); copy.base = null; }
  if (copy.schema === undefined) copy.schema = "launchclip.story.v1";
  return { storyboard: copy, warnings };
}

function planRequest({ brief, fixed, hints }) {
  const lines = [
    "Write the storyboard for this brief.",
    "",
    "## Brief",
    "",
    String(brief).trim(),
    "",
    "## Fixed inputs (copy exactly)",
    "",
    `lane: ${fixed.lane}`,
    `format: ${JSON.stringify(fixed.format)}`,
    `brand: ${JSON.stringify(fixed.brand)}`
  ];
  if (Object.keys(fixed.audio).length) lines.push(`audio: ${JSON.stringify(fixed.audio)} (add music and sfx as you see fit)`);
  if (fixed.base) lines.push(`base: ${JSON.stringify(fixed.base)}`);
  if (hints.length) {
    lines.push("", "## Phrase hints (from the phrase → module table)", "");
    for (const hint of hints.slice(0, 24)) lines.push(`- "${hint.sentence.slice(0, 160)}" → ${hint.modules.join(", ")}`);
  }
  return `${lines.join("\n")}\n`;
}

function repairRequest({ request, previous, errors, attempt, repairs }) {
  const prior = previous == null ? "(no parseable JSON object was returned)" : typeof previous === "string" ? previous.slice(0, 40_000) : JSON.stringify(previous);
  return [
    request.trimEnd(),
    "",
    `## Repair ${attempt} of ${repairs}`,
    "",
    "Your previous storyboard failed these checks:",
    "",
    ...errors.map((entry) => `- ${entry}`),
    "",
    "Previous storyboard:",
    "",
    prior,
    "",
    "Return the complete corrected storyboard as one JSON object. Fix only the scenes and params the errors name (shorten copy, change a param, retime or swap a scene's module); keep everything else. Keep lane, format, brand, audio and base exactly as given. The checks and their thresholds are fixed and cannot be relaxed.",
    ""
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Model output

/**
 * Pull the storyboard object out of a client result: the strict envelope
 * ({storyboard_json: "<json>"}), a storyboard object returned directly, or
 * raw text (fenced or with prose around one JSON object).
 * → {ok: true, storyboard} | {ok: false, error, text}
 */
export function extractStoryboard(result) {
  const value = result?.value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (typeof value.storyboard_json === "string") return parseText(value.storyboard_json);
    if (value.storyboard_json && typeof value.storyboard_json === "object") return { ok: true, storyboard: value.storyboard_json };
    if (value.storyboard && typeof value.storyboard === "object") return { ok: true, storyboard: value.storyboard };
    if ("scenes" in value || "schema" in value) return { ok: true, storyboard: value };
  }
  if (typeof value === "string") return parseText(value);
  if (typeof result?.text === "string") return parseText(result.text);
  if (typeof result === "string") return parseText(result);
  return { ok: false, error: "the model returned no storyboard JSON", text: null };
}

function parseText(text) {
  const trimmed = String(text ?? "").trim();
  const candidates = [];
  const fence = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n```/i);
  if (fence) candidates.push(fence[1]);
  candidates.push(trimmed);
  const object = firstJsonObject(trimmed);
  if (object) candidates.push(object);
  let lastError = "no JSON object found";
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        if (typeof parsed.storyboard_json === "string") return parseText(parsed.storyboard_json);
        return { ok: true, storyboard: parsed.storyboard && typeof parsed.storyboard === "object" && !parsed.scenes ? parsed.storyboard : parsed };
      }
      lastError = "the JSON value is not an object";
    } catch (error) {
      lastError = error.message;
    }
  }
  return { ok: false, error: `could not parse a storyboard JSON object (${lastError})`, text: trimmed.slice(0, 40_000) };
}

// The first balanced {...} span, honouring strings.
function firstJsonObject(text) {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Clients

/**
 * "provider:model[@reasoning]" → a client with runStructured(). anthropic:<id>
 * uses @anthropic-ai/sdk (ANTHROPIC_API_KEY); openai, openrouter, ollama and
 * compatible use src/model_provider.js (OPENAI_API_KEY, OPENROUTER_API_KEY, …).
 */
export function createPlannerClient(modelSpec, options = {}) {
  const spec = String(modelSpec ?? "").trim();
  if (!spec) throw new Error("No planner model: pass --model provider:model (for example anthropic:<model-id> or openrouter:<vendor>/<model>) or set LAUNCHCLIP_PLANNER_MODEL");
  const separator = spec.indexOf(":");
  const provider = separator > 0 ? spec.slice(0, separator).toLowerCase() : "";
  if (provider === "anthropic") {
    const model = spec.slice(separator + 1);
    return { client: new AnthropicPlannerClient({ model, apiKey: options.apiKey }), provider, model };
  }
  const route = parseModelRoute(spec);
  return { client: (options.createClient ?? createStructuredClient)(route, options), provider: route.provider, model: route.model, reasoning: route.reasoning };
}

export class AnthropicPlannerClient {
  constructor({ model, apiKey, sdk } = {}) {
    if (!nonEmpty(model)) throw new Error("anthropic planner needs a model id");
    this.provider = "anthropic";
    this.model = model;
    this.apiKey = apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!this.apiKey && !sdk) throw new Error("ANTHROPIC_API_KEY is not set");
    this.sdk = sdk ?? null;
  }

  async runStructured(options = {}) {
    if (!this.sdk) {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      this.sdk = new Anthropic({ apiKey: this.apiKey });
    }
    const message = await this.sdk.messages.create({
      model: options.model ?? this.model,
      max_tokens: Number(options.maxOutputTokens ?? 16_000),
      system: String(options.instructions ?? ""),
      messages: [{ role: "user", content: typeof options.input === "string" ? options.input : JSON.stringify(options.input ?? {}) }]
    });
    const text = (message?.content ?? []).filter((block) => block?.type === "text").map((block) => block.text).join("");
    const usage = message?.usage ?? {};
    return {
      response_id: message?.id ?? null,
      model: message?.model ?? this.model,
      status: "completed",
      text,
      value: null,
      usage: {
        input_tokens: Number(usage.input_tokens ?? 0),
        output_tokens: Number(usage.output_tokens ?? 0),
        total_tokens: Number(usage.input_tokens ?? 0) + Number(usage.output_tokens ?? 0),
        cached_tokens: Number(usage.cache_read_input_tokens ?? 0)
      }
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers

function providerOf(client, model) {
  if (client?.provider) return client.provider;
  const spec = String(model ?? "");
  return spec.includes(":") ? spec.split(":")[0] : "unknown";
}

function moduleIds(story) {
  return (Array.isArray(story?.scenes) ? story.scenes : []).map((scene) => scene?.module).filter((id) => typeof id === "string");
}

function normalizeUsage(usage = {}) {
  const input = Number(usage?.input_tokens ?? usage?.prompt_tokens ?? 0) || 0;
  const output = Number(usage?.output_tokens ?? usage?.completion_tokens ?? 0) || 0;
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: Number(usage?.total_tokens) || input + output,
    cached_tokens: Number(usage?.cached_tokens ?? 0) || 0
  };
}

function emptyUsage() {
  return { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
}

function emptyLayout() {
  return { errors: 0, warnings: 0, findings: [] };
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function message(error) {
  return String(error?.message ?? error).replace(/\b(?:sk|sess)-[a-z0-9_-]{12,}\b/gi, "[REDACTED]");
}
