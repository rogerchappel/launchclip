## Freeze the brief and evidence

For new-story cinematic creation, create these planning artifacts inside the
output project before authoring the composition. Recorded treatments use the
artifacts specified in `references/recorded-video.md`, without concept/story
tournament receipts:

- `BRIEF.md`: source, audience, promise, CTA, destination, aspect, duration,
  language, interaction mode, cost mode, supplied assets, permissions,
  constraints, and the style: the named pack or brand, or the seed and the
  art-direction constraints it was generated from
- `EVIDENCE.md`: factual claims and their source locations; label inference,
  opinion, and unverified claims explicitly
- `CONCEPTS.json` (`launchclip.concepts.v1`): five distinct treatments,
  complete fresh-context scorecard, deterministic winner (`chosen: true`), and
  required improvements
- `STORY.json` (`launchclip.story-receipt.v1`): the independently edited
  canonical retention story (`concept_id`, `beats`, `narration.source`) and
  its score-floor receipt; both schemas, with examples, are in
  `references/cinematic-production.md`, and `cinematic-check` validates them
- `SCRIPT.md`: the exact approved narration; omit only for an intentionally
  unnarrated piece
- `NARRATION.json`: measured word/beat timings from the real take, or an
  explicit editorial grid for an intentionally unnarrated piece
<!-- renderer: hyperframes -->
- `STORYBOARD.md`: time-coded scenes, spoken beat, visible idea, on-screen copy,
  assets, motion development, transition, and audio intent
<!-- /renderer -->
<!-- renderer: remotion -->
- `STORYBOARD.md`: time-coded scenes, spoken beat, visible idea, on-screen copy,
  assets, motion development, transition, and audio intent
- `storyboard.json`: the primary build artefact (`launchclip.story.v1`): format,
  brand, audio, one scene per storyboard shot with its catalogue `module` and
  `params`, typed `in` transitions, word or beat anchored `hits`, overlays
  and ending. The Remotion composition, audio cues, captions, layout check and
  evidence schedule are all derived from it
<!-- /renderer -->
- `DESIGN.md`: project-specific palette roles, typography, composition logic,
  image treatment, motion character, and forbidden motifs
- `SOURCE.md`: media probes, silence-trim receipt, transcript location, overview
  contact sheet, dense opening strip, detected cut points, and any reference
  cadence observations
- `AUDIO-MANIFEST.json`: absolute local voice/music paths and SFX manifest when
  audio is expected
- `QUALITY.md`: project-specific pass/fail targets for typography, hierarchy,
  hook timing, change cadence, transition variety, motion physics, safe areas,
  source fidelity, and final artifact probing
- `qa/rendered-candidates.json`: rendered-pixel comparison for two independent
  opening candidates and one representative high-risk transition grammar,
  including scores, deterministic winner, and rejection reasons
- `qa/temporal-evidence/manifest.json`: hashed hook, sequence, transition,
  event, and settle evidence reviewed by the fresh-context critic
- `CINEMATIC-READINESS.json`: generated only by the local cinematic check after
  the draft, critic receipt, and all required evidence exist

Use supplied narration as authoritative. Do not silently rewrite it. Avoid
inventing product capabilities, performance numbers, testimonials, research
findings, or repository behavior. References may guide pacing or editorial
structure, but do not copy their footage, audio, likeness, branding, or exact
design.
