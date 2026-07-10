import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { planLongFormProduction, stitchLongFormPlan } from "../src/long_form_planner.js";
import { ProductionJobStore } from "../src/job_store.js";
import { EVIDENCE_VERSION, PRODUCTION_PLAN_VERSION, validateProductionPlan } from "../src/production_contracts.js";

test("plans long-form productions as resumable outline and parallel chapter jobs", async () => {
  const workspace = await tempWorkspace();
  const { intake, evidence } = context(workspace);
  const calls = [];
  const client = { runStructured: async (request) => {
    calls.push(request.metadata.job_id);
    if (request.metadata.job_id === "creative-outline") return response(outline());
    const id = request.metadata.chapter_id;
    return response(chapterPlan(id));
  } };
  const first = await planLongFormProduction(workspace, { intake, evidence, options: { chapterConcurrency: 2 } }, { client });
  assert.equal(first.planning_mode, "hierarchical");
  assert.equal(first.shots, 4);
  assert.deepEqual(new Set(calls), new Set(["creative-outline", "creative-chapter:chapter-1", "creative-chapter:chapter-2"]));
  const finalPlan = JSON.parse(await readFile(first.plan, "utf8"));
  assert.deepEqual(finalPlan.shots.map((shot) => shot.id), ["chapter-1-shot-1", "chapter-1-shot-2", "chapter-2-shot-1", "chapter-2-shot-2"]);
  assert.deepEqual(finalPlan.shots.map((shot) => shot.start_seconds), [0, 50, 100, 150]);
  assert.equal(finalPlan.format.duration_seconds, 200);
  assert.equal(validateProductionPlan(finalPlan, validationContext(intake, evidence)).ok, true);

  const second = await planLongFormProduction(workspace, { intake, evidence, options: { chapterConcurrency: 2 } }, { client });
  assert.equal(second.cached, true);
  assert.equal(calls.length, 3, "outline and chapters resume from verified artifacts");
  const store = await ProductionJobStore.open(workspace, { create: false });
  assert.deepEqual(store.get("creative-plan").depends_on, ["creative-chapter:chapter-1", "creative-chapter:chapter-2"]);
});

test("stitches an authoritative supplied transcript exactly across chapter plans", () => {
  const full = "One two three four.";
  const words = [
    { word: "One", start: 0, end: 40 },
    { word: "two", start: 50, end: 90 },
    { word: "three", start: 100, end: 140 },
    { word: "four.", start: 150, end: 190 }
  ];
  const stitched = stitchLongFormPlan(outline("supplied"), [chapterPlan("chapter-1", "supplied"), chapterPlan("chapter-2", "supplied")], { transcript: full, words });
  assert.equal(stitched.narration.source, "supplied");
  assert.equal(stitched.narration.full_text, full);
  assert.deepEqual(stitched.shots.map((shot) => shot.voiceover), ["One", "two", "three", "four."]);
  assert.deepEqual(stitched.narration.sections.map((section) => section.text), ["One two", "three four."]);
  assert.equal(stitched.shots.at(-1).end_seconds, 200);
});

function outline(source = "generated") {
  return {
    schema_version: "launchclip.production-outline.v1",
    project: { title: "Long proof", thesis: "Evidence directs the system", audience_promise: "Understand the whole chain", angle: "Causal deep dive", hook: "The repository becomes the director" },
    format: { aspect: "16:9", width: 1920, height: 1080, duration_seconds: 200, language: "en" },
    design: { concept: "Evidence choreography", art_direction: "Subject-specific system diagrams", palette_roles: [{ name: "signal", role: "proof", color_hint: "accent" }], typography: "Editorial", texture: "Depth", composition_logic: "Proof earns space", motion_character: "Developing diagrams", density: "One turn every few seconds" },
    narration: { source, target_wpm: 160, delivery: "clear and causal" },
    audio: { music_prompt: "evolving restrained score", music_strategy: "chapter-level development", sfx_strategy: "semantic proof cues" },
    rubric: [{ id: "rubric-1", criterion: "Every chapter advances", measurement: "Each boundary changes the viewer model", severity: "major" }],
    chapters: [
      { id: "chapter-1", start_seconds: 0, end_seconds: 100, purpose: "Establish", narrative_turn: "Inputs become evidence", opening_state: "Question", closing_state: "Grounded model", evidence_ids: ["ev-1"], resource_ids: ["screen"], presenter_strategy: "hidden" },
      { id: "chapter-2", start_seconds: 100, end_seconds: 200, purpose: "Resolve", narrative_turn: "Evidence becomes motion", opening_state: "Grounded model", closing_state: "Complete pipeline", evidence_ids: ["ev-1"], resource_ids: ["screen"], presenter_strategy: "small inset" }
    ]
  };
}

function chapterPlan(id, source = "generated") {
  const text = id === "chapter-1" ? "Evidence becomes the model." : "The model directs the finished motion. Try it";
  const shot = (shotId, start, end) => ({ id: shotId, start_seconds: start, end_seconds: end, purpose: "Advance chapter", voiceover: text, on_screen_text: ["Proof", "Try it"], evidence_ids: ["ev-1"], resource_ids: ["screen"], presenter: { visible: false, placement: "offstage", size: "none", treatment: "none" }, visual: { description: "Evidence diagram", composition: "Causal hierarchy", typography: "Editorial", background: "Quiet", foreground: "Proof", motion: "Develop and settle", internal_reveals: [{ at_seconds: 5, action: "connect", easing_intent: "accelerate then settle", emphasis: "proof" }] }, transition_out: "state continuation", sfx: [{ at_seconds: 5, cue: "tick", intent: "proof", volume: .3 }] });
  return {
    schema_version: PRODUCTION_PLAN_VERSION,
    project: outline(source).project,
    format: { ...outline(source).format, duration_seconds: 100 },
    design: outline(source).design,
    narration: { source, full_text: text, target_wpm: 160, delivery: "clear", sections: [{ id: "section-1", text, evidence_ids: ["ev-1"] }] },
    audio: outline(source).audio,
    claims: [{ text: "Evidence directs motion", evidence_ids: ["ev-1"], confidence: "verified", qualifier: null }],
    shots: [shot("shot-1", 0, 50), shot("shot-2", 50, 100)],
    rubric: outline(source).rubric
  };
}

function context(workspace) {
  return {
    intake: { workspace, source: { kind: "topic" }, brief: { prompt: "Explain the system", audience: "builders", cta: "Try it", language: "en", duration_seconds: 200, aspect: { id: "16:9", width: 1920, height: 1080, orientation: "landscape" } }, model: { id: "gpt-5.6", reasoning_effort: "xhigh", reasoning_mode: "standard" }, resources: [{ id: "screen", role: "supporting", type: "video", location: "/tmp/screen.mp4", sha256: "screen" }], policies: {} },
    evidence: { schema_version: EVIDENCE_VERSION, source: { kind: "topic", title: "System", summary: "System", location: "notes", url: null, metadata: [] }, items: [{ id: "ev-1", kind: "research", role: "primary", title: "Evidence", content: "Evidence directs motion.", provenance: "notes", sha256: null, claims_allowed: true, truncated: false, metadata: [] }], warnings: [], policies: {} }
  };
}

async function tempWorkspace() {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "launchclip-long-form-"));
  await mkdir(path.join(workspace, "production"), { recursive: true });
  const values = context(workspace);
  await writeFile(path.join(workspace, "production", "intake.json"), `${JSON.stringify(values.intake)}\n`);
  await writeFile(path.join(workspace, "production", "evidence.json"), `${JSON.stringify(values.evidence)}\n`);
  return workspace;
}

function validationContext(intake, evidence) {
  return { evidenceIds: ["ev-1"], claimEligibleEvidenceIds: ["ev-1"], resourceIds: ["screen"], resourceRoles: { screen: "supporting" }, expectedDuration: 200, expectedFormat: { aspect: "16:9", width: 1920, height: 1080, language: "en" }, requestedCta: intake.brief.cta, suppliedTranscript: null };
}

function response(value) { return { response_id: "resp_long_form", model: "gpt-5.6", status: "completed", usage: { total_tokens: 100 }, value }; }
