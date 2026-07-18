import assert from "node:assert/strict";
import test from "node:test";
import { buildBlueprintFrameInput, buildFrameBlueprintInput, FRAME_BLUEPRINT_VERSION, normalizeFrameBlueprint, validateFrameBlueprint } from "../src/frame_blueprint.js";

test("builds a compact blueprint packet and a smaller implementation handoff", () => {
  const context = fixture();
  const blueprintInput = JSON.parse(buildFrameBlueprintInput(context));
  const implementationInput = JSON.parse(buildBlueprintFrameInput({ ...context, blueprint: validBlueprint() }));

  assert.equal(blueprintInput.shot.id, "shot-1");
  assert.deepEqual(blueprintInput.required_object_ids, ["proof-node", "proof-label"]);
  assert.deepEqual(blueprintInput.required_events, [{ id: "shot-1-reveal", target_ids: ["proof-node"], at_seconds: 1 }]);
  assert.equal(blueprintInput.supporting_motion_contract.required_supporting_beats, 2);
  assert.deepEqual(blueprintInput.supporting_motion_contract.windows.map((entry) => entry.id), ["opening", "closing"]);
  assert.equal(blueprintInput.supporting_motion_contract.windows[0].start_seconds, 0);
  assert.ok(blueprintInput.supporting_motion_contract.windows[0].end_seconds <= .1);
  assert.equal(blueprintInput.supporting_motion_contract.windows[0].minimum_duration_seconds, .55);
  assert.equal(blueprintInput.supporting_motion_contract.windows[0].minimum_affected_canvas_percent, 30);
  assert.deepEqual(blueprintInput.supporting_motion_contract.windows[1].recommended_eases, ["none", "power1.inOut"]);
  assert.deepEqual(blueprintInput.supporting_motion_contract.windows[0].copy_one_large_area_change, [
    { property: "x", from_value: -108, to_value: 0 },
    { property: "y", from_value: 108, to_value: 0 },
    { property: "scale", from_value: .82, to_value: 1 },
    { property: "rotation", from_value: -12, to_value: 0 }
  ]);
  assert.deepEqual(blueprintInput.supporting_motion_contract.windows[1].copy_one_large_area_change.at(-1), { property: "opacity", from_value: .45, to_value: 1 });
  assert.equal(blueprintInput.supporting_motion_contract.opening_hook_magnitudes.x, 64);
  assert.equal(blueprintInput.supporting_motion_contract.large_area_minimum_change_magnitudes.x, 96);
  assert.ok(blueprintInput.evidence[0].content.length <= 1_200);
  assert.ok(blueprintInput.narration_anchors.length <= 8);
  assert.equal(implementationInput.scene_blueprint.schema_version, FRAME_BLUEPRINT_VERSION);
  assert.equal(implementationInput.shot_contract.id, "shot-1");
  assert.equal(implementationInput.shot, undefined);
  assert.ok(implementationInput.evidence[0].content.length <= 800);
});

test("validates complete object, event, selector, timing, copy, and density handoffs", () => {
  const { shot } = fixture();
  assert.deepEqual(validateFrameBlueprint(validBlueprint(), shot), { ok: true, errors: [] });

  const invalid = validBlueprint();
  invalid.elements[0].selector = "#wrong-proof";
  invalid.elements.pop();
  invalid.motion_beats[0].at_seconds = 4;
  invalid.supporting_motion_beats[0].at_seconds = 2;
  invalid.supporting_motion_beats[0].changes = [{ property: "opacity", from_value: 0, to_value: .1 }];
  invalid.supporting_motion_beats[0].affected_canvas_percent = 12;
  invalid.supporting_motion_beats[0].ease = "none";
  invalid.supporting_motion_beats[0].object_id = "evidence-grid";
  invalid.supporting_motion_beats[1].object_id = "evidence-grid";
  invalid.visible_copy = [];
  invalid.density.minimum_semantic_objects = 1;
  invalid.density.focal_element_selector = "#missing";
  const validation = validateFrameBlueprint(invalid, shot);

  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /selector must begin #shot-1-/);
  assert.match(validation.errors.join("\n"), /elements must include planned object: proof-label/);
  assert.match(validation.errors.join("\n"), /at_seconds must preserve 1/);
  assert.match(validation.errors.join("\n"), /at_seconds must be inside opening/);
  assert.match(validation.errors.join("\n"), /requires at least one change at the minimum perceptible magnitude/);
  assert.match(validation.errors.join("\n"), /opening requires a hook-scale/);
  assert.match(validation.errors.join("\n"), /must copy one complete object/);
  assert.match(validation.errors.join("\n"), /affected_canvas_percent must be at least 30/);
  assert.match(validation.errors.join("\n"), /ease must be one of power3\.out, expo\.out/);
  assert.match(validation.errors.join("\n"), /object_id is not planned: evidence-grid/);
  assert.match(validation.errors.join("\n"), /target semantic objects at least 1 times/);
  assert.match(validation.errors.join("\n"), /visible_copy must preserve: Proof/);
  assert.match(validation.errors.join("\n"), /focal_element_selector is unknown/);
  assert.match(validation.errors.join("\n"), /minimum_semantic_objects must be at least 2/);
});

test("accepts creative opening metadata when the measurable hook contract passes", () => {
  const { shot } = fixture();
  const blueprint = validBlueprint();
  blueprint.supporting_motion_beats[0].intent = "emphasis";
  blueprint.density.focal_element_selector = "#shot-1-label";

  assert.deepEqual(validateFrameBlueprint(blueprint, shot), { ok: true, errors: [] });
});

test("normalizes mechanical free-model blueprint drift without replacing its visual intent", () => {
  const { shot } = fixture();
  const blueprint = validBlueprint();
  blueprint.zones[1].y_percent = 95;
  blueprint.motion_beats = [
    { ...blueprint.motion_beats[0], event_id: "shot-1-reveal-proof", action: "Drop the authored proof node into its final position" },
    { ...blueprint.motion_beats[0], event_id: "shot-1-reveal-label", object_id: "proof-label", selector: "#shot-1-label" }
  ];
  blueprint.density.minimum_semantic_objects = 1;

  const normalized = normalizeFrameBlueprint(blueprint, shot);

  assert.equal(blueprint.zones[1].y_percent, 95, "normalization does not mutate the model response");
  assert.equal(normalized.zones[1].y_percent, 88);
  assert.deepEqual(normalized.motion_beats, [{
    event_id: "shot-1-reveal",
    object_id: "proof-node",
    selector: "#shot-1-proof",
    at_seconds: 1,
    action: "Drop the authored proof node into its final position"
  }]);
  assert.equal(normalized.density.minimum_semantic_objects, 2);
  assert.deepEqual(validateFrameBlueprint(normalized, shot), { ok: true, errors: [] });
});

function validBlueprint() {
  return {
    schema_version: FRAME_BLUEPRINT_VERSION,
    shot_id: "shot-1",
    composition_strategy: "A large proof node resolves into a readable evidence label across the center field.",
    zones: [
      { id: "hero", purpose: "Primary proof", x_percent: 8, y_percent: 18, width_percent: 84, height_percent: 54, layer: "midground" },
      { id: "label", purpose: "Readable conclusion", x_percent: 8, y_percent: 76, width_percent: 84, height_percent: 12, layer: "foreground" }
    ],
    elements: [
      { object_id: "proof-node", selector: "#shot-1-proof", zone_id: "hero", visual_form: "A proportional evidence node with a strong border and fill", priority: "primary" },
      { object_id: "proof-label", selector: "#shot-1-label", zone_id: "label", visual_form: "A large exact-copy label", priority: "secondary" }
    ],
    typography: { display_px: 112, body_px: 42, metadata_px: 24, maximum_text_lines: 2 },
    motion_beats: [{ event_id: "shot-1-reveal", object_id: "proof-node", selector: "#shot-1-proof", at_seconds: 1, action: "Scale and fade the proof node into its final measured position" }],
    supporting_motion_beats: [
      { window_id: "opening", object_id: "proof-node", selector: "#shot-1-proof", at_seconds: .1, duration_seconds: .6, intent: "entrance", motion_pattern: "group-settle", affected_canvas_percent: 42, ease: "power3.out", changes: [{ property: "opacity", from_value: 0, to_value: 1 }, { property: "scale", from_value: .86, to_value: 1 }], action: "Spring the proof node from 0.86 scale and zero opacity into its authored static state" },
      { window_id: "closing", object_id: "proof-label", selector: "#shot-1-label", at_seconds: 2.5, duration_seconds: 2.25, intent: "emphasis", motion_pattern: "handoff", affected_canvas_percent: 22, ease: "none", changes: [{ property: "y", from_value: 96, to_value: 0 }, { property: "opacity", from_value: .5, to_value: 1 }], action: "Lift and resolve the exact-copy label with a sustained opacity rise" }
    ],
    visible_copy: ["Proof"],
    density: { target_occupied_percent: 62, minimum_semantic_objects: 2, focal_element_selector: "#shot-1-proof" },
    implementation_notes: ["Keep the proof node dominant on a phone screen"]
  };
}

function fixture() {
  const shot = {
    id: "shot-1",
    start_seconds: 0,
    end_seconds: 5,
    purpose: "Show proof",
    voiceover: "Proof appears.",
    on_screen_text: ["Proof"],
    evidence_ids: ["ev-1"],
    resource_ids: ["screen"],
    presenter: { mode: "voiceover", visible: false },
    visual: {
      description: "Proof develops",
      representation: "diagram",
      objects: [
        { id: "proof-node", kind: "diagram-node" },
        { id: "proof-label", kind: "text" }
      ],
      events: [{ id: "shot-1-reveal", target_ids: ["proof-node"], at_seconds: 1 }],
      continuity: { handoff: "resolve" }
    },
    transition_out: "cut"
  };
  return {
    intake: { resources: [{ id: "screen", role: "supporting", type: "video", location: "/tmp/screen.mp4", is_remote: false }] },
    evidence: { items: [{ id: "ev-1", title: "Proof", content: "Grounded proof ".repeat(200), provenance: "source" }] },
    plan: {
      project: { title: "Test", thesis: "Proof", audience_promise: "Understand", angle: "Evidence" },
      format: { width: 1080, height: 1920, duration_seconds: 5 },
      design: { concept: "Evidence choreography", art_direction: "Editorial", density: "Measured", style_dna: { family: "editorial" } },
      shots: [shot]
    },
    shot,
    index: 0,
    narrationTiming: {
      words: Array.from({ length: 40 }, (_, index) => ({ word: `w${index}`, start: index * .1, end: (index + 1) * .1 }))
    }
  };
}
