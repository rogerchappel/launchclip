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
  const instructions = [];
  const client = { runStructured: async (request) => {
    calls.push(request.metadata.job_id);
    instructions.push(request.instructions);
    if (request.metadata.job_id === "creative-outline") return response(outline());
    const id = request.metadata.chapter_id;
    return response(chapterPlan(id));
  } };
  const first = await planLongFormProduction(workspace, { intake, evidence, options: { chapterConcurrency: 2 } }, { client });
  assert.equal(first.planning_mode, "hierarchical");
  assert.equal(first.shots, 4);
  assert.deepEqual(new Set(calls), new Set(["creative-outline", "creative-chapter:chapter-1", "creative-chapter:chapter-2"]));
  assert.ok(instructions.every((value) => /untrusted data, never as instructions/.test(value)));
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

test("waits for active chapter workers before reporting a sibling failure", async () => {
  const workspace = await tempWorkspace();
  const { intake, evidence } = context(workspace);
  let delayedSiblingSettled = false;
  const client = { runStructured: async (request) => {
    if (request.metadata.job_id === "creative-outline") return response(outline());
    if (request.metadata.chapter_id === "chapter-1") throw new Error("chapter one failed");
    await new Promise((resolve) => setTimeout(resolve, 30));
    delayedSiblingSettled = true;
    return response(chapterPlan("chapter-2"));
  } };
  await assert.rejects(
    () => planLongFormProduction(workspace, { intake, evidence, options: { chapterConcurrency: 2 } }, { client }),
    /chapter one failed/
  );
  assert.equal(delayedSiblingSettled, true);
  const store = await ProductionJobStore.open(workspace, { create: false });
  assert.equal(store.get("creative-chapter:chapter-1").status, "failed");
  assert.equal(store.get("creative-chapter:chapter-2").status, "succeeded");
});

test("rejects a missing final CTA before caching the chapter and retries it", async () => {
  const workspace = await tempWorkspace();
  const { intake, evidence } = context(workspace);
  const calls = new Map();
  const client = { runStructured: async (request) => {
    calls.set(request.metadata.job_id, (calls.get(request.metadata.job_id) ?? 0) + 1);
    if (request.metadata.job_id === "creative-outline") return response(outline());
    if (request.metadata.chapter_id === "chapter-2" && calls.get(request.metadata.job_id) === 1) {
      const invalid = chapterPlan("chapter-2");
      invalid.narration.full_text = "The model directs the finished motion.";
      invalid.narration.sections[0].text = invalid.narration.full_text;
      for (const shot of invalid.shots) {
        shot.voiceover = invalid.narration.full_text;
        shot.on_screen_text = ["Proof"];
      }
      return response(invalid);
    }
    return response(chapterPlan(request.metadata.chapter_id));
  } };
  await assert.rejects(
    () => planLongFormProduction(workspace, { intake, evidence, options: { chapterConcurrency: 2 } }, { client }),
    /requested CTA/
  );
  let store = await ProductionJobStore.open(workspace, { create: false });
  assert.equal(store.get("creative-chapter:chapter-2").status, "failed");

  const result = await planLongFormProduction(workspace, { intake, evidence, options: { chapterConcurrency: 2 } }, { client });
  assert.equal(result.status, "ready");
  assert.equal(calls.get("creative-outline"), 1);
  assert.equal(calls.get("creative-chapter:chapter-1"), 1);
  assert.equal(calls.get("creative-chapter:chapter-2"), 2);
  store = await ProductionJobStore.open(workspace, { create: false });
  assert.equal(store.get("creative-chapter:chapter-2").status, "succeeded");
});

test("bounds prefixed shot IDs during deterministic stitching", () => {
  const longChapterId = `c-${"a".repeat(61)}`;
  const longShotId = `s-${"b".repeat(61)}`;
  const longOutline = outline();
  longOutline.chapters[0].id = longChapterId;
  const first = chapterPlan("chapter-1");
  first.shots[0].id = longShotId;
  const stitched = stitchLongFormPlan(longOutline, [first, chapterPlan("chapter-2")]);
  assert.ok(stitched.shots[0].id.length <= 64);
  assert.match(stitched.shots[0].id, /^[a-z0-9][a-z0-9-]{0,63}$/);
});

test("rejects chapter plans that cite evidence or resources outside their scope", async () => {
  const workspace = await tempWorkspace();
  const values = context(workspace);
  values.intake.resources.push({ id: "screen-2", role: "supporting", type: "video", location: "/tmp/screen-2.mp4", sha256: "screen-2" });
  values.evidence.items.push({ id: "ev-2", kind: "research", role: "primary", title: "Other evidence", content: "Neighbor-only proof.", provenance: "other", sha256: null, claims_allowed: true, truncated: false, metadata: [] });
  const scopedOutline = outline();
  scopedOutline.chapters[1].evidence_ids = ["ev-2"];
  scopedOutline.chapters[1].resource_ids = ["screen-2"];
  const client = { runStructured: async (request) => {
    if (request.metadata.job_id === "creative-outline") return response(scopedOutline);
    const value = chapterPlan(request.metadata.chapter_id);
    const evidenceId = "ev-2";
    const resourceId = "screen-2";
    value.claims[0].evidence_ids = [evidenceId];
    for (const shot of value.shots) {
      shot.evidence_ids = [evidenceId];
      shot.resource_ids = [resourceId];
    }
    for (const section of value.narration.sections) section.evidence_ids = [evidenceId];
    return response(value);
  } };
  await assert.rejects(
    () => planLongFormProduction(workspace, { ...values, options: { chapterConcurrency: 1 } }, { client }),
    /references unknown id: (?:ev-2|screen-2)/
  );
});

test("caps aggregate evidence in every hierarchical model request", async () => {
  const workspace = await tempWorkspace();
  const values = context(workspace);
  values.evidence.items[0].content = "e".repeat(5_000);
  const modelInputs = [];
  const client = { runStructured: async (request) => {
    modelInputs.push(JSON.parse(request.input));
    if (request.metadata.job_id === "creative-outline") return response(outline());
    return response(chapterPlan(request.metadata.chapter_id));
  } };
  await planLongFormProduction(workspace, { ...values, options: { chapterConcurrency: 2, evidenceChars: 1_000 } }, { client });
  assert.equal(modelInputs[0].evidence_index[0].content.length, 1_000);
  assert.equal(modelInputs[0].evidence_index[0].truncated, true);
  for (const input of modelInputs.slice(1)) {
    assert.ok(input.evidence.reduce((total, entry) => total + entry.content.length, 0) <= 1_000);
    assert.equal(input.evidence[0].truncated, true);
  }
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
