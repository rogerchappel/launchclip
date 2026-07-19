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
  --profile cinematic \
  --prompt "Explain why this changes agent workflows" \
  --resource ./screenshots \
  --aspect 9:16 \
  --duration 60 \
  --review

# SaaS/product narrative from footage and brand resources
launchclip produce https://product.example \
  --profile cinematic \
  --kind product \
  --resource ./recordings/onboarding.mp4 \
  --resource ./brand/logo.svg \
  --cta "Start a free workspace" \
  --aspect 16:9

# Topic/research explainer
launchclip produce "Compare the leading coding models" \
  --profile cinematic \
  --kind topic \
  --resource ./research/paper.pdf \
  --resource ./research/notes.md \
  --aspect 9:16

# Build around supplied narration or an avatar take
launchclip produce ./brief.md \
  --profile cinematic \
  --voiceover ./narration.wav \
  --transcript ./narration.txt \
  --presenter ./avatar-take.mp4 \
  --prompt "Keep the presenter visible; move them around the evidence"

# A downloaded HeyGen video can replace both narration and presenter inputs
launchclip produce ./brief.md \
  --profile cinematic \
  --heygen-avatar ./heygen-avatar.mp4 \
  --transcript ./heygen-avatar.txt \
  --prompt "Keep the avatar visible; move it around the evidence"

# Long-form: outline once, expand chapters concurrently, stitch deterministically
launchclip produce ./research \
  --profile cinematic \
  --kind topic \
  --duration 240 \
  --aspect 16:9 \
  --planning-mode hierarchical \
  --chapter-concurrency 3
```

The command writes a workspace, renders and analyzes an editable draft, asks an
independent critic to judge it, and performs up to two bounded repair passes for
standard work or three for cinematic work. A cinematic draft reaches approval
only when its creative receipts, native verification, motion, audio, critic,
and zero-fallback gates all pass. Final high-quality rendering remains an
explicit approval step.

`--heygen-avatar` accepts one local video and is mutually exclusive with
`--voiceover` and `--presenter`. It does not generate the avatar or access the
HeyGen API; it promotes the supplied video's audio to authoritative narration
and its picture to the presenter source while retaining the primary source for
evidence.

Every stage can also be resumed directly:

```bash
launchclip evidence <workspace>
launchclip source-media <workspace>
launchclip resolve-entities <workspace>
launchclip concept-tournament <workspace>
launchclip retention-story <workspace>
launchclip cinematic-narration <workspace>
launchclip creative-plan <workspace>
launchclip production-audio <workspace>
launchclip direct-frames <workspace> --concurrency 4
launchclip assemble <workspace>
launchclip production-verify <workspace> --shot-inspect-concurrency 3
launchclip production-draft <workspace> \
  --reference-video ./reference-short.mp4 \
  --critic-route openrouter:openrouter/free@none
launchclip production-critique <workspace> \
  --critic-route openrouter:openrouter/free@none
launchclip production-repair <workspace> --repair-semantic-attempts 2
launchclip production-preview <workspace> --port 3002
launchclip review <workspace> --port 3002 \
  --critic-route openrouter:openrouter/free@none \
  --repair-route openrouter:openrouter/free@none
launchclip production-render <workspace> --approve \
  --critic-route openrouter:openrouter/free@none \
  --reference-video ./reference-short.mp4
```

`produce --no-audio` is useful for visual evaluation when ElevenLabs is not
configured. A supplied voiceover requires either `--transcript` or an
`ELEVENLABS_API_KEY` for Scribe transcription. Generated narration additionally
requires `ELEVENLABS_VOICE_ID` (or `--voice-id`).

Use `produce --fast-eval` for the short iteration loop, not for a claim of
maximum one-shot quality. It keeps the same
evidence, schema, native HyperFrames, rendered-motion, and independent-critic
gates while reducing media samples, model output budgets, critic snapshots,
and repair passes. Every stage is receipt-backed and resumable, so rerunning the
same workspace reuses valid provider responses and artifacts. After editing an
assembled composition, `production-draft` reruns verification, a draft encode,
motion/audio analysis, reference comparison, and critique without repeating
intake, evidence, planning, frame generation, or audio production.

Native QA also has a content-addressed receipt bound to the exact plan,
assembled project tree, verifier settings, HyperFrames/browser toolchain, and
the hashes of every report and snapshot. An unchanged draft reuses that receipt
while still encoding, analyzing audio/motion, and running the independent
critic. Any project, plan, toolchain, option, report, or snapshot change forces
the full gate again.

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

SVG inputs are preserved as source evidence and rasterized to derived PNGs for
vision analysis. Rasterization uses an available ImageMagick `magick`/`convert`
binary or macOS `sips`; packaged installs do not currently bundle a rasterizer.

Every claim in a later script points back to one or more evidence ids. The model
may create analogies and visual metaphors, but it may not turn an unverified
claim into fact.

### 3. Cinematic Concept, Story, and Narration

With `--profile cinematic`, create the creative spine before the final visual
plan:

1. Generate exactly five materially different hook, causal-story, art-world,
   motion, transition, and sound treatments.
2. Give a fresh-context judge all five candidates and select the deterministic
   top score after genericism, slideshow, and unsupported-clickbait penalties.
3. Write the complete retention story with hook, promise, mechanism, proof,
   midpoint rehook, escalation, payoff, closing reframe, and CTA/loop as the
   duration requires.
4. Have an independent editor return the corrected canonical story only after
   fixed hook, compression, curiosity, clarity, proof, payoff, speakability,
   and visuality floors pass.
5. Generate or prepare narration and measure the real word/beat timing before
   final shot boundaries and the edit grid are planned.

These stages write `production/concepts.json`, `production/story.json`, and
`production/media/cinematic-narration.json`. Supplied narration remains exact.
Generated cinematic narration is not time-stretched to rescue an earlier edit;
the edit is planned around the performance.

### 4. Creative Plan

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

Planning mode defaults to `auto`. Productions under 180 seconds use one strict
planning call. At 180 seconds or above, Launchclip creates a resumable global
outline, expands independent chapter jobs concurrently with frozen continuity
anchors, and deterministically stitches their local timelines into the same
`launchclip.production-plan.v2` contract. `--planning-mode single` and
`--planning-mode hierarchical` override the threshold. Supplied narration
remains byte-for-byte authoritative through the stitch.

Default model configuration:

```text
model: gpt-5.6 (routes to gpt-5.6-sol)
reasoning.effort: xhigh
reasoning.mode: standard
```

`--reasoning max` and `--pro` are opt-in quality modes. `--model` permits an
explicit fallback or evaluation model without changing the pipeline.

### 5. Script and Audio

Write human-readable `SCRIPT.md` and `STORYBOARD.md` from the validated plan.

- A supplied voiceover is authoritative; its real word timings drive the edit.
- In cinematic mode, ElevenLabs generates the approved story before the final
  edit plan and returns measured word timings; the later audio stage reuses that
  exact take. Standard mode retains its existing bounded conformance behavior.
- ElevenLabs music uses the model-authored music brief and the final duration.
- SFX are resolved from the local library by semantic intent and copied into
  the project with a manifest.
- Provider failures leave resumable receipts and do not silently substitute a
  different voice or music choice.

### 6. HyperFrames Authoring

Generate a modular HyperFrames project. GPT-5.6 authors the frame-specific HTML
and motion within the HyperFrames contract; Launchclip assembles and validates
it.

Each frame author receives only:

- the approved plan and global design direction
- its own shot, neighboring shot summaries, and exact duration
- relevant evidence and staged assets
- canvas size, caption/presenter keep-out regions, and HyperFrames rules

Under the OpenRouter free policy, each shot first receives a compact LLM visual
blueprint. The blueprint binds percentage-based layout zones, planned object
IDs and selectors, typography scale, occupied-area target, exact copy, and
motion beats. A second LLM request implements that smaller handoff. Scene lanes
run concurrently—three by default—while blueprint and implementation remain
sequential within a lane. Fail-closed scheduling lets in-flight scenes save
their receipts but stops assigning untouched scenes after the first blocking
failure, so resuming reuses completed work.

This keeps the design contextual without giving one request an unbounded output
surface. The assembler owns media tracks, frame timing, transitions, and the
root composition. Model-authored documents run behind a restrictive CSP and an
active-content/asset allowlist. Motion intent is translated into the native
HyperFrames `appearsBy`, `before`, `staysInFrame`, and `keepsMoving` sidecar
contract, including a root sidecar discovered by `hyperframes inspect`.

### 7. Visual Review and Repair

Run deterministic checks first:

1. `hyperframes lint`
2. `hyperframes validate`
3. transition-aware root `hyperframes inspect`
4. isolated native `hyperframes inspect` for every shot motion sidecar
5. midpoint and boundary snapshots

Then give GPT-5.6 the plan, diagnostics, and contact sheet. It returns a
structured repair decision that identifies the smallest affected frame and the
reason: factual, narrative, composition, typography, motion, asset, or timing.
Only those frames are regenerated. Fresh shot-local inspector errors and strict
lint warnings also become shot-scoped repair findings, even when an older visual
critique said to ship. Each repair revision hashes its prior bundle and current
findings, so changed evidence gets a fresh bounded attempt budget without
invalidating clean shots. A structurally invalid replacement receives its exact
validation errors on the next semantic attempt instead of ending the pass.
Script, plan, audio, and `replan` findings create a constrained full-plan
revision with immutable format, duration, language, CTA, evidence eligibility,
and supplied narration. That revision then regenerates the affected audio and
all frames, reconfigures assembly dependencies when shot IDs change, and returns
through the same bounded verification/draft/critic loop.

For cinematic work, deterministic motion/audio failures enter the same typed
repair loop even when the critic says `ship`. The readiness receipt also fails
closed when a concept, story, narration, assembly provenance, native
verification, motion report, audio report, or critic receipt is absent.

Final render remains human-gated. Once the draft, critic verdict, and cinematic
readiness receipt are ready,
`production-preview <workspace>` starts or reuses HyperFrames Studio and returns
its editable local URL with status `awaiting-approval`. Studio may create ad hoc
exports, but its Export control is not a Launchclip approval event and does not
run Launchclip's final motion, audio, or critic gates. The user approves the
reviewed state separately, then `production-render <workspace> --approve`
re-verifies the assembled project before encoding. If verification or a later
repair changes the approved state, return to Studio and obtain fresh approval.

`produce --review` combines those stages without weakening the boundary. It
opens Studio after the draft, then keeps this menu in the invoking terminal:

```text
[A] Approve and render
[C] Request changes
[R] Run automatic repair
[O] Reopen Studio
[Q] Save and exit
```

Approve still runs the exact `production-render --approve` verification and
quality path. Request changes asks for free-form reviewer direction, has the
visual critic turn it into typed shot/plan findings, applies the normal bounded
repair route, rebuilds the draft, and leaves Studio to hot reload it. No render
or repair runs while the terminal is waiting for a decision, and the workspace
lease is held only around an actual mutation. `launchclip review <workspace>`
resumes the same control loop later. In non-interactive environments, use the
independent preview and render commands instead.

The critic is provider-routable without changing its strict schema or editorial
contract. `--critic-route` accepts exactly one pinned route; `--repair-route`
may still use the bounded repair fallback sequence. To use OpenRouter's current
free pool without maintaining a model list, pass
`openrouter:openrouter/free@none` for both routes. OpenRouter records the actual
free model selected in each response and Launchclip preserves that model in its
critique and repair receipts.

After encoding, Launchclip measures per-frame luminance difference, stillness,
motion bursts, cut cadence, and shot duration. A separate block-matching pass
measures displacement velocity, acceleration, deceleration, and jerk; luma
derivatives are explicitly reported only as pixel-change metrics. Audio QA
checks stream presence, integrated loudness, true peak, narrated silence,
voice/music margin, and SFX transients at scheduled cue times. Reference
comparison first selects a compatible editorial family and then compares
temporal distributions and envelopes. It does not optimize RGB, SSIM, or pixel
resemblance between unrelated visual styles.

These gates establish a repeatable technical and craft floor. They improve the
probability of a usable, retention-aware result but cannot guarantee view count;
topic demand, audience fit, thumbnail/title packaging, channel history, and
distribution remain external.

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

## Frozen-Provider Evaluation Matrix

Run the five-case production matrix without OpenAI or ElevenLabs credentials:

```bash
npm run eval:production -- --out .launchclip/eval-matrix/v1

# Iterate on one case without running the full browser matrix.
npm run eval:production -- \
  --scenario presenter-video \
  --out .launchclip/eval-matrix/presenter \
  --force
```

The cases cover a 16:9 SaaS screen recording, a local topic/PDF, authoritative
supplied audio, a presenter video with two layouts, and a 180-second
hierarchical production. Provider responses are frozen, but intake, evidence,
source-media processing, planning jobs, audio manifests, frame contracts,
assembly, and content-addressed verification are real. Every case must pass
HyperFrames lint, browser validation, root inspection, isolated shot
inspection, snapshots, and immediate verification-receipt reuse.

The command stops at snapshots; it does not bypass the final-render approval
gate. Review `matrix-report.json` and each scenario's `production/qa/snapshots`
before choosing a project to render.

This is a **keyless** evaluation, not yet a fully network-isolated one. The
assembled project currently loads GSAP from jsDelivr. LaunchClip invokes its
pinned HyperFrames package directly, while PDF text extraction is frozen in the
evaluator when `pdftotext` is unavailable. The report records those boundaries
so it cannot be mistaken for credentialed creative-quality or offline proof.

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
