# Kit contracts (dual renderer)

This file holds the interface contracts shared by the HyperFrames and Remotion
paths described in [DUAL_RENDERER_PLAN.md](DUAL_RENDERER_PLAN.md). Code that
crosses a boundary below must match these signatures exactly.

## Layout

```
kit/
  core/                 plain ESM .mjs, no npm imports, no node: imports
                        unless noted; safe for browsers and Remotion bundles
    story.mjs           storyboard.json (story v1) validate, resolve anchors, derive boundaries
    motion.mjs          frame-pure easing, tracks, stagger, count-up, springs
    editorial-core.mjs  editorial module spec → resolved model (no HTML)
    layout-check.mjs    geometric safe-zone and collision checks
  remotion/             TSX for Remotion 4.0.536 / React 19.3
    entry.tsx           registerRoot(Root)
    Root.tsx            <Composition id="LaunchclipStory" …/> plus module review comps
    modules/<Kind>.tsx  one component per editorial kind
    captions/WordCaptions.tsx
    StoryComposition.tsx
  hyperframes/
    story-compiler.mjs  storyboard.json → index.html project
```

`skills/*/scripts/` hold **copies** of `kit/core/*.mjs`, because each skill must
work on its own. `scripts/sync-skills.mjs` regenerates those copies, and a test
fails when they drift. The canonical copy is always `kit/core/`.

## storyboard.json (story v1) (`kit/core/story.mjs`)

The shape is in STORYBOARD_ENGINE_RFC.md §4. Additional rules:

- `scenes[i].module` is a catalogue module id. For editorial kinds it is the
  kind name (`metric`, `growth-chart`, …), and `params` is the editorial spec
  **without** `id`, `kind`, `aspect`, `start` and `duration`. Those come from
  the scene and the format.
- Scenes may set `track` (default 0) and may overlap only on different tracks.
- `in` on a scene describes the transition **into** it:
  `{type: "cut"|"fade"|"push"|"whip"|"zoom"|"iris"|"morph", dur, from_object?, direction?}`.
  A `morph` or a `from_object` makes the boundary kind `shared-world`; anything
  else is `ordinary`.
- Assets are project-relative paths under `assets/`.
- `audio.narration` = `{text, provider?, voice?, speed?}` is narration that
  `launchclip finish` synthesises into `audio.voice` and `audio.words` (text
  1–4000 characters; provider `kokoro`, `elevenlabs`, `supplied` or `test`;
  speed 0.5–2). While it is set, the voiceover-motion lane does not require
  `audio.voice`/`audio.words` yet, and word anchors are checked after synthesis.
  Finish writes the filled fields to a resolved copy in `.launchclip/finish/`,
  never back into `storyboard.json`.

Exports:

```js
export const STORY_SCHEMA = "launchclip.story.v1";
export function validateStory(story, {modules} = {}) // → {ok, errors: string[], warnings: string[]}
// modules: optional Set or array of known module ids; unknown ids are errors when given.
export function resolveStory(story, {words = [], beats = null} = {})
// → a deep copy with every time anchor ("word:x#n", "beat:n") replaced by seconds,
//   scenes sorted by start, plus `resolved: {duration, fps, frames}`.
//   words: [{text, start, end}] (NARRATION.json words); beats: BEATS.json object.
export function resolveAnchor(anchor, {words, beats}) // → seconds; throws on unknown anchor
export function deriveBoundaries(story) // story must be resolved
// → [{boundary_id, sequence_id, kind, start_seconds, duration_seconds, from_id, to_id}]
//   exactly the shape of parseDeclaredSequenceBoundaries() in src/cinematic_evidence.js.
//   boundary_id = `${to_id}-in`; sequence_id = from_object's scene id or null.
export function storyFormat(story) // → {duration, width, height, fps}
export function storyHits(story)   // resolved → [{scene_id, at, event, cue?}] sorted by at
```

## Motion primitives (`kit/core/motion.mjs`)

Every function is a pure function of its inputs.

```js
export const ease = { linear, "power1.in", "power1.out", "power1.inOut", … "power4.inOut",
  "expo.*", "circ.*", "sine.*", "back.*" (default overshoot 1.70158) };
export function getEase(name)            // GSAP-style name, e.g. "power3.out", "back.out(1.4)", "steps(6)", "none"
export function tween(t, {from, to, start, duration, ease = "power1.out"}) // clamped
export function track(keys)              // keys: [{t, v, ease?}] → (t) => value (numbers or {x,y,…} objects)
export function stagger(index, {each, from = "start", count})  // → delay seconds
export function countUp(t, {from, to, start, frames = 18, fps = 30, format}) // matches editorial textFrames()
export function springValue(t, {start, damping = 14, stiffness = 140, mass = 1, from = 0, to = 1})
export function splitWords(text) / splitChars(text) // → [{text, index}]
export function motionBlurPx(velocityPxPerFrame, {max = 24}) // → blur radius, 0 at rest
```

The GSAP eases (`power3.out`, …) must match `gsap.parseEase()` to within 1e-6.
GSAP is a devDependency for that test.

## Editorial core (`kit/core/editorial-core.mjs`)

```js
export const EDITORIAL_KINDS = [ ...14 kinds ];
export function resolveEditorialModule(spec)
// Same validation as buildEditorialModule today (same error messages). Returns:
// { id, kind, aspect, canvas:{width,height}, start, duration, end,
//   rect:{x,y,width,height}, title, accent, theme:{surface,foreground,muted,border,accentText} (always filled),
//   presentation:"solid"|"glass", track,
//   motion:{enter, exit, distance, scale, enterStart, enterEnd, exitStart, end, enterEase:"power3.out", exitEase:"power2.in"},
//   content: <kind-specific normalized data, e.g. metric:{label, from, to, prefix, suffix, decimals, countStart}>,
//   events:[{id, time, endTime?, role?}],      // identical to buildEditorialModule().events
//   layout:{canvas, rect, motion:{enterEnd, exitStart, end}},  // identical to buildEditorialModule().layout
//   density:{scale, hero, source:"explicit"|"derived"|"legacy", layout:{width,height}, natural} }
```

Density: without `rect` the core derives the footprint from the content (9:16:
safe-zone width, natural height, centred near the RFC centre-of-mass target
above the caption band; 16:9: the old lower-left footprint with a content
height on the y 980 baseline). In 9:16 the kind lays out in
`density.layout` (rect / scale) and renders scaled by `density.scale` (1–2)
from the rect's top-left corner, inside one `.ui-density` wrapper in both
renderers; rect-local geometry is in layout px. 16:9 always resolves at scale
1, and explicit 16:9 output is byte-identical to the pre-density emitter.
Details: skills-src/references/editorial-ui-modules.md, "Defaults and density".

`buildEditorialModule()` in `skills/launchclip-create-video/scripts/editorial-ui-modules.mjs`
becomes the HyperFrames emitter on top of this, and its output stays
byte-identical.

React modules take `{model}` (the resolved model) and use `useCurrentFrame()`
and `useVideoConfig().fps`, with `t = start + frame / fps` when they sit inside
a `<Sequence from={start*fps}>`. Each module renders at absolute canvas
coordinates (`rect`) inside a full-canvas `AbsoluteFill`. Fonts and visual
style match the HyperFrames CSS for the same kind.

## Renderer adapter (`src/renderers/`)

```js
// src/renderers/index.js
export function getRenderer(name) // "hyperframes" | "remotion" → adapter
// adapter:
{ name,
  async render(projectDir, outFile, {quality = "draft"|"high", fps, run} = {}),
  async still(projectDir, seconds, outFile, {run} = {}),
  async check(projectDir, {strict, run} = {}),   // → {status:"passed"|"failed", findings:[], raw}
  previewCommand(projectDir, {port}) }           // → argv array
```

Remotion projects are directories holding `storyboard.json` and `assets/`. The
adapter writes `<project>/.launchclip/story.resolved.json` (story resolved with
`NARRATION.json` and `BEATS.json` when present) and runs
`npx remotion render <entry> LaunchclipStory <out> --props <resolved> --public-dir <project>`.
`<entry>` is `<project>/remotion/entry.tsx` if it exists, otherwise
`kit/remotion/entry.tsx`. Assets resolve through `staticFile(path)`.

Temporal evidence names the browser-side source `browser-still`.
`"hyperframes"` is still accepted as a legacy alias when reading.

The project file is named **`storyboard.json`**. `story.json` would collide
with the `STORY.json` creative receipt on case-insensitive filesystems. The
schema id stays `launchclip.story.v1`.

## Wave 2: module registry, compilers, parity

### Story fields used by the compilers

- `audio.mix`: an optional project path (`assets/audio/mix.wav`) to the premixed
  root track. Both compilers mount exactly one root audio element from it. If
  it is absent, the voice is mounted alone.
- `overlays[]` captions: `{type: "captions", style, src?: "assets/captions/captions.json", hide?: [[start, end]]}`.
  When `src` is absent, the compilers chunk `audio.words` with `chunkWords()`
  from `word-captions.mjs`.
- Scenes whose module sets `hidesCaptions` hide the captions while active.
- Brand-to-module defaults: editorial `accent` defaults to `brand.colors.primary`.
  Editorial `theme` defaults to `{surface: brand.colors.bg, foreground: brand.colors.paper, muted: <paper at 62% over bg, hex>, border: <paper at 18% over bg, hex>, accentText}`, where `accentText` is
  `brand.colors.primary` when it reaches 3:1 on `bg`, otherwise `paper`
  (amended in wave 2: `ink` is the dark text colour for use *on* the primary,
  so on a dark `bg` it was invisible).
  Values set explicitly in `params` win.

### Unified module registry (`kit/core/modules.mjs`, owned by the compiler agent)

```js
export function resolveModule(scene, story) // → model (see below); throws with path-prefixed message
export function knownModules()              // → string[] (editorial kinds + catalogue ids)
```

Catalogue module files `kit/core/catalog-a.mjs` and `kit/core/catalog-b.mjs`
each export:

```js
export const MODULES = {
  "<id>": { describe: "one line for the planning prompt",
            params: { /* JSON-schema-ish summary for docs */ },
            resolve(params, ctx) /* → model; throws on invalid params */ } };
// ctx = {id, start, duration, format:{width,height,fps,duration}, brand, aspect:"9:16"|"16:9"}
```

Every model (editorial or catalogue) includes at least:
`{id, module, canvas, start, duration, end, rect, motion:{enterStart, enterEnd, exitStart, end, enterFrom, exitTo, enterEase, exitEase}, content, events:[{id,time,endTime?,role?}], layout:{canvas, rect, motion:{enterEnd, exitStart, end}}, hidesCaptions:boolean, theme}`.
Catalogue models derive colours from `brand` and follow the RFC §5 hard rules:
the Shorts safe zone, key text at least 44 px at 1080 wide, contrast at least
3:1, and blur 0 at settle.

### Emitters and components

| Renderer | Editorial kinds | Catalogue A | Catalogue B |
|---|---|---|---|
| HyperFrames | `kit/hyperframes/editorial-ui-modules.mjs` (canonical home of the emitter; skills get copies) | `kit/hyperframes/catalog-a.mjs` | `kit/hyperframes/catalog-b.mjs` |
| Remotion | `kit/remotion/modules/registry-a.ts` and `registry-b.ts` | `kit/remotion/catalog/registry-a.ts` | `kit/remotion/catalog/registry-b.ts` |

- HyperFrames emitter files export `EMITTERS = {"<id>": (model) => ({html, css, motion, events, layout})}`.
  `motion` is GSAP code against a host timeline `tl`, exactly as the editorial
  emitter does.
- Remotion registry files export `COMPONENTS: Record<string, React.FC<{model: any}>>`.
- Components draw at absolute canvas coordinates inside a full-canvas
  `AbsoluteFill`, and compute `t = model.start + frame / fps`. The parent places
  them in `<Sequence from={round(start*fps)} durationInFrames=…>`, so
  `useCurrentFrame()` is local to the sequence.
- All motion goes through `kit/core/motion.mjs` using the model's ease names, so
  it stays in step with GSAP.

### Compiler wiring (as implemented in wave 2)

- `resolveModule(scene, story, {track, end} = {})`: the optional third
  argument is compiler-only. `track` sets `model.track` (the HyperFrames track
  index; an emitter may use `track` and `track + 1`), and `end` extends the
  model to the scene's render window (see below). Error messages start with
  `scenes[i] (id): `. Models also carry `sceneId`. `placeholderModel(scene,
  story, reason)` and `PLACEHOLDER_STYLE` define the labelled box both
  renderers draw for unknown, invalid or unimplemented modules (it uses
  `params.rect` when the scene declares one).
- `kit/core/transitions.mjs` is shared by both compilers:
  `sceneWindows(resolvedStory) → {scenes, loop}` and
  `transitionTweens(in, {width, height})`. Track-0 scenes are opaque plates in
  `brand.colors.bg`. Because same-track scenes cannot overlap, the outgoing
  adjacent (gap ≤ 0.1 s) track-0 scene is held until the incoming transition
  settles: its render window ends at `next.start + next.in.dur` and its model
  is resolved with that `end`, so its exit motion moves to the end of the
  transition. HyperFrames turns the tweens into GSAP `fromTo` calls; Remotion
  evaluates them per frame with `layerStateAt` (a test seeks GSAP against it).
- `kit/core/captions.mjs` (chunking, GSAP runtime, CSS, `CAPTION_MOTION`,
  `CAPTION_BAND`) and `kit/core/fonts.mjs` (`brandFontStacks`) are shared too.
- `compileStoryToHyperFrames(resolvedStory, {projectDir, sourceDir?, sceneFilter?, write?, copyAssets?})`
  is async and returns `{html, files, warnings, boundaries, compositionId}`.
  `projectDir` is the output; `sourceDir` (default `projectDir`) holds
  `assets/`, captions and words, and its `assets/` is copied into the output.
  With `sceneFilter` (id, id array or predicate) only those scenes are compiled,
  on the background, with absolute times kept and **no** transitions,
  captions, audio or loop, matching `ModuleReview`. The root composition id is
  `launchclip-story`.
- Skills ship `kit/hyperframes/*.mjs` in `scripts/` beside the `kit/core`
  copies; a HyperFrames file named like a core file ships as
  `hyperframes-<name>` (`hyperframes-catalog-a.mjs`), with imports rewritten.
- `StoryComposition` props may carry `__captions` (filled by
  `calculateMetadata` from the overlay `src` or chunked `audio.words`).
  Custom modules register through `<LaunchclipCompositions customModules={…}/>`
  from `kit/remotion/Root.tsx`, and receive `{scene, params, brand, format, model}`.

### Review compositions (registered in `kit/remotion/Root.tsx`)

- `LaunchclipStory`: props are the resolved story. Dimensions come from
  `calculateMetadata` (`format.width`, `format.height`, `resolved.fps`,
  `resolved.frames`).
- `ModuleReview`: props `{scene, story}`, the same input as `resolveModule`. It
  renders that one module on `brand.colors.bg` for its duration. The canvas is
  `story.format`. Editorial specs are wrapped as a scene by the parity harness.

### Parity harness (`scripts/parity.mjs`)

```
node scripts/parity.mjs <fixture.json> [--out qa/parity/<id>] [--times enter,mid,settle,exit,events]
```

- A fixture is `{story, sceneId, threshold?: {ssim: 0.97}}`.
- The harness renders that scene in HyperFrames (a temporary project compiled
  by `kit/hyperframes/story-compiler.mjs`, filtered to the one scene, then
  `hyperframes snapshot`) and in Remotion (`ModuleReview` through `remotion still`).
- It compares the two at the sampled times with ffmpeg `ssim`, and writes
  `report.json` plus side-by-side PNGs.
- `test/parity.test.js` runs every fixture in `test/fixtures/parity/*.json`
  when `LAUNCHCLIP_PARITY=1` is set, and skips otherwise because it is slow.

## Footage-led lane (RFC phase 6)

The `footage-led` lane plays a recording full-frame under the story. It uses
the same storyboard contract, compilers and parity rules as the motion lanes.

### `base` (`kit/core/story.mjs`)

```json
"base": { "src": "assets/recording.mp4", "start": 0, "trim": [[0, 8], [10, 22]],
          "volume": 1, "fit": "cover", "focus": { "x": 0.5, "y": 0.36 },
          "edl": "recording/edit-plan.json" }
```

- `src` (required): an `assets/` video (`.mp4`, `.m4v`, `.mov` or `.webm`). The
  legacy forms `"base": "assets/x.mp4"` and `{source}` are still accepted.
- `trim`: `[in, out]` source ranges in source order, without overlap. They play
  back to back from timeline 0, so **timeline time is trimmed base time**.
  Without `trim`, the base plays from source second `start` (default 0).
- `edl`: a project path to an edit-recording plan (`edit-plan.json`,
  `launchclip.recording-edit.v1`). `resolveStory(story, {edl})` copies its
  `kept_segments` into `base.trim`; `readProjectStory`, `launchclip story` and
  `layout-check` load the file. Point `src` at the **original** recording when
  you use `edl` or `trim`; `base-edit.mp4` is already cut, so use it without
  either. An unresolved story must not set both `trim` and `edl`.
- `volume` (0–1, default 1) is the recording's level. `fit` is `cover`
  (default) or `contain`. `focus` (fractions) is the `object-position`; under
  `cover` that source point lands on the same canvas point, so it is also the
  default punch-in focus.
- Narration words (`audio.words`) are on the edited timeline, as edit-recording
  writes them.
- `audio.mix` is the music/SFX bed under the recording, at `audio.mix_volume`
  (0–1, default 1). Duck the bed against the recording when building the mix.
  `audio.voice` is never mounted in this lane, because the recording carries
  the voice.

Exports: `storyBase(resolvedStory)` returns
`{src, fit, focus, volume, segments: [{index, start, end, duration, sourceStart}], length}` or
`null`. Segment boundaries snap to the frame grid, so both renderers cut on the
same frame. `edlTrim(plan)` returns `[[in, out], …]`.

### Scenes

- Track 0 is the base. A scene with `insert: true` is a full-frame plate on
  track 0. It covers the picture while the recording's audio keeps playing,
  and its `in` transition reveals it over the base. Its boundary's `from_id` is
  `null`, unless an earlier insert sits on track 0.
- Every other scene is an overlay on track 1 or higher. Validation rejects
  overlays on track 0 and inserts on other tracks. `insert` outside this lane
  is an error.
- Keep scene starts on the frame grid (`start * fps` a whole number). Remotion
  starts a Sequence on a whole frame, while module time is
  `model.start + frame / fps`. An off-grid start therefore shifts Remotion up
  to half a frame from GSAP.

### Catalogue C (`kit/core/catalog-c.mjs`)

Emitters live in `kit/hyperframes/catalog-c.mjs`, components in
`kit/remotion/catalog/CatalogC.tsx` and `registry-c.ts`. They follow catalogue
B's conventions: a JSON-only model, a shared view tree (`catalogCView`), a
renderer-neutral op list (`catalogCTimeline`), `at` params in seconds from the
scene start, and story hits timing events of the same name. Each model has a
full-canvas root. `layout.rect` is the occupied box.

| Module | Params | Events (cue) | Notes |
|---|---|---|---|
| `punch-in` | `scale` 1.06–1.25 (1.12), `at`, `focus {x,y}` (base.focus, else 0.5/0.42), `release` 0.3–2 s | `punch` (whoosh), `release` | Camera only; layout role `decor`; ≥ 0.8 s |
| `footage-callout` | `text` ≤ 42, `label` ≤ 24, `point {x,y}` 0.04–0.96, `side` auto/above/below/left/right, `tone` primary/paper/dark, `tilt` −6–6°, `at` | `point` (tick), `sticker` (pop) | The sticker sits inside the safe zone, above the caption band, and never covers the point. The leader line runs from the point to the rotated sticker edge. ≥ 1.5 s |
| `lower-third` | `name` ≤ 32, `title` ≤ 48, `align` left/center, `tone` dark/primary, `at` | `name` (whoosh), `title` | Bottom edge on the caption-band gap; ≥ 2 s |
| `emphasis-caption` | `text` 1–3 words ≤ 24, `color` (≥ 3:1 on the bg outline), `position` center/upper/lower, `stagger`, `at` | `pop` (impact), `word-<i>` | `hidesCaptions`; 88% of the safe width; ≥ 0.8 s |

`callout` stays the editorial text card, so the anchored sticker is
`footage-callout`.

### Camera model

A module that moves the base sets `model.camera`:

```js
{ target: "base", focus: {x, y} /* canvas px */, scale, punchAt, releaseAt,
  samples: [{t, scale, x, y}] /* one per frame over the scene, identity at the end */ }
```

Each sample scales the full-frame base about `focus`, with the transform
origin at the canvas centre: `x = (1 − s)(fx − W/2)` and `y = (1 − s)(fy − H/2)`.
With `s ≥ 1`, the scaled frame always covers the canvas. The spring
(`PUNCH_SPRING`) is integrated per frame by `springValue`, so every sample is a
pure function of time.

`cameraOps(models)` merges every camera into one op list on `BASE_CAMERA`:
identity at 0, then one `set` per sample at `t − SAMPLE_LEAD`, applied in start
order. When cameras overlap, the later one wins, and `cameraOverlaps()` makes
the compiler warn.

### Compilers

- **HyperFrames.** One muted root `<video class="clip lc-base-media">` per
  segment (`data-start`, `data-duration`, `data-media-start` = source in-point,
  track 2, z-index 1, `object-fit`/`object-position`), plus one root `<audio>`
  per segment at `base.volume` on track 3. Scenes start at track 4.
  `cameraGsap(models)` emits the camera as `tl.set(".lc-base-media", …)`.
  With `sceneFilter`, the base videos stay (muted) and only the filtered
  scenes' cameras apply.
- **Remotion.** `BaseLayer` renders one `<OffthreadVideo>` per segment in its
  own Sequence (`trimBefore` = source in-point, `volume` = `base.volume`)
  inside a wrapper styled by `cameraStyle(cameraOps, t)`. `LaunchclipStory`
  mounts it under the scenes, and the root `<Audio>` plays `audio.mix` only.
  `ModuleReview` draws footage-led modules over the muted base, shifted so that
  frame 0 is the scene start, and moved by that module's camera.
- `layout-check` resolves `base.edl` and checks catalogue modules from their
  model layout. It adds the base as full-frame `media` that may be occluded.

### Footage parity (`scripts/parity-footage.mjs`)

A fixture is `{project, sceneId?, mode?: "module"|"story", times?, threshold?}`,
stored in `test/fixtures/parity-footage/`. The harness resolves the project
exactly as the CLI does and renders it with the real compilers. It uses
`kit/remotion/entry.tsx`, with the project as Remotion's public directory.
`test/footage_lane.test.js` runs the fixtures when `LAUNCHCLIP_PARITY=1` is set.
The example is `examples/story/footage/`; regenerate its recording with
`node scripts/make-footage-example.mjs`.
