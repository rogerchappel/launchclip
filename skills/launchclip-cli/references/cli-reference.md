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
  - [Sound effects](#sound-effects)

- [Voice providers](#voice-providers)
- [Failure handling](#failure-handling)

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
3 s on Shorts), and `centre-of-mass` (sustained drift from y 860 on Shorts).

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
  [--brand brand.json] [--max-repairs 2]
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
  [--voice kokoro|elevenlabs|supplied|test] [--out renders/final.mp4] \
  [--sfx-library dir] [--sfx-density low|normal|high] [--force] [--json]
```

`finish` is the recommended way to turn a `storyboard.json` project into a
finished video. It runs these stages in order and stops at the first failure
(later stages are reported as `blocked`):

| Stage | What it does | Writes |
| --- | --- | --- |
| `voice` | When `audio.narration` (`{text, provider?, voice?, speed?}`) is set, synthesises it through the voice provider (`--voice` overrides `provider`; the default is `kokoro`). Skipped when `audio.voice` is a supplied file, unless `--voice` is given. | `assets/audio/narration.wav`, `NARRATION.json` |
| `validate` | Validates the story, resolves its anchors against the synthesised words, and runs the geometric layout check. Errors fail the run; warnings are reported. | `.launchclip/finish/storyboard.json`, `.launchclip/finish/story.resolved.json` |
| `captions` | Chunks the words into caption lines when a captions overlay has no `src`. | `assets/captions/captions.json` |
| `sound` | Binds a cue to every hit (`hit.cue`, else the named module event's cue, else a default from the event name) and to every module event that carries a `cue`, adds a whoosh under push, whip and zoom transitions, resolves each cue to a file through the SFX library (see [Sound effects](#sound-effects)), renders a typing track for typed code, picks a music bed from scene `energy` (tempo, level and kick window), and mixes everything with the music ducked under the voice. Skipped when the storyboard sets `audio.mix`. `audio.sfx: "none"` and `audio.music: "none"` turn the parts off. | `assets/audio/mix.wav`, `assets/audio/kit/`, `assets/audio/typing.wav`, `AUDIO-MANIFEST.json`, `qa/sfx.json` |
| `render` | Renders the filled copy through the renderer adapter. The default renderer is `remotion` when the project has no `index.html`, otherwise `hyperframes`; HyperFrames compiles to `.launchclip/finish/hyperframes/` first. | `.launchclip/finish/render-<quality>.mp4` |
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
