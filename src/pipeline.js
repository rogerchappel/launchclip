import { execFile } from "node:child_process";
import { access, copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { prepareSfxPack } from "./sfx.js";

const execFileAsync = promisify(execFile);
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PREMIUM_PRODUCT_STYLE = "premium-product-short";
const DATA_STORY_BENCHMARK_STYLE = "data-story-benchmark";
const ASSET_MANIFEST_SCHEMA = "launchclip.assets.v1";
const ASSET_MANIFEST_FILE = "launchclip-assets.json";
const ART_DIRECTION_SCHEMA = "launchclip.art-direction.v1";
const HYPERFRAMES_PROJECT_DIR = "video/hyperframes";
const HYPERFRAMES_REQUIRED_TEMPLATE_FAMILIES = ["brand_token", "terminal_ui", "diagram", "prompt_ui", "chart", "folder_stack", "cta_card"];
const HYPERFRAMES_STATIC_HOLD_THRESHOLD_SECONDS = 1.2;
const HYPERFRAMES_DEFAULT_SFX_BY_FAMILY = {
  "connector-pop": "pop.wav",
  "paper-hit": "pop.wav",
  "soft-thump": "cinematic_boom.wav",
  "success-ding": "retro_success.wav",
  "typing-tick": "single_type.wav",
  "ui-hit": "tick.wav",
  "warning-tap": "bell.wav",
  whoosh: "fast_whoosh.wav"
};
const HYPERFRAMES_MAX_POST_RENDER_SFX_CUES = 64;
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
  const objectLifecycle = buildHyperframesObjectLifecycle(creativeStoryboard, duration);
  const artDirection = buildArtDirectionContract(style, manifest, stylePreset, script, creativeStoryboard, assets, talkingHead, objectLifecycle);
  const hyperframes = buildHyperframesHandoff(videoTitle(manifest), duration, objectLifecycle);
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
    object_lifecycle: objectLifecycle,
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
      hyperframes: "Open video/hyperframes/index.html with HyperFrames. Start with video/hyperframes/QUALITY.md, then check template-qa.html, chart-diagram-qa.html, asset-readiness.html, and sfx-manifest.json before linting, previewing, and rendering.",
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
      hyperframes_project: HYPERFRAMES_PROJECT_DIR,
      hyperframes_template_qa: `${HYPERFRAMES_PROJECT_DIR}/template-qa.html`,
      hyperframes_sfx_manifest: `${HYPERFRAMES_PROJECT_DIR}/sfx-manifest.json`,
      hyperframes_asset_readiness: `${HYPERFRAMES_PROJECT_DIR}/asset-readiness.html`,
      hyperframes_chart_diagram_qa: `${HYPERFRAMES_PROJECT_DIR}/chart-diagram-qa.html`,
      hyperframes_quality_checklist: `${HYPERFRAMES_PROJECT_DIR}/QUALITY.md`
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
  const defaultDuration = defaultRendererDuration(video, "remotion");
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
    ".",
    "--output",
    output,
    "--quality",
    flags.quality ?? "high"
  ];
  if (flags.fps) renderArgs.push("--fps", String(flags.fps));
  if (flags.format) renderArgs.push("--format", String(flags.format));
  await execFileAsync("npx", renderArgs, { cwd: projectDir, maxBuffer: 1024 * 1024 * 16 });
  const audio = await applyPostRenderAudio(out, output, flags, { defaultVoiceover: true, defaultMusic: false, defaultSfx: true });
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
      voiceover_audio: audio.voiceoverAudio,
      music_audio: audio.musicAudio,
      sfx_audio_cues: audio.sfxCueCount,
      sfx_audio_assets: audio.sfxAssetCount,
      audio_mix: audio.applied ? "local-generated" : "none"
    };
  });
  return { stage: "render", mode: "local", provider: "hyperframes", video: output, thumbnail, projectDir, voiceoverAudio: audio.voiceoverAudio, musicAudio: audio.musicAudio, sfxCueCount: audio.sfxCueCount, sfxAssetCount: audio.sfxAssetCount };
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
  const defaultDuration = defaultRendererDuration(video, "local-ffmpeg");
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
  const audio = await applyPostRenderAudio(out, videoPath, flags, { defaultVoiceover: false, defaultMusic: false });
  return audio.voiceoverAudio;
}

async function applyPostRenderAudio(out, videoPath, flags = {}, options = {}) {
  const videoDuration = await mediaDurationSeconds(videoPath);
  const voiceoverMode = await resolveVoiceoverMode(flags, options);
  const useMusic = shouldGenerateMusicBed(flags, options);
  const voiceoverAudio = voiceoverMode ? await generateVoiceoverAudio(out, flags, voiceoverMode, videoDuration) : null;
  const musicAudio = useMusic ? await generateMusicBedAudio(out, videoDuration) : null;
  const sfxInputs = options.defaultSfx ? await collectPostRenderSfxInputs(out, videoDuration) : [];
  const sfxAssetCount = new Set(sfxInputs.map((input) => input.assetId)).size;
  if (!voiceoverAudio && !musicAudio && !sfxInputs.length) {
    return { applied: false, voiceoverAudio: null, musicAudio: null, sfxCueCount: 0, sfxAssetCount: 0 };
  }

  const mixedPath = path.join(out, "video", "launchclip.audio.mp4");
  const args = ["-y", "-i", videoPath];
  const filters = [];
  const mixInputs = [];
  let inputIndex = 1;
  if (voiceoverAudio) {
    args.push("-i", path.join(out, voiceoverAudio));
    filters.push(`[${inputIndex}:a]volume=1.0,apad[voice]`);
    mixInputs.push("[voice]");
    inputIndex += 1;
  }
  if (musicAudio) {
    args.push("-i", path.join(out, musicAudio));
    filters.push(`[${inputIndex}:a]volume=${voiceoverAudio ? "0.42" : "0.68"},apad[music]`);
    mixInputs.push("[music]");
    inputIndex += 1;
  }
  for (const [index, sfx] of sfxInputs.entries()) {
    args.push("-i", sfx.path);
    const label = `sfx${index}`;
    filters.push(`[${inputIndex}:a]volume=${sfx.volume},adelay=${sfx.delayMs}:all=1,apad[${label}]`);
    mixInputs.push(`[${label}]`);
    inputIndex += 1;
  }
  const mixedFilter = mixInputs.length > 1
    ? `${mixInputs.join("")}amix=inputs=${mixInputs.length}:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95,atrim=0:${videoDuration.toFixed(3)},asetpts=N/SR/TB[a]`
    : `${mixInputs[0]}atrim=0:${videoDuration.toFixed(3)},asetpts=N/SR/TB[a]`;
  const filter = `${filters.join(";")};${mixedFilter}`;
  await execFileAsync("ffmpeg", [
    ...args,
    "-filter_complex",
    filter,
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
    mixedPath
  ], { maxBuffer: 1024 * 1024 * 8 });
  await rename(mixedPath, videoPath);
  return { applied: true, voiceoverAudio, musicAudio, sfxCueCount: sfxInputs.length, sfxAssetCount };
}

async function resolveVoiceoverMode(flags = {}, options = {}) {
  const mode = flags.voiceover ?? flags["voice-over"];
  if (!mode && options.defaultVoiceover) return (await commandExists("say")) ? "local-say" : null;
  if (!mode || mode === "none" || mode === "off") return null;
  if (mode !== "local-say" && mode !== "say") {
    throw new Error(`Unsupported voiceover provider: ${mode}. Supported: local-say`);
  }
  return mode;
}

function shouldGenerateMusicBed(flags = {}, options = {}) {
  const mode = flags.music;
  if (flags["no-music"] || mode === "none" || mode === "off") return false;
  return Boolean(options.defaultMusic || mode === "auto" || mode === "generated" || mode === "local");
}

async function generateVoiceoverAudio(out, flags, mode, videoDuration) {
  const voiceover = await readJson(path.join(out, "video", "voiceover.json"));
  const audioPath = path.join(out, "video", "voiceover.aiff");
  const rawAudioPath = path.join(out, "video", "voiceover.raw.aiff");
  const targetAudioDuration = Math.max(1, videoDuration - 0.85);
  const voiceArgs = flags.voice ? ["-v", flags.voice] : [];
  const requestedRate = flags["voice-rate"] ?? flags.wpm;
  const estimatedRate = Math.round(Math.max(115, Math.min(175, wordCount(voiceover.full_text) / (targetAudioDuration / 60))));
  const rateArgs = ["-r", String(requestedRate ? Number(requestedRate) : estimatedRate)];
  try {
    await execFileAsync("say", [
      ...voiceArgs,
      ...rateArgs,
      "-o",
      rawAudioPath,
      voiceover.full_text
    ], { maxBuffer: 1024 * 1024 * 2 });
  } catch (error) {
    throw new Error(`Could not generate local voiceover with macOS say: ${error.message}`);
  }
  await fitVoiceoverAudio(rawAudioPath, audioPath, targetAudioDuration);
  await rm(rawAudioPath, { force: true });
  return "video/voiceover.aiff";
}

async function generateMusicBedAudio(out, duration) {
  const musicPath = path.join(out, "video", "music-bed.wav");
  await writeFile(musicPath, makeGeneratedMusicBedWav(duration));
  return "video/music-bed.wav";
}

function makeGeneratedMusicBedWav(duration) {
  const sampleRate = 44100;
  const channels = 2;
  const totalSamples = Math.max(1, Math.ceil(duration * sampleRate));
  const dataSize = totalSamples * channels * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  const beatSeconds = 60 / 94;
  const progression = [
    [110, 164.81, 220],
    [98, 146.83, 196],
    [123.47, 185, 246.94],
    [82.41, 164.81, 220]
  ];
  let noiseSeed = 0x6c61756e;

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * 2, 28);
  buffer.writeUInt16LE(channels * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let index = 0; index < totalSamples; index += 1) {
    const t = index / sampleRate;
    const beatIndex = Math.floor(t / beatSeconds);
    const beatPhase = t - beatIndex * beatSeconds;
    const eighthPhase = t - Math.floor(t / (beatSeconds / 2)) * (beatSeconds / 2);
    const chord = progression[Math.floor(t / (beatSeconds * 4)) % progression.length];
    noiseSeed = (noiseSeed * 1664525 + 1013904223) >>> 0;
    const noise = (noiseSeed / 0xffffffff) * 2 - 1;
    const fade = Math.min(1, t / 0.45, (duration - t) / 0.35);
    const sidechain = 1 - 0.32 * Math.exp(-beatPhase * 11);
    const pad = chord.reduce((sum, frequency, chordIndex) => {
      const detune = chordIndex === 1 ? 1.003 : chordIndex === 2 ? 0.997 : 1;
      return sum + Math.sin(2 * Math.PI * frequency * detune * t) * (0.023 / (chordIndex + 1));
    }, 0) * sidechain;
    const bass = Math.sin(2 * Math.PI * chord[0] * 0.5 * t) * Math.exp(-beatPhase * 3.6) * 0.045;
    const arpStep = Math.floor(t / (beatSeconds / 2));
    const arpPhase = eighthPhase;
    const arp = Math.sin(2 * Math.PI * chord[arpStep % chord.length] * 2 * t) * Math.exp(-arpPhase * 12) * 0.035;
    const kick = Math.sin(2 * Math.PI * (48 + 42 * Math.exp(-beatPhase * 18)) * t) * Math.exp(-beatPhase * 13) * 0.13;
    const snarePhase = beatIndex % 4 === 2 ? beatPhase : 1;
    const snare = snarePhase < 0.18 ? noise * Math.exp(-snarePhase * 20) * 0.035 : 0;
    const hat = noise * Math.exp(-eighthPhase * 38) * 0.014;
    const sample = clampSample((pad + bass + arp + kick + snare + hat) * Math.max(0, fade) * 0.92);
    const left = clampSample(sample + pad * 0.16);
    const right = clampSample(sample - pad * 0.16);
    buffer.writeInt16LE(Math.round(left * 32767), 44 + index * channels * 2);
    buffer.writeInt16LE(Math.round(right * 32767), 44 + index * channels * 2 + 2);
  }
  return buffer;
}

function clampSample(value) {
  return Math.max(-1, Math.min(1, value));
}

async function collectPostRenderSfxInputs(out, videoDuration) {
  const sfxManifest = await optionalJson(path.join(out, HYPERFRAMES_PROJECT_DIR.replace(/\//g, path.sep), "sfx-manifest.json"));
  if (!sfxManifest) return [];
  const assetsById = new Map((sfxManifest.assets ?? [])
    .filter((asset) => asset.status === "available-local-asset" && asset.path)
    .map((asset) => [asset.id, asset]));
  const cues = [...(sfxManifest.cues ?? []), ...(sfxManifest.storyboard_cues ?? [])]
    .map((cue) => ({ ...cue, at: Number(cue.at ?? 0) }))
    .filter((cue) => Number.isFinite(cue.at) && cue.at >= 0 && cue.at < videoDuration)
    .sort((a, b) => a.at - b.at)
    .slice(0, HYPERFRAMES_MAX_POST_RENDER_SFX_CUES);
  const inputs = [];
  for (const cue of cues) {
    const asset = assetsById.get(cue.asset_id);
    if (!asset) continue;
    const filePath = path.join(out, HYPERFRAMES_PROJECT_DIR.replace(/\//g, path.sep), asset.path);
    if (!(await fileExists(filePath))) continue;
    inputs.push({
      assetId: asset.id,
      cueId: cue.id,
      path: filePath,
      delayMs: Math.max(0, Math.round(cue.at * 1000)),
      volume: postRenderSfxVolume(cue, asset)
    });
  }
  return inputs;
}

function postRenderSfxVolume(cue, asset) {
  const gainDb = Number(cue.gain_db ?? asset.gain_db ?? -18);
  const linear = Math.pow(10, gainDb / 20) * 2.25;
  return Math.max(0.035, Math.min(0.62, linear)).toFixed(4);
}

async function commandExists(command) {
  try {
    await execFileAsync("which", [command], { maxBuffer: 1024 * 8 });
    return true;
  } catch {
    return false;
  }
}

async function fitVoiceoverAudio(inputPath, outputPath, targetDuration) {
  const duration = await mediaDurationSeconds(inputPath);
  if (Math.abs(duration - targetDuration) <= 0.25) {
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
  while (remaining < 0.5) {
    filters.push("atempo=0.5");
    remaining /= 0.5;
  }
  filters.push(`atempo=${remaining.toFixed(5)}`);
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
- video/hyperframes/template-qa.html
- video/hyperframes/sfx-manifest.json
- video/hyperframes/asset-readiness.html
- video/hyperframes/chart-diagram-qa.html
- video/hyperframes/QUALITY.md
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

export async function analyzeRender(workspacePath, flags = {}) {
  const out = path.resolve(workspacePath);
  const manifest = await readJson(path.join(out, "launchclip.json"));
  const video = await readJson(path.join(out, "video", "video.json"));
  const renderMedia = flags.video ?? manifest.stages.render?.media ?? "video/launchclip-hyperframes.mp4";
  const renderPath = path.isAbsolute(renderMedia) ? renderMedia : path.join(out, renderMedia);
  const hasRenderedVideo = await fileExists(renderPath);
  const media = hasRenderedVideo ? await mediaProbe(renderPath) : null;
  const duration = media?.duration_seconds ?? Number(video.duration_seconds ?? 0);
  const voiceoverPath = manifest.stages.render?.voiceover_audio
    ? path.join(out, manifest.stages.render.voiceover_audio)
    : path.join(out, "video", "voiceover.aiff");
  const voiceoverDuration = await fileExists(voiceoverPath) ? await mediaDurationSeconds(voiceoverPath) : duration;
  const sfxManifest = await optionalJson(path.join(out, HYPERFRAMES_PROJECT_DIR.replace(/\//g, path.sep), "sfx-manifest.json"));
  const sfxCues = [...(sfxManifest?.cues ?? []), ...(sfxManifest?.storyboard_cues ?? [])]
    .map((cue) => ({ ...cue, at: Number(cue.at ?? 0) }))
    .filter((cue) => Number.isFinite(cue.at))
    .sort((a, b) => a.at - b.at);
  const alignment = analyzeVoiceoverAlignment(video, voiceoverDuration || duration);
  const transitionCoverage = analyzeTransitionCoverage(video, sfxCues);
  const sfxAssets = analyzeSfxAssets(sfxManifest);
  const music = analyzeMusicBed(manifest);
  const issues = [
    ...(!hasRenderedVideo ? [`Rendered media is missing: ${renderMedia}`] : []),
    ...(music.generated_local ? ["HyperFrames render used the generated local music bed; use --no-music or a deliberate external bed."] : []),
    ...(alignment.max_abs_drift_seconds > 2.5 ? [`Voiceover segment timing drifts by up to ${alignment.max_abs_drift_seconds}s from visual sections.`] : []),
    ...(transitionCoverage.coverage_ratio < 0.8 ? [`Only ${Math.round(transitionCoverage.coverage_ratio * 100)}% of section transitions have an SFX cue within 0.5s.`] : []),
    ...(sfxAssets.generated_default_assets > 0 ? [`${sfxAssets.generated_default_assets} SFX assets came from generated placeholders instead of real files.`] : [])
  ];
  const warnings = [
    ...(alignment.max_abs_drift_seconds > 1.25 && alignment.max_abs_drift_seconds <= 2.5 ? [`Voiceover alignment is loose: max drift ${alignment.max_abs_drift_seconds}s.`] : []),
    ...(transitionCoverage.coverage_ratio >= 0.8 && transitionCoverage.average_nearest_transition_cue_seconds > 0.25 ? [`Transition SFX exists, but average cue offset is ${transitionCoverage.average_nearest_transition_cue_seconds}s.`] : []),
    ...(music.present && !music.generated_local ? [`Music bed is present: ${music.path}. Confirm it was intentionally chosen.`] : [])
  ];
  const score = Math.max(0, Math.round(
    100
      - (music.generated_local ? 20 : 0)
      - Math.min(25, sfxAssets.generated_default_assets * 5)
      - Math.min(25, Math.max(0, alignment.max_abs_drift_seconds - 0.75) * 8)
      - Math.min(20, Math.max(0, 0.9 - transitionCoverage.coverage_ratio) * 50)
      - (!hasRenderedVideo ? 15 : 0)
  ));
  const result = {
    stage: "analyze-render",
    status: issues.length ? "needs-work" : warnings.length ? "review" : "ready",
    score,
    checked_at: new Date().toISOString(),
    workspace: out,
    media: media ?? { path: renderMedia, missing: true, duration_seconds: duration },
    voiceover: alignment,
    transitions: transitionCoverage,
    sfx_assets: sfxAssets,
    music,
    issues,
    warnings,
    output: "review/render-analysis.json"
  };
  await mkdir(path.join(out, "review"), { recursive: true });
  await writeJson(path.join(out, "review", "render-analysis.json"), result);
  await updateManifest(out, (next) => {
    next.stages.analyze_render = { status: result.status, score, report: "review/render-analysis.json" };
  });
  return result;
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

async function mediaProbe(filePath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=index,codec_type,width,height,r_frame_rate,avg_frame_rate,duration",
    "-of",
    "json",
    filePath
  ], { maxBuffer: 1024 * 256 });
  const data = JSON.parse(stdout);
  const duration = Number(data.format?.duration ?? 0);
  const videoStream = (data.streams ?? []).find((stream) => stream.codec_type === "video") ?? {};
  const audioStream = (data.streams ?? []).find((stream) => stream.codec_type === "audio") ?? {};
  return {
    path: filePath,
    duration_seconds: round(duration),
    width: videoStream.width ?? null,
    height: videoStream.height ?? null,
    fps: videoStream.avg_frame_rate ?? videoStream.r_frame_rate ?? null,
    has_audio: Boolean(audioStream.codec_type),
    audio_duration_seconds: audioStream.duration ? round(Number(audioStream.duration)) : null
  };
}

function analyzeVoiceoverAlignment(video, voiceoverDuration) {
  const segments = Array.isArray(video.script_visual_alignment) ? video.script_visual_alignment : [];
  const totalWords = Math.max(1, segments.reduce((sum, segment) => sum + wordCount(segment.voiceover), 0));
  let cursor = 0;
  const rows = segments.map((segment) => {
    const range = parseTimeRange(segment.time_range);
    const words = wordCount(segment.voiceover);
    const estimatedStart = cursor / totalWords * voiceoverDuration;
    cursor += words;
    const estimatedEnd = cursor / totalWords * voiceoverDuration;
    const startDrift = round(estimatedStart - range.start);
    const endDrift = round(estimatedEnd - range.end);
    const maxDrift = round(Math.max(Math.abs(startDrift), Math.abs(endDrift)));
    return {
      beat: segment.beat,
      time_range: segment.time_range,
      planned_start: round(range.start),
      planned_end: round(range.end),
      words,
      estimated_voice_start: round(estimatedStart),
      estimated_voice_end: round(estimatedEnd),
      start_drift_seconds: startDrift,
      end_drift_seconds: endDrift,
      status: maxDrift <= 1.25 ? "aligned" : maxDrift <= 2.5 ? "loose" : "off"
    };
  });
  const maxDrift = rows.reduce((max, row) => Math.max(max, Math.abs(row.start_drift_seconds), Math.abs(row.end_drift_seconds)), 0);
  return {
    method: "word-count proportional estimate; replace with word timestamps for frame-accurate QA",
    voiceover_duration_seconds: round(voiceoverDuration),
    segment_count: rows.length,
    total_words: totalWords,
    max_abs_drift_seconds: round(maxDrift),
    segments: rows
  };
}

function analyzeTransitionCoverage(video, sfxCues) {
  const segments = Array.isArray(video.script_visual_alignment) ? video.script_visual_alignment : [];
  const rows = segments.map((segment, index) => {
    const range = parseTimeRange(segment.time_range);
    const nearest = sfxCues.reduce((best, cue) => {
      const distance = Math.abs(Number(cue.at ?? 0) - range.start);
      return !best || distance < best.distance ? { cue_id: cue.id, asset_id: cue.asset_id, at: round(cue.at), distance } : best;
    }, null);
    const cueCount = sfxCues.filter((cue) => Number(cue.at ?? -1) >= range.start && Number(cue.at ?? -1) < range.end).length;
    const offset = nearest ? round(nearest.distance) : null;
    return {
      beat: segment.beat,
      transition_at: round(range.start),
      cue_count_in_section: cueCount,
      nearest_cue_id: nearest?.cue_id ?? null,
      nearest_asset_id: nearest?.asset_id ?? null,
      nearest_cue_offset_seconds: offset,
      status: index === 0 || (offset !== null && offset <= 0.5) ? "covered" : "late-or-missing"
    };
  });
  const covered = rows.filter((row) => row.status === "covered").length;
  const offsets = rows.map((row) => row.nearest_cue_offset_seconds).filter((value) => Number.isFinite(value));
  return {
    section_count: rows.length,
    sfx_cue_count: sfxCues.length,
    covered_transitions: covered,
    coverage_ratio: rows.length ? round(covered / rows.length) : 0,
    average_nearest_transition_cue_seconds: offsets.length ? round(offsets.reduce((sum, value) => sum + value, 0) / offsets.length) : null,
    sections: rows
  };
}

function analyzeSfxAssets(sfxManifest) {
  const assets = sfxManifest?.assets ?? [];
  const copied = sfxManifest?.copied_assets ?? [];
  const generated = copied.filter((asset) => asset.alias === "generated-default-sfx").length
    + assets.filter((asset) => asset.source_alias === "generated-default-sfx").length;
  return {
    asset_count: assets.length,
    copied_asset_count: copied.length,
    real_default_assets: copied.filter((asset) => asset.alias === "default-sfx-pack").length,
    provided_alias_assets: copied.filter((asset) => asset.alias && asset.alias !== "default-sfx-pack" && asset.alias !== "generated-default-sfx").length,
    generated_default_assets: generated,
    missing_assets: sfxManifest?.missing_assets ?? [],
    asset_ids: assets.map((asset) => asset.id).sort()
  };
}

function analyzeMusicBed(manifest) {
  const pathValue = manifest.stages.render?.music_audio ?? null;
  return {
    present: Boolean(pathValue),
    path: pathValue,
    generated_local: /(^|\/)music-bed\.wav$/i.test(String(pathValue ?? "")),
    note: pathValue ? "Music must be intentional and ducked under narration." : "No default music bed; voice and SFX carry timing."
  };
}

function applyVoiceWeightedTiming(timeline, totalDuration, fallbackStructure = []) {
  const weights = timeline.map((segment, index) => Math.max(1, wordCount(segment.voiceover) || Number(fallbackStructure[index]?.seconds ?? 1)));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1;
  let cursor = 0;
  return timeline.map((segment, index) => {
    const start = cursor;
    const end = index === timeline.length - 1
      ? totalDuration
      : Math.min(totalDuration, start + (weights[index] / totalWeight * totalDuration));
    cursor = end;
    const targetSeconds = round(end - start);
    return {
      ...segment,
      time_range: `${round(start)}-${round(end)}s`,
      target_seconds: targetSeconds
    };
  });
}

function wordCount(value) {
  return String(value ?? "").trim().split(/\s+/).filter(Boolean).length;
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
    "video/hyperframes/template-qa.html",
    "video/hyperframes/sfx-manifest.json",
    "video/hyperframes/asset-readiness.html",
    "video/hyperframes/chart-diagram-qa.html",
    "video/hyperframes/QUALITY.md",
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
  const provider = requested ?? (isSocialReadyStyle(style) && !isDataStoryBenchmarkStyle(style) ? "heygen" : "none");
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

function buildArtDirectionContract(style, manifest, stylePreset, script, storyboard, assets, talkingHead = { enabled: false, provider: "none" }, objectLifecycle = []) {
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
        "npx hyperframes render . --output ../launchclip-hyperframes.mp4 --quality high"
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
      object_lifecycle: ["enter", "settle", "transform", "connect", "drift", "pulse", "emphasize", "exit"],
      object_contract: 'objects[] = {id, scene_id, role, ref, label, states:[{state, at, duration, to?, sfx?}]}',
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
    persistent_objects: {
      schema_version: "launchclip.object-lifecycle.v1",
      source: "video.object_lifecycle",
      count: objectLifecycle.length,
      objects: objectLifecycle
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

function buildHyperframesHandoff(title, duration, objectLifecycle = []) {
  return {
    schema_version: "launchclip.hyperframes-handoff.v1",
    project_dir: HYPERFRAMES_PROJECT_DIR,
    composition_id: "LaunchclipHyperframes",
    entrypoint: `${HYPERFRAMES_PROJECT_DIR}/index.html`,
    template_qa_preview: `${HYPERFRAMES_PROJECT_DIR}/template-qa.html`,
    sfx_manifest: `${HYPERFRAMES_PROJECT_DIR}/sfx-manifest.json`,
    asset_readiness: `${HYPERFRAMES_PROJECT_DIR}/asset-readiness.html`,
    chart_diagram_qa: `${HYPERFRAMES_PROJECT_DIR}/chart-diagram-qa.html`,
    quality_checklist: `${HYPERFRAMES_PROJECT_DIR}/QUALITY.md`,
    frame_md: "video/frame.md",
    storyboard_preview: "video/storyboard.html",
    duration_seconds: duration,
    title,
    render_command: ["npx", "hyperframes", "render", ".", "--output", "../launchclip-hyperframes.mp4", "--quality", "high"],
    preview_command: ["npx", "hyperframes", "preview"],
    lint_command: ["npx", "hyperframes", "lint"],
    object_lifecycle: {
      schema_version: "launchclip.object-lifecycle.v1",
      source: "video/video.json#object_lifecycle",
      objects: objectLifecycle
    },
    notes: [
      "Generated as an editable HyperFrames scaffold from Launchclip's storyboard contract.",
      "Use HyperFrames skills to refine motion, transitions, reusable objects, SFX, charts, and diagrams inside this project.",
      "Keep claims and screenshots grounded in the Launchclip packet."
    ]
  };
}

function buildHyperframesObjectLifecycle(storyboard, duration) {
  const scenes = Array.isArray(storyboard?.scenes) ? storyboard.scenes : [];
  return scenes.map((scene, index) => {
    const range = parseTimeRange(scene.time_range);
    const start = Number.isFinite(range.start) ? range.start : index * Math.max(1.2, duration / Math.max(1, scenes.length));
    const targetSeconds = Number(scene.target_seconds ?? 3);
    const end = Number.isFinite(range.end) ? range.end : Math.min(duration, start + targetSeconds);
    const sceneDuration = Math.max(0.8, end - start);
    const sceneId = String(scene.id ?? scene.beat ?? `scene-${index + 1}`);
    const role = objectRoleForScene(scene, index);
    const ref = objectRefForScene(scene, role);
    const template = objectTemplateForScene(scene, role);
    const x = round(0.36 + (index % 3) * 0.14);
    const y = round(0.66 - (index % 2) * 0.1);
    const states = smoothHyperframesObjectStates([
      { state: "enter", at: objectStateAt(start + 0.1, start, end), duration: 0.42, easing: "power3.out", sfx: objectSfxForScene(scene, "enter") },
      { state: "settle", at: objectStateAt(start + Math.min(0.62, sceneDuration * 0.24), start, end), duration: 0.32, easing: "sine.inOut" },
      {
        state: "transform",
        at: objectStateAt(start + Math.min(1.15, sceneDuration * 0.46), start, end),
        duration: 0.58,
        easing: "power3.inOut",
        to: { x, y, scale: round(1.02 + (index % 2) * 0.06), rotate: index % 2 ? 2.4 : -2.1 }
      },
      { state: "emphasize", at: objectStateAt(end - Math.min(0.9, sceneDuration * 0.28), start, end), duration: 0.34, easing: "back.out(1.5)", sfx: objectSfxForScene(scene, "emphasize") },
      { state: "exit", at: objectStateAt(end - 0.16, start, end), duration: 0.24, easing: "power2.in" }
    ], scene, index);
    return {
      id: `hf-${safeObjectId(sceneId)}-primary`,
      scene_id: sceneId,
      role,
      ref,
      template,
      template_data: objectTemplateDataForScene(scene, template, index),
      label: objectLabelForScene(scene, sceneId),
      states
    };
  });
}

function objectStateAt(value, start, end) {
  return round(Math.max(start, Math.min(Math.max(start, end - 0.05), value)));
}

function smoothHyperframesObjectStates(states, scene, objectIndex) {
  const sortedStates = [...states].sort((a, b) => Number(a.at ?? 0) - Number(b.at ?? 0));
  const smoothed = [];
  for (let index = 0; index < sortedStates.length; index += 1) {
    const current = sortedStates[index];
    const next = sortedStates[index + 1];
    smoothed.push(current);
    if (!next) continue;
    let previousEnd = Number(current.at ?? 0) + Number(current.duration ?? 0);
    let gap = Number(next.at ?? previousEnd) - previousEnd;
    let microIndex = 0;
    while (gap > HYPERFRAMES_STATIC_HOLD_THRESHOLD_SECONDS) {
      const at = round(Math.min(previousEnd + 0.86, Number(next.at) - 0.38));
      if (!Number.isFinite(at) || at <= previousEnd + 0.12) break;
      const microState = hyperframesMicroState(scene, objectIndex, microIndex, at);
      smoothed.push(microState);
      previousEnd = at + microState.duration;
      gap = Number(next.at) - previousEnd;
      microIndex += 1;
      if (microIndex > 24) break;
    }
  }
  return smoothed.sort((a, b) => Number(a.at ?? 0) - Number(b.at ?? 0));
}

function hyperframesMicroState(scene, objectIndex, microIndex, at) {
  const state = ["connect", "drift", "pulse"][microIndex % 3];
  const direction = objectIndex % 2 ? 1 : -1;
  if (state === "connect") {
    return {
      state,
      at,
      duration: 0.26,
      easing: "power2.out",
      sfx: "connector_pop.wav",
      to: { scale: 1.04, rotate: round(direction * 1.2) }
    };
  }
  if (state === "drift") {
    return {
      state,
      at,
      duration: 0.32,
      easing: "sine.inOut",
      delta: { x: direction * 14, y: -10, rotate: direction * 0.8 }
    };
  }
  return {
    state,
    at,
    duration: 0.24,
    easing: "power2.out",
    sfx: objectSfxForScene(scene, "emphasize"),
    to: { scale: 1.06, rotate: round(direction * 0.6) }
  };
}

function objectRoleForScene(scene, index) {
  const text = `${scene.id ?? ""} ${scene.beat ?? ""} ${scene.layout ?? ""} ${scene.composition ?? ""}`.toLowerCase();
  if (text.includes("cta")) return "cta-card";
  if (text.includes("orbit") || text.includes("connector") || text.includes("workflow") || text.includes("line")) return "diagram";
  if (text.includes("collage") || text.includes("grid") || text.includes("outputs") || text.includes("chart")) return "chart";
  if (text.includes("terminal") || text.includes("prompt") || text.includes("type")) return "proof-ui";
  if (text.includes("asset") || text.includes("brand")) return "brand-token";
  if (text.includes("artifact") || text.includes("receipt") || text.includes("proof") || text.includes("folder") || text.includes("packet") || text.includes("file")) return "proof-card";
  return index === 0 ? "hook-card" : "motion-card";
}

function objectRefForScene(scene, role) {
  const text = `${scene.id ?? ""} ${scene.beat ?? ""} ${scene.layout ?? ""} ${scene.composition ?? ""}`.toLowerCase();
  const aliases = Array.isArray(scene.asset_aliases) ? scene.asset_aliases.filter(Boolean) : [];
  if (role === "diagram") return "connector_graph";
  if (role === "chart") return "matrix_chart";
  if (role === "proof-ui") return text.includes("prompt") ? "prompt_composer" : "terminal_receipt";
  if (role === "brand-token") return "brand_logo_card";
  if (role === "proof-card") return "artifact_card";
  if (role === "cta-card") return "cta_button";
  if (aliases.length) return `asset:${aliases[0]}`;
  return "paper_card";
}

function objectTemplateForScene(scene, role) {
  const text = `${scene.id ?? ""} ${scene.beat ?? ""} ${scene.layout ?? ""} ${scene.composition ?? ""}`.toLowerCase();
  if (role === "proof-ui") return text.includes("prompt") ? "prompt_ui" : "terminal_ui";
  if (role === "diagram") return "diagram";
  if (role === "chart") return "chart";
  if (role === "brand-token") return "brand_token";
  if (role === "cta-card") return "cta_card";
  if (role === "proof-card") return text.includes("folder") ? "folder_stack" : "proof_card";
  return "paper_card";
}

function objectTemplateDataForScene(scene, template, index) {
  const aliases = Array.isArray(scene.asset_aliases) ? scene.asset_aliases.filter(Boolean).slice(0, 4) : [];
  const mediaSlots = Array.isArray(scene.media_slots) ? scene.media_slots.filter(Boolean).slice(0, 5) : [];
  const sfx = Array.isArray(scene.sfx_cues) ? scene.sfx_cues.filter(Boolean).slice(0, 4) : [];
  const events = Array.isArray(scene.micro_events) ? scene.micro_events.filter(Boolean).slice(0, 4) : [];
  return {
    aliases,
    media_slots: mediaSlots,
    sfx,
    events,
    value: `${index + 1}/${Math.max(1, mediaSlots.length || aliases.length || 3)}`,
    evidence: cleanObjectLabel(scene.evidence_source ?? "proof"),
    template
  };
}

function objectLabelForScene(scene, fallback) {
  const emphasis = Array.isArray(scene.caption_emphasis) && scene.caption_emphasis.length ? scene.caption_emphasis[0] : null;
  return cleanObjectLabel(emphasis ?? scene.hook ?? scene.caption ?? fallback);
}

function objectSfxForScene(scene, state) {
  const text = `${scene.id ?? ""} ${scene.beat ?? ""} ${scene.sound_design ?? ""} ${(scene.sfx_cues ?? []).join(" ")}`.toLowerCase();
  if (text.includes("typing") || text.includes("prompt") || text.includes("terminal")) return state === "enter" ? "single_type.wav" : "success_ding.wav";
  if (text.includes("success") || text.includes("cta")) return state === "emphasize" ? "success_ding.wav" : "paper_hit.wav";
  return state === "enter" ? "paper_hit.wav" : "soft_thump.wav";
}

function cleanObjectLabel(value) {
  return stripMarkdown(value).replace(/\s+/g, " ").trim().slice(0, 34) || "motion object";
}

function safeObjectId(value) {
  return String(value ?? "object")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "object";
}

function renderFrameMd(artDirection) {
  const objectLines = (artDirection.persistent_objects?.objects ?? []).map((object) => {
    const states = object.states.map((state) => state.state).join(" -> ");
    const firstTarget = object.states.find((state) => state.to)?.to;
    const target = firstTarget ? ` target=${JSON.stringify(firstTarget)}` : "";
    return `- ${object.id} (${object.role}, ${object.ref}, template=${object.template}) scene=${object.scene_id}; states=${states}; sfx=${object.states.filter((state) => state.sfx).map((state) => state.sfx).join(", ") || "none"}${target}`;
  }).join("\n");
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
- Object contract: ${artDirection.motion.object_contract}
- Transitions: ${artDirection.motion.transitions.join("; ")}
- Smoothness gates: ${artDirection.motion.smoothness_gates.join("; ")}

## Persistent Object Timeline

- Source: ${artDirection.persistent_objects.source}
- Count: ${artDirection.persistent_objects.count}
- Core state order: enter -> settle -> transform -> [connect/drift/pulse] -> emphasize -> exit
${objectLines}

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
  const objects = Array.isArray(video.object_lifecycle) ? video.object_lifecycle : [];
  const cards = scenes.map((scene) => {
    const aliases = Array.isArray(scene.asset_aliases) && scene.asset_aliases.length ? scene.asset_aliases.join(", ") : "none";
    const motion = Array.isArray(scene.motion_grammar) ? scene.motion_grammar.join(", ") : scene.motion_grammar ?? "";
    const sfx = Array.isArray(scene.sfx_cues) && scene.sfx_cues.length ? scene.sfx_cues.join(", ") : scene.sound_design ?? "";
    const sceneObjects = objects.filter((object) => object.scene_id === scene.id);
    const objectSummary = sceneObjects.map((object) => `${object.id}: ${object.states.map((state) => state.state).join(" -> ")}`).join("; ") || "none";
    return `<article class="scene-card">
      <div class="scene-meta">${escapeHtml(scene.time_range ?? "")} / ${escapeHtml(scene.id ?? scene.order ?? "scene")}</div>
      <h2>${escapeHtml(scene.hook ?? scene.caption ?? scene.id ?? "Scene")}</h2>
      <p class="voice">${escapeHtml(scene.voiceover ?? "")}</p>
      <dl>
        <dt>Layout</dt><dd>${escapeHtml(scene.layout ?? "")}</dd>
        <dt>Composition</dt><dd>${escapeHtml(scene.composition ?? "")}</dd>
        <dt>Motion</dt><dd>${escapeHtml(motion)}</dd>
        <dt>SFX</dt><dd>${escapeHtml(sfx)}</dd>
        <dt>Objects</dt><dd>${escapeHtml(objectSummary)}</dd>
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
  const sfxManifest = buildHyperframesSfxManifest(video);
  const sfxCopy = await copyHyperframesSfxAssets(projectDir, video.assets, sfxManifest);
  const resolvedSfxManifest = applyHyperframesSfxAvailability(sfxManifest, sfxCopy);
  const assetReadiness = buildHyperframesAssetReadiness(video, resolvedSfxManifest);
  const chartDiagramQa = buildHyperframesChartDiagramQa(video);
  const qualityHandoff = buildHyperframesQualityHandoff(video, assetReadiness, chartDiagramQa, resolvedSfxManifest);
  await writeJson(path.join(projectDir, "launchclip-data.json"), {
    schema_version: "launchclip.hyperframes-data.v1",
    repo: manifest.source_repo,
    video: {
      title: video.title,
      duration_seconds: video.duration_seconds,
      style: video.style,
      timeline: video.script_visual_alignment,
      storyboard: video.creative_storyboard,
      object_lifecycle: video.object_lifecycle ?? [],
      sound_design: video.sound_design,
      assets: video.assets
    },
    sfx_manifest: resolvedSfxManifest,
    asset_readiness: assetReadiness,
    chart_diagram_qa: chartDiagramQa,
    quality_handoff: qualityHandoff
  });
  await writeJson(path.join(projectDir, "sfx-manifest.json"), resolvedSfxManifest);
  await writeFile(path.join(projectDir, "README.md"), renderHyperframesReadme(video));
  await writeFile(path.join(projectDir, "QUALITY.md"), renderHyperframesQualityChecklist(video, qualityHandoff));
  await writeFile(path.join(projectDir, "index.html"), renderHyperframesIndex(manifest, video, resolvedSfxManifest));
  await writeFile(path.join(projectDir, "template-qa.html"), renderHyperframesTemplateQa(video));
  await writeFile(path.join(projectDir, "asset-readiness.html"), renderHyperframesAssetReadiness(video, assetReadiness));
  await writeFile(path.join(projectDir, "chart-diagram-qa.html"), renderHyperframesChartDiagramQa(video, chartDiagramQa));
}

function renderHyperframesReadme(video) {
  return `# ${video.title} HyperFrames project

Generated by Launchclip from \`video/video.json\`, \`video/frame.md\`, and \`video/storyboard.html\`.

Start with \`QUALITY.md\` for the ordered HyperFrames review checklist. Open \`template-qa.html\` before render review to inspect reusable object family coverage, lifecycle state gaps, text-fit risk, and object-level SFX hooks. Use \`chart-diagram-qa.html\` to inspect chart marks, connector endpoints, labels, and source status. Use \`asset-readiness.html\` to review real, missing, and placeholder visual/audio assets. Use \`sfx-manifest.json\` to map lifecycle SFX names to reusable local audio assets and timed cue events.

## Requirements

- Node.js 22+
- FFmpeg
- HyperFrames CLI through \`npx\`

## Review Loop

\`\`\`bash
npx hyperframes doctor
npx hyperframes lint
npx hyperframes preview
npx hyperframes render . --output ../launchclip-hyperframes.mp4 --quality high
\`\`\`

Use the official HyperFrames skills to improve this scaffold with richer reusable objects, object state transitions, charts, diagrams, SFX, and scene-specific art direction. Keep claims grounded in the Launchclip packet.
`;
}

function buildHyperframesQualityHandoff(video, assetReadiness, chartDiagramQa, sfxManifest) {
  const templateIssues = hyperframesTemplateQaIssues(Array.isArray(video.object_lifecycle) ? video.object_lifecycle : []);
  const visualMissing = assetReadiness.summary.visual_missing + assetReadiness.summary.visual_placeholders;
  const audioMissing = assetReadiness.summary.audio_missing + assetReadiness.summary.audio_placeholders;
  const sfxAvailable = (sfxManifest.assets ?? []).filter((asset) => asset.status === "available-local-asset").length;
  const sfxMissing = (sfxManifest.assets ?? []).filter((asset) => asset.status !== "available-local-asset").length;
  const checks = [
    {
      gate: "Template QA",
      artifact: "template-qa.html",
      status: templateIssues.length ? "needs-review" : "pass",
      evidence: `${templateIssues.length} template, lifecycle, SFX, or text-fit flags`
    },
    {
      gate: "Asset readiness",
      artifact: "asset-readiness.html",
      status: visualMissing || audioMissing ? "needs-assets" : "pass",
      evidence: `${assetReadiness.summary.visual_real} real visual, ${assetReadiness.summary.audio_real} real audio, ${visualMissing + audioMissing} missing or placeholder`
    },
    {
      gate: "Chart and diagram QA",
      artifact: "chart-diagram-qa.html",
      status: chartDiagramQa.summary.issues ? "needs-review" : "pass",
      evidence: `${chartDiagramQa.summary.chart_objects} chart objects, ${chartDiagramQa.summary.diagram_objects} diagram objects, ${chartDiagramQa.summary.issues} QA issues`
    },
    {
      gate: "SFX runtime",
      artifact: "sfx-manifest.json",
      status: sfxAvailable ? sfxMissing ? "partial-assets" : "pass" : "needs-audio-assets",
      evidence: `${sfxAvailable} local SFX assets, ${sfxMissing} expected missing assets, ${(sfxManifest.cues ?? []).length + (sfxManifest.storyboard_cues ?? []).length} scheduled cues`
    },
    {
      gate: "Render commands",
      artifact: "index.html",
      status: "ready",
      evidence: "npx hyperframes doctor, lint, preview, and render commands are declared"
    }
  ];
  return {
    schema_version: "launchclip.hyperframes-quality-handoff.v1",
    source: "video/video.json#hyperframes",
    artifacts: ["index.html", "template-qa.html", "asset-readiness.html", "chart-diagram-qa.html", "sfx-manifest.json", "QUALITY.md"],
    checks,
    summary: {
      pass: checks.filter((check) => check.status === "pass" || check.status === "ready").length,
      needs_review: checks.filter((check) => check.status.includes("needs")).length,
      partial: checks.filter((check) => check.status.includes("partial")).length,
      total: checks.length
    },
    review_order: [
      "Open QUALITY.md and read the gate table.",
      "Open template-qa.html for object family, lifecycle, SFX, and text-fit checks.",
      "Open asset-readiness.html and replace required missing visual/audio assets when possible.",
      "Open chart-diagram-qa.html and confirm chart data marks, connector endpoints, labels, and source status.",
      "Open sfx-manifest.json and confirm local SFX runtime assets and missing expected files.",
      "Run npx hyperframes doctor, lint, preview, then render."
    ],
    human_acceptance: [
      "Claims remain grounded in video/storyboard.html, demo output, README, or generated packet files.",
      "No required local asset is silently substituted with unrelated stock media.",
      "Object transitions preserve enter, settle, transform, connect/drift/pulse, emphasize, and exit continuity.",
      "SFX cues remain ducked under voiceover and do not overpower proof scenes.",
      "Charts and diagrams use declared labels, endpoints, and evidence status."
    ]
  };
}

function renderHyperframesQualityChecklist(video, handoff) {
  const rows = handoff.checks.map((check) => `| ${check.gate} | ${check.status} | \`${check.artifact}\` | ${check.evidence} |`).join("\n");
  return `# HyperFrames Quality Handoff

Generated for ${video.title}.

Use this checklist before running the final HyperFrames render. It links the generated QA artifacts into one review path so missing assets, chart/diagram evidence, object transitions, and runtime SFX do not get reviewed in isolation.

## Gate Table

| Gate | Status | Artifact | Evidence |
| --- | --- | --- | --- |
${rows}

## Review Order

${handoff.review_order.map((item, index) => `${index + 1}. ${item}`).join("\n")}

## Human Acceptance Checklist

${handoff.human_acceptance.map((item) => `- [ ] ${item}`).join("\n")}

## Commands

\`\`\`bash
npx hyperframes doctor
npx hyperframes lint
npx hyperframes preview
npx hyperframes render . --output ../launchclip-hyperframes.mp4 --quality high
\`\`\`
`;
}

function buildHyperframesAssetReadiness(video, sfxManifest) {
  const assets = video.assets ?? {};
  const aliases = assets.aliases ?? {};
  const requiredAliases = new Set(assets.required_aliases ?? []);
  const providedAliases = new Set(assets.provided_aliases ?? Object.keys(aliases));
  const storyboardScenes = Array.isArray(video.creative_storyboard?.scenes) ? video.creative_storyboard.scenes : [];
  const storyboardAliases = [...new Set(storyboardScenes.flatMap((scene) => Array.isArray(scene.asset_aliases) ? scene.asset_aliases : []))].sort();
  const visualAliasKeys = [...new Set([...requiredAliases, ...providedAliases, ...storyboardAliases])].sort();
  const visualAssets = visualAliasKeys.map((alias) => {
    const entry = aliases[alias];
    const required = requiredAliases.has(alias) || storyboardAliases.includes(alias);
    const status = entry ? assetReadinessStatus(entry) : required ? "missing-required-asset" : "optional-missing";
    return {
      alias,
      label: entry?.label ?? titleCase(alias.replace(/-/g, " ")),
      type: entry?.type ?? "asset",
      required,
      status,
      source: entry?.manifest_path ?? null,
      path: entry?.source_path ?? null
    };
  });
  const audioAssets = (sfxManifest.assets ?? []).map((asset) => ({
    id: asset.id,
    label: asset.name,
    family: asset.family,
    status: asset.status ?? "expected-local-asset",
    path: asset.path,
    source_alias: asset.source_alias ?? null,
    cue_count: (sfxManifest.cues ?? []).filter((cue) => cue.asset_id === asset.id).length + (sfxManifest.storyboard_cues ?? []).filter((cue) => cue.asset_id === asset.id).length
  }));
  const storyboardDependencies = storyboardScenes.map((scene) => {
    const aliasesForScene = Array.isArray(scene.asset_aliases) ? scene.asset_aliases : [];
    return {
      scene_id: scene.id ?? scene.beat ?? "scene",
      aliases: aliasesForScene,
      missing_aliases: aliasesForScene.filter((alias) => !providedAliases.has(alias)).sort(),
      status: aliasesForScene.every((alias) => providedAliases.has(alias)) ? "ready" : "missing-assets"
    };
  });
  const objectTemplates = [...new Set((Array.isArray(video.object_lifecycle) ? video.object_lifecycle : []).map((object) => object.template).filter(Boolean))].sort();
  return {
    schema_version: "launchclip.hyperframes-asset-readiness.v1",
    source: "video/video.json#assets",
    summary: {
      visual_real: visualAssets.filter((asset) => asset.status === "available-local-asset").length,
      visual_missing: visualAssets.filter((asset) => asset.status.startsWith("missing")).length,
      visual_placeholders: visualAssets.filter((asset) => asset.status.includes("placeholder")).length,
      audio_real: audioAssets.filter((asset) => asset.status === "available-local-asset").length,
      audio_missing: audioAssets.filter((asset) => asset.status !== "available-local-asset").length,
      audio_placeholders: audioAssets.filter((asset) => asset.status.includes("placeholder")).length,
      storyboard_scenes: storyboardDependencies.length,
      object_templates: objectTemplates.length
    },
    visual_assets: visualAssets,
    audio_assets: audioAssets,
    storyboard_dependencies: storyboardDependencies,
    object_templates: objectTemplates
  };
}

function assetReadinessStatus(entry) {
  const type = String(entry?.type ?? "").toLowerCase();
  const source = String(entry?.source_path ?? entry?.manifest_path ?? "").toLowerCase();
  if (type.includes("placeholder") || source.includes("placeholder")) return "placeholder-asset";
  return "available-local-asset";
}

function buildHyperframesChartDiagramQa(video) {
  const scenes = Array.isArray(video.creative_storyboard?.scenes) ? video.creative_storyboard.scenes : [];
  const sceneById = new Map(scenes.map((scene) => [String(scene.id ?? scene.beat ?? ""), scene]));
  const objects = Array.isArray(video.object_lifecycle) ? video.object_lifecycle : [];
  const chartVocabulary = Array.isArray(video.art_direction?.charts_diagrams?.chart_types) ? video.art_direction.charts_diagrams.chart_types : [];
  const diagramVocabulary = Array.isArray(video.art_direction?.charts_diagrams?.diagram_types) ? video.art_direction.charts_diagrams.diagram_types : [];
  const chartObjects = objects
    .filter((object) => object.template === "chart" || String(object.role ?? "").includes("chart"))
    .map((object, index) => {
      const scene = sceneById.get(String(object.scene_id ?? "")) ?? {};
      const dataMarks = Array.isArray(object.template_data?.media_slots) ? object.template_data.media_slots.filter(Boolean) : [];
      const evidence = String(object.template_data?.evidence ?? scene.evidence_source ?? "").trim();
      const label = String(object.label ?? "").trim();
      const sourceStatus = evidence ? "source-declared" : "missing-source";
      const dataStatus = dataMarks.length >= 2 ? "data-marks-ready" : "needs-data-marks";
      const labelStatus = label.length <= 34 ? "label-fit-ready" : "label-fit-risk";
      return {
        id: object.id,
        scene_id: object.scene_id,
        role: object.role,
        ref: object.ref,
        label,
        chart_type: chartTypeForObject(object, chartVocabulary, index),
        data_marks: dataMarks,
        data_mark_count: dataMarks.length,
        evidence,
        source_status: sourceStatus,
        data_status: dataStatus,
        label_status: labelStatus,
        status: sourceStatus === "source-declared" && dataStatus === "data-marks-ready" && labelStatus === "label-fit-ready" ? "ready" : "needs-review"
      };
    });
  const diagramObjects = objects
    .filter((object) => object.template === "diagram" || String(object.role ?? "").includes("diagram"))
    .map((object, index) => {
      const scene = sceneById.get(String(object.scene_id ?? "")) ?? {};
      const endpoints = Array.isArray(object.template_data?.aliases) ? object.template_data.aliases.filter(Boolean) : [];
      const evidence = String(object.template_data?.evidence ?? scene.evidence_source ?? "").trim();
      const label = String(object.label ?? "").trim();
      const sourceStatus = evidence ? "source-declared" : "missing-source";
      const endpointStatus = endpoints.length >= 2 ? "endpoints-ready" : "needs-endpoints";
      const labelStatus = label.length <= 34 ? "label-fit-ready" : "label-fit-risk";
      return {
        id: object.id,
        scene_id: object.scene_id,
        role: object.role,
        ref: object.ref,
        label,
        diagram_type: diagramTypeForObject(object, diagramVocabulary, index),
        connector_endpoints: endpoints,
        endpoint_count: endpoints.length,
        connector_count: Math.max(0, endpoints.length - 1),
        evidence,
        source_status: sourceStatus,
        endpoint_status: endpointStatus,
        label_status: labelStatus,
        status: sourceStatus === "source-declared" && endpointStatus === "endpoints-ready" && labelStatus === "label-fit-ready" ? "ready" : "needs-review"
      };
    });
  const sceneCoverage = scenes.map((scene) => {
    const intents = chartDiagramIntentForScene(scene);
    const sceneObjects = objects.filter((object) => object.scene_id === scene.id);
    const templates = [...new Set(sceneObjects.map((object) => object.template).filter(Boolean))].sort();
    const covered = intents.every((intent) => sceneObjects.some((object) => object.template === intent));
    return {
      scene_id: scene.id ?? scene.beat ?? "scene",
      intent: intents,
      object_templates: templates,
      status: intents.length ? covered ? "covered" : "needs-object" : "not-applicable",
      evidence: scene.evidence_source ?? ""
    };
  });
  const issues = [
    ...chartObjects.flatMap((object) => chartDiagramObjectIssues(object, "chart")),
    ...diagramObjects.flatMap((object) => chartDiagramObjectIssues(object, "diagram")),
    ...sceneCoverage
      .filter((scene) => scene.status === "needs-object")
      .map((scene) => ({
        severity: "warning",
        scene_id: scene.scene_id,
        issue: `Scene declares ${scene.intent.join(" and ")} intent without a matching HyperFrames object.`,
        status: scene.status
      }))
  ];
  return {
    schema_version: "launchclip.hyperframes-chart-diagram-qa.v1",
    source: "video/video.json#object_lifecycle",
    summary: {
      chart_objects: chartObjects.length,
      diagram_objects: diagramObjects.length,
      scene_intents: sceneCoverage.filter((scene) => scene.intent.length).length,
      uncovered_scene_intents: sceneCoverage.filter((scene) => scene.status === "needs-object").length,
      issues: issues.length,
      chart_vocabulary: chartVocabulary.length,
      diagram_vocabulary: diagramVocabulary.length
    },
    chart_vocabulary: chartVocabulary,
    diagram_vocabulary: diagramVocabulary,
    chart_objects: chartObjects,
    diagram_objects: diagramObjects,
    scene_coverage: sceneCoverage,
    issues
  };
}

function chartTypeForObject(object, chartVocabulary, index) {
  const ref = String(object.ref ?? "").toLowerCase();
  const direct = chartVocabulary.find((type) => ref.includes(String(type).toLowerCase()));
  return direct ?? chartVocabulary[index % Math.max(1, chartVocabulary.length)] ?? "bar";
}

function diagramTypeForObject(object, diagramVocabulary, index) {
  const ref = String(object.ref ?? "").toLowerCase();
  if (ref.includes("graph") && diagramVocabulary.includes("directed graph")) return "directed graph";
  const direct = diagramVocabulary.find((type) => ref.includes(String(type).toLowerCase().replace(/\s+/g, "-")));
  return direct ?? diagramVocabulary[index % Math.max(1, diagramVocabulary.length)] ?? "directed graph";
}

function chartDiagramIntentForScene(scene) {
  const text = [
    scene.id,
    scene.beat,
    scene.layout,
    scene.composition,
    ...(Array.isArray(scene.motion_grammar) ? scene.motion_grammar : []),
    ...(Array.isArray(scene.micro_events) ? scene.micro_events : [])
  ].filter(Boolean).join(" ").toLowerCase();
  const intents = [];
  if (/\b(connector|connected|workflow line|hub|graph|pipeline|causal)\b/.test(text)) intents.push("diagram");
  if (/\b(chart|collage|grid|outputs|board|matrix|funnel|counter|sparkline)\b/.test(text)) intents.push("chart");
  return [...new Set(intents)];
}

function chartDiagramObjectIssues(object, kind) {
  const issues = [];
  if (object.source_status !== "source-declared") {
    issues.push({
      severity: "warning",
      object_id: object.id,
      scene_id: object.scene_id,
      issue: `${titleCase(kind)} object is missing claim/source evidence.`,
      status: object.source_status
    });
  }
  const readyStatus = kind === "chart" ? object.data_status : object.endpoint_status;
  if (readyStatus !== (kind === "chart" ? "data-marks-ready" : "endpoints-ready")) {
    issues.push({
      severity: "warning",
      object_id: object.id,
      scene_id: object.scene_id,
      issue: kind === "chart" ? "Chart object needs at least two data marks." : "Diagram object needs at least two connector endpoints.",
      status: readyStatus
    });
  }
  if (object.label_status !== "label-fit-ready") {
    issues.push({
      severity: "warning",
      object_id: object.id,
      scene_id: object.scene_id,
      issue: `${titleCase(kind)} label may not fit mobile vertical resolution.`,
      status: object.label_status
    });
  }
  return issues;
}

function renderHyperframesChartDiagramQa(video, qa) {
  const chartRows = qa.chart_objects.map((object) => `<tr class="status-${escapeHtml(object.status)}">
              <td>${escapeHtml(object.scene_id)}</td>
              <td>${escapeHtml(object.id)}</td>
              <td>${escapeHtml(object.ref)}</td>
              <td>${escapeHtml(object.chart_type)}</td>
              <td>${escapeHtml(object.data_marks.join(", ") || "none")}</td>
              <td>${escapeHtml(object.source_status)}</td>
              <td>${escapeHtml(object.label_status)}</td>
              <td>${escapeHtml(object.status)}</td>
            </tr>`).join("");
  const diagramRows = qa.diagram_objects.map((object) => `<tr class="status-${escapeHtml(object.status)}">
              <td>${escapeHtml(object.scene_id)}</td>
              <td>${escapeHtml(object.id)}</td>
              <td>${escapeHtml(object.ref)}</td>
              <td>${escapeHtml(object.diagram_type)}</td>
              <td>${escapeHtml(object.connector_endpoints.join(" -> ") || "none")}</td>
              <td>${escapeHtml(String(object.connector_count))}</td>
              <td>${escapeHtml(object.source_status)}</td>
              <td>${escapeHtml(object.status)}</td>
            </tr>`).join("");
  const coverageRows = qa.scene_coverage.map((scene) => `<tr class="status-${escapeHtml(scene.status)}">
              <td>${escapeHtml(scene.scene_id)}</td>
              <td>${escapeHtml(scene.intent.join(", ") || "none")}</td>
              <td>${escapeHtml(scene.object_templates.join(", ") || "none")}</td>
              <td>${escapeHtml(scene.evidence)}</td>
              <td>${escapeHtml(scene.status)}</td>
            </tr>`).join("");
  const issueRows = qa.issues.map((issue) => `<tr class="status-${escapeHtml(issue.status)}">
              <td>${escapeHtml(issue.severity)}</td>
              <td>${escapeHtml(issue.scene_id ?? "")}</td>
              <td>${escapeHtml(issue.object_id ?? "")}</td>
              <td>${escapeHtml(issue.issue)}</td>
              <td>${escapeHtml(issue.status)}</td>
            </tr>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(video.title)} HyperFrames Chart And Diagram QA</title>
  <style>
    :root { color-scheme: light; --paper: #ece8e1; --surface: #fffdf8; --ink: #1a1a18; --muted: rgba(26,26,24,0.66); --line: rgba(26,26,24,0.16); --green: #16613f; --amber: #9b6b12; --red: #a23528; --blue: #214f7a; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--paper); color: var(--ink); }
    main { max-width: 1440px; margin: 0 auto; padding: 32px 28px 56px; }
    header { display: grid; gap: 8px; border-bottom: 2px solid var(--line); padding-bottom: 22px; margin-bottom: 24px; }
    h1 { margin: 0; font-size: 42px; line-height: 1.02; letter-spacing: 0; }
    .sub { max-width: 880px; color: var(--muted); font-size: 15px; line-height: 1.45; margin: 0; }
    .metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 28px; }
    .metric { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); padding: 16px; }
    .metric span { display: block; color: var(--muted); font-size: 12px; font-weight: 800; text-transform: uppercase; }
    .metric strong { display: block; margin-top: 8px; font-size: 30px; line-height: 1; }
    section { margin-top: 28px; }
    .section-head { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
    h2 { margin: 0; font-size: 24px; letter-spacing: 0; }
    .note { color: var(--muted); font-size: 13px; }
    .vocabulary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 16px; }
    .vocabulary div { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); padding: 14px; }
    .vocabulary h3 { margin: 0 0 8px; font-size: 14px; }
    .vocabulary p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.4; }
    table { width: 100%; border-collapse: collapse; border: 1px solid var(--line); background: var(--surface); border-radius: 8px; overflow: hidden; }
    th, td { padding: 11px 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; font-size: 13px; line-height: 1.35; overflow-wrap: anywhere; }
    th { background: #1a1a18; color: var(--paper); font-size: 11px; text-transform: uppercase; }
    tr:last-child td { border-bottom: none; }
    .status-ready td:last-child, .status-covered td:last-child, .status-not-applicable td:last-child { color: var(--green); font-weight: 900; }
    .status-needs-review td:last-child, .status-needs-object td:last-child, .status-needs-data-marks td:last-child, .status-needs-endpoints td:last-child { color: var(--amber); font-weight: 900; }
    .status-missing-source td:last-child, .status-label-fit-risk td:last-child { color: var(--red); font-weight: 900; }
    @media (max-width: 760px) {
      main { padding: 22px 16px 40px; }
      h1 { font-size: 32px; }
      .metrics, .vocabulary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      table { display: block; overflow-x: auto; }
    }
    @media (max-width: 520px) {
      .metrics, .vocabulary { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>HyperFrames Chart And Diagram QA</h1>
      <p class="sub">${escapeHtml(video.title)}. Review chart marks, connector endpoints, labels, and source status before HyperFrames render work starts.</p>
    </header>
    <section class="metrics" aria-label="Chart and diagram summary">
      <div class="metric"><span>Chart Objects</span><strong>${qa.summary.chart_objects}</strong></div>
      <div class="metric"><span>Diagram Objects</span><strong>${qa.summary.diagram_objects}</strong></div>
      <div class="metric"><span>Scene intents</span><strong>${qa.summary.scene_intents}</strong></div>
      <div class="metric"><span>QA issues</span><strong>${qa.summary.issues}</strong></div>
    </section>
    <section>
      <div class="section-head">
        <h2>Reusable Vocabulary</h2>
        <span class="note">Art direction choices available to HyperFrames object templates.</span>
      </div>
      <div class="vocabulary">
        <div><h3>Chart types</h3><p>${escapeHtml(qa.chart_vocabulary.join(", ") || "none")}</p></div>
        <div><h3>Diagram types</h3><p>${escapeHtml(qa.diagram_vocabulary.join(", ") || "none")}</p></div>
      </div>
    </section>
    <section>
      <div class="section-head">
        <h2>Chart Objects</h2>
        <span class="note">Data table for chart marks, labels, and claim source status.</span>
      </div>
      <table>
        <thead><tr><th>Scene</th><th>Object</th><th>Ref</th><th>Chart type</th><th>Data marks</th><th>Source status</th><th>Label status</th><th>Status</th></tr></thead>
        <tbody>${chartRows || `<tr><td colspan="8">No chart objects declared.</td></tr>`}</tbody>
      </table>
    </section>
    <section>
      <div class="section-head">
        <h2>Diagram Objects</h2>
        <span class="note">Connector endpoints must be real storyboard aliases or declared fallback nodes.</span>
      </div>
      <table>
        <thead><tr><th>Scene</th><th>Object</th><th>Ref</th><th>Diagram type</th><th>Connector endpoints</th><th>Connectors</th><th>Source status</th><th>Status</th></tr></thead>
        <tbody>${diagramRows || `<tr><td colspan="8">No diagram objects declared.</td></tr>`}</tbody>
      </table>
    </section>
    <section>
      <div class="section-head">
        <h2>Scene Coverage</h2>
        <span class="note">Scenes that imply a chart or diagram should have a matching reusable object.</span>
      </div>
      <table>
        <thead><tr><th>Scene</th><th>Intent</th><th>Object templates</th><th>Evidence</th><th>Status</th></tr></thead>
        <tbody>${coverageRows || `<tr><td colspan="5">No storyboard scenes declared.</td></tr>`}</tbody>
      </table>
    </section>
    <section>
      <div class="section-head">
        <h2>QA Issues</h2>
        <span class="note">Warnings are review prompts for renderer authors, not automatic asset substitution.</span>
      </div>
      <table>
        <thead><tr><th>Severity</th><th>Scene</th><th>Object</th><th>Issue</th><th>Status</th></tr></thead>
        <tbody>${issueRows || `<tr><td colspan="5">No chart or diagram QA issues.</td></tr>`}</tbody>
      </table>
    </section>
  </main>
</body>
</html>
`;
}

function renderHyperframesAssetReadiness(video, readiness) {
  const visualRows = readiness.visual_assets.map((asset) => `<tr class="status-${escapeHtml(asset.status)}">
              <td>${escapeHtml(asset.alias)}</td>
              <td>${escapeHtml(asset.type)}</td>
              <td>${asset.required ? "required" : "optional"}</td>
              <td>${escapeHtml(asset.status)}</td>
              <td>${escapeHtml(asset.source ?? "")}</td>
            </tr>`).join("");
  const audioRows = readiness.audio_assets.map((asset) => `<tr class="status-${escapeHtml(asset.status)}">
              <td>${escapeHtml(asset.id)}</td>
              <td>${escapeHtml(asset.family)}</td>
              <td>${escapeHtml(asset.status)}</td>
              <td>${escapeHtml(String(asset.cue_count))}</td>
              <td>${escapeHtml(asset.path ?? "")}</td>
            </tr>`).join("");
  const dependencyRows = readiness.storyboard_dependencies.map((scene) => `<tr class="status-${escapeHtml(scene.status)}">
              <td>${escapeHtml(scene.scene_id)}</td>
              <td>${escapeHtml(scene.aliases.join(", ") || "none")}</td>
              <td>${escapeHtml(scene.missing_aliases.join(", ") || "none")}</td>
              <td>${escapeHtml(scene.status)}</td>
            </tr>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(video.title)} HyperFrames Asset Readiness</title>
  <style>
    :root { color-scheme: light; --paper: #ece8e1; --surface: #fffdf8; --ink: #1a1a18; --muted: rgba(26,26,24,0.64); --line: rgba(26,26,24,0.16); --green: #62bd93; --coral: #f06f5f; --amber: #d69d35; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--paper); color: var(--ink); }
    main { max-width: 1440px; margin: 0 auto; padding: 32px 28px 56px; }
    header { display: grid; gap: 8px; border-bottom: 2px solid var(--line); padding-bottom: 22px; margin-bottom: 24px; }
    h1 { margin: 0; font-size: 42px; line-height: 1.02; letter-spacing: 0; }
    .sub { max-width: 820px; color: var(--muted); font-size: 15px; line-height: 1.45; margin: 0; }
    .metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 28px; }
    .metric { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); padding: 16px; }
    .metric span { display: block; color: var(--muted); font-size: 12px; font-weight: 800; text-transform: uppercase; }
    .metric strong { display: block; margin-top: 8px; font-size: 30px; line-height: 1; }
    section { margin-top: 28px; }
    .section-head { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
    h2 { margin: 0; font-size: 24px; letter-spacing: 0; }
    .note { color: var(--muted); font-size: 13px; }
    table { width: 100%; border-collapse: collapse; border: 1px solid var(--line); background: var(--surface); border-radius: 8px; overflow: hidden; }
    th, td { padding: 11px 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; font-size: 13px; line-height: 1.35; overflow-wrap: anywhere; }
    th { background: #1a1a18; color: var(--paper); font-size: 11px; text-transform: uppercase; }
    tr:last-child td { border-bottom: none; }
    .status-available-local-asset td:nth-child(4), .status-ready td:nth-child(4) { color: #16613f; font-weight: 900; }
    .status-missing-required-asset td:nth-child(4), .status-missing-assets td:nth-child(4), .status-expected-local-asset td:nth-child(3) { color: #9b6b12; font-weight: 900; }
    .status-placeholder-asset td:nth-child(4) { color: #b23225; font-weight: 900; }
    @media (max-width: 760px) {
      main { padding: 22px 16px 40px; }
      h1 { font-size: 32px; }
      .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      table { display: block; overflow-x: auto; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>HyperFrames Asset Readiness</h1>
      <p class="sub">${escapeHtml(video.title)}. Review real assets, missing requirements, placeholder risk, and storyboard dependencies before rendering.</p>
    </header>
    <section class="metrics" aria-label="Asset readiness summary">
      <div class="metric"><span>Real assets</span><strong>${readiness.summary.visual_real + readiness.summary.audio_real}</strong></div>
      <div class="metric"><span>Missing assets</span><strong>${readiness.summary.visual_missing + readiness.summary.audio_missing}</strong></div>
      <div class="metric"><span>Placeholders</span><strong>${readiness.summary.visual_placeholders + readiness.summary.audio_placeholders}</strong></div>
      <div class="metric"><span>Object templates</span><strong>${readiness.summary.object_templates}</strong></div>
    </section>
    <section>
      <div class="section-head">
        <h2>Visual Assets</h2>
        <span class="note">Required aliases include premium style needs and storyboard dependencies.</span>
      </div>
      <table>
        <thead><tr><th>Alias</th><th>Type</th><th>Need</th><th>Status</th><th>Source</th></tr></thead>
        <tbody>${visualRows || `<tr><td colspan="5">No visual assets declared.</td></tr>`}</tbody>
      </table>
    </section>
    <section>
      <div class="section-head">
        <h2>Audio Assets</h2>
        <span class="note">Expected SFX remain visible even when local files have not been provided.</span>
      </div>
      <table>
        <thead><tr><th>Asset</th><th>Family</th><th>Status</th><th>Cues</th><th>Path</th></tr></thead>
        <tbody>${audioRows || `<tr><td colspan="5">No audio assets declared.</td></tr>`}</tbody>
      </table>
    </section>
    <section>
      <div class="section-head">
        <h2>Storyboard Dependencies</h2>
        <span class="note">Scene-level asset gaps that may lower render quality.</span>
      </div>
      <table>
        <thead><tr><th>Scene</th><th>Aliases</th><th>Missing</th><th>Status</th></tr></thead>
        <tbody>${dependencyRows || `<tr><td colspan="4">No storyboard dependencies declared.</td></tr>`}</tbody>
      </table>
    </section>
  </main>
</body>
</html>
`;
}

function buildHyperframesSfxManifest(video) {
  const assetsById = new Map();
  const objects = Array.isArray(video.object_lifecycle) ? video.object_lifecycle : [];
  const cues = [];
  for (const object of objects) {
    for (const [stateIndex, state] of (Array.isArray(object.states) ? object.states : []).entries()) {
      if (!state.sfx) continue;
      const asset = registerHyperframesSfxAsset(assetsById, state.sfx, "object_lifecycle");
      cues.push({
        id: `${object.id}-${safeObjectId(state.state)}-${stateIndex}`,
        asset_id: asset.id,
        sound: state.sfx,
        object_id: object.id,
        scene_id: object.scene_id,
        state: state.state,
        at: round(Number(state.at ?? 0)),
        duration: round(Number(state.duration ?? asset.duration_hint_seconds)),
        gain_db: asset.gain_db,
        duck_voiceover: true,
        fade_ms: 18,
        trigger: "object_lifecycle"
      });
    }
  }
  const storyboardCues = [];
  for (const scene of Array.isArray(video.creative_storyboard?.scenes) ? video.creative_storyboard.scenes : []) {
    const range = parseTimeRange(scene.time_range);
    for (const [cueIndex, cueName] of (Array.isArray(scene.sfx_cues) ? scene.sfx_cues : []).entries()) {
      const asset = registerHyperframesSfxAsset(assetsById, cueName, "storyboard_sfx_cues");
      storyboardCues.push({
        id: `${safeObjectId(scene.id ?? scene.beat ?? "scene")}-${safeObjectId(cueName)}-${cueIndex}`,
        asset_id: asset.id,
        sound: cueName,
        scene_id: scene.id ?? scene.beat ?? "scene",
        at: round(Number.isFinite(range.start) ? range.start + cueIndex * 0.18 : cueIndex * 0.18),
        gain_db: asset.gain_db,
        duck_voiceover: true,
        trigger: "storyboard_sfx_cues"
      });
    }
  }
  return {
    schema_version: "launchclip.hyperframes-sfx.v1",
    source: "video/video.json#object_lifecycle",
    asset_base_path: "sfx/",
    missing_asset_policy: "Use explicit local assets first, then project-local default SFX generated from the required pack; only unresolved files stay silent.",
    mix: {
      master_gain_db: -12,
      voiceover_duck_db: -8,
      default_fade_ms: 18,
      max_polyphony: 3
    },
    runtime: {
      schema_version: "launchclip.hyperframes-audio-runtime.v1",
      scheduler: "gsap.delayedCall",
      preload_policy: "Preload available local audio assets and keep missing assets silent.",
      failure_policy: "Autoplay or missing-file failures are recorded on the stage dataset without blocking visual render.",
      duck_voiceover: true
    },
    assets: [...assetsById.values()].sort((a, b) => a.id.localeCompare(b.id)),
    cues,
    storyboard_cues: storyboardCues
  };
}

async function copyHyperframesSfxAssets(projectDir, assets, sfxManifest) {
  const availableAliases = hyperframesSfxAssetAliases(assets);
  const copied = [];
  const missing = [];
  const sfxDir = path.join(projectDir, "sfx");
  await mkdir(sfxDir, { recursive: true });
  const defaultPack = await prepareSfxPack({ publicDir: projectDir, allowPlaceholder: true });
  for (const asset of sfxManifest.assets) {
    const entry = availableAliases.get(asset.id);
    if (entry && await fileExists(entry.source_path)) {
      const targetName = asset.file_name || path.basename(entry.source_path);
      await copyFile(entry.source_path, path.join(sfxDir, targetName));
      copied.push({
        asset_id: asset.id,
        alias: entry.alias,
        source_path: entry.source_path,
        path: `sfx/${targetName}`
      });
      continue;
    }

    const fallback = await hyperframesDefaultSfxSource(asset, defaultPack.dir);
    if (!fallback) {
      missing.push(asset.id);
      continue;
    }
    const targetName = asset.file_name || path.basename(fallback.sourcePath);
    const targetPath = path.join(sfxDir, targetName);
    if (path.resolve(fallback.sourcePath) !== path.resolve(targetPath)) {
      await copyFile(fallback.sourcePath, targetPath);
    }
    copied.push({
      asset_id: asset.id,
      alias: fallback.alias,
      source_path: fallback.sourcePath,
      path: `sfx/${targetName}`
    });
  }
  return { copied, missing };
}

async function hyperframesDefaultSfxSource(asset, generatedSfxDir) {
  const packageSfxDir = path.join(PACKAGE_ROOT, "public", "sfx");
  const names = [...new Set([
    asset.file_name,
    HYPERFRAMES_DEFAULT_SFX_BY_FAMILY[asset.family],
    "tick.wav"
  ].filter(Boolean))];
  for (const dir of [packageSfxDir, generatedSfxDir]) {
    for (const name of names) {
      const sourcePath = path.join(dir, name);
      if (await fileExists(sourcePath)) {
        return {
          alias: path.resolve(dir) === path.resolve(generatedSfxDir) ? "generated-default-sfx" : "default-sfx-pack",
          sourcePath
        };
      }
    }
  }
  return null;
}

function hyperframesSfxAssetAliases(assets) {
  const aliases = new Map();
  for (const entry of Object.values(assets?.aliases ?? {})) {
    if (!isHyperframesSfxAsset(entry)) continue;
    for (const key of hyperframesSfxAliasKeys(entry)) {
      aliases.set(key, entry);
    }
  }
  return aliases;
}

function isHyperframesSfxAsset(entry) {
  const type = String(entry?.type ?? "").toLowerCase();
  const alias = String(entry?.alias ?? "").toLowerCase();
  const extension = path.extname(entry?.source_path ?? entry?.manifest_path ?? "").toLowerCase();
  return type === "sfx" || type === "audio" || alias.startsWith("sfx-") || [".wav", ".mp3", ".m4a", ".aac", ".aiff"].includes(extension);
}

function hyperframesSfxAliasKeys(entry) {
  const alias = normalizeAssetAlias(entry?.alias);
  const baseName = normalizeAssetAlias(path.basename(entry?.source_path ?? entry?.manifest_path ?? "", path.extname(entry?.source_path ?? entry?.manifest_path ?? "")));
  const withoutPrefix = alias.startsWith("sfx-") ? alias.slice(4) : alias;
  return [...new Set([alias, withoutPrefix, baseName].filter(Boolean))];
}

function applyHyperframesSfxAvailability(sfxManifest, sfxCopy) {
  const copiedByAsset = new Map(sfxCopy.copied.map((entry) => [entry.asset_id, entry]));
  const assets = sfxManifest.assets.map((asset) => {
    const copied = copiedByAsset.get(asset.id);
    if (!copied) return asset;
    return {
      ...asset,
      path: copied.path,
      status: "available-local-asset",
      source_alias: copied.alias
    };
  });
  const missing = assets.filter((asset) => asset.status !== "available-local-asset").map((asset) => asset.id);
  return {
    ...sfxManifest,
    copied_assets: sfxCopy.copied,
    missing_assets: missing,
    assets
  };
}

function registerHyperframesSfxAsset(assetsById, value, source) {
  const raw = String(value ?? "").trim();
  const stem = raw.replace(/\.[^.]+$/, "") || "ui-hit";
  const id = safeObjectId(stem.replace(/_/g, "-"));
  const fileName = /\.[a-z0-9]+$/i.test(raw) ? raw : `${stem}.wav`;
  const existing = assetsById.get(id);
  if (existing) {
    if (!existing.sources.includes(source)) existing.sources.push(source);
    return existing;
  }
  const asset = {
    id,
    name: stem,
    file_name: fileName,
    path: `sfx/${fileName}`,
    family: hyperframesSfxFamily(stem),
    gain_db: hyperframesSfxGain(stem),
    duration_hint_seconds: hyperframesSfxDuration(stem),
    status: "expected-local-asset",
    sources: [source]
  };
  assetsById.set(id, asset);
  return asset;
}

function hyperframesSfxFamily(value) {
  const text = String(value).toLowerCase();
  if (text.includes("type") || text.includes("key") || text.includes("terminal")) return "typing-tick";
  if (text.includes("connector") || text.includes("pop") || text.includes("snap")) return "connector-pop";
  if (text.includes("success") || text.includes("ding") || text.includes("check")) return "success-ding";
  if (text.includes("paper") || text.includes("folder") || text.includes("file")) return "paper-hit";
  if (text.includes("whoosh") || text.includes("whip") || text.includes("wipe")) return "whoosh";
  if (text.includes("warning")) return "warning-tap";
  if (text.includes("thump") || text.includes("hit")) return "soft-thump";
  return "ui-hit";
}

function hyperframesSfxGain(value) {
  const family = hyperframesSfxFamily(value);
  if (family === "typing-tick") return -20;
  if (family === "connector-pop") return -17;
  if (family === "success-ding") return -16;
  if (family === "whoosh") return -18;
  return -19;
}

function hyperframesSfxDuration(value) {
  const family = hyperframesSfxFamily(value);
  if (family === "typing-tick") return 0.08;
  if (family === "whoosh") return 0.34;
  if (family === "success-ding") return 0.42;
  return 0.22;
}

function renderHyperframesLifecycleObject(object, scene) {
  const template = object.template ?? "paper_card";
  const states = lifecycleStateNames(object);
  const sfxCount = objectSfxList(object).length;
  const sourceStatus = object.template_data?.evidence ? "source-declared" : "missing-source";
  const qualityStatus = hyperframesObjectQualityStatus(object, template);
  const stateStrip = states.slice(0, 6).map((state) => `<i class="object-state-dot state-${escapeHtml(state)}" title="${escapeHtml(state)}"></i>`).join("");
  const ariaLabel = `HyperFrames ${templateDisplayName(template)} object ${object.label ?? object.id}; role ${object.role ?? "object"}; ${sourceStatus}; states ${states.join(", ") || "none"}`;
  return `<div class="lifecycle-object hf-object hf-object--${escapeHtml(template)}" data-polish="launchclip.object-polish.v1" data-quality="${escapeHtml(qualityStatus)}" data-source-status="${escapeHtml(sourceStatus)}" data-state-count="${states.length}" data-sfx-count="${sfxCount}" data-object-id="${escapeHtml(object.id)}" data-role="${escapeHtml(object.role)}" data-ref="${escapeHtml(object.ref)}" data-template="${escapeHtml(template)}" data-states="${escapeHtml(JSON.stringify(object.states))}" aria-label="${escapeHtml(ariaLabel)}">
          <div class="object-chrome" aria-hidden="true">
            <span class="object-template-badge">${escapeHtml(templateDisplayName(template))}</span>
            <span class="object-state-strip">${stateStrip}</span>
            <span class="object-source-badge">${escapeHtml(sourceStatus)}</span>
          </div>
          <div class="object-inner">
            ${renderHyperframesObjectTemplate(object, scene, template)}
          </div>
        </div>`;
}

function hyperframesObjectQualityStatus(object, template) {
  const states = lifecycleStateNames(object);
  const hasCoreStates = lifecycleCoreStateOrderValid(states);
  const hasSfx = objectSfxList(object).length > 0;
  const hasSource = Boolean(object.template_data?.evidence);
  const mediaSlots = Array.isArray(object.template_data?.media_slots) ? object.template_data.media_slots.filter(Boolean) : [];
  const aliases = Array.isArray(object.template_data?.aliases) ? object.template_data.aliases.filter(Boolean) : [];
  const dataReady = template === "chart" ? mediaSlots.length >= 2 : template === "diagram" ? aliases.length >= 2 : true;
  return hasCoreStates && hasSfx && hasSource && dataReady ? "review-ready" : "needs-review";
}

function renderHyperframesObjectTemplate(object, scene, template) {
  if (template === "terminal_ui") return renderTerminalObject(object);
  if (template === "prompt_ui") return renderPromptObject(object);
  if (template === "diagram") return renderDiagramObject(object);
  if (template === "chart") return renderChartObject(object);
  if (template === "brand_token") return renderBrandTokenObject(object);
  if (template === "folder_stack") return renderFolderStackObject(object);
  if (template === "proof_card") return renderProofCardObject(object);
  if (template === "cta_card") return renderCtaObject(object);
  return renderPaperObject(object, scene);
}

function renderTerminalObject(object) {
  const label = escapeHtml(object.label ?? "terminal proof");
  return `<div class="object-terminal">
            <div class="terminal-top"><span></span><span></span><span></span><em>${escapeHtml(object.template_data?.evidence ?? "proof")}</em></div>
            <code><b>$</b> launchclip render --provider hyperframes</code>
            <code class="terminal-line">status: ready</code>
            <strong>${label}</strong>
          </div>`;
}

function renderPromptObject(object) {
  const label = escapeHtml(object.label ?? "prompt");
  const aliases = object.template_data?.aliases ?? [];
  return `<div class="object-prompt">
            <div class="prompt-text">${label}</div>
            <div class="prompt-chips">${aliases.map((alias) => `<span>${escapeHtml(alias)}</span>`).join("") || "<span>asset</span><span>proof</span>"}</div>
            <div class="prompt-send">send</div>
          </div>`;
}

function renderDiagramObject(object) {
  const aliases = object.template_data?.aliases?.length ? object.template_data.aliases : ["input", "proof", "review"];
  return `<div class="object-diagram">
            <div class="diagram-endpoint-count">${aliases.length} endpoints</div>
            <div class="diagram-node node-a">${escapeHtml(aliases[0] ?? "input")}</div>
            <div class="diagram-connector-line line-a"></div>
            <div class="diagram-node node-b">${escapeHtml(aliases[1] ?? "proof")}</div>
            <div class="diagram-connector-line line-b"></div>
            <div class="diagram-node node-c">${escapeHtml(aliases[2] ?? "review")}</div>
            <div class="diagram-legend">Connector endpoints stay source-backed</div>
          </div>`;
}

function renderChartObject(object) {
  const slots = object.template_data?.media_slots?.length ? object.template_data.media_slots : ["brief", "captions", "review"];
  return `<div class="object-chart">
            <strong>${escapeHtml(object.label ?? "proof chart")}</strong>
            <div class="chart-bars">
              ${slots.slice(0, 4).map((slot, index) => `<span data-value="${42 + index * 17}"><i class="chart-bar-fill" style="height:${42 + index * 17}%"></i><small class="chart-value">${42 + index * 17}</small><em>${escapeHtml(slot)}</em></span>`).join("")}
            </div>
            <div class="chart-legend"><span><i></i>data marks</span><span><i></i>source-backed</span></div>
          </div>`;
}

function renderBrandTokenObject(object) {
  const aliases = object.template_data?.aliases?.length ? object.template_data.aliases : [object.label ?? "brand"];
  return `<div class="object-brand-token">
            ${aliases.slice(0, 3).map((alias) => `<span>${escapeHtml(alias).slice(0, 2).toUpperCase()}</span>`).join("")}
            <strong>${escapeHtml(object.label ?? "brand token")}</strong>
          </div>`;
}

function renderFolderStackObject(object) {
  const slots = object.template_data?.media_slots?.length ? object.template_data.media_slots : ["script", "captions", "review"];
  return `<div class="object-folder-stack">
            <div class="folder-tab">${escapeHtml(object.template_data?.evidence ?? "packet")}</div>
            ${slots.slice(0, 3).map((slot, index) => `<span class="folder-file file-${index}">${escapeHtml(slot)}</span>`).join("")}
          </div>`;
}

function renderProofCardObject(object) {
  const rows = object.template_data?.media_slots?.length ? object.template_data.media_slots : ["demo", "script", "review"];
  return `<div class="object-proof-card">
            <span class="object-role">${escapeHtml(object.role)}</span>
            <strong>${escapeHtml(object.label ?? "proof card")}</strong>
            <div class="proof-rows">${rows.slice(0, 4).map((row) => `<span class="proof-row"><i></i>${escapeHtml(row)}</span>`).join("")}</div>
          </div>`;
}

function renderCtaObject(object) {
  return `<div class="object-cta">
            <strong>${escapeHtml(object.label ?? "review first")}</strong>
            <span class="cta-check">OK</span>
            <span>${escapeHtml(object.template_data?.evidence ?? "approval boundary")}</span>
          </div>`;
}

function renderPaperObject(object, scene) {
  return `<div class="object-paper-card">
            <span class="object-role">${escapeHtml(object.role || "object")}</span>
            <strong>${escapeHtml(object.label ?? scene.caption ?? object.id)}</strong>
            <span class="object-ref">${escapeHtml(object.ref)}</span>
          </div>`;
}

function dataStoryEditorialSectionMeta(segment, index) {
  const presets = {
    "public-record-hook": {
      kicker: "THE BENCHMARK",
      headline: "LAUNCHCLIP JUST GRADED ITS OWN OUTPUT",
      subhead: "47,582 synthetic viewer seconds stress-tested",
      module: "hook",
      accent: "orange",
      statChips: [
        ["47,582", "synthetic seconds"],
        ["150s", "target hold"],
        ["8", "editorial sections"]
      ]
    },
    "hopes-chart": {
      kicker: "THE HOPES",
      headline: "What a launch clip has to deliver",
      module: "bars",
      accent: "orange",
      bars: [
        ["proof moves", 48, "orange"],
        ["charts clarify", 36, "blue"],
        ["captions land", 29, "orange"],
        ["review is safe", 22, "blue"],
        ["sound supports", 18, "orange"]
      ],
      statChips: [
        ["48%", "want proof motion"],
        ["36%", "need clear charts"]
      ]
    },
    "fears-chart": {
      kicker: "THE FEARS",
      headline: "And the weak spots hit harder",
      module: "bars",
      accent: "purple",
      bars: [
        ["dead holds", 64, "blue"],
        ["white cards", 56, "orange"],
        ["weak hooks", 51, "blue"],
        ["tiny labels", 45, "orange"],
        ["flat audio", 39, "blue"]
      ],
      statChips: [
        ["64%", "fear dead holds"],
        ["56%", "notice white cards"]
      ]
    },
    "state-grid": {
      kicker: "EVERY SCENARIO",
      headline: "Dead air: the number-one fear everywhere",
      module: "grid",
      accent: "orange",
      statChips: [
        ["71%", "flow risk"],
        ["57%", "scene fatigue"],
        ["50", "synthetic tiles"]
      ]
    },
    "twist-chart": {
      kicker: "THE TWIST",
      headline: "The prettier the card, the more viewers punish stillness",
      module: "bars",
      accent: "blue",
      bars: [
        ["visual polish", 82, "blue"],
        ["motion clarity", 74, "blue"],
        ["source labels", 70, "blue"],
        ["sound timing", 64, "blue"],
        ["plain card", 31, "blue"]
      ],
      statChips: [
        ["68%", "prefer motion"],
        ["70/54", "source + timing wins"]
      ]
    },
    "ask-map": {
      kicker: "THE ASK",
      headline: "Can the renderer step in before retention drops?",
      module: "blue-grid",
      accent: "green",
      statChips: [
        ["71%", "want motion guardrails"],
        ["47%", "want visual QA"],
        ["1.2s", "max stillness"]
      ]
    },
    "trust-answer": {
      kicker: "THE ANSWER",
      headline: "Who should decide if a launch clip is ready?",
      module: "compare",
      accent: "orange",
      statChips: [
        ["20%", "trust automation alone"],
        ["44%", "want analyst review"]
      ]
    },
    "verdict-cta": {
      kicker: "THE VERDICT",
      headline: "15%",
      subhead: "trust a generated clip with no visual QA",
      module: "verdict",
      accent: "orange",
      statChips: [
        ["review first", "then render"],
        ["no copy", "original script"],
        ["ship only", "when metrics pass"]
      ]
    }
  };
  const preset = presets[segment.beat] ?? presets["hopes-chart"];
  const range = parseTimeRange(segment.time_range);
  const start = Number.isFinite(range.start) ? range.start : index * 10;
  const end = Number.isFinite(range.end) ? range.end : start + Number(segment.target_seconds ?? 10);
  return {
    ...preset,
    id: segment.beat ?? `section-${index + 1}`,
    order: index + 1,
    start,
    duration: Math.max(0.8, end - start),
    timeRange: segment.time_range ?? `${start}-${end}s`,
    voiceover: segment.voiceover ?? "",
    caption: segment.caption ?? preset.headline,
    emphasis: Array.isArray(segment.caption_emphasis) ? segment.caption_emphasis : [],
    evidence: segment.evidence_source ?? "synthetic benchmark fixture"
  };
}

function renderEditorialBars(section) {
  const bars = section.bars ?? [
    ["proof", 48, "orange"],
    ["motion", 36, "blue"],
    ["review", 22, "orange"]
  ];
  return `<div class="chart-card bars-card">
      <h2>${escapeHtml(section.headline)}</h2>
      <div class="bar-list">
        ${bars.map(([label, value, color]) => `<div class="bar-row ${escapeHtml(color)}">
          <span>${escapeHtml(label)}</span>
          <div class="bar-track"><i style="--w:${Number(value)}%"></i></div>
          <b>${Number(value)}%</b>
        </div>`).join("")}
      </div>
      <small>synthetic launchclip benchmark fixture</small>
    </div>`;
}

function renderEditorialGrid(section, blue = false) {
  const cells = Array.from({ length: 50 }, (_, index) => {
    const hot = [2, 6, 9, 14, 18, 21, 25, 29, 33, 37, 41, 44, 48].includes(index);
    const medium = index % 4 === 0 || index % 7 === 0;
    const cls = hot ? "hot" : medium ? "mid" : "low";
    return `<i class="${cls}"></i>`;
  }).join("");
  return `<div class="chart-card map-card ${blue ? "blue-map" : "orange-map"}">
      <h2>${escapeHtml(section.headline)}</h2>
      <div class="tile-map">${cells}</div>
      <div class="map-legend"><span>low</span><span>medium</span><span>high</span></div>
      <small>50 synthetic launch scenarios, not public survey data</small>
    </div>`;
}

function renderEditorialCompare(section) {
  return `<div class="compare-wrap">
      <div class="compare-card red"><span>trust automation</span><strong>15</strong><em>no QA</em></div>
      <div class="versus">VS</div>
      <div class="compare-card green"><span>trust analyst review</span><strong>43</strong><em>with metrics</em></div>
    </div>
    <p class="micro-copy">${escapeHtml(section.headline)}</p>`;
}

function renderEditorialHook(section) {
  return `<div class="hook-lockup">
      <strong>${escapeHtml(section.headline)}</strong>
      <span>${escapeHtml(section.subhead ?? "")}</span>
      <div class="count-strip"><b>47.582</b><em>synthetic seconds assessed</em></div>
    </div>`;
}

function renderEditorialVerdict(section) {
  return `<div class="verdict-card">
      <span>${escapeHtml(section.kicker)}</span>
      <strong>${escapeHtml(section.headline)}</strong>
      <p>${escapeHtml(section.subhead ?? "")}</p>
    </div>
    <div class="url-pill">launchclip.local / review</div>`;
}

function renderEditorialModule(section) {
  if (section.module === "hook") return renderEditorialHook(section);
  if (section.module === "grid") return renderEditorialGrid(section, false);
  if (section.module === "blue-grid") return renderEditorialGrid(section, true);
  if (section.module === "compare") return renderEditorialCompare(section);
  if (section.module === "verdict") return renderEditorialVerdict(section);
  return renderEditorialBars(section);
}

function renderDataStoryEditorialHyperframesIndex(manifest, video, sfxManifest = null) {
  const width = 1080;
  const height = 1920;
  const duration = Number(video.duration_seconds ?? 150);
  const sections = (video.script_visual_alignment ?? video.voiceover?.timeline ?? [])
    .map((segment, index) => dataStoryEditorialSectionMeta(segment, index));
  const resolvedSfxManifest = sfxManifest ?? buildHyperframesSfxManifest(video);
  const sfxManifestJson = JSON.stringify(resolvedSfxManifest).replace(/</g, "\\u003c");
  const sectionHtml = sections.map((section, index) => {
    const chips = (section.statChips ?? []).map(([value, label]) => `<span class="stat-chip"><b>${escapeHtml(String(value))}</b><em>${escapeHtml(String(label))}</em></span>`).join("");
    return `<section class="editorial-section section-${index + 1} accent-${escapeHtml(section.accent)}" data-start="${section.start}" data-duration="${section.duration.toFixed(2)}" data-section-id="${escapeHtml(section.id)}">
      <div class="section-kicker">${escapeHtml(section.kicker)}</div>
      <div class="section-clock">${escapeHtml(section.timeRange)}</div>
      <div class="section-module">${renderEditorialModule(section)}</div>
      <div class="stat-row">${chips}</div>
      <div class="source-chip">${escapeHtml(section.evidence)}</div>
    </section>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=${width}, height=${height}" />
  <title>${escapeHtml(video.title)} editorial data story</title>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@hyperframes/core/dist/hyperframe.runtime.iife.js"></script>
  <style>
    * { box-sizing: border-box; }
    html, body { width: ${width}px; height: ${height}px; margin: 0; overflow: hidden; background: #070a12; color: #f5efe7; }
    body { font-family: Inter, Arial, sans-serif; }
    #stage { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; background: radial-gradient(circle at 50% 18%, rgba(43,62,103,0.38), transparent 34%), linear-gradient(180deg, #111521 0%, #060914 56%, #05070d 100%); }
    .atlas-noise, .atlas-lines, .atlas-shapes, .vignette, .progress-rail, .masthead, .rec-dot, .runtime-code { position: absolute; pointer-events: none; }
    .atlas-noise { inset: 0; opacity: 0.32; background-image: linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px); background-size: 84px 84px; }
    .atlas-lines { inset: -80px; opacity: 0.28; background: radial-gradient(circle at 26% 26%, rgba(112,128,156,0.32) 0 4px, transparent 5px), radial-gradient(circle at 62% 34%, rgba(112,128,156,0.28) 0 4px, transparent 5px), radial-gradient(circle at 42% 66%, rgba(112,128,156,0.26) 0 3px, transparent 4px), linear-gradient(35deg, transparent 0 43%, rgba(112,128,156,0.16) 43.2% 43.4%, transparent 43.7% 100%); background-size: 310px 310px, 420px 420px, 370px 370px, 540px 540px; transform: rotate(-8deg) scale(1.08); }
    .atlas-shapes { inset: 0; opacity: 0.24; }
    .atlas-shapes i { position: absolute; width: 120px; height: 54px; background: #5b6071; clip-path: polygon(0 40%, 18% 22%, 26% 42%, 45% 12%, 58% 34%, 74% 24%, 100% 50%, 78% 74%, 54% 66%, 40% 88%, 22% 64%); }
    .atlas-shapes i:nth-child(1) { left: 70px; top: 520px; transform: rotate(-20deg); }
    .atlas-shapes i:nth-child(2) { right: 70px; top: 360px; transform: rotate(18deg) scale(1.2); }
    .atlas-shapes i:nth-child(3) { right: 120px; bottom: 180px; transform: rotate(30deg); }
    .atlas-shapes i:nth-child(4) { left: 160px; bottom: 420px; transform: rotate(-8deg) scale(0.85); }
    .vignette { inset: 0; box-shadow: inset 0 0 140px rgba(0,0,0,0.58), inset 0 0 36px rgba(255,108,69,0.12); }
    .masthead { top: 58px; left: 0; right: 0; text-align: center; font-size: 52px; letter-spacing: 0.08em; font-weight: 900; color: #fff8ef; text-transform: uppercase; z-index: 10; }
    .rec-dot { top: 32px; left: 32px; z-index: 10; color: #ff7157; font-size: 18px; font-weight: 900; text-transform: uppercase; }
    .rec-dot::before { content: ""; display: inline-block; width: 8px; height: 8px; margin-right: 8px; border-radius: 50%; background: #ff3c2f; box-shadow: 0 0 14px rgba(255,60,47,0.8); }
    .runtime-code { top: 32px; right: 32px; z-index: 10; color: rgba(245,239,231,0.62); font-size: 18px; font-variant-numeric: tabular-nums; }
    .progress-rail { left: 22px; right: 22px; bottom: 20px; z-index: 12; height: 5px; background: rgba(245,239,231,0.12); }
    .progress-fill { height: 100%; width: 0%; background: linear-gradient(90deg, #ff784f, #f0b35b); box-shadow: 0 0 22px rgba(255,120,79,0.5); }
    .editorial-section { position: absolute; inset: 0; padding: 168px 72px 86px; opacity: 0; transform: translateY(22px); z-index: 5; }
    .section-kicker { text-align: center; margin-top: 8px; font-size: 18px; letter-spacing: 0.22em; color: #ff784f; font-weight: 900; text-transform: uppercase; }
    .accent-blue .section-kicker { color: #70a9ff; }
    .accent-purple .section-kicker { color: #a88bff; }
    .accent-green .section-kicker { color: #6fe5ac; }
    .section-clock { position: absolute; top: 118px; right: 44px; color: rgba(245,239,231,0.46); font-size: 16px; font-weight: 800; }
    .section-module { position: absolute; left: 74px; right: 74px; top: 250px; min-height: 920px; display: grid; place-items: center; }
    .stat-row { position: absolute; left: 70px; right: 70px; bottom: 122px; display: flex; justify-content: center; gap: 14px; min-height: 62px; }
    .stat-chip { min-width: 190px; min-height: 58px; padding: 12px 18px; border-radius: 14px; background: rgba(13,16,24,0.92); border: 1px solid rgba(245,239,231,0.12); box-shadow: 0 16px 38px rgba(0,0,0,0.32); display: inline-flex; align-items: center; gap: 8px; justify-content: center; white-space: nowrap; }
    .stat-chip b { color: #ff784f; font-size: 26px; line-height: 1; }
    .accent-blue .stat-chip b { color: #70a9ff; }
    .accent-green .stat-chip b { color: #6fe5ac; }
    .stat-chip em { color: rgba(245,239,231,0.76); font-size: 16px; font-style: normal; font-weight: 800; }
    .source-chip { position: absolute; left: 50%; bottom: 74px; transform: translateX(-50%); color: rgba(245,239,231,0.44); font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; }
    .chart-card { width: 600px; min-height: 520px; padding: 34px 38px 28px; border-radius: 12px; background: #f3efe5; color: #141820; box-shadow: 0 0 0 1px rgba(255,255,255,0.35), 0 30px 80px rgba(0,0,0,0.42); }
    .chart-card h2 { margin: 0 0 24px; color: #141820; font-size: 31px; line-height: 1.05; text-align: center; }
    .chart-card small { display: block; margin-top: 20px; color: rgba(20,24,32,0.52); font-size: 12px; text-align: center; text-transform: uppercase; letter-spacing: 0.08em; }
    .bar-list { display: grid; gap: 13px; }
    .bar-row { display: grid; grid-template-columns: 160px 1fr 54px; gap: 12px; align-items: center; font-size: 17px; font-weight: 800; }
    .bar-row span { color: rgba(20,24,32,0.76); }
    .bar-row b { text-align: right; font-size: 18px; }
    .bar-track { height: 22px; border-radius: 4px; background: rgba(20,24,32,0.08); overflow: hidden; }
    .bar-track i { display: block; width: var(--w); height: 100%; transform-origin: left center; background: #ff784f; }
    .bar-row.blue .bar-track i { background: #2f8cff; }
    .bar-row.orange .bar-track i { background: #ff784f; }
    .map-card { width: 548px; min-height: 620px; }
    .tile-map { display: grid; grid-template-columns: repeat(10, 1fr); gap: 8px; width: 430px; margin: 26px auto 20px; }
    .tile-map i { height: 33px; border-radius: 3px; background: #f4be57; box-shadow: inset 0 0 0 1px rgba(20,24,32,0.16); }
    .tile-map i.mid { background: #f09a28; }
    .tile-map i.hot { background: #dd6a14; }
    .blue-map .tile-map i { background: #9bc9ff; }
    .blue-map .tile-map i.mid { background: #5fa9ff; }
    .blue-map .tile-map i.hot { background: #2675d8; }
    .map-legend { display: flex; justify-content: center; gap: 18px; color: rgba(20,24,32,0.58); font-size: 14px; text-transform: uppercase; }
    .hook-lockup { width: 820px; min-height: 680px; display: grid; align-content: center; gap: 24px; text-align: left; }
    .hook-lockup strong { display: block; font-size: 72px; line-height: 0.92; color: #fff8ef; text-shadow: 0 14px 44px rgba(0,0,0,0.46); }
    .hook-lockup span { display: block; color: rgba(245,239,231,0.82); font-size: 26px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; }
    .count-strip { width: 440px; padding: 12px 18px; border-radius: 8px; background: rgba(255,120,79,0.2); box-shadow: inset 0 0 0 1px rgba(255,120,79,0.36); display: flex; align-items: center; gap: 12px; }
    .count-strip b { color: #ff784f; font-size: 42px; }
    .count-strip em { color: #f5efe7; font-size: 16px; font-style: normal; font-weight: 900; text-transform: uppercase; }
    .compare-wrap { width: 780px; display: grid; grid-template-columns: 1fr 84px 1fr; align-items: center; gap: 20px; }
    .compare-card { min-height: 260px; border-radius: 18px; padding: 30px; background: rgba(14,18,27,0.92); border: 1px solid rgba(245,239,231,0.12); box-shadow: 0 24px 64px rgba(0,0,0,0.34); text-align: center; }
    .compare-card span { display: block; color: rgba(245,239,231,0.68); font-size: 17px; font-weight: 900; text-transform: uppercase; }
    .compare-card strong { display: block; margin-top: 18px; font-size: 96px; line-height: 1; }
    .compare-card em { display: block; color: rgba(245,239,231,0.58); font-size: 16px; font-style: normal; font-weight: 900; text-transform: uppercase; }
    .compare-card.red strong { color: #ff755f; }
    .compare-card.green strong { color: #6fe5ac; }
    .versus { width: 64px; height: 64px; border-radius: 50%; display: grid; place-items: center; background: #f3efe5; color: #111521; font-weight: 900; }
    .micro-copy { margin: 28px auto 0; max-width: 760px; text-align: center; font-size: 31px; font-weight: 900; color: #f5efe7; }
    .verdict-card { width: 760px; min-height: 360px; padding: 42px; border-radius: 16px; background: rgba(12,16,24,0.94); border: 1px solid rgba(255,120,79,0.38); box-shadow: 0 0 42px rgba(255,120,79,0.16), 0 24px 80px rgba(0,0,0,0.48); text-align: center; }
    .verdict-card span { color: #6fe5ac; font-size: 18px; font-weight: 900; letter-spacing: 0.2em; }
    .verdict-card strong { display: block; color: #ff784f; font-size: 124px; line-height: 1; margin-top: 18px; }
    .verdict-card p { margin: 14px auto 0; max-width: 460px; color: #f5efe7; font-size: 26px; font-weight: 900; }
    .url-pill { margin-top: 30px; padding: 14px 26px; border-radius: 10px; background: rgba(245,239,231,0.12); color: #f5efe7; font-size: 26px; font-weight: 900; text-align: center; }
    .wipe { position: absolute; inset: 0; z-index: 9; pointer-events: none; background: linear-gradient(115deg, transparent 0 34%, rgba(245,239,231,0.08) 42%, rgba(255,120,79,0.26) 50%, rgba(245,239,231,0.06) 58%, transparent 68%); transform: translateX(-120%) skewX(-12deg); filter: blur(4px); }
  </style>
</head>
<body>
  <div id="stage" data-composition-id="LaunchclipHyperframes" data-start="0" data-duration="${duration}" data-width="${width}" data-height="${height}" data-sfx-runtime="launchclip.hyperframes-audio-runtime.v1" data-sfx-manifest="sfx-manifest.json">
    <div class="atlas-noise"></div>
    <div class="atlas-lines"></div>
    <div class="atlas-shapes"><i></i><i></i><i></i><i></i></div>
    <div class="masthead">LAUNCHCLIP</div>
    <div class="rec-dot">REC</div>
    <div class="runtime-code">00:02:30</div>
    <div class="wipe"></div>
${sectionHtml}
    <div class="progress-rail"><div class="progress-fill"></div></div>
    <div class="vignette"></div>
  </div>
  <script type="application/json" id="launchclip-sfx-manifest">${sfxManifestJson}</script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true, defaults: { ease: "power3.out" } });
    window.__timelines["LaunchclipHyperframes"] = tl;
    const totalDuration = ${duration};
    const sections = Array.from(document.querySelectorAll(".editorial-section"));
    const progress = document.querySelector(".progress-fill");
    const wipe = document.querySelector(".wipe");
    gsap.set(sections, { autoAlpha: 0, y: 22 });
    tl.to(".atlas-lines", { x: -58, y: 36, rotation: -5, duration: totalDuration, ease: "none" }, 0);
    tl.to(".atlas-shapes", { x: 42, y: -34, duration: totalDuration, ease: "none" }, 0);
    tl.to(".atlas-noise", { backgroundPosition: "160px 220px", duration: totalDuration, ease: "none" }, 0);
    sections.forEach((section, index) => {
      const start = Number(section.dataset.start || 0);
      const dur = Number(section.dataset.duration || 8);
      const module = section.querySelector(".section-module");
      const card = section.querySelector(".chart-card, .hook-lockup, .compare-wrap, .verdict-card");
      const bars = section.querySelectorAll(".bar-track i");
      const tiles = section.querySelectorAll(".tile-map i");
      const chips = section.querySelectorAll(".stat-chip");
      tl.to(section, { autoAlpha: 1, y: 0, duration: 0.36 }, start);
      tl.fromTo(wipe, { xPercent: -120 }, { xPercent: 120, duration: 0.68, ease: "power2.inOut" }, Math.max(0, start - 0.04));
      if (card) tl.fromTo(card, { y: 44, scale: 0.92, filter: "blur(12px)" }, { y: 0, scale: 1, filter: "blur(0px)", duration: 0.62 }, start + 0.08);
      if (card) tl.to(card, { y: index % 2 ? -24 : 22, scale: 1.025, duration: Math.max(1, dur - 1.4), ease: "sine.inOut" }, start + 0.72);
      if (bars.length) {
        tl.fromTo(bars, { scaleX: 0 }, { scaleX: 1, duration: 0.62, stagger: 0.12, ease: "power3.out" }, start + 0.48);
        tl.to(bars, { filter: "brightness(1.32)", repeat: Math.max(1, Math.floor(dur / 3)), yoyo: true, duration: 0.22, stagger: 0.08, ease: "sine.inOut" }, start + 1.6);
      }
      if (tiles.length) {
        tl.fromTo(tiles, { scale: 0.45, autoAlpha: 0.22 }, { scale: 1, autoAlpha: 1, duration: 0.34, stagger: { each: 0.018, from: "center" } }, start + 0.42);
        tl.to(tiles, { scale: 0.88, repeat: Math.max(2, Math.floor(dur / 3)), yoyo: true, duration: 0.18, stagger: { each: 0.006, from: "random" }, ease: "sine.inOut" }, start + 1.4);
      }
      if (chips.length) {
        tl.fromTo(chips, { y: 22, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.28, stagger: 0.16 }, start + Math.min(2.6, dur * 0.4));
        tl.to(chips, { scale: 1.045, repeat: Math.max(1, Math.floor(dur / 4)), yoyo: true, duration: 0.24, stagger: 0.09, ease: "sine.inOut" }, start + Math.min(3.3, dur * 0.5));
      }
      if (module) {
        tl.to(module, { scale: 1.055, x: index % 2 ? -34 : 34, y: index % 3 ? -28 : 22, duration: Math.max(1, dur - 1.4), ease: "sine.inOut" }, start + 0.72);
      }
      tl.to(progress, { width: ((start + dur) / totalDuration * 100).toFixed(3) + "%", duration: dur, ease: "none" }, start);
      tl.to(section, { autoAlpha: 0, y: -18, duration: 0.3, ease: "power2.in" }, start + dur - 0.32);
    });
    if (window.HyperframeRuntime && typeof window.HyperframeRuntime.mount === "function") {
      window.HyperframeRuntime.mount({ timelines: window.__timelines });
    }
  </script>
</body>
</html>`;
}

function renderHyperframesIndex(manifest, video, sfxManifest = null) {
  const width = 1080;
  const height = 1920;
  const lifecycleObjects = Array.isArray(video.object_lifecycle) ? video.object_lifecycle : [];
  const resolvedSfxManifest = sfxManifest ?? buildHyperframesSfxManifest(video);
  if (isDataStoryBenchmarkStyle(video.style)) {
    return renderDataStoryEditorialHyperframesIndex(manifest, video, resolvedSfxManifest);
  }
  const sfxManifestJson = JSON.stringify(resolvedSfxManifest).replace(/</g, "\\u003c");
  const availableSfxAssets = (resolvedSfxManifest.assets ?? []).filter((asset) => asset.status === "available-local-asset" && asset.path);
  const audioAssetHtml = availableSfxAssets.map((asset) => `<audio class="launchclip-sfx-audio" data-sfx-id="${escapeHtml(asset.id)}" data-sfx-family="${escapeHtml(asset.family)}" data-sfx-gain="${escapeHtml(String(asset.gain_db ?? -18))}" src="${escapeHtml(asset.path)}" preload="auto"></audio>`).join("\n    ");
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
  const sceneHtml = scenes.map((scene) => {
    const sceneObjects = lifecycleObjects.filter((object) => object.scene_id === scene.id);
    const objectHtml = sceneObjects.map((object) => renderHyperframesLifecycleObject(object, scene)).join("\n");
    return `<section id="scene-${scene.index + 1}" class="clip scene scene-${scene.index % 5}" data-start="${scene.start}" data-duration="${scene.duration.toFixed(2)}" data-track-index="${scene.index + 1}" data-object-ids="${escapeHtml(sceneObjects.map((object) => object.id).join(","))}">
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
      <div class="lifecycle-layer">${objectHtml}</div>
    </section>`;
  }).join("\n");
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
    body { font-family: Inter, Arial, sans-serif; }
    #stage { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; background: #ece8e1; }
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
    .lifecycle-layer { position: absolute; inset: 0; pointer-events: none; }
    .lifecycle-object { position: absolute; left: 50%; top: 68%; width: 330px; min-height: 206px; aspect-ratio: 16 / 9; border-radius: 24px; padding: 0; background: #fffdf8; border: 3px solid #1a1a18; box-shadow: 16px 20px 0 rgba(26,26,24,0.16), 0 18px 52px rgba(26,26,24,0.18); font-size: 22px; font-weight: 900; overflow: hidden; display: grid; grid-template-rows: auto 1fr; isolation: isolate; contain: layout; will-change: transform, opacity, filter; transform-style: preserve-3d; }
    .lifecycle-object::before { content: ""; position: absolute; inset: 0; z-index: 0; pointer-events: none; background: linear-gradient(135deg, rgba(255,255,255,0.42), transparent 42%), radial-gradient(circle at 85% 18%, rgba(98,189,147,0.2), transparent 32%); mix-blend-mode: multiply; }
    .object-chrome { position: relative; z-index: 2; min-height: 38px; padding: 10px 14px 0; display: flex; align-items: center; gap: 8px; color: rgba(26,26,24,0.68); font-size: 10px; line-height: 1; text-transform: uppercase; }
    .object-template-badge, .object-source-badge { border: 1px solid rgba(26,26,24,0.18); border-radius: 999px; background: rgba(255,253,248,0.72); padding: 7px 9px; white-space: nowrap; }
    .object-source-badge { margin-left: auto; color: #16613f; font-weight: 900; }
    .object-state-strip { display: flex; gap: 4px; align-items: center; }
    .object-state-dot { width: 7px; height: 7px; border-radius: 50%; background: #1a1a18; opacity: 0.34; }
    .object-state-dot.state-connect, .object-state-dot.state-drift, .object-state-dot.state-pulse { background: #62bd93; opacity: 1; }
    .object-inner { position: relative; z-index: 1; min-height: 150px; display: grid; }
    .hf-object--terminal_ui .object-chrome, .hf-object--prompt_ui .object-chrome, .hf-object--brand_token .object-chrome { color: rgba(236,232,225,0.72); }
    .hf-object--terminal_ui .object-template-badge, .hf-object--terminal_ui .object-source-badge, .hf-object--prompt_ui .object-template-badge, .hf-object--prompt_ui .object-source-badge, .hf-object--brand_token .object-template-badge, .hf-object--brand_token .object-source-badge { border-color: rgba(236,232,225,0.2); background: rgba(236,232,225,0.08); color: rgba(236,232,225,0.82); }
    .hf-object--terminal_ui, .hf-object--prompt_ui { background: #121212; color: #ece8e1; }
    .hf-object--brand_token { border-radius: 999px; background: #1a1a18; color: #ece8e1; }
    .hf-object--diagram { width: 430px; background: #fffdf8; }
    .hf-object--chart { width: 390px; background: #fffdf8; }
    .hf-object--folder_stack { width: 370px; overflow: visible; background: #62bd93; }
    .hf-object--cta_card { background: #62bd93; }
    .object-role { display: block; margin-bottom: 8px; color: #f06f5f; font-size: 17px; text-transform: uppercase; }
    .object-ref { display: block; margin-top: 8px; color: rgba(26,26,24,0.6); font-size: 16px; }
    .object-terminal, .object-prompt, .object-diagram, .object-chart, .object-brand-token, .object-folder-stack, .object-proof-card, .object-cta, .object-paper-card { width: 100%; min-height: 150px; padding: 24px; }
    .terminal-top { display: flex; align-items: center; gap: 8px; margin-bottom: 18px; color: rgba(236,232,225,0.62); font-size: 14px; }
    .terminal-top span { width: 12px; height: 12px; border-radius: 50%; background: #f06f5f; }
    .terminal-top span:nth-child(2) { background: #e0b94f; }
    .terminal-top span:nth-child(3) { background: #62bd93; }
    .terminal-top em { margin-left: auto; font-style: normal; text-transform: uppercase; }
    .object-terminal code { display: block; margin-top: 8px; font-family: Consolas, monospace; color: #62bd93; font-size: 18px; }
    .object-terminal strong { display: block; margin-top: 16px; font-size: 24px; }
    .object-prompt { display: grid; grid-template-columns: 1fr 72px; gap: 14px; align-items: end; }
    .prompt-text { grid-column: 1 / -1; color: #62bd93; font-size: 22px; line-height: 1.2; }
    .prompt-chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .prompt-chips span { border: 1px solid rgba(236,232,225,0.24); border-radius: 999px; padding: 8px 10px; font-size: 13px; color: rgba(236,232,225,0.78); }
    .prompt-send { justify-self: end; width: 58px; height: 58px; border-radius: 50%; background: #ece8e1; color: #121212; display: grid; place-items: center; font-size: 13px; text-transform: uppercase; }
    .object-diagram { display: grid; grid-template-columns: 1fr 62px 1fr 62px 1fr; grid-template-rows: auto 1fr auto; align-items: center; gap: 8px; }
    .diagram-endpoint-count, .diagram-legend { grid-column: 1 / -1; color: rgba(26,26,24,0.62); font-size: 12px; text-transform: uppercase; }
    .diagram-endpoint-count { justify-self: start; border: 1px solid rgba(26,26,24,0.14); border-radius: 999px; padding: 6px 9px; background: rgba(236,232,225,0.64); }
    .diagram-legend { justify-self: end; font-size: 11px; }
    .diagram-node { min-height: 74px; border-radius: 18px; background: #1a1a18; color: #ece8e1; display: grid; place-items: center; padding: 12px; font-size: 16px; text-align: center; }
    .node-c { background: #62bd93; color: #101010; }
    .diagram-connector-line { height: 5px; background: repeating-linear-gradient(90deg, #1a1a18 0 12px, transparent 12px 20px); transform-origin: left center; }
    .object-chart strong { display: block; margin-bottom: 18px; font-size: 24px; }
    .chart-bars { height: 126px; display: flex; align-items: flex-end; gap: 14px; border-left: 3px solid #1a1a18; border-bottom: 3px solid #1a1a18; padding: 0 12px; }
    .chart-bars span { flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 6px; font-size: 10px; color: rgba(26,26,24,0.62); position: relative; }
    .chart-bar-fill { width: 100%; max-width: 44px; border-radius: 12px 12px 0 0; background: #62bd93; transform-origin: bottom; display: block; }
    .chart-value { font-size: 10px; font-weight: 900; color: #1a1a18; }
    .chart-legend { display: flex; gap: 10px; align-items: center; margin-top: 12px; color: rgba(26,26,24,0.62); font-size: 11px; text-transform: uppercase; }
    .chart-legend span { display: inline-flex; align-items: center; gap: 5px; }
    .chart-legend i { width: 9px; height: 9px; border-radius: 50%; background: #62bd93; display: inline-block; }
    .object-brand-token { display: grid; grid-template-columns: repeat(3, 62px); align-items: center; justify-content: center; gap: 10px; min-height: 150px; text-align: center; }
    .object-brand-token span { width: 62px; height: 62px; border-radius: 18px; background: #ece8e1; color: #1a1a18; display: grid; place-items: center; font-size: 18px; }
    .object-brand-token strong { grid-column: 1 / -1; font-size: 18px; }
    .object-folder-stack { min-height: 170px; position: relative; }
    .folder-tab { position: absolute; left: 24px; top: -22px; min-width: 150px; padding: 12px 18px; border-radius: 18px 18px 0 0; background: #4fae85; border: 3px solid #1a1a18; border-bottom: none; font-size: 15px; }
    .folder-file { position: absolute; left: 34px; right: 34px; min-height: 74px; border: 3px solid #1a1a18; border-radius: 18px; background: #fffdf8; padding: 18px; box-shadow: 10px 12px 0 rgba(26,26,24,0.12); }
    .file-0 { top: 24px; transform: rotate(-4deg); }
    .file-1 { top: 54px; transform: rotate(2deg); }
    .file-2 { top: 84px; transform: rotate(-1deg); }
    .object-proof-card { min-height: 178px; }
    .proof-rows { display: grid; gap: 8px; margin-top: 16px; }
    .proof-row { display: flex; align-items: center; gap: 9px; font-size: 15px; color: rgba(26,26,24,0.72); }
    .proof-row i { width: 12px; height: 12px; border-radius: 50%; background: #62bd93; display: inline-block; }
    .object-cta { min-height: 168px; display: grid; gap: 12px; align-content: center; text-align: center; }
    .object-cta strong { font-size: 32px; line-height: 1; }
    .cta-check { justify-self: center; width: 58px; height: 58px; border-radius: 50%; background: #1a1a18; color: #ece8e1; display: grid; place-items: center; font-size: 18px; }
    .object-paper-card { min-height: 150px; }
    .scene-1 .hero-card { transform: rotate(1deg); }
    .scene-2 .hero-card { transform: rotate(-0.4deg); }
    .scene-3 .hero-card { transform: rotate(1.4deg); }
    .scene-4 .hero-card { transform: rotate(-1.8deg); }
    .launchclip-sfx-audio { display: none; }
    @media (prefers-reduced-motion: reduce) {
      .lifecycle-object { filter: none !important; }
      .grid-bg { transform: none; }
    }
  </style>
</head>
<body>
  <div id="stage" data-composition-id="LaunchclipHyperframes" data-start="0" data-duration="${duration}" data-width="${width}" data-height="${height}" data-sfx-runtime="launchclip.hyperframes-audio-runtime.v1" data-sfx-manifest="sfx-manifest.json" data-sfx-cues="${resolvedSfxManifest.cues.length}" data-sfx-storyboard-cues="${resolvedSfxManifest.storyboard_cues?.length ?? 0}" data-sfx-available="${availableSfxAssets.length}" data-sfx-status="idle">
    <div id="grid-bg" class="clip grid-bg" data-start="0" data-duration="${duration}" data-track-index="0"></div>
${sceneHtml}
    ${audioAssetHtml}
  </div>
  <script type="application/json" id="launchclip-sfx-manifest">${sfxManifestJson}</script>
  <script>
    const sfxManifestElement = document.getElementById("launchclip-sfx-manifest");
    const launchclipSfxManifest = sfxManifestElement ? JSON.parse(sfxManifestElement.textContent || "{}") : { assets: [], cues: [] };
    const launchclipSfxAssets = new Map((launchclipSfxManifest.assets || []).map((asset) => [asset.id, asset]));
    const launchclipSfxCues = launchclipSfxManifest.cues || [];
    const launchclipStoryboardSfxCues = launchclipSfxManifest.storyboard_cues || [];
    const launchclipSfxAudio = new Map(Array.from(document.querySelectorAll(".launchclip-sfx-audio")).map((audio) => [audio.dataset.sfxId, audio]));
    const launchclipStage = document.getElementById("stage");
    window.__timelines = window.__timelines || {};
    const launchclipTimeline = gsap.timeline({ paused: true, defaults: { ease: "power3.out" } });
    window.__timelines["LaunchclipHyperframes"] = launchclipTimeline;
    const launchclipScheduledSfx = [];
    let launchclipPlayedSfxCount = 0;
    const reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const motionDuration = (seconds) => reducedMotion ? Math.min(0.06, Number(seconds) || 0.06) : seconds;
    if (launchclipStage) launchclipStage.dataset.motionMode = reducedMotion ? "reduced" : "full";
    function gainToVolume(gainDb) {
      const gain = Number(gainDb ?? -18) + Number(launchclipSfxManifest.mix?.master_gain_db ?? 0);
      return Math.max(0, Math.min(1, Math.pow(10, gain / 20)));
    }
    function cueAssetForCue(cue) {
      return launchclipSfxAssets.get(cue?.asset_id) || null;
    }
    function playSfxCue(cue, sourceElement) {
      const asset = cueAssetForCue(cue);
      const baseAudio = asset ? launchclipSfxAudio.get(asset.id) : null;
      if (!asset || !baseAudio) {
        if (launchclipStage) launchclipStage.dataset.sfxStatus = "missing-asset";
        if (sourceElement) sourceElement.dataset.sfxStatus = "missing-asset";
        return;
      }
      const audio = baseAudio.cloneNode(true);
      audio.dataset.runtimeClone = "true";
      audio.volume = gainToVolume(cue.gain_db ?? asset.gain_db);
      audio.currentTime = 0;
      audio.addEventListener("ended", () => audio.remove(), { once: true });
      audio.addEventListener("error", () => audio.remove(), { once: true });
      document.body.appendChild(audio);
      const playPromise = audio.play();
      if (launchclipStage) {
        launchclipStage.dataset.sfxStatus = "playing";
        launchclipStage.dataset.sfxLastCue = cue.id || asset.id;
      }
      if (sourceElement) sourceElement.dataset.sfxStatus = "playing";
      launchclipPlayedSfxCount += 1;
      if (launchclipStage) launchclipStage.dataset.sfxPlayed = String(launchclipPlayedSfxCount);
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {
          audio.remove();
          if (launchclipStage) launchclipStage.dataset.sfxStatus = "blocked";
          if (sourceElement) sourceElement.dataset.sfxStatus = "blocked";
        });
      }
    }
    function scheduleSfxCue(cue, sourceElement) {
      if (!cue) return;
      const asset = cueAssetForCue(cue);
      const delay = Math.max(0, Number(cue.at ?? 0));
      launchclipScheduledSfx.push(cue.id || cue.asset_id || "cue");
      if (launchclipStage) {
        launchclipStage.dataset.sfxStatus = "scheduled";
        launchclipStage.dataset.sfxScheduled = String(launchclipScheduledSfx.length);
      }
      if (sourceElement) {
        sourceElement.dataset.sfxAsset = asset?.id || cue.asset_id || "";
        sourceElement.dataset.sfxPath = asset?.path || "";
        sourceElement.dataset.sfxGain = String(cue.gain_db ?? asset?.gain_db ?? "");
      }
      gsap.delayedCall(delay, () => playSfxCue(cue, sourceElement));
    }
    function lifecycleSfxCueForState(state, object) {
      const objectId = object.dataset.objectId;
      const at = Number(state.at ?? 0);
      return launchclipSfxCues.find((cue) => cue.object_id === objectId && cue.state === state.state && Math.abs(Number(cue.at ?? 0) - at) < 0.05)
        || launchclipSfxCues.find((cue) => cue.object_id === objectId && cue.state === state.state)
        || null;
    }
    function scheduleLifecycleSfx(state, object) {
      if (!state.sfx) return;
      const assetId = String(state.sfx).replace(/\\.[^.]+$/, "").replace(/_/g, "-").toLowerCase();
      const cue = lifecycleSfxCueForState(state, object) || {
        id: object.dataset.objectId + "-" + String(state.state || "state") + "-runtime",
        asset_id: assetId,
        sound: state.sfx,
        object_id: object.dataset.objectId,
        scene_id: object.closest(".scene")?.dataset.trackIndex || "",
        state: state.state,
        at: Number(state.at ?? 0),
        gain_db: launchclipSfxAssets.get(assetId)?.gain_db ?? -18,
        duck_voiceover: true,
        trigger: "object_lifecycle_runtime"
      };
      scheduleSfxCue(cue, object);
    }
    function scheduleStoryboardSfx() {
      launchclipStoryboardSfxCues.forEach((cue) => scheduleSfxCue(cue, launchclipStage));
    }
    const scenes = document.querySelectorAll(".scene");
    scenes.forEach((scene, index) => {
      const card = scene.querySelector(".hero-card");
      const tokens = scene.querySelectorAll(".token");
      const connector = scene.querySelector(".connector");
      const lifecycleObjects = scene.querySelectorAll(".lifecycle-object");
      gsap.set(scene, { opacity: 0 });
      gsap.set(card, { y: 80, rotate: index % 2 ? 4 : -4, scale: 0.92 });
      gsap.set(tokens, { y: 46, opacity: 0, scale: 0.86 });
      gsap.set(connector, { scaleX: 0, transformOrigin: "left center" });
      gsap.set(lifecycleObjects, { opacity: 0, y: 58, scale: 0.86, rotate: -3, filter: "blur(6px)" });
      const start = Number(scene.dataset.start || 0);
      const tl = launchclipTimeline;
      tl.set(scene, { opacity: 1 }, start)
        .to(card, { y: 0, rotate: index % 2 ? 1 : -1.2, scale: 1, duration: motionDuration(0.72) }, start + 0.06)
        .to(tokens, { y: 0, opacity: 1, scale: 1, stagger: reducedMotion ? 0 : 0.12, duration: motionDuration(0.42) }, start + 0.42)
        .to(connector, { scaleX: 1, duration: motionDuration(0.44) }, start + 0.58)
        .to(card, { scale: 1.035, duration: motionDuration(Math.max(0.8, Number(scene.dataset.duration || 2) - 0.8)), ease: "none" }, start + 0.84)
        .to(scene, { opacity: 0, duration: motionDuration(0.1) }, start + Number(scene.dataset.duration || 2) - 0.1);
      lifecycleObjects.forEach((object, objectIndex) => {
        let states = [];
        try { states = JSON.parse(object.dataset.states || "[]"); } catch {}
        const chartBars = object.querySelectorAll(".chart-bar-fill");
        const diagramLines = object.querySelectorAll(".diagram-connector-line");
        const proofRows = object.querySelectorAll(".proof-row, .folder-file");
        gsap.set(chartBars, { scaleY: 0, transformOrigin: "bottom" });
        gsap.set(diagramLines, { scaleX: 0, transformOrigin: "left center" });
        gsap.set(proofRows, { opacity: 0, y: 12 });
        const objectTl = launchclipTimeline;
        states.forEach((state) => {
          const at = Number(state.at || start);
          const duration = motionDuration(Number(state.duration || 0.35));
          const ease = state.easing || "power3.out";
          scheduleLifecycleSfx(state, object);
          if (state.state === "enter") {
            objectTl.to(object, { opacity: 1, y: 0, scale: 1, rotate: objectIndex % 2 ? 2 : -2, filter: "blur(0px)", duration, ease }, at);
            objectTl.to(proofRows, { opacity: 1, y: 0, stagger: reducedMotion ? 0 : 0.06, duration: motionDuration(0.24) }, at + 0.08);
          }
          if (state.state === "settle") objectTl.to(object, { y: -8, scale: 1.02, duration: duration / 2, yoyo: true, repeat: 1, ease }, at);
          if (state.state === "transform") {
            const targetX = (Number(state.to?.x ?? 0.5) - 0.5) * ${width};
            const targetY = (Number(state.to?.y ?? 0.68) - 0.68) * ${height};
            objectTl.to(object, { x: targetX, y: targetY, scale: Number(state.to?.scale ?? 1), rotate: Number(state.to?.rotate ?? 0), duration, ease }, at);
            objectTl.to(chartBars, { scaleY: 1, stagger: reducedMotion ? 0 : 0.08, duration: motionDuration(0.36) }, at + 0.06);
            objectTl.to(diagramLines, { scaleX: 1, stagger: reducedMotion ? 0 : 0.12, duration: motionDuration(0.34) }, at + 0.06);
          }
          if (state.state === "connect") {
            objectTl.to(object, { scale: Number(state.to?.scale ?? 1.04), rotate: Number(state.to?.rotate ?? 0), duration: duration / 2, yoyo: true, repeat: 1, ease }, at);
            objectTl.to(diagramLines, { scaleX: 1, stagger: reducedMotion ? 0 : 0.08, duration: motionDuration(0.24) }, at + 0.02);
            objectTl.to(chartBars, { scaleY: 1, stagger: reducedMotion ? 0 : 0.06, duration: motionDuration(0.24) }, at + 0.02);
          }
          if (state.state === "drift") {
            objectTl.to(object, { x: \`+=\${Number(state.delta?.x ?? 10)}\`, y: \`+=\${Number(state.delta?.y ?? -8)}\`, rotate: \`+=\${Number(state.delta?.rotate ?? 0.6)}\`, duration: duration / 2, yoyo: true, repeat: 1, ease }, at);
          }
          if (state.state === "pulse") {
            objectTl.to(object, { scale: Number(state.to?.scale ?? 1.06), rotate: \`+=\${Number(state.to?.rotate ?? 0.6)}\`, duration: duration / 2, yoyo: true, repeat: 1, ease }, at);
          }
          if (state.state === "emphasize") {
            objectTl.to(object, { scale: 1.1, boxShadow: "0 0 54px rgba(98,189,147,0.45), 16px 20px 0 rgba(26,26,24,0.16)", duration: duration / 2, yoyo: true, repeat: 1, ease }, at);
          }
          if (state.state === "exit") objectTl.to(object, { opacity: 0, y: -54, scale: 0.94, filter: "blur(4px)", duration, ease }, at);
        });
      });
    });
    scheduleStoryboardSfx();
  </script>
</body>
</html>
`;
}

function renderHyperframesTemplateQa(video) {
  const objects = Array.isArray(video.object_lifecycle) ? video.object_lifecycle : [];
  const templates = [...new Set(objects.map((object) => object.template).filter(Boolean))].sort();
  const issues = hyperframesTemplateQaIssues(objects);
  const sfxCovered = objects.filter((object) => objectSfxList(object).length).length;
  const issueRows = issues.map((issue) => `<tr class="severity-${escapeHtml(issue.severity)}">
              <td>${escapeHtml(issue.severity.toUpperCase())}</td>
              <td>${escapeHtml(issue.category)}</td>
              <td>${escapeHtml(issue.target)}</td>
              <td>${escapeHtml(issue.issue)}</td>
              <td>${escapeHtml(issue.fix)}</td>
            </tr>`).join("");
  const templateCards = HYPERFRAMES_REQUIRED_TEMPLATE_FAMILIES.map((template) => {
    const object = sampleObjectForTemplate(template, objects);
    const states = lifecycleStateNames(object).join(" -> ") || "none";
    const sfx = objectSfxList(object).join(", ") || "none";
    const present = templates.includes(template);
    return `<article class="template-card ${present ? "is-present" : "is-missing"}" data-template="${escapeHtml(template)}">
        <div class="template-head">
          <span>${escapeHtml(templateDisplayName(template))}</span>
          <strong>${present ? "covered" : "missing"}</strong>
        </div>
        <div class="qa-object-frame">
          <div class="lifecycle-object hf-object hf-object--${escapeHtml(template)}" data-object-id="${escapeHtml(object.id)}" data-template="${escapeHtml(template)}" data-states="${escapeHtml(JSON.stringify(object.states ?? []))}">
            ${renderHyperframesObjectTemplate(object, {}, template)}
          </div>
        </div>
        <dl>
          <dt>Object</dt><dd>${escapeHtml(object.id)}</dd>
          <dt>States</dt><dd>${escapeHtml(states)}</dd>
          <dt>SFX</dt><dd>${escapeHtml(sfx)}</dd>
        </dl>
      </article>`;
  }).join("\n");
  const lifecycleRows = objects.map((object) => {
    const maxGap = lifecycleMaxStateGap(object);
    const label = object.label ?? "";
    const wordRisk = String(label).split(/\s+/).some((word) => word.length > 18);
    return `<tr>
              <td>${escapeHtml(object.id)}</td>
              <td>${escapeHtml(object.scene_id)}</td>
              <td>${escapeHtml(object.template)}</td>
              <td>${escapeHtml(lifecycleStateNames(object).join(" -> "))}</td>
              <td>${maxGap.toFixed(2)}s</td>
              <td>${escapeHtml(objectSfxList(object).join(", ") || "none")}</td>
              <td>${label.length > 34 || wordRisk ? "review" : "ok"}</td>
            </tr>`;
  }).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(video.title)} HyperFrames Template QA</title>
  <style>
    :root { color-scheme: light; --paper: #ece8e1; --surface: #fffdf8; --ink: #1a1a18; --muted: rgba(26,26,24,0.64); --line: rgba(26,26,24,0.16); --green: #62bd93; --coral: #f06f5f; --amber: #d69d35; --black: #121212; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--paper); color: var(--ink); }
    main { max-width: 1440px; margin: 0 auto; padding: 32px 28px 56px; }
    header { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 20px; align-items: end; border-bottom: 2px solid var(--line); padding-bottom: 24px; margin-bottom: 24px; }
    h1 { margin: 0; font-size: 42px; line-height: 1.02; letter-spacing: 0; }
    .sub { max-width: 780px; color: var(--muted); font-size: 15px; line-height: 1.45; margin: 10px 0 0; }
    .status { min-width: 170px; border: 2px solid var(--ink); border-radius: 8px; padding: 14px 16px; background: ${issues.length ? "var(--amber)" : "var(--green)"}; font-weight: 900; text-align: center; text-transform: uppercase; }
    .metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 26px; }
    .metric { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); padding: 16px; }
    .metric span { display: block; color: var(--muted); font-size: 12px; font-weight: 800; text-transform: uppercase; }
    .metric strong { display: block; margin-top: 8px; font-size: 32px; line-height: 1; }
    section { margin-top: 30px; }
    .section-head { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
    h2 { margin: 0; font-size: 24px; letter-spacing: 0; }
    .section-note { color: var(--muted); font-size: 13px; }
    .template-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(310px, 1fr)); gap: 14px; }
    .template-card { border: 2px solid var(--ink); border-radius: 8px; background: var(--surface); padding: 14px; display: grid; gap: 12px; min-width: 0; }
    .template-card.is-missing { border-style: dashed; }
    .template-head { display: flex; justify-content: space-between; gap: 10px; align-items: center; font-size: 13px; font-weight: 900; text-transform: uppercase; }
    .template-head strong { border-radius: 999px; padding: 6px 9px; background: var(--green); color: var(--black); font-size: 11px; }
    .is-missing .template-head strong { background: var(--amber); }
    .qa-object-frame { min-height: 220px; border: 1px solid var(--line); border-radius: 8px; background: #f7f1e8; display: grid; place-items: center; overflow: hidden; padding: 18px; }
    .qa-object-frame .lifecycle-object { position: relative; left: auto; top: auto; width: min(100%, 330px); min-height: 150px; border-radius: 20px; background: var(--surface); border: 3px solid var(--ink); box-shadow: 10px 12px 0 rgba(26,26,24,0.14); overflow: hidden; font-size: 18px; font-weight: 900; }
    .qa-object-frame .hf-object--terminal_ui, .qa-object-frame .hf-object--prompt_ui { background: var(--black); color: var(--paper); }
    .qa-object-frame .hf-object--brand_token { border-radius: 999px; background: var(--ink); color: var(--paper); }
    .qa-object-frame .hf-object--diagram { width: min(100%, 420px); }
    .qa-object-frame .hf-object--chart { width: min(100%, 380px); }
    .qa-object-frame .hf-object--folder_stack { overflow: visible; background: var(--green); }
    .qa-object-frame .hf-object--cta_card { background: var(--green); }
    .template-card dl { display: grid; grid-template-columns: 72px 1fr; gap: 6px 10px; margin: 0; color: var(--muted); font-size: 12px; line-height: 1.35; }
    .template-card dt { font-weight: 900; color: var(--ink); }
    .template-card dd { margin: 0; overflow-wrap: anywhere; }
    table { width: 100%; border-collapse: collapse; border: 1px solid var(--line); background: var(--surface); border-radius: 8px; overflow: hidden; }
    th, td { padding: 11px 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; font-size: 13px; line-height: 1.35; }
    th { background: #1a1a18; color: var(--paper); font-size: 11px; text-transform: uppercase; }
    tr:last-child td { border-bottom: none; }
    .severity-high td:first-child { color: #b23225; font-weight: 900; }
    .severity-medium td:first-child { color: #9b6b12; font-weight: 900; }
    .empty { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); padding: 18px; color: var(--muted); }
    .object-role { display: block; margin-bottom: 8px; color: var(--coral); font-size: 14px; text-transform: uppercase; }
    .object-ref { display: block; margin-top: 8px; color: var(--muted); font-size: 13px; }
    .object-terminal, .object-prompt, .object-diagram, .object-chart, .object-brand-token, .object-folder-stack, .object-proof-card, .object-cta, .object-paper-card { width: 100%; min-height: 150px; padding: 22px; }
    .terminal-top { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; color: rgba(236,232,225,0.62); font-size: 12px; }
    .terminal-top span { width: 11px; height: 11px; border-radius: 50%; background: var(--coral); }
    .terminal-top span:nth-child(2) { background: var(--amber); }
    .terminal-top span:nth-child(3) { background: var(--green); }
    .terminal-top em { margin-left: auto; font-style: normal; text-transform: uppercase; }
    .object-terminal code { display: block; margin-top: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--green); font-size: 14px; overflow-wrap: anywhere; }
    .object-terminal strong { display: block; margin-top: 14px; font-size: 20px; }
    .object-prompt { display: grid; grid-template-columns: 1fr 60px; gap: 12px; align-items: end; }
    .prompt-text { grid-column: 1 / -1; color: var(--green); font-size: 18px; line-height: 1.2; overflow-wrap: anywhere; }
    .prompt-chips { display: flex; flex-wrap: wrap; gap: 7px; }
    .prompt-chips span { border: 1px solid rgba(236,232,225,0.24); border-radius: 999px; padding: 7px 9px; font-size: 11px; color: rgba(236,232,225,0.78); }
    .prompt-send { justify-self: end; width: 50px; height: 50px; border-radius: 50%; background: var(--paper); color: var(--black); display: grid; place-items: center; font-size: 11px; text-transform: uppercase; }
    .object-diagram { display: grid; grid-template-columns: 1fr 44px 1fr 44px 1fr; grid-template-rows: auto 1fr auto; align-items: center; gap: 8px; }
    .diagram-endpoint-count, .diagram-legend { grid-column: 1 / -1; color: var(--muted); font-size: 10px; text-transform: uppercase; }
    .diagram-endpoint-count { justify-self: start; border: 1px solid var(--line); border-radius: 999px; padding: 5px 8px; background: rgba(236,232,225,0.64); }
    .diagram-legend { justify-self: end; font-size: 9px; }
    .diagram-node { min-height: 62px; border-radius: 14px; background: var(--ink); color: var(--paper); display: grid; place-items: center; padding: 10px; font-size: 12px; text-align: center; overflow-wrap: anywhere; }
    .node-c { background: var(--green); color: var(--black); }
    .diagram-connector-line { height: 5px; background: repeating-linear-gradient(90deg, var(--ink) 0 10px, transparent 10px 16px); transform-origin: left center; }
    .object-chart strong { display: block; margin-bottom: 16px; font-size: 19px; }
    .chart-bars { height: 114px; display: flex; align-items: flex-end; gap: 12px; border-left: 3px solid var(--ink); border-bottom: 3px solid var(--ink); padding: 0 10px; }
    .chart-bars span { flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 5px; font-size: 9px; color: var(--muted); overflow-wrap: anywhere; }
    .chart-bar-fill { width: 100%; max-width: 38px; border-radius: 10px 10px 0 0; background: var(--green); transform-origin: bottom; display: block; }
    .chart-value { font-size: 9px; font-weight: 900; color: var(--ink); }
    .chart-legend { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 10px; color: var(--muted); font-size: 9px; text-transform: uppercase; }
    .chart-legend span { display: inline-flex; align-items: center; gap: 5px; }
    .chart-legend i { width: 8px; height: 8px; border-radius: 50%; background: var(--green); display: inline-block; }
    .object-brand-token { display: grid; grid-template-columns: repeat(3, 56px); align-items: center; justify-content: center; gap: 9px; min-height: 150px; text-align: center; }
    .object-brand-token span { width: 56px; height: 56px; border-radius: 16px; background: var(--paper); color: var(--ink); display: grid; place-items: center; font-size: 16px; }
    .object-brand-token strong { grid-column: 1 / -1; font-size: 16px; }
    .object-folder-stack { min-height: 170px; position: relative; }
    .folder-tab { position: absolute; left: 24px; top: -22px; min-width: 130px; padding: 10px 16px; border-radius: 16px 16px 0 0; background: #4fae85; border: 3px solid var(--ink); border-bottom: none; font-size: 13px; }
    .folder-file { position: absolute; left: 30px; right: 30px; min-height: 64px; border: 3px solid var(--ink); border-radius: 16px; background: var(--surface); padding: 16px; box-shadow: 8px 10px 0 rgba(26,26,24,0.12); overflow-wrap: anywhere; }
    .file-0 { top: 24px; transform: rotate(-4deg); }
    .file-1 { top: 54px; transform: rotate(2deg); }
    .file-2 { top: 84px; transform: rotate(-1deg); }
    .object-proof-card { min-height: 178px; }
    .proof-rows { display: grid; gap: 8px; margin-top: 16px; }
    .proof-row { display: flex; align-items: center; gap: 9px; font-size: 13px; color: var(--muted); }
    .proof-row i { width: 11px; height: 11px; border-radius: 50%; background: var(--green); display: inline-block; flex: 0 0 auto; }
    .object-cta { min-height: 168px; display: grid; gap: 12px; align-content: center; text-align: center; }
    .object-cta strong { font-size: 28px; line-height: 1; }
    .cta-check { justify-self: center; width: 54px; height: 54px; border-radius: 50%; background: var(--ink); color: var(--paper); display: grid; place-items: center; font-size: 16px; }
    .object-paper-card { min-height: 150px; }
    @media (max-width: 760px) {
      main { padding: 22px 16px 40px; }
      header { grid-template-columns: 1fr; }
      h1 { font-size: 32px; }
      .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      table { display: block; overflow-x: auto; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>HyperFrames Template QA</h1>
        <p class="sub">${escapeHtml(video.title)}. Review this before preview/render to catch reusable object coverage, Static hold checks, SFX hook coverage, and text-fit risks across the object library.</p>
      </div>
      <div class="status">${issues.length ? "needs review" : "pass"}</div>
    </header>
    <section class="metrics" aria-label="Template coverage summary">
      <div class="metric"><span>Objects</span><strong>${objects.length}</strong></div>
      <div class="metric"><span>Template coverage</span><strong>${templates.length}/${HYPERFRAMES_REQUIRED_TEMPLATE_FAMILIES.length}</strong></div>
      <div class="metric"><span>SFX covered</span><strong>${sfxCovered}/${objects.length}</strong></div>
      <div class="metric"><span>QA flags</span><strong>${issues.length}</strong></div>
    </section>
    <section>
      <div class="section-head">
        <h2>Reusable Object Snapshots</h2>
        <span class="section-note">One representative snapshot per required template family.</span>
      </div>
      <div class="template-grid">${templateCards}</div>
    </section>
    <section>
      <div class="section-head">
        <h2>QA Flags</h2>
        <span class="section-note">Advisory checks for render review; they do not block packet validation.</span>
      </div>
      ${issueRows ? `<table>
        <thead><tr><th>Severity</th><th>Category</th><th>Target</th><th>Issue</th><th>Suggested fix</th></tr></thead>
        <tbody>${issueRows}</tbody>
      </table>` : `<div class="empty">No template coverage, lifecycle, SFX, or text-fit flags found.</div>`}
    </section>
    <section>
      <div class="section-head">
        <h2>Lifecycle Audit</h2>
        <span class="section-note">State order, Static hold gap, and object-level SFX inventory.</span>
      </div>
      <table>
        <thead><tr><th>Object</th><th>Scene</th><th>Template</th><th>States</th><th>Max gap</th><th>SFX</th><th>Text fit</th></tr></thead>
        <tbody>${lifecycleRows || `<tr><td colspan="7">No lifecycle objects generated.</td></tr>`}</tbody>
      </table>
    </section>
  </main>
</body>
</html>
`;
}

function hyperframesTemplateQaIssues(objects) {
  const issues = [];
  const templates = new Set(objects.map((object) => object.template).filter(Boolean));
  for (const template of HYPERFRAMES_REQUIRED_TEMPLATE_FAMILIES) {
    if (!templates.has(template)) {
      issues.push({
        severity: "high",
        category: "Template coverage",
        target: template,
        issue: `Missing ${templateDisplayName(template)} object family.`,
        fix: "Add at least one storyboard object that exercises this reusable template."
      });
    }
  }
  for (const object of objects) {
    const id = object.id ?? "unknown-object";
    const states = lifecycleStateNames(object);
    const allowed = new Set(["enter", "settle", "transform", "connect", "drift", "pulse", "emphasize", "exit"]);
    if (!object.template) {
      issues.push({ severity: "high", category: "Template coverage", target: id, issue: "Object has no reusable template family.", fix: "Assign a known template to the lifecycle object." });
    }
    if (!lifecycleCoreStateOrderValid(states) || states.some((state) => !allowed.has(state))) {
      issues.push({ severity: "high", category: "Transition states", target: id, issue: `State order is ${states.join(" -> ") || "empty"}.`, fix: "Use enter -> settle -> transform -> optional connect/drift/pulse -> emphasize -> exit." });
    }
    const maxGap = lifecycleMaxStateGap(object);
    if (maxGap > HYPERFRAMES_STATIC_HOLD_THRESHOLD_SECONDS) {
      issues.push({ severity: "medium", category: "Static hold", target: id, issue: `${maxGap.toFixed(2)}s gap between lifecycle state events.`, fix: "Add a connect, drift, pulse, or secondary object transition during the hold." });
    }
    if (!objectSfxList(object).length) {
      issues.push({ severity: "medium", category: "SFX hook", target: id, issue: "Object has no SFX hook on lifecycle states.", fix: "Attach subtle SFX to enter or emphasize states." });
    }
    const label = String(object.label ?? "");
    if (label.length > 34) {
      issues.push({ severity: "medium", category: "Text fit", target: id, issue: `Label is ${label.length} characters.`, fix: "Shorten the label or split it across smaller template fields." });
    }
    const longWord = label.split(/\s+/).find((word) => word.length > 18);
    if (longWord) {
      issues.push({ severity: "medium", category: "Text fit", target: id, issue: `Long word may overflow: ${longWord}.`, fix: "Use a shorter label token or add a deliberate line break in the renderer." });
    }
  }
  return issues;
}

function sampleObjectForTemplate(template, objects) {
  const existing = objects.find((object) => object.template === template);
  if (existing) return existing;
  return {
    id: `qa-${template}`,
    scene_id: "template-qa",
    role: templateRole(template),
    ref: `${template}_sample`,
    template,
    label: templateDisplayName(template),
    template_data: {
      aliases: ["source", "proof", "review"],
      media_slots: ["input", "chart", "handoff", "approval"],
      sfx: ["paper_hit.wav", "soft_thump.wav"],
      evidence: "qa sample"
    },
    states: [
      { state: "enter", at: 0.1, duration: 0.28, easing: "easeOutCubic", sfx: "paper_hit.wav" },
      { state: "settle", at: 0.48, duration: 0.24, easing: "easeOutQuad" },
      { state: "transform", at: 0.86, duration: 0.48, easing: "easeInOutCubic", to: { x: 0.5, y: 0.58, scale: 1.04, rotate: 0 } },
      { state: "connect", at: 1.44, duration: 0.24, easing: "power2.out", sfx: "connector_pop.wav", to: { scale: 1.04, rotate: 0.8 } },
      { state: "drift", at: 1.86, duration: 0.28, easing: "sine.inOut", delta: { x: 10, y: -8, rotate: 0.4 } },
      { state: "pulse", at: 2.28, duration: 0.24, easing: "power2.out", sfx: "soft_thump.wav", to: { scale: 1.06, rotate: 0.4 } },
      { state: "emphasize", at: 2.72, duration: 0.3, easing: "easeOutBack", sfx: "soft_thump.wav" },
      { state: "exit", at: 3.28, duration: 0.28, easing: "easeInCubic" }
    ]
  };
}

function templateRole(template) {
  if (template === "diagram") return "diagram";
  if (template === "chart") return "chart";
  if (template === "brand_token") return "brand-token";
  if (template === "terminal_ui" || template === "prompt_ui") return "proof-ui";
  if (template === "cta_card") return "cta";
  return "proof-card";
}

function templateDisplayName(template) {
  return String(template ?? "template")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function lifecycleStateNames(object) {
  return (Array.isArray(object?.states) ? object.states : []).map((state) => state.state).filter(Boolean);
}

function lifecycleCoreStateOrderValid(states) {
  const coreStates = ["enter", "settle", "transform", "emphasize", "exit"];
  let cursor = -1;
  for (const coreState of coreStates) {
    const nextIndex = states.findIndex((state, index) => index > cursor && state === coreState);
    if (nextIndex === -1) return false;
    cursor = nextIndex;
  }
  return true;
}

function objectSfxList(object) {
  return [...new Set((Array.isArray(object?.states) ? object.states : []).map((state) => state.sfx).filter(Boolean))];
}

function lifecycleMaxStateGap(object) {
  const timedStates = (Array.isArray(object?.states) ? object.states : [])
    .map((state) => ({ at: Number(state.at), duration: Number(state.duration ?? 0) }))
    .filter((state) => Number.isFinite(state.at))
    .sort((a, b) => a.at - b.at);
  let maxGap = 0;
  for (let index = 1; index < timedStates.length; index += 1) {
    const previousEnd = timedStates[index - 1].at + Math.max(0, timedStates[index - 1].duration);
    maxGap = Math.max(maxGap, timedStates[index].at - previousEnd);
  }
  return round(maxGap);
}

function cleanVoiceoverLine(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .trim();
}

function deliveryForBeat(beat) {
  if (isDataStoryBeat(beat)) return "fast but articulate data-story narration; let charts and counters breathe on transition hits";
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

function isDataStoryBeat(beat) {
  return [
    "data-hook",
    "question-card",
    "dataset-setup",
    "scenario-grid",
    "friction-bars",
    "proof-bars",
    "trust-map",
    "safeguard-map",
    "split-counter-left",
    "split-counter-right",
    "workflow-demo",
    "workflow-storyboard",
    "workflow-hyperframes",
    "sfx-pass",
    "asset-readiness",
    "placeholder-gaps",
    "qa-static-holds",
    "qa-source-honesty",
    "packet-review",
    "benchmark-cta"
  ].includes(beat);
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
  if (!hyperframes.template_qa_preview?.endsWith("template-qa.html")) {
    issues.push("HyperFrames handoff must point at a template-qa.html preview.");
  }
  if (!hyperframes.sfx_manifest?.endsWith("sfx-manifest.json")) {
    issues.push("HyperFrames handoff must point at an sfx-manifest.json file.");
  }
  if (!hyperframes.asset_readiness?.endsWith("asset-readiness.html")) {
    issues.push("HyperFrames handoff must point at an asset-readiness.html report.");
  }
  if (!hyperframes.chart_diagram_qa?.endsWith("chart-diagram-qa.html")) {
    issues.push("HyperFrames handoff must point at a chart-diagram-qa.html report.");
  }
  if (!hyperframes.quality_checklist?.endsWith("QUALITY.md")) {
    issues.push("HyperFrames handoff must point at a QUALITY.md checklist.");
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
    "data-hook": {
      editDensity: "headline, masthead, texture drift, and chart-card flash every 0.6-1.0s",
      cameraDirection: "slow push through a dark atlas background into a center headline",
      sound: "sub-bass whoosh into data headline hit",
      soundTrigger: "first-frame headline slam and masthead lock",
      intensity: "high",
      mixLevel: -15
    },
    "question-card": {
      editDensity: "question fragments, underline strokes, and micro-stat ticks every 0.7-1.1s",
      cameraDirection: "centered chart-card push with tiny parallax on background map texture",
      sound: "soft tick build under a question-card rise",
      soundTrigger: "question words and tiny counter marks entering",
      intensity: "medium-high",
      mixLevel: -18
    },
    "dataset-setup": {
      editDensity: "fixture rows, source chips, and status badges enter every 0.6-1.0s",
      cameraDirection: "table-card push with row highlights sweeping top to bottom",
      sound: "data ticks and receipt pops",
      soundTrigger: "fixture row highlights and source badge landing",
      intensity: "medium",
      mixLevel: -19
    },
    "scenario-grid": {
      editDensity: "matrix tiles pulse, recolor, or regroup every 0.5-0.9s",
      cameraDirection: "map-like matrix drift with quick zooms into active tile clusters",
      sound: "grid ticks and light map taps",
      soundTrigger: "tile cluster pulses and matrix regroup",
      intensity: "medium-high",
      mixLevel: -18
    },
    "friction-bars": {
      editDensity: "bar fills, rank swaps, and label punches every 0.5-0.9s",
      cameraDirection: "horizontal bar-chart push with rank-change overshoot",
      sound: "bar-rise ticks with a soft rank hit",
      soundTrigger: "bar fills and rank labels settling",
      intensity: "medium-high",
      mixLevel: -18
    },
    "proof-bars": {
      editDensity: "receipt bars, source chips, and pass badges animate every 0.6-1.0s",
      cameraDirection: "bar chart pulls back to reveal receipt labels and evidence chips",
      sound: "success ticks and proof-card pops",
      soundTrigger: "receipt chips landing on each proof bar",
      intensity: "medium",
      mixLevel: -19
    },
    "trust-map": {
      editDensity: "risk cells pulse red, labels snap, and source warnings flicker every 0.6-1.1s",
      cameraDirection: "map heat zoom from national view into clustered risk cells",
      sound: "warning taps with a low map sweep",
      soundTrigger: "red risk cells and warning labels appearing",
      intensity: "medium-high",
      mixLevel: -18
    },
    "safeguard-map": {
      editDensity: "green safeguards sweep across cells and pin receipts every 0.6-1.1s",
      cameraDirection: "reverse heat-map pullback from receipts to full safeguard grid",
      sound: "soft success dings and map ticks",
      soundTrigger: "green safeguard pins and receipt chips landing",
      intensity: "medium",
      mixLevel: -19
    },
    "split-counter-left": {
      editDensity: "counter increments, red chips, and vertical divider pulses every 0.5-0.9s",
      cameraDirection: "left counter punch-in with the right side held as muted context",
      sound: "counter ticks with a restrained warning hit",
      soundTrigger: "each never-fake item incrementing",
      intensity: "medium-high",
      mixLevel: -18
    },
    "split-counter-right": {
      editDensity: "counter increments, green chips, and safe-generation labels tick every 0.5-0.9s",
      cameraDirection: "right counter punch-in and settle back to the full split",
      sound: "counter ticks into soft confirmation hit",
      soundTrigger: "each safe-generation item incrementing",
      intensity: "medium",
      mixLevel: -19
    },
    "workflow-demo": {
      editDensity: "pipeline node, connector, and receipt event every 0.6-1.0s",
      cameraDirection: "connector-line follow from demo command to captured receipt",
      sound: "typing ticks, connector pop, and receipt ding",
      soundTrigger: "demo node, connector draw, and receipt lock",
      intensity: "medium-high",
      mixLevel: -18
    },
    "workflow-storyboard": {
      editDensity: "script node, visual node, caption node, and playhead marker every 0.6-1.0s",
      cameraDirection: "diagram push across script-to-visual connectors",
      sound: "connector pops and playhead ticks",
      soundTrigger: "script and storyboard nodes linking",
      intensity: "medium",
      mixLevel: -19
    },
    "workflow-hyperframes": {
      editDensity: "object lifecycle states and template cards swap every 0.5-0.9s",
      cameraDirection: "pipeline zoom into object lifecycle state strip",
      sound: "template snaps and lifecycle pops",
      soundTrigger: "template cards and lifecycle states locking",
      intensity: "medium-high",
      mixLevel: -18
    },
    "sfx-pass": {
      editDensity: "audio lane ticks, waveform blips, and ducking labels every 0.5-0.9s",
      cameraDirection: "timeline sweep across SFX lanes under the voice track",
      sound: "whoosh, tick, paper hit, and ducked confirmation blend",
      soundTrigger: "each SFX family lane entering",
      intensity: "medium",
      mixLevel: -20
    },
    "asset-readiness": {
      editDensity: "asset rows, missing tags, and replacement slots animate every 0.6-1.0s",
      cameraDirection: "readiness table push with row-by-row status reveal",
      sound: "asset row ticks and soft warning taps",
      soundTrigger: "missing asset tags and ready rows entering",
      intensity: "medium",
      mixLevel: -19
    },
    "placeholder-gaps": {
      editDensity: "placeholder cards flip, gap tags pulse, and replacement arrows draw every 0.6-1.0s",
      cameraDirection: "zoom from labelled placeholder to the exact replacement slot",
      sound: "paper flip, warning tap, and connector pop",
      soundTrigger: "placeholder label and replacement arrow",
      intensity: "medium-high",
      mixLevel: -18
    },
    "qa-static-holds": {
      editDensity: "timer bars, red hold markers, and pass ticks every 0.5-0.9s",
      cameraDirection: "timer-bar sweep with hard zooms on over-threshold holds",
      sound: "timer ticks and pass/fail taps",
      soundTrigger: "static hold markers crossing the threshold",
      intensity: "medium-high",
      mixLevel: -18
    },
    "qa-source-honesty": {
      editDensity: "source chips, connector endpoints, and chart marks validate every 0.6-1.0s",
      cameraDirection: "source-to-mark connector follow with crisp endpoint settles",
      sound: "connector pops and review ticks",
      soundTrigger: "source chips linking to chart marks",
      intensity: "medium",
      mixLevel: -19
    },
    "packet-review": {
      editDensity: "file stack, QA page, manifest, and review payload flash every 0.6-1.0s",
      cameraDirection: "artifact grid zooms into one review packet stack",
      sound: "file flips and final packet thump",
      soundTrigger: "review artifacts stacking",
      intensity: "high",
      mixLevel: -16
    },
    "benchmark-cta": {
      editDensity: "final counter, checklist ticks, and calm hold with subtle map drift",
      cameraDirection: "clean final push to packet lockup and benchmark duration",
      sound: "two checklist ticks into quiet final hit",
      soundTrigger: "final line-up checks and benchmark lockup",
      intensity: "low-medium",
      mixLevel: -21
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
  const aliases = {
    "public-record-hook": "data-hook",
    "hopes-chart": "friction-bars",
    "fears-chart": "trust-map",
    "state-grid": "scenario-grid",
    "twist-chart": "friction-bars",
    "ask-map": "safeguard-map",
    "trust-answer": "split-counter-left",
    "verdict-cta": "benchmark-cta"
  };
  return directions[beat] ?? directions[aliases[beat]] ?? directions.cta;
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

function isDataStoryBenchmarkStyle(style) {
  return style === DATA_STORY_BENCHMARK_STYLE;
}

function isSocialReadyStyle(style) {
  return style === "ugc-split" || style === "ugc-demo-punchy" || isPremiumStyle(style) || isDataStoryBenchmarkStyle(style);
}

function defaultRendererDuration(video = {}, provider = "remotion") {
  if (isPremiumStyle(video.style)) return video.duration_seconds ?? 48;
  if (isDataStoryBenchmarkStyle(video.style)) return video.duration_seconds ?? 150;
  if (isSocialReadyStyle(video.style)) return Math.min(video.duration_seconds ?? 30, 30);
  const cap = provider === "remotion" ? 30 : 15;
  return Math.min(video.duration_seconds ?? cap, cap);
}

function buildCreativeStoryboard(style, manifest, script, stylePreset, talkingHead = { enabled: false, provider: "none" }) {
  if (isPremiumStyle(style)) {
    return buildPremiumCreativeStoryboard(manifest, script, stylePreset, talkingHead);
  }
  if (isDataStoryBenchmarkStyle(style)) {
    return buildDataStoryBenchmarkStoryboard(manifest, script, stylePreset);
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

function buildDataStoryBenchmarkStoryboard(manifest, script, stylePreset) {
  const repoName = stripMarkdown(manifest.source_repo.name);
  const timeline = script.timeline ?? [];
  return {
    schema_version: "launchclip.storyboard.v1",
    intent: `${repoName} should stress Launchclip with an original 150-second vertical data story: dark atlas styling, chart cards, map grids, split counters, workflow diagrams, SFX lanes, and review artifacts.`,
    creative_positioning: stylePreset.angle,
    renderer_priority: ["hyperframes", "remotion", "product-videogen", "local-ffmpeg"],
    non_goals: [
      "Do not download or reuse the reference transcript, audio, footage, frames, graphics, creator likeness, chart values, or exact sequence.",
      "Do not present synthetic benchmark fixtures as public survey data.",
      "Do not invent adoption, revenue, safety, or performance claims.",
      "Do not make a static slideshow; every scene needs chart, map, counter, connector, caption, camera, or SFX movement."
    ],
    quality_gates: [
      "full duration is 150 seconds at vertical 9:16",
      "voiceover lands around 350-430 original words",
      "every 0.5-1.2 seconds changes chart, map, counter, object, camera, caption, or SFX focus",
      "charts and diagrams declare source status as synthetic benchmark fixtures or launchclip artifacts",
      "no static object lifecycle gap exceeds 1.2 seconds",
      "SFX cues are adapter-ready and duck under voiceover",
      "missing assets remain labelled placeholders instead of unrelated stock media",
      "final output is a reviewable packet, not a live publish action"
    ],
    presenter_direction: "No talking-head by default. Use voiceover plus data graphics so charts, maps, counters, and QA artifacts carry the edit.",
    scenes: timeline.map((segment, index) => {
      const profile = dataStorySceneProfile(segment.beat);
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
        sfx_cues: profile.sfxCues,
        data_visualization: profile.dataVisualization,
        success_criteria: [
          "viewer can identify the chart or diagram purpose while muted",
          "source status is visible for every data mark or connector",
          "foreground motion, map texture, caption, or SFX cue changes before the scene feels static"
        ]
      };
    })
  };
}

function dataStorySceneProfile(beat) {
  const common = {
    typography: "condensed uppercase masthead, oversized mixed-case hook text, compact chart labels, source chips, and no paragraph subtitle blocks",
    colorGrade: "dark atlas texture, off-white chart cards, coral risk marks, mint safeguard marks, cyan connector accents, and restrained amber warnings",
    cameraPath: [
      { t: 0, scale: 1.04, x: -10, y: 12, rotate: -0.4 },
      { t: 0.52, scale: 1.0, x: 0, y: 0, rotate: 0 },
      { t: 1, scale: 1.05, x: 8, y: -14, rotate: 0.3 }
    ],
    sfxCues: ["data-tick", "soft-whoosh", "caption-hit"]
  };
  const chartData = {
    type: "chart",
    source_status: "synthetic benchmark fixture",
    honesty_note: "Illustrative QA data for renderer stress, not public survey data."
  };
  const artifactData = {
    type: "artifact-diagram",
    source_status: "launchclip generated artifact",
    honesty_note: "Connectors point to packet files generated by launchclip."
  };
  const profiles = {
    "data-hook": {
      layout: "dark atlas first frame with persistent masthead and huge data-story title",
      composition: "ANTICOPY benchmark masthead, large center title, subtle map texture, and a small 150s duration timer",
      mediaSlots: ["title", "masthead", "duration-timer", "atlas-texture"],
      motionGrammar: ["title slam", "map texture drift", "timer tick", "card flash"],
      assetAliases: [],
      microEvents: ["masthead locks on frame one", "title slams in", "duration timer ticks to 2:30", "first data card flashes"],
      dataVisualization: { ...chartData, type: "stat-counter" }
    },
    "question-card": {
      layout: "centered question chart card over dark map texture",
      composition: "one big question, three tiny counters, and a source-status chip that says original benchmark",
      mediaSlots: ["attention", "evidence", "timing", "source-chip"],
      motionGrammar: ["question underline draw", "counter ticks", "source chip pop"],
      assetAliases: [],
      microEvents: ["question splits into three fragments", "counters tick up", "source chip lands", "map pins drift behind card"],
      dataVisualization: { ...chartData, type: "stat-counter" }
    },
    "dataset-setup": {
      layout: "fixture table chart card",
      composition: "rows for synthetic scenarios, fixture status, and source labels with a clear non-survey disclaimer",
      mediaSlots: ["synthetic scenarios", "fixture status", "source labels", "non-survey disclaimer"],
      motionGrammar: ["row sweep", "source badge pop", "table-card push"],
      assetAliases: [],
      microEvents: ["first rows sweep in", "fixture badge turns mint", "non-survey label pulses", "table shifts into grid"],
      dataVisualization: { ...chartData, type: "table-chart" }
    },
    "scenario-grid": {
      layout: "map-like matrix chart with fifty fixture tiles",
      composition: "tile grid groups failure modes by color while avoiding real geography or survey claims",
      mediaSlots: ["missing proof", "vague captions", "slow transitions", "weak sound", "tiny labels"],
      motionGrammar: ["matrix tile pulse", "cluster regroup", "map-like zoom"],
      assetAliases: [],
      microEvents: ["tiles fill in waves", "failure clusters regroup", "active cluster zooms", "legend snaps in"],
      dataVisualization: { ...chartData, type: "matrix-map" }
    },
    "friction-bars": {
      layout: "horizontal bar chart with ranked launch friction",
      composition: "manual scripting, proof capture, edit alignment, caption review, and asset replacement rank as synthetic QA pressures",
      mediaSlots: ["scripting", "proof capture", "edit alignment", "caption review", "asset replacement"],
      motionGrammar: ["bar fill", "rank swap", "label punch", "axis tick"],
      assetAliases: [],
      microEvents: ["bars fill left to right", "edit alignment jumps rank", "axis ticks draw", "top label punches forward"],
      dataVisualization: { ...chartData, type: "horizontal-bar" }
    },
    "proof-bars": {
      layout: "receipt-backed proof bar chart",
      composition: "bars switch from pressure to receipt coverage across terminal, render plan, storyboard, captions, and review payload",
      mediaSlots: ["terminal output", "render plan", "storyboard", "captions", "review payload"],
      motionGrammar: ["bar refill", "receipt chip land", "source badge sweep"],
      assetAliases: [],
      microEvents: ["red bars drain", "green receipt bars fill", "source chips attach", "proof label settles"],
      dataVisualization: { ...chartData, type: "receipt-bar" }
    },
    "trust-map": {
      layout: "risk heat-map chart",
      composition: "red cells mark places a viewer might distrust the output: unsupported numbers, unclear sources, copied media, or overconfident automation",
      mediaSlots: ["unsupported numbers", "unclear sources", "copied media", "overconfident automation"],
      motionGrammar: ["heat pulse", "warning label snap", "risk zoom"],
      assetAliases: [],
      microEvents: ["red cells pulse", "risk labels snap", "heat map zooms inward", "warning source chip appears"],
      dataVisualization: { ...chartData, type: "risk-heat-map" }
    },
    "safeguard-map": {
      layout: "safeguard heat-map chart",
      composition: "green pins mark dry runs, local assets, validation, review gates, and human approval boundaries",
      mediaSlots: ["dry runs", "local assets", "validation", "review gates", "human approval"],
      motionGrammar: ["green sweep", "receipt pin", "map pullback"],
      assetAliases: [],
      microEvents: ["green cells sweep across grid", "receipt pins land", "approval boundary glows", "map pulls back"],
      dataVisualization: { ...chartData, type: "safeguard-heat-map" }
    },
    "split-counter-left": {
      layout: "left side of split counter chart",
      composition: "red counter stacks items launchclip must never fake",
      mediaSlots: ["likenesses", "verbatim transcript", "survey data", "production claims", "platform posting"],
      motionGrammar: ["counter increment", "chip stack", "divider pulse"],
      assetAliases: [],
      microEvents: ["left counter hits five", "red chips stack", "divider pulses", "never fake label locks"],
      dataVisualization: { ...chartData, type: "split-counter" }
    },
    "split-counter-right": {
      layout: "right side of split counter chart",
      composition: "green counter stacks original things launchclip can safely generate",
      mediaSlots: ["original narration", "synthetic fixtures", "chart layouts", "sound cues", "QA artifacts"],
      motionGrammar: ["counter increment", "safe chip stack", "split settle"],
      assetAliases: [],
      microEvents: ["right counter hits five", "green chips stack", "safe generation label locks", "split view settles"],
      dataVisualization: { ...chartData, type: "split-counter" }
    },
    "workflow-demo": {
      layout: "pipeline connector diagram from demo command to receipt",
      composition: "demo node connects to terminal output, receipt, and redaction badge",
      mediaSlots: ["demo command", "terminal output", "redaction badge"],
      motionGrammar: ["node enter", "connector draw", "receipt pop"],
      assetAliases: ["demo-command", "terminal-output", "redaction-badge"],
      microEvents: ["demo node enters", "connector draws to terminal", "redaction badge lands", "receipt turns mint"],
      dataVisualization: { ...artifactData, type: "workflow-diagram" }
    },
    "workflow-storyboard": {
      layout: "script-to-visual connector diagram",
      composition: "script nodes link to captions, visual cards, camera moves, and source labels",
      mediaSlots: ["script node", "caption node", "visual card", "camera move"],
      motionGrammar: ["connector follow", "node pulse", "playhead sweep"],
      assetAliases: ["script-plan", "caption-node", "chart-card", "camera-move"],
      microEvents: ["script node pulses", "connector draws to visual card", "caption chip lands", "playhead sweeps"],
      dataVisualization: { ...artifactData, type: "alignment-diagram" }
    },
    "workflow-hyperframes": {
      layout: "HyperFrames object lifecycle pipeline diagram",
      composition: "scene nodes connect to templates, object states, data QA, diagram QA, and quality checklist",
      mediaSlots: ["scene nodes", "templates", "object states", "data QA", "quality checklist"],
      motionGrammar: ["pipeline follow", "template snap", "state strip sweep"],
      assetAliases: ["scene-node", "template-card", "object-state", "chart-qa", "quality-checklist"],
      microEvents: ["template cards snap in", "object state strip scrolls", "QA card flashes", "checklist node locks"],
      dataVisualization: { ...artifactData, type: "pipeline-diagram" }
    },
    "sfx-pass": {
      layout: "audio lane chart under voiceover",
      composition: "whoosh, tick, paper hit, pop, and quiet final hit lanes appear below a ducking curve",
      mediaSlots: ["whoosh", "tick", "paper hit", "connector pop", "ducking line"],
      motionGrammar: ["waveform blip", "lane tick", "ducking curve"],
      assetAliases: [],
      microEvents: ["voice lane appears", "SFX lanes tick in", "ducking curve bends", "mix label settles"],
      dataVisualization: { ...chartData, type: "audio-lane-chart" }
    },
    "asset-readiness": {
      layout: "asset readiness table chart",
      composition: "logos, screenshots, voice, and SFX rows declare available, missing, or placeholder status",
      mediaSlots: ["logos", "screenshots", "voice", "SFX", "placeholder status"],
      motionGrammar: ["row reveal", "status pill pop", "replacement slot draw"],
      assetAliases: [],
      microEvents: ["rows reveal", "missing tags pulse", "available tags settle", "replacement slots draw"],
      dataVisualization: { ...chartData, type: "readiness-table" }
    },
    "placeholder-gaps": {
      layout: "gap replacement chart",
      composition: "labelled placeholder cards point to exact replacement slots so review can continue without hiding missing assets",
      mediaSlots: ["placeholder logo", "placeholder voice", "placeholder screenshot", "replacement slot"],
      motionGrammar: ["card flip", "gap tag pulse", "arrow draw"],
      assetAliases: [],
      microEvents: ["placeholder card flips", "gap label pulses", "replacement arrow draws", "reviewable tag lands"],
      dataVisualization: { ...chartData, type: "gap-chart" }
    },
    "qa-static-holds": {
      layout: "static-hold timer chart",
      composition: "timer bars show object lifecycle gaps and highlight the one point two second threshold",
      mediaSlots: ["enter", "settle", "transform", "micro-state", "exit"],
      motionGrammar: ["timer sweep", "threshold marker", "pass tick"],
      assetAliases: [],
      microEvents: ["timer bars sweep", "threshold marker flashes", "micro-state inserts", "pass tick lands"],
      dataVisualization: { ...chartData, type: "timer-bar-chart" }
    },
    "qa-source-honesty": {
      layout: "source-to-mark connector diagram",
      composition: "source chips connect to data marks, diagram endpoints, captions, and review notes",
      mediaSlots: ["source chip", "data mark", "diagram endpoint", "review note"],
      motionGrammar: ["connector draw", "endpoint settle", "source chip pulse"],
      assetAliases: ["source-chip", "chart-mark", "diagram-endpoint", "review-note"],
      microEvents: ["source chip pulses", "connector draws to mark", "endpoint settles", "review note ticks"],
      dataVisualization: { ...artifactData, type: "source-honesty-diagram" }
    },
    "packet-review": {
      layout: "review packet artifact grid chart",
      composition: "transcript plan, storyboard, render handoff, captions, SFX manifest, and QA pages converge into one packet",
      mediaSlots: ["transcript plan", "storyboard", "render handoff", "captions", "SFX manifest", "QA pages"],
      motionGrammar: ["file flash", "grid zoom", "stack thump"],
      assetAliases: [],
      microEvents: ["files flash in sequence", "QA pages slide under stack", "SFX manifest flips", "packet thumps"],
      dataVisualization: { ...chartData, type: "artifact-grid" }
    },
    "benchmark-cta": {
      layout: "final benchmark lockup with 2:30 duration and review checklist",
      composition: "packet stack, duration timer, no-copy boundary, and review-ready checkmarks settle into final hold",
      mediaSlots: ["packet stack", "2:30 timer", "no-copy boundary", "review-ready checks"],
      motionGrammar: ["final push", "check ticks", "quiet hold"],
      assetAliases: [],
      microEvents: ["duration timer locks", "review checks tick", "no-copy boundary appears", "final map drift continues"],
      dataVisualization: { ...artifactData, type: "cta-lockup" }
    }
  };
  const aliases = {
    "public-record-hook": "data-hook",
    "hopes-chart": "friction-bars",
    "fears-chart": "friction-bars",
    "state-grid": "scenario-grid",
    "twist-chart": "friction-bars",
    "ask-map": "safeguard-map",
    "trust-answer": "split-counter-left",
    "verdict-cta": "benchmark-cta"
  };
  return { ...common, ...(profiles[beat] ?? profiles[aliases[beat]] ?? profiles["question-card"]) };
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

function dataStoryBenchmarkStructure() {
  return [
    { beat: "public-record-hook", seconds: 18, instruction: "Open with a dark atlas editorial hook, persistent masthead, rec/time UI, big challenge headline, and topic chips." },
    { beat: "hopes-chart", seconds: 21, instruction: "Use a centered off-white horizontal bar chart for what a launch clip must deliver, with lower-third stat chips." },
    { beat: "fears-chart", seconds: 19, instruction: "Flip to a second horizontal bar chart for the retention fears that make generated output feel weak." },
    { beat: "state-grid", seconds: 20, instruction: "Show fifty synthetic launch scenarios as an orange map-like tile grid and hold the persistent shell." },
    { beat: "twist-chart", seconds: 20, instruction: "Reveal the twist: polish without motion makes viewers more critical, using a blue ranked bar chart." },
    { beat: "ask-map", seconds: 22, instruction: "Use a blue map grid to ask whether renderer guardrails can step in before retention drops." },
    { beat: "trust-answer", seconds: 19, instruction: "Show the answer as two comparison cards: automation alone versus analyst review with metrics." },
    { beat: "verdict-cta", seconds: 11, instruction: "End on a stark verdict card, review-first URL, comment-style prompt, and final progress hold." }
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
  if (isDataStoryBenchmarkStyle(style)) {
    return {
      duration_seconds: 150,
      angle: "Create an original 2:30 vertical editorial data-story benchmark that matches the reference quality pressure: dark atlas shell, persistent masthead, real chart modules, map grids, lower-third stat chips, timed wipes, SFX cues, and strict visual QA, without copying reference transcript, media, data, brand, or exact visuals.",
      briefBeats: [
        "Open with a dark first-frame hook, rec/time UI, persistent masthead, and a concrete challenge.",
        "Use synthetic launchclip fixture data, never public survey claims.",
        "Hold a single editorial shell while evidence modules change inside it.",
        "Use lower-third stat chips to punctuate spoken clauses instead of paragraph cards.",
        "Make chart/map transitions visible with blur wipes, card pushes, bar fills, tile waves, and SFX.",
        "Keep source status visible for the generated benchmark data.",
        "End on a stark verdict and review-first boundary."
      ],
      structure: dataStoryBenchmarkStructure(manifest),
      recipe: {
        preset: DATA_STORY_BENCHMARK_STYLE,
        aspect_ratio: "9:16",
        duration_seconds: 150,
        resolution: { width: 1080, height: 1920, fps: 30 },
        layout: [
          "0-18s: editorial hook, challenge, question, and topic chips.",
          "18-39s: hopes chart with proof, charts, captions, review, and sound.",
          "39-58s: fears chart showing retention failure modes.",
          "58-78s: orange synthetic scenario grid.",
          "78-98s: blue twist chart about polish versus motion.",
          "98-120s: blue map grid asking for renderer guardrails.",
          "120-139s: trust comparison cards.",
          "139-150s: verdict and review-first CTA."
        ],
        visual_language: {
          palette: "very dark navy atlas background, small off-white chart cards, orange risk/attention marks, blue analysis marks, green review marks",
          masthead: "persistent LAUNCHCLIP masthead, rec dot, runtime code, and bottom progress rail; never use the reference brand lockup",
          data_viz: "horizontal bar charts, orange and blue tile maps, comparison cards, verdict card, lower-third stat chips",
          pacing: "major section change every 11-22 seconds, but chart bars, tiles, stat chips, spotlight wipes, camera drift, and SFX move every 0.5-1.4 seconds",
          captions: "headline and stat-chip copy only; no full transcript subtitles",
          sound_design: "subtle whooshes for section wipes, data ticks for bars/tiles, low hits for verdict cards, and quiet final hit; duck under voiceover",
          source_policy: "all numbers and map tiles are synthetic benchmark fixtures unless tied to launchclip-generated artifacts",
          production_layers: ["persistent shell", "voiceover", "chart marks", "map tiles", "stat chips", "spotlight wipes", "SFX cues", "visual metrics"]
        },
        renderer_contract: {
          adapter: "launchclip.hyperframes-data-story.v1",
          composition_id: "LaunchclipHyperframes",
          primary_renderer: "hyperframes",
          fallback_adapters: ["remotion", "local-ffmpeg", "product-videogen"],
          external_api_policy: "No reference download, no voice cloning, no live product-videogen submit, no social posting, and no unlabelled synthetic claims."
        },
        benchmark_reference_observations: {
          source_video_duration_seconds: 150,
          source_video_aspect: "vertical 9:16",
          observed_pacing: "about 67 auto-caption cues and roughly 400 words across 150 seconds",
          safe_reuse_boundary: "Reuse only high-level production pressure: data-story density, charts, maps, counters, captions, and SFX timing."
        },
        generation_notes: [
          "Write and synthesize an original script only.",
          "Do not use or store the reference transcript as voiceover text.",
          "Do not recreate the exact reference charts, title cards, or map sequence.",
          "Keep every chart and diagram source-labelled for review."
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
  if (isDataStoryBenchmarkStyle(style)) {
    const structure = dataStoryBenchmarkStructure();
    const timeline = [
      {
        beat: "public-record-hook",
        voiceover: "Launchclip just graded its own launch clips: forty seven thousand five hundred eighty two synthetic viewer seconds, fifty failure scenarios, and one uncomfortable question. Can a generated video hold attention for two minutes thirty, or does it collapse the moment the first card stops moving? Stay for the answer, because the first render was brutal.",
        caption: "Launchclip just graded its own output",
        visual: "Dark atlas shell, persistent masthead, rec/time UI, large hook headline, topic chips, and a synthetic viewer-seconds counter.",
        evidence_source: "synthetic launchclip benchmark fixture",
        adapter_target: "hyperframes",
        caption_emphasis: ["graded", "one question", "brutal"],
        motion: "headline slam, atlas drift, rec indicator pulse, counter reveal, topic chips land",
        transition: "orange spotlight wipe"
      },
      {
        beat: "hopes-chart",
        voiceover: "Start with what viewers hope for. Number one, proof that moves with the voice. Forty eight percent of the fixture seconds reward visible evidence. Thirty six percent reward charts that explain the point fast. Twenty nine percent reward captions that land on the spoken beat, not two seconds late.",
        caption: "What a launch clip has to deliver",
        visual: "Centered off-white horizontal bar chart with orange and blue bars, source label, and lower-third stat chips.",
        evidence_source: "synthetic launchclip benchmark fixture",
        adapter_target: "hyperframes",
        caption_emphasis: ["proof moves", "charts explain", "captions land"],
        motion: "chart card push, bar fills, number ticks, lower-third chips pop in sequence",
        transition: "chart blur reveal"
      },
      {
        beat: "fears-chart",
        voiceover: "The fears hit harder. Sixty four percent punish dead holds. Fifty six percent notice bright empty cards before they notice the message. Weak hooks, tiny labels, and flat audio all show up fast. Across the whole benchmark, the viewer is not waiting for us to become interesting later.",
        caption: "And the weak spots hit harder",
        visual: "Second ranked bar chart with blue and orange retention risks, darker shell, and bottom stat chips.",
        evidence_source: "synthetic launchclip benchmark fixture",
        adapter_target: "hyperframes",
        caption_emphasis: ["dead holds", "empty cards", "not waiting"],
        motion: "bar refills, risk labels snap, lower-third chips slide, subtle camera push",
        transition: "risk card wipe"
      },
      {
        beat: "state-grid",
        voiceover: "Every tile in this grid is a synthetic launch scenario. Some start with no hook. Some show terminal proof too long. Some hide the source. Some cut without sound. When those problems cluster, the clip looks automated even when the facts are correct. That is the retention trap.",
        caption: "Dead air: the number-one fear everywhere",
        visual: "Orange map-like tile grid with cluster pulses, legend, and a synthetic scenario source label.",
        evidence_source: "50 synthetic launch scenarios",
        adapter_target: "hyperframes",
        caption_emphasis: ["no hook", "too long", "retention trap"],
        motion: "tile wave, hot clusters pulse, legend snap, lower-third stats land",
        transition: "map zoom wipe"
      },
      {
        beat: "twist-chart",
        voiceover: "Here is the twist. The more polished the surface, the less forgiving the viewer gets. A clean chart buys attention only if something changes: a bar fills, a chip lands, a number resolves, or the camera keeps pressure on the next idea.",
        caption: "The prettier the card, the more viewers punish stillness",
        visual: "Blue ranked bar chart showing polish versus motion, source labels, and moving lower-third chips.",
        evidence_source: "synthetic launchclip benchmark fixture",
        adapter_target: "hyperframes",
        caption_emphasis: ["polished", "less forgiving", "something changes"],
        motion: "blue bars fill, polish row swaps, chip lands, camera pressure continues",
        transition: "blue chart wipe"
      },
      {
        beat: "ask-map",
        voiceover: "So the ask is not just make a prettier template. The renderer has to step in before the drop: enforce dark-light balance, limit stillness, align words to visual events, schedule sound cues, and flag weak source labels. That is what an actual launch clip CLI needs to know.",
        caption: "Can the renderer step in before retention drops?",
        visual: "Blue map-like grid with renderer guardrail clusters, green stat chips, and a one point two second stillness marker.",
        evidence_source: "launchclip visual QA target",
        adapter_target: "hyperframes",
        caption_emphasis: ["step in", "align words", "sound cues"],
        motion: "blue tile wave, guardrail clusters pulse, QA chips tick, progress rail advances",
        transition: "guardrail map wipe"
      },
      {
        beat: "trust-answer",
        voiceover: "Who should decide if the output is ready? Automation alone gets the small number. Review with metrics gets the bigger one. The point is not to slow the system down. It is to make the next render measurably closer before anyone spends attention on it.",
        caption: "Who should decide if a launch clip is ready?",
        visual: "Two dark comparison cards, automation alone versus analyst review, with supporting lower-third trust chips.",
        evidence_source: "synthetic launchclip benchmark fixture",
        adapter_target: "hyperframes",
        caption_emphasis: ["automation alone", "review with metrics", "measurably closer"],
        motion: "comparison cards punch in, numbers count up, stat chips attach, camera settles",
        transition: "comparison punch"
      },
      {
        beat: "verdict-cta",
        voiceover: "The verdict is simple. A clip without visual QA is not launch-ready. Generate the packet, render it, analyze it, then iterate until the contact sheet earns the next two minutes.",
        caption: "15% trust a generated clip with no visual QA",
        visual: "Stark verdict card with a large percentage, review-first URL pill, final lower-third prompts, and quiet progress hold.",
        evidence_source: "launchclip review-first benchmark boundary",
        adapter_target: "hyperframes",
        caption_emphasis: ["visual QA", "analyze it", "iterate"],
        motion: "verdict card push, large number hit, URL pill land, final progress hold",
        transition: "quiet final hit"
      }
    ];
    const timedTimeline = applyVoiceWeightedTiming(timeline, 150, structure);
    return {
      schema_version: "launchclip.script.v1",
      style,
      strategy: "original editorial data-story benchmark with a persistent dark shell, chart cards, map grids, lower-third stat chips, timed wipes, SFX lanes, visual QA, and no copied reference material",
      duration_seconds: 150,
      voice: {
        provider: "none",
        avatar_id: null,
        delivery: "fast data-story narration around 150 WPM, continuous but clear, with short pauses at chart-card transitions"
      },
      summary_line: summary || "turns local demo evidence into a reviewable launch packet",
      timeline: timedTimeline,
      alignment_rules: [
        "Do not use the reference transcript as generated voiceover and do not reuse its audio, footage, brand, graphics, chart values, or exact visuals.",
        "Every chart, map, and stat chip must declare synthetic fixture or launchclip artifact source status.",
        "Keep the persistent editorial shell visible while modules change inside it.",
        "Voiceover is continuous; on-screen copy is headline/stat-chip copy, not full transcript subtitles.",
        "The generated packet remains dry-run and review-first."
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
