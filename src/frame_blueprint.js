import { SHOT_ID_PATTERN } from "./production_contracts.js";

export const FRAME_BLUEPRINT_VERSION = "launchclip.frame-blueprint.v1";

const string = { type: "string" };
const shotId = { type: "string", pattern: SHOT_ID_PATTERN };

function strictObject(properties, required = Object.keys(properties)) {
  return { type: "object", properties, required, additionalProperties: false };
}

export const FRAME_BLUEPRINT_SCHEMA = strictObject({
  schema_version: { type: "string", enum: [FRAME_BLUEPRINT_VERSION], description: `Always ${FRAME_BLUEPRINT_VERSION}.` },
  shot_id: { ...shotId, description: "The exact shot id from the input." },
  composition_strategy: { type: "string", minLength: 1, maxLength: 600, description: "A concrete spatial idea for this scene, not generic style commentary." },
  zones: {
    type: "array",
    minItems: 1,
    maxItems: 8,
    description: "Non-overlapping percentage-based canvas regions reserved before implementation.",
    items: strictObject({
      id: { type: "string", pattern: "^[a-z][a-z0-9-]{0,39}$", description: "A short scene-local zone id." },
      purpose: { type: "string", minLength: 1, maxLength: 180 },
      x_percent: { type: "number", minimum: 0, maximum: 100 },
      y_percent: { type: "number", minimum: 0, maximum: 100 },
      width_percent: { type: "number", exclusiveMinimum: 0, maximum: 100 },
      height_percent: { type: "number", exclusiveMinimum: 0, maximum: 100 },
      layer: { type: "string", enum: ["background", "midground", "foreground"] }
    })
  },
  elements: {
    type: "array",
    minItems: 1,
    maxItems: 24,
    description: "One implementation anchor for every planned visual object.",
    items: strictObject({
      object_id: { ...shotId, description: "An exact object id from shot.visual.objects." },
      selector: { type: "string", pattern: "^#[a-z0-9][a-z0-9_-]{0,127}$", description: "A unique shot-prefixed DOM id selector." },
      zone_id: { type: "string", pattern: "^[a-z][a-z0-9-]{0,39}$" },
      visual_form: { type: "string", minLength: 1, maxLength: 240, description: "The concrete HTML/CSS/SVG form used to express this object." },
      priority: { type: "string", enum: ["primary", "secondary", "supporting"] }
    })
  },
  typography: strictObject({
    display_px: { type: "integer", minimum: 40, maximum: 260 },
    body_px: { type: "integer", minimum: 18, maximum: 100 },
    metadata_px: { type: "integer", minimum: 14, maximum: 64 },
    maximum_text_lines: { type: "integer", minimum: 1, maximum: 8 }
  }),
  motion_beats: {
    type: "array",
    minItems: 1,
    maxItems: 24,
    description: "One exact implementation beat for every planned visible event.",
    items: strictObject({
      event_id: { ...shotId, description: "An exact id from shot.visual.events." },
      object_id: { ...shotId, description: "One exact target object id from the planned event." },
      selector: { type: "string", pattern: "^#[a-z0-9][a-z0-9_-]{0,127}$" },
      at_seconds: { type: "number", minimum: 0 },
      action: { type: "string", minLength: 1, maxLength: 240 }
    })
  },
  visible_copy: {
    type: "array",
    items: string,
    description: "The exact planned on-screen copy, without additional factual claims."
  },
  density: strictObject({
    target_occupied_percent: { type: "integer", minimum: 35, maximum: 90, description: "Approximate canvas area occupied at the scene's fullest meaningful moment." },
    minimum_semantic_objects: { type: "integer", minimum: 1, maximum: 24 },
    focal_element_selector: { type: "string", pattern: "^#[a-z0-9][a-z0-9_-]{0,127}$" }
  }),
  implementation_notes: {
    type: "array",
    maxItems: 8,
    items: { type: "string", minLength: 1, maxLength: 240 },
    description: "Short constraints that prevent generic cards, empty canvas, and unreadable phone typography."
  }
});

export const FRAME_BLUEPRINT_INSTRUCTIONS = `You are the visual architect for one original HyperFrames scene. Return only strict scene-blueprint JSON matching the supplied schema.

This blueprint is a binding handoff to a second LLM that will write the HTML and GSAP. Make the hard visual decisions now:
- Reserve deliberate percentage-based zones across the full canvas before placing elements. Keep essential regions non-overlapping and inside 0-100% bounds.
- Map every planned shot.visual.objects id exactly once to a unique DOM selector beginning #shot_id-. Do not invent or omit semantic object ids.
- Map every planned shot.visual.events id exactly once, using one of its target object ids and the selector assigned to that object. Preserve the planned time.
- Use concrete visual forms that express the declared diagram, comparison, process, timeline, data view, or spatial metaphor. Avoid a sparse headline floating over decoration and avoid generic card grids unless the plan explicitly calls for them.
- Plan phone-readable typography and a meaningful occupied-area target. The fullest frame should feel composed, not empty.
- Preserve exact supplied on-screen copy and evidence. Do not add claims.
- Keep the concept original while obeying the supplied style DNA, continuity, and transition direction.`;

export function buildFrameBlueprintInput({ intake, evidence, plan, shot, index, narrationTiming = null }) {
  return JSON.stringify({
    global_design: {
      concept: plan.design.concept,
      art_direction: plan.design.art_direction,
      density: plan.design.density,
      style_dna: plan.design.style_dna
    },
    format: plan.format,
    project: compactProject(plan.project),
    shot: compactShot(shot),
    neighbors: compactNeighbors(plan.shots, index),
    evidence: compactEvidence(evidence, shot, 1_200),
    resources: compactResources(intake, shot),
    narration_anchors: narrationAnchors(narrationTiming, shot),
    required_object_ids: (shot.visual?.objects ?? []).map((entry) => entry.id),
    required_events: (shot.visual?.events ?? []).map((entry) => ({ id: entry.id, target_ids: entry.target_ids, at_seconds: entry.at_seconds })),
    required_selector_prefix: `#${shot.id}-`
  });
}

export function buildBlueprintFrameInput({ intake, evidence, plan, shot, index, blueprint, narrationTiming = null, prior = null, errors = [] }) {
  return JSON.stringify({
    global_design: {
      concept: plan.design.concept,
      art_direction: plan.design.art_direction,
      style_dna: plan.design.style_dna
    },
    format: plan.format,
    project: compactProject(plan.project),
    shot_contract: compactShot(shot),
    scene_blueprint: blueprint,
    neighbors: compactNeighbors(plan.shots, index),
    evidence: compactEvidence(evidence, shot, 800),
    resources: compactResources(intake, shot),
    narration_anchors: narrationAnchors(narrationTiming, shot),
    frame_responsibility: "Implement this blueprint as one visual HTML/GSAP shot. Request media; do not mount it.",
    prior_attempt: prior,
    validation_errors_to_repair: errors
  });
}

export function validateFrameBlueprint(blueprint, shot) {
  const errors = [];
  if (blueprint?.schema_version !== FRAME_BLUEPRINT_VERSION) errors.push(`schema_version must be ${FRAME_BLUEPRINT_VERSION}`);
  if (blueprint?.shot_id !== shot?.id) errors.push(`shot_id must be ${shot?.id}`);
  const duration = Number(shot?.end_seconds) - Number(shot?.start_seconds);
  const zones = Array.isArray(blueprint?.zones) ? blueprint.zones : [];
  const zoneIds = new Set();
  for (const [index, zone] of zones.entries()) {
    if (zoneIds.has(zone?.id)) errors.push(`zones[${index}].id must be unique: ${zone?.id}`);
    zoneIds.add(zone?.id);
    if (Number(zone?.x_percent) + Number(zone?.width_percent) > 100.001) errors.push(`zones[${index}] extends beyond the right edge`);
    if (Number(zone?.y_percent) + Number(zone?.height_percent) > 100.001) errors.push(`zones[${index}] extends beyond the bottom edge`);
  }
  const plannedObjects = new Map((shot?.visual?.objects ?? []).map((entry) => [entry.id, entry]));
  const elements = Array.isArray(blueprint?.elements) ? blueprint.elements : [];
  const elementByObject = new Map();
  const selectors = new Set();
  for (const [index, element] of elements.entries()) {
    if (!plannedObjects.has(element?.object_id)) errors.push(`elements[${index}].object_id is not planned: ${element?.object_id}`);
    if (elementByObject.has(element?.object_id)) errors.push(`elements[${index}].object_id must be unique: ${element?.object_id}`);
    elementByObject.set(element?.object_id, element);
    if (!String(element?.selector ?? "").startsWith(`#${shot?.id}-`)) errors.push(`elements[${index}].selector must begin #${shot?.id}-`);
    if (selectors.has(element?.selector)) errors.push(`elements[${index}].selector must be unique: ${element?.selector}`);
    selectors.add(element?.selector);
    if (!zoneIds.has(element?.zone_id)) errors.push(`elements[${index}].zone_id is unknown: ${element?.zone_id}`);
  }
  for (const id of plannedObjects.keys()) if (!elementByObject.has(id)) errors.push(`elements must include planned object: ${id}`);

  const plannedEvents = new Map((shot?.visual?.events ?? []).map((entry) => [entry.id, entry]));
  const beats = Array.isArray(blueprint?.motion_beats) ? blueprint.motion_beats : [];
  const seenEvents = new Set();
  for (const [index, beat] of beats.entries()) {
    const planned = plannedEvents.get(beat?.event_id);
    if (!planned) errors.push(`motion_beats[${index}].event_id is not planned: ${beat?.event_id}`);
    if (seenEvents.has(beat?.event_id)) errors.push(`motion_beats[${index}].event_id must be unique: ${beat?.event_id}`);
    seenEvents.add(beat?.event_id);
    if (planned && !(planned.target_ids ?? []).includes(beat?.object_id)) errors.push(`motion_beats[${index}].object_id is not targeted by ${beat?.event_id}`);
    if (planned && Math.abs(Number(beat?.at_seconds) - Number(planned.at_seconds)) > .05) errors.push(`motion_beats[${index}].at_seconds must preserve ${planned.at_seconds}`);
    const element = elementByObject.get(beat?.object_id);
    if (element && beat?.selector !== element.selector) errors.push(`motion_beats[${index}].selector must match ${beat?.object_id}`);
    if (!Number.isFinite(Number(beat?.at_seconds)) || Number(beat.at_seconds) < 0 || Number(beat.at_seconds) > duration) errors.push(`motion_beats[${index}].at_seconds falls outside the shot`);
  }
  for (const id of plannedEvents.keys()) if (!seenEvents.has(id)) errors.push(`motion_beats must include planned event: ${id}`);

  for (const copy of shot?.on_screen_text ?? []) {
    if (!(blueprint?.visible_copy ?? []).includes(copy)) errors.push(`visible_copy must preserve: ${copy}`);
  }
  const focal = blueprint?.density?.focal_element_selector;
  if (focal && !selectors.has(focal)) errors.push(`density.focal_element_selector is unknown: ${focal}`);
  const semanticObjectCount = [...plannedObjects.values()].filter((entry) => entry.kind !== "decoration").length;
  if (Number(blueprint?.density?.minimum_semantic_objects) < semanticObjectCount) errors.push(`density.minimum_semantic_objects must be at least ${semanticObjectCount}`);
  return { ok: errors.length === 0, errors };
}

function compactProject(project = {}) {
  return { title: project.title, thesis: project.thesis, audience_promise: project.audience_promise, angle: project.angle };
}

function compactShot(shot = {}) {
  return {
    id: shot.id,
    start_seconds: shot.start_seconds,
    end_seconds: shot.end_seconds,
    duration_seconds: Number(shot.end_seconds) - Number(shot.start_seconds),
    purpose: shot.purpose,
    voiceover: shot.voiceover,
    on_screen_text: shot.on_screen_text,
    evidence_ids: shot.evidence_ids,
    resource_ids: shot.resource_ids,
    presenter: shot.presenter,
    visual: shot.visual,
    transition_out: shot.transition_out
  };
}

function compactNeighbors(shots = [], index = 0) {
  return [shots[index - 1], shots[index + 1]].filter(Boolean).map((entry) => ({
    id: entry.id,
    purpose: entry.purpose,
    representation: entry.visual?.representation,
    continuity: entry.visual?.continuity,
    transition_out: entry.transition_out
  }));
}

function compactEvidence(evidence, shot, limit) {
  const byId = new Map((evidence?.items ?? []).map((entry) => [entry.id, entry]));
  return (shot?.evidence_ids ?? []).map((id) => byId.get(id)).filter(Boolean).map((entry) => ({
    id: entry.id,
    title: entry.title,
    content: compactText(entry.content, limit),
    provenance: entry.provenance
  }));
}

function compactResources(intake, shot) {
  const byId = new Map((intake?.resources ?? []).map((entry) => [entry.id, entry]));
  return (shot?.resource_ids ?? []).map((id) => byId.get(id)).filter(Boolean).map((entry) => ({
    id: entry.id,
    role: entry.role,
    type: entry.type,
    local_path: entry.is_remote ? null : entry.location,
    remote: entry.is_remote
  }));
}

function narrationAnchors(timing, shot) {
  const words = (timing?.words ?? []).filter((word) => Number(word.end) > Number(shot?.start_seconds) && Number(word.start) < Number(shot?.end_seconds));
  if (!words.length) return [];
  const groupSize = Math.max(1, Math.ceil(words.length / 8));
  const anchors = [];
  for (let index = 0; index < words.length; index += groupSize) {
    const group = words.slice(index, index + groupSize);
    anchors.push({
      text: group.map((entry) => entry.word).join(" "),
      start_seconds: Math.max(0, Number(group[0].start) - Number(shot.start_seconds)),
      end_seconds: Math.min(Number(shot.end_seconds) - Number(shot.start_seconds), Number(group.at(-1).end) - Number(shot.start_seconds))
    });
  }
  return anchors;
}

function compactText(value, limit) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}
