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

test("enforces the requested output format, duration, language, and exact CTA", () => {
  const plan = samplePlan();
  plan.format = { aspect: "9:16", width: 1080, height: 1920, duration_seconds: 9, language: "fr" };
  const result = validateProductionPlan(plan, {
    evidenceIds: ["ev-1"], resourceIds: ["res-1"], expectedDuration: 10,
    expectedFormat: { aspect: "16:9", width: 1920, height: 1080, language: "en" }, requestedCta: "Start a free workspace"
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("requested aspect")));
  assert.ok(result.errors.some((error) => error.includes("requested width")));
  assert.ok(result.errors.some((error) => error.includes("requested height")));
  assert.ok(result.errors.some((error) => error.includes("requested language")));
  assert.ok(result.errors.some((error) => error.includes("required duration")));
  assert.ok(result.errors.some((error) => error.includes("requested CTA")));
  plan.format = { aspect: "16:9", width: 1920, height: 1080, duration_seconds: 10, language: "en" };
  plan.shots[1].on_screen_text.push("Start a free workspace");
  assert.equal(validateProductionPlan(plan, {
    evidenceIds: ["ev-1"], resourceIds: ["res-1"], expectedDuration: 10,
    expectedFormat: { aspect: "16:9", width: 1920, height: 1080, language: "en" }, requestedCta: "Start a free workspace"
  }).ok, true);
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
  plan.shots[1].visual.events[0].at_seconds = 6.1;
  const normalized = normalizeProductionPlanTiming(plan);
  assert.equal(normalized.shots[1].visual.internal_reveals[0].at_seconds, 1);
  assert.equal(normalized.shots[1].sfx[0].at_seconds, 1.1);
  assert.equal(normalized.shots[1].visual.events[0].at_seconds, 1.1);
  assert.equal(plan.shots[1].visual.internal_reveals[0].at_seconds, 6, "does not mutate the model response");
  assert.equal(validateProductionPlan(normalized, { evidenceIds: ["ev-1"], resourceIds: ["res-1"] }).ok, true);
});

test("canonicalizes model event ids and preserves their SFX bindings without a provider repair", () => {
  const plan = samplePlan();
  plan.shots[0].visual.events.push({
    ...plan.shots[0].visual.events[0],
    id: "Proof lands!",
    at_seconds: 2
  });
  plan.shots[0].visual.events[0].id = "proof appears";
  plan.shots[0].sfx[0].event_id = "proof appears";
  const normalized = normalizeProductionPlanTiming(plan);
  assert.equal(normalized.shots[0].visual.events[0].id, "shot-1-proof-appears");
  assert.equal(normalized.shots[0].visual.events[1].id, "shot-1-proof-lands");
  assert.equal(normalized.shots[0].sfx[0].event_id, "shot-1-proof-appears");
  assert.equal(plan.shots[0].visual.events[0].id, "proof appears", "does not mutate the model response");
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

test("requires motion assertions to target real shot-prefixed elements on truthful local timing", () => {
  const bundle = sampleFrameBundle();
  bundle.motion.assertions.push({ selector: "#missing", appears_by_seconds: 8, order: 1, must_stay_in_frame: false, must_remain_live: false });
  const result = validateFrameBundle(bundle, { shot: sampleShot("shot-1", 0, 5) });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("real shot-prefixed id selector")));
  assert.ok(result.errors.some((error) => error.includes("shot-local duration")));
  assert.ok(result.errors.some((error) => error.includes("duplicates")));
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

test("requires requested source trims to match their HyperFrames playback slots", () => {
  const bundle = sampleFrameBundle();
  bundle.root_media_requests[0].source_end_seconds = 9;
  const result = validateFrameBundle(bundle, { resourceIds: ["res-1"] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("does not infer retiming")));
});

test("requires supplied presenters to be planned and mounted in visible avatar shots", () => {
  const plan = samplePlan();
  const roles = { "res-1": "presenter" };
  assert.equal(validateProductionPlan(plan, { evidenceIds: ["ev-1"], resourceIds: ["res-1"], resourceRoles: roles }).ok, true);
  plan.shots.forEach((shot) => { shot.presenter.visible = false; });
  assert.ok(validateProductionPlan(plan, { resourceIds: ["res-1"], resourceRoles: roles }).errors.some((error) => error.includes("at least one shot")));

  const visibleShot = sampleShot("shot-1", 0, 5);
  const bundle = sampleFrameBundle();
  assert.equal(validateFrameBundle(bundle, { shotId: "shot-1", shot: visibleShot, format: { width: 1920, height: 1080 }, resourceIds: ["res-1"], resourceRoles: roles }).ok, true);
  const laterShot = sampleShot("shot-2", 5, 10);
  assert.ok(validateFrameBundle(bundle, { shot: laterShot, resourceRoles: roles }).errors.some((error) => error.includes("continuous production timeline")));
  bundle.root_media_requests = [];
  assert.ok(validateFrameBundle(bundle, { shot: visibleShot, resourceRoles: roles }).errors.some((error) => error.includes("mount a presenter video")));
});

test("requires long presenter edits to alternate visual modes and keeps voiceover shots offstage", () => {
  const plan = samplePlan();
  plan.format.duration_seconds = 30;
  plan.shots = [sampleShot("shot-1", 0, 10), sampleShot("shot-2", 10, 20), sampleShot("shot-3", 20, 30)];
  const context = { evidenceIds: ["ev-1"], resourceIds: ["res-1"], resourceRoles: { "res-1": "presenter" } };
  const repetitive = validateProductionPlan(plan, context);
  assert.ok(repetitive.errors.some((error) => error.includes("presenter.mode voiceover")));
  assert.ok(repetitive.errors.some((error) => error.includes("at least two presenter visual modes")));
  plan.shots[1].presenter = { mode: "voiceover", visible: false, placement: "offstage", size: "none", treatment: "voiceover only" };
  assert.equal(validateProductionPlan(plan, context).ok, true);

  const bundle = sampleFrameBundle();
  const voiceoverShot = plan.shots[1];
  bundle.root_media_requests[0].source_start_seconds = 10;
  bundle.root_media_requests[0].source_end_seconds = 15;
  assert.ok(validateFrameBundle(bundle, { shot: voiceoverShot, resourceRoles: context.resourceRoles }).errors.some((error) => error.includes("must not mount presenter video")));
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
      density: "A meaningful change every one to two seconds",
      style_dna: {
        family: "soft-grid-editorial", source: "auto", canvas: "light",
        colors: { background: "#F4F0E8", foreground: "#20231F", accent: "#E58B72", supporting: ["#A8D8C7", "#AFC7F5"] },
        typography: { display: "Newsreader", body: "Inter", metadata: "DM Mono" },
        shape_language: "soft outlined windows and rounded diagram nodes",
        background_system: "moving editorial grid with paper grain",
        diagram_language: "clean connectors and labeled causal nodes",
        presenter_frame: "light desktop window with warm outline",
        motion_physics: { tempo: "measured acceleration", camera_behavior: "continuous lateral drift", primary_ease: "power3.inOut", secondary_ease: "expo.out", motion_blur_px: 14 },
        transition_vocabulary: ["velocity-matched push", "directional blur"],
        forbidden_motifs: ["cyan on black", "identical caption cards"]
      }
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
    presenter: { mode: "companion", visible: true, placement: "right third", size: "medium", treatment: "natural cutout" },
    visual: {
      description: "Evidence builds opposite the presenter",
      concept: "A proof node connects the claim to its source",
      world: "A soft editorial evidence map already in motion",
      representation: "diagram",
      composition: "Asymmetric split",
      typography: "Large semantic headline",
      background: "Quiet editorial field",
      foreground: "Proof cards and metadata",
      motion: "Progressive reveals with a soft settle",
      objects: [
        { id: "editorial-grid", kind: "decoration", meaning: "persistent spatial field", layer: "background", asset_resource_id: null, lifecycle: "persist" },
        { id: "proof-node", kind: "diagram-node", meaning: "grounded product proof", layer: "midground", asset_resource_id: null, lifecycle: start === 0 ? "enter" : "persist" },
        { id: "proof-label", kind: "text", meaning: "concise proof label", layer: "foreground", asset_resource_id: null, lifecycle: "enter" }
      ],
      events: [{ id: `${id}-reveal`, at_seconds: 1, target_ids: ["proof-node"], action: "reveal and lock the proof node", motion_verb: "locks in", visible_change: "reveal", easing_intent: "fast then settle", sfx_eligible: true }],
      continuity: {
        sequence_id: "evidence-sequence", handoff: end < 10 ? "continue" : "resolve",
        inherits_object_ids: start > 0 ? ["proof-node"] : [], hands_off_object_ids: end < 10 ? ["proof-node"] : [],
        camera_direction: "left to right", entry_velocity: start > 0 ? 420 : 0, exit_velocity: end < 10 ? 420 : 0, motion_blur_px: 14
      },
      internal_reveals: [{ at_seconds: 1, action: "reveal the proof value", easing_intent: "fast then settle", emphasis: "proof" }]
    },
    transition_out: "content-led cut",
    sfx: [{ at_seconds: 1, cue: "evidence tick", event_id: `${id}-reveal`, intent: "mark the proof reveal", volume: 0.35 }]
  };
}

function sampleFrameBundle() {
  return {
    schema_version: FRAME_BUNDLE_VERSION,
    shot_id: "shot-1",
    html: '<template><div data-composition-id="shot-1" data-width="1920" data-height="1080"><div id="shot-1-proof">Proof</div></div></template>',
    motion: {
      assertions: [{ selector: "#shot-1-proof", appears_by_seconds: 1, order: 1, must_stay_in_frame: true, must_remain_live: true }],
      events: [{ event_id: "shot-1-reveal", object_id: "proof-node", selector: "#shot-1-proof", at_seconds: 1, property: "opacity", visible_change: true }]
    },
    root_media_requests: [{
      resource_id: "res-1", kind: "video", start_seconds: 0, end_seconds: 5,
      source_start_seconds: 0, source_end_seconds: 5, volume: 0,
      presentation: { mode: "companion", frame: "desktop-window", enter: "slide-right", exit: "slide-down", motion_blur_px: 14 },
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
