import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createStructuredClient } from "./model_provider.js";

const STATE_SCHEMA_VERSION = "launchclip.openrouter-free-models.v1";
const DEFAULT_ROLE = "visual-code-author";
const DEFAULT_CONTRACT = "frame-director.v5";
const DEFAULT_TOP_K = 5;
const DEFAULT_PROBE_TIMEOUT_MS = 15_000;
const DEFAULT_PROBE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const REQUIRED_CONTEXT_TOKENS = 64_000;
const DESIGN_WEIGHTS = new Map([
  ["website", .30],
  ["uicomponent", .25],
  ["codecategories", .20],
  ["dataviz", .15]
]);
const CODING_WEIGHT = .10;

export function defaultFreeModelStatePath(env = process.env) {
  return path.resolve(env.LAUNCHCLIP_FREE_MODEL_STATE ?? path.join(os.homedir(), ".launchclip", "openrouter-free-models.json"));
}

export function rankOpenRouterFreeModels(models, benchmarkItems = [], options = {}) {
  const benchmarkIndex = indexUnifiedBenchmarks(benchmarkItems);
  return models
    .filter(isEligibleFreeModel)
    .map((model) => scoreModel(model, benchmarkIndex.get(model.canonical_slug ?? model.id)))
    .sort((left, right) => right.score - left.score || right.coverage - left.coverage || right.family_prior - left.family_prior || left.id.localeCompare(right.id))
    .slice(0, positiveInteger(options.topK ?? DEFAULT_TOP_K, "topK"));
}

export async function selectOpenRouterFreeModels(options = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("OpenRouter free-model discovery requires fetch");
  const baseUrl = String(options.baseUrl ?? process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
  const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
  const statePath = path.resolve(options.statePath ?? defaultFreeModelStatePath());
  const role = String(options.role ?? DEFAULT_ROLE);
  const contract = String(options.contract ?? DEFAULT_CONTRACT);
  const topK = positiveInteger(options.topK ?? DEFAULT_TOP_K, "topK");
  const now = (options.now ?? (() => new Date()))().toISOString();
  const headers = openRouterHeaders(apiKey);
  const catalog = await fetchJson(fetchImpl, `${baseUrl}/models`, { headers }, "OpenRouter model catalog");
  const models = Array.isArray(catalog?.data) ? catalog.data : [];
  const eligible = models.filter(isEligibleFreeModel);
  if (!eligible.length) throw freeModelError("OpenRouter currently exposes no free text models compatible with LaunchClip structured frame authoring");

  const previous = await readState(statePath);
  const reusable = !options.refresh && previous?.schema_version === STATE_SCHEMA_VERSION && previous.role === role && previous.contract === contract
    ? eligible.find((model) => model.id === previous.selected_model)
    : null;
  let warnings = [];
  let candidates = reusable ? reuseCandidates(previous.candidates, eligible, topK) : [];
  if (candidates.length < topK) {
    const benchmarks = await fetchBenchmarks(fetchImpl, baseUrl, headers, Boolean(apiKey));
    warnings = benchmarks.warnings;
    const ranked = rankOpenRouterFreeModels(eligible, benchmarks.data, { topK: Math.max(topK, eligible.length) });
    candidates = mergeCandidates(candidates, ranked, topK);
  }
  if (!candidates.length) throw freeModelError("OpenRouter free models were found, but none could be ranked for LaunchClip frame authoring");
  if (reusable) candidates = moveCandidateFirst(candidates, reusable.id);

  const selected = reusable ? candidates.find((candidate) => candidate.id === reusable.id) ?? candidates[0] : candidates[0];
  const state = {
    schema_version: STATE_SCHEMA_VERSION,
    role,
    contract,
    selected_model: selected.id,
    selected_canonical_slug: selected.canonical_slug,
    verified_free_at: now,
    ranked_at: reusable ? previous.ranked_at : now,
    candidates: candidates.map((candidate) => mergeCandidateHistory(candidate, previous?.candidates)),
    warnings
  };
  await writeState(statePath, state);
  return selectionFromState(statePath, state, reusable ? "sticky" : "ranked");
}

export async function recordOpenRouterFreeModelOutcome(selection, outcome = {}, options = {}) {
  if (!selection?.state_path) return selection;
  const statePath = path.resolve(options.statePath ?? selection.state_path);
  const state = await readState(statePath);
  if (!state?.candidates?.length) return selection;
  const now = (options.now ?? (() => new Date()))().toISOString();
  const winner = outcome.result ? winningCandidate(state.candidates, outcome.result.frames) : null;
  if (winner) {
    state.selected_model = winner.id;
    state.selected_canonical_slug = winner.canonical_slug;
    state.candidates = moveCandidateFirst(state.candidates, winner.id).map((candidate) => candidate.id === winner.id
      ? { ...candidate, successes: Number(candidate.successes ?? 0) + 1, consecutive_failures: 0, last_success_at: now }
      : candidate);
  } else if (outcome.error) {
    const failedId = state.selected_model;
    state.candidates = state.candidates.map((candidate) => candidate.id === failedId
      ? { ...candidate, failures: Number(candidate.failures ?? 0) + 1, consecutive_failures: Number(candidate.consecutive_failures ?? 0) + 1, last_failure_at: now }
      : candidate);
    const next = state.candidates.find((candidate) => candidate.id !== failedId);
    if (next) {
      state.selected_model = next.id;
      state.selected_canonical_slug = next.canonical_slug;
      state.candidates = moveCandidateFirst(state.candidates, next.id);
    }
  }
  await writeState(statePath, state);
  return selectionFromState(statePath, state, winner ? "observed-winner" : outcome.error ? "rotated-after-failure" : selection.source);
}

export async function probeOpenRouterFreeModels(selection, options = {}) {
  if (!selection?.state_path || !selection?.candidates?.length) throw freeModelError("OpenRouter free-model probing requires a persisted candidate selection");
  const statePath = path.resolve(options.statePath ?? selection.state_path);
  const state = await readState(statePath);
  if (!state?.candidates?.length) throw freeModelError("OpenRouter free-model probe state contains no candidates");
  const createClient = options.createClient ?? createStructuredClient;
  const timeoutMs = positiveInteger(options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS, "probe timeoutMs");
  const now = options.now ?? (() => new Date());
  const cacheTtlMs = positiveInteger(options.cacheTtlMs ?? DEFAULT_PROBE_CACHE_TTL_MS, "probe cacheTtlMs");
  const probeStartedAt = now();
  const candidateIds = selection.candidates.map((candidate) => candidate.id).filter((id) => state.candidates.some((candidate) => candidate.id === id));
  const recentlyProbed = (candidate) => Number.isFinite(Date.parse(candidate.last_probe_at)) && probeStartedAt.getTime() - Date.parse(candidate.last_probe_at) <= cacheTtlMs;
  const cached = candidateIds.map((id) => state.candidates.find((candidate) => candidate.id === id)).filter(recentlyProbed);
  const liveIds = cached.filter((candidate) => candidate.last_probe_error == null && Number(candidate.probe_successes ?? 0) > 0).map((candidate) => candidate.id);
  const failures = cached.filter((candidate) => candidate.last_probe_error != null).map((candidate) => `${candidate.id}: ${candidate.last_probe_error}`);
  const probeIds = candidateIds.filter((id) => !cached.some((candidate) => candidate.id === id));

  for (const [index, id] of probeIds.entries()) {
    const candidate = state.candidates.find((entry) => entry.id === id);
    try {
      const client = createClient(`openrouter:${id}@none`, { requestTimeoutMs: timeoutMs, maxRetries: 0, apiKey: options.apiKey });
      const result = await client.runStructured({
        instructions: "You are a LaunchClip model availability probe. Follow the tiny JSON schema exactly.",
        input: "Confirm that this endpoint can produce structured output for a coding task.",
        schema: {
          type: "object",
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
          additionalProperties: false
        },
        schemaName: "launchclip_free_model_probe",
        maxOutputTokens: 32,
        reasoningEffort: "none"
      });
      if (result?.value?.ok !== true) throw new Error("probe response did not confirm structured-output support");
      const probedAt = now().toISOString();
      liveIds.push(candidate.id);
      state.selected_model = liveIds[0];
      state.selected_canonical_slug = state.candidates.find((entry) => entry.id === liveIds[0])?.canonical_slug ?? null;
      state.live_probe_at = probedAt;
      state.candidates = state.candidates.map((entry) => entry.id === candidate.id
        ? { ...entry, probe_successes: Number(entry.probe_successes ?? 0) + 1, consecutive_probe_failures: 0, last_probe_at: probedAt, last_probe_error: null }
        : entry);
      await writeState(statePath, state);
    } catch (error) {
      const probedAt = now().toISOString();
      const message = sanitizeProbeError(error);
      failures.push(`${id}: ${message}`);
      state.candidates = state.candidates.map((entry) => entry.id === id
        ? {
            ...entry,
            probe_failures: Number(entry.probe_failures ?? 0) + 1,
            consecutive_probe_failures: Number(entry.consecutive_probe_failures ?? 0) + 1,
            last_probe_at: probedAt,
            last_probe_error: message
          }
        : entry);
      const nextId = liveIds[0] ?? probeIds[index + 1] ?? null;
      state.selected_model = nextId;
      state.selected_canonical_slug = state.candidates.find((entry) => entry.id === nextId)?.canonical_slug ?? null;
      await writeState(statePath, state);
    }
  }

  if (!liveIds.length) throw freeModelError(`No ranked OpenRouter free model passed the live structured-output probe: ${failures.join("; ")}`);
  const live = new Set(liveIds);
  state.candidates = [...liveIds.map((id) => state.candidates.find((candidate) => candidate.id === id)), ...state.candidates.filter((candidate) => !live.has(candidate.id))];
  state.selected_model = liveIds[0];
  state.selected_canonical_slug = state.candidates[0].canonical_slug;
  await writeState(statePath, state);
  return selectionFromState(statePath, state, probeIds.length ? "live-probe" : "cached-live-probe", liveIds);
}

function isEligibleFreeModel(model) {
  const id = String(model?.id ?? "");
  const output = model?.architecture?.output_modalities ?? [];
  const parameters = new Set(model?.supported_parameters ?? []);
  const context = Number(model?.context_length ?? 0);
  return id.endsWith(":free")
    && id !== "openrouter/free"
    && zeroPrice(model?.pricing?.prompt)
    && zeroPrice(model?.pricing?.completion)
    && (output.includes("text") || /text\s*$/.test(String(model?.architecture?.modality ?? "")))
    && context >= REQUIRED_CONTEXT_TOKENS
    && (parameters.has("structured_outputs") || parameters.has("response_format"))
    && !/(?:safety|guard|moderation|embedding)/i.test(`${id} ${model?.name ?? ""}`);
}

function scoreModel(model, unified = null) {
  const design = new Map();
  for (const entry of model?.benchmarks?.design_arena ?? []) {
    if (entry?.arena === "models" && DESIGN_WEIGHTS.has(entry.category)) design.set(entry.category, Number(entry.win_rate));
  }
  for (const entry of unified?.design ?? []) {
    if (entry?.arena === "models" && DESIGN_WEIGHTS.has(entry.category)) design.set(entry.category, Number(entry.win_rate));
  }
  let weighted = 0;
  let availableWeight = 0;
  const metrics = {};
  for (const [category, weight] of DESIGN_WEIGHTS) {
    const value = design.get(category);
    if (!Number.isFinite(value)) continue;
    metrics[category] = value;
    weighted += value * weight;
    availableWeight += weight;
  }
  const coding = Number(unified?.artificial?.coding_index ?? model?.benchmarks?.artificial_analysis?.coding_index);
  if (Number.isFinite(coding)) {
    metrics.coding = coding;
    weighted += coding * CODING_WEIGHT;
    availableWeight += CODING_WEIGHT;
  }
  const coverage = Math.min(1, availableWeight);
  const prior = familyPrior(model.id);
  const score = availableWeight > 0
    ? (weighted / availableWeight) * (.75 + (.25 * coverage))
    : prior;
  return {
    id: model.id,
    name: model.name ?? model.id,
    canonical_slug: model.canonical_slug ?? model.id.replace(/:free$/, ""),
    score: round(score),
    coverage: round(coverage),
    family_prior: prior,
    context_length: Number(model.context_length),
    max_completion_tokens: finitePositive(model?.top_provider?.max_completion_tokens),
    supports_structured_output: true,
    metrics
  };
}

function indexUnifiedBenchmarks(items) {
  const index = new Map();
  for (const item of items ?? []) {
    const slug = item?.model_permaslug;
    if (!slug) continue;
    const current = index.get(slug) ?? { design: [], artificial: null };
    if (item.source === "design-arena") current.design.push(item);
    else if (item.source === "artificial-analysis") current.artificial = item;
    index.set(slug, current);
  }
  return index;
}

async function fetchBenchmarks(fetchImpl, baseUrl, headers, authenticated) {
  if (!authenticated) return { data: [], warnings: ["OPENROUTER_API_KEY is not set; ranking used benchmark data embedded in the public model catalog."] };
  try {
    const payload = await fetchJson(fetchImpl, `${baseUrl}/benchmarks`, { headers }, "OpenRouter benchmarks");
    return { data: Array.isArray(payload?.data) ? payload.data : [], warnings: [] };
  } catch (error) {
    return { data: [], warnings: [`${error.message}; ranking used benchmark data embedded in the model catalog.`] };
  }
}

async function fetchJson(fetchImpl, url, init, label) {
  let response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    throw freeModelError(`${label} request failed: ${error?.message ?? error}`);
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // The status below is more useful than an unrelated JSON parse error.
  }
  if (!response.ok) throw freeModelError(`${label} failed (${response.status}): ${payload?.error?.message ?? payload?.message ?? "unexpected response"}`);
  return payload;
}

function openRouterHeaders(apiKey) {
  return {
    Accept: "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    ...(process.env.OPENROUTER_HTTP_REFERER ? { "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER } : {}),
    ...(process.env.OPENROUTER_APP_NAME ? { "X-OpenRouter-Title": process.env.OPENROUTER_APP_NAME } : {})
  };
}

function reuseCandidates(stored, eligible, topK) {
  const eligibleById = new Map(eligible.map((model) => [model.id, model]));
  return (stored ?? [])
    .filter((candidate) => eligibleById.has(candidate.id))
    .slice(0, topK)
    .map((candidate) => ({ ...candidate, name: eligibleById.get(candidate.id).name ?? candidate.name }));
}

function mergeCandidates(first, second, topK) {
  const merged = new Map();
  for (const candidate of [...first, ...second]) if (!merged.has(candidate.id)) merged.set(candidate.id, candidate);
  return [...merged.values()].slice(0, topK);
}

function mergeCandidateHistory(candidate, previous = []) {
  const history = previous.find((entry) => entry.id === candidate.id);
  return {
    ...candidate,
    successes: Number(history?.successes ?? 0),
    failures: Number(history?.failures ?? 0),
    consecutive_failures: Number(history?.consecutive_failures ?? 0),
    ...(history?.last_success_at ? { last_success_at: history.last_success_at } : {}),
    ...(history?.last_failure_at ? { last_failure_at: history.last_failure_at } : {})
  };
}

function moveCandidateFirst(candidates, id) {
  const selected = candidates.find((candidate) => candidate.id === id);
  return selected ? [selected, ...candidates.filter((candidate) => candidate.id !== id)] : candidates;
}

function winningCandidate(candidates, frames = []) {
  const counts = new Map();
  for (const frame of frames ?? []) {
    if (frame?.provider !== "openrouter" || frame.cached || frame.fallback) continue;
    const candidate = candidates.find((entry) => modelIdsMatch(entry, frame.model));
    if (candidate) counts.set(candidate.id, (counts.get(candidate.id) ?? 0) + 1);
  }
  return [...candidates].sort((left, right) => (counts.get(right.id) ?? 0) - (counts.get(left.id) ?? 0)).find((candidate) => counts.has(candidate.id)) ?? null;
}

function modelIdsMatch(candidate, value) {
  const model = String(value ?? "");
  return model === candidate.id || model === candidate.canonical_slug || model.replace(/:free$/, "") === candidate.id.replace(/:free$/, "");
}

function selectionFromState(statePath, state, source, routeIds = null) {
  const routeCandidates = routeIds ? routeIds.map((id) => state.candidates.find((candidate) => candidate.id === id)).filter(Boolean) : state.candidates;
  const knownLimits = routeCandidates.map((candidate) => candidate.max_completion_tokens).filter((value) => Number.isFinite(value) && value > 0);
  return {
    source,
    state_path: statePath,
    selected_model: state.selected_model,
    verified_free_at: state.verified_free_at,
    routes: routeCandidates.map((candidate) => `openrouter:${candidate.id}@none`),
    candidates: structuredClone(state.candidates),
    max_completion_tokens: knownLimits.length ? Math.min(...knownLimits) : null,
    warnings: [...(state.warnings ?? [])]
  };
}

async function readState(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function writeState(filePath, state) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filePath);
}

function familyPrior(id) {
  if (/qwen/i.test(id)) return 12;
  if (/gemma/i.test(id)) return 11;
  if (/nemotron/i.test(id)) return 10;
  if (/cohere|command|north/i.test(id)) return 9;
  if (/poolside|laguna/i.test(id)) return 8;
  return 5;
}

function zeroPrice(value) {
  return value !== "" && value != null && Number(value) === 0;
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer`);
  return number;
}

function freeModelError(message) {
  const error = new Error(message);
  error.code = "LAUNCHCLIP_OPENROUTER_FREE_MODELS";
  return error;
}

function sanitizeProbeError(error) {
  return String(error?.message ?? error ?? "unknown probe failure")
    .replace(/\b(?:sk|sess)-[a-z0-9_-]{12,}\b/gi, "[REDACTED]")
    .slice(0, 500);
}
