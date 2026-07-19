import { analyzeRender, initWorkspace, runDemo, planVideo, writeCaptions, renderVideo, submitReview, writeReview, runPacket, validateWorkspace } from "./pipeline.js";
import { writeTeleprompter, alignRecording, renderMotion } from "./talking_head.js";
import { generateMusic } from "./music.js";
import { runDirect } from "./director.js";
import { preprocessPresenter } from "./presenter_preprocess.js";
import { writeIntake } from "./intake.js";
import { runProductionStage } from "./production_cli.js";
import { isProductionReviewWorkspace } from "./production_review.js";
import { createCostTracker } from "./cost_tracker.js";
import { diagnoseInstallation, VERSION } from "./doctor.js";
import { createStylePack, listStylePacks, projectStyleRoot, resolveStylePack } from "./style_store.js";
import { checkCinematicProject } from "./cinematic_check.js";

const PRODUCTION_COMMANDS = new Set(["evidence", "source-preprocess", "source-media", "resolve-entities", "concept-tournament", "retention-story", "cinematic-narration", "creative-plan", "direct-frames", "production-audio", "assemble", "production-verify", "production-draft", "production-preview", "production-critique", "production-repair", "production-render", "produce"]);
const COMMANDS = new Set(["doctor", "style", "intake", ...PRODUCTION_COMMANDS, "cinematic-check", "init", "demo", "plan", "captions", "render", "analyze-render", "submit-review", "review", "validate", "run", "script", "align", "motion-render", "music", "direct", "preprocess-presenter"]);

export async function runCli(argv, io = {}) {
  const { stdout = process.stdout, stderr = process.stderr, stdin = process.stdin, fetch: baseFetch = globalThis.fetch, doctor = diagnoseInstallation, productionAdapters = {} } = io;
  const [command, firstArg, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    stdout.write(help());
    return;
  }
  if (command === "--version" || command === "-v" || command === "version") {
    stdout.write(`${VERSION}\n`);
    return;
  }
  if (!COMMANDS.has(command)) {
    throw new Error(`Unknown command: ${command}\n\n${help()}`);
  }

  const styleInvocation = command === "style" ? parseStyleInvocation(firstArg, rest) : null;
  const flags = parseFlags(styleInvocation?.flagArgs ?? rest);
  const tracker = createCostTracker({ fetch: baseFetch });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = tracker.fetch;
  try {
    let result;
    if (command === "doctor") {
      result = await doctor();
    } else if (command === "style") {
      result = await runStyleCommand(styleInvocation.action, styleInvocation.name, flags);
    } else if (command === "intake") {
      result = await writeIntake(required(firstArg, "source"), flags);
    } else if (PRODUCTION_COMMANDS.has(command)) {
      result = await runProductionStage(command, required(firstArg, command === "produce" ? "source" : "workspace path"), flags, {
        ...productionAdapters,
        review: { input: stdin, output: stderr, ...productionAdapters.review }
      });
    } else if (command === "cinematic-check") {
      result = await checkCinematicProject(required(firstArg, "HyperFrames project path"), {
        ...flags,
        expectAudio: Boolean(flags["expect-audio"]),
        audioManifest: flags["audio-manifest"],
        qaDir: flags["qa-dir"]
      }, productionAdapters.cinematicCheck);
    } else if (command === "init") {
      result = await initWorkspace(required(firstArg, "repo path"), flags);
    } else if (command === "demo") {
      result = await runDemo(required(firstArg, "repo path"), flags);
    } else if (command === "plan") {
      result = await planVideo(required(firstArg, "workspace path"), flags);
    } else if (command === "captions") {
      result = await writeCaptions(required(firstArg, "workspace path"), flags);
    } else if (command === "render") {
      result = await renderVideo(required(firstArg, "workspace path"), flags);
    } else if (command === "analyze-render") {
      result = await analyzeRender(required(firstArg, "workspace path"), flags);
    } else if (command === "submit-review") {
      result = await submitReview(required(firstArg, "workspace path"), flags);
    } else if (command === "review") {
      const workspace = required(firstArg, "workspace path");
      const productionReview = await isProductionReviewWorkspace(workspace);
      result = productionReview
        ? await runProductionStage("production-review", workspace, flags, {
            ...productionAdapters,
            review: { input: stdin, output: stderr, ...productionAdapters.review }
          })
        : await writeReview(workspace, flags);
    } else if (command === "validate") {
      result = await validateWorkspace(required(firstArg, "workspace path"), { ...flags, write: true });
    } else if (command === "run") {
      result = await runPacket(required(firstArg, "repo path"), flags);
    } else if (command === "script") {
      result = await writeTeleprompter(required(firstArg, "workspace path"), flags);
    } else if (command === "align") {
      result = await alignRecording(required(firstArg, "workspace path"), flags);
    } else if (command === "motion-render") {
      result = await renderMotion(required(firstArg, "workspace path"), flags);
    } else if (command === "music") {
      result = await generateMusic(required(firstArg, "workspace path"), flags);
    } else if (command === "direct") {
      result = await runDirect(required(firstArg, "workspace path"), flags);
    } else if (command === "preprocess-presenter") {
      result = await preprocessPresenter(required(firstArg, "presenter media path"), flags);
    }
    const output = result && typeof result === "object" && !Array.isArray(result)
      ? { ...result, costs: tracker.summary() }
      : { result, costs: tracker.summary() };
    stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    failure.costs = tracker.summary();
    throw failure;
  } finally {
    if (globalThis.fetch === tracker.fetch) globalThis.fetch = previousFetch;
  }
}

async function runStyleCommand(action, name, flags) {
  const root = flags.root ?? flags["style-root"];
  if (action === "create" || action === "save") {
    const result = await createStylePack(required(name, "style name"), { from: flags.from, root, force: Boolean(flags.force) });
    return { ...result, action };
  }
  if (action === "list") {
    return { stage: "style", action, status: "ready", root: projectStyleRoot({ root }), styles: await listStylePacks({ root }) };
  }
  const pack = await resolveStylePack(required(name, "style name or path"), { root });
  if (!pack) throw new Error(`Style pack does not exist: ${name}`);
  return {
    stage: "style",
    action: "show",
    status: "ready",
    name: pack.name,
    path: pack.path,
    manifest: pack.manifest,
    specification: pack.specification_path,
    caption_skin: pack.caption_skin_path,
    fonts: pack.fonts
  };
}

function parseStyleInvocation(action, rest) {
  if (!action) throw new Error("Missing style action; use create, save, list, or show");
  if (!new Set(["create", "save", "list", "show"]).has(action)) throw new Error(`Unknown style action: ${action}`);
  const takesName = action !== "list";
  const hasName = takesName && rest[0] && !rest[0].startsWith("--");
  return { action, name: hasName ? rest[0] : null, flagArgs: hasName ? rest.slice(1) : rest };
}

export function parseFlags(args) {
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const name = token.slice(2);
    if (name === "dry-run" || name === "submit" || name === "no-render" || name === "force" || name === "approve" || name === "review" || name === "critic-pro" || name === "transcribe-all" || name === "allow-placeholder-sfx" || name === "allow-frame-fallback" || name === "repair-text-only" || name === "repair-scoped-source" || name === "refresh-free-models" || name === "no-music" || name === "no-voice" || name === "no-sfx" || name === "no-audio" || name === "no-open" || name === "allow-timing-drift" || name === "foreground" || name === "fast-eval" || name === "no-trim-silence" || name === "skip-quality-gates" || name === "skip-hyperframes-quality" || name === "strict" || name === "strict-all" || name === "pro" || name === "expect-audio") {
      flags[name] = true;
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${name}`);
    }
    if (Object.hasOwn(flags, name)) {
      flags[name] = Array.isArray(flags[name]) ? [...flags[name], value] : [flags[name], value];
    } else {
      flags[name] = value;
    }
    index += 1;
  }
  return flags;
}

function required(value, label) {
  if (!value) throw new Error(`Missing ${label}`);
  return value;
}

function help() {
  return `launchclip creates dry-run-first OSS promotion packets.

Usage:
  launchclip --version
  launchclip doctor
  launchclip style create <name> --from <video-or-style-directory> [--root .launchclip/styles] [--force]
  launchclip style save <name> --from <video-or-style-directory> [--root .launchclip/styles] [--force]
  launchclip style list [--root .launchclip/styles]
  launchclip style show <name|path> [--root .launchclip/styles]
  launchclip intake <source> [--profile standard|cinematic] [--kind repository|product|topic|voiceover] [--resource path] [--assets path] [--style auto|family|name|path] [--style-root .launchclip/styles] [--style-file frame.md] [--style-reference path|url] [--reference url] [--voiceover audio|video] [--transcript text] [--presenter video] [--heygen-avatar video] [--aspect 9:16|16:9] [--duration 60] [--model gpt-5.6] [--reasoning xhigh] [--pro] [--out <workspace>]
  launchclip produce <source> [--profile standard|cinematic] [intake flags] [--heygen-avatar generated.mp4] [--review] [--model-policy cost-aware|local-first|quality|free] [--free-model-candidates 5] [--free-model-state path] [--free-vision-model-candidates 3] [--free-vision-model-state path] [--refresh-free-models] [--free-scene-concurrency 3] [--local-model qwen2.5-coder:latest] [--frame-route provider:model@reasoning] [--rendered-candidates 2] [--rendered-candidate-shots 2] [--candidate-judge-route provider:model@reasoning] [--candidate-judge-reasoning high] [--candidate-judge-max-output-tokens 5000] [--critic-route provider:model@reasoning] [--repair-route provider:model@reasoning] [--brand-assets-dir path] [--no-trim-silence] [--planning-mode auto|single|hierarchical] [--voice-id id] [--sfx-dir path] [--concurrency 4] [--max-frame-cost-usd 5] [--no-audio] [--fast-eval]
  launchclip evidence <workspace>
  launchclip source-preprocess <workspace> [--no-trim-silence] [--silence-duration 0.45] [--silence-padding 0.12]
  launchclip source-media <workspace> [--media-samples 12] [--media-reasoning high] [--transcribe-all]
  launchclip resolve-entities <workspace> [--brand-assets-dir ~/.launchclip/brand-assets]
  launchclip concept-tournament <workspace> [--concept-route provider:model@reasoning] [--concept-judge-route provider:model@reasoning]
  launchclip retention-story <workspace> [--story-writer-route provider:model@reasoning] [--story-editor-route provider:model@reasoning]
  launchclip cinematic-narration <workspace> [--voice-id id] [--voice-model id] [--no-voice]
  launchclip creative-plan <workspace> [--planning-mode auto|single|hierarchical] [--hierarchical-threshold 180] [--chapter-concurrency 3] [--plan-semantic-attempts 2] [--visual-history-dir path] [--visual-history-limit 8] [--visual-similarity-limit 0.58] [--max-output-tokens 48000] [--foreground]
  launchclip production-audio <workspace> [--voice-id id] [--music-model music_v2] [--sfx-dir path] [--no-voice] [--no-music] [--no-sfx]
  launchclip direct-frames <workspace> [--profile standard|cinematic] [--model-policy cost-aware|local-first|quality|free] [--free-model-candidates 5] [--free-model-state path] [--refresh-free-models] [--free-scene-concurrency 3] [--blueprint-semantic-attempts 2] [--frame-route provider:model@reasoning] [--rendered-candidates 2] [--rendered-candidate-shots 2] [--candidate-judge-route provider:model@reasoning] [--candidate-judge-reasoning high] [--candidate-judge-max-output-tokens 5000] [--concurrency 4] [--semantic-attempts 2] [--pending-frame-reasoning medium] [--max-frame-cost-usd amount] [--allow-frame-fallback]
  launchclip assemble <workspace> [--music-volume 0.35]
  launchclip production-verify <workspace> [--inspect-samples 15] [--shot-inspect-concurrency 2] [--snapshot-frames 12]
  launchclip production-draft <workspace> [--model-policy free] [--draft-quality draft] [--critic-route provider:model@reasoning] [--free-vision-model-state path] [--shot-inspect-concurrency 2] [--reference-video local.mp4]
  launchclip production-preview <workspace> [--port 3002] [--no-open]
  launchclip review <workspace> [--model-policy free] [--port 3002] [--no-open] [--critic-route provider:model@reasoning] [--repair-route provider:model@reasoning]
  launchclip production-critique <workspace> [--critic-route provider:model@reasoning] [--model-policy free] [--free-vision-model-candidates 3] [--free-vision-model-state path] [--refresh-free-vision-models] [--critic-reasoning xhigh] [--critic-pro]
  launchclip production-repair <workspace> [--model-policy cost-aware|local-first|quality|free] [--repair-route provider:model@reasoning] [--repair-text-only] [--repair-scoped-source] [--repair-semantic-attempts 2] [--repair-snapshots 8] [--repair-issues-per-shot 4] [--max-patch-ratio 0.35]
  launchclip production-render <workspace> --approve [--quality high] [--critic-route provider:model@reasoning] [--shot-inspect-concurrency 2] [--reference-video local.mp4]
  launchclip cinematic-check <hyperframes-project> [--video renders/draft.mp4] [--audio-manifest AUDIO-MANIFEST.json] [--expect-audio] [--critique qa/critic.json]
  launchclip init <repo> --out <workspace>
  launchclip demo <repo> --out <workspace> --demo-cmd "npm run smoke" --capture terminal [--demo-media path/to/screenshot.png]
  launchclip plan <workspace> --format short-15 --renderer none|hyperframes [--style proof-card|ugc-split|ugc-demo-punchy|premium-product-short|data-story-benchmark] [--assets-dir path/to/assets] [--talking-head heygen --avatar-id avatar_123]
  launchclip captions <workspace> --platforms x,linkedin,tiktok,bluesky
  launchclip render <workspace> --provider product-videogen --dry-run
  launchclip render <workspace> --provider hyperframes [--quality high] [--strict-all] [--inspect-samples 15] [--skip-quality-gates] [--voiceover local-say|elevenlabs] [--music elevenlabs]
  launchclip render <workspace> --provider remotion [--assets-dir path/to/assets] [--voiceover local-say|elevenlabs]
  launchclip render <workspace> --provider local-ffmpeg [--voiceover local-say|elevenlabs]
  launchclip analyze-render <workspace> [--video video/launchclip-hyperframes.mp4]
  launchclip submit-review <workspace> --provider product-videogen --dry-run
  launchclip review <workspace>
  launchclip validate <workspace>
  launchclip run <repo> --out <workspace> --demo-cmd "npm run smoke" --demo-media path/to/demo.mp4 --angle "..." --audience "..." [--style premium-product-short --assets-dir path/to/assets --talking-head heygen]

Talking-head motion workflow:
  launchclip script <workspace> [--wpm 150]            # teleprompter from the planned voiceover
  launchclip align <workspace> --media take.mp4        # whisper word timings + heuristic motion timeline
  launchclip align <workspace> --media take.mp4 --words words.json
  launchclip motion-render <workspace>                 # render video/motion.mp4 via the motion engine
  launchclip music <workspace> [--prompt "..."] [--duration 18] [--output music/bed.mp3] [--music-model music_v1] [--force]
  launchclip preprocess-presenter public/base/presenter.mp4 [--out public/base/presenter-prepped.mp4] [--speed 1.08] [--crop-x center]
  launchclip direct <workspace> --voice record --prompt "creative direction"       # writes script + teleprompter, waits for take
  launchclip direct <workspace> --voice record --take take.mp4 [--words w.json]    # aligns take, directs, renders
  launchclip direct <workspace> --voice tts --prompt "creative direction"          # generates voice + timings, directs, renders
  launchclip direct <workspace> --prompt "creative direction" [--format software_demo|explainer]
            [--words w.json --take base/take.mp4 | --script-text "..."] [--duration 45] [--no-render] [--quality fast|high]
            [--music-prompt "..."] [--no-music] [--sfx-dir path/to/sfx] [--allow-placeholder-sfx]
            [--provider anthropic|openai] [--model <id>]   # LLM: ANTHROPIC_API_KEY (default) or OPENAI_API_KEY
`;
}
