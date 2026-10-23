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
    style.mjs           style pack v2: validate, applyStyle, palette roles, v1 upgrade
    captions.mjs        word chunking, caption presets (plan, frame-pure evaluator, GSAP runtime)
    motion.mjs          frame-pure easing, tracks, stagger, count-up, springs
    grammar.mjs         motion grammars (editorial, snappy, smooth, playful, documentary, cinematic)
    transitions.mjs     typed transitions and scene render windows
    camera-world.mjs    world layout, camera path, parallax and motion blur
    ambient.mjs         frame-pure ambient motion: background field, hold drift
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
  `{type: "cut"|"fade"|"push"|"whip"|"zoom"|"iris"|"morph"|"pan"|"pull"|"orbit"|"whip-pan", dur, from_object?, direction?}`.
  A `morph` or a `from_object` makes the boundary kind `shared-world`; anything
  else is `ordinary`. `pan`, `pull`, `orbit`, `whip-pan` (and `push` in
  `camera.mode` "world") move the world camera; see "World camera".
- `motion.grammar` (a grammar name or `{base, ...overrides}`) and `camera`
  (`{mode, layout?, spacing?, parallax?, blur?}`): see "Motion grammar" and
  "World camera".
- Assets are project-relative paths under `assets/`.
- `audio.narration` = `{text, provider?, voice?, speed?}` is narration that
  `launchclip finish` synthesises into `audio.voice` and `audio.words` (text
  1–4000 characters; provider `kokoro`, `elevenlabs`, `supplied` or `test`;
  speed 0.5–2). While it is set, the voiceover-motion lane does not require
  `audio.voice`/`audio.words` yet, and word anchors are checked after synthesis.
  Finish writes the filled fields to a resolved copy in `.launchclip/finish/`,
  never back into `storyboard.json`.
- `ambient` (story) and `scenes[i].ambient` are a level (`off | subtle |
  standard | lively`) or `{level?, background?, drift?}`; see
  [Ambient motion](#ambient-motion-kitcoreambientmjs).

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

## Motion grammar (`kit/core/grammar.mjs`)

One named feel for every entrance, exit, pop, stagger, transition and camera
move in a story.

```json
"motion": { "grammar": "snappy" }
"motion": { "grammar": { "base": "smooth", "ease": { "enter": "power3.out" }, "duration": { "camera": 1.4 }, "stagger": 1.5 } }
```

| Grammar | enter / exit | move / camera | emphasis | durations (enter, exit, transition, camera) | overshoot | stagger | camera style | ambient hint |
|---|---|---|---|---|---|---|---|---|
| `editorial` (default) | power3.out / power2.in | power3.inOut / power3.inOut | back.out(1.7) | 0.28, 0.22, 0.45, 0.8 | 0.10 | 1× | steady, whip expo.inOut | standard |
| `snappy` | expo.out / power3.in | expo.inOut / back.inOut(1.2) | back.out(1.2) | 0.20, 0.16, 0.32, 0.55 | 0.05 | 0.75× | snap (anticipates) | standard |
| `smooth` | power2.out / sine.in | sine.inOut / sine.inOut | power2.out | 0.50, 0.36, 0.70, 1.1 | 0 | 1.25× | glide | subtle |
| `playful` | back.out(1.7) / back.in(1.4) | back.inOut(1.4) / back.inOut(1.6) | elastic.out(1, 0.5) | 0.42, 0.26, 0.50, 0.75 | 0.20 | 1.6× | bounce (anticipates), whip back.inOut(1.2) | lively |
| `documentary` | power1.out / power1.in | power1.inOut / power1.inOut | power1.out | 0.60, 0.45, 0.80, 1.3 | 0 | 1.3× | drift, whip power2.inOut | subtle |
| `cinematic` | power2.inOut / power2.in | power2.inOut / power2.inOut | power2.inOut | 0.70, 0.45, 0.90, 1.3 | 0 | 1.4× | glide (drift 14 px, 12 s, breathe 0.8%), whip power3.inOut, move blur 0.25 | lively |

Each preset also has `defaultTransition` (`{cuts, world}`, planner guidance)
and `camera` (`{style, drift, driftPeriod, breathe, whip, anticipation}`:
drift amplitude in px at a 1080 px short side, drift period in seconds,
breathing-scale amplitude, the whip-pan ease). `overshoot` is the measured
peak overshoot of the enter and emphasis eases; `stagger` multiplies every
module's default stagger.

Two preset settings are not overridable, and `{base: "cinematic", …}`
inherits them:

- `panelEnter`: the longest an editorial panel's shell may take to arrive.
  It's 0.36 s for every grammar but cinematic (0.8 s), so cinematic panels
  take the grammar's full 0.7 s.
- `hold`: what a settled scene does while it rests. It's `null` for every
  grammar but cinematic, which has `{level: "lively", mediaPush: 0.04}`:
  - `level` is the ambient level a scene gets when neither the scene nor the
    story sets one, instead of the energy default.
  - `mediaPush` is a linear push-in about the canvas centre (4% over the
    scene) that `product-demo` lays over its zooms. The recorded clip then
    moves on every frame. A scene with ambient `{"drift": false}` keeps the
    clip as recorded.

Cinematic exists because the other grammars arrive on `.out` curves, which
start at full speed. Measured on a 16:9 voiceover story with `smooth` and the
world camera:
- camera pans were already slow → fast → slow (`sine.inOut`);
- editorial panels arrived in at most 0.36 s on `power2.out`;
- the rest drift moved under 0.1 px a frame;
- the recorded `product-demo` clip held fully still on 17% of its rest
  frames.

```js
export const GRAMMARS, GRAMMAR_NAMES, DEFAULT_GRAMMAR;   // "editorial"
export function resolveGrammar(story)                   // → {id, base, custom, ease, duration, overshoot, stagger, defaultTransition, camera, ambient, panelEnter, hold}
export function grammarErrors(value, path)              // validation messages (story.mjs mirrors them, import-free)
export function isEditorialGrammar(grammar)
export function easeRole(name)                          // "enter" (.out) | "exit" (.in) | "move" (.inOut) | "emphasis" (back/elastic/bounce .out) | null (linear, steps)
export function grammarEase(grammar, name, {props, roles = ["enter", "exit", "emphasis"]})
export function calmEase(name)                          // the family without overshoot (back.out → power2.out)
export function grammarDuration(grammar, role, seconds, {min, max})
export function grammarStagger(grammar, seconds, {min, max})
export function grammarTweens(list, grammar, options)   // remap ops / animations in place
```

Rules:

- **Editorial is the identity.** Every mapping returns its input when the
  grammar's value for that role equals editorial's, so stories without
  `motion` (and stories with `"editorial"`) compile byte for byte as before
  (`test/grammar.test.js` pins the pre-grammar HyperFrames hashes of every
  golden and the editorial corpus `EXPLICIT_16X9_SHA256`).
- `resolveModule` passes the grammar as `ctx.grammar` to catalogue modules
  and as `resolveEditorialModule(spec, {grammar})` to editorial kinds (only
  when it is not editorial); non-editorial models carry `model.grammar`.
- Where it applies: the module shell enter/exit eases and durations
  (editorial kinds, catalogue B's `createBase`, catalogue C's `finish`,
  catalogue A's `standardExit`); element entrances and pops in catalogue A
  (every `.out`/`.in`/back/elastic animation); pops (back/elastic) in
  catalogue B/C timelines; default staggers (equation-lockup, logo-row,
  archive-card words, emphasis-caption); every typed transition ease
  (`transitionTweens(…, {grammar})`); camera moves (`grammar.ease.camera`,
  `grammar.camera.whip`).
- `.inOut` content mechanics (chart draws, gauge fills, focus moves) keep
  their designed ease, because some modules derive event times from them.
- Overshooting eases drive transforms only; opacity, blur, colour, clip
  radii and stroke offsets get `calmEase`, so opacity never passes 1 and blur
  never goes negative.
- Durations scale by the grammar's ratio to editorial and are clamped
  (editorial shell 0.2–0.36 s in, 0.16–0.28 s out; catalogue B 0.3–0.7 /
  0.2–0.5 s). Event windows and content defaults keep the editorial bounds,
  so a grammar never turns a valid spec invalid.

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
above the caption band; 16:9: a centred card, 1000 px wide or wider for dense
content, inside title-safe at y 96–840, above the caption band). Derived
rects, explicit 9:16 rects and explicit 16:9 rects with `density: "fill"` lay
out in `density.layout` (rect / scale) and render scaled by `density.scale`
(1–2; at most 1.75 in 16:9) from the rect's top-left corner, inside one
`.ui-density` wrapper in both renderers; rect-local geometry is in layout px.
An explicit 16:9 rect without the opt-in (and any rect with `density:
"fixed"`) resolves at scale 1, byte-identical to the pre-density emitter.
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

## Style pack v2 (`kit/core/style.mjs`, `src/style_store.js`, `src/story_style.js`)

A style pack is `.launchclip/styles/<name>/style.json`:

```
{schema: "launchclip.style.v2", name, description?,
 brand?: {colors: {bg, paper, ink, primary, accent, ...}, fonts: {display, body, meta}},
 motion?: {grammar: name | {base, ...overrides}, ...},   // pass-through data
 camera?: {mode, ...}, ambient?: {level: off|subtle|standard|lively, ...},
 captions?: {preset, ...caption options},
 sound?: {sfx_library?: path, sfx_density?: low|normal|high,
          music?: {provider?, prompt_hints?, bpm_range?: [min, max], energy_curve?}},
 modules?: {prefer?: [id], avoid?: [id], params?: {<module>: {param: default}}},
 layout?: {safe_profile?: shorts|landscape, title_case?: boolean},
 intro?: {module, params, duration}, outro?: {module, params, duration},
 loop?: boolean, references?: [{name, sha256, kind, width, height, duration_seconds}],
 reference_stats?: {palette, pacing, energy, sound}}
```

- `validateStylePack(pack, {modules})` → `{ok, errors, warnings}`.
- `applyStyle(story, pack, {intro?, outro?})` → `{story, applied, warnings}`.
  Explicit story values always win. Brand colours and fonts fill per role;
  `motion`, `camera`, `ambient` and `layout` fill per key and are carried
  through as data (renderers that do not read them ignore them); the captions
  overlay gets the pack's preset only when it names neither `preset` nor
  `style`, and its other options per key (a story with no `overlays` at all
  gets one captions overlay); `sound` lands on `audio.sfx_density`,
  `audio.sfx_library` and `audio.music_hints` (finish filters cues by density
  and bounds the bed tempo by `bpm_range`); `modules.params` fill each scene of
  that module; `loop` adds `ending.loop_to` (`loop: false` adds `ending.loop:
false`) when the story has no ending, and the story's `style.loop` overrides
the pack's (story.mjs `ending.final` then decides how a non-looping story's last
scene ends: `hold` by default, `fade` or `exit`; modules.mjs `storyFinal`); intro
  and outro scenes are added only when requested (`"style": {name, intro,
  outro}`), and an intro is skipped on stories with a timed voice, mix, base or
  anchors. The merged story carries `meta.style = {name, applied}`, which makes
  the merge idempotent.
- A storyboard names its pack with top-level `"style"` (a name, a path to a
  `style.json` or pack directory, or `{name, intro?, outro?}`). Names resolve in
  `<project>/.launchclip/styles`, then `~/.launchclip/styles`
  (`$LAUNCHCLIP_HOME/styles`), then `kit/styles/<name>.json` (built-in
  starters). `applyProjectStyle(story, {projectDir})` runs before validation in
  `readProjectStory` (renderer adapters, cinematic checks, eval), `story
  validate|resolve|compile`, `layout-check` and `finish`.
- v1 packs (`launchclip.style-pack.v1`: `frame.md`, caption skin, audio notes)
  load as v2 in memory with a warning; `launchclip style upgrade <name>` writes
  the v2 `style.json` and keeps the v1 manifest as `style.v1.json`.
- `stylePromptLines(pack)` is the planner section (`planningPrompt({style})`).
- Starters: `editorial-dark`, `bold-creator`, `minimal-tech`,
  `warm-documentary`, `neon-explainer`; each validates, passes the contrast
  check (`checkPackContrast`: paper/bg 4.5:1, primary and accent/bg 3:1,
  ink/primary 3:1) and merges into every golden story without param errors.

### Mimic a reference (`src/style_reference.js`)

`analyzeReference(file)` samples 24 frames (160 px wide) and measures: palette
(`paletteClusters`: k-means k = 8 with deterministic k-means++ seeding, a
second pass without the dominant colour and a third over saturated pixels);
pacing (hard cuts from `analyzeRenderMotion` plus `structuralBoundaries`: share
of content pixels that changed between t ± 0.5 s at 10 fps, and settle-after
jumps); activity (1 − hold ratio); captions (`detectCaptions`: text-like
edge rows per band, approximate); sound (`analyzeProductionAudio`: loudness,
silence ratio, transients). `draftStyleFromReferences` maps them to a v2 pack
(`assignPaletteRoles`, `grammarFromPacing`, `ambientFromEnergy`,
`soundFromAudio`, `captionsFromDetection`, `fontsFromReference`) plus a
`reference-report.md`. `compareToStyle(measured, pack)` reports drift for
`launchclip style check`.

## Caption presets (`kit/core/captions.mjs`)

The captions overlay is `{type: "captions", preset | style, src?, hide?,
position?, max_words?, max_chars?, case?, emphasis?, keywords?, font?, size?,
colors?, stroke?, shadow?, entrance?, exit?, offset?, hide_during_moves?}`; legacy `style:
"word-highlight" | "line" | "none"` still works (`line` → `minimal-line`,
`style` may also name a preset, `preset` wins). `CAPTION_PRESETS` holds 14
presets; `STORY_CAPTION_PRESETS` in `story.mjs` mirrors the names.

`captionPlan(chunks, overlay, {brand, format, story, hide, fonts?})` →
`{preset, options, css, nodes, tweens}`. `nodes` is a DOM tree (div/span with
id, class, text, children), `css` its static styles, and `tweens` a list of
GSAP calls `{id, at, dur, ease, from?, to, ir?}` over opacity, x, y, scale,
scaleX, color, backgroundColor and width (%). Rules: per element and property
only the first tween may render immediately, and a `to()` always follows an
earlier tween of that property. HyperFrames mounts the plan with
`captionPlanRuntime(plan)` (builds the nodes, adds the tweens with
`force3D: false`); Remotion's `WordCaptions` builds the same plan and evaluates
each element with `captionElementStateAt` (GSAP forward-seek semantics) and
`captionInlineStyle`. `test/caption_presets.test.js` seeks a real GSAP
timeline to every frame against the evaluator; `scripts/parity-captions.mjs`
compares rendered stills per preset (`test/fixtures/parity-captions/`, SSIM ≥
0.97, `LAUNCHCLIP_PARITY=1`). The layout check moves the caption band for
`position: top|middle` (`captionBandAt`).

Captions during camera moves: `hide_during_moves` is `"auto"` (default),
`true` or `false`. Auto dips the captions out for every world-camera move that
sweeps the plates vertically (`sweepingMove`: vertical travel above 1 px, a
zoom change or a roll, so vertical pans and whip-pans, push, pull and orbit);
horizontal pans keep their captions. `true` dips for every move, `false` never.
`captionDipWindows(plan, mode)` (camera-world.mjs) gives the move spans;
`captionDipTweens(windows)` turns them into linear opacity ramps of
`CAPTION_DIP_RAMP` (0.12 s) on the captions container that sit just outside
each move (out before it starts, back after it ends; windows closer than two
ramps merge). HyperFrames adds them as `tl.fromTo('#lc-captions', …)`;
Remotion's `WordCaptions` applies `captionDipOpacity(windows, t)` to its
`.lc-captions` element. layout-check samples every frame of every camera move,
transforms each visible plate element's rect by the camera (`screenPoint`) and
reports `camera-caption-band` when key content covers at least 5% of the
caption band while a caption chunk is on screen and not dipped: a warning, an
error from 0.25 s (`checkCameraSweeps`, `CAMERA_SWEEP`).

## Wave 2: module registry, compilers, parity

### Story fields used by the compilers

- `audio.mix`: an optional project path (`assets/audio/mix.wav`) to the premixed
  root track. Both compilers mount exactly one root audio element from it. If
  it is absent, the voice is mounted alone.
- `overlays[]` captions: `{type: "captions", style | preset, src?: "assets/captions/captions.json", hide?: [[start, end]], ...options}` (see "Caption presets").
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
  Empty plates: when the span from one plate's end to the next plate's first
  content (its start plus `sceneLeadIn(scene)`, e.g. a kinetic-words first
  beat after the first frame) is under `HOLD_GAP` (0.5 s), the previous plate
  is held through it, and on a cut the incoming plate stays transparent
  (`role: "hold"` opacity tweens) until its content arrives. `emptyPlates()`
  lists the longer spans; `story validate` warns about gaps in scene timing and
  layout-check reports `empty-plate` warnings.
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

### Fonts (`kit/core/fonts.mjs`)

Both renderers draw text only from bundled font files, so output does not
depend on the render host's installed fonts or on the network.

```js
export const FONT_REGISTRY      // family → {family, slug, package, version, license, generic, faces:[{file, weight, style}]}
export const FONT_ROLE_DEFAULTS // {display: "Anton", body: "Inter", meta: "JetBrains Mono", math: "STIX Two Text", serif: "Instrument Serif"}
export const SYMBOL_FALLBACK    // "STIX Two Math" (unsubset: arrows, operators, ✓ …)
export function fontStack(family, role)       // "'Space Grotesk', 'Inter', 'STIX Two Math', sans-serif"
export function brandFontStacks(brand)        // → {display, body, meta, math, serif, families}
export function projectFontFamilies(brand)    // role defaults + symbol fallback + brand families: what a project loads
export function registryFontFaces(families)   // → [{family, package, file, module, weight, style, format}]
export function frozenFontFaces(family, files)// assets/fonts/<slug>-<weight>[-italic].woff2 → faces
export function fontFaceRule(face, url)       // one @font-face rule, font-display: block
```

- The registry families come from `@fontsource` / `@fontsource-variable`
  packages pinned to exact versions in `package.json` (latin subset; variable
  `wght` files where the family has one). Licences: THIRD_PARTY_NOTICES.md.
- Stacks name only registered families before one generic family. A brand
  family outside the registry sits in front of its role's registered family,
  so a missing file degrades to a bundled face, never to a host font.
- Modules take their stacks from here (`fontStack`, `brandFontStacks`); no
  module hard-codes a system family.
- Per family, frozen files under `assets/fonts/` win over the registry, in
  both renderers.
- **HyperFrames:** `compileStoryToHyperFrames` resolves each registry file
  from `node_modules` (next to the compiler, then next to `sourceDir`), copies
  it to `<projectDir>/fonts/<file>`, declares it with `@font-face`, and starts
  every face loading so HyperFrames' `document.fonts.ready` wait covers them.
  `projectFontFaces(brand, {sourceDir})` and `copyProjectFonts(copies, dir)`
  are exported for hand-built projects (the parity verifiers). No Google
  Fonts link and no remote `font-src`.
- **Remotion:** `kit/remotion/fonts.ts` imports each registry woff2 through the
  bundler (Remotion's webpack config treats fonts as `asset/resource`), so the
  files travel inside the bundle and no `--public-dir` handling is needed.
  Frozen files load with `staticFile("assets/fonts/<file>")`, found through
  `getStaticFiles()`. `ensureFonts(brand)` adds every face with the FontFace
  API inside `delayRender`, releasing the handle once `document.fonts` is
  ready. `StoryComposition`, `ModuleReview` and the test parity entries call
  it. `test/remotion_fonts.test.js` keeps its imports equal to the registry.

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
  It also compares whole-story stills (`runStoryParity`) of
  `examples/story/minimal`, `explainer-9x16` and `promo-16x9` at times inside
  holds, where the ambient field and drift are well under way.

## Ambient motion (`kit/core/ambient.mjs`)

Once a module's enter animation settles, nothing on a plate moves until the
next event, so between beats a story reads as a slideshow and fails the
cinematic motion gate (median frame-change energy, flow velocity p90). The
ambient layer keeps settled frames alive. It is plain ESM that imports only
`./motion.mjs` and `./grammar.mjs`, and every value is a pure function of absolute time and the
story. The HyperFrames compiler turns it into GSAP; `StoryComposition`
evaluates the same functions per frame.

### Control

```jsonc
"ambient": "standard"                          // story level: off | subtle | standard | lively
"ambient": {"level": "subtle", "background": false, "drift": true}
"scenes": [{ "id": "s3", "ambient": "off", … }]  // per-scene override (string or object)
```

- Precedence: `scene.ambient` ← `story.ambient` ← defaults.
- The default level is the motion grammar's `hold.level` when it has one
  (`cinematic`: `lively`). Otherwise it follows the scene's `energy`: 0 →
  `subtle`; 1, 2 and `"build"` → `standard`; 3 → `lively`. A missing energy
  → `standard`.
- `background` defaults to true, except in the `footage-led` lane, where the
  base already moves. There the field is off and only overlays drift (track
  ≥ 1, not `insert` plates), unless a scene sets `drift: true` explicitly.
- `"off"` turns both layers off. Settled frames then hold still, and the
  cinematic motion gate fails.
- `validateStory` checks both fields (`STORY_AMBIENT_LEVELS` in `story.mjs`
  mirrors `AMBIENT_LEVELS`; a test pins them together).

### Layers

1. **Background field.** `ambientField(story)` returns `{level, direction,
   blobs}` or null. A blob is a large radial gradient of the brand `primary`
   or `accent` colour at low alpha, with a many-stop Gaussian-like falloff so
   no stop edge reads as a ring. The alpha is set so that the blob centre adds
   `AMBIENT_PRESETS[level].field.contrast` BT.601 luma levels over
   `brand.colors.bg` (22, 40 and 54 for subtle, standard and lively; alpha
   capped at 0.45), so a brand with dim colours gets the same low-contrast
   field as one with bright colours.
   Each blob glides across the canvas at a steady speed
   (`field.speed` canvas widths per second, about ±8% apart per blob for
   parallax), wraps only while fully off canvas, bobs gently on the cross axis
   and breathes in scale. Axes are `{kind: "glide", from, to, period, offset}`
   (linear, wrapping) or `{kind: "wave", center, amp, period, phase}` (a cosine
   whose extrema fall on multiples of half its period), so a chain of
   `ease: "none"` or `"sine.inOut"` tweens reproduces them exactly:
   `blobTweens(blob, from, to)`. The field level is story-wide
   (`fieldLevel`): the field is one continuous backdrop and does not change
   from plate to plate. The seed is a hash of the title, brand colours and
   format (`ambientSeed`), so a story always gets the same field.
   The field sits **inside** every track-0 plate's layer, under the content,
   not behind the plates: plates stay opaque, so fades, zooms and pushes look
   exactly as before, and in a crossfade both plates show the field at the same
   absolute time, so it reads as continuous.
2. **Hold drift.** `sceneDrift(story, scene, model, {window, geometry})`
   returns `{start, duration, ease: "none", origin, scale, x, y, mode}` or
   null. The scene's content sits in a wrapper that moves linearly from
   identity at the scene start to `{scale, x, y}` at the end of its render
   window, so it never stops dead at settle and hands its velocity to the exit
   and the outgoing transition. The push is about the centre of
   `model.layout.rect`. Its amplitude is `scaleRate`/`shiftRate` per second of
   window, capped at `scaleMax`/`shiftMax`, then clamped by `driftBounds`: the
   profile safe zone, shortened so that a rect clear of the caption band stays
   clear of it while captions are on. A rect with too little room for half the
   wanted push pulls back instead (`scale < 1`, which only shrinks it), never
   shrinking key text below the profile minimum (`model.minTextPx`). Vertical
   travel goes toward the side with more room. `driftEligible` skips
   placeholders, decor (punch-in cameras) and media-window video, whose
   `<video>` HyperFrames lifts out of the scene layer.
3. **Accent life** is left to the modules' own glows: the field already lights
   the plate.

Module emitters, components and the editorial golden corpus are unchanged:
both layers are compiler-level wrappers. A `sceneFilter` compile and
`ModuleReview` have no ambient.

### Renderers

- HyperFrames: each plate's `.lc-layer` starts with
  `<div class="lc-ambient-field">` holding one absolutely positioned
  `.lc-ambient-blob` per blob (`lc-amb-<scene>-<blob>`), and the module
  output sits in `<div id="lc-drift-<scene>" class="lc-drift">` with an inline
  `transform-origin`. Every ambient tween is a `tl.fromTo` on the master
  timeline with `immediateRender: false` and `force3D: false` (2D transforms,
  so text is re-rasterised crisp each frame and matches Remotion), linear or
  `sine.inOut` eases and no `onUpdate`. Field tweens cover only the plate's
  render window.
- Remotion: `SceneLayer` draws `<AmbientField blobs t/>` (inline
  `blobStyle(blob, t)`) before the content and wraps the content in an
  `AbsoluteFill` with `driftStyle(drift, t)`, both at the absolute time
  `(startFrame + frame) / fps`. The loop clone keeps its frozen first state;
  its field keeps moving.
- `test/story_ambient.test.js` seeks the compiled GSAP against the
  frame-pure state; story parity covers the pixels.

### Safety

- Drift is linear, small (`scaleMax` 2–4%) and unblurred: no motion blur is
  applied to it, and the transforms stay 2D.
- `src/layout_check.js` computes the same `sceneDrift` for every scene and
  checks `driftExtent(rect, drift)` (the union of the rest rect and the end
  state) instead of the rest rect, and a pull-back's smaller `minTextPx`. A
  drift that would carry key text out of the safe zone, into the caption band
  or onto a neighbour is therefore a layout error. The report lists the
  drifting scenes (`drifted`).

### Composition with a world camera

Camera moves and parallax (the world-camera grammar) compose with ambient
motion by **nesting transforms**. They never edit blobs or drift values:

```
scene layer (.lc-layer / SceneLayer)   ← typed transition tweens
├─ field container                      ← camera at FIELD_PARALLAX depth (0.3×)
│  #lc-amb-field-<scene> / <AmbientField style>
│  └─ blobs                             ← their own glide, bob and breathe
└─ camera content wrapper (camera, 1×)  ← owned by the camera grammar
   └─ drift wrapper #lc-drift-<scene>   ← hold drift, innermost
      └─ module content
```

- `parallaxState(camera, depth = FIELD_PARALLAX)` → `{x, y, scale}` and
  `parallaxStyle(camera, depth)` map a camera offset (a pure function of
  time on the camera side) to a layer at `depth`. HyperFrames tweens
  `#lc-amb-field-<scene>` with seek-safe `fromTo`s of those values; Remotion
  passes `style={parallaxStyle(camera(t))}` to `<AmbientField>`. The field
  container is otherwise untouched, so the camera owns its transform.
- The camera's content wrapper goes **outside** the drift wrapper, so the
  drift stays a small push about the module rect inside whatever framing
  the camera sets. layout-check inflates rects by the drift only. A camera
  that reframes key content must add its own extent check.
- Every ambient function stays pure and exported, so a camera module can
  sample `blobStateAt`, `driftStateAt` and `sceneDrift` at any time.
- The world camera (world mode) does not put a field in each plate: it draws
  the field once, in its background depth layer, as one continuous backdrop.
  `fieldTiles(field, region, {width, height})` repeats each blob one glide
  wrap apart across and one canvas height apart down over `region`, as
  static translates (`fieldTileTransform`) that are never clipped; the blobs
  inside keep their own glide, bob and breathe. See "World camera".

```js
export const AMBIENT_LEVELS, AMBIENT_PRESETS, FIELD_PARALLAX
export function parallaxState(camera, depth) / parallaxStyle(camera, depth)
export function sceneAmbient(story, scene)      // → {level, background, drift}
export function ambientErrors(value, path)       // → string[]
export function ambientField(story)              // → {level, direction, blobs} | null
export function blobStateAt(blob, t) / blobStyle(blob, t) / blobBackground(blob) / blobTweens(blob, from, to)
export function fieldTiles(field, region, {width, height}) / fieldTileTransform(tile) // world-camera backdrop
export function sceneDrift(story, scene, model, {window, geometry}) // → Drift | null
export function driftPlan({rect, level, start, end, canvas, bounds, minTextPx, minTextLimit})
export function driftStateAt(drift, t) / driftStyle(drift, t) / driftGsap(drift) / driftExtent(rect, drift)
```

## World camera (`kit/core/camera-world.mjs`)

```json
"camera": { "mode": "world", "layout": "auto", "spacing": 0.12, "parallax": true, "blur": false }
```

- `mode`: `"cuts"` (default) or `"world"`. World mode is for the motion and
  voiceover-motion lanes; footage-led stories (a style pack may carry a world
  camera into any lane) keep cuts, and validation warns.
- `layout` (`row` | `column` | `grid` | `path` | `auto`, default `auto`): the
  direction a camera move takes when its transition names none (row: right;
  column: down; grid: a snake over ⌈√n⌉ columns; path: right, down, right…;
  auto: right). An explicit `in.direction` always wins.
- `spacing` (0–1, default 0.12): the gap between neighbouring plates, as a
  fraction of the canvas along the move.
- `parallax` (default true in world mode): the background depth layer moves
  at 0.3× and overlays at 1.15×. `false` keeps the same background, moving
  1× with the plates, and turns overlay parallax off (world plates are
  transparent, so there is always a background behind them).
- `blur` (default: the grammar's): whip-pans always blur at full strength;
  pans, pushes, pulls and orbits blur at the grammar's `camera.moveBlur`
  (snappy and playful 0.5: half the shutter and half the 18 px cap, so a fast
  move reads as motion rather than a jump; editorial, smooth and documentary
  0). `true` blurs every move at full strength, `false` none. The blur is
  exactly 0 at rest either way (sub-threshold speeds round to 0).

Camera transitions (`scene.in` / `ending.in`, track-0 scenes only; footage-led
rejects them):

| Type | World placement of the incoming plate | Layers |
|---|---|---|
| `pan` | beside the outgoing plate in `direction` (where the camera goes) | none |
| `whip-pan` | as pan; the grammar's whip ease; motion blur by default | none |
| `orbit` | as pan, turned ±9° (camera rolls back to upright) | none |
| `push` (world mode only) | centred on `from_object` (`"s3.gap-bracket"`: `model.objects[name].rect`, else the scene's content rect), scaled down by min(W/w, H/h) clamped 1.6–3.2 | incoming fades in over 15–60%, outgoing out over 30–65% |
| `pull` | centred on the outgoing plate (or its `from_object`), scaled up 2.2× | incoming in over 0–50%, outgoing out over 30–100% |

In cuts mode `push` keeps its slide meaning; `pan`, `whip-pan`, `orbit` and
`pull` still move a camera between the two (opaque) plates, and every other
plate stacks where the camera rests. Any non-camera transition stacks the
incoming plate on the outgoing one; in world mode `fade`, `zoom` and `iris`
also fade the outgoing plate out, because world plates are transparent.
A camera `ending.in` travels home to the loop scene's placement (its
`direction` is ignored); any other ending shows the clone where the camera
rests.

Model:

- Placement `{x, y, scale, rotation}` per plate (top-left corner in world px,
  scale, degrees); the first plate sits at the origin. Camera state
  `{x, y, zoom, rotation}` = the world point at the canvas centre, zoom and
  roll; at rest on a plate, `zoom = 1/scale`, `rotation = −plate rotation`, so
  the plate fills the canvas exactly.
- Moves run over `[scene.start, scene.start + in.dur]` from rest to rest with
  `grammar.ease.camera` (whip-pan: `grammar.camera.whip`). Every camera ease
  is `.inOut` with zero velocity at both ends (snappy and playful use
  `back.inOut`, which winds up first: anticipation), so position and velocity
  are continuous at every boundary (`test/world_camera.test.js`).
- Drift (world mode): `x`, `y` and a breathing `scale` wave on the drift
  container, `centre + amp·cos(2πt/period)` with an extremum at t = 0 and
  periods that divide the story duration (so the loop seam matches), amplitude
  `grammar.camera.drift` px at a 1080 px short side. GSAP plays it as
  half-period `sine.inOut` tweens; no frame repeats the previous camera state.
  It composes with ambient motion's hold drift, which lives inside each plate.
- Background and parallax (`PARALLAX`, `plan.depth`): every world story has
  one background depth layer behind the transparent plates. It moves
  `plan.depth` × the plates' screen travel (0.3 with parallax, `PARALLAX.flat`
  = 1 with `parallax: false`; never scaled); overlays (track ≥ 1) move 1.15×
  relative to the camera state where they settle (`overlayOps`, parallax
  only). The layer is ambient motion's background field when the story has
  one, else soft brand glows (`backgroundLayer`), never both. The field is
  one continuous backdrop across the whole world extent
  (`backgroundExtent`): each blob is repeated on its own lattice
  (`fieldTiles` / `backgroundFieldTiles`), one glide wrap apart across and
  one canvas height apart down, in static translate wrappers that are never
  clipped, so no tile edge ever shows (the per-plate field's canvas-sized
  `overflow: hidden` box showed its edge as a hard vertical seam after a
  pan). Cuts mode keeps the per-plate field unchanged.
- Motion blur: an SVG `feGaussianBlur` with separate x/y deviations on the
  camera container, sampled once per frame from the screen velocity of the
  canvas centre (direction) and corners (zoom), through `motionBlurPx`
  (shutter 0.5, max 18 px): exactly 0 at rest. The filter is switched on
  (`--lc-cam-filter`) only while a blurred move runs.

```js
export function resolveCamera(story)      // → {mode, layout, spacing, parallax, blur}
export function cameraActive(story)       // world mode, or any camera transition
export function worldLayout(story, windows, {objects}) // → {placements: Map, loop, order}
export function sceneObjectLookup(story, resolveModule) // → (sceneId, name) → plate-local rect
export function cameraPlan(story, {windows, objects})   // → plan | null (no camera: compilers emit exactly what they did before)
export function cameraStateAt(plan, t) / containerState(plan, t) / screenPoint(plan, point, t)
export function blurAt(plan, t)           // {x, y} deviations
export function cameraOps(plan)           // renderer-neutral ops on "pan", "zoom", "drift", "background", "blur"
export function overlayOps(plan, window)  // ops on "overlay"
export function opsStateAt(ops, target, t)// frame-pure GSAP timeline semantics
export function placementTransform(placement) / containerTransform(props) / backgroundLayer(plan, brand)
export function backgroundExtent(plan)    // field-frame rect the camera can show
export function backgroundFieldTiles(plan, field) // → [{blob, dx, dy}] (ambient.mjs fieldTiles over backgroundExtent)
```

Renderers:

- **HyperFrames**: `#lc-world-bg` (the tiled field `#lc-amb-field-world` ›
  `.lc-world-tile` › `.lc-amb-world-<blob>`, one tween set per blob class
  moving all its copies; or the glows), then `#lc-camera` (z-index 5, the
  blur filter) › `#lc-cam-drift` › `#lc-cam-zoom` (scale and roll about the
  canvas centre) › `#lc-cam-pan` › the plates, each `.lc-scene` carrying its
  placement as a static `transform` (origin 0 0). `cameraGsapLines(plan)` turns
  the ops into `tl.fromTo(…, {immediateRender: false, force3D: false})` and
  per-frame `tl.set` calls (blur: `attr.stdDeviation` and the filter variable),
  so the paused timeline gives the same frame in any seek order. Overlays get a
  `.lc-parallax` wrapper. Root media (video) stays on the root and does not
  follow the camera (a warning says so).
- **Remotion**: `CameraWorld` evaluates the same ops per frame with
  `opsStateAt` and `blurAt`, and draws the same tiles with `WorldField`; `SceneLayer` takes the placement, a transparent
  plate flag and the overlay parallax ops.

Parity: camera stories hold the usual SSIM 0.97 floor (explainer-9x16 mid-pan
0.997; world-camera-9x16 0.990–0.996 at rest, on the playful grammar's
motion-blurred mid-pan frames, with the captions dipped through the pan down,
mid-push, orbit, on blurred whip-pan frames and home again, and the same story
in 16:9 0.991–0.997, compared on the frame grid; `test/parity_camera.test.js`, which
also checks the rendered background has no column step across the former
seam). `test/world_field.test.js` samples the composited field along rows
through the former seam from both renderers' math.
The depth layer's glows are small separate gradient elements on a fixed
lattice that never scale: one huge multi-gradient layer scaled with the zoom
dithered differently in the two Chrome pipelines (0.956).

Partial re-render (`src/render_segments.js`): the camera path is derived
across scenes, so each segment's hash has a `camera` part built from what the
camera puts on screen during its frames (container states and blur per frame,
its plates' placements, its overlays' parallax, the lattice glows or field
tiles that cross the canvas). Changing one scene's pan direction re-renders the segments from
that move on, including later scenes whose own fields did not change.

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

- The HyperFrames side compiles the one-scene story with
  `compileStoryToHyperFrames` (lane forced to `motion`, audio, captions and
  ending dropped); the Remotion bundle uses the fixture directory as its public
  dir, so `assets/…` media resolve in both renderers.
- `runStoryParity(projectDir, {times})` compares full-frame stills of a whole
  storyboard project through both renderer adapters.
- `npm run parity:ci` (`scripts/parity-ci.mjs`) is the cross-OS smoke the CI
  `parity` job runs on ubuntu: five fixtures that between them draw every
  default registry font, at the settle and mid-hold times, plus two stills of
  `examples/story/minimal`, with one shared Remotion bundle.

## Product demo (demo autopilot)

`launchclip demo record` (`src/demo/`) records a SaaS app's key flows in
Chromium and writes, per flow, `demo/<flow>.mp4` and `demo/<flow>.actions.json`
(`launchclip.demo-actions.v1`). The `product-demo` module edits a flow from that
log, so the zooms, outlines, callouts and SFX land on what actually happened in
the app.

### Demo plan (`src/demo/plan.js`)

`DEMO-PLAN.json` (`launchclip.demo-plan.v1`): `{schema, app, viewport: {width,
height, deviceScaleFactor}, flows: [{id, title, goal?, setup?, steps}]}`,
checked by `validateDemoPlan(plan)` → `{errors, warnings}`. `app`:

- `url`: the app's URL (local or staging; `--url` overrides it).
- `fixtures`: path to an ES module, relative to the plan file, exporting
  `route({request, url, method, body})` → `{status?, json? | body?,
  contentType?, headers?}` to fulfill the request, or `undefined` to let it
  through. `url` is a `URL`, `body` the parsed JSON body (else the raw text).
  The module is imported afresh for each flow. Cross-origin answers get CORS
  headers for the app's origin.
- `har`: path to a `.har` or `.zip`, relative to the plan file, replayed with
  `context.routeFromHAR`. A request the HAR lacks falls through to the origin
  guard, so with blocking on it is aborted unless it is for the app or an
  allowed origin.
- `blockOffOrigin` (default `true` when `fixtures` or `har` is set):
  requests to origins other than the app's are aborted, except
  `allowOrigins: ["https://fonts.gstatic.com", …]` (exact origins).
- `session`: a signed-in session applied before the first page, either
  `{storageState: "state.json"}` (a Playwright storage state, relative to the
  plan file) or `{localStorage: {key: "value"}, cookies: [{name, value, url? |
  domain?, path?, expires?, httpOnly?, secure?, sameSite?}]}` (localStorage for
  the app's origin, written once per key before the app's scripts run; cookies
  for the app's host unless they name a url or domain; a cookie takes url, or domain and path, not both). Every value must pass
  `sessionValueProblem` (`src/demo/guardrails.js`): no API keys
  (`sk-…`, `sk_live_…`, `ghp_…`, `xox…`, `AKIA…`), no bearer tokens, no signed
  JWTs (an unsigned JWT, `alg: "none"` or a fake signature, is fine), and no
  random string of 40+ characters unless the value says test, demo, fake,
  mock, example, fixture, dummy, sample or not-real. Cookies must be for the
  app's host or a local or staging host. A storage state file is checked the
  same way when the recording starts. Session values are masked in the
  action log.

Order of the network handlers: fixtures, then the HAR, then the origin guard.
Only a plan file the user writes can name `fixtures`, `har` or `session`: a
model-planned `app` keeps only `url`. `rebasePlanPaths(plan, fromDir, toDir)`
rewrites the paths for the copy of the plan saved next to the clips.
`prepareContext(context, {app, url, planDir, allowHosts, log})` →
`{secrets}` applies the cursor (`CURSOR_SCRIPT`), the network handlers and the
session to a context the caller created; pass `secrets` to `recordFlow`.

### Action log (`src/demo/record.js`)

`{schema, flow: {id, title, goal}, video, viewport: {width, height, deviceScaleFactor}, frame, fps, duration, frames, recorded_at, actions: [...]}`.
Each action is `{index, type: goto|click|type|wait-for|assert-visible|pause,
selector, text, label, start, end, at?, box?, keys?, value?, chars?, url, callout}`.
Times are seconds in the clip (the first screencast frame is 0); `at` is the
mouse-down for a click or type, `keys` the time of each typed character, and
`box` the target's bounding box in viewport CSS px when the action ran. A typed
value is written as `{account: <field>}` or with secrets redacted, never as a
password. Account values and session values are masked (`•`) in every string
field.

### Catalogue D (`kit/core/catalog-d.mjs`)

`product-demo` params: `media {src, sourceStart}`, `viewport`, `actions [{at,
type, box, keys?, until?, label?, navigates?}]` (≤ 24, in order), `callouts
[{at, text, box, duration?}]` (≤ 4, not overlapping), `frame: window|full`,
`zoom: false | {max}`, `title`. `productDemoParams(record, {src, sourceStart,
duration})` builds them from an action log, converting to scene-relative times
and dropping actions outside the window. A click or typing whose `url` in the
log differs from the one before it gets `navigates: true`. A click's or
typing's callout starts 0.6 s before the action, as the cursor reaches the
element; any other callout 0.25 s before its step's end.

- **Rect:** `window` fits the recording's aspect in the safe zone (captions may
  sit over its bottom edge), and `full` fills the canvas, which needs the same
  aspect.
- **Camera:** each click or type target zooms so its box fills at most half the
  canvas (1 to `zoom.max`, default 1.8). A zoom starts 1.2 s before the action
  and settles 0.4 s before it, so the click lands on a still frame. The camera
  holds 1.1 s (or until 0.4 s after the last keystroke; 0.2 s after a click
  that navigates), then moves straight to the next target in 0.6–1.1 s by
  on-screen distance, pulling back partway when the targets are far apart (all
  the way out after a navigation). After a gap of over 2.2 s (or, after a
  navigation, room for both) it zooms out over 0.9 s and back in instead. No
  move is shorter than 0.45 s: actions closer than 0.8 s share one shot that
  frames them all (wide when they are spread out), and a squeezed move may land
  up to 0.15 s after its action. `cameraKeys` gives `{t, s, f, dip?}`
  keyframes, `cameraAt` eases between them (easeInOutSine; scale in log space,
  pulled back to `dip` halfway; given `{rect, canvas}`, the focus travels inside
  the range the clamp allows, so moves never stop dead at an edge), and
  `cameraTransform` maps a state to `{scale, x, y}` about the canvas origin.
  That transform is clamped per axis, so a video already covering the canvas
  keeps covering it and a smaller one stays on screen. One sample per frame
  becomes `set` ops on `<id>-media` (the video, whose transform-origin is the
  canvas origin in its local space) and on `<id>-cam` (the overlay's camera
  layer).
- **Overlay:** `<id>-overlay` holds the camera layer, with an accent outline
  (`<id>-hl-<i>`) around each clicked or typed-into box (for a click that
  navigates, from 0.3 s before the click to 0.2 s after it), and callout pills
  (`<id>-callout-<i>`, brand primary, at least the key text size) placed below
  or above the anchor as the camera shows it at its action (or 0.45 s in). A
  callout on an action's box, from 0.3 s before to 1.5 s after the callout,
  ends when that action navigates or the camera leaves the element. Pills are
  not scaled.
- **Events:** `click-<i>` → `click`, `key-<i>-<k>` → `keystroke-soft`, `zoom-<k>`
  → `whoosh-soft` (zooms of at least 1.3×), `callout-<i>` → `pop`. `finish` binds
  these as module-event SFX, merging same-kind cues closer than 0.12 s.
- **Compilers:** HyperFrames gets `{html: <video>, overlay}` from the emitter
  (`kit/hyperframes/catalog-d.mjs`). The story compiler hoists both to the root,
  the overlay one z-index above the video. Remotion
  (`kit/remotion/catalog/ProductDemo.tsx`) draws an `<OffthreadVideo>` trimmed to
  `sourceStart`, then the overlay.
- **Parity:** `test/fixtures/parity/d-product-demo.json`, a recorded
  `examples/demo-app` sign-in flow, held to SSIM ≥ 0.97.
