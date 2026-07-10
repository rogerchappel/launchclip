import assert from "node:assert/strict";
import test from "node:test";
import {
  CRITIQUE_SCHEMA,
  CRITIQUE_VERSION,
  FRAME_BUNDLE_SCHEMA,
  FRAME_BUNDLE_VERSION,
  PRODUCTION_PLAN_SCHEMA,
  PRODUCTION_PLAN_VERSION,
  normalizeProductionPlanTiming,
  validateCritique,
  validateFrameBundle,
  validateProductionPlan
} from "../src/production_contracts.js";

test("OpenAI output schemas make every object strict and fully required", () => {
  for (const schema of [PRODUCTION_PLAN_SCHEMA, FRAME_BUNDLE_SCHEMA, CRITIQUE_SCHEMA]) assertStrictObjects(schema);
});

test("validates a grounded, gap-free production plan", () => {
  const plan = samplePlan();
  assert.deepEqual(validateProductionPlan(plan, { evidenceIds: ["ev-1"], resourceIds: ["res-1"] }), { ok: true, errors: [] });
});

test("rejects timeline gaps, unknown evidence, and changed supplied narration", () => {
  const plan = samplePlan();
  delete plan.design.typography;
  plan.narration.source = "supplied";
  plan.shots[0].end_seconds = 4;
  plan.shots[1].start_seconds = 5;
  plan.shots[1].evidence_ids = ["missing"];
  const result = validateProductionPlan(plan, {
    evidenceIds: ["ev-1"],
    resourceIds: ["res-1"],
    suppliedTranscript: "Authoritative supplied words."
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("plan.design.typography is required")));
  assert.ok(result.errors.some((error) => error.includes("butt-join")));
  assert.ok(result.errors.some((error) => error.includes("unknown id: missing")));
  assert.ok(result.errors.some((error) => error.includes("preserved exactly")));
});

test("rejects unsafe shot IDs and evidence that is not eligible to support claims", () => {
  const plan = samplePlan();
  plan.shots[0].id = "../escape";
  plan.claims[0].evidence_ids = ["ref-1"];
  plan.narration.sections[0].evidence_ids = ["ref-1"];
  const result = validateProductionPlan(plan, {
    evidenceIds: ["ev-1", "ref-1"],
    claimEligibleEvidenceIds: ["ev-1"],
    resourceIds: ["res-1"]
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("shots[0].id must match")));
  assert.ok(result.errors.some((error) => error.includes("claims[0].evidence_ids references ineligible evidence id: ref-1")));
  assert.ok(result.errors.some((error) => error.includes("narration.sections[0].evidence_ids references ineligible evidence id: ref-1")));

  const bundle = sampleFrameBundle();
  bundle.shot_id = "../../outside";
  assert.equal(validateFrameBundle(bundle).ok, false);
});

test("canonicalizes unambiguous global reveal and SFX timestamps into shot-local time", () => {
  const plan = samplePlan();
  plan.shots[1].visual.internal_reveals[0].at_seconds = 6;
  plan.shots[1].sfx[0].at_seconds = 6.1;
  const normalized = normalizeProductionPlanTiming(plan);
  assert.equal(normalized.shots[1].visual.internal_reveals[0].at_seconds, 1);
  assert.equal(normalized.shots[1].sfx[0].at_seconds, 1.1);
  assert.equal(plan.shots[1].visual.internal_reveals[0].at_seconds, 6, "does not mutate the model response");
  assert.equal(validateProductionPlan(normalized, { evidenceIds: ["ev-1"], resourceIds: ["res-1"] }).ok, true);
});

test("frame bundles request root media without owning media tags", () => {
  const bundle = sampleFrameBundle();
  assert.deepEqual(validateFrameBundle(bundle, { shotId: "shot-1", evidenceIds: ["ev-1"], resourceIds: ["res-1"] }), { ok: true, errors: [] });

  bundle.html = '<video src="https://example.com/presenter.mp4"></video><script>Math.random()</script>';
  const invalid = validateFrameBundle(bundle, { shotId: "shot-1", resourceIds: ["res-1"] });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some((error) => error.includes("must not own audio or video")));
  assert.ok(invalid.errors.some((error) => error.includes("remote assets")));
  assert.ok(invalid.errors.some((error) => error.includes("deterministic")));
});

test("rejects active content and assets outside the approved local resource set", () => {
  const bundle = sampleFrameBundle();
  bundle.html = '<style>@import "https://bad.example/x.css"; .x{background:url(file:///etc/passwd)}</style><iframe src="//bad.example"></iframe><script>navigator.sendBeacon("/leak")</script><img src="/tmp/unknown.png" onload="steal()">';
  const result = validateFrameBundle(bundle, { allowedAssetPaths: ["/tmp/approved.png"] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("active embedding")));
  assert.ok(result.errors.some((error) => error.includes("event-handler")));
  assert.ok(result.errors.some((error) => error.includes("network requests")));
  assert.ok(result.errors.some((error) => error.includes("unapproved asset path")));
});

test("critique cannot ship with blocking findings or unknown shots", () => {
  const critique = {
    schema_version: CRITIQUE_VERSION,
    verdict: "ship",
    summary: "Looks good",
    findings: [{
      id: "f-1",
      severity: "blocking",
      category: "mount",
      shot_ids: ["missing-shot"],
      start_seconds: 1,
      end_seconds: 2,
      evidence: "blank assembled frame",
      repair_scope: "assembly",
      instruction: "repair the mount id",
      preserve: []
    }]
  };
  const result = validateCritique(critique, ["shot-1"]);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("blocking findings")));
  assert.ok(result.errors.some((error) => error.includes("unknown shot")));
});

function samplePlan() {
  return {
    schema_version: PRODUCTION_PLAN_VERSION,
    project: { title: "Evidence to motion", thesis: "Proof becomes the story", audience_promise: "Understand the tool", angle: "Show the chain", hook: "One prompt became a production" },
    format: { aspect: "16:9", width: 1920, height: 1080, duration_seconds: 10, language: "en" },
    design: {
      concept: "A moving evidence desk",
      art_direction: "Original editorial system",
      palette_roles: [{ name: "signal", role: "proof", color_hint: "electric citrus" }],
      typography: "Confident grotesk with quiet metadata",
      texture: "Soft paper and restrained grain",
      composition_logic: "Evidence and presenter trade visual weight",
      motion_character: "Fast evidence builds with calm explanatory holds",
      density: "A meaningful change every one to two seconds"
    },
    narration: {
      source: "generated",
      full_text: "The proof appears. The result holds.",
      target_wpm: 180,
      delivery: "direct and measured",
      sections: [{ id: "section-1", text: "The proof appears.", evidence_ids: ["ev-1"] }]
    },
    audio: { music_prompt: "restrained technical pulse", music_strategy: "build under proof", sfx_strategy: "ticks for evidence and one transition hit" },
    claims: [{ text: "The proof appears", evidence_ids: ["ev-1"], confidence: "verified", qualifier: null }],
    shots: [
      sampleShot("shot-1", 0, 5),
      sampleShot("shot-2", 5, 10)
    ],
    rubric: [{ id: "r-1", criterion: "No dead holds", measurement: "motion energy or semantic reveal every two seconds", severity: "major" }]
  };
}

function sampleShot(id, start, end) {
  return {
    id,
    start_seconds: start,
    end_seconds: end,
    purpose: "Show grounded proof",
    voiceover: "The proof appears.",
    on_screen_text: ["Proof appears"],
    evidence_ids: ["ev-1"],
    resource_ids: ["res-1"],
    presenter: { visible: true, placement: "right third", size: "medium", treatment: "natural cutout" },
    visual: {
      description: "Evidence builds opposite the presenter",
      composition: "Asymmetric split",
      typography: "Large semantic headline",
      background: "Quiet editorial field",
      foreground: "Proof cards and metadata",
      motion: "Progressive reveals with a soft settle",
      internal_reveals: [{ at_seconds: 1, action: "reveal the proof value", easing_intent: "fast then settle", emphasis: "proof" }]
    },
    transition_out: "content-led cut",
    sfx: [{ at_seconds: 1, cue: "evidence tick", intent: "mark the proof reveal", volume: 0.35 }]
  };
}

function sampleFrameBundle() {
  return {
    schema_version: FRAME_BUNDLE_VERSION,
    shot_id: "shot-1",
    html: '<template><div data-composition-id="shot-1" data-width="1920" data-height="1080"></div></template>',
    motion: { assertions: [{ selector: "#proof", appears_by_seconds: 1, order: 1, must_stay_in_frame: true, must_remain_live: true }] },
    root_media_requests: [{
      resource_id: "res-1", kind: "video", start_seconds: 0, end_seconds: 5,
      source_start_seconds: 3, source_end_seconds: 8, volume: 0,
      placement: { x: 1180, y: 120, width: 620, height: 840, object_fit: "cover", border_radius: 24, z_index: 3, treatment: "right-third presenter cutout" }
    }],
    evidence_ids: ["ev-1"],
    visible_copy: ["Proof appears"],
    preserve: ["asymmetric balance"]
  };
}

function assertStrictObjects(schema, path = "schema") {
  if (!schema || typeof schema !== "object") return;
  if (schema.type === "object") {
    assert.equal(schema.additionalProperties, false, `${path} must set additionalProperties=false`);
    assert.deepEqual(new Set(schema.required), new Set(Object.keys(schema.properties)), `${path} must require every property`);
    for (const [key, value] of Object.entries(schema.properties)) assertStrictObjects(value, `${path}.${key}`);
  }
  if (schema.items) assertStrictObjects(schema.items, `${path}[]`);
}
