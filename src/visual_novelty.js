import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { semanticHash } from "./job_store.js";

export const VISUAL_NOVELTY_VERSION = "launchclip.visual-novelty.v1";
export const VISUAL_FINGERPRINT_VERSION = "launchclip.visual-fingerprint.v1";
export const VISUAL_NOVELTY_CONTEXT_PATH = "production/plans/visual-novelty.json";
export const VISUAL_FINGERPRINT_PATH = "production/plans/visual-fingerprint.json";

const DEFAULT_HISTORY_LIMIT = 8;
const DEFAULT_SIMILARITY_LIMIT = 0.58;

export function deriveCreativeInputSignature(intake, evidence, suppliedNarration = null) {
  return semanticHash({
    version: VISUAL_NOVELTY_VERSION,
    source_kind: intake.source?.kind ?? null,
    prompt: intake.brief?.prompt ?? null,
    audience: intake.brief?.audience ?? null,
    language: intake.brief?.language ?? null,
    style: intake.brief?.style ?? null,
    narration: suppliedNarration?.transcript ?? null,
    evidence: (evidence.items ?? [])
      .filter((entry) => entry.claims_allowed && entry.role !== "reference")
      .map((entry) => ({ id: entry.id, sha256: entry.sha256 ?? null, content: entry.content ?? "" })),
    resources: (intake.resources ?? [])
      .filter((entry) => entry.role !== "reference")
      .map((entry) => ({ id: entry.id, role: entry.role, type: entry.type, sha256: entry.sha256 ?? null }))
  });
}

export async function loadVisualNoveltyContext(workspacePath, { intake, evidence, suppliedNarration = null, historyDir = null, historyLimit = DEFAULT_HISTORY_LIMIT, similarityLimit = DEFAULT_SIMILARITY_LIMIT } = {}) {
  const workspace = path.resolve(workspacePath);
  const inputSignature = deriveCreativeInputSignature(intake, evidence, suppliedNarration);
  const contextPath = path.join(workspace, VISUAL_NOVELTY_CONTEXT_PATH);
  const existing = await readJsonIfPresent(contextPath);
  if (existing?.schema_version === VISUAL_NOVELTY_VERSION && existing.input_signature === inputSignature) return existing;

  const history = await readVisualHistory(workspace, historyDir, historyLimit);
  const exact = history.find((entry) => entry.input_signature === inputSignature) ?? null;
  const recent = exact ? [] : history.filter((entry) => entry.input_signature !== inputSignature).slice(0, historyLimit);
  const context = {
    schema_version: VISUAL_NOVELTY_VERSION,
    input_signature: inputSignature,
    creative_seed: semanticHash({ namespace: VISUAL_NOVELTY_VERSION, input_signature: inputSignature }).slice(0, 16),
    mode: exact ? "reproduce" : "differentiate",
    stable_design_system: true,
    similarity_limit: Number(similarityLimit),
    requirements: exact
      ? [
          "Preserve the prior episode concept and visual fingerprint because the script, brand, and source inputs match exactly.",
          "Use the creative seed as a stable tie-breaker whenever more than one treatment is equally appropriate."
        ]
      : [
          "Invent one content-specific governing metaphor before selecting representations or components.",
          "Keep brand DNA stable, but differ from recent videos across at least four axes: episode metaphor, representation sequence, spatial topology, motion vocabulary, transition vocabulary, and presenter rhythm.",
          "Choose each visualization from the meaning of the narration; do not rotate components arbitrarily for novelty.",
          "Treat components as primitives for an original visual world, never as finished scene templates.",
          "Use the creative seed only as a stable tie-breaker between equally truthful creative directions."
        ],
    reproduce_from: exact ? compactFingerprint(exact) : null,
    avoid_recent: recent.map(compactFingerprint)
  };
  await writeAtomic(contextPath, `${JSON.stringify(context, null, 2)}\n`);
  return context;
}

export function fingerprintProductionPlan(plan, inputSignature, noveltyContext = null) {
  const shots = plan.shots ?? [];
  const fingerprint = {
    schema_version: VISUAL_FINGERPRINT_VERSION,
    input_signature: inputSignature,
    creative_seed: noveltyContext?.creative_seed ?? null,
    episode_concept: clip(plan.design?.concept),
    style_family: clip(plan.design?.style_dna?.family),
    representations: unique(shots.map((shot) => shot.visual?.representation)),
    visual_concepts: unique(shots.map((shot) => shot.visual?.concept).map(clip)),
    spatial_worlds: unique(shots.map((shot) => shot.visual?.world).map(clip)),
    composition_patterns: unique(shots.map((shot) => shot.visual?.composition).map(clip)),
    object_kinds: unique(shots.flatMap((shot) => (shot.visual?.objects ?? []).map((object) => object.kind))),
    motion_verbs: unique(shots.flatMap((shot) => (shot.visual?.events ?? []).map((event) => event.motion_verb).map(clip))),
    visible_changes: unique(shots.flatMap((shot) => (shot.visual?.events ?? []).map((event) => event.visible_change))),
    transition_vocabulary: unique([...(plan.design?.style_dna?.transition_vocabulary ?? []), ...shots.map((shot) => shot.transition_out)].map(clip)),
    presenter_rhythm: shots.map((shot) => shot.presenter?.mode).filter(Boolean)
  };
  fingerprint.signature = semanticHash(fingerprint);
  return fingerprint;
}

export async function writeVisualFingerprint(workspacePath, plan, noveltyContext) {
  const workspace = path.resolve(workspacePath);
  const fingerprint = fingerprintProductionPlan(plan, noveltyContext.input_signature, noveltyContext);
  const comparisons = (noveltyContext.avoid_recent ?? [])
    .map((entry) => ({ signature: entry.signature, similarity: compareVisualFingerprints(fingerprint, entry) }))
    .sort((a, b) => b.similarity - a.similarity);
  const nearest = comparisons[0] ?? null;
  const artifact = {
    ...fingerprint,
    novelty_assessment: {
      mode: noveltyContext.mode,
      similarity_limit: noveltyContext.similarity_limit,
      nearest_recent_signature: nearest?.signature ?? null,
      nearest_recent_similarity: nearest?.similarity ?? null,
      passes: noveltyContext.mode === "reproduce" || !nearest || nearest.similarity <= noveltyContext.similarity_limit
    },
    created_at: new Date().toISOString()
  };
  const outputPath = path.join(workspace, VISUAL_FINGERPRINT_PATH);
  await writeAtomic(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  return outputPath;
}

export function compareVisualFingerprints(left, right) {
  const weighted = [
    [0.2, tokenSimilarity([left.episode_concept], [right.episode_concept])],
    [0.15, setSimilarity(left.representations, right.representations)],
    [0.1, setSimilarity(left.object_kinds, right.object_kinds)],
    [0.15, tokenSimilarity(left.motion_verbs, right.motion_verbs)],
    [0.15, tokenSimilarity(left.transition_vocabulary, right.transition_vocabulary)],
    [0.1, sequenceSimilarity(left.presenter_rhythm, right.presenter_rhythm)],
    [0.15, tokenSimilarity(left.visual_concepts, right.visual_concepts)]
  ];
  return round(weighted.reduce((total, [weight, score]) => total + weight * score, 0));
}

async function readVisualHistory(workspace, explicitHistoryDir, historyLimit) {
  const historyRoot = explicitHistoryDir
    ? path.resolve(explicitHistoryDir)
    : path.basename(path.dirname(workspace)) === ".launchclip"
      ? path.dirname(workspace)
      : null;
  if (!historyRoot) return [];
  let entries;
  try {
    entries = await readdir(historyRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const fingerprints = await Promise.all(entries
    .filter((entry) => entry.isDirectory() && path.resolve(historyRoot, entry.name) !== workspace)
    .map((entry) => readJsonIfPresent(path.join(historyRoot, entry.name, VISUAL_FINGERPRINT_PATH))));
  return fingerprints
    .filter((entry) => entry?.schema_version === VISUAL_FINGERPRINT_VERSION)
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
    .slice(0, Math.max(0, Number(historyLimit) || DEFAULT_HISTORY_LIMIT));
}

function compactFingerprint(fingerprint) {
  return {
    signature: fingerprint.signature,
    input_signature: fingerprint.input_signature,
    episode_concept: fingerprint.episode_concept,
    style_family: fingerprint.style_family,
    representations: fingerprint.representations ?? [],
    visual_concepts: fingerprint.visual_concepts ?? [],
    spatial_worlds: fingerprint.spatial_worlds ?? [],
    composition_patterns: fingerprint.composition_patterns ?? [],
    object_kinds: fingerprint.object_kinds ?? [],
    motion_verbs: fingerprint.motion_verbs ?? [],
    transition_vocabulary: fingerprint.transition_vocabulary ?? [],
    presenter_rhythm: fingerprint.presenter_rhythm ?? []
  };
}

function tokenSimilarity(left = [], right = []) {
  return setSimilarity(tokenize(left), tokenize(right));
}

function tokenize(values) {
  return unique((values ?? []).flatMap((value) => String(value ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? []));
}

function setSimilarity(left = [], right = []) {
  const a = new Set((left ?? []).filter(Boolean).map(String));
  const b = new Set((right ?? []).filter(Boolean).map(String));
  if (!a.size && !b.size) return 1;
  const intersection = [...a].filter((value) => b.has(value)).length;
  return intersection / new Set([...a, ...b]).size;
}

function sequenceSimilarity(left = [], right = []) {
  const length = Math.max(left.length, right.length);
  if (!length) return 1;
  let matches = 0;
  for (let index = 0; index < length; index += 1) if (left[index] === right[index]) matches += 1;
  return matches / length;
}

function unique(values, limit = 16) {
  return [...new Set((values ?? []).filter(Boolean).map(String))].slice(0, limit);
}

function clip(value, limit = 240) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, limit) : null;
}

function round(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    return null;
  }
}

async function writeAtomic(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, content);
  await rename(tempPath, filePath);
}
