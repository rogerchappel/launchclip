import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { probeOpenRouterFreeModels, rankOpenRouterFreeModels, recordOpenRouterFreeModelOutcome, selectOpenRouterFreeModels } from "../src/free_model_selector.js";

test("ranks free structured-output models for visual code instead of parameter count", () => {
  const ranked = rankOpenRouterFreeModels([
    model("qwen/qwen-large-but-unbenchmarked:free", { context: 1_000_000 }),
    model("qwen/qwen-visual-coder:free", { design: { website: 64, uicomponent: 62, codecategories: 60, dataviz: 58 } }),
    model("nvidia/nemotron-code:free", { coding: 52 }),
    model("vendor/paid-coder", { prompt: "0.000001", completion: "0.000001", coding: 99 }),
    model("vendor/free-without-schema:free", { parameters: ["max_tokens"], coding: 90 }),
    model("vendor/content-safety:free", { coding: 100 })
  ]);
  assert.deepEqual(ranked.map((entry) => entry.id), [
    "qwen/qwen-visual-coder:free",
    "nvidia/nemotron-code:free",
    "qwen/qwen-large-but-unbenchmarked:free"
  ]);
  assert.equal(ranked[0].metrics.website, 64);
  assert.equal(ranked[2].family_prior, 12);
});

test("keeps a verified winner sticky without catalog access and reranks on refresh", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "launchclip-free-models-"));
  const statePath = path.join(directory, "state.json");
  let catalog = [
    model("qwen/qwen-coder:free", { design: { website: 65, uicomponent: 64, codecategories: 63, dataviz: 62 } }),
    model("google/gemma-code:free", { coding: 45 }),
    model("nvidia/nemotron-code:free", { coding: 42 })
  ];
  let catalogCalls = 0;
  let benchmarkCalls = 0;
  const fetch = async (url) => {
    if (url.endsWith("/models")) {
      catalogCalls += 1;
      return jsonResponse({ data: catalog });
    }
    benchmarkCalls += 1;
    return jsonResponse({ data: [] });
  };
  const first = await selectOpenRouterFreeModels({ fetch, apiKey: "test", statePath, topK: 2, now: () => new Date("2026-07-17T00:00:00Z") });
  assert.equal(first.source, "ranked");
  assert.equal(first.selected_model, "qwen/qwen-coder:free");
  assert.equal(catalogCalls, 1);
  assert.equal(benchmarkCalls, 1);

  const sticky = await selectOpenRouterFreeModels({ fetch: async () => { throw new Error("sticky selection must not fetch the catalog"); }, apiKey: "test", statePath, topK: 2, now: () => new Date("2026-07-20T00:00:00Z") });
  assert.equal(sticky.source, "sticky-state");
  assert.equal(sticky.selected_model, "qwen/qwen-coder:free");
  assert.equal(catalogCalls, 1);
  assert.equal(benchmarkCalls, 1);

  catalog = catalog.filter((entry) => entry.id !== "qwen/qwen-coder:free");
  const reranked = await selectOpenRouterFreeModels({ fetch, apiKey: "test", statePath, topK: 2, refresh: true, now: () => new Date("2026-07-21T00:00:00Z") });
  assert.equal(reranked.source, "ranked");
  assert.equal(reranked.selected_model, "google/gemma-code:free");
  assert.equal(catalogCalls, 2);
  assert.equal(benchmarkCalls, 2);
  assert.equal(JSON.parse(await readFile(statePath, "utf8")).verified_free_at, "2026-07-21T00:00:00.000Z");
});

test("promotes the model that authored accepted frames and rotates after a failed run", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "launchclip-free-outcome-"));
  const statePath = path.join(directory, "state.json");
  const catalog = [
    model("qwen/qwen-coder:free", { design: { website: 65, uicomponent: 64, codecategories: 63, dataviz: 62 } }),
    model("google/gemma-code:free", { coding: 45 })
  ];
  const fetch = async (url) => jsonResponse(url.endsWith("/models") ? { data: catalog } : { data: [] });
  const selected = await selectOpenRouterFreeModels({ fetch, apiKey: "test", statePath, topK: 2 });
  const observed = await recordOpenRouterFreeModelOutcome(selected, {
    result: { frames: [
      { provider: "openrouter", model: "google/gemma-code:free" },
      { provider: "openrouter", model: "google/gemma-code:free" },
      { provider: "openrouter", model: "qwen/qwen-coder:free" }
    ] }
  });
  assert.equal(observed.source, "observed-winner");
  assert.equal(observed.selected_model, "google/gemma-code:free");

  const rotated = await recordOpenRouterFreeModelOutcome(observed, { error: new Error("all routes failed") });
  assert.equal(rotated.source, "rotated-after-failure");
  assert.equal(rotated.selected_model, "qwen/qwen-coder:free");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(state.candidates.find((entry) => entry.id === "google/gemma-code:free").failures, 1);
});

test("probes ranked candidates and persists the first live structured-output route", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "launchclip-free-probe-"));
  const statePath = path.join(directory, "state.json");
  const catalog = [
    model("google/gemma-code:free", { coding: 55 }),
    model("qwen/qwen-coder:free", { coding: 50 })
  ];
  const fetch = async (url) => jsonResponse(url.endsWith("/models") ? { data: catalog } : { data: [] });
  const selected = await selectOpenRouterFreeModels({ fetch, apiKey: "test", statePath, topK: 2 });
  const attempts = [];
  const probed = await probeOpenRouterFreeModels(selected, {
    timeoutMs: 25,
    now: () => new Date("2026-07-17T01:02:03Z"),
    createClient: (route, options) => ({
      runStructured: async (request) => {
        attempts.push({ route, options, request });
        if (route.includes("gemma")) throw new Error("No endpoints found that can handle the requested parameters");
        return { model: "qwen/qwen-coder:free", value: { ok: true } };
      }
    })
  });
  assert.deepEqual(attempts.map((entry) => entry.route), ["openrouter:google/gemma-code:free@none", "openrouter:qwen/qwen-coder:free@none"]);
  assert.equal(attempts[0].options.requestTimeoutMs, 25);
  assert.equal(attempts[0].options.maxRetries, 0);
  assert.equal(attempts[0].request.maxOutputTokens, 32);
  assert.equal(probed.source, "live-probe");
  assert.equal(probed.selected_model, "qwen/qwen-coder:free");
  assert.equal(probed.routes[0], "openrouter:qwen/qwen-coder:free@none");
  assert.equal(probed.routes.length, 1, "probe-failed candidates are excluded from the build routes");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(state.candidates.find((entry) => entry.id === "google/gemma-code:free").probe_failures, 1);
  assert.equal(state.candidates.find((entry) => entry.id === "qwen/qwen-coder:free").probe_successes, 1);
  assert.equal(state.live_probe_at, "2026-07-17T01:02:03.000Z");

  const cached = await probeOpenRouterFreeModels(probed, {
    cacheTtlMs: 6 * 60 * 60 * 1000,
    now: () => new Date("2026-07-17T02:02:03Z"),
    createClient: () => { throw new Error("recent probe results should be reused"); }
  });
  assert.equal(cached.source, "cached-live-probe");
  assert.deepEqual(cached.routes, ["openrouter:qwen/qwen-coder:free@none"]);
});

function model(id, options = {}) {
  const design = Object.entries(options.design ?? {}).map(([category, win_rate]) => ({ arena: "models", category, win_rate, elo: 1200, rank: 1 }));
  return {
    id,
    name: id,
    canonical_slug: id.replace(/:free$/, ""),
    pricing: { prompt: options.prompt ?? "0", completion: options.completion ?? "0" },
    architecture: { modality: "text->text", output_modalities: ["text"] },
    context_length: options.context ?? 131_072,
    top_provider: { max_completion_tokens: 32_768 },
    supported_parameters: options.parameters ?? ["max_tokens", "structured_outputs"],
    benchmarks: {
      design_arena: design,
      ...(options.coding == null ? {} : { artificial_analysis: { coding_index: options.coding } })
    }
  };
}

function jsonResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}
