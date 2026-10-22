# Changelog

## Unreleased

### Added

- Add partial rendering to `launchclip finish`: the render stage caches the
  timeline in segments (scene bodies and whole transition overlaps) hashed
  from everything that can change their pixels, and re-renders only the
  segments an edit touches. Remotion renders them by frame range as lossless
  segments, joins them with a stream copy and encodes once, frame-identical
  to a fresh full render; HyperFrames caches whole renders by hash. Add
  `--scene s3[,s4]` (force those scenes, re-run master, evidence and gates,
  before/after stills) and `--preview-scene s3` (just that scene to
  `renders/scene-s3.mp4`).
- Add ElevenLabs music and beat sync to `launchclip finish`. A music provider
  registry (`src/music/`: `synth`, `elevenlabs`, `file`) picks the music from
  `--music synth|elevenlabs|none`, `audio.music` (now also
  `{provider, prompt?, bpm?, file?, sync?}`) or, by default, ElevenLabs when
  `ELEVENLABS_API_KEY` is set. ElevenLabs tracks come from `POST /v1/music`
  with a composition plan that follows the story's energy arc, instrumental
  at the target BPM, cached by request hash under
  `$LAUNCHCLIP_CACHE/elevenlabs/music`. Beat analysis writes `BEATS.json`;
  narrated stories move the music (offset, tempo ≤ 3%) so downbeats land on
  key moments, motion stories snap cuts to downbeats and hits to beats within
  0.25 s with module and layout re-checks; `qa/beat-sync.json` records it.
- The CLI loads `.env` from the working and project directories at startup
  without overriding the shell (`process.loadEnvFile`); see `.env.example`.
- Add `launchclip export <project> --format fcpxml|premiere|edl|otio|all`: a
  finished storyboard project as an editable timeline for Final Cut Pro,
  Premiere Pro and DaVinci Resolve. V1 holds the base trim segments (with their
  source in points) or a plate, V2+ each overlay scene rendered as ProRes 4444
  with alpha (or a PNG sequence) from the new Remotion `SceneOverlay`
  composition, A1–A3+ the voice, music bed and per-cue SFX, plus captions and
  markers. FCPXML 1.10, xmeml v4, CMX 3600 EDL + SRT and OTIO writers share one
  frame-exact timeline model (`src/nle/`), with exact NTSC rates and drop-frame
  timecode, and every file is read back and checked against the model.

- Add the `launchclip-create-video-remotion` skill: the same subscription-agent
  cinematic workflow with Remotion 4.0.536 and React 19.3 as the renderer,
  `storyboard.json` as the primary artefact, and a new `standalone-remotion.md`
  runtime contract. Both create-video skills are now generated from shared
  sources in `skills-src/` by `scripts/sync-skills.mjs` (`npm run skills:sync`,
  checked by `npm run skills:check` and a test).
- Add a YouTube Shorts delivery floor (`resolveDeliveryProfile`): default
  word-highlight captions, a Shorts safe zone, loop endings, and a 25–35 s
  duration target for portrait videos of 60 s or less.
- Add subscription-skill scripts for word-synced burned-in captions
  (`word-captions.mjs`), an original procedural SFX and music-bed kit
  (`synth-audio-kit.mjs`), and two-pass loudness mastering
  (`master-loudness.mjs`).
- Add `build-mix.mjs` (narration, ducked bed and event-bound SFX from a cue
  list) and `build-evidence.mjs` (phase-2 temporal evidence, hashed manifest
  and paired critic contact sheets) so the post-authoring steps run without
  per-project scripts.

### Changed

- Gate rendered narration at −14 LUFS ±1.5 LU and a −1 dBTP true-peak ceiling
  so platform normalization and re-encoding neither bury nor clip the mix.
- Portrait shorts in the metered director lane now burn in word-synced captions
  inside the safe zone instead of relying on typography alone.

## 0.1.1 - 2026-07-18

### Added

- Add fit-for-purpose OpenRouter free-model discovery, benchmark-informed
  ranking, sticky local selection, automatic rotation, and bounded recovery.
- Add cost-aware local and free repair routes, compact repair capsules, native
  candidate verification, and blank-frame rejection.
- Add an interactive production review loop with human change requests,
  approval-gated rendering, and free independent critique routes.
- Add downloaded HeyGen avatar handoff support to the CLI and both packaged
  agent workflows while keeping the original source as factual evidence.
- Add a third-party licensing notice that distinguishes LaunchClip's MIT source
  from separately licensed rendering dependencies.

### Changed

- Update HyperFrames validation, font freezing, event sanitisation, motion
  gates, and narrated-music handling to match the current runtime contract.
- Expand the visual repair and verification pipeline with scoped source edits,
  exact anchors, visual snapshots, and resumable provider recovery.

### Fixed

- Keep provider request timeouts alive on Node.js 22 so silent responses and
  stalled response bodies abort cleanly instead of cancelling the test run.

## 0.1.0 - 2026-07-15

- Add a resumable, model-directed production lane for repository, product,
  topic, recording, narration, and presenter-video inputs.
- Add GPT-5.6 Responses planning, delegated HyperFrames frame authoring,
  independent multimodal critique, and selective bounded repair.
- Add ElevenLabs timed narration, Music v2, Scribe transcription, local SFX
  resolution, root-owned media assembly, and approval-gated rendering.
- Add HyperFrames lint/validate/inspect/snapshot gates and frame-by-frame motion,
  acceleration, cut, stillness, and reference-envelope analysis.
- Add directory resource expansion, authorized YouTube reference staging,
  Scribe word-timing propagation, and pitch-preserving narration conformance.
- Add model-output path containment, active-content/CSP isolation, native
  HyperFrames motion assertions, block-matched movement metrics, and rendered
  audio quality gates.
- Harden npm distribution with exact renderer versions, a complete runtime
  allowlist, and a clean consumer-install smoke test.
- Add `launchclip --version`, `launchclip doctor`, Node.js 22/macOS CI coverage,
  and npm/Homebrew/source release guidance.
- Keep runtime media writes inside user workspaces and expose the subscription
  skills through a validated Codex plugin manifest.
- Add release-readiness changelog packaging and README verification guidance.
