## Design the video

Write the direction map first: `DIRECTION.json` from
[references/direction-map.md](references/direction-map.md) gives every line
of the narration an intent and a treatment (dress, insert, face or camera),
and names the scenes that will show it. Aim the treatments at the story's
cadence profile ([references/profiles.md](references/profiles.md)): coverage
near its target, no undressed run past its limit. Then author the storyboard
against the map.

### Choose the cast

The cast is `story.cast.characters`: starter characters by id (`launchclip
cast list`), a style pack's generated cast, or characters designed for this
video. When the brief describes its own people or supplies a reference image,
design them first with the `launchclip-character-design` skill (`launchclip
cast create <id> --describe "…"`, then look at `cast/<id>.sheet.png`) and
list each by id: `{"id": "<id>"}`. A reference image maps to traits, never to
a real person's likeness. A cast need not be people: the starters include
horses on four legs (`comet` the stallion, `duchess` the mare, `sprig` the
foal), animals (`mochi`, `biscuit`, `rusty`…), brand-coloured mascots (`bloop`,
`twinkle`…) and objects with faces (`ping` the phone, `byte` the laptop,
`latte` the cup, `watt` the bulb, `penny` the coin…), which take the same
poses, expressions and cues as people and can stand for an idea (the
product, the problem, the cost) beside them.

### Direction guardrails

The finish gates fail these, so plan for them from the first draft (design:
`docs/DIRECTION_GUARDRAILS.md` in the LaunchClip repo):

- **World physics.** Walls, furniture, parked things, props and a cast set's
  desk or bench are anchored to the world. Only the camera moves them: a world
  scene's `params.camera`, or a camera transition between places.
  - Ambient things (clouds, water, flames) move in place. Mobile things
    (characters, vehicles, birds) move by acting cues.
  - Two world scenes of one place joined by a cut are an error. Make them one
    scene with one camera move.
  - A cast-scene over a world plate shares the plate's start and end.
- **Acting shows the point.** Each map line with cast cues names its key
  action: `action: {verb, who, target?}`.
  - A cast scene on that line performs it with an acting cue: look-far,
    turn-to-look, gaze-at, point-at, walk-to, stand-up or stretch. Each takes
    a `target`: `far`, `window`, `horizon`, `street`, `skyline`, `left`,
    `right`, `{prop}`, `{character}` or `{x, y}`.
  - A character with a target faces it and turns its head to it. "Look 20 feet
    away" is a character turning to look at the street, not someone smiling at
    the camera.
- **Legible captions.** Every caption line is measured on the render. Lines
  that do not read get a backing plate in the style's own colours. Keep
  captions off faces and busy props anyway.
- **No ghosting.**
  - One copy of a person at a time. Never put a character in two overlapping
    scenes; in the next shot, a character appears by itself once the
    transition ends.
  - Text fades within 0.5 s and stays fully shown for its reading time (about
    0.22 s a word).
- **Density and variety.**
  - No third of the frame holds only the plate for more than 4 s. A full-frame
    `photo-scene` whose picture is detailed or moving (a story object, marks
    being drawn on it) fills the frame; do not cover it with cards to pass.
  - No card sits alone over an empty set for more than 3 s. Keep the cast under
    it, pointing up or reacting.
  - No shot repeats back to back. Moving the same pair to a new background is
    not a new shot.
  - A video pictures its subject. One of 15 s or more made only of line
    diagrams, step rows and text cards (no character, photo, footage, object,
    chart or interface in any scene) fails the variety gate.
- **Explainers are carried by characters.** An explainer with nothing to show
  (no footage, no product screens) gets a small recurring cast, not a deck of
  diagrams:
  - Cast one to three characters for the idea: the subject itself as an
    object with a face, its parts or forces as mascots (for "why it rains":
    a cloud and a droplet; a recoloured cup is a jar or a pot, a blob or a
    monster is a germ or an ingredient), or a starter person for a topic
    about people. Write them
    as `story.cast` (`"style": "chibi"`), a kind with its own colours:
    `{"id": "starter", "kind": "cup", "colors": {"body": "#f3e3c0"}}`.
  - Build most beats as `character-cameo` (one character beside a card that
    carries the line's few words) and bring two or three together in a
    `cast-scene` (`set: "standing"`, `shot: "medium"` or `"close"` for
    objects, mascots and animals, which are short). Give every character
    scene pose and expression cues on the narration's words.
  - A character is on screen for at least half the runtime and in the
    opening scene, whole on frame 0. Never open on a module that draws itself
    from an empty plate (`line-diagram`, `doodle-outline`).
  - Diagrams, charts and cards support the cast: one where it shows what a
    character cannot, never two in a row.
  - Honest evidence: a character illustrates what the narration says. No
    card, label or speech bubble states a fact, a number or a quote the
    script does not have, and a character never speaks lines of its own.
- **Reading time.** A card is fully shown for about its scene minus 0.8 s and
  needs 0.22 s a word (at least 1.2 s): a 3 s scene holds 10 words, title,
  body, labels and steps together. Cut the copy or split the scene.
  - In 9:16: card in the top band, cast framed at medium (knees up, the
    default for people sets) below it with captions over their bodies, never
    their faces, and at most two seated characters.
- **Frame like an animated short.** `params.shot` wide | medium | close on a
  cast-scene or character-cameo frames the cast with no camera move, faces
  readable on a phone, inside the safe zone and above the caption band. Open
  wide to set the place, play the exchange at medium, cut close on the
  reaction: a cue `{at, shot: "close"}` cuts in on that character and
  `{at, shot: "medium"}` cuts back. Use shot for closeness, not zooms.
  - Act the argument with poses: arms-crossed, hands-on-hips, facepalm,
    lean-in, point-self, shrug. `point-at` aims at the other character's chest
    and stops short, so two people pointing at each other never cross arms.
  - Characters ride their plate through every camera move (pan, orbit,
    whip-pan, push), a cameo over a photo plate too.

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
  staggers), `documentary` (serious, archival, news: slow power1) or
  `cinematic` (film-like: every entrance and move eases slow → fast → slow
  into its resting state, and settled scenes keep a slow push-in, recorded
  product clips included, so no frame is ever fully still). One
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
- Inspect settled world-camera frames at delivery size, not only the moves.
  If the parallax background shows hard edges or vertical seams on a hold,
  set `camera.parallax: false` (the camera still travels, but this also
  removes the moving background field, leaving the flat background colour)
  or switch to `camera.mode` "cuts" and keep the travel as typed camera
  transitions (`pan`, `push`, `orbit`, `whip-pan`), which keeps the ambient
  field. Record which one you chose and why.
- Select transitions by meaning: hard cut for contrast, push for continuation,
  whip for speed, zoom for scale change, morph for identity, and aperture/mask
  for focus. Do not disguise one generic crossfade with different names.
- Use directional blur or brief ghost trails only while velocity is high, then
  return to a crisp settle. Prefer transforms, masks, SVG paths, and layered
  depth over permanent CSS blur.
- Keep primary copy readable at delivery size. Long body text belongs in the
  narration or a deliberate reading beat, not a fleeting overlay.

Do not imitate a named living artist or clone a person's voice or likeness.
