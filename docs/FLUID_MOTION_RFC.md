# RFC: Fluid, connected motion

Status: draft, open for review
Date: 2026-11-16
Roadmap entry: "Fluid, connected motion, in explainers and animation alike"
([ROADMAP.md](ROADMAP.md))
Builds on: [KIT_CONTRACTS.md](KIT_CONTRACTS.md) (catalogue B/H view tree and
op list, shot states, motion grammar), [DIRECTION_GUARDRAILS.md](DIRECTION_GUARDRAILS.md)
§8 (the motion check), [ANIMATION_PIPELINE_RFC.md](ANIMATION_PIPELINE_RFC.md)
(characters), [DUAL_RENDERER_PLAN.md](DUAL_RENDERER_PLAN.md)

## 1. Summary

A LaunchClip scene today is one module that enters, builds, holds and leaves.
Inside that window the `kinetic` feel moves the camera (drift, zoom kicks, whip
cuts) and shot states change a module's params, but the elements themselves
mostly arrive and then stand still, and nothing carries from one scene to the
next. The reference we are aiming at is a short reel where a robot stands in a
bakery, seven agent cards fly up and fan out above it, glowing wires connect
each card to a "director" node, pulses of light run down the wires and light
the director as they land, and every card keeps breathing and drifting until it
moves on to its next arrangement. Nothing is a static box.

This RFC covers six abilities, each written as frame-pure ops that both
renderers already know how to play, so nothing here needs a new runtime:

| # | Ability | Where it lives | Phase |
|---|---|---|---|
| 1 | Elements carried across scenes, settling into a new layout | story `carry` + a hand-off op pass | 3 |
| 2 | Group motion: flock, wave, fan, unison with offsets | `kit/core/fluid-motion.mjs` | 1 (slice) |
| 3 | Per-element idle motion tied to the grammar | `kit/core/fluid-motion.mjs` | 1 (slice) |
| 4 | Node graphs: glowing wires, travelling pulses, nodes lit on arrival | `node-graph` module | 1 (slice) |
| 5 | Characters reacting to graphics | cast cues targeting a module anchor | 4 |
| 6 | Planner-drawn graphics (a card with its own icon, a prop, a badge) | `graphic` spec drawn by a shared painter | 5 |

Plus two timing devices used by all of them: a **beat grid** (hits land on
beats, a short camera shake on impact) and an optional **loop** (the last
frame equals the first).

## 2. Constraints every part keeps

- **Frame-pure and seek-safe.** Every value is a function of the scene clock
  and the model. No `requestAnimationFrame`, no accumulated state, no random
  numbers that are not seeded by ids. A seek to any frame renders the same
  pixels as playing up to it.
- **One op list, two players.** Motion is expressed as catalogue B/H ops
  (`set`, `tween`, `loop` on element ids; props `opacity`, `x`, `y`,
  `scaleX`, `scaleY`, `rotation`, `strokeDashoffset`, `blur`, clip, `text`).
  HyperFrames plays them as calls on its paused GSAP timeline
  (`opsToGsap`); Remotion evaluates them with `frameState`. Anything that can
  be said as ops is in parity by construction; the parity harness checks the
  pixels.
- **Layers, not overlapping tweens.** An element that has an entrance, a group
  motion and an idle motion gets one wrapper per layer (`…-card-3` for layout
  and group moves, `…-card-3-idle` for the breath, the face inside). Two
  tweens never fight over one prop on one target, which keeps GSAP and
  `frameState` agreeing about who wins, and keeps the motion check's per-element
  reading honest.
- **Camera rules stay.** The camera eases slow → fast → slow and never
  overshoots; blur only at peak speed. Elements may overshoot (a card's
  back-ease landing), the camera may not. The impact shake (§8) is a decaying
  displacement, not a spring past the rest pose.

## 3. Group motion (phase 1)

A group is a list of members with a **slot** each (where it rests) and a
**pattern** that says how the group gets there and moves while it is there.
`kit/core/fluid-motion.mjs` turns a pattern into per-member ops:

| Pattern | Reads as | Per-member offset |
|---|---|---|
| `flock` | members leave one point together and spread to their slots on curved paths | delay by index (golden-ratio jitter), x and y on different eases so each path arcs |
| `wave` | a ripple passes through a settled group | delay by position along the group's main axis |
| `fan` | members open from a stack into an arc | rotation and position from the stack angle to the slot angle, delay from the centre out |
| `unison` | a march: every member makes the same move | the same move, each a few frames late (0.03–0.06 s) |

The offsets are what make a group look alive. They are deterministic: a hash of
the member id and index, never `Math.random`. The grammar scales them
(`grammarStagger`): `snappy` tightens them, `playful` loosens them.

A group pattern is a function `(members, {at, from?, grammar}) → ops`, so any
catalogue H module can call it for its own parts. The first slice uses `flock`
for the node-graph's cards and `wave` for the ripple when every wire fires at
once.

## 4. Idle motion (phase 1)

While an element is on screen and not mid-gesture, it breathes: a slow bob in
`y`, a small tilt and, for glows, an opacity swell. Idle motion is written as a
chain of `sine.inOut` half-cycles on the element's `-idle` wrapper, from the
moment it lands to the scene's exit:

- **Period** 3.2–4.4 s per full cycle (each half at least 1.6 s), offset per
  element by a hash of its id, so no two members breathe in step.
- **Amplitude** from the grammar: a base of 10 px of bob and 1.8° of tilt at
  1080 px, scaled ×1.2 `snappy`, ×1.4 `playful`, ×0.8 `smooth`,
  ×0.7 `cinematic`, ×0.5 `documentary`, ×1 `editorial`.
- **Why half-cycles of 1.6 s or more:** the motion check reads a tween longer
  than `MOTION_CHECK.gesture` (1.5 s) as continuous motion, not a gesture, so
  idle never counts towards the crowding rule and never looks like an entrance.

Idle stops (tweens back to rest over its own half-cycle) before the element's
exit, so exits start from a known pose.

## 5. Node graphs with wires and pulses (phase 1: the first slice)

A new catalogue I module, `node-graph`:

- **Nodes** (3–8) with an icon and a short label, laid out as a fan above a
  **hub** (the director). Portrait and landscape both: nodes sit on two
  staggered arcs round the hub so seven labels fit across 1080 px.
- **Wires**: one cubic per node from the node's centre to the hub's centre,
  drawn under both, so a node's idle bob never shows a loose end. A wire is a
  dim base stroke with a soft drop-shadow glow, and it draws on
  (`strokeDashoffset` 1 → 0) after its node lands.
- **Pulses**: a short bright dash on a copy of the wire path
  (`pathLength = 1`, `strokeDasharray = "L 2"`); tweening `strokeDashoffset`
  from `L` to `-1` runs the dash from the node to the hub. Both renderers
  draw a stroked dash the same way, so the pulse needs no sampled positions.
  A pulse travels in at most 0.9 of a beat, so one wire never carries two.
- **Flow**: between pulses, dots stream down every wire (a dotted copy whose
  `strokeDashoffset` runs linearly for the rest of the scene), so the graph
  never holds still. The first 9:16 render without it was 76% near-still
  frames by the render motion gate; with it and the idle breath, 17%.
- **Lighting on arrival**: when a pulse reaches the hub, the hub's ring flashes
  (scale and opacity out) and the hub core brightens; when a pulse leaves, its
  node's rim lights. These are short flashes, which the motion check already
  treats as pulses rather than entrances (`MOTION_CHECK.pulse`).
- **Converge**: one beat where every wire fires at once; the hub takes the
  impact (a punch and the camera shake, §8) and the nodes ripple (`wave`).
- **Events**: `build`, `node-<id>` (each landing), `converge`. A hit can move
  any of them, as with every catalogue module.

## 6. Elements carried across scenes (phase 3)

The hard one: a row of cards in scene A flies up into a fan above a character
in scene B, instead of cutting to a fresh layout.

**Contract.** A scene names elements it hands on and the next scene names the
slots that receive them:

```json
{"id": "s2", "module": "node-graph", "carry": {"from": "s1", "map": {"s1-card-0": "s2-node-0", "s1-card-1": "s2-node-1"}}}
```

**Mechanism (FLIP between scenes).** At resolve time both models exist, so the
planner pass knows the first rect (the element's last pose in A, from A's view
tree and `frameState` at A's end) and the last rect (its slot in B). It then:

1. holds A's element until the boundary instead of running its exit;
2. starts B's receiving element at A's rect, expressed as an `x`, `y`,
   `scaleX`, `scaleY` offset from its own slot (the "invert");
3. tweens the offset to zero over the hand-off (the "play"), with a group
   pattern so the members arrive as a flock rather than in lockstep.

Because both sides are ordinary ops on ordinary ids, the renderers need nothing
new. The transition between A and B for carried elements is a cut on the
same frame (A's copy hides as B's shows), so they never double.

**Unproven.** The two scenes must share a coordinate space at the boundary: no
camera move in either across it, the same canvas, both rendered on the same
plate. World-camera scenes and typed transitions with motion (push, whip) are
out until a rect can be mapped through the camera at the boundary frame. Text
that reflows between layouts (a card that grows) is a cross-fade inside the
moving card, not a morph.

## 7. Characters reacting to graphics (phase 4)

Cast scenes already direct gaze and gestures at targets
(`kit/core/characters/actions.mjs`: `gaze-at`, `point-at`, named targets). A
module that shares a plate with a cast scene publishes **anchors**: named
points with times (`node-graph` publishes `hub`, `node-<id>` and the time each
lands). A cast cue can then target `{scene: "s2", anchor: "node-3"}`, and the
cue's time defaults to that anchor's event, so the character looks at the card
as it lands and raises its arms as the fan opens (`converge`).

**Unproven.** Anchors are in the module's rect space; a cast scene's targets
are in its set's space. Both are canvas pixels on the same plate, which is
enough for a still camera; a world camera between them needs the same mapping
as §6.

## 8. Beat grid, impact shake, loop

- **Beat grid.** A module may take `bpm` (or the story's music tempo when
  `finish` knows it). Default cue times snap to the grid: the build on the
  first beat after the entrance, landings on half beats, pulses on beats,
  `converge` on the first bar line after every node has landed. An explicit
  `at` or a hit is honoured as given; only defaults snap.
- **Impact shake.** On an impact event the module's camera wrapper takes a
  decaying displacement: four tweens of 0.05–0.08 s whose amplitude halves each
  step (10 px → 0 at 1080 px), `power1.inOut` each. It never overshoots the
  rest pose by more than the step before and it is short enough (≤ 0.3 s) that
  the motion check reads it as one gesture.
- **Camera drift inside a module.** The camera wrapper also takes one slow push
  over the scene (scale 1 → 1.05, `power1.inOut`), so a settled frame is
  never still. It is a different prop from the shake, so the two compose.
- **Loop.** `loop: true` makes the last frame equal the first: every layer's
  idle chain is fitted to a whole number of cycles over the scene, pulses run
  on a period that divides the scene, and the module's enter and exit become
  matching states (its exit returns elements to their entrance pose). The
  check (§9) compares frame 0 with the last frame from `frameState`.
  Not in the first slice.

## 9. The motion check

`kit/core/motion-check.mjs` reads every scene's ops. What this RFC adds should
pass it as designed, and it learns two things:

- **Continuous motion is not crowding.** Idle half-cycles are longer than
  `gesture`, so they are already excluded; the check also learns the
  `-idle` suffix, so an idle wrapper is never counted as an element of its
  own for `crowdElements`.
- **Flashes are not entrances.** Pulses and ring flashes appear and go within
  `pulse`. An element that flashes on every beat used to be read as one long
  life from its first fade-in to its last fade-out; the check now reads each
  fade-in and the fade-out after it as one flash (shipped in phase 1).
- **New findings** (phase 2): `static-hold` (warning) when a scene longer than
  3 s has a settled stretch over 1.5 s where nothing on screen moves, which is
  what this whole entry is against; `loop-seam` (error) when `loop: true` and
  frame 0 differs from the last frame; `shake-overshoot` (error) when a camera
  shake's steps do not decay.

## 10. Planner-drawn graphics (phase 5)

The planner may describe a small graphic instead of picking only from the
catalogue: `{"graphic": {"kind": "card", "icon": "chef-hat", "label": "Baker",
"badge": "3"}}`. A shared painter turns that spec into a view-tree node in the
style's palette and type (the same node every catalogue H module draws with),
so it renders in both renderers and can be a member of any group above. The
spec is validated like module params; anything it cannot draw is a validation
error the planner can fix, never free-form HTML.

**Unproven.** How far a spec can go before it is a custom module. The line in
this RFC: shapes from a closed list (card, chip, badge, ribbon, prop from the
world kit), any icon from `kit/core/icons.mjs`, text that fits; nothing else.

## 11. Phases

1. **`node-graph` and `fluid-motion.mjs`** (this PR): flock, wave, idle, impact
   shake, beat grid, glowing wires with pulses, hub lit on arrival; schema,
   both renderers, parity fixtures, tests, a 9:16 sample.
2. **Motion check additions**: `static-hold`, `loop-seam`, `shake-overshoot`;
   the idle suffix in crowding.
3. **Carry across scenes** (§6) on still-camera plates.
4. **Anchors and character reactions** (§7).
5. **Planner-drawn graphics** (§10), then group patterns and idle on the other
   catalogue H modules that draw sets of things. The second half has shipped:
   `icon-grid` flocks out of the middle of the grid and breathes; `drop-grid`
   keeps its word-timed fall, rocks on its base once landed and ripples when
   full; `social-wall`'s field arrives as one wave along the drift and its
   pulled posts breathe; `item-list` (every layout already enters as a group)
   breathes once in. Each has a long 9:16 parity fixture (`h-*-idle-portrait`)
   that samples mid-breath, and `examples/story/group-idle-9x16` shows all
   four. Left out on purpose: `unit-grid` (up to a hundred tiny units, where a
   breath each is noise and a hundred more nodes), ranked and tabular sets
   (`leaderboard`, `comparison-table`, `heatmap`), whose rows must stay
   aligned to read, and modules that already move a set the whole time
   (`ticker-tape`, `live-bars`). `fan` and `unison` were not needed: the
   modules' own entrances already are those patterns.
6. **Loop** across a whole short (§8), with the seam check.

## 12. What is unproven

- Carry through a moving camera or a moving transition (§6).
- Whether idle on every element of a busy scene reads as alive or as nervous.
  What the set modules' 9:16 sample (`examples/story/group-idle-9x16`)
  showed: the grammar table holds for large elements (node-graph cards, a
  pulled post), but a fixed 10 px bob is too much for small members of a set.
  On 140 px icon tiles it was 7% of each tile's height, and neighbours
  breathing out of phase wandered visibly out of line, so the grid read as
  nervous. The bob is now capped at 4% of the element's own height
  (`idleFor`, `IDLE_SHARE`), which keeps the rows legible while the set still
  breathes. Three more adjustments came from the sample. Wide lines of type
  (item-list, a pulled post) take half the tilt, because 1.8° swings the far
  end of an 800 px line by about 12 px. Things with weight (drop-grid) rock on
  their base at 0.3 of the bob and 0.7 of the tilt instead of floating off
  their contact shadow. Sets of tiny units (unit-grid) get no idle at all.
  Still unproven: a whole short where every scene breathes.
- Whether two staggered arcs hold eight labels in every brand's display font;
  the module fails validation rather than overlap them, which may make it
  refuse some fonts at eight nodes.
- Performance of many drop-shadow glows on SVG strokes in HyperFrames'
  headless Chrome on long scenes; the first slice keeps glows on the wires and
  hub only.
