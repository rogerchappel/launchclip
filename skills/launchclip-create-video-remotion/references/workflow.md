# Workflow details

The full workflow behind the quick path in `SKILL.md`. Every requirement the
gates enforce is here or in the reference it names; load a section when its
step comes up.

## Contents

- [Preserve the cost boundary](#preserve-the-cost-boundary)
- [Conduct the compact intake](#conduct-the-compact-intake)
- [Style packs: keep a channel consistent](#style-packs-keep-a-channel-consistent)
- [Promote a downloaded HeyGen avatar](#promote-a-downloaded-heygen-avatar)
- [Resolve music and sound effects deliberately](#resolve-music-and-sound-effects-deliberately)
- [Freeze the brief and evidence](#freeze-the-brief-and-evidence)
- [Analyze supplied media before designing](#analyze-supplied-media-before-designing)
- [Design the video](#design-the-video)
- [Author and repair](#author-and-repair)
- [Obtain review and render](#obtain-review-and-render)

## Preserve the cost boundary

- Perform research synthesis, scripting, art direction, `storyboard.json` and TSX
  authoring, visual review, and repair in the current agent session. The active
  subscription agent is the director, compositor, and critic; do not hand those
  jobs back to a metered LaunchClip model stage.
- Use local React, TSX, SVG, supplied media, FFmpeg, the bundled Remotion kit,
  and the Remotion CLI by default.
- Do not run `launchclip produce`, `creative-plan`, `direct-frames`,
  `production-critique`, or `production-repair`; those stages call metered
  model APIs.
- Use `launchclip cinematic-check` for new-story cinematic creation after a
  local draft render. Recorded treatments use their own local direction gate.
  Both checks are deterministic and do not call a model API.
- Do not require, install, or invoke a Remotion or HyperFrames plugin or skill
  pack. Use this skill's bundled reference, its `assets/remotion-kit`, and a
  project-local `remotion@4.0.536` / `@remotion/cli@4.0.536` install run
  through `npx remotion`.
- Remotion is source-available under its own licence; a company above its
  team-size threshold needs a company licence. Note this in `BRIEF.md` when the
  user is producing for an organisation; do not purchase anything.
- Do not call paid model, image, voice, music, stock-media, or generation APIs
  unless the user explicitly opts into that provider and understands the cost.
- Never treat a ChatGPT, Codex, or Claude login as an API credential. OAuth
  subscription access does not populate `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
  or `ELEVENLABS_API_KEY` for subprocesses.
- Local deterministic tools, including FFmpeg, `ffprobe`, local Whisper or
  Parakeet transcription, and the Remotion bundler, headless Chrome and render
  runtime, stay inside this boundary. Remotion Lambda or Cloud Run rendering
  is a paid external service; use it only on an explicit request.

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
   effects are wanted, discover supplied/project/style/package audio first; ask
   for a folder only if no useful authorized local library is available. Honor
   permissions already supplied; confirm missing permission for likeness, voice,
   private material, reference analysis or paid music calls.

Do not ask for fields that can be sensibly defaulted. Use these defaults and
state them:

- interaction: collaborative; use autonomous mode when the user says
  "surprise me", "decide for me", or equivalent
- aspect: `9:16` for Shorts/Reels/TikTok, `1:1` for social feeds, `16:9` for
  YouTube, presentations, embeds, or unknown destinations
- duration: 30 seconds for a Short, 45 seconds for other short promos or
  explainers
- Shorts delivery: burned-in word captions, safe zone, loop ending and
  −14 LUFS master are on by default for portrait videos of 60 s or less
- language: the user's language
- output: `.launchclip/agent-<source-slug>` in the active workspace
- style: the user's named style or brand; with neither, a seeded style
  generated from your art direction in the brief step. "A different look"
  later means `launchclip style reroll`
- audio: preserve supplied speech; ask once about music and SFX when the user
  has not already decided. Never silently spend provider credits.

If the source itself is missing, ask for it before proceeding. Otherwise keep
working after the compact intake; do not turn each creative choice into another
approval round.

## Style packs: keep a channel consistent

A style pack is a channel's reusable identity. Every video of a series should
name the same pack instead of improvising its look from scratch.

### Storyboard videos (style pack v3)

A v3 pack is `.launchclip/styles/<name>/style.json`
(`"schema": "launchclip.style.v3"`; v2 packs still load). It holds the palette
(`brand.colors`: `bg`, `paper` = text on bg, `ink` = text on primary and
cards, `primary`, `accent`) and bundled fonts (`brand.fonts`: display, body,
meta), the motion grammar, camera and ambient level, the caption preset and
its options with per-lane defaults (`captions.lanes`), the SFX density and
music hints, preferred and avoided modules with per-module param defaults,
layout rules, an optional intro, outro and loop, and (v3) footage layouts per
intent and section (`layouts`), vocabulary choices, a cadence `profile`, a
`cast`, the `brand_frame` and the four `dials` (energy, density, playfulness,
polish; 0-1, moving targets inside the profile band only).

- Select it in `storyboard.json` with `"style": "<name>"` (or a path to a
  `style.json`). Names resolve in the project's `.launchclip/styles`, then
  `~/.launchclip/styles`, then the built-in starters: `editorial-dark`,
  `bold-creator`, `minimal-tech`, `warm-documentary`, `neon-explainer`.
- Leave `brand` out of the storyboard and write captions as
  `{"type": "captions"}`, so the pack decides them. Anything you do write
  explicitly wins over the pack, so only write a value when this video needs an
  exception.
- Add the channel intro or outro with
  `"style": {"name": "<name>", "intro": true, "outro": true}`; never author
  them as scenes. An intro is skipped (with a warning) on a story with a timed
  voice, because LaunchClip does not shift audio.
- Prefer the pack's `modules.prefer` and avoid `modules.avoid` when choosing
  modules. `launchclip story plan --style <name>` puts these rules, the caption
  preset and the grammar in the planner prompt.
- The brand frame (kicker, section labels, progress line) is drawn by the
  renderer around every scene: never author a kicker or brand label as a
  scene. Name the kicker and sections with `"frame": {"kicker": {"label":
  "Inside Ship Mode"}, "labels": [{"scene": "<id>", "label": "How it works"}]}`
  (`"frame": false` turns it off). Modules get its safe area as
  `model.frame.safe`. Its text follows each scene's backdrop: `frame.color`
  stays while it contrasts with the scene (a cast set's light wall, a dark
  plate), else the frame takes the brand colour that does. To force a colour
  for a stretch, add `"color"` (a brand role or hex) to that `labels` entry.
- Turn a dial for one video with `"style": {"name": "<name>", "dials":
  {"energy": 0.3}}`.
- Check the merged result with `launchclip story validate storyboard.json`; its
  `style.applied` list shows every value the pack filled.

### No style given: a seeded style

When the user names no style and gives no brand (no colours, logo, fonts or
reference video), do not fall back to the default look: every bare-prompt
video would then look alike. In the brief step, do the art direction and let
a seed vary the look inside it (docs/SEEDED_STYLES_RFC.md):

1. Choose what fits the prompt and write it in `BRIEF.md` under "Style" as
   constraints: `tone` (calm, serious, warm, energetic, playful, premium,
   technical), and only where the content calls for it `theme` (dark, light,
   tinted), `world`, `drawing_style`, `character_set`, `background` and
   `panel`. A cooking video might be warm and light; a security explainer
   serious and dark. Leave out what does not matter, so the seed has room.
   For `world`, prefer the fitting worlds over one: the worlds kit's
   `suggestWorld(prompt).worlds` (`scripts/worlds/index.mjs`) lists them, and
   the seed picks among them (`launchclip make` and `story plan` do this
   themselves). Name `character_set` when the story is about particular
   people (chefs, medical, kids, ...) or must not show them; otherwise the
   seed picks one, everyday sets twice as often as themed ones.
2. Generate the pack into the project from those constraints (the seed is
   random unless the user gives one):

   ```bash
   launchclip style generate --project <project> --tone warm --theme light
   ```

   It writes `.launchclip/styles/seed-<hex>/style.json` and prints one line,
   such as `style: seed 7f3a91c2 (light, smooth, Fraunces / DM Sans)`. Pass
   that line on to the user, and record the seed and constraints in
   `BRIEF.md`.
3. Use it like any pack: `"style": "seed-<hex>"` in `storyboard.json`, no
   `brand`, captions as `{"type": "captions"}`, and no `motion.grammar`
   unless this video needs an exception. In a hand-authored composition,
   carry the pack's palette, fonts, panel treatment and grammar into
   `DESIGN.md`.

From then on it is the project's style: re-renders and edits keep it.

- "Give me a different look" (or "another style", "reroll") means
  `launchclip style reroll <project>`: a new seed with the same constraints,
  written into `storyboard.json`. Then render again. `--tone <tone>` changes
  the tone too, and `--undo` goes back once.
- "I like this look" means `launchclip style keep <project> --as <name>`,
  which saves it to `~/.launchclip/styles/<name>` for `"style": "<name>"` in
  later videos.
- A seed the user quotes (`7f3a91c2`) is the same look again:
  `launchclip style generate --project <project> --seed 7f3a91c2`.
- Without the launchclip CLI, the skill's `scripts/style-seed.mjs` holds the
  same generator: `generateStyle({seed, tone, constraints})` returns the pack
  to save at `.launchclip/styles/<name>/style.json`.

Captions come from presets shared by both renderers: `word-highlight`,
`karaoke-fill`, `pop-word`, `bounce`, `typewriter`, `box-highlight`,
`underline-sweep`, `kinetic-stack`, `minimal-line`, `glow`, `outline-heavy`,
`split-color`, `lower-band`, `bubble`, `quiet-accent` (the footage-led
default when no style is named). Options (position, max words, case,
emphasis words, font role, size, brand-role colours, stroke, shadow, entrance,
exit, timing offset) go on the overlay or in the pack's `captions`.

## Mimic a reference

To match earlier videos (the user's own, or a reference they are allowed to
study), draft a pack from them instead of eyeballing:

```bash
launchclip style create my-channel --from-reference ep1.mp4 ep2.mp4 [--from-images thumb.png] [--font-hint "Bebas Neue, Inter"]
```

It measures palette, pacing, motion energy, approximate caption placement and
highlight colour, loudness and SFX density locally, and suggests the nearest
bundled font families. It writes `style.json` and `reference-report.md`, with a
confidence for every value. Read the report, fix low-confidence values by hand
(fonts and accent colours are the usual ones), then render with the pack and run
`launchclip style check <project> --against my-channel` to measure drift.
`launchclip finish` runs the same check as its `style` gate whenever the
storyboard names a style (palette, caption preset, cadence inside the style's
profile band, brand frame; `qa/style-check.json`).
Reference media and fonts are never copied into the pack.

## HyperFrames projects (v1 packs)

Older packs hold `frame.md`, an optional caption skin, fonts, audio notes and
assets. When the user names one of these:

- Read `style.json` and the complete `frame.md` before designing.
- Inspect any caption skin, fonts, audio notes, and assets named by the pack.
- Copy the resolved pack into the output project's `style/` directory so the
  composition and later render do not depend on mutable external files.
- Record the pack name and source path in `BRIEF.md`. Translate its palette,
  type roles, graphic language, motion character, and forbidden motifs into
  the project-specific `DESIGN.md`; keep scene composition driven by this
  video's content rather than cloning the previous edit.

`launchclip style upgrade <name>` converts a v1 pack to v2 (the v1 files stay).
If no pack exists, treat the requested words as creative direction and design
an original system for the video. After an approved video, create a reusable
pack only when the user asks (`launchclip style create <name> --from
<output-project>`, or `--from-reference` for a rendered video). These local
commands make no model calls. Never overwrite an existing pack without explicit
`--force` approval.

## Promote a downloaded HeyGen avatar

When the user supplies an already-generated, authorized HeyGen MP4, treat it as
the production's presenter-and-narration source:

- Keep the original brief, repository, URL, or research source as evidence.
- Treat the avatar's spoken audio as authoritative; do not rewrite or replace
  it unless the user explicitly requests a new script or voice.
- Copy the video into the project, probe it, trim boundary silence only, and
  transcribe it locally when no transcript is supplied.
- Extract one continuous local narration track from the prepared video. Feed
  it into the single offline mix that plays through the one root `<Audio>`
  for the whole edit.
- Mount the prepared video as muted `<OffthreadVideo>` segments inside
  presenter-visible scenes. Preserve continuous source time across segments by
  deriving each segment's `startFrom` from its scene start; use the same video
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
- **Sound effects:** support none, authorized local files, the locked SFX
  library, or the original procedural kit from `scripts/synth-audio-kit.mjs`
  (local FFmpeg, no samples, no cost; 31 families with several seeded variants
  each, UI clicks and mechanical keystrokes). When the style pack has a
  `sound` block, pass its palette and the style's seed (`--palette <id>
  --seed <seed>`), its genre for the bed (`--genre <id> --key <k>
  --progression <n>`) and its ambience bed (`--ambience <bed>`; for `auto`
  use the style's world), so the video sounds like its style; the option
  lists and the world → ambience map are in `scripts/sound/options.mjs`. With the LaunchClip CLI, `launchclip
  finish` resolves cues through the library seeded once with `launchclip sfx
  seed` (ElevenLabs with the user's explicit approval, or the procedural kit),
  then the kit; see
  [references/sfx-library.md](sfx-library.md). Inspect supplied
  resources, project/style-pack audio, and the active LaunchClip checkout or
  installed package's `public/sfx` if it exists; do not assume every distribution
  includes a library. Recursively inventory `.wav`, `.mp3`, `.m4a`, `.aac`,
  `.ogg`, and `.flac` files, then copy only selected cues into the project. Match cues by semantic filename and
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
- `STORYBOARD.md`: time-coded scenes, spoken beat, visible idea, on-screen copy,
  assets, motion development, transition, and audio intent
- `storyboard.json`: the primary build artefact (`launchclip.story.v1`): format,
  brand, audio, one scene per storyboard shot with its catalogue `module` and
  `params`, typed `in` transitions, word or beat anchored `hits`, overlays
  and ending. The Remotion composition, audio cues, captions, layout check and
  evidence schedule are all derived from it
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

## Record the product (demo autopilot)

When the user points at a SaaS codebase and the video should show the product
in use, record the flows with demo autopilot before writing the storyboard.
Skip this step when they supplied their own screen recordings.

When the app signs in through SSO, has no seed data, or loads its data from an
external API, the plain flow below won't record it. Follow
[references/demo-setup.md](demo-setup.md) instead. In short:

1. Run `launchclip demo doctor <repo> --json` to get the recommended rung.
2. Write the `demo/` recipe, reusing the repo's e2e mocks and sign-in.
3. Show the person the commands and the recipe.
4. Run `launchclip demo doctor <repo> --plan demo/DEMO-PLAN.json --approve
   --json` until it's clean.
5. Record, then review the contact sheets.

1. **See how it runs.** `launchclip demo record <repo> --plan-only --out
   <project>/assets/demo` reads the repo (package scripts, README,
   docker-compose, Procfile, `.env.example`) and the code's routes and nav
   links, then writes a draft `DEMO-PLAN.json` without running anything.
2. **Plan the flows yourself.** You are the planner. Edit `DEMO-PLAN.json` to
   2–4 flows that sell the product for the brief, for example *sign up →
   create a project → see the result*. Use only routes, link and button text
   and field labels you found in the code. Start every flow with a `goto`, and
   list a sign-in flow in another flow's `setup` when that flow needs a
   signed-in user (setup runs off camera). Put a short `callout` (≤ 42 chars)
   on the step where a feature appears. Sign-in fields take
   `{"account": "email"}` / `{"account": "password"}`: the recorder fills them
   from the repo's seed data or `LAUNCHCLIP_DEMO_EMAIL` /
   `LAUNCHCLIP_DEMO_PASSWORD`. Never write a password, key or token in the plan.
   Check the plan before recording: `launchclip demo doctor <repo> --plan
   <project>/assets/demo/DEMO-PLAN.json --approve --json` runs every step and
   reports each problem with a fix.
3. **Ask before running anything.** Show the user the plan and the commands
   autopilot will run: the seed script (`npm run seed`, `prisma db seed`…)
   and the start command, plus the URL it will record. Run
   `launchclip demo record <repo> --plan <project>/assets/demo/DEMO-PLAN.json
   --out <project>/assets/demo --approve` only after they agree. Use `--start
   "<command>" --url http://localhost:<port>` when detection guessed wrong,
   `--no-seed` when there is no safe seed, and `--no-start --url …` for an
   app that is already running. Only local and staging URLs are recorded;
   `--allow-host <host>` is the user's explicit opt-in for anything else.
4. **Show every flow.** Open each `<flow>.sheet.png` contact sheet (and the
   clip when in doubt) with the user, and fix the plan and re-record anything
   that looks wrong: a missed click, an empty page, or private data. Approve
   only what the user accepts: `launchclip demo approve <project>/assets/demo
   [--flows a,b]`. Unapproved flows never go in a video.
5. **Edit them in.** For each approved flow, `launchclip demo scene
   <project>/assets/demo --flow <id> [--source-start s] [--duration s]` prints
   the `product-demo` params built from its action log: the clip window, the
   clicks and typing with their bounding boxes, and the callouts. Paste them
   into a `product-demo` scene unchanged, so the zooms, outlines and SFX land
   on what happened in the app. Shorten a flow with `--duration`; never edit
   the action boxes or times by hand. Narrate over the flow, and keep the
   motion-graphics scenes for the claims around it.

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
- For a recording with one presenter, run `launchclip subject probe <video>
  --json` and record `usable` (with `reasons` when false), `framing` and
  `headroom` in `SOURCE.md`. Plan subject effects only when it is usable, and
  skip the ones that need headroom on a close-up (see `subject-effects.md`).
  Run `launchclip subject track <video> --project .` too, so placement and
  layout-check know where the face is through the whole take.
  When the `launchclip` CLI is not installed, there are no subject effects;
  carry on with the rest of the library.
- Record the measured cut rate, hold pattern, first meaningful motion, and the
  visual registers used: presenter, typography, UI/proof, diagram, spatial
  transition, or full-frame reset.

Do this analysis with local tooling from the bundled reference. Never submit
private footage to an external transcription or vision API without explicit
permission.

## Design the video

Write the direction map first: `DIRECTION.json` from
[references/direction-map.md](direction-map.md) gives every line
of the narration an intent and a treatment (dress, insert, face or camera),
and names the scenes that will show it. Aim the treatments at the story's
cadence profile ([references/profiles.md](profiles.md)): coverage
near its target, no undressed run past its limit. Then author the storyboard
against the map.

Author `storyboard.json` from
[references/storyboard-modules.md](storyboard-modules.md). It is
generated from the module registry and lists every catalogue and editorial
module with its params and events, the phrase→module table, the lane and tier
rules, the time-anchor syntax, and the safe-zone and caption rules. Pick each
scene's module from what its line says, fill the module's params, and anchor
hits to measured words; reach for bespoke code only when no module carries the
idea. `launchclip story plan` sends the same reference to a model when you
want a first draft from a brief.

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
  each world. Treat an independent full-frame remount (a fresh scene that
  carries no object across its boundary) as a cut, not continuity.
- Reserve safe areas for captions and platform UI when applicable.
- For every presenter-plus-graphic scene, declare a presenter-safe area and a
  non-overlapping graphic zone in `STORYBOARD.md`. Pan or crop the presenter
  into the opposite zone before placing a panel. If neither side has usable
  negative space, use a true split, compact picture-in-picture, or full-frame
  graphic cut instead of covering the face.
- Derive split crops from the target rectangle and presenter focal point. The
  transformed crop must fill the entire target bounds with no black or dead
  band; validate the first, middle, and last frame of every split state.
- Use catalogue modules, React-rendered semantic DOM, SVG, diagrams, charts, or
  UI reconstructions before seeking generated raster imagery.

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
- Pick one motion grammar for the whole piece from the art direction and set
  it as `motion.grammar` in `storyboard.json`: `editorial` (the default; clean
  product editorial), `snappy` (punchy, energetic launches: expo-out, short,
  slight overshoot), `smooth` (calm, premium, elegant: sine/power2, long, no
  overshoot), `playful` (fun, friendly, for kids: back/elastic, springy, bigger
  staggers), `documentary` (serious, archival, news: slow power1) or
  `cinematic` (film-like: every entrance and move eases slow → fast → slow
  into its resting state, and settled scenes keep a slow push-in, recorded
  product clips included, so no frame is ever fully still). One
  grammar keeps every entrance, exit, pop, stagger, transition and camera move
  in the same voice; override single roles with `{base, ease, duration,
  stagger}` only when the brief asks for it.
- Choose the camera from the lane and the direction. Footage-led stories keep
  `camera.mode` "cuts" with punch-ins. Motion and voiceover stories use
  `camera.mode` "world" when the direction asks for travel (a journey, a map,
  one continuous take) or the grammar is playful, snappy or smooth: the scenes
  then sit in one world, the camera pans (`pan` with a direction), dollies in
  (`push` into a named object such as `s3.gap-bracket`) or out (`pull`), turns
  (`orbit`) or whips (`whip-pan`, motion-blurred) between them, drifts slowly
  through every hold and moves a parallax background behind them. A cuts story
  can still use one `pan` where a camera move says "the next idea is beside
  this one". End a world-camera loop with a short `whip-pan` home.
- Inspect settled world-camera frames at delivery size, not only the moves.
  If the parallax background shows hard edges or vertical seams on a hold,
  set `camera.parallax: false` (the camera still travels, but this also
  removes the moving background field, leaving the flat background colour)
  or switch to `camera.mode` "cuts" and keep the travel as typed camera
  transitions (`pan`, `push`, `orbit`, `whip-pan`), which keeps the ambient
  field. Record which one you chose and why.
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

For recorded-video editorial work, follow `references/recorded-video.md`
instead of this cinematic sequence. For cinematic creation, follow the
scaffold, `storyboard.json` contract, frame-pure rule, and commands in the bundled
reference. Work in this order:

1. Verify Node.js, FFmpeg, and the pinned Remotion toolchain
   (`remotion@4.0.536`, `@remotion/cli@4.0.536`, React 19.3).
2. Probe, trim, transcribe, and temporally inspect supplied media locally.
3. Scaffold a project from this skill's `assets/remotion-kit` without
   installing any skill pack.
4. Copy or link only approved assets into the project's `assets/` directory
   using stable local paths.
5. Run the five-concept tournament and fresh-context selection.
6. Write and independently edit the canonical retention story.
7. Produce or prepare narration, measure the real take, then freeze the
   storyboard, design system, music/edit grid, and quality targets. For a
   synthesised voice, write the script into `audio.narration`
   (`{text, provider?, voice?, speed?}`; defaults Kokoro, `af_heart`, speed
   1.2) before any scenes, run `launchclip voice <project>` to synthesise it
   (cached) and print its real duration and per-sentence timing, adjust the
   text or `speed` until it fits, then size `format.duration` and the scenes
   to that take and anchor scene starts and hits to words (`word:<text>`).
   `finish` reuses the measured take. See "Narration" in the runtime
   reference.
8. Write `storyboard.json` from the frozen storyboard. Its typed `in` transitions
   are the declared phase-2 boundaries that `cinematic-check` reads. Render two
   independent opening candidates and two candidates for one representative
   unproven transition grammar. Compare their real pixels and motion at
   delivery size, choose deterministically, and preserve the candidate receipt
   and artifacts before full authoring.
9. Author every scene from the selected treatment and frozen artifacts:
   catalogue modules and `params` first, and bespoke TSX modules under
   `remotion/modules/` only for the flagship tier.
10. Run `launchclip story validate` early and after every edit.
11. Run `launchclip layout-check`, then render stills at the dense-hook times
    and on both sides of every boundary. Sample shared-world moves at
    departure, early acceleration, peak speed, late deceleration, and settle
    rather than checking only their endpoints.
12. Inspect every generated still and overview image, not only the command exit
    code.
13. Review the opening, every transition boundary, every major type state, and
    the final frame at delivery scale. Step adjacent frames in Studio when a
    still suggests clipping, popping, or a discontinuity.
14. Render a local draft, build the hashed temporal-evidence manifest with
    `--renderer remotion`, require the fresh-context critic to cite reviewed
    evidence IDs, and run `launchclip cinematic-check --renderer remotion`.
15. Repair the smallest responsible scene, module parameter, mix, or plan, then
    rerun the failed gate. For a second-pass scene fix, look first with
    `launchclip finish <project> --preview-scene <id>`, then run
    `launchclip finish <project> --scene <id>`: it re-renders only that scene's
    segments, re-runs master, evidence and gates, and writes a before/after
    still to inspect. Stop after three bounded passes and report
    `needs-repair` instead of weakening the contract.

Do not weaken checks, mark accidental overlaps as intentional, or use draft
rendering to conceal a composition defect. Keep all motion a pure function of
the current frame: no animation state in `useState` or `useEffect`, no
`Math.random()` or `Date.now()`, and no CSS transitions or keyframe animations.

## Obtain review and render

For recorded-video work, use the verification and delivery checks in
`references/recorded-video.md`. Full treatments require the recorded direction
readiness gate, while base-edit-only exports use recording QA. Neither route
needs fabricated cinematic tournament receipts. The cinematic creation
requirements below apply to new-story creation only.

Open Remotion Studio (`npx remotion studio`) only after the automated gates,
visual still review, and `CINEMATIC-READINESS.json` all pass. Tell the user
where the editable project and preview are located, summarize any deliberate
limitations, and ask for explicit render approval.
Studio's Render button is useful for an ad hoc draft, but it is not the
workflow's approval signal or final artifact.

If the user edits `storyboard.json`, a bespoke module, or the props in Studio, rerun
`launchclip story validate` and `launchclip layout-check` and inspect fresh
stills before asking for approval. If those checks trigger a repair that
changes the visible result, refresh Studio and obtain fresh approval of that
repaired state.

**Prototype first.** For a story over 60 seconds, render the opening before
the whole: `launchclip finish <project> --prototype` renders the first 20–30 s
(cut at a sentence end) with the full style, layouts and sound to
`renders/prototype.mp4`, and runs the coverage, direction and face gates on
that opening: only the direction-map lines and scenes inside it are checked,
and the whole-video shares (coverage, face time) are reported as `advisory`
rather than failing it. Show it to the user and stop for review; render the
whole video only once the opening is right.

**Draft and final.** `launchclip finish` defaults to `--quality draft`,
which writes `renders/draft.mp4`: the same resolution, frame rate, timing,
mix, loudness master and gates as the final, encoded faster at a lower
bitrate (Remotion CRF 28 `veryfast`; HyperFrames `--quality draft`, CRF 28
with lighter frame capture). Every
gate, the critic and `cinematic-check` judge this draft, and it is a
reviewable deliverable. `--quality high` writes `renders/final.mp4` (the full-quality encode)
and needs the user's explicit approval in this conversation after they have
seen the draft or Studio preview, for example "render the final". A passing
gate, a `ship` verdict from the critic, or the original request to make a
video is not that approval. When the user has not approved yet, deliver
`renders/draft.mp4`, say plainly that it is the gated draft, and give the
one command that renders the final once they approve.

After approval:

1. Render from the Remotion CLI (`npx remotion render`, version 4.0.536) to a
   stable output path at the requested quality, with the resolved story as
   props. Master the audio with `scripts/master-loudness.mjs` (−14 LUFS,
   −1 dBTP).
2. Confirm the file exists and is non-empty.
3. Probe its duration, dimensions, video codec, and audio presence.
4. If a final render is visually different from the reviewed stills, repair,
   recheck, obtain fresh approval, and rerender.
5. Return the project path, planning artifacts, QA result, and final media path.

Do not publish, upload, or post the result unless the user separately asks for
that external action.
