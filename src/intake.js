import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

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
  const sourceKind = inferSourceKind(value, flags.kind);
  const aspect = resolveAspect(flags.aspect ?? flags.ratio ?? "16:9");
  const durationSeconds = positiveNumber(flags.duration ?? 60, "--duration");
  const model = String(flags.model ?? env.OPENAI_VIDEO_MODEL ?? "gpt-5.6").trim();
  const reasoningEffort = resolveReasoningEffort(flags.reasoning ?? env.OPENAI_VIDEO_REASONING ?? "xhigh");
  const resources = [];
  if (sourceKind === "voiceover" && existsSync(path.resolve(value))) {
    resources.push(await describeResource(value, "voiceover", resources.length));
  }
  for (const [role, entries] of [
    ["supporting", values(flags.resource)],
    ["reference", values(flags.reference)],
    ["voiceover", values(flags.voiceover)],
    ["voiceover-transcript", values(flags.transcript)],
    ["presenter", values(flags.presenter)]
  ]) {
    for (const entry of entries) {
      const described = await describeResource(entry, role, resources.length);
      if (!resources.some((resource) => resource.role === described.role && resource.location === described.location)) resources.push(described);
    }
  }
  const slug = sourceSlug(value, sourceKind);
  const workspace = path.resolve(flags.out ?? path.join(".launchclip", slug));
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
      aspect
    },
    model: {
      provider: "openai",
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
