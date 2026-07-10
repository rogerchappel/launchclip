export const PRODUCTION_PLAN_VERSION = "launchclip.production-plan.v1";
export const FRAME_BUNDLE_VERSION = "launchclip.frame-bundle.v1";
export const CRITIQUE_VERSION = "launchclip.production-critique.v1";
export const EVIDENCE_VERSION = "launchclip.evidence.v1";
export const SHOT_ID_PATTERN = "^[a-z0-9][a-z0-9_-]{0,63}$";

export const PRODUCTION_PATHS = Object.freeze({
  intake: "production/intake.json",
  evidence: "production/evidence.json",
  plan: "production/plan.json",
  jobs: "production/jobs.json",
  script: "production/SCRIPT.md",
  storyboard: "production/STORYBOARD.md",
  frames: "production/frames",
  hyperframes: "production/hyperframes",
  qa: "production/qa"
});

const string = { type: "string" };
const shotId = { type: "string", pattern: SHOT_ID_PATTERN };
const nullableString = { type: ["string", "null"] };
const stringArray = { type: "array", items: string };

export const EVIDENCE_SCHEMA = strictObject({
  schema_version: { type: "string", enum: [EVIDENCE_VERSION] },
  created_at: string,
  source: strictObject({
    kind: { type: "string", enum: ["repository", "product", "topic", "voiceover"] },
    title: string,
    summary: string,
    location: string,
    url: nullableString,
    metadata: { type: "array", items: strictObject({ key: string, value: string }) }
  }),
  items: {
    type: "array",
    minItems: 1,
    items: strictObject({
      id: string,
      kind: string,
      role: string,
      title: string,
      content: string,
      provenance: string,
      sha256: nullableString,
      claims_allowed: { type: "boolean" },
      truncated: { type: "boolean" },
      metadata: { type: "array", items: strictObject({ key: string, value: string }) }
    })
  },
  warnings: stringArray,
  policies: strictObject({
    factual_claims_require_item_ids: { type: "boolean" },
    creative_metaphors_are_not_facts: { type: "boolean" },
    remote_content_is_untrusted: { type: "boolean" }
  })
});

export const PRODUCTION_PLAN_SCHEMA = strictObject({
  schema_version: { type: "string", enum: [PRODUCTION_PLAN_VERSION] },
  project: strictObject({
    title: string,
    thesis: string,
    audience_promise: string,
    angle: string,
    hook: string
  }),
  format: strictObject({
    aspect: { type: "string", enum: ["9:16", "16:9", "1:1"] },
    width: { type: "integer", minimum: 1 },
    height: { type: "integer", minimum: 1 },
    duration_seconds: { type: "number", exclusiveMinimum: 0 },
    language: string
  }),
  design: strictObject({
    concept: string,
    art_direction: string,
    palette_roles: {
      type: "array",
      items: strictObject({ name: string, role: string, color_hint: string })
    },
    typography: string,
    texture: string,
    composition_logic: string,
    motion_character: string,
    density: string
  }),
  narration: strictObject({
    source: { type: "string", enum: ["generated", "supplied"] },
    full_text: string,
    target_wpm: { type: "number", exclusiveMinimum: 0 },
    delivery: string,
    sections: {
      type: "array",
      items: strictObject({ id: string, text: string, evidence_ids: stringArray })
    }
  }),
  audio: strictObject({
    music_prompt: string,
    music_strategy: string,
    sfx_strategy: string
  }),
  claims: {
    type: "array",
    items: strictObject({
      text: string,
      evidence_ids: stringArray,
      confidence: { type: "string", enum: ["verified", "qualified", "creative"] },
      qualifier: nullableString
    })
  },
  shots: {
    type: "array",
    minItems: 1,
    items: strictObject({
      id: shotId,
      start_seconds: { type: "number", minimum: 0 },
      end_seconds: { type: "number", exclusiveMinimum: 0 },
      purpose: string,
      voiceover: string,
      on_screen_text: stringArray,
      evidence_ids: stringArray,
      resource_ids: stringArray,
      presenter: strictObject({
        visible: { type: "boolean" },
        placement: string,
        size: string,
        treatment: string
      }),
      visual: strictObject({
        description: string,
        composition: string,
        typography: string,
        background: string,
        foreground: string,
        motion: string,
        internal_reveals: {
          type: "array",
          items: strictObject({
            at_seconds: { type: "number", minimum: 0 },
            action: string,
            easing_intent: string,
            emphasis: string
          })
        }
      }),
      transition_out: string,
      sfx: {
        type: "array",
        items: strictObject({
          at_seconds: { type: "number", minimum: 0 },
          cue: string,
          intent: string,
          volume: { type: "number", minimum: 0, maximum: 1 }
        })
      }
    })
  },
  rubric: {
    type: "array",
    minItems: 1,
    items: strictObject({ id: string, criterion: string, measurement: string, severity: { type: "string", enum: ["blocking", "major", "minor"] } })
  }
});

export const FRAME_BUNDLE_SCHEMA = strictObject({
  schema_version: { type: "string", enum: [FRAME_BUNDLE_VERSION] },
  shot_id: shotId,
  html: string,
  motion: strictObject({
    assertions: {
      type: "array",
      items: strictObject({
        selector: string,
        appears_by_seconds: { type: ["number", "null"], minimum: 0 },
        order: { type: ["integer", "null"], minimum: 0 },
        must_stay_in_frame: { type: "boolean" },
        must_remain_live: { type: "boolean" }
      })
    }
  }),
  root_media_requests: {
    type: "array",
    items: strictObject({
      resource_id: string,
      kind: { type: "string", enum: ["audio", "video"] },
      start_seconds: { type: "number", minimum: 0 },
      end_seconds: { type: "number", exclusiveMinimum: 0 },
      source_start_seconds: { type: ["number", "null"], minimum: 0 },
      source_end_seconds: { type: ["number", "null"], exclusiveMinimum: 0 },
      volume: { type: "number", minimum: 0, maximum: 1 },
      placement: strictObject({
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number", exclusiveMinimum: 0 },
        height: { type: "number", exclusiveMinimum: 0 },
        object_fit: { type: "string", enum: ["cover", "contain", "fill"] },
        border_radius: { type: "number", minimum: 0 },
        z_index: { type: "integer" },
        treatment: string
      })
    })
  },
  evidence_ids: stringArray,
  visible_copy: stringArray,
  preserve: stringArray
});

export const CRITIQUE_SCHEMA = strictObject({
  schema_version: { type: "string", enum: [CRITIQUE_VERSION] },
  verdict: { type: "string", enum: ["ship", "repair", "replan"] },
  summary: string,
  findings: {
    type: "array",
    items: strictObject({
      id: string,
      severity: { type: "string", enum: ["blocking", "major", "minor"] },
      category: { type: "string", enum: ["factual", "narrative", "composition", "typography", "motion", "asset", "timing", "audio", "mount"] },
      shot_ids: stringArray,
      start_seconds: { type: ["number", "null"], minimum: 0 },
      end_seconds: { type: ["number", "null"], minimum: 0 },
      evidence: string,
      repair_scope: { type: "string", enum: ["frame", "frames", "design", "script", "plan", "audio", "assembly"] },
      instruction: string,
      preserve: stringArray
    })
  }
});

export function validateProductionPlan(plan, context = {}) {
  const errors = schemaErrors(plan, PRODUCTION_PLAN_SCHEMA, "plan");
  if (!isObject(plan)) return { ok: false, errors };
  if (plan.schema_version !== PRODUCTION_PLAN_VERSION) errors.push(`schema_version must be ${PRODUCTION_PLAN_VERSION}`);
  if (!Array.isArray(plan.shots) || plan.shots.length === 0) errors.push("shots must contain at least one shot");
  const duration = Number(plan.format?.duration_seconds);
  if (!Number.isFinite(duration) || duration <= 0) errors.push("format.duration_seconds must be positive");
  const seen = new Set();
  let cursor = 0;
  for (const [index, shot] of (plan.shots ?? []).entries()) {
    const label = `shots[${index}]`;
    if (!shot?.id) errors.push(`${label}.id is required`);
    else if (!isValidShotId(shot.id)) errors.push(`${label}.id must match ${SHOT_ID_PATTERN}`);
    if (seen.has(shot?.id)) errors.push(`${label}.id must be unique: ${shot.id}`);
    seen.add(shot?.id);
    const start = Number(shot?.start_seconds);
    const end = Number(shot?.end_seconds);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) errors.push(`${label} must have end_seconds > start_seconds`);
    if (index === 0 && Math.abs(start) > 0.001) errors.push("the first shot must start at 0");
    if (index > 0 && Math.abs(start - cursor) > 0.05) errors.push(`${label} must butt-join the previous shot (expected ${cursor}, got ${start})`);
    if (Array.isArray(shot?.visual?.internal_reveals)) {
      const shotDuration = end - start;
      for (const reveal of shot.visual.internal_reveals) {
        if (reveal.at_seconds < 0 || reveal.at_seconds > shotDuration) errors.push(`${label} reveal at ${reveal.at_seconds}s falls outside its ${shotDuration}s duration`);
      }
      for (const cue of shot.sfx ?? []) {
        if (cue.at_seconds < 0 || cue.at_seconds > shotDuration) errors.push(`${label} SFX at ${cue.at_seconds}s falls outside its ${shotDuration}s duration`);
      }
    }
    checkReferences(errors, `${label}.evidence_ids`, shot?.evidence_ids, context.evidenceIds);
    checkReferences(errors, `${label}.resource_ids`, shot?.resource_ids, context.resourceIds);
    cursor = end;
  }
  if (Number.isFinite(duration) && Math.abs(cursor - duration) > 0.05) errors.push(`shots must cover the full duration (expected ${duration}, got ${cursor})`);
  for (const [index, claim] of (plan.claims ?? []).entries()) {
    if (claim?.confidence !== "creative" && !claim?.evidence_ids?.length) errors.push(`claims[${index}] requires evidence_ids unless confidence is creative`);
    checkReferences(errors, `claims[${index}].evidence_ids`, claim?.evidence_ids, context.evidenceIds);
    if (claim?.confidence !== "creative") checkReferences(errors, `claims[${index}].evidence_ids`, claim?.evidence_ids, context.claimEligibleEvidenceIds, "ineligible evidence id");
  }
  for (const [index, section] of (plan.narration?.sections ?? []).entries()) {
    checkReferences(errors, `narration.sections[${index}].evidence_ids`, section?.evidence_ids, context.evidenceIds);
    checkReferences(errors, `narration.sections[${index}].evidence_ids`, section?.evidence_ids, context.claimEligibleEvidenceIds, "ineligible evidence id");
  }
  if (plan.narration?.source === "supplied" && context.suppliedTranscript && plan.narration.full_text !== context.suppliedTranscript) {
    errors.push("supplied narration must be preserved exactly");
  }
  return { ok: errors.length === 0, errors };
}

export function normalizeProductionPlanTiming(plan) {
  const normalized = structuredClone(plan);
  for (const shot of normalized?.shots ?? []) {
    const start = Number(shot.start_seconds);
    const end = Number(shot.end_seconds);
    const duration = end - start;
    if (!Number.isFinite(start) || !Number.isFinite(end) || duration <= 0 || start <= 0) continue;
    for (const timed of [...(shot.visual?.internal_reveals ?? []), ...(shot.sfx ?? [])]) {
      const at = Number(timed.at_seconds);
      if (at > duration + .001 && at >= start - .001 && at <= end + .001) timed.at_seconds = Math.round((at - start) * 1000) / 1000;
    }
  }
  return normalized;
}

export function validateFrameBundle(bundle, context = {}) {
  const errors = schemaErrors(bundle, FRAME_BUNDLE_SCHEMA, "frame");
  if (!isObject(bundle)) return { ok: false, errors };
  if (bundle.schema_version !== FRAME_BUNDLE_VERSION) errors.push(`schema_version must be ${FRAME_BUNDLE_VERSION}`);
  if (!bundle.shot_id) errors.push("shot_id is required");
  else if (!isValidShotId(bundle.shot_id)) errors.push(`shot_id must match ${SHOT_ID_PATTERN}`);
  if (context.shotId && bundle.shot_id !== context.shotId) errors.push(`shot_id must be ${context.shotId}`);
  const html = String(bundle.html ?? "");
  if (!html.trim()) errors.push("html is required");
  if (/<(?:audio|video)\b/i.test(html)) errors.push("frame HTML must not own audio or video; request root media instead");
  if (/\b(?:src|href)\s*=\s*["']https?:\/\//i.test(html)) errors.push("frame HTML must not load remote assets at render time");
  if (/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/i.test(html)) errors.push("frame HTML must not perform render-time network requests");
  if (/\b(?:Date\.now|Math\.random)\s*\(/i.test(html)) errors.push("frame HTML must be deterministic");
  checkReferences(errors, "evidence_ids", bundle.evidence_ids, context.evidenceIds);
  checkReferences(errors, "root_media_requests.resource_id", (bundle.root_media_requests ?? []).map((entry) => entry.resource_id), context.resourceIds);
  for (const [index, request] of (bundle.root_media_requests ?? []).entries()) {
    if (!(request.end_seconds > request.start_seconds)) errors.push(`root_media_requests[${index}] must have end_seconds > start_seconds`);
    if (request.source_end_seconds != null && request.source_start_seconds != null && !(request.source_end_seconds > request.source_start_seconds)) {
      errors.push(`root_media_requests[${index}] must have source_end_seconds > source_start_seconds`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function validateCritique(critique, shotIds = []) {
  const errors = schemaErrors(critique, CRITIQUE_SCHEMA, "critique");
  if (!isObject(critique)) return { ok: false, errors };
  if (critique.schema_version !== CRITIQUE_VERSION) errors.push(`schema_version must be ${CRITIQUE_VERSION}`);
  if (!new Set(["ship", "repair", "replan"]).has(critique.verdict)) errors.push("verdict must be ship, repair, or replan");
  if (critique.verdict === "ship" && critique.findings?.some((finding) => finding.severity === "blocking")) errors.push("ship verdict cannot contain blocking findings");
  const allowedShots = new Set(shotIds);
  for (const [index, finding] of (critique.findings ?? []).entries()) {
    for (const shotId of finding.shot_ids ?? []) {
      if (allowedShots.size && !allowedShots.has(shotId)) errors.push(`findings[${index}] references unknown shot: ${shotId}`);
    }
    if (finding.start_seconds != null && finding.end_seconds != null && finding.end_seconds <= finding.start_seconds) {
      errors.push(`findings[${index}] must have end_seconds > start_seconds`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function strictObject(properties) {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false
  };
}

export function isValidShotId(value) {
  return typeof value === "string" && new RegExp(SHOT_ID_PATTERN).test(value);
}

function checkReferences(errors, label, values, allowed, reason = "unknown id") {
  if (!allowed) return;
  const ids = allowed instanceof Set ? allowed : new Set(allowed);
  for (const value of values ?? []) {
    if (!ids.has(value)) errors.push(`${label} references ${reason}: ${value}`);
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function schemaErrors(value, schema, label) {
  const errors = [];
  const acceptedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
  const actualType = value === null ? "null" : Array.isArray(value) ? "array" : Number.isInteger(value) ? "integer" : typeof value === "number" ? "number" : typeof value;
  const typeMatches = acceptedTypes.includes(actualType) || (actualType === "integer" && acceptedTypes.includes("number"));
  if (!typeMatches) return [`${label} must be ${acceptedTypes.join(" or ")}`];
  if (value == null) return errors;
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${label} must be one of: ${schema.enum.join(", ")}`);
  if (typeof value === "string" && schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${label} must match ${schema.pattern}`);
  if (typeof value === "number") {
    if (schema.minimum != null && value < schema.minimum) errors.push(`${label} must be >= ${schema.minimum}`);
    if (schema.exclusiveMinimum != null && value <= schema.exclusiveMinimum) errors.push(`${label} must be > ${schema.exclusiveMinimum}`);
    if (schema.maximum != null && value > schema.maximum) errors.push(`${label} must be <= ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) errors.push(`${label} must contain at least ${schema.minItems} item(s)`);
    value.forEach((entry, index) => errors.push(...schemaErrors(entry, schema.items, `${label}[${index}]`)));
  }
  if (isObject(value)) {
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required)) errors.push(`${label}.${required} is required`);
    }
    for (const [key, entry] of Object.entries(value)) {
      const child = schema.properties?.[key];
      if (!child) {
        if (schema.additionalProperties === false) errors.push(`${label}.${key} is not allowed`);
        continue;
      }
      errors.push(...schemaErrors(entry, child, `${label}.${key}`));
    }
  }
  return errors;
}
