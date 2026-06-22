import { execFile } from "node:child_process";
import { access, copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PREMIUM_PRODUCT_STYLE = "premium-product-short";
const ASSET_MANIFEST_SCHEMA = "launchclip.assets.v1";
const ASSET_MANIFEST_FILE = "launchclip-assets.json";
const ART_DIRECTION_SCHEMA = "launchclip.art-direction.v1";
const HYPERFRAMES_PROJECT_DIR = "video/hyperframes";
const PREMIUM_REQUIRED_ASSET_ALIASES = ["claude-code", "github", "obsidian", "prompt-example", "terminal-demo"];
const PREMIUM_OPTIONAL_ASSET_ALIASES = ["brand-font", "presenter-cutaway", "product-logo", "repo-logo", "sfx-type", "sfx-whoosh"];

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
  const style = flags.style ?? "proof-card";
  const talkingHead = talkingHeadAdapter(flags, style);
  const stylePreset = videoStylePreset(style, manifest, talkingHead);
  const duration = Number(flags.duration ?? stylePreset.duration_seconds ?? stylePreset.recipe?.duration_seconds ?? (format === "short-15" ? 15 : 30));
  const assets = await buildAssetPlan(style, flags);
  const script = buildScriptPlan(style, manifest, stylePreset, talkingHead);
  const creativeStoryboard = buildCreativeStoryboard(style, manifest, script, stylePreset, talkingHead);
  const artDirection = buildArtDirectionContract(style, manifest, stylePreset, script, creativeStoryboard, assets, talkingHead);
  const hyperframes = buildHyperframesHandoff(videoTitle(manifest), duration);
  const voiceover = buildVoiceoverPlan(script, talkingHead);
  const soundDesign = buildSoundDesignPlan(script, stylePreset);
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
    voiceover,
    sound_design: soundDesign,
    art_direction: artDirection,
    creative_storyboard: creativeStoryboard,
    creative_recipe: stylePreset.recipe,
    hyperframes,
    talking_head: talkingHead,
    assets,
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

## Voice Over
Provider: ${voiceover.provider}
Delivery: ${voiceover.delivery}

${voiceover.full_text}

## Sound Design
${soundDesign.cues.map((cue) => `- ${cue.time_range} ${cue.beat}: ${cue.sound} (${cue.trigger})`).join("\n")}

## HyperFrames
Project: ${hyperframes.project_dir}
Composition: ${hyperframes.composition_id}
Render: ${hyperframes.render_command.join(" ")}

## Assets
Mode: ${assets.mode}
Provided aliases: ${assets.provided_aliases.length ? assets.provided_aliases.join(", ") : "none"}
Missing aliases: ${assets.missing_aliases.length ? assets.missing_aliases.join(", ") : "none"}

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
    voiceover,
    sound_design: soundDesign,
    creative_storyboard: creativeStoryboard,
    creative_recipe: stylePreset.recipe,
    talking_head: talkingHead,
    assets,
    product_videogen_boundary: "Use product-videogen only through dry-run review payloads unless config, approval, and --submit are present.",
    adapters: {
      cutpilot: "Future optional local EDL/ffmpeg handoff.",
      remotion: "Render frame-accurate motion, camera pushes, kinetic captions, and local sound-design cues from the plan.",
      hyperframes: "Open video/hyperframes/index.html with HyperFrames. Run npx hyperframes lint, preview, then render; the composition is generated from frame.md, art-direction.json, and creative_storyboard.",
      "ugc-split": "Product-videogen or a future renderer should compose presenter footage, generated/demo B-roll, subtitles, and voiceover timing from creative_recipe.",
      heygen: "First talking-head adapter target for ugc-split. Generate original avatar footage from the script beats, then composite with B-roll and captions.",
      talking_head: "Provider-neutral adapter contract. Add new providers by mapping talking_head.script_segments, b_roll_slots, captions, and consent/safety fields."
    },
    art_direction: artDirection,
    storyboard_preview: "video/storyboard.html",
    hyperframes
  };
  await writeJson(path.join(out, "video", "video.json"), video);
  await writeJson(path.join(out, "video", "voiceover.json"), voiceover);
  await writeJson(path.join(out, "video", "art-direction.json"), artDirection);
  await writeFile(path.join(out, "video", "frame.md"), renderFrameMd(artDirection));
  await writeFile(path.join(out, "video", "storyboard.html"), renderStoryboardHtml(manifest, video));
  await writeHyperframesProject(out, manifest, video);
  await writeFile(path.join(out, "video", "brief.md"), brief);
  await writeJson(path.join(out, "video", "render-plan.json"), renderPlan);
  await updateManifest(out, (existing) => {
    existing.stages.plan = {
      status: "passed",
      format,
      renderer: video.renderer,
      style,
      talking_head: talkingHead.provider,
      art_direction: "video/art-direction.json",
      frame_md: "video/frame.md",
      storyboard_preview: "video/storyboard.html",
      hyperframes_project: HYPERFRAMES_PROJECT_DIR
    };
  });
  return {
    stage: "plan",
    video: path.join(out, "video", "video.json"),
    brief: path.join(out, "video", "brief.md"),
    voiceover: path.join(out, "video", "voiceover.json"),
    frame: path.join(out, "video", "frame.md"),
    storyboard: path.join(out, "video", "storyboard.html"),
    hyperframes: path.join(out, HYPERFRAMES_PROJECT_DIR, "index.html")
  };
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
  if (provider === "hyperframes") return renderHyperframes(out, flags);
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
  const defaultDuration = isPremiumStyle(video.style) ? video.duration_seconds ?? 48 : Math.min(video.duration_seconds ?? 30, 30);
  const duration = Number(flags.duration ?? defaultDuration);
  const width = Number(flags.width ?? 720);
  const height = Number(flags.height ?? 1280);
  const output = path.join(out, "video", flags.output ?? "launchclip.mp4");
  const thumbnail = path.join(out, "video", "thumbnail.png");
  const propsPath = path.join(out, "video", "remotion-props.json");
  const entryPoint = path.join(PACKAGE_ROOT, "remotion", "index.jsx");
  const publicAssets = await prepareRenderPublicAssets(out, flags, video);
  const props = await buildRemotionProps(out, { width, height, fps, durationSeconds: duration, publicAssets });
  await writeJson(propsPath, props);
  const compositionId = isPremiumStyle(video.style) ? "LaunchclipPremiumShort" : "LaunchclipSocial";
  const renderArgs = [
    "remotion",
    "render",
    entryPoint,
    compositionId,
    output,
    "--props",
    propsPath,
    "--overwrite",
    "--codec",
    "h264",
    "--log",
    "warn"
  ];
  if (publicAssets?.public_dir) {
    renderArgs.push("--public-dir", publicAssets.public_dir);
  }
  await execFileAsync("npx", renderArgs, { cwd: PACKAGE_ROOT, maxBuffer: 1024 * 1024 * 16 });
  const voiceoverAudio = await applyVoiceoverIfRequested(out, output, flags);
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
      props: "video/remotion-props.json",
      composition: compositionId,
      public_dir: publicAssets?.public_dir ? rel(out, publicAssets.public_dir) : null,
      missing_asset_aliases: publicAssets?.missing_aliases ?? [],
      voiceover_audio: voiceoverAudio
    };
  });
  return { stage: "render", mode: "local", provider: "remotion", video: output, thumbnail, props: propsPath, publicDir: publicAssets?.public_dir ?? null, voiceoverAudio };
}

async function renderHyperframes(out, flags = {}) {
  if (flags["dry-run"]) {
    throw new Error("hyperframes renders a real media file; omit --dry-run to create video/launchclip-hyperframes.mp4");
  }
  const projectDir = path.join(out, HYPERFRAMES_PROJECT_DIR.replace(/\//g, path.sep));
  const composition = path.join(projectDir, "index.html");
  const output = path.join(out, "video", flags.output ?? "launchclip-hyperframes.mp4");
  const thumbnail = path.join(out, "video", "hyperframes-thumbnail.png");
  if (!(await fileExists(composition))) {
    const manifest = await readJson(path.join(out, "launchclip.json"));
    const video = await readJson(path.join(out, "video", "video.json"));
    await writeHyperframesProject(out, manifest, video);
  }
  const renderArgs = [
    "hyperframes",
    "render",
    "index.html",
    "--output",
    output,
    "--quality",
    flags.quality ?? "high"
  ];
  if (flags.fps) renderArgs.push("--fps", String(flags.fps));
  if (flags.format) renderArgs.push("--format", String(flags.format));
  await execFileAsync("npx", renderArgs, { cwd: projectDir, maxBuffer: 1024 * 1024 * 16 });
  const voiceoverAudio = await applyVoiceoverIfRequested(out, output, flags);
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
      provider: "hyperframes",
      media: rel(out, output),
      thumbnail: rel(out, thumbnail),
      composition: "LaunchclipHyperframes",
      project_dir: HYPERFRAMES_PROJECT_DIR,
      voiceover_audio: voiceoverAudio
    };
  });
  return { stage: "render", mode: "local", provider: "hyperframes", video: output, thumbnail, projectDir, voiceoverAudio };
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
  const defaultDuration = isPremiumStyle(video.style)
    ? Math.min(video.duration_seconds ?? 48, 48)
    : isSocialReadyStyle(video.style)
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
  const voiceoverAudio = await applyVoiceoverIfRequested(out, output, flags);

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
    manifest.stages.render = { status: "passed", provider: "local-ffmpeg", media: "video/launchclip.mp4", thumbnail: "video/thumbnail.png", voiceover_audio: voiceoverAudio };
  });
  return { stage: "render", mode: "local", provider: "local-ffmpeg", video: output, thumbnail, voiceoverAudio };
}

async function applyVoiceoverIfRequested(out, videoPath, flags = {}) {
  const mode = flags.voiceover ?? flags["voice-over"];
  if (!mode || mode === "none" || mode === "off") return null;
  if (mode !== "local-say" && mode !== "say") {
    throw new Error(`Unsupported voiceover provider: ${mode}. Supported: local-say`);
  }
  const voiceover = await readJson(path.join(out, "video", "voiceover.json"));
  const audioPath = path.join(out, "video", "voiceover.aiff");
  const rawAudioPath = path.join(out, "video", "voiceover.raw.aiff");
  const voicedPath = path.join(out, "video", "launchclip.voiced.mp4");
  const videoDuration = await mediaDurationSeconds(videoPath);
  const targetAudioDuration = Math.max(1, videoDuration - 0.85);
  const voiceArgs = flags.voice ? ["-v", flags.voice] : [];
  try {
    await execFileAsync("say", [
      ...voiceArgs,
      "-o",
      rawAudioPath,
      voiceover.full_text
    ], { maxBuffer: 1024 * 1024 * 2 });
  } catch (error) {
    throw new Error(`Could not generate local voiceover with macOS say: ${error.message}`);
  }
  await fitVoiceoverAudio(rawAudioPath, audioPath, targetAudioDuration);
  await rm(rawAudioPath, { force: true });
  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    videoPath,
    "-i",
    audioPath,
    "-filter_complex",
    "[1:a]apad[a]",
    "-map",
    "0:v:0",
    "-map",
    "[a]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-shortest",
    "-movflags",
    "+faststart",
    voicedPath
  ], { maxBuffer: 1024 * 1024 * 8 });
  await rename(voicedPath, videoPath);
  return "video/voiceover.aiff";
}

async function fitVoiceoverAudio(inputPath, outputPath, targetDuration) {
  const duration = await mediaDurationSeconds(inputPath);
  if (duration <= targetDuration) {
    await rename(inputPath, outputPath);
    return;
  }
  const speed = duration / targetDuration;
  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    inputPath,
    "-filter:a",
    atempoFilter(speed),
    outputPath
  ], { maxBuffer: 1024 * 1024 * 8 });
}

async function mediaDurationSeconds(filePath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nw=1:nk=1",
    filePath
  ], { maxBuffer: 1024 * 128 });
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Could not determine media duration for ${filePath}`);
  }
  return duration;
}

function atempoFilter(speed) {
  const filters = [];
  let remaining = speed;
  while (remaining > 2) {
    filters.push("atempo=2");
    remaining /= 2;
  }
  filters.push(`atempo=${remaining.toFixed(4)}`);
  return filters.join(",");
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
- video/frame.md
- video/art-direction.json
- video/storyboard.html
- video/hyperframes/index.html
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
${readiness.warnings?.length ? `\nWarnings:\n${readiness.warnings.map((warning) => `- ${warning}`).join("\n")}` : ""}

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
    duration: flags.duration,
    "assets-dir": flags["assets-dir"] ?? flags.assetsDir,
    "talking-head": flags["talking-head"],
    "avatar-id": flags["avatar-id"],
    "voice-id": flags["voice-id"]
  });
  await writeCaptions(out, { platforms, angle: flags.angle, audience: flags.audience, "cta-url": flags["cta-url"] });
  await renderDryRun(out, { provider: flags.provider ?? "product-videogen", "dry-run": true });
  await submitReview(out, { provider: flags.provider ?? "product-videogen", "dry-run": true });
  await writeReview(out);
  const readiness = await validateWorkspace(out, { write: true });
  return { stage: "run", workspace: out, status: readiness.status, issues: readiness.issues, warnings: readiness.warnings };
}

export async function validateWorkspace(workspacePath, flags = {}) {
  const out = path.resolve(workspacePath);
  const manifest = await readJson(path.join(out, "launchclip.json"));
  const requiredFiles = [
    "launchclip.json",
    "demo/terminal.txt",
    "demo/command-receipt.json",
    "video/video.json",
    "video/voiceover.json",
    "video/frame.md",
    "video/art-direction.json",
    "video/storyboard.html",
    "video/hyperframes/index.html",
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
  issues.push(...voiceoverIssues(video));
  issues.push(...soundDesignIssues(video));
  issues.push(...artDirectionIssues(video));
  issues.push(...hyperframesIssues(video));
  issues.push(...creativeStoryboardIssues(video));
  const warnings = assetWarnings(video);
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
    warnings,
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
  const voiceover = await optionalJson(path.join(out, "video", "voiceover.json"));
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
      voiceover: voiceover ?? video?.voiceover,
      sound_design: video?.sound_design,
      art_direction: video?.art_direction,
      creative_storyboard: video?.creative_storyboard,
      creative_recipe: video?.creative_recipe,
      hyperframes: video?.hyperframes,
      talking_head: video?.talking_head,
      assets: video?.assets,
      demo_artifacts: receipt?.artifacts ?? [],
      captions,
      provenance: manifest.source_repo.evidence
    }
  };
}

async function buildAssetPlan(style, flags = {}) {
  const assetsDir = flags["assets-dir"] ?? flags.assetsDir ?? null;
  const resolvedDir = assetsDir ? path.resolve(assetsDir) : null;
  const manifestPath = resolvedDir ? path.join(resolvedDir, ASSET_MANIFEST_FILE) : null;
  const manifest = manifestPath ? await optionalJson(manifestPath) : null;
  const aliases = normalizeAssetManifest(manifest, resolvedDir);
  const requiredAliases = isPremiumStyle(style) ? [...PREMIUM_REQUIRED_ASSET_ALIASES] : [];
  const missingAliases = requiredAliases.filter((alias) => !aliases[alias]).sort();
  const warnings = [];
  if (resolvedDir && !manifest) {
    warnings.push(`Missing asset manifest: ${manifestPath}`);
  }
  return {
    schema_version: ASSET_MANIFEST_SCHEMA,
    mode: "local-manifest",
    manifest_file: ASSET_MANIFEST_FILE,
    assets_dir: resolvedDir,
    manifest_path: manifestPath,
    required_aliases: requiredAliases,
    optional_aliases: isPremiumStyle(style) ? [...PREMIUM_OPTIONAL_ASSET_ALIASES] : [],
    provided_aliases: Object.keys(aliases).sort(),
    missing_aliases: missingAliases,
    warnings,
    aliases
  };
}

async function prepareRenderPublicAssets(out, flags = {}, video = {}) {
  const assetsDir = flags["assets-dir"] ?? flags.assetsDir ?? video.assets?.assets_dir ?? null;
  if (!isPremiumStyle(video.style) && !assetsDir) return null;
  const renderPublic = path.join(out, "video", "render-public");
  await rm(renderPublic, { recursive: true, force: true });
  await mkdir(path.join(renderPublic, "assets"), { recursive: true });
  const assetPlan = await buildAssetPlan(video.style, { ...flags, "assets-dir": assetsDir });
  const aliases = {};
  const missing = new Set(assetPlan.missing_aliases);
  for (const entry of Object.values(assetPlan.aliases)) {
    if (!(await fileExists(entry.source_path))) {
      if (assetPlan.required_aliases.includes(entry.alias)) missing.add(entry.alias);
      continue;
    }
    const extension = path.extname(entry.source_path).toLowerCase() || ".asset";
    const filename = `${entry.alias}${extension}`;
    await copyFile(entry.source_path, path.join(renderPublic, "assets", filename));
    aliases[entry.alias] = {
      alias: entry.alias,
      label: entry.label,
      type: entry.type,
      src: `assets/${filename}`
    };
  }
  return {
    schema_version: ASSET_MANIFEST_SCHEMA,
    mode: "render-public",
    public_dir: renderPublic,
    required_aliases: assetPlan.required_aliases,
    optional_aliases: assetPlan.optional_aliases,
    provided_aliases: Object.keys(aliases).sort(),
    missing_aliases: [...missing].filter((alias) => !aliases[alias]).sort(),
    warnings: assetPlan.warnings,
    aliases
  };
}

function normalizeAssetManifest(manifest, assetsDir) {
  if (!manifest || !assetsDir) return {};
  const rawAliases = manifest.assets ?? manifest.aliases ?? {};
  const aliases = {};
  for (const [rawAlias, rawValue] of Object.entries(rawAliases)) {
    const alias = normalizeAssetAlias(rawAlias);
    if (!alias) continue;
    const value = typeof rawValue === "string" ? { path: rawValue } : rawValue ?? {};
    const assetPath = value.path ?? value.src ?? value.file;
    if (!assetPath) continue;
    aliases[alias] = {
      alias,
      label: value.label ?? titleCase(alias.replace(/-/g, " ")),
      type: value.type ?? assetTypeForPath(assetPath),
      manifest_path: assetPath,
      source_path: path.resolve(assetsDir, assetPath)
    };
  }
  return Object.fromEntries(Object.entries(aliases).sort(([left], [right]) => left.localeCompare(right)));
}

function normalizeAssetAlias(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function assetTypeForPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"].includes(extension)) return "image";
  if ([".mp4", ".mov", ".webm"].includes(extension)) return "video";
  if ([".wav", ".mp3", ".m4a", ".aac", ".aiff"].includes(extension)) return "audio";
  if ([".otf", ".ttf", ".woff", ".woff2"].includes(extension)) return "font";
  if ([".txt", ".md", ".json"].includes(extension)) return "text";
  return "asset";
}

function assetWarnings(video) {
  const assets = video?.assets;
  if (!assets) return [];
  return [
    ...(Array.isArray(assets.warnings) ? assets.warnings : []),
    ...(Array.isArray(assets.missing_aliases) ? assets.missing_aliases.map((alias) => `Missing asset alias: ${alias}`) : [])
  ].filter(Boolean).sort();
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

function buildVoiceoverPlan(script, talkingHead = { enabled: false, provider: "none" }) {
  const segments = (script.timeline ?? []).map((segment, index) => {
    const range = parseTimeRange(segment.time_range);
    const text = cleanVoiceoverLine(segment.voiceover);
    return {
      index: index + 1,
      beat: segment.beat,
      time_range: segment.time_range,
      start_seconds: range.start,
      end_seconds: range.end,
      target_seconds: segment.target_seconds,
      text,
      caption: segment.caption,
      emphasis: segment.caption_emphasis ?? [],
      delivery: deliveryForBeat(segment.beat),
      pause_after_ms: segment.beat === "cta" ? 0 : 120
    };
  });
  const provider = talkingHead.enabled && talkingHead.provider !== "none" ? talkingHead.provider : "local-say-ready";
  return {
    schema_version: "launchclip.voiceover.v1",
    provider,
    voice_id: talkingHead.voice_id ?? null,
    delivery: script.voice?.delivery ?? "confident, concise, proof-led narration",
    pacing: "Match the segment timing; do not read on-screen filenames one by one.",
    full_text: segments.map((segment) => segment.text).join(" "),
    segments,
    renderer_notes: [
      "Use this narration as the primary information layer; visuals should reduce text instead of duplicating every sentence.",
      "Keep captions to 2-5 word emphasis phrases while voice-over carries the detail.",
      "If using a synthetic voice provider, generate one continuous take and preserve these segment timings for edit alignment."
    ]
  };
}

function buildSoundDesignPlan(script, stylePreset) {
  const cues = (script.timeline ?? []).map((segment, index) => {
    const direction = beatProductionDirection(segment.beat);
    return {
      index: index + 1,
      beat: segment.beat,
      time_range: segment.time_range,
      trigger: direction.soundTrigger,
      sound: direction.sound,
      intensity: direction.intensity,
      mix_level: direction.mixLevel,
      duck_voiceover: true,
      provider_prompt: `${direction.sound} for ${segment.caption || segment.beat}; tight creator-product short timing, no music bed required`
    };
  });
  return {
    schema_version: "launchclip.sound-design.v1",
    provider: "remotion-synthetic-ready",
    music_bed: "none by default; leave space for voiceover and product proof sounds",
    mix_notes: [
      "Use short whooshes only at visual layout changes.",
      "Use soft ticks for typing, cursor, checklist, and file-card events.",
      "Duck SFX under voiceover and keep proof audio intelligible.",
      "Future ElevenLabs or SFX provider output should replace these cues without changing scene timing."
    ],
    cue_density: stylePreset.recipe?.visual_language?.pacing ?? "scene change every 1-3 seconds",
    cues
  };
}

function videoTitle(manifest) {
  return `${stripMarkdown(manifest.source_repo.name)} OSS launch clip`;
}

function buildArtDirectionContract(style, manifest, stylePreset, script, storyboard, assets, talkingHead = { enabled: false, provider: "none" }) {
  const premium = isPremiumStyle(style);
  const social = isSocialReadyStyle(style);
  const repoName = stripMarkdown(manifest.source_repo.name);
  const palette = premium
    ? ["paper #ECE8E1", "ink #1A1A18", "success #62BD93", "coral #F06F5F", "brand accents from manifest assets"]
    : social
      ? ["warm paper", "charcoal ink", "proof green", "warning coral", "editorial blue"]
      : ["deep slate", "white", "Launchclip green", "proof blue"];
  return {
    schema_version: ART_DIRECTION_SCHEMA,
    frame_md: "video/frame.md",
    generated_for: repoName,
    style,
    renderer_targets: ["hyperframes", "remotion", "product-videogen", "local-ffmpeg"],
    hyperframes: {
      project_dir: HYPERFRAMES_PROJECT_DIR,
      composition_id: "LaunchclipHyperframes",
      authoring_model: "plain HTML, CSS, and JavaScript with data-* timeline attributes",
      commands: [
        "npx hyperframes doctor",
        "npx hyperframes lint",
        "npx hyperframes preview",
        "npx hyperframes render index.html --output ../launchclip-hyperframes.mp4 --quality high"
      ],
      requirements: ["Node.js 22+", "FFmpeg", "HyperFrames CLI via npx"]
    },
    brand_system: {
      source: assets.assets_dir ? "launchclip-assets.json plus repo metadata" : "repo metadata plus generated proof artifacts",
      palette,
      typography: premium || social
        ? "large mixed-case display type, short labels, monospace only for prompt or terminal proof"
        : "clear proof-card headings with compact body text",
      logo_policy: "use only supplied local manifest assets or generic proof tokens; do not auto-fetch logos in this phase"
    },
    frame_composition: {
      aspect_ratio: stylePreset.recipe?.aspect_ratio ?? "9:16",
      resolution: stylePreset.recipe?.resolution ?? { width: 1080, height: 1920, fps: 30 },
      first_frame: social ? "the payoff must read without audio" : "repo name, proof claim, and CTA should be visible",
      safe_areas: ["keep chapter/progress UI out of the top 12%", "keep CTA and captions above the bottom 10%", "avoid tiny text in charts"]
    },
    motion: {
      density: premium ? "visible object, camera, type, or SFX change every 0.4-1.2 seconds" : "visible change every 0.7-1.5 seconds",
      object_lifecycle: ["enter", "settle", "transform", "connect", "emphasize", "exit"],
      transitions: [
        "shared objects morph across beats when possible",
        "connectors redraw while nodes move",
        "fast travel uses motion blur and then crisp settle",
        "avoid blank frames and dead holds"
      ],
      smoothness_gates: ["no static scene tail over 1.2 seconds", "no object teleports without a state transition", "no repeated hard-card cuts for adjacent beats"]
    },
    reusable_object_library: {
      target_count: 100,
      categories: [
        "product UI surfaces",
        "workflow cards and receipts",
        "brand and media tokens",
        "diagram nodes and connectors",
        "charts and data marks",
        "proof/review objects",
        "caption and chapter objects",
        "motion props and focus effects",
        "SFX-bound interaction objects",
        "creator/talking-head frames"
      ],
      selection_rule: "the Director chooses object intent; renderer code owns drawing quality, layout constraints, and motion behavior"
    },
    charts_diagrams: {
      chart_types: ["bar", "line", "area", "donut", "scatter", "gauge", "funnel", "matrix", "sparkline", "stat-counter"],
      diagram_types: ["directed graph", "hub-and-spoke", "pipeline", "swimlane", "feedback loop", "architecture layers", "causal chain", "comparison split"],
      honesty_rules: [
        "charts require explicit data, labels, and claim/source status",
        "fabricated metrics are forbidden",
        "diagram connectors must have real endpoints",
        "labels must fit at mobile vertical resolution"
      ]
    },
    sound_design: {
      strategy: "SFX are attached to object lifecycle events, not just scene boundaries",
      families: ["whoosh", "paper-hit", "typing-tick", "connector-pop", "chart-rise", "success-ding", "warning-tap", "soft-thump"],
      mix: "duck under voiceover; vary repeated sounds; avoid meme or impact sounds that overpower proof"
    },
    storyboard_review: {
      html: "video/storyboard.html",
      purpose: "review dense scene frames, missing assets, text load, chart/diagram intent, and SFX coverage before rendering",
      scenes: Array.isArray(storyboard.scenes) ? storyboard.scenes.length : 0,
      quality_gates: storyboard.quality_gates ?? []
    },
    presenter: talkingHead.enabled ? talkingHead.provider : "none",
    script_strategy: script.strategy,
    creative_positioning: stylePreset.angle
  };
}

function buildHyperframesHandoff(title, duration) {
  return {
    schema_version: "launchclip.hyperframes-handoff.v1",
    project_dir: HYPERFRAMES_PROJECT_DIR,
    composition_id: "LaunchclipHyperframes",
    entrypoint: `${HYPERFRAMES_PROJECT_DIR}/index.html`,
    frame_md: "video/frame.md",
    storyboard_preview: "video/storyboard.html",
    duration_seconds: duration,
    title,
    render_command: ["npx", "hyperframes", "render", "index.html", "--output", "../launchclip-hyperframes.mp4", "--quality", "high"],
    preview_command: ["npx", "hyperframes", "preview"],
    lint_command: ["npx", "hyperframes", "lint"],
    notes: [
      "Generated as an editable HyperFrames scaffold from Launchclip's storyboard contract.",
      "Use HyperFrames skills to refine motion, transitions, reusable objects, SFX, charts, and diagrams inside this project.",
      "Keep claims and screenshots grounded in the Launchclip packet."
    ]
  };
}

function renderFrameMd(artDirection) {
  return `# frame.md

Video-oriented design system for ${artDirection.generated_for}.

## Renderer Target

- Primary: HyperFrames
- Composition: ${artDirection.hyperframes.composition_id}
- Project: ${artDirection.hyperframes.project_dir}
- Contract: ${artDirection.hyperframes.authoring_model}

## Brand System

- Source: ${artDirection.brand_system.source}
- Palette: ${artDirection.brand_system.palette.join("; ")}
- Typography: ${artDirection.brand_system.typography}
- Logo policy: ${artDirection.brand_system.logo_policy}

## Frame Composition

- Aspect ratio: ${artDirection.frame_composition.aspect_ratio}
- First frame: ${artDirection.frame_composition.first_frame}
- Safe areas: ${artDirection.frame_composition.safe_areas.join("; ")}

## Motion Direction

- Density: ${artDirection.motion.density}
- Object lifecycle: ${artDirection.motion.object_lifecycle.join(" -> ")}
- Transitions: ${artDirection.motion.transitions.join("; ")}
- Smoothness gates: ${artDirection.motion.smoothness_gates.join("; ")}

## Reusable Object Library

- Target object count: ${artDirection.reusable_object_library.target_count}+
- Categories: ${artDirection.reusable_object_library.categories.join("; ")}
- Selection rule: ${artDirection.reusable_object_library.selection_rule}

## Charts And Diagrams

- Charts: ${artDirection.charts_diagrams.chart_types.join(", ")}
- Diagrams: ${artDirection.charts_diagrams.diagram_types.join(", ")}
- Honesty rules: ${artDirection.charts_diagrams.honesty_rules.join("; ")}

## Sound Design

- Strategy: ${artDirection.sound_design.strategy}
- Families: ${artDirection.sound_design.families.join(", ")}
- Mix: ${artDirection.sound_design.mix}

## Storyboard Review

- Preview: ${artDirection.storyboard_review.html}
- Purpose: ${artDirection.storyboard_review.purpose}
- Quality gates:
${artDirection.storyboard_review.quality_gates.map((gate) => `  - ${gate}`).join("\n")}
`;
}

function renderStoryboardHtml(manifest, video) {
  const scenes = Array.isArray(video.creative_storyboard?.scenes) ? video.creative_storyboard.scenes : [];
  const gates = video.creative_storyboard?.quality_gates ?? [];
  const cards = scenes.map((scene) => {
    const aliases = Array.isArray(scene.asset_aliases) && scene.asset_aliases.length ? scene.asset_aliases.join(", ") : "none";
    const motion = Array.isArray(scene.motion_grammar) ? scene.motion_grammar.join(", ") : scene.motion_grammar ?? "";
    const sfx = Array.isArray(scene.sfx_cues) && scene.sfx_cues.length ? scene.sfx_cues.join(", ") : scene.sound_design ?? "";
    return `<article class="scene-card">
      <div class="scene-meta">${escapeHtml(scene.time_range ?? "")} / ${escapeHtml(scene.id ?? scene.order ?? "scene")}</div>
      <h2>${escapeHtml(scene.hook ?? scene.caption ?? scene.id ?? "Scene")}</h2>
      <p class="voice">${escapeHtml(scene.voiceover ?? "")}</p>
      <dl>
        <dt>Layout</dt><dd>${escapeHtml(scene.layout ?? "")}</dd>
        <dt>Composition</dt><dd>${escapeHtml(scene.composition ?? "")}</dd>
        <dt>Motion</dt><dd>${escapeHtml(motion)}</dd>
        <dt>SFX</dt><dd>${escapeHtml(sfx)}</dd>
        <dt>Assets</dt><dd>${escapeHtml(aliases)}</dd>
        <dt>Evidence</dt><dd>${escapeHtml(scene.evidence_source ?? "")}</dd>
      </dl>
    </article>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(video.title)} storyboard</title>
  <style>
    :root { color-scheme: light; --paper: #ece8e1; --ink: #1a1a18; --green: #62bd93; --coral: #f06f5f; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--paper); color: var(--ink); }
    main { max-width: 1280px; margin: 0 auto; padding: 40px 28px 56px; }
    header { display: grid; gap: 12px; margin-bottom: 28px; }
    h1 { font-size: clamp(32px, 5vw, 72px); line-height: 0.95; margin: 0; letter-spacing: 0; }
    .sub { max-width: 760px; font-size: 18px; line-height: 1.45; }
    .gates { display: flex; flex-wrap: wrap; gap: 8px; padding: 0; margin: 16px 0 0; list-style: none; }
    .gates li { border: 1px solid rgba(26, 26, 24, 0.18); border-radius: 999px; padding: 8px 12px; background: rgba(255,255,255,0.44); font-size: 13px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 18px; }
    .scene-card { min-height: 520px; border: 1px solid rgba(26,26,24,0.12); border-radius: 8px; background: #fffdf8; padding: 22px; box-shadow: 10px 14px 0 rgba(26,26,24,0.12); display: flex; flex-direction: column; gap: 14px; }
    .scene-meta { color: var(--coral); font-weight: 800; text-transform: uppercase; font-size: 12px; letter-spacing: 0.08em; }
    h2 { font-size: 34px; line-height: 1.02; margin: 0; letter-spacing: 0; }
    .voice { font-size: 16px; line-height: 1.35; margin: 0; padding-left: 12px; border-left: 4px solid var(--green); }
    dl { display: grid; grid-template-columns: 88px 1fr; gap: 10px 12px; margin: auto 0 0; font-size: 13px; line-height: 1.32; }
    dt { font-weight: 800; }
    dd { margin: 0; }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>${escapeHtml(video.title)}</h1>
      <p class="sub">${escapeHtml(video.creative_storyboard?.intent ?? manifest.source_repo.summary)}</p>
      <ul class="gates">${gates.map((gate) => `<li>${escapeHtml(gate)}</li>`).join("")}</ul>
    </header>
    <section class="grid">${cards || "<p>No storyboard scenes were generated.</p>"}</section>
  </main>
</body>
</html>
`;
}

async function writeHyperframesProject(out, manifest, video) {
  const projectDir = path.join(out, HYPERFRAMES_PROJECT_DIR.replace(/\//g, path.sep));
  await mkdir(projectDir, { recursive: true });
  await writeJson(path.join(projectDir, "launchclip-data.json"), {
    schema_version: "launchclip.hyperframes-data.v1",
    repo: manifest.source_repo,
    video: {
      title: video.title,
      duration_seconds: video.duration_seconds,
      style: video.style,
      timeline: video.script_visual_alignment,
      storyboard: video.creative_storyboard,
      sound_design: video.sound_design,
      assets: video.assets
    }
  });
  await writeFile(path.join(projectDir, "README.md"), renderHyperframesReadme(video));
  await writeFile(path.join(projectDir, "index.html"), renderHyperframesIndex(manifest, video));
}

function renderHyperframesReadme(video) {
  return `# ${video.title} HyperFrames project

Generated by Launchclip from \`video/video.json\`, \`video/frame.md\`, and \`video/storyboard.html\`.

## Requirements

- Node.js 22+
- FFmpeg
- HyperFrames CLI through \`npx\`

## Review Loop

\`\`\`bash
npx hyperframes doctor
npx hyperframes lint
npx hyperframes preview
npx hyperframes render index.html --output ../launchclip-hyperframes.mp4 --quality high
\`\`\`

Use the official HyperFrames skills to improve this scaffold with richer reusable objects, object state transitions, charts, diagrams, SFX, and scene-specific art direction. Keep claims grounded in the Launchclip packet.
`;
}

function renderHyperframesIndex(manifest, video) {
  const width = 1080;
  const height = 1920;
  const scenes = (video.creative_storyboard?.scenes?.length ? video.creative_storyboard.scenes : video.script_visual_alignment ?? []).map((scene, index) => {
    const range = parseTimeRange(scene.time_range);
    const start = Number.isFinite(range.start) ? range.start : index * 3;
    const end = Number.isFinite(range.end) ? range.end : start + Number(scene.target_seconds ?? 3);
    const duration = Math.max(0.8, end - start);
    const caption = scene.hook ?? scene.caption ?? scene.beat ?? `Scene ${index + 1}`;
    const body = scene.composition ?? scene.visual ?? scene.voiceover ?? "";
    const emphasis = Array.isArray(scene.caption_emphasis) && scene.caption_emphasis.length ? scene.caption_emphasis[0] : scene.id ?? scene.beat ?? "proof";
    return { ...scene, index, start, duration, caption, body, emphasis };
  });
  const sceneHtml = scenes.map((scene) => `<section class="scene scene-${scene.index % 5}" data-start="${scene.start}" data-duration="${scene.duration.toFixed(2)}" data-track-index="${scene.index + 1}">
      <div class="rail">Scene ${scene.index + 1} / ${escapeHtml(scene.id ?? scene.beat ?? "beat")}</div>
      <div class="paper-card hero-card">
        <p class="eyebrow">${escapeHtml(scene.time_range ?? "")}</p>
        <h1>${escapeHtml(scene.caption)}</h1>
        <p>${escapeHtml(scene.body)}</p>
      </div>
      <div class="object-row">
        <div class="token">${escapeHtml(scene.emphasis)}</div>
        <div class="connector"></div>
        <div class="token alt">${escapeHtml(scene.evidence_source ?? "proof")}</div>
      </div>
    </section>`).join("\n");
  const duration = Number(video.duration_seconds ?? 30);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=${width}, height=${height}" />
  <title>${escapeHtml(video.title)}</title>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@hyperframes/core/dist/hyperframe.runtime.iife.js"></script>
  <style>
    * { box-sizing: border-box; }
    html, body { width: ${width}px; height: ${height}px; margin: 0; overflow: hidden; background: #ece8e1; color: #1a1a18; }
    body { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    [data-composition-id="LaunchclipHyperframes"] { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; background: #ece8e1; }
    .grid-bg { position: absolute; inset: -80px; opacity: 0.22; background-image: linear-gradient(rgba(26,26,24,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(26,26,24,0.08) 1px, transparent 1px); background-size: 48px 48px; transform: rotateX(5deg) scale(1.08); }
    .scene { position: absolute; inset: 0; padding: 150px 84px 120px; display: flex; flex-direction: column; justify-content: center; gap: 44px; }
    .rail { position: absolute; top: 56px; left: 84px; right: 84px; padding-bottom: 18px; border-bottom: 3px solid rgba(26,26,24,0.16); font-size: 28px; font-weight: 900; color: #f06f5f; }
    .paper-card { border-radius: 28px; background: #fffdf8; box-shadow: 20px 28px 0 rgba(26,26,24,0.18), 0 24px 80px rgba(26,26,24,0.18); border: 2px solid rgba(26,26,24,0.12); }
    .hero-card { padding: 54px; min-height: 620px; transform: rotate(-1.2deg); }
    .eyebrow { margin: 0 0 22px; color: #62bd93; font-size: 28px; font-weight: 900; text-transform: uppercase; }
    h1 { margin: 0; max-width: 820px; font-size: 92px; line-height: 0.95; letter-spacing: 0; }
    p { font-size: 34px; line-height: 1.28; }
    .object-row { display: grid; grid-template-columns: 1fr 160px 1fr; align-items: center; gap: 22px; }
    .token { min-height: 132px; border-radius: 26px; padding: 30px; background: #111; color: #ece8e1; font-size: 30px; font-weight: 900; display: grid; place-items: center; text-align: center; box-shadow: 14px 20px 0 rgba(26,26,24,0.16); }
    .token.alt { background: #62bd93; color: #101010; }
    .connector { height: 6px; background: repeating-linear-gradient(90deg, #1a1a18 0 18px, transparent 18px 30px); position: relative; }
    .connector::after { content: ""; position: absolute; right: -2px; top: -10px; border-left: 24px solid #1a1a18; border-top: 13px solid transparent; border-bottom: 13px solid transparent; }
    .scene-1 .hero-card { transform: rotate(1deg); }
    .scene-2 .hero-card { transform: rotate(-0.4deg); }
    .scene-3 .hero-card { transform: rotate(1.4deg); }
    .scene-4 .hero-card { transform: rotate(-1.8deg); }
  </style>
</head>
<body>
  <div id="stage" data-composition-id="LaunchclipHyperframes" data-start="0" data-duration="${duration}" data-width="${width}" data-height="${height}">
    <div class="grid-bg" data-start="0" data-duration="${duration}" data-track-index="0"></div>
${sceneHtml}
  </div>
  <script>
    const scenes = document.querySelectorAll(".scene");
    scenes.forEach((scene, index) => {
      const card = scene.querySelector(".hero-card");
      const tokens = scene.querySelectorAll(".token");
      const connector = scene.querySelector(".connector");
      gsap.set(scene, { opacity: 0 });
      gsap.set(card, { y: 80, rotate: index % 2 ? 4 : -4, scale: 0.92 });
      gsap.set(tokens, { y: 46, opacity: 0, scale: 0.86 });
      gsap.set(connector, { scaleX: 0, transformOrigin: "left center" });
      const start = Number(scene.dataset.start || 0);
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      tl.to(scene, { opacity: 1, duration: 0.12 }, start)
        .to(card, { y: 0, rotate: index % 2 ? 1 : -1.2, scale: 1, duration: 0.72 }, start + 0.06)
        .to(tokens, { y: 0, opacity: 1, scale: 1, stagger: 0.12, duration: 0.42 }, start + 0.42)
        .to(connector, { scaleX: 1, duration: 0.44 }, start + 0.58)
        .to(card, { scale: 1.035, duration: Math.max(0.8, Number(scene.dataset.duration || 2) - 0.8), ease: "none" }, start + 0.84)
        .to(scene, { opacity: 0, duration: 0.1 }, start + Number(scene.dataset.duration || 2) - 0.1);
    });
  </script>
</body>
</html>
`;
}

function cleanVoiceoverLine(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .trim();
}

function deliveryForBeat(beat) {
  if (beat === "cold-open" || beat === "hook") return "fast hook, one breath, direct to camera";
  if (beat === "friction") return "slightly compressed pace, list rhythm";
  if (beat === "demo-trigger" || beat === "split-screen-proof") return "clear proof tone, slow enough for the command to land";
  if (["retro-terminal", "asset-orbit", "prompt-compose", "collage-proof", "folder-stack", "type-demo"].includes(beat)) {
    return "premium product-demo cadence with space for motion hits and typing cues";
  }
  if (beat === "artifact-reveal" || beat === "artifacts") return "confident payoff, do not over-read filenames";
  if (beat === "cta") return "calm, short, leave a clean final hold";
  return "natural product explainer pace";
}

function parseTimeRange(range) {
  const match = String(range ?? "").match(/([\d.]+)\s*-\s*([\d.]+)/);
  return {
    start: match ? Number(match[1]) : null,
    end: match ? Number(match[2]) : null
  };
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

function voiceoverIssues(video) {
  if (!video) return [];
  const issues = [];
  const timeline = video.script_visual_alignment ?? video.script?.timeline ?? [];
  const voiceover = video.voiceover;
  if (!voiceover) return ["Video plan is missing voiceover."];
  if (voiceover.schema_version !== "launchclip.voiceover.v1") {
    issues.push("Voiceover schema_version must be launchclip.voiceover.v1.");
  }
  if (!voiceover.full_text) issues.push("Voiceover is missing full_text.");
  if (!Array.isArray(voiceover.segments) || voiceover.segments.length !== timeline.length) {
    issues.push("Voiceover segments must match the script visual alignment timeline.");
    return issues;
  }
  for (const segment of voiceover.segments) {
    if (!segment.text) issues.push(`Voiceover beat ${segment.beat ?? "unknown"} is missing text.`);
    if (!segment.delivery) issues.push(`Voiceover beat ${segment.beat ?? "unknown"} is missing delivery.`);
  }
  return issues;
}

function soundDesignIssues(video) {
  if (!video || !isSocialReadyStyle(video.style)) return [];
  const issues = [];
  const timeline = video.script_visual_alignment ?? video.script?.timeline ?? [];
  const soundDesign = video.sound_design;
  if (!soundDesign) return ["Social-ready video is missing sound_design."];
  if (soundDesign.schema_version !== "launchclip.sound-design.v1") {
    issues.push("Sound design schema_version must be launchclip.sound-design.v1.");
  }
  if (!Array.isArray(soundDesign.cues) || soundDesign.cues.length !== timeline.length) {
    issues.push("Sound design cues must match the script visual alignment timeline.");
    return issues;
  }
  for (const cue of soundDesign.cues) {
    if (!cue.sound) issues.push(`Sound design cue ${cue.beat ?? "unknown"} is missing sound.`);
    if (!cue.trigger) issues.push(`Sound design cue ${cue.beat ?? "unknown"} is missing trigger.`);
    if (!cue.provider_prompt) issues.push(`Sound design cue ${cue.beat ?? "unknown"} is missing provider_prompt.`);
  }
  return issues;
}

function artDirectionIssues(video) {
  if (!video) return [];
  const issues = [];
  const artDirection = video.art_direction;
  if (!artDirection) return ["Video plan is missing art_direction."];
  if (artDirection.schema_version !== ART_DIRECTION_SCHEMA) {
    issues.push(`Art direction schema_version must be ${ART_DIRECTION_SCHEMA}.`);
  }
  if (!artDirection.frame_md) issues.push("Art direction is missing frame_md.");
  if (!artDirection.renderer_targets?.includes("hyperframes")) {
    issues.push("Art direction must include hyperframes as a renderer target.");
  }
  if (!artDirection.reusable_object_library || artDirection.reusable_object_library.target_count < 100) {
    issues.push("Art direction must define a reusable object library target of at least 100 objects.");
  }
  if (!Array.isArray(artDirection.charts_diagrams?.chart_types) || artDirection.charts_diagrams.chart_types.length < 8) {
    issues.push("Art direction must define at least eight chart types.");
  }
  if (!Array.isArray(artDirection.charts_diagrams?.diagram_types) || artDirection.charts_diagrams.diagram_types.length < 8) {
    issues.push("Art direction must define at least eight diagram types.");
  }
  if (!Array.isArray(artDirection.sound_design?.families) || artDirection.sound_design.families.length < 6) {
    issues.push("Art direction must define reusable SFX families.");
  }
  return issues;
}

function hyperframesIssues(video) {
  if (!video) return [];
  const issues = [];
  const hyperframes = video.hyperframes;
  if (!hyperframes) return ["Video plan is missing hyperframes handoff."];
  if (hyperframes.schema_version !== "launchclip.hyperframes-handoff.v1") {
    issues.push("HyperFrames handoff schema_version must be launchclip.hyperframes-handoff.v1.");
  }
  if (hyperframes.project_dir !== HYPERFRAMES_PROJECT_DIR) {
    issues.push(`HyperFrames project_dir must be ${HYPERFRAMES_PROJECT_DIR}.`);
  }
  if (!hyperframes.entrypoint?.endsWith("index.html")) {
    issues.push("HyperFrames handoff must point at an index.html entrypoint.");
  }
  if (!Array.isArray(hyperframes.render_command) || !hyperframes.render_command.includes("hyperframes")) {
    issues.push("HyperFrames handoff must include an npx hyperframes render command.");
  }
  return issues;
}

function beatProductionDirection(beat) {
  const directions = {
    "cold-open": {
      editDensity: "0.4-0.7s micro-cuts inside the first 1.5s",
      cameraDirection: "fast 8 percent punch-in with a tiny settle after the title slam",
      sound: "low whoosh into caption hit",
      soundTrigger: "title slam and repo receipt flash",
      intensity: "high",
      mixLevel: -14
    },
    hook: {
      editDensity: "0.4-0.7s micro-cuts inside the first 3s",
      cameraDirection: "presenter punch-in, repo flash, then steady proof frame",
      sound: "low whoosh into caption hit",
      soundTrigger: "presenter punch-in and repo flash",
      intensity: "high",
      mixLevel: -14
    },
    friction: {
      editDensity: "task card or cursor event every 0.45-0.8s",
      cameraDirection: "left-to-right whip pan across stacked workflow cards",
      sound: "dry ticks and soft strike-through swipes",
      soundTrigger: "each manual task card entering or crossing off",
      intensity: "medium-high",
      mixLevel: -18
    },
    "demo-trigger": {
      editDensity: "typed command ticks, progress sweep, receipt stamp",
      cameraDirection: "slow device push while terminal text types in",
      sound: "keyboard ticks with a success ding",
      soundTrigger: "command typing and receipt badge landing",
      intensity: "medium",
      mixLevel: -19
    },
    "retro-terminal": {
      editDensity: "terminal glow, command burst, cursor tick, or receipt event every 0.4-0.9s",
      cameraDirection: "soft dolly into retro terminal, tiny parallax drift, then receipt punch",
      sound: "keyboard ticks, screen hum, and soft success ding",
      soundTrigger: "typed command bursts and proof receipt stamp",
      intensity: "medium-high",
      mixLevel: -18
    },
    "asset-orbit": {
      editDensity: "logo token orbit, connector draw, or snap event every 0.4-0.8s",
      cameraDirection: "orbiting push through tool tokens with depth focus rack",
      sound: "logo whooshes, connector pops, and snap clicks",
      soundTrigger: "each branded token throw and connector snap",
      intensity: "high",
      mixLevel: -16
    },
    "prompt-compose": {
      editDensity: "typing, cursor, chip drop, or panel zoom every 0.35-0.8s",
      cameraDirection: "close prompt-panel push with cursor-led focus changes",
      sound: "typing ticks, chip drops, and panel zoom whoosh",
      soundTrigger: "prompt typing, asset chip drops, and final cursor jump",
      intensity: "medium-high",
      mixLevel: -18
    },
    "collage-proof": {
      editDensity: "card flip, inspection zoom, focus rack, or board shuffle every 0.5-1.0s",
      cameraDirection: "collage board drift with punch-ins on proof artifacts",
      sound: "paper flips, camera ticks, and inspection pops",
      soundTrigger: "artifact card flips and inspection zoom hits",
      intensity: "high",
      mixLevel: -16
    },
    "folder-stack": {
      editDensity: "3D folder rotation, file throw, blur streak, or stack settle every 0.4-0.9s",
      cameraDirection: "foreground folder stack orbit with overshoot and parallax depth",
      sound: "folder whoosh, paper hits, and stack thump",
      soundTrigger: "folder rotation peak, file-card throws, and final stack landing",
      intensity: "high",
      mixLevel: -16
    },
    "type-demo": {
      editDensity: "prompt typing, terminal wipe, cursor teleport, or badge hit every 0.35-0.8s",
      cameraDirection: "tight alternating close-ups between prompt and terminal panels",
      sound: "typing ticks, terminal wipe, and badge hit",
      soundTrigger: "typed prompt, terminal proof reveal, and review badge landing",
      intensity: "medium-high",
      mixLevel: -18
    },
    "split-screen-proof": {
      editDensity: "proof highlight every 0.8-1.2s",
      cameraDirection: "split-screen slide with a small zoom on the proof pane",
      sound: "keyboard ticks with a success ding",
      soundTrigger: "receipt highlight and proof pane zoom",
      intensity: "medium",
      mixLevel: -19
    },
    proof: {
      editDensity: "playhead or connector movement every 0.7-1.0s",
      cameraDirection: "editor-panel push with active lane highlight snaps",
      sound: "playhead ticks and connector pops",
      soundTrigger: "script-to-visual connector highlights",
      intensity: "medium",
      mixLevel: -20
    },
    transformation: {
      editDensity: "tile arrival every 0.5-0.9s, then one stack snap",
      cameraDirection: "orbiting card stack feel using alternating scale and rotation",
      sound: "stack snaps and soft paper hits",
      soundTrigger: "each output tile snapping into the launch packet",
      intensity: "medium-high",
      mixLevel: -18
    },
    steps: {
      editDensity: "step card every 0.8-1.2s",
      cameraDirection: "numbered card push with progress line follow",
      sound: "stack snaps and soft paper hits",
      soundTrigger: "each step card entering",
      intensity: "medium",
      mixLevel: -19
    },
    "artifact-reveal": {
      editDensity: "file flash every 0.6-0.9s with quick inspection holds",
      cameraDirection: "zoom punches on active artifacts, then quick return to the grid",
      sound: "file flips, camera ticks, and inspection pops",
      soundTrigger: "active file card flips and zoom punches",
      intensity: "high",
      mixLevel: -16
    },
    artifacts: {
      editDensity: "file flash every 0.8-1.1s",
      cameraDirection: "zoom punches on active artifacts, then quick return to the grid",
      sound: "file flips, camera ticks, and inspection pops",
      soundTrigger: "active file card flips",
      intensity: "high",
      mixLevel: -16
    },
    cta: {
      editDensity: "one clean punch-in, two check ticks, then final hold",
      cameraDirection: "calm final push to approval boundary and repo URL",
      sound: "two checklist ticks into a quiet final hold",
      soundTrigger: "approval checks ticking on",
      intensity: "low-medium",
      mixLevel: -21
    }
  };
  return directions[beat] ?? directions.cta;
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
    for (const field of ["layout", "composition", "media_slots", "motion_grammar", "typography", "color_grade", "edit_density", "camera_direction", "sound_design", "success_criteria"]) {
      if (!scene[field] || (Array.isArray(scene[field]) && !scene[field].length)) {
        issues.push(`Creative storyboard scene ${label} is missing ${field}.`);
      }
    }
    if (isPremiumStyle(video.style)) {
      for (const field of ["asset_aliases", "micro_events", "camera_path", "sfx_cues", "brand_moments"]) {
        if (!scene[field] || (Array.isArray(scene[field]) && !scene[field].length)) {
          issues.push(`Premium storyboard scene ${label} is missing ${field}.`);
        }
      }
      for (const field of ["motion_blur", "depth_layer", "type_sequences"]) {
        if (!(field in scene)) {
          issues.push(`Premium storyboard scene ${label} is missing ${field}.`);
        }
      }
    }
  }
  return issues;
}

function isPremiumStyle(style) {
  return style === PREMIUM_PRODUCT_STYLE;
}

function isSocialReadyStyle(style) {
  return style === "ugc-split" || style === "ugc-demo-punchy" || isPremiumStyle(style);
}

function buildCreativeStoryboard(style, manifest, script, stylePreset, talkingHead = { enabled: false, provider: "none" }) {
  if (isPremiumStyle(style)) {
    return buildPremiumCreativeStoryboard(manifest, script, stylePreset, talkingHead);
  }
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
      const direction = beatProductionDirection(segment.beat);
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
        edit_density: direction.editDensity,
        camera_direction: direction.cameraDirection,
        sound_design: direction.sound,
        success_criteria: [
          "viewer understands the beat while muted",
          "visual proves or dramatizes the spoken line",
          "scene has at least one animated foreground element"
        ]
      };
    })
  };
}

function buildPremiumCreativeStoryboard(manifest, script, stylePreset, talkingHead = { enabled: false, provider: "none" }) {
  const repoName = stripMarkdown(manifest.source_repo.name);
  const timeline = script.timeline ?? [];
  return {
    schema_version: "launchclip.storyboard.v1",
    intent: `${repoName} should feel like a reference-grade vertical product Short: fluid product proof, branded assets, physical object motion, prompt typing, and dense SFX cues.`,
    creative_positioning: stylePreset.angle,
    renderer_priority: ["remotion", "hyperframes", "product-videogen", "local-ffmpeg"],
    asset_manifest: {
      schema_version: ASSET_MANIFEST_SCHEMA,
      expected_file: ASSET_MANIFEST_FILE,
      required_aliases: [...PREMIUM_REQUIRED_ASSET_ALIASES],
      optional_aliases: [...PREMIUM_OPTIONAL_ASSET_ALIASES]
    },
    non_goals: [
      "Do not auto-fetch logos or media from the web.",
      "Do not call external voice, SFX, video, or social posting APIs.",
      "Do not use static text-card-only sections longer than 1.2 seconds.",
      "Do not replace LaunchclipSocial; premium is a separate renderer path."
    ],
    quality_gates: [
      "every 0.4-1.2 seconds changes camera, object, focus, text, asset, or SFX",
      "at least three scenes use depth, motion blur, or physical card/file choreography",
      "at least three branded/product assets appear when supplied in the manifest",
      "at least one prompt or terminal sequence types with cursor timing",
      "SFX cues exist for throws, typing, card settles, and transition hits",
      "missing assets render as fallback tokens while validation reports exact aliases"
    ],
    presenter_direction: talkingHead.enabled
      ? `${talkingHead.provider} presenter footage is an adapter-ready cutaway layer, never required for the local renderer.`
      : "Presenter cutaways render as stylized placeholders until a talking-head provider supplies footage.",
    scenes: timeline.map((segment, index) => {
      const profile = premiumSceneProfile(segment.beat);
      const direction = beatProductionDirection(segment.beat);
      return {
        id: segment.beat,
        order: index + 1,
        time_range: segment.time_range,
        target_seconds: segment.target_seconds,
        hook: segment.caption,
        voiceover: segment.voiceover,
        evidence_source: segment.evidence_source,
        adapter_target: segment.adapter_target,
        layout: profile.layout,
        composition: profile.composition,
        media_slots: profile.mediaSlots,
        motion_grammar: profile.motionGrammar,
        typography: profile.typography,
        color_grade: profile.colorGrade,
        caption_emphasis: segment.caption_emphasis ?? [],
        transition: segment.transition,
        edit_density: direction.editDensity,
        camera_direction: direction.cameraDirection,
        sound_design: direction.sound,
        asset_aliases: profile.assetAliases,
        micro_events: profile.microEvents,
        camera_path: profile.cameraPath,
        motion_blur: profile.motionBlur,
        depth_layer: profile.depthLayer,
        type_sequences: profile.typeSequences,
        sfx_cues: profile.sfxCues,
        brand_moments: profile.brandMoments,
        success_criteria: [
          "beat reads clearly while muted",
          "foreground object moves continuously or settles physically",
          "audio cue can be replaced by a future SFX adapter without changing timing"
        ]
      };
    })
  };
}

function premiumSceneProfile(beat) {
  const common = {
    typography: "dense but readable mixed-case captions, compact labels, monospace only inside typed prompt or terminal panels",
    colorGrade: "soft off-white, black, deep green, muted grey, and sparse brand accents from supplied assets",
    motionBlur: {
      method: "synthetic ghost layers plus directional CSS blur while velocity is high",
      frames: [0, 8, 18],
      settle: "blur decays during spring settle and overshoot"
    },
    depthLayer: {
      foreground: "physical cards/files, logos, cursor, presenter cutaway",
      midground: "prompt panels, collage board, terminal, proof cards",
      background: "soft grid, paper plane, depth shadows, focus wash"
    }
  };
  const profiles = {
    "cold-open": {
      layout: "full-frame premium product hook with floating asset tokens and presenter cutaway",
      composition: "repo lockup, large payoff caption, logo tokens, and proof cards already in motion on frame one",
      mediaSlots: ["repo-logo", "presenter-cutaway", "claude-code", "obsidian", "github"],
      motionGrammar: ["camera push", "logo orbit", "card settle", "caption slam"],
      assetAliases: ["claude-code", "obsidian", "github", "repo-logo"],
      microEvents: [
        "0.0s logo tokens already drifting in depth",
        "0.4s caption slams with blur ghost",
        "0.8s repo proof card flips forward",
        "1.2s presenter window pops then recedes"
      ],
      cameraPath: [
        { t: 0, scale: 1.08, x: -18, y: 22, rotate: -1.4 },
        { t: 0.55, scale: 1.0, x: 0, y: 0, rotate: 0 },
        { t: 1, scale: 1.05, x: 10, y: -16, rotate: 0.5 }
      ],
      typeSequences: [],
      sfxCues: ["whoosh-in", "caption-hit", "card-paper-settle"],
      brandMoments: ["claude-code token", "obsidian token", "github token"]
    },
    "retro-terminal": {
      layout: "retro computer terminal hero with glowing display and typed command",
      composition: "terminal device floats above a paper desk while proof text types with cursor ticks",
      mediaSlots: ["terminal-demo", "github"],
      motionGrammar: ["screen glow pulse", "cursor typing", "camera dolly", "scanline sweep"],
      assetAliases: ["terminal-demo", "github"],
      microEvents: [
        "terminal rises from blur",
        "command types in three bursts",
        "receipt badge stamps",
        "screen glow pulses on pass state"
      ],
      cameraPath: [
        { t: 0, scale: 0.96, x: 24, y: -10, rotate: 1.2 },
        { t: 0.45, scale: 1.04, x: -6, y: 8, rotate: -0.4 },
        { t: 1, scale: 1.02, x: 0, y: -12, rotate: 0 }
      ],
      typeSequences: [{ source_alias: "terminal-demo", start: 0.18, cursor: "block", sfx: "typing-ticks" }],
      sfxCues: ["keyboard-ticks", "soft-success-ding", "screen-power-hum"],
      brandMoments: ["github proof chip"]
    },
    "asset-orbit": {
      layout: "branded tool constellation with connected cards and depth shadows",
      composition: "Claude Code, Obsidian, and GitHub tokens orbit prompt and file cards before snapping into a workflow line",
      mediaSlots: ["claude-code", "obsidian", "github"],
      motionGrammar: ["3D-ish token orbit", "connector draw", "depth focus rack", "snap settle"],
      assetAliases: ["claude-code", "obsidian", "github"],
      microEvents: [
        "Claude Code token throws in from left",
        "Obsidian token rotates through foreground",
        "GitHub token snaps to proof card",
        "connectors draw between tools"
      ],
      cameraPath: [
        { t: 0, scale: 1.03, x: -34, y: 0, rotate: -1 },
        { t: 0.5, scale: 1.08, x: 14, y: -20, rotate: 0.8 },
        { t: 1, scale: 1.0, x: 0, y: 10, rotate: 0 }
      ],
      typeSequences: [],
      sfxCues: ["logo-whip", "connector-pop", "snap-click"],
      brandMoments: ["Claude Code", "Obsidian", "GitHub"]
    },
    "prompt-compose": {
      layout: "prompt composer with typed instructions, asset pills, and cursor-led edits",
      composition: "a large prompt card types exact instructions while asset tokens become chips in the prompt",
      mediaSlots: ["prompt-example", "claude-code", "obsidian"],
      motionGrammar: ["typewriter reveal", "cursor blink", "asset chip drop", "panel zoom"],
      assetAliases: ["prompt-example", "claude-code", "obsidian"],
      microEvents: [
        "prompt panel throws in with blur",
        "first line types",
        "asset chips drop into prompt",
        "cursor jumps to final instruction"
      ],
      cameraPath: [
        { t: 0, scale: 0.94, x: 0, y: 38, rotate: 0 },
        { t: 0.35, scale: 1.07, x: -12, y: -14, rotate: -0.4 },
        { t: 1, scale: 1.02, x: 8, y: -26, rotate: 0.2 }
      ],
      typeSequences: [{ source_alias: "prompt-example", start: 0.1, cursor: "thin", sfx: "typing-ticks" }],
      sfxCues: ["keyboard-ticks", "chip-drop", "panel-zoom-whoosh"],
      brandMoments: ["Claude Code chip", "Obsidian chip"]
    },
    "collage-proof": {
      layout: "collage board of generated assets and review artifacts",
      composition: "cards, thumbnails, captions, and receipt panels fill a board, each with quick inspection zooms",
      mediaSlots: ["terminal-demo", "prompt-example", "repo-logo"],
      motionGrammar: ["grid shuffle", "inspection punch", "paper flip", "focus rack"],
      assetAliases: ["terminal-demo", "prompt-example", "repo-logo"],
      microEvents: [
        "board slides into depth",
        "caption card flips active",
        "terminal receipt punches forward",
        "thumbnail tile glints"
      ],
      cameraPath: [
        { t: 0, scale: 1.1, x: 28, y: 10, rotate: 1.5 },
        { t: 0.55, scale: 0.98, x: -16, y: -18, rotate: -0.8 },
        { t: 1, scale: 1.04, x: 6, y: -6, rotate: 0.3 }
      ],
      typeSequences: [],
      sfxCues: ["paper-flip", "camera-tick", "inspection-pop"],
      brandMoments: ["repo lockup if supplied"]
    },
    "folder-stack": {
      layout: "soft 3D folder/file stack rotating through foreground",
      composition: "a physical launch packet folder rotates and throws files toward the viewer before snapping into a stack",
      mediaSlots: ["repo-logo", "github"],
      motionGrammar: ["3D folder rotate", "blurred throw", "file stack settle", "shadow sweep"],
      assetAliases: ["repo-logo", "github"],
      microEvents: [
        "folder stack rotates in 3D",
        "file cards throw outward with blur",
        "GitHub proof chip sticks to folder",
        "stack lands with overshoot"
      ],
      cameraPath: [
        { t: 0, scale: 0.9, x: 40, y: 46, rotate: 2 },
        { t: 0.5, scale: 1.12, x: -18, y: -34, rotate: -1.2 },
        { t: 1, scale: 1.03, x: 0, y: 0, rotate: 0 }
      ],
      typeSequences: [],
      sfxCues: ["folder-whoosh", "paper-hit", "stack-thump"],
      brandMoments: ["repo/product logo", "GitHub chip"]
    },
    "type-demo": {
      layout: "close prompt and terminal demo with cursor timing and SFX hits",
      composition: "typed prompt line transforms into terminal proof and review-ready output badges",
      mediaSlots: ["prompt-example", "terminal-demo"],
      motionGrammar: ["prompt typing", "terminal wipe", "cursor teleport", "badge hit"],
      assetAliases: ["prompt-example", "terminal-demo"],
      microEvents: [
        "prompt types with audible ticks",
        "cursor selects asset alias",
        "terminal line wipes in",
        "review badge lands"
      ],
      cameraPath: [
        { t: 0, scale: 1.05, x: -20, y: -24, rotate: -0.6 },
        { t: 0.42, scale: 1.0, x: 16, y: 12, rotate: 0.4 },
        { t: 1, scale: 1.08, x: -4, y: -18, rotate: 0 }
      ],
      typeSequences: [
        { source_alias: "prompt-example", start: 0.05, cursor: "thin", sfx: "typing-ticks" },
        { source_alias: "terminal-demo", start: 0.52, cursor: "block", sfx: "terminal-ticks" }
      ],
      sfxCues: ["typing-ticks", "terminal-wipe", "badge-hit"],
      brandMoments: ["prompt asset alias", "terminal demo asset"]
    },
    cta: {
      layout: "premium review-safe CTA with calm camera push and asset lockup",
      composition: "all key tokens settle around final approval boundary, repo URL, and generated packet summary",
      mediaSlots: ["repo-logo", "claude-code", "obsidian", "github"],
      motionGrammar: ["final camera push", "check ticks", "asset settle", "soft hold"],
      assetAliases: ["claude-code", "obsidian", "github", "repo-logo"],
      microEvents: [
        "approval checks tick on",
        "tokens settle into lockup",
        "repo URL comes into focus",
        "final hold breathes"
      ],
      cameraPath: [
        { t: 0, scale: 1.02, x: 0, y: 16, rotate: 0 },
        { t: 1, scale: 1.08, x: 0, y: -12, rotate: 0 }
      ],
      typeSequences: [],
      sfxCues: ["check-tick", "check-tick", "quiet-final-hit"],
      brandMoments: ["final brand lockup", "repo logo if supplied"]
    }
  };
  return { ...common, ...(profiles[beat] ?? profiles.cta) };
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

function premiumProductStructure(manifest) {
  return [
    { beat: "cold-open", seconds: 2.5, instruction: `Open already in motion: ${manifest.source_repo.name} becomes a premium product Short.` },
    { beat: "retro-terminal", seconds: 5.5, instruction: "Show a retro terminal/device proof moment with typed command, glow, timer, and receipt stamp." },
    { beat: "asset-orbit", seconds: 6, instruction: "Orbit branded tool assets, snapping Claude Code, Obsidian, and GitHub into one workflow." },
    { beat: "prompt-compose", seconds: 7, instruction: "Type a precise prompt panel with asset chips, cursor timing, and satisfying keystroke SFX." },
    { beat: "collage-proof", seconds: 8, instruction: "Reveal a collage board of generated assets, captions, thumbnails, and review receipts." },
    { beat: "folder-stack", seconds: 7, instruction: "Rotate and throw a soft 3D folder/file stack through the foreground with motion blur." },
    { beat: "type-demo", seconds: 7, instruction: "Cut close to prompt and terminal typing that proves the demo and renderer can follow exact instructions." },
    { beat: "cta", seconds: 5, instruction: "End with a calm premium lockup: review the packet before anything posts." }
  ];
}

function videoStylePreset(style, manifest, talkingHead = { enabled: false, provider: "none" }) {
  if (isPremiumStyle(style)) {
    return {
      duration_seconds: 48,
      angle: "Make the repo feel like a polished creator-grade product Short: fluid motion, physical cards/files, branded assets, typed prompt proof, dense SFX cues, and review-safe Launchclip evidence.",
      briefBeats: [
        "Open in motion; no static title card.",
        "Use a retro terminal proof moment with typed command and cursor sounds.",
        "Bring named product assets into the edit through the local manifest.",
        "Type the prompt or demo instructions on-screen with believable timing.",
        "Use physical object choreography: cards slide, rotate, blur, settle, and throw away.",
        "Finish with review-before-posting, not live social submission."
      ],
      structure: premiumProductStructure(manifest),
      recipe: {
        preset: PREMIUM_PRODUCT_STYLE,
        aspect_ratio: "9:16",
        duration_seconds: 48,
        resolution: { width: 720, height: 1280, fps: 30 },
        layout: [
          "0-2.5s: moving premium hook with branded tokens and presenter cutaway.",
          "2.5-8s: retro terminal/device proof with typed command, glow, and receipt stamp.",
          "8-14s: branded asset orbit and connector choreography.",
          "14-21s: prompt composer with cursor timing and chip drops.",
          "21-29s: collage proof board with inspection punches.",
          "29-36s: soft 3D folder/file stack rotating and throwing cards.",
          "36-43s: close prompt/terminal type demo with badge hits.",
          "43-48s: calm review-safe CTA lockup."
        ],
        visual_language: {
          palette: "soft off-white, deep black, Launchclip green, muted graphite, and sparse brand accents from supplied assets",
          motion: "continuous camera/object movement; visible change every 0.4-1.2 seconds",
          depth: "foreground physical objects, midground prompt/terminal surfaces, soft background grid and focus washes",
          motion_blur: "synthetic ghost layers, directional CSS blur, overshoot, and spring settle",
          assets: "local manifest only; missing aliases become fallback tokens",
          captions: "short kinetic emphasis captions, not full paragraph cards",
          sound_design: "whooshes, ticks, paper hits, terminal typing, check ticks, and quiet final hit",
          production_layers: ["camera_path", "depth_layer", "micro_events", "type_sequences", "brand_moments", "sfx_cues"]
        },
        renderer_contract: {
          adapter: "launchclip.premium-remotion-render.v1",
          composition_id: "LaunchclipPremiumShort",
          public_dir: "video/render-public",
          required_asset_aliases: [...PREMIUM_REQUIRED_ASSET_ALIASES],
          fallback_composition_id: "LaunchclipSocial",
          external_api_policy: "No ElevenLabs, HyperFrames, SFX provider, product-videogen live submit, or social posting calls in this renderer."
        },
        generation_notes: [
          "Do not auto-fetch logos; only use launchclip-assets.json.",
          "Store SFX as adapter-ready cues and local synthetic sounds.",
          talkingHead.enabled ? `Presenter generation can map to ${talkingHead.provider}, but local render uses a placeholder until media is supplied.` : "Presenter slot remains adapter-ready.",
          "Every claim must trace to repo metadata, demo evidence, or Launchclip-generated artifacts."
        ]
      }
    };
  }
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
          camera: punchy ? "constant subtle push, whip-pan transitions, and zoom punches on proof or artifact changes" : "presenter-led push-ins with restrained proof-pane zooms",
          sound_design: "short whooshes for layout changes, soft ticks for typing/checks/files, no loud meme sounds, duck under voiceover",
          transitions: ["jump cut", "zoom punch", "caption slam", "receipt flash", "artifact whip"],
          social_readiness: ["first-frame hook", "caption on every beat", "visible proof", "artifact payoff", "approval-safe CTA"],
          production_layers: ["voiceover", "kinetic captions", "camera movement", "proof graphics", "sound effects"]
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
          remotion: "Render the social-ready composition from video/remotion-props.json with frame-based motion graphics, kinetic captions, dynamic camera motion, local SFX cues, animated proof panels, and artifact cards.",
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
  if (isPremiumStyle(style)) {
    const timeline = [
      {
        beat: "cold-open",
        time_range: "0-2.5s",
        target_seconds: 2.5,
        voiceover: `${repoName} can start from real repo proof and turn it into a premium product Short.`,
        caption: "Repo proof to premium Short",
        visual: "Floating branded tokens, repo lockup, presenter cutaway, and proof cards move before the first spoken word lands.",
        evidence_source: "launchclip workspace metadata",
        adapter_target: "remotion",
        caption_emphasis: ["repo proof", "premium Short"],
        motion: "logo orbit, camera push, caption slam, blurred proof card settle",
        transition: "blurred object throw"
      },
      {
        beat: "retro-terminal",
        time_range: "2.5-8s",
        target_seconds: 5.5,
        voiceover: `The edit starts with the actual demo run, typed like a product moment instead of a static terminal dump.`,
        caption: "Proof that types",
        visual: "Retro terminal/device floats in depth; command types, timer sweeps, receipt stamps green.",
        evidence_source: "demo/terminal.txt and demo/command-receipt.json",
        adapter_target: "remotion",
        caption_emphasis: ["actual demo", "typed"],
        motion: "terminal rise, screen glow, cursor typing, receipt stamp",
        transition: "screen glow wipe"
      },
      {
        beat: "asset-orbit",
        time_range: "8-14s",
        target_seconds: 6,
        voiceover: `When the script names Claude Code, Obsidian, or GitHub, the renderer can pull the matching local asset.`,
        caption: "Named tools show up",
        visual: "Claude Code, Obsidian, and GitHub logo tokens orbit prompt cards, then snap into a connected workflow.",
        evidence_source: "local launchclip-assets.json manifest",
        adapter_target: "remotion",
        caption_emphasis: ["Claude Code", "Obsidian", "GitHub"],
        motion: "token orbit, connector draw, focus rack, snap settle",
        transition: "logo whip pan"
      },
      {
        beat: "prompt-compose",
        time_range: "14-21s",
        target_seconds: 7,
        voiceover: `The prompt can be art-directed second by second: what to type, when the cursor moves, and which assets drop in.`,
        caption: "Art direct every second",
        visual: "Prompt composer types exact instructions while asset chips drop into the line with cursor ticks.",
        evidence_source: "video/video.json premium storyboard type_sequences",
        adapter_target: "remotion",
        caption_emphasis: ["prompt", "cursor", "assets"],
        motion: "typewriter reveal, chip drops, panel zoom, cursor blink",
        transition: "panel zoom punch"
      },
      {
        beat: "collage-proof",
        time_range: "21-29s",
        target_seconds: 8,
        voiceover: `Then the outputs become a moving proof board: captions, thumbnail, render plan, and review packet in one place.`,
        caption: "The proof board",
        visual: "Collage board of generated artifacts shuffles in; cards punch forward for brief inspection moments.",
        evidence_source: "generated workspace files",
        adapter_target: "remotion",
        caption_emphasis: ["captions", "thumbnail", "review"],
        motion: "paper flips, grid shuffle, inspection zoom, focus rack",
        transition: "paper flip wipe"
      },
      {
        beat: "folder-stack",
        time_range: "29-36s",
        target_seconds: 7,
        voiceover: `The launch packet should feel physical, with folders and files sliding, rotating, blurring, and landing on beat.`,
        caption: "Make it physical",
        visual: "Soft 3D folder stack rotates through foreground, throws files outward, then snaps into one launch packet.",
        evidence_source: "video/render-plan.json and generated packet artifacts",
        adapter_target: "remotion-three",
        caption_emphasis: ["physical", "folders", "files"],
        motion: "3D stack rotate, blurred throw, overshoot settle, shadow sweep",
        transition: "3D folder throw"
      },
      {
        beat: "type-demo",
        time_range: "36-43s",
        target_seconds: 7,
        voiceover: `And the type moments stay editable: prompt text, terminal text, cursor timing, and sound cues are all in the plan.`,
        caption: "Typing stays editable",
        visual: "Prompt and terminal panels alternate close-up typing, cursor jumps, and review-ready badge hits.",
        evidence_source: "video/video.json type_sequences and sfx_cues",
        adapter_target: "remotion",
        caption_emphasis: ["typing", "cursor", "sound cues"],
        motion: "typed prompt, terminal wipe, cursor teleport, badge hit",
        transition: "typed match cut"
      },
      {
        beat: "cta",
        time_range: "43-48s",
        target_seconds: 5,
        voiceover: `Review the packet, swap in better assets, then approve only when the claims and visuals line up.`,
        caption: "Review. Swap. Approve.",
        visual: "Final product lockup with asset tokens settled around review-safe approval checks and repo URL.",
        evidence_source: "review/product-videogen-review.dry-run.json",
        adapter_target: "remotion",
        caption_emphasis: ["review", "swap", "approve"],
        motion: "asset settle, check ticks, calm camera push, final hold",
        transition: "soft final hold"
      }
    ];
    return {
      schema_version: "launchclip.script.v1",
      style,
      strategy: "premium creator-product script with branded asset choreography, typed proof moments, physical depth, and adapter-ready SFX cues",
      duration_seconds: 48,
      voice: {
        provider: talkingHead.enabled ? talkingHead.provider : "none",
        avatar_id: talkingHead.avatar_id ?? null,
        delivery: "confident, precise, premium product-demo narration with room for SFX and typing beats"
      },
      summary_line: summary || "turns local demo evidence into a premium launch packet short",
      timeline,
      alignment_rules: [
        "Every beat must include motion and transition guidance.",
        "Every storyboard scene must declare asset_aliases, micro_events, camera_path, motion_blur, depth_layer, type_sequences, sfx_cues, and brand_moments.",
        "Use only local manifest assets and render fallbacks for missing aliases.",
        "No static text-card-only sequence may last longer than 1.2 seconds.",
        "External providers receive adapter-ready cues only; local rendering must not call them."
      ]
    };
  }
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
  const voiceover = await optionalJson(path.join(out, "video", "voiceover.json"));
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
    voiceover: voiceover ?? video.voiceover ?? null,
    soundDesign: video.sound_design ?? null,
    timeline: video.script_visual_alignment ?? video.script?.timeline ?? [],
    storyboard: video.creative_storyboard ?? null,
    creativeRecipe: video.creative_recipe,
    talkingHead: video.talking_head,
    assets: video.assets ?? null,
    publicAssets: renderOptions.publicAssets ?? null,
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
  const beat = scene.segment ?? {};
  const local = scene.local ?? 0;
  const margin = Math.round(width * 0.06);
  const safeW = width - margin * 2;
  const titleScale = Math.max(5, Math.round(width / 105));
  const bodyScale = Math.max(3, Math.round(width / 190));
  const smallScale = Math.max(2, Math.round(width / 310));
  const palette = socialPalette(scene.name, Math.floor(time * 2) % 2);

  fillRect(pixels, width, 0, 0, width, height, palette.bg);
  drawText(pixels, width, height, "LAUNCHCLIP", margin, Math.round(height * 0.035), smallScale, palette.muted);

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
    drawTextBox(pixels, width, height, "Open packet", margin, Math.round(height * 0.66), safeW, Math.round(height * 0.08), bodyScale, palette.accent, { maxLines: 1 });
    drawTextBox(pixels, width, height, shorten(content.url, 54), margin, Math.round(height * 0.77), safeW, Math.round(height * 0.06), smallScale, palette.text, { maxLines: 1 });
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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
