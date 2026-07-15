# launchclip

`launchclip` turns a local OSS repo into a reviewable promotion packet: demo evidence, a short-form video plan, platform captions, and a product-videogen Review Feed dry-run payload.

It is local-first and dry-run-first. V1 does not post to social platforms, queue Clutch Cut items directly, publish packages, or submit live product-videogen requests without future explicit integration and human approval.

## Install

LaunchClip requires Node.js 22 or newer. Local video rendering also needs
FFmpeg/`ffprobe`; `launchclip doctor` reports the exact local capabilities
without printing credential values.

Install the published CLI from npm:

```bash
npm install --global launchclip
launchclip --version
launchclip doctor
```

Or build and link the CLI from source:

```bash
git clone https://github.com/rogerchappel/launchclip.git
cd launchclip
npm ci
npm run release:check
npm link
launchclip doctor
```

## Quickstart

```bash
launchclip run ./my-oss-tool \
  --out .launchclip/my-oss-tool \
  --demo-cmd "npm run smoke" \
  --demo-media "demo/screenshot.png" \
  --angle "turns demo proof into launch content" \
  --audience "developers shipping small OSS tools"
```

That creates the full dry-run packet, validates it for social review, and writes `REVIEW.md`.

## Agent Skills

Launchclip ships two agent-facing skills for different cost and execution
models:

- [`launchclip-create-video`](skills/launchclip-create-video/SKILL.md) extracts
  the creative orchestration into a subscription-agent workflow. Codex, Claude,
  or another capable coding agent conducts a compact intake, plans and authors
  the HyperFrames composition itself, runs local QA, pauses for preview
  approval, and renders without calling Launchclip's metered model stages. It
  is self-contained and does not require the HyperFrames plugin skill pack.
- [`launchclip-cli`](skills/launchclip-cli/SKILL.md) teaches an agent to operate
  the existing CLI, including `produce`, resumable production stages, the
  local-first promotion packet lane, cost receipts, and approval gates. The
  complete model-directed CLI still needs API access for planning and critique,
  but frame authoring and repair can run through local Ollama or OpenRouter. A
  ChatGPT, Codex, or Claude OAuth login is not an API key.

The repository is also a Codex plugin: [`.codex-plugin/plugin.json`](.codex-plugin/plugin.json)
exposes both skill directories. npm installs carry the manifest and skills but
do not automatically register them with an agent. For a source-based Codex
install, load the repository as a plugin or link an individual skill into the
shared agent skill directory:

```bash
mkdir -p "$HOME/.agents/skills"
ln -s "$PWD/skills/launchclip-create-video" "$HOME/.agents/skills/launchclip-create-video"
```

This subscription-agent workflow uses the active agent for creative reasoning;
it does not require `OPENAI_API_KEY`. Point another capable agent directly at
the relevant `SKILL.md` if it uses a different skill-discovery convention. The
root [`SKILL.md`](SKILL.md) remains the compatibility workflow for the original
OSS promotion packet.

## Model-Directed HyperFrames Production

The newer production lane accepts a GitHub/local repository, product URL,
topic, research resources, screenshots, screen recordings, supplied narration,
or presenter video. GPT-5.6 directs the narrative and art direction from
evidence; Launchclip owns schemas, media paths, HyperFrames assembly, bounded
repairs, and approval gates.

```bash
launchclip produce https://github.com/owner/repo \
  --out .launchclip/repo-video \
  --prompt "Lead with the workflow change" \
  --reference https://www.youtube.com/shorts/example \
  --aspect 9:16 \
  --duration 45 \
  --voice-id "$ELEVENLABS_VOICE_ID"

# Faster evaluation with smaller model/snapshot budgets; completed stages resume.
launchclip produce https://github.com/owner/repo \
  --out .launchclip/repo-fast-eval \
  --no-audio \
  --fast-eval

# Local model first for HTML frames and small repairs; failed scenes may
# escalate to Luna, Terra, then Sol.
launchclip produce https://github.com/owner/repo \
  --out .launchclip/repo-local-first \
  --model-policy local-first \
  --local-model qwen2.5-coder:latest

# Re-render, re-analyze, and re-critique the existing assembled project only.
launchclip production-draft .launchclip/repo-video \
  --reference-video ./reference-short.mp4

launchclip production-repair .launchclip/repo-video
launchclip assemble .launchclip/repo-video
launchclip production-preview .launchclip/repo-video
# After reviewing or editing in Studio and explicitly approving the result:
launchclip production-render .launchclip/repo-video --approve
```

The default `cost-aware` policy plans with Terra, authors with Luna, and
escalates only failed scenes. `local-first` prepends Ollama. To guarantee that a
resume cannot make a paid call, pin the repair route explicitly:

```bash
launchclip production-repair .launchclip/repo-video \
  --repair-route ollama:qwen2.5-coder:latest@none
```

Ollama routes use its native JSON-schema API with temperature `0`, a fixed
seed, and a 32K context by default. Override that allocation with
`OLLAMA_CONTEXT_LENGTH` when the selected model or machine needs a different
limit. Larger frame sources benefit from the full context but take longer to
evaluate on small local models.

Repairs are bounded, uniquely anchored source edits. Launchclip rejects broad
HTML rewrites, applies the edit to the existing frame, and reruns the complete
frame contract before accepting it. Each pass receives at most four blocking
findings per shot, ranked with runtime and motion failures first, so the model
solves a small coherent batch instead of rewriting around an entire QA report.
Use `--repair-issues-per-shot` to lower that batch size for a difficult scene.

`production-preview` starts or reuses the local HyperFrames Studio server and
returns the editable project URL without rendering. Studio's Export control is
useful for ad hoc previews, but it is not a Launchclip approval signal or final
artifact. After approval, `production-render --approve` re-verifies any Studio
edits, runs the strict final render, and records Launchclip's motion, audio, and
critic results.

For a supplied avatar/presenter take, pass the media as both the authoritative
voice source and presenter resource when appropriate:

```bash
launchclip produce "Product workflow" \
  --voiceover ./presenter-take.mp4 \
  --transcript ./presenter-take.txt \
  --presenter ./presenter-take.mp4 \
  --assets ./brand-assets \
  --style soft-grid-editorial \
  --cta "Start a workspace" \
  --aspect 16:9
```

`--assets` accepts a file or directory and is an intent-revealing alias for
supporting resources. Directories are catalogued automatically from filenames
and folder structure. An optional `assets.json` can override usage, entity
hints, tags, priority, and licensing for individual relative paths; the media
remains usable without a manifest.

Authoritative local voiceover media is silence-trimmed before evidence,
transcription, and planning so every later timestamp uses the prepared clip.
The original is never overwritten. Use `--no-trim-silence` to opt out, or rerun
only this free stage with `launchclip source-preprocess <workspace>`.

Reusable company marks can live outside every repository in
`~/.launchclip/brand-assets` (or `LAUNCHCLIP_BRAND_ASSETS_DIR`). Launchclip reads
`brands.json`, resolves transcript mentions to canonical display names, and
adds matching local files as checksummed planning resources. Normal product
aliases and known speech-to-text mistakes are separate so a valid product name
is not accidentally “corrected”:

```json
{
  "schema_version": "launchclip.brand-library.v1",
  "brands": [
    {
      "id": "refiant",
      "canonical_name": "Refiant AI",
      "display_name": "Refiant",
      "aliases": ["Refiant"],
      "asr_aliases": ["Refine"],
      "domains": ["refiant.ai"],
      "assets": [
        { "kind": "logo", "variant": "default", "path": "refiant/logo.svg" }
      ]
    }
  ]
}
```

These personal assets are not copied into source control. During assembly the
selected files are frozen into the ignored production workspace, so a future
script that mentions the same company can reuse them without another upload.

Styles are generative design systems rather than fixed scene templates.
`--style auto` derives project-specific style DNA from the subject and assets;
`--style <family>` supplies a creative family; `--style-file frame.md` applies a
reusable video design specification; and `--style-reference` supplies visual
direction. The generated plan freezes exact colors, type roles, shape and
diagram language, presenter treatment, motion physics, transitions, and
forbidden motifs while leaving composition driven by each narrated concept.

Every planned shot carries semantic visual objects, continuity handoffs, and
named visible events. SFX cues must bind to those events, and production
verification stops before browser or render work if a planned event is missing
from the assembled motion sidecar or a sound has no visible consequence.

The command creates an editable assembled project, analyzed draft, independent
critic report, and up to two bounded repair passes. Final rendering requires the
explicit `--approve` flag and still returns for human review; it never publishes.
Use `production-preview <workspace>` to open the assembled project in Studio
before granting that approval. Do not treat Studio Export as completion of the
Launchclip final-render stage.
See [the model-directed pipeline](docs/MODEL_DIRECTED_VIDEO.md) for
artifact contracts, provider requirements, reference analysis, and repair
semantics.

For a short OSS promotion recording outline, see
[docs/promo/oss-packet-demo-brief.md](docs/promo/oss-packet-demo-brief.md). For
review-gated draft post copy, see
[docs/promo/social-hooks.md](docs/promo/social-hooks.md).

Resource directories are expanded into checksummed file-level inputs. Supported
YouTube references are staged locally with `yt-dlp` (15-minute limit) for visual,
transcript, pacing, and frame-motion analysis, then kept out of the final media
assets. Only analyze references you are authorized to use. A local
`--reference-video` remains available for media that cannot be staged.

SVG resources remain immutable, but GPT vision receives a derived PNG. Install
ImageMagick (`magick` or `convert`) or use macOS `sips` for that normalization;
the CLI reports a concrete error when none is available.

The repository-local SFX pack is the default during source development. Until
its redistribution terms are approved for the npm artifact, packaged installs
must pass an authorized pack with `--sfx-dir /path/to/sfx`.

To create an uploadable video from that packet:

```bash
launchclip plan .launchclip/my-oss-tool --format short-30 --style ugc-demo-punchy --renderer remotion --talking-head heygen
launchclip render .launchclip/my-oss-tool --provider remotion
```

For the higher-quality HyperFrames path:

```bash
launchclip plan .launchclip/my-oss-tool --format short-30 --style premium-product-short --renderer hyperframes
launchclip render .launchclip/my-oss-tool --provider hyperframes --quality high
```

HyperFrames renders use the CLI version bundled with LaunchClip to run `lint`,
`validate`, and `inspect --json` before producing the MP4. Use
`--skip-quality-gates` only for draft iteration.

You can also run each stage by hand:

```bash
launchclip init ./my-oss-tool --out .launchclip/my-oss-tool
launchclip demo ./my-oss-tool --out .launchclip/my-oss-tool --demo-cmd "npm run smoke" --capture terminal --demo-media demo/screenshot.png
launchclip plan .launchclip/my-oss-tool --format short-15 --renderer none
launchclip plan .launchclip/my-oss-tool --format short-30 --style ugc-split --renderer product-videogen --talking-head heygen
launchclip plan .launchclip/my-oss-tool --format short-30 --style ugc-demo-punchy --renderer remotion --talking-head heygen
launchclip captions .launchclip/my-oss-tool --platforms x,linkedin,tiktok,bluesky
launchclip render .launchclip/my-oss-tool --provider product-videogen --dry-run
launchclip render .launchclip/my-oss-tool --provider remotion
launchclip render .launchclip/my-oss-tool --provider local-ffmpeg
launchclip submit-review .launchclip/my-oss-tool --provider product-videogen --dry-run
launchclip review .launchclip/my-oss-tool
launchclip validate .launchclip/my-oss-tool
```

Expected packet:

```text
.launchclip/<repo>/
  launchclip.json
  demo/
    terminal.txt
    media.png
    command-receipt.json
  video/
    video.json
    brief.md
    render-plan.json
    hyperframes/
      DESIGN.md
      QUALITY.md
      index.html
    remotion-props.json
    launchclip.mp4
    thumbnail.png
    product-videogen.dry-run.json
  captions/
    x.md
    linkedin.md
    tiktok.md
    bluesky.md
  review/
    product-videogen-review.dry-run.json
    product-videogen-review.receipt.json
    social-readiness.json
    receipt.json
  REVIEW.md
```

## How It Works

`launchclip run` executes the full dry-run workflow. `init` inspects a repo for README and package metadata, then creates a workspace manifest. `demo` runs only the command you explicitly provide and stores terminal evidence with obvious API keys, tokens, passwords, and GitHub tokens redacted; `--demo-media` can also copy a UI screenshot or short demo video into the packet. `plan` writes a video-skillkit-compatible `video.json`, a human brief, and a renderer handoff plan; the default `proof-card` style is a tight `short-15` flow with usage, terminal proof, generated artifacts, and CTA beats. Use `--style ugc-split` for a 30-second creator-led split-screen recipe with presenter, generated/demo B-roll, burned-in captions, numbered steps, artifact reveal, and approval-safe CTA. Use `--style ugc-demo-punchy` for the more social-ready version: seven short beats, first-frame hook, visible friction, real demo proof, script-to-visual alignment panels, fast artifact flashes, kinetic captions, motion/transition instructions, and a review-safe CTA. The plan also includes a deterministic `launchclip.script.v1` script, `script_visual_alignment` timeline, and `launchclip.storyboard.v1` creative storyboard so each beat carries layout, composition, media slots, motion grammar, typography, color grade, and quality gates before any renderer starts. `plan --renderer hyperframes` writes an editable HyperFrames project with `DESIGN.md`, `QUALITY.md`, QA pages, lifecycle object templates, transition-masked scenes, and SFX metadata. `captions` writes deterministic platform drafts with claim status and optional `--angle`, `--audience`, and `--cta-url` context; it does not call an LLM. `render --provider product-videogen --dry-run` creates a dry-run product-videogen payload. `render --provider hyperframes` runs HyperFrames lint, validate, and inspect before rendering `video/launchclip-hyperframes.mp4`; for draft iteration, pass `--skip-quality-gates`. `render --provider remotion` creates an uploadable vertical MP4 at `video/launchclip.mp4`, a thumbnail, and `video/remotion-props.json`; for `ugc-demo-punchy`, the Remotion composition follows the storyboard with creator-frame slots, device-capture proof, editor timeline motion, artifact inspection, and review-safe CTA. `render --provider local-ffmpeg` remains a dependency-light fallback. `submit-review` creates the dry-run product-videogen review payload. `validate` checks required artifacts, stage status, script/visual alignment, storyboard completeness, caption presence, claim status, media presence when locally rendered, and X/Bluesky/LinkedIn/TikTok length limits. `review` rolls the packet into one human-readable file.

## UGC Split Style

For automated product shorts that feel closer to a creator-led UGC clip, plan with:

```bash
launchclip plan .launchclip/my-oss-tool \
  --format short-30 \
  --style ugc-split \
  --renderer product-videogen \
  --talking-head heygen \
  --avatar-id avatar_123
```

This does not copy reference footage or a creator likeness. It emits an original `creative_recipe` for product-videogen or a future renderer: vertical split-screen, generated or captured B-roll, talking-head presenter direction, large burned-in captions, numbered workflow steps, artifact montage, and a human-approval CTA.

`ugc-split` defaults to a provider-neutral talking-head contract with HeyGen as the first adapter target. The plan and dry-run payload include `talking_head.provider`, optional `avatar_id` and `voice_id`, script segments, B-roll slots, and consent/safety requirements. They also include a consistent script timeline where every voiceover segment points to the exact visual treatment and evidence source that should appear on screen. Add another presenter vendor later by mapping that same `launchclip.talking-head.v1` contract instead of changing the creative style.

## Social-Ready UGC Preview

For a punchier local preview, use:

```bash
launchclip plan .launchclip/my-oss-tool \
  --format short-30 \
  --style ugc-demo-punchy \
  --renderer remotion \
  --talking-head heygen

launchclip render .launchclip/my-oss-tool --provider remotion
```

This still does not generate the real HeyGen talking-head footage. It produces a deterministic Remotion preview with motion graphics from the same script and storyboard contracts that future HyperFrames, HeyGen, or product-videogen adapters can consume. The storyboard intentionally rejects retro terminal art and consecutive static text cards; terminal output is treated as evidence inside a broader creator-led edit.

## Product-Videogen Handoff

The preferred future API is:

```http
POST /api/v1/review-items
```

The dry-run payload uses `approval_status: "pending"`, `metadata_json` for source repo and launch metadata, and `recipe_json` for video manifest, demo artifacts, captions, and provenance. Product-videogen remains responsible for approval and any downstream social queue sync.

## Limitations

- Remotion rendering is the primary local social-preview path. It creates motion graphics from repo facts, captions, captured terminal evidence, and social-ready script beats, but it is still not a substitute for real HeyGen presenter footage or generated B-roll.
- Local ffmpeg rendering is intentionally dependency-light and remains available as a fallback text-forward vertical preview.
- Live product-videogen submission is intentionally disabled.
- Claims are grounded in local repo files and captured demo output; no unsupported performance or adoption claims are generated.
- Demo commands can have side effects inside the target repo, so agents should ask before running non-trivial commands.
- Redaction catches obvious secret patterns in command receipts and terminal output, but it is not a substitute for running safe demo commands.

## Safety Notes

- Dry-run is the default and only implemented product-videogen mode.
- No social posting or Clutch Cut queue writes.
- No secrets are required.
- Receipts store command, status, paths, and API shape, not credentials.
- Terminal evidence and stored demo commands redact common token, API key, secret, and password patterns.

## Verification

```bash
npm run release:check
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development expectations and [SECURITY.md](SECURITY.md) for vulnerability reporting and data handling guidance.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
