import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildShotTransitions } from "./hyperframes_assembler.js";
import { createStructuredClient, parseModelRoute } from "./model_provider.js";
import { PRODUCTION_PATHS } from "./production_contracts.js";

export const FRAME_CANDIDATE_JUDGMENT_VERSION = "launchclip.frame-candidate-judgment.v1";
export const FRAME_CANDIDATE_SELECTION_VERSION = "launchclip.frame-candidate-selection.v1";

const SCORE_FIELDS = [
  "scroll_stop",
  "promise_or_proof_clarity",
  "composition",
  "art_direction_specificity",
  "depth_and_materiality",
  "mobile_readability",
  "temporal_development",
  "continuity_readiness"
];

const score = { type: "number", minimum: 0, maximum: 10 };
const string = { type: "string", minLength: 1 };
const strictObject = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

export const FRAME_CANDIDATE_JUDGMENT_SCHEMA = strictObject({
  schema_version: { type: "string", enum: [FRAME_CANDIDATE_JUDGMENT_VERSION] },
  recommended_id: string,
  scores: {
    type: "array",
    minItems: 2,
    maxItems: 4,
    items: strictObject({
      candidate_id: string,
      scroll_stop: score,
      promise_or_proof_clarity: score,
      composition: score,
      art_direction_specificity: score,
      depth_and_materiality: score,
      mobile_readability: score,
      temporal_development: score,
      continuity_readiness: score,
      rationale: string
    })
  },
  selection_rationale: string,
  preserve: { type: "array", items: string }
});

const JUDGE_INSTRUCTIONS = `You are a fresh-context senior film editor and art director choosing between independently authored render candidates for one LaunchClip shot.

Judge the supplied rendered pixels, not the prompts, HTML, or model reputation. The images are ordered and mapped to candidate IDs in the input. Review each candidate across its entire sampled lifecycle at the delivery aspect ratio.

Score every candidate from 0-10 for scroll stop, promise/proof clarity, composition, art-direction specificity, depth/materiality, mobile readability, temporal development, and readiness to continue the declared shared visual world. Penalize slideshow-like text cards, generic SaaS gradients, decorative motion without narrative function, weak first-frame hierarchy, flat depth, illegible mobile copy, long static holds, abrupt state resets, and endings that cannot settle cleanly into the next shot.

Recommend exactly one supplied candidate ID. Use the scorecard honestly; do not reward complexity by itself. Return only the strict JSON.`;

export function selectCinematicCandidateShots(plan, story = null, options = {}) {
  const shots = Array.isArray(plan?.shots) ? plan.shots : [];
  if (!shots.length) return [];
  const maximum = Math.max(1, Math.min(shots.length, positiveInteger(options.maxShots ?? 2, "maxShots")));
  const transitions = buildShotTransitions(plan);
  const storyRoles = rolesByShot(shots, story?.narration?.beats ?? []);
  const selected = [{
    shot_id: shots[0].id,
    kind: "hook",
    reasons: unique(["opening-hook", ...roleReasons(storyRoles.get(shots[0].id))]),
    story_roles: [...(storyRoles.get(shots[0].id) ?? [])],
    transition: null
  }];
  if (maximum === 1) return selected;

  const transitionByIncoming = new Map(transitions.map((entry) => [entry.to_shot_id, entry]));
  const ranked = shots.slice(1).map((shot, index) => {
    const roles = [...(storyRoles.get(shot.id) ?? [])];
    const transition = transitionByIncoming.get(shot.id) ?? null;
    const roleScore = Math.max(0, ...roles.map((role) => ({ payoff: 110, proof: 100, rehook: 90, escalation: 80, mechanism: 65, promise: 55, closing_reframe: 50 }[role] ?? 0)));
    const transitionScore = ({ "shared-world": 105, morph: 95, zoom: 92, aperture: 88, whip: 84, push: 30, cut: 0 })[transition?.kind] ?? 0;
    const finalScore = shot.id === shots.at(-1)?.id ? 60 : 0;
    return {
      shot,
      index: index + 1,
      roles,
      transition,
      score: Math.max(roleScore, transitionScore, finalScore) + Math.min(roleScore, transitionScore) * .15
    };
  }).sort((left, right) => right.score - left.score || left.index - right.index);

  for (const entry of ranked.slice(0, maximum - 1)) {
    const reasons = [
      ...roleReasons(entry.roles),
      ...(isHighRiskTransition(entry.transition) ? [`high-risk-${entry.transition.kind}-entry`] : []),
      ...(entry.shot.id === shots.at(-1)?.id ? ["closing-payoff-frame"] : [])
    ];
    selected.push({
      shot_id: entry.shot.id,
      kind: entry.roles.includes("payoff") ? "payoff" : entry.roles.includes("proof") ? "proof" : isHighRiskTransition(entry.transition) ? "continuity" : "closing",
      reasons: unique(reasons.length ? reasons : ["highest-value-non-hook-shot"]),
      story_roles: entry.roles,
      transition: entry.transition ? {
        from_shot_id: entry.transition.from_shot_id,
        to_shot_id: entry.transition.to_shot_id,
        kind: entry.transition.kind,
        duration_seconds: entry.transition.duration_seconds
      } : null
    });
  }
  return selected;
}

export async function judgeRenderedFrameCandidates(workspacePath, context, options = {}, adapters = {}) {
  const workspace = path.resolve(workspacePath);
  const shot = context?.shot;
  const candidates = (context?.candidates ?? []).filter((entry) => entry?.verification?.ok === true);
  if (!shot?.id) throw new Error("Rendered candidate judgment requires a shot");
  if (!candidates.length) throw new Error(`Rendered candidate judgment requires at least one admissible candidate for ${shot.id}`);
  ensureUniqueCandidateIds(candidates);
  const receiptPath = selectionReceiptPath(workspace, shot.id);

  if (candidates.length === 1) {
    const receipt = buildReceipt({
      workspace,
      shot,
      trigger: context.trigger,
      candidates,
      method: "sole-admissible",
      selectedId: candidates[0].id,
      judge: null
    });
    await writeAtomicJson(receiptPath, receipt);
    return { winner: candidates[0], receipt: receiptPath, usage: {}, calls: 0, method: receipt.method };
  }

  const visualEvidence = await loadCandidateEvidence(workspace, candidates, Number(options.framesPerCandidate ?? 6));
  const route = parseModelRoute(options.route ?? options.candidateJudgeRoute, {
    provider: "openai",
    model: options.model ?? "gpt-5.6",
    reasoning: options.reasoning ?? "high",
    supportsImages: true
  });
  if (route.supportsImages === false) throw new Error(`Rendered candidate judge route does not support images: ${route.provider}:${route.model}`);
  const client = adapters.client ?? (adapters.createClient ?? createStructuredClient)(route);
  const request = {
    model: route.model,
    reasoningEffort: route.reasoning,
    reasoningContext: "current_turn",
    pro: Boolean(options.pro),
    instructions: JUDGE_INSTRUCTIONS,
    input: JSON.stringify({
      shot: {
        id: shot.id,
        purpose: shot.purpose,
        voiceover: shot.voiceover,
        on_screen_text: shot.on_screen_text,
        visual: shot.visual,
        duration_seconds: Number(shot.end_seconds) - Number(shot.start_seconds)
      },
      selection_trigger: context.trigger ?? null,
      candidate_order: candidates.map((entry) => entry.id),
      rendered_evidence: visualEvidence.manifest,
      rule: "Every score must refer to exactly one supplied candidate ID. Recommend one candidate only."
    }),
    images: visualEvidence.images,
    schema: FRAME_CANDIDATE_JUDGMENT_SCHEMA,
    schemaName: "launchclip_frame_candidate_judgment",
    background: options.background !== false,
    maxOutputTokens: Number(options.maxOutputTokens ?? 5_000),
    promptCacheKey: "launchclip:frame-candidate-judge:v1",
    metadata: { job_id: `frame-candidate-selection:${shot.id}`, shot_id: shot.id, candidates: candidates.length }
  };
  const result = await client.runStructured(request);
  const judgment = validateJudgment(result.value, candidates.map((entry) => entry.id));
  const selectedId = deterministicWinner(judgment.scores, candidates.map((entry) => entry.id));
  const winner = candidates.find((entry) => entry.id === selectedId);
  const receipt = buildReceipt({
    workspace,
    shot,
    trigger: context.trigger,
    candidates,
    method: "fresh-vision-scorecard",
    selectedId,
    judge: {
      response_id: result.response_id ?? null,
      provider: route.provider,
      model: result.model ?? route.model,
      usage: result.usage ?? {},
      recommended_id: judgment.recommended_id,
      scores: judgment.scores,
      selection_rationale: judgment.selection_rationale,
      preserve: judgment.preserve,
      deterministic_tie_break: "highest mean score, then candidate order"
    }
  });
  await writeAtomicJson(receiptPath, receipt);
  return {
    winner,
    receipt: receiptPath,
    usage: result.usage ?? {},
    calls: 1,
    response_id: result.response_id ?? null,
    provider: route.provider,
    model: result.model ?? route.model,
    method: receipt.method
  };
}

function rolesByShot(shots, beats) {
  const result = new Map(shots.map((shot) => [shot.id, new Set()]));
  for (const beat of Array.isArray(beats) ? beats : []) {
    const start = Number(beat?.target_start_seconds);
    const end = Number(beat?.target_end_seconds);
    if (!(end > start)) continue;
    const ranked = shots.map((shot, index) => ({
      shot,
      index,
      overlap: Math.max(0, Math.min(end, Number(shot.end_seconds)) - Math.max(start, Number(shot.start_seconds)))
    })).sort((left, right) => right.overlap - left.overlap || left.index - right.index);
    if (ranked[0]?.overlap > 0) result.get(ranked[0].shot.id)?.add(String(beat.role));
  }
  return new Map([...result].map(([id, roles]) => [id, [...roles]]));
}

function roleReasons(roles = []) {
  return roles.filter((role) => ["hook", "proof", "rehook", "escalation", "payoff", "closing_reframe"].includes(role)).map((role) => `story-${role}`);
}

function isHighRiskTransition(transition) {
  return new Set(["shared-world", "morph", "zoom", "aperture", "whip"]).has(transition?.kind);
}

async function loadCandidateEvidence(workspace, candidates, framesPerCandidate) {
  const manifest = [];
  const images = [];
  for (const candidate of candidates) {
    const frames = evenlySelect(candidate.verification.frames ?? [], Math.max(1, Math.min(8, framesPerCandidate)));
    if (!frames.length) throw new Error(`Candidate ${candidate.id} has no rendered frames`);
    const evidence = [];
    for (const [index, frame] of frames.entries()) {
      const filePath = containedPath(workspace, frame.file);
      const info = await stat(filePath);
      if (!info.isFile() || info.size <= 0) throw new Error(`Candidate ${candidate.id} rendered frame is empty: ${frame.file}`);
      const imageIndex = images.length;
      images.push(await dataImage(filePath, "high"));
      evidence.push({
        image_index: imageIndex,
        phase: lifecyclePhase(index, frames.length),
        file: path.relative(workspace, filePath).split(path.sep).join("/"),
        foreground_ratio: frame.foreground_ratio ?? null,
        edge_ratio: frame.edge_ratio ?? null,
        luma_standard_deviation: frame.luma_standard_deviation ?? null
      });
    }
    manifest.push({ candidate_id: candidate.id, verification_report: relativeOrNull(workspace, candidate.verification.report), frames: evidence });
  }
  return { manifest, images };
}

function validateJudgment(value, candidateIds) {
  if (value?.schema_version !== FRAME_CANDIDATE_JUDGMENT_VERSION) throw new Error("Rendered candidate judge returned the wrong schema version");
  const scores = Array.isArray(value?.scores) ? value.scores : [];
  const received = scores.map((entry) => entry?.candidate_id);
  if (scores.length !== candidateIds.length || new Set(received).size !== received.length || candidateIds.some((id) => !received.includes(id))) {
    throw new Error(`Rendered candidate judge must score exactly: ${candidateIds.join(", ")}`);
  }
  if (!candidateIds.includes(value.recommended_id)) throw new Error(`Rendered candidate judge recommended an unknown candidate: ${value.recommended_id}`);
  for (const entry of scores) {
    for (const field of SCORE_FIELDS) {
      const number = Number(entry?.[field]);
      if (!Number.isFinite(number) || number < 0 || number > 10) throw new Error(`Rendered candidate judge returned an invalid ${field} score for ${entry?.candidate_id}`);
    }
  }
  return value;
}

function deterministicWinner(scores, candidateOrder) {
  const order = new Map(candidateOrder.map((id, index) => [id, index]));
  return [...scores].sort((left, right) => {
    const leftMean = SCORE_FIELDS.reduce((sum, field) => sum + Number(left[field]), 0) / SCORE_FIELDS.length;
    const rightMean = SCORE_FIELDS.reduce((sum, field) => sum + Number(right[field]), 0) / SCORE_FIELDS.length;
    return rightMean - leftMean || order.get(left.candidate_id) - order.get(right.candidate_id);
  })[0].candidate_id;
}

function buildReceipt({ workspace, shot, trigger, candidates, method, selectedId, judge }) {
  return {
    schema_version: FRAME_CANDIDATE_SELECTION_VERSION,
    judgment_schema_version: FRAME_CANDIDATE_JUDGMENT_VERSION,
    shot_id: shot.id,
    trigger: trigger ?? null,
    status: "selected",
    method,
    candidate_order: candidates.map((entry) => entry.id),
    candidates: candidates.map((entry) => ({
      id: entry.id,
      response_id: entry.response_id ?? null,
      provider: entry.provider ?? null,
      model: entry.model ?? null,
      verification: {
        report: relativeOrNull(workspace, entry.verification.report),
        snapshots: relativeOrNull(workspace, entry.verification.snapshots),
        frame_count: entry.verification.frames?.length ?? 0
      }
    })),
    judge,
    selected_candidate_id: selectedId
  };
}

function ensureUniqueCandidateIds(candidates) {
  const ids = candidates.map((entry) => String(entry.id ?? ""));
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) throw new Error("Rendered candidates require unique non-empty IDs");
}

function selectionReceiptPath(workspace, shotId) {
  const safe = String(shotId).replace(/[^a-zA-Z0-9._-]/g, "-");
  return path.join(workspace, PRODUCTION_PATHS.qa, "candidate-selection", safe, "selection.json");
}

function containedPath(workspace, file) {
  const resolved = path.resolve(workspace, String(file ?? ""));
  const relative = path.relative(workspace, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Rendered candidate frame escapes the workspace: ${file}`);
  return resolved;
}

async function dataImage(filePath, detail) {
  const extension = path.extname(filePath).toLowerCase();
  const mime = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
  return { url: `data:${mime};base64,${(await readFile(filePath)).toString("base64")}`, detail };
}

function evenlySelect(values, count) {
  if (values.length <= count) return [...values];
  if (count === 1) return [values[0]];
  return Array.from({ length: count }, (_, index) => values[Math.round(index * (values.length - 1) / (count - 1))]);
}

function lifecyclePhase(index, length) {
  if (index === 0) return "opening";
  if (index === length - 1) return "settle";
  if (index < length / 2) return "development";
  return "resolution";
}

function relativeOrNull(workspace, file) {
  if (!file) return null;
  const resolved = path.isAbsolute(file) ? path.resolve(file) : path.resolve(workspace, file);
  const relative = path.relative(workspace, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Candidate artifact escapes the workspace: ${file}`);
  return relative.split(path.sep).join("/");
}

function unique(values) { return [...new Set(values)]; }

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

async function writeAtomicJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, filePath);
}
