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
      minItems: 1,
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
  if (context.expectedFormat) {
    const expected = context.expectedFormat;
    if (expected.aspect && plan.format?.aspect !== expected.aspect) errors.push(`format.aspect must match requested aspect ${expected.aspect}`);
    if (expected.width && Number(plan.format?.width) !== Number(expected.width)) errors.push(`format.width must match requested width ${expected.width}`);
    if (expected.height && Number(plan.format?.height) !== Number(expected.height)) errors.push(`format.height must match requested height ${expected.height}`);
    if (expected.language && String(plan.format?.language).toLowerCase() !== String(expected.language).toLowerCase()) errors.push(`format.language must match requested language ${expected.language}`);
  }
  if (context.expectedDuration != null && Number.isFinite(Number(context.expectedDuration)) && Math.abs(duration - Number(context.expectedDuration)) > 0.05) {
    errors.push(`format.duration_seconds must match required duration ${context.expectedDuration}`);
  }
  const seen = new Set();
  const presenterIds = idsForRole(context.resourceRoles, "presenter");
  let visiblePresenterShots = 0;
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
    if (shot?.presenter?.visible) {
      visiblePresenterShots += 1;
      if (context.resourceRoles && !shot.resource_ids?.some((id) => presenterIds.has(id))) errors.push(`${label} marks presenter visible without a presenter resource_id`);
    }
    cursor = end;
  }
  if (presenterIds.size && !visiblePresenterShots) errors.push("at least one shot must show the supplied presenter");
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
  if (context.requestedCta) {
    const requested = normalizeCopy(context.requestedCta);
    const delivered = normalizeCopy([
      plan.narration?.full_text,
      ...(plan.shots ?? []).flatMap((shot) => [shot.voiceover, ...(shot.on_screen_text ?? [])])
    ].filter(Boolean).join(" "));
    if (!delivered.includes(requested)) errors.push(`requested CTA must appear verbatim in narration or on-screen text: ${context.requestedCta}`);
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
  if (/<(?:iframe|object|embed|link|base|form)\b/i.test(html)) errors.push("frame HTML must not contain active embedding or navigation elements");
  if (/<script\b[^>]*\bsrc\s*=/i.test(html)) errors.push("frame HTML scripts must be inline and deterministic");
  if (/\son[a-z]+\s*=/i.test(html)) errors.push("frame HTML must not contain event-handler attributes");
  if (/\bsrcset\s*=/i.test(html)) errors.push("frame HTML must not contain unverified srcset resources");
  if (/\b(?:src|href|action|poster)\s*=\s*["']\s*(?:https?:|\/\/|file:|javascript:)/i.test(html)) errors.push("frame HTML must not load remote assets, file-scheme resources, or executable URLs at render time");
  if (/@import\b/i.test(html)) errors.push("frame CSS must not import external stylesheets");
  if (/url\(\s*["']?\s*(?:https?:|\/\/|file:|javascript:)/i.test(html)) errors.push("frame CSS must not load remote, file-scheme, or executable assets");
  if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|window\.open)\s*\(/i.test(html) || /\bnew\s+Image\s*\(/i.test(html) || /\bimport\s*\(/i.test(html)) errors.push("frame HTML must not perform render-time network requests");
  checkFrameAssetPaths(errors, html, context.allowedAssetPaths);
  if (/\b(?:Date\.now|Math\.random)\s*\(/i.test(html)) errors.push("frame HTML must be deterministic");
  const shotDuration = context.shot ? Number(context.shot.end_seconds) - Number(context.shot.start_seconds) : null;
  const motionOrders = new Map();
  for (const [index, assertion] of (bundle.motion?.assertions ?? []).entries()) {
    const label = `motion.assertions[${index}]`;
    if (assertion.appears_by_seconds == null && assertion.order == null && !assertion.must_stay_in_frame && !assertion.must_remain_live) {
      errors.push(`${label} must express at least one enforceable motion intent`);
    }
    const selector = String(assertion.selector ?? "");
    const expectedPrefix = `#${bundle.shot_id}-`;
    if (!isValidShotId(bundle.shot_id) || !selector.startsWith(expectedPrefix) || !/^#[a-z0-9][a-z0-9_-]*$/i.test(selector)) {
      errors.push(`${label}.selector must be one real shot-prefixed id selector beginning ${expectedPrefix}`);
    } else if (!new RegExp(`\\bid\\s*=\\s*["']${escapeRegExp(selector.slice(1))}["']`, "i").test(html)) {
      errors.push(`${label}.selector does not exist in frame HTML: ${selector}`);
    }
    if (shotDuration != null && assertion.appears_by_seconds != null && Number(assertion.appears_by_seconds) > shotDuration + .001) {
      errors.push(`${label}.appears_by_seconds falls outside the shot-local duration ${shotDuration}`);
    }
    if (assertion.order != null) {
      if (motionOrders.has(assertion.order)) errors.push(`${label}.order duplicates ${motionOrders.get(assertion.order)}; simultaneous entrances must use null order`);
      else motionOrders.set(assertion.order, label);
    }
  }
  checkReferences(errors, "evidence_ids", bundle.evidence_ids, context.evidenceIds);
  checkReferences(errors, "root_media_requests.resource_id", (bundle.root_media_requests ?? []).map((entry) => entry.resource_id), context.resourceIds);
  const allowedShotResources = context.shot ? new Set(context.shot.resource_ids ?? []) : null;
  const presenterIds = idsForRole(context.resourceRoles, "presenter");
  for (const [index, request] of (bundle.root_media_requests ?? []).entries()) {
    if (!(request.end_seconds > request.start_seconds)) errors.push(`root_media_requests[${index}] must have end_seconds > start_seconds`);
    if (request.source_end_seconds != null && request.source_start_seconds != null && !(request.source_end_seconds > request.source_start_seconds)) {
      errors.push(`root_media_requests[${index}] must have source_end_seconds > source_start_seconds`);
    }
    if (request.source_end_seconds != null && request.source_start_seconds != null) {
      const slotDuration = request.end_seconds - request.start_seconds;
      const sourceDuration = request.source_end_seconds - request.source_start_seconds;
      if (Math.abs(slotDuration - sourceDuration) > .05) errors.push(`root_media_requests[${index}] source range must match its output duration; HyperFrames does not infer retiming`);
    }
    if (allowedShotResources && !allowedShotResources.has(request.resource_id)) errors.push(`root_media_requests[${index}] uses a resource not approved for this shot: ${request.resource_id}`);
    if (shotDuration != null && (request.start_seconds < 0 || request.end_seconds > shotDuration + .05)) errors.push(`root_media_requests[${index}] falls outside the shot-local duration ${shotDuration}`);
    if (context.shot && presenterIds.has(request.resource_id)) {
      const expectedSourceStart = Number(context.shot.start_seconds) + Number(request.start_seconds);
      const actualSourceStart = Number(request.source_start_seconds ?? 0);
      if (Math.abs(actualSourceStart - expectedSourceStart) > .05) errors.push(`root_media_requests[${index}] presenter source_start_seconds must follow the continuous production timeline (expected ${expectedSourceStart}, got ${actualSourceStart})`);
    }
    if (context.format && (request.placement.x >= context.format.width || request.placement.y >= context.format.height || request.placement.x + request.placement.width <= 0 || request.placement.y + request.placement.height <= 0)) {
      errors.push(`root_media_requests[${index}] placement does not intersect the ${context.format.width}x${context.format.height} canvas`);
    }
  }
  if (context.shot?.presenter?.visible && context.resourceRoles && !(bundle.root_media_requests ?? []).some((request) => presenterIds.has(request.resource_id) && request.kind === "video")) {
    errors.push("visible presenter shot must mount a presenter video at the host root");
  }
  return { ok: errors.length === 0, errors };
}

function normalizeCopy(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function idsForRole(resourceRoles, role) {
  if (!resourceRoles) return new Set();
  const entries = resourceRoles instanceof Map ? resourceRoles.entries() : Object.entries(resourceRoles);
  return new Set([...entries].filter(([, value]) => value === role).map(([id]) => id));
}

function checkFrameAssetPaths(errors, html, allowed) {
  if (!allowed) return;
  const paths = new Set([...allowed].map(String));
  const candidates = [
    ...String(html).matchAll(/\b(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi),
    ...String(html).matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)
  ].map((match) => match[1].trim()).filter((value) => value && !/^(?:data:image\/|blob:|#)/i.test(value));
  for (const candidate of candidates) {
    if (!paths.has(candidate)) errors.push(`frame HTML references an unapproved asset path: ${candidate}`);
  }
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
