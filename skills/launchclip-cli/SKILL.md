---
name: launchclip-cli
description: Operate, explain, troubleshoot, or automate the LaunchClip CLI for repository, product, topic, voiceover, presenter, and promotion-packet video workflows. Use when an agent needs to choose LaunchClip commands, prepare inputs, run or resume the model-directed production pipeline, inspect costs and artifacts, validate a workspace, render after approval, or use the legacy dry-run packet lane. Distinguish API-backed CLI production from the separate subscription-agent workflow.
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

## Run the smallest useful command

Prefer a single `produce` command for a new model-directed production and stage
commands for a resume or repair. Reuse the same workspace so receipt-backed
stages can cache valid artifacts.

Use `--fast-eval` to reduce provider and snapshot budgets, not to claim a free
run. Use `--no-audio` to skip generated voice, music, and SFX, not to skip model
planning, frame authoring, critique, or repairs. Treat `--max-frame-cost-usd` as
a cumulative guard for direct-frame provider responses only, not as a total
pipeline budget.

Use `--model-policy cost-aware` by default: Terra plans, Luna authors, and only
failed frames escalate through Terra to Sol. Use `local-first` only when Ollama
is running; it prepends the configured local coder model. Use explicit repeated
`--frame-route` or `--repair-route` values when no unapproved cloud fallback is
allowed. Ollama uses its native structured-output API with a deterministic 32K
context; `OLLAMA_CONTEXT_LENGTH` can override that allocation. Repairs are
bounded exact source edits, not complete frame rewrites. Do not raise
`--max-patch-ratio` merely to make a failed repair pass.

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
- the exact draft, snapshot, QA, or review paths

Do not claim success when the command produced `needs-repair`, incomplete cost
classification, stale verification, or an infrastructure failure. Fix
toolchain failures before invoking model repair; provider repair cannot fix a
missing browser, FFmpeg, or HyperFrames installation.

## Respect final approval

`produce` stops at an analyzed draft. When verification is fresh and the
independent critic says the draft is ready, run
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
