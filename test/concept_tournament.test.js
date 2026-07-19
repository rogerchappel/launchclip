import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CINEMATIC_CONCEPT_JUDGMENT_VERSION, CINEMATIC_CONCEPT_SET_VERSION } from "../src/cinematic_contracts.js";
import { planConceptTournament } from "../src/concept_tournament.js";
import { ProductionJobStore } from "../src/job_store.js";

test("runs a five-way proposer and independent scored tournament", async () => {
  const workspace = await tempWorkspace();
  const calls = [];
  const client = { runStructured: async (request) => {
    calls.push({ job: request.metadata.job_id, input: JSON.parse(request.input) });
    const value = request.metadata.job_id === "concept-candidates" ? sampleConcepts() : sampleJudgment();
    return { response_id: `response-${calls.length}`, model: "gpt-5.6", status: "completed", value, usage: { total_tokens: 100 } };
  } };

  const result = await planConceptTournament(workspace, { background: false }, { candidateClient: client, judgeClient: client });
  assert.equal(result.selected_id, "concept-1");
  assert.deepEqual(calls.map((entry) => entry.job), ["concept-candidates", "concept-tournament"]);
  assert.equal(calls[0].input.candidate_count, 5);
  assert.equal(calls[1].input.candidates.length, 5);
  assert.equal(calls[1].input.prior_attempt, undefined);
  const canonical = JSON.parse(await readFile(result.concepts, "utf8"));
  assert.equal(canonical.evaluations[0].total_score, 90);
  const store = await ProductionJobStore.open(workspace, { create: false });
  assert.deepEqual(store.get("concept-tournament").depends_on, ["concept-candidates"]);
});

test("reuses content-addressed concept artifacts without another model call", async () => {
  const workspace = await tempWorkspace();
  let calls = 0;
  const client = { runStructured: async (request) => {
    calls += 1;
    return { response_id: `cache-${calls}`, model: "gpt-5.6", status: "completed", value: request.metadata.job_id === "concept-candidates" ? sampleConcepts() : sampleJudgment(), usage: {} };
  } };
  await planConceptTournament(workspace, {}, { client });
  const second = await planConceptTournament(workspace, {}, { client: { runStructured: async () => { throw new Error("cache miss"); } } });
  assert.equal(calls, 2);
  assert.equal(second.cached, true);
});

test("repairs a judge result when its recommendation disagrees with computed scores", async () => {
  const workspace = await tempWorkspace();
  const judgeInputs = [];
  const candidateClient = { runStructured: async () => ({ response_id: "candidate", model: "gpt-5.6", status: "completed", value: sampleConcepts(), usage: {} }) };
  const judgeClient = { runStructured: async (request) => {
    const input = JSON.parse(request.input);
    judgeInputs.push(input);
    const value = sampleJudgment();
    if (judgeInputs.length === 1) value.recommended_id = "concept-5";
    return { response_id: `judge-${judgeInputs.length}`, model: "gpt-5.6", status: "completed", value, usage: {} };
  } };

  const result = await planConceptTournament(workspace, { semanticAttempts: 2 }, { candidateClient, judgeClient });
  assert.equal(result.selected_id, "concept-1");
  assert.equal(judgeInputs.length, 2);
  assert.equal(judgeInputs[1].prior_attempt.recommended_id, "concept-5");
  assert.match(judgeInputs[1].validation_errors_to_repair.join(" "), /deterministic top score/);
});

async function tempWorkspace() {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "launchclip-concepts-"));
  await mkdir(path.join(workspace, "production"), { recursive: true });
  await writeFile(path.join(workspace, "production", "intake.json"), `${JSON.stringify({
    workspace,
    source: { kind: "topic", value: "Cinematic orchestration" },
    brief: { prompt: "Show why causal motion beats slides", audience: "video creators", cta: "Try cinematic", language: "en", duration_seconds: 45, aspect: { id: "9:16", width: 1080, height: 1920, orientation: "portrait" } },
    model: { provider: "openai", id: "gpt-5.6", reasoning_effort: "xhigh", reasoning_mode: "standard" },
    profile: { id: "cinematic", planning: { concept_candidates: 5 }, craft: { target_wpm_minimum: 165, target_wpm_maximum: 180 } },
    resources: [{ id: "resource-1", role: "supporting", type: "image", location: "/tmp/proof.png", catalog: { usage: "screenshot" } }]
  }, null, 2)}\n`);
  await writeFile(path.join(workspace, "production", "evidence.json"), `${JSON.stringify({ items: [
    { id: "evidence-1", kind: "brief", role: "primary", title: "Evidence", content: "Causal motion helps the explanation.", provenance: "user", claims_allowed: true },
    { id: "reference-1", kind: "reference", role: "reference", title: "Reference", content: "Visual pacing reference.", provenance: "user", claims_allowed: false }
  ] }, null, 2)}\n`);
  return workspace;
}

function sampleConcepts() {
  const engines = ["reveal", "transformation", "investigation", "contrarian-proof", "cause-and-effect"];
  return {
    schema_version: CINEMATIC_CONCEPT_SET_VERSION,
    candidates: engines.map((engine, index) => ({
      id: `concept-${index + 1}`,
      title: `Concept ${index + 1}`,
      hook: { spoken_line: `This workflow hides result ${index + 1}.`, open_loop: "What changes?", proof_tease: "Watch the proof move.", promised_payoff: "A memorable causal explanation." },
      audience_tension: "Launch videos become slides.",
      thesis: "One evolving world carries the idea.",
      narrative_engine: engine,
      causal_beats: ["hook", "mechanism", "proof", "payoff"].map((role, beat) => ({ id: `c${index + 1}-b${beat + 1}`, role, turn: `${role} turn`, evidence_ids: role === "proof" ? ["evidence-1"] : [], resource_ids: role === "proof" ? ["resource-1"] : [], visual_opportunity: `${role} object change`, sound_opportunity: `${role} material accent` })),
      art_direction_seed: { visual_metaphor: `World ${index + 1}`, spatial_world: `Spatial world ${index + 1}`, motion_language: "Weighted transformations", transition_logic: "Shared-object handoffs", sound_world: "Tactile pulse" },
      differentiators: [`Hook ${index + 1}`, `World ${index + 1}`],
      risks: []
    }))
  };
}

function sampleJudgment() {
  return {
    schema_version: CINEMATIC_CONCEPT_JUDGMENT_VERSION,
    evaluations: [9, 8, 7, 6, 5].map((value, index) => ({
      candidate_id: `concept-${index + 1}`,
      scores: { scroll_stop: value, promise_clarity: value, audience_fit: value, causality: value, proof: value, visual_originality: value, motion: value, sound: value, feasibility: value },
      penalties: { genericism: 0, slideshow_risk: 0, clickbait_or_unsupported: 0 },
      rationale: `Concept ${index + 1} score rationale.`,
      required_improvements: ["Make proof immediate."]
    })),
    recommended_id: "concept-1",
    selection_rationale: "The strongest hook and visual engine."
  };
}
