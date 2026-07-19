---
name: launchclip-cli
description: Operate, explain, troubleshoot, or automate the LaunchClip CLI for repository, product, topic, voiceover, presenter, downloaded HeyGen-avatar, cinematic one-shot, user-owned project style packs, and promotion-packet video workflows. Use when an agent needs to choose LaunchClip commands, prepare inputs, create or reuse a project-local style, run or resume the model-directed production pipeline, inspect costs and artifacts, validate a workspace, render after approval, or use the legacy dry-run packet lane. Distinguish API-backed CLI production from the separate subscription-agent workflow.
---

# LaunchClip CLI

Teach or operate the CLI from evidence on the current installation. Read
[references/cli-reference.md](references/cli-reference.md) completely before
constructing commands or diagnosing a run.

## Route the request first

Choose one lane:

- **Subscription/OAuth agent, no model API spend:** use the separate
  `launchclip-create-video` skill. Do not call `launchclip produce`.
- **Model-directed production:** use `produce` or its resumable production
  stages. Planning and visual critique use OpenAI; frame authoring and bounded
  source-edit repairs may use OpenAI, OpenRouter, or local Ollama. This lane
  creates an editable HyperFrames project plus draft QA.
- **Local-first OSS promotion packet:** use `run` or the manual
  `init` → `demo` → `plan` → `captions` → `render` → `validate` → `review`
  stages. Keep provider handoffs in dry-run mode unless explicitly approved.
- **Talking-head motion workflow:** use `script`, `align`, `motion-render`, or
  `direct` only when the user specifically wants that older presenter-driven
  lane.

If the desired lane is ambiguous, explain the cost and output difference and
ask one concise question. Do not infer that a ChatGPT, Codex, or Claude login
authorizes API billing.

For a request such as “cinematic,” “stunning,” “best one-shot,” or “maximize
retention,” select the API-backed cinematic profile, not a product-launch
specialization:

```bash
launchclip produce <source> --profile cinematic --out .launchclip/<slug>
```

The profile is source-agnostic and works for portrait or landscape output. It
raises the craft floor; it cannot guarantee views, distribution, or audience
fit outside the evidence available to the run.

## Resolve the executable

Prefer the repository-local CLI when operating inside a LaunchClip checkout:

```bash
node ./bin/launchclip.js --help
```

Otherwise use an already installed `launchclip`. Do not silently install an npm
package; ask before using `npx` to download one. Run `--help` from the executable
you will actually use because flags may differ across versions.

Use the same executable consistently throughout a workspace. In examples,
replace `launchclip` with `node ./bin/launchclip.js` when working from source.

## Confirm inputs and side effects

Before a production run, determine:

- primary source and source kind
- output workspace
- audience, CTA, aspect, duration, language, and creative prompt
- supporting assets, references, supplied narration/transcript, and presenter
  footage
- which provider credentials or local endpoints exist and which paid calls the
  user approves
- whether the goal is a fast evaluation draft or a full-quality draft

Ask before:

- running an arbitrary `--demo-cmd`
- transmitting private source material to a provider
- analyzing a third-party reference video
- using a voice or likeness without confirmed authorization
- starting metered production or external generation
- final rendering, uploading, publishing, or posting

Never print or persist secrets. Report only whether a required environment
variable is present.

## Resolve user-owned styles

Look for reusable styles in `.launchclip/styles/<name>`. Verify a named pack
with `launchclip style show <name>` before production, then pass the same name
to `--style`. Use an explicit pack path when it lives elsewhere. An unmatched
name remains free-form creative direction; do not silently replace it with a
built-in channel preset.

Create a pack only from a completed video project or another pack:

```bash
launchclip style create ai-news --from .launchclip/approved-ai-video
launchclip produce ./next-brief.md --kind topic --style ai-news \
  --out .launchclip/next-ai-video
```

Style management is local and makes no model calls. Do not overwrite a pack
unless the user explicitly authorizes `--force`. Keep `.launchclip/styles/**`
in source control when the visual identity should be shared; leave generated
video workspaces ignored.

## Promote a downloaded HeyGen avatar

When the user supplies an already-generated, authorized HeyGen video, use the
single local-file shortcut:

```bash
launchclip produce <source> \
  --heygen-avatar ./heygen-avatar.mp4 \
  --transcript ./heygen-avatar.txt \
  --out .launchclip/<slug>
```

The primary `<source>` remains the factual evidence source. The avatar video's
audio becomes authoritative narration, and the same video becomes the
beat-positioned presenter resource. Do not also pass `--voiceover` or
`--presenter`; the CLI rejects that ambiguous combination. A transcript is
optional only when the user has approved and configured the transcription
provider call.

This flag consumes a local output file. It does not generate an avatar, call
HeyGen, read HeyGen credentials, or authorize use of a likeness. Confirm that
the video is local, authorized, and contains the intended final speech before
starting model-directed production.

## Run the smallest useful command

Prefer a single `produce` command for a new model-directed production and stage
commands for a resume or repair. Reuse the same workspace so receipt-backed
stages can cache valid artifacts.

Use `--fast-eval` to reduce provider, repair, and snapshot budgets, not to claim
a free or cinematic-ready run. Do not combine it with a request for maximum
one-shot quality. Use `--no-audio` to skip generated voice, music, and SFX, not to skip model
planning, frame authoring, critique, or repairs. Treat `--max-frame-cost-usd` as
a cumulative guard for direct-frame provider responses only, not as a total
pipeline budget.

Use `--model-policy cost-aware` for standard production: Terra plans, Luna
authors, and only failed frames escalate through Terra to Sol. Do not pass a
model policy for cinematic production unless the user explicitly requests a
different cost/quality tradeoff; `--profile cinematic` automatically selects
the quality policy, and an explicit cost-aware/free/local-first policy weakens
that default. Use `local-first` only when Ollama
is running; it prepends the configured local coder model. Use explicit repeated
`--frame-route` or `--repair-route` values when no unapproved cloud fallback is
allowed. Ollama uses its native structured-output API with a deterministic 32K
context; `OLLAMA_CONTEXT_LENGTH` can override that allocation. Repairs are
bounded exact source edits, not complete frame rewrites. Repair passes receive
four prioritized blocking findings per shot by default; lower
`--repair-issues-per-shot` when the local model needs a smaller fix. Do not
raise `--max-patch-ratio` merely to make a failed repair pass.

Do not pass `--allow-frame-fallback`, `--allow-timing-drift`,
`--skip-quality-gates`, or similar escape hatches by default. Use one only when
the user understands the quality or fidelity tradeoff and the resulting draft
will be labeled accordingly.

## Inspect every result

The CLI returns structured JSON. Check at minimum:

- `status`, `workspace`, and `next`
- `costs.total_usd`, `costs.complete`, per-provider totals, and warnings
- stage-specific warnings and cached/generated counts
- verification and critic verdicts
- `production/qa/cinematic-readiness.json` and every gate when the profile is
  cinematic
- the exact draft, snapshot, QA, or review paths

Do not claim success when the command produced `needs-repair`, incomplete cost
classification, stale verification, a failed/missing cinematic readiness
receipt, or an infrastructure failure. Fix
toolchain failures before invoking model repair; provider repair cannot fix a
missing browser, FFmpeg, or HyperFrames installation.

## Respect final approval

`produce` stops at an analyzed draft. For cinematic work, require fresh native
verification, a critic `ship` verdict, zero authored-frame fallbacks, passing
motion/audio gates, and `cinematic-readiness.json` with `ok: true`. Only then run
`production-preview <workspace>` to open the editable project in HyperFrames
Studio and return its URL. Treat Studio as a review and editing surface: its
Export action is an ad hoc HyperFrames render, not LaunchClip approval or the
LaunchClip final artifact.

Pause for explicit human approval of the reviewed Studio state. Then run
`production-render <workspace> --approve --quality high`; that command reruns
the final checks before rendering. If Studio edits or an automated repair
change the visible result, reopen or refresh Studio and obtain fresh approval.

After rendering, confirm the media exists, is non-empty, and has plausible
duration and streams. LaunchClip does not grant permission to publish. Treat
uploading, Review Feed submission, social queueing, and posting as separate
external actions that require their own request.

## Hand off operationally

Report:

- invocation and version/help source used
- lane selected and why
- workspace and important artifacts
- actual cost summary and any unpriced calls
- verification performed and current verdict
- approval or repair still required
- exact safe next command

When blocked, include the command, exact error, failed stage, preserved
workspace, and the least expensive resume command.
