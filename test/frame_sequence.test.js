import assert from "node:assert/strict";
import test from "node:test";
import {
  FRAME_SEQUENCE_VERSION,
  buildAuthoringSequences,
  buildFrameSequenceInput,
  requiredBoundaries,
  validateAuthoringSequenceDurations,
  validateFrameSequence
} from "../src/frame_sequence.js";

test("groups only contiguous continuing shots into shared authoring worlds", () => {
  const plan = planFixture([
    shot("one", 0, 4, "world-a", "continue"),
    shot("two", 4, 9, "world-a", "resolve"),
    shot("three", 9, 12, "world-a", "continue"),
    shot("four", 12, 17, "world-b", "cut"),
    shot("five", 17, 20, "world-a", "resolve")
  ]);
  const groups = buildAuthoringSequences(plan);
  assert.deepEqual(groups.map((entry) => ({ id: entry.authoring_sequence_id, sequence: entry.sequence_id, shots: entry.shot_ids, duration: entry.duration_seconds })), [
    { id: "seq-001", sequence: "world-a", shots: ["one", "two"], duration: 9 },
    { id: "seq-002", sequence: "world-a", shots: ["three"], duration: 3 },
    { id: "seq-003", sequence: "world-b", shots: ["four"], duration: 5 },
    { id: "seq-004", sequence: "world-a", shots: ["five"], duration: 3 }
  ]);
});

test("fails closed when a multi-shot cinematic world falls outside eight to twenty seconds", () => {
  const short = buildAuthoringSequences(planFixture([shot("one", 0, 3, "world", "continue"), shot("two", 3, 7, "world", "resolve")]));
  const long = buildAuthoringSequences(planFixture([shot("one", 0, 10, "world", "continue"), shot("two", 10, 21, "world", "resolve")], 21));
  assert.match(validateAuthoringSequenceDurations(short, 30)[0], /8-20 seconds; actual 7/);
  assert.match(validateAuthoringSequenceDurations(long, 21)[0], /8-20 seconds; actual 21/);
  assert.throws(() => buildAuthoringSequences(planFixture(short[0].shots, 30), { enforceDuration: true }), /Cinematic sequence planning failed/);
});

test("fails closed when a cinematic plan evades continuity with independent shot resets", () => {
  const plan = planFixture([
    shot("one", 0, 5, "world-a", "cut"),
    shot("two", 5, 10, "world-b", "cut"),
    shot("three", 10, 15, "world-c", "resolve")
  ]);
  const groups = buildAuthoringSequences(plan);
  assert.match(validateAuthoringSequenceDurations(groups, 15)[0], /at least one multi-shot shared-world sequence/);
  assert.throws(() => buildAuthoringSequences(plan, { enforceDuration: true }), /independent shot resets cannot satisfy continuity/);
});

test("builds a compact sequence packet with exact boundary physics and narration timing", () => {
  const plan = planFixture([shot("one", 0, 4, "world", "continue"), shot("two", 4, 9, "world", "resolve")]);
  const sequence = buildAuthoringSequences(plan, { enforceDuration: true })[0];
  const input = JSON.parse(buildFrameSequenceInput({
    plan,
    sequence,
    narrationTiming: { duration_seconds: 9, words: [{ word: "proof", start: 3.8, end: 4.2 }] }
  }));
  assert.deepEqual(input.authoring_sequence.shot_ids, ["one", "two"]);
  assert.deepEqual(input.required_boundaries, [{
    from_shot_id: "one",
    to_shot_id: "two",
    planned_handoff: "continue",
    shared_object_ids: ["signal"],
    camera_direction: "rightward",
    exit_velocity: 320,
    entry_velocity: 320,
    motion_blur_px: 12
  }]);
  assert.deepEqual(input.narration_timing.words[0], { word: "proof", sequence_start_seconds: 3.8, sequence_end_seconds: 4.2 });
});

test("validates frozen object states, camera states, and every typed boundary", () => {
  const plan = planFixture([shot("one", 0, 4, "world", "continue"), shot("two", 4, 9, "world", "resolve")]);
  const sequence = buildAuthoringSequences(plan, { enforceDuration: true })[0];
  const contract = sequenceContract(sequence);
  assert.deepEqual(validateFrameSequence(contract, sequence), { ok: true, errors: [] });

  const broken = structuredClone(contract);
  broken.objects[0].states.pop();
  broken.shot_states[1].intentional_reset = true;
  broken.boundaries[0].entry_velocity = 80;
  broken.boundaries[0].motion_blur_px = 2;
  broken.boundaries[0].from_object_id = "headline";
  const validation = validateFrameSequence(broken, sequence);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /states shot ids/);
  assert.match(validation.errors.join("\n"), /intentional_reset must be false/);
  assert.match(validation.errors.join("\n"), /entry_velocity must be 320/);
  assert.match(validation.errors.join("\n"), /motion_blur_px must be 12/);
  assert.match(validation.errors.join("\n"), /from_object_id must use a handed-off object/);
});

function sequenceContract(sequence) {
  const boundary = requiredBoundaries(sequence)[0];
  return {
    schema_version: FRAME_SEQUENCE_VERSION,
    authoring_sequence_id: sequence.authoring_sequence_id,
    sequence_id: sequence.sequence_id,
    shot_ids: sequence.shot_ids,
    start_seconds: sequence.start_seconds,
    end_seconds: sequence.end_seconds,
    duration_seconds: sequence.duration_seconds,
    experience: "The signal crosses one tactile workspace and becomes proof.",
    world: {
      spatial_model: "A deep editorial workbench",
      coordinate_system: "Normalized canvas with a left-to-right evidence axis",
      perspective: "Subtle 900px perspective",
      camera_path: "One continuous rightward dolly",
      light_direction: "Warm key from upper left",
      material_language: "Ivory paper and dark ink",
      grade: "Warm editorial contrast",
      background_system: "Persistent ruled workbench",
      depth_planes: ["paper", "objects", "annotations"]
    },
    objects: [
      objectContract("signal", "diagram-node", ["one", "two"]),
      objectContract("headline", "text", ["one", "two"])
    ],
    shot_states: sequence.shot_ids.map((shotId, index) => ({
      shot_id: shotId,
      accumulated_state: index ? "The signal has become verified proof" : "The signal enters as a question",
      entry_frame: index ? "Signal enters from the prior exit geometry" : "Workbench already in motion",
      exit_frame: index ? "Proof settles sharply" : "Signal exits toward the proof region",
      camera_entry: { x_percent: index * 10, y_percent: 0, scale: 1, rotation_degrees: 0, depth: index },
      camera_exit: { x_percent: (index + 1) * 10, y_percent: 0, scale: 1.05, rotation_degrees: 0, depth: index + 1 },
      intentional_reset: index === 0
    })),
    boundaries: [{
      from_shot_id: boundary.from_shot_id,
      to_shot_id: boundary.to_shot_id,
      handoff_kind: "shared-element",
      from_object_id: "signal",
      to_object_id: "signal",
      from_rect: { x_percent: 55, y_percent: 40, width_percent: 20, height_percent: 20 },
      to_rect: { x_percent: 20, y_percent: 40, width_percent: 20, height_percent: 20 },
      axis: "x",
      direction: 1,
      duration_seconds: 0.5,
      exit_velocity: boundary.exit_velocity,
      entry_velocity: boundary.entry_velocity,
      motion_blur_px: boundary.motion_blur_px,
      camera_path: "Continue the rightward dolly",
      velocity_curve: "power3.in into power3.out",
      blur_curve: "0 to 12 to 0",
      mask_or_shape_path: "none",
      background_behavior: "Workbench remains continuous"
    }]
  };
}

function objectContract(objectId, kind, shotIds) {
  return {
    object_id: objectId,
    kind,
    visual_identity: `${objectId} identity`,
    material: "Ivory paper",
    light_response: "Upper-left key with grounded shadow",
    states: shotIds.map((shotId, index) => ({
      shot_id: shotId,
      rect: { x_percent: 10 + index * 20, y_percent: 20, width_percent: 30, height_percent: 20 },
      scale: 1,
      rotation_degrees: 0,
      depth_plane: "objects",
      lifecycle: index ? "transform" : "enter"
    }))
  };
}

function planFixture(shots, duration = shots.at(-1)?.end_seconds ?? 0) {
  return {
    project: { title: "Proof world", thesis: "Signals become proof" },
    format: { aspect: "9:16", width: 1080, height: 1920, duration_seconds: duration, language: "en" },
    design: { concept: "Editorial evidence workbench", art_direction: "Tactile and cinematic" },
    shots
  };
}

function shot(id, start, end, sequenceId, handoff) {
  return {
    id,
    start_seconds: start,
    end_seconds: end,
    visual: {
      continuity: {
        sequence_id: sequenceId,
        handoff,
        inherits_object_ids: id === "one" ? [] : ["signal"],
        hands_off_object_ids: handoff === "continue" ? ["signal"] : [],
        camera_direction: "rightward",
        entry_velocity: id === "one" ? 0 : 320,
        exit_velocity: handoff === "continue" ? 320 : 0,
        motion_blur_px: 12
      },
      objects: [
        { id: "signal", kind: "diagram-node", layer: "midground" },
        { id: "headline", kind: "text", layer: "foreground" }
      ]
    }
  };
}
