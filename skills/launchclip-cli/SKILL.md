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

- **Local recorded-video cleanup and capture planning:** use `edit-recording`
  and `broll-plan`; these call no paid models. Keep the last matching take,
  trim silence, preserve original media, and carry the edited word timings into
  the existing production/graphics workflow. See the recorded-video commands
  below. This is separate from the older `align` motion workflow.
- **Subscription/OAuth agent, no model API spend:** use the separate
  `launchclip-create-video` skill (HyperFrames), or
  `launchclip-create-video-remotion` when the user wants Remotion. Do not call
  `launchclip produce`.
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

## Recorded-video commands

```bash
launchclip edit-recording take.mov --out .launchclip/base-edit --aspect 16:9
launchclip broll-plan .launchclip/base-edit/transcript.json --out .launchclip/captures
launchclip intake .launchclip/base-edit/base-edit.mp4 \
  --transcript .launchclip/base-edit/transcript.json --aspect 16:9 \
  --assets ./captured-broll --out .launchclip/production
```

Cleanup uses installed local Whisper, or accepts a flat/Scribe/Whisper
word-timed JSON via `--recording-transcript`. It removes earlier matching
retakes automatically, with no take-ranking or take-selection approval.
The transcript-only fallback uses 0.8s gaps, 0.15s handles and a 90s nearby
retake window. Configure `--silence-duration`, `--silence-padding`,
`--retake-window`, `--min-repeat-words`, and `--recording-model` if needed.
`--no-trim-silence` leaves pauses while still removing repeated takes.
Recognized hesitation words and abandoned starts are removed by default;
`--keep-fillers` preserves them. Grammatical “but” is retained. Local FFmpeg
controls pause removal using acoustic pauses (0.4s minimum, 0.08s handles),
with a bounded waveform
and threshold receipt in `audio-analysis.json`. Configure `--audio-silence-duration`,
`--audio-silence-padding`, `--audio-threshold-db`, or `--no-audio-silence`.
A transcript that omits a filler cannot supply its cut timing.
After the cuts pass QA, the voice audio is cleaned (`--enhance light`, the
default: high-pass, measured hum notches, profile denoise, de-ess, 3:1
compression, -16 LUFS; `podcast` is stronger; `off` skips it) and the join QA
re-runs on the result. `audio-enhance.json` holds before/after metrics and any
denoise back-off. `--voice-isolation elevenlabs` (paid, cached) is opt-in only.

For semantic restarts, pass `--retake-decisions retakes.json` generated by the
active agent from the original word transcript, following `docs/semantic-retakes.md`.
Alternatively explicitly select an installed local Ollama model with
`--retake-model MODEL`. The later complete passage always wins. No paid fallback
or take-selection approval occurs; the default CLI alone matches lexical retakes.
Do not put recording-specific decisions, wording, or assets in Launch Clip code.

Post-render QA is part of cleanup: render → independently transcribe actual
video → compare words/inspect every join → semantic coherence check → safe
bounded repair/recheck. Selected speech defines the outer edges; wordless islands
are removed at every splice without filtering out short complete words.

Use `--qa-model MODEL` only for an explicitly selected installed local Ollama
model. In the subscription-agent route, the active agent automatically reads the
saved candidate, source context, rendered transcript, join evidence and issues,
then writes evidence-bound receipts according to `docs/recording-qa.md` and
resumes the same command with `--qa-decisions reviews.json`. The JSON can contain
`{reviews:[receipt]}` for successive attempts. This is automatic model work, not
human take-selection approval. Without either route semantic QA remains pending.
Do not claim a timing/ASR-only run checked coherence.

`--qa-attempts` defaults to three (maximum five). Safe boundary recoveries are
limited to 0.2s each/0.6s total and cannot resurrect rejected speech. Unsupported
or unproven issues remain `needs-attention`. Only passed candidates are published
as `base-edit.mp4`; pending QA stops production before downstream stages. Keep
all per-attempt evidence under `qa/`, including each actual transcript, plus the
final `rendered-transcript.json` and `recording-qa.json`. `--qa-recording-model`
configures local verification Whisper separately. No paid model is chosen.

For an existing production intake, use `source-preprocess <workspace>
--edit-recording [--recording-transcript word-timed.json]`. `produce` accepts
the same flags but its downstream model stages remain metered. Recording-edit
mode persists with the source so a later run cannot restore raw video with
edited transcript timings. To return to raw footage, create a fresh intake.

`recording.json` verifies cached edit artifacts. A changed source, settings,
engine, corrupted cache, or incomplete prior output needs a new output directory.
The editable B-roll tracker/checklist is preserved on reruns. The planner only
suggests capture cards; it does not record or automatically insert footage.
Actual supplied clips are already supported through resources and root media
requests in the production assembler.

For basic glass editorial overlays with supplied speech, use the recorded-video
reference in `launchclip-create-video`; do not force new narration or the full
cinematic concept funnel onto an existing story.

## Confirm inputs and side effects

Before a production run, determine:

- primary source and source kind
- output workspace (inside a library, a `launchclip.library.json` in the
  current folder or above, `--library` or `LAUNCHCLIP_LIBRARY`, `make` and
  `intake` without `--out` write under its `storage.projects`, possibly an
  external drive; `launchclip library init` creates one)
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

For storyboards, use a v2 pack: set `"style": "<name>"` in `storyboard.json`
(built-in starters: editorial-dark, bold-creator, minimal-tech,
warm-documentary, neon-explainer) and plan with `launchclip story plan --style
<name>`. To mimic earlier videos or a reference, draft a pack with `launchclip
style create <name> --from-reference a.mp4 [b.mp4 ...]`, review its
`reference-report.md`, and measure later renders with `launchclip style check
<project> --against <name>`. Upgrade v1 packs with `launchclip style upgrade
<name>`.

With no style and no brand (no `--style`, brand.json or logo), `make` and
`story plan` generate a seeded style, save it as
`.launchclip/styles/seed-<hex>/style.json`, name it in the storyboard and
print one line (`style: seed 7f3a91c2 (dark, playful, Unbounded / Inter)`).
The project then keeps it. `--seed <hex>` makes a given look again.
`launchclip style reroll [<project>] [--tone <tone>] [--undo]` is "a different
look": it keeps the art-direction constraints and changes the seed. Run
`launchclip finish` to render it. `launchclip style keep <project> --as
<name>` saves a look to `~/.launchclip/styles/<name>`. `launchclip style
generate [--seed] [--tone] [--theme] [--world] … [--out | --project]` writes a
pack directly.

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
