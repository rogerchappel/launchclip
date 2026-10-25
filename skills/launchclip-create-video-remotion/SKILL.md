---
name: launchclip-create-video-remotion
description: Create an end-to-end cinematic Remotion video, authored in React and TSX from a storyboard.json file, with the current subscription agent as the creative, editorial, and orchestration layer. Use when a user wants a high-quality portrait or landscape video, promo, explainer, product story, repository walkthrough, YouTube video, Short, Reel, or social clip from an idea, URL, repository, topic, brief, script, supplied media, a user-owned project style pack, or a downloaded HeyGen avatar, and wants Remotion rather than HyperFrames as the renderer, while avoiding LaunchClip's metered model pipeline and not depending on Remotion or HyperFrames plugin skills. storyboard.json is the primary artefact; catalogue modules from the bundled Remotion kit render it, and bespoke TSX modules are an escape hatch for flagship work. Use the recorded-video direction workflow for existing footage; use a five-concept tournament and cinematic readiness gate for new stories. Preserve narration, develop motion and sound together, and verify the rendered result.
---

# LaunchClip Create Video (Remotion)

Create a reviewable video with the current agent's included reasoning and local
Remotion tooling. `storyboard.json` is the artefact you author: the bundled
`LaunchclipStory` composition renders it with frame-pure React modules. Treat
this skill as the agent-native counterpart to `launchclip produce`, not as a
wrapper around it. Its sibling, `launchclip-create-video`, renders the same
storyboard with HyperFrames; the creative funnel and gates are identical.

## Quick path

The minimum, in order, for a new story (a 30–60 s Short or promo). Every step
names the reference that holds its detail; load a reference only when you
reach its step. `launchclip <command> --help` prints any command's usage.

There is also a CLI equivalent with no agent session: `launchclip make
"<prompt>" [--assets <dir>]` routes the inputs to a lane, writes the script
and storyboard with an API model (OpenAI or Anthropic key), and runs finish
headlessly ("Make a video headlessly" in the launchclip-cli reference). Use it
when the user wants a hands-off draft or has no agent subscription; use this
skill when they want the bespoke, reviewed path below.

1. **Brief.** Ask at most three grouped questions (story, delivery, materials
   and audio), default the rest, and write `BRIEF.md`, `EVIDENCE.md` and
   `SOURCE.md` into the output project (`.launchclip/agent-<slug>`).
   Details: [references/workflow.md](references/workflow.md) ("Conduct the
   compact intake", "Freeze the brief and evidence"). Pointed at a SaaS
   codebase? Record its key flows next with `launchclip demo record` ("Record
   the product (demo autopilot)" in the same reference) and show them as
   `product-demo` scenes.
2. **Concept and story.** Five distinct concepts judged in a fresh context →
   `CONCEPTS.json`; an independently edited retention story → `STORY.json`;
   the exact narration → `SCRIPT.md`.
   `cinematic-check` requires both receipts. Details:
   [references/cinematic-production.md](references/cinematic-production.md).
3. **Voice.** Put the script in `storyboard.json` `audio.narration`, run
   `launchclip voice <project>` (local Kokoro, cached), and adjust the text or
   `speed` until the measured take fits. It writes `NARRATION.json`; size
   `format.duration` and the scenes to that take.
4. **Direction map, then storyboard.** First write `DIRECTION.json` from
   [references/direction-map.md](references/direction-map.md): every
   narration line gets an intent and a treatment, aimed at the cadence
   profile in [references/profiles.md](references/profiles.md). Then write
   `storyboard.json` against it from
   [references/storyboard-modules.md](references/storyboard-modules.md):
   one catalogue module per scene, typed `in` transitions (the boundaries
   `cinematic-check` reads), and scene starts and hits anchored to narration
   words (`word:<text>`). Pick one `motion.grammar` and, for travel, the world
   camera. Check with `launchclip story validate` (it checks the map too) and
   `launchclip layout-check`. Also write `STORYBOARD.md`, `DESIGN.md` and
   `QUALITY.md`.
5. **Candidates.** Render two opening candidates and two for one risky
   transition, each from its own candidate project, with no paid calls:
   `launchclip finish <candidate> --candidate <id> --into <project>
   [--boundary <scene>]`. Score them from the pixels in
   `qa/rendered-candidates.json` (`cinematic-check` requires four admissible
   candidates). Details: "Render critical candidates" in
   [references/cinematic-production.md](references/cinematic-production.md).
6. **Draft.** Run
   `launchclip finish <project> --renderer remotion`
   to render `renders/draft.mp4` with voice, captions, music, SFX, the −14 LUFS
   master, `qa/temporal-evidence/manifest.json`, critic sheets and gates
   (`AUDIO-MANIFEST.json` included). Fix one scene with
   `--preview-scene <id>`, then `--scene <id>`.
7. **Critic.** A fresh-context critic reviews `qa/critic-sheets/` and the
   draft and writes `qa/critic.json`, citing every evidence ID it reviewed.
   Repair the smallest responsible scene, at most three passes.
8. **Gate.** Run
   `launchclip cinematic-check <project> --renderer remotion --video renders/draft.mp4 --critique qa/critic.json --expect-audio`
   to write `CINEMATIC-READINESS.json`. Deliver the draft; render
   `--quality high` only after the user explicitly approves the final.

Essential rules:

- Do not run `launchclip produce`, `creative-plan`, `direct-frames`,
  `production-critique` or `production-repair` (metered model stages); you are
  the director and critic. Use `launchclip cinematic-check` as the local gate
  (no model calls).
- Never spend provider credits silently: ElevenLabs voice, music or SFX need
  the user's explicit opt-in. With `ELEVENLABS_API_KEY` set, `finish` makes
  ElevenLabs music by default (paid once, then locked), so pass
  `--music synth` until the user opts in. Candidates use `finish --candidate`,
  which never pays.
- Supplied narration is authoritative; never invent capabilities, numbers or
  testimonials.
- Keep motion deterministic: catalogue modules first, bespoke code only for
  flagship work.
- Never weaken a gate or mark an accidental overlap as intentional; report
  `needs-repair` after three passes.
- Do not publish or upload anything unless the user asks.

## Existing recordings

For an existing recording—community launch, product/app demonstration, topic
video, interview or presenter clip—read
[references/recorded-video.md](references/recorded-video.md). That route offers
fast base-edit-only cleanup and a full directed treatment with purposeful
curated UI modules, optional useful resources, motion choreography and sound
design. Select established browser/media windows, checklists, progress steps
and callouts before authoring bespoke geometry; the recorded reference defines
module selection and exceptions. Keep presenter placement stable across related
graphic beats and use meaningful visual accents rather than repeated text cards.
Preserve the recorded story; do not require a new concept tournament or rewrite
the speech. The full treatment must prove a short integrated audiovisual
prototype before expanding it. Apply the quick path above to new stories.

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
- [references/standalone-remotion.md](references/standalone-remotion.md) is
  the self-contained runtime contract: project layout, the `storyboard.json` →
  `LaunchclipStory` pipeline, the frame-pure rule, and the verification,
  preview, and render commands.
- [references/storyboard-modules.md](references/storyboard-modules.md): every
  module, its params and events, transitions, grammar and camera, anchors and
  the safe-zone and caption rules.
- [references/direction-map.md](references/direction-map.md): the
  `DIRECTION.json` you write before the storyboard: an intent and a treatment
  for every narration line, the shared intent rules, and what `story validate`
  checks.
- [references/profiles.md](references/profiles.md): the cadence profiles
  (coverage, face time, pacing and motion bands per format) that the map and
  the gates measure against.
- [references/long-form.md](references/long-form.md): videos of five minutes
  or more: chapters and section cards (`launchclip story long-form`),
  attention resets, recurring segment formats, re-rendering one chapter
  (`finish --chapter`) and cutting Shorts from a section (`launchclip cutdown`).
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
the gate itself, `CINEMATIC-READINESS.json` (a footage-led treatment of an
existing recording needs no `CONCEPTS.json` or `STORY.json`). Each is described in
[references/workflow.md](references/workflow.md).
