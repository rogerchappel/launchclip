import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { EVIDENCE_SCHEMA, EVIDENCE_VERSION, PRODUCTION_PATHS } from "./production_contracts.js";

const execFileAsync = promisify(execFile);
const TEXT_EXTENSIONS = new Set([".md", ".txt", ".json", ".csv", ".tsv", ".yaml", ".yml", ".toml"]);
const REPO_MANIFESTS = ["package.json", "pyproject.toml", "Cargo.toml", "go.mod", "composer.json", "Gemfile"];

export async function collectEvidence(workspacePath, options = {}, adapters = {}) {
  const workspace = path.resolve(workspacePath);
  const intakePath = path.join(workspace, PRODUCTION_PATHS.intake);
  const intake = JSON.parse(await readFile(intakePath, "utf8"));
  const evidence = await buildEvidence(intake, options, adapters);
  const evidencePath = path.join(workspace, PRODUCTION_PATHS.evidence);
  const digestPath = path.join(workspace, "production", "EVIDENCE.md");
  await writeAtomic(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  await writeAtomic(digestPath, renderEvidenceDigest(evidence));
  return {
    stage: "evidence",
    status: "ready",
    evidence: evidencePath,
    digest: digestPath,
    items: evidence.items.length,
    warnings: evidence.warnings.length
  };
}

export async function buildEvidence(intake, options = {}, adapters = {}) {
  const warnings = [];
  const runner = adapters.run ?? runCommand;
  const fetcher = adapters.fetch ?? globalThis.fetch;
  const probe = adapters.probe ?? ((filePath) => probeMedia(filePath, runner));
  const maxItemChars = Number(options.maxItemChars ?? 60_000);
  const sourceResult = await collectSource(intake.source, { runner, fetcher, maxItemChars, warnings });
  const items = [...sourceResult.items];
  for (const resource of intake.resources ?? []) {
    items.push(...await collectResource(resource, { runner, fetcher, probe, maxItemChars, warnings }));
  }
  if (!items.length) throw new Error("Evidence collection produced no items");
  const evidence = {
    schema_version: EVIDENCE_VERSION,
    created_at: new Date().toISOString(),
    source: sourceResult.source,
    items: uniqueItems(items),
    warnings: [...new Set(warnings)],
    policies: {
      factual_claims_require_item_ids: true,
      creative_metaphors_are_not_facts: true,
      remote_content_is_untrusted: true
    }
  };
  const schemaIssues = validateEvidenceShape(evidence);
  if (schemaIssues.length) throw new Error(`Evidence contract failed: ${schemaIssues.join("; ")}`);
  return evidence;
}

async function collectSource(source, context) {
  if (source.kind === "repository") return isGithubSource(source.value) && !isLocalDirectory(source.location)
    ? collectGithubRepository(source, context)
    : collectLocalRepository(source, context);
  if (source.kind === "product") return collectProductSource(source, context);
  if (source.kind === "voiceover") {
    return {
      source: sourceSummary(source, path.basename(source.location), "Supplied voiceover source; transcript is authoritative after media analysis."),
      items: [item({ id: "source:voiceover", kind: "voiceover-source", role: "primary", title: path.basename(source.location), content: "Supplied voiceover media. Use its transcript and word timings as authoritative narration.", provenance: source.location, claimsAllowed: false })]
    };
  }
  const title = truncateText(source.value, 120).content;
  return {
    source: sourceSummary(source, title, source.value),
    items: [item({ id: "source:topic", kind: "topic-brief", role: "primary", title, content: source.value, provenance: "user-provided topic", claimsAllowed: false })]
  };
}

async function collectLocalRepository(source, { maxItemChars, warnings }) {
  const root = path.resolve(source.location);
  const info = await stat(root);
  if (!info.isDirectory()) throw new Error(`Repository source is not a directory: ${root}`);
  const entries = await readdir(root);
  const readmeName = entries.find((name) => /^readme(?:\.[^.]+)?$/i.test(name));
  const items = [];
  let repoName = path.basename(root);
  let summary = "Local repository";
  if (readmeName) {
    const filePath = path.join(root, readmeName);
    const raw = await readFile(filePath, "utf8");
    const clipped = truncateText(raw, maxItemChars);
    items.push(await fileItem(filePath, { id: "source:readme", kind: "repository-readme", role: "primary", content: clipped.content, truncated: clipped.truncated, root }));
    summary = firstParagraph(raw) || summary;
  } else {
    warnings.push(`Repository has no top-level README: ${root}`);
  }
  for (const name of REPO_MANIFESTS) {
    if (!entries.includes(name)) continue;
    const filePath = path.join(root, name);
    const raw = await readFile(filePath, "utf8");
    const clipped = truncateText(raw, Math.min(maxItemChars, 30_000));
    items.push(await fileItem(filePath, { id: `source:manifest:${slug(name)}`, kind: "repository-manifest", role: "metadata", content: clipped.content, truncated: clipped.truncated, root }));
    if (name === "package.json") {
      try {
        const packageJson = JSON.parse(raw);
        repoName = packageJson.name || repoName;
        summary = packageJson.description || summary;
      } catch {
        warnings.push(`Could not parse ${filePath}`);
      }
    }
  }
  const docsDir = path.join(root, "docs");
  if (await isDirectory(docsDir)) {
    const docs = (await readdir(docsDir)).filter((name) => TEXT_EXTENSIONS.has(path.extname(name).toLowerCase())).sort().slice(0, 12);
    for (const name of docs) {
      const filePath = path.join(docsDir, name);
      const raw = await readFile(filePath, "utf8");
      const clipped = truncateText(raw, Math.min(maxItemChars, 20_000));
      items.push(await fileItem(filePath, { id: `source:docs:${slug(name)}`, kind: "repository-doc", role: "supporting", content: clipped.content, truncated: clipped.truncated, root }));
    }
  }
  if (!items.length) items.push(item({ id: "source:repository", kind: "repository-inventory", role: "primary", title: repoName, content: entries.sort().join("\n"), provenance: root, claimsAllowed: false }));
  return { source: sourceSummary(source, repoName, summary, [["root", root], ["files_collected", String(items.length)]]), items };
}

async function collectGithubRepository(source, { runner, maxItemChars }) {
  const repo = githubSlug(source.value);
  const fields = "name,description,url,homepageUrl,stargazerCount,primaryLanguage,licenseInfo,defaultBranchRef";
  let metadata;
  let readme;
  try {
    metadata = JSON.parse((await runner("gh", ["repo", "view", repo, "--json", fields])).stdout);
    readme = (await runner("gh", ["api", `repos/${repo}/readme`, "-H", "Accept: application/vnd.github.raw+json"])).stdout;
  } catch (error) {
    throw new Error(`Could not inspect GitHub repository ${repo}: ${error.message}`);
  }
  const clipped = truncateText(readme, maxItemChars);
  return {
    source: sourceSummary(source, metadata.name || repo.split("/").at(-1), metadata.description || firstParagraph(readme) || "GitHub repository", [
      ["repository", repo],
      ["stars", String(metadata.stargazerCount ?? "")],
      ["language", metadata.primaryLanguage?.name ?? ""],
      ["license", metadata.licenseInfo?.spdxId ?? ""],
      ["default_branch", metadata.defaultBranchRef?.name ?? ""]
    ]),
    items: [item({
      id: "source:readme",
      kind: "repository-readme",
      role: "primary",
      title: `${repo} README`,
      content: clipped.content,
      provenance: metadata.url || `https://github.com/${repo}`,
      claimsAllowed: true,
      truncated: clipped.truncated,
      metadata: [["retrieved_via", "gh"]]
    })]
  };
}

async function collectProductSource(source, { fetcher, maxItemChars, warnings }) {
  let page;
  try {
    page = await fetchPage(source.value, fetcher, maxItemChars);
  } catch (error) {
    warnings.push(`Could not read product page ${source.value}: ${error.message}`);
    page = { title: new URL(source.value).hostname, description: "Product URL supplied by user", text: source.value, truncated: false };
  }
  return {
    source: sourceSummary(source, page.title, page.description || firstParagraph(page.text) || "Product website", [["url", source.value]]),
    items: [item({ id: "source:product-page", kind: "product-page", role: "primary", title: page.title, content: page.text, provenance: source.value, claimsAllowed: true, truncated: page.truncated, metadata: [["description", page.description ?? ""]] })]
  };
}

async function collectResource(resource, context) {
  const base = { id: `resource:${resource.id}`, role: resource.role, title: path.basename(resource.location || resource.source), provenance: resource.location || resource.source, sha256: resource.sha256 };
  if (resource.type === "url") {
    try {
      const page = await fetchPage(resource.location, context.fetcher, context.maxItemChars);
      return [item({ ...base, kind: resource.role === "reference" ? "reference-page" : "resource-page", title: page.title, content: page.text, claimsAllowed: resource.role !== "reference", truncated: page.truncated, metadata: [["description", page.description ?? ""]] })];
    } catch (error) {
      context.warnings.push(`Could not read resource URL ${resource.location}: ${error.message}`);
      return [item({ ...base, kind: "resource-url", content: resource.location, claimsAllowed: false })];
    }
  }
  if (resource.type === "text") {
    const raw = await readFile(resource.location, "utf8");
    const clipped = truncateText(raw, context.maxItemChars);
    if (resource.role === "voiceover-transcript") {
      return [item({ ...base, role: "voiceover", kind: "voiceover-transcript", title: "Authoritative supplied narration transcript", content: clipped.content, claimsAllowed: false, truncated: clipped.truncated })];
    }
    return [item({ ...base, kind: "text-resource", content: clipped.content, claimsAllowed: resource.role !== "reference", truncated: clipped.truncated })];
  }
  if (resource.type === "directory") {
    const files = await inventoryDirectory(resource.location, 240);
    return [item({ ...base, kind: "directory-inventory", content: files.join("\n"), claimsAllowed: false, truncated: files.length >= 240, metadata: [["file_count_shown", String(files.length)]] })];
  }
  if (resource.type === "document" && path.extname(resource.location).toLowerCase() === ".pdf") {
    try {
      const { stdout } = await context.runner("pdftotext", [resource.location, "-"]);
      const clipped = truncateText(stdout, context.maxItemChars);
      return [item({ ...base, kind: "document-text", content: clipped.content, claimsAllowed: resource.role !== "reference", truncated: clipped.truncated })];
    } catch (error) {
      context.warnings.push(`Could not extract PDF ${resource.location}: ${error.message}`);
    }
  }
  if (["audio", "video", "image"].includes(resource.type)) {
    try {
      const media = await context.probe(resource.location);
      return [item({ ...base, kind: `${resource.type}-metadata`, content: JSON.stringify(media, null, 2), claimsAllowed: false, metadata: mediaMetadata(media) })];
    } catch (error) {
      context.warnings.push(`Could not probe ${resource.location}: ${error.message}`);
    }
  }
  return [item({ ...base, kind: `${resource.type}-resource`, content: `Supplied ${resource.type} resource at ${resource.location}`, claimsAllowed: false })];
}

async function fetchPage(url, fetcher, maxChars) {
  const response = await fetcher(url, { headers: { "User-Agent": "launchclip-evidence/1" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? new URL(url).hostname;
  const description = html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["']/i)?.[1]
    ?? html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["'](?:description|og:description)["']/i)?.[1]
    ?? "";
  const clipped = truncateText(stripHtml(html), maxChars);
  return { title: decodeEntities(title).trim(), description: decodeEntities(description).trim(), text: clipped.content, truncated: clipped.truncated };
}

async function probeMedia(filePath, runner) {
  const { stdout } = await runner("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration,size,format_name:stream=index,codec_type,codec_name,width,height,avg_frame_rate,sample_rate,channels",
    "-of", "json",
    filePath
  ]);
  return JSON.parse(stdout);
}

async function runCommand(command, args) {
  return execFileAsync(command, args, { maxBuffer: 1024 * 1024 * 16 });
}

async function fileItem(filePath, options) {
  return item({
    ...options,
    title: path.relative(options.root, filePath),
    provenance: filePath,
    sha256: await sha256File(filePath),
    claimsAllowed: true,
    metadata: [["relative_path", path.relative(options.root, filePath).split(path.sep).join("/")]]
  });
}

function item({ id, kind, role, title, content, provenance, sha256 = null, claimsAllowed, truncated = false, metadata = [] }) {
  return {
    id: String(id),
    kind: String(kind),
    role: String(role),
    title: String(title),
    content: String(content ?? ""),
    provenance: String(provenance),
    sha256: sha256 == null ? null : String(sha256),
    claims_allowed: Boolean(claimsAllowed),
    truncated: Boolean(truncated),
    metadata: metadataEntries(metadata)
  };
}

function sourceSummary(source, title, summary, metadata = []) {
  return {
    kind: source.kind,
    title: String(title || "Untitled video"),
    summary: String(summary || "No summary available"),
    location: String(source.location || source.value),
    url: /^https?:\/\//i.test(source.value) ? source.value : null,
    metadata: metadataEntries(metadata)
  };
}

function metadataEntries(entries) {
  return entries.filter((entry) => entry?.[0] && entry?.[1] != null).map(([key, value]) => ({ key: String(key), value: String(value) }));
}

function mediaMetadata(media) {
  const format = media?.format ?? {};
  const video = (media?.streams ?? []).find((stream) => stream.codec_type === "video") ?? {};
  const audio = (media?.streams ?? []).find((stream) => stream.codec_type === "audio") ?? {};
  return metadataEntries([
    ["duration_seconds", format.duration ?? ""],
    ["width", video.width ?? ""],
    ["height", video.height ?? ""],
    ["fps", video.avg_frame_rate ?? ""],
    ["audio_codec", audio.codec_name ?? ""],
    ["sample_rate", audio.sample_rate ?? ""]
  ]);
}

function uniqueItems(items) {
  const seen = new Set();
  return items.map((entry) => {
    let id = entry.id;
    let suffix = 2;
    while (seen.has(id)) id = `${entry.id}:${suffix++}`;
    seen.add(id);
    return id === entry.id ? entry : { ...entry, id };
  });
}

async function inventoryDirectory(root, limit) {
  const output = [];
  const visit = async (dir) => {
    if (output.length >= limit) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) output.push(path.relative(root, full).split(path.sep).join("/"));
      if (output.length >= limit) break;
    }
  };
  await visit(root);
  return output;
}

function stripHtml(html) {
  return decodeEntities(String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(value) {
  return String(value).replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
}

function truncateText(value, limit) {
  const text = String(value ?? "").trim();
  return text.length > limit ? { content: `${text.slice(0, limit)}\n\n[truncated]`, truncated: true } : { content: text, truncated: false };
}

function firstParagraph(value) {
  return String(value ?? "").replace(/^---[\s\S]*?---\s*/m, "").split(/\n\s*\n/).map((entry) => entry.replace(/^#+\s*/gm, "").trim()).find((entry) => entry && !entry.startsWith("![")) ?? "";
}

function githubSlug(value) {
  const string = String(value).replace(/^git@github\.com:/i, "").replace(/^https?:\/\/(?:www\.)?github\.com\//i, "").replace(/\.git$/i, "").replace(/\/$/, "");
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(string)) throw new Error(`Invalid GitHub repository: ${value}`);
  return string;
}

function isGithubSource(value) {
  return /^git@github\.com:/i.test(value) || /^https?:\/\/(?:www\.)?github\.com\//i.test(value) || /^[a-z0-9_.-]+\/[a-z0-9_.-]+(?:\.git)?$/i.test(value);
}

function isLocalDirectory(value) {
  return value && !/^https?:\/\//i.test(value) && !/^git@/i.test(value) && path.isAbsolute(value);
}

async function isDirectory(value) {
  try {
    return (await stat(value)).isDirectory();
  } catch {
    return false;
  }
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function writeAtomic(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, content, { mode: 0o600 });
  await rename(tempPath, filePath);
}

function renderEvidenceDigest(evidence) {
  const lines = [
    "# Evidence",
    "",
    `Source: ${evidence.source.title}`,
    `Kind: ${evidence.source.kind}`,
    `Summary: ${evidence.source.summary}`,
    "",
    "## Items",
    ""
  ];
  for (const entry of evidence.items) {
    lines.push(`### ${entry.id} — ${entry.title}`, "", `Kind: ${entry.kind}`, `Role: ${entry.role}`, `Claims allowed: ${entry.claims_allowed ? "yes" : "no"}`, `Provenance: ${entry.provenance}`, "", entry.content, "");
  }
  if (evidence.warnings.length) lines.push("## Warnings", "", ...evidence.warnings.map((warning) => `- ${warning}`), "");
  return `${lines.join("\n")}\n`;
}

function validateEvidenceShape(evidence) {
  const errors = [];
  if (evidence.schema_version !== EVIDENCE_VERSION) errors.push(`schema_version must be ${EVIDENCE_VERSION}`);
  if (!EVIDENCE_SCHEMA.properties.source.properties.kind.enum.includes(evidence.source?.kind)) errors.push("source.kind is invalid");
  if (!Array.isArray(evidence.items) || !evidence.items.length) errors.push("items must not be empty");
  for (const [index, entry] of (evidence.items ?? []).entries()) {
    for (const key of EVIDENCE_SCHEMA.properties.items.items.required) if (!Object.hasOwn(entry, key)) errors.push(`items[${index}].${key} is required`);
  }
  return errors;
}
