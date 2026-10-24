# RFC: Subject-aware effects for recorded footage

Status: draft, open for review
Date: 2026-10-24
Builds on: [STORYBOARD_ENGINE_RFC.md](STORYBOARD_ENGINE_RFC.md),
[DUAL_RENDERER_PLAN.md](DUAL_RENDERER_PLAN.md),
[KIT_CONTRACTS.md](KIT_CONTRACTS.md) ("Footage-led lane", "Product demo")

## 1. Summary

The footage-led lane can lay graphics **over** a recording: punch-ins,
callouts, lower thirds, emphasis captions. It cannot put anything **behind**
the speaker, and it cannot move the speaker separately from the room. Those two
abilities are what make the strongest short-form talking-head edits look
designed rather than decorated: a giant word that the presenter's head covers,
a product UI the founder stands in front of, a chart that draws behind their
shoulders, a dolly zoom where the room moves and the person does not.

This RFC adds:

1. **A subject stage**: a local, cached person cut-out (an alpha matte) plus a
   per-frame description of where the head and body sit.
2. **A depth contract** in `storyboard.json`: scenes can sit behind the
   subject, and modules can move or restyle the subject separately from the
   room.
3. **About fifteen new or extended library modules** that use it. Each is a
   normal catalogue module, so the planner (the art director) picks them the
   same way it picks `checklist` or `punch-in`, and style packs can prefer or
   avoid them.
4. The same capability from **both entry points**: the headless CLI
   (`launchclip make`, `story plan`, `finish`) and the bundled create-video
   skills, driven from one registry so the two never drift.

The effect ideas come from an outside talking-head effects pack we reviewed
(17 effects, Remotion, 9:16 only). Section 3 sets the rules for using it: we
take the ideas, not the code.

## 2. Goals and non-goals

Goals:

1. A founder with a talking-head recording gets subject-aware effects from
   `launchclip make` without naming any of them. The art director chooses them
   from the script, the framing and the style pack.
2. Every effect is a tested module: a pure function of time, validated params,
   a safe-zone footprint, an event list with sound cues, and parity between
   HyperFrames and Remotion.
3. Effects lean on real material where they can: demo-autopilot flows,
   screenshots in `assets/`, real sourced figures. They are launch tools first
   and creator flourishes second.
4. The skill path and the CLI path produce the same storyboard for the same
   inputs, because both read the same registry, phrase table and references.
5. Everything stays local and needs no API keys, like Whisper today.

Non-goals (for this RFC):

- More than one person in frame, or a moving camera chasing a subject. The
  stage detects these and turns the subject modules off.
- Rotoscoping objects other than people.
- The bespoke `produce` / cinematic lane. It can adopt the subject stage later
  (section 11).
- Mockups of real third-party products (no fake tweets, fake headlines, fake
  view counts or branded app chrome). See section 6.4.

## 3. Provenance and licence rules

The reviewed pack says it is shared with members of a community "for their own
video production". It grants no right to redistribute it or make derivative
works. LaunchClip is MIT. So:

- **No copying.** None of the pack's code, skill text, effect JSON defaults,
  example renders or effect names enter the repo.
  Translating its TSX into our idiom counts as copying.
- **Clean-room specs.** One person writes a behaviour spec per effect from the
  pack's public description and preview videos only: what is on screen, what
  sits behind and in front, when things happen. That spec, in our words and our
  terms (module params, events, safe zone), is what the implementer works from.
  Implementers do not open the pack's source.
- **Our names.** Every module gets a LaunchClip name (section 6).
- **No GPL model.** The pack's matting model (Robust Video Matting) is GPL-3.0.
  We pick a permissively licensed model instead (section 4.2) and record it in
  `THIRD_PARTY_NOTICES.md`.
- Each module PR states in its description that it was built from the
  clean-room spec, and links the spec.

## 4. The subject stage

### 4.1 Outputs

A cache directory per source recording, keyed by the source file's sha256 and
the model id. The probe and the matte use different models (4.2), so they sit
in different entries:

```
.launchclip/subject/<sha256-12>-mediapipe-selfie/
  probe.json        cheap framing summary (sampled frames)
.launchclip/subject/<sha256-12>-modnet-fused/
  ranges/<in>-<out>/
    matte.webm      the source range with alpha (person opaque, room clear), VP9,
                    short edge capped at 1920 px
    subject.json    per-frame boxes and a range summary
    contours.json   per-frame outline for doodle-outline: rays from the
                    silhouette's centre, null where they reach the frame edge
```

`probe.json` (`launchclip.subject-probe.v1`), from about one frame per second:

```json
{ "schema": "launchclip.subject-probe.v1", "source": {"sha256": "…", "width": 1080, "height": 1920, "fps": 30, "duration": 64.2},
  "model": "<id>", "people": "one" | "none" | "several",
  "framing": "close-up" | "medium" | "wide", "usable": true, "reasons": [],
  "head": {"x": 0.5, "y": 0.31, "w": 0.22, "h": 0.15},
  "body": {"x": 0.5, "y": 0.62, "w": 0.58, "h": 0.76},
  "headroom": 0.18, "coverage": 0.34, "stability": 0.93 }
```

`subject.json` (`launchclip.subject.v1`) has the same summary for the range
plus `range`, `matte`, `matte_size` and `frames: [{t, head, body, coverage}]`,
one entry per frame, in source seconds and **source-frame** fractions (the
compilers map them through `base.fit` and `base.focus` onto the canvas). Times
are **source** time, so a `base.trim` maps onto it exactly as it maps onto the
recording.

`framing` counts head heights of frame below the chin, so it reads the same in
9:16 and 16:9: under 1.5 is a close-up, over 4 is wide, medium between.

`usable` is false (with `reasons`) when there is no person, several people,
too little coverage, or an unstable matte (high frame-to-frame change in
coverage). The planner then gets no subject modules for that recording.

### 4.2 Model and runtime

Settled by the phase 1 bake-off (2026-10-24, `scripts/subject-bakeoff.mjs`).

**Runtime.** Node, not Python: every candidate runs through
`onnxruntime-node`, which HyperFrames already installs for its own
`remove-background`. LaunchClip declares it as an optional dependency (like
`kokoro-js`), `launchclip doctor` reports it, and nothing else is needed.
Models download on first use into `~/.launchclip/models`, pinned by sha256.

**Candidates**, all Apache-2.0: MODNet (portrait matting), MediaPipe selfie
segmentation, and U²-Net human segmentation (the model behind HyperFrames'
`remove-background`).

**Footage.** Seven 6 s clips of real talking-head recordings: five 9:16 crops
at 1080×1920 (busy room, pale green backdrop, dim wide shot with arms on a
desk, raised hands, a microphone covering the mouth under red light) and two
16:9 at 1920×1080. The clips and comparison sheets stay local; they show a
real person and are never committed.

**Results** (Apple-silicon Mac, CPU, per 1080×1920 frame; flicker is the mean
frame-to-frame alpha change, so compare within a clip):

| Model | ms/frame | Flicker, raised hands | Flicker, mic | What the sheets show |
|---|---|---|---|---|
| MODNet (512 short edge) | 320–330 | 1.58% | 1.02% | Crisp hair and beard edges; excludes desk lamps; punches holes in low-contrast lower torsos |
| MODNet (384) | 195 | 0.70% | 0.80% | Same edges, fewer holes |
| MediaPipe selfie | 13 | 0.27% | 0.76% | Whole body every frame, keeps the mic; loose edges, picks up lamps and shoulder haze |
| U²-Net human | 1,320–1,370 | — | 0.69% | No better than MODNet at four times the cost; ruled out |
| **`modnet-fused`** | **210–220** | **0.20%** | **0.62%** | MODNet's edges, MediaPipe's body, no lamp |

A chroma-key reference was tried on the green-backdrop clip and abandoned: the
backdrop is pale mint and the clothes are close to it, so the key ate the
person. `--key` stays in the script for real green screens.

**Decision.**

- **Matte: `modnet-fused`.** MODNet at a 384 px short edge gives the edges.
  MediaPipe's mask, eroded by 3 of its pixels and limited to MODNet's body box,
  fills MODNet's holes; the result is the per-pixel maximum. About 0.2 s a
  frame at 1080×1920 and 0.66 s at 3414×1920 (a 4K source).
- **Probe: MediaPipe alone.** It only needs presence and framing; 60 s of 4K
  footage probes in about 5 s.
- `--model` selects any single model or pipeline, for comparison.

### 4.3 When it runs

The full matte costs about 0.2 s a frame at 1080×1920 on an Apple-silicon Mac
(4.2), so it does not run on the whole recording up front:

1. **Probe** (seconds) runs in footage-led preparation, before planning, so the
   art director knows the framing and whether subject modules are allowed.
2. **Matte** runs after the storyboard is planned, only for the source ranges
   that subject-layer scenes cover, padded by 0.5 s. Re-plans that keep the
   same ranges hit the cache.
3. `finish` checks that every subject scene's range has a matte and makes any
   that are missing, so a hand-edited storyboard still renders.

## 5. Storyboard contract changes

All additions are optional. A story without them compiles byte for byte as
before, which the golden hashes enforce.

### 5.1 `base.subject`

```json
"base": { "src": "assets/recording.mp4", "edl": "recording/edit-plan.json",
          "subject": "auto" }
```

`"auto"` (default when the lane is footage-led) uses the stage when a scene
needs it. `"off"` disables subject modules. `resolveStory` fills
`resolved.subject = {probe, ranges: [{in, out, matte, info}]}` from the cache.
Validation errors when a scene needs the subject and `base.subject` is `"off"`
or the probe is unusable.

### 5.2 Scene `layer`

```json
{ "id": "s2", "module": "masthead", "track": 1, "layer": "behind",
  "start": "word:focus#1", "end": 6.0, "params": { "word": "FOCUS" } }
```

`layer` is `"front"` (default, today's behaviour) or `"behind"`. A module can
also declare `layer: "split"` in its definition when it draws parts on both
sides of the subject (orbiting cards pass behind and in front). Its model then
carries `parts: {behind, front}`, and the compilers mount the two parts on
either side of the subject layer.

### 5.3 Compositing order

Both compilers mount, bottom to top:

1. **Room**: the base recording, with its camera (`model.camera`, as today).
2. **Behind** scenes, and the behind parts of split modules.
3. **Subject**: the matte video, one element per trim segment, in step with the
   base segments, with the **subject camera** applied (5.4).
4. **Front** scenes, and the front parts of split modules.
5. Captions.

When no scene in the story touches the subject, step 3 is not mounted at all,
so ordinary footage-led stories pay nothing.

### 5.4 Subject camera and room treatment

Today a module can move the base with `model.camera` (`target: "base"`). Subject
modules need two more controls, as models fields alongside it:

```js
model.subjectCamera = { samples: [{t, scale, x, y}] }   // moves the cut-out only
model.room = { hide: true } | { replace: "<asset or plate>" } | { blur, dim }
```

Rules:

- With no `subjectCamera`, the subject layer follows the base camera exactly,
  so a punch-in moves person and room together and the cut is invisible.
- A `subjectCamera` decouples them: dolly zoom scales the room and keeps the
  subject at identity; backdrop swap hides the room and moves the subject down
  and smaller.
- `room` lets a module hide, replace, blur or dim the base under the subject
  for its scene window.
- As with base cameras, overlapping subject cameras resolve in start order, the
  later wins, and the compiler warns.
- Samples are one per frame and pure functions of time, like `PUNCH_SPRING`.

### 5.5 What modules receive

`resolve(params, ctx)` gets `ctx.subject` when the scene needs it:

```js
ctx.subject = { summary: {framing, head, body, headroom}, at(t) /* → {head, body} in canvas px */ }
```

so a module can place a word just above the head, a phone beside it, or a
checklist above the head on a wide shot and over the chest on a close-up.
Placement is derived at resolve time, so the same params adapt to any framing.

Time anchors need no change: `word:<text>#<n>` anchors already exist and
already resolve against the edited timeline's words, which is exactly the
"time it to the spoken word" behaviour these effects need.

### 5.6 Module definition additions

Catalogue definitions (`MODULES[id]`) gain three optional fields:

```js
{ needs: ["subject"],                  // dropped from the planner when the probe is unusable
  layer: "behind" | "front" | "split", // default layer; a scene may override where allowed
  aspects: ["9:16", "16:9"],           // aspects the module supports (default both)
  mood: ["premium", "playful", …] }    // art-direction words that favour it (section 7)
```

## 6. The module library additions

Names are ours. "Extends" means the work lands in an existing module rather
than a new id.

### 6.1 Build first: launch moments

| Module | Layer | What it does | Real material it uses |
|---|---|---|---|
| `masthead` (new) | behind | One huge word or product name fills the top of the frame and rises in letter by letter; the head covers its lower edge like a magazine cover. Optional issue line and side lines. | Product name, the one idea |
| `phone-stage` (new) | front | A phone springs in beside the head with a slight tilt and float, playing a real screen recording or a demo-autopilot flow; the room pans slightly away to keep the face clear. | `assets/demo/<flow>.mp4` and its action log (reuses catalogue D's zoom and callout logic) |
| `app-stage` (new) | split | The product UI fills the top of the frame; the footage slides into the lower panel and the speaker's head and shoulders rise over the UI's edge. | A screenshot or demo flow |
| `backdrop-swap` (new) | room replaced | The room dissolves; the speaker glides down and smaller in front of a product UI, image, video or brand gradient. | A screenshot, flow or style-pack plate |
| `feed-frame` (new) | split | The full frame springs down into a portrait window on a blurred copy of itself; the speaker's head and hands break out over its edges. Platform-neutral chrome only. | The recording itself |
| `pull-back` (new) | front | The frame shrinks into a window on a desk or plate, while a side panel ticks through real steps and a progress bar fills. For "and this video was made by…" or product reveals. | Real step labels from the script |

### 6.2 Extend what we have

| Module | Change |
|---|---|
| `punch-in` (extends) | Optional `blur` (a 4–6 frame radial blur that settles to 0) and a chain of steps (`[{at, scale}]`) so it can step in, further in and back out on emphasised words. |
| `checklist` (extends) | A footage-led mode: subject-aware placement (above the head when there is headroom, else over the chest), rows that type in on their `at` word and tick on `doneAt`, captions moved clear. |
| `growth-line` (new, beside `growth-chart`) | Behind layer: a line chart draws across the top of the frame behind the head and kicks up at the take-off point with a labelled pill. Same `mode: illustration | data` and `source` rules as `growth-chart`. |
| `zoom-through` (new camera module) | Rush toward the subject with zoom blur into a cut, burst out of the next take. Built (phase 5) as a catalogue C camera module rather than a transition type: the cuts it hides are base trim boundaries inside the edited recording, which are not scenes, so a scene `in` transition cannot attach to them. It snaps to the edit's nearest cut and works without one as a fake cut. |
| `dolly-zoom` (new) | The room scales (push or pull) over one eased 1–2.5 s beat while the subject camera holds the person still. Needs a visible room, so it requires `framing` medium or wide. |

### 6.3 Style-gated: available, rarely chosen

These suit `bold-creator`-style videos more than a SaaS launch. They ship
in the library, but only the style packs that prefer them, or an art direction
that asks for them, will see them chosen.

| Module | Layer | What it does |
|---|---|---|
| `glass-word` | behind | A big extruded glass word stands on the back wall at head height, in perspective, refracting the room through SVG displacement filters (no WebGL, per the portable-module rule), with a light sweep. |
| `orbit-cards` | split | Cards circle the speaker's chest on a tilted ring, passing behind and in front. Cards must be real assets (screenshots, testimonials the user supplied, logos). |
| `scrapbook` | room replaced | Paper background with hand-drawn marks; the speaker becomes a paper sticker with a ragged white border; mixed-chip letters spell a number or claim, boiling on threes. |
| `doodle-outline` | front | A chalk outline traces the speaker's silhouette and re-wobbles every few frames, with small doodles drawing on beside the head. Needs `contours.json`. |
| `proof-wall` | behind | Real items pin themselves to the wall behind the speaker: press quotes, posts and screenshots the user supplied, each with its source. A combined, honest version of the pack's "headline wall" and "thumbnail wall". |

### 6.4 Honesty rules for these modules

The existing rules (illustration vs data `mode`, required `source` for data)
apply. In addition:

- No invented social proof. `proof-wall`, `orbit-cards` and `feed-frame` show
  only supplied assets or text the user wrote; there is no "sample tweets"
  default. Without real items the planner does not offer them.
- No real-brand chrome. Phone, feed and app frames are generic; the product
  shown is the user's own.
- `feed-frame` counts (likes, views) are off by default and, when on, must come
  from params the user supplied.

### 6.5 Every module ships with

As RFC §5 requires: a param schema with the `describe` line the planner sees,
a safe-zone footprint verified at rest and through its motion, a caption
policy, events with default SFX cues, three golden stills, and a parity fixture
(SSIM ≥ 0.97, as for `product-demo`). Subject modules add a fixture recording
with a committed matte, so CI never needs the segmentation runtime.

## 7. How the art director chooses

No new selection mechanism. The existing ones gain data:

1. **Registry → prompt.** New modules appear in `planningPrompt()`'s module
   list automatically via `moduleCatalogue()`. The prompt also receives the
   probe summary ("one person, medium framing, 18% headroom") so it can choose
   sensibly.
2. **Phrase table.** New `PHRASE_MODULE_TABLE` rows, lane `footage-led`, with a
   new `needs: ["subject"]` field. `suggestModules()` drops rows whose needs
   are not met. Examples:

   | Module | The speaker… |
   |---|---|
   | `masthead` | names the product or the one idea ("this is X", "meet X") |
   | `phone-stage` / `app-stage` | shows or describes the app in use |
   | `backdrop-swap` | moves from talking about the problem to the product |
   | `growth-line` | gives a growth result ("doubled", "in week three") |
   | `checklist` (footage mode) | says "all you need to do is", "three steps" |
   | `dolly-zoom` | lands a realisation ("and that's when…") |

3. **Art direction → mood.** `suggestMotion()` already maps art-direction words
   to a grammar. A parallel `suggestModuleMoods()` maps the same words to the
   new `mood` tags (premium → `glass-word`, `dolly-zoom`; playful →
   `scrapbook`, `doodle-outline`), and the prompt lists matching modules first.
4. **Style packs.** `modules.prefer` / `avoid` / `params` already exist. The
   starters get explicit choices: `bold-creator` prefers `scrapbook`,
   `orbit-cards`, `doodle-outline`; `minimal-tech` and `editorial-dark` prefer
   `masthead`, `phone-stage`, `backdrop-swap` and avoid the playful set;
   `warm-documentary` avoids most of the library. A style made from reference
   videos can learn preferences the same way.
5. **Density budget.** A validation warning (not an error) when subject effects
   cover more than 35% of the runtime, sit closer than 3 s apart, or two
   different ones run back to back. This joins the existing "dress 10–40% of
   the runtime" guidance.

The planner tier stays `guided` for footage-led, as today.

## 8. Entry points

### 8.1 CLI

| Command | Change |
|---|---|
| `launchclip make` | Footage-led preparation runs the probe; after planning, it mattes the subject ranges; `finish` mounts the layers. No new flags needed. `--no-subject` opts out. |
| `launchclip subject probe <media> [--json]` | New. Prints and caches `probe.json`. |
| `launchclip subject matte <media> --range <in>-<out> [--contours] [--json]` | New. Makes a range's matte; useful for hand-authored storyboards and debugging. |
| `launchclip story plan --base …` | Runs the probe and passes it into the prompt. |
| `launchclip story validate / resolve / compile` | Know `base.subject`, `layer`, `needs`; resolve reads the cache. |
| `launchclip finish` | Makes any missing mattes before rendering. |
| `launchclip layout-check` | New checks (section 9). |
| `launchclip module fit <module> --subject subject.json` | Sizes a subject module against a real framing. |
| `launchclip doctor` | Reports the segmentation runtime and model, like Whisper. |
| `launchclip export` | NLE exports put behind and front layers on separate overlay tracks around a subject track, so an editor keeps the depth. |
| `launchclip fx <video> <module> [--at word] [--params p.json]` | New, phase 7. The quick path for "put a masthead on the first six seconds": builds a one-scene footage-led story, renders it and splices it back. A thin wrapper over the above, not a second engine. |

All new rows go into `src/cli_usage.js`, so `--help` and the skill's CLI
reference regenerate from one table.

### 8.2 Skills

- `launchclip-create-video` and `launchclip-create-video-remotion` get a
  generated reference, `references/subject-effects.md`, built from the module
  registry and the phrase table the same way `storyboard-modules.md` is today.
  `skills:check` fails when it drifts.
- `skills-src/references/recorded-video.md` gains the selection rules from
  section 7 and the honesty rules from 6.4.
- `skills-src/shared/media-analysis.md` tells the agent to run
  `launchclip subject probe` on a recording and read the result before
  planning.
- The kit files (`kit/core/subject.mjs` and the new catalogue file) are copied
  into each skill's `scripts/` by `sync-skills.mjs`, as today.
- Segmentation itself is too heavy to copy into a skill. The skill calls the
  installed `launchclip subject …` commands; when they are missing, the
  reference says subject modules are unavailable and the skill continues with
  the rest of the library.
- `launchclip-cli`'s reference regenerates from `cli_usage.js`.

### 8.3 One source of truth

The registry (`describe`, `params`, `needs`, `layer`, `aspects`, `mood`) and the
phrase table feed the CLI planner prompt, the skill references and `--help`.
A test plans the footage fixture through both paths (headless `story plan` with
a recorded model response, and the skill's documented steps) and asserts the
same module choices.

## 9. Quality checks

- **Face rule (layout-check).** Front-layer content must not cover the head box
  for more than 0.3 s, except modules that declare they frame the face
  (`feed-frame`).
- **Behind-text visibility.** For behind-layer text, at least 60% of each key
  glyph's area stays visible after the subject covers it, measured against
  `subject.json` at the settle and mid-hold times. `masthead` fails when the
  head covers too much of its word, and the repair is to raise or shrink it.
- **Captions.** The caption band avoids the head box and the new modules'
  rects, as today's caption-collision checks do for overlays.
- **Matte quality.** `cinematic-check` adds a subject gate: coverage stability
  across the range and no frames where the matte collapses. A failing range
  drops its subject scenes to their front-layer fallback (each module names
  one) rather than shipping a broken cut-out.
- **Render review.** The critic's rubric gains "depth reads correctly":
  graphics meant to be behind the speaker are behind them.

## 10. Phases and PRs

Small commits, stacked PRs, each green on its own.

| Phase | Lands | Done when |
|---|---|---|
| 0 | This RFC | Reviewed and merged |
| 1 | Model bake-off; `kit/core/subject.mjs` schemas; `launchclip subject probe/matte`; cache; doctor check; notices | The fixtures produce stable mattes; doctor reports the runtime |
| 2 | Contract: `base.subject`, scene `layer`, split parts, `subjectCamera`, `room`; both compilers; layout-check face rule | A one-scene behind-layer fixture passes parity in both renderers; golden hashes unchanged |
| 3 | `masthead`, `punch-in` blur and steps, `dolly-zoom`; phrase rows; `subject-effects.md`; `make` wiring | `launchclip make` on the footage example picks `masthead` unprompted, and the skill path matches |
| 4 | `phone-stage`, `app-stage`, `backdrop-swap`, `feed-frame`, `pull-back` | The demo-autopilot example can end on the founder in front of a recorded flow |
| 5 | Footage-mode `checklist`, `growth-line`, `zoom-through` transition | Boundary evidence and cinematic checks cover `zoom-through` |
| 6 | Style-gated set (`glass-word`, `orbit-cards`, `scrapbook`, `doodle-outline`, `proof-wall`); starter style preferences; mood tags | Each starter style's choices are pinned by a test |
| 7 | `launchclip fx`, NLE layer export, guide pages, roadmap and changelog | The guide's "add an effect to a clip" example runs end to end |

Phases 3 to 6 can split per module, one PR each, once phase 2 is in.

## 11. Open questions

1. ~~**Model choice.**~~ Settled in 4.2: `modnet-fused` in Node. Open: a GPU
   (CoreML) execution provider for long recordings, and a temporal model if
   flicker shows at the matte edge in renders.
2. **Alpha video in both renderers.** VP9 alpha WebM plays in headless Chromium
   and in Remotion's `OffthreadVideo` with `transparent`; parity at the matte
   edge needs measuring. A PNG-sequence fallback is the backup.
3. **16:9.** The reviewed pack is portrait only. Most of these modules make
   sense in landscape, but each declares `aspects` honestly; which ones do we
   commit to for 16:9 in the first release?
4. **The cinematic lane.** Should `produce` / `direct-frames` get the subject
   layer too, so bespoke frames can place graphics behind the presenter?
5. **HeyGen avatars.** Avatar videos have clean backgrounds; should the stage
   skip matting and key them instead?
6. **`launchclip fx` naming.** Is a separate quick command worth its surface,
   or should `make` with a one-line prompt and a single clip be the quick path?
