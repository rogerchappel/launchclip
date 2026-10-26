# Direction guardrails

The 20-20-20 eye-break Short (`qa/make/eye-break-20-20-20`, seed a3976d41) passed
every finish gate and was still not shareable. Its critic found five kinds of
mistake: objects moving on their own, an idea that was never acted, captions
lost on what was behind them, ghosted characters and cards, and a sparse
slideshow. Several kit gaps it exposed are already fixed on main (#319–#325:
casts arrive and ride with their world plate, plates never fade themselves,
caption colours follow the world's tone). This note covers what is left: the
rules that make those mistakes hard to make again.

The approach is the same for each problem:

- **Good defaults** do the right thing when the planner says nothing.
- **Constrained vocabularies** give the planner words for what it means (an
  acting cue, a gaze target, a motion class) instead of raw numbers.
- **Validation** rejects a storyboard that cannot render well, with an error
  that names the fix.
- **Finish gates** measure the render, so a mistake no rule predicted still
  fails before review.

Hard-coded choices are avoided. Each rule lists what stays free for the planner.

Enforcement points, as used below:

| Point | Where | When it bites |
| --- | --- | --- |
| Module default | the module's `resolve` (kit/core) | always, silently |
| Validation | `validateStory` / module params / `validateDirection` | `story validate`, finish's validate stage |
| Finish gate | `runGates` in `src/finish.js` (`qa/finish/gates.json`) | after the render; status `needs-repair` |
| Planner prompt | `kit/core/planning-prompt.mjs` | the model pipeline's storyboard request |
| Skill | `skills-src/` (synced to `skills/`) | the subscription agent's workflow |

## 1. World physics

**Rule.** Every element of a world is one of three motion classes:

- **anchored**: fixed to the world (walls, furniture, parked cars, props on a
  desk, a cast set's desk or bench);
- **ambient**: moves in place, subtly and physically (clouds, water, a flame,
  a flickering sign, light rays);
- **mobile**: really moves (characters, vehicles, birds, balloons).

Anchored things move only through the camera. Each layer has one transform
(the world camera's depth for that layer), and every anchored thing on that
layer shares it. Nothing anchored drifts, bobs, slides in or fades in on its
own.

**Enforced:**

- **Module defaults.**
  - World layers and props carry a motion class: `MOTION_CLASSES` in
    `kit/core/physics.mjs`, and `motion` on each prop in `worlds/props.mjs`.
  - A cast-scene standing in a world (backdrop `world`) is anchored to the
    plate's front layer. It takes the plate's in-scene camera move (the same x
    and scale per frame as the world's front layer) on an inner `-cam` wrapper,
    and it never gets the ambient hold drift.
  - Characters are mobile. They move by acting cues (walk-to), never by drift.
- **Validation.** Two track-0 world plates of the same place (kind, time and
  props) joined by a cut are an error: the room would jump. Merge them into
  one world scene, or move the camera to a different place.
- **Finish gate `physics`** (on the resolved story and its op lists):
  - an anchored target (a world layer, a cast set or a riding cast) gets a
    transform its layer does not have;
  - an anchored cast set fades in or out over a plate that is already there;
  - a set is drawn over only part of its plate's window, so it pops in.

**Free for the planner:** the camera move per world (still, drift, pan, push,
pull, with an amount), which worlds and props, where props sit, and every
camera transition between places.

## 2. Acting that shows the point

**Rule.** If an idea is an action, someone does it on screen. Characters face
what they attend to, not the camera.

**Enforced:**

- **Module vocabulary (`cast-scene` cues).** New acting cues:
  - `look-far`, `turn-to-look`, `gaze-at`, `point-at`, `walk-to`, `stand-up`
    and `stretch`;
  - each takes a `target`: `far`, `left`, `right`, a world focus point
    (`window`, `horizon`, `street`, `skyline`), `{prop}`, `{character}` or
    `{x, y}`;
  - an action expands to a pose, a facing, a head and face turn and, for
    `walk-to`, a walk across the floor at a believable speed.
- **Module default.** An actor with a `target` (or a cue with one) faces it.
  The head and face turn toward it, so a character on a bench looks at the
  street, not at the viewer. Without a target nothing changes.
- **Validation (direction map).**
  - Each narrative line with cast cues names its key action:
    `action: {verb, who, target?}`, with `verb` from the acting cues above or
    a pose.
  - Each narrative section names at least one action.
- **Finish gate `acting`.**
  - Each named action is performed by its character in a cast scene inside
    the line's time, give or take half a second.
  - A character with a target set never faces away from it.
  - The critic's `acting` category stays the human check.

**Free for the planner:** who acts, which action, when (a word anchor),
expressions, and the target.

## 3. Captions are always legible

**Rule.** A caption reads against whatever is actually behind it: a world, a
character's shirt or a card. No style can switch off the fix.

**Enforced:**

- **Module default.**
  - Captions take `legibility: "auto"`.
  - A line whose band crosses a character or a media window at its time gets a
    backing plate. A card in the band is already a layout collision. Other lines over a world keep the tone colour and halo from #320.
- **Finish (measured).**
  - After the render, `src/caption_legibility.js` samples each caption line at
    its midpoint from the video frames. It measures the text colour against
    the pixels around and between the glyphs: contrast at the worst quarter,
    and how much of the background shares the text's colour (camouflage).
  - Lines below 3:1, or more than 35% camouflaged, are written to
    `qa/finish/caption-legibility.json`.
  - Finish re-renders once with a backing plate on exactly those lines
    (`captions.plates`). The second measurement is the one reported.
- **Finish gate `layout`.** An illegible caption after that pass is a layout
  error, so the layout gate fails.
- **Style.**
  - Plates and outlines are a legibility override, not a preset change.
  - The style gate ignores `legibility` and `plates`, so a style pack can set
    the look but can never forbid the fix.

**Free for the planner:** the caption preset (from the style), zone, case and
emphasis. Plates appear only where they are needed.

## 4. No ghosting

**Rule.**

- At most one copy of a character is ever on screen.
- The cast changes between scenes with a cut, or with a single-copy move: the
  outgoing copy rides out and the incoming one appears when the move ends.
- Text is either readable or gone. It never lingers half-transparent.

**Enforced:**

- **Module defaults.**
  - When consecutive cast scenes share a character across a non-cut
    transition (a camera move or a dissolve), the incoming cast cuts in when
    the transition ends.
  - Card and text entrances clamp their fade to `TEXT_FADE.max` (0.5 s); a
    cast's own fade takes at most 0.3 s.
  - Every text module holds fully opaque for its reading time (0.22 s a
    word, at least 1.2 s; source and role lines do not count).
- **Validation.** A character in two scenes whose render windows overlap is an
  error (two copies at once).
- **Finish gate `ghosting`** (op lists sampled at 10 Hz):
  - the same character is visible in two scenes at once;
  - a character's root is between 5% and 95% opacity for more than 0.25 s;
  - text is between 5% and 90% opacity for more than 0.5 s in a row;
  - text is fully opaque for less than its minimum hold.

**Free for the planner:** every transition type between places, and card
entrances and variants. The clamps only cap their timing.

## 5. Density and variety

**Rule.**

- No frame region stays empty for long.
- No card sits alone over an empty set.
- No shot repeats back to back.

**Enforced:**

- **Finish gate `density`.** Sampled every 0.5 s over the safe area, using
  the layout check's element rects:
  - a region (top, middle or bottom third in 9:16; left, centre or right in
    16:9) with only the plate in it for longer than 4 s;
  - a text card over a world plate with no cast and no other visual for
    longer than 3 s.
- **Finish gate `variety`.** Each cast scene has a shot signature: set, cast
  ids, the first pose of each actor, their positions, and the world kind.
  - Two consecutive cast scenes with the same set, cast and poses fail, even
    over different worlds.
  - The same set and cast more than three times in a video is a warning.
- **Planner prompt and skill: 9:16 composition.**
  - A card takes the top 30–40% of the frame and the cast stands in the lower
    half on the world's ground, so they share the frame.
  - Captions sit in the band between them.
  - A proof or quote card keeps a character reacting or pointing up at it.
  - Use at most two characters seated in 9:16.

**Free for the planner:** how many scenes, which modules, card content, and
the cast's actions within those bounds.

## 6. Skills and planner

- **Planner prompt (`kit/core/planning-prompt.mjs`).** It lists the acting
  cues and targets, the motion classes, the key-action field in the direction
  map, the no-ghosting rule and the 9:16 composition rules.
- **Skills (`skills-src`).** The create-video skills get the same rules:
  - the direction-map reference requires `action` on narrative lines;
  - the storyboard reference shows the cues;
  - the review step names the new gates.

## Gates summary

| Gate | Input | Fails when |
| --- | --- | --- |
| physics | resolved story and ops | an anchored element moves relative to its layer; a set pops or fades over its plate; same-place cut |
| acting | direction map, resolved cast | a named action is not performed in its line; a character faces away from its target |
| layout (captions) | rendered frames | a caption line is below 3:1 or camouflaged after the plate pass |
| ghosting | ops at 10 Hz | two copies of a character; half-transparent text or characters held too long |
| density | layout rects at 2 Hz | an empty region for more than 4 s; a lone card over an empty set for more than 3 s |
| variety | cast scenes | the same shot back to back |
