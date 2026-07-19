export const CINEMATIC_CONCEPT_SET_VERSION = "launchclip.cinematic-concept-set.v1";
export const CINEMATIC_CONCEPT_JUDGMENT_VERSION = "launchclip.cinematic-concept-judgment.v1";
export const CINEMATIC_TOURNAMENT_VERSION = "launchclip.cinematic-tournament.v1";
export const CINEMATIC_STORY_VERSION = "launchclip.cinematic-story.v1";
export const CINEMATIC_STORY_EDIT_VERSION = "launchclip.cinematic-story-edit.v1";

const id = { type: "string", pattern: "^[a-z0-9][a-z0-9_-]{0,63}$" };
const string = { type: "string", minLength: 1 };
const nullableString = { type: ["string", "null"] };
const stringArray = { type: "array", items: string };
const score = { type: "integer", minimum: 0, maximum: 10 };

const CONCEPT_BEAT_SCHEMA = strictObject({
  id,
  role: { type: "string", enum: ["hook", "promise", "mechanism", "proof", "rehook", "escalation", "payoff", "closing"] },
  turn: string,
  evidence_ids: stringArray,
  resource_ids: stringArray,
  visual_opportunity: string,
  sound_opportunity: string
});

const CONCEPT_CANDIDATE_SCHEMA = strictObject({
  id,
  title: string,
  hook: strictObject({
    spoken_line: string,
    open_loop: string,
    proof_tease: string,
    promised_payoff: string
  }),
  audience_tension: string,
  thesis: string,
  narrative_engine: { type: "string", enum: ["reveal", "transformation", "investigation", "contrarian-proof", "countdown", "before-after", "cause-and-effect"] },
  causal_beats: { type: "array", minItems: 4, items: CONCEPT_BEAT_SCHEMA },
  art_direction_seed: strictObject({
    visual_metaphor: string,
    spatial_world: string,
    motion_language: string,
    transition_logic: string,
    sound_world: string
  }),
  differentiators: { type: "array", minItems: 2, items: string },
  risks: stringArray
});

export const CINEMATIC_CONCEPT_SET_SCHEMA = strictObject({
  schema_version: { type: "string", enum: [CINEMATIC_CONCEPT_SET_VERSION] },
  candidates: { type: "array", minItems: 1, maxItems: 5, items: CONCEPT_CANDIDATE_SCHEMA }
});

const CONCEPT_EVALUATION_SCHEMA = strictObject({
  candidate_id: id,
  scores: strictObject({
    scroll_stop: score,
    promise_clarity: score,
    audience_fit: score,
    causality: score,
    proof: score,
    visual_originality: score,
    motion: score,
    sound: score,
    feasibility: score
  }),
  penalties: strictObject({
    genericism: score,
    slideshow_risk: score,
    clickbait_or_unsupported: score
  }),
  rationale: string,
  required_improvements: stringArray
});

export const CINEMATIC_CONCEPT_JUDGMENT_SCHEMA = strictObject({
  schema_version: { type: "string", enum: [CINEMATIC_CONCEPT_JUDGMENT_VERSION] },
  evaluations: { type: "array", minItems: 1, maxItems: 5, items: CONCEPT_EVALUATION_SCHEMA },
  recommended_id: id,
  selection_rationale: string
});

const STORY_BEAT_ROLES = ["hook", "setup", "promise", "mechanism", "proof", "rehook", "escalation", "payoff", "closing_reframe", "cta_or_loop"];
const STORY_BEAT_SCHEMA = strictObject({
  id,
  role: { type: "string", enum: STORY_BEAT_ROLES },
  target_start_seconds: { type: "number", minimum: 0 },
  target_end_seconds: { type: "number", exclusiveMinimum: 0 },
  spoken_text: string,
  narrative_turn: string,
  viewer_question: string,
  visual_noun: string,
  desired_emotion: string,
  evidence_ids: stringArray,
  resource_ids: stringArray
});

export const CINEMATIC_STORY_SCHEMA = strictObject({
  schema_version: { type: "string", enum: [CINEMATIC_STORY_VERSION] },
  concept_id: id,
  project: strictObject({
    title: string,
    thesis: string,
    audience_promise: string
  }),
  format: strictObject({
    aspect: { type: "string", enum: ["9:16", "16:9", "1:1"] },
    width: { type: "integer", minimum: 1 },
    height: { type: "integer", minimum: 1 },
    duration_seconds: { type: "number", exclusiveMinimum: 0 },
    language: string
  }),
  narration: strictObject({
    source: { type: "string", enum: ["generated", "supplied"] },
    full_text: string,
    target_wpm: { type: "number", exclusiveMinimum: 0 },
    delivery: string,
    beats: { type: "array", minItems: 1, items: STORY_BEAT_SCHEMA }
  }),
  open_loop: strictObject({
    question: string,
    resolved_by_beat_id: id,
    midpoint_rehook_beat_id: nullableString
  }),
  claims: {
    type: "array",
    items: strictObject({
      text: string,
      evidence_ids: stringArray,
      confidence: { type: "string", enum: ["verified", "qualified", "creative"] },
      qualifier: nullableString
    })
  }
});

export const CINEMATIC_STORY_EDIT_SCHEMA = strictObject({
  schema_version: { type: "string", enum: [CINEMATIC_STORY_EDIT_VERSION] },
  verdict: { type: "string", enum: ["ready", "revised"] },
  scores: strictObject({
    hook: score,
    compression: score,
    curiosity: score,
    clarity: score,
    proof: score,
    payoff: score,
    speakability: score,
    visuality: score
  }),
  findings: {
    type: "array",
    items: strictObject({
      category: { type: "string", enum: ["hook", "compression", "curiosity", "clarity", "proof", "payoff", "speakability", "visuality", "grounding", "timing"] },
      severity: { type: "string", enum: ["major", "minor"] },
      instruction: string
    })
  },
  story: CINEMATIC_STORY_SCHEMA
});

const SCORE_WEIGHTS = Object.freeze({
  scroll_stop: 16,
  promise_clarity: 11,
  audience_fit: 10,
  causality: 10,
  proof: 12,
  visual_originality: 16,
  motion: 10,
  sound: 5,
  feasibility: 10
});

const PENALTY_WEIGHTS = Object.freeze({ genericism: 0.8, slideshow_risk: 1, clickbait_or_unsupported: 1.5 });

export function scoreConceptEvaluation(evaluation) {
  const base = Object.entries(SCORE_WEIGHTS).reduce((total, [key, weight]) => total + numeric(evaluation?.scores?.[key]) * weight / 10, 0);
  const penalty = Object.entries(PENALTY_WEIGHTS).reduce((total, [key, weight]) => total + numeric(evaluation?.penalties?.[key]) * weight, 0);
  return Math.round((base - penalty) * 100) / 100;
}

export function rankConceptEvaluations(judgment, candidateIds = []) {
  const order = new Map(candidateIds.map((candidateId, index) => [candidateId, index]));
  return [...(judgment?.evaluations ?? [])]
    .map((evaluation) => ({ ...evaluation, total_score: scoreConceptEvaluation(evaluation) }))
    .sort((left, right) => right.total_score - left.total_score || (order.get(left.candidate_id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.candidate_id) ?? Number.MAX_SAFE_INTEGER) || left.candidate_id.localeCompare(right.candidate_id));
}

export function createCinematicTournament(conceptSet, judgment) {
  const candidateIds = conceptSet.candidates.map((candidate) => candidate.id);
  const evaluations = rankConceptEvaluations(judgment, candidateIds);
  const selectedId = evaluations[0]?.candidate_id ?? null;
  return {
    schema_version: CINEMATIC_TOURNAMENT_VERSION,
    candidates: conceptSet.candidates,
    evaluations,
    selected_id: selectedId,
    selection: {
      judge_recommended_id: judgment.recommended_id,
      rationale: judgment.selection_rationale,
      required_improvements: evaluations.find((entry) => entry.candidate_id === selectedId)?.required_improvements ?? []
    }
  };
}

export function validateConceptSet(value, context = {}) {
  const errors = schemaErrors(value, CINEMATIC_CONCEPT_SET_SCHEMA, "concept_set");
  if (!isObject(value)) return result(errors);
  const candidates = Array.isArray(value.candidates) ? value.candidates : [];
  const expectedCount = Number(context.candidateCount ?? 5);
  if (candidates.length !== expectedCount) errors.push(`candidates must contain exactly ${expectedCount} concepts`);
  uniqueField(errors, candidates, "id", "candidate ids");
  uniqueNormalizedField(errors, candidates, (entry) => entry.title, "candidate titles");
  uniqueNormalizedField(errors, candidates, (entry) => entry.hook?.spoken_line, "spoken hooks");
  const engines = new Set(candidates.map((entry) => entry.narrative_engine).filter(Boolean));
  if (candidates.length >= 3 && engines.size < 3) errors.push("candidates must use at least three distinct narrative engines");
  const worlds = new Set(candidates.map((entry) => normalizeCopy(entry.art_direction_seed?.visual_metaphor)).filter(Boolean));
  if (candidates.length >= 3 && worlds.size < 3) errors.push("candidates must propose at least three distinct visual metaphors");
  for (const [index, candidate] of candidates.entries()) {
    const beats = candidate.causal_beats ?? [];
    if (beats[0]?.role !== "hook") errors.push(`candidates[${index}] must begin with a hook beat`);
    if (!beats.some((beat) => beat.role === "proof")) errors.push(`candidates[${index}] must contain a proof beat`);
    if (!beats.some((beat) => beat.role === "payoff" || beat.role === "closing")) errors.push(`candidates[${index}] must contain a payoff or closing beat`);
    if (wordCount(candidate.hook?.spoken_line) > 18) errors.push(`candidates[${index}].hook.spoken_line must be 18 words or fewer`);
    uniqueField(errors, beats, "id", `candidates[${index}] beat ids`);
    for (const [beatIndex, beat] of beats.entries()) {
      checkReferences(errors, `candidates[${index}].causal_beats[${beatIndex}].evidence_ids`, beat.evidence_ids, context.evidenceIds);
      checkReferences(errors, `candidates[${index}].causal_beats[${beatIndex}].resource_ids`, beat.resource_ids, context.resourceIds);
    }
  }
  return result(errors);
}

export function validateConceptJudgment(value, conceptSet) {
  const errors = schemaErrors(value, CINEMATIC_CONCEPT_JUDGMENT_SCHEMA, "judgment");
  if (!isObject(value)) return result(errors);
  const candidateIds = (conceptSet?.candidates ?? []).map((candidate) => candidate.id);
  const allowed = new Set(candidateIds);
  const evaluations = Array.isArray(value.evaluations) ? value.evaluations : [];
  if (evaluations.length !== candidateIds.length) errors.push("judgment must evaluate every candidate exactly once");
  uniqueField(errors, evaluations, "candidate_id", "evaluation candidate ids");
  for (const [index, evaluation] of evaluations.entries()) {
    if (!allowed.has(evaluation.candidate_id)) errors.push(`evaluations[${index}] references unknown candidate: ${evaluation.candidate_id}`);
  }
  if (!allowed.has(value.recommended_id)) errors.push(`recommended_id references unknown candidate: ${value.recommended_id}`);
  const winner = rankConceptEvaluations(value, candidateIds)[0]?.candidate_id;
  if (winner && value.recommended_id !== winner) errors.push(`recommended_id must match the deterministic top score: ${winner}`);
  return result(errors);
}

export function validateCinematicStory(value, context = {}) {
  const errors = schemaErrors(value, CINEMATIC_STORY_SCHEMA, "story");
  if (!isObject(value)) return result(errors);
  if (context.conceptId && value.concept_id !== context.conceptId) errors.push(`concept_id must match selected concept ${context.conceptId}`);
  const expected = context.expectedFormat ?? {};
  if (expected.aspect && value.format?.aspect !== expected.aspect) errors.push(`format.aspect must match ${expected.aspect}`);
  if (expected.width && Number(value.format?.width) !== Number(expected.width)) errors.push(`format.width must match ${expected.width}`);
  if (expected.height && Number(value.format?.height) !== Number(expected.height)) errors.push(`format.height must match ${expected.height}`);
  if (expected.language && String(value.format?.language).toLowerCase() !== String(expected.language).toLowerCase()) errors.push(`format.language must match ${expected.language}`);
  const duration = Number(value.format?.duration_seconds);
  if (context.expectedDuration != null && Math.abs(duration - Number(context.expectedDuration)) > 0.05) errors.push(`format.duration_seconds must match ${context.expectedDuration}`);

  const beats = Array.isArray(value.narration?.beats) ? value.narration.beats : [];
  uniqueField(errors, beats, "id", "story beat ids");
  if (beats[0]?.role !== "hook") errors.push("the first story beat must be the hook");
  if (!beats.some((beat) => beat.role === "proof")) errors.push("story must contain a proof beat");
  if (!beats.some((beat) => beat.role === "payoff")) errors.push("story must contain a payoff beat");
  if (duration >= 20 && !beats.some((beat) => beat.role === "rehook")) errors.push("stories of 20 seconds or longer require a midpoint rehook");
  if (duration >= 20 && !beats.some((beat) => beat.role === "escalation")) errors.push("stories of 20 seconds or longer require escalation");
  if (duration >= 30 && beats.length < 6) errors.push("stories of 30 seconds or longer require at least six narrative beats");
  let cursor = 0;
  for (const [index, beat] of beats.entries()) {
    const start = Number(beat.target_start_seconds);
    const end = Number(beat.target_end_seconds);
    if (index === 0 && Math.abs(start) > 0.001) errors.push("the first story beat must start at 0");
    if (Math.abs(start - cursor) > 0.05) errors.push(`narration.beats[${index}] must butt-join the previous beat at ${cursor}`);
    if (!(end > start)) errors.push(`narration.beats[${index}] must have target_end_seconds > target_start_seconds`);
    checkReferences(errors, `narration.beats[${index}].evidence_ids`, beat.evidence_ids, context.evidenceIds);
    checkReferences(errors, `narration.beats[${index}].resource_ids`, beat.resource_ids, context.resourceIds);
    cursor = end;
  }
  if (Number.isFinite(duration) && Math.abs(cursor - duration) > 0.05) errors.push(`story beats must cover the full target duration ${duration}`);
  const joinedText = beats.map((beat) => beat.spoken_text).join(" ");
  if (normalizeCopy(value.narration?.full_text) !== normalizeCopy(joinedText)) errors.push("narration.full_text must equal the ordered story beat text");
  if (context.suppliedTranscript != null && value.narration?.full_text !== context.suppliedTranscript) errors.push("supplied narration must be preserved exactly");
  const actualWpm = duration > 0 ? wordCount(value.narration?.full_text) * 60 / duration : 0;
  if (context.minimumWpm != null && actualWpm < Number(context.minimumWpm) - 0.01) errors.push(`narration pace must be at least ${context.minimumWpm} WPM`);
  if (context.maximumWpm != null && actualWpm > Number(context.maximumWpm) + 0.01) errors.push(`narration pace must be at most ${context.maximumWpm} WPM`);
  if (actualWpm > 0 && Math.abs(Number(value.narration?.target_wpm) - actualWpm) > 1) errors.push(`narration.target_wpm must reflect the script pace ${Math.round(actualWpm)}`);
  if (context.requestedCta && !normalizeCopy(value.narration?.full_text).includes(normalizeCopy(context.requestedCta))) errors.push(`requested CTA must appear verbatim in narration: ${context.requestedCta}`);
  const beatIds = new Set(beats.map((beat) => beat.id));
  if (!beatIds.has(value.open_loop?.resolved_by_beat_id)) errors.push("open_loop.resolved_by_beat_id must reference a story beat");
  if (value.open_loop?.midpoint_rehook_beat_id != null) {
    const rehook = beats.find((beat) => beat.id === value.open_loop.midpoint_rehook_beat_id);
    if (!rehook || rehook.role !== "rehook") errors.push("open_loop.midpoint_rehook_beat_id must reference a rehook beat");
  }
  for (const [index, claim] of (value.claims ?? []).entries()) {
    checkReferences(errors, `claims[${index}].evidence_ids`, claim.evidence_ids, context.evidenceIds);
    if (claim.confidence !== "creative" && !claim.evidence_ids?.length) errors.push(`claims[${index}] requires evidence_ids unless confidence is creative`);
    if (claim.confidence !== "creative") checkReferences(errors, `claims[${index}].evidence_ids`, claim.evidence_ids, context.claimEligibleEvidenceIds, "ineligible evidence id");
  }
  return result(errors);
}

export function validateCinematicStoryEdit(value, context = {}) {
  const errors = schemaErrors(value, CINEMATIC_STORY_EDIT_SCHEMA, "story_edit");
  if (isObject(value)) errors.push(...validateCinematicStory(value.story, context).errors);
  if (value?.verdict === "ready" && value.findings?.some((finding) => finding.severity === "major")) errors.push("a ready story edit cannot contain major findings");
  return result(errors);
}

function strictObject(properties) {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

function schemaErrors(value, schema, label) {
  const errors = [];
  const acceptedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
  const actualType = value === null ? "null" : Array.isArray(value) ? "array" : Number.isInteger(value) ? "integer" : typeof value === "number" ? "number" : typeof value;
  const typeMatches = acceptedTypes.includes(actualType) || (actualType === "integer" && acceptedTypes.includes("number"));
  if (!typeMatches) return [`${label} must be ${acceptedTypes.join(" or ")}`];
  if (value == null) return errors;
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${label} must be one of: ${schema.enum.join(", ")}`);
  if (typeof value === "string") {
    if (schema.minLength != null && value.trim().length < schema.minLength) errors.push(`${label} must not be empty`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${label} must match ${schema.pattern}`);
  }
  if (typeof value === "number") {
    if (schema.minimum != null && value < schema.minimum) errors.push(`${label} must be >= ${schema.minimum}`);
    if (schema.exclusiveMinimum != null && value <= schema.exclusiveMinimum) errors.push(`${label} must be > ${schema.exclusiveMinimum}`);
    if (schema.maximum != null && value > schema.maximum) errors.push(`${label} must be <= ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) errors.push(`${label} must contain at least ${schema.minItems} item(s)`);
    if (schema.maxItems != null && value.length > schema.maxItems) errors.push(`${label} must contain at most ${schema.maxItems} item(s)`);
    value.forEach((entry, index) => errors.push(...schemaErrors(entry, schema.items, `${label}[${index}]`)));
  }
  if (isObject(value)) {
    for (const required of schema.required ?? []) if (!Object.hasOwn(value, required)) errors.push(`${label}.${required} is required`);
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

function uniqueField(errors, entries, field, label) {
  const values = entries.map((entry) => entry?.[field]).filter(Boolean);
  if (new Set(values).size !== values.length) errors.push(`${label} must be unique`);
}

function uniqueNormalizedField(errors, entries, getter, label) {
  const values = entries.map((entry) => normalizeCopy(getter(entry))).filter(Boolean);
  if (new Set(values).size !== values.length) errors.push(`${label} must be unique`);
}

function checkReferences(errors, label, values, allowed, reason = "unknown id") {
  if (!allowed) return;
  const ids = allowed instanceof Set ? allowed : new Set(allowed);
  for (const value of values ?? []) if (!ids.has(value)) errors.push(`${label} references ${reason}: ${value}`);
}

function normalizeCopy(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function wordCount(value) {
  return String(value ?? "").trim().split(/\s+/).filter(Boolean).length;
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function result(errors) {
  return { ok: errors.length === 0, errors };
}
