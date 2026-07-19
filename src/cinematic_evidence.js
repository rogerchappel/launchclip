import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export const SUBSCRIPTION_CINEMATIC_CONTRACT = "phase-2";
export const SUBSCRIPTION_CANDIDATE_RECEIPT_VERSION = "launchclip.subscription-rendered-candidates.v1";
export const SUBSCRIPTION_TEMPORAL_EVIDENCE_VERSION = "launchclip.subscription-temporal-evidence.v1";

const SHARED_WORLD_ROLES = ["before", "departure", "early-acceleration", "peak-speed", "late-deceleration", "settle", "after"];
const CANDIDATE_SCORE_FIELDS = [
  "scroll_stop",
  "promise_or_proof_clarity",
  "mobile_hierarchy",
  "art_direction_specificity",
  "depth_materiality",
  "temporal_development",
  "continuity",
  "velocity_blur_shape",
  "crisp_settle",
  "implementation_feasibility"
];
const TEMPORAL_EVIDENCE_SOURCES = ["hyperframes", "encoded-draft"];

export function readCinematicContractMarker(html) {
  const root = [...String(html ?? "").matchAll(/<[a-z][^>]*\bdata-composition-id\s*=\s*["'][^"']+["'][^>]*>/gi)][0]?.[0];
  return root ? attribute(root, "data-launchclip-cinematic-contract") ?? null : null;
}

export function parseDeclaredSequenceBoundaries(html, durationSeconds) {
  const duration = positiveDuration(durationSeconds);
  const boundaries = [];
  const errors = [];
  const tags = [...String(html ?? "").matchAll(/<[a-z][^>]*\bdata-launchclip-transition-start\s*=\s*["'][^"']+["'][^>]*>/gi)].map((match) => match[0]);
  for (const [index, tag] of tags.entries()) {
    const start = Number(attribute(tag, "data-launchclip-transition-start"));
    const transitionDuration = Number(attribute(tag, "data-launchclip-transition-duration"));
    const sequenceId = attribute(tag, "data-launchclip-sequence-id");
    const fromId = attribute(tag, "data-launchclip-transition-from");
    const toId = attribute(tag, "data-launchclip-transition-to");
    const boundaryId = attribute(tag, "data-launchclip-boundary-id") ?? `${sequenceId ?? "boundary"}-${String(index + 1).padStart(3, "0")}`;
    const kind = attribute(tag, "data-launchclip-transition-kind") ?? (sequenceId ? "shared-world" : "ordinary");
    if (!Number.isFinite(start) || start < 0 || start > duration) errors.push(`${boundaryId} has an invalid transition start`);
    if (!Number.isFinite(transitionDuration) || transitionDuration <= 0) errors.push(`${boundaryId} has an invalid transition duration`);
    if (Number.isFinite(start) && Number.isFinite(transitionDuration) && start + transitionDuration > duration + .001) errors.push(`${boundaryId} extends beyond the composition duration`);
    if (!new Set(["ordinary", "shared-world"]).has(kind)) errors.push(`${boundaryId} has unsupported transition kind ${kind}`);
    boundaries.push({
      boundary_id: boundaryId,
      sequence_id: sequenceId,
      kind,
      start_seconds: start,
      duration_seconds: transitionDuration,
      from_id: fromId,
      to_id: toId
    });
  }
  const ids = boundaries.map((entry) => entry.boundary_id);
  if (new Set(ids).size !== ids.length) errors.push("Declared transition boundary IDs must be unique");
  return { ok: errors.length === 0, boundaries, errors };
}

export function buildTemporalEvidenceSchedule(durationSeconds, boundaries = []) {
  const duration = positiveDuration(durationSeconds);
  const finalSample = Math.max(0, duration - .05);
  const hookTimes = uniqueNumbers([0, .25, .5, .75, 1, 1.5, 2, 3, 4].map((value) => clamp(value, 0, finalSample)));
  const hook = hookTimes.map((atSeconds, index) => ({
    evidence_id: `hook-${String(index + 1).padStart(3, "0")}`,
    role: "hook",
    at_seconds: rounded(atSeconds),
    boundary_id: null,
    sequence_id: null
  }));
  const transitions = [];
  for (const boundary of boundaries) {
    const start = Number(boundary.start_seconds);
    const moveDuration = Number(boundary.duration_seconds);
    const shared = boundary.kind === "shared-world";
    const samples = shared
      ? [
          ["before", start - .05],
          ["departure", start],
          ["early-acceleration", start + moveDuration * .2],
          ["peak-speed", start + moveDuration * .5],
          ["late-deceleration", start + moveDuration * .8],
          ["settle", start + moveDuration],
          ["after", start + moveDuration + .05]
        ]
      : [["before", start - .05], ["midpoint", start + moveDuration * .5], ["after", start + moveDuration + .05]];
    for (const [role, atSeconds] of samples) {
      transitions.push({
        evidence_id: `boundary-${safeId(boundary.boundary_id)}-${role}`,
        role,
        at_seconds: rounded(clamp(atSeconds, 0, finalSample)),
        boundary_id: boundary.boundary_id,
        sequence_id: boundary.sequence_id ?? null
      });
    }
  }
  return {
    hook,
    transitions,
    entries: [...hook, ...transitions],
    timestamps: uniqueNumbers([...hook, ...transitions].map((entry) => entry.at_seconds)),
    shared_world_roles: [...SHARED_WORLD_ROLES]
  };
}

export async function validateRenderedCandidateReceipt(projectPath, receipt, options = {}) {
  const project = path.resolve(projectPath);
  const errors = [];
  if (receipt?.schema_version !== SUBSCRIPTION_CANDIDATE_RECEIPT_VERSION) errors.push(`candidate receipt schema_version must be ${SUBSCRIPTION_CANDIDATE_RECEIPT_VERSION}`);
  const comparisons = Array.isArray(receipt?.comparisons) ? receipt.comparisons : [];
  if (comparisons.length < 2) errors.push("candidate receipt requires opening and transition comparisons");
  const comparisonIds = comparisons.map((entry) => entry?.id).filter(Boolean);
  if (comparisonIds.length !== comparisons.length || new Set(comparisonIds).size !== comparisonIds.length) errors.push("candidate comparison IDs must be present and unique");
  const kinds = new Set(comparisons.map((entry) => entry?.kind));
  if (!kinds.has("opening")) errors.push("candidate receipt requires an opening comparison");
  if (!kinds.has("transition")) errors.push("candidate receipt requires a transition comparison");
  const declaredBoundaryIds = Array.isArray(options.boundaryIds) ? new Set(options.boundaryIds) : null;
  const artifacts = [];
  let candidateCount = 0;
  for (const comparison of comparisons) {
    const comparisonId = comparison?.id ?? "(unknown)";
    if (!new Set(["opening", "transition"]).has(comparison?.kind)) errors.push(`candidate comparison ${comparisonId} has an unsupported kind`);
    if (comparison?.judging_basis !== "rendered-pixels-and-motion") errors.push(`candidate comparison ${comparisonId} must judge rendered pixels and motion`);
    if (typeof comparison?.selection_rationale !== "string" || !comparison.selection_rationale.trim()) errors.push(`candidate comparison ${comparisonId} requires a selection rationale`);
    if (comparison?.kind === "transition") {
      if (typeof comparison?.boundary_id !== "string" || !comparison.boundary_id.trim()) errors.push(`transition comparison ${comparisonId} requires a boundary ID`);
      else if (declaredBoundaryIds && !declaredBoundaryIds.has(comparison.boundary_id)) errors.push(`transition comparison ${comparisonId} references an undeclared boundary ID`);
    }
    const candidates = Array.isArray(comparison?.candidates) ? comparison.candidates : [];
    candidateCount += candidates.length;
    if (candidates.length < 2) errors.push(`candidate comparison ${comparisonId} requires at least two candidates`);
    const ids = candidates.map((entry) => entry?.id).filter(Boolean);
    if (ids.length !== candidates.length || new Set(ids).size !== ids.length) errors.push(`candidate IDs in ${comparisonId} must be present and unique`);
    const selectedId = comparison?.selected_candidate_id ?? comparison?.selected_id;
    if (!selectedId || !ids.includes(selectedId)) errors.push(`selected candidate ID in ${comparisonId} must reference a supplied candidate`);
    for (const candidate of candidates) {
      const candidateId = candidate?.id ?? "(unknown)";
      validateCandidateScores(candidate, comparisonId, errors);
      if (candidateId !== selectedId && !candidateRejectionReasons(candidate).length) errors.push(`rejected candidate ${candidateId} in ${comparisonId} requires a rejection reason`);
      const files = candidateArtifactFiles(candidate);
      if (!files.length) errors.push(`candidate ${candidateId} in ${comparisonId} has no rendered pixel artifacts`);
      for (const file of files) {
        try {
          const resolved = containedProjectFile(project, file);
          const info = await stat(resolved);
          if (!info.isFile() || info.size <= 0) errors.push(`candidate artifact is empty: ${file}`);
          else artifacts.push(path.relative(project, resolved).split(path.sep).join("/"));
        } catch (error) {
          errors.push(`candidate artifact is unavailable: ${file} (${error.message})`);
        }
      }
    }
  }
  return { ok: errors.length === 0, errors, comparison_count: comparisons.length, candidate_count: candidateCount, artifacts };
}

export async function validateTemporalEvidenceManifest(projectPath, manifest, videoPath, schedule) {
  const project = path.resolve(projectPath);
  const video = containedOrAbsoluteProjectFile(project, videoPath);
  const errors = [];
  if (manifest?.schema_version !== SUBSCRIPTION_TEMPORAL_EVIDENCE_VERSION) errors.push(`temporal evidence schema_version must be ${SUBSCRIPTION_TEMPORAL_EVIDENCE_VERSION}`);
  let videoHash = null;
  try { videoHash = await sha256(video); } catch (error) { errors.push(`draft video is unavailable: ${error.message}`); }
  if (!manifest?.video_sha256 || manifest.video_sha256 !== videoHash) errors.push("temporal evidence does not match the current encoded draft");
  const entries = Array.isArray(manifest?.entries) ? manifest.entries : [];
  const evidenceIds = entries.map((entry) => entry?.evidence_id ?? entry?.id).filter(Boolean);
  if (evidenceIds.length !== entries.length || new Set(evidenceIds).size !== evidenceIds.length) errors.push("temporal evidence IDs must be present and unique");
  const bySample = new Map();
  for (const entry of entries) {
    const evidenceId = entry?.evidence_id ?? entry?.id ?? "(unknown)";
    const sampleId = entry?.sample_id;
    if (typeof sampleId !== "string" || !sampleId) errors.push(`${evidenceId} has no sample ID`);
    else bySample.set(sampleId, [...(bySample.get(sampleId) ?? []), entry]);
    if (!TEMPORAL_EVIDENCE_SOURCES.includes(entry?.source)) errors.push(`${evidenceId} has an unsupported evidence source`);
  }
  for (const expected of schedule?.entries ?? []) {
    const samples = bySample.get(expected.evidence_id) ?? [];
    for (const source of TEMPORAL_EVIDENCE_SOURCES) {
      const matches = samples.filter((entry) => entry?.source === source);
      if (matches.length !== 1) {
        errors.push(`temporal evidence ${expected.evidence_id} requires exactly one ${source} artifact`);
        continue;
      }
      const entry = matches[0];
      if (entry.role !== expected.role) errors.push(`${entry.evidence_id} has the wrong role`);
      if (Math.abs(Number(entry.at_seconds) - expected.at_seconds) > .011) errors.push(`${entry.evidence_id} has the wrong timestamp`);
      if ((entry.boundary_id ?? null) !== expected.boundary_id) errors.push(`${entry.evidence_id} has the wrong boundary ID`);
      if ((entry.sequence_id ?? null) !== expected.sequence_id) errors.push(`${entry.evidence_id} has the wrong sequence ID`);
    }
  }
  for (const entry of entries) {
    const id = entry?.evidence_id ?? entry?.id ?? "(unknown)";
    if (!entry?.file) { errors.push(`${id} has no filename`); continue; }
    try {
      const file = containedProjectFile(project, entry.file);
      const info = await stat(file);
      if (!info.isFile() || info.size <= 0) errors.push(`${id} is empty`);
      const hash = await sha256(file);
      if (!entry.sha256 || entry.sha256 !== hash) errors.push(`${id} has a stale or invalid file hash`);
    } catch (error) {
      errors.push(`${id} is unavailable: ${error.message}`);
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    entry_count: entries.length,
    expected_count: (schedule?.entries?.length ?? 0) * TEMPORAL_EVIDENCE_SOURCES.length,
    sample_count: schedule?.entries?.length ?? 0,
    video_sha256: videoHash
  };
}

function validateCandidateScores(candidate, comparisonId, errors) {
  const scores = candidate?.scores;
  for (const field of CANDIDATE_SCORE_FIELDS) {
    const value = Number(scores?.[field]);
    if (!Number.isFinite(value) || value < 0 || value > 10) errors.push(`candidate ${candidate?.id ?? "(unknown)"} in ${comparisonId} has an invalid ${field} score`);
  }
}

function candidateRejectionReasons(candidate) {
  if (Array.isArray(candidate?.rejection_reasons)) return candidate.rejection_reasons.filter((entry) => typeof entry === "string" && entry.trim());
  if (typeof candidate?.rejection_reason === "string" && candidate.rejection_reason.trim()) return [candidate.rejection_reason];
  return [];
}

function candidateArtifactFiles(candidate) {
  const values = [
    ...(Array.isArray(candidate?.artifacts) ? candidate.artifacts : []),
    ...(Array.isArray(candidate?.artifact_paths) ? candidate.artifact_paths : []),
    ...(Array.isArray(candidate?.snapshots) ? candidate.snapshots : []),
    ...(Array.isArray(candidate?.verification?.frames) ? candidate.verification.frames : [])
  ];
  return [...new Set(values.map((entry) => typeof entry === "string" ? entry : entry?.file ?? entry?.path).filter(Boolean))];
}

function containedProjectFile(project, value) {
  const resolved = path.resolve(project, String(value ?? ""));
  const relative = path.relative(project, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`path escapes project: ${value}`);
  return resolved;
}

function containedOrAbsoluteProjectFile(project, value) {
  const resolved = path.isAbsolute(String(value)) ? path.resolve(String(value)) : path.resolve(project, String(value));
  const relative = path.relative(project, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`path escapes project: ${value}`);
  return resolved;
}

function attribute(tag, name) {
  return String(tag ?? "").match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1];
}

function positiveDuration(value) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("durationSeconds must be positive");
  return duration;
}

function uniqueNumbers(values) {
  return [...new Set(values.map(rounded))].sort((left, right) => left - right);
}

function rounded(value) { return Number(Number(value).toFixed(3)); }
function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
function safeId(value) { return String(value ?? "boundary").replace(/[^a-zA-Z0-9_-]+/g, "-"); }

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}
