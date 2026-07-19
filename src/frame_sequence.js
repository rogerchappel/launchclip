import { SHOT_ID_PATTERN } from "./production_contracts.js";

export const FRAME_SEQUENCE_VERSION = "launchclip.frame-sequence.v1";

const id = { type: "string", pattern: SHOT_ID_PATTERN };
const string = { type: "string", minLength: 1 };
const nullableId = { type: ["string", "null"], pattern: SHOT_ID_PATTERN };

function strictObject(properties, required = Object.keys(properties)) {
  return { type: "object", properties, required, additionalProperties: false };
}

const rect = strictObject({
  x_percent: { type: "number", minimum: 0, maximum: 100 },
  y_percent: { type: "number", minimum: 0, maximum: 100 },
  width_percent: { type: "number", exclusiveMinimum: 0, maximum: 100 },
  height_percent: { type: "number", exclusiveMinimum: 0, maximum: 100 }
});

const cameraPose = strictObject({
  x_percent: { type: "number", minimum: -200, maximum: 200 },
  y_percent: { type: "number", minimum: -200, maximum: 200 },
  scale: { type: "number", minimum: 0.2, maximum: 4 },
  rotation_degrees: { type: "number", minimum: -180, maximum: 180 },
  depth: { type: "number", minimum: -10, maximum: 10 }
});

export const FRAME_SEQUENCE_SCHEMA = strictObject({
  schema_version: { type: "string", enum: [FRAME_SEQUENCE_VERSION] },
  authoring_sequence_id: id,
  sequence_id: id,
  shot_ids: { type: "array", minItems: 2, items: id },
  start_seconds: { type: "number", minimum: 0 },
  end_seconds: { type: "number", exclusiveMinimum: 0 },
  duration_seconds: { type: "number", minimum: 0.1, maximum: 20 },
  experience: string,
  world: strictObject({
    spatial_model: string,
    coordinate_system: string,
    perspective: string,
    camera_path: string,
    light_direction: string,
    material_language: string,
    grade: string,
    background_system: string,
    depth_planes: { type: "array", minItems: 2, maxItems: 8, items: string }
  }),
  objects: {
    type: "array",
    minItems: 1,
    items: strictObject({
      object_id: id,
      kind: string,
      visual_identity: string,
      material: string,
      light_response: string,
      states: {
        type: "array",
        minItems: 1,
        items: strictObject({
          shot_id: id,
          rect,
          scale: { type: "number", minimum: 0.1, maximum: 5 },
          rotation_degrees: { type: "number", minimum: -360, maximum: 360 },
          depth_plane: string,
          lifecycle: { type: "string", enum: ["enter", "persist", "transform", "exit"] }
        })
      }
    })
  },
  shot_states: {
    type: "array",
    minItems: 2,
    items: strictObject({
      shot_id: id,
      accumulated_state: string,
      entry_frame: string,
      exit_frame: string,
      camera_entry: cameraPose,
      camera_exit: cameraPose,
      intentional_reset: { type: "boolean" }
    })
  },
  boundaries: {
    type: "array",
    minItems: 1,
    items: strictObject({
      from_shot_id: id,
      to_shot_id: id,
      handoff_kind: { type: "string", enum: ["shared-element", "camera-travel", "morph", "match-cut", "hard-cut", "aperture"] },
      from_object_id: nullableId,
      to_object_id: nullableId,
      from_rect: rect,
      to_rect: rect,
      axis: { type: "string", enum: ["x", "y", "scale", "depth", "none"] },
      direction: { type: "integer", enum: [-1, 1] },
      duration_seconds: { type: "number", minimum: 0.15, maximum: 1.25 },
      exit_velocity: { type: "number", minimum: 0 },
      entry_velocity: { type: "number", minimum: 0 },
      motion_blur_px: { type: "number", minimum: 0, maximum: 40 },
      camera_path: string,
      velocity_curve: string,
      blur_curve: string,
      mask_or_shape_path: string,
      background_behavior: string
    })
  }
});

export const FRAME_SEQUENCE_INSTRUCTIONS = `You are the sequence-level production designer for one continuous 8-20 second visual world. Return only strict frame-sequence JSON matching the supplied schema.

Freeze the physical system that every later scene architect must obey:
- Treat the sequence as one evolving world, not a collection of slides. Describe what the viewer experiences, how the central visual idea accumulates, and what remains physically continuous.
- Preserve every supplied shot id, object id, shot boundary, continuity velocity, and motion-blur value exactly.
- Establish one percentage-based coordinate system, perspective, camera path, light direction, material language, depth stack, background behavior, and grade for the entire sequence.
- Give every planned object one stable visual identity. Provide exact normalized geometry for every shot in which it appears; persistent objects retain material, lighting, and identity while their state may transform.
- Make shot_states cumulative. Each exit frame must intentionally seed the next entry frame. The first shot begins a world and uses intentional_reset=true; every later shot in this continuous sequence uses false.
- Author one typed boundary for every adjacent shot pair. Use a real shared object when the plan hands one off. Match exit and entry velocity within the supplied contract, couple blur to acceleration, and resolve sharply at the settle.
- A hard cut is allowed only when the supplied continuity already requests one. Do not hide an incoherent handoff behind a full-frame fade.
- Keep copy, claims, evidence, and semantic event timing unchanged. This contract directs art, geometry, camera, and handoff physics; it does not rewrite the plan.

If prior_attempt and validation_errors_to_repair are present, return a complete corrected sequence contract.`;

export function buildAuthoringSequences(plan, options = {}) {
  const shots = Array.isArray(plan?.shots) ? plan.shots : [];
  const groups = [];
  let current = null;
  for (const shot of shots) {
    const sequenceId = String(shot?.visual?.continuity?.sequence_id ?? shot?.id ?? "");
    const previous = current?.shots.at(-1);
    const joins = previous
      && current.sequence_id === sequenceId
      && new Set(["continue", "transform"]).has(previous.visual?.continuity?.handoff);
    if (!joins) {
      current = {
        authoring_sequence_id: `seq-${String(groups.length + 1).padStart(3, "0")}`,
        sequence_id: sequenceId,
        shots: [],
        shot_ids: [],
        start_seconds: Number(shot?.start_seconds),
        end_seconds: Number(shot?.end_seconds),
        duration_seconds: 0
      };
      groups.push(current);
    }
    current.shots.push(shot);
    current.shot_ids.push(shot.id);
    current.end_seconds = Number(shot.end_seconds);
    current.duration_seconds = Number((current.end_seconds - current.start_seconds).toFixed(3));
  }
  if (options.enforceDuration) {
    const errors = validateAuthoringSequenceDurations(groups, Number(plan?.format?.duration_seconds));
    if (errors.length) {
      const error = new Error(`Cinematic sequence planning failed: ${errors.join("; ")}`);
      error.code = "LAUNCHCLIP_CINEMATIC_SEQUENCE_DURATION";
      error.errors = errors;
      throw error;
    }
  }
  return groups;
}

export function validateAuthoringSequenceDurations(sequences, productionDuration) {
  const errors = [];
  const groups = sequences ?? [];
  if (groups.length > 1 && !groups.some((sequence) => (sequence.shots ?? []).length >= 2)) {
    errors.push("cinematic planning requires at least one multi-shot shared-world sequence; independent shot resets cannot satisfy continuity");
  }
  for (const sequence of groups) {
    if ((sequence.shots ?? []).length < 2) continue;
    const duration = Number(sequence.duration_seconds);
    const minimum = Number(productionDuration) < 8 ? Number(productionDuration) : 8;
    if (duration < minimum - 0.001 || duration > 20.001) {
      errors.push(`${sequence.authoring_sequence_id} (${sequence.sequence_id}) must span ${minimum}-20 seconds; actual ${duration}`);
    }
  }
  return errors;
}

export function buildFrameSequenceInput({ plan, sequence, narrationTiming = null, previous = null, errors = [] }) {
  const start = Number(sequence.start_seconds);
  const end = Number(sequence.end_seconds);
  const words = (narrationTiming?.words ?? [])
    .filter((word) => Number(word.end) > start && Number(word.start) < end)
    .map((word) => ({
      word: word.word,
      sequence_start_seconds: Math.max(0, Number(word.start) - start),
      sequence_end_seconds: Math.min(end - start, Number(word.end) - start)
    }));
  return JSON.stringify({
    authoring_sequence: {
      authoring_sequence_id: sequence.authoring_sequence_id,
      sequence_id: sequence.sequence_id,
      shot_ids: sequence.shot_ids,
      start_seconds: sequence.start_seconds,
      end_seconds: sequence.end_seconds,
      duration_seconds: sequence.duration_seconds
    },
    project: plan.project,
    format: plan.format,
    global_design: plan.design,
    shots: sequence.shots,
    narration_timing: narrationTiming ? { duration_seconds: narrationTiming.duration_seconds, words } : null,
    required_boundaries: requiredBoundaries(sequence),
    prior_attempt: previous,
    validation_errors_to_repair: errors
  });
}

export function validateFrameSequence(value, sequence) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, errors: ["frame sequence must be an object"] };
  if (value.schema_version !== FRAME_SEQUENCE_VERSION) errors.push(`schema_version must be ${FRAME_SEQUENCE_VERSION}`);
  if (value.authoring_sequence_id !== sequence?.authoring_sequence_id) errors.push(`authoring_sequence_id must be ${sequence?.authoring_sequence_id}`);
  if (value.sequence_id !== sequence?.sequence_id) errors.push(`sequence_id must be ${sequence?.sequence_id}`);
  exactArray(errors, "shot_ids", value.shot_ids, sequence?.shot_ids ?? []);
  exactNumber(errors, "start_seconds", value.start_seconds, sequence?.start_seconds);
  exactNumber(errors, "end_seconds", value.end_seconds, sequence?.end_seconds);
  exactNumber(errors, "duration_seconds", value.duration_seconds, sequence?.duration_seconds);
  for (const key of ["experience"]) requireString(errors, key, value[key]);
  for (const key of ["spatial_model", "coordinate_system", "perspective", "camera_path", "light_direction", "material_language", "grade", "background_system"]) {
    requireString(errors, `world.${key}`, value.world?.[key]);
  }
  if (!Array.isArray(value.world?.depth_planes) || value.world.depth_planes.length < 2) errors.push("world.depth_planes must contain at least two planes");

  const plannedObjects = new Map();
  for (const shot of sequence?.shots ?? []) {
    for (const object of shot.visual?.objects ?? []) {
      const entry = plannedObjects.get(object.id) ?? { kind: object.kind, shotIds: [] };
      entry.shotIds.push(shot.id);
      plannedObjects.set(object.id, entry);
    }
  }
  const objects = Array.isArray(value.objects) ? value.objects : [];
  const objectIds = new Set();
  for (const [index, object] of objects.entries()) {
    const label = `objects[${index}]`;
    if (!plannedObjects.has(object?.object_id)) errors.push(`${label}.object_id is not planned: ${object?.object_id}`);
    if (objectIds.has(object?.object_id)) errors.push(`${label}.object_id must be unique: ${object?.object_id}`);
    objectIds.add(object?.object_id);
    for (const key of ["visual_identity", "material", "light_response"]) requireString(errors, `${label}.${key}`, object?.[key]);
    const requiredShotIds = plannedObjects.get(object?.object_id)?.shotIds ?? [];
    exactArray(errors, `${label}.states shot ids`, (object?.states ?? []).map((state) => state.shot_id), requiredShotIds);
    for (const [stateIndex, state] of (object?.states ?? []).entries()) validateRect(errors, `${label}.states[${stateIndex}].rect`, state?.rect);
  }
  for (const objectId of plannedObjects.keys()) if (!objectIds.has(objectId)) errors.push(`objects must include planned object: ${objectId}`);

  const states = Array.isArray(value.shot_states) ? value.shot_states : [];
  exactArray(errors, "shot_states shot ids", states.map((state) => state.shot_id), sequence?.shot_ids ?? []);
  for (const [index, state] of states.entries()) {
    for (const key of ["accumulated_state", "entry_frame", "exit_frame"]) requireString(errors, `shot_states[${index}].${key}`, state?.[key]);
    if (state?.intentional_reset !== (index === 0)) errors.push(`shot_states[${index}].intentional_reset must be ${index === 0}`);
    validateCamera(errors, `shot_states[${index}].camera_entry`, state?.camera_entry);
    validateCamera(errors, `shot_states[${index}].camera_exit`, state?.camera_exit);
  }

  const expectedBoundaries = requiredBoundaries(sequence);
  const boundaries = Array.isArray(value.boundaries) ? value.boundaries : [];
  if (boundaries.length !== expectedBoundaries.length) errors.push(`boundaries must contain exactly ${expectedBoundaries.length} entries`);
  for (const [index, expected] of expectedBoundaries.entries()) {
    const boundary = boundaries[index];
    if (!boundary) continue;
    if (boundary.from_shot_id !== expected.from_shot_id || boundary.to_shot_id !== expected.to_shot_id) errors.push(`boundaries[${index}] must join ${expected.from_shot_id} to ${expected.to_shot_id}`);
    exactNumber(errors, `boundaries[${index}].exit_velocity`, boundary.exit_velocity, expected.exit_velocity);
    exactNumber(errors, `boundaries[${index}].entry_velocity`, boundary.entry_velocity, expected.entry_velocity);
    exactNumber(errors, `boundaries[${index}].motion_blur_px`, boundary.motion_blur_px, expected.motion_blur_px);
    if (Math.abs(Number(boundary.exit_velocity) - Number(boundary.entry_velocity)) / Math.max(Number(boundary.exit_velocity), Number(boundary.entry_velocity), 1) > 0.05) {
      errors.push(`boundaries[${index}] velocity must match within 5%`);
    }
    const shared = new Set(expected.shared_object_ids);
    if (shared.size) {
      if (!shared.has(boundary.from_object_id)) errors.push(`boundaries[${index}].from_object_id must use a handed-off object`);
      if (!shared.has(boundary.to_object_id)) errors.push(`boundaries[${index}].to_object_id must use an inherited object`);
    }
    validateRect(errors, `boundaries[${index}].from_rect`, boundary.from_rect);
    validateRect(errors, `boundaries[${index}].to_rect`, boundary.to_rect);
  }
  return { ok: errors.length === 0, errors };
}

export function requiredBoundaries(sequence) {
  const boundaries = [];
  for (let index = 0; index < (sequence?.shots?.length ?? 0) - 1; index += 1) {
    const outgoing = sequence.shots[index];
    const incoming = sequence.shots[index + 1];
    const inherited = new Set(incoming.visual?.continuity?.inherits_object_ids ?? []);
    const sharedObjectIds = (outgoing.visual?.continuity?.hands_off_object_ids ?? []).filter((objectId) => inherited.has(objectId));
    boundaries.push({
      from_shot_id: outgoing.id,
      to_shot_id: incoming.id,
      planned_handoff: outgoing.visual?.continuity?.handoff,
      shared_object_ids: sharedObjectIds,
      camera_direction: incoming.visual?.continuity?.camera_direction ?? outgoing.visual?.continuity?.camera_direction,
      exit_velocity: Number(outgoing.visual?.continuity?.exit_velocity ?? 0),
      entry_velocity: Number(incoming.visual?.continuity?.entry_velocity ?? 0),
      motion_blur_px: Number(incoming.visual?.continuity?.motion_blur_px ?? outgoing.visual?.continuity?.motion_blur_px ?? 0)
    });
  }
  return boundaries;
}

function exactArray(errors, label, actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length || actual.some((entry, index) => entry !== expected[index])) {
    errors.push(`${label} must equal ${JSON.stringify(expected)}`);
  }
}

function exactNumber(errors, label, actual, expected) {
  if (!Number.isFinite(Number(actual)) || Math.abs(Number(actual) - Number(expected)) > 0.001) errors.push(`${label} must be ${expected}`);
}

function requireString(errors, label, value) {
  if (!String(value ?? "").trim()) errors.push(`${label} is required`);
}

function validateRect(errors, label, value) {
  const x = Number(value?.x_percent);
  const y = Number(value?.y_percent);
  const width = Number(value?.width_percent);
  const height = Number(value?.height_percent);
  if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 100.001 || y + height > 100.001) {
    errors.push(`${label} must be a positive normalized rectangle inside the canvas`);
  }
}

function validateCamera(errors, label, value) {
  if (![value?.x_percent, value?.y_percent, value?.scale, value?.rotation_degrees, value?.depth].every((entry) => Number.isFinite(Number(entry)))) {
    errors.push(`${label} must contain finite camera pose values`);
  }
}
