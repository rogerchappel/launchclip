# Scene looks

A **look** is one treatment applied to the world, the cast and the cards
together, selectable per video: `"look": "hologram"` in a style pack or a
storyboard. This note says how a look is carried by the parts the kit already
has, so it is not a second styling system.

## What already exists

| Part | Where | What a look uses it for |
|---|---|---|
| Palette | `brand.colors` (five roles) | The look's own colours |
| Character drawing style | `cast.style` (`kit/core/characters/styles.mjs`) | Which pen draws the cast |
| World, time of day | `story.world` (`kit/core/worlds/`) | Night for neon, and so on |
| Backdrop | `story.background` (`kit/core/backgrounds.mjs`) | Paper, grids |
| Lighting | `story.light` (`kit/core/lighting.mjs`) | Key, haze, vignette |
| Medium | `story.medium` (`kit/core/medium.mjs`) | A whole-frame SVG filter pass through one `backdrop-filter` layer, stepped by the absolute frame ("boil") |

The medium is the model for everything new: a full-canvas layer above the
scenes and below the brand frame and the captions, whose state is a pure
function of the absolute frame, drawn from one plan by both renderers.

## The look

`story.look` (a pack's `look`, filled by `applyStyle`) is a name or
`{name, strength?, step?, furniture?, palette?, labels?}`. `none` or no look
leaves the render exactly as it was. A look is made of six shared parts
(`kit/core/look.mjs`, `kit/core/looks/`):

1. **Presets.** Values for the existing fields above (`brand.colors`,
   `cast.style`, `world.time`, `background`, `light`, `medium`). `applyLook`
   fills them under the story's own values and over the pack's: what a video
   sets itself wins, then the look, then the pack. `palette: "brand"` keeps
   the pack's colours.
2. **Grade.** One whole-frame filter stack on a second `backdrop-filter`
   layer above the medium: colour-ramp mapping by brightness, glow, edge
   lines, blur, sensor noise, wobble and tearing. It comes in a few drawings
   picked from the absolute frame, as the medium's boil does. Because it is a
   whole-frame pass, the world, the cast and every card take the look with no
   per-module work.
3. **Frame stepping.** `step` (drawings per second, 12 for "on twos" at
   24 fps and its nearest holds at 30) holds every scene, the camera and the
   world on the last step: `stepTime(t) = floor(t × step) / step`. HyperFrames
   drives the scene timeline from the root timeline through a stepped ease;
   Remotion freezes the scene tree on the stepped frame. Captions, the brand
   frame, the furniture and the audio are not stepped. The per-step jitter is
   a grade drawing chosen by the step number, so it is seeded and seek-safe.
   A story with base footage is not stepped.
4. **Furniture.** Look-specific overlay drawn in SVG and CSS above the grade:
   scanlines, grid floors, labels, a camera overlay, dimension lines, a title
   block, rain, speed lines. It is static markup whose motion is a handful of
   CSS variables, `lookVarsAt(plan, frame)`, set by both renderers per frame
   (HyperFrames `tl.set` half a frame before each change, Remotion inline).
   It stays out of the caption band and inside the safe zone.
5. **Shots.** The plan carries the track-0 shot windows and the cast's
   expression cues, so furniture can react: a blueprint draws in at each
   shot, speed lines fire on a surprised face.

6. **Cast options.** A look may ask the cast's drawing for something its
   drawing style already knows how to do (`pins` for paper cutout, the cute
   face for anime cel), through one hook in the character modules.

Stacking, low to high: scenes and camera, light, dot wipes, medium, look
grade, look furniture, brand frame, captions. A look whose grade belongs
under the paint (watercolour's pencil) draws it just below the medium.

## Determinism

Nothing reads a clock or `Math.random`. Variants, jitter, flicker and noise
come from a hash of the look name and the step or frame number. A seek, a
partial re-render and a preview window give the same pixels.

## Gates

Captions and the brand frame sit above the look and are never graded. Text
inside scenes is graded, so each look's ramp keeps light text on a dark
ground (or the reverse) at the contrast the story had; a look that cannot
says so in its entry (`gates`) and in the guide.

## What code-drawn frames cannot do

A filter pass sees pixels, not objects: it cannot give each shape real
thickness or light it in 3D. Looks that would need that ship under a name
that does not overclaim, and the guide says how close they get.
