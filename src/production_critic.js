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
- A finding must name observable evidence, affected shot IDs, the smallest repair scope, a concrete instruction, and what must be preserved.
- Use replan only when repairing frames cannot solve the narrative or timing problem.
- Ship only when there are no blocking or major findings.

Return only the strict production-critique JSON.`;

export async function critiqueProduction(workspacePath, options = {}, adapters = {}) {
  const workspace = path.resolve(workspacePath);
  const qaDir = path.join(workspace, PRODUCTION_PATHS.qa);
  const [plan, evidence, verification, motion, lint, validate, inspect] = await Promise.all([
    readJson(path.join(workspace, PRODUCTION_PATHS.plan)),
    readJson(path.join(workspace, PRODUCTION_PATHS.evidence)),
    readJson(path.join(qaDir, "verification.json")),
    readOptionalJson(path.join(qaDir, "motion.json")),
    readOptionalJson(path.join(qaDir, "lint.json")),
    readOptionalJson(path.join(qaDir, "validate.json")),
    readOptionalJson(path.join(qaDir, "inspect.json"))
  ]);
  const snapshots = await snapshotPaths(verification.snapshots ?? path.join(qaDir, "snapshots"), Number(options.maxSnapshots ?? 12));
  if (!snapshots.length) throw new Error("Production critique requires rendered snapshots");
  const images = await Promise.all(snapshots.map(dataImage));
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
      evidence_index: evidence.items.map((entry) => ({ id: entry.id, title: entry.title, provenance: entry.provenance, claims_allowed: entry.claims_allowed })),
      deterministic_verification: verification,
      deterministic_reports: { lint, validate, inspect },
      temporal_motion_analysis: motion,
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
  const validation = validateCritique(result.value, plan.shots.map((shot) => shot.id));
  if (!validation.ok) throw new Error(`GPT-5.6 production critique failed validation: ${validation.errors.join("; ")}`);
  if (result.value.verdict === "ship" && result.value.findings.some((finding) => finding.severity === "major")) {
    throw new Error("GPT-5.6 production critique cannot ship with major findings");
  }
  const critiquePath = path.join(qaDir, "critique.json");
  const markdownPath = path.join(qaDir, "CRITIQUE.md");
  await writeFile(critiquePath, `${JSON.stringify({ ...result.value, response_id: result.response_id, model: result.model, usage: result.usage }, null, 2)}\n`);
  await writeFile(markdownPath, renderCritique(result.value));
  return { stage: "production-critique", status: result.value.verdict === "ship" ? "approved" : "needs-repair", verdict: result.value.verdict, critique: critiquePath, markdown: markdownPath, findings: result.value.findings.length, response_id: result.response_id, model: result.model };
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
