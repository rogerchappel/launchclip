# Changelog

## Unreleased

### Added

- Sound effects that fit the moment. `--sfx generated` (`make`'s default
  when `ELEVENLABS_API_KEY` is set; `finish` and keyless runs stay on `kit`)
  gives the accent cues a sound described from the event, the words on
  screen and the narration around it ("a small handful of metal coins
  dropping onto a wooden table", "single heavy rubber stamp pressed hard onto
  a sheet of paper"), generated once with ElevenLabs sound effects (PAID,
  about $0.01 a sound) and reused from the cache and the project's
  `.launchclip/sfx-events-lock.json` after that. Rules name most sounds; a
  `describeSounds` adapter (a model) may name the rest. At most one per 6 s
  (2 to 12 a video) and only accents, never transitions, risers or typing.
  Each lands its peak on the event, is loudness-matched to the kit cue it
  replaces and sits about 3 dB lower inside a spoken word. A cue with no
  description, or whose generation fails, keeps its kit sound. `--sfx kit`
  and `--sfx off` keep the kit or silence the effects. The SFX manifest
  records each sound's prompt and the generated cost; `MAKE.json` costs list
  them under `sfx`.
- `make --layout stacked` lays a 9:16 talking head out as one stacked video:
  the presenter stays on screen in the lower 45% of the frame, under a
  graphics panel that the planner fills with a visual per sentence. The
  planner writes only the moments that leave it: close-ups (a `full` section,
  now framed on the head with its `zoom`, 1.5–4 s) on personal lines, and
  inserts (at most 5 s) for a visual that needs the frame. Tooling builds the
  stacked sections between them, cuts in and out, and puts the captions on
  the seam one word at a time (the new `seam` caption position and
  `seam-word` preset). A stacked section takes a `share` (0.35–0.6) of the
  height. Checks hold close-ups and inserts to their limits, warn when 20 s
  pass without a close-up, and warn when the face falls outside the
  presenter's window. `--layout` is an enum (`full`, `stacked`, `overlay`).
- `make --layout overlay` keeps a talking head as one continuous full-frame
  take: inserts become overlays, and every overlay without a rect is placed
  in the free space around the presenter (the headroom above them, in front
  of their hands, beside their body), measured from their head. The planner
  is asked for one structure that builds over the video (behind the presenter
  with `layer: "behind"`), a title in the headroom and small props for each
  idea. Captions sit at chest height, one word at a time (the new `chest`
  caption position). Checks refuse inserts and layout sections and warn when
  a prop covers the face.
- Short-form scripts are paced and built like explainer reels that travel.
  A narration pace (`--pace calm|standard|fast`) sets the word budget, the
  clock's ceiling and the ElevenLabs voice speed. Short-form defaults to
  fast (about 215 words a minute, ceiling 4.2 words a second, voice speed
  1.2); story and data explainers to calm (about 135); the rest to standard.
  Short-form's default skeleton is now `stakes-list`: a stakes hook, an open
  loop, a numbered list where each item lands a specific, a pattern
  interrupt, the payoff and a call to action that follows from the last
  idea. New short-video rules ask for specifics over hedging, an open loop
  with a mid-way re-hook, and a call to action built into the story.
- `--cta-keyword WORD` with `--cta-offer "..."` ends the script on "Comment
  WORD and I'll send you ...", and `--episode "Job 1" --choices A,B,C` makes
  one episode of a series ending on a viewer choice. A short video's script
  pass also writes the post caption (the hook, the list one item a line, the
  call to action, "Save this"), which publish.json uses as its description
  with the line breaks kept.
- Script checks: `hedging` (two or more hedges in a short video; one is a
  `hedge` warning), `cta-keyword` and `cta-choice` (errors that feed the
  repair pass), and the `open-loop` and `rehook-missing` warnings. The clock
  and the rate band follow the pace; "Comment WORD" counts as a comment call
  to action.
- Illustrated character stories. `sprite-scene` stages one to three
  illustrated characters in a painted plate: each is a generated sprite cast
  (a picture per pose, plus mouth-open and eyes-closed versions), so poses
  swap on cues, mouths lip-sync their own dialogue lines by swapping
  sprites, characters blink and breathe, and they move with parallax as the
  plate pushes or pans. Props slide in, and a name card (NAME and ROLE) can
  introduce a character. `launchclip cast sprites <project>` draws the cast
  from `cast.sprites.json` with an image model and cuts it out (an anchor
  picture, then edits of it, so the character stays the same person).
  Story-cast entries with `art` are illustrated characters, and a
  character's own non-Kokoro voice id is now used under ElevenLabs, so every
  character in a dialogue speaks in its own voice.
- A satisfying-motion kit: things that pile up as they are said, numbers
  that never stop climbing, and objects with weight.
  - `drop-grid`: 1–40 cards, coins or tiles drop into a grid one by one,
    each on its own word (`params.times`), with a gravity fall, a squash on
    contact, an overshoot settle, a contact shadow and a puff of dust over
    faint empty slots. An optional counter climbs with every landing, and
    confetti bursts when the grid fills.
  - `live-counter`: a big figure that ticks up for the whole scene (steady,
    accelerating or easing) on a plain, panel or ticket face. Milestones
    stamp the figure and burst as the count passes them, and a delta chip
    ("+2,312 today") stamps in under it.
  - `live-bars`: raised bars whose values tick up live, each number riding
    the end of its bar.
  - The brand frame's running counter, `frame.counter` (`label`, `format`
    {prefix, suffix, pad, decimals, separator}, `steps` [{scene | start,
    value | text}]): "DAY 03", "STEP 2/4" or "LIABILITY $53,000" in a top
    corner, rolling up through in-between values and pulsing as each step
    lands, without re-entering between scenes. `frame.progress.style:
    "scrubber"` puts a knob on the progress line that travels with it.
  - Caption presets `tag-chips` (the sentence builds word by word; key
    phrases land in solid chips, ink on a light brand and paper on a dark
    one) and `serif-accent` (one key word per line turns serif italic in the
    brand colour).
  - The physics are shared in `kit/core/tactile.mjs` (drops, contact
    shadows, a stamp press, pulses and seeded particle bursts), so both
    renderers and every seek draw the same frame. Every landing, tick, stamp
    and burst is a model event with a kit cue and an `sfx` name (`land`,
    `tick`, `stamp`, `burst`); `frameCues()` lists the counter's landings.
  - The planner gets a "Satisfying motion" rule group and phrase rows for
    each module and the frame counter.
- `make` repairs what its critic finds instead of only reporting it.
  `--critic-repairs <n>` (default 1, 0 to 3; 0 turns it off) gives the
  critic's findings back to the planner as known problems. A repair verdict
  fixes the scenes the findings point at, and only those scenes render again
  when the timeline holds. A replan verdict, or a blocking or major narrative
  finding on the opening scene, plans again with the findings in the brief.
  The critic then reviews the new cut. A round that fails, changes nothing,
  or doesn't lower the blocking and major findings is undone (the storyboard,
  render and reports go back to the earlier cut), and the rounds stop. Each
  round is recorded in `MAKE.json` `critic_repairs`.
- Seven media layouts that show your footage inside the motion design, so a
  photo or clip is not always a full-frame cut or a small polaroid:
  `split-screen` (footage on the top or bottom half, the line's title, stat
  or list on the other), `landscape-card` (a 16:9 clip in a rounded window
  with a title and a caption or chip), `picture-in-picture` (a clip card in a
  corner of a panel), `media-compare` (two options, each in its own footage),
  `media-stat` (a figure that counts up beside or over footage), `media-list`
  (rows with thumbnails) and `media-grid` (2–4 tiles revealed one by one).
  Each works at 9:16, 16:9 and 1:1, enters in the style's motion grammar,
  shows its footage from the first frame and keeps text clear of the
  captions and the logo. The planner offers them for footage lines, a scene
  may ask the asset provider for several shots (one per slot), and the
  insert-variety pass rotates their variants and may turn a repeated polaroid
  into a split-screen. See
  [KIT_CONTRACTS.md](docs/KIT_CONTRACTS.md#media-layouts-catalogue-d-kitcorecatalog-d-media-layoutsmjs).
- Two caption presets: `kinetic-hierarchy` (the line builds up word by word;
  small connecting words, one large hero word glowing in the active colour,
  no box) and `soft-card` (the line on a rounded card in the brand primary).
  Caption options `weight`, `letter_spacing`, `case: "lower"` and
  `plate_style` (`box` or `scrim`, so a box-less preset that needs help to
  read over footage gets a soft scrim rather than a box).
- A `clip` module: one full-frame shot of your footage cut to the narration,
  cropped to the frame about a focus point, played from a source window, with
  a gentle Ken Burns move on stills, an entrance in the style's motion grammar
  and up to three callouts above the captions. Clip-led planning lets a
  narrated video be carried mostly by your footage: with `--assets` footage
  (or an asset provider) and a low density dial (`launchclip make --density
  0.2`, or the style's `dials.density`), the planner cuts clips to the
  narration and keeps motion graphics for numbers and steps; high density
  keeps today's motion-graphics plan. See
  [KIT_CONTRACTS.md](docs/KIT_CONTRACTS.md#clip-catalogue-d-kitcorecatalog-d-clipmjs).
- Direction constraints: an app can give `make`, `story plan` and `story
  validate` hard rules in `constraints.json` (in `--assets`, or
  `--constraints <file>`): picture-hidden ranges that full-frame inserts must
  cover, media that must appear and media that never may. The planner tells
  the model, makes every direction line over a hidden range an insert line,
  and fixes what the model leaves broken itself (the best-matching clip over
  the range, a must-use file on the line it fits). never_use files are left
  out of the inventory and refused from the asset provider. `story validate`
  and finish's `constraints` gate fail on a broken rule. See
  [docs/KIT_CONTRACTS.md](docs/KIT_CONTRACTS.md#direction-constraints-srcconstraintsjs).
- Footage inventory notes: a `<file>.json` sidecar or one `inventory.json`
  describes supplied media (description, subjects, tags, usable windows,
  quality, orientation, people and faces, role). The planner reads them in
  the asset manifest, clips are ranked by quality and matched to the line,
  and video scenes start inside a usable window.
- The storyboard engine is its own npm package, `@launchclip/core`: the
  `launchclip.story.v1` contract, the module registry with a JSON Schema per
  module, story migrations, story patches (RFC 6902), captions, transitions,
  the camera, the layout check, cadence and profiles. It is pure ESM with no
  dependencies and no Node built-ins, runs in browsers and Node, ships
  TypeScript declarations, and is versioned in lockstep with the CLI. Editors
  can now embed the engine at an exact version instead of copying it.
  `diffSegments`, which says which render segments a chat edit invalidates,
  runs there too, with the same hashes `finish` caches segments under. See
  [kit/core/README.md](kit/core/README.md).
- The Remotion kit is its own npm package too, `@launchclip/remotion`:
  `StoryComposition`, every module component and registry, captions, the
  brand frame and the bundled fonts, for apps that render stories in their
  own Remotion bundle or `@remotion/player`. It renders from its props alone,
  takes the app's media through an asset resolver, lets the app supply font
  URLs, and is versioned in lockstep with the CLI. See
  [kit/remotion/README.md](kit/remotion/README.md).
- The Node engine is its own npm package, `@launchclip/engine`: the planner,
  finish (voice, music, SFX, mix, master), the gates and critic, the segment
  renderer, NLE export and the footage-led lane, for apps that embed
  LaunchClip. Every model and provider call goes through adapters the app
  can replace (an LLM with vision, TTS, music, transcription, matting, media),
  state stays in the folders the app passes, and an asset-provider hook lets
  the planner ask the app for "a shot that shows X" from its media library or
  a generated asset. See [packages/engine/README.md](packages/engine/README.md).
- `launchclip make --asset-provider-cmd "<command>"` lets the planner ask
  your own command for shots: one JSON request per line on its stdin, one
  answer per line on its stdout, from your media library or generated. Shots
  land in the project's `assets/shots/`, and what they cost shows up in
  `make --json` under `costs`.
- `launchclip make --min-shots <n>`, with an asset provider, makes the
  planner cut to real footage from your library as often as it keeps the
  video moving, with at least `n` shots, instead of drawing everything as
  motion graphics. A plan may ask for about one shot per 3 seconds (6 to 24). Too few is a repair note, never a
  failure: when the repairs run out make keeps the best storyboard and warns.
  `make --json` reports `shot_counts: {min, requested, answered}`.
- `launchclip make --base-edited` takes a talking-head or screen recording
  you have already edited (bad takes, pauses) as the final base: make skips
  its own recording edit and dresses your cut as is. Add
  `--base-transcript <word-timed.json>` to use your transcript instead of a
  fresh Whisper pass.

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
- `brand.colors.focus` gives the focus ring its own colour, in a story or a
  style pack, so a style can keep its accent for something else. It is used
  when it reads at 3:1 on the background; otherwise the ring keeps the
  accent, as before.
- `launchclip cutdown` cuts voiceover-motion videos too. It splices the
  Short's narration from the long form's voice, moves the shots, beats,
  states and captions onto the Short's clock, lets each module lay itself out
  again at 9:16 (dropping a source line or title that no longer fits before
  dropping a shot), and opens on an image rather than a title card, so the
  structure gate's first-frame check passes. `--lines 23-28` or
  `--lines 64,71-74,78` (direction-map lines) and `--range 120-150` (seconds)
  pick the narration by hand, several stretches at once.

### Fixed

- Library-backed shorts open on stakes, cut to footage and stop mislabelling
  shots. The script's hook must carry a myth, a mistake, a number or a bold
  claim (a bare topic question such as "Choosing X for your Y?" is now the
  `opener-topic-question` script error). With an asset provider, the planner
  repairs an opening whose on-screen text is a bare topic ("Fence care?"),
  caps text and icon cards (concept-card, icon-row, icon-grid, checklist and
  the title cards) at one per 15 s, never two in a row and no module more
  than twice, and tooling drops a callout or grid label that the app's notes
  on the shot do not support, so the shot plays as B-roll under its line. A
  plan that misses only the hook or card limits still ships when the repairs
  run out.
- Library footage inside motion graphics no longer lands in the same tilted
  polaroid every time. A polaroid is a novelty frame: at most one a video
  (none when the style's playfulness dial is low, two when it is high) and
  never two inserts in a row in the same frame. The planner turns the rest
  into footage treatments that alternate: a Ken Burns `photo-scene` with the
  card's caption as its line, or a `clip` with it as a callout, fading in
  and out. Their shot requests may now come back as moving clips. A
  converted insert the library has no shot for goes back to its card.
- A polaroid holding a real photo shows it from its first visible frame,
  under a light veil that clears as it lands, instead of opening on a dark,
  empty frame for most of a second.
- The brand frame's logo reads at a glance. A logo with no label is now a
  logo mark: the logo alone at a visible size (a 22% × 6.5% box) in the
  canvas corner, 30 px in, instead of a 40 px icon inset in the safe zone with
  the story title beside it. A dark, mixed or unmeasured logo sits on a white
  rounded plate so it never disappears on a dark card or footage; a light one
  gets a dark plate unless every backdrop is dark (`brand_frame.kicker.plate`
  overrides). The logo's tone and aspect are measured from the file
  (`frame.logo_mark`), and modules keep clear of the mark. `style generate
  --logo` no longer adds the brand name beside the logo.

- Evergreen scripts say something again. When research sources confirm
  nothing on an evergreen topic ("3 common deck materials"), the script pass
  gets the general-knowledge notes instead of "state only facts listed here"
  with an empty list, which named the options and explained none. An
  evergreen topic with sourced facts may add well-established general
  knowledge; stories (quotes, dated claims, news only an aggregator carried)
  stay strict. The writer must say one usable thing about every option it
  names, and a new script check, `options-unexplained`, sends a script that
  lists three or more options and never comes back to them through the
  repair pass. Research also skips brand voice, copy brief, guardrails and
  brand facts notes: they direct the writer or are the brand's own account,
  and searching them looked up "carousel/image" as a model.

- Text no longer collides. The caption-band check counts a card's enter,
  exit and the time it is held under the next transition, reports every
  clash and grows the band to the preset's tallest line, and finish (and the
  planner) keep hiding captions until no clash is left. A caption line that
  repeats a title card on screen is hidden while the card is up. Text over
  footage (clip callouts, titles) keeps clear of the brand frame's logo
  kicker. An overview no longer holds a shot that the next shot landed on,
  so two cards never stack, and world-mode fades, pushes and pulls hand the
  plates over in turn instead of showing both cards' text at once.
- Remotion renders fit the container they run in: the `<OffthreadVideo>`
  frame cache is sized from the cgroup memory limit (Remotion's default is
  half the host's free memory, which a container may not have), and render
  tabs are capped by memory as well as cores, so an 8-core 7.5 GB container
  renders with 4 tabs, not 8. The `machine:` line shows the tabs and the cache.

- HyperFrames snapshots, evidence and gates work on long compositions. A
  page load had HyperFrames' 10 s navigation timeout, which an 8.5-minute
  explainer exceeds, so evidence failed although the render worked. Every
  HyperFrames call LaunchClip makes now sets
  `PRODUCER_PAGE_NAVIGATION_TIMEOUT_MS` to 3 minutes unless you set it.
- HyperFrames no longer warns at every shot start that the captions overlay
  fades out without a hard kill. Each time the captions dip out for a
  camera move, the compiler now ends the fade with a `tl.set` to opacity 0,
  so a seek past the fade finds them hidden. Frames are unchanged.
- `waterfall` draws a step's + or − half as large again. Condensed display
  faces like Anton draw them short and thin, and in a draft render of AI
  Rider's first episode a +0.5¢ step read as −0.5¢.
- `waterfall` keeps its values clear of the column labels: a loss that
  reaches the bottom of the chart used to print its value over the label
  below it, and a total below zero printed its value on the zero line instead
  of under the bar. Regression fixtures lock each step's sign and direction,
  for an all-positive build-up and for one that crosses zero, in both
  renderers.
- Evidence clips and other screen recordings move with the world camera in
  HyperFrames. Their video used to stay full-size on screen while the camera
  pushed, zoomed or pulled back for an overview; it now moves with its shot,
  and an overview shows it frozen on its last frame, as Remotion does.
- A screen recording shorter than its scene holds its last frame in
  HyperFrames, as in Remotion, instead of leaving an empty frame.

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
