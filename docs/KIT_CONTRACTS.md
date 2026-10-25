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

### Editorial variants

`checklist`, `step-rail`, `metric` and `callout` have designed variants
(`EDITORIAL_VARIANTS`, [SEEDED_STYLES_RFC.md](SEEDED_STYLES_RFC.md) §3.2):
`panel` (the original look, the default), `flat`, `outline` and `banner`. The
spec's `variant` names one. `resolveModule` passes the scene's
`params.variant`, else the story's `variants[kind]`. The model carries
`variant`, and an unknown name fails with the kind's list. A kind without
variants refuses `variant` and ignores the story's entry.

A variant keeps everything the core measures: rect, density, content, events
and timing are the default's. That keeps the layout check and both
renderers in step, so one storyboard renders in any variant. It changes the
shell instead:

- **CSS.** `editorialVariantCss(model)` is appended after the base, kind and
  theme CSS by the HyperFrames emitter and by the Remotion `ModuleShell`, so
  both renderers draw the same stylesheet. It never sets a size, padding,
  margin, font or border width.
- **Entrance.** When the spec sets no `motion`, the variant's entrance replaces
  the default rise (`motion.enterFrom`, `exitTo` and `transformOrigin`, with
  `supplied: true`), at the default's durations.

| Variant | Shell | Entrance |
| --- | --- | --- |
| `panel` | the original panel | rises 18 px |
| `flat` | no border, radius or shadow; an 8 px accent bar inset on the title (or the treated callout's heading); round checks, accent dividers, square rail and step numbers, the metric figure in `accentText` | slides in 64 px from the left |
| `outline` | a 3 px accent outline (not a wider border) with an accent halo and 28 px corners; title in `accentText`; round accent checks; an outlined rail | scales up from 0.9 about the centre |
| `banner` | the title (or heading) on a solid accent band, its text the theme's surface or foreground, whichever reads; a tint when neither reaches 3:1; 10 px corners; tinted square checks | drops in 40 px from above |

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

## Style pack v3 (`kit/core/style.mjs`, `src/style_store.js`, `src/story_style.js`)

A style pack is `.launchclip/styles/<name>/style.json`:

```
{schema: "launchclip.style.v3", name, description?,
 brand?: {colors: {bg, paper, ink, primary, accent, ...}, fonts: {display, body, meta}},
 motion?: {grammar: name | {base, ...overrides}, ...},   // pass-through data
 camera?: {mode, ...}, ambient?: {level: off|subtle|standard|lively, ...},
 captions?: {preset, ...caption options,
             lanes?: {motion | voiceover-motion | footage-led: {preset, ...options}}},
 sound?: {sfx_library?: path, sfx_density?: low|normal|high | 0-1,
          palette?: <sound palette id>, ambience?: auto|none|<bed id>,
          music?: {provider?, prompt_hints?, bpm_range?: [min, max], energy_curve?,
                   genre?, bpm?, key?, progression?: index}},
 modules?: {prefer?: [id], avoid?: [id], params?: {<module>: {param: default}}},
 layout?: {safe_profile?: shorts|landscape, title_case?: boolean},
 intro?: {module, params, duration}, outro?: {module, params, duration},
 loop?: boolean, references?: [{name, sha256, kind, width, height, duration_seconds}],
 reference_stats?: {palette, pacing, energy, sound},
 // v3 (docs/VIDEO_QUALITY_RFC.md §9):
 layouts?: {by_intent?: {<intent>: layout}, by_section?: {<section>: layout},
            panel?: {treatment?: solid|glass|paper|outline|soft-shadow, radius?: 0-120 px,
                     fill?: {kind: <background kind, not blobs>, params?}}},
 vocabulary?: {icon_tint?: role|hex, icon_stroke?: 1-3, icon_style?: outline|duotone,
               illustration?: boolean | flat|flat-shadow|line, prefer?: {<intent>: [module id]}},
 profile?: "<shipped profile id>" | <launchclip.cadence-profile.v1 profile>,
 cast?: {drawing_style?, colors?: {<rig slot>: role|hex}, characters?: [id],
         set?: <character set id>, members?: [<story cast entry>]},   // ≤8 members
 // seeded styles (docs/SEEDED_STYLES_RFC.md §3.1):
 generated?: {seed: 8 hex, generator: "launchclip.style-seed.v1", tone?, at?: ISO date,
              constraints?, theme?, scheme?, pairing?, redraws?},
 background?: {kind: <slug>, params?: {fade?: none|center|top|bottom|left|right, ...}},
 variants?: {<module>: <variant>},
 world?: {kind: <world id>, time?: day|dusk|night},
 brand_frame?: false | {enabled?, logo?: path, color?: role|hex,
                kicker?: boolean | {label?: ≤40 chars, underline?, logo?: boolean, position?: top-left|top-right|bottom-left|bottom-right, color?},
                sections?: boolean | {position?, color?},
                progress?: boolean | {position?: top|bottom, color?, thickness?: 2-16 px},
                show?: always|scenes},
 dials?: {energy?, density?, playfulness?, polish?: 0-1},
 segments?: [{id, title: ≤48, kicker?: ≤28, layout?: full|split-left|split-right|framed|stacked,
              modules?: [id], icon?: name, match?: [phrase]}]}   // ≤12; see "Long form"
```

- Layout names are `full`, `split-left`, `split-right`, `framed`, `stacked`,
  `insert` (RFC §7.1); another name is a warning, not an error, so the layouts
  work can add one. Intent and section keys are not checked here (the direction
  map owns intents).
- `profile` is a shipped profile id (resolved by `src/profile_store.js`), or
  an inline profile that must pass `kit/core/profiles.mjs` `validateProfile`
  (`cadenceProfileErrors`). `cast` is shape-checked only (the characters kit
  fills it).
- The seeded-style fields are shape-checked: `background.kind` outside
  `STYLE_BACKGROUND_KINDS`, a `variants` module the catalogue does not list
  (when `modules` is passed) and unknown `generated` keys are warnings, so the
  kits that draw them can grow first. `cast.members` entries are checked as
  story cast entries (`storyCastErrors`) and `cast.set` against the
  characters kit's `CHARACTER_SET_NAMES`. `background` and
  `layouts.panel.fill` go through the backgrounds kit's `backgroundErrors` and
  `panelFillErrors`; a panel radius over the story's 48 px warns. `sound` goes through the sound kit's
  `soundProblems` (palette, ambience, genre, key, bpm, progression,
  `sfx_density` as low/normal/high or 0–1) and `world` through the worlds
  kit's `storyWorldErrors`, the same checks finish and the story use.
- `applyStyle` fills `story.background`, `story.panel` (the pack's
  `layouts.panel` whole, `fill` included; not the default panel an upgraded
  v2 pack carries, so v2 packs render as before) and `story.world` when the
  story has none (a panel radius over 48 px is clamped to it), `story.variants`
  per module (the story's entries win), and `story.cast` from the
  characters kit's `castFromStyle(pack.cast)` — `{style, characters}` — when
  the story has no cast; a story that lists characters without a style gets
  only `cast.style`. The renderers read those story fields.
- `brandFrameErrors(frame, where)` checks `brand_frame` and the story's
  `frame` (the same shape, plus `labels`).
- `upgradeV2Pack(pack, {render})` → `{pack, notes}` fills the v3 fields from
  `STYLE_V3_DEFAULTS`. `render: "same"` (how a v2 pack loads) turns the brand
  frame off and adds no lane caption defaults, so a v2 pack renders exactly as
  before; the default (`launchclip style upgrade`) turns the frame on and,
  when the pack names no caption preset, adds `captions.lanes["footage-led"] =
  {preset: "quiet-accent"}`.

- `validateStylePack(pack, {modules})` → `{ok, errors, warnings}`.
- `applyStyle(story, pack, {intro?, outro?})` → `{story, applied, warnings}`.
  Explicit story values always win. Brand colours and fonts fill per role;
  `motion`, `camera`, `ambient` and `layout` fill per key and are carried
  through as data (renderers that do not read them ignore them); the captions
  overlay gets the pack's preset (with `captions.lanes[story.lane]` on top,
  `packCaptionsFor`) only when it names neither `preset` nor `style`, and its
  other options per key (a story with no `overlays` at all
  gets one captions overlay); `sound` lands on `audio.sfx_density`,
  `audio.sfx_library` and `audio.music_hints` (finish filters cues by density
  and bounds the bed tempo by `bpm_range`); `modules.params` fill each scene of
  that module; `loop` adds `ending.loop_to` (`loop: false` adds `ending.loop:
false`) when the story has no ending, and the story's `style.loop` overrides
the pack's (story.mjs `ending.final` then decides how a non-looping story's last
scene ends: `hold` by default, `fade` or `exit`; modules.mjs `storyFinal`); intro
  and outro scenes are added only when requested (`"style": {name, intro,
  outro}`), and an intro is skipped on stories with a timed voice, mix, base or
  anchors; `brand_frame` (unless off) fills the story's `frame` per key (a
  story with `"frame": false` keeps none). The merged story carries
  `meta.style = {name, applied}`, which makes the merge idempotent.
- A storyboard names its pack with top-level `"style"` (a name, a path to a
  `style.json` or pack directory, or `{name, intro?, outro?}`). Names resolve in
  `<project>/.launchclip/styles`, then `~/.launchclip/styles`
  (`$LAUNCHCLIP_HOME/styles`), then `kit/styles/<name>.json` (built-in
  starters). `applyProjectStyle(story, {projectDir})` runs before validation in
  `readProjectStory` (renderer adapters, cinematic checks, eval), `story
  validate|resolve|compile`, `layout-check` and `finish`.
- v2 packs (`launchclip.style.v2`) load as v3 in memory (`render: "same"`)
  with a warning; `launchclip style upgrade <name>` writes v3 and keeps the v2
  file as `style.v2.json`. v1 packs (`launchclip.style-pack.v1`: `frame.md`,
  caption skin, audio notes) load as v3 in memory with a warning; `style
  upgrade` writes v3 and keeps the v1 manifest as `style.v1.json`.
- Dials (RFC §9.3): `styleDials(pack, story)` → the four dials, 0.5 by
  default, then the pack's `dials`, then the story's `"style": {name, dials}`,
  each clamped to 0–1. `dialTargets(profile, dials)` → `{<measure>: {target,
  band: [lo, hi], dial}}`: the band is the measure's lowest to highest given
  percentile, the target runs piecewise-linearly through p50 (dial 0.5) and is
  clamped into the band, so no dial value can leave it
  (`test/style_v3.test.js` pins this). `energy` moves shot length, visual and
  layout changes, flow velocity, text hold and first visual; `density` moves
  coverage, the longest undressed run, caption words and face time
  (`DIAL_MEASURES`). `dialChoices(dials)` → `{mood, ambient}`: playfulness
  picks the vocabulary mood, polish the ambient level, which `applyStyle`
  fills only when neither the pack nor the story sets `ambient.level`.
- `stylePromptLines(pack, {lane})` is the planner section
  (`planningPrompt({style})`): preferences, the lane's caption preset, footage
  layouts, panels, modules by intent, the cast and the brand frame.
- Starters: `editorial-dark`, `bold-creator`, `minimal-tech`,
  `warm-documentary`, `neon-explainer`; each validates, passes the contrast
  check (`checkPackContrast`: paper/bg 4.5:1, primary and accent/bg 3:1,
  ink/primary 3:1) and merges into every golden story without param errors.

### Seeded styles (`kit/core/style-seed.mjs`)

With no style or brand, `make` and `story plan` generate a pack from a seed
(docs/SEEDED_STYLES_RFC.md). `generateStyle({seed, tone?, constraints?, at?})`
→ a valid `launchclip.style.v3` pack named `seed-<hex>` with a `generated`
block. One seed, tone and constraint set always give the same pack (`at` only
stamps the provenance); `GENERATOR_VERSION` versions the mapping, and a
saved pack is what renders, so a new version changes only rerolls.

- Every dimension draws from its own stream (`seededRandom` from
  `ambient.mjs`, seeded with the seed hashed with the dimension's name), so
  pinning one constraint never reshuffles another.
- Constraints (`CONSTRAINT_KEYS`): `tone` (`TONES`), `theme`
  (`dark|light|tinted`), `world` (id or `{kind, time}`), `drawing_style`,
  `character_set`, `background` (kind or `{kind, params}`) and `panel`
  (treatment or `{treatment, radius}`). Art direction chooses them; the seed
  picks among what fits. They pass through to `world`, `cast.drawing_style`,
  `cast.set`, `background` and `layouts.panel`, and are recorded in
  `generated.constraints`.
- Palette: a harmony scheme (`PALETTE_SCHEMES`) in OKLCH, lightness ranges by
  theme, chroma by tone, then each role moved in lightness until
  `paletteContrast` passes (`PALETTE_CONTRAST`: paper/bg, ink/primary and
  ink/paper 4.5:1; primary/bg, accent/bg and ink/accent 3:1). Primary and
  accent sit at least 30° apart unless the scheme is monochrome. Out-of-gamut
  colours lose chroma, never lightness or hue (`oklchToHex`).
- Type: `FONT_PAIRINGS` (display, body, meta, case, weight, tones) over the
  bundled fonts; a tone narrows the table to its pairings. Title case sets
  `layout.title_case`.
- Tone (`TONE_TABLE`, §3.3) narrows the grammars, themes, ambient levels,
  chroma, SFX density, music hints and the dials' centres (the seed adds up to
  ±0.12). `toneFromText(prompt)` reads tone words (`TONE_WORDS`). The grammar
  picks the transition preference and caption preset; the world camera only
  for playful, snappy, smooth and cinematic; light themes keep the
  stroke-free caption presets.
- The option lists (`SEED_PANEL_TREATMENTS`, `SEED_BACKGROUND_KINDS`,
  `SEED_ICON_STYLES`, `SEED_ILLUSTRATIONS`, `SEED_DRAWING_STYLES`,
  `SEED_CHARACTER_SETS`, `SEED_WORLDS`, `SEED_MODULE_VARIANTS`,
  `SEED_SOUND_PALETTES`, `SEED_MUSIC_GENRES`) come from the kits where
  they have landed: `SEED_MODULE_VARIANTS` is `moduleVariants()`,
  `SEED_DRAWING_STYLES` the characters kit's styles, and the sound lists
  `kit/core/sound/options.mjs`. A tone narrows the sound palettes and genres
  (`TONE_SOUND`); the genre sets bpm, key and progression (`GENRE_SPECS`).
  The seed draws only topic-neutral character sets (`SEED_CHARACTER_SETS`:
  office-team, startup-founders, students, creators, city-crowd); themed
  sets come from the `character_set` constraint, and `generateCast` builds
  2–4 people for the set and palette. The `world` constraint is a kind or a
  list of kinds (suggestWorld's fits) the seed picks within.
  With no world in the direction the seed draws a topic-neutral one
  (`SEED_WORLDS`: abstract-stage, skyline, rooftop, park, city-street,
  home-desk), day and dusk twice as often as night except for premium and
  energetic tones; topical worlds come only from art direction.
  Backgrounds are weighted towards subtle patterns and textures
  (`SEED_BACKGROUND_KINDS` is `[kind, weight]`; flat is rare), each with a
  `fade` and params drawn inside `SEED_BACKGROUND_PARAMS` (the backgrounds
  kit's well-reading subranges; the kinds that take one also get a `color` role, and texture a `type`), and
  most non-glass panels get a quiet `fill` (`SEED_PANEL_FILLS`,
  `PANEL_FILL_CHANCE`; intensity and amount in the low quarter). `sound` holds a palette, a music genre, bpm inside the
  tone's range, key and progression, ambience `auto` and the tone's SFX
  density.
- The brand frame is off (a generated style has no brand name); its kicker
  position, sections and progress line are still drawn, for when it is
  turned on.
- Distance (§3.6): `styleFingerprint(pack)` (palette in OKLab, theme, fonts,
  panel, grammar, caption preset), `fingerprintKey`, `styleDistance(a, b)`
  (0–1: palette half, the four categories an eighth each) and
  `nearestStarter(pack)` against `AVOID_LOOKS` (the five starters, which
  `test/style_seed.test.js` checks against `kit/styles`, and the renderers'
  fallback look). A candidate under `MIN_STARTER_DISTANCE` (0.3) overall or
  `MIN_PALETTE_DISTANCE` (0.06) in palette is redrawn from the next seed state
  (`generated.redraws`).
- `styleSummary(pack)` → `seed 7f3a91c2 (dark, playful, Unbounded / Inter)`;
  `seedSummaryLine(pack)` is the line make and story plan print.
- Projects (`src/style_seed_store.js`): `make` and `story plan` call
  `generateProjectStyle` when no `--style`, brand.json or logo is given (or
  `--seed` is), save `.launchclip/styles/seed-<hex>/style.json`, and reuse
  the generated style the storyboard already names (`projectSeedStyle`).
  `adoptStyleLook(story, pack)` sets the pack's brand, motion grammar and
  caption preset on the planned storyboard and names the style.
  `style reroll` keeps `generated.constraints` (a new `--tone` replaces the
  old) and writes `.launchclip/styles/previous.json` for one `--undo`;
  `style keep` copies the pack to `~/.launchclip/styles/<name>`.

### Brand frame (`kit/core/brand-frame.mjs`)

`story.frame` (filled from the style's `brand_frame`, or written by hand;
`false` for none) is drawn by the compilers around scenes, never by modules
(RFC §9.2): a kicker (the `logo` image, a ≤ 40-character `label`, defaulting to
a story `title` of ≤ 32 characters, and an underline that draws on), section
labels (`labels: [{scene | start, label}]`, each shown from its start to the
next) and an optional `progress` line along the bottom (or top) edge.
`show: "scenes"` shows it only over runs of scenes. The kicker sits in a
corner of the profile safe zone (`top-left` by default) and the labels in the
opposite top corner, each claiming a `78 × k` px band (k = short side / 1080).

- `brandFramePlan(story, {format})` → `{css, nodes, tweens, layout}` in the
  caption-plan shape (same tween rules). HyperFrames mounts it in
  `#lc-frame-root` (z-index 90000, under the captions at 100000) with
  `brandFrameRuntime(plan)`; Remotion's `kit/remotion/frame/BrandFrame.tsx`
  draws the same plan above the scenes and under `WordCaptions`, evaluating
  tweens with `captionElementStateAt`. A `sceneFilter` compile (module review)
  draws no frame, and a story without one compiles byte for byte as before.
- `brandFrameSafe(story, format)` → `{x, y, width, height}` (or null): the
  profile safe zone less the frame's bands and progress line. `resolveModule`
  attaches it as `model.frame.safe`; inside a footage layout section it is
  the panel's safe area (`kit/core/footage-layout.mjs` `layoutAt(story,
  scene.start).safe`) intersected (`intersectRects`) with it. Modules that place
  themselves inside `model.frame.safe` never collide with the frame.
- `frameColorSpans(story)` → `[{start, backdrop, text, underline, dot}]`: the
  frame's colours per track-0 scene. `frameBackdrop(scene, story)` is a cast
  set's wall (`characters/sets.mjs` `setColors`), the brand `bg` behind a
  plate or footage-led insert, or null over the recording (no change there).
  `frame.color` stays while it reaches `FRAME_MIN_CONTRAST` (3) against the
  backdrop, else the brand role with the most contrast; the underline, dots
  and ticks switch only below `FRAME_MARK_CONTRAST` (1.6). A `frame.labels`
  entry's `color` (role or hex) sets the text colour while that label shows.
  The plan adds colour tweens (`FRAME_COLOR_SWITCH`, 0.1 s from each cut) only
  when the colour changes, so a frame that never changes plans as before.
- `launchclip layout-check` warns (`brand-frame`) when key text or a hero
  overlaps the kicker or section label (`brandFrameFindings`).
- Parity: `test/fixtures/parity-footage/f-frame-footage.json` (9:16 footage,
  logo, progress, three labels) and `f-frame-promo.json` (16:9 motion, kicker
  top right, progress on top, `show: "scenes"`); `parity-footage.mjs` fixtures
  take `patch` (top-level storyboard keys) and `files` (extra text files) on a
  copy of the project.

### Mimic a reference (`src/style_reference.js`)

`analyzeReference(file)` samples 24 frames (160 px wide) and measures: palette
(`paletteClusters`: k-means k = 8 with deterministic k-means++ seeding, a
second pass without the dominant colour and a third over saturated pixels);
pacing (hard cuts from `analyzeRenderMotion` plus `structuralBoundaries`: share
of content pixels that changed between t ± 0.5 s at 10 fps, and settle-after
jumps); activity (1 − hold ratio); captions (`detectCaptions`: text-like
edge rows per band, approximate, with the text case from how dense the top
quarter of the text rows is against the middle, `captionCase`); layouts
(`detectLayouts`: per sample, a flat side beside edge-dense footage is
`split-left`/`split-right`, a flat border round it `framed`, else `full`; a
panel counts only when a neighbouring sample shows it); sound
(`analyzeProductionAudio`: loudness, silence ratio, transients).
`draftStyleFromReferences` maps them to a v3 pack (`assignPaletteRoles`,
`grammarFromPacing`, `ambientFromEnergy`, `soundFromAudio`,
`captionsFromDetection`: sentence case picks `quiet-accent` with a highlight
or `minimal-line` without; `layoutsFromDetection`: a split on ≥ 15% of
frames becomes `layouts.by_intent.list`; `fontsFromReference`) with
`profileFromReferences` as its `profile` (a valid `launchclip.cadence-profile.v1`,
`provenance.kind: "measured"`, one source per reference with `--rights`
(default `own`), `format` from `--format` (default `footage-led`):
`shot_seconds` pooled over every shot, `visual_changes_per_min` per 30 s
window, `layout_changes_per_min` per reference, each p10/p50/p90), the
layout mix and caption treatment in `reference_stats.layout_mix` and
`reference_stats.captions`, plus a `reference-report.md`. `compareToStyle(measured, pack)` reports drift for
`launchclip style check`.

### Style adherence (`src/style_adherence.js`)

`styleAdherence({story, pack, measured, profile})` → `{status, checks:
[{check, severity, ok, expected, measured, detail}]}`; an `error` check that
fails fails it, a `warning` (heuristic) only reports:

| Check | Severity | Passes when |
|---|---|---|
| `palette` | error (footage-led: warning) | the render's clusters and the style's palette are within 0.12 both ways (`paletteDistance`; brand colours only: bg, paper and primary must show); footage-led: a cluster within 0.15 of the brand primary |
| `captions` | error | the story's captions use `packCaptionsFor(pack, lane).preset` |
| `caption case` | warning | the case measured from the render's text band matches the preset's |
| `layout mix` | warning | the measured mix is within 0.35 (total variation) of `reference_stats.layout_mix` |
| `cadence: <measure>` | error | the render's median shot, cuts per minute and layout changes per minute pass the profile's own band rules (`compareMeasures`: band, max or min per measure); with no profile, the reference pacing (error) or the grammar's shot range (warning) |
| `brand frame` | error (`"frame": false`: warning) | the style has no frame, or the story draws one (a kicker, a section label or a progress line) |

`styleProfile(pack)` is the inline profile, or a shipped one by id
(`src/profile_store.js` `resolveProfile`). `launchclip style check` adds `checks` (and
takes its status from them) when the project has a storyboard, merging the
checked style into it; `finish` runs the same checks as its `style` gate
whenever the story names a style (`qa/style-check.json`, gate `style` in
`qa/finish/gates.json`; a failed check makes the run `needs-repair`).

## Caption presets (`kit/core/captions.mjs`)

The captions overlay is `{type: "captions", preset | style, src?, hide?,
position?, max_words?, max_chars?, case?, emphasis?, keywords?, font?, size?,
colors?, stroke?, shadow?, entrance?, exit?, offset?, hide_during_moves?}`; legacy `style:
"word-highlight" | "line" | "none"` still works (`line` → `minimal-line`,
`style` may also name a preset, `preset` wins). `CAPTION_PRESETS` holds 15
presets; `STORY_CAPTION_PRESETS` in `story.mjs` mirrors the names. An overlay
that names neither gets `captionDefaultPreset(story)`: `quiet-accent` in a
footage-led story that names no style pack, `word-highlight` everywhere else
(a pack's caption defaults arrive through `applyStyle`). `quiet-accent` is
sentence case in the body face with no stroke, and colours at most one accent
word per line (`accents: 1`): the line's first emphasis word, else its longest
word of six letters or more.

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
   profile safe zone (narrowed to the brand frame's safe area,
   `model.frame.safe`, when the rect sits inside it, so a card placed on the
   frame's edge never drifts into the kicker), shortened so that a rect clear
   of the caption band stays clear of it while captions are on. A rect with too little room for half the
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

## Backgrounds and panels (`kit/core/backgrounds.mjs`, `kit/core/panels.mjs`)

Seeded styles ([SEEDED_STYLES_RFC.md](SEEDED_STYLES_RFC.md) §3.2, phase 2)
choose the plate's background and the card surface once per video. A style
pack carries them as `background` and `layouts.panel`; `applyStyle` merges
them into the story as `story.background` and `story.panel`, and the
renderers read only the story. Both files are plain ESM: `backgrounds.mjs`
imports only `./ambient.mjs`, `./panels.mjs` and `./icons.mjs`, and
`panels.mjs` imports nothing.

### `story.background`

```json
{ "background": { "kind": "dot-grid", "params": { "scale": 1.2, "density": 0.4, "color": "paper" } } }
```

| Kind | Params (range, default) | Motion |
|---|---|---|
| `flat` | none | still |
| `gradient` | angle 0–360 (160), intensity 0–1 (0.5), speed 0–2 (1), color | the gradient turns ±5° |
| `grain-gradient` | gradient's, plus grain 0–1 (0.4) | the gradient turns; the grain is still |
| `paper` | grain 0–1 (0.5), intensity 0–1 (0.4) | still |
| `geometric` | density, scale 0.5–2 (1), intensity, speed, color | two depths of outlined shapes drift and turn |
| `blobs` | none | today's ambient field; the default when `background` is absent |
| `dot-grid` | scale, density, intensity, speed, color | the grid sways by half a cell |
| `mesh` | intensity, scale, speed | four corner washes drift and breathe |
| `stripes` | angle 0–180 (45), scale, density 0.15–0.6 (0.35), intensity (0.35), speed, color | the bands sway across |
| `topographic` | density, scale, intensity, speed, color | contours drift and turn ±1° |
| `halftone` | angle 0–360 (135), scale, intensity, speed, color | the screen sways |
| `light-rays` | angle −60–60 (0), density, intensity, speed, color | the rays swing ±3° |
| `icon-pattern` | icons, scale, spacing 0.5–2 (1), rotation −45–45 (0), offset 0–1 (0.5), opacity 0.02–0.12 (0.06), stroke 1–3 (1.75), speed, color | the tile sways |
| `icon-scatter` | icons, scale, density, jitter 0–1 (0.5), opacity, stroke, speed, color | the scatter drifts |
| `logo-pattern` | scale, spacing, offset, opacity, speed | the tile sways |
| `motif` | shape, scale, weight 0.5–3 (1.5), opacity 0.02–0.2 (0.08), angle 0–180 (45, hatch only), speed, color | the motif sways |
| `texture` | type, amount 0–1 (0.5), scale | still |

`color` is `primary`, `accent` or `paper` (each kind has its own default).
Density, intensity and grain default to 0.5 unless the table says otherwise.
Option params:

- **`fade`** (every kind but blobs): `none` (the default), `center`, `top`,
  `bottom`, `left` or `right`. The fade names the area to keep calm: the
  field container takes a mask that is transparent there and opaque away from
  it (`fieldStyle(plan)`), so the content area stays quiet. A fade never
  raises a tone, so the gate checks the pattern's peak.
- **`shape`** (`motif`): `plus`, `circle`, `chevron`, `wave`, `hatch` or
  `crosshatch`.
- **`type`** (`texture`): `noise`, `fibre`, `canvas` or `linen`.
- **`icons`** (`icon-pattern`, `icon-scatter`): `"auto"` (the default) or 1–8
  icon names from `kit/core/icons.mjs`. `patternIcons(story, icons)` resolves
  `"auto"` to the icons the scenes name, at most 6, else
  `DEFAULT_PATTERN_ICONS`.
- **`logo-pattern`** tiles the brand frame's `frame.logo` file. It draws
  nothing without one. The layer's SVG names the file as `LOGO_SRC`, and
  `layerSvg(layer, resolve)` swaps in each renderer's URL (`staticFile` in
  Remotion). The logo keeps its own colours, so the white and black extremes
  at its opacity both count as tones.

Icons and motifs are drawn as SVG tiles (a data-URI `background-image`), the
scatter as one inline SVG. `validateStory` checks the kinds, ranges and
options (`STORY_BACKGROUND_PARAMS` and `STORY_BACKGROUND_OPTIONS`, kept in step
with `BACKGROUND_PARAMS` and `BACKGROUND_OPTIONS` by test), and so does
`backgroundErrors(value)`, which also checks icon names.

- **Colour.** Every layer takes its colour from the palette. Each colour a
  layer lays over `bg` is clamped (`safeAlpha`) so text in `paper`, the
  modules' foreground, keeps 4.5:1 on it, or bg's own ratio when that is
  already lower. Grain is clamped at both extremes, toward white and toward
  black. `backgroundPlan(story).tones` lists every colour text can sit on.
- **Motion** obeys the ambient level, which is story-wide (`fieldLevel`). Level
  off draws the background still; subtle, standard and lively scale its speed
  by 0.6, 1 and 1.4, and `params.speed` scales it again (0 keeps it still).
  Every layer axis is an ambient wave axis, so GSAP plays it as half-period
  `sine.inOut` tweens (`layerTweens`, through `axisSegments`), and Remotion
  evaluates the same cosine per frame (`layerStateAt`).
- **Where it draws.** It draws wherever the field draws today: inside every
  track-0 plate (`.lc-ambient-field` holding `.lc-bg-layer` divs in
  HyperFrames; `BackgroundField` in `SceneLayer` in Remotion), and in loop
  clones. `sceneBackground(story, scene)` decides whether a plate draws it.
  For blobs that is the field's own rule. Any other kind draws at every level
  unless `ambient.background` is false or the lane is footage-led. In world
  camera mode the background sits fixed to the screen under the camera, and
  the depth layer drops its glows.
- **No background** (or `kind: "blobs"`) leaves the render byte for byte as
  before: `backgroundPlan` returns null, and the compilers draw
  `ambientField`. Segment digests (`src/render_segments.js`) gain a
  `background` key only when a kind is set.

```js
export const BACKGROUND_KINDS, BACKGROUND_PARAMS, BACKGROUND_COLORS
export function backgroundErrors(value, path?)       // → string[]
export function storyBackground(story)               // → {kind, params} with defaults filled; blobs when absent
export function sceneBackground(story, scene)        // → boolean: does this plate draw it
export function backgroundPlan(story)                // → {kind, level, params, colors, layers, tones} | null (blobs)
export function backgroundTones(story)               // → ["#rrggbb", ...] text can sit on
export function layerStateAt(layer, t) / layerTransform(state) / layerStyle(layer, t) / layerCss(layer, t) / layerTweens(layer, from, to)
export function backgroundContrastFindings(story, {captions}) // the layout gate's findings
```

A layer is `{id, box: {x, y, width, height}, style, svg, axes}`: inline CSS in
camelCase, optional SVG markup, and wave axes on `x`, `y` (px), `rotation`
(degrees) and `scale`. The transform pivots on the box centre in GSAP's 2D
order: translate, then rotate, then scale.

### `story.panel`

```json
{ "panel": { "treatment": "soft-shadow", "radius": 18, "fill": { "kind": "icon-pattern", "params": { "opacity": 0.08, "fade": "center" } } } }
```

`treatment` is one of `solid`, `glass`, `paper`, `outline` and `soft-shadow`.
`radius` runs from 0 to 48 px at a 1080 px short side; the default is 32.
`panelSurfaceStyle(treatment, {colors, unit, border, radius})` returns the
surface CSS. Every treatment follows the theme: `panelTheme(colors)` reads
light or dark from `bg`, and the shadows, borders and glass tint change with
it. Text keeps the module's own colour, and each fill (`panelFill`) stays on
the background's side of the contrast.

| Treatment | Surface |
|---|---|
| `solid` | an opaque bg card with a thin border and drop shadow (today's card) |
| `glass` | a translucent card with an 18 px backdrop blur and a hairline border |
| `paper` | a sheet a shade off bg, with a crisp edge shadow |
| `outline` | a 3 px primary border over a 35% bg wash, no shadow |
| `soft-shadow` | an opaque card with no border, lifted by a wide soft shadow |

`resolveModule` copies `storyPanel(story)` onto the model as `model.panel`.
Catalogue G's `cardSurface` (the card behind `surface: "card"` modules, which
is the default over footage) draws it in both renderers. Without
`story.panel`, the card is today's card.

`fill` (optional) is a background `{kind, params}`, any kind but blobs
(`panelFillErrors`). It is drawn by the same layer renderer and clipped to
the panel. `panelFillPlan(story, {width, height, bg})` lays it on the panel's
colour, at the canvas's px scale.

- **Footage-layout panels** (split, framed, stacked, insert): `#lc-layout-fill`
  in HyperFrames and `LayoutFill` in Remotion sit just above the layout frame.
  They cover the canvas, clipped by `layoutFillClip(state, canvas)`: an
  even-odd `clip-path` of the canvas minus the presenter's rounded window. The
  clip is set on the same frames as the frame element (the layout ops), so a
  `layout-shift` carries the pattern with the panel. The pattern moves with
  the ambient level, like the plate's.
- **Catalogue G cards** hold the fill still (`cardFillStyles`, at t = 0, with
  inline SVG as a data URI) in an `overflow: hidden` box with the card's
  radius and the fill's fade. A logo pattern needs a resolved file URL, so it
  draws only in layout panels.

### Contrast gate

`layout-check` adds `background-contrast` errors from
`backgroundContrastFindings`. It checks, on every background tone:

- text in paper, on the plain background and on the story's panel surface
  composited over each tone, at 4.5:1. A `panel.fill` adds its own tones on
  top of each panel tone. A story with a panel fill and no background kind is
  checked on its panel too;
- caption words in their idle colour at 3:1, the large-type floor. Captions
  with a 4 px or wider outline, a plate, a band or chips behind them are
  exempt.

### Fixtures and sheet

- `test/fixtures/parity-backgrounds/` holds one story fixture per kind
  (`bg-<kind>`; every motif shape and texture type; a faded icon pattern on a
  light palette). It also holds one per treatment on a dark and a light
  palette (`panel-<treatment>-<theme>`, over `mesh`), card fills
  (`panel-fill-card-*`) and a split-layout panel fill (`layout-panel-fill`,
  on `examples/story/layouts-wide`). Each fixture is
  `{project, times, patch, files?}`: `patch` replaces top-level storyboard
  keys, and `files` writes small files (a logo) into the copy.
  - `node scripts/parity-backgrounds.mjs [--only …]` renders them through
    both renderers.
  - `LAUNCHCLIP_PARITY=1 node --test test/parity.test.js` renders them too.
  - Every sample must reach SSIM 0.97.
- `node scripts/background-sheet.mjs` renders a still of every kind on a
  light and a dark palette into `qa/background-sheet/sheet.png`. It also
  writes split-layout panel fills (an icon pattern and a linen texture, on
  both palettes) to `panels.png`.

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
          "crop": { "right": 80 }, "edl": "recording/edit-plan.json" }
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
- `crop` (`{left?, right?, top?, bottom?}`) cuts the recording's edges off
  before it is fitted, for example a black bar on one side of a raw screen
  recording, with no re-encode. A value under 1 is a fraction of the
  recording's width or height; 1 or more is source pixels. Pixels need the
  recording's size: `size` (`{width, height}`), which `readProjectStory`
  probes and `resolveStory` takes from the subject track when it is missing.
  Each axis keeps at least half the recording. `storyBase` returns `crop` as
  fractions (null without one, or for pixels with no known size) and `size`.
  - `baseMediaBox(base, canvas, source?)` is where the recording draws: the
    whole recording as a box, sized and placed so that its crop rect is
    fitted (`fit`, `focus`) exactly as an uncropped recording would be, and
    clipped to the crop rect. `baseMediaStyle` turns it into CSS (`left`,
    `top`, `width`, `height`, `object-fit: fill`, `clip-path: inset(…)`, and a
    `transform-origin` at the canvas centre, so punch-in and layout cameras
    move the footage exactly as before).
  - Both compilers draw the base videos and the subject mattes in this box,
    so the mattes stay aligned. Room plates (`ctx.subject.plate`, dolly-zoom)
    draw in it too. `sourceBoxToCanvas` maps through it, so the face track,
    the face rule (layout-check), the layout reframe and module placement
    all see the cropped picture.
  - Without `crop`, both compilers emit exactly the markup they did before.
    The NLE export warns that the crop is not carried.
- Narration words (`audio.words`) are on the edited timeline, as edit-recording
  writes them.
- `audio.mix` is the music/SFX bed under the recording, at `audio.mix_volume`
  (0–1, default 1). Duck the bed against the recording when building the mix.
  `audio.voice` is never mounted in this lane, because the recording carries
  the voice.

Exports: `storyBase(resolvedStory)` returns
`{src, fit, focus, volume, crop, size, segments: [{index, start, end, duration, sourceStart}], length}` or
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
| `punch-in` | `scale` 1.06–1.25 (1.12), `at`, `focus {x,y}` (base.focus, else 0.5/0.42), `release` 0.3–2 s; or `steps [{at, scale}]` 1–4 (scale 1–1.35, the first ≥ 1.06, ≥ 0.3 s apart) instead of `at`/`scale`; `blur` true (14 px at 1080) or 2–30 px | `punch` (whoosh), `step-<i>` (whoosh, or whoosh-soft stepping out), `release` | Camera only; layout role `decor`; ≥ 0.8 s. Blur is velocity-shaped (`motionBlurPx` of the frame edge's speed), 0 once settled; samples carry `blur` |
| `zoom-through` | `at` (the cut; default the base cut nearest the scene's middle, else the middle), `scale` 1.6–3.5 (2.6), `rush` 0.15–0.6 s (0.3), `burst` 0.2–0.8 s (0.4), `focus` (default the presenter's face), `blur` (default on, 24 px at 1080) | `rush` (whoosh), `cut` (impact) | Camera only: power3.in to `scale` at the cut, power3.out back after it, velocity-shaped blur either side; `camera.onCut` says whether it sits on a real base cut; ≥ 0.8 s |
| `footage-callout` | `text` ≤ 42, `label` ≤ 24, `point {x,y}` 0.04–0.96, `side` auto/above/below/left/right, `tone` primary/paper/dark, `tilt` −6–6°, `at` | `point` (tick), `sticker` (pop) | The sticker sits inside the safe zone, above the caption band, and never covers the point. The leader line runs from the point to the rotated sticker edge. ≥ 1.5 s |
| `lower-third` | `name` ≤ 32, `title` ≤ 48, `align` left/center, `tone` dark/primary, `at` | `name` (whoosh), `title` | Bottom edge on the caption-band gap; ≥ 2 s |
| `emphasis-caption` | `text` 1–3 words ≤ 24, `color` (≥ 3:1 on the bg outline), `position` center/upper/lower, `stagger`, `at` | `pop` (impact), `word-<i>` | `hidesCaptions`; 88% of the safe width; ≥ 0.8 s |
| `masthead` | `word` one word ≤ 12 (uppercased), `kicker` ≤ 32, `color` (paper default), `stagger` 0–0.12, `baseline` 0–0.35, `at` | `title` (whoosh) | Layer `behind`, needs the subject. Baseline `baseline` × the height of `ctx.subject.head` (or a default medium head) down the head; by default as deep as 0.35 while the head covers at most 30% of the cap height, never shrinking the letters below 150 px to get there. Letters up to 90% of the safe width, shrunk into the headroom; fails below 150 px, and fails when a measured head hides most of the word (more than half its letters under 60% visible, e.g. a short word inside the head's column on a close-up), so a re-resolve against the real framing refuses it early. `content.covered` is the share of cap height the head covers, `content.baseline` the depth used; `MODULES.masthead.glyphs(model)` gives the key glyph boxes; ≥ 1.5 s |
| `dolly-zoom` | `direction` push/pull, `scale` 1.12–1.6 (1.3), `move` 1–2.5 s, `release` 0.3–1 s (push), `at` | `move` (riser), `release` | Layer `behind`, needs the subject. Scales the matte's room plate (`ctx.subject.plate`) about the head centre; `subjectCamera` holds the presenter at identity. Fails on a close-up; without a plate it draws nothing; ≥ 1.8 s |

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

`cameraOps(models, {roomFilterAt?})` merges every camera into one op list on
`BASE_CAMERA`: identity at 0, then one `set` per sample at `t − SAMPLE_LEAD`,
applied in start order. A sample with `blur` also sets `filter` (`blur(px)`,
prefixed by `roomFilterAt(t)` so a room treatment survives it, or `none`). When cameras overlap, the later one wins, and `cameraOverlaps()` makes
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

## Subject layer (`kit/core/subject-layer.mjs`)

Depth against the cut-out presenter in the footage-led lane
([SUBJECT_EFFECTS_RFC.md](SUBJECT_EFFECTS_RFC.md) §5). The mattes come from
the subject stage (`launchclip subject matte`, `src/subject/`).

### Story fields (`kit/core/story.mjs`)

```json
"base": { "src": "assets/recording.mp4",
          "subject": { "mattes": [{ "src": "assets/subject/0.000-6.000.webm", "in": 0, "out": 6, "info": "assets/subject/0.000-6.000.json" }] } }
```

- `base.subject` is `"auto"` (the default), `"off"`, or `{mattes}`: alpha
  `.webm` files under `assets/` for source ranges `[in, out]` of the base, in
  source order without overlap. `info` is the range's `subject.json`
  (`launchclip.subject.v1`), which layout-check needs.
- `"auto"` takes the mattes filed for this base in
  `assets/subject/mattes.json` (`launchclip.subject-mattes.v1`, written by
  `launchclip subject matte --project <dir>`). Every story reader passes them
  to `resolveStory(story, {subject})`, which writes them into the resolved
  copy as `{mattes}`; an explicit list or `"off"` is never replaced.
- `scenes[i].layer` is `front` (default), `behind` or `split`. A non-front
  layer needs the footage-led lane, is invalid on an insert, and needs a
  subject (`base.subject` not `"off"`).
- `storyBase()` adds `subject: {mode: "auto"|"off"|"mattes", mattes}`.

### Model fields

Modules may set, all optional (`subjectModelErrors()`; `resolveModule`
rejects bad values):

- `layer`: the module's default layer (a scene's `layer` wins).
- `parts`: `{behind, front}` for split modules. HyperFrames emitters return the
  behind half as `out.behind = {html, css?, motion?}` beside their usual
  (front) output; Remotion components are rendered twice with `model.part`
  set to `"behind"` or `"front"`. A `split` scene whose model has no parts
  renders in front, with a warning.
- `subjectCamera`: `{samples: [{t, scale, x, y}]}`, one per frame like
  `model.camera`, moving the subject only.
- `room`: `{hide?, dim? (0–1), blur? (px, ≤ 40)}` for the scene window,
  applied to the base videos only.
- Catalogue definitions may declare `needs: ["subject"]`, `layer`, `aspects`
  and `mood`; `moduleCatalogue()` carries them, `planningPrompt({subject})`
  lists subject modules only for a footage-led story with a usable probe,
  and `suggestModuleMoods(artDirection)` favours modules by mood.

### Footage checklist

In a footage-led story whose covering matte has a summary (`placement:
"measured"`), a `checklist` without `params.rect` is placed beside the
presenter: above the head when the safe zone has room, else on the chest
above the caption band. It keeps its derived layout and shrinks to fit, but
never below the scale where its body and secondary text meet the profile's
minimums. `model.subjectPlacement` is `"above-head"`, `"chest"`, or `"none"`
(no room: the derived rect stays, and layout-check's face rule reports any
clash). Stories without a measured subject are unchanged.

Every checklist in the footage-led lane also types in
(`checklistTypeIn`, `kit/core/editorial-core.mjs`): each row fades in over
`TYPE_IN.fade` s on its `at` time while its label types in letter by letter,
then ticks on `doneAt` as before. The letters take `TYPE_IN.perChar` s each,
at most `TYPE_IN.window` s in all, and finish `TYPE_IN.beforeDone` s before a
`doneAt` tick. Each row gets `typed: [{time, text}]` (the first letter at the
row's time, the rest on the frame grid) and `typeEnd`, the content gets
`typeIn: true`, and a `<id>-row-<i>-typing-start` event (with `endTime`)
cues the typing track. The emitter writes one `tl.set` of `textContent` per
letter on `#<id>-label-<i>`; `Checklist.tsx` steps through the same sets
(`stepped`). `test/fixtures/parity-footage/s-data-checklist-type.json` holds
frames mid-typing to SSIM ≥ 0.97.

### What modules know (`subjectContext`)

`resolveModule` passes `ctx.subject = subjectContext(story, scene.start, {end: scene.end})`:
`{available, framing, head, body, headroom, plate, placement, source}`. `head` and
`body` are canvas rects mapped from the covering matte's `summary` (filled by
`resolveStory(story, {subject})` from each matte's `info`; the loader's
`readStorySubject` reads them). Where no matte with a head covers the scene's
start, they come from the whole-video track over the scene's window (below);
`source` says which (`"matte"`, `"track"` or null). `available` stays true
only under a matte. `plate` is `{src, fit, focus}`; `placement` is
`"measured"` with a measured head (matte or track), else `"default"`.

### Whole-video track (`launchclip subject track`)

The probe samples about a frame a second; mattes exist only where an effect
needs depth. The track measures the presenter's head and body on every frame
at `TRACK_FPS` (10) over the whole recording, with the probe's model
(mediapipe-selfie) and the probe's measurements (`maskStats`).

- `runSubjectTrack(src, options)` (`src/subject/stage.js`) writes
  `launchclip.subject-track.v1` (`validateSubjectTrack`): `{schema, source,
  model, fps, base?, …summary, frames: [{t, coverage, people, head, body}]}`,
  cached as `<cache>/<sha256-12>-<model>/track.json` beside `probe.json`.
- `launchclip subject track <video> --project <dir>` files it as
  `assets/subject/track.json` with `base` set to the video's project path.
  `launchclip make` runs it after the probe for footage-led stories (one
  person or more in frame); a failure is a warning and costs only the track.
- `readStoryTrack(project, story)` (`src/subject/project.js`) returns
  `{source: {width, height}, fps, frames: [{t, head, body}]}` when the file
  was filed for the story's base, else null (also for `base.subject: "off"`).
  Every story reader passes it to `resolveStory(story, {track})`, which keeps
  it as `resolved.subjectTrack`.
- `subjectContext` takes the presenter's extent over the scene window from
  it (`boxExtent`: each box edge at the 10th or 90th percentile over the
  window's frames), so footage placement (the checklist, `headRect`) keeps
  clear of the head however they move. `trackFrameAt(story, t)` is the frame
  shown at t (within one track step), through the base's trims.
- `subjectLocator` (so `headLocator`, the face rule and behind-text) uses a
  matte's own frames where one covers t and the track everywhere else.

### Room plate

`launchclip subject matte` also writes `plate.jpg` (short edge ≤ 1080): the
average of every pixel the matte calls room (alpha < 8), with what the
presenter always covered filled by a push-pull pyramid (`src/subject/plate.js`).
Mattes may name it as `plate`; filed mattes carry it.

### Outline

It also writes `contours.json` (`launchclip.subject-contours.v1`): per matte
frame, `points` from 120 rays cast from the centre of the silhouette's upper
60%, each the last inside pixel as `[x, y]` fractions of the frame, or null
where the ray reaches the frame edge (the outline breaks there). Mattes may
name it as `contours`; `readStorySubject` loads every third frame as the
matte's `outline`, and `subjectContext(story, t).outlineAt(t)` (or
`subjectOutlineAt`) maps the nearest frame onto the canvas. It ignores camera
moves.
- `framesFace`: the module frames the face on purpose; layout-check's face
  rule skips it.
- `usesOutline`: the module draws in front but traces the presenter's
  outline, so `make` and `fx` still matte its range (`plannedSubjectRanges`).
- `subjectStyle`: `{outline? (0–24 px), color? (#rrggbb), shadow?}` for the
  scene window: eight zero-blur drop-shadows round the matte's alpha make a
  solid outline, plus an optional soft shadow (`subjectFilterAt`,
  `subjectFilterChanges`). A blurred subject camera sample carries it.

### Compositing

Bottom to top: base (room treatment, base cameras), behind scenes and split
behind parts, the subject, every other scene and split front parts, captions.

- `needsSubject(scene, model)`: a non-front layer, a `subjectCamera` or a
  `room`. The subject is mounted only while such a scene runs
  (`subjectWindows`), so a story with no such scene compiles byte for byte as
  without `base.subject`.
- `subjectSegments(story, windows)`: each base segment ∩ each matte's range ∩
  each window, frame-snapped: `{index, src, start, end, duration, mediaStart}`
  (`mediaStart` is seconds into the matte file).
- `subjectCameraOps(models)`: ops on `SUBJECT_CAMERA`. The subject follows the
  base cameras; while a `subjectCamera` runs, its samples replace them.
- `roomChanges(models)` / `roomStateAt(models, t)`: `{opacity, filter}`, the
  later-starting room winning an overlap.

**HyperFrames.** With a subject, the base audio stays on track 3, the matte
clips take track 4 (`<video class="clip lc-subject-media">`, same fit and
focus as the base) and scenes start at track 5. Behind scenes stack from
z-index 10; the subject sits at `10 × (scenes + 1)`, front scenes above it.
The subject camera is `tl.set(".lc-subject-media", …)`; room changes are
`tl.set(".lc-base-media", {opacity, filter}, t)`. A `sceneFilter` compile keeps
the subject for the filtered scenes.

**Remotion.** `StoryComposition` renders `BaseLayer` (with `rooms`), the
behind scenes, `SubjectLayer` (`<OffthreadVideo transparent>` per clip in a
wrapper moved by `subjectCameraAt`), then the front scenes. `ModuleReview`
draws a behind module under its matte.

### NLE export (`launchclip export`, `src/nle/`)

`launchclip export` keeps the same stack as editor tracks, so an editor keeps
text behind the head. Bottom to top:

1. V1, the base footage (its trim segments).
2. `Behind subject <track>`: behind scenes and the behind parts of split scenes.
3. `Subject (presenter cut-out)`: the matte clips.
4. `Overlays <track>` (and `Inserts`): every other scene and the front parts
   of split scenes.
5. Captions.

- `overlayPlan(story)` gives a behind scene's clip `layer: "behind"` and turns
  a split scene into two clips, `<id>-behind` and `<id>-front`, with `part`
  set. `SceneOverlay` takes the `part` prop and renders only that part. With
  any layered scene the plan also has `subject: {windows, scenes}`. Each scene
  entry lists `animated`, the `subjectCamera`, `room` and `subjectStyle`
  fields it sets.
- The subject track is `subjectSegments(story, subject.windows)`: one clip for
  each base segment ∩ matte range ∩ window. Each clip's in point is
  `mediaStart`, so it shows the matte of the source frame the base shows,
  across cuts. The mattes are VP9 alpha WebM, which editors don't read with
  alpha. Export transcodes each matte it uses to ProRes 4444
  (`yuva444p10le`), or to PNG frames with `--overlays png`, into
  `media/subject/`, and reuses a copy while the matte is unchanged. libvpx-vp9
  has to decode it, because ffmpeg's native VP9 decoder drops alpha.
- Limits. The export carries the static layering only. A scene that sets
  `subjectCamera`, `room` or `subjectStyle` gets a warning, and
  `EXPORT.json` lists it under `subject.static`. To get those effects,
  re-create them in the editor with keyframes or effects, or use the finished
  render. The subject clips use the base's spatial conform, and base cameras
  (punch-in) stay markers, as before. The EDL has one video track, so it
  carries only V1, and the report notes that the depth is left out.
  `--overlays none` exports no subject track.
- A story with no layered scene (no `behind` or `split` layer, no
  `subjectCamera`, `room` or `subjectStyle`) gets no subject plan. Its
  exports are byte for byte the same as before.
- `EXPORT.json` adds `subject: {mattes: [{src, status, file, frames?}],
  track, clips, static}` when there is a subject plan.

### Face rule (`checkSubjectFace`, `src/layout_check.js`)

With `{mattes}` that carry `info`, or a whole-video track,
`headLocator(story, infos)` maps each frame's head box through the base's
trims, fit and focus onto the canvas (the matte's frames where one covers t,
the track's elsewhere). A
front-layer element covering at least 25% of the head for more than 0.3 s is
a `subject-face` error. Behind scenes, captions, decor (punch-in) and
`framesFace` modules are exempt.

### Behind-text visibility (`checkBehindText`, `src/layout_check.js`)

A behind-layer scene whose module names its key glyphs (`MODULES[id].glyphs(model)`
→ `[{index, char, x, y, width, height}]`, laid out by `glyphBoxes` in
`kit/core/catalog-b-base.mjs` with the same advance model as `textWidth`, so
nothing is rendered) must keep at least 60% of each glyph clear of the
presenter at its settle time (`layout.motion.enterEnd`) and mid-hold, on the
frame grid. The presenter is each frame's head and body box from the matte's
`subject.json`, mapped like the face rule (`subjectLocator`, then
`subjectCameraOps`), and modelled by `subjectCoverShare` (`kit/core/subject.mjs`) as the ellipse
inside the head box joined to the body box below the chin. A glyph under 60%
is a `subject-text` error naming the worst glyph and time, with the module's
repair (masthead: lower `params.baseline`, drop the kicker, or a shot with
more headroom). Today only `masthead` names its glyphs. In a portrait Short a
masthead needs about 20% headroom (more with a kicker), which the planner
prompt states.

### Matte quality gate (`src/cinematic_check.js`)

`matteQuality(info)` measures one range's `subject.json`. The range fails when
the subject stage marked it unusable, when its coverage is unstable across the
range (1 − the coefficient of variation under 0.7, as the stage measures it),
when any frame collapses (coverage under a third of the range's median, or
under 0.01), or when coverage jumps between two frames by more than 30% of the
median (at least 0.03). `MATTE_GATE` holds the limits. `subjectMatteGate(project,
mattes)` reports `{status: "passed" | "failed" | "skipped", ranges}`; a range
without `info` cannot be measured and passes as `skipped: true`.

`finish` runs the gate in its validate stage, before anything resolves. A
failing range is not used, and `applySubjectFallback` changes finish's copy
(never `storyboard.json`) for every scene whose window shows that range's
footage:

- a module that needs the subject (`needs: ["subject"]`: it is built round the
  cut-out, its room plate or its outline) is **skipped**, and the recording
  shows there instead;
- any other scene on the `behind` or `split` layer renders **in front**;
- any other scene whose model still sets `subjectCamera`, `subjectStyle` or
  `room` is skipped.

`base.subject` becomes the explicit list of the ranges that passed, so
layout-check and both compilers never mount the failing matte. Each change is
a `subject gate:` warning, and the finish report's `gates.subject` is
`{status: "fallback", ranges, changes: [{id, module, action, range}]}`; it
never fails the render. `cinematic-check` reports the same gate as `subject`
in its result.

### Density budget (`subjectDensityFindings`, `kit/core/modules.mjs`)

Presenter effects land when they are rare (RFC §7.5). A subject effect is a
scene on the `behind` or `split` layer, a module whose definition `needs` the
subject, or `punch-in`, `zoom-through` or `pull-back` (`isSubjectEffect`). In
a resolved footage-led story they warn, never fail, when together they cover
more than 35% of the runtime (overlaps count once), when two sit closer than
3 s apart, or when two different ones run back to back (within a frame).
`story validate` and `story resolve` list the warnings, `checkStoryboard`
(the planner) carries them, and layout-check reports them as
`subject-density` warnings. `SUBJECT_DENSITY` holds the limits. This sits
beside the footage-led lane's "dress 10–40% of the runtime" guidance, and the
planner prompt's presenter section states the same budget.

### Parity

`examples/story/subject` (regenerate with
`node scripts/make-subject-example.mjs`) is a synthetic presenter with an
exact matte. `test/fixtures/parity-footage/s-subject-behind.json` (module)
and `s-subject-story.json` (story) hold it to SSIM ≥ 0.97.

## Footage layouts (`kit/core/footage-layout.mjs`)

A section of a footage-led story holds one layout, and the scenes inside it
render within it (docs/VIDEO_QUALITY_RFC.md §7.1).

### Story field

The contract adds one top-level field, `sections`. A scene field was the
other option, but it would need a layout on every scene, and a layout belongs
to a stretch of the recording, not to one scene.

```json
"sections": [
  { "id": "steps", "start": "word:three", "end": 9.5, "layout": "split-left" },
  { "id": "proof", "start": 9.5, "end": 14, "layout": "framed", "side": "right", "room": "dim", "transition": { "type": "layout-shift", "dur": 0.5 } }
]
```

| Layout | Presenter | Panel (graphics area) |
| --- | --- | --- |
| `full` | full frame (also every time outside a section) | none; overlays only |
| `split-left` | reframed into the left 46% (16:9) or 50% (9:16) | the right side |
| `split-right` | reframed into the right side | the left side |
| `framed` | inset in a rounded frame with a ring; `side` left/right (16:9, default left) or top/bottom (9:16, default top) | the rest of the canvas |
| `stacked` | 9:16 only: the bottom half (`side: "top"` for the top) | the other half |
| `insert` | hidden; the base audio keeps playing | the full canvas |

- The contract lives in `kit/core/story.mjs`, which stays import-free: `validateSections`, `storySections` and `layoutSpans`. `footage-layout.mjs` re-exports them. `validateSections` (called by `validateStory`) checks the following:
  - the lane is footage-led;
  - ids are unique;
  - the layout and `side` are known, and `stacked` is used only in portrait;
  - `panel` is a brand role (bg (default), primary, accent, paper or ink) or a `#rrggbb` colour;
  - `ring` is 0–24 px (default 6 for framed, else 0);
  - `room` is keep, dim or replace, and `zoom` is 1–1.6;
  - `transition` is `{type: "layout-shift" | "cut", dur ≤ 2}`;
  - sections are in order, without overlap.
- `resolveStory` resolves section anchors like scene times.
- `storySections(story)` normalises the sections and snaps them to frames.

### Geometry and the frame element

- `layoutGeometry(layout, side, canvas)` → `{window, radius, panel}`. The window is where the presenter shows.
- `panelSafeArea(panel, canvas, {captions, captionBand})` is the panel inside the profile's safe zone. It sits a gutter (4% of the short edge) in from the window and, when the story has captions, above the caption band where that band runs under the panel. `layoutAt` passes the layout's caption zone as `captionBand`, so a split's panel runs to the bottom of the safe zone.
- `layoutAt(story, t)` → `{section, layout, side, presenter, panel, safe, color}`, or null outside sections.
- `sceneLayoutAt(story, start, end)` is the layout a scene renders in: the section that holds at least half of the scene (`sceneSection`), else `layoutAt(story, start)`. `resolveModule` passes it to catalogue modules as `ctx.layout`, so a scene that starts a moment before its section (71.0 s against 71.2 s) still gets the panel.
  - `validateSections` warns about every non-insert scene that spills over a section's edge, with the section, the gap and where to move it: "scene inside-list: starts 0.2 s before section s5 (71.2 s); it is placed in s5's split-left layout; move its start to 71.2". A scene that is mostly outside a section is told that it is placed in the full frame instead.
  - A fitting error for a scene placed in the full frame although it overlaps a section ends with `sectionFitHint`, which names the section it fell outside.
  - The brand frame (style v3) and modules place themselves in `safe`.
  - A footage-led checklist without `rect` inside a section with a panel fits `safe`, never below its legal text scale (`subjectPlacement: "panel"`).
- Captions sit on the presenter's side, never across the seam between the panel and the footage. `captionZone(layout, side, canvas, band)` narrows the caption band (the profile's band at the overlay's `position`) to the presenter's window, a gutter in from its edges. When the band would fall outside the window (a 9:16 `framed` top or `stacked` top), it moves up into it. Full and insert keep the band, as does a window the band already sits inside (`stacked` bottom), so those return null.
  - `captionZones(story)` → `[{section, start, end, rect}]`; `layoutPlan(story).captions` holds them.
  - Both compilers hand them to `captionPlan` (`ctx.zones`). Each caption line takes the zone it is mostly spoken in (`captionZoneIndex`: at least half of its spoken span), gets the class `lc-cap-z<n>`, and is centred and wrapped inside the zone. The CSS is the same text in both renderers. A zone narrower than 480 px at 1080 sets smaller type, down to 70%, so one long word still fits. A `lower-band` band never runs across a zone change.
  - The layout check checks the captions there: one `captions@<section>` element per zone, and the band element is hidden over those sections.
- The panel is one element in both renderers: `#lc-layout-frame` in HyperFrames, `LayoutFrame` (`kit/remotion/LayoutFrame.tsx`) in Remotion.
  - It's a box at the window, styled by `layoutFrameStyle(state, canvas)`.
  - Its `box-shadow` is the ring in the brand primary, then a spread of twice the canvas in the panel colour, so it paints everything outside the window.
  - It sits above the subject layer and under every front scene. In HyperFrames that is z-index `subjectZ + 5`, or 5 without a subject.
  - Behind scenes stay under the subject, so a panel covers them.

### Plan, camera and transitions

`layoutPlan(story)` is null without sections, so other stories compile byte for byte as before. Otherwise it returns `{sections, spans, ops, boundaries, rooms, warnings, canvas, captions}`.

- **Spans.** `layoutSpans(story)` gives the sections plus `full` gaps, back to back. Each span carries the shift that brings it in. A span shifts when its layout, side, panel, ring or zoom differs from the span before it; two adjacent sections that differ only in where the head sits cut.
- **States.** Each span has a state `{window, radius, panel, ring, ringColor, camera, hidden}`. The camera is the base camera that reframes the presenter:
  - The head is measured over the section by `subjectContext` (the matte, else the whole-video track, else the canvas centre at 35% height).
  - The camera moves the head to the window's horizontal centre, at its height in the frame.
  - It's scaled 1× (`zoom`) or, for framed, to fit the frame, and clamped so the footage still covers the window.
  - `insert` keeps the previous camera.
- **Ops.** `ops` hold a state at 0, every frame of each shift, and each cut. `layoutStateAt(plan, t)` is the last op at or before t, and both compilers set the same values on the same frames.
- **`layout-shift`.** Between two different states, a layout-shift (default 0.5 s, cubic in-out, at most the span's length) interpolates the window, radius, ring and camera.
  - The panel takes the incoming colour, or keeps the outgoing one when shifting back to full.
  - `cut` jumps.
- **Boundaries.** Each shift is a boundary `{boundary_id: "<id>-layout" | "<id>-layout-out", kind: "ordinary", type: "layout-shift", start_seconds, duration_seconds, from_id, to_id}`.
  - `deriveBoundaries` appends them (from `layoutSpans`), so the evidence schedule samples shifts.
  - HyperFrames also writes one hidden `.lc-layout-boundary` marker per shift with the `data-launchclip-transition-*` attributes.
- **Cameras.** `withLayoutCameras(models, plan, {fps, duration})` composes the reframe into every module camera and subject camera: a sample becomes layout ∘ sample, so a punch-in zooms inside the reframe. Where no module camera runs, it adds one `layout` model with the layout camera at each op time and on the frame after each module camera ends.
  - Both compilers, `subjectCameraOps` and layout-check's subject view use it.
  - The face rule follows the reframed head, and sees no head while `insert` holds.
- **Rooms.** A section's `room` (`dim` → `{dim: 0.55}`, `replace` → `{hide: true}`) becomes a room model for the section window. It needs a matte over every frame of the section; otherwise it's dropped with a plan warning that HyperFrames reports. It mounts the subject like a scene's room, and `plannedSubjectWindows` (so `make`) mattes it.
- **Module reviews.** A module review (sceneFilter, ModuleReview) has no layout.

### Parity

There are two examples, `examples/story/layouts-wide` (16:9: full, split-left, framed with the room dimmed, split-right on a paper panel) and `examples/story/layouts-tall` (9:16: full, stacked, framed with the room replaced, insert, back to full). Each has a synthetic presenter, an exact matte and a track: `node scripts/make-subject-example.mjs --out <dir> [--aspect 16:9] --duration 10 --track`.

`test/fixtures/parity-footage/s-layout-wide.json` and `s-layout-tall.json` hold both renderers to SSIM ≥ 0.97 at frame-exact times, mid-shift and settled (0.994 minimum when added).

## Long form (`kit/core/long-form.mjs`)

Long videos (5–30 minutes, the `youtube-long-form` profile) get structure before density (docs/VIDEO_QUALITY_RFC.md §10.2).

### Chapters

The chapter contract is one top-level story field, `chapters`, in `kit/core/story.mjs` (import-free):

```json
"chapters": [
  { "id": "c1", "title": "The problem", "start": 0 },
  { "id": "c2", "title": "Tool of the week", "start": "word:tool", "segment": "tool-of-the-week" }
]
```

- `validateChapters` (called by `validateStory`) checks the following:
  - ids are unique short ids, and titles are 1–60 characters;
  - starts are seconds or anchors, in order, the first at 0;
  - `segment` names a segment format (see below).
- It warns when YouTube would ignore the list: fewer than three chapters, or one shorter than 10 s (`CHAPTER_MIN_COUNT`, `CHAPTER_MIN_SECONDS`).
- `resolveStory` resolves chapter starts like scene times. `storyChapters(story)` → `[{index, id, title, start, end, segment}]`; each chapter runs to the next one's start, and the last to the end.

Chapters come from the direction map: `chaptersFromMap(map, words, {duration})` makes one per section, starting at its first word (or its `start`). The first chapter starts at 0. A section shorter than 10 s joins the chapter after it. A section without a `title` is "Part n", so the planner and the skills give every section a short title.

### The structure pass

`structureLongForm(story, {words, map})` → `{story, map, chapters, added, changed, warnings}` works on copies and is deterministic:

- **Chapters.** It sets `story.chapters` from the map unless the story has them.
- **Section cards.** At each chapter start after the first, it adds a `section-card` (`chapter-<id>`): kicker "Chapter n", the number and the chapter title, held 2.6 s. It's an insert in the footage-led lane.
- **The opening promise.** After the hook line, it adds an `icon-row` (`promise`, track 1 in the footage-led lane) titled "In this video". It lists the next two to five chapters, with an icon per chapter from its title. If the line after the hook is taken, the promise moves to the next line start with room, up to 45 s in.
- **The progress line.** It sets `frame.progress: {ticks: true}`. The brand frame draws a tick at each chapter start (`lc-frame-tick-NN`, both renderers), and the frame's section labels fall back to the chapter titles. `frame: false` keeps no frame.
- **Room.** Anything on the new scene's track and every graphic is in its way.
  - A scene that starts inside the card's window starts after it. A scene running across the window's start ends before it. Either move happens only when the scene keeps at least 1 s and still overlaps every map line that names it.
  - Otherwise the card shortens, or starts up to 4 s late. A card with less than 1.4 s of room is skipped with a warning.
  - Moved scenes are listed in `changed`.
- **The map.** It gains section titles. A face or camera line under a new scene becomes an insert or dress line naming it.
- **Idempotence.** Running it again drops what it added last time first.

Where it runs:

- `planStoryboard` runs it on a passing plan when the story is long form (`isLongForm`: the long-form profile, or 300 s and up; `longForm: false` turns it off). It keeps the result only when the structured storyboard passes the same checks, and reports it as `long_form: {chapters, added, changed, warnings}`.
- `launchclip story long-form <project> [--dry-run]` runs it on a project's storyboard.json and DIRECTION.json; the skills call it after writing both.
- The direction prompt carries `longFormLines()` for long stories, and `references/direction-map.md` carries them too.

### Attention resets

A long video needs a change of picture at a steady interval: a layout change, an insert or a section card (RFC §10.2). These are planned, not random.

- **The measure.** `longest_without_reset_seconds` (check `max`) is the longest run between resets. `youtube-long-form` seeds it at p50 60 s (the planning target) and p90 120 s (the ceiling).
  - `storyboardMeasures` reports it with `reset_times` and `intervals.unreset`. `resetTimes(story, scenes, {sections, inserts, duration})` counts each insert start, each `section-card` start (`RESET_MODULES`), and each layout change. Layout changes come from the story's footage `sections` and from the direction map's section layouts.
- **Planning.** In the footage-led lane, the structure pass runs `planResets` after the cards and the promise. It reads the target and ceiling from the profile (`resetBand`, default 60/120 s). It splits every run longer than the target into equal parts and resets each split point:
  - first, it makes the nearest overlay card an insert. The card must be within a third of the target, an insert-ready catalogue G card (`INSERT_READY_MODULES`), 1.5–10 s long, with nothing else on screen. The card loses its track, gains `insert: true` and a 0.25 s fade, and its map line becomes an insert line;
  - else it adds a footage section `reset-n` (split-right, or stacked in portrait) for up to 20 s, where no section or insert is;
  - else it warns.
  The result is `resets: {target, ceiling, times, longest, promoted, sections}`.
- **Checks.** The coverage gate fails a run past the ceiling (`COVERAGE_GATE_MEASURES`) and adds a `sparseness` finding per run. `story validate` reports it as an error, unlike the other bands, because the fix is structural: `launchclip story long-form` places the resets.

### Recurring segment formats

A style can define named segment templates, so a series looks like a series: a "tool of the week" opens the same way and holds the same layout every episode (RFC §10.2).

```json
"segments": [
  { "id": "tool-of-the-week", "title": "Tool of the week", "kicker": "Every Friday", "layout": "split-right",
    "modules": ["object-card", "concept-card"], "icon": "wrench", "match": ["tool of the week", "this week's tool"] }
]
```

- **The style.** `segmentErrors` (in `validateStylePack`) checks the shape: at most 12 segments, unique slug ids, a title, an optional kicker and icon, a footage layout other than `insert`, module ids (checked when the module list is passed), and match phrases.
- **The planner.** `stylePromptLines` and the direction prompt (`segments`) list the segments. The model marks a section that is one with `"segment": "<id>"`. `validateDirection` allows `segment` on a section, and with `segments` (the style's) it errors on an unknown id. `story validate` passes the style's segments (`applyProjectStyle` now returns them on `style.segments`).
- **The structure pass** (`options.segments`) reuses them:
  - **Matching.** A map section or chapter without a segment gets one when its title contains the segment's title or a `match` phrase, ignoring case (`matchSegment`). The chapter carries `segment`.
  - **The card.** The chapter's section card takes the segment's kicker (else its title, when the chapter's title differs) and its icon instead of the chapter number.
  - **The layout.** The chapter holds the segment's layout as a `segment-<chapter>` footage section, and its map section's layout matches. A chapter that already has a section, or `stacked` in landscape, keeps its layout with a warning.
  - **The modules.** It warns when none of the segment's modules play in the chapter. The result's `segments` lists `{chapter, segment, card, layout, modules}`.
  - **Idempotence.** It drops its own `segment-*` and `reset-*` sections before planning again.

### Rendering by chapter (`finish --chapter <id>`)

`finish --chapter <id>` builds on the scene-level re-render (`--scene`):

- **Checks.** `iterationOptions` checks the id against `story.chapters`. Without chapters it says to run `story long-form`. It can't be combined with `--scene`, `--preview-scene`, `--prototype` or `--candidate`.
- **Render.** After resolving, `chapterWindow(resolved, id)` gives `{id, title, start, end, frames: [a, b)}`. `renderWithSegments({range})` forces every segment that overlaps that frame range, with or without scenes, and reuses the rest from the cache.
- **Master.** The master is stitched from all the segments as usual (join, delivery encode, soundtrack mux, the same frame-count checks), so the whole video stays deliverable. Render, master, evidence and gates are forced, as with `--scene`.
- **The chapter alone.** The master stage also cuts the chapter from the stitched master to `renders/chapters/<id>.mp4` (adapter `cutChapter`, an accurate re-encode).
- **Report.** `chapter: {id, title, start, end, output, segments: {forced, reused, total}}`.
- **HyperFrames** renders whole videos, so `--chapter` re-renders the whole video there, with a warning.

### Cut-downs (`kit/core/cutdown.mjs`, `launchclip cutdown`)

`launchclip cutdown <project> --to shorts [--section <id>] [--max 58] [--out dir] [--model provider:model] [--force]` writes a new 9:16 project. It re-plans one section of a footage-led long video against the Shorts profile (`short-talking-head`) instead of cropping it.

- **The window.** `chooseCutWindow(map, words, {section, max, min})` picks consecutive map lines in one section (a map section id or its chapter id; every section without `--section`) between `min` (15 s) and `max` (58 s). It scores 2 for opening on a hook, problem, number, claim, turn, quote or proof line, plus the share of visual lines, plus length. The window is padded (0.15 s before, 0.35 s after, never into a neighbouring word) and snapped to frames.
- **What is reused:**
  - **The base edit.** `cutTrim(resolved, start, end)` maps the window through the long form's kept source ranges (its `base.trim` or `base.edl`), and the result becomes the Short's `base.trim`. `fit`, `focus`, `volume` and `subject` carry over, with explicit mattes kept when they overlap.
  - **Mattes and the face track.** These are in source time, so they apply unchanged: `assets/` holds hard links to the long form's assets except `audio/` and `captions/`, which finish makes again. They are hard links, not symlinks, because Remotion copies the public folder into its bundle. A link that fails (another volume) becomes a copy.
  - **Scenes.** A scene comes along when at least 2 s and 60% of it is inside the window, moved to the Short's clock. `mapTime` maps its word anchors: an anchor that lands on the same word stays, a later occurrence is re-counted (`word:<text>#n`), and only an anchor no word reaches becomes seconds. Hits outside the scene drop.
  - **Narration.** `cutWords` writes `NARRATION.json` from 0.
- **What is re-planned:**
  - split layouts become `stacked`; a layout within 1 s of an edge holds to it;
  - the promise, the section cards, the chapters and the progress line stay behind;
  - a scene whose module refuses the 9:16 canvas or its new length is left out with a warning;
  - word captions are added when the long form had none.
- **Hook and loop.** A `hook` concept card (track 1, 0 to 2–3 s) carries the first line's key words (`keyWords`) and the line as its sub-line. If the head leaves no room, the card drops the sub-line, then becomes an insert. `ending.loop_to` is `hook`. The map's first line is the `hook` intent.
- **Density.** Concept cards (`dress-n`) fill the longest undressed run past the profile's `longest_undressed_seconds` p50, and keep filling while coverage is under its p10.
- **The map.** `draftDirectionMap` over the Short, keeping the long form's intents for the same lines, with the profile `short-talking-head`.
- **`--model`.** `planStoryboard` re-plans the section's words with the planner against the same profile (paid). The cut keeps the base edit, and the loop returns to the first scene.
- **Output.** `storyboard.json`, `DIRECTION.json`, `NARRATION.json` and `CUTDOWN.json` (`launchclip.cutdown.v1`). The receipt holds `{source, to, section, window, duration, trim, planner, hook, loop_to, carried, added, profile: {id, status, measures, errors}, warnings}`. The command checks the Short with `checkStoryboard` and the coverage gate, and its status is `ready` when the Short passes the profile. Then run `launchclip finish` on the Short.

### Exports

- **`finish`.** The master stage writes `renders/chapters.txt` (`youtubeChapters`: `0:00 Title` lines for the YouTube description).
  - It muxes the chapters into the delivery MP4 by stream copy (`ffmetadataChapters`, adapter `muxChapters`). The MP4 muxer adds a QuickTime chapter track beside the picture and sound.
  - The report carries `chapters: {file, list, youtube: "ok" | "ignored", problems}`, and `youtubeChapterProblems` warns when YouTube would ignore the list.
  - Prototypes, candidates and previews carry no chapters. The master's input hash includes the chapters only when there are some, so other projects' caches stay valid.
- **NLE exports.** Chapters are timeline markers of kind `chapter`, first at their frame:
  - FCPXML writes `<chapter-marker>`;
  - xmeml writes a `<marker>` named after the chapter;
  - the EDL writes a GREEN `* LOC:`;
  - OTIO writes a GREEN `Marker.2` with `metadata.launchclip.chapter`.

## Catalogue E (`kit/core/catalog-e.mjs`)

Product moments around the presenter
([SUBJECT_EFFECTS_RFC.md](SUBJECT_EFFECTS_RFC.md) §6.1). Emitters live in
`kit/hyperframes/catalog-e.mjs`, components in
`kit/remotion/catalog/CatalogE.tsx` and `registry-e.ts`. Catalogue C's
conventions apply (`createFootageBase`, `at` from the scene start, hits).

| Module | Layer | Needs the subject | Params | Events | Notes |
| --- | --- | --- | --- | --- | --- |
| `feed-frame` | split | yes | `handle`, `caption` ≤ 60, `counts` (supplied strings only), `follow`, `scale` 0.55–0.85, `release`, `at` | `frame`, `chrome`, `release` | Framed base; the hole crops at eye level so the presenter breaks out; `hidesCaptions`, `framesFace`; 9:16 |
| `pull-back` | front | no | `steps` 1–4 (required), `title`, `label`, `scale` 0.3–0.75 (default: fits the steps), `release`, `at` | `pull`, `step-<i>`, `done` | Framed base; steps tick with a filled check, the counter reaches 100% (per-frame text sets); `hidesCaptions`, `framesFace` |
| `backdrop-swap` | behind | yes | `backdrop` media (default a brand gradient), `title`, `scale` 0.6–0.95, `release`, `at` | `swap`, `release` | `subjectCamera` shrinks the presenter about the canvas centre and keeps the frame's bottom edge; the title lifts and fades out in the 0.3 s before `release` (`BACKDROP_TITLE_CLEAR`), so the head never grows over it |
| `app-stage` | behind | yes | `media` (required), `title`, `at` | `stage` | The window runs from the safe top to 70% down the head (at least 45% of the safe zone); needs 320 px above the head |
| `phone-stage` | front | no | `media` (required), `side` auto/left/right, `pan`, `at` | `phone` | A base camera (scale 1.2) pans the room away from the phone; the phone floats |
| `growth-line` | behind | yes | `points` 3–10 `{value, label?}`, `mode` illustration/data, `source` (required for data), `takeoff`, `pill` ≤ 16, `draw` 0.8–3 s, `at` | `draw`, `takeoff`, `pill` | The chart spans the safe width down to 75% of the head (at least 260 px); the line and spike draw by `strokeDashoffset`; dots only fade (scaling an SVG circle pivots differently in GSAP and CSS) |

- **View.** `catalogEView(model)` → `{front, behind, media, overlay}`. The
  emitter's main html is the module's own layer (behind for a behind module,
  else front). A video `media` is appended for the compiler to hoist, with
  `overlay` hoisted one z-index above it; an image stays in the scene layer.
  A split module returns its behind tree as `out.behind`; its Remotion
  component draws the part `model.part` names.
- **Media follows its container.** `mirror()` copies a container's ops onto
  its media and overlay pieces, which share its transform origin in canvas
  coordinates, so a hoisted `<video>` moves with its panel or phone.
- **Framed base.** `framedCamera` springs the base into a window (scale below
  1, toward the window's centre). The hole is a box in the base's own
  coordinates with a huge `box-shadow`, set to the same transform on every
  camera sample (`sampleTime`), so it matches the base exactly in both
  renderers; it fades in over 0.3 s and out over the release.
- `media` params are `{src: assets/ image or video, sourceStart?, fit?}`.
- **Face rule.** The head box follows the base camera (`cameraOps`) at
  every frame, so pans, punch-ins and framed windows move it.

## Character modules (`kit/core/catalog-characters.mjs`)

Animated characters drawn in code ([VIDEO_QUALITY_RFC.md](VIDEO_QUALITY_RFC.md)
§10.5, §6.3). Same view shape as catalogue E (`{front, media, overlay}`); the
HyperFrames emitter and Remotion component are catalogue E's `emitParts` and
`PartsModule`.

| Module | Params | Events | Notes |
| --- | --- | --- | --- |
| `cast-scene` | `set` desk-laptop/phone/meeting/screen/kitchen-counter/sofa/podium/stage/car/park-bench/video-call/standing-desk, `screen` `{src, sourceStart?, fit?}` (required for screen, optional for meeting, refused elsewhere), `cast` 1–3 `{id, position?, pose?, expression?, facing?, cues?: [{at, pose?, expression?}], says?: [{from, to, words?}], holds?: phone}`, `light?` `{dir?, color?, intensity?}` | `<character>-cue-<i>` | Fills the frame and fades in place. Seated sets (desk-laptop, meeting, sofa, car, park-bench, video-call) seat the cast and refuse `walk`; standing sets refuse `sit` (except for a wheelchair user). In `podium` the first character speaks at the lectern; in `car` the first drives; `video-call` gives each character a tile (a row in landscape, a column in portrait) and masks everything outside the tiles. The screen plays the supplied capture (an assets/ image, video or demo-autopilot recording) as media between the room and the cast; there is no screen without one |
| `character-cameo` | `character`, `pose?`, `expression?`, `facing?`, `cues?`, `says?`, `side` left/right, `card?` `{kicker? ≤ 32, title ≤ 64, body? ≤ 140}`, `panel?`, `light?` | `<character>-cue-<i>` | One character beside a card (landscape: a column; portrait: under the card), or alone on a panel. `sit` is refused. Placed in the safe zone narrowed to the brand frame's safe area (`createBase(..., {frameSafe: true})`); `rect?` (guided and bespoke tiers) places it inside that |

### The kit (`kit/core/characters/`)

- `rig.mjs`: rig params `{build, height, age?, skin, hair: {style, color},
  outfit: {top, bottom, over?}, accessories, headwear?, mobility?, colors:
  {top, bottom, shoes, accent}}` (`normalizeRigParams` fixes the key order, so
  equal characters serialise identically; the optional fields appear only
  when set, so older characters keep their identity). The range: 8 builds, 5
  heights, 4 ages (child, teen, adult, senior), 16 skin tones, 26 hair styles,
  17 tops, 5 bottoms, 3 layers (apron, vest, hi-vis), 4 kinds of glasses, 6
  kinds of facial hair, jewellery, ties, scarves, stethoscopes, bags, 14
  headwear (faith headwear among them) and 6 mobility aids (wheelchair, cane,
  white cane, forearm crutch, prosthetic leg or arm). A wheelchair seats the
  character in any set; a cane or crutch keeps its arm at rest
  (`acting.mjs sceneJoints`). body measurements (`rigGeometry`), the named poses
  (`stand point wave slump type think cheer shrug walk sit`) as joint angles,
  and the named expressions (`neutral happy delighted frustrated confused
  surprised focused`) as face parts. Positive arm and leg angles swing a limb
  away from the body on its own side.
- `palette.mjs`: skin tones, hair colours, clothing neutrals and brand roles.
  A colour slot is a palette name, a brand role (`primary accent paper ink
  bg`) or a hex. Roles come from the story brand, overridden by the cast's
  colour mapping.
- `cast.mjs`: the starter cast (24 characters). Ids are stable and never
  change once shipped.
- `generate.mjs`: `generateCast({seed, set, count, palette})` → story cast
  entries, always the same for the same inputs. `CHARACTER_SETS` (office-team,
  startup-founders, family, kids, seniors, students, chefs, medical,
  athletes, creators, city-crowd) fix the wardrobe, age mix and props; the
  seed varies the people (skin tones spread across the range, no two members
  alike). `castFromStyle(pack.cast)` turns a style pack's `{drawing_style,
  set, members}` into `story.cast`.
- `styles.mjs`: the drawing styles (`DRAWING_STYLES`, flat first) and
  `drawCharacter(style, params, colours, options)`, `styleHeight`,
  `styleGeometry`. Every style draws the same rig, poses, expressions and
  part ids, so any cast works in any style and acting.mjs animates them all.
- `toon.mjs`: the toon body shared by the cartoon styles: one builder lays
  out every shape from the rig and hands each to a pen (`shape`, `ellipse`,
  `line`, `limb`, `strand`, `ground`, `within`, `defs?`), which decides how it
  is drawn.
- The nine drawing styles (`DRAWING_STYLES`, in this order):
  | Style | File | Look |
  |---|---|---|
  | `flat` | `style-flat.mjs` | flat fills and a dark outline (the default) |
  | `line` | `style-line.mjs` | single-weight line art: one ink, paper fills, dark hair and clothes inked in |
  | `outlined` | `style-outlined.mjs` | comic ink: a heavy outline and a hard cel shadow away from the key light |
  | `paper` | `style-paper.mjs` | cut paper: hand-cut edges, offset shadows, a fine grain, no outlines |
  | `soft-shade` | `style-soft-shade.mjs` | gradients from the lit side to the shade, no hard outline |
  | `stick` | `style-stick.mjs` | a stick figure: coloured lines, a round head with the character's own hair and face |
  | `stick-classic` | `style-stick.mjs` | the classic black-and-white stick figure: one ink line per limb, a white head, hair and face in line art |
  | `lifelike` | `style-lifelike.mjs` | realistic proportions (`real.mjs`), detailed faces, hair and hands, layered shading (`real-pen.mjs`) |
  | `cinematic` | `style-cinematic.mjs` | lifelike lit by the scene's light: warm highlights, cool shadows, a rim light, falloff and a cast shadow |

  The first five are pens over the toon body; `stick` and the realistic
  pair are their own bodies with the same joints and part ids, and they
  paint the toon hair, headwear and outfit details on a scaled frame, so
  every rig option draws in every style. Each style has a parity fixture
  (`test/fixtures/parity/characters-style-<style>.json`).
- `style-flat.mjs`: the drawing style "flat" (flat fills, a dark outline):
  the toon body with the flat pen. `test/character_styles.test.js` pins its
  output, so flat casts look the same in existing videos.
- `light.mjs`: the key light `{dir, color, intensity}` (`dir` in degrees the
  light comes from: 0 right, 90 above, 180 left; default 125, a soft warm key
  high on the left; or a world's vector `{x, y}` from the light toward the
  subject, as `worldLight` returns it). Shaded styles follow it. `cast-scene` and
  `character-cameo` take `params.light`, else the story's or world's
  `ctx.light`; each actor carries the resolved light as `actors[i].light`.
- `view.mjs`: GSAP animates SVG transforms through the transform attribute
  with its own origin rules, so every joint is a zero-size HTML div (an outer
  div places the pivot, an inner div with the joint's id carries the CSS
  transform about `0px 0px`); runs of shapes become overflow-visible SVGs in
  drawing order.
- `acting.mjs`: one actor's states → ops. A pose change tweens every joint
  over 0.45 s (`power2.inOut`); gestures loop whole cycles while a pose holds
  and end on the pose; breathing, a head sway and blinks run on their own
  groups; expressions crossfade over 0.16 s; mouths open on spoken words (two
  flaps on a long word, a steady rhythm when a range has no word timings).
- `sets.mjs`: the room, furniture and slots for each set (left to right; a
  slot faces the middle of the frame): desk-laptop, phone, meeting, screen,
  kitchen-counter, sofa, podium, stage, car, park-bench, video-call and
  standing-desk.
- `cues.mjs`: story casts, direction-map cues and the consistency check.
- `bounds.mjs`: `drawingBounds(drawing)`, the box a drawing reaches with its
  joints applied. `actorReach(actor)` (catalog-characters.mjs) unions it
  over every pose an actor takes in a scene, each gesture's far swing and a
  held phone, in canvas px, as `content.actors[i].reach`.
- `placement.mjs`: `castPlacement(story, models)`, the cast gate's placement
  findings: a reach off the canvas, or out of the safe zone at the sides or
  top; and two characters who swap sides between consecutive cast scenes
  unless both scenes give them an explicit `position`.

**Placement.** A cast-scene entry's `position` (`left`, `centre` or
`right`; `centre` only with one or three characters) picks its slot; then
the story cast's `position` for that character, where it fits; anyone left
takes the free slots in list order. `facing` defaults to the slot's, which
is inward, so a `point` or `wave` reaches into the frame. Give a couple
story-cast positions and the order of a scene's cast list no longer moves
them.

Part ids for character `i` of scene `S` (`C = S-c<i>`): `C-body`, `C-torso`,
`C-breath`, `C-head`/`C-hb` (head and the hair behind it), `C-headidle`,
`C-arm-l|r`, `C-fore-l|r`, `C-fingerwrap-l|r`, `C-leg-l|r`, `C-shin-l|r`,
`C-face-<expression>`, `C-eyes-<expression>`, `C-mouth-<expression>`,
`C-open-<expression>`.

### Story cast (`story.cast`)

```json
{ "style": "flat", "colors": { "primary": "teal" },
  "characters": [ { "id": "maya", "voice": "af_heart", "position": "left" },
                  { "id": "sam", "from": "theo", "hair": { "style": "curly" } },
                  { "id": "riley", "skin": "deep", "hair": { "style": "locs", "color": "black" } } ] }
```

An id (or `from`) naming a starter starts from its params; the fields given
override them. Other ids need their own skin and hair. When the cast lists
characters, scenes may only use those; without a cast, scenes may use any
starter. `position` (left, centre or right) is the side the character
takes in every cast scene it shares, unless a scene says otherwise. Scenes
name characters by id and never carry params, so a
character cannot change inside a story. `storyCastErrors(cast)` and
`resolveStoryCast(story)` validate it; a style pack's cast mapping reaches
the story through `story.cast` (the style merge fills it).

### Cues and anchors

- Scene params: `cues[].at` and `says[].from/to` are seconds from the scene
  start, or story time anchors (`"word:again"`). `resolveStory`
  (`resolveCastAnchors`) turns anchors into scene seconds and gives each
  spoken range the timing of its words, so mouths move on the voice.
- Narrative direction-map lines (RFC §6.3) carry `cast: [{id, pose?,
  expression?, at?}]` and `set`. `validateCastCues(line, cast)` → error
  strings: unknown characters, poses, expressions or sets, malformed `at`,
  `walk` in a seated set, `sit` in a standing one. `resolveCastCues(line,
  {words})` → `[{id, pose?, expression?, time, word}]`; `at` is
  `"word:<text>[#n]"` (searched in the line's words first), `start`, `end` or
  a word index. `sceneCastCues(map, sceneId, {words, start})` gathers a
  scene's cues as params.
- `castConsistency(story, models)` → findings when a scene's character is
  drawn from different params or colours than the story cast, or differs
  between scenes.

### Dialogue, the cast sheet and the gate

- `audio.narration.lines: [{speaker, text}]` (`src/voice/dialogue.js`): each
  line is synthesised in its speaker's cast voice (`story.cast.characters[].voice`,
  a local Kokoro voice id) or, for `"narrator"`, in `audio.narration.voice`;
  each take is trimmed to its speech (its words, or its sound above -50 dB
  when that runs longer; 0.06 s kept each side) and the takes are joined with
  `audio.narration.gap` seconds (default 0.3, a line's own `gap` wins) from
  the end of one line's speech to the start of the next; every word keeps
  its `speaker` in NARRATION.json, with `lines` and `gaps`. A cast entry's `says: "auto"` resolves to that
  character's own words in the scene. `launchclip voice <project>` voices a
  dialogue story the same way (the same cached per-line takes `finish`
  uses), writes NARRATION.json with `lines` and each word's `speaker`, and
  reports the measured duration with one row per line.
- `node scripts/cast-styles.mjs [--out qa/cast-styles] [--styles …] [--sets …]
  [--seed …] [--set …] [--ids …]` renders one sheet per drawing style: a
  line-up of a cast in poses, face close-ups in expressions, and the cast
  acting in a few sets (frame-pure state from the modules' own op list).
- `launchclip cast sheet <project>` (`src/cast.js`) renders every character
  in every pose and expression the scenes and the direction map use, with the
  modules' own view tree, to `qa/cast-sheet.png` (+ `qa/cast-sheet.json`:
  poses, expressions, voice and fingerprint per character).
- `launchclip finish` runs `castGate(resolved, {direction})` in its validate
  stage and reports `gates.cast`: the story cast is valid, every character
  scene resolves, the direction map's cast cues resolve, each character is
  identical in every scene, every limb and prop stays on the canvas and in
  the safe zone, characters keep their sides between shots, and voices are
  local Kokoro voices. A failure stops finish before rendering;
  `launchclip story validate` reports the same findings (`cast: …`).

### Parity

`test/fixtures/parity/characters-*.json` (every set, both orientations, a
screen with a video and with an image, a cameo with a card) through
`scripts/parity.mjs`.

## World module (`kit/core/catalog-world.mjs`)

Layered environments drawn in code ([SEEDED_STYLES_RFC.md](SEEDED_STYLES_RFC.md)
§3.5, phase 5), from the library in `kit/core/worlds/`. A world scene is a
plate: it fills the frame on track 0, and characters, cards or captions go
on higher tracks over it. Same view shape as the character modules
(`{front}`); the HyperFrames emitter and Remotion component are catalogue
E's `emitParts` and `PartsModule`.

| Module | Params | Events | Notes |
| --- | --- | --- | --- |
| `world` | `kind?` (a world kind; default `story.world.kind`), `time?` day/dusk/night (default `story.world.time`, else day), `props?` ≤ 12 (default `story.world.props`), `camera?` still/drift/pan-left/pan-right/push/pull or `{move, amount 0..1}` (default drift), `detail?` simple/standard/rich (default from `story.cast.style`), `scrim?` auto/top/bottom/left/right/centre/none or `true` (default none) | none | Fades in place like a set (shown on frame 0 when it starts the video). Layout role `decor`. `params.kind` is allowed on world scenes only (story.mjs keeps it reserved elsewhere) |

**story.world** `{kind, time?, props?, detail?}` is the video-wide world:
every world scene without its own `kind`, `time` or `props` takes them from
it. A style pack's `world` reaches the story through `applyStyle`.
`story.mjs` checks the shape (import-free); `storyWorldErrors(world)`
(`kit/core/worlds/index.mjs`) checks kinds, times and props, and a world
scene fails to resolve on an unknown one.

### The library (`kit/core/worlds/`)

- `index.mjs`: `WORLDS`, `WORLD_KINDS`, `WORLD_GROUPS`, `WORLD_TIMES`;
  `renderWorld({id, kind, time, colors, canvas, style?, detail?, props?})` →
  `{layers: {back, mid, front, fx}, defs, anchors, quiet, light, palette,
  props, overscan, detail}`; `worldLight(kind, time)`; `drawProp(…)` for prop
  sheets; `storyWorldErrors`; `worldCatalogue()`.
- 22 worlds in three groups. Inside: office, home-desk, kitchen,
  living-room, classroom, cafe, workshop, server-room, studio, gym. Street:
  city-street, shopfronts, crossing, alley, rooftop, skyline. Outside: park,
  beach, mountains, forest, space, abstract-stage. Each has `geo` (floor or
  ground line, anchors, quiet area), `back`, `mid`, `front` and optional
  `fx`; a world never draws text.
- Layers: back (sky or wall), mid (the room or street), front (foreground
  pieces at the frame edges, keeping the centre open), fx (glows, rays, the
  grade and vignette). Each is a canvas-sized SVG in its own div, drawn 8% of
  the width past both side edges (`OVERSCAN`) so a camera move never shows an
  edge.
- `palette.mjs`: `worldPalette(colors, time, group)` grades neutral
  materials and the brand's primary and accent for the time (day neutral,
  dusk warm and lower, night deep blue; inside worlds at night are lamp-lit
  and grade milder). Emissive colours (lit windows, lamps, neon, screens,
  sun, moon) are never graded. `timeLight(time)`.
- **Light.** `worldLight(kind, time)` → `{dir: {x, y}, color, intensity}`:
  `dir` is a unit vector in screen space (y down) from the light toward the
  subject, matching where the world draws its sun or moon (day: high at the
  upper left; dusk: low at the left; night: moon at the upper right). Worlds
  may override it (the server room is cool, the alley neon pink at night).
  The model carries it as `content.light`; character renderers use it for
  shading and cast shadows.
- `detail.mjs`: the drawing style picks the detail: stick and line →
  simple (flat fills, ink outlines, pale fills, fewer small objects); flat,
  outlined, paper and soft-shade → standard (gradients, shadows, glows, haze,
  light pools); lifelike and cinematic → rich (shading, depth of field on
  the back layer, volumetric rays, vignette; cinematic adds a colour grade).
  Paper lifts each layer on a cut-paper shadow. Blur and shadows are CSS
  filters on the layer divs.
- `pen.mjs`: every shape goes through one pen, which applies the detail
  (outlines, pale fills, gradients collapsing to flat colour) and collects
  gradient defs per layer with scene-unique ids. Attribute names are ones
  both renderers write the same way: no `gradientTransform`, patterns or SVG
  filters.
- `common.mjs`, `furniture.mjs`, `inside.mjs`, `street.mjs`,
  `outside.mjs`: the shared pieces and the worlds.
- `props.mjs`: 96 props (desk and table top, kitchen, floor and ground,
  street, wall and sky). A prop is `{label, on, h, w, draw}`: `on` lists the
  anchors it prefers (surface, counter, ground, floor, wall, sky), `h`/`w`
  its size in metres, drawn at the anchor's px per metre. A placement is an
  id or `{id, at?: left|centre|right|0..1, on?, scale?: 0.25..4, layer?,
  flip?}`; without `at`, props take free slots from the frame edges inward,
  keeping the centre band open. A world without the preferred anchor falls
  back along the list, then to the ground.
- `readable.mjs`: **text over a world.** Every world names a quiet area
  (plain wall, sky, a board or a menu) and the colours under it.
  `scrimFor(world, {text, bg, side})` lays the brand background over that
  area at the opacity that brings the text colour to at least 4.5:1 against
  every colour under it (plus a 0.08 margin, at least 0.18), as a soft CSS
  gradient that is strongest over the area and clear beyond it. The model
  carries it as `content.scrim` (with `on` when `params.scrim` asks) and
  the quiet area as `content.quiet`; put text inside it.
- `fit.mjs`: **the topic fit table** (`TOPIC_FIT`: topic, prompt words,
  the worlds that fit, best first, and the props that dress them) and
  `suggestWorld(prompt)` → `{kind, time, props, topic, worlds}` or null
  (whole-word matching; night and dusk from time words). Art direction
  chooses from a row; the seed varies among its worlds.
- `view.mjs`: the layer divs (`<scene>-back|mid|front|fx`).

**Camera.** `params.camera` moves the back, mid and front layers at the
world camera's depths (`camera-world.mjs` `PARALLAX`: back 0.3 = the
background, front 1 = the plate, mid 0.65), with `sine.inOut` over the whole
scene: a pan travels up to 90% of the overscan on the front layer; a push or
pull scales the front by up to 7% and the back by 0.3 of that. The fx layer
and the scrim stay put. In a world-camera story the plate's own placement
moves on top, so the two compose.

**Anchors and characters.** `content.anchors.ground` `{y, x0, x1, ppm}` is
where people stand (ppm: pixels per metre; a person is about 1.7 m), so a
cast placed over a world can stand on its floor. Street and outside worlds
are seen from further back (0.62 of the inside scale).

### Contact sheets and parity

- `node scripts/world-sheet.mjs [--out qa/worlds] [--portrait] [--style …]
  [--detail …] [--props …] [--scrim]` renders every world at day, dusk and
  night (one PNG per still and `sheet*.png`); `--scrim` marks the quiet area
  with its scrim and sample text.
- `node scripts/prop-sheet.mjs [out.png]` renders every prop at simple,
  standard and rich detail, by day and night.
- `test/fixtures/parity/world-*.json`: landscape and portrait, the three
  detail levels, pan, push, pull, drift and still, and a scrim, through
  `scripts/parity.mjs`.

## Catalogue F (`kit/core/catalog-f.mjs`)

The style-gated creative set around the presenter
([SUBJECT_EFFECTS_RFC.md](SUBJECT_EFFECTS_RFC.md) §6.3). Same view shape as
catalogue E; the HyperFrames emitter and Remotion component are catalogue E's
`emitParts` and `PartsModule`. Each module declares `mood` tags, so the
planner favours it when the art direction asks for that feel, and style
packs can prefer or avoid it.

| Module | Layer | Needs the subject | Params | Events | Notes |
| --- | --- | --- | --- | --- | --- |
| `glass-word` | behind | yes | `word` ≤ 10, `tint` clear/primary/accent, `turn` −35–35°, `sweep`, `at` | `reveal`, `sweep` | Centred on the head. Static CSS perspective on a wrapper; the face is near-clear with bright rims (nothing glows behind the glyphs, since a clear face shows it); the sweep is a clipped band moving one way while its text copy moves the other |
| `proof-wall` | behind (split with a hero) | yes | `items` 3–8 `{text? ≤ 70 + source, image?, source?}` (real; quotes need a source), `hero` `{text ≤ 48, highlight, source}`, `every` 0.05–0.4 s, `at` | `pin`, `hero` | Cards on a jittered grid behind the head; the hero lands in front on the chest; its highlighter is a span round the word (z-index −1 in the card's stacking context), so each renderer's text layout places it |
| `scrapbook` | split | yes | `word` ≤ 8 (one word, number or claim), `sub` ≤ 20, `at` | `slap`, `letter-<i>` | Paper and scribbles behind (three jittered variants take turns every third frame); `subjectStyle` outline and shadow; `subjectCamera` slaps to 1.12 and settles at 0.82; letters on alternating chips above where the head settles, with a marker ring |
| `doodle-outline` | front | yes | `doodles` 0–4 `{icon heart/star/crown/spark/arrow/bulb, side left/right/top, at}` (default a spark and a heart), `color` white/primary/accent, `at` | `trace`, `doodle-<i>` | One path per third frame from the outline, pushed out along the edge normal with seeded wobble, shown until the next; frames during the draw-on keep a static dash offset (stepped draw). Doodles beside the head boil on threes (three variants). `framesFace`. No outline: only the doodles |
| `orbit-cards` | split | yes | `items` 3–6 `{image?, text? ≤ 40}` (real, supplied), `speed` 8–60 °/s, `at` | `orbit` | A tilted ring round the chest, kept above the caption band; each card is drawn in both parts and per-frame sets show it only in the part for its side of the ring (near cards larger) |



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
An `upload` step is logged as a `click` with `step: "upload"`, `file` (the
file's base name) and `via` (`chooser` when the click opened the file chooser,
`input` when the file was set on the input directly, with no click and a null
`box`).
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

## Brand lockup (catalogue B, `kit/core/catalog-b-brand-lockup.mjs`)

`brand-lockup` builds title and end cards from the brand's own artwork instead
of set type. It hides captions, like `hook-title` and `cta`.

```json
{ "module": "brand-lockup", "params": {
  "mark": "assets/brand/mark.png",
  "wordmark": { "src": "assets/brand/wordmark.png", "ratio": 7.56 },
  "tint": "paper", "eyebrow": "Launch analytics", "headline": "Launch analytics for small teams" } }
{ "module": "brand-lockup", "params": { "variant": "end",
  "mark": "assets/brand/mark.png", "wordmark": { "src": "assets/brand/wordmark.png", "ratio": 7.56 }, "tint": "paper",
  "badge": "assets/brand/store-badge.svg", "url": "pulseboard.example" } }
```

- **Variants:**
  - `variant: "title"` (default) puts the mark beside the wordmark (`layout:
    "row"`, the wordmark at 62% of the mark's height) or above it (`"stack"`).
    It takes an optional `eyebrow` (small caps above) and `headline` (display
    type, at most two lines, below).
  - `variant: "end"` stacks the mark over the wordmark, then an optional
    `headline`, a `badge` image (`{src, ratio}`, ratio 3 by default, the shape
    of an app-store badge) and a `url` pill in `brand.colors.primary`.
    `badge` and `url` are end-only.
- **Images:** `mark` (square) and `wordmark` (wide) are `assets/` images; one
  of them is required.
  - Images aren't read at resolve time, so a wordmark's width comes from
    `ratio` (width ÷ height, default 4). `object-fit: contain` keeps a wrong
    ratio from distorting it.
  - The lockup shrinks to 86% of the frame width (62% on the end card) and
    fails with a param error when the mark would drop below 72 px.
- **Tint:** `tint` (wordmark) and `markTint` (mark) recolour every opaque
  pixel and keep its alpha. They take `paper`, `ink`, `primary`, `accent` or a
  `#rrggbb`, so a dark wordmark reads on a dark background. Both renderers draw
  the tint as an SVG `feColorMatrix` filter in the view tree.
- **Motion:** the mark lands first, at 0 s (`at` moves it), and it is the
  hook. The wordmark, eyebrow, headline, badge and URL follow, `stagger` apart
  (0.35 s, scaled by the grammar).
  - A hit on one beat (`hits: [{event: "badge", at: "word:download"}]`) moves
    the default beats after it.
  - Each element fades and rises over 0.6 s, the mark scaling up from 0.6,
    on the grammar's enter ease.
  - The wordmark slides out from behind its left edge.
  - `glow` (`primary` by default, `accent`, or `false`) is a soft light that
    blooms behind the lockup with the mark. It then keeps widening linearly
    until the scene ends, so the card never holds still.
  - `shine` (default `true`) is two soft bands of paper-coloured light,
    screened over the card and faded at both ends:
    - a sweep crosses the whole card as the first beat lands;
    - a glint crosses the mark and wordmark once they have landed (when the
      scene is long enough).

    The sweep makes the opening move at once whatever the brand colours. A
    slow → fast → slow entrance and a soft glow alone stay under the motion
    gate's burst threshold for the first 0.35 s, more so with a dark primary.
    The glint is a second distinct hook event, so an opener with no headline
    passes the hook rule. Measured: a 3.4 s cinematic opener (mark, tinted
    wordmark on a 0.25 s hit, eyebrow, no headline, primary `#1f4a3a`) gives
    bursts at 0.20 s and 1.47 s, and every gate passes.
  - The URL pill gets one ring pulse once it lands.
- **Events:** `mark`, `wordmark`, `eyebrow`, `headline`, `badge`, `url`, `shine`.
- **Compilers:** the catalogue B emitter and `CatalogBModule`
  (`kit/remotion/catalog/BrandLockup.tsx`) draw the same tree and ops.

## Photo scene (catalogue D, `kit/core/catalog-d-photo-scene.mjs`)

`photo-scene` fills the frame with one photo or video clip from `assets/` and
moves it slowly (Ken Burns), with an optional scrim and 1–3 short kinetic text
lines. It keeps captions: the lines sit in the lower safe zone, above the
caption band.

```json
{ "module": "photo-scene", "params": {
  "media": "assets/photos/dawn-ridge.jpg", "move": "push-in", "zoom": 0.1, "focus": { "x": 0.63, "y": 0.5 },
  "lines": [{ "text": "Every launch starts" }, { "text": "with a deadline", "emphasis": true }] } }
```

- **`media`:** an `assets/` image (`.jpg`, `.png`, `.webp`, `.svg`) or video
  (`.mp4`, `.webm`, `.mov`), or `{src, kind?, sourceStart?}`. It is drawn with
  `object-fit: cover`. The photo and scrim bleed 64 px (at 1080) past every
  canvas edge, so a world camera's drift never shows their edge.
- **`move`:** `push-in` (default), `pull-out`, `pan-left`, `pan-right`,
  `pan-up` or `pan-down`, linear over the whole scene. The frame never settles
  still and the canvas stays covered on every frame:
  - a push or pull scales between 1 and `1 + zoom` (default 0.08, range
    0.02–0.25) about the `focus` point (fractions, 0.15–0.85, default the
    centre);
  - a pan travels at scale `1 + zoom`, within 90% of the overscan on that
    side.

  `kenBurnsAt(move, p, {zoom, focus, canvas})` is the pure function behind it.
  One sample per frame becomes a set op on the photo, as with `product-demo`'s
  camera.
- **`lines`:** `[{text ≤ 40, at?, emphasis?}]` or strings, one line each. The
  first line is set larger (96 px preferred, then 72). They rise and fade in
  at `at`, by default 0.35 s and then 0.45 s apart (the gap scales with the
  grammar's stagger), on the grammar's enter ease. `emphasis` colours a line
  `brand.colors.primary`. `align` is `left` (default) or `center`.
- **`scrim`:** a `brand.colors.bg` gradient: `bottom` (the default with lines),
  `left`, `full` (the default when centred) or `none` (the default without
  lines; an error with lines).
- **Ambient:** the module moves on its own, so its `layout.drift` is false and
  the ambient hold drift (`driftEligible`) leaves it alone.
- **Layout:** `role: "text"` with the text block's rect, or `decor` without
  lines.
- **Events:** `enter`, `line-<i>`.
- **Compilers:**
  - For an image, HyperFrames gets one clip that holds the photo and its
    overlay in the scene layer, so it travels with a world camera.
  - A video is root media. The emitter returns `{html: <video>, overlay}`,
    and the story compiler hoists both, the overlay one z-index above, as for
    `product-demo`. Root media stays put under a world camera.
  - Remotion (`kit/remotion/catalog/PhotoScene.tsx`) draws an `<Img>` or an
    `<OffthreadVideo>` trimmed to `sourceStart`, then the overlay, from the
    same tree and ops.

## Icon set (`kit/core/icons.mjs`)

One family of line icons ([VIDEO_QUALITY_RFC.md](VIDEO_QUALITY_RFC.md) §8):
LaunchClip's own 173, drawn as original geometry, plus the Lucide set (ISC,
1,903 icons, `kit/core/icons-lucide.mjs`, vendored by
`node scripts/vendor-lucide.mjs <unpacked lucide-static package>`; see
THIRD_PARTY_NOTICES.md). 1,935 names in all: 141 Lucide names match LaunchClip's own, which keep them.

- Every icon is SVG path data in a 24-unit box (`ICON_BOX`), stroked at
  `ICON_STROKE` (2 units) with round caps and joins, with a 2-unit margin.
  Lucide uses the same grammar, so the two sets mix. The vendor script turns
  Lucide's circles, rects, lines and polygons into path data; the few dots
  Lucide fills are a separate solid layer (`ICON_SOLIDS`).
- When a Lucide name matches one of LaunchClip's own, LaunchClip's drawing
  keeps the name, so every existing name looks as it did. `ICON_SOURCES`
  says which set each name draws from; `ICON_NAMES` lists LaunchClip's first.
- Styles (`ICON_STYLES`): `stroke` (the default) and `duotone`. Duotone lays a
  tint (`tint`, default the icon colour, at `tintOpacity`, default 0.28) under
  the icon's closed shapes (`closedPath(d)`: each run from an absolute `M`
  that ends in `Z`); an icon with no closed shape draws as stroke only.
- Names are stable kebab-case ids (`shield`, `rocket`, `code`, `bolt`,
  `calendar`, `chart-up`, `users`, `lock`, `check`, …). Add icons, never
  rename or remove one. `ICON_NAMES` lists them in contact-sheet order.
- `iconPath(name)` returns the path data and throws on an unknown name with
  close matches; `isIcon(name)` tests one.
- `iconNode(name, {id?, x, y, size, color, stroke?, style?, mode?, tint?,
  tintOpacity?})` returns a view node (an `<svg>` of `<path>`s: the tint, the
  stroke, then any solid dots), so both renderers draw icons through the
  shared view tree. Modules tint icons from brand colours; the stroke is
  in box units, so the weight scales with the size.
- `node scripts/icon-sheet.mjs out.png` renders every icon for a check by eye
  (`--html`, `--color`, `--bg`, `--mode duotone`, `--source launchclip|lucide`,
  `--cols`, `--cell`).
- `icon-grid` (catalogue H) shows 2–12 icons in a stroke, duotone or tiles
  variant.

## Catalogue G (`kit/core/catalog-g.mjs`)

The visual vocabulary ([VIDEO_QUALITY_RFC.md](VIDEO_QUALITY_RFC.md) §8):
cards chosen by intent that draw on the icon set. Module code lives in
`catalog-g-<group>.mjs` beside a shared base, `catalog-g-base.mjs`. Emitters
are in `kit/hyperframes/catalog-g.mjs`; components are in
`kit/remotion/catalog/CatalogG.tsx` and `registry-g.ts`. Catalogue B's
conventions apply: one static view tree (`catalogGView`), one
renderer-neutral op list (`catalogGTimeline`), the root enter and exit, `at`
measured from the scene start, and hits that time events of the same name.
Each module declares `aspects` (`9:16`, `16:9`) and `mood` tags.

A card never shows as an empty box. Beats may fall from the scene start
(`timing.leadIn` is 0), and with no `at` the first beat lands within the
first few frames (0.05–0.25 s, per module). When the first beat comes later
(an explicit `at` or a hit), the root enter starts 0.15 s before it, so the
panel and its first content land together.

### Placement (`createCardBase`)

| Where | When | Surface (default) | Box |
| --- | --- | --- | --- |
| `plate` | motion lanes, or a footage-led scene with `insert: true` | `plate` (no card) | The safe zone above the caption band; content centred and scaled up to fill it |
| `below` / `above` (9:16), `right` / `left` then `below` / `above` (16:9) | a footage-led overlay | `card` (opaque `bg`, `border` edge, radius 32) | The first region clear of the presenter's head (`ctx.subject.head`, else catalogue C's default head) that fits; the card takes its content's height |
| `panel` | `ctx.layout.safe` is set (a footage layout's graphics panel) | `plate` | That panel |
| `rect` | `params.rect` | as above | That rect (at least 360 × 200 px, inside the safe zone) |

- `ctx.frame.safe` (the brand frame's safe area, `brandFrameSafe(story)`, which
  `resolveModule` passes when the story has a `frame`) narrows the safe zone.
  `ctx.insert` is `scene.insert === true` (also set by `resolveModule`).
- `params.surface` (`card` | `plate`) overrides the default surface.
- When nothing fits beside the presenter, resolution fails ("…do not fit
  beside the presenter…; shorten it, or make the scene an insert") instead of
  covering the face.
- Each module measures layout variants, largest first: plates try scales
  1.5–0.68, an explicit rect or a layout panel tries 2–0.68 (the type grows
  until the content fills it, like the editorial `density: "fill"`) and
  overlays try 1–0.68, then a compact variant with the icon or object beside
  the text. Where the content is centred in a region it does not size (a
  plate, a panel or a rect), an icon-row list, a stacked compare and a
  vertical timeline spread their gaps into the room left over (to 90% of the
  region, each gap capped). Vertical timeline steps share one pitch.
- Titles over a list (icon-row, timeline) are paper, or primary when that has
  more contrast, at least 4.5:1 on `bg`; never the muted grey. Measured heights are conservative (catalogue B's
  advance model). The view lays content out in flex columns and rows, so real
  text heights set the spacing identically in both renderers.
- `model.placement` names the region and `model.surface` the surface. Key
  text is at least 44 px at 1080; labels and kickers are at least the meta
  floor (26 px).

### Modules

| Module | For intent | Params | Events (cue) | Notes |
| --- | --- | --- | --- | --- |
| `concept-card` | claim, problem, turn | `text` ≤ 28 (≤ 3 words), `icon`, `sub` ≤ 64, `tone` paper/primary/accent, `at` | `icon` (pop-soft), `word` (whoosh), `sub` | The icon (primary) stacks above the word; in a short room it moves onto a tinted tile left of the text |
| `icon-row` | list, process | `items` 2–5 `{icon, label ≤ 24, at?}`, `title` ≤ 48, `layout` auto/row/list, `stagger` (0.18), `at` | `item-<i>` (pop) | Items pop in order on tinted tiles; `auto` takes a row while the labels fit two lines per cell and the height fits, else a list |
| `section-card` | section starts | `title` ≤ 48, `kicker` ≤ 28 (uppercased), `number` 1–99 or `icon`, `at` | `kicker`, `title` (whoosh) | The number or icon pops and the kicker rises as a primary rule draws out (scaleX), 0.25 s before the title |
| `object-card` | product, claim | `object` (`boat`, `box`, `calendar`, `laptop`, `rocket`, `smartphone`, `chart`, `shield`, `mail`, `trophy`, `lightbulb`, `globe`, `team`, `gift`), `caption` ≤ 48, `label` ≤ 24, `at` | `object` (pop), `caption` | Composed in a 240-unit stage from brand shapes (disc, panel, ground shadow, waves, rays) plus a hero icon and accent icons (`OBJECTS` in `catalog-g-cards.mjs`); the hero bobs while it holds |

| `stat-card` | number | `value` ≤ 12 with a digit (as said: `87%`, `3.2×`, `$1,400`), `label` ≤ 48, `source` ≤ 60 (required), `icon`, `count` (default: when the value starts with a number), `tone`, `at` | `count` (riser), `hit` (impact) | Counts 0.9 s (cubic out) by per-frame text sets, keeping the value's prefix, suffix, decimals and grouping, and lands on the value exactly as written; a pulse on the hit; `Source: …` under the label. In a short room the figure sits left of the label |
| `quote-card` | quote, proof | `quote` ≤ 180, `author` ≤ 40 (required), `role` ≤ 48, `source` ≤ 60, `highlight` (an exact phrase of the quote), `at` | `quote` (whoosh), `author`, `highlight` (tick) | A quote-mark icon, the words, `— Author` in primary and `role · source`. The highlight is a copy of the quote over it, transparent except the phrase on a primary marker, faded in, so both renderers lay out both copies the same way |
| `excerpt` | proof, product | `lines` 1–8 (strings or `{text ≤ 64, highlight}`, verbatim), `type` text/code, `title` ≤ 48, `source` ≤ 60 (required), `highlightAt`, `at` | `lines`, `highlight` (tick) | A window panel; lines slide in in turn; marked lines get a primary bar that sweeps out (scaleX) while the others dim to 45%. Code is monospace with whitespace kept, one line each |
| `compare` | claim | `left` / `right` `{title ≤ 24, items: [≤ 40] 1–4, icon?}`, `mode` before-after/columns, `stagger` (0.16), `at` | `left`, `right` (whoosh) | Two panels side by side when the items fit two lines per column, else stacked. In before-after mode the left side is muted with crosses, an arrow pops, and the right panel has a primary edge and ticks; in columns mode both panels are neutral, with dots |
| `timeline` | process | `steps` 2–6 `{label ≤ 28, detail? ≤ 40, icon?, at?}`, `title` ≤ 48, `direction` auto/vertical/horizontal, `stagger` (0.45), `at` | `step-<i>` (pop-soft) | Numbered or icon nodes pop on their steps; a primary line runs on to each node over the 0.35 s before it lands (scaleX or scaleY of a bar over the track). Vertical by default in 9:16 (box at most 760 px wide), across in 16:9 when the labels fit |

### Variants

Each module has designed variants ([SEEDED_STYLES_RFC.md](SEEDED_STYLES_RFC.md)
§3.2): looks that differ in layout, shape language and entrance, over the same
params, so one storyboard renders in any variant. The first variant is the
module's original look and its default; it renders exactly as before variants
existed.

- `VARIANTS` (`kit/core/catalog-g.mjs`) maps each module to its names, and each
  module definition carries `variants`. `moduleVariants()` in
  `kit/core/modules.mjs` lists every module that has more than one, for the
  style generator.
- The variant comes from a scene's `params.variant`, else the story's
  `variants` (`{"<module>": "<variant>"}`, which a style pack fills), else the
  default. An unknown name fails with the module's list of names:
  `params.variant must be one of stacked, side-icon, banner, marker (the
  concept-card variants); got "sparkly"`.
- A variant that has no room for its own shape (a short overlay, a small rect)
  falls back to the default layout rather than failing; `model.variant` still
  names the one asked for and `content.layout.mode` the one drawn.
- Shapes with text on them use `solidFill` (primary when its best text colour
  reaches the contrast floor, else the panel), and tints behind text use
  `tintBehind` (the strongest tint that keeps 4.5:1), so a variant reads on any
  palette.

| Module | Variants (default first) |
| --- | --- |
| `concept-card` | `stacked` (icon over the word); `side-icon` (a solid icon tile, or a bar with no icon, beside the word, a rule that draws and the sub-line; the tile slides and turns in); `banner` (the word on a brand band with a notched end that wipes in, the icon on a disc over its start); `marker` (a big left-set word, a highlighter band that sweeps under each line, the icon spinning in above) |
| `icon-row` | `tiles` (tinted tiles in a row or a list); `pills` (capsules with the icon on a solid disc, one row when every label fits a line, else a column; they slide in and the discs pop); `orbit` (nodes on a dashed ring around a hub, flying out from its centre, labels outside the ring; in 16:9 the title stands to its left); `list` (numbered rows between rules that draw, the icon at the row end) |
| `section-card` | `centered` (head, kicker, a rule and the title, centred); `split` (a big chapter number or icon, a vertical rule that grows, the kicker and title set left); `tab` (number · kicker on a solid tab that drops in, the title rising line by line over a full-width rule); `frame` (corner brackets that close in on the kicker and title, the number or icon on a disc over the foot) |
| `object-card` | `stage` (the illustration over its caption); `polaroid` (the illustration in a dark photo on a paper print that drops in turning and settles 3° askew, the caption on its strip in ink); `split` (a panel that wipes open, the illustration left, the label and a display-face caption right); `spotlight` (a primary glow that opens behind an illustration dropping in on a bounce, a label pill and a display-face caption) |
| `stat-card` | `giant` (the figure big over its label); `ring` (the figure inside a ring that sweeps, with the count, to the share a percentage states or all the way round; label beside it in 16:9); `bar` (the figure over a bar that fills with the count, set left); `ticker` (a tile per digit, each rolling through its slot of the count, zero-padded, then flipping on the hit; other characters stand between the tiles) |
| `quote-card` | `mark` (a quote mark over the words); `pull` (a primary bar that draws down the left of a larger quote, an initial on a disc in the byline); `bubble` (the quote in a speech bubble that pops from its tail, which points at the byline); `centered` (a big mark that drops in over the quote set in the display face, a rule and the name). In these, a highlight that fits on one line sweeps in on a marker behind the words; a longer one wraps with its marker shown from the start |
| `excerpt` | `window` (a panel, lines sliding in, a marker sweep); `terminal` (a window bar with three dots and the title, line numbers in a gutter, a cursor stepping down to a prompt row as the lines show; marked lines get a primary gutter arrow while the rest dim); `document` (no panel: the lines set large beside a primary rule that draws down, marked lines underlined by a sweep, the source as a footnote under a short rule); `stack` (each line on its own chip, dropping in turned; marked chips get a primary outline and edge bar while the rest dim) |
| `compare` | `panels` (two panels with an arrow between); `split` (two tinted halves, across in 16:9 and over each other in 9:16, sliding in from their sides; a divider draws and a disc with an arrow, or VS in columns mode, pops on the seam); `table` (the two titles over aligned rows, a cross or tick per cell, rules drawing as each pair reveals; the after column tinted); `cards` (a title pill per side over a card per item, dealt in from the sides; the before side dashed and muted, the after side edged in primary; two columns in 16:9, one after the other in 9:16) |
| `timeline` | `rail` (numbered nodes on a line); `milestones` (diamonds that spin in on a centre line that runs on, the labels alternating above and below in 16:9, left and right in 9:16); `cards` (a card per step with a number or icon badge, chevrons between, flipping in); `stairs` (solid blocks that rise a step at a time, growing up with the labels on top in 16:9 and out to the right with the labels inside in 9:16) |

`node scripts/variant-sheet.mjs [--modules …] [--gates]` builds a story per
aspect with a scene per variant, writes a contact sheet of settled stills
(`qa/variants/sheet-9x16.png`, `sheet-16x9.png`) and, with `--gates`, runs
`launchclip layout-check` and `hyperframes lint` and `check` on it (no errors,
no `content_overlap` or `clipped_text`). `node scripts/variant-fixtures.mjs`
writes a parity fixture per non-default variant
(`test/fixtures/parity/g-<module>-<variant>.json`, alternating 9:16 and 16:9).

**Honesty rules.** `stat-card` and `excerpt` refuse a missing source, or a source that is a placeholder (`source`, `TBD`, `n/a`, `example`, `illustrative`, …). `quote-card` refuses a generic attribution (`Anonymous`, `a customer`, `our users`, …) and a highlight that is not in the quote. `excerpt` refuses placeholder text (`lorem ipsum`, `TODO`) and shows lines exactly as supplied.

Phrase rows in `PHRASE_MODULE_TABLE` carry an `intents` list (names from
`DIRECTION_INTENTS` in `kit/core/direction.mjs`), so the intent classifier and
the phrase hints agree. `section-card` has none; it is chosen at section starts.
Parity fixtures: `test/fixtures/parity/g-*.json` (motion lane, both aspects)
and `test/fixtures/parity-footage/g-*.json` (`examples/story/vocabulary`:
overlays and inserts over a recording).

## Catalogue H (`kit/core/catalog-h.mjs`)

The element library: charts, counters, frames and motion titles at the scale
of a UI component kit, every element drawn in both renderers from one view
tree (`catalogHView`) and one renderer-neutral op list (`catalogHTimeline`),
under catalogue B's conventions (root enter and exit, `at` from the scene
start, hits that time events of the same name, frame-pure per-frame text
samples). Module code lives in `catalog-h-<group>.mjs` beside a shared base
(`catalog-h-base.mjs`: variants, palette, number formats, data rows) and view
helpers (`catalog-h-view.mjs`). Emitters are in `kit/hyperframes/catalog-h.mjs`;
components are in `kit/remotion/catalog/CatalogH.tsx` and `registry-h.ts`.

- **Variants.** Every module exports its `VARIANTS` (`VARIANTS[id]` from
  `catalog-h.mjs`, also `MODULES[id].variants`), the default first.
  `params.variant` wins, then the style's choice (`ctx.variants[id]`, from
  `story.variants`, [SEEDED_STYLES_RFC.md](SEEDED_STYLES_RFC.md) §3.2), then
  the first. A variant changes layout, shapes and entrances, never the params;
  an unknown name fails naming the module's variants.
- **Fit before failing.** A layout that does not fit falls back to one that
  does rather than failing a seeded variant: columns turn into rows when their
  labels do not fit their slots (bar-chart, stacked-bar, waterfall).
- **Palette.** Marks use the brand roles; extra series come from
  `seriesColors(colors, n)` (primary, accent, paper, then blends), each at
  least 3:1 on `bg`. Text on a filled shape takes `inkOn` (ink, paper or bg,
  whichever reads best).
- **Number formats** (`numberFormat`, `params.format`): `{style: number |
  currency | percent | unit, currency (USD, EUR, GBP, JPY, AUD, …), unit,
  decimals 0–3, compact (12.4K, 3.1M; whole numbers below 1,000 keep no
  decimals), separator (default true), prefix, suffix}`. Deterministic text,
  no locale lookup, so both renderers show the same characters.
- **Extra op props.** `blur` (px, a CSS blur filter) and `clipT`/`clipR`/
  `clipB`/`clipL` (percent insets of a clip-path; an op that sets one sets all
  four). `cssProps` writes them as the `filter` and `clip-path` strings GSAP
  tweens number by number; `catalogHStyle` applies the same values in
  Remotion. Nothing stays blurred or clipped once a build settles.
- **Data.** Charts take their data from params only, and the planner is told
  to use figures from the brief or assets, never invented ones.

### Charts (`catalog-h-charts.mjs`, `catalog-h-flows.mjs`)

| Module | Variants | Params (beyond title, source, at, format, rect) | Events | Build |
| --- | --- | --- | --- | --- |
| `bar-chart` | columns, bars, lollipop, blocks | `data` 2–10 `{label, value, color?}`, `max`, `tone`, `highlight`, `highlightAt` | build, highlight | Bars grow (scale, or a clip for blocks) with 0.09 s stagger; values ride the bar ends and count; the highlight dims the others |
| `stacked-bar` | columns, bars | `categories` 2–7, `series` 2–5 `{label, values, color?}`, `totals` | build | Each category builds series by series; legend and totals pop |
| `pie-chart` | donut, pie, half | `data` 2–6, `percent`, `center` `{value?, label?}` or false, `highlight` | build, highlight | Slices sweep as one continuous turn (each slice linear over its share of an eased sweep); the centre counts to the total |
| `area-chart` | gradient, line, steps | `labels` 3–16, `series` 1–3 `{values, label?, color?}`, `min`, `max` | build | The plot reveals left to right through a clip; the end value lands |
| `scatter-plot` | dots, bubbles, rings | `points` 3–60 `{x, y, size?, label?, color?}`, `xLabel`, `yLabel`, `x`/`y` `{min, max}`, `trend`, `tone`, `highlight` | build, highlight | Axes draw, points pop in x order, the least-squares line draws, the highlight gets a label chip |
| `radar-chart` | polygon, circles, dots | `axes` 3–8, `series` 1–3, `max` | build | The grid lands, each shape grows from the centre |
| `sparkline` | line, area, bars | `values` 4–60, `label`, `value`, `delta` (or false), `tone` | build | A KPI card: the value counts along the trend, the line reveals, the delta chip pops |
| `progress-ring` | ring, thick, segmented, half | `value`, `max` (100), `label`, `sub`, `tone` | build | The arc draws to the fraction (or segments light) while the centre counts |
| `funnel-chart` | tapered, bars, steps | `stages` 2–6, `rates`, `tone` | build | Stages widen in top to bottom; the step-to-step rate pops between them |
| `waterfall` | bridge, floating | `opening` `{label, value}`, `steps` 1–8 `{label, delta}`, `total` | build | Each step grows from the last level (gains primary, losses accent); bridge draws the connectors |
| `sankey` | ribbons, lines | `flows` 2–14 `{from, to, value}` | build | Nodes in up to four columns (longest path); ribbons as wide as each flow draw column by column |
| `heatmap` | squares, circles, rounded | `rows` 1–10, `columns` 2–14, `values`, `showValues`, `low`, `high`, `tone` | build | Cells pop in a diagonal wave, shaded panel → tone |
| `leaderboard` | bars, rows, cards | `entries` 3–8 `{label, value, detail?, icon?}`, `sort`, `highlight` | build, highlight | Rows slide in from last place to first with rank badges and counting values |
| `map-highlight` | fill, pins, glow | `highlight` 1–8 (country name, alias or ISO numeric code, or `{country, label?, value?, color?}`), `focus` auto/world, `tone` | build, zoom, highlight-&lt;i&gt; | The world (Natural Earth 1:110m, Equal Earth, `kit/core/world-110m.mjs` from `scripts/vendor-world.mjs`) fades in; when the countries' bounds cover little of it, it zooms (up to 8×) to fill the area with them; each country fills in turn with a label pill beside it (above, below, right or left, clear of the others); pins drop, or the fill glows |
| `comparison-table` | grid, striped, cards | `columns` 2–4, `rows` 2–8 `{label, values: true/false/null/string}`, `highlight` | build, highlight | Headers pop, rows land with ticks and crosses, the pick column is outlined |

### Counters (`catalog-h-numbers.mjs`)

Every counter formats with `params.format` and lands exactly on its value;
counting text is precomputed per frame, reels and flaps are tweens.

| Module | Variants | Params (beyond label, sub, at, rect) | Events | Motion |
| --- | --- | --- | --- | --- |
| `odometer` | plain, tiles, mechanical | `value`, `from` (digits zero-pad), `format`, `span`, `tone` | count, landed | Each digit is a reel of 0–9 that rolls forward (lower places turn more, up to three extra turns) and all land together |
| `flip-clock` | classic, brand, light | `values` 2–10 strings (shorter ones right-align), `interval` | flip, flip-&lt;n&gt; | Split-flap cards: on each change the old top half falls (power2.in) and the new bottom half drops onto the hinge (bounce.out); unchanged cards stay |
| `ticker-tape` | band, minimal, led | `items` 3–14 (string or `{label, value?, change?}`), `tag`, `title`, `speed` | roll | Items are laid out at fixed widths, copied to cover the band, and one linear loop slides one strip width per cycle, so the wrap is seamless |
| `slot-roll` | window, inline, stack | `items` 2–10, `final`, `prefix`, `suffix`, `spins`, `span`, `tone` | spin, land | A reel of the items spins `spins` turns and lands with back.out; motion blur fades to 0 by the landing |
| `countdown` | digits, ring, clock | `from`, `to`, `step` (fits the scene), `end`, `tone` | start, zero | Each tick sets the number and punches it in; the ring depletes and the clock's bar drains linearly; `end` replaces zero. The label sits above the count |
| `percent-fill` | liquid, battery, bar | `value`, `max` (100), `format`, `span`, `tone` | fill | Liquid rises in a round flask under a sliding wave; a battery or bar fills; the figure counts and takes the fill's ink when it sits on the fill |

### Boxes and frames (`catalog-h-frames.mjs`, `catalog-h-paper.mjs`, `catalog-h-callouts.mjs`)

Handmade shapes (torn edges, tape ends, starbursts, shields) are static
clip-path polygons. Torn edges come from a seed of the element's own text
(`seeded`, `tornPolygon`), so the same note always tears the same way. Speech
and thought outlines are SVG: a stroked layer under a filled layer of the
same shapes, so a cloud's bumps and a tail read as one outlined shape. Images
are project-local `assets/` paths. Without one, a device frame draws a mock
screen in the brand (nav, cards and a chart, or a phone's card stack) and a
polaroid a brand gradient with an icon, so nothing shows empty.

| Module | Variants | Params (beyond at, rect) | Events | Motion |
| --- | --- | --- | --- | --- |
| `device-frame` | clay, dark, outline | `device` browser/phone/laptop/tablet (default phone in 9:16, browser in 16:9), `image`, `fit`, `title`, `url`, `caption` | show | The device rises and settles (a phone untilts), the screen wipes on top to bottom, mock blocks rise in turn |
| `window-chrome` | mac, minimal, terminal | `lines` 1–8 or `image`, `title`, `stagger`, `caption` | show, line-&lt;i&gt; | Lines rise in turn; terminal lines type on after a `$` prompt (a linear clip wipe at about 28 characters a second) and a block cursor blinks once the last is typed |
| `polaroid` | single, stack, pinned | `image` (or `icon` on a brand gradient), `caption`, `tilt` | show | Drops in with back.out and untilts; the photo develops from dark; stack fans two frames behind; pinned drops a pin |
| `sticker` | die-cut, round, burst | `text` ≤ 24, `icon`, `tone`, `tilt`, `size` | slap | Slaps on from 1.7× and +18° with back.out(2.2), then a shine sweeps across inside its shape |
| `torn-paper` | note, strip, scrap | `text` ≤ 140, `kicker`, `tilt` | show | The sheet lands (its drop shadow follows the torn edge), then the words wipe on |
| `tape-note` | corners, top, sides | `title`, `text`, `icon`, `tone` (tape), `tilt` | show | The note drops, then each strip of tape presses down |
| `badge` | starburst, circle, shield | `text` ≤ 14, `sub`, `icon`, `tone`, `tilt` | stamp | Spins in from −140° and scale 0 with back.out(1.8) |
| `ribbon` | banner, flag, tag | `text` ≤ 32, `tone`, `tilt` | unfurl | Unfurls from its centre (scale and a clip together); banner tails fold out behind |
| `speech-bubble` | rounded, comic, chat | `text` ≤ 120, `type` speech/thought, `tail` bottom-left/bottom-right/left/right, `name` | pop | Pops from its tail point with back.out(1.9); thought clouds trail three puffs toward the tail |
| `tooltip` | dark, light, brand | `text`, `title`, `target` (canvas px) | show | A dot lands on the target with a looping pulse ring; the box rises above it, or below when the rect has no room above |
| `callout-arrow` | curve, straight, sketch | `text`, `target`, `from` (canvas px), `circle`, `tone` | point | The label pops, the shaft draws on, the head flicks, a ring draws round the target; sketch adds an echo stroke and an italic note |

### Motion titles (`catalog-h-text.mjs`)

`motion-title` is a caption-independent title (it hides captions). Its
variants are the 24 named text-animation effects of the HyperFrames
vocabulary (`hyperframes-animation`, `adapters/animate-text.md`), so a seeded
style picks one text entrance for the whole video. Before this, only
kinetic-words' `scale` and `rise` existed outside captions. The effects are
built from their names and descriptions; no upstream spec is vendored.
Lines are wrapped with the conservative advance model; each line is a row of
inline-block word spans (character spans inside them), so the browser lays
out the same DOM in both renderers.

| Unit | Effects | Motion (stagger per unit) |
| --- | --- | --- |
| character (7) | soft-blur-in, per-character-rise, typewriter, bottom-up-letters, top-down-letters, stagger-from-center, stagger-from-edges | 32 ms stagger, compressed to fit 1.4 s; typewriter steps whole letters with no interpolation; bottom-up and top-down rise through a masked row; the stagger effects order by distance from the centre or the edges |
| word (8) | per-word-crossfade, spring-scale-in, shared-axis-y, blur-out-up, kinetic-center-build, short-slide-right, short-slide-down, depth-parallax-words | 110 ms stagger; spring uses elastic.out; blur-out-up fades in, holds, and blurs out upward just before the exit; depth-parallax alternates words from in front of and behind the page |
| line (2) | mask-reveal-up, line-by-line-slide | 140 ms stagger; mask-reveal rises through its row's clip |
| element (7) | micro-scale-fade, shimmer-sweep, fade-through, shared-axis-z, scale-down-fade, focus-blur-resolve, shared-axis-x | The whole block; shimmer-sweep passes a 15% band of a lighter copy across the text (a moving clip-path) |

Params: `text` ≤ 90 (≤ 16 words), `kicker`, `sub`, `highlight` (1–3 whole
words in the tone colour), `align` (center, left), `plate` (a brand-colour
plate), `tone`, `speed` (0.5–2), `at`. Event `title`. The build must end
before the exit; long text fails naming the effect, so lengthen the scene,
shorten the text or raise `speed`.

### Tools

- `scripts/element-samples.mjs`: sample params for every module, plus
  `EXTRA_SAMPLES` (cases beyond one per variant, such as a framed screenshot).
- `node scripts/element-sheet.mjs`: a contact sheet of every variant (the
  frame-pure state Remotion draws), or `--parity qa/parity` for the
  HyperFrames stills of a parity run with their SSIM.
- `node scripts/element-parity.mjs fixtures | run`: writes
  `test/fixtures/parity/h-<module>-<variant>-<portrait|landscape>.json` (every
  variant in portrait, the default in landscape) and renders them with one
  Remotion bundle. The fixtures also run in `LAUNCHCLIP_PARITY=1 node --test
  test/parity.test.js`.
