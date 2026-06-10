# Orchestration

`launchclip` is the promotion orchestration layer between a local OSS repo and downstream review/render/posting systems.

## Stages

1. `init` reads repo metadata and creates `launchclip.json`.
2. `demo` captures an explicitly approved terminal command and writes a receipt.
3. `plan` emits a video-skillkit-compatible manifest and brief.
4. `captions` writes editable, platform-specific, evidence-backed drafts.
5. `render` creates either a product-videogen dry-run render/review payload or a local ffmpeg MP4.
6. `submit-review` creates a pending Review Feed intake payload in dry-run form.
7. `validate` checks required artifacts, stage status, caption claim status, and platform length limits.
8. `review` creates `REVIEW.md` for human approval.

For repeatable social workflows, `run` executes the whole dry-run sequence:

```bash
launchclip run <repo> --out <workspace> --demo-cmd "npm run smoke" --angle "..." --audience "..."
```

The optional `--angle`, `--audience`, and `--cta-url` flags tune platform captions without changing the safety boundary. The default video plan is `short-15`, not `short-30`, so CLI tools get a concise command-led demo instead of a padded slide deck.

To create an uploadable local video after the packet exists:

```bash
launchclip render <workspace> --provider local-ffmpeg
```

This writes `video/launchclip.mp4` and `video/thumbnail.png` from the repo facts, example `launchclip` commands, caption draft, and captured terminal evidence. The local renderer uses animated terminal-style frames with command reveal, output reveal, generated artifact checklist, progress motion, and CTA. Caption generation is deterministic template logic; it does not call an LLM.

## Boundaries

- `video-skillkit`: manifest and grounded video brief semantics.
- `local-ffmpeg`: built-in text-forward vertical MP4 render for immediate upload.
- `cutpilot`: future optional EDL and advanced ffmpeg handoff.
- `postmaker`: caption grounding and claim-status inspiration.
- `product-videogen`: Review Feed approval lane and downstream social queue sync.
- Clutch Cut: reachable only through product-videogen after approval, never directly in V1.

## Product-Videogen API Gap

V1 can emit this dry-run request without requiring the endpoint:

```http
POST /api/v1/review-items
```

Required fields:

- `content_type`
- `source=launchclip`
- `title`
- `approval_status=pending`
- `social_caption`
- `metadata_json`
- `recipe_json`

`metadata_json` should include source repo path/URL, platform targets, workspace, safety policy, and claim status. `recipe_json` should include the video manifest, demo artifacts, captions, and provenance.

## Release Readiness

A release candidate is ready when `npm test`, `npm run smoke`, and `npm run check` pass and a human reviews the generated packet from the smoke fixture or a real target repo.

## Social Readiness

`launchclip validate <workspace>` writes `review/social-readiness.json` and returns `ready` only when:

- Required packet artifacts exist.
- Pipeline stages have the expected dry-run statuses.
- A locally rendered packet has its MP4 and thumbnail present.
- Captions exist for generated platforms.
- Captions include `Claim status:`.
- X and Bluesky drafts fit their platform limits.
