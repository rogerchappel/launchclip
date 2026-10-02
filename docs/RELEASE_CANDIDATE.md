# Release Candidate

Historical V1 release-candidate checklist (June 2026). The recorded classification
below is not a fresh verification of later production features. Current setup:
[ShipMode module](../courses/shipmode/README.md) and
[model-directed production](MODEL_DIRECTED_VIDEO.md).

Classification: ship

## Verification

Run:

```bash
npm test
npm run smoke
npm run check
```

## Current Limitations

- Live product-videogen submission is disabled.
- Product-videogen handoffs remain dry-run contracts. HyperFrames, local FFmpeg, and Remotion rendering are implemented; their runtime/toolchain requirements differ.
- Repo discovery is intentionally conservative.
- Secret redaction covers common token/key/password patterns, but reviewers should still inspect generated artifacts before sharing.

## Product-Videogen Follow-Up

Add or expose `POST /api/v1/review-items` for external pending Review Feed items that accept launch metadata in `metadata_json` and edit/demo provenance in `recipe_json`.
