import assert from "node:assert/strict";
import test from "node:test";
import { buildBlueprintFrameInput, buildFrameBlueprintInput, FRAME_BLUEPRINT_VERSION, validateFrameBlueprint } from "../src/frame_blueprint.js";

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
  assert.equal(blueprintInput.supporting_motion_contract.opening_hook_magnitudes.x, 64);
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
  assert.match(validation.errors.join("\n"), /opacity delta must be at least 0.25/);
  assert.match(validation.errors.join("\n"), /opening requires a hook-scale/);
  assert.match(validation.errors.join("\n"), /object_id is not planned: evidence-grid/);
  assert.match(validation.errors.join("\n"), /target semantic objects at least 1 times/);
  assert.match(validation.errors.join("\n"), /visible_copy must preserve: Proof/);
  assert.match(validation.errors.join("\n"), /focal_element_selector is unknown/);
  assert.match(validation.errors.join("\n"), /minimum_semantic_objects must be at least 2/);
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
      { window_id: "opening", object_id: "proof-node", selector: "#shot-1-proof", at_seconds: .1, duration_seconds: .6, intent: "entrance", changes: [{ property: "opacity", from_value: 0, to_value: 1 }, { property: "scale", from_value: .86, to_value: 1 }], action: "Spring the proof node from 0.86 scale and zero opacity into its authored static state" },
      { window_id: "closing", object_id: "proof-label", selector: "#shot-1-label", at_seconds: 2.5, duration_seconds: 2.25, intent: "emphasis", changes: [{ property: "y", from_value: 64, to_value: 0 }, { property: "opacity", from_value: .5, to_value: 1 }], action: "Lift and resolve the exact-copy label with a sustained opacity rise" }
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
