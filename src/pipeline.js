import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function initWorkspace(repoPath, flags = {}) {
  const repo = path.resolve(repoPath);
  const out = path.resolve(flags.out ?? defaultWorkspace(repo));
  const facts = await inspectRepo(repo);
  await ensureDirs(out, ["demo", "video", "captions", "review"]);
  const manifest = {
    schema_version: "launchclip.v1",
    created_at: new Date().toISOString(),
    source_repo: facts,
    workspace: out,
    safety: {
      dry_run_default: true,
      direct_social_posting: false,
      external_writes_require: ["explicit config", "human approval", "--submit"]
    },
    stages: {}
  };
  await writeJson(path.join(out, "launchclip.json"), manifest);
  return { stage: "init", workspace: out, repo: facts.name };
}

export async function runDemo(repoPath, flags = {}) {
  const repo = path.resolve(repoPath);
  const out = path.resolve(required(flags.out, "--out"));
  await ensureDirs(out, ["demo"]);
  const command = required(flags["demo-cmd"], "--demo-cmd");
  const startedAt = new Date().toISOString();
  const shell = process.env.SHELL || "/bin/sh";
  const receiptPath = path.join(out, "demo", "command-receipt.json");
  const terminalPath = path.join(out, "demo", "terminal.txt");
  let status = "passed";
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  try {
    const result = await execFileAsync(shell, ["-lc", command], {
      cwd: repo,
      timeout: Number(flags.timeout ?? 30000),
      maxBuffer: 1024 * 1024
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    status = "failed";
    stdout = error.stdout ?? "";
    stderr = error.stderr ?? error.message;
    exitCode = error.code ?? 1;
  }
  const terminal = [`$ ${command}`, stdout.trimEnd(), stderr.trimEnd()].filter(Boolean).join("\n\n");
  await writeFile(terminalPath, `${terminal}\n`);
  const receipt = {
    command,
    capture: flags.capture ?? "terminal",
    cwd: repo,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    status,
    exit_code: exitCode,
    artifacts: [{ type: "terminal", path: rel(out, terminalPath) }]
  };
  await writeJson(receiptPath, receipt);
  await updateManifest(out, (manifest) => {
    manifest.stages.demo = { status, receipt: "demo/command-receipt.json" };
  });
  if (status !== "passed") {
    throw new Error(`Demo command failed with exit code ${exitCode}; receipt written to ${receiptPath}`);
  }
  return { stage: "demo", status, terminal: terminalPath, receipt: receiptPath };
}

export async function planVideo(workspacePath, flags = {}) {
  const out = path.resolve(workspacePath);
  const manifest = await readJson(path.join(out, "launchclip.json"));
  const format = flags.format ?? "short-30";
  const duration = format === "short-15" ? 15 : 30;
  const video = {
    schema_version: "video-skillkit.compat.v1",
    title: `${manifest.source_repo.name} OSS launch clip`,
    format,
    duration_seconds: duration,
    source: "launchclip",
    structure: [
      { beat: "hook", seconds: 4, instruction: `Open with the concrete problem ${manifest.source_repo.name} solves.` },
      { beat: "proof", seconds: 12, instruction: "Show the captured demo command and terminal result as evidence." },
      { beat: "payoff", seconds: 9, instruction: "Summarize the useful outcome without unsupported claims." },
      { beat: "cta", seconds: 5, instruction: "Point viewers to the GitHub repo and README quickstart." }
    ],
    evidence: ["demo/terminal.txt", "demo/command-receipt.json"],
    renderer: flags.renderer ?? "none"
  };
  const brief = `# ${manifest.source_repo.name} Short-Form Brief

Format: ${format}
Renderer: ${video.renderer}

## Angle
Turn a working local demo into proof that the OSS tool is real and easy to try.

## Beats
- Hook: name the painful manual workflow.
- Proof: show the demo command and captured output.
- Payoff: explain what changed after the command.
- CTA: send viewers to GitHub.

## Evidence
- demo/terminal.txt
- demo/command-receipt.json
`;
  const renderPlan = {
    provider: video.renderer,
    mode: video.renderer === "none" ? "planning-only" : "adapter-handoff",
    product_videogen_boundary: "Use product-videogen only through dry-run review payloads unless config, approval, and --submit are present.",
    adapters: {
      cutpilot: "Future optional local EDL/ffmpeg handoff.",
      remotion: "Future composition props handoff.",
      hyperframes: "Future scene/frame handoff."
    }
  };
  await writeJson(path.join(out, "video", "video.json"), video);
  await writeFile(path.join(out, "video", "brief.md"), brief);
  await writeJson(path.join(out, "video", "render-plan.json"), renderPlan);
  await updateManifest(out, (existing) => {
    existing.stages.plan = { status: "passed", format, renderer: video.renderer };
  });
  return { stage: "plan", video: path.join(out, "video", "video.json"), brief: path.join(out, "video", "brief.md") };
}

export async function writeCaptions(workspacePath, flags = {}) {
  const out = path.resolve(workspacePath);
  const manifest = await readJson(path.join(out, "launchclip.json"));
  const platforms = String(flags.platforms ?? "x,linkedin,tiktok,bluesky").split(",").map((item) => item.trim()).filter(Boolean);
  await ensureDirs(out, ["captions"]);
  const paths = {};
  for (const platform of platforms) {
    const caption = captionFor(platform, manifest, flags);
    const filePath = path.join(out, "captions", `${platform}.md`);
    await writeFile(filePath, caption);
    paths[platform] = filePath;
  }
  await updateManifest(out, (existing) => {
    existing.stages.captions = { status: "passed", platforms };
  });
  return { stage: "captions", platforms, paths };
}

export async function renderDryRun(workspacePath, flags = {}) {
  const out = path.resolve(workspacePath);
  const provider = flags.provider ?? "product-videogen";
  if (provider !== "product-videogen") throw new Error(`Unsupported render provider: ${provider}`);
  const payload = await productVideogenPayload(out, "render");
  const filePath = path.join(out, "video", "product-videogen.dry-run.json");
  await writeJson(filePath, payload);
  await updateManifest(out, (manifest) => {
    manifest.stages.render = { status: "dry-run", provider };
  });
  return { stage: "render", mode: "dry-run", provider, payload: filePath };
}

export async function submitReview(workspacePath, flags = {}) {
  const out = path.resolve(workspacePath);
  const provider = flags.provider ?? "product-videogen";
  if (provider !== "product-videogen") throw new Error(`Unsupported review provider: ${provider}`);
  if (flags.submit) {
    throw new Error("Live product-videogen submission is intentionally disabled in V1 without explicit local integration code and approval.");
  }
  const payload = await productVideogenPayload(out, "review-item");
  const dryRunPath = path.join(out, "review", "product-videogen-review.dry-run.json");
  const receiptPath = path.join(out, "review", "product-videogen-review.receipt.json");
  const genericReceiptPath = path.join(out, "review", "receipt.json");
  const receipt = {
    provider,
    mode: "dry-run",
    submitted: false,
    approval_status: "pending",
    endpoint: "POST /api/v1/review-items",
    payload_path: "review/product-videogen-review.dry-run.json",
    product_videogen_api_gap: "Needs first-class external review-item ingestion endpoint or equivalent metadata_json/recipe_json acceptance."
  };
  await writeJson(dryRunPath, payload);
  await writeJson(receiptPath, receipt);
  await writeJson(genericReceiptPath, receipt);
  await updateManifest(out, (manifest) => {
    manifest.stages.submit_review = { status: "dry-run", provider, approval_status: "pending" };
  });
  return { stage: "submit-review", mode: "dry-run", provider, payload: dryRunPath, receipt: receiptPath };
}

export async function writeReview(workspacePath) {
  const out = path.resolve(workspacePath);
  const manifest = await readJson(path.join(out, "launchclip.json"));
  const receipt = await optionalJson(path.join(out, "review", "receipt.json"));
  const readiness = await validateWorkspace(out, { write: true });
  const review = `# Launchclip Review Packet

Source repo: ${manifest.source_repo.name}
Source path: ${manifest.source_repo.path}
Source URL: ${manifest.source_repo.url ?? "not detected"}

## Status
- Demo: ${manifest.stages.demo?.status ?? "missing"}
- Video plan: ${manifest.stages.plan?.status ?? "missing"}
- Captions: ${manifest.stages.captions?.status ?? "missing"}
- Product-videogen review: ${manifest.stages.submit_review?.status ?? "missing"}
- Approval status: ${receipt?.approval_status ?? "not submitted"}
- Social readiness: ${readiness.status}

## Artifacts
- launchclip.json
- demo/terminal.txt
- demo/command-receipt.json
- video/video.json
- video/brief.md
- video/render-plan.json
- video/product-videogen.dry-run.json
- captions/*.md
- review/product-videogen-review.dry-run.json
- review/product-videogen-review.receipt.json

## Safety
This packet is dry-run by default. Launchclip does not post to social platforms, publish media, or write to Clutch Cut directly. Product-videogen remains the approval lane.

## Social Readiness
${readiness.issues.length ? readiness.issues.map((issue) => `- ${issue}`).join("\n") : "- Ready for human review."}

## Product-Videogen Follow-Up
${receipt?.product_videogen_api_gap ?? "Run submit-review --provider product-videogen --dry-run to create the dry-run payload."}
`;
  const reviewPath = path.join(out, "REVIEW.md");
  await writeFile(reviewPath, review);
  return { stage: "review", review: reviewPath };
}

export async function runPacket(repoPath, flags = {}) {
  const repo = path.resolve(repoPath);
  const out = path.resolve(flags.out ?? defaultWorkspace(repo));
  const platforms = flags.platforms ?? "x,linkedin,tiktok,bluesky";
  await initWorkspace(repo, { out });
  await runDemo(repo, { out, "demo-cmd": required(flags["demo-cmd"], "--demo-cmd"), capture: flags.capture ?? "terminal", timeout: flags.timeout });
  await planVideo(out, { format: flags.format ?? "short-30", renderer: flags.renderer ?? "none" });
  await writeCaptions(out, { platforms, angle: flags.angle, audience: flags.audience, "cta-url": flags["cta-url"] });
  await renderDryRun(out, { provider: flags.provider ?? "product-videogen", "dry-run": true });
  await submitReview(out, { provider: flags.provider ?? "product-videogen", "dry-run": true });
  await writeReview(out);
  const readiness = await validateWorkspace(out, { write: true });
  return { stage: "run", workspace: out, status: readiness.status, issues: readiness.issues };
}

export async function validateWorkspace(workspacePath, flags = {}) {
  const out = path.resolve(workspacePath);
  const manifest = await readJson(path.join(out, "launchclip.json"));
  const requiredFiles = [
    "launchclip.json",
    "demo/terminal.txt",
    "demo/command-receipt.json",
    "video/video.json",
    "video/brief.md",
    "video/render-plan.json",
    "video/product-videogen.dry-run.json",
    "review/product-videogen-review.dry-run.json",
    "review/product-videogen-review.receipt.json"
  ];
  const issues = [];
  for (const file of requiredFiles) {
    if (!(await optionalText(path.join(out, file)))) issues.push(`Missing artifact: ${file}`);
  }
  for (const [stage, expected] of Object.entries({ demo: "passed", plan: "passed", captions: "passed", render: "dry-run", submit_review: "dry-run" })) {
    if (manifest.stages?.[stage]?.status !== expected) {
      issues.push(`Stage ${stage} is ${manifest.stages?.[stage]?.status ?? "missing"}, expected ${expected}`);
    }
  }
  const captions = await readCaptions(out);
  if (!Object.keys(captions).length) issues.push("No captions found.");
  for (const [platform, caption] of Object.entries(captions)) {
    const rule = PLATFORM_RULES[platform];
    if (!rule) continue;
    const count = visibleCaption(caption).length;
    if (count > rule.max) issues.push(`${platform} caption is ${count} characters; max is ${rule.max}`);
    if (count < rule.min) issues.push(`${platform} caption is ${count} characters; add more context`);
    if (!/Claim status:/i.test(caption)) issues.push(`${platform} caption is missing claim status`);
  }
  const result = {
    stage: "validate",
    status: issues.length ? "needs-work" : "ready",
    issues,
    checked_at: new Date().toISOString(),
    workspace: out,
    source_repo: manifest.source_repo.name,
    platform_targets: Object.keys(captions)
  };
  if (flags.write) {
    await writeJson(path.join(out, "review", "social-readiness.json"), result);
  }
  return result;
}

async function inspectRepo(repo) {
  const packagePath = path.join(repo, "package.json");
  const packageJson = await optionalJson(packagePath);
  const readme = await optionalText(path.join(repo, "README.md"));
  const gitUrl = await gitRemote(repo);
  return {
    name: packageJson?.name ?? path.basename(repo),
    path: repo,
    url: gitUrl,
    summary: firstParagraph(readme) ?? packageJson?.description ?? "OSS repository",
    package_scripts: packageJson?.scripts ?? {},
    evidence: ["README.md", packageJson ? "package.json" : null].filter(Boolean)
  };
}

async function productVideogenPayload(out, purpose) {
  const manifest = await readJson(path.join(out, "launchclip.json"));
  const video = await optionalJson(path.join(out, "video", "video.json"));
  const receipt = await optionalJson(path.join(out, "demo", "command-receipt.json"));
  const captions = await readCaptions(out);
  const socialCaption = captions.x ?? captions.linkedin ?? "";
  return {
    endpoint: "POST /api/v1/review-items",
    method: "POST",
    dry_run: true,
    content_type: "video",
    source: "launchclip",
    title: `${manifest.source_repo.name} launch clip`,
    approval_status: "pending",
    duration_seconds: video?.duration_seconds ?? 30,
    social_caption: socialCaption,
    metadata_json: {
      purpose,
      source_repo: manifest.source_repo.name,
      source_url: manifest.source_repo.url,
      source_path: manifest.source_repo.path,
      platform_targets: Object.keys(captions),
      launchclip_workspace: out,
      claim_status: "evidence_backed",
      safety: manifest.safety
    },
    recipe_json: {
      source: "launchclip",
      video_manifest: video,
      demo_artifacts: receipt?.artifacts ?? [],
      captions,
      provenance: manifest.source_repo.evidence
    }
  };
}

function captionFor(platform, manifest, flags = {}) {
  const repo = manifest.source_repo;
  const url = flags["cta-url"] ?? repo.url ?? repo.path;
  const angle = flags.angle ?? "turns a working local demo into a reviewable promo packet";
  const audience = flags.audience ?? "OSS builders";
  const lines = {
    x: [
      `${repo.name}: ${shorten(angle, 58)}.`,
      `For ${shorten(audience, 42)}: demo proof, video brief, captions, review handoff.`,
      `Try it: ${url}`,
      "",
      "Claim status: evidence-backed."
    ],
    linkedin: [
      `I built a grounded launch packet for ${repo.name}: demo evidence, a short-form video plan, platform captions, and a pending product-videogen review payload.`,
      "",
      `The angle: ${angle}. The audience: ${audience}.`,
      "",
      "The useful bit is the approval boundary: launchclip prepares the packet, while product-videogen owns review and downstream social queueing.",
      "",
      `Repo: ${url}`,
      "Claim status: evidence-backed from local artifacts."
    ],
    tiktok: [
      `POV: your OSS tool finally gets a launch clip packet before anyone posts anything.`,
      `${repo.name}: ${angle}.`,
      `For ${audience}: demo proof, edit plan, captions, product-videogen review handoff.`,
      `GitHub: ${url}`,
      "Claim status: evidence-backed."
    ],
    bluesky: [
      `${repo.name} now has a dry-run launch packet: demo proof, video brief, captions, and product-videogen review payload.`,
      `Angle: ${shorten(angle, 78)}.`,
      `Approval stays in product-videogen.`,
      "Claim status: evidence-backed.",
      url
    ]
  };
  return `${(lines[platform] ?? lines.x).join("\n")}\n`;
}

async function readCaptions(out) {
  const result = {};
  for (const platform of ["x", "linkedin", "tiktok", "bluesky"]) {
    const text = await optionalText(path.join(out, "captions", `${platform}.md`));
    if (text) result[platform] = text.trim();
  }
  return result;
}

async function updateManifest(out, updater) {
  const manifestPath = path.join(out, "launchclip.json");
  const manifest = await readJson(manifestPath);
  updater(manifest);
  manifest.updated_at = new Date().toISOString();
  await writeJson(manifestPath, manifest);
}

async function ensureDirs(base, dirs) {
  await mkdir(base, { recursive: true });
  await Promise.all(dirs.map((dir) => mkdir(path.join(base, dir), { recursive: true })));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function optionalJson(filePath) {
  try {
    return await readJson(filePath);
  } catch {
    return null;
  }
}

async function optionalText(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function gitRemote(repo) {
  try {
    const { stdout } = await execFileAsync("git", ["config", "--get", "remote.origin.url"], { cwd: repo });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function firstParagraph(text) {
  if (!text) return null;
  return text
    .split(/\n\s*\n/)
    .map((part) => part.replace(/^# .*\n/, "").trim())
    .find(Boolean) ?? null;
}

function defaultWorkspace(repo) {
  return path.join(process.cwd(), ".launchclip", path.basename(repo));
}

function required(value, label) {
  if (!value) throw new Error(`Missing required ${label}`);
  return value;
}

function rel(base, target) {
  return path.relative(base, target).split(path.sep).join("/");
}

const PLATFORM_RULES = {
  x: { min: 60, max: 280 },
  bluesky: { min: 60, max: 300 },
  tiktok: { min: 60, max: 2200 },
  linkedin: { min: 120, max: 3000 }
};

function visibleCaption(text) {
  return text.replace(/\s+/g, " ").trim();
}

function shorten(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}.`;
}
