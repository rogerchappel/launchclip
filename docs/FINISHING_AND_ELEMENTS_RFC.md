# RFC: Finishing, new elements and generated plates

Status: draft, open for review
Date: 2026-11-16
Roadmap entry: "A finishing pass, new looks and new elements" ([ROADMAP.md](ROADMAP.md))

> Code and prompt text from other projects are copied only where their licence allows it, with the notice kept. Everything else here is written fresh in our own words. Every source, its licence and what we take from it is listed under Provenance.

The picture after the scenes are drawn (a shader finish, a grade), the gaps
next to a mature effects catalogue, new elements and looks, travelling
maps, a local plate generator and skill quality. Every item keeps
[FLUID_MOTION_RFC.md](FLUID_MOTION_RFC.md) §2: each value is a function of
the frame and the model, and both renderers draw the same pixels.

## E.1 A shader finishing layer

**What we have.** SVG and CSS only: the medium and the look grade are
`backdrop-filter` stacks (`medium.mjs`, `look.mjs`); light is gradients and
screen blends (`lighting.mjs`, `light-sweep.mjs`, `light-leak.mjs`); grain
is a background kind and the medium's paper tooth; motion blur is an ffmpeg
blend (`src/motion_blur.js`). No threshold bloom, aberration, zoom blur,
film burn, CRT, whole-frame halftone or LUT.

**Why not inside the renderers.** A whole-frame pass needs the composited
frame as a texture. Drawing the DOM into a canvas exists only in Remotion,
behind a Chrome flag (`HtmlInCanvas`), and not in HyperFrames. So the
finish splits in two:

| Kind | Where it runs | Examples |
|---|---|---|
| **Generators**: draw new pixels from `t` alone | in each renderer, as a painter on a WebGL2 canvas inside the plate (the shared painter path: `PaintCanvas` in Remotion, a proxy tween in HyperFrames) | caustics, aurora, plasma, fog backgrounds (E.3) |
| **Finishes**: read the finished frame | one post pass after either renderer, `src/finish_pass.js` | bloom, aberration, zoom blur, burn, CRT, halftone, grain, LUT |

The post pass decodes the master with ffmpeg to raw RGBA, pipes it through
one headless Chrome page running the GLSL chain on a WebGL2 canvas, and
re-encodes. The same code runs after both renderers, so the finish is in
parity by construction (the parity harness keeps comparing pre-pass
renders). It follows the `motion_blur.js` precedent and the GL backend
choice of [WEBGL_SCENES_RFC.md](WEBGL_SCENES_RFC.md) §4.3; generators go in
`WEBGL_MODULES` with the CSS kind as fallback, per its §4.2.

**Uniforms, not state.** Every pass gets `{frame, t, fps, size, seed,
params}` with `frame` absolute, so a partial re-render from the segment
cache gets the same grain and burn as a full one. ffmpeg's `noise` filter
counts frames per input and would seam at segment joins, so grain lives in
the chain.

**Text stays crisp.** A post pass cannot sit under the captions by z-order
as the medium does, so the plan hands it a **protect mask**: the caption
band while a caption shows and the brand frame's rects, feathered 12 px.
Each pass mixes back to the clean pixel inside it.

**The passes (eight)**, in chain order (optical first, film last):

| Pass | Params | Port from | Notes |
|---|---|---|---|
| `bloom` | threshold 0.6–0.9, radius, strength, tint | effectcraft `kernels.wgsl` Glow bright-pass and combine; lemo `core/post/crt.js` down/blur pyramid | 4-level downsample pyramid, 9-tap Gaussian, screen-add |
| `aberration` | px 0.5–4, radial falloff | write fresh | R and B sampled along the radius, G fixed; strength may follow a beat envelope |
| `zoom-blur` | centre, amount, samples ≤ 24 | effectcraft `fx_generate.wgsl` `gen_radial_blur` (zoom branch) | a punch on kicks; `kinetic.mjs` kick times drive `amount` |
| `burn` | seed, threshold, band, colour | effectcraft `fx_pixel2.wgsl` `fp2_burn` (fbm + radial) | a transition-like hit: `threshold` animates over 8–14 frames at a cut |
| `crt` | scan, grille, bleed, curvature, power-on, tracking | lemo `core/post/crt.js` COMP shader (MIT, copy with header) | luma sharp, chroma smeared, red shifted; power-on line; tape tracking seeded by `frame` |
| `halftone` | cell px, angle, ink, paper, mode `dot`/`line` | write fresh; effectcraft `fxs_posterize_bin` for the duotone step | one ink (halftone) or two (duotone through a 2-stop gradient map) |
| `grade` | `.cube` file or preset, strength | effectcraft `fx_lut.wgsl` `fxl_lut_3d` (interpolation) | see E.2 |
| `grain` | amount, size, mono, seed | effectcraft `fx_generate.wgsl` `gen_grain_planes`/`apply` | after the grade, so grain is not graded; luma-weighted |

Built (phase 1): `src/finish_pass.js` with `aberration`, `grade` and
`grain`, and the protect mask. Frames come back from the page over a
WebSocket: Chrome uploads an 8 MB fetch body about 8× slower. Measured on an
M4 at 1080×1920: about 4 s to start, then about 86 ms a frame for three
passes. The shaders are written fresh. Contract:
[KIT_CONTRACTS.md](KIT_CONTRACTS.md), "Finish passes".

Built (phase 2): `bloom`, `zoom-blur`, `burn`, `crt` and `halftone`, also
written fresh (no code copied from the sources listed under Provenance).
Bloom's pyramid is the mip chain of a bright-pass texture. `zoom-blur` and
`burn` take hit times (`at`: seconds, or `"cuts"`); driving `zoom-blur`
from `kinetic.mjs` kicks is not wired yet. Halftone's two-ink mode is
`duotone` (`accent` to `paper`, dots in `ink`).

WGSL to GLSL is mechanical (compute entry points become fragment shaders).
We take the maths and constants, not the compatibility plumbing (`P.u`/`P.f`
slots, premultiply round trips). `story.finish = [{pass, ...params}]`, at
most eight, validated like `story.medium`. Cost is the main risk (a guess:
a few ms a frame on a GPU, 4–8× on `swangle`, plus a decode and encode);
measure on the 1080×1920 fixture before promising numbers.

## E.2 Colour grade and `.cube` LUTs

The grade is the last colour step before grain. Two implementations, one
behaviour:

- **GL path** (any GLSL pass present): parse the `.cube` in JS, upload it as
  a 33³ RGB 3D texture, sample in the chain.
- **Grade only**: ffmpeg `lut3d=file=…:interp=tetrahedral` in the final
  encode, so a graded video costs no extra decode.

A test renders a colour chart through both and requires ΔE2000 < 1.

**Presets are generated, not shipped.** `kit/core/grade.mjs` writes 33³
cubes from a few OKLCH operations (lift/gamma/gain per channel, split tone,
saturation by luma, a soft shoulder), so no third-party LUT enters the repo
and a preset can be re-tinted to the brand. A user's own `.cube` is accepted
by path. `strength` mixes with identity.

| Preset | Character | Default for |
|---|---|---|
| `clean` | identity with a soft shoulder | editorial, documentary |
| `warm-film` | lifted blacks, warm highlights, −8 % sat in shadows | paper, watercolour, clay |
| `teal-amber` | split tone, skin-safe midtones | cinematic, footage-heavy |
| `cool-tech` | cool shadows, neutral highlights | hologram, ascii-terminal, blueprint |
| `neon-crush` | deep blacks, saturated accents | neon-night |
| `bleach` | −35 % sat, +contrast | dark documentary |
| `ink-mono` | luminance only, paper-tinted | one-bit, pen plotter |

Built (grade only): `story.grade` (or a style pack's `grade`) is `"off"`, a
preset name, or `{preset | cube, strength}`; `launchclip finish` grades the
render with ffmpeg `lut3d` (`src/grade.js`) before the caption legibility
pass, so captions are measured on the graded frames, and warns when the
grade pushes a brand colour pair under 4.5:1. The seeded style generator
(`style-seed.mjs`) sets the look's preset, else the tone's. With another
`story.finish` pass, the grade runs in the GL chain (a `{pass: "grade", …}`
entry, else `story.grade`), truncated to 8 bits as `lut3d` is; the chart test
holds ΔE2000 under 1. `tint` (`"brand"` or `#rrggbb`) re-tints a preset's
split tone.

## E.3 Gap checklist against a mature preset library

Effectcraft ships 23 background, 22 behaviour and 22 transition presets
(MIT OR Apache-2.0, written from scratch). Our equivalents and what to add:

**Backgrounds** (ours: 17 `BACKGROUND_KINDS`). Already covered: Soft
Gradient Drift, Dawn Sky, Grainy Wash (`mesh`, `gradient`,
`grain-gradient`), Spotlight Floor (light `pool` + `vignette`), Blueprint
Grid and Scrolling Stripes (`blueprint` look, `motif`, `stripes`).

| Theirs | Add |
|---|---|
| Checker Scroll, Blueprint Grid lines | `checker` and `grid` options on `motif` (CSS) |
| Pulse Rings | `rings`, emitted on beats (CSS) |
| Bokeh Drift | `bokeh`, reusing light-sweep's discs (CSS) |
| Sweeping Light | a `sweep` param on `light-rays` (CSS) |
| Aurora Veil | `aurora`: fbm ribbons (GL) |
| Slow Fog, Cloud Bank, Dark Smoke, Ember Haze | `fog` with variants `fog`/`cloud`/`smoke`/`ember` (GL) |
| Magma, Ice, Pastel Plasma, Mirrored Silk | `plasma`: fbm through a brand gradient map; `silk` mirrors (GL) |
| Cell Drift, Crystal Facets, Hex Mosaic | `cells`: Worley, variants `cells`/`facets`/`hex` (GL) |
| Water Caustics | `caustics` (GL) |

**Behaviours (idle motions).** Ours: idle bob and tilt
(`fluid-motion.mjs`), impact shake, kinetic drift; these cover Float, Sway
and Shake. Add, each a closed-form `loop` op on the `-idle` wrapper scaled
by `IDLE_SCALE`: `wiggle` (seeded smooth noise) and `jitter` (stepped);
`orbit` and `lissajous` (figure eight); `drift {angle}` clamped to the safe
zone; `pendulum` (about the top edge) and `wobble` (damped skew after
arrival); `spin` (icons only); `pulse` and `heartbeat` on the beat grid
(breathe is a slow pulse); `squash` on landing (a bounce belongs to
`physics.mjs`); `flicker` (seeded, for neon) and `fade-pulse`. No strobe
(seizure risk).

**Transitions** (ours: 20 `TRANSITION_TYPES`). Covered: Fade, Line Sweep
(`glow-wipe`), Lens Pop (`iris`). Add, all `clip-path` or CSS transforms on
the existing plate layers: `wipe {angle, feather}` (their four directional
wipes and diagonal sweep; today only `glow-wipe` and before-after's wipe);
`clock-wipe {start, segments}` (Clock Reveal, Clock Wipe Out; segments > 1
is Fan Open); `blinds {count, axis}` (Blinds, Slats); `pixel-dissolve
{cell}` with a seeded block order (Pixel Dissolve, Mosaic Fade); `card-flip`
(CSS 3D rotateY). Grid Doors and Jaws: later, low value.

Their text animator list also has **Scramble**, which our 24 text effects
lack (E.6).

## E.4 New looks

Our looks are blueprint, hologram, thermal, neon-night, paper-cutout,
watercolour, anime-cel, ascii-terminal, clay-2d and isometric-layers. Each
new look is a look file (`kit/core/looks/`) with presets, an SVG grade and
furniture, so it needs no GL; the two marked GL wait for E.1.

| Look | Technique (rewritten from the reference demos) | Build |
|---|---|---|
| `risograph` | 2–3 spot inks; colours are ink densities per plate; overprint multiplies; each plate offset 1–3 px, jumping to a new seeded offset on beats, static between; paper tooth; knocked-out halo around the cast | SVG: per-plate `feColorMatrix` → `feOffset` (stepped var) → multiply |
| `one-bit` | ordered dither through an 8×8 Bayer matrix on luma, two inks; stills may use error diffusion, motion must not (it crawls) | SVG: Bayer tile as `feImage`, add to luma, `feComponentTransfer` discrete |
| `pen-plotter` | every stroke drawn in plot order at a trapezoidal pen speed, pen-up travel between strokes, pen changes at a rack | furniture (pen holder) + a draw mode that orders all `strokeDashoffset` ops by path and gives each a time from the kinematics |
| `lidar` | dark ground, points coloured by height, a scan plane sweeps and reveals returns that glow then settle | painter (points), furniture (scan line label) |
| `stained-glass` | cells bounded by thick lead lines, backlit glass with streaks and bubbles, bloom eating into the lead | GL: edge detect + Voronoi lead + `bloom` (E.1) |
| `silkscreen` | ≤ 6 flat inks, halftone in the mid-tones, slight registration | `halftone` pass + posterize (GL) |

Two techniques are not looks: a **transit map** (octilinear lines drawn by
pen tips, stations lit as the line arrives) is a variant of E.5, and
**text-flash cuts** (full-frame title cards on beats, colour inversion) is a
sequence pattern for the planner, not a treatment.

## E.5 Maps that travel

`map-highlight` (`catalog-h-map.mjs`) zooms once, fills countries one by one
and draws a dashed route as each pin lands. Three additions turn it into a
journey:

1. **A glowing route head.** The last 3 % of the drawn length is two extra
   masked copies of the route: a white core (≈ 4.5 px) over a wide soft glow
   (≈ 16 px). Both are a dash window moved with `strokeDashoffset`, an op
   both renderers already play. The head fades out over 0.5 s once the route
   completes. No dark casing: the bright core reads over every fill.
2. **Per-country arrival timing.** Each highlighted country gets
   `stop(c)`, the route's normalised arc length nearest its centroid, and
   triggers at `routeStart + stop(c) · (routeEnd − routeStart)`. It then runs
   a fixed sequence: border draws (constant 1.2–2.5 s, `pathLength = 1`), fill
   blooms (opacity to 1.25× then settles; elements may overshoot, the camera
   may not), label rises. Durations are constant, never a slice of the
   reveal, so a long border never flashes by. The scene's length is derived:
   `max(trigger + sequence) + tail`, which `timing_fit` reads.
3. **A whole-map camera.** `params.camera = [{at, centre: [lon, lat],
   zoom}]` or `"follow"` (the centre tracks the route head with the
   `SAMPLE_LEAD` look-ahead from `camera-world.mjs`). The map is drawn once
   as a vector plate at the largest zoom and moved by one transform, with
   pins and labels projected through the same transform; stroke widths stay
   divided by `k` as today. Eases are slow → fast → slow, no overshoot, motion
   blur only at peak speed.

Params: `route: {head: true}`, `highlight: [{country, arrive: 'route'}]`.
Raster tile maps stay out of scope: tile renderers shimmer when their own
camera moves each frame, which is why the move is a transform of a still
plate.

## E.6 New elements

Each is a catalogue H module (or a param on one) returning a view tree and
ops; none needs a new runtime.

- **`word-architecture`**: words take structural roles and build what the
  last line stands on. `{lines: [{text, roles: {WAIT: 'lintel', VOICE:
  'support', ROOM: 'opening', WAITING: 'load', FLOOR: 'platform'}}]}`. A
  lintel spans two supports, a support turns upright, a load hangs with a
  seeded sag, an opening spreads its letters, a platform flattens under the
  final line, which the layout check proves rests on it.
- **`proof-mechanism`**: a computation shown by a machine, its values
  computed by the module so the frame cannot lie. `{steps: [{say, show:
  'wheels' | 'belt' | 'remainder' | 'stamp', op: 'product' | 'add' | 'mod' |
  'factor', of: [...]}]}`: odometer wheels, a belt carrying the running
  product, remainder dials, a verdict stamp.
- **Persistent chrome.** `brand-frame.mjs` has section labels, progress,
  scrubber and counter. Add `frame.figure` (a top-left "FIG. 03" label and a
  top-right count, per scene) and a `player-bar` overlay `{thumb, title,
  sub, controls, progress: 'story'}` kept across scenes by `carry`.
- **Glyph scramble.** A `scramble` character effect in `TEXT_EFFECTS`: each
  character shows a glyph from `charset` (`latin`, `hex`, `binary`; only
  glyphs the bundled fonts cover) chosen by `hash(id, i, floor(frame /
  cycle))`, locking left to right with `stagger`.
- **Three inks.** `story.inks: [{ground, line, accent} ×3]` and an ink index
  per scene; the same geometry redraws in the current ink and each accent
  becomes the next ground. An `ink-promote` transition keeps the line and
  swaps the ground. The pencil ink offsets resampled paths by sines whose
  phase steps 8 times a second (the medium's boil rule), stroked twice.
- **Through-line morph.** `{morph: {id, states: [{scene, rect, radius,
  fill}]}, loop: true}`: one object that never cuts, tweening size, radius
  and fill on a tight spring with a tiny overshoot while contents swap under
  a short blur; with `loop` the last state is the first.
- **Seeded flow-field backdrop.** Background kind `flow-field {seed, lines:
  80–400, scale, octaves, speed}`. Integrating particles frame to frame is
  state, so streamlines are integrated once at plan time through a seeded
  noise field and animated as `strokeDashoffset` loops: SVG, no GL. Same
  seed, same art.
- **Lottie import.** Module `lottie {src, fit, from?, to?, speed, loop}`.
  One painter in both renderers drives the light build of lottie-web (MIT;
  SVG, no expressions, so no `eval`) with `goToAndStop(f, true)`, `f = (t ·
  speed · fr) mod range`, holding the frame until `DOMLoaded`. Not
  `@remotion/lottie`, so there is one code path. `src` must be project-local
  JSON, ≤ 5 MB, images embedded.

## E.7 A ComfyUI provider for plates and drafts

[GENERATED_FOOTAGE_RFC.md](GENERATED_FOOTAGE_RFC.md) §5 defines the adapter
and names "local" as provider class 2. ComfyUI is that class's first
adapter. It is GPL-3.0, so we speak only its HTTP and WebSocket API and copy
nothing.

| Adapter call | ComfyUI |
|---|---|
| health | `GET /system_stats` (device type, memory), `GET /object_info` (every node class a template needs exists) |
| `quote(brief, tier)` | no network: `seconds = steps × s_per_step(template, device, size)` from a table measured on fixtures; `cost: 0` |
| `submit` | `POST /upload/image` (start frame, references; `overwrite: false`), then `POST /prompt {prompt, client_id}` → `prompt_id` |
| `poll` | `WS /ws?clientId=…`: `progress` gives `{value, max}`, `executing` with `node: null` for our `prompt_id` means done, `execution_error` fails; falls back to `GET /history/{id}` |
| `fetch` | `GET /history/{id}` outputs → `GET /view?filename&subfolder&type`, written to the ledger path |
| cancel | `POST /interrupt` |

**Templates** are API-format workflow JSON in `templates/comfy/`, built from
core nodes only, with the brief's fields bound to named inputs:

| Template | Model | Licence | Apple Silicon (MPS) |
|---|---|---|---|
| `plate-sdxl` | SDXL base 1.0 | CreativeML Open RAIL++-M (use limits) | good: ~30–60 s a 1024² image |
| `plate-flux-schnell` | FLUX.1 schnell | Apache-2.0 | workable with a quantised checkpoint; 4 steps |
| `draft-wan-5b` | Wan 2.2 TI2V-5B | Apache-2.0 | draft tier only: 480p, minutes per second of video |
| `draft-wan-i2v` | Wan 2.1/2.2 I2V 14B | Apache-2.0 | needs ≥ 64 GB unified memory; final tier on a big Mac or a GPU host |
| `draft-ltx` | LTX-Video (distilled) | LTXV open-weights licence | fastest local video draft; check terms |
| `upscale` | Real-ESRGAN | BSD-3-Clause | good |

Not offered by default: FLUX.1 dev (non-commercial), HunyuanVideo (licence
excludes some territories), SD 3.5 (revenue-capped). The adapter keeps a
licence allowlist; a template whose model is off it needs
`--allow-model-licence <id>`, and the licence id goes into `HANDIN.json`
`source.licence`. All rows are to be re-verified when the template lands.

**Safety.** The host must be loopback (`127.0.0.1`, `::1`, `localhost`); any
other host is refused unless the user passes it explicitly, and then only
for that run. LaunchClip never installs custom nodes, never runs a workflow
it did not template (custom nodes run arbitrary Python), pins model files by
hash, takes output filenames only from `/history`, caps download size and
job time, and sends nothing but the brief's text and the frames it renders.

**Shipped (phase 8).** `launchclip make --asset-provider comfy`
(`src/comfy/asset_provider.js`) answers the planner's shot requests on the
base shared with the SFX adapter (`src/comfy/`: loopback client and health,
templates with a licence allowlist, a cache keyed by the bound workflow, a
ledger line per generation in `qa/generation-log.jsonl`). Setup is in
`docs/guide/comfyui.md`. Stills come from `plate-flux-schnell` (default) or
`plate-sdxl` (`--comfy-plate`), video from `draft-wan-5b` (text to video,
about 480p, 4n + 1 frames at 24 fps, at most 121). Any failure is "no shot",
so the scene is drawn in code. Templates live in `src/comfy/templates/`.
Differences from the plan above, all open:

- **The asset-provider hook, not the generation adapter.** There is no
  `quote`/`submit`/`poll`/`fetch` adapter yet (the generation RFC's phase 2
  is not built), so ComfyUI answers `findShot` directly. Its cost is 0 and
  its time is in the ledger; the seconds-per-step quote table needs runs on
  real machines first.
- **Text only.** Nothing is uploaded: no start frame, no references, so no
  `/upload/image`. `draft-wan-i2v`, `draft-ltx` (its licence is off the
  allowlist) and `upscale` are not shipped.
- **Polling, not the socket.** `/history` is polled; `/ws` progress is open.
- **No hash pin.** The API exposes model file names, not hashes; health
  checks that each file a template needs is listed by its loader.
- **Not yet run on a real server**: tests use a fake ComfyUI API.

## E.8 Skill quality

- **The description is over the limit.** The built
  `launchclip-create-video-remotion` description
  (`skills-src/renderers/remotion/intro.md`) is 1050 characters; the spec
  allows 1024. Cut it to ≤ 900 (the clause about the metered pipeline and
  plugin skills fits in one short line) and add to `test/skills.test.js` a
  check over every `skills/*/SKILL.md`: description ≤ 1024, no angle
  brackets, `name` equals the folder. The test checks routing text only
  today, so nothing caught it.
- **Trigger evals.** `test/skill-triggers/<skill>.json`, about 20 queries:
  8–10 that should trigger, in varied phrasing, and 8–10 near misses that
  share words but need something else ("make it in HyperFrames" for the
  Remotion skill, "trim my Premiere timeline", "only a character sheet").
  `scripts/skill-trigger-eval.mjs` runs each query three times through the
  agent CLI, splits 60/40 train and held-out, and reports trigger rates. Run
  on description changes, not in CI; a change must not lower the held-out
  score.
- **A blind A/B comparator.** `production_critic.js` scores one render. Add
  a pairwise mode: two renders of one brief labelled A and B in a recorded
  seeded order, judged on the same rubric, run again with labels swapped; a
  win counts only when both runs agree (removing position bias). Uses:
  picking between repair candidates, and regression-testing the critic on
  pairs a person has ranked.

## E.9 Phases, effort, tests

| Phase | Scope | Effort |
|---|---|---|
| 0 | Description fix, length test, trigger eval sets | S |
| 1 | `finish_pass.js`, protect mask, `grade` + generated presets, `grain`, `aberration` | M |
| 2 | `bloom`, `zoom-blur`, `burn`, `crt`, `halftone` | M |
| 3 | CSS transitions, behaviours, CSS backgrounds (E.3) | M |
| 4 | Maps that travel | M |
| 5 | Scramble, chrome, flow-field (S–M); Lottie, morph, three inks (M); word-architecture, proof-mechanism (L) | L |
| 6 | Looks: risograph, one-bit, pen-plotter (SVG); lidar; stained-glass and silkscreen after phase 2 | M |
| 7 | GL generators (aurora, fog, plasma, cells, caustics) | M |
| 8 | ComfyUI adapter and templates (shipped: plates and Wan drafts) | L |

Tests: **seek purity** (frame N alone equals frame N in sequence) for every
new pass, kind, effect and module; **parity** (`parity.test.js`, SSIM ≥
0.97) for modules, transitions, looks and generators; a **segment seam**
check for grain and burn; the **protect mask** leaves caption pixels
unchanged; **LUT agreement** (above) and `strength: 0` is identity;
**maps**: arrival order follows arc length, border durations are constant,
the camera never overshoots; **Lottie** stills at frames 0, mid and last,
and rejection of expressions and external images; **ComfyUI** against a
recorded fake server (no model in CI), refusing non-loopback hosts and
failing health on a missing node class; the **skill length** test.

## E.10 Provenance

| Item | Source path | Licence | Use |
|---|---|---|---|
| Glow bright-pass/combine | effectcraft `crates/gpu/src/shaders/kernels.wgsl` | MIT OR Apache-2.0 | port |
| Zoom blur | effectcraft `shaders/fx_generate.wgsl` `gen_radial_blur` | MIT OR Apache-2.0 | port |
| Grain | effectcraft `shaders/fx_generate.wgsl` `gen_grain_*` | MIT OR Apache-2.0 | port |
| Film burn | effectcraft `shaders/fx_pixel2.wgsl` `fp2_burn` | MIT OR Apache-2.0 | port |
| LUT interpolation | effectcraft `shaders/fx_lut.wgsl` | MIT OR Apache-2.0 | port |
| Caustics | effectcraft `shaders/fx_sim.wgsl` `fxm_caustics` | MIT OR Apache-2.0 | port |
| Worley cells, fbm | effectcraft `shaders/fx_generate.wgsl`, `fx_stylize.wgsl` | MIT OR Apache-2.0 | port |
| Preset name lists (gap table) | effectcraft `crates/engine/presets/*.json` | MIT OR Apache-2.0 | rewrite (no values taken) |
| CRT/tape shader | lemo-opuscar `core/post/crt.js` | MIT (code) | copy, with header |
| Bloom pyramid, DoF order | lemo-opuscar `core/three/post.js` | MIT (code) | port |
| Bayer 8×8 matrix | lemo-opuscar `styles/one-bit-dither/demo/pipe.js` | MIT (code); the matrix is standard | copy |
| Risograph, plotter, LiDAR, stained-glass, transit, text-flash ideas | lemo-opuscar `styles/*/demo/*.js` comments | MIT code, NC docs | rewrite |
| Effect taxonomy, overlay vs transition | remotion-skills `skills/remotion-markup/effects.md`, `transitions.md`, `color-correction.md`, `html-in-canvas.md`, `lottie.md` | none | rewrite |
| Route head, arrival timing, still map plate | remotion-skills `remotion-maps/techniques/maptiler/references/map-explainer-architecture.md`, `render-stability.md` | none | rewrite |
| Word architecture, proof mechanism, corner chrome, three inks, player bar, one-shape morph | awesome-opus `data/videos.json` (gdgtify-929495, -130294, -393073, heyiamnick-119558, brainextends-606193, thegrootdev-966114) | prompt text | rewrite |
| Seeded generative workflow | anthropic-skills `skills/algorithmic-art/SKILL.md` | Apache-2.0 | rewrite |
| Trigger evals, blind comparator, 1024 limit | anthropic-skills `skills/skill-creator/` (`SKILL.md`, `agents/comparator.md`, `scripts/run_eval.py`, `scripts/quick_validate.py`) | Apache-2.0 | port (to JS) |
| ComfyUI routes and WS messages | comfy `server.py`, `execution.py`, `script_examples/websockets_api_example.py` | GPL-3.0 | API only, no code |
| lottie-web light build | npm `lottie-web` | MIT | dependency |
