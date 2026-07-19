---
name: launchclip-create-video
description: Create an end-to-end cinematic HyperFrames video with the current subscription agent as the creative, editorial, and orchestration layer. Use when a user wants a high-quality portrait or landscape video, promo, explainer, product story, repository walkthrough, YouTube video, Short, Reel, or social clip from an idea, URL, repository, topic, brief, script, supplied media, a user-owned project style pack, or a downloaded HeyGen avatar while avoiding LaunchClip's metered model pipeline and not depending on HyperFrames plugin skills. Run a five-concept tournament, retention edit, narration-first timing, local cinematic readiness gate, preview approval, and final render.
---

# LaunchClip Create Video

Create a reviewable video with the current agent's included reasoning and local
HyperFrames tooling. Treat this skill as the agent-native counterpart to
`launchclip produce`, not as a wrapper around it.

Before authoring, read both references completely:

- [references/cinematic-production.md](references/cinematic-production.md) is
  the creative funnel, timing, verification, and repair contract.
- [references/standalone-hyperframes.md](references/standalone-hyperframes.md)
  is the self-contained runtime contract.

## Preserve the cost boundary

- Perform research synthesis, scripting, art direction, HTML authoring, visual
  review, and repair in the current agent session. The active subscription
  agent is the director, compositor, and critic; do not hand those jobs back to
  a metered LaunchClip model stage.
- Use local HTML, CSS, SVG, supplied media, FFmpeg, and the HyperFrames CLI by
  default.
- Do not run `launchclip produce`, `creative-plan`, `direct-frames`,
  `production-critique`, or `production-repair`; those stages call metered
  model APIs.
- Use `launchclip cinematic-check` after a local draft render. It performs
  deterministic local QA and does not call a model API.
- Do not require, install, or invoke the HyperFrames plugin or its skills. Use
  this skill's bundled reference and `npx --yes hyperframes@0.7.58` directly.
- Do not call paid model, image, voice, music, stock-media, or generation APIs
  unless the user explicitly opts into that provider and understands the cost.
- Never treat a ChatGPT, Codex, or Claude login as an API credential. OAuth
  subscription access does not populate `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
  or `ELEVENLABS_API_KEY` for subprocesses.
- Local deterministic tools, including FFmpeg, `ffprobe`, local Whisper or
  Parakeet transcription, and the HyperFrames browser/render runtime, stay
  inside this boundary.

## Conduct the compact intake

Infer answers already present in the request or source material. Ask only for
missing decisions, using no more than three grouped questions:

1. **Story:** What is the source, who should watch, and what should they
   understand, feel, or do afterward?
2. **Delivery:** Where will it be published, and are there required duration,
   aspect ratio, language, or deadline constraints?
3. **Materials and audio:** Which logos, screenshots, recordings,
   script/voiceover, presenter footage, references, or style rules may be used?
   Ask once whether the edit should include music and sound effects. When sound
   effects are wanted, ask for the local SFX folder. Confirm permission for any
   likeness, voice, private material, reference analysis, or paid music call.

Do not ask for fields that can be sensibly defaulted. Use these defaults and
state them:

- interaction: collaborative; use autonomous mode when the user says
  "surprise me", "decide for me", or equivalent
- aspect: `9:16` for Shorts/Reels/TikTok, `1:1` for social feeds, `16:9` for
  YouTube, presentations, embeds, or unknown destinations
- duration: 45 seconds for a short promo or explainer
- language: the user's language
- output: `.launchclip/agent-<source-slug>` in the active workspace
- audio: preserve supplied speech; ask once about music and SFX when the user
  has not already decided. Never silently spend provider credits.

If the source itself is missing, ask for it before proceeding. Otherwise keep
working after the compact intake; do not turn each creative choice into another
approval round.

## Reuse a project-local style pack

Treat `.launchclip/styles/<name>` as the default home for a user's reusable
channel or series identity. When the user names a style, resolve an explicit
directory first, then that project-local path. If a pack exists:

- Read `style.json` and the complete `frame.md` before designing.
- Inspect any caption skin, fonts, audio notes, and assets named by the pack.
- Copy the resolved pack into the output project's `style/` directory so the
  composition and later render do not depend on mutable external files.
- Record the pack name and source path in `BRIEF.md`. Translate its palette,
  type roles, graphic language, motion character, and forbidden motifs into
  the project-specific `DESIGN.md`; keep scene composition driven by this
  video's content rather than cloning the previous edit.

If no pack exists, treat the requested words as creative direction and design
an original system for the video. Do not substitute a built-in branded preset.
After an approved video, create a reusable pack only when the user asks, using
`launchclip style create <name> --from <output-project>`. This local management
command makes no model calls. Never overwrite an existing pack without explicit
`--force` approval.

## Promote a downloaded HeyGen avatar

When the user supplies an already-generated, authorized HeyGen MP4, treat it as
the production's presenter-and-narration source:

- Keep the original brief, repository, URL, or research source as evidence.
- Treat the avatar's spoken audio as authoritative; do not rewrite or replace
  it unless the user explicitly requests a new script or voice.
- Copy the video into the project, probe it, trim boundary silence only, and
  transcribe it locally when no transcript is supplied.
- Extract one continuous local narration track from the prepared video. Mount
  that audio once at the composition root for the whole edit.
- Mount muted video segments as direct root children for presenter-visible
  scenes. Preserve continuous source time across segments; use the same video
  for anchor, split, inset, and companion layouts, and omit it only for a
  deliberate voiceover scene.
- Inspect the face box, gaze, and negative space before defining graphic zones.
  Never cover the face merely to preserve a planned layout.

Do not call HeyGen, request HeyGen credentials, or assume the subscription
agent includes HeyGen generation. If the user wants a new avatar generated,
pause and obtain explicit provider, likeness, upload, cost, and script approval.
This local-file handoff is the subscription-skill equivalent of the CLI's
`--heygen-avatar` flag; do not invoke the metered LaunchClip production lane to
simulate it.

## Resolve music and sound effects deliberately

Treat music and SFX as separate choices. Record the decision, provider, local
source, expected cost boundary, and permission in `BRIEF.md` before resolving
audio.

- **Music:** support none, a supplied track, or user-approved ElevenLabs music.
  ElevenLabs consumes credits, so require explicit opt-in before the request.
  Check only whether `ELEVENLABS_API_KEY` is present in the process environment
  or an approved workspace `.env`; never print the value. A file existing does
  not load it automatically, so export just that variable for the generation
  subprocess. Generate one instrumental bed sized to the edit, leaving
  midrange space for narration and requesting a clean ending. Do not use an
  OpenAI key for subscription-mode orchestration or music.
- **Sound effects:** support none or a user-approved local folder. Recursively
  inventory `.wav`, `.mp3`, `.m4a`, `.aac`, `.ogg`, and `.flac` files, then copy
  only selected cues into the project. Match cues by semantic filename and
  audition them locally. Do not assume a private machine path in the reusable
  skill. Do not call ElevenLabs Sound Effects merely because the music provider
  was approved; that requires a separate explicit request.
- Bind each SFX to a visible event such as a cut, lock, strike, impact, or
  object handoff. Use a small cue vocabulary and avoid decorating every beat.
- When the track has a stable pulse, derive a beat map locally and save it as
  `BEATS.json`. Move selected scene boundaries or internal accents to nearby
  beats when speech timing permits; narration remains authoritative. Avoid
  continuous beat pulsing that competes with the presenter.
- Start a music bed around 10-18% under supplied speech and SFX around 20-35%,
  then audition the mix. Fade or duck the bed around dense speech and the final
  spoken line. Keep every resolved file local and deterministic.

## Freeze the brief and evidence

Create these planning artifacts inside the output project before authoring the
composition:

- `BRIEF.md`: source, audience, promise, CTA, destination, aspect, duration,
  language, interaction mode, cost mode, supplied assets, permissions, and
  constraints
- `EVIDENCE.md`: factual claims and their source locations; label inference,
  opinion, and unverified claims explicitly
- `CONCEPTS.json`: five distinct treatments, complete fresh-context scorecard,
  deterministic winner, and required improvements
- `STORY.json`: the independently edited canonical retention story and its
  score-floor receipt
- `SCRIPT.md`: the exact approved narration; omit only for an intentionally
  unnarrated piece
- `NARRATION.json`: measured word/beat timings from the real take, or an
  explicit editorial grid for an intentionally unnarrated piece
- `STORYBOARD.md`: time-coded scenes, spoken beat, visible idea, on-screen copy,
  assets, motion development, transition, and audio intent
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

## Analyze supplied media before designing

When the user supplies audio or video, inspect the real temporal structure
before writing the storyboard:

- Probe streams, duration, dimensions, frame rate, codecs, and audio presence.
- Detect boundary silence and trim only the leading/trailing silence. Preserve
  internal pauses unless the user asked for editorial tightening. Keep a small
  speech handle so consonants and breaths are not clipped.
- Transcribe locally when narration drives the edit. Treat the supplied words
  and timings as authoritative.
- Generate and inspect an overview contact sheet plus a dense first-four-second
  strip. For references, also inspect frames around detected cuts and major
  motion changes instead of relying on evenly spaced thumbnails alone.
- For presenter footage, inspect representative frames across the full take and
  record the approximate face box, gaze direction, and usable negative space in
  `SOURCE.md`. Treat that region as a presenter-safe area, not as background.
- Record the measured cut rate, hold pattern, first meaningful motion, and the
  visual registers used: presenter, typography, UI/proof, diagram, spatial
  transition, or full-frame reset.

Do this analysis with local tooling from the bundled reference. Never submit
private footage to an external transcription or vision API without explicit
permission.

## Design the video

Build one visual idea that develops across the whole piece rather than a stack
of unrelated title cards. For every scene:

- Make the visible action express the spoken or intended idea.
- Keep on-screen copy shorter than narration.
- Prefer real supplied evidence over decorative filler.
- Give each shot at least one meaningful internal development: reveal,
  transformation, comparison, traversal, focus shift, or state change.
- Maintain continuity through color, type, spatial anchors, object handoffs, or
  transition logic.
- Classify adjacent beats before choosing a transition. When the idea and
  presenter layout continue, treat both scenes as positions in one shared
  world: keep stable anchors such as the presenter, frame, or navigation rail
  fixed and pan the graphic plane between them. Reserve full resets for a real
  topic, scale, or emotional change.
- Group related beats into persistent 8–20 second shared worlds. For a complete
  video shorter than eight seconds, use one full-runtime world. Keep one
  coordinate/depth system, stable object IDs, cumulative state, camera path,
  light, materials, entry/exit geometry, velocity, and blur envelope across
  each world. Treat an independent full-frame DOM reset as a cut, not
  continuity.
- Reserve safe areas for captions and platform UI when applicable.
- For every presenter-plus-graphic scene, declare a presenter-safe area and a
  non-overlapping graphic zone in `STORYBOARD.md`. Pan or crop the presenter
  into the opposite zone before placing a panel. If neither side has usable
  negative space, use a true split, compact picture-in-picture, or full-frame
  graphic cut instead of covering the face.
- Derive split crops from the target rectangle and presenter focal point. The
  transformed crop must fill the entire target bounds with no black or dead
  band; validate the first, middle, and last frame of every split state.
- Use semantic HTML objects, SVG, diagrams, charts, or UI reconstructions before
  seeking generated raster imagery.

Meet this default retention and craft floor unless the brief deliberately calls
for a quieter treatment:

- Make frame zero intentional and establish the promise within one second.
- Land at least three distinct material changes in the first four seconds for a
  portrait short, or two for landscape. A color flicker or caption word change
  does not count.
- State the promise within one second for portrait short-form or two seconds for
  landscape, then show grounded proof by three seconds or six seconds
  respectively.
- Change visual register, composition, evidence state, camera framing, or
  information density every two to four seconds; do not merely swap card copy.
- Use at least five visual registers for a portrait short or four for landscape,
  and avoid repeating the same register more than twice consecutively.
- Keep text-only frames below 10% of the duration. Typography can lead a beat,
  but it cannot replace the visual argument.
- Define exact display, body, and metadata type families. Use genuine weight,
  scale, tracking, width, and case contrast; fail the review if a generic font
  silently replaces the planned family.
- Give primary, secondary, and ambient motion different amplitudes and tempos.
  Entries normally decelerate into place; exits accelerate away. Use overshoot
  only for emphasis, not every element.
- Keep an evolving canvas between major beats with finite, low-amplitude camera
  drift, foreground parallax, or surface breathing. Motion should continue
  through holds without turning every scene into a loop. Couple brief blur to
  fast pans, pushes, or zooms and resolve it fully when movement settles.
- For shared-world travel, move outgoing and incoming planes concurrently with
  one continuous `inOut` position curve. Shape blur as a velocity envelope:
  crisp at departure, strongest near the midpoint, and fully crisp at the
  settle. Extend the outgoing clip through the complete move so it cannot pop
  away before the transition finishes.
- Select transitions by meaning: hard cut for contrast, push for continuation,
  whip for speed, zoom for scale change, morph for identity, and aperture/mask
  for focus. Do not disguise one generic crossfade with different names.
- Use directional blur or brief ghost trails only while velocity is high, then
  return to a crisp settle. Prefer transforms, masks, SVG paths, and layered
  depth over permanent CSS blur.
- Keep primary copy readable at delivery size. Long body text belongs in the
  narration or a deliberate reading beat, not a fleeting overlay.

Do not imitate a named living artist or clone a person's voice or likeness.

## Author and repair

Follow the scaffold, composition contract, and commands in the bundled
reference. Work in this order:

1. Verify Node.js, FFmpeg, and HyperFrames availability.
2. Probe, trim, transcribe, and temporally inspect supplied media locally.
3. Scaffold a blank project without installing any skill pack.
4. Copy or link only approved assets into the project using stable local paths.
5. Run the five-concept tournament and fresh-context selection.
6. Write and independently edit the canonical retention story.
7. Produce or prepare narration, measure the real take, then freeze the
   storyboard, design system, music/edit grid, and quality targets.
8. Put `data-launchclip-cinematic-contract="phase-2"` on the composition root.
   Render two independent opening candidates and two candidates for one
   representative unproven transition grammar. Compare their real pixels and
   motion at delivery size, choose deterministically, and preserve the
   candidate receipt and artifacts before full authoring.
9. Author the composition and a motion sidecar from the selected treatment and
   frozen artifacts.
10. Run static lint early.
11. Run strict browser checks with transition and dense-hook snapshots. Sample
   shared-world moves at departure, early acceleration, peak speed, late
   deceleration, and settle rather than checking only their endpoints.
12. Inspect every generated overview image, not only the command exit code.
13. Review the opening, every transition boundary, every major type state, and
    the final frame at delivery scale. Scrub adjacent frames when a snapshot
    suggests clipping, popping, or a discontinuity.
14. Render a local draft, build the hashed temporal-evidence manifest, require
    the fresh-context critic to cite reviewed evidence IDs, and run
    `launchclip cinematic-check`.
15. Repair the smallest responsible sequence, mix, or plan, then rerun the
    failed gate. Stop after three bounded passes and report `needs-repair`
    instead of weakening the contract.

Do not weaken checks, mark accidental overlaps as intentional, or use draft
rendering to conceal a composition defect. Keep all motion deterministic and
seek-safe.

## Obtain review and render

Open HyperFrames Studio only after the automated gates, visual snapshot review,
and `CINEMATIC-READINESS.json` all pass. Tell the user where the editable
project and preview are located, summarize any deliberate limitations, and ask
for explicit render approval.
Studio's Export action is useful for an ad hoc draft, but it is not the
workflow's approval signal or final artifact.

If Studio changes the composition, rerun the browser check and inspect fresh
snapshots before asking for approval. If those checks trigger a repair that
changes the visible result, refresh Studio and obtain fresh approval of that
repaired state.

After approval:

1. Render from the CLI to a stable output path at the requested quality.
2. Confirm the file exists and is non-empty.
3. Probe its duration, dimensions, video codec, and audio presence.
4. If a final render is visually different from snapshots, repair, recheck,
   obtain fresh approval, and rerender.
5. Return the project path, planning artifacts, QA result, and final media path.

Do not publish, upload, or post the result unless the user separately asks for
that external action.
