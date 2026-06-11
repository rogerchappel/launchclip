import { execFile } from "node:child_process";
import { access, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
  const redactedCommand = redactSecrets(command);
  const terminal = [`$ ${redactedCommand}`, redactSecrets(stdout.trimEnd()), redactSecrets(stderr.trimEnd())].filter(Boolean).join("\n\n");
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
    command: redactedCommand,
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
  const style = flags.style ?? "proof-card";
  const talkingHead = talkingHeadAdapter(flags, style);
  const stylePreset = videoStylePreset(style, manifest, talkingHead);
  const script = buildScriptPlan(style, manifest, stylePreset, talkingHead);
  const creativeStoryboard = buildCreativeStoryboard(style, manifest, script, stylePreset, talkingHead);
  const video = {
    schema_version: "video-skillkit.compat.v1",
    title: `${manifest.source_repo.name} OSS launch clip`,
    format,
    duration_seconds: duration,
    style,
    source: "launchclip",
    structure: stylePreset.structure,
    script,
    script_visual_alignment: script.timeline,
    creative_storyboard: creativeStoryboard,
    creative_recipe: stylePreset.recipe,
    talking_head: talkingHead,
    evidence: ["demo/terminal.txt", "demo/command-receipt.json"],
    renderer: flags.renderer ?? "none"
  };
  const brief = `# ${manifest.source_repo.name} Short-Form Brief

Format: ${format}
Renderer: ${video.renderer}
Style: ${style}
Talking head: ${talkingHead.enabled ? `${talkingHead.provider}${talkingHead.avatar_id ? ` (${talkingHead.avatar_id})` : ""}` : "none"}

## Angle
${stylePreset.angle}

## Beats
${stylePreset.briefBeats.map((beat) => `- ${beat}`).join("\n")}

## Script
${script.timeline.map((segment) => `- ${segment.time_range} ${segment.beat}: "${segment.voiceover}" [visual: ${segment.visual}]`).join("\n")}

## Evidence
- demo/terminal.txt
- demo/command-receipt.json
`;
  const renderPlan = {
    provider: video.renderer,
    mode: video.renderer === "none" ? "planning-only" : "adapter-handoff",
    style,
    script,
    script_visual_alignment: script.timeline,
    creative_storyboard: creativeStoryboard,
    creative_recipe: stylePreset.recipe,
    talking_head: talkingHead,
    product_videogen_boundary: "Use product-videogen only through dry-run review payloads unless config, approval, and --submit are present.",
    adapters: {
      cutpilot: "Future optional local EDL/ffmpeg handoff.",
      remotion: "Future composition props handoff.",
      hyperframes: "Future scene/frame handoff.",
      "ugc-split": "Product-videogen or a future renderer should compose presenter footage, generated/demo B-roll, subtitles, and voiceover timing from creative_recipe.",
      heygen: "First talking-head adapter target for ugc-split. Generate original avatar footage from the script beats, then composite with B-roll and captions.",
      talking_head: "Provider-neutral adapter contract. Add new providers by mapping talking_head.script_segments, b_roll_slots, captions, and consent/safety fields."
    }
  };
  await writeJson(path.join(out, "video", "video.json"), video);
  await writeFile(path.join(out, "video", "brief.md"), brief);
  await writeJson(path.join(out, "video", "render-plan.json"), renderPlan);
  await updateManifest(out, (existing) => {
    existing.stages.plan = { status: "passed", format, renderer: video.renderer, style, talking_head: talkingHead.provider };
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
  if (provider === "remotion") return renderRemotion(out, flags);
  if (provider !== "product-videogen") throw new Error(`Unsupported render provider: ${provider}`);
  const payload = await productVideogenPayload(out, "render");
  const filePath = path.join(out, "video", "product-videogen.dry-run.json");
  await writeJson(filePath, payload);
  await updateManifest(out, (manifest) => {
    manifest.stages.render = { status: "dry-run", provider };
  });
  return { stage: "render", mode: "dry-run", provider, payload: filePath };
}

async function renderRemotion(out, flags = {}) {
  if (flags["dry-run"]) {
    throw new Error("remotion renders a real media file; omit --dry-run to create video/launchclip.mp4");
  }
  const video = await readJson(path.join(out, "video", "video.json"));
  const fps = Number(flags.fps ?? 30);
  const duration = Number(flags.duration ?? Math.min(video.duration_seconds ?? 30, 30));
  const width = Number(flags.width ?? 720);
  const height = Number(flags.height ?? 1280);
  const output = path.join(out, "video", flags.output ?? "launchclip.mp4");
  const thumbnail = path.join(out, "video", "thumbnail.png");
  const propsPath = path.join(out, "video", "remotion-props.json");
  const entryPoint = path.join(PACKAGE_ROOT, "remotion", "index.jsx");
  const props = await buildRemotionProps(out, { width, height, fps, durationSeconds: duration });
  await writeJson(propsPath, props);
  await execFileAsync("npx", [
    "remotion",
    "render",
    entryPoint,
    "LaunchclipSocial",
    output,
    "--props",
    propsPath,
    "--overwrite",
    "--codec",
    "h264",
    "--log",
    "warn"
  ], { cwd: PACKAGE_ROOT, maxBuffer: 1024 * 1024 * 16 });
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
    manifest.stages.render = {
      status: "passed",
      provider: "remotion",
      media: "video/launchclip.mp4",
      thumbnail: "video/thumbnail.png",
      props: "video/remotion-props.json"
    };
  });
  return { stage: "render", mode: "local", provider: "remotion", video: output, thumbnail, props: propsPath };
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
  const defaultDuration = isSocialReadyStyle(video.style)
    ? Math.min(video.duration_seconds ?? 30, 30)
    : Math.min(video.duration_seconds ?? 15, 15);
  const duration = Number(flags.duration ?? defaultDuration);
  const width = Number(flags.width ?? 720);
  const height = Number(flags.height ?? 1280);
  const fps = Number(flags.fps ?? 12);
  const renderDir = path.join(out, "video", "render-assets");
  await rm(renderDir, { recursive: true, force: true });
  await ensureDirs(out, ["video", "video/render-assets"]);

  const output = path.join(out, "video", flags.output ?? "launchclip.mp4");
  const thumbnail = path.join(out, "video", "thumbnail.png");
  const demoMedia = demoMediaArtifact(receipt, out);
  const renderAssets = await buildRenderAssets(manifest, terminal, captions, demoMedia, video);
  const frameCount = Math.max(1, Math.ceil(duration * fps));
  const mediaFrames = demoMedia
    ? await prepareDemoMediaFrames(demoMedia, renderDir, { width, height, duration, fps })
    : [];
  for (let index = 0; index < frameCount; index += 1) {
    const time = index / fps;
    const framePath = path.join(renderDir, `frame-${String(index + 1).padStart(4, "0")}.ppm`);
    const scene = isSocialReadyStyle(video.style)
      ? socialSceneForTime(video.script_visual_alignment, time, duration)
      : sceneForTime(time, duration, Boolean(demoMedia));
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
  await planVideo(out, {
    format: flags.format ?? "short-15",
    renderer: flags.renderer ?? "none",
    style: flags.style,
    "talking-head": flags["talking-head"],
    "avatar-id": flags["avatar-id"],
    "voice-id": flags["voice-id"]
  });
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
  const video = await optionalJson(path.join(out, "video", "video.json"));
  issues.push(...scriptAlignmentIssues(video));
  issues.push(...creativeStoryboardIssues(video));
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
      script: video?.script,
      script_visual_alignment: video?.script_visual_alignment,
      creative_storyboard: video?.creative_storyboard,
      creative_recipe: video?.creative_recipe,
      talking_head: video?.talking_head,
      demo_artifacts: receipt?.artifacts ?? [],
      captions,
      provenance: manifest.source_repo.evidence
    }
  };
}

function talkingHeadAdapter(flags = {}, style = "proof-card") {
  const requested = flags["talking-head"] ?? flags.talkingHead;
  const provider = requested ?? (isSocialReadyStyle(style) ? "heygen" : "none");
  if (provider === "none" || provider === "off" || provider === false) {
    return { enabled: false, provider: "none" };
  }
  const adapter = {
    enabled: true,
    provider,
    adapter_contract: "launchclip.talking-head.v1",
    role: "presenter",
    avatar_id: flags["avatar-id"] ?? flags.avatarId ?? null,
    voice_id: flags["voice-id"] ?? flags.voiceId ?? null,
    script_segments: [
      { beat: "hook", target_seconds: 3, delivery: "fast, direct, pattern-interrupt opener" },
      { beat: "mechanism", target_seconds: 7, delivery: "explain the before/after in plain language" },
      { beat: "proof", target_seconds: 10, delivery: "point to generated artifacts and demo evidence" },
      { beat: "cta", target_seconds: 4, delivery: "clear review-before-posting CTA" }
    ],
    b_roll_slots: [
      { beat: "split-screen-proof", source: "demo artifacts and generated workspace outputs" },
      { beat: "steps", source: "numbered workflow cards and terminal/UI captures" },
      { beat: "artifact-reveal", source: "video, thumbnail, captions, review packet, dry-run payload" }
    ],
    safety: {
      require_owned_or_licensed_avatar: true,
      clone_real_person_only_with_consent: true,
      dry_run_default: true,
      publish_requires_human_approval: true
    }
  };
  if (provider === "heygen") {
    return {
      ...adapter,
      adapter_notes: [
        "Use HeyGen as the talking-head generator for presenter footage.",
        "Pass avatar_id when a specific approved avatar should be used; otherwise the adapter must choose a configured default avatar.",
        "Keep HeyGen credentials in the host vault or environment, never in video.json or review payloads."
      ]
    };
  }
  return adapter;
}

function scriptAlignmentIssues(video) {
  if (!video) return [];
  const issues = [];
  const timeline = video.script_visual_alignment ?? video.script?.timeline;
  if (!Array.isArray(timeline) || !timeline.length) {
    issues.push("Video plan is missing script_visual_alignment timeline.");
    return issues;
  }
  const structureBeats = new Set((video.structure ?? []).map((segment) => segment.beat));
  for (const segment of timeline) {
    const label = segment.beat ?? "unknown";
    if (structureBeats.size && !structureBeats.has(label)) issues.push(`Script beat ${label} has no matching visual structure beat.`);
    for (const field of ["voiceover", "caption", "visual", "evidence_source", "adapter_target"]) {
      if (!segment[field]) issues.push(`Script beat ${label} is missing ${field}.`);
    }
    if (isSocialReadyStyle(video.style)) {
      for (const field of ["motion", "transition", "caption_emphasis"]) {
        if (!segment[field]) issues.push(`Social script beat ${label} is missing ${field}.`);
      }
    }
  }
  return issues;
}

function creativeStoryboardIssues(video) {
  if (!video || !isSocialReadyStyle(video.style)) return [];
  const issues = [];
  const storyboard = video.creative_storyboard;
  if (!storyboard) return ["Social-ready video is missing creative_storyboard."];
  if (storyboard.schema_version !== "launchclip.storyboard.v1") {
    issues.push("Creative storyboard schema_version must be launchclip.storyboard.v1.");
  }
  if (!Array.isArray(storyboard.quality_gates) || storyboard.quality_gates.length < 5) {
    issues.push("Creative storyboard needs at least five quality gates.");
  }
  const scenes = storyboard.scenes;
  const timeline = video.script_visual_alignment ?? video.script?.timeline ?? [];
  if (!Array.isArray(scenes) || scenes.length !== timeline.length) {
    issues.push("Creative storyboard scenes must match the script visual alignment timeline.");
    return issues;
  }
  for (const scene of scenes) {
    const label = scene.id ?? "unknown";
    for (const field of ["layout", "composition", "media_slots", "motion_grammar", "typography", "color_grade", "success_criteria"]) {
      if (!scene[field] || (Array.isArray(scene[field]) && !scene[field].length)) {
        issues.push(`Creative storyboard scene ${label} is missing ${field}.`);
      }
    }
  }
  return issues;
}

function isSocialReadyStyle(style) {
  return style === "ugc-split" || style === "ugc-demo-punchy";
}

function buildCreativeStoryboard(style, manifest, script, stylePreset, talkingHead = { enabled: false, provider: "none" }) {
  if (!isSocialReadyStyle(style)) {
    return {
      schema_version: "launchclip.storyboard.v1",
      intent: "Simple proof-led local preview.",
      quality_gates: ["show local evidence", "keep claims grounded", "include review-safe CTA"],
      scenes: []
    };
  }
  const repoName = stripMarkdown(manifest.source_repo.name);
  const timeline = script.timeline ?? [];
  const sceneOverrides = {
    "cold-open": {
      layout: "full-screen editorial hook with creator picture-in-picture and repo receipt",
      composition: "large human-readable claim, animated repo receipt strip, creator window as a real video slot placeholder",
      media_slots: ["creator_closeup", "repo_receipt", "generated_thumbnail"],
      motion_grammar: ["match-cut title slam", "camera push", "receipt flicker"],
      typography: "oversized mixed-case caption, two lines max, not pixel art",
      color_grade: "warm paper, ink text, electric green proof accent"
    },
    hook: {
      layout: "full-screen editorial hook with creator picture-in-picture and repo receipt",
      composition: "large human-readable claim, animated repo receipt strip, creator window as a real video slot placeholder",
      media_slots: ["creator_closeup", "repo_receipt", "generated_thumbnail"],
      motion_grammar: ["match-cut title slam", "camera push", "receipt flicker"],
      typography: "oversized mixed-case caption, two lines max, not pixel art",
      color_grade: "warm paper, ink text, electric green proof accent"
    },
    friction: {
      layout: "fast creator-workflow montage",
      composition: "desktop timeline, floating capture cards, cursor path, crossed-off manual tasks",
      media_slots: ["screen_recording", "timeline_strip", "task_cards"],
      motion_grammar: ["whip pan", "speed ramp", "task cards collapse into one timeline"],
      typography: "compact labels with one large pain caption",
      color_grade: "neutral studio UI with coral warning accent"
    },
    "demo-trigger": {
      layout: "device capture with command evidence",
      composition: "phone-framed terminal or UI capture, command highlight, live timer, pass receipt",
      media_slots: ["demo_capture", "terminal_evidence", "receipt_badge"],
      motion_grammar: ["typed command", "timer sweep", "receipt stamp"],
      typography: "caption beside the device, not over the evidence",
      color_grade: "dark device surface with green success accent"
    },
    "split-screen-proof": {
      layout: "device capture with command evidence",
      composition: "phone-framed terminal or UI capture, command highlight, live timer, pass receipt",
      media_slots: ["demo_capture", "terminal_evidence", "receipt_badge"],
      motion_grammar: ["typed command", "timer sweep", "receipt stamp"],
      typography: "caption beside the device, not over the evidence",
      color_grade: "dark device surface with green success accent"
    },
    proof: {
      layout: "editor timeline proof",
      composition: "script lane, visual lane, audio waveform, connected playhead, highlighted active beat",
      media_slots: ["script_lane", "visual_lane", "waveform", "playhead"],
      motion_grammar: ["playhead sweep", "lane highlights", "connector draw"],
      typography: "small dense evidence labels plus one bold caption",
      color_grade: "clean production-suite UI with blue proof accent"
    },
    transformation: {
      layout: "assembly line to launch packet",
      composition: "demo evidence, script, captions, thumbnail, review packet converge into a single packet",
      media_slots: ["demo_evidence", "script_card", "caption_card", "thumbnail_card", "review_packet"],
      motion_grammar: ["cards converge", "stack snap", "progress lock"],
      typography: "numbered output labels with short nouns only",
      color_grade: "white workspace, black text, amber assembly accent"
    },
    steps: {
      layout: "assembly line to launch packet",
      composition: "demo evidence, script, captions, thumbnail, review packet converge into a single packet",
      media_slots: ["demo_evidence", "script_card", "caption_card", "thumbnail_card", "review_packet"],
      motion_grammar: ["cards converge", "stack snap", "progress lock"],
      typography: "numbered output labels with short nouns only",
      color_grade: "white workspace, black text, amber assembly accent"
    },
    "artifact-reveal": {
      layout: "artifact proof barrage",
      composition: "real generated filenames, file previews, dry-run payload, and review status shown as inspectable receipts",
      media_slots: ["brief_md", "render_plan_json", "captions", "review_md", "dry_run_payload"],
      motion_grammar: ["file flip", "zoom punch", "inspect highlight"],
      typography: "filename-first cards with evidence status chips",
      color_grade: "dark review desk with yellow inspection accent"
    },
    cta: {
      layout: "creator plus review-safe product lockup",
      composition: "creator returns, repo URL, approval boundary, final packet checklist",
      media_slots: ["creator_closeup", "repo_url", "approval_boundary", "packet_checklist"],
      motion_grammar: ["clean punch-in", "checklist tick", "CTA hold"],
      typography: "one CTA, one boundary, no extra slogans",
      color_grade: "quiet confidence: ink, paper, green approval accent"
    }
  };
  return {
    schema_version: "launchclip.storyboard.v1",
    intent: `${repoName} should feel like a modern creator-led product short, with proof and motion designed before rendering starts.`,
    creative_positioning: stylePreset.angle,
    renderer_priority: ["remotion", "hyperframes", "heygen", "product-videogen", "local-ffmpeg"],
    non_goals: [
      "Do not make retro terminal art the main visual language.",
      "Do not render static text cards for consecutive beats.",
      "Do not invent unsupported adoption, speed, revenue, or performance claims.",
      "Do not use reference footage, copied creator likenesses, or stock-like filler."
    ],
    quality_gates: [
      "first frame communicates the payoff without audio",
      "every 0.7-1.5 seconds changes layout, camera, caption, or evidence focus",
      "at least three scenes show product/workspace evidence",
      "captions are large, mixed-case, and timed to clauses",
      "terminal evidence is treated as proof, not the whole visual",
      "CTA includes review-before-posting boundary"
    ],
    presenter_direction: talkingHead.enabled
      ? `${talkingHead.provider} presenter footage is hero in hook/CTA and a smaller guide during proof scenes.`
      : "Presenter slot is reserved so HeyGen or another provider can replace the placeholder without changing edit timing.",
    scenes: timeline.map((segment, index) => {
      const override = sceneOverrides[segment.beat] ?? sceneOverrides.cta;
      return {
        id: segment.beat,
        order: index + 1,
        time_range: segment.time_range,
        target_seconds: segment.target_seconds,
        hook: segment.caption,
        voiceover: segment.voiceover,
        evidence_source: segment.evidence_source,
        adapter_target: segment.adapter_target,
        ...override,
        caption_emphasis: segment.caption_emphasis ?? [],
        transition: segment.transition,
        success_criteria: [
          "viewer understands the beat while muted",
          "visual proves or dramatizes the spoken line",
          "scene has at least one animated foreground element"
        ]
      };
    })
  };
}

function ugcSplitStructure(manifest) {
  return [
    { beat: "hook", seconds: 3, instruction: `Open with a presenter-led claim: ${manifest.source_repo.name} turns a repo demo into launch-ready short-form assets.` },
    { beat: "split-screen-proof", seconds: 5, instruction: "Use a vertical split-screen: generated/demo B-roll above and presenter/talking-head below, with large centered captions." },
    { beat: "steps", seconds: 8, instruction: "Show 3-5 numbered workflow steps with minimal words, light progress bars, and quick scene changes." },
    { beat: "artifact-reveal", seconds: 8, instruction: "Reveal the actual artifacts: rendered MP4, thumbnail, captions, review packet, and product-videogen dry-run payload." },
    { beat: "cta", seconds: 6, instruction: "Return to the presenter or a clean product screen with the repo URL and approval boundary." }
  ];
}

function socialPunchyStructure(manifest) {
  return [
    { beat: "cold-open", seconds: 1.5, instruction: `Open with a full-screen pattern interrupt: ${manifest.source_repo.name} just made its own launch Short.` },
    { beat: "friction", seconds: 3.5, instruction: "Show the manual launch tasks as fast cards: script, recording, edit, captions, review." },
    { beat: "demo-trigger", seconds: 4, instruction: "Show the real demo command, timer, and passing receipt." },
    { beat: "proof", seconds: 5, instruction: "Show script-to-visual alignment as proof that the edit follows the spoken line." },
    { beat: "transformation", seconds: 6, instruction: "Assemble the launch packet outputs into one visible stack." },
    { beat: "artifact-reveal", seconds: 7, instruction: "Flash real workspace files: brief, render plan, captions, review packet, product-videogen dry run." },
    { beat: "cta", seconds: 3, instruction: "End on review-first approval CTA with repo URL." }
  ];
}

function videoStylePreset(style, manifest, talkingHead = { enabled: false, provider: "none" }) {
  if (isSocialReadyStyle(style)) {
    const punchy = style === "ugc-demo-punchy";
    return {
      angle: punchy
        ? "Make the repo feel like a social-ready product discovery clip: fast hook, visible friction, proof-driven demo, artifact payoff, and one review-safe CTA."
        : "Make the repo feel like a fast creator-led product discovery clip: a human explains the outcome while generated or captured B-roll proves the workflow.",
      briefBeats: [
        "Cold open: make a concrete claim in the first 1.5 seconds.",
        "Friction: show the boring manual work the viewer wants to avoid.",
        "Demo trigger: show the command or capture that starts the transformation.",
        "Proof: show local demo evidence, not abstract stock footage.",
        "Transformation: connect script, captions, visuals, and review packet as one flow.",
        "Artifact reveal: flash the real output files quickly and repeatedly.",
        "CTA: end with one plain approval-safe action."
      ],
      structure: punchy ? socialPunchyStructure(manifest) : ugcSplitStructure(manifest),
      recipe: {
        preset: style,
        aspect_ratio: "9:16",
        duration_seconds: 30,
        layout: [
          "0-1.5s: full-screen hard hook with presenter punch-in and one giant caption.",
          "1.5-5s: friction montage: script, screen recording, captions, edit timeline.",
          "5-12s: command/demo trigger with timer, cursor motion, and proof receipt.",
          "12-20s: split-screen proof: avatar host plus terminal/demo evidence and step cards.",
          "20-27s: artifact barrage from real workspace outputs with quick zooms.",
          "27-30s: clean CTA, repo URL, and human approval boundary."
        ],
        visual_language: {
          presenter: talkingHead.enabled ? `${talkingHead.provider} avatar presenter, direct eye contact, energetic but natural, used larger for hook and CTA and smaller during proof` : "casual creator/talking-head, direct eye contact, energetic but natural",
          b_roll: "generated product/lifestyle scenes, UI captures, terminal snippets, and output files; all original to the target repo",
          captions: "large kinetic burned-in captions, 2-5 words per caption, high contrast, timed to each clause",
          step_cards: "numbered micro-steps with progress timer, proof badges, and quick zoom transitions",
          pacing: punchy ? "pattern interrupt or layout change every 0.7-1.5 seconds; no static terminal shots" : "scene change every 1-3 seconds; avoid long static terminal shots",
          transitions: ["jump cut", "zoom punch", "caption slam", "receipt flash", "artifact whip"],
          social_readiness: ["first-frame hook", "caption on every beat", "visible proof", "artifact payoff", "approval-safe CTA"]
        },
        script_formula: [
          "Pattern interrupt: 'This repo just made its own launch Short.'",
          "Problem: 'Normally the launch work is scripting, recording, editing, captions, review.'",
          "Mechanism: 'Launchclip runs the demo, captures proof, writes the script, aligns the visuals, and packages review.'",
          "Proof: 'Here are the generated files from this repo.'",
          "CTA: 'Review the packet before anything posts.'"
        ],
        renderer_contract: {
          adapter: "launchclip.remotion-render.v1",
          local_preview: "local-ffmpeg should render script beat cards, kinetic captions, proof panels, progress motion, artifact flashes, and CTA.",
          remotion: "Render the social-ready composition from video/remotion-props.json with frame-based motion graphics, kinetic captions, animated proof panels, and artifact cards.",
          fallback_adapters: ["local-ffmpeg", "hyperframes", "product-videogen"]
        },
        generation_notes: [
          "Do not reuse downloaded reference footage or creator likeness.",
          "Generate original presenter, voiceover, B-roll, and captions from the repo facts.",
          talkingHead.enabled ? `Route presenter generation through the ${talkingHead.provider} talking-head adapter contract.` : "Use the talking-head adapter contract when presenter generation is enabled.",
          "Ground every product claim in README, package metadata, demo output, or generated artifacts.",
          "Keep external publishing and product-videogen submission behind human approval."
        ]
      }
    };
  }

  return {
    angle: "Turn a working local demo into proof that the OSS tool is real and easy to try.",
    briefBeats: [
      "Hook: name the painful manual workflow.",
      "Proof: show the demo command and captured output.",
      "Payoff: explain what changed after the command.",
      "CTA: send viewers to GitHub."
    ],
    structure: [
      { beat: "hook", seconds: 2, instruction: `Open with what ${manifest.source_repo.name} does in one concrete line.` },
      { beat: "usage", seconds: 5, instruction: "Show the command someone runs, including the approved demo command when available." },
      { beat: "proof", seconds: 4, instruction: "Show captured terminal output as evidence, not abstract claims." },
      { beat: "payoff", seconds: 3, instruction: "Show the generated artifacts people can use: MP4, captions, review packet." },
      { beat: "cta", seconds: 1, instruction: "Point viewers to the repo or README quickstart." }
    ],
    recipe: {
      preset: "proof-card",
      aspect_ratio: "9:16",
      visual_language: {
        layout: "full-screen product cards, terminal proof, artifact reveal, CTA",
        pacing: "simple local-render-friendly motion"
      }
    }
  };
}

function buildScriptPlan(style, manifest, stylePreset, talkingHead = { enabled: false, provider: "none" }) {
  const repo = manifest.source_repo;
  const repoName = String(repo.name ?? "this repo").trim();
  const summary = stripMarkdown(repo.summary)
    .replace(new RegExp(`^${escapeRegExp(repoName)}\\s*`, "i"), "")
    .replace(/\s+/g, " ")
    .trim();
  if (isSocialReadyStyle(style)) {
    const punchy = style === "ugc-demo-punchy";
    const timeline = punchy ? [
      {
        beat: "cold-open",
        time_range: "0-1.5s",
        target_seconds: 1.5,
        voiceover: `This repo just made its own launch Short.`,
        caption: "Repo -> Short",
        visual: "Full-screen caption slam over presenter punch-in; flash repo name as a receipt.",
        evidence_source: "launchclip workspace metadata",
        adapter_target: talkingHead.enabled ? talkingHead.provider : "talking-head",
        caption_emphasis: ["repo", "launch Short"],
        motion: "caption slam, 8 percent zoom-in, quick repo-name flash",
        transition: "hard jump cut"
      },
      {
        beat: "friction",
        time_range: "1.5-5s",
        target_seconds: 3.5,
        voiceover: `Usually that means scripting, screen recording, editing, captions, and review.`,
        caption: "The boring part",
        visual: "Rapid stacked cards for script, recording, edit, captions, review; each card gets crossed off.",
        evidence_source: "launchclip generated stages",
        adapter_target: "composition",
        caption_emphasis: ["scripting", "editing", "captions"],
        motion: "four fast cards, strike-through animation, timer ticking",
        transition: "zoom punch"
      },
      {
        beat: "demo-trigger",
        time_range: "5-9s",
        target_seconds: 4,
        voiceover: `Launchclip starts with a real demo command and captures proof from the run.`,
        caption: "Run the demo",
        visual: "Terminal command appears with a timer and green proof badge when the receipt passes.",
        evidence_source: "demo/terminal.txt and demo/command-receipt.json",
        adapter_target: "b-roll",
        caption_emphasis: ["real demo", "proof"],
        motion: "typing reveal, progress sweep, receipt flash",
        transition: "receipt flash"
      },
      {
        beat: "proof",
        time_range: "9-14s",
        target_seconds: 5,
        voiceover: `Then it writes the script and maps every visual to the line being spoken.`,
        caption: "Script + visuals align",
        visual: "Split-screen: script beats on one side, matching visual cards on the other, connected by animated lines.",
        evidence_source: "video/video.json script_visual_alignment",
        adapter_target: "composition",
        caption_emphasis: ["script", "visuals"],
        motion: "split-screen slide, connector lines, beat-by-beat highlights",
        transition: "side swipe"
      },
      {
        beat: "transformation",
        time_range: "14-20s",
        target_seconds: 6,
        voiceover: `The output is not one file. It is the clip plan, captions, thumbnail, and review packet together.`,
        caption: "One packet",
        visual: "Four numbered output tiles assemble into one launch packet stack.",
        evidence_source: "generated workspace files",
        adapter_target: "b-roll",
        caption_emphasis: ["clip plan", "captions", "review"],
        motion: "numbered tiles snap into stack, progress bar completes",
        transition: "artifact whip"
      },
      {
        beat: "artifact-reveal",
        time_range: "20-27s",
        target_seconds: 7,
        voiceover: `For ${repoName}, you can inspect the brief, render plan, captions, and product-videogen dry run before posting.`,
        caption: "Receipts before posting",
        visual: "Fast artifact montage of video/brief.md, render-plan.json, captions/*.md, REVIEW.md, and product-videogen.dry-run.json.",
        evidence_source: "generated workspace files",
        adapter_target: "b-roll",
        caption_emphasis: ["inspect", "before posting"],
        motion: "file cards flash every 0.8s with zoom punches",
        transition: "jump cuts"
      },
      {
        beat: "cta",
        time_range: "27-30s",
        target_seconds: 3,
        voiceover: `Open the review packet. Approve only when the claims and visuals line up.`,
        caption: "Review first",
        visual: "Clean end card: presenter, two approval checks, short repo URL, no progress bar.",
        evidence_source: "review/product-videogen-review.dry-run.json",
        adapter_target: talkingHead.enabled ? talkingHead.provider : "talking-head",
        caption_emphasis: ["review", "approve"],
        motion: "presenter punch-in, two checks tick, clean CTA hold",
        transition: "clean cut"
      }
    ] : [
      {
        beat: "hook",
        time_range: "0-3s",
        target_seconds: 3,
        voiceover: `${repoName} turns a working repo demo into a launch-ready short.`,
        caption: "Repo to launch clip",
        visual: "HeyGen presenter opens in the lower half while fast B-roll shows the repo and generated packet.",
        evidence_source: "README.md and launchclip workspace metadata",
        adapter_target: talkingHead.enabled ? talkingHead.provider : "talking-head",
        caption_emphasis: ["repo", "launch clip"],
        motion: "presenter punch-in with repo flash",
        transition: "jump cut"
      },
      {
        beat: "split-screen-proof",
        time_range: "3-8s",
        target_seconds: 5,
        voiceover: `Instead of guessing what to post, it captures proof from the actual demo run.`,
        caption: "Proof, not guesses",
        visual: "Vertical split-screen with presenter below and terminal/demo evidence above; highlight the passing command receipt.",
        evidence_source: "demo/terminal.txt and demo/command-receipt.json",
        adapter_target: "composition",
        caption_emphasis: ["proof"],
        motion: "split-screen slide with receipt highlight",
        transition: "zoom punch"
      },
      {
        beat: "steps",
        time_range: "8-16s",
        target_seconds: 8,
        voiceover: `Run the demo, write the video plan, draft the captions, then send the packet for review.`,
        caption: "Demo -> plan -> captions -> review",
        visual: "Four numbered micro-step cards appear in sync with each clause, with a thin progress line between them.",
        evidence_source: "launchclip stages in launchclip.json",
        adapter_target: "b-roll",
        caption_emphasis: ["demo", "plan", "captions", "review"],
        motion: "numbered cards with progress line",
        transition: "side swipe"
      },
      {
        beat: "artifact-reveal",
        time_range: "16-24s",
        target_seconds: 8,
        voiceover: `For ${repoName}, the packet includes the brief, render plan, captions, and product-videogen dry run.`,
        caption: "Review packet ready",
        visual: "Fast artifact montage of video/brief.md, render-plan.json, captions/*.md, and product-videogen.dry-run.json.",
        evidence_source: "generated workspace files",
        adapter_target: "b-roll",
        caption_emphasis: ["review packet"],
        motion: "artifact montage with file-card zooms",
        transition: "artifact whip"
      },
      {
        beat: "cta",
        time_range: "24-30s",
        target_seconds: 6,
        voiceover: `Review it first, then approve the clip when the claims and visuals line up.`,
        caption: "Review before posting",
        visual: "Presenter returns beside a clean product screen with repo URL and approval boundary.",
        evidence_source: "review/product-videogen-review.dry-run.json",
        adapter_target: talkingHead.enabled ? talkingHead.provider : "talking-head",
        caption_emphasis: ["review", "posting"],
        motion: "presenter return with CTA lockup",
        transition: "clean cut"
      }
    ];
    return {
      schema_version: "launchclip.script.v1",
      style,
      strategy: punchy
        ? "social-ready creator script with fast pattern interrupts, captions on every beat, and proof-matched visuals"
        : "consistent creator-led script with one visual proof point per spoken beat",
      duration_seconds: 30,
      voice: {
        provider: talkingHead.enabled ? talkingHead.provider : "none",
        avatar_id: talkingHead.avatar_id ?? null,
        delivery: punchy ? "fast, direct, creator-native, no hype claims beyond local evidence" : "fast, plain-spoken, confident, no hype claims beyond local evidence"
      },
      summary_line: summary || "turns local demo evidence into a reviewable launch packet",
      timeline,
      alignment_rules: [
        "Every voiceover segment must have a matching visual, caption, evidence_source, and adapter_target.",
        "Captions should paraphrase the spoken line in 2-6 words instead of duplicating a long sentence.",
        "Do not show abstract stock footage when local demo evidence or generated packet artifacts exist.",
        "For social-ready styles, every beat must include motion and transition guidance.",
        "If a visual cannot be produced, rewrite the corresponding script segment before rendering."
      ]
    };
  }
  let elapsed = 0;
  const timeline = stylePreset.structure.map((segment) => {
    const start = elapsed;
    elapsed += segment.seconds;
    return {
      beat: segment.beat,
      time_range: `${start}-${elapsed}s`,
      target_seconds: segment.seconds,
      voiceover: segment.instruction,
      caption: titleCase(segment.beat.replace(/-/g, " ")),
      visual: segment.instruction,
      evidence_source: segment.beat === "proof" ? "demo/terminal.txt" : "launchclip.json",
      adapter_target: "local-ffmpeg"
    };
  });
  return {
    schema_version: "launchclip.script.v1",
    style,
    strategy: "simple proof-led script where each scene maps to one local-render visual",
    duration_seconds: stylePreset.structure.reduce((sum, segment) => sum + segment.seconds, 0),
    voice: { provider: "none", avatar_id: null, delivery: "optional voiceover or text-only proof cards" },
    summary_line: summary || "turns local demo evidence into launch assets",
    timeline,
    alignment_rules: [
      "Every scene needs a caption and visual tied to a local artifact.",
      "Keep proof claims grounded in demo/terminal.txt and command-receipt.json."
    ]
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

function redactSecrets(text) {
  return String(text ?? "")
    .replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, "[REDACTED_SECRET]")
    .replace(/\b(gh[pousr]_[A-Za-z0-9_]{12,})\b/g, "[REDACTED_SECRET]")
    .replace(/\b((?:api[_-]?key|token|secret|password|passwd)\s*[:=]\s*)([^\s'"`]+)/gi, "$1[REDACTED_SECRET]");
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

async function buildRenderAssets(manifest, terminal, captions, demoMedia = null, video = null) {
  const repo = manifest.source_repo;
  const command = terminalCommand(terminal);
  const output = terminalOutput(terminal);
  const cta = repo.url ?? repo.path;
  const caption = captions.x ?? captions.linkedin ?? "";
  const summary = stripMarkdown(repo.summary).replace(new RegExp(`^${escapeRegExp(repo.name)}\\s*`, "i"), "").trim();
  return {
    title: stripMarkdown(repo.name),
    summary: summary || "turn a local repo into upload-ready launch assets",
    usage: [
      "$ launchclip run .",
      "  --demo-cmd \"npm run smoke\"",
      "  --angle \"demo proof to social\"",
      "$ launchclip render .launchclip/my-tool",
      "  --provider local-ffmpeg"
    ].join("\n"),
    command,
    output: output || "Demo completed and evidence was captured locally.",
    demoMediaLabel: demoMedia ? `${demoMedia.type.toUpperCase()} DEMO` : "TERMINAL PROOF",
    artifacts: "CREATES\nvideo/launchclip.mp4\nvideo/thumbnail.png\ncaptions/*.md\nREVIEW.md",
    cta: stripMarkdown(caption.replace(/Claim status:.*/is, "").trim() || `Try ${repo.name} from the README quickstart.`),
    url: cta,
    socialReady: isSocialReadyStyle(video?.style),
    style: video?.style ?? "proof-card",
    timeline: video?.script_visual_alignment ?? [],
    summaryLine: video?.script?.summary_line ?? "",
    scriptStrategy: video?.script?.strategy ?? "",
    proofCommand: command.replace(/^\$ /, ""),
    outputTiles: ["brief.md", "render-plan.json", "captions/*.md", "REVIEW.md", "dry-run.json"]
  };
}

async function buildRemotionProps(out, renderOptions) {
  const manifest = await readJson(path.join(out, "launchclip.json"));
  const video = await readJson(path.join(out, "video", "video.json"));
  const terminal = await optionalText(path.join(out, "demo", "terminal.txt"));
  const receipt = await optionalJson(path.join(out, "demo", "command-receipt.json"));
  const captions = await readCaptions(out);
  const repo = manifest.source_repo;
  return {
    schema_version: "launchclip.remotion-props.v1",
    width: renderOptions.width,
    height: renderOptions.height,
    fps: renderOptions.fps,
    durationSeconds: renderOptions.durationSeconds,
    repo: {
      name: stripMarkdown(repo.name),
      summary: stripMarkdown(repo.summary).replace(new RegExp(`^${escapeRegExp(repo.name)}\\s*`, "i"), "").trim(),
      url: repo.url ?? repo.path
    },
    style: video.style,
    format: video.format,
    timeline: video.script_visual_alignment ?? video.script?.timeline ?? [],
    storyboard: video.creative_storyboard ?? null,
    creativeRecipe: video.creative_recipe,
    talkingHead: video.talking_head,
    terminal: terminal || "$ npm run smoke\n\nDemo completed and evidence was captured locally.",
    receipt: receipt ?? null,
    captions,
    artifacts: [
      "video/brief.md",
      "video/render-plan.json",
      "captions/*.md",
      "REVIEW.md",
      "product-videogen.dry-run.json"
    ],
    approvalBoundary: "Review before posting. External submission stays behind human approval."
  };
}

function renderMotionFrame(content, options) {
  const { width, height, time, duration, scene = sceneForTime(time, duration, false) } = options;
  if (content.socialReady) {
    return renderSocialFrame(content, { width, height, time, duration, scene });
  }
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
  const smallScale = Math.max(2, Math.round(width / 360));

  fillRect(pixels, width, 0, 0, width, height, [16, 24, 32]);
  fillRect(pixels, width, cardX, cardY, cardW, cardH, [23, 32, 45]);
  fillRect(pixels, width, cardX, cardY, cardW, Math.max(6, Math.round(height * 0.006)), [72, 213, 151]);
  fillRect(pixels, width, margin, height - Math.round(height * 0.07), cardW, Math.max(4, Math.round(height * 0.005)), [44, 59, 79]);
  fillRect(pixels, width, margin, height - Math.round(height * 0.07), Math.round(cardW * progress), Math.max(4, Math.round(height * 0.005)), [72, 213, 151]);
  fillRect(pixels, width, margin + Math.round((cardW - 10) * progress), height - Math.round(height * 0.076), 10, Math.round(height * 0.018), [245, 248, 255]);

  drawText(pixels, width, height, "LAUNCHCLIP", margin + 24, cardY + 44, smallScale, [72, 213, 151]);

  if (scene.name === "hook") {
    drawTextBox(pixels, width, height, content.title, margin + 24, Math.round(height * 0.22), cardW - 48, Math.round(height * 0.14), titleScale, [245, 248, 255], { maxLines: 2 });
    drawTextBox(pixels, width, height, content.summary, margin + 28, Math.round(height * 0.4), cardW - 56, Math.round(height * 0.18), bodyScale, [220, 231, 255], { maxLines: 4 });
    drawTextBox(pixels, width, height, "LOCAL REPO -> SOCIAL PACKET", margin + 28, Math.round(height * 0.68), cardW - 56, Math.round(height * 0.08), bodyScale, [72, 213, 151], { maxLines: 2 });
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
    drawTextBox(pixels, width, height, "HOW TO USE IT", margin + 28, Math.round(height * 0.16), cardW - 56, Math.round(height * 0.08), bodyScale, [72, 213, 151], { maxLines: 1 });
    drawTerminalWindow(pixels, width, height, terminal);
    if (open >= 1) {
      drawTextBox(pixels, width, height, reveal(content.usage, normalized(scene.local, 0.22, 1)), margin + 44, terminalY + 80, terminal.width - 40, terminal.height - 104, smallScale, [245, 248, 255], { preserveLines: true });
    }
  }

  if (scene.name === "media-intro") {
    drawTextBox(pixels, width, height, content.demoMediaLabel, margin + 28, Math.round(height * 0.18), cardW - 56, Math.round(height * 0.08), bodyScale, [72, 213, 151], { maxLines: 1 });
    drawTextBox(pixels, width, height, "SCREEN CAPTURE BECOMES\nA FULL-SCREEN SCENE", margin + 28, Math.round(height * 0.36), cardW - 56, Math.round(height * 0.2), titleScale, [245, 248, 255], { preserveLines: true, maxLines: 3 });
    drawTextBox(pixels, width, height, "NOT JUST A TERMINAL SLIDE", margin + 28, Math.round(height * 0.68), cardW - 56, Math.round(height * 0.08), bodyScale, [220, 231, 255], { maxLines: 2 });
  }

  if (scene.name === "proof") {
    const terminal = {
      x: margin + 24,
      y: terminalY,
      width: cardW - 48,
      height: terminalH,
      scale: bodyScale
    };
    drawTerminalWindow(pixels, width, height, terminal);
    drawTextBox(pixels, width, height, "PROOF FROM THE DEMO", margin + 28, Math.round(height * 0.16), cardW - 56, Math.round(height * 0.08), bodyScale, [72, 213, 151], { maxLines: 1 });
    drawTextBox(pixels, width, height, content.command, margin + 44, terminalY + 80, terminal.width - 40, Math.round(terminal.height * 0.22), smallScale, [72, 213, 151], { preserveLines: true, maxLines: 3 });
    drawTextBox(pixels, width, height, reveal(content.output, normalized(scene.local, 0.1, 1)), margin + 44, terminalY + 158, terminal.width - 40, terminal.height - 182, smallScale, [245, 248, 255], { preserveLines: true });
  }

  if (scene.name === "artifacts") {
    drawTextBox(pixels, width, height, "WHAT IT DOES", margin + 28, Math.round(height * 0.16), cardW - 56, Math.round(height * 0.08), bodyScale, [72, 213, 151], { maxLines: 1 });
    drawTextBox(pixels, width, height, reveal(content.artifacts, normalized(scene.local, 0, 1)), margin + 36, Math.round(height * 0.36), cardW - 72, Math.round(height * 0.32), bodyScale, [245, 248, 255], { preserveLines: true });
  }

  if (scene.name === "cta") {
    drawTextBox(pixels, width, height, "UPLOAD-READY OUTPUT", margin + 28, Math.round(height * 0.18), cardW - 56, Math.round(height * 0.08), bodyScale, [72, 213, 151], { maxLines: 1 });
    drawTextBox(pixels, width, height, reveal(`${content.cta}\n\n${content.url}`, normalized(scene.local, 0, 1)), margin + 28, Math.round(height * 0.34), cardW - 56, Math.round(height * 0.38), smallScale, [245, 248, 255], { maxLines: 8 });
  }

  const dotX = margin + Math.round((cardW - 28) * ((time * 0.7) % 1));
  fillRect(pixels, width, dotX, Math.round(height * 0.12), 28, 8, [82, 151, 255]);
  return Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels]);
}

function renderSocialFrame(content, options) {
  const { width, height, time, duration, scene } = options;
  const pixels = Buffer.alloc(width * height * 3);
  const progress = Math.min(1, time / duration);
  const beat = scene.segment ?? {};
  const local = scene.local ?? 0;
  const margin = Math.round(width * 0.06);
  const safeW = width - margin * 2;
  const titleScale = Math.max(5, Math.round(width / 105));
  const bodyScale = Math.max(3, Math.round(width / 190));
  const smallScale = Math.max(2, Math.round(width / 310));
  const palette = socialPalette(scene.name, Math.floor(time * 2) % 2);

  fillRect(pixels, width, 0, 0, width, height, palette.bg);
  fillRect(pixels, width, 0, 0, width, Math.round(height * 0.015), palette.accent);
  if (scene.name !== "cta") {
    fillRect(pixels, width, 0, height - Math.round(height * 0.015), Math.round(width * progress), Math.round(height * 0.015), palette.accent);
  }
  drawText(pixels, width, height, "LAUNCHCLIP", margin, Math.round(height * 0.035), smallScale, palette.muted);
  drawText(pixels, width, height, `${Math.ceil(Math.max(0, duration - time))}S`, width - margin - 72, Math.round(height * 0.035), smallScale, palette.accent);

  if (scene.name === "cold-open" || scene.name === "hook") {
    const punch = Math.round(24 * normalized(local, 0, 0.45));
    drawTextBox(pixels, width, height, content.title, margin, Math.round(height * 0.17) - punch, safeW, Math.round(height * 0.09), bodyScale, palette.accent, { maxLines: 1 });
    drawTextBox(pixels, width, height, beat.caption ?? "Repo -> Short", margin, Math.round(height * 0.28) - punch, safeW, Math.round(height * 0.22), titleScale, palette.text, { maxLines: 2 });
    drawPresenterBadge(pixels, width, height, margin, Math.round(height * 0.58), safeW, Math.round(height * 0.23), palette, "HOST");
    drawTextBox(pixels, width, height, reveal(beat.voiceover ?? content.summary, normalized(local, 0.15, 1)), margin + 24, Math.round(height * 0.84), safeW - 48, Math.round(height * 0.08), smallScale, palette.text, { maxLines: 2 });
  } else if (scene.name === "friction") {
    drawTextBox(pixels, width, height, beat.caption ?? "The boring part", margin, Math.round(height * 0.12), safeW, Math.round(height * 0.13), titleScale, palette.text, { maxLines: 2 });
    ["SCRIPT", "RECORD", "EDIT", "CAPTIONS", "REVIEW"].forEach((label, index) => {
      const y = Math.round(height * 0.31) + index * Math.round(height * 0.095);
      const shown = local > index * 0.12;
      fillRect(pixels, width, margin, y, safeW, Math.round(height * 0.07), shown ? palette.panel : palette.shadow);
      drawText(pixels, width, height, label, margin + 28, y + 18, bodyScale, shown ? palette.text : palette.muted);
      if (local > 0.48 + index * 0.06) fillRect(pixels, width, margin + 24, y + Math.round(height * 0.035), safeW - 48, 6, palette.accent);
    });
  } else if (scene.name === "demo-trigger" || scene.name === "split-screen-proof") {
    drawTextBox(pixels, width, height, beat.caption ?? "Run the demo", margin, Math.round(height * 0.11), safeW, Math.round(height * 0.1), titleScale, palette.text, { maxLines: 2 });
    drawTerminalWindow(pixels, width, height, {
      x: margin,
      y: Math.round(height * 0.28),
      width: safeW,
      height: Math.round(height * 0.34),
      scale: smallScale
    });
    drawTextBox(pixels, width, height, reveal(content.command, normalized(local, 0.05, 0.55)), margin + 28, Math.round(height * 0.35), safeW - 56, Math.round(height * 0.08), smallScale, palette.accent, { preserveLines: true, maxLines: 2 });
    drawTextBox(pixels, width, height, reveal(content.output, normalized(local, 0.35, 1)), margin + 28, Math.round(height * 0.44), safeW - 56, Math.round(height * 0.14), smallScale, palette.text, { preserveLines: true, maxLines: 4 });
    drawProofBadge(pixels, width, height, margin, Math.round(height * 0.69), safeW, Math.round(height * 0.12), palette, "PROOF FROM DEMO");
  } else if (scene.name === "proof") {
    drawTextBox(pixels, width, height, beat.caption ?? "Script + visuals align", margin, Math.round(height * 0.11), safeW, Math.round(height * 0.1), titleScale, palette.text, { maxLines: 2 });
    const panelY = Math.round(height * 0.27);
    const panelH = Math.round(height * 0.42);
    fillRect(pixels, width, margin, panelY, Math.round(safeW * 0.47), panelH, palette.panel);
    fillRect(pixels, width, margin + Math.round(safeW * 0.53), panelY, Math.round(safeW * 0.47), panelH, palette.panel);
    drawTextBox(pixels, width, height, "SCRIPT\nBEATS", margin + 24, panelY + 28, Math.round(safeW * 0.37), Math.round(panelH * 0.32), bodyScale, palette.accent, { preserveLines: true });
    drawTextBox(pixels, width, height, "VISUAL\nMATCH", margin + Math.round(safeW * 0.58), panelY + 28, Math.round(safeW * 0.34), Math.round(panelH * 0.32), bodyScale, palette.accent, { preserveLines: true });
    for (let i = 0; i < 4; i += 1) {
      const y = panelY + Math.round(panelH * (0.45 + i * 0.12));
      fillRect(pixels, width, margin + Math.round(safeW * 0.43), y, Math.round(safeW * 0.14 * normalized(local, i * 0.15, 0.6 + i * 0.1)), 5, palette.accent);
    }
    drawTextBox(pixels, width, height, beat.motion ?? "beat-by-beat highlights", margin, Math.round(height * 0.76), safeW, Math.round(height * 0.08), smallScale, palette.muted, { maxLines: 2 });
  } else if (scene.name === "transformation" || scene.name === "steps") {
    drawTextBox(pixels, width, height, beat.caption ?? "One packet", margin, Math.round(height * 0.11), safeW, Math.round(height * 0.1), titleScale, palette.text, { maxLines: 2 });
    content.outputTiles.slice(0, 4).forEach((label, index) => {
      const x = margin + (index % 2) * Math.round(safeW * 0.52);
      const y = Math.round(height * 0.31) + Math.floor(index / 2) * Math.round(height * 0.18);
      const visible = normalized(local, index * 0.12, 0.42 + index * 0.12);
      fillRect(pixels, width, x, y + Math.round((1 - visible) * 40), Math.round(safeW * 0.46), Math.round(height * 0.13), palette.panel);
      drawText(pixels, width, height, `0${index + 1}`, x + 20, y + 20, smallScale, palette.accent);
      drawTextBox(pixels, width, height, label, x + 20, y + 56, Math.round(safeW * 0.38), Math.round(height * 0.05), smallScale, palette.text, { maxLines: 1 });
    });
    drawTextBox(pixels, width, height, beat.voiceover ?? content.scriptStrategy, margin, Math.round(height * 0.75), safeW, Math.round(height * 0.11), smallScale, palette.text, { maxLines: 3 });
  } else if (scene.name === "artifact-reveal" || scene.name === "artifacts") {
    const active = Math.min(content.outputTiles.length - 1, Math.floor(local * content.outputTiles.length * 1.2));
    drawTextBox(pixels, width, height, beat.caption ?? "Receipts before posting", margin, Math.round(height * 0.11), safeW, Math.round(height * 0.12), titleScale, palette.text, { maxLines: 2 });
    content.outputTiles.forEach((label, index) => {
      const y = Math.round(height * 0.29) + index * Math.round(height * 0.095);
      const isActive = index === active;
      fillRect(pixels, width, margin + (isActive ? -10 : 0), y, safeW + (isActive ? 20 : 0), Math.round(height * 0.07), isActive ? palette.accent : palette.panel);
      drawTextBox(pixels, width, height, label, margin + 28, y + 18, safeW - 56, Math.round(height * 0.04), smallScale, isActive ? palette.bg : palette.text, { maxLines: 1 });
    });
    drawProofBadge(pixels, width, height, margin, Math.round(height * 0.82), safeW, Math.round(height * 0.08), palette, "REAL WORKSPACE FILES");
  } else {
    drawTextBox(pixels, width, height, beat.caption ?? "Review first", margin, Math.round(height * 0.13), safeW, Math.round(height * 0.15), titleScale, palette.text, { maxLines: 2 });
    drawPresenterBadge(pixels, width, height, margin, Math.round(height * 0.37), safeW, Math.round(height * 0.2), palette, "APPROVAL SAFE");
    drawTextBox(pixels, width, height, "Open the review packet", margin, Math.round(height * 0.66), safeW, Math.round(height * 0.08), bodyScale, palette.accent, { maxLines: 1 });
    drawTextBox(pixels, width, height, content.url, margin, Math.round(height * 0.77), safeW, Math.round(height * 0.08), smallScale, palette.text, { maxLines: 2 });
  }

  return Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels]);
}

function socialPalette(name, alternate = 0) {
  const palettes = {
    "cold-open": { bg: [12, 17, 22], panel: [246, 242, 231], shadow: [32, 38, 47], text: [248, 250, 252], muted: [154, 166, 180], accent: [255, 209, 102] },
    hook: { bg: [12, 17, 22], panel: [246, 242, 231], shadow: [32, 38, 47], text: [248, 250, 252], muted: [154, 166, 180], accent: [255, 209, 102] },
    friction: { bg: [24, 28, 36], panel: [52, 62, 75], shadow: [33, 39, 49], text: [245, 248, 255], muted: [169, 181, 197], accent: [255, 107, 107] },
    "demo-trigger": { bg: [10, 21, 29], panel: [20, 48, 61], shadow: [13, 30, 40], text: [245, 248, 255], muted: [154, 190, 203], accent: [72, 213, 151] },
    "split-screen-proof": { bg: [10, 21, 29], panel: [20, 48, 61], shadow: [13, 30, 40], text: [245, 248, 255], muted: [154, 190, 203], accent: [72, 213, 151] },
    proof: { bg: [18, 20, 35], panel: [37, 42, 72], shadow: [25, 28, 48], text: [245, 248, 255], muted: [174, 180, 210], accent: [132, 180, 255] },
    transformation: { bg: [18, 31, 28], panel: [34, 57, 51], shadow: [20, 39, 35], text: [245, 248, 255], muted: [166, 196, 187], accent: [244, 162, 97] },
    steps: { bg: [18, 31, 28], panel: [34, 57, 51], shadow: [20, 39, 35], text: [245, 248, 255], muted: [166, 196, 187], accent: [244, 162, 97] },
    "artifact-reveal": { bg: alternate ? [24, 24, 30] : [14, 23, 34], panel: [39, 50, 64], shadow: [26, 33, 43], text: [245, 248, 255], muted: [168, 181, 198], accent: [255, 232, 111] },
    artifacts: { bg: alternate ? [24, 24, 30] : [14, 23, 34], panel: [39, 50, 64], shadow: [26, 33, 43], text: [245, 248, 255], muted: [168, 181, 198], accent: [255, 232, 111] },
    cta: { bg: [13, 18, 28], panel: [32, 43, 58], shadow: [22, 29, 40], text: [245, 248, 255], muted: [162, 174, 191], accent: [72, 213, 151] }
  };
  return palettes[name] ?? palettes.cta;
}

function drawPresenterBadge(pixels, width, height, x, y, boxWidth, boxHeight, palette, label) {
  fillRect(pixels, width, x, y, boxWidth, boxHeight, palette.panel);
  const head = Math.round(boxHeight * 0.32);
  fillRect(pixels, width, x + Math.round(boxWidth * 0.08), y + Math.round(boxHeight * 0.18), head, head, palette.accent);
  fillRect(pixels, width, x + Math.round(boxWidth * 0.1), y + Math.round(boxHeight * 0.56), Math.round(boxWidth * 0.22), Math.round(boxHeight * 0.18), palette.accent);
  drawText(pixels, width, height, label, x + Math.round(boxWidth * 0.42), y + Math.round(boxHeight * 0.22), Math.max(2, Math.round(width / 260)), palette.text);
  drawTextBox(pixels, width, height, "TALKING HEAD + DEMO PROOF", x + Math.round(boxWidth * 0.42), y + Math.round(boxHeight * 0.48), Math.round(boxWidth * 0.48), Math.round(boxHeight * 0.22), Math.max(2, Math.round(width / 350)), palette.muted, { maxLines: 2 });
}

function drawProofBadge(pixels, width, height, x, y, boxWidth, boxHeight, palette, label) {
  fillRect(pixels, width, x, y, boxWidth, boxHeight, palette.panel);
  fillRect(pixels, width, x + 18, y + 18, Math.round(boxHeight * 0.45), Math.round(boxHeight * 0.45), palette.accent);
  drawTextBox(pixels, width, height, label, x + 88, y + 24, boxWidth - 112, boxHeight - 36, Math.max(2, Math.round(width / 300)), palette.text, { maxLines: 2 });
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

function socialSceneForTime(timeline = [], time, duration) {
  const fallback = [
    { beat: "cold-open", target_seconds: 1.5 },
    { beat: "friction", target_seconds: 3.5 },
    { beat: "demo-trigger", target_seconds: 4 },
    { beat: "proof", target_seconds: 5 },
    { beat: "transformation", target_seconds: 6 },
    { beat: "artifact-reveal", target_seconds: 7 },
    { beat: "cta", target_seconds: 3 }
  ];
  const segments = Array.isArray(timeline) && timeline.length ? timeline : fallback;
  const total = segments.reduce((sum, segment) => sum + Number(segment.target_seconds ?? 1), 0) || duration;
  const scaledTime = Math.min(total - 0.001, Math.max(0, time / duration * total));
  let cursor = 0;
  for (const segment of segments) {
    const seconds = Number(segment.target_seconds ?? 1);
    if (scaledTime >= cursor && scaledTime < cursor + seconds) {
      return {
        name: segment.beat,
        local: normalized(scaledTime, cursor, cursor + seconds),
        segment
      };
    }
    cursor += seconds;
  }
  const segment = segments[segments.length - 1];
  return { name: segment.beat, local: 1, segment };
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

function titleCase(text) {
  return String(text ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
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

function drawTextBox(pixels, width, height, text, x, y, boxWidth, boxHeight, scale, color, options = {}) {
  const maxChars = charsForWidth(boxWidth, scale);
  const maxLines = Math.max(1, Math.min(options.maxLines ?? Number.POSITIVE_INFINITY, linesForHeight(boxHeight, scale)));
  const fitted = fitTextForBox(text, maxChars, maxLines, options);
  drawText(pixels, width, height, fitted.toUpperCase(), x, y, scale, color, { maxWidth: boxWidth, maxHeight: boxHeight });
}

function fitTextForBox(text, maxChars, maxLines, options = {}) {
  const lines = [];
  const rawParts = String(text ?? "")
    .split(/\n/)
    .map((part) => part.replace(/\s+/g, " ").trimEnd());
  for (const rawPart of rawParts) {
    const part = options.preserveLines ? rawPart : rawPart.trim();
    const wrapped = wrapLineForChars(part, maxChars, options.preserveLines);
    for (const line of wrapped) {
      lines.push(line);
      if (lines.length >= maxLines) return lines.join("\n");
    }
  }
  return lines.join("\n");
}

function wrapLineForChars(line, maxChars, preserveIndent = false) {
  if (!line) return [""];
  if (line.length <= maxChars) return [line];
  const indent = preserveIndent ? line.match(/^\s*/u)?.[0] ?? "" : "";
  const words = line.trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = indent;
  for (const word of words) {
    const prefix = current.trim() ? " " : "";
    const candidate = `${current}${prefix}${word}`;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current.trim()) lines.push(current);
    if (`${indent}${word}`.length <= maxChars) {
      current = `${indent}${word}`;
    } else {
      lines.push(truncateToChars(`${indent}${word}`, maxChars));
      current = indent;
    }
  }
  if (current.trim()) lines.push(current);
  return lines.length ? lines : [truncateToChars(line, maxChars)];
}

function truncateToChars(text, maxChars) {
  if (text.length <= maxChars) return text;
  if (maxChars <= 3) return text.slice(0, maxChars);
  return `${text.slice(0, maxChars - 3)}...`;
}

function charsForWidth(boxWidth, scale) {
  const glyphAdvance = 7 * scale;
  return Math.max(1, Math.floor((boxWidth + 2 * scale) / glyphAdvance));
}

function linesForHeight(boxHeight, scale) {
  const lineHeight = 10 * scale;
  return Math.max(1, Math.floor((boxHeight + 3 * scale) / lineHeight));
}

function drawText(pixels, width, height, text, x, y, scale, color, options = {}) {
  let cursorX = x;
  let cursorY = y;
  const letterWidth = 5 * scale;
  const letterHeight = 7 * scale;
  const clipRight = Math.min(width - 24, x + (options.maxWidth ?? width));
  const clipBottom = Math.min(height - 24, y + (options.maxHeight ?? height));
  for (const char of text) {
    if (char === "\n") {
      cursorX = x;
      cursorY += letterHeight + 3 * scale;
      continue;
    }
    if (cursorY + letterHeight > clipBottom) break;
    const pattern = FONT[char] ?? FONT[" "];
    if (cursorX + letterWidth > clipRight) continue;
    for (let row = 0; row < pattern.length; row += 1) {
      for (let col = 0; col < pattern[row].length; col += 1) {
        if (pattern[row][col] !== "1") continue;
        fillRect(pixels, width, cursorX + col * scale, cursorY + row * scale, scale, scale, color);
      }
    }
    cursorX += letterWidth + 2 * scale;
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
