import { SHOT_ID_PATTERN } from "./production_contracts.js";

export const FRAME_BLUEPRINT_VERSION = "launchclip.frame-blueprint.v3";

const SUPPORTING_CHANGE_LIMITS = {
  opacity: { minimum: 0, maximum: 1, minimumDelta: .25, hookDelta: null },
  x: { minimum: -1080, maximum: 1080, minimumDelta: 36, hookDelta: 64 },
  y: { minimum: -1920, maximum: 1920, minimumDelta: 36, hookDelta: 64 },
  scale: { minimum: .2, maximum: 2.5, minimumDelta: .06, hookDelta: .1 },
  rotation: { minimum: -360, maximum: 360, minimumDelta: 5, hookDelta: 8 }
};

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
  supporting_motion_beats: {
    type: "array",
    minItems: 1,
    maxItems: 6,
    description: "One LLM-directed micro-motion beat for every supplied supporting-motion window. These beats animate planned objects without inventing timeline events or claims.",
    items: strictObject({
      window_id: { type: "string", pattern: "^[a-z][a-z0-9-]{0,39}$", description: "An exact id from supporting_motion_contract.windows." },
      object_id: { ...shotId, description: "One exact object id from shot.visual.objects." },
      selector: { type: "string", pattern: "^#[a-z0-9][a-z0-9_-]{0,127}$" },
      at_seconds: { type: "number", minimum: 0 },
      duration_seconds: { type: "number", minimum: 0.05, maximum: 3.5, description: "Must not exceed the selected window's maximum_duration_seconds." },
      intent: { type: "string", enum: ["entrance", "semantic-reveal", "emphasis", "progression", "exit"] },
      changes: {
        type: "array",
        minItems: 1,
        maxItems: 2,
        description: "Exact non-equal numeric states for one or two perceptible transform/opacity changes. The implementation uses these values in tl.fromTo.",
        items: strictObject({
          property: { type: "string", enum: Object.keys(SUPPORTING_CHANGE_LIMITS) },
          from_value: { type: "number", minimum: -1920, maximum: 1920 },
          to_value: { type: "number", minimum: -1920, maximum: 1920 }
        })
      },
      action: { type: "string", minLength: 1, maxLength: 240, description: "A concrete seek-safe GSAP action with a perceptible visual change." }
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
- Map every supplied supporting_motion_contract window exactly once in supporting_motion_beats. Start inside the narrow window and keep duration between its minimum_duration_seconds and maximum_duration_seconds. These are additional visual actions on planned objects, not new claims, SFX cues, or shot.visual.events.
- Give every supporting beat exact non-equal numeric from/to values in changes. At least one change per beat must meet its per-property minimum magnitude; a second property may provide a subtler companion adjustment. Opening must use a hook-scale x, y, scale, or rotation change, begin by 0.1s, and be visibly underway before 0.65s; opacity alone is not an opening hook.
- Distribute supporting targets where the object set allows it and target non-container semantic objects at least minimum_semantic_beats times. Do not spend most development windows on decorative background fades.
- Use 2-4 coherent motion patterns across the scene, such as transform entrances, staggered reveals, path/progress development, or restrained emphasis. The windows deliberately cover more than half the scene: use their full authored duration, preserve the final readable state, and never tween layout properties or create endless drift.
- Use concrete visual forms that express the declared diagram, comparison, process, timeline, data view, or spatial metaphor. Avoid a sparse headline floating over decoration and avoid generic card grids unless the plan explicitly calls for them.
- Plan phone-readable typography and a meaningful occupied-area target. The fullest frame should feel composed, not empty.
- Preserve exact supplied on-screen copy and evidence. Do not add claims.
- Keep the concept original while obeying the supplied style DNA, continuity, and transition direction.`;

export function buildFrameBlueprintInput({ intake, evidence, plan, shot, index, narrationTiming = null, prior = null, errors = [] }) {
  const anchors = narrationAnchors(narrationTiming, shot);
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
    narration_anchors: anchors,
    required_object_ids: (shot.visual?.objects ?? []).map((entry) => entry.id),
    required_events: (shot.visual?.events ?? []).map((entry) => ({ id: entry.id, target_ids: entry.target_ids, at_seconds: entry.at_seconds })),
    supporting_motion_contract: supportingMotionContract(shot, anchors),
    required_selector_prefix: `#${shot.id}-`,
    prior_blueprint: prior,
    validation_errors_to_repair: errors
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

  const supportingContract = supportingMotionContract(shot);
  const supportingWindows = new Map(supportingContract.windows.map((entry) => [entry.id, entry]));
  const supportingBeats = Array.isArray(blueprint?.supporting_motion_beats) ? blueprint.supporting_motion_beats : [];
  const seenWindows = new Set();
  let semanticSupportingBeats = 0;
  for (const [index, beat] of supportingBeats.entries()) {
    const window = supportingWindows.get(beat?.window_id);
    if (!window) errors.push(`supporting_motion_beats[${index}].window_id is not required: ${beat?.window_id}`);
    if (seenWindows.has(beat?.window_id)) errors.push(`supporting_motion_beats[${index}].window_id must be unique: ${beat?.window_id}`);
    seenWindows.add(beat?.window_id);
    const object = plannedObjects.get(beat?.object_id);
    if (!object) errors.push(`supporting_motion_beats[${index}].object_id is not planned: ${beat?.object_id}`);
    if (object && !["container", "decoration"].includes(object.kind)) semanticSupportingBeats += 1;
    const element = elementByObject.get(beat?.object_id);
    if (element && beat?.selector !== element.selector) errors.push(`supporting_motion_beats[${index}].selector must match ${beat?.object_id}`);
    const atSeconds = Number(beat?.at_seconds);
    const beatDuration = Number(beat?.duration_seconds);
    if (window && (!Number.isFinite(atSeconds) || atSeconds < window.start_seconds - .05 || atSeconds > window.end_seconds + .05)) {
      errors.push(`supporting_motion_beats[${index}].at_seconds must be inside ${window.id} (${window.start_seconds}-${window.end_seconds})`);
    }
    if (!Number.isFinite(beatDuration) || beatDuration < .05 || beatDuration > 3.5 || (window && (beatDuration < window.minimum_duration_seconds - .05 || beatDuration > window.maximum_duration_seconds + .05)) || atSeconds + beatDuration > duration + .05) {
      errors.push(`supporting_motion_beats[${index}].duration_seconds must finish inside the shot`);
    }
    const changes = Array.isArray(beat?.changes) ? beat.changes : [];
    const seenProperties = new Set();
    let perceptibleMagnitude = false;
    let openingMagnitude = false;
    for (const [changeIndex, change] of changes.entries()) {
      const limits = SUPPORTING_CHANGE_LIMITS[change?.property];
      if (!limits) continue;
      if (seenProperties.has(change.property)) errors.push(`supporting_motion_beats[${index}].changes[${changeIndex}].property must be unique: ${change.property}`);
      seenProperties.add(change.property);
      const fromValue = Number(change?.from_value);
      const toValue = Number(change?.to_value);
      const delta = Math.abs(toValue - fromValue);
      if (!Number.isFinite(fromValue) || !Number.isFinite(toValue) || fromValue < limits.minimum || fromValue > limits.maximum || toValue < limits.minimum || toValue > limits.maximum) {
        errors.push(`supporting_motion_beats[${index}].changes[${changeIndex}] has invalid ${change.property} values`);
      } else if (delta < .001) {
        errors.push(`supporting_motion_beats[${index}].changes[${changeIndex}] ${change.property} must not be a no-op`);
      }
      if (delta >= limits.minimumDelta) perceptibleMagnitude = true;
      if (limits.hookDelta != null && delta >= limits.hookDelta) openingMagnitude = true;
    }
    if (changes.length && !perceptibleMagnitude) errors.push(`supporting_motion_beats[${index}] requires at least one change at the minimum perceptible magnitude`);
    if (window?.id === "opening") {
      if (atSeconds > .1 + .05) errors.push(`supporting_motion_beats[${index}] opening must begin by 0.1 seconds`);
      if (!["entrance", "semantic-reveal"].includes(beat?.intent)) errors.push(`supporting_motion_beats[${index}] opening intent must be entrance or semantic-reveal`);
      if (!openingMagnitude) errors.push(`supporting_motion_beats[${index}] opening requires a hook-scale x, y, scale, or rotation change`);
    }
  }
  for (const id of supportingWindows.keys()) if (!seenWindows.has(id)) errors.push(`supporting_motion_beats must include window: ${id}`);
  if (supportingBeats.length && semanticSupportingBeats < Math.ceil(supportingContract.minimum_semantic_beats)) {
    errors.push(`supporting_motion_beats must target semantic objects at least ${supportingContract.minimum_semantic_beats} times`);
  }

  for (const copy of shot?.on_screen_text ?? []) {
    if (!(blueprint?.visible_copy ?? []).includes(copy)) errors.push(`visible_copy must preserve: ${copy}`);
  }
  const focal = blueprint?.density?.focal_element_selector;
  if (focal && !selectors.has(focal)) errors.push(`density.focal_element_selector is unknown: ${focal}`);
  const semanticObjectCount = [...plannedObjects.values()].filter((entry) => entry.kind !== "decoration").length;
  if (Number(blueprint?.density?.minimum_semantic_objects) < semanticObjectCount) errors.push(`density.minimum_semantic_objects must be at least ${semanticObjectCount}`);
  return { ok: errors.length === 0, errors };
}

function supportingMotionContract(shot, anchors = []) {
  const duration = Math.max(.2, Number(shot?.end_seconds) - Number(shot?.start_seconds));
  const beatCount = Math.max(1, Math.min(6, Math.max(duration >= 8 ? 3 : 2, Math.ceil(duration / 3.5))));
  const semanticObjectCount = (shot?.visual?.objects ?? []).filter((entry) => !["container", "decoration"].includes(entry.kind)).length;
  const windows = Array.from({ length: beatCount }, (_, index) => {
    const segmentStart = duration * index / beatCount;
    const segmentEnd = duration * (index + 1) / beatCount;
    const startSeconds = segmentStart;
    const segmentDuration = segmentEnd - segmentStart;
    const opening = index === 0;
    const closing = index === beatCount - 1;
    const availableDuration = Math.max(.05, duration - segmentStart);
    const minimumDuration = opening ? Math.min(.55, duration) : Math.min(availableDuration, closing ? 2.4 : 2.8, Math.max(.8, segmentDuration * .65));
    const maximumDuration = opening ? Math.min(.65, duration) : Math.min(3.5, Math.max(minimumDuration, segmentDuration * .9));
    const endSeconds = opening ? Math.min(.1, Math.max(0, duration - minimumDuration)) : Math.min(segmentStart + Math.min(.35, segmentDuration * .1), duration - minimumDuration);
    const overlappingAnchors = anchors.filter((anchor) => Number(anchor.end_seconds) >= segmentStart && Number(anchor.start_seconds) <= segmentEnd);
    return {
      id: opening ? "opening" : closing ? "closing" : `development-${index}`,
      start_seconds: rounded(startSeconds),
      end_seconds: rounded(endSeconds),
      minimum_duration_seconds: rounded(Math.max(.05, minimumDuration)),
      maximum_duration_seconds: rounded(Math.max(.05, maximumDuration)),
      intent: opening ? "Move a large visible region immediately with a hook-scale transform" : closing ? "Sustain visible semantic motion into the handoff" : "Develop a semantic object with sustained visible motion while narration advances",
      ...(overlappingAnchors.length ? { narration_cue: compactText(overlappingAnchors.map((entry) => entry.text).join(" "), 120) } : {})
    };
  });
  return {
    required_supporting_beats: beatCount,
    minimum_semantic_beats: semanticObjectCount ? Math.ceil(beatCount / 2) : 0,
    minimum_change_magnitudes: Object.fromEntries(Object.entries(SUPPORTING_CHANGE_LIMITS).map(([property, limits]) => [property, limits.minimumDelta])),
    opening_hook_magnitudes: Object.fromEntries(Object.entries(SUPPORTING_CHANGE_LIMITS).filter(([, limits]) => limits.hookDelta != null).map(([property, limits]) => [property, limits.hookDelta])),
    rule: "Return exactly one sustained supporting_motion_beat per window with explicit non-equal numeric changes. Planned motion_beats remain separate timeline/SFX events.",
    windows
  };
}

function rounded(value) {
  return Number(Number(value).toFixed(2));
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
