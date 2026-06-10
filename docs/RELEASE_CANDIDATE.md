# Release Candidate

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
- Renderer adapters are contract placeholders.
- Repo discovery is intentionally conservative.

## Product-Videogen Follow-Up

Add or expose `POST /api/v1/review-items` for external pending Review Feed items that accept launch metadata in `metadata_json` and edit/demo provenance in `recipe_json`.
