# LaunchClip CLI Reference

Use the installed CLI's `--help` as the final authority. This reference explains
the current workflow and the decisions an operating agent must not guess.

## Contents

- [Runtime and credentials](#runtime-and-credentials)
- [Input flags](#input-flags)
- [Model-directed production](#model-directed-production)
- [Resume and repair commands](#resume-and-repair-commands)
- [Workspace artifacts](#workspace-artifacts)
- [Studio review](#studio-review)
- [Final render](#final-render)
- [Local-first OSS packet lane](#local-first-oss-packet-lane)
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
- `--style auto|<family>`, `--style-file`, `--style-reference`
- `--aspect 9:16|16:9|1:1`, `--duration <seconds>`, `--language <code>`
- `--out <workspace>`

Resource directories are expanded into checksummed files. Hidden files and
`node_modules` are ignored. An optional `assets.json` may annotate individual
asset usage, entities, tags, priority, and license.

## Model-directed production

Model policies:

- `cost-aware` (default): Terra/high planning, Luna/medium frames and patches,
  then Terra/high and Sol/high only for failed scenes.
- `local-first`: prepend `ollama:qwen2.5-coder:latest@none` to frame and repair
  routes while retaining the cloud escalation ladder.
- `quality`: retain Sol-first authoring and repair.

Pin one or more routes with repeatable
`--frame-route provider:model@reasoning` and
`--repair-route provider:model@reasoning`. Supported providers are `openai`,
`openrouter`, `ollama`, and `compatible`; the generic compatible provider reads
`OPENAI_COMPATIBLE_BASE_URL` and `OPENAI_COMPATIBLE_API_KEY`. An explicit
single local route prevents an unapproved cloud fallback:

```bash
launchclip production-repair <workspace> \
  --repair-route ollama:qwen2.5-coder:latest@none \
  --max-patch-ratio 0.35
```

Repairs return exact find/replace edits against the current HTML or structured
frame fields. A find string must occur once, the default patch may touch at
most 35% of its targets, and the result must pass the complete frame contract.
When a patch fails, LaunchClip feeds the exact error to the next bounded attempt
instead of requesting a complete replacement frame.

Repository example:

```bash
launchclip produce https://github.com/owner/repo \
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
  --voiceover ./presenter-take.mp4 \
  --transcript ./presenter-take.txt \
  --presenter ./presenter-take.mp4 \
  --assets ./brand-assets \
  --prompt "Keep the presenter visible around the evidence" \
  --aspect 16:9 \
  --out .launchclip/presenter-video
```

For work at or above 180 seconds, planning defaults to a hierarchical outline
and concurrent chapter expansion. Override explicitly with
`--planning-mode single|hierarchical` and tune `--chapter-concurrency` only when
needed.

`produce` performs, in order:

1. intake and source preprocessing
2. evidence collection and source-media analysis
3. reusable entity/brand resolution
4. creative planning
5. audio production or a no-audio manifest
6. direct frame authoring
7. HyperFrames assembly
8. verification, draft render, analysis, and independent critique
9. up to two bounded repair passes by default

It returns `awaiting-approval` only when the draft is ready and the critic
verdict is `ship`. It does not create the final render.

## Resume and repair commands

Every production stage is independently rerunnable against the same workspace:

```bash
launchclip source-preprocess <workspace>
launchclip evidence <workspace>
launchclip source-media <workspace>
launchclip resolve-entities <workspace>
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

## Workspace artifacts

Important model-directed paths:

```text
<workspace>/
  production/
    intake.json
    evidence.json
    plan.json
    SCRIPT.md
    STORYBOARD.md
    frames/
    hyperframes/
      index.html
      assembly.json
    media/
      manifest.json
    qa/
      verification.json
      snapshots/
      critique.json
    renders/
```

Each CLI response includes a `costs` summary based on observed provider calls.
Treat `costs.complete: false` as an incomplete estimate and report its warnings.
`--fast-eval` reduces budgets and repair passes but is not a zero-cost mode.
`--max-frame-cost-usd` guards cumulative direct-frame responses only.

## Studio review

After the draft is ready and the critic verdict is `ship`, open the assembled
project in the editable HyperFrames Studio:

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

Do not reuse `--approve` as blanket permission to publish or upload.

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
