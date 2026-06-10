# Orchestration

`launchclip` is the promotion orchestration layer between a local OSS repo and downstream review/render/posting systems.

## Stages

1. `init` reads repo metadata and creates `launchclip.json`.
2. `demo` captures an explicitly approved terminal command and writes a receipt.
3. `plan` emits a video-skillkit-compatible manifest and brief.
4. `captions` writes editable, platform-specific, evidence-backed drafts.
5. `render` creates a product-videogen dry-run render/review payload.
6. `submit-review` creates a pending Review Feed intake payload in dry-run form.
7. `review` creates `REVIEW.md` for human approval.

## Boundaries

- `video-skillkit`: manifest and grounded video brief semantics.
- `cutpilot`: future optional EDL and ffmpeg render handoff.
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
