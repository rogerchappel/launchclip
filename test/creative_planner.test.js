import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildPlanningInput, planProduction, resolvePlanningMode } from "../src/creative_planner.js";
import { ProductionJobStore } from "../src/job_store.js";
import { EVIDENCE_VERSION, PRODUCTION_PLAN_VERSION } from "../src/production_contracts.js";

test("passes evidence, references, resources, and format to the creative director without choosing a style", () => {
  const intake = sampleIntake();
  const evidence = sampleEvidence();
  const input = JSON.parse(buildPlanningInput(intake, evidence, null, {
    sfxCatalog: ["tick", "fast_whoosh"],
    entityResolution: { matches: [{ id: "refiant", canonical_name: "Refiant AI", display_name: "Refiant", spoken_form: "refine", confidence: 0.98, evidence_supported: true, assets: [{ id: "brand-refiant-logo-default", kind: "logo", variant: "default" }] }] }
  }));
  assert.equal(input.brief.requested_format.id, "9:16");
  assert.deepEqual(input.factual_evidence.map((entry) => entry.id), ["ev-1"]);
  assert.deepEqual(input.creative_references.map((entry) => entry.id), ["ref-1"]);
  assert.deepEqual(input.resources.map((entry) => entry.id), ["screen"]);
  assert.equal(input.narration.source, "generated");
  assert.deepEqual(input.available_sfx, ["tick", "fast_whoosh"]);
  assert.equal(input.brief.prompt, "Lead with the surprising workflow");
  assert.deepEqual(input.canonical_entities[0], {
    id: "refiant",
    canonical_name: "Refiant AI",
    display_name: "Refiant",
    spoken_form: "refine",
    confidence: 0.98,
    evidence_supported: true,
    asset_resource_ids: [{ id: "brand-refiant-logo-default", kind: "logo", variant: "default" }]
  });
});

test("runs GPT-5.6 planning, validates the plan, writes artifacts, and caches verified output", async () => {
  const workspace = await tempWorkspace(sampleIntake());
  await writeFile(path.join(workspace, "production", "entities.json"), JSON.stringify({ matches: [{ id: "example", canonical_name: "Example Inc.", display_name: "Example", spoken_form: "example", confidence: 1, evidence_supported: true, assets: [] }] }));
  const calls = [];
  const client = {
    runStructured: async (options) => {
      calls.push(options);
      await options.onSubmitted({ id: "resp_plan", status: "in_progress" });
      const value = samplePlan();
      value.shots[1].visual.internal_reveals[0].at_seconds = 6;
      value.shots[1].sfx[0].at_seconds = 6.1;
      value.shots[1].visual.events[0].at_seconds = 6.1;
      return { response_id: "resp_plan", model: "gpt-5.6-sol", status: "completed", value, usage: { total_tokens: 1234 } };
    },
    resumeStructured: async (responseId) => {
      assert.equal(responseId, "resp_saved");
      return { response_id: responseId, model: "gpt-5.6-sol", status: "completed", value: samplePlan(), usage: { total_tokens: 12 } };
    }
  };
  const first = await planProduction(workspace, { background: false }, { client });
  assert.equal(first.shots, 2);
  assert.equal(first.response_id, "resp_plan");
  assert.equal(first.cached, false);
  assert.equal(calls[0].model, "gpt-5.6");
  assert.equal(calls[0].reasoningEffort, "xhigh");
  assert.equal(calls[0].schema.additionalProperties, false);
  assert.equal(JSON.parse(calls[0].input).canonical_entities[0].canonical_name, "Example Inc.");
  const noveltyInput = JSON.parse(calls[0].input).visual_novelty;
  assert.equal(noveltyInput.mode, "differentiate");
  assert.equal(noveltyInput.stable_design_system, true);
  assert.match(await readFile(first.script, "utf8"), /Proof becomes the story/);
  assert.match(await readFile(first.storyboard, "utf8"), /fast then settle/);
  assert.equal(JSON.parse(await readFile(first.plan, "utf8")).shots[1].sfx[0].at_seconds, 1.1);
  const fingerprint = JSON.parse(await readFile(path.join(workspace, "production", "plans", "visual-fingerprint.json"), "utf8"));
  assert.equal(fingerprint.episode_concept, "Evidence as choreography");
  assert.deepEqual(fingerprint.representations, ["diagram"]);

  const second = await planProduction(workspace, {}, { client });
  assert.equal(second.cached, true);
  assert.equal(calls.length, 1);

  const store = await ProductionJobStore.open(workspace, { create: false });
  assert.ok(store.get("creative-plan").outputs.some((entry) => entry.path.endsWith("visual-fingerprint.json")));
  await store.markStaleFrom(["creative-plan"]);
  await store.retry("creative-plan");
  await store.markRunning("creative-plan", { provider: "openai", response_id: "resp_saved", status: "in_progress" });
  const resumed = await planProduction(workspace, {}, { client });
  assert.equal(resumed.response_id, "resp_saved");
  assert.equal(calls.length, 1, "resume does not submit another response");

  const changedIntake = sampleIntake();
  changedIntake.model.id = "gpt-5.6-terra";
  await writeFile(path.join(workspace, "production", "intake.json"), `${JSON.stringify({ ...changedIntake, workspace }, null, 2)}\n`);
  await planProduction(workspace, {}, { client });
  assert.equal(calls.length, 2, "changing model configuration invalidates the cached plan");
});

test("binds cinematic edit planning to the selected concept and approved retention story", async () => {
  const intake = sampleIntake();
  intake.profile = { id: "cinematic", craft: { target_wpm_minimum: 165, target_wpm_maximum: 180 } };
  const workspace = await tempWorkspace(intake);
  const story = {
    concept_id: "concept-1",
    format: { aspect: "9:16", width: 1080, height: 1920, duration_seconds: 10, language: "en" },
    narration: { source: "generated", full_text: samplePlan().narration.full_text },
    open_loop: { question: "Where does the proof go?", resolved_by_beat_id: "payoff", midpoint_rehook_beat_id: null }
  };
  await writeFile(path.join(workspace, "production", "story.json"), `${JSON.stringify(story, null, 2)}\n`);
  await writeFile(path.join(workspace, "production", "concepts.json"), `${JSON.stringify({ selected_id: "concept-1", candidates: [{ id: "concept-1", title: "Evidence becomes choreography" }] }, null, 2)}\n`);
  const inputs = [];
  const client = { runStructured: async (request) => {
    inputs.push(JSON.parse(request.input));
    const plan = samplePlan();
    if (inputs.length === 1) plan.narration.full_text = "The planner rewrote the approved story.";
    return { response_id: `cinematic-plan-${inputs.length}`, model: "gpt-5.6", status: "completed", value: plan, usage: {} };
  } };

  const result = await planProduction(workspace, { semanticAttempts: 2 }, { client });
  assert.equal(result.semantic_attempts, 2);
  assert.equal(inputs[0].selected_concept.id, "concept-1");
  assert.equal(inputs[0].retention_story.narration.full_text, story.narration.full_text);
  assert.equal(inputs[0].cinematic_profile.id, "cinematic");
  assert.equal(inputs[1].prior_attempt.narration.full_text, "The planner rewrote the approved story.");
  assert.match(inputs[1].validation_errors_to_repair.join(" "), /retention-story narration must be preserved exactly/);
});

test("creates the planning client from the intake provider route", async () => {
  const intake = sampleIntake();
  intake.model = { provider: "openrouter", id: "openrouter/free", reasoning_effort: "none", reasoning_mode: "standard" };
  const workspace = await tempWorkspace(intake);
  let route;
  let clientOptions;
  const selected = freeSelection(path.join(workspace, "free-model-state.json"));
  const result = await planProduction(workspace, {}, {
    selectOpenRouterFreeModels: async () => selected,
    probeOpenRouterFreeModels: async () => ({ ...selected, source: "live-probe", routes: [selected.routes[0]] }),
    createClient: (received, options) => {
      route = received;
      clientOptions = options;
      return { runStructured: async () => ({ response_id: "free-plan", model: "free-planner", status: "completed", value: samplePlan(), usage: {} }) };
    }
  });
  assert.equal(result.response_id, "free-plan");
  assert.equal(route.provider, "openrouter");
  assert.equal(route.model, "tencent/hy3:free");
  assert.equal(route.reasoning, "none");
  assert.deepEqual(clientOptions, { requestTimeoutMs: 180_000, maxRetries: 0 });
  assert.equal(result.free_model_selection.selected_model, "tencent/hy3:free");
});

test("rotates to the next proven free planner after a full request failure", async () => {
  const intake = sampleIntake();
  intake.model = { provider: "openrouter", id: "openrouter/free", reasoning_effort: "none", reasoning_mode: "standard" };
  const workspace = await tempWorkspace(intake);
  const selected = freeSelection(path.join(workspace, "free-model-state.json"));
  const fallback = {
    ...selected,
    source: "rotated-after-failure",
    selected_model: "google/gemma-4-26b-a4b-it:free",
    routes: ["openrouter:google/gemma-4-26b-a4b-it:free@none"]
  };
  const routes = [];
  const result = await planProduction(workspace, {}, {
    selectOpenRouterFreeModels: async () => selected,
    probeOpenRouterFreeModels: async (_selection, options) => options.excludeIds ? fallback : { ...selected, routes: [selected.routes[0]] },
    recordOpenRouterFreeModelOutcome: async (_selection, outcome) => {
      assert.match(outcome.error.message, /planner timed out/);
      return fallback;
    },
    createClient: (route) => ({ runStructured: async () => {
      routes.push(route.model);
      if (route.model === "tencent/hy3:free") throw new Error("planner timed out");
      return { response_id: "free-plan-fallback", model: route.model, status: "completed", value: samplePlan(), usage: {} };
    } })
  });
  assert.deepEqual(routes, ["tencent/hy3:free", "google/gemma-4-26b-a4b-it:free"]);
  assert.equal(result.free_model_selection.selected_model, "google/gemma-4-26b-a4b-it:free");
});

test("rotates malformed structured output to the next ranked planner without repeating a model", async () => {
  const intake = sampleIntake();
  intake.model = { provider: "openrouter", id: "openrouter/free", reasoning_effort: "none", reasoning_mode: "standard" };
  const workspace = await tempWorkspace(intake);
  const selected = freeSelection(path.join(workspace, "free-model-state.json"));
  const second = {
    ...selected,
    selected_model: "google/gemma-4-26b-a4b-it:free",
    routes: ["openrouter:google/gemma-4-26b-a4b-it:free@none"],
    candidates: [...selected.candidates, { id: "qwen/qwen3-coder:free", score: 30, coverage: 0.5 }]
  };
  const third = {
    ...second,
    selected_model: "qwen/qwen3-coder:free",
    routes: ["openrouter:qwen/qwen3-coder:free@none"]
  };
  const routes = [];
  const result = await planProduction(workspace, {}, {
    selectOpenRouterFreeModels: async () => ({ ...selected, candidates: third.candidates }),
    probeOpenRouterFreeModels: async (_selection, options) => options.excludeIds?.includes("google/gemma-4-26b-a4b-it:free") ? third : options.excludeIds ? second : { ...selected, candidates: third.candidates, routes: [selected.routes[0]] },
    recordOpenRouterFreeModelOutcome: async (selection) => selection.selected_model === "tencent/hy3:free" ? second : third,
    createClient: (route) => ({ runStructured: async () => {
      routes.push(route.model);
      if (route.model === "tencent/hy3:free") throw new Error("planner timed out");
      if (route.model === "google/gemma-4-26b-a4b-it:free") throw new Error("Chat completion structured output was not valid JSON: Unexpected end of JSON input");
      return { response_id: "free-plan-third-route", model: route.model, status: "completed", value: samplePlan(), usage: {} };
    } })
  });
  assert.deepEqual(routes, ["tencent/hy3:free", "google/gemma-4-26b-a4b-it:free", "qwen/qwen3-coder:free"]);
  assert.equal(result.response_id, "free-plan-third-route");
});

test("hands an invalid free plan and exact validator errors to the next model once", async () => {
  const intake = sampleIntake();
  intake.model = { provider: "openrouter", id: "openrouter/free", reasoning_effort: "none", reasoning_mode: "standard" };
  const workspace = await tempWorkspace(intake);
  const selected = freeSelection(path.join(workspace, "free-model-state.json"));
  const fallback = {
    ...selected,
    source: "rotated-after-failure",
    selected_model: "google/gemma-4-26b-a4b-it:free",
    routes: ["openrouter:google/gemma-4-26b-a4b-it:free@none"]
  };
  const calls = [];
  const result = await planProduction(workspace, {}, {
    selectOpenRouterFreeModels: async () => selected,
    probeOpenRouterFreeModels: async (_selection, options) => options.excludeIds ? fallback : { ...selected, routes: [selected.routes[0]] },
    recordOpenRouterFreeModelOutcome: async (_selection, outcome) => {
      assert.match(outcome.error.message, /failed semantic validation/);
      return fallback;
    },
    createClient: (route) => ({ runStructured: async (options) => {
      const input = JSON.parse(options.input);
      calls.push({ model: route.model, input });
      const plan = samplePlan();
      if (route.model === "tencent/hy3:free") plan.claims[0].evidence_ids = ["ref-1"];
      return { response_id: `free-semantic-${calls.length}`, model: route.model, status: "completed", value: plan, usage: {} };
    } })
  });
  assert.deepEqual(calls.map((entry) => entry.model), ["tencent/hy3:free", "tencent/hy3:free", "google/gemma-4-26b-a4b-it:free"]);
  assert.equal(calls[2].input.prior_attempt.claims[0].evidence_ids[0], "ref-1");
  assert.match(calls[2].input.validation_errors_to_repair.join(" "), /ineligible evidence id/);
  assert.equal(result.semantic_attempts, 3);
  assert.equal(result.free_model_selection.selected_model, "google/gemma-4-26b-a4b-it:free");
});

test("feeds a failed plan and exact validator errors into one bounded semantic repair", async () => {
  const workspace = await tempWorkspace(sampleIntake());
  const inputs = [];
  const client = { runStructured: async (options) => {
    const input = JSON.parse(options.input);
    inputs.push(input);
    const value = samplePlan();
    if (inputs.length === 1) value.claims[0].evidence_ids = ["ref-1"];
    return { response_id: `repair-${inputs.length}`, model: "gpt-5.6-sol", status: "completed", value, usage: { total_tokens: 100 * inputs.length } };
  } };
  const result = await planProduction(workspace, { semanticAttempts: 2 }, { client });
  assert.equal(result.semantic_attempts, 2);
  assert.equal(inputs.length, 2);
  assert.equal(inputs[0].prior_attempt, undefined);
  assert.equal(inputs[1].prior_attempt.claims[0].evidence_ids[0], "ref-1");
  assert.match(inputs[1].validation_errors_to_repair.join(" "), /ineligible evidence id: ref-1/);
  const attempts = path.join(workspace, "production", "plans", ".attempts");
  assert.match(await readFile(path.join(attempts, "creative-plan-attempt-1.json"), "utf8"), /ineligible evidence id/);
  assert.match(await readFile(path.join(attempts, "creative-plan-attempt-2.json"), "utf8"), /"errors": \[\]/);
  const store = await ProductionJobStore.open(workspace, { create: false });
  assert.ok(store.get("creative-plan").outputs.some((entry) => entry.path.includes("plans/.attempts/creative-plan-attempt-1.json")));
});

test("normalizes impossible presenter visibility when no presenter asset exists", async () => {
  const workspace = await tempWorkspace(sampleIntake());
  const plan = samplePlan();
  plan.shots[0].presenter = { mode: "companion", visible: true, placement: "bottom", size: "small", treatment: "framed" };
  const result = await planProduction(workspace, {}, {
    client: { runStructured: async () => ({ response_id: "no-presenter", model: "gpt-5.6", status: "completed", value: plan, usage: {} }) }
  });
  const written = JSON.parse(await readFile(result.plan, "utf8"));
  assert.deepEqual(written.shots[0].presenter, { mode: "voiceover", visible: false, placement: "offstage", size: "none", treatment: "framed" });
});

test("normalizes evidence-style prefixes on valid intake resource ids", async () => {
  const workspace = await tempWorkspace(sampleIntake());
  const plan = samplePlan();
  plan.shots[0].resource_ids = ["resource:screen", "resource:screen"];
  plan.shots[0].visual.objects[0].asset_resource_id = "resource:screen";
  const result = await planProduction(workspace, {}, {
    client: { runStructured: async () => ({ response_id: "prefixed-resources", model: "free-planner", status: "completed", value: plan, usage: {} }) }
  });
  const written = JSON.parse(await readFile(result.plan, "utf8"));
  assert.deepEqual(written.shots[0].resource_ids, ["screen"]);
  assert.equal(written.shots[0].visual.objects[0].asset_resource_id, "screen");
  assert.equal(result.semantic_attempts, 1);
});

test("stops semantic repair at the configured bound", async () => {
  const workspace = await tempWorkspace(sampleIntake());
  let calls = 0;
  await assert.rejects(() => planProduction(workspace, { semanticAttempts: 2 }, { client: {
    runStructured: async () => {
      calls += 1;
      const value = samplePlan();
      value.claims[0].evidence_ids = ["ref-1"];
      return { response_id: `invalid-${calls}`, model: "gpt-5.6-sol", status: "completed", value, usage: {} };
    }
  } }), /failed semantic validation after 2 attempts/);
  assert.equal(calls, 2);
});

test("requires an authoritative transcript and preserves it exactly", async () => {
  const intake = sampleIntake();
  intake.policies.supplied_voiceover_is_authoritative = true;
  intake.resources.push({ id: "voice", role: "voiceover", type: "audio", location: "/tmp/voice.mp3", sha256: "v" });
  const missing = await tempWorkspace(intake);
  await assert.rejects(() => planProduction(missing, {}, { client: {} }), /requires a transcript/);

  const evidence = sampleEvidence();
  evidence.items.push({ id: "transcript", kind: "voiceover-transcript", role: "voiceover", title: "Transcript", content: "Exact supplied words.", provenance: "/tmp/voice.mp3", sha256: "v", claims_allowed: false, truncated: false, metadata: [] });
  const workspace = await tempWorkspace(intake, evidence);
  const plan = samplePlan();
  plan.narration.source = "supplied";
  plan.narration.full_text = "Changed words.";
  await assert.rejects(() => planProduction(workspace, {}, { client: { runStructured: async () => ({ response_id: "r", model: "gpt-5.6", status: "completed", value: plan, usage: {} }) } }), /preserved exactly/);
});

test("rejects a model plan that changes the requested canvas", async () => {
  const workspace = await tempWorkspace(sampleIntake());
  const plan = samplePlan();
  plan.format = { ...plan.format, aspect: "16:9", width: 1920, height: 1080 };
  await assert.rejects(() => planProduction(workspace, {}, {
    client: { runStructured: async () => ({ response_id: "r", model: "gpt-5.6", status: "completed", value: plan, usage: {} }) }
  }), /requested aspect/);
});

test("plans supplied narration against Scribe word timing and measured media duration", async () => {
  const intake = sampleIntake();
  intake.policies.supplied_voiceover_is_authoritative = true;
  intake.resources.push({ id: "voice", role: "voiceover", type: "audio", location: "/tmp/voice.mp3", sha256: "v" });
  const evidence = sampleEvidence();
  const workspace = await tempWorkspace(intake, evidence);
  const wordsPath = path.join(workspace, "production", "source-media", "voice.words.json");
  await mkdir(path.dirname(wordsPath), { recursive: true });
  await writeFile(wordsPath, `${JSON.stringify([{ word: "Exact", start: 0.2, end: 4.8 }])}\n`);
  evidence.items.push(
    { id: "resource:voice", kind: "audio-metadata", role: "voiceover", title: "voice", content: JSON.stringify({ format: { duration: "5.25" } }), provenance: "/tmp/voice.mp3", sha256: "v", claims_allowed: false, truncated: false, metadata: [] },
    { id: "voice-transcript", kind: "voiceover-transcript", role: "voiceover", title: "Transcript", content: "Exact", provenance: "/tmp/voice.mp3", sha256: "v", claims_allowed: false, truncated: false, metadata: [{ key: "words_path", value: wordsPath }] }
  );
  await writeFile(path.join(workspace, "production", "evidence.json"), `${JSON.stringify(evidence)}\n`);
  let request;
  const plan = samplePlan();
  plan.format.duration_seconds = 5.25;
  plan.shots = [plan.shots[0]];
  plan.shots[0].end_seconds = 5.25;
  plan.narration.source = "supplied";
  plan.narration.full_text = "Exact";
  await planProduction(workspace, {}, { client: { runStructured: async (options) => { request = JSON.parse(options.input); return { response_id: "r", model: "gpt-5.6", status: "completed", value: plan, usage: {} }; } } });
  assert.equal(request.brief.requested_duration_seconds, 5.25);
  assert.deepEqual(request.narration.word_timing, [{ word: "Exact", start: 0.2, end: 4.8 }]);
});

test("selects hierarchical planning for long productions and delegates the frozen context", async () => {
  assert.equal(resolvePlanningMode("auto", 179, 180), "single");
  assert.equal(resolvePlanningMode("auto", 180, 180), "hierarchical");
  assert.equal(resolvePlanningMode("single", 600, 180), "single");
  assert.throws(() => resolvePlanningMode("unknown", 60), /Unknown planning mode/);
  const intake = sampleIntake();
  intake.brief.duration_seconds = 240;
  const workspace = await tempWorkspace(intake);
  let received;
  const result = await planProduction(workspace, { planningMode: "auto", hierarchicalThresholdSeconds: 180, sfxCatalog: ["tick"] }, {
    planLongFormProduction: async (...args) => { received = args; return { status: "ready", planning_mode: "hierarchical" }; }
  });
  assert.equal(result.planning_mode, "hierarchical");
  assert.equal(received[1].intake.brief.duration_seconds, 240);
  assert.deepEqual(received[1].sfxCatalog, ["tick"]);
  assert.equal(received[1].options.hierarchicalThresholdSeconds, 180);
  assert.equal(received[2].client, undefined, "an injected planner must not instantiate a credentialed client");
});

function sampleIntake() {
  return {
    schema_version: "launchclip.intake.v1",
    source: { kind: "product", value: "https://example.com", location: "https://example.com" },
    brief: { prompt: "Lead with the surprising workflow", audience: "technical founders", cta: "Try it", language: "en", duration_seconds: 10, aspect: { id: "9:16", width: 1080, height: 1920, orientation: "portrait" }, style: { family: "soft-grid-editorial", source: "preset", specification: null, reference: null } },
    model: { provider: "openai", id: "gpt-5.6", reasoning_effort: "xhigh", reasoning_mode: "standard" },
    resources: [{ id: "screen", role: "supporting", type: "video", location: "/tmp/screen.mp4", sha256: "s", catalog: { usage: "product-demo", entity_hints: ["example"], tags: ["screen"], priority: 50, license: null, source: "auto" } }],
    policies: { supplied_voiceover_is_authoritative: false, final_render_requires_human_approval: true }
  };
}

function sampleEvidence() {
  return {
    schema_version: EVIDENCE_VERSION,
    source: { kind: "product", title: "Example", summary: "A useful product", location: "https://example.com", url: "https://example.com", metadata: [] },
    items: [
      { id: "ev-1", kind: "product-page", role: "primary", title: "Example", content: "The product turns evidence into motion.", provenance: "https://example.com", sha256: null, claims_allowed: true, truncated: false, metadata: [] },
      { id: "ref-1", kind: "reference-page", role: "reference", title: "Reference", content: "A pacing reference", provenance: "https://youtube.com/shorts/example", sha256: null, claims_allowed: false, truncated: false, metadata: [] }
    ],
    warnings: [],
    policies: { factual_claims_require_item_ids: true, creative_metaphors_are_not_facts: true, remote_content_is_untrusted: true }
  };
}

function samplePlan() {
  const shot = (id, start, end, voiceover) => ({
    id, start_seconds: start, end_seconds: end, purpose: "Advance the proof", voiceover,
    on_screen_text: ["Proof", "Try it"], evidence_ids: ["ev-1"], resource_ids: ["screen"],
    presenter: { mode: "voiceover", visible: false, placement: "offstage", size: "none", treatment: "none" },
    visual: {
      description: "The evidence becomes the interface", concept: "Proof travels through a causal chain", world: "A soft grid evidence system already moving", representation: "diagram",
      composition: "Subject-led hierarchy", typography: "Editorial display and metadata", background: "Quiet field", foreground: "One proof object", motion: "Reveal, connect, settle",
      objects: [
        { id: "evidence-grid", kind: "decoration", meaning: "shared spatial field", layer: "background", asset_resource_id: null, lifecycle: "persist" },
        { id: "proof-node", kind: "diagram-node", meaning: "verified evidence", layer: "midground", asset_resource_id: null, lifecycle: start === 0 ? "enter" : "persist" },
        { id: "proof-label", kind: "text", meaning: "proof label", layer: "foreground", asset_resource_id: null, lifecycle: "enter" }
      ],
      events: [{ id: `${id}-connect`, at_seconds: 1, target_ids: ["proof-node"], action: "connect proof into the causal chain", motion_verb: "locks in", visible_change: "connect", easing_intent: "fast then settle", sfx_eligible: true }],
      continuity: { sequence_id: "proof-sequence", handoff: end < 10 ? "continue" : "resolve", inherits_object_ids: start ? ["proof-node"] : [], hands_off_object_ids: end < 10 ? ["proof-node"] : [], camera_direction: "rightward", entry_velocity: start ? 360 : 0, exit_velocity: end < 10 ? 360 : 0, motion_blur_px: 12 },
      internal_reveals: [{ at_seconds: 1, action: "connect claim to proof", easing_intent: "fast then settle", emphasis: "proof" }]
    },
    transition_out: "semantic match", sfx: [{ at_seconds: 1, cue: "soft evidence tick", event_id: `${id}-connect`, intent: "mark the proof connection", volume: 0.3 }]
  });
  return {
    schema_version: PRODUCTION_PLAN_VERSION,
    project: { title: "Proof becomes the story", thesis: "Evidence can direct the narrative", audience_promise: "See how it works", angle: "Show the chain", hook: "The proof writes the edit" },
    format: { aspect: "9:16", width: 1080, height: 1920, duration_seconds: 10, language: "en" },
    design: {
      concept: "Evidence as choreography", art_direction: "Original product-specific visual language", palette_roles: [{ name: "signal", role: "verified proof", color_hint: "high-contrast accent" }], typography: "Editorial display with precise metadata", texture: "Subtle depth", composition_logic: "Proof earns visual weight", motion_character: "Semantic reveals and confident holds", density: "One meaningful development every two seconds",
      style_dna: { family: "soft-grid-editorial", source: "preset", canvas: "light", colors: { background: "#F4F0E8", foreground: "#20231F", accent: "#E58B72", supporting: ["#A8D8C7"] }, typography: { display: "Newsreader", body: "Inter", metadata: "DM Mono" }, shape_language: "soft outlined windows", background_system: "moving editorial grid", diagram_language: "causal nodes and clean connectors", presenter_frame: "warm desktop outline", motion_physics: { tempo: "measured", camera_behavior: "continuous lateral drift", primary_ease: "power3.inOut", secondary_ease: "expo.out", motion_blur_px: 12 }, transition_vocabulary: ["velocity push"], forbidden_motifs: ["cyan on black", "caption slideshow"] }
    },
    narration: { source: "generated", full_text: "Proof becomes the story. Then the result lands.", target_wpm: 180, delivery: "direct", sections: [{ id: "section-1", text: "Proof becomes the story.", evidence_ids: ["ev-1"] }] },
    audio: { music_prompt: "restrained pulse with authored development", music_strategy: "support the causal build", sfx_strategy: "small proof ticks and one resolving hit" },
    claims: [{ text: "Evidence becomes motion", evidence_ids: ["ev-1"], confidence: "verified", qualifier: null }],
    shots: [shot("shot-1", 0, 5, "Proof becomes the story."), shot("shot-2", 5, 10, "Then the result lands.")],
    rubric: [{ id: "rubric-1", criterion: "Every hold develops", measurement: "No more than two seconds without a semantic reveal or intentional reading hold", severity: "major" }]
  };
}

function freeSelection(statePath) {
  return {
    source: "ranked",
    state_path: statePath,
    selected_model: "tencent/hy3:free",
    verified_free_at: "2026-07-18T00:00:00.000Z",
    routes: ["openrouter:tencent/hy3:free@none", "openrouter:google/gemma-4-26b-a4b-it:free@none"],
    candidates: [
      { id: "tencent/hy3:free", score: 40, coverage: 0.9 },
      { id: "google/gemma-4-26b-a4b-it:free", score: 34, coverage: 0.1 }
    ],
    warnings: []
  };
}

async function tempWorkspace(intake = sampleIntake(), evidence = sampleEvidence()) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "launchclip-planner-"));
  await mkdir(path.join(workspace, "production"), { recursive: true });
  await writeFile(path.join(workspace, "production", "intake.json"), `${JSON.stringify({ ...intake, workspace }, null, 2)}\n`);
  await writeFile(path.join(workspace, "production", "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  return workspace;
}
