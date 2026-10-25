# LaunchClip CLI Reference

Use the installed CLI's `--help` as the final authority. This reference explains
the current workflow and the decisions an operating agent must not guess.

## Contents

- [Runtime and credentials](#runtime-and-credentials)
- [Bundled agent skills](#bundled-agent-skills)
- [Input flags](#input-flags)
- [Project-local style packs](#project-local-style-packs)
- [Model-directed production](#model-directed-production)
- [Resume and repair commands](#resume-and-repair-commands)
- [Layout check](#layout-check)
- [Workspace artifacts](#workspace-artifacts)
- [Studio review](#studio-review)
- [Final render](#final-render)
- [Cinematic check](#cinematic-check)
- [Local-first OSS packet lane](#local-first-oss-packet-lane)
- [Storyboard (storyboard.json)](#storyboard-storyboardjson)
- [Finish: storyboard to mastered video in one command](#finish-storyboard-to-mastered-video-in-one-command)
  - [The iteration loop: re-render one scene](#the-iteration-loop-re-render-one-scene)
  - [Sound effects](#sound-effects)
- [Make a video headlessly](#make-a-video-headlessly)
- [Export: an editable timeline for Final Cut Pro, Premiere Pro and Resolve](#export-an-editable-timeline-for-final-cut-pro-premiere-pro-and-resolve)

- [Voice providers](#voice-providers)
- [Failure handling](#failure-handling)
- [Command usage](#command-usage) (generated from the CLI usage table)

## Runtime and credentials

LaunchClip requires Node.js 22 or newer. Model-directed HyperFrames production
also requires FFmpeg/`ffprobe` and a working browser toolchain. Packaged CLI
commands invoke LaunchClip's pinned HyperFrames dependency rather than resolving
an unversioned tool through `npx`.

Start every new host check with:

```bash
launchclip doctor
```

Provider requirements:

| Capability | Requirement |
| --- | --- |
| creative plan and visual critic | `OPENAI_API_KEY` |
| cost-aware frame authoring and repair | `OPENAI_API_KEY`; Luna escalates to Terra/Sol only when needed |
| local-first frame authoring or repair | a running Ollama server; no model API key for the local attempt |
| OpenRouter frame authoring or repair | `OPENROUTER_API_KEY` |
| generated narration and music | `ELEVENLABS_API_KEY` plus `ELEVENLABS_VOICE_ID` or `--voice-id` for narration |
| ElevenLabs SFX library (`launchclip sfx seed`) | `ELEVENLABS_API_KEY`; without it the library seeds from the procedural kit |
| supplied voiceover without a transcript | `ELEVENLABS_API_KEY` for transcription |
| supplied voiceover with `--transcript` | no transcription call required |
| visual-only production | `--no-audio`; OpenAI model calls still occur |
| subscription-agent authoring without API keys | use `launchclip-create-video`, not this production lane |

Check presence without exposing values:

```bash
test -n "$OPENAI_API_KEY" && echo OPENAI_API_KEY=present || echo OPENAI_API_KEY=missing
test -n "$OPENROUTER_API_KEY" && echo OPENROUTER_API_KEY=present || echo OPENROUTER_API_KEY=missing
test -n "$ELEVENLABS_API_KEY" && echo ELEVENLABS_API_KEY=present || echo ELEVENLABS_API_KEY=missing
test -n "$ELEVENLABS_VOICE_ID" && echo ELEVENLABS_VOICE_ID=present || echo ELEVENLABS_VOICE_ID=missing
```

Packaged installs must receive an authorized SFX pack with `--sfx-dir` until
the repository pack's redistribution terms permit bundling it.

## Bundled agent skills

npm and Homebrew installs include `launchclip-create-video` (HyperFrames),
`launchclip-create-video-remotion` (Remotion, authored as `storyboard.json`) and
`launchclip-cli`. Inspect the installed copies without assuming a package-manager
layout:

```bash
launchclip skills list
launchclip skills path
launchclip skills path launchclip-create-video
```

Register all bundled skills with a local personal agent installation:

```bash
launchclip skills install --agent codex
launchclip skills install --agent claude
```

Use `--skill launchclip-create-video`, `--skill launchclip-create-video-remotion`
or `--skill launchclip-cli` to install one skill. Matching links are idempotent. Existing files, directories, and unrelated
links fail closed. If a package-manager upgrade leaves an older LaunchClip link,
repeat the command with `--force` to refresh that managed link.

Codex discovers the result in `$HOME/.agents/skills` and invokes the subscription
workflow as `$launchclip-create-video` (or `$launchclip-create-video-remotion`).
Claude Code discovers it in `$HOME/.claude/skills` and invokes it as
`/launchclip-create-video` (or `/launchclip-create-video-remotion`); symlinked
skills require Claude Code 2.1.203 or newer. These personal directories are local
and do not propagate into remote agent sessions.

## Input flags

The primary source may be a local/GitHub repository, product URL, topic or
research brief, local document/directory, or voiceover media. Override inference
with `--kind repository|product|topic|voiceover`.

Common intake flags:

- `--prompt`: angle, narrative priority, or creative direction
- `--audience`: intended viewer
- `--cta`: intended next action
- `--resource`: supporting file, directory, or URL; repeat as needed
- `--assets`: intent-revealing alias for supporting assets; files or directories
- `--reference`: authorized pacing/editorial reference; repeat as needed
- `--voiceover`: authoritative narration audio or video
- `--transcript`: transcript for supplied narration
- `--presenter`: authorized presenter/avatar video
- `--heygen-avatar`: one downloaded, authorized HeyGen video that replaces both
  `--voiceover` and `--presenter`; this does not call the HeyGen API
- `--style auto|<family>|<pack-name>|<pack-path>`, `--style-file`,
  `--style-reference`, `--style-root`
- `--aspect 9:16|16:9|1:1`, `--duration <seconds>`, `--language <code>`
- `--profile standard|cinematic`; use `cinematic` for the highest one-shot
  craft floor in portrait or landscape
- `--out <workspace>`

Resource directories are expanded into checksummed files. Hidden files and
`node_modules` are ignored. An optional `assets.json` may annotate individual
asset usage, entities, tags, priority, and license.

## Project-local style packs

Reusable styles belong to the user and default to
`.launchclip/styles/<name>`. LaunchClip has no built-in channel-style registry.
Create a pack only from an existing video project or style directory:

```bash
launchclip style create ai-news --from .launchclip/agent-ai-story
launchclip style list
launchclip style show ai-news
```

`style save` is an alias for `style create`. Neither command invents a design,
and neither overwrites an existing pack unless `--force` is explicit. Use
`--root <directory>` on style-management commands or `--style-root <directory>`
on intake/production to override the default location.

The pack freezes `frame.md` plus an available caption skin, local fonts, audio
notes, and style assets. Resolution priority is an explicit `--style-file`,
then a matching pack name or directory passed to `--style`, then the existing
free-form style-family behavior. This keeps old commands compatible. Commit
`.launchclip/styles/**` when the channel identity should travel with the
project; other `.launchclip` workspaces remain generated output.

### Style pack v2 (storyboards)

A v2 pack is `.launchclip/styles/<name>/style.json` with
`"schema": "launchclip.style.v2"`: palette and bundled fonts, motion grammar,
camera, ambient level, caption preset and options, SFX density and music hints,
preferred/avoided modules and per-module param defaults, layout rules, an
optional intro/outro and loop. A storyboard selects it with
`"style": "<name>"`, `"style": "./path/style.json"` or
`"style": {"name": "<name>", "intro": true, "outro": true}`. Names resolve in
`<project>/.launchclip/styles`, then `~/.launchclip/styles` (or
`$LAUNCHCLIP_HOME/styles`), then the built-in starters: `editorial-dark`,
`bold-creator`, `minimal-tech`, `warm-documentary`, `neon-explainer`. The pack
is merged before validation in every command that reads a storyboard (story
validate/resolve/compile, layout-check, finish, both renderer adapters,
cinematic-check and the renderer eval); explicit storyboard values always win.

```bash
launchclip style list                       # project packs and built-in starters
launchclip style show bold-creator          # the resolved v2 pack
launchclip style upgrade ai-news            # v1 (frame.md) → style.json v2, keeps style.v1.json
launchclip style create my-channel --from-reference old-1.mp4 old-2.mp4 [--from-images thumb.png] [--font-hint "Bebas Neue, Inter"] [--force]
launchclip style check <project> --against my-channel [--video renders/final.mp4] [--out qa/style-check.json]
```

`style create --from-reference` measures the references locally (no model
calls): palette by k-means with contrast-checked roles, pacing from cuts and
structural scene boundaries, activity for the ambient level, approximate caption
position/size/highlight, loudness and transients for sound, and the nearest
bundled font families. It writes `style.json` and `reference-report.md` (each
value with a confidence). Reference media is never copied into the pack. `style
check` measures a render the same way and reports drift (palette distance,
median shot, cut rate, activity, loudness) against the pack's
`reference_stats`, or against its palette and grammar when it has none.

## Model-directed production

Model policies:

- `cost-aware` (default): Terra/high planning, Luna/medium frames and patches,
  then Terra/high and Sol/high only for failed scenes.
- `local-first`: prepend `ollama:qwen2.5-coder:latest@none` to frame and repair
  routes while retaining the cloud escalation ladder.
- `quality`: retain Sol-first authoring and repair.
- `free`: rank and live-probe explicit OpenRouter `:free` frame models, then
  author each shot through a compact LLM blueprint and a second LLM
  implementation request. Independent shots run fail-closed with up to three
  concurrent lanes by default. Lower `--free-scene-concurrency` when a free
  endpoint returns rate limits; do not increase it merely to retry faster.

`--profile cinematic` is the premium, source-agnostic one-shot lane. When no
explicit model policy is supplied it selects `quality`, generates five distinct
concepts, judges them independently, writes and independently edits a retention
story, produces/measures narration before final edit planning, requires scene
blueprints, renders two independent frame candidates for the opening and one
highest-value proof, payoff, or continuity shot, then selects from their actual
pixel lifecycles with a fresh vision judge. It disables deterministic frame
fallback and allows up to three bounded repair passes. It also requires the
concept, story, narration, plan, frames, motion, audio, verification, and critic
receipts before readiness.
Do not add `--model-policy cost-aware` to a cinematic example unless that
quality tradeoff is intentional. Do not pair `--fast-eval` with a claim of
maximum one-shot quality.

The cinematic defaults are `--rendered-candidates 2` and
`--rendered-candidate-shots 2`. Tune them only when intentionally changing the
cost/quality tradeoff. Pin the fresh visual selector with
`--candidate-judge-route`, `--candidate-judge-reasoning`, and
`--candidate-judge-max-output-tokens`. A cinematic run requires both candidates
to pass mounted-pixel verification before selection and preserves the scorecard
under `production/qa/candidate-selection/<shot-id>/selection.json`. Standard
production keeps one frame candidate unless explicitly overridden.

Pin one or more routes with repeatable
`--frame-route provider:model@reasoning` and
`--repair-route provider:model@reasoning`. Pin the independent visual critic to
one route with `--critic-route provider:model@reasoning`. Supported providers are `openai`,
`openrouter`, `ollama`, and `compatible`; the generic compatible provider reads
`OPENAI_COMPATIBLE_BASE_URL` and `OPENAI_COMPATIBLE_API_KEY`. An explicit
single local route prevents an unapproved cloud fallback:

```bash
launchclip production-repair <workspace> \
  --repair-route ollama:qwen2.5-coder:latest@none \
  --repair-issues-per-shot 4 \
  --max-patch-ratio 0.35
```

For a no-maintenance free review lane, use OpenRouter's dynamic free router for
both the critic and repair stages:

```bash
launchclip review <workspace> \
  --critic-route openrouter:openrouter/free@none \
  --repair-route openrouter:openrouter/free@none
```

The critic accepts one route so a final verdict never silently falls through a
provider ladder. OpenRouter chooses an eligible free model at request time and
the receipt records the concrete model it selected.

Repair batches contain at most four blocking findings per shot, prioritized by
runtime, motion, text/layout, then contrast. Lower
`--repair-issues-per-shot` when a local model needs a smaller coherent fix.

Local routes call Ollama's native JSON-schema endpoint with temperature `0`, a
fixed seed, and a 32K context. Set `OLLAMA_CONTEXT_LENGTH` to override the
allocation. Keep the context large enough for the complete frame source and QA
findings; reducing it may speed prompt evaluation but can truncate the exact
source strings needed by a repair.

Repairs return exact find/replace edits against the current HTML or structured
frame fields. A find string must occur once, the default patch may touch at
most 35% of its targets, and the result must pass the complete frame contract.
When a patch fails, LaunchClip feeds the exact error to the next bounded attempt
instead of requesting a complete replacement frame.

Repository example:

```bash
launchclip produce https://github.com/owner/repo \
  --profile cinematic \
  --out .launchclip/repo-video \
  --prompt "Lead with the workflow change" \
  --audience "developers" \
  --aspect 9:16 \
  --duration 45 \
  --voice-id "$ELEVENLABS_VOICE_ID"
```

Visual-only lower-budget evaluation:

```bash
launchclip produce ./brief.md \
  --kind topic \
  --resource ./research \
  --out .launchclip/topic-fast-eval \
  --aspect 16:9 \
  --no-audio \
  --fast-eval
```

Presenter/authoritative narration example:

```bash
launchclip produce "Product workflow" \
  --profile cinematic \
  --voiceover ./presenter-take.mp4 \
  --transcript ./presenter-take.txt \
  --presenter ./presenter-take.mp4 \
  --assets ./brand-assets \
  --prompt "Keep the presenter visible around the evidence" \
  --aspect 16:9 \
  --out .launchclip/presenter-video
```

Downloaded HeyGen avatar shorthand:

```bash
launchclip produce ./brief.md \
  --profile cinematic \
  --heygen-avatar ./heygen-avatar.mp4 \
  --transcript ./heygen-avatar.txt \
  --assets ./brand-assets \
  --out .launchclip/heygen-presenter
```

The avatar's audio becomes authoritative narration and the same video is
mounted as the beat-positioned presenter. The primary source remains available
for evidence. `--heygen-avatar` is mutually exclusive with explicit
`--voiceover` and `--presenter` flags.

For work at or above 180 seconds, planning defaults to a hierarchical outline
and concurrent chapter expansion. Override explicitly with
`--planning-mode single|hierarchical` and tune `--chapter-concurrency` only when
needed.

`produce` performs, in order:

1. intake and source preprocessing
2. evidence collection and source-media analysis
3. reusable entity/brand resolution
4. for cinematic work, a five-way concept tournament
5. for cinematic work, retention-story writing and fresh-context editing
6. for cinematic work, narration production plus measured word/beat timing
7. final creative/edit planning against the approved story and measured take
8. audio production or a no-audio manifest
9. blueprint-led direct frame authoring
10. HyperFrames assembly
11. verification, draft render, motion/audio analysis, and independent critique
12. typed readiness repair, up to three passes for cinematic work or two for
    standard work

It returns `awaiting-approval` for cinematic work only when native verification,
motion, audio, critic, zero-fallback, and every creative-receipt gate pass. A
critic `ship` verdict alone is insufficient. It does not create the final
render or guarantee view count.

## Resume and repair commands

Every production stage is independently rerunnable against the same workspace:

```bash
launchclip source-preprocess <workspace>
launchclip evidence <workspace>
launchclip source-media <workspace>
launchclip resolve-entities <workspace>
launchclip concept-tournament <workspace>
launchclip retention-story <workspace>
launchclip cinematic-narration <workspace>
launchclip creative-plan <workspace>
launchclip production-audio <workspace>
launchclip direct-frames <workspace>
launchclip assemble <workspace>
launchclip production-verify <workspace>
launchclip production-draft <workspace>
launchclip production-preview <workspace>
launchclip production-critique <workspace>
launchclip production-repair <workspace>
```

Use the earliest failed or intentionally changed stage. Downstream receipts are
content-addressed and will be regenerated when their inputs change.

After manually editing only the assembled HyperFrames project, rerun:

```bash
launchclip production-draft <workspace>
```

That re-verifies, re-encodes, analyzes, and critiques the existing assembly
without repeating intake, evidence, planning, frame generation, or audio.

Infrastructure verification failures must be fixed in the local toolchain.
Only use `production-repair` for scoped creative/structural findings.

## Layout check

For a `storyboard.json` project (HyperFrames or Remotion), check the declared
geometry before rendering:

```bash
launchclip layout-check <story-project> [--profile shorts|landscape] [--json]
```

The command resolves `storyboard.json` (with `NARRATION.json` and `BEATS.json` when
present), builds each editorial scene through `editorial-ui-modules.mjs` to get
its rect and motion windows, and uses `scene.params.rect` (plus optional
`params.role`, `params.minTextPx`, `params.allowOcclusion`) for other modules.
Scenes without geometry are skipped with a note. A `captions` overlay becomes
the delivery caption band. The profile defaults to `shorts` for portrait
canvases and `landscape` otherwise.

Errors (status `failed`): `safe-zone` (text or hero outside the safe zone at
rest; Shorts y 280–1450, x 80–940 on 1080×1920, landscape 5% title-safe),
`collision` (non-decor elements overlapping at rest unless `allowOcclusion`
names the pair), `caption-band` (text or hero in the caption band while
captions show, unless the scene sets `hides_captions`), `min-text-size` (key
text under 44 px on Shorts), and `module-spec` (an editorial spec that does not
build). Warnings: `hero-fill` (hero outside 70–90% of the safe width on
Shorts), `lower-third-empty` (nothing below the safe-zone midpoint for over
3 s on Shorts), `centre-of-mass` (sustained drift from y 860 on Shorts), and
`empty-plate` (a span where no scene draws anything: a gap in scene timing, or a
scene whose first content arrives after the previous scene has gone; spans
under 0.5 s are covered by holding the previous scene, so only longer ones are
reported). `story validate` also warns about gaps in scene timing.

Whether content fits a rect depends on the rect's width (text wraps, and
editorial type follows the width), so a `module-spec` sizing error names the
size that fits: "checklist needs 566 px height at width 900 (or width ≤ 670 at
this height)". To size a rect before authoring it:

```bash
launchclip module fit <module> [--params params.json] [--aspect 16:9|9:16] [--story storyboard.json] [--brand brand.json] [--duration 4] [--json]
```

`--params` is the scene's params object. Without `params.rect` it prints the
content's natural size and the rect the module derives; with one, whether it
fits, the minimum height at its width and the nearest width that fits its
height. Either way it lists the minimum height at common widths.
`--story` borrows a storyboard's brand and format; catalogue modules otherwise
use a neutral brand.

Without `--json` the command prints a one-line-per-finding summary. It checks
declarations only; confirm contrast (3:1 minimum) and a filled lower third on
rendered stills as well. On HyperFrames, keep running `hyperframes check` too.

## Workspace artifacts

Important model-directed paths:

```text
<workspace>/
  production/
    intake.json
    evidence.json
    concepts.json
    storyboard.json
    plan.json
    SCRIPT.md
    STORYBOARD.md
    frames/
      .blueprints/
    hyperframes/
      index.html
      assembly.json
    media/
      cinematic-narration.json
      manifest.json
    qa/
      verification.json
      motion.json
      audio.json
      snapshots/
      critique.json
      cinematic-readiness.json
    renders/
```

Each CLI response includes a `costs` summary based on observed provider calls.
Treat `costs.complete: false` as an incomplete estimate and report its warnings.
`--fast-eval` reduces budgets and repair passes but is not a zero-cost mode.
`--max-frame-cost-usd` guards cumulative direct-frame responses only.

## Studio review

After the draft is ready, the critic verdict is `ship`, and cinematic readiness
is `ok: true` when applicable, open the assembled project in the editable
HyperFrames Studio:

```bash
launchclip production-preview <workspace> [--port 3002] [--no-open]
```

The command starts or reuses the local Studio server, returns its project URL,
and exits with status `awaiting-approval`. Use `--no-open` for an agent or
headless host that should return the URL without opening a browser.

Studio's Export control creates an ad hoc HyperFrames render in the composition
project. It is not a LaunchClip approval signal or final artifact: it bypasses
LaunchClip's stable output path, final motion/audio analysis, critic result, and
stage receipt. Obtain explicit approval through the user interaction, then use
the final-render command below. If Studio edits are repaired after approval,
open the changed state for review again.

## Final render

After the user reviews the Studio state and explicitly approves:

```bash
launchclip production-render <workspace> --approve --quality high
```

The final command reruns the current verification and output analysis. Do not
override a missing or failed cinematic readiness receipt.

Do not reuse `--approve` as blanket permission to publish or upload.

## Cinematic check

`cinematic-check` gates a subscription-authored project and its encoded draft:

```bash
launchclip cinematic-check <project> [--renderer hyperframes|remotion] \
  [--video renders/draft.mp4] [--expect-audio]
```

- `--renderer` picks the adapter that verifies the project. Without it,
  LaunchClip uses `remotion` when the project has `storyboard.json` and no
  `index.html`, and `hyperframes` otherwise.
- `hyperframes` runs `hyperframes lint --json` and
  `hyperframes check --json --strict --snapshots --at-transitions`.
- `remotion` resolves `storyboard.json` into `.launchclip/story.resolved.json`,
  runs `remotion compositions` to prove the story bundles, then the geometric
  layout check when the kit provides one.
- When `storyboard.json` exists, the duration, size and declared transition
  boundaries come from it; otherwise they come from the `index.html` root.
  A story opts into the phase-2 evidence contract with `"phase": 2` or
  `"cinematic_contract": "phase-2"`.
- Temporal evidence names the renderer's still source `browser-still`.
  Manifests that still say `hyperframes` remain valid.

## Local-first OSS packet lane

For an OSS promotion packet with deterministic captions and review artifacts:

```bash
launchclip run ./my-oss-tool \
  --out .launchclip/my-oss-tool \
  --demo-cmd "npm run smoke" \
  --demo-media ./demo/screenshot.png \
  --angle "Show the verified workflow improvement" \
  --audience "developers shipping OSS"
```

Obtain approval before executing `--demo-cmd`; inspect the command receipt and
redacted terminal output afterward. Validate and consolidate the packet:

```bash
launchclip validate .launchclip/my-oss-tool
launchclip review .launchclip/my-oss-tool
```

Local render options include `remotion`, `hyperframes`, and `local-ffmpeg`.
Keep product-videogen and Review Feed operations in `--dry-run` unless the user
explicitly authorizes a supported live integration.

## Storyboard (storyboard.json)

`storyboard.json` (`launchclip.story.v1`) is the renderer-agnostic storyboard. Check
it and resolve its time anchors before compiling or rendering:

```bash
launchclip story validate storyboard.json [--narration NARRATION.json] [--beats BEATS.json] [--out report.json]
launchclip story resolve storyboard.json [--narration NARRATION.json] [--beats BEATS.json] [--out .launchclip/story.resolved.json]
```

`validate` reports every error with its path (for example `scenes[2].in.type`)
and exits successfully with `status: "failed"` when the story is invalid; read
the status, not the exit code. When narration or beats are available it also
resolves the anchors and prints the derived transition boundaries. `resolve`
fails on an invalid story or an unknown anchor, and writes the resolved copy
(anchors replaced by seconds, scenes sorted by start, plus `resolved`) to
`--out`. Without `--narration`, `audio.words` is read relative to the story
file when it exists.

Anchors are seconds, `word:<text>[#n]` (case-insensitive, punctuation ignored;
`word:thirty-five` also matches "thirty" "five"; `#n` is the 1-based
occurrence), `beat:<n>` or `downbeat:<n>` (0-based, from `BEATS.json`), each
with an optional offset such as `word:fast+0.1`. A golden example lives in
`examples/story/cooling.story.json`; a minimal two-scene project that renders
in both renderers lives in `examples/story/minimal/`.

`validate` also checks every `module` against the kit's module registry
(`kit/core/modules.mjs`: the 14 editorial kinds plus the catalogue). An
unknown module is reported as a warning, because both compilers render it as
a visible labelled placeholder rather than failing. Once anchors resolve, each
known module's `params` are resolved too (the step both compilers take); a
scene whose params the module rejects (for example a hit earlier than the
module's minimum lead-in) is an error, because it would render as a
placeholder in both renderers.

### Compile a storyboard for a renderer

```bash
launchclip story compile <project> --renderer hyperframes [--out <dir>]
launchclip story compile <project> --renderer remotion
```

`<project>` is the directory holding `storyboard.json` (or the file itself).
Anchors are resolved against `NARRATION.json` and `BEATS.json` when present.

Captions are one overlay: `{"type": "captions", "preset": "<name>", ...options}`
(or the legacy `"style": "word-highlight" | "line" | "none"`; `line` draws the
`minimal-line` preset). Presets: `word-highlight` (default), `karaoke-fill`,
`pop-word`, `bounce`, `typewriter`, `box-highlight`, `underline-sweep`,
`kinetic-stack`, `minimal-line`, `glow`, `outline-heavy`, `split-color`,
`lower-band`, `bubble`. Options: `position` (bottom|middle|top|auto),
`max_words`, `max_chars`, `case` (as-is|upper|title), `emphasis` ("auto", "none"
or a word list) and `keywords`, `font` (display|body|meta), `size` (scale),
`colors` (brand roles or hex: idle, active, spoken, accent, box, boxText, plate,
band, bandEdge, chip), `stroke`, `shadow`, `entrance`
(pop|fade|slide-up|slide-left|scale|none), `exit`
(fade-up|fade|slide-down|shrink|none) and `offset` (seconds). Both renderers
draw the same plan.

- `--renderer hyperframes` writes a complete HyperFrames project (default
  `<project>/hyperframes/`): `index.html` with one paused GSAP timeline, every
  scene's module, typed transitions, the phase-2 boundary attributes, one root
  `<audio>` from `audio.mix` (or `audio.voice`), word captions and the loop
  ending, plus a copy of `assets/`. Render it with
  `npx hyperframes render <dir>` or the HyperFrames renderer adapter. It is a
  separate directory on purpose: a project root with both `storyboard.json`
  and `index.html` is treated as HyperFrames everywhere else.
- `--renderer remotion` writes `<project>/.launchclip/story.resolved.json` (the
  `LaunchclipStory` props) and verifies the bundle with
  `remotion compositions`; `--out` names a different props file.

The JSON result lists `files`, `warnings` (placeholders for unknown modules,
missing audio, captions skipped) and the derived `boundaries`. An invalid
story fails the command.

### Plan a storyboard from a brief

```bash
launchclip story plan --brief brief.md [--narration NARRATION.json] \
  [--tier structured|guided|bespoke] [--model provider:model] [--out storyboard.json] \
  [--base assets/recording.mp4] [--voice assets/audio/narration.wav] \
  [--format 1080x1920|shorts|landscape|square] [--fps 30] [--duration seconds] \
  [--brand brand.json] [--style name|path] [--max-repairs 2]
```

One model call authors `storyboard.json` from the brief, with the planning
prompt generated from the module registry (`kit/core/planning-prompt.mjs`;
the same text ships to the create-video skills as
`references/storyboard-modules.md`). Tooling then pins the fixed inputs
(lane, format, brand, voice, words, base), places editorial modules without a
`rect` in the safe slot, and checks the result: the `story validate` rules
with the module registry, the tier rules, anchor resolution, every scene's
module params, and the layout check. On failure the exact errors go back to
the model for at most `--max-repairs` (default 2) corrected storyboards.
Repairs target scenes and params; the checks never relax.

- The lane follows the inputs: `--base` → `footage-led`, `--narration` →
  `voiceover-motion`, otherwise `motion`. `--lane` overrides it.
- `--tier structured` (default) allows catalogue modules and their content
  params only: no `rect`, `theme`, `accent`, `motion`, `presentation`, `track`
  or `custom`. `guided` adds those tuning params; `bespoke` adds `custom`
  modules.
- `--duration` defaults to the last narration word plus 0.6 s, or 30 s.
  `--brand` is a JSON file with `colors` and `fonts`.
- `--style <name|path>` plans for a style pack: the prompt carries its
  preferred and avoided modules, caption preset, grammar and sound density, the
  pack's brand becomes the fixed brand (unless `--brand` is given), the
  storyboard names the pack, and the checks run on the merged story.
- `--model` is `provider:model[@reasoning]`: `anthropic:<model-id>`
  (`ANTHROPIC_API_KEY`), `openai:<model>` (`OPENAI_API_KEY`),
  `openrouter:<vendor>/<model>` (`OPENROUTER_API_KEY`), `ollama:<model>`
  (local) or `compatible:<model>` (`OPENAI_COMPATIBLE_BASE_URL` and
  `OPENAI_COMPATIBLE_API_KEY`). Without `--model`,
  `LAUNCHCLIP_PLANNER_MODEL` is used; with neither the command fails.

On success it writes `--out` (default `storyboard.json`). Every run writes
`.launchclip/storyboard-plan.json` beside it with each attempt's errors,
warnings, layout findings, modules, tokens and estimated cost. When repairs
are exhausted the command fails, writes no storyboard, and keeps the last
candidate as `<out>.rejected.json`. Review the storyboard, then run
`story validate`, `layout-check` and `story compile` as usual.

## Finish: storyboard to mastered video in one command

```bash
launchclip finish <project> [--renderer remotion|hyperframes] [--quality draft|high] \
  [--voice kokoro|elevenlabs|supplied|test] [--music synth|elevenlabs|none] \
  [--out renders/final.mp4] [--sfx-library dir] [--sfx-density low|normal|high] \
  [--scene s3[,s4] | --preview-scene s3] [--force] [--json]
```

`finish` is the recommended way to turn a `storyboard.json` project into a
finished video. It runs these stages in order and stops at the first failure
(later stages are reported as `blocked`):

| Stage | What it does | Writes |
| --- | --- | --- |
| `voice` | When `audio.narration` (`{text, provider?, voice?, speed?}`) is set, synthesises it through the voice provider (`--voice` overrides `provider`; the default is `kokoro`). Skipped when `audio.voice` is a supplied file, unless `--voice` is given. | `assets/audio/narration.wav`, `NARRATION.json` |
| `validate` | Validates the story, resolves its anchors against the synthesised words, and runs the geometric layout check. Errors fail the run; warnings are reported. | `.launchclip/finish/storyboard.json`, `.launchclip/finish/story.resolved.json` |
| `captions` | Chunks the words into caption lines when a captions overlay has no `src`. | `assets/captions/captions.json` |
| `sound` | Binds a cue to every hit (`hit.cue`, else the named module event's cue, else a default from the event name) and to every module event that carries a `cue`, adds a whoosh under push, whip and zoom transitions, resolves each cue to a file through the SFX library (see [Sound effects](#sound-effects)), renders a typing track for typed code, resolves the music (see [Music](#music)): the procedural bed from scene `energy`, an ElevenLabs track generated (or reused from the cache) for the story, or a supplied file; analyses its beats, applies beat sync, and mixes everything with the music ducked under the voice. Skipped when the storyboard sets `audio.mix`. `audio.sfx: "none"` and `audio.music: "none"` (or `--music none`) turn the parts off. | `assets/audio/mix.wav`, `assets/audio/kit/`, `assets/audio/typing.wav`, `AUDIO-MANIFEST.json`, `qa/sfx.json`, `BEATS.json`, `qa/beat-sync.json`, `assets/audio/music.mp3` (ElevenLabs) |
| `render` | Renders the filled copy through the renderer adapter and the segment cache (see the iteration loop below): unchanged segments are reused and the summary reports how many were reused, rendered and the time saved. The default renderer is `remotion` when the project has no `index.html`, otherwise `hyperframes`; HyperFrames compiles to `.launchclip/finish/hyperframes/` first. | `.launchclip/finish/render-<quality>.mp4`, `.launchclip/finish/segments/` |
| `master` | Masters the render's audio to −14 LUFS and at most −1 dBTP, re-measured after encoding. | `renders/draft.mp4` (draft) or `renders/final.mp4` (high), or `--out` |
| `evidence` | Builds the phase-2 temporal evidence (browser stills plus encoded frames) and critic contact sheets. | `qa/temporal-evidence/`, `qa/critic-sheets/` |
| `gates` | Runs the renderer-neutral gates: layout, loudness, motion and audio analysis of the mastered MP4, and the temporal evidence manifest. The critic gate is reported as `pending`, with the next step. | `qa/finish/` |

The user's `storyboard.json` is never rewritten: the voice, words, captions and
mix are set on the copy in `.launchclip/finish/`. Each stage records the hashes
of its inputs and outputs in `.launchclip/finish-state.json` and is reported as
`cached` while they still match, so a second run after a fix only redoes the
affected stages. `--force` reruns everything.

The report is written to `<project>/finish.json` (per-stage status, timings,
outputs, gate results, warnings, next steps and the final path) and printed as
a short summary, or as JSON with `--json`. `status` is `ready-for-review` when
every gate that ran passed (the critic stays pending), `needs-repair` when a
gate failed, and `failed` (with a non-zero exit) when a stage failed.

The `test` voice writes a quiet tone with evenly spaced word timings, so the
whole pipeline can be exercised offline. Never ship it. The `kokoro`,
`elevenlabs` and `supplied` providers load from `src/voice/` and report
"provider not installed" when they are absent.

After finish, a fresh-context critic reviews `qa/critic-sheets/` and writes
`qa/critic.json`; `launchclip cinematic-check` then closes the critic gate.

### The iteration loop: re-render one scene

The render stage splits the timeline into segments where the set of layers on
screen changes: each scene's body is one segment and each transition overlap
(the incoming scene plus the outgoing scene held under it) is its own, so a
join never falls mid-transition. Every segment is hashed from what can change
its pixels: the scenes on screen in it (params, timing, transition tweens, a
morph's source scene, referenced asset files), the caption chunks and timed
overlays on screen in its window (a chunk that crosses a join counts for
both), the global settings (brand, format, lane and any other top-level field
such as a world camera or ambient drift: these touch every segment), the
fonts, a content hash of the kit sources that render, and the renderer.
Audio-only fields (`audio.mix`, `mix_volume`, `voice`, `music`, `sfx`) and the
title do not touch the picture. Segments live in
`.launchclip/finish/segments/<renderer>/<hash>.mp4`, so after an edit only
the segments whose hash changed render again: editing one scene's copy
re-renders its body and the two transitions that show it; editing a
transition re-renders the segments of both scenes it joins.

With Remotion, missing segments render by frame range through one bundle and
one browser as lossless H.264, join with an FFmpeg concat stream copy, and are
encoded once with the delivery settings `remotion render` uses; the soundtrack
is muxed once over the whole timeline. A partial render is frame-identical to
a fresh render of every segment. The HyperFrames CLI has no frame range, so
HyperFrames renders whole videos, cached by the hash of the whole timeline:
partial rendering is Remotion-only for now.

```bash
launchclip finish <project> --scene s3        # second pass on s3 (comma-separate several)
launchclip finish <project> --preview-scene s3 # just s3, to renders/scene-s3.mp4
```

`--scene s3[,s4]` forces those scenes' segments to re-render even when their
hash is unchanged, re-runs `master`, `evidence` (all samples: build-evidence
has no partial mode) and `gates`, and writes before/after stills of each scene
from the middle of its own segment to `qa/finish/scenes/` (`<id>-before.png`,
`<id>-after.png` and `<id>-before-after.png` side by side), listed in the
summary and in `finish.json` as `scene_stills`. Edits need no flag: an edited
scene's segments re-render on the next plain `finish`; `--scene` is for a
re-render the hashes cannot see and for the before/after check.

`--preview-scene s3` renders only the segments that show `s3` (reusing cached
ones and caching the new ones for the next full run) to
`renders/scene-s3.mp4` with its slice of the soundtrack, then stops: master,
evidence and gates are skipped, the final and the finish state are untouched,
and the report's `status` is `preview`. Unknown scene ids are an error.

### Music

`finish` picks the music in this order: `--music synth|elevenlabs|none`, then
`audio.music` in the storyboard, then ElevenLabs when `ELEVENLABS_API_KEY` is
set, else the procedural synth bed. `audio.music` accepts:

| Value | Music |
| --- | --- |
| absent | the default above |
| `"synth"` | the license-free procedural bed (`synth-audio-kit.mjs`): tempo, level and kick window follow scene `energy` |
| `"none"` | no music |
| `"assets/audio/song.mp3"` | a supplied track (its licence is yours to check) |
| `{provider, prompt?, bpm?, key?, file?, sync?, seed?, model?, volume?}` | `provider` is `"synth"`, `"elevenlabs"` or `"file"`; `sync` is `"auto"` (default), `"off"`, `"cuts"` or `"hits"` |

**ElevenLabs (paid).** `finish` prints a one-line notice that a paid API is in
use and where generations are cached, then calls `POST /v1/music`. Without a
`prompt` it sends a `music_v1` composition plan: global styles from the story
(tone from the title, notes and brand background, the target BPM, steady 4/4,
instrumental, and negative styles for vocals of any kind) and one section per
energy segment of the story (calm intro → build → payoff; sections shorter
than 3 s merge into a neighbour). With a `prompt` it sends that text plus the
tempo, the energy arc and "instrumental only, no vocals", with
`force_instrumental: true`. The track runs the story's length plus 2 s, so beat
sync can trim the start. The target BPM is `audio.music.bpm`, else the tempo
the energy implies (84–116). Every generation is cached by a hash of the
prompt or plan, length, model and seed under
`$LAUNCHCLIP_CACHE/elevenlabs/music` (default
`~/.cache/launchclip/elevenlabs/music`); a cached track is never generated
again, even without a key. The key is read from the environment, sent only in
the `xi-api-key` header, and never logged, cached or put in an error. Before
mixing, generated and supplied music is brought to −16 LUFS so the volume and
the voice-to-music margin behave like the synth bed. `--music elevenlabs`
without a key fails before anything is sent; `audio.music.provider:
"elevenlabs"` without a key falls back to the synth bed with a warning. Output
terms: see `THIRD_PARTY_NOTICES.md`.

**Beats.** The track's tempo, beat grid and downbeats are measured
(`src/music/beats.js`: FFmpeg decode, spectral-flux onsets, autocorrelation
with the requested BPM as a prior, a global grid fit) and written to
`BEATS.json` (`launchclip.beats.v1`, in story time), so `beat:n` and
`downbeat:n` anchors resolve against the real music. The synth bed's grid is
exact and needs no analysis. A `BEATS.json` you wrote yourself is never
overwritten; the music's grid then goes to `assets/audio/BEATS.json`.

**Beat sync.** The strategy follows the lane:

- **Narrated stories** (a voice, words or `audio.narration`): the narration
  timing is fixed, so the music moves. `finish` scores every start offset into
  the track (and tempo changes up to ±3% with FFmpeg `atempo`, kept only when
  they score at least 5% better) so downbeats land on the first cut after the
  hook, the payoff/CTA scene start, the other cuts and strong hits. No story
  time changes.
- **Motion stories** (no narration): the music is aligned the same way, then
  second-timed scene cuts snap to the nearest downbeat (or beat) and
  second-timed hits to the nearest beat, within 0.25 s. Every move is
  re-resolved, validated and checked against its module's params, and
  reverted when it breaks one; layout-check runs again on the result and a
  failure reverts all snaps.

Word-anchored times never move off their word, and beat anchors are on the
grid already. `sync: "cuts"` aligns and snaps cuts only, `"hits"` only hits,
`"off"` turns beat sync off. `qa/beat-sync.json` records the strategy, the
requested and measured BPM, the offset and tempo chosen, every key moment's
distance to the nearest downbeat and beat, and each change, fallback and skip.

### Environment and `.env`

At startup the CLI reads `.env` from the working directory and, for commands
that take a project or workspace directory (such as `finish`), from that
directory too. Variables already set in the shell always win, and a `.env`
never overrides them. It uses Node's `process.loadEnvFile` (with a small
fallback parser). Copy `.env.example` to start; `.env` is gitignored.

### Sound effects

```bash
launchclip sfx seed [--provider elevenlabs|synth] [--variants 3] [--only whoosh,impact] \
  [--reroll typing] [--dir .launchclip/sfx] [--force]
launchclip sfx reroll <family> [--dir .launchclip/sfx]
launchclip sfx list [--dir .launchclip/sfx]
launchclip sfx audition <family> [--dir .launchclip/sfx] [--out audition.wav] [--gap 0.35]
```

The SFX library is a locked set of processed WAV files per cue family,
described by `<dir>/library.json` (`launchclip.sfx-library.v1`). Families:
`whoosh`, `impact`, `riser`, `tick`, `pop`, `shimmer`, `subdrop`, `click`,
`keystroke`, `keystroke-space` and `keystroke-enter` (aliases: `typing` for
the three keystroke families, `ui` for click, tick and pop).

- **Seed once.** `sfx seed` fills every family the library does not have yet.
  With `ELEVENLABS_API_KEY` in the environment the default provider is
  `elevenlabs`: it runs the checked-in prompt set (`src/sfx/prompts.json`:
  per family a prompt, duration, prompt influence and variant count) through
  `POST /v1/sound-generation`. Without a key the default is `synth`, the
  original procedural kit (`synth-audio-kit.mjs`, local FFmpeg, no samples, no
  cost). A default ElevenLabs seed is 24 generations; `--variants N` changes
  the number per family and `--only` limits the families. The key is read from
  the process environment only; `.env` loading is handled separately by the
  CLI. It is never logged, written or included in an error.
- **Cache.** Every download is stored as `<dir>/cache/<request-hash>.mp3`. A
  cached request is never sent again, so `--force` (re-process everything)
  costs nothing, and it works without the key.
- **Post-processing** (`src/sfx/process.js`): 48 kHz WAV, DC removed, leading
  silence trimmed by onset detection so the transient starts within 5 ms, the
  tail trimmed against the noise floor with a short fade, a per-family length
  cap (keystroke 120 ms, tick 150 ms, whoosh 1.2 s), peak normalised to
  −3 dBFS. Silent and flat-top clipped clips are rejected; a single-hit family
  (impact, tick, pop, click, keystrokes) keeps the cleanest hit of a multi-hit
  clip, or rejects it. Each kept file records its onset, duration, peak, peak
  time, RMS and (from 0.4 s) integrated loudness. A family whose takes are all
  rejected falls back to the procedural kit, with a warning.
- **Locked.** Re-running `sfx seed` leaves seeded families alone.
  `--reroll <family>` (or `sfx reroll <family>`) replaces just that family
  with new generations; the family's `roll` number is part of the request
  hash.
- **Audition.** `sfx list` shows the libraries and where each family resolves;
  `sfx audition <family>` writes a contact WAV of every variant with short gaps
  (default `<dir>/audition/<family>.wav`).

`finish` resolves each cue family from the first source that has it: an
explicit library (`--sfx-library`, or a style pack's `sound.sfx_library`),
the project library (`<project>/.launchclip/sfx`), the user library
(`~/.launchclip/sfx`, or `$LAUNCHCLIP_SFX_HOME`), then the procedural kit. The
variant for each event is picked from a hash of the story id and the event, so
repeated cues vary while renders stay reproducible; a library riser is placed
so its measured peak lands on its moment. `--sfx-density low` drops about half
of the optional cues (module events, transitions, word ticks; hits always
stay) by a deterministic hash and caps typing at 15 keys per second; `high`
raises the typing cap to 30.

**Typing track.** For a `code-snippet` with `typing: true`, finish places one
keystroke on each character's visible time (`charTimes`), a space-bar key on
spaces and an enter key between typed lines, rotating variants without
immediate repeats, with seeded ±1.5 dB level and ±1.5 semitone pitch jitter,
and a cap of 25 keys per second (thinned deterministically). Modules that emit
`*-typing-start` events without `charTimes` get evenly spaced keys over the
typing window. Per-word reveals (`emphasis-caption` `word-<i>` events,
`archive-card` quote words) get a soft click. The track is rendered to
`assets/audio/typing.wav` and mixed as one input; `qa/sfx.json` lists every
keystroke.

## Make a video headlessly

```bash
launchclip make "<prompt>" [--assets <dir>] [--aspect 16:9|9:16|1:1] [--duration <seconds>] \
  [--style <name|path>] [--model provider:model] [--voice kokoro|elevenlabs] \
  [--music synth|elevenlabs|none] [--renderer remotion|hyperframes] [--quality draft|high] \
  [--out <project-dir>] [--replan] [--critic | --no-critic] [--max-repairs 4] [--json]
```

`make` is the headless equivalent of the create-video skills: one command from
a prompt and an optional folder of assets to a finished, mastered video. An
API model writes only the script and the storyboard; everything else is
deterministic tooling. The project lands in `--out` (default
`./launchclip-<slug>/`).

| Stage | What it does | Writes |
| --- | --- | --- |
| `model` | `--model`, else `LAUNCHCLIP_MAKE_MODEL`, else `openai:gpt-5.6-luna` when `OPENAI_API_KEY` is set, else `anthropic:claude-opus-4-8` when `ANTHROPIC_API_KEY` is set (the IDs the cost table prices). Reasoning defaults to `medium` (`provider:model@high` overrides). | |
| `inventory` | Classifies every file in `--assets` (below), probes durations and dimensions, transcribes speech with local Whisper, and links the files into `assets/`. Entries are reused while a file's size and mtime match. | `ASSETS.json`, `.launchclip/make/transcripts/` |
| `route` | Picks the lane deterministically (below). | `MAKE.json` `routing` |
| `prepare` | footage-led: the base edit (`edit-recording`: silences, bad takes, fillers, and audio enhancement when the build's `edit-recording` has an enhancement option, detected by feature check) → `assets/base-edit.mp4`, with its edited transcript as `NARRATION.json`. When the edit's QA asks for a semantic review (ambiguous joins, no detected defect), make uses the rendered candidate and reports a pending `base_edit_qa` gate with the issues; a QA failure falls back to the unedited recording. voiceover-motion: the supplied-voice prep (pauses tightened, levelled, word-timed) → `assets/audio/voiceover.wav`. motion: the script pass (narration sized to the duration at about 150 words a minute), a Kokoro take (cached in `.launchclip/voice`, shared with `launchclip voice` and finish), and one resize pass when the take misses the target by more than 15%. | `SCRIPT.json`, `NARRATION.json` |
| `storyboard` | `story plan`'s planner and repair loop (at most `--max-repairs`, default 4 here: a module reports its first param error, so each repair can surface the next one) with the brief, the narration, the word anchors, the style pack, and an asset manifest: the model may reference only the listed files, and any other `assets/` path is sent back as a repair error. Reused while its inputs hash the same; `--replan` forces a new one. | `storyboard.json`, `BRIEF.md`, `.launchclip/storyboard-plan.json` |
| `finish` | `launchclip finish` (voice, captions, sound, render, master, evidence, gates). Music: `--music`, else a music file in the assets, else (finish's default) ElevenLabs when `ELEVENLABS_API_KEY` is set (paid, locked and cached), else the synth bed. | `renders/draft.mp4` or `renders/final.mp4`, `finish.json`, `qa/` |
| `critic` | With a vision-capable model (OpenAI or OpenRouter routes; on by default, `--no-critic` to skip), reviews `qa/critic-sheets/` and writes `qa/critic.json` in the cinematic format, citing the temporal evidence IDs. With the Anthropic adapter (text only) or `--no-critic`, the critic gate stays `pending` with the next step. | `qa/critic.json` |

**Lane routing** (STORYBOARD_ENGINE_RFC.md §3; the model never chooses):

1. A video with speech (a talking head, podcast footage, or a narrated screen
   recording) → `footage-led`. A talking head beats a narrated demo; ties go to
   the longest clip. Footage-led plans at the `guided` tier, because overlays
   need `track` 1+ and the structured tier forbids `scene.track`.
2. A voiceover audio file → `voiceover-motion` with the supplied voice.
3. Otherwise → `motion`, with narration written by the model and synthesised.

Silent screen recordings, b-roll, screenshots and product images become media
(`media-window` scenes, or full-frame inserts in footage-led). Format follows
`--aspect`, else the base recording's orientation, else 16:9. The target
duration follows `--duration`, else a "45-second" phrase in the prompt, else
the base or voiceover length, else 30 s; the final `format.duration` is the
measured audio plus a short tail.

**Asset classification** (local heuristics, each with a confidence and its signals in `ASSETS.json`):

- Images: a filename hint (logo, icon, mark, brand) or an SVG, or a small
  (≤ 1024 px) image with alpha or a square-ish shape, is a `logo`; larger or
  wide images are `screenshot`s ("product", "photo", "hero" hints make a
  `product-image`). No catalogue module shows one logo alone (`logo-row` takes
  2–6), so the manifest tells the model to leave a single logo out unless it
  is the only product shot.
- Videos and audio: speech presence from the voice band (200–3400 Hz) and
  `silencedetect`: voiced 25–97% of the clip with pauses between phrases.
  Whisper then confirms it (≥ 0.6 words a second). A steady bed with no
  pauses is music.
- Camera vs UI: three frames at 64×36 grey. A UI capture is flat (≥ 55% of
  pixels within one level of their neighbour) and hard-edged (≥ 6% of steps
  over 20 levels); camera footage is noisy and a lit set is soft. Filename
  hints (talk, podcast, presenter / screen, demo, capture) override. No face
  detection.
- `brand.json` (colour roles and fonts) becomes the storyboard brand; a
  `style.json` becomes the style pack (copied into
  `.launchclip/styles/<name>/` so finish resolves it); `.md`/`.txt` notes join
  the brief.

**Report.** `MAKE.json` holds the routing decision and its reasons, the model,
the base edit or script passes, the repair attempts and their errors, every
model call's tokens and estimated cost, stage timings, the finish gates, the
critic result, warnings and next steps. Status: `ready` (every gate passed),
`ready-for-review` (a gate is pending, normally the critic), `needs-repair` (a
gate failed, including a critic `repair` or `replan` verdict), or `failed`
(with the failing stage, a non-zero exit and the next step). Every paid call
is announced on stderr before it is made (`model: PAID call to …`, ElevenLabs
voice and music notices), and the summary prints the estimated total.

**Resume.** Run the same command again: the inventory, script, storyboard,
voice take, base edit, music lock and finish stages are reused. `--replan`
plans a new storyboard (delete `SCRIPT.json` for a new script). Cheap
candidate renders are skipped in headless mode; `MAKE.json` records why.

## Export: an editable timeline for Final Cut Pro, Premiere Pro and Resolve

```bash
launchclip export <project> --format fcpxml|premiere|edl|otio|all \
  [--overlays prores4444|png|none] [--out exports/] [--fps 24|25|29.97|30|60] \
  [--name name] [--absolute] [--dtd FCPXMLv1_10.dtd] [--force] [--json]
```

`export` turns a finished storyboard project (run `finish` first) into an
editable NLE timeline whose clips line up frame for frame with the render.
`--format` takes one format, a comma list or `all`:

| `--format` | File | For |
| --- | --- | --- |
| `fcpxml` | `<name>.fcpxml` (FCPXML 1.10) | Final Cut Pro, DaVinci Resolve |
| `premiere` | `<name>.xml` (FCP 7 xmeml v4) | Premiere Pro, DaVinci Resolve |
| `edl` | `<name>.edl` (CMX 3600, V1 only) | Avid and conform tools |
| `otio` | `<name>.otio` (OpenTimelineIO JSON) | Resolve, Hiero, RV, otio tools |

Output goes to `<out>/<name>/` (default `exports/<project-folder>/`): the
format files, `captions.srt`, `timeline.json` (the timeline model),
`EXPORT.json` (files, tracks, overlay renders, warnings, validation) and
`media/` with every referenced file copied in (APFS clones where possible).
Media paths are relative; `--absolute` writes absolute `file://` URLs.

Tracks: V1 is the base (footage-led trim segments, each a clip on the original
recording with its source in point, or a solid `brand.colors.bg` plate in
motion lanes); V2 and up are the overlay scenes, each rendered on its own as
ProRes 4444 with alpha (`--codec prores --prores-profile 4444 --pixel-format
yuva444p10le`) from the Remotion kit's `SceneOverlay` composition, stacked so a
transitioning scene sits above the one it overlaps; the top video track is the
finished render, disabled, for reference. A1 is the voice (or the recording's
audio, linked to V1), A2 the music bed, A3 and up the SFX cues as individual
clips with their levels and the typing track, then the finished mix (disabled). Captions are a
subtitle track (FCPXML caption role; `captions.srt` elsewhere) and markers sit
at scene starts, hits and camera moves.

`--overlays none` skips the overlay renders and enables the finished render as
the picture above V1; `--overlays png` writes PNG sequences instead (referenced
by the OTIO only). Overlay renders are reused while the story and kit are
unchanged; `--force` re-renders. `--fps 29.97` (or 59.94, 23.976) writes an exact
NTSC timeline (30000/1001) with drop-frame timecode and renders the overlays at
that rate. Camera moves (punch-in), music ducking and word-highlight caption
styling are not carried; they are listed in `EXPORT.json` warnings. Overlays
always come from Remotion: the HyperFrames compiler cannot isolate a scene on
alpha yet.

Every file is read back and compared with the timeline model (clip starts,
durations, source in points, markers, captions). FCPXML also gets structural
checks and Apple's DTD check when Final Cut Pro is installed (or `--dtd` /
`LAUNCHCLIP_FCPXML_DTD` names the DTD); the `.otio` is also opened with the
Python `opentimelineio` package when it is installed. A failed check exits
non-zero after writing the files.

### Renderer eval (npm script, repository checkout)

```bash
npm run eval:renderers [-- --stories a,b] [--quality draft] [--out qa/renderer-eval] [--thresholds eval/renderer-thresholds.json] [--worst 4]
```

Renders every golden storyboard in `examples/story/` (`cooling`, `minimal`,
`promo-16x9`, `explainer-9x16`, `data-story-9x16`) with both renderers and
measures whether they match and pass the same gates: render time per
renderer, `story validate`, layout-check, the cinematic-check motion and audio
analyses of each MP4, frame parity (ffmpeg SSIM at the temporal-evidence
schedule of the story's boundaries, plus every frame), frame counts, loudness
and the decoded audio. It writes `<out>/report.json` and `<out>/report.md`
(one table per story, with a contact sheet of the worst frames:
HyperFrames | Remotion | difference ×4) and exits 1 when a threshold in
`eval/renderer-thresholds.json` fails (2 on a usage error). Gates there are
`true` (must pass), `"report"` (shown, never fails) or `false` (skipped);
`stories.<id>` overrides any limit for one story. Run it after any change
under `kit/`; it needs both renderers' Chrome and takes a few minutes.
Rebuild a golden story's audio with `node scripts/golden-story-audio.mjs
examples/story/<id>` (macOS `say` and ffmpeg).

## Voice providers

Voice providers live in `src/voice/`. Each one exposes
`synthesize({ text, voice, speed, outFile, signal })` and returns
`{ file, words: [{ text, start, end }], sampleRate, duration }`, with word
times in seconds on the written file's timeline. Words are validated: they
are ordered, have positive length and lie inside the audio.

| Provider | When | Output | Word timings |
| --- | --- | --- | --- |
| `kokoro` (default) | always; offline on CPU | 24 kHz mono WAV | model phoneme durations, no ASR |
| `elevenlabs` | only with `ELEVENLABS_API_KEY` | 24 kHz mono WAV | provider character alignment |
| `supplied` | a recorded voiceover (`source`) | 48 kHz mono WAV, about −17 LUFS | local Whisper aligned to the script |

**Kokoro.** Kokoro-82M (Apache-2.0) through the optional dependency
`kokoro-js@1.2.1`. The default voice is `af_heart` at speed 1.2. On first use
the timestamped ONNX export (about 325 MB, fp32) downloads once to
`$LAUNCHCLIP_CACHE/kokoro`, default `~/.cache/launchclip/kokoro`. If
`kokoro-js` is not installed, the provider says how to install it. Timing
method: the model predicts a duration for every phoneme. Phonemes are grouped
into words at spaces and punctuation, the groups are mapped to the script's
words (merging groups when text normalisation expanded a token, such as
"35"), and each onset is snapped to an RMS energy onset within 50 ms. If a
model returns no durations, each sentence's voiced span is split in proportion
to phoneme counts and onsets are snapped within 80 ms. Measured on the
25.5 s cooling narration, against an RMS onset detector (mean absolute error,
nearest onset within 150 ms):

| Method | All words | Words after a pause |
| --- | --- | --- |
| phoneme durations, before snapping | 38 ms | 17 ms |
| phoneme durations, snapped (shipped) | 21 ms | 6 ms |
| proportional fallback, before snapping | 44 ms | 33 ms |
| random times (baseline) | 55 ms | n/a |

In connected speech a word often has no clean energy onset, so the detector
is a noisy reference. Words after a pause are the reliable check. Synthesis
ran at a real-time factor of about 0.5 on an idle Apple M4 (25.5 s of audio in
12.7 s), after a model load of about 2 s from the cache.

**ElevenLabs.** Opt-in. Without `ELEVENLABS_API_KEY` it throws before sending
anything. It calls `/v1/text-to-speech/{voice}/with-timestamps` with
`output_format=pcm_24000` and groups the character alignment into the
script's words. The voice comes from `voice` or `ELEVENLABS_VOICE_ID`. Speed
is clamped to ElevenLabs' range of 0.7 to 1.2.

**Supplied voiceover.** `create({ source })` prepares a recording instead of
synthesising one. It trims leading and trailing silence (keeping 50 ms),
shortens pauses longer than 0.6 s to 0.35 s, and normalises to about −17 LUFS
with a true peak of −1.5 dBTP (mono voice plays about 3 LU louder as stereo).
It then transcribes with the local Whisper path (`base.en` by default; no
paid transcription), aligns the recognised words back to `text`, moves word
boundaries onto pauses that Whisper placed inside a word, and snaps onsets
within 60 ms. The result's `prep` field records the trims, the keep ranges
and the measured loudness. Whisper `base.en` word starts are coarse: on a test
take built from the Kokoro sample with known word times, the mean absolute
error was 112 ms, mostly because Whisper starts words early in connected
speech. Filler-word and noise removal are not part of this step yet.

## Failure handling

- Preserve the workspace and receipts; do not delete them to retry.
- Copy the exact error and stage name.
- Inspect `production/jobs.json`, `production/qa/`, and the command's `next`
  field.
- Fix missing Node, browser, HyperFrames, FFmpeg, ImageMagick/SVG tooling, or
  credentials before spending another model call.
- Resume from the failed stage with the same options that affect its inputs.
- Do not use fallback or quality-gate bypass flags merely to obtain a green exit
  code.

## Command usage

<!-- usage:start -->
<!-- Generated from src/cli_usage.js by npm run skills:sync; edit the table there. -->

Every command answers `--help` or `-h` with its own usage (`launchclip finish --help`, `launchclip story validate --help`).

- `doctor`: Check the host: Node, FFmpeg, browsers, renderers and provider keys (presence only).

  ```text
  launchclip doctor
  ```

- `skills list`: List the bundled agent skills.

  ```text
  launchclip skills list
  ```

- `skills path`: Print the path of a bundled skill.

  ```text
  launchclip skills path [launchclip-create-video|launchclip-create-video-remotion|launchclip-cli]
  ```

- `skills install`: Install the bundled skills for Codex or Claude.

  ```text
  launchclip skills install --agent codex|claude [--skill launchclip-create-video|launchclip-create-video-remotion|launchclip-cli|all] [--force]
  ```

- `style create`: Create a style pack from a video, a style directory or reference media.

  ```text
  launchclip style create <name> --from <video-or-style-directory> [--root .launchclip/styles] [--force]
  launchclip style create <name> --from-reference a.mp4 [b.mp4 ...] [--from-images x.png ...] [--font-hint "Display, Body"] [--format footage-led|motion|demo-led] [--rights own|licensed|public-statistics] [--root .launchclip/styles] [--force]
  ```

- `style save`: Save a style pack from a video or style directory.

  ```text
  launchclip style save <name> --from <video-or-style-directory> [--root .launchclip/styles] [--force]
  ```

- `style list`: List project and built-in style packs.

  ```text
  launchclip style list [--root .launchclip/styles]
  ```

- `style show`: Show a style pack (upgraded in memory when it is v1).

  ```text
  launchclip style show <name|path> [--root .launchclip/styles]
  ```

- `style upgrade`: Upgrade a v1 or v2 style pack to v3 on disk.

  ```text
  launchclip style upgrade <name> [--root .launchclip/styles]
  ```

- `style check`: Check a rendered project against a style pack.

  ```text
  launchclip style check <project> --against <name|path> [--video renders/final.mp4] [--out qa/style-check.json]
  ```

- `style generate`: Generate a style pack from a seed (a random one unless --seed), inside art-direction constraints.

  ```text
  launchclip style generate [--seed <hex>] [--tone calm|serious|warm|energetic|playful|premium|technical] [--theme dark|light|tinted] [--world <id>[,<id>...]] [--drawing-style <name>] [--character-set <id>] [--background <kind>] [--panel <treatment>] [--out <dir|style.json> | --project <dir>] [--force]
  ```

- `style reroll`: Give a project with a generated style a new seed (its constraints kept); --undo goes back once.

  ```text
  launchclip style reroll [<project>] [--tone <tone>] [--seed <hex>] [--undo]
  ```

- `style keep`: Copy a project's generated style to ~/.launchclip/styles/<name> as a personal style.

  ```text
  launchclip style keep <project> --as <name> [--force]
  ```

- `profile list`: List the shipped cadence profiles with their format, aspects, duration range and provenance (seed or measured).

  ```text
  launchclip profile list                            # the shipped cadence profiles
  ```

- `profile show`: Show one cadence profile (a shipped id or a profile file), validated.

  ```text
  launchclip profile show <id|profile.json>
  ```

- `profile measure`: Measure a folder of reference videos into a cadence profile. Only statistics are kept, never frames, audio or text; --rights says what right you have to analyse them. --replace writes over a shipped profile and refreshes kit/profiles/PROVENANCE.md.

  ```text
  launchclip profile measure <folder> --rights own|licensed|public-statistics (--id <new-id> | --replace <shipped-id>) [--out profile.json] [--title "…"] [--fps 1]
  ```

- `cast list`: List the starter characters, and the story's cast when given a project.

  ```text
  launchclip cast list [project|storyboard.json]
  ```

- `cast show`: Show one character's rig params, colours and voice.

  ```text
  launchclip cast show <id> [--story storyboard.json]
  ```

- `cast sheet`: Render every character in every pose and expression the story uses to qa/cast-sheet.png.

  ```text
  launchclip cast sheet <project|storyboard.json> [--ids maya,theo] [--out qa/cast-sheet.png] [--report qa/cast-sheet.json]
  ```

- `intake`: Write a production workspace from a source (repository, product, topic or voiceover).

  ```text
  launchclip intake <source> [--profile standard|cinematic] [--kind repository|product|topic|voiceover] [--resource path] [--assets path] [--style auto|family|name|path] [--style-root .launchclip/styles] [--style-file frame.md] [--style-reference path|url] [--reference url] [--voiceover audio|video] [--transcript text] [--presenter video] [--heygen-avatar video] [--aspect 9:16|16:9] [--duration 60] [--model gpt-5.6] [--reasoning xhigh] [--pro] [--out <workspace>]
  ```

- `edit-recording`: Edit a raw recording: trim silence, drop retakes and fillers, QA the joins, then clean up the voice audio (--enhance light by default; --voice-isolation elevenlabs is opt-in and paid).

  ```text
  launchclip edit-recording <media> --out <directory> [--recording-transcript word-timed.json] [--silence-duration 0.8] [--silence-padding 0.15] [--retake-window 90] [--retake-decisions semantic.json|--retake-model local-model] [--min-repeat-words 6] [--recording-model base.en] [--consensus-model small.en|none] [--consensus-transcript word-timed.json] [--keep-fillers] [--no-audio-silence] [--audio-silence-duration 0.4] [--audio-silence-padding 0.08] [--audio-threshold-db -35] [--qa-model local-model|--qa-decisions reviews.json] [--qa-attempts 3] [--qa-recording-model base.en] [--no-trim-silence] [--enhance light|podcast|off] [--voice-isolation none|elevenlabs] [--aspect 16:9|9:16|1:1]
  ```

- `broll-plan`: Plan b-roll inserts from a word-timed transcript.

  ```text
  launchclip broll-plan <word-timed.json> --out <directory> [--aspect 16:9|9:16|1:1] [--duration seconds]
  ```

- `produce`: Run the model-directed production lane end to end.

  ```text
  launchclip produce <source> [--profile standard|cinematic] [intake flags] [--heygen-avatar generated.mp4] [--review] [--model-policy cost-aware|local-first|quality|free] [--free-model-candidates 5] [--free-model-state path] [--free-vision-model-candidates 3] [--free-vision-model-state path] [--refresh-free-models] [--free-scene-concurrency 3] [--local-model qwen2.5-coder:latest] [--frame-route provider:model@reasoning] [--rendered-candidates 2] [--rendered-candidate-shots 2] [--candidate-judge-route provider:model@reasoning] [--candidate-judge-reasoning high] [--candidate-judge-max-output-tokens 5000] [--critic-route provider:model@reasoning] [--repair-route provider:model@reasoning] [--brand-assets-dir path] [--edit-recording] [--recording-transcript word-timed.json] [--no-trim-silence] [--planning-mode auto|single|hierarchical] [--voice-id id] [--sfx-dir path] [--concurrency 4] [--max-frame-cost-usd 5] [--max-cost-usd 50|none] [--no-audio] [--fast-eval]
  ```

- `evidence`: Collect evidence for a production workspace.

  ```text
  launchclip evidence <workspace>
  ```

- `source-preprocess`: Preprocess the workspace's source media.

  ```text
  launchclip source-preprocess <workspace> [--edit-recording] [--recording-transcript word-timed.json] [--no-trim-silence] [--silence-duration seconds] [--silence-padding seconds]
  ```

- `source-media`: Sample and describe the workspace's source media.

  ```text
  launchclip source-media <workspace> [--media-samples 12] [--media-reasoning high] [--transcribe-all]
  ```

- `resolve-entities`: Resolve brand entities and logos for the workspace.

  ```text
  launchclip resolve-entities <workspace> [--brand-assets-dir ~/.launchclip/brand-assets]
  ```

- `concept-tournament`: Generate and judge concepts for the workspace.

  ```text
  launchclip concept-tournament <workspace> [--concept-route provider:model@reasoning] [--concept-judge-route provider:model@reasoning]
  ```

- `retention-story`: Write and edit the retention story.

  ```text
  launchclip retention-story <workspace> [--story-writer-route provider:model@reasoning] [--story-editor-route provider:model@reasoning]
  ```

- `cinematic-narration`: Generate the cinematic narration.

  ```text
  launchclip cinematic-narration <workspace> [--voice-id id] [--voice-model id] [--no-voice]
  ```

- `creative-plan`: Write the creative plan.

  ```text
  launchclip creative-plan <workspace> [--planning-mode auto|single|hierarchical] [--hierarchical-threshold 180] [--chapter-concurrency 3] [--plan-semantic-attempts 2] [--visual-history-dir path] [--visual-history-limit 8] [--visual-similarity-limit 0.58] [--max-output-tokens 48000] [--foreground]
  ```

- `production-audio`: Generate voice, music and SFX for the workspace.

  ```text
  launchclip production-audio <workspace> [--voice-id id] [--music-model music_v2] [--sfx-dir path] [--no-voice] [--no-music] [--no-sfx]
  ```

- `direct-frames`: Author the frames for the creative plan.

  ```text
  launchclip direct-frames <workspace> [--profile standard|cinematic] [--model-policy cost-aware|local-first|quality|free] [--free-model-candidates 5] [--free-model-state path] [--refresh-free-models] [--free-scene-concurrency 3] [--blueprint-semantic-attempts 2] [--frame-route provider:model@reasoning] [--rendered-candidates 2] [--rendered-candidate-shots 2] [--candidate-judge-route provider:model@reasoning] [--candidate-judge-reasoning high] [--candidate-judge-max-output-tokens 5000] [--concurrency 4] [--semantic-attempts 2] [--pending-frame-reasoning medium] [--max-frame-cost-usd amount] [--allow-frame-fallback]
  ```

- `assemble`: Assemble the production composition.

  ```text
  launchclip assemble <workspace> [--music-volume 0.35]
  ```

- `production-verify`: Verify the assembled production.

  ```text
  launchclip production-verify <workspace> [--inspect-samples 15] [--shot-inspect-concurrency 2] [--snapshot-frames 12]
  ```

- `production-draft`: Render and critique a draft of the production.

  ```text
  launchclip production-draft <workspace> [--model-policy free] [--draft-quality draft] [--critic-route provider:model@reasoning] [--free-vision-model-state path] [--shot-inspect-concurrency 2] [--reference-video local.mp4]
  ```

- `production-preview`: Open the production preview server.

  ```text
  launchclip production-preview <workspace> [--port 3002] [--no-open]
  ```

- `review`: Review a workspace (production studio review, or the legacy packet review).

  ```text
  launchclip review <workspace> [--model-policy free] [--port 3002] [--no-open] [--critic-route provider:model@reasoning] [--repair-route provider:model@reasoning]
  launchclip review <workspace>
  ```

- `production-critique`: Run the visual critic on the production draft.

  ```text
  launchclip production-critique <workspace> [--critic-route provider:model@reasoning] [--model-policy free] [--free-vision-model-candidates 3] [--free-vision-model-state path] [--refresh-free-vision-models] [--critic-reasoning xhigh] [--critic-pro]
  ```

- `production-repair`: Repair the production from the critic's findings.

  ```text
  launchclip production-repair <workspace> [--model-policy cost-aware|local-first|quality|free] [--repair-route provider:model@reasoning] [--repair-text-only] [--repair-scoped-source] [--repair-semantic-attempts 2] [--repair-snapshots 8] [--repair-issues-per-shot 4] [--max-patch-ratio 0.35]
  ```

- `production-render`: Render the approved production at final quality.

  ```text
  launchclip production-render <workspace> --approve [--quality high] [--critic-route provider:model@reasoning] [--shot-inspect-concurrency 2] [--reference-video local.mp4]
  ```

- `story validate`: Validate a storyboard.json (errors and warnings). In the footage-led, motion and voiceover-motion lanes it also requires DIRECTION.json when the story has narration words, checks it against the narration and the scenes, and reports coverage, face time and the longest undressed run against the cadence profile.

  ```text
  launchclip story validate <storyboard.json> [--narration NARRATION.json] [--beats BEATS.json] [--direction DIRECTION.json] [--out report.json]
  ```

- `story resolve`: Resolve a storyboard.json's time anchors to seconds.

  ```text
  launchclip story resolve <storyboard.json> [--narration NARRATION.json] [--beats BEATS.json] [--out story.resolved.json]
  ```

- `story compile`: Compile a story project for HyperFrames or Remotion.

  ```text
  launchclip story compile <project> --renderer hyperframes|remotion [--out dir]
  ```

- `story long-form`: Give a long video its structure: chapters from DIRECTION.json's sections, an opening promise, a section card at each chapter start and a progress line with chapter ticks. Rewrites storyboard.json and DIRECTION.json; safe to run again.

  ```text
  launchclip story long-form <project> [--narration NARRATION.json] [--dry-run]
  ```

- `story plan`: Plan DIRECTION.json and then storyboard.json from a brief with a model: the direction map first (one call), then the storyboard against it and the cadence profile; the repair loop repairs both.

  ```text
  launchclip story plan --brief brief.md [--narration NARRATION.json] [--tier structured|guided|bespoke] [--model provider:model] [--out storyboard.json] [--base assets/recording.mp4] [--voice assets/audio/narration.wav] [--format 1080x1920] [--fps 30] [--duration seconds] [--brand brand.json] [--style name|path | --seed <hex>] [--tone <tone>] [--profile id|profile.json] [--no-direction] [--no-subject] [--max-repairs 2]
  ```

- `cinematic-check`: Check a finished project against the cinematic gates and receipts.

  ```text
  launchclip cinematic-check <project> [--renderer hyperframes|remotion] [--video renders/draft.mp4] [--audio-manifest AUDIO-MANIFEST.json] [--music-volume 0.32] [--expect-audio] [--critique qa/critic.json]
  ```

- `layout-check`: Check a storyboard's declared geometry: safe zone, collisions, caption band (at rest and through camera moves), text size.

  ```text
  launchclip layout-check <project> [--profile shorts|landscape] [--json]
  ```

- `module fit`: Measure one module's params against the frame and report what fits.

  ```text
  launchclip module fit <module> [--params params.json] [--aspect 16:9|9:16] [--story storyboard.json] [--brand brand.json] [--duration 4] [--json]
  ```

- `subject setup`: Download and verify the local person segmentation models the subject stage uses.

  ```text
  launchclip subject setup [--model modnet-fused|modnet|mediapipe-selfie|u2net-human] # download and verify the segmentation models
  ```

- `subject probe`: Sample a recording and report whether one person can be cut out, and how they are framed.

  ```text
  launchclip subject probe <video> [--model mediapipe-selfie] [--cache .launchclip/subject] [--force] [--no-download] [--json] # framing summary: people, head, headroom, usable
  ```

- `subject track`: Track the presenter's head and body through the whole recording, so placement and layout-check know where the face is outside the matted ranges.

  ```text
  launchclip subject track <video> [--project <story-project>] [--model mediapipe-selfie] [--cache .launchclip/subject] [--force] [--no-download] [--json] # head and body boxes at 10 fps over the whole recording
  ```

- `subject matte`: Cut the person out of one source range: a cached alpha WebM and per-frame head and body boxes.

  ```text
  launchclip subject matte <video> --range <in>-<out> [--project <story-project>] [--model modnet-fused] [--smooth 0-0.9] [--cache .launchclip/subject] [--force] [--no-download] [--json] # alpha matte.webm + subject.json for one source range
  ```

- `finish`: Storyboard to mastered video in one command: voice, music, SFX, render, master and gates (layout, loudness, motion against the cadence profile, audio, temporal evidence, and the direction map, coverage and face gates). --prototype renders only the opening 20–30 s (cut at a sentence end) to renders/prototype.mp4, for review before the whole. --candidate renders a draft candidate with no paid calls (synth or no music, a cached or free voice, else the test voice; no evidence or gates) and records it in the rendered-candidate receipt. --chapter <id> re-renders one chapter's segments, stitches the master from the cache and writes the chapter alone to renders/chapters/<id>.mp4; finish also writes renders/chapters.txt and MP4 chapters for a story with chapters.

  ```text
  launchclip finish <project> [--renderer remotion|hyperframes] [--quality draft|high] [--voice kokoro|elevenlabs|supplied|test] [--music synth|elevenlabs|none] [--music-regenerate] [--out renders/final.mp4] [--sfx-library dir] [--sfx-density low|normal|high] [--scene s3[,s4] | --preview-scene s3 | --chapter c2] [--force] [--json]
  launchclip finish <project> --prototype [--renderer remotion|hyperframes] [--quality draft|high] # the opening 20–30 s only
  launchclip finish <candidate-project> --candidate <id> [--into <project>] [--kind opening|transition] [--boundary s3] [--comparison id] [--at 0.4,1.2,2.6] [--music synth|none] [--renderer remotion|hyperframes] # cheap rendered candidate: no paid calls, receipt in <project>/qa/rendered-candidates.json
  ```

- `make`: Prompt plus an optional assets folder to a finished video, headless: classify the assets, route the lane deterministically, write the script and storyboard with an API model (repair loop), then finish and an optional vision critic. Writes MAKE.json with routing, costs, timings and gates. --repo runs demo autopilot first: it records the app's key flows into assets/demo and edits the approved ones in as product-demo scenes.

  ```text
  launchclip make "<prompt>" [--assets <dir>] [--aspect 16:9|9:16|1:1] [--duration <seconds>] [--style <name|path> | --seed <hex>] [--model provider:model] [--voice kokoro|elevenlabs] [--music synth|elevenlabs|none] [--renderer remotion|hyperframes] [--quality draft|high] [--out <project-dir>] [--replan] [--critic | --no-critic] [--max-repairs 4] [--no-subject] [--max-cost-usd 50|none] [--json]
  launchclip make "<prompt>" --repo <app-repo> [--approve-demo] [--demo-plan DEMO-PLAN.json] [--start "npm run dev"] [--url http://localhost:3000] [--allow-host <host>] [--redemo]
  ```

- `fx`: Put one module on a clip: a one-scene footage-led story around the whole clip, the presenter cut out when the module needs them, then finish. The project it writes (<video>.fx/ by default) is an ordinary story project you can keep editing.

  ```text
  launchclip fx <video> <module> [--at <seconds|word:text>] [--until <seconds|word:text> | --for <seconds>] [--params '{...}'|params.json] [--layer front|behind|split] [--captions <style>] [--style <name|path>] [--renderer remotion|hyperframes] [--quality draft|high] [--music none|synth] [--out <project-dir>] [--no-download] [--json]
  ```

- `voice`: Generate the narration (NARRATION.json and the voice track) for a project or a text.

  ```text
  launchclip voice <project | --text "..."> [--voice kokoro|elevenlabs|test|<voice id>] [--provider kokoro|elevenlabs|test] [--speed 1.2] [--out NARRATION.json] [--json]
  ```

- `cutdown`: Cut a Short from one section of a long video: a new 9:16 project (default <project>/cutdowns/<section>-shorts) that re-plans the section against the Shorts profile instead of cropping. It reuses the base edit, mattes and face track, maps word anchors into the section, opens on a hook card and loops back to it. Deterministic and free; --model re-plans with the planner (paid). Then run launchclip finish on it.

  ```text
  launchclip cutdown <project> --to shorts [--section <id>] [--max 58] [--out <dir>] [--model provider:model] [--force]
  ```

- `export`: Export an editable timeline for Final Cut Pro, Premiere Pro or Resolve.

  ```text
  launchclip export <project> --format fcpxml|premiere|edl|otio|all [--overlays prores4444|png|none] [--out exports/] [--fps 24|25|29.97|30|60] [--name name] [--absolute] [--force] [--json]
  ```

- `sfx seed`: Seed the user SFX library (ElevenLabs, or the procedural kit with --provider synth). --missing fills only the families the library lacks (sfx list names them).

  ```text
  launchclip sfx seed [--provider elevenlabs|synth] [--variants 3] [--only whoosh,impact | --missing] [--reroll typing] [--dir .launchclip/sfx] [--force]
  ```

- `sfx reroll`: Regenerate one SFX family.

  ```text
  launchclip sfx reroll <family> [--dir .launchclip/sfx]
  ```

- `sfx list`: List the SFX libraries, what each family resolves to, and the families missing compared with the prompt set.

  ```text
  launchclip sfx list [--dir .launchclip/sfx]
  ```

- `sfx audition`: Write one audition file with every variant of a family.

  ```text
  launchclip sfx audition <family> [--dir .launchclip/sfx] [--out audition.wav] [--gap 0.35]
  ```

- `init`: Initialise a packet workspace for a repository.

  ```text
  launchclip init <repo> --out <workspace>
  ```

- `demo`: Capture a demo for the packet workspace, or record a SaaS app's product flows (demo record) and approve them for use (demo approve).

  ```text
  launchclip demo <repo> --out <workspace> --demo-cmd "npm run smoke" --capture terminal [--demo-media path/to/screenshot.png]
  ```

- `demo record`: Demo autopilot: detect how the repo runs, seed it, start it, plan 2–4 flows (DEMO-PLAN.json) and record each in Chromium with an action log, then write contact sheets and REVIEW.md. Asks before running the seed and start commands unless --approve; local or staging URLs only unless --allow-host.

  ```text
  launchclip demo record <repo> [--out assets/demo] [--plan DEMO-PLAN.json] [--start "npm run dev"] [--url http://localhost:3000] [--seed "npm run seed" | --no-seed] [--no-start] [--approve] [--allow-host staging.example.com] [--flows a,b] [--plan-only] [--prompt "..."] [--model provider:model] [--viewport 4k] [--headed]
  ```

- `demo doctor`: Check a demo recipe before recording. Without --plan it surveys the repo (start and seed commands, test accounts, auth, e2e mocks and sign-ins, MSW, API contracts, env vars, first-run flags, docs placeholders) and recommends a setup rung, running nothing. With --plan it starts the app (asks first, like record), then runs each flow at full speed with off-origin requests blocked: every step must resolve to a visible element, nothing may cover the page or sign it out, and API requests must be answered. Each check reports a fix; --json for agents; exit 1 on any failure.

  ```text
  launchclip demo doctor <repo> [--plan demo/DEMO-PLAN.json] [--json] [--url http://localhost:3000] [--start "npm run dev"] [--seed "npm run seed" | --no-seed] [--no-start] [--approve] [--flows a,b] [--out .launchclip/doctor] [--step-timeout 5000] [--allow-host staging.example.com] [--headed]
  ```

- `demo shots`: List the video and screenshot placeholders in docs ({/* video: … */}, <!-- video: … -->, shot-list tables); --draft writes or extends a DEMO-PLAN.json with one flow per video for the agent to fill in.

  ```text
  launchclip demo shots <docs-dir-or-file> [--draft demo/DEMO-PLAN.json] [--url http://localhost:3000]
  ```

- `demo approve`: Approve (or --reject) recorded demo flows after reviewing their contact sheets; only approved flows are used in a video.

  ```text
  launchclip demo approve <dir> [--flows a,b] [--reject]
  ```

- `demo scene`: Print product-demo scene params for an approved flow (its action log turned into scene-relative actions, callouts and the clip window).

  ```text
  launchclip demo scene <dir> [--flow <id>] [--source-start 0.5] [--duration 8] [--src assets/demo/<flow>.mp4] [--frame window|full]
  ```

- `plan`: Plan the packet video.

  ```text
  launchclip plan <workspace> --format short-15 --renderer none|hyperframes [--style proof-card|ugc-split|ugc-demo-punchy|premium-product-short|data-story-benchmark] [--assets-dir path/to/assets] [--talking-head heygen --avatar-id avatar_123]
  ```

- `captions`: Write social captions for the packet.

  ```text
  launchclip captions <workspace> --platforms x,linkedin,tiktok,bluesky
  ```

- `render`: Render the packet video.

  ```text
  launchclip render <workspace> --provider product-videogen --dry-run
  launchclip render <workspace> --provider hyperframes [--quality high] [--strict-all] [--inspect-samples 15] [--skip-quality-gates] [--voiceover local-say|elevenlabs] [--music elevenlabs]
  launchclip render <workspace> --provider remotion [--assets-dir path/to/assets] [--voiceover local-say|elevenlabs]
  launchclip render <workspace> --provider local-ffmpeg [--voiceover local-say|elevenlabs]
  ```

- `analyze-render`: Analyse a rendered packet video.

  ```text
  launchclip analyze-render <workspace> [--video video/launchclip-hyperframes.mp4]
  ```

- `submit-review`: Submit the packet for review.

  ```text
  launchclip submit-review <workspace> --provider product-videogen --dry-run
  ```

- `validate`: Validate a packet workspace.

  ```text
  launchclip validate <workspace>
  ```

- `run`: Run the whole packet lane for a repository.

  ```text
  launchclip run <repo> --out <workspace> --demo-cmd "npm run smoke" --demo-media path/to/demo.mp4 --angle "..." --audience "..." [--style premium-product-short --assets-dir path/to/assets --talking-head heygen]
  ```

- `script`: Write a teleprompter script from the planned voiceover.

  ```text
  launchclip script <workspace> [--wpm 150]          # teleprompter from the planned voiceover
  ```

- `align`: Align a recorded take to word timings and a motion timeline.

  ```text
  launchclip align <workspace> --media take.mp4      # whisper word timings + heuristic motion timeline
  launchclip align <workspace> --media take.mp4 --words words.json
  ```

- `motion-render`: Render video/motion.mp4 with the motion engine.

  ```text
  launchclip motion-render <workspace>               # render video/motion.mp4 via the motion engine
  ```

- `music`: Generate a music bed for a workspace.

  ```text
  launchclip music <workspace> [--prompt "..."] [--duration 18] [--output music/bed.mp3] [--music-model music_v1] [--force]
  ```

- `preprocess-presenter`: Preprocess presenter footage (speed, crop).

  ```text
  launchclip preprocess-presenter public/base/presenter.mp4 [--out public/base/presenter-prepped.mp4] [--speed 1.08] [--crop-x center]
  ```

- `direct`: Direct a talking-head or TTS video from a creative prompt.

  ```text
  launchclip direct <workspace> --voice record --prompt "creative direction" # writes script + teleprompter, waits for take
  launchclip direct <workspace> --voice record --take take.mp4 [--words w.json] # aligns take, directs, renders
  launchclip direct <workspace> --voice tts --prompt "creative direction" # generates voice + timings, directs, renders
  launchclip direct <workspace> --prompt "creative direction" [--format software_demo|explainer]
  [--words w.json --take base/take.mp4 | --script-text "..."] [--duration 45] [--no-render] [--quality fast|high]
  [--music-prompt "..."] [--no-music] [--sfx-dir path/to/sfx] [--allow-placeholder-sfx]
  [--provider anthropic|openai] [--model <id>]   # LLM: ANTHROPIC_API_KEY (default) or OPENAI_API_KEY
  ```
<!-- usage:end -->
