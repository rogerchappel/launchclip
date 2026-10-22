## Design the video

Author `storyboard.json` from
[references/storyboard-modules.md](references/storyboard-modules.md). It is
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
<!-- renderer: hyperframes -->
  light, materials, entry/exit geometry, velocity, and blur envelope across
  each world. Treat an independent full-frame DOM reset as a cut, not
  continuity.
<!-- /renderer -->
<!-- renderer: remotion -->
  light, materials, entry/exit geometry, velocity, and blur envelope across
  each world. Treat an independent full-frame remount (a fresh scene that
  carries no object across its boundary) as a cut, not continuity.
<!-- /renderer -->
- Reserve safe areas for captions and platform UI when applicable.
- For every presenter-plus-graphic scene, declare a presenter-safe area and a
  non-overlapping graphic zone in `STORYBOARD.md`. Pan or crop the presenter
  into the opposite zone before placing a panel. If neither side has usable
  negative space, use a true split, compact picture-in-picture, or full-frame
  graphic cut instead of covering the face.
- Derive split crops from the target rectangle and presenter focal point. The
  transformed crop must fill the entire target bounds with no black or dead
  band; validate the first, middle, and last frame of every split state.
<!-- renderer: hyperframes -->
- Use semantic HTML objects, SVG, diagrams, charts, or UI reconstructions before
  seeking generated raster imagery.
<!-- /renderer -->
<!-- renderer: remotion -->
- Use catalogue modules, React-rendered semantic DOM, SVG, diagrams, charts, or
  UI reconstructions before seeking generated raster imagery.
<!-- /renderer -->

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
  staggers) or `documentary` (serious, archival, news: slow power1). One
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
- Select transitions by meaning: hard cut for contrast, push for continuation,
  whip for speed, zoom for scale change, morph for identity, and aperture/mask
  for focus. Do not disguise one generic crossfade with different names.
- Use directional blur or brief ghost trails only while velocity is high, then
  return to a crisp settle. Prefer transforms, masks, SVG paths, and layered
  depth over permanent CSS blur.
- Keep primary copy readable at delivery size. Long body text belongs in the
  narration or a deliberate reading beat, not a fleeting overlay.

Do not imitate a named living artist or clone a person's voice or likeness.
