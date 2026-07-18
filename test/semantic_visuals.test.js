import assert from "node:assert/strict";
import test from "node:test";
import { validateSemanticVisualPlan } from "../src/semantic_visuals.js";

test("explains which object kinds satisfy a content-bearing visual repair", () => {
  const plan = semanticPlan([
    { id: "shell", kind: "container", layer: "background" },
    { id: "headline", kind: "text", layer: "foreground" }
  ]);
  assert.match(validateSemanticVisualPlan(plan).join(" "), /diagram-node.*metric.*container does not count/);
});

test("accepts a diagram node as content-bearing visual structure", () => {
  const plan = semanticPlan([
    { id: "shell", kind: "container", layer: "background" },
    { id: "proof", kind: "diagram-node", layer: "foreground" }
  ]);
  assert.equal(validateSemanticVisualPlan(plan).some((error) => error.includes("content-bearing")), false);
});

function semanticPlan(objects) {
  return {
    format: { duration_seconds: 5 },
    shots: [{
      id: "s01",
      start_seconds: 0,
      end_seconds: 5,
      resource_ids: [],
      presenter: { mode: "voiceover" },
      visual: {
        representation: "diagram",
        objects: objects.map((object) => ({ ...object, asset_resource_id: null })),
        events: [],
        continuity: { sequence_id: "opening", handoff: "cut", inherits_object_ids: [], hands_off_object_ids: [], entry_velocity: 0, exit_velocity: 0 }
      },
      sfx: []
    }]
  };
}
