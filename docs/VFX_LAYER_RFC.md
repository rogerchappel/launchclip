# RFC: VFX and pixel effects

Status: draft, open for review
Date: 2026-11-16
Roadmap entry: "Sparks, hits and pixel effects" ([ROADMAP.md](ROADMAP.md))

> Code and prompt text from other projects are copied only where their licence allows it, with the notice kept. Everything else here is written fresh in our own words. Every source, its licence and what we take from it is listed under Provenance.

Source: `patch-gg/pixelfx` 0.3.1, 244 code-drawn effects in 21 categories, MIT
(Copyright (c) 2026 Patch, Copyright (c) 2026 Hugo Duprez). No images, no
dependencies: every effect is one ES module that draws into two typed arrays.
That makes it the best-fitting outside code we have looked at. It already
thinks in seeds, palettes and time.

## 1. Inventory

**T** = take for the default look (the effect reads as light, motion and
shape, so it survives a re-skin to the style's colours and the smooth
painter). **R** = retro look only (it reads as a game sprite: weapons, props,
monsters, a pixel hero). **S** = skip. `(m)` marks an effect that draws on a
silhouette mask (upstream's actor); we feed it a module's or a cast member's
alpha (phase 8).

| Category | T | R | S |
|---|---|---|---|
| fire (12) | candle, campfire, fireball, flame-pillar, fire-ring (m), meteor, spirit-flame | brazier, torch, fire-breath, flamethrower, fire-tornado | |
| explosions (12) | small-explosion, big-explosion, cartoon-pow, firework-burst, firework-rocket, implosion, plasma-explosion, smoke-bomb | barrel-explosion, dirt-explosion, grenade, nuke | |
| water (12) | splash, ripples, drip, bubbles, rain-splash, wave-crash, whirlpool, water-orb, geyser | fountain, waterfall, water-jet | |
| ice (10) | frost-nova (m), snowflake-burst, ice-shatter, ice-crystal, freeze (m) | ice-spikes, ice-lance, frost-breath, blizzard-vortex, icicle-fall | |
| lightning (11) | charge-up (m), zap-hit, spark-arc, electrified (m), ball-lightning, plasma-ball, lightning-strike, storm-cloud | chain-lightning, tesla-coil, thunderclap | |
| sci-fi (12) | glitch (m), scanner (m), hologram, energy-core, emp-blast, force-field (m), warp-in (m), warp-out (m), teleporter-pad, laser-grid | jetpack, tractor-beam | |
| melee (12) | sword-slash, double-slash, claw-swipe (as strike marks over a word) | dagger-flurry, hammer-smash, heavy-cleave, scythe-reap, spear-sweep, spin-slash, thrust, uppercut, whip-crack | |
| impacts (11) | hit-spark, crit-hit, impact-frame, ground-slam, heavy-landing (m), blunt-hit, parry, shield-block (m), hit-flash (m) | ricochet | bullet-impact (gunfire) |
| projectiles (13) | flare, rocket (a literal launch) | arrow, cannonball, energy-disc, homing-missile, laser-bolt, magic-missile, plasma-shot | bullet-tracer, muzzle-pistol, muzzle-shotgun, muzzle-smg (gunfire) |
| spawn & death (10) | poof, coin-drop, egg-hatch, respawn-beam (m), disintegrate (m), dissolve-burn (m), shatter-death (m), spawn-portal | summon-rise, soul-rise | |
| arcane (12) | portal, rune-circle (a "processing" ring), mana-burst, magic-circle-cast, star-fall, time-stop, arcane-orb, blink-in (m), blink-out (m) | arcane-beam, arcane-missiles, spell-charge | |
| holy (10) | sunburst, halo (m), divine-shield (m), blessing (m), heal-aoe, holy-pillar (a spotlight reveal), feather-burst | smite, resurrection, heal | |
| shadow (12) | black-hole, eclipse, void-orb, dark-explosion | curse, grasping-hands, hex-sigil, life-steal, necro-skulls, shadow-flames, shadow-tendrils, soul-drain | |
| status (13) | confused, sleep, stunned, charmed, rage, haste, slowed, frozen, burning (all m: cast reactions) | cursed, poisoned, petrified | bleeding (gore) |
| nature (13) | healing-bloom, leaf-storm (m), spore-burst, quake, earth-spike, boulder | acid-splash, poison-cloud, root-snare, thorns, tornado, toxic-puddle, vine-whip | |
| weather (12) | aurora, blizzard, cherry-blossoms, clouds, falling-leaves, fireflies, fog, god-rays, rain, shooting-stars, snow, storm | | |
| ui (12) | achievement, coin-collect, combo-counter, confetti, countdown, crit-number, damage-number, exclamation (m), health-bar-hit, heart-lost, level-up (m), quest-complete | | |
| pickups (11) | coin-spin, gem-spin, collect-burst, chest-open, power-star, xp-orb, heart-pickup, key-glint, loot-beam | potion, crystal-shard | |
| transitions (10) | iris, star-iris, slash-wipe, burn-away, glitch-wipe, crt-off, shatter-wipe, blinds, diamond-wipe | pixel-dissolve | |
| critters (12) | butterfly, bird, fish-school (small opt-in decor, bottom right) | bat, frog, ghost, jellyfish, slime, snake, wisp | eyeball, flying-skull (off-brand) |
| moves (12) | | | arrow-shot, dash-strike, earth-stomp, fireball-throw, ground-pound, holy-smite, ice-lance-throw, lightning-call, meteor-call, pistol-shots, rocket-launcher, sword-combo (all need the pixel hero rig) |

Totals: 149 take, 75 retro only, 20 skip. Weapons stay out of the default
catalogue even in the retro pack unless a story asks for them by name.

## 2. Architecture

**Two buffers.** A frame is `{w, h, ox, oy, color: Uint32Array, light:
Uint32Array}`. The painter writes opaque pixels to `color` (fading by a 4×4
Bayer dither, never blending) and adds glow to `light`. `composite(frame,
out, bg, lightK)` turns both into RGBA. Over transparency, light becomes
colour whose alpha is its brightest channel, so it reads as additive over a
dark scene. We keep `composite()` for Node stills. In the renderers we draw
`color` and `light` into two stacked canvases, the light one with
`mix-blend-mode: plus-lighter`: true additive glow over any scene. Both
renderers are Chromium, so the blend is identical.

**Two kinds of effect.** 124 are *pure*: `draw(p, t, o)` from `t` alone,
built on `burst`, `cycle`, `stream` and `fly` (closed-form particles) and
seeded noise. They are frame-pure today. 120 are *simulated*: `create(o)`
returns `{update(dt), draw(p)}` and keeps `Particles`, `Bits`, `Blazes` and
`Lights` from `sim.js` (sparks that bounce off a floor, tumbling shards,
smoke that swells, lights that flare and die). Every random number comes from
`Rng` (mulberry32) seeded by `o.seed`; `Math.random` and `Date` are banned.

**Making the simulated ones frame-pure.** Upstream's `createFx` splits each
caller `dt` into `ceil(dt × 120)` sub-steps of `dt / n`, so the state depends
on the frame rate and on how you got there. We replace it with a fixed-step
driver, `vfxAt(mod, opts, t)`: the state at `t` is exactly `round(t × 120)`
steps of 1/120 s from a fresh `create()`. Cost: one-shots last 0.5–3 s, so
at most 360 steps. At an estimated 5–20 µs a step (100–300 particles), a full
replay is 2–7 ms. A forward cache keeps the last instance per cue (keyed by
effect, options and seed); a later `t` steps forward (4 steps a frame at 30
fps), an earlier `t` rebuilds, the same rule `PARTICLE_RUNTIME` uses for its
bitmaps. Remotion renders each chunk in order, so a seek costs one replay per
chunk. Checkpointing is not worth it: state lives in closures, so snapshots
would mean editing 120 files. Long loops (all of weather) are pure.

*Measured (phase 1, `kit/core/vfx/driver.mjs`, Node 22 on an Apple M4, seed
7, a cold seek to the last frame):* a step costs 0.7–4 µs, not 5–20 µs, and the
longest one-shots run past 3 s: small-explosion (5.4 s, 644 steps) and
smoke-bomb (5 s, 596 steps) leave smoke behind. A full replay still costs at
most 1.8 ms (firework-burst 1.7, smoke-bomb 1.7, small-explosion 1.4,
ground-slam 1.4 ms; the sub-second hits under 0.3 ms). The exception is
impact-frame: its `create()` precomputes eight full-canvas masks, about 40 ms,
once per cache slot, and its steps are free. So the cap on simulated effects is
6 s, not 4 s: the replay is cheap, and the smoke tails are the point. Drawing a
frame forward through the cache costs under 1 ms median (4.6 ms worst, a
ground-slam frame) on a 320 × 180 art canvas. The purity test
(`test/vfx_driver.test.js`) draws five times per effect by 30 fps forward play,
by a cached seek backwards and by an uncached replay, and compares the colour
and light buffers byte for byte.

**One runtime string.** `kit/core/vfx/runtime.mjs` exports `VFX_RUNTIME`, an
IIFE bundle built with the esbuild already in our dev dependencies: the
vendored core (about 100 KB without the actor rig) plus only the effects the
story uses (8.7 KB each on average). It defines `window.lcVfx.paint(colorCtx,
lightCtx, cues, t)`. HyperFrames inlines it and calls it from a proxy tween's
`onUpdate`, as it does for particles. Remotion's new `VfxCanvas.tsx` imports
the same functions and paints in `useLayoutEffect`, as `PaintCanvas.tsx`
does. A test evaluates the string in `vm` and compares its buffers with the
direct import, byte for byte.

**Resolution.** Effects are authored in art pixels: canvases of 96–320 px, a
24 × 38 px stock figure, transitions at 320 × 180. That grid divides 1920 ×
1080 by exactly 6 (and 1080 × 1920 as 180 × 320).

- **`pixel`** (retro): render at art size, `putImageData`, `drawImage` with
  `imageSmoothingEnabled = false` at an integer scale. Cue anchors snap to the
  6 px grid so every effect's pixels line up.
- **`smooth`** (default look): the same sims and the same draw code through a
  `DensePainter` with the same 36-method surface (`line`, `disc`, `ring`,
  `glow`, `beam` …) but a resolution k× finer (k = 3 at 1080p): shapes
  rasterise at sub-pixel accuracy, fades use alpha instead of dither, glow
  uses smooth falloff. About 95 effects also plot single pixels (`px`, `put`,
  `each`, `shade`) for fields like water, fog and fire cores; those come out
  as soft k × k blocks, smoothed by a bilinear upscale and a 1-px blur. This
  is the unproven part. Phase 3 is a spike with a visual bar, and any effect
  that fails it moves to R.

**Palette mapping.** Every effect takes `palette` (a ramp, dark to bright)
plus other ramp options, all resampled with `fit()` to the length it wants.
We build ramps from the style's tokens: `rampOf(colour, bg)` gives 8 steps
from a cool shadow (the colour mixed into `bg`) through the colour to a warm
highlight and white, the same hue-shift rule upstream's `PAL` ramps follow.
A cue's `color` picks the token (`primary`, `accent`, `ink`) or a semantic
ramp (`fire`, `ice`, `gold`, `heal`, `electric` …), which keeps its hue but
is pulled 25% toward the brand's primary in brand-strict styles. The look
and `safeAlpha` keep light off caption text.

## 3. What LaunchClip gets

**a. A VFX layer for any scene.** `scene.vfx` is a list of cues drawn on one
canvas pair above (or, for `back`, below) the module. A cue lands on a beat
(the beat grid in `fluid-motion.mjs`), a time, a word, or a module anchor
(the anchors from the fluid-motion RFC §7: a card landing, a node lighting,
a bar topping out). Core set: hit-spark, crit-hit, impact-frame, ground-slam,
heavy-landing, small-explosion, smoke-bomb, firework-burst, poof, charge-up,
spark-arc, sunburst, holy-pillar, collect-burst, implosion, warp-in. Impact
cues can also trigger the existing `shakeOps` on the module's camera wrapper.

**b. Retro pack.** A look, `pixel-arcade` (`kit/core/looks/pixel-arcade.mjs`):
the whole frame downsampled to the 320 × 180 grid, quantised to a 16-colour
palette from the style, 4×4 ordered dither, nearest upscale, an optional
scanline. A seeded style family, `retro-pixel`, in `style-seed.mjs`: pixel
fonts from our own font set (never upstream's gallery font), chunky borders,
`render: "pixel"`, and the R effects unlocked.

**c. Transitions.** Nine new `TRANSITION_TYPES`: `burn-away`, `slash-wipe`,
`shatter`, `crt-off`, `glitch-wipe`, `blinds`, `diamond-wipe`, `star-iris`,
and `pixel-dissolve` (retro only). Upstream draws them as a dark cover; we
use the cover's alpha as the mask between the outgoing and incoming plates
and draw the light buffer (ember edges, glints, sparks) on top. The lit rim
of upstream's `iris` becomes `{type: "iris", lit: true}` on our existing iris.

**d. Retention hits.** combo-counter, crit-number, damage-number (a "+27%"
delta pop), level-up, achievement, quest-complete, coin-collect, countdown,
exclamation, health-bar-hit (a loss stat), heart-lost, confetti (party
poppers, beside the existing tactile confetti). Upstream bakes words in its
pixel fonts. In `smooth` mode the word is a DOM element in the brand font,
moved by ops (slam, squash, shake), and the VFX draws only bursts, rings and
streaks around it. In `pixel` mode we keep the pixel font. The planner uses
them for hooks, reveals, milestones and the end card, at most one a scene.

**e. Ambient loops.** All twelve weather effects become a background
furniture kind (`BACKGROUND_KINDS += 'weather'`, param `kind: rain | snow |
fog | fireflies | aurora | god-rays …`), tiled across the frame and seeded per
scene. They are pure and seamless, so they also satisfy the ambient layer's
"settled frames never hold still".

**f. Sound pairing.** Each effect gets `sfx` and a `peak` (seconds to its
brightest frame, measured once by a script and stored in the catalogue), so
the light flash and the sound land on the same frame.

| VFX group | SFX family |
|---|---|
| hit-spark, crit-hit, impact-frame, parry, blunt-hit | impact |
| ground-slam, heavy-landing, quake, big-explosion | thud + subdrop |
| small-explosion, cartoon-pow, plasma-explosion | impact |
| firework-*, star-fall, sunburst | riser → sparkle |
| charge-up, spell-charge, mana-burst | riser |
| slash, warp-in/out, rocket, flare, all wipes | whoosh / swipe |
| coin-*, chest-open, loot-beam | cash |
| collect-burst, poof, confetti | pop |
| level-up, achievement, quest-complete | success, chime |
| combo-counter, countdown | tally, tick → ding |
| glitch, glitch-wipe, crt-off | glitch, tape-stop |
| shatter, ice-shatter, frost-nova | snap, shimmer |
| damage-number, health-bar-hit, heart-lost | error-buzz |
| exclamation, slime, frog | boing |
| rain, storm / snow, fog / fireflies / aurora | ambience beds rain / wind / crickets / space-hum |

## 4. Plan schema, names and checks

```jsonc
"vfx": {"render": "smooth", "level": "standard"}  // story: smooth | pixel; off | subtle | standard | lively
"scenes": [{ "id": "s3",
  "vfx": [
    {"effect": "crit-hit", "at": {"anchor": "bar-3"}, "align": "peak",
     "color": "accent", "scale": 1, "seed": 7, "layer": "front", "sfx": "auto"},
    {"effect": "freeze", "at": "beat:4", "mask": "cast:host", "color": "ice"}
  ],
  "in": {"type": "burn-away", "duration": 0.6}
}]
```

`at` is seconds, `"beat:n"`, `{"word": "…"}` or `{"anchor": "…"}`; `align:
"peak"` shifts the start so the effect's peak lands there. `x`/`y` default to
the anchor. `sfx: "auto"` uses the pairing table. Unknown effect names,
retro-only effects outside the retro pack and weapon effects without an
explicit ask fail `validateStory`.

New files: `kit/core/vfx/` (vendored `vendor/core/*`, `vendor/fx/<cat>/*`,
`driver.mjs` for `vfxAt` and the forward cache, `dense-painter.mjs`,
`palette.mjs`, `catalog.mjs` with `VFX_EFFECTS` and peaks, `runtime.mjs`),
`kit/remotion/catalog/VfxCanvas.tsx`, `kit/hyperframes/vfx.mjs`,
`scripts/vfx-sheet.mjs`, `scripts/vfx-peaks.mjs`.

Checks:

- **Purity test:** for every effect, frames at five times drawn by forward
  play and by a cold seek hash the same; the same seed twice gives the same
  bytes; `Math.random`/`Date` are absent (grep and a trapped global).
- **Effect check** (our own, after upstream's checker): draws stay inside the
  canvas, one-shots draw nothing at `duration`, loops have no seam, a frame
  costs under 4 ms at 1080p, simulated effects are 6 s or less.
- **motion-check:** a VFX cue reads as a flash (`pulse`), not an entrance.
  New findings: `vfx-crowd` (more than three hits within 1 s), `vfx-off-beat`
  (peak more than one frame off its beat), `vfx-over-caption` (an impact
  centre inside the caption safe area).
- **Parity fixtures:** one per transition and one per VFX group (about 12)
  in `test/fixtures/parity/`; `parity-coverage.mjs` gains the vfx list.
- **Contact sheet:** `vfx-sheet.mjs` renders every effect at six times, in
  both modes and three style palettes, one PNG per category. Golden hashes
  catch drift; the sheet is also what a human reviews before a batch merges.

## 4a. Built so far (phases 0–2) and where it differs from the plan above

The impact layer works end to end in both renderers. What was built, and the
places the plan changed once it met the code:

- **Vendored:** the core (no actor rig, scenes, acts or `createFx`) and ten
  effects: hit-spark, crit-hit, impact-frame, ground-slam, small-explosion,
  smoke-bomb, firework-burst, poof, sunburst, collect-burst
  (`kit/core/vfx/vendor/`, licence verbatim, a source header on every file).
- **Driver:** `kit/core/vfx/driver.mjs`, measured above. The painter also
  snaps story time to the 1/120 s grid, so float noise in a renderer's clock
  never decides whether a cue has started.
- **One layer per story, not per scene.** The cues of every scene go on one
  colour canvas and one light canvas (`plus-lighter`) over all the scenes and
  the light's over group, under the wipes, the brand frame and the captions.
  `layer: "back"` is not built.
- **Timing uses the story's anchor grammar:** `at` is seconds, `"word:<text>"`
  or `"beat:<n>"`, resolved like `hits`. `{"anchor": …}` (module anchors) waits
  for the fluid-motion anchors. `align` defaults to `"peak"`: impacts land on
  their moment unless a cue asks for `"start"`.
- **Placement:** `x`/`y` are fractions of the frame (default the centre),
  snapped to the art grid: the short side is 180 art pixels (6 px at 1080p).
  `scale`, `mask` and the camera shake are not built.
- **Colour:** `color` names a brand colour or a `#rrggbb`; `rampOf` makes an
  8-step ramp from it (shadows from the background, highlights to white).
  Without one, an effect keeps its own palette. The semantic ramps, the hue
  shift and the brand-strict pull are not built.
- **Peaks** come from the light buffer only (colour as a fallback): counting
  colour put smoke-bomb's peak on its biggest smoke cloud at 2.95 s, not its
  flash at 0.97 s. `scripts/vfx-peaks.mjs` measures; the test keeps them current.
- **Sound:** each cue's paired family (or a named one, or `"none"`) is bound by
  `finish` on the effect's peak, like a hit.
- **Runtime:** `VFX_RUNTIME` is generated into the repo by
  `scripts/vfx-runtime.mjs` (80 KB with all ten effects) rather than bundled
  per story at compile time, because the compiler cannot rely on esbuild at
  run time. Per-story trimming is worth doing once the catalogue grows.
- **Render:** `pixel` only. `smooth` is still phase 3.
- **Checks:** `test/vfx_driver.test.js` (purity), `test/vfx_layer.test.js`
  (catalogue, validation, plan, runtime against the import byte for byte,
  compiled page, sound), story parity on `examples/story/vfx-impacts-9x16`,
  and `scripts/vfx-sheet.mjs` (every effect at six times in three palettes).
  Golden sheet hashes, the effect check and the motion-check findings are
  not built.

## 5. Phases

| # | Step (one PR each) | Effort |
|---|---|---|
| 0 | Vendor core + 10 effects with notices; fixed-step driver; purity test | 2 d |
| 1 | `VFX_RUNTIME` bundle, `VfxCanvas`, HyperFrames inline, `pixel` mode, `scene.vfx` validation, first parity fixture | 3 d |
| 2 | Style palette ramps, peak table, sfx pairing | 2 d |
| 3 | `DensePainter` spike for `smooth`; visual bar; re-sort T/R | 4 d |
| 4 | Nine transitions as masks + light | 3 d |
| 5 | Retention hits with DOM words | 3 d |
| 6 | Weather background kind | 2 d |
| 7 | `pixel-arcade` look + `retro-pixel` style family | 3 d |
| 8 | Mask input: module and cast silhouettes for (m) effects and status | 4 d |
| 9 | Planner catalogue text and cue rules, then the remaining effects in batches of about 20 (contact sheet per batch) | 1 d per batch, 7 batches |

About 33 days in all; phases 0–2 alone give a usable impact layer.

## 6. Provenance

Upstream licence: MIT, `Copyright (c) 2026 Patch` and `Copyright (c) 2026
Hugo Duprez`. Every vendored file keeps a header naming the source, its
licence and its copyright lines, plus any credit it already carries.

| Upstream file | Licence | Action | Notice |
|---|---|---|---|
| `src/core/math.js`, `color.js`, `particles.js`, `shapes.js`, `painter.js`, `font.js` | MIT | copy | pixelfx |
| `src/core/sim.js` | MIT (adapts Sprite Fusion, MIT) | copy | pixelfx + Sprite Fusion |
| `src/core/fx.js` | MIT | port: keep `createFrame`, `composite`, `resolveOptions`; replace `createFx` stepping with `vfxAt` | pixelfx |
| `src/fx/<cat>/_lib.js` (20) | MIT; 19 adapt Sprite Fusion | copy | pixelfx + Sprite Fusion where the header says so |
| `src/fx/<cat>/<name>.js` (224 taken or retro) | MIT; 180 of all 244 carry a Sprite Fusion credit | copy, header kept | pixelfx + Sprite Fusion where credited |
| `src/core/actor.js`, `rig.js`, `poses.js`, `chain.js`, `scene.js` | MIT | skip for now (pixel hero, previews) | pixelfx if ever taken |
| `src/core/act.js` | MIT (adapts Hollow Crown, MIT) | skip; the hit-stop idea is rewritten for the cast | Hollow Crown only if code is ported |
| `src/fx/categories.js`, `docs/AUTHORING.md`, `docs/CATALOG.md` | MIT | rewrite as our catalogue and `docs/VFX_AUTHORING.md` | none |
| `tools/check.mjs`, `sheets.mjs`, `montage.mjs` | MIT | rewrite (ideas only) | none |
| `gallery/fonts/*` | **not MIT** | never copy | n/a |
| `gallery/*`, `tools/*` (other), `.claude-plugin/*` | MIT | skip | n/a |

`THIRD_PARTY_NOTICES.md` gains three entries, each with the full MIT text:

1. **pixelfx** 0.3.1 (MIT), Copyright (c) 2026 Patch, Copyright (c) 2026 Hugo
   Duprez: vendored in `kit/core/vfx/vendor/`, modified (fixed-step driver,
   dense painter hooks).
2. **Sprite Fusion pixel art VFX** (MIT), Copyright (c) 2026 Hugo Duprez:
   adapted by `vendor/core/sim.js` and the effects whose headers say so.
3. **Hollow Crown** (MIT), Copyright (c) 2026 rehan-remade: only if `act.js`
   is ever ported.

`kit/core/vfx/vendor/LICENSE` holds the upstream licence verbatim.
