import { analyzeRender, initWorkspace, runDemo, planVideo, writeCaptions, renderVideo, submitReview, writeReview, runPacket, validateWorkspace } from "./pipeline.js";
import { writeTeleprompter, alignRecording, renderMotion } from "./talking_head.js";
import { generateMusic } from "./music.js";
import { runDirect } from "./director.js";
import { preprocessPresenter } from "./presenter_preprocess.js";
import { writeIntake } from "./intake.js";
import { runProductionStage } from "./production_cli.js";

const PRODUCTION_COMMANDS = new Set(["evidence", "source-media", "creative-plan", "direct-frames", "production-audio", "assemble", "production-verify", "production-draft", "production-critique", "production-repair", "production-render", "produce"]);
const COMMANDS = new Set(["intake", ...PRODUCTION_COMMANDS, "init", "demo", "plan", "captions", "render", "analyze-render", "submit-review", "review", "validate", "run", "script", "align", "motion-render", "music", "direct", "preprocess-presenter"]);

export async function runCli(argv, io = {}) {
  const { stdout = process.stdout } = io;
  const [command, firstArg, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    stdout.write(help());
    return;
  }
  if (!COMMANDS.has(command)) {
    throw new Error(`Unknown command: ${command}\n\n${help()}`);
  }

  const flags = parseFlags(rest);
  let result;
  if (command === "intake") {
    result = await writeIntake(required(firstArg, "source"), flags);
  } else if (PRODUCTION_COMMANDS.has(command)) {
    result = await runProductionStage(command, required(firstArg, command === "produce" ? "source" : "workspace path"), flags);
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
    result = await writeReview(required(firstArg, "workspace path"), flags);
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
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function parseFlags(args) {
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const name = token.slice(2);
    if (name === "dry-run" || name === "submit" || name === "no-render" || name === "force" || name === "approve" || name === "critic-pro" || name === "transcribe-all" || name === "allow-placeholder-sfx" || name === "no-music" || name === "no-voice" || name === "no-sfx" || name === "no-audio" || name === "allow-timing-drift" || name === "foreground" || name === "fast-eval" || name === "no-trim-silence" || name === "skip-quality-gates" || name === "skip-hyperframes-quality" || name === "strict" || name === "strict-all" || name === "pro") {
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
  launchclip intake <source> [--kind repository|product|topic|voiceover] [--resource path] [--assets path] [--style auto|family] [--style-file frame.md] [--style-reference path|url] [--reference url] [--voiceover audio|video] [--transcript text] [--presenter video] [--aspect 9:16|16:9] [--duration 60] [--model gpt-5.6] [--reasoning xhigh] [--pro] [--out <workspace>]
  launchclip produce <source> [intake flags] [--planning-mode auto|single|hierarchical] [--chapter-concurrency 3] [--voice-id id] [--sfx-dir path] [--concurrency 4] [--no-audio] [--fast-eval] [--allow-timing-drift]
  launchclip evidence <workspace>
  launchclip source-media <workspace> [--media-samples 12] [--media-reasoning high] [--transcribe-all]
  launchclip creative-plan <workspace> [--planning-mode auto|single|hierarchical] [--hierarchical-threshold 180] [--chapter-concurrency 3] [--max-output-tokens 48000] [--foreground]
  launchclip production-audio <workspace> [--voice-id id] [--music-model music_v2] [--sfx-dir path] [--no-voice] [--no-music] [--no-sfx]
  launchclip direct-frames <workspace> [--concurrency 4] [--semantic-attempts 2] [--frame-reasoning high]
  launchclip assemble <workspace> [--music-volume 0.16]
  launchclip production-verify <workspace> [--inspect-samples 15] [--shot-inspect-concurrency 2] [--snapshot-frames 12]
  launchclip production-draft <workspace> [--draft-quality draft] [--shot-inspect-concurrency 2] [--reference-video local.mp4]
  launchclip production-critique <workspace> [--critic-reasoning xhigh] [--critic-pro]
  launchclip production-repair <workspace> [--repair-reasoning high] [--repair-semantic-attempts 2] [--repair-snapshots 8]
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
