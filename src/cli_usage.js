// The CLI usage table: one source for `launchclip --help`, every
// `launchclip <command> --help` and the generated "Command usage" section of
// skills/launchclip-cli/references/cli-reference.md (npm run skills:sync
// writes it; skills:check fails when it drifts).
//
// USAGE rows are [name, usage, options?] in help order. name is the command
// ("finish") or "group action" for commands with actions ("story validate",
// "sfx seed"); usage is the line after "launchclip "; options: {comment}
// (shown after the line), {continuation: true} (an indented continuation of
// the previous line), {section: "talking-head"} (listed under the talking-head
// workflow).

export const USAGE = Object.freeze([
  ["--version", "--version"],
  ["doctor", "doctor"],
  ["skills list", "skills list"],
  ["skills path", "skills path [launchclip-create-video|launchclip-create-video-remotion|launchclip-cli]"],
  ["skills install", "skills install --agent codex|claude [--skill launchclip-create-video|launchclip-create-video-remotion|launchclip-cli|all] [--force]"],
  ["style create", "style create <name> --from <video-or-style-directory> [--root .launchclip/styles] [--force]"],
  ["style save", "style save <name> --from <video-or-style-directory> [--root .launchclip/styles] [--force]"],
  ["style create", "style create <name> --from-reference a.mp4 [b.mp4 ...] [--from-images x.png ...] [--font-hint \"Display, Body\"] [--format footage-led|motion|demo-led] [--rights own|licensed|public-statistics] [--root .launchclip/styles] [--force]"],
  ["style list", "style list [--root .launchclip/styles]"],
  ["style show", "style show <name|path> [--root .launchclip/styles]"],
  ["style upgrade", "style upgrade <name> [--root .launchclip/styles]"],
  ["style check", "style check <project> --against <name|path> [--video renders/final.mp4] [--out qa/style-check.json]"],
  ["style generate", "style generate [--seed <hex>] [--tone calm|serious|warm|energetic|playful|premium|technical] [--theme dark|light|tinted] [--world <id>[,<id>...]] [--drawing-style <name>] [--character-set <id>] [--background <kind>] [--panel <treatment>] [--out <dir|style.json> | --project <dir>] [--force]"],
  ["style reroll", "style reroll [<project>] [--tone <tone>] [--seed <hex>] [--undo]"],
  ["style keep", "style keep <project> --as <name> [--force]"],
  ["profile list", "profile list", {comment: "the shipped cadence profiles"}],
  ["profile show", "profile show <id|profile.json>"],
  ["profile measure", "profile measure <folder> --rights own|licensed|public-statistics (--id <new-id> | --replace <shipped-id>) [--out profile.json] [--title \"…\"] [--fps 1]"],
  ["cast list", "cast list [project|storyboard.json]"],
  ["cast show", "cast show <id> [--story storyboard.json]"],
  ["cast sheet", "cast sheet <project|storyboard.json> [--ids maya,theo] [--out qa/cast-sheet.png] [--report qa/cast-sheet.json]"],
  ["intake", "intake <source> [--profile standard|cinematic] [--kind repository|product|topic|voiceover] [--resource path] [--assets path] [--style auto|family|name|path] [--style-root .launchclip/styles] [--style-file frame.md] [--style-reference path|url] [--reference url] [--voiceover audio|video] [--transcript text] [--presenter video] [--heygen-avatar video] [--aspect 9:16|16:9] [--duration 60] [--model gpt-5.6] [--reasoning xhigh] [--pro] [--out <workspace>]"],
  ["edit-recording", "edit-recording <media> --out <directory> [--recording-transcript word-timed.json] [--silence-duration 0.8] [--silence-padding 0.15] [--retake-window 90] [--retake-decisions semantic.json|--retake-model local-model] [--min-repeat-words 6] [--recording-model base.en] [--consensus-model small.en|none] [--consensus-transcript word-timed.json] [--keep-fillers] [--no-audio-silence] [--audio-silence-duration 0.4] [--audio-silence-padding 0.08] [--audio-threshold-db -35] [--qa-model local-model|--qa-decisions reviews.json] [--qa-attempts 3] [--qa-recording-model base.en] [--no-trim-silence] [--enhance light|podcast|off] [--voice-isolation none|elevenlabs] [--aspect 16:9|9:16|1:1]"],
  ["broll-plan", "broll-plan <word-timed.json> --out <directory> [--aspect 16:9|9:16|1:1] [--duration seconds]"],
  ["produce", "produce <source> [--profile standard|cinematic] [intake flags] [--heygen-avatar generated.mp4] [--review] [--model-policy cost-aware|local-first|quality|free] [--free-model-candidates 5] [--free-model-state path] [--free-vision-model-candidates 3] [--free-vision-model-state path] [--refresh-free-models] [--free-scene-concurrency 3] [--local-model qwen2.5-coder:latest] [--frame-route provider:model@reasoning] [--rendered-candidates 2] [--rendered-candidate-shots 2] [--candidate-judge-route provider:model@reasoning] [--candidate-judge-reasoning high] [--candidate-judge-max-output-tokens 5000] [--critic-route provider:model@reasoning] [--repair-route provider:model@reasoning] [--brand-assets-dir path] [--edit-recording] [--recording-transcript word-timed.json] [--no-trim-silence] [--planning-mode auto|single|hierarchical] [--voice-id id] [--sfx-dir path] [--concurrency 4] [--max-frame-cost-usd 5] [--max-cost-usd 50|none] [--no-audio] [--fast-eval]"],
  ["evidence", "evidence <workspace>"],
  ["source-preprocess", "source-preprocess <workspace> [--edit-recording] [--recording-transcript word-timed.json] [--no-trim-silence] [--silence-duration seconds] [--silence-padding seconds]"],
  ["source-media", "source-media <workspace> [--media-samples 12] [--media-reasoning high] [--transcribe-all]"],
  ["resolve-entities", "resolve-entities <workspace> [--brand-assets-dir ~/.launchclip/brand-assets]"],
  ["concept-tournament", "concept-tournament <workspace> [--concept-route provider:model@reasoning] [--concept-judge-route provider:model@reasoning]"],
  ["retention-story", "retention-story <workspace> [--story-writer-route provider:model@reasoning] [--story-editor-route provider:model@reasoning]"],
  ["cinematic-narration", "cinematic-narration <workspace> [--voice-id id] [--voice-model id] [--no-voice]"],
  ["creative-plan", "creative-plan <workspace> [--planning-mode auto|single|hierarchical] [--hierarchical-threshold 180] [--chapter-concurrency 3] [--plan-semantic-attempts 2] [--visual-history-dir path] [--visual-history-limit 8] [--visual-similarity-limit 0.58] [--max-output-tokens 48000] [--foreground]"],
  ["production-audio", "production-audio <workspace> [--voice-id id] [--music-model music_v2] [--sfx-dir path] [--no-voice] [--no-music] [--no-sfx]"],
  ["direct-frames", "direct-frames <workspace> [--profile standard|cinematic] [--model-policy cost-aware|local-first|quality|free] [--free-model-candidates 5] [--free-model-state path] [--refresh-free-models] [--free-scene-concurrency 3] [--blueprint-semantic-attempts 2] [--frame-route provider:model@reasoning] [--rendered-candidates 2] [--rendered-candidate-shots 2] [--candidate-judge-route provider:model@reasoning] [--candidate-judge-reasoning high] [--candidate-judge-max-output-tokens 5000] [--concurrency 4] [--semantic-attempts 2] [--pending-frame-reasoning medium] [--max-frame-cost-usd amount] [--allow-frame-fallback]"],
  ["assemble", "assemble <workspace> [--music-volume 0.35]"],
  ["production-verify", "production-verify <workspace> [--inspect-samples 15] [--shot-inspect-concurrency 2] [--snapshot-frames 12]"],
  ["production-draft", "production-draft <workspace> [--model-policy free] [--draft-quality draft] [--critic-route provider:model@reasoning] [--free-vision-model-state path] [--shot-inspect-concurrency 2] [--reference-video local.mp4]"],
  ["production-preview", "production-preview <workspace> [--port 3002] [--no-open]"],
  ["review", "review <workspace> [--model-policy free] [--port 3002] [--no-open] [--critic-route provider:model@reasoning] [--repair-route provider:model@reasoning]"],
  ["production-critique", "production-critique <workspace> [--critic-route provider:model@reasoning] [--model-policy free] [--free-vision-model-candidates 3] [--free-vision-model-state path] [--refresh-free-vision-models] [--critic-reasoning xhigh] [--critic-pro]"],
  ["production-repair", "production-repair <workspace> [--model-policy cost-aware|local-first|quality|free] [--repair-route provider:model@reasoning] [--repair-text-only] [--repair-scoped-source] [--repair-semantic-attempts 2] [--repair-snapshots 8] [--repair-issues-per-shot 4] [--max-patch-ratio 0.35]"],
  ["production-render", "production-render <workspace> --approve [--quality high] [--critic-route provider:model@reasoning] [--shot-inspect-concurrency 2] [--reference-video local.mp4]"],
  ["story validate", "story validate <storyboard.json> [--narration NARRATION.json] [--beats BEATS.json] [--direction DIRECTION.json] [--out report.json]"],
  ["story resolve", "story resolve <storyboard.json> [--narration NARRATION.json] [--beats BEATS.json] [--out story.resolved.json]"],
  ["story compile", "story compile <project> --renderer hyperframes|remotion [--out dir]"],
  ["story long-form", "story long-form <project> [--narration NARRATION.json] [--dry-run]"],
  ["story plan", "story plan --brief brief.md [--narration NARRATION.json] [--tier structured|guided|bespoke] [--model provider:model] [--out storyboard.json] [--base assets/recording.mp4] [--voice assets/audio/narration.wav] [--format 1080x1920] [--fps 30] [--duration seconds] [--brand brand.json] [--style name|path | --seed <hex>] [--tone <tone>] [--profile id|profile.json] [--no-direction] [--no-subject] [--max-repairs 2]"],
  ["cinematic-check", "cinematic-check <project> [--renderer hyperframes|remotion] [--video renders/draft.mp4] [--audio-manifest AUDIO-MANIFEST.json] [--music-volume 0.32] [--expect-audio] [--critique qa/critic.json]"],
  ["layout-check", "layout-check <project> [--profile shorts|landscape] [--json]"],
  ["module fit", "module fit <module> [--params params.json] [--aspect 16:9|9:16] [--story storyboard.json] [--brand brand.json] [--duration 4] [--json]"],
  ["subject setup", "subject setup [--model modnet-fused|modnet|mediapipe-selfie|u2net-human]", {comment: "download and verify the segmentation models"}],
  ["subject probe", "subject probe <video> [--model mediapipe-selfie] [--cache .launchclip/subject] [--force] [--no-download] [--json]", {comment: "framing summary: people, head, headroom, usable"}],
  ["subject track", "subject track <video> [--project <story-project>] [--model mediapipe-selfie] [--cache .launchclip/subject] [--force] [--no-download] [--json]", {comment: "head and body boxes at 10 fps over the whole recording"}],
  ["subject matte", "subject matte <video> --range <in>-<out> [--project <story-project>] [--model modnet-fused] [--smooth 0-0.9] [--cache .launchclip/subject] [--force] [--no-download] [--json]", {comment: "alpha matte.webm + subject.json for one source range"}],
  ["finish", "finish <project> [--renderer remotion|hyperframes] [--quality draft|high] [--voice kokoro|elevenlabs|supplied|test] [--music synth|elevenlabs|none] [--music-regenerate] [--out renders/final.mp4] [--sfx-library dir] [--sfx-density low|normal|high] [--scene s3[,s4] | --preview-scene s3 | --chapter c2] [--force] [--json]"],
  ["finish", "finish <project> --prototype [--renderer remotion|hyperframes] [--quality draft|high]", {comment: "the opening 20–30 s only"}],
  ["finish", "finish <candidate-project> --candidate <id> [--into <project>] [--kind opening|transition] [--boundary s3] [--comparison id] [--at 0.4,1.2,2.6] [--music synth|none] [--renderer remotion|hyperframes]", {comment: "cheap rendered candidate: no paid calls, receipt in <project>/qa/rendered-candidates.json"}],
  ["publish-manifest", "publish-manifest <project> [--link <url>] [--utm <campaign>|auto] [--platforms app_store,product_hunt]", {comment: "publish.json: titles, description, hashtags, CTA and platform fit"}],
  ["make", "make \"<prompt>\" [--assets <dir>] [--aspect 16:9|9:16|1:1] [--duration <seconds>] [--format short-form|long-form|explainer|data-explainer|story|promo] [--goal reach|convert] [--awareness unaware|problem|solution|product|most] [--style <name|path> | --seed <hex>] [--model provider:model] [--voice kokoro|elevenlabs] [--music synth|elevenlabs|none] [--renderer remotion|hyperframes] [--quality draft|high] [--out <project-dir>] [--replan] [--critic | --no-critic] [--max-repairs 4] [--no-subject] [--max-cost-usd 50|none] [--json]"],
  ["make", "make \"<prompt>\" --repo <app-repo> [--approve-demo] [--demo-plan DEMO-PLAN.json] [--start \"npm run dev\"] [--url http://localhost:3000] [--allow-host <host>] [--redemo]"],
  ["fx", "fx <video> <module> [--at <seconds|word:text>] [--until <seconds|word:text> | --for <seconds>] [--params '{...}'|params.json] [--layer front|behind|split] [--captions <style>] [--style <name|path>] [--renderer remotion|hyperframes] [--quality draft|high] [--music none|synth] [--out <project-dir>] [--no-download] [--json]"],
  ["voice", "voice <project | --text \"...\"> [--voice kokoro|elevenlabs|test|<voice id>] [--provider kokoro|elevenlabs|test] [--speed 1.2] [--out NARRATION.json] [--json]"],
  ["script check", "script check <script.txt|storyboard.json|NARRATION.json|SCRIPT.json> [--duration <seconds>] [--brief <file>]... [--format short-form|long-form|explainer|data-explainer|story|promo] [--goal reach|convert] [--awareness unaware|problem|solution|product|most] [--product <name>] [--cta \"...\"] [--audience consumer|b2b] [--json]"],
  ["cutdown", "cutdown <project> --to shorts [--section <id>] [--max 58] [--out <dir>] [--model provider:model] [--force]"],
  ["export", "export <project> --format fcpxml|premiere|edl|otio|all [--overlays prores4444|png|none] [--out exports/] [--fps 24|25|29.97|30|60] [--name name] [--absolute] [--force] [--json]"],
  ["sfx seed", "sfx seed [--provider elevenlabs|synth] [--variants 3] [--only whoosh,impact | --missing] [--reroll typing] [--dir .launchclip/sfx] [--force]"],
  ["sfx reroll", "sfx reroll <family> [--dir .launchclip/sfx]"],
  ["sfx list", "sfx list [--dir .launchclip/sfx]"],
  ["sfx audition", "sfx audition <family> [--dir .launchclip/sfx] [--out audition.wav] [--gap 0.35]"],
  ["init", "init <repo> --out <workspace>"],
  ["demo", "demo <repo> --out <workspace> --demo-cmd \"npm run smoke\" --capture terminal [--demo-media path/to/screenshot.png]"],
  ["demo record", "demo record <repo> [--out assets/demo] [--plan DEMO-PLAN.json] [--start \"npm run dev\"] [--url http://localhost:3000] [--seed \"npm run seed\" | --no-seed] [--no-start] [--approve] [--allow-host staging.example.com] [--flows a,b] [--plan-only] [--prompt \"...\"] [--model provider:model] [--viewport 4k] [--headed]"],
  ["demo doctor", "demo doctor <repo> [--plan demo/DEMO-PLAN.json] [--json] [--url http://localhost:3000] [--start \"npm run dev\"] [--seed \"npm run seed\" | --no-seed] [--no-start] [--approve] [--flows a,b] [--out .launchclip/doctor] [--step-timeout 5000] [--allow-host staging.example.com] [--headed]"],
  ["demo shots", "demo shots <docs-dir-or-file> [--draft demo/DEMO-PLAN.json] [--url http://localhost:3000]"],
  ["demo approve", "demo approve <dir> [--flows a,b] [--reject]"],
  ["demo scene", "demo scene <dir> [--flow <id>] [--source-start 0.5] [--duration 8] [--src assets/demo/<flow>.mp4] [--frame window|full]"],
  ["plan", "plan <workspace> --format short-15 --renderer none|hyperframes [--style proof-card|ugc-split|ugc-demo-punchy|premium-product-short|data-story-benchmark] [--assets-dir path/to/assets] [--talking-head heygen --avatar-id avatar_123]"],
  ["captions", "captions <workspace> --platforms x,linkedin,tiktok,bluesky"],
  ["render", "render <workspace> --provider product-videogen --dry-run"],
  ["render", "render <workspace> --provider hyperframes [--quality high] [--strict-all] [--inspect-samples 15] [--skip-quality-gates] [--voiceover local-say|elevenlabs] [--music elevenlabs]"],
  ["render", "render <workspace> --provider remotion [--assets-dir path/to/assets] [--voiceover local-say|elevenlabs]"],
  ["render", "render <workspace> --provider local-ffmpeg [--voiceover local-say|elevenlabs]"],
  ["analyze-render", "analyze-render <workspace> [--video video/launchclip-hyperframes.mp4]"],
  ["submit-review", "submit-review <workspace> --provider product-videogen --dry-run"],
  ["review", "review <workspace>"],
  ["validate", "validate <workspace>"],
  ["run", "run <repo> --out <workspace> --demo-cmd \"npm run smoke\" --demo-media path/to/demo.mp4 --angle \"...\" --audience \"...\" [--style premium-product-short --assets-dir path/to/assets --talking-head heygen]"],
  ["script", "script <workspace> [--wpm 150]", {comment: "teleprompter from the planned voiceover", section: "talking-head"}],
  ["align", "align <workspace> --media take.mp4", {comment: "whisper word timings + heuristic motion timeline", section: "talking-head"}],
  ["align", "align <workspace> --media take.mp4 --words words.json", {section: "talking-head"}],
  ["motion-render", "motion-render <workspace>", {comment: "render video/motion.mp4 via the motion engine", section: "talking-head"}],
  ["music", "music <workspace> [--prompt \"...\"] [--duration 18] [--output music/bed.mp3] [--music-model music_v1] [--force]", {section: "talking-head"}],
  ["preprocess-presenter", "preprocess-presenter public/base/presenter.mp4 [--out public/base/presenter-prepped.mp4] [--speed 1.08] [--crop-x center]", {section: "talking-head"}],
  ["direct", "direct <workspace> --voice record --prompt \"creative direction\"", {comment: "writes script + teleprompter, waits for take", section: "talking-head"}],
  ["direct", "direct <workspace> --voice record --take take.mp4 [--words w.json]", {comment: "aligns take, directs, renders", section: "talking-head"}],
  ["direct", "direct <workspace> --voice tts --prompt \"creative direction\"", {comment: "generates voice + timings, directs, renders", section: "talking-head"}],
  ["direct", "direct <workspace> --prompt \"creative direction\" [--format software_demo|explainer]", {section: "talking-head"}],
  ["direct", "[--words w.json --take base/take.mp4 | --script-text \"...\"] [--duration 45] [--no-render] [--quality fast|high]", {continuation: true, section: "talking-head"}],
  ["direct", "[--music-prompt \"...\"] [--no-music] [--sfx-dir path/to/sfx] [--allow-placeholder-sfx]", {continuation: true, section: "talking-head"}],
  ["direct", "[--provider anthropic|openai] [--model <id>]", {continuation: true, comment: "LLM: ANTHROPIC_API_KEY (default) or OPENAI_API_KEY", section: "talking-head"}],
]);

// One line per command (and per group action) for `launchclip <command> --help`.
export const SUMMARIES = Object.freeze({
  "--version": "Print the LaunchClip version.",
  doctor: "Check the host: Node, FFmpeg, browsers, renderers and provider keys (presence only).",
  skills: "List, locate or install the bundled agent skills.",
  "skills list": "List the bundled agent skills.",
  "skills path": "Print the path of a bundled skill.",
  "skills install": "Install the bundled skills for Codex or Claude.",
  style: "Create, save, list, show, upgrade, check, generate, reroll or keep project style packs.",
  "style create": "Create a style pack from a video, a style directory or reference media.",
  "style save": "Save a style pack from a video or style directory.",
  "style list": "List project and built-in style packs.",
  "style show": "Show a style pack (upgraded in memory when it is v1).",
  "style upgrade": "Upgrade a v1 or v2 style pack to v3 on disk.",
  "style check": "Check a rendered project against a style pack.",
  "style generate": "Generate a style pack from a seed (a random one unless --seed), inside art-direction constraints.",
  "style reroll": "Give a project with a generated style a new seed (its constraints kept); --undo goes back once.",
  "style keep": "Copy a project's generated style to ~/.launchclip/styles/<name> as a personal style.",
  profile: "List, show or measure cadence profiles: what a strong video of one format measures like (coverage, face time, pacing, motion), as ranges the planner plans to and the gates check.",
  "profile list": "List the shipped cadence profiles with their format, aspects, duration range and provenance (seed or measured).",
  "profile show": "Show one cadence profile (a shipped id or a profile file), validated.",
  "profile measure": "Measure a folder of reference videos into a cadence profile. Only statistics are kept, never frames, audio or text; --rights says what right you have to analyse them. --replace writes over a shipped profile and refreshes kit/profiles/PROVENANCE.md.",
  cast: "Browse the built-in character cast and a story's cast; render a story's cast sheet.",
  "cast list": "List the starter characters, and the story's cast when given a project.",
  "cast show": "Show one character's rig params, colours and voice.",
  "cast sheet": "Render every character in every pose and expression the story uses to qa/cast-sheet.png.",
  intake: "Write a production workspace from a source (repository, product, topic or voiceover).",
  "edit-recording": "Edit a raw recording: trim silence, drop retakes and fillers, QA the joins, then clean up the voice audio (--enhance light by default; --voice-isolation elevenlabs is opt-in and paid).",
  "broll-plan": "Plan b-roll inserts from a word-timed transcript.",
  produce: "Run the model-directed production lane end to end.",
  evidence: "Collect evidence for a production workspace.",
  "source-preprocess": "Preprocess the workspace's source media.",
  "source-media": "Sample and describe the workspace's source media.",
  "resolve-entities": "Resolve brand entities and logos for the workspace.",
  "concept-tournament": "Generate and judge concepts for the workspace.",
  "retention-story": "Write and edit the retention story.",
  "cinematic-narration": "Generate the cinematic narration.",
  "creative-plan": "Write the creative plan.",
  "production-audio": "Generate voice, music and SFX for the workspace.",
  "direct-frames": "Author the frames for the creative plan.",
  assemble: "Assemble the production composition.",
  "production-verify": "Verify the assembled production.",
  "production-draft": "Render and critique a draft of the production.",
  "production-preview": "Open the production preview server.",
  review: "Review a workspace (production studio review, or the legacy packet review).",
  "production-critique": "Run the visual critic on the production draft.",
  "production-repair": "Repair the production from the critic's findings.",
  "production-render": "Render the approved production at final quality.",
  story: "Validate, resolve, compile or plan a storyboard.json.",
  "story validate": "Validate a storyboard.json (errors and warnings). In the footage-led, motion and voiceover-motion lanes it also requires DIRECTION.json when the story has narration words, checks it against the narration and the scenes, and reports coverage, face time and the longest undressed run against the cadence profile.",
  "story resolve": "Resolve a storyboard.json's time anchors to seconds.",
  "story compile": "Compile a story project for HyperFrames or Remotion.",
  "story long-form": "Give a long video its structure: chapters from DIRECTION.json's sections, an opening promise, a section card at each chapter start and a progress line with chapter ticks. Rewrites storyboard.json and DIRECTION.json; safe to run again.",
  "story plan": "Plan DIRECTION.json and then storyboard.json from a brief with a model: the direction map first (one call), then the storyboard against it and the cadence profile; the repair loop repairs both.",
  "cinematic-check": "Check a finished project against the cinematic gates and receipts.",
  "layout-check": "Check a storyboard's declared geometry: safe zone, collisions, caption band (at rest and through camera moves), text size.",
  module: "Fit one module's params to the frame.",
  "module fit": "Measure one module's params against the frame and report what fits.",
  "subject setup": "Download and verify the local person segmentation models the subject stage uses.",
  "subject probe": "Sample a recording and report whether one person can be cut out, and how they are framed.",
  "subject track": "Track the presenter's head and body through the whole recording, so placement and layout-check know where the face is outside the matted ranges.",
  "subject matte": "Cut the person out of one source range: a cached alpha WebM and per-frame head and body boxes.",
  finish: "Storyboard to mastered video in one command: voice, music, SFX, render, master and gates (layout, loudness, motion against the cadence profile, audio, temporal evidence, and the direction map, coverage and face gates). --prototype renders only the opening 20–30 s (cut at a sentence end) to renders/prototype.mp4, for review before the whole. --candidate renders a draft candidate with no paid calls (synth or no music, a cached or free voice, else the test voice; no evidence or gates) and records it in the rendered-candidate receipt. --chapter <id> re-renders one chapter's segments, stitches the master from the cache and writes the chapter alone to renders/chapters/<id>.mp4; finish also writes renders/chapters.txt and MP4 chapters for a story with chapters. A story with a cover gets video/cover.png, the designed thumbnail, and every finished video gets publish.json (see publish-manifest).",
  "publish-manifest": "Write publish.json next to the video: the title and title options (from SCRIPT.json, else the storyboard), a description, hashtags, the CTA, aspect, duration, the video, the designed cover and any .srt/.vtt captions, and whether it fits each platform (YouTube Shorts, TikTok, Reels, YouTube, LinkedIn, X; App Store and Product Hunt on request). --link attaches a URL; --utm tags it per platform (utm_source=<platform>, utm_medium=video, utm_campaign=<campaign>). finish and make write it after every finished video.",
  make: "Prompt plus an optional assets folder to a finished video, headless: classify the assets, route the lane deterministically, plan the script (format, goal and viewer awareness from --format/--goal/--awareness, else from the brief), write the script against that format's beats and the storyboard with an API model (repair loop), then finish and an optional vision critic. Writes MAKE.json with routing, costs, timings and gates. --repo runs demo autopilot first: it records the app's key flows into assets/demo and edits the approved ones in as product-demo scenes.",
  fx: "Put one module on a clip: a one-scene footage-led story around the whole clip, the presenter cut out when the module needs them, then finish. The project it writes (<video>.fx/ by default) is an ordinary story project you can keep editing.",
  voice: "Generate the narration (NARRATION.json and the voice track) for a project or a text.",
  cutdown: "Cut a Short from one section of a long video: a new 9:16 project (default <project>/cutdowns/<section>-shorts) that re-plans the section against the Shorts profile instead of cropping. It reuses the base edit, mattes and face track, maps word anchors into the section, opens on a hook card and loops back to it. Deterministic and free; --model re-plans with the planner (paid). Then run launchclip finish on it.",
  export: "Export an editable timeline for Final Cut Pro, Premiere Pro or Resolve.",
  sfx: "Seed, reroll, list or audition the user SFX library.",
  "sfx seed": "Seed the user SFX library (ElevenLabs, or the procedural kit with --provider synth). --missing fills only the families the library lacks (sfx list names them).",
  "sfx reroll": "Regenerate one SFX family.",
  "sfx list": "List the SFX libraries, what each family resolves to, and the families missing compared with the prompt set.",
  "sfx audition": "Write one audition file with every variant of a family.",
  init: "Initialise a packet workspace for a repository.",
  demo: "Capture a demo for the packet workspace, or record a SaaS app's product flows (demo record) and approve them for use (demo approve).",
  "demo doctor": "Check a demo recipe before recording. Without --plan it surveys the repo (start and seed commands, test accounts, auth, e2e mocks and sign-ins, MSW, API contracts, env vars, first-run flags, docs placeholders) and recommends a setup rung, running nothing. With --plan it starts the app (asks first, like record), then runs each flow at full speed with off-origin requests blocked: every step must resolve to a visible element, nothing may cover the page or sign it out, and API requests must be answered. Each check reports a fix; --json for agents; exit 1 on any failure.",
  "demo shots": "List the video and screenshot placeholders in docs ({/* video: … */}, <!-- video: … -->, shot-list tables); --draft writes or extends a DEMO-PLAN.json with one flow per video for the agent to fill in.",
  "demo record": "Demo autopilot: detect how the repo runs, seed it, start it, plan 2–4 flows (DEMO-PLAN.json) and record each in Chromium with an action log, then write contact sheets and REVIEW.md. Asks before running the seed and start commands unless --approve; local or staging URLs only unless --allow-host.",
  "demo approve": "Approve (or --reject) recorded demo flows after reviewing their contact sheets; only approved flows are used in a video.",
  "demo scene": "Print product-demo scene params for an approved flow (its action log turned into scene-relative actions, callouts and the clip window).",
  plan: "Plan the packet video.",
  captions: "Write social captions for the packet.",
  render: "Render the packet video.",
  "analyze-render": "Analyse a rendered packet video.",
  "submit-review": "Submit the packet for review.",
  validate: "Validate a packet workspace.",
  run: "Run the whole packet lane for a repository.",
  script: "Write a teleprompter script from the planned voiceover.",
  "script check": "Lint a voiceover script before anything renders. Errors (exit 1): more words than the duration can hold (2.75 a second), a number, quote, rating, user count or deadline that is not in the --brief, a greeting or filler opener or a hook over budget, no call to action or more than one, a call to action before the final quarter, a sentence over 25 words. Warnings: sentence length, reading grade, additive transitions, brand in the first sentence for cold audiences, unbacked superlatives, numbers per sentence and precision, an unanswered hook question, narration rate outside the format's band.",
  align: "Align a recorded take to word timings and a motion timeline.",
  "motion-render": "Render video/motion.mp4 with the motion engine.",
  music: "Generate a music bed for a workspace.",
  "preprocess-presenter": "Preprocess presenter footage (speed, crop).",
  direct: "Direct a talking-head or TTS video from a creative prompt."
});

export const USAGE_GROUPS = Object.freeze(["skills", "style", "profile", "cast", "story", "sfx", "module", "subject", "demo", "script"]);
const GROUPS = new Set(USAGE_GROUPS);
const COMMENT_COLUMN = 52;

function renderRow([, usage, options = {}]) {
  if (options.continuation) {
    const line = `            ${usage}`;
    return options.comment ? `${line}   # ${options.comment}` : line;
  }
  const line = `  launchclip ${usage}`;
  return options.comment ? `${line.padEnd(COMMENT_COLUMN)} # ${options.comment}` : line;
}

/** Every command name the table knows (top-level commands and group actions). */
export function usageNames() {
  return [...new Set(USAGE.map(([name]) => name))];
}

/** Rows for a command or "group action" (a group alone matches all its actions). */
export function usageRows(command, action = null) {
  const name = action && GROUPS.has(command) ? `${command} ${action}` : command;
  const exact = USAGE.filter(([row]) => row === name);
  const actions = USAGE.filter(([row]) => row.startsWith(`${command} `));
  // A group with its own bare row (demo) lists that row and its actions.
  if (exact.length) return GROUPS.has(command) && !action ? [...exact, ...actions] : exact;
  // An unknown action (`script <workspace> --help`) also shows the group's own row.
  return action ? [...USAGE.filter(([row]) => row === command), ...actions] : actions;
}

/** The top-level `launchclip --help` text. */
export function helpText() {
  const main = USAGE.filter(([, , options = {}]) => options.section !== "talking-head").map(renderRow);
  const talking = USAGE.filter(([, , options = {}]) => options.section === "talking-head").map(renderRow);
  return `launchclip creates dry-run-first OSS promotion packets.

Usage:
${main.join("\n")}

Talking-head motion workflow:
${talking.join("\n")}

Run launchclip <command> --help for one command's usage.
`;
}

/** `launchclip <command> [action] --help`, or null when the command is unknown. */
export function commandHelp(command, action = null) {
  const rows = usageRows(command, action);
  if (!rows.length) return null;
  const exact = action && GROUPS.has(command) && rows.every(([row]) => row === `${command} ${action}`);
  const name = exact ? `${command} ${action}` : command;
  const lines = ["Usage:", ...rows.map(renderRow)];
  if (SUMMARIES[name]) lines.push("", SUMMARIES[name]);
  if (!exact && GROUPS.has(command)) lines.push("", `Run launchclip ${command} <action> --help for one action.`);
  return `${lines.join("\n")}\n`;
}

/** True when the arguments after the command ask for help. */
export function wantsHelp(args) {
  return args.some((arg) => arg === "--help" || arg === "-h");
}

/** The generated "Command usage" Markdown for the CLI reference. */
export function usageMarkdown() {
  const out = ["<!-- Generated from src/cli_usage.js by npm run skills:sync; edit the table there. -->", "", "Every command answers `--help` or `-h` with its own usage (`launchclip finish --help`, `launchclip story validate --help`).", ""];
  for (const name of usageNames()) {
    if (name === "--version") continue;
    const rows = USAGE.filter(([row]) => row === name);
    out.push(`- \`${name}\`: ${SUMMARIES[name] ?? ""}`.trimEnd(), "", "  ```text", ...rows.map((row) => `  ${renderRow(row).trimStart()}`), "  ```", "");
  }
  return `${out.join("\n").trimEnd()}\n`;
}
