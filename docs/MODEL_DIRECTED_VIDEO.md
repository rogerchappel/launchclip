# Model-Directed Video Pipeline

## Objective

Launchclip should turn a small amount of source material into an editable,
reviewable HyperFrames video without requiring the CLI to hard-code the visual
idea for every subject.

The intended inputs are:

- a local or GitHub repository, with optional screenshots or demo captures
- a SaaS/product brief plus screen recordings, screenshots, logos, and a CTA
- a topic, paper, comparison, notes, or other research resources
- a supplied voiceover audio file
- a supplied presenter/avatar video whose placement can change by beat

The output can target portrait or landscape, short-form or long-form. ElevenLabs
can provide narration and music, the local SFX library supplies timed effects,
and HyperFrames owns the editable composition and final render.

## Product Principle

Hard-code contracts, safety boundaries, and verification. Do not hard-code the
art direction.

GPT-5.6 should make the decisions that benefit from broad context and design
judgment:

- what the source actually means
- which angle will hold attention
- the narrative and voiceover
- what each phrase should make the viewer see
- the design world, composition, and typography
- when a presenter is full frame, split, inset, or absent
- which supplied assets are useful and which are irrelevant
- whether a failed snapshot needs a layout, timing, or story repair

Launchclip should make the decisions that must be deterministic:

- source collection and provenance
- allowed filesystem and subprocess operations
- schema validation and timing arithmetic
- media probing, copying, transcoding, and path resolution
- provider calls and credential boundaries
- HyperFrames assembly and media ownership
- lint, validate, inspect, snapshot, and render gates
- resumability, receipts, and final human approval

## CLI Shape

One high-level command should cover the common cases while every stage remains
independently rerunnable.

```bash
# Repository explainer
launchclip produce https://github.com/owner/repo \
  --prompt "Explain why this changes agent workflows" \
  --resource ./screenshots \
  --aspect 9:16 \
  --duration 60

# SaaS/product narrative from footage and brand resources
launchclip produce https://product.example \
  --kind product \
  --resource ./recordings/onboarding.mp4 \
  --resource ./brand/logo.svg \
  --cta "Start a free workspace" \
  --aspect 16:9

# Topic/research explainer
launchclip produce "Compare the leading coding models" \
  --kind topic \
  --resource ./research/paper.pdf \
  --resource ./research/notes.md \
  --aspect 9:16

# Build around supplied narration or an avatar take
launchclip produce ./brief.md \
  --voiceover ./narration.wav \
  --transcript ./narration.txt \
  --presenter ./avatar-take.mp4 \
  --prompt "Keep the presenter visible; move them around the evidence"
```

The command writes a workspace and stops at an editable preview by default.
Final rendering remains an explicit approval step.

Every stage can also be resumed directly:

```bash
launchclip evidence <workspace>
launchclip source-media <workspace>
launchclip creative-plan <workspace>
launchclip production-audio <workspace>
launchclip direct-frames <workspace> --concurrency 4
launchclip assemble <workspace>
launchclip production-verify <workspace>
launchclip production-critique <workspace>
launchclip production-repair <workspace>
launchclip production-render <workspace> --approve \
  --reference-video ./reference-short.mp4
```

`produce --no-audio` is useful for visual evaluation when ElevenLabs is not
configured. A supplied voiceover requires either `--transcript` or an
`ELEVENLABS_API_KEY` for Scribe transcription. Generated narration additionally
requires `ELEVENLABS_VOICE_ID` (or `--voice-id`).

## Pipeline

### 1. Intake

Normalize every invocation into `production/intake.json`.

The intake records:

- inferred source kind: `repository`, `product`, `topic`, or `voiceover`
- primary source and user prompt
- audience, CTA, language, aspect, and target duration
- every resource with a stable id, media type, source path, checksum, and role
- voiceover and presenter media separately from supporting resources
- requested model, reasoning effort, and pro-mode setting

Repeated `--resource` and `--reference` flags are ordered arrays. The original
files remain immutable. Directories are recursively expanded into stable,
checksummed file resources (hidden files and `node_modules` are ignored), so a
screen-recordings directory is directly usable by analysis and frame workers.

### 2. Evidence

Create `production/evidence.json` and derived analysis artifacts.

- Repositories: README, package/project metadata, docs, release notes, selected
  source files, GitHub metadata, and optional demo proof.
- Products: captured page text and brand tokens plus supplied screen recordings
  and screenshots.
- Topics: supplied text/PDF contents and clearly labelled researched claims.
- Audio/video: duration, dimensions, transcript, word timings, and contact
  sheets. Long recordings are summarized by chapter without discarding the
  timestamped transcript.
- Supported YouTube references: locally staged analysis copy, contact sheet,
  optional Scribe transcript/WPM, semantic segments, and later frame-motion
  comparison. Staging is capped at 15 minutes and never mounts reference
  footage in the output.

Every claim in a later script points back to one or more evidence ids. The model
may create analogies and visual metaphors, but it may not turn an unverified
claim into fact.

### 3. Creative Plan

Use the OpenAI Responses API with GPT-5.6 Sol and strict structured output to
write `production/plan.json`.

The plan contains:

- one-sentence thesis and audience promise
- selected angle and hook logic
- full voiceover or supplied-voiceover transcript
- evidence-backed claims and explicit uncertainty
- open-ended design direction: visual world, palette roles, type character,
  texture, density, composition logic, and motion character
- a time-coded shot sequence
- presenter/avatar placement per shot
- asset selections by resource id
- on-screen copy distinct from the narration
- internal reveals that develop across each shot
- transition, music, and SFX intent
- a video-specific evaluation rubric

The schema describes the information a renderer needs. It does not enumerate a
closed list of visual styles or force every video through named scene presets.

Default model configuration:

```text
model: gpt-5.6 (routes to gpt-5.6-sol)
reasoning.effort: xhigh
reasoning.mode: standard
```

`--reasoning max` and `--pro` are opt-in quality modes. `--model` permits an
explicit fallback or evaluation model without changing the pipeline.

### 4. Script and Audio

Write human-readable `SCRIPT.md` and `STORYBOARD.md` from the validated plan.

- A supplied voiceover is authoritative; its real word timings drive the edit.
- Otherwise, ElevenLabs generates the approved script in bounded sections and
  returns word timings. Moderate duration drift is pitch-preservingly conformed
  to the approved timeline and the word alignment is scaled with it.
- ElevenLabs music uses the model-authored music brief and the final duration.
- SFX are resolved from the local library by semantic intent and copied into
  the project with a manifest.
- Provider failures leave resumable receipts and do not silently substitute a
  different voice or music choice.

### 5. HyperFrames Authoring

Generate a modular HyperFrames project. GPT-5.6 authors the frame-specific HTML
and motion within the HyperFrames contract; Launchclip assembles and validates
it.

Each frame author receives only:

- the approved plan and global design direction
- its own shot, neighboring shot summaries, and exact duration
- relevant evidence and staged assets
- canvas size, caption/presenter keep-out regions, and HyperFrames rules

This keeps the design contextual without giving one request an unbounded output
surface. The assembler owns media tracks, frame timing, transitions, and the
root composition. Model-authored documents run behind a restrictive CSP and an
active-content/asset allowlist. Motion intent is translated into the native
HyperFrames `appearsBy`, `before`, `staysInFrame`, and `keepsMoving` sidecar
contract, including a root sidecar discovered by `hyperframes inspect`.

### 6. Visual Review and Repair

Run deterministic checks first:

1. `hyperframes lint`
2. `hyperframes validate`
3. `hyperframes inspect`
4. midpoint and boundary snapshots

Then give GPT-5.6 the plan, diagnostics, and contact sheet. It returns a
structured repair decision that identifies the smallest affected frame and the
reason: factual, narrative, composition, typography, motion, asset, or timing.
Only those frames are regenerated. Repeat within a bounded repair budget.

Final render remains human-gated.

After encoding, Launchclip measures per-frame luminance difference, stillness,
motion bursts, cut cadence, and shot duration. A separate block-matching pass
measures displacement velocity, acceleration, deceleration, and jerk; luma
derivatives are explicitly reported only as pixel-change metrics. Audio QA
checks stream presence, integrated loudness, true peak, narrated silence,
voice/music margin, and SFX transients at scheduled cue times. Reference
comparison first selects a compatible editorial family and then compares
temporal distributions and envelopes. It does not optimize RGB, SSIM, or pixel
resemblance between unrelated visual styles.

## Reference Quality Observations

The supplied GPT-5.6 Sol example demonstrates a useful pattern rather than a
style to copy:

- the model-authored section runs for roughly three minutes with continuous
  narration
- the presenter remains visible while evidence panels take different portions
  of the frame
- a small global design system stays consistent while each panel is specific to
  the spoken claim
- panels reveal their contents progressively instead of behaving like static
  slides
- semantic headlines summarize the idea; they are not transcript captions
- the production chain is inspected and repaired after rendering

Those are evaluation criteria. Colors, layouts, typography, and scene content
must be chosen anew from the target material.

Across the supplied references, very different editing families still cluster
around roughly 20–25 meaningful motion developments per minute. That is a QA
observation, not a mandate for constant motion: strong examples also contain
long intentional reading holds. The comparator therefore evaluates burst
cadence together with cut rate and hold ratio.

## Safety and Approval

- Do not clone a voice or likeness without explicit authorization.
- Do not transmit private resources to a model or provider unless the user put
  them in scope for the video.
- Do not invent repository capabilities, product metrics, research results, or
  public claims.
- Do not auto-publish, upload, or submit a final render.
- Stage public reference video only for analysis when authorized; do not copy
  its footage, audio, likeness, or design into the deliverable.
- Pass `--sfx-dir` for packaged installs until the repository pack's
  redistribution terms are explicitly approved.
- Store provider ids and receipts, never API keys.
- Make every stage resumable and reviewable before incurring the next expensive
  provider call.

## Delivery Slices

1. Normalized intake and evidence manifests.
2. GPT-5.6 Responses API creative planning and critique contracts.
3. Model-authored modular HyperFrames frames plus deterministic assembly.
4. ElevenLabs narration/music and local SFX orchestration.
5. Snapshot-driven repair loop and representative end-to-end evals.
