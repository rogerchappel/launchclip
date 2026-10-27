// Minimal schemas for the two creative receipts a subscription-authored
// cinematic project keeps beside its storyboard, checked by
// `launchclip cinematic-check`:
//
//   CONCEPTS.json  launchclip.concepts.v1       the five-concept tournament
//   STORY.json     launchclip.story-receipt.v1  the edited retention story
//
// A missing required field is an error (the readiness gate fails); anything
// else the funnel in references/cinematic-production.md asks for is a
// warning. See that reference for annotated examples.

export const CONCEPTS_SCHEMA = "launchclip.concepts.v1";
export const STORY_RECEIPT_SCHEMA = "launchclip.story-receipt.v1";
export const CONCEPT_COUNT = 5;

// The tournament criteria (0-10 each) and their weights.
// Weights sum to 100. angle_freshness (how far the angle is from the crowded
// version, ANGLE.json) and share_strength (whether the share line gives a
// viewer a reason to send it) came with the skeleton library.
export const CONCEPT_CRITERIA = Object.freeze({
  scroll_stop: 14, promise_clarity: 7, audience_fit: 6, causality: 8, grounded_proof: 10,
  visual_originality: 14, motion_potential: 8, sound_potential: 4, feasibility: 7,
  angle_freshness: 12, share_strength: 10
});
export const CONCEPT_PENALTIES = Object.freeze({ genericism: 0.8, slideshow_risk: 1.0, unsupported_clickbait: 1.5 });

// share: the line a viewer would send or comment on (the short-video rules, kit/core/skeleton-library.mjs).
export const STORY_ROLES = Object.freeze(["hook", "promise", "mechanism", "proof", "rehook", "escalation", "payoff", "share", "closing_reframe", "cta_or_loop"]);
// The retention edit's score floors.
export const STORY_SCORE_FLOORS = Object.freeze({ hook: 8, compression: 7, curiosity: 8, clarity: 8, proof: 8, payoff: 8, speakability: 7, visuality: 8 });
export const NARRATION_SOURCES = Object.freeze(["synthesised", "supplied", "generated", "none"]);

/** The weighted total for one concept's scores and penalties (as the funnel defines it). */
export function conceptTotal(scores = {}, penalties = {}) {
  let total = 0;
  for (const [criterion, weight] of Object.entries(CONCEPT_CRITERIA)) total += (Number(scores[criterion]) || 0) * weight / 10;
  for (const [penalty, factor] of Object.entries(CONCEPT_PENALTIES)) total -= (Number(penalties[penalty]) || 0) * factor;
  return Math.round(total * 10) / 10;
}

/**
 * CONCEPTS.json → {ok, errors, warnings, chosen_id}
 * Required: concepts (exactly 5), each with id, title, logline, hook and
 * scores (an object of numbers); exactly one concept with chosen: true.
 */
export function validateConceptsReceipt(value) {
  const errors = [];
  const warnings = [];
  if (!isObject(value)) return result(["CONCEPTS.json must be a JSON object (launchclip.concepts.v1)"], warnings, null);
  if (value.schema_version !== CONCEPTS_SCHEMA) warnings.push(`schema_version should be "${CONCEPTS_SCHEMA}"${value.schema_version ? `; got "${value.schema_version}"` : ""}`);
  let concepts = value.concepts;
  if (!Array.isArray(concepts) && Array.isArray(value.candidates)) {
    concepts = value.candidates;
    warnings.push("rename candidates to concepts (launchclip.concepts.v1)");
  }
  if (!Array.isArray(concepts)) return result([...errors, "concepts is required: an array of the 5 tournament concepts"], warnings, null);
  if (concepts.length !== CONCEPT_COUNT) errors.push(`concepts must hold exactly ${CONCEPT_COUNT} concepts; got ${concepts.length}`);
  const ids = new Set();
  for (const [index, concept] of concepts.entries()) {
    const where = `concepts[${index}]${isObject(concept) && concept.id ? ` (${concept.id})` : ""}`;
    if (!isObject(concept)) { errors.push(`${where} must be an object`); continue; }
    for (const field of ["id", "title", "logline", "hook"]) if (!nonEmpty(concept[field])) errors.push(`${where}.${field} is required (a non-empty string)`);
    if (nonEmpty(concept.id)) {
      if (ids.has(concept.id)) errors.push(`${where}.id is a duplicate`);
      ids.add(concept.id);
    }
    if (!isObject(concept.scores)) errors.push(`${where}.scores is required: {${Object.keys(CONCEPT_CRITERIA).join(", ")}} scored 0-10`);
    else {
      const missing = Object.keys(CONCEPT_CRITERIA).filter((criterion) => concept.scores[criterion] === undefined);
      if (missing.length) warnings.push(`${where}.scores is missing ${missing.join(", ")}`);
      for (const [criterion, score] of Object.entries(concept.scores)) {
        if (!(typeof score === "number" && score >= 0 && score <= 10)) errors.push(`${where}.scores.${criterion} must be a number from 0 to 10; got ${JSON.stringify(score)}`);
      }
    }
    if (concept.penalties === undefined) warnings.push(`${where}.penalties is missing ({genericism, slideshow_risk, unsupported_clickbait})`);
    if (concept.total === undefined) warnings.push(`${where}.total is missing (the weighted score minus penalties)`);
    if (typeof concept.chosen !== "boolean") warnings.push(`${where}.chosen should be true or false`);
    if (nonEmpty(concept.hook) && wordCount(concept.hook) > 18) warnings.push(`${where}.hook is ${wordCount(concept.hook)} words; keep the spoken hook to 18 or fewer`);
  }
  const chosen = concepts.filter((concept) => isObject(concept) && concept.chosen === true);
  if (chosen.length !== 1) errors.push(`exactly one concept must have chosen: true; got ${chosen.length}`);
  const chosenId = chosen.length === 1 ? chosen[0].id ?? null : null;
  if (value.selected_id !== undefined && chosenId && value.selected_id !== chosenId) errors.push(`selected_id "${value.selected_id}" does not match the chosen concept "${chosenId}"`);
  // The funnel selects the highest total deterministically.
  const scored = concepts.filter((concept) => isObject(concept) && isObject(concept.scores));
  if (chosenId && scored.length === concepts.length) {
    const totals = scored.map((concept) => ({ id: concept.id, total: Number.isFinite(Number(concept.total)) ? Number(concept.total) : conceptTotal(concept.scores, concept.penalties) }));
    const best = totals.reduce((top, entry) => (entry.total > top.total ? entry : top), totals[0]);
    if (best && best.id !== chosenId) warnings.push(`the chosen concept "${chosenId}" is not the highest total ("${best.id}" scores ${best.total}); select by score, not taste`);
  }
  if (!nonEmpty(value.judging)) warnings.push("judging is missing: say how the fresh-context judge saw the concepts");
  if (value.required_improvements === undefined) warnings.push("required_improvements is missing (the judge's fixes for the chosen concept)");
  return result(errors, warnings, chosenId);
}

/**
 * STORY.json → {ok, errors, warnings}
 * Required: concept_id (the chosen concept), beats (each with a role and the
 * spoken line), narration.source. context: {conceptsChosenId, duration}
 */
export function validateStoryReceipt(value, { conceptsChosenId = null, duration = null } = {}) {
  const errors = [];
  const warnings = [];
  if (!isObject(value)) return result(["STORY.json must be a JSON object (launchclip.story-receipt.v1)"], warnings);
  if (value.schema_version !== STORY_RECEIPT_SCHEMA) warnings.push(`schema_version should be "${STORY_RECEIPT_SCHEMA}"${value.schema_version ? `; got "${value.schema_version}"` : ""}`);
  if (!nonEmpty(value.concept_id)) errors.push("concept_id is required: the id of the chosen concept in CONCEPTS.json");
  else if (conceptsChosenId && value.concept_id !== conceptsChosenId) errors.push(`concept_id "${value.concept_id}" is not the chosen concept in CONCEPTS.json ("${conceptsChosenId}")`);
  if (!Array.isArray(value.beats) || !value.beats.length) errors.push("beats is required: the story's beats in order, each {role, spoken, visual_noun}");
  else {
    for (const [index, beat] of value.beats.entries()) {
      const where = `beats[${index}]`;
      if (!isObject(beat)) { errors.push(`${where} must be an object`); continue; }
      if (!nonEmpty(beat.role)) errors.push(`${where}.role is required (${STORY_ROLES.join(", ")})`);
      else if (!STORY_ROLES.includes(beat.role)) warnings.push(`${where}.role "${beat.role}" is not one of ${STORY_ROLES.join(", ")}`);
      if (typeof beat.spoken !== "string") errors.push(`${where}.spoken is required: the exact spoken line ("" for a silent beat)`);
      if (!nonEmpty(beat.visual_noun)) warnings.push(`${where}.visual_noun is missing: name the concrete thing on screen`);
    }
    const roles = value.beats.filter(isObject).map((beat) => beat.role);
    if (roles[0] !== "hook") warnings.push(`the first beat should be the hook; got ${roles[0] ?? "none"}`);
    const seconds = Number(duration);
    if (seconds >= 20 && !(roles.includes("rehook") && roles.includes("escalation"))) warnings.push(`a ${seconds} s video needs a rehook and an escalation beat`);
    if (seconds >= 30 && value.beats.length < 6) warnings.push(`a ${seconds} s video needs six or more narrative beats; got ${value.beats.length}`);
  }
  if (!isObject(value.narration) || !nonEmpty(value.narration.source)) errors.push(`narration.source is required (${NARRATION_SOURCES.join(" | ")}), e.g. {"source": "synthesised", "file": "NARRATION.json"}`);
  else if (!NARRATION_SOURCES.includes(value.narration.source)) warnings.push(`narration.source "${value.narration.source}" is not one of ${NARRATION_SOURCES.join(", ")}`);
  if (!isObject(value.scores)) warnings.push(`scores is missing: the retention edit's {${Object.keys(STORY_SCORE_FLOORS).join(", ")}}`);
  else {
    for (const [name, floor] of Object.entries(STORY_SCORE_FLOORS)) {
      const score = value.scores[name];
      if (score === undefined) warnings.push(`scores.${name} is missing (floor ${floor})`);
      else if (!(Number(score) >= floor)) warnings.push(`scores.${name} is ${score}, below the floor of ${floor}: keep revising the story`);
    }
  }
  if (!nonEmpty(value.editor)) warnings.push("editor is missing: record who ran the fresh-context retention edit");
  return result(errors, warnings);
}

function result(errors, warnings, chosenId) {
  return { ok: errors.length === 0, errors, warnings, ...(chosenId !== undefined ? { chosen_id: chosenId } : {}) };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function wordCount(text) {
  return String(text ?? "").trim().split(/\s+/).filter(Boolean).length;
}
