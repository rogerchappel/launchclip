# R&D: a per-frame character rig

Status: R&D prototype, open for review. Remotion only; HyperFrames parity is
the gate before anything ships.
Date: 2026-11-25
Code: `kit/core/characters/rig-frame.mjs` (the rig),
`kit/core/characters/rig-frame-draw.mjs` (the drawing and the prototype
scene), `kit/core/characters/rig-scene-layer.mjs` and
`kit/hyperframes/rig-runtime.mjs` (the renderers' per-frame layer),
`eval/per-frame-rig/` (today's storyboard, the side-by-side render, the
metrics, a quick preview), `test/rig_frame.test.js`.
Nothing here touches the storyboard schema or today's rig output.

## 1. The problem

The owner watched the stickman test renders and said the limbs "just aren't
fluid or proper… it looks off". The code says why.

1. **Every limb is a fixed drawing turned at its joint.** Motion is
   pose-to-pose rotation tweens of all joints at once (`acting.mjs`
   `actingOps` / `poseChangeOps`, with MOVE's anticipation, settle and a
   small lag). There are no arcs, no breakdowns and no successive breaking
   of joints: every joint starts and stops together.
2. **The walk is a pendulum.** `gestureOps` swings the hips ±16° on a sine,
   the knees never bend, the body slides along a linear `-walk` x tween and
   the feet skate. Worse than we thought: a walk shorter than one 0.6 s cycle
   gets no swing at all. In the test scene the walk lasts 0.64 s and the
   legs sit at 2° the whole way (op list at 0.6 s: `leg-l 2.03°`,
   `shin-l −0.68°`). The figure glides 388 px on still legs.
3. **Rubber-hose limbs can't bend.** `hose()` draws each segment as a
   bowed stroke turned rigidly, because the renderers animate rotations only
   (the op list must play the same in Remotion and HyperFrames). A single
   curve through shoulder, elbow and wrist would be right for one pose and
   wrong for every tween.
4. **Feet are not pinned.** A crouch shortens the legs (`legScale`,
   `contact.mjs`) instead of bending the knees.

Point 3 is the root. As long as a frame is "a fixed drawing plus rotations",
the limbs can't be redrawn, so 1, 2 and 4 can only be patched.

## 2. The design

A character's frame becomes a **pure function of time**:

```
rigFrame(character, track, t) → {joints, legs, arms, lean, bend, head, ball, walk}
```

`joints` are world positions (rig units, ground at y = 0) of the pelvis,
hips, knees, ankles, chest, shoulders, elbows, wrists and neck. The drawing
reads them each frame and draws the limbs from scratch. Nothing is kept
between calls.

- **Inputs.** `character` is `{params, style}`; lengths come from the
  style's own geometry (`hoseGeometry` / `stickGeometry`) and rest arms from
  `poseJoints('stand')`, so a cast looks as it does today. `track` holds a
  start `x` and facing, walks (`{start, end, to, stance, stepLength}`),
  body keys (`{t, lean, crouch, shift, head}`) and timed hand paths.
- **Walk cycle.** `planWalks` plans the steps from the travel: N steps,
  landings evenly spaced, the last two the final stance, so the stride
  matches the distance exactly. Each step has contact, down, passing and up:
  a short double support, the swing foot on an eased arc with a lift, heel
  peel (pivot on the toe) before it leaves, heel strike (pivot on the heel)
  when it lands. The pelvis rides Catmull-Rom waypoints midway between the
  planted feet, bobs (low after contact, high after passing) and is lowered
  just enough (a smooth max) that both feet are in reach. Knees come from
  two-bone IK hip → ankle. Arms counter-swing with the opposite foot. The
  walk's pace ramps in and out (a smoothstep velocity), so it starts and
  stops mid-cycle with an ease.
- **Overlap.** Arm angles follow their targets through damped springs that
  soften down the chain: upper arm ω 22 ζ 0.72, forearm ω 15 ζ 0.58, glove
  ω 11 ζ 0.5. The shoulder leads, the elbow and the glove trail. The body
  channels (lean, crouch, shift) are critically damped: no overshoot on the
  root. The spine bows with the lean still to come, a drag curve.
- **Seek-safety.** Springs are integrated from t = 0 at a fixed 1/240 s
  sub-step on every call. Frame N alone equals frame N after 0..N-1, in any
  order, in any process. Angle goals are taken the near way round from the
  current state, so nothing spins through 360°.
- **Breakdowns and arcs.** A hand can follow timed points through a
  time-knotted Catmull-Rom (Barry–Goldman), so it passes through every
  breakdown with no corner. IK turns the point into arm angles; the springs
  stiffen on a path (×3.2) so the arc survives but still trails a little.
  A point can flip the elbow (`bend: −1`) for a cocked arm; the flip is set
  where the arm is straight, where both bends meet.
- **Foot pinning.** Crouch, shift and lean move the pelvis; the feet stay on
  their places and the knees bend. Legs never shorten.
- **Hand IK.** `twoBone` clamps the target to the reach, so bones never
  stretch (the reach clamp idea from `contact.mjs`, kept).
- **Drawing.** Rubber-hose limbs are one pressure-ink stroke
  (`pressureStroke`) per limb, along the quadratic Bézier that passes
  through the elbow (or knee) halfway, bowed a minimum when straight. The
  glove, shoe and head are the style's own parts (`hoseGlove`, `hoseShoe`,
  `hoseHead`, split out of `drawRubberHose` with byte-identical output).
  `stick` draws two straight segments.

## 3. The prototype

One rubber-hose `oliver`, 9:16, 8 s, on the `standing` set. Walk left about
0.8 m in four steps (0.3–1.75 s), stop, a small settle, anticipation (crouch,
lean back, weight to the back foot, the arm swings back and cocks behind the
head), an over-the-top throw released at 4.47 s, follow-through, settle,
then an idle: breath, arm sway and a weight shift front to back.

Today's rig acts the same beats from a cast-scene storyboard
(`eval/per-frame-rig/today.storyboard.json`: walk-to a point at 0.3 s, throw
left at 4.45 s, ambient off so the set holds still). Same character, scale
and floor; the per-frame side is drawn over the same set.

The walk is 0.8 m, not 2 m: at this scale the 9:16 frame is 2.2 m wide and
today's single-character slot starts in the middle. A longer walk needs the
world camera (see §7).

Run it (heavy, take the lock):

```
sh eval/per-frame-rig/render.sh            # qa/per-frame-rig/side-by-side.mp4, strips
node eval/per-frame-rig/metrics.mjs        # the table below
node eval/per-frame-rig/preview.mjs --from 4 --to 4.6 --fps 30 --out strip.png   # no render
```

## 4. What it measured

Both sides measured the same way, canvas px at 30 fps. Today's joints come
from forward kinematics over its op list (`frameState` at each frame, the
drawing's own pivots); the prototype's from `rigFrame`.

| measure | today | per-frame |
|---|---|---|
| foot slide while on the ground, walk (px) | 781.5 | 12.9 |
| joint jerk, RMS (deg/s³) | 209271 | 60420 |
| joint jerk per unit of motion (1/s²) | 1088 | 665 |
| throw: hand travel (px) | 1737 | 1675 |
| throw: hand path bow (sagitta / span) | 0.41 | 0.52 |
| throw: worst turn between frames (deg) | 131.8 | 114.9 |
| throw: corners (> 45° turn in a frame) | 7 | 3 |
| frames with legs crossing | 0 | 13 |
| frames with arms crossing (arm/arm, arm/leg) | 2, 0 | 18, 4 |
| bone length drift (px) | 1.3 | 0 |

How to read it:

- **Foot slide.** Today both feet skate the whole walk (2 × 388 px). The
  prototype's 12.9 px is the ankle rolling over the toe and heel while the
  foot is within 3 px of the floor; the foot's place itself never moves (the
  test holds it to < 1 px).
- **Jerk** falls by 3.5×, and by 1.6× per unit of motion, even though the
  prototype moves much more. Today's jerk comes from many joints starting and
  stopping together on eased tweens.
- **Arc.** The prototype's hand bows further off its chord. Its three
  "corners" are the cocked hold, where the hand stops and turns round
  (a real reversal at 3–5 px a frame); today's seven are tween joins.
- **Crossings.** The prototype walks and throws in profile, so legs pass each
  other and the far arm passes the body. That is correct in a side view, not
  a tangle. Today's legs never cross because they barely move.
- **Bones.** Exactly rigid. Today drifts 1.3 px from scale tweens (breath,
  squash).

Cost: `rigFrame` averages 3.3 ms a frame in Node (6.7 ms at 8 s; it grows
with t because the springs replay from 0). The drawing adds little. The
whole side-by-side, both renders and the ffmpeg steps, took 31 s.

## 5. HyperFrames parity

HyperFrames builds one paused GSAP timeline and seeks it; the cast-scene
emitter today serialises the static tree and the op list
(`kit/hyperframes/catalog-characters.mjs` → `emitParts`). There is already a
pattern for a frame-pure painter: catalogue H's particles and UI host
(`kit/hyperframes/catalog-h.mjs`) inline a self-contained runtime and add a
proxy tween over the scene,
`tl.fromTo(clock, {t: start}, {t: end, ease: 'none', immediateRender: false, onUpdate: () => lcPaintParticles(canvas, plan, clock.t)})`.
Seeking the timeline sets `clock.t` and calls `onUpdate`, so every seek paints
the frame for that time.

The rig plugs in the same way:

1. The emitter writes the static parts once: the head (with its expression
   groups, toggled by opacity ops as today), the glove, the shoe and the
   ball as `<g>` with ids, and one `<path>` per limb and the spine.
2. A runtime, `RIG_RUNTIME`, is the source of `rig-frame.mjs` and the
   limb-path part of `rig-frame-draw.mjs` (`limbCurve`, `pressureStroke`),
   made self-contained like `PARTICLE_RUNTIME` (they import only each other
   and pure helpers).
3. A proxy tween's `onUpdate` calls `lcRigFrame(host, plan, clock.t)`, which
   evaluates `rigFrame` and sets each limb path's `d` and each part's
   `transform`. Remotion renders the same tree from the same function.

Parity is exact by construction: the same pure function, the same floats,
the same path strings (`r1` rounding). It is proven, not assumed, by the
parity harness (`scripts/parity-scene.mjs`, `test/parity.test.js`) on a
fixture scene before the rig is offered to any storyboard.

**As built** (docs/KIT_CONTRACTS.md, "The per-frame rig in the renderers"),
simpler than the plan above: no static parts and no per-attribute patching.
The emitter writes one empty rig layer where the actors sit; the runtime
(`RIG_RUNTIME`, an esbuild bundle of `kit/hyperframes/rig-scene-paint.mjs`
and the kit/core rig code, inlined once per page) builds the frame's whole
tree with `rigSceneTree` and sets the layer's `innerHTML` to the markup the
HyperFrames serialiser writes for any tree. Element identity is not kept, but
the markup is a pure function of t, so a seek in any order paints the same
DOM, and a hold skips the DOM write. Remotion fills the same layer from the
same function each frame. The experimental Remotion entry is gone:
`eval/per-frame-rig/render.sh` renders both sides through the story
composition (the per-frame side is the same storyboard with
`cast.rig: "frame"`).

Fixtures: `test/fixtures/parity/characters-rig-stick-classic-void.json` and
`characters-rig-rubber-hose-world.json` (a walk, a contact action and a camera
landing each).

## 6. Risks

- **Cost grows with time.** Springs replay from 0. A 30 s scene would cost
  about 25 ms a frame. Fix: checkpoints every 0.5 s cached by the plan
  (derived from the plan alone, rebuilt on a backwards seek, as the particle
  cache is). Fixed sub-steps from a checkpoint give the same numbers.
- **Floating-point drift between engines.** Node, Chromium (Remotion) and
  Chromium (HyperFrames) share V8, so the same code gives the same floats.
  The `r1` rounding of path data absorbs the rest. A parity test guards it.
- **Authoring.** Hand paths and body keys are hand-written in the
  prototype. Planners can't write them. They must come from the cues we
  already have (`throw`, `point-at`, `catch`, `walk-to`), as generated
  breakdowns per action.
- **Front view vs profile.** Today's figure is a front view; the walk and
  the throw here read as a profile (both legs from one hip point, shoes
  forward). That matches the reference, but turning to camera, sitting and
  the seated sets are not designed yet.
- **What today does that this doesn't.** `holds` carry poses, contact
  reactions (squash, stagger), sets, gaze turns, lip sync, the
  `stick-classic` and toon styles. The head, face and expressions are
  reused, so lip sync and expressions port; the rest needs work.

## 7. Migration path

1. **Opt-in per scene and style.** A cast-scene param (say
   `rig: "per-frame"`) for the stick styles only (`stick`, `stick-classic`,
   `rubber-hose`); everything else keeps the op list. Not in the schema
   until step 3 passes.
2. **Cues → tracks.** Compile today's cues into a track: `walk-to` → a walk
   (and the world camera for long walks), `throw` / `point-at` / `catch` /
   `give` → generated hand paths with breakdowns, `squash` → crouch keys,
   poses → arm targets through the springs. The op list keeps faces, props
   and contact reactions until they are ported.
3. **HyperFrames runtime and parity** (§5), then goldens for the opt-in path.
4. **Default for the stick styles** once a motion review against the
   reference clips passes. Toon styles stay on the op list: their limbs are
   shaded capsules, so a per-frame curve doesn't buy them much.

## 8. What it fixes, and what it doesn't

It fixes the "looks off" causes we could see: feet that skate, legs that
never bend, a walk that glides, limbs that turn as rigid sticks, crouches
that shorten legs, and arms that tween in straight angle lines. Side by side,
the per-frame figure walks, crouches with bent knees and throws in an arc.

Still missing against the reference: the walk has small steps and a quiet
upper body (no shoulder roll, little head bob); there is no squash and
stretch of the body or the limbs themselves; hand shapes don't change with
the action; and every beat is hand-keyed, not generated from cues.
