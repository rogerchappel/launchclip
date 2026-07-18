import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyVisualNoveltyFinding, critiqueProduction } from "../src/production_critic.js";
import { CRITIQUE_VERSION } from "../src/production_contracts.js";

test("gives an independent GPT-5.6 critic the plan, QA evidence, motion profile, and ordered snapshots", async () => {
  const workspace = await fixture();
  let request;
  const client = { runStructured: async (options) => {
    request = options;
    return { response_id: "resp_critic", model: "gpt-5.6-sol", usage: { total_tokens: 1200 }, value: { schema_version: CRITIQUE_VERSION, verdict: "repair", summary: "The proof is legible but the second beat loses hierarchy.", findings: [{ id: "f-1", severity: "major", category: "composition", shot_ids: ["shot-2"], start_seconds: 5, end_seconds: 8, evidence: "The screenshot and presenter occupy the same visual tier.", repair_scope: "frame", instruction: "Reduce presenter occupancy and give the proof card a dominant scale.", preserve: ["lime proof accent", "exact copy"] }] } };
  } };
  const result = await critiqueProduction(workspace, { background: false }, { client });
  assert.equal(result.status, "needs-repair");
  assert.equal(result.verdict, "repair");
  assert.equal(request.model, "gpt-5.6");
  assert.equal(request.reasoningEffort, "xhigh");
  assert.equal(request.images.length, 2);
  assert.match(request.images[0].url, /^data:image\/png;base64,/);
  assert.equal(request.images[0].detail, "low");
  const input = JSON.parse(request.input);
  assert.equal(input.temporal_motion_analysis.family, "rapid-hybrid");
  assert.equal(input.time_aligned_audio_analysis.output.integrated_lufs, -14);
  assert.equal(input.production_expectations.audio, "intentionally-silent");
  assert.equal(input.production_expectations.encoded_frame_count_path, "temporal_motion_analysis.frame_count");
  assert.match(request.instructions, /intentionally-silent/);
  assert.match(request.instructions, /adjacent-frame difference samples/);
  assert.match(request.instructions, /supporting diagnostics, not a substitute/);
  assert.match(request.instructions, /transition wrappers may intentionally enter or leave the canvas/);
  assert.equal(input.deterministic_reports.inspect.stdout.issueCount, 1);
  assert.equal(input.evidence_index[0].content, "The README proves the workflow.");
  assert.equal(input.claim_support[0].evidence[0].id, "ev-1");
  assert.deepEqual(input.snapshot_order, ["001.png", "002.png"]);
  assert.equal(input.visual_evidence.mode, "balanced-frames");
  assert.equal(input.visual_evidence.image_count, 2);
  assert.equal(input.human_review_request, null);
  assert.equal(result.visual_evidence.reused_verification_snapshots, true);
  assert.match(await readFile(result.markdown, "utf8"), /Reduce presenter occupancy/);
});

test("reuses compact contact sheets and maps their source frames to scenes", async () => {
  const workspace = await fixture();
  const snapshots = path.join(workspace, "production", "qa", "snapshots");
  await writeFile(path.join(snapshots, "contact-sheet-1.jpg"), "sheet");
  await writeFile(path.join(snapshots, "frame-00-at-0.0s.png"), "opening");
  await writeFile(path.join(snapshots, "frame-01-at-7.5s.png"), "second scene");
  let request;
  const result = await critiqueProduction(workspace, {}, { client: { runStructured: async (options) => {
    request = options;
    return {
      response_id: "resp_contact_sheet",
      model: "gpt-5.6-sol",
      usage: {},
      value: { schema_version: CRITIQUE_VERSION, verdict: "ship", summary: "The rendered evidence is ready.", findings: [] }
    };
  } } });
  const input = JSON.parse(request.input);
  assert.equal(request.images.length, 1);
  assert.equal(request.images[0].detail, "high");
  assert.deepEqual(input.snapshot_order, ["contact-sheet-1.jpg"]);
  assert.equal(input.visual_evidence.mode, "contact-sheets");
  assert.deepEqual(input.visual_evidence.covered_shot_ids, ["shot-1", "shot-2"]);
  assert.deepEqual(input.visual_evidence.frames.filter((entry) => entry.shot_id).map((entry) => [entry.at_seconds, entry.shot_id]), [[0, "shot-1"], [7.5, "shot-2"]]);
  assert.equal(result.visual_evidence.image_count, 1);
  assert.equal(JSON.parse(await readFile(result.critique, "utf8")).visual_evidence.mode, "contact-sheets");
});

test("turns a human review request into bounded typed repair findings", async () => {
  const workspace = await fixture();
  let request;
  const client = { runStructured: async (options) => {
    request = options;
    return {
      response_id: "resp_human_review",
      model: "gpt-5.6-terra",
      usage: {},
      value: {
        schema_version: CRITIQUE_VERSION,
        verdict: "repair",
        summary: "The reviewer requested more legible supporting text.",
        findings: [{
          id: "human-review-1",
          severity: "major",
          category: "typography",
          shot_ids: ["shot-2"],
          start_seconds: 5,
          end_seconds: 8,
          evidence: "The supporting copy in shot 2 is too small in the supplied snapshot.",
          repair_scope: "frame",
          instruction: "Increase the supporting copy size and reduce its word count.",
          preserve: ["headline", "evidence grounding"]
        }]
      }
    };
  } };
  const result = await critiqueProduction(workspace, { humanReviewRequest: "Make the small copy readable on a phone and use fewer words." }, { client });
  assert.equal(result.verdict, "repair");
  assert.equal(JSON.parse(request.input).human_review_request, "Make the small copy readable on a phone and use fewer words.");
  assert.match(request.instructions, /binding desired change/);
});

test("normalizes a zero-length free-model finding to its affected shot", async () => {
  const workspace = await fixture();
  const result = await critiqueProduction(workspace, {}, { client: { runStructured: async () => ({
    response_id: "resp_normalized_timing",
    model: "example/free-vision-model",
    usage: {},
    value: {
      schema_version: CRITIQUE_VERSION,
      verdict: "repair",
      summary: "The second scene needs one visual adjustment.",
      findings: [{
        id: "timing-1", severity: "major", category: "composition", shot_ids: ["shot-2"],
        start_ids: ["shot-2"],
        start_seconds: 8, end_seconds: 8, evidence: "The visual hierarchy collapses at this frame.",
        repair_scope: "frame", instruction: "Restore a dominant proof object.", preserve: ["narration"]
      }]
    }
  }) } });
  const critique = JSON.parse(await readFile(result.critique, "utf8"));
  assert.equal(critique.findings[0].start_seconds, 8);
  assert.equal(critique.findings[0].end_seconds, 10);
  assert.equal("start_ids" in critique.findings[0], false);
});

test("routes the independent critic through a pinned OpenRouter free model", async () => {
  const workspace = await fixture();
  let route;
  let request;
  const result = await critiqueProduction(workspace, { route: "openrouter:openrouter/free@none" }, {
    createClient: (value) => {
      route = value;
      return { runStructured: async (options) => {
        request = options;
        return {
          response_id: "resp_free_critic",
          model: "example/visual-critic:free",
          usage: { total_tokens: 900 },
          value: { schema_version: CRITIQUE_VERSION, verdict: "ship", summary: "The draft is ready.", findings: [] }
        };
      } };
    }
  });
  assert.equal(route.provider, "openrouter");
  assert.equal(route.model, "openrouter/free");
  assert.equal(route.reasoning, "none");
  assert.equal(request.model, "openrouter/free");
  assert.equal(request.reasoningEffort, "none");
  assert.equal(result.model, "example/visual-critic:free");
});

test("selects and records a proven free vision critic before reviewing pixels", async () => {
  const workspace = await fixture();
  const statePath = path.join(workspace, "vision-state.json");
  const ranked = visionSelection(statePath);
  let selectionOptions;
  let probeOptions;
  let route;
  let request;
  const result = await critiqueProduction(workspace, {
    selectFreeVision: true,
    freeVisionStatePath: statePath,
    freeVisionCandidates: 2,
    freeVisionProbeTimeoutMs: 25
  }, {
    selectOpenRouterFreeVisionModels: async (options) => {
      selectionOptions = options;
      return ranked;
    },
    probeOpenRouterFreeVisionModels: async (selection, options) => {
      assert.equal(selection, ranked);
      probeOptions = options;
      return { ...ranked, source: "live-probe", routes: [ranked.routes[0]] };
    },
    createClient: (value) => {
      route = value;
      return { runStructured: async (options) => {
        request = options;
        return {
          response_id: "resp_selected_vision",
          model: ranked.selected_model,
          usage: {},
          value: { schema_version: CRITIQUE_VERSION, verdict: "ship", summary: "The rendered pixels are ready.", findings: [] }
        };
      } };
    }
  });
  assert.deepEqual(selectionOptions, { statePath, topK: 2, refresh: false });
  assert.deepEqual(probeOptions, { timeoutMs: 25 });
  assert.equal(route.model, "google/gemma-4-31b-it:free");
  assert.equal(request.model, "google/gemma-4-31b-it:free");
  assert.equal(request.promptCacheKey, "launchclip:production-critic:v2");
  assert.equal(result.free_model_selection.selected_model, "google/gemma-4-31b-it:free");
  assert.equal(JSON.parse(await readFile(result.critique, "utf8")).free_model_selection.source, "live-probe");
});

test("rotates to the next proven vision model when the selected critic fails", async () => {
  const workspace = await fixture();
  const ranked = visionSelection(path.join(workspace, "vision-state.json"));
  const rotated = {
    ...ranked,
    source: "rotated-after-failure",
    selected_model: "google/gemma-4-26b-a4b-it:free",
    routes: ["openrouter:google/gemma-4-26b-a4b-it:free@none"],
    candidates: [...ranked.candidates].reverse()
  };
  const routes = [];
  const result = await critiqueProduction(workspace, { selectFreeVision: true }, {
    selectOpenRouterFreeVisionModels: async () => ranked,
    probeOpenRouterFreeVisionModels: async (selection, options) => {
      if (options.excludeIds) {
        assert.equal(selection, rotated);
        assert.deepEqual(options.excludeIds, ["google/gemma-4-31b-it:free"]);
        return { ...rotated, source: "live-probe" };
      }
      return { ...ranked, source: "live-probe", routes: [ranked.routes[0]] };
    },
    recordOpenRouterFreeModelOutcome: async (selection, outcome) => {
      assert.equal(selection.selected_model, "google/gemma-4-31b-it:free");
      assert.match(outcome.error.message, /critic endpoint failed/);
      return rotated;
    },
    createClient: (route) => ({ runStructured: async () => {
      routes.push(route.model);
      if (route.model.includes("31b")) throw new Error("critic endpoint failed");
      return {
        response_id: "resp_fallback_vision",
        model: route.model,
        usage: {},
        value: { schema_version: CRITIQUE_VERSION, verdict: "ship", summary: "The fallback critic reviewed the pixels.", findings: [] }
      };
    } })
  });
  assert.deepEqual(routes, ["google/gemma-4-31b-it:free", "google/gemma-4-31b-it:free", "google/gemma-4-26b-a4b-it:free"]);
  assert.equal(result.free_model_selection.selected_model, "google/gemma-4-26b-a4b-it:free");
});

test("keeps a proven free vision critic when a transient retry succeeds", async () => {
  const workspace = await fixture();
  const ranked = visionSelection(path.join(workspace, "vision-state.json"));
  let attempts = 0;
  let rotations = 0;
  const result = await critiqueProduction(workspace, { selectFreeVision: true }, {
    selectOpenRouterFreeVisionModels: async () => ranked,
    probeOpenRouterFreeVisionModels: async () => ({ ...ranked, source: "live-probe", routes: [ranked.routes[0]] }),
    recordOpenRouterFreeModelOutcome: async () => {
      rotations += 1;
      return ranked;
    },
    createClient: (route) => ({ runStructured: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary critic capacity failure");
      return {
        response_id: "resp_retried_vision",
        model: route.model,
        usage: {},
        value: { schema_version: CRITIQUE_VERSION, verdict: "ship", summary: "The retried critic reviewed the pixels.", findings: [] }
      };
    } })
  });
  assert.equal(attempts, 2);
  assert.equal(rotations, 0);
  assert.equal(result.free_model_selection.selected_model, "google/gemma-4-31b-it:free");
});

test("falls back through the ranked route and OpenRouter free vision router when probes degrade", async () => {
  const workspace = await fixture();
  const ranked = visionSelection(path.join(workspace, "vision-state.json"));
  const rotated = {
    ...ranked,
    source: "rotated-after-failure",
    selected_model: "google/gemma-4-26b-a4b-it:free",
    routes: ["openrouter:google/gemma-4-26b-a4b-it:free@none"],
    candidates: [...ranked.candidates].reverse()
  };
  const routes = [];
  const result = await critiqueProduction(workspace, { selectFreeVision: true }, {
    selectOpenRouterFreeVisionModels: async () => ranked,
    probeOpenRouterFreeVisionModels: async (selection, options) => {
      if (options.excludeIds) throw new Error("free vision probe temporarily unavailable");
      return { ...selection, source: "live-probe", routes: [selection.routes[0]] };
    },
    recordOpenRouterFreeModelOutcome: async () => rotated,
    createClient: (route) => ({ runStructured: async () => {
      routes.push(route.model);
      if (route.model !== "openrouter/free") throw new Error("ranked critic endpoint unavailable");
      return {
        response_id: "resp_router_fallback",
        model: "google/gemma-4-26b-a4b-it:free",
        usage: {},
        value: { schema_version: CRITIQUE_VERSION, verdict: "ship", summary: "The free router reviewed the rendered pixels.", findings: [] }
      };
    } })
  });
  assert.deepEqual(routes, [
    "google/gemma-4-31b-it:free",
    "google/gemma-4-31b-it:free",
    "google/gemma-4-26b-a4b-it:free",
    "openrouter/free"
  ]);
  assert.equal(result.free_model_selection.source, "free-router-fallback");
  assert.equal(result.free_model_selection.selected_model, "google/gemma-4-26b-a4b-it:free");
});

test("attempts ranked vision routes when every live probe is temporarily unavailable", async () => {
  const workspace = await fixture();
  const ranked = visionSelection(path.join(workspace, "vision-state.json"));
  let selects = 0;
  const result = await critiqueProduction(workspace, { selectFreeVision: true }, {
    selectOpenRouterFreeVisionModels: async () => {
      selects += 1;
      return ranked;
    },
    probeOpenRouterFreeVisionModels: async () => { throw new Error("probe transport unavailable"); },
    createClient: (route) => ({ runStructured: async () => ({
      response_id: "resp_direct_ranked",
      model: route.model,
      usage: {},
      value: { schema_version: CRITIQUE_VERSION, verdict: "ship", summary: "The ranked critic reviewed the rendered pixels directly.", findings: [] }
    }) })
  });
  assert.equal(selects, 2);
  assert.equal(result.free_model_selection.source, "probe-degraded");
  assert.match(result.free_model_selection.warnings[0], /attempting ranked routes directly/);
});

test("compacts raw temporal samples before sending a production critique", async () => {
  const workspace = await fixture();
  const qa = path.join(workspace, "production", "qa");
  await writeFile(path.join(qa, "motion.json"), `${JSON.stringify({
    family: "rapid-hybrid",
    motion: { frame_count: 3, frame_difference: [0.1, 0.2] },
    optical_flow: { tracked_frame_pairs: 2, samples: [{ velocity: 1 }, { velocity: 2 }] }
  })}\n`);
  await writeFile(path.join(qa, "audio.json"), `${JSON.stringify({
    expected_audio: true,
    output: { integrated_lufs: -14, peaks: [{ at_seconds: 0, peak_dbfs: -4 }] },
    sources: { voiceover: { integrated_lufs: -15, peaks: [{ at_seconds: 0, peak_dbfs: -5 }] }, music_gain_db: -18 },
    quality: { ok: true, findings: [] }
  })}\n`);
  await writeFile(path.join(qa, "inspect.json"), `${JSON.stringify({
    ok: true,
    stdout: { layout: { ok: true, infoCount: 1, findings: [{ severity: "info", code: "detail" }], samples: [{ at: 0 }, { at: 1 }] } }
  })}\n`);
  let request;
  await critiqueProduction(workspace, {}, { client: { runStructured: async (options) => {
    request = options;
    return {
      response_id: "resp_compact",
      model: "gpt-5.6-sol",
      usage: {},
      value: { schema_version: CRITIQUE_VERSION, verdict: "ship", summary: "Ready.", findings: [] }
    };
  } } });
  const input = JSON.parse(request.input);
  assert.equal(input.temporal_motion_analysis.motion.frame_difference, undefined);
  assert.equal(input.temporal_motion_analysis.motion.frame_difference_sample_count, 2);
  assert.equal(input.temporal_motion_analysis.optical_flow.sample_count, 2);
  assert.equal(input.time_aligned_audio_analysis.output.peaks, undefined);
  assert.equal(input.time_aligned_audio_analysis.output.peaks_sample_count, 1);
  assert.equal(input.time_aligned_audio_analysis.sources.voiceover.peaks_sample_count, 1);
  assert.equal(input.deterministic_reports.inspect.stdout.layout.samples, undefined);
  assert.equal(input.deterministic_reports.inspect.stdout.layout.sample_count, 2);
  assert.equal(input.deterministic_reports.inspect.stdout.layout.omitted_info_findings, 1);
});

test("rejects a critic that ignores a human review request", async () => {
  const workspace = await fixture();
  await assert.rejects(() => critiqueProduction(workspace, { humanReviewRequest: "Make the title larger." }, {
    client: { runStructured: async () => ({
      response_id: "resp_ignored_review",
      model: "gpt-5.6-terra",
      usage: {},
      value: { schema_version: CRITIQUE_VERSION, verdict: "ship", summary: "No changes needed.", findings: [] }
    }) }
  }), /must translate a human review request/);
});

test("rejects unknown shots and a ship verdict containing major findings", async () => {
  const workspace = await fixture();
  const response = (value) => ({ client: { runStructured: async () => ({ response_id: "r", model: "gpt-5.6", usage: {}, value }) } });
  await assert.rejects(() => critiqueProduction(workspace, {}, response({ schema_version: CRITIQUE_VERSION, verdict: "repair", summary: "bad", findings: [{ id: "f", severity: "major", category: "motion", shot_ids: ["missing"], start_seconds: null, end_seconds: null, evidence: "still", repair_scope: "frame", instruction: "move", preserve: [] }] })), /unknown shot/);

  await assert.rejects(() => critiqueProduction(workspace, {}, { client: { runStructured: async () => ({ response_id: "r", model: "gpt-5.6", usage: {}, value: { schema_version: CRITIQUE_VERSION, verdict: "ship", summary: "not really", findings: [{ id: "f", severity: "major", category: "motion", shot_ids: ["shot-1"], start_seconds: null, end_seconds: null, evidence: "still", repair_scope: "frame", instruction: "move", preserve: [] }] } }) } }), /cannot ship with major/);
});

test("turns a failed visual novelty score into a bounded full-plan repair", () => {
  const critique = { schema_version: CRITIQUE_VERSION, verdict: "ship", summary: "The draft is visually sound.", findings: [] };
  const fingerprint = { novelty_assessment: { mode: "differentiate", passes: false, nearest_recent_similarity: 0.81, similarity_limit: 0.58 } };
  const revised = applyVisualNoveltyFinding(critique, fingerprint, ["shot-1", "shot-2"]);
  assert.equal(revised.verdict, "replan");
  assert.equal(revised.findings[0].id, "visual-novelty");
  assert.equal(revised.findings[0].repair_scope, "plan");
  assert.match(revised.findings[0].instruction, /at least four/);
  assert.deepEqual(revised.findings[0].shot_ids, ["shot-1", "shot-2"]);
});

async function fixture() {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "launchclip-critic-"));
  const qa = path.join(workspace, "production", "qa");
  const snapshots = path.join(qa, "snapshots");
  await mkdir(snapshots, { recursive: true });
  await writeFile(path.join(workspace, "production", "plan.json"), `${JSON.stringify({
    project: { title: "Proof" }, format: { duration_seconds: 10 }, design: { concept: "Evidence" }, narration: { full_text: "Proof." }, claims: [{ text: "The workflow is proven", confidence: "verified", qualifier: null, evidence_ids: ["ev-1"] }], rubric: [],
    shots: [{ id: "shot-1", start_seconds: 0, end_seconds: 5 }, { id: "shot-2", start_seconds: 5, end_seconds: 10 }]
  })}\n`);
  await writeFile(path.join(workspace, "production", "evidence.json"), `${JSON.stringify({ items: [{ id: "ev-1", kind: "repository-readme", role: "primary", title: "README", content: "The README proves the workflow.", provenance: "README.md", claims_allowed: true }] })}\n`);
  await writeFile(path.join(qa, "verification.json"), `${JSON.stringify({ failed: [], snapshots })}\n`);
  await writeFile(path.join(qa, "motion.json"), `${JSON.stringify({ family: "rapid-hybrid", motion_bursts_per_minute: 22 })}\n`);
  await writeFile(path.join(qa, "audio.json"), `${JSON.stringify({ expected_audio: false, output: { integrated_lufs: -14 }, quality: { ok: true, findings: [] } })}\n`);
  await writeFile(path.join(qa, "lint.json"), `${JSON.stringify({ ok: true, stdout: { findings: [] } })}\n`);
  await writeFile(path.join(qa, "validate.json"), `${JSON.stringify({ ok: true, stdout: { errors: [] } })}\n`);
  await writeFile(path.join(qa, "inspect.json"), `${JSON.stringify({ ok: false, stdout: { issueCount: 1, issues: [{ code: "text_occluded", severity: "error" }] } })}\n`);
  await writeFile(path.join(snapshots, "002.png"), "second");
  await writeFile(path.join(snapshots, "001.png"), "first");
  return workspace;
}

function visionSelection(statePath) {
  return {
    source: "ranked",
    state_path: statePath,
    selected_model: "google/gemma-4-31b-it:free",
    verified_free_at: "2026-07-18T00:00:00.000Z",
    routes: ["openrouter:google/gemma-4-31b-it:free@none", "openrouter:google/gemma-4-26b-a4b-it:free@none"],
    candidates: [
      { id: "google/gemma-4-31b-it:free", score: 18.75, coverage: 0 },
      { id: "google/gemma-4-26b-a4b-it:free", score: 17.5, coverage: 0 }
    ],
    warnings: []
  };
}
