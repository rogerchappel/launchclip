## Preserve the cost boundary

<!-- renderer: hyperframes -->
- Perform research synthesis, scripting, art direction, HTML authoring, visual
  review, and repair in the current agent session. The active subscription
  agent is the director, compositor, and critic; do not hand those jobs back to
  a metered LaunchClip model stage.
- Use local HTML, CSS, SVG, supplied media, FFmpeg, and the HyperFrames CLI by
  default.
<!-- /renderer -->
<!-- renderer: remotion -->
- Perform research synthesis, scripting, art direction, `storyboard.json` and TSX
  authoring, visual review, and repair in the current agent session. The active
  subscription agent is the director, compositor, and critic; do not hand those
  jobs back to a metered LaunchClip model stage.
- Use local React, TSX, SVG, supplied media, FFmpeg, the bundled Remotion kit,
  and the Remotion CLI by default.
<!-- /renderer -->
- Do not run `launchclip produce`, `creative-plan`, `direct-frames`,
  `production-critique`, or `production-repair`; those stages call metered
  model APIs.
- Use `launchclip cinematic-check` for new-story cinematic creation after a
  local draft render. Recorded treatments use their own local direction gate.
  Both checks are deterministic and do not call a model API.
<!-- renderer: hyperframes -->
- Do not require, install, or invoke the HyperFrames plugin or its skills. Use
  this skill's bundled reference and `npx --yes hyperframes@0.7.58` directly.
<!-- /renderer -->
<!-- renderer: remotion -->
- Do not require, install, or invoke a Remotion or HyperFrames plugin or skill
  pack. Use this skill's bundled reference, its `assets/remotion-kit`, and a
  project-local `remotion@4.0.536` / `@remotion/cli@4.0.536` install run
  through `npx remotion`.
- Remotion is source-available under its own licence; a company above its
  team-size threshold needs a company licence. Note this in `BRIEF.md` when the
  user is producing for an organisation; do not purchase anything.
<!-- /renderer -->
- Do not call paid model, image, voice, music, stock-media, or generation APIs
  unless the user explicitly opts into that provider and understands the cost.
- Never treat a ChatGPT, Codex, or Claude login as an API credential. OAuth
  subscription access does not populate `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
  or `ELEVENLABS_API_KEY` for subprocesses.
<!-- renderer: hyperframes -->
- Local deterministic tools, including FFmpeg, `ffprobe`, local Whisper or
  Parakeet transcription, and the HyperFrames browser/render runtime, stay
  inside this boundary.
<!-- /renderer -->
<!-- renderer: remotion -->
- Local deterministic tools, including FFmpeg, `ffprobe`, local Whisper or
  Parakeet transcription, and the Remotion bundler, headless Chrome and render
  runtime, stay inside this boundary. Remotion Lambda or Cloud Run rendering
  is a paid external service; use it only on an explicit request.
<!-- /renderer -->
