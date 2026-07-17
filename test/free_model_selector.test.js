import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { rankOpenRouterFreeModels, recordOpenRouterFreeModelOutcome, selectOpenRouterFreeModels } from "../src/free_model_selector.js";

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

test("keeps a verified winner sticky and reranks only after it leaves the free catalog", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "launchclip-free-models-"));
  const statePath = path.join(directory, "state.json");
  let catalog = [
    model("qwen/qwen-coder:free", { design: { website: 65, uicomponent: 64, codecategories: 63, dataviz: 62 } }),
    model("google/gemma-code:free", { coding: 45 }),
    model("nvidia/nemotron-code:free", { coding: 42 })
  ];
  let benchmarkCalls = 0;
  const fetch = async (url) => {
    if (url.endsWith("/models")) return jsonResponse({ data: catalog });
    benchmarkCalls += 1;
    return jsonResponse({ data: [] });
  };
  const first = await selectOpenRouterFreeModels({ fetch, apiKey: "test", statePath, topK: 2, now: () => new Date("2026-07-17T00:00:00Z") });
  assert.equal(first.source, "ranked");
  assert.equal(first.selected_model, "qwen/qwen-coder:free");
  assert.equal(benchmarkCalls, 1);

  const sticky = await selectOpenRouterFreeModels({ fetch, apiKey: "test", statePath, topK: 2, now: () => new Date("2026-07-20T00:00:00Z") });
  assert.equal(sticky.source, "sticky");
  assert.equal(sticky.selected_model, "qwen/qwen-coder:free");
  assert.equal(benchmarkCalls, 1);

  catalog = catalog.filter((entry) => entry.id !== "qwen/qwen-coder:free");
  const reranked = await selectOpenRouterFreeModels({ fetch, apiKey: "test", statePath, topK: 2, now: () => new Date("2026-07-21T00:00:00Z") });
  assert.equal(reranked.source, "ranked");
  assert.equal(reranked.selected_model, "google/gemma-code:free");
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
