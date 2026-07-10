import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { writePlanArtifacts } from "./creative_planner.js";
import { describeJobOutput, ProductionJobStore, semanticHash } from "./job_store.js";
import { OpenAIResponsesClient } from "./openai_responses.js";
import { PRODUCTION_PATHS, PRODUCTION_PLAN_SCHEMA, PRODUCTION_PLAN_VERSION, normalizeProductionPlanTiming, validateProductionPlan } from "./production_contracts.js";

export const PRODUCTION_OUTLINE_VERSION = "launchclip.production-outline.v1";
const CHAPTER_ID_PATTERN = "^[a-z0-9][a-z0-9-]{0,63}$";

export const PRODUCTION_OUTLINE_SCHEMA = strictObject({
  schema_version: { type: "string", enum: [PRODUCTION_OUTLINE_VERSION] },
  project: PRODUCTION_PLAN_SCHEMA.properties.project,
  format: PRODUCTION_PLAN_SCHEMA.properties.format,
  design: PRODUCTION_PLAN_SCHEMA.properties.design,
  narration: strictObject({
    source: { type: "string", enum: ["generated", "supplied"] },
    target_wpm: { type: "number", minimum: 60, maximum: 260 },
    delivery: { type: "string", minLength: 1 }
  }),
  audio: PRODUCTION_PLAN_SCHEMA.properties.audio,
  rubric: PRODUCTION_PLAN_SCHEMA.properties.rubric,
  chapters: {
    type: "array", minItems: 2, items: strictObject({
      id: { type: "string", pattern: CHAPTER_ID_PATTERN },
      start_seconds: { type: "number", minimum: 0 },
      end_seconds: { type: "number", exclusiveMinimum: 0 },
      purpose: { type: "string", minLength: 1 },
      narrative_turn: { type: "string", minLength: 1 },
      opening_state: { type: "string", minLength: 1 },
      closing_state: { type: "string", minLength: 1 },
      evidence_ids: { type: "array", items: { type: "string" } },
      resource_ids: { type: "array", items: { type: "string" } },
      presenter_strategy: { type: "string", minLength: 1 }
    })
  }
});

const OUTLINE_INSTRUCTIONS = `Create the global outline for a long-form video production. Decide one coherent, subject-specific design and causal narrative, then divide the exact duration into gap-free chapters. Chapters are planning boundaries, not generic templates. Every chapter must name its narrative turn, continuity state, relevant evidence/resources, and presenter strategy. Preserve the requested canvas, duration, language, CTA, and supplied narration policy. Return only the strict outline JSON.`;

const CHAPTER_INSTRUCTIONS = `Expand one frozen long-form chapter into a complete local production plan. Its timeline starts at zero and covers the exact chapter duration. Preserve the supplied global project, design, audio direction, continuity anchors, evidence eligibility, and resource IDs. Design specific shots and internal motion for this chapter; do not use a house style. References guide creativity only and never substantiate claims. Return only the strict production-plan JSON.`;

export async function planLongFormProduction(workspacePath, context, adapters = {}) {
  const workspace = path.resolve(workspacePath);
  const { intake, evidence, suppliedNarration = null, sfxCatalog = [], options = {} } = context;
  const store = adapters.store ?? await ProductionJobStore.open(workspace);
  const client = adapters.client ?? new OpenAIResponsesClient();
  const dependencies = store.get("source-media-analysis") ? ["source-media-analysis"] : [];
  const outlineInput = {
    brief: {
      source_kind: intake.source.kind,
      prompt: intake.brief.prompt,
      audience: intake.brief.audience,
      required_cta: intake.brief.cta,
      requested_duration_seconds: suppliedNarration?.duration_seconds ?? intake.brief.duration_seconds,
      requested_format: intake.brief.aspect,
      language: intake.brief.language
    },
    source: evidence.source,
    evidence_index: compactEvidence(evidence.items),
    resources: intake.resources,
    available_sfx: sfxCatalog,
    narration: suppliedNarration ? { source: "supplied", transcript: suppliedNarration.transcript, words: suppliedNarration.words } : { source: "generated", transcript: null, words: [] },
    policies: intake.policies
  };
  const outline = await runArtifactJob({
    workspace, store, client, id: "creative-outline", kind: "creative-outline", dependencies,
    inputHash: semanticHash({ worker: "long-form-outline.v1", model: intake.model, outlineInput }),
    artifactPath: path.join(workspace, "production", "plans", "outline.json"),
    request: {
      model: intake.model?.id ?? "gpt-5.6", reasoningEffort: options.reasoning ?? intake.model?.reasoning_effort ?? "xhigh",
      reasoningContext: "current_turn", pro: Boolean(options.pro ?? intake.model?.reasoning_mode === "pro"), instructions: OUTLINE_INSTRUCTIONS,
      input: JSON.stringify(outlineInput), schema: PRODUCTION_OUTLINE_SCHEMA, schemaName: "launchclip_production_outline",
      background: options.background !== false, maxOutputTokens: Number(options.outlineMaxOutputTokens ?? 24_000), promptCacheKey: "launchclip:long-form-outline:v1",
      metadata: { job_id: "creative-outline", duration_seconds: outlineInput.brief.requested_duration_seconds }
    },
    validate: (value) => validateOutline(value, intake, evidence, suppliedNarration)
  });

  const chapterTasks = outline.chapters.map((chapter, index) => async () => {
    const chapterId = `creative-chapter:${chapter.id}`;
    const chapterEvidence = evidence.items.filter((entry) => chapter.evidence_ids.includes(entry.id) || entry.role === "reference");
    const chapterResources = intake.resources.filter((entry) => chapter.resource_ids.includes(entry.id));
    const words = (suppliedNarration?.words ?? []).filter((word) => Number(word.end) > chapter.start_seconds && Number(word.start) < chapter.end_seconds);
    const chapterInput = {
      global: { project: outline.project, design: outline.design, audio: outline.audio, narration: outline.narration, rubric: outline.rubric },
      chapter: { ...chapter, duration_seconds: chapter.end_seconds - chapter.start_seconds },
      neighbors: { previous: outline.chapters[index - 1] ?? null, next: outline.chapters[index + 1] ?? null },
      evidence: compactEvidence(chapterEvidence), resources: chapterResources, available_sfx: sfxCatalog,
      required_cta: index === outline.chapters.length - 1 ? intake.brief.cta : null,
      supplied_narration: suppliedNarration ? { full_transcript: suppliedNarration.transcript, chapter_words: words } : null
    };
    const duration = chapter.end_seconds - chapter.start_seconds;
    return runArtifactJob({
      workspace, store, client, id: chapterId, kind: "creative-chapter", dependencies: ["creative-outline"],
      inputHash: semanticHash({ worker: "long-form-chapter.v1", model: intake.model, chapterInput }),
      artifactPath: path.join(workspace, "production", "plans", "chapters", `${chapter.id}.json`),
      request: {
        model: intake.model?.id ?? "gpt-5.6", reasoningEffort: options.reasoning ?? intake.model?.reasoning_effort ?? "xhigh",
        reasoningContext: "current_turn", pro: Boolean(options.pro ?? intake.model?.reasoning_mode === "pro"), instructions: CHAPTER_INSTRUCTIONS,
        input: JSON.stringify(chapterInput), schema: PRODUCTION_PLAN_SCHEMA, schemaName: "launchclip_production_chapter",
        background: options.background !== false, maxOutputTokens: Number(options.chapterMaxOutputTokens ?? 40_000), promptCacheKey: "launchclip:long-form-chapter:v1",
        metadata: { job_id: chapterId, chapter_id: chapter.id, chapter_index: index }
      },
      normalize: normalizeProductionPlanTiming,
      validate: (value) => validateProductionPlan(value, validationContext(
        intake,
        evidence,
        duration,
        suppliedNarration,
        false,
        index === outline.chapters.length - 1 ? intake.brief.cta : null
      ))
    });
  });
  const chapterPlans = await runPool(chapterTasks, Number(options.chapterConcurrency ?? 3));
  const plan = stitchLongFormPlan(outline, chapterPlans, suppliedNarration);
  const finalValidation = validateProductionPlan(plan, validationContext(intake, evidence, outline.format.duration_seconds, suppliedNarration, true));
  if (!finalValidation.ok) throw new Error(`Stitched long-form production plan failed validation: ${finalValidation.errors.join("; ")}`);

  const chapterJobIds = outline.chapters.map((chapter) => `creative-chapter:${chapter.id}`);
  const inputHash = semanticHash({ worker: "long-form-stitch.v1", outline, chapterPlans, suppliedTranscript: suppliedNarration?.transcript ?? null });
  let current = store.get("creative-plan");
  if (current?.status === "succeeded" && current.input_hash === inputHash) {
    const verification = await store.verifyOutputs("creative-plan");
    if (verification.ok) return result(workspace, current, true, plan.shots.length);
    await store.markStaleFrom(["creative-plan"]);
    current = store.get("creative-plan");
  } else if (current && current.input_hash !== inputHash && current.status !== "stale") {
    await store.markStaleFrom(["creative-plan"]);
    current = store.get("creative-plan");
  }
  if (!current) await store.add({ id: "creative-plan", kind: "creative-plan", depends_on: chapterJobIds, input_hash: inputHash });
  else {
    const dependenciesChanged = current.depends_on.length !== chapterJobIds.length || current.depends_on.some((entry, index) => entry !== chapterJobIds[index]);
    if (dependenciesChanged) await store.reconfigure("creative-plan", { depends_on: chapterJobIds, input_hash: inputHash });
    else if (["failed", "stale"].includes(current.status)) await store.retry("creative-plan", { inputHash });
    else if (current.status !== "pending") throw new Error(`Creative plan job is already ${current.status}`);
  }
  await store.markRunning("creative-plan", { provider: "local", response_id: null, status: "stitching" });
  try {
    const paths = await writePlanArtifacts(workspace, plan);
    const outputs = await Promise.all(paths.map((filePath) => describeJobOutput(workspace, filePath)));
    await store.markSucceeded("creative-plan", outputs, aggregateUsage(store, ["creative-outline", ...chapterJobIds]));
    return result(workspace, store.get("creative-plan"), false, plan.shots.length);
  } catch (error) {
    await store.markFailed("creative-plan", error);
    throw error;
  }
}

export function stitchLongFormPlan(outline, chapterPlans, suppliedNarration = null) {
  const shots = [];
  const sections = [];
  const claims = [];
  const seenClaims = new Set();
  outline.chapters.forEach((chapter, index) => {
    const chapterPlan = chapterPlans[index];
    for (const shot of chapterPlan.shots) {
      const start = round(chapter.start_seconds + shot.start_seconds);
      const end = round(chapter.start_seconds + shot.end_seconds);
      shots.push({
        ...shot,
        id: stitchedShotId(chapter.id, shot.id),
        start_seconds: start,
        end_seconds: end,
        voiceover: suppliedNarration?.words?.length ? wordsInInterval(suppliedNarration.words, start, end) : shot.voiceover
      });
    }
    if (suppliedNarration?.words?.length) {
      sections.push({
        id: `${chapter.id}-authoritative`,
        text: wordsInInterval(suppliedNarration.words, chapter.start_seconds, chapter.end_seconds),
        evidence_ids: [...new Set(chapterPlan.narration.sections.flatMap((section) => section.evidence_ids))]
      });
    } else {
      for (const section of chapterPlan.narration.sections) sections.push({ ...section, id: `${chapter.id}-${section.id}` });
    }
    for (const claim of chapterPlan.claims) {
      const key = semanticHash({ text: claim.text, evidence_ids: claim.evidence_ids });
      if (!seenClaims.has(key)) { seenClaims.add(key); claims.push(claim); }
    }
  });
  return normalizeProductionPlanTiming({
    schema_version: PRODUCTION_PLAN_VERSION,
    project: outline.project,
    format: outline.format,
    design: outline.design,
    narration: {
      source: outline.narration.source,
      full_text: suppliedNarration?.transcript ?? chapterPlans.map((entry) => entry.narration.full_text.trim()).filter(Boolean).join(" "),
      target_wpm: outline.narration.target_wpm,
      delivery: outline.narration.delivery,
      sections
    },
    audio: outline.audio,
    claims,
    shots,
    rubric: outline.rubric
  });
}

async function runArtifactJob({ workspace, store, client, id, kind, dependencies, inputHash, artifactPath, request, normalize = (value) => value, validate }) {
  let current = store.get(id);
  if (current?.status === "succeeded" && current.input_hash === inputHash) {
    const verification = await store.verifyOutputs(id);
    if (verification.ok) return JSON.parse(await readFile(artifactPath, "utf8"));
    await store.markStaleFrom([id]);
    current = store.get(id);
  } else if (current && current.input_hash !== inputHash) {
    if (current.status !== "stale") await store.markStaleFrom([id]);
    current = store.get(id);
  }
  if (!current) await store.add({ id, kind, depends_on: dependencies, input_hash: inputHash });
  else {
    const dependenciesChanged = current.depends_on.length !== dependencies.length || current.depends_on.some((entry, index) => entry !== dependencies[index]);
    if (dependenciesChanged) await store.reconfigure(id, { depends_on: dependencies, input_hash: inputHash });
    else if (["failed", "stale"].includes(current.status)) await store.retry(id, { inputHash });
  }
  current = store.get(id);
  let resumeResponseId = null;
  if (["running", "submitted"].includes(current.status)) {
    if (!current.remote?.response_id) throw new Error(`${id} is ${current.status} without a resumable response id`);
    resumeResponseId = current.remote.response_id;
  } else if (current.status === "pending") await store.markRunning(id, { provider: "openai", response_id: null, status: "running" });
  else throw new Error(`${id} is already ${current.status}`);
  try {
    const submitted = { ...request, onSubmitted: async (response) => store.markRunning(id, { provider: "openai", response_id: response.id, status: response.status }) };
    const response = resumeResponseId ? await client.resumeStructured(resumeResponseId, submitted) : await client.runStructured(submitted);
    const value = normalize(response.value);
    const validation = validate(value);
    if (validation !== true && validation?.ok !== true) throw new Error(`${id} failed validation: ${(validation?.errors ?? ["invalid structured output"]).join("; ")}`);
    await writeAtomic(artifactPath, `${JSON.stringify(value, null, 2)}\n`);
    await store.markRunning(id, { provider: "openai", response_id: response.response_id, status: response.status });
    const output = await describeJobOutput(workspace, artifactPath);
    await store.markSucceeded(id, [output], response.usage);
    return value;
  } catch (error) {
    if (["running", "submitted"].includes(store.get(id)?.status)) await store.markFailed(id, error);
    throw error;
  }
}

function validateOutline(outline, intake, evidence, suppliedNarration) {
  const errors = [];
  if (outline?.schema_version !== PRODUCTION_OUTLINE_VERSION) errors.push(`schema_version must be ${PRODUCTION_OUTLINE_VERSION}`);
  const expectedDuration = suppliedNarration?.duration_seconds ?? intake.brief.duration_seconds;
  if (outline?.format?.aspect !== intake.brief.aspect.id || outline?.format?.width !== intake.brief.aspect.width || outline?.format?.height !== intake.brief.aspect.height) errors.push("outline format must match the requested canvas");
  if (Math.abs(Number(outline?.format?.duration_seconds) - Number(expectedDuration)) > .01) errors.push("outline duration must match the requested duration");
  if (outline?.format?.language !== intake.brief.language) errors.push("outline language must match the request");
  if (outline?.narration?.source !== (suppliedNarration ? "supplied" : "generated")) errors.push("outline narration source must match the intake");
  const evidenceIds = new Set(evidence.items.map((entry) => entry.id));
  const resourceIds = new Set(intake.resources.map((entry) => entry.id));
  let cursor = 0;
  const ids = new Set();
  for (const [index, chapter] of (outline?.chapters ?? []).entries()) {
    if (!new RegExp(CHAPTER_ID_PATTERN).test(chapter.id) || ids.has(chapter.id)) errors.push(`chapters[${index}] has an invalid or duplicate id`);
    ids.add(chapter.id);
    if (Math.abs(Number(chapter.start_seconds) - cursor) > .01 || !(chapter.end_seconds > chapter.start_seconds)) errors.push(`chapters[${index}] must be gap-free and positive`);
    cursor = Number(chapter.end_seconds);
    for (const id of chapter.evidence_ids ?? []) if (!evidenceIds.has(id)) errors.push(`chapters[${index}] references unknown evidence: ${id}`);
    for (const id of chapter.resource_ids ?? []) if (!resourceIds.has(id)) errors.push(`chapters[${index}] references unknown resource: ${id}`);
  }
  if ((outline?.chapters ?? []).length < 2) errors.push("outline requires at least two chapters");
  if (Math.abs(cursor - Number(expectedDuration)) > .01) errors.push("chapters must cover the complete duration");
  return { ok: errors.length === 0, errors };
}

function validationContext(intake, evidence, duration, suppliedNarration, requireTranscript, requestedCta = requireTranscript ? intake.brief.cta : null) {
  return {
    evidenceIds: evidence.items.map((entry) => entry.id),
    claimEligibleEvidenceIds: evidence.items.filter((entry) => entry.claims_allowed && entry.role !== "reference").map((entry) => entry.id),
    resourceIds: intake.resources.map((entry) => entry.id),
    resourceRoles: Object.fromEntries(intake.resources.map((entry) => [entry.id, entry.role])),
    expectedDuration: duration,
    expectedFormat: { aspect: intake.brief.aspect.id, width: intake.brief.aspect.width, height: intake.brief.aspect.height, language: intake.brief.language },
    requestedCta,
    suppliedTranscript: requireTranscript ? suppliedNarration?.transcript ?? null : null
  };
}

function result(workspace, job, cached, shots) {
  return { stage: "creative-plan", status: "ready", workspace, plan: path.join(workspace, PRODUCTION_PATHS.plan), script: path.join(workspace, PRODUCTION_PATHS.script), storyboard: path.join(workspace, PRODUCTION_PATHS.storyboard), shots, response_id: job.remote?.response_id ?? null, usage: job.usage, cached, planning_mode: "hierarchical" };
}

function aggregateUsage(store, ids) {
  return ids.reduce((usage, id) => {
    for (const [key, value] of Object.entries(store.get(id)?.usage ?? {})) if (Number.isFinite(Number(value))) usage[key] = Number(usage[key] ?? 0) + Number(value);
    return usage;
  }, {});
}

function compactEvidence(items) { return items.map((entry) => ({ id: entry.id, role: entry.role, title: entry.title, content: String(entry.content ?? "").slice(0, 30_000), provenance: entry.provenance, claims_allowed: entry.claims_allowed })); }
function strictObject(properties) { return { type: "object", properties, required: Object.keys(properties), additionalProperties: false }; }
function round(value) { return Math.round(Number(value) * 1000) / 1000; }
function wordsInInterval(words, start, end) {
  return words
    .filter((word) => {
      const midpoint = (Number(word.start) + Number(word.end)) / 2;
      return Number.isFinite(midpoint) && midpoint >= Number(start) && midpoint < Number(end);
    })
    .map((word) => String(word.word ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

function stitchedShotId(chapterId, shotId) {
  const candidate = `${chapterId}-${shotId}`;
  if (new RegExp(CHAPTER_ID_PATTERN).test(candidate)) return candidate;
  const suffix = semanticHash({ chapterId, shotId }).slice(0, 10);
  const maxPrefix = 63 - suffix.length;
  const prefix = candidate
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, maxPrefix)
    .replace(/-+$/, "") || "shot";
  return `${prefix}-${suffix}`;
}

async function runPool(tasks, concurrency) {
  const output = new Array(tasks.length);
  let cursor = 0;
  let firstError = null;
  const count = Math.max(1, Math.min(tasks.length || 1, Math.floor(concurrency) || 1));
  await Promise.all(Array.from({ length: count }, async () => {
    while (cursor < tasks.length && !firstError) {
      const index = cursor++;
      try {
        output[index] = await tasks[index]();
      } catch (error) {
        firstError ??= error;
      }
    }
  }));
  if (firstError) throw firstError;
  return output;
}

async function writeAtomic(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { mode: 0o600 });
  await rename(temporary, filePath);
}
