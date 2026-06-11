# launchclip

`launchclip` turns a local OSS repo into a reviewable promotion packet: demo evidence, a short-form video plan, platform captions, and a product-videogen Review Feed dry-run payload.

It is local-first and dry-run-first. V1 does not post to social platforms, queue Clutch Cut items directly, publish packages, or submit live product-videogen requests without future explicit integration and human approval.

## Quickstart

```bash
npm install

launchclip run ./my-oss-tool \
  --out .launchclip/my-oss-tool \
  --demo-cmd "npm run smoke" \
  --demo-media "demo/screenshot.png" \
  --angle "turns demo proof into launch content" \
  --audience "developers shipping small OSS tools"
```

That creates the full dry-run packet, validates it for social review, and writes `REVIEW.md`.

To create an uploadable video from that packet:

```bash
launchclip plan .launchclip/my-oss-tool --format short-30 --style ugc-demo-punchy --renderer remotion --talking-head heygen
launchclip render .launchclip/my-oss-tool --provider remotion
```

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

`launchclip run` executes the full dry-run workflow. `init` inspects a repo for README and package metadata, then creates a workspace manifest. `demo` runs only the command you explicitly provide and stores terminal evidence with obvious API keys, tokens, passwords, and GitHub tokens redacted; `--demo-media` can also copy a UI screenshot or short demo video into the packet. `plan` writes a video-skillkit-compatible `video.json`, a human brief, and a renderer handoff plan; the default `proof-card` style is a tight `short-15` flow with usage, terminal proof, generated artifacts, and CTA beats. Use `--style ugc-split` for a 30-second creator-led split-screen recipe with presenter, generated/demo B-roll, burned-in captions, numbered steps, artifact reveal, and approval-safe CTA. Use `--style ugc-demo-punchy` for the more social-ready version: seven short beats, first-frame hook, visible friction, real demo proof, script-to-visual alignment panels, fast artifact flashes, kinetic captions, motion/transition instructions, and a review-safe CTA. The plan also includes a deterministic `launchclip.script.v1` script and `script_visual_alignment` timeline so each spoken beat has a matching caption, visual, evidence source, adapter target, motion cue, and transition. `captions` writes deterministic platform drafts with claim status and optional `--angle`, `--audience`, and `--cta-url` context; it does not call an LLM. `render --provider product-videogen --dry-run` creates a dry-run product-videogen payload. `render --provider remotion` creates an uploadable vertical MP4 at `video/launchclip.mp4`, a thumbnail, and `video/remotion-props.json`; for `ugc-demo-punchy`, the Remotion composition turns the script timeline into frame-based motion graphics, kinetic captions, proof panels, output cards, and artifact reveals. `render --provider local-ffmpeg` remains a dependency-light fallback. `submit-review` creates the dry-run product-videogen review payload. `validate` checks required artifacts, stage status, script/visual alignment, caption presence, claim status, media presence when locally rendered, and X/Bluesky/LinkedIn/TikTok length limits. `review` rolls the packet into one human-readable file.

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

This still does not generate the real HeyGen talking-head footage. It produces a deterministic Remotion preview with motion graphics from the same script contract that future HyperFrames, HeyGen, or product-videogen adapters can consume.

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
npm test
npm run smoke
npm run check
```
