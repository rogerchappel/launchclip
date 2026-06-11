# Tasks

## V1 Complete

- [x] Scaffold dependency-free Node CLI.
- [x] Implement `init`, `demo`, `plan`, `captions`, `render`, `submit-review`, and `review`.
- [x] Emit required launchclip workspace artifacts.
- [x] Keep product-videogen and Clutch Cut writes dry-run only.
- [x] Add fixture-backed unit tests.
- [x] Add real CLI smoke flow.
- [x] Add agent skill, orchestration docs, and README quickstart.
- [x] Add one-command dry-run workflow for repeat social packet generation.
- [x] Add social-readiness validation for required artifacts, stages, claim status, and caption length limits.
- [x] Add `local-ffmpeg` render provider for uploadable vertical MP4 and thumbnail output.
- [x] Make the local renderer command-led and animated instead of a long static slideshow.
- [x] Add a `ugc-split` planning preset for automated creator-led product shorts.
- [x] Add a provider-neutral talking-head contract with HeyGen as the first adapter target.
- [x] Add a deterministic script and script-to-visual alignment timeline for UGC-style clips.

## Follow-Up

- [ ] Add product-videogen `POST /api/v1/review-items` endpoint or compatible ingestion path.
- [ ] Add optional `cutpilot` adapter when local footage exists.
- [ ] Add Remotion and Hyperframes adapter contracts.
- [ ] Add a real presenter/B-roll renderer for `ugc-split` using product-videogen, Remotion, or another approved generation backend.
- [ ] Add live HeyGen API integration once credentials, avatar defaults, and approval flow are configured.
- [ ] Add richer repo discovery for non-Node projects.
- [ ] Add configurable claim templates and evidence linting.
- [ ] Add real platform-specific media specs once product-videogen exposes final queue requirements.
