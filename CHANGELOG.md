# Changelog

## Unreleased

### Added

- A visual explainer's layout is measured before it is shown. The drawn
  scenes are played in a browser and every shape and piece of text is
  measured (two or three seconds, no model call): text off the frame or
  outside the readable area, a heading that anything passes over, text on
  other text, a label wider than its plate, a piece left unpositioned at the
  top-left corner, a scene that is close to empty. A scene with faults is
  drawn again with the measurements, and the redraw is kept only where it
  measures better. Scenes are also told to draw no wipes of their own and
  never to leave the frame empty at a cut.
- A visual explainer is what `make` plans when a video has nothing to show
  (no recording, no images, no asset provider). Every scene is a picture of
  what the narration says at that moment, drawn for the topic and timed to
  the spoken words, where the default had been a small cast of characters
  beside the captions. One call directs (the look, the scenes, the shared
  drawing props) and then every scene is drawn at once, one call each, as
  its own custom-module fragment under `hyperframes/visual/`. A scene whose
  code cannot be used is drawn once more, then shows its heading as a card.
  The run renders with HyperFrames; `--explainer characters` keeps the cast,
  as do `--renderer remotion`, `--speed draft` and `--refine`.
- Storyboard edit rounds: a plan that fails its checks on timing and value
  slips (overlapping scenes, an anchor that does not resolve, a cue outside
  its window, a card on screen too briefly, a scene held too long) is now
  corrected by small edits to the scenes the checks name. The model is shown
  the failing checks, where every scene sits, the named scenes and the
  narration's word times, and returns set, delete and remove-scene edits;
  tooling applies them and checks again, up to six rounds. Each call is a few
  thousand tokens, where a full repair resends the planning prompt and
  rewrites the storyboard. A round that leaves the plan no better is not
  kept, and a plan that needs a new scene or another module still goes to
  the full repair. `storyboard-plan.json` records each round as an `edit`
  attempt and counts them in `edit_rounds`.
- `launchclip preview <project>`: play a planned video in a browser before
  any render. The resolved story is compiled to the page the HyperFrames
  renderer draws and a player drives its timeline from the mix (play, pause,
  scrub, mute); nothing is rendered and no model is called. It is served on
  localhost, or written as a folder of static files with `--export <dir>`
  for a host to serve or embed in a frame (the page takes play, pause and
  seek messages and posts its time). Works after `--stop-after storyboard`,
  `--speed draft` and `--refine`.
- Plan-only mode: `launchclip make --stop-after storyboard` stops once the
  video is planned and renders nothing. The project then holds what a
  browser player needs (the resolved story, the narration and its word
  timings, the captions, the mix with the music bed and sound effects, and
  every media file), and `PLAYER-MANIFEST.json` lists each file with its
  role, size and sha256. The checks that need no rendered pixels are in
  `MAKE.json` `plan.checks`, the time planning took in `plan.timings`. The
  run ends `awaiting-approval` (exit 3); the same command with `--approve
  storyboard`, or `launchclip finish <project>`, renders the planned story
  and reuses every finished step. `launchclip finish --plan-only` does the
  same for any project with a storyboard. See docs/guide/headless.md, "Plan
  first, render on demand".
- `launchclip make --speed draft`: a fast draft for a first look. The script
  is one streamed model call on a hard word budget (each sentence is a
  progress line as it arrives), the voice is a take per sentence started
  while the script is still being written, the storyboard is made by rule
  (a small cast carries the lines) with at most one fast direction call
  beside it, every shot is asked of the asset provider at once with a short
  deadline (a late clip's scene is drawn), and the run stops at the plan-only
  stop: no candidates, render or critic. Every check that needs no pixels still
  runs. `--refine` continues a draft project to the full-quality plan on the
  same script and voice. `MAKE.json` then has `draft` (what was draft-made) and
  `milestones` (seconds to the script, the voice and the plan). See docs/guide/headless.md and benchmarks/MAKE_FAST_DRAFT.md.
- The OpenAI client streams a call that passes `onDelta`, and the cost
  tracker counts a streamed call when its stream ends.

### Changed

- A visual explainer fills the frame. The picture now runs edge to edge and
  to the bottom, where every scene had stopped above the captions and left
  the lower 40% of a 9:16 frame empty. Captions sit on top of the picture,
  one or two words at a time, and the director may hide them in a scene
  whose own type carries the words (never the opening, at most half the
  scenes). The camera punches in on the director's hits as well as pushing
  through each scene, labels are larger, and headings keep a clear band.
- A visual explainer's planning wastes less: props code that cannot be used
  is corrected on its own instead of the whole plan being directed again,
  and a scene call the provider refused (a rate limit, an account's
  in-flight ceiling) is sent again once the other scenes are drawn instead
  of becoming a heading card.

### Fixed

- The preview player runs inside a sandboxed frame. `index.html` held the
  video in a nested frame and read into it, which a host that embeds the
  preview as untrusted content (a sandbox with no origin of its own, a
  frame-ancestors policy) forbids: the player never started. It is now one
  document, the composition's own markup scaled to fit with the controls
  beside it, and is driven by postMessage alone. `composition.html` is still
  written.

- Model calls sent together through OpenRouter are answered together. Node's
  fetch sends later requests down the connection an earlier one opened, and
  OpenRouter answers the requests on one connection in turn, so from the
  second call of a run onwards work the model gate had in flight at once (a
  visual explainer's scenes, the long-form chunks, the asset descriptions)
  came back one call at a time: ten scenes took 260 s where the slowest took
  45 s. The CLI now gives each such call its own connection
  (`src/own_connection_fetch.js`); six calls that took 122 s take 20 s. A
  host that passes its own `fetch` keeps it.

- A hosted model that thinks by default no longer fails a stage by spending
  its whole output limit on reasoning: the call is made again with a small
  reasoning budget, which the run then keeps for that model.
- Storyboard: two slips that each cost a whole repair call are now tooling's
  to fix. A character scene a little under its module's shortest length is
  lengthened like any other scene (the cast check reports it under its own
  prefix, which the fit did not read), and a call to action that names an
  icon without a handle loses the icon. On real runs each repair resent the
  full storyboard prompt and took over a minute.
- Captions stay on screen when a style puts them in the middle of the frame
  (or at the top, low, or at a large size). Tooling used to hide them under
  every card that sat in their band, so a delivered video could have none
  for most of its narration. Hiding is now the last resort, scene by scene:
  the scene's own text or card moves out of the band (a card is moved or
  re-fitted above or below it; a clip's label takes its other slot); content
  that cannot move keeps its place and the captions move for that scene to
  the nearest free band, at their size; with no band tall enough they shrink,
  to 70% at least; only then are they hidden, and the warning says why
  (`layout: tooling cleared the caption band: …`, `layout: tooling placed
  captions …`, `layout: tooling hid captions …`). The planner, make's
  storyboard stage and finish all settle this way, and both renderers draw
  the moved captions from the same plan.
- A video whose captions are on but hidden under cards for more than 15% of
  its narration now fails: the storyboard check reports `captions: …` with
  the scenes (so a repair can fix it), and finish has a `captions` gate.
- The planner is told to plan scene text clear of the band the captions take.
- A transition between two full-frame footage scenes no longer drops the
  picture. On the world camera a `push` into a `clip` showed the new clip
  whole and inset for the first 40 % of the move, removed it, showed the
  empty background for a frame or two, then faded it up at full frame (both
  renderers); a `pull`, `fade`, `iris` and `glow-wipe` showed the background
  in the same way. A clip now counts as a full-frame picture, like a photo
  plate: it arrives over the outgoing scene, which stays whole under it, an
  incoming fade that starts late is hidden until it starts, and a push grows
  the new picture out of the old one on the camera's ease. Crossfades into a
  picture (morph, light-sweep, push-blur) no longer dip to the background.
  Between two footage scenes `card-to-card`, `rack-focus` and `morph` play as
  a fade, `story validate` warns, and the planner is told not to pick them.
  `kit/core/transition-frames.mjs` checks every transition type for a frame
  the two scenes do not cover, a scene that sits still mid-move, and a pop.
- `make` no longer fails the storyboard stage when a style puts the captions
  in the middle of the frame (or at the top, or low, or at a large size). A
  plan kept on a cadence near miss was never laid out, so every card in the
  caption band surfaced only when make checked the storyboard again, as "the
  storyboard failed its checks after make filled in audio". The layout check
  now runs whenever every module resolves and measures the band the captions
  really take; the planner is told where that band is; and the storyboard
  stage settles a card in the band, as the planner and finish do.
- A rerun or `--replan` no longer treats clips the asset provider wrote into
  `--assets` as handed-in media. They are recognised by content
  (`.launchclip/provided-files.json`), described from the provider's answer
  with no model call, and left out of routing (`routing.provided`), so the
  concept, the story, the script and the voice are reused.

### Added

- A captions overlay takes `zones: [{start, end, rect, scale?}]`: for those
  seconds its lines sit in the rect instead of the band, at `scale` (0.7–1)
  of their size. Tooling writes them; a storyboard may too.

### Changed

- The storyboard planner corrects a plan's mechanical slips itself, before
  the checks and without a model call, and reports each one as a
  `normalise:` warning in `.launchclip/storyboard-plan.json`: a character
  alone in a cast scene with a side position stands in the centre; scenes
  overlapping on a track are trimmed to meet; a cue time just outside its
  scene moves to the scene's edge; a target naming a character who is not in
  the shot becomes the side they stand on (or they join a wide shot with
  room); a cut that leaves a speaker off screen for a small part of their
  line moves so their shot covers it; a direction line naming a scene that
  is not on its words names the one character scene that is. A speaker
  absent for most of a line, a cue far outside its scene and scenes that
  cannot both keep their minimum length still fail.
- A storyboard repair pass redoes only the scenes its findings reach (named
  in a finding, on a line a finding names, or on screen at a time a finding
  gives); every other scene keeps the params it had, so a pass no longer
  fixes one finding and breaks a shot that passed. Findings about the plan as
  a whole (cadence, the hook, the card mix) leave the whole storyboard open.
  A failed attempt's plan is saved with its errors (`attempts[].candidate`).
- `make --animation` delivers a character story as a Short: with no
  `--aspect` it is 9:16 (it was 16:9). Pass `--aspect 16:9` or `1:1`, or
  name the shape in the brief ("a landscape cartoon", "16:9", "widescreen").
  Every other video keeps 16:9.
- A character story (a story made with a show bible) no longer takes its
  style's caption preset, which could lay a full-width band over the
  characters. Its captions are white outlined lines in sentence case, up to
  four words a line, placed where no character reaches; a style sets its
  own with `captions.lanes.characters`. The style gate fails a band or a
  plate over the cast.
- Every cast scene of a character story moves the camera for as long as it
  is up (a slow push-in on a speaker, a gentle drift on a wide shot, a
  punch-in on a reaction), in both renderers. A scene's own `zooms` replace
  it and `"camera": {"moves": false}` turns it off.
- The style gate measures what a style governs in a character story: the
  colours the storyboard sets itself (captions, brand frame, cards) against
  the brand colours, in place of the render's colour clusters, which are the
  show bible's world and cast. The motion grammar's shot range is not
  reported there. Other stories are checked as before.
- A character story's captions keep a phrase's last word with its phrase: a
  line cut for size one word short of a full stop or a comma hands words to
  that word ("The foal watched the" / "starting gate." where it was "The
  foal watched the starting" / "gate."). Other videos' captions are chunked
  as before.
- A `wide` shot on the `standing` set moves a character in from the side of
  the safe zone when its reach passes it. In 9:16 the right-hand place of a
  two-shot reached under the platform's buttons, so a wide two-shot failed
  the cast check whatever the planner wrote. Such a scene failed the cast
  gate before, so no video that rendered changes.
- In a character story the captions count as content for the density gate
  in the third of the frame they sit in.
- Reference sheets, cast sheets and demo recordings also find the headless
  shell a renderer already installed (Remotion's, then HyperFrames'), after
  `LAUNCHCLIP_CHROMIUM`, Playwright's Chromium and a system Chrome. When no
  browser is found the error lists every place it looked.
- A one-prompt explainer from `launchclip make` is carried by characters.
  With no media in `--assets`, an explainer or short-form script and make's
  seeded style, the direction map casts one to three characters for the idea
  (the subject as an object with a face, its parts as mascots), the
  storyboard is built from `character-cameo` and `cast-scene` shots with
  diagrams and cards as support, and the plan is checked for a character on
  screen for at least half the runtime and in the opening. The seeded style
  takes a playful tone when the prompt names none. `MAKE.json` `explainer`
  records the cast. A style you choose, supplied footage, `--animation`,
  promos and long form are unchanged.
- The planner catches three finish-gate failures before the render: a card
  with more words than its time on screen allows (`reading:`), an opening
  that draws itself from an empty plate (`opening:`), and a video of only
  line diagrams, step rows and text cards (`variety:`; the `variety` gate
  fails it too, as `abstract-only`).
- `make`'s concept and story stage succeeds on a bare prompt: the story may
  cite general knowledge of the subject (never a figure, a date, a name or a
  quote), the writer is told the structure the check holds it to, and the
  stage stops at a 300 s budget instead of running on.
- `make`'s script fits its word ceiling and ends on a call to action: an
  overshoot is cut by whole sentences, and a narration with no call to
  action ends on the writer's own, or a plain one ("Save this for later.").

### Fixed

- The ghosting gate counted a diagram's wiring (`from`, `to`, `point`,
  `weight`, `style` values) as words to read: a 10-word `line-diagram` failed
  as 33 words. Only copy is counted now.
- The script check did not know "Save this …" as a call to action, though
  the short-video rules ask the writer for it, and reported `cta-missing`.
- A take that ran short of its target was reported as words that "cannot be
  read" in the seconds the voice had just read them in (`fits-clock`).
- A `character-cameo` drew a wide character (a blob, a cup) or a wide
  gesture (a cheer) past the safe zone, failing the cast gate; it is moved
  and, where needed, drawn smaller to fit its area.

### Changed

- `make` runs independent work at the same time: the descriptions of the
  files in `--assets`, the planner's opening while the second opening is
  designed, the two candidates of a comparison, and a show bible's reference
  sheets. The files a run writes and its progress lines are unchanged.
  `--model-concurrency <n>` (default 4, or `LAUNCHCLIP_MODEL_CONCURRENCY`)
  limits how many model calls are in flight; `1` sends one at a time. A
  rate-limit answer is waited out instead of failing the stage, and
  `MAKE.json` `model_calls` says where calls overlapped.
- An OpenAI model's answer is picked up sooner. A background response was
  polled every 5 s, so each finished answer waited 2.5 s on average to be
  seen; it is now polled after 1 s, 1 s, then every 2 s, and every 5 s once a
  call has run two minutes. That is about 1.5 s less per call, or about 18 s
  over the dozen calls of a `make` run, with the same answers.
- The spending limit (`--max-cost-usd`) holds when calls overlap: a paid call
  starts beside others only when the most they can all cost fits under the
  limit, and otherwise waits its turn.
- `make` treats `--duration` as a ceiling. It still trims a script or a
  chapter that runs more than 15% over, but it no longer asks the model to
  add words to one that runs short: the video is shorter instead. In a long
  video the outline is no longer stretched to the duration, and the seconds
  a short chapter did not use go to the later chapters with the most facts.
  `MAKE.json` notes it when a video runs well under its target.
- `launchclip make` exits 2 when the video rendered but a gate still fails
  (`MAKE.json` `status: "needs-repair"`), so a caller can tell it from a
  finished video (0) and a failed run (1). It used to exit 0.
  `--allow-needs-repair` keeps the old exit code.
- `make` gives the critic up to three repair rounds by default
  (`--critic-repairs`, was one). A round that is no better is still undone and
  stops the rounds.

### Added

- Racing worlds and story props. Three new worlds, drawn at the cast's
  scale: `racetrack` (turf, the running rail, a grandstand in the distance,
  the winning post), `stable-yard` (stalls with half doors, hay, a water
  bucket) and `paddock` (a parade ring). New props a story can turn on:
  `bucket`, `hay-bale`, `saddle`, `rosette`, `finish-post`, `jump`, `sign`
  and `starting-gate`, which has two states. A `cast-scene` or `world`
  scene places props with `params.props` and cues a state change
  (`{id: "starting-gate", cues: [{at: "word:opens", state: "open"}]}`); the
  state lasts into later scenes. A story can cue it once for the whole
  video in `story.world.props`. `node scripts/racing-sheet.mjs` draws stills
  of each world with a foal and a mare.
- `launchclip make --animation` keeps a story to what the kit can draw. The
  writers' room and the designer are given the list of worlds, sets, props
  and character kinds; the script names what it shows (`SCRIPT.json`
  `shows`), and the script check fails one that turns on anything else
  (`undrawable`), which takes the one repair pass. The show bible records
  the story's props (`world.props`, `world.shows`) and they are pinned into
  `story.world`, so they are on screen in every shot; a change the script
  plays ("The gate opens.") is cued on the narration's words. The `bible`
  gate in `finish` fails a story that never shows a prop its bible says it
  turns on. `MAKE.json` `script.shows` says what the story shows and what
  only the narrator carries. `launchclip bible freeze --props <ids>` does
  the same for a bible you freeze yourself.

- `launchclip make --animation` reviews its own work before the delivery
  render. After the shots are planned it renders an animatic
  (`renders/animatic.mp4`, `ANIMATIC.json`) and a vision model reviews it
  for story, staging and acting. While the review does not say `ship`, the
  shots its findings name are retaken and only those shots render again
  (`qa/animatic-retakes.json`). The critic's repair rounds on the finished
  video are retakes too (`qa/retakes.json`). `--critic-repairs` is one
  budget for both. `--stop-after animatic` ends the run `awaiting-approval`
  so you can watch the animatic, and `--approve animatic` goes on from
  there; in a terminal make asks instead. The run ends `ready` on a `ship`
  verdict and `needs-repair` once the rounds are spent, with the animation
  path's exit codes (0, 1, 2, 3 `awaiting-approval`, 4 `ready-for-review`).
- Measurement for character stories. `npm run eval:formats -- --animation`
  scores six character-Short briefs from finished projects (contracts,
  story, design, direction, cadence, gates, critic, cost) without rendering,
  and `npm run eval:animation-parity` writes the make-against-skill table to
  `benchmarks/ANIMATION_PARITY.md`. The briefs have not been run on either
  path yet, so the table says so and holds no numbers. The `story-characters`
  profile gains four dialogue measures (speaker turns per minute, seconds
  per line, the share of speech on a listener's reaction, the longest
  stretch on one framing); their bands are hand-set and marked provisional.
  `scriptGate` (`src/script_gate.js`) fails a project whose `SCRIPT.json`
  has an unknown speaker, a character who never speaks or acts, a script
  over its length or a problem that lands late; `finish` does not call it
  yet. See `docs/ANIMATION_MEASUREMENT.md`.
- `launchclip make --animation` now makes the whole video. After the script
  and the voice it designs the cast and the world in one model call, from
  the rig's own options (the set paths `cast create` takes), freezes
  `BIBLE.json` with a reference sheet per character, and plans the shots
  with that cast pinned: a repair or `--replan` cannot change who is in the
  story. The cast is drawn `chibi` unless a style pack or the prompt names
  another style. `--stop-after bible` ends the run `awaiting-approval` so
  you can look at the sheets, and `--approve bible` goes on from there. In
  a terminal make asks instead. A frozen `BIBLE.json` already in the
  project is used as it is. The run used to stop after the voice with
  status `stopped`.
- Shot fields for character stories. A direction-map line may name the
  script line it plays (`"line": "l3"`, checked against `SCRIPT.json`). In a
  story told in beats, a character who speaks must be in a scene on screen
  for those words, unless the line says why the picture stays elsewhere.
  `launchclip story shots <project> [--json]` prints the shot list from
  `storyboard.json` and `DIRECTION.json`: each character scene with its
  frames, who is in it, the set and framing, key actions, pose changes and
  the lines said. `examples/story/dialogue-9x16` is a two-character dialogue
  with a script.

- `launchclip doctor --models` reports what your keys cover before you
  spend anything: whether you have a model that can write (script, cast,
  storyboard) and one that can see (the critic), and what to set if not. It
  reads the environment and a local Ollama's model list and makes no paid
  call. `--json` for scripts, `--model provider:model` to check another
  model, `--agent` for the skill path. `make` records the same report in
  `MAKE.json` as `model_access`.
- The critic now runs with an Anthropic key. The Anthropic client sends the
  contact sheets as images, so `make` with only `ANTHROPIC_API_KEY` writes
  `qa/critic.json` instead of leaving the critic pending. This adds one
  paid call per critic pass to those runs; `--no-critic` skips it.

- Custom modules render in HyperFrames. A `custom` scene may name a form
  per renderer, `"source": {"remotion": "remotion/Label.tsx", "hyperframes":
  "hyperframes/label.html"}`: the HyperFrames form is an HTML fragment with
  its styles and a script that adds tweens to the story's timeline, given the
  same `scene`, `params`, `brand`, `format` and `model` as the React
  component. A fragment that reads a clock or a random number, sets a timer,
  animates with CSS or loads anything remote is refused. One path, as before,
  is the Remotion form alone. See KIT_CONTRACTS.md, "Custom modules".

- A coverage test in the fast suite (`test/module_coverage.test.js`) fails
  when a module has no HyperFrames emitter, no Remotion component or no
  per-module parity fixture. `node scripts/parity-coverage.mjs` prints what
  is covered, and CONTRIBUTING.md says how to add a fixture.
- CI renders much more of the renderer parity corpus. Every pull request
  renders a rotating twelfth of the per-module fixtures (about 4 minutes),
  and a new "Parity corpus" workflow renders all of it at every sample time
  in twelve shards, nightly and on a pull request that changes the kit, a
  fixture or the harness. `node scripts/parity-shard.mjs` renders a shard or
  a rotation locally. Fixtures that fail on one platform are listed in
  `test/fixtures/parity-known-failures.json` as open bugs.
- Parity fixtures for the twelve modules that had none: `brand-lockup`,
  `photo-scene`, `split-screen`, `landscape-card`, `picture-in-picture`,
  `media-compare`, `media-stat`, `media-list`, `media-grid`, `drop-grid`,
  `live-counter` and `live-bars`, with drawn and generated test media.

- Every short gets the short-form checks. The hook and card rules used to
  run only when an app supplied a footage library, so a Short made from a
  prompt alone skipped them. They now run on every video of 90 s or less, and
  a new `hook` gate in finish checks how it opens: a claim or question
  readable on screen early (in a scene or in the captions), no logo-only open,
  an opening scene that arrives quickly, and a first spoken word on time. The
  limits are the cadence profile's own `first_visual_seconds` and
  `first_motion_seconds` bands, and the gate says where each number came from.
  The checks read the storyboard and the narration, so both renderers get the
  same verdict.
- A loudness miss is repaired. A master that lands more than 1.5 LU off
  −14 LUFS, or peaks over −1 dBTP, is run again from the raw render, aimed
  past the target by the miss, up to twice. It used to ship with a warning;
  now the `loudness` gate fails only if the repairs miss too.

- make understands the files you hand in. Every image and clip in `--assets`
  gets a short description: what it is (a pricing page, a dashboard, an
  onboarding flow, a product photo, a person on camera), the key words on
  screen, the story beats it suits, its orientation and, for a clip, the time
  ranges worth showing. A model that can take images describes each new file
  once (PAID, cached by the file's content so it is never sent twice); without
  one, make guesses from the file name, the kind of file, where a clip moves
  and the words Tesseract reads when installed. An app or agent that already
  knows what its files show writes the same fields (`shows`, `text`, `fits`,
  `feature`) in the notes sidecar and no model is called. The script writer
  and the director read the descriptions in the asset list.
  `--asset-descriptions auto|local|off`.
- A featured file is not left out. When you hand in three files or fewer, name
  a file in the prompt, ask to show what one file is, or set `feature: true`
  in its notes, a storyboard that never shows it is repaired; if it is still
  missing after the repairs, `MAKE.json` lists it under
  `assets.unused_featured` with a `featured:` warning.

- The skill path gathers evidence the same way the headless path does.
  `claims.json` (`--claims`) can now name each claim's primary source
  (`source_url`, `sources`, and `urls` for the file) and the source's own
  words that state it (`passage`). Research fetches, freezes and checks
  every named source, and a passage verifies a claim only when the page
  holds it word for word with the claim's numbers and dates. The file's
  shape is checked. The research skill reference now tells an agent with
  web tools to find primary sources itself, write `claims.json`, and run
  `launchclip research` and `launchclip research capture`.

- The photos and footage research finds can now be placed. Licence-clear
  stock and archive items (Wikimedia Commons, NASA, Internet Archive,
  Library of Congress, and Pexels or Pixabay with a key) are downloaded
  into `assets/research/` and listed in the planner's asset manifest with
  what each shows, the verified claim it was found for, and its licence and
  credit, for `media-window` and `photo-scene`. Research also looks for
  media on what each verified claim is about. The licence is checked again
  before download, and nothing unknown or incompatible is staged or
  offered.
- `publish.json` gains `credits` (licence and attribution for every
  research item the storyboard uses, also appended to the description) and
  `sources` (every recorded source page shown), and warns about research
  media placed without a cleared licence.
- Capture requests list the verified claims they back (`claims`).

- A missing evidence capture is loud. When a verified claim wanted its
  source page on screen and none was recorded (no Playwright or Chromium, a
  paywall, a bot check, a sign-in wall), `make` now lists each claim with
  the kind of failure and its fix in `MAKE.json` (`captures.status`,
  `captures.claims_without_capture`), warns once per kind, and holds the
  `research` gate at `pending`. `launchclip research` says whether this
  machine can record the requests it wrote, and `launchclip doctor` reports
  the recorder under `tools.evidence_capture` with the fix.
- `launchclip research capture [research] [--root .]` records every capture
  request, writes `research/capture-status.json` and attaches the evidence
  data, so a run by hand ends with the same files as `make`.

- Current news with no search key. `launchclip research` (and `make` when
  it researches) now finds stories through public sources that need no key:
  a named company's own RSS or Atom feed (and any `--feed <url>`), Hacker
  News, the GDELT article list and Wikipedia's current events. Each is only
  a lead: the page is fetched and checked as before, a story is kept only
  when a primary source states it, and no index is ever named in the
  script. `research/news.json` lists every story found, kept or dropped,
  with the reason. `--news none` turns these sources off.
- Publish dates and old news. Every claim records its source's publish
  date. A brief that asks for the latest ("today", "this week", "latest") or
  `--fresh-days <n>` sets a freshness window: older stories are dropped,
  and a claim whose source is older or undated is flagged for the script.
- Research reads `robots.txt` before it fetches a page or feed and skips
  what a site closes to it.

- `launchclip make` researches a news brief without being asked.
  `--research` now defaults to `auto`: research turns on when the brief is
  news or research shaped (news wording such as "this week" or "just
  announced", a dated event, a named release, a question of fact) and stays
  off for a product video, an evergreen topic, or a brief that brings its own
  script or recording. `on` and `off` still decide it yourself. The run
  prints the decision, and `MAKE.json` records it with the words that led to
  it under `research_decision`.

- `make` renders candidates for the opening and one risky transition before
  the draft, as the create-video skill does. It designs a second opening in
  a call that never sees the first, tries a different kind of move at the
  riskiest transition in the first 30 seconds, renders each candidate as
  three stills, and has a model that can see score them from the frames.
  The higher mean wins and goes into `storyboard.json`; the frames and
  scores are kept in `qa/rendered-candidates.json`, which `cinematic-check`
  reads. For short motion videos; long form and footage-led videos skip it
  for now, and `--candidates off` skips it everywhere.
- The headless critic runs with an Anthropic model. `make`'s Anthropic
  adapter now sends the contact sheets as image content blocks, so a run
  with only `ANTHROPIC_API_KEY` gets the critic and its repair rounds by
  default instead of ending `ready-for-review` with the critic pending.
  The adapter also streams a request that asks for more than 16,000 output
  tokens, which the SDK refuses to send unstreamed.
- `make` chooses a concept and a story before it writes the script, as the
  create-video skill does: five concepts, a judge that sees only the brief
  and the concepts, then the winner written as a story and tightened by an
  editor. `CONCEPTS.json` and `STORY.json` are written beside the script,
  the script is written on the story, the storyboard planner is given the
  concept's visual world, and a long video's outline is derived from the
  story. It adds four model calls before the script. `--concepts off` skips
  it, and a concept stage that fails is a warning, not a failed video.
- A make-vs-skill parity harness: `npm run eval:make-parity -- <make-project>
  <skill-project> --kind news` scores two finished projects made from one
  brief (distinct modules a minute, the typography share, cuts and visual
  events a minute against the cadence profile, held and repeated cards, the
  critic's verdict, and hedging, meta-narration and repeated facts in the
  script) and says whether `make` is within 15% of the skill. It reads the
  storyboard, the narration and `qa/critic.json`, so it runs offline; with no
  arguments it runs on a fixture pair. See `docs/MAKE_SKILL_PARITY.md`.
- `set-prop` (catalogue D) puts one story object in the world a cast stands
  in: a drawn prop from the world kit, or a project image or video from
  `assets/`. It stands on the floor, against the back wall, on the counter or
  on the wall, at a share of the frame width and a size in metres that
  matches the cast. Its track sets whether it is behind or in front of the
  characters. It moves with the world camera (and rides its plate in world
  mode), and it can cut, fade, pop, slide or drop in. Both renderers draw it,
  with parity fixtures.
- The world kit draws a `fridge`, `washing-machine`, `bookshelf`,
  `microwave` and `toaster`.

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

### Changed

- `launchclip finish` stops at the render stage, before anything renders,
  when a custom module has no form for the chosen renderer (or its
  HyperFrames fragment is missing or refused), and names the scene, the
  module and the renderer. It used to render the whole video with a "Missing
  module" card in it and fail the placeholder gate afterwards.

### Fixed

- Character stories: a cue anchored to a word (`at: "word:<text>"`) now means
  the word as it is said during the cue's scene, not the first time the
  narration says it, and a word that starts just outside the scene plays at
  the scene's edge. Cue times no longer come out negative, which had every
  critic retake undone. A retake the validator turns down is sent back once
  with the validator's messages and the plan's own checks, and
  `qa/retakes.json` records each attempt (`attempts`, `rejected`).
- A character moves its mouth on its own words in every scene it is in,
  whether or not the scene sets `says` (`says: []` keeps it shut), including
  a line a cut falls inside.
- A `walk-to` in a shot too short for the whole walk goes as far toward its
  target as the shot allows instead of failing the plan, and a plan for a
  character story is held to the acting and lip-sync gates before it renders:
  a line's action nobody on screen performs says whether the character needs
  a cue or a place in the shot.
- A character story's plan no longer fails outright when the planner leaves
  out the cue for an action its direction map names: when the character is
  already in the shot, tooling adds the cue on the line's words (a retake
  gets the same). A character turned to its target counts as looking at it,
  and a cameo's own card no longer counts as hiding a far look.
- A critic retake is told the actions its shots must keep and the targets a
  cue can take, gets two corrective passes in `make`, and when those run out
  keeps the shots that pass the checks on their own instead of losing all of
  them.

- HyperFrames drew a video in a media layout (`picture-in-picture`,
  `landscape-card`, `media-compare`, `media-grid`, `media-list`,
  `media-stat`, `split-screen`) without its drop shadow, and
  `picture-in-picture` without its paper ring. Both now match Remotion.
- `drop-grid` `times` is a list of seconds in the module schema. It read as a
  single number, so a storyboard that timed each drop failed validation.

- Critic repair rounds now work on long videos. The long-form storyboard
  stage returned its cached plan during a round, so every round failed with
  "the repair changed no scene". A round now re-directs the chunks that hold
  the scenes the critic named, starting from the cards they had.

- `photo-scene`, `evidence-clip` and `product-demo` honour their typed
  transitions instead of always fading over 0.4 s. A cut into or out of one
  no longer dips to the background under a character on a higher track, and
  one can open a video at full opacity on frame 0. They still fade where
  nothing carries them, and take `params.enter` / `params.exit` (`cut` |
  `fade`).

- An animated character story made from a prompt alone no longer fails
  `finish` with "cast check failed". The direction map's prompt now lists
  the cast ids and the kit's poses, expressions, sets and actions; free-text
  cues ("standing beside fridge", "hopeful, then wary", "shared kitchen")
  take the nearest kit value, each reported as a `cast: tooling mapped`
  warning; and cast cues are checked while planning (direction map and
  storyboard), so the repair loop sees what the cast gate would. A seeded
  style's generated default cast now takes the story's own character names
  (in order of first appearance, look and voice kept), written into the
  storyboard so the style does not re-apply its roster. A cast the story or
  a hand-written style defines is never renamed.

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
