import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { probeOpenRouterFreeVisionModels, recordOpenRouterFreeModelOutcome, selectOpenRouterFreeVisionModels } from "./free_model_selector.js";
import { createStructuredClient, parseModelRoute } from "./model_provider.js";
import { CRITIQUE_SCHEMA, PRODUCTION_PATHS, validateCritique } from "./production_contracts.js";

const CRITIC_INSTRUCTIONS = `You are the independent final editor and motion-design critic. Decide whether this rendered production should ship, receive targeted repairs, or be replanned.

Judge the supplied rendered-pixel evidence and measurements against the actual production plan and its rubric. Inspect narrative clarity, factual grounding, visual hierarchy, typography, composition, asset use, presenter placement, shot-to-shot continuity, motion intent, pacing, and audio strategy.

Rules:
- Inspect the actual pixels before judging visual quality. Do not infer that a planned element is visible, legible, well-composed, or stylistically successful merely because the plan or HTML says it should be.
- visual_evidence maps the ordered source frames to shot IDs and timestamps. Contact sheets preserve that same order and label their frame times. Review every covered shot before returning ship.
- visual_evidence temporal roles are binding pixel evidence. Review hook frames in order and review every transition before/mid/after strip as one motion boundary; cite its temporal evidence IDs in the finding evidence.
- Report a visible transition defect with category=mount, repair_scope=assembly, and both adjacent shot IDs. Preserve coherent frames on either side and ask for the smallest change to boundary kind, timing, velocity, blur, easing, mask, or shared-object geometry.
- Treat clipped or off-canvas content, phone-unreadable text, excessive unused space, weak focal scale, accidental overlap, repeated near-identical frames, and visible drift from the requested art direction as concrete visual evidence when present.
- Treat deterministic reports as supporting diagnostics, not a substitute for looking at the rendered pixels. Corroborate a reported issue in the supplied frames or temporal evidence before turning it into a finding; do not echo every browser warning into the critique.
- Clip mounts and transition wrappers may intentionally enter or leave the canvas at a shot boundary. Do not call this subject drift or canvas overflow unless the focal content is visibly clipped during its readable hold. Repeated identical mount-level warnings at successive shot boundaries are transition evidence, not proof that every scene is broken.
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

const OPENROUTER_FREE_VISION_FALLBACK = "openrouter:openrouter/free@none";
export const FREE_VISION_UNAVAILABLE_CODE = "LAUNCHCLIP_FREE_VISION_UNAVAILABLE";

export async function critiqueProduction(workspacePath, options = {}, adapters = {}) {
  const workspace = path.resolve(workspacePath);
  const qaDir = path.join(workspace, PRODUCTION_PATHS.qa);
  const humanReviewRequest = normalizeHumanReviewRequest(options.humanReviewRequest);
  const [plan, evidence, verification, motion, audio, lint, validate, inspect, visualFingerprint, temporalEvidence] = await Promise.all([
    readJson(path.join(workspace, PRODUCTION_PATHS.plan)),
    readJson(path.join(workspace, PRODUCTION_PATHS.evidence)),
    readJson(path.join(qaDir, "verification.json")),
    readOptionalJson(path.join(qaDir, "motion.json")),
    readOptionalJson(path.join(qaDir, "audio.json")),
    readOptionalJson(path.join(qaDir, "lint.json")),
    readOptionalJson(path.join(qaDir, "validate.json")),
    readOptionalJson(path.join(qaDir, "inspect.json")),
    readOptionalJson(path.join(workspace, "production", "plans", "visual-fingerprint.json")),
    readOptionalJson(path.join(qaDir, "temporal-evidence.json"))
  ]);
  const visualEvidence = await buildVisualEvidence(verification.snapshots ?? path.join(qaDir, "snapshots"), plan.shots, Number(options.maxSnapshots ?? 12), temporalEvidence);
  if (!visualEvidence.images.length) throw new Error("Production critique requires rendered snapshots");
  const images = await Promise.all(visualEvidence.images.map((entry) => dataImage(entry.path, entry.detail)));
  const evidenceById = new Map(evidence.items.map((entry) => [entry.id, entry]));
  const evidenceIndex = evidence.items.map((entry) => ({ id: entry.id, kind: entry.kind, role: entry.role, title: entry.title, content: String(entry.content ?? "").slice(0, 6_000), provenance: entry.provenance, claims_allowed: entry.claims_allowed }));
  let freeVisionSelection = null;
  if (options.selectFreeVision) {
    try {
      freeVisionSelection = await selectFreeVisionCritic(options, adapters);
    } catch (error) {
      throw freeVisionUnavailableError(error?.message ?? "OpenRouter free vision selection failed", error);
    }
  }
  let route = parseModelRoute(freeVisionSelection?.routes?.[0] ?? options.route, {
    provider: "openai",
    model: options.model ?? "gpt-5.6",
    reasoning: options.reasoning ?? "xhigh"
  });
  const request = {
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
      deterministic_verification: compactVerificationReport(verification),
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
    maxOutputTokens: Number(options.maxOutputTokens ?? (route.provider === "openrouter" && (route.model === "openrouter/free" || route.model.endsWith(":free")) ? 4_000 : 20_000)),
    promptCacheKey: "launchclip:production-critic:v3",
    metadata: { job_id: "production-critique", shots: plan.shots.length }
  };
  let result;
  try {
    result = await runCriticRequest(route, request, adapters);
  } catch (error) {
    if (!freeVisionSelection || adapters.client) throw error;
    try {
      result = await runCriticRequest(route, request, adapters);
    } catch (retryError) {
      const failedModel = freeVisionSelection.selected_model;
      const recordOutcome = adapters.recordOpenRouterFreeModelOutcome ?? recordOpenRouterFreeModelOutcome;
      const probeModels = adapters.probeOpenRouterFreeVisionModels ?? probeOpenRouterFreeVisionModels;
      const rotated = await recordOutcome(freeVisionSelection, { error: retryError });
      try {
        freeVisionSelection = await probeModels(rotated, { timeoutMs: Number(options.freeVisionProbeTimeoutMs ?? 15_000), excludeIds: [failedModel] });
      } catch (probeError) {
        freeVisionSelection = degradedFreeVisionSelection(rotated, probeError);
      }
      const fallbackRoutes = [...new Set([
        freeVisionSelection.routes?.[0],
        OPENROUTER_FREE_VISION_FALLBACK
      ].filter(Boolean))];
      const failures = [];
      for (const fallbackRoute of fallbackRoutes) {
        route = parseModelRoute(fallbackRoute);
        request.reasoningEffort = route.reasoning;
        try {
          result = await runCriticRequest(route, request, adapters);
          if (route.model === "openrouter/free") {
            freeVisionSelection = {
              ...freeVisionSelection,
              source: "free-router-fallback",
              selected_model: result.model,
              warnings: [...(freeVisionSelection.warnings ?? []), "Ranked free vision endpoints were unavailable; OpenRouter selected the final free vision route."]
            };
          }
          break;
        } catch (fallbackError) {
          failures.push(`${route.model}: ${String(fallbackError?.message ?? fallbackError).slice(0, 500)}`);
        }
      }
      if (!result) throw freeVisionUnavailableError(`All OpenRouter free vision critic routes failed: ${failures.join("; ")}`, retryError);
    }
  }
  const critique = applyVisualNoveltyFinding(normalizeCritiqueTiming(normalizeCritiqueShape(result.value), plan.shots), visualFingerprint, plan.shots.map((shot) => shot.id));
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
    critical_frame_count: visualEvidence.manifest.critical_frame_count,
    transition_frame_count: visualEvidence.manifest.transition_frame_count,
    covered_shot_ids: visualEvidence.manifest.covered_shot_ids,
    reused_verification_snapshots: true
  };
  const freeVisionReceipt = freeVisionSelection ? freeVisionSelectionSummary(freeVisionSelection) : null;
  await writeFile(critiquePath, `${JSON.stringify({ ...critique, response_id: result.response_id, model: result.model, usage: result.usage, visual_evidence: visualEvidenceReceipt, ...(freeVisionReceipt ? { free_model_selection: freeVisionReceipt } : {}) }, null, 2)}\n`);
  await writeFile(markdownPath, renderCritique(critique));
  return { stage: "production-critique", status: critique.verdict === "ship" ? "approved" : "needs-repair", verdict: critique.verdict, critique: critiquePath, markdown: markdownPath, findings: critique.findings.length, response_id: result.response_id, model: result.model, visual_evidence: visualEvidenceReceipt, ...(freeVisionReceipt ? { free_model_selection: freeVisionReceipt } : {}) };
}

function freeVisionUnavailableError(message, cause) {
  const error = new Error(message, { cause });
  error.code = FREE_VISION_UNAVAILABLE_CODE;
  return error;
}

async function selectFreeVisionCritic(options, adapters) {
  const selectModels = adapters.selectOpenRouterFreeVisionModels ?? selectOpenRouterFreeVisionModels;
  const probeModels = adapters.probeOpenRouterFreeVisionModels ?? probeOpenRouterFreeVisionModels;
  const selectionOptions = {
    statePath: options.freeVisionStatePath,
    topK: options.freeVisionCandidates ?? 3,
    refresh: Boolean(options.refreshFreeVisionModels)
  };
  let selection = await selectModels(selectionOptions);
  if (!selection?.routes?.length) throw new Error("OpenRouter free vision-model selection returned no routes");
  const probeOptions = { timeoutMs: Number(options.freeVisionProbeTimeoutMs ?? 15_000) };
  try {
    return await probeModels(selection, probeOptions);
  } catch (error) {
    if (selectionOptions.refresh) return degradedFreeVisionSelection(selection, error);
    selection = await selectModels({ ...selectionOptions, refresh: true });
    if (!selection?.routes?.length) throw new Error("OpenRouter free vision-model refresh returned no routes", { cause: error });
    try {
      return await probeModels(selection, probeOptions);
    } catch (refreshError) {
      return degradedFreeVisionSelection(selection, refreshError);
    }
  }
}

function degradedFreeVisionSelection(selection, error) {
  return {
    ...selection,
    source: "probe-degraded",
    warnings: [...(selection?.warnings ?? []), `Live vision probe unavailable; attempting ranked routes directly: ${String(error?.message ?? error).slice(0, 500)}`]
  };
}

async function runCriticRequest(route, request, adapters) {
  const client = adapters.client ?? (adapters.createClient ?? createStructuredClient)(route);
  return client.runStructured({ ...request, model: route.model });
}

function freeVisionSelectionSummary(selection) {
  return {
    source: selection.source,
    state_path: selection.state_path,
    selected_model: selection.selected_model,
    verified_free_at: selection.verified_free_at,
    candidates: (selection.candidates ?? []).map((candidate) => ({ id: candidate.id, score: candidate.score, coverage: candidate.coverage })),
    warnings: [...(selection.warnings ?? [])]
  };
}

function normalizeCritiqueShape(critique) {
  return {
    schema_version: critique?.schema_version,
    verdict: critique?.verdict,
    summary: critique?.summary,
    findings: (critique?.findings ?? []).map((finding) => ({
      id: finding?.id,
      severity: finding?.severity,
      category: finding?.category,
      shot_ids: finding?.shot_ids,
      start_seconds: finding?.start_seconds,
      end_seconds: finding?.end_seconds,
      evidence: finding?.evidence,
      repair_scope: finding?.repair_scope,
      instruction: finding?.instruction,
      preserve: finding?.preserve
    }))
  };
}

function normalizeCritiqueTiming(critique, shots) {
  const byId = new Map((shots ?? []).map((shot) => [shot.id, shot]));
  return {
    ...critique,
    findings: (critique?.findings ?? []).map((finding) => {
      if (finding.start_seconds == null || finding.end_seconds == null || Number(finding.end_seconds) > Number(finding.start_seconds)) return finding;
      const affected = (finding.shot_ids ?? []).map((id) => byId.get(id)).filter(Boolean);
      if (!affected.length) return finding;
      const shotStart = Math.min(...affected.map((shot) => Number(shot.start_seconds)));
      const shotEnd = Math.max(...affected.map((shot) => Number(shot.end_seconds)));
      if (!Number.isFinite(shotStart) || !Number.isFinite(shotEnd) || shotEnd <= shotStart) return finding;
      const requestedStart = Number(finding.start_seconds);
      const start = Number.isFinite(requestedStart) && requestedStart >= shotStart && requestedStart < shotEnd ? requestedStart : shotStart;
      return { ...finding, start_seconds: start, end_seconds: shotEnd };
    })
  };
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
        findings: compactBrowserFindings(findings.filter((finding) => finding?.severity !== "info")),
        omitted_info_findings: findings.filter((finding) => finding?.severity === "info").length
      } : {}),
      ...(samples ? { samples: undefined, sample_count: samples.length } : {})
    };
  }
  return { ...report, stdout };
}

function compactVerificationReport(report) {
  if (!report || typeof report !== "object") return report;
  const checks = report.checks && typeof report.checks === "object"
    ? Object.fromEntries(Object.entries(report.checks).map(([name, check]) => [name, {
      ok: check?.ok,
      exit_code: check?.exit_code,
      strict_warning_count: check?.strict_warning_count,
      failure_kind: check?.failure_kind
    }]))
    : report.checks;
  return {
    schema_version: report.schema_version,
    status: report.status,
    plan: report.plan,
    checks,
    failed: report.failed ?? [],
    infrastructure_failed: report.infrastructure_failed ?? [],
    snapshot_file_count: report.snapshot_artifacts?.files?.length ?? null
  };
}

function compactBrowserFindings(findings) {
  const unique = new Map();
  for (const finding of findings ?? []) {
    const compact = {
      code: finding?.code,
      severity: finding?.severity,
      selector: finding?.selector,
      text: finding?.text,
      message: finding?.message,
      first_seen: finding?.firstSeen ?? finding?.time,
      last_seen: finding?.lastSeen ?? finding?.time,
      occurrences: finding?.occurrences
    };
    const key = [compact.code, compact.severity, compact.selector, compact.text, compact.message].join("|");
    if (!unique.has(key)) unique.set(key, compact);
  }
  return [...unique.values()].slice(0, 80);
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

async function buildVisualEvidence(directory, shots = [], limit = 12, temporalEvidence = null) {
  const entries = await readdir(directory, { withFileTypes: true });
  const imagePaths = entries
    .filter((entry) => entry.isFile() && /\.(?:png|jpe?g|webp)$/i.test(entry.name))
    .map((entry) => path.join(directory, entry.name))
    .sort();
  const contactSheets = imagePaths.filter((entry) => /(?:^|\/)contact-sheet(?:-|\.)/i.test(entry));
  const temporalByFile = temporalEvidenceMap(temporalEvidence, imagePaths);
  const sourceFrames = imagePaths
    .filter((entry) => !contactSheets.includes(entry))
    .map((entry, index) => frameEvidence(entry, index, shots, temporalByFile.get(path.basename(entry))));
  const overview = contactSheets.slice(0, 1).map((entry) => ({ path: entry, detail: "high", kind: "contact-sheet" }));
  const selectedFrames = selectHybridFrames(sourceFrames, shots, limit, overview.length);
  const images = [
    ...overview,
    ...selectedFrames.map((entry) => ({
      path: entry.path,
      detail: isKeyTemporalFrame(entry) ? "high" : "low",
      kind: isKeyTemporalFrame(entry) ? "temporal-frame" : "frame",
      evidence_id: entry.evidence_id
    }))
  ];
  const imageIndex = new Map(images.map((entry, index) => [entry.path, index]));
  const mode = temporalByFile.size ? "hybrid-temporal" : overview.length ? "hybrid-contact" : "balanced-frames";
  return {
    images,
    manifest: {
      mode,
      image_count: images.length,
      frame_count: sourceFrames.length,
      critical_frame_count: sourceFrames.filter(isCriticalTemporalFrame).length,
      transition_frame_count: sourceFrames.filter((entry) => entry.roles.some((role) => role.type === "transition")).length,
      covered_shot_ids: [...new Set(sourceFrames.map((entry) => entry.shot_id).filter(Boolean))],
      images: images.map((entry, index) => ({ image_index: index, file: path.basename(entry.path), kind: entry.kind, detail: entry.detail, evidence_id: entry.evidence_id ?? null })),
      frames: sourceFrames.map((entry, index) => ({
        frame_index: index,
        image_index: imageIndex.get(entry.path) ?? null,
        selected: imageIndex.has(entry.path),
        file: path.basename(entry.path),
        evidence_id: entry.evidence_id,
        at_seconds: entry.at_seconds,
        shot_id: entry.shot_id,
        sequence_id: entry.sequence_id,
        roles: entry.roles
      }))
    }
  };
}

function frameEvidence(filePath, index, shots, temporal = null) {
  const match = path.basename(filePath).match(/-at-([0-9]+(?:\.[0-9]+)?)s\.(?:png|jpe?g|webp)$/i);
  const atSeconds = Number.isFinite(Number(temporal?.timestamp_seconds)) ? Number(temporal.timestamp_seconds) : match ? Number(match[1]) : null;
  return {
    path: filePath,
    source_index: index,
    evidence_id: temporal?.evidence_id ?? null,
    at_seconds: atSeconds,
    shot_id: temporal?.shot_id ?? shotAtSeconds(shots, atSeconds),
    sequence_id: temporal?.sequence_id ?? null,
    roles: Array.isArray(temporal?.roles) ? temporal.roles : []
  };
}

function temporalEvidenceMap(manifest, imagePaths) {
  if (!manifest) return new Map();
  if (manifest.status !== "passed" || !Array.isArray(manifest.evidence)) throw new Error("Production critique requires passed temporal evidence");
  const available = new Set(imagePaths.map((entry) => path.basename(entry)));
  const mapped = new Map();
  for (const entry of manifest.evidence) {
    const file = path.basename(String(entry?.file ?? ""));
    if (!file || !available.has(file)) throw new Error(`Temporal evidence frame is missing from verified snapshots: ${entry?.evidence_id ?? file}`);
    if (mapped.has(file)) throw new Error(`Temporal evidence references the same frame more than once: ${file}`);
    mapped.set(file, entry);
  }
  return mapped;
}

function selectHybridFrames(frames, shots, limit, overviewCount) {
  const maximum = Math.max(1, Math.floor(Number(limit) || 1) - overviewCount);
  const critical = frames.filter(isCriticalTemporalFrame);
  const selected = [...critical];
  const remaining = Math.max(0, maximum - selected.length);
  if (remaining) {
    const sequenceKeys = frames.filter((entry) => !selected.includes(entry) && entry.roles.some((role) => ["sequence-entry", "sequence-settle"].includes(role.type)));
    selected.push(...evenlySelect(sequenceKeys, Math.min(sequenceKeys.length, Math.ceil(remaining / 2))));
  }
  const openSlots = Math.max(0, maximum - selected.length);
  if (openSlots) selected.push(...selectBalancedFrames(frames.filter((entry) => !selected.includes(entry)), shots, openSlots));
  if (!selected.length && frames.length) selected.push(...selectBalancedFrames(frames, shots, 1));
  return [...new Set(selected)].sort((left, right) => left.source_index - right.source_index);
}

function isCriticalTemporalFrame(entry) {
  return entry.roles.some((role) => role.type === "hook" || role.type === "transition");
}

function isKeyTemporalFrame(entry) {
  return entry.roles.some((role) => ["hook", "transition", "sequence-entry", "sequence-settle"].includes(role.type));
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
