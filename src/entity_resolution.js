import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const ENTITY_RESOLUTION_VERSION = "launchclip.entity-resolution.v1";
export const BRAND_LIBRARY_VERSION = "launchclip.brand-library.v1";

export function defaultBrandLibraryDir(env = process.env) {
  return path.resolve(env.LAUNCHCLIP_BRAND_ASSETS_DIR ?? path.join(os.homedir(), ".launchclip", "brand-assets"));
}

export async function resolveProductionEntities(workspacePath, options = {}) {
  const workspace = path.resolve(workspacePath);
  const productionDir = path.join(workspace, "production");
  const intakePath = path.join(productionDir, "intake.json");
  const evidencePath = path.join(productionDir, "evidence.json");
  const outputPath = path.join(productionDir, "entities.json");
  const [intake, evidence] = await Promise.all([readJson(intakePath), readJson(evidencePath)]);
  const libraryDir = path.resolve(options.brandAssetsDir ?? defaultBrandLibraryDir(options.env));
  const library = await readBrandLibrary(libraryDir);
  const transcriptItems = evidence.items.filter((entry) => entry.kind === "voiceover-transcript" || entry.kind === "media-transcript");
  const transcript = transcriptItems.map((entry) => entry.content).join("\n");
  const evidenceContext = evidence.items.map((entry) => `${entry.title}\n${entry.content}\n${entry.provenance}`).join("\n");
  const matches = [];

  for (const brand of library.brands) {
    const match = findBrandMention(transcript, brand, evidenceContext);
    if (!match) continue;
    const assets = await resolveBrandAssets(brand, libraryDir);
    matches.push({
      id: brand.id,
      canonical_name: brand.canonical_name,
      display_name: brand.display_name ?? brand.canonical_name,
      spoken_form: match.spoken_form,
      matched_alias: match.matched_alias,
      match_kind: match.match_kind,
      confidence: match.confidence,
      evidence_supported: match.evidence_supported,
      domains: brand.domains,
      assets
    });
  }

  const report = {
    schema_version: ENTITY_RESOLUTION_VERSION,
    stage: "entity-resolution",
    status: "ready",
    brand_library: { directory: libraryDir, manifest: library.manifest, available: library.available },
    transcript_present: Boolean(transcript.trim()),
    matches,
    unresolved: [],
    policies: {
      transcript_is_timestamp_evidence_not_display_copy: true,
      canonical_names_override_asr_for_display_copy: true,
      assets_require_local_frozen_files: true
    }
  };
  await addResolvedAssets(intake, matches);
  await writeAtomic(intakePath, `${JSON.stringify(intake, null, 2)}\n`);
  replaceEvidenceItem(evidence, report, outputPath);
  await writeAtomic(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  await writeAtomic(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  return { ...report, entities: outputPath, intake: intakePath, evidence: evidencePath };
}

export async function readBrandLibrary(directory = defaultBrandLibraryDir()) {
  const libraryDir = path.resolve(directory);
  const manifest = path.join(libraryDir, "brands.json");
  let value;
  try {
    value = await readJson(manifest);
  } catch (error) {
    if (error.code === "ENOENT") return { schema_version: BRAND_LIBRARY_VERSION, manifest, available: false, brands: [] };
    throw error;
  }
  if (value.schema_version !== BRAND_LIBRARY_VERSION || !Array.isArray(value.brands)) {
    throw new Error(`Brand library must use ${BRAND_LIBRARY_VERSION} with a brands array: ${manifest}`);
  }
  return {
    schema_version: value.schema_version,
    manifest,
    available: true,
    brands: value.brands.map(normalizeBrand)
  };
}

function normalizeBrand(value) {
  if (!value || typeof value !== "object" || !String(value.id ?? "").trim() || !String(value.canonical_name ?? "").trim()) {
    throw new Error("Each brand requires id and canonical_name");
  }
  return {
    id: slug(value.id),
    canonical_name: String(value.canonical_name).trim(),
    display_name: String(value.display_name ?? value.canonical_name).trim(),
    aliases: uniqueStrings(value.aliases),
    asr_aliases: uniqueStrings(value.asr_aliases),
    domains: uniqueStrings(value.domains).map((entry) => entry.toLowerCase()),
    assets: Array.isArray(value.assets) ? value.assets : []
  };
}

function findBrandMention(transcript, brand, evidenceContext) {
  const normalizedTranscript = normalizeText(transcript);
  if (!normalizedTranscript) return null;
  const candidates = [
    { value: brand.canonical_name, kind: "canonical" },
    { value: brand.display_name, kind: "alias" },
    ...brand.aliases.map((value) => ({ value, kind: "alias" })),
    ...brand.asr_aliases.map((value) => ({ value, kind: "asr-alias" }))
  ]
    .filter((entry, index, entries) => entries.findIndex((candidate) => normalizeText(candidate.value) === normalizeText(entry.value)) === index)
    .map((entry) => ({ ...entry, normalized: normalizeText(entry.value) }))
    .filter((entry) => entry.normalized.length >= 2)
    .sort((a, b) => b.normalized.length - a.normalized.length);
  for (const candidate of candidates) {
    const index = phraseIndex(normalizedTranscript, candidate.normalized);
    if (index < 0) continue;
    return {
      spoken_form: extractNormalizedPhrase(normalizedTranscript, index, candidate.normalized.length),
      matched_alias: candidate.value,
      match_kind: candidate.kind,
      confidence: candidate.kind === "canonical" ? 1 : 0.98,
      evidence_supported: evidenceSupports(brand, evidenceContext)
    };
  }

  const words = normalizedTranscript.split(" ");
  for (const candidate of candidates.filter((entry) => entry.normalized.length >= 5)) {
    const tokenCount = candidate.normalized.split(" ").length;
    for (let index = 0; index <= words.length - tokenCount; index += 1) {
      const spoken = words.slice(index, index + tokenCount).join(" ");
      const confidence = similarity(spoken, candidate.normalized);
      if (confidence < 0.78) continue;
      const supported = evidenceSupports(brand, evidenceContext);
      if (!supported) continue;
      return { spoken_form: spoken, matched_alias: candidate.value, match_kind: "fuzzy", confidence, evidence_supported: true };
    }
  }
  return null;
}

async function resolveBrandAssets(brand, libraryDir) {
  const assets = [];
  for (const value of brand.assets) {
    if (!value || typeof value !== "object" || !String(value.path ?? "").trim()) continue;
    const location = path.resolve(libraryDir, String(value.path));
    let info;
    try { info = await stat(location); }
    catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (!info.isFile()) continue;
    assets.push({
      id: `brand-${brand.id}-${slug(value.kind ?? "asset")}-${slug(value.variant ?? "default")}`,
      kind: String(value.kind ?? "logo"),
      variant: String(value.variant ?? "default"),
      location,
      source_url: value.source_url ? String(value.source_url) : null,
      license: value.license ? String(value.license) : null,
      size_bytes: info.size,
      sha256: await sha256File(location)
    });
  }
  return assets;
}

async function addResolvedAssets(intake, matches) {
  intake.resources = (intake.resources ?? []).filter((entry) => entry.source !== "brand-library");
  for (const entity of matches) {
    for (const asset of entity.assets) {
      intake.resources.push({
        id: asset.id,
        role: "supporting",
        type: mediaType(asset.location),
        source: "brand-library",
        location: asset.location,
        is_remote: false,
        size_bytes: asset.size_bytes,
        sha256: asset.sha256,
        catalog: {
          collection: "brand-assets",
          relative_path: path.basename(asset.location),
          usage: asset.kind,
          entity_hints: [entity.canonical_name.toLowerCase(), entity.id],
          tags: ["brand", asset.kind, asset.variant],
          priority: 100,
          license: asset.license,
          source: "brand-library"
        }
      });
    }
  }
}

function replaceEvidenceItem(evidence, report, outputPath) {
  const content = report.matches.map((entry) => {
    const logo = entry.assets.find((asset) => asset.kind === "logo");
    return `${entry.spoken_form} => ${entry.display_name}${logo ? ` (logo resource ${logo.id})` : ""}`;
  }).join("\n") || "No canonical entities were resolved from the local brand library.";
  const item = {
    id: "canonical-entities",
    kind: "entity-resolution",
    role: "supporting",
    title: "Canonical entity names and local brand assets",
    content,
    provenance: outputPath,
    sha256: null,
    claims_allowed: false,
    truncated: false,
    metadata: [
      { key: "brand_library", value: report.brand_library.directory },
      { key: "match_count", value: String(report.matches.length) }
    ]
  };
  evidence.items = [...evidence.items.filter((entry) => entry.id !== item.id), item];
}

function evidenceSupports(brand, evidenceContext) {
  const normalized = normalizeText(evidenceContext);
  if ([brand.canonical_name, brand.display_name, ...brand.aliases, ...brand.asr_aliases].some((value) => phraseIndex(normalized, normalizeText(value)) >= 0)) return true;
  const lower = String(evidenceContext).toLowerCase();
  return brand.domains.some((domain) => lower.includes(domain));
}

function phraseIndex(haystack, needle) {
  if (!needle) return -1;
  const index = ` ${haystack} `.indexOf(` ${needle} `);
  return index < 0 ? -1 : Math.max(0, index - 1);
}

function extractNormalizedPhrase(text, index, length) {
  return text.slice(Math.max(0, index), Math.max(0, index) + length).trim();
}

function normalizeText(value) {
  return String(value ?? "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function similarity(left, right) {
  const distance = levenshtein(left, right);
  return 1 - distance / Math.max(left.length, right.length, 1);
}

function levenshtein(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1)
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function mediaType(location) {
  return path.extname(location).toLowerCase() === ".svg" ? "image" : "image";
}

function uniqueStrings(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(values.map((entry) => String(entry).trim()).filter(Boolean))];
}

function slug(value) {
  return String(value ?? "asset").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "asset";
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeAtomic(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, content, { mode: 0o600 });
  await rename(temp, filePath);
}
