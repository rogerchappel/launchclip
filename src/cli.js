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

const PRODUCTION_COMMANDS = new Set(["evidence", "source-preprocess", "source-media", "resolve-entities", "creative-plan", "direct-frames", "production-audio", "assemble", "production-verify", "production-draft", "production-preview", "production-critique", "production-repair", "production-render", "produce"]);
const COMMANDS = new Set(["doctor", "intake", ...PRODUCTION_COMMANDS, "init", "demo", "plan", "captions", "render", "analyze-render", "submit-review", "review", "validate", "run", "script", "align", "motion-render", "music", "direct", "preprocess-presenter"]);

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

  const flags = parseFlags(rest);
  const tracker = createCostTracker({ fetch: baseFetch });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = tracker.fetch;
  try {
    let result;
    if (command === "doctor") {
      result = await doctor();
    } else if (command === "intake") {
      result = await writeIntake(required(firstArg, "source"), flags);
    } else if (PRODUCTION_COMMANDS.has(command)) {
      result = await runProductionStage(command, required(firstArg, command === "produce" ? "source" : "workspace path"), flags, {
        ...productionAdapters,
        review: { input: stdin, output: stderr, ...productionAdapters.review }
      });
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

export function parseFlags(args) {
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const name = token.slice(2);
    if (name === "dry-run" || name === "submit" || name === "no-render" || name === "force" || name === "approve" || name === "review" || name === "critic-pro" || name === "transcribe-all" || name === "allow-placeholder-sfx" || name === "allow-frame-fallback" || name === "repair-text-only" || name === "repair-scoped-source" || name === "no-music" || name === "no-voice" || name === "no-sfx" || name === "no-audio" || name === "no-open" || name === "allow-timing-drift" || name === "foreground" || name === "fast-eval" || name === "no-trim-silence" || name === "skip-quality-gates" || name === "skip-hyperframes-quality" || name === "strict" || name === "strict-all" || name === "pro") {
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
  launchclip intake <source> [--kind repository|product|topic|voiceover] [--resource path] [--assets path] [--style auto|family] [--style-file frame.md] [--style-reference path|url] [--reference url] [--voiceover audio|video] [--transcript text] [--presenter video] [--aspect 9:16|16:9] [--duration 60] [--model gpt-5.6] [--reasoning xhigh] [--pro] [--out <workspace>]
  launchclip produce <source> [intake flags] [--review] [--model-policy cost-aware|local-first|quality] [--local-model qwen2.5-coder:latest] [--frame-route provider:model@reasoning] [--repair-route provider:model@reasoning] [--brand-assets-dir path] [--no-trim-silence] [--planning-mode auto|single|hierarchical] [--voice-id id] [--sfx-dir path] [--concurrency 4] [--max-frame-cost-usd 5] [--allow-frame-fallback] [--no-audio] [--fast-eval] [--allow-timing-drift]
  launchclip evidence <workspace>
  launchclip source-preprocess <workspace> [--no-trim-silence] [--silence-duration 0.45] [--silence-padding 0.12]
  launchclip source-media <workspace> [--media-samples 12] [--media-reasoning high] [--transcribe-all]
  launchclip resolve-entities <workspace> [--brand-assets-dir ~/.launchclip/brand-assets]
  launchclip creative-plan <workspace> [--planning-mode auto|single|hierarchical] [--hierarchical-threshold 180] [--chapter-concurrency 3] [--plan-semantic-attempts 2] [--visual-history-dir path] [--visual-history-limit 8] [--visual-similarity-limit 0.58] [--max-output-tokens 48000] [--foreground]
  launchclip production-audio <workspace> [--voice-id id] [--music-model music_v2] [--sfx-dir path] [--no-voice] [--no-music] [--no-sfx]
  launchclip direct-frames <workspace> [--model-policy cost-aware|local-first|quality] [--frame-route provider:model@reasoning] [--concurrency 4] [--semantic-attempts 2] [--pending-frame-reasoning medium] [--max-frame-cost-usd amount] [--allow-frame-fallback]
  launchclip assemble <workspace> [--music-volume 0.35]
  launchclip production-verify <workspace> [--inspect-samples 15] [--shot-inspect-concurrency 2] [--snapshot-frames 12]
  launchclip production-draft <workspace> [--draft-quality draft] [--shot-inspect-concurrency 2] [--reference-video local.mp4]
  launchclip production-preview <workspace> [--port 3002] [--no-open]
  launchclip review <workspace> [--port 3002] [--no-open] [production repair and render flags]
  launchclip production-critique <workspace> [--critic-reasoning xhigh] [--critic-pro]
  launchclip production-repair <workspace> [--model-policy cost-aware|local-first|quality] [--repair-route provider:model@reasoning] [--repair-text-only] [--repair-scoped-source] [--repair-semantic-attempts 2] [--repair-snapshots 8] [--repair-issues-per-shot 4] [--max-patch-ratio 0.35]
  launchclip production-render <workspace> --approve [--quality high] [--shot-inspect-concurrency 2] [--reference-video local.mp4]
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
