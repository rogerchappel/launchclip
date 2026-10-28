# Changelog

## Unreleased

### Added

- Style packs and storyboards take a `medium`: `oil`, `watercolour`,
  `pastel`, `ink` or `gouache` paints every frame so it looks hand-animated,
  with wobbly edges, brush strokes or washes, paper grain and lines that boil
  on threes. Captions and the brand frame stay crisp above it, both renderers
  draw it, and `none` (the default) changes nothing. Describe it in plain
  words ("soft watercolour, dreamy") and a generated style picks it up. See
  [Make it look like you](docs/guide/styles.md#paint-every-frame).
- The script decides what kind of video it is. `launchclip make` now plans
  the script first, picking a format (`short-form`, `long-form`, `explainer`,
  `data-explainer`, `story`, `promo`), a goal (`reach` or `convert`) and the
  viewer's awareness, then writes against that format's beats and word budget
  (never more than 2.75 words a second). Choose them with `--format`, `--goal`
  and `--awareness`, or let the prompt decide. `SCRIPT.json` records the plan,
  the beats and three title options, and the storyboard follows the beats.
  The agent skills plan the same way (`references/script-formats.md`). See
  [Script formats](docs/guide/prompts.md#script-formats-goal-and-awareness).

- `launchclip script check <file>` lints a voiceover script before anything
  renders. It reports errors for a script that cannot fit its duration,
  numbers, quotes, ratings or deadlines that are not in the `--brief`, a
  greeting or overlong opener, no call to action or more than one, and
  sentences over 25 words. It warns about reading grade, sentence length,
  hype, number density, an unanswered hook and the narration rate. `make`
  runs the same checks on the script it writes and asks the model for one
  rewrite when they fail. The report is stored in `SCRIPT.json`. See
  [Check a script](docs/guide/headless.md#check-a-script).

- `launchclip fx <video> <module>` puts one effect on a clip: it cuts you out
  for that stretch when the effect needs it, renders the whole clip, and
  leaves an ordinary project you can keep editing. A new guide, [Effects
  around you on camera](docs/guide/effects.md), covers every effect and how
  LaunchClip picks them.
- `launchclip story plan --base` probes the presenter first, as `make` and
  the skills do, so the prompt offers subject effects only when the cut-out
  works (`--no-subject` skips it). A test now plans the footage fixture
  through the CLI and the skill's documented steps and checks they offer the
  same effects and land on the same choices.
- A designed cover: `cover: {text, number?, kicker?, frame?}` in the
  storyboard opens a Short on a 1.5 s title card that reads on its own in a
  profile grid, and `finish` renders the card to `video/cover.png` as the
  thumbnail with either renderer. The planner sets it for Shorts. Without
  `cover`, nothing changes.
- `publish.json` after every finished video, and `launchclip
  publish-manifest <project>`: titles, description, hashtags, the CTA, the
  cover and captions, whether the video fits each platform (YouTube Shorts,
  TikTok, Reels, YouTube, LinkedIn, X; App Store and Product Hunt on request),
  and per-platform UTM links with `--link` and `--utm`.

### Fixed

- Evidence clips and other screen recordings move with the world camera in
  HyperFrames. Their video used to stay full-size on screen while the camera
  pushed, zoomed or pulled back for an overview; it now moves with its shot,
  and an overview shows it frozen on its last frame, as Remotion does.

## 0.2.0 - 2026-10-23

### Highlights

- **One prompt to a finished video.** Through your AI agent with the
  create-video skills (Claude Code, or Codex on a ChatGPT plan), or headless
  with `launchclip make "<prompt>" --assets ./assets`. LaunchClip picks the
  kind of video from your inputs: a motion-graphics explainer, a
  voiceover-led piece, or an edit over your footage.
- **No API keys needed.** The voice (offline Kokoro), music, sound effects and
  rendering are built in and local. ElevenLabs, OpenAI and Anthropic keys are
  optional upgrades.
- **Demo autopilot.** Point it at your SaaS codebase: it starts the app,
  records the key flows in a real browser on safe demo data, and edits them in
  with zooms and callouts timed to every action (`launchclip demo …`).
- **Raw-footage base edit with audio clean-up.** Silences, bad takes and
  filler words are removed, and the voice is denoised, de-hummed, de-essed and
  levelled (`edit-recording --enhance`).
- **Looks like you.** Style packs v2, five starter styles, styles drafted from
  your previous videos, 14 caption presets, motion grammars, a world camera
  and ambient motion.
- **Two matched renderers** (HyperFrames and Remotion) from one
  `storyboard.json`, checked by parity tests and `npm run eval:renderers`.
- **Self-checking.** Layout, motion, audio and evidence gates, a critic step,
  and `finish --scene` partial re-renders when you ask for changes.
- **Finish in your editor.** Export to FCPXML, Premiere XML, EDL or OTIO.

The detailed list follows.

### Added

- The subject stage, the first step towards subject-aware effects
  ([RFC](docs/SUBJECT_EFFECTS_RFC.md)): `launchclip subject probe` reports
  whether one person can be cut out of a recording and how they are framed,
  and `launchclip subject matte --range` writes a cached alpha WebM of the
  person plus per-frame head and body boxes.
  - Runs locally in Node through the optional `onnxruntime-node`. The
    Apache-2.0 models download on first use (or with `launchclip subject
    setup`) into `~/.launchclip/models`, checked by sha256.
  - Mattes use MODNet's edges with holes filled from MediaPipe; the probe
    uses MediaPipe alone. `launchclip doctor` reports both.
- Scenes can sit behind the presenter in footage-led stories: `layer:
  "behind"` draws a scene under the cut-out subject, so their head covers it
  (both renderers, held to renderer parity).
  - `launchclip subject matte --project <dir>` files a matte in the project;
    `base.subject` (default `"auto"`) picks it up, or lists `mattes`
    explicitly, or turns the subject `"off"`.
  - Modules can also move the subject on its own (`subjectCamera`), hide,
    dim or blur the room around it (`room`), or draw on both sides of it
    (`split`). The first modules that use these arrive with the effects.
  - layout-check fails a front scene that covers the presenter's face for
    more than 0.3 s.
- The first subject effects, which the art director picks when the
  presenter can be cut out:
  - `masthead`: one huge word (a product name, the one idea) rises in
    behind the presenter's head, like a magazine cover.
  - `dolly-zoom`: the room pushes in or falls away while the presenter holds
    still. Matting a range now also builds a plate of the room without the
    presenter, which the dolly zooms.
  - `punch-in` gains `steps` (in, further in, back out on successive words)
    and `blur` (a few frames of zoom blur on each move).
  - The planner sees the presenter's framing and offers these only when the
    cut-out works; both create-video skills get a generated
    `subject-effects.md`.
- Five product moments around the presenter, which the art director picks
  from what you say:
  - `app-stage`: your product UI slides over the top of the frame and your
    head rises over its edge.
  - `phone-stage`: a phone beside you plays your screen recording or a
    demo-autopilot flow while the room pans away.
  - `backdrop-swap`: the room gives way to your brand colours or a product
    shot, and you glide down in front of it.
  - `feed-frame`: the video springs into a feed window and you break out
    over its edges (counts only when you give them).
  - `pull-back`: the video shrinks into an app window while real steps tick
    off and a counter reaches 100%.
- layout-check's face rule follows punch-ins and pans.
- A creative set for bolder styles: `glass-word` (one clear glass word on
  the wall behind your head, with a light sweep) and `orbit-cards` (your
  real screenshots, posts or quotes circling you, passing behind and in
  front), `proof-wall` (your real quotes and screenshots pin to the wall
  behind you, then a hero quote lands with a highlighter) and `scrapbook`
  (paper, boiling scribbles, you as a sticker, ransom-note letters) and
  `doodle-outline` (a boiling marker line traced round you, with doodles
  drawing on beside your head). `launchclip subject matte` now traces your
  outline per frame (`contours.json`) for it.
- The starter styles choose among the presenter effects: `bold-creator`
  reaches for the playful set, `minimal-tech` and `editorial-dark` prefer
  `masthead`, `phone-stage` and `backdrop-swap` and avoid the playful set,
  and `warm-documentary` keeps to punch-ins and `growth-line`.
- Checklists in footage place themselves beside you (above your head, or on
  your chest when there's no headroom), at a size that stays readable.
- `growth-line`: a line chart draws behind your head and kicks up into a
  glowing spike with a label, for "it doubled" moments (real figures need
  a source).
- `zoom-through` hides a cut in your edit: the frame rushes into it with
  zoom blur and bursts out of the next take. It finds the cut itself.
- `launchclip make` uses them on footage: it checks the presenter's
  framing after the base edit, plans with it, and cuts out only the stretches
  its subject effects cover. A missing model or a failed cut-out is a
  warning, never a failed video; `--no-subject` turns it off.
- A `photo-scene` module: one full-bleed `assets/` photo or video with a slow
  Ken Burns move (`push-in`, `pull-out` or a pan; `zoom` and `focus` set
  it).
  - The move is linear over the whole scene and keeps the canvas covered on
    every frame; the photo bleeds past the edges for a world camera's drift.
  - It takes an optional `scrim` and 1–3 short kinetic text `lines`. It keeps
    captions, so the lines sit above the caption band.
- A `brand-lockup` module for title and end cards built from the brand's
  artwork: a logo `mark` image beside or above a `wordmark` image (its
  `ratio` sets the width), with an optional `eyebrow` and `headline`.
  - `variant: "end"` stacks them over a `badge` image (such as an app-store
    badge) and a `url` pill.
  - `tint` / `markTint` recolour a dark wordmark or mark to paper (or any
    brand role or hex) on dark backgrounds.
  - A soft `glow` blooms behind the mark and keeps widening. `shine` sweeps
    light across the card as the mark lands at 0 s, then glints across the
    lockup once it has landed. An opener passes the motion gate's hook rule
    even with no headline and a dark brand colour.
  - It hides captions.
- A `cinematic` motion grammar (`"motion": {"grammar": "cinematic"}`).
  Every entrance, transition and camera move eases slow → fast → slow into
  its resting state (`power2.inOut`, enter 0.7 s, camera 1.3 s, no
  overshoot), and settled scenes keep moving:
  - editorial panels take the full 0.7 s to arrive (the other grammars cap
    them at 0.36 s);
  - every scene defaults to the `lively` hold drift;
  - `product-demo` lays a 4% push-in over its zooms, so a recorded clip never
    holds still between actions, and its fades follow the grammar;
  - the world camera drifts and breathes more.

  Art directions that say "cinematic", "filmic" or "Ken Burns" now suggest
  it, instead of `smooth` or `documentary`.
- Demo plans gain an `upload` step: `{type: "upload", text | selector, file}`.
  The recorder clicks the control (a button, a drop zone, a label, or an
  `input[type=file]` itself) and answers the file chooser with a sample file
  from the plan's folder. It's logged as a click, so the product-demo edit
  zooms to it like any other click. `demo doctor` checks the files exist and
  stay inside the plan's folder, and plays the step.
- `launchclip demo doctor <repo>` checks a demo recipe before recording.
  - **Without `--plan` (survey):** it reads the repo and recommends the
    cheapest setup rung (a plan, a test session, or fixtures). It reports what
    to reuse: the e2e `webServer`, `page.route` mocks and `addInitScript`
    sign-ins, MSW handlers, OpenAPI specs and HARs. It also reports the
    API-URL and analytics env vars, first-run flags and docs placeholders.
  - **With `--plan` (check):** it starts the app with consent and plays every
    flow at full speed with off-origin requests blocked. It reports each check
    with a fix:
    - steps that don't reach a visible element, with the closest texts and a
      screenshot;
    - ambiguous matches and covering overlays;
    - signed-out landings, telling a missing session apart from one the
      server rejected;
    - unanswered API requests, fixture errors and page errors;
    - requests a recording would let leave the app.

    It keeps a per-flow network ledger. `--json` prints the report for agents,
    and the exit code is 1 on any failure.
- `launchclip demo shots <docs>` lists `{/* video: … */}`, `<!-- video: … -->`
  and shot-list placeholders. `--draft` writes one flow per video into a
  `DEMO-PLAN.json`.
- The create-video skills gain a `demo-setup` reference. It teaches the setup
  ladder, what to show the person before anything runs, and the doctor loop.
- `examples/sso-app` is an SSO app with no seed data whose demo recipe reuses
  its e2e mocks and sign-in.

- Demo autopilot records apps with no seed data and apps that sign in through
  SSO. A `DEMO-PLAN.json` can name `app.fixtures` (an ES module whose
  `route({request, url, method, body})` answers the app's requests) or
  `app.har` (a recorded HAR), and with either, requests to other origins are
  blocked except `app.allowOrigins`. `app.session` starts every flow signed in
  from a Playwright storage state or from localStorage values and cookies;
  validation refuses values that look like real credentials, and they are
  masked in the action logs. `prepareContext` and `CURSOR_SCRIPT` are exported
  for scripts that build their own browser context, recording falls back to
  the Playwright the app's repo installs, and steps target the first visible
  match. See `examples/demo-app/demo`.
- Cap API spending at $50 per command by default. Once a command's tracked
  OpenAI, Anthropic and ElevenLabs spending reaches the limit, no new paid
  call starts (calls already running still finish, so the total can pass the
  limit by what they cost) and the command fails with
  `LAUNCHCLIP_COST_LIMIT` and its cost tally. Set the limit with
  `--max-cost-usd <amount>` or `LAUNCHCLIP_MAX_COST_USD`, or pass `none` to
  remove it. The limit applies per run, so a resumed production starts a new
  budget.
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

- `demo record` names the plan's fixtures module when it asks before running
  anything, even with `--no-seed --no-start`.
- A HAR that still holds credential headers, cookies, token-like values or
  real email addresses is refused.
- Gate rendered narration at −14 LUFS ±1.5 LU and a −1 dBTP true-peak ceiling
  so platform normalization and re-encoding neither bury nor clip the mix.
- Portrait shorts in the metered director lane now burn in word-synced captions
  inside the safe zone instead of relying on typography alone.

### Fixed

- A partial render can no longer ship a video a frame short. Each Remotion
  segment must hold exactly its frame range before it is cached (a short one
  is re-rendered once, else the render fails naming it), a short segment left
  in the cache is re-rendered, the join stamps every frame from its index, the
  delivery encode passes frames through, the soundtrack mux is limited by
  frame count instead of `-shortest`/`-t`, and the joined, encoded and final
  files must each hold the story's frame count.

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
