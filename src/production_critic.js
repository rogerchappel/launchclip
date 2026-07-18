import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createStructuredClient, parseModelRoute } from "./model_provider.js";
import { CRITIQUE_SCHEMA, PRODUCTION_PATHS, validateCritique } from "./production_contracts.js";

const CRITIC_INSTRUCTIONS = `You are the independent final editor and motion-design critic. Decide whether this rendered production should ship, receive targeted repairs, or be replanned.

Judge the supplied rendered-pixel evidence and measurements against the actual production plan and its rubric. Inspect narrative clarity, factual grounding, visual hierarchy, typography, composition, asset use, presenter placement, shot-to-shot continuity, motion intent, pacing, and audio strategy.

Rules:
- Inspect the actual pixels before judging visual quality. Do not infer that a planned element is visible, legible, well-composed, or stylistically successful merely because the plan or HTML says it should be.
- visual_evidence maps the ordered source frames to shot IDs and timestamps. Contact sheets preserve that same order and label their frame times. Review every covered shot before returning ship.
- Treat clipped or off-canvas content, phone-unreadable text, excessive unused space, weak focal scale, accidental overlap, repeated near-identical frames, and visible drift from the requested art direction as concrete visual evidence when present.
- Do not invent defects for shots that are not represented. Use temporal measurements, not guesses between stills, for motion claims that the supplied frames cannot prove.
- Technical validity is not creative quality. A clean DOM can still be dull, generic, illegible, or narratively weak.
- Do not demand a fixed house style. Judge whether this video's chosen art direction is coherent, original, and appropriate to its subject.
- Use motion metrics as temporal evidence. Do not treat raw RGB or pixel similarity to unrelated references as a quality target.
- temporal_motion_analysis.frame_count is the encoded video frame count. temporal_motion_analysis.motion.frame_count is the number of adjacent-frame difference samples and is normally one lower; do not confuse the two.
- When production_expectations.audio is intentionally-silent, do not request voiceover, music, sound effects, or an audio stream. Judge only the requested silent evaluation render.
- A finding must name observable evidence, affected shot IDs, the smallest repair scope, a concrete instruction, and what must be preserved.
- Use replan only when repairing frames cannot solve the narrative or timing problem.
- Ship only when there are no blocking or major findings.
- When human_review_request is present, treat it as a binding desired change. Translate it into the smallest actionable typed findings, grounded in the supplied plan and snapshots. Do not return ship without at least one finding.

Return only the strict production-critique JSON.`;

export async function critiqueProduction(workspacePath, options = {}, adapters = {}) {
  const workspace = path.resolve(workspacePath);
  const qaDir = path.join(workspace, PRODUCTION_PATHS.qa);
  const humanReviewRequest = normalizeHumanReviewRequest(options.humanReviewRequest);
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
  const visualEvidence = await buildVisualEvidence(verification.snapshots ?? path.join(qaDir, "snapshots"), plan.shots, Number(options.maxSnapshots ?? 12));
  if (!visualEvidence.images.length) throw new Error("Production critique requires rendered snapshots");
  const images = await Promise.all(visualEvidence.images.map((entry) => dataImage(entry.path, entry.detail)));
  const evidenceById = new Map(evidence.items.map((entry) => [entry.id, entry]));
  const evidenceIndex = evidence.items.map((entry) => ({ id: entry.id, kind: entry.kind, role: entry.role, title: entry.title, content: String(entry.content ?? "").slice(0, 6_000), provenance: entry.provenance, claims_allowed: entry.claims_allowed }));
  const route = parseModelRoute(options.route, {
    provider: "openai",
    model: options.model ?? "gpt-5.6",
    reasoning: options.reasoning ?? "xhigh"
  });
  const client = adapters.client ?? (adapters.createClient ?? createStructuredClient)(route);
  const result = await client.runStructured({
    model: route.model,
    reasoningEffort: route.reasoning,
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
      deterministic_reports: { lint, validate, inspect: compactInspectReport(inspect) },
      temporal_motion_analysis: compactMotionAnalysis(motion),
      time_aligned_audio_analysis: compactAudioAnalysis(audio),
      production_expectations: {
        audio: audio?.expected_audio === true ? "required" : audio?.expected_audio === false ? "intentionally-silent" : "unknown",
        encoded_frame_count_path: "temporal_motion_analysis.frame_count",
        frame_difference_sample_count_path: "temporal_motion_analysis.motion.frame_count"
      },
      visual_novelty_assessment: visualFingerprint?.novelty_assessment ?? null,
      human_review_request: humanReviewRequest,
      visual_evidence: visualEvidence.manifest,
      snapshot_order: visualEvidence.images.map((entry) => path.basename(entry.path))
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
  if (!validation.ok) throw new Error(`Production critique failed validation: ${validation.errors.join("; ")}`);
  if (critique.verdict === "ship" && critique.findings.some((finding) => finding.severity === "major")) {
    throw new Error("Production critique cannot ship with major findings");
  }
  if (humanReviewRequest && (critique.verdict === "ship" || !critique.findings.length)) {
    throw new Error("Production critique must translate a human review request into at least one repair finding");
  }
  const critiquePath = path.join(qaDir, "critique.json");
  const markdownPath = path.join(qaDir, "CRITIQUE.md");
  const visualEvidenceReceipt = {
    mode: visualEvidence.manifest.mode,
    image_count: visualEvidence.images.length,
    frame_count: visualEvidence.manifest.frames.length,
    covered_shot_ids: visualEvidence.manifest.covered_shot_ids,
    reused_verification_snapshots: true
  };
  await writeFile(critiquePath, `${JSON.stringify({ ...critique, response_id: result.response_id, model: result.model, usage: result.usage, visual_evidence: visualEvidenceReceipt }, null, 2)}\n`);
  await writeFile(markdownPath, renderCritique(critique));
  return { stage: "production-critique", status: critique.verdict === "ship" ? "approved" : "needs-repair", verdict: critique.verdict, critique: critiquePath, markdown: markdownPath, findings: critique.findings.length, response_id: result.response_id, model: result.model, visual_evidence: visualEvidenceReceipt };
}

function compactMotionAnalysis(report) {
  if (!report || typeof report !== "object") return report;
  return {
    ...report,
    motion: compactObject(report.motion, ["frame_difference"]),
    optical_flow: compactObject(report.optical_flow, ["samples"])
  };
}

function compactAudioAnalysis(report) {
  if (!report || typeof report !== "object") return report;
  const sources = report.sources && typeof report.sources === "object"
    ? Object.fromEntries(Object.entries(report.sources).map(([key, value]) => [key, compactObject(value, ["peaks"])]))
    : report.sources;
  return {
    ...report,
    output: compactObject(report.output, ["peaks"]),
    sources
  };
}

function compactInspectReport(report) {
  if (!report || typeof report !== "object" || !report.stdout || typeof report.stdout !== "object") return report;
  const stdout = { ...report.stdout };
  for (const key of ["runtime", "lint", "contrast", "layout", "motion"]) {
    const section = stdout[key];
    if (!section || typeof section !== "object") continue;
    const findings = Array.isArray(section.findings) ? section.findings : null;
    const samples = Array.isArray(section.samples) ? section.samples : null;
    stdout[key] = {
      ...section,
      ...(findings ? {
        findings: findings.filter((finding) => finding?.severity !== "info"),
        omitted_info_findings: findings.filter((finding) => finding?.severity === "info").length
      } : {}),
      ...(samples ? { samples: undefined, sample_count: samples.length } : {})
    };
  }
  return { ...report, stdout };
}

function compactObject(value, omittedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const compact = { ...value };
  for (const key of omittedKeys) {
    if (!Array.isArray(compact[key])) continue;
    compact[key === "samples" ? "sample_count" : `${key}_sample_count`] = compact[key].length;
    delete compact[key];
  }
  return compact;
}

function normalizeHumanReviewRequest(value) {
  if (value == null) return null;
  const request = String(value).trim();
  if (!request) throw new Error("Human review request cannot be empty");
  if (request.length > 8_000) throw new Error("Human review request cannot exceed 8000 characters");
  return request;
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

async function buildVisualEvidence(directory, shots = [], limit = 12) {
  const entries = await readdir(directory, { withFileTypes: true });
  const imagePaths = entries
    .filter((entry) => entry.isFile() && /\.(?:png|jpe?g|webp)$/i.test(entry.name))
    .map((entry) => path.join(directory, entry.name))
    .sort();
  const contactSheets = imagePaths.filter((entry) => /(?:^|\/)contact-sheet(?:-|\.)/i.test(entry));
  const sourceFrames = imagePaths.filter((entry) => !contactSheets.includes(entry)).map((entry, index) => frameEvidence(entry, index, shots));
  const selectedFrames = selectBalancedFrames(sourceFrames, shots, limit);
  const useContactSheets = contactSheets.length > 0 && sourceFrames.length > 0;
  const images = useContactSheets
    ? contactSheets.map((entry) => ({ path: entry, detail: "high", kind: "contact-sheet" }))
    : selectedFrames.map((entry) => ({ path: entry.path, detail: "low", kind: "frame" }));
  const manifestFrames = useContactSheets ? sourceFrames : selectedFrames;
  return {
    images,
    manifest: {
      mode: useContactSheets ? "contact-sheets" : "balanced-frames",
      image_count: images.length,
      frame_count: manifestFrames.length,
      covered_shot_ids: [...new Set(manifestFrames.map((entry) => entry.shot_id).filter(Boolean))],
      images: images.map((entry, index) => ({ image_index: index, file: path.basename(entry.path), kind: entry.kind, detail: entry.detail })),
      frames: manifestFrames.map((entry, index) => ({ frame_index: index, file: path.basename(entry.path), at_seconds: entry.at_seconds, shot_id: entry.shot_id }))
    }
  };
}

function frameEvidence(filePath, index, shots) {
  const match = path.basename(filePath).match(/-at-([0-9]+(?:\.[0-9]+)?)s\.(?:png|jpe?g|webp)$/i);
  const atSeconds = match ? Number(match[1]) : null;
  return { path: filePath, source_index: index, at_seconds: atSeconds, shot_id: shotAtSeconds(shots, atSeconds) };
}

function shotAtSeconds(shots, atSeconds) {
  if (!Number.isFinite(atSeconds)) return null;
  for (const [index, shot] of (shots ?? []).entries()) {
    const start = Number(shot?.start_seconds);
    const end = Number(shot?.end_seconds);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (atSeconds >= start - .001 && (atSeconds < end - .001 || index === shots.length - 1 && atSeconds <= end + .15)) return shot.id ?? null;
  }
  return null;
}

function selectBalancedFrames(frames, shots, limit) {
  const maximum = Math.max(1, Math.floor(Number(limit) || 1));
  if (frames.length <= maximum) return frames;
  const timed = frames.filter((entry) => Number.isFinite(entry.at_seconds));
  if (!timed.length) return evenlySelect(frames, maximum);
  const validShots = (shots ?? []).filter((shot) => Number.isFinite(Number(shot?.start_seconds)) && Number.isFinite(Number(shot?.end_seconds)) && Number(shot.end_seconds) > Number(shot.start_seconds));
  const selectedShots = validShots.length <= maximum ? validShots : evenlySelect(validShots, maximum);
  const selected = [];
  for (const [index, shot] of selectedShots.entries()) {
    const candidates = timed.filter((entry) => entry.shot_id === shot.id);
    if (!candidates.length) continue;
    const target = index === 0 ? Number(shot.start_seconds) : (Number(shot.start_seconds) + Number(shot.end_seconds)) / 2;
    const closest = [...candidates].sort((left, right) => Math.abs(left.at_seconds - target) - Math.abs(right.at_seconds - target) || left.source_index - right.source_index)[0];
    if (!selected.includes(closest)) selected.push(closest);
  }
  while (selected.length < maximum) {
    const candidates = timed.filter((entry) => !selected.includes(entry));
    if (!candidates.length) break;
    const next = candidates.sort((left, right) => temporalCoverage(right, selected) - temporalCoverage(left, selected) || left.source_index - right.source_index)[0];
    selected.push(next);
  }
  return selected.sort((left, right) => left.source_index - right.source_index).slice(0, maximum);
}

function temporalCoverage(candidate, selected) {
  if (!selected.length) return Infinity;
  return Math.min(...selected.map((entry) => Math.abs(candidate.at_seconds - entry.at_seconds)));
}

function evenlySelect(values, count) {
  if (values.length <= count) return [...values];
  if (count === 1) return [values[0]];
  return Array.from({ length: count }, (_, index) => values[Math.round(index * (values.length - 1) / (count - 1))]);
}

async function dataImage(filePath, detail = "low") {
  const extension = path.extname(filePath).toLowerCase();
  const mime = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
  return { url: `data:${mime};base64,${(await readFile(filePath)).toString("base64")}`, detail };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readOptionalJson(filePath) {
  try { return await readJson(filePath); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
