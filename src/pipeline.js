import { execFile } from "node:child_process";
import { access, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
  const artifacts = [{ type: "terminal", path: rel(out, terminalPath) }];
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
  const demoMedia = flags["demo-media"] ?? flags.media;
  if (demoMedia) {
    const mediaPath = path.resolve(repo, demoMedia);
    const mediaType = mediaArtifactType(mediaPath);
    const mediaTarget = path.join(out, "demo", `media${path.extname(mediaPath).toLowerCase()}`);
    await copyFile(mediaPath, mediaTarget);
    artifacts.push({ type: mediaType, path: rel(out, mediaTarget), source: mediaPath });
  }
  const receipt = {
    command,
    capture: flags.capture ?? "terminal",
    cwd: repo,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    status,
    exit_code: exitCode,
    artifacts
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
  const format = flags.format ?? "short-15";
  const duration = format === "short-15" ? 15 : 30;
  const video = {
    schema_version: "video-skillkit.compat.v1",
    title: `${manifest.source_repo.name} OSS launch clip`,
    format,
    duration_seconds: duration,
    source: "launchclip",
    structure: [
      { beat: "hook", seconds: 2, instruction: `Open with what ${manifest.source_repo.name} does in one concrete line.` },
      { beat: "usage", seconds: 5, instruction: "Show the command someone runs, including the approved demo command when available." },
      { beat: "proof", seconds: 4, instruction: "Show captured terminal output as evidence, not abstract claims." },
      { beat: "payoff", seconds: 3, instruction: "Show the generated artifacts people can use: MP4, captions, review packet." },
      { beat: "cta", seconds: 1, instruction: "Point viewers to the repo or README quickstart." }
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
  return renderVideo(workspacePath, { ...flags, provider: flags.provider ?? "product-videogen", "dry-run": true });
}

export async function renderVideo(workspacePath, flags = {}) {
  const out = path.resolve(workspacePath);
  const provider = flags.provider ?? "product-videogen";
  if (provider === "local-ffmpeg") return renderLocalFfmpeg(out, flags);
  if (provider !== "product-videogen") throw new Error(`Unsupported render provider: ${provider}`);
  const payload = await productVideogenPayload(out, "render");
  const filePath = path.join(out, "video", "product-videogen.dry-run.json");
  await writeJson(filePath, payload);
  await updateManifest(out, (manifest) => {
    manifest.stages.render = { status: "dry-run", provider };
  });
  return { stage: "render", mode: "dry-run", provider, payload: filePath };
}

async function renderLocalFfmpeg(out, flags = {}) {
  if (flags["dry-run"]) {
    throw new Error("local-ffmpeg renders a real media file; omit --dry-run to create video/launchclip.mp4");
  }
  const manifest = await readJson(path.join(out, "launchclip.json"));
  const video = await readJson(path.join(out, "video", "video.json"));
  const terminal = await optionalText(path.join(out, "demo", "terminal.txt"));
  const receipt = await optionalJson(path.join(out, "demo", "command-receipt.json"));
  const captions = await readCaptions(out);
  const duration = Number(flags.duration ?? Math.min(video.duration_seconds ?? 15, 15));
  const width = Number(flags.width ?? 720);
  const height = Number(flags.height ?? 1280);
  const fps = Number(flags.fps ?? 12);
  const renderDir = path.join(out, "video", "render-assets");
  await rm(renderDir, { recursive: true, force: true });
  await ensureDirs(out, ["video", "video/render-assets"]);

  const output = path.join(out, "video", flags.output ?? "launchclip.mp4");
  const thumbnail = path.join(out, "video", "thumbnail.png");
  const demoMedia = demoMediaArtifact(receipt, out);
  const renderAssets = await buildRenderAssets(manifest, terminal, captions, demoMedia);
  const frameCount = Math.max(1, Math.ceil(duration * fps));
  const mediaFrames = demoMedia
    ? await prepareDemoMediaFrames(demoMedia, renderDir, { width, height, duration, fps })
    : [];
  for (let index = 0; index < frameCount; index += 1) {
    const time = index / fps;
    const framePath = path.join(renderDir, `frame-${String(index + 1).padStart(4, "0")}.ppm`);
    const scene = sceneForTime(time, duration, Boolean(demoMedia));
    const mediaIndex = Math.min(mediaFrames.length - 1, Math.floor(scene.local * mediaFrames.length));
    const mediaFrame = scene.name === "media" ? mediaFrames[mediaIndex] : null;
    if (mediaFrame) {
      await copyFile(mediaFrame, framePath);
    } else {
      await writeFile(framePath, renderMotionFrame(renderAssets, { width, height, time, duration, scene }));
    }
  }

  await execFileAsync("ffmpeg", [
    "-y",
    "-framerate",
    String(fps),
    "-i",
    path.join(renderDir, "frame-%04d.ppm"),
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-r",
    String(fps),
    "-shortest",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-t",
    String(duration),
    "-movflags",
    "+faststart",
    output
  ], { maxBuffer: 1024 * 1024 * 8 });

  await execFileAsync("ffmpeg", [
    "-y",
    "-ss",
    "1",
    "-i",
    output,
    "-frames:v",
    "1",
    thumbnail
  ], { maxBuffer: 1024 * 1024 * 8 });

  await updateManifest(out, (manifest) => {
    manifest.stages.render = { status: "passed", provider: "local-ffmpeg", media: "video/launchclip.mp4", thumbnail: "video/thumbnail.png" };
  });
  return { stage: "render", mode: "local", provider: "local-ffmpeg", video: output, thumbnail };
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
Rendered video: ${manifest.stages.render?.media ?? "not rendered"}

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
- ${manifest.stages.render?.media ?? "video/launchclip.mp4"}
- ${manifest.stages.render?.thumbnail ?? "video/thumbnail.png"}
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
  await runDemo(repo, { out, "demo-cmd": required(flags["demo-cmd"], "--demo-cmd"), capture: flags.capture ?? "terminal", timeout: flags.timeout, "demo-media": flags["demo-media"] ?? flags.media });
  await planVideo(out, { format: flags.format ?? "short-15", renderer: flags.renderer ?? "none" });
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
  for (const [stage, expected] of Object.entries({ demo: ["passed"], plan: ["passed"], captions: ["passed"], render: ["dry-run", "passed"], submit_review: ["dry-run"] })) {
    if (!expected.includes(manifest.stages?.[stage]?.status)) {
      issues.push(`Stage ${stage} is ${manifest.stages?.[stage]?.status ?? "missing"}, expected ${expected.join(" or ")}`);
    }
  }
  if (manifest.stages?.render?.status === "passed") {
    for (const file of [manifest.stages.render.media, manifest.stages.render.thumbnail].filter(Boolean)) {
      if (!(await fileExists(path.join(out, file)))) issues.push(`Missing rendered media artifact: ${file}`);
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

function terminalCommand(terminal) {
  return terminal?.match(/^\$ .+$/m)?.[0] ?? "$ npm run smoke";
}

function terminalOutput(terminal) {
  if (!terminal) return "";
  return terminal
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("$ "))
    .slice(-8)
    .join("\n");
}

async function buildRenderAssets(manifest, terminal, captions, demoMedia = null) {
  const repo = manifest.source_repo;
  const command = terminalCommand(terminal);
  const output = terminalOutput(terminal);
  const cta = repo.url ?? repo.path;
  const caption = captions.x ?? captions.linkedin ?? "";
  const summary = stripMarkdown(repo.summary).replace(new RegExp(`^${escapeRegExp(repo.name)}\\s*`, "i"), "").trim();
  return {
    title: wrapLines(repo.name, 24, 1),
    summary: wrapLines(summary || "turn a local repo into upload-ready launch assets", 24, 3),
    usage: [
      "$ launchclip run .",
      "  --demo-cmd \"npm run smoke\"",
      "  --angle \"demo proof to social\"",
      "$ launchclip render .launchclip/my-tool",
      "  --provider local-ffmpeg"
    ].join("\n"),
    command,
    output: wrapPlainLines(output || "Demo completed and evidence was captured locally.", 26, 6),
    demoMediaLabel: demoMedia ? `${demoMedia.type.toUpperCase()} DEMO` : "TERMINAL PROOF",
    artifacts: "CREATES\nvideo/launchclip.mp4\nvideo/thumbnail.png\ncaptions/*.md\nREVIEW.md",
    cta: wrapLines(caption.replace(/Claim status:.*/is, "").trim() || `Try ${repo.name} from the README quickstart.`, 25, 4),
    url: wrapLines(cta, 25, 2)
  };
}

function renderMotionFrame(content, options) {
  const { width, height, time, duration, scene = sceneForTime(time, duration, false) } = options;
  const pixels = Buffer.alloc(width * height * 3);
  const progress = Math.min(1, time / duration);
  const margin = Math.round(width * 0.07);
  const cardX = margin;
  const cardY = Math.round(height * 0.06);
  const cardW = width - margin * 2;
  const cardH = height - Math.round(height * 0.12);
  const terminalY = Math.round(height * 0.25);
  const terminalH = Math.round(height * 0.36);
  const bodyScale = Math.max(2, Math.round(width / 230));
  const titleScale = Math.max(4, Math.round(width / 120));
  const smallScale = Math.max(2, Math.round(width / 280));

  fillRect(pixels, width, 0, 0, width, height, [16, 24, 32]);
  fillRect(pixels, width, cardX, cardY, cardW, cardH, [23, 32, 45]);
  fillRect(pixels, width, cardX, cardY, cardW, Math.max(6, Math.round(height * 0.006)), [72, 213, 151]);
  fillRect(pixels, width, margin, height - Math.round(height * 0.07), cardW, Math.max(4, Math.round(height * 0.005)), [44, 59, 79]);
  fillRect(pixels, width, margin, height - Math.round(height * 0.07), Math.round(cardW * progress), Math.max(4, Math.round(height * 0.005)), [72, 213, 151]);
  fillRect(pixels, width, margin + Math.round((cardW - 10) * progress), height - Math.round(height * 0.076), 10, Math.round(height * 0.018), [245, 248, 255]);

  drawText(pixels, width, height, "LAUNCHCLIP", margin + 24, cardY + 44, smallScale, [72, 213, 151]);

  if (scene.name === "hook") {
    drawText(pixels, width, height, content.title.toUpperCase(), margin + 24, Math.round(height * 0.22), titleScale, [245, 248, 255]);
    drawText(pixels, width, height, content.summary.toUpperCase(), margin + 28, Math.round(height * 0.4), bodyScale, [220, 231, 255]);
    drawText(pixels, width, height, "LOCAL REPO -> SOCIAL PACKET", margin + 28, Math.round(height * 0.68), bodyScale, [72, 213, 151]);
  }

  if (scene.name === "usage") {
    const open = normalized(scene.local, 0, 0.18);
    const terminal = {
      x: margin + 24,
      y: terminalY,
      width: cardW - 48,
      height: Math.max(44, Math.round(terminalH * open)),
      scale: bodyScale
    };
    drawText(pixels, width, height, "HOW TO USE IT", margin + 28, Math.round(height * 0.16), bodyScale, [72, 213, 151]);
    drawTerminalWindow(pixels, width, height, terminal);
    if (open >= 1) {
      drawText(pixels, width, height, reveal(content.usage, normalized(scene.local, 0.22, 1)).toUpperCase(), margin + 44, terminalY + 80, smallScale, [245, 248, 255]);
    }
  }

  if (scene.name === "media-intro") {
    drawText(pixels, width, height, content.demoMediaLabel, margin + 28, Math.round(height * 0.18), bodyScale, [72, 213, 151]);
    drawText(pixels, width, height, "SCREEN CAPTURE BECOMES\nA FULL-SCREEN SCENE", margin + 28, Math.round(height * 0.36), titleScale, [245, 248, 255]);
    drawText(pixels, width, height, "NOT JUST A TERMINAL SLIDE", margin + 28, Math.round(height * 0.68), bodyScale, [220, 231, 255]);
  }

  if (scene.name === "proof") {
    drawTerminalWindow(pixels, width, height, {
      x: margin + 24,
      y: terminalY,
      width: cardW - 48,
      height: terminalH,
      scale: bodyScale
    });
    drawText(pixels, width, height, "PROOF FROM THE DEMO", margin + 28, Math.round(height * 0.16), bodyScale, [72, 213, 151]);
    drawText(pixels, width, height, content.command.toUpperCase(), margin + 44, terminalY + 80, smallScale, [72, 213, 151]);
    drawText(pixels, width, height, reveal(content.output, normalized(scene.local, 0.1, 1)).toUpperCase(), margin + 44, terminalY + 168, smallScale, [245, 248, 255]);
  }

  if (scene.name === "artifacts") {
    drawText(pixels, width, height, "WHAT IT DOES", margin + 28, Math.round(height * 0.16), bodyScale, [72, 213, 151]);
    drawText(pixels, width, height, reveal(content.artifacts, normalized(scene.local, 0, 1)).toUpperCase(), margin + 36, Math.round(height * 0.36), bodyScale, [245, 248, 255]);
  }

  if (scene.name === "cta") {
    drawText(pixels, width, height, "UPLOAD-READY OUTPUT", margin + 28, Math.round(height * 0.18), bodyScale, [72, 213, 151]);
    drawText(pixels, width, height, reveal(`${content.cta}\n\n${content.url}`, normalized(scene.local, 0, 1)).toUpperCase(), margin + 28, Math.round(height * 0.34), bodyScale, [245, 248, 255]);
  }

  const dotX = margin + Math.round((cardW - 28) * ((time * 0.7) % 1));
  fillRect(pixels, width, dotX, Math.round(height * 0.12), 28, 8, [82, 151, 255]);
  return Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels]);
}

function drawTerminalWindow(pixels, width, height, terminal) {
  fillRect(pixels, width, terminal.x, terminal.y, terminal.width, terminal.height, [9, 15, 22]);
  fillRect(pixels, width, terminal.x, terminal.y, terminal.width, 44, [36, 48, 64]);
  fillRect(pixels, width, terminal.x + 24, terminal.y + 16, 12, 12, [255, 107, 107]);
  fillRect(pixels, width, terminal.x + 48, terminal.y + 16, 12, 12, [255, 209, 102]);
  fillRect(pixels, width, terminal.x + 72, terminal.y + 16, 12, 12, [72, 213, 151]);
  drawText(pixels, width, height, "TERMINAL", terminal.x + 110, terminal.y + 12, terminal.scale, [157, 171, 190]);
}

function sceneForTime(time, duration, hasDemoMedia) {
  const points = hasDemoMedia
    ? [
        ["hook", 0, 0.16],
        ["usage", 0.16, 0.36],
        ["media-intro", 0.36, 0.44],
        ["media", 0.44, 0.68],
        ["proof", 0.68, 0.82],
        ["artifacts", 0.82, 0.92],
        ["cta", 0.92, 1.01]
      ]
    : [
        ["hook", 0, 0.16],
        ["usage", 0.16, 0.42],
        ["proof", 0.42, 0.66],
        ["artifacts", 0.66, 0.86],
        ["cta", 0.86, 1.01]
      ];
  const progress = Math.min(0.999, Math.max(0, time / duration));
  const entry = points.find(([, start, end]) => progress >= start && progress < end) ?? points[points.length - 1];
  const [, start, end] = entry;
  const local = normalized(progress, start, end);
  return {
    name: entry[0],
    local
  };
}

function mediaArtifactType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp"].includes(ext)) return "screenshot";
  if ([".mp4", ".mov", ".webm", ".mkv"].includes(ext)) return "video";
  throw new Error(`Unsupported demo media type: ${ext || "unknown"}`);
}

function demoMediaArtifact(receipt, out) {
  const artifact = receipt?.artifacts?.find((item) => ["screenshot", "video"].includes(item.type));
  if (!artifact) return null;
  return {
    type: artifact.type,
    path: path.join(out, artifact.path)
  };
}

async function prepareDemoMediaFrames(demoMedia, renderDir, options) {
  const { width, height, duration, fps } = options;
  const mediaDuration = Math.max(1, duration * 0.24);
  const framePattern = path.join(renderDir, "media-%04d.ppm");
  const inputArgs = demoMedia.type === "screenshot" ? ["-loop", "1", "-i", demoMedia.path] : ["-stream_loop", "-1", "-i", demoMedia.path];
  try {
    await execFileAsync("ffmpeg", [
      "-y",
      ...inputArgs,
      "-t",
      String(mediaDuration),
      "-r",
      String(fps),
      "-vf",
      `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x101820`,
      framePattern
    ], { maxBuffer: 1024 * 1024 * 8 });
  } catch {
    return [];
  }
  const count = Math.max(1, Math.ceil(mediaDuration * fps));
  const frames = [];
  for (let index = 1; index <= count; index += 1) {
    const framePath = path.join(renderDir, `media-${String(index).padStart(4, "0")}.ppm`);
    if (await fileExists(framePath)) frames.push(framePath);
  }
  return frames;
}

function normalized(value, start, end) {
  return Math.max(0, Math.min(1, (value - start) / (end - start)));
}

function reveal(text, progress) {
  return text.slice(0, Math.max(1, Math.ceil(text.length * progress)));
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

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
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
  const raw = text.slice(0, max).trimEnd();
  const boundary = raw.lastIndexOf(" ");
  const candidate = boundary >= Math.floor(max * 0.6) ? raw.slice(0, boundary) : raw;
  return candidate.replace(/[.,;:!?]+$/u, "");
}

function wrapLines(text, width, maxLines) {
  return wrapPlainLines(stripMarkdown(text), width, maxLines);
}

function wrapPlainLines(text, width, maxLines) {
  const lines = [];
  for (const part of String(text ?? "").split(/\n+/)) {
    const words = part.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
    let line = "";
    for (const word of words) {
      if (`${line} ${word}`.trim().length > width) {
        if (line) lines.push(line);
        line = word;
      } else {
        line = `${line} ${word}`.trim();
      }
      if (lines.length >= maxLines) break;
    }
    if (line && lines.length < maxLines) lines.push(line);
    if (lines.length >= maxLines) break;
  }
  return lines.join("\n");
}

function stripMarkdown(text) {
  return String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#*_>~-]/g, " ")
    .trim();
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderScenePpm(text, options) {
  const { width, height, accent } = options;
  const pixels = Buffer.alloc(width * height * 3);
  fillRect(pixels, width, 0, 0, width, height, [16, 24, 32]);
  fillRect(pixels, width, 70, 80, width - 140, height - 160, [23, 32, 45]);
  fillRect(pixels, width, 70, 80, width - 140, 14, accent ? [72, 213, 151] : [82, 151, 255]);
  fillRect(pixels, width, 120, 1320, width - 240, 2, [72, 213, 151]);
  drawText(pixels, width, height, "LAUNCHCLIP", 120, 1420, 7, [72, 213, 151]);
  drawText(pixels, width, height, text.toUpperCase(), 120, 260, accent ? 7 : 6, [245, 248, 255]);
  return Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels]);
}

function fillRect(pixels, width, x, y, rectWidth, rectHeight, color) {
  const height = pixels.length / width / 3;
  for (let row = Math.max(0, y); row < Math.min(height, y + rectHeight); row += 1) {
    for (let col = Math.max(0, x); col < Math.min(width, x + rectWidth); col += 1) {
      const offset = (row * width + col) * 3;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
    }
  }
}

function drawText(pixels, width, height, text, x, y, scale, color) {
  let cursorX = x;
  let cursorY = y;
  const letterWidth = 5 * scale;
  const letterHeight = 7 * scale;
  for (const char of text) {
    if (char === "\n") {
      cursorX = x;
      cursorY += letterHeight + 3 * scale;
      continue;
    }
    const pattern = FONT[char] ?? FONT[" "];
    if (cursorX + letterWidth > width - 24) continue;
    for (let row = 0; row < pattern.length; row += 1) {
      for (let col = 0; col < pattern[row].length; col += 1) {
        if (pattern[row][col] !== "1") continue;
        fillRect(pixels, width, cursorX + col * scale, cursorY + row * scale, scale, scale, color);
      }
    }
    cursorX += letterWidth + 2 * scale;
    if (cursorY + letterHeight > height - 220) break;
  }
}

const FONT = {
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10011", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["10010", "10010", "10010", "11111", "00010", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "_": ["00000", "00000", "00000", "00000", "00000", "00000", "11111"],
  "$": ["00100", "01111", "10100", "01110", "00101", "11110", "00100"],
  "*": ["00000", "10101", "01110", "11111", "01110", "10101", "00000"],
  "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  ">": ["10000", "01000", "00100", "00010", "00100", "01000", "10000"],
  "'": ["01100", "01100", "00100", "00000", "00000", "00000", "00000"],
  "\"": ["01010", "01010", "01010", "00000", "00000", "00000", "00000"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"]
};
