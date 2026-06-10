# launchclip

`launchclip` turns a local OSS repo into a reviewable promotion packet: demo evidence, a short-form video plan, platform captions, and a product-videogen Review Feed dry-run payload.

It is local-first and dry-run-first. V1 does not post to social platforms, queue Clutch Cut items directly, publish packages, or submit live product-videogen requests without future explicit integration and human approval.

## Quickstart

```bash
npm install

launchclip run ./my-oss-tool \
  --out .launchclip/my-oss-tool \
  --demo-cmd "npm run smoke" \
  --angle "turns demo proof into launch content" \
  --audience "developers shipping small OSS tools"
```

That creates the full dry-run packet, validates it for social review, and writes `REVIEW.md`.

You can also run each stage by hand:

```bash
launchclip init ./my-oss-tool --out .launchclip/my-oss-tool
launchclip demo ./my-oss-tool --out .launchclip/my-oss-tool --demo-cmd "npm run smoke" --capture terminal
launchclip plan .launchclip/my-oss-tool --format short-30 --renderer none
launchclip captions .launchclip/my-oss-tool --platforms x,linkedin,tiktok,bluesky
launchclip render .launchclip/my-oss-tool --provider product-videogen --dry-run
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
    command-receipt.json
  video/
    video.json
    brief.md
    render-plan.json
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

`launchclip run` executes the full dry-run workflow. `init` inspects a repo for README and package metadata, then creates a workspace manifest. `demo` runs only the command you explicitly provide and stores terminal evidence. `plan` writes a video-skillkit-compatible `video.json`, a human brief, and a renderer handoff plan. `captions` writes platform drafts with claim status and optional `--angle`, `--audience`, and `--cta-url` context. `render` and `submit-review` create dry-run product-videogen payloads. `validate` checks required artifacts, stage status, caption presence, claim status, and X/Bluesky/LinkedIn/TikTok length limits. `review` rolls the packet into one human-readable file.

## Product-Videogen Handoff

The preferred future API is:

```http
POST /api/v1/review-items
```

The dry-run payload uses `approval_status: "pending"`, `metadata_json` for source repo and launch metadata, and `recipe_json` for video manifest, demo artifacts, captions, and provenance. Product-videogen remains responsible for approval and any downstream social queue sync.

## Limitations

- Renderer adapters are planning-only in V1.
- Live product-videogen submission is intentionally disabled.
- Claims are grounded in local repo files and captured demo output; no unsupported performance or adoption claims are generated.
- Demo commands can have side effects inside the target repo, so agents should ask before running non-trivial commands.

## Safety Notes

- Dry-run is the default and only implemented product-videogen mode.
- No social posting or Clutch Cut queue writes.
- No secrets are required.
- Receipts store command, status, paths, and API shape, not credentials.

## Verification

```bash
npm test
npm run smoke
npm run check
```
