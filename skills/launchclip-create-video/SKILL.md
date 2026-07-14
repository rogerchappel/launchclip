---
name: launchclip-create-video
description: Create an end-to-end HyperFrames video with the current subscription agent as the creative and orchestration layer. Use when a user wants a video, promo, explainer, product story, repository walkthrough, or social clip from a URL, repository, topic, brief, script, or supplied media while avoiding LaunchClip's metered model pipeline and not depending on HyperFrames plugin skills. Ask a compact intake, author the editable composition, verify it locally, obtain preview approval, and render the final file.
---

# LaunchClip Create Video

Create a reviewable video with the current agent's included reasoning and local
HyperFrames tooling. Treat this skill as the agent-native counterpart to
`launchclip produce`, not as a wrapper around it.

Before authoring, read [references/standalone-hyperframes.md](references/standalone-hyperframes.md)
completely. It is the self-contained runtime contract for this workflow.

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
- Do not require, install, or invoke the HyperFrames plugin or its skills. Use
  this skill's bundled reference and `npx hyperframes` directly.
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
3. **Materials:** Which logos, screenshots, recordings, script/voiceover,
   presenter footage, music, references, or style rules may be used? Confirm
   permission for any likeness, voice, private material, or reference analysis.

Do not ask for fields that can be sensibly defaulted. Use these defaults and
state them:

- interaction: collaborative; use autonomous mode when the user says
  "surprise me", "decide for me", or equivalent
- aspect: `9:16` for Shorts/Reels/TikTok, `1:1` for social feeds, `16:9` for
  YouTube, presentations, embeds, or unknown destinations
- duration: 45 seconds for a short promo or explainer
- language: the user's language
- output: `.launchclip/agent-<source-slug>` in the active workspace
- audio: supplied audio when present; otherwise a silent/music-free edit unless
  the user approves a local or external audio option

If the source itself is missing, ask for it before proceeding. Otherwise keep
working after the compact intake; do not turn each creative choice into another
approval round.

## Freeze the brief and evidence

Create these planning artifacts inside the output project before authoring the
composition:

- `BRIEF.md`: source, audience, promise, CTA, destination, aspect, duration,
  language, interaction mode, cost mode, supplied assets, permissions, and
  constraints
- `EVIDENCE.md`: factual claims and their source locations; label inference,
  opinion, and unverified claims explicitly
- `SCRIPT.md`: narration verbatim when audio is supplied, or the planned spoken
  script when narration is approved; omit for an intentionally unnarrated piece
- `STORYBOARD.md`: time-coded scenes, spoken beat, visible idea, on-screen copy,
  assets, motion development, transition, and audio intent
- `DESIGN.md`: project-specific palette roles, typography, composition logic,
  image treatment, motion character, and forbidden motifs
- `SOURCE.md`: media probes, silence-trim receipt, transcript location, overview
  contact sheet, dense opening strip, detected cut points, and any reference
  cadence observations
- `HOOKS.md`: three truthful opening treatments, the selected treatment, the
  immediate promise, and the material changes planned inside the first four
  seconds
- `QUALITY.md`: project-specific pass/fail targets for typography, hierarchy,
  hook timing, change cadence, transition variety, motion physics, safe areas,
  source fidelity, and final artifact probing

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
- Reserve safe areas for captions and platform UI when applicable.
- Use semantic HTML objects, SVG, diagrams, charts, or UI reconstructions before
  seeking generated raster imagery.

Meet this default retention and craft floor unless the brief deliberately calls
for a quieter treatment:

- Make frame zero intentional and establish the promise within one second.
- Land at least two distinct material changes in the first four seconds. A
  color flicker or a caption word changing does not count as a material change.
- Change visual register, composition, evidence state, camera framing, or
  information density every two to four seconds; do not merely swap card copy.
- Use at least three visual registers across the piece and avoid repeating the
  same register more than twice consecutively.
- Define exact display, body, and metadata type families. Use genuine weight,
  scale, tracking, width, and case contrast; fail the review if a generic font
  silently replaces the planned family.
- Give primary, secondary, and ambient motion different amplitudes and tempos.
  Entries normally decelerate into place; exits accelerate away. Use overshoot
  only for emphasis, not every element.
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
5. Freeze the brief, source analysis, hook choice, storyboard, design system,
   and quality targets.
6. Author the composition and a motion sidecar from those frozen artifacts.
7. Run static lint early.
8. Run strict browser checks with transition and dense-hook snapshots.
9. Inspect every generated overview image, not only the command exit code.
10. Review the opening, every transition boundary, every major type state, and
    the final frame at delivery scale. Scrub adjacent frames when a snapshot
    suggests clipping, popping, or a discontinuity.
11. Repair the smallest responsible scene, then rerun the failed gate.
12. Repeat until checks pass and the visible result satisfies `QUALITY.md`.

Do not weaken checks, mark accidental overlaps as intentional, or use draft
rendering to conceal a composition defect. Keep all motion deterministic and
seek-safe.

## Obtain review and render

Open HyperFrames Studio only after the automated gates and visual snapshot
review pass. Tell the user where the editable project and preview are located,
summarize any deliberate limitations, and ask for explicit render approval.
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
