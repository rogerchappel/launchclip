import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export const SUBSCRIPTION_CINEMATIC_CONTRACT = "phase-2";
export const SUBSCRIPTION_CANDIDATE_RECEIPT_VERSION = "launchclip.subscription-rendered-candidates.v1";
export const SUBSCRIPTION_TEMPORAL_EVIDENCE_VERSION = "launchclip.subscription-temporal-evidence.v1";

const SHARED_WORLD_ROLES = ["before", "departure", "early-acceleration", "peak-speed", "late-deceleration", "settle", "after"];

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

export async function validateRenderedCandidateReceipt(projectPath, receipt) {
  const project = path.resolve(projectPath);
  const errors = [];
  if (receipt?.schema_version !== SUBSCRIPTION_CANDIDATE_RECEIPT_VERSION) errors.push(`candidate receipt schema_version must be ${SUBSCRIPTION_CANDIDATE_RECEIPT_VERSION}`);
  const candidates = Array.isArray(receipt?.candidates) ? receipt.candidates : [];
  const selectedId = receipt?.selected_candidate_id ?? receipt?.selected_id;
  if (candidates.length < 2) errors.push("candidate receipt requires at least two candidates");
  const ids = candidates.map((entry) => entry?.id).filter(Boolean);
  if (ids.length !== candidates.length || new Set(ids).size !== ids.length) errors.push("candidate IDs must be present and unique");
  if (!selectedId || !ids.includes(selectedId)) errors.push("selected candidate ID must reference a supplied candidate");
  const artifacts = [];
  for (const candidate of candidates) {
    const files = candidateArtifactFiles(candidate);
    if (!files.length) errors.push(`candidate ${candidate?.id ?? "(unknown)"} has no rendered pixel artifacts`);
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
  return { ok: errors.length === 0, errors, selected_id: selectedId ?? null, candidate_count: candidates.length, artifacts };
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
  const byId = new Map(entries.map((entry) => [entry?.evidence_id ?? entry?.id, entry]));
  const sources = new Set(entries.map((entry) => entry?.source));
  if (!sources.has("hyperframes")) errors.push("temporal evidence requires HyperFrames snapshot artifacts");
  if (!sources.has("encoded-draft")) errors.push("temporal evidence requires encoded-draft frame artifacts");
  for (const expected of schedule?.entries ?? []) {
    const entry = byId.get(expected.evidence_id);
    if (!entry) {
      errors.push(`temporal evidence is missing ${expected.evidence_id}`);
      continue;
    }
    if (entry.role !== expected.role) errors.push(`${expected.evidence_id} has the wrong role`);
    if (Math.abs(Number(entry.at_seconds) - expected.at_seconds) > .011) errors.push(`${expected.evidence_id} has the wrong timestamp`);
    if ((entry.boundary_id ?? null) !== expected.boundary_id) errors.push(`${expected.evidence_id} has the wrong boundary ID`);
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
  return { ok: errors.length === 0, errors, entry_count: entries.length, expected_count: schedule?.entries?.length ?? 0, video_sha256: videoHash };
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
