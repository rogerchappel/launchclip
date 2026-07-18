import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveStylePack } from "./style_store.js";

export const INTAKE_SCHEMA_VERSION = "launchclip.intake.v1";

const SOURCE_KIND_ALIASES = new Map([
  ["repo", "repository"],
  ["repository", "repository"],
  ["github", "repository"],
  ["product", "product"],
  ["saas", "product"],
  ["website", "product"],
  ["topic", "topic"],
  ["research", "topic"],
  ["paper", "topic"],
  ["voice", "voiceover"],
  ["voiceover", "voiceover"],
  ["audio", "voiceover"]
]);

const ASPECTS = new Map([
  ["9:16", { id: "9:16", width: 1080, height: 1920, orientation: "portrait" }],
  ["portrait", { id: "9:16", width: 1080, height: 1920, orientation: "portrait" }],
  ["vertical", { id: "9:16", width: 1080, height: 1920, orientation: "portrait" }],
  ["16:9", { id: "16:9", width: 1920, height: 1080, orientation: "landscape" }],
  ["landscape", { id: "16:9", width: 1920, height: 1080, orientation: "landscape" }],
  ["horizontal", { id: "16:9", width: 1920, height: 1080, orientation: "landscape" }],
  ["1:1", { id: "1:1", width: 1080, height: 1080, orientation: "square" }],
  ["square", { id: "1:1", width: 1080, height: 1080, orientation: "square" }]
]);

const RESOURCE_EXTENSIONS = new Map([
  [".png", "image"], [".jpg", "image"], [".jpeg", "image"], [".webp", "image"], [".gif", "image"], [".svg", "image"],
  [".mp4", "video"], [".mov", "video"], [".webm", "video"], [".mkv", "video"],
  [".mp3", "audio"], [".wav", "audio"], [".m4a", "audio"], [".aac", "audio"], [".aiff", "audio"], [".flac", "audio"],
  [".pdf", "document"], [".docx", "document"], [".pptx", "document"],
  [".md", "text"], [".txt", "text"], [".json", "text"], [".csv", "text"], [".tsv", "text"]
]);

export async function writeIntake(source, flags = {}, env = process.env) {
  const intake = await buildIntake(source, flags, env);
  return writeIntakeManifest(intake);
}

export async function writeIntakeManifest(intake) {
  const workspace = intake.workspace;
  const productionDir = path.join(workspace, "production");
  await mkdir(productionDir, { recursive: true });
  const intakePath = path.join(productionDir, "intake.json");
  await writeFile(intakePath, `${JSON.stringify(intake, null, 2)}\n`);
  return {
    stage: "intake",
    status: "ready",
    kind: intake.source.kind,
    workspace,
    intake: intakePath,
    resources: intake.resources.length
  };
}

export async function buildIntake(source, flags = {}, env = process.env) {
  const value = String(source ?? "").trim();
  if (!value) throw new Error("Missing source");
  const heygenAvatar = resolveHeygenAvatarFlag(flags);
  const sourceKind = inferSourceKind(value, flags.kind);
  const aspect = resolveAspect(flags.aspect ?? flags.ratio ?? "16:9");
  const durationSeconds = positiveNumber(flags.duration ?? 60, "--duration");
  const modelPolicy = resolveModelPolicy(flags["model-policy"] ?? "cost-aware");
  const modelProvider = modelPolicy === "free" ? "openrouter" : "openai";
  const model = String(flags.model ?? (modelPolicy === "free" ? "openrouter/free" : env.OPENAI_VIDEO_MODEL ?? (modelPolicy === "quality" ? "gpt-5.6" : "gpt-5.6-terra"))).trim();
  const reasoningEffort = resolveReasoningEffort(flags.reasoning ?? (modelPolicy === "free" ? "none" : env.OPENAI_VIDEO_REASONING ?? (modelPolicy === "quality" ? "xhigh" : "high")));
  const resources = [];
  if (sourceKind === "voiceover" && existsSync(path.resolve(value))) {
    resources.push(...await describeResourceEntries(value, "voiceover", resources.length));
  }
  if (sourceKind === "topic" && existsSync(path.resolve(value))) {
    const type = RESOURCE_EXTENSIONS.get(path.extname(path.resolve(value)).toLowerCase());
    if (type === "document" || type === "text") resources.push(...await describeResourceEntries(value, "supporting", resources.length));
  }
  for (const [role, entries] of [
    ["supporting", [...values(flags.resource), ...values(flags.assets)]],
    ["reference", values(flags.reference)],
    ["voiceover", heygenAvatar ? [heygenAvatar] : values(flags.voiceover)],
    ["voiceover-transcript", values(flags.transcript)],
    ["presenter", heygenAvatar ? [heygenAvatar] : values(flags.presenter)]
  ]) {
    for (const entry of entries) {
      for (const described of await describeResourceEntries(entry, role, resources.length)) {
        if (!resources.some((resource) => resource.role === described.role && resource.location === described.location)) resources.push(described);
      }
    }
  }
  if (heygenAvatar) {
    const avatarResources = resources.filter((entry) => entry.source === heygenAvatar && ["voiceover", "presenter"].includes(entry.role));
    if (avatarResources.length !== 2 || avatarResources.some((entry) => entry.is_remote || entry.type !== "video")) {
      throw new Error("--heygen-avatar must be one local video file (.mp4, .mov, .webm, or .mkv)");
    }
  }
  const videoVoiceover = resources.find((entry) => entry.role === "voiceover" && entry.type === "video");
  if (videoVoiceover && !resources.some((entry) => entry.role === "presenter" && entry.location === videoVoiceover.location)) {
    resources.push({ ...videoVoiceover, id: resourceId(videoVoiceover.location, resources.length), role: "presenter", source: videoVoiceover.source });
  }
  const slug = sourceSlug(value, sourceKind);
  const workspace = path.resolve(flags.out ?? path.join(".launchclip", slug));
  const style = await describeStyle(flags);
  return {
    schema_version: INTAKE_SCHEMA_VERSION,
    created_at: new Date().toISOString(),
    workspace,
    source: {
      kind: sourceKind,
      value,
      location: localLocation(value),
      is_remote: isUrl(value) || isGithubShorthand(value)
    },
    brief: {
      prompt: nullableString(flags.prompt ?? flags.angle),
      audience: nullableString(flags.audience),
      cta: nullableString(flags.cta ?? flags["cta-url"]),
      language: String(flags.language ?? "en"),
      duration_seconds: durationSeconds,
      aspect,
      style
    },
    model: {
      provider: modelProvider,
      id: model,
      reasoning_effort: reasoningEffort,
      reasoning_mode: flags.pro ? "pro" : "standard"
    },
    resources,
    policies: {
      evidence_required_for_factual_claims: true,
      supplied_voiceover_is_authoritative: resources.some((entry) => entry.role === "voiceover"),
      presenter_requires_authorized_likeness: resources.some((entry) => entry.role === "presenter"),
      final_render_requires_human_approval: true,
      external_publish_allowed: false
    }
  };
}

function resolveHeygenAvatarFlag(flags) {
  const entries = values(flags["heygen-avatar"]).map((entry) => String(entry ?? "").trim()).filter(Boolean);
  if (entries.length > 1) throw new Error("--heygen-avatar accepts exactly one generated avatar video");
  if (!entries.length) return null;
  if (values(flags.voiceover).length || values(flags.presenter).length) {
    throw new Error("--heygen-avatar replaces --voiceover and --presenter; do not combine them");
  }
  return entries[0];
}

async function describeResourceEntries(value, role, startIndex) {
  const described = await describeResource(value, role, startIndex);
  if (described.type !== "directory") return [{ ...described, catalog: resourceCatalog(described.location, null, null) }];
  const files = await walkResourceDirectory(described.location);
  if (!files.length) throw new Error(`Resource directory contains no files: ${described.location}`);
  if (files.length > 512) throw new Error(`Resource directory exceeds the 512-file intake limit: ${described.location}`);
  const manifestPath = files.find((filePath) => path.relative(described.location, filePath).split(path.sep).join("/").toLowerCase() === "assets.json");
  const manifest = manifestPath ? await readAssetManifest(manifestPath) : null;
  const assets = files.filter((filePath) => filePath !== manifestPath);
  if (!assets.length) throw new Error(`Resource directory contains no media assets: ${described.location}`);
  return Promise.all(assets.map(async (filePath, index) => ({
    ...await describeResource(filePath, role, startIndex + index),
    catalog: resourceCatalog(filePath, described.location, manifest)
  })));
}

async function describeStyle(flags) {
  const requestedFamily = nullableString(flags.style) ?? "auto";
  const file = nullableString(flags["style-file"]);
  const reference = nullableString(flags["style-reference"]);
  if (file) {
    const location = path.resolve(file);
    if (!existsSync(location)) throw new Error(`Style file does not exist: ${file}`);
    return { family: requestedFamily === "auto" ? "custom" : requestedFamily, source: "file", specification: await readFile(location, "utf8"), specification_path: location, reference };
  }
  const pack = await resolveStylePack(requestedFamily, { root: flags["style-root"] });
  if (pack) {
    return { family: pack.name, source: "file", specification: pack.specification, specification_path: pack.specification_path, reference, pack_path: pack.path };
  }
  if (reference) return { family: requestedFamily, source: "reference", specification: null, specification_path: null, reference: localLocation(reference) };
  return { family: requestedFamily, source: requestedFamily === "auto" ? "auto" : "preset", specification: null, specification_path: null, reference: null };
}

async function readAssetManifest(filePath) {
  let manifest;
  try { manifest = JSON.parse(await readFile(filePath, "utf8")); }
  catch (error) { throw new Error(`Invalid asset manifest ${filePath}: ${error.message}`); }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error(`Asset manifest must be a JSON object: ${filePath}`);
  if (manifest.assets != null && (typeof manifest.assets !== "object" || Array.isArray(manifest.assets))) throw new Error(`Asset manifest assets must be a path-keyed object: ${filePath}`);
  return manifest;
}

function resourceCatalog(location, collectionRoot, manifest) {
  if (/^https?:\/\//i.test(String(location))) {
    return { collection: null, relative_path: null, usage: "remote-reference", entity_hints: filenameTokens(new URL(location).pathname), tags: [], priority: 50, license: null, source: "auto" };
  }
  const relativePath = collectionRoot ? path.relative(collectionRoot, location).split(path.sep).join("/") : path.basename(location);
  const override = manifest?.assets?.[relativePath] ?? {};
  const tokens = filenameTokens(relativePath);
  const usage = String(override.usage ?? inferAssetUsage(relativePath));
  return {
    collection: collectionRoot ? path.basename(collectionRoot) : null,
    relative_path: relativePath,
    usage,
    entity_hints: stringList(override.entities ?? override.entity_hints ?? tokens.filter((token) => !GENERIC_ASSET_TOKENS.has(token))),
    tags: stringList(override.tags ?? tokens),
    priority: Number.isFinite(Number(override.priority)) ? Number(override.priority) : 50,
    license: nullableString(override.license),
    source: Object.keys(override).length ? "manifest" : "auto"
  };
}

const GENERIC_ASSET_TOKENS = new Set(["asset", "assets", "brand", "brands", "image", "images", "logo", "logos", "icon", "icons", "screen", "screenshot", "screenshots", "clip", "clips", "video", "videos", "demo"]);

function inferAssetUsage(value) {
  const normalized = String(value).toLowerCase();
  if (/(?:^|\/)(?:logos?|marks?)(?:\/|$)|(?:^|[-_.])logo(?:[-_.]|$)/.test(normalized)) return "logo";
  if (/(?:screenshots?|captures?)/.test(normalized)) return "screenshot";
  if (/(?:^|\/)(?:icons?)(?:\/|$)|(?:^|[-_.])icon(?:[-_.]|$)/.test(normalized)) return "icon";
  if (/(?:demos?|product[-_ ]?clips?|recordings?)/.test(normalized)) return "product-demo";
  return "supporting";
}

function filenameTokens(value) {
  return [...new Set(String(value).toLowerCase().replace(/\.[a-z0-9]+$/i, "").split(/[^a-z0-9]+/).filter((token) => token.length > 1))];
}

function stringList(value) {
  const entries = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(entries.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean))];
}

async function walkResourceDirectory(root) {
  const files = [];
  const pending = [path.resolve(root)];
  while (pending.length) {
    const directory = pending.shift();
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const location = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(location);
      else if (entry.isFile()) files.push(location);
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

export function inferSourceKind(source, requestedKind = null) {
  if (requestedKind) {
    const normalized = SOURCE_KIND_ALIASES.get(String(requestedKind).trim().toLowerCase());
    if (!normalized) throw new Error(`Unsupported --kind: ${requestedKind}. Supported: repository, product, topic, voiceover`);
    return normalized;
  }
  if (isGithubSource(source)) return "repository";
  if (isUrl(source)) return "product";
  const resolved = path.resolve(source);
  if (existsSync(resolved)) {
    const extension = path.extname(resolved).toLowerCase();
    if ([".mp3", ".wav", ".m4a", ".aac", ".aiff", ".flac", ".mp4", ".mov", ".webm", ".mkv"].includes(extension)) return "voiceover";
    if (!extension || existsSync(path.join(resolved, ".git")) || existsSync(path.join(resolved, "README.md"))) return "repository";
  }
  return "topic";
}

export function resolveAspect(value) {
  const aspect = ASPECTS.get(String(value ?? "").trim().toLowerCase());
  if (!aspect) throw new Error(`Unsupported --aspect: ${value}. Supported: 9:16, 16:9, 1:1`);
  return { ...aspect };
}

export function resolveReasoningEffort(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!["none", "low", "medium", "high", "xhigh", "max"].includes(normalized)) {
    throw new Error(`Unsupported --reasoning: ${value}. Supported: none, low, medium, high, xhigh, max`);
  }
  return normalized;
}

export function resolveModelPolicy(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!["cost-aware", "local-first", "quality", "free"].includes(normalized)) {
    throw new Error(`Unsupported --model-policy: ${value}. Supported: cost-aware, local-first, quality, free`);
  }
  return normalized;
}

async function describeResource(value, role, index) {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error(`Empty --${role} resource`);
  if (isUrl(raw)) {
    return {
      id: resourceId(raw, index),
      role,
      type: "url",
      source: raw,
      location: raw,
      is_remote: true,
      size_bytes: null,
      sha256: null
    };
  }
  const location = path.resolve(raw);
  if (!existsSync(location)) throw new Error(`Resource does not exist: ${raw}`);
  const info = await stat(location);
  const type = info.isDirectory() ? "directory" : RESOURCE_EXTENSIONS.get(path.extname(location).toLowerCase()) ?? "asset";
  return {
    id: resourceId(location, index),
    role,
    type,
    source: raw,
    location,
    is_remote: false,
    size_bytes: info.isFile() ? info.size : null,
    sha256: info.isFile() ? await fileSha256(location) : null
  };
}

async function fileSha256(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function values(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function resourceId(value, index) {
  const pathname = isUrl(value) ? new URL(value).pathname : value;
  const base = path.basename(pathname, path.extname(pathname)) || `resource-${index + 1}`;
  return `${String(index + 1).padStart(2, "0")}-${slugify(base)}`;
}

function sourceSlug(value, kind) {
  if (isUrl(value)) {
    const url = new URL(value);
    const pathPart = url.pathname.split("/").filter(Boolean).at(-1)?.replace(/\.git$/i, "");
    return slugify(pathPart || url.hostname.replace(/^www\./, ""));
  }
  if (isGithubShorthand(value)) return slugify(value.split("/").at(-1));
  if (existsSync(path.resolve(value))) return slugify(path.basename(path.resolve(value), path.extname(value)));
  return slugify(value.split(/\s+/).slice(0, kind === "topic" ? 8 : 4).join("-"));
}

function slugify(value) {
  return String(value ?? "video")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "video";
}

function positiveNumber(value, flag) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${flag} must be a positive number`);
  return number;
}

function nullableString(value) {
  const result = String(value ?? "").trim();
  return result || null;
}

function localLocation(value) {
  return existsSync(path.resolve(value)) ? path.resolve(value) : value;
}

function isGithubSource(value) {
  return /^git@github\.com:/i.test(value) || /^https?:\/\/(?:www\.)?github\.com\//i.test(value) || isGithubShorthand(value);
}

function isGithubShorthand(value) {
  return /^[a-z0-9_.-]+\/[a-z0-9_.-]+(?:\.git)?$/i.test(String(value ?? ""));
}

function isUrl(value) {
  return /^https?:\/\//i.test(String(value ?? ""));
}
