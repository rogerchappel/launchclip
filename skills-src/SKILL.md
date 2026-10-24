<!-- include: renderers/{renderer}/intro.md -->

<!-- include: shared/quick-path.md -->

## Existing recordings

<!-- include: shared/recorded-route.md -->

## References (load on demand)

Read a reference when its step comes up, not all at once.

- [references/workflow.md](references/workflow.md): the full workflow behind
  the quick path: cost boundary, intake defaults, style packs, reference
  mimicry, HeyGen avatars, music and SFX decisions, the planning artifacts,
  media analysis, the design and retention floor, the step-by-step author and
  repair order, review, approval and the final render.
- [references/cinematic-production.md](references/cinematic-production.md):
  the creative funnel (concept tournament, retention story, candidates,
  critic) with the receipt schemas `cinematic-check` validates.
<!-- include: renderers/{renderer}/runtime-contract.md -->
- [references/storyboard-modules.md](references/storyboard-modules.md): every
  module, its params and events, transitions, grammar and camera, anchors and
  the safe-zone and caption rules.
- [references/subject-effects.md](references/subject-effects.md): effects that
  use the presenter cut out of a recording (a word behind their head, a dolly
  zoom): probing and matting the recording, the behind layer and its rules.
- [references/shorts-delivery.md](references/shorts-delivery.md): the
  delivery floor for portrait videos of 60 seconds or less: default
  word-highlight captions, the Shorts safe zone, −14 LUFS / −1 dBTP mastering,
  a local synthesized SFX/music kit, grain and vignette texture, and loop
  endings.
- [references/demo-setup.md](references/demo-setup.md): writing a SaaS
  repo's demo recipe with `launchclip demo doctor`. It covers the setup ladder
  (a plan only, a test session, or fixtures reused from e2e mocks), what to
  show the person, the check loop and flows drafted from docs placeholders.
- [references/sfx-library.md](references/sfx-library.md),
  [references/editorial-ui-modules.md](references/editorial-ui-modules.md),
  [references/recorded-video.md](references/recorded-video.md),
  [references/finishing-in-an-nle.md](references/finishing-in-an-nle.md): the
  SFX library, editorial modules, recorded footage and NLE export.

The planning artifacts `cinematic-check` expects for a new story:
`BRIEF.md`, `EVIDENCE.md`, `CONCEPTS.json`, `STORY.json`, `SCRIPT.md`,
`NARRATION.json`, `STORYBOARD.md`, `storyboard.json`, `DESIGN.md`,
`SOURCE.md`, `AUDIO-MANIFEST.json`, `QUALITY.md`,
`qa/rendered-candidates.json`, `qa/temporal-evidence/manifest.json` and, from
the gate itself, `CINEMATIC-READINESS.json`. Each is described in
[references/workflow.md](references/workflow.md).
