import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildPlanningInput, planProduction } from "../src/creative_planner.js";
import { EVIDENCE_VERSION, PRODUCTION_PLAN_VERSION } from "../src/production_contracts.js";

test("passes evidence, references, resources, and format to the creative director without choosing a style", () => {
  const intake = sampleIntake();
  const evidence = sampleEvidence();
  const input = JSON.parse(buildPlanningInput(intake, evidence));
  assert.equal(input.brief.requested_format.id, "9:16");
  assert.deepEqual(input.factual_evidence.map((entry) => entry.id), ["ev-1"]);
  assert.deepEqual(input.creative_references.map((entry) => entry.id), ["ref-1"]);
  assert.deepEqual(input.resources.map((entry) => entry.id), ["screen"]);
  assert.equal(input.narration.source, "generated");
  assert.equal(input.brief.prompt, "Lead with the surprising workflow");
});

test("runs GPT-5.6 planning, validates the plan, writes artifacts, and caches verified output", async () => {
  const workspace = await tempWorkspace(sampleIntake());
  const calls = [];
  const client = {
    runStructured: async (options) => {
      calls.push(options);
      await options.onSubmitted({ id: "resp_plan", status: "in_progress" });
      const value = samplePlan();
      value.shots[1].visual.internal_reveals[0].at_seconds = 6;
      value.shots[1].sfx[0].at_seconds = 6.1;
      return { response_id: "resp_plan", model: "gpt-5.6-sol", status: "completed", value, usage: { total_tokens: 1234 } };
    }
  };
  const first = await planProduction(workspace, { background: false }, { client });
  assert.equal(first.shots, 2);
  assert.equal(first.response_id, "resp_plan");
  assert.equal(first.cached, false);
  assert.equal(calls[0].model, "gpt-5.6");
  assert.equal(calls[0].reasoningEffort, "xhigh");
  assert.equal(calls[0].schema.additionalProperties, false);
  assert.match(await readFile(first.script, "utf8"), /Proof becomes the story/);
  assert.match(await readFile(first.storyboard, "utf8"), /fast then settle/);
  assert.equal(JSON.parse(await readFile(first.plan, "utf8")).shots[1].sfx[0].at_seconds, 1.1);

  const second = await planProduction(workspace, {}, { client });
  assert.equal(second.cached, true);
  assert.equal(calls.length, 1);
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

function sampleIntake() {
  return {
    schema_version: "launchclip.intake.v1",
    source: { kind: "product", value: "https://example.com", location: "https://example.com" },
    brief: { prompt: "Lead with the surprising workflow", audience: "technical founders", cta: "Try it", language: "en", duration_seconds: 10, aspect: { id: "9:16", width: 1080, height: 1920, orientation: "portrait" } },
    model: { provider: "openai", id: "gpt-5.6", reasoning_effort: "xhigh", reasoning_mode: "standard" },
    resources: [{ id: "screen", role: "supporting", type: "video", location: "/tmp/screen.mp4", sha256: "s" }],
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
    on_screen_text: ["Proof"], evidence_ids: ["ev-1"], resource_ids: ["screen"],
    presenter: { visible: false, placement: "offstage", size: "none", treatment: "none" },
    visual: { description: "The evidence becomes the interface", composition: "Subject-led hierarchy", typography: "Editorial display and metadata", background: "Quiet field", foreground: "One proof object", motion: "Reveal, connect, settle", internal_reveals: [{ at_seconds: 1, action: "connect claim to proof", easing_intent: "fast then settle", emphasis: "proof" }] },
    transition_out: "semantic match", sfx: [{ at_seconds: 1, cue: "soft evidence tick", intent: "mark the proof connection", volume: 0.3 }]
  });
  return {
    schema_version: PRODUCTION_PLAN_VERSION,
    project: { title: "Proof becomes the story", thesis: "Evidence can direct the narrative", audience_promise: "See how it works", angle: "Show the chain", hook: "The proof writes the edit" },
    format: { aspect: "9:16", width: 1080, height: 1920, duration_seconds: 10, language: "en" },
    design: { concept: "Evidence as choreography", art_direction: "Original product-specific visual language", palette_roles: [{ name: "signal", role: "verified proof", color_hint: "high-contrast accent" }], typography: "Editorial display with precise metadata", texture: "Subtle depth", composition_logic: "Proof earns visual weight", motion_character: "Semantic reveals and confident holds", density: "One meaningful development every two seconds" },
    narration: { source: "generated", full_text: "Proof becomes the story. Then the result lands.", target_wpm: 180, delivery: "direct", sections: [{ id: "section-1", text: "Proof becomes the story.", evidence_ids: ["ev-1"] }] },
    audio: { music_prompt: "restrained pulse with authored development", music_strategy: "support the causal build", sfx_strategy: "small proof ticks and one resolving hit" },
    claims: [{ text: "Evidence becomes motion", evidence_ids: ["ev-1"], confidence: "verified", qualifier: null }],
    shots: [shot("shot-1", 0, 5, "Proof becomes the story."), shot("shot-2", 5, 10, "Then the result lands.")],
    rubric: [{ id: "rubric-1", criterion: "Every hold develops", measurement: "No more than two seconds without a semantic reveal or intentional reading hold", severity: "major" }]
  };
}

async function tempWorkspace(intake = sampleIntake(), evidence = sampleEvidence()) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "launchclip-planner-"));
  await mkdir(path.join(workspace, "production"), { recursive: true });
  await writeFile(path.join(workspace, "production", "intake.json"), `${JSON.stringify({ ...intake, workspace }, null, 2)}\n`);
  await writeFile(path.join(workspace, "production", "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  return workspace;
}
