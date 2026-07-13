import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { OpenAIResponsesClient } from "./openai_responses.js";
import { CRITIQUE_SCHEMA, PRODUCTION_PATHS, validateCritique } from "./production_contracts.js";

const CRITIC_INSTRUCTIONS = `You are the independent final editor and motion-design critic. Decide whether this rendered production should ship, receive targeted repairs, or be replanned.

Judge the supplied snapshots and measurements against the actual production plan and its rubric. Inspect narrative clarity, factual grounding, visual hierarchy, typography, composition, asset use, presenter placement, shot-to-shot continuity, motion intent, pacing, and audio strategy.

Rules:
- Technical validity is not creative quality. A clean DOM can still be dull, generic, illegible, or narratively weak.
- Do not demand a fixed house style. Judge whether this video's chosen art direction is coherent, original, and appropriate to its subject.
- Use motion metrics as temporal evidence. Do not treat raw RGB or pixel similarity to unrelated references as a quality target.
- temporal_motion_analysis.frame_count is the encoded video frame count. temporal_motion_analysis.motion.frame_count is the number of adjacent-frame difference samples and is normally one lower; do not confuse the two.
- When production_expectations.audio is intentionally-silent, do not request voiceover, music, sound effects, or an audio stream. Judge only the requested silent evaluation render.
- A finding must name observable evidence, affected shot IDs, the smallest repair scope, a concrete instruction, and what must be preserved.
- Use replan only when repairing frames cannot solve the narrative or timing problem.
- Ship only when there are no blocking or major findings.

Return only the strict production-critique JSON.`;

export async function critiqueProduction(workspacePath, options = {}, adapters = {}) {
  const workspace = path.resolve(workspacePath);
  const qaDir = path.join(workspace, PRODUCTION_PATHS.qa);
  const [plan, evidence, verification, motion, audio, lint, validate, inspect, visualFingerprint] = await Promise.all([
    readJson(path.join(workspace, PRODUCTION_PATHS.plan)),
    readJson(path.join(workspace, PRODUCTION_PATHS.evidence)),
    readJson(path.join(qaDir, "verification.json")),
    readOptionalJson(path.join(qaDir, "motion.json")),
    readOptionalJson(path.join(qaDir, "audio.json")),
    readOptionalJson(path.join(qaDir, "lint.json")),
    readOptionalJson(path.join(qaDir, "validate.json")),
    readOptionalJson(path.join(qaDir, "inspect.json")),
    readOptionalJson(path.join(workspace, "production", "plans", "visual-fingerprint.json"))
  ]);
  const snapshots = await snapshotPaths(verification.snapshots ?? path.join(qaDir, "snapshots"), Number(options.maxSnapshots ?? 12));
  if (!snapshots.length) throw new Error("Production critique requires rendered snapshots");
  const images = await Promise.all(snapshots.map(dataImage));
  const evidenceById = new Map(evidence.items.map((entry) => [entry.id, entry]));
  const evidenceIndex = evidence.items.map((entry) => ({ id: entry.id, kind: entry.kind, role: entry.role, title: entry.title, content: String(entry.content ?? "").slice(0, 6_000), provenance: entry.provenance, claims_allowed: entry.claims_allowed }));
  const client = adapters.client ?? new OpenAIResponsesClient();
  const result = await client.runStructured({
    model: options.model ?? "gpt-5.6",
    reasoningEffort: options.reasoning ?? "xhigh",
    reasoningContext: "current_turn",
    pro: Boolean(options.pro),
    instructions: CRITIC_INSTRUCTIONS,
    input: JSON.stringify({
      project: plan.project,
      format: plan.format,
      design: plan.design,
      narration: plan.narration,
      shots: plan.shots,
      rubric: plan.rubric,
      claims: plan.claims,
      evidence_index: evidenceIndex,
      claim_support: plan.claims.map((claim) => ({ claim: claim.text, confidence: claim.confidence, qualifier: claim.qualifier, evidence: claim.evidence_ids.map((id) => evidenceById.get(id)).filter(Boolean).map((entry) => ({ id: entry.id, content: String(entry.content ?? "").slice(0, 6_000), provenance: entry.provenance, claims_allowed: entry.claims_allowed })) })),
      deterministic_verification: verification,
      deterministic_reports: { lint, validate, inspect },
      temporal_motion_analysis: motion,
      time_aligned_audio_analysis: audio,
      production_expectations: {
        audio: audio?.expected_audio === true ? "required" : audio?.expected_audio === false ? "intentionally-silent" : "unknown",
        encoded_frame_count_path: "temporal_motion_analysis.frame_count",
        frame_difference_sample_count_path: "temporal_motion_analysis.motion.frame_count"
      },
      visual_novelty_assessment: visualFingerprint?.novelty_assessment ?? null,
      snapshot_order: snapshots.map((entry) => path.basename(entry))
    }),
    images,
    schema: CRITIQUE_SCHEMA,
    schemaName: "launchclip_production_critique",
    background: options.background !== false,
    maxOutputTokens: Number(options.maxOutputTokens ?? 20_000),
    promptCacheKey: "launchclip:production-critic:v1",
    metadata: { job_id: "production-critique", shots: plan.shots.length }
  });
  const critique = applyVisualNoveltyFinding(result.value, visualFingerprint, plan.shots.map((shot) => shot.id));
  const validation = validateCritique(critique, plan.shots.map((shot) => shot.id));
  if (!validation.ok) throw new Error(`GPT-5.6 production critique failed validation: ${validation.errors.join("; ")}`);
  if (critique.verdict === "ship" && critique.findings.some((finding) => finding.severity === "major")) {
    throw new Error("GPT-5.6 production critique cannot ship with major findings");
  }
  const critiquePath = path.join(qaDir, "critique.json");
  const markdownPath = path.join(qaDir, "CRITIQUE.md");
  await writeFile(critiquePath, `${JSON.stringify({ ...critique, response_id: result.response_id, model: result.model, usage: result.usage }, null, 2)}\n`);
  await writeFile(markdownPath, renderCritique(critique));
  return { stage: "production-critique", status: critique.verdict === "ship" ? "approved" : "needs-repair", verdict: critique.verdict, critique: critiquePath, markdown: markdownPath, findings: critique.findings.length, response_id: result.response_id, model: result.model };
}

export function applyVisualNoveltyFinding(critique, fingerprint, shotIds = []) {
  const assessment = fingerprint?.novelty_assessment;
  if (!assessment || assessment.mode !== "differentiate" || assessment.passes !== false) return critique;
  const similarity = Number(assessment.nearest_recent_similarity);
  const limit = Number(assessment.similarity_limit);
  const finding = {
    id: "visual-novelty",
    severity: "major",
    category: "composition",
    shot_ids: [...shotIds],
    start_seconds: null,
    end_seconds: null,
    evidence: `The semantic visual fingerprint is ${similarity.toFixed(3)} similar to a recent video, above the configured ${limit.toFixed(3)} ceiling.`,
    repair_scope: "plan",
    instruction: "Keep the existing brand DNA, factual meaning, narration, and assets, but replace the governing episode metaphor and differ across at least four of these axes: representation sequence, spatial topology, motion vocabulary, transition vocabulary, presenter rhythm, and composition patterns.",
    preserve: ["style_dna", "authoritative narration", "factual grounding", "approved assets"]
  };
  return {
    ...critique,
    verdict: "replan",
    summary: `${critique.summary} The draft is too similar to a recent visual construction and requires a concept-level replan.`,
    findings: [...critique.findings.filter((entry) => entry.id !== finding.id), finding]
  };
}

function renderCritique(critique) {
  const lines = [`# Production critique — ${critique.verdict}`, "", critique.summary, ""];
  for (const finding of critique.findings) {
    lines.push(`## ${finding.id} · ${finding.severity} · ${finding.category}`, "", `Shots: ${finding.shot_ids.join(", ") || "whole production"}`, `Evidence: ${finding.evidence}`, `Repair scope: ${finding.repair_scope}`, `Instruction: ${finding.instruction}`, `Preserve: ${finding.preserve.join("; ") || "—"}`, "");
  }
  return `${lines.join("\n")}\n`;
}

async function snapshotPaths(directory, limit) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && /\.(?:png|jpe?g|webp)$/i.test(entry.name)).map((entry) => path.join(directory, entry.name)).sort().slice(0, limit);
}

async function dataImage(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const mime = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
  return { url: `data:${mime};base64,${(await readFile(filePath)).toString("base64")}`, detail: "original" };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readOptionalJson(filePath) {
  try { return await readJson(filePath); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
